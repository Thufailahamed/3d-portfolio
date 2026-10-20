/**
 * The bodies a test can involve: the line-up's cars (from their published specs and the outlines and
 * part boxes measured off their models), a generic reference saloon for calibration, and the
 * barriers — rigid wall, small-overlap barrier, offset deformable barrier, pole and the side-impact
 * trolley — built to their protocols' dimensions. Barriers are bodies like any other: an outline, a
 * structure (honeycomb that crushes, a block that doesn't) and a mass (infinite when fixed).
 */
import { carBySlug } from "@/content/cars";
import { carSpecs, testMass } from "@/content/carSpecs";
import { outlines, type Outline } from "../data/outlines";
import { pointAt, project } from "./geometry";
import { buildZones, layoutOf } from "./structure";
import { NB, NO_SURFACE, NS, type BodyDef, type Plan, type RigidPart, type Zone } from "./types";

const RIGID = 1e12; // Pa: never yields
const CAR_ELASTIC = 8e7; // Pa/m: elastic contact stiffness per area of crushed sheet structure

const srgbToLinear = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
function hexToLinear(hex: string): [number, number, number] {
  const n = parseInt(hex.replace("#", ""), 16);
  return [srgbToLinear(((n >> 16) & 255) / 255), srgbToLinear(((n >> 8) & 255) / 255), srgbToLinear((n & 255) / 255)];
}

const box = (b: number[] | undefined): RigidPart["min"] | null => (b ? [b[0], b[1], b[2]] : null);

/** A car of the line-up, as tested: kerb mass plus the dummy and its instruments. */
export function carBody(slug: string, id: "a" | "b"): BodyDef {
  const o = outlines[slug];
  const spec = carSpecs[slug];
  const car = carBySlug[slug];
  if (!o || !spec) throw new Error(`no outline or spec for ${slug}`);
  const p = o.parts;
  const steer = p.steering;
  const hub: [number, number, number] = steer ? [(steer[0] + steer[3]) / 2, (steer[1] + steer[4]) / 2, (steer[2] + steer[5]) / 2] : [0.4, 0.75, -0.35];
  // the hip sits ≈0.6 m behind the wheel's hub and ≈0.35 m below it, on the seat cushion
  const floorY = p.seats ? p.seats[1] : 0.1;
  const hPoint: [number, number, number] = [hub[0] - 0.62, Math.max(floorY + 0.12, hub[1] - 0.36), hub[2]];
  const layout = layoutOf(o, { width: spec.width.v, engineLayout: spec.engine.layout, hPoint });
  const { zones, background } = buildZones(layout, spec.structure.archetype);
  const mass = testMass(spec);
  const wf = spec.weightFront.v;
  const cgX = layout.axleR + wf * (layout.axleF - layout.axleR);
  const L = spec.length.v, WB = spec.wheelbase.v;
  const Iz = 0.1478 * mass * WB * L;
  const rigid: RigidPart[] = [];
  for (const k of ["engine", "radiator", "wheel_fl", "wheel_fr", "wheel_rl", "wheel_rr", "steering"]) {
    const b = p[k];
    if (b) rigid.push({ id: k, min: box(b)!, max: [b[3], b[4], b[5]] });
  }
  const toyota = slug.startsWith("toyota");
  return {
    id,
    kind: "car",
    slug,
    label: car?.name ?? slug,
    mass,
    Iz,
    Ipitch: Iz * 0.95,
    Iroll: Iz * 0.22,
    cg: [cgX, spec.cgHeight.v, 0],
    axleF: layout.axleF,
    axleR: layout.axleR,
    halfTrackF: spec.trackF.v / 2,
    halfTrackR: spec.trackR.v / 2,
    wheelRadius: layout.wheelR,
    plan: o.plan,
    surface: Float32Array.from(o.surface),
    zones,
    background,
    elastic: CAR_ELASTIC,
    archetype: spec.structure.archetype,
    restraint: spec.structure.restraint,
    airbags: { front: spec.structure.airbags.front, side: spec.structure.airbags.side },
    driverSide: hub[2] >= 0 ? 1 : -1,
    hPoint,
    wheelHub: hub,
    rigid,
    bodyMaterial: zones.find((z) => z.kind === "door")?.material ?? "steel",
    cabin: layout.cabin,
    beltline: layout.beltline,
    paint: car ? hexToLinear(car.paint.colors[0].hex) : [0.5, 0.5, 0.5],
    coolant: toyota ? [0.85, 0.18, 0.42] : [0.12, 0.62, 0.22],
    massNote: `${spec.massKind === "dry" ? "dry mass + 60 kg fluids" : spec.massKind === "race minimum" ? "race minimum + 80 kg driver + 10 kg" : "kerb mass"} + test dummy`,
  };
}

