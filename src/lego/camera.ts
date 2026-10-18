import * as THREE from "three";
import type { Stop } from "./layout";

/**
 * The cameras. Each one is a different way of shooting the same diorama, the way a toy
 * photographer would: the guided tour, a free orbit, flat on the baseplate with a wide macro lens,
 * from high up on a long lens with a sliver of focus (the tilt-shift miniature look), riding along
 * behind a car, and a slow cinematic crane that walks the line on its own.
 */
export type CamMode = "tour" | "orbit" | "street" | "aerial" | "chase" | "cinema";

export type CamSpec = {
  id: CamMode;
  label: string;
  /** what's on the lens, for the viewfinder readout */
  lens: string;
  blurb: string;
  /** vertical field of view, degrees */
  fov: number;
  /** depth of field: how deep the sharp zone is (world units) and how big the blur gets */
  focusRange: number;
  bokeh: number;
  /** half the width of the sun's shadow box */
  shadow: number;
  vignette: number;
};

export const CAMS: CamSpec[] = [
  { id: "tour", label: "Tour", lens: "50 mm · f/5.6", blurb: "The guided walk, stop by stop", fov: 30, focusRange: 60, bokeh: 2.2, shadow: 54, vignette: 0.42 },
  { id: "orbit", label: "Orbit", lens: "35 mm · f/5.6", blurb: "Drag to circle, scroll to zoom", fov: 32, focusRange: 60, bokeh: 2.2, shadow: 64, vignette: 0.42 },
  { id: "street", label: "Street level", lens: "18 mm macro · f/1.4", blurb: "Down on the baseplate, minifig height", fov: 50, focusRange: 10, bokeh: 5.5, shadow: 54, vignette: 0.52 },
  { id: "aerial", label: "Tilt-shift", lens: "135 mm tilt · f/2", blurb: "From high up, a sliver of focus", fov: 15, focusRange: 18, bokeh: 4.2, shadow: 96, vignette: 0.36 },
  { id: "chase", label: "Chase cam", lens: "24 mm · f/2.8", blurb: "Ride along with the traffic", fov: 44, focusRange: 24, bokeh: 3.2, shadow: 54, vignette: 0.48 },
  { id: "cinema", label: "Cinematic", lens: "40 mm anamorphic · 2.39:1", blurb: "A slow crane that walks the line", fov: 24, focusRange: 34, bokeh: 3, shadow: 60, vignette: 0.62 },
];
export const CAM = Object.fromEntries(CAMS.map((c) => [c.id, c])) as Record<CamMode, CamSpec>;
export const nextCam = (m: CamMode, d = 1) => CAMS[(CAMS.findIndex((c) => c.id === m) + d + CAMS.length) % CAMS.length].id;

/** keep the street camera behind the far lane, so the traffic passes in front of it rather than through it */
const KERB_Z = 26.5;
const STREET_EYE = 2.3;

const smooth = (t: number) => t * t * (3 - 2 * t);
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

export type Pose = { target: THREE.Vector3; yaw: number; pitch: number; frame: [number, number]; shift: [number, number]; lift: number };

/** The camera pose part-way between two stops (p is fractional). */
export function poseAt(stops: Stop[], p: number, portrait: boolean): Pose {
  const i = Math.max(0, Math.min(stops.length - 1, Math.floor(p)));
  const j = Math.min(stops.length - 1, i + 1);
  const f = smooth(Math.max(0, Math.min(1, p - i)));
  const A = stops[i];
  const B = stops[j];
  // portrait: the panel takes the bottom of the screen, so the subject sits high
  const shift = (s: Stop): [number, number] => (portrait ? [0, -0.17] : s.shift);
  const sa = shift(A);
  const sb = shift(B);
  return {
    target: new THREE.Vector3(lerp(A.target[0], B.target[0], f), lerp(A.target[1], B.target[1], f), lerp(A.target[2], B.target[2], f)),
    yaw: lerp(A.yaw, B.yaw, f),
    pitch: lerp(A.pitch, B.pitch, f),
    frame: [lerp(A.frame[0], B.frame[0], f), lerp(A.frame[1], B.frame[1], f)],
    shift: [lerp(sa[0], sb[0], f), lerp(sa[1], sb[1], f)],
    // long hops rise a little, like a camera on a crane
    lift: Math.sin(Math.PI * f) * Math.min(14, Math.abs(B.target[0] - A.target[0]) * 0.07),
  };
}

export type ShotInput = {
  mode: CamMode;
  pose: Pose;
  aspect: number;
  portrait: boolean;
  /** the lens's vertical field of view right now (degrees) */
  fov: number;
  t: number;
  /** the opening swoop (1 … 0) */
  swoop: number;
  pointer: { x: number; y: number };
  /** drag offsets: eased back to zero (yaw/pitchOff) or kept (orbit) */
  yawOff: number;
  pitchOff: number;
  orbitYaw: number;
  orbitPitch: number;
  zoom: number;
  /** the car being chased: where it is and which way it's heading (±1) */
  car: { x: number; y: number; z: number; dir: number } | null;
};

export type Shot = { pos: THREE.Vector3; look: THREE.Vector3; focus: THREE.Vector3; roll: number };

const dir = new THREE.Vector3();
const right = new THREE.Vector3();
const up = new THREE.Vector3();
const ahead = new THREE.Vector3();

