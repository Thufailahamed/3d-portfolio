import * as THREE from "three";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import type { CarSpec } from "./sim";
import { cabinTexture, flakeNormal, liveryTexture, type Livery } from "./textures";
import { RIDE } from "./units";

/**
 * 1:64 die-cast cars, built from profiles. The body is a loft: cross-sections (rounded-top,
 * flat-bottomed superellipses) swept nose to tail, their width, roof line and sill line following
 * keyframed curves — the sill rises over each axle, which is what cuts the wheel arches. The
 * greenhouse is a second loft on top. Wheels are chrome five-spokes on plastic tyres, bigger at
 * the back, the classic stance.
 */

type Keys = [number, number][];
type Profile = { width: Keys; top: Keys; bottom: Keys };

export type Model = {
  name: string;
  tag: string;
  /** body length (cm); profiles use z from -1 (tail) to +1 (nose) of half that */
  len: number;
  mass: number;
  /** frontal drag relative to a plain coupé (wings, racks and blowers cost), and axle friction relative to a good set */
  aero: number;
  bearing: number;
  body: Profile;
  /** how square the sections are (higher = boxier) */
  squareTop: number;
  cabin: { z0: number; z1: number; roof: Keys; roofW: number; ws: number; rs: number; b: number };
  wheels: { front: { z: number; r: number; w: number }; rear: { z: number; r: number; w: number }; track: number };
  paint: { color: string; metal: number; rough: number };
  livery: Livery;
  extras: Extra[];
  stats: { speed: number; weight: number; style: number };
};

type Extra =
  | { k: "scoop"; z: number; w: number; h: number; len: number }
  | { k: "wing"; z: number; h: number; w: number; chord: number }
  | { k: "lip"; z: number; h: number; w: number }
  | { k: "blower"; z: number; h: number }
  | { k: "pipes"; z: number; y: number; x: number; n: number }
  | { k: "stacks"; z: number; y: number; x: number }
  | { k: "rack"; z0: number; z1: number; h: number }
  | { k: "bed"; z0: number; z1: number; floor: number; wall: number }
  | { k: "fin"; z0: number; z1: number; h: number };

