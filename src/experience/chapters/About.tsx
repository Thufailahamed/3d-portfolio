"use client";

import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { ABOUT_ORIGIN, local } from "@/lib/chapters";
import { rng } from "@/lib/random";
import { sceneState } from "@/lib/sceneState";
import { globeG, showGlobe } from "../ascent";
import { damp, ease, toSec } from "../aboutTimeline";
import { galaxyFrag, galaxyVert, starFrag, starVert } from "../shaders/stars";
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

  // the starfield behind the globe: mostly faint, a few bright, in real star colours
  const stars = useMemo(() => {
    const random = rng(53);
    const r = (a: number, b: number) => a + random() * (b - a);
    const n = 5200;
    const pos = new Float32Array(n * 3);
    const seed = new Float32Array(n);
    const mag = new Float32Array(n);
    const tint = new Float32Array(n * 3);
    // blue-white O/B through white, yellow to orange K/M
    const tints = [
      [0.7, 0.8, 1.0],
      [0.85, 0.9, 1.0],
      [1.0, 1.0, 1.0],
      [1.0, 0.95, 0.85],
      [1.0, 0.85, 0.65],
      [1.0, 0.72, 0.5],
    ];
    for (let i = 0; i < n; i++) {
      pos.set([r(-60, 60), r(-24, 40), r(-55, -8)], i * 3);
      seed[i] = random();
      mag[i] = Math.pow(random(), 7); // a steep magnitude distribution
      tint.set(tints[Math.min(tints.length - 1, Math.floor(Math.pow(random(), 0.8) * tints.length))], i * 3);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    g.setAttribute("aSeed", new THREE.BufferAttribute(seed, 1));
    g.setAttribute("aMag", new THREE.BufferAttribute(mag, 1));
    g.setAttribute("aTint", new THREE.BufferAttribute(tint, 3));
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
        uSize: { value: 2.2 },
        uColor: { value: new THREE.Color("#ffffff") },
        uOpacity: { value: 0 },
      },
    });
    const pts = new THREE.Points(g, m);
    pts.frustumCulled = false;
    return pts;
  }, [dpr]);
  const galaxy = useMemo(() => {
    const m = new THREE.ShaderMaterial({
      vertexShader: galaxyVert,
      fragmentShader: galaxyFrag,
      transparent: true,
      depthWrite: false,
      toneMapped: false,
      blending: THREE.AdditiveBlending,
      uniforms: { uOpacity: { value: 0 } },
    });
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(150, 84), m);
    mesh.position.set(0, 8, -58);
    mesh.rotation.z = -0.42;
    mesh.frustumCulled = false;
    return mesh;
  }, []);
  useEffect(
    () => () => {
      stars.geometry.dispose();
      stars.material.dispose();
      galaxy.geometry.dispose();
      galaxy.material.dispose();
    },
    [stars, galaxy],
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
    const out = ease((globeG(sceneState.ascent.u) - 0.2) / 0.5);
    u.uOpacity.value = 0.75 * out;
    galaxy.material.uniforms.uOpacity.value = out;
    stars.rotation.y = clock.elapsedTime * 0.004;
  });

  return (
    <group ref={group} position={ABOUT_ORIGIN} visible={false}>
      <primitive object={galaxy} />
      <primitive object={stars} />
      <Globe spin={globe} />
    </group>
  );
}
