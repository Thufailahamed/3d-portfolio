/**
 * A stand-in timeline with the right shape, for building the scene and the HUD before (or without)
 * the solver: car A runs into a rigid wall with a half-sine crash pulse, its front crushes into the
 * wall face, the glass and lamps go, a little debris flies and the driver pitches into the belt.
 * Not physics: nothing here may be shown as a result. Same seed, same timeline.
 */
import { outlines } from "../data/outlines";
import { pointAt } from "./geometry";
import { NB, NO_SURFACE, NS, type BodyDef, type CrushTrack, type DebrisSet, type Metrics, type OccupantTrack, type Scenario, type SimEvent, type Timeline, type Track } from "./types";

const G = 9.81;

function mulberry(seed: number) {
  let t = seed >>> 0;
  return () => {
    t = (t + 0x6d2b79f5) >>> 0;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r;
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

/** A body for a car of the line-up from its measured outline, with round-number mass and structure. */
export function mockBody(slug: string, id: BodyDef["id"] = "a"): BodyDef {
  const o = outlines[slug] ?? Object.values(outlines)[0];
  const box = (k: string) => o.parts[k];
  const wheels = ["wheel_fl", "wheel_fr", "wheel_rl", "wheel_rr"].map(box).filter(Boolean);
  const cx = (b: number[]) => (b[0] + b[3]) / 2;
  const axleF = wheels.length ? (cx(wheels[0]) + cx(wheels[1] ?? wheels[0])) / 2 : o.plan.hx * 0.6;
  const axleR = wheels.length > 2 ? (cx(wheels[2]) + cx(wheels[3] ?? wheels[2])) / 2 : -o.plan.hx * 0.6;
  const steer = box("steering");
  const hub: [number, number, number] = steer ? [cx(steer), (steer[1] + steer[4]) / 2, (steer[2] + steer[5]) / 2] : [0.4, 0.7, -0.35];
  const mass = 1400;
  return {
    id,
    kind: "car",
    slug,
    label: slug,
    mass,
    Iz: 0.1478 * mass * (axleF - axleR) * o.plan.hx * 2,
    Ipitch: 0.12 * mass * (o.plan.hx * 2) ** 2 * 0.8,
    Iroll: 0.06 * mass * (o.plan.hz * 2) ** 2,
    cg: [(axleF + axleR) / 2 - 0.1, 0.45, 0],
    axleF,
    axleR,
    halfTrackF: 0.8,
    halfTrackR: 0.8,
    wheelRadius: 0.33,
    plan: o.plan,
    surface: Float32Array.from(o.surface),
    zones: [],
    background: { sigma: 5e4, eta: 0.9, material: "trim" },
    elastic: 4e7,
    restraint: "belt+airbag",
    airbags: { front: true, side: false },
    driverSide: hub[2] >= 0 ? 1 : -1,
    hPoint: [hub[0] - 0.55, Math.max(0.25, hub[1] - 0.35), hub[2]],
    wheelHub: hub,
    rigid: ["engine", "wheel_fl", "wheel_fr"].filter((k) => box(k)).map((k) => ({ id: k, min: box(k).slice(0, 3) as [number, number, number], max: box(k).slice(3) as [number, number, number] })),
  };
}

/** A plausible-looking wall test for car A (other tests are drawn the same way, into a wall at x = 0). */
export function mockTimeline(s: Scenario): Timeline {
  const rnd = mulberry(7);
  const body = mockBody(s.a, "a");
  const v0 = s.va / 3.6;
  const T = 0.085; // pulse length
  const e = 0.15; // restitution
  const dv = v0 * (1 + e);
  const A = (dv * Math.PI) / (2 * T);
  const front = body.plan.cx + body.plan.hx;

  // frame times: 1/240 s on the approach and run-out, 0.5 ms through the impact
  const times: number[] = [];
  for (let t = -1.2; t < -0.004; t += 1 / 240) times.push(t);
  for (let t = -0.004; t < 0.16; t += 0.0005) times.push(t);
  for (let t = 0.16; t <= 2.4; t += 1 / 240) times.push(t);
  const F = times.length;

  const pose = new Float32Array(F * 6), vel = new Float32Array(F * 3), acc = new Float32Array(F * 2);
  const wheels = new Float32Array(F * 6), force = new Float32Array(F * 4);
  const rigidIds = body.rigid.map((r) => r.id);
  const rigid = new Float32Array(F * rigidIds.length * 4);
  let x = -front - v0 * 1.2, v = v0, spin = 0, crushMax = 0;
  const xs: number[] = [];
  for (let k = 0; k < F; k++) {
    const t = times[k], dt = k ? t - times[k - 1] : 0;
    const a = t >= 0 && t < T ? -A * Math.sin((Math.PI * t) / T) : t >= T && Math.abs(v) > 0.01 ? -0.6 * G * Math.sign(v) : 0;
    v += a * dt;
    if (t >= T && Math.abs(v) < 0.02) v = 0;
    x += v * dt;
    spin += (v / body.wheelRadius) * dt;
    xs.push(x);
    crushMax = Math.max(crushMax, x + front);
    // the rear lifts as the nose digs in, then drops back
    const lift = t > 0 && t < 0.45 ? Math.sin((Math.PI * t) / 0.45) * 0.07 : 0;
    pose.set([x, lift * 0.25, 0, 0, -lift, 0], k * 6);
    vel.set([v, 0, 0], k * 3);
    acc.set([a, 0], k * 2);
    wheels.set([spin, spin, spin, spin, 0, 0], k * 6);
    force.set([a * body.mass, 0, 0, 0], k * 4);
    for (let r = 0; r < rigidIds.length; r++) {
      const push = Math.max(0, x + front - 0.35) * (rigidIds[r] === "engine" ? 0.6 : 0.3);
      rigid.set([-push, 0, 0, rigidIds[r] === "wheel_fl" ? push * 0.6 : rigidIds[r] === "wheel_fr" ? -push * 0.6 : 0], (k * rigidIds.length + r) * 4);
    }
  }
  const tracks: Track[] = [{ id: "a", pose, vel, accRaw: acc, acc: acc.slice(), wheels, rigidIds, rigid, force }];

  // crush snapshots: the front samples pressed into the wall face, springing back a little after
  const snapTimes: number[] = [];
  for (let t = -0.001; t <= 0.12; t += 0.0005) snapTimes.push(t);
  const cell = NB * NS * 3;
  const data = new Float32Array(snapTimes.length * cell);
  const bp = { x: 0, z: 0, nx: 0, nz: 0 };
  snapTimes.forEach((t, j) => {
    const k = Math.min(F - 1, times.findIndex((tt) => tt >= t));
    const into = Math.max(0, xs[Math.max(0, k)] + front);
    const residual = t > T ? crushMax * 0.92 : into;
    for (let b = 0; b < NB; b++)
      for (let i = 0; i < NS; i++) {
        const sd = body.surface[b * NS + i];
        if (sd >= NO_SURFACE) continue;
        pointAt(body.plan, i / NS, bp);
        if (bp.nx < 0.5) continue;
        const surfX = bp.x - bp.nx * sd;
        const c = Math.max(0, Math.max(into, residual) - (front - surfX));
        const o = j * cell + (b * NS + i) * 3;
        data[o] = c;
        data[o + 1] = c / 0.72;
        data[o + 2] = Math.min(1, c / 0.4);
      }
  });
  const crush: CrushTrack[] = [{ id: "a", times: Float32Array.from(snapTimes), data }];

  const events: SimEvent[] = [
    { t: 0, type: "contact", a: "a", b: "barrier", at: [0, 0] },
    { t: 0.006, type: "lamp", body: "a", lamp: "head-left" },
    { t: 0.007, type: "lamp", body: "a", lamp: "head-right" },
    { t: 0.016, type: "airbag", body: "a", bag: "driver" },
    { t: 0.034, type: "glass", body: "a", pane: "windscreen", kind: "crack", origin: [body.wheelHub[0] + 0.45, 1.0, body.wheelHub[2]] },
    { t: 0.041, type: "glass", body: "a", pane: body.driverSide < 0 ? "left-front" : "right-front", kind: "shatter", origin: [0.2, 0.95, body.driverSide * body.plan.hz] },
    { t: T, type: "separate", a: "a", b: "barrier" },
    { t: 1.1, type: "rest", body: "a" },
  ];

  // debris: lens shards and glass cubes thrown forward and sideways, bouncing to rest
  const N = 240;
  const kind = new Uint8Array(N), size = new Float32Array(N), color = new Float32Array(N * 3), axis = new Float32Array(N * 3);
  const first = new Uint32Array(N), count = new Uint16Array(N);
  const segs: number[] = [];
  for (let p = 0; p < N; p++) {
    const glass = p > N * 0.4;
    kind[p] = glass ? 0 : 1;
    size[p] = glass ? 0.006 + rnd() * 0.006 : 0.01 + rnd() * 0.03;
    color.set([0.9, 0.92, 0.95], p * 3);
    const ax = [rnd() - 0.5, rnd() - 0.5, rnd() - 0.5], l = Math.hypot(...ax) || 1;
    axis.set(ax.map((c) => c / l), p * 3);
    let t0 = (glass ? 0.041 : 0.006) + rnd() * 0.01;
    let px = -0.05, py = glass ? 0.95 : 0.6, pz = glass ? body.driverSide * body.plan.hz : (rnd() - 0.5) * 1.6;
    let vx = -1 - rnd() * 3, vy = 1 + rnd() * 3, vz = (glass ? body.driverSide * 2 : 0) + (rnd() - 0.5) * 4;
    first[p] = segs.length / 12;
    let n = 0, ang = 0;
    const spin = (rnd() - 0.5) * 60;
    for (let bounce = 0; bounce < 4; bounce++) {
      segs.push(t0, px, py, pz, vx, vy, vz, 0, -G, 0, ang, spin);
      n++;
      const tf = (vy + Math.sqrt(vy * vy + 2 * G * py)) / G; // time to the floor
      px += vx * tf;
      pz += vz * tf;
      py = 0.003;
      ang += spin * tf;
      t0 += tf;
      vx *= 0.5;
      vz *= 0.5;
      vy = Math.abs(vy - G * tf) * 0.3;
      if (vy < 0.2) break;
    }
    // sliding to a stop
    const sp = Math.hypot(vx, vz);
    if (sp > 0.01) {
      const dec = 0.5 * G;
      segs.push(t0, px, 0.003, pz, vx, 0, vz, (-vx / sp) * dec, 0, (-vz / sp) * dec, ang, spin * 0.2);
      n++;
      const ts = sp / dec;
      segs.push(t0 + ts, px + (vx * ts) / 2, 0.003, pz + (vz * ts) / 2, 0, 0, 0, 0, 0, 0, ang + spin * 0.2 * ts, 0);
      n++;
    } else {
      segs.push(t0, px, 0.003, pz, 0, 0, 0, 0, 0, 0, ang, 0);
      n++;
    }
    count[p] = n;
  }
  const debris: DebrisSet = { kind, size, color, axis, first, count, seg: Float32Array.from(segs) };

  // the driver: pitches forward into belt and bag, rebounds, settles
  const occPose = new Float32Array(F * 5), headG = new Float32Array(F), chestG = new Float32Array(F), belt = new Float32Array(F);
  for (let k = 0; k < F; k++) {
    const t = times[k];
    const u = t > 0.01 && t < 0.2 ? Math.sin((Math.PI * (t - 0.01)) / 0.19) : 0;
    occPose.set([0.45 * u, 0, 0.35 * u, 0, 0.32 * u], k * 5);
    headG[k] = 48 * Math.max(0, Math.sin((Math.PI * (t - 0.045)) / 0.06)) * (t > 0.045 && t < 0.105 ? 1 : 0);
    chestG[k] = 38 * Math.max(0, Math.sin((Math.PI * (t - 0.02)) / 0.08)) * (t > 0.02 && t < 0.1 ? 1 : 0);
    belt[k] = 5200 * u;
  }
  const occupants: OccupantTrack[] = [{ body: "a", pose: occPose, headG, chestG, belt, airbag: { fire: 0.016, full: 0.046, vented: 0.12 } }];

  const ke = 0.5 * body.mass * v0 * v0;
  const metrics: Metrics = {
    bodies: [
      {
        id: "a",
        label: body.label,
        deltaV: dv * 3.6,
        peakG: A / G,
        meanG: dv / T / G,
        pulseMs: T * 1000,
        olc: (dv / T / G) * 1.25,
        crushDynamic: crushMax,
        crushResidual: crushMax * 0.92,
        intrusion: { footwell: 0.04, dash: 0.02, door: 0 },
        energy: ke * (1 - e * e),
        rest: { x: xs[F - 1], z: 0, yaw: 0, t: 1.1 },
        occupant: { hic15: 420, chest3ms: 36, excursion: 0.32, beltPeak: 5200, contact: "bag", airbag: true, ratings: { head: "good", chest: "adequate", structure: "good" } },
      },
    ],
    closingKmh: s.va,
    restitution: e,
    contactMs: T * 1000,
    momentum: { before: [body.mass * v0, 0], after: [-body.mass * v0 * e, 0], error: 0 },
    energy: { initial: ke, final: ke * e * e, crush: [ke * (1 - e * e)], friction: 0, elastic: 0, error: 0 },
  };

  // the rigid block: its own frame faces the car (yaw π), its face on x = 0, 3 m deep, 5 m wide, 1.5 m high
  const wall: BodyDef = {
    ...body,
    id: "barrier",
    kind: "wall",
    slug: undefined,
    label: "Rigid barrier",
    mass: Infinity,
    Iz: Infinity,
    Ipitch: Infinity,
    Iroll: Infinity,
    cg: [-1.5, 0.75, 0],
    plan: { hx: 1.5, hz: 2.5, rc: 0.02, cx: -1.5, cz: 0 },
    surface: Float32Array.from({ length: NB * NS }, (_, k) => (Math.floor(k / NS) < 8 ? 0 : NO_SURFACE)),
    zones: [],
    background: { sigma: Infinity, eta: 0.01, material: "concrete" },
    elastic: 1e9,
    airbags: { front: false, side: false },
    rigid: [],
  };
  const still = new Float32Array(F * 6);
  for (let k = 0; k < F; k++) still[k * 6 + 3] = Math.PI;
  tracks.push({ id: "barrier", pose: still, vel: new Float32Array(F * 3), accRaw: new Float32Array(F * 2), acc: new Float32Array(F * 2), wheels: new Float32Array(F * 6), rigidIds: [], rigid: new Float32Array(0), force: new Float32Array(F * 4) });

  return {
    scenario: s,
    times: Float32Array.from(times),
    bodies: [body, wall],
    tracks,
    crush,
    events,
    bursts: [
      { t: 0.002, type: "dust", at: [-0.1, 0.25, 0], dir: [-1, 0.3, 0], strength: 1, dur: 1.2 },
      { t: 0.003, type: "sparks", at: [-0.05, 0.3, 0.4], dir: [-0.5, 0.6, 0.6], strength: 0.6, dur: 0.25 },
      { t: 0.018, type: "powder", at: [body.wheelHub[0] - front, body.wheelHub[1], body.wheelHub[2]], dir: [0, 0.4, 0], strength: 0.7, dur: 1.5 },
    ],
    debris,
    skids: [],
    occupants,
    metrics,
    solveMs: 0,
  };
}
