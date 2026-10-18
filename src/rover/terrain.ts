import * as THREE from "three";
import { mergeVertices } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { NOISE_GLSL, fbm, hash, lerp, noise, ridged, rng, smoothstep } from "./noise";
import type { Crater, TerrainRecipe, World } from "./worlds";

/** What the physics and the scenery ask of a surface. */
export interface Ground {
  /** the bare surface (what the terrain mesh draws) */
  height(x: number, z: number): number;
  /** the surface the wheels feel: bare ground plus rocks */
  ground(x: number, z: number): number;
  normal(x: number, z: number, out: THREE.Vector3): THREE.Vector3;
  /** is there a rock under this point (no dust, no wheel prints) */
  onRock(x: number, z: number): boolean;
}

export type Rock = { x: number; z: number; r: number; h: number; rot: number; v: number };

function craterProfile(d: number, depth: number, rimK: number) {
  const rim = depth * rimK;
  if (d < 1) return Math.max((d * d - 1) * depth + rim, rim - depth * 0.7);
  const u = 1 - (d - 1) / 0.8;
  return rim * u * u * u;
}

function crater(x: number, z: number, c: Crater, s: number) {
  const C = c.cell;
  const cx = Math.floor(x / C);
  const cz = Math.floor(z / C);
  let tot = 0;
  for (let j = -1; j <= 1; j++)
    for (let i = -1; i <= 1; i++) {
      const ix = cx + i;
      const iz = cz + j;
      if (hash(ix, iz, s) > c.density) continue;
      const ox = (ix + 0.2 + 0.6 * hash(ix, iz, s + 1)) * C;
      const oz = (iz + 0.2 + 0.6 * hash(ix, iz, s + 2)) * C;
      const hr = hash(ix, iz, s + 3);
      const R = C * (0.1 + 0.32 * hr * hr);
      const dx = x - ox;
      const dz = z - oz;
      const d = Math.sqrt(dx * dx + dz * dz) / R;
      if (d >= 1.8) continue;
      const fresh = 0.35 + 0.65 * hash(ix, iz, s + 4);
      tot += craterProfile(d, c.depth, c.rim) * R * fresh;
    }
  return tot;
}

function cellEdge(qx: number, qz: number, s: number) {
  const ix = Math.floor(qx);
  const iz = Math.floor(qz);
  let f1 = 9;
  let f2 = 9;
  for (let j = -1; j <= 1; j++)
    for (let i = -1; i <= 1; i++) {
      const cx = ix + i;
      const cz = iz + j;
      const ox = cx + 0.15 + 0.7 * hash(cx, cz, s);
      const oz = cz + 0.15 + 0.7 * hash(cx, cz, s + 1);
      const d = Math.hypot(qx - ox, qz - oz);
      if (d < f1) {
        f2 = f1;
        f1 = d;
      } else if (d < f2) f2 = d;
    }
  return f2 - f1;
}

/** The procedural surface of a rocky world. Pure functions of (x, z): the same numbers the GPU draws. */
export class Terrain implements Ground {
  readonly r: TerrainRecipe;
  /** no rocks inside this circle (the landing ellipse is picked to be clear) */
  clear = { x: 0, z: 0, r: 0 };
  private rk: World["rocks"];
  private tmp: Rock = { x: 0, z: 0, r: 0, h: 0, rot: 0, v: 0 };
  private duneDir: [number, number];

  constructor(public world: World) {
    this.r = world.terrain;
    this.rk = world.rocks;
    const a = this.r.dunes?.[2] ?? 0;
    this.duneDir = [Number(Math.cos(a).toFixed(6)), Number(Math.sin(a).toFixed(6))];
  }

