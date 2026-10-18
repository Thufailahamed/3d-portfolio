/**
 * Every world the rover can be sent to, with its real physical constants.
 * Gravity, density, pressure, temperature, sound speed and light-time come from NASA fact sheets;
 * the terrain recipes and colours are tuned to orbiter and lander imagery of each surface.
 */

export type WorldId = "mercury" | "venus" | "earth" | "moon" | "mars" | "jupiter" | "saturn" | "titan" | "uranus" | "neptune" | "pluto";

export type Crater = { cell: number; density: number; depth: number; rim: number };

export type TerrainRecipe = {
  seed: number;
  /** rolling ground: fbm amplitude (m) and wavelength (m) */
  base: [number, number];
  /** ridged hills, kept away from the landing zone */
  hills: [number, number];
  /** small bumps the wheels feel */
  detail: [number, number];
  /** dune fields: amplitude, wavelength, crest heading (rad), coverage 0..1 */
  dunes?: [number, number, number, number];
  craters?: Crater[];
  /** polygonal troughs (Pluto's convection cells, Venus' cracked plates): depth, cell size */
  cells?: [number, number];
  /** terraced lava plates: step height */
  terrace?: number;
  /** one distant landmark: x, z, radius, height */
  landmark?: [number, number, number, number];
};

export type Rocks = { cell: number; density: number; minR: number; maxR: number; power: number; flat: number; pebbles: number };

export type PlanetLook = {
  kind: "rocky" | "cratered" | "banded" | "earth" | "cloudy" | "icy" | "haze";
  c1: string;
  c2: string;
  c3: string;
  /** atmosphere rim colour and strength */
  rim: string;
  rimK: number;
  rings?: boolean;
  spot?: string;
};

export type SkyBody = { name: string; angDeg: number; az: number; el: number; look: PlanetLook; seed: number };

export type World = {
  id: WorldId;
  name: string;
  kind: "Planet" | "Moon" | "Dwarf planet";
  parent?: string;
  site: string;
  /** semi-major axis of the orbit around the Sun (AU) */
  au: number;
  radiusKm: number;
  /** surface gravity (m/s²) */
  g: number;
  dayLength: string;
  atm: {
    pressureBar: number;
    /** kg/m³ at the surface (or at the 1 bar level for the giants) */
    rho: number;
    tempC: number;
    tempRange: string;
    composition: string;
    /** m/s, 0 where there is no air to carry it */
    sound: number;
    wind: number;
    gust: number;
  };
  surface: "terrain" | "deck";
  soil: {
    name: string;
    mu: number;
    crr: number;
    dust: number;
    /** how fast thrown dust is slowed by the air (1/s) — 0 in vacuum, where it flies in clean parabolas */
    dustDrag: number;
    dustColor: string;
    track: number;
  };
  terrain: TerrainRecipe;
  rocks: Rocks;
  palette: { low: string; high: string; slope: string; dune: string; bright: string; rock: string };
  sky: {
    zenith: string;
    horizon: string;
    ground: string;
    fog: string;
    fogDensity: number;
    sun: string;
    sunIntensity: number;
    sunElev: number;
    sunAz: number;
    sunDisk: boolean;
    halo: string;
    haloK: number;
    stars: number;
    hemiSky: string;
    hemiGround: string;
    hemiK: number;
    exposure: number;
  };
  bodies: SkyBody[];
  edl: { plasma: boolean; chute: boolean; entryKms: number; note: string };
  sample: { title: string; items: [string, number][]; note: string };
  facts: string[];
  look: PlanetLook;
};

const SUN_DIAM_1AU = 0.533;
export const sunAngDeg = (w: World) => SUN_DIAM_1AU / w.au;
export const solarFlux = (w: World) => 1361 / (w.au * w.au);
/** one-way light time to Earth, closest and farthest (minutes) */
export function commDelay(w: World): [number, number] {
  if (w.id === "earth") return [0, 0];
  if (w.id === "moon") return [1.28 / 60, 1.28 / 60];
  const LM = 8.317;
  return [Math.abs(w.au - 1) * LM, (w.au + 1) * LM];
}
/** Hohmann transfer time between two heliocentric orbits (days) */
export function hohmannDays(a1: number, a2: number) {
  if (Math.abs(a1 - a2) < 0.01) return 3;
  const a = (a1 + a2) / 2;
  return 0.5 * Math.pow(a, 1.5) * 365.25;
}

