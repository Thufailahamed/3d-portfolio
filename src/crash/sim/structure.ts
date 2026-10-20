/**
 * What a car is made of, as far as a crash is concerned: a field of crush strength built from where
 * its real parts sit (engine, wheels, cabin, measured off the model) and the construction archetype
 * that sets how strong each kind of structure is.
 *
 * A zone resists with a pressure σ while it is being crushed (a crash rail folding, an engine block
 * being shoved, honeycomb collapsing); σ is directional — a rail is strong along the car and weak
 * across it, a door the other way round — and η says how much of a zone's length can turn into crush
 * (≈0.7 for steel that folds, ≈0.85 for carbon that fragments, ≈0.1 for an engine that cannot fold
 * and is shoved instead). The front structures are calibrated against the categorical CRASH3
 * stiffness NHTSA derives from its barrier tests (WinSMASH 2010, DOT HS 811 546, table 2): for the
 * reference sedan, F/w = A + B·C with A ≈ 80 kN/m and B ≈ 0.57 MN/m². The archetypes for the exotic
 * cars are estimates from their construction; no crash data exists for most of them.
 */
import type { Outline } from "../data/outlines";
import type { ArchetypeId, Material, Plan, Zone, ZoneKind } from "./types";

const MPa = 1e6;

/** One kind of structure in an archetype: strength along and across the car (MPa), compaction, material. */
type Z = { s: number; lat?: number; eta: number; m?: Material };

type Archetype = {
  material: Material;
  /** where the main longitudinal members run (car-frame y, m) and how much of the half width they span */
  railY: [number, number];
  railZ: number;
  bumper: Z & { depth: number };
  front: Z;
  rear: Z;
  /** wheel arches, aprons, radiator support: the softer structure round the rails */
  apron: Z;
  /** a ladder frame the whole length of the car (body-on-frame) */
  frame?: Z;
  engine: Z;
  wheel: Z;
  floor: Z;
  sill: Z;
  door: Z & { depth: number };
  dash: Z;
  pillar: Z;
  roof: Z;
  interior: Z;
  background: Z;
};

/**
 * Strengths per construction (MPa). The reference sedan reproduces the CRASH3 category above; the
 * others are scaled from it by what is known of their structure.
 */
