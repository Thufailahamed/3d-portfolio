import * as THREE from "three";
import type { Ground } from "./terrain";
import { makePuffTexture, makeTrackTexture } from "./textures";
import type { World } from "./worlds";

/** A small cached height grid so thousands of particles can land without thousands of noise calls. */
class HeightCache {
  private n = 40;
  private cell = 2;
  private data = new Float32Array(this.n * this.n);
  private ox = 1e9;
  private oz = 1e9;
  constructor(private ground: Ground) {}
  refresh(x: number, z: number, force = false) {
    const half = (this.n * this.cell) / 2;
    if (!force && Math.abs(x - (this.ox + half)) < 12 && Math.abs(z - (this.oz + half)) < 12) return;
    this.ox = Math.round(x - half);
    this.oz = Math.round(z - half);
    for (let j = 0; j < this.n; j++) for (let i = 0; i < this.n; i++) this.data[j * this.n + i] = this.ground.height(this.ox + i * this.cell, this.oz + j * this.cell);
  }
  at(x: number, z: number) {
    const fx = (x - this.ox) / this.cell;
    const fz = (z - this.oz) / this.cell;
    if (fx < 0 || fz < 0 || fx >= this.n - 1 || fz >= this.n - 1) return -1e9;
    const i = Math.floor(fx);
    const j = Math.floor(fz);
    const u = fx - i;
    const v = fz - j;
    const d = this.data;
    const n = this.n;
    const a = d[j * n + i];
    const b = d[j * n + i + 1];
    const c = d[(j + 1) * n + i];
    const e = d[(j + 1) * n + i + 1];
    return a + (b - a) * u + (c - a) * v + (a - b - c + e) * u * v;
  }
}

const DUST_VERT = /* glsl */ `
attribute float aSize; attribute float aAlpha; attribute float aShade;
uniform float uScale;
varying float vAlpha; varying float vShade;
#include <fog_pars_vertex>
void main() {
  vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mvPosition;
  gl_PointSize = clamp(aSize * uScale / -mvPosition.z, 0.0, 512.0);
  // fade sprites that get right up against the lens
  vAlpha = aAlpha * smoothstep(0.4, 2.5, -mvPosition.z);
  vShade = aShade;
  #include <fog_vertex>
}`;
const DUST_FRAG = /* glsl */ `
uniform sampler2D tPuff; uniform vec3 uColor; uniform vec3 uLight; uniform vec3 uAmb;
varying float vAlpha; varying float vShade;
#include <fog_pars_fragment>
void main() {
  float a = texture2D(tPuff, gl_PointCoord).r * vAlpha;
  if (a < 0.004) discard;
  vec3 c = uColor * (uLight * mix(0.55, 1.0, vShade) + uAmb);
  gl_FragColor = vec4(c, a);
  #include <fog_fragment>
}`;

export class Dust {
  readonly points: THREE.Points;
  private N = 6000;
  private pos: Float32Array;
  private vel = new Float32Array(this.N * 3);
  private life = new Float32Array(this.N);
  private max = new Float32Array(this.N);
  private size: Float32Array;
  private grow = new Float32Array(this.N);
  private alpha: Float32Array;
  private a0 = new Float32Array(this.N);
  private shade: Float32Array;
  private landed = new Uint8Array(this.N);
  private head = 0;
  private cache: HeightCache;
  private mat: THREE.ShaderMaterial;
  private geo = new THREE.BufferGeometry();

