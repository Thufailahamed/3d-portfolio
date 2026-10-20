/**
 * A plain float32 Whisper written straight from whisper/model.py and whisper/audio.py, sharing no code with
 * src/voice: a direct DFT instead of the FFT, OpenAI's own mel_filters.npz, a series erf, attention over the
 * whole sequence instead of a cache. check.mjs measures the page's code against it.
 */
import { readFileSync } from "node:fs";
import { unzip } from "../diffusion/torch.mjs";

/** numpy .npz → name → { shape, data } (float32, C order) */
export function readNpz(path) {
  const out = new Map();
  for (const [name, buf] of unzip(readFileSync(path))) {
    const hl = buf.readUInt16LE(8);
    const header = buf.toString("latin1", 10, 10 + hl);
    if (!header.includes("'<f4'") || header.includes("'fortran_order': True")) throw new Error(`${name}: ${header}`);
    const shape = header.match(/\(([^)]*)\)/)[1].split(",").filter((s) => s.trim()).map(Number);
    const raw = buf.subarray(10 + hl);
    out.set(name.replace(/\.npy$/, ""), { shape, data: new Float32Array(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength)) });
  }
  return out;
}

/** erf by its Maclaurin series near 0 and a continued fraction for erfc further out (double precision) */
function erf(x) {
  const a = Math.abs(x);
  if (a < 2.5) {
    let term = a;
    let sum = a;
    for (let n = 1; n < 80; n++) {
      term *= (-a * a) / n;
      const t = term / (2 * n + 1);
      sum += t;
      if (Math.abs(t) < 1e-17) break;
    }
    return Math.sign(x) * (2 / Math.sqrt(Math.PI)) * sum;
  }
  // erfc(a) = exp(−a²)/√π · 1/(a + 1/2/(a + 1/(a + 3/2/(a + …))))
  let f = a;
  for (let k = 60; k >= 1; k--) f = a + k / 2 / f;
  return Math.sign(x) * (1 - Math.exp(-a * a) / Math.sqrt(Math.PI) / f);
}
const gelu = (x) => 0.5 * x * (1 + erf(x / Math.SQRT2));

export function logMelRef(audio, filters) {
  const N = 400;
  const H = 160;
  const Lp = audio.length + 480000;
  const at = (j) => {
    if (j < 0) j = -j;
    else if (j >= Lp) j = 2 * (Lp - 1) - j;
    return j < audio.length ? audio[j] : 0;
  };
  const win = Array.from({ length: N }, (_, n) => 0.5 - 0.5 * Math.cos((2 * Math.PI * n) / N));
  const frames = Math.floor(Lp / H);
  const out = new Float64Array(80 * 3000).fill(-10);
  let max = -10;
  const cos = Array.from({ length: N }, (_, k) => Math.cos((2 * Math.PI * k) / N));
  const sin = Array.from({ length: N }, (_, k) => Math.sin((2 * Math.PI * k) / N));
  const x = new Float64Array(N);
  const p = new Float64Array(201);
  const used = Math.min(frames, Math.ceil((audio.length + 200) / H) + 1);
  for (let f = 0; f < used; f++) {
    let any = false;
    for (let n = 0; n < N; n++) {
      x[n] = at(f * H - 200 + n) * win[n];
      if (x[n]) any = true;
    }
    for (let k = 0; k <= 200; k++) {
      if (!any) {
        p[k] = 0;
        continue;
      }
      let re = 0;
      let im = 0;
      for (let n = 0; n < N; n++) {
        const e = (k * n) % N;
        re += x[n] * cos[e];
        im -= x[n] * sin[e];
      }
      p[k] = re * re + im * im;
    }
    for (let m = 0; m < 80; m++) {
      let s = 0;
      for (let k = 0; k <= 200; k++) s += filters[m * 201 + k] * p[k];
      const v = Math.log10(Math.max(s, 1e-10));
      max = Math.max(max, v);
      if (f < 3000) out[m * 3000 + f] = v;
    }
  }
  return Float32Array.from(out, (v) => (Math.max(v, max - 8) + 4) / 4);
}

