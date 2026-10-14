"use client";

import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo } from "react";
import * as THREE from "three";
import { getProject } from "@/content/site";
import { gsap } from "@/lib/gsap";
import { useApp } from "@/store/useApp";
import { tunnelVert } from "../shaders/signal";
import { backdropFrag } from "../shaders/projects";

/** Full-screen smoky iridescent field behind /projects/[slug], tinted per project. */
export default function DetailBackdrop() {
  const size = useThree((s) => s.size);
  const mat = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader: tunnelVert,
        fragmentShader: backdropFrag,
        transparent: true,
        depthTest: false,
        depthWrite: false,
        toneMapped: false,
        uniforms: {
          uTime: { value: 0 },
          uOpacity: { value: 0 },
          uTint: { value: new THREE.Color("#c8ff3d") },
          uRes: { value: new THREE.Vector2(1, 1) },
        },
      }),
    [],
  );

  useEffect(() => () => mat.dispose(), [mat]);
  useEffect(() => {
    mat.uniforms.uRes.value.set(size.width, size.height);
  }, [mat, size]);

  useEffect(() => {
    const apply = (mode: string, slug: string | null) => {
      const project = slug ? getProject(slug) : undefined;
      if (project) {
        const c = new THREE.Color(project.tint);
        gsap.to(mat.uniforms.uTint.value, { r: c.r, g: c.g, b: c.b, duration: 0.8 });
      }
      gsap.to(mat.uniforms.uOpacity, { value: mode === "detail" ? 1 : 0, duration: 0.9, ease: "power2.inOut" });
    };
    const s = useApp.getState();
    apply(s.mode, s.detailSlug);
    return useApp.subscribe((s, prev) => {
      if (s.mode !== prev.mode || s.detailSlug !== prev.detailSlug) apply(s.mode, s.detailSlug);
    });
  }, [mat]);

  useFrame((_, dt) => {
    if (mat.uniforms.uOpacity.value <= 0) return;
    mat.uniforms.uTime.value += dt;
  });

  return (
    <mesh material={mat} frustumCulled={false} renderOrder={20}>
      <planeGeometry args={[1, 1]} />
    </mesh>
  );
}
