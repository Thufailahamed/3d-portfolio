/**
 * Every sound in the park is synthesised (no audio files). Die-cast is small, dense metal on
 * hollow plastic: a launch is a spring's thwack, a car rolling is a dry hiss with a click at
 * every track joint, a landing is a plastic clack with a metallic rattle, blocks knock like wood.
 */
let ctx: AudioContext | null = null;
let out: GainNode | null = null;
let noise: AudioBuffer | null = null;
let roll: { src: AudioBufferSourceNode; band: BiquadFilterNode; gain: GainNode } | null = null;
let fire: { gain: GainNode; band: BiquadFilterNode } | null = null;
let motor: { osc: OscillatorNode; osc2: OscillatorNode; lp: BiquadFilterNode; gain: GainNode } | null = null;
let skid: { band: BiquadFilterNode; gain: GainNode } | null = null;
let muted = false;
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
  out.gain.value = muted ? 0 : 0.6;
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -16;
  comp.ratio.value = 5;
  out.connect(comp).connect(ctx.destination);
  noise = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
  const d = noise.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  startBeds();
}

export function setMuted(m: boolean) {
  muted = m;
  if (out && ctx) out.gain.setTargetAtTime(m ? 0 : 0.6, ctx.currentTime, 0.05);
}

const live = () => !!ctx && !!out && !!noise && ctx.state === "running" && !muted;

/** Too many voices at once turn a pile-up into a roar: cap them per short window. */
function voice(limit: number) {
  const now = ctx!.currentTime;
  while (recent.length && now - recent[0] > 0.05) recent.shift();
  if (recent.length > limit) return false;
  recent.push(now);
  return true;
}

function pannerAt(pan: number) {
  const p = ctx!.createStereoPanner();
  p.pan.value = Math.max(-1, Math.min(1, pan));
  p.connect(out!);
  return p;
}

function burst(dest: AudioNode, opts: { type: BiquadFilterType; f: number; q: number; level: number; len: number; rate?: number; delay?: number }) {
  const now = ctx!.currentTime + (opts.delay ?? 0);
  const src = ctx!.createBufferSource();
  src.buffer = noise;
  src.playbackRate.value = opts.rate ?? 1;
  const band = ctx!.createBiquadFilter();
  band.type = opts.type;
  band.frequency.value = opts.f;
  band.Q.value = opts.q;
  const env = ctx!.createGain();
  env.gain.setValueAtTime(Math.max(0.0001, opts.level), now);
  env.gain.exponentialRampToValueAtTime(0.0001, now + opts.len);
  src.connect(band).connect(env).connect(dest);
  src.start(now, Math.random() * 1.5);
  src.stop(now + opts.len + 0.02);
}

function tone(dest: AudioNode, opts: { type?: OscillatorType; f0: number; f1?: number; level: number; len: number; delay?: number; attack?: number }) {
  const now = ctx!.currentTime + (opts.delay ?? 0);
  const o = ctx!.createOscillator();
  o.type = opts.type ?? "sine";
  o.frequency.setValueAtTime(opts.f0, now);
  if (opts.f1) o.frequency.exponentialRampToValueAtTime(opts.f1, now + opts.len);
  const g = ctx!.createGain();
  const a = opts.attack ?? 0.002;
  g.gain.setValueAtTime(0.0001, now);
  g.gain.linearRampToValueAtTime(opts.level, now + a);
  g.gain.exponentialRampToValueAtTime(0.0001, now + opts.len);
  o.connect(g).connect(dest);
  o.start(now);
  o.stop(now + opts.len + 0.02);
}

