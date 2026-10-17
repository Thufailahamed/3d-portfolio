/**
 * The About captions are timed in "reference seconds" (from the original 16-second sequence),
 * scrubbed by scroll. This maps them onto the chapter's local progress (0..1); they play
 * while the camera pulls back from the valley to the globe (see ascent.ts).
 */
const START = 0.06;
const PER_SECOND = 0.035;

/** Reference second → about-chapter progress. */
export const atSec = (s: number) => START + s * PER_SECOND;
/** About-chapter progress → reference second. */
export const toSec = (t: number) => (t - START) / PER_SECOND;

export const ease = (x: number) => {
  const t = Math.min(1, Math.max(0, x));
  return t * t * (3 - 2 * t);
};

/** Frame-rate independent damping toward a target (higher `rate` = snappier). */
export const damp = (current: number, target: number, rate: number, dt: number) =>
  current + (target - current) * (1 - Math.exp(-rate * dt));
