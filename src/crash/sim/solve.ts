/**
 * The crash solver: a deterministic 2.5-D crush-zone impact model.
 *
 * Every body is a rigid body in the ground plane (CG position, yaw) carrying a crush grid — NB height
 * bands × NS samples round its outline (geometry.ts) — and a structure field (structure.ts). Where a
 * sample of one body is inside another's deformed outline, their interface is two elastic–plastic
 * springs in series: elastic until the pressure reaches the weaker structure's crush strength, then
 * that structure crushes (permanently) and the pressure stays at its strength — so the softer side
 * takes the crush and the force is the same on both. Unloading is elastic, which is where the small
 * rebound of a real crash comes from; nothing imposes a restitution. Crushed metal snags (interface
 * friction), so offset and angled impacts turn the bodies. Tyres (slip-angle forces, rolling or
 * sliding, jammed when a wheel is shoved back) and half-car pitch and roll models carry them through
 * the run-out, the rear lift of a frontal test and the roll of a side impact.
 *
 * Time steps are 1 ms outside the impact and 0.1 ms through it; every force is applied equal and
 * opposite at one point, so momentum is conserved by construction, and the work of every force is
 * booked so the energy ledger can be checked.
 */
import { BAND_EDGES, NB, NO_SURFACE, NS, type BodyDef, type Burst, type Corner, type CrushTrack, type Lamp, type Pane, type Scenario, type SimEvent, type Skid, type Timeline, type Track } from "./types";
import { BAND_MID, pointAt, project } from "./geometry";
import { strengthAt, type Strength } from "./structure";
import { layout, type BodyInit, type Layout } from "./scenarios";
import { metricsOf } from "./metrics";
import { spawnDebris, type Shed } from "./debris";
import { occupant, type OccupantResult } from "./occupant";

const G = 9.81;
const DT_FINE = 1e-4, DT_PUSH = 1e-3, DT_COARSE = 1e-3;
const MU_INTERFACE = 0.5;
const MU_FLOOR = 0.8; // tyres on the hall's concrete
const MU_SLIDE = 0.7;
const CRR = 0.012;
const TPRE = 1.0; // seconds recorded before first contact
const TMAX = 8;

const CORNERS: Corner[] = ["fl", "fr", "rl", "rr"];

type Wheel = { x: number; z: number; front: boolean; steer: number; spin: number; jam: boolean; jamT: number; slide: number; N: number; skid: number[] | null; lastSkid: [number, number] };

/** A rigid part's samples: where each sample's crush front reaches the part, and the crush then. */
type RigidLink = { id: string; ks: number[]; depth: number[]; hit: Float64Array; push: number; dir: [number, number]; yaw: number; side: number; cz: number };

type Body = {
  def: BodyDef;
  fixed: boolean;
  m: number;
  Iz: number;
  // ground-plane state of the CG
  x: number;
  z: number;
  yaw: number;
  vx: number;
  vz: number;
  w: number;
  // half-car models: heave of the CG, pitch (nose down +), roll (right side down +)
  hy: number;
  vhy: number;
  th: number;
  vth: number;
  ph: number;
  vph: number;
  carrier: number | null;
  // force and moment accumulators (contact, tyres)
  fcx: number;
  fcz: number;
  tc: number;
  ftx: number;
  ftz: number;
  tt: number;
  pitchTau: number;
  rollTau: number;
  tyreLong: number;
  tyreLat: number;
  // the crush grid
  valid: Uint8Array;
  /** bands with any surface at all */
  bandHas: Uint8Array;
  px: Float32Array;
  pz: Float32Array;
  nx: Float32Array;
  nz: Float32Array;
  area: Float32Array;
  c: Float64Array;
  L: Float64Array;
  cel: Float64Array;
  /** car-frame CG (x, z) and the radius that holds every sample */
  cgx: number;
  cgz: number;
  radius: number;
  /** spacing of the samples round the outline (m) */
  ds: number;
  /** the step at which each sample last carried a contact of its own */
  touch: Int32Array;
  /** cos and sin of the yaw, refreshed each step */
  cy: number;
  sy: number;
  /** each sample's strength at its crush front, cached until the front moves 5 mm */
  sL: Float64Array;
  sSig: Float64Array;
  sEta: Float64Array;
  sMat: (Strength["material"])[];
  wheels: Wheel[];
  rigid: RigidLink[];
  /** samples whose crush front has reached the cabin, and the crush then (for intrusion) */
  cabinDepth: Float64Array;
  cabinHit: Float64Array;
  ePlastic: number;
  /** crush work the contact booked to this body this step (for splitting the step's absorbed energy) */
  bookStep: number;
  shedArea: number;
  shedX: number;
  shedZ: number;
  shedY: number;
  shedCarbon: number;
  slip: number;
  slipAt: [number, number, number];
};

const st: Strength = { sigma: 0, eta: 1, material: "trim", kind: "background" };
const st2: Strength = { sigma: 0, eta: 1, material: "trim", kind: "background" };

function makeBody(def: BodyDef, init: BodyInit): Body {
  const n = NB * NS;
  const valid = new Uint8Array(n), px = new Float32Array(n), pz = new Float32Array(n), nx = new Float32Array(n), nz = new Float32Array(n), area = new Float32Array(n);
  const bandHas = new Uint8Array(NB);
  const P = 4 * (def.plan.hx - def.plan.rc) + 4 * (def.plan.hz - def.plan.rc) + 2 * Math.PI * def.plan.rc;
  const bp = { x: 0, z: 0, nx: 0, nz: 0 };
  let radius = 0;
  for (let b = 0; b < NB; b++)
    for (let i = 0; i < NS; i++) {
      const k = b * NS + i;
      const e = def.surface[k];
      pointAt(def.plan, i / NS, bp);
      nx[k] = bp.nx;
      nz[k] = bp.nz;
      if (e >= NO_SURFACE) continue;
      valid[k] = 1;
      px[k] = bp.x - bp.nx * e;
      pz[k] = bp.z - bp.nz * e;
      area[k] = (P / NS) * (BAND_EDGES[b + 1] - BAND_EDGES[b]);
      bandHas[b] = 1;
      radius = Math.max(radius, Math.hypot(px[k] - def.cg[0], pz[k] - def.cg[2]));
    }
  const fixed = !isFinite(def.mass);
  const f = [Math.cos(init.yaw), -Math.sin(init.yaw)], r = [Math.sin(init.yaw), Math.cos(init.yaw)];
  const body: Body = {
    def,
    fixed,
    m: def.mass,
    Iz: def.Iz,
    x: init.x + def.cg[0] * f[0] + def.cg[2] * r[0],
    z: init.z + def.cg[0] * f[1] + def.cg[2] * r[1],
    yaw: init.yaw,
    vx: init.vx,
    vz: init.vz,
    w: 0,
    hy: 0,
    vhy: 0,
    th: 0,
    vth: 0,
    ph: 0,
    vph: 0,
    carrier: init.carrier,
    fcx: 0, fcz: 0, tc: 0, ftx: 0, ftz: 0, tt: 0, pitchTau: 0, rollTau: 0, tyreLong: 0, tyreLat: 0,
    valid, px, pz, nx, nz, area, bandHas,
    c: new Float64Array(n),
    L: new Float64Array(n),
    cel: new Float64Array(n),
    cgx: def.cg[0],
    cgz: def.cg[2],
    radius,
    ds: P / NS,
    touch: new Int32Array(n).fill(-10),
    cy: Math.cos(init.yaw),
    sy: Math.sin(init.yaw),
    sL: new Float64Array(n).fill(-1),
    sSig: new Float64Array(n),
    sEta: new Float64Array(n),
    sMat: new Array(n).fill("trim"),
    wheels: [],
    rigid: [],
    cabinDepth: new Float64Array(n).fill(Infinity),
    cabinHit: new Float64Array(n).fill(NaN),
    ePlastic: 0,
    bookStep: 0,
    shedArea: 0, shedX: 0, shedZ: 0, shedY: 0, shedCarbon: 0,
    slip: 0,
    slipAt: [0, 0, 0],
  };
  if (def.kind === "car" || def.kind === "mdb") {
    for (const [i, c] of CORNERS.entries()) {
      const front = i < 2, left = i % 2 === 0;
      body.wheels.push({ x: front ? def.axleF : def.axleR, z: (left ? -1 : 1) * (front ? def.halfTrackF : def.halfTrackR), front, steer: 0, spin: 0, jam: false, jamT: 0, slide: 0, N: 0, skid: null, lastSkid: [NaN, NaN] });
      void c;
    }
  }
  if (def.kind === "car") linkRigid(body);
  return body;
}

