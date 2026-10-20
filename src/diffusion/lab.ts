import * as THREE from "three";
import { K, gaussian, mulberry32, type Dataset } from "./datasets";
import { SIGMA_D } from "./denoiser";
import { Display } from "./display";
import { Engine, dequantise, type Run } from "./engine";
import { distanceToShape, precisionRecall, subsample } from "./metrics";
import { alphaBarAt } from "./schedule";
import { useLab } from "./store";

/** samples scored per metric evaluation */
const METRIC_N = 600;

export type Tier = { pw: number; ph: number; nMax: number; sizes: number[]; bead: number };

const RUN_KEYS = ["cls", "w", "sampler", "steps", "schedule", "seed", "train"] as const;

/** Runs the sampler, keeps the display on the timeline's position and reports readouts to the store. */
export class Lab {
  readonly engine: Engine;
  readonly display: Display;
  private shown = { run: null as Run | null, a: -1, b: -1, trails: -1, field: "" };
  private fwd = { key: "", base: "", x0: new Float32Array(0), eps: new Float32Array(0), xt: new Float32Array(0), px0: new Float32Array(0), post: new Uint8Array(0) };
  private refs = new Map<number, Float32Array>();
  private scratch: Float32Array;
  private statAt = 0;
  private metricAt = 0;
  private metricKey = "";
  private scored: Run | null = null;
  private pr: { precision: number | null; recall: number | null } = { precision: null, recall: null };
  private dist: number | null = null;
  private unsub: () => void;

  constructor(
    gl: THREE.WebGLRenderer,
    private sets: Dataset[],
    tier: Tier,
  ) {
    this.engine = new Engine(gl, tier.pw, tier.ph, tier.nMax);
    this.display = new Display(this.engine, tier.bead);
    this.scratch = new Float32Array(this.engine.M * 3);
    const M3 = this.engine.M * 3;
    this.fwd.xt = new Float32Array(M3);
    this.fwd.px0 = new Float32Array(M3);
    this.fwd.post = new Uint8Array(this.engine.M * 4);
    const s = useLab.getState();
    this.engine.setData(sets, s.sizes[s.train]);
    this.restart();
    this.unsub = useLab.subscribe((now, prev) => {
      if (now.train !== prev.train) this.engine.setData(this.sets, now.sizes[now.train]);
      if (RUN_KEYS.some((k) => now[k] !== prev[k])) this.restart();
      if (now.mode !== prev.mode) {
        this.shown.a = this.shown.b = this.shown.trails = -1;
        this.shown.field = "";
        this.fwd.key = "";
        this.metricKey = "";
      }
    });
  }

  private restart() {
    const s = useLab.getState();
    this.engine.start({ schedule: s.schedule, sampler: s.sampler, steps: s.steps, cls: s.cls, w: s.w, seed: s.seed });
    this.pr = { precision: null, recall: null };
    this.dist = null;
    this.metricKey = "";
    this.fwd.key = "";
    s.set({ cursor: 0, avail: 0, snaps: this.engine.run!.J, playing: s.mode === "generate" ? true : s.playing });
  }

  /** the true shape for a prompt — the union of all four when unconditional */
  private ref(cls: number) {
    let r = this.refs.get(cls);
    if (!r) {
      if (cls >= 0) r = this.sets[cls].ref;
      else {
        const per = Math.floor(METRIC_N / K);
        r = new Float32Array(per * K * 3);
        for (let c = 0; c < K; c++) r.set(subsample(this.sets[c].ref, per), c * per * 3);
      }
      this.refs.set(cls, r);
    }
    return r;
  }

  private meanBelief(post: Uint8Array) {
    const b = [0, 0, 0, 0];
    for (let i = 0; i < post.length; i += 4) for (let c = 0; c < 4; c++) b[c] += post[i + c];
    const n = (post.length / 4) * 255;
    return b.map((v) => v / n);
  }

  frame(dt: number, heightPx: number, fov: number) {
    const s = useLab.getState();
    const d = this.display;
    d.setScale(heightPx, fov);
    d.ghost.visible = s.ghost;
    d.trails.visible = s.trails && s.mode === "generate";
    d.field.visible = s.field;
    if (s.mode === "generate") this.generate(dt, s);
    else this.forward(dt, s);
  }

