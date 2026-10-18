import type { ImpactKind } from "./physics";

/**
 * Synthesized brick sounds (no audio files): ABS plastic is hard and light, so a clack is a very
 * short, bright band of noise with a faint ring; a ball is a duller thud; a piece clipping home is
 * a tight, high snap.
 */
let ctx: AudioContext | null = null;
let out: GainNode | null = null;
let noise: AudioBuffer | null = null;
const recent: number[] = [];

export function unlockSound() {
  if (ctx) {
    if (ctx.state === "suspended") void ctx.resume();
    return;
  }
  try {
    ctx = new AudioContext();
  } catch {
    return;
  }
  out = ctx.createGain();
  out.gain.value = 0.55;
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -18;
  comp.ratio.value = 6;
  out.connect(comp).connect(ctx.destination);
  noise = ctx.createBuffer(1, ctx.sampleRate * 0.25, ctx.sampleRate);
  const d = noise.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
}

/**
 * Play one impact. `gain` already folds in distance; `pan` is -1..1 across the screen.
 */
export function playImpact(kind: ImpactKind, strength: number, gain: number, pan: number) {
  if (!ctx || !out || !noise || ctx.state !== "running") return;
  const now = ctx.currentTime;
  // a collapse fires hundreds of contacts: cap the voices so it stays a rattle, not a roar
  while (recent.length && now - recent[0] > 0.06) recent.shift();
  if (recent.length > (kind === "snap" ? 3 : 6)) return;
  recent.push(now);
  const level = Math.min(1, strength) * gain;
  if (level < 0.015) return;

  const panner = ctx.createStereoPanner();
  panner.pan.value = Math.max(-1, Math.min(1, pan));
  panner.connect(out);

  const src = ctx.createBufferSource();
  src.buffer = noise;
  src.playbackRate.value = 0.9 + Math.random() * 0.3;
  const band = ctx.createBiquadFilter();
  const env = ctx.createGain();
  const r = Math.random();
  if (kind === "ball") {
    // a thrown brick landing: a bright crack over a dull thump
    band.type = "bandpass";
    band.frequency.value = 1300 + r * 900;
    band.Q.value = 1.4;
    env.gain.setValueAtTime(level, now);
    env.gain.exponentialRampToValueAtTime(0.0001, now + 0.1);
    // the thump under it
    const o = ctx.createOscillator();
    const og = ctx.createGain();
    o.frequency.setValueAtTime(150 + r * 60, now);
    o.frequency.exponentialRampToValueAtTime(60, now + 0.12);
    og.gain.setValueAtTime(level * 0.7, now);
    og.gain.exponentialRampToValueAtTime(0.0001, now + 0.14);
    o.connect(og).connect(panner);
    o.start(now);
    o.stop(now + 0.16);
  } else {
    const snap = kind === "snap";
    band.type = "bandpass";
    band.frequency.value = (snap ? 3600 : 2000) + r * (snap ? 1400 : 1800);
    band.Q.value = snap ? 5 : 2.5 + r * 2;
    const len = snap ? 0.03 : 0.045 + strength * 0.03;
    env.gain.setValueAtTime(level * (snap ? 0.5 : 1), now);
    env.gain.exponentialRampToValueAtTime(0.0001, now + len);
    // a faint ring: hollow plastic sings for a moment
    const o = ctx.createOscillator();
    const og = ctx.createGain();
    o.type = "triangle";
    o.frequency.value = (snap ? 2900 : 1500) + r * 900;
    og.gain.setValueAtTime(level * 0.12, now);
    og.gain.exponentialRampToValueAtTime(0.0001, now + len * 1.4);
    o.connect(og).connect(panner);
    o.start(now);
    o.stop(now + len * 1.5);
  }
  src.connect(band).connect(env).connect(panner);
  src.start(now, Math.random() * 0.15);
  src.stop(now + 0.2);
}

/**
 * The vacuum's motor: rushing air (filtered noise) under a turbine whine and its harmonic, both
 * rising as it spins up and again on boost, with a slight warble. It runs continuously while
 * the vacuum is out; `setVacuum` steers it, and each swallowed piece briefly loads the motor.
 */
let motor: { air: GainNode; airBand: BiquadFilterNode; whine: OscillatorNode; whine2: OscillatorNode; tone: GainNode; level: GainNode; hz: number } | null = null;

