/**
 * OpenAI CLIP's byte-level BPE tokenizer (clip/simple_tokenizer.py), the one Stable Diffusion 1.x uses.
 * ftfy's text repair is skipped: the prompts here are plain ASCII.
 */
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";

function bytesToUnicode() {
  const bs = [];
  for (let b = 33; b <= 126; b++) bs.push(b);
  for (let b = 161; b <= 172; b++) bs.push(b);
  for (let b = 174; b <= 255; b++) bs.push(b);
  const cs = [...bs];
  let n = 0;
  for (let b = 0; b < 256; b++)
    if (!bs.includes(b)) {
      bs.push(b);
      cs.push(256 + n++);
    }
  return new Map(bs.map((b, i) => [b, String.fromCodePoint(cs[i])]));
}

const PAT = /<\|startoftext\|>|<\|endoftext\|>|'s|'t|'re|'ve|'m|'ll|'d|[\p{L}]+|[\p{N}]|[^\s\p{L}\p{N}]+/giu;

export const BOS = 49406;
export const EOS = 49407;
export const CONTEXT = 77;

export function loadTokenizer(bpePath) {
  const byteEncoder = bytesToUnicode();
  const merges = gunzipSync(readFileSync(bpePath))
    .toString("utf8")
    .split("\n")
    .slice(1, 49152 - 256 - 2 + 1)
    .map((m) => m.split(" "));
  const base = [...byteEncoder.values()];
  const vocab = [...base, ...base.map((v) => v + "</w>"), ...merges.map((m) => m.join("")), "<|startoftext|>", "<|endoftext|>"];
  const encoder = new Map(vocab.map((v, i) => [v, i]));
  const ranks = new Map(merges.map((m, i) => [m.join(" "), i]));

  const bpe = (token) => {
    let word = [...token.slice(0, -1), token.at(-1) + "</w>"];
    if (word.length === 1) return word;
    for (;;) {
      let best = null;
      let bestRank = Infinity;
      for (let i = 0; i < word.length - 1; i++) {
        const r = ranks.get(word[i] + " " + word[i + 1]);
        if (r !== undefined && r < bestRank) {
          bestRank = r;
          best = [word[i], word[i + 1]];
        }
      }
      if (!best) return word;
      const next = [];
      for (let i = 0; i < word.length; ) {
        if (i < word.length - 1 && word[i] === best[0] && word[i + 1] === best[1]) {
          next.push(best[0] + best[1]);
          i += 2;
        } else next.push(word[i++]);
      }
      word = next;
      if (word.length === 1) return word;
    }
  };

  /** the BPE pieces of a prompt, with their ids — no BOS / EOS */
  const encode = (text) => {
    const clean = text.replace(/\s+/g, " ").trim().toLowerCase();
    const out = [];
    for (const m of clean.matchAll(PAT)) {
      const token = [...Buffer.from(m[0], "utf8")].map((b) => byteEncoder.get(b)).join("");
      for (const piece of bpe(token)) out.push({ piece, id: encoder.get(piece) });
    }
    return out;
  };
  return { encode, size: vocab.length };
}
