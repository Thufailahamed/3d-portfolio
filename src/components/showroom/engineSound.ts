/**
 * A synthesised engine note, so the showroom needs no recordings. The firing frequency follows the
 * rpm and the cylinder count (rpm / 60 × cylinders / 2): a buzzy pulse train for the exhaust, a
 * sub-octave for the crank's rumble, filtered noise for the intake, all through a low-pass that
 * opens as the revs rise, with a slow wobble so the idle lopes like a real one.
 */
export type Engine = {
  /** blip the throttle: up to `rpm`, then fall back to idle */
  rev: (rpm?: number) => void;
  setVolume: (v: number) => void;
  stop: () => void;
};

const IDLE = 900;

export function startEngine(cylinders: number, volume = 0.6): Engine | null {
  const AC = typeof window !== "undefined" ? (window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext) : undefined;
  if (!AC) return null;
  const ctx = new AC();
  const now = ctx.currentTime;
  const fire = (rpm: number) => (rpm / 60) * (cylinders / 2);

  const master = ctx.createGain();
  master.gain.value = 0;
  master.connect(ctx.destination);

  // a little grit, as an exhaust has
  const shaper = ctx.createWaveShaper();
  const curve = new Float32Array(1024);
  for (let i = 0; i < curve.length; i++) {
    const x = (i / (curve.length - 1)) * 2 - 1;
    curve[i] = Math.tanh(x * 2.4);
  }
  shaper.curve = curve;

  const tone = ctx.createBiquadFilter();
  tone.type = "lowpass";
  tone.Q.value = 2.2;
  tone.frequency.value = 380;
  shaper.connect(tone).connect(master);

  // exhaust: a narrow pulse made of two detuned saws
  const exA = ctx.createOscillator();
  const exB = ctx.createOscillator();
  exA.type = exB.type = "sawtooth";
  exB.detune.value = 9;
  const exGain = ctx.createGain();
  exGain.gain.value = 0.32;
  exA.connect(exGain);
  exB.connect(exGain);
  exGain.connect(shaper);

  // the crank's rumble, an octave down
  const sub = ctx.createOscillator();
  sub.type = "triangle";
  const subGain = ctx.createGain();
  subGain.gain.value = 0.5;
  sub.connect(subGain).connect(shaper);

  // intake hiss
  const noise = ctx.createBufferSource();
  const buf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  noise.buffer = buf;
  noise.loop = true;
  const hiss = ctx.createBiquadFilter();
  hiss.type = "bandpass";
  hiss.Q.value = 0.9;
  hiss.frequency.value = 900;
  const hissGain = ctx.createGain();
  hissGain.gain.value = 0.025;
  noise.connect(hiss).connect(hissGain).connect(master);

  // the lope: a slow tremor on the level and a touch on the pitch
  const lope = ctx.createOscillator();
  lope.frequency.value = cylinders >= 10 ? 7 : 4.5;
  const lopeAmp = ctx.createGain();
  lopeAmp.gain.value = 0.12;
  lope.connect(lopeAmp).connect(exGain.gain);
  const lopePitch = ctx.createGain();
  lopePitch.gain.value = 1.5;
  lope.connect(lopePitch);
  lopePitch.connect(exA.frequency);
  lopePitch.connect(exB.frequency);

  const setRpm = (rpm: number, at: number, tc: number) => {
    const f = fire(rpm);
    exA.frequency.setTargetAtTime(f, at, tc);
    exB.frequency.setTargetAtTime(f, at, tc);
    sub.frequency.setTargetAtTime(f / 2, at, tc);
    tone.frequency.setTargetAtTime(260 + rpm * 0.32, at, tc);
    hiss.frequency.setTargetAtTime(600 + rpm * 0.25, at, tc);
    hissGain.gain.setTargetAtTime(0.02 + (rpm / 8000) * 0.06, at, tc);
  };

  setRpm(IDLE, now, 0.01);
  for (const o of [exA, exB, sub, lope]) o.start(now);
  noise.start(now);
  // turn the key: crank, catch, settle
  master.gain.setTargetAtTime(volume * 0.5, now, 0.05);
  setRpm(2600, now + 0.25, 0.08);
  setRpm(IDLE, now + 0.75, 0.35);

  let level = volume;
  return {
    rev(rpm = 6800) {
      const t = ctx.currentTime;
      if (ctx.state === "suspended") void ctx.resume();
      setRpm(rpm, t, 0.12);
      master.gain.setTargetAtTime(level * 0.75, t, 0.08);
      setRpm(IDLE, t + 0.45, 0.4);
      master.gain.setTargetAtTime(level * 0.5, t + 0.45, 0.4);
    },
    setVolume(v: number) {
      level = v;
      master.gain.setTargetAtTime(v * 0.5, ctx.currentTime, 0.1);
    },
    stop() {
      const t = ctx.currentTime;
      // the engine dies: revs and level fall away together
      setRpm(300, t, 0.15);
      master.gain.setTargetAtTime(0, t, 0.12);
      window.setTimeout(() => void ctx.close(), 900);
    },
  };
}
