/**
 * Crash-data processing as the test labs do it: the SAE J211-1 channel frequency class filters, and
 * the injury and severity measures computed from filtered signals (HIC, the 3 ms clip, the occupant
 * load criterion). Pure functions on uniformly sampled arrays.
 */

/**
 * SAE J211-1 CFC filter: a 2-pole Butterworth run forward and then backward over the signal (4-pole,
 * no phase shift), with the standard's coefficients. `dt` in seconds; CFC 60 for vehicle structure,
 * 180 for the occupant's torso, 1000 for the head.
 */
export function cfc(x: ArrayLike<number>, dt: number, cls: 60 | 180 | 600 | 1000): Float64Array {
  const n = x.length;
  const out = new Float64Array(n);
  if (n < 3) {
    for (let i = 0; i < n; i++) out[i] = x[i];
    return out;
  }
  const wd = 2 * Math.PI * cls * 2.0775;
  const wa = Math.tan((wd * dt) / 2);
  const den = 1 + Math.SQRT2 * wa + wa * wa;
  const a0 = (wa * wa) / den, a1 = 2 * a0, a2 = a0;
  const b1 = (-2 * (wa * wa - 1)) / den;
  const b2 = (-1 + Math.SQRT2 * wa - wa * wa) / den;
  const pass = (src: Float64Array, dst: Float64Array) => {
    // start from the first value held steady, so the filter doesn't ring at the ends
    let x1 = src[0], x2 = src[0], y1 = src[0], y2 = src[0];
    for (let i = 0; i < src.length; i++) {
      const xi = src[i];
      const y = a0 * xi + a1 * x1 + a2 * x2 + b1 * y1 + b2 * y2;
      x2 = x1;
      x1 = xi;
      y2 = y1;
      y1 = y;
      dst[i] = y;
    }
  };
  const fwd = new Float64Array(n);
  pass(Float64Array.from(x), fwd);
  fwd.reverse();
  pass(fwd, out);
  return out.reverse();
}

/** HIC over windows up to `maxMs` (15 ms for HIC15), from a resultant acceleration in g sampled every dt. */
export function hic(aG: ArrayLike<number>, dt: number, maxMs = 15): number {
  const n = aG.length;
  const cum = new Float64Array(n + 1);
  for (let i = 0; i < n; i++) cum[i + 1] = cum[i] + Math.max(0, aG[i]) * dt;
  const w = Math.max(1, Math.round(maxMs / 1000 / dt));
  let best = 0;
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j <= Math.min(n, i + w); j++) {
      const T = (j - i) * dt;
      const avg = (cum[j] - cum[i]) / T;
      const v = T * avg ** 2.5;
      if (v > best) best = v;
    }
  }
  return best;
}

/** The 3 ms clip: the highest level the acceleration (g) stays at or above for a cumulative 3 ms. */
export function clip3ms(aG: ArrayLike<number>, dt: number): number {
  const sorted = Array.from(aG, (v) => Math.abs(v)).sort((a, b) => b - a);
  const k = Math.max(0, Math.min(sorted.length - 1, Math.round(0.003 / dt) - 1));
  return sorted[k] ?? 0;
}

/**
 * Occupant load criterion (g): a virtual occupant keeps the vehicle's initial velocity until it has
 * moved 65 mm relative to the vehicle, then decelerates at a constant rate that brings it to the
 * vehicle's velocity after a further 235 mm. That constant rate is the OLC. `v` is the vehicle's
 * velocity along the impact (m/s, sampled every dt from first contact), positive forward.
 */
export function olc(v: ArrayLike<number>, dt: number): number {
  const n = v.length;
  if (n < 3) return 0;
  const v0 = v[0];
  const sign = Math.sign(v0) || 1;
  // free flight: relative displacement s(t) = ∫ (v0 − v) dt
  let s = 0, i1 = -1;
  for (let i = 1; i < n; i++) {
    s += sign * (v0 - (v[i] + v[i - 1]) / 2) * dt;
    if (s >= 0.065) {
      i1 = i;
      break;
    }
  }
  if (i1 < 0) return 0;
  const t1 = i1 * dt;
  // restraint phase: for a candidate end t2, the deceleration that meets the vehicle there, and the
  // relative travel it implies; find the t2 that gives 235 mm
  let lo = i1 + 1, hi = n - 1;
  const travel = (i2: number) => {
    const t2 = i2 * dt;
    const decel = (sign * (v0 - v[i2])) / (t2 - t1);
    let rel = 0;
    for (let i = i1 + 1; i <= i2; i++) {
      const tm = (i - 0.5) * dt;
      const vo = v0 - sign * decel * (tm - t1);
      rel += sign * (vo - (v[i] + v[i - 1]) / 2) * dt;
    }
    return { rel, decel };
  };
  if (travel(hi).rel < 0.235) return travel(hi).decel / 9.81;
  for (let it = 0; it < 40 && hi - lo > 1; it++) {
    const mid = (lo + hi) >> 1;
    if (travel(mid).rel < 0.235) lo = mid;
    else hi = mid;
  }
  return travel(hi).decel / 9.81;
}
