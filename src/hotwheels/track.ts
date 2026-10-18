import * as THREE from "three";
import { TRACK } from "./units";

/**
 * Orange track, built the way you'd lay it on the floor: piece by piece, from a start point.
 *
 * A turtle walks the path in 0.5 cm steps carrying a yaw / pitch / roll frame, so every sample has
 * an exact position (the middle of the bed's top surface), tangent, surface normal and side vector
 * (side points to the car's left). Curvature comes from the samples, for the physics.
 */
export type Piece =
  /** a straight run; its first stretch eases any bank left from a curve back to level */
  | { k: "straight"; len: number }
  /** a horizontal curve (positive = left), keeping whatever slope the track has (a helix if sloped) */
  | { k: "turn"; r: number; deg: number; bank?: number }
  /** a vertical curve: positive bends the track upwards (dips, kickers), negative over a crest */
  | { k: "pitch"; r: number; deg: number }
  /** a full vertical loop, side-stepped by `offset` so the exit clears the entry (positive = left) */
  | { k: "loop"; r: number; offset: number };

export type Zone = { s0: number; s1: number };
export type Booster = Zone & { speed: number };

export type TrackSpec = {
  id: string;
  /** where the bed's top starts, and the heading (degrees; 0 = +z, 90 = +x) and slope it starts at */
  start: [number, number, number];
  yaw: number;
  pitch?: number;
  pieces: Piece[];
  /** what happens past each end: a stop (cars bounce off it) or nothing (they fly off) */
  startEnd?: "buffer" | "open";
  endEnd?: "buffer" | "open";
  /** how it stands up: pillars to the floor, arms in to a tower, or nothing (it's on the floor) */
  supports?: { mode: "pillar" } | { mode: "arms"; center: [number, number]; r: number } | { mode: "none" };
  /** no supports along these stretches (they're held by something else) */
  noSupport?: Zone[];
  /** a closed circuit: the end joins the start, and cars go round and round */
  closed?: boolean;
  /** stretches with no moulding at all (another piece covers them: a crossing) */
  gaps?: Zone[];
  /** stretches whose walls are cut away (where another lane runs across the bed) */
  openWalls?: Zone[];
};

const DS = 0.5;

/** One laid track: samples, plus where its loops and named pieces sit along it. */
export class Track {
  readonly id: string;
  readonly n: number;
  readonly length: number;
  readonly s: Float32Array;
  readonly p: Float32Array;
  readonly t: Float32Array;
  readonly u: Float32Array;
  readonly side: Float32Array;
  /** curvature vector (dT/ds), pointing at the centre of the bend */
  readonly k: Float32Array;
  readonly loops: Zone[] = [];
  readonly spec: TrackSpec;
  readonly bounds = new THREE.Box3();
  /** where each piece starts along the track (for placing launchers, boosters, finishes) */
  readonly pieceAt: number[] = [];
  boosters: Booster[] = [];
  /** foam run-outs that slow cars hard (the drag strip's shut-down area) */
  brakes: Zone[] = [];
  /** a launcher plunger or a release gate holds cars here until it fires */
  hold: { s: number; kind: "launcher" | "gate" } | null = null;
  finish: number | null = null;
  index = 0;