/** For each rigid part and the cabin, find the depth at which each sample's crush front reaches it. */
function linkRigid(B: Body) {
  const def = B.def;
  const n = NB * NS;
  for (const part of def.rigid) {
    const link: RigidLink = { id: part.id, ks: [], depth: [], hit: new Float64Array(0), push: 0, dir: [0, 0], yaw: 0, side: 0, cz: (part.min[2] + part.max[2]) / 2 };
    for (let k = 0; k < n; k++) {
      if (!B.valid[k]) continue;
      const y = BAND_MID[Math.floor(k / NS)];
      if (y < part.min[1] - 0.02 || y > part.max[1] + 0.02) continue;
      for (let d = 0; d < 3; d += 0.01) {
        const x = B.px[k] - B.nx[k] * d, z = B.pz[k] - B.nz[k] * d;
        if (x >= part.min[0] && x <= part.max[0] && z >= part.min[2] && z <= part.max[2]) {
          link.ks.push(k);
          link.depth.push(d);
          break;
        }
      }
    }
    link.hit = new Float64Array(link.ks.length).fill(NaN);
    B.rigid.push(link);
  }
  // the cabin cell: its bulkheads along x and its flanks
  const [c0, c1] = def.cabin ?? [def.axleR, def.axleF];
  const half = def.plan.hz - 0.18;
  for (let k = 0; k < n; k++) {
    if (!B.valid[k]) continue;
    for (let d = 0; d < 3; d += 0.01) {
      const x = B.px[k] - B.nx[k] * d, z = B.pz[k] - B.nz[k] * d;
      if (x >= c0 && x <= c1 && Math.abs(z - def.plan.cz) <= half) {
        B.cabinDepth[k] = d;
        break;
      }
    }
  }
}

// ------------------------------------------------------------------ frames

const fwd = (b: Body) => [b.cy, -b.sy] as const;
const rgt = (b: Body) => [b.sy, b.cy] as const;

/** World position of a car-frame point (x, z) of a body (ground plane, yaw only). */
function toWorld(b: Body, x: number, z: number, out: number[]) {
  const c = b.cy, s = b.sy;
  const dx = x - b.cgx, dz = z - b.cgz;
  out[0] = b.x + dx * c + dz * s;
  out[1] = b.z - dx * s + dz * c;
  return out;
}
/** Car-frame coordinates of a world point. */
function toLocal(b: Body, wx: number, wz: number, out: number[]) {
  const c = b.cy, s = b.sy;
  const dx = wx - b.x, dz = wz - b.z;
  out[0] = b.cgx + dx * c - dz * s;
  out[1] = b.cgz + dx * s + dz * c;
  return out;
}

const W1 = [0, 0], W2 = [0, 0];
const proj = { u: 0, d: 0, nx: 0, nz: 0 };
const hit = { pen: 0, k0: 0, k1: 0, wj: 0, cc: 0 };

/** Skin depth (e + c) of a body's band b at perimeter parameter u, interpolated; NaN where there is no surface. */
function skinAt(B: Body, b: number, u: number, out: typeof hit) {
  const jf = (((u % 1) + 1) % 1) * NS;
  const j0 = Math.floor(jf) % NS, j1 = (j0 + 1) % NS, w = jf - Math.floor(jf);
  const k0 = b * NS + j0, k1 = b * NS + j1;
  const v0 = B.valid[k0], v1 = B.valid[k1];
  out.k0 = k0;
  out.k1 = k1;
  out.wj = w;
  if (!v0 && !v1) return NaN;
  const e = v0 && v1 ? B.def.surface[k0] * (1 - w) + B.def.surface[k1] * w : v0 ? B.def.surface[k0] : B.def.surface[k1];
  out.cc = v0 && v1 ? B.c[k0] * (1 - w) + B.c[k1] * w : v0 ? B.c[k0] : B.c[k1];
  return e + out.cc;
}

const hx2 = { pen: 0, k0: 0, k1: 0, wj: 0, cc: 0 }, hz2 = { pen: 0, k0: 0, k1: 0, wj: 0, cc: 0 };
/**
 * Is a point (body T's frame) inside T's deformed outline at band b, and how deep? Inside means behind
 * the deformed nose or tail at the point's z AND inside the deformed flank at its x (the corners use
 * the corner's own samples); the penetration is the shallower of the two, along that face's normal.
 * Testing both faces matters once the fronts have crushed deep: a point where a nose used to be is
 * then at the deformed front, not at the flank the plain projection would pick.
 */
function inside(T: Body, b: number, X: number, Z: number, out: typeof hit): boolean {
  const p = T.def.plan;
  const x = X - p.cx, z = Z - p.cz;
  const a = p.hx - p.rc, bb = p.hz - p.rc, q = (Math.PI * p.rc) / 2, P = 4 * a + 4 * bb + 2 * Math.PI * p.rc;
  const ax = Math.abs(x), az = Math.abs(z);
  if (ax - a > 0 && az - bb > 0) {
    // a corner: its own samples, along its normal
    project(p, X, Z, proj);
    const s = skinAt(T, b, proj.u, out);
    if (Number.isNaN(s)) return false;
    out.pen = proj.d - s;
    return out.pen > 0;
  }
  // the nose or tail at this z (clamped to the face's straight part), and the flank at this x
  const zc = Math.max(-bb, Math.min(bb, z)), xc = Math.max(-a, Math.min(a, x));
  const ux = x >= 0 ? (zc >= 0 ? zc : P + zc) / P : (bb + 2 * q + 2 * a + (bb - zc)) / P;
  const uz = (z >= 0 ? bb + q + (a - xc) : 3 * bb + 3 * q + 2 * a + (xc + a)) / P;
  const sx = skinAt(T, b, ux, hx2), sz = skinAt(T, b, uz, hz2);
  const penX = Number.isNaN(sx) ? -Infinity : p.hx - ax - sx;
  const penZ = Number.isNaN(sz) ? -Infinity : p.hz - az - sz;
  // a face with no surface at this height doesn't bound the body there: the other one decides
  const bx = Number.isNaN(sx) ? Infinity : penX, bz = Number.isNaN(sz) ? Infinity : penZ;
  if (bx === Infinity && bz === Infinity) return false;
  if (Math.min(bx, bz) <= 0) return false;
  const useX = bx <= bz;
  const src = useX ? hx2 : hz2;
  out.pen = useX ? bx : bz;
  out.k0 = src.k0;
  out.k1 = src.k1;
  out.wj = src.wj;
  out.cc = src.cc;
  proj.nx = useX ? (x >= 0 ? 1 : -1) : 0;
  proj.nz = useX ? 0 : z >= 0 ? 1 : -1;
  return true;
}

/** The strength a body's sample k meets at its crush front. */
function strengthOf(B: Body, k: number, out: Strength) {
  const d = B.L[k];
  if (B.sL[k] >= 0 && Math.abs(d - B.sL[k]) < 0.005) {
    out.sigma = B.sSig[k];
    out.eta = B.sEta[k];
    out.material = B.sMat[k];
    return out;
  }
  strengthAt(B.def.zones, B.def.background, B.px[k] - B.nx[k] * d, BAND_MID[Math.floor(k / NS)], B.pz[k] - B.nz[k] * d, B.nx[k], B.nz[k], out);
  B.sL[k] = d;
  B.sSig[k] = out.sigma;
  B.sEta[k] = out.eta;
  B.sMat[k] = out.material;
  return out;
}

type Ledger = { plastic: number; friction: number; elastic: number };

/**
 * One direction of the contact between master M and target T: M's samples against T's deformed
 * outline, each carrying `share` of its area (both directions run, half each).
 */
