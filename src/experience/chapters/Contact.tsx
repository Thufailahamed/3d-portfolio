"use client";

import { useGLTF } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { chapter, CONTACT_ORIGIN, local } from "@/lib/chapters";
import { sceneState } from "@/lib/sceneState";
import { useApp } from "@/store/useApp";
import Atmosphere from "../Atmosphere";
import { palette } from "../palette";
import { coreFrag, coreVert } from "../shaders/signal";
import { MONOLITH_URL } from "./Monolith";

const SHARD_HEIGHT = 2.1;
const SHARD_Y = 1.75;

/** Chapter 6 — one shard of the monolith, standing alone in a beam of light. */
export default function Contact() {
  const isMobile = useApp((s) => s.isMobile);
  const c = chapter("contact");
  const group = useRef<THREE.Group>(null);

  useFrame(() => {
    if (group.current) group.current.visible = sceneState.p >= c.start - 0.001;
  });

  return (
    <>
      <group ref={group} position={CONTACT_ORIGIN} visible={false}>
        <Shard />
      </group>
      <Atmosphere
        origin={CONTACT_ORIGIN}
        beam={[0, 0, 0]}
        range={[c.start - 0.001, 2]}
        dustCount={isMobile ? 600 : 1500}
        rayIntensity={0.34}
      />
    </>
  );
}

function Shard() {
  const { nodes } = useGLTF(MONOLITH_URL, "/draco/") as unknown as { nodes: Record<string, THREE.Object3D> };
  const spin = useRef<THREE.Group>(null);

  const mats = useMemo(
    () => ({
      obsidian: new THREE.MeshStandardMaterial({ color: "#0b0b0d", roughness: 0.2, metalness: 0.85, envMapIntensity: 1.4 }),
      core: new THREE.ShaderMaterial({
        vertexShader: coreVert,
        fragmentShader: coreFrag,
        toneMapped: false,
        uniforms: { uAccent: { value: palette.accent.clone() }, uRim: { value: 1.6 }, uFill: { value: 0.05 } },
      }),
    }),
    [],
  );
  useEffect(
    () => () => {
      mats.obsidian.dispose();
      mats.core.dispose();
    },
    [mats],
  );

  // the tallest shard of the fractured monolith, scaled up and stood on end
  const { parts, scale, center } = useMemo(() => {
    let best: THREE.Object3D | null = null;
    let bestH = 0;
    const box = new THREE.Box3();
    for (const n of Object.values(nodes)) {
      if (!/^Shard_\d+$/.test(n.name)) continue;
      box.setFromObject(n);
      const h = box.max.y - box.min.y;
      if (h > bestH) {
        bestH = h;
        best = n;
      }
    }
    const src = best!;
    const meshes = ((src as THREE.Mesh).isMesh ? [src as THREE.Mesh] : (src.children as THREE.Mesh[])).map((m) => ({
      geometry: m.geometry,
      material: (m.material as THREE.Material).name === "Core" ? mats.core : mats.obsidian,
    }));
    // geometry is centred on its own origin (re-centred in Blender)
    box.makeEmpty();
    for (const m of meshes) {
      m.geometry.computeBoundingBox();
      box.union(m.geometry.boundingBox!);
    }
    return { parts: meshes, scale: SHARD_HEIGHT / bestH, center: box.getCenter(new THREE.Vector3()) };
  }, [nodes, mats]);

  useFrame(({ clock }) => {
    const g = spin.current;
    if (!g) return;
    const time = clock.elapsedTime;
    const t = local(sceneState.p, "contact");
    g.rotation.y = time * 0.15 + sceneState.mouse.x * 0.3;
    g.position.y = SHARD_Y + Math.sin(time * 0.7) * 0.05 + (1 - t) * 0.4;
    mats.core.uniforms.uRim.value = 1.2 + Math.sin(time * 1.3) * 0.25 + t * 0.6;
  });

  return (
    <group ref={spin} position={[0, SHARD_Y, 0]}>
      <group scale={scale} position={center.clone().multiplyScalar(-scale)}>
        {parts.map((p, i) => (
          <mesh key={i} geometry={p.geometry} material={p.material} />
        ))}
      </group>
    </group>
  );
}
