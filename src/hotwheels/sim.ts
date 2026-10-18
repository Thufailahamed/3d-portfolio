import RAPIER from "@dimforge/rapier3d-compat";
import * as THREE from "three";
import { BLOCK, castleBlocks, staticShapes, supportsFor, type Block, type Support } from "./furniture";
import type { AttractionId, Park } from "./park";
import { TrackIndex, newFrame, trackGeometry, type Track, type TrackFrame } from "./track";
import { CAR_LEN, CAR_W, G, RIDE } from "./units";
import { DOMINO, PIN, yardQuat } from "./yard";

const STEP = 1 / 240;
/** baseline rolling resistance (fraction of the normal load), wall scrub in bends, air drag (per cm, for a 36 g car) */
const CRR = 0.011;
const MU_WALL = 0.15;
const CD = 0.00026;
/** the mass the drag and booster figures are quoted for (g) */
const REF_MASS = 36;
/** the walls hold up to this much side load before a car climbs them; under this much grip the car leaves the bed */
const WALL_MAX = 7.5 * G;
const LIFT_OFF = -0.05 * G;
export const WHEEL_R = 0.66;
const MAX_CARS = 14;
/** a car's collider stops this short of its wheels, so a car leaving the bed isn't already touching it */
const CLEAR = 0.1;
/** contacts with the track a car just left don't count for this long (it is still brushing the lip) */
const LEAVE_GRACE = 0.12;

let ready: Promise<void> | null = null;
export const initPhysics = () => (ready ??= RAPIER.init());

/** what a track carries a car through, attraction by attraction */
export const attractionOf = (trackId: string): AttractionId => (trackId === "landing" || trackId === "jump" ? "jump" : trackId.startsWith("drag") ? "drag" : (trackId as AttractionId));

/**
 * How a model behaves, not how it looks: its weight, how much air it pushes, how freely its axles
 * turn, and where its wheels sit (cm along the body from its centre, and their radius).
 */
export type CarSpec = { mass: number; aero: number; bearing: number; front: { z: number; r: number }; rear: { z: number; r: number } };

export type Run = { attraction: AttractionId; t0: number; top: number; air: number; loops: number; ring: boolean; finished: boolean; crashed: boolean; smashed: boolean; power: number; maxG: number; laps: number };

export type Car = {
  id: number;
  model: number;
  spec: CarSpec;
  mass: number;
  /** drag (per cm, as an acceleration per v²) and rolling resistance for this model */
  kd: number;
  crr: number;
  mode: "track" | "free";
  track: Track | null;
  s: number;
  v: number;
  hint: number;
  lat: number;
  held: boolean;
  rb: RAPIER.RigidBody;
  col: RAPIER.Collider;
  pos: THREE.Vector3;
  quat: THREE.Quaternion;
  vel: THREE.Vector3;
  /** how far the car has rolled (cm): each wheel turns by this over its own radius */
  roll: number;
  /** how fast it is rolling (cm/s), kept up while the wheels spin down in the air */
  rollRate: number;
  detachT: number;
  lastTrack: Track | null;
  airborne: boolean;
  airStart: number;
  run: Run | null;
  born: number;
  /** side load against the walls (in g), for sparks and the scrape sound */
  scrape: number;
  /** load into the bed (in g): 1 sitting still, more through a dip or a loop */
  g: number;
  boosting: boolean;
  loopIn: number;
  rival: boolean;
  /** how long it has sat still off the track */
  still: number;
  /** wheels down on something (off the track) */
  grounded: boolean;
  boostK: number;
  /** under your control (the Stunt Yard), and its motor's push along a track it's riding (cm/s²) */
  driven: boolean;
  push: number;
  /** how fast it's sliding sideways (cm/s): skids and tyre squeal */
  slip: number;
  /** turning done since the wheels left the ground (radians about its own axes), for tricks */
  trick: { t: number; pitch: number; roll: number; yaw: number } | null;
  /** how long it's been lying on its roof or side */
  upsideT: number;
};

export type SimEvent =
  | { type: "launch"; car: Car; power: number }
  | { type: "boost"; car: Car }
  | { type: "loop"; car: Car }
  | { type: "lap"; car: Car; laps: number }
  | { type: "detach"; car: Car; why: "air" | "rail" | "end" | "hit" }
  | { type: "land"; car: Car; air: number; impact: number; at: THREE.Vector3 }
  | { type: "ring"; car: Car }
  | { type: "hit"; car: Car | null; strength: number; at: THREE.Vector3; what: "floor" | "block" | "car" | "track" | "prop" }
  | { type: "bump"; car: Car; strength: number; at: THREE.Vector3 }
  | { type: "crash"; a: Car; b: Car; strength: number; at: THREE.Vector3 }
  | { type: "finish"; car: Car; time: number }
  | { type: "wipeout"; car: Car }
  | { type: "smash"; car: Car }
  | { type: "trick"; car: Car; air: number; flips: number; rolls: number; spins: number; clean: boolean }
  | { type: "checkpoint"; car: Car; i: number }
  | { type: "hop"; car: Car }
  | { type: "righted"; car: Car };

type Owner = { kind: "car"; car: Car } | { kind: "block"; i: number } | { kind: "toy"; i: number } | { kind: "static"; what: "floor" | "track" | "prop"; track?: Track };

export type Ring = { c: THREE.Vector3; n: THREE.Vector3; r: number };

const tmpF = newFrame();
const fF = newFrame();
const fR = newFrame();
const v3 = new THREE.Vector3();
const m4 = new THREE.Matrix4();
const wF = new THREE.Vector3();
const wR = new THREE.Vector3();
const e1 = new THREE.Vector3();
const e2 = new THREE.Vector3();
const fwdV = new THREE.Vector3();
const upV = new THREE.Vector3();
const sideV = new THREE.Vector3();

/** Orientation of a car sitting on the track: its left, up and forward are the track's. */
function frameQuat(f: TrackFrame, out: THREE.Quaternion) {
  m4.makeBasis(f.side, f.u, f.t);
  return out.setFromRotationMatrix(m4);
}

/** `boostK`: how well the booster's foam wheels bite this time through (they slip a little, and not always the same) */
export type StepState = { s: number; v: number; hint: number; lat: number; scrape: number; g: number; boosting: boolean; kd: number; crr: number; mass: number; boostK?: number; push?: number };
export type StepResult = "ok" | "lap" | "air" | "rail" | "end-open" | "start-open" | "bump-end" | "bump-start";

/** Drag and rolling resistance for a model. */
export function resistanceOf(spec: CarSpec) {
  return { kd: CD * (REF_MASS / spec.mass) * spec.aero, crr: CRR * spec.bearing };
}

/**
 * One step of a car along its track. Gravity pulls along the tangent; the bed and walls supply
 * whatever the bend needs, and rolling resistance, wall scrub and drag take their share (drag
 * counts for more on a light car with a lot of frontal area). If the bed would have to pull rather
 * than push (over a crest too fast, upside down too slowly) the car leaves it; if the walls would
 * have to push harder than they can, it climbs over.
 */