function contactPass(M: Body, T: Body, share: number, ledger: Ledger, probe: boolean, dt = 0): boolean {
  let touched = false;
  const dxc = M.x - T.x, dzc = M.z - T.z;
  if (Math.hypot(dxc, dzc) > M.radius + T.radius + 0.05) return false;
  const n = NB * NS;
  const cT = T.cy, sT = T.sy;
  // the direction to T in M's frame: samples facing squarely away can't touch it
  toLocal(M, T.x, T.z, W2);
  const tdx = W2[0] - M.cgx, tdz = W2[1] - M.cgz, tdl = Math.hypot(tdx, tdz) || 1;
  const facingX = tdx / tdl, facingZ = tdz / tdl;
  for (let k = 0; k < n; k++) {
    if (!M.valid[k]) continue;
    const b = Math.floor(k / NS);
    if (!T.bandHas[b]) {
      k = b * NS + NS - 1;
      continue;
    }
    if (M.nx[k] * facingX + M.nz[k] * facingZ < -0.55 && tdl > M.radius * 0.5) continue;
    const ck = M.c[k];
    toWorld(M, M.px[k] - M.nx[k] * ck, M.pz[k] - M.nz[k] * ck, W1);
    const wx = W1[0], wz = W1[1];
    if ((wx - T.x) ** 2 + (wz - T.z) ** 2 > (T.radius + 0.05) ** 2) continue;
    toLocal(T, wx, wz, W2);
    if (!inside(T, b, W2[0], W2[1], hit)) continue;
    const { pen, k0, k1, wj, cc } = hit;
    const v0 = T.valid[k0], v1 = T.valid[k1];
    // the contact normal: T's outward normal at that point, in the world
    const nwx = proj.nx * cT + proj.nz * sT, nwz = -proj.nx * sT + proj.nz * cT;
    // structure meets structure face to face: a flank sample can't hold a wall in front of the nose
    // (the nose's samples do that, and the flank folds back with them), so the two outward normals
    // must oppose each other
    const mnw = M.nx[k] * M.cy + M.nz[k] * M.sy, mnz = -M.nx[k] * M.sy + M.nz[k] * M.cy;
    const facing = -(mnw * nwx + mnz * nwz);
    if (facing < 0.5) continue;
    touched = true;
    if (probe) return true;
    const kn = (v0 && v1 ? wj < 0.5 : v0) ? k0 : k1;
    M.touch[k] = stepNo;
    T.touch[k0] = T.touch[k1] = stepNo;
    const A = M.area[k] * share;
    const kM = M.def.elastic, kT = T.def.elastic;
    const ks = (kM * kT) / (kM + kT);
    // relative velocity at the contact point
    const rmx = wx - M.x, rmz = wz - M.z, rtx = wx - T.x, rtz = wz - T.z;
    const vmx = M.vx + M.w * rmz, vmz = M.vz - M.w * rmx;
    const vtx = T.vx + T.w * rtz, vtz = T.vz - T.w * rtx;
    const vrx = vmx - vtx, vrz = vmz - vtz;
    const vn = vrx * nwx + vrz * nwz;
    const vtx2 = vrx - vn * nwx, vtz2 = vrz - vn * nwz;
    const vt = Math.hypot(vtx2, vtz2);

    strengthOf(M, k, st);
    strengthOf(T, kn, st2);
    let p = ks * pen;
    let yM = st.sigma, yT = st2.sigma;
    let fPlow = 0;
    if (p > Math.min(yM, yT)) {
      // a crushing patch drags its neighbours with it (beams, panels): their resistance adds to its own
      const ex0 = pen - Math.min(yM, yT) / ks;
      if (M.def.kind === "car" && yM <= yT) yM += drag(M, k, ex0 / facing, false) / (M.area[k] * (ex0 / facing));
      else if (T.def.kind === "car" && yT < yM) yT += drag(T, kn, ex0, false) / (T.area[kn] * ex0);
      const yieldP = Math.min(yM, yT);
      if (p > yieldP) {
        const excess = pen - yieldP / ks;
        p = yieldP;
        // the part of this crush that came from sliding into fresh structure, not from closing along
        // the normal, is ploughing: resisted along the slide (capped), and that does its share of the work
        const closing = Math.min(excess, Math.max(0, -vn) * dt);
        const plough = excess - closing;
        if (plough > 0 && vt > 0.05) fPlow = Math.min((yieldP * A * plough) / (vt * dt), 3 * yieldP * A);
        // the plastic work is what the forces do on the crush: the normal force over the closing, the
        // ploughing force over the slide (the dragged neighbours' share is in the force, since their
        // resistance is in the yield)
        const work = yieldP * A * closing + fPlow * vt * dt;
        if (yM <= yT) {
          // the master's structure gives: it crushes along its own normal
          const dc = excess / facing;
          if (M.def.kind === "car") drag(M, k, dc, true);
          M.c[k] += dc;
          M.L[k] += dc / Math.max(0.02, st.eta);
          M.bookStep += work;
          shed(M, k, A * dc, wx, wz, st.material);
        } else {
          // the target gives: its outline here must stand back by the excess, so both neighbouring
          // samples are brought to at least that (a max, so neighbouring contacts don't add up)
          if (T.def.kind === "car") drag(T, kn, excess, true);
          for (const kk of [k0, k1]) {
            if (!T.valid[kk] || T.c[kk] >= cc + excess) continue;
            const d = cc + excess - T.c[kk];
            T.c[kk] += d;
            T.L[kk] += d / Math.max(0.02, st2.eta);
          }
          T.bookStep += work;
          shed(T, kn, A * excess, wx, wz, st2.material);
        }
      }
    }
    M.cel[k] = Math.max(M.cel[k], p / kM);
    T.cel[kn] = Math.max(T.cel[kn], p / kT);
    ledger.elastic += (p * p * A) / (2 * ks);
    const fn = p * A;
    const ft = (MU_INTERFACE * fn) / (vt + 0.05) + fPlow / Math.max(vt, 0.05);
    const Fx = fn * nwx - ft * vtx2, Fz = fn * nwz - ft * vtz2;
    ledger.friction += (MU_INTERFACE * fn * vt * vt * dt) / (vt + 0.05);
    applyContact(M, Fx, Fz, wx, wz, BAND_MID[b]);
    applyContact(T, -Fx, -Fz, wx, wz, BAND_MID[b]);
    if (vt > 3 && (st.material === "steel" || st.material === "aluminium" || st2.material === "steel")) {
      const s = vt * fn;
      if (s > M.slip) {
        M.slip = s;
        M.slipAt = [wx, BAND_MID[b], wz];
      }
    }
  }
  return touched;
}

/**
 * Neighbours a crushing sample drags along: a sample may lag the one beside it by about their spacing
 * and the band above or below by DRAG_V; anything that would lag more is crushed with it. Returns the
 * work that takes (their strengths × areas × crush), and commits the crush when asked.
 */
const DRAG_V = 0.12;
const OFFS: [number, number][] = [
  [0, -1], [0, 1], [0, -2], [0, 2], [0, -3], [0, 3], [0, -4], [0, 4], [0, -5], [0, 5],
  [-1, 0], [1, 0], [-1, -1], [-1, 1], [1, -1], [1, 1], [-2, 0], [2, 0],
];
/** counts the solver's steps, for the contact stamps */
let stepNo = 0;
const st3: Strength = { sigma: 0, eta: 1, material: "trim", kind: "background" };
function drag(B: Body, k: number, dc: number, commit: boolean): number {
  const b = Math.floor(k / NS), i = k % NS;
  const target = B.c[k] + dc;
  let W = 0;
  for (const [db, di] of OFFS) {
    const bb = b + db;
    if (bb < 0 || bb >= NB) continue;
    const kj = bb * NS + ((i + di + NS) % NS);
    if (!B.valid[kj] || B.nx[kj] * B.nx[k] + B.nz[kj] * B.nz[k] < 0.7) continue;
    // a neighbour bearing a contact of its own resists through it, not by being dragged
    if (B.touch[kj] >= stepNo - 1) continue;
    const need = target - (Math.abs(di) * B.ds + Math.abs(db) * DRAG_V) - B.c[kj];
    if (need <= 0) continue;
    strengthOf(B, kj, st3);
    W += st3.sigma * B.area[kj] * need;
    if (commit) {
      B.c[kj] += need;
      B.L[kj] += need / Math.max(0.02, st3.eta);
    }
  }
  return W;
}