  constructor(
    private world: World,
    ground: Ground,
  ) {
    this.cache = new HeightCache(ground);
    this.pos = new Float32Array(this.N * 3);
    this.size = new Float32Array(this.N);
    this.alpha = new Float32Array(this.N);
    this.shade = new Float32Array(this.N);
    for (let i = 0; i < this.N; i++) this.pos[i * 3 + 1] = -1e5;
    this.geo.setAttribute("position", new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute("aSize", new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute("aAlpha", new THREE.BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute("aShade", new THREE.BufferAttribute(this.shade, 1).setUsage(THREE.DynamicDrawUsage));
    this.mat = new THREE.ShaderMaterial({
      vertexShader: DUST_VERT,
      fragmentShader: DUST_FRAG,
      uniforms: THREE.UniformsUtils.merge([
        THREE.UniformsLib.fog,
        {
          tPuff: { value: makePuffTexture() },
          uColor: { value: new THREE.Color(world.soil.dustColor) },
          uLight: { value: new THREE.Color(1, 1, 1) },
          uAmb: { value: new THREE.Color(0.3, 0.3, 0.3) },
          uScale: { value: 600 },
        },
      ]),
      transparent: true,
      depthWrite: false,
      fog: true,
    });
    this.points = new THREE.Points(this.geo, this.mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 5;
  }

  setLight(sun: THREE.Color, amb: THREE.Color) {
    (this.mat.uniforms.uLight.value as THREE.Color).copy(sun);
    (this.mat.uniforms.uAmb.value as THREE.Color).copy(amb);
  }

  setScale(heightPx: number, fovDeg: number) {
    this.mat.uniforms.uScale.value = heightPx / (2 * Math.tan(THREE.MathUtils.degToRad(fovDeg) / 2));
  }

  focus(x: number, z: number, force = false) {
    this.cache.refresh(x, z, force);
  }

  emit(p: THREE.Vector3, v: THREE.Vector3, spread: number, size: number, life: number, alpha = 0.6, grow = 0) {
    const i = this.head;
    this.head = (this.head + 1) % this.N;
    this.pos[i * 3] = p.x;
    this.pos[i * 3 + 1] = p.y;
    this.pos[i * 3 + 2] = p.z;
    this.vel[i * 3] = v.x + (Math.random() - 0.5) * spread;
    this.vel[i * 3 + 1] = v.y + Math.random() * spread * 0.6;
    this.vel[i * 3 + 2] = v.z + (Math.random() - 0.5) * spread;
    this.life[i] = 0;
    this.max[i] = life * (0.7 + Math.random() * 0.6);
    this.size[i] = size * (0.6 + Math.random() * 0.8);
    this.grow[i] = grow;
    this.a0[i] = alpha;
    this.alpha[i] = alpha;
    this.shade[i] = Math.random();
    this.landed[i] = 0;
  }

  update(dt: number, wind: THREE.Vector3) {
    const W = this.world;
    const g = W.g;
    const drag = W.soil.dustDrag;
    const vacuum = W.atm.rho < 0.001;
    const p = this.pos;
    const v = this.vel;
    for (let i = 0; i < this.N; i++) {
      if (this.alpha[i] <= 0 && this.life[i] >= this.max[i]) continue;
      this.life[i] += dt;
      const t = this.life[i] / this.max[i];
      if (t >= 1) {
        this.alpha[i] = 0;
        p[i * 3 + 1] = -1e5;
        continue;
      }
      const k = i * 3;
      if (!this.landed[i]) {
        // gravity, and in an atmosphere drag toward the wind (fine dust hangs, sand falls)
        v[k + 1] -= g * dt;
        if (drag > 0) {
          const f = 1 - Math.exp(-drag * dt);
          v[k] += (wind.x - v[k]) * f;
          v[k + 1] += (0 - v[k + 1]) * f * 0.85;
          v[k + 2] += (wind.z - v[k + 2]) * f;
        }
        p[k] += v[k] * dt;
        p[k + 1] += v[k + 1] * dt;
        p[k + 2] += v[k + 2] * dt;
        const gy = this.cache.at(p[k], p[k + 2]);
        if (p[k + 1] < gy + 0.02) {
          p[k + 1] = gy + 0.02;
          if (vacuum) {
            // in vacuum grains simply land where their parabola ends
            this.landed[i] = 1;
            this.max[i] = Math.min(this.max[i], this.life[i] + 0.25);
          } else {
            v[k + 1] = Math.abs(v[k + 1]) * 0.1;
            v[k] *= 0.5;
            v[k + 2] *= 0.5;
          }
        }
      }
      this.size[i] += this.grow[i] * dt;
      this.alpha[i] = this.a0[i] * Math.min(1, t * 12) * (1 - t) * (1 - t * 0.3);
    }
    (this.geo.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    (this.geo.attributes.aSize as THREE.BufferAttribute).needsUpdate = true;
    (this.geo.attributes.aAlpha as THREE.BufferAttribute).needsUpdate = true;
  }

  clear() {
    this.alpha.fill(0);
    this.life.fill(1);
    this.max.fill(1);
    for (let i = 0; i < this.N; i++) this.pos[i * 3 + 1] = -1e5;
  }

  dispose() {
    this.geo.dispose();
    (this.mat.uniforms.tPuff.value as THREE.Texture).dispose();
    this.mat.dispose();
  }
}

/** Wheel prints: one decal per ~0.3 m of travel per wheel, kept for good (tracks last decades on airless worlds). */
export class Tracks {
  readonly mesh: THREE.InstancedMesh;
  private MAX = 9000;
  private n = 0;
  private head = 0;
  private last: (THREE.Vector3 | null)[] = [null, null, null, null, null, null];
  private tex = makeTrackTexture();
  private mat: THREE.MeshStandardMaterial;

  constructor(world: World) {
    const geo = new THREE.PlaneGeometry(0.42, 0.34);
    geo.rotateX(-Math.PI / 2);
    const uv = geo.attributes.uv as THREE.BufferAttribute;
    for (let i = 0; i < uv.count; i++) uv.setY(i, uv.getY(i) * 0.62);
    const c = new THREE.Color(world.palette.low).multiplyScalar(0.5);
    this.mat = new THREE.MeshStandardMaterial({
      color: c,
      roughness: 1,
      alphaMap: this.tex,
      transparent: true,
      opacity: world.soil.track,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -4,
    });
    this.mesh = new THREE.InstancedMesh(geo, this.mat, this.MAX);
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    this.mesh.receiveShadow = true;
    this.mesh.renderOrder = 1;
  }

  private m = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private basis = new THREE.Matrix4();
  private s = new THREE.Vector3(1, 1, 1);
  private x = new THREE.Vector3();

  /** called per wheel per frame with its contact point, ground normal and heading */
  stamp(i: number, at: THREE.Vector3, normal: THREE.Vector3, fwd: THREE.Vector3, pressure: number) {
    if (this.mat.opacity <= 0 || pressure < 0.05) {
      this.last[i] = null;
      return;
    }
    const prev = this.last[i];
    if (prev && prev.distanceToSquared(at) < 0.3 * 0.3) return;
    if (prev && prev.distanceToSquared(at) > 2.5) {
      this.last[i] = at.clone();
      return;
    }
    this.last[i] = at.clone();
    // tangent frame: x across the track, y the ground normal, z along it
    this.x.crossVectors(normal, fwd).normalize();
    const z = new THREE.Vector3().crossVectors(this.x, normal).normalize();
    this.basis.makeBasis(this.x, normal, z);
    this.q.setFromRotationMatrix(this.basis);
    this.s.set(1, 1, 1);
    this.m.compose(new THREE.Vector3(at.x, at.y + 0.015, at.z), this.q, this.s);
    this.mesh.setMatrixAt(this.head, this.m);
    this.head = (this.head + 1) % this.MAX;
    this.n = Math.min(this.MAX, this.n + 1);
    this.mesh.count = this.n;
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  breakAll() {
    this.last.fill(null);
  }

  dispose() {
    this.mesh.geometry.dispose();
    this.mat.dispose();
    this.tex.dispose();
  }
}

const GLSL_NOISE2 = /* glsl */ `
float fxh(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float fxn(vec2 p) { vec2 i = floor(p); vec2 f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(fxh(i), fxh(i + vec2(1, 0)), f.x), mix(fxh(i + vec2(0, 1)), fxh(i + vec2(1, 1)), f.x), f.y); }
`;

/**
 * Rocket exhaust, drawn so it reads from any angle: a ribbon that turns about the nozzle axis to face
 * the camera (a hot narrow core inside a turbulent sheath, shock diamonds in air), plus a glow at the
 * nozzle exit that grows as you look straight up the plume. In vacuum the plume flares wide and faint.
 */
export function plumeMaterial(vacuum: boolean) {
  return new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uPower: { value: 0 }, uVac: { value: vacuum ? 1 : 0 } },
    vertexShader: /* glsl */ `
attribute float aSide; attribute float aR; attribute float aPart; attribute vec2 aCorner;
varying vec2 vUv; varying float vPart; varying float vEnd;
void main() {
  vec3 axis = normalize(mat3(modelMatrix) * vec3(0.0, -1.0, 0.0));
  float sc = length(modelMatrix[0].xyz);
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vec3 toCam = normalize(cameraPosition - wp.xyz);
  float endOn = abs(dot(axis, toCam));
  if (aPart < 0.5) {
    vec3 side = cross(axis, toCam);
    float l = length(side);
    side = l > 1e-4 ? side / l : normalize(cross(axis, vec3(0.31, 0.95, 0.0)));
    wp.xyz += side * aSide * aR * sc;
  } else {
    vec3 right = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
    vec3 up = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
    wp.xyz += (right * aCorner.x + up * aCorner.y) * aR * sc * mix(1.0, 2.6, endOn * endOn);
  }
  vUv = uv; vPart = aPart; vEnd = endOn;
  gl_Position = projectionMatrix * viewMatrix * wp;
}`,
    fragmentShader: /* glsl */ `
uniform float uTime; uniform float uPower; uniform float uVac;
varying vec2 vUv; varying float vPart; varying float vEnd;
${GLSL_NOISE2}
void main() {
  if (uPower < 0.003) discard;
  vec3 col; float a;
  if (vPart < 0.5) {
    float x = vUv.x * 2.0 - 1.0;
    float along = vUv.y;
    float turb = fxn(vec2(x * 2.5 + 7.0, along * 9.0 - uTime * 31.0)) * 0.55 + fxn(vec2(x * 6.0, along * 22.0 - uTime * 47.0)) * 0.45;
    float core = exp(-x * x * mix(26.0, 5.0, along)) * pow(1.0 - along, mix(3.0, 6.0, uVac));
    float sheath = (1.0 - x * x) * (1.0 - x * x) * (0.3 + 0.9 * turb);
    float diamonds = mix(0.65 + 0.35 * pow(0.5 + 0.5 * cos(along * 46.0 - uTime * 4.0), 3.0), 1.0, uVac);
    float fade = pow(1.0 - along, mix(2.2, 2.6, uVac)) * smoothstep(0.0, 0.025, along);
    a = uPower * fade * (core * 1.3 * diamonds + sheath * mix(0.2, 0.12, uVac)) * (1.0 - pow(vEnd, 4.0) * 0.85);
    vec3 outer = mix(vec3(1.0, 0.46, 0.16), vec3(0.45, 0.6, 1.0), uVac);
    vec3 inner = mix(vec3(1.0, 0.86, 0.66), vec3(0.85, 0.92, 1.0), uVac);
    col = mix(outer * 1.8, inner * 7.0, clamp(core * 1.6 - along, 0.0, 1.0));
  } else {
    float d = length(vUv * 2.0 - 1.0);
    float flick = 0.85 + 0.15 * fxn(vec2(uTime * 37.0, 3.0));
    float g = (exp(-d * d * 9.0) * 0.9 + exp(-d * d * 3.0) * 0.18) * (1.0 - smoothstep(0.55, 1.0, d));
    a = uPower * g * flick * (0.55 + vEnd * 0.9);
    col = mix(vec3(1.0, 0.78, 0.5), vec3(0.75, 0.85, 1.0), uVac) * 6.0;
  }
  if (a < 0.002) discard;
  gl_FragColor = vec4(col, min(a, 1.0));
}`,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
  });
}

/** geometry for `plumeMaterial`: a ribbon along −y (len long, widening from r at the nozzle) and an exit glow */
export function plumeGeometry(len: number, r: number) {
  const N = 24;
  const pos: number[] = [];
  const uv: number[] = [];
  const side: number[] = [];
  const rad: number[] = [];
  const part: number[] = [];
  const corner: number[] = [];
  const idx: number[] = [];
  for (let i = 0; i <= N; i++) {
    const t = i / N;
    // the plume swells quickly off the lip, then grows slowly
    const w = r * (0.8 + 2.6 * Math.sqrt(t) + 1.2 * t);
    for (const s of [-1, 1]) {
      pos.push(0, -t * len, 0);
      uv.push(s < 0 ? 0 : 1, t);
      side.push(s);
      rad.push(w);
      part.push(0);
      corner.push(0, 0);
    }
    if (i < N) {
      const a = i * 2;
      idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
  }
  const b = pos.length / 3;
  for (const [cx, cy] of [
    [-1, -1],
    [1, -1],
    [1, 1],
    [-1, 1],
  ]) {
    pos.push(0, -r * 0.4, 0);
    uv.push((cx + 1) / 2, (cy + 1) / 2);
    side.push(0);
    rad.push(r * 1.7);
    part.push(1);
    corner.push(cx, cy);
  }
  idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute("aSide", new THREE.Float32BufferAttribute(side, 1));
  g.setAttribute("aR", new THREE.Float32BufferAttribute(rad, 1));
  g.setAttribute("aPart", new THREE.Float32BufferAttribute(part, 1));
  g.setAttribute("aCorner", new THREE.Float32BufferAttribute(corner, 2));
  g.setIndex(idx);
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, -len / 2, 0), len);
  return g;
}

const GLOW_VERT = /* glsl */ `
varying vec2 vUv; varying vec3 vN; varying vec3 vV;
void main() {
  vUv = uv;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vN = normalize(normalMatrix * normal);
  vV = normalize(-mv.xyz);
  gl_Position = projectionMatrix * mv;
}`;

/**
 * The plasma around an entering aeroshell whose heat shield faces −y (shield units, metres): the
 * shield's own incandescence, a bright bow-shock layer standing off it, a turbulent shear-layer wake
 * peeling off the shoulder and closing into a neck, a hot recirculating core, ablation sparks, and a
 * light that throws the glow onto the backshell.
 */
export function entryGlow(color: string, profile: THREE.Vector2[], quality = 2) {
  const g = new THREE.Group();
  const species = new THREE.Color(color);
  const mats: THREE.ShaderMaterial[] = [];
  const geos: THREE.BufferGeometry[] = [];
  const mk = (mode: number, side: THREE.Side = THREE.DoubleSide) => {
    const m = new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 }, uHeat: { value: 0 }, uColor: { value: species }, uMode: { value: mode } },
      vertexShader: GLOW_VERT,
      fragmentShader: /* glsl */ `
uniform float uTime; uniform float uHeat; uniform vec3 uColor; uniform float uMode;
varying vec2 vUv; varying vec3 vN; varying vec3 vV;
${GLSL_NOISE2}
void main() {
  float facing = abs(dot(normalize(vN), normalize(vV)));
  vec3 white = vec3(1.0, 0.93, 0.86);
  float along = vUv.y;
  vec3 c; float a;
  if (uMode < 0.5) {
    // the shield itself, glowing dull red to orange
    float n = fxn(vUv * vec2(60.0, 14.0) + vec2(0.0, uTime * 0.6));
    float k = (1.0 - along * 0.55) * (0.75 + 0.25 * n);
    c = mix(vec3(1.0, 0.25, 0.05), vec3(1.0, 0.6, 0.25), k) * 2.2;
    a = uHeat * k * 0.85;
  } else if (uMode < 1.5) {
    // the shock layer: brightest at the stagnation point, limb-brightened where we look through more gas
    float n = fxn(vec2(vUv.x * 90.0, along * 10.0 - uTime * 9.0)) * 0.6 + fxn(vec2(vUv.x * 23.0, along * 3.0 - uTime * 5.0)) * 0.4;
    float stag = pow(1.0 - smoothstep(0.0, 0.85, along), 1.3);
    float limb = clamp(0.25 / (facing + 0.12), 0.0, 2.4);
    float k = (stag * 1.3 + limb * 0.45 * (1.0 - smoothstep(0.55, 1.0, along))) * (0.7 + 0.45 * n);
    c = mix(uColor * 2.5, white * 9.0, clamp(stag * 0.9 + n * 0.15, 0.0, 1.0));
    a = uHeat * k * 0.75;
  } else if (uMode < 2.5) {
    // shear-layer wake: streaming filaments that thin and cool downstream
    float s1 = fxn(vec2(vUv.x * 70.0, along * 7.0 - uTime * 16.0));
    float s2 = fxn(vec2(vUv.x * 19.0 + 3.0, along * 2.5 - uTime * 8.0));
    float fil = pow(s1 * 0.6 + s2 * 0.6, 3.0);
    float limb = clamp(0.2 / (facing + 0.1), 0.0, 2.0);
    float k = fil * (0.35 + limb) * pow(1.0 - along, 2.2) * smoothstep(0.0, 0.04, along);
    c = mix(white * 4.0, uColor * 2.6, smoothstep(0.0, 0.35, along));
    a = uHeat * k * 0.85;
  } else {
    // recirculating core: a softer, pulsing glow along the axis
    float n = fxn(vec2(vUv.x * 12.0, along * 5.0 - uTime * 11.0));
    float k = pow(facing, 1.5) * (0.5 + 0.7 * n) * pow(1.0 - along, 2.6);
    c = mix(white * 3.0, uColor * 2.2, smoothstep(0.0, 0.5, along));
    a = uHeat * k * 0.5;
  }
  if (a < 0.002) discard;
  gl_FragColor = vec4(c, min(a, 1.0));
}`,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side,
    });
    mats.push(m);
    return m;
  };
  const lathe = (pts: THREE.Vector2[], seg: number) => {
    const geo = new THREE.LatheGeometry(pts, seg);
    geos.push(geo);
    return geo;
  };
  // 1 — incandescent shield skin, just proud of the PICA
  const skin = new THREE.Mesh(lathe(profile.map((p) => new THREE.Vector2(p.x * 1.004 + 0.004, p.y - 0.008)), 64), mk(0, THREE.FrontSide));
  // 2 — bow shock: standoff ~0.35 m at the nose, wrapping past the shoulder
  const shockPts = profile.filter((_, i) => i % 2 === 0).map((p) => new THREE.Vector2(p.x * 1.07 + 0.02, p.y - 0.38 + p.x * 0.05));
  const last = shockPts[shockPts.length - 1];
  shockPts.push(new THREE.Vector2(last.x + 0.35, last.y + 0.6), new THREE.Vector2(last.x + 0.75, last.y + 1.7), new THREE.Vector2(last.x + 1.1, last.y + 3.4));
  const shock = new THREE.Mesh(lathe(shockPts, 72), mk(1));
  // 3 — shear-layer wake: peels off the shoulder, necks down ~3 diameters back, then spreads
  const wakePts = [
    [2.3, 0.9],
    [2.75, 2.4],
    [2.7, 5],
    [1.9, 9],
    [1.35, 14],
    [1.8, 24],
    [2.9, 40],
    [3.9, 62],
  ].map(([r, y]) => new THREE.Vector2(r, y));
  const wake = new THREE.Mesh(lathe(wakePts, 64), mk(2));
  const wake2 = new THREE.Mesh(lathe(wakePts.map((p) => new THREE.Vector2(p.x * 0.8, p.y * 0.75 + 0.5)), 48), mk(2));
  // 4 — hot core behind the backshell
  const core = new THREE.Mesh(
    lathe(
      [
        [0.2, 3.2],
        [0.9, 5],
        [1.2, 12],
        [1.1, 24],
        [0.6, 40],
      ].map(([r, y]) => new THREE.Vector2(r, y)),
      32,
    ),
    mk(3),
  );
  g.add(skin, shock, wake, wake2, core);

  // 5 — ablation sparks streaming off the shoulder (stateless: positions are a function of time)
  const N = quality >= 2 ? 420 : quality >= 1 ? 240 : 120;
  const seeds = new Float32Array(N * 3);
  for (let i = 0; i < N * 3; i++) seeds[i] = Math.random();
  const sg = new THREE.BufferGeometry();
  sg.setAttribute("position", new THREE.BufferAttribute(new Float32Array(N * 3), 3));
  sg.setAttribute("aSeed", new THREE.BufferAttribute(seeds, 3));
  sg.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 20, 0), 60);
  geos.push(sg);
  const sparkMat = new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uHeat: { value: 0 }, uColor: { value: species } },
    vertexShader: /* glsl */ `
attribute vec3 aSeed; uniform float uTime; uniform float uHeat;
varying float vA; varying float vT;
void main() {
  float t = fract(uTime * (0.45 + aSeed.x * 0.7) + aSeed.y);
  float ang = aSeed.z * 6.2832 + t * 0.6;
  float r = 2.25 + t * (1.2 + aSeed.x * 2.4) + aSeed.y * 0.3;
  vec3 p = vec3(cos(ang) * r, 0.9 + t * t * 55.0 * (0.4 + aSeed.x), sin(ang) * r);
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;
  float sc = length(modelMatrix[0].xyz);
  gl_PointSize = clamp((0.04 + aSeed.z * 0.06) * sc * 1000.0 / -mv.z * (1.0 - t * 0.6), 0.0, 6.0);
  vA = uHeat * (1.0 - t) * (1.0 - t) * step(0.35, aSeed.x * aSeed.z + 0.3);
  vT = t;
}`,
    fragmentShader: /* glsl */ `
uniform vec3 uColor; varying float vA; varying float vT;
void main() {
  float d = length(gl_PointCoord - 0.5) * 2.0;
  float a = vA * exp(-d * d * 3.0);
  if (a < 0.003) discard;
  gl_FragColor = vec4(mix(vec3(1.0, 0.9, 0.7) * 8.0, uColor * 4.0, vT), a);
}`,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  mats.push(sparkMat);
  const sparks = new THREE.Points(sg, sparkMat);
  sparks.frustumCulled = false;
  g.add(sparks);
  for (const o of [skin, shock, wake, wake2, core, sparks]) o.renderOrder = 4;

  // 6 — the plasma's light on the backshell and anything nearby
  const light = new THREE.PointLight(species.clone().lerp(new THREE.Color("#ffd7b0"), 0.4), 0, 0, 2);
  light.position.set(0, -0.6, 0);
  g.add(light);

  const set = (t: number, heat: number, lightScale = 1) => {
    for (const m of mats) {
      m.uniforms.uTime.value = t;
      m.uniforms.uHeat.value = heat;
    }
    light.intensity = heat * lightScale * (0.85 + Math.random() * 0.3);
    g.visible = heat > 0.005;
  };
  const dispose = () => {
    mats.forEach((m) => m.dispose());
    geos.forEach((x) => x.dispose());
  };
  return { g, set, light, dispose };
}
