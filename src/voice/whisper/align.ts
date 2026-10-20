/**
 * Word timestamps the way whisper/timing.py finds them: feed the transcript back through the decoder with
 * <|notimestamps|>, keep the cross-attention of the heads OpenAI found to track time, normalise and
 * median-filter it, and run dynamic time warping from the first token to the last.
 */
import type { TextModel } from "./decoder";
import type { Tokenizer } from "./tokenizer";

export type Word = { word: string; tokens: number[]; start: number; end: number; probability: number };

export type Alignment = {
  words: Word[];
  /** the DTW cost matrix's input: mean over heads of the normalised attention, [rows × frames] */
  matrix: Float32Array;
  rows: number;
  frames: number;
  /** the warping path, as (row, frame) pairs */
  path: [number, number][];
};

const TOKENS_PER_SECOND = 50;

function medianFilter(x: Float32Array, width: number) {
  const half = width >> 1;
  const n = x.length;
  if (n <= half) return x;
  const out = new Float32Array(n);
  const win = new Float32Array(width);
  // reflect padding, as F.pad(mode="reflect")
  const at = (i: number) => x[i < 0 ? -i : i >= n ? 2 * (n - 1) - i : i];
  for (let i = 0; i < n; i++) {
    for (let k = 0; k < width; k++) win[k] = at(i - half + k);
    win.sort();
    out[i] = win[half];
  }
  return out;
}

/** timing.dtw_cpu + backtrace on a cost matrix [N × M] */
function dtw(x: Float32Array, N: number, M: number): [number[], number[]] {
  const cost = new Float64Array((N + 1) * (M + 1)).fill(Infinity);
  const trace = new Int8Array((N + 1) * (M + 1)).fill(-1);
  const C = (i: number, j: number) => i * (M + 1) + j;
  cost[0] = 0;
  for (let j = 1; j <= M; j++)
    for (let i = 1; i <= N; i++) {
      const c0 = cost[C(i - 1, j - 1)];
      const c1 = cost[C(i - 1, j)];
      const c2 = cost[C(i, j - 1)];
      let c: number;
      let t: number;
      if (c0 < c1 && c0 < c2) {
        c = c0;
        t = 0;
      } else if (c1 < c0 && c1 < c2) {
        c = c1;
        t = 1;
      } else {
        c = c2;
        t = 2;
      }
      cost[C(i, j)] = x[(i - 1) * M + (j - 1)] + c;
      trace[C(i, j)] = t;
    }
  for (let j = 0; j <= M; j++) trace[C(0, j)] = 2;
  for (let i = 0; i <= N; i++) trace[C(i, 0)] = 1;
  let i = N;
  let j = M;
  const ti: number[] = [];
  const tj: number[] = [];
  while (i > 0 || j > 0) {
    ti.push(i - 1);
    tj.push(j - 1);
    const t = trace[C(i, j)];
    if (t === 0) {
      i--;
      j--;
    } else if (t === 1) i--;
    else j--;
  }
  return [ti.reverse(), tj.reverse()];
}

/**
 * timing.find_alignment for one window, then merge_punctuations and the sentence-boundary clamp of
 * add_word_timestamps. `numFrames` is the window's audio length in mel frames.
 */
