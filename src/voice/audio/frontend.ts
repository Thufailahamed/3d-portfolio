/**
 * Whisper's audio front end, as whisper/audio.py computes it: 16 kHz mono, a 400-sample (25 ms) Hann window
 * every 160 samples (10 ms), |STFT|², 80 Slaney mel filters, log10, a dynamic range of 8 decades, and a fixed
 * affine rescale. Every constant here is the reference implementation's.
 *
 * No imports but ./fft: scripts/voice/*.mjs load this file to check it against OpenAI's mel_filters.npz.
 */
import { FFT } from "./fft";

export const SAMPLE_RATE = 16000;
export const N_FFT = 400;
export const HOP = 160;
export const CHUNK_SECONDS = 30;
export const N_SAMPLES = CHUNK_SECONDS * SAMPLE_RATE; // 480 000
export const N_FRAMES = N_SAMPLES / HOP; // 3 000 mel frames, 10 ms each
export const N_MELS = 80;
export const N_BINS = N_FFT / 2 + 1; // 201, 40 Hz apart
export const BIN_HZ = SAMPLE_RATE / N_FFT;

/** torch.hann_window(400), periodic: w[n] = ½ − ½ cos(2πn / N) */
export function hann(n = N_FFT) {
  const w = new Float64Array(n);
  for (let i = 0; i < n; i++) w[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / n);
  return w;
}

// librosa's default (Slaney) mel scale: linear below 1 kHz, logarithmic above
const F_SP = 200 / 3;
const MIN_LOG_HZ = 1000;
const MIN_LOG_MEL = MIN_LOG_HZ / F_SP; // 15
const LOGSTEP = Math.log(6.4) / 27;

export function hzToMel(f: number) {
  return f >= MIN_LOG_HZ ? MIN_LOG_MEL + Math.log(f / MIN_LOG_HZ) / LOGSTEP : f / F_SP;
}

export function melToHz(m: number) {
  return m >= MIN_LOG_MEL ? MIN_LOG_HZ * Math.exp(LOGSTEP * (m - MIN_LOG_MEL)) : F_SP * m;
}

/**
 * librosa.filters.mel(sr=16000, n_fft=400, n_mels=80): triangles between 82 points evenly spaced in mel from
 * 0 Hz to 8 kHz, each scaled by 2 / (its width in Hz) so every filter has the same area ("slaney" norm).
 * Row-major [n_mels, 201], float32 like the file Whisper ships.
 */
export function melFilters(nMels = N_MELS, sr = SAMPLE_RATE, nFft = N_FFT) {
  const nBins = nFft / 2 + 1;
  const maxMel = hzToMel(sr / 2);
  const edges = new Float64Array(nMels + 2);
  for (let i = 0; i < nMels + 2; i++) edges[i] = melToHz((maxMel * i) / (nMels + 1));
  const w = new Float32Array(nMels * nBins);
  for (let m = 0; m < nMels; m++) {
    const lo = edges[m];
    const mid = edges[m + 1];
    const hi = edges[m + 2];
    const norm = 2 / (hi - lo);
    for (let k = 0; k < nBins; k++) {
      const f = (k * sr) / nFft;
      const v = Math.max(0, Math.min((f - lo) / (mid - lo), (hi - f) / (hi - mid)));
      w[m * nBins + k] = v * norm;
    }
  }
  return { weights: w, edges };
}

/** one frame's analysis: the windowed 400-point DFT and its power, shared by Whisper's front end and the VAD */
export class FrameAnalyzer {
  readonly window = hann();
  private fft = new FFT(N_FFT);
  private buf = new Float64Array(N_FFT);
  private re = new Float64Array(N_BINS);
  private im = new Float64Array(N_BINS);

