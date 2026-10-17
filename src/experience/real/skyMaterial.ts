import * as THREE from "three";
import { realState } from "./realState";
import { skyFrag, skyVert } from "./sky";

/**
 * The material the sky is baked with (into the cube). Built in one place so the background
 * warm-up compiles exactly the program the realistic world will use.
 */
export function createSkyBakeMaterial() {
  return new THREE.ShaderMaterial({
    vertexShader: skyVert,
    fragmentShader: skyFrag,
    // double-sided: some cube faces render mirrored, which flips the sphere's winding
    side: THREE.DoubleSide,
    depthWrite: false,
    depthTest: false,
    fog: false,
    uniforms: {
      uSun: { value: realState.sunDir },
      uMoon: { value: realState.moonDir },
      uDay: { value: 0 },
      uNight: { value: 1 },
      uRain: { value: 0 },
      uTime: { value: 0 },
      uFog: { value: new THREE.Color() },
      uLoop: { value: 1 },
    },
  });
}

/** Stand-in for a PMREM of the given cube size: same mapping and dimensions, no pixels. */
export function placeholderEnv(cubeSize: number) {
  const size = Math.pow(2, Math.floor(Math.log2(cubeSize)));
  const t = new THREE.Texture();
  t.mapping = THREE.CubeUVReflectionMapping;
  t.image = { width: 3 * Math.max(size, 16 * 7), height: 4 * size };
  return t;
}
