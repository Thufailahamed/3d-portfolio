import * as THREE from "three";
import { mergeVertices } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { NOISE_GLSL, fbm, hash, lerp, noise, ridged, rng, smoothstep } from "./noise";
import { dirFromAzEl } from "./sky";
import { makeDetailTexture, makeNoiseTexture, type DetailKind } from "./textures";
import type { Crater, TerrainRecipe, World, WorldId } from "./worlds";

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
 * How each surface reads up close: the detail texture and its tile (m), normal strength, how much
 * of the ground is loose sand, wind ripples [wavelength m, heading rad, strength] and bedrock slabs
 * [fracture spacing m, unused, coverage, colour].
 */
type SurfaceLook = {
  detail: DetailKind;
  tile: number;
  bump: number;
  sand: number;
  ripple?: [number, number, number];
  plates?: [number, number, number, string];
};
const LOOKS: Partial<Record<WorldId, SurfaceLook>> = {
  mercury: { detail: "regolith", tile: 4.6, bump: 0.7, sand: 0 },
  moon: { detail: "regolith", tile: 4.4, bump: 0.65, sand: 0 },
  mars: { detail: "gravel", tile: 2.4, bump: 0.95, sand: 1, ripple: [0.8, 2.2, 1], plates: [2.6, 0, 0.45, "#9e7b60"] },
  earth: { detail: "gravel", tile: 2.2, bump: 0.9, sand: 0.5, ripple: [0.35, 1.2, 0.5], plates: [1.4, 0, 0.3, "#d6c6ad"] },
  venus: { detail: "basalt", tile: 2.6, bump: 0.75, sand: 0.3, plates: [1.8, 0, 0.75, "#433328"] },
  titan: { detail: "sand", tile: 2.0, bump: 0.55, sand: 1, ripple: [1.4, 1.4, 0.8] },
  pluto: { detail: "ice", tile: 7, bump: 0.45, sand: 0.2 },
};
function surfaceLook(w: World): SurfaceLook {
  return LOOKS[w.id] ?? { detail: "gravel", tile: 2.4, bump: 0.8, sand: 0.3 };
}

/**
 * One grid that follows the rover: 0.5 m spacing for the first ~30 m, then growing geometrically
 * out to ~22 km. Heights are computed in the vertex shader from the same recipe as the physics.
 */
export class TerrainMesh {
  readonly mesh: THREE.Mesh;
  readonly uniforms: Record<string, THREE.IUniform>;
  private mat: THREE.MeshStandardMaterial;
  private depth: THREE.MeshDepthMaterial;
  private detail: THREE.Texture;

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
    const look = surfaceLook(world);
    this.detail = makeDetailTexture(look.detail, quality === 0 ? 256 : 512);
    // the ground is mostly seen at grazing angles: without anisotropic filtering it smears into streaks
    if (tex.noise.anisotropy < 8) {
      tex.noise.anisotropy = 8;
      tex.noise.needsUpdate = true;
    }
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
      uDust: { value: new THREE.Color(world.soil.dustColor) },
      tNoise: { value: tex.noise },
      tDetail: { value: this.detail },
      uTile: { value: look.tile },
      uBump: { value: look.bump },
      uSandK: { value: look.sand },
      uRip: { value: new THREE.Vector3(look.ripple?.[0] ?? 1, look.ripple?.[1] ?? 0, look.ripple?.[2] ?? 0) },
      uPlate: { value: new THREE.Vector3(look.plates?.[0] ?? 1, look.plates?.[1] ?? 0, look.plates?.[2] ?? 0) },
      uPlateCol: { value: new THREE.Color(look.plates?.[3] ?? pal.bright) },
      uSunDir: { value: dirFromAzEl(world.sky.sunAz, world.sky.sunElev) },
      uFogSun: { value: world.atm.rho > 0.001 ? 0.55 : 0 },
    };
    const glsl = terrainGLSL(world.terrain);
    const U = this.uniforms;
    const defines = [look.ripple && quality > 0 ? "#define RIPPLE" : "", look.plates && quality > 0 ? "#define PLATES" : ""].join("\n");
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
${defines}
uniform vec3 uLow; uniform vec3 uHigh; uniform vec3 uSlope; uniform vec3 uDune; uniform vec3 uBright; uniform vec3 uDust;
uniform sampler2D tNoise; uniform sampler2D tDetail; uniform float uTile; uniform float uBump; uniform float uSandK;
uniform vec3 uRip; uniform vec3 uPlate; uniform vec3 uPlateCol; uniform vec3 uSunDir; uniform float uFogSun;
varying vec3 vWPos; varying vec3 vWN; varying float vDune; varying float vBright; varying float vEdge; varying float vSp;
float hshF(vec2 c, float s) { return fract(sin(dot(c, vec2(127.1, 311.7)) + s * 74.7) * 43758.5453); }
` + sh.fragmentShader
        .replace(
          "#include <color_fragment>",
          /* glsl */ `
