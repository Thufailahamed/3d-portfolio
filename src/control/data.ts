/**
 * Everything the control room knows about the hardware: launch vehicles (stage masses, thrust and
 * specific impulse from the makers' user guides and public flight data), launch pads with their
 * range safety corridors, payloads, ground networks and the positions on the floor.
 */

export type StageSpec = {
  name: string;
  engine: string;
  engines: number;
  /** total thrust of the stage at sea level and in vacuum (kN) */
  thrustSL: number;
  thrustVac: number;
  ispSL: number;
  ispVac: number;
  /** usable propellant and burnout (dry) mass (kg) */
  prop: number;
  dry: number;
  /** deepest throttle setting (fraction); solids cannot throttle */
  minThrottle: number;
  /** engine arrangement drawn on the vehicle screen */
  layout: "f9" | "single" | "rs25" | "raptor33" | "ship6" | "rd180" | "rd107" | "srb" | "electron9" | "vulcain" | "twin";
};

export type BoosterSpec = StageSpec & { count: number; solid: boolean };

export type Recovery = "asds" | "rtls" | "catch" | "chute" | "expend";

export type VehicleId = "falcon9" | "falconheavy" | "starship" | "sls" | "atlas" | "ariane6" | "soyuz" | "electron";

export type Vehicle = {
  id: VehicleId;
  name: string;
  maker: string;
  country: string;
  height: number;
  diameter: number;
  boosters?: BoosterSpec;
  stages: [StageSpec, StageSpec];
  /** payload fairing or launch-escape tower mass, jettisoned in flight (kg) */
  fairing: number;
  /** while the boosters burn, the core throttles back to save propellant (Falcon Heavy) */
  coreThrottleWithBoosters?: number;
  /** throttle the liquid engines to keep dynamic pressure below this (kPa) */
  qLimit: number;
  /** upper stage lights while the lower is still firing (Soyuz, Starship) */
  hotStaging?: boolean;
  /** seconds between MECO and second-stage ignition */
  stagingGap: number;
  recovery: Recovery[];
  /** fraction of first-stage propellant held back for each recovery mode */
  reserve: Partial<Record<Recovery, number>>;
  boosterRecovery?: Recovery[];
  crewRated: boolean;
  pads: string[];
  firstFlight: number;
  cost: string;
  paint: { body: string; inter: string; accent: string; booster?: string; metal?: boolean };
  kit: "f9" | "fh" | "starship" | "sls" | "atlas" | "ariane" | "soyuz" | "electron";
  blurb: string;
};

const M1D = { engine: "Merlin 1D", layout: "f9" as const };

const F9_S1: StageSpec = { name: "First stage", ...M1D, engines: 9, thrustSL: 7607, thrustVac: 8227, ispSL: 283, ispVac: 312, prop: 411_000, dry: 25_600, minThrottle: 0.57 };
const F9_S2: StageSpec = { name: "Second stage", engine: "Merlin 1D Vacuum", engines: 1, thrustSL: 0, thrustVac: 981, ispSL: 0, ispVac: 348, prop: 107_500, dry: 4_000, minThrottle: 0.39, layout: "single" };

