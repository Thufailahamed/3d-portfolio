/**
 * Whisper's text decoder and the decoding rules of whisper/decoding.py: SuppressBlank, SuppressTokens,
 * ApplyTimestampRules, greedy or temperature sampling, avg_logprob, and the <|nospeech|> probability.
 *
 * The rules run on any TextModel. `Decoder` below is the CPU one, one token at a time with a key/value cache,
 * which scripts/voice/check.mjs verifies against an fp32 reference; the page runs the same network on the GPU
 * (gl.ts). Work is written as generators that yield between layers, so a caller can spread it over frames.
 */
import type { Tokenizer } from "./tokenizer";
import { gelu, need, type Dims, type F32, type Q8, type Weights } from "./weights";

/** an int8 matrix [O × I] in blocks of 32 along each row, one scale per block */
type Lin = { q: Int8Array; s: Float32Array; b: Float32Array | null; O: number; I: number };
type Norm = { g: Float32Array; b: Float32Array };
type Layer = { attnLn: Norm; q: Lin; k: Lin; v: Lin; o: Lin; crossLn: Norm; cq: Lin; ck: Lin; cv: Lin; co: Lin; mlpLn: Norm; fc1: Lin; fc2: Lin };

/** cross-attention keys and values, per decoder layer, [n_audio_ctx × d] row-major */
export type Cross = { k: Float32Array[]; v: Float32Array[] };

/** what decoding needs from a decoder: one token at a time, against audio it was given beforehand */
export interface TextModel {
  readonly dims: Dims;
  /**
   * Token `token` at position `pos` (positions below it must already have run). Fills `logits` when given
   * (its first logits.length entries), and returns each alignment head's cross-attention logits q·k / √64
   * over the audio frames, in the order of the heads the model was built with.
   */
  forward(token: number, pos: number, logits: Float32Array | null): Generator<void, Float32Array[]>;
}

/** y = W x + b with W int8 in blocks: y_o = Σ_b s_ob Σ_{i ∈ b} q_oi x_i + b_o, rows [o0, o1) */
function matvec(L: Lin, x: Float32Array, y: Float32Array, o0 = 0, o1 = L.O) {
  const { q, s, b, I } = L;
  for (let o = o0; o < o1; o++) {
    const base = o * I;
    let acc = 0;
    for (let i = 0; i < I; i += 32) {
      let a0 = 0;
      let a1 = 0;
      let a2 = 0;
      let a3 = 0;
      for (let k = i; k < i + 32; k += 4) {
        a0 += q[base + k] * x[k];
        a1 += q[base + k + 1] * x[k + 1];
        a2 += q[base + k + 2] * x[k + 2];
        a3 += q[base + k + 3] * x[k + 3];
      }
      acc += (a0 + a1 + a2 + a3) * s[(base + i) >> 5];
    }
    y[o] = acc + (b ? b[o] : 0);
  }
}

function layerNorm(x: Float32Array, n: Norm, y: Float32Array) {
  const d = x.length;
  let m = 0;
  for (let i = 0; i < d; i++) m += x[i];
  m /= d;
  let v = 0;
  for (let i = 0; i < d; i++) v += (x[i] - m) ** 2;
  const r = 1 / Math.sqrt(v / d + 1e-5);
  for (let i = 0; i < d; i++) y[i] = (x[i] - m) * r * n.g[i] + n.b[i];
}

export class Decoder implements TextModel {
  readonly dims: Dims;
  readonly d: number;
  readonly heads: number;
  readonly hd: number;
  readonly alignment: [number, number][];
  private layers: Layer[];
  private emb: Q8;
  private pos: Float32Array;
  private ln: Norm;
  private kc: Float32Array[];
  private vc: Float32Array[];
  private cross: Cross | null = null;
  private nAudio = 0;
  // scratch
  private x: Float32Array;
  private h: Float32Array;
  private q: Float32Array;
  private kk: Float32Array;
  private vv: Float32Array;
  private att: Float32Array;
  private tmp: Float32Array;
  private mlp: Float32Array;
  private sc: Float32Array;