vec3 gN = normalize(vWN);
float camD = length(vWPos - cameraPosition);
vec2 P = vWPos.xz;
// detail fades with distance so nothing tiles or shimmers on the far ground
float nearK = 1.0 - smoothstep(14.0, 70.0, camD);
float midK = 1.0 - smoothstep(40.0, 320.0, camD);
// samples at unrelated scales and rotations so the tiling never lines up
vec4 nz1 = texture2D(tNoise, mat2(0.8, 0.6, -0.6, 0.8) * P / 157.0);
vec4 nz2 = texture2D(tNoise, P / 23.0);
vec4 nz3 = texture2D(tNoise, P / 3.7);
vec4 nz4 = texture2D(tNoise, mat2(0.28, -0.96, 0.96, 0.28) * P / 1310.0);
vec4 nz5 = texture2D(tNoise, mat2(0.96, 0.28, -0.28, 0.96) * P / 61.0);
float tone = smoothstep(0.28, 0.72, nz1.r * 0.35 + nz2.g * 0.25 + nz4.a * 0.55 + nz4.r * 0.25 - 0.2);
vec3 col = mix(uLow, uHigh, tone);
// broad albedo provinces: dust-mantled bright ground and darker scoured streaks
col *= mix(0.74, 1.18, smoothstep(0.2, 0.8, nz4.g * 0.6 + nz5.a * 0.55 - 0.08));
col = mix(col, uDust, smoothstep(0.55, 0.8, nz5.r * 0.7 + nz1.a * 0.5) * 0.35);
col *= mix(0.9, 1.08, mix(nz3.b, 0.5, smoothstep(20.0, 90.0, camD)));
float slope = 1.0 - gN.y;
col = mix(col, uSlope, smoothstep(0.16, 0.42, slope + (nz2.r - 0.5) * 0.12));
col = mix(col, uDune, clamp(vDune, 0.0, 1.0) * 0.85);
col = mix(col, uBright, clamp(vBright, 0.0, 0.9));
col = mix(col, uSlope * 0.75, (1.0 - smoothstep(0.0, 0.12, vEdge)) * 0.6);

// fine sand patches: smooth, darker, rippled; everything else is gravel or bedrock
float sandM = clamp(vDune * 1.3 + smoothstep(0.56, 0.7, nz2.g * 0.7 + nz5.b * 0.55 - 0.05) * (1.0 - smoothstep(0.08, 0.25, slope)), 0.0, 1.0) * uSandK;
col = mix(col, uDune * 1.08, sandM * 0.55);
vec2 nOff = vec2(0.0);
float hB = 0.0;
float plateM = 0.0;

