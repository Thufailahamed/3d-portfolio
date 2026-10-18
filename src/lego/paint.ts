import * as THREE from "three";
import type { Layout } from "./layout";
import type { BrickPhysics } from "./physics";
import { PLATE } from "./units";

/** Paintball fills, the loud ones you'd find on a field. */
export const PAINTS = [
  { name: "Hot pink", hex: "#ff2a85" },
  { name: "Blaze orange", hex: "#ff6200" },
  { name: "Yellow", hex: "#ffd000" },
  { name: "Lime", hex: "#7fdc00" },
  { name: "Electric blue", hex: "#1a5cff" },
  { name: "Violet", hex: "#7b2cff" },
  { name: "Red", hex: "#d9101c" },
  { name: "White", hex: "#f3f2ec" },
] as const;
const PAINT_COLORS = PAINTS.map((p) => new THREE.Color(p.hex));

/** a .68 calibre ball, at brick scale: about as wide as a stud */
export const BALL_R = 0.3;
/** muzzle speed (world units a second) and how far a ball may fly before it's given up on */
export const BALL_SPEED = 175;
const MAX_BALLS = 48;
const BALL_LIFE = 2.6;
/** splats each piece remembers (oldest go first), and pieces per row of the data texture */
const SLOTS = 6;
const PER_ROW = 64;
const TEXELS = SLOTS * 3;
/** the table top (the baseplates sit on it, a plate's thickness higher) */
const TABLE_Y = -0.33;
const MAX_PARTICLES = 1400;
const MAX_STAMPS = 256;

/* ————————————————————————————————————————————————————————————————————————————————————————————
 * Paint soaks into the pieces themselves. Every piece material is taught to read a small float
 * texture holding each piece's last few splats (centre, direction of travel, size, colour, when it
 * landed) in the piece's own frame, and to work out per pixel whether paint is there. So a splat
 * follows the surface it lands on — over studs, round bevels and onto the next face — rides along
 * when the piece is knocked flying, and runs down walls. The floor is painted from above into a
 * render target instead, since it's flat and huge.
 * ———————————————————————————————————————————————————————————————————————————————————————————— */

const empty = (() => {
  let t: THREE.DataTexture | null = null;
  return () => {
    if (!t) {
      t = new THREE.DataTexture(new Float32Array(4), 1, 1, THREE.RGBAFormat, THREE.FloatType);
      t.needsUpdate = true;
    }
    return t;
  };
})();

/** Shared by every painted material: swapped to the live textures when the paint system starts. */
const shared = {
  uPaint: { value: null as THREE.Texture | null },
  uPaintTime: { value: 0 },
  uPaintWash: { value: 1 },
  uGround: { value: null as THREE.Texture | null },
  uGroundRect: { value: new THREE.Vector4(0, 0, 1, 1) },
};

const BUMP = /* glsl */ `
  // a height field's slope bends the normal (three's perturbNormalArb, without a bump map)
  vec3 paintBump(vec3 surf_pos, vec3 surf_norm, vec2 dHdxy, float faceDir) {
    vec3 vSigmaX = normalize(dFdx(surf_pos));
    vec3 vSigmaY = normalize(dFdy(surf_pos));
    vec3 R1 = cross(vSigmaY, surf_norm);
    vec3 R2 = cross(surf_norm, vSigmaX);
    float fDet = dot(vSigmaX, R1) * faceDir;
    vec3 vGrad = sign(fDet) * (dHdxy.x * R1 + dHdxy.y * R2);
    return normalize(abs(fDet) * surf_norm - vGrad);
  }
`;

