/**
 * Checks the crash lab's solver against what is known, on the very modules the page runs:
 *
 *  1. calibration: the reference saloon (1,500 kg steel, NHTSA's intermediate-car class) into a rigid
 *     wall at 56 km/h lands in the published ranges for that test;
 *  2. the trolley's honeycomb face passes its own certification (1,300 kg into a rigid wall at 35 km/h:
 *     61.5 ± 5 kJ absorbed, 346 ± 20 mm deep);
 *  3. every car of the line-up through every barrier test: finite, at rest, crush within the car;
 *  4. car to car: momentum (less the tyres' impulse) conserved, Δv split by the mass ratio;
 *  5. the energy book closes in every run;
 *  6. determinism (identical twice) and the injury formulas against hand calculations.
 *
 *   node scripts/crash/check.mjs [--quick]
 */
import { load } from "./ts.mjs";

const quick = process.argv.includes("--quick");
const { solveScenario } = await load("crash/sim/solve.ts");
const { scenarioFor, tests } = await load("crash/sim/tests.ts");
const { hic, clip3ms, olc, cfc } = await load("crash/sim/cfc.ts");
const { cars } = await load("content/cars.ts");

let failures = 0;
const ok = (cond, label) => {
  console.log(`${cond ? "  pass" : "  FAIL"}  ${label}`);
  if (!cond) failures++;
};
const f = (x, d = 1) => (Number.isFinite(x) ? x.toFixed(d) : "—");
const run = (test, a, b, over = {}) => solveScenario(scenarioFor(test, a, b, over));

// ---------------------------------------------------------------- 6. formulas
console.log("\nInjury and severity formulas");
{
  const dt = 1e-4;
  // a 100 g plateau for 10 ms: HIC = 0.010 × 100^2.5 = 1000
  const a = new Float64Array(400);
  for (let i = 100; i < 200; i++) a[i] = 100;
  ok(Math.abs(hic(a, dt) - 1000) < 5, `HIC15 of a 10 ms, 100 g square pulse = ${f(hic(a, dt), 0)} (expect 1000)`);
  ok(Math.abs(clip3ms(a, dt) - 100) < 1e-6, `3 ms clip of the same = ${f(clip3ms(a, dt))} g (expect 100)`);
  // half-sine, peak 50 g, 20 ms: the best 15 ms window by brute force
  const h = new Float64Array(600);
  for (let i = 0; i < 200; i++) h[100 + i] = 50 * Math.sin((Math.PI * i) / 200);
  let brute = 0;
  for (let i = 0; i < h.length; i++) {
    let s = 0;
    for (let j = i + 1; j <= Math.min(h.length, i + 150); j++) {
      s += h[j - 1] * dt;
      const T = (j - i) * dt;
      brute = Math.max(brute, T * (s / T) ** 2.5);
    }
  }
  ok(Math.abs(hic(h, dt) - brute) / brute < 1e-6, `HIC15 of a 50 g half-sine = ${f(hic(h, dt), 1)} (brute force ${f(brute, 1)})`);
  // OLC of a constant 20 g deceleration from 15 m/s, by hand: free flight for 65 mm (t1 = √(2·0.065/a)),
  // then the virtual occupant's constant deceleration D must close the relative speed in 235 mm — while
  // the car is still braking (relative deceleration D − a) and after it has stopped (D)
  const a20 = 20 * 9.81, v0 = 15;
  const t1 = Math.sqrt((2 * 0.065) / a20), u0 = a20 * t1, tStop = v0 / a20;
  const travel = (D) => {
    const tA = Math.min((u0 / (D - a20)), tStop - t1);
    const uA = u0 - (D - a20) * tA;
    const sA = u0 * tA - 0.5 * (D - a20) * tA * tA;
    return sA + (uA > 0 ? (uA * uA) / (2 * D) : 0);
  };
  let lo = a20 + 1, hi = 100 * 9.81;
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    if (travel(mid) > 0.235) lo = mid;
    else hi = mid;
  }
  const want = lo / 9.81;
  const v = new Float64Array(2000);
  for (let i = 0; i < v.length; i++) v[i] = Math.max(0, v0 - a20 * i * dt);
  ok(Math.abs(olc(v, dt) - want) < 0.3, `OLC of a constant 20 g pulse from 15 m/s = ${f(olc(v, dt), 2)} g (by hand ${f(want, 2)} g)`);
  // CFC 60 leaves a slow signal alone and kills a 1 kHz ripple
  const s = Float64Array.from({ length: 4000 }, (_, i) => Math.sin(2 * Math.PI * 5 * i * dt) + 0.5 * Math.sin(2 * Math.PI * 1000 * i * dt));
  const fs = cfc(s, dt, 60);
  let err = 0;
  for (let i = 500; i < 3500; i++) err = Math.max(err, Math.abs(fs[i] - Math.sin(2 * Math.PI * 5 * i * dt)));
  ok(err < 0.02, `CFC 60: 5 Hz kept, 1 kHz removed (max error ${f(err, 4)})`);
}

