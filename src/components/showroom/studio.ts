/**
 * The showroom's studio: lighting moods, the camera's preset views and the cinematic sequence.
 * Plain data, shared by the scene (which renders it) and the HUD (which offers it).
 */

export type MoodId = "studio" | "noir" | "golden" | "neon";

export type Mood = {
  id: MoodId;
  name: string;
  /** CSS background for the picker's swatch */
  swatch: string;
  bg: string;
  cove: string;
  floor: string;
  /** light bars round the cove alternate between these two colours */
  strips: [string, string];
  /** brightness of the visible light bars (HDR, so they bloom) */
  stripLevel: number;
  ceiling: string;
  ceilingLevel: number;
  key: { color: string; intensity: number };
  /** back light that draws the silhouette */
  rim: { color: string; intensity: number };
  hemi: number;
  /** how hard the paint reflects the bars and the overhead soft box */
  envStrip: number;
  envCeiling: number;
  /** LED line round the turntable, and how bright it burns */
  ring: string;
  ringLevel: number;
  /** the soft glow where the floor meets the wall */
  horizon: string;
  bloom: number;
};

export const moods: Mood[] = [
  {
    id: "studio",
    name: "Studio",
    swatch: "linear-gradient(135deg,#f4f1ea,#8d9096)",
    bg: "#08080a",
    cove: "#34363b",
    floor: "#141518",
    strips: ["#fff7ec", "#fff7ec"],
    stripLevel: 2.4,
    ceiling: "#ffffff",
    ceilingLevel: 2.6,
    key: { color: "#fff6ec", intensity: 160 },
    rim: { color: "#dfe8ff", intensity: 45 },
    hemi: 0.6,
    envStrip: 3,
    envCeiling: 4,
    ring: "#f2ede4",
    ringLevel: 0.5,
    horizon: "#8a8d94",
    bloom: 0.55,
  },
  {
    id: "noir",
    name: "Noir",
    swatch: "linear-gradient(135deg,#ffffff 0 18%,#1a1b1e 40%,#050506)",
    bg: "#040405",
    cove: "#121316",
    floor: "#0b0b0d",
    strips: ["#ffffff", "#ffffff"],
    stripLevel: 0.9,
    ceiling: "#ffffff",
    ceilingLevel: 3.4,
    key: { color: "#ffffff", intensity: 230 },
    rim: { color: "#ffffff", intensity: 110 },
    hemi: 0.12,
    envStrip: 1.1,
    envCeiling: 6.5,
    ring: "#ffffff",
    ringLevel: 0.35,
    horizon: "#2a2b30",
    bloom: 0.45,
  },
  {
    id: "golden",
    name: "Golden hour",
    swatch: "linear-gradient(135deg,#ffd29a,#ff8a3d 55%,#3b5aa8)",
    bg: "#0d0906",
    cove: "#3f2d1f",
    floor: "#1d1510",
    strips: ["#ffad5c", "#ffd9a6"],
    stripLevel: 2.6,
    ceiling: "#ffe0b8",
    ceilingLevel: 1.6,
    key: { color: "#ffc68a", intensity: 175 },
    rim: { color: "#6f9cff", intensity: 80 },
    hemi: 0.45,
    envStrip: 3.2,
    envCeiling: 2.8,
    ring: "#ffb46a",
    ringLevel: 0.7,
    horizon: "#a8693a",
    bloom: 0.75,
  },
  {
    id: "neon",
    name: "Neon",
    swatch: "linear-gradient(135deg,#ff2bd6,#7a3cff 50%,#22e5ff)",
    bg: "#07060b",
    cove: "#1d1a2a",
    floor: "#100f17",
    strips: ["#ff2bd6", "#22e5ff"],
    stripLevel: 3.2,
    ceiling: "#b9a8ff",
    ceilingLevel: 0.9,
    key: { color: "#d8d0ff", intensity: 85 },
    rim: { color: "#ff2bd6", intensity: 95 },
    hemi: 0.3,
    envStrip: 4.2,
    envCeiling: 1.4,
    ring: "#22e5ff",
    ringLevel: 1.2,
    horizon: "#5a2a8a",
    bloom: 1.05,
  },
];