export const VEHICLES: Vehicle[] = [
  {
    id: "falcon9",
    name: "Falcon 9 Block 5",
    maker: "SpaceX",
    country: "USA",
    height: 70,
    diameter: 3.66,
    stages: [F9_S1, F9_S2],
    fairing: 1_900,
    qLimit: 32,
    stagingGap: 8,
    recovery: ["asds", "rtls", "expend"],
    reserve: { asds: 0.07, rtls: 0.14, expend: 0 },
    crewRated: true,
    pads: ["slc40", "lc39a", "slc4e"],
    firstFlight: 2010,
    cost: "$69.75 M",
    paint: { body: "#f2f2f0", inter: "#151515", accent: "#202020" },
    kit: "f9",
    blurb: "Two-stage kerosene/LOX workhorse. The booster flies back and lands for reuse — over 400 times so far.",
  },
  {
    id: "falconheavy",
    name: "Falcon Heavy",
    maker: "SpaceX",
    country: "USA",
    height: 70,
    diameter: 3.66,
    boosters: { ...F9_S1, name: "Side booster", count: 2, solid: false },
    stages: [{ ...F9_S1, name: "Center core", dry: 30_000 }, F9_S2],
    fairing: 1_900,
    coreThrottleWithBoosters: 0.62,
    qLimit: 34,
    stagingGap: 8,
    recovery: ["asds", "expend"],
    reserve: { asds: 0.08, expend: 0 },
    boosterRecovery: ["rtls"],
    crewRated: false,
    pads: ["lc39a"],
    firstFlight: 2018,
    cost: "$97 M",
    paint: { body: "#f2f2f0", inter: "#151515", accent: "#202020" },
    kit: "fh",
    blurb: "Three Falcon 9 cores strapped together: 27 engines at liftoff. Side boosters return to the Cape and land side by side.",
  },
  {
    id: "starship",
    name: "Starship (V2)",
    maker: "SpaceX",
    country: "USA",
    height: 123,
    diameter: 9,
    stages: [
      { name: "Super Heavy", engine: "Raptor 2", engines: 33, thrustSL: 74_400, thrustVac: 81_000, ispSL: 327, ispVac: 350, prop: 3_400_000, dry: 200_000, minThrottle: 0.4, layout: "raptor33" },
      { name: "Ship", engine: "Raptor 2 / RVac", engines: 6, thrustSL: 0, thrustVac: 14_700, ispSL: 0, ispVac: 368, prop: 1_500_000, dry: 130_000, minThrottle: 0.4, layout: "ship6" },
    ],
    fairing: 0,
    qLimit: 36,
    hotStaging: true,
    stagingGap: 1,
    recovery: ["catch", "expend"],
    reserve: { catch: 0.11, expend: 0 },
    crewRated: false,
    pads: ["starbase"],
    firstFlight: 2023,
    cost: "~$100 M (target)",
    paint: { body: "#b9bcc0", inter: "#9a9da2", accent: "#2a2a2a", metal: true },
    kit: "starship",
    blurb: "Fully reusable methane/LOX super-heavy lifter. The booster is caught by the launch tower's arms.",
  },
  {
    id: "sls",
    name: "SLS Block 1",
    maker: "NASA / Boeing",
    country: "USA",
    height: 98,
    diameter: 8.4,
    boosters: { name: "Solid rocket booster", engine: "5-segment SRB", engines: 1, count: 2, solid: true, thrustSL: 14_600, thrustVac: 16_000, ispSL: 242, ispVac: 268, prop: 631_000, dry: 98_000, minThrottle: 1, layout: "srb" },
    stages: [
      { name: "Core stage", engine: "RS-25", engines: 4, thrustSL: 7_440, thrustVac: 9_116, ispSL: 366, ispVac: 452, prop: 987_000, dry: 85_000, minThrottle: 0.67, layout: "rs25" },
      { name: "ICPS", engine: "RL10B-2", engines: 1, thrustSL: 0, thrustVac: 110, ispSL: 0, ispVac: 465.5, prop: 27_220, dry: 3_490, minThrottle: 1, layout: "single" },
    ],
    fairing: 7_400,
    qLimit: 36,
    stagingGap: 10,
    recovery: ["expend"],
    reserve: { expend: 0 },
    crewRated: true,
    pads: ["lc39b"],
    firstFlight: 2022,
    cost: "$2.2 B",
    paint: { body: "#d9772b", inter: "#d9772b", accent: "#f2f2f0", booster: "#f2f2f0" },
    kit: "sls",
    blurb: "NASA's Moon rocket: Shuttle-heritage RS-25 engines and solid boosters. Launches Orion on Artemis missions.",
  },
  {
    id: "atlas",
    name: "Atlas V 551",
    maker: "United Launch Alliance",
    country: "USA",
    height: 62.2,
    diameter: 3.81,
    boosters: { name: "Solid rocket boosters", engine: "AJ-60A", engines: 1, count: 5, solid: true, thrustSL: 1_500, thrustVac: 1_688, ispSL: 245, ispVac: 279, prop: 42_000, dry: 4_700, minThrottle: 1, layout: "srb" },
    stages: [
      { name: "Common Core Booster", engine: "RD-180", engines: 1, thrustSL: 3_827, thrustVac: 4_152, ispSL: 311, ispVac: 338, prop: 284_000, dry: 21_000, minThrottle: 0.47, layout: "rd180" },
      { name: "Centaur", engine: "RL10C-1", engines: 1, thrustSL: 0, thrustVac: 101.8, ispSL: 0, ispVac: 449.7, prop: 20_800, dry: 2_300, minThrottle: 1, layout: "single" },
    ],
    fairing: 4_000,
    qLimit: 40,
    stagingGap: 10,
    recovery: ["expend"],
    reserve: { expend: 0 },
    crewRated: true,
    pads: ["slc41"],
    firstFlight: 2002,
    cost: "$153 M",
    paint: { body: "#e9e6df", inter: "#f2f2f0", accent: "#d08a4a", booster: "#f2f2f0" },
    kit: "atlas",
    blurb: "Russian RD-180 booster, five solids and the high-energy Centaur. Flew Curiosity, Perseverance and New Horizons.",
  },
  {
    id: "ariane6",
    name: "Ariane 64",
    maker: "ArianeGroup / ESA",
    country: "Europe",
    height: 63,
    diameter: 5.4,
    boosters: { name: "P120C boosters", engine: "P120C", engines: 1, count: 4, solid: true, thrustSL: 3_800, thrustVac: 4_500, ispSL: 255, ispVac: 278.5, prop: 142_000, dry: 11_000, minThrottle: 1, layout: "srb" },
    stages: [
      { name: "Lower liquid module", engine: "Vulcain 2.1", engines: 1, thrustSL: 960, thrustVac: 1_370, ispSL: 318, ispVac: 431, prop: 150_000, dry: 16_000, minThrottle: 1, layout: "vulcain" },
      { name: "Upper liquid module", engine: "Vinci", engines: 1, thrustSL: 0, thrustVac: 180, ispSL: 0, ispVac: 457, prop: 31_000, dry: 5_000, minThrottle: 1, layout: "single" },
    ],
    fairing: 2_400,
    qLimit: 40,
    stagingGap: 10,
    recovery: ["expend"],
    reserve: { expend: 0 },
    crewRated: false,
    pads: ["ela4"],
    firstFlight: 2024,
    cost: "€115 M",
    paint: { body: "#f2f2f0", inter: "#1a1a1a", accent: "#2a5bd7", booster: "#f2f2f0" },
    kit: "ariane",
    blurb: "Europe's heavy launcher from French Guiana, 5° from the equator. The restartable Vinci engine reaches any orbit.",
  },
  {
    id: "soyuz",
    name: "Soyuz-2.1b",
    maker: "Progress RSC",
    country: "Russia",
    height: 46.3,
    diameter: 2.95,
    boosters: { name: "Strap-on boosters", engine: "RD-107A", engines: 4, count: 4, solid: false, thrustSL: 838.5, thrustVac: 1_021, ispSL: 263, ispVac: 320, prop: 39_160, dry: 3_784, minThrottle: 1, layout: "rd107" },
    stages: [
      { name: "Core (Block A)", engine: "RD-108A", engines: 4, thrustSL: 792.5, thrustVac: 990, ispSL: 258, ispVac: 320, prop: 90_100, dry: 6_545, minThrottle: 1, layout: "rd107" },
      { name: "Block I", engine: "RD-0124", engines: 4, thrustSL: 0, thrustVac: 294, ispSL: 0, ispVac: 359, prop: 25_400, dry: 2_355, minThrottle: 1, layout: "rd107" },
    ],
    fairing: 2_200,
    qLimit: 45,
    hotStaging: true,
    stagingGap: 1,
    recovery: ["expend"],
    reserve: { expend: 0 },
    crewRated: true,
    pads: ["baikonur"],
    firstFlight: 2006,
    cost: "~$80 M",
    paint: { body: "#d6d9d2", inter: "#d6d9d2", accent: "#e46a2c", booster: "#d6d9d2" },
    kit: "soyuz",
    blurb: "Descendant of Korolev's R-7, the rocket that launched Sputnik and Gagarin from this same steppe.",
  },
  {
    id: "electron",
    name: "Electron",
    maker: "Rocket Lab",
    country: "New Zealand / USA",
    height: 18,
    diameter: 1.2,
    stages: [
      { name: "First stage", engine: "Rutherford", engines: 9, thrustSL: 224, thrustVac: 232, ispSL: 290, ispVac: 311, prop: 9_250, dry: 950, minThrottle: 1, layout: "electron9" },
      { name: "Second stage", engine: "Rutherford Vacuum", engines: 1, thrustSL: 0, thrustVac: 25.8, ispSL: 0, ispVac: 343, prop: 2_050, dry: 250, minThrottle: 1, layout: "single" },
    ],
    fairing: 50,
    qLimit: 60,
    stagingGap: 4,
    recovery: ["chute", "expend"],
    reserve: { chute: 0, expend: 0 },
    crewRated: false,
    pads: ["mahia"],
    firstFlight: 2017,
    cost: "$7.5 M",
    paint: { body: "#141414", inter: "#141414", accent: "#f2f2f0" },
    kit: "electron",
    blurb: "Carbon-composite smallsat launcher with electric-pump Rutherford engines and 3D-printed chambers.",
  },
];
export const vehicleById = Object.fromEntries(VEHICLES.map((v) => [v.id, v])) as Record<VehicleId, Vehicle>;