  height(x: number, z: number): number {
    const r = this.r;
    const s = r.seed;
    let h = r.base[0] * fbm(x / r.base[1], z / r.base[1], 5, s);
    if (r.terrace) {
      const T = r.terrace;
      const q = h / T;
      const fl = Math.floor(q);
      h = lerp(h, (fl + smoothstep(0.3, 0.7, q - fl)) * T, 0.75);
    }
    if (r.hills[0] > 0) {
      const d0 = Math.sqrt(x * x + z * z);
      const m = smoothstep(350, 1600, d0) * smoothstep(-0.35, 0.45, noise(x / (r.hills[1] * 2.7), z / (r.hills[1] * 2.7), s + 40));
      if (m > 0) h += r.hills[0] * m * ridged(x / r.hills[1], z / r.hills[1], 5, s + 20);
    }
    if (r.dunes) {
      const [A, L, , cov] = r.dunes;
      const warp = 0.35 * noise(x / (L * 3.1), z / (L * 3.1), s + 70);
      let t = (x * this.duneDir[0] + z * this.duneDir[1]) / L + warp;
      t -= Math.floor(t);
      const prof = t < 0.78 ? smoothstep(0, 0.78, t) : 1 - smoothstep(0.78, 1, t);
      const mask = smoothstep(0.25, 0.65, 0.5 + 0.5 * noise(x / (L * 7), z / (L * 7), s + 71) + (cov - 0.5));
      h += A * prof * mask;
    }
    if (r.craters) for (let k = 0; k < r.craters.length; k++) h += crater(x, z, r.craters[k], s + 100 + k * 10);
    if (r.cells) {
      const [A, S] = r.cells;
      const e = cellEdge(x / S, z / S, s + 90);
      h += -A * (1 - smoothstep(0, 0.16, e)) + A * 0.35 * smoothstep(0.1, 0.6, e);
    }
    h += r.detail[0] * fbm(x / r.detail[1], z / r.detail[1], 2, s + 60);
    if (r.landmark) {
      const [lx, lz, R, H] = r.landmark;
      const dx = x - lx;
      const dz = z - lz;
      const q = (dx * dx + dz * dz) / (R * R);
      if (q < 9) h += H * Math.exp(-q) * (0.7 + 0.6 * fbm(x / (R * 0.45), z / (R * 0.45), 4, s + 80));
    }
    return h;
  }

  /** the rock (if any) seeded in lattice cell (i, j); written into a shared scratch object */
  rockAt(i: number, j: number, out: Rock = this.tmp): Rock | null {
    const rk = this.rk;
    if (rk.density <= 0) return null;
    const s = this.r.seed + 500;
    if (hash(i, j, s) > rk.density) return null;
    const u = hash(i, j, s + 1);
    const rad = rk.minR + (rk.maxR - rk.minR) * Math.pow(u, rk.power);
    const x = (i + 0.15 + 0.7 * hash(i, j, s + 2)) * rk.cell;
    const z = (j + 0.15 + 0.7 * hash(i, j, s + 3)) * rk.cell;
    const c = this.clear;
    if (c.r > 0) {
      const dx = x - c.x;
      const dz = z - c.z;
      if (dx * dx + dz * dz < (c.r + rad) * (c.r + rad)) return null;
    }
    out.x = x;
    out.z = z;
    out.r = rad;
    out.h = rad * rk.flat * (0.7 + 0.6 * hash(i, j, s + 4));
    out.rot = hash(i, j, s + 5) * Math.PI * 2;
    out.v = hash(i, j, s + 6);
    return out;
  }

  rockBump(x: number, z: number): number {
    const c = this.rk.cell;
    if (this.rk.density <= 0) return 0;
    const ix = Math.floor(x / c);
    const iz = Math.floor(z / c);
    let best = 0;
    for (let j = -1; j <= 1; j++)
      for (let i = -1; i <= 1; i++) {
        const r = this.rockAt(ix + i, iz + j);
        if (!r) continue;
        const dx = x - r.x;
        const dz = z - r.z;
        const q = (dx * dx + dz * dz) / (r.r * r.r);
        if (q < 1) best = Math.max(best, r.h * Math.sqrt(1 - q));
      }
    return best;
  }

  ground(x: number, z: number) {
    return this.height(x, z) + this.rockBump(x, z);
  }

  onRock(x: number, z: number) {
    return this.rockBump(x, z) > 0.03;
  }

  normal(x: number, z: number, out: THREE.Vector3) {
    const e = 0.15;
    const h0 = this.ground(x, z);
    return out.set(h0 - this.ground(x + e, z), e, h0 - this.ground(x, z + e)).normalize();
  }

