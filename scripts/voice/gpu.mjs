/**
 * Runs the page's WebGL Whisper (src/voice/whisper/gl.ts) in headless Chrome on the real GPU and compares it
 * with what check.mjs computed on the CPU: the encoder output against the fp32 reference, and the decoded
 * tokens and word timings against the CPU decoder. Run check.mjs first. Needs puppeteer-core (PUPPETEER_CORE
 * pointing at its index, or installed) and Chrome.
 *
 *   node scripts/voice/gpu.mjs
 */
import { existsSync, readFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { extname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { emitTree } from "./ts.mjs";

const CHROME = [process.env.CHROME, "C:/Program Files/Google/Chrome/Application/chrome.exe", "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/usr/bin/google-chrome"].find(
  (p) => p && existsSync(p),
);
if (!CHROME) throw new Error("no Chrome found; set CHROME");
const MODS = emitTree("whisper/gl.ts");
for (const f of ["whisper/decoder.ts", "whisper/align.ts", "whisper/tokenizer.ts", "audio/frontend.ts", "audio/wav.ts"]) emitTree(f);

const PAGE = `<!doctype html><meta charset="utf-8"><script type="module">
import { WhisperGL } from "/m/whisper/gl.mjs";
import { readWeights } from "/m/whisper/weights.mjs";
import { Tokenizer } from "/m/whisper/tokenizer.mjs";
import { decodeAttempt, run, DEFAULT_OPTIONS } from "/m/whisper/decoder.mjs";
import { findAlignment } from "/m/whisper/align.mjs";
import { logMelSpectrogram } from "/m/audio/frontend.mjs";
import { parseWav } from "/m/audio/wav.mjs";
const b64 = (f) => { const u = new Uint8Array(f.buffer, f.byteOffset, f.byteLength); let s = ""; for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode(...u.subarray(i, i + 0x8000)); return btoa(s); };
window.result = (async () => {
  const m = await fetch("/voice/manifest.json").then((r) => r.json());
  const [bin, vocab, wav] = await Promise.all([fetch("/voice/" + m.file).then((r) => r.arrayBuffer()), fetch("/voice/vocab.txt").then((r) => r.text()), fetch("/voice/samples/jfk.wav").then((r) => r.arrayBuffer())]);
  let t = performance.now();
  const w = readWeights(m, bin);
  const gl = await WhisperGL.create(w, m.dims, m.alignmentHeads);
  const load = performance.now() - t;
  const tok = new Tokenizer(vocab.split("\\n"));
  const lm = logMelSpectrogram(parseWav(wav).data);
  await gl.encode(lm.mel, { probe: [100, 200] });
  const enc = await gl.encode(lm.mel, { probe: [100, 200] });
  const cfg = { suppress: m.suppress, blank: m.blank };
  const out = { renderer: gl.renderer, load, encodeMs: enc.ms, xa: b64(enc.xa), probeSum: enc.probes[0][0].subarray(0, 1500).reduce((a, b) => a + b, 0) };
  for (const timestamps of [false, true]) {
    t = performance.now();
    const att = run(decodeAttempt(gl, tok, cfg, { ...DEFAULT_OPTIONS, timestamps }, {}));
    out[timestamps ? "ts" : "nots"] = { ms: performance.now() - t, text: att.text, tokens: att.steps.map((s) => s.token), avg: att.avgLogprob, noSpeech: att.noSpeechProb };
    if (!timestamps) {
      t = performance.now();
      const al = run(findAlignment(gl, tok, att.tokens, lm.contentFrames));
      out.align = { ms: performance.now() - t, words: al.words };
    }
  }
  return out;
})().catch((e) => ({ error: e.message + "\\n" + e.stack }));
</script>`;

const TYPES = { ".mjs": "text/javascript", ".json": "application/json", ".txt": "text/plain", ".wav": "audio/wav", ".bin": "application/octet-stream" };
const server = createServer((req, res) => {
  const url = decodeURIComponent(req.url);
  let file = null;
  if (url === "/") return res.writeHead(200, { "content-type": "text/html" }).end(PAGE);
  if (url.startsWith("/m/")) file = join(MODS, url.slice(3));
  else if (url.startsWith("/voice/")) file = resolve("public", url.slice(1));
  if (!file || !existsSync(file)) return res.writeHead(404).end();
  res.writeHead(200, { "content-type": TYPES[extname(file)] ?? "application/octet-stream" }).end(readFileSync(file));
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const puppeteer = (await import(process.env.PUPPETEER_CORE ? pathToFileURL(process.env.PUPPETEER_CORE).href : "puppeteer-core")).default;
const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ["--use-angle=d3d11", "--enable-gpu", "--ignore-gpu-blocklist", "--no-first-run"], protocolTimeout: 600_000 });
try {
  const page = await browser.newPage();
  page.on("console", (m) => console.log("  [chrome]", m.text()));
  page.on("pageerror", (e) => console.log("  [chrome error]", e.message));
  await page.goto(`http://127.0.0.1:${server.address().port}/`);
  const r = await page.evaluate("window.result");
  if (r.error) throw new Error(r.error);
  const ok = (cond, msg) => console.log(`${cond ? "  ok " : " FAIL"} ${msg}`);
  console.log(`  GPU: ${r.renderer} · weights to textures ${r.load.toFixed(0)} ms · encoder ${r.encodeMs.toFixed(0)} ms`);
  const xb = Buffer.from(r.xa, "base64");
  const xa = new Float32Array(xb.buffer, xb.byteOffset, xb.byteLength / 4);
  const ref = new Float32Array(readFileSync(join(tmpdir(), "voice-jfk-xa.f32")).buffer.slice(0));
  let n = 0;
  let d = 0;
  let mx = 0;
  for (let i = 0; i < ref.length; i++) {
    n += (xa[i] - ref[i]) ** 2;
    d += ref[i] ** 2;
    mx = Math.max(mx, Math.abs(xa[i] - ref[i]));
  }
  ok(Math.sqrt(n / d) < 1e-3, `WebGL encoder vs fp32 CPU reference: relative RMS error ${Math.sqrt(n / d).toExponential(2)}, max |Δ| ${mx.toExponential(2)}`);
  ok(Math.abs(r.probeSum - 1) < 1e-3, `an attention row sums to ${r.probeSum.toFixed(5)}`);
  for (const k of ["nots", "ts"]) {
    const cpu = JSON.parse(readFileSync(join(tmpdir(), `voice-jfk-tokens-${k}.json`), "utf8"));
    const same = cpu.length === r[k].tokens.length && cpu.every((t, i) => t === r[k].tokens[i]);
    ok(same, `${k === "ts" ? "with" : "without"} timestamps: ${r[k].tokens.length} tokens in ${r[k].ms.toFixed(0)} ms (${(r[k].ms / r[k].tokens.length).toFixed(1)} ms / token), ${same ? "identical to" : "different from"} the CPU decoder`);
    console.log(`    "${r[k].text}" · avg_logprob ${r[k].avg.toFixed(3)} · no_speech ${r[k].noSpeech.toExponential(2)}`);
  }
  const words = JSON.parse(readFileSync(join(tmpdir(), "voice-jfk-words.json"), "utf8"));
  const dt = Math.max(...r.align.words.map((w, i) => Math.max(Math.abs(w.start - words[i].start), Math.abs(w.end - words[i].end))));
  ok(r.align.words.length === words.length && dt <= 0.04, `word timestamps in ${r.align.ms.toFixed(0)} ms: ${r.align.words.length} words, max shift from the CPU's ${dt.toFixed(2)} s`);
} finally {
  await browser.close();
  server.close();
}