function startMotor() {
  if (!ctx || !out || motor) return motor;
  const len = ctx.sampleRate * 2;
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = buf.getChannelData(0);
  // brown-ish noise: the low roar of air through a tube rather than a hiss
  let last = 0;
  for (let i = 0; i < len; i++) {
    const w = Math.random() * 2 - 1;
    last = (last + 0.035 * w) / 1.035;
    d[i] = last * 3.2 + w * 0.18;
  }
  const level = ctx.createGain();
  level.gain.value = 0;
  level.connect(out);
  const src = ctx.createBufferSource();
  src.buffer = buf;
  src.loop = true;
  const airBand = ctx.createBiquadFilter();
  airBand.type = "bandpass";
  airBand.frequency.value = 500;
  airBand.Q.value = 0.6;
  const air = ctx.createGain();
  air.gain.value = 0.9;
  src.connect(airBand).connect(air).connect(level);
  src.start();
  const tone = ctx.createGain();
  tone.gain.value = 0.05;
  const whine = ctx.createOscillator();
  whine.type = "sawtooth";
  whine.frequency.value = 180;
  const soft = ctx.createBiquadFilter();
  soft.type = "lowpass";
  soft.frequency.value = 2600;
  const whine2 = ctx.createOscillator();
  whine2.type = "sine";
  whine2.frequency.value = 360;
  const g2 = ctx.createGain();
  g2.gain.value = 0.6;
  // a slow warble, like a motor that's never quite steady
  const lfo = ctx.createOscillator();
  lfo.frequency.value = 5.3;
  const lfoGain = ctx.createGain();
  lfoGain.gain.value = 9;
  lfo.connect(lfoGain);
  lfoGain.connect(whine.frequency);
  lfoGain.connect(whine2.frequency);
  whine.connect(soft).connect(tone);
  whine2.connect(g2).connect(tone);
  tone.connect(level);
  whine.start();
  whine2.start();
  lfo.start();
  motor = { air, airBand, whine, whine2, tone, level, hz: 180 };
  return motor;
}

/** Spin the motor up or down. `on`: out and running; `boost`: full power; `muted`: sound off. */
export function setVacuum(on: boolean, boost: boolean, muted: boolean) {
  if (!ctx || ctx.state !== "running") return;
  if (!on && !motor) return;
  const m = startMotor();
  if (!m) return;
  const now = ctx.currentTime;
  const run = on ? (boost ? 1 : 0.72) : 0;
  // spinning up takes a moment; winding down takes longer
  const tc = on ? 0.35 : 0.9;
  m.level.gain.setTargetAtTime(muted ? 0 : on ? 0.22 + (boost ? 0.08 : 0) : 0, now, muted ? 0.05 : tc);
  m.hz = on ? 1150 * run + 220 : 90;
  m.whine.frequency.cancelScheduledValues(now);
  m.whine.frequency.setTargetAtTime(m.hz, now, tc);
  m.whine2.frequency.setTargetAtTime(on ? 2300 * run + 440 : 180, now, tc);
  m.airBand.frequency.setTargetAtTime(on ? 380 + 520 * run : 200, now, tc);
  m.tone.gain.setTargetAtTime(on ? 0.035 + 0.03 * run : 0, now, tc);
}

/** A piece going up the wand: a dip in the motor, then a rattle of clacks climbing the tube. */
export function playSlurp(size: number) {
  if (!ctx || !out || !noise || ctx.state !== "running") return;
  const now = ctx.currentTime;
  while (recent.length && now - recent[0] > 0.06) recent.shift();
  if (recent.length > 4) return;
  recent.push(now);
  if (motor) {
    // the load on the motor: its note sags, then recovers
    const f = motor.whine.frequency;
    f.cancelScheduledValues(now);
    f.setValueAtTime(f.value, now);
    f.linearRampToValueAtTime(f.value * (0.86 - size * 0.05), now + 0.04);
    f.setTargetAtTime(motor.hz, now + 0.05, 0.12);
  }
  const hits = 3 + Math.floor(Math.random() * 3);
  for (let k = 0; k < hits; k++) {
    const t = now + 0.012 + k * (0.022 + Math.random() * 0.02);
    const src = ctx.createBufferSource();
    src.buffer = noise;
    const band = ctx.createBiquadFilter();
    band.type = "bandpass";
    // each knock a little higher and fainter as it climbs away up the tube
    band.frequency.value = 1800 + k * 450 + Math.random() * 700;
    band.Q.value = 4;
    const env = ctx.createGain();
    const lv = (0.32 - k * 0.05) * (0.7 + size * 0.5);
    env.gain.setValueAtTime(Math.max(0.02, lv), t);
    env.gain.exponentialRampToValueAtTime(0.0001, t + 0.035);
    src.connect(band).connect(env).connect(out);
    src.start(t, Math.random() * 0.15);
    src.stop(t + 0.05);
  }
}

