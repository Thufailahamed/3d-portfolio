/**
 * Runs one crash-lab test in Node and prints its report, for working on the solver:
 *   node scripts/crash/run.mjs wall reference-sedan 56
 *   node scripts/crash/run.mjs headon ferrari-f40 50 toyota-land-cruiser 50
 */
import { load } from "./ts.mjs";

const [, , test = "wall", a = "reference-sedan", va = "56", b, vb = "0"] = process.argv;
const { solveScenario } = await load("crash/sim/solve.ts");
const { scenarioFor } = await load("crash/sim/tests.ts");
const s = scenarioFor(test, a, b, { va: +va, vb: +vb });
const tl = solveScenario(s);
const m = tl.metrics;
const f = (x, d = 1) => (Number.isFinite(x) ? x.toFixed(d) : "—");
console.log(`${test} ${a}${b ? ` vs ${b}` : ""}: solved in ${tl.solveMs.toFixed(0)} ms, ${tl.times.length} frames, ${tl.crush[0].times.length} snapshots, ${tl.debris.kind.length} debris, ${tl.events.length} events`);
for (const bm of m.bodies) {
  console.log(
    `  ${bm.label.padEnd(26)} Δv ${f(bm.deltaV)} km/h  peak ${f(bm.peakG)} g  mean ${f(bm.meanG)} g  pulse ${f(bm.pulseMs, 0)} ms  OLC ${f(bm.olc)} g  crush ${f(bm.crushDynamic * 1000, 0)}/${f(bm.crushResidual * 1000, 0)} mm  intrusion foot ${f(bm.intrusion.footwell * 1000, 0)} dash ${f(bm.intrusion.dash * 1000, 0)} door ${f(bm.intrusion.door * 1000, 0)} mm  E ${f(bm.energy / 1000)} kJ`,
  );
  if (bm.occupant) console.log(`    occupant HIC15 ${f(bm.occupant.hic15, 0)}  chest3ms ${f(bm.occupant.chest3ms)} g  excursion ${f(bm.occupant.excursion * 1000, 0)} mm  belt ${f(bm.occupant.beltPeak / 1000, 2)} kN  contact ${bm.occupant.contact}  ${JSON.stringify(bm.occupant.ratings)}`);
  console.log(`    rest at (${f(bm.rest.x, 2)}, ${f(bm.rest.z, 2)}) yaw ${f((bm.rest.yaw * 180) / Math.PI, 0)}° t ${f(bm.rest.t, 2)} s`);
}
const e = m.energy;
console.log(`  closing ${f(m.closingKmh)} km/h  restitution ${f(m.restitution, 3)}  contact ${f(m.contactMs, 0)} ms`);
console.log(`  energy: initial ${f(e.initial / 1000)} kJ, final ${f(e.final / 1000)}, crush ${e.crush.map((c) => f(c / 1000)).join(" + ")}, friction ${f(e.friction / 1000)}, tyres ${f(e.tyres / 1000)}, elastic ${f(e.elastic / 1000, 2)}; book error ${f(e.error * 100, 2)}%`);
console.log(`  momentum error ${Number.isFinite(m.momentum.error) ? f(m.momentum.error * 100, 3) + "%" : "n/a (fixed barrier)"}`);
console.log(`  events: ${tl.events.map((ev) => `${ev.type}${ev.pane ? ":" + ev.pane : ev.lamp ? ":" + ev.lamp : ev.bag ? ":" + ev.bag : ""}@${(ev.t * 1000).toFixed(1)}`).join(", ")}`);