/**
 * A synthetic outline from one rounded box per band (x from–to, half width, corner radius; null for
 * nothing at that height), measured exactly as scripts/crash/outlines.mjs measures the real cars:
 * the boxes' outlines sampled densely, projected onto the plan rectangle, the outermost per bin.
 */
function synthOutline(plan: Plan, bands: ([number, number, number, number] | null)[], parts: Outline["parts"]): Outline {
  const surface = new Array<number>(NB * NS).fill(NO_SURFACE);
  const pr = { u: 0, d: 0, nx: 0, nz: 0 };
  const bp = { x: 0, z: 0, nx: 0, nz: 0 };
  for (let b = 0; b < NB; b++) {
    const shape = bands[b];
    if (!shape) continue;
    const [x0, x1, w, r] = shape;
    const own: Plan = { hx: (x1 - x0) / 2, hz: w, rc: r, cx: (x0 + x1) / 2, cz: 0 };
    for (let j = 0; j < 4000; j++) {
      pointAt(own, j / 4000, bp);
      project(plan, bp.x, bp.z, pr);
      const k = b * NS + (Math.round(pr.u * NS) % NS);
      surface[k] = Math.min(surface[k], Math.max(0, pr.d));
    }
  }
  return { plan, surface, parts };
}

/**
 * The calibration reference: a generic 1,500 kg front-engined steel saloon, 4.7 × 1.8 × 1.45 m on a
 * 2.8 m wheelbase (NHTSA's "intermediate car" category). Never shown; used by the check script.
 */
export function referenceSedan(id: "a" | "b" = "a"): BodyDef {
  const plan: Plan = { hx: 2.35, hz: 0.9, rc: 0.4, cx: 0, cz: 0 };
  // the body to the bonnet line, then the scuttle and rear deck, the glasshouse and the roof
  const body: [number, number, number, number] = [-2.35, 2.35, 0.9, 0.4];
  const inset: ([number, number, number, number] | null)[] = [body, body, body, body, body, body, [-1.8, 1.35, 0.88, 0.35], [-1.4, 0.8, 0.72, 0.3], [-1.0, 0.35, 0.62, 0.25], null];
  const parts: Outline["parts"] = {
    body: [-2.35, 0.12, -0.9, 2.35, 1.45, 0.9],
    engine: [1.05, 0.25, -0.38, 1.85, 0.78, 0.38],
    dashboard: [0.45, 0.5, -0.8, 1.0, 1.0, 0.8],
    seats: [-1.3, 0.2, -0.75, 0.3, 1.25, 0.75],
    steering: [0.48, 0.7, -0.55, 0.62, 1.0, -0.2],
    wheel_fl: [1.07, 0, -0.9, 1.73, 0.66, -0.68],
    wheel_fr: [1.07, 0, 0.68, 1.73, 0.66, 0.9],
    wheel_rl: [-1.73, 0, -0.9, -1.07, 0.66, -0.68],
    wheel_rr: [-1.73, 0, 0.68, -1.07, 0.66, 0.9],
  };
  const o = synthOutline(plan, inset, parts);
  const hub: [number, number, number] = [0.55, 0.85, -0.37];
  const hPoint: [number, number, number] = [hub[0] - 0.62, 0.48, hub[2]];
  const layout = layoutOf(o, { width: 1.8, engineLayout: "front", hPoint });
  const { zones, background } = buildZones(layout, "referenceSedan");
  const mass = 1500;
  return {
    id,
    kind: "car",
    label: "Reference saloon",
    mass,
    Iz: 0.1478 * mass * 2.8 * 4.7,
    Ipitch: 0.1478 * mass * 2.8 * 4.7 * 0.95,
    Iroll: 0.1478 * mass * 2.8 * 4.7 * 0.22,
    cg: [layout.axleR + 0.6 * (layout.axleF - layout.axleR), 0.55, 0],
    axleF: layout.axleF,
    axleR: layout.axleR,
    halfTrackF: 0.78,
    halfTrackR: 0.78,
    wheelRadius: 0.33,
    plan,
    surface: Float32Array.from(o.surface),
    zones,
    background,
    elastic: CAR_ELASTIC,
    archetype: "referenceSedan",
    restraint: "belt+airbag",
    airbags: { front: true, side: true },
    driverSide: -1,
    hPoint,
    wheelHub: hub,
    rigid: ["engine", "wheel_fl", "wheel_fr", "wheel_rl", "wheel_rr", "steering"].map((k) => ({ id: k, min: [parts[k][0], parts[k][1], parts[k][2]], max: [parts[k][3], parts[k][4], parts[k][5]] })),
    bodyMaterial: "steel",
    cabin: layout.cabin,
    beltline: layout.beltline,
    paint: [0.3, 0.3, 0.32],
    coolant: [0.12, 0.62, 0.22],
    massNote: "1,500 kg as tested",
  };
}

