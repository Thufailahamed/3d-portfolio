import { plan, type SamplerId, type ScheduleId, type Step } from "../schedule";
import { gaussian, mulberry32 } from "./rng";

/**
 * The reverse process in Stable Diffusion's latent space, step by step, with every intermediate kept.
 *
 * SD's U-Net ε_θ is trained to minimise E‖ε − ε_θ(z_t, t, c)‖², whose optimum is the posterior mean (Tweedie):
 *   ε* = (z_t − √ᾱ E[z0 | z_t, c]) / √(1 − ᾱ).
 * No 860M-parameter network runs in a browser, so a closed-form denoiser stands in for it, built from what is
 * known about what trained U-Nets actually compute:
 *
 *  · high noise — the Gaussian score. A trained network's denoiser is close to the Wiener filter of the data's
 *    mean μ and covariance Σ (Wang & Vastola 2023). In Σ's eigenbasis (λ_k, u_k):
 *      ẑ0_G = μ + Σ_k  √ᾱ λ_k / (ᾱ λ_k + 1 − ᾱ) · ⟨z_t − √ᾱ μ, u_k⟩ u_k
 *    Large-variance directions (layout, colour) are recovered first, fine detail last.
 *  · low noise — the exact score of the training set, smoothed by N(0, σ_d² I):
 *      w_i = softmax_i(−‖z_t − √ᾱ y_i‖² / 2s²),  s² = ᾱσ_d² + 1 − ᾱ,  ẑ0_E = (1 − g√ᾱ) Σ w_i y_i + g z_t,  g = σ_d²√ᾱ / s²
 *
 *  ẑ0 = (1 − β_t) ẑ0_G + β_t ẑ0_E, with β_t rising smoothly in log-SNR. Each prompt gets its own μ, Σ and images;
 *  the unconditional model uses all of them. Then classifier-free guidance on ε and the sampler's update.
 */

export const SIGMA_D = 0.05;
/** log-SNR window over which the denoiser hands over from the Gaussian to the exact score */
export const HANDOVER = [-2.2, 1.2] as const;

export type Params = { cls: number; steps: number; sampler: SamplerId; schedule: ScheduleId; w: number; seed: number };

export type Gauss = {
  mu: Float32Array;
  /** m unit eigenvectors of the sample covariance, row-major m × D */
  U: Float32Array;
  lam: Float64Array;
  m: number;
};

export type Training = {
  /** N latents, D = 4·64·64 values each, CHW */
  data: Float32Array;
  N: number;
  D: number;
  cls: Int8Array;
  norm2: Float64Array;
  /** one Gaussian per prompt, and one for everything (index K) */
  gauss: Gauss[];
};

export type StepRecord = Step & {
  k: number;
  /** z_t entering the step */
  z: Float32Array;
  epsU: Float32Array;
  epsC: Float32Array;
  /** guided noise prediction and the clean latent it implies */
  eps: Float32Array;
  x0: Float32Array;
  /** posterior over training images: unconditional and under the prompt (zeros outside the class) */
  postU: Float32Array;
  postC: Float32Array;
  /** weight of the exact score in the denoiser at this noise level */
  beta: number;
  /** ‖ε̂_c − ε̂_∅‖ / √D: how much the prompt changes the prediction */
  gap: number;
  ms: number;
};

export type Run = {
  params: Params;
  plan: Step[];
  zT: Float32Array;
  steps: StepRecord[];
  /** the finished latent z_0, once every step has run */
  z0: Float32Array | null;
};

/** symmetric eigendecomposition by cyclic Jacobi rotations; A (n × n, row-major) is destroyed */
function eigh(A: Float64Array, n: number) {
  const V = new Float64Array(n * n);
  for (let i = 0; i < n; i++) V[i * n + i] = 1;
  for (let sweep = 0; sweep < 60; sweep++) {
    let off = 0;
    for (let p = 0; p < n; p++) for (let q = p + 1; q < n; q++) off += A[p * n + q] ** 2;
    if (off < 1e-18) break;
    for (let p = 0; p < n; p++)
      for (let q = p + 1; q < n; q++) {
        const apq = A[p * n + q];
        if (Math.abs(apq) < 1e-30) continue;
        const theta = (A[q * n + q] - A[p * n + p]) / (2 * apq);
        const t = Math.sign(theta || 1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1));
        const c = 1 / Math.sqrt(t * t + 1);
        const s = t * c;
        for (let k = 0; k < n; k++) {
          const akp = A[k * n + p];
          const akq = A[k * n + q];
          A[k * n + p] = c * akp - s * akq;
          A[k * n + q] = s * akp + c * akq;
        }
        for (let k = 0; k < n; k++) {
          const apk = A[p * n + k];
          const aqk = A[q * n + k];
          A[p * n + k] = c * apk - s * aqk;
          A[q * n + k] = s * apk + c * aqk;
        }
        for (let k = 0; k < n; k++) {
          const vkp = V[k * n + p];
          const vkq = V[k * n + q];
          V[k * n + p] = c * vkp - s * vkq;
          V[k * n + q] = s * vkp + c * vkq;
        }
      }
  }
  return { values: Float64Array.from({ length: n }, (_, i) => A[i * n + i]), vectors: V };
}

