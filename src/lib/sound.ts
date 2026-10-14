import { sceneState } from "./sceneState";

/**
 * A synthesized ambient drone (no audio files): two detuned saws through a
 * slowly breathing low-pass, opening up as the journey progresses.
 */
let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let filter: BiquadFilterNode | null = null;
let raf = 0;

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
}

const follow = () => {
  if (ctx && filter) filter.frequency.setTargetAtTime(260 + sceneState.p * 900, ctx.currentTime, 0.4);
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
