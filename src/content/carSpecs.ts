/**
 * Numbers for the comparison and the crash lab, one record per car of the line-up (slugs as in
 * cars.ts). Published figures carry their source; anything worked out or assumed is marked `est`
 * with the reason in `note`, and the pages show it as an estimate. "Model" means measured off the
 * car's 3D model (src/crash/data/outlines.ts), which matches the real car where both are known.
 */
import type { ArchetypeId, Restraint } from "@/crash/sim/types";

/** A figure: its value, where it was published, or that it is an estimate (and why). */
export type Fig = { v: number; src?: string; est?: boolean; note?: string };

export type GearboxKind = "manual" | "sequential" | "dct" | "automatic";

export type CarSpecs = {
  slug: string;
  /** what the mass figure is: kerb (ready to drive), dry (no fluids), or a race class minimum */
  mass: Fig;
  massKind: "kerb" | "dry" | "race minimum";
  /** m */
  length: Fig;
  width: Fig;
  height: Fig;
  wheelbase: Fig;
  trackF: Fig;
  trackR: Fig;
  clearance?: Fig;
  /** fraction of the mass on the front axle */
  weightFront: Fig;
  /** height of the centre of mass (m) */
  cgHeight: Fig;
  engine: {
    layout: "front" | "front-mid" | "mid";
    config: string;
    cc: Fig;
    cylinders: number;
    aspiration: string;
    kw: Fig;
    ps: Fig;
    powerRpm: Fig;
    nm: Fig;
    torqueRpm: Fig;
    /** turbo engines hold peak torque up to here (rpm) */
    torqueTo?: Fig;
    redline: Fig;
  };
  gearbox: { kind: GearboxKind; label: string; gears: number; ratios: Fig[]; final: Fig; shiftS: Fig };
  drive: "RWD" | "AWD" | "4WD";
  tyres: { front: string; rear: string; /** loaded rolling radius of the driven wheels (m) */ radius: Fig; /** peak longitudinal friction */ mu: Fig };
  aero: { cd: Fig; area: Fig; /** downforce at 200 km/h (N), where published */ downforce200?: Fig };
  published: { zeroTo100?: Fig; zeroTo60mph?: Fig; quarter?: Fig; topSpeed?: Fig; braking100?: Fig };
  structure: {
    archetype: ArchetypeId;
    chassis: string;
    body: string;
    airbags: { front: boolean; side: boolean; count?: number; note?: string };
    abs: boolean | null;
    restraint: Restraint;
    /** which side the driver sits (the model's steering wheel agrees) */
    drive: "LHD" | "RHD";
    note?: string;
  };
  production: { years: string; units?: Fig; price?: string };
  /** anything the pages should say about these numbers */
  notes?: string[];
};

const WIKI = {
  lykan: "https://en.wikipedia.org/wiki/W_Motors_Lykan_HyperSport",
  xj13: "https://en.wikipedia.org/wiki/Jaguar_XJ13",
  lc: "https://toyota.jp/pages/contents/landcruiser300/004_p_001/pdf/landcruiser300_spec_202503.pdf",
  ancap: "https://www.ancap.com.au/safety-ratings/toyota/landcruiser/c95f28",
  f40: "https://www.ferrari.com/en-EN/auto/f40",
  f40w: "https://en.wikipedia.org/wiki/Ferrari_F40",
  vulcan: "https://en.wikipedia.org/wiki/Aston_Martin_Vulcan",
  evoVulcan: "https://www.evo.co.uk/aston-martin/vulcan",
  supraBop: "https://www.motorsport.com/supergt/news/subaru-brz-bop-changes-fuji/10343284/",
  supraEngine: "https://en.wikipedia.org/wiki/Green_Brave",
  winsmash: "https://www.nhtsa.gov/sites/nhtsa.gov/files/811546.pdf",
};