/** mean and principal axes of a set of latents, through the n × n Gram matrix (n ≪ D) */
export function fitGaussian(data: Float32Array, D: number, idx: number[]): Gauss {
  const n = idx.length;
  const mu = new Float32Array(D);
  for (const i of idx) for (let d = 0; d < D; d++) mu[d] += data[i * D + d] / n;
  const C = idx.map((i) => {
    const r = new Float32Array(D);
    for (let d = 0; d < D; d++) r[d] = data[i * D + d] - mu[d];
    return r;
  });
  const G = new Float64Array(n * n);
  for (let a = 0; a < n; a++)
    for (let b = a; b < n; b++) {
      let s = 0;
      for (let d = 0; d < D; d++) s += C[a][d] * C[b][d];
      G[a * n + b] = G[b * n + a] = s / n;
    }
  const { values, vectors } = eigh(G, n);
  const top = Math.max(...values);
  const keep = [...values.keys()].filter((k) => values[k] > 1e-6 * top).sort((a, b) => values[b] - values[a]);
  const m = keep.length;
  const U = new Float32Array(m * D);
  const lam = new Float64Array(m);
  keep.forEach((k, j) => {
    lam[j] = values[k];
    // u = Cᵀ v / √(n λ): the covariance's eigenvector from the Gram matrix's
    const row = U.subarray(j * D, (j + 1) * D);
    for (let a = 0; a < n; a++) {
      const v = vectors[a * n + k] / Math.sqrt(n * values[k]);
      for (let d = 0; d < D; d++) row[d] += v * C[a][d];
    }
  });
  return { mu, U, lam, m };
}

export function makeTraining(latents: Float32Array, N: number, cls: Int8Array, K: number): Training {
  const D = latents.length / N;
  const norm2 = new Float64Array(N);
  for (let i = 0; i < N; i++) {
    let s = 0;
    for (let k = i * D; k < (i + 1) * D; k++) s += latents[k] * latents[k];
    norm2[i] = s;
  }
  const all = [...Array(N).keys()];
  const sets = [...Array.from({ length: K }, (_, c) => all.filter((i) => cls[i] === c)), all];
  return { data: latents, N, D, cls, norm2, gauss: sets.map((idx) => fitGaussian(latents, D, idx)) };
}

/** z_T ~ N(0, I) for a seed */
export function initialNoise(seed: number, D: number) {
  const rnd = mulberry32(Math.imul(seed | 0, 0x9e3779b1) ^ 0x51ed);
  const out = new Float32Array(D);
  for (let i = 0; i < D; i += 2) {
    const [a, b] = gaussian(rnd);
    out[i] = a;
    if (i + 1 < D) out[i + 1] = b;
  }
  return out;
}

/** weight of the exact score at ᾱ: a smoothstep across the handover window in log-SNR */
export function handover(ab: number) {
  const l = Math.log(ab / (1 - ab));
  const u = Math.min(1, Math.max(0, (l - HANDOVER[0]) / (HANDOVER[1] - HANDOVER[0])));
  return u * u * (3 - 2 * u);
}

export class Sampler {
  run: Run;
  private x0Prev: Float32Array | null = null;
  private next: Float32Array | null = null;
  private logit: Float64Array;
  private tmp: Float32Array;

  constructor(
    private tr: Training,
    params: Params,
  ) {
    const zT = initialNoise(params.seed, tr.D);
    this.run = { params, plan: plan(params.schedule, params.sampler, params.steps), zT, steps: [], z0: null };
    this.logit = new Float64Array(tr.N);
    this.tmp = new Float32Array(tr.D);
  }

  get done() {
    return this.run.z0 !== null;
  }

  /** ε̂ from one model — a prompt's (set = its class) or the unconditional one (set = K) */
  private predict(z: Float32Array, ab: number, set: number, beta: number, post: Float32Array, eps: Float32Array) {
    const { tr, tmp } = this;
    const { D } = tr;
    const a = Math.sqrt(ab);
    const b = Math.sqrt(1 - ab);
    const K = tr.gauss.length - 1;
    const keep = (i: number) => set === K || tr.cls[i] === set;

    // exact: posterior over the set's images
    let m = -Infinity;
    for (let i = 0; i < tr.N; i++) if (keep(i) && this.logit[i] > m) m = this.logit[i];
    let Z = 0;
    for (let i = 0; i < tr.N; i++) {
      post[i] = keep(i) ? Math.exp(this.logit[i] - m) : 0;
      Z += post[i];
    }
    for (let i = 0; i < tr.N; i++) post[i] /= Z;
    const s2 = ab * SIGMA_D * SIGMA_D + (1 - ab);
    const g = (SIGMA_D * SIGMA_D * a) / s2;
    tmp.fill(0);
    for (let i = 0; i < tr.N; i++) {
      const wi = post[i] * (1 - g * a);
      if (wi < 1e-9) continue;
      const y = tr.data.subarray(i * D, (i + 1) * D);
      for (let d = 0; d < D; d++) tmp[d] += wi * y[d];
    }
    for (let d = 0; d < D; d++) tmp[d] = beta * (tmp[d] + g * z[d]);

    // Gaussian: Wiener filter in the set's principal axes
    if (beta < 1) {
      const G = tr.gauss[set];
      const k0 = 1 - beta;
      for (let d = 0; d < D; d++) tmp[d] += k0 * G.mu[d];
      for (let j = 0; j < G.m; j++) {
        const u = G.U.subarray(j * D, (j + 1) * D);
        let r = 0;
        for (let d = 0; d < D; d++) r += (z[d] - a * G.mu[d]) * u[d];
        const c = (k0 * a * G.lam[j] * r) / (ab * G.lam[j] + 1 - ab);
        for (let d = 0; d < D; d++) tmp[d] += c * u[d];
      }
    }
    for (let d = 0; d < D; d++) eps[d] = (z[d] - a * tmp[d]) / b;
  }