export const MODELS: Model[] = [
  {
    name: "Torque Twin",
    tag: "Muscle · candy red",
    len: 7.6,
    mass: 38,
    aero: 1.05,
    bearing: 1.0,
    body: {
      width: [[-1, 1.34], [-0.86, 1.5], [-0.5, 1.56], [0.4, 1.55], [0.86, 1.46], [1, 1.28]],
      top: [[-1, 1.5], [-0.88, 1.72], [-0.45, 1.78], [0, 1.74], [0.7, 1.66], [0.95, 1.5], [1, 1.28]],
      bottom: [[-1, 0.78], [-0.85, 1.05], [-0.62, 1.38], [-0.38, 1.02], [-0.26, 0.52], [0.3, 0.52], [0.43, 1.0], [0.63, 1.24], [0.84, 0.98], [1, 0.72]],
    },
    squareTop: 3,
    cabin: { z0: -0.5, z1: 0.28, roof: [[-0.5, 1.7], [-0.3, 2.34], [0.0, 2.4], [0.1, 2.38], [0.28, 1.68]], roofW: 1.12, ws: 0.24, rs: 0.26, b: 0.55 },
    wheels: { front: { z: 0.63, r: 0.6, w: 0.62 }, rear: { z: -0.62, r: 0.74, w: 0.86 }, track: 1.18 },
    paint: { color: "#c8102e", metal: 0.7, rough: 0.26 },
    livery: { base: "#c8102e", stripes: { color: "#f6f2ea", width: 0.045, gap: 0.03, edge: "#141414" } },
    extras: [
      { k: "scoop", z: 0.52, w: 0.62, h: 0.3, len: 1.4 },
      { k: "lip", z: -0.98, h: 0.18, w: 2.6 },
      { k: "pipes", z: -1.0, y: 0.62, x: 0.82, n: 2 },
    ],
    stats: { speed: 4, weight: 4, style: 4 },
  },
  {
    name: "Vortex GT",
    tag: "Wedge supercar · spectra blue",
    len: 7.9,
    mass: 32,
    aero: 0.9,
    bearing: 0.92,
    body: {
      width: [[-1, 1.46], [-0.8, 1.64], [-0.3, 1.66], [0.4, 1.6], [0.85, 1.42], [1, 1.1]],
      top: [[-1, 1.55], [-0.75, 1.64], [-0.2, 1.56], [0.4, 1.3], [0.8, 1.02], [1, 0.82]],
      bottom: [[-1, 0.86], [-0.84, 1.08], [-0.6, 1.3], [-0.38, 1.02], [-0.26, 0.46], [0.3, 0.46], [0.42, 0.94], [0.62, 1.16], [0.82, 0.86], [1, 0.6]],
    },
    squareTop: 2.6,
    cabin: { z0: -0.42, z1: 0.5, roof: [[-0.42, 1.58], [-0.18, 2.02], [0.04, 2.06], [0.18, 1.98], [0.5, 1.2]], roofW: 1.08, ws: 0.36, rs: 0.22, b: 0.52 },
    wheels: { front: { z: 0.62, r: 0.58, w: 0.62 }, rear: { z: -0.6, r: 0.7, w: 0.9 }, track: 1.26 },
    paint: { color: "#1e5bff", metal: 0.85, rough: 0.22 },
    livery: { base: "#1e5bff", side: { color: "#0b1e5c", from: 22, to: 34 }, logo: { text: "VORTEX", at: 0.42, color: "#e8f0ff" } },
    extras: [
      { k: "wing", z: -0.9, h: 2.25, w: 3.0, chord: 0.8 },
      { k: "pipes", z: -1.0, y: 0.72, x: 0.3, n: 2 },
    ],
    stats: { speed: 5, weight: 2, style: 5 },
  },
  {
    name: "Rod Rage",
    tag: "Hot rod · gloss black, flames",
    len: 7.4,
    mass: 42,
    aero: 1.35,
    bearing: 1.05,
    body: {
      width: [[-1, 1.28], [-0.8, 1.48], [-0.3, 1.5], [0.05, 1.32], [0.15, 0.82], [0.85, 0.78], [1, 0.7]],
      top: [[-1, 1.5], [-0.85, 1.76], [-0.3, 1.82], [0.05, 1.8], [0.12, 1.42], [0.8, 1.34], [1, 1.22]],
      bottom: [[-1, 0.86], [-0.84, 1.2], [-0.6, 1.58], [-0.36, 1.2], [-0.22, 0.6], [0.4, 0.6], [0.55, 0.7], [0.8, 0.66], [1, 0.62]],
    },
    squareTop: 3.4,
    cabin: { z0: -0.62, z1: 0.06, roof: [[-0.62, 1.74], [-0.5, 2.2], [-0.15, 2.22], [-0.04, 2.18], [0.06, 1.74]], roofW: 1.14, ws: 0.18, rs: 0.18, b: 0.5 },
    wheels: { front: { z: 0.72, r: 0.48, w: 0.42 }, rear: { z: -0.6, r: 0.84, w: 1.0 }, track: 1.24 },
    paint: { color: "#0d0d10", metal: 0.4, rough: 0.16 },
    livery: { base: "#0d0d10", flames: { from: "#ffe14a", to: "#ff3b00", edge: "#ffffff" } },
    extras: [
      { k: "blower", z: 0.45, h: 1.34 },
      { k: "stacks", z: 0.3, y: 1.0, x: 0.95 },
    ],
    stats: { speed: 3, weight: 5, style: 5 },
  },
  {
    name: "Dune Dash",
    tag: "Rally hatch · white, number 64",
    len: 6.8,
    mass: 34,
    aero: 1.22,
    bearing: 1.1,
    body: {
      width: [[-1, 1.42], [-0.85, 1.52], [0.5, 1.52], [0.88, 1.44], [1, 1.3]],
      top: [[-1, 1.84], [-0.9, 1.92], [0.2, 1.88], [0.75, 1.76], [0.96, 1.6], [1, 1.42]],
      bottom: [[-1, 0.92], [-0.84, 1.16], [-0.6, 1.38], [-0.34, 1.1], [-0.22, 0.64], [0.28, 0.64], [0.42, 1.08], [0.62, 1.32], [0.85, 1.08], [1, 0.84]],
    },
    squareTop: 3.8,
    cabin: { z0: -0.94, z1: 0.32, roof: [[-0.94, 2.6], [-0.86, 2.7], [0.0, 2.72], [0.1, 2.68], [0.32, 1.84]], roofW: 1.24, ws: 0.2, rs: 0.04, b: 0.42 },
    wheels: { front: { z: 0.62, r: 0.62, w: 0.6 }, rear: { z: -0.6, r: 0.66, w: 0.66 }, track: 1.16 },
    paint: { color: "#f3f3ef", metal: 0.3, rough: 0.28 },
    livery: { base: "#f3f3ef", side: { color: "#18a558", from: 28, to: 46 }, number: { n: "64", at: 0.48, ring: "#ffffff", ink: "#101010" }, stripes: { color: "#18a558", width: 0.06, gap: 0.04 } },
    extras: [
      { k: "rack", z0: -0.75, z1: 0.0, h: 2.72 },
      { k: "lip", z: -0.96, h: 0.14, w: 2.6 },
    ],
    stats: { speed: 3, weight: 3, style: 4 },
  },
  {
    name: "Apex 64",
    tag: "Endurance racer · gold",
    len: 8.0,
    mass: 33,
    aero: 0.8,
    bearing: 0.9,
    body: {
      width: [[-1, 1.5], [-0.75, 1.62], [-0.3, 1.66], [0.35, 1.62], [0.85, 1.5], [1, 1.2]],
      top: [[-1, 1.46], [-0.6, 1.52], [-0.1, 1.48], [0.45, 1.34], [0.82, 1.14], [1, 0.84]],
      bottom: [[-1, 0.7], [-0.84, 1.04], [-0.62, 1.24], [-0.4, 0.98], [-0.28, 0.42], [0.32, 0.42], [0.44, 0.92], [0.64, 1.12], [0.84, 0.86], [1, 0.56]],
    },
    squareTop: 2.4,
    cabin: { z0: -0.3, z1: 0.42, roof: [[-0.3, 1.5], [-0.1, 1.98], [0.08, 2.02], [0.2, 1.96], [0.42, 1.3]], roofW: 1.0, ws: 0.34, rs: 0.26, b: 0.55 },
    wheels: { front: { z: 0.64, r: 0.6, w: 0.66 }, rear: { z: -0.62, r: 0.66, w: 0.8 }, track: 1.26 },
    paint: { color: "#d4a017", metal: 0.92, rough: 0.2 },
    livery: { base: "#d4a017", side: { color: "#141414", from: 14, to: 30 }, number: { n: "7", at: 0.5, ring: "#ffffff", ink: "#c8102e" }, logo: { text: "APEX", at: 0.2, color: "#141414" } },
    extras: [
      { k: "fin", z0: -1.0, z1: -0.25, h: 0.5 },
      { k: "wing", z: -0.93, h: 1.95, w: 3.1, chord: 0.7 },
      { k: "scoop", z: -0.05, w: 0.38, h: 0.26, len: 0.9 },
    ],
    stats: { speed: 5, weight: 2, style: 4 },
  },
  {
    name: "Haul Hammer",
    tag: "Pickup · lime metallic",
    len: 7.8,
    mass: 46,
    aero: 1.3,
    bearing: 1.0,
    body: {
      width: [[-1, 1.48], [-0.85, 1.56], [0.6, 1.56], [0.9, 1.48], [1, 1.34]],
      top: [[-1, 1.92], [-0.9, 2.0], [0.12, 2.0], [0.7, 1.94], [0.94, 1.8], [1, 1.56]],
      bottom: [[-1, 0.98], [-0.86, 1.24], [-0.62, 1.48], [-0.38, 1.2], [-0.24, 0.72], [0.3, 0.72], [0.44, 1.18], [0.64, 1.44], [0.86, 1.18], [1, 0.9]],
    },
    squareTop: 4.2,
    cabin: { z0: 0.0, z1: 0.42, roof: [[0.0, 2.9], [0.04, 2.98], [0.18, 3.0], [0.26, 2.96], [0.42, 2.0]], roofW: 1.3, ws: 0.38, rs: 0.04, b: 0.3 },
    wheels: { front: { z: 0.64, r: 0.7, w: 0.72 }, rear: { z: -0.62, r: 0.74, w: 0.76 }, track: 1.18 },
    paint: { color: "#7bd31c", metal: 0.75, rough: 0.24 },
    livery: { base: "#7bd31c", side: { color: "#1b1b1b", from: 18, to: 26 }, logo: { text: "HAMMER", at: 0.3, color: "#1b1b1b" } },
    extras: [{ k: "bed", z0: -0.98, z1: -0.02, floor: 1.32, wall: 2.0 }],
    stats: { speed: 2, weight: 5, style: 3 },
  },
];