/** The rolling hiss (one voice, steered by the fastest car near the camera) and the ring's fire. */
function startBeds() {
  if (!ctx || !out || !noise) return;
  const src = ctx.createBufferSource();
  src.buffer = noise;
  src.loop = true;
  const band = ctx.createBiquadFilter();
  band.type = "bandpass";
  band.frequency.value = 900;
  band.Q.value = 0.8;
  const gain = ctx.createGain();
  gain.gain.value = 0;
  src.connect(band).connect(gain).connect(out);
  src.start();
  roll = { src, band, gain };

  const fsrc = ctx.createBufferSource();
  fsrc.buffer = noise;
  fsrc.loop = true;
  fsrc.playbackRate.value = 0.5;
  const fb = ctx.createBiquadFilter();
  fb.type = "lowpass";
  fb.frequency.value = 500;
  const fg = ctx.createGain();
  fg.gain.value = 0;
  fsrc.connect(fb).connect(fg).connect(out);
  fsrc.start();
  fire = { gain: fg, band: fb };

  // your car in the Stunt Yard: a little electric motor's whine (two detuned saws, filtered)
  const osc = ctx.createOscillator();
  osc.type = "sawtooth";
  osc.frequency.value = 90;
  const osc2 = ctx.createOscillator();
  osc2.type = "sawtooth";
  osc2.frequency.value = 181;
  const lp = ctx.createBiquadFilter();
  lp.type = "lowpass";
  lp.frequency.value = 600;
  lp.Q.value = 3;
  const mg = ctx.createGain();
  mg.gain.value = 0;
  osc.connect(lp);
  osc2.connect(lp);
  lp.connect(mg).connect(out);
  osc.start();
  osc2.start();
  motor = { osc, osc2, lp, gain: mg };

  // tyres sliding on the mat: a high, narrow hiss
  const ssrc = ctx.createBufferSource();
  ssrc.buffer = noise;
  ssrc.loop = true;
  ssrc.playbackRate.value = 1.3;
  const sb = ctx.createBiquadFilter();
  sb.type = "bandpass";
  sb.frequency.value = 3200;
  sb.Q.value = 6;
  const sg = ctx.createGain();
  sg.gain.value = 0;
  ssrc.connect(sb).connect(sg).connect(out);
  ssrc.start();
  skid = { band: sb, gain: sg };
}

/** The motor: road speed (cm/s), how hard you're pressing (0..1), nitro on. */
export function setMotor(speed: number, throttle: number, nitro: boolean, on: boolean) {
  if (!ctx || !motor) return;
  const t = ctx.currentTime;
  const k = Math.min(1.4, Math.abs(speed) / 450);
  const f = 70 + k * 420 + (nitro ? 160 : 0);
  motor.osc.frequency.setTargetAtTime(f, t, 0.04);
  motor.osc2.frequency.setTargetAtTime(f * 2.01, t, 0.04);
  motor.lp.frequency.setTargetAtTime(500 + Math.abs(throttle) * 1600 + (nitro ? 1800 : 0), t, 0.05);
  motor.gain.gain.setTargetAtTime(on ? 0.035 + Math.abs(throttle) * 0.05 + (nitro ? 0.04 : 0) : 0, t, 0.06);
}
/** Tyre squeal, by how fast the car is sliding sideways (cm/s). */
export function setSkid(slip: number) {
  if (!ctx || !skid) return;
  const k = Math.max(0, Math.min(1, (slip - 40) / 220));
  skid.gain.gain.setTargetAtTime(k * 0.07, ctx.currentTime, 0.04);
  skid.band.frequency.setTargetAtTime(2600 + k * 1400, ctx.currentTime, 0.05);
}
/** A hop: a springy plastic boing. */
export function playHop() {
  if (!live()) return;
  const p = pannerAt(0);
  tone(p, { type: "triangle", f0: 380, f1: 760, level: 0.12, len: 0.16 });
  burst(p, { type: "bandpass", f: 1400, q: 2, level: 0.2, len: 0.03 });
}
/** A challenge done: a bright little rising fanfare. */
export function playFanfare() {
  if (!live()) return;
  const p = pannerAt(0);
  [523, 659, 784, 1047].forEach((f, i) => {
    tone(p, { type: "triangle", f0: f, level: 0.12, len: 0.32, delay: i * 0.09 });
    tone(p, { type: "sine", f0: f * 2, level: 0.04, len: 0.28, delay: i * 0.09 });
  });
  tone(p, { type: "triangle", f0: 1047, level: 0.1, len: 0.9, delay: 0.38 });
}

/** Steer the rolling hiss: speed in cm/s, how loud by distance (0..1). */
export function setRolling(speed: number, gain: number) {
  if (!ctx || !roll) return;
  const k = Math.min(1, speed / 500);
  roll.gain.gain.setTargetAtTime(k * k * gain * 0.22, ctx.currentTime, 0.05);
  roll.band.frequency.setTargetAtTime(500 + k * 2600, ctx.currentTime, 0.05);
}
/** The ring of fire's roar, by how close it is (0..1). */
export function setFire(gain: number) {
  if (!ctx || !fire) return;
  fire.gain.gain.setTargetAtTime(gain * 0.12, ctx.currentTime, 0.2);
}