  private generate(dt: number, s: ReturnType<typeof useLab.getState>) {
    const e = this.engine;
    const run = e.run!;
    if (!run.done) e.advance(s.playing ? 12 : 8);
    const avail = run.denReady;
    let c = s.cursor;
    let playing = s.playing;
    if (playing) {
      // a run plays in a few seconds whatever its length; it can't outrun the sampler
      const dur = Math.min(7, 2.2 + run.J * 0.02);
      c += (dt * run.J) / dur;
      if (c >= run.J) {
        c = run.J;
        if (run.done) playing = false;
      }
    }
    c = Math.min(c, Math.max(0, avail - 1));
    const patch: Partial<ReturnType<typeof useLab.getState>> = {};
    if (c !== s.cursor) patch.cursor = c;
    if (avail !== s.avail) patch.avail = avail;
    if (playing !== s.playing) patch.playing = playing;
    if (Object.keys(patch).length) s.set(patch);
    if (avail === 0) return;

    if (this.shown.run !== run) this.shown = { run, a: -1, b: -1, trails: -1, field: "" };
    const j = Math.floor(c);
    const jb = j + 1 <= avail - 1 ? j + 1 : j;
    const sh = this.shown;
    if (sh.a !== j) {
      if (sh.b === j) {
        this.display.swap();
        [sh.a, sh.b] = [sh.b, sh.a];
      } else {
        this.display.loadSnapshot("a", run.pos[j], run.x0[j], run.post[j]);
        sh.a = j;
      }
    }
    if (sh.b !== jb) {
      this.display.loadSnapshot("b", run.pos[jb], run.x0[jb], run.post[jb]);
      sh.b = jb;
    }
    this.display.setMix(jb === j ? 0 : c - j);
    if (s.trails && sh.trails !== j) {
      this.display.buildTrails(run, j);
      sh.trails = j;
    }

    // readouts describe the nearest computed state
    const jr = Math.min(Math.round(c), avail - 1);
    const k = e.stepOf(jr);
    const ab = k < run.steps ? run.plan[k].abT : 1;
    const t = k < run.steps ? run.plan[k].t : -1;
    if (s.field) {
      const key = `${jr}`;
      if (sh.field !== key) {
        e.computeField(ab, run.cls, run.w);
        this.display.setField(ab);
        sh.field = key;
      }
    }
    const now = performance.now();
    const mkey = `${jr}`;
    if (mkey !== this.metricKey && (now - this.metricAt > 150 || (jr === run.J && run.done))) {
      this.metricAt = now;
      this.metricKey = mkey;
      const gen = subsample(dequantise(run.pos[jr], this.scratch), METRIC_N);
      this.dist = distanceToShape(gen, this.ref(run.cls));
      if (jr === run.J && run.done && this.scored !== run) {
        this.scored = run;
        this.pr = precisionRecall(gen, this.ref(run.cls));
      }
    }
    if (now - this.statAt > 100) {
      this.statAt = now;
      const fin = jr === run.J && run.done && this.scored === run;
      s.set({
        stats: { t, ab, step: k, steps: run.steps, ms: run.ms, belief: this.meanBelief(run.post[jr]), dist: this.dist, precision: fin ? this.pr.precision : null, recall: fin ? this.pr.recall : null },
      });
    }
  }

  /** q(x_t | x0): each particle is a training sample, noised with the ε the seed's generation starts from */
  private forward(dt: number, s: ReturnType<typeof useLab.getState>) {
    const e = this.engine;
    const f = this.fwd;
    let u = s.fwd;
    if (s.playing) {
      u = Math.min(1000, u + (dt * 1000) / 4);
      s.set(u >= 1000 ? { fwd: u, playing: false } : { fwd: u });
    }
    const n = s.sizes[s.train];
    const base = `${s.cls}|${n}|${s.seed}`;
    if (base !== f.base) {
      f.base = base;
      f.eps = e.noise(s.seed);
      f.x0 = new Float32Array(e.M * 3);
      const rnd = mulberry32(s.seed * 7 + 1);
      for (let i = 0; i < e.M; i++) {
        const c = s.cls >= 0 ? s.cls : i % K;
        const y = this.sets[c].train;
        const idx = Math.min(n - 1, Math.floor(rnd() * n));
        const [g0, g1] = gaussian(rnd);
        const [g2] = gaussian(rnd);
        f.x0[i * 3] = y[idx * 3] + SIGMA_D * g0;
        f.x0[i * 3 + 1] = y[idx * 3 + 1] + SIGMA_D * g1;
        f.x0[i * 3 + 2] = y[idx * 3 + 2] + SIGMA_D * g2;
      }
    }
    const ti = Math.round(u);
    const ab = ti <= 0 ? 1 : alphaBarAt(s.schedule, ti - 1);
    const key = `${base}|${ti}|${s.schedule}|${s.w}`;
    if (key !== f.key) {
      f.key = key;
      const a = Math.sqrt(ab);
      const b = Math.sqrt(1 - ab);
      for (let i = 0; i < f.xt.length; i++) f.xt[i] = a * f.x0[i] + b * f.eps[i];
      e.probeState(f.xt, ab, s.cls, s.w, f.px0, f.post);
      this.display.loadFloat(f.xt, f.px0, f.post);
      if (s.field) e.computeField(ab, s.cls, s.w);
      this.display.setField(ab);
      this.shown.field = s.field ? key : "";
      this.dist = distanceToShape(subsample(f.xt, METRIC_N), this.ref(s.cls));
    } else if (s.field && this.shown.field !== key) {
      e.computeField(ab, s.cls, s.w);
      this.display.setField(ab);
      this.shown.field = key;
    }
    const now = performance.now();
    if (now - this.statAt > 100) {
      this.statAt = now;
      s.set({ stats: { t: ti - 1, ab, step: 0, steps: 0, ms: 0, belief: this.meanBelief(f.post), dist: this.dist, precision: null, recall: null } });
    }
  }

  dispose() {
    this.unsub();
    this.engine.dispose();
    this.display.dispose();
  }
}