/** Point a camera at `target` from (yaw, pitch, dist), panned by `shift` (fractions of the frame). */
function aim(out: Shot, target: THREE.Vector3, yaw: number, pitch: number, dist: number, shift: [number, number], aspect: number, half: number) {
  dir.set(Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch));
  right.set(Math.cos(yaw), 0, -Math.sin(yaw));
  up.crossVectors(dir, right);
  // pan (not rotate) to make room for the text panel, by a fraction of what's actually on screen
  const visH = 2 * dist * Math.tan(half);
  out.look
    .copy(target)
    .addScaledVector(right, shift[0] * visH * aspect)
    .addScaledVector(up, shift[1] * visH);
  out.pos.copy(out.look).addScaledVector(dir, dist);
}

/** Where the camera wants to be this frame, for the mode it's in. */
export function frameShot(s: ShotInput, out: Shot) {
  const { pose, aspect, portrait, t, swoop, pointer } = s;
  const half = THREE.MathUtils.degToRad(s.fov / 2);
  const [fw, fh] = pose.frame;
  // the distance that fits the stop's frame in view
  const fit = Math.max(fh / 2 / Math.tan(half), (fw * (portrait ? 0.86 : 1)) / 2 / (Math.tan(half) * aspect));
  out.roll = 0;
  out.focus.copy(pose.target);
  const mode = s.mode === "chase" && !s.car ? "tour" : s.mode;

  switch (mode) {
    case "orbit": {
      const yaw = pose.yaw + s.orbitYaw + pointer.x * 0.02;
      const pitch = clamp(pose.pitch + s.orbitPitch + pointer.y * 0.01, 0.03, 1.38);
      aim(out, pose.target, yaw, pitch, fit * s.zoom, [pose.shift[0] * 0.5, pose.shift[1] * 0.5], aspect, half);
      out.pos.y = Math.max(out.pos.y, 0.9);
      break;
    }
    case "street": {
      // flat on the baseplate, looking up at the build with a wide lens, the way a minifig would see it
      const yaw = pose.yaw * 0.6 + s.yawOff + pointer.x * 0.04 + Math.sin(t * 0.09) * 0.05;
      const hd = fit * 0.6;
      out.look.set(pose.target.x, pose.target.y * 0.72 + 0.8, pose.target.z);
      out.pos.set(out.look.x + Math.sin(yaw) * hd, STREET_EYE + Math.max(0, s.pitchOff) * 10 + pointer.y * 0.35, out.look.z + Math.cos(yaw) * hd);
      // back off until it's clear of the traffic
      if (out.pos.z < KERB_Z) {
        const k = (KERB_Z - out.look.z) / Math.max(0.1, out.pos.z - out.look.z);
        out.pos.x = out.look.x + (out.pos.x - out.look.x) * k;
        out.pos.z = KERB_Z;
      }
      // pan for the panel
      const d = Math.hypot(out.pos.x - out.look.x, out.pos.z - out.look.z);
      const visW = 2 * d * Math.tan(half) * aspect;
      right.set(Math.cos(yaw), 0, -Math.sin(yaw)).multiplyScalar((portrait ? 0 : pose.shift[0]) * visW * 0.8);
      out.pos.add(right);
      out.look.add(right);
      out.roll = Math.sin(t * 0.21) * 0.006;
      break;
    }
    case "aerial": {
      const yaw = pose.yaw + 0.42 + s.yawOff + pointer.x * 0.015 + Math.sin(t * 0.05) * 0.04;
      const pitch = clamp(0.92 + s.pitchOff * 0.6 + pointer.y * 0.01, 0.55, 1.35);
      aim(out, pose.target, yaw, pitch, fit * 1.75, [pose.shift[0] * 0.6, pose.shift[1] * 0.6], aspect, half);
      break;
    }
    case "chase": {
      const c = s.car!;
      // behind the car and a little out towards the viewer, looking down the road ahead of it
      const yaw = -c.dir * (Math.PI / 2 - 0.4) + s.yawOff * 1.6 + pointer.x * 0.05 + Math.sin(t * 0.31) * 0.03;
      const pitch = clamp(0.19 + s.pitchOff + pointer.y * 0.03, 0.04, 0.9);
      out.focus.set(c.x, c.y + 0.6, c.z);
      aim(out, ahead.set(c.x + c.dir * 7, c.y + 2, c.z - 1.6), yaw, pitch, 16, [0, 0], aspect, half);
      out.pos.y = Math.max(out.pos.y, 1.2);
      // the ride: a little float and lean
      out.pos.y += Math.sin(t * 1.7) * 0.06;
      out.roll = Math.sin(t * 0.9) * 0.008;
      break;
    }
    case "cinema": {
      // a slow crane: drifting round, rising and falling, pushing in and pulling out
      const yaw = pose.yaw + Math.sin(t * 0.13) * 0.62 + s.yawOff;
      const pitch = clamp(pose.pitch * 0.75 + 0.03 + (Math.sin(t * 0.083) * 0.5 + 0.5) * 0.24 + s.pitchOff, 0.03, 1.2);
      aim(out, pose.target, yaw, pitch, fit * (0.95 + 0.18 * Math.sin(t * 0.07 + 1)), [pose.shift[0] * 0.55, pose.shift[1] * 0.4], aspect, half);
      out.pos.y += pose.lift;
      out.roll = Math.sin(t * 0.11) * 0.012;
      break;
    }
    default: {
      // the tour; the opening starts high and wide, swings round and settles on the name as it builds
      const yaw = pose.yaw + s.yawOff + pointer.x * 0.025 - swoop * 0.55;
      const pitch = pose.pitch + s.pitchOff + pointer.y * 0.012 + swoop * 0.45;
      aim(out, pose.target, yaw, pitch, fit * (1 + swoop * 1.1), pose.shift, aspect, half);
      out.pos.y += pose.lift;
    }
  }
  return out;
}
