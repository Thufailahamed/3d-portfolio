/** The pipeline as a sequence of stages: what each is called, how long it plays, and where the camera stands. */

export type StageId = "sound" | "vad" | "resample" | "stft" | "mel" | "encoder" | "decoder" | "text";

export type Stage = {
  id: StageId;
  title: string;
  /** a one-line question the stage answers, for the timeline */
  ask: string;
  /** what comes out of it, as PyTorch would print the shape */
  out: string;
  /** seconds at 1× (decoder: per token) */
  dur: number;
};

export const STAGES: Stage[] = [
  { id: "sound", title: "Sound", ask: "What does a microphone hand over?", out: "float32 @ 48 kHz", dur: 5.5 },
  { id: "vad", title: "Voice detection", ask: "Is anyone speaking?", out: "speech segments", dur: 7 },
  { id: "resample", title: "16 kHz · 30 s", ask: "What does Whisper expect?", out: "[480000] float32", dur: 5 },
  { id: "stft", title: "Fourier transform", ask: "Which frequencies, when?", out: "[201, 3000]", dur: 7 },
  { id: "mel", title: "Log-mel spectrogram", ask: "What would an ear keep?", out: "[80, 3000]", dur: 7 },
  { id: "encoder", title: "Audio encoder", ask: "What does the sound mean?", out: "[1500, 384]", dur: 7.5 },
  { id: "decoder", title: "Text decoder", ask: "Which word comes next?", out: "token ids", dur: 0.55 },
  { id: "text", title: "Transcript", ask: "When was each word said?", out: "words + times", dur: 4 },
];

export const stageIndex = (id: StageId) => STAGES.findIndex((s) => s.id === id);

export function stageDuration(i: number, tokens: number) {
  const s = STAGES[i];
  return s.id === "decoder" ? Math.max(5, s.dur * Math.max(tokens, 8)) : s.dur;
}

/** world x of each station; the floor is y = 0 and the camera looks down −z */
export const X = {
  mic: -40,
  vad: -29.5,
  resample: -18.5,
  stft: -7,
  mel: 3.5,
  encoder: 17,
  decoder: 29,
  text: 40.5,
} as const;

/**
 * A shot frames a box of the world: centred on `look`, `w` × `h` metres, seen from `yaw` (about y, from +z)
 * and `pitch` (above the horizon). The camera backs off until the box fits the part of the screen the panels
 * leave free.
 */
export type Shot = { look: [number, number, number]; w: number; h: number; yaw: number; pitch: number };

export const SHOTS: Record<StageId, Shot> = {
  sound: { look: [X.mic + 1.2, 2.7, 0], w: 8.8, h: 5.5, yaw: 0.2, pitch: 0.08 },
  vad: { look: [X.vad, 2.65, 0], w: 9.4, h: 5.6, yaw: -0.1, pitch: 0.12 },
  resample: { look: [X.resample, 2.65, 0], w: 9.6, h: 5.5, yaw: 0.06, pitch: 0.1 },
  stft: { look: [X.stft - 1.7, 2.8, 0], w: 10.4, h: 5.6, yaw: 0.12, pitch: 0.14 },
  mel: { look: [X.mel, 2.7, 0.4], w: 10.6, h: 6.0, yaw: -0.12, pitch: 0.26 },
  encoder: { look: [X.encoder - 0.4, 3.45, 0], w: 8.4, h: 7.5, yaw: 0.16, pitch: 0.1 },
  decoder: { look: [X.decoder + 0.4, 3.05, 0], w: 10.4, h: 6.1, yaw: -0.06, pitch: 0.1 },
  text: { look: [X.text, 2.85, 0], w: 9.2, h: 5.6, yaw: 0.02, pitch: 0.06 },
};

/** while recording, the camera holds the microphone and the detector together */
export const LIVE_SHOT: Shot = { look: [(X.mic + X.vad) / 2 - 0.2, 2.7, 0], w: 15.2, h: 5.5, yaw: 0.05, pitch: 0.08 };

/** a wide establishing view of the whole line */
export const OVERVIEW: Shot = { look: [3, 2.4, 0], w: 78, h: 13, yaw: 0.42, pitch: 0.2 };

/** the opening shot, before the story starts: at the studio door, looking down the line of stages */
export const INTRO = { from: [X.mic - 15.4, 2.9, 7.2] as [number, number, number], look: [X.mic + 8.4, 2.35, -0.8] as [number, number, number] };
