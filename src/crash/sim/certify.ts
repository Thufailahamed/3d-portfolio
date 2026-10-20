/**
 * The side trolley's face certification, run through the solver: the specification has a 1,300 kg
 * trolley driven into a rigid wall at 35 km/h, and requires the honeycomb to absorb 61.5 ± 5 kJ and
 * deform 346 ± 20 mm. Used by scripts/crash/check.mjs to prove the trolley model before it is aimed at
 * a car.
 */
import { mdb, wall } from "./bodies";
import { solveLayout } from "./solve";
import { NB, NS } from "./types";

export function mdbCertification() {
  const t = { ...mdb(), id: "a" as const, mass: 1300 };
  const w = wall(0.02, 5);
  const tl = solveLayout(
    { test: "wall", a: "mdb", va: 35, vb: 0, overlap: 1, angle: 0, brakes: "free" },
    {
      bodies: [t, w],
      init: [
        { x: 0, z: 0, yaw: 0, vx: 35 / 3.6, vz: 0, carrier: 0 },
        { x: 0, z: 0, yaw: Math.PI, vx: 0, vz: 0, carrier: null },
      ],
    },
  );
  // deformation along the trolley's centre line, at the lower row (the specification measures at 425 mm)
  const ct = tl.crush[0];
  const n = NB * NS;
  let depth = 0;
  for (let s = 0; s < ct.times.length; s++)
    for (const b of [1, 2]) depth = Math.max(depth, ct.data[(s * n + b * NS) * 3]);
  return { energy: tl.metrics.energy.crush[0], depth };
}
