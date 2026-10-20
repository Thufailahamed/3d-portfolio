import * as THREE from "three";
import { CLASSES, K } from "./datasets";
import { SIGMA_D } from "./denoiser";
import { FIELD_HALF, G, Q, type Engine, type Run } from "./engine";
import * as S from "./shaders";

/**
 * What the camera sees. Two snapshot slots (A, B) are uploaded from the CPU copies and blended by uMix,
 * so a 10-step run still moves smoothly between the states the sampler actually produced.
 */

export const FLOOR = -2.3;
const TRAIL_N = 120;

const NEUTRAL = new THREE.Color(0.62, 0.66, 0.72);
export const CLASS_COLORS = CLASSES.map((c) => new THREE.Color(c.color));

/** the same mapping as beliefColor() in the shaders: posterior-weighted class colour, greyed while undecided */
function beliefColor(p0: number, p1: number, p2: number, p3: number, out: THREE.Color) {
  const p = [p0, p1, p2, p3];
  out.setRGB(0, 0, 0);
  for (let c = 0; c < K; c++) {
    out.r += p[c] * CLASS_COLORS[c].r;
    out.g += p[c] * CLASS_COLORS[c].g;
    out.b += p[c] * CLASS_COLORS[c].b;
  }
  const sure = Math.min(1, Math.max(0, (Math.max(...p) - 0.25) / 0.75)) ** 0.6;
  return out.lerpColors(NEUTRAL, out.clone(), sure);
}

const floatTex = (w: number, h: number) => {
  const t = new THREE.DataTexture(new Float32Array(w * h * 4), w, h, THREE.RGBAFormat, THREE.FloatType);
  t.minFilter = t.magFilter = THREE.NearestFilter;
  return t;
};
const byteTex = (w: number, h: number) => {
  const t = new THREE.DataTexture(new Uint8Array(w * h * 4), w, h, THREE.RGBAFormat, THREE.UnsignedByteType);
  t.minFilter = t.magFilter = THREE.NearestFilter;
  return t;
};

type Slot = { pos: THREE.DataTexture; x0: THREE.DataTexture; post: THREE.DataTexture };

export class Display {
  readonly root = new THREE.Group();
  private a: Slot;
  private b: Slot;
  private uniforms: Record<string, THREE.IUniform>;
  private fieldUniforms: Record<string, THREE.IUniform>;
  readonly beads: THREE.Points;
  readonly ghost: THREE.Points;
  readonly shadow: THREE.Points;
  readonly trails: THREE.LineSegments;
  readonly field: THREE.Group;
  private trailPos: Float32Array;
  private trailCol: Float32Array;
  private trailIdx: number[];
  private M: number;

  constructor(
    engine: Engine,
    size: number,
  ) {
    const { pw, ph } = engine;
    this.M = pw * ph;
    const slot = (): Slot => ({ pos: floatTex(pw, ph), x0: floatTex(pw, ph), post: byteTex(pw, ph) });
    this.a = slot();
    this.b = slot();
    this.uniforms = {
      uPosA: { value: this.a.pos },
      uPosB: { value: this.b.pos },
      uX0A: { value: this.a.x0 },
      uX0B: { value: this.b.x0 },
      uPostA: { value: this.a.post },
      uPostB: { value: this.b.post },
      uMix: { value: 0 },
      uColors: { value: CLASS_COLORS },
      uSize: { value: size },
      uScale: { value: 800 },
      uFloor: { value: FLOOR },
    };

    const cells = new Float32Array(this.M * 2);
    for (let i = 0; i < this.M; i++) {
      cells[i * 2] = i % pw;
      cells[i * 2 + 1] = Math.floor(i / pw);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(this.M * 3), 3));
    geo.setAttribute("aCell", new THREE.BufferAttribute(cells, 2));
    const mat = (vertexShader: string, fragmentShader: string, extra: Partial<THREE.ShaderMaterialParameters> = {}) =>
      new THREE.ShaderMaterial({ glslVersion: THREE.GLSL3, vertexShader, fragmentShader, uniforms: this.uniforms, ...extra });