export const ARCHETYPES: Record<ArchetypeId, Archetype> = {
  // a generic modern steel unibody saloon: the calibration reference
  referenceSedan: {
    material: "steel",
    railY: [0.3, 0.62],
    railZ: 0.82,
    bumper: { s: 0.22, lat: 0.12, eta: 0.9, depth: 0.12 },
    front: { s: 0.5, lat: 0.12, eta: 0.7 },
    rear: { s: 0.42, lat: 0.1, eta: 0.7 },
    apron: { s: 0.1, lat: 0.06, eta: 0.85 },
    engine: { s: 1.3, eta: 0.12 },
    wheel: { s: 1.1, eta: 0.3, m: "rubber" },
    floor: { s: 1.0, lat: 0.9, eta: 0.5 },
    sill: { s: 1.3, lat: 0.85, eta: 0.5 },
    door: { s: 0.25, lat: 0.32, eta: 0.85, depth: 0.16 },
    dash: { s: 1.2, lat: 1.4, eta: 0.4 },
    pillar: { s: 0.8, lat: 0.9, eta: 0.5 },
    roof: { s: 0.35, lat: 0.35, eta: 0.6 },
    interior: { s: 0.08, eta: 0.9, m: "trim" },
    background: { s: 0.04, eta: 0.92, m: "trim" },
  },
  // carbon tub, carbon or aluminium crash structures: short, stiff front, a cell that barely yields
  carbonMonocoque: {
    material: "carbon",
    railY: [0.2, 0.52],
    railZ: 0.75,
    bumper: { s: 0.18, lat: 0.08, eta: 0.92, depth: 0.1, m: "composite" },
    front: { s: 0.75, lat: 0.15, eta: 0.85 },
    rear: { s: 0.5, lat: 0.12, eta: 0.85 },
    apron: { s: 0.08, lat: 0.05, eta: 0.9 },
    engine: { s: 1.6, eta: 0.12, m: "aluminium" },
    wheel: { s: 1.1, eta: 0.3, m: "rubber" },
    floor: { s: 2.8, lat: 2.6, eta: 0.6 },
    sill: { s: 3.0, lat: 2.4, eta: 0.6 },
    door: { s: 0.12, lat: 0.16, eta: 0.9, depth: 0.12 },
    dash: { s: 3.0, lat: 3.0, eta: 0.5 },
    pillar: { s: 2.0, lat: 2.0, eta: 0.6 },
    roof: { s: 1.0, lat: 1.0, eta: 0.6 },
    interior: { s: 0.06, eta: 0.9, m: "trim" },
    background: { s: 0.035, eta: 0.92, m: "trim" },
  },
  // 1966: an aluminium tub with the engine bolted on, a thin skin and no designed crush structure
  prototype1960s: {
    material: "aluminium",
    railY: [0.15, 0.45],
    railZ: 0.7,
    bumper: { s: 0.05, lat: 0.03, eta: 0.95, depth: 0.08 },
    front: { s: 0.22, lat: 0.06, eta: 0.6 },
    rear: { s: 0.2, lat: 0.06, eta: 0.6 },
    apron: { s: 0.04, lat: 0.03, eta: 0.95 },
    engine: { s: 1.5, eta: 0.12 },
    wheel: { s: 0.9, eta: 0.3, m: "rubber" },
    floor: { s: 0.75, lat: 0.6, eta: 0.5 },
    sill: { s: 0.8, lat: 0.55, eta: 0.5 },
    door: { s: 0.05, lat: 0.07, eta: 0.92, depth: 0.1 },
    dash: { s: 0.6, lat: 0.6, eta: 0.45 },
    pillar: { s: 0.3, lat: 0.3, eta: 0.6 },
    roof: { s: 0.1, lat: 0.1, eta: 0.7 },
    interior: { s: 0.05, eta: 0.9, m: "trim" },
    background: { s: 0.025, eta: 0.95, m: "trim" },
  },
  // a 2.5 t body-on-frame SUV: frame horns and rails high up, stiff, a heavy shell on top
  ladderFrameSuv: {
    material: "steel",
    // the frame rails and horns, and below them the front crossmember, axle and skid plate
    railY: [0.35, 0.78],
    railZ: 0.7,
    bumper: { s: 0.35, lat: 0.15, eta: 0.85, depth: 0.14 },
    front: { s: 0.65, lat: 0.22, eta: 0.65 },
    rear: { s: 0.6, lat: 0.16, eta: 0.65 },
    apron: { s: 0.16, lat: 0.08, eta: 0.85 },
    frame: { s: 0.85, lat: 0.45, eta: 0.5 },
    engine: { s: 1.4, eta: 0.12 },
    wheel: { s: 1.3, eta: 0.3, m: "rubber" },
    floor: { s: 1.1, lat: 1.0, eta: 0.5 },
    sill: { s: 1.0, lat: 0.85, eta: 0.5 },
    door: { s: 0.32, lat: 0.42, eta: 0.85, depth: 0.18 },
    dash: { s: 1.4, lat: 1.6, eta: 0.4 },
    pillar: { s: 1.0, lat: 1.1, eta: 0.5 },
    roof: { s: 0.45, lat: 0.45, eta: 0.6 },
    interior: { s: 0.09, eta: 0.9, m: "trim" },
    background: { s: 0.045, eta: 0.92, m: "trim" },
  },
  // 1987: a tubular steel frame under bonded Kevlar and carbon panels, no designed crush structure
  steelSpaceframeComposite: {
    material: "composite",
    railY: [0.15, 0.48],
    railZ: 0.7,
    bumper: { s: 0.1, lat: 0.05, eta: 0.92, depth: 0.1 },
    front: { s: 0.38, lat: 0.1, eta: 0.65, m: "steel" },
    rear: { s: 0.4, lat: 0.1, eta: 0.65, m: "steel" },
    apron: { s: 0.06, lat: 0.04, eta: 0.92 },
    engine: { s: 1.6, eta: 0.12, m: "aluminium" },
    wheel: { s: 1.0, eta: 0.3, m: "rubber" },
    floor: { s: 1.1, lat: 0.95, eta: 0.5, m: "steel" },
    sill: { s: 1.0, lat: 0.7, eta: 0.5, m: "steel" },
    door: { s: 0.07, lat: 0.1, eta: 0.92, depth: 0.1 },
    dash: { s: 1.0, lat: 1.2, eta: 0.4, m: "steel" },
    pillar: { s: 0.6, lat: 0.6, eta: 0.55, m: "steel" },
    roof: { s: 0.25, lat: 0.25, eta: 0.65 },
    interior: { s: 0.05, eta: 0.9, m: "trim" },
    background: { s: 0.03, eta: 0.94, m: "trim" },
  },
  // a production steel shell with a welded roll cage and door bars, lowered
  gtRaceCar: {
    material: "steel",
    railY: [0.15, 0.48],
    railZ: 0.8,
    bumper: { s: 0.14, lat: 0.07, eta: 0.92, depth: 0.1, m: "composite" },
    front: { s: 0.6, lat: 0.14, eta: 0.7 },
    rear: { s: 0.45, lat: 0.12, eta: 0.7 },
    apron: { s: 0.07, lat: 0.05, eta: 0.9, m: "composite" },
    engine: { s: 1.7, eta: 0.12, m: "aluminium" },
    wheel: { s: 1.1, eta: 0.3, m: "rubber" },
    floor: { s: 1.5, lat: 1.4, eta: 0.5 },
    sill: { s: 1.6, lat: 1.5, eta: 0.5 },
    door: { s: 0.3, lat: 0.55, eta: 0.8, depth: 0.14 },
    dash: { s: 1.6, lat: 1.8, eta: 0.4 },
    pillar: { s: 1.4, lat: 1.4, eta: 0.5 },
    roof: { s: 0.8, lat: 0.8, eta: 0.55 },
    interior: { s: 0.06, eta: 0.9, m: "trim" },
    background: { s: 0.035, eta: 0.93, m: "trim" },
  },
};

