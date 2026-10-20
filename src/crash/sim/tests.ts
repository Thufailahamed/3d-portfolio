/**
 * The crash lab's test catalogue: what each test is, its defaults and which settings it takes. Shared
 * by the solver (which lays the bodies out) and the HUD (which offers them). Descriptions are the
 * lab's own; the protocols they follow are cited in the method sheet, not named on screen.
 */
import type { Scenario, TestId } from "./types";

export type Control = "va" | "vb" | "overlap" | "angle" | "impactX" | "brakes";

export type TestDef = {
  id: TestId;
  name: string;
  /** barrier tests run car A alone; car-to-car tests need car B */
  group: "barrier" | "car";
  /** one line for the picker */
  short: string;
  /** what happens, for the setup panel */
  about: string;
  defaults: Pick<Scenario, "va" | "vb" | "overlap" | "angle" | "brakes">;
  controls: Control[];
  /** slider ranges (km/h, fraction, degrees) */
  ranges?: Partial<Record<"va" | "vb" | "overlap" | "angle", [number, number]>>;
};

export const tests: TestDef[] = [
  {
    id: "wall",
    name: "Full-width wall",
    group: "barrier",
    short: "Whole front into a rigid block",
    about: "The whole front of the car into a rigid concrete block faced with steel load cells. Nothing gives but the car, so it is the hardest pulse the cabin and its occupant see.",
    defaults: { va: 56, vb: 0, overlap: 1, angle: 0, brakes: "free" },
    controls: ["va", "brakes"],
    ranges: { va: [10, 120] },
  },
  {
    id: "odb",
    name: "Offset deformable barrier",
    group: "barrier",
    short: "40% of the front into honeycomb",
    about: "The driver's side 40% of the front into an aluminium honeycomb face on a rigid block. The honeycomb stands in for another car's front: half the structure has to take all the energy.",
    defaults: { va: 64, vb: 0, overlap: 0.4, angle: 0, brakes: "free" },
    controls: ["va", "overlap", "brakes"],
    ranges: { va: [20, 100], overlap: [0.3, 0.6] },
  },
  {
    id: "small",
    name: "Small overlap",
    group: "barrier",
    short: "25% of the front, rigid edge",
    about: "A quarter of the front, on the driver's side, into a rigid barrier with a rounded edge. It misses the main rails and loads the wheel and the cabin's corner directly.",
    defaults: { va: 64, vb: 0, overlap: 0.25, angle: 0, brakes: "free" },
    controls: ["va", "overlap", "brakes"],
    ranges: { va: [20, 100], overlap: [0.15, 0.35] },
  },
  {
    id: "pole",
    name: "Side pole",
    group: "barrier",
    short: "Sideways into a 254 mm pole",
    about: "The car is carried sideways into a narrow rigid pole, aligned with the driver's head, as a car sliding into a tree or a lamp post. Little structure, no crush space: intrusion decides it.",
    defaults: { va: 32, vb: 0, overlap: 1, angle: 75, brakes: "free" },
    controls: ["va", "angle"],
    ranges: { va: [10, 60], angle: [60, 90] },
  },
  {
    id: "mdb",
    name: "Side barrier",
    group: "barrier",
    short: "1,400 kg trolley into the door",
    about: "A wheeled trolley with a deformable face, the mass of a family car, driven into the stationary car's driver side at the seat: the T-bone every junction risks.",
    defaults: { va: 0, vb: 60, overlap: 1, angle: 90, brakes: "free" },
    controls: ["vb"],
    ranges: { vb: [20, 90] },
  },
  {
    id: "headon",
    name: "Head-on",
    group: "car",
    short: "Full overlap, car against car",
    about: "Both cars nose to nose, fully overlapped. Momentum decides who changes speed more: the lighter car takes the bigger Δv whatever its structure.",
    defaults: { va: 50, vb: 50, overlap: 1, angle: 0, brakes: "free" },
    controls: ["va", "vb", "brakes"],
    ranges: { va: [0, 120], vb: [0, 120] },
  },
  {
    id: "offset",
    name: "Offset head-on",
    group: "car",
    short: "Half the fronts overlapping",
    about: "Nose to nose with only part of the fronts overlapping, driver's side to driver's side — the commonest serious frontal crash. The cars snag and spin each other.",
    defaults: { va: 50, vb: 50, overlap: 0.5, angle: 0, brakes: "free" },
    controls: ["va", "vb", "overlap", "brakes"],
    ranges: { va: [0, 120], vb: [0, 120], overlap: [0.2, 0.9] },
  },
  {
    id: "tbone",
    name: "T-bone",
    group: "car",
    short: "A's front into B's driver door",
    about: "Car A's front into car B's driver side at right angles. B's occupant has a door's thickness of crush space; A's bumper height against B's sill decides how much reaches them.",
    defaults: { va: 50, vb: 0, overlap: 1, angle: 90, brakes: "free" },
    controls: ["va", "vb", "impactX", "brakes"],
    ranges: { va: [10, 110], vb: [0, 60] },
  },
  {
    id: "rear",
    name: "Rear-end",
    group: "car",
    short: "A into the back of B",
    about: "Car A runs into the back of car B, waiting or moving off. The rear structure and the closing speed matter; the front car's occupant is thrown back into the seat.",
    defaults: { va: 50, vb: 0, overlap: 1, angle: 0, brakes: "free" },
    controls: ["va", "vb", "brakes"],
    ranges: { va: [10, 110], vb: [0, 60] },
  },
  {
    id: "oblique",
    name: "Junction, angled",
    group: "car",
    short: "Paths crossing at an angle",
    about: "Both cars moving, paths crossing at an angle at a junction. The impulse is off-centre, so both cars rotate; where they come to rest follows from the tyres.",
    defaults: { va: 50, vb: 30, overlap: 1, angle: 45, brakes: "free" },
    controls: ["va", "vb", "angle", "brakes"],
    ranges: { va: [10, 110], vb: [0, 90], angle: [20, 70] },
  },
];

export const testById = Object.fromEntries(tests.map((t) => [t.id, t])) as Record<TestId, TestDef>;

export const isCarToCar = (id: TestId) => testById[id].group === "car";

/** A complete scenario for a test, from its defaults and whatever the user set. */
export function scenarioFor(id: TestId, a: string, b: string | undefined, over: Partial<Scenario> = {}): Scenario {
  const d = testById[id].defaults;
  return { test: id, a, b: isCarToCar(id) ? b : undefined, ...d, ...over };
}