/** Δv for a heliocentric Hohmann transfer between circular orbits (km/s) */
export function hohmannDv(a1: number, a2: number) {
  if (Math.abs(a1 - a2) < 0.01) return 3.1;
  const vc = (r: number) => 29.78 / Math.sqrt(r);
  const a = (a1 + a2) / 2;
  return Math.abs(vc(a1) * (Math.sqrt(a2 / a) - 1)) + Math.abs(vc(a2) * (1 - Math.sqrt(a1 / a)));
}

const MOON_LOOK: PlanetLook = { kind: "cratered", c1: "#8d8b88", c2: "#5d5c5a", c3: "#b4b2ae", rim: "#000000", rimK: 0 };
const EARTH_LOOK: PlanetLook = { kind: "earth", c1: "#1d4f91", c2: "#5b7b3a", c3: "#ffffff", rim: "#6fb4ff", rimK: 1 };

export const WORLDS: World[] = [
  {
    id: "mercury",
    name: "Mercury",
    kind: "Planet",
    site: "Caloris rim, near the dawn terminator",
    au: 0.387,
    radiusKm: 2439.7,
    g: 3.7,
    dayLength: "176 Earth days (solar day)",
    atm: { pressureBar: 0, rho: 0, tempC: 167, tempRange: "−173 °C night · +427 °C noon", composition: "Exosphere only (O, Na, H, He, K)", sound: 0, wind: 0, gust: 0 },
    surface: "terrain",
    soil: { name: "Space-weathered regolith", mu: 0.65, crr: 0.11, dust: 0.9, dustDrag: 0, dustColor: "#7d746b", track: 0.75 },
    terrain: {
      seed: 11,
      base: [9, 520],
      hills: [140, 2600],
      detail: [0.12, 3.2],
      craters: [
        { cell: 380, density: 0.55, depth: 0.32, rim: 0.3 },
        { cell: 70, density: 0.5, depth: 0.36, rim: 0.28 },
        { cell: 16, density: 0.45, depth: 0.32, rim: 0.22 },
      ],
      landmark: [-7000, -11000, 5200, 1300],
    },
    rocks: { cell: 2.6, density: 0.32, minR: 0.1, maxR: 1.1, power: 3, flat: 0.62, pebbles: 0.7 },
    palette: { low: "#5f5850", high: "#827a70", slope: "#4a443e", dune: "#5c554d", bright: "#a59d92", rock: "#6c655d" },
    sky: { zenith: "#000000", horizon: "#000000", ground: "#2a2622", fog: "#000000", fogDensity: 0, sun: "#fff8ee", sunIntensity: 5.4, sunElev: 14, sunAz: 120, sunDisk: true, halo: "#fff3df", haloK: 0.12, stars: 0.5, hemiSky: "#1c1c22", hemiGround: "#4a443e", hemiK: 0.12, exposure: 0.92 },
    bodies: [],
    edl: { plasma: false, chute: false, entryKms: 4.25, note: "No atmosphere: braked from orbit entirely on rocket power, like MESSENGER's final orbits." },
    sample: {
      title: "Regolith — low-iron, graphite-darkened silicates",
      items: [["SiO₂", 43], ["MgO", 25], ["Al₂O₃", 11], ["CaO", 7], ["Sulfur", 4], ["Graphite (C)", 3], ["FeO", 2], ["Other", 5]],
      note: "MESSENGER found unusually high sulfur and a dark graphite-rich crust; iron is scarce.",
    },
    facts: ["The Sun looks 2.6× wider than from Earth and delivers 6.7× the energy.", "A solar day lasts 176 Earth days.", "Temperature swings ~600 °C between noon and midnight."],
    look: { kind: "cratered", c1: "#8b8178", c2: "#5c554e", c3: "#b0a79c", rim: "#000000", rimK: 0 },
  },
  {
    id: "venus",
    name: "Venus",
    kind: "Planet",
    site: "Navka plains, near the Venera 13 site",
    au: 0.723,
    radiusKm: 6051.8,
    g: 8.87,
    dayLength: "117 Earth days (solar day)",
    atm: { pressureBar: 92, rho: 65, tempC: 464, tempRange: "+464 °C, day and night", composition: "96.5% CO₂, 3.5% N₂, sulfuric-acid clouds", sound: 410, wind: 0.6, gust: 1.2 },
    surface: "terrain",
    soil: { name: "Basaltic plates and fine soil", mu: 0.7, crr: 0.05, dust: 0.35, dustDrag: 9, dustColor: "#6b4a2a", track: 0.35 },
    terrain: { seed: 23, base: [6, 700], hills: [180, 3400], detail: [0.06, 2.6], terrace: 0.32, cells: [0.12, 5.5], landmark: [9000, -13000, 6000, 900] },
    rocks: { cell: 3.2, density: 0.18, minR: 0.12, maxR: 0.9, power: 3, flat: 0.32, pebbles: 0.35 },
    palette: { low: "#4b3a2c", high: "#5e4936", slope: "#3a2c22", dune: "#4f3c2c", bright: "#73583e", rock: "#41332a" },
    sky: { zenith: "#3f2408", horizon: "#c27a2c", ground: "#5a3a1c", fog: "#a8662a", fogDensity: 0.00055, sun: "#ffbe73", sunIntensity: 0.9, sunElev: 48, sunAz: 200, sunDisk: false, halo: "#ffb060", haloK: 0.6, stars: 0, hemiSky: "#d8893a", hemiGround: "#4a3220", hemiK: 1.15, exposure: 1.15 },
    bodies: [],
    edl: { plasma: true, chute: true, entryKms: 11, note: "The air is 65× denser than Earth's: after the parachute, a lander falls at only ~7 m/s, like sinking through water." },
    sample: {
      title: "Basalt — similar to Earth's oceanic crust",
      items: [["SiO₂", 46], ["Al₂O₃", 16], ["FeO", 9], ["MgO", 11], ["CaO", 7], ["K₂O", 4], ["TiO₂", 1.6], ["Other", 5.4]],
      note: "Venera 13 and 14 X-ray fluorescence found tholeiitic and alkaline basalts.",
    },
    facts: ["Surface pressure equals being 900 m under the ocean.", "Venera 13 survived 127 minutes on the surface.", "The Sun is never seen — only a diffuse orange glow through 50 km of cloud."],
    look: { kind: "cloudy", c1: "#e8c98a", c2: "#c9a160", c3: "#f5e2b8", rim: "#ffe7b0", rimK: 0.8 },
  },
  {
    id: "earth",
    name: "Earth",
    kind: "Planet",
    site: "Atacama Desert, Chile (rover test site)",
    au: 1,
    radiusKm: 6371,
    g: 9.81,
    dayLength: "24 hours",
    atm: { pressureBar: 0.77, rho: 0.96, tempC: 18, tempRange: "−2 °C night · +32 °C day", composition: "78% N₂, 21% O₂, 1% Ar", sound: 343, wind: 4, gust: 9 },
    surface: "terrain",
    soil: { name: "Salt-crusted desert gravel", mu: 0.72, crr: 0.06, dust: 0.55, dustDrag: 2.4, dustColor: "#b8916a", track: 0.55 },
    terrain: {
      seed: 31,
      base: [12, 640],
      hills: [260, 3000],
      detail: [0.1, 3.6],
      craters: [{ cell: 40, density: 0.04, depth: 0.12, rim: 0.2 }],
      landmark: [-12000, -16000, 5600, 2400],
    },
    rocks: { cell: 3, density: 0.26, minR: 0.1, maxR: 0.85, power: 3, flat: 0.55, pebbles: 0.8 },
    palette: { low: "#9b7151", high: "#b98f6a", slope: "#7a5741", dune: "#a77d58", bright: "#d5c2a8", rock: "#6b5141" },
    sky: { zenith: "#2a64c8", horizon: "#b4cfe9", ground: "#7a6552", fog: "#a9c4df", fogDensity: 0.000035, sun: "#fff3e0", sunIntensity: 3.4, sunElev: 34, sunAz: 140, sunDisk: true, halo: "#ffffff", haloK: 0.35, stars: 0, hemiSky: "#8fb6e8", hemiGround: "#8a6a4e", hemiK: 0.65, exposure: 1 },
    bodies: [{ name: "Moon", angDeg: 0.52, az: 250, el: 38, look: MOON_LOOK, seed: 3 }],
    edl: { plasma: true, chute: true, entryKms: 11, note: "Thick air does most of the braking: a capsule slows from 11 km/s to ~16 m/s under its parachute." },
    sample: {
      title: "Desert soil — salts, nitrates and gypsum",
      items: [["SiO₂", 58], ["Al₂O₃", 14], ["CaSO₄ (gypsum)", 8], ["NaCl / nitrates", 6], ["FeO", 5], ["Other", 9]],
      note: "The Atacama is so dry that its soils fooled Viking-style life experiments — which is why rovers are tested here.",
    },
    facts: ["The driest non-polar desert on Earth, used to test Mars rovers.", "The only world where the rover's lungs-free microphone would hear everything clearly."],
    look: EARTH_LOOK,
  },
  {
    id: "moon",
    name: "The Moon",
    kind: "Moon",
    parent: "Earth",
    site: "Mare Imbrium, south of Sinus Iridum",
    au: 1,
    radiusKm: 1737.4,
    g: 1.62,
    dayLength: "29.5 Earth days",
    atm: { pressureBar: 0, rho: 0, tempC: 95, tempRange: "−130 °C night · +120 °C day", composition: "None (exosphere)", sound: 0, wind: 0, gust: 0 },
    surface: "terrain",
    soil: { name: "Regolith, fine and cohesive", mu: 0.62, crr: 0.12, dust: 1, dustDrag: 0, dustColor: "#8f8d89", track: 0.85 },
    terrain: {
      seed: 47,
      base: [6, 480],
      hills: [120, 2600],
      detail: [0.1, 3],
      craters: [
        { cell: 420, density: 0.5, depth: 0.3, rim: 0.32 },
        { cell: 85, density: 0.55, depth: 0.34, rim: 0.3 },
        { cell: 18, density: 0.5, depth: 0.32, rim: 0.24 },
      ],
      landmark: [8000, -12000, 6200, 1600],
    },
    rocks: { cell: 2.8, density: 0.28, minR: 0.1, maxR: 1.0, power: 3.2, flat: 0.6, pebbles: 0.6 },
    palette: { low: "#6e6d6b", high: "#8c8b88", slope: "#55544f", dune: "#6a6966", bright: "#b1b0ac", rock: "#6b6a67" },
    sky: { zenith: "#000000", horizon: "#000000", ground: "#2b2b2a", fog: "#000000", fogDensity: 0, sun: "#fffaf2", sunIntensity: 3.9, sunElev: 20, sunAz: 110, sunDisk: true, halo: "#ffffff", haloK: 0.1, stars: 0.45, hemiSky: "#1d1f26", hemiGround: "#4a4947", hemiK: 0.12, exposure: 1 },
    bodies: [{ name: "Earth", angDeg: 1.9, az: 200, el: 42, look: EARTH_LOOK, seed: 5 }],
    edl: { plasma: false, chute: false, entryKms: 1.7, note: "No air: the descent stage cancels all 1.7 km/s of orbital speed with its engines, as Apollo did." },
    sample: {
      title: "Mare regolith — basalt and impact glass",
      items: [["SiO₂", 42], ["FeO", 17], ["CaO", 11], ["Al₂O₃", 12], ["MgO", 9], ["TiO₂", 4], ["Glass beads", 3], ["Other", 2]],
      note: "Apollo 15 brought back similar mare basalt; the dust is sharp, glassy and clings to everything.",
    },
    facts: ["At 1/6 g the Apollo rover bounced with all four wheels off the ground.", "Thrown dust flies in perfect parabolas — there's no air to hold it up.", "The horizon is only 2.4 km away for a standing astronaut."],
    look: MOON_LOOK,
  },
  {
    id: "mars",
    name: "Mars",
    kind: "Planet",
    site: "Gale crater, below Aeolis Mons",
    au: 1.524,
    radiusKm: 3389.5,
    g: 3.721,
    dayLength: "24 h 39 min (sol)",
    atm: { pressureBar: 0.0061, rho: 0.02, tempC: -55, tempRange: "−90 °C night · +5 °C day", composition: "95% CO₂, 2.8% N₂, 2% Ar", sound: 240, wind: 6, gust: 18 },
    surface: "terrain",
    soil: { name: "Basaltic sand over bedrock", mu: 0.58, crr: 0.1, dust: 0.8, dustDrag: 0.45, dustColor: "#b06c3e", track: 0.75 },
    terrain: {
      seed: 59,
      base: [10, 560],
      hills: [200, 2800],
      detail: [0.1, 3.2],
      dunes: [1.3, 26, 0.6, 0.45],
      craters: [
        { cell: 520, density: 0.3, depth: 0.22, rim: 0.25 },
        { cell: 90, density: 0.32, depth: 0.25, rim: 0.24 },
        { cell: 22, density: 0.22, depth: 0.2, rim: 0.2 },
      ],
      landmark: [-6000, -9000, 5200, 2600],
    },
    rocks: { cell: 2.4, density: 0.38, minR: 0.1, maxR: 1.0, power: 2.8, flat: 0.55, pebbles: 1 },
    palette: { low: "#8a4a2c", high: "#a8633a", slope: "#6a4230", dune: "#4d3428", bright: "#c48552", rock: "#6e5242" },
    sky: { zenith: "#a77a55", horizon: "#e1b88c", ground: "#7a4a30", fog: "#d7a77a", fogDensity: 0.00006, sun: "#fff0dc", sunIntensity: 2.6, sunElev: 26, sunAz: 150, sunDisk: true, halo: "#9cc0dc", haloK: 0.55, stars: 0, hemiSky: "#d9a577", hemiGround: "#7a4a30", hemiK: 0.55, exposure: 1.05 },
    bodies: [
      { name: "Phobos", angDeg: 0.2, az: 70, el: 24, look: { kind: "cratered", c1: "#5a4c42", c2: "#3e352e", c3: "#71635a", rim: "#000", rimK: 0 }, seed: 9 },
      { name: "Deimos", angDeg: 0.05, az: 300, el: 52, look: { kind: "cratered", c1: "#6a5a4c", c2: "#4a3e34", c3: "#7a6a5a", rim: "#000", rimK: 0 }, seed: 13 },
    ],
    edl: { plasma: true, chute: true, entryKms: 5.8, note: "The air is too thin to land on a parachute alone, so a rocket-powered sky crane lowers the rover the last 20 m." },
    sample: {
      title: "Basaltic soil with perchlorate salts",
      items: [["SiO₂", 43], ["FeO (rust)", 19], ["Al₂O₃", 9], ["MgO", 8], ["CaO", 7], ["SO₃", 6], ["Perchlorates", 1], ["Other", 7]],
      note: "Curiosity's CheMin found olivine, pyroxene and feldspar — and clays that formed in ancient lake water.",
    },
    facts: ["Sunsets are blue: fine dust scatters blue light forward around the Sun.", "Sound travels at 240 m/s and high pitches die out within metres.", "Phobos crosses the sky west-to-east twice a day."],
    look: { kind: "rocky", c1: "#b5603a", c2: "#6b3a26", c3: "#e6d8cf", rim: "#e3a27a", rimK: 0.35 },
  },
  {
    id: "jupiter",
    name: "Jupiter",
    kind: "Planet",
    site: "Floating deck at the 1-bar level, North Equatorial Belt",
    au: 5.203,
    radiusKm: 69911,
    g: 24.79,
    dayLength: "9 h 56 min",
    atm: { pressureBar: 1, rho: 0.16, tempC: -108, tempRange: "−108 °C at 1 bar, +700 °C 300 km deeper", composition: "90% H₂, 10% He, ammonia clouds", sound: 1170, wind: 12, gust: 30 },
    surface: "deck",
    soil: { name: "Aerostat deck plating", mu: 0.85, crr: 0.02, dust: 0, dustDrag: 3, dustColor: "#cbb89a", track: 0 },
    terrain: { seed: 71, base: [0, 1], hills: [0, 1], detail: [0, 1] },
    rocks: { cell: 1, density: 0, minR: 0, maxR: 0, power: 1, flat: 0, pebbles: 0 },
    palette: { low: "#d9c4a0", high: "#e8d8b8", slope: "#a88a62", dune: "#c8a87a", bright: "#f1e6cf", rock: "#b08a5e" },
    sky: { zenith: "#5c7193", horizon: "#d9c39b", ground: "#8a6a48", fog: "#cbb08a", fogDensity: 0.0011, sun: "#fff3df", sunIntensity: 1.6, sunElev: 38, sunAz: 160, sunDisk: true, halo: "#fff1d8", haloK: 0.45, stars: 0, hemiSky: "#bcae96", hemiGround: "#8a6a48", hemiK: 0.85, exposure: 1.2 },
    bodies: [],
    edl: { plasma: true, chute: true, entryKms: 47.4, note: "There is no surface. Galileo's probe hit the atmosphere at 47 km/s — the fastest entry ever — and was crushed 150 km down." },
    sample: {
      title: "Atmosphere at 1 bar (gas sampler)",
      items: [["H₂", 86.2], ["He", 13.6], ["CH₄", 0.18], ["NH₃", 0.026], ["H₂O", 0.002], ["Other", 0.0]],
      note: "Matches the Galileo probe's mass spectrometer. Gravity here is 2.5 g — the rover's springs bottom out.",
    },
    facts: ["Gravity at the cloud tops is 2.53 g: the rover weighs 2.2 tonnes-force.", "Zonal winds blow at 150 m/s; the deck drifts with them.", "Drive off the edge and you fall into an ocean of hydrogen with no floor."],
    look: { kind: "banded", c1: "#d8c19a", c2: "#a0704a", c3: "#f1e7d4", rim: "#d8d0c0", rimK: 0.4, spot: "#b5502e" },
  },
  {
    id: "saturn",
    name: "Saturn",
    kind: "Planet",
    site: "Floating deck at the 1-bar level, beneath the rings",
    au: 9.537,
    radiusKm: 58232,
    g: 10.44,
    dayLength: "10 h 33 min",
    atm: { pressureBar: 1, rho: 0.19, tempC: -139, tempRange: "−139 °C at 1 bar", composition: "96% H₂, 3% He, ammonia haze", sound: 870, wind: 15, gust: 35 },
    surface: "deck",
    soil: { name: "Aerostat deck plating", mu: 0.85, crr: 0.02, dust: 0, dustDrag: 3, dustColor: "#d8c79b", track: 0 },
    terrain: { seed: 83, base: [0, 1], hills: [0, 1], detail: [0, 1] },
    rocks: { cell: 1, density: 0, minR: 0, maxR: 0, power: 1, flat: 0, pebbles: 0 },
    palette: { low: "#e4d3a6", high: "#f0e2bd", slope: "#bba77a", dune: "#d8c08a", bright: "#f7efd8", rock: "#c4a874" },
    sky: { zenith: "#7a8aa6", horizon: "#e8d6a6", ground: "#a08a5c", fog: "#dcc896", fogDensity: 0.0009, sun: "#fff6e6", sunIntensity: 1.3, sunElev: 30, sunAz: 120, sunDisk: true, halo: "#fff5dc", haloK: 0.4, stars: 0, hemiSky: "#d4c8a8", hemiGround: "#a08a5c", hemiK: 0.85, exposure: 1.25 },
    bodies: [],
    edl: { plasma: true, chute: true, entryKms: 36, note: "Saturn's equatorial jet blows at 500 m/s. The deck floats with it; what you feel is turbulence." },
    sample: {
      title: "Atmosphere at 1 bar (gas sampler)",
      items: [["H₂", 96.3], ["He", 3.25], ["CH₄", 0.45], ["NH₃", 0.0125], ["Other", 0]],
      note: "Saturn's helium has partly rained out toward its core, which is why it shows less than Jupiter.",
    },
    facts: ["The rings arch across the sky from horizon to horizon.", "Saturn is less dense than water.", "Gravity at 1 bar is about Earth's: 1.06 g."],
    look: { kind: "banded", c1: "#e6d4a2", c2: "#b89a62", c3: "#f5ebcf", rim: "#efe3c0", rimK: 0.4, rings: true },
  },
  {
    id: "titan",
    name: "Titan",
    kind: "Moon",
    parent: "Saturn",
    site: "Adiri dune plain, the Huygens landing site",
    au: 9.537,
    radiusKm: 2574.7,
    g: 1.352,
    dayLength: "15.9 Earth days",
    atm: { pressureBar: 1.47, rho: 5.4, tempC: -179, tempRange: "−179 °C, almost constant", composition: "95% N₂, 5% CH₄, orange organic haze", sound: 194, wind: 0.5, gust: 1.2 },
    surface: "terrain",
    soil: { name: "Damp organic sand and water-ice cobbles", mu: 0.55, crr: 0.12, dust: 0.45, dustDrag: 5, dustColor: "#5a4228", track: 0.6 },
    terrain: { seed: 97, base: [7, 600], hills: [140, 2600], detail: [0.08, 3], dunes: [3.2, 120, 1.4, 0.55], landmark: [-9000, 9000, 6000, 900] },
    rocks: { cell: 1.8, density: 0.4, minR: 0.06, maxR: 0.45, power: 2.4, flat: 0.6, pebbles: 1 },
    palette: { low: "#55402a", high: "#6a5034", slope: "#46351f", dune: "#3e2f20", bright: "#8a7356", rock: "#bfae94" },
    sky: { zenith: "#5c3a12", horizon: "#c4893a", ground: "#5a3c1c", fog: "#a8702e", fogDensity: 0.0007, sun: "#ffc27a", sunIntensity: 0.65, sunElev: 40, sunAz: 130, sunDisk: false, halo: "#ffb35a", haloK: 0.5, stars: 0, hemiSky: "#c4893a", hemiGround: "#4a3420", hemiK: 1.05, exposure: 1.35 },
    bodies: [],
    edl: { plasma: true, chute: true, entryKms: 6, note: "Thick air and weak gravity: Huygens drifted down under its parachute for 2 h 27 min." },
    sample: {
      title: "Organic sand over water-ice bedrock",
      items: [["H₂O ice", 45], ["Tholins (organics)", 30], ["CH₄ (liquid)", 10], ["C₂H₆", 6], ["Benzene & nitriles", 5], ["Other", 4]],
      note: "Huygens' probe warmed the ground on contact and released methane — the soil is damp with it.",
    },
    facts: ["Air 4.5× denser than Earth's and 1/7 g: a human could fly with strapped-on wings.", "Rocks here are water ice, hard as granite at −179 °C.", "Saturn is permanently hidden by the orange haze."],
    look: { kind: "haze", c1: "#d9a54e", c2: "#b07a2e", c3: "#ecc77d", rim: "#d8b06a", rimK: 1 },
  },
  {
    id: "uranus",
    name: "Uranus",
    kind: "Planet",
    site: "Floating deck at the 1-bar level, methane haze",
    au: 19.19,
    radiusKm: 25362,
    g: 8.69,
    dayLength: "17 h 14 min",
    atm: { pressureBar: 1, rho: 0.42, tempC: -197, tempRange: "−197 °C at 1 bar", composition: "83% H₂, 15% He, 2.3% CH₄", sound: 580, wind: 14, gust: 30 },
    surface: "deck",
    soil: { name: "Aerostat deck plating", mu: 0.85, crr: 0.02, dust: 0, dustDrag: 3, dustColor: "#bfe3e6", track: 0 },
    terrain: { seed: 103, base: [0, 1], hills: [0, 1], detail: [0, 1] },
    rocks: { cell: 1, density: 0, minR: 0, maxR: 0, power: 1, flat: 0, pebbles: 0 },
    palette: { low: "#a8dade", high: "#c6eaec", slope: "#7fb8bf", dune: "#9fd0d4", bright: "#e1f6f6", rock: "#8ac0c6" },
    sky: { zenith: "#3f7f95", horizon: "#b4e2e4", ground: "#4f8f99", fog: "#9ed4d8", fogDensity: 0.0013, sun: "#f6fbff", sunIntensity: 0.9, sunElev: 52, sunAz: 80, sunDisk: true, halo: "#e9fbff", haloK: 0.4, stars: 0, hemiSky: "#a6d8dc", hemiGround: "#4f8f99", hemiK: 1, exposure: 1.4 },
    bodies: [],
    edl: { plasma: true, chute: true, entryKms: 22, note: "Uranus is tipped on its side: each pole gets 42 years of daylight, then 42 of night." },
    sample: {
      title: "Atmosphere at 1 bar (gas sampler)",
      items: [["H₂", 82.5], ["He", 15.2], ["CH₄", 2.3], ["Other", 0]],
      note: "Methane absorbs red light, which is what tints the sky cyan.",
    },
    facts: ["Axial tilt of 98°.", "The coldest planetary atmosphere measured: −224 °C at the tropopause.", "Sunlight is 1/370 of Earth's."],
    look: { kind: "banded", c1: "#b6e3e6", c2: "#8fcbd2", c3: "#d6f2f3", rim: "#d8ffff", rimK: 0.6 },
  },
  {
    id: "neptune",
    name: "Neptune",
    kind: "Planet",
    site: "Floating deck at the 1-bar level, near a dark vortex",
    au: 30.07,
    radiusKm: 24622,
    g: 11.15,
    dayLength: "16 h 6 min",
    atm: { pressureBar: 1, rho: 0.45, tempC: -201, tempRange: "−201 °C at 1 bar", composition: "80% H₂, 19% He, 1.5% CH₄", sound: 560, wind: 18, gust: 40 },
    surface: "deck",
    soil: { name: "Aerostat deck plating", mu: 0.85, crr: 0.02, dust: 0, dustDrag: 3, dustColor: "#a4c4f0", track: 0 },
    terrain: { seed: 109, base: [0, 1], hills: [0, 1], detail: [0, 1] },
    rocks: { cell: 1, density: 0, minR: 0, maxR: 0, power: 1, flat: 0, pebbles: 0 },
    palette: { low: "#5a7fc8", high: "#7c9ee0", slope: "#3f5fa0", dune: "#5272b8", bright: "#b5cbf3", rock: "#4b6bb0" },
    sky: { zenith: "#14306e", horizon: "#4f86d4", ground: "#20406f", fog: "#3d6fbf", fogDensity: 0.0013, sun: "#f2f6ff", sunIntensity: 0.8, sunElev: 44, sunAz: 210, sunDisk: true, halo: "#d8e6ff", haloK: 0.4, stars: 0, hemiSky: "#5b8ad8", hemiGround: "#20406f", hemiK: 1.1, exposure: 1.5 },
    bodies: [],
    edl: { plasma: true, chute: true, entryKms: 24, note: "The fastest winds in the Solar System — 2,100 km/h — powered by a sunlight 900× fainter than Earth's." },
    sample: {
      title: "Atmosphere at 1 bar (gas sampler)",
      items: [["H₂", 80], ["He", 19], ["CH₄", 1.5], ["Other", 0]],
      note: "An unknown extra absorber makes Neptune bluer than Uranus despite similar methane.",
    },
    facts: ["Winds reach 600 m/s.", "A year lasts 165 Earth years.", "Sunlight here is about as bright as a heavily overcast day on Earth."],
    look: { kind: "banded", c1: "#3f6fd8", c2: "#2a4fa8", c3: "#8fb2f0", rim: "#9ec0ff", rimK: 0.7, spot: "#16306a" },
  },
  {
    id: "pluto",
    name: "Pluto",
    kind: "Dwarf planet",
    site: "Sputnik Planitia, the nitrogen-ice heart",
    au: 39.48,
    radiusKm: 1188.3,
    g: 0.62,
    dayLength: "6.4 Earth days",
    atm: { pressureBar: 0.00001, rho: 0.00008, tempC: -229, tempRange: "−240 to −218 °C", composition: "Thin N₂ with CH₄, CO and blue haze layers", sound: 0, wind: 0, gust: 0 },
    surface: "terrain",
    soil: { name: "Nitrogen ice with tholin dust", mu: 0.32, crr: 0.03, dust: 0.4, dustDrag: 0, dustColor: "#d8c6ae", track: 0.4 },
    terrain: { seed: 113, base: [3, 700], hills: [220, 2600], detail: [0.07, 3.4], cells: [5, 380], landmark: [-10000, -6000, 5000, 2600], craters: [{ cell: 30, density: 0.08, depth: 0.28, rim: 0 }] },
    rocks: { cell: 4.5, density: 0.08, minR: 0.12, maxR: 1.1, power: 2.4, flat: 0.75, pebbles: 0.25 },
    palette: { low: "#d9cbb8", high: "#ece2d2", slope: "#a88a6e", dune: "#c8b296", bright: "#f6f1e8", rock: "#b49478" },
    sky: { zenith: "#000000", horizon: "#0b1424", ground: "#2a2522", fog: "#0c1626", fogDensity: 0.000012, sun: "#f8f2e6", sunIntensity: 1.25, sunElev: 18, sunAz: 100, sunDisk: true, halo: "#ffffff", haloK: 0.06, stars: 0.8, hemiSky: "#1a2238", hemiGround: "#6a5a4c", hemiK: 0.28, exposure: 1.6 },
    bodies: [{ name: "Charon", angDeg: 3.6, az: 220, el: 34, look: { kind: "icy", c1: "#9a9690", c2: "#6a6460", c3: "#5a3a2a", rim: "#000", rimK: 0 }, seed: 17 }],
    edl: { plasma: false, chute: false, entryKms: 1.2, note: "Too thin to slow anything: a rocket descent the whole way, 4.5 light-hours from home." },
    sample: {
      title: "Volatile ices tinted by tholins",
      items: [["N₂ ice", 97], ["CH₄ ice", 1.5], ["CO ice", 0.5], ["Tholins", 1]],
      note: "New Horizons found Sputnik Planitia slowly churning: the polygons are convection cells in a sheet of nitrogen ice.",
    },
    facts: ["Charon hangs motionless in the sky, 7× wider than our Moon.", "Gravity is 1/16 g — the rover can jump its own length.", "Noon is ~1,000× dimmer than on Earth, still brighter than a full moon."],
    look: { kind: "icy", c1: "#e8d7bd", c2: "#9a6a48", c3: "#f6efe3", rim: "#8fb6ff", rimK: 0.25 },
  },
];

export const worldById = Object.fromEntries(WORLDS.map((w) => [w.id, w])) as Record<WorldId, World>;
export const EARTH_G = 9.80665;
