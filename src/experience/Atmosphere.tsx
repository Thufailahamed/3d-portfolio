"use client";

import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import { sceneState } from "@/lib/sceneState";
import * as THREE from "three";
import { rng } from "@/lib/random";
import { palette } from "./palette";
import {
  dustFrag,
  dustVert,
  groundFrag,
  groundVert,
  raysFrag,
  raysVert,
} from "./shaders/atmosphere";

type Props = {
  dustCount?: number;
  /** where the scene sits in the world */
  origin?: [number, number, number];
  /** god-ray position relative to origin (y ignored) */
  beam?: [number, number, number];
  /** visible while from <= p < to */
  range: [number, number];
  rayIntensity?: number;
};

/** Night desert floor, god rays from above and drifting dust (monolith + contact scenes). */
export default function Atmosphere({
  dustCount = 1800,
  origin = [0, 0, 0],
  beam = [0.4, 0, 0.2],
  range,
  rayIntensity = 0.22,
}: Props) {
  const dpr = useThree((s) => s.viewport.dpr);
  const [ox, oy, oz] = origin;
  const [bx, , bz] = beam;
  const BEAM = useMemo(() => new THREE.Vector3(bx, 0, bz), [bx, bz]);
  const lightWorld = useMemo(() => new THREE.Vector3(ox + bx, oy, oz + bz), [ox, oy, oz, bx, bz]);

  const ground = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader: groundVert,
        fragmentShader: groundFrag,
        uniforms: {
          uColor: { value: new THREE.Color("#2a2724") },
          uLight: { value: lightWorld },
          uAccent: { value: palette.accent.clone() },
          uFog: { value: palette.fog.clone() },
          uFogDensity: { value: 0.045 },
          uTime: { value: 0 },
        },
      }),
    [lightWorld],
  );

  const rays = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader: raysVert,
        fragmentShader: raysFrag,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        uniforms: {
          uTime: { value: 0 },
          uIntensity: { value: rayIntensity },
          uColor: { value: new THREE.Color("#dfe6d6") },
        },
      }),
    [rayIntensity],
  );

  const dust = useMemo(() => {
    const g = new THREE.BufferGeometry();
    const pos = new Float32Array(dustCount * 3);
    const rnd = new Float32Array(dustCount);
    const random = rng(11);
    for (let i = 0; i < dustCount; i++) {
      pos[i * 3] = (random() - 0.5) * 14;
      pos[i * 3 + 1] = random() * 10;
      pos[i * 3 + 2] = (random() - 0.5) * 12;
      rnd[i] = random();
    }
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
        uSize: { value: 26 },
        uPixelRatio: { value: dpr },
        uBeam: { value: BEAM },
        uColor: { value: new THREE.Color("#f2f5ea") },
      },
    });
    return { g, m };
  }, [dustCount, dpr, BEAM]);

  const cone = useMemo(() => new THREE.CylinderGeometry(0.35, 3.4, 18, 64, 1, true), []);

  useEffect(
    () => () => {
      ground.dispose();
      rays.dispose();
      dust.g.dispose();
      dust.m.dispose();
      cone.dispose();
    },
    [ground, rays, dust, cone],
  );

  const group = useRef<THREE.Group>(null);
  const [from, to] = range;

  useFrame((_, dt) => {
    const on = sceneState.p >= from && sceneState.p < to;
    if (group.current) group.current.visible = on;
    if (!on) return;
    ground.uniforms.uTime.value += dt;
    rays.uniforms.uTime.value += dt;
    dust.m.uniforms.uTime.value += dt;
  });

  return (
    <group ref={group} position={origin} visible={false}>
      <mesh material={ground} rotation-x={-Math.PI / 2} renderOrder={-1}>
        <planeGeometry args={[160, 160]} />
      </mesh>
      {/* two offset cones read as volumetric shafts */}
      <mesh geometry={cone} material={rays} position={[BEAM.x, 8.6, BEAM.z]} rotation-z={0.06} />
      <mesh
        geometry={cone}
        material={rays}
        position={[BEAM.x - 0.6, 9, BEAM.z - 0.4]}
        rotation={[0.08, 0, -0.1]}
        scale={[0.55, 1, 0.55]}
      />
      <points geometry={dust.g} material={dust.m} frustumCulled={false} />
    </group>
  );
}