// ------------------------------------------------------------------ barriers
// Each barrier's own frame has its struck face on local +x at x = 0, the block behind it (x < 0).

function barrier(kind: BodyDef["kind"], label: string, plan: Plan, faceInset: (band: number) => number, zones: Zone[], extra: Partial<BodyDef> = {}, faceOnly = false): BodyDef {
  const surface = new Float32Array(NB * NS);
  const bp = { x: 0, z: 0, nx: 0, nz: 0 };
  for (let b = 0; b < NB; b++)
    for (let i = 0; i < NS; i++) {
      pointAt(plan, i / NS, bp);
      const f = faceInset(b);
      // only the front face carries the honeycomb's steps; the block's other faces are flush
      surface[b * NS + i] = f >= NO_SURFACE ? NO_SURFACE : bp.nx > 0.5 ? f : faceOnly ? NO_SURFACE : 0;
    }
  return {
    id: "barrier",
    kind,
    label,
    mass: Infinity,
    Iz: Infinity,
    Ipitch: Infinity,
    Iroll: Infinity,
    cg: [plan.cx, 0.7, plan.cz],
    axleF: 0,
    axleR: 0,
    halfTrackF: 0,
    halfTrackR: 0,
    wheelRadius: 0.3,
    plan,
    surface,
    zones,
    background: { sigma: RIGID, eta: 0.01, material: "concrete" },
    elastic: 2e9,
    restraint: "none",
    airbags: { front: false, side: false },
    driverSide: -1,
    hPoint: [0, 0, 0],
    wheelHub: [0, 0, 0],
    rigid: [],
    bodyMaterial: "concrete",
    ...extra,
  };
}

/** A rigid concrete block faced with steel load cells, 1.5 m tall; `edge` rounds its corners (the small-overlap barrier's 150 mm). */
export function wall(edge = 0.02, width = 5): BodyDef {
  return barrier(edge > 0.05 ? "wall" : "wall", edge > 0.05 ? "Rigid barrier, rounded edge" : "Rigid barrier", { hx: 1.5, hz: width / 2, rc: edge, cx: -1.5, cz: 0 }, (b) => (b <= 8 ? 0 : NO_SURFACE), []);
}

/** The narrow rigid pole of the side test: 254 mm diameter. */
export function pole(): BodyDef {
  const r = 0.127;
  return barrier("pole", "Rigid pole, 254 mm", { hx: r, hz: r, rc: r, cx: 0, cz: 0 }, () => 0, [], { cg: [0, 1, 0] });
}

/**
 * The offset deformable barrier: a 1,000 mm wide, 650 mm tall, 450 mm deep aluminium honeycomb block
 * (0.342 MPa) with a 90 mm bumper element (1.711 MPa) across its lower part, on a rigid block; the
 * main block's lower edge 200 mm above the ground (UN R94 / the former Euro NCAP ODB protocol).
 */