/** A car's wheels over a joint between track pieces: a tiny dry click. */
export function playJoint(strength: number, gain: number, pan: number) {
  if (!live() || !voice(8)) return;
  const level = Math.min(1, strength) * gain * 0.35;
  if (level < 0.01) return;
  burst(pannerAt(pan), { type: "bandpass", f: 3200 + Math.random() * 900, q: 4, level, len: 0.018 });
}

/** The spring launcher firing: a sharp thwack, a body thud and the spring's ring. */
export function playLaunch(power: number) {
  if (!live()) return;
  const p = pannerAt(0);
  burst(p, { type: "bandpass", f: 2200, q: 1.2, level: 0.5 + power * 0.5, len: 0.06 });
  tone(p, { f0: 160, f1: 70, level: 0.45 * (0.5 + power), len: 0.14 });
  tone(p, { type: "triangle", f0: 620 + power * 200, f1: 420, level: 0.08, len: 0.35 });
}
/** Pulling the plunger back: a ratchet. */
export function playRatchet() {
  if (!live() || !voice(4)) return;
  burst(pannerAt(0), { type: "highpass", f: 2600, q: 1, level: 0.14, len: 0.02 });
}
export function playGate() {
  if (!live()) return;
  const p = pannerAt(0);
  burst(p, { type: "bandpass", f: 1800, q: 3, level: 0.35, len: 0.04 });
  tone(p, { type: "square", f0: 900, f1: 600, level: 0.04, len: 0.08 });
}
/** A booster grabbing a car: motor whine up and a rubbery slap. */
export function playBoost(gain: number, pan: number) {
  if (!live()) return;
  const p = pannerAt(pan);
  tone(p, { type: "sawtooth", f0: 140, f1: 420, level: 0.09 * gain, len: 0.35, attack: 0.02 });
  tone(p, { type: "sawtooth", f0: 282, f1: 846, level: 0.04 * gain, len: 0.3, attack: 0.02 });
  burst(p, { type: "bandpass", f: 700, q: 1.5, level: 0.4 * gain, len: 0.08 });
}

export type HitKind = "floor" | "block" | "car" | "track" | "prop" | "land" | "bump";

/** Something hits something. Die-cast clinks, plastic clacks, wood knocks. */
export function playHit(kind: HitKind, strength: number, gain: number, pan: number) {
  if (!live() || !voice(kind === "block" ? 6 : 5)) return;
  const level = Math.min(1.2, strength) * gain;
  if (level < 0.02) return;
  const p = pannerAt(pan);
  const r = Math.random();
  if (kind === "block") {
    // hollow wood: a knock with two short resonances
    burst(p, { type: "bandpass", f: 900 + r * 400, q: 2.5, level: level * 0.7, len: 0.05 });
    tone(p, { type: "sine", f0: 520 + r * 160, level: level * 0.3, len: 0.09 });
    tone(p, { type: "sine", f0: 1310 + r * 300, level: level * 0.12, len: 0.05 });
  } else if (kind === "floor" || kind === "car") {
    // metal on wood or metal on metal: a bright clink with a ring
    burst(p, { type: "bandpass", f: 2800 + r * 1500, q: 3, level: level * 0.6, len: 0.04 });
    tone(p, { type: "triangle", f0: 2400 + r * 1800, level: level * 0.12, len: 0.12 });
    tone(p, { f0: 180, f1: 90, level: level * 0.25, len: 0.08 });
  } else {
    // on plastic: a clack and a rattle of the axles
    burst(p, { type: "bandpass", f: 1500 + r * 800, q: 2, level: level * 0.8, len: 0.05 });
    tone(p, { f0: 220, f1: 110, level: level * 0.3, len: 0.07 });
    if (kind === "land") for (let i = 1; i < 4; i++) burst(p, { type: "bandpass", f: 3500, q: 4, level: level * 0.2 / i, len: 0.02, delay: i * 0.035 });
  }
}

