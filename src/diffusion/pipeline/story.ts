/** The pipeline as a sequence of stages: what each is called, how long it plays, and where the camera stands. */

export type StageId = "prompt" | "tokens" | "text" | "noise" | "denoise" | "decode" | "image";

export type Stage = {
  id: StageId;
  title: string;
  /** what comes out of it, as PyTorch would print the shape */
  out: string;
  /** seconds at 1× (denoise: per step) */
  dur: number;
};

export const STAGES: Stage[] = [
  { id: "prompt", title: "Prompt", out: "str", dur: 2.4 },
  { id: "tokens", title: "Tokenizer", out: "[2, 77] int64", dur: 4.2 },
  { id: "text", title: "Text encoder", out: "[2, 77, 768]", dur: 4.4 },
  { id: "noise", title: "Initial noise", out: "[1, 4, 64, 64]", dur: 2.8 },
  { id: "denoise", title: "Denoising loop", out: "[1, 4, 64, 64]", dur: 0.42 },
  { id: "decode", title: "VAE decoder", out: "[1, 3, 512, 512]", dur: 4.8 },
  { id: "image", title: "Image", out: "512 × 512 RGB", dur: 1 },
];

export const stageIndex = (id: StageId) => STAGES.findIndex((s) => s.id === id);

export function stageDuration(i: number, steps: number) {
  const s = STAGES[i];
  return s.id === "denoise" ? Math.max(5, s.dur * steps) : s.dur;
}

/** world x of each station; the floor is y = 0 and the camera looks down −z */
export const X = {
  tokens: -30,
  text: -19,
  latent: -8,
  unet: 2,
  guide: 11.5,
  vae: 20.5,
  out: 30.5,
} as const;

/**
 * A shot frames a box of the world: centred on `look`, `w` × `h` metres, seen from `yaw` (about y, from +z)
 * and `pitch` (above the horizon). The camera backs off until the box fits the part of the screen the panels
 * leave free.
 */
export type Shot = { look: [number, number, number]; w: number; h: number; yaw: number; pitch: number };

export const SHOTS: Record<StageId, Shot> = {
  prompt: { look: [X.tokens, 4.2, 0], w: 7.8, h: 2.8, yaw: 0.04, pitch: 0.05 },
  tokens: { look: [X.tokens, 2.85, 0], w: 8.1, h: 5.6, yaw: 0.07, pitch: 0.1 },
  text: { look: [X.text + 0.75, 2.55, 0], w: 10.4, h: 5.4, yaw: 0.2, pitch: 0.1 },
  noise: { look: [X.latent - 1.0, 2.65, 0], w: 7.6, h: 5.6, yaw: 0.34, pitch: 0.3 },
  denoise: { look: [X.unet + 2.0, 4.3, 0], w: 25, h: 9.0, yaw: 0, pitch: 0.12 },
  decode: { look: [X.vae - 0.35, 2.8, 0], w: 9.8, h: 4.9, yaw: 0.08, pitch: 0.07 },
  image: { look: [X.out + 1.15, 3.4, 0], w: 7.8, h: 6.1, yaw: -0.08, pitch: 0.04 },
};

/** the loop is long: the camera tours it, wide, then the latent, then the U-Net and the scheduler, then wide */
export const LOOP_TOUR: [number, Shot][] = [
  [0.0, SHOTS.denoise],
  [0.26, { look: [X.latent - 0.6, 2.55, 0], w: 6.6, h: 5.3, yaw: 0.52, pitch: 0.3 }],
  [0.54, { look: [X.unet + 4.3, 3.9, 0], w: 16.5, h: 7.4, yaw: -0.14, pitch: 0.1 }],
  [0.82, SHOTS.denoise],
];

/** a wide establishing view of the whole line */
export const OVERVIEW: Shot = { look: [2, 2.4, 0], w: 60, h: 12, yaw: 0.42, pitch: 0.2 };

/** the opening shot, before the story starts: at the door of the hall, looking down the line of exhibits */
export const INTRO = { from: [X.tokens - 15.4, 2.9, 7.2] as [number, number, number], look: [X.tokens + 8.4, 2.35, -0.8] as [number, number, number] };