  /** the flattest spot near (x, z), clear of big rocks — where the sky crane will set down */
  findLandingSite(x: number, z: number, radius: number) {
    const r = rng(this.r.seed * 7 + 3);
    let best = { x, z, score: Infinity };
    for (let k = 0; k < 90; k++) {
      const a = r() * Math.PI * 2;
      const d = Math.sqrt(r()) * radius;
      const px = x + Math.cos(a) * d;
      const pz = z + Math.sin(a) * d;
      let slope = 0;
      for (const [ox, oz] of [[0, 0], [3, 0], [-3, 0], [0, 3], [0, -3]]) {
        const hx = this.height(px + ox + 1, pz + oz) - this.height(px + ox - 1, pz + oz);
        const hz = this.height(px + ox, pz + oz + 1) - this.height(px + ox, pz + oz - 1);
        slope += Math.hypot(hx, hz) / 2;
      }
      const score = slope + d * 0.0015;
      if (score < best.score) best = { x: px, z: pz, score };
    }
    return best;
  }
}

const f = (n: number) => {
  const s = n.toFixed(6);
  return s.includes(".") ? s : `${s}.0`;
};

/** The same surface as `Terrain.height`, as GLSL; drops detail finer than the local mesh spacing. */
export function terrainGLSL(r: TerrainRecipe) {
  const s = r.seed;
  const lines: string[] = [];
  lines.push(`float h = ${f(r.base[0])} * fbmL(p / ${f(r.base[1])}, 5, ${s}, ${f(r.base[1])}, sp);`);
  if (r.terrace) {
    const T = f(r.terrace);
    lines.push(`{ float q = h / ${T}; float fl = floor(q); float wT = clamp(1.5 - sp * 0.5, 0.0, 1.0); h = mix(h, (fl + smoothstep(0.3, 0.7, q - fl)) * ${T}, 0.75 * wT); }`);
  }
  if (r.hills[0] > 0) {
    const L = f(r.hills[1]);
    lines.push(`{ float m = smoothstep(350.0, 1600.0, length(p)) * smoothstep(-0.35, 0.45, gnoise(p / (${L} * 2.7), ${s + 40}));
      if (m > 0.0) h += ${f(r.hills[0])} * m * ridgedL(p / ${L}, 5, ${s + 20}, ${L}, sp); }`);
  }
  if (r.dunes) {
    const [A, L, ang, cov] = r.dunes;
    const dx = Number(Math.cos(ang).toFixed(6));
    const dz = Number(Math.sin(ang).toFixed(6));
    lines.push(`{ float wD = clamp((${f(L)} / sp - 4.0) * 0.25, 0.0, 1.0);
      float warp = 0.35 * gnoise(p / (${f(L)} * 3.1), ${s + 70});
      float t = dot(p, vec2(${f(dx)}, ${f(dz)})) / ${f(L)} + warp; t -= floor(t);
      float prof = t < 0.78 ? smoothstep(0.0, 0.78, t) : 1.0 - smoothstep(0.78, 1.0, t);
      float mask = smoothstep(0.25, 0.65, 0.5 + 0.5 * gnoise(p / (${f(L)} * 7.0), ${s + 71}) + ${f(cov - 0.5)});
      h += ${f(A)} * prof * mask * mix(0.5, 1.0, wD); dune = mask * (0.55 + 0.45 * (1.0 - prof)); }`);
  }
  (r.craters ?? []).forEach((c, k) => {
    lines.push(`h += craterK(p, ${f(c.cell)}, ${f(c.density)}, ${f(c.depth)}, ${f(c.rim)}, ${s + 100 + k * 10}, sp, bright);`);
  });
  if (r.cells) {
    const [A, S] = r.cells;
    lines.push(`{ float wc = clamp((${f(S)} / sp - 4.0) * 0.25, 0.0, 1.0); float e = cellEdgeG(p / ${f(S)}, ${s + 90});
      h += (-${f(A)} * (1.0 - smoothstep(0.0, 0.16, e)) + ${f(A)} * 0.35 * smoothstep(0.1, 0.6, e)) * wc; edge = e; }`);
  }
  lines.push(`h += ${f(r.detail[0])} * fbmL(p / ${f(r.detail[1])}, 2, ${s + 60}, ${f(r.detail[1])}, sp);`);
  if (r.landmark) {
    const [lx, lz, R, H] = r.landmark;
    lines.push(`{ vec2 dd = p - vec2(${f(lx)}, ${f(lz)}); float q = dot(dd, dd) / ${f(R * R)};
      if (q < 9.0) h += ${f(H)} * exp(-q) * (0.7 + 0.6 * fbmL(p / ${f(R * 0.45)}, 4, ${s + 80}, ${f(R * 0.45)}, sp)); }`);
  }
  return /* glsl */ `
${NOISE_GLSL}
float craterK(vec2 p, float C, float dens, float depth, float rimK, int s, float sp, inout float bright) {
  float wC = clamp((C / sp - 6.0) / 6.0, 0.0, 1.0);
  if (wC <= 0.0) return 0.0;
  vec2 c = floor(p / C);
  float tot = 0.0;
  for (int j = -uK; j <= uK; j++) for (int i = -uK; i <= uK; i++) {
    int ix = int(c.x) + i; int iz = int(c.y) + j;
    if (hsh(ix, iz, s) > dens) continue;
    vec2 o = (vec2(float(ix), float(iz)) + 0.2 + 0.6 * vec2(hsh(ix, iz, s + 1), hsh(ix, iz, s + 2))) * C;
    float hr = hsh(ix, iz, s + 3);
    float R = C * (0.1 + 0.32 * hr * hr);
    float d = length(p - o) / R;
    float fresh = 0.35 + 0.65 * hsh(ix, iz, s + 4);
    if (fresh > 0.72) bright += (fresh - 0.72) * 3.0 * (1.0 - smoothstep(1.0, 2.4, d)) * (d < 0.9 ? 0.35 : 1.0) * wC;
    if (d >= 1.8) continue;
    float rim = depth * rimK;
    float v;
    if (d < 1.0) v = max((d * d - 1.0) * depth + rim, rim - depth * 0.7);
    else { float u = 1.0 - (d - 1.0) / 0.8; v = rim * u * u * u; }
    tot += v * R * fresh;
  }
  return tot * wC;
}
float cellEdgeG(vec2 q, int s) {
  vec2 i0 = floor(q);
  float f1 = 9.0; float f2 = 9.0;
  for (int j = -uK; j <= uK; j++) for (int i = -uK; i <= uK; i++) {
    int cx = int(i0.x) + i; int cz = int(i0.y) + j;
    vec2 o = vec2(float(cx), float(cz)) + 0.15 + 0.7 * vec2(hsh(cx, cz, s), hsh(cx, cz, s + 1));
    float d = length(q - o);
    if (d < f1) { f2 = f1; f1 = d; } else if (d < f2) f2 = d;
  }
  return f2 - f1;
}
float terrainHeight(vec2 p, float sp, out float dune, out float bright, out float edge) {
  dune = 0.0; bright = 0.0; edge = 1.0;
  ${lines.join("\n  ")}
  return h;
}
`;
}