type Box = [number, number, number, number, number, number];

/** The car's layout as the structure needs it, all car frame (m). */
export type Layout = {
  plan: Plan;
  nose: number;
  tail: number;
  /** half width of the body (without mirrors) */
  half: number;
  height: number;
  beltline: number;
  axleF: number;
  axleR: number;
  wheelR: number;
  /** cabin cell: from the rear bulkhead to the front bulkhead (x) */
  cabin: [number, number];
  /** the top of the floor pan */
  floorTop: number;
  engine: Box | null;
  wheels: Box[];
  hPoint: [number, number, number];
};

const shrink = (b: Box, f: number): Box => {
  const c = [(b[0] + b[3]) / 2, (b[1] + b[4]) / 2, (b[2] + b[5]) / 2];
  return [c[0] - ((b[3] - b[0]) / 2) * f, c[1] - ((b[4] - b[1]) / 2) * f, c[2] - ((b[5] - b[2]) / 2) * f, c[0] + ((b[3] - b[0]) / 2) * f, c[1] + ((b[4] - b[1]) / 2) * f, c[2] + ((b[5] - b[2]) / 2) * f];
};

/** Read the car's layout off its measured outline and part boxes. */
export function layoutOf(o: Outline, opts: { width?: number; engineLayout: "front" | "front-mid" | "mid"; hPoint: [number, number, number] }): Layout {
  const p = o.parts;
  const plan = o.plan;
  const nose = plan.cx + plan.hx, tail = plan.cx - plan.hx;
  const wheels = (["wheel_fl", "wheel_fr", "wheel_rl", "wheel_rr"] as const).map((k) => p[k]).filter(Boolean) as Box[];
  const cx = (b: Box) => (b[0] + b[3]) / 2;
  const axleF = wheels.length >= 2 ? (cx(wheels[0]) + cx(wheels[1])) / 2 : nose - 1;
  const axleR = wheels.length >= 4 ? (cx(wheels[2]) + cx(wheels[3])) / 2 : tail + 1;
  const wheelR = wheels.length ? Math.max(0.25, (wheels[0][4] - wheels[0][1]) / 2) : 0.32;
  const height = p.body ? p.body[4] : 1.2;
  const engine = p.engine ? shrink(p.engine as Box, 0.85) : null;
  // the cabin's front bulkhead sits at the dashboard's front edge; its rear at the engine bay
  // (mid-engined) or behind the seats
  const dash = p.dashboard as Box | undefined;
  let front = dash ? dash[3] : axleF - wheelR;
  front = Math.min(front, axleF - wheelR * 0.6);
  let rear: number;
  if (opts.engineLayout === "mid" && engine) rear = engine[3] + 0.04;
  else rear = Math.max(p.seats ? (p.seats as Box)[0] : axleR, axleR - 0.35);
  rear = Math.min(rear, front - 0.8);
  const half = opts.width ? Math.min(plan.hz, opts.width / 2) : plan.hz - 0.08;
  return {
    plan,
    nose,
    tail,
    half,
    height,
    beltline: Math.min(1.25, Math.max(0.55, height * 0.6)),
    axleF,
    axleR,
    wheelR,
    cabin: [rear, front],
    floorTop: 0.35,
    engine,
    wheels,
    hPoint: opts.hPoint,
  };
}