export const RECOVERY_LABEL: Record<Recovery, string> = {
  asds: "Drone ship landing",
  rtls: "Return to launch site",
  catch: "Tower catch",
  chute: "Parachute & ocean recovery",
  expend: "Expendable",
};

export const DRONESHIPS = ["Of Course I Still Love You", "A Shortfall of Gravitas", "Just Read the Instructions"];

// ———————————————————————————— launch sites ————————————————————————————

export type Site = {
  id: string;
  name: string;
  short: string;
  place: string;
  lat: number;
  lon: number;
  tz: string;
  range: string;
  /** allowed ground azimuths (degrees clockwise from north) */
  az: [number, number];
  /** for the camera: which way the sea lies (degrees from north) and how far (m) — null for inland */
  sea: [number, number] | null;
  land: string;
  lz?: string;
  climate: { temp: number; wind: number; storm: number };
};

export const SITES: Site[] = [
  { id: "lc39a", name: "Kennedy Space Center LC-39A", short: "LC-39A", place: "Florida, USA", lat: 28.6082, lon: -80.6041, tz: "America/New_York", range: "Eastern Range", az: [35, 120], sea: [90, 1400], land: "#5f6d3c", lz: "Landing Zone 1", climate: { temp: 26, wind: 11, storm: 0.3 } },
  { id: "lc39b", name: "Kennedy Space Center LC-39B", short: "LC-39B", place: "Florida, USA", lat: 28.6272, lon: -80.6208, tz: "America/New_York", range: "Eastern Range", az: [35, 120], sea: [80, 1800], land: "#5f6d3c", climate: { temp: 26, wind: 11, storm: 0.3 } },
  { id: "slc40", name: "Cape Canaveral SLC-40", short: "SLC-40", place: "Florida, USA", lat: 28.5619, lon: -80.5772, tz: "America/New_York", range: "Eastern Range", az: [35, 120], sea: [100, 900], land: "#62703f", lz: "Landing Zone 1", climate: { temp: 26, wind: 11, storm: 0.3 } },
  { id: "slc41", name: "Cape Canaveral SLC-41", short: "SLC-41", place: "Florida, USA", lat: 28.5834, lon: -80.5829, tz: "America/New_York", range: "Eastern Range", az: [35, 120], sea: [95, 1100], land: "#62703f", climate: { temp: 26, wind: 11, storm: 0.3 } },
  { id: "slc4e", name: "Vandenberg SFB SLC-4E", short: "SLC-4E", place: "California, USA", lat: 34.6321, lon: -120.6106, tz: "America/Los_Angeles", range: "Western Range", az: [147, 235], sea: [250, 1200], land: "#7c7a4c", lz: "Landing Zone 4", climate: { temp: 16, wind: 14, storm: 0.05 } },
  { id: "starbase", name: "Starbase Orbital Launch Pad A", short: "OLP-A", place: "Texas, USA", lat: 25.9972, lon: -97.1566, tz: "America/Chicago", range: "FAA / Gulf corridor", az: [88, 115], sea: [80, 1600], land: "#9a8a62", lz: "Mechazilla tower", climate: { temp: 27, wind: 15, storm: 0.15 } },
  { id: "ela4", name: "Guiana Space Centre ELA-4", short: "ELA-4", place: "Kourou, French Guiana", lat: 5.262, lon: -52.786, tz: "America/Cayenne", range: "CSG range", az: [-10, 94], sea: [40, 7000], land: "#2f5a2e", climate: { temp: 28, wind: 9, storm: 0.35 } },
  { id: "baikonur", name: "Baikonur Cosmodrome Site 31", short: "Site 31/6", place: "Kazakhstan", lat: 45.996, lon: 63.564, tz: "Asia/Almaty", range: "Baikonur range", az: [34, 64], sea: null, land: "#8f8660", climate: { temp: 12, wind: 12, storm: 0.08 } },
  { id: "mahia", name: "Rocket Lab LC-1, Mahia", short: "LC-1A", place: "Mahia Peninsula, New Zealand", lat: -39.2615, lon: 177.8649, tz: "Pacific/Auckland", range: "Mahia range", az: [0, 200], sea: [100, 500], land: "#58733f", climate: { temp: 14, wind: 16, storm: 0.1 } },
];
export const siteById = Object.fromEntries(SITES.map((s) => [s.id, s])) as Record<string, Site>;

