"use client";

import * as THREE from "three";
import { getLab } from "../lab";
import { STAGES, type StageId } from "../story";
import { useVoice } from "../store";

// the lab's visual language is shared with /diffusion: Plex labels, lacquer panels, anodised bezels
export { Bezel, Caption, Label, MAT, Screen, Stand, ThemeProvider, approach, put, smooth, type Theme } from "@/diffusion/pipeline/scene/common";

export const FONT_DISPLAY = "/voice/fonts/archivo-latin-600-normal.woff";
export const FONT_QUOTE = "/voice/fonts/newsreader-latin-400-italic.woff";

/** a studio at night: cool steel, tungsten for speech, plus one hue per kind of data */
export const C = {
  fg: "#e9edf1",
  dim: "#9aa3ad",
  faint: "#56606a",
  wire: "#2c333a",
  /** speech, and the detector saying so: the tungsten of a lit studio lamp */
  speech: "#ffb547",
  /** text and tokens */
  text: "#8fb4ff",
  /** time: positions, timestamps */
  time: "#5fd4c0",
  /** a decoder that isn't sure */
  unsure: "#ff7a59",
  silence: "#353b42",
  pad: "#20252b",
};

/** progress of a stage: 0 before it, its playhead during it, 1 after */
export function stageT(id: StageId) {
  const s = useVoice.getState();
  const i = STAGES.findIndex((st) => st.id === id);
  return s.stage > i ? 1 : s.stage < i ? 0 : s.p;
}

export function isStage(id: StageId) {
  const s = useVoice.getState();
  return STAGES[s.stage]?.id === id;
}

/** the microphone is open: stations show the live signal instead of the run */
export const isLive = () => !!getLab()?.live;

/**
 * A 30-second axis W wide where the clip's own seconds take `share` of the width and Whisper's zero padding
 * the rest, so a few seconds of speech stay readable next to 25 s of nothing. Returns t (s) → x (0 … W).
 */
export function axis30(duration: number, W: number, share = 0.74) {
  const d = Math.min(30, Math.max(0.5, duration));
  const tail = 30 - d;
  return (t: number) => (t <= d ? (t / d) * share * W : share * W + (tail > 0 ? ((t - d) / tail) * (1 - share) * W : 0));
}

/** a float texture of one channel, nearest-sampled, for shaders that read data */
export function dataTexture(data: Float32Array, w: number, h: number, linear = false) {
  const t = new THREE.DataTexture(data, w, h, THREE.RedFormat, THREE.FloatType);
  t.minFilter = t.magFilter = linear ? THREE.LinearFilter : THREE.NearestFilter;
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  t.needsUpdate = true;
  return t;
}

/**
 * The colour ramp for magnitudes (dB, log-mel, activations), after matplotlib's "inferno": perceptually even,
 * near-black through violet and ember to pale gold, so loud reads as bright, as in an audio editor.
 */
const RAMP_STOPS = [0, 0.22, 0.46, 0.68, 0.86, 1];
const RAMP_RGB = [
  [0.016, 0.016, 0.04],
  [0.2, 0.04, 0.36],
  [0.58, 0.15, 0.4],
  [0.9, 0.34, 0.16],
  [0.99, 0.66, 0.16],
  [0.99, 0.96, 0.7],
];
const v3 = (c: number[]) => `vec3(${c.map((v) => v.toFixed(3)).join(", ")})`;
export const RAMP_GLSL = /* glsl */ `
vec3 ramp(float x) {
  x = clamp(x, 0.0, 1.0);
  ${RAMP_STOPS.slice(1)
    .map((s, i) => `if (x < ${s.toFixed(2)}) return mix(${v3(RAMP_RGB[i])}, ${v3(RAMP_RGB[i + 1])}, (x - ${RAMP_STOPS[i].toFixed(2)}) / ${(s - RAMP_STOPS[i]).toFixed(2)});`)
    .join("\n  ")}
  return ${v3(RAMP_RGB[RAMP_RGB.length - 1])};
}`;

/** the ramp's display (sRGB) values, 0 … 1 */
export function rampRGB(x: number): [number, number, number] {
  x = Math.min(1, Math.max(0, x));
  let i = 0;
  while (i < RAMP_STOPS.length - 2 && x > RAMP_STOPS[i + 1]) i++;
  const f = (x - RAMP_STOPS[i]) / (RAMP_STOPS[i + 1] - RAMP_STOPS[i]);
  const a = RAMP_RGB[i];
  const b = RAMP_RGB[i + 1];
  return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f];
}

export function ramp(x: number, out = new THREE.Color()) {
  const [r, g, b] = rampRGB(x);
  return out.setRGB(r, g, b, THREE.SRGBColorSpace);
}

/** min / max of a signal over `cols` equal columns, for drawing it */
export function envelope(x: Float32Array, cols: number, from = 0, to = x.length) {
  const lo = new Float32Array(cols);
  const hi = new Float32Array(cols);
  const n = Math.max(1, to - from);
  for (let c = 0; c < cols; c++) {
    const a = from + Math.floor((c / cols) * n);
    const b = Math.max(a + 1, from + Math.floor(((c + 1) / cols) * n));
    let mn = 0;
    let mx = 0;
    for (let i = a; i < b && i < x.length; i++) {
      if (x[i] < mn) mn = x[i];
      if (x[i] > mx) mx = x[i];
    }
    lo[c] = mn;
    hi[c] = mx;
  }
  return { lo, hi };
}