#ifdef PLATES
// bedrock: flat, fractured slabs poking through the soil (mudstone in Gale, basalt on Venus, salt crust)
plateM = smoothstep(0.5, 0.62, nz2.a * 0.55 + nz5.g * 0.45 + nz1.b * 0.3 + slope * 1.1 - vDune * 0.9 - sandM * 0.6 + (uPlate.z - 0.5) * 0.5);
if (plateM > 0.002 && camD < 220.0) {
  vec2 q = P / uPlate.x;
  vec2 i0 = floor(q);
  float f1 = 9.0; float f2 = 9.0; vec2 id = vec2(0.0); vec2 o1 = vec2(0.0);
  for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) {
    vec2 c = i0 + vec2(float(i), float(j));
    vec2 o = c + 0.12 + 0.76 * vec2(hshF(c, 1.0), hshF(c, 2.0));
    float d = length(q - o);
    if (d < f1) { f2 = f1; f1 = d; id = c; o1 = o; } else if (d < f2) f2 = d;
  }
  float e = (f2 - f1) * uPlate.x;
  float fw = fwidth(e);
  float crack = 1.0 - smoothstep(0.015, 0.05 + fw, e + (nz3.r - 0.5) * 0.03);
  // once a crack is thinner than a pixel it would only flicker: let it fade into the slab tone
  crack *= clamp(1.4 - fw * 18.0, 0.0, 1.0);
  float rnd = hshF(id, 3.0);
  float pf = 1.0 - smoothstep(90.0, 220.0, camD);
  // erosion leaves some slabs half-buried in drift
  float buried = smoothstep(0.35, 0.75, hshF(id, 4.0) * 0.6 + sandM * 0.8 + nz3.g * 0.4);
  float pm = plateM * (1.0 - buried * 0.85);
  vec3 pc = uPlateCol * (0.8 + 0.34 * rnd) * mix(0.92, 1.08, nz3.a);
  col = mix(col, pc, pm * (1.0 - crack));
  col = mix(col, mix(uDune, uLow, 0.4) * 0.8, pm * crack);
  // each slab tilts its own way; edges round off into the cracks
  vec2 tilt = (vec2(hshF(id, 5.0), hshF(id, 6.0)) - 0.5) * 0.22;
  nOff += tilt * pm * pf;
  hB += smoothstep(0.0, 0.12, e) * 0.045 * pm * pf;
  // fine laminae across the slab faces
  float lam = sin(dot(P, vec2(0.6, 0.8)) * 26.0 + rnd * 40.0 + nz3.b * 6.0);
  col *= 1.0 + lam * 0.035 * pm * nearK;
}
#endif

#ifdef RIPPLE
// wind ripples in the sand: steep lee face, gentle stoss slope; antialiased by fading below ~4 px
{
  vec2 rd = vec2(cos(uRip.y), sin(uRip.y));
  float ph = dot(P, rd) / uRip.x + (nz2.r - 0.5) * 7.0 + (nz5.g - 0.5) * 9.0 + (nz3.g - 0.5) * 1.2;
  float aa = 1.0 - smoothstep(0.12, 0.35, fwidth(ph));
  float fr = fract(ph);
  float prof = fr < 0.72 ? smoothstep(0.0, 0.72, fr) : 1.0 - smoothstep(0.72, 1.0, fr);
  float rm = sandM * (1.0 - plateM) * aa * uRip.z;
  hB += prof * uRip.x * 0.09 * rm;
  // coarse grains collect on the crests
  col *= 1.0 + (prof - 0.55) * 0.16 * rm;
}
#endif