// ———————————————————————————— payloads ————————————————————————————

export type PayloadKind = "starlink" | "geo" | "gps" | "weather" | "eo" | "crew" | "cargo" | "l2" | "lunar" | "artemis" | "marsrover" | "marsorbiter" | "outer" | "rideshare" | "custom";

export type TargetSpec =
  | { kind: "orbit"; hp: number; ha: number; inc: number | "site" | "sso" }
  | { kind: "gto"; inc: "site" }
  | { kind: "escape"; c3: number | "mars"; dest: "l2" | "moon" | "mars" | "jupiter" };

export type Payload = {
  id: PayloadKind;
  name: string;
  short: string;
  mass: number;
  target: TargetSpec;
  crew?: number;
  /** satellite properties once on orbit */
  isp: number;
  propFrac: number;
  power: number;
  deployDelay: number;
  blurb: string;
  icon: string;
  prefer: VehicleId[];
};

export const PAYLOADS: Payload[] = [
  { id: "starlink", name: "Broadband constellation batch", short: "Starlink-class ×22", mass: 16_250, target: { kind: "orbit", hp: 285, ha: 290, inc: 43 }, isp: 1800, propFrac: 0.12, power: 28_000, deployDelay: 540, icon: "▦", prefer: ["falcon9"], blurb: "22 flat-packed satellites deployed at once. Their krypton Hall thrusters raise them to the 550 km shell over a few weeks." },
  { id: "geo", name: "Communications satellite", short: "GEO comsat", mass: 5_500, target: { kind: "gto", inc: "site" }, isp: 320, propFrac: 0.48, power: 18_000, deployDelay: 120, icon: "◈", prefer: ["falcon9", "atlas", "ariane6"], blurb: "Dropped in a geostationary transfer orbit. You raise its apogee and remove the inclination with its own engine." },
  { id: "gps", name: "Navigation satellite", short: "GPS III-class", mass: 4_400, target: { kind: "orbit", hp: 20_180, ha: 20_180, inc: 55 }, isp: 310, propFrac: 0.2, power: 4_480, deployDelay: 90, icon: "◇", prefer: ["falcon9", "atlas"], blurb: "Medium Earth orbit, 12-hour period, 55° inclination — two-burn direct insertion by the upper stage." },
  { id: "weather", name: "Weather satellite", short: "GOES-class", mass: 5_190, target: { kind: "gto", inc: "site" }, isp: 320, propFrac: 0.5, power: 4_000, deployDelay: 120, icon: "☁", prefer: ["atlas", "falcon9"], blurb: "Will park over the Americas 35,786 km up and image the full disk every 10 minutes." },
  { id: "eo", name: "Earth observation satellite", short: "Landsat-class", mass: 2_700, target: { kind: "orbit", hp: 705, ha: 705, inc: "sso" }, isp: 220, propFrac: 0.15, power: 4_300, deployDelay: 120, icon: "◎", prefer: ["falcon9", "atlas"], blurb: "Sun-synchronous orbit: J2 precession keeps local solar time fixed so every image has the same lighting." },
  { id: "crew", name: "Crewed spacecraft to the station", short: "Crew capsule (4)", mass: 12_500, crew: 4, target: { kind: "orbit", hp: 200, ha: 210, inc: 51.64 }, isp: 300, propFrac: 0.2, power: 4_000, deployDelay: 180, icon: "✦", prefer: ["falcon9", "soyuz"], blurb: "Four astronauts to the ISS. Abort is live from the pad to orbit; docking follows after about a day of phasing." },
  { id: "cargo", name: "Station resupply", short: "Cargo capsule", mass: 12_000, target: { kind: "orbit", hp: 200, ha: 210, inc: 51.64 }, isp: 300, propFrac: 0.2, power: 4_000, deployDelay: 720, icon: "▣", prefer: ["falcon9"], blurb: "Pressurised cargo, experiments and spare parts for the International Space Station." },
  { id: "l2", name: "Space telescope to Sun–Earth L2", short: "Infrared telescope", mass: 6_200, target: { kind: "escape", c3: -0.7, dest: "l2" }, isp: 300, propFrac: 0.05, power: 2_000, deployDelay: 1_620, icon: "⬡", prefer: ["ariane6", "falcon9"], blurb: "1.5 million km from Earth, in Earth's shadow cone, kept cold by a five-layer sunshield." },
  { id: "lunar", name: "Lunar orbiter", short: "Lunar probe", mass: 3_900, target: { kind: "escape", c3: -2, dest: "moon" }, isp: 320, propFrac: 0.4, power: 1_800, deployDelay: 300, icon: "◐", prefer: ["falcon9", "atlas"], blurb: "Trans-lunar injection from a parking orbit, a 4½-day coast, then lunar orbit insertion." },
  { id: "artemis", name: "Orion crewed lunar flyby", short: "Orion (Artemis)", mass: 26_500, crew: 4, target: { kind: "escape", c3: -1, dest: "moon" }, isp: 316, propFrac: 0.3, power: 11_000, deployDelay: 360, icon: "✧", prefer: ["sls"], blurb: "Four crew around the far side of the Moon and back on a free-return trajectory." },
  { id: "marsrover", name: "Mars rover", short: "Curiosity-class rover", mass: 4_000, target: { kind: "escape", c3: "mars", dest: "mars" }, isp: 220, propFrac: 0.1, power: 110, deployDelay: 2_700, icon: "⬢", prefer: ["atlas", "falcon9"], blurb: "Needs a Mars window. After the cruise the EDL team lands it in Gale crater — and you can drive it." },
  { id: "marsorbiter", name: "Mars orbiter", short: "MRO-class orbiter", mass: 2_200, target: { kind: "escape", c3: "mars", dest: "mars" }, isp: 320, propFrac: 0.5, power: 2_000, deployDelay: 2_700, icon: "◑", prefer: ["atlas", "falcon9"], blurb: "Relays the rovers' data home and maps the surface at 30 cm per pixel." },
  { id: "outer", name: "Jupiter / Europa probe", short: "Clipper-class", mass: 6_065, target: { kind: "escape", c3: 12, dest: "jupiter" }, isp: 320, propFrac: 0.45, power: 600, deployDelay: 3_300, icon: "◍", prefer: ["falconheavy", "starship"], blurb: "Mars–Earth gravity assists after launch; arrives at Jupiter five and a half years later." },
  { id: "rideshare", name: "Smallsat rideshare", short: "Cubesats", mass: 160, target: { kind: "orbit", hp: 525, ha: 525, inc: "sso" }, isp: 220, propFrac: 0.05, power: 200, deployDelay: 60, icon: "▪", prefer: ["electron"], blurb: "A handful of cubesats for universities and start-ups, dispensed from a kick stage." },
  { id: "custom", name: "Custom spacecraft", short: "Custom", mass: 3_000, target: { kind: "orbit", hp: 400, ha: 400, inc: "site" }, isp: 300, propFrac: 0.25, power: 3_000, deployDelay: 120, icon: "✚", prefer: ["falcon9"], blurb: "Your own mass and orbit. Flight dynamics will work out whether the rocket can get it there." },
];
export const payloadById = Object.fromEntries(PAYLOADS.map((p) => [p.id, p])) as Record<PayloadKind, Payload>;

