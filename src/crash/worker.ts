/**
 * The crash solver's worker: solves a scenario off the main thread and hands the timeline back with
 * its typed arrays transferred, not copied.
 */
import { solveScenario } from "./sim/solve";
import type { Scenario, Timeline } from "./sim/types";

function buffers(tl: Timeline): ArrayBuffer[] {
  const set = new Set<ArrayBuffer>();
  const add = (a: ArrayBufferView | undefined) => {
    if (a && a.buffer instanceof ArrayBuffer) set.add(a.buffer);
  };
  add(tl.times);
  for (const b of tl.bodies) add(b.surface);
  for (const t of tl.tracks) [t.pose, t.vel, t.accRaw, t.acc, t.wheels, t.rigid, t.force].forEach(add);
  for (const c of tl.crush) [c.times, c.data].forEach(add);
  const d = tl.debris;
  [d.kind, d.size, d.color, d.axis, d.first, d.count, d.seg].forEach(add);
  for (const s of tl.skids) add(s.pts);
  for (const o of tl.occupants) [o.pose, o.headG, o.chestG, o.belt].forEach(add);
  return [...set];
}

self.onmessage = (e: MessageEvent<{ id: number; scenario: Scenario }>) => {
  try {
    const tl = solveScenario(e.data.scenario);
    (self as unknown as Worker).postMessage({ id: e.data.id, timeline: tl }, buffers(tl));
  } catch (err) {
    (self as unknown as Worker).postMessage({ id: e.data.id, error: err instanceof Error ? err.message : String(err) });
  }
};