export const moodById = Object.fromEntries(moods.map((m) => [m.id, m])) as Record<MoodId, Mood>;

// ---------------------------------------------------------------------- camera views

export type ShotId = "hero" | "front" | "side" | "rear" | "top" | "low";

/**
 * Preset views, in the car's frame (the nose points down +x). `dir` is where the camera sits seen
 * from the orbit pivot; `dist` scales the car's hero distance; `fov` is the lens (long, as a car
 * photographer shoots, and wide for the low shot down at the floor). Hero uses the car's own camera.
 */
export const shots: { id: ShotId; name: string; dir?: [number, number, number]; dist: number; fov?: number }[] = [
  { id: "hero", name: "Hero", dist: 1 },
  { id: "front", name: "Front", dir: [1, 0.09, 0.001], dist: 0.82, fov: 28 },
  { id: "side", name: "Side", dir: [0.001, 0.045, 1], dist: 1, fov: 26 },
  { id: "rear", name: "Rear", dir: [-0.78, 0.13, -0.6], dist: 0.88, fov: 28 },
  { id: "top", name: "Top", dir: [0.02, 1, 0.001], dist: 0.95, fov: 30 },
  { id: "low", name: "Low", dir: [0.8, 0.012, 0.55], dist: 0.6, fov: 40 },
];

// ---------------------------------------------------------------------- cinematic

type V3 = [number, number, number];
/** car dimensions: half length, half width, height, and the orbit pivot's height */
export type Dims = { l: number; w: number; h: number; y: number };

export type CineShot = {
  title: string;
  /** seconds */
  dur: number;
  fov: [number, number];
  from: (d: Dims) => V3;
  to: (d: Dims) => V3;
  look: (d: Dims) => [V3, V3];
  /** headlights on for this shot */
  lamps?: boolean;
};

/** A commercial-style reel: hard cuts between slow camera moves, each with its own caption. */
export const cineShots: CineShot[] = [
  {
    title: "The silhouette",
    dur: 5.5,
    fov: [26, 24],
    from: ({ l }) => [-l * 1.3, 0.32, l * 2.5],
    to: ({ l }) => [l * 1.3, 0.32, l * 2.5],
    look: ({ y }) => [[-0.3, y, 0], [0.3, y, 0]],
  },
  {
    title: "The face",
    dur: 5,
    fov: [30, 24],
    from: ({ l, w }) => [l * 3.1, 0.38, w * 0.9],
    to: ({ l, w }) => [l * 2.2, 0.3, w * 0.35],
    look: ({ l, y }) => [[l * 0.6, y * 0.9, 0], [l * 0.7, y * 0.85, 0]],
    lamps: true,
  },
  {
    title: "The details",
    dur: 4.5,
    fov: [24, 20],
    from: ({ l, w }) => [l * 1.15, 0.42, w * 2.9],
    to: ({ l, w }) => [l * 0.85, 0.36, w * 2.5],
    look: ({ l, w, h }) => [[l * 0.62, h * 0.24, w * 0.85], [l * 0.6, h * 0.24, w * 0.85]],
  },
  {
    title: "From above",
    dur: 5,
    fov: [34, 32],
    from: ({ l }) => [l * 0.35, l * 3.2, l * 0.9],
    to: ({ l }) => [-l * 0.35, l * 2.9, l * 0.95],
    look: ({ y }) => [[0, y, 0], [0, y, 0]],
  },
  {
    title: "Walking away",
    dur: 5,
    fov: [28, 26],
    from: ({ l, w }) => [-l * 2.6, 0.5, -w * 2.2],
    to: ({ l, w }) => [-l * 2.1, 1.0, -w * 3.4],
    look: ({ l, y }) => [[-l * 0.35, y, 0], [-l * 0.2, y, 0]],
    lamps: true,
  },
  {
    title: "",
    dur: 6,
    fov: [30, 32],
    from: ({ l }) => [l * 1.2, 0.35, l * 1.1],
    to: ({ l }) => [l * 2.2, l * 0.9, l * 2.3],
    look: ({ y }) => [[0, y * 0.9, 0], [0, y, 0]],
  },
];