function shed(B: Body, _k: number, amount: number, wx: number, wz: number, mat: string) {
  B.shedArea += amount;
  B.shedX += wx * amount;
  B.shedZ += wz * amount;
  B.shedY += BAND_MID[Math.floor(_k / NS)] * amount;
  if (mat === "carbon" || mat === "composite") B.shedCarbon += amount;
}

function applyContact(B: Body, Fx: number, Fz: number, wx: number, wz: number, y: number) {
  B.fcx += Fx;
  B.fcz += Fz;
  const dx = wx - B.x, dz = wz - B.z;
  B.tc += dz * Fx - dx * Fz;
  if (B.fixed) return;
  // pitch and roll moments: the force's car-frame components at the band's height, about the CG
  const [fx, fz] = fwd(B), [rx, rz] = rgt(B);
  const fl = Fx * fx + Fz * fz, fs = Fx * rx + Fz * rz;
  const h = y - (B.def.cg[1] + B.hy);
  B.pitchTau += h * fl;
  B.rollTau += h * fs;
}

// ------------------------------------------------------------------ tyres and suspension

/** After the impact the brakes come on (a test lab's onboard emergency braking; a driver's foot): from this long after separation, at this deceleration. */
const BRAKE_AFTER = 0.6, BRAKE_G = 0.4;

function tyres(B: Body, t: number, s: Scenario, dt: number, sinceSeparation: number) {
  if (B.fixed || !B.wheels.length) return;
  const onCarrier = B.carrier !== null && t < B.carrier;
  const [fx, fz] = fwd(B), [rx, rz] = rgt(B);
  const def = B.def;
  const loads = wheelLoads(B);
  for (let i = 0; i < 4; i++) {
    const wh = B.wheels[i];
    wh.N = loads[i];
    toWorld(B, wh.x, wh.z, W1);
    const dx = W1[0] - B.x, dz = W1[1] - B.z;
    const vwx = B.vx + B.w * dz, vwz = B.vz - B.w * dx;
    // the wheel's own heading: steered left (toward −z) by `steer`
    const cs = Math.cos(wh.steer), sn = Math.sin(wh.steer);
    const hx = cs * fx - sn * rx, hz = cs * fz - sn * rz;
    const sx = sn * fx + cs * rx, sz = sn * fz + cs * rz;
    const vl = vwx * hx + vwz * hz, vs = vwx * sx + vwz * sz;
    let Fx = 0, Fz = 0;
    const N = wh.N;
    if (!onCarrier && N > 0) {
      const sliding = wh.jam || (s.brakes === "locked" && t > 0.2 && def.kind === "car");
      if (sliding) {
        const v = Math.hypot(vwx, vwz);
        const f = (MU_SLIDE * N) / (v + 0.05);
        Fx = -f * vwx;
        Fz = -f * vwz;
        wh.slide = v;
      } else {
        const braking = sinceSeparation > BRAKE_AFTER ? BRAKE_G : CRR;
        const fl = (-braking * N * vl) / (Math.abs(vl) + 0.1);
        const alpha = Math.atan2(vs, Math.max(Math.abs(vl), 0.6));
        let fs = -MU_FLOOR * N * Math.tanh((16 * alpha) / MU_FLOOR);
        // the friction circle
        const tot = Math.hypot(fl, fs), cap = MU_FLOOR * N;
        if (tot > cap) fs *= cap / tot;
        Fx = fl * hx + fs * sx;
        Fz = fl * hz + fs * sz;
        wh.slide = Math.abs(vs) > 0.5 ? Math.abs(vs) : 0;
        wh.spin += (vl / def.wheelRadius) * dt;
      }
    } else if (onCarrier) {
      wh.spin += (vl / def.wheelRadius) * dt;
      wh.slide = 0;
    }
    B.ftx += Fx;
    B.ftz += Fz;
    B.tt += dz * Fx - dx * Fz;
    B.tyreLong += Fx * fx + Fz * fz;
    B.tyreLat += Fx * rx + Fz * rz;
  }
}

/** Corner loads (fl, fr, rl, rr) from the pitch and roll models; springs that would pull let the wheel lift. */
function wheelLoads(B: Body): number[] {
  const def = B.def;
  if (def.kind !== "car") {
    const q = (B.m * G) / 4;
    return [q, q, q, q];
  }
  const a = def.axleF - def.cg[0], b = def.cg[0] - def.axleR, L = a + b;
  const mf = (B.m * b) / L, mr = (B.m * a) / L;
  const kf = mf * (2 * Math.PI * 1.4) ** 2, kr = mr * (2 * Math.PI * 1.4) ** 2;
  const cf = 2 * 0.35 * Math.sqrt(kf * mf), cr = 2 * 0.35 * Math.sqrt(kr * mr);
  let Nf = mf * G + kf * (a * B.th - B.hy) + cf * (a * B.vth - B.vhy);
  let Nr = mr * G + kr * (-B.hy - b * B.th) + cr * (-B.vhy - b * B.vth);
  Nf = Math.max(0, Nf);
  Nr = Math.max(0, Nr);
  const loads = [0, 0, 0, 0];
  // roll: the springs at ±half-track (and anti-roll bars, ×1.5) transfer load across the axle
  for (const [i, N, k, c, tr] of [[0, Nf, kf, cf, def.halfTrackF], [2, Nr, kr, cr, def.halfTrackR]] as const) {
    const dN = (1.5 * k * tr * tr * B.ph + c * tr * tr * B.vph) / (2 * tr);
    loads[i] = Math.max(0, N / 2 - dN);
    loads[i + 1] = Math.max(0, N / 2 + dN);
  }
  return loads;
}

function chassis(B: Body, dt: number) {
  const def = B.def;
  if (def.kind !== "car") return;
  const loads = wheelLoads(B);
  const a = def.axleF - def.cg[0], b = def.cg[0] - def.axleR;
  const Nf = loads[0] + loads[1], Nr = loads[2] + loads[3];
  const h = def.cg[1] + B.hy;
  // heave, pitch (nose down +), roll (right side down +); the tyres' forces act at the ground
  const ay = (Nf + Nr) / B.m - G;
  const pitch = -Nf * a + Nr * b + B.pitchTau - h * B.tyreLong;
  const roll = -(loads[1] - loads[0]) * def.halfTrackF - (loads[3] - loads[2]) * def.halfTrackR + B.rollTau - h * B.tyreLat;
  B.vhy += ay * dt;
  B.vth += (pitch / def.Ipitch - 0.6 * B.vth) * dt;
  B.vph += (roll / def.Iroll - 0.6 * B.vph) * dt;
  B.hy += B.vhy * dt;
  B.th += B.vth * dt;
  B.ph += B.vph * dt;
  // the body sits on its springs: limits of the model, not of the car
  B.hy = Math.max(-0.12, Math.min(0.5, B.hy));
  B.th = Math.max(-0.5, Math.min(0.5, B.th));
  B.ph = Math.max(-0.6, Math.min(0.6, B.ph));
}

// ------------------------------------------------------------------ the run

type Rec = {
  times: number[];
  pose: number[][];
  vel: number[][];
  acc: number[][];
  wheels: number[][];
  rigid: number[][];
  force: number[][];
  snaps: { t: number; data: Float32Array[] }[];
};

/** Run a test to rest and record it. Pure and deterministic: the same scenario gives the same timeline. */
export function solveScenario(s: Scenario): Timeline {
  return solveLayout(s, layout(s));
}

