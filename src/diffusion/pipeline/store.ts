import { create } from "zustand";
import type { SamplerId } from "../schedule";

export const STEP_OPTIONS = [10, 20, 30, 50];
export const GUIDANCE = { min: 1, max: 10, def: 4 };

export type DecodeState = { status: "idle" | "running" | "done" | "error"; stages: number; ms: number };

type State = {
  status: "loading" | "ready" | "error";
  progress: number;
  error: string | null;

  /** run settings */
  cls: number;
  steps: number;
  sampler: SamplerId;
  w: number;
  seed: number;

  /** bumps whenever a new run starts */
  run: number;
  /** steps the sampler has finished for this run */
  computed: number;
  decode: DecodeState;

  /** playback: stage index and progress through it (0 … 1) */
  stage: number;
  p: number;
  playing: boolean;
  speed: number;
  /** the camera flies to each stage; dragging hands it to the user */
  follow: boolean;
  overview: boolean;
  /** the title card is up: the camera idles at the door and the story waits */
  intro: boolean;
  method: boolean;
  panel: boolean;
  /** screen space the overlay covers, in px, so the camera can frame what is left */
  insets: { left: number; right: number; top: number; bottom: number };

  set: (s: Partial<Omit<State, "set">>) => void;
};

export const useLab = create<State>((set) => ({
  status: "loading",
  progress: 0,
  error: null,

  cls: 0,
  steps: 30,
  sampler: "ddim",
  w: GUIDANCE.def,
  seed: 7,

  run: 0,
  computed: 0,
  decode: { status: "idle", stages: 0, ms: 0 },

  stage: 0,
  p: 0,
  playing: true,
  speed: 1,
  follow: true,
  overview: false,
  intro: true,
  method: false,
  panel: false,
  insets: { left: 0, right: 0, top: 0, bottom: 0 },

  set: (s) => set(s),
}));

/** the step the denoising stage is showing, as a float (k + fraction toward k + 1) */
export function stepCursor(p: number, steps: number) {
  return Math.min(steps, Math.max(0, p * steps));
}