const est = (v: number, note: string): Fig => ({ v, est: true, note });
const pub = (v: number, src: string, note?: string): Fig => ({ v, src, note });
const ratios = (rs: number[], src?: string, note?: string): Fig[] => rs.map((v) => (src ? pub(v, src, note) : est(v, note ?? "Not published: chosen to match the published top speed and redline")));

const list: CarSpecs[] = [
  {
    slug: "lykan-hypersport",
    mass: pub(1380, WIKI.lykan),
    massKind: "kerb",
    length: pub(4.48, WIKI.lykan),
    width: pub(1.944, WIKI.lykan),
    height: pub(1.17, WIKI.lykan),
    wheelbase: pub(2.625, WIKI.lykan),
    trackF: est(1.671, "Measured off the model"),
    trackR: est(1.631, "Measured off the model"),
    weightFront: est(0.41, "Typical of a mid-engined supercar"),
    cgHeight: est(0.45, "Typical of a low mid-engined car"),
    engine: {
      layout: "mid",
      config: "Flat-six (RUF)",
      cc: pub(3746, WIKI.lykan),
      cylinders: 6,
      aspiration: "Twin-turbo",
      kw: pub(552, WIKI.lykan, "W Motors' claim"),
      ps: pub(750, WIKI.lykan, "552 kW, W Motors' claim"),
      powerRpm: pub(7100, WIKI.lykan),
      nm: pub(960, WIKI.lykan, "W Motors' claim"),
      torqueRpm: pub(4000, WIKI.lykan),
      torqueTo: est(5200, "Turbo plateau, assumed"),
      redline: est(7500, "Not published"),
    },
    gearbox: {
      kind: "dct",
      label: "7-speed dual-clutch (6-speed sequential optional)",
      gears: 7,
      ratios: ratios([3.91, 2.29, 1.65, 1.3, 1.08, 0.88, 0.62], undefined, "Not published: a Porsche-type 7-speed dual-clutch, assumed"),
      final: est(3.44, "Not published"),
      shiftS: est(0.06, "Typical dual-clutch change"),
    },
    drive: "RWD",
    tyres: { front: "255/35 ZR19", rear: "335/30 ZR20", radius: est(0.345, "From the 335/30 ZR20 rear tyre, loaded"), mu: est(1.1, "Modern ultra-high-performance road tyre") },
    aero: { cd: est(0.34, "Not published"), area: est(1.95, "From width × height × 0.85") },
    published: { topSpeed: pub(395, WIKI.lykan, "W Motors' claim") },
    structure: {
      archetype: "carbonMonocoque",
      chassis: "Central tub with front and rear subframes",
      body: "Carbon fibre",
      airbags: { front: true, side: false, note: "Not published; front airbags assumed for a road-homologated 2013 car" },
      abs: true,
      restraint: "belt+airbag",
      drive: "LHD",
      note: "Construction details are not published; the crash lab treats it as a carbon-tub supercar.",
    },
    production: { years: "2013–2018", units: pub(7, WIKI.lykan), price: "US$3.4 million" },
  },
  {
    slug: "jaguar-xj13",
    mass: pub(998, WIKI.xj13),
    massKind: "kerb",
    length: { v: 4.48, est: true, note: "Disputed: Wikipedia gives 4,810 mm, but the model, whose 2,418 mm wheelbase matches the published 2,410 mm, measures 4,480 mm" },
    width: pub(1.8, WIKI.xj13),
    height: pub(1.0, WIKI.xj13),
    wheelbase: pub(2.41, WIKI.xj13),
    trackF: est(1.58, "Measured off the model"),
    trackR: est(1.47, "Measured off the model"),
    weightFront: est(0.42, "Mid-engined"),
    cgHeight: est(0.38, "A very low racing prototype"),
    engine: {
      layout: "mid",
      config: "60° V12, DOHC",
      cc: est(4991, "5.0 L (Wikipedia); exact capacity assumed from the XK-derived bore and stroke"),
      cylinders: 12,
      aspiration: "Naturally aspirated",
      kw: pub(374, WIKI.xj13, "502 hp"),
      ps: pub(509, WIKI.xj13, "502 hp"),
      powerRpm: pub(7600, WIKI.xj13),
      nm: est(520, "Not published: estimated from the power curve of a 5-litre racing V12"),
      torqueRpm: est(6300, "Not published"),
      redline: est(8000, "Not published"),
    },
    gearbox: {
      kind: "manual",
      label: "5-speed ZF 5DS/25 manual",
      gears: 5,
      ratios: ratios([2.42, 1.47, 1.09, 0.958, 0.846], undefined, "Not published for this car: the ZF 5DS/25's usual ratios, assumed"),
      final: est(3.73, "Not published"),
      shiftS: est(0.35, "A manual change"),
    },
    drive: "RWD",
    tyres: { front: "Dunlop racing, 15 in", rear: "Dunlop racing, 15 in", radius: est(0.31, "Measured off the model"), mu: est(1.0, "1960s racing tyre") },
    aero: { cd: est(0.36, "Not published"), area: est(1.53, "From width × height × 0.85") },
    published: {},
    structure: {
      archetype: "prototype1960s",
      chassis: "Aluminium centre tub, engine as a stressed member",
      body: "Aluminium",
      airbags: { front: false, side: false },
      abs: false,
      restraint: "none",
      drive: "RHD",
      note: "Built in 1966 with no designed crush structure; no seat belts are assumed, as was usual for its time.",
    },
    production: { years: "1966", units: pub(1, WIKI.xj13) },
  },
  {
    slug: "toyota-land-cruiser",
    mass: pub(2500, WIKI.lc, "ZX, 3.5 L petrol, 7 seats (Japanese spec sheet)"),
    massKind: "kerb",
    length: pub(4.985, WIKI.lc, "ZX"),
    width: pub(1.98, WIKI.lc),
    height: pub(1.925, WIKI.lc),
    wheelbase: pub(2.85, WIKI.lc),
    trackF: pub(1.665, WIKI.lc),
    trackR: pub(1.665, WIKI.lc),
    clearance: pub(0.225, WIKI.lc, "Toyota's own measurement"),
    weightFront: est(0.53, "Front-engined body-on-frame SUV"),
    cgHeight: est(0.75, "Typical of a large body-on-frame SUV"),
    engine: {
      layout: "front",
      config: "V6 (V35A-FTS)",
      cc: pub(3444, WIKI.lc),
      cylinders: 6,
      aspiration: "Twin-turbo",
      kw: pub(305, WIKI.lc),
      ps: pub(415, WIKI.lc),
      powerRpm: pub(5200, WIKI.lc),
      nm: pub(650, WIKI.lc),
      torqueRpm: pub(2000, WIKI.lc),
      torqueTo: pub(3600, WIKI.lc),
      redline: est(6000, "Not published"),
    },
    gearbox: {
      kind: "automatic",
      label: "10-speed automatic",
      gears: 10,
      ratios: ratios([4.923, 3.257, 2.349, 1.944, 1.532, 1.193, 1.0, 0.801, 0.661, 0.613], WIKI.lc),
      final: pub(3.307, WIKI.lc, "Transfer case high range 1.000"),
      shiftS: est(0.2, "A modern torque-converter automatic"),
    },
    drive: "4WD",
    tyres: { front: "265/55 R20", rear: "265/55 R20", radius: est(0.39, "From the 265/55 R20 tyre, loaded"), mu: est(0.85, "All-season SUV tyre") },
    aero: { cd: est(0.37, "Not published"), area: est(3.2, "From width × height × 0.85") },
    published: {},
    structure: {
      archetype: "ladderFrameSuv",
      chassis: "Body-on-frame (TNGA GA-F ladder frame)",
      body: "Steel, with aluminium closures",
      airbags: { front: true, side: true, note: `Dual frontal, side chest, side head and knee airbags (ANCAP: ${WIKI.ancap})` },
      abs: true,
      restraint: "belt+airbag",
      drive: "LHD",
      note: "Five stars from ANCAP (2022), with a penalty in the offset test for how hard its front structure loads an oncoming car.",
    },
    production: { years: "2021–" },
    notes: ["The petrol V35A version is sold in Japan and the Middle East; Australia gets the 3.3 L diesel (227 kW, 700 Nm)."],
  },
  {
    slug: "ferrari-f40",
    mass: pub(1100, WIKI.f40, "Dry"),
    massKind: "dry",
    length: pub(4.358, WIKI.f40),
    width: pub(1.97, WIKI.f40),
    height: pub(1.124, WIKI.f40),
    wheelbase: pub(2.45, WIKI.f40),
    trackF: pub(1.594, WIKI.f40),
    trackR: pub(1.606, WIKI.f40),
    weightFront: est(0.42, "Mid-engined"),
    cgHeight: est(0.42, "Typical of a low mid-engined car"),
    engine: {
      layout: "mid",
      config: "90° V8 (Tipo F120A)",
      cc: pub(2936, WIKI.f40),
      cylinders: 8,
      aspiration: "Twin-turbo (IHI)",
      kw: pub(351.5, WIKI.f40),
      ps: pub(478, WIKI.f40),
      powerRpm: pub(7000, WIKI.f40),
      nm: pub(577, WIKI.f40),
      torqueRpm: pub(4000, WIKI.f40),
      torqueTo: est(5000, "Turbo plateau, assumed"),
      redline: est(7750, "Not published"),
    },
    gearbox: {
      kind: "manual",
      label: "5-speed manual",
      gears: 5,
      ratios: ratios([2.8, 1.84, 1.36, 1.08, 0.88]),
      final: est(3.0, "Not published"),
      shiftS: est(0.35, "A manual change through a gated shifter"),
    },
    drive: "RWD",
    tyres: { front: "245/40 ZR17", rear: "335/35 ZR17", radius: est(0.325, "From the 335/35 ZR17 rear tyre, loaded"), mu: est(1.0, "A 1987 high-performance tyre") },
    aero: { cd: pub(0.34, WIKI.f40w), area: est(1.83, "From width × height × 0.83") },
    published: {
      zeroTo100: pub(4.1, WIKI.f40),
      quarter: pub(11.9, WIKI.f40, "Ferrari quotes 0–400 m"),
      topSpeed: pub(324, WIKI.f40),
    },
    structure: {
      archetype: "steelSpaceframeComposite",
      chassis: "Tubular steel frame with bonded composite panels",
      body: "Kevlar, carbon fibre and aluminium composites",
      airbags: { front: false, side: false },
      abs: false,
      restraint: "belt",
      drive: "LHD",
    },
    production: { years: "1987–1992", units: pub(1311, WIKI.f40), price: "US$400,000 (1987)" },
    notes: ["Ferrari quotes a dry weight; the crash lab and the acceleration model add fluids (≈60 kg) and an occupant."],
  },
  {
    slug: "ferrari-f40-liberty-walk",
    mass: est(1110, "Not published: the F40's 1,100 kg dry plus the riveted arches"),
    massKind: "dry",
    length: pub(4.358, WIKI.f40, "As the F40"),
    width: est(2.04, "Measured off the model; Liberty Walk publishes no figure"),
    height: est(1.1, "Lowered on air suspension; measured off the model"),
    wheelbase: pub(2.45, WIKI.f40, "As the F40"),
    trackF: est(1.64, "Wider wheels under the arches, assumed"),
    trackR: est(1.70, "Wider wheels under the arches, assumed"),
    weightFront: est(0.42, "As the F40"),
    cgHeight: est(0.4, "Lowered"),
    engine: {
      layout: "mid",
      config: "90° V8 (Tipo F120A)",
      cc: pub(2936, WIKI.f40),
      cylinders: 8,
      aspiration: "Twin-turbo (IHI)",
      kw: pub(351.5, WIKI.f40, "Stock"),
      ps: pub(478, WIKI.f40, "Stock"),
      powerRpm: pub(7000, WIKI.f40),
      nm: pub(577, WIKI.f40),
      torqueRpm: pub(4000, WIKI.f40),
      torqueTo: est(5000, "Turbo plateau, assumed"),
      redline: est(7750, "Not published"),
    },
    gearbox: {
      kind: "manual",
      label: "5-speed manual",
      gears: 5,
      ratios: ratios([2.8, 1.84, 1.36, 1.08, 0.88]),
      final: est(3.0, "Not published"),
      shiftS: est(0.35, "A manual change"),
    },
    drive: "RWD",
    tyres: { front: "Wider, under the over-fenders", rear: "Wider, under the over-fenders", radius: est(0.325, "As the F40"), mu: est(1.05, "Wider modern tyres, assumed") },
    aero: { cd: est(0.36, "The F40's 0.34 with wider arches, assumed"), area: est(1.9, "From width × height × 0.83") },
    published: {},
    structure: {
      archetype: "steelSpaceframeComposite",
      chassis: "Tubular steel frame with bonded composite panels",
      body: "Composites, with riveted over-fenders",
      airbags: { front: false, side: false },
      abs: false,
      restraint: "belt",
      drive: "LHD",
    },
    production: { years: "Kit shown at Tokyo Auto Salon 2023" },
    notes: ["A stock F40 underneath: the kit changes the width and stance, not the engine."],
  },
  {
    slug: "aston-martin-vulcan",
    mass: pub(1350, WIKI.vulcan, "Wikipedia lists 1,350–1,360 kg"),
    massKind: "kerb",
    length: pub(4.807, WIKI.vulcan),
    width: pub(2.063, WIKI.vulcan),
    height: pub(1.235, WIKI.vulcan),
    wheelbase: pub(2.791, WIKI.vulcan),
    trackF: est(1.74, "Measured off the model"),
    trackR: est(1.74, "Measured off the model"),
    weightFront: pub(0.47, WIKI.vulcan, "47/53, quoted for the AMR Pro"),
    cgHeight: est(0.4, "Typical of a GT race car"),
    engine: {
      layout: "front-mid",
      config: "V12",
      cc: pub(6949, WIKI.vulcan),
      cylinders: 12,
      aspiration: "Naturally aspirated",
      kw: pub(611, WIKI.vulcan),
      ps: pub(831, WIKI.vulcan, "Usually quoted as 820 bhp"),
      powerRpm: pub(7750, WIKI.vulcan),
      nm: pub(780, WIKI.vulcan),
      torqueRpm: pub(6500, WIKI.vulcan),
      redline: est(8000, "evo describes an 8,000 rpm rev range"),
    },
    gearbox: {
      kind: "sequential",
      label: "6-speed sequential",
      gears: 6,
      ratios: ratios([3.0, 2.15, 1.65, 1.32, 1.06, 0.85]),
      final: est(3.6, "Not published"),
      shiftS: est(0.05, "A paddle-shifted sequential"),
    },
    drive: "RWD",
    tyres: { front: "Michelin Pilot Sport Cup 2, 19 in", rear: "Michelin Pilot Sport Cup 2, 19 in", radius: est(0.339, "A 19 in rear wheel, loaded"), mu: est(1.25, "Road-legal track tyre") },
    aero: {
      cd: est(0.5, "Not published: a high-downforce body (chosen so drag and power give its top speed)"),
      area: est(2.17, "From width × height × 0.85"),
      downforce200: pub(4970, WIKI.vulcan, "Scaled with v² from 324 kg at 160 km/h"),
    },
    published: { zeroTo60mph: pub(2.9, WIKI.vulcan), topSpeed: pub(335, WIKI.vulcan, "Without the rear wing") },
    structure: {
      archetype: "carbonMonocoque",
      chassis: "Carbon-fibre monocoque, shared with the One-77",
      body: "Carbon fibre",
      airbags: { front: false, side: false, note: "A track-only car" },
      abs: null,
      restraint: "harness",
      drive: "LHD",
      note: "Wikipedia's infobox lists an aluminium chassis; Aston Martin described a carbon structure.",
    },
    production: { years: "2015–2016", units: pub(24, WIKI.vulcan), price: "US$2.3 million" },
  },
  {
    slug: "toyota-supra-gt300",
    mass: pub(1250, WIKI.supraBop, "Class minimum under the 2022 balance of performance"),
    massKind: "race minimum",
    length: est(4.575, "Measured off the model"),
    width: est(2.0, "The GT300 width limit; the model measures 2,084 mm with mirrors"),
    height: est(1.2, "Measured off the model, without the wing"),
    wheelbase: est(2.65, "Measured off the model"),
    trackF: est(1.68, "Measured off the model"),
    trackR: est(1.62, "Measured off the model"),
    weightFront: est(0.5, "Front-engined race car"),
    cgHeight: est(0.38, "Race ride height"),
    engine: {
      layout: "front-mid",
      config: "V8 (2UR-GSE based)",
      cc: est(5400, "5.4 L (Wikipedia, Green Brave)"),
      cylinders: 8,
      aspiration: "Naturally aspirated",
      kw: est(368, "Not published: class-typical under the balance of performance's air restrictors"),
      ps: est(500, "Not published"),
      powerRpm: est(7000, "Not published"),
      nm: est(560, "Not published"),
      torqueRpm: est(5500, "Not published"),
      redline: est(7500, "Not published"),
    },
    gearbox: {
      kind: "sequential",
      label: "6-speed sequential",
      gears: 6,
      ratios: ratios([2.9, 2.05, 1.6, 1.3, 1.1, 0.95], undefined, "Not published: typical of a GT300 sequential, assumed"),
      final: est(3.4, "Not published"),
      shiftS: est(0.05, "A paddle-shifted sequential"),
    },
    drive: "RWD",
    tyres: { front: "Racing slick, 18 in", rear: "Racing slick, 18 in", radius: est(0.355, "An 18 in GT300 slick, loaded"), mu: est(1.6, "Racing slick") },
    aero: { cd: est(0.45, "Not published"), area: est(2.0, "From width × height × 0.85"), downforce200: est(3000, "Not published: class-typical") },
    published: {},
    structure: {
      archetype: "gtRaceCar",
      chassis: "Production GR Supra shell with a welded roll cage (JAF-GT300 rules)",
      body: "Steel shell, composite panels",
      airbags: { front: false, side: false, note: "A race car: harness, seat and cage instead" },
      abs: null,
      restraint: "harness",
      drive: "RHD",
      note: "Real GT300 Supras run a 5.4 L V8; the showroom's model shows an inline-six modelled after the road car.",
    },
    production: { years: "2020–", price: "Team-run (Saitama Toyopet Green Brave and others)" },
    notes: ["Race figures are set by the series' balance of performance and change through the season; power is a class-typical estimate."],
  },
];

export const carSpecs: Record<string, CarSpecs> = Object.fromEntries(list.map((s) => [s.slug, s]));

/** Mass as tested: a kerb mass plus the occupant, a dry mass plus fluids too, a race minimum plus the driver. */
export function testMass(s: CarSpecs, occupant = 88) {
  if (s.massKind === "dry") return s.mass.v + 60 + occupant;
  if (s.massKind === "race minimum") return s.mass.v + 80 + 10;
  return s.mass.v + occupant;
}

/** Where the categorical crush stiffness used by the crash lab comes from (WinSMASH 2010 tables). */
export const STIFFNESS_SOURCE = WIKI.winsmash;
