"use client";

import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo } from "react";
import * as THREE from "three";
import { chapter, local } from "@/lib/chapters";
import { sceneState } from "@/lib/sceneState";
import { palette } from "../palette";
import { tunnelFrag, tunnelVert } from "../shaders/signal";

/**
 * Chapter 3 — once the camera reaches the signal membrane, a full-screen
 * version of the same shader takes over and we "fall" down the tunnel.
 */
export default function Tunnel() {
  const size = useThree((s) => s.size);

  const mat = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader: tunnelVert,
        fragmentShader: tunnelFrag,
        transparent: true,
        depthTest: false,
        depthWrite: false,
        toneMapped: false,
        uniforms: {
          uTime: { value: 0 },
          uOpacity: { value: 0 },
          uTravel: { value: 0 },
          uRes: { value: new THREE.Vector2(1, 1) },
          uAccent: { value: palette.accent.clone() },
        },
      }),
    [],
  );

  useEffect(() => () => mat.dispose(), [mat]);
  useEffect(() => {
    mat.uniforms.uRes.value.set(size.width, size.height);
  }, [mat, size]);

  const tunnel = chapter("tunnel");

  useFrame((_, dt) => {
    const p = sceneState.p;
    const t = local(p, "tunnel");
    // fade in as we pierce the membrane; fade out into the next chapter
    const fadeIn = THREE.MathUtils.smoothstep(t, 0.28, 0.5);
    // stays fully opaque through the camera's jump to the projects scene, then clears
    const fadeOut = 1 - THREE.MathUtils.smoothstep(p, tunnel.end + 0.001, tunnel.end + 0.03);
    const o = p < tunnel.start ? 0 : fadeIn * fadeOut;
    mat.uniforms.uOpacity.value = o;
    if (o <= 0) return;
    mat.uniforms.uTime.value += dt;
    mat.uniforms.uTravel.value = t;
  });

  return (
    <mesh material={mat} frustumCulled={false} renderOrder={10}>
      <planeGeometry args={[1, 1]} />
    </mesh>
  );
}
