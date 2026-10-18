import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { pieceGeometry } from "./geometry";
import { C, PLATE } from "./units";

/**
 * Shared finishes. `plastic` is ABS that takes its colour from the vertices, so a whole car body
 * (every colour on it) is one draw call; the rest are the bits that shine, glow or let light through.
 */
export type CarMaterials = {
  plastic: THREE.Material;
  glass: THREE.Material;
  chrome: THREE.Material;
  head: THREE.Material;
  tail: THREE.Material;
  tyre: THREE.Material;
  beaconRed: THREE.Material;
  beaconBlue: THREE.Material;
  beam: THREE.Material;
  pool: THREE.Material;
};

/** The models in the traffic (a car's `style` picks one). */
export const CAR_MODELS = ["sports", "hatch", "police", "taxi", "van", "pickup"] as const;
export type CarModel = (typeof CAR_MODELS)[number];

const WHEEL_R = 0.72;
const WHEEL_W = 0.6;
const WHEEL_X = 2.6;
/** wheels ride just outboard of the four-wide body, under arched mudguards */
const WHEEL_Z = 2.3;
const P = PLATE;
/** the car's floor (origin is the middle of its 8 × 4 × 4 body; the ground is at -2) */
const Y0 = -1.45;
const C1 = Y0 + P;
const DRIVERS = [C.red, C.blue, C.darkTurquoise, C.white, C.orange, C.darkGreen];
const SKIN = C.yellow;
const TRIM = C.darkBluishGray;
const GREY = C.lightBluishGray;

type Geo = THREE.BufferGeometry;

/** Collects parts by finish, then merges each finish into a single mesh. */
class Kit {
  private parts = new Map<THREE.Material, Geo[]>();
  private m = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private e = new THREE.Euler();

