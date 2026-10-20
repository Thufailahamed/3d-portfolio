import * as THREE from "three";
import { N_FRAMES, N_MELS } from "../audio/frontend";
import { rampRGB } from "./common";

/**
 * Textures of tensors, for the encoder and decoder stations. Time runs left to right with the clip's frames
 * given `share` of the width and the padding the rest (as axis30 lays out the 3-D axes); rows are channels.
 */

export const HEAT_W = 512;
export const SHARE = 0.74;

/** source column (0 … n) for texture column u, with the first `content` of n stretched over SHARE */
function column(u: number, content: number, n: number, share = SHARE) {
  const s = Math.round(share * HEAT_W);
  if (s >= HEAT_W) return Math.floor((u / HEAT_W) * content);
  return u < s ? Math.floor((u / s) * content) : Math.floor(content + ((u - s) / (HEAT_W - s)) * (n - content));
}

function texture(px: Uint8Array, w: number, h: number) {
  const t = new THREE.DataTexture(px, w, h, THREE.RGBAFormat);
  t.colorSpace = THREE.SRGBColorSpace;
  t.minFilter = THREE.LinearFilter;
  t.magFilter = THREE.LinearFilter;
  t.needsUpdate = true;
  return t;
}

/**
 * A [T × C] activation (row-major, time-major) as a diverging image: negative toward blue, positive toward warm
 * white, scaled by the 99th percentile of |a| over the clip's own frames.
 */
export function activationTexture(a: Float32Array, T: number, Cn: number, content: number, rows = 192) {
  const sample: number[] = [];
  for (let i = 0; i < Math.min(a.length, content * Cn); i += 13) sample.push(Math.abs(a[i]));
  sample.sort((x, y) => x - y);
  const s = sample[Math.floor(sample.length * 0.99)] || 1;
  const px = new Uint8Array(HEAT_W * rows * 4);
  const per = Cn / rows;
  const neg = [0.36, 0.52, 0.95];
  const pos = [1.0, 0.86, 0.62];
  const bg = [0.035, 0.037, 0.045];
  for (let u = 0; u < HEAT_W; u++) {
    const t = Math.min(T - 1, column(u, content, T));
    for (let r = 0; r < rows; r++) {
      // mean over the channels this row stands for
      let v = 0;
      for (let c = Math.floor(r * per); c < Math.floor((r + 1) * per); c++) v += a[t * Cn + c];
      v /= Math.max(1, Math.floor((r + 1) * per) - Math.floor(r * per));
      const x = Math.max(-1, Math.min(1, v / s));
      const k = Math.abs(x) ** 0.8;
      const tgt = x < 0 ? neg : pos;
      const o = ((rows - 1 - r) * HEAT_W + u) * 4;
      for (let ch = 0; ch < 3; ch++) px[o + ch] = 255 * (bg[ch] + (tgt[ch] - bg[ch]) * k);
      px[o + 3] = 255;
    }
  }
  return texture(px, HEAT_W, rows);
}

/** the [80 × 3000] log-mel, low bands at the bottom; share = 1 draws the clip's own frames only */
export function melTexture(mel: Float32Array, contentFrames: number, maxLog: number, share = SHARE) {
  const floor = (maxLog - 8 + 4) / 4;
  const px = new Uint8Array(HEAT_W * N_MELS * 4);
  for (let u = 0; u < HEAT_W; u++) {
    const f = Math.min(N_FRAMES - 1, column(u, contentFrames, N_FRAMES, share));
    for (let m = 0; m < N_MELS; m++) {
      const [r, g, b] = rampRGB(0.04 + 0.96 * Math.min(1, Math.max(0, (mel[m * N_FRAMES + f] - floor) / 2)));
      // a DataTexture's first row is its bottom
      const o = (m * HEAT_W + u) * 4;
      px[o] = r * 255;
      px[o + 1] = g * 255;
      px[o + 2] = b * 255;
      px[o + 3] = 255;
    }
  }
  return texture(px, HEAT_W, N_MELS);
}