function linear(X, T, I, W, O, b) {
  const Y = new Float32Array(T * O);
  for (let t = 0; t < T; t++) {
    const xo = t * I;
    for (let o = 0; o < O; o++) {
      const wo = o * I;
      let acc = 0;
      for (let i = 0; i < I; i++) acc += X[xo + i] * W[wo + i];
      Y[t * O + o] = acc + (b ? b[o] : 0);
    }
  }
  return Y;
}

function layerNorm(X, T, D, g, b) {
  const Y = new Float32Array(T * D);
  for (let t = 0; t < T; t++) {
    let m = 0;
    for (let i = 0; i < D; i++) m += X[t * D + i];
    m /= D;
    let v = 0;
    for (let i = 0; i < D; i++) v += (X[t * D + i] - m) ** 2;
    const r = 1 / Math.sqrt(v / D + 1e-5);
    for (let i = 0; i < D; i++) Y[t * D + i] = (X[t * D + i] - m) * r * g[i] + b[i];
  }
  return Y;
}

/** softmax(q kᵀ / √d_h + mask) v per head; q [Tq × D], k, v [Tk × D] */
function attention(q, k, v, Tq, Tk, D, heads, causal, onQk) {
  const hd = D / heads;
  const out = new Float32Array(Tq * D);
  const s = new Float64Array(Tk);
  for (let h = 0; h < heads; h++) {
    const o = h * hd;
    for (let i = 0; i < Tq; i++) {
      let mx = -Infinity;
      for (let j = 0; j < Tk; j++) {
        if (causal && j > i) {
          s[j] = -Infinity;
          continue;
        }
        let acc = 0;
        for (let c = 0; c < hd; c++) acc += q[i * D + o + c] * k[j * D + o + c];
        s[j] = acc / Math.sqrt(hd);
        mx = Math.max(mx, s[j]);
      }
      onQk?.(h, i, s);
      let sum = 0;
      for (let j = 0; j < Tk; j++) sum += s[j] = Math.exp(s[j] - mx);
      for (let j = 0; j < Tk; j++) {
        const p = s[j] / sum;
        if (!p) continue;
        for (let c = 0; c < hd; c++) out[i * D + o + c] += p * v[j * D + o + c];
      }
    }
  }
  return out;
}

const add = (a, b) => {
  for (let i = 0; i < a.length; i++) a[i] += b[i];
  return a;
};

export class Reference {
  constructor(sd, dims) {
    this.sd = sd;
    this.dims = dims;
  }
  w(name) {
    const t = this.sd.get(name);
    if (!t) throw new Error(`missing ${name}`);
    return t.data;
  }

  /** conv1d(k = 3, padding 1) on x [T × C] (time-major), output [T / stride × O] */
  conv(x, T, C, name, stride) {
    const W = this.w(`${name}.weight`);
    const b = this.w(`${name}.bias`);
    const O = b.length;
    const To = Math.ceil(T / stride);
    const y = new Float32Array(To * O);
    for (let t = 0; t < To; t++)
      for (let o = 0; o < O; o++) {
        let acc = b[o];
        for (let kk = 0; kk < 3; kk++) {
          const ti = t * stride + kk - 1;
          if (ti < 0 || ti >= T) continue;
          for (let c = 0; c < C; c++) acc += W[(o * C + c) * 3 + kk] * x[ti * C + c];
        }
        y[t * O + o] = gelu(acc);
      }
    return { y, T: To, C: O };
  }

