/**
 * Band-limited resampling to Whisper's 16 kHz: a Kaiser-windowed sinc low-pass evaluated at each output instant,
 * the design ffmpeg's default resampler uses (cut-off 0.97 of the lower Nyquist, β = 9, ±16 zero crossings).
 *
 *   y[n] = Σ_k x[k] · h(n / f_out − k / f_in),   h(τ) = 2f_c sinc(2f_c τ) · w_Kaiser(τ / T) / f_in
 *
 * f_c = 0.97 × 8 kHz = 7.76 kHz removes everything a 16 kHz signal can't represent (aliasing), T = 16 / 16 000 s.
 * Taps are normalised per output sample so a constant stays exactly constant.
 *
 * No imports: scripts/voice/*.mjs load this file directly.
 */

export const RESAMPLE = { zeros: 16, beta: 9, cutoff: 0.97 } as const;

/** modified Bessel function of the first kind, order 0, by its power series */
function besselI0(x: number) {
  let sum = 1;
  let term = 1;
  const q = (x * x) / 4;
  for (let k = 1; k < 60; k++) {
    term *= q / (k * k);
    sum += term;
    if (term < sum * 1e-17) break;
  }
  return sum;
}

export function kaiser(u: number, beta: number = RESAMPLE.beta) {
  if (u <= -1 || u >= 1) return 0;
  return besselI0(beta * Math.sqrt(1 - u * u)) / besselI0(beta);
}

export const sinc = (x: number) => (x === 0 ? 1 : Math.sin(Math.PI * x) / (Math.PI * x));

export class Resampler {
  readonly inRate: number;
  readonly outRate: number;
  /** cut-off in Hz and kernel half-width in seconds */
  readonly fc: number;
  readonly T: number;
  /** the kernel's shape over u = |τ| / T ∈ [0, 1], tabulated */
  private table: Float64Array;
  private res = 4096;
  /** input not yet fully consumed, and the absolute index of its first sample */
  private buf = new Float32Array(0);
  private bufStart = 0;
  /** next output sample to produce */
  private n = 0;

  constructor(inRate: number, outRate = 16000) {
    this.inRate = inRate;
    this.outRate = outRate;
    const low = Math.min(inRate, outRate);
    this.fc = (RESAMPLE.cutoff * low) / 2;
    this.T = RESAMPLE.zeros / low;
    this.table = new Float64Array(this.res + 2);
    for (let i = 0; i <= this.res + 1; i++) {
      const u = i / this.res;
      this.table[i] = sinc(2 * this.fc * u * this.T) * kaiser(u);
    }
  }

  /** h(τ) up to its constant factor, for drawing the kernel */
  kernel(tau: number) {
    const u = Math.abs(tau) / this.T;
    if (u >= 1) return 0;
    const x = u * this.res;
    const i = Math.floor(x);
    return this.table[i] + (this.table[i + 1] - this.table[i]) * (x - i);
  }

  /** feed input samples, get every output sample they complete */
  push(x: Float32Array, final = false): Float32Array {
    if (this.inRate === this.outRate) return x.slice();
    const merged = new Float32Array(this.buf.length + x.length);
    merged.set(this.buf);
    merged.set(x, this.buf.length);
    this.buf = merged;
    const end = this.bufStart + merged.length; // absolute index one past the last input
    const reach = this.T * this.inRate;
    const out: number[] = [];
    for (;;) {
      const c = (this.n * this.inRate) / this.outRate; // the output instant, in input samples
      const k0 = Math.ceil(c - reach);
      const k1 = Math.floor(c + reach);
      if (!final && k1 >= end) break;
      if (final && Math.ceil(c) >= end) break;
      let acc = 0;
      let norm = 0;
      for (let k = k0; k <= k1; k++) {
        const w = this.kernel((c - k) / this.inRate);
        norm += w;
        const j = k - this.bufStart;
        if (j >= 0 && j < merged.length) acc += w * merged[j];
      }
      out.push(norm ? acc / norm : 0);
      this.n++;
    }
    // keep what the next outputs can still reach
    const next = (this.n * this.inRate) / this.outRate;
    const keepFrom = Math.max(this.bufStart, Math.ceil(next - reach) - 1);
    this.buf = this.buf.slice(keepFrom - this.bufStart);
    this.bufStart = keepFrom;
    return Float32Array.from(out);
  }

  static offline(x: Float32Array, inRate: number, outRate = 16000) {
    return new Resampler(inRate, outRate).push(x, true);
  }
}
