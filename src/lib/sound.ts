import { realState, realUniforms } from "@/experience/real/realState";
import { useApp } from "@/store/useApp";
import { sceneState } from "./sceneState";

/**
 * A synthesized ambient drone (no audio files): two detuned saws through a
 * slowly breathing low-pass, opening up as the journey progresses.
 */
let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let filter: BiquadFilterNode | null = null;
let raf = 0;
let rainGain: GainNode | null = null;

function noise(c: AudioContext, seconds: number) {
  const b = c.createBuffer(1, c.sampleRate * seconds, c.sampleRate);
  const d = b.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  return b;
}

function build() {
  ctx = new AudioContext();
  master = ctx.createGain();
  master.gain.value = 0;
  filter = ctx.createBiquadFilter();
  filter.type = "lowpass";
  filter.frequency.value = 320;
  filter.Q.value = 6;
  filter.connect(master).connect(ctx.destination);

  for (const [f, type, g] of [
    [55, "sawtooth", 0.35],
    [55.37, "sawtooth", 0.35],
    [110.2, "sine", 0.25],
    [164.8, "triangle", 0.08],
  ] as const) {
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.value = f;
    const gain = ctx.createGain();
    gain.gain.value = g;
    o.connect(gain).connect(filter);
    o.start();
  }
  // slow LFO on the cutoff
  const lfo = ctx.createOscillator();
  lfo.frequency.value = 0.07;
  const depth = ctx.createGain();
  depth.gain.value = 120;
  lfo.connect(depth).connect(filter.frequency);
  lfo.start();

  // rain: looped noise through a band-pass, faded in with the storm
  const hiss = ctx.createBufferSource();
  hiss.buffer = noise(ctx, 3);
  hiss.loop = true;
  const band = ctx.createBiquadFilter();
  band.type = "bandpass";
  band.frequency.value = 2400;
  band.Q.value = 0.5;
  rainGain = ctx.createGain();
  rainGain.gain.value = 0;
  hiss.connect(band).connect(rainGain).connect(master);
  hiss.start();
}

/** A roll of thunder, `delay` seconds after the flash. */
export function thunder(delay: number) {
  if (!ctx || !master || ctx.state !== "running") return;
  const src = ctx.createBufferSource();
  src.buffer = noise(ctx, 4);
  const low = ctx.createBiquadFilter();
  low.type = "lowpass";
  low.frequency.value = 160;
  const g = ctx.createGain();
  const t = ctx.currentTime + delay;
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(5, t + 0.08);
  g.gain.exponentialRampToValueAtTime(0.001, t + 3.6);
  src.connect(low).connect(g).connect(master);
  src.start(t);
  src.stop(t + 4);
}

let enabled = false;
let stepNoise: AudioBuffer | null = null;
let hallVerb: { input: GainNode } | null = null;

/** A short feedback-delay "room" so footfalls ring in the marble hall. */
function buildVerb(c: AudioContext) {
  const input = c.createGain();
  const out = c.createGain();
  out.gain.value = 0.32;
  for (const [t, fb] of [
    [0.067, 0.42],
    [0.109, 0.36],
    [0.153, 0.3],
  ] as const) {
    const d = c.createDelay(0.5);
    d.delayTime.value = t;
    const g = c.createGain();
    g.gain.value = fb;
    const damp = c.createBiquadFilter();
    damp.type = "lowpass";
    damp.frequency.value = 2600;
    input.connect(d);
    d.connect(damp).connect(g).connect(d);
    damp.connect(out);
  }
  out.connect(c.destination);
  return { input };
}

/** A short burst of the shared noise through a band-pass, with a fast attack and decay. */
function burst(c: AudioContext, out: AudioNode, t: number, freq: number, q: number, peak: number, decay: number) {
  stepNoise ??= noise(c, 0.4);
  const src = c.createBufferSource();
  src.buffer = stepNoise;
  src.playbackRate.value = 0.85 + Math.random() * 0.3;
  const band = c.createBiquadFilter();
  band.type = "bandpass";
  band.frequency.value = freq * (0.9 + Math.random() * 0.2);
  band.Q.value = q;
  const env = c.createGain();
  env.gain.setValueAtTime(0, t);
  env.gain.linearRampToValueAtTime(peak, t + 0.006);
  env.gain.exponentialRampToValueAtTime(0.001, t + decay);
  src.connect(band).connect(env).connect(out);
  src.start(t, Math.random() * 0.2, decay + 0.05);
}

export type StepSurface = "marble" | "stone" | "grass" | "water";

/**
 * One footfall: a filtered noise scuff over a low heel thump. Marble is brighter and rings in
 * the hall; stone outside is duller and dry; grass is a soft rustle; wet ground and the pools
 * add a splash. `weight` scales with speed / landing.
 */
