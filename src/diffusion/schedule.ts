/**
 * Noise schedules, timestep spacing and sampler update rules for a variance-preserving diffusion model.
 * Everything here is plain arithmetic shared by the GPU engine, the HUD and the reference tests.
 *
 * Notation (Ho et al. 2020): ᾱ_t = Π(1 − β_i), q(x_t | x_0) = N(√ᾱ_t x_0, (1 − ᾱ_t) I).
 * Every update below is written as x_s = cX·x_t + cA·x̂0 + cB·x̂0_prev + cZ·z, so one shader runs all samplers.
 */

/** training timesteps, as in DDPM */
export const T = 1000;

export type ScheduleId = "cosine" | "linear" | "scaled";
export type SamplerId = "ddpm" | "ddim" | "dpm2m";

export const SCHEDULES: { id: ScheduleId; label: string; note: string }[] = [
  { id: "cosine", label: "Cosine", note: "Nichol & Dhariwal 2021: destroys signal evenly; ᾱ reaches ~0 at t = 999." },
  { id: "linear", label: "Linear", note: "Ho et al. 2020: β from 1e-4 to 0.02. Most of the signal is gone by t ≈ 600." },
  { id: "scaled", label: "Scaled linear", note: "Stable Diffusion's schedule. ᾱ₉₉₉ ≈ 0.0047, so a little signal is never destroyed (Lin et al. 2023)." },
];

export const SAMPLERS: { id: SamplerId; label: string; note: string }[] = [
  { id: "ddpm", label: "DDPM", note: "Ancestral sampling: each step denoises, then adds fresh noise (η = 1)." },
  { id: "ddim", label: "DDIM", note: "Deterministic (η = 0): the same seed always lands on the same sample." },
  { id: "dpm2m", label: "DPM-Solver++ 2M", note: "Second-order multistep ODE solver: good samples in 10–25 steps." },
];

const cache = new Map<ScheduleId, Float64Array>();

/** ᾱ_t for t = 0 … T−1 */
export function alphaBars(id: ScheduleId): Float64Array {
  const hit = cache.get(id);
  if (hit) return hit;
  const betas = new Float64Array(T);
  if (id === "cosine") {
    const s = 0.008;
    const f = (t: number) => Math.cos((((t / T) + s) / (1 + s)) * Math.PI * 0.5) ** 2;
    for (let t = 0; t < T; t++) betas[t] = Math.min(1 - f(t + 1) / f(t), 0.999);
  } else if (id === "linear") {
    for (let t = 0; t < T; t++) betas[t] = 1e-4 + ((0.02 - 1e-4) * t) / (T - 1);
  } else {
    const a = Math.sqrt(0.00085);
    const b = Math.sqrt(0.012);
    for (let t = 0; t < T; t++) betas[t] = (a + ((b - a) * t) / (T - 1)) ** 2;
  }
  const ab = new Float64Array(T);
  let p = 1;
  for (let t = 0; t < T; t++) {
    p *= 1 - betas[t];
    ab[t] = p;
  }
  cache.set(id, ab);
  return ab;
}

/** ᾱ at a timestep; t = −1 is clean data (ᾱ = 1) */
export function alphaBarAt(id: ScheduleId, t: number) {
  return t < 0 ? 1 : alphaBars(id)[Math.min(T - 1, Math.round(t))];
}

/** signal-to-noise ratio ᾱ / (1 − ᾱ) in decibels */
export function snrDb(ab: number) {
  if (ab >= 1) return Infinity;
  return 10 * Math.log10(ab / (1 - ab));
}

/** "trailing" spacing (Lin et al. 2023): always starts at t = T − 1, so the first step sees pure noise */
export function timesteps(n: number): number[] {
  const out: number[] = [];
  for (let k = 0; k < n; k++) out.push(Math.round(T - (k * T) / n) - 1);
  return out;
}

export type Step = {
  /** timestep this step starts from, and the one it lands on (−1 = clean) */
  t: number;
  s: number;
  abT: number;
  abS: number;
  cX: number;
  cA: number;
  cB: number;
  cZ: number;
};

/**
 * The full sampling plan: one entry per network evaluation.
 * DDPM and DDIM are the two ends of the DDIM family (Song et al. 2021, eq. 12):
 *   x_s = √ᾱ_s x̂0 + √(1 − ᾱ_s − σ²) ε̂ + σ z,  σ = η √((1 − ᾱ_s)/(1 − ᾱ_t)) √(1 − ᾱ_t/ᾱ_s)
 * with ε̂ = (x_t − √ᾱ_t x̂0) / √(1 − ᾱ_t). η = 1 reproduces DDPM's posterior variance β̃ when every step is taken.
 * DPM-Solver++(2M) (Lu et al. 2022) works in data prediction with λ = log(α/σ):
 *   x_s = (σ_s/σ_t) x_t + α_s (1 − e^{−h}) D,  D = (1 + 1/2r) x̂0 − (1/2r) x̂0_prev,  r = h_prev / h
 * first and last steps are first order (the last lands on σ = 0, where λ = ∞).
 */
export function plan(schedule: ScheduleId, sampler: SamplerId, n: number): Step[] {
  const ts = timesteps(n);
  const steps: Step[] = [];
  let hPrev = 0;
  for (let k = 0; k < n; k++) {
    const t = ts[k];
    const s = k + 1 < n ? ts[k + 1] : -1;
    const abT = alphaBarAt(schedule, t);
    const abS = alphaBarAt(schedule, s);
    const aT = Math.sqrt(abT);
    const sT = Math.sqrt(1 - abT);
    const aS = Math.sqrt(abS);
    const sS = Math.sqrt(1 - abS);
    let cX = 0;
    let cA = 0;
    let cB = 0;
    let cZ = 0;
    if (sampler === "dpm2m") {
      const last = s < 0;
      const h = last ? Infinity : Math.log(aS / sS) - Math.log(aT / sT);
      const phi = last ? aS : aS * -Math.expm1(-h);
      cX = last ? 0 : sS / sT;
      if (k === 0 || last) cA = phi;
      else {
        const r = hPrev / h;
        cA = phi * (1 + 1 / (2 * r));
        cB = -phi / (2 * r);
      }
      hPrev = h;
    } else {
      const eta = sampler === "ddpm" ? 1 : 0;
      const sigma = eta * Math.sqrt((1 - abS) / (1 - abT)) * Math.sqrt(Math.max(0, 1 - abT / abS));
      const kEps = Math.sqrt(Math.max(0, 1 - abS - sigma * sigma)) / sT;
      cX = kEps;
      cA = aS - kEps * aT;
      cZ = sigma;
    }
    steps.push({ t, s, abT, abS, cX, cA, cB, cZ });
  }
  return steps;
}

/** network evaluations per sample: guidance needs a conditional and an unconditional pass */
export function nfe(steps: number, guided: boolean) {
  return steps * (guided ? 2 : 1);
}
