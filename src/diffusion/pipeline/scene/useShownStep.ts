import { DENOISE } from "../lab";
import { stepCursor, useLab } from "../store";

/** the denoising step on screen: −1 before the loop starts, `steps` once it has finished */
export function useShownStep() {
  const k = useLab((s) => (s.stage < DENOISE ? -1 : s.stage > DENOISE ? s.steps : Math.floor(stepCursor(s.p, s.steps))));
  const steps = useLab((s) => s.steps);
  return { k: Math.max(0, k), steps, pre: k < 0 };
}

/** the loop's playhead inside the current step, 0 … 1, or −1 outside the loop */
export function stepPhase() {
  const s = useLab.getState();
  if (s.stage !== DENOISE) return -1;
  const c = stepCursor(s.p, s.steps);
  return c >= s.steps ? -1 : c - Math.floor(c);
}

/**
 * Where each part of one step happens inside its playhead, in execution order: the latent goes in, the
 * guidance batch runs the U-Net, the two predictions are combined, the scheduler steps, and z_t is replaced.
 */
export const PHASE = {
  toUnet: [0, 0.1],
  unet: [0.1, 0.7],
  toGuide: [0.7, 0.8],
  cfg: [0.8, 0.88],
  sched: [0.88, 0.94],
  back: [0.94, 1],
} as const;

export const within = (ph: number, [a, b]: readonly [number, number]) => (ph < a ? 0 : ph > b ? 1 : (ph - a) / (b - a));