  constructor(spec: TrackSpec) {
    this.spec = spec;
    this.id = spec.id;
    const pts: number[] = [];
    const tan: number[] = [];
    const up: number[] = [];
    const sd: number[] = [];
    const ss: number[] = [];

    let yaw = THREE.MathUtils.degToRad(spec.yaw);
    let pitch = THREE.MathUtils.degToRad(spec.pitch ?? 0);
    let roll = 0;
    const pos = new THREE.Vector3(...spec.start);
    const F = new THREE.Vector3();
    const U = new THREE.Vector3();
    const S = new THREE.Vector3();
    let s = 0;

    const frame = (y: number, p: number, r: number) => {
      const cy = Math.cos(y), sy = Math.sin(y), cp = Math.cos(p), sp = Math.sin(p);
      F.set(sy * cp, sp, cy * cp);
      // level up, and level left (left = up × forward)
      U.set(-sy * sp, cp, -cy * sp);
      S.crossVectors(U, F);
      if (r) {
        const cr = Math.cos(r), sr = Math.sin(r);
        const ux = U.x * cr + S.x * sr, uy = U.y * cr + S.y * sr, uz = U.z * cr + S.z * sr;
        S.crossVectors(U.set(ux, uy, uz), F);
      }
    };
    const emit = () => {
      frame(yaw, pitch, roll);
      pts.push(pos.x, pos.y, pos.z);
      tan.push(F.x, F.y, F.z);
      up.push(U.x, U.y, U.z);
      sd.push(S.x, S.y, S.z);
      ss.push(s);
    };
    emit();

    /** Walk `len` cm; `rate(u)` gives the angle rates and side-step at fraction u of the piece. */
    const walk = (len: number, step: (u: number, ds: number) => { dyaw?: number; dpitch?: number; roll?: number; shift?: number }) => {
      const n = Math.max(1, Math.ceil(len / DS));
      const ds = len / n;
      const off = new THREE.Vector3();
      for (let i = 0; i < n; i++) {
        const um = (i + 0.5) / n;
        const r = step(um, ds);
        // midpoint integration: turn half, move, turn half
        yaw += (r.dyaw ?? 0) / 2;
        pitch += (r.dpitch ?? 0) / 2;
        if (r.roll !== undefined) roll = r.roll;
        frame(yaw, pitch, 0);
        pos.addScaledVector(F, ds);
        if (r.shift) pos.addScaledVector(off.copy(S), r.shift);
        yaw += (r.dyaw ?? 0) / 2;
        pitch += (r.dpitch ?? 0) / 2;
        s += ds;
        emit();
      }
    };
    const ease = (u: number) => u * u * (3 - 2 * u);

    for (const pc of spec.pieces) {
      this.pieceAt.push(s);
      const roll0 = roll;
      if (pc.k === "straight") {
        const settle = Math.min(pc.len / 2, 14);
        walk(pc.len, (u) => ({ roll: roll0 * (1 - ease(Math.min(1, (u * pc.len) / settle))) }));
      } else if (pc.k === "turn") {
        const ang = THREE.MathUtils.degToRad(pc.deg);
        const dir = Math.sign(ang);
        const target = THREE.MathUtils.degToRad(pc.bank ?? 0) * dir;
        const cp = Math.cos(pitch);
        const len = (pc.r * Math.abs(ang)) / Math.max(0.2, cp);
        const into = Math.min(len / 3, 14);
        walk(len, (u, ds) => ({ dyaw: (dir * ds * cp) / pc.r, roll: roll0 + (target - roll0) * ease(Math.min(1, (u * len) / into)) }));
      } else if (pc.k === "pitch") {
        const ang = THREE.MathUtils.degToRad(pc.deg);
        const len = pc.r * Math.abs(ang);
        const settle = Math.min(len / 2, 10);
        walk(len, (u, ds) => ({ dpitch: (Math.sign(ang) * ds) / pc.r, roll: roll0 * (1 - ease(Math.min(1, (u * len) / settle))) }));
      } else {
        const len = pc.r * Math.PI * 2;
        const s0 = s;
        let prev = 0;
        walk(len, (u, ds) => {
          // side-step through the loop on an eased curve, so the exit runs beside the entry
          const e = ease(u + ds / len / 2);
          const shift = (e - prev) * pc.offset;
          prev = e;
          return { dpitch: ds / pc.r, roll: 0, shift };
        });
        this.loops.push({ s0, s1: s });
        // pitch has wound a full turn: unwind it so later maths sees the same slope
        pitch -= Math.PI * 2;
      }
    }

    // a closed circuit: spread the turtle's tiny drift over the lap so the ends meet exactly
    if (spec.closed) {
      const last = ss.length - 1;
      const ex = pts[last * 3] - pts[0], ey = pts[last * 3 + 1] - pts[1], ez = pts[last * 3 + 2] - pts[2];
      for (let i = 0; i <= last; i++) {
        const k = ss[i] / s;
        pts[i * 3] -= ex * k;
        pts[i * 3 + 1] -= ey * k;
        pts[i * 3 + 2] -= ez * k;
      }
    }

    this.n = ss.length;
    this.length = s;
    this.s = Float32Array.from(ss);
    this.p = Float32Array.from(pts);
    this.t = Float32Array.from(tan);
    this.u = Float32Array.from(up);
    this.side = Float32Array.from(sd);
    this.k = new Float32Array(this.n * 3);
    for (let i = 0; i < this.n; i++) {
      let a = Math.max(0, i - 1);
      let b = Math.min(this.n - 1, i + 1);
      let d = this.s[b] - this.s[a] || 1;
      // a circuit's first and last samples are the same point: look across the join
      if (spec.closed && (i === 0 || i === this.n - 1)) {
        a = this.n - 2;
        b = 1;
        d = this.s[1] + (this.length - this.s[this.n - 2]);
      }
      for (let c = 0; c < 3; c++) this.k[i * 3 + c] = (this.t[b * 3 + c] - this.t[a * 3 + c]) / d;
      this.bounds.expandByPoint(new THREE.Vector3(this.p[i * 3], this.p[i * 3 + 1], this.p[i * 3 + 2]));
    }
    this.bounds.expandByScalar(4);
  }