export function footstep(surface: StepSurface, weight = 1) {
  if (!enabled || !ctx || ctx.state !== "running") return;
  const c = ctx;
  const t = c.currentTime + 0.005;
  const out = c.createGain();
  out.gain.value = Math.min(1.4, weight) * 0.22;
  out.connect(c.destination);
  if (surface === "marble") {
    hallVerb ??= buildVerb(c);
    out.connect(hallVerb.input);
  }

  if (surface === "grass") {
    burst(c, out, t, 700, 0.6, 0.55, 0.18);
    burst(c, out, t + 0.03, 1900, 0.9, 0.25, 0.12);
  } else {
    burst(c, out, t, surface === "marble" ? 2300 : 1100, surface === "marble" ? 1.4 : 0.8, surface === "marble" ? 0.9 : 0.7, surface === "marble" ? 0.09 : 0.13);
  }
  // the paving soaks in the rain; the pools always splash
  const wet = surface === "water" ? 1 : surface === "marble" ? 0 : realState.active ? realUniforms.uWet.value : 0;
  if (wet > 0.05) {
    burst(c, out, t + 0.012, 4200, 0.7, 0.8 * wet, 0.07);
    burst(c, out, t + 0.04, 2600, 1.1, 0.45 * wet, 0.11);
  }

  const thump = c.createOscillator();
  thump.type = "sine";
  thump.frequency.setValueAtTime(surface === "marble" ? 130 : 95, t);
  thump.frequency.exponentialRampToValueAtTime(48, t + 0.08);
  const tg = c.createGain();
  tg.gain.setValueAtTime(0.0001, t);
  tg.gain.exponentialRampToValueAtTime(surface === "grass" ? 0.25 : 0.55, t + 0.008);
  tg.gain.exponentialRampToValueAtTime(0.0001, t + 0.1);
  thump.connect(tg).connect(out);
  thump.start(t);
  thump.stop(t + 0.12);
}

// ---------------------------------------------------------------- pavilion ambience
/**
 * The /flow pavilion's outdoor ambience: crickets on a clear night and raindrops pattering on
 * the stone in the storm. Muffled (and quieter) while you are inside the hall.
 */
let outdoor: { bus: GainNode; muffle: BiquadFilterNode } | null = null;
const amb = { nextChirp: 0, nextDrip: 0 };
// a few crickets around the site, each with its own pitch, rhythm and place
const CRICKETS = Array.from({ length: 6 }, (_, i) => ({
  freq: 4300 + i * 170 + Math.random() * 80,
  pan: -0.9 + (i / 5) * 1.8,
  pulses: 2 + (i % 3),
  gain: 0.5 + Math.random() * 0.5,
}));

function buildOutdoor(c: AudioContext) {
  const bus = c.createGain();
  bus.gain.value = 0;
  const muffle = c.createBiquadFilter();
  muffle.type = "lowpass";
  muffle.frequency.value = 16000;
  bus.connect(muffle).connect(c.destination);
  return { bus, muffle };
}

function chirp(c: AudioContext, out: AudioNode, t: number) {
  const k = CRICKETS[Math.floor(Math.random() * CRICKETS.length)];
  const o = c.createOscillator();
  o.type = "sine";
  o.frequency.value = k.freq;
  const env = c.createGain();
  env.gain.value = 0;
  const pan = c.createStereoPanner();
  pan.pan.value = k.pan;
  // a stridulation: a few 15ms pulses, 22ms apart
  for (let p = 0; p < k.pulses; p++) {
    const s = t + p * 0.037;
    env.gain.setValueAtTime(0, s);
    env.gain.linearRampToValueAtTime(0.05 * k.gain, s + 0.004);
    env.gain.linearRampToValueAtTime(0, s + 0.015);
  }
  o.connect(env).connect(pan).connect(out);
  o.start(t);
  o.stop(t + k.pulses * 0.037 + 0.02);
}

function drip(c: AudioContext, out: AudioNode, t: number) {
  const pan = c.createStereoPanner();
  pan.pan.value = Math.random() * 2 - 1;
  pan.connect(out);
  burst(c, pan, t, 2800 + Math.random() * 3500, 2 + Math.random() * 3, 0.05 + Math.random() * 0.07, 0.025 + Math.random() * 0.03);
}

/** The pavilion's weather, as heard: night (crickets), rain, and whether you are indoors. */
function flowAir() {
  const s = useApp.getState();
  if (s.mode !== "flow") return null;
  const real = realState.active;
  // the blueprint pavilion is always drawn under a clear night sky
  const night = real ? realState.night : 1;
  const rain = real ? realState.rain : 0;
  const inside = s.flowView === "hall" || s.flowView === "showcase" || (s.flowView === "walk" && sceneState.flow.fp.indoors);
  return { night, rain, inside };
}

