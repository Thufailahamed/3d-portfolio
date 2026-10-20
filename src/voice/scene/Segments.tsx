"use client";

import { forwardRef, useImperativeHandle, useMemo } from "react";
import * as THREE from "three";

/**
 * Thin glowing segments as one instanced mesh: beams, arcs (as runs of short segments), anything drawn from
 * data every frame. Additive, so a segment's brightness is its weight.
 */

const up = new THREE.Vector3(0, 1, 0);
const a = new THREE.Vector3();
const b = new THREE.Vector3();
const d = new THREE.Vector3();
const q = new THREE.Quaternion();
const s = new THREE.Vector3();
const m = new THREE.Matrix4();
const c = new THREE.Color();
const zero = new THREE.Matrix4().makeScale(0, 0, 0);

export const Segments = forwardRef<THREE.InstancedMesh, { count: number }>(function Segments({ count }, ref) {
  const mesh = useMemo(() => {
    const im = new THREE.InstancedMesh(
      new THREE.CylinderGeometry(0.5, 0.5, 1, 6, 1, true),
      new THREE.MeshBasicMaterial({ toneMapped: false, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }),
      count,
    );
    // every instance starts collapsed, not as a unit cylinder at the origin
    for (let i = 0; i < count; i++) im.setMatrixAt(i, zero);
    im.frustumCulled = false;
    return im;
  }, [count]);
  useImperativeHandle(ref, () => mesh, [mesh]);
  return <primitive object={mesh} />;
});

/** segment i from p0 to p1, `width` thick, in `color` scaled by `weight` */
export function setSegment(mesh: THREE.InstancedMesh, i: number, p0: [number, number, number], p1: [number, number, number], width: number, color: THREE.Color, weight: number) {
  a.set(...p0);
  b.set(...p1);
  d.subVectors(b, a);
  const len = d.length();
  if (len < 1e-6 || weight <= 0) return mesh.setMatrixAt(i, zero);
  q.setFromUnitVectors(up, d.divideScalar(len));
  s.set(width, len, width);
  m.compose(a.add(b).multiplyScalar(0.5), q, s);
  mesh.setMatrixAt(i, m);
  mesh.setColorAt(i, c.copy(color).multiplyScalar(weight));
}

export function hideSegments(mesh: THREE.InstancedMesh, from: number) {
  for (let i = from; i < mesh.count; i++) mesh.setMatrixAt(i, zero);
}

export function commit(mesh: THREE.InstancedMesh) {
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
}