// ———————————————————————————— ground networks ————————————————————————————

export type Station = { id: string; name: string; short: string; lat: number; lon: number; net: "DSN" | "NEN" | "TDRS"; dishes: string[] };
export const STATIONS: Station[] = [
  { id: "gds", name: "Goldstone Deep Space Communications Complex", short: "Goldstone", lat: 35.4267, lon: -116.89, net: "DSN", dishes: ["DSS-14 70m", "DSS-24 34m", "DSS-25 34m", "DSS-26 34m"] },
  { id: "mdscc", name: "Madrid Deep Space Communications Complex", short: "Madrid", lat: 40.4314, lon: -4.2481, net: "DSN", dishes: ["DSS-63 70m", "DSS-54 34m", "DSS-55 34m", "DSS-56 34m"] },
  { id: "cdscc", name: "Canberra Deep Space Communication Complex", short: "Canberra", lat: -35.4014, lon: 148.9817, net: "DSN", dishes: ["DSS-43 70m", "DSS-34 34m", "DSS-35 34m", "DSS-36 34m"] },
  { id: "wff", name: "Wallops Flight Facility", short: "Wallops", lat: 37.94, lon: -75.46, net: "NEN", dishes: ["WG1 11m"] },
  { id: "wsc", name: "White Sands Complex", short: "White Sands", lat: 32.5, lon: -106.61, net: "NEN", dishes: ["WS1 18m"] },
  { id: "sg", name: "Svalbard Satellite Station", short: "Svalbard", lat: 78.23, lon: 15.39, net: "NEN", dishes: ["SG1 11m", "SG2 13m"] },
  { id: "mcm", name: "McMurdo Ground Station", short: "McMurdo", lat: -77.84, lon: 166.67, net: "NEN", dishes: ["MG1 10m"] },
  { id: "hbk", name: "Hartebeesthoek", short: "Hartebeesthoek", lat: -25.89, lon: 27.69, net: "NEN", dishes: ["HBK 12m"] },
  { id: "sgp", name: "Singapore", short: "Singapore", lat: 1.4, lon: 103.98, net: "NEN", dishes: ["SG3 9m"] },
  { id: "kir", name: "Kiruna (Esrange)", short: "Kiruna", lat: 67.88, lon: 21.07, net: "NEN", dishes: ["KU1 13m"] },
  { id: "ags", name: "Santiago", short: "Santiago", lat: -33.15, lon: -70.67, net: "NEN", dishes: ["AGO 9m"] },
];

