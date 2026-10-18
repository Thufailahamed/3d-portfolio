import RAPIER from "@dimforge/rapier3d-compat";
import type { Layout, Piece } from "./layout";
import { PLATE } from "./units";

export const GRAVITY = 42;
/** one tick of wall-clock time; the world advances by `h` per tick (less in slow motion) */
const STEP = 1 / 60;
/** what you throw: a 2 × 4 brick (half extents) */
export const SHOT = { hx: 2 - 0.006, hy: 0.6, hz: 1 - 0.006 };
const SHOT_REACH = 1.4;
export const MAX_SHOTS = 40;
/** a clutch in a falling chunk lets go when its two pieces are wrenched this far out of line */
const SLIP = 0.09;
const TWIST = 0.1;
/**
 * Weightless: the chance a clutch survives the float wave (so some pieces drift off as little
 * clipped-together chunks rather than all on their own), and the biggest chunk it leaves.
 */
const HOLD = 0.32;
const CHUNK_MAX = 6;
/** how bouncy and how draggy pieces are with gravity on, and weightless (cabin air, still) */
const BOUNCE = 0.12;
const BOUNCE_ZG = 0.42;
const DRAG = { lin: 0.04, ang: 0.12 };
const DRAG_ZG = { lin: 0.1, ang: 0.05 };

type Vec = { x: number; y: number; z: number };
type Quat = Vec & { w: number };

/** Two pieces clipped together (b = -1: the baseplate). */
type Clutch = {
  a: number;
  b: number;
  /** the shared point, in each piece's frame (rest rotations are all identity) */
  la: Vec;
  lb: Vec;
  broken: boolean;
  /** the physical joint, only while both pieces are loose and falling together */
  joint: RAPIER.ImpulseJoint | null;
};

type Ball = { rb: RAPIER.RigidBody; handle: number; born: number; color: number; floated?: boolean };

/** A chunk the float wave lets go of at `at`: its pieces, and the rigid drift they share. */
type Float = { ids: number[]; at: number; v: Vec; w: Vec; c: Vec };

type Anim = { from: Vec; fromQ: Quat; delay: number; dur: number; lift: number; landed: boolean; grow: boolean };

/**
 * The vacuum, as the physics sees it: where its floor head is and which way it faces, whether
 * it's running (and on boost), and where its bin is (swallowed pieces fly home from there).
 */
export type Suction = { on: boolean; boost: boolean; x: number; z: number; yaw: number; bin: Vec | null; wand: { k: Vec; b: Vec; top: Vec } | null };
/** how thick the wand and the body are, for what they knock into */
const WAND_R = 0.6;
const BODY_R = 2.3;

/** Distance from a point to the segment a–b. */
const toSegment = (p: Vec, a: Vec, b: Vec) => {
  const abx = b.x - a.x;
  const aby = b.y - a.y;
  const abz = b.z - a.z;
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * abx + (p.y - a.y) * aby + (p.z - a.z) * abz) / (abx * abx + aby * aby + abz * abz || 1)));
  const dx = p.x - (a.x + abx * t);
  const dy = p.y - (a.y + aby * t);
  const dz = p.z - (a.z + abz * t);
  return { d: Math.hypot(dx, dy, dz), dx, dy, dz };
};
/** the floor head's footprint (half extents, in its own frame: x across, z forward) */
export const HEAD = { hx: 6, hz: 2.1, top: 2.3 };
/** the intake runs the width of the head, just behind its front lip */
const MOUTH_Z = 1.4;
const MOUTH_HALF = 5.4;
/** how far the airflow reaches: loose pieces, and pieces still clipped in (harder on boost) */
const PULL = 10;
const TUG = 3.2;
const TUG_BOOST = 6.5;
/** a piece being swallowed takes this long to vanish under the lip */
const GULP = 0.16;

type Gulp = { id: number; from: Vec; fromQ: Quat; spin: Quat; t: number };

export type Swallow = (kind: "piece" | "shot", idOrColor: number, at: Vec) => void;

export type ImpactKind = "brick" | "ball" | "snap";
export type Impact = (kind: ImpactKind, strength: number, at: Vec) => void;

const IDENTITY: Quat = { x: 0, y: 0, z: 0, w: 1 };

const slerp = (a: Quat, b: Quat, t: number): Quat => {
  let { x, y, z, w } = b;
  let cos = a.x * x + a.y * y + a.z * z + a.w * w;
  if (cos < 0) {
    cos = -cos;
    x = -x;
    y = -y;
    z = -z;
    w = -w;
  }
  let k0 = 1 - t;
  let k1 = t;
  if (cos < 0.9995) {
    const s = Math.sqrt(1 - cos * cos);
    const ang = Math.atan2(s, cos);
    k0 = Math.sin((1 - t) * ang) / s;
    k1 = Math.sin(t * ang) / s;
  }
  const q = { x: a.x * k0 + x * k1, y: a.y * k0 + y * k1, z: a.z * k0 + z * k1, w: a.w * k0 + w * k1 };
  const l = Math.hypot(q.x, q.y, q.z, q.w) || 1;
  return { x: q.x / l, y: q.y / l, z: q.z / l, w: q.w / l };
};

const rotate = (q: Quat, v: Vec): Vec => {
  const ix = q.w * v.x + q.y * v.z - q.z * v.y;
  const iy = q.w * v.y + q.z * v.x - q.x * v.z;
  const iz = q.w * v.z + q.x * v.y - q.y * v.x;
  const iw = -q.x * v.x - q.y * v.y - q.z * v.z;
  return {
    x: ix * q.w + iw * -q.x + iy * -q.z - iz * -q.y,
    y: iy * q.w + iw * -q.y + iz * -q.x - ix * -q.z,
    z: iz * q.w + iw * -q.z + ix * -q.y - iy * -q.x,
  };
};

let ready: Promise<void> | null = null;
export const initPhysics = () => (ready ??= RAPIER.init());

/**
 * The brick world.
 *
 * A built piece is a fixed body: perfectly rigid and free to simulate, the way clutched bricks
 * behave. A hard hit pops the struck pieces off everything they're clipped to and lets them go;
 * then a support check walks the clutch graph up from the baseplate, and whatever no longer
 * connects to it falls as a chunk, its pieces still jointed to each other until the landing
 * wrenches them apart. So a wall takes a ball and comes down a chunk at a time, and a hole
 * in a wall doesn't bring down what's still clipped in around it.
 */
