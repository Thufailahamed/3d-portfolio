"use client";

import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo } from "react";
import * as THREE from "three";
import { local } from "@/lib/chapters";
import { sceneState } from "@/lib/sceneState";
import { palette } from "../palette";
import { fadeFrag, fadeVert } from "../shaders/about";

const s = THREE.MathUtils.smoothstep;

/** The dip to black that hides the camera's cut from about to contact (projects → about zooms out, see ascent.ts). */
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
    mat.uniforms.uOpacity.value = s(local(p, "about"), 0.94, 0.99) * (1 - s(local(p, "contact"), 0.015, 0.14));
  });

  return (
    <mesh material={mat} frustumCulled={false} renderOrder={15}>
      <planeGeometry args={[1, 1]} />
    </mesh>
  );
}