// ———————————————————————————— people on the floor ————————————————————————————

/** Flight control positions (Houston call signs) and who answers in the launch poll. */
export const POSITIONS = [
  { id: "FLIGHT", name: "Flight Director", poll: "Flight" },
  { id: "CAPCOM", name: "Capsule Communicator", poll: "" },
  { id: "FIDO", name: "Flight Dynamics Officer", poll: "Flight Dynamics" },
  { id: "GUIDO", name: "Guidance Officer", poll: "Guidance" },
  { id: "BOOSTER", name: "Booster Systems Engineer", poll: "Propulsion" },
  { id: "RETRO", name: "Retrofire Officer", poll: "" },
  { id: "EECOM", name: "Electrical, Environmental & Comms", poll: "Avionics" },
  { id: "GNC", name: "Guidance, Navigation & Control", poll: "GNC" },
  { id: "INCO", name: "Instrumentation & Comms", poll: "Communications" },
  { id: "PROP", name: "Propulsion Engineer", poll: "" },
  { id: "SURGEON", name: "Flight Surgeon", poll: "" },
  { id: "PAYLOADS", name: "Payload Officer", poll: "Payload" },
  { id: "GC", name: "Ground Controller", poll: "Ground Systems" },
  { id: "NETWORK", name: "Network Controller", poll: "Network" },
  { id: "RANGE", name: "Range Control Officer", poll: "Range" },
  { id: "WEATHER", name: "Launch Weather Officer", poll: "Weather" },
  { id: "RECOVERY", name: "Recovery Director", poll: "Recovery" },
  { id: "PAO", name: "Public Affairs Officer", poll: "" },
  { id: "SAFETY", name: "Safety Officer", poll: "Safety" },
  { id: "LD", name: "Launch Director", poll: "" },
] as const;
export type PositionId = (typeof POSITIONS)[number]["id"];