/** A car's zamac base grinding the outside wall in a hard bend: a short gritty hiss. */
export function playScrape(strength: number, gain: number, pan: number) {
  if (!live() || !voice(3)) return;
  const level = Math.min(1, strength) * gain * 0.22;
  if (level < 0.01) return;
  burst(pannerAt(pan), { type: "bandpass", f: 4200 + Math.random() * 1600, q: 1.6, level, len: 0.07, rate: 1.4 });
}

/** Two cars meeting side-on: a crunch of metal on metal, a body thump, and the bits rattling off. */
export function playCrash(strength: number, gain: number, pan: number) {
  if (!live()) return;
  const level = Math.min(1.3, strength) * gain;
  const p = pannerAt(pan);
  burst(p, { type: "bandpass", f: 2300, q: 1.1, level: level * 0.9, len: 0.09 });
  burst(p, { type: "highpass", f: 5200, q: 0.8, level: level * 0.35, len: 0.16 });
  tone(p, { f0: 150, f1: 60, level: level * 0.5, len: 0.16 });
  tone(p, { type: "triangle", f0: 3100 + Math.random() * 900, level: level * 0.1, len: 0.22 });
  for (let i = 1; i < 6; i++) burst(p, { type: "bandpass", f: 3000 + Math.random() * 2500, q: 5, level: (level * 0.3) / i, len: 0.025, delay: 0.05 + i * 0.045 + Math.random() * 0.02 });
}

/** The crowd cheering: shaped noise with a few vowel-ish formants. */
export function playCheer(strength = 1) {
  if (!live()) return;
  const p = pannerAt(0);
  const now = ctx!.currentTime;
  for (const [f, q, l] of [
    [600, 3, 0.18],
    [1150, 4, 0.12],
    [2400, 5, 0.06],
  ] as const) {
    const src = ctx!.createBufferSource();
    src.buffer = noise;
    const band = ctx!.createBiquadFilter();
    band.type = "bandpass";
    band.frequency.value = f;
    band.Q.value = q;
    const env = ctx!.createGain();
    env.gain.setValueAtTime(0.0001, now);
    env.gain.linearRampToValueAtTime(l * strength, now + 0.25);
    env.gain.setTargetAtTime(0.0001, now + 0.9, 0.35);
    src.connect(band).connect(env).connect(p);
    src.start(now, Math.random());
    src.stop(now + 2.4);
  }
  // a couple of whistles in it
  tone(p, { f0: 1800, f1: 2600, level: 0.03 * strength, len: 0.35, delay: 0.2, attack: 0.05 });
}

/** The start tree: a beep for each amber, a higher one on green. */
export function playBeep(go: boolean) {
  if (!live()) return;
  const p = pannerAt(0);
  tone(p, { type: "square", f0: go ? 1320 : 660, level: 0.07, len: go ? 0.45 : 0.16, attack: 0.005 });
}
/** Finish: a bell. */
export function playBell() {
  if (!live()) return;
  const p = pannerAt(0);
  for (const [f, l] of [
    [1568, 0.12],
    [2093, 0.08],
    [3136, 0.04],
  ] as const)
    tone(p, { f0: f, level: l, len: 1.2 });
}
/** A soft whoosh (loops, ring of fire). */
export function playWhoosh(gain = 1) {
  if (!live()) return;
  const p = pannerAt(0);
  const now = ctx!.currentTime;
  const src = ctx!.createBufferSource();
  src.buffer = noise;
  const band = ctx!.createBiquadFilter();
  band.type = "bandpass";
  band.Q.value = 1.2;
  band.frequency.setValueAtTime(400, now);
  band.frequency.exponentialRampToValueAtTime(2400, now + 0.3);
  const env = ctx!.createGain();
  env.gain.setValueAtTime(0.0001, now);
  env.gain.linearRampToValueAtTime(0.25 * gain, now + 0.12);
  env.gain.exponentialRampToValueAtTime(0.0001, now + 0.45);
  src.connect(band).connect(env).connect(p);
  src.start(now, Math.random());
  src.stop(now + 0.5);
}
export function playClick() {
  if (!live()) return;
  burst(pannerAt(0), { type: "bandpass", f: 2600, q: 3, level: 0.15, len: 0.02 });
}

export function stopSound() {
  if (!ctx) return;
  setRolling(0, 0);
  setFire(0);
  setMotor(0, 0, false, false);
  setSkid(0);
}