/** The zones of a car: boxes of structure in the car frame, strengths from its archetype. */
export function buildZones(L: Layout, archetype: ArchetypeId): { zones: Zone[]; background: { sigma: number; eta: number; material: Material } } {
  const A = ARCHETYPES[archetype];
  const zones: Zone[] = [];
  const add = (kind: ZoneKind, z: Z, box: Box, soft = 0.03) => {
    if (box[3] - box[0] < 0.02 || box[4] - box[1] < 0.02 || box[5] - box[2] < 0.02) return;
    zones.push({
      kind,
      material: z.m ?? A.material,
      min: [box[0], box[1], box[2]],
      max: [box[3], box[4], box[5]],
      sigma: z.s * MPa,
      sigmaLat: (z.lat ?? z.s) * MPa,
      eta: z.eta,
      soft,
    });
  };
  const W = L.half;
  const [y0, y1] = A.railY;
  const [c0, c1] = L.cabin;
  const bd = A.bumper.depth;
  const floorTop = A.frame ? y1 - 0.12 : y0 + 0.15;
  const roofY = L.height;

  // the ends: bumpers, then the crush structures and the aprons round them
  add("bumper", A.bumper, [L.nose - bd, y0 - 0.08, -W, L.nose + 0.3, y1 + 0.08, W]);
  add("bumper", A.bumper, [L.tail - 0.3, y0 - 0.08, -W, L.tail + bd, y1 + 0.08, W]);
  add("crashbox", A.front, [c1, y0, -W * A.railZ, L.nose - bd, y1, W * A.railZ]);
  add("rail", A.rear, [L.tail + bd, y0, -W * A.railZ, c0, y1, W * A.railZ]);
  add("panel", { ...A.apron, m: A.apron.m }, [c1, y0 - 0.1, -W - 0.3, L.nose + 0.3, L.beltline + 0.1, W + 0.3]);
  add("panel", { ...A.apron, m: A.apron.m }, [L.tail - 0.3, y0 - 0.1, -W - 0.3, c0, L.beltline + 0.1, W + 0.3]);
  if (A.frame) add("frame", A.frame, [L.tail + bd, y0, -W * 0.62, L.nose - bd, y1, W * 0.62]);

  if (L.engine) add("engine", A.engine, L.engine);
  for (const w of L.wheels) add("wheel", A.wheel, w);

  // the cabin cell: floor and sills below, doors and their beams in the flanks, the bulkheads and
  // pillars, the roof; the space in between is seats and trim
  add("cabin", A.floor, [c0, 0.03, -W + 0.12, c1, floorTop, W - 0.12]);
  add("sill", A.sill, [c0, 0.03, -W - 0.3, c1, floorTop + 0.06, -W + 0.2]);
  add("sill", A.sill, [c0, 0.03, W - 0.2, c1, floorTop + 0.06, W + 0.3]);
  add("door", A.door, [c0 + 0.06, floorTop, -W - 0.3, c1 - 0.06, L.beltline, -W + A.door.depth]);
  add("door", A.door, [c0 + 0.06, floorTop, W - A.door.depth, c1 - 0.06, L.beltline, W + 0.3]);
  // the cell as a whole: crushing it lengthways means buckling its sills, tunnel, pillars and roof
  // rails together (as strong as its floor), while across it there is only the seats and trim
  add("greenhouse", { s: A.floor.s, lat: A.interior.s, eta: 0.45, m: A.interior.m }, [c0, floorTop, -W + A.door.depth, c1, roofY + 0.2, W - A.door.depth]);
  add("cabin", A.dash, [c1 - 0.22, floorTop - 0.05, -W - 0.3, c1, L.beltline + 0.08, W + 0.3]);
  add("cabin", A.dash, [c0, floorTop - 0.05, -W - 0.3, c0 + 0.16, L.beltline + 0.08, W + 0.3]);
  const xb = Math.min(c1 - 0.5, Math.max(c0 + 0.3, L.hPoint[0] - 0.22));
  for (const s of [-1, 1]) {
    add("pillar", A.pillar, [xb - 0.08, floorTop, s < 0 ? -W - 0.3 : W - 0.22, xb + 0.08, roofY + 0.2, s < 0 ? -W + 0.22 : W + 0.3]);
    // A-pillar and the roof rail above the door
    add("pillar", A.pillar, [c1 - 0.25, L.beltline - 0.05, s < 0 ? -W - 0.3 : W - 0.25, c1 + 0.12, roofY + 0.2, s < 0 ? -W + 0.25 : W + 0.3]);
    add("roof", A.roof, [c0, L.beltline + 0.1, s < 0 ? -W - 0.3 : W - 0.3, c1, roofY + 0.2, s < 0 ? -W + 0.3 : W + 0.3]);
  }
  add("roof", A.roof, [c0, roofY - 0.12, -W, c1, roofY + 0.2, W]);
  return { zones, background: { sigma: A.background.s * MPa, eta: A.background.eta, material: A.background.m ?? "trim" } };
}

