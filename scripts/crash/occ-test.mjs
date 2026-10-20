// The occupant model on a synthetic 56 km/h half-sine pulse (90 ms), every restraint: a quick look at its numbers.
import { load } from "./ts.mjs";
const { occupant } = await load("crash/sim/occupant.ts");
const { hic, cfc, clip3ms } = await load("crash/sim/cfc.ts");
const dt = 1e-4, n = 4000;
const T = 0.09, dv = 17.6, A = (dv * Math.PI) / (2 * T);
const ax = new Float64Array(n), az = new Float64Array(n), z = new Float64Array(n);
for (let i = 0; i < n; i++) {
  const t = i * dt - 0.005;
  ax[i] = t > 0 && t < T ? -A * Math.sin((Math.PI * t) / T) : 0;
}
for (const restraint of ["belt+airbag", "belt", "harness", "lap", "none"]) {
  const r = occupant({ dt, ax, az, door: z, dash: z, restraint, airbag: restraint === "belt+airbag" ? { fire: 0.02, full: 0.05, vented: 0.13 } : null, curtain: null, wheel: [0.62, 0.36], doorGap: 0.25, doorSide: -1 });
  let mx = 0, at = 0, th = 0, al = 0, ex = 0, tex = 0;
  for (let i = 0; i < n; i++) {
    if (r.headG[i] > mx) { mx = r.headG[i]; at = i; }
    th = Math.max(th, r.pose[i * 5]);
    al = Math.max(al, r.pose[i * 5 + 2]);
    if (r.pose[i * 5 + 4] > ex) { ex = r.pose[i * 5 + 4]; tex = i * dt; }
  }
  console.log(restraint.padEnd(12), "head max", mx.toFixed(0), "g at", (at * dt * 1000).toFixed(0), "ms  HIC15", hic(cfc(r.headG, dt, 1000), dt).toFixed(0), " chest 3ms", clip3ms(cfc(r.chestG, dt, 180), dt).toFixed(1), "g  torso", ((th * 180) / Math.PI).toFixed(0) + "°", " neck", ((al * 180) / Math.PI).toFixed(0) + "°", " excursion", (ex * 1000).toFixed(0), "mm at", (tex * 1000).toFixed(0), "ms  contact", r.contact, " belt", (Math.max(...r.belt) / 1000).toFixed(1), "kN");
}