  /** The sample index at or just below arc length s (walks from a hint: cars move a little per step). */
  locate(s: number, hint = 0) {
    let i = Math.max(0, Math.min(this.n - 2, hint));
    while (i < this.n - 2 && this.s[i + 1] <= s) i++;
    while (i > 0 && this.s[i] > s) i--;
    return i;
  }

  get closed() {
    return !!this.spec.closed;
  }

  /** Arc length brought into range on a closed circuit (left alone on an open track). */
  wrap(s: number) {
    if (!this.spec.closed) return s;
    const L = this.length;
    return s - Math.floor(s / L) * L;
  }

  /** Signed distance from a to b along the track (the short way round on a circuit). */
  delta(a: number, b: number) {
    const d = b - a;
    if (!this.spec.closed) return d;
    const L = this.length;
    return d - Math.round(d / L) * L;
  }

  /** Interpolated frame at arc length s, written into `out`. Returns the sample index (a hint for next time). */
  frameAt(s: number, out: TrackFrame, hint = 0) {
    s = this.wrap(s);
    const i = this.locate(s, hint);
    const j = i + 1;
    const f = Math.max(0, Math.min(1, (s - this.s[i]) / (this.s[j] - this.s[i] || 1)));
    const mix = (arr: Float32Array, v: THREE.Vector3) =>
      v.set(arr[i * 3] + (arr[j * 3] - arr[i * 3]) * f, arr[i * 3 + 1] + (arr[j * 3 + 1] - arr[i * 3 + 1]) * f, arr[i * 3 + 2] + (arr[j * 3 + 2] - arr[i * 3 + 2]) * f);
    mix(this.p, out.p);
    // past either end the track carries straight on (a car only looks there for an instant)
    if (s > this.length) out.p.addScaledVector(mix(this.t, out.t).normalize(), s - this.length);
    if (s < 0) out.p.addScaledVector(mix(this.t, out.t).normalize(), s);
    mix(this.t, out.t).normalize();
    mix(this.u, out.u).normalize();
    mix(this.side, out.side).normalize();
    mix(this.k, out.k);
    return i;
  }

  point(i: number, out: THREE.Vector3) {
    return out.set(this.p[i * 3], this.p[i * 3 + 1], this.p[i * 3 + 2]);
  }
}

export type TrackFrame = { p: THREE.Vector3; t: THREE.Vector3; u: THREE.Vector3; side: THREE.Vector3; k: THREE.Vector3 };
export const newFrame = (): TrackFrame => ({ p: new THREE.Vector3(), t: new THREE.Vector3(), u: new THREE.Vector3(), side: new THREE.Vector3(), k: new THREE.Vector3() });

// —————————————————————————————————————————————————————————— geometry

type Seg = { a: [number, number]; b: [number, number]; na: [number, number]; nb: [number, number]; top?: boolean };

/**
 * The cross-section, in (side, up) around the bed's top centre: the bed, two walls with rounded
 * tops, and the skirt underneath that the connectors clip into. Each flat face has its own
 * normals (crisp moulded edges); the wall tops are smooth.
 */