// ---------------------------------------------------------------- 1. calibration
console.log("\nCalibration: reference saloon into a rigid wall at 56 km/h");
const ref = run("wall", "reference-sedan", undefined, { va: 56 });
const rm = ref.metrics.bodies[0];
console.log(`  Δv ${f(rm.deltaV)} km/h, peak ${f(rm.peakG)} g, mean ${f(rm.meanG)} g, pulse ${f(rm.pulseMs, 0)} ms, crush ${f(rm.crushDynamic * 1000, 0)} / ${f(rm.crushResidual * 1000, 0)} mm, restitution ${f(ref.metrics.restitution, 3)}, OLC ${f(rm.olc)} g`);
console.log(`  occupant: HIC15 ${f(rm.occupant.hic15, 0)}, chest 3 ms ${f(rm.occupant.chest3ms)} g, excursion ${f(rm.occupant.excursion * 1000, 0)} mm, belt ${f(rm.occupant.beltPeak / 1000, 1)} kN`);
ok(rm.peakG >= 35 && rm.peakG <= 50, "peak deceleration 35–50 g");
ok(rm.meanG >= 18 && rm.meanG <= 27, "mean deceleration 18–27 g");
ok(rm.pulseMs >= 65 && rm.pulseMs <= 115, "pulse 65–115 ms");
ok(rm.crushDynamic >= 0.55 && rm.crushDynamic <= 0.78, "dynamic crush 0.55–0.78 m");
ok(ref.metrics.restitution >= 0.05 && ref.metrics.restitution <= 0.25, "restitution 0.05–0.25");
ok(rm.olc >= 20 && rm.olc <= 40, "OLC 20–40 g");
ok(rm.occupant.hic15 < 700 && rm.occupant.chest3ms < 60, "belted, airbagged occupant under HIC 700 and 60 g");

// ---------------------------------------------------------------- 2. the trolley's face
console.log("\nThe side trolley's honeycomb face (certification)");
{
  const { mdbCertification } = await load("crash/sim/certify.ts");
  const c = mdbCertification();
  console.log(`  1,300 kg at 35 km/h into a rigid wall: ${f(c.energy / 1000)} kJ absorbed, ${f(c.depth * 1000, 0)} mm deep`);
  ok(Math.abs(c.energy - 61500) <= 5000, "energy 61.5 ± 5 kJ");
  ok(Math.abs(c.depth - 0.346) <= 0.02, "deformation 346 ± 20 mm");
}

