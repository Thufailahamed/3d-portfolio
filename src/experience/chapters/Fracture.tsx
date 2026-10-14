"use client";

import { useGLTF } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { chapter, local } from "@/lib/chapters";
import { rng } from "@/lib/random";
import { sceneState } from "@/lib/sceneState";
import { useApp } from "@/store/useApp";
import { palette } from "../palette";
import { discFrag, discVert } from "../shaders/signal";
import { FOREST_URL, makeBakedMaterial } from "./Forest";

export const RING_CENTER = new THREE.Vector3(0, 3.2, 0);
const Z = new THREE.Vector3(0, 0, 1);

const ease = (t: number) => t * t * (3 - 2 * t);
const seg = (t: number, a: number, b: number) => ease(THREE.MathUtils.clamp((t - a) / (b - a), 0, 1));

type Shard = {
  mesh: THREE.Object3D;
  origin: THREE.Vector3;
  burst: THREE.Vector3;
  ring: THREE.Vector3;
  qBurst: THREE.Quaternion;
  qRing: THREE.Quaternion;
  phase: number;
};

/**
 * Chapters 1–2 — the arch's stones (with their ivy) stand as the ruin in the forest,
 * then burst apart, hang in the air, and coil into a ring around a "signal"
 * membrane. Fully scroll-driven.
 */
