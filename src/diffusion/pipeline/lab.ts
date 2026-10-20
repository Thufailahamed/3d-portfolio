import * as THREE from "three";
import type { Assets } from "./assets";
import { Sampler, makeTraining, type Params, type StepRecord, type Training } from "./sampler";
import { timestepEmbedding } from "./sd15";
import { stageIndex } from "./story";
import { useLab } from "./store";
import { Taesd, type StageView } from "./taesd-gl";

/**
 * Everything the scene and the panels show, outside React: the training set, the current run, the GPU decoder,
 * and the textures those are drawn into. Panels read it directly and re-render off the store's counters.
 */

export const L = 64;
const D = 4 * L * L;
export const VAE_SIDES = [64, 128, 256, 512];

/** a dark-centred diverging map (after Crameri's "berlin"): blue below zero, ember above */
export function diverging(v: number, out: number[] | Uint8Array | Uint8ClampedArray, o = 0) {
  const x = Math.max(-1, Math.min(1, v));
  const stops = x < 0 ? [[0.07, 0.075, 0.085], [0.12, 0.33, 0.55], [0.55, 0.78, 0.98]] : [[0.07, 0.075, 0.085], [0.52, 0.17, 0.08], [1.0, 0.7, 0.5]];
  const a = Math.abs(x) * 2;
  const i = a < 1 ? 0 : 1;
  const f = a < 1 ? a : a - 1;
  for (let c = 0; c < 3; c++) out[o + c] = Math.round((stops[i][c] + (stops[i + 1][c] - stops[i][c]) * f) * 255);
}

const byteTex = (w: number, h: number, srgb = true) => {
  const t = new THREE.DataTexture(new Uint8Array(w * h * 4), w, h, THREE.RGBAFormat, THREE.UnsignedByteType);
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.magFilter = THREE.NearestFilter;
  t.minFilter = THREE.LinearFilter;
  t.generateMipmaps = false;
  t.needsUpdate = true;
  return t;
};
const floatTex = (w: number, h: number) => {
  const t = new THREE.DataTexture(new Float32Array(w * h * 4), w, h, THREE.RGBAFormat, THREE.FloatType);
  t.magFilter = t.minFilter = THREE.NearestFilter;
  t.needsUpdate = true;
  return t;
};

export class Lab {
  readonly tr: Training;
  readonly assets: Assets;
  taesd: Taesd | null = null;
  sampler: Sampler | null = null;
  decodeError: string | null = null;

  /** z_t at the shown step and the next, packed RGBA = channels 0–3, for the tensor's bars */
  readonly latA = floatTex(L, L);
  readonly latB = floatTex(L, L);
  /** latent → RGB views: z_t and the prediction ẑ0 */
  readonly ztTex = byteTex(L, L);
  readonly x0Tex = byteTex(L, L);
  /** ε̂ under ∅, under the prompt, and guided: four channels as a 2 × 2 grid */
  readonly epsTex = [byteTex(2 * L, 2 * L, false), byteTex(2 * L, 2 * L, false), byteTex(2 * L, 2 * L, false)];
  readonly tembTex = byteTex(320, 1, false);
  readonly vaeTex = VAE_SIDES.map((s) => byteTex(s, s));
  readonly outTex = byteTex(512, 512);
  /** the decoded image, row 0 at the top, for download */
  image: ImageData | null = null;
  private shown = { run: -1, a: -1, b: -1, view: -1, loop: false };
  private decoding = false;

  constructor(assets: Assets) {
    this.assets = assets;
    const m = assets.manifest;
    this.tr = makeTraining(assets.latents, m.images.length, Int8Array.from(m.images, (i) => i.cls), m.classes.length);
    // the decoded images are seen smaller than their size: mipmaps, or their fine detail sparkles
    for (const t of [...this.vaeTex, this.outTex]) {
      t.magFilter = THREE.LinearFilter;
      t.minFilter = THREE.LinearMipmapLinearFilter;
      t.generateMipmaps = true;
      t.anisotropy = 8;
    }
    try {
      this.taesd = new Taesd(assets.decoder);
    } catch (e) {
      this.decodeError = (e as Error).message;
    }
  }

  get run() {
    return this.sampler?.run ?? null;
  }

  start(params: Params) {
    this.sampler = new Sampler(this.tr, params);
    this.image = null;
    for (const t of [...this.vaeTex, this.outTex]) {
      (t.image.data as Uint8Array).fill(0);
      t.needsUpdate = true;
    }
    const s = useLab.getState();
    s.set({ run: s.run + 1, computed: 0, decode: { status: "idle", stages: 0, ms: 0 } });
  }

