import * as THREE from "three";
import { DRACOLoader } from "three/examples/jsm/loaders/DRACOLoader.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { MeshSurfaceSampler } from "three/examples/jsm/math/MeshSurfaceSampler.js";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";

/**
 * The training sets: surface samples of four shapes, one point cloud per class label.
 * Each is centred and scaled to fit a ball of radius R, so the data has roughly unit spread,
 * the scale a variance-preserving schedule is designed for.
 */

export const R = 1.75;

export type ClassDef = { id: string; prompt: string; color: string };
export const CLASSES: ClassDef[] = [
  { id: "car", prompt: "a sports car", color: "#ff5a47" },
  { id: "brick", prompt: "a toy brick", color: "#ffc53d" },
  { id: "planet", prompt: "a ringed planet", color: "#56c2ff" },
  { id: "helix", prompt: "a DNA double helix", color: "#b18cff" },
];
export const K = CLASSES.length;

export type Dataset = {
  /** points sampled uniformly by area, in random order, so any prefix is itself a uniform subset */
  train: Float32Array;
  /** independent samples of the same surface, held out for precision / recall */
  ref: Float32Array;
};

export function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** standard normal pair from two uniforms (Box–Muller) */
export function gaussian(rnd: () => number) {
  const u = 1 - rnd();
  const v = rnd();
  const r = Math.sqrt(-2 * Math.log(u));
  return [r * Math.cos(2 * Math.PI * v), r * Math.sin(2 * Math.PI * v)] as const;
}

const place = (g: THREE.BufferGeometry, m: THREE.Matrix4) => {
  const out = (g.index ? g.toNonIndexed() : g.clone()).applyMatrix4(m);
  for (const k of Object.keys(out.attributes)) if (k !== "position") out.deleteAttribute(k);
  return out;
};

/** a 2×4 brick in LEGO proportions: 8 mm pitch, 9.6 mm tall, 4.8 mm studs 1.7 mm high */
function brick() {
  const parts = [place(new THREE.BoxGeometry(4, 1.2, 2), new THREE.Matrix4())];
  for (let i = 0; i < 4; i++)
    for (let j = 0; j < 2; j++) parts.push(place(new THREE.CylinderGeometry(0.3, 0.3, 0.2125, 28, 1), new THREE.Matrix4().makeTranslation(i - 1.5, 0.6 + 0.10625, j - 0.5)));
  return mergeGeometries(parts)!;
}

/** a globe with two rings and the Cassini Division between them, tilted like Saturn */
function planet() {
  const tilt = new THREE.Matrix4().makeRotationZ(0.42).multiply(new THREE.Matrix4().makeRotationX(-Math.PI / 2));
  return mergeGeometries([
    place(new THREE.SphereGeometry(1, 64, 32), new THREE.Matrix4()),
    place(new THREE.RingGeometry(1.32, 1.86, 128, 2), tilt),
    place(new THREE.RingGeometry(1.96, 2.3, 128, 2), tilt),
  ])!;
}

class Strand extends THREE.Curve<THREE.Vector3> {
  constructor(private at: (u: number, target: THREE.Vector3) => THREE.Vector3) {
    super();
  }
  getPoint(u: number, target = new THREE.Vector3()) {
    return this.at(u, target);
  }
}

/** B-DNA: two backbones offset to make the major and minor grooves, ten base pairs per turn */
function helix() {
  const r = 0.72;
  const h = 3.6;
  const turns = 1.7;
  const groove = Math.PI * 0.72;
  const curve = (phase: number) =>
    new Strand((u, target) => {
      const a = u * turns * Math.PI * 2 + phase;
      return target.set(Math.cos(a) * r, (u - 0.5) * h, Math.sin(a) * r);
    });
  const parts = [place(new THREE.TubeGeometry(curve(0), 220, 0.085, 10), new THREE.Matrix4()), place(new THREE.TubeGeometry(curve(groove), 220, 0.085, 10), new THREE.Matrix4())];
  const pairs = Math.round(turns * 10);
  const up = new THREE.Vector3(0, 1, 0);
  for (let i = 0; i <= pairs; i++) {
    const u = (i + 0.5) / (pairs + 1);
    const a = curve(0).getPoint(u);
    const b = curve(groove).getPoint(u);
    const mid = a.clone().add(b).multiplyScalar(0.5);
    const len = a.distanceTo(b);
    const q = new THREE.Quaternion().setFromUnitVectors(up, b.clone().sub(a).normalize());
    parts.push(place(new THREE.CylinderGeometry(0.035, 0.035, len, 8, 1), new THREE.Matrix4().compose(mid, q, new THREE.Vector3(1, 1, 1))));
  }
  return mergeGeometries(parts)!;
}

