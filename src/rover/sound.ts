import type { World } from "./worlds";

/**
 * Two paths to the listener, as with Perseverance's microphones:
 *  - "air": sound carried by the atmosphere — nothing in vacuum, thin and dull on Mars (CO₂ swallows
 *    the highs), heavy and loud on Venus and Titan;
 *  - "body": vibration through the rover's own structure, which you hear on any world.
 * Distant events arrive after distance ÷ the local speed of sound.
 */
export class RoverAudio {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private air!: GainNode;
  private airLP!: BiquadFilterNode;
  private body!: GainNode;
  private noise!: AudioBuffer;
  private brown!: AudioBuffer;
  private motor!: { a: OscillatorNode; b: OscillatorNode; whine: OscillatorNode; g: GainNode; wg: GainNode; airG: GainNode; f: BiquadFilterNode };
  private crunch!: { g: GainNode; f: BiquadFilterNode; airG: GainNode };
  private wind!: { g: GainNode; f: BiquadFilterNode };
  private thrust!: { g: GainNode; bodyG: GainNode; f: BiquadFilterNode };
  private world: World | null = null;
  private airK = 0;
  private muted = false;
  private started = false;

  unlock() {
    if (this.started) {
      if (this.ctx?.state === "suspended") void this.ctx.resume();
      return;
    }
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    this.started = true;
    const ctx = (this.ctx = new AC());
    this.master = ctx.createGain();
    this.master.gain.value = this.muted ? 0 : 0.7;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.ratio.value = 6;
    this.master.connect(comp).connect(ctx.destination);
    this.airLP = ctx.createBiquadFilter();
    this.airLP.type = "lowpass";
    this.airLP.frequency.value = 12000;
    this.air = ctx.createGain();
    this.air.connect(this.airLP).connect(this.master);
    const bodyLP = ctx.createBiquadFilter();
    bodyLP.type = "lowpass";
    bodyLP.frequency.value = 900;
    this.body = ctx.createGain();
    this.body.gain.value = 0.55;
    this.body.connect(bodyLP).connect(this.master);

    const len = ctx.sampleRate * 2;
    this.noise = ctx.createBuffer(1, len, ctx.sampleRate);
    this.brown = ctx.createBuffer(1, len, ctx.sampleRate);
    const n = this.noise.getChannelData(0);
    const b = this.brown.getChannelData(0);
    let last = 0;
    for (let i = 0; i < len; i++) {
      n[i] = Math.random() * 2 - 1;
      last = (last + 0.02 * n[i]) / 1.02;
      b[i] = last * 3.5;
    }
    const loop = (buf: AudioBuffer) => {
      const s = ctx.createBufferSource();
      s.buffer = buf;
      s.loop = true;
      s.start();
      return s;
    };

    // motors: geared DC whine plus a low hum
    {
      const a = ctx.createOscillator();
      a.type = "sawtooth";
      const b2 = ctx.createOscillator();
      b2.type = "sawtooth";
      b2.detune.value = 18;
      const whine = ctx.createOscillator();
      whine.type = "sine";
      const f = ctx.createBiquadFilter();
      f.type = "lowpass";
      f.frequency.value = 600;
      const g = ctx.createGain();
      g.gain.value = 0;
      const wg = ctx.createGain();
      wg.gain.value = 0;
      const airG = ctx.createGain();
      airG.gain.value = 0;
      a.connect(f);
      b2.connect(f);
      f.connect(g);
      whine.connect(wg);
      g.connect(this.body);
      wg.connect(this.body);
      g.connect(airG);
      wg.connect(airG);
      airG.connect(this.air);
      a.start();
      b2.start();
      whine.start();
      this.motor = { a, b: b2, whine, g, wg, airG, f };
    }
    // wheels on the ground: band-passed noise, gated in grains
    {
      const s = loop(this.noise);
      const f = ctx.createBiquadFilter();
      f.type = "bandpass";
      f.frequency.value = 900;
      f.Q.value = 0.7;
      const g = ctx.createGain();
      g.gain.value = 0;
      const airG = ctx.createGain();
      airG.gain.value = 0;
      s.connect(f).connect(g);
      g.connect(this.body);
      g.connect(airG).connect(this.air);
      this.crunch = { g, f, airG };
    }
    // wind across the masts
    {
      const s = loop(this.noise);
      const f = ctx.createBiquadFilter();
      f.type = "lowpass";
      f.frequency.value = 500;
      const g = ctx.createGain();
      g.gain.value = 0;
      s.connect(f).connect(g).connect(this.air);
      this.wind = { g, f };
    }
    // rocket engines
    {
      const s = loop(this.brown);
      const f = ctx.createBiquadFilter();
      f.type = "lowpass";
      f.frequency.value = 700;
      const g = ctx.createGain();
      g.gain.value = 0;
      const bodyG = ctx.createGain();
      bodyG.gain.value = 0;
      s.connect(f);
      f.connect(g).connect(this.air);
      f.connect(bodyG).connect(this.body);
      this.thrust = { g, bodyG, f };
    }
    if (this.world) this.setWorld(this.world);
  }

  setMuted(m: boolean) {
    this.muted = m;
    if (this.ctx) this.master.gain.setTargetAtTime(m ? 0 : 0.7, this.ctx.currentTime, 0.05);
  }