function profile(): Seg[] {
  const W = TRACK.bed / 2;
  const H = TRACK.wall;
  const T = TRACK.wallT;
  const D = TRACK.thick;
  const rr = T / 2;
  const skirt = -0.62;
  const right: Seg[] = [];
  right.push({ a: [W, 0], b: [W, H - rr], na: [-1, 0], nb: [-1, 0] });
  const cx = W + rr;
  const cy = H - rr;
  const N = 5;
  for (let i = 0; i < N; i++) {
    const a0 = Math.PI - (i / N) * Math.PI;
    const a1 = Math.PI - ((i + 1) / N) * Math.PI;
    right.push({
      a: [cx + Math.cos(a0) * rr, cy + Math.sin(a0) * rr],
      b: [cx + Math.cos(a1) * rr, cy + Math.sin(a1) * rr],
      na: [Math.cos(a0), Math.sin(a0)],
      nb: [Math.cos(a1), Math.sin(a1)],
      top: true,
    });
  }
  right.push({ a: [W + T, H - rr], b: [W + T, skirt], na: [1, 0], nb: [1, 0] });
  right.push({ a: [W + T, skirt], b: [W + T - 0.24, skirt], na: [0, -1], nb: [0, -1] });
  right.push({ a: [W + T - 0.24, skirt], b: [W + T - 0.24, -D], na: [-1, 0], nb: [-1, 0] });
  const mirror = (sg: Seg): Seg => ({ a: [-sg.b[0], sg.b[1]], b: [-sg.a[0], sg.a[1]], na: [-sg.nb[0], sg.nb[1]], nb: [-sg.na[0], sg.na[1]], top: sg.top });
  const bed: Seg = { a: [-W, 0], b: [W, 0], na: [0, 1], nb: [0, 1] };
  const under: Seg = { a: [W + T - 0.24, -D], b: [-(W + T - 0.24), -D], na: [0, -1], nb: [0, -1] };
  return [bed, ...right, under, ...right.map(mirror).reverse()];
}

/**
 * Sweep the cross-section along the track. UVs: u runs along the track in track pieces (one
 * texture repeat per 30 cm piece, so the joint seam lands on every connector), v around the profile
 * (0..1). A `glow` attribute marks the wall tops for the glow-in-the-dark strips at night.
 */