/** the countdown: seconds before launch, who calls it, what they say */
export const COUNT_EVENTS: { t: number; who: PositionId; text: string; tag?: "poll" | "prop" | "chill" | "internal" | "ignite" }[] = [
  { t: 2700, who: "LD", text: "Launch Director: terminal count is picking up. All stations, verify you are on the countdown net." },
  { t: 2400, who: "GC", text: "Ground: the transporter-erector is in launch position, umbilicals mated." },
  { t: 2280, who: "LD", text: "Stand by for the go, no-go poll for propellant load.", tag: "poll" },
  { t: 2100, who: "PROP", text: "Propulsion: first-stage fuel load is under way.", tag: "prop" },
  { t: 2040, who: "PROP", text: "First-stage liquid oxygen load is under way." },
  { t: 1500, who: "WEATHER", text: "Weather: observed conditions are within limits. We are monitoring the upper-level winds." },
  { t: 960, who: "PROP", text: "Second-stage liquid oxygen load is under way." },
  { t: 600, who: "RANGE", text: "Range: the range is green. Flight termination system is armed and enabled." },
  { t: 420, who: "BOOSTER", text: "Booster: engine chill-down has begun.", tag: "chill" },
  { t: 300, who: "GC", text: "Strongback retract complete." },
  { t: 180, who: "GUIDO", text: "Guidance: the flight computer has loaded the final trajectory. Target is loaded." },
  { t: 120, who: "LD", text: "Range verifies, all stations: go for launch.", tag: "poll" },
  { t: 60, who: "GUIDO", text: "T minus one minute. Flight computer commanded to begin final prelaunch checks.", tag: "internal" },
  { t: 55, who: "PROP", text: "Propellant tank pressurisation to flight pressure is under way." },
  { t: 45, who: "LD", text: "Launch Director: go for launch." },
  { t: 30, who: "PAO", text: "T minus thirty seconds." },
  { t: 10, who: "PAO", text: "Ten." },
  { t: 9, who: "PAO", text: "Nine." },
  { t: 8, who: "PAO", text: "Eight." },
  { t: 7, who: "PAO", text: "Seven." },
  { t: 6, who: "PAO", text: "Six." },
  { t: 5, who: "PAO", text: "Five." },
  { t: 4, who: "PAO", text: "Four." },
  { t: 3, who: "PAO", text: "Three. Engine ignition sequence start.", tag: "ignite" },
  { t: 2, who: "PAO", text: "Two." },
  { t: 1, who: "PAO", text: "One." },
];

// ———————————————————————————— what is already up there ————————————————————————————

export type CatalogSat = {
  id: string;
  name: string;
  kind: "station" | "science" | "nav" | "geo" | "eo" | "relay" | "constellation" | "deep";
  hp: number;
  ha: number;
  inc: number;
  /** geostationary longitude (deg east) */
  geoLon?: number;
  /** deep-space objects: right ascension, declination (deg) and distance (AU), or a planet id */
  deep?: { ra?: number; dec?: number; au?: number; planet?: string; where: string };
  mass: number;
  agency: string;
  launched: number;
};

