"use client";

import { useGLTF } from "@react-three/drei";
import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { chapter, CONTACT_ORIGIN, local } from "@/lib/chapters";
import { gsap } from "@/lib/gsap";
import { rng } from "@/lib/random";
import { sceneState } from "@/lib/sceneState";
import { useApp } from "@/store/useApp";
import { dustFrag, dustVert, raysFrag, raysVert } from "../shaders/atmosphere";
import { fireflyFrag, fireflyVert } from "../shaders/forest";
import { glowFrag, glowVert, veilFrag } from "../shaders/finale";
import { Butterflies, makeBakedMaterial, RUNE_BLUE } from "./Forest";

export const FINALE_URL = "/models/finale.glb";

/** Moonlight: the intro's sun direction, through the same gap in the canopy. */
const MOON = new THREE.Vector3(-0.5, -1, -0.1).normalize();
const SCENERY = ["Ground", "Dais", "Rocks", "Trunks", "Ferns", "Arch"];
/** Height of the arch's crown (the light climbs to here) and half the doorway's width. */
const TOP = 3.9;
const DOOR = 0.98;

/**
 * Chapter 6 — the intro's clearing, years later. The same arch and trees, recut and lit
 * from within: blue light in the joints, a fine line around the doorway, a polished dais.
 * Lighting is baked in Blender (art/build_finale.py → export_finale.py); the light itself
 * is drawn live so it can switch on as you arrive and answer when the email is copied.
 */