  /** take the next step; returns false once z_0 is reached */
  step() {
    const { tr, run } = this;
    const { D } = tr;
    const k = run.steps.length;
    if (k >= run.plan.length) return false;
    const t0 = performance.now();
    const st = run.plan[k];
    const z = k === 0 ? run.zT : this.next!;
    const { cls, w } = run.params;
    const ab = st.abT;
    const a = Math.sqrt(ab);
    const b = Math.sqrt(1 - ab);
    const s2 = ab * SIGMA_D * SIGMA_D + (1 - ab);
    const beta = handover(ab);

    // ‖z − √ᾱ y_i‖² = ‖z‖² − 2√ᾱ⟨z, y_i⟩ + ᾱ‖y_i‖², shared by both halves of the guidance batch
    let zz = 0;
    for (let d = 0; d < D; d++) zz += z[d] * z[d];
    for (let i = 0; i < tr.N; i++) {
      const y = tr.data.subarray(i * D, (i + 1) * D);
      let dot = 0;
      for (let d = 0; d < D; d++) dot += z[d] * y[d];
      this.logit[i] = -(zz - 2 * a * dot + ab * tr.norm2[i]) / (2 * s2);
    }

    const rec: StepRecord = {
      ...st,
      k,
      z,
      epsU: new Float32Array(D),
      epsC: new Float32Array(D),
      eps: new Float32Array(D),
      x0: new Float32Array(D),
      postU: new Float32Array(tr.N),
      postC: new Float32Array(tr.N),
      beta,
      gap: 0,
      ms: 0,
    };
    const K = tr.gauss.length - 1;
    this.predict(z, ab, K, beta, rec.postU, rec.epsU);
    if (cls >= 0) this.predict(z, ab, cls, beta, rec.postC, rec.epsC);
    else {
      rec.epsC.set(rec.epsU);
      rec.postC.set(rec.postU);
    }
    // ε̂ = ε̂_∅ + w (ε̂_c − ε̂_∅), and the clean latent it implies
    const wg = cls >= 0 ? w : 1;
    let gap = 0;
    for (let d = 0; d < D; d++) {
      const diff = rec.epsC[d] - rec.epsU[d];
      gap += diff * diff;
      rec.eps[d] = rec.epsU[d] + wg * diff;
      rec.x0[d] = (z[d] - b * rec.eps[d]) / a;
    }
    rec.gap = Math.sqrt(gap / D);

    // z_s = cX z_t + cA ẑ0 + cB ẑ0_prev + cZ ξ — DDPM, DDIM and DPM-Solver++ 2M all take this form (schedule.ts)
    const out = new Float32Array(D);
    const rnd = st.cZ ? mulberry32((run.params.seed * 0x2545f491) ^ (k * 0x9e3779b9)) : null;
    for (let d = 0; d < D; d += 2) {
      const [n0, n1] = rnd ? gaussian(rnd) : [0, 0];
      for (let e = 0; e < 2 && d + e < D; e++) {
        const i = d + e;
        let v = st.cX * z[i] + st.cA * rec.x0[i];
        if (st.cB && this.x0Prev) v += st.cB * this.x0Prev[i];
        if (st.cZ) v += st.cZ * (e ? n1 : n0);
        out[i] = v;
      }
    }
    this.x0Prev = rec.x0;
    this.next = out;
    rec.ms = performance.now() - t0;
    run.steps.push(rec);
    if (run.steps.length === run.plan.length) run.z0 = out;
    return true;
  }
}

/** indices of the k most probable training images, with their weights */
export function topK(post: Float32Array, k: number) {
  return Array.from(post, (p, i) => [i, p] as const)
    .sort((a, b) => b[1] - a[1])
    .slice(0, k);
}

/** the posterior's effective number of images, 1 / Σ w² */
export function effectiveCount(post: Float32Array) {
  let s = 0;
  for (const p of post) s += p * p;
  return s > 0 ? 1 / s : 0;
}