  /** advance the sampler within a time budget; the playback can't run ahead of it */
  tick(budgetMs: number) {
    const sm = this.sampler;
    if (!sm || sm.done) return;
    const t0 = performance.now();
    while (!sm.done && performance.now() - t0 < budgetMs) sm.step();
    useLab.getState().set({ computed: sm.run.steps.length });
  }

  /** the latent the loop holds after j steps (j = 0 is z_T, j = N is z_0) */
  latentAfter(j: number) {
    const r = this.run!;
    if (j <= 0) return r.zT;
    if (j >= r.steps.length) return r.z0 ?? r.steps[r.steps.length - 1]?.z ?? r.zT;
    return r.steps[j].z;
  }

  record(k: number): StepRecord | null {
    const r = this.run;
    if (!r || !r.steps.length) return null;
    return r.steps[Math.max(0, Math.min(r.steps.length - 1, k))];
  }

  private packLatent(z: Float32Array, t: THREE.DataTexture) {
    const px = t.image.data as Float32Array;
    for (let c = 0; c < 4; c++) for (let p = 0; p < L * L; p++) px[p * 4 + c] = z[c * L * L + p];
    t.needsUpdate = true;
  }

  /** latent → RGB with the build's least-squares map; rows flipped so texture v = 0 is the image's bottom */
  private rgbPreview(z: Float32Array, t: THREE.DataTexture) {
    const M = this.assets.manifest.preview;
    const px = t.image.data as Uint8Array;
    for (let y = 0; y < L; y++)
      for (let x = 0; x < L; x++) {
        const p = y * L + x;
        const o = ((L - 1 - y) * L + x) * 4;
        for (let c = 0; c < 3; c++) {
          let v = M[4][c];
          for (let k = 0; k < 4; k++) v += M[k][c] * z[k * L * L + p];
          px[o + c] = Math.max(0, Math.min(255, Math.round(v * 255)));
        }
        px[o + 3] = 255;
      }
    t.needsUpdate = true;
  }

  private channelGrid(e: Float32Array, t: THREE.DataTexture, scale: number) {
    const px = t.image.data as Uint8Array;
    const W = 2 * L;
    for (let c = 0; c < 4; c++)
      for (let y = 0; y < L; y++)
        for (let x = 0; x < L; x++) {
          const gx = (c % 2) * L + x;
          const gy = Math.floor(c / 2) * L + y;
          const o = ((W - 1 - gy) * W + gx) * 4;
          diverging(e[c * L * L + y * L + x] / scale, px, o);
          px[o + 3] = 255;
        }
    t.needsUpdate = true;
  }

  /** point every texture at the state after `cursor` steps (fractional: the relief blends toward the next);
   *  before the loop starts there is no prediction yet, so those panels stay dark */
  show(cursor: number, inLoop = true) {
    const r = this.run;
    if (!r) return;
    const avail = r.steps.length + (r.z0 ? 1 : 0);
    const c = Math.max(0, Math.min(cursor, Math.max(0, avail - 1)));
    const a = Math.floor(c);
    const b = Math.min(a + 1, avail - 1);
    const run = useLab.getState().run;
    if (this.shown.run !== run || this.shown.loop !== inLoop) this.shown = { run, a: -1, b: -1, view: -1, loop: inLoop };
    if (this.shown.a !== a) {
      if (this.shown.b === a) {
        // the next state is already uploaded: swap the two
        const tmp = this.latA.image.data;
        this.latA.image.data = this.latB.image.data;
        this.latB.image.data = tmp;
        this.latA.needsUpdate = this.latB.needsUpdate = true;
        this.shown.b = -1;
      } else this.packLatent(this.latentAfter(a), this.latA);
      this.shown.a = a;
    }
    if (this.shown.b !== b) {
      this.packLatent(this.latentAfter(b), this.latB);
      this.shown.b = b;
    }
    const k = Math.min(a, r.steps.length - 1);
    if (k >= 0 && this.shown.view !== a) {
      this.shown.view = a;
      this.rgbPreview(this.latentAfter(a), this.ztTex);
      const rec = r.steps[k];
      if (!inLoop) {
        for (const t of [this.x0Tex, ...this.epsTex]) {
          (t.image.data as Uint8Array).fill(0);
          t.needsUpdate = true;
        }
        return;
      }
      this.rgbPreview(rec.x0, this.x0Tex);
      this.channelGrid(rec.epsU, this.epsTex[0], 2.2);
      this.channelGrid(rec.epsC, this.epsTex[1], 2.2);
      this.channelGrid(rec.eps, this.epsTex[2], 2.2);
      const emb = timestepEmbedding(rec.t);
      const px = this.tembTex.image.data as Uint8Array;
      for (let i = 0; i < 320; i++) {
        diverging(emb[i], px, i * 4);
        px[i * 4 + 3] = 255;
      }
      this.tembTex.needsUpdate = true;
    }
  }

