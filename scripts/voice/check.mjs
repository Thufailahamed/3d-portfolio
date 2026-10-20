/**
 * Checks the page's speech pipeline (src/voice) against OpenAI's files and an independent float32 Whisper:
 *   1. the 400-point FFT against a direct DFT
 *   2. the mel filterbank against whisper/assets/mel_filters.npz
 *   3. the log-mel spectrogram of jfk.wav against the reference front end
 *   4. the shipped encoder weights against the checkpoint (they must be its fp16, exactly)
 *   5. greedy decoding with the int8 decoder: every token must be the fp32 model's argmax
 *   6. word timestamps and the voice detector on the same clip
 * and leaves the fp32 encoder output in the temp folder for gpu.mjs.
 *
 *   node scripts/voice/check.mjs <folder with tiny.en.pt, mel_filters.npz, jfk.wav>
 */
import { readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { deflateSync } from "node:zlib";
import { loadStateDict } from "../diffusion/torch.mjs";
import { Reference, logMelRef, readNpz } from "./reference.mjs";
import { load } from "./ts.mjs";

const SRC = process.argv[2];
if (!SRC) throw new Error("usage: node scripts/voice/check.mjs <assets folder>");
const { FFT } = await load("audio/fft.ts");
const fe = await load("audio/frontend.ts");
const { parseWav } = await load("audio/wav.ts");
const { Vad, segments } = await load("audio/vad.ts");
const { readWeights, dequantize } = await load("whisper/weights.ts");
const { Tokenizer } = await load("whisper/tokenizer.ts");
const D = await load("whisper/decoder.ts");
const { findAlignment } = await load("whisper/align.ts");

const ok = (cond, msg) => console.log(`${cond ? "  ok " : " FAIL"} ${msg}`);
const maxAbs = (a, b) => {
  let e = 0;
  for (let i = 0; i < a.length; i++) e = Math.max(e, Math.abs(a[i] - b[i]));
  return e;
};

// 1 ── FFT
{
  const fft = new FFT(400);
  const x = Float64Array.from({ length: 400 }, (_, i) => Math.sin(i * 0.37) + Math.cos(i * i * 0.001) - 0.3);
  const re = new Float64Array(201);
  const im = new Float64Array(201);
  fft.real(x, re, im);
  let e = 0;
  let mag = 0;
  for (let k = 0; k <= 200; k++) {
    let r = 0;
    let s = 0;
    for (let n = 0; n < 400; n++) {
      r += x[n] * Math.cos((2 * Math.PI * k * n) / 400);
      s -= x[n] * Math.sin((2 * Math.PI * k * n) / 400);
    }
    e = Math.max(e, Math.hypot(re[k] - r, im[k] - s));
    mag = Math.max(mag, Math.hypot(r, s));
  }
  ok(e / mag < 1e-12, `FFT(400 = ${fft.factors.join("·")}) vs direct DFT: max error ${(e / mag).toExponential(2)} of the peak bin`);
}

// 2 ── mel filterbank
const npz = readNpz(join(SRC, "mel_filters.npz"));
{
  const ref = npz.get("mel_80");
  const { weights } = fe.melFilters();
  const e = maxAbs(weights, ref.data);
  ok(e < 1e-7, `mel filterbank [${ref.shape}] vs OpenAI's mel_filters.npz: max |Δ| ${e.toExponential(2)} (peak weight ${Math.max(...ref.data).toFixed(5)})`);
}

// 3 ── log-mel
const pcm = parseWav(readFileSync(join(SRC, "jfk.wav")).buffer);
console.log(`jfk.wav: ${pcm.rate} Hz, ${pcm.bits}-bit, ${(pcm.data.length / pcm.rate).toFixed(2)} s`);
const audio = pcm.data;
const lm = fe.logMelSpectrogram(audio);
const refMel = logMelRef(audio, npz.get("mel_80").data);
ok(maxAbs(lm.mel, refMel) < 1e-5, `log-mel [80, 3000] vs direct-DFT reference: max |Δ| ${maxAbs(lm.mel, refMel).toExponential(2)}; content frames ${lm.contentFrames}, max log10 ${lm.maxLog.toFixed(3)}`);

// 4 ── encoder: the shipped weights against the checkpoint, then the fp32 forward pass
let dims;
const fp32 = loadStateDict(join(SRC, "tiny.en.pt"), (root) => {
  dims = Object.fromEntries(root.get("dims"));
  return root.get("model_state_dict");
});
const manifest = JSON.parse(readFileSync("public/voice/manifest.json", "utf8"));
const bin = readFileSync("public/voice/whisper-tiny-en.bin");
const weights = readWeights(manifest, bin.buffer.slice(bin.byteOffset, bin.byteOffset + bin.byteLength));
{
  let e = 0;
  let n = 0;
  for (const [k, t] of weights) {
    if (!k.startsWith("encoder.")) continue;
    e = Math.max(e, maxAbs(dequantize(t), fp32.get(k).data));
    n += t.shape.reduce((a, b) => a * b, 1);
  }
  ok(e === 0, `encoder weights (${n.toLocaleString("en-US")}) are the checkpoint's fp16 values: max |Δ| ${e}`);
}
let t0 = performance.now();
const xa32 = new Reference(fp32, dims).encode(lm.mel);
console.log(`  fp32 reference encoder: ${((performance.now() - t0) / 1000).toFixed(1)} s on the CPU`);
writeFileSync(join(tmpdir(), "voice-jfk-xa.f32"), Buffer.from(xa32.buffer));

// 5 ── decoding
const tok = new Tokenizer(readFileSync("public/voice/vocab.txt", "utf8").split("\n"));
const dec = new D.Decoder(weights, dims, manifest.alignmentHeads);
const cross = dec.crossFrom(xa32);
dec.setAudio(cross);
const cfg = { suppress: manifest.suppress, blank: manifest.blank };
const ref32 = new Reference(fp32, dims);
for (const timestamps of [false, true]) {
  const opts = { ...D.DEFAULT_OPTIONS, timestamps };
  t0 = performance.now();
  const att = D.run(D.decodeAttempt(dec, tok, cfg, opts, {}));
  const ms = performance.now() - t0;
  console.log(`  ${timestamps ? "with timestamps" : "without timestamps"}: ${att.steps.length} tokens in ${(ms / 1000).toFixed(2)} s (${(ms / att.steps.length).toFixed(0)} ms / token)`);
  console.log(`    "${att.text}"`);
  if (timestamps) console.log(`    ${tok.decodeWithTimestamps(att.tokens)}`);
  writeFileSync(join(tmpdir(), `voice-jfk-tokens-${timestamps ? "ts" : "nots"}.json`), JSON.stringify(att.steps.map((s) => s.token)));
  console.log(`    avg_logprob ${att.avgLogprob.toFixed(3)} · no_speech_prob ${att.noSpeechProb.toExponential(2)} · compression ${(Buffer.byteLength(att.text) / deflateSync(Buffer.from(att.text)).length).toFixed(2)}`);
  // the fp32 model, teacher-forced on the same sequence, must pick the same token at every step
  const seq = [...att.initial, ...att.steps.map((s) => s.token)];
  const L = ref32.logits(xa32, seq.slice(0, -1));
  let agree = 0;
  let dlp = 0;
  for (let i = 0; i < att.steps.length; i++) {
    const row = Float32Array.from(L.subarray((att.initial.length - 1 + i) * dims.n_vocab, (att.initial.length + i) * dims.n_vocab));
    D.applyFilters(row, seq.slice(0, att.initial.length + i), att.initial.length, tok, cfg, opts);
    let best = 0;
    for (let v = 1; v < row.length; v++) if (row[v] > row[best]) best = v;
    if (best === att.steps[i].token) agree++;
    let mx = -Infinity;
    for (const v of row) mx = Math.max(mx, v);
    let s = 0;
    for (const v of row) s += Math.exp(v - mx);
    dlp = Math.max(dlp, Math.abs(row[att.steps[i].token] - mx - Math.log(s) - att.steps[i].logprob));
  }
  ok(agree === att.steps.length, `fp32 argmax agrees on ${agree} / ${att.steps.length} tokens; max |Δ log p| of the chosen token ${dlp.toFixed(3)}`);
  if (!timestamps) {
    const al = D.run(findAlignment(dec, tok, att.tokens, lm.contentFrames));
    console.log(`  word timestamps (DTW over ${al.rows} × ${al.frames}):`);
    writeFileSync(join(tmpdir(), "voice-jfk-words.json"), JSON.stringify(al.words));
    console.log("    " + al.words.map((w) => `${w.word.trim()} ${w.start.toFixed(2)}–${w.end.toFixed(2)} (${(w.probability * 100).toFixed(0)}%)`).join(" · "));
  } else {
    console.log("  segments:", JSON.stringify(D.segmentsOf(att.tokens, tok, pcm.data.length / 16000).map((s) => [s.start, s.end, s.text])));
  }
}

// 6 ── voice activity
{
  const v = new Vad();
  const steps = [];
  for (let f = 0; f < lm.contentFrames; f++) steps.push(v.step(lm.power.subarray(f * 201, (f + 1) * 201)));
  const segs = segments(steps);
  console.log(`  VAD: ${segs.map((s) => `${(s.start / 100).toFixed(2)}–${(s.end / 100).toFixed(2)} s`).join(", ")}`);
  const llr = steps.map((s) => s.llr);
  const q = (p) => [...llr].sort((a, b) => a - b)[Math.floor(p * (llr.length - 1))].toFixed(2);
  console.log(`  frame statistic, nats/bin: p10 ${q(0.1)} · median ${q(0.5)} · p90 ${q(0.9)} · max ${q(1)}`);
}
