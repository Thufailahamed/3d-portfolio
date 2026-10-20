/**
 * The lab report: what a test lab would publish from a run, computed from the solver's record —
 * Δv, the CFC 60 crash pulse's peak and mean, the occupant load criterion, crush and cabin intrusion,
 * the energy each structure absorbed, the occupant's head and chest measures, the momentum and energy
 * checks — and the five-step ratings the HUD colours them by.
 */
import { cfc, clip3ms, hic, olc } from "./cfc";
import { BAND_MID, pointAt } from "./geometry";
import type { OccupantResult } from "./occupant";
import { NB, NS, type BodyDef, type BodyMetrics, type Metrics, type Rating, type Timeline } from "./types";

const G = 9.81;

/**
 * The site's own rating bands (upper limits for good, adequate, marginal, weak; above is poor),
 * loosely after published practice: HIC15 against the 700 of the US occupant protection standard,
 * chest 3 ms against its 60 g, intrusion against what a cabin can lose before it reaches the occupant.
 */
export const RATING_BANDS = {
  head: { label: "HIC15", unit: "", bands: [500, 650, 800, 1000] },
  chest: { label: "Chest, 3 ms clip", unit: "g", bands: [42, 50, 56, 62] },
  intrusion: { label: "Cabin intrusion", unit: "mm", bands: [100, 150, 200, 300] },
} as const;

const RATINGS: Rating[] = ["good", "adequate", "marginal", "weak", "poor"];
export const rate = (v: number, bands: readonly number[]): Rating => RATINGS[bands.findIndex((b) => v < b) === -1 ? 4 : bands.findIndex((b) => v < b)];

type MetricsInput = {
  timeline: Timeline;
  buf: { vl: Float64Array; vs: Float64Array; al: Float64Array; as: Float64Array }[];
  bufStart: number;
  dt: number;
  bodies: { def: BodyDef; ePlastic: number; c: Float64Array; L: Float64Array; cabinDepth: Float64Array; cabinHit: Float64Array; rest: { x: number; z: number; yaw: number } }[];
  occ: (OccupantResult | null)[];
  energy: { KE0: number; KE: number; wContact: number; wTyre: number; plastic: number; friction: number; elastic: number };
  momentum: { before: number[]; after: number[]; tyreImpulse: number[] };
  firstTouch: number;
  lastContact: number;
};

/** The frame nearest time t. */
function frame(times: Float32Array, t: number) {
  let best = 0;
  for (let i = 0; i < times.length; i++) if (Math.abs(times[i] - t) < Math.abs(times[best] - t)) best = i;
  return best;
}

