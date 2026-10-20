/**
 * Voice activity detection: the statistical model-based detector of Sohn, Kim & Sung (IEEE SPL, 1999), run on
 * the very 25 ms / 10 ms power spectra Whisper's front end computes.
 *
 * Each DFT bin X_k is modelled as zero-mean complex Gaussian. Under H₀ (noise only) its variance is λ_N(k);
 * under H₁ (speech + noise) it is λ_N(k) + λ_S(k). With the a-posteriori SNR γ_k = |X_k|² / λ_N(k) and the
 * a-priori SNR ξ_k = λ_S(k) / λ_N(k), the log likelihood ratio of one bin is
 *
 *   log Λ_k = log p(X_k | H₁) / p(X_k | H₀) = γ_k ξ_k / (1 + ξ_k) − log(1 + ξ_k).
 *
 * ξ_k is unknown; the decision-directed estimate (Ephraim & Malah, 1984) blends the previous frame's
 * Wiener-filtered speech power with this frame's excess, ξ_k = a · G²γ_k(prev) + (1 − a) · max(γ_k − 1, 0).
 * The frame statistic is the mean of log Λ_k over bins (the log of their geometric mean), in nats per bin.
 * A hysteresis with a hangover turns that statistic into speech segments, and λ_N is re-estimated whenever
 * the detector says silence.
 *
 * No imports: scripts/voice/*.mjs run this file on the test clips.
 */

export const VAD = {
  /** bins 3 … 200 (120 Hz – 8 kHz): below 120 Hz is mains hum and handling noise */
  lo: 3,
  hi: 200,
  /** decision-directed smoothing a, and the a-priori SNR floor (−25 dB) */
  dd: 0.98,
  xiMin: 10 ** -2.5,
  /** a-posteriori SNR ceiling (+50 dB), so one click can't dominate a frame */
  gammaMax: 1e5,
  /** frames (10 ms each) averaged for the first noise estimate */
  calib: 20,
  /** noise smoothing in silence (time constant ≈ 0.2 s), and its creep during speech (+0.9 dB/s) */
  noiseAlpha: 0.95,
  creep: 1.002,
  /** thresholds on the frame statistic, nats per bin: open above `on`, close below `off` */
  on: 0.6,
  off: 0.2,
  /** frames above `on` in a row to open (rejects clicks), frames below `off` in a row to close (hangover) */
  onFrames: 4,
  hangover: 20,
  /** segment padding either side, gaps that merge, and the shortest segment kept, all in frames */
  pad: 12,
  merge: 30,
  minSpeech: 12,
  /** the recorder stops this many frames after speech closes, once this much speech was heard */
  endSilence: 50,
  endMinSpeech: 25,
} as const;

export type VadStep = {
  /** mean log Λ_k over the band, nats per bin (0 while calibrating) */
  llr: number;
  /** the detector's state after this frame */
  speech: boolean;
  calibrating: boolean;
};

export class Vad {
  readonly bins: number;
  /** λ_N(k): the noise power estimate */
  readonly noise: Float64Array;
  /** this frame's γ_k and ξ_k, for display */
  readonly gamma: Float64Array;
  readonly xi: Float64Array;
  /** G²γ of the previous frame: its estimated clean-speech power over the noise */
  private prev: Float64Array;
  frame = 0;
  open = false;
  private above = 0;
  private below = 0;

  constructor(bins = 201) {
    this.bins = bins;
    this.noise = new Float64Array(bins);
    this.gamma = new Float64Array(bins);
    this.xi = new Float64Array(bins);
    this.prev = new Float64Array(bins);
  }

  step(power: ArrayLike<number>): VadStep {
    const t = this.frame++;
    const n = this.noise;
    if (t < VAD.calib) {
      for (let k = 0; k < this.bins; k++) n[k] += power[k] / VAD.calib;
      return { llr: 0, speech: false, calibrating: true };
    }
    let sum = 0;
    for (let k = VAD.lo; k <= VAD.hi; k++) {
      const g = Math.min(VAD.gammaMax, power[k] / Math.max(n[k], 1e-20));
      const xi = Math.max(VAD.xiMin, VAD.dd * this.prev[k] + (1 - VAD.dd) * Math.max(g - 1, 0));
      sum += (g * xi) / (1 + xi) - Math.log1p(xi);
      const G = xi / (1 + xi);
      this.prev[k] = G * G * g;
      this.gamma[k] = g;
      this.xi[k] = xi;
    }
    const llr = sum / (VAD.hi - VAD.lo + 1);

    if (!this.open) {
      this.above = llr > VAD.on ? this.above + 1 : 0;
      if (this.above >= VAD.onFrames) {
        this.open = true;
        this.below = 0;
      }
    } else {
      this.below = llr < VAD.off ? this.below + 1 : 0;
      if (this.below >= VAD.hangover) {
        this.open = false;
        this.above = 0;
      }
    }

    // re-estimate the noise where the detector hears none; let it creep up otherwise
    if (!this.open && llr < VAD.on) for (let k = 0; k < this.bins; k++) n[k] = VAD.noiseAlpha * n[k] + (1 - VAD.noiseAlpha) * power[k];
    else for (let k = 0; k < this.bins; k++) n[k] *= VAD.creep;
    return { llr, speech: this.open, calibrating: false };
  }
}

export type Segment = { start: number; end: number };

/**
 * Speech segments, in frames, from the per-frame states: each open run is moved back by the frames it took to
 * open and trimmed of its hangover, padded, then runs closer than `merge` are joined.
 */
export function segments(steps: VadStep[]): Segment[] {
  const raw: Segment[] = [];
  let a = -1;
  for (let f = 0; f <= steps.length; f++) {
    const on = f < steps.length && steps[f].speech;
    if (on && a < 0) a = f;
    if (!on && a >= 0) {
      // closed at f: the last frames were hangover, unless the clip ended while open
      const end = f < steps.length ? f - VAD.hangover : f;
      raw.push({ start: a - VAD.onFrames + 1, end: Math.max(a + 1, end) });
      a = -1;
    }
  }
  const out: Segment[] = [];
  for (const s of raw) {
    if (s.end - s.start < VAD.minSpeech) continue;
    const p = { start: Math.max(0, s.start - VAD.pad), end: Math.min(steps.length, s.end + VAD.pad) };
    const last = out[out.length - 1];
    if (last && p.start - last.end < VAD.merge) last.end = p.end;
    else out.push(p);
  }
  return out;
}

/** the recorder's stop rule: enough speech heard, then enough silence after it */
export class Endpointer {
  speechFrames = 0;
  silence = 0;
  done = false;
  step(s: VadStep) {
    if (s.speech) {
      this.speechFrames++;
      this.silence = 0;
    } else if (this.speechFrames > 0) this.silence++;
    if (this.speechFrames >= VAD.endMinSpeech && this.silence >= VAD.endSilence) this.done = true;
    return this.done;
  }
}