// close-up surface: pebbles, pits, micro-craters, at two scales
vec2 u1 = P / uTile;
vec2 u2 = mat2(0.8, 0.6, -0.6, 0.8) * P / (uTile * 4.3);
vec4 d1 = texture2D(tDetail, u1);
vec4 d2 = texture2D(tDetail, u2);
float gravel = (1.0 - sandM * 0.75) * (1.0 - plateM * 0.7);
nOff += ((d1.xy * 2.0 - 1.0) * nearK * gravel + (d2.xy * 2.0 - 1.0) * midK * 0.7) * uBump;
col *= mix(1.0, 0.68 + 0.64 * d1.a, nearK * gravel);
col *= mix(1.0, 0.78 + 0.44 * d2.a, midK * 0.7);
// seen from the air: the same ground texture at landscape scale, so altitude never looks smeared
vec4 d3 = texture2D(tDetail, mat2(0.6, -0.8, 0.8, 0.6) * P / (uTile * 37.0));
vec4 d4 = texture2D(tDetail, mat2(-0.28, 0.96, -0.96, -0.28) * P / (uTile * 211.0));
float farK = smoothstep(30.0, 220.0, camD);
// from the air: dark sand sheets, bright dust, scoured lanes, in patches hundreds of metres across
float prov = smoothstep(0.3, 0.7, nz5.b * 0.45 + nz1.g * 0.45 + nz4.b * 0.3 - 0.1);
col = mix(col, col * mix(0.72, 1.12, prov), smoothstep(150.0, 900.0, camD));
col *= mix(1.0, (0.62 + 0.76 * d3.a) * (0.8 + 0.4 * d3.b), farK * 0.8);
col *= mix(1.0, (0.7 + 0.6 * d4.a) * (0.85 + 0.3 * d4.b), smoothstep(200.0, 1500.0, camD) * 0.75);
// cavities hold shadow
col *= mix(1.0, 0.72 + 0.56 * d1.b, nearK * gravel * 0.7) * mix(1.0, 0.82 + 0.36 * d2.b, midK * 0.5);
diffuseColor.rgb = col;
`,
        )
        .replace(
          "#include <normal_fragment_maps>",
          /* glsl */ `
{
  vec3 nW = normalize(gN + vec3(nOff.x, 0.0, nOff.y));
  normal = normalize((viewMatrix * vec4(nW, 0.0)).xyz);
  // analytic relief (ripples, slab edges) as a screen-space derivative bump
  vec3 sp = -vViewPosition;
  vec3 dpx = dFdx(sp); vec3 dpy = dFdy(sp);
  float dhx = dFdx(hB); float dhy = dFdy(hB);
  vec3 r1 = cross(dpy, normal); vec3 r2 = cross(normal, dpx);
  float det = dot(dpx, r1);
  vec3 grad = sign(det) * (dhx * r1 + dhy * r2);
  normal = normalize(abs(det) * normal - grad);
}
`,
        )
        .replace(
          "#include <fog_fragment>",
          /* glsl */ `