  /** z_0 through TAESD on the GPU, one convolution per frame so the scene keeps moving */
  async decode() {
    const r = this.run;
    const set = useLab.getState().set;
    if (!r?.z0 || this.decoding) return;
    if (!this.taesd) {
      set({ decode: { status: "error", stages: 0, ms: 0 } });
      return;
    }
    this.decoding = true;
    const run = useLab.getState().run;
    const t0 = performance.now();
    let stages = 0;
    set({ decode: { status: "running", stages: 0, ms: 0 } });
    try {
      const frame = () => new Promise<void>((res) => requestAnimationFrame(() => res()));
      const out = await this.taesd.decode(r.z0, L, L, {
        tick: async () => {
          await frame();
          if (useLab.getState().run !== run) throw new Error("superseded");
        },
        onStage: (v: StageView) => {
          this.fill(this.vaeTex[v.stage], v.rgba, v.w, v.h);
          stages = v.stage + 1;
          set({ decode: { status: "running", stages, ms: performance.now() - t0 } });
        },
      });
      this.fill(this.outTex, out.rgba, out.w, out.h);
      this.image = new ImageData(out.rgba, out.w, out.h);
      set({ decode: { status: "done", stages: 4, ms: performance.now() - t0 } });
    } catch (e) {
      if ((e as Error).message !== "superseded") {
        this.decodeError = (e as Error).message;
        set({ decode: { status: "error", stages, ms: 0 } });
      }
    } finally {
      this.decoding = false;
    }
  }

  private fill(t: THREE.DataTexture, rgba: Uint8ClampedArray, w: number, h: number) {
    const px = t.image.data as Uint8Array;
    for (let y = 0; y < h; y++) px.set(rgba.subarray(y * w * 4, (y + 1) * w * 4), (h - 1 - y) * w * 4);
    t.needsUpdate = true;
  }

  /** any latent through the real decoder, in one go: what A1111 and ComfyUI call a TAESD preview */
  async decodeImage(z: Float32Array) {
    if (!this.taesd || this.decoding) return null;
    this.decoding = true;
    try {
      const t0 = performance.now();
      const out = await this.taesd.decode(z, L, L);
      return { image: new ImageData(out.rgba, out.w, out.h), ms: performance.now() - t0 };
    } catch {
      return null;
    } finally {
      this.decoding = false;
    }
  }

  /** latent → RGB as an ImageData (row 0 at the top), for the panels' canvases */
  previewImage(z: Float32Array) {
    const M = this.assets.manifest.preview;
    const img = new ImageData(L, L);
    for (let p = 0; p < L * L; p++) {
      for (let c = 0; c < 3; c++) {
        let v = M[4][c];
        for (let k = 0; k < 4; k++) v += M[k][c] * z[k * L * L + p];
        img.data[p * 4 + c] = Math.round(v * 255);
      }
      img.data[p * 4 + 3] = 255;
    }
    return img;
  }

  /** a 4-channel tensor as a 2 × 2 grid on the diverging map, row 0 at the top */
  gridImage(e: Float32Array, scale = 2.2) {
    const W = 2 * L;
    const img = new ImageData(W, W);
    for (let c = 0; c < 4; c++)
      for (let y = 0; y < L; y++)
        for (let x = 0; x < L; x++) {
          const o = (((c >> 1) * L + y) * W + (c % 2) * L + x) * 4;
          diverging(e[c * L * L + y * L + x] / scale, img.data, o);
          img.data[o + 3] = 255;
        }
    return img;
  }

  /** the training image nearest the finished latent, and its RMS distance per latent value */
  nearest() {
    const z = this.run?.z0;
    if (!z) return null;
    let best = -1;
    let bd = Infinity;
    for (let i = 0; i < this.tr.N; i++) {
      let d = 0;
      const y = this.tr.data.subarray(i * D, (i + 1) * D);
      for (let k = 0; k < D; k++) d += (z[k] - y[k]) ** 2;
      if (d < bd) {
        bd = d;
        best = i;
      }
    }
    return { index: best, rms: Math.sqrt(bd / D) };
  }

  dispose() {
    this.taesd?.dispose();
    for (const t of [this.latA, this.latB, this.ztTex, this.x0Tex, ...this.epsTex, this.tembTex, ...this.vaeTex, this.outTex]) t.dispose();
  }
}

let lab: Lab | null = null;
export const getLab = () => lab;
export const setLab = (l: Lab | null) => (lab = l);

/** stage index helpers the scene uses to light things up */
export const DENOISE = stageIndex("denoise");
export const DECODE = stageIndex("decode");
