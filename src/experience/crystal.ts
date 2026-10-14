import * as THREE from "three";
import { rng } from "@/lib/random";

/**
 * Procedural gem crystals. Every variant shares one topology (same rings, same
 * triangle order) so the projects scene can morph one crystal into the next.
 *
 * Attributes: flat `normal` per facet, and `bary` — barycentrics where the
 * diagonal of a split quad is pinned to 1 so the shader only outlines real facet edges.
 */
export type CrystalVariant = { position: Float32Array; normal: Float32Array; bary: Float32Array };

const SIDES = 8;

type Tri = { v: THREE.Vector3[]; hide?: 0 | 1 | 2 };

export function crystalVariant(seed: number): CrystalVariant {
  const random = rng(seed);
  const j = (a: number) => (random() * 2 - 1) * a;

  const H = 1.08 + random() * 0.26;
  const R = 0.8 + random() * 0.16;
  // girdle → crown → table; the last two rings sit half a facet over, which cuts the crown into triangles
  const profile = [
    { y: -0.5, r: 0.7, twist: 0 },
    { y: 0.02, r: 0.84, twist: 0 },
    { y: 0.52, r: 0.66, twist: 0.5 },
    { y: 0.86, r: 0.36, twist: 0.5 },
  ].map((p) => ({ y: (p.y + j(0.06)) * H, r: p.r * R * (0.9 + random() * 0.18), twist: p.twist + j(0.08) }));

  const base = random() * Math.PI * 2;
  const rings = profile.map(({ y, r, twist }) =>
    Array.from({ length: SIDES }, (_, i) => {
      const a = base + ((i + twist) / SIDES) * Math.PI * 2 + j(0.09);
      const rr = r * (0.9 + random() * 0.18);
      return new THREE.Vector3(Math.cos(a) * rr, y + j(0.05), Math.sin(a) * rr);
    }),
  );
  const tip = new THREE.Vector3(j(0.06), -1.12 * H, j(0.06));
  const table = new THREE.Vector3(j(0.05), 0.94 * H, j(0.05));

  const tris: Tri[] = [];
  for (let i = 0; i < SIDES; i++) {
    const n = (i + 1) % SIDES;
    tris.push({ v: [tip, rings[0][n], rings[0][i]] });
  }
  for (let r = 0; r < rings.length - 1; r++) {
    const a = rings[r];
    const b = rings[r + 1];
    // decided by the template (not the jitter) so every variant keeps the same topology
    const aligned = r !== 1;
    for (let i = 0; i < SIDES; i++) {
      const n = (i + 1) % SIDES;
      if (aligned) {
        // a column face: two triangles sharing a hidden diagonal a[i]–b[n]
        tris.push({ v: [a[i], a[n], b[n]], hide: 1 });
        tris.push({ v: [a[i], b[n], b[i]], hide: 2 });
      } else {
        // antiprism band: every edge is a real facet edge
        tris.push({ v: [a[i], a[n], b[i]] });
        tris.push({ v: [a[n], b[n], b[i]] });
      }
    }
  }
  const top = rings[rings.length - 1];
  for (let i = 0; i < SIDES; i++) {
    const n = (i + 1) % SIDES;
    tris.push({ v: [top[i], top[n], table] });
  }

  const position = new Float32Array(tris.length * 9);
  const normal = new Float32Array(tris.length * 9);
  const bary = new Float32Array(tris.length * 9);
  const e1 = new THREE.Vector3();
  const e2 = new THREE.Vector3();
  const nrm = new THREE.Vector3();
  const mid = new THREE.Vector3();
  tris.forEach((t, k) => {
    const v = [...t.v];
    let hide = t.hide;
    nrm.crossVectors(e1.subVectors(v[1], v[0]), e2.subVectors(v[2], v[0])).normalize();
    mid.copy(v[0]).add(v[1]).add(v[2]).divideScalar(3);
    // face outward from the crystal's axis (flattened so the caps resolve too)
    if (nrm.dot(mid.set(mid.x, mid.y * 0.15, mid.z)) < 0) {
      [v[1], v[2]] = [v[2], v[1]];
      if (hide === 1) hide = 2;
      else if (hide === 2) hide = 1;
      nrm.negate();
    }
    v.forEach((p, i) => {
      const b = [0, 0, 0];
      b[i] = 1;
      // the edge opposite vertex `hide` is the quad's diagonal: pin it so it never draws
      if (hide !== undefined) b[hide] = 1;
      position.set([p.x, p.y, p.z], k * 9 + i * 3);
      normal.set([nrm.x, nrm.y, nrm.z], k * 9 + i * 3);
      bary.set(b, k * 9 + i * 3);
    });
  });
  return { position, normal, bary };
}

/** Geometry holding variant A in position/normal and the morph target in aPos2/aNor2. */
export function crystalGeometry(variants: CrystalVariant[]) {
  const g = new THREE.BufferGeometry();
  const a = variants[0];
  g.setAttribute("position", new THREE.BufferAttribute(a.position.slice(), 3));
  g.setAttribute("normal", new THREE.BufferAttribute(a.normal.slice(), 3));
  g.setAttribute("aPos2", new THREE.BufferAttribute(a.position.slice(), 3));
  g.setAttribute("aNor2", new THREE.BufferAttribute(a.normal.slice(), 3));
  g.setAttribute("aBary", new THREE.BufferAttribute(a.bary, 3));
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 2.4);
  return g;
}
