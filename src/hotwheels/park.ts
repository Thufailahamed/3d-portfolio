import * as THREE from "three";
import { Track, newFrame, type TrackSpec } from "./track";
import { TRACK } from "./units";
import { yardProps, yardPts, type YardProp } from "./yard";

/** a track lying on the floor: its skirt touches down, so the bed's top is this high */
export const FLOOR_Y = 0.62 + 0.03;

export type AttractionId = "loop" | "jump" | "drag" | "cyclone" | "junction" | "yard";

/**
 * A camera stop: the direction it looks from (yaw/pitch, radians) and the points it must keep in
 * frame (the camera works out its own distance and aim from those, for whatever screen it's on).
 */
export type Stop = { id: "overview" | AttractionId; label: string; yaw: number; pitch: number; pts: THREE.Vector3[] };

export type Attraction = {
  id: AttractionId;
  name: string;
  blurb: string;
  /** the track(s) cars start on; for the drag strip, [your lane, the rival's lane] */
  tracks: string[];
  /** how a run starts: a spring launcher, a gate at the top of a drop, or a car set down by hand */
  kind: "launcher" | "gate" | "drop" | "drive";
  accent: string;
};

export type Prop =
  | { kind: "launcher"; track: string; s: number }
  | { kind: "gate"; track: string; s: number }
  | { kind: "booster"; track: string; s: number }
  | { kind: "finish"; track: string; s: number; label: string; width?: number }
  | { kind: "tower"; x: number; z: number; r: number; h: number; color: string; label?: string }
  | { kind: "pad"; from: [number, number, number]; to: [number, number, number]; w: number }
  | { kind: "ring"; at: [number, number, number]; yaw: number; r: number }
  | { kind: "castle"; x: number; z: number; yaw: number }
  | { kind: "bin"; x: number; z: number; yaw: number }
  | { kind: "tree"; x: number; z: number }
  | { kind: "sign"; x: number; z: number; yaw: number; w: number; h: number; text: string; sub?: string; color: string }
  | { kind: "flag"; x: number; z: number; h: number; color: string }
  | { kind: "stand"; x: number; z: number; yaw: number }
  | { kind: "bunting"; a: [number, number, number]; b: [number, number, number]; sag: number }
  | { kind: "rug"; x: number; z: number; w: number; d: number }
  | { kind: "xplate"; x: number; z: number; yaw: number; s: number }
  | YardProp;

const LOOP_START: [number, number, number] = [-258, FLOOR_Y, -14];
const DRAG_Z = [100, 113];
const DRAG_X0 = -214;
const DRAG_LEN = 432;
const JUMP_TOWER = { x: 236, z: -150, h: 75 };
const CYC = { x: 150, z: -34, r: 30, h: 86 };
/** the Crash Junction: a figure 8 on the floor, its crossing at `x, z`, the loops either side along x */
const JCT = { x: -235, z: -160, r: 22, bank: 14 };
/** half the width of a lane across its walls: how far the crossing's cut-outs reach */
const LANE = TRACK.bed / 2 + TRACK.wallT;