/** Run a set of bodies laid out by hand (the scenario is only carried along and seeds the debris). */
export function solveLayout(s: Scenario, lay: Layout): Timeline {
  const t0 = performance.now();
  const bodies = lay.bodies.map((d, i) => makeBody(d, lay.init[i]));

  // find first contact on the undeformed outlines, then start the record TPRE before it
  const tc = firstContact(bodies);
  for (const B of bodies) {
    const back = tc - TPRE;
    B.x += B.vx * back;
    B.z += B.vz * back;
  }

  const rec: Rec = { times: [], pose: bodies.map(() => []), vel: bodies.map(() => []), acc: bodies.map(() => []), wheels: bodies.map(() => []), rigid: bodies.map(() => []), force: bodies.map(() => []), snaps: [] };
  const events: SimEvent[] = [];
  const bursts: Burst[] = [];
  const sheds: Shed[] = [];
  const fired = new Set<string>();
  const ev = (key: string, e: SimEvent) => {
    if (fired.has(key)) return;
    fired.add(key);
    events.push(e);
  };

  // the impact window's uniform buffers (0.1 ms), per body: CG velocity and acceleration (car frame),
  // the seat's acceleration, door and dash travel at the driver
  const buf = bodies.map(() => ({ vl: [] as number[], vs: [] as number[], al: [] as number[], as: [] as number[], sx: [] as number[], sz: [] as number[], door: [] as number[], dash: [] as number[] }));
  let bufStart = NaN;

  const ledger: Ledger = { plastic: 0, friction: 0, elastic: 0 };
  let wContact = 0, wTyre = 0;
  const ke = () => bodies.reduce((e, B) => (B.fixed ? e : e + 0.5 * B.m * (B.vx ** 2 + B.vz ** 2) + 0.5 * B.Iz * B.w ** 2), 0);
  const KE0 = ke();
  const p0 = bodies.reduce((p, B) => (B.fixed ? p : [p[0] + B.m * B.vx, p[1] + B.m * B.vz]), [0, 0]);
  let pBefore: number[] | null = null, pAfter: number[] | null = null, tyreImpulse = [0, 0];

  let t = -TPRE;
  let lastContact = -Infinity, firstTouch = Infinity;
  let nextRec = t, nextSnap = -0.001;
  const still = bodies.map(() => 0);
  const restAt = bodies.map(() => NaN);
  let contactNow = false;
  const accPrev = bodies.map((B) => [B.vx, B.vz, B.w]);
  const skids: Skid[] = [];
  const tcache = bodies.map(() => ({ door: 0, dash: 0, at: -1 }));
  const vAtTouch: (number[] | undefined)[] = bodies.map(() => undefined);
  let bufClosed = false;
  let lastCrushSum = 0, wasChanging = false, lastStateCheck = -Infinity;

  while (t < TMAX) {
    // the impact window: 0.1 ms steps from just before first contact to well after the last one
    // (the main pulse at 0.1 ms; a long push afterwards, cars shoved along together, at 0.5 ms)
    const fine = t > -0.05 && (lastContact === -Infinity ? t < 0.1 : t < Math.min(lastContact + 0.25, firstTouch + 0.4));
    if (!fine && !isNaN(bufStart)) bufClosed = true;
    const dt = fine ? DT_FINE : contactNow ? DT_PUSH : DT_COARSE;
    for (const B of bodies) {
      B.cy = Math.cos(B.yaw);
      B.sy = Math.sin(B.yaw);
      B.fcx = B.fcz = B.tc = B.ftx = B.ftz = B.tt = B.pitchTau = B.rollTau = B.tyreLong = B.tyreLat = 0;
      B.cel.fill(0);
      B.slip = 0;
      B.bookStep = 0;
    }
    const elasticBefore = ledger.elastic;
    const frictionBefore = ledger.friction;
    ledger.elastic = 0;
    stepNo++;
    // contact: the first body's samples (car A, or the car against a barrier) against the other's
    // deformed outline, so every patch of interface is counted once
    let touching = false;
    for (let i = 0; i < bodies.length; i++)
      for (let j = i + 1; j < bodies.length; j++) {
        if (bodies[i].fixed && bodies[j].fixed) continue;
        if (contactPass(bodies[i], bodies[j], 1, ledger, false, dt)) {
          touching = true;
          if (!fired.has(`c${i}${j}`)) {
            firstTouch = Math.min(firstTouch, t);
            const at = bodies[i].shedArea > 0 ? [bodies[i].shedX / bodies[i].shedArea, bodies[i].shedZ / bodies[i].shedArea] : [bodies[i].x, bodies[i].z];
            ev(`c${i}${j}`, { t, type: "contact", a: bodies[i].def.id, b: bodies[j].def.id, at: [at[0], at[1]] });
            bursts.push({ t, type: "dust", at: [at[0], 0.25, at[1]], dir: [0, 0.4, 0], strength: Math.min(1.5, Math.hypot(bodies[i].vx - bodies[j].vx, bodies[i].vz - bodies[j].vz) / 15), dur: 1.6 });
          }
        } else if (fired.has(`c${i}${j}`) && !fired.has(`s${i}${j}`) && t - lastContact > 0.02) {
          ev(`s${i}${j}`, { t: lastContact, type: "separate", a: bodies[i].def.id, b: bodies[j].def.id });
        }
      }
    if (touching) {
      lastContact = t;
      if (!pBefore) pBefore = p0.slice();
    }
    contactNow = touching;
    for (const B of bodies) tyres(B, t, s, dt, Number.isFinite(lastContact) && !touching ? t - lastContact : -1);

    // integrate (symplectic Euler) and book the work of contact and tyre forces at midpoint velocities
    const wContactBefore = wContact;
    for (const [bi, B] of bodies.entries()) {
      if (B.fixed) continue;
      const vx0 = B.vx, vz0 = B.vz, w0 = B.w;
      B.vx += ((B.fcx + B.ftx) / B.m) * dt;
      B.vz += ((B.fcz + B.ftz) / B.m) * dt;
      B.w += ((B.tc + B.tt) / B.Iz) * dt;
      const mx = (vx0 + B.vx) / 2, mz = (vz0 + B.vz) / 2, mw = (w0 + B.w) / 2;
      wContact += (B.fcx * mx + B.fcz * mz + B.tc * mw) * dt;
      wTyre += (B.ftx * mx + B.ftz * mz + B.tt * mw) * dt;
      // the tyres' impulse over the same window the momentum check spans (first contact to just after separation)
      if (pBefore && !pAfter) tyreImpulse = [tyreImpulse[0] + B.ftx * dt, tyreImpulse[1] + B.ftz * dt];
      B.x += B.vx * dt;
      B.z += B.vz * dt;
      B.yaw += B.w * dt;
      chassis(B, dt);
      accPrev[bi] = [vx0, vz0, w0];
    }

    // the energy the contact absorbed this step: the work its forces did, less what it stored
    // elastically and lost to friction, split between the structures by the crush work each did
    {
      const absorbed = -(wContact - wContactBefore) - (ledger.elastic - elasticBefore) - (ledger.friction - frictionBefore);
      const booked = bodies.reduce((x, B) => x + B.bookStep, 0);
      if (booked > 0) for (const B of bodies) B.ePlastic += (absorbed * B.bookStep) / booked;
      else if (absorbed !== 0) {
        // nothing crushed this step (elastic loading or spring-back): share it as the crush so far
        const so = bodies.reduce((x, B) => x + Math.max(0, B.ePlastic), 0);
        for (const B of bodies) B.ePlastic += so > 0 ? (absorbed * Math.max(0, B.ePlastic)) / so : B === bodies[0] ? absorbed : 0;
      }
      ledger.plastic += absorbed;
    }

    // the impact window's buffers (uniform 0.1 ms; closed for good once the window ends)
    if (fine && !bufClosed) {
      if (isNaN(bufStart)) bufStart = t;
      for (const [bi, B] of bodies.entries()) {
        const [fx, fz] = fwd(B), [rx, rz] = rgt(B);
        const [vx0, vz0, w0] = accPrev[bi];
        const ax = B.fixed ? 0 : (B.vx - vx0) / dt, az = B.fixed ? 0 : (B.vz - vz0) / dt, al = B.fixed ? 0 : (B.w - w0) / dt;
        const bb = buf[bi];
        bb.vl.push(B.vx * fx + B.vz * fz);
        bb.vs.push(B.vx * rx + B.vz * rz);
        bb.al.push(ax * fx + az * fz);
        bb.as.push(ax * rx + az * rz);
        // the seat: rigid-body acceleration at the H-point (tangential and centripetal terms)
        if (B.def.kind === "car") {
          toWorld(B, B.def.hPoint[0], B.def.hPoint[2], W1);
          const dx = W1[0] - B.x, dz = W1[1] - B.z;
          const sax = ax + al * dz - B.w * B.w * dx, saz = az - al * dx - B.w * B.w * dz;
          bb.sx.push(sax * fx + saz * fz);
          bb.sz.push(sax * rx + saz * rz);
          // door and dash travel change slowly: refresh every millisecond
          const tc = tcache[bi];
          if (t - tc.at >= 0.001) {
            const tr = travel(B);
            tc.door = tr.door;
            tc.dash = tr.dash;
            tc.at = t;
          }
          bb.door.push(tc.door);
          bb.dash.push(tc.dash);
        }
      }
    }

    // rigid parts, glass, lamps, airbags, jams — from the crush state, while it is changing
    if (t - lastContact < 0.01 && t - lastStateCheck >= 0.0005) {
      lastStateCheck = t;
      for (const B of bodies) {
        if (B.def.kind !== "car") continue;
        updateRigid(B, t, ev);
        glassAndLamps(B, t, ev);
      }
    }
    // airbags: the crash sensor judges the velocity change in the car's frame as it was at first
    // contact, within the first 80 ms (a car that spins afterwards must not fire its front bags)
    for (const [bi, B] of bodies.entries()) {
      if (B.def.kind !== "car" || firstTouch === Infinity || t - firstTouch > 0.08) continue;
      const v0 = vAtTouch[bi] ?? (vAtTouch[bi] = [B.vx, B.vz, B.yaw]);
      const fx0 = Math.cos(v0[2]), fz0 = -Math.sin(v0[2]), rx0 = Math.sin(v0[2]), rz0 = Math.cos(v0[2]);
      const dvl = (v0[0] - B.vx) * fx0 + (v0[1] - B.vz) * fz0, dvs = (v0[0] - B.vx) * rx0 + (v0[1] - B.vz) * rz0;
      if (B.def.airbags.front && Math.abs(dvl) > 4.0 && Math.abs(dvl) > Math.abs(dvs) * 0.7) {
        if (!fired.has(`bag${bi}`)) bursts.push({ t, type: "powder", at: worldOf(B, B.def.wheelHub), dir: [0, 0.3, 0], strength: 0.8, dur: 2.2 });
        ev(`bag${bi}`, { t, type: "airbag", body: B.def.id, bag: "driver" });
        if (!fired.has(`bagp${bi}`)) ev(`bagp${bi}`, { t: t + 0.003, type: "airbag", body: B.def.id, bag: "passenger" });
      }
      if (B.def.airbags.side && Math.abs(dvs) > 2.5) {
        const side = dvs > 0 ? "curtain-right" : "curtain-left";
        // pushed toward −z (dvs > 0 means it lost rightward speed: struck from the right)
        ev(`cur${bi}${side}`, { t, type: "airbag", body: B.def.id, bag: side });
      }
    }

    // sparks where metal scrapes metal fast
    for (const B of bodies) {
      if (B.slip > 2e4 && (bursts.length === 0 || t - lastSpark(bursts) > 0.006)) {
        bursts.push({ t, type: "sparks", at: B.slipAt, dir: [B.vx * 0.05, 0.5, B.vz * 0.05], strength: Math.min(1.5, B.slip / 1e5), dur: 0.35 });
      }
    }
    // debris shedding, in 2 ms batches
    for (const B of bodies) {
      if (B.shedArea > 0 && (B.shedArea > 0.004 || !touching)) {
        sheds.push({ t, body: B.def.id, x: B.shedX / B.shedArea, y: B.shedY / B.shedArea, z: B.shedZ / B.shedArea, amount: B.shedArea, carbon: B.shedCarbon / B.shedArea, vx: B.vx, vz: B.vz });
        B.shedArea = B.shedX = B.shedZ = B.shedY = B.shedCarbon = 0;
      }
    }
    // skid marks: wheels sliding faster than 1 m/s, a point every few centimetres
    for (const B of bodies) {
      for (const [i, wh] of B.wheels.entries()) {
        if (t < 0 || wh.slide < 1 || wh.N < 50) {
          wh.skid = null;
          continue;
        }
        toWorld(B, wh.x, wh.z, W1);
        if (!wh.skid) {
          wh.skid = [];
          skids.push({ body: B.def.id, wheel: CORNERS[i], pts: wh.skid as unknown as Float32Array });
        }
        const [lx, lz] = wh.lastSkid;
        if (isNaN(lx) || Math.hypot(W1[0] - lx, W1[1] - lz) > 0.04) {
          wh.skid.push(W1[0], W1[1], t, 0.24, Math.min(1, wh.slide / 6) * Math.min(1, wh.N / 4000));
          wh.lastSkid = [W1[0], W1[1]];
        }
      }
    }

    t += dt;

    // record
    if (t >= nextRec - 1e-9) {
      rec.times.push(t);
      for (const [bi, B] of bodies.entries()) recordBody(rec, bi, B, accPrev[bi], dt);
      nextRec = t + (fine ? 0.0005 : 1 / 240);
    }
    // a crush snapshot every millisecond while the crush is changing (by a millimetre anywhere), and
    // one to hold the shape before it changes again
    if (t >= nextSnap - 1e-9) {
      const crushSum = bodies.reduce((x, B) => { let c = 0; for (let k = 0; k < B.c.length; k += 7) c += B.c[k] + B.cel[k]; return x + c; }, 0);
      const changing = Math.abs(crushSum - lastCrushSum) > 0.001;
      if (changing || rec.snaps.length === 0) {
        if (!wasChanging && rec.snaps.length) rec.snaps.push({ t: t - 0.001, data: rec.snaps[rec.snaps.length - 1].data });
        rec.snaps.push({ t, data: bodies.map(snapshot) });
        lastCrushSum = crushSum;
      }
      wasChanging = changing;
      nextSnap = t + 0.001;
    }
    if (pBefore && !pAfter && t - lastContact > 0.01) {
      pAfter = bodies.reduce((p, B) => (B.fixed ? p : [p[0] + B.m * B.vx, p[1] + B.m * B.vz]), [0, 0]);
    }

    // rest
    let allRest = true;
    for (const [bi, B] of bodies.entries()) {
      if (B.fixed) continue;
      const moving = Math.hypot(B.vx, B.vz) > 0.05 || Math.abs(B.w) > 0.02 || Math.abs(B.vth) > 0.05 || Math.abs(B.vph) > 0.05;
      if (moving || t < 0.05) {
        still[bi] = 0;
        allRest = false;
      } else {
        if (!still[bi]) restAt[bi] = t;
        still[bi] += dt;
        if (still[bi] < 0.3) allRest = false;
      }
    }
    if (allRest && t > 0.3) break;
    // nothing will ever touch (both cars stopped short): give up after a while
    if (firstTouch === Infinity && t > 2) break;
  }
  // a final snapshot at rest
  rec.snaps.push({ t, data: bodies.map(snapshot) });
  for (const [bi, B] of bodies.entries()) if (!B.fixed) events.push({ t: isNaN(restAt[bi]) ? t : restAt[bi], type: "rest", body: B.def.id });
  events.sort((a, b) => a.t - b.t);

  // the occupants, from the impact window's buffers
  const occ = bodies.map((B, bi) => {
    if (B.def.kind !== "car" || !buf[bi].sx.length) return null;
    const bb = buf[bi];
    const def = B.def;
    const bagEv = events.find((e) => e.type === "airbag" && e.body === def.id && e.bag === "driver");
    const curtain = events.find((e) => e.type === "airbag" && e.body === def.id && e.bag.startsWith("curtain"));
    const start = bufStart;
    const res = occupant({
      dt: DT_FINE,
      ax: Float64Array.from(bb.sx),
      az: Float64Array.from(bb.sz),
      door: Float64Array.from(bb.door),
      dash: Float64Array.from(bb.dash),
      restraint: def.restraint,
      airbag: bagEv ? { fire: bagEv.t - start, full: bagEv.t - start + 0.03, vented: bagEv.t - start + 0.11 } : null,
      curtain: curtain ? curtain.t - start : null,
      wheel: [def.wheelHub[0] - def.hPoint[0], def.wheelHub[1] - def.hPoint[1]],
      doorGap: Math.max(0.12, def.plan.hz - 0.06 - Math.abs(def.hPoint[2] - def.plan.cz) - 0.22 - 0.1),
      doorSide: def.driverSide,
    });
    // an unrestrained head through the screen
    if (res.strike && def.restraint === "none") {
      const tStrike = start + (res.headG.indexOf(Math.max(...res.headG)) * DT_FINE);
      events.push({ t: tStrike, type: "glass", body: def.id, pane: "windscreen", kind: "crack", origin: [def.hPoint[0] + res.strike[0], def.hPoint[1] + res.strike[1], def.hPoint[2]] });
      events.sort((a, b) => a.t - b.t);
    }
    return { res, airbag: bagEv ? { fire: bagEv.t, full: bagEv.t + 0.03, vented: bagEv.t + 0.11 } : null };
  });

  const KE = ke();
  const timeline = pack(s, bodies, rec, events, bursts, sheds, skids, occ, bufStart);
  timeline.metrics = metricsOf({
    timeline,
    buf: buf.map((b) => ({ vl: Float64Array.from(b.vl), vs: Float64Array.from(b.vs), al: Float64Array.from(b.al), as: Float64Array.from(b.as) })),
    bufStart,
    dt: DT_FINE,
    bodies: bodies.map((B) => ({ def: B.def, ePlastic: B.ePlastic, c: B.c, L: B.L, cabinDepth: B.cabinDepth, cabinHit: B.cabinHit, rest: { x: B.x, z: B.z, yaw: B.yaw } })),
    occ: occ.map((o) => o?.res ?? null),
    energy: { KE0, KE, wContact, wTyre, plastic: ledger.plastic, friction: ledger.friction, elastic: ledger.elastic },
    momentum: { before: pBefore ?? p0, after: pAfter ?? bodies.reduce((p, B) => (B.fixed ? p : [p[0] + B.m * B.vx, p[1] + B.m * B.vz]), [0, 0]), tyreImpulse },
    firstTouch,
    lastContact,
  });
  timeline.solveMs = performance.now() - t0;
  return timeline;
}

