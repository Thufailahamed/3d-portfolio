import { halfToFloat, type Weights } from "./taesd-gl";

/** what scripts/diffusion/build.mjs writes to public/diffusion/manifest.json */
export type Manifest = {
  size: number;
  latent: [number, number, number];
  thumb: { size: number; cols: number };
  stats: { mean: number; std: number };
  tokenizer: { vocab: number; bos: number; eos: number; pad: number; context: number };
  classes: { id: string; prompt: string; color: string; tokens: [string, number][]; images: number[] }[];
  images: { cls: number; name: string }[];
  decoder: { params: number; layers: { name: string; shape: number[]; offset: number }[] };
  /** latent → RGB least-squares fit: rows are the 4 channels and a bias, columns R, G, B */
  preview: number[][];
};

export type Assets = {
  manifest: Manifest;
  /** N × 4·64·64, CHW, on the diffusion model's scale */
  latents: Float32Array;
  decoder: Weights;
  thumbs: HTMLImageElement;
};

const BASE = "/diffusion";

async function fetchBytes(url: string, onProgress: (f: number) => void) {
  const res = await fetch(url);
  if (!res.ok || !res.body) throw new Error(`${url}: ${res.status}`);
  const total = Number(res.headers.get("content-length")) || 0;
  const reader = res.body.getReader();
  const parts: Uint8Array[] = [];
  let got = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    parts.push(value);
    got += value.length;
    if (total) onProgress(got / total);
  }
  const out = new Uint8Array(got);
  let o = 0;
  for (const p of parts) out.set(p, (o += p.length) - p.length);
  onProgress(1);
  return out;
}

export async function loadAssets(onProgress: (f: number) => void): Promise<Assets> {
  const f = [0, 0];
  const report = () => onProgress((f[0] * 1.6 + f[1] * 2.4) / 4);
  const [manifest, lat, dec, thumbs] = await Promise.all([
    fetch(`${BASE}/manifest.json`).then((r) => r.json() as Promise<Manifest>),
    fetchBytes(`${BASE}/latents.bin`, (v) => ((f[0] = v), report())),
    fetchBytes(`${BASE}/taesd_decoder.bin`, (v) => ((f[1] = v), report())),
    new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = `${BASE}/train.webp`;
    }),
  ]);
  // TAESD's 8-bit latent format: u = z / 6 + 0.5
  const latents = Float32Array.from(lat, (v) => (v / 255 - 0.5) * 6);
  const half = new Uint16Array(dec.buffer, dec.byteOffset, dec.byteLength / 2);
  const all = Float32Array.from(half, halfToFloat);
  const decoder: Weights = new Map(
    manifest.decoder.layers.map((l) => [l.name, { shape: l.shape, data: all.subarray(l.offset, l.offset + l.shape.reduce((a, b) => a * b, 1)) }]),
  );
  return { manifest, latents, decoder, thumbs };
}
