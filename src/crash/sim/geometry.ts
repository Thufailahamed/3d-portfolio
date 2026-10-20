/**
 * The crush grid's geometry, shared by the solver and the deformation shader (the GLSL below is the
 * same maths, kept line for line with the TypeScript so a vertex lands on the sample that crushed).
 *
 * Every body is measured from a rounded rectangle in plan, its `Plan`: half length `hx` along the
 * car's x (the nose), half width `hz` along z (the right side), corner radius `rc`, centred on
 * (`cx`, `cz`). The perimeter parameter `u` runs from 0 at the nose centre toward +z, round the
 * front-right corner, down the right side, across the tail, up the left side and back to the nose:
 *
 *   S0 front face, right half   (hx, 0) → (hx, b)          normal +x      length b
 *   S1 front-right corner        centre (a, b), φ 0 → π/2                 length q
 *   S2 right side               (a, hz) → (−a, hz)         normal +z      length 2a
 *   S3 rear-right corner         centre (−a, b), φ π/2 → π               length q
 *   S4 rear face                (−hx, b) → (−hx, −b)       normal −x      length 2b
 *   S5 rear-left corner          centre (−a, −b), φ π → 3π/2             length q
 *   S6 left side                (−a, −hz) → (a, −hz)       normal −z      length 2a
 *   S7 front-left corner         centre (a, −b), φ 3π/2 → 2π             length q
 *   S8 front face, left half    (hx, −b) → (hx, 0)         normal +x      length b
 *
 * with a = hx − rc, b = hz − rc, q = π·rc/2. A point is projected onto the face it is closest to
 * in the sense of the rectangle's medial axis (front/rear faces where |x| − a ≥ |z| − b, sides
 * otherwise, corners where both exceed their straight lengths), which keeps crush along the car's
 * structural axes: a front sample crushes straight back, a side sample straight in.
 */

import { BAND_EDGES, NB, type Plan } from "./types";

const TAU = Math.PI * 2;

export const perimeter = (p: Plan) => 4 * (p.hx - p.rc) + 4 * (p.hz - p.rc) + TAU * p.rc;

export type Projection = {
  /** perimeter parameter of the nearest boundary point, [0, 1) */
  u: number;
  /** depth inside the rectangle (m, positive inside) */
  d: number;
  /** outward normal at that boundary point, car frame (x, z) */
  nx: number;
  nz: number;
};

/** Project a car-frame point (x, z) onto the plan rectangle. */
export function project(p: Plan, x: number, z: number, out: Projection = { u: 0, d: 0, nx: 1, nz: 0 }): Projection {
  const X = x - p.cx, Z = z - p.cz;
  const a = p.hx - p.rc, b = p.hz - p.rc, q = (Math.PI * p.rc) / 2;
  const P = 4 * a + 4 * b + TAU * p.rc;
  const ax = Math.abs(X), az = Math.abs(Z);
  const qx = ax - a, qz = az - b;
  let s: number;
  if (qx > 0 && qz > 0) {
    // a corner: the angle of the point from the corner's centre
    const f = Math.atan2(qz, qx);
    const dist = Math.hypot(qx, qz);
    out.d = p.rc - dist;
    out.nx = (X >= 0 ? 1 : -1) * Math.cos(f);
    out.nz = (Z >= 0 ? 1 : -1) * Math.sin(f);
    if (X >= 0 && Z >= 0) s = b + f * p.rc;
    else if (X < 0 && Z >= 0) s = b + q + 2 * a + (Math.PI / 2 - f) * p.rc;
    else if (X < 0) s = 3 * b + 2 * q + 2 * a + f * p.rc;
    else s = 3 * b + 3 * q + 4 * a + (Math.PI / 2 - f) * p.rc;
  } else if (qx >= qz) {
    // the nose or the tail
    out.d = p.hx - ax;
    out.nx = X >= 0 ? 1 : -1;
    out.nz = 0;
    if (X >= 0) s = Z >= 0 ? Z : P + Z;
    else s = b + 2 * q + 2 * a + (b - Z);
  } else {
    // a flank
    out.d = p.hz - az;
    out.nx = 0;
    out.nz = Z >= 0 ? 1 : -1;
    s = Z >= 0 ? b + q + (a - X) : 3 * b + 3 * q + 2 * a + (X + a);
  }
  out.u = (((s / P) % 1) + 1) % 1;
  return out;
}

export type Boundary = { x: number; z: number; nx: number; nz: number };

