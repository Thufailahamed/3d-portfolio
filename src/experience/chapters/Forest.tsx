"use client";

import { useGLTF } from "@react-three/drei";
import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { chapter } from "@/lib/chapters";
import { rng } from "@/lib/random";
import { sceneState } from "@/lib/sceneState";
import { useApp } from "@/store/useApp";
import { palette } from "../palette";
import { dustFrag, dustVert, raysFrag, raysVert } from "../shaders/atmosphere";
import { bakedFrag, bakedVert, fireflyFrag, fireflyVert } from "../shaders/forest";

export const FOREST_URL = "/models/forest.glb";
/** must match BAKE_SCALE in art/export_intro.py (times a little display exposure) */
export const BAKE_EXPOSURE = 4 * 1.35;

/** Sunlight direction (light travels along this), same as the Blender scene. */
const SUN = new THREE.Vector3(-0.5, -1, -0.1).normalize();
const SHAFTS: { target: [number, number, number]; width: number; strength: number }[] = [
  { target: [0.2, 3.3, 0], width: 1.0, strength: 1 }, // the hero shaft on the arch
  { target: [1.4, 1.2, -1.2], width: 0.45, strength: 0.55 },
  { target: [2.8, 0.5, -3], width: 0.6, strength: 0.45 },
  { target: [-1.6, 0.6, 1.2], width: 0.35, strength: 0.35 },
  { target: [4.2, 1.5, 0.5], width: 0.5, strength: 0.4 },
];

/** A baked-lighting material (optionally with the lime rim the fracture uses). */
export function makeBakedMaterial(side: THREE.Side = THREE.FrontSide) {
  return new THREE.ShaderMaterial({
    vertexShader: bakedVert,
    fragmentShader: bakedFrag,
    vertexColors: true,
    fog: true,
    side,
    uniforms: THREE.UniformsUtils.merge([
      THREE.UniformsLib.fog,
      {
        uExposure: { value: BAKE_EXPOSURE },
        uAccent: { value: palette.accent.clone() },
        uRim: { value: 0 },
        uFill: { value: 0 },
      },
    ]),
  });
}

/** Chapter 1 — a ruined arch in a night forest; sun shafts, motes and fireflies. */
export default function Forest() {
  const { nodes } = useGLTF(FOREST_URL, "/draco/") as unknown as { nodes: Record<string, THREE.Object3D> };
  const isMobile = useApp((s) => s.isMobile);
  const dpr = useThree((s) => s.viewport.dpr);
  const group = useRef<THREE.Group>(null);

  const tu = chapter("tunnel");
  const hideAt = tu.start + (tu.end - tu.start) * 0.55;

  const mat = useMemo(() => makeBakedMaterial(THREE.DoubleSide), []);
  const scenery = useMemo(
    () =>
      ["Ground", "Ferns", "BroadLeaves", "Roots", "Rocks", "Trunks"]
        .map((n) => nodes[n] as THREE.Mesh | undefined)
        .filter((m): m is THREE.Mesh => !!m?.isMesh),
    [nodes],
  );

  // light shafts: open cones along the sun direction, narrow at the canopy
  const shaft = useMemo(() => {
    const geometry = new THREE.CylinderGeometry(0.22, 1, 18, 40, 1, true);
    const material = new THREE.ShaderMaterial({
      vertexShader: raysVert,
      fragmentShader: raysFrag,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: {
        uTime: { value: 0 },
        uIntensity: { value: 0 },
        uColor: { value: new THREE.Color("#ffd391") },
      },
    });
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), SUN.clone().negate());
    const placements = SHAFTS.map((s) => {
      // centre the cone so it passes through the target and runs on a few metres past it
      const pos = new THREE.Vector3(...s.target).addScaledVector(SUN, -(9 - 2.5));
      return { pos, scale: new THREE.Vector3(s.width, 1, s.width), strength: s.strength };
    });
    return { geometry, material, q, placements };
  }, []);

  // motes drifting through the beams
  const motes = useMemo(() => {
    const n = isMobile ? 500 : 1300;
    const random = rng(19);
    const pos = new Float32Array(n * 3);
    const rnd = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      pos[i * 3] = (random() - 0.5) * 12;
      pos[i * 3 + 1] = random() * 10;
      pos[i * 3 + 2] = (random() - 0.5) * 10;
      rnd[i] = random();
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    g.setAttribute("aRand", new THREE.BufferAttribute(rnd, 1));
    const m = new THREE.ShaderMaterial({
      vertexShader: dustVert,
      fragmentShader: dustFrag,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: {
        uTime: { value: 0 },
        uSize: { value: 20 },
        uPixelRatio: { value: dpr },
        uBeam: { value: new THREE.Vector3(1.2, 0, 0) },
        uColor: { value: new THREE.Color("#ffe2b0") },
      },
    });
    return { g, m };
  }, [isMobile, dpr]);

  const flies = useMemo(() => {
    const n = isMobile ? 24 : 42;
    const random = rng(41);
    const pos = new Float32Array(n * 3);
    const rnd = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      let x = (random() - 0.5) * 12;
      if (Math.abs(x) < 1.6) x += Math.sign(x || 1) * 2;
      pos[i * 3] = x;
      pos[i * 3 + 1] = 0.3 + random() * 2.6;
      pos[i * 3 + 2] = 2.5 - random() * 8.5;
      rnd[i] = random();
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    g.setAttribute("aRand", new THREE.BufferAttribute(rnd, 1));
    const m = new THREE.ShaderMaterial({
      vertexShader: fireflyVert,
      fragmentShader: fireflyFrag,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      toneMapped: false,
      uniforms: {
        uTime: { value: 0 },
        uSize: { value: 70 },
        uPixelRatio: { value: dpr },
        uIntensity: { value: 0 },
        uColor: { value: new THREE.Color("#4fa8ff") },
      },
    });
    return { g, m };
  }, [isMobile, dpr]);

  useEffect(
    () => () => {
      mat.dispose();
      shaft.geometry.dispose();
      shaft.material.dispose();
      motes.g.dispose();
      motes.m.dispose();
      flies.g.dispose();
      flies.m.dispose();
    },
    [mat, shaft, motes, flies],
  );

  useFrame((_, dt) => {
    const g = group.current;
    if (!g) return;
    g.visible = sceneState.p < hideAt;
    if (!g.visible) return;
    const intro = sceneState.intro;
    shaft.material.uniforms.uTime.value += dt;
    shaft.material.uniforms.uIntensity.value = 0.16 * (0.35 + 0.65 * intro);
    motes.m.uniforms.uTime.value += dt;
    flies.m.uniforms.uTime.value += dt;
    flies.m.uniforms.uIntensity.value = intro;
  });

  return (
    <group ref={group}>
      {scenery.map((m) => (
        <mesh key={m.name} geometry={m.geometry} material={mat} position={m.position} quaternion={m.quaternion} />
      ))}
      {shaft.placements.map((s, i) => (
        <mesh
          key={i}
          geometry={shaft.geometry}
          material={shaft.material}
          position={s.pos}
          quaternion={shaft.q}
          scale={s.scale}
          renderOrder={5}
        />
      ))}
      <points geometry={motes.g} material={motes.m} frustumCulled={false} />
      <points geometry={flies.g} material={flies.m} frustumCulled={false} renderOrder={6} />
    </group>
  );
}

useGLTF.preload(FOREST_URL, "/draco/");
