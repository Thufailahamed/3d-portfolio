import * as THREE from "three";
import { FullScreenQuad } from "three/examples/jsm/postprocessing/Pass.js";
import { K, gaussian, mulberry32, type Dataset } from "./datasets";
import { SIGMA_D } from "./denoiser";
import { plan, type SamplerId, type ScheduleId, type Step } from "./schedule";
import { DATA_W, denoiseFrag, quadVert, updateFrag } from "./shaders";

/**
 * The sampler on the GPU. Particles are texels of a float render target; one denoise pass evaluates the
 * exact score for every particle against every training point, one update pass takes the sampler step.
 * Snapshots of each step are read back and kept on the CPU (quantised), so the timeline can be scrubbed
 * and drawn with trails without recomputing anything.
 */

/** snapshots are int16 fixed point: ±8 at 1/4096 resolution, far finer than a particle */
export const Q = 4096;
/** at most this many snapshots per run; longer runs keep every n-th step */
const MAX_SNAPS = 250;
/** the score-field slice is a G × G grid across ±FIELD_HALF */
export const G = 26;
export const FIELD_HALF = 3.2;

export type RunParams = { schedule: ScheduleId; sampler: SamplerId; steps: number; cls: number; w: number; seed: number };

export type Run = RunParams & {
  plan: Step[];
  stride: number;
  /** snapshot j holds the state after step stepOf(j); the last is the finished sample */
  J: number;
  pos: Int16Array[];
  x0: Int16Array[];
  post: Uint8Array[];
  /** snapshots whose positions / predictions are filled in */
  posReady: number;
  denReady: number;
  /** next step to take */
  k: number;
  done: boolean;
  ms: number;
};

const rt = (w: number, h: number, count = 1) =>
  new THREE.WebGLRenderTarget(w, h, {
    count,
    type: THREE.FloatType,
    format: THREE.RGBAFormat,
    minFilter: THREE.NearestFilter,
    magFilter: THREE.NearestFilter,
    depthBuffer: false,
    stencilBuffer: false,
    generateMipmaps: false,
  });

const floatTex = (w: number, h: number, data = new Float32Array(w * h * 4)) => {
  const t = new THREE.DataTexture(data, w, h, THREE.RGBAFormat, THREE.FloatType);
  t.minFilter = t.magFilter = THREE.NearestFilter;
  t.needsUpdate = true;
  return t;
};

export function supported(gl: THREE.WebGLRenderer) {
  return gl.capabilities.isWebGL2 && gl.extensions.has("EXT_color_buffer_float");
}

export class Engine {
  readonly M: number;
  N = 0;
  run: Run | null = null;
  private dataTex: THREE.DataTexture;
  private inTex: THREE.DataTexture;
  private probeTex: THREE.DataTexture;
  private gridTex: THREE.DataTexture;
  private pos: THREE.WebGLRenderTarget[];
  private den: THREE.WebGLRenderTarget[];
  private probe: THREE.WebGLRenderTarget;
  readonly field: THREE.WebGLRenderTarget;
  private denoiseMat: THREE.ShaderMaterial;
  private updateMat: THREE.ShaderMaterial;
  private quad: FullScreenQuad;
  private buf: Float32Array;
  private pc = 0;
  private dc = 0;

  constructor(
    private gl: THREE.WebGLRenderer,
    readonly pw: number,
    readonly ph: number,
    readonly nMax: number,
  ) {
    this.M = pw * ph;
    this.dataTex = floatTex(DATA_W, Math.ceil((K * nMax) / DATA_W));
    this.inTex = floatTex(pw, ph);
    this.probeTex = floatTex(pw, ph);
    const grid = new Float32Array(G * G * 4);
    for (let j = 0; j < G; j++)
      for (let i = 0; i < G; i++) {
        const o = (j * G + i) * 4;
        grid[o] = -FIELD_HALF + ((i + 0.5) / G) * 2 * FIELD_HALF;
        grid[o + 2] = -FIELD_HALF + ((j + 0.5) / G) * 2 * FIELD_HALF;
      }
    this.gridTex = floatTex(G, G, grid);
    this.pos = [rt(pw, ph), rt(pw, ph)];
    this.den = [rt(pw, ph, 2), rt(pw, ph, 2)];
    this.probe = rt(pw, ph, 2);
    this.field = rt(G, G, 2);
    this.buf = new Float32Array(this.M * 4);
    const common = { glslVersion: THREE.GLSL3, vertexShader: quadVert, depthTest: false, depthWrite: false };
    this.denoiseMat = new THREE.ShaderMaterial({
      ...common,
      fragmentShader: denoiseFrag,
      uniforms: {
        uX: { value: null },
        uData: { value: this.dataTex },
        uN: { value: 0 },
        uK: { value: K },
        uCls: { value: -1 },
        uA: { value: 0 },
        uInv2S2: { value: 0 },
        uG: { value: 0 },
        uW: { value: 1 },
      },
    });
    this.updateMat = new THREE.ShaderMaterial({
      ...common,
      fragmentShader: updateFrag,
      uniforms: {
        uX: { value: null },
        uX0: { value: null },
        uX0Prev: { value: null },
        uCX: { value: 0 },
        uCA: { value: 0 },
        uCB: { value: 0 },
        uCZ: { value: 0 },
        uSeed: { value: 0 },
        uStep: { value: 0 },
      },
    });
    this.quad = new FullScreenQuad(this.denoiseMat);
  }