export const SPECS: TrackSpec[] = [
  // —— Mega Loop: launcher → loop → banked hairpin → booster → loop → finish → catch bin ——
  {
    id: "loop",
    start: LOOP_START,
    yaw: 90,
    startEnd: "buffer",
    endEnd: "open",
    pieces: [
      { k: "straight", len: 78 },
      { k: "loop", r: 15.5, offset: -9.5 },
      { k: "straight", len: 34 },
      { k: "turn", r: 30, deg: 180, bank: 32 },
      { k: "straight", len: 42 },
      { k: "loop", r: 13.5, offset: 8.5 },
      { k: "straight", len: 72 },
    ],
  },
  // —— Sky Jump: gate at the top of the tower → drop → booster → kicker (open end) ——
  {
    id: "jump",
    start: [JUMP_TOWER.x + 6, JUMP_TOWER.h, JUMP_TOWER.z],
    noSupport: [{ s0: 0, s1: 30 }],
    yaw: -90,
    startEnd: "buffer",
    endEnd: "open",
    pieces: [
      { k: "straight", len: 24 },
      { k: "pitch", r: 30, deg: -45 },
      { k: "straight", len: 74 },
      { k: "pitch", r: 42, deg: 45 },
      { k: "straight", len: 46 },
      { k: "pitch", r: 42, deg: 24 },
      { k: "straight", len: 6 },
    ],
  },
  // the landing ramp the jump comes down on (placed from the kicker's lip in buildPark)
  {
    id: "landing",
    start: [0, 0, 0],
    yaw: -90,
    pitch: -13,
    startEnd: "open",
    endEnd: "open",
    pieces: [
      { k: "straight", len: 34 },
      { k: "pitch", r: 70, deg: 13 },
      { k: "straight", len: 58 },
    ],
  },
  // —— Drag strip: two lanes, side by side ——
  ...DRAG_Z.map(
    (z, i): TrackSpec => ({
      id: i === 0 ? "drag-a" : "drag-b",
      start: [DRAG_X0, FLOOR_Y, z],
      yaw: 90,
      startEnd: "buffer",
      endEnd: "buffer",
      pieces: [{ k: "straight", len: DRAG_LEN }],
      supports: { mode: "none" },
    }),
  ),
  // —— Cyclone Tower: gate at the top, a banked helix down round the tower, a wave section, finish ——
  {
    id: "cyclone",
    start: [CYC.x - 26, CYC.h, CYC.z - CYC.r],
    yaw: 90,
    startEnd: "buffer",
    endEnd: "buffer",
    pieces: [
      { k: "straight", len: 26 },
      { k: "pitch", r: 50, deg: -10.08 },
      { k: "turn", r: CYC.r, deg: -900, bank: 26 },
      { k: "pitch", r: 50, deg: 10.08 },
      { k: "straight", len: 34 },
      { k: "pitch", r: 34, deg: 13 },
      { k: "pitch", r: 34, deg: -26 },
      { k: "pitch", r: 34, deg: 13 },
      { k: "straight", len: 16 },
      { k: "pitch", r: 30, deg: 12 },
      { k: "pitch", r: 30, deg: -24 },
      { k: "pitch", r: 30, deg: 12 },
      { k: "straight", len: 96 },
    ],
    supports: { mode: "arms", center: [CYC.x, CYC.z], r: CYC.r },
    noSupport: [{ s0: 0, s1: 32 }],
  },
  // —— Crash Junction: a figure 8. Out of the crossing at 45°, round the right-hand loop, back
  // through the crossing at right angles to the way out, round the left-hand loop, and home.
  // Each loop is tangent to both diagonals, so the straights are exactly one radius long. ——
  {
    id: "junction",
    start: [JCT.x, FLOOR_Y, JCT.z],
    yaw: 45,
    closed: true,
    pieces: [
      { k: "straight", len: JCT.r },
      { k: "turn", r: JCT.r, deg: 270, bank: JCT.bank },
      { k: "straight", len: JCT.r * 2 },
      { k: "turn", r: JCT.r, deg: -270, bank: JCT.bank },
      { k: "straight", len: JCT.r },
    ],
    supports: { mode: "none" },
  },
];

export const ATTRACTIONS: Attraction[] = [
  { id: "loop", name: "Mega Loop", blurb: "Spring launcher, two loops and a banked hairpin. Too soft and you fall out of the loop; too hard and you fly off the curve.", tracks: ["loop"], kind: "launcher", accent: "#ff3b30" },
  { id: "jump", name: "Sky Jump", blurb: "Drop from a 75 cm tower, hit the booster and jump the gap through the ring of fire — straight into the block castle.", tracks: ["jump"], kind: "gate", accent: "#ffcc00" },
  { id: "drag", name: "Drag Strip", blurb: "Charge on the lights, release on green. Jump the start and you're out. Beat the rival to the line.", tracks: ["drag-a", "drag-b"], kind: "launcher", accent: "#34c759" },
  { id: "cyclone", name: "Cyclone Tower", blurb: "Two and a half banked turns down an 86 cm tower, then a wave section that throws fast cars into the air.", tracks: ["cyclone"], kind: "gate", accent: "#0a84ff" },
  { id: "junction", name: "Crash Junction", blurb: "A boosted figure 8 where the lanes cross at right angles. Drop cars in one after another and see how many laps they last before two meet in the middle.", tracks: ["junction"], kind: "drop", accent: "#bf5af2" },
  { id: "yard", name: "Stunt Yard", blurb: "Take the wheel on a play-mat road: kick ramps, a book jump, a domino run and a set of skittles. Flip it off the ramps for trick points, and set a lap for your ghost to chase.", tracks: [], kind: "drive", accent: "#ff7a00" },
];