export type TerrainTextures = { noise: THREE.Texture; grain: THREE.Texture };

/**
 * One grid that follows the rover: 0.5 m spacing for the first ~30 m, then growing geometrically
 * out to ~22 km. Heights are computed in the vertex shader from the same recipe as the physics.
 */
export class TerrainMesh {
  readonly mesh: THREE.Mesh;
  readonly uniforms: Record<string, THREE.IUniform>;
  private mat: THREE.MeshStandardMaterial;
  private depth: THREE.MeshDepthMaterial;

  constructor(world: World, quality: number, tex: TerrainTextures) {
    const half = quality >= 2 ? 176 : quality === 1 ? 150 : 112;
    const core = quality === 0 ? 44 : 60;
    const s0 = 0.5;
    const reach = 22000;
    // growth rate so the outer ring lands at `reach`
    let lo = 1.0001;
    let hi = 1.5;
    const outer = half - core;
    for (let k = 0; k < 60; k++) {
      const g = (lo + hi) / 2;
      const d = core * s0 + (s0 * (Math.pow(g, outer) - 1)) / (g - 1);
      if (d > reach) hi = g;
      else lo = g;
    }
    const g = (lo + hi) / 2;
    const off = new Float32Array(half + 1);
    const sp = new Float32Array(half + 1);
    for (let i = 1; i <= half; i++) {
      const step = i <= core ? s0 : s0 * Math.pow(g, i - core);
      off[i] = off[i - 1] + step;
      sp[i] = step;
    }
    sp[0] = s0;
    const n = half * 2 + 1;
    const pos = new Float32Array(n * n * 3);
    const asp = new Float32Array(n * n);
    for (let j = 0; j < n; j++)
      for (let i = 0; i < n; i++) {
        const a = i - half;
        const b = j - half;
        const k = j * n + i;
        pos[k * 3] = Math.sign(a) * off[Math.abs(a)];
        pos[k * 3 + 2] = Math.sign(b) * off[Math.abs(b)];
        asp[k] = Math.max(sp[Math.abs(a)], sp[Math.abs(b)]);
      }
    const idx = new Uint32Array((n - 1) * (n - 1) * 6);
    let t = 0;
    for (let j = 0; j < n - 1; j++)
      for (let i = 0; i < n - 1; i++) {
        const a = j * n + i;
        const b = a + 1;
        const c = a + n;
        const d = c + 1;
        // alternate the diagonal so the coarse rings don't streak
        if ((i + j) % 2 === 0) {
          idx[t++] = a; idx[t++] = c; idx[t++] = b;
          idx[t++] = b; idx[t++] = c; idx[t++] = d;
        } else {
          idx[t++] = a; idx[t++] = c; idx[t++] = d;
          idx[t++] = a; idx[t++] = d; idx[t++] = b;
        }
      }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    geo.setAttribute("aSp", new THREE.BufferAttribute(asp, 1));
    geo.setIndex(new THREE.BufferAttribute(idx, 1));
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e7);