  /** the first n points of every class become the training set */
  setData(sets: Dataset[], n: number) {
    const arr = this.dataTex.image.data as Float32Array;
    arr.fill(0);
    for (let c = 0; c < K; c++)
      for (let j = 0; j < n; j++) {
        const o = (c * n + j) * 4;
        arr.set(sets[c].train.subarray(j * 3, j * 3 + 3), o);
      }
    this.dataTex.needsUpdate = true;
    this.N = n;
  }

  /** the noise x_T a seed starts from — also the ε the forward view noises with, so the two meet at t = 999 */
  noise(seed: number, out = new Float32Array(this.M * 3)) {
    const rnd = mulberry32(Math.imul(seed | 0, 0x9e3779b1));
    for (let i = 0; i < this.M * 3; i += 2) {
      const [a, b] = gaussian(rnd);
      out[i] = a;
      if (i + 1 < out.length) out[i + 1] = b;
    }
    return out;
  }

  private draw(mat: THREE.ShaderMaterial, target: THREE.WebGLRenderTarget) {
    const prev = this.gl.getRenderTarget();
    this.quad.material = mat;
    this.gl.setRenderTarget(target);
    this.quad.render(this.gl);
    this.gl.setRenderTarget(prev);
  }

  private denoise(src: THREE.Texture, ab: number, cls: number, w: number, target: THREE.WebGLRenderTarget) {
    const u = this.denoiseMat.uniforms;
    const s2 = ab * SIGMA_D * SIGMA_D + (1 - ab);
    u.uX.value = src;
    u.uN.value = this.N;
    u.uCls.value = cls;
    u.uA.value = Math.sqrt(ab);
    u.uInv2S2.value = 1 / (2 * s2);
    u.uG.value = (SIGMA_D * SIGMA_D * Math.sqrt(ab)) / s2;
    u.uW.value = w;
    this.draw(this.denoiseMat, target);
  }

  private read(target: THREE.WebGLRenderTarget, index: number) {
    this.gl.readRenderTargetPixels(target, 0, 0, this.pw, this.ph, this.buf, undefined, index);
    return this.buf;
  }

  private quantise(src: Float32Array, out: Int16Array) {
    for (let i = 0, j = 0; i < this.M; i++, j += 3) {
      out[j] = Math.max(-32767, Math.min(32767, Math.round(src[i * 4] * Q)));
      out[j + 1] = Math.max(-32767, Math.min(32767, Math.round(src[i * 4 + 1] * Q)));
      out[j + 2] = Math.max(-32767, Math.min(32767, Math.round(src[i * 4 + 2] * Q)));
    }
    return out;
  }

  private storeDen(target: THREE.WebGLRenderTarget, j: number) {
    const run = this.run!;
    run.x0[j] = this.quantise(this.read(target, 0), new Int16Array(this.M * 3));
    const p = this.read(target, 1);
    const post = new Uint8Array(this.M * 4);
    for (let i = 0; i < this.M * 4; i++) post[i] = Math.round(p[i] * 255);
    run.post[j] = post;
    run.denReady = j + 1;
  }