const PIECE_PARS = /* glsl */ `
  uniform highp sampler2D uPaint;
  uniform float uPaintTime;
  uniform float uPaintWash;
  varying vec3 vPaintP;
  varying vec3 vPaintN;
  varying vec3 vPaintUp;
  flat varying int vPaintId;

  float pHash(float n) { return fract(sin(n * 12.9898 + 4.1414) * 43758.5453); }

  // One splat, seen from this pixel: how much paint (0..1), and how thick it lies (for the bump).
  // a: centre (piece frame) and radius; b: direction it was travelling and a seed; born: when.
  float paintSplat(vec4 a, vec4 b, float born, float px, out float h) {
    h = 0.0;
    float age = max(0.0, uPaintTime - born);
    // the burst: it slaps out to full size in a few frames
    float grow = 1.0 - pow(1.0 - min(1.0, age * 16.0), 3.0);
    float R = a.w * (0.3 + 0.7 * grow);
    vec3 d = b.xyz;
    float s = b.w;
    vec3 q = vPaintP - a.xyz;
    vec3 nrm = normalize(vPaintN);
    float into = dot(nrm, d);
    // only surfaces that face the shot (or are glancing to it) take paint, and only near the impact
    float facing = smoothstep(0.35, -0.25, into);
    float depth = dot(q, d);
    float gate = facing * (1.0 - smoothstep(0.32 * a.w, 0.9 * a.w, abs(depth)));
    if (gate <= 0.0) return 0.0;

    // the splash, projected along the line of flight: a glancing hit stretches out on its own
    vec3 t1 = normalize(abs(d.y) < 0.9 ? cross(d, vec3(0.0, 1.0, 0.0)) : cross(d, vec3(1.0, 0.0, 0.0)));
    vec3 t2 = cross(d, t1);
    vec2 uv = vec2(dot(q, t1), dot(q, t2)) / R;
    float r = length(uv);
    float aa = px / R * 1.2 + 0.006;
    float cov = 0.0;
    float thick = 0.0;

    if (r < 2.3) {
      float ang = atan(uv.y, uv.x);
      // which way it was going along this surface: the paint keeps going that way
      vec3 fw = d - nrm * into;
      vec2 fuv = vec2(dot(fw, t1), dot(fw, t2));
      float slide = length(fuv);
      float ahead = slide > 0.001 ? max(0.0, dot(uv / max(r, 0.0001), fuv / slide)) * slide : 0.0;

      // the body of the splat: a lumpy disc
      float core = 0.6 + 0.075 * sin(ang * 3.0 + s * 6.1) + 0.05 * sin(ang * 5.0 + s * 2.3) + 0.03 * sin(ang * 11.0 + s * 9.7);
      core *= 1.0 + ahead * 0.45;
      float body = smoothstep(core + aa, core - aa, r);

      // spikes thrown out from it, tapering to a point, each ending in a bead
      const float N = 14.0;
      float k = ang / 6.2831853 * N + s * 7.3;
      float cell = floor(k);
      float f = fract(k) - 0.5;
      float h1 = pHash(cell + s * 31.7);
      float h2 = pHash(cell * 1.31 + s * 17.1);
      float len = core + (0.06 + 0.62 * h1 * h1) * (1.0 + ahead * 2.2);
      float wid = 0.12 + 0.2 * h2;
      float tt = clamp((r - core * 0.8) / max(len - core * 0.8, 0.001), 0.0, 1.0);
      float w = wid * pow(1.0 - tt, 0.75);
      float aaA = aa * N / (6.2831853 * max(r, 0.05));
      float spike = smoothstep(w + aaA, w - aaA, abs(f)) * step(r, len);
      float tipA = (cell + 0.5 - s * 7.3) / N * 6.2831853;
      float tipR = len + 0.05 + 0.1 * h2;
      float tipS = 0.035 + 0.06 * h1;
      float bead = smoothstep(tipS + aa, tipS - aa, length(uv - vec2(cos(tipA), sin(tipA)) * tipR)) * step(0.35, h1);

      // satellite drops flung further out
      const float N2 = 19.0;
      float k2 = ang / 6.2831853 * N2 + s * 3.1;
      float c2 = floor(k2);
      float sh = pHash(c2 * 2.17 + s * 5.3);
      float satA = (c2 + 0.2 + 0.6 * pHash(c2 + s * 9.1)) / N2 * 6.2831853 - s * 3.1 / N2 * 6.2831853;
      float satR = (1.0 + 0.9 * pHash(c2 * 3.3 + s)) * (1.0 + ahead * 0.8);
      float satS = 0.025 + 0.055 * sh * sh;
      float sat = smoothstep(satS + aa, satS - aa, length(uv - vec2(cos(satA), sin(satA)) * satR)) * step(0.45, sh);

      // and a fine mist of specks
      vec2 g = floor(uv * 26.0);
      float mh = pHash(g.x * 17.0 + g.y * 131.0 + s * 71.0);
      float mist = step(1.0 - 0.22 * (1.0 - smoothstep(0.6, 1.9, r)), mh) * smoothstep(0.32, 0.12, length(fract(uv * 26.0) - 0.5)) * step(core, r);

      cov = max(max(body, spike), max(max(bead, sat), mist));
      thick = smoothstep(core + 0.2, core - 0.3, r) * 0.85 + max(spike * 0.35, max(bead, sat) * 0.55);
    }

    // drips: on a wall, paint runs down from the bottom of the splat, slowly, and stops
    vec3 up = normalize(vPaintUp);
    if (abs(dot(nrm, up)) < 0.4 && facing > 0.5) {
      vec3 side = normalize(cross(up, nrm));
      float x = dot(q, side) / a.w;
      float y = dot(q, up) / a.w;
      const float colW = 0.15;
      float col = floor(x / colW);
      float dh = pHash(col * 3.7 + s * 11.0);
      if (abs(x) < 0.5 && dh > 0.42 && y < 0.0) {
        float run = 1.0 - exp(-age * 0.35);
        float L = (0.25 + 1.9 * pHash(col * 7.1 + s) * pHash(col * 1.9 + s * 3.0)) * run;
        float cx = (col + 0.5 + (pHash(col + s * 2.0) - 0.5) * 0.35) * colW;
        float top = -0.3;
        float wd = 0.022 + 0.03 * dh;
        float aaD = px / a.w * 1.2;
        float yy = y - top;
        float drip = 0.0;
        if (yy < 0.0 && yy > -L) drip = smoothstep(wd + aaD, wd - aaD, abs(x - cx) / (0.7 + 0.3 * (1.0 + yy / max(L, 0.001))));
        float bulb = length(vec2(x - cx, (yy + L) * 0.85));
        drip = max(drip, smoothstep(wd * 1.45 + aaD, wd * 1.45 - aaD, bulb) * step(0.02, L));
        cov = max(cov, drip);
        thick = max(thick, drip * 0.7);
      }
    }
    h = thick * gate;
    return cov * gate;
  }
` + BUMP;

const PIECE_FRAG = /* glsl */ `
  vec3 paintPre = vec3(0.0);
  float paintA = 0.0;
  float paintH = 0.0;
  float paintWet = 0.0;
  float paintPx = length(fwidth(vPaintP));
  if (vPaintId > 0) {
    int pid = vPaintId - 1;
    ivec2 base = ivec2((pid % ${PER_ROW}) * ${TEXELS}, pid / ${PER_ROW});
    for (int i = 0; i < ${SLOTS}; i++) {
      vec4 sa = texelFetch(uPaint, base + ivec2(i * 3, 0), 0);
      if (sa.w <= 0.0) break;
      vec4 sb = texelFetch(uPaint, base + ivec2(i * 3 + 1, 0), 0);
      vec4 sc = texelFetch(uPaint, base + ivec2(i * 3 + 2, 0), 0);
      float sh;
      float m = paintSplat(sa, sb, sc.w, paintPx, sh);
      paintH = max(paintH, sh);
      if (m <= 0.0) continue;
      // newer splats lie over older ones
      paintPre = sc.rgb * m + paintPre * (1.0 - m);
      paintA = m + paintA * (1.0 - m);
      paintWet = mix(paintWet, 1.0 - smoothstep(3.0, 45.0, uPaintTime - sc.w), m);
    }
  }
  float paintCov = paintA;
  paintA *= uPaintWash;
  paintH *= uPaintWash;
  if (paintA > 0.0) diffuseColor.rgb = mix(diffuseColor.rgb, paintPre / max(paintCov, 0.0001), paintA);
  diffuseColor.a = mix(diffuseColor.a, 1.0, paintA);
`;

const GROUND_PARS = /* glsl */ `
  uniform sampler2D uGround;
  uniform vec4 uGroundRect;
  uniform float uPaintWash;
  varying vec3 vPaintW;
` + BUMP;

const GROUND_FRAG = /* glsl */ `
  vec2 paintUv = (vPaintW.xz - uGroundRect.xy) / uGroundRect.zw;
  vec4 paintG = texture(uGround, paintUv);
  float paintIn = step(0.0, paintUv.x) * step(paintUv.x, 1.0) * step(0.0, paintUv.y) * step(paintUv.y, 1.0);
  float paintA = paintG.a * paintIn * uPaintWash;
  float paintH = smoothstep(0.0, 0.8, paintG.a) * paintIn * uPaintWash;
  float paintWet = 0.55;
  if (paintA > 0.0) diffuseColor.rgb = mix(diffuseColor.rgb, paintG.rgb / max(paintG.a, 0.0001), paintA);
`;