    const pal = world.palette;
    this.uniforms = {
      uK: { value: 1 },
      uCenter: { value: new THREE.Vector2() },
      uEye: { value: new THREE.Vector3() },
      uInvR2: { value: 1 / (2 * world.radiusKm * 1000) },
      uLow: { value: new THREE.Color(pal.low) },
      uHigh: { value: new THREE.Color(pal.high) },
      uSlope: { value: new THREE.Color(pal.slope) },
      uDune: { value: new THREE.Color(pal.dune) },
      uBright: { value: new THREE.Color(pal.bright) },
      tNoise: { value: tex.noise },
      tGrain: { value: tex.grain },
      uDetailK: { value: world.id === "pluto" ? 0.25 : world.id === "titan" ? 0.45 : 0.6 },
    };
    const glsl = terrainGLSL(world.terrain);
    const U = this.uniforms;
    const head = /* glsl */ `
uniform vec2 uCenter; uniform vec3 uEye; uniform float uInvR2;
attribute float aSp;
varying vec3 vWPos; varying vec3 vWN; varying float vDune; varying float vBright; varying float vEdge; varying float vSp;
${glsl}
`;
    const vertexBody = /* glsl */ `
vec2 wp = position.xz + uCenter;
float dn = 0.0; float br = 0.0; float ce = 1.0;
float ee = max(aSp, 0.3);
// three samples (here, +x, +z) in one non-unrollable loop: the height function is emitted once,
// which keeps shader compile time on Windows/D3D to a couple of seconds instead of ten
float hs[3];
for (int k = 0; k < 3 * uK; k++) {
  vec2 q = wp + (k == 1 ? vec2(ee, 0.0) : k == 2 ? vec2(0.0, ee) : vec2(0.0));
  float d1; float b1; float c1;
  hs[k] = terrainHeight(q, aSp, d1, b1, c1);
  if (k == 0) { dn = d1; br = b1; ce = c1; }
}
float h0 = hs[0];
vec3 objectNormal = normalize(vec3(h0 - hs[1], ee, h0 - hs[2]));
vWN = objectNormal; vDune = dn; vBright = br; vEdge = ce; vSp = aSp;
vec2 ed = wp - uEye.xz;
vec3 tPos = vec3(wp.x, h0 - dot(ed, ed) * uInvR2, wp.y);
vWPos = tPos;
`;
    this.mat = new THREE.MeshStandardMaterial({ roughness: 0.97, metalness: 0 });
    this.mat.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, U);
      sh.vertexShader = head + sh.vertexShader.replace("#include <beginnormal_vertex>", vertexBody).replace("#include <begin_vertex>", "vec3 transformed = tPos;");
      sh.fragmentShader = /* glsl */ `
uniform vec3 uLow; uniform vec3 uHigh; uniform vec3 uSlope; uniform vec3 uDune; uniform vec3 uBright;
uniform sampler2D tNoise; uniform sampler2D tGrain; uniform float uDetailK;
varying vec3 vWPos; varying vec3 vWN; varying float vDune; varying float vBright; varying float vEdge; varying float vSp;
` + sh.fragmentShader
        .replace(
          "#include <color_fragment>",
          /* glsl */ `
vec3 gN = normalize(vWN);
float camD = length(vWPos - cameraPosition);
// samples at unrelated scales and rotations so the tiling never lines up
vec4 nz1 = texture2D(tNoise, mat2(0.8, 0.6, -0.6, 0.8) * vWPos.xz / 157.0);
vec4 nz2 = texture2D(tNoise, vWPos.xz / 23.0);
vec4 nz3 = texture2D(tNoise, vWPos.xz / 3.7);
vec4 nz4 = texture2D(tNoise, mat2(0.28, -0.96, 0.96, 0.28) * vWPos.xz / 1310.0);
float tone = smoothstep(0.28, 0.72, nz1.r * 0.35 + nz2.g * 0.25 + nz4.a * 0.55 + nz4.r * 0.25 - 0.2);
vec3 col = mix(uLow, uHigh, tone);
col *= mix(0.86, 1.12, mix(nz3.b, 0.5, smoothstep(20.0, 90.0, camD)));
float slope = 1.0 - gN.y;
col = mix(col, uSlope, smoothstep(0.16, 0.42, slope + (nz2.r - 0.5) * 0.12));
col = mix(col, uDune, clamp(vDune, 0.0, 1.0) * 0.85);
col = mix(col, uBright, clamp(vBright, 0.0, 0.9));
col = mix(col, uSlope * 0.75, (1.0 - smoothstep(0.0, 0.12, vEdge)) * 0.6);
diffuseColor.rgb = col;
`,
        )
        .replace(
          "#include <normal_fragment_maps>",
          /* glsl */ `
{
  float fade = 1.0 - smoothstep(25.0, 160.0, camD);
  vec2 u1 = vWPos.xz * 0.55;
  vec2 u2 = mat2(0.8, 0.6, -0.6, 0.8) * vWPos.xz * 0.14;
  vec2 g1 = texture2D(tGrain, u1).xy * 2.0 - 1.0;
  vec2 g2 = texture2D(tGrain, u2).xy * 2.0 - 1.0;
  vec2 dn2 = (g1 * 0.7 * fade + g2 * 0.6) * uDetailK;
  vec3 nW = normalize(gN + vec3(dn2.x, 0.0, dn2.y));
  normal = normalize((viewMatrix * vec4(nW, 0.0)).xyz);
}
`,
        );
    };
    this.mat.customProgramCacheKey = () => `rover-terrain-${world.id}`;

    this.depth = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });
    this.depth.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, U);
      sh.vertexShader =
        /* glsl */ `
uniform vec2 uCenter; uniform vec3 uEye; uniform float uInvR2;
attribute float aSp;
${glsl}
` +
        sh.vertexShader.replace(
          "#include <begin_vertex>",
          /* glsl */ `
vec2 wp = position.xz + uCenter;
float dn; float br; float ce;
float h0 = terrainHeight(wp, aSp, dn, br, ce);
vec2 ed = wp - uEye.xz;
vec3 transformed = vec3(wp.x, h0 - dot(ed, ed) * uInvR2, wp.y);
`,
        );
    };
    this.depth.customProgramCacheKey = () => `rover-terrain-depth-${world.id}`;

    this.mesh = new THREE.Mesh(geo, this.mat);
    this.mesh.customDepthMaterial = this.depth;
    this.mesh.frustumCulled = false;
    this.mesh.receiveShadow = true;
    this.mesh.castShadow = quality >= 1;
    this.mesh.matrixAutoUpdate = false;
  }

  /** keep the fine core under `focus`, snapped to the core spacing so vertices never swim */
  update(focus: THREE.Vector3, eye: THREE.Vector3) {
    const s = 0.5;
    (this.uniforms.uCenter.value as THREE.Vector2).set(Math.round(focus.x / s) * s, Math.round(focus.z / s) * s);
    (this.uniforms.uEye.value as THREE.Vector3).copy(eye);
  }

  dispose() {
    this.mesh.geometry.dispose();
    this.mat.dispose();
    this.depth.dispose();
  }
}