/** A one-off burst of filtered noise through an envelope (the building block of the paint sounds). */
function noiseHit(at: number, type: BiquadFilterType, freq: number, q: number, level: number, len: number, dest: AudioNode, sweepTo?: number) {
  if (!ctx || !noise) return;
  const src = ctx.createBufferSource();
  src.buffer = noise;
  src.playbackRate.value = 0.85 + Math.random() * 0.3;
  const f = ctx.createBiquadFilter();
  f.type = type;
  f.frequency.setValueAtTime(freq, at);
  if (sweepTo) f.frequency.exponentialRampToValueAtTime(sweepTo, at + len);
  f.Q.value = q;
  const env = ctx.createGain();
  env.gain.setValueAtTime(Math.max(0.0001, level), at);
  env.gain.exponentialRampToValueAtTime(0.0001, at + len);
  src.connect(f).connect(env).connect(dest);
  src.start(at, Math.random() * 0.1);
  src.stop(at + len + 0.02);
}

/** A falling sine: the body of a thump. */
function thump(at: number, from: number, to: number, level: number, len: number, dest: AudioNode) {
  if (!ctx) return;
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.frequency.setValueAtTime(from, at);
  o.frequency.exponentialRampToValueAtTime(to, at + len);
  g.gain.setValueAtTime(level, at);
  g.gain.exponentialRampToValueAtTime(0.0001, at + len);
  o.connect(g).connect(dest);
  o.start(at);
  o.stop(at + len + 0.02);
}

/**
 * The marker firing: the bolt's metallic clack, a hard pop of air out of the barrel with a
 * thump under it, and a short hiss as the valve resets.
 */
export function playShot() {
  if (!ctx || !out || !noise || ctx.state !== "running") return;
  const now = ctx.currentTime;
  const r = Math.random();
  noiseHit(now, "bandpass", 4200 + r * 800, 6, 0.32, 0.018, out);
  noiseHit(now + 0.004, "bandpass", 950 + r * 250, 1.1, 0.9, 0.07, out, 420);
  thump(now + 0.003, 190 + r * 30, 55, 0.6, 0.09, out);
  noiseHit(now + 0.02, "highpass", 5200, 0.7, 0.07, 0.13, out);
}

/**
 * A camera shutter: the mirror slapping up (a dull, quick knock), the curtain's crisp tick, and
 * the mirror coming back down a beat later.
 */
export function playShutter() {
  if (!ctx || !out || !noise || ctx.state !== "running") return;
  const now = ctx.currentTime;
  noiseHit(now, "bandpass", 1800, 1.4, 0.5, 0.035, out, 900);
  thump(now, 160, 70, 0.35, 0.05, out);
  noiseHit(now + 0.012, "highpass", 6200, 0.8, 0.18, 0.02, out);
  noiseHit(now + 0.075, "bandpass", 1500, 1.6, 0.35, 0.04, out, 700);
  thump(now + 0.075, 140, 60, 0.25, 0.05, out);
}

/** Wind rushing past as a shower of bricks falls out of the sky. */
export function playStorm() {
  if (!ctx || !out || !noise || ctx.state !== "running") return;
  const now = ctx.currentTime;
  // the noise buffer is short, so the gust is a run of overlapping swells, rising as it comes
  for (let k = 0; k < 9; k++) noiseHit(now + k * 0.1, "bandpass", 500 + k * 170, 0.8, 0.05 + k * 0.012, 0.2, out, 2200 + k * 200);
}

/** The loader feeding the next ball: a soft plastic rattle. */
export function playFeed() {
  if (!ctx || !out || !noise || ctx.state !== "running") return;
  const now = ctx.currentTime;
  for (let k = 0; k < 3; k++) noiseHit(now + 0.03 + k * (0.018 + Math.random() * 0.012), "bandpass", 2600 + Math.random() * 1200, 5, 0.045, 0.02, out);
}

/**
 * A ball bursting: the shell's crack, then the wet slap of paint (noise sweeping down through a
 * low-pass) and a soft thud. `gain` folds in distance; `pan` is -1..1.
 */
export function playSplat(strength: number, gain: number, pan: number) {
  if (!ctx || !out || !noise || ctx.state !== "running") return;
  const now = ctx.currentTime;
  while (recent.length && now - recent[0] > 0.06) recent.shift();
  if (recent.length > 5) return;
  recent.push(now);
  const level = Math.min(1, 0.4 + strength * 0.6) * gain;
  if (level < 0.015) return;
  const p = ctx.createStereoPanner();
  p.pan.value = Math.max(-1, Math.min(1, pan));
  p.connect(out);
  const r = Math.random();
  noiseHit(now, "bandpass", 3000 + r * 1500, 3, level * 0.55, 0.014, p);
  noiseHit(now + 0.006, "lowpass", 3200 + r * 1200, 2.2, level * 1.1, 0.11, p, 300);
  thump(now + 0.004, 160 + r * 50, 70, level * 0.45, 0.08, p);
}

