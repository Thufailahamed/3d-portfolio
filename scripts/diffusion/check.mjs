/**
 * Checks the WebGL TAESD (src/diffusion/pipeline/taesd-gl.ts) against the CPU reference (taesd.mjs).
 *
 *   node scripts/diffusion/check.mjs <dir with taesd_encoder.pth, taesd_decoder.pth> [size = 128]
 */
import sharp from "sharp";
import { fromB64, withChrome } from "./gpu.mjs";
import { decode, encode, tensor } from "./taesd.mjs";
import { loadStateDict } from "./torch.mjs";

const [src, size = "128"] = process.argv.slice(2);
const S = Number(size);
const enc = loadStateDict(`${src}/taesd_encoder.pth`);
const dec = loadStateDict(`${src}/taesd_decoder.pth`);
const rgb = await sharp("art/renders/lykan_front34.png").resize(S, S, { fit: "cover" }).removeAlpha().raw().toBuffer();
const img = tensor(3, S, S);
for (let p = 0; p < S * S; p++) for (let c = 0; c < 3; c++) img.data[c * S * S + p] = rgb[p * 3 + c] / 255;
const zCpu = encode(img, enc).data;
const xCpu = decode(tensor(4, S / 8, S / 8, zCpu), dec).data;

await withChrome({ enc, dec }, async ({ page, serve }) => {
  serve("/img/0", "application/octet-stream", rgb);
  const zGpu = fromB64(await page.evaluate((s) => window.encode(0, s), S));
  let ez = 0;
  for (let i = 0; i < zCpu.length; i++) ez = Math.max(ez, Math.abs(zCpu[i] - zGpu[i]));
  serve("/latent", "application/octet-stream", Buffer.from(zCpu.buffer));
  const r = await page.evaluate(() => window.decode());
  const px = Buffer.from(r.rgba, "base64");
  let ex = 0;
  let sum = 0;
  for (let p = 0; p < S * S; p++)
    for (let c = 0; c < 3; c++) {
      const d = Math.abs(px[p * 4 + c] / 255 - xCpu[c * S * S + p]);
      ex = Math.max(ex, d);
      sum += d;
    }
  console.log(`encoder: max |cpu − gpu| = ${ez.toFixed(4)} (latents span ±3)`);
  console.log(`decoder: max |cpu − gpu| = ${ex.toFixed(4)}, mean ${(sum / (S * S * 3)).toFixed(5)} (pixels in [0, 1]); ${r.ms.toFixed(0)} ms`);
});