export function trackGeometry(track: Track, stride = 1) {
  const segs = profile();
  const total = segs.reduce((a, sg) => a + Math.hypot(sg.b[0] - sg.a[0], sg.b[1] - sg.a[1]), 0);
  const idx: number[] = [];
  const pos: number[] = [];
  const nrm: number[] = [];
  const uv: number[] = [];
  const glow: number[] = [];
  const inZone = (zs: Zone[] | undefined, sv: number) => !!zs && zs.some((z) => sv >= z.s0 && sv <= z.s1);
  const all: number[] = [];
  for (let i = 0; i < track.n; i += stride) all.push(i);
  if (all[all.length - 1] !== track.n - 1) all.push(track.n - 1);
  // rows inside a gap are left out, and a quad is only laid between rows that are neighbours
  const kept = all.map((i) => !inZone(track.spec.gaps, track.s[i]));
  const rows = all.filter((_, k) => kept[k]);
  const joined = all.flatMap((_, k) => (kept[k] ? [k + 1 < all.length && kept[k + 1]] : []));
  const wallK = rows.map((i) => (inZone(track.spec.openWalls, track.s[i]) ? 0 : 1));
  let vAcc = 0;
  for (const sg of segs) {
    const len = Math.hypot(sg.b[0] - sg.a[0], sg.b[1] - sg.a[1]);
    const v0 = vAcc / total;
    const v1 = (vAcc + len) / total;
    vAcc += len;
    const base = pos.length / 3;
    for (let r = 0; r < rows.length; r++) {
      const i = rows[r];
      const px = track.p[i * 3], py = track.p[i * 3 + 1], pz = track.p[i * 3 + 2];
      const ux = track.u[i * 3], uy = track.u[i * 3 + 1], uz = track.u[i * 3 + 2];
      const sx = track.side[i * 3], sy = track.side[i * 3 + 1], sz = track.side[i * 3 + 2];
      // profile x is to the right, and side points left
      for (const [pt, n, v] of [
        [sg.a, sg.na, v0],
        [sg.b, sg.nb, v1],
      ] as const) {
        const x = -pt[0];
        // a cut-away wall folds down flat into the bed's lip
        const y = pt[1] > 0 ? pt[1] * wallK[r] : pt[1];
        pos.push(px + sx * x + ux * y, py + sy * x + uy * y, pz + sz * x + uz * y);
        const nx = -n[0];
        const ny = n[1];
        nrm.push(sx * nx + ux * ny, sy * nx + uy * ny, sz * nx + uz * ny);
        uv.push(track.s[i] / TRACK.piece, v);
        glow.push(sg.top ? 1 : 0);
      }
    }
    for (let r = 0; r < rows.length - 1; r++) {
      if (!joined[r]) continue;
      const a = base + r * 2;
      const b = a + 1;
      const c = a + 2;
      const d = a + 3;
      idx.push(a, c, b, b, c, d);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("normal", new THREE.Float32BufferAttribute(nrm, 3));
  g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute("aGlow", new THREE.Float32BufferAttribute(glow, 1));
  g.setIndex(idx);
  // make the winding agree with the normals (it depends on which way the sweep runs)
  fixWinding(g);
  g.computeBoundingSphere();
  g.computeBoundingBox();
  return g;
}

function fixWinding(g: THREE.BufferGeometry) {
  const p = g.attributes.position;
  const n = g.attributes.normal;
  const index = g.index!;
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), fn = new THREE.Vector3(), vn = new THREE.Vector3();
  let agree = 0;
  for (let f = 0; f < Math.min(index.count, 3000); f += 3) {
    const i0 = index.getX(f), i1 = index.getX(f + 1), i2 = index.getX(f + 2);
    a.fromBufferAttribute(p, i0);
    b.fromBufferAttribute(p, i1).sub(a);
    c.fromBufferAttribute(p, i2).sub(a);
    fn.crossVectors(b, c);
    vn.fromBufferAttribute(n, i0);
    agree += Math.sign(fn.dot(vn));
  }
  if (agree >= 0) return;
  const arr = index.array as Uint32Array | Uint16Array;
  for (let f = 0; f < arr.length; f += 3) {
    const t = arr[f + 1];
    arr[f + 1] = arr[f + 2];
    arr[f + 2] = t;
  }
  index.needsUpdate = true;
}

/** Where connectors and supports go: a frame every `every` cm along the track. */
export function marks(track: Track, every: number, offset = 0) {
  const out: { s: number; f: TrackFrame }[] = [];
  let hint = 0;
  for (let s = offset; s <= track.length + 0.01; s += every) {
    const f = newFrame();
    hint = track.frameAt(Math.min(s, track.length), f, hint);
    out.push({ s, f });
  }
  return out;
}

/**
 * A spatial hash over every track's samples (10 cm cells), so a flying car can find the track
 * under it quickly.
 */
export class TrackIndex {
  private cells = new Map<number, number[]>();
  private static CELL = 10;
  constructor(readonly tracks: Track[]) {
    tracks.forEach((tr, ti) => {
      for (let i = 0; i < tr.n; i += 2) {
        const key = this.key(tr.p[i * 3], tr.p[i * 3 + 1], tr.p[i * 3 + 2]);
        let list = this.cells.get(key);
        if (!list) this.cells.set(key, (list = []));
        list.push(ti, i);
      }
    });
  }
  private key(x: number, y: number, z: number) {
    const c = TrackIndex.CELL;
    return ((Math.floor(x / c) + 512) * 1024 + (Math.floor(z / c) + 512)) * 64 + Math.max(0, Math.min(63, Math.floor(y / c) + 4));
  }
  /** Calls `fn(track, sampleIndex)` for samples within a cell of p (deduplicated per track: nearest only). */
  near(p: THREE.Vector3, fn: (ti: number, i: number, d2: number) => void) {
    const best = new Map<number, { i: number; d2: number }>();
    const c = TrackIndex.CELL;
    for (let dx = -1; dx <= 1; dx++)
      for (let dz = -1; dz <= 1; dz++)
        for (let dy = -1; dy <= 1; dy++) {
          const list = this.cells.get(this.key(p.x + dx * c, p.y + dy * c, p.z + dz * c));
          if (!list) continue;
          for (let k = 0; k < list.length; k += 2) {
            const ti = list[k];
            const i = list[k + 1];
            const tr = this.tracks[ti];
            const d2 = (tr.p[i * 3] - p.x) ** 2 + (tr.p[i * 3 + 1] - p.y) ** 2 + (tr.p[i * 3 + 2] - p.z) ** 2;
            const b = best.get(ti);
            if (!b || d2 < b.d2) best.set(ti, { i, d2 });
          }
        }
    for (const [ti, b] of best) fn(ti, b.i, b.d2);
  }
}
