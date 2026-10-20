/**
 * The weight file scripts/voice/build.mjs writes from OpenAI's tiny.en checkpoint. The encoder is stored at the
 * checkpoint's own fp16, exactly. The decoder's matrices, the 51 864 × 384 token embedding among them, are int8
 * in blocks of 32 consecutive weights with one float32 scale each, w ≈ s_b · q with s_b = max_b |w| / 127
 * (whisper.cpp's q8_0 layout); vectors stay fp16.
 * No imports.
 */

export type Dims = {
  n_mels: number;
  n_audio_ctx: number;
  n_audio_state: number;
  n_audio_head: number;
  n_audio_layer: number;
  n_vocab: number;
  n_text_ctx: number;
  n_text_state: number;
  n_text_head: number;
  n_text_layer: number;
};

export type Entry = { name: string; shape: number[]; dtype: "q8" | "f16"; offset: number; block?: number; scales?: number };

export type Manifest = {
  model: string;
  source: string;
  sha256: string;
  file: string;
  bytes: number;
  dims: Dims;
  /** learned parameters (the encoder's sinusoids are a buffer, not counted) */
  params: number;
  tensors: Entry[];
  /** (layer, head) pairs of cross-attention that track time, from whisper/__init__.py */
  alignmentHeads: [number, number][];
  /** decoding.py's default suppress_tokens ("-1" → non_speech_tokens, plus the task specials) */
  suppress: number[];
  /** SuppressBlank: encode(" ") + [eot], masked at the first sampled position */
  blank: number[];
  /** largest |Δ| the int8 blocks introduce, relative to the block's max, measured at build time */
  quantError: number;
};

/** int8 weights; scale[b] covers q[b·block … (b+1)·block) */
export type Q8 = { kind: "q8"; shape: number[]; q: Int8Array; scale: Float32Array; block: number };
export type F32 = { kind: "f32"; shape: number[]; data: Float32Array };
export type Tensor = Q8 | F32;
export type Weights = Map<string, Tensor>;

/** IEEE half → float */
export function halfToFloat(h: number) {
  const s = h & 0x8000 ? -1 : 1;
  const e = (h >> 10) & 0x1f;
  const f = h & 0x3ff;
  if (e === 0) return s * 2 ** -14 * (f / 1024);
  if (e === 31) return f ? NaN : s * Infinity;
  return s * 2 ** (e - 15) * (1 + f / 1024);
}

let halfTable: Float32Array | null = null;

export function readWeights(m: Manifest, buf: ArrayBuffer): Weights {
  // all 65 536 halves once, so 8 M of them convert at a table lookup each
  if (!halfTable) {
    halfTable = new Float32Array(65536);
    for (let h = 0; h < 65536; h++) halfTable[h] = halfToFloat(h);
  }
  const lut = halfTable;
  const out: Weights = new Map();
  for (const t of m.tensors) {
    const n = t.shape.reduce((a, b) => a * b, 1);
    if (t.dtype === "q8") {
      const block = t.block ?? n / t.shape[0];
      out.set(t.name, { kind: "q8", shape: t.shape, q: new Int8Array(buf, t.offset, n), scale: new Float32Array(buf, t.scales!, n / block), block });
    } else {
      const h = new Uint16Array(buf, t.offset, n);
      const data = new Float32Array(n);
      for (let i = 0; i < n; i++) data[i] = lut[h[i]];
      out.set(t.name, { kind: "f32", shape: t.shape, data });
    }
  }
  return out;
}

/** a tensor as plain float32, for the GPU */
export function dequantize(t: Tensor) {
  if (t.kind === "f32") return t.data;
  const out = new Float32Array(t.q.length);
  for (let i = 0; i < out.length; i++) out[i] = t.q[i] * t.scale[(i / t.block) | 0];
  return out;
}

export function need(w: Weights, name: string) {
  const t = w.get(name);
  if (!t) throw new Error(`missing weight ${name}`);
  return t;
}

/** Whisper's encoder positions: sin over the first half of the channels, cos over the second (model.sinusoids) */
export function sinusoids(length: number, channels: number, maxTimescale = 10000) {
  const half = channels / 2;
  const inc = Math.log(maxTimescale) / (half - 1);
  const out = new Float32Array(length * channels);
  for (let t = 0; t < length; t++)
    for (let i = 0; i < half; i++) {
      const a = t * Math.exp(-inc * i);
      out[t * channels + i] = Math.sin(a);
      out[t * channels + half + i] = Math.cos(a);
    }
  return out;
}

/**
 * erf, Abramowitz & Stegun 7.1.26 (|error| < 1.5 × 10⁻⁷): Whisper's GELU is the exact one, x · Φ(x),
 * not the tanh approximation. The encoder shaders use the same polynomial.
 */
export function erf(x: number) {
  const s = x < 0 ? -1 : 1;
  const a = Math.abs(x);
  const t = 1 / (1 + 0.3275911 * a);
  const y = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-a * a);
  return s * y;
}

export const gelu = (x: number) => 0.5 * x * (1 + erf(x * Math.SQRT1_2));