  constructor(w: Weights, dims: Dims, alignment: [number, number][]) {
    this.dims = dims;
    this.alignment = alignment;
    const d = (this.d = dims.n_text_state);
    this.heads = dims.n_text_head;
    this.hd = d / this.heads;
    const lin = (name: string, bias = true): Lin => {
      const t = need(w, `${name}.weight`) as Q8;
      if (t.block !== 32) throw new Error(`${name}: expected int8 blocks of 32`);
      const b = bias ? (need(w, `${name}.bias`) as F32).data : null;
      return { q: t.q, s: t.scale, b, O: t.shape[0], I: t.shape[1] };
    };
    const norm = (name: string): Norm => ({ g: (need(w, `${name}.weight`) as F32).data, b: (need(w, `${name}.bias`) as F32).data });
    this.layers = Array.from({ length: dims.n_text_layer }, (_, l) => {
      const p = `decoder.blocks.${l}`;
      return {
        attnLn: norm(`${p}.attn_ln`),
        q: lin(`${p}.attn.query`),
        k: lin(`${p}.attn.key`, false),
        v: lin(`${p}.attn.value`),
        o: lin(`${p}.attn.out`),
        crossLn: norm(`${p}.cross_attn_ln`),
        cq: lin(`${p}.cross_attn.query`),
        ck: lin(`${p}.cross_attn.key`, false),
        cv: lin(`${p}.cross_attn.value`),
        co: lin(`${p}.cross_attn.out`),
        mlpLn: norm(`${p}.mlp_ln`),
        fc1: lin(`${p}.mlp.0`),
        fc2: lin(`${p}.mlp.2`),
      };
    });
    this.emb = need(w, "decoder.token_embedding.weight") as Q8;
    this.pos = (need(w, "decoder.positional_embedding") as F32).data;
    this.ln = norm("decoder.ln");
    const ctx = dims.n_text_ctx;
    this.kc = this.layers.map(() => new Float32Array(ctx * d));
    this.vc = this.layers.map(() => new Float32Array(ctx * d));
    this.x = new Float32Array(d);
    this.h = new Float32Array(d);
    this.q = new Float32Array(d);
    this.kk = new Float32Array(d);
    this.vv = new Float32Array(d);
    this.att = new Float32Array(d);
    this.tmp = new Float32Array(d);
    this.mlp = new Float32Array(4 * d);
    this.sc = new Float32Array(Math.max(ctx, dims.n_audio_ctx));
  }

  /** the cross-attention projections of the encoder output, computed on the CPU (the GPU encoder does this itself) */
  crossFrom(xa: Float32Array): Cross {
    const d = this.d;
    const T = xa.length / d;
    const k: Float32Array[] = [];
    const v: Float32Array[] = [];
    const row = new Float32Array(d);
    const out = new Float32Array(d);
    for (const L of this.layers) {
      const K = new Float32Array(T * d);
      const V = new Float32Array(T * d);
      for (let t = 0; t < T; t++) {
        row.set(xa.subarray(t * d, (t + 1) * d));
        matvec(L.ck, row, out);
        K.set(out, t * d);
        matvec(L.cv, row, out);
        V.set(out, t * d);
      }
      k.push(K);
      v.push(V);
    }
    return { k, v };
  }

  setAudio(cross: Cross) {
    this.cross = cross;
    this.nAudio = cross.k[0].length / this.d;
  }

  *forward(token: number, pos: number, logits: Float32Array | null): Generator<void, Float32Array[]> {
    const qk = this.alignment.map(() => new Float32Array(this.nAudio));
    const hidden = yield* this.step(token, pos, (l, h, row) => {
      const k = this.alignment.findIndex(([a, b]) => a === l && b === h);
      if (k >= 0) qk[k].set(row);
    });
    if (logits) yield* this.logits(hidden, logits, logits.length);
    return qk;
  }

