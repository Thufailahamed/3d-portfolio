import * as THREE from "three";

/**
 * Shared state of the realistic pavilion. The weather is eased once per frame (RealSky) and
 * every realistic material reads the same uniform objects, so a change reaches all of them.
 */
export const realState = {
  /** realistic style is on and the pavilion owns the canvas */
  active: false,
  /** eased weather mix (sums to ~1): bright day, clear night, storm */
  day: 0,
  night: 1,
  rain: 0,
  /** lightning, 0..~1.5 */
  flash: 0,
  /** where the sun / moon sit (normalised, world == pavilion-local orientation) */
  sunDir: new THREE.Vector3(0.52, 0.62, 0.59).normalize(),
  moonDir: new THREE.Vector3(0.55, 0.3, -0.78).normalize(),
  /** the sky's private bake scene and camera, so its program can be compiled with the rest */
  skyScene: null as THREE.Scene | null,
  skyCamera: null as THREE.Camera | null,
  /** the realistic world's root group (hidden until its programs are compiled) */
  root: null as THREE.Object3D | null,
};

/** Uniforms shared by reference with every realistic material. */
export const realUniforms = {
  uTime: { value: 0 },
  /** how wet the exterior is (lags the rain: surfaces soak in, then dry off) */
  uWet: { value: 0 },
  /** rain still falling (drives the ripples in puddles) */
  uRainFall: { value: 0 },
  uNight: { value: 1 },
  uFlash: { value: 0 },
};