// ---------------------------------------------------------------------- the dock's car and stage options

export type LiveryId = "none" | "stripes" | "band" | "twotone";
export const liveries: { id: LiveryId; name: string }[] = [
  { id: "none", name: "None" },
  { id: "stripes", name: "Twin stripes" },
  { id: "band", name: "Side band" },
  { id: "twotone", name: "Two-tone roof" },
];
export const liveryColors = [
  { name: "White", hex: "#f2f0ea" },
  { name: "Black", hex: "#0b0b0c" },
  { name: "Lime", hex: "#c8ff3d" },
  { name: "Red", hex: "#c8141c" },
  { name: "Gold", hex: "#c9a24a" },
];

export const brakeColors = [
  { name: "Model's own", hex: "" },
  { name: "Race red", hex: "#d4141b" },
  { name: "Yellow", hex: "#f5c400" },
  { name: "Lime", hex: "#b6f23a" },
  { name: "Orange", hex: "#ff6a13" },
  { name: "Blue", hex: "#1f5bff" },
  { name: "Black", hex: "#111113" },
  { name: "Silver", hex: "#b9bcc0" },
];

/** What stands behind the car: the lit cove, a white cyclorama, a black void or an open sky. */
export type BackdropId = "studio" | "white" | "void" | "sky";
export const backdrops: { id: BackdropId; name: string; swatch: string }[] = [
  { id: "studio", name: "Studio", swatch: "radial-gradient(circle at 50% 70%,#8a8d94,#202125 70%)" },
  { id: "white", name: "White cyc", swatch: "radial-gradient(circle at 50% 70%,#ffffff,#c7c8cb 75%)" },
  { id: "void", name: "Void", swatch: "radial-gradient(circle at 50% 80%,#2a2a2e,#000 60%)" },
  { id: "sky", name: "Open sky", swatch: "linear-gradient(180deg,#5d86c4,#c9d6e4 60%,#3a3b3e 61%)" },
];

export type Quality = "performance" | "quality";

/** The developer settings: finer control than the swatches give. */
export type Tuning = {
  headColor: string;
  /** strength of the studio's reflections in the paint */
  reflections: number;
  bloom: number;
  /** turntable speed, 1 = the default slow spin */
  spin: number;
};
export const defaultTuning: Tuning = { headColor: "#ffeed1", reflections: 1, bloom: 1, spin: 1 };

/** Everything the dock sets on the car and the stage, handed to the scene in one piece. */
export type Look = {
  doors: boolean;
  doorStyle: "swing" | "butterfly";
  calipers: string[];
  /** caliper paint; empty for the model's own */
  brake: string;
  iridescent: boolean;
  livery: LiveryId;
  liveryColor: string;
  interior: boolean;
  grid: boolean;
  backdrop: BackdropId;
  quality: Quality;
  tuning: Tuning;
  /** the car rolls: wheels turn, the floor streams past */
  drive: boolean;
  /** front wheel angle, degrees (positive to the left) */
  steer: number;
  /** ride height change, metres (negative is lower) */
  ride: number;
  /** window tint, 0 (the model's glass) to 1 (limo black) */
  tint: number;
  /** pins on the parts, to click */
  pins: boolean;
  /** time of day under open sky, 0 (sunrise glow) to 1 (high noon) */
  sun: number;
  weather: WeatherId;
  /** depth of field: 0 is everything sharp, higher is a wider aperture and softer background */
  aperture: number;
};

/** Dry, a dusty haze in the light, a wet floor after the rain, or rain falling now. */
export type WeatherId = "dry" | "haze" | "wet" | "rain";
export const weathers: { id: WeatherId; name: string }[] = [
  { id: "dry", name: "Dry" },
  { id: "haze", name: "Haze" },
  { id: "wet", name: "Wet floor" },
  { id: "rain", name: "Rain" },
];

/** A pin for the hotspots: a part of the content and the model groups it covers. */
export type Pin = { id: string; name: string; members: string[] };