/** What the physics needs to know about a model: weight, drag, axles, and where its wheels touch down. */
export function specOf(m: Model): CarSpec {
  const hl = m.len / 2;
  return { mass: m.mass, aero: m.aero, bearing: m.bearing, front: { z: m.wheels.front.z * hl, r: m.wheels.front.r }, rear: { z: m.wheels.rear.z * hl, r: m.wheels.rear.r } };
}
export const CAR_SPECS = MODELS.map(specOf);

/** Cubic interpolation through keyframes (Catmull–Rom tangents, clamped at the ends). */
export function sample(keys: Keys, z: number) {
  if (z <= keys[0][0]) return keys[0][1];
  const n = keys.length;
  if (z >= keys[n - 1][0]) return keys[n - 1][1];
  let i = 0;
  while (i < n - 2 && keys[i + 1][0] < z) i++;
  const [z0, v0] = keys[i];
  const [z1, v1] = keys[i + 1];
  const vm = i > 0 ? keys[i - 1][1] : v0;
  const zm = i > 0 ? keys[i - 1][0] : z0 - (z1 - z0);
  const vp = i + 2 < n ? keys[i + 2][1] : v1;
  const zp = i + 2 < n ? keys[i + 2][0] : z1 + (z1 - z0);
  const h = z1 - z0;
  const t = (z - z0) / h;
  const m0 = ((v1 - vm) / (z1 - zm)) * h;
  const m1 = ((vp - v0) / (zp - z0)) * h;
  const t2 = t * t;
  const t3 = t2 * t;
  return (2 * t3 - 3 * t2 + 1) * v0 + (t3 - 2 * t2 + t) * m0 + (-2 * t3 + 3 * t2) * v1 + (t3 - t2) * m1;
}