/** stand-in for the car if the model can't be fetched */
function knot() {
  return place(new THREE.TorusKnotGeometry(1, 0.28, 220, 18, 2, 3), new THREE.Matrix4());
}

/** the showroom's Ferrari F40, flattened to one position-only mesh in its own frame */
export async function loadCar(url = "/models/cars/ferrari-f40.glb"): Promise<THREE.BufferGeometry | null> {
  try {
    const draco = new DRACOLoader().setDecoderPath("/draco/");
    const loader = new GLTFLoader().setDRACOLoader(draco);
    const gltf = await loader.loadAsync(url);
    draco.dispose();
    gltf.scene.updateMatrixWorld(true);
    const parts: THREE.BufferGeometry[] = [];
    gltf.scene.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh || !mesh.geometry?.attributes.position) return;
      parts.push(place(mesh.geometry, mesh.matrixWorld));
    });
    if (!parts.length) return null;
    const g = mergeGeometries(parts);
    parts.forEach((p) => p.dispose());
    if (!g) return null;
    // the long axis along x, wheels down
    g.computeBoundingBox();
    const s = g.boundingBox!.getSize(new THREE.Vector3());
    if (s.z > s.x) g.applyMatrix4(new THREE.Matrix4().makeRotationY(Math.PI / 2));
    return g;
  } catch {
    return null;
  }
}

/** centre on the bounding box and scale so the farthest point sits at radius R */
function normalise(pts: Float32Array, extra: Float32Array) {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < pts.length; i += 3)
    for (let d = 0; d < 3; d++) {
      min[d] = Math.min(min[d], pts[i + d]);
      max[d] = Math.max(max[d], pts[i + d]);
    }
  const c = min.map((v, d) => (v + max[d]) / 2);
  let r = 0;
  for (let i = 0; i < pts.length; i += 3) r = Math.max(r, Math.hypot(pts[i] - c[0], pts[i + 1] - c[1], pts[i + 2] - c[2]));
  const k = R / r;
  for (const arr of [pts, extra]) for (let i = 0; i < arr.length; i += 3) for (let d = 0; d < 3; d++) arr[i + d] = (arr[i + d] - c[d]) * k;
}

function sampleSurface(g: THREE.BufferGeometry, n: number, nRef: number, seed: number): Dataset {
  const sampler = new MeshSurfaceSampler(new THREE.Mesh(g));
  // seeded, so every visit trains on the same points (three's type definitions predate this method)
  (sampler as unknown as { setRandomGenerator: (f: () => number) => void }).setRandomGenerator(mulberry32(seed));
  sampler.build();
  const p = new THREE.Vector3();
  const draw = (count: number) => {
    const out = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      sampler.sample(p);
      out[i * 3] = p.x;
      out[i * 3 + 1] = p.y;
      out[i * 3 + 2] = p.z;
    }
    return out;
  };
  const train = draw(n);
  const ref = draw(nRef);
  normalise(train, ref);
  return { train, ref };
}

/** every class's training and held-out points; `car` is null when the model failed to load */
export function buildDatasets(car: THREE.BufferGeometry | null, n: number, nRef: number) {
  const geos = [car ?? knot(), brick(), planet(), helix()];
  const sets = geos.map((g, i) => sampleSurface(g, n, nRef, 0x5eed + i * 7919));
  geos.forEach((g) => g.dispose());
  return sets;
}
