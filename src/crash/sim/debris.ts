/**
 * What breaks off: tempered-glass cubes from shattered panes, lens shards from broken lamps, bumper
 * and grille plastic, carbon splinters from composite bodies, paint flecks and metal bits shed where
 * the structure crushes (in proportion to the crushed volume), coolant from a crushed radiator.
 * Each piece leaves with its car's local velocity plus a seeded spread, then flies, bounces and slides
 * to rest on the floor — computed here once as piecewise-quadratic segments (DebrisSet), so the scene
 * can evaluate any instant exactly and scrubbing shows the same scatter every time.
 *
 * The scatter is procedural (seeded); the amounts and timing follow the solver.
 */
import { DEBRIS_KINDS, type BodyDef, type DebrisKind, type DebrisSet, type Scenario, type SimEvent, type Track } from "./types";

const G = 9.81;
const MAX = 1500;

/** A batch of structure crushed in a couple of milliseconds: where, how much (m³), how much of it composite. */
export type Shed = { t: number; body: string; x: number; y: number; z: number; amount: number; carbon: number; vx: number; vz: number };

/** How each kind bounces (restitution), skids (friction on the floor) and keeps spinning. */
const FEEL: Record<DebrisKind, { e: number; mu: number; keep: number }> = {
  glass: { e: 0.28, mu: 0.32, keep: 0.75 },
  lens: { e: 0.35, mu: 0.42, keep: 0.6 },
  amber: { e: 0.35, mu: 0.42, keep: 0.6 },
  red: { e: 0.35, mu: 0.42, keep: 0.6 },
  plastic: { e: 0.38, mu: 0.55, keep: 0.55 },
  carbon: { e: 0.3, mu: 0.5, keep: 0.55 },
  paint: { e: 0.1, mu: 0.9, keep: 0.4 },
  metal: { e: 0.3, mu: 0.5, keep: 0.5 },
  coolant: { e: 0, mu: 10, keep: 0 },
};