  /**
   * One token at position `pos` through the four blocks; yields after each. Returns the final layer-normed hidden
   * state. `onCross(l, h, qk)` receives the scaled cross-attention logits q·k/√64 over all audio frames.
   */
  *step(token: number, pos: number, onCross?: (l: number, h: number, qk: Float32Array) => void): Generator<void, Float32Array> {
    const { d, heads, hd } = this;
    const { x, h, q, kk, vv, att, tmp, mlp, sc } = this;
    const scale = 1 / Math.sqrt(hd);
    const e = token * d;
    for (let i = 0; i < d; i++) x[i] = this.emb.q[e + i] * this.emb.scale[(e + i) >> 5] + this.pos[pos * d + i];
    for (let l = 0; l < this.layers.length; l++) {
      const L = this.layers[l];
      // masked self-attention over positions 0 … pos, through the cache
      layerNorm(x, L.attnLn, h);
      matvec(L.q, h, q);
      matvec(L.k, h, kk);
      matvec(L.v, h, vv);
      const K = this.kc[l];
      const V = this.vc[l];
      K.set(kk, pos * d);
      V.set(vv, pos * d);
      for (let hh = 0; hh < heads; hh++) {
        const o = hh * hd;
        let mx = -Infinity;
        for (let j = 0; j <= pos; j++) {
          let s = 0;
          for (let i = 0; i < hd; i++) s += q[o + i] * K[j * d + o + i];
          sc[j] = s * scale;
          if (sc[j] > mx) mx = sc[j];
        }
        let sum = 0;
        for (let j = 0; j <= pos; j++) sum += sc[j] = Math.exp(sc[j] - mx);
        for (let i = 0; i < hd; i++) att[o + i] = 0;
        for (let j = 0; j <= pos; j++) {
          const p = sc[j] / sum;
          for (let i = 0; i < hd; i++) att[o + i] += p * V[j * d + o + i];
        }
      }
      matvec(L.o, att, tmp);
      for (let i = 0; i < d; i++) x[i] += tmp[i];

      // cross-attention over the 1500 audio frames
      layerNorm(x, L.crossLn, h);
      matvec(L.cq, h, q);
      const CK = this.cross!.k[l];
      const CV = this.cross!.v[l];
      const T = this.nAudio;
      for (let hh = 0; hh < heads; hh++) {
        const o = hh * hd;
        let mx = -Infinity;
        for (let j = 0; j < T; j++) {
          let s = 0;
          const b = j * d + o;
          for (let i = 0; i < hd; i++) s += q[o + i] * CK[b + i];
          sc[j] = s * scale;
          if (sc[j] > mx) mx = sc[j];
        }
        onCross?.(l, hh, sc.subarray(0, T));
        let sum = 0;
        for (let j = 0; j < T; j++) sum += sc[j] = Math.exp(sc[j] - mx);
        for (let i = 0; i < hd; i++) att[o + i] = 0;
        for (let j = 0; j < T; j++) {
          const p = sc[j] / sum;
          if (p < 1e-9) continue;
          const b = j * d + o;
          for (let i = 0; i < hd; i++) att[o + i] += p * CV[b + i];
        }
      }
      matvec(L.co, att, tmp);
      for (let i = 0; i < d; i++) x[i] += tmp[i];

      // MLP, exact GELU
      layerNorm(x, L.mlpLn, h);
      matvec(L.fc1, h, mlp);
      for (let i = 0; i < mlp.length; i++) mlp[i] = gelu(mlp[i]);
      matvec(L.fc2, mlp, tmp);
      for (let i = 0; i < d; i++) x[i] += tmp[i];
      yield;
    }
    const out = new Float32Array(d);
    layerNorm(x, this.ln, out);
    return out;
  }

  /** logits = h · Eᵀ (the output projection is the token embedding, transposed), rows [0, n) */
  *logits(hidden: Float32Array, out: Float32Array, n = this.emb.shape[0], chunk = 6000): Generator<void, Float32Array> {
    const E: Lin = { q: this.emb.q, s: this.emb.scale, b: null, O: this.emb.shape[0], I: this.d };
    for (let o = 0; o < n; o += chunk) {
      matvec(E, hidden, out, o, Math.min(n, o + chunk));
      yield;
    }
    return out;
  }
}

/** drive a generator to completion synchronously */
export function run<T>(g: Generator<unknown, T>): T {
  for (;;) {
    const r = g.next();
    if (r.done) return r.value;
  }
}

// ── decoding rules ──────────────────────────────────────────────────────────────────────────────────────

export type DecodeConfig = {
  suppress: number[];
  blank: number[];
};

export type DecodeOptions = {
  temperature: number;
  timestamps: boolean;
  /** max_initial_timestamp = 1.0 s → index 50 */
  maxInitialTimestamp: number;
  sampleLen: number;
  seed: number;
  topK: number;
};

export const DEFAULT_OPTIONS: DecodeOptions = { temperature: 0, timestamps: true, maxInitialTimestamp: 1, sampleLen: 224, seed: 1, topK: 6 };

