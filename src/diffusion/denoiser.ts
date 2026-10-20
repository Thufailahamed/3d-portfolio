/**
 * The "network": the exact minimum-MSE denoiser E[x0 | x_t] for a smoothed training set.
 *
 * A real model is trained to minimise E‖ε − ε_θ(x_t, t)‖², whose optimum is the posterior mean (Tweedie).
 * For a finite dataset that optimum has a closed form, so this lab uses it instead of a network.
 * The data distribution is a kernel density estimate: each training point y_i is a small Gaussian N(y_i, σ_d² I).
 * Noising it at level t gives a mixture of N(√ᾱ y_i, s² I) with s² = ᾱσ_d² + 1 − ᾱ, and
 *
 *   w_i  = softmax_i( −‖x_t − √ᾱ y_i‖² / 2s² )          posterior over training points
 *   ȳ    = Σ w_i y_i
 *   x̂0   = (1 − g√ᾱ) ȳ + g x_t,   g = σ_d² √ᾱ / s²       per-component posterior mean, averaged
 *   ∇log p_t(x_t) = (√ᾱ ȳ − x_t) / s²
 *
 * Guidance mixes the unconditional (all classes) and conditional (one class) predictions:
 *   x̂0 = x̂0_u + w (x̂0_c − x̂0_u)   — identical to guiding ε, since ε̂ is affine in x̂0 at a fixed t.
 * The GPU shader in shaders.ts is a line-for-line port of this function.
 */

/** bandwidth of the smoothing kernel around each training point, in data units (shapes span about ±1.75) */
export const SIGMA_D = 0.03;

export type DenoiseOut = { x0: [number, number, number]; post: number[] };

/** data: K classes × N points, xyz packed; cls = −1 for unconditional */
export function denoise(x: ArrayLike<number>, data: Float32Array, K: number, N: number, ab: number, cls: number, w: number): DenoiseOut {
  const a = Math.sqrt(ab);
  const s2 = ab * SIGMA_D * SIGMA_D + (1 - ab);
  const inv2s2 = 1 / (2 * s2);
  const g = (SIGMA_D * SIGMA_D * a) / s2;
  const m: number[] = [];
  const sum: number[] = [];
  const acc: [number, number, number][] = [];
  for (let c = 0; c < K; c++) {
    // online log-sum-exp, so tiny noise levels never underflow
    let mc = -Infinity;
    let sc = 0;
    let ax = 0;
    let ay = 0;
    let az = 0;
    for (let j = 0; j < N; j++) {
      const i = (c * N + j) * 3;
      const yx = data[i];
      const yy = data[i + 1];
      const yz = data[i + 2];
      const dx = x[0] - a * yx;
      const dy = x[1] - a * yy;
      const dz = x[2] - a * yz;
      const l = -(dx * dx + dy * dy + dz * dz) * inv2s2;
      if (l > mc) {
        const r = Math.exp(mc - l);
        sc = sc * r + 1;
        ax = ax * r + yx;
        ay = ay * r + yy;
        az = az * r + yz;
        mc = l;
      } else {
        const e = Math.exp(l - mc);
        sc += e;
        ax += e * yx;
        ay += e * yy;
        az += e * yz;
      }
    }
    m.push(mc);
    sum.push(sc);
    acc.push([ax, ay, az]);
  }
  const M = Math.max(...m);
  let Z = 0;
  const zc = m.map((mc, c) => {
    const v = sum[c] * Math.exp(mc - M);
    Z += v;
    return v;
  });
  const post = zc.map((v) => v / Z);
  const yu = [0, 0, 0];
  for (let c = 0; c < K; c++) {
    const k = Math.exp(m[c] - M) / Z;
    for (let d = 0; d < 3; d++) yu[d] += acc[c][d] * k;
  }
  const lift = (y: number[], d: number) => (1 - g * a) * y[d] + g * x[d];
  const x0u = [lift(yu, 0), lift(yu, 1), lift(yu, 2)];
  if (cls < 0) return { x0: [x0u[0], x0u[1], x0u[2]], post };
  const yc = acc[cls].map((v) => v / sum[cls]);
  const x0c = [lift(yc, 0), lift(yc, 1), lift(yc, 2)];
  return {
    x0: [x0u[0] + w * (x0c[0] - x0u[0]), x0u[1] + w * (x0c[1] - x0u[1]), x0u[2] + w * (x0c[2] - x0u[2])],
    post,
  };
}
