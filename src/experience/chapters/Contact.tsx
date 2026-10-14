"use client";

import { useGLTF } from "@react-three/drei";
import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { chapter, CONTACT_ORIGIN, local } from "@/lib/chapters";
import { rng } from "@/lib/random";
import { sceneState } from "@/lib/sceneState";
import { useApp } from "@/store/useApp";
import { dustFrag, dustVert, raysFrag, raysVert } from "../shaders/atmosphere";
import { fireflyFrag, fireflyVert } from "../shaders/forest";
import { coreFrag, coreVert } from "../shaders/signal";

export const SHRINE_URL = "/models/shrine.glb";

// Canopy beam direction and target landing on the altar
const SUN = new THREE.Vector3(-0.45, -1, 0.15).normalize();
const ALTAR_TARGET: [number, number, number] = [0.5, 2.0, -0.2];

/**
 * Chapter 6 — The Deep Jungle Shrine ("LET'S BUILD SOMETHING THAT GLOWS")
 * An ancient runic sanctuary nestled deep in a tropical jungle clearing:
 *   - Overgrown stone dais with ancient arch, climbing ivy, banyan trees, and roots
 *   - Fractured obsidian monolith with radiant cyan core and orbital rune rings
 *   - Volumetric canopy god rays, floating dust motes, and electric fireflies
 *   - Responsive cursor parallax and pulsating energy glow
 */