export function odb(): BodyDef {
  const plan: Plan = { hx: 1.27, hz: 0.5, rc: 0.01, cx: -1.27, cz: 0 };
  // per band: the bumper element's face (0), the main block's (0.09), the rigid block's (0.54)
  const face = (b: number) => (b === 2 || b === 3 ? 0 : b === 1 || b === 4 || b === 5 ? 0.09 : b === 0 || b === 6 || b === 7 ? 0.54 : NO_SURFACE);
  const hc = (min: [number, number, number], max: [number, number, number], sigma: number): Zone => ({ kind: "barrier", material: "honeycomb", min, max, sigma, sigmaLat: sigma, eta: 0.8, soft: 0.002 });
  return barrier("odb", "Offset deformable barrier", plan, face, [
    hc([-0.09, 0.33, -0.56], [0.05, 0.62, 0.56], 1.711e6),
    hc([-0.54, 0.2, -0.56], [-0.08, 0.85, 0.56], 0.342e6),
  ], { background: { sigma: RIGID, eta: 0.01, material: "steel" } });
}

/**
 * The side-impact trolley (after the AE-MDB specification): 1,400 kg on a 3.0 m wheelbase and 1.5 m
 * track, its centre of mass 2.0 m behind the face and 0.5 m up; a 1,700 × 500 mm face of two rows of
 * progressively stiffer aluminium honeycomb, 440 mm deep, with a 60 mm bumper element on the lower
 * row, the rows meeting 550 mm above the ground. The layered strengths reproduce the face's
 * certification (61.5 kJ absorbed, 346 mm deep, 1,300 kg into a rigid wall at 35 km/h; checked).
 */
export function mdb(): BodyDef {
  const plan: Plan = { hx: 2.15, hz: 0.85, rc: 0.05, cx: -2.15, cz: 0 };
  // the face's rows by band: the lower row (with its bumper element) in band 2, the upper row in 3–4
  const face = (b: number) => (b === 2 ? 0 : b === 3 ? 0.03 : b === 4 ? 0.06 : NO_SURFACE);
  // the layers overlap a few millimetres so no seam of the rigid block shows between them
  const hc = (x0: number, x1: number, y0: number, y1: number, mpa: number): Zone => ({ kind: "barrier", material: "honeycomb", min: [x0 - 0.006, y0 - 0.006, -0.95], max: [x1 + 0.006, y1 + 0.006, 0.95], sigma: mpa * 1e6, eta: 0.8, soft: 0.002 });
  const zones = [
    hc(-0.17, 0.05, 0.3, 0.55, MDB_LAYERS[0]),
    hc(-0.34, -0.17, 0.3, 0.55, MDB_LAYERS[1]),
    hc(-0.5, -0.34, 0.3, 0.55, MDB_LAYERS[2]),
    hc(-0.2, 0.05, 0.55, 0.8, MDB_LAYERS[3]),
    hc(-0.35, -0.2, 0.55, 0.8, MDB_LAYERS[4]),
    hc(-0.5, -0.35, 0.55, 0.8, MDB_LAYERS[5]),
  ];
  const mass = 1400;
  return barrier("mdb", "Side-impact trolley, 1,400 kg", plan, face, zones, {
    mass,
    Iz: (mass * (4.3 ** 2 + 1.7 ** 2)) / 12,
    Ipitch: (mass * (4.3 ** 2 + 0.8 ** 2)) / 12,
    Iroll: (mass * (1.7 ** 2 + 0.8 ** 2)) / 12,
    cg: [-2.0, 0.5, 0],
    axleF: -1.0,
    axleR: -4.0,
    halfTrackF: 0.75,
    halfTrackR: 0.75,
    wheelRadius: 0.3,
    elastic: 1e8,
    background: { sigma: RIGID, eta: 0.01, material: "steel" },
  }, true);
}

/** Layer strengths of the trolley's face (MPa): lower row front to back, then the upper row. */
export const MDB_LAYERS = [0.23, 0.41, 0.63, 0.1, 0.18, 0.27];
