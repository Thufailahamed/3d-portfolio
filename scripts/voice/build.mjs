/**
 * Builds public/voice/ from OpenAI's original Whisper tiny.en checkpoint:
 *   whisper-tiny-en.bin   the encoder at the checkpoint's own fp16; the decoder's matrices and the token
 *                         embedding int8 in blocks of 32 with one fp32 scale each (whisper.cpp's q8_0
 *                         layout); every vector fp16
 *   manifest.json         dims, tensor table, alignment heads, suppressed tokens
 *   vocab.txt             the 50 256 GPT-2 byte-level pieces, one per line, by rank
 *   samples/jfk.wav       the test clip
 *
 *   node scripts/voice/build.mjs <folder with tiny.en.pt, gpt2.tiktoken, jfk.wav>
 */
import { createHash } from "node:crypto";
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";
import { loadStateDict } from "../diffusion/torch.mjs";
import { load } from "./ts.mjs";

const SRC = process.argv[2];
if (!SRC) throw new Error("usage: node scripts/voice/build.mjs <assets folder>");
const OUT = "public/voice";
const MODEL_URL = "https://openaipublic.azureedge.net/main/whisper/models/d3dd57d32accea0b295c96e26691aa14d8822fac7d9d27d5dc00b4ca2826dd03/tiny.en.pt";
const SHA = "d3dd57d32accea0b295c96e26691aa14d8822fac7d9d27d5dc00b4ca2826dd03";
// whisper/__init__.py, _ALIGNMENT_HEADS["tiny.en"]: base85 of a gzipped bool array [n_text_layer, n_text_head]
const ALIGNMENT = "ABzY8J1N>@0{>%R00Bk>$p{7v037`oCl~+#00";

const { GPT2_BYTES, specials } = await load("whisper/tokenizer.ts");
const { sinusoids } = await load("whisper/weights.ts");

// ── checkpoint ──
const ptPath = join(SRC, "tiny.en.pt");
const sha = createHash("sha256").update(readFileSync(ptPath)).digest("hex");
if (sha !== SHA) throw new Error(`tiny.en.pt sha256 ${sha}, expected ${SHA}`);
let dims;
const sd = loadStateDict(ptPath, (root) => {
  dims = Object.fromEntries(root.get("dims"));
  return root.get("model_state_dict");
});
console.log("dims", dims);

// the encoder's positions are a fixed buffer: check they are model.sinusoids, then drop them
{
  const ref = sd.get("encoder.positional_embedding").data;
  const mine = sinusoids(dims.n_audio_ctx, dims.n_audio_state);
  let e = 0;
  for (let i = 0; i < ref.length; i++) e = Math.max(e, Math.abs(ref[i] - mine[i]));
  console.log(`encoder sinusoids vs checkpoint: max |Δ| ${e.toExponential(2)} (fp16 storage)`);
  sd.delete("encoder.positional_embedding");
}

// ── vocabulary ──
const toChar = GPT2_BYTES();
const ranks = new Map();
const pieces = [];
for (const line of readFileSync(join(SRC, "gpt2.tiktoken"), "utf8").split("\n")) {
  if (!line.trim()) continue;
  const [b64, rank] = line.split(" ");
  const bytes = Buffer.from(b64, "base64");
  ranks.set(bytes.toString("latin1"), Number(rank));
  pieces[Number(rank)] = [...bytes].map((b) => toChar[b]).join("");
}
if (pieces.length !== 50256 || pieces.some((p) => p === undefined)) throw new Error("unexpected gpt2.tiktoken");
const sp = specials(pieces.length);
if (sp.timestampBegin + 1501 !== dims.n_vocab) throw new Error(`special tokens end at ${sp.timestampBegin + 1501}, n_vocab ${dims.n_vocab}`);

/** tiktoken: split with the GPT-2 pattern, then merge each chunk's bytes by rank */
const PAT = /'s|'t|'re|'ve|'m|'ll|'d| ?\p{L}+| ?\p{N}+| ?[^\s\p{L}\p{N}]+|\s+(?!\S)|\s+/gu;
function encode(text) {
  const out = [];
  for (const chunk of text.match(PAT) ?? []) {
    let parts = [...Buffer.from(chunk, "utf8")].map((b) => String.fromCharCode(b));
    for (;;) {
      let best = -1;
      let bestRank = Infinity;
      for (let i = 0; i < parts.length - 1; i++) {
        const r = ranks.get(parts[i] + parts[i + 1]);
        if (r !== undefined && r < bestRank) {
          bestRank = r;
          best = i;
        }
      }
      if (best < 0) break;
      parts = [...parts.slice(0, best), parts[best] + parts[best + 1], ...parts.slice(best + 2)];
    }
    for (const p of parts) out.push(ranks.get(p));
  }
  return out;
}

// tokenizer.non_speech_tokens, then decoding.py's _get_suppress_tokens for suppress_tokens = "-1"
const symbols = [...'"#()*+/:;<=>@[\\]^_`{|}~「」『』', ...`<< >> <<< >>> -- --- -( -[ (' (" (( )) ((( ))) [[ ]] {{ }} ♪♪ ♪♪♪`.split(" ")];
const misc = [..."♩♪♫♬♭♮♯"];
const nonSpeech = new Set([encode(" -")[0], encode(" '")[0]]);
for (const s of [...symbols, ...misc])
  for (const t of [encode(s), encode(" " + s)]) if (t.length === 1 || misc.includes(s)) nonSpeech.add(t[0]);