export type StepRecord = {
  /** position in the decoder's context */
  pos: number;
  token: number;
  /** log p(token) under the filtered distribution (what avg_logprob sums) */
  logprob: number;
  /** the filtered distribution's most likely tokens, at T = 1 */
  top: [number, number][];
  /** probability mass the filtered distribution puts on timestamp tokens */
  timeMass: number;
  /** cross-attention over audio frames, softmaxed and averaged over the alignment heads */
  attn: Float32Array;
};

export type Attempt = {
  temperature: number;
  initial: number[];
  /** sampled tokens up to, not including, <|endoftext|> */
  tokens: number[];
  steps: StepRecord[];
  sumLogprob: number;
  avgLogprob: number;
  noSpeechProb: number;
  text: string;
  done: boolean;
};

/** a small seeded generator for temperature sampling */
export function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function logSumExp(x: Float32Array, a = 0, b = x.length) {
  let mx = -Infinity;
  for (let i = a; i < b; i++) if (x[i] > mx) mx = x[i];
  if (mx === -Infinity) return -Infinity;
  let s = 0;
  for (let i = a; i < b; i++) s += Math.exp(x[i] - mx);
  return mx + Math.log(s);
}

/** decoding.py's logit filters, in their order: SuppressBlank, SuppressTokens, ApplyTimestampRules */
export function applyFilters(logits: Float32Array, tokens: number[], sampleBegin: number, tok: Tokenizer, cfg: DecodeConfig, opts: DecodeOptions) {
  const { eot, noTimestamps, timestampBegin: tb } = tok.sp;
  const V = logits.length;
  if (tokens.length === sampleBegin) for (const id of cfg.blank) logits[id] = -Infinity;
  for (const id of cfg.suppress) logits[id] = -Infinity;
  if (!opts.timestamps) return;
  logits[noTimestamps] = -Infinity;
  const seq = tokens.slice(sampleBegin);
  const last = seq.length >= 1 && seq[seq.length - 1] >= tb;
  const penult = seq.length < 2 || seq[seq.length - 2] >= tb;
  // timestamps come in pairs, except directly before <|endoftext|>
  if (last) {
    if (penult) logits.fill(-Infinity, tb, V);
    else logits.fill(-Infinity, 0, eot);
  }
  const stamps = seq.filter((t) => t >= tb);
  if (stamps.length) {
    // they never go back in time, and a segment can't be empty
    const lastStamp = last && !penult ? stamps[stamps.length - 1] : stamps[stamps.length - 1] + 1;
    logits.fill(-Infinity, tb, lastStamp);
  }
  if (tokens.length === sampleBegin) {
    logits.fill(-Infinity, 0, tb);
    const idx = Math.round(opts.maxInitialTimestamp / 0.02);
    logits.fill(-Infinity, tb + idx + 1, V);
  }
  // if all timestamps together outweigh the best text token, it has to be a timestamp
  const lse = logSumExp(logits);
  const tsLog = logSumExp(logits, tb, V) - lse;
  let best = -Infinity;
  for (let i = 0; i < tb; i++) if (logits[i] > best) best = logits[i];
  if (tsLog > best - lse) logits.fill(-Infinity, 0, tb);
}

function topK(logits: Float32Array, k: number, lse: number): [number, number][] {
  const out: [number, number][] = [];
  for (let i = 0; i < logits.length; i++) {
    const v = logits[i];
    if (v === -Infinity) continue;
    if (out.length < k || v > out[out.length - 1][1]) {
      out.push([i, v]);
      out.sort((a, b) => b[1] - a[1]);
      if (out.length > k) out.pop();
    }
  }
  return out.map(([i, v]) => [i, Math.exp(v - lse)]);
}

/** softmax over audio frames, averaged over the alignment heads: where the decoder is listening */
function listening(qk: Float32Array[]) {
  const out = new Float32Array(qk[0]?.length ?? 0);
  for (const row of qk) {
    let mx = -Infinity;
    for (const v of row) if (v > mx) mx = v;
    let s = 0;
    for (const v of row) s += Math.exp(v - mx);
    for (let j = 0; j < row.length; j++) out[j] += Math.exp(row[j] - mx) / s / qk.length;
  }
  return out;
}

/**
 * One decoding attempt at one temperature (DecodingTask.run with GreedyDecoder): run the initial tokens,
 * read p(<|nospeech|>) at <|startoftranscript|>, then sample until <|endoftext|> or sample_len.
 * `progress` is filled as it goes, so the scene can show tokens while later ones are still being computed.
 */
