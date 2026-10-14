"use client";

import { useGLTF } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { chapter } from "@/lib/chapters";
import { sceneState } from "@/lib/sceneState";
import { palette } from "../palette";
import { glyphFrag, glyphVert } from "../shaders/atmosphere";

export const MONOLITH_URL = "/models/monolith.glb";

type GLTFNodes = Record<string, THREE.Mesh>;

/** Chapter 1 — the intact monolith with its pulsing glyph. */
export default function Monolith() {
  const { nodes } = useGLTF(MONOLITH_URL, "/draco/") as unknown as { nodes: GLTFNodes };
  const group = useRef<THREE.Group>(null);

  const obsidian = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        color: "#0b0b0d",
        roughness: 0.2,
        metalness: 0.85,
        envMapIntensity: 1.2,
      }),
    [],
  );

  const glyph = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader: glyphVert,
        fragmentShader: glyphFrag,
        toneMapped: false,
        uniforms: {
          uColor: { value: palette.accent.clone() },
          uTime: { value: 0 },
          uPower: { value: 1 },
        },
      }),
    [],
  );

  useEffect(
    () => () => {
      obsidian.dispose();
      glyph.dispose();
    },
    [obsidian, glyph],
  );

  const fractureStart = chapter("fracture").start;

  useFrame((_, dt) => {
    const g = group.current;
    if (!g) return;
    // the intact slab is swapped for its shards the moment the fracture begins
    g.visible = sceneState.p <= fractureStart;
    if (!g.visible) return;
    glyph.uniforms.uTime.value += dt;
    glyph.uniforms.uPower.value = sceneState.intro;
    // the slab turns very slightly toward the pointer
    const target = sceneState.mouse.x * 0.12;
    g.rotation.y += (target - g.rotation.y) * Math.min(1, dt * 2);
  });

  return (
    <group ref={group}>
      <mesh geometry={nodes.Monolith.geometry} material={obsidian} />
      <mesh geometry={nodes.Glyph.geometry} material={glyph} />
    </group>
  );
}

useGLTF.preload(MONOLITH_URL, "/draco/");
