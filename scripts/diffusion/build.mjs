/**
 * Builds public/diffusion/: the training latents, the TAESD decoder weights and the manifest the lab loads.
 *
 *   node scripts/diffusion/build.mjs <dir with taesd_encoder.pth, taesd_decoder.pth, bpe_simple_vocab_16e6.txt.gz>
 *
 * Sources: github.com/madebyollin/taesd (MIT) and github.com/openai/CLIP (MIT).
 * Encoding runs in headless Chrome on the GPU (scripts/diffusion/gpu.mjs); scripts/diffusion/check.mjs compares it with the CPU reference.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import sharp from "sharp";
import { BOS, CONTEXT, EOS, loadTokenizer } from "./clip-tokenizer.mjs";
import { CLASSES, SIZE, buildImages } from "./dataset.mjs";
import { fromB64, withChrome } from "./gpu.mjs";
import { loadStateDict } from "./torch.mjs";

const src = process.argv[2];
if (!src) throw new Error("usage: build.mjs <weights dir>");
const OUT = "public/diffusion";
const L = SIZE / 8;
const THUMB = 96;
mkdirSync(OUT, { recursive: true });

const f16 = (v) => {
  const f = new Float32Array([v]);
  const u = new Uint32Array(f.buffer)[0];
  const s = (u >> 16) & 0x8000;
  const e = ((u >> 23) & 0xff) - 127 + 15;
  const m = u & 0x7fffff;
  if (e <= 0) return s | ((m | 0x800000) >> (1 - e + 13));
  if (e >= 31) return s | 0x7c00;
  // round to nearest even
  let h = s | (e << 10) | (m >> 13);
  const rest = m & 0x1fff;
  if (rest > 0x1000 || (rest === 0x1000 && h & 1)) h++;
  return h;
};

// 1. the training images, encoded on the GPU by the same WebGL network the lab decodes with
const images = await buildImages(".");
console.log(`${images.length} training images`);
const enc = loadStateDict(join(src, "taesd_encoder.pth"));
const t0 = Date.now();
const latents = await withChrome({ enc }, async ({ page, serve }) => {
  const out = [];
  for (let i = 0; i < images.length; i++) {
    serve(`/img/${i}`, "application/octet-stream", images[i].rgb);
    out.push(fromB64(await page.evaluate((k, s) => window.encode(k, s), i, SIZE)));
    if (i % 10 === 9) console.log(`  encoded ${i + 1}/${images.length}  ${((Date.now() - t0) / 1000).toFixed(0)} s`);
  }
  return out;
});

// latents ship as TAESD's own 8-bit format: x/6 + 0.5 in [0, 1]
const q = new Uint8Array(images.length * 4 * L * L);
let sum = 0;
let sum2 = 0;
let clipped = 0;
latents.forEach((z, i) => {
  for (let k = 0; k < z.length; k++) {
    const u = z[k] / 6 + 0.5;
    if (u < 0 || u > 1) clipped++;
    q[i * z.length + k] = Math.round(Math.min(1, Math.max(0, u)) * 255);
    sum += z[k];
    sum2 += z[k] * z[k];
  }
});
writeFileSync(join(OUT, "latents.bin"), q);
const n = latents.length * 4 * L * L;
const mean = sum / n;
const std = Math.sqrt(sum2 / n - mean * mean);
console.log(`latents: mean ${mean.toFixed(3)}  std ${std.toFixed(3)}  clipped ${clipped}`);

// 2. thumbnails of the training set, one sprite
const cols = 16;
const rows = Math.ceil(images.length / cols);
const tiles = await Promise.all(images.map((im) => sharp(im.rgb, { raw: { width: SIZE, height: SIZE, channels: 3 } }).resize(THUMB, THUMB).png().toBuffer()));
await sharp({ create: { width: cols * THUMB, height: rows * THUMB, channels: 3, background: "#000" } })
  .composite(tiles.map((t, i) => ({ input: t, left: (i % cols) * THUMB, top: Math.floor(i / cols) * THUMB })))
  .webp({ quality: 82 })
  .toFile(join(OUT, "train.webp"));

// 3. the decoder's weights, fp16, in PyTorch layout, in state-dict order
const dec = loadStateDict(join(src, "taesd_decoder.pth"));
const layers = [];
let count = 0;
for (const [name, t] of dec) {
  layers.push({ name, shape: t.shape, offset: count });
  count += t.data.length;
}
const wbuf = new Uint16Array(count);
for (const [name, t] of dec) {
  const off = layers.find((l) => l.name === name).offset;
  for (let k = 0; k < t.data.length; k++) wbuf[off + k] = f16(t.data[k]);
}
writeFileSync(join(OUT, "taesd_decoder.bin"), new Uint8Array(wbuf.buffer));

// 4. a linear latent → RGB map, least squares against each latent pixel's 8×8 block of the image:
//    the cheap live preview Stable Diffusion UIs show between steps
const A = Array.from({ length: 5 }, () => new Float64Array(5));
const B = Array.from({ length: 5 }, () => new Float64Array(3));
images.forEach((im, i) => {
  const z = latents[i];
  for (let y = 0; y < L; y++)
    for (let x = 0; x < L; x++) {
      const f = [0, 1, 2, 3].map((c) => z[(c * L + y) * L + x]).concat(1);
      const rgb = [0, 0, 0];
      for (let dy = 0; dy < 8; dy++) for (let dx = 0; dx < 8; dx++) for (let c = 0; c < 3; c++) rgb[c] += im.rgb[((y * 8 + dy) * SIZE + x * 8 + dx) * 3 + c] / 255 / 64;
      for (let a = 0; a < 5; a++) {
        for (let b = 0; b < 5; b++) A[a][b] += f[a] * f[b];
        for (let c = 0; c < 3; c++) B[a][c] += f[a] * rgb[c];
      }
    }
});
// Gauss–Jordan on the 5×5 normal equations
for (let p = 0; p < 5; p++) {
  const d = A[p][p];
  for (let j = 0; j < 5; j++) A[p][j] /= d;
  for (let c = 0; c < 3; c++) B[p][c] /= d;
  for (let r = 0; r < 5; r++) {
    if (r === p) continue;
    const k = A[r][p];
    for (let j = 0; j < 5; j++) A[r][j] -= k * A[p][j];
    for (let c = 0; c < 3; c++) B[r][c] -= k * B[p][c];
  }
}
const preview = B.map((row) => Array.from(row, (v) => +v.toFixed(5)));

// 5. the prompts, tokenised exactly as SD 1.x's CLIP tokenizer does
const tok = loadTokenizer(join(src, "bpe_simple_vocab_16e6.txt.gz"));
const tokens = (text) => {
  const pieces = tok.encode(text);
  if (pieces.length > CONTEXT - 2) throw new Error(`prompt too long: ${text}`);
  return pieces.map((p) => [p.piece, p.id]);
};

const manifest = {
  size: SIZE,
  latent: [4, L, L],
  thumb: { size: THUMB, cols },
  stats: { mean: +mean.toFixed(4), std: +std.toFixed(4) },
  tokenizer: { vocab: tok.size, bos: BOS, eos: EOS, pad: EOS, context: CONTEXT },
  classes: CLASSES.map((c, k) => ({ id: c.id, prompt: c.prompt, color: c.color, tokens: tokens(c.prompt), images: images.flatMap((im, i) => (im.cls === k ? [i] : [])) })),
  images: images.map((im) => ({ cls: im.cls, name: im.name })),
  decoder: { params: count, layers },
  preview,
};
writeFileSync(join(OUT, "manifest.json"), JSON.stringify(manifest));
console.log(`done in ${((Date.now() - t0) / 1000).toFixed(0)} s`);