export default function Fracture() {
  const { nodes } = useGLTF(FOREST_URL, "/draco/") as unknown as {
    nodes: Record<string, THREE.Object3D>;
  };
  const isMobile = useApp((s) => s.isMobile);
  const group = useRef<THREE.Group>(null);

  const mats = useMemo(
    () => ({
      // baked stone + ivy; a lime rim lights up as the arch breaks
      stone: makeBakedMaterial(THREE.DoubleSide),
      disc: new THREE.ShaderMaterial({
        vertexShader: discVert,
        fragmentShader: discFrag,
        transparent: true,
        depthWrite: false,
        toneMapped: false,
        uniforms: {
          uTime: { value: 0 },
          uOpacity: { value: 0 },
          uAccent: { value: palette.accent.clone() },
        },
      }),
    }),
    [],
  );

  const radius = isMobile ? 1.75 : 2.6;

  const shards = useMemo<Shard[]>(() => {
    const random = rng(23);
    const center = new THREE.Vector3(0, 2.2, 0);
    const list = Object.values(nodes)
      .filter((n) => /^Stone_\d+$/.test(n.name) && (n as THREE.Mesh).isMesh)
      .sort((a, b) => a.position.y - b.position.y) as THREE.Mesh[];

    return list.map((src, i) => {
      const mesh = new THREE.Mesh(src.geometry, mats.stone);
      const origin = src.position.clone();

      const dir = origin.clone().sub(center);
      dir.z += (random() - 0.5) * 1.2;
      dir.normalize();
      const burst = origin
        .clone()
        .addScaledVector(dir, 1.4 + random() * 2.4)
        .add(new THREE.Vector3(0, 0.6 + random() * 1.4, (random() - 0.5) * 2.5));

      // coil the column into the ring: bottom shards start at the bottom of the circle
      const a = -Math.PI / 2 + (i / list.length) * Math.PI * 2;
      const ring = new THREE.Vector3(Math.cos(a) * radius, Math.sin(a) * radius, (random() - 0.5) * 0.25);

      const qBurst = new THREE.Quaternion().setFromEuler(
        new THREE.Euler(random() * 6.28, random() * 6.28, random() * 6.28),
      );
      const qRing = new THREE.Quaternion().setFromEuler(new THREE.Euler(0.3 * (random() - 0.5), 0, a));

      return { mesh, origin, burst, ring, qBurst, qRing, phase: random() * 6.28 };
    });
  }, [nodes, mats, radius]);

  useEffect(
    () => () => {
      mats.stone.dispose();
      mats.disc.dispose();
    },
    [mats],
  );

  // hovering the intact arch wakes glowing runes under the cursor
  const hover = useMemo(
    () => ({
      ray: new THREE.Raycaster(),
      ndc: new THREE.Vector2(),
      target: new THREE.Vector3(),
      hit: false,
      // any device with a real hover pointer, whatever its width
      canHover: matchMedia("(hover: hover) and (pointer: fine)").matches,
    }),
    [],
  );
  const meshes = useMemo(() => shards.map((s) => s.mesh), [shards]);

  const tmp = useMemo(
    () => ({
      v: new THREE.Vector3(),
      r: new THREE.Vector3(),
      q: new THREE.Quaternion(),
      qSpin: new THREE.Quaternion(),
      qr: new THREE.Quaternion(),
      id: new THREE.Quaternion(),
    }),
    [],
  );

  useFrame(({ clock, camera }, dt) => {
    const g = group.current;
    if (!g) return;
    const p = sceneState.p;
    const u = mats.stone.uniforms;
    u.uTime.value = clock.elapsedTime;
    const intact = p < chapter("fracture").start + 0.002 && sceneState.intro > 0.9;
    hover.hit = false;
    if (intact && hover.canHover) {
      hover.ndc.set(sceneState.mouse.x, sceneState.mouse.y);
      hover.ray.setFromCamera(hover.ndc, camera);
      const hit = hover.ray.intersectObjects(meshes, false)[0];
      if (hit) {
        hover.hit = true;
        hover.target.copy(hit.point);
      }
    }
    // the patch trails the cursor a little, and fades in / out
    if (u.uHoverAmt.value < 0.01 && hover.hit) u.uHoverPos.value.copy(hover.target);
    u.uHoverPos.value.lerp(hover.target, Math.min(1, dt * 10));
    u.uHoverAmt.value += ((hover.hit ? 1 : 0) - u.uHoverAmt.value) * Math.min(1, dt * (hover.hit ? 5 : 2.5));
    const tu = chapter("tunnel");
    // the stones are the arch until the break, and live on until the tunnel covers the screen
    g.visible = p < tu.start + (tu.end - tu.start) * 0.55;
    if (!g.visible) return;

    const t = local(p, "fracture");
    const time = clock.elapsedTime;
    const burst = seg(t, 0.0, 0.32);
    const gather = seg(t, 0.5, 0.88);
    const float = Math.sin(Math.PI * Math.min(1, t / 0.88)) * 0.12 + 0.03;

    // the ring keeps turning slowly — scroll adds a twist on top
    const spin = time * 0.05 + t * 1.2;
    tmp.qSpin.setFromAxisAngle(Z, spin);

    for (const s of shards) {
      tmp.r.copy(s.ring).applyAxisAngle(Z, spin).add(RING_CENTER);
      tmp.v.lerpVectors(s.origin, s.burst, burst).lerp(tmp.r, gather);
      tmp.v.y += Math.sin(time * 0.8 + s.phase) * float;
      tmp.v.x += Math.cos(time * 0.6 + s.phase) * float * 0.5;
      s.mesh.position.copy(tmp.v);

      tmp.q.slerpQuaternions(tmp.id, s.qBurst, burst);
      tmp.qr.multiplyQuaternions(tmp.qSpin, s.qRing);
      tmp.q.slerp(tmp.qr, gather);
      s.mesh.quaternion.copy(tmp.q);
      s.mesh.rotateX(Math.sin(time * 0.5 + s.phase) * float * 0.6);
    }

    // crack light flares on the break, then settles to a steady glow in the ring
    const flare = Math.exp(-Math.pow((t - 0.08) * 9, 2)) * 3.5;
    const broken = Math.min(1, t * 40);
    mats.stone.uniforms.uRim.value = broken * (0.1 + burst * 0.22 + flare * 0.6 + gather * 0.3);
    mats.stone.uniforms.uFill.value = broken * (flare * 0.04 + gather * 0.006);

    mats.disc.uniforms.uTime.value += dt;
    mats.disc.uniforms.uOpacity.value = seg(t, 0.68, 1.0);
  });

  return (
    <group ref={group} visible={false}>
      {shards.map((s) => (
        <primitive key={s.mesh.uuid} object={s.mesh} />
      ))}
      <mesh position={RING_CENTER} material={mats.disc} renderOrder={2}>
        <circleGeometry args={[radius * 0.92, 96]} />
      </mesh>
    </group>
  );
}