  add(geo: Geo, mat: THREE.Material, x: number, y: number, z: number, color = "#ffffff", rx = 0, ry = 0, rz = 0) {
    const g = geo.index ? geo.toNonIndexed() : geo.clone();
    for (const name of Object.keys(g.attributes)) if (!["position", "normal", "uv"].includes(name)) g.deleteAttribute(name);
    if (!g.attributes.uv) g.setAttribute("uv", new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
    g.clearGroups();
    const c = new THREE.Color(color);
    const col = new Float32Array(g.attributes.position.count * 3);
    for (let i = 0; i < col.length; i += 3) col.set([c.r, c.g, c.b], i);
    g.setAttribute("color", new THREE.BufferAttribute(col, 3));
    this.q.setFromEuler(this.e.set(rx, ry, rz));
    g.applyMatrix4(this.m.compose(new THREE.Vector3(x, y, z), this.q, new THREE.Vector3(1, 1, 1)));
    if (!this.parts.has(mat)) this.parts.set(mat, []);
    this.parts.get(mat)!.push(g);
  }

  /** A brick-built part: `w` × `d` studs, `h` plates, standing on `bottom`. */
  piece(w: number, d: number, h: number, mat: THREE.Material, color: string, x: number, bottom: number, z = 0, studs = false) {
    this.add(pieceGeometry({ w, d, h, studs, under: false }), mat, x, bottom + (h * P) / 2, z, color);
  }

  /** A plain block, sized in world units, centred on (x, y, z). */
  block(sx: number, sy: number, sz: number, mat: THREE.Material, color: string, x: number, y: number, z: number) {
    this.add(new THREE.BoxGeometry(sx, sy, sz), mat, x, y, z, color);
  }

  /** A side profile (x, y points) pushed `depth` across the car, centred on z. */
  prism(pts: [number, number][], depth: number, mat: THREE.Material, color: string, z = 0) {
    this.add(prism(pts, depth), mat, 0, 0, z, color);
  }

  into(parent: THREE.Object3D, shadows: (m: THREE.Material) => boolean) {
    for (const [mat, geos] of this.parts) {
      const merged = mergeGeometries(geos, false)!;
      geos.forEach((g) => g.dispose());
      merged.computeBoundingSphere();
      const mesh = new THREE.Mesh(merged, mat);
      mesh.castShadow = shadows(mat);
      mesh.receiveShadow = true;
      parent.add(mesh);
    }
  }
}

/** A side profile extruded across the car, its edges softly bevelled like moulded plastic. */
function prism(pts: [number, number][], depth: number) {
  const b = Math.min(0.02, depth / 6);
  const g = new THREE.ExtrudeGeometry(new THREE.Shape(pts.map(([x, y]) => new THREE.Vector2(x, y))), {
    depth: depth - 2 * b,
    bevelEnabled: true,
    bevelThickness: b,
    bevelSize: b * 0.6,
    bevelSegments: 1,
    curveSegments: 1,
  });
  g.translate(0, 0, -(depth - 2 * b) / 2);
  return g;
}

/** A mudguard: a half ring over the wheel, its legs coming down to the axle line. */
function archGeometry() {
  const ro = WHEEL_R + 0.26;
  const ri = WHEEL_R + 0.1;
  const s = new THREE.Shape();
  s.absarc(0, 0, ro, 0, Math.PI, false);
  s.lineTo(-ri, 0);
  s.absarc(0, 0, ri, Math.PI, 0, true);
  s.lineTo(ro, 0);
  const g = new THREE.ExtrudeGeometry(s, { depth: WHEEL_W + 0.06, bevelEnabled: true, bevelThickness: 0.02, bevelSize: 0.015, bevelSegments: 1, curveSegments: 18 });
  g.translate(0, 0, -(WHEEL_W + 0.06) / 2);
  return g;
}

/**
 * A tyre turned on a lathe: rounded shoulders, and grooves round the tread. Its axle is z, and
 * the outer face is +z.
 */
function tyreGeometry() {
  const r = WHEEL_R;
  const hw = WHEEL_W / 2;
  const pts: [number, number][] = [
    [0.42, -hw],
    [r - 0.1, -hw],
    [r - 0.03, -hw + 0.04],
    [r, -hw + 0.11],
  ];
  // three grooves across the tread
  for (const c of [-0.12, 0, 0.12]) pts.push([r, c - 0.03], [r - 0.04, c - 0.025], [r - 0.04, c + 0.025], [r, c + 0.03]);
  pts.push([r, hw - 0.11], [r - 0.03, hw - 0.04], [r - 0.1, hw], [0.42, hw]);
  const g = new THREE.LatheGeometry(
    pts.map(([x, y]) => new THREE.Vector2(x, y)),
    36,
  );
  g.rotateX(Math.PI / 2);
  return g;
}

/** The hub: a dished rim with a raised centre cap. */
function hubGeometry() {
  const hw = WHEEL_W / 2;
  const pts: [number, number][] = [
    [0.0001, -hw + 0.04],
    [0.44, -hw + 0.04],
    [0.44, hw - 0.04],
    [0.4, hw],
    [0.35, hw - 0.06],
    [0.17, hw - 0.06],
    [0.13, hw + 0.01],
    [0.0001, hw + 0.01],
  ];
  const g = new THREE.LatheGeometry(
    pts.map(([x, y]) => new THREE.Vector2(x, y)),
    28,
  );
  g.rotateX(Math.PI / 2);
  return g;
}

let shared: { tyre: Geo; hub: Geo; arch: Geo; lamp: Geo; ring: Geo; bolt: Geo; head: Geo; wheel: Geo; beam: Geo; pool: Geo } | null = null;
function geometries() {
  if (shared) return shared;
  const lamp = new THREE.CylinderGeometry(0.25, 0.25, 0.08, 20);
  lamp.rotateZ(Math.PI / 2);
  const ring = new THREE.CylinderGeometry(0.32, 0.32, 0.05, 20);
  ring.rotateZ(Math.PI / 2);
  const bolt = new THREE.CylinderGeometry(0.045, 0.045, 0.06, 8);
  bolt.rotateX(Math.PI / 2);
  const wheel = new THREE.TorusGeometry(0.24, 0.035, 6, 20);
  // a headlight beam: a cone with its tip at the lamp, opening out along +x
  const beam = new THREE.ConeGeometry(1.5, 8, 20, 1, true);
  beam.rotateZ(Math.PI / 2);
  beam.translate(4, 0, 0);
  // and the pool of light it throws on the road
  const pool = new THREE.PlaneGeometry(9, 5);
  pool.rotateX(-Math.PI / 2);
  pool.translate(8.4, 0, 0);
  shared = { tyre: tyreGeometry(), hub: hubGeometry(), arch: archGeometry(), lamp, ring, bolt, head: new THREE.CylinderGeometry(0.25, 0.25, 0.4, 16), wheel, beam, pool };
  return shared;
}

type Ctx = { kit: Kit; mats: CarMaterials; paint: string; accent: string; shirt: string };

/** The running gear every model shares: floor pan, axles, wheels arches and bumpers. */
function chassis({ kit, mats, paint }: Ctx, opts: { top: number; lightY: number; grille?: "chrome" | "dark"; slim?: boolean }) {
  const g = geometries();
  kit.piece(8, 4, 1, mats.plastic, TRIM, 0, Y0);
  // the axle blocks the wheels clip onto
  for (const x of [-WHEEL_X, WHEEL_X]) kit.piece(2, 4, 1, mats.plastic, C.black, x, Y0 - P);
  // mudguards in body colour
  for (const x of [-WHEEL_X, WHEEL_X]) for (const z of [-WHEEL_Z, WHEEL_Z]) kit.add(g.arch, mats.plastic, x, -1.3, z, paint);
  // bumpers, with the number plates
  for (const s of [1, -1]) {
    kit.add(pieceGeometry({ w: 0.3, d: 4.1, h: 1, studs: false, under: false }), mats.plastic, s * 4.08, -0.86, 0, GREY);
    kit.block(0.04, 0.24, 0.9, mats.plastic, C.white, s * 4.24, -0.86, 0);
    kit.block(0.045, 0.06, 0.62, mats.plastic, C.black, s * 4.245, -0.86, 0);
  }
  const ly = opts.lightY;
  if (opts.slim) {
    // a sports car's light strips
    for (const z of [-1.3, 1.3]) kit.block(0.06, 0.16, 0.8, mats.head, "#ffffff", 4.02, ly, z);
    kit.block(0.06, 0.12, 3.4, mats.tail, "#ffffff", -4.02, ly, 0);
    kit.block(0.05, 0.2, 1.7, mats.plastic, C.black, 4.02, ly, 0);
  } else {
    // round headlamps in chrome rings, a grille between them, indicators at the corners
    for (const z of [-1.35, 1.35]) {
      kit.add(g.ring, mats.chrome, 4.0, ly, z);
      kit.add(g.lamp, mats.head, 4.03, ly, z);
      kit.block(0.05, 0.16, 0.24, mats.plastic, C.orange, 4.02, ly, z > 0 ? 1.83 : -1.83);
    }
    kit.block(0.06, 0.46, 1.9, mats.plastic, opts.grille === "chrome" ? GREY : C.black, 4.0, ly, 0);
    for (const dy of [-0.13, 0, 0.13]) kit.block(0.07, 0.05, 1.8, opts.grille === "chrome" ? mats.chrome : mats.plastic, TRIM, 4.03, ly + dy, 0);
    // tail lights, with a white reversing lamp beside each
    for (const z of [-1.45, 1.45]) {
      kit.block(0.07, 0.34, 0.6, mats.tail, "#ffffff", -4.02, ly, z);
      kit.block(0.06, 0.16, 0.22, mats.plastic, C.white, -4.02, ly - 0.02, z > 0 ? 1.0 : -1.0);
    }
  }
  // an exhaust pipe under the back
  kit.add(new THREE.CylinderGeometry(0.08, 0.08, 0.5, 10), mats.chrome, -4.0, -1.22, -1.1, "#ffffff", 0, 0, Math.PI / 2);
  // door handles
  for (const z of [-2.01, 2.01]) kit.block(0.3, 0.06, 0.04, mats.plastic, TRIM, -0.2, opts.top - 0.18, z);
}

/** A minifig at the wheel: sitting on `floor`, facing +x, with the steering wheel in front. */
function driver({ kit, mats, shirt }: Ctx, x: number, floor: number, hat: string) {
  const g = geometries();
  const z = -0.9;
  kit.block(0.9, 0.24, 1.3, mats.plastic, C.black, x - 0.05, floor + 0.12, z);
  kit.block(0.22, 0.75, 1.3, mats.plastic, C.black, x - 0.42, floor + 0.55, z);
  // the passenger seat stays empty
  kit.block(0.9, 0.24, 1.3, mats.plastic, C.black, x - 0.05, floor + 0.12, -z);
  kit.block(0.22, 0.75, 1.3, mats.plastic, C.black, x - 0.42, floor + 0.55, -z);
  kit.block(0.4, 0.46, 0.82, mats.plastic, shirt, x - 0.12, floor + 0.47, z);
  // arms reaching for the wheel
  for (const dz of [-0.36, 0.36]) kit.add(new THREE.BoxGeometry(0.5, 0.15, 0.17), mats.plastic, x + 0.15, floor + 0.55, z + dz, shirt, 0, 0, 0.35);
  kit.add(new THREE.CylinderGeometry(0.1, 0.1, 0.06, 10), mats.plastic, x - 0.12, floor + 0.73, z, SKIN);
  kit.add(g.head, mats.plastic, x - 0.12, floor + 0.96, z, SKIN);
  // a cap (or hair)
  kit.add(new THREE.CylinderGeometry(0.27, 0.27, 0.12, 16), mats.plastic, x - 0.12, floor + 1.18, z, hat);
  kit.block(0.22, 0.04, 0.46, mats.plastic, hat, x + 0.18, floor + 1.14, z);
  // eyes, so it has somewhere to look
  for (const dz of [-0.09, 0.09]) kit.block(0.02, 0.05, 0.04, mats.plastic, C.black, x + 0.13, floor + 1.0, z + dz);
  kit.add(g.wheel, mats.plastic, x + 0.5, floor + 0.62, z, C.black, 0, Math.PI / 2, 0);
}

/** The glasshouse: windscreen, side windows, pillars and roof over a cabin from `x0` back to the screen. */
function cabin(
  { kit, mats, paint }: Ctx,
  o: { sill: number; roof: number; screen: [number, number]; back: number; rear?: [number, number]; pillar?: number; bPillar?: number; noRoof?: boolean },
) {
  const [sx0, sx1] = o.screen; // where the windscreen meets the bonnet, and the roof
  const t = 0.26;
  const [rx0, rx1] = o.rear ?? [o.back, o.back];
  // windscreen and the A pillars either side of it
  kit.prism([[sx0, o.sill], [sx0 + t, o.sill], [sx1 + t, o.roof], [sx1, o.roof]], 3.5, mats.glass, "#ffffff");
  for (const z of [-1.86, 1.86]) kit.prism([[sx0 - 0.02, o.sill], [sx0 + t + 0.02, o.sill], [sx1 + t + 0.02, o.roof], [sx1 - 0.02, o.roof]], 0.24, mats.plastic, paint, z);
  // side windows
  for (const z of [-1.88, 1.88]) kit.prism([[rx0, o.sill], [sx0 + 0.05, o.sill], [sx1 + 0.05, o.roof], [rx1, o.roof]], 0.05, mats.glass, "#ffffff", z);
  // rear window (raked, if the roof ends before the body does) and the C pillars beside it
  kit.prism([[rx0 - t, o.sill], [rx0, o.sill], [rx1, o.roof], [rx1 - t, o.roof]], 3.5, mats.glass, "#ffffff");
  for (const z of [-1.86, 1.86]) kit.prism([[rx0 - t - 0.04, o.sill], [rx0 + (o.pillar ?? 0.1), o.sill], [rx1 + (o.pillar ?? 0.1), o.roof], [rx1 - t - 0.04, o.roof]], 0.24, mats.plastic, paint, z);
  if (o.bPillar !== undefined) for (const z of [-1.86, 1.86]) kit.block(0.24, o.roof - o.sill, 0.24, mats.plastic, paint, o.bPillar, (o.sill + o.roof) / 2, z);
  // the roof, a smooth tile
  const len = sx1 + t - (rx1 - t);
  if (!o.noRoof) kit.add(pieceGeometry({ w: len + 0.1, d: 4, h: 1, studs: false, under: false }), mats.plastic, rx1 - t + len / 2, o.roof + P / 2, 0, paint);
  // dashboard
  kit.block(0.5, 0.2, 3.5, mats.plastic, C.black, sx0 - 0.15, o.sill + 0.1, 0);
  // wing mirrors
  for (const s of [-1, 1]) {
    kit.block(0.08, 0.06, 0.34, mats.plastic, TRIM, sx0 - 0.05, o.sill + 0.12, s * 2.08);
    kit.block(0.12, 0.2, 0.26, mats.plastic, paint, sx0 - 0.08, o.sill + 0.2, s * 2.3);
  }
}

/** Low and long: a sloping bonnet, a fastback, a wing on the back and stripes over the top. */
function sports(ctx: Ctx) {
  const { kit, mats, paint, accent } = ctx;
  const top = C1 + 2 * P;
  chassis(ctx, { top, lightY: -0.5, slim: true });
  kit.piece(8, 4, 2, mats.plastic, paint, 0, C1);
  // side skirts and intakes
  for (const z of [-2.0, 2.0]) {
    kit.block(3.4, 0.14, 0.06, mats.plastic, C.black, 0, -0.95, z);
    kit.block(0.7, 0.24, 0.05, mats.plastic, C.black, -1.6, -0.45, z);
  }
  // bonnet sweeping down to the nose
  kit.prism([[0.9, top], [4.0, top], [4.0, top + 0.18], [0.9, top + 0.5]], 3.96, mats.plastic, paint);
  // sills round the cockpit, and the deck behind it
  for (const z of [-1.8, 1.8]) kit.block(4.8, 0.45, 0.36, mats.plastic, paint, -1.5, top + 0.22, z);
  kit.prism([[-4.0, top], [-3.2, top], [-3.2, top + 0.45], [-4.0, top + 0.4]], 3.96, mats.plastic, paint);
  kit.block(4.0, 0.2, 3.3, mats.plastic, C.black, -1.2, top + 0.1, 0);
  // sitting low, as you do in one of these
  driver(ctx, -1.15, top - 0.25, C.white);
  cabin(ctx, { sill: top + 0.45, roof: top + 1.12, screen: [0.85, -0.45], back: -3.2, rear: [-3.2, -2.2], pillar: 0.2 });
  // the rear wing
  for (const z of [-1.3, 1.3]) kit.block(0.14, 0.42, 0.14, mats.plastic, C.black, -3.7, top + 0.62, z);
  kit.prism([[-4.08, top + 0.84], [-3.35, top + 0.84], [-3.35, top + 0.92], [-4.08, top + 1.04]], 4.0, mats.plastic, accent);
  // racing stripes from nose to tail
  for (const z of [-0.4, 0.4]) {
    kit.prism([[0.9, top + 0.5], [4.0, top + 0.18], [4.0, top + 0.2], [0.9, top + 0.52]], 0.34, mats.plastic, accent, z);
    kit.block(2.2, 0.02, 0.34, mats.plastic, accent, -1.33, top + 1.12 + P - 0.004, z);
  }
  // twin exhausts
  kit.add(new THREE.CylinderGeometry(0.09, 0.09, 0.5, 10), mats.chrome, -4.0, -1.22, 1.1, "#ffffff", 0, 0, Math.PI / 2);
}

/** The town car: bonnet, cabin, a short boot. The police car and the taxi are built on it. */
function hatch(ctx: Ctx, extra: "police" | "taxi" | "rack") {
  const { kit, mats, paint, accent } = ctx;
  const top = C1 + 3 * P;
  chassis(ctx, { top, lightY: -0.38, grille: extra === "rack" ? "chrome" : "dark" });
  kit.piece(8, 4, 3, mats.plastic, paint, 0, C1);
  kit.prism([[1.7, top], [4.0, top], [4.0, top + 0.28], [1.7, top + 0.42]], 3.96, mats.plastic, paint);
  kit.prism([[-4.0, top], [-2.9, top], [-2.9, top + 0.42], [-4.0, top + 0.34]], 3.96, mats.plastic, paint);
  for (const z of [-1.8, 1.8]) kit.block(4.7, 0.42, 0.36, mats.plastic, paint, -0.6, top + 0.21, z);
  kit.block(4.6, 0.12, 3.3, mats.plastic, C.black, -0.6, top + 0.06, 0);
  kit.block(0.9, 0.24, 3.3, mats.plastic, C.black, -2.3, top + 0.24, 0);
  kit.block(0.22, 0.75, 3.3, mats.plastic, C.black, -2.7, top + 0.55, 0);
  const roof = top + 1.38;
  driver(ctx, 0.0, top + 0.12, extra === "police" ? C.black : extra === "taxi" ? C.reddishBrown : C.darkTan);
  cabin(ctx, { sill: top + 0.42, roof, screen: [1.7, 0.92], back: -2.9, rear: [-2.95, -2.65], bPillar: -0.75 });
  const up = roof + P;
  if (extra === "police") {
    // a stripe down each side, and the light bar
    for (const z of [-2.005, 2.005]) {
      kit.block(7.6, 0.24, 0.02, mats.plastic, accent, 0, top - 0.42, z);
      kit.block(7.6, 0.05, 0.022, mats.plastic, C.black, 0, top - 0.27, z);
    }
    kit.block(0.6, 0.12, 2.8, mats.plastic, C.black, -0.6, up + 0.06, 0);
    kit.add(pieceGeometry({ w: 0.5, d: 1.2, h: 0.7, studs: false, under: false }), mats.beaconRed, -0.6, up + 0.24, -0.7);
    kit.add(pieceGeometry({ w: 0.5, d: 1.2, h: 0.7, studs: false, under: false }), mats.beaconBlue, -0.6, up + 0.24, 0.7);
  } else if (extra === "taxi") {
    // the checker band, and the sign on the roof
    for (const z of [-2.005, 2.005])
      for (let i = 0; i < 24; i++)
        for (let r = 0; r < 2; r++) kit.block(0.3, 0.14, 0.02, mats.plastic, (i + r) % 2 ? C.black : C.white, -3.45 + i * 0.3, top - 0.5 + r * 0.14, z);
    kit.block(0.8, 0.08, 1.8, mats.plastic, C.black, -0.6, up + 0.04, 0);
    kit.add(pieceGeometry({ w: 0.7, d: 1.6, h: 1, studs: false, under: false }), mats.head, -0.6, up + 0.08 + P / 2, 0);
    kit.block(0.72, 0.12, 1.4, mats.plastic, C.black, -0.6, up + 0.28, 0);
  } else {
    // a roof rack with a surfboard strapped on
    for (const x of [-2.1, 0.3]) {
      kit.block(0.12, 0.1, 3.8, mats.plastic, TRIM, x, up + 0.05, 0);
      for (const z of [-1.8, 1.8]) kit.block(0.16, 0.16, 0.16, mats.plastic, C.black, x, up + 0.02, z);
    }
    const board = new THREE.SphereGeometry(1, 24, 8);
    board.scale(2.5, 0.07, 0.55);
    kit.add(board, mats.plastic, -0.9, up + 0.17, 0, accent);
    const stripe = new THREE.SphereGeometry(1, 24, 6);
    stripe.scale(2.3, 0.075, 0.12);
    kit.add(stripe, mats.plastic, -0.9, up + 0.175, 0, C.white);
  }
}

/** The delivery van: a short nose and a tall box, with a stripe down the side. */
function van(ctx: Ctx) {
  const { kit, mats, paint, accent } = ctx;
  const top = C1 + 3 * P;
  chassis(ctx, { top, lightY: -0.38, grille: "dark" });
  kit.piece(8, 4, 3, mats.plastic, paint, 0, C1);
  kit.prism([[2.7, top], [4.0, top], [4.0, top + 0.3], [2.7, top + 0.46]], 3.96, mats.plastic, paint);
  for (const z of [-1.8, 1.8]) kit.block(1.4, 0.46, 0.36, mats.plastic, paint, 2.0, top + 0.23, z);
  kit.block(1.6, 0.12, 3.3, mats.plastic, C.black, 2.0, top + 0.06, 0);
  // the load box: four plates taller than the body, its own roof on top
  const boxTop = top + 4 * P;
  kit.piece(5.25, 4, 4, mats.plastic, paint, -1.375, top);
  kit.add(pieceGeometry({ w: 6.45, d: 4.06, h: 0.6, studs: false, under: false }), mats.plastic, -0.775, boxTop + 0.12, 0, paint);
  driver(ctx, 1.75, top + 0.12, C.darkBlue);
  cabin(ctx, { sill: top + 0.46, roof: boxTop, screen: [2.7, 2.15], back: 1.3, rear: [1.3, 1.3], noRoof: true });
  // the stripe, the seam between the back doors and their windows
  for (const z of [-2.005, 2.005]) {
    kit.block(5.0, 0.32, 0.02, mats.plastic, accent, -1.4, top + 0.95, z);
    kit.block(5.0, 0.06, 0.022, mats.plastic, C.black, -1.4, top + 0.72, z);
  }
  kit.block(0.02, 1.5, 0.04, mats.plastic, C.black, -4.01, top + 0.8, 0);
  for (const z of [-0.9, 0.9]) kit.block(0.03, 0.42, 1.3, mats.glass, "#ffffff", -4.01, top + 1.15, z);
  for (const z of [-0.25, 0.25]) kit.block(0.06, 0.06, 0.18, mats.plastic, TRIM, -4.04, top + 0.6, z);
  // a vent on the roof
  kit.block(0.8, 0.14, 1.2, mats.plastic, GREY, -1.8, boxTop + 0.3, 0);
}

/** The pickup: chunky bonnet, a cab, and a bed with a few loose bricks in it. */
function pickup(ctx: Ctx) {
  const { kit, mats, paint } = ctx;
  const top = C1 + 3 * P;
  chassis(ctx, { top, lightY: -0.36, grille: "chrome" });
  kit.piece(8, 4, 3, mats.plastic, paint, 0, C1);
  kit.prism([[1.5, top], [4.0, top], [4.0, top + 0.42], [1.5, top + 0.52]], 3.96, mats.plastic, paint);
  for (const z of [-1.8, 1.8]) kit.block(2.4, 0.52, 0.36, mats.plastic, paint, 0.3, top + 0.26, z);
  kit.block(2.4, 0.12, 3.3, mats.plastic, C.black, 0.3, top + 0.06, 0);
  // the back of the cab
  kit.add(pieceGeometry({ w: 0.4, d: 4, h: 3.6, studs: false, under: false }), mats.plastic, -0.95, top + 1.8 * P, 0, paint);
  const roof = top + 1.42;
  driver(ctx, 0.35, top + 0.12, C.black);
  cabin(ctx, { sill: top + 0.52, roof, screen: [1.5, 1.0], back: -0.75, rear: [-0.75, -0.75] });
  // spotlights on the roof
  for (const z of [-1.0, 0, 1.0]) kit.add(new THREE.CylinderGeometry(0.16, 0.16, 0.08, 14), mats.head, 0.8, roof + P + 0.16, z, "#ffffff", 0, 0, Math.PI / 2);
  kit.block(0.12, 0.08, 2.6, mats.plastic, C.black, 0.72, roof + P + 0.04, 0);
  // the bed: a studded floor, sides and a tailgate, and some bricks
  kit.piece(3, 4, 1, mats.plastic, TRIM, -2.5, top, 0, true);
  for (const z of [-1.8, 1.8]) kit.piece(3.0, 0.4, 2, mats.plastic, paint, -2.5, top, z);
  kit.piece(0.4, 3.2, 2, mats.plastic, paint, -3.8, top, 0);
  const bed = top + P;
  kit.add(pieceGeometry({ w: 2, d: 2, h: 3, studs: true }), mats.plastic, -2.2, bed + 1.5 * P, -0.6, C.red);
  kit.add(pieceGeometry({ w: 2, d: 1, h: 1, studs: true }), mats.plastic, -2.0, bed + 0.5 * P, 1.0, C.yellow);
  kit.add(pieceGeometry({ w: 1, d: 1, h: 3, studs: true }), mats.plastic, -3.1, bed + 1.5 * P, 1.0, C.blue);
}

/**
 * A town car, 8 studs long and 4 wide, built the way a set would build it — and not all the same:
 * a sports car, a hatchback with a surfboard on the roof, a police car, a taxi, a van, a pickup.
 * Glass you can see the driver through, chrome, headlamps that throw light at night, tyres with
 * a tread. Origin is the middle of its rigid body (4 studs tall, bottom at -2); it faces the way
 * it drives (`dir`). `roll` turns the wheels (and rocks the body on its springs) by how far it
 * has moved along x.
 */
export function buildCar(color: string, mats: CarMaterials, opts: { model?: number; dir?: number } = {}) {
  const model: CarModel = CAR_MODELS[(opts.model ?? 1) % CAR_MODELS.length];
  const dir = (opts.dir ?? 1) < 0 ? -1 : 1;
  const car = new THREE.Group();
  const facing = new THREE.Group();
  facing.rotation.y = dir < 0 ? Math.PI : 0;
  car.add(facing);
  const body = new THREE.Group();
  facing.add(body);

  const dark = color === C.black || color === C.darkBlue || color === C.blue || color === C.darkTurquoise;
  const accent = model === "van" ? (color === C.white ? C.red : C.white) : dark ? C.white : color === C.lime || color === C.yellow ? C.black : C.white;
  const ctx: Ctx = { kit: new Kit(), mats, paint: color, accent: model === "hatch" ? C.orange : accent, shirt: DRIVERS[(opts.model ?? 0) % DRIVERS.length] };
  if (model === "sports") sports(ctx);
  else if (model === "van") van(ctx);
  else if (model === "pickup") pickup(ctx);
  else hatch(ctx, model === "police" ? "police" : model === "taxi" ? "taxi" : "rack");
  ctx.kit.into(body, (m) => m !== mats.glass && m !== mats.beam && m !== mats.pool);

  // headlight beams and the light they throw on the road (only seen after dark)
  const g = geometries();
  const beams = new Kit();
  for (const z of [-1.35, 1.35]) {
    beams.add(g.beam, mats.beam, 4.05, model === "sports" ? -0.5 : -0.38, z, "#ffffff", 0, 0, -0.06);
    beams.add(g.pool, mats.pool, 0, -1.97, z * 0.6);
  }
  beams.into(facing, () => false);
  facing.children.forEach((m) => {
    if (m !== body) {
      m.receiveShadow = false;
      m.renderOrder = 2;
    }
  });

  // wheels: tread, dished hub, wheel nuts
  const wheels: THREE.Group[] = [];
  for (const x of [-WHEEL_X, WHEEL_X])
    for (const z of [-WHEEL_Z, WHEEL_Z]) {
      const w = new THREE.Group();
      w.position.set(x, -2 + WHEEL_R, z);
      const side = new THREE.Group();
      if (z < 0) side.rotation.y = Math.PI;
      const tyre = new THREE.Mesh(g.tyre, mats.tyre);
      const hub = new Kit();
      hub.add(g.hub, mats.plastic, 0, 0, 0, model === "sports" || model === "pickup" ? GREY : C.white);
      for (let i = 0; i < 5; i++) {
        const a = (i / 5) * Math.PI * 2;
        hub.add(g.bolt, mats.chrome, Math.cos(a) * 0.25, Math.sin(a) * 0.25, WHEEL_W / 2 - 0.05);
      }
      tyre.castShadow = true;
      tyre.receiveShadow = true;
      side.add(tyre);
      hub.into(side, () => true);
      w.add(side);
      facing.add(w);
      wheels.push(w);
    }

  let travelled = 0;
  const roll = (dx: number) => {
    const d = dx * dir;
    travelled += Math.abs(d);
    for (const w of wheels) w.rotation.z -= d / WHEEL_R;
    // a gentle rock on the springs as it goes
    body.position.y = Math.sin(travelled * 1.7) * 0.018 + Math.sin(travelled * 0.63) * 0.012;
    body.rotation.z = Math.sin(travelled * 1.1 + 1) * 0.006;
  };
  return { car, roll };
}