#if defined(USE_FOG) && defined(FOG_EXP2)
{
  // aerial perspective: the haze glows toward the Sun
  float fogF = 1.0 - exp(-fogDensity * fogDensity * vFogDepth * vFogDepth);
  vec3 vd = normalize(vWPos - cameraPosition);
  float sunA = pow(max(dot(vd, uSunDir), 0.0), 5.0);
  gl_FragColor.rgb = mix(gl_FragColor.rgb, fogColor * (1.0 + uFogSun * sunA), fogF);
}
#endif
`,
        );
    };
    this.mat.customProgramCacheKey = () => `rover-terrain-${world.id}-${quality > 0 ? 1 : 0}`;

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
    this.detail.dispose();
  }
}

type RockType = "block" | "slab" | "cobble" | "ventifact" | "breccia" | "boulder";

/** Rock shapes for each world: what an orbiter-to-Mastcam geologist would expect to find there. */
const ROCK_SETS: Partial<Record<WorldId, RockType[]>> = {
  mars: ["block", "ventifact", "slab", "boulder"],
  earth: ["block", "cobble", "slab", "boulder"],
  moon: ["breccia", "boulder", "block", "breccia"],
  mercury: ["breccia", "block", "boulder", "breccia"],
  venus: ["slab", "block", "slab", "boulder"],
  titan: ["cobble", "cobble", "boulder", "cobble"],
  pluto: ["block", "slab", "boulder", "block"],
};

/**
 * One rock, smooth-shaded: an icosphere warped by fbm, cut by fracture planes (angular blocks),
 * stepped into strata (slabs), fluted by wind (ventifacts) or knobbly with clasts (breccia).
 * The base is flattened well below y = 0 so the rock reads as bedded into the ground.
 */
function rockGeometry(seed: number, type: RockType, detail: number) {
  let geo: THREE.BufferGeometry = new THREE.IcosahedronGeometry(1, detail);
  geo.deleteAttribute("normal");
  geo.deleteAttribute("uv");
  geo = mergeVertices(geo);
  const p = geo.attributes.position as THREE.BufferAttribute;
  const v = new THREE.Vector3();
  const r = rng(seed);
  // fracture planes: a few across the top (so it is not a dome) and a ring around the sides
  const [nTop, nSide] = { block: [3, 6], slab: [1, 7], cobble: [0, 0], ventifact: [1, 5], breccia: [4, 7], boulder: [2, 3] }[type];
  const cuts: { n: THREE.Vector3; d: number }[] = [];
  for (let k = 0; k < nTop; k++) {
    const t = type === "slab" ? 0.12 : 0.35 + r() * 0.5;
    const a = r() * Math.PI * 2;
    cuts.push({ n: new THREE.Vector3(Math.cos(a) * t, 1, Math.sin(a) * t).normalize(), d: type === "slab" ? 0.3 + r() * 0.1 : 0.42 + r() * 0.28 });
  }
  for (let k = 0; k < nSide; k++) {
    const a = ((k + r() * 0.7) / nSide) * Math.PI * 2;
    cuts.push({ n: new THREE.Vector3(Math.cos(a), (r() - 0.35) * 0.6, Math.sin(a)).normalize(), d: (type === "boulder" ? 0.6 : 0.45) + r() * 0.3 });
  }
  const stretch = new THREE.Vector3(0.78 + r() * 0.5, type === "slab" ? 0.42 + r() * 0.15 : type === "cobble" ? 0.7 + r() * 0.2 : 0.85 + r() * 0.3, 0.78 + r() * 0.5);
  const wa = r() * Math.PI * 2;
  const wind = new THREE.Vector3(Math.cos(wa), 0, Math.sin(wa));
  const across = new THREE.Vector3(-wind.z, 0, wind.x);
  if (type === "ventifact") cuts.push({ n: new THREE.Vector3(wind.x, 0.7, wind.z).normalize(), d: 0.45 });
  const amp = { block: [0.16, 0.04], slab: [0.12, 0.03], cobble: [0.07, 0.015], ventifact: [0.14, 0.03], breccia: [0.18, 0.1], boulder: [0.24, 0.05] }[type];
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    const n1 = fbm(v.x * 1.7 + seed * 0.37, v.z * 1.7 + v.y * 1.3, 4, seed);
    const n2 = fbm(v.x * 4.3 - v.y * 2.1 + 3.1, v.z * 4.3 + v.y * 1.7, 3, seed + 5);
    v.multiplyScalar(1 + n1 * amp[0] + n2 * amp[1]);
    v.multiply(stretch);
    for (const c of cuts) {
      const d = v.dot(c.n);
      if (d > c.d) v.addScaledVector(c.n, (c.d - d) * (type === "boulder" ? 0.7 : 0.96));
    }
    if (type === "slab") {
      // bedding: ledges that step in toward the top
      const q = (v.y + 0.5) * 6;
      const step = (Math.floor(q) + smoothstep(0.15, 0.85, q - Math.floor(q))) / 6 - 0.5;
      v.y = lerp(v.y, step, 0.55);
      const k = 1 - 0.05 * (q - Math.floor(q));
      v.x *= k;
      v.z *= k;
    }
    if (type === "ventifact") {
      // flutes scoured along the wind
      const g = 1 - 0.045 * Math.pow(Math.abs(Math.sin(v.dot(across) * 12 + v.y * 3 + n1 * 2)), 0.6) * smoothstep(-0.1, 0.4, v.y);
      v.x *= g;
      v.z *= g;
    }
    if (v.y < -0.05) v.y = -0.05 + (v.y + 0.05) * 0.35;
    p.setXYZ(i, v.x, v.y, v.z);
  }
  geo.computeVertexNormals();
  geo.computeBoundingSphere();
  return geo;
}

/**
 * Rock material: triplanar mottling and pits, strata in the rock's own frame, the world's dust settled
 * on upward faces, and the base blended into soil where it is buried. Relief comes from a derivative bump.
 */
function rockMaterial(noise: THREE.Texture, dust: THREE.Color, dustK: number, soil: THREE.Color, sinkY: number, strata: number) {
  const mat = new THREE.MeshStandardMaterial({ color: "#ffffff", roughness: 0.86, metalness: 0 });
  const U = {
    tNoise: { value: noise },
    uDust: { value: dust },
    uDustK: { value: dustK },
    uSoil: { value: soil },
    uSinkY: { value: sinkY },
    uStrata: { value: strata },
  };
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, U);
    sh.vertexShader =
      "varying vec3 vRW; varying vec3 vRWN; varying vec3 vRL; varying float vSeed;\n" +
      sh.vertexShader.replace(
        "#include <project_vertex>",
        /* glsl */ `#include <project_vertex>
{
  vec4 rw = vec4(transformed, 1.0);
  vec3 rn = objectNormal;
  #ifdef USE_INSTANCING
    rw = instanceMatrix * rw;
    mat3 im = mat3(instanceMatrix);
    rn = im * (rn / vec3(dot(im[0], im[0]), dot(im[1], im[1]), dot(im[2], im[2])));
    vSeed = fract(sin(dot(instanceMatrix[3].xz, vec2(12.9898, 78.233))) * 43758.5453);
  #else
    vSeed = 0.37;
  #endif
  vRW = (modelMatrix * rw).xyz;
  vRWN = normalize(mat3(modelMatrix) * rn);
  vRL = position;
}`,
      );
    sh.fragmentShader =
      /* glsl */ `