  /** |X[k]|² for k = 0 … 200 of window · frame */
  power(frame: ArrayLike<number>, out: Float64Array | Float32Array) {
    let any = false;
    for (let i = 0; i < N_FFT; i++) {
      const v = frame[i] * this.window[i];
      this.buf[i] = v;
      if (v !== 0) any = true;
    }
    // an all-zero frame (Whisper's padding) has an all-zero spectrum; skip the transform
    if (!any) return void out.fill(0);
    this.fft.real(this.buf, this.re, this.im);
    for (let k = 0; k < N_BINS; k++) out[k] = this.re[k] * this.re[k] + this.im[k] * this.im[k];
  }
}

export type LogMel = {
  /** [80, 3000] row-major (mel band, then frame), what the encoder's conv1 reads */
  mel: Float32Array;
  /** frames that hold audio rather than padding: ⌊samples / 160⌋ */
  contentFrames: number;
  /** the global maximum of log10(mel) before clamping; the floor is this − 8 */
  maxLog: number;
  /** |STFT|² of the first `powerFrames` frames, [frame][201], for the scene and the VAD */
  power: Float32Array;
  powerFrames: number;
};

/**
 * whisper.audio.log_mel_spectrogram(audio, padding=N_SAMPLES), first 3000 frames:
 * pad 30 s of zeros on the right, STFT with center=True (reflect-pad 200 each side), drop the last frame, mel,
 * log10(max(·, 1e-10)), clamp to (max − 8), then (x + 4) / 4.
 */
export function logMelSpectrogram(audio: Float32Array, filters = melFilters().weights): LogMel {
  const L = audio.length;
  const Lp = L + N_SAMPLES;
  const half = N_FFT / 2;
  const at = (j: number) => {
    // the padded signal x_p (audio then zeros), read through torch's reflect padding
    if (j < 0) j = -j;
    else if (j >= Lp) j = 2 * (Lp - 1) - j;
    return j < L ? audio[j] : 0;
  };
  const total = Math.floor(Lp / HOP); // 1 + ⌊Lp / hop⌋ frames, minus the dropped last one
  // frames past this read only zeros: log10(1e-10) = −10, never the maximum
  const live = Math.min(total, Math.ceil((L + half) / HOP) + 1);
  const powerFrames = Math.min(N_FRAMES, live);
  const power = new Float32Array(powerFrames * N_BINS);
  const logs = new Float32Array(N_MELS * N_FRAMES).fill(-10);
  const an = new FrameAnalyzer();
  const frame = new Float64Array(N_FFT);
  const p = new Float64Array(N_BINS);
  let maxLog = -10;
  const kept = Math.min(N_FRAMES, live);
  for (let f = 0; f < live; f++) {
    const start = f * HOP - half;
    for (let i = 0; i < N_FFT; i++) frame[i] = at(start + i);
    an.power(frame, p);
    if (f < powerFrames) for (let k = 0; k < N_BINS; k++) power[f * N_BINS + k] = p[k];
    for (let m = 0; m < N_MELS; m++) {
      let s = 0;
      const row = m * N_BINS;
      for (let k = 0; k < N_BINS; k++) s += filters[row + k] * p[k];
      const v = Math.log10(Math.max(s, 1e-10));
      if (v > maxLog) maxLog = v;
      if (f < kept) logs[m * N_FRAMES + f] = v;
    }
  }
  const floor = maxLog - 8;
  for (let i = 0; i < logs.length; i++) logs[i] = (Math.max(logs[i], floor) + 4) / 4;
  return { mel: logs, contentFrames: Math.floor(L / HOP), maxLog, power, powerFrames };
}

/**
 * Whisper reads audio through ffmpeg as 16-bit PCM (whisper.audio.load_audio: s16le, then / 32768). Rounding a
 * float signal the same way keeps the model's input on that grid.
 */
export function toPcm16Grid(x: Float32Array) {
  const out = new Float32Array(x.length);
  for (let i = 0; i < x.length; i++) out[i] = Math.max(-32768, Math.min(32767, Math.round(x[i] * 32768))) / 32768;
  return out;
}
