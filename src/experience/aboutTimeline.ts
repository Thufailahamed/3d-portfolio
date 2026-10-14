/**
 * The About chapter replays a 16-second reference sequence, scrubbed by scroll.
 * Everything in the chapter is timed in those reference seconds; this maps them onto
 * the chapter's local progress (0..1), so the HUD hand-off at 12s lands at t ≈ 0.8.
 */
const START = 0.06; // after the dip from black
const PER_SECOND = 0.035; // re-timed so the ribbon sequence transitions to the globe by t ≈ 0.52, leaving 0.52..0.94 as a generous pause/hold on the assembled globe & HUD

/** Reference second → about-chapter progress. */
export const atSec = (s: number) => START + s * PER_SECOND;
/** About-chapter progress → reference second. */
export const toSec = (t: number) => (t - START) / PER_SECOND;

export const ease = (x: number) => {
  const t = Math.min(1, Math.max(0, x));
  return t * t * (3 - 2 * t);
};
/** 0 → 1 between reference seconds a and b (smoothed). */
export const span = (sec: number, a: number, b: number) => ease((sec - a) / (b - a));

/**
 * Smooth path through keyframes reached at `times` (cubic Hermite, Catmull-Rom tangents,
 * flat at both ends). Returns the weight of each keyframe at second `t`, so motion flows
 * through the keyframes instead of stopping at each one.
 */
export function keyWeights(times: number[], t: number, out: number[] = []) {
  const n = times.length;
  out.length = n;
  out.fill(0);
  if (t <= times[0]) return (out[0] = 1), out;
  if (t >= times[n - 1]) return (out[n - 1] = 1), out;
  let i = 0;
  while (t > times[i + 1]) i++;
  const d = times[i + 1] - times[i];
  const x = (t - times[i]) / d;
  const x2 = x * x;
  const x3 = x2 * x;
  const h00 = 2 * x3 - 3 * x2 + 1;
  const h10 = x3 - 2 * x2 + x;
  const h01 = -2 * x3 + 3 * x2;
  const h11 = x3 - x2;
  out[i] += h00;
  out[i + 1] += h01;
  // tangent at i: (P[i+1] - P[i-1]) / (t[i+1] - t[i-1]); zero at the ends
  if (i > 0) {
    const k = (h10 * d) / (times[i + 1] - times[i - 1]);
    out[i + 1] += k;
    out[i - 1] -= k;
  }
  if (i + 2 < n) {
    const k = (h11 * d) / (times[i + 2] - times[i]);
    out[i + 2] += k;
    out[i] -= k;
  }
  return out;
}

/** Frame-rate independent damping toward a target (higher `rate` = snappier). */
export const damp = (current: number, target: number, rate: number, dt: number) =>
  current + (target - current) * (1 - Math.exp(-rate * dt));

/**
 * Powering the globe (reference seconds). A light pulse runs up the stem and around the
 * meridians; when it reaches the planet a wave sweeps it pole to pole and the cities switch
 * on; then the strands fade away, leaving only the globe.
 */
export const PULSE: [number, number] = [11.2, 12.2];
export const POWER: [number, number] = [11.75, 12.95];
export const LINES_OUT: [number, number] = [12.7, 13.5];