/** The lighting half, the same for both: glossy where wet, raised at the edges, never glowing. */
const SURFACE = {
  rough: /* glsl */ `
  roughnessFactor = mix(roughnessFactor, mix(0.42, 0.06, paintWet), paintA);`,
  metal: /* glsl */ `
  metalnessFactor = mix(metalnessFactor, 0.0, paintA);`,
  normal: /* glsl */ `
  {
    vec2 paintD = vec2(dFdx(paintH), dFdy(paintH));
    if (paintH > 0.0) normal = paintBump(-vViewPosition, normal, paintD * 0.9, faceDirection);
  }`,
  clearcoat: /* glsl */ `
  #ifdef USE_CLEARCOAT
    clearcoatNormal = normalize(mix(clearcoatNormal, normal, paintA));
  #endif`,
  emissive: /* glsl */ `
  totalEmissiveRadiance *= 1.0 - paintA;`,
};

function inject(shader: THREE.WebGLProgramParametersWithUniforms, fragPars: string, frag: string) {
  shader.fragmentShader = shader.fragmentShader
    .replace("#include <common>", `#include <common>\n${fragPars}`)
    .replace("#include <color_fragment>", `#include <color_fragment>\n${frag}`)
    .replace("#include <metalnessmap_fragment>", `#include <metalnessmap_fragment>\n${SURFACE.rough}\n${SURFACE.metal}`)
    .replace("#include <normal_fragment_maps>", `#include <normal_fragment_maps>\n${SURFACE.normal}`)
    .replace("#include <clearcoat_normal_fragment_maps>", `#include <clearcoat_normal_fragment_maps>\n${SURFACE.clearcoat}`)
    .replace("#include <emissivemap_fragment>", `#include <emissivemap_fragment>\n${SURFACE.emissive}`);
}

/**
 * Teach a piece material to show paint. Instanced pieces carry their id in `aPiece` (id + 1;
 * 0 means never painted, which is also what anything without the attribute reads). A printed
 * face (`decal`) carries its points in its piece's frame in `aPaintP`/`aPaintN`, and its own
 * rotation within the piece in `paintRot`.
 */
export function paintPieces(mat: THREE.Material, decal?: { rot: THREE.Matrix3 }) {
  if (!shared.uPaint.value) shared.uPaint.value = empty();
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, { uPaint: shared.uPaint, uPaintTime: shared.uPaintTime, uPaintWash: shared.uPaintWash });
    shader.uniforms.uPaintRot = { value: decal?.rot ?? new THREE.Matrix3() };
    shader.vertexShader = shader.vertexShader
      .replace(
        "#include <common>",
        `#include <common>
        attribute float aPiece;
        ${decal ? "attribute vec3 aPaintP;\nattribute vec3 aPaintN;" : ""}
        uniform mat3 uPaintRot;
        varying vec3 vPaintP;
        varying vec3 vPaintN;
        varying vec3 vPaintUp;
        flat varying int vPaintId;`,
      )
      .replace(
        "#include <begin_vertex>",
        `#include <begin_vertex>
        ${decal ? "vPaintP = aPaintP;\nvPaintN = aPaintN;" : "vPaintP = position;\nvPaintN = normal;"}
        #ifdef USE_INSTANCING
          vPaintUp = transpose(mat3(instanceMatrix)) * vec3(0.0, 1.0, 0.0);
        #else
          vPaintUp = uPaintRot * (transpose(mat3(modelMatrix)) * vec3(0.0, 1.0, 0.0));
        #endif
        vPaintId = int(aPiece + 0.5);`,
      );
    inject(shader, PIECE_PARS, PIECE_FRAG);
  };
  mat.customProgramCacheKey = () => (decal ? "paint-decal" : "paint-piece");
  mat.needsUpdate = true;
}

/** Teach a floor material (baseplates, their studs, the roads, the table) to show paint. */
export function paintGround(mat: THREE.Material) {
  if (!shared.uGround.value) shared.uGround.value = empty();
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, { uGround: shared.uGround, uGroundRect: shared.uGroundRect, uPaintWash: shared.uPaintWash });
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nvarying vec3 vPaintW;")
      .replace(
        "#include <begin_vertex>",
        `#include <begin_vertex>
        {
          vec4 pw = vec4(transformed, 1.0);
          #ifdef USE_INSTANCING
            pw = instanceMatrix * pw;
          #endif
          vPaintW = (modelMatrix * pw).xyz;
        }`,
      );
    inject(shader, GROUND_PARS, GROUND_FRAG);
  };
  mat.customProgramCacheKey = () => "paint-ground";
  mat.needsUpdate = true;
}

/**
 * Splat shapes for the floor, drawn once: a lumpy body, tapering spikes with beads at their tips,
 * flung drops and a mist of specks — four variations in a 2 × 2 atlas, white on clear.
 */
