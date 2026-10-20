// The most-crushed samples of a run (band, sample, skin point, normal, crush, consumed depth), for debugging the solver.
import { load } from "./ts.mjs";
const [, , test = "small", a = "reference-sedan", va = "64", b, vb = "0", who = "0"] = process.argv;
const { solveScenario } = await load("crash/sim/solve.ts");
const { scenarioFor } = await load("crash/sim/tests.ts");
const { pointAt, BAND_MID } = await load("crash/sim/geometry.ts");
const tl = solveScenario(scenarioFor(test, a, b || undefined, { va: +va, vb: +vb }));
const ct = tl.crush[+who], def = tl.bodies[+who];
const N = 10 * 192, last = ct.times.length - 1;
const rows = [];
for (let k = 0; k < N; k++) {
  const c = ct.data[(last * N + k) * 3], L = ct.data[(last * N + k) * 3 + 1];
  if (c > 0.01) rows.push({ k, c, L });
}
rows.sort((x, y) => y.c - x.c);
const bp = { x: 0, z: 0, nx: 0, nz: 0 };
console.log(`${def.label}: ${rows.length} crushed samples; deepest:`);
for (const r of rows.slice(0, 15)) {
  const bnd = Math.floor(r.k / 192), i = r.k % 192;
  pointAt(def.plan, i / 192, bp);
  console.log(`  band ${bnd} (y ${BAND_MID[bnd].toFixed(2)}) i ${i}  skin (${(bp.x - bp.nx * def.surface[r.k]).toFixed(2)}, ${(bp.z - bp.nz * def.surface[r.k]).toFixed(2)}) n (${bp.nx.toFixed(2)}, ${bp.nz.toFixed(2)})  c ${r.c.toFixed(3)}  L ${r.L.toFixed(3)}`);
}
