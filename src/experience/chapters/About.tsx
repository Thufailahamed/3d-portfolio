"use client";

import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { ABOUT_ORIGIN, local } from "@/lib/chapters";
import { rng } from "@/lib/random";
import { sceneState } from "@/lib/sceneState";
import { globeG, showGlobe } from "../ascent";
import { damp, ease, toSec } from "../aboutTimeline";
import { starFrag, starVert } from "../shaders/stars";
import Globe from "./Globe";

/**
 * Chapter 5 — the night-side globe. The camera arrives from the projects valley: it climbs
 * out through the clouds and keeps pulling back until the planet it stood on hangs in space
 * (see ascent.ts).
 */
export default function About() {
  const group = useRef<THREE.Group>(null);
  const globe = useRef<THREE.Group>(null);
  const dpr = useThree((s) => s.viewport.dpr);

  // a faint starfield behind the globe
  const stars = useMemo(() => {
    const random = rng(53);
    const r = (a: number, b: number) => a + random() * (b - a);
    const n = 1600;
    const pos = new Float32Array(n * 3);
    const seed = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      pos.set([r(-45, 45), r(-18, 32), r(-50, -6)], i * 3);
      seed[i] = random();
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    g.setAttribute("aSeed", new THREE.BufferAttribute(seed, 1));
    const m = new THREE.ShaderMaterial({
      vertexShader: starVert,
      fragmentShader: starFrag,
      transparent: true,
      depthWrite: false,
      toneMapped: false,
      blending: THREE.AdditiveBlending,
      uniforms: {
        uTime: { value: 0 },
        uPixelRatio: { value: dpr },
        uSize: { value: 1.4 },
        uColor: { value: new THREE.Color("#ffffff") },
        uOpacity: { value: 0 },
      },
    });
    const pts = new THREE.Points(g, m);
    pts.frustumCulled = false;
    return pts;
  }, [dpr]);
  useEffect(
    () => () => {
      stars.geometry.dispose();
      stars.material.dispose();
    },
    [stars],
  );

  useFrame(({ clock }, dt) => {
    const p = sceneState.p;
    // the captions' clock trails the scroll slightly, so wheel steps glide instead of jump
    const target = toSec(local(p, "about"));
    sceneState.aboutSec =
      Math.abs(target - sceneState.aboutSec) > 3 ? target : damp(sceneState.aboutSec, target, 4.5, Math.min(dt, 0.1));
    // from the moment the valley hands over to it, inside the clouds
    if (group.current) group.current.visible = sceneState.unfold.t > 0 || showGlobe(p);
    const u = stars.material.uniforms;
    u.uTime.value = clock.elapsedTime;
    // the stars come out once the planet no longer fills the view
    u.uOpacity.value = 0.3 * ease((globeG(sceneState.ascent.u) - 0.2) / 0.5);
    stars.rotation.y = clock.elapsedTime * 0.004;
  });

  return (
    <group ref={group} position={ABOUT_ORIGIN} visible={false}>
      <primitive object={stars} />
      <Globe spin={globe} />
    </group>
  );
}
