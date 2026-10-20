/**
 * Playing a `Timeline` back: the clock the scene and the HUD share, and the lookups that turn a
 * moment into interpolated values (frame tracks, crush snapshots, debris). Everything is evaluated
 * from the timeline at the current time, so pausing, scrubbing and running backwards all show
 * exactly what the solver computed.
 */
import { NB, NS, type CrushTrack, type DebrisSet, type Timeline } from "./sim/types";

/** The shared clock: mutated by the transport, read every frame by the scene. */
export type Playback = {
  /** sim time (s, T0 = 0 at first contact) */
  t: number;
  /** sim seconds per real second when not automatic (1, 0.25, 0.1, 0.025 …) */
  speed: number;
  playing: boolean;
  /** slow motion ramps in and out by itself round the impact */
  auto: boolean;
};

/** Where time t falls in a sorted time array: the frame before it and the fraction to the next. */
export function frameAt(times: Float32Array, t: number): [number, number] {
  const n = times.length;
  if (n === 0) return [0, 0];
  if (t <= times[0]) return [0, 0];
  if (t >= times[n - 1]) return [n - 1, 0];
  let lo = 0, hi = n - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (times[mid] <= t) lo = mid;
    else hi = mid;
  }
  return [lo, (t - times[lo]) / (times[hi] - times[lo] || 1)];
}

/** Interpolate row i → i+1 of a packed per-frame array (stride values per frame) into out. */
export function lerpRow(arr: Float32Array, stride: number, i: number, f: number, out: Float32Array | number[], offset = 0) {
  const a = i * stride, b = Math.min(i + 1, arr.length / stride - 1) * stride;
  for (let k = 0; k < stride; k++) out[offset + k] = arr[a + k] + (arr[b + k] - arr[a + k]) * f;
  return out;
}

const SNAP = NB * NS * 3;

/** The crush grid of one body at time t (NB × NS × {C, L, D}), interpolated between snapshots. */
export function crushAt(track: CrushTrack, t: number, out: Float32Array = new Float32Array(SNAP)) {
  const [i, f] = frameAt(track.times, t);
  const n = track.times.length;
  if (!n) return out.fill(0);
  const a = i * SNAP, b = Math.min(i + 1, n - 1) * SNAP;
  const d = track.data;
  for (let k = 0; k < SNAP; k++) out[k] = d[a + k] + (d[b + k] - d[a + k]) * f;
  return out;
}

/**
 * Position, spin angle and visibility of debris particle p at time t, from its piecewise-quadratic
 * segments. Returns false before it has been shed.
 */
export function debrisAt(set: DebrisSet, p: number, t: number, out: Float32Array | number[]): boolean {
  const first = set.first[p], count = set.count[p];
  if (!count || t < set.seg[first * 12]) return false;
  let s = first;
  while (s + 1 < first + count && set.seg[(s + 1) * 12] <= t) s++;
  const o = s * 12, g = set.seg;
  const tau = t - g[o];
  out[0] = g[o + 1] + g[o + 4] * tau + 0.5 * g[o + 7] * tau * tau;
  out[1] = g[o + 2] + g[o + 5] * tau + 0.5 * g[o + 8] * tau * tau;
  out[2] = g[o + 3] + g[o + 6] * tau + 0.5 * g[o + 9] * tau * tau;
  out[3] = g[o + 10] + g[o + 11] * tau;
  return true;
}

/** The impact window: first contact to the last separation (s). */
export function impactWindow(tl: Timeline): [number, number] {
  let end = tl.metrics.contactMs / 1000;
  for (const e of tl.events) if (e.type === "separate") end = Math.max(end, e.t);
  return [0, Math.max(end, 0.06)];
}

/**
 * The automatic speed at time t, as a 1,000 fps film is played back: real time on the approach,
 * easing down to 1/40 just before the impact, held through it, then 1/4 for the spin-out and back
 * to real time once the cars have settled.
 */
export function autoSpeed(tl: Timeline, t: number) {
  const [, end] = impactWindow(tl);
  const slow = 1 / 40;
  const ramp = (x: number, x0: number, x1: number) => Math.min(1, Math.max(0, (x - x0) / (x1 - x0)));
  const lerpLog = (a: number, b: number, u: number) => Math.exp(Math.log(a) + (Math.log(b) - Math.log(a)) * u);
  if (t < -0.25) return 1;
  if (t < -0.02) return lerpLog(1, slow, ramp(t, -0.25, -0.02));
  if (t < end + 0.04) return slow;
  if (t < end + 0.3) return lerpLog(slow, 0.25, ramp(t, end + 0.04, end + 0.3));
  if (t < end + 1.6) return 0.25;
  return lerpLog(0.25, 1, ramp(t, end + 1.6, end + 2.4));
}

/** The last moment worth playing: when every body has come to rest (or the end of the record). */
export function endOf(tl: Timeline) {
  let rest = 0;
  for (const e of tl.events) if (e.type === "rest") rest = Math.max(rest, e.t);
  const last = tl.times[tl.times.length - 1] ?? 0;
  return Math.min(last, Math.max(rest + 0.8, 1.5));
}