/** The boundary point at perimeter parameter u (car frame), with its outward normal. */
export function pointAt(p: Plan, u: number, out: Boundary = { x: 0, z: 0, nx: 1, nz: 0 }): Boundary {
  const a = p.hx - p.rc, b = p.hz - p.rc, q = (Math.PI * p.rc) / 2, r = p.rc;
  const P = 4 * a + 4 * b + TAU * r;
  let s = ((((u % 1) + 1) % 1) * P);
  const arc = (cx: number, cz: number, f0: number, t: number) => {
    const f = f0 + (r > 0 ? t / r : 0);
    out.nx = Math.cos(f);
    out.nz = Math.sin(f);
    out.x = cx + r * out.nx;
    out.z = cz + r * out.nz;
  };
  const line = (x0: number, z0: number, dx: number, dz: number, t: number, nx: number, nz: number) => {
    out.x = x0 + dx * t;
    out.z = z0 + dz * t;
    out.nx = nx;
    out.nz = nz;
  };
  if (s < b) line(p.hx, 0, 0, 1, s, 1, 0);
  else if ((s -= b) < q) arc(a, b, 0, s);
  else if ((s -= q) < 2 * a) line(a, p.hz, -1, 0, s, 0, 1);
  else if ((s -= 2 * a) < q) arc(-a, b, Math.PI / 2, s);
  else if ((s -= q) < 2 * b) line(-p.hx, b, 0, -1, s, -1, 0);
  else if ((s -= 2 * b) < q) arc(-a, -b, Math.PI, s);
  else if ((s -= q) < 2 * a) line(-a, -p.hz, 1, 0, s, 0, -1);
  else if ((s -= 2 * a) < q) arc(a, -b, Math.PI * 1.5, s);
  else line(p.hx, -b, 0, 1, s - q, 1, 0);
  out.x += p.cx;
  out.z += p.cz;
  return out;
}

/** The middle of each height band (car-frame y, m). */
export const BAND_MID = Array.from({ length: NB }, (_, k) => (BAND_EDGES[k] + BAND_EDGES[k + 1]) / 2);

/** The band a height falls in, or -1 outside the grid. */
export function bandIndex(y: number) {
  if (y < BAND_EDGES[0] || y >= BAND_EDGES[NB]) return -1;
  let k = 0;
  while (y >= BAND_EDGES[k + 1]) k++;
  return k;
}

/**
 * A height as a fractional band coordinate for texture lookups: band k's middle maps to k + 0.5,
 * linear between middles, clamped to the first and last middle. Divide by NB for the texture's v.
 */
export function bandCoord(y: number) {
  if (y <= BAND_MID[0]) return 0.5;
  for (let k = 0; k < NB - 1; k++) {
    if (y < BAND_MID[k + 1]) return k + 0.5 + (y - BAND_MID[k]) / (BAND_MID[k + 1] - BAND_MID[k]);
  }
  return NB - 0.5;
}

/**
 * The same projection and band lookup in GLSL, for the deformation shader. `uPlan` is
 * (hx, hz, rc, unused) and `uPlanC` is (cx, cz); `uBandMid` holds BAND_MID.
 */
export const GEOMETRY_GLSL = /* glsl */ `
  uniform vec4 uPlan;
  uniform vec2 uPlanC;
  uniform float uBandMid[${NB}];
  // returns (u, depth inside, outward normal x, outward normal z)
  vec4 rrProject(vec2 xz) {
    float hx = uPlan.x, hz = uPlan.y, rc = uPlan.z;
    vec2 P2 = xz - uPlanC;
    float a = hx - rc, b = hz - rc, q = 1.5707963 * rc;
    float P = 4.0 * a + 4.0 * b + 6.2831853 * rc;
    float ax = abs(P2.x), az = abs(P2.y);
    float qx = ax - a, qz = az - b;
    float s, d;
    vec2 n;
    if (qx > 0.0 && qz > 0.0) {
      float f = atan(qz, qx);
      d = rc - length(vec2(qx, qz));
      n = vec2(P2.x >= 0.0 ? 1.0 : -1.0, P2.y >= 0.0 ? 1.0 : -1.0) * vec2(cos(f), sin(f));
      if (P2.x >= 0.0 && P2.y >= 0.0) s = b + f * rc;
      else if (P2.x < 0.0 && P2.y >= 0.0) s = b + q + 2.0 * a + (1.5707963 - f) * rc;
      else if (P2.x < 0.0) s = 3.0 * b + 2.0 * q + 2.0 * a + f * rc;
      else s = 3.0 * b + 3.0 * q + 4.0 * a + (1.5707963 - f) * rc;
    } else if (qx >= qz) {
      d = hx - ax;
      n = vec2(P2.x >= 0.0 ? 1.0 : -1.0, 0.0);
      if (P2.x >= 0.0) s = P2.y >= 0.0 ? P2.y : P + P2.y;
      else s = b + 2.0 * q + 2.0 * a + (b - P2.y);
    } else {
      d = hz - az;
      n = vec2(0.0, P2.y >= 0.0 ? 1.0 : -1.0);
      s = P2.y >= 0.0 ? b + q + (a - P2.x) : 3.0 * b + 3.0 * q + 2.0 * a + (P2.x + a);
    }
    return vec4(fract(s / P), d, n);
  }
  // fractional band coordinate (k + 0.5 at band k's middle) → texture v
  float bandV(float y) {
    float c = 0.5;
    if (y > uBandMid[0]) {
      c = float(${NB}) - 0.5;
      for (int k = 0; k < ${NB - 1}; k++) {
        if (y < uBandMid[k + 1]) {
          c = float(k) + 0.5 + (y - uBandMid[k]) / (uBandMid[k + 1] - uBandMid[k]);
          break;
        }
      }
    }
    return c / float(${NB});
  }
`;