function splatAtlas() {
  const S = 512;
  const c = document.createElement("canvas");
  c.width = c.height = S * 2;
  const ctx = c.getContext("2d")!;
  let seed = 21;
  const rand = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
  ctx.fillStyle = "#fff";
  for (let v = 0; v < 4; v++) {
    const cx = (v % 2) * S + S / 2;
    const cy = Math.floor(v / 2) * S + S / 2;
    const R = S * 0.17;
    const ph = [rand() * 6, rand() * 6, rand() * 6];
    // body
    ctx.beginPath();
    for (let i = 0; i <= 96; i++) {
      const a = (i / 96) * Math.PI * 2;
      const r = R * (0.5 + 0.075 * Math.sin(a * 3 + ph[0]) + 0.05 * Math.sin(a * 5 + ph[1]) + 0.03 * Math.sin(a * 11 + ph[2])) * 1.9;
      const x = cx + Math.cos(a) * r;
      const y = cy + Math.sin(a) * r;
      if (i) ctx.lineTo(x, y);
      else ctx.moveTo(x, y);
    }
    ctx.fill();
    // spikes and their beads
    const n = 12 + Math.floor(rand() * 6);
    for (let i = 0; i < n; i++) {
      const a = ((i + rand() * 0.6) / n) * Math.PI * 2;
      const len = R * (1.05 + rand() * rand() * 1.7);
      const w = R * (0.07 + rand() * 0.12);
      const ux = Math.cos(a);
      const uy = Math.sin(a);
      ctx.beginPath();
      ctx.moveTo(cx + ux * R * 0.7 - uy * w, cy + uy * R * 0.7 + ux * w);
      ctx.quadraticCurveTo(cx + ux * len * 0.75 - uy * w * 0.35, cy + uy * len * 0.75 + ux * w * 0.35, cx + ux * len, cy + uy * len);
      ctx.quadraticCurveTo(cx + ux * len * 0.75 + uy * w * 0.35, cy + uy * len * 0.75 - ux * w * 0.35, cx + ux * R * 0.7 + uy * w, cy + uy * R * 0.7 - ux * w);
      ctx.fill();
      if (rand() > 0.35) {
        ctx.beginPath();
        ctx.arc(cx + ux * (len + R * 0.08), cy + uy * (len + R * 0.08), R * (0.035 + rand() * 0.06), 0, Math.PI * 2);
        ctx.fill();
      }
    }
    // flung drops
    for (let i = 0; i < 16; i++) {
      const a = rand() * Math.PI * 2;
      const r = R * (1.1 + rand() * 0.85);
      ctx.beginPath();
      ctx.arc(cx + Math.cos(a) * r, cy + Math.sin(a) * r, R * (0.02 + rand() * rand() * 0.07), 0, Math.PI * 2);
      ctx.fill();
    }
    // mist
    for (let i = 0; i < 260; i++) {
      const a = rand() * Math.PI * 2;
      const r = R * (0.9 + Math.pow(rand(), 1.6) * 1.05);
      ctx.globalAlpha = 0.5 + rand() * 0.5;
      ctx.beginPath();
      ctx.arc(cx + Math.cos(a) * r, cy + Math.sin(a) * r, 0.8 + rand() * 1.6, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.NoColorSpace;
  t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  return t;
}

/** A flat drop of paint, for droplets landing on the floor. */
const DOT_CELL = -1;

type Ball = { p: THREE.Vector3; v: THREE.Vector3; color: number; age: number; bounced: boolean };
type Stamp = { x: number; z: number; size: number; stretch: number; angle: number; color: THREE.Color; alpha: number; cell: number };

export type PaintHit = { at: THREE.Vector3; strength: number; kind: "splat" | "bounce" };

/**
 * The paint: balls in flight (each a real ballistic path, swept against the physics every step),
 * what they leave on the pieces and the floor, and the spray each burst throws off.
 */
export class Paint {
  readonly root = new THREE.Group();
  /** splats laid down since the last wash */
  splats = 0;
  onHit: (hit: PaintHit) => void = () => {};
  private balls: Ball[] = [];
  private ballMesh: THREE.InstancedMesh;
  private data: Float32Array;
  private tex: THREE.DataTexture;
  private counts: Uint8Array;
  private dirty = false;
  private pieces: Layout["pieces"];
  private bounds: Layout["bounds"];
  private time = 0;
  private wash = -1;
  // the floor
  private ground: THREE.WebGLRenderTarget;
  private groundRect: THREE.Vector4;
  private stampScene = new THREE.Scene();
  private stampCam: THREE.OrthographicCamera;
  private stampMesh: THREE.InstancedMesh;
  private stampCell: THREE.InstancedBufferAttribute;
  private stampColor: THREE.InstancedBufferAttribute;
  private stamps: Stamp[] = [];
  private clearGround = true;
  // the spray
  private pts: THREE.Points;
  private pPos = new Float32Array(MAX_PARTICLES * 3);
  private pVel = new Float32Array(MAX_PARTICLES * 3);
  private pCol = new Float32Array(MAX_PARTICLES * 3);
  private pSize = new Float32Array(MAX_PARTICLES);
  private pAlpha = new Float32Array(MAX_PARTICLES);
  private pKind = new Float32Array(MAX_PARTICLES);
  private pLife = new Float32Array(MAX_PARTICLES);
  private pSpan = new Float32Array(MAX_PARTICLES);
  private pBase = new Float32Array(MAX_PARTICLES);
  private pA0 = new Float32Array(MAX_PARTICLES);
  private pColorIdx = new Int8Array(MAX_PARTICLES);
  private pNext = 0;
  private sprayed = false;
  private pMat: THREE.ShaderMaterial;
  private m = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private v = new THREE.Vector3();
  private v2 = new THREE.Vector3();
  private s = new THREE.Vector3();
  private dir = new THREE.Vector3();
  private z = new THREE.Vector3(0, 0, 1);

  constructor(layout: Layout, small: boolean) {
    this.pieces = layout.pieces;
    this.bounds = layout.bounds;
    const n = layout.pieces.length;
    const rows = Math.max(1, Math.ceil(n / PER_ROW));
    this.data = new Float32Array(PER_ROW * TEXELS * rows * 4);
    this.tex = new THREE.DataTexture(this.data, PER_ROW * TEXELS, rows, THREE.RGBAFormat, THREE.FloatType);
    this.tex.needsUpdate = true;
    this.counts = new Uint8Array(n);
    shared.uPaint.value = this.tex;
    shared.uPaintWash.value = 1;

    // —— balls in flight: glossy gelatin shells ——
    const ballMat = new THREE.MeshPhysicalMaterial({ color: 0xffffff, roughness: 0.14, clearcoat: 1, clearcoatRoughness: 0.04, sheen: 0.4, sheenColor: new THREE.Color("#ffffff"), envMapIntensity: 1.6 });
    this.ballMesh = new THREE.InstancedMesh(new THREE.SphereGeometry(BALL_R, 20, 14), ballMat, MAX_BALLS);
    this.ballMesh.castShadow = true;
    this.ballMesh.frustumCulled = false;
    this.ballMesh.count = 0;
    for (let i = 0; i < MAX_BALLS; i++) this.ballMesh.setColorAt(i, PAINT_COLORS[0]);
    this.root.add(this.ballMesh);

    // —— the floor's paint, looked down on from above ——
    const { x0, x1, z0, z1 } = layout.bounds;
    const pad = 40;
    this.groundRect = new THREE.Vector4(x0 - pad, z0 - pad, x1 - x0 + pad * 2, z1 - z0 + pad * 2);
    const w = small ? 2048 : 4096;
    const h = Math.round((w * this.groundRect.w) / this.groundRect.z / 4) * 4;
    this.ground = new THREE.WebGLRenderTarget(w, Math.max(256, h), { type: small ? THREE.UnsignedByteType : THREE.HalfFloatType, depthBuffer: false, generateMipmaps: false });
    this.ground.texture.minFilter = THREE.LinearFilter;
    this.ground.texture.magFilter = THREE.LinearFilter;
    shared.uGround.value = this.ground.texture;
    shared.uGroundRect.value.copy(this.groundRect);
    this.stampCam = new THREE.OrthographicCamera(this.groundRect.x, this.groundRect.x + this.groundRect.z, this.groundRect.y + this.groundRect.w, this.groundRect.y, -10, 10);
    this.stampCam.position.set(0, 0, 5);
    const atlas = splatAtlas();
    const stampGeo = new THREE.PlaneGeometry(1, 1);
    this.stampCell = new THREE.InstancedBufferAttribute(new Float32Array(MAX_STAMPS * 2), 2).setUsage(THREE.DynamicDrawUsage);
    this.stampColor = new THREE.InstancedBufferAttribute(new Float32Array(MAX_STAMPS * 4), 4).setUsage(THREE.DynamicDrawUsage);
    stampGeo.setAttribute("aCell", this.stampCell);
    stampGeo.setAttribute("aColor", this.stampColor);
    const stampMat = new THREE.ShaderMaterial({
      uniforms: { uAtlas: { value: atlas } },
      transparent: true,
      depthTest: false,
      depthWrite: false,
      blending: THREE.CustomBlending,
      blendEquation: THREE.AddEquation,
      blendSrc: THREE.SrcAlphaFactor,
      blendDst: THREE.OneMinusSrcAlphaFactor,
      blendSrcAlpha: THREE.OneFactor,
      blendDstAlpha: THREE.OneMinusSrcAlphaFactor,
      vertexShader: /* glsl */ `
        attribute vec2 aCell;
        attribute vec4 aColor;
        varying vec2 vUv;
        varying vec4 vColor;
        varying float vDot;
        void main() {
          vDot = aCell.x < 0.0 ? 1.0 : 0.0;
          vUv = vDot > 0.5 ? uv : aCell * 0.5 + uv * 0.5;
          vColor = aColor;
          gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0);
        }`,
      fragmentShader: /* glsl */ `
        uniform sampler2D uAtlas;
        varying vec2 vUv;
        varying vec4 vColor;
        varying float vDot;
        void main() {
          float a = vDot > 0.5 ? smoothstep(0.5, 0.36, length(vUv - 0.5)) : texture2D(uAtlas, vUv).r;
          gl_FragColor = vec4(vColor.rgb, a * vColor.a);
        }`,
    });
    this.stampMesh = new THREE.InstancedMesh(stampGeo, stampMat, MAX_STAMPS);
    this.stampMesh.frustumCulled = false;
    this.stampScene.add(this.stampMesh);

    // —— the spray: glossy droplets, shell flecks and a soft mist ——
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(this.pPos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute("aColor", new THREE.BufferAttribute(this.pCol, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute("aSize", new THREE.BufferAttribute(this.pSize, 1).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute("aAlpha", new THREE.BufferAttribute(this.pAlpha, 1).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute("aKind", new THREE.BufferAttribute(this.pKind, 1).setUsage(THREE.DynamicDrawUsage));
    this.pMat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      uniforms: { uScale: { value: 400 }, uLight: { value: 1 } },
      vertexShader: /* glsl */ `
        attribute vec3 aColor;
        attribute float aSize;
        attribute float aAlpha;
        attribute float aKind;
        uniform float uScale;
        varying vec3 vColor;
        varying float vAlpha;
        varying float vKind;
        void main() {
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_Position = projectionMatrix * mv;
          gl_PointSize = max(1.5, aSize * uScale / -mv.z);
          vColor = aColor;
          vAlpha = aAlpha;
          vKind = aKind;
        }`,
      fragmentShader: /* glsl */ `
        uniform float uLight;
        varying vec3 vColor;
        varying float vAlpha;
        varying float vKind;
        void main() {
          vec2 c = gl_PointCoord - 0.5;
          float d = length(c);
          if (d > 0.5) discard;
          vec3 col;
          float a;
          if (vKind < 0.5) {
            // a droplet: a tiny lit bead with a hot highlight up and to the left
            vec3 n = vec3(c * 2.0, sqrt(max(0.0, 1.0 - 4.0 * d * d)));
            float lam = 0.45 + 0.55 * max(0.0, dot(n, normalize(vec3(-0.5, 0.6, 0.7))));
            float spec = pow(max(0.0, dot(n, normalize(vec3(-0.35, 0.45, 0.85)))), 28.0);
            col = vColor * lam * uLight + vec3(spec) * 0.9 * uLight;
            a = smoothstep(0.5, 0.42, d) * vAlpha;
          } else {
            // mist
            col = vColor * uLight;
            float soft = smoothstep(0.5, 0.0, d);
            a = soft * soft * vAlpha;
          }
          gl_FragColor = vec4(col, a);
          #include <colorspace_fragment>
        }`,
    });
    this.pts = new THREE.Points(g, this.pMat);
    this.pts.frustumCulled = false;
    this.pts.renderOrder = 2;
    this.root.add(this.pts);
  }

  /** Show the spray (or hide it again) and compile the floor stamps, so nothing compiles mid-game. */
  prewarm(on: boolean, gl: THREE.WebGLRenderer) {
    this.pts.visible = on || this.sprayed;
    if (on) gl.compile(this.stampScene, this.stampCam);
  }

  /** Something is in the air (so the shadows need redrawing). */
  get active() {
    return this.balls.length > 0;
  }

  /** Sprites sized to the viewport; dimmer at night. */
  resize(heightPx: number, fovDeg: number) {
    this.pMat.uniforms.uScale.value = heightPx / (2 * Math.tan(THREE.MathUtils.degToRad(fovDeg / 2)));
  }

  setLight(k: number) {
    this.pMat.uniforms.uLight.value = k;
  }

  /** Fire a ball from `from` with velocity `vel`. */
  fire(from: THREE.Vector3, vel: THREE.Vector3, color: number) {
    this.balls.push({ p: from.clone(), v: vel.clone(), color, age: 0, bounced: false });
    while (this.balls.length > MAX_BALLS) this.balls.shift();
  }

  /** A puff of air and vapour out of the barrel. */
  puff(at: THREE.Vector3, dir: THREE.Vector3) {
    for (let k = 0; k < 7; k++) {
      const i = this.spawn(1, 0.35 + Math.random() * 0.3, 0.25 + Math.random() * 0.3, 0.16);
      this.setP(i, at.x, at.y, at.z, dir.x * (8 + Math.random() * 10) + (Math.random() - 0.5) * 3, dir.y * (8 + Math.random() * 10) + Math.random() * 2, dir.z * (8 + Math.random() * 10) + (Math.random() - 0.5) * 3);
      this.pCol.set([0.9, 0.92, 0.95], i * 3);
      this.pColorIdx[i] = -1;
    }
  }

  /** Wash everything off (it fades, then it's gone). */
  washOff() {
    if (this.splats || this.stamps.length) this.wash = 0;
  }

  private spawn(kind: number, span: number, size: number, alpha = 1) {
    const i = this.pNext;
    this.pNext = (this.pNext + 1) % MAX_PARTICLES;
    this.pA0[i] = alpha;
    this.pKind[i] = kind;
    this.pLife[i] = 0;
    this.pSpan[i] = span;
    this.pBase[i] = size;
    return i;
  }

  private setP(i: number, x: number, y: number, z: number, vx: number, vy: number, vz: number) {
    this.pPos[i * 3] = x;
    this.pPos[i * 3 + 1] = y;
    this.pPos[i * 3 + 2] = z;
    this.pVel[i * 3] = vx;
    this.pVel[i * 3 + 1] = vy;
    this.pVel[i * 3 + 2] = vz;
  }

  /** Record a splat on one piece, in its own frame (the oldest slides off once it has six). */
  private splatPiece(id: number, cx: number, cy: number, cz: number, dx: number, dy: number, dz: number, R: number, seed: number, color: THREE.Color) {
    const row = Math.floor(id / PER_ROW);
    const base = (row * PER_ROW * TEXELS + (id % PER_ROW) * TEXELS) * 4;
    let slot = this.counts[id];
    if (slot >= SLOTS) {
      this.data.copyWithin(base, base + 12, base + SLOTS * 12);
      slot = SLOTS - 1;
    } else this.counts[id]++;
    const o = base + slot * 12;
    this.data[o] = cx;
    this.data[o + 1] = cy;
    this.data[o + 2] = cz;
    this.data[o + 3] = R;
    this.data[o + 4] = dx;
    this.data[o + 5] = dy;
    this.data[o + 6] = dz;
    this.data[o + 7] = seed;
    this.data[o + 8] = color.r;
    this.data[o + 9] = color.g;
    this.data[o + 10] = color.b;
    this.data[o + 11] = this.time;
    this.dirty = true;
  }

  /** A splat lands at `at` going `dir`: every piece it reaches gets its share, and the floor if near. */
  private splat(at: THREE.Vector3, dir: THREE.Vector3, R: number, color: THREE.Color, ph: BrickPhysics, groundY: number) {
    const seed = Math.random() * 100;
    let n = 0;
    for (let i = 0; i < this.pieces.length && n < 10; i++) {
      const p = this.pieces[i];
      if (p.special || ph.lost[i] || ph.swallowed[i]) continue;
      const px = ph.pos[i * 3];
      if (Math.abs(px - at.x) > 5 + R) continue;
      const py = ph.pos[i * 3 + 1];
      const pz = ph.pos[i * 3 + 2];
      if (Math.abs(pz - at.z) > 5 + R || Math.abs(py - at.y) > 5 + R) continue;
      // into the piece's frame
      this.q.set(ph.quat[i * 4], ph.quat[i * 4 + 1], ph.quat[i * 4 + 2], ph.quat[i * 4 + 3]).invert();
      const l = this.v.set(at.x - px, at.y - py, at.z - pz).applyQuaternion(this.q);
      const hy = (p.h * PLATE) / 2 + 0.2;
      const ox = Math.max(0, Math.abs(l.x) - p.w / 2);
      const oy = Math.max(0, Math.abs(l.y) - hy);
      const oz = Math.max(0, Math.abs(l.z) - p.d / 2);
      if (ox * ox + oy * oy + oz * oz > R * R * 0.8) continue;
      const d = this.v2.copy(dir).applyQuaternion(this.q);
      this.splatPiece(i, l.x, l.y, l.z, d.x, d.y, d.z, R, seed, color);
      n++;
    }
    // the floor: a full splat if it hit the floor, a spatter if it hit low on a wall
    const above = at.y - groundY;
    if (above < R * 0.7) {
      const k = 1 - Math.max(0, above) / (R * 0.7);
      const flat = Math.hypot(dir.x, dir.z);
      const steep = Math.abs(dir.y);
      this.stamps.push({
        x: at.x + (above > 0.05 ? dir.x / Math.max(flat, 0.01) * R * 0.3 : 0),
        z: at.z + (above > 0.05 ? dir.z / Math.max(flat, 0.01) * R * 0.3 : 0),
        size: R * 4.2 * (0.6 + 0.4 * k),
        stretch: 1 + Math.min(1.4, flat / Math.max(steep, 0.2) * 0.35),
        angle: Math.atan2(dir.z, dir.x),
        color,
        alpha: Math.min(1, k * 1.2),
        cell: Math.floor(Math.random() * 4),
      });
    }
    this.splats++;
  }

  /** The spray off a burst: droplets flung back off the surface, flecks of shell, a puff of mist. */
  private spray(at: THREE.Vector3, n: { x: number; y: number; z: number }, dir: THREE.Vector3, colorIdx: number, strength: number) {
    const color = PAINT_COLORS[colorIdx];
    const count = Math.round(18 + strength * 18);
    // a frame on the surface
    const N = this.v.set(n.x, n.y, n.z);
    const T = this.v2.set(1, 0, 0);
    if (Math.abs(N.x) > 0.9) T.set(0, 1, 0);
    T.cross(N).normalize();
    const B = this.s.crossVectors(N, T);
    // the splash leans the way the ball was going
    const along = dir.clone().addScaledVector(N, -dir.dot(N));
    for (let k = 0; k < count; k++) {
      const a = Math.random() * Math.PI * 2;
      const out = Math.random();
      const sp = 6 + Math.random() * 22 * strength;
      const lift = 0.25 + Math.random() * 0.9;
      const i = this.spawn(0, 0.5 + Math.random() * 0.8, 0.06 + Math.random() * Math.random() * 0.2);
      const vx = (T.x * Math.cos(a) + B.x * Math.sin(a)) * sp * out + N.x * sp * lift + along.x * sp * 0.6;
      const vy = (T.y * Math.cos(a) + B.y * Math.sin(a)) * sp * out + N.y * sp * lift + along.y * sp * 0.6;
      const vz = (T.z * Math.cos(a) + B.z * Math.sin(a)) * sp * out + N.z * sp * lift + along.z * sp * 0.6;
      this.setP(i, at.x + N.x * 0.1, at.y + N.y * 0.1, at.z + N.z * 0.1, vx, vy, vz);
      this.pCol.set([color.r, color.g, color.b], i * 3);
      this.pColorIdx[i] = colorIdx;
    }
    // shell flecks: a little paler (the gelatin), sharp and quick
    for (let k = 0; k < 8; k++) {
      const i = this.spawn(0, 0.35 + Math.random() * 0.4, 0.05 + Math.random() * 0.05);
      const a = Math.random() * Math.PI * 2;
      const sp = 10 + Math.random() * 16;
      this.setP(i, at.x, at.y, at.z, (T.x * Math.cos(a) + B.x * Math.sin(a) + N.x) * sp, (T.y * Math.cos(a) + B.y * Math.sin(a) + N.y) * sp, (T.z * Math.cos(a) + B.z * Math.sin(a) + N.z) * sp);
      this.pCol.set([color.r * 0.7 + 0.3, color.g * 0.7 + 0.3, color.b * 0.7 + 0.3], i * 3);
      this.pColorIdx[i] = -1;
    }
    // mist hanging in the air
    for (let k = 0; k < 9; k++) {
      const i = this.spawn(1, 0.5 + Math.random() * 0.6, 0.5 + Math.random() * 0.8, 0.2);
      const sp = 2 + Math.random() * 5;
      const a = Math.random() * Math.PI * 2;
      this.setP(i, at.x + N.x * 0.3, at.y + N.y * 0.3, at.z + N.z * 0.3, (T.x * Math.cos(a) + B.x * Math.sin(a) + N.x) * sp, (T.y * Math.cos(a) + B.y * Math.sin(a) + N.y) * sp + 0.5, (T.z * Math.cos(a) + B.z * Math.sin(a) + N.z) * sp);
      this.pCol.set([color.r, color.g, color.b], i * 3);
      this.pColorIdx[i] = -1;
    }
  }

  /** A ball meets something. Most burst; now and then one bounces off whole, as they do. */
  private impact(b: Ball, at: THREE.Vector3, normal: { x: number; y: number; z: number }, id: number, body: Parameters<BrickPhysics["splashBody"]>[0] | null, ph: BrickPhysics, groundY: number) {
    const speed = b.v.length();
    const into = -(b.v.x * normal.x + b.v.y * normal.y + b.v.z * normal.z) / Math.max(speed, 1e-4);
    if (!b.bounced && (Math.random() < 0.05 || (into < 0.22 && Math.random() < 0.6))) {
      // a bouncer: the shell holds, and off it goes (losing most of its speed)
      b.bounced = true;
      const vn = b.v.x * normal.x + b.v.y * normal.y + b.v.z * normal.z;
      b.v.set(b.v.x - 2 * vn * normal.x, b.v.y - 2 * vn * normal.y, b.v.z - 2 * vn * normal.z).multiplyScalar(0.32);
      b.p.copy(at).addScaledVector(this.v.set(normal.x, normal.y, normal.z), BALL_R * 1.05);
      this.onHit({ at: at.clone(), strength: Math.min(1, speed / BALL_SPEED), kind: "bounce" });
      return false;
    }
    const strength = Math.min(1, speed / BALL_SPEED);
    this.dir.copy(b.v).normalize();
    const color = PAINT_COLORS[b.color];
    const R = (1.7 + Math.random() * 0.9) * (0.6 + 0.4 * strength);
    this.splat(at, this.dir, R, color, ph, groundY);
    this.spray(at, normal, this.dir, b.color, strength);
    const imp = this.v.copy(this.dir).multiplyScalar(speed * 0.016);
    if (id >= 0) ph.splash(id, at, imp);
    else if (body) ph.splashBody(body, at, imp);
    this.onHit({ at: at.clone(), strength, kind: "splat" });
    return true;
  }

  /**
   * Step the balls (several sweeps a frame, so a fast one can't skip through a thin wall), the
   * spray, and anything waiting to be painted on the floor.
   */
  update(dt: number, t: number, ph: BrickPhysics, gl: THREE.WebGLRenderer) {
    dt = Math.min(dt, 0.05);
    this.time = t;
    shared.uPaintTime.value = t;
    const { x0, x1, z0, z1 } = this.bounds;
    const onPlates = (x: number, z: number) => x > x0 && x < x1 && z > z0 && z < z1;
    // weightless, the balls fly dead straight and the spray hangs in the air
    const g = ph.gravity;

    // —— balls ——
    const steps = 3;
    const h = dt / steps;
    for (let k = this.balls.length - 1; k >= 0; k--) {
      const b = this.balls[k];
      let gone = false;
      for (let s = 0; s < steps && !gone; s++) {
        const nx = b.p.x + b.v.x * h;
        const ny = b.p.y + b.v.y * h - 0.5 * g * h * h;
        const nz = b.p.z + b.v.z * h;
        const dx = nx - b.p.x;
        const dy = ny - b.p.y;
        const dz = nz - b.p.z;
        const len = Math.hypot(dx, dy, dz);
        if (len > 1e-5) {
          const d = this.dir.set(dx / len, dy / len, dz / len);
          const hit = ph.castShot(b.p, d, len + BALL_R);
          if (hit) {
            const at = this.v2.copy(b.p).addScaledVector(d, Math.max(0, hit.toi - BALL_R * 0.4)).clone();
            gone = this.impact(b, at, hit.normal, hit.id, hit.body, ph, 0);
            continue;
          }
          // past the edge of the baseplates: the table
          if (ny < TABLE_Y + BALL_R * 0.5 && !onPlates(nx, nz)) {
            const at = new THREE.Vector3(nx, TABLE_Y, nz);
            gone = this.impact(b, at, { x: 0, y: 1, z: 0 }, -3, null, ph, TABLE_Y);
            continue;
          }
        }
        b.p.set(nx, ny, nz);
        b.v.y -= g * h;
      }
      b.age += dt;
      if (gone || b.age > BALL_LIFE || b.p.y < -30) this.balls.splice(k, 1);
    }
    // drawn stretched a little along their flight, the way a fast ball blurs
    this.ballMesh.count = this.balls.length;
    this.balls.forEach((b, i) => {
      const sp = b.v.length();
      this.q.setFromUnitVectors(this.z, this.dir.copy(b.v).divideScalar(Math.max(sp, 1e-4)));
      this.s.set(1, 1, 1 + Math.min(2.2, sp * 0.012));
      this.ballMesh.setMatrixAt(i, this.m.compose(b.p, this.q, this.s));
      this.ballMesh.setColorAt(i, PAINT_COLORS[b.color]);
    });
    if (this.balls.length) {
      this.ballMesh.instanceMatrix.needsUpdate = true;
      if (this.ballMesh.instanceColor) this.ballMesh.instanceColor.needsUpdate = true;
    }

    // —— spray ——
    let alive = 0;
    const drag = Math.exp(-1.6 * dt);
    const mistDrag = Math.exp(-4.5 * dt);
    for (let i = 0; i < MAX_PARTICLES; i++) {
      if (this.pLife[i] >= this.pSpan[i]) {
        this.pAlpha[i] = 0;
        continue;
      }
      this.pLife[i] += dt;
      alive++;
      const u = this.pLife[i] / this.pSpan[i];
      const o = i * 3;
      if (this.pKind[i] < 0.5) {
        this.pVel[o] *= drag;
        this.pVel[o + 1] = this.pVel[o + 1] * drag - g * 0.8 * dt;
        this.pVel[o + 2] *= drag;
        this.pPos[o] += this.pVel[o] * dt;
        this.pPos[o + 1] += this.pVel[o + 1] * dt;
        this.pPos[o + 2] += this.pVel[o + 2] * dt;
        this.pSize[i] = this.pBase[i];
        const floor = onPlates(this.pPos[o], this.pPos[o + 2]) ? 0 : TABLE_Y;
        if (this.pPos[o + 1] < floor) {
          // a droplet lands: a dot of paint on the floor
          const ci = this.pColorIdx[i];
          if (ci >= 0 && this.stamps.length < MAX_STAMPS * 3) {
            const c = PAINT_COLORS[ci];
            this.stamps.push({ x: this.pPos[o], z: this.pPos[o + 2], size: this.pBase[i] * (1.6 + Math.random()), stretch: 1 + Math.random() * 0.6, angle: Math.atan2(this.pVel[o + 2], this.pVel[o]), color: c, alpha: 0.95, cell: DOT_CELL });
          }
          this.pLife[i] = this.pSpan[i];
          this.pAlpha[i] = 0;
          continue;
        }
        this.pAlpha[i] = this.pA0[i] * Math.min(1, (1 - u) * 4);
      } else {
        this.pVel[o] *= mistDrag;
        this.pVel[o + 1] = this.pVel[o + 1] * mistDrag + 0.3 * dt;
        this.pVel[o + 2] *= mistDrag;
        this.pPos[o] += this.pVel[o] * dt;
        this.pPos[o + 1] += this.pVel[o + 1] * dt;
        this.pPos[o + 2] += this.pVel[o + 2] * dt;
        this.pSize[i] = this.pBase[i] * (1 + u * 2.4);
        this.pAlpha[i] = this.pA0[i] * (1 - u) * (1 - u) * Math.min(1, u * 10 + 0.2);
      }
    }
    // nothing in the air (now or last frame): nothing to upload
    if (alive || this.sprayed) {
      const pg = this.pts.geometry;
      pg.attributes.position.needsUpdate = true;
      pg.attributes.aColor.needsUpdate = true;
      pg.attributes.aSize.needsUpdate = true;
      pg.attributes.aAlpha.needsUpdate = true;
      pg.attributes.aKind.needsUpdate = true;
    }
    this.sprayed = alive > 0;
    this.pts.visible = alive > 0;

    // —— washing off ——
    if (this.wash >= 0) {
      this.wash += dt / 0.9;
      shared.uPaintWash.value = Math.max(0, 1 - this.wash);
      if (this.wash >= 1) {
        this.wash = -1;
        this.data.fill(0);
        this.counts.fill(0);
        this.dirty = true;
        this.stamps.length = 0;
        this.clearGround = true;
        this.splats = 0;
        shared.uPaintWash.value = 1;
      }
    }

    if (this.dirty) {
      this.tex.needsUpdate = true;
      this.dirty = false;
    }
    this.drawGround(gl);
  }

  /** Paint whatever's landed on the floor into its texture, a batch at a time. */
  private drawGround(gl: THREE.WebGLRenderer) {
    if (!this.clearGround && !this.stamps.length) return;
    const prev = gl.getRenderTarget();
    const auto = gl.autoClear;
    const clear = gl.getClearColor(new THREE.Color());
    const clearA = gl.getClearAlpha();
    gl.setRenderTarget(this.ground);
    if (this.clearGround) {
      gl.setClearColor(0x000000, 0);
      gl.clear(true, false, false);
      this.clearGround = false;
    }
    gl.autoClear = false;
    while (this.stamps.length) {
      const batch = this.stamps.splice(0, MAX_STAMPS);
      batch.forEach((s, i) => {
        this.q.setFromAxisAngle(this.z, s.angle);
        this.s.set(s.size * s.stretch, s.size, 1);
        this.stampMesh.setMatrixAt(i, this.m.compose(this.v.set(s.x, s.z, 0), this.q, this.s));
        this.stampCell.setXY(i, s.cell === DOT_CELL ? -1 : s.cell % 2, s.cell === DOT_CELL ? 0 : Math.floor(s.cell / 2));
        this.stampColor.setXYZW(i, s.color.r, s.color.g, s.color.b, s.alpha);
      });
      this.stampMesh.count = batch.length;
      this.stampMesh.instanceMatrix.needsUpdate = true;
      this.stampCell.needsUpdate = true;
      this.stampColor.needsUpdate = true;
      gl.render(this.stampScene, this.stampCam);
    }
    gl.autoClear = auto;
    gl.setClearColor(clear, clearA);
    gl.setRenderTarget(prev);
  }

  dispose() {
    this.ballMesh.geometry.dispose();
    (this.ballMesh.material as THREE.Material).dispose();
    this.stampMesh.geometry.dispose();
    const sm = this.stampMesh.material as THREE.ShaderMaterial;
    sm.uniforms.uAtlas.value.dispose();
    sm.dispose();
    this.pts.geometry.dispose();
    this.pMat.dispose();
    this.tex.dispose();
    this.ground.dispose();
    shared.uPaint.value = empty();
    shared.uGround.value = empty();
  }
}
