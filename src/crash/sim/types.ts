/**
 * The crash lab's contracts: how a body's outline and structure are described, the test that is
 * run, and the `Timeline` the solver records for the scene and the HUD to play back. The scene and
 * the HUD read nothing else, so either side can be rebuilt without touching the other.
 *
 * SI units throughout (m, kg, s, N, J, Pa) unless a name says otherwise (`kmh`, `g`, `ms`).
 * Car frame: the GLB's own — x forward (the nose), y up, z to the right, origin on the floor at the
 * middle of the footprint. World frame: the hall's — y up, the nominal impact point at the origin,
 * car A approaching along +x. Yaw is a rotation about +y (three.js convention), so a body with yaw ψ
 * points along (cos ψ, 0, −sin ψ) and its right side faces (sin ψ, 0, cos ψ).
 */

// ------------------------------------------------------------------ the crush grid

/** Height bands (car-frame y at rest, m). Structure, contact and crush are resolved per band. */
export const BAND_EDGES = [0.05, 0.2, 0.35, 0.5, 0.65, 0.8, 0.95, 1.1, 1.3, 1.55, 1.9] as const;
export const NB = BAND_EDGES.length - 1;
/** Samples round each band, evenly spaced in the perimeter parameter u (sample i at u = i / NS). */
export const NS = 192;
/** A surface offset meaning "this body has nothing at this height here". */
export const NO_SURFACE = 9;

/** The rounded rectangle every outline is measured from (see geometry.ts). */
export type Plan = { hx: number; hz: number; rc: number; cx: number; cz: number };

// ------------------------------------------------------------------ structure

/** What a zone is made of: how much of it can fold into crush, how it fails on screen, what it sheds. */
export type Material = "steel" | "aluminium" | "carbon" | "composite" | "glass" | "rubber" | "honeycomb" | "concrete" | "trim";

export type ZoneKind =
  | "bumper"
  | "crashbox"
  | "rail"
  | "frame"
  | "engine"
  | "wheel"
  | "cabin"
  | "sill"
  | "door"
  | "pillar"
  | "roof"
  | "panel"
  | "greenhouse"
  | "barrier";

/** A box of the car (car frame) and how hard it is to crush. */
export type Zone = {
  kind: ZoneKind;
  material: Material;
  min: [number, number, number];
  max: [number, number, number];
  /** crush strength: the pressure a face of this zone resists while it crushes (Pa), crushed along the car */
  sigma: number;
  /** crush strength when crushed across the car (Pa); defaults to `sigma` (a rail is far weaker sideways) */
  sigmaLat?: number;
  /** compaction: crush gained per metre of the zone consumed, (0, 1] (≈0.7 folding steel, ≈0.05 an engine block) */
  eta: number;
  /** width of the soft edge the strength fades over (m) */
  soft?: number;
};

/** Construction archetypes: each sets the strength and compaction of every zone kind (sim/structure.ts). */
export type ArchetypeId = "carbonMonocoque" | "prototype1960s" | "ladderFrameSuv" | "steelSpaceframeComposite" | "gtRaceCar" | "referenceSedan";

export type Restraint = "belt+airbag" | "belt" | "harness" | "lap" | "none";

/** A part that moves as a whole when the crush reaches it (the engine, the wheels, the steering column). */
export type RigidPart = { id: string; min: [number, number, number]; max: [number, number, number] };

/** What the solver knows about one body. Fixed barriers have `mass = Infinity`. */
export type BodyDef = {
  id: "a" | "b" | "barrier";
  kind: "car" | "wall" | "pole" | "mdb" | "odb";
  slug?: string;
  label: string;
  mass: number;
  /** yaw moment of inertia about the CG (kg·m²) */
  Iz: number;
  /** pitch and roll inertia (kg·m²), for the half-car models */
  Ipitch: number;
  Iroll: number;
  /** car-frame CG (x, height, z) */
  cg: [number, number, number];
  /** car-frame x of the front and rear axles, half tracks, wheel radius */
  axleF: number;
  axleR: number;
  halfTrackF: number;
  halfTrackR: number;
  wheelRadius: number;
  plan: Plan;
  /** NB × NS inward offsets from the plan rectangle to the real surface (row = band) */
  surface: Float32Array;
  zones: Zone[];
  /** what fills the outline where no zone does (trim, air, wiring) */
  background: { sigma: number; eta: number; material: Material };
  /** elastic contact stiffness per unit area (Pa/m) */
  elastic: number;
  archetype?: ArchetypeId;
  restraint: Restraint;
  airbags: { front: boolean; side: boolean };
  /** z sign of the driver's seat (−1 left-hand drive, +1 right-hand drive) */
  driverSide: -1 | 1;
  /** driver's H-point and steering-wheel hub, car frame */
  hPoint: [number, number, number];
  wheelHub: [number, number, number];
  rigid: RigidPart[];
  /** what the body panels are mostly made of (decides how they fail on screen) */
  bodyMaterial?: Material;
  /** the cabin cell along x (rear bulkhead, front bulkhead) and the beltline height, car frame */
  cabin?: [number, number];
  beltline?: number;
  /** the paint (linear rgb) and coolant colour, for debris */
  paint?: [number, number, number];
  coolant?: [number, number, number];
  /** how the mass was arrived at, for the HUD */
  massNote?: string;
};

