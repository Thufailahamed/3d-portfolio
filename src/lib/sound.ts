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

const follow = () => {
  if (ctx && filter) filter.frequency.setTargetAtTime(260 + sceneState.p * 900, ctx.currentTime, 0.4);
  if (ctx && rainGain) rainGain.gain.setTargetAtTime(Math.max(sceneState.weather.rain, sceneState.valley.rain) * 0.9, ctx.currentTime, 0.5);
  raf = requestAnimationFrame(follow);
};

export function setSound(on: boolean) {
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