export default function Contact() {
  const isMobile = useApp((s) => s.isMobile);
  const dpr = useThree((s) => s.viewport.dpr);
  const c = chapter("contact");
  const group = useRef<THREE.Group>(null);
  const { nodes } = useGLTF(FINALE_URL, "/draco/") as unknown as { nodes: Record<string, THREE.Mesh> };

  const baked = useMemo(() => {
    const m = makeBakedMaterial(THREE.DoubleSide);
    m.uniforms.uExposure.value *= 1.35; // moonlight bakes darker than the intro's sun
    return m;
  }, []);
  const scenery = useMemo(() => SCENERY.map((n) => nodes[n]).filter((m): m is THREE.Mesh => !!m?.isMesh), [nodes]);

  const light = useMemo(() => {
    const on = { value: 0 };
    const flare = { value: 0 };
    const time = { value: 0 };
    const make = (frag: string, color: THREE.Color, intensity: number, extra: Record<string, THREE.IUniform> = {}) =>
      new THREE.ShaderMaterial({
        vertexShader: glowVert,
        fragmentShader: frag,
        toneMapped: false,
        uniforms: {
          uColor: { value: color },
          uIntensity: { value: intensity },
          uOn: on,
          uFlare: flare,
          uTime: time,
          uTop: { value: TOP },
          ...extra,
        },
      });
    return {
      on,
      flare,
      time,
      seams: make(glowFrag, RUNE_BLUE.clone(), 1.6),
      lines: make(glowFrag, new THREE.Color("#8cc4ff"), 2.4),
      veil: Object.assign(make(veilFrag, RUNE_BLUE.clone(), 1, { uHalf: { value: DOOR } }), {
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
      }),
    };
  }, []);

  // one cool shaft through the canopy, landing on the crown
  const shaft = useMemo(() => {
    const geometry = new THREE.CylinderGeometry(0.22, 1, 18, 40, 1, true);
    const material = new THREE.ShaderMaterial({
      vertexShader: raysVert,
      fragmentShader: raysFrag,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: { uTime: { value: 0 }, uIntensity: { value: 0.16 }, uColor: { value: new THREE.Color("#b8cdff") } },
    });
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), MOON.clone().negate());
    const pos = new THREE.Vector3(0.2, 3.2, 0).addScaledVector(MOON, -6.5);
    return { geometry, material, q, pos };
  }, []);

  // fine dust in the moonlight, and a few blue motes drifting low where the fireflies were
  const dust = useMemo(() => {
    const n = isMobile ? 350 : 900;
    const random = rng(2077);
    const pos = new Float32Array(n * 3);
    const rnd = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      pos[i * 3] = (random() - 0.5) * 11;
      pos[i * 3 + 1] = random() * 7;
      pos[i * 3 + 2] = (random() - 0.5) * 9;
      rnd[i] = random();
    }
    const g = new THREE.BufferGeometry();
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
        uSize: { value: 16 },
        uPixelRatio: { value: dpr },
        uBeam: { value: new THREE.Vector3() },
        uColor: { value: new THREE.Color("#c8d8ff") },
      },
    });
    return { g, m };
  }, [isMobile, dpr]);

  const motes = useMemo(() => {
    const n = isMobile ? 16 : 30;
    const random = rng(31);
    const pos = new Float32Array(n * 3);
    const rnd = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      let x = (random() - 0.5) * 10;
      if (Math.abs(x) < 1.6) x += Math.sign(x || 1) * 1.8;
      pos[i * 3] = x;
      pos[i * 3 + 1] = 0.3 + Math.pow(random(), 1.4) * 2.6;
      pos[i * 3 + 2] = 2 - random() * 7;
      rnd[i] = random();
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    g.setAttribute("aRand", new THREE.BufferAttribute(rnd, 1));
    const m = new THREE.ShaderMaterial({
      vertexShader: fireflyVert,
      fragmentShader: fireflyFrag,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      toneMapped: false,
      uniforms: {
        uTime: { value: 0 },
        uSize: { value: 80 },
        uPixelRatio: { value: dpr },
        uIntensity: { value: 0.8 },
        uColor: { value: new THREE.Color("#7fb4ff") },
      },
    });
    return { g, m };
  }, [isMobile, dpr]);

  useEffect(
    () => () => {
      baked.dispose();
      light.seams.dispose();
      light.lines.dispose();
      light.veil.dispose();
      shaft.geometry.dispose();
      shaft.material.dispose();
      dust.g.dispose();
      dust.m.dispose();
      motes.g.dispose();
      motes.m.dispose();
    },
    [baked, light, shaft, dust, motes],
  );

  // copying the email answers with a surge through the arch
  useEffect(
    () =>
      useApp.subscribe((s, prev) => {
        if (!s.toast || s.toast === prev.toast || sceneState.p < c.start) return;
        gsap.fromTo(light.flare, { value: 1 }, { value: 0, duration: 1.8, ease: "power2.out", overwrite: true });
      }),
    [light, c.start],
  );

  useFrame((_, dt) => {
    const g = group.current;
    if (!g) return;
    const visible = sceneState.p >= c.start - 0.015;
    g.visible = visible;
    if (!visible) return;
    const t = local(sceneState.p, "contact");
    // the light climbs the arch as the camera settles in front of it
    light.on.value = THREE.MathUtils.smoothstep(t, 0.18, 0.62);
    light.time.value += dt;
    baked.uniforms.uTime.value += dt;
    shaft.material.uniforms.uTime.value += dt;
    dust.m.uniforms.uTime.value += dt;
    motes.m.uniforms.uTime.value += dt;
  });

  // the contact camera sits close: the clearing is shown at a smaller scale. Desktop sets the
  // arch to the right of the copy; phones keep it centred above it
  const x = isMobile ? 0 : 2.0;
  const scale = isMobile ? 0.5 : 0.62;

  return (
    <group ref={group} position={CONTACT_ORIGIN} visible={false}>
      <group position={[x, 0.8, 0]} scale={scale}>
        {scenery.map((m) => (
          <mesh key={m.name} geometry={m.geometry} material={baked} position={m.position} quaternion={m.quaternion} />
        ))}
        {nodes.Seams && <mesh geometry={nodes.Seams.geometry} material={light.seams} />}
        {nodes.Lines && <mesh geometry={nodes.Lines.geometry} material={light.lines} />}
        {nodes.Veil && <mesh geometry={nodes.Veil.geometry} material={light.veil} renderOrder={6} />}
        <mesh geometry={shaft.geometry} material={shaft.material} position={shaft.pos} quaternion={shaft.q} renderOrder={5} />
        <points geometry={dust.g} material={dust.m} frustumCulled={false} />
        <points geometry={motes.g} material={motes.m} frustumCulled={false} renderOrder={7} />
        <Butterflies count={isMobile ? 2 : 4} />
      </group>
    </group>
  );
}

useGLTF.preload(FINALE_URL, "/draco/");