export default function Contact() {
  const isMobile = useApp((s) => s.isMobile);
  const dpr = useThree((s) => s.viewport.dpr);
  const c = chapter("contact");
  const group = useRef<THREE.Group>(null);

  // ------------------------------------------------------------------ 3D GLTF scene
  const { nodes } = useGLTF(SHRINE_URL, "/draco/") as unknown as {
    nodes: Record<string, THREE.Mesh>;
  };

  // Centerpiece animation refs
  const shrineCore = useRef<THREE.Group>(null);
  const ring0 = useRef<THREE.Mesh>(null);
  const ring1 = useRef<THREE.Mesh>(null);

  // ------------------------------------------------------------------ custom materials
  const customMats = useMemo(() => {
    const core = new THREE.ShaderMaterial({
      vertexShader: coreVert,
      fragmentShader: coreFrag,
      toneMapped: false,
      uniforms: {
        uAccent: { value: new THREE.Color("#00a2ff") },
        uRim: { value: 1.8 },
        uFill: { value: 0.12 },
      },
    });

    const ringCyan = new THREE.MeshStandardMaterial({
      color: "#051828",
      emissive: new THREE.Color("#0095ff"),
      emissiveIntensity: 2.5,
      roughness: 0.2,
      metalness: 0.8,
      toneMapped: false,
    });

    const ringGold = new THREE.MeshStandardMaterial({
      color: "#241805",
      emissive: new THREE.Color("#ffb833"),
      emissiveIntensity: 2.2,
      roughness: 0.25,
      metalness: 0.8,
      toneMapped: false,
    });

    const obsidian = new THREE.MeshStandardMaterial({
      color: "#090b0e",
      roughness: 0.22,
      metalness: 0.9,
      envMapIntensity: 1.5,
    });

    return { core, ringCyan, ringGold, obsidian };
  }, []);

  // ------------------------------------------------------------------ double-sided foliage
  useEffect(() => {
    for (const [name, mesh] of Object.entries(nodes)) {
      if (!mesh?.isMesh) continue;
      if (name.includes("Ivy") || name.includes("Leaves") || name.includes("Ferns")) {
        const mat = mesh.material;
        if (Array.isArray(mat)) {
          mat.forEach((m) => (m.side = THREE.DoubleSide));
        } else if (mat) {
          mat.side = THREE.DoubleSide;
        }
      }
    }
  }, [nodes]);

  // ------------------------------------------------------------------ god rays
  const shaft = useMemo(() => {
    const geometry = new THREE.CylinderGeometry(0.3, 1.4, 20, 36, 1, true);
    const material = new THREE.ShaderMaterial({
      vertexShader: raysVert,
      fragmentShader: raysFrag,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: {
        uTime: { value: 0 },
        uIntensity: { value: 0.22 },
        uColor: { value: new THREE.Color("#cde4ff") },
      },
    });

    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), SUN.clone().negate());
    const pos = new THREE.Vector3(...ALTAR_TARGET).addScaledVector(SUN, -(10 - 2.5));
    return { geometry, material, q, pos };
  }, []);

  // ------------------------------------------------------------------ dust motes
  const motes = useMemo(() => {
    const count = isMobile ? 450 : 1200;
    const random = rng(888);
    const pos = new Float32Array(count * 3);
    const rndVals = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      pos[i * 3] = (random() - 0.5) * 14 + ALTAR_TARGET[0];
      pos[i * 3 + 1] = random() * 8.5;
      pos[i * 3 + 2] = (random() - 0.5) * 12 + ALTAR_TARGET[2];
      rndVals[i] = random();
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    g.setAttribute("aRand", new THREE.BufferAttribute(rndVals, 1));
    const m = new THREE.ShaderMaterial({
      vertexShader: dustVert,
      fragmentShader: dustFrag,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: {
        uTime: { value: 0 },
        uSize: { value: 22 },
        uPixelRatio: { value: dpr },
        uBeam: { value: new THREE.Vector3(...ALTAR_TARGET) },
        uColor: { value: new THREE.Color("#bce0ff") },
      },
    });
    return { g, m };
  }, [isMobile, dpr]);

  // ------------------------------------------------------------------ electric fireflies
  const fireflies = useMemo(() => {
    const count = isMobile ? 32 : 65;
    const random = rng(999);
    const pos = new Float32Array(count * 3);
    const rndVals = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      let x = (random() - 0.5) * 12 + ALTAR_TARGET[0];
      if (Math.abs(x - ALTAR_TARGET[0]) < 1.0) x += Math.sign(x - ALTAR_TARGET[0] || 1) * 1.5;
      pos[i * 3] = x;
      pos[i * 3 + 1] = 0.3 + Math.pow(random(), 1.4) * 3.6;
      pos[i * 3 + 2] = 2.0 - random() * 8.0 + ALTAR_TARGET[2];
      rndVals[i] = random();
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    g.setAttribute("aRand", new THREE.BufferAttribute(rndVals, 1));
    const m = new THREE.ShaderMaterial({
      vertexShader: fireflyVert,
      fragmentShader: fireflyFrag,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      toneMapped: false,
      uniforms: {
        uTime: { value: 0 },
        uSize: { value: 95 },
        uPixelRatio: { value: dpr },
        uIntensity: { value: 1.0 },
        uColor: { value: new THREE.Color("#00bbff") },
      },
    });
    return { g, m };
  }, [isMobile, dpr]);

  // Cleanup
  useEffect(() => {
    return () => {
      Object.values(customMats).forEach((m) => m.dispose());
      shaft.geometry.dispose();
      shaft.material.dispose();
      motes.g.dispose();
      motes.m.dispose();
      fireflies.g.dispose();
      fireflies.m.dispose();
    };
  }, [customMats, shaft, motes, fireflies]);

  // ------------------------------------------------------------------ frame animation
  useFrame(({ clock }, dt) => {
    const g = group.current;
    if (!g) return;

    // Visibility gate: visible when approaching contact chapter
    const active = sceneState.p >= c.start - 0.01;
    g.visible = active;
    if (!active) return;

    const time = clock.elapsedTime;
    const t = local(sceneState.p, "contact");

    // Idle breathing & subtle cursor parallax on hero monolith
    if (shrineCore.current) {
      shrineCore.current.position.y = Math.sin(time * 0.9) * 0.04;
      shrineCore.current.rotation.y = time * 0.12 + sceneState.mouse.x * 0.25;
      shrineCore.current.rotation.x = sceneState.mouse.y * 0.05;
    }

    // Opposite spinning orbital gyro rings
    if (ring0.current) {
      ring0.current.rotation.x += dt * 0.45;
      ring0.current.rotation.y += dt * 0.65;
    }
    if (ring1.current) {
      ring1.current.rotation.y -= dt * 0.55;
      ring1.current.rotation.z += dt * 0.35;
    }

    // Pulse core glow
    customMats.core.uniforms.uRim.value = 1.4 + Math.sin(time * 1.6) * 0.4 + t * 0.5;

    // Advance particle and ray shaders
    shaft.material.uniforms.uTime.value += dt;
    motes.m.uniforms.uTime.value += dt;
    fireflies.m.uniforms.uTime.value += dt;
  });

  return (
    <group ref={group} position={CONTACT_ORIGIN} visible={false}>
      {/* Cool atmospheric moonlight and subtle ambient illumination */}
      <ambientLight intensity={0.75} color="#1e2c38" />
      <directionalLight position={[-4, 12, 6]} intensity={1.3} color="#a8cde8" />

      {/* Dynamic radiant light spilling from the glowing core onto the dais & jungle */}
      <pointLight position={[0.5, 2.05, -0.2]} color="#0099ff" intensity={22} distance={12} decay={2} />
      <pointLight position={[0.5, 2.05, -0.2]} color="#ffb020" intensity={8} distance={5} decay={2} />

      {/* Static jungle environment meshes */}
      {nodes.JungleGround && <primitive object={nodes.JungleGround} />}
      {nodes.Boulders && <primitive object={nodes.Boulders} />}
      {nodes.Trees && <primitive object={nodes.Trees} />}
      {nodes.Branches && <primitive object={nodes.Branches} />}
      {nodes.Roots && <primitive object={nodes.Roots} />}
      {nodes.Lianas && <primitive object={nodes.Lianas} />}
      {nodes.Dais && <primitive object={nodes.Dais} />}
      {nodes.ArchPillars && <primitive object={nodes.ArchPillars} />}
      {nodes.RuinedArch && <primitive object={nodes.RuinedArch} />}
      {nodes.ArchIvy && <primitive object={nodes.ArchIvy} />}
      {nodes.JungleBroadleaves && <primitive object={nodes.JungleBroadleaves} />}
      {nodes.DenseFerns && <primitive object={nodes.DenseFerns} />}

      {/* The Hero Monolith & Levitating Core */}
      <group position={[0.5, 0.0, -0.2]}>
        <group ref={shrineCore}>
          {nodes.MonolithShell && (
            <mesh geometry={nodes.MonolithShell.geometry} material={customMats.obsidian} />
          )}
          {nodes.GlowingCoreBeacon && (
            <mesh geometry={nodes.GlowingCoreBeacon.geometry} material={customMats.core} />
          )}
          {nodes.Orbital_Ring_0 && (
            <mesh
              ref={ring0}
              geometry={nodes.Orbital_Ring_0.geometry}
              material={customMats.ringCyan}
              position={[0, 0.15, 0]}
            />
          )}
          {nodes.Orbital_Ring_1 && (
            <mesh
              ref={ring1}
              geometry={nodes.Orbital_Ring_1.geometry}
              material={customMats.ringGold}
              position={[0, 0.35, 0]}
            />
          )}
        </group>
      </group>

      {/* Volumetric canopy god ray shaft */}
      <mesh
        geometry={shaft.geometry}
        material={shaft.material}
        position={shaft.pos}
        quaternion={shaft.q}
        renderOrder={5}
      />

      {/* Drifting motes & electric fireflies */}
      <points geometry={motes.g} material={motes.m} frustumCulled={false} />
      <points geometry={fireflies.g} material={fireflies.m} frustumCulled={false} renderOrder={6} />
    </group>
  );
}

useGLTF.preload(SHRINE_URL, "/draco/");