export function metricsOf(m: MetricsInput): Metrics {
  const tl = m.timeline;
  const contact = Number.isFinite(m.firstTouch);
  const t0 = contact ? m.firstTouch : 0, t1 = contact ? m.lastContact : 0;
  const f0 = frame(tl.times, t0 - 0.001), f1 = frame(tl.times, t1 + 0.003);
  const i0 = Math.max(0, Math.round((t0 - m.bufStart) / m.dt));
  const i1 = Math.round((t1 - m.bufStart) / m.dt);
  const bodies: BodyMetrics[] = [];

  for (const [bi, b] of m.bodies.entries()) {
    const def = b.def;
    if (def.kind !== "car") continue;
    const tr = tl.tracks[bi];
    // Δv: the greatest change of the CG's velocity over the impact (a long push can give some back)
    const v0 = [tr.vel[f0 * 3], tr.vel[f0 * 3 + 1]];
    let dv = 0;
    for (let k = f0; k <= f1; k++) dv = Math.max(dv, Math.hypot(tr.vel[k * 3] - v0[0], tr.vel[k * 3 + 1] - v0[1]));
    const buf = m.buf[bi];
    // the crash pulse: CFC 60 over the impact window, resultant of the car-frame components
    const al = cfc(buf.al, m.dt, 60), as = cfc(buf.as, m.dt, 60);
    let peak = 0, iPeak = i0;
    for (let i = i0; i <= Math.min(al.length - 1, i1 + 30); i++) {
      const a = Math.hypot(al[i], as[i]);
      if (a > peak) {
        peak = a;
        iPeak = i;
      }
    }
    // the pulse ends when the deceleration has stayed under 1 g for 5 ms (a car resting against a pole is still "in contact")
    let iEnd = Math.min(i1, al.length - 1);
    for (let i = iPeak, quiet = 0; i <= Math.min(i1, al.length - 1); i++) {
      quiet = Math.hypot(al[i], as[i]) < G ? quiet + 1 : 0;
      if (quiet * m.dt >= 0.005) {
        iEnd = i - quiet;
        break;
      }
    }
    // write the filtered pulse into the frames that fall inside the window
    for (let k = 0; k < tl.times.length; k++) {
      const idx = Math.round((tl.times[k] - m.bufStart) / m.dt);
      if (idx >= 0 && idx < al.length) {
        tr.acc[k * 2] = al[idx];
        tr.acc[k * 2 + 1] = as[idx];
      }
    }
    const pulse = Math.max(1e-3, (iEnd - i0) * m.dt);
    // frontal or side: which way the car's own velocity changed most
    const dvl = buf.vl[i0] - buf.vl[Math.min(buf.vl.length - 1, i1)], dvs = buf.vs[i0] - buf.vs[Math.min(buf.vs.length - 1, i1)];
    const frontal = Math.abs(dvl) >= Math.abs(dvs);
    const series = (frontal ? buf.vl : buf.vs).subarray(i0);
    const o = Math.abs(series[0]) > 0.5 ? olc(series, m.dt) : 0;
    // crush: the deepest while loaded (snapshots), and what is left
    const ct = tl.crush[bi];
    let dyn = 0;
    for (let k = 0; k < ct.data.length; k += 3) dyn = Math.max(dyn, ct.data[k]);
    let res = 0;
    for (let k = 0; k < b.c.length; k++) res = Math.max(res, b.c[k]);
    // intrusion at the driver: footwell, dash / A-pillar, door
    const hp = def.hPoint, belt = def.beltline ?? 0.9;
    let foot = 0, dash = 0, door = 0;
    for (let k = 0; k < NB * NS; k++) {
      if (isNaN(b.cabinHit[k])) continue;
      const into = b.c[k] - b.cabinHit[k];
      if (into <= 0) continue;
      const y = BAND_MID[Math.floor(k / NS)];
      const sample = sampleGeo(def, k);
      if (sample.nx > 0.7 && Math.abs(sample.z - hp[2]) < 0.4) {
        if (y < 0.5) foot = Math.max(foot, into);
        else if (y < belt + 0.15) dash = Math.max(dash, into);
      }
      if (Math.abs(sample.nz) > 0.7 && Math.sign(sample.nz) === def.driverSide && Math.abs(sample.x - hp[0]) < 0.45 && y > 0.3 && y < belt + 0.15) door = Math.max(door, into);
    }
    const restEv = tl.events.find((e) => e.type === "rest" && e.body === def.id);
    const last = tl.times.length - 1;
    const oc = m.occ[bi];
    let occupant: BodyMetrics["occupant"] = null;
    if (oc) {
      const hG = cfc(oc.headG, m.dt, 1000), cG = cfc(oc.chestG, m.dt, 180);
      const h15 = hic(hG, m.dt, 15), c3 = clip3ms(cG, m.dt);
      let exc = 0, beltPeak = 0;
      for (let i = 0; i < oc.headG.length; i++) {
        exc = Math.max(exc, oc.pose[i * 5 + 4]);
        beltPeak = Math.max(beltPeak, oc.belt[i]);
      }
      const intr = frontal ? Math.max(foot, dash) : door;
      occupant = {
        hic15: h15,
        chest3ms: c3,
        excursion: exc,
        beltPeak,
        contact: oc.contact,
        airbag: tl.events.some((e) => e.type === "airbag" && e.body === def.id && e.bag === "driver"),
        ratings: {
          head: rate(h15, RATING_BANDS.head.bands),
          chest: rate(c3, RATING_BANDS.chest.bands),
          structure: rate(intr * 1000, RATING_BANDS.intrusion.bands),
        },
      };
    }
    bodies.push({
      id: def.id,
      label: def.label,
      deltaV: dv * 3.6,
      peakG: peak / G,
      meanG: dv / pulse / G,
      pulseMs: pulse * 1000,
      olc: frontal ? o : NaN,
      crushDynamic: dyn,
      crushResidual: res,
      intrusion: { footwell: foot, dash, door },
      energy: b.ePlastic,
      rest: { x: tr.pose[last * 6], z: tr.pose[last * 6 + 2], yaw: tr.pose[last * 6 + 3], t: restEv?.t ?? tl.times[last] },
      occupant,
    });
  }

  // the pair: closing speed and restitution along the line of the impulse on A
  const A = Math.max(0, m.bodies.findIndex((b) => b.def.id === "a")), B = m.bodies.findIndex((_, i) => i !== A);
  const ta = tl.tracks[A], tb = tl.tracks[B];
  const va0 = [ta.vel[f0 * 3], ta.vel[f0 * 3 + 1]], va1 = [ta.vel[f1 * 3], ta.vel[f1 * 3 + 1]];
  const vb0 = tb ? [tb.vel[f0 * 3], tb.vel[f0 * 3 + 1]] : [0, 0], vb1 = tb ? [tb.vel[f1 * 3], tb.vel[f1 * 3 + 1]] : [0, 0];
  const J = [va1[0] - va0[0], va1[1] - va0[1]], jl = Math.hypot(J[0], J[1]) || 1;
  const n = [J[0] / jl, J[1] / jl];
  const close0 = (va0[0] - vb0[0]) * n[0] + (va0[1] - vb0[1]) * n[1];
  const close1 = (va1[0] - vb1[0]) * n[0] + (va1[1] - vb1[1]) * n[1];
  const closing = Math.hypot(va0[0] - vb0[0], va0[1] - vb0[1]);
  const fixed = m.bodies.some((b) => !Number.isFinite(b.def.mass));
  const pb = m.momentum.before, pa = m.momentum.after, ti = m.momentum.tyreImpulse;
  const pmag = Math.hypot(pb[0], pb[1]) || 1;
  const merr = fixed ? NaN : Math.hypot(pa[0] - pb[0] - ti[0], pa[1] - pb[1] - ti[1]) / pmag;

  const e = m.energy;
  const crush = m.bodies.map((b) => b.ePlastic);
  const tyres = -e.wTyre;
  // the contact's book against the work its forces did (the time discretisation's error)
  const contactWork = -e.wContact;
  const book = e.plastic + e.friction + e.elastic;
  const err = e.KE0 > 0 ? Math.abs(contactWork - book) / e.KE0 : 0;

  return {
    bodies,
    closingKmh: closing * 3.6,
    restitution: close0 !== 0 ? Math.max(0, -close1 / close0) : 0,
    contactMs: contact ? (t1 - t0) * 1000 : 0,
    momentum: { before: [pb[0], pb[1]], after: [pa[0], pa[1]], error: merr },
    energy: { initial: e.KE0, final: e.KE, crush, friction: e.friction, tyres, elastic: e.elastic, error: err },
  };
}

/** A sample's undeformed skin point and normal, car frame. */
function sampleGeo(def: BodyDef, k: number) {
  const i = k % NS;
  const P = def.plan;
  const out = { x: 0, z: 0, nx: 0, nz: 0 };
  pointAtCache(P, i, out);
  const e = def.surface[k];
  out.x -= out.nx * e;
  out.z -= out.nz * e;
  return out;
}

const cache = new Map<string, Float32Array>();
function pointAtCache(P: BodyDef["plan"], i: number, out: { x: number; z: number; nx: number; nz: number }) {
  const key = `${P.hx},${P.hz},${P.rc},${P.cx},${P.cz}`;
  let arr = cache.get(key);
  if (!arr) {
    arr = new Float32Array(NS * 4);
    const bp = { x: 0, z: 0, nx: 0, nz: 0 };
    for (let s = 0; s < NS; s++) {
      pointAt(P, s / NS, bp);
      arr.set([bp.x, bp.z, bp.nx, bp.nz], s * 4);
    }
    cache.set(key, arr);
  }
  out.x = arr[i * 4];
  out.z = arr[i * 4 + 1];
  out.nx = arr[i * 4 + 2];
  out.nz = arr[i * 4 + 3];
}