  block(x, T, D, p, heads, opts = {}) {
    const h = layerNorm(x, T, D, this.w(`${p}.attn_ln.weight`), this.w(`${p}.attn_ln.bias`));
    const q = linear(h, T, D, this.w(`${p}.attn.query.weight`), D, this.w(`${p}.attn.query.bias`));
    const k = linear(h, T, D, this.w(`${p}.attn.key.weight`), D, null);
    const v = linear(h, T, D, this.w(`${p}.attn.value.weight`), D, this.w(`${p}.attn.value.bias`));
    const a = attention(q, k, v, T, T, D, heads, !!opts.causal);
    add(x, linear(a, T, D, this.w(`${p}.attn.out.weight`), D, this.w(`${p}.attn.out.bias`)));
    if (opts.xa) {
      const Ta = opts.xa.length / D;
      const h2 = layerNorm(x, T, D, this.w(`${p}.cross_attn_ln.weight`), this.w(`${p}.cross_attn_ln.bias`));
      const q2 = linear(h2, T, D, this.w(`${p}.cross_attn.query.weight`), D, this.w(`${p}.cross_attn.query.bias`));
      const k2 = linear(opts.xa, Ta, D, this.w(`${p}.cross_attn.key.weight`), D, null);
      const v2 = linear(opts.xa, Ta, D, this.w(`${p}.cross_attn.value.weight`), D, this.w(`${p}.cross_attn.value.bias`));
      const a2 = attention(q2, k2, v2, T, Ta, D, heads, false, opts.onCross);
      add(x, linear(a2, T, D, this.w(`${p}.cross_attn.out.weight`), D, this.w(`${p}.cross_attn.out.bias`)));
    }
    const h3 = layerNorm(x, T, D, this.w(`${p}.mlp_ln.weight`), this.w(`${p}.mlp_ln.bias`));
    const m = linear(h3, T, D, this.w(`${p}.mlp.0.weight`), 4 * D, this.w(`${p}.mlp.0.bias`)).map(gelu);
    add(x, linear(m, T, 4 * D, this.w(`${p}.mlp.2.weight`), D, this.w(`${p}.mlp.2.bias`)));
    return x;
  }

  /** AudioEncoder.forward on a [80, 3000] mel; also returns each block's output */
  encode(mel, onBlock) {
    const { n_mels: M, n_audio_state: D, n_audio_head: H } = this.dims;
    const T0 = mel.length / M;
    const xt = new Float32Array(T0 * M);
    for (let m = 0; m < M; m++) for (let t = 0; t < T0; t++) xt[t * M + m] = mel[m * T0 + t];
    let c = this.conv(xt, T0, M, "encoder.conv1", 1);
    c = this.conv(c.y, c.T, c.C, "encoder.conv2", 2);
    const T = c.T;
    const x = c.y;
    // sinusoids(1500, 384): sin then cos, log-timescale increment ln(10⁴) / (D/2 − 1)
    const inc = Math.log(10000) / (D / 2 - 1);
    for (let t = 0; t < T; t++)
      for (let i = 0; i < D / 2; i++) {
        x[t * D + i] += Math.sin(t * Math.exp(-inc * i));
        x[t * D + D / 2 + i] += Math.cos(t * Math.exp(-inc * i));
      }
    for (let l = 0; l < this.dims.n_audio_layer; l++) {
      this.block(x, T, D, `encoder.blocks.${l}`, H);
      onBlock?.(l, x);
    }
    return layerNorm(x, T, D, this.w("encoder.ln_post.weight"), this.w("encoder.ln_post.bias"));
  }

  /** TextDecoder.forward: logits [n × n_vocab] for a token sequence, with the full causal mask */
  logits(xa, tokens, onCross) {
    const { n_text_state: D, n_text_head: H, n_vocab: V } = this.dims;
    const T = tokens.length;
    const E = this.w("decoder.token_embedding.weight");
    const P = this.w("decoder.positional_embedding");
    const x = new Float32Array(T * D);
    tokens.forEach((tk, t) => {
      for (let i = 0; i < D; i++) x[t * D + i] = E[tk * D + i] + P[t * D + i];
    });
    for (let l = 0; l < this.dims.n_text_layer; l++) this.block(x, T, D, `decoder.blocks.${l}`, H, { causal: true, xa, onCross: onCross && ((h, i, s) => onCross(l, h, i, s)) });
    const h = layerNorm(x, T, D, this.w("decoder.ln.weight"), this.w("decoder.ln.bias"));
    return linear(h, T, D, E, V, null);
  }
}