export class BrickPhysics {
  readonly world: RAPIER.World;
  readonly pieces: Piece[];
  /** live pose of every piece, read by the renderer */
  readonly pos: Float32Array;
  readonly quat: Float32Array;
  /** 1 while a piece is lost off the edge of the world */
  readonly lost: Uint8Array;
  /** 1 once a piece has been knocked loose (it simulates until the next rebuild) */
  readonly loose: Uint8Array;
  /** drawn size of each piece (1, or shrinking as the vacuum swallows it) */
  readonly scale: Float32Array;
  /** 1 while a piece is being swallowed or sits in the vacuum's bin */
  readonly swallowed: Uint8Array;
  /** speed along x for each car (0 for everything else), and where each car has got to */
  readonly drives: Float32Array;
  private carX: Float32Array;
  /** simulated seconds per tick: STEP, or a fraction of it in slow motion */
  private h = STEP;
  private bounds: Layout["bounds"];
  private bodies: RAPIER.RigidBody[] = [];
  private byHandle = new Map<number, number>();
  private clutches: Clutch[];
  private byBody: number[][];
  private ground: RAPIER.RigidBody;
  private groundHandle = -1;
  private queue: RAPIER.EventQueue;
  private balls: Ball[] = [];
  private ballByHandle = new Map<number, Ball>();
  private anims: Anim[] | null = null;
  private animT = 0;
  private acc = 0;
  private clock = 0;
  private breakForce: Float32Array;
  private unsupported = false;
  private looseCount = 0;
  private gulps: Gulp[] = [];
  private tug: Float32Array;
  /** gravity's strength (1 normal … 0 weightless), and the level the loose pieces were last woken at */
  private g = 1;
  private woke = 1;
  /** pieces the float wave has reached, and the chunks still waiting to let go */
  private floated: Uint8Array;
  private floats: Float[] = [];
  suction: Suction = { on: false, boost: false, x: 0, z: 0, yaw: 0, bin: null, wand: null };
  onSwallow: Swallow = () => {};
  onImpact: Impact = () => {};
  onRebuilt: () => void = () => {};

  constructor(layout: Layout) {
    this.pieces = layout.pieces;
    const n = this.pieces.length;
    this.pos = new Float32Array(n * 3);
    this.quat = new Float32Array(n * 4);
    this.lost = new Uint8Array(n);
    this.loose = new Uint8Array(n);
    this.breakForce = new Float32Array(n);
    this.scale = new Float32Array(n).fill(1);
    this.swallowed = new Uint8Array(n);
    this.tug = new Float32Array(n);
    this.floated = new Uint8Array(n);
    this.drives = new Float32Array(n);
    this.carX = new Float32Array(n);
    this.bounds = layout.bounds;
    for (const p of this.pieces) if (p.special === "car") {
      this.drives[p.id] = p.drive ?? 0;
      this.carX[p.id] = p.x;
    }

    const world = new RAPIER.World({ x: 0, y: -GRAVITY, z: 0 });
    world.timestep = STEP;
    world.numSolverIterations = 6;
    this.world = world;
    this.queue = new RAPIER.EventQueue(true);

    const { x0, x1, z0, z1 } = layout.bounds;
    // the baseplate body sits at the origin so clutch anchors on it are plain world points
    this.ground = world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
    this.groundHandle = world.createCollider(
      RAPIER.ColliderDesc.cuboid((x1 - x0) / 2, 0.5, (z1 - z0) / 2).setTranslation((x0 + x1) / 2, -0.5, (z0 + z1) / 2).setFriction(0.8).setRestitution(0.1),
      this.ground,
    ).handle;

    const events = RAPIER.ActiveEvents.COLLISION_EVENTS | RAPIER.ActiveEvents.CONTACT_FORCE_EVENTS;
    for (const p of this.pieces) {
      // cars drive (kinematic) until something hits them; everything built is fixed until knocked
      const desc0 = this.drives[p.id] ? RAPIER.RigidBodyDesc.kinematicPositionBased() : RAPIER.RigidBodyDesc.fixed();
      const rb = world.createRigidBody(desc0.setTranslation(p.x, p.y, p.z).setLinearDamping(DRAG.lin).setAngularDamping(DRAG.ang));
      const hy = (p.h * PLATE) / 2;
      // a hair narrower than the grid so side-by-side bricks don't grind on each other
      const desc = p.round ? RAPIER.ColliderDesc.cylinder(hy, p.w / 2 - 0.006) : RAPIER.ColliderDesc.cuboid(p.w / 2 - 0.006, hy, p.d / 2 - 0.006);
      const mass = p.w * p.d * p.h * PLATE * (p.round ? 0.785 : 1);
      // light pieces pop off easily, big ones take a real hit
      this.breakForce[p.id] = this.drives[p.id] ? 14000 : 2200 + mass * 300;
      desc.setDensity(1).setFriction(0.62).setRestitution(BOUNCE).setActiveEvents(events).setContactForceEventThreshold(1500);
      const col = world.createCollider(desc, rb);
      this.bodies.push(rb);
      this.byHandle.set(col.handle, p.id);
    }

    this.clutches = layout.joints.map(([a, b]) => this.makeClutch(a, b));
    this.byBody = Array.from({ length: n }, () => []);
    this.clutches.forEach((c, i) => {
      this.byBody[c.a].push(i);
      if (c.b >= 0) this.byBody[c.b].push(i);
    });
    this.readPoses(true);
  }

  /** The point two pieces share: the middle of their overlap on the face between them. */
  private makeClutch(a: number, b: number): Clutch {
    const A = this.pieces[a];
    const base = { a, b, broken: false, joint: null };
    if (b < 0) return { ...base, la: { x: 0, y: -(A.h * PLATE) / 2, z: 0 }, lb: { x: A.x, y: A.y - (A.h * PLATE) / 2, z: A.z } };
    const B = this.pieces[b];
    const ox = (Math.max(A.x - A.w / 2, B.x - B.w / 2) + Math.min(A.x + A.w / 2, B.x + B.w / 2)) / 2;
    const oz = (Math.max(A.z - A.d / 2, B.z - B.d / 2) + Math.min(A.z + A.d / 2, B.z + B.d / 2)) / 2;
    const stacked = Math.abs(A.y + (A.h * PLATE) / 2 - (B.y - (B.h * PLATE) / 2)) < 1e-3;
    const p = stacked ? { x: ox, y: A.y + (A.h * PLATE) / 2, z: oz } : { x: (A.x + B.x) / 2, y: (A.y + B.y) / 2, z: (A.z + B.z) / 2 };
    return { ...base, la: { x: p.x - A.x, y: p.y - A.y, z: p.z - A.z }, lb: { x: p.x - B.x, y: p.y - B.y, z: p.z - B.z } };
  }

  private release(i: number) {
    const c = this.clutches[i];
    if (c.broken) return;
    c.broken = true;
    if (c.joint) {
      this.world.removeImpulseJoint(c.joint, true);
      c.joint = null;
    }
    this.unsupported = true;
  }