  start(p: RunParams) {
    const steps = plan(p.schedule, p.sampler, p.steps);
    const stride = Math.ceil(p.steps / MAX_SNAPS);
    const J = Math.ceil(p.steps / stride);
    const xT = this.noise(p.seed);
    const data = this.inTex.image.data as Float32Array;
    for (let i = 0; i < this.M; i++) data.set(xT.subarray(i * 3, i * 3 + 3), i * 4);
    this.inTex.needsUpdate = true;
    const q = new Int16Array(this.M * 3);
    for (let i = 0; i < q.length; i++) q[i] = Math.round(xT[i] * Q);
    this.run = { ...p, plan: steps, stride, J, pos: [q], x0: [], post: [], posReady: 1, denReady: 0, k: 0, done: false, ms: 0 };
  }

  /** snapshot index of step k, or −1 when that step isn't kept */
  private snapOf(k: number) {
    const r = this.run!;
    if (k === r.steps) return r.J;
    return k % r.stride === 0 ? k / r.stride : -1;
  }

  /** take as many steps as fit in the budget; returns true while there is more to do */
  advance(budgetMs: number) {
    const r = this.run;
    if (!r || r.done) return false;
    const t0 = performance.now();
    let taken = 0;
    do {
      const s0 = performance.now();
      if (r.k < r.steps) {
        const st = r.plan[r.k];
        const src = r.k === 0 ? this.inTex : this.pos[this.pc].texture;
        const den = this.den[this.dc];
        this.denoise(src, st.abT, r.cls, r.w, den);
        const j = this.snapOf(r.k);
        if (j >= 0) this.storeDen(den, j);
        const u = this.updateMat.uniforms;
        u.uX.value = src;
        u.uX0.value = den.textures[0];
        u.uX0Prev.value = this.den[1 - this.dc].textures[0];
        u.uCX.value = st.cX;
        u.uCA.value = st.cA;
        u.uCB.value = st.cB;
        u.uCZ.value = st.cZ;
        u.uSeed.value = r.seed >>> 0;
        u.uStep.value = r.k;
        const out = this.pos[1 - this.pc];
        this.draw(this.updateMat, out);
        this.pc = 1 - this.pc;
        this.dc = 1 - this.dc;
        r.k++;
        const jn = this.snapOf(r.k);
        if (jn >= 0) {
          r.pos[jn] = this.quantise(this.read(out, 0), new Int16Array(this.M * 3));
          r.posReady = jn + 1;
        }
      } else {
        // the finished sample: its class posterior at ᾱ = 1, where x̂0 is the sample itself
        this.denoise(this.pos[this.pc].texture, 1, r.cls, r.w, this.den[this.dc]);
        this.storeDen(this.den[this.dc], r.J);
        r.done = true;
      }
      const dt = performance.now() - s0;
      r.ms = r.ms ? r.ms * 0.85 + dt * 0.15 : dt;
      taken++;
    } while (!r.done && performance.now() - t0 + r.ms < budgetMs);
    return !r.done && taken > 0;
  }

  /** step index a snapshot was taken after */
  stepOf(j: number) {
    const r = this.run!;
    return Math.min(j * r.stride, r.steps);
  }

  /** the denoiser on an arbitrary state (the forward view): predictions and posterior into out arrays */
  probeState(state: Float32Array, ab: number, cls: number, w: number, x0: Float32Array, post: Uint8Array) {
    const data = this.probeTex.image.data as Float32Array;
    for (let i = 0; i < this.M; i++) data.set(state.subarray(i * 3, i * 3 + 3), i * 4);
    this.probeTex.needsUpdate = true;
    this.denoise(this.probeTex, ab, cls, w, this.probe);
    const a = this.read(this.probe, 0);
    for (let i = 0; i < this.M; i++) x0.set(a.subarray(i * 4, i * 4 + 3), i * 3);
    const p = this.read(this.probe, 1);
    for (let i = 0; i < this.M * 4; i++) post[i] = Math.round(p[i] * 255);
  }

  /** the score on the horizontal slice through the origin, left on the GPU for the arrows */
  computeField(ab: number, cls: number, w: number) {
    this.denoise(this.gridTex, ab, cls, w, this.field);
  }

  get grid() {
    return this.gridTex;
  }

  dispose() {
    this.dataTex.dispose();
    this.inTex.dispose();
    this.probeTex.dispose();
    this.gridTex.dispose();
    [...this.pos, ...this.den, this.probe, this.field].forEach((t) => t.dispose());
    this.denoiseMat.dispose();
    this.updateMat.dispose();
    this.quad.dispose();
  }
}

/** int16 snapshot → float xyz */
export function dequantise(src: Int16Array, out: Float32Array) {
  for (let i = 0; i < src.length; i++) out[i] = src[i] / Q;
  return out;
}