// ------------------------------------------------------------------ the test

export type TestId = "wall" | "odb" | "small" | "pole" | "mdb" | "headon" | "offset" | "tbone" | "rear" | "oblique";

export type Scenario = {
  test: TestId;
  /** car A's slug (the car under test for barrier tests) */
  a: string;
  /** car B's slug, for car-to-car tests */
  b?: string;
  /** speeds (km/h): A's, and B's (or the trolley's for `mdb`) */
  va: number;
  vb: number;
  /** fraction of the struck width engaged, offset tests (0.25 small overlap, 0.4 ODB, 0.5 offset head-on) */
  overlap: number;
  /** impact angle (degrees): the pole's 75°, the intersection's 45°, 90° for a T-bone */
  angle: number;
  /** side tests: where along the struck car the impact is centred (car-frame x); default its driver's seat */
  impactX?: number;
  /** after the impact the wheels roll free, or are locked (the driver standing on the brakes) */
  brakes: "free" | "locked";
};

// ------------------------------------------------------------------ the timeline

/** One body's motion, frame by frame (frame k is at `Timeline.times[k]`). */
export type Track = {
  id: BodyDef["id"];
  /** world pose of the car frame's origin: x, y (heave), z, yaw, pitch (nose down +), roll (right side down +) */
  pose: Float32Array; // frames × 6
  /** world velocity of the CG (vx, vz) and yaw rate */
  vel: Float32Array; // frames × 3
  /** acceleration at the CG in the car frame, longitudinal (+ forward) and lateral (+ right), m/s²: raw, and CFC 60 */
  accRaw: Float32Array; // frames × 2
  acc: Float32Array; // frames × 2
  /** wheel spin angle (rad, + rolling forward) fl, fr, rl, rr; front steer (rad, + left) fl, fr */
  wheels: Float32Array; // frames × 6
  /** per rigid part (order of `rigidIds`): car-frame offset x, y, z and a yaw (rad) about the part's centre */
  rigidIds: string[];
  rigid: Float32Array; // frames × rigidIds.length × 4
  /** the resultant contact force on this body (world fx, fz, N) and where it acts (world x, z) */
  force: Float32Array; // frames × 4
};

/** Crush snapshots for one body: C (surface crush, incl. the elastic part while loaded), L (consumed depth), D (damage 0..1). */
export type CrushTrack = {
  id: BodyDef["id"];
  /** snapshot times (s); the first is all-zero, before contact */
  times: Float32Array;
  /** snapshots × NB × NS × 3, row-major (snapshot, band, sample, channel) */
  data: Float32Array;
};

export type Pane = "windscreen" | "rear" | "left-front" | "right-front" | "left-rear" | "right-rear";
export type Lamp = "head-left" | "head-right" | "tail-left" | "tail-right";
export type Bag = "driver" | "passenger" | "curtain-left" | "curtain-right";
export type Corner = "fl" | "fr" | "rl" | "rr";

export type SimEvent =
  | { t: number; type: "contact"; a: string; b: string; at: [number, number] }
  | { t: number; type: "separate"; a: string; b: string }
  | { t: number; type: "glass"; body: string; pane: Pane; kind: "crack" | "shatter"; origin: [number, number, number] }
  | { t: number; type: "lamp"; body: string; lamp: Lamp }
  | { t: number; type: "airbag"; body: string; bag: Bag }
  | { t: number; type: "jam"; body: string; wheel: Corner }
  | { t: number; type: "rest"; body: string };

/** What the debris is: decides its mesh, its material and how it bounces. */
export type DebrisKind = "glass" | "lens" | "amber" | "red" | "plastic" | "carbon" | "paint" | "metal" | "coolant";