export function* findAlignment(model: TextModel, tok: Tokenizer, textTokens: number[], numFrames: number): Generator<void, Alignment | null> {
  if (!textTokens.length) return null;
  const sp = tok.sp;
  const sot = [sp.sot];
  const tokens = [...sot, sp.noTimestamps, ...textTokens, sp.eot];
  const frames = Math.max(1, Math.floor(numFrames / 2));
  // QK of each alignment head at each position, truncated to the audio frames
  let qk: Float32Array[] = [];
  const probs: number[] = [];
  const logits = new Float32Array(sp.eot);
  for (let p = 0; p < tokens.length; p++) {
    // logits[len(sot):, :eot] give p(text token i) at row i
    const row = p - sot.length;
    const want = row >= 0 && row < textTokens.length;
    const heads = yield* model.forward(tokens[p], p, want ? logits : null);
    if (!qk.length) qk = heads.map(() => new Float32Array(tokens.length * frames));
    heads.forEach((h, k) => qk[k].set(h.subarray(0, frames), p * frames));
    if (want) {
      let mx = -Infinity;
      for (const v of logits) if (v > mx) mx = v;
      let s = 0;
      for (const v of logits) s += Math.exp(v - mx);
      probs.push(Math.exp(logits[textTokens[row]] - mx) / s);
    }
  }

  // softmax over frames, standardise over tokens per (head, frame), median filter along frames, mean over heads
  const T = tokens.length;
  const H = qk.length;
  const mean = new Float32Array(T * frames);
  for (let k = 0; k < H; k++) {
    const w = qk[k];
    for (let p = 0; p < T; p++) {
      let mx = -Infinity;
      for (let f = 0; f < frames; f++) mx = Math.max(mx, w[p * frames + f]);
      let s = 0;
      for (let f = 0; f < frames; f++) s += w[p * frames + f] = Math.exp(w[p * frames + f] - mx);
      for (let f = 0; f < frames; f++) w[p * frames + f] /= s;
    }
    for (let f = 0; f < frames; f++) {
      let m = 0;
      for (let p = 0; p < T; p++) m += w[p * frames + f];
      m /= T;
      let v = 0;
      for (let p = 0; p < T; p++) v += (w[p * frames + f] - m) ** 2;
      const sd = Math.sqrt(v / T) || 1;
      for (let p = 0; p < T; p++) w[p * frames + f] = (w[p * frames + f] - m) / sd;
    }
    for (let p = 0; p < T; p++) {
      const r = medianFilter(w.subarray(p * frames, (p + 1) * frames), 7);
      for (let f = 0; f < frames; f++) mean[p * frames + f] += r[f] / H;
    }
    yield;
  }
  // rows from <|notimestamps|> to the last text token
  const r0 = sot.length;
  const rows = T - 1 - r0;
  const matrix = mean.slice(r0 * frames, (r0 + rows) * frames);
  const neg = matrix.map((v) => -v);
  const [ti, tj] = dtw(neg, rows, frames);

  const { words, groups } = tok.splitToWordTokens([...textTokens, sp.eot]);
  if (groups.length <= 1) return null;
  const bounds = [0];
  for (let i = 0; i < groups.length - 1; i++) bounds.push(bounds[i] + groups[i].length);
  const jumps: number[] = [];
  for (let i = 0; i < ti.length; i++) if (i === 0 || ti[i] !== ti[i - 1]) jumps.push(tj[i] / TOKENS_PER_SECOND);
  const out: Word[] = [];
  for (let i = 0; i < bounds.length - 1; i++) {
    const a = bounds[i];
    const b = bounds[i + 1];
    const p = probs.slice(a, b);
    out.push({ word: words[i], tokens: groups[i], start: jumps[a], end: jumps[b], probability: p.reduce((x, y) => x + y, 0) / Math.max(1, p.length) });
  }

  clampSentenceEnds(out);
  mergePunctuations(out, "\"'“¿([{-", "\"'.。,，!！?？:：”)]}、");
  const path = ti.map((r, i) => [r, tj[i]] as [number, number]);
  return { words: out.filter((w) => w.word), matrix, rows, frames, path };
}

/** add_word_timestamps: a word at a sentence boundary may not last more than twice the median word */
function clampSentenceEnds(words: Word[]) {
  const d = words.map((w) => w.end - w.start).filter((v) => v > 0);
  if (!d.length) return;
  const sorted = [...d].sort((a, b) => a - b);
  const median = Math.min(0.7, sorted.length % 2 ? sorted[sorted.length >> 1] : (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2);
  const max = median * 2;
  const marks = ".。!！?？";
  for (let i = 1; i < words.length; i++) {
    if (words[i].end - words[i].start > max) {
      if (marks.includes(words[i].word)) words[i].end = words[i].start + max;
      else if (marks.includes(words[i - 1].word)) words[i].start = words[i].end - max;
    }
  }
}

/** timing.merge_punctuations */
function mergePunctuations(a: Word[], prepended: string, appended: string) {
  let i = a.length - 2;
  let j = a.length - 1;
  while (i >= 0) {
    const prev = a[i];
    const next = a[j];
    if (prev.word.startsWith(" ") && prepended.includes(prev.word.trim())) {
      next.word = prev.word + next.word;
      next.tokens = [...prev.tokens, ...next.tokens];
      prev.word = "";
      prev.tokens = [];
    } else j = i;
    i--;
  }
  i = 0;
  j = 1;
  while (j < a.length) {
    const prev = a[i];
    const next = a[j];
    // `in` on Python strings is a substring test, so an emptied word "merges" too and i stays put
    if (!prev.word.endsWith(" ") && appended.includes(next.word)) {
      prev.word = prev.word + next.word;
      prev.tokens = [...prev.tokens, ...next.tokens];
      next.word = "";
      next.tokens = [];
    } else i = j;
    j++;
  }
}