export type Strength = { sigma: number; eta: number; material: Material; kind: ZoneKind | "background" };

/**
 * Crush strength at a car-frame point for crush along the direction (nx, nz) (the sample's normal):
 * the strongest zone there, its strength blended between along- and across-car by the direction.
 */
export function strengthAt(zones: Zone[], bg: { sigma: number; eta: number; material: Material }, x: number, y: number, z: number, nx: number, nz: number, out: Strength): Strength {
  // a zone that holds the point replaces the background (a barrier's honeycomb is weaker than the
  // rigid block behind it); where zones overlap, the strongest wins
  let best = -1, bestW = 0, eta = bg.eta, mat = bg.material;
  let kind: Strength["kind"] = "background";
  const ax = Math.abs(nx), az = Math.abs(nz), sum = ax + az || 1;
  for (let i = 0; i < zones.length; i++) {
    const zn = zones[i];
    if (x < zn.min[0] || x > zn.max[0] || y < zn.min[1] || y > zn.max[1] || z < zn.min[2] || z > zn.max[2]) continue;
    const soft = zn.soft ?? 0.03;
    const w =
      Math.min(1, (x - zn.min[0]) / soft, (zn.max[0] - x) / soft) *
      Math.min(1, (y - zn.min[1]) / soft, (zn.max[1] - y) / soft) *
      Math.min(1, (z - zn.min[2]) / soft, (zn.max[2] - z) / soft);
    const s = (zn.sigma * ax + (zn.sigmaLat ?? zn.sigma) * az) / sum;
    const ww = Math.max(0, w);
    if (bg.sigma > 1e9) {
      // a barrier: its layers of honeycomb sit in a rigid block, so the layer the point is most
      // inside decides, unblended (blending toward the block would put rigid seams between layers)
      if (ww > 0 && (ww > bestW || (ww === bestW && s > best))) {
        bestW = ww;
        best = s;
        eta = zn.eta;
        mat = zn.material;
        kind = zn.kind;
      }
      continue;
    }
    // a car: the soft edge blends into the trim around it; where zones overlap the strongest wins
    const v = bg.sigma + (s - bg.sigma) * ww;
    if (v > best) {
      best = v;
      eta = zn.eta;
      mat = zn.material;
      kind = zn.kind;
    }
  }
  out.sigma = best < 0 ? bg.sigma : best;
  out.eta = eta;
  out.material = mat;
  out.kind = kind;
  return out;
}