  /** Make a piece a real, falling body. */
  private loosen(id: number) {
    if (this.loose[id]) return;
    this.loose[id] = 1;
    this.looseCount++;
    this.bodies[id].setBodyType(RAPIER.RigidBodyType.Dynamic, true);
    // a car that's hit keeps rolling the way it was going
    if (this.drives[id]) this.bodies[id].setLinvel({ x: this.drives[id], y: 0, z: 0 }, true);
  }

  /** Pop a piece off everything it's clipped to and let it go. */
  knock(id: number) {
    for (const i of this.byBody[id]) this.release(i);
    this.loosen(id);
  }

  /**
   * Whatever no longer connects to the baseplate through unbroken clutches falls. Pieces that
   * fall together stay jointed to each other, so a chunk comes down as a chunk.
   */
  private settleSupport() {
    this.unsupported = false;
    const n = this.pieces.length;
    const held = new Uint8Array(n);
    const stack: number[] = [];
    for (const c of this.clutches)
      if (c.b < 0 && !c.broken && !this.loose[c.a] && !held[c.a]) {
        held[c.a] = 1;
        stack.push(c.a);
      }
    while (stack.length) {
      const id = stack.pop()!;
      for (const i of this.byBody[id]) {
        const c = this.clutches[i];
        if (c.broken) continue;
        const other = c.a === id ? c.b : c.a;
        if (other < 0 || held[other] || this.loose[other]) continue;
        held[other] = 1;
        stack.push(other);
      }
    }
    // weightless, a build with its footing knocked out just hangs there, still clipped together
    if (this.g > 0.5) for (let id = 0; id < n; id++) if (!held[id] && !this.loose[id] && !this.drives[id]) this.loosen(id);
    // joints hold each falling chunk together
    for (const c of this.clutches) {
      if (c.broken || c.joint || c.b < 0 || !this.loose[c.a] || !this.loose[c.b]) continue;
      c.joint = this.world.createImpulseJoint(RAPIER.JointData.fixed(c.la, IDENTITY, c.lb, IDENTITY), this.bodies[c.a], this.bodies[c.b], true);
    }
  }

  get animating() {
    return this.anims !== null;
  }

  /** Is this piece flying home in a rebuild right now? */
  flying(id: number) {
    return this.anims !== null && this.anims[id].dur > 0;
  }

  /** How many pieces are no longer where they were built. */
  displaced() {
    let n = 0;
    for (const p of this.pieces) {
      const i = p.id;
      if (!this.loose[i]) continue;
      if (this.lost[i]) {
        n++;
        continue;
      }
      const dx = this.pos[i * 3] - p.x;
      const dy = this.pos[i * 3 + 1] - p.y;
      const dz = this.pos[i * 3 + 2] - p.z;
      if (dx * dx + dy * dy + dz * dz > 0.36 || Math.abs(this.quat[i * 4 + 3]) < 0.985) n++;
    }
    return n;
  }

  /** Is this piece standing where it was built (e.g. the minifig, to keep waving)? */
  atHome(id: number) {
    return !this.loose[id] && !this.anims;
  }