uniform sampler2D tNoise; uniform vec3 uDust; uniform float uDustK; uniform vec3 uSoil; uniform float uSinkY; uniform float uStrata;
varying vec3 vRW; varying vec3 vRWN; varying vec3 vRL; varying float vSeed;
vec4 tri(vec3 p, vec3 w) { return texture2D(tNoise, p.yz) * w.x + texture2D(tNoise, p.zx) * w.y + texture2D(tNoise, p.xy) * w.z; }
` +
      sh.fragmentShader
        .replace(
          "#include <color_fragment>",
          /* glsl */ `#include <color_fragment>
vec3 bw = pow(abs(normalize(vRWN)), vec3(4.0)); bw /= dot(bw, vec3(1.0));
vec3 so = vec3(vSeed * 17.0, vSeed * 31.0, vSeed * 7.0);
vec4 tA = tri(vRW * 0.7 + so, bw);
vec4 tB = tri(vRW * 3.1 + so, bw);
vec4 tC = tri(vRW * 11.0 + so, bw);
float rDist = length(vRW - cameraPosition);
// bedding in the rock's own frame, tilted per rock
float bed = vRL.y * 9.0 + dot(vRL.xz, vec2(vSeed - 0.5, 0.3)) * 3.0 + (tA.r - 0.5) * 2.5;
float band = sin(bed * 3.1416 * 1.3) * uStrata;
vec3 rc = diffuseColor.rgb;
rc *= 0.62 + 0.62 * tA.a + (tB.g - 0.5) * 0.4;
rc = mix(rc, rc * vec3(1.12, 1.0, 0.88), smoothstep(0.4, 0.7, tA.b));
rc *= 1.0 + band * 0.1;
rc *= 0.78 + 0.44 * smoothstep(0.2, 0.8, tC.b);
// dust settled on the upward faces
float up = normalize(vRWN).y;
float dk = smoothstep(0.55, 0.95, up + (tB.b - 0.5) * 0.7 + (tA.g - 0.5) * 0.4) * uDustK;
rc = mix(rc, uDust * (0.82 + 0.36 * tB.a), dk);
// where it is buried: soil drifted against the base, and occlusion at the ground line
float base = 1.0 - smoothstep(uSinkY - 0.02, uSinkY + 0.1 + (tA.r - 0.5) * 0.14, vRL.y);
rc = mix(rc, uSoil * (0.82 + 0.36 * tB.a), base * 0.9);
rc *= mix(1.0, 0.6, (1.0 - smoothstep(uSinkY + 0.02, uSinkY + 0.3, vRL.y)) * (1.0 - base));
diffuseColor.rgb = rc;
float rockBump = (tB.r * 0.6 + tC.g * 0.35 + band * 0.08) * 0.03 * (1.0 - dk * 0.6) * (1.0 - smoothstep(12.0, 70.0, rDist));
`,
        )
        .replace("#include <roughnessmap_fragment>", "#include <roughnessmap_fragment>\nroughnessFactor = mix(0.8, 0.97, max(dk, base));")
        .replace(
          "#include <normal_fragment_maps>",
          /* glsl */ `#include <normal_fragment_maps>
{
  vec3 sp = -vViewPosition;
  vec3 dpx = dFdx(sp); vec3 dpy = dFdy(sp);
  float dhx = dFdx(rockBump); float dhy = dFdy(rockBump);
  vec3 r1 = cross(dpy, normal); vec3 r2 = cross(normal, dpx);
  float det = dot(dpx, r1);
  normal = normalize(abs(det) * normal - sign(det) * (dhx * r1 + dhy * r2));
}`,
        );
  };
  mat.customProgramCacheKey = () => "rover-rock";
  return mat;
}

/** how strongly each world's dust coats its rocks */
const ROCK_DUST: Partial<Record<WorldId, number>> = { mars: 0.38, moon: 0.4, mercury: 0.35, earth: 0.25, venus: 0.1, titan: 0.45, pluto: 0.3 };

/** Instanced rocks and pebbles around the rover in three levels of detail, rebuilt as it moves. */
export class RockField {
  readonly root = new THREE.Group();
  /** [lod][variant] */
  private big: THREE.InstancedMesh[][] = [];
  private small: THREE.InstancedMesh[] = [];
  private last = new THREE.Vector2(1e9, 1e9);
  private mats: THREE.Material[] = [];
  private geos: THREE.BufferGeometry[] = [];
  private noise: THREE.Texture;
  private seed: number;
  private static SINK = 0.22;

  constructor(
    private terrain: Terrain,
    private world: World,
    _grain: THREE.Texture,
    quality = typeof matchMedia !== "undefined" && matchMedia("(max-width: 767px), (pointer: coarse)").matches ? 0 : 2,
  ) {
    this.seed = world.terrain.seed;
    this.noise = makeNoiseTexture(128);
    const pal = world.palette;
    const soil = new THREE.Color(pal.low).lerp(new THREE.Color(pal.high), 0.5).lerp(new THREE.Color(world.soil.dustColor), 0.3);
    const dust = new THREE.Color(world.soil.dustColor).lerp(new THREE.Color(pal.bright), 0.25);
    const strata = world.id === "mars" || world.id === "earth" || world.id === "venus" ? 1 : world.id === "pluto" ? 0.4 : 0.15;
    const mat = rockMaterial(this.noise, dust, ROCK_DUST[world.id] ?? 0.4, soil, RockField.SINK, strata);
    const pmat = rockMaterial(this.noise, dust, (ROCK_DUST[world.id] ?? 0.4) * 0.6, soil, 0.25, 0);
    this.mats.push(mat, pmat);
    const types = ROCK_SETS[world.id] ?? ["block", "boulder", "slab", "cobble"];
    const dets = quality >= 2 ? [4, 3, 2] : quality === 1 ? [3, 2, 1] : [2, 2, 1];
    const caps = [500, 900, 1600];
    for (let l = 0; l < 3; l++) {
      const row: THREE.InstancedMesh[] = [];
      for (let k = 0; k < types.length; k++) {
        const geo = rockGeometry(this.seed * 13 + k * 7, types[k], dets[l]);
        this.geos.push(geo);
        const m = new THREE.InstancedMesh(geo, mat, caps[l]);
        m.count = 0;
        m.castShadow = l < 2;
        m.receiveShadow = true;
        m.frustumCulled = false;
        row.push(m);
        this.root.add(m);
      }
      this.big.push(row);
    }
    for (let k = 0; k < 3; k++) {
      const pg = rockGeometry(this.seed + 99 + k * 31, k === 0 ? "cobble" : types[k], 1);
      this.geos.push(pg);
      const m = new THREE.InstancedMesh(pg, pmat, 2000);
      m.count = 0;
      m.frustumCulled = false;
      m.receiveShadow = true;
      m.castShadow = quality >= 2;
      this.small.push(m);
      this.root.add(m);
    }
  }

  update(x: number, z: number, force = false) {
    if (!force && Math.hypot(x - this.last.x, z - this.last.y) < 6) return;
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
    const pal = this.world.palette;
    const base = new THREE.Color(pal.rock);
    const alt = new THREE.Color(pal.slope).lerp(new THREE.Color(pal.bright), 0.35);
    const nv = this.big[0].length;
    const counts = this.big.map(() => new Array<number>(nv).fill(0));
    const R = 90;
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
        if (d > R || (r.r < 0.22 && d > 45)) continue;
        const lod = d < 16 ? 0 : d < 45 ? 1 : 2;
        const k = Math.floor(r.v * nv) % nv;
        const mesh = this.big[lod][k];
        if (counts[lod][k] >= mesh.instanceMatrix.count) continue;
        e.set((r.v - 0.5) * 0.3, r.rot, (hash(i, j, 3) - 0.5) * 0.3);
        q.setFromEuler(e);
        sc.set(r.r, r.h * 1.25, r.r);
        pos.set(r.x, t.height(r.x, r.z) - RockField.SINK * sc.y, r.z);
        m.compose(pos, q, sc);
        mesh.setMatrixAt(counts[lod][k], m);
        col.copy(base).lerp(alt, hash(i, j, 7) * hash(i, j, 8) * 0.5).multiplyScalar(0.72 + 0.45 * hash(i, j, 4));
        mesh.setColorAt(counts[lod][k], col);
        counts[lod][k]++;
      }
    this.big.forEach((row, l) =>
      row.forEach((mesh, k) => {
        mesh.count = counts[l][k];
        mesh.instanceMatrix.needsUpdate = true;
        if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      }),
    );
    // pebbles and cobbles: visual only, too small to lift a wheel
    const pn = [0, 0, 0];
    const pc = 0.6;
    const PR = 22;
    const dens = rk.pebbles * 0.6;
    const s = this.seed + 900;
    for (let j = Math.floor((z - PR) / pc); j <= Math.floor((z + PR) / pc); j++)
      for (let i = Math.floor((x - PR) / pc); i <= Math.floor((x + PR) / pc); i++) {
        if (hash(i, j, s) > dens) continue;
        const px = (i + hash(i, j, s + 1)) * pc;
        const pz = (j + hash(i, j, s + 2)) * pc;
        if (Math.hypot(px - x, pz - z) > PR) continue;
        // clumped: pebbles gather in lags between sand patches
        if (noise(px / 7, pz / 7, s + 6) + hash(i, j, s + 7) * 0.6 < 0.05) continue;
        const k = Math.floor(hash(i, j, s + 8) * 3);
        const mesh = this.small[k];
        if (pn[k] >= mesh.instanceMatrix.count) continue;
        const rr = 0.02 + 0.09 * Math.pow(hash(i, j, s + 3), 2.6);
        e.set((hash(i, j, s + 9) - 0.5) * 0.6, hash(i, j, s + 4) * 6.28, 0);
        q.setFromEuler(e);
        sc.set(rr * (0.8 + 0.4 * hash(i, j, s + 10)), rr * 0.75, rr);
        pos.set(px, t.height(px, pz) - 0.25 * sc.y, pz);
        m.compose(pos, q, sc);
        mesh.setMatrixAt(pn[k], m);
        col.copy(base).lerp(alt, hash(i, j, s + 11) * 0.6).multiplyScalar(0.7 + 0.55 * hash(i, j, s + 5));
        mesh.setColorAt(pn[k], col);
        pn[k]++;
      }
    this.small.forEach((mesh, k) => {
      mesh.count = pn[k];
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    });
  }

  dispose() {
    this.geos.forEach((g) => g.dispose());
    this.mats.forEach((m) => m.dispose());
    this.big.flat().forEach((m) => m.dispose());
    this.small.forEach((m) => m.dispose());
    this.noise.dispose();
  }
}