export const CATALOG: CatalogSat[] = [
  { id: "iss", name: "ISS (Zarya)", kind: "station", hp: 414, ha: 420, inc: 51.64, mass: 420_000, agency: "NASA / Roscosmos / ESA / JAXA / CSA", launched: 1998 },
  { id: "css", name: "Tiangong", kind: "station", hp: 378, ha: 386, inc: 41.47, mass: 100_000, agency: "CMSA", launched: 2021 },
  { id: "hst", name: "Hubble Space Telescope", kind: "science", hp: 507, ha: 515, inc: 28.47, mass: 11_110, agency: "NASA / ESA", launched: 1990 },
  { id: "landsat9", name: "Landsat 9", kind: "eo", hp: 702, ha: 708, inc: 98.2, mass: 2_711, agency: "NASA / USGS", launched: 2021 },
  { id: "sentinel2b", name: "Sentinel-2B", kind: "eo", hp: 784, ha: 788, inc: 98.57, mass: 1_130, agency: "ESA", launched: 2017 },
  { id: "noaa20", name: "NOAA-20 (JPSS-1)", kind: "eo", hp: 822, ha: 826, inc: 98.7, mass: 2_294, agency: "NOAA / NASA", launched: 2017 },
  { id: "gps1", name: "GPS III SV06", kind: "nav", hp: 20_150, ha: 20_210, inc: 55, mass: 4_400, agency: "US Space Force", launched: 2023 },
  { id: "gps2", name: "GPS IIF-12", kind: "nav", hp: 20_140, ha: 20_220, inc: 55.6, mass: 1_630, agency: "US Space Force", launched: 2016 },
  { id: "galileo", name: "Galileo FOC-23", kind: "nav", hp: 23_200, ha: 23_240, inc: 56, mass: 715, agency: "ESA / EUSPA", launched: 2021 },
  { id: "goes16", name: "GOES-19 (East)", kind: "geo", hp: 35_780, ha: 35_792, inc: 0.05, geoLon: -75.2, mass: 5_192, agency: "NOAA", launched: 2024 },
  { id: "goes18", name: "GOES-18 (West)", kind: "geo", hp: 35_780, ha: 35_792, inc: 0.05, geoLon: -137.2, mass: 5_192, agency: "NOAA", launched: 2022 },
  { id: "tdrs12", name: "TDRS-12", kind: "relay", hp: 35_780, ha: 35_792, inc: 4, geoLon: -41, mass: 3_454, agency: "NASA SCaN", launched: 2014 },
  { id: "tdrs13", name: "TDRS-13", kind: "relay", hp: 35_780, ha: 35_792, inc: 3, geoLon: -171, mass: 3_454, agency: "NASA SCaN", launched: 2017 },
  { id: "tdrs11", name: "TDRS-11", kind: "relay", hp: 35_780, ha: 35_792, inc: 4, geoLon: 85, mass: 3_454, agency: "NASA SCaN", launched: 2013 },
  { id: "meteosat", name: "Meteosat-12 (MTG-I1)", kind: "geo", hp: 35_780, ha: 35_792, inc: 0.1, geoLon: 0, mass: 3_800, agency: "EUMETSAT", launched: 2022 },
  { id: "himawari", name: "Himawari-9", kind: "geo", hp: 35_780, ha: 35_792, inc: 0.05, geoLon: 140.7, mass: 3_500, agency: "JMA", launched: 2016 },
  { id: "jwst", name: "James Webb Space Telescope", kind: "deep", hp: 0, ha: 0, inc: 0, mass: 6_161, agency: "NASA / ESA / CSA", launched: 2021, deep: { where: "Sun–Earth L2 halo orbit", au: 0.0101 } },
  { id: "lro", name: "Lunar Reconnaissance Orbiter", kind: "deep", hp: 0, ha: 0, inc: 0, mass: 1_916, agency: "NASA", launched: 2009, deep: { where: "Lunar polar orbit", planet: "moon" } },
  { id: "mro", name: "Mars Reconnaissance Orbiter", kind: "deep", hp: 0, ha: 0, inc: 0, mass: 2_180, agency: "NASA", launched: 2005, deep: { where: "Mars orbit", planet: "mars" } },
  { id: "perseverance", name: "Perseverance rover", kind: "deep", hp: 0, ha: 0, inc: 0, mass: 1_025, agency: "NASA / JPL", launched: 2020, deep: { where: "Jezero crater, Mars", planet: "mars" } },
  { id: "juno", name: "Juno", kind: "deep", hp: 0, ha: 0, inc: 0, mass: 3_625, agency: "NASA", launched: 2011, deep: { where: "Jupiter polar orbit", planet: "jupiter" } },
  { id: "newhorizons", name: "New Horizons", kind: "deep", hp: 0, ha: 0, inc: 0, mass: 478, agency: "NASA / APL", launched: 2006, deep: { where: "Kuiper belt", ra: 290.5, dec: -20.4, au: 62 } },
  { id: "voyager1", name: "Voyager 1", kind: "deep", hp: 0, ha: 0, inc: 0, mass: 722, agency: "NASA / JPL", launched: 1977, deep: { where: "Interstellar space", ra: 258.6, dec: 12.0, au: 170 } },
  { id: "voyager2", name: "Voyager 2", kind: "deep", hp: 0, ha: 0, inc: 0, mass: 722, agency: "NASA / JPL", launched: 1977, deep: { where: "Interstellar space", ra: 302.1, dec: -59.4, au: 142 } },
];
