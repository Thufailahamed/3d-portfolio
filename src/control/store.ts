import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import type { PayloadKind, PositionId, Recovery, VehicleId } from "./data";
import type { Prediction } from "./flight";
import type { Elements } from "./orbit";

export type SatStatus =
  | "active"
  | "raising"
  | "transfer"
  | "departing"
  | "cruise"
  | "lunar"
  | "l2"
  | "arrived"
  | "docked"
  | "safe"
  | "reentered"
  | "deep";

export type Burn = { id: string; label: string; at: number; dv: [number, number, number]; kind: "circ" | "apo" | "peri" | "plane" | "geo" | "deorbit" | "avoid" | "raise" };

export type Sat = {
  id: string;
  name: string;
  kind: string;
  owner: "ours" | "catalog";
  el: Elements | null;
  status: SatStatus;
  mass: number;
  dry: number;
  isp: number;
  power: number;
  crew?: number;
  agency: string;
  launched: number;
  vehicle?: string;
  site?: string;
  missionId?: string;
  /** deep space: where it is or is going */
  where?: string;
  dest?: "moon" | "mars" | "jupiter" | "l2";
  departJd?: number;
  arriveJd?: number;
  deep?: { ra?: number; dec?: number; au?: number; planet?: string };
  raiseTo?: number;
  keep?: boolean;
  burns: Burn[];
  color: string;
};

export type Mission = {
  id: string;
  name: string;
  vehicle: VehicleId;
  payload: PayloadKind;
  site: string;
  jd: number;
  result: "success" | "partial" | "failure" | "scrub" | "abort";
  summary: string;
  recovery: string;
  satId?: string;
  color: string;
};

export type VoiceLine = { id: number; jd: number; met: number | null; who: PositionId | "SIM"; text: string; tone: "info" | "good" | "warn" | "bad" };

export type Draft = {
  payload: PayloadKind;
  vehicle: VehicleId;
  site: string;
  recovery: Recovery;
  mass: number;
  hp: number;
  ha: number;
  inc: number;
  name: string;
};

export type Ops = {
  phase: "idle" | "count" | "flight" | "post";
  tMinus: number;
  holding: boolean;
  hold: string;
  pollState: "none" | "due" | "running" | "go" | "nogo";
  poll: { who: PositionId; label: string; answer: "" | "go" | "nogo"; note?: string }[];
  mission: string;
  result: string;
};

export type Tele = {
  met: number;
  alt: number;
  vel: number;
  vs: number;
  dr: number;
  acc: number;
  q: number;
  mach: number;
  mass: number;
  thr: number;
  stage: string;
  phase: string;
  pitch: number;
  hp: number;
  ha: number;
  inc: number;
  prop: number[];
  boosters: { label: string; alt: number; vel: number; phase: string; prop: number }[];
};

export type Timeline = { id: string; label: string; t: number; done: boolean }[];

export type ViewId = "fd" | "overview" | "front" | "gallery" | "s-map" | "s-feed" | "s-traj" | "s-orbit" | "s-vehicle" | "s-clock" | "s-weather" | "s-dsn" | "s-fleet";

type State = {
  ready: boolean;
  progress: number;
  jd: number;
  warp: number;
  draft: Draft;
  prediction: Prediction | null;
  predicting: boolean;
  planError: string;
  planNote: string;
  ops: Ops;
  tele: Tele | null;
  timeline: Timeline;
  loop: VoiceLine[];
  fleet: Sat[];
  history: Mission[];
  counter: number;
  selected: string | null;
  view: ViewId;
  feedCam: "auto" | "pad" | "tracking" | "onboard" | "booster";
  tab: "plan" | "launch" | "fleet" | "history";
  sound: boolean;
  voice: boolean;
  panels: boolean;
  help: boolean;
  set: (s: Partial<Omit<State, "set">>) => void;
};

export const WARPS = [1, 2, 5, 10, 50, 100, 1000, 10_000, 100_000];

export const zeroTele: Tele = { met: 0, alt: 0, vel: 0, vs: 0, dr: 0, acc: 0, q: 0, mach: 0, mass: 0, thr: 0, stage: "", phase: "", pitch: 90, hp: 0, ha: 0, inc: 0, prop: [1, 1, 1], boosters: [] };

export const useMC = create<State>()(
  persist(
    (set) => ({
      ready: false,
      progress: 0,
      jd: 0,
      warp: 0,
      draft: { payload: "starlink", vehicle: "falcon9", site: "slc40", recovery: "asds", mass: 16_250, hp: 285, ha: 290, inc: 43, name: "" },
      prediction: null,
      predicting: false,
      planError: "",
      planNote: "",
      ops: { phase: "idle", tMinus: 0, holding: false, hold: "", pollState: "none", poll: [], mission: "", result: "" },
      tele: null,
      timeline: [],
      loop: [],
      fleet: [],
      history: [],
      counter: 1,
      selected: null,
      view: "fd",
      feedCam: "auto",
      tab: "plan",
      sound: true,
      voice: true,
      panels: true,
      help: false,
      set: (s) => set(s),
    }),
    {
      name: "mission-control-v1",
      storage: createJSONStorage(() => {
        try {
          return localStorage;
        } catch {
          return { getItem: () => null, setItem: () => {}, removeItem: () => {} };
        }
      }),
      partialize: (s) => ({ fleet: s.fleet.filter((f) => f.owner === "ours"), history: s.history, counter: s.counter, jd: s.jd, sound: s.sound, voice: s.voice, draft: s.draft }),
    },
  ),
);

let lineId = 1;
export const nextLine = () => lineId++;
