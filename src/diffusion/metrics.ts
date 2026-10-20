/**
 * Sample-quality metrics on xyz-packed point sets.
 * Precision / recall are the k-NN manifold estimates of Kynkäänniemi et al. 2019:
 * each set's support is the union of balls reaching its k-th nearest neighbour;
 * precision = share of generated samples inside the real support (fidelity),
 * recall = share of real samples inside the generated support (coverage, the thing memorisation and strong guidance lose).
 */

const KNN = 3;

/** every n-th point, so the subset spans the whole set */
export function subsample(src: Float32Array, count: number) {
  const n = src.length / 3;
  if (n <= count) return src;
  const out = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) out.set(src.subarray(Math.floor((i * n) / count) * 3, Math.floor((i * n) / count) * 3 + 3), i * 3);
  return out;
}

/** squared distance from each point to its k-th nearest neighbour in the same set */
function knnRadii2(p: Float32Array) {
  const n = p.length / 3;
  const out = new Float32Array(n);
  const best = new Float32Array(KNN);
  for (let i = 0; i < n; i++) {
    best.fill(Infinity);
    const x = p[i * 3];
    const y = p[i * 3 + 1];
    const z = p[i * 3 + 2];
    for (let j = 0; j < n; j++) {
      if (j === i) continue;
      const dx = p[j * 3] - x;
      const dy = p[j * 3 + 1] - y;
      const dz = p[j * 3 + 2] - z;
      const d = dx * dx + dy * dy + dz * dz;
      if (d < best[KNN - 1]) {
        let k = KNN - 1;
        while (k > 0 && best[k - 1] > d) {
          best[k] = best[k - 1];
          k--;
        }
        best[k] = d;
      }
    }
    out[i] = best[KNN - 1];
  }
  return out;
}

/** share of `a` that falls inside some ball of `b` */
function coverage(a: Float32Array, b: Float32Array, r2: Float32Array) {
  const na = a.length / 3;
  const nb = b.length / 3;
  let hit = 0;
  for (let i = 0; i < na; i++) {
    const x = a[i * 3];
    const y = a[i * 3 + 1];
    const z = a[i * 3 + 2];
    for (let j = 0; j < nb; j++) {
      const dx = b[j * 3] - x;
      const dy = b[j * 3 + 1] - y;
      const dz = b[j * 3 + 2] - z;
      if (dx * dx + dy * dy + dz * dz <= r2[j]) {
        hit++;
        break;
      }
    }
  }
  return hit / na;
}

const radiiCache = new WeakMap<Float32Array, Float32Array>();

export function precisionRecall(gen: Float32Array, real: Float32Array) {
  let rr = radiiCache.get(real);
  if (!rr) radiiCache.set(real, (rr = knnRadii2(real)));
  return { precision: coverage(gen, real, rr), recall: coverage(real, gen, knnRadii2(gen)) };
}

/** mean distance from each generated sample to the nearest point of the true shape */
export function distanceToShape(gen: Float32Array, real: Float32Array) {
  const na = gen.length / 3;
  const nb = real.length / 3;
  let sum = 0;
  for (let i = 0; i < na; i++) {
    let best = Infinity;
    const x = gen[i * 3];
    const y = gen[i * 3 + 1];
    const z = gen[i * 3 + 2];
    for (let j = 0; j < nb; j++) {
      const dx = real[j * 3] - x;
      const dy = real[j * 3 + 1] - y;
      const dz = real[j * 3 + 2] - z;
      const d = dx * dx + dy * dy + dz * dz;
      if (d < best) best = d;
    }
    sum += Math.sqrt(best);
  }
  return sum / na;
}
