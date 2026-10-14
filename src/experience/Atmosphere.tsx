"use client";

import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo } from "react";
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

const BEAM = new THREE.Vector3(0.4, 0, 0.2);

/** Night desert floor, god rays from above and drifting dust — shared by early chapters. */
export default function Atmosphere({ dustCount = 1800 }: { dustCount?: number }) {
  const dpr = useThree((s) => s.viewport.dpr);

  const ground = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader: groundVert,
        fragmentShader: groundFrag,
        uniforms: {
          uColor: { value: new THREE.Color("#2a2724") },
          uLight: { value: BEAM },
          uAccent: { value: palette.accent.clone() },
          uFog: { value: palette.fog.clone() },
          uFogDensity: { value: 0.045 },
          uTime: { value: 0 },
        },
      }),
    [],
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
          uIntensity: { value: 0.22 },
          uColor: { value: new THREE.Color("#dfe6d6") },
        },
      }),
    [],
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
  }, [dustCount, dpr]);

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

  useFrame((_, dt) => {
    ground.uniforms.uTime.value += dt;
    rays.uniforms.uTime.value += dt;
    dust.m.uniforms.uTime.value += dt;
  });

  return (
    <group>
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