function ambience(c: AudioContext) {
  outdoor ??= buildOutdoor(c);
  const air = flowAir();
  const now = c.currentTime;
  outdoor.bus.gain.setTargetAtTime(air ? (air.inside ? 0.35 : 1) : 0, now, 0.4);
  outdoor.muffle.frequency.setTargetAtTime(air?.inside ? 650 : 16000, now, 0.3);
  if (!air) return;
  const crickets = air.night * (1 - air.rain);
  // schedule a little ahead so a dropped frame does not stall the rhythm
  if (crickets > 0.05) {
    while (amb.nextChirp < now + 0.2) {
      amb.nextChirp = Math.max(amb.nextChirp, now) + (0.12 + Math.random() * 0.35) / crickets;
      if (Math.random() < crickets) chirp(c, outdoor.bus, amb.nextChirp);
    }
  }
  if (air.rain > 0.05) {
    while (amb.nextDrip < now + 0.2) {
      amb.nextDrip = Math.max(amb.nextDrip, now) + Math.random() / (40 * air.rain);
      drip(c, outdoor.bus, amb.nextDrip);
    }
  }
}

const follow = () => {
  if (ctx && filter) filter.frequency.setTargetAtTime(260 + sceneState.p * 900, ctx.currentTime, 0.4);
  const flowRain = realState.active && useApp.getState().mode === "flow" ? realState.rain : 0;
  if (ctx && rainGain) rainGain.gain.setTargetAtTime(Math.max(sceneState.weather.rain, sceneState.valley.rain, flowRain) * 0.9, ctx.currentTime, 0.5);
  if (ctx && ctx.state === "running") ambience(ctx);
  raf = requestAnimationFrame(follow);
};

export function setSound(on: boolean) {
  enabled = on;
  if (on && !ctx) build();
  if (!ctx || !master) return;
  if (on) {
    ctx.resume();
    master.gain.setTargetAtTime(0.06, ctx.currentTime, 0.8);
    cancelAnimationFrame(raf);
    follow();
  } else {
    master.gain.setTargetAtTime(0, ctx.currentTime, 0.3);
    cancelAnimationFrame(raf);
    const c = ctx;
    setTimeout(() => {
      if (master && master.gain.value < 0.001) c.suspend();
    }, 1500);
  }
}

// ---------------------------------------------------------------- the multiverse
/** A band of noise swept from f0 to f1 over `dur` seconds: the rush of air through a portal. */
function sweep(c: AudioContext, t: number, dur: number, f0: number, f1: number, peak: number) {
  const src = c.createBufferSource();
  src.buffer = noise(c, Math.ceil(dur + 0.5));
  const band = c.createBiquadFilter();
  band.type = "bandpass";
  band.Q.value = 1.4;
  band.frequency.setValueAtTime(f0, t);
  band.frequency.exponentialRampToValueAtTime(f1, t + dur);
  const g = c.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(peak, t + dur * 0.75);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur + 0.25);
  src.connect(band).connect(g).connect(c.destination);
  src.start(t);
  src.stop(t + dur + 0.4);
}

function boom(c: AudioContext, t: number, peak: number) {
  const o = c.createOscillator();
  o.type = "sine";
  o.frequency.setValueAtTime(90, t);
  o.frequency.exponentialRampToValueAtTime(28, t + 1.2);
  const g = c.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(peak, t + 0.02);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 1.4);
  o.connect(g).connect(c.destination);
  o.start(t);
  o.stop(t + 1.5);
}

/**
 * The multiverse fall, as heard: the gate winding up ("open"), each new world tearing open
 * with a crackle of sparks ("jump"), and the drop back into the clearing ("close").
 */
export function multiverseCue(kind: "open" | "jump" | "close") {
  if (!enabled || !ctx || ctx.state !== "running") return;
  const c = ctx;
  const t = c.currentTime + 0.01;
  if (kind === "open") {
    sweep(c, t, 1.6, 180, 2600, 0.5);
    boom(c, t + 1.55, 0.9);
  } else if (kind === "jump") {
    sweep(c, t, 0.45, 500, 4200, 0.35);
    for (let i = 0; i < 9; i++) burst(c, c.destination, t + Math.random() * 0.4, 3000 + Math.random() * 4000, 3, 0.12, 0.03);
  } else {
    sweep(c, t, 1.1, 3200, 160, 0.4);
    boom(c, t + 0.15, 0.6);
  }
}
