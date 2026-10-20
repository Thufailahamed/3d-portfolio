import { create } from "zustand";

export type Source = "sample" | "mic" | "file";

/** the recorder's state, from asking for the microphone to handing the clip over */
export type MicState = "off" | "asking" | "calibrating" | "listening" | "speech" | "done" | "denied";

export type Job = "idle" | "waiting" | "running" | "done" | "error";

type State = {
  /** the page's own files (vocabulary, sample); the model streams in behind */
  status: "loading" | "ready" | "error";
  error: string | null;
  /** Whisper weights: 0 … 1 while downloading, then ready */
  model: { progress: number; ready: boolean; error: string | null };

  /** bumps whenever a new clip starts a run */
  run: number;
  source: Source;
  /** the run's work: encoder, decoder, word alignment */
  enc: Job;
  dec: Job;
  align: Job;
  /** tokens decoded so far in the attempt on show */
  tokens: number;

  mic: MicState;
  /** seconds recorded, for the recorder's clock */
  recorded: number;

  /** decoding settings */
  temperature: number;
  timestamps: boolean;
  seed: number;

  /** playback: stage index and progress through it (0 … 1) */
  stage: number;
  p: number;
  playing: boolean;
  speed: number;
  follow: boolean;
  overview: boolean;
  /** the title card is up: the camera idles at the door and the story waits */
  intro: boolean;
  method: boolean;
  panel: boolean;
  /** the clip is playing through the speakers; its time in seconds */
  listening: boolean;
  /** screen space the overlay covers, in px, so the camera can frame what is left */
  insets: { left: number; right: number; top: number; bottom: number };

  set: (s: Partial<Omit<State, "set">>) => void;
};

export const useVoice = create<State>((set) => ({
  status: "loading",
  error: null,
  model: { progress: 0, ready: false, error: null },

  run: 0,
  source: "sample",
  enc: "idle",
  dec: "idle",
  align: "idle",
  tokens: 0,

  mic: "off",
  recorded: 0,

  temperature: 0,
  timestamps: true,
  seed: 1,

  stage: 0,
  p: 0,
  playing: true,
  speed: 1,
  follow: true,
  overview: false,
  intro: true,
  method: false,
  panel: false,
  listening: false,
  insets: { left: 0, right: 0, top: 0, bottom: 0 },

  set: (s) => set(s),
}));