  /** null = space (no air at all) */
  setWorld(w: World | null) {
    this.world = w;
    if (!this.ctx) return;
    const rho = w?.atm.rho ?? 0;
    this.airK = rho < 0.001 ? 0 : Math.min(1.35, Math.max(0.12, Math.log10(rho / 0.001) / 3));
    const t = this.ctx.currentTime;
    this.air.gain.setTargetAtTime(this.airK, t, 0.3);
    // Mars' CO₂ absorbs high frequencies within metres; dense air rolls off a little too
    const lp = !w ? 200 : w.id === "mars" ? 2200 : rho > 20 ? 7000 : rho > 3 ? 9000 : 13000;
    this.airLP.frequency.setTargetAtTime(lp, t, 0.3);
  }

  update(p: { wheel: number; torque: number; ground: number; contact: number; slip: number; wind: number; thrust: number; attached: boolean; rough: number }) {
    if (!this.ctx || this.ctx.state !== "running") return;
    const t = this.ctx.currentTime;
    const m = this.motor;
    const f0 = 55 + Math.min(1, Math.abs(p.wheel) / 60) * 170;
    m.a.frequency.setTargetAtTime(f0, t, 0.05);
    m.b.frequency.setTargetAtTime(f0 * 1.5, t, 0.05);
    m.whine.frequency.setTargetAtTime(f0 * 9.3, t, 0.05);
    const load = Math.min(1, p.torque / 900);
    const run = Math.min(1, Math.abs(p.wheel) / 8);
    m.g.gain.setTargetAtTime((0.05 + load * 0.22) * Math.max(run, load * 0.6), t, 0.06);
    m.wg.gain.setTargetAtTime(0.025 * run, t, 0.06);
    m.f.frequency.setTargetAtTime(300 + load * 900, t, 0.08);
    m.airG.gain.setTargetAtTime(0.35, t, 0.2);
    const c = this.crunch;
    const grain = 0.65 + Math.random() * 0.7;
    c.g.gain.setTargetAtTime(Math.min(0.5, p.ground * 0.04 + p.slip * 0.05) * p.contact * p.rough * grain, t, 0.03);
    c.f.frequency.setTargetAtTime(600 + p.slip * 400 + Math.random() * 300, t, 0.05);
    c.airG.gain.setTargetAtTime(0.8, t, 0.2);
    const wnd = Math.min(1, p.wind / 30);
    this.wind.g.gain.setTargetAtTime(wnd * 0.35, t, 0.4);
    this.wind.f.frequency.setTargetAtTime(250 + wnd * 900, t, 0.4);
    this.thrust.g.gain.setTargetAtTime(p.thrust * 0.9, t, 0.08);
    this.thrust.bodyG.gain.setTargetAtTime(p.attached ? p.thrust * 0.8 : 0, t, 0.08);
    this.thrust.f.frequency.setTargetAtTime(400 + p.thrust * 500, t, 0.1);
  }

  /** a one-off sound; `dist` (m) delays it by the speed of sound and decides air vs structure */
  hit(kind: "thud" | "pyro" | "chute" | "crash" | "touchdown" | "click" | "scrape", strength = 1, dist = 0) {
    if (!this.ctx || this.ctx.state !== "running") return;
    const ctx = this.ctx;
    const near = dist < 4;
    const c = this.world?.atm.sound ?? 0;
    if (!near && (this.airK === 0 || c === 0)) return; // nothing carries it
    const delay = near || c === 0 ? 0 : dist / c;
    const t = ctx.currentTime + delay;
    const att = near ? 1 : Math.min(1, 60 / Math.max(dist, 1));
    const out = ctx.createGain();
    out.connect(near && this.airK === 0 ? this.body : kind === "click" ? this.master : this.air);
    if (near && this.airK > 0) out.connect(this.body);
    const dur = { thud: 0.5, pyro: 0.35, chute: 1.2, crash: 2.6, touchdown: 0.8, click: 0.05, scrape: 0.4 }[kind];
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = kind === "pyro" ? "highpass" : "lowpass";
    f.frequency.value = { thud: 220, pyro: 1500, chute: 500, crash: 400, touchdown: 300, click: 4000, scrape: 1800 }[kind];
    const g = ctx.createGain();
    const peak = strength * att * ({ thud: 0.9, pyro: 0.8, chute: 0.7, crash: 1.2, touchdown: 0.9, click: 0.12, scrape: 0.35 }[kind] ?? 0.5);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(peak, 0.0002), t + (kind === "chute" ? 0.08 : 0.005));
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g).connect(out);
    src.start(t, Math.random());
    src.stop(t + dur + 0.05);
    if (kind === "thud" || kind === "crash" || kind === "touchdown") {
      const o = ctx.createOscillator();
      o.type = "sine";
      o.frequency.setValueAtTime(kind === "crash" ? 70 : 90, t);
      o.frequency.exponentialRampToValueAtTime(35, t + dur);
      const og = ctx.createGain();
      og.gain.setValueAtTime(peak * 0.9, t);
      og.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(og).connect(out);
      o.start(t);
      o.stop(t + dur + 0.05);
    }
  }

  stop() {
    void this.ctx?.close();
    this.ctx = null;
    this.started = false;
  }
}
