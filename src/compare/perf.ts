/**
 * The comparison's performance model: a standing start to top speed for one car, from its
 * published figures (see the design spec). STUB: the types are the contract; `simulate` is a
 * placeholder until the model is built.
 */
import type { CarSpecs } from "@/content/carSpecs";

/** A run from rest, sampled every `dt` seconds. */
export type PerfTrace = {
  dt: number;
  /** time (s), speed (m/s), distance (m), acceleration (m/s²), engine rpm, gear (1-based), per sample */
  t: Float32Array;
  v: Float32Array;
  x: Float32Array;
  a: Float32Array;
  rpm: Float32Array;
  gear: Uint8Array;
  /** when each gear change began (s) */
  shifts: number[];
  marks: {
    zeroTo60mph: number | null;
    zeroTo100: number | null;
    zeroTo200: number | null;
    /** distance marks (s): 60 ft, 330 ft, 1/8 mile, 1000 ft, 1/4 mile, and the trap speeds (km/h) */
    ft60: number | null;
    ft330: number | null;
    eighth: number | null;
    eighthTrap: number | null;
    ft1000: number | null;
    quarter: number | null;
    quarterTrap: number | null;
  };
  /** the speed at which drag and rolling resistance use up all the power (km/h), or the redline in top gear */
  topSpeed: number;
  topLimit: "drag" | "redline";
  /** 100–0 km/h stopping distance (m) */
  braking100: number;
  /** modelled engine curve: rpm, torque (Nm), power (kW) */
  curve: { rpm: Float32Array; nm: Float32Array; kw: Float32Array };
};

export function simulate(spec: CarSpecs): PerfTrace {
  void spec;
  const n = 1;
  return {
    dt: 0.01,
    t: new Float32Array(n),
    v: new Float32Array(n),
    x: new Float32Array(n),
    a: new Float32Array(n),
    rpm: new Float32Array(n),
    gear: new Uint8Array(n),
    shifts: [],
    marks: { zeroTo60mph: null, zeroTo100: null, zeroTo200: null, ft60: null, ft330: null, eighth: null, eighthTrap: null, ft1000: null, quarter: null, quarterTrap: null },
    topSpeed: 0,
    topLimit: "drag",
    braking100: 0,
    curve: { rpm: new Float32Array(0), nm: new Float32Array(0), kw: new Float32Array(0) },
  };
}