// ---------------------------------------------------------------- 3 & 5. the line-up through every barrier test
console.log("\nThe line-up through the barrier tests");
const slugs = cars.map((c) => c.slug);
const barrierTests = tests.filter((t) => t.group === "barrier");
const header = "  car                       test   Δv km/h  peak g  mean g  pulse ms  crush mm  intr mm  HIC15  chest g  rest s  book %  solve ms";
console.log(header);
for (const slug of quick ? slugs.slice(0, 3) : slugs) {
  for (const t of barrierTests) {
    const tl = run(t.id, slug, undefined, {});
    const m = tl.metrics.bodies[0];
    const intr = Math.max(m.intrusion.footwell, m.intrusion.dash, m.intrusion.door);
    const rest = tl.events.filter((e) => e.type === "rest").reduce((x, e) => Math.max(x, e.t), 0);
    console.log(`  ${slug.padEnd(26)}${t.id.padEnd(7)}${f(m.deltaV).padStart(7)}${f(m.peakG).padStart(8)}${f(m.meanG).padStart(8)}${f(m.pulseMs, 0).padStart(10)}${f(m.crushDynamic * 1000, 0).padStart(10)}${f(intr * 1000, 0).padStart(9)}${f(m.occupant?.hic15 ?? NaN, 0).padStart(7)}${f(m.occupant?.chest3ms ?? NaN).padStart(9)}${f(rest, 2).padStart(8)}${f(tl.metrics.energy.error * 100, 2).padStart(8)}${f(tl.solveMs, 0).padStart(10)}`);
    const finite = [m.deltaV, m.peakG, m.crushDynamic, tl.metrics.energy.initial].every(Number.isFinite);
    const length = (tl.bodies[0].plan.hx * 2);
    if (!finite || m.crushDynamic > length * 0.6 || rest > 7.9 || tl.metrics.energy.error > 0.01) {
      ok(false, `${slug} ${t.id}: finite ${finite}, crush ${f(m.crushDynamic, 2)} m of ${f(length, 2)}, rest ${f(rest, 2)} s, book ${f(tl.metrics.energy.error * 100, 2)}%`);
    }
  }
}

// ---------------------------------------------------------------- 4. car to car
console.log("\nCar to car");
const pairs = quick ? [["ferrari-f40", "toyota-land-cruiser"]] : [["ferrari-f40", "toyota-land-cruiser"], ["aston-martin-vulcan", "lykan-hypersport"], ["jaguar-xj13", "toyota-supra-gt300"], ["reference-sedan", "reference-sedan"]];
for (const [a, b] of pairs) {
  for (const t of tests.filter((x) => x.group === "car")) {
    const tl = run(t.id, a, b, {});
    const [ma, mb] = tl.metrics.bodies;
    const me = tl.metrics.momentum.error;
    console.log(`  ${(a + " × " + b).padEnd(44)}${t.id.padEnd(8)} Δv ${f(ma.deltaV).padStart(5)} / ${f(mb.deltaV).padStart(5)} km/h  peak ${f(ma.peakG).padStart(5)} / ${f(mb.peakG).padStart(5)} g  crush ${f(ma.crushDynamic * 1000, 0).padStart(4)} / ${f(mb.crushDynamic * 1000, 0).padStart(4)} mm  e ${f(tl.metrics.restitution, 2)}  momentum ${f(me * 100, 3)}%  book ${f(tl.metrics.energy.error * 100, 2)}%  ${f(tl.solveMs, 0)} ms`);
    ok(me < 0.01, `${a} × ${b} ${t.id}: momentum conserved within 1% (${f(me * 100, 3)}%)`);
    ok(tl.metrics.energy.error < 0.01, `${a} × ${b} ${t.id}: energy book within 1% (${f(tl.metrics.energy.error * 100, 2)}%)`);
    if (t.id === "headon") {
      // central impact: Δv_A / Δv_B = m_B / m_A
      const mA = tl.bodies[0].mass, mB = tl.bodies[1].mass;
      const want = mB / mA, got = ma.deltaV / mb.deltaV;
      ok(Math.abs(got / want - 1) < 0.05, `${a} × ${b} head-on: Δv ratio ${f(got, 3)} vs mass ratio ${f(want, 3)}`);
    }
  }
}

// ---------------------------------------------------------------- 6. determinism and step size
console.log("\nDeterminism");
{
  const s = ["offset", "ferrari-f40", "toyota-land-cruiser"];
  const x = run(...s), y = run(...s);
  const same = x.times.length === y.times.length && x.tracks[0].pose.every((v, i) => v === y.tracks[0].pose[i]) && x.debris.seg.every((v, i) => v === y.debris.seg[i]);
  ok(same, "the same scenario gives a bit-identical timeline");
}

console.log(failures ? `\n${failures} check(s) failed` : "\nall checks passed");
process.exit(failures ? 1 : 0);
