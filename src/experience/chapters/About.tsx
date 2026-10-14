"use client";

import { useFrame } from "@react-three/fiber";
import { useRef } from "react";
import * as THREE from "three";
import { ABOUT_ORIGIN, chapter } from "@/lib/chapters";
import { sceneState } from "@/lib/sceneState";
import { useApp } from "@/store/useApp";
import Cables from "./Cables";
import Globe from "./Globe";

/**
 * Chapter 5 — glowing strands sweep across the screen, gather into a stem and open
 * into a night-side globe. All scroll-scrubbed (see aboutTimeline).
 */
export default function About() {
  const group = useRef<THREE.Group>(null);
  const globe = useRef<THREE.Group>(null);
  const isMobile = useApp((s) => s.isMobile);
  const c = chapter("about");

  useFrame(() => {
    if (group.current) group.current.visible = sceneState.p >= c.start - 0.001 && sceneState.p <= c.end + 0.002;
  });

  return (
    <>
      <group ref={group} position={ABOUT_ORIGIN} visible={false}>
        <Globe spin={globe} />
      </group>
      {/* screen-locked, so it lives outside the scene-space group */}
      <Cables count={isMobile ? 24 : 36} globe={globe} />
    </>
  );
}