function mulberry(seed: number) {
  let t = seed >>> 0;
  return () => {
    t = (t + 0x6d2b79f5) >>> 0;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r;
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

function hash(s: Scenario) {
  const str = JSON.stringify(s);
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) h = Math.imul(h ^ str.charCodeAt(i), 16777619);
  return h >>> 0;
}

type Piece = { kind: DebrisKind; t: number; p: [number, number, number]; v: [number, number, number]; size: number; color: [number, number, number]; spin: number };

/** World position and velocity of a car-frame point of a body at time t (from its track). */
function carPoint(track: Track, times: Float32Array, def: BodyDef, t: number, x: number, y: number, z: number) {
  let k = 0;
  while (k + 1 < times.length && times[k + 1] <= t) k++;
  const pose = track.pose, vel = track.vel;
  const yaw = pose[k * 6 + 3];
  const c = Math.cos(yaw), s = Math.sin(yaw);
  const wx = pose[k * 6] + x * c + z * s, wz = pose[k * 6 + 2] - x * s + z * c;
  const w = vel[k * 3 + 2];
  // velocity of that point: CG velocity plus the spin about it
  const cg = def.cg;
  const gx = pose[k * 6] + cg[0] * c + cg[2] * s, gz = pose[k * 6 + 2] - cg[0] * s + cg[2] * c;
  const vx = vel[k * 3] + w * (wz - gz), vz = vel[k * 3 + 1] - w * (wx - gx);
  return { p: [wx, y + pose[k * 6 + 1], wz] as [number, number, number], v: [vx, 0, vz] as [number, number, number], yaw };
}

export function spawnDebris(s: Scenario, defs: BodyDef[], events: SimEvent[], sheds: Shed[], tracks: Track[], times: Float32Array): DebrisSet {
  const rnd = mulberry(hash(s));
  const pieces: Piece[] = [];
  const idx = (id: string) => defs.findIndex((d) => d.id === id);
  const jitter = (a: number) => (rnd() - 0.5) * 2 * a;
  const add = (pc: Piece) => {
    if (pieces.length < MAX) pieces.push(pc);
  };

  // structure shed while crushing: plastic and carbon, paint flecks, a few metal bits
  for (const sh of sheds) {
    const bi = idx(sh.body);
    const def = defs[bi];
    if (!def || def.kind !== "car") continue;
    const n = Math.min(40, Math.floor(sh.amount * 650 + rnd()));
    for (let i = 0; i < n; i++) {
      const r = rnd();
      const kind: DebrisKind = r < 0.22 ? "paint" : r < 0.3 ? "metal" : rnd() < sh.carbon ? "carbon" : "plastic";
      const sp = 1 + rnd() * 4;
      const a = rnd() * Math.PI * 2;
      add({
        kind,
        t: sh.t + rnd() * 0.002,
        p: [sh.x + jitter(0.18), Math.max(0.08, sh.y + jitter(0.12)), sh.z + jitter(0.18)],
        v: [sh.vx + Math.cos(a) * sp, 0.6 + rnd() * 3.2, sh.vz + Math.sin(a) * sp],
        size: kind === "paint" ? 0.006 + rnd() * 0.012 : kind === "metal" ? 0.01 + rnd() * 0.03 : 0.015 + rnd() * 0.07,
        color: kind === "paint" ? (def.paint ?? [0.5, 0.5, 0.5]) : kind === "plastic" ? (rnd() < 0.7 ? [0.02, 0.02, 0.022] : [0.08, 0.08, 0.085]) : [0.03, 0.03, 0.035],
        spin: (rnd() - 0.5) * 70,
      });
    }
  }

  for (const e of events) {
    const bi = "body" in e ? idx(e.body) : -1;
    const def = defs[bi];
    if (!def || def.kind !== "car") continue;
    const tr = tracks[bi];
    if (e.type === "lamp") {
      const head = e.lamp.startsWith("head");
      const left = e.lamp.endsWith("left");
      const x = head ? def.plan.cx + def.plan.hx - 0.12 : def.plan.cx - def.plan.hx + 0.12;
      const z = (left ? -1 : 1) * def.plan.hz * 0.7;
      const at = carPoint(tr, times, def, e.t, x, 0.65, z);
      for (let i = 0; i < 34; i++) {
        const sp = 1.5 + rnd() * 4;
        const a = rnd() * Math.PI * 2;
        add({
          kind: head ? (rnd() < 0.15 ? "amber" : "lens") : "red",
          t: e.t + rnd() * 0.004,
          p: [at.p[0] + jitter(0.12), at.p[1] + jitter(0.08), at.p[2] + jitter(0.12)],
          v: [at.v[0] + Math.cos(a) * sp, 0.8 + rnd() * 2.8, at.v[2] + Math.sin(a) * sp],
          size: 0.008 + rnd() * 0.035,
          color: [0.9, 0.92, 0.95],
          spin: (rnd() - 0.5) * 90,
        });
      }
    }
    if (e.type === "glass") {
      const count = e.kind === "shatter" ? 260 : 18;
      const side = e.pane.startsWith("left") ? -1 : e.pane.startsWith("right") ? 1 : 0;
      for (let i = 0; i < count; i++) {
        // tempered panes burst into cubes over their whole area; laminated screens only shed grit
        const ox = e.origin[0] + jitter(e.pane === "rear" || e.pane === "windscreen" ? 0.12 : 0.35);
        const oy = e.origin[1] + jitter(0.16);
        const oz = side ? e.origin[2] + jitter(0.04) : e.origin[2] + jitter(0.55);
        const at = carPoint(tr, times, def, e.t, ox, oy, oz);
        const yaw = at.yaw;
        // most of a struck side pane goes in with whatever hit it; some comes out
        const inward = side ? (rnd() < 0.65 ? -side : side) * (0.8 + rnd() * 2.4) : 0;
        const lx = jitter(1.4), lz = inward;
        add({
          kind: "glass",
          t: e.t + rnd() * 0.006,
          p: at.p,
          v: [at.v[0] + lx * Math.cos(yaw) + lz * Math.sin(yaw), 0.3 + rnd() * 2.2, at.v[2] - lx * Math.sin(yaw) + lz * Math.cos(yaw)],
          size: 0.005 + rnd() * 0.007,
          color: [0.85, 0.9, 0.9],
          spin: (rnd() - 0.5) * 120,
        });
      }
    }
  }

  // coolant from a crushed radiator (front-engined cars whose engine or radiator was shoved back)
  for (const [bi, def] of defs.entries()) {
    if (def.kind !== "car" || !def.coolant) continue;
    const tr = tracks[bi];
    const ri = tr.rigidIds.findIndex((id) => id === "radiator" || id === "engine");
    if (ri < 0) continue;
    const last = times.length - 1;
    const n = tr.rigidIds.length;
    const push = Math.hypot(tr.rigid[(last * n + ri) * 4], tr.rigid[(last * n + ri) * 4 + 2]);
    const front = def.rigid.find((r) => r.id === tr.rigidIds[ri]);
    if (push < 0.02 || !front || front.max[0] < def.plan.cx) continue;
    for (let i = 0; i < 46; i++) {
      const t = 0.03 + rnd() * 0.45;
      const at = carPoint(tr, times, def, t, front.max[0] + 0.15, 0.45, jitter(0.4));
      add({ kind: "coolant", t, p: at.p, v: [at.v[0] + jitter(0.6), -0.2 - rnd(), at.v[2] + jitter(0.6)], size: 0.006 + rnd() * 0.01, color: def.coolant, spin: 0 });
    }
  }

  return toSegments(pieces, rnd);
}

/** Flight, bounces, a slide, rest: each piece as segments of constant acceleration. */
function toSegments(pieces: Piece[], rnd: () => number): DebrisSet {
  const N = pieces.length;
  const kind = new Uint8Array(N), size = new Float32Array(N), color = new Float32Array(N * 3), axis = new Float32Array(N * 3);
  const first = new Uint32Array(N), count = new Uint16Array(N);
  const seg: number[] = [];
  for (let p = 0; p < N; p++) {
    const pc = pieces[p];
    const f = FEEL[pc.kind];
    kind[p] = DEBRIS_KINDS.indexOf(pc.kind);
    size[p] = pc.size;
    color.set(pc.color, p * 3);
    const ax = [rnd() - 0.5, rnd() - 0.5, rnd() - 0.5], l = Math.hypot(ax[0], ax[1], ax[2]) || 1;
    axis.set([ax[0] / l, ax[1] / l, ax[2] / l], p * 3);
    first[p] = seg.length / 12;
    let t = pc.t, [x, y, z] = pc.p, [vx, vy, vz] = pc.v, ang = rnd() * Math.PI * 2, spin = pc.spin;
    const rest = pc.size * 0.35;
    y = Math.max(rest, y);
    let n = 0;
    for (let b = 0; b < 6; b++) {
      // fly to the floor
      const h = y - rest;
      const tf = (vy + Math.sqrt(vy * vy + 2 * G * h)) / G;
      seg.push(t, x, y, z, vx, vy, vz, 0, -G, 0, ang, spin);
      n++;
      x += vx * tf;
      z += vz * tf;
      ang += spin * tf;
      t += tf;
      y = rest;
      const vImpact = vy - G * tf;
      vy = -vImpact * f.e;
      // the floor grabs the horizontal speed a little at every bounce
      vx *= 0.6 + 0.2 * (1 - f.mu);
      vz *= 0.6 + 0.2 * (1 - f.mu);
      spin *= f.keep;
      if (vy < 0.35 || f.e === 0) break;
    }
    // slide to a stop
    const sp = Math.hypot(vx, vz);
    if (sp > 0.02 && f.mu < 5) {
      const dec = f.mu * G;
      const ts = sp / dec;
      seg.push(t, x, rest, z, vx, 0, vz, (-vx / sp) * dec, 0, (-vz / sp) * dec, ang, spin * 0.5);
      n++;
      x += (vx * ts) / 2;
      z += (vz * ts) / 2;
      ang += spin * 0.25 * ts;
      t += ts;
    }
    seg.push(t, x, rest, z, 0, 0, 0, 0, 0, 0, ang, 0);
    n++;
    count[p] = n;
  }
  return { kind, size, color, axis, first, count, seg: Float32Array.from(seg) };
}
