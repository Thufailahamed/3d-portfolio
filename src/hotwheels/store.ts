import { create } from "zustand";
import type { AttractionId } from "./park";

export type FeedItem = { id: number; text: string; sub?: string; tone: "good" | "bad" | "info" | "gold"; t: number };
export type Record = { time?: number; air?: number; top?: number; g?: number; laps?: number; score?: number };

/** The Stunt Yard's live readout while you drive. */
export type DriveHud = {
  /** nitro left (0..1), and whether it's burning */
  fuel: number;
  nitro: boolean;
  /** the lap: running time (or null before the first line), last and best, which checkpoint next (of how many) */
  lap: number | null;
  last: number | null;
  best: number | null;
  next: number;
  of: number;
  /** trick points this drive, and the toys knocked down */
  score: number;
  dominoes: [number, number];
  pins: [number, number];
};
export type RaceState = {
  phase: "idle" | "staged" | "countdown" | "go" | "racing" | "done";
  ambers: number;
  result?: { win: boolean; foul: boolean; margin: number; reaction: number | null; you?: number; rival?: number };
};

/**
 * How the camera behaves while a car is running: stay on the attraction (orbit), ride behind it
 * (chase), cut between trackside cameras like a broadcast (tv), or sit on its roof (onboard).
 */
export type CamMode = "orbit" | "chase" | "tv" | "onboard";
export const CAM_MODES: { id: CamMode; label: string }[] = [
  { id: "chase", label: "Chase" },
  { id: "tv", label: "Trackside" },
  { id: "onboard", label: "Onboard" },
  { id: "orbit", label: "Fixed" },
];

/** A dot on the minimap: where (0..1 across the map), and whose car it is. */
export type Dot = { x: number; y: number; me: boolean; color: string };

type State = {
  progress: number;
  ready: boolean;
  /** the camera stop (0 overview, then the attractions) it is heading to, and the one it's at */
  target: number;
  stop: number;
  /** the car in your hand (an index into MODELS) */
  model: number;
  /** the launcher's meter (0..1) while you're holding, and whether you are */
  charge: number;
  charging: boolean;
  /** the band of power that clears the attraction cleanly, if it has one */
  sweet: [number, number] | null;
  slowmo: boolean;
  autoSlow: boolean;
  cam: CamMode;
  night: boolean;
  sound: boolean;
  drop: boolean;
  /** the interface is showing (H hides it for a clean view) */
  hud: boolean;
  feed: FeedItem[];
  records: Partial<{ [K in AttractionId]: Record }>;
  race: RaceState;
  /** live readout for the car being followed: speed (cm/s), load (g), and whether it's flying */
  speed: number;
  g: number;
  air: boolean;
  blocksDown: number;
  cars: number;
  /** the Crash Junction: cars on the circuit, laps since the last crash (with two or more running) */
  junction: { cars: number; streak: number };
  /** an instant replay is playing (how far through, 0..1) */
  replay: { on: boolean; k: number };
  /** whether there's a run worth replaying */
  canReplay: boolean;
  /** driving your own car in the Stunt Yard, and its readout */
  driving: boolean;
  drive: DriveHud;
  /** challenges done (ids), and the latest one completed (for the banner) */
  challengesDone: string[];
  toast: { id: number; title: string; desc: string } | null;
  /** show your best runs as ghost cars */
  ghosts: boolean;
  /** the challenges panel is open */
  panel: boolean;
  /** the minimap: track outlines (SVG paths in a 0..100 × 0..h box) and the cars on it */
  map: { paths: { d: string; color: string }[]; h: number } | null;
  dots: Dot[];
  /** a run just finished: shown in the result card */
  last: { attraction: AttractionId; time?: number; air: number; top: number; loops: number; ring: boolean; crashed: boolean; smashed: boolean; record: boolean; maxG: number } | null;
  set: (s: Partial<Omit<State, "set">>) => void;
};

export const useHW = create<State>((set) => ({
  progress: 0,
  ready: false,
  target: 0,
  stop: 0,
  model: 0,
  charge: 0,
  charging: false,
  sweet: null,
  slowmo: false,
  autoSlow: true,
  cam: "chase",
  night: false,
  sound: true,
  drop: false,
  hud: true,
  feed: [],
  records: {},
  race: { phase: "idle", ambers: 0 },
  speed: 0,
  g: 1,
  air: false,
  blocksDown: 0,
  cars: 0,
  junction: { cars: 0, streak: 0 },
  replay: { on: false, k: 0 },
  canReplay: false,
  map: null,
  dots: [],
  driving: false,
  drive: { fuel: 1, nitro: false, lap: null, last: null, best: null, next: 0, of: 5, score: 0, dominoes: [0, 0], pins: [0, 0] },
  challengesDone: [],
  toast: null,
  ghosts: true,
  panel: false,
  last: null,
  set: (s) => set(s),
}));

let feedId = 1;
/** Add a line to the stunt feed (the newest few are shown, each for a few seconds). */
export function announce(text: string, tone: FeedItem["tone"] = "info", sub?: string) {
  const s = useHW.getState();
  const item = { id: feedId++, text, sub, tone, t: performance.now() };
  s.set({ feed: [...s.feed.filter((f) => item.t - f.t < 4200).slice(-4), item] });
}

/** What the page asks the scene to do (set by the scene once it's built). */
export const control: {
  press: () => void;
  release: () => void;
  launchAll: () => void;
  reset: () => void;
  race: () => void;
  replay: () => void;
  /** your hands on the car (the Stunt Yard): any of throttle (-1..1), steer (-1 left .. 1 right), handbrake, nitro, hop */
  drive: (c: Partial<{ throttle: number; steer: number; handbrake: boolean; nitro: boolean; hop: boolean }>) => void;
  /** put your car back on the start line / stand the yard's toys back up / stop driving */
  respawn: () => void;
  resetToys: () => void;
  stopDrive: () => void;
} = { press: () => {}, release: () => {}, launchAll: () => {}, reset: () => {}, race: () => {}, replay: () => {}, drive: () => {}, respawn: () => {}, resetToys: () => {}, stopDrive: () => {} };

// the physics changed under v1's records (cars now differ), so they start afresh
const KEY = "hw-records-v2";
export function loadRecords(): State["records"] {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? "{}");
  } catch {
    return {};
  }
}
export function saveRecords(r: State["records"]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(r));
  } catch {
    /* private mode: records last the visit */
  }
}