const spow = (x: number, p: number) => Math.sign(x) * Math.pow(Math.abs(x), p);

/**
 * A lofted tube: at each station along z, a ring from `section(z, phi)` (phi from the bottom,
 * round the left flank, over the top and down the right). Capped at both ends. UVs: u along z
 * (0 tail → 1 nose), v round the ring.
 */
function loft(z0: number, z1: number, stations: number, segs: number, section: (z: number, phi: number) => [number, number]) {
  const pos: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  for (let i = 0; i <= stations; i++) {
    // stations bunch up towards the ends, where the shape changes fastest
    const t = i / stations;
    const tt = 0.5 - 0.5 * Math.cos(t * Math.PI);
    const z = z0 + (z1 - z0) * (0.35 * t + 0.65 * tt);
    for (let j = 0; j <= segs; j++) {
      const phi = -Math.PI / 2 + (j / segs) * Math.PI * 2;
      const [x, y] = section(z, phi);
      pos.push(x, y, z);
      uv.push((z - z0) / (z1 - z0), j / segs);
    }
  }
  const row = segs + 1;
  for (let i = 0; i < stations; i++)
    for (let j = 0; j < segs; j++) {
      const a = i * row + j;
      const b = a + row;
      idx.push(a, a + 1, b, b, a + 1, b + 1);
    }
  // end caps: a fan from each ring's centre
  for (const [i, flip] of [
    [0, true],
    [stations, false],
  ] as const) {
    let cx = 0;
    let cy = 0;
    for (let j = 0; j < segs; j++) {
      cx += pos[(i * row + j) * 3];
      cy += pos[(i * row + j) * 3 + 1];
    }
    const c = pos.length / 3;
    pos.push(cx / segs, cy / segs, pos[i * row * 3 + 2]);
    uv.push(i ? 1 : 0, 0.5);
    for (let j = 0; j < segs; j++) {
      const a = i * row + j;
      if (flip) idx.push(c, a + 1, a);
      else idx.push(c, a, a + 1);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** Shared finishes: chrome, tyre plastic, the unpainted zamac base, lamp lenses. */
export type CarMaterials = {
  chrome: THREE.MeshStandardMaterial;
  tyre: THREE.MeshStandardMaterial;
  base: THREE.MeshStandardMaterial;
  black: THREE.MeshStandardMaterial;
  head: THREE.MeshStandardMaterial;
  tail: THREE.MeshStandardMaterial;
  flake: THREE.Texture;
};

export function carMaterials(): CarMaterials {
  return {
    chrome: new THREE.MeshStandardMaterial({ color: "#f1f3f6", metalness: 1, roughness: 0.07, envMapIntensity: 1.5 }),
    tyre: new THREE.MeshStandardMaterial({ color: "#151617", metalness: 0, roughness: 0.55 }),
    base: new THREE.MeshStandardMaterial({ color: "#9ea3a8", metalness: 0.85, roughness: 0.42 }),
    black: new THREE.MeshStandardMaterial({ color: "#121316", metalness: 0.2, roughness: 0.5 }),
    head: new THREE.MeshStandardMaterial({ color: "#fff8e6", emissive: new THREE.Color("#fff1cf"), emissiveIntensity: 0.4, roughness: 0.1, metalness: 0.2 }),
    tail: new THREE.MeshStandardMaterial({ color: "#a3120c", emissive: new THREE.Color("#ff2a10"), emissiveIntensity: 0.25, roughness: 0.15 }),
    flake: flakeNormal(),
  };
}

const wheelCache = new Map<string, { tyre: THREE.BufferGeometry; rim: THREE.BufferGeometry }>();

/**
 * One wheel, axle along x: a plastic tyre (rounded, with a tread lip) and a chrome five-spoke
 * face pressed into it.
 */
function wheelGeometry(r: number, w: number) {
  const key = `${r}|${w}`;
  const hit = wheelCache.get(key);
  if (hit) return hit;
  // the tyre: a lathe around x (built round y, then turned)
  const hw = w / 2;
  const ri = r * 0.68;
  const pts = [
    new THREE.Vector2(ri, -hw),
    new THREE.Vector2(r * 0.93, -hw),
    new THREE.Vector2(r * 0.99, -hw * 0.82),
    new THREE.Vector2(r, -hw * 0.4),
    new THREE.Vector2(r, hw * 0.4),
    new THREE.Vector2(r * 0.99, hw * 0.82),
    new THREE.Vector2(r * 0.93, hw),
    new THREE.Vector2(ri, hw),
    new THREE.Vector2(ri, -hw),
  ];
  const tyre = new THREE.LatheGeometry(pts, 28);
  tyre.rotateZ(Math.PI / 2);
  // the rim: a disc with five spoke windows, extruded thin, on both faces
  const shape = new THREE.Shape();
  shape.absarc(0, 0, ri * 1.02, 0, Math.PI * 2, false);
  for (let i = 0; i < 5; i++) {
    const a0 = (i / 5) * Math.PI * 2 + 0.2;
    const a1 = a0 + Math.PI * 2 * 0.12;
    const hole = new THREE.Path();
    const rin = ri * 0.36;
    const rout = ri * 0.84;
    hole.moveTo(Math.cos(a0) * rin, Math.sin(a0) * rin);
    hole.lineTo(Math.cos(a0 - 0.12) * rout, Math.sin(a0 - 0.12) * rout);
    hole.absarc(0, 0, rout, a0 - 0.12, a1 + 0.12, false);
    hole.lineTo(Math.cos(a1) * rin, Math.sin(a1) * rin);
    hole.absarc(0, 0, rin, a1, a0, true);
    shape.holes.push(hole);
  }
  const face = new THREE.ExtrudeGeometry(shape, { depth: w * 0.18, bevelEnabled: true, bevelThickness: 0.03, bevelSize: 0.025, bevelSegments: 1, curveSegments: 10 });
  face.rotateY(Math.PI / 2);
  // the centre cap, and a dark hub behind the spokes so you can't see through
  const cap = new THREE.CylinderGeometry(ri * 0.26, ri * 0.3, w * 0.24, 14);
  cap.rotateZ(Math.PI / 2);
  const outer = face.clone().translate(hw - w * 0.2, 0, 0);
  const inner = face.clone().rotateY(Math.PI).translate(-hw + w * 0.2, 0, 0);
  const flat = (g: THREE.BufferGeometry) => (g.index ? g.toNonIndexed() : g);
  const rim = mergeGeometries([flat(outer), flat(inner), flat(cap.translate(hw - w * 0.12, 0, 0)), flat(cap.clone().translate(-(w - w * 0.24), 0, 0))]);
  face.dispose();
  const out = { tyre, rim: rim! };
  wheelCache.set(key, out);
  return out;
}

export type BuiltCar = {
  root: THREE.Group;
  wheels: THREE.Group[];
  setNight: (k: number) => void;
  dispose: () => void;
};

/**
 * Build one car. Its origin is where the physics body is: centred on the car, RIDE above the
 * ground. Forward is +z, up +y.
 */
export function buildCar(m: Model, mats: CarMaterials, aniso: number): BuiltCar {
  const root = new THREE.Group();
  const car = new THREE.Group();
  car.position.y = -RIDE;
  root.add(car);
  const hl = m.len / 2;
  const own: THREE.Material[] = [];
  const geos: THREE.BufferGeometry[] = [];

  // —— paint ——
  const livery = liveryTexture(m.livery, aniso);
  const flake = mats.flake.clone();
  flake.repeat.set(9, 3);
  flake.needsUpdate = true;
  const paint = new THREE.MeshPhysicalMaterial({
    color: "#ffffff",
    map: livery,
    metalness: m.paint.metal,
    roughness: m.paint.rough,
    clearcoat: 1,
    clearcoatRoughness: 0.03,
    normalMap: flake,
    normalScale: new THREE.Vector2(0.18, 0.18),
    envMapIntensity: 1.25,
  });
  own.push(paint);

  // —— the body ——
  const nTop = m.squareTop;
  const body = loft(-hl, hl, 46, 40, (z, phi) => {
    const zn = z / hl;
    const w = sample(m.body.width, zn);
    const top = sample(m.body.top, zn);
    const bot = Math.min(sample(m.body.bottom, zn), top - 0.18);
    const cy = (top + bot) / 2;
    const hh = (top - bot) / 2;
    const c = Math.cos(phi);
    const s = Math.sin(phi);
    // rounded on top, nearly flat underneath; the flanks tuck in a touch above the waist
    const p = s > 0 ? 2 / nTop : 2 / 7;
    const x = spow(c, p) * w * (s > 0 ? 1 - 0.07 * s * s : 1);
    const y = cy + spow(s, p) * hh;
    return [x, y];
  });
  geos.push(body);
  const bodyMesh = new THREE.Mesh(body, paint);
  bodyMesh.castShadow = true;
  bodyMesh.receiveShadow = true;
  car.add(bodyMesh);

  // —— the greenhouse ——
  const cab = m.cabin;
  const cabinMat = new THREE.MeshPhysicalMaterial({
    color: "#ffffff",
    map: cabinTexture(m.paint.color, { ws: cab.ws, rs: cab.rs, b: cab.b }, aniso),
    metalness: 0.35,
    roughness: 0.08,
    clearcoat: 1,
    clearcoatRoughness: 0.02,
    envMapIntensity: 1.5,
  });
  own.push(cabinMat);
  const cz0 = cab.z0 * hl;
  const cz1 = cab.z1 * hl;
  const cabin = loft(cz0, cz1, 30, 32, (z, phi) => {
    const zn = z / hl;
    const belt = sample(m.body.top, zn) - 0.12;
    const roof = Math.max(belt + 0.05, sample(cab.roof, zn));
    const wb = sample(m.body.width, zn) * 0.76;
    const c = Math.cos(phi);
    const s = Math.sin(phi);
    const ys = spow(s, 2 / 3);
    const t = 0.5 + 0.5 * ys;
    const y = belt + (roof - belt) * t;
    // the glass leans in towards the roof (tumblehome)
    const w = wb + (cab.roofW - wb) * Math.pow(t, 1.4);
    return [spow(c, 2 / 3) * w, y];
  });
  geos.push(cabin);
  const cabMesh = new THREE.Mesh(cabin, cabinMat);
  cabMesh.castShadow = true;
  car.add(cabMesh);

  // —— the base: unpainted metal chassis plate underneath ——
  const baseW = m.wheels.track * 2 - Math.max(m.wheels.front.w, m.wheels.rear.w) - 0.1;
  const base = new RoundedBoxGeometry(baseW, 0.32, m.len * 0.94, 2, 0.1);
  base.translate(0, 0.42, 0);
  geos.push(base);
  car.add(new THREE.Mesh(base, mats.base));

  // —— lamps ——
  const lampGeo = new THREE.CylinderGeometry(0.2, 0.2, 0.08, 16);
  lampGeo.rotateX(Math.PI / 2);
  geos.push(lampGeo);
  const noseY = (sample(m.body.top, 0.97) + sample(m.body.bottom, 0.97)) / 2;
  const tailY = (sample(m.body.top, -0.97) + sample(m.body.bottom, -0.97)) / 2 + 0.08;
  const noseW = sample(m.body.width, 0.96);
  const tailW = sample(m.body.width, -0.96);
  for (const sx of [-1, 1]) {
    const h = new THREE.Mesh(lampGeo, mats.head);
    h.position.set(sx * noseW * 0.6, noseY + 0.05, hl + 0.004);
    h.scale.set(1, 0.8, 1);
    car.add(h);
    const t = new THREE.Mesh(lampGeo, mats.tail);
    t.position.set(sx * tailW * 0.64, tailY, -hl - 0.004);
    t.scale.set(1.25, 0.6, 1);
    car.add(t);
  }
  // a dark grille between the headlamps
  const grille = new RoundedBoxGeometry(noseW * 0.7, 0.26, 0.1, 1, 0.04);
  grille.translate(0, noseY - 0.12, hl);
  geos.push(grille);
  car.add(new THREE.Mesh(grille, mats.black));

  // —— wheels ——
  const wheels: THREE.Group[] = [];
  for (const [ax, front] of [
    [m.wheels.front, true],
    [m.wheels.rear, false],
  ] as const) {
    const { tyre, rim } = wheelGeometry(ax.r, ax.w);
    for (const sx of [-1, 1]) {
      const g = new THREE.Group();
      g.position.set(sx * m.wheels.track, ax.r, ax.z * hl);
      const t = new THREE.Mesh(tyre, mats.tyre);
      t.castShadow = true;
      g.add(t);
      g.add(new THREE.Mesh(rim, mats.chrome));
      g.userData.front = front;
      g.userData.wheel = true;
      // each wheel turns at its own rate: the big rear ones more slowly than the fronts
      g.userData.r = ax.r;
      car.add(g);
      wheels.push(g);
    }
    // the axle
    const axle = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, m.wheels.track * 2, 8).rotateZ(Math.PI / 2), mats.base);
    axle.position.set(0, ax.r, ax.z * hl);
    geos.push(axle.geometry);
    car.add(axle);
  }

  // —— model details ——
  for (const e of m.extras) addExtra(e, m, car, paint, mats, geos);

  car.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (mesh.isMesh) mesh.castShadow = true;
  });

  return {
    root,
    wheels,
    setNight: () => {},
    dispose: () => {
      for (const g of geos) g.dispose();
      for (const mt of own) {
        for (const v of Object.values(mt)) if (v instanceof THREE.Texture && v !== mats.flake) v.dispose();
        mt.dispose();
      }
    },
  };
}

