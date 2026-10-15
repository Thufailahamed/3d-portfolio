import * as THREE from "three";

/**
 * Project crystals come from Blender (art/build_crystals.py → crystals.glb), one cut per project.
 *
 * Each is rebuilt here as flat triangles with `aBary` barycentrics. Where two triangles are
 * coplanar (a quad split in two), their shared edge is pinned to 1 so the shader only
 * outlines real facet edges.
 */
export const CRYSTALS_URL = "/models/crystals.glb";

export function crystalFromMesh(src: THREE.BufferGeometry) {
  const g = src.index ? src.toNonIndexed() : src.clone();
  const pos = g.getAttribute("position") as THREE.BufferAttribute;
  const tris = pos.count / 3;

  const v = (i: number) => new THREE.Vector3().fromBufferAttribute(pos, i);
  const normals: THREE.Vector3[] = [];
  const e1 = new THREE.Vector3();
  const e2 = new THREE.Vector3();
  for (let t = 0; t < tris; t++) {
    const [a, b, c] = [v(t * 3), v(t * 3 + 1), v(t * 3 + 2)];
    normals.push(new THREE.Vector3().crossVectors(e1.subVectors(b, a), e2.subVectors(c, a)).normalize());
  }

  // edge → triangles sharing it (positions quantised so split vertices still match)
  const key = (i: number) => `${pos.getX(i).toFixed(4)},${pos.getY(i).toFixed(4)},${pos.getZ(i).toFixed(4)}`;
  const edges = new Map<string, { tri: number; opposite: number }[]>();
  for (let t = 0; t < tris; t++) {
    for (let k = 0; k < 3; k++) {
      const a = key(t * 3 + ((k + 1) % 3));
      const b = key(t * 3 + ((k + 2) % 3));
      const id = a < b ? `${a}|${b}` : `${b}|${a}`;
      const list = edges.get(id) ?? [];
      list.push({ tri: t, opposite: k });
      edges.set(id, list);
    }
  }
  const hidden: boolean[][] = Array.from({ length: tris }, () => [false, false, false]);
  for (const list of edges.values()) {
    if (list.length !== 2) continue;
    const [p, q] = list;
    if (normals[p.tri].dot(normals[q.tri]) > 0.999) {
      hidden[p.tri][p.opposite] = true;
      hidden[q.tri][q.opposite] = true;
    }
  }

  const normal = new Float32Array(tris * 9);
  const bary = new Float32Array(tris * 9);
  for (let t = 0; t < tris; t++) {
    const n = normals[t];
    for (let k = 0; k < 3; k++) {
      const b = [0, 0, 0];
      b[k] = 1;
      for (let h = 0; h < 3; h++) if (hidden[t][h]) b[h] = 1;
      normal.set([n.x, n.y, n.z], (t * 3 + k) * 3);
      bary.set(b, (t * 3 + k) * 3);
    }
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute("position", pos.clone());
  out.setAttribute("normal", new THREE.BufferAttribute(normal, 3));
  out.setAttribute("aBary", new THREE.BufferAttribute(bary, 3));
  out.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1.6);
  g.dispose();
  return out;
}

/**
 * Splits every facet into n × n smaller triangles (all attributes interpolated), so ripples can
 * move the surface. Flat normals and the edge barycentrics carry over unchanged.
 */
export function tessellate(src: THREE.BufferGeometry, n: number) {
  const names = Object.keys(src.attributes);
  const attrs = names.map((k) => src.getAttribute(k) as THREE.BufferAttribute);
  const tris = attrs[0].count / 3;
  const per = n * n * 3;
  const out = attrs.map((a) => new Float32Array(tris * per * a.itemSize));
  let o = 0;
  const put = (t: number, u: number, v: number) => {
    const w = 1 - u - v;
    attrs.forEach((a, k) => {
      for (let c = 0; c < a.itemSize; c++) {
        const val =
          a.getComponent(t * 3, c) * w + a.getComponent(t * 3 + 1, c) * u + a.getComponent(t * 3 + 2, c) * v;
        out[k][o * a.itemSize + c] = val;
      }
    });
    o++;
  };
  for (let t = 0; t < tris; t++) {
    for (let i = 0; i < n; i++)
      for (let j = 0; j < n - i; j++) {
        const [u0, v0, u1, v1] = [i / n, j / n, (i + 1) / n, (j + 1) / n];
        put(t, u0, v0);
        put(t, u1, v0);
        put(t, u0, v1);
        if (j < n - i - 1) {
          put(t, u1, v0);
          put(t, u1, v1);
          put(t, u0, v1);
        }
      }
  }
  const g = new THREE.BufferGeometry();
  names.forEach((k, i) => g.setAttribute(k, new THREE.BufferAttribute(out[i].subarray(0, o * attrs[i].itemSize), attrs[i].itemSize)));
  g.boundingSphere = src.boundingSphere?.clone() ?? null;
  return g;
}