/** A ball that doesn't break: a hollow tock as it bounces off. */
export function playBounce(gain: number, pan: number) {
  if (!ctx || !out || ctx.state !== "running") return;
  const now = ctx.currentTime;
  const p = ctx.createStereoPanner();
  p.pan.value = Math.max(-1, Math.min(1, pan));
  p.connect(out);
  thump(now, 900 + Math.random() * 200, 600, 0.35 * gain, 0.05, p);
  noiseHit(now, "bandpass", 2200, 4, 0.25 * gain, 0.02, p);
}

/**
 * Gravity switching off: a deep hum winds down under a long breath of air, the way a ride's
 * drop or a station module sounds when everything lets go. Switching back on: the hum climbs
 * and lands with a heavy clunk.
 */
export function playGravity(off: boolean) {
  if (!ctx || !out || !noise || ctx.state !== "running") return;
  const now = ctx.currentTime;
  const len = off ? 1.9 : 0.8;
  const o = ctx.createOscillator();
  const o2 = ctx.createOscillator();
  const g = ctx.createGain();
  o.type = "sine";
  o2.type = "triangle";
  o.frequency.setValueAtTime(off ? 96 : 34, now);
  o.frequency.exponentialRampToValueAtTime(off ? 30 : 92, now + len);
  o2.frequency.setValueAtTime(off ? 192 : 69, now);
  o2.frequency.exponentialRampToValueAtTime(off ? 61 : 185, now + len);
  g.gain.setValueAtTime(0.0001, now);
  g.gain.exponentialRampToValueAtTime(0.42, now + (off ? 0.12 : 0.5));
  g.gain.exponentialRampToValueAtTime(0.0001, now + len + (off ? 0.4 : 0.05));
  const soft = ctx.createBiquadFilter();
  soft.type = "lowpass";
  soft.frequency.value = 420;
  o.connect(g);
  o2.connect(soft).connect(g);
  g.connect(out);
  o.start(now);
  o2.start(now);
  o.stop(now + len + 0.5);
  o2.stop(now + len + 0.5);
  // air: a long sweep of noise (looped, so it outlasts the shared buffer)
  const src = ctx.createBufferSource();
  src.buffer = noise;
  src.loop = true;
  const f = ctx.createBiquadFilter();
  f.type = "bandpass";
  f.Q.value = 0.8;
  f.frequency.setValueAtTime(off ? 1400 : 260, now);
  f.frequency.exponentialRampToValueAtTime(off ? 180 : 1100, now + len);
  const ng = ctx.createGain();
  ng.gain.setValueAtTime(0.0001, now);
  ng.gain.exponentialRampToValueAtTime(off ? 0.16 : 0.1, now + len * 0.35);
  ng.gain.exponentialRampToValueAtTime(0.0001, now + len + 0.2);
  src.connect(f).connect(ng).connect(out);
  src.start(now);
  src.stop(now + len + 0.3);
  if (!off) {
    // the clunk of the field catching
    thump(now + len, 120, 38, 0.7, 0.28, out);
    noiseHit(now + len, "lowpass", 900, 1, 0.35, 0.12, out, 160);
  }
}

/**
 * While weightless, the hush of a cabin: the low rush of ventilation fans (everything floating
 * means the air never stops moving) and the faint, steady hum of the equipment keeping it so.
 */
let cabin: { level: GainNode } | null = null;

export function setZeroG(on: boolean, muted: boolean) {
  if (!ctx || !out || ctx.state !== "running") return;
  if (!on && !cabin) return;
  if (!cabin) {
    const len = ctx.sampleRate * 3;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    let last = 0;
    for (let i = 0; i < len; i++) {
      const w = Math.random() * 2 - 1;
      last = (last + 0.02 * w) / 1.02;
      d[i] = last * 3.5 + w * 0.05;
    }
    const level = ctx.createGain();
    level.gain.value = 0;
    level.connect(out);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = 520;
    src.connect(lp).connect(level);
    src.start();
    // two hums a hair apart, so they beat slowly against each other
    for (const hz of [58, 58.7, 116.4]) {
      const o = ctx.createOscillator();
      o.frequency.value = hz;
      const g = ctx.createGain();
      g.gain.value = hz > 100 ? 0.05 : 0.11;
      o.connect(g).connect(level);
      o.start();
    }
    cabin = { level };
  }
  cabin.level.gain.setTargetAtTime(on && !muted ? 0.32 : 0, ctx.currentTime, on ? 0.9 : 0.35);
}

/** Whether sound can play yet (the browser holds it back until the first press). */
export const soundReady = () => ctx?.state === "running";