/**
 * Debris as piecewise-quadratic segments, so any instant can be evaluated exactly (scrubbing back and
 * forth shows the same scatter). Particle p owns segments `first[p] … first[p] + count[p] − 1`; a
 * segment starts at time t0 with position, velocity and a constant acceleration (gravity in flight,
 * friction while sliding), and a spin about the particle's axis.
 */
export type DebrisSet = {
  kind: Uint8Array; // particles; index into DEBRIS_KINDS
  size: Float32Array; // particles: characteristic size (m)
  color: Float32Array; // particles × 3 (linear rgb), for paint flecks and plastics
  axis: Float32Array; // particles × 3 (unit spin axis)
  first: Uint32Array; // particles
  count: Uint16Array; // particles
  /** segments × 12: t0, x, y, z, vx, vy, vz, ax, ay, az, angle at t0, spin rate */
  seg: Float32Array;
};
export const DEBRIS_KINDS: DebrisKind[] = ["glass", "lens", "amber", "red", "plastic", "carbon", "paint", "metal", "coolant"];

/** Short-lived effects: sparks, dust puffs, airbag powder, steam. Rendered as sprites or streaks. */
export type Burst = { t: number; type: "sparks" | "dust" | "powder" | "steam"; at: [number, number, number]; dir: [number, number, number]; strength: number; dur: number };

/** Tyre marks on the floor: one polyline per wheel run, points (x, z, t, width, darkness). */
export type Skid = { body: string; wheel: Corner; pts: Float32Array };

/** The driver's motion in the car frame, for the dummy and the injury numbers. */
export type OccupantTrack = {
  body: BodyDef["id"];
  /** per frame: torso pitch (rad, forward +), torso lean (rad, toward +z), head pitch and lean relative to the torso, forward excursion of the head (m) */
  pose: Float32Array; // frames × 5
  /** per frame: resultant head and chest acceleration (g) */
  headG: Float32Array;
  chestG: Float32Array;
  /** per frame: belt or harness force (N) */
  belt: Float32Array;
  /** the airbag: when it fired, when it was full and when it had vented, or null */
  airbag: { fire: number; full: number; vented: number } | null;
};

export type Rating = "good" | "adequate" | "marginal" | "weak" | "poor";

export type BodyMetrics = {
  id: BodyDef["id"];
  label: string;
  /** change of velocity of the CG over the impact (km/h) */
  deltaV: number;
  /** CFC 60 longitudinal (or resultant for side impacts) deceleration: peak and mean over the pulse (g) */
  peakG: number;
  meanG: number;
  /** pulse duration (ms): first contact to separation, or to the end of significant force */
  pulseMs: number;
  /** occupant load criterion (g) */
  olc: number;
  /** greatest crush while loaded, and what remains after spring-back (m) */
  crushDynamic: number;
  crushResidual: number;
  /** how far the crush got into the cabin (m): footwell, dash / A-pillar, door at the occupant */
  intrusion: { footwell: number; dash: number; door: number };
  /** energy absorbed by this body's structure (J) */
  energy: number;
  /** where it came to rest (world) and when (s after T0) */
  rest: { x: number; z: number; yaw: number; t: number };
  occupant: {
    hic15: number;
    chest3ms: number;
    /** head excursion forward (m) */
    excursion: number;
    beltPeak: number;
    /** the hard thing the head reached, if any */
    contact: "wheel" | "dash" | "door" | "pillar" | "bag" | null;
    airbag: boolean;
    ratings: { head: Rating; chest: Rating; structure: Rating };
  } | null;
};

export type Metrics = {
  bodies: BodyMetrics[];
  closingKmh: number;
  /** coefficient of restitution along the line of impact */
  restitution: number;
  contactMs: number;
  /** total momentum (world x, z) just before first contact and just after separation, and |Δp| / |p| */
  momentum: { before: [number, number]; after: [number, number]; error: number };
  /**
   * energy balance: initial kinetic energy = final kinetic + crush (per body) + interface friction +
   * tyres + elastic still stored; `error` is how far the contact's own book (crush + friction +
   * elastic) is from the work its forces did, relative to the initial energy
   */
  energy: { initial: number; final: number; crush: number[]; friction: number; tyres?: number; elastic: number; error: number };
};

export type Timeline = {
  scenario: Scenario;
  /** frame times (s); T0 = 0 is the first contact, negative before it */
  times: Float32Array;
  bodies: BodyDef[];
  tracks: Track[];
  crush: CrushTrack[];
  events: SimEvent[];
  bursts: Burst[];
  debris: DebrisSet;
  skids: Skid[];
  occupants: OccupantTrack[];
  metrics: Metrics;
  /** how long the solve took (ms), for the HUD */
  solveMs: number;
};
