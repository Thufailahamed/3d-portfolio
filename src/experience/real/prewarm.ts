import * as THREE from "three";
import { getRealLib } from "./materials";
import { createSkyBakeMaterial } from "./skyMaterial";

/** Cube face size the sky is baked at, and the PMREM sizes made from it and from the hall. */
export const SKY_CUBE = { desktop: 768, mobile: 512 };
export const HALL_ENV_SIZE = 128;

type PMREMInternals = {
  _setSize: (size: number) => void;
  _allocateTargets: () => THREE.WebGLRenderTarget;
  _ggxMaterial: THREE.Material;
  _blurMaterial: THREE.Material;
  compileCubemapShader: () => void;
};

let started = false;
// kept alive on purpose: a program is released once no material uses it any more
const keep: THREE.Object3D[] = [];

/**
 * Get the realistic pavilion ready in the background while the blueprint is on screen: start
 * the texture download and hand the slowest programs (the sky bake, and the reflection filters
 * at the sizes they will be used) to the parallel compiler. The visible frames carry on; when
 * the visitor switches to realistic these are already compiled.
 */
export function prewarmReal(gl: THREE.WebGLRenderer, isMobile: boolean) {
  if (started) return;
  started = true;
  getRealLib(gl);

  const scene = new THREE.Scene();
  const cam = new THREE.PerspectiveCamera();
  const sky = new THREE.Mesh(new THREE.SphereGeometry(50, 8, 4), createSkyBakeMaterial());
  sky.frustumCulled = false;
  scene.add(sky);
  const cube = isMobile ? SKY_CUBE.mobile : SKY_CUBE.desktop;
  for (const size of [cube, HALL_ENV_SIZE]) {
    const pmrem = new THREE.PMREMGenerator(gl) as unknown as PMREMInternals;
    pmrem._setSize(size);
    pmrem._allocateTargets().dispose();
    pmrem.compileCubemapShader();
    for (const m of [pmrem._ggxMaterial, pmrem._blurMaterial]) {
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(), m);
      mesh.frustumCulled = false;
      scene.add(mesh);
    }
  }
  keep.push(scene);

  // compiled for an offscreen target, as they are drawn
  const target = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType });
  const prev = gl.getRenderTarget();
  gl.setRenderTarget(target);
  gl.compileAsync(scene, cam).catch(() => undefined);
  gl.setRenderTarget(prev);
  target.dispose();
}
