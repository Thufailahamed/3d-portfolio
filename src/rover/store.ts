import { create } from "zustand";
import type { WorldId } from "./worlds";

export type Phase = "loading" | "menu" | "cruise" | "approach" | "descent" | "drive" | "lost";
export type CamMode = "chase" | "mast" | "hazcam" | "wheel" | "cinematic";
export const CAMS: { id: CamMode; label: string }[] = [
  { id: "chase", label: "Chase" },
  { id: "mast", label: "Mastcam" },
  { id: "hazcam", label: "Hazcam" },
  { id: "wheel", label: "Wheel" },
  { id: "cinematic", label: "Cinematic" },
];

export type FeedItem = { id: number; text: string; sub?: string; tone: "info" | "good" | "warn" | "gold"; t: number };
export type WheelTele = { load: number; contact: boolean; slip: number; steer: number };
export type Tele = {
  speed: number;
  ground: number;
  odo: number;
  pitch: number;
  roll: number;
  heading: number;
  battery: number;
  power: number;
  gLoad: number;
  air: number;
  slip: number;
  elev: number;
  wind: number;
  pointTurn: boolean;
  wheels: WheelTele[];
  x: number;
  z: number;
};
export type Poi = { id: string; label: string; x: number; z: number; found: boolean };

type State = {
  progress: number;
  ready: boolean;
  phase: Phase;
  world: WorldId | null;
  selected: WorldId;
  hover: WorldId | null;
  edl: { phase: string; alt: number; v: number; ts: number; log: string[] };
  cruise: { from: WorldId; to: WorldId; day: number; days: number; t: number; phase: "wait" | "fly"; launch: number; arrive: number; wait: number; dv: number } | null;
  /** the Solar System map: date (Julian), time-warp step, scale mode (0 illustrative, 1 true distance, 2 true scale), camera focus */
  jd: number;
  warp: number;
  scale: number;
  mapFocus: string | null;
  tele: Tele;
  cam: CamMode;
  speedIdx: number;
  sound: boolean;
  hud: boolean;
  lights: boolean;
  help: boolean;
  feed: FeedItem[];
  sample: { title: string; items: [string, number][]; note: string; done: boolean } | null;
  pois: Poi[];
  overturned: boolean;
  lost: string | null;
  photo: string | null;
  bestAir: number;
  set: (s: Partial<Omit<State, "set">>) => void;
};

const zeroTele: Tele = {
  speed: 0, ground: 0, odo: 0, pitch: 0, roll: 0, heading: 0, battery: 1, power: 0, gLoad: 1, air: 0, slip: 0, elev: 0, wind: 0, pointTurn: false,
  wheels: Array.from({ length: 6 }, () => ({ load: 0, contact: false, slip: 0, steer: 0 })),
  x: 0, z: 0,
};

export const useRover = create<State>((set) => ({
  progress: 0,
  ready: false,
  phase: "loading",
  world: null,
  selected: "mars",
  hover: null,
  edl: { phase: "", alt: 0, v: 0, ts: 1, log: [] },
  cruise: null,
  tele: zeroTele,
  cam: "chase",
  speedIdx: 2,
  sound: true,
  hud: true,
  lights: false,
  help: false,
  feed: [],
  sample: null,
  pois: [],
  overturned: false,
  lost: null,
  photo: null,
  bestAir: 0,
  jd: 2451545,
  warp: 3,
  scale: 0,
  mapFocus: null,
  set: (s) => set(s),
}));

let feedId = 1;
export function announce(text: string, tone: FeedItem["tone"] = "info", sub?: string) {
  const s = useRover.getState();
  const item = { id: feedId++, text, sub, tone, t: performance.now() };
  s.set({ feed: [...s.feed.filter((f) => item.t - f.t < 6000).slice(-3), item] });
}

/** What the HUD asks of the scene; filled in once the scene is built. */
type Control = {
  go: (id: WorldId) => void;
  skip: () => void;
  recover: () => void;
  sample: () => void;
  photo: () => void;
  redeploy: () => void;
  menu: () => void;
  unlock: () => void;
  setMuted: (m: boolean) => void;
  minimap: (c: CanvasRenderingContext2D, w: number, h: number) => void;
  fade: HTMLDivElement | null;
  /** HTML labels that float over the map, keyed by body id */
  labels: Map<string, HTMLElement>;
  select: (id: string) => void;
  overview: () => void;
  now: () => void;
  /** touch controls write here */
  touch: { throttle: number; steer: number; brake: boolean; active: boolean };
};
const noop = () => {};
export const control: Control = {
  go: noop,
  skip: noop,
  recover: noop,
  sample: noop,
  photo: noop,
  redeploy: noop,
  menu: noop,
  unlock: noop,
  setMuted: noop,
  minimap: noop,
  fade: null,
  labels: new Map(),
  select: noop,
  overview: noop,
  now: noop,
  touch: { throttle: 0, steer: 0, brake: false, active: false },
};

/** time-warp steps for the map, in days of simulated time per real second */
export const WARPS = [
  { label: "Paused", dps: 0 },
  { label: "Real time", dps: 1 / 86400 },
  { label: "1 hour / s", dps: 1 / 24 },
  { label: "1 day / s", dps: 1 },
  { label: "1 week / s", dps: 7 },
  { label: "1 month / s", dps: 30.44 },
  { label: "1 year / s", dps: 365.25 },
];
export const SCALES = [
  { label: "Illustrative", sub: "Distances compressed, planets enlarged" },
  { label: "True distances", sub: "Real spacing, planets enlarged" },
  { label: "True scale", sub: "Real spacing and sizes — mostly empty" },
];