const lastSpark = (b: Burst[]) => {
  for (let i = b.length - 1; i >= 0; i--) if (b[i].type === "sparks") return b[i].t;
  return -Infinity;
};

function worldOf(B: Body, p: [number, number, number]): [number, number, number] {
  toWorld(B, p[0], p[2], W1);
  return [W1[0], p[1], W1[1]];
}

/** How far the crush has pushed into the cabin at the driver: the door at the shoulder, the dash and footwell ahead. */
function travel(B: Body) {
  const def = B.def;
  let door = 0, dash = 0;
  const hp = def.hPoint, side = def.driverSide;
  for (let k = 0; k < NB * NS; k++) {
    if (!B.valid[k] || isNaN(B.cabinHit[k])) continue;
    const into = B.c[k] - B.cabinHit[k];
    if (into <= 0) continue;
    const y = BAND_MID[Math.floor(k / NS)];
    if (Math.abs(B.nz[k]) > 0.7 && Math.sign(B.nz[k]) === side && Math.abs(B.px[k] - hp[0]) < 0.45 && y > 0.3 && y < (def.beltline ?? 0.9) + 0.15) door = Math.max(door, into);
    if (B.nx[k] > 0.7 && Math.abs(B.pz[k] - hp[2]) < 0.4 && y < (def.beltline ?? 0.9) + 0.1) dash = Math.max(dash, into);
  }
  return { door, dash };
}

