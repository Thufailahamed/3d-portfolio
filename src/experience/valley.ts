import * as THREE from "three";
import { mergeVertices } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { perlin } from "@/lib/perlin";
import { rng } from "@/lib/random";
import { riverInside } from "./river";

/**
 * The projects valley's solid ground (local units; the crystal's rock sits at the origin):
 * banks that slope into the river, low hills behind, and what grows or lies on them.
 */
const n1 = perlin(31);
const n2 = perlin(32);
const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
const fbm = (x: number, z: number) => n1(x, z) * 0.5 + n1(x * 2.1 + 5.3, z * 2.1 - 1.7) * 0.25 + n2(x * 4.3, z * 4.3) * 0.125;

/** Ground height at (x, z); below 0 is under the water. */
export function bankHeight(x: number, z: number) {
  const d = -riverInside(x, z); // > 0 on land, roughly the distance to the bank
  if (d < 0) return Math.max(-0.7, d * 0.45 - 0.04);
  // a low, uneven lip along the water, then rolling ground and hills further back
  const lip = smooth(0, 1.4, d) * (0.12 + 0.08 * n2(x * 1.3, z * 1.3));
  const back = smooth(-2, -16, z); // hills grow toward the range
  const front = 1 - 0.55 * smooth(1, 10, z); // and stay low around the camera
  const hills = smooth(1.2, 11, d) * (0.6 + 1.5 * back) * (1 + 1.2 * fbm(x * 0.07, z * 0.07)) * front;
  const bumps = 0.1 * fbm(x * 0.7, z * 0.7) * smooth(0, 2, d);
  return d * 0.03 + lip + hills + bumps - 0.04;
}

/** The banks as one mesh (the river is cut out of it in the shader, below the waterline). */
export function bankGeometry(segX: number, segZ: number) {
  const g = new THREE.PlaneGeometry(140, 80, segX, segZ).rotateX(-Math.PI / 2).translate(0, 0, -22);
  const p = g.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) p.setY(i, bankHeight(p.getX(i), p.getZ(i)));
  g.computeVertexNormals();
  return g;
}

/** A smooth, worn boulder: a noisy sphere, flattened, optionally with a planed top. */
export function boulderGeometry(seed: number, scale: [number, number, number], top = Infinity, detail = 5) {
  const n = perlin(seed);
  const g = mergeVertices(new THREE.IcosahedronGeometry(1, detail).deleteAttribute("normal").deleteAttribute("uv"));
  const p = g.attributes.position as THREE.BufferAttribute;
  const v = new THREE.Vector3();
  const s = new THREE.Vector3(...scale);
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    const d =
      1 +
      0.22 * n(v.x * 1.1 + v.z * 0.5 + 3, v.y * 1.1) +
      0.07 * n(v.x * 3.3 + 1, v.z * 3.3 + v.y * 2) +
      0.025 * n(v.x * 8 + v.y * 3, v.z * 8 - 2);
    v.multiplyScalar(d).multiply(s);
    // a softly rounded plane on top (water-worn, not sawn)
    if (v.y > top - 0.08) v.y = top - 0.08 + (v.y - top + 0.08) * 0.25;
    p.setXYZ(i, v.x, v.y, v.z);
  }
  g.computeVertexNormals();
  return g;
}

/** A conifer: a trunk and a stack of ragged, drooping tiers of branches. */
export function pineGeometry(seed: number) {
  const random = rng(seed);
  const parts: THREE.BufferGeometry[] = [];
  const trunk = new THREE.CylinderGeometry(0.035, 0.06, 1, 6, 1, true).translate(0, 0.5, 0);
  parts.push(trunk);
  const tiers = 9;
  for (let t = 0; t < tiers; t++) {
    const k = t / (tiers - 1);
    const r = 0.5 * (1 - k * 0.86) + 0.04;
    const h = 0.32 - k * 0.1;
    const y = 0.3 + k * 1.0;
    const seg = 14;
    const cone = new THREE.ConeGeometry(r, h, seg, 2, true);
    const p = cone.attributes.position as THREE.BufferAttribute;
    // ragged rim: every branch tip a little longer or shorter, and drooping
    const tipLen = Array.from({ length: seg + 1 }, () => 0.6 + 0.65 * random());
    tipLen[seg] = tipLen[0];
    for (let i = 0; i < p.count; i++) {
      const vy = p.getY(i);
      if (vy < -h / 2 + 1e-3) {
        const a = Math.atan2(p.getZ(i), p.getX(i));
        const j = tipLen[Math.round(((a / (Math.PI * 2) + 1) % 1) * seg)];
        p.setXYZ(i, Math.cos(a) * r * j, vy - 0.07 * j, Math.sin(a) * r * j);
      }
    }
    cone.rotateY(random() * Math.PI);
    cone.translate((random() - 0.5) * 0.03, y, (random() - 0.5) * 0.03);
    parts.push(cone.toNonIndexed());
  }
  const merged = new THREE.BufferGeometry();
  const all = parts.map((g) => (g.index ? g.toNonIndexed() : g));
  const count = all.reduce((s, g) => s + g.attributes.position.count, 0);
  const pos = new Float32Array(count * 3);
  const up = new Float32Array(count); // 0 at the trunk's foot … 1 at the tip
  let o = 0;
  for (const g of all) {
    const a = g.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < a.count; i++) {
      pos.set([a.getX(i), a.getY(i), a.getZ(i)], (o + i) * 3);
      up[o + i] = a.getY(i) / 1.45;
    }
    o += a.count;
    g.dispose();
  }
  merged.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  merged.setAttribute("aUp", new THREE.BufferAttribute(up, 1));
  merged.computeVertexNormals();
  return merged;
}

/** Where boulders and trees stand: on dry ground, clear of the crystal and the camera's path. */
export function scatter(seed: number, count: number, minBank: number, maxBank: number, zRange: [number, number], clear: number) {
  const random = rng(seed);
  const out: { x: number; z: number; y: number; r: number; s: number }[] = [];
  for (let tries = 0; out.length < count && tries < count * 60; tries++) {
    const x = (random() - 0.5) * 70;
    const z = zRange[0] + random() * (zRange[1] - zRange[0]);
    const d = -riverInside(x, z);
    if (d < minBank || d > maxBank) continue;
    if (Math.hypot(x, z) < clear) continue;
    // keep the corridor in front of the camera open
    if (z > -3 && Math.abs(x) < 4.5) continue;
    out.push({ x, z, y: bankHeight(x, z), r: random(), s: random() });
  }
  return out;
}

export type Cluster = { x: number; z: number; y: number; r: number; n: number; seed: number };

/** Where the mushrooms grow: small clearings on the banks (the grass leaves room for them). */
export function mushroomClusters(count: number): Cluster[] {
  const random = rng(101);
  const out: Cluster[] = [];
  for (let tries = 0; out.length < count && tries < count * 80; tries++) {
    const x = (random() - 0.5) * 30;
    const z = 2 - random() * 16;
    const d = -riverInside(x, z);
    if (d < 0.7 || d > 9) continue;
    if (z > -3 && Math.abs(x) < 4.5) continue;
    if (out.some((c) => Math.hypot(c.x - x, c.z - z) < 2)) continue;
    out.push({ x, z, y: bankHeight(x, z), r: 0.3 + random() * 0.35, n: 3 + Math.floor(random() * 5), seed: random() });
  }
  return out;
}
