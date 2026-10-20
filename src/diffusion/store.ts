import { create } from "zustand";
import type { SamplerId, ScheduleId } from "./schedule";

export type Mode = "generate" | "forward";

export const STEP_OPTIONS = [5, 10, 25, 50, 100, 250, 1000];
export const GUIDANCE_MAX = 8;

export type Stats = {
  /** timestep of the shown state (−1 = clean) and its ᾱ */
  t: number;
  ab: number;
  /** network evaluations spent so far, and in total */
  step: number;
  steps: number;
  ms: number;
  /** mean class posterior p(c | x_t) over all particles */
  belief: number[];
  /** mean distance from a sample to the nearest point of the true shape */
  dist: number | null;
  precision: number | null;
  recall: number | null;
};

type State = {
  ready: boolean;
  progress: number;
  error: string | null;
  /** the car prompt falls back to a torus knot if the model can't load */
  carOk: boolean;
  particles: number;
  /** training-set sizes on offer (per class); index into it below */
  sizes: number[];

  mode: Mode;
  cls: number;
  w: number;
  sampler: SamplerId;
  steps: number;
  schedule: ScheduleId;
  train: number;
  seed: number;

  playing: boolean;
  /** position on the timeline, in snapshots (generate) */
  cursor: number;
  snaps: number;
  /** snapshots computed so far */
  avail: number;
  /** forward view: 0 = clean data, 1…1000 = timestep 0…999 */
  fwd: number;

  ghost: boolean;
  trails: boolean;
  field: boolean;
  spin: boolean;
  help: boolean;
  panel: boolean;

  stats: Stats;
  set: (s: Partial<Omit<State, "set">>) => void;
};

export const useLab = create<State>((set) => ({
  ready: false,
  progress: 0,
  error: null,
  carOk: true,
  particles: 0,
  sizes: [48, 384, 2048],

  mode: "generate",
  cls: 0,
  w: 2,
  sampler: "ddim",
  steps: 50,
  schedule: "cosine",
  train: 2,
  seed: 7,

  playing: true,
  cursor: 0,
  snaps: 0,
  avail: 0,
  fwd: 0,

  ghost: false,
  trails: false,
  field: false,
  spin: true,
  help: false,
  panel: false,

  stats: { t: 999, ab: 0, step: 0, steps: 0, ms: 0, belief: [0.25, 0.25, 0.25, 0.25], dist: null, precision: null, recall: null },
  set: (s) => set(s),
}));