function updateRigid(B: Body, t: number, ev: (key: string, e: SimEvent) => void) {
  for (let k = 0; k < NB * NS; k++) {
    if (!B.valid[k]) continue;
    if (isNaN(B.cabinHit[k]) && B.L[k] >= B.cabinDepth[k]) B.cabinHit[k] = B.c[k];
  }
  for (const link of B.rigid) {
    let best = 0, bx = 0, bz = 0, outer = 0, inner = 0;
    for (let i = 0; i < link.ks.length; i++) {
      const k = link.ks[i];
      if (isNaN(link.hit[i])) {
        if (B.L[k] >= link.depth[i]) link.hit[i] = B.c[k];
        else continue;
      }
      const push = B.c[k] - link.hit[i];
      if (push > best) {
        best = push;
        bx = -B.nx[k];
        bz = -B.nz[k];
      }
      // which half of the part is shoved harder (it turns the wheel)
      if (Math.abs(B.pz[k]) > Math.abs(link.cz)) outer = Math.max(outer, push);
      else inner = Math.max(inner, push);
    }
    link.push = best;
    link.dir = [bx, bz];
    if (link.id.startsWith("wheel_")) {
      const left = link.id[7] === "l";
      link.yaw = Math.max(-0.6, Math.min(0.6, (outer - inner) * 2.5 * (left ? 1 : -1) * (Math.abs(bx) > Math.abs(bz) ? 1 : 0.4)));
      const wi = CORNERS.indexOf(link.id.slice(6) as Corner);
      const wh = B.wheels[wi];
      if (wh) {
        if (wh.front) wh.steer = link.yaw;
        if (best > 0.05 && !wh.jam) {
          wh.jam = true;
          wh.jamT = t;
          ev(`jam${B.def.id}${wi}`, { t, type: "jam", body: B.def.id, wheel: CORNERS[wi] });
        }
      }
    }
  }
}

/** Lamps break when the crush reaches them; glass when the crush reaches its frame. */
function glassAndLamps(B: Body, t: number, ev: (key: string, e: SimEvent) => void) {
  const def = B.def;
  const belt = def.beltline ?? 0.9;
  const [c0, c1] = def.cabin ?? [def.axleR, def.axleF];
  const xb = def.hPoint[0] - 0.22;
  for (let k = 0; k < NB * NS; k++) {
    if (!B.valid[k] || B.c[k] < 0.02) continue;
    const y = BAND_MID[Math.floor(k / NS)];
    const x = B.px[k], z = B.pz[k], nxk = B.nx[k], nzk = B.nz[k], c = B.c[k];
    // lamps: the nose's and the tail's outer corners at lamp height
    if (y > 0.3 && y < belt + 0.1 && Math.abs(z) > def.plan.hz * 0.35) {
      const lamp: Lamp | null = nxk > 0.5 ? (z < 0 ? "head-left" : "head-right") : nxk < -0.5 ? (z < 0 ? "tail-left" : "tail-right") : null;
      if (lamp && c > 0.03) ev(`lamp${def.id}${lamp}`, { t, type: "lamp", body: def.id, lamp });
    }
    // side glass: the flank crushed at window height, or the frame pushed back from the front corner
    if (Math.abs(nzk) > 0.7 && y > belt - 0.3 && y < belt + 0.25 && x > c0 && x < c1 + 0.1 && c > 0.05) {
      const pane = `${nzk < 0 ? "left" : "right"}-${x > xb ? "front" : "rear"}` as Pane;
      ev(`glass${def.id}${pane}`, { t, type: "glass", body: def.id, pane, kind: "shatter", origin: [x - nxk * c, y + 0.15, z - nzk * c] });
    }
    // the windscreen: the scuttle and A-pillars pushed back (the crush front past the front bulkhead)
    if (nxk > 0.6 && y > belt - 0.35 && !isNaN(B.cabinHit[k]) && c - B.cabinHit[k] > 0.03) {
      ev(`glass${def.id}windscreen`, { t, type: "glass", body: def.id, pane: "windscreen", kind: "crack", origin: [c1 + 0.25, belt + 0.18, z] });
      if (Math.abs(z) > def.plan.hz * 0.5) {
        const pane = `${z < 0 ? "left" : "right"}-front` as Pane;
        ev(`glass${def.id}${pane}`, { t, type: "glass", body: def.id, pane, kind: "shatter", origin: [c1 - 0.1, belt + 0.15, z] });
      }
    }
    // the rear screen: the tail crushed into the rear bulkhead at window height
    if (nxk < -0.6 && y > belt - 0.2 && c > 0.08 && !isNaN(B.cabinHit[k])) {
      ev(`glass${def.id}rear`, { t, type: "glass", body: def.id, pane: "rear", kind: "shatter", origin: [c0, belt + 0.15, z] });
    }
  }
}