function addExtra(e: Extra, m: Model, car: THREE.Group, paint: THREE.Material, mats: CarMaterials, geos: THREE.BufferGeometry[]) {
  const hl = m.len / 2;
  const add = (g: THREE.BufferGeometry, mat: THREE.Material, x = 0, y = 0, z = 0) => {
    geos.push(g);
    const mesh = new THREE.Mesh(g, mat);
    mesh.position.set(x, y, z);
    car.add(mesh);
    return mesh;
  };
  switch (e.k) {
    case "scoop": {
      const top = sample(m.body.top, e.z);
      const g = new RoundedBoxGeometry(e.w, e.h, e.len, 2, Math.min(e.h, e.w) * 0.4);
      add(g, paint, 0, top + e.h / 2 - 0.08, e.z * hl);
      const mouth = new RoundedBoxGeometry(e.w * 0.8, e.h * 0.55, 0.06, 1, 0.03);
      add(mouth, mats.black, 0, top + e.h * 0.45, e.z * hl + e.len / 2);
      break;
    }
    case "wing": {
      const blade = new RoundedBoxGeometry(e.w, 0.1, e.chord, 2, 0.04);
      add(blade, paint, 0, e.h, e.z * hl);
      for (const sx of [-1, 1]) {
        const top = sample(m.body.top, e.z);
        const strut = new THREE.BoxGeometry(0.1, e.h - top + 0.05, e.chord * 0.6);
        add(strut, mats.black, sx * e.w * 0.32, (e.h + top) / 2, e.z * hl);
        const plate = new RoundedBoxGeometry(0.08, 0.5, e.chord * 1.15, 1, 0.03);
        add(plate, paint, sx * e.w / 2, e.h - 0.1, e.z * hl);
      }
      break;
    }
    case "lip": {
      const top = sample(m.body.top, e.z);
      const g = new RoundedBoxGeometry(e.w, e.h, 0.32, 1, 0.05);
      add(g, paint, 0, top + e.h / 2, e.z * hl + 0.1).rotation.x = -0.35;
      break;
    }
    case "blower": {
      // a supercharger on the exposed engine: polished case, intake scoop, chrome belt cover
      const block = new RoundedBoxGeometry(1.1, 0.7, 1.7, 2, 0.12);
      add(block, mats.chrome, 0, e.h + 0.2, e.z * hl);
      const fins = new RoundedBoxGeometry(0.85, 0.55, 1.25, 2, 0.1);
      add(fins, mats.black, 0, e.h + 0.72, e.z * hl);
      const scoop = new RoundedBoxGeometry(0.9, 0.5, 0.75, 2, 0.12);
      add(scoop, mats.chrome, 0, e.h + 1.18, e.z * hl + 0.1);
      const mouth = new RoundedBoxGeometry(0.7, 0.3, 0.06, 1, 0.04);
      add(mouth, mats.black, 0, e.h + 1.2, e.z * hl + 0.49);
      // a radiator grille out front
      const rad = new RoundedBoxGeometry(1.0, 0.9, 0.18, 2, 0.06);
      add(rad, mats.chrome, 0, 1.15, hl * 0.95);
      break;
    }
    case "stacks": {
      for (const sx of [-1, 1])
        for (let i = 0; i < 3; i++) {
          const g = new THREE.CylinderGeometry(0.11, 0.13, 0.6, 10);
          const mesh = add(g, mats.chrome, sx * e.x, e.y + 0.3, e.z * hl - i * 0.42);
          mesh.rotation.z = sx * 0.55;
        }
      break;
    }
    case "pipes": {
      for (let i = 0; i < e.n; i++)
        for (const sx of [-1, 1]) {
          const g = new THREE.CylinderGeometry(0.12, 0.12, 0.5, 12);
          g.rotateX(Math.PI / 2);
          add(g, mats.chrome, sx * (e.x + i * 0.28), e.y, e.z * hl);
        }
      break;
    }
    case "rack": {
      const len = (e.z1 - e.z0) * hl;
      const z = ((e.z0 + e.z1) / 2) * hl;
      for (const sx of [-1, 1]) add(new THREE.BoxGeometry(0.08, 0.1, len), mats.black, sx * 0.95, e.h + 0.08, z);
      for (let i = 0; i < 3; i++) add(new THREE.BoxGeometry(1.95, 0.07, 0.07), mats.black, 0, e.h + 0.12, e.z0 * hl + (len * (i + 0.5)) / 3);
      // a light pod with four spot lamps, facing forward
      add(new RoundedBoxGeometry(2.0, 0.34, 0.3, 1, 0.06), mats.black, 0, e.h + 0.32, e.z1 * hl);
      for (let i = 0; i < 4; i++) {
        const lg = new THREE.CylinderGeometry(0.13, 0.13, 0.08, 14);
        lg.rotateX(Math.PI / 2);
        add(lg, mats.head, -0.72 + i * 0.48, e.h + 0.32, e.z1 * hl + 0.17);
      }
      break;
    }
    case "bed": {
      const len = (e.z1 - e.z0) * hl;
      const z = ((e.z0 + e.z1) / 2) * hl;
      const w = sample(m.body.width, (e.z0 + e.z1) / 2);
      // walls up from the bed floor, and a ribbed liner
      for (const sx of [-1, 1]) add(new RoundedBoxGeometry(0.16, e.wall - e.floor + 0.6, len, 1, 0.05), paint, sx * (w - 0.1), (e.wall + e.floor - 0.6) / 2 + 0.3, z);
      add(new RoundedBoxGeometry(w * 2 - 0.1, e.wall - e.floor + 0.6, 0.16, 1, 0.05), paint, 0, (e.wall + e.floor - 0.6) / 2 + 0.3, e.z0 * hl + 0.05);
      add(new RoundedBoxGeometry(w * 2 - 0.1, e.wall - e.floor + 0.6, 0.12, 1, 0.04), paint, 0, (e.wall + e.floor - 0.6) / 2 + 0.3, e.z1 * hl);
      add(new THREE.BoxGeometry(w * 2 - 0.3, 0.06, len - 0.2), mats.black, 0, e.floor + 0.62, z);
      break;
    }
    case "fin": {
      const len = (e.z1 - e.z0) * hl;
      const z = ((e.z0 + e.z1) / 2) * hl;
      const top = sample(m.body.top, (e.z0 + e.z1) / 2);
      const g = new RoundedBoxGeometry(0.08, e.h, len, 1, 0.03);
      add(g, paint, 0, top + e.h / 2 - 0.05, z);
      break;
    }
  }
}
