/**
 * Noise shared by the CPU (physics, rock placement) and the GPU (terrain mesh).
 * The hash is integer-exact in both, so a wheel and the ground it is drawn on see the same height.
 */

export function hash(x: number, y: number, s: number): number {
  let h = (Math.imul(x, 0x27d4eb2d) ^ Math.imul(y, 0x165667b1) ^ Math.imul(s, 0x9e3779b1)) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35) >>> 0;
  h = (h ^ (h >>> 16)) >>> 0;
  return (h >>> 8) / 16777216;
}

const R2 = 0.70710678;
const GX = [1, -1, 0, 0, R2, -R2, R2, -R2];
const GY = [0, 0, 1, -1, R2, R2, -R2, -R2];

function grad(ix: number, iy: number, s: number, fx: number, fy: number) {
  const k = Math.floor(hash(ix, iy, s) * 8);
  return GX[k] * fx + GY[k] * fy;
}

/** gradient noise, roughly −1..1 */
export function noise(x: number, y: number, s: number): number {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = x - ix;
  const fy = y - iy;
  const ux = fx * fx * fx * (fx * (fx * 6 - 15) + 10);
  const uy = fy * fy * fy * (fy * (fy * 6 - 15) + 10);
  const a = grad(ix, iy, s, fx, fy);
  const b = grad(ix + 1, iy, s, fx - 1, fy);
  const c = grad(ix, iy + 1, s, fx, fy - 1);
  const d = grad(ix + 1, iy + 1, s, fx - 1, fy - 1);
  return (a + (b - a) * ux + (c - a) * uy + (a - b - c + d) * ux * uy) * 1.4;
}

export function fbm(x: number, y: number, oct: number, s: number): number {
  let sum = 0;
  let amp = 0.5;
  let px = x;
  let py = y;
  for (let i = 0; i < oct; i++) {
    sum += amp * noise(px, py, s + i);
    const nx = 0.8 * px - 0.6 * py;
    const ny = 0.6 * px + 0.8 * py;
    px = nx * 2.03 + 11.7;
    py = ny * 2.03 - 7.3;
    amp *= 0.5;
  }
  return sum;
}

export function ridged(x: number, y: number, oct: number, s: number): number {
  let sum = 0;
  let amp = 0.5;
  let prev = 1;
  let px = x;
  let py = y;
  for (let i = 0; i < oct; i++) {
    let n = 1 - Math.abs(noise(px, py, s + i));
    n *= n;
    sum += amp * n * prev;
    prev = n;
    const nx = 0.8 * px - 0.6 * py;
    const ny = 0.6 * px + 0.8 * py;
    px = nx * 2.03 + 11.7;
    py = ny * 2.03 - 7.3;
    amp *= 0.5;
  }
  return sum;
}

export const smoothstep = (a: number, b: number, x: number) => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
export const clamp = (x: number, a: number, b: number) => (x < a ? a : x > b ? b : x);
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const damp = (a: number, b: number, rate: number, dt: number) => lerp(a, b, 1 - Math.exp(-rate * dt));

/** A small seeded PRNG for scenery that only the CPU needs. */
export function rng(seed: number) {
  let s = seed >>> 0 || 1;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** GLSL twins of the functions above (WebGL2 / GLSL ES 3.0 for the unsigned maths). */
export const NOISE_GLSL = /* glsl */ `
/* uK is always 1: loop bounds that depend on a uniform stop the D3D compiler (Windows/ANGLE) unrolling them, which otherwise takes seconds */
uniform int uK;
float hsh(int x, int y, int s) {
  uint h = (uint(x) * 0x27d4eb2du) ^ (uint(y) * 0x165667b1u) ^ (uint(s) * 0x9e3779b1u);
  h = (h ^ (h >> 15u)) * 0x85ebca6bu;
  h = (h ^ (h >> 13u)) * 0xc2b2ae35u;
  h = h ^ (h >> 16u);
  return float(h >> 8u) / 16777216.0;
}
const vec2 GRD[8] = vec2[8](vec2(1.,0.), vec2(-1.,0.), vec2(0.,1.), vec2(0.,-1.), vec2(0.70710678,0.70710678), vec2(-0.70710678,0.70710678), vec2(0.70710678,-0.70710678), vec2(-0.70710678,-0.70710678));
float grd(int ix, int iy, int s, vec2 f) { return dot(GRD[int(hsh(ix, iy, s) * 8.0)], f); }
float gnoise(vec2 p, int s) {
  vec2 i = floor(p);
  vec2 f = p - i;
  vec2 u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  int ix = int(i.x); int iy = int(i.y);
  float a = grd(ix, iy, s, f);
  float b = grd(ix + 1, iy, s, f - vec2(1., 0.));
  float c = grd(ix, iy + 1, s, f - vec2(0., 1.));
  float d = grd(ix + 1, iy + 1, s, f - vec2(1., 1.));
  return (a + (b - a) * u.x + (c - a) * u.y + (a - b - c + d) * u.x * u.y) * 1.4;
}
/* fbm that drops octaves finer than the mesh can show (sp = vertex spacing in metres) */
float fbmL(vec2 p, int oct, int s, float wl, float sp) {
  float sum = 0.0; float amp = 0.5;
  for (int i = 0; i < 8 * uK; i++) {
    if (i >= oct) break;
    float w = clamp((wl / sp - 2.0) * 0.5, 0.0, 1.0);
    if (w <= 0.0) break;
    sum += amp * w * gnoise(p, s + i);
    p = mat2(0.8, 0.6, -0.6, 0.8) * p * 2.03 + vec2(11.7, -7.3);
    amp *= 0.5; wl /= 2.03;
  }
  return sum;
}
float ridgedL(vec2 p, int oct, int s, float wl, float sp) {
  float sum = 0.0; float amp = 0.5; float prev = 1.0;
  for (int i = 0; i < 8 * uK; i++) {
    if (i >= oct) break;
    float w = clamp((wl / sp - 2.0) * 0.5, 0.0, 1.0);
    if (w <= 0.0) break;
    float n = 1.0 - abs(gnoise(p, s + i)); n *= n;
    sum += amp * w * n * prev; prev = n;
    p = mat2(0.8, 0.6, -0.6, 0.8) * p * 2.03 + vec2(11.7, -7.3);
    amp *= 0.5; wl /= 2.03;
  }
  return sum;
}
`;