    this.shadow = new THREE.Points(geo, mat(S.shadowVert, S.shadowFrag, { transparent: true, depthWrite: false }));
    this.shadow.renderOrder = 0;
    this.beads = new THREE.Points(geo, mat(S.particleVert, S.particleFrag));
    this.beads.renderOrder = 1;
    this.ghost = new THREE.Points(geo, mat(S.ghostVert, S.ghostFrag, { transparent: true, depthWrite: false, depthTest: false, blending: THREE.AdditiveBlending }));
    this.ghost.renderOrder = 2;
    for (const p of [this.shadow, this.beads, this.ghost]) p.frustumCulled = false;

    // trails: a fixed set of particles, one segment per snapshot
    this.trailIdx = Array.from({ length: TRAIL_N }, (_, q) => Math.floor(((q + 0.5) * this.M) / TRAIL_N));
    const maxSeg = TRAIL_N * 251;
    this.trailPos = new Float32Array(maxSeg * 6);
    this.trailCol = new Float32Array(maxSeg * 6);
    const tg = new THREE.BufferGeometry();
    tg.setAttribute("position", new THREE.BufferAttribute(this.trailPos, 3).setUsage(THREE.DynamicDrawUsage));
    tg.setAttribute("color", new THREE.BufferAttribute(this.trailCol, 3).setUsage(THREE.DynamicDrawUsage));
    tg.setDrawRange(0, 0);
    this.trails = new THREE.LineSegments(tg, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.5, depthWrite: false, blending: THREE.AdditiveBlending }));
    this.trails.frustumCulled = false;
    this.trails.renderOrder = 3;

    // the score field: arrows on the y = 0 slice, plus the slice's outline
    const n = G * G * 6;
    const fCell = new Float32Array(n * 2);
    const fKind = new Float32Array(n);
    const kinds = [0, 1, 1, 2, 1, 3];
    for (let c = 0; c < G * G; c++)
      for (let v = 0; v < 6; v++) {
        fCell[(c * 6 + v) * 2] = c % G;
        fCell[(c * 6 + v) * 2 + 1] = Math.floor(c / G);
        fKind[c * 6 + v] = kinds[v];
      }
    const fg = new THREE.BufferGeometry();
    fg.setAttribute("position", new THREE.BufferAttribute(new Float32Array(n * 3), 3));
    fg.setAttribute("aCell", new THREE.BufferAttribute(fCell, 2));
    fg.setAttribute("aKind", new THREE.BufferAttribute(fKind, 1));
    this.fieldUniforms = {
      uGrid: { value: engine.grid },
      uGridX0: { value: engine.field.textures[0] },
      uA: { value: 0 },
      uS2: { value: 1 },
      uCell: { value: (2 * FIELD_HALF) / G },
    };
    const arrows = new THREE.LineSegments(
      fg,
      new THREE.ShaderMaterial({ glslVersion: THREE.GLSL3, vertexShader: S.fieldVert, fragmentShader: S.fieldFrag, uniforms: this.fieldUniforms, transparent: true, depthWrite: false }),
    );
    arrows.frustumCulled = false;
    const h = FIELD_HALF;
    const outline = new THREE.LineLoop(
      new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(-h, 0, -h), new THREE.Vector3(h, 0, -h), new THREE.Vector3(h, 0, h), new THREE.Vector3(-h, 0, h)]),
      new THREE.LineBasicMaterial({ color: 0x5c7aa8, transparent: true, opacity: 0.35, depthWrite: false }),
    );
    this.field = new THREE.Group().add(arrows, outline);
    this.field.renderOrder = 4;

    this.root.add(this.shadow, this.beads, this.ghost, this.trails, this.field);
  }

  /** fill a slot from a run's int16 snapshot */
  loadSnapshot(which: "a" | "b", pos: Int16Array, x0: Int16Array, post: Uint8Array) {
    const s = which === "a" ? this.a : this.b;
    const p = s.pos.image.data as Float32Array;
    const x = s.x0.image.data as Float32Array;
    for (let i = 0, j = 0; i < this.M; i++, j += 3) {
      p[i * 4] = pos[j] / Q;
      p[i * 4 + 1] = pos[j + 1] / Q;
      p[i * 4 + 2] = pos[j + 2] / Q;
      x[i * 4] = x0[j] / Q;
      x[i * 4 + 1] = x0[j + 1] / Q;
      x[i * 4 + 2] = x0[j + 2] / Q;
    }
    (s.post.image.data as Uint8Array).set(post);
    s.pos.needsUpdate = s.x0.needsUpdate = s.post.needsUpdate = true;
  }

  /** fill slot A (and mirror it to B) from float xyz arrays — the forward view */
  loadFloat(pos: Float32Array, x0: Float32Array, post: Uint8Array) {
    for (const s of [this.a, this.b]) {
      const p = s.pos.image.data as Float32Array;
      const x = s.x0.image.data as Float32Array;
      for (let i = 0; i < this.M; i++) {
        p.set(pos.subarray(i * 3, i * 3 + 3), i * 4);
        x.set(x0.subarray(i * 3, i * 3 + 3), i * 4);
      }
      (s.post.image.data as Uint8Array).set(post);
      s.pos.needsUpdate = s.x0.needsUpdate = s.post.needsUpdate = true;
    }
    this.uniforms.uMix.value = 0;
  }

  /** B becomes A without re-uploading, when the timeline moves forward by one snapshot */
  swap() {
    [this.a, this.b] = [this.b, this.a];
    const u = this.uniforms;
    u.uPosA.value = this.a.pos;
    u.uX0A.value = this.a.x0;
    u.uPostA.value = this.a.post;
    u.uPosB.value = this.b.pos;
    u.uX0B.value = this.b.x0;
    u.uPostB.value = this.b.post;
  }

  setMix(f: number) {
    this.uniforms.uMix.value = f;
  }

  /** pixels per world unit at distance 1, for perspective point sizes */
  setScale(heightPx: number, fov: number) {
    this.uniforms.uScale.value = heightPx / (2 * Math.tan(THREE.MathUtils.degToRad(fov) / 2));
  }

  /** trails of the tracked particles through snapshots 0 … j */
  buildTrails(run: Run, j: number) {
    let v = 0;
    const col = new THREE.Color();
    for (let jj = 0; jj < j; jj++) {
      const pa = run.pos[jj];
      const pb = run.pos[jj + 1];
      const post = run.post[jj + 1] ?? run.post[jj];
      // older segments fade out
      const fade = 0.04 + 0.96 * ((jj + 1) / Math.max(1, j)) ** 3;
      for (const i of this.trailIdx) {
        const o = i * 3;
        this.trailPos[v * 3] = pa[o] / Q;
        this.trailPos[v * 3 + 1] = pa[o + 1] / Q;
        this.trailPos[v * 3 + 2] = pa[o + 2] / Q;
        this.trailPos[v * 3 + 3] = pb[o] / Q;
        this.trailPos[v * 3 + 4] = pb[o + 1] / Q;
        this.trailPos[v * 3 + 5] = pb[o + 2] / Q;
        if (post) beliefColor(post[i * 4] / 255, post[i * 4 + 1] / 255, post[i * 4 + 2] / 255, post[i * 4 + 3] / 255, col);
        else col.copy(NEUTRAL);
        for (let e = 0; e < 2; e++) {
          this.trailCol[v * 3 + e * 3] = col.r * fade;
          this.trailCol[v * 3 + e * 3 + 1] = col.g * fade;
          this.trailCol[v * 3 + e * 3 + 2] = col.b * fade;
        }
        v += 2;
      }
    }
    const g = this.trails.geometry;
    g.setDrawRange(0, v);
    (g.attributes.position as THREE.BufferAttribute).clearUpdateRanges();
    (g.attributes.position as THREE.BufferAttribute).addUpdateRange(0, v * 3);
    (g.attributes.color as THREE.BufferAttribute).clearUpdateRanges();
    (g.attributes.color as THREE.BufferAttribute).addUpdateRange(0, v * 3);
    g.attributes.position.needsUpdate = true;
    g.attributes.color.needsUpdate = true;
  }

  /** after engine.computeField(ab, …): the arrows' scale for this noise level */
  setField(ab: number) {
    this.fieldUniforms.uA.value = Math.sqrt(ab);
    this.fieldUniforms.uS2.value = ab * SIGMA_D * SIGMA_D + 1 - ab;
  }

  dispose() {
    for (const s of [this.a, this.b]) [s.pos, s.x0, s.post].forEach((t) => t.dispose());
    this.root.traverse((o) => {
      const m = o as THREE.Mesh;
      m.geometry?.dispose();
      (m.material as THREE.Material | undefined)?.dispose();
    });
  }
}