/** Rock geometry variants: angular fractured blocks, or rounded cobbles (Titan's water-ice pebbles). */
function rockGeometry(seed: number, rounded: boolean) {
  let geo: THREE.BufferGeometry = new THREE.IcosahedronGeometry(1, rounded ? 3 : 2);
  geo.deleteAttribute("normal");
  geo.deleteAttribute("uv");
  geo = mergeVertices(geo);
  const p = geo.attributes.position as THREE.BufferAttribute;
  const v = new THREE.Vector3();
  const r = rng(seed);
  // a few planar cuts make angular rocks look fractured
  const cuts = rounded ? [] : Array.from({ length: 5 }, () => ({ n: new THREE.Vector3(r() - 0.5, r() - 0.3, r() - 0.5).normalize(), d: 0.55 + r() * 0.3 }));
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    const n = fbm(v.x * 1.6 + seed, v.z * 1.6 + v.y * 1.3, 4, seed);
    v.multiplyScalar(1 + n * (rounded ? 0.18 : 0.42));
    for (const c of cuts) {
      const d = v.dot(c.n);
      if (d > c.d) v.addScaledVector(c.n, c.d - d);
    }
    if (v.y < -0.1) v.y *= 0.45;
    p.setXYZ(i, v.x, v.y, v.z);
  }
  geo.computeVertexNormals();
  if (!rounded) {
    const flat = geo.toNonIndexed();
    flat.computeVertexNormals();
    geo.dispose();
    geo = flat;
  }
  geo.computeBoundingSphere();
  return geo;
}