function snapshot(B: Body): Float32Array {
  const n = NB * NS;
  const out = new Float32Array(n * 3);
  for (let k = 0; k < n; k++) {
    out[k * 3] = B.c[k] + B.cel[k];
    out[k * 3 + 1] = Math.max(B.L[k], B.c[k]);
    out[k * 3 + 2] = Math.min(1, B.c[k] / 0.3);
  }
  return out;
}

function recordBody(rec: Rec, bi: number, B: Body, prev: number[], dt: number) {
  const def = B.def;
  // the car-frame origin's pose, with pitch and roll about the CG
  const cgx = def.cg[0], h = def.cg[1], cgz = def.cg[2];
  const y1 = h * Math.cos(B.ph) - cgz * Math.sin(B.ph), z1 = h * Math.sin(B.ph) + cgz * Math.cos(B.ph);
  const x2 = cgx * Math.cos(B.th) + y1 * Math.sin(B.th), y2 = -cgx * Math.sin(B.th) + y1 * Math.cos(B.th);
  const [fx, fz] = fwd(B), [rx, rz] = rgt(B);
  const ox = B.x - (x2 * fx + z1 * rx), oz = B.z - (x2 * fz + z1 * rz);
  const oy = def.kind === "car" ? h + B.hy - y2 : 0;
  rec.pose[bi].push(ox, oy, oz, B.yaw, def.kind === "car" ? B.th : 0, def.kind === "car" ? B.ph : 0);
  rec.vel[bi].push(B.vx, B.vz, B.w);
  const ax = B.fixed ? 0 : (B.vx - prev[0]) / dt, az = B.fixed ? 0 : (B.vz - prev[1]) / dt;
  rec.acc[bi].push(ax * fx + az * fz, ax * rx + az * rz);
  const w = B.wheels;
  rec.wheels[bi].push(w[0]?.spin ?? 0, w[1]?.spin ?? 0, w[2]?.spin ?? 0, w[3]?.spin ?? 0, w[0]?.steer ?? 0, w[1]?.steer ?? 0);
  for (const link of B.rigid) {
    // the steering column rises and comes back with the dash; everything else moves along its push
    let dx = link.dir[0] * link.push, dz = link.dir[1] * link.push, dy = 0;
    if (link.id === "steering") {
      const tr = travel(B);
      dx = -tr.dash * 0.7;
      dy = tr.dash * 0.35;
      dz = 0;
    }
    rec.rigid[bi].push(dx, dy, dz, link.yaw);
  }
  rec.force[bi].push(B.fcx, B.fcz, B.x, B.z);
}

function firstContact(bodies: Body[]): number {
  const ledger: Ledger = { plastic: 0, friction: 0, elastic: 0 };
  const saved = bodies.map((B) => [B.x, B.z]);
  // back off 3 s, then step forward until the undeformed outlines touch
  const back = 3;
  let found = back;
  const at = (t: number) => {
    for (const [i, B] of bodies.entries()) {
      B.x = saved[i][0] + B.vx * (t - back);
      B.z = saved[i][1] + B.vz * (t - back);
    }
    for (let i = 0; i < bodies.length; i++)
      for (let j = i + 1; j < bodies.length; j++) {
        if (contactPass(bodies[i], bodies[j], 1, ledger, true)) return true;
      }
    return false;
  };
  if (at(0)) found = 0;
  else {
    let lo = 0, hi = -1;
    for (let tt = 0.002; tt <= back + 1; tt += 0.002) {
      if (at(tt)) {
        hi = tt;
        break;
      }
      lo = tt;
    }
    if (hi < 0) found = back + 1;
    else {
      for (let it = 0; it < 30; it++) {
        const mid = (lo + hi) / 2;
        if (at(mid)) hi = mid;
        else lo = mid;
      }
      found = lo;
    }
  }
  // leave the bodies at the moment of first contact (t = 0 of the record)
  for (const [i, B] of bodies.entries()) {
    B.x = saved[i][0] + B.vx * (found - back);
    B.z = saved[i][1] + B.vz * (found - back);
  }
  return 0;
}

function pack(s: Scenario, bodies: Body[], rec: Rec, events: SimEvent[], bursts: Burst[], sheds: Shed[], skids: Skid[], occ: ({ res: OccupantResult; airbag: { fire: number; full: number; vented: number } | null } | null)[], bufStart: number): Timeline {
  const times = Float32Array.from(rec.times);
  const tracks: Track[] = bodies.map((B, bi) => ({
    id: B.def.id,
    pose: Float32Array.from(rec.pose[bi]),
    vel: Float32Array.from(rec.vel[bi]),
    accRaw: Float32Array.from(rec.acc[bi]),
    acc: Float32Array.from(rec.acc[bi]),
    wheels: Float32Array.from(rec.wheels[bi]),
    rigidIds: B.rigid.map((r) => r.id),
    rigid: Float32Array.from(rec.rigid[bi]),
    force: Float32Array.from(rec.force[bi]),
  }));
  const crush: CrushTrack[] = bodies.map((B, bi) => {
    const n = NB * NS * 3;
    const data = new Float32Array(rec.snaps.length * n);
    rec.snaps.forEach((sn, i) => data.set(sn.data[bi], i * n));
    return { id: B.def.id, times: Float32Array.from(rec.snaps.map((sn) => sn.t)), data };
  });
  const sk = skids.map((k) => ({ ...k, pts: Float32Array.from(k.pts as unknown as number[]) }));
  const occupants = occ.flatMap((o, bi) => {
    if (!o) return [];
    // resample the occupant (0.1 ms from bufStart) at the frame times; before and after it sits still
    const F = times.length;
    const pose = new Float32Array(F * 5), headG = new Float32Array(F), chestG = new Float32Array(F), belt = new Float32Array(F);
    const n = o.res.headG.length;
    for (let k = 0; k < F; k++) {
      const idx = Math.round((times[k] - bufStart) / DT_FINE);
      if (idx < 0) continue;
      const j = Math.min(n - 1, idx);
      // after the window the dummy settles back into the seat
      const relax = idx >= n ? Math.exp(-(times[k] - (bufStart + n * DT_FINE)) / 0.35) : 1;
      for (let c = 0; c < 5; c++) pose[k * 5 + c] = o.res.pose[j * 5 + c] * relax;
      if (idx < n) {
        headG[k] = o.res.headG[j];
        chestG[k] = o.res.chestG[j];
        belt[k] = o.res.belt[j];
      }
    }
    return [{ body: bodies[bi].def.id, pose, headG, chestG, belt, airbag: o.airbag }];
  });
  const debris = spawnDebris(s, bodies.map((B) => B.def), events, sheds, tracks, times);
  // steam from a crushed radiator
  for (const B of bodies) {
    const rad = B.rigid.find((r) => r.id === "radiator" || r.id === "engine");
    if (B.def.kind === "car" && rad && rad.push > 0.02) {
      const ci = rec.times.length - 1;
      const pose = tracks[bodies.indexOf(B)].pose;
      bursts.push({ t: 0.25, type: "steam", at: [pose[ci * 6] + Math.cos(B.yaw) * (B.def.plan.hx * 0.6), 0.7, pose[ci * 6 + 2] - Math.sin(B.yaw) * (B.def.plan.hx * 0.6)], dir: [0, 1, 0], strength: Math.min(1, rad.push * 5), dur: 6 });
    }
  }
  return {
    scenario: s,
    times,
    bodies: bodies.map((B) => B.def),
    tracks,
    crush,
    events,
    bursts: bursts.sort((a, b) => a.t - b.t),
    debris,
    skids: sk,
    occupants,
    metrics: null as unknown as Timeline["metrics"],
    solveMs: 0,
  };
}