  /** Throw a brick from `from` so it lands on `to`, arriving at roughly `speed`. */
  throwBall(from: Vec, to: Vec, speed: number, color = 0) {
    const d = Math.hypot(to.x - from.x, to.y - from.y, to.z - from.z);
    const t = Math.max(0.12, d / speed);
    // aim high by exactly what gravity will take back on the way
    const v = { x: (to.x - from.x) / t, y: (to.y - from.y) / t + 0.5 * this.gravity * t, z: (to.z - from.z) / t };
    const rb = this.world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic().setTranslation(from.x, from.y, from.z).setLinvel(v.x, v.y, v.z).setCcdEnabled(true).setAngularDamping(0.4).setLinearDamping(0.02),
    );
    // tumbling end over end, the way a thrown brick does
    rb.setRotation(slerp(IDENTITY, { x: Math.random() - 0.5, y: Math.random() - 0.5, z: Math.random() - 0.5, w: Math.random() - 0.5 }, 1), true);
    rb.setAngvel({ x: Math.random() * 14 - 7, y: Math.random() * 6 - 3, z: Math.random() * 14 - 7 }, true);
    const col = this.world.createCollider(
      RAPIER.ColliderDesc.cuboid(SHOT.hx, SHOT.hy, SHOT.hz).setDensity(1.8).setFriction(0.6).setRestitution(0.2).setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS),
      rb,
    );
    const ball = { rb, handle: col.handle, born: this.clock, color };
    this.balls.push(ball);
    this.ballByHandle.set(col.handle, ball);
    while (this.balls.length > MAX_SHOTS) this.dropBall(this.balls[0]);
  }

  private dropBall(b: Ball) {
    this.ballByHandle.delete(b.handle);
    this.balls.splice(this.balls.indexOf(b), 1);
    this.world.removeRigidBody(b.rb);
  }

  /** Thrown-brick poses for the renderer: [x, y, z, qx, qy, qz, qw, age, colour] each. */
  ballPoses(out: number[]) {
    out.length = 0;
    for (const b of this.balls) {
      const t = b.rb.translation();
      const q = b.rb.rotation();
      out.push(t.x, t.y, t.z, q.x, q.y, q.z, q.w, this.clock - b.born, b.color);
    }
    return out;
  }

  /** First thing a ray hits (for aiming), or null. */
  castRay(o: Vec, d: Vec, max = 600) {
    const hit = this.world.castRay(new RAPIER.Ray(o, d), max, true);
    return hit ? { x: o.x + d.x * hit.timeOfImpact, y: o.y + d.y * hit.timeOfImpact, z: o.z + d.z * hit.timeOfImpact } : null;
  }

  /**
   * What a paintball's path hits first: the piece (-1 the baseplate, -2 a thrown brick or anything
   * else), how far along the ray, and the surface normal there.
   */
  castShot(o: Vec, d: Vec, max: number) {
    const hit = this.world.castRayAndGetNormal(new RAPIER.Ray(o, d), max, true);
    if (!hit) return null;
    const h = hit.collider.handle;
    const id = this.byHandle.get(h) ?? (h === this.groundHandle ? -1 : -2);
    const ball = this.ballByHandle.get(h);
    return { toi: hit.timeOfImpact, id, normal: { x: hit.normal.x, y: hit.normal.y, z: hit.normal.z }, body: ball ? ball.rb : null };
  }

  /**
   * A paintball bursting on a piece: a shove for anything already loose, and enough to pop the
   * lightest pieces (a 1 × 1 plate, a tile) off their studs.
   */
  splash(id: number, at: Vec, impulse: Vec) {
    if (this.anims || this.lost[id] || this.swallowed[id]) return;
    if (!this.loose[id]) {
      if (this.drives[id] || this.mass(id) > 0.5) return;
      this.knock(id);
    }
    this.bodies[id].applyImpulseAtPoint(impulse, at, true);
  }

  /** …and on a thrown brick. */
  splashBody(rb: RAPIER.RigidBody, at: Vec, impulse: Vec) {
    if (rb.isValid()) rb.applyImpulseAtPoint(impulse, at, true);
  }

  /**
   * A ball about to hit a build knocks loose the pieces around the point of impact *before* the
   * contact is solved, so it ploughs into real bodies and hands them its momentum instead of
   * bouncing off a fixed wall.
   */
  private punch() {
    for (const b of this.balls) {
      const v = b.rb.linvel();
      const speed = Math.hypot(v.x, v.y, v.z);
      if (speed < 12) continue;
      const t = b.rb.translation();
      const ahead = this.h * 1.6;
      const cx = t.x + v.x * ahead;
      const cy = t.y + v.y * ahead;
      const cz = t.z + v.z * ahead;
      const reach = SHOT_REACH + speed * 0.008;
      const seeds: number[] = [];
      for (let i = 0; i < this.pieces.length; i++) {
        if (this.loose[i]) continue;
        const p = this.pieces[i];
        const hy = (p.h * PLATE) / 2;
        // built pieces sit where they were built; cars wherever they've driven to
        const dx = Math.max(0, Math.abs(cx - this.pos[i * 3]) - p.w / 2);
        const dy = Math.max(0, Math.abs(cy - this.pos[i * 3 + 1]) - hy);
        const dz = Math.max(0, Math.abs(cz - this.pos[i * 3 + 2]) - p.d / 2);
        if (dx * dx + dy * dy + dz * dz < reach * reach) seeds.push(i);
      }
      if (!seeds.length) continue;
      this.shock(seeds, b.rb.mass() * speed);
      this.onImpact("ball", Math.min(1, speed / 60), t);
    }
  }

  private mass(id: number) {
    const p = this.pieces[id];
    return p.w * p.d * p.h * PLATE * (p.round ? 0.785 : 1);
  }

  /**
   * The shock of a hit runs out through the clutches: each piece it reaches is knocked loose and
   * passes on part of what's left, and each clutch soaks some up — more for heavier pieces.
   * A hard throw takes out a crater; a soft one a brick or two.
   */
  private shock(seeds: number[], momentum: number) {
    const energy = new Map<number, number>();
    const queue: number[] = [];
    for (const id of seeds) {
      energy.set(id, momentum / seeds.length);
      queue.push(id);
    }
    while (queue.length) {
      const id = queue.shift()!;
      const e = energy.get(id)!;
      this.knock(id);
      for (const i of this.byBody[id]) {
        const c = this.clutches[i];
        const other = c.a === id ? c.b : c.a;
        if (other < 0 || this.loose[other] || energy.has(other)) continue;
        const pass = e * 0.5;
        const hold = 60 + this.mass(other) * 6;
        if (pass > hold) {
          energy.set(other, pass - hold * 0.5);
          queue.push(other);
        }
      }
    }
  }

  /**
   * Put everything back. Each piece flies home on a little arc, lowest courses first so the
   * builds go up the way they were built, and the clutches re-engage once it's all in place.
   * `scatter` starts every piece up in the air instead (the opening build).
   */
  rebuild(scatter = false, focusX = 0) {
    for (const b of [...this.balls]) this.dropBall(b);
    // whatever is still on its way into the vacuum lands in the bin
    for (const g of this.gulps) this.lost[g.id] = 1;
    this.gulps.length = 0;
    this.tug.fill(0);
    this.endFloat();
    for (const c of this.clutches) {
      if (c.joint) this.world.removeImpulseJoint(c.joint, false);
      c.joint = null;
      c.broken = false;
    }
    this.unsupported = false;
    const rand = Math.random;
    this.anims = this.pieces.map((p) => {
      const i = p.id;
      const rb = this.bodies[i];
      const fromBin = this.swallowed[i] === 1;
      if (fromBin) {
        // back out of the bin (or, with the vacuum put away, down from the sky)
        const bin = this.suction.bin;
        const at = bin
          ? { x: bin.x + (rand() - 0.5) * 2, y: bin.y + (rand() - 0.5) * 2, z: bin.z + (rand() - 0.5) * 2 }
          : { x: p.x + (rand() - 0.5) * 10, y: p.y + 30 + rand() * 20, z: p.z + 10 };
        rb.setTranslation(at, false);
        this.pos[i * 3] = at.x;
        this.pos[i * 3 + 1] = at.y;
        this.pos[i * 3 + 2] = at.z;
        this.swallowed[i] = 0;
      }
      if (this.lost[i]) {
        rb.setEnabled(true);
        this.lost[i] = 0;
      }
      // cars still on the road just keep driving
      if (this.drives[i] && !this.loose[i]) return { from: p, fromQ: IDENTITY, delay: 0, dur: 0, lift: 0, landed: true, grow: false };
      let from = { x: this.pos[i * 3], y: this.pos[i * 3 + 1], z: this.pos[i * 3 + 2] };
      let fromQ = { x: this.quat[i * 4], y: this.quat[i * 4 + 1], z: this.quat[i * 4 + 2], w: this.quat[i * 4 + 3] };
      // the opening build rains down around the camera; the rest of the world is already standing
      if (scatter && Math.abs(p.x - focusX) < 90) {
        from = { x: p.x + (rand() - 0.5) * 12, y: p.y + 16 + rand() * 20, z: p.z + 6 + rand() * 12 };
        fromQ = slerp(IDENTITY, { x: rand() - 0.5, y: rand() - 0.5, z: rand() - 0.5, w: rand() - 0.5 }, 1);
      }
      const away = Math.hypot(from.x - p.x, from.y - p.y, from.z - p.z);
      const moved = away > 0.02 || Math.abs(fromQ.w) < 0.9999;
      if (moved || this.loose[i]) rb.setBodyType(RAPIER.RigidBodyType.KinematicPositionBased, true);
      // nearby pieces go first, then the lowest courses — builds rise course by course
      const near = Math.min(1, Math.abs(p.x - focusX) / 160);
      const delay = moved ? p.y * 0.045 + near * 0.6 + rand() * 0.35 : 0;
      return {
        from,
        fromQ,
        delay: fromBin ? delay * 0.6 + rand() * 0.5 : delay,
        dur: moved ? 0.55 + Math.min(fromBin ? 1.1 : 0.6, away * 0.02) : 0,
        lift: moved ? 1.5 + Math.min(10, away * 0.25) : 0,
        landed: !moved,
        grow: fromBin,
      };
    });
    this.animT = 0;
  }

  private stepAnim(dt: number) {
    const anims = this.anims!;
    this.animT += dt;
    let done = true;
    for (let i = 0; i < anims.length; i++) {
      const a = anims[i];
      if (!a.dur) continue;
      const p = this.pieces[i];
      const t = Math.min(1, Math.max(0, (this.animT - a.delay) / a.dur));
      if (t < 1) done = false;
      // ease in-out, with the arc peaking mid-flight
      const e = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
      const rb = this.bodies[i];
      rb.setNextKinematicTranslation({
        x: a.from.x + (p.x - a.from.x) * e,
        y: a.from.y + (p.y - a.from.y) * e + Math.sin(Math.PI * e) * a.lift,
        z: a.from.z + (p.z - a.from.z) * e,
      });
      rb.setNextKinematicRotation(slerp(a.fromQ, IDENTITY, Math.min(1, e * 1.15)));
      // out of the bin, a piece swells back to size as it leaves the nozzle
      if (a.grow) this.scale[i] = t <= 0 ? 0 : Math.min(1, 0.25 + t * 2.5);
      if (t >= 1 && !a.landed) {
        a.landed = true;
        this.onImpact("snap", 0.45 + Math.random() * 0.3, p);
      }
    }
    if (!done) return;
    // everything's home: clip it all back together
    for (let i = 0; i < this.bodies.length; i++) {
      const p = this.pieces[i];
      const rb = this.bodies[i];
      if (!this.loose[i] && !anims[i].dur) continue;
      rb.setBodyType(this.drives[i] ? RAPIER.RigidBodyType.KinematicPositionBased : RAPIER.RigidBodyType.Fixed, false);
      rb.setTranslation({ x: p.x, y: p.y, z: p.z }, false);
      this.carX[i] = p.x;
      rb.setRotation(IDENTITY, false);
      this.loose[i] = 0;
      this.scale[i] = 1;
    }
    this.looseCount = 0;
    this.anims = null;
    this.readPoses(true);
    this.onRebuilt();
  }

  /** Clutches in a falling chunk let go when wrenched out of line. */
  private checkStrain() {
    for (let i = 0; i < this.clutches.length; i++) {
      const c = this.clutches[i];
      if (!c.joint) continue;
      const A = this.bodies[c.a];
      const B = this.bodies[c.b];
      if (A.isSleeping() && B.isSleeping()) continue;
      const ta = A.translation();
      const qa = A.rotation();
      const tb = B.translation();
      const qb = B.rotation();
      const pa = rotate(qa, c.la);
      const pb = rotate(qb, c.lb);
      const slip = Math.hypot(ta.x + pa.x - tb.x - pb.x, ta.y + pa.y - tb.y - pb.y, ta.z + pa.z - tb.z - pb.z);
      const dot = Math.abs(qa.x * qb.x + qa.y * qb.y + qa.z * qb.z + qa.w * qb.w);
      if (slip > SLIP || 2 * Math.acos(Math.min(1, dot)) > TWIST) this.release(i);
    }
  }

  private handleEvents() {
    const loud = this.clock > 0.5;
    this.queue.drainCollisionEvents((h1, h2, started) => {
      if (!started || !loud) return;
      const ball = this.ballByHandle.get(h1) ?? this.ballByHandle.get(h2);
      if (ball) {
        const v = ball.rb.linvel();
        const speed = Math.hypot(v.x, v.y, v.z);
        if (speed > 5) this.onImpact("ball", Math.min(1, speed / 60), ball.rb.translation());
        return;
      }
      // brick on brick: a clack as loud as the faster of the two is moving
      const a = this.byHandle.get(h1);
      const b = this.byHandle.get(h2);
      let speed = 0;
      for (const id of [a, b]) {
        if (id === undefined || !this.loose[id]) continue;
        const v = this.bodies[id].linvel();
        speed = Math.max(speed, Math.hypot(v.x, v.y, v.z));
      }
      const id = a ?? b;
      if (speed > 2.5 && id !== undefined) this.onImpact("brick", Math.min(1, speed / 26), { x: this.pos[id * 3], y: this.pos[id * 3 + 1], z: this.pos[id * 3 + 2] });
    });
    this.queue.drainContactForceEvents((e) => {
      const f = e.totalForceMagnitude();
      const h1 = e.collider1();
      const h2 = e.collider2();
      const a = this.byHandle.get(h1);
      const b = this.byHandle.get(h2);
      // debris crashing into a build knocks the piece it lands on loose
      for (const id of [a, b]) if (id !== undefined && f > this.breakForce[id]) this.knock(id);
      // a heavy ball does the same even after it has slowed
      if ((this.ballByHandle.has(h1) || this.ballByHandle.has(h2)) && f > 2600) for (const id of [a, b]) if (id !== undefined) this.knock(id);
    });
  }

  private readPoses(all = false) {
    for (let i = 0; i < this.bodies.length; i++) {
      if (this.lost[i] || this.swallowed[i] || (!all && !this.loose[i] && !this.anims && !this.drives[i])) continue;
      const rb = this.bodies[i];
      const t = rb.translation();
      const q = rb.rotation();
      this.pos[i * 3] = t.x;
      this.pos[i * 3 + 1] = t.y;
      this.pos[i * 3 + 2] = t.z;
      this.quat[i * 4] = q.x;
      this.quat[i * 4 + 1] = q.y;
      this.quat[i * 4 + 2] = q.z;
      this.quat[i * 4 + 3] = q.w;
      // fell off the edge of the world: park it until the next rebuild
      if (t.y < -40) {
        this.lost[i] = 1;
        rb.setEnabled(false);
      }
    }
    for (const b of [...this.balls]) if (b.rb.translation().y < -40 || this.clock - b.born > 30) this.dropBall(b);
  }

  /** Something is moving (so the renderer has poses to upload). */
  get active() {
    return this.looseCount > 0 || this.balls.length > 0 || this.anims !== null || this.gulps.length > 0;
  }

  /** Cars still on the road roll along their lane, round and round the world. */
  private drive() {
    const { x0, x1 } = this.bounds;
    for (let i = 0; i < this.pieces.length; i++) {
      const v = this.drives[i];
      if (!v || this.loose[i] || this.lost[i]) continue;
      let x = this.carX[i] + v * this.h;
      if (x > x1 - 6) x = x0 + 6;
      if (x < x0 + 6) x = x1 - 6;
      const jumped = Math.abs(x - this.carX[i]) > 1;
      this.carX[i] = x;
      const p = this.pieces[i];
      if (jumped) this.bodies[i].setTranslation({ x, y: p.y, z: p.z }, true);
      else this.bodies[i].setNextKinematicTranslation({ x, y: p.y, z: p.z });
    }
  }

  /** Point, start or stop the vacuum. */
  steer(s: Partial<Suction>) {
    Object.assign(this.suction, s);
  }

  /**
   * One step of the vacuum. The floor head is a line of intake across its width: loose pieces
   * and thrown bricks within reach are dragged towards it (harder the closer they get, and lifted
   * a little so they skate rather than grind), anything under the head is swallowed, and pieces
   * still clipped into a build feel a tug that, held long enough, rips them free. The head
   * ploughing into a build knocks loose the pieces it runs into.
   */
  private suck() {
    const s = this.suction;
    const fx = Math.sin(s.yaw);
    const fz = Math.cos(s.yaw);
    // the intake's middle, low over the floor
    const mx = s.x + fx * MOUTH_Z;
    const mz = s.z + fz * MOUTH_Z;
    const my = 0.55;
    const power = s.boost ? 1.75 : 1;
    const tugR = s.boost ? TUG_BOOST : TUG;
    const reach = PULL * (s.boost ? 1.3 : 1);
    const reject = reach + 12;
    // the way from a point to the nearest bit of the intake, and whether it's under the head
    const toMouth = (x: number, y: number, z: number) => {
      const u = Math.max(-MOUTH_HALF, Math.min(MOUTH_HALF, (x - s.x) * fz - (z - s.z) * fx));
      return { x: mx + fz * u - x, y: my - y, z: mz - fx * u - z };
    };
    const under = (x: number, y: number, z: number, hw: number) => {
      const lx = (x - s.x) * fz - (z - s.z) * fx;
      const lz = (x - s.x) * fx + (z - s.z) * fz;
      return Math.abs(lx) < HEAD.hx + hw * 0.4 && lz > -HEAD.hz - hw * 0.3 && lz < HEAD.hz + 0.9 + hw * 0.5 && y < HEAD.top + 0.4;
    };

    for (let i = 0; i < this.pieces.length; i++) {
      if (this.lost[i] || this.swallowed[i]) continue;
      const x = this.pos[i * 3];
      if (Math.abs(x - s.x) > reject) continue;
      const p = this.pieces[i];
      const y = this.pos[i * 3 + 1];
      const z = this.pos[i * 3 + 2];
      const hw = Math.max(p.w, p.d) / 2;
      if (!this.loose[i]) {
        // built: the head ploughs through the bottom courses, and the airflow tugs at what's near
        const bottom = y - (p.h * PLATE) / 2;
        if (bottom < HEAD.top - 0.2 && under(x, bottom + 0.1, z, hw)) {
          this.knock(i);
          continue;
        }
        const d = toMouth(x, y, z);
        const r = Math.max(0, Math.hypot(d.x, d.y, d.z) - hw * 0.5);
        if (r > tugR) {
          if (this.tug[i] > 0) this.tug[i] = Math.max(0, this.tug[i] - this.h);
          continue;
        }
        this.tug[i] += (this.h * (s.boost ? 5.5 : 1.1) * (1 - r / tugR)) / (1 + this.mass(i) * 0.1);
        if (this.tug[i] >= 1) this.knock(i);
        continue;
      }
      if (under(x, y, z, hw)) {
        this.gulp(i);
        continue;
      }
      const d = toMouth(x, y, z);
      const r = Math.hypot(d.x, d.y, d.z);
      if (r > reach || r < 1e-4) continue;
      // the head draws from in front and the sides far more than from behind
      const behind = (x - s.x) * fx + (z - s.z) * fz < -HEAD.hz;
      const k = 1 - r / reach;
      const a = (34 + 300 * k * k) * power * (behind ? 0.3 : 1);
      const lift = (this.gravity * 0.55 + 20 * k * this.g) * k * power * (behind ? 0.3 : 1);
      const rb = this.bodies[i];
      const m = rb.mass();
      rb.applyImpulse({ x: (d.x / r) * a * m * this.h, y: ((d.y / r) * a + lift) * m * this.h, z: (d.z / r) * a * m * this.h }, true);
      // a little tumble, the way debris spins into an airstream
      if (k > 0.5) {
        const j = m * 0.5 * k;
        rb.applyTorqueImpulse({ x: (Math.random() - 0.5) * j, y: (Math.random() - 0.5) * j, z: (Math.random() - 0.5) * j }, true);
      }
    }

    for (const b of [...this.balls]) {
      const t = b.rb.translation();
      if (Math.abs(t.x - s.x) > reject) continue;
      if (under(t.x, t.y, t.z, 1)) {
        this.onSwallow("shot", b.color, t);
        this.dropBall(b);
        continue;
      }
      const d = toMouth(t.x, t.y, t.z);
      const r = Math.hypot(d.x, d.y, d.z);
      if (r > reach || r < 1e-4) continue;
      const k = 1 - r / reach;
      const a = (34 + 300 * k * k) * power;
      const m = b.rb.mass();
      b.rb.applyImpulse({ x: (d.x / r) * a * m * this.h, y: ((d.y / r) * a + this.gravity * 0.55 * k * power) * m * this.h, z: (d.z / r) * a * m * this.h }, true);
    }
  }

  /**
   * The wand and the body are solid: swung through a build they knock loose what they hit, and
   * they shove loose pieces out of the way.
   */
  private bump() {
    const { k, b, top } = this.suction.wand!;
    const x0 = Math.min(k.x, b.x, top.x) - BODY_R - 6;
    const x1 = Math.max(k.x, b.x, top.x) + BODY_R + 6;
    const p3 = { x: 0, y: 0, z: 0 };
    for (let i = 0; i < this.pieces.length; i++) {
      if (this.lost[i] || this.swallowed[i]) continue;
      const x = this.pos[i * 3];
      if (x < x0 || x > x1) continue;
      p3.x = x;
      p3.y = this.pos[i * 3 + 1];
      p3.z = this.pos[i * 3 + 2];
      const p = this.pieces[i];
      // a piece is roughly a ball as big as its middle dimension
      const hw = Math.min(Math.max(p.w, p.d), 4) / 2;
      const w = toSegment(p3, k, b);
      const bo = toSegment(p3, b, top);
      const hitW = w.d < WAND_R + hw * 0.8;
      const hitB = bo.d < BODY_R + hw * 0.8;
      if (!hitW && !hitB) continue;
      if (!this.loose[i]) {
        this.knock(i);
        continue;
      }
      const s = hitB ? bo : w;
      if (s.d < 1e-4) continue;
      const rb = this.bodies[i];
      const v = rb.linvel();
      const nx = s.dx / s.d;
      const ny = s.dy / s.d;
      const nz = s.dz / s.d;
      // push it out along the normal until it's moving away
      const into = v.x * nx + v.y * ny + v.z * nz;
      const out = Math.max(0, 6 - into);
      rb.setLinvel({ x: v.x + nx * out, y: v.y + ny * out, z: v.z + nz * out }, true);
    }
  }

  /** Start swallowing a piece: it leaves the simulation and is drawn shrinking into the intake. */
  private gulp(id: number) {
    for (const i of this.byBody[id]) this.release(i);
    this.swallowed[id] = 1;
    this.bodies[id].setEnabled(false);
    const q = { x: this.quat[id * 4], y: this.quat[id * 4 + 1], z: this.quat[id * 4 + 2], w: this.quat[id * 4 + 3] };
    const spin = slerp(IDENTITY, { x: Math.random() - 0.5, y: Math.random() - 0.5, z: Math.random() - 0.5, w: Math.random() - 0.5 }, 1);
    this.gulps.push({ id, from: { x: this.pos[id * 3], y: this.pos[id * 3 + 1], z: this.pos[id * 3 + 2] }, fromQ: q, spin, t: 0 });
  }

  /** Pieces on their way in: drawn into the middle of the intake, shrinking, then gone. */
  private stepGulps(dt: number) {
    const s = this.suction;
    const fx = Math.sin(s.yaw);
    const fz = Math.cos(s.yaw);
    for (let k = this.gulps.length - 1; k >= 0; k--) {
      const g = this.gulps[k];
      const i = g.id;
      g.t += dt / GULP;
      const t = Math.min(1, g.t);
      const u = Math.max(-MOUTH_HALF, Math.min(MOUTH_HALF, (g.from.x - s.x) * fz - (g.from.z - s.z) * fx)) * (1 - t);
      const tx = s.x + fx * (MOUTH_Z - 0.5) + fz * u;
      const tz = s.z + fz * (MOUTH_Z - 0.5) - fx * u;
      const e = t * t;
      this.pos[i * 3] = g.from.x + (tx - g.from.x) * e;
      this.pos[i * 3 + 1] = g.from.y + (0.5 - g.from.y) * e;
      this.pos[i * 3 + 2] = g.from.z + (tz - g.from.z) * e;
      const q = slerp(g.fromQ, g.spin, t);
      this.quat[i * 4] = q.x;
      this.quat[i * 4 + 1] = q.y;
      this.quat[i * 4 + 2] = q.z;
      this.quat[i * 4 + 3] = q.w;
      this.scale[i] = Math.max(0.05, 1 - e * 0.85);
      if (g.t < 1) continue;
      this.gulps.splice(k, 1);
      this.lost[i] = 1;
      this.scale[i] = 0;
      this.onSwallow("piece", i, { x: tx, y: 0.5, z: tz });
    }
  }

  /** The pull of gravity right now, in world units per second² (for anything aiming an arc). */
  get gravity() {
    return GRAVITY * this.g;
  }

  /**
   * Turn gravity up or down (1 normal … 0 weightless). Bodies at rest don't notice on their own,
   * so they're woken as it comes back; crossing the halfway mark swaps the bounce and drag over,
   * and whatever lost its footing while weightless gets checked for support again.
   */
  setGravity(k: number) {
    if (Math.abs(k - this.g) < 1e-4) return;
    const was = this.g;
    this.g = k;
    this.world.gravity = { x: 0, y: -GRAVITY * k, z: 0 };
    if (k < this.woke) this.woke = k;
    if (k > was && (k - this.woke > 0.15 || k === 1)) {
      this.woke = k;
      for (let i = 0; i < this.bodies.length; i++) if (this.loose[i] && !this.lost[i] && !this.swallowed[i]) this.bodies[i].wakeUp();
      for (const b of this.balls) b.rb.wakeUp();
    }
    if (was < 0.5 !== k < 0.5) {
      const zg = k < 0.5;
      const drag = zg ? DRAG_ZG : DRAG;
      for (const rb of this.bodies) {
        rb.collider(0).setRestitution(zg ? BOUNCE_ZG : BOUNCE);
        rb.setLinearDamping(drag.lin);
        rb.setAngularDamping(drag.ang);
      }
      for (const b of this.balls) b.rb.collider(0).setRestitution(zg ? BOUNCE_ZG : 0.2);
      if (!zg) this.unsupported = true;
    }
  }

  /**
   * Gravity's gone: the wave of release reaches everything within `reach` of `focusX`. Clutches
   * let go — most of them; a few hold, so some pieces leave as small chunks — and the stored
   * spring of each joint pushes every piece gently off whatever it was clipped to, with a slow
   * tumble. The wave spreads out from the middle of the view, the top courses first, so the
   * builds peel apart from the roof down. Pieces already lying about lift off the floor too.
   * Returns how many pieces it reached.
   */
  float(focusX: number, reach: number) {
    if (this.anims || this.g > 0.5) return 0;
    const n = this.pieces.length;
    const rand = Math.random;
    for (const b of this.balls) {
      const t = b.rb.translation();
      if (b.floated || Math.abs(t.x - focusX) > reach) continue;
      b.floated = true;
      const v = b.rb.linvel();
      b.rb.setLinvel({ x: v.x + (rand() - 0.5) * 0.8, y: v.y + 0.4 + rand() * 0.9, z: v.z + (rand() - 0.5) * 0.8 }, true);
      b.rb.setAngvel({ x: (rand() - 0.5) * 1.6, y: (rand() - 0.5) * 1.6, z: (rand() - 0.5) * 1.6 }, true);
    }
    const pick: number[] = [];
    let top = 0;
    for (let i = 0; i < n; i++) {
      if (this.floated[i] || this.lost[i] || this.swallowed[i] || Math.abs(this.pos[i * 3] - focusX) > reach) continue;
      this.floated[i] = 1;
      pick.push(i);
      top = Math.max(top, this.pos[i * 3 + 1]);
    }
    if (!pick.length) return 0;

    // chunks: pieces joined by the clutches that hold (union-find, capped in size)
    const root = new Int32Array(n).fill(-1);
    const size = new Uint8Array(n);
    for (const id of pick) {
      root[id] = id;
      size[id] = 1;
    }
    const find = (i: number): number => (root[i] === i ? i : (root[i] = find(root[i])));
    for (const c of this.clutches) {
      if (c.broken || c.b < 0 || root[c.a] < 0 || root[c.b] < 0 || this.loose[c.a] || this.loose[c.b] || this.drives[c.a] || this.drives[c.b]) continue;
      if (rand() > HOLD) continue;
      const ra = find(c.a);
      const rb = find(c.b);
      if (ra === rb || size[ra] + size[rb] > CHUNK_MAX) continue;
      root[rb] = ra;
      size[ra] += size[rb];
    }
    const chunks = new Map<number, number[]>();
    for (const id of pick) {
      const r = find(id);
      const list = chunks.get(r);
      if (list) list.push(id);
      else chunks.set(r, [id]);
    }

    for (const ids of chunks.values()) {
      let m = 0;
      const c = { x: 0, y: 0, z: 0 };
      for (const id of ids) {
        const w = this.mass(id);
        m += w;
        c.x += this.pos[id * 3] * w;
        c.y += this.pos[id * 3 + 1] * w;
        c.z += this.pos[id * 3 + 2] * w;
      }
      c.x /= m;
      c.y /= m;
      c.z /= m;
      // pushed off whatever it was clipped to: away from the pieces under (and beside) it
      const push = { x: 0, y: 0, z: 0 };
      const debris = ids.length === 1 && this.loose[ids[0]] === 1;
      if (debris) push.y = 1;
      else
        for (const id of ids)
          for (const i of this.byBody[id]) {
            const cl = this.clutches[i];
            if (cl.broken) continue;
            const other = cl.a === id ? cl.b : cl.a;
            if (other >= 0 && ids.includes(other)) continue;
            if (other < 0) {
              push.y += 1;
              continue;
            }
            const dx = this.pos[id * 3] - this.pos[other * 3];
            const dy = this.pos[id * 3 + 1] - this.pos[other * 3 + 1];
            const dz = this.pos[id * 3 + 2] - this.pos[other * 3 + 2];
            const l = Math.hypot(dx, dy, dz) || 1;
            push.x += dx / l;
            push.y += dy / l;
            push.z += dz / l;
          }
      // never quite clean: a little sideways, and a slight lift off the floor overall
      push.x += (rand() - 0.5) * 0.9;
      push.y += (rand() - 0.5) * 0.9 + 0.45;
      push.z += (rand() - 0.5) * 0.9;
      const pl = Math.hypot(push.x, push.y, push.z) || 1;
      // heavier chunks are slower to get going and slower to turn
      const heft = 1 / Math.sqrt(1 + m * 0.04);
      const speed = (debris ? 0.5 + rand() * 1.1 : 0.7 + rand() * 1.9) * heft;
      const axis = { x: rand() - 0.5, y: rand() - 0.5, z: rand() - 0.5 };
      const al = Math.hypot(axis.x, axis.y, axis.z) || 1;
      const spin = (0.2 + rand() * 1.2) * heft;
      const delay = debris ? rand() * 0.5 : 0.05 + Math.abs(c.x - focusX) * 0.007 + Math.max(0, top - c.y) * 0.035 + rand() * 0.4;
      this.floats.push({
        ids,
        at: this.clock + delay,
        v: { x: (push.x / pl) * speed, y: (push.y / pl) * speed, z: (push.z / pl) * speed },
        w: { x: (axis.x / al) * spin, y: (axis.y / al) * spin, z: (axis.z / al) * spin },
        c,
      });
    }
    return pick.length;
  }

  /** Gravity's back: the float wave stops where it is, and a later one can reach everything again. */
  endFloat() {
    this.floats.length = 0;
    this.floated.fill(0);
    for (const b of this.balls) b.floated = false;
  }

  /** Let go of every chunk whose moment has come. */
  private stepFloats() {
    for (let k = this.floats.length - 1; k >= 0; k--) {
      const f = this.floats[k];
      if (f.at > this.clock) continue;
      this.floats.splice(k, 1);
      const ids = f.ids.filter((id) => !this.lost[id] && !this.swallowed[id]);
      if (!ids.length) continue;
      const debris = ids.length === 1 && this.loose[ids[0]] === 1;
      for (const id of ids) {
        for (const i of this.byBody[id]) {
          const c = this.clutches[i];
          const other = c.a === id ? c.b : c.a;
          if (other < 0 || !ids.includes(other)) this.release(i);
        }
        this.loosen(id);
      }
      // the clutches inside the chunk hold it together as one body
      for (const id of ids)
        for (const i of this.byBody[id]) {
          const c = this.clutches[i];
          if (c.broken || c.joint || c.a !== id || c.b < 0 || !ids.includes(c.b)) continue;
          c.joint = this.world.createImpulseJoint(RAPIER.JointData.fixed(c.la, IDENTITY, c.lb, IDENTITY), this.bodies[c.a], this.bodies[c.b], true);
        }
      // one rigid drift for the whole chunk: v + w × r
      for (const id of ids) {
        const rx = this.pos[id * 3] - f.c.x;
        const ry = this.pos[id * 3 + 1] - f.c.y;
        const rz = this.pos[id * 3 + 2] - f.c.z;
        // a car that was driving keeps a little of its way on
        const drive = this.drives[id] * 0.3;
        const rb = this.bodies[id];
        rb.setLinvel({ x: f.v.x + f.w.y * rz - f.w.z * ry + drive, y: f.v.y + f.w.z * rx - f.w.x * rz, z: f.v.z + f.w.x * ry - f.w.y * rx }, true);
        rb.setAngvel(f.w, true);
      }
      // the faint tick of studs letting go
      if (!debris) this.onImpact("snap", 0.12 + Math.random() * 0.18, f.c);
    }
  }

  /** Slow the world down (1 is real time): each tick then simulates less time, so motion stays smooth. */
  setTimeScale(k: number) {
    this.h = STEP * Math.max(0.05, Math.min(1, k));
    this.world.timestep = this.h;
  }

  /** Advance by a frame's worth of fixed steps. */
  update(dt: number) {
    this.acc = Math.min(this.acc + Math.min(dt, 0.1), STEP * 3);
    let stepped = false;
    while (this.acc >= STEP) {
      this.acc -= STEP;
      this.clock += this.h;
      this.drive();
      if (this.anims) {
        this.stepAnim(this.h);
        this.world.step(this.queue);
        this.queue.clear();
      } else {
        if (this.floats.length) this.stepFloats();
        this.punch();
        if (this.suction.on) this.suck();
        if (this.suction.wand && this.suction.on) this.bump();
        if (this.unsupported) this.settleSupport();
        this.world.step(this.queue);
        this.handleEvents();
        this.checkStrain();
        if (this.unsupported) this.settleSupport();
      }
      if (this.gulps.length) this.stepGulps(this.h);
      stepped = true;
    }
    if (stepped) this.readPoses();
  }

  dispose() {
    this.queue.free();
    this.world.free();
  }
}