export function trackStep(st: StepState, tr: Track, dt: number, f: TrackFrame): StepResult {
  st.hint = tr.frameAt(st.s, f, st.hint);
  const N = st.v * st.v * f.k.dot(f.u) + G * f.u.y;
  const L = st.v * st.v * f.k.dot(f.side) + G * f.side.y;
  st.scrape = Math.abs(L) / G;
  st.g = N / G;
  if (N < LIFT_OFF && Math.abs(st.v) > 20) return "air";
  if (Math.abs(L) > WALL_MAX && N > 0) return "rail";
  let a = -G * f.t.y + (st.push ?? 0);
  const resist = st.crr * Math.max(0, N) + MU_WALL * Math.abs(L) + st.kd * st.v * st.v;
  let brake = 0;
  for (const b of tr.brakes) if (st.s >= b.s0 && st.s <= b.s1) brake = 2200;
  const r = resist + brake;
  // resistance only ever slows the car (and can hold it still on a gentle slope)
  if (Math.abs(st.v) < r * dt && Math.abs(a) < r) {
    st.v = 0;
    a = 0;
  } else a -= Math.sign(st.v || a) * r;
  st.v += a * dt;
  st.boosting = false;
  for (const b of tr.boosters)
    if (st.s >= b.s0 && st.s <= b.s1) {
      st.boosting = true;
      // the foam wheels grip the car's flanks: a heavy car takes longer to bring up to their speed
      const grip = Math.min(1.3, REF_MASS / st.mass);
      const target = b.speed * (st.boostK ?? 1);
      if (st.v < target) st.v += (target - st.v) * Math.min(1, 26 * grip * dt) + 40 * grip * dt;
    }
  st.s += st.v * dt;
  // the car rides a little off-centre in bends, pressed against the outside wall
  const want = -Math.sign(L) * Math.min(1, Math.abs(L) / (2.5 * G)) * 0.42;
  st.lat += (want - st.lat) * Math.min(1, 12 * dt);
  if (tr.closed) {
    if (st.s >= tr.length) {
      st.s -= tr.length;
      return "lap";
    }
    if (st.s < 0) st.s += tr.length;
    return "ok";
  }
  const half = CAR_LEN / 2;
  if (st.s > tr.length - (tr.spec.endEnd === "buffer" ? half : 0)) {
    if (tr.spec.endEnd !== "buffer") return "end-open";
    st.s = tr.length - half;
    return "bump-end";
  }
  if (st.s < (tr.spec.startEnd === "buffer" ? half : 0)) {
    if (tr.spec.startEnd !== "buffer") return "start-open";
    st.s = half;
    return "bump-start";
  }
  return "ok";
}

/**
 * Run a car down a track on its own (no other cars, no Rapier) from a launch speed and report
 * how it went: whether it made the finish, and if not, where it came off.
 */
export function probe(tr: Track, v0: number, s0: number, spec: CarSpec, maxT = 6) {
  const st: StepState = { s: s0, v: v0, hint: 0, lat: 0, scrape: 0, g: 1, boosting: false, mass: spec.mass, ...resistanceOf(spec) };
  const f = newFrame();
  let t = 0;
  while (t < maxT) {
    const r = trackStep(st, tr, STEP, f);
    t += STEP;
    if (tr.finish !== null && st.s >= tr.finish) return { ok: true as const, t, v: st.v };
    if (r === "air" || r === "rail" || r === "end-open" || r === "start-open") return { ok: false as const, why: r, s: st.s, v: st.v };
    if (r === "bump-end" || r === "bump-start") st.v *= -0.3;
    if (st.v === 0 && Math.abs(-G * f.t.y) < 1) return { ok: false as const, why: "stopped" as const, s: st.s, v: 0 };
  }
  return { ok: false as const, why: "slow" as const, s: st.s, v: st.v };
}

// —————————————————————————————————————————— box overlap (two cars meeting at a crossing)

const axA = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
const axB = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
const HALF = [CAR_W / 2, RIDE, CAR_LEN / 2];
const tAxis = new THREE.Vector3();

/** Separating-axis test between two car boxes, grown by `pad` cm. */
function boxesOverlap(pa: THREE.Vector3, qa: THREE.Quaternion, pb: THREE.Vector3, qb: THREE.Quaternion, pad: number) {
  for (let i = 0; i < 3; i++) {
    axA[i].set(i === 0 ? 1 : 0, i === 1 ? 1 : 0, i === 2 ? 1 : 0).applyQuaternion(qa);
    axB[i].set(i === 0 ? 1 : 0, i === 1 ? 1 : 0, i === 2 ? 1 : 0).applyQuaternion(qb);
  }
  const d = v3.subVectors(pb, pa);
  const test = (L: THREE.Vector3) => {
    const len = L.length();
    if (len < 1e-5) return true;
    let ra = pad;
    let rb = pad;
    for (let i = 0; i < 3; i++) {
      ra += HALF[i] * Math.abs(axA[i].dot(L));
      rb += HALF[i] * Math.abs(axB[i].dot(L));
    }
    return Math.abs(d.dot(L)) <= (ra + rb) * len;
  };
  for (let i = 0; i < 3; i++) if (!test(axA[i]) || !test(axB[i])) return false;
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) if (!test(tAxis.crossVectors(axA[i], axB[j]))) return false;
  return true;
}

/**
 * The park's physics. Cars on a track follow it exactly (kinematic bodies, so they still shove
 * whatever's in the way); cars off it are Rapier dynamic bodies, and land back on a track when
 * they come down upright on one.
 */