/** Instanced rocks and pebbles around the rover, rebuilt as it moves. */
export class RockField {
  readonly root = new THREE.Group();
  private big: THREE.InstancedMesh[] = [];
  private small: THREE.InstancedMesh;
  private last = new THREE.Vector2(1e9, 1e9);
  private mats: THREE.Material[] = [];
  private geos: THREE.BufferGeometry[] = [];
  private seed: number;

  constructor(
    private terrain: Terrain,
    private world: World,
    grain: THREE.Texture,
  ) {
    this.seed = world.terrain.seed;
    const rounded = world.id === "titan";
    const mat = new THREE.MeshStandardMaterial({ color: world.palette.rock, roughness: 0.9, metalness: 0, normalMap: grain, normalScale: new THREE.Vector2(0.6, 0.6) });
    this.mats.push(mat);
    for (let k = 0; k < 3; k++) {
      const geo = rockGeometry(this.seed * 13 + k * 7, rounded);
      // triplanar-ish UVs for the grain map
      const p = geo.attributes.position as THREE.BufferAttribute;
      const uv = new Float32Array(p.count * 2);
      for (let i = 0; i < p.count; i++) {
        uv[i * 2] = (p.getX(i) + p.getY(i) * 0.5) * 1.3;
        uv[i * 2 + 1] = (p.getZ(i) + p.getY(i) * 0.5) * 1.3;
      }
      geo.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
      this.geos.push(geo);
      const m = new THREE.InstancedMesh(geo, mat, 1400);
      m.count = 0;
      m.castShadow = true;
      m.receiveShadow = true;
      m.frustumCulled = false;
      this.big.push(m);
      this.root.add(m);
    }
    const pg = rockGeometry(this.seed + 99, true);
    this.geos.push(pg);
    const pm = new THREE.MeshStandardMaterial({ color: world.palette.rock, roughness: 0.95 });
    this.mats.push(pm);
    this.small = new THREE.InstancedMesh(pg, pm, 3000);
    this.small.count = 0;
    this.small.frustumCulled = false;
    this.small.receiveShadow = true;
    this.root.add(this.small);
  }

