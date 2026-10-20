/**
 * A mixed-radix FFT for any length whose prime factors are 2, 3 and 5. Whisper's frame is 400 samples, not a
 * power of two (400 = 4 · 4 · 5 · 5), so the usual radix-2 FFT doesn't apply.
 *
 * Stockham auto-sort, decimation in frequency: each pass splits a length-n DFT into r interleaved length-n/r
 * DFTs with one radix-r butterfly and a twiddle,
 *
 *   y[s(rp + k) + q] = w_n^{pk} · Σ_j x[s(p + jm) + q] · w_r^{jk},   m = n / r,  w_n = e^{-2πi/n},
 *
 * and ping-pongs between two buffers, so the output comes out in natural order with no bit reversal.
 *
 * No imports: scripts/voice/*.mjs load this file directly to check it against a direct DFT.
 */

export class FFT {
  readonly n: number;
  private radices: number[] = [];
  private re0: Float64Array;
  private im0: Float64Array;
  private re1: Float64Array;
  private im1: Float64Array;
  /** cos and sin of 2πk/n, the only twiddles any pass needs (w_n' for n' | n is a power of w_n) */
  private cos: Float64Array;
  private sin: Float64Array;

  constructor(n: number) {
    this.n = n;
    let rest = n;
    for (const r of [4, 2, 3, 5]) {
      while (rest % r === 0) {
        this.radices.push(r);
        rest /= r;
      }
    }
    if (rest !== 1) throw new Error(`FFT length ${n} has a prime factor above 5`);
    this.re0 = new Float64Array(n);
    this.im0 = new Float64Array(n);
    this.re1 = new Float64Array(n);
    this.im1 = new Float64Array(n);
    this.cos = new Float64Array(n);
    this.sin = new Float64Array(n);
    for (let k = 0; k < n; k++) {
      this.cos[k] = Math.cos((2 * Math.PI * k) / n);
      this.sin[k] = Math.sin((2 * Math.PI * k) / n);
    }
  }

  /** the factorisation the passes use, e.g. [4, 4, 5, 5] for 400 */
  get factors() {
    return [...this.radices];
  }

  /**
   * Forward DFT of a real signal: X[k] = Σ_t x[t] e^{-2πi kt/n} for k = 0 … n/2 (the one-sided half; the rest
   * is the complex conjugate). Writes Re and Im of those n/2 + 1 bins.
   */
  real(x: ArrayLike<number>, outRe: Float64Array, outIm: Float64Array) {
    const n = this.n;
    let xr = this.re0;
    let xi = this.im0;
    let yr = this.re1;
    let yi = this.im1;
    for (let t = 0; t < n; t++) {
      xr[t] = x[t];
      xi[t] = 0;
    }
    let len = n;
    let s = 1;
    const ar = [0, 0, 0, 0, 0];
    const ai = [0, 0, 0, 0, 0];
    for (const r of this.radices) {
      const m = len / r;
      // twiddle index steps: w_len = w_n^{n/len}, w_r = w_n^{n/r}
      const tw = n / len;
      const wr = n / r;
      for (let p = 0; p < m; p++) {
        for (let q = 0; q < s; q++) {
          for (let j = 0; j < r; j++) {
            ar[j] = xr[s * (p + j * m) + q];
            ai[j] = xi[s * (p + j * m) + q];
          }
          for (let k = 0; k < r; k++) {
            // Σ_j a_j w_r^{jk}
            let sr = 0;
            let si = 0;
            for (let j = 0; j < r; j++) {
              const e = ((j * k) % r) * wr;
              const c = this.cos[e];
              const sn = -this.sin[e];
              sr += ar[j] * c - ai[j] * sn;
              si += ar[j] * sn + ai[j] * c;
            }
            // × w_len^{pk}
            const e = ((p * k) % len) * tw;
            const c = this.cos[e];
            const sn = -this.sin[e];
            const o = s * (r * p + k) + q;
            yr[o] = sr * c - si * sn;
            yi[o] = sr * sn + si * c;
          }
        }
      }
      [xr, yr] = [yr, xr];
      [xi, yi] = [yi, xi];
      len = m;
      s *= r;
    }
    const half = n >> 1;
    for (let k = 0; k <= half; k++) {
      outRe[k] = xr[k];
      outIm[k] = xi[k];
    }
  }
}
