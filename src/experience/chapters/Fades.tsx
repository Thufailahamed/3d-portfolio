"use client";

import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo } from "react";
import * as THREE from "three";
import { local } from "@/lib/chapters";
import { sceneState } from "@/lib/sceneState";
import { palette } from "../palette";
import { fadeFrag, fadeVert } from "../shaders/about";

const s = THREE.MathUtils.smoothstep;

/** Dips to black that hide the camera's cuts: projects → about → contact. */
export default function Fades() {
  const mat = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader: fadeVert,
        fragmentShader: fadeFrag,
        transparent: true,
        depthTest: false,
        depthWrite: false,
        toneMapped: false,
        uniforms: { uOpacity: { value: 0 }, uColor: { value: palette.bg.clone() } },
      }),
    [],
  );
  useEffect(() => () => mat.dispose(), [mat]);

  useFrame(() => {
    const p = sceneState.p;
    const a = s(local(p, "projects"), 0.9, 0.985) * (1 - s(local(p, "about"), 0.015, 0.09));
    const b = s(local(p, "about"), 0.94, 0.99) * (1 - s(local(p, "contact"), 0.015, 0.14));
    mat.uniforms.uOpacity.value = Math.max(a, b);
  });

  return (
    <mesh material={mat} frustumCulled={false} renderOrder={15}>
      <planeGeometry args={[1, 1]} />
    </mesh>
  );
}