const suppress = [...new Set([...nonSpeech, sp.transcribe, sp.translate, sp.sot, sp.sotPrev, sp.sotLm, sp.noSpeech])].sort((a, b) => a - b);
const blank = [...encode(" "), sp.eot];
console.log(`suppress ${suppress.length} tokens: ${suppress.slice(0, 12).join(", ")} …; blank ${blank}`);
console.log(`"And so my fellow Americans" → ${encode(" And so my fellow Americans")}`);

// alignment heads
const B85 = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz!#$%&()*+-;<=>?@^_`{|}~";
function b85decode(s) {
  const pad = (5 - (s.length % 5)) % 5;
  s += "~".repeat(pad);
  const out = [];
  for (let i = 0; i < s.length; i += 5) {
    let acc = 0;
    for (let k = 0; k < 5; k++) acc = acc * 85 + B85.indexOf(s[i + k]);
    out.push((acc >>> 24) & 255, (acc >>> 16) & 255, (acc >>> 8) & 255, acc & 255);
  }
  return Buffer.from(out.slice(0, out.length - pad));
}
const mask = gunzipSync(b85decode(ALIGNMENT));
const alignmentHeads = [];
for (let l = 0; l < dims.n_text_layer; l++) for (let h = 0; h < dims.n_text_head; h++) if (mask[l * dims.n_text_head + h]) alignmentHeads.push([l, h]);
console.log("alignment heads (layer, head):", JSON.stringify(alignmentHeads));

// ── quantise and pack ──
function floatToHalf(v) {
  const f = new Float32Array([v]);
  const x = new Uint32Array(f.buffer)[0];
  const sign = (x >>> 16) & 0x8000;
  const e = ((x >>> 23) & 0xff) - 127 + 15;
  let m = x & 0x7fffff;
  if (e <= 0) {
    if (e < -10) return sign;
    m |= 0x800000;
    const shift = 14 - e;
    let h = m >> shift;
    if ((m >> (shift - 1)) & 1 && (m & ((1 << (shift - 1)) - 1) || h & 1)) h++;
    return sign | h;
  }
  if (e >= 31) return sign | 0x7c00;
  let h = (e << 10) | (m >> 13);
  if (m & 0x1000 && (m & 0xfff || h & 1)) h++;
  return sign | h;
}

const BLOCK = 32;
const parts = [];
const tensors = [];
let offset = 0;
let worst = 0;
let params = 0;
const align4 = () => {
  const pad = (4 - (offset % 4)) % 4;
  if (pad) {
    parts.push(Buffer.alloc(pad));
    offset += pad;
  }
};
for (const [name, t] of sd) {
  params += t.data.length;
  // int8 where the bytes are (the decoder holds the 51 864 × 384 embedding); the encoder stays exact
  const matrix = name.startsWith("decoder.") && name.endsWith(".weight") && t.shape.length >= 2;
  if (matrix) {
    const n = t.data.length;
    if ((n / t.shape[0]) % BLOCK) throw new Error(`${name}: rows not a multiple of ${BLOCK}`);
    const q = new Int8Array(n);
    const scales = new Float32Array(n / BLOCK);
    for (let blk = 0; blk < n / BLOCK; blk++) {
      let mx = 0;
      for (let i = blk * BLOCK; i < (blk + 1) * BLOCK; i++) mx = Math.max(mx, Math.abs(t.data[i]));
      const s = mx / 127 || 1;
      scales[blk] = s;
      for (let i = blk * BLOCK; i < (blk + 1) * BLOCK; i++) {
        const v = Math.round(t.data[i] / s);
        q[i] = v;
        if (mx) worst = Math.max(worst, Math.abs(v * s - t.data[i]) / mx);
      }
    }
    const entry = { name, shape: t.shape, dtype: "q8", block: BLOCK, offset };
    parts.push(Buffer.from(q.buffer));
    offset += q.byteLength;
    align4();
    entry.scales = offset;
    parts.push(Buffer.from(scales.buffer));
    offset += scales.byteLength;
    tensors.push(entry);
  } else {
    const h = new Uint16Array(t.data.length);
    for (let i = 0; i < h.length; i++) h[i] = floatToHalf(t.data[i]);
    tensors.push({ name, shape: t.shape, dtype: "f16", offset });
    parts.push(Buffer.from(h.buffer));
    offset += h.byteLength;
    align4();
  }
}
const bin = Buffer.concat(parts);
console.log(`${tensors.length} tensors, ${params.toLocaleString("en-US")} parameters, ${(bin.length / 1e6).toFixed(1)} MB; int8 blocks: max |Δ| ${(worst * 100).toFixed(3)}% of the block max`);

mkdirSync(join(OUT, "samples"), { recursive: true });
writeFileSync(join(OUT, "whisper-tiny-en.bin"), bin);
writeFileSync(join(OUT, "vocab.txt"), pieces.join("\n"));
copyFileSync(join(SRC, "jfk.wav"), join(OUT, "samples/jfk.wav"));
const manifest = {
  model: "tiny.en",
  source: MODEL_URL,
  sha256: SHA,
  file: "whisper-tiny-en.bin",
  bytes: bin.length,
  dims,
  params,
  tensors,
  alignmentHeads,
  suppress,
  blank,
  quantError: worst,
};
writeFileSync(join(OUT, "manifest.json"), JSON.stringify(manifest));
console.log(`wrote ${OUT}/`);
