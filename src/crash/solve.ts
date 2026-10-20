/**
 * Run a test: hands the scenario to the solver's worker and resolves with its timeline. Only the most
 * recent request matters: one still waiting when a newer one arrives is dropped (it resolves with
 * null), and one already running finishes but is ignored. Without workers the solver runs here.
 */
import type { Scenario, Timeline } from "./sim/types";

type Job = { id: number; scenario: Scenario; resolve: (tl: Timeline | null) => void; reject: (e: Error) => void };

let worker: Worker | null = null;
let running: Job | null = null;
let queued: Job | null = null;
let seq = 0;

function start(job: Job) {
  running = job;
  worker!.postMessage({ id: job.id, scenario: job.scenario });
}

function ensureWorker() {
  if (worker) return worker;
  worker = new Worker(new URL("./worker.ts", import.meta.url), { type: "module" });
  worker.onmessage = (e: MessageEvent<{ id: number; timeline?: Timeline; error?: string }>) => {
    const job = running;
    running = null;
    if (job && job.id === e.data.id) {
      if (e.data.error) job.reject(new Error(e.data.error));
      // superseded while it ran: nobody wants it any more
      else job.resolve(queued ? null : (e.data.timeline ?? null));
    }
    if (queued) {
      const next = queued;
      queued = null;
      start(next);
    }
  };
  worker.onerror = (e) => {
    const job = running;
    running = null;
    job?.reject(new Error(e.message || "crash solver worker failed"));
  };
  return worker;
}

export async function solve(s: Scenario): Promise<Timeline | null> {
  if (typeof Worker === "undefined") {
    const { solveScenario } = await import("./sim/solve");
    return solveScenario(s);
  }
  ensureWorker();
  return new Promise<Timeline | null>((resolve, reject) => {
    const job: Job = { id: ++seq, scenario: s, resolve, reject };
    if (!running) start(job);
    else {
      queued?.resolve(null);
      queued = job;
    }
  });
}