export function* decodeAttempt(model: TextModel, tok: Tokenizer, cfg: DecodeConfig, opts: DecodeOptions, progress: Attempt): Generator<void, Attempt> {
  const sp = tok.sp;
  const V = model.dims.n_vocab;
  const initial = opts.timestamps ? [sp.sot] : [sp.sot, sp.noTimestamps];
  const sotIndex = 0;
  const rand = mulberry32(opts.seed);
  const tokens = [...initial];
  const logits = new Float32Array(V);
  Object.assign(progress, { temperature: opts.temperature, initial, tokens: [], steps: [], sumLogprob: 0, avgLogprob: 0, noSpeechProb: NaN, text: "", done: false });

  // the prompt: <|startoftranscript|> (and <|notimestamps|>); logits are needed at the sot and the last position
  let qk: Float32Array[] = [];
  for (let p = 0; p < initial.length; p++) {
    qk = yield* model.forward(initial[p], p, p === sotIndex || p === initial.length - 1 ? logits : null);
    if (p === sotIndex) progress.noSpeechProb = Math.exp(logits[sp.noSpeech] - logSumExp(logits));
  }

  let sum = 0;
  for (let i = 0; i < opts.sampleLen; i++) {
    const attn = listening(qk);
    applyFilters(logits, tokens, initial.length, tok, cfg, opts);
    const lse = logSumExp(logits);
    let next = 0;
    let best = -Infinity;
    for (let v = 0; v < V; v++)
      if (logits[v] > best) {
        best = logits[v];
        next = v;
      }
    if (opts.temperature > 0) {
      // Categorical(logits / T).sample(); the argmax stands in only if rounding leaves r > 0
      const T = opts.temperature;
      let z = 0;
      for (let v = 0; v < V; v++) z += Math.exp((logits[v] - best) / T);
      let r = rand() * z;
      for (let v = 0; v < V; v++) {
        r -= Math.exp((logits[v] - best) / T);
        if (r <= 0) {
          next = v;
          break;
        }
      }
    }
    const logprob = logits[next] - lse;
    sum += logprob;
    const timeMass = Math.exp(logSumExp(logits, sp.timestampBegin, V) - lse);
    progress.steps.push({ pos: tokens.length - 1, token: next, logprob, top: topK(logits, opts.topK, lse), timeMass, attn });
    tokens.push(next);
    progress.sumLogprob = sum;
    if (next === sp.eot) break;
    progress.tokens.push(next);
    progress.text = tok.decode(progress.tokens).trim();
    if (tokens.length > model.dims.n_text_ctx) break;
    qk = yield* model.forward(next, tokens.length - 1, logits);
  }
  progress.avgLogprob = sum / (progress.tokens.length + 1);
  progress.text = tok.decode(progress.tokens).trim();
  progress.done = true;
  return progress;
}

export type Segment = { start: number; end: number; tokens: number[]; text: string };

/** transcribe.py's segmentation of one window's tokens by its timestamp pairs (time_offset = 0) */
export function segmentsOf(tokens: number[], tok: Tokenizer, duration: number): Segment[] {
  const tb = tok.sp.timestampBegin;
  const isTs = tokens.map((t) => t >= tb);
  const single = isTs.length >= 2 && !isTs[isTs.length - 2] && isTs[isTs.length - 1];
  const consecutive: number[] = [];
  for (let i = 1; i < tokens.length; i++) if (isTs[i - 1] && isTs[i]) consecutive.push(i);
  const seg = (ts: number[]): Segment => ({ start: tok.seconds(ts[0]), end: tok.seconds(ts[ts.length - 1]), tokens: ts, text: tok.decode(ts).trim() });
  if (consecutive.length) {
    const slices = [...consecutive];
    if (single) slices.push(tokens.length);
    const out: Segment[] = [];
    let last = 0;
    for (const cur of slices) {
      out.push(seg(tokens.slice(last, cur)));
      last = cur;
    }
    return out;
  }
  const stamps = tokens.filter((t) => t >= tb);
  let end = duration;
  if (stamps.length && stamps[stamps.length - 1] !== tb) end = tok.seconds(stamps[stamps.length - 1]);
  return [{ start: 0, end, tokens, text: tok.decode(tokens).trim() }];
}
