import * as THREE from "three";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";

/**
 * Modelling helpers for the rover: primitives placed by a matrix, collected per material,
 * then merged into one mesh per material so a part with dozens of pieces costs a few draw calls.
 */

const _e = new THREE.Euler();
const _q = new THREE.Quaternion();
const _s = new THREE.Vector3();
const _p = new THREE.Vector3();

/** translation + XYZ rotation (+ optional uniform/axis scale) as a matrix */
export function T(x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, sx = 1, sy = sx, sz = sx) {
  return new THREE.Matrix4().compose(_p.set(x, y, z), _q.setFromEuler(_e.set(rx, ry, rz)), _s.set(sx, sy, sz));
}

/** rounded box */
export const rbox = (w: number, h: number, d: number, r = 0.012, seg = 2) => new RoundedBoxGeometry(w, h, d, seg, Math.min(r, w / 2 - 1e-4, h / 2 - 1e-4, d / 2 - 1e-4));
export const box = (w: number, h: number, d: number) => new THREE.BoxGeometry(w, h, d);
/** cylinder along y */
export const cyl = (r: number, h: number, seg = 16, r2 = r, open = false) => new THREE.CylinderGeometry(r2, r, h, seg, 1, open);
/** cylinder along x */
export const cylX = (r: number, h: number, seg = 16, r2 = r) => cyl(r, h, seg, r2).rotateZ(Math.PI / 2);
/** cylinder along z */
export const cylZ = (r: number, h: number, seg = 16, r2 = r) => cyl(r, h, seg, r2).rotateX(Math.PI / 2);
/** tube through points */
export const tube = (pts: [number, number, number][], r: number, seg = 24, radial = 6) =>
  new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts.map((p) => new THREE.Vector3(...p))), seg, r, radial, false);

/** UVs projected along the dominant axis of each triangle, at `k` repeats per metre */
export function boxUV(g: THREE.BufferGeometry, k: number) {
  const p = g.attributes.position as THREE.BufferAttribute;
  const uv = new Float32Array(p.count * 2);
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  const n = new THREE.Vector3();
  for (let i = 0; i < p.count; i += 3) {
    a.fromBufferAttribute(p, i);
    b.fromBufferAttribute(p, i + 1);
    c.fromBufferAttribute(p, i + 2);
    n.subVectors(c, b).cross(a.clone().sub(b));
    const ax = Math.abs(n.x);
    const ay = Math.abs(n.y);
    const az = Math.abs(n.z);
    for (let j = 0; j < 3; j++) {
      const v = j === 0 ? a : j === 1 ? b : c;
      let u = 0;
      let w = 0;
      if (ax >= ay && ax >= az) {
        u = v.z;
        w = v.y;
      } else if (ay >= az) {
        u = v.x;
        w = v.z;
      } else {
        u = v.x;
        w = v.y;
      }
      uv[(i + j) * 2] = u * k;
      uv[(i + j) * 2 + 1] = w * k;
    }
  }
  g.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
}

/** keep only what every merged part shares */
function normalise(g: THREE.BufferGeometry) {
  const out = g.index ? g.toNonIndexed() : g.clone();
  for (const name of Object.keys(out.attributes)) if (name !== "position" && name !== "normal" && name !== "uv") out.deleteAttribute(name);
  if (!out.attributes.normal) out.computeVertexNormals();
  if (!out.attributes.uv) out.setAttribute("uv", new THREE.BufferAttribute(new Float32Array(out.attributes.position.count * 2), 2));
  out.clearGroups();
  return out;
}

export class Kit {
  private parts = new Map<THREE.Material, THREE.BufferGeometry[]>();

  /** place `geo` (consumed) with matrix `m`; uv: repeats per metre for box projection, or "keep" */
  add(geo: THREE.BufferGeometry, mat: THREE.Material, m?: THREE.Matrix4, uv: number | "keep" = 1) {
    const g = normalise(geo);
    geo.dispose();
    if (m) g.applyMatrix4(m);
    if (uv !== "keep") boxUV(g, uv);
    let list = this.parts.get(mat);
    if (!list) this.parts.set(mat, (list = []));
    list.push(g);
    return this;
  }

  /** merge everything collected into `into` (one mesh per material) and reset */
  bake(into: THREE.Object3D, shadows = true) {
    const meshes: THREE.Mesh[] = [];
    for (const [mat, list] of this.parts) {
      const merged = mergeGeometries(list, false);
      list.forEach((g) => g.dispose());
      if (!merged) continue;
      const mesh = new THREE.Mesh(merged, mat);
      mesh.castShadow = shadows;
      mesh.receiveShadow = true;
      into.add(mesh);
      meshes.push(mesh);
    }
    this.parts.clear();
    return meshes;
  }

  /** merge into standalone geometries per material (for parts that are instanced by hand) */
  geometries() {
    const out = new Map<THREE.Material, THREE.BufferGeometry>();
    for (const [mat, list] of this.parts) {
      const merged = mergeGeometries(list, false);
      list.forEach((g) => g.dispose());
      if (merged) out.set(mat, merged);
    }
    this.parts.clear();
    return out;
  }
}