  update(x: number, z: number, force = false) {
    if (!force && Math.hypot(x - this.last.x, z - this.last.y) < 7) return;
    this.last.set(x, z);
    const rk = this.world.rocks;
    if (rk.density <= 0) return;
    const t = this.terrain;
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const e = new THREE.Euler();
    const sc = new THREE.Vector3();
    const pos = new THREE.Vector3();
    const col = new THREE.Color();
    const base = new THREE.Color(this.world.palette.rock);
    const counts = [0, 0, 0];
    const R = 82;
    const c = rk.cell;
    const i0 = Math.floor((x - R) / c);
    const i1 = Math.floor((x + R) / c);
    const j0 = Math.floor((z - R) / c);
    const j1 = Math.floor((z + R) / c);
    const rock: Rock = { x: 0, z: 0, r: 0, h: 0, rot: 0, v: 0 };
    for (let j = j0; j <= j1; j++)
      for (let i = i0; i <= i1; i++) {
        const r = t.rockAt(i, j, rock);
        if (!r) continue;
        const d = Math.hypot(r.x - x, r.z - z);
        if (d > R || (r.r < 0.22 && d > 40)) continue;
        const k = Math.floor(r.v * 3) % 3;
        const mesh = this.big[k];
        if (counts[k] >= mesh.instanceMatrix.count) continue;
        e.set((r.v - 0.5) * 0.25, r.rot, (hash(i, j, 3) - 0.5) * 0.25);
        q.setFromEuler(e);
        pos.set(r.x, t.height(r.x, r.z) - r.h * 0.05, r.z);
        sc.set(r.r, r.h, r.r);
        m.compose(pos, q, sc);
        mesh.setMatrixAt(counts[k], m);
        col.copy(base).multiplyScalar(0.8 + 0.4 * hash(i, j, 4));
        mesh.setColorAt(counts[k], col);
        counts[k]++;
      }
    this.big.forEach((mesh, k) => {
      mesh.count = counts[k];
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    });
    // pebbles: visual only, too small to lift a wheel
    let n = 0;
    const pc = 0.75;
    const PR = 20;
    const dens = rk.pebbles * 0.55;
    const s = this.seed + 900;
    for (let j = Math.floor((z - PR) / pc); j <= Math.floor((z + PR) / pc); j++)
      for (let i = Math.floor((x - PR) / pc); i <= Math.floor((x + PR) / pc); i++) {
        if (hash(i, j, s) > dens || n >= 3000) continue;
        const px = (i + hash(i, j, s + 1)) * pc;
        const pz = (j + hash(i, j, s + 2)) * pc;
        if (Math.hypot(px - x, pz - z) > PR) continue;
        const rr = 0.025 + 0.07 * Math.pow(hash(i, j, s + 3), 2);
        e.set(0, hash(i, j, s + 4) * 6.28, 0);
        q.setFromEuler(e);
        pos.set(px, t.height(px, pz) - rr * 0.15, pz);
        sc.set(rr, rr * 0.6, rr);
        m.compose(pos, q, sc);
        this.small.setMatrixAt(n, m);
        col.copy(base).multiplyScalar(0.75 + 0.5 * hash(i, j, s + 5));
        this.small.setColorAt(n, col);
        n++;
      }
    this.small.count = n;
    this.small.instanceMatrix.needsUpdate = true;
    if (this.small.instanceColor) this.small.instanceColor.needsUpdate = true;
  }

  dispose() {
    this.geos.forEach((g) => g.dispose());
    this.mats.forEach((m) => m.dispose());
    this.big.forEach((m) => m.dispose());
    this.small.dispose();
  }
}