export class Sim {
  readonly world: RAPIER.World;
  readonly cars: Car[] = [];
  readonly events: SimEvent[] = [];
  readonly blocks: Block[];
  readonly blockBodies: RAPIER.RigidBody[] = [];
  readonly supports: Support[];
  rings: Ring[] = [];
  clock = 0;
  private acc = 0;
  private queue: RAPIER.EventQueue;
  private owners = new Map<number, Owner>();
  private index: TrackIndex;
  private nextId = 1;
  private smashCooldown = 0;
  private ray = new RAPIER.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: -1, z: 0 });
  /** the yard's loose toys, and the lap's checkpoint planes */
  readonly toys: { kind: "domino" | "pin"; pos: THREE.Vector3; quat: THREE.Quaternion; color: string }[] = [];
  readonly toyBodies: RAPIER.RigidBody[] = [];
  readonly checkpoints: { i: number; c: THREE.Vector3; n: THREE.Vector3; side: THREE.Vector3; w: number; h: number }[] = [];
  /** the car you're driving, what your hands are doing, and the nitro left (0..1) */
  driven: Car | null = null;
  readonly control = { throttle: 0, steer: 0, handbrake: false, nitro: false, hop: false };
  fuel = 1;
  boosting = false;

  constructor(readonly park: Park) {
    const world = new RAPIER.World({ x: 0, y: -G, z: 0 });
    world.timestep = STEP;
    world.lengthUnit = 6;
    world.numSolverIterations = 8;
    this.world = world;
    this.queue = new RAPIER.EventQueue(true);
    this.index = new TrackIndex(park.tracks);

    // the floor
    const ground = world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
    const floor = world.createCollider(RAPIER.ColliderDesc.cuboid(2000, 10, 2000).setTranslation(0, -10, 0).setFriction(0.5).setRestitution(0.18), ground);
    this.owners.set(floor.handle, { kind: "static", what: "floor" });

    // the tracks themselves, as a solid shell for anything loose
    for (const tr of park.tracks) {
      const g = trackGeometry(tr, 2);
      const verts = new Float32Array(g.attributes.position.array as Float32Array);
      const idx = new Uint32Array(g.index!.array as ArrayLike<number>);
      const c = world.createCollider(RAPIER.ColliderDesc.trimesh(verts, idx).setFriction(0.3).setRestitution(0.15), ground);
      this.owners.set(c.handle, { kind: "static", what: "track", track: tr });
      g.dispose();
    }

    // the room: walls round the floor, and the sofa and toy chest against the back wall (a car can't leave the room, or drive through the furniture)
    const room: [number, number, number, number, number, number, number][] = [
      [0, 40, -332, 820, 40, 2, 0],
      [0, 40, 702, 820, 40, 2, 0],
      [-802, 40, 185, 2, 40, 520, 0],
      [802, 40, 185, 2, 40, 520, 0],
      // the sofa: seat block, back, arms (it stands on legs, but a die-cast car won't fit under)
      [-160, 22, -270, 143, 22, 45, 0],
      [-160, 60, -306, 130, 30, 12, 0],
      // the toy chest, turned a little
      [240, 30, -280, 55, 30, 30, -0.25],
    ];
    for (const [x, y, z, hx, hy, hz, yaw] of room) {
      const c = world.createCollider(
        RAPIER.ColliderDesc.cuboid(hx, hy, hz).setTranslation(x, y, z).setRotation(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw)).setFriction(0.4).setRestitution(0.3),
        ground,
      );
      this.owners.set(c.handle, { kind: "static", what: "prop" });
    }

    this.supports = park.tracks.flatMap((t) => supportsFor(t));
    for (const sh of staticShapes(park, this.supports)) {
      let desc: RAPIER.ColliderDesc;
      if (sh.type === "hull") desc = RAPIER.ColliderDesc.convexHull(sh.pts)!;
      else {
        desc = sh.type === "box" ? RAPIER.ColliderDesc.cuboid(sh.half.x, sh.half.y, sh.half.z).setRotation(sh.quat) : RAPIER.ColliderDesc.cylinder(sh.hh, sh.r);
        desc.setTranslation(sh.center.x, sh.center.y, sh.center.z);
      }
      desc.setFriction(0.45).setRestitution(0.2);
      const c = world.createCollider(desc, ground);
      // the rug counts as floor (a car that comes down on it has wiped out just the same)
      this.owners.set(c.handle, { kind: "static", what: sh.kind === "rug" ? "floor" : "prop" });
    }

    // the block castle
    const castle = park.props.find((p) => p.kind === "castle");
    this.blocks = castle && castle.kind === "castle" ? castleBlocks(castle.x, castle.z, castle.yaw) : [];
    this.blocks.forEach((b, i) => {
      const rb = world.createRigidBody(
        RAPIER.RigidBodyDesc.dynamic().setTranslation(b.pos.x, b.pos.y, b.pos.z).setRotation(b.quat).setSleeping(true).setLinearDamping(0.05).setAngularDamping(0.2),
      );
      const h = b.size / 2 - 0.15;
      const c = world.createCollider(
        RAPIER.ColliderDesc.roundCuboid(h, h, h, 0.15).setDensity(0.22).setFriction(0.55).setRestitution(0.12).setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS),
        rb,
      );
      this.owners.set(c.handle, { kind: "block", i });
      this.blockBodies.push(rb);
    });

    for (const p of park.props)
      if (p.kind === "ring") {
        const n = new THREE.Vector3(Math.sin(p.yaw), 0, Math.cos(p.yaw));
        this.rings.push({ c: new THREE.Vector3(...p.at), n, r: p.r });
      } else if (p.kind === "checkpoint") {
        const n = new THREE.Vector3(Math.sin(p.yaw), 0, Math.cos(p.yaw));
        this.checkpoints.push({ i: p.i, c: new THREE.Vector3(...p.at), n, side: new THREE.Vector3(n.z, 0, -n.x), w: p.w, h: p.h });
      } else if (p.kind === "domino" || p.kind === "pin") {
        // the Stunt Yard's loose toys: wooden dominoes standing on end, plastic skittles
        const pos = new THREE.Vector3(...p.at);
        const quat = p.kind === "domino" ? yardQuat(p.yaw) : new THREE.Quaternion();
        const rb = world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(pos.x, pos.y, pos.z).setRotation(quat).setSleeping(true).setLinearDamping(0.05).setAngularDamping(0.15));
        const desc =
          p.kind === "domino"
            ? RAPIER.ColliderDesc.cuboid(DOMINO.w / 2, DOMINO.h / 2, DOMINO.t / 2).setDensity(0.65).setFriction(0.45).setRestitution(0.05)
            : RAPIER.ColliderDesc.roundCylinder(PIN.h / 2 - 0.3, PIN.r - 0.3, 0.3).setDensity(0.22).setFriction(0.4).setRestitution(0.35);
        const c = world.createCollider(desc.setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS), rb);
        this.owners.set(c.handle, { kind: "toy", i: this.toys.length });
        this.toys.push({ kind: p.kind, pos, quat, color: p.kind === "domino" ? p.color : "#f4f1ea" });
        this.toyBodies.push(rb);
      }
  }

  /** How many of a kind of toy have been knocked over. */
  toppled(kind: "domino" | "pin") {
    let n = 0;
    const up = new THREE.Vector3();
    const q = new THREE.Quaternion();
    this.toyBodies.forEach((rb, i) => {
      if (this.toys[i].kind !== kind) return;
      const r = rb.rotation();
      up.set(0, 1, 0).applyQuaternion(q.set(r.x, r.y, r.z, r.w));
      const t = rb.translation();
      const h = this.toys[i].pos;
      if (up.y < 0.6 || (t.x - h.x) ** 2 + (t.z - h.z) ** 2 > 9) n++;
    });
    return n;
  }
  toyCount(kind: "domino" | "pin") {
    return this.toys.filter((t) => t.kind === kind).length;
  }

  /** Stand the yard's toys back up. */
  resetToys() {
    this.toys.forEach((t, i) => {
      const rb = this.toyBodies[i];
      rb.setTranslation(t.pos, false);
      rb.setRotation(t.quat, false);
      rb.setLinvel({ x: 0, y: 0, z: 0 }, false);
      rb.setAngvel({ x: 0, y: 0, z: 0 }, false);
      rb.sleep();
    });
  }

  // —————————————————————————————————————————— your car (the Stunt Yard)

  /** Put a car of yours down on the floor to drive (replacing the last one). */
  spawnDriven(model: number, spec: CarSpec, at: THREE.Vector3, yaw: number) {
    if (this.driven) this.remove(this.driven);
    const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
    const car = this.newCar(model, spec, at.clone().setY(RIDE + 0.6), q, false);
    car.driven = true;
    car.airborne = false;
    this.driven = car;
    this.fuel = 1;
    return car;
  }

  // —————————————————————————————————————————— cars in and out

  private makeBody(kinematic: boolean, pos: THREE.Vector3, quat: THREE.Quaternion, mass: number) {
    const desc = (kinematic ? RAPIER.RigidBodyDesc.kinematicPositionBased() : RAPIER.RigidBodyDesc.dynamic())
      .setTranslation(pos.x, pos.y, pos.z)
      .setRotation(quat)
      .setCcdEnabled(true)
      .setAngularDamping(0.35)
      .setLinearDamping(0.02);
    const rb = this.world.createRigidBody(desc);
    const r = 0.32;
    // the body is lifted CLEAR off the wheels' contact plane (the tyres are what touch)
    const hh = (2 * RIDE - CLEAR) / 2;
    const col = this.world.createCollider(
      RAPIER.ColliderDesc.roundCuboid(CAR_W / 2 - r, hh - r, CAR_LEN / 2 - r, r)
        .setTranslation(0, CLEAR / 2, 0)
        .setMass(mass)
        .setFriction(0.4)
        // the lower of the two surfaces wins: a car on its wheels can be made frictionless (its tyres are modelled by hand)
        .setFrictionCombineRule(RAPIER.CoefficientCombineRule.Min)
        .setRestitution(0.22)
        .setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS),
      rb,
    );
    return { rb, col };
  }

  private newCar(model: number, spec: CarSpec, pos: THREE.Vector3, quat: THREE.Quaternion, kinematic: boolean): Car {
    // the park only has so much floor: the oldest loose car is picked up first
    if (this.cars.length >= MAX_CARS) {
      const old = this.cars.find((c) => !c.held && c.mode === "free") ?? this.cars.find((c) => !c.held);
      if (old) this.remove(old);
    }
    const { rb, col } = this.makeBody(kinematic, pos, quat, spec.mass);
    const car: Car = {
      id: this.nextId++,
      model,
      spec,
      mass: spec.mass,
      ...resistanceOf(spec),
      mode: kinematic ? "track" : "free",
      track: null,
      s: 0,
      v: 0,
      hint: 0,
      lat: 0,
      held: false,
      rb,
      col,
      pos: pos.clone(),
      quat: quat.clone(),
      vel: new THREE.Vector3(),
      roll: 0,
      rollRate: 0,
      detachT: -10,
      lastTrack: null,
      airborne: !kinematic,
      airStart: this.clock,
      run: null,
      born: this.clock,
      scrape: 0,
      g: 1,
      boosting: false,
      loopIn: -1,
      rival: false,
      still: 0,
      grounded: false,
      boostK: 1,
      driven: false,
      push: 0,
      slip: 0,
      trick: null,
      upsideT: 0,
    };
    this.owners.set(col.handle, { kind: "car", car });
    this.cars.push(car);
    return car;
  }

  remove(car: Car) {
    const i = this.cars.indexOf(car);
    if (i < 0) return;
    this.cars.splice(i, 1);
    if (this.driven === car) this.driven = null;
    this.owners.delete(car.col.handle);
    this.world.removeRigidBody(car.rb);
  }

  /** The car waiting at a track's launcher or gate, if there is one. */
  heldOn(trackId: string) {
    return this.cars.find((c) => c.held && c.track?.id === trackId) ?? null;
  }

  /** Put a car at a track's launcher or gate, ready to go (clearing anything parked in its way). */
  stage(trackId: string, model: number, spec: CarSpec) {
    const tr = this.park.byId.get(trackId)!;
    const existing = this.heldOn(trackId);
    if (existing) {
      if (existing.model === model) return existing;
      this.remove(existing);
    }
    const hold = tr.hold!;
    tr.frameAt(hold.s, tmpF);
    for (const c of [...this.cars]) {
      if (c.mode === "track" && c.track === tr && Math.abs(c.s - hold.s) < CAR_LEN + 2) this.remove(c);
      else if (c.mode === "free" && c.pos.distanceTo(tmpF.p) < CAR_LEN) this.remove(c);
    }
    const car = this.newCar(model, spec, tmpF.p.clone(), new THREE.Quaternion(), true);
    car.track = tr;
    car.s = hold.s;
    car.held = true;
    this.place(car);
    car.rb.setTranslation(car.pos, false);
    car.rb.setRotation(car.quat, false);
    return car;
  }

  /** Send a held car on its way: the launcher fires it at `speed`; a gate just lets it roll. */
  fire(car: Car, speed: number, power: number) {
    if (!car.held || !car.track) return;
    car.held = false;
    car.v = speed;
    car.run = this.newRun(car.track.id, power);
    this.events.push({ type: "launch", car, power });
  }

  private newRun(trackId: string, power: number): Run {
    return { attraction: attractionOf(trackId), t0: this.clock, top: 0, air: 0, loops: 0, ring: false, finished: false, crashed: false, smashed: false, power, maxG: 1, laps: 0 };
  }

  /** Drop a car from above (it may land on a track and ride it). */
  drop(at: THREE.Vector3, model: number, spec: CarSpec, yaw: number, vel?: THREE.Vector3) {
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(0.15 * (Math.random() - 0.5), yaw, 0.15 * (Math.random() - 0.5)));
    const car = this.newCar(model, spec, at, q, false);
    car.rb.setLinvel(vel ?? { x: 0, y: -40, z: 0 }, true);
    car.rb.setAngvel(vel ? { x: 0, y: 0, z: 0 } : { x: (Math.random() - 0.5) * 2, y: (Math.random() - 0.5) * 2, z: (Math.random() - 0.5) * 2 }, true);
    car.run = null;
    return car;
  }

  /** Drop a car neatly onto a track, square to it and already rolling (the Crash Junction's hand-placed cars). */
  dropOn(trackId: string, s: number, height: number, speed: number, model: number, spec: CarSpec) {
    const tr = this.park.byId.get(trackId)!;
    tr.frameAt(s, tmpF);
    const at = tmpF.p.clone().addScaledVector(tmpF.u, RIDE + height);
    const car = this.newCar(model, spec, at, frameQuat(tmpF, new THREE.Quaternion()), false);
    car.rb.setLinvel(v3.copy(tmpF.t).multiplyScalar(speed).addScaledVector(tmpF.u, -30), true);
    car.run = this.newRun(trackId, 0);
    car.rollRate = speed;
    this.events.push({ type: "launch", car, power: 0 });
    return car;
  }

  /** Everything back: every car picked up, the castle rebuilt. */
  reset() {
    for (const c of [...this.cars]) this.remove(c);
    this.resetToys();
    this.blocks.forEach((b, i) => {
      const rb = this.blockBodies[i];
      rb.setTranslation(b.pos, false);
      rb.setRotation(b.quat, false);
      rb.setLinvel({ x: 0, y: 0, z: 0 }, false);
      rb.setAngvel({ x: 0, y: 0, z: 0 }, false);
      rb.sleep();
    });
  }

  /** How many blocks are out of place. */
  displaced() {
    let n = 0;
    this.blockBodies.forEach((rb, i) => {
      const t = rb.translation();
      const h = this.blocks[i].pos;
      if ((t.x - h.x) ** 2 + (t.y - h.y) ** 2 + (t.z - h.z) ** 2 > 2.2) n++;
    });
    return n;
  }

  castRay(o: THREE.Vector3, d: THREE.Vector3, max = 3000) {
    const hit = this.world.castRay(new RAPIER.Ray(o, d), max, true);
    return hit ? o.clone().addScaledVector(d, hit.timeOfImpact) : null;
  }

  /** Distance along a ray to the first fixed thing (floor, track, prop), ignoring cars and blocks. */
  castFixed(o: THREE.Vector3, d: THREE.Vector3, max: number) {
    this.ray.origin = o;
    this.ray.dir = d;
    const hit = this.world.castRay(this.ray, max, true, RAPIER.QueryFilterFlags.ONLY_FIXED);
    return hit ? hit.timeOfImpact : null;
  }

  // —————————————————————————————————————————— stepping

  update(dt: number, scale: number) {
    this.acc += Math.min(dt, 0.05) * scale;
    let n = 0;
    while (this.acc >= STEP && n < 12) {
      this.step();
      this.acc -= STEP;
      n++;
    }
    if (n === 12) this.acc = 0;
  }

  /** Off the track and flying: velocity from the track (or as given), a nudge of spin. */
  private detach(car: Car, why: "air" | "rail" | "end" | "hit", f: TrackFrame, given?: THREE.Vector3, spinGiven?: THREE.Vector3) {
    const tr = car.track!;
    const vel = given ? given.clone() : f.t.clone().multiplyScalar(car.v);
    if (why === "rail" && !given) {
      // over the outside wall: a hop up and out
      vel.addScaledVector(f.u, Math.abs(car.v) * 0.12);
      vel.addScaledVector(f.side, car.lat > 0 ? Math.abs(car.v) * 0.1 : -Math.abs(car.v) * 0.1);
    }
    car.mode = "free";
    car.held = false;
    car.lastTrack = tr;
    car.track = null;
    car.detachT = this.clock;
    car.airborne = true;
    car.airStart = this.clock;
    car.rb.setBodyType(RAPIER.RigidBodyType.Dynamic, true);
    car.rb.setTranslation(car.pos, true);
    car.rb.setRotation(car.quat, true);
    car.rb.setLinvel(vel, true);
    let spin = spinGiven;
    if (!spin) {
      // pitch the nose a touch as it leaves (a real car's rear wheels push off last)
      spin = new THREE.Vector3().crossVectors(f.t, f.u).multiplyScalar(why === "end" ? 0.6 : 1.4 * (Math.random() - 0.3));
      if (why === "rail") spin.addScaledVector(f.t, (car.lat > 0 ? -1 : 1) * 6);
    }
    car.rb.setAngvel(spin, true);
    car.vel.copy(vel);
    this.events.push({ type: "detach", car, why });
  }

  private capture(car: Car, tr: Track, s: number, f: TrackFrame, impact: number) {
    const air = this.clock - car.airStart;
    car.mode = "track";
    car.track = tr;
    car.s = tr.wrap(s);
    car.v = car.vel.dot(f.t);
    car.hint = 0;
    car.lat = THREE.MathUtils.clamp(car.pos.clone().sub(f.p).dot(f.side), -0.4, 0.4);
    car.rb.setBodyType(RAPIER.RigidBodyType.KinematicPositionBased, true);
    if (car.airborne && air > 0.08) {
      if (car.run) car.run.air = Math.max(car.run.air, air);
      this.events.push({ type: "land", car, air, impact, at: car.pos.clone() });
    }
    car.airborne = false;
  }

  private step() {
    const dt = STEP;
    this.clock += dt;
    this.smashCooldown -= dt;
    const f = tmpF;

    // —— cars on tracks ——
    for (const car of this.cars) {
      if (car.mode !== "track" || !car.track) continue;
      const tr = car.track;
      if (car.held) {
        car.v = 0;
        car.s = tr.hold!.s;
      } else {
        const prevS = car.s;
        const wasBoost = car.boosting;
        if (car.driven) {
          // your car's motor still drives it along a track it has landed on (and it can hop off)
          const c = this.control;
          car.push = c.throttle * (c.nitro && this.fuel > 0.02 ? 1300 : 650) * (c.throttle > 0 ? Math.max(0, 1 - Math.max(0, car.v) / 650) : 1);
          if (c.hop) {
            c.hop = false;
            tr.frameAt(car.s, f, car.hint);
            this.place(car);
            const v = f.t.clone().multiplyScalar(car.v).addScaledVector(f.u, 175);
            this.detach(car, "hit", f, v, new THREE.Vector3());
            this.events.push({ type: "hop", car });
            continue;
          }
        }
        const r = trackStep(car, tr, dt, f);
        if (car.boosting && !wasBoost) {
          this.events.push({ type: "boost", car });
          // the next booster bites a little differently (much more so on the junction's worn-in circuit)
          car.boostK = tr.closed ? 0.9 + Math.random() * 0.18 : 0.975 + Math.random() * 0.05;
        }
        tr.frameAt(car.s, f, car.hint);
        if (r === "air" || r === "rail") {
          this.place(car);
          this.detach(car, r, f);
          continue;
        }
        if (r === "end-open" || r === "start-open") {
          tr.frameAt(r === "end-open" ? tr.length : 0, f);
          car.s = r === "end-open" ? tr.length : 0;
          this.place(car);
          this.detach(car, "end", f);
          continue;
        }
        if (r === "bump-end" || r === "bump-start") {
          const strength = Math.abs(car.v) / 300;
          car.v = -car.v * 0.32;
          if (strength > 0.05) this.events.push({ type: "bump", car, strength, at: car.pos.clone() });
        }
        if (r === "lap" && car.run) {
          car.run.laps++;
          this.events.push({ type: "lap", car, laps: car.run.laps });
        }
        // loops: in at the bottom, out at the bottom on the far side
        tr.loops.forEach((l, li) => {
          if (prevS < l.s0 && car.s >= l.s0) car.loopIn = li;
          if (car.loopIn === li && prevS < l.s1 && car.s >= l.s1) {
            car.loopIn = -1;
            if (car.run) car.run.loops++;
            this.events.push({ type: "loop", car });
          }
        });
        if (tr.finish !== null && prevS < tr.finish && car.s >= tr.finish && car.run && !car.run.finished) {
          car.run.finished = true;
          this.events.push({ type: "finish", car, time: this.clock - car.run.t0 });
        }
        if (car.run) {
          car.run.top = Math.max(car.run.top, Math.abs(car.v));
          car.run.maxG = Math.max(car.run.maxG, car.g);
        }
      }
      this.place(car);
      car.vel.copy(fwdV).multiplyScalar(car.v);
      car.roll += car.v * dt;
      car.rollRate = car.v;
      car.rb.setNextKinematicTranslation(car.pos);
      car.rb.setNextKinematicRotation(car.quat);
    }

    this.bumpsAlongTracks();
    this.crossings();

    // —— the world ——
    for (const car of this.cars) if (car.mode === "free") car.vel.copy(car.rb.linvel() as THREE.Vector3);
    this.world.step(this.queue);

    this.queue.drainCollisionEvents((h1, h2, started) => {
      if (!started) return;
      const a = this.owners.get(h1);
      const b = this.owners.get(h2);
      if (!a || !b) return;
      for (const [me, other] of [
        [a, b],
        [b, a],
      ] as const) {
        if (me.kind !== "car") continue;
        const car = me.car;
        const what = other.kind === "car" ? "car" : other.kind === "block" ? "block" : other.kind === "toy" ? (this.toys[other.i].kind === "domino" ? "block" : "prop") : other.what;
        // still brushing the lip of the track it just left: not a landing, not a hit
        if (other.kind === "static" && other.track && other.track === car.lastTrack && this.clock - car.detachT < LEAVE_GRACE) continue;
        // a car still on its track that runs into something loose comes off it
        if (car.mode === "track" && (other.kind === "block" || other.kind === "toy" || (other.kind === "car" && other.car.mode === "free")) && !car.held) {
          car.track!.frameAt(car.s, f, car.hint);
          this.detach(car, "hit", f);
        }
        const speed = car.vel.length();
        if (car.mode === "free") {
          if (car.airborne) {
            const air = this.clock - car.airStart;
            if (car.run && air > 0.08) car.run.air = Math.max(car.run.air, air);
            car.airborne = false;
          }
          if (what === "floor" && car.run && !car.run.finished && !car.run.crashed) {
            car.run.crashed = true;
            this.events.push({ type: "wipeout", car });
          }
        }
        if (what === "block" && car.run && !car.run.smashed && this.smashCooldown <= 0) {
          car.run.smashed = true;
          this.smashCooldown = 0.5;
          this.events.push({ type: "smash", car });
        }
        this.events.push({ type: "hit", car, strength: Math.min(1.5, speed / 320), at: car.pos.clone(), what });
      }
      // toys knocking into toys or the floor: dominoes clack, skittles clonk
      if (a.kind !== "car" && b.kind !== "car")
        for (const t of [a, b])
          if (t.kind === "toy") {
            const rb = this.toyBodies[t.i];
            const lv = rb.linvel();
            const sp = Math.hypot(lv.x, lv.y, lv.z);
            if (sp > 12) this.events.push({ type: "hit", car: null, strength: sp / 160, at: new THREE.Vector3().copy(rb.translation() as THREE.Vector3), what: this.toys[t.i].kind === "domino" ? "block" : "prop" });
          }
      // blocks knocking into blocks or the floor
      if (a.kind === "block" && b.kind !== "car") {
        const lv = this.blockBodies[a.i].linvel();
        const sp = Math.hypot(lv.x, lv.y, lv.z);
        if (sp > 25) this.events.push({ type: "hit", car: null, strength: sp / 300, at: new THREE.Vector3().copy(this.blockBodies[a.i].translation() as THREE.Vector3), what: "block" });
      }
    });

    // —— loose cars: read back, roll on their wheels if upright, land on tracks ——
    const up = new THREE.Vector3();
    const fwd = new THREE.Vector3();
    for (const car of [...this.cars]) {
      if (car.mode !== "free") continue;
      const prev = car.pos.clone();
      car.pos.copy(car.rb.translation() as THREE.Vector3);
      car.quat.copy(car.rb.rotation() as THREE.Quaternion);
      const lv = car.rb.linvel();
      car.vel.set(lv.x, lv.y, lv.z);
      up.set(0, 1, 0).applyQuaternion(car.quat);
      fwd.set(0, 0, 1).applyQuaternion(car.quat);

      if (car.pos.y < -40 || Math.abs(car.pos.x) > 900 || Math.abs(car.pos.z) > 900) {
        this.remove(car);
        continue;
      }

      // through the ring of fire?
      for (const ring of this.rings) {
        const da = prev.clone().sub(ring.c).dot(ring.n);
        const db = car.pos.clone().sub(ring.c).dot(ring.n);
        if (da * db < 0) {
          const k = da / (da - db);
          const at = prev.clone().lerp(car.pos, k);
          if (at.distanceTo(ring.c) < ring.r && car.run && !car.run.ring) {
            car.run.ring = true;
            this.events.push({ type: "ring", car });
          }
        }
      }

      // your car through a checkpoint arch (going the right way)
      if (car.driven)
        for (const cp of this.checkpoints) {
          const da = v3.copy(prev).sub(cp.c).dot(cp.n);
          const db = v3.copy(car.pos).sub(cp.c).dot(cp.n);
          if (da < 0 && db >= 0) {
            const at = prev.clone().lerp(car.pos, da / (da - db));
            if (Math.abs(at.clone().sub(cp.c).dot(cp.side)) < cp.w / 2 && at.y < cp.h) this.events.push({ type: "checkpoint", car, i: cp.i });
          }
        }

      // land on a track: upright, close to the bed, moving along it and not away from it
      {
        let best: { tr: Track; s: number; h: number } | null = null;
        this.index.near(car.pos, (ti, i) => {
          const tr = this.park.tracks[ti];
          let s = tr.s[i] + v3.copy(car.pos).sub(tr.point(i, new THREE.Vector3())).dot(new THREE.Vector3(tr.t[i * 3], tr.t[i * 3 + 1], tr.t[i * 3 + 2]));
          if (tr.closed) s = tr.wrap(s);
          else if (s < 1 || s > tr.length - 1) return;
          if (tr === car.lastTrack && this.clock - car.detachT < 0.15) return;
          tr.frameAt(s, f, i);
          const rel = v3.copy(car.pos).sub(f.p);
          const h = rel.dot(f.u);
          const l = rel.dot(f.side);
          if (Math.abs(l) > 1.7 || h < RIDE - 0.9 || h > RIDE + 2.4) return;
          if (up.dot(f.u) < 0.62) return;
          if (car.vel.dot(f.u) > 25) return;
          if (!best || Math.abs(h - RIDE) < Math.abs(best.h - RIDE)) best = { tr, s, h };
        });
        if (best) {
          const b = best as { tr: Track; s: number; h: number };
          b.tr.frameAt(b.s, f);
          const impact = Math.max(0, -car.vel.dot(f.u));
          this.capture(car, b.tr, b.s, f, impact);
          this.place(car);
          car.rb.setNextKinematicTranslation(car.pos);
          car.rb.setNextKinematicRotation(car.quat);
          continue;
        }
      }

      // wheels down on something (the floor, the rug, a pad, a tower top): it rolls rather than slides
      let grounded = false;
      if (up.y > 0.35) {
        this.ray.origin = car.pos;
        this.ray.dir = v3.copy(up).negate();
        const hit = this.world.castRay(this.ray, RIDE + 0.5, true, undefined, undefined, undefined, car.rb);
        grounded = !!hit && hit.timeOfImpact < RIDE + 0.35;
      }
      car.grounded = grounded;
      // on its wheels the tyres (modelled below) do the work; sliding on its body, plain friction
      car.col.setFriction(grounded ? 0 : 0.45);
      if (car.driven) {
        this.drive(car, up, fwd, grounded, dt);
        car.roll += car.rollRate * dt;
        car.still = car.vel.lengthSq() < 9 ? car.still + dt : 0;
        continue;
      }
      if (grounded) {
        const vf = car.vel.dot(fwd);
        const vu = car.vel.dot(up);
        const lateral = car.vel.clone().addScaledVector(fwd, -vf).addScaledVector(up, -vu);
        const slow = (car.crr * G * 1.6 + car.kd * vf * vf) * dt;
        const nf = Math.abs(vf) <= slow ? 0 : vf - Math.sign(vf) * slow;
        // the tyres grip sideways: a sliding car scrubs off its sideways speed fast
        const nv = fwd.clone().multiplyScalar(nf).addScaledVector(up, vu).addScaledVector(lateral, Math.exp(-24 * dt));
        car.rb.setLinvel(nv, true);
        const av = car.rb.angvel();
        car.rb.setAngvel({ x: av.x * 0.96, y: av.y * 0.94, z: av.z * 0.96 }, true);
        car.rollRate = nf;
      } else car.rollRate *= Math.exp(-0.6 * dt);
      car.roll += car.rollRate * dt;
      car.still = car.vel.lengthSq() < 9 ? car.still + dt : 0;
    }
  }

  /**
   * Your car, under your hands. On its wheels: a small electric motor (it fades out towards top
   * speed; nitro raises both), brakes, and steering whose lock comes off with speed and whose
   * turn is capped by what the tyres can grip (about 1.4 g) — pull the handbrake and the rear lets
   * go into a slide. Off the ground the same keys pitch and roll it (flips and barrel rolls), and
   * nitro still pushes. The turning it does in the air is added up for the trick when it lands.
   */
  private drive(car: Car, up: THREE.Vector3, fwd: THREE.Vector3, grounded: boolean, dt: number) {
    const c = this.control;
    const left = new THREE.Vector3(1, 0, 0).applyQuaternion(car.quat);
    const boosting = c.nitro && this.fuel > 0.02;
    this.boosting = boosting;
    this.fuel = boosting ? Math.max(0, this.fuel - dt / 2.4) : Math.min(1, this.fuel + dt / 8);
    const av = new THREE.Vector3().copy(car.rb.angvel() as THREE.Vector3);
    const vel = car.vel.clone();
    if (grounded) {
      // the wheels touched down: finish the trick
      if (car.trick) this.land(car, up, true);
      car.airborne = false;
      const vf = vel.dot(fwd);
      let vu = vel.dot(up);
      const lateral = vel.clone().addScaledVector(fwd, -vf).addScaledVector(up, -vu);
      const top = boosting ? 720 : 440;
      let a = 0;
      if (c.throttle > 0) a = c.throttle * (boosting ? 1500 : 780) * Math.max(0, 1 - Math.max(0, vf) / top);
      else if (c.throttle < 0) a = vf > 15 ? 1800 * c.throttle : 540 * c.throttle * Math.max(0, 1 - Math.max(0, -vf) / 190);
      const resist = car.crr * G * 1.6 + car.kd * vf * vf + (c.throttle === 0 ? 70 : 0);
      let nf = vf + a * dt;
      nf -= Math.sign(nf) * Math.min(Math.abs(nf), resist * dt);
      // gripping tyres turn most of a sideways slide back into forward speed (they carve); a locked rear just slides
      const scrub = 1 - Math.exp(-(c.handbrake ? 2.6 : 16) * dt);
      if (!c.handbrake && Math.abs(nf) > 1) nf += Math.sign(nf) * lateral.length() * scrub * 0.8;
      lateral.multiplyScalar(1 - scrub);
      car.slip = lateral.length() + (c.handbrake && Math.abs(nf) > 60 ? 60 : 0);
      // steering: a bicycle model, capped by grip
      const wb = car.spec.front.z - car.spec.rear.z;
      const lock = 0.62 / (1 + Math.abs(nf) / 230);
      let yaw = (nf * Math.tan(-c.steer * lock)) / wb;
      const cap = Math.min(6, (1.4 * G) / Math.max(30, Math.abs(nf)));
      yaw = THREE.MathUtils.clamp(yaw, -cap, cap) * (c.handbrake ? 1.6 : 1);
      const perp = av.clone().addScaledVector(up, -av.dot(up)).multiplyScalar(0.85);
      av.copy(perp).addScaledVector(up, yaw);
      if (c.hop) {
        c.hop = false;
        vu += 175;
        av.addScaledVector(left, -1.2);
        this.events.push({ type: "hop", car });
      }
      car.rb.setLinvel(fwd.clone().multiplyScalar(nf).addScaledVector(up, vu).add(lateral), true);
      car.rb.setAngvel(av, true);
      car.rollRate = nf;
      car.upsideT = 0;
    } else {
      c.hop = false;
      // in the air: pitch and roll it, a nudge of nitro
      av.addScaledVector(left, c.throttle * 30 * dt).addScaledVector(fwd, c.steer * 32 * dt);
      if (av.length() > 17) av.setLength(17);
      car.rb.setAngvel(av, true);
      if (boosting) car.rb.setLinvel(vel.addScaledVector(fwd, 1100 * dt), true);
      car.rollRate *= Math.exp(-0.6 * dt);
      car.slip = 0;
      // the trick: count the turning about its own axes
      if (!car.trick && car.vel.length() > 20 && up.y > 0.35) {
        car.trick = { t: 0, pitch: 0, roll: 0, yaw: 0 };
        car.airborne = true;
      }
      if (car.trick) {
        const tk = car.trick;
        tk.t += dt;
        tk.pitch += av.dot(left) * dt;
        tk.roll += av.dot(fwd) * dt;
        tk.yaw += av.dot(up) * dt;
        // it came down on something other than its wheels (a roof, a side): that's a bail
        // (touching down tilted still counts once the wheels settle; only lying on its roof or side, or stuck, is a bail)
        if (!car.airborne && tk.t > 0.2 && (up.y < 0.45 || car.still > 0.3)) this.land(car, up, false);
      }
      // lying on its roof or side and stopped: set it back on its wheels
      if (up.y < 0.35 && car.vel.length() < 30) {
        car.upsideT += dt;
        if (car.upsideT > 1.1) {
          car.upsideT = 0;
          const h = fwd.clone().setY(0);
          if (h.lengthSq() < 1e-4) h.set(0, 0, 1);
          const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.atan2(h.x, h.z));
          car.rb.setTranslation({ x: car.pos.x, y: car.pos.y + 3, z: car.pos.z }, true);
          car.rb.setRotation(q, true);
          car.rb.setLinvel({ x: 0, y: 0, z: 0 }, true);
          car.rb.setAngvel({ x: 0, y: 0, z: 0 }, true);
          car.trick = null;
          this.events.push({ type: "righted", car });
        }
      } else car.upsideT = 0;
    }
  }

  /** Close out a trick: whole turns about each axis, and whether it came down on its wheels. */
  private land(car: Car, up: THREE.Vector3, wheels: boolean) {
    const tk = car.trick!;
    car.trick = null;
    if (tk.t < 0.2) return;
    const turns = (a: number) => Math.floor((Math.abs(a) + 0.75) / (Math.PI * 2));
    this.events.push({ type: "trick", car, air: tk.t, flips: turns(tk.pitch) * Math.sign(tk.pitch), rolls: turns(tk.roll), spins: turns(tk.yaw), clean: wheels && up.y > 0.75 });
  }

  /** Cars on the same track can't pass through each other: bumps along the track, mass-weighted. */
  private bumpsAlongTracks() {
    for (const tr of this.park.tracks) {
      const on = this.cars.filter((c) => c.mode === "track" && c.track === tr).sort((a, b) => a.s - b.s);
      const pairs = on.length - 1 + (tr.closed && on.length > 1 ? 1 : 0);
      for (let i = 0; i < pairs; i++) {
        const a = on[i];
        const b = on[(i + 1) % on.length];
        const gap = tr.delta(a.s, b.s) - CAR_LEN;
        if (gap >= 0 || tr.delta(a.s, b.s) < 0) continue;
        if (a.v > b.v) {
          const e = 0.55;
          const mid = (a.v * a.mass + b.v * b.mass) / (a.mass + b.mass);
          const rel = a.v - b.v;
          if (!a.held) a.v = mid - (e * rel * b.mass) / (a.mass + b.mass);
          if (!b.held) b.v = mid + (e * rel * a.mass) / (a.mass + b.mass);
          if (rel > 15) this.events.push({ type: "bump", car: b, strength: rel / 300, at: b.pos.clone() });
        }
        if (!a.held) a.s = tr.wrap(a.s + gap * (b.held ? 1 : 0.5));
        if (!b.held) b.s = tr.wrap(b.s - gap * (a.held ? 1 : 0.5));
      }
    }
  }

  /**
   * Two cars meeting side-on where lanes cross (or where one lane passes another's path): a real
   * collision. An impulse along the line between them (mass-weighted, a dull plastic-and-metal
   * bounce), a twist from where it lands off-centre, and both come off their tracks.
   */
  private crossings() {
    const on = this.cars.filter((c) => c.mode === "track" && !c.held);
    for (let i = 0; i < on.length; i++)
      for (let j = i + 1; j < on.length; j++) {
        const a = on[i];
        const b = on[j];
        if (a.mode !== "track" || b.mode !== "track") continue;
        // nose-to-tail on the same stretch is a bump, handled along the track
        if (a.track === b.track && Math.abs(a.track!.delta(a.s, b.s)) < CAR_LEN * 1.6) continue;
        if (a.pos.distanceToSquared(b.pos) > 81) continue;
        if (!boxesOverlap(a.pos, a.quat, b.pos, b.quat, 0.1)) continue;
        const n = new THREE.Vector3().subVectors(b.pos, a.pos);
        if (n.lengthSq() < 1e-6) n.set(1, 0, 0);
        n.normalize();
        const va = a.vel.clone();
        const vb = b.vel.clone();
        const rel = va.clone().sub(vb).dot(n);
        if (rel <= 0) continue;
        const e = 0.35;
        const imp = ((1 + e) * rel) / (1 / a.mass + 1 / b.mass);
        va.addScaledVector(n, -imp / a.mass);
        vb.addScaledVector(n, imp / b.mass);
        // a little hop: the cars ride up on each other's bodywork
        const hop = Math.min(80, rel * 0.18);
        va.y += hop * 0.6;
        vb.y += hop;
        const at = a.pos.clone().add(b.pos).multiplyScalar(0.5);
        // twist: the blow lands off each car's centre
        const ra = at.clone().sub(a.pos);
        const rb = at.clone().sub(b.pos);
        const spinA = new THREE.Vector3().crossVectors(ra, n.clone().multiplyScalar(-imp)).multiplyScalar(1 / (a.mass * 5.5));
        const spinB = new THREE.Vector3().crossVectors(rb, n.clone().multiplyScalar(imp)).multiplyScalar(1 / (b.mass * 5.5));
        // nudge them apart so the solver doesn't have to
        a.pos.addScaledVector(n, -0.25);
        b.pos.addScaledVector(n, 0.25);
        a.track!.frameAt(a.s, tmpF, a.hint);
        this.detach(a, "hit", tmpF, va, spinA);
        b.track!.frameAt(b.s, fF, b.hint);
        this.detach(b, "hit", fF, vb, spinB);
        if (a.run) a.run.crashed = true;
        if (b.run) b.run.crashed = true;
        this.events.push({ type: "crash", a, b, strength: Math.min(1.5, rel / 300), at });
      }
  }

  /**
   * Sit a car on its track the way a real one sits: each axle where its wheels touch the bed (a
   * car straddles a crest and dips into a hollow), the body pitched to match its own stance (the
   * big rear wheels give it a nose-down rake), riding a little off-centre in bends.
   */
  private place(car: Car) {
    const tr = car.track!;
    const { front, rear } = car.spec;
    tr.frameAt(car.s + front.z, fF, car.hint);
    tr.frameAt(car.s + rear.z, fR, car.hint);
    // wheel centres: the contact point, out to the car's running line, up by the wheel's radius
    wF.copy(fF.p).addScaledVector(fF.side, car.lat).addScaledVector(fF.u, front.r);
    wR.copy(fR.p).addScaledVector(fR.side, car.lat).addScaledVector(fR.u, rear.r);
    const d = e1.subVectors(wF, wR);
    const len = d.length();
    const Lz = front.z - rear.z;
    const h = front.r - rear.r;
    e1.divideScalar(len || 1);
    // the track's up, square to the axle line
    e2.addVectors(fF.u, fR.u);
    e2.addScaledVector(e1, -e2.dot(e1)).normalize();
    // turn the axle line into the body's forward: forward·d = Lz, up·d = h
    fwdV.copy(e1).multiplyScalar(Lz).addScaledVector(e2, -h).divideScalar(Math.hypot(Lz, h));
    upV.copy(e1).multiplyScalar(h).addScaledVector(e2, Lz).divideScalar(Math.hypot(Lz, h));
    sideV.crossVectors(upV, fwdV);
    car.pos.copy(wR).addScaledVector(upV, RIDE - rear.r).addScaledVector(fwdV, -rear.z);
    m4.makeBasis(sideV, upV, fwdV);
    car.quat.setFromRotationMatrix(m4);
  }

  /** Is anything still moving (cars or blocks)? */
  get busy() {
    return this.cars.some((c) => !c.held && (c.mode === "track" ? c.v !== 0 : c.still < 1)) || this.blockBodies.some((b) => !b.isSleeping());
  }

  dispose() {
    this.world.free();
    this.queue.free();
  }
}

export { BLOCK, frameQuat };
