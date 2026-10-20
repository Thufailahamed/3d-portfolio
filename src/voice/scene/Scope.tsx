"use client";

import { useFrame } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import * as THREE from "three";

/**
 * A signal drawn as a row of thin bars, one per column, each spanning that column's min … max. `read` fills the
 * columns every frame (so a live microphone can scroll through it); colours come per column too.
 */
export type ScopeFrame = { lo: Float32Array; hi: Float32Array; color: (i: number, out: THREE.Color) => void; head?: number };

export default function Scope({ cols, width, height, read, position, depth = 0.02 }: { cols: number; width: number; height: number; read: () => ScopeFrame | null; position?: [number, number, number]; depth?: number }) {
  const mesh = useRef<THREE.InstancedMesh>(null);
  const head = useRef<THREE.Mesh>(null);
  const geo = useMemo(() => new THREE.BoxGeometry(1, 1, 1), []);
  const mat = useMemo(() => new THREE.MeshBasicMaterial({ toneMapped: false }), []);
  const tmp = useMemo(() => ({ m: new THREE.Matrix4(), c: new THREE.Color(), s: new THREE.Vector3(), p: new THREE.Vector3(), q: new THREE.Quaternion() }), []);
  const cw = width / cols;

  useFrame(() => {
    const m = mesh.current;
    if (!m) return;
    const f = read();
    m.visible = !!f;
    if (head.current) head.current.visible = !!f && f.head !== undefined;
    if (!f) return;
    for (let i = 0; i < cols; i++) {
      // a floor of 1.5 % keeps silence visible as a hairline
      const lo = Math.min(f.lo[i], -0.015);
      const hi = Math.max(f.hi[i], 0.015);
      tmp.p.set(-width / 2 + (i + 0.5) * cw, ((hi + lo) / 2) * height, 0);
      tmp.s.set(cw * 0.62, (hi - lo) * height, depth);
      tmp.m.compose(tmp.p, tmp.q, tmp.s);
      m.setMatrixAt(i, tmp.m);
      f.color(i, tmp.c);
      m.setColorAt(i, tmp.c);
    }
    m.instanceMatrix.needsUpdate = true;
    if (m.instanceColor) m.instanceColor.needsUpdate = true;
    if (head.current && f.head !== undefined) head.current.position.x = -width / 2 + f.head * width;
  });

  return (
    <group position={position}>
      <instancedMesh ref={mesh} args={[geo, mat, cols]} frustumCulled={false} />
      <mesh ref={head}>
        <boxGeometry args={[0.012, height * 2.1, 0.01]} />
        <meshBasicMaterial color="#ffffff" toneMapped={false} />
      </mesh>
    </group>
  );
}