export type Park = {
  tracks: Track[];
  byId: Map<string, Track>;
  props: Prop[];
  stops: Stop[];
  bounds: THREE.Box3;
  /** where the Crash Junction's cars are set down (track, arc length) */
  dropAt: { track: string; s: number };
};

/** Points along a track for the camera to keep in frame (the bed, and a car's height above it). */
function trackPts(t: Track, every = 12, s0 = 0, s1 = t.length) {
  const out: THREE.Vector3[] = [];
  const f = newFrame();
  for (let s = s0; s <= s1; s += every) {
    t.frameAt(s, f);
    out.push(f.p.clone(), f.p.clone().addScaledVector(f.u, 4));
  }
  return out;
}

/** Lay out the whole park: the tracks, the furniture on them, the scenery round them, the camera stops. */
export function buildPark(): Park {
  const specs = SPECS.map((s) => ({ ...s, pieces: [...s.pieces] }));
  const tracks: Track[] = [];
  const byId = new Map<string, Track>();
  const add = (spec: TrackSpec) => {
    const t = new Track(spec);
    t.index = tracks.length;
    tracks.push(t);
    byId.set(t.id, t);
    return t;
  };

  const loop = add(specs[0]);
  const jump = add(specs[1]);
  // the landing ramp starts a little lower than where an average jump would come down
  const lip = newFrame();
  jump.frameAt(jump.length, lip);
  const landingSpec = specs[2];
  const gap = 52;
  landingSpec.start = [lip.p.x - gap, lip.p.y + 5.2, lip.p.z];
  const landing = add(landingSpec);
  const dragA = add(specs[3]);
  const dragB = add(specs[4]);
  const cyclone = add(specs[5]);
  const junction = add(specs[6]);

  // the junction's crossing: the first pass (at the start and end of the lap) has its walls cut
  // away; the second pass (halfway down the long diagonal) leaves the crossing square to it
  const cross2 = junction.pieceAt[2] + JCT.r;
  junction.spec.openWalls = [
    { s0: 0, s1: LANE },
    { s0: junction.length - LANE, s1: junction.length },
  ];
  junction.spec.gaps = [{ s0: cross2 - LANE, s1: cross2 + LANE }];

  // —— what's on the tracks ——
  loop.hold = { s: 7, kind: "launcher" };
  loop.boosters = [{ s0: loop.pieceAt[4] + 12, s1: loop.pieceAt[4] + 24, speed: 330 }];
  loop.finish = loop.pieceAt[6] + 40;
  jump.hold = { s: 10, kind: "gate" };
  jump.boosters = [{ s0: jump.pieceAt[4] + 14, s1: jump.pieceAt[4] + 26, speed: 330 }];
  landing.finish = landing.pieceAt[2] + 22;
  landing.boosters = [{ s0: landing.pieceAt[2] + 34, s1: landing.pieceAt[2] + 46, speed: 440 }];
  for (const d of [dragA, dragB]) {
    d.hold = { s: 7, kind: "launcher" };
    d.finish = DRAG_LEN - 70;
    d.brakes = [{ s0: DRAG_LEN - 52, s1: DRAG_LEN }];
  }
  cyclone.hold = { s: 12, kind: "gate" };
  // a last booster after the waves, so a car that lands short of the line still makes it home
  cyclone.boosters = [{ s0: cyclone.pieceAt[12] + 14, s1: cyclone.pieceAt[12] + 26, speed: 300 }];
  cyclone.finish = cyclone.pieceAt[12] + 50;
  // two boosters, one on each diagonal, clear of the crossing either side
  junction.boosters = [
    { s0: 8, s1: 20, speed: 320 },
    { s0: junction.pieceAt[2] + 2, s1: junction.pieceAt[2] + 14, speed: 320 },
  ];
  const dropAt = { track: "junction", s: junction.pieceAt[2] - 10 };

  const props: Prop[] = [];
  props.push({ kind: "launcher", track: "loop", s: 0 });
  props.push({ kind: "booster", track: "loop", s: (loop.boosters[0].s0 + loop.boosters[0].s1) / 2 });
  props.push({ kind: "finish", track: "loop", s: loop.finish, label: "MEGA LOOP" });
  props.push({ kind: "gate", track: "jump", s: jump.hold.s + 4.2 });
  props.push({ kind: "booster", track: "jump", s: (jump.boosters[0].s0 + jump.boosters[0].s1) / 2 });
  props.push({ kind: "finish", track: "landing", s: landing.finish, label: "SKY JUMP" });
  props.push({ kind: "booster", track: "landing", s: (landing.boosters[0].s0 + landing.boosters[0].s1) / 2 });
  props.push({ kind: "launcher", track: "drag-a", s: 0 });
  props.push({ kind: "launcher", track: "drag-b", s: 0 });
  props.push({ kind: "finish", track: "drag-a", s: dragA.finish!, label: "DRAG STRIP", width: DRAG_Z[1] - DRAG_Z[0] + 8 });
  props.push({ kind: "gate", track: "cyclone", s: cyclone.hold.s + 4.2 });
  props.push({ kind: "booster", track: "cyclone", s: (cyclone.boosters[0].s0 + cyclone.boosters[0].s1) / 2 });
  props.push({ kind: "finish", track: "cyclone", s: cyclone.finish, label: "CYCLONE" });
  for (const b of junction.boosters) props.push({ kind: "booster", track: "junction", s: (b.s0 + b.s1) / 2 });
  // the crossing piece is a little bigger than the crossing, its corner clips out between the lanes
  props.push({ kind: "xplate", x: JCT.x, z: JCT.z, yaw: Math.PI / 4, s: LANE * 2 + 4.2 });

  // the catch bin past the Mega Loop's open end
  const end = newFrame();
  loop.frameAt(loop.length, end);
  const binAt = { x: end.p.x + end.t.x * 16, z: end.p.z + end.t.z * 16 };
  props.push({ kind: "bin", x: binAt.x, z: binAt.z, yaw: Math.atan2(end.t.x, end.t.z) });

  // the jump: a tower, the ring of fire over the gap's apex, the castle off the end of the landing
  props.push({ kind: "tower", x: JUMP_TOWER.x + 14, z: JUMP_TOWER.z, r: 12, h: JUMP_TOWER.h - TRACK.thick - 0.7, color: "#ffcc00", label: "SKY JUMP" });
  props.push({ kind: "pad", from: [JUMP_TOWER.x - 24, JUMP_TOWER.h - 0.7, JUMP_TOWER.z], to: [JUMP_TOWER.x + 22, JUMP_TOWER.h - 0.7, JUMP_TOWER.z], w: 12 });
  const ringAt: [number, number, number] = [lip.p.x - 37, lip.p.y + 9.4, lip.p.z];
  props.push({ kind: "ring", at: ringAt, yaw: Math.PI / 2, r: 9 });
  const lend = newFrame();
  landing.frameAt(landing.length, lend);
  const castleAt = { x: lend.p.x - 15, z: lend.p.z };
  props.push({ kind: "castle", x: castleAt.x, z: castleAt.z, yaw: Math.PI / 2 });

  // the drag strip's start tree, between and beside the lanes
  const treeAt = { x: DRAG_X0 + 30, z: DRAG_Z[0] - 9 };
  props.push({ kind: "tree", x: treeAt.x, z: treeAt.z });

  // the cyclone tower in the middle of its helix, with a start pad out to the track
  props.push({ kind: "tower", x: CYC.x, z: CYC.z, r: 17, h: CYC.h - 0.9, color: "#0a84ff", label: "CYCLONE" });
  props.push({ kind: "pad", from: [CYC.x - 30, CYC.h - 0.9, CYC.z - CYC.r + 6.5], to: [CYC.x + 4, CYC.h - 0.9, CYC.z - CYC.r + 6.5], w: 24 });

  // —— scenery: the park's signs, bleachers, flags and bunting, and a rug under the stands ——
  props.push({ kind: "rug", x: 50, z: 54, w: 300, d: 72 });
  props.push({ kind: "sign", x: -10, z: -212, yaw: 0, w: 120, h: 34, text: "DIE-CAST SPEEDWAY", sub: "STUNT PARK · EST. 2026", color: "#ff3b30" });
  props.push({ kind: "sign", x: JCT.x, z: JCT.z - 52, yaw: 0, w: 74, h: 18, text: "CRASH JUNCTION", sub: "FIGURE 8 · BOOSTED", color: "#bf5af2" });
  props.push({ kind: "stand", x: -10, z: 60, yaw: Math.PI });
  props.push({ kind: "stand", x: 120, z: 60, yaw: Math.PI });
  const flagColors = ["#ff3b30", "#ffcc00", "#0a84ff", "#34c759", "#ff9f0a", "#bf5af2"];
  const flags: [number, number][] = [
    [-280, 70], [-180, 70], [-80, 70], [20, 74], [60, -40], [-60, -130], [100, -120], [260, 40], [270, -60], [-318, -214],
  ];
  flags.forEach(([x, z], i) => props.push({ kind: "flag", x, z, h: 58 + (i % 3) * 8, color: flagColors[i % flagColors.length] }));
  props.push({ kind: "bunting", a: [-80, 66, 70], b: [20, 74, 74], sag: 9 });
  props.push({ kind: "bunting", a: [-180, 66, 70], b: [-80, 66, 70], sag: 8 });
  props.push({ kind: "bunting", a: [-68, 56, -212], b: [-60, 58, -130], sag: 6 });
  props.push({ kind: "bunting", a: [48, 56, -212], b: [100, 66, -120], sag: 7 });

  // —— the Stunt Yard, out on the floor in front ——
  props.push(...yardProps());

  const bounds = new THREE.Box3();
  for (const t of tracks) bounds.union(t.bounds);

  // —— camera stops: a direction each, and what must be in shot ——
  const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
  const finishTop = (t: Track) => {
    const f = newFrame();
    t.frameAt(t.finish!, f);
    return f.p.clone().setY(f.p.y + 22);
  };
  const stops: Stop[] = [
    { id: "overview", label: "Park", yaw: 0.1, pitch: 0.66, pts: tracks.flatMap((t) => trackPts(t, 40)) },
    { id: "loop", label: "Mega Loop", yaw: 0.48, pitch: 0.42, pts: [...trackPts(loop), finishTop(loop), V(binAt.x, 12, binAt.z)] },
    {
      id: "jump",
      label: "Sky Jump",
      yaw: -0.86,
      pitch: 0.36,
      pts: [
        ...trackPts(jump),
        ...trackPts(landing),
        V(JUMP_TOWER.x + 14, JUMP_TOWER.h + 4, JUMP_TOWER.z),
        V(castleAt.x, 26, castleAt.z - 22),
        V(castleAt.x, 26, castleAt.z + 22),
        V(ringAt[0], ringAt[1] + 10, ringAt[2]),
      ],
    },
    {
      id: "drag",
      label: "Drag Strip",
      yaw: -1.22,
      pitch: 0.4,
      // the business end: the line, the tree, and the run to the finish gantry
      pts: [...trackPts(dragA, 12, 0, dragA.finish! + 20), ...trackPts(dragB, 12, 0, dragB.finish! + 20), V(treeAt.x, 38, treeAt.z), finishTop(dragA)],
    },
    { id: "cyclone", label: "Cyclone", yaw: 1.1, pitch: 0.3, pts: [...trackPts(cyclone), V(CYC.x, CYC.h + 6, CYC.z)] },
    { id: "junction", label: "Junction", yaw: -0.22, pitch: 0.78, pts: [...trackPts(junction, 8), V(JCT.x, 46, JCT.z - 52)] },
    { id: "yard", label: "Stunt Yard", yaw: 0.08, pitch: 0.62, pts: yardPts() },
  ];

  return { tracks, byId, props, stops, bounds, dropAt };
}
