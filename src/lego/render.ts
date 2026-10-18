import * as THREE from "three";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import { buildCar, type CarMaterials } from "./car";
import { geometryKey, glassMaterial, glowMaterial, pieceGeometry, plasticMaterial, studGeometry } from "./geometry";
import type { Layout, Pick, Piece } from "./layout";
import { buildMinifig } from "./minifig";
import { paintGround, paintPieces } from "./paint";
import { MAX_SHOTS, type BrickPhysics } from "./physics";
import { printArt } from "./print";
import { C, PLATE } from "./units";

/** printed faces sit this far proud of the plastic, and stop short of the bevel */
const LIFT = 0.004;
const INSET = 0.07;
/** pieces are drawn in strips this wide, so whatever's off screen is skipped */
const CHUNK = 80;
/** the colours you throw, as if pulled from a mixed tub */
export const SHOT_COLORS = [C.red, C.yellow, C.blue, C.white, C.lime, C.orange, C.black, C.mediumAzure].map((c) => new THREE.Color(c));
export const SHOT_COLOR_COUNT = SHOT_COLORS.length;

type Decal = { mesh: THREE.Mesh; piece: Piece; local: THREE.Matrix4 };

/**
 * A piece shape with its own per-instance piece ids (`aPiece`, id + 1), for the paint. The vertex
 * data itself is shared with every other mesh of that shape, not copied.
 */
function withIds(base: THREE.BufferGeometry, ids: Float32Array, dynamic = false) {
  const g = new THREE.BufferGeometry();
  g.setIndex(base.index);
  for (const [name, attr] of Object.entries(base.attributes)) g.setAttribute(name, attr);
  g.boundingSphere = base.boundingSphere;
  g.boundingBox = base.boundingBox;
  const attr = new THREE.InstancedBufferAttribute(ids, 1);
  if (dynamic) attr.setUsage(THREE.DynamicDrawUsage);
  g.setAttribute("aPiece", attr);
  return g;
}
/** Headlight beams (a cone, brightest at the lamp) and the pool they throw on the road; both only after dark. */
function lightMaterial(pool: boolean) {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: pool ? THREE.FrontSide : THREE.DoubleSide,
    polygonOffset: pool,
    polygonOffsetFactor: -2,
    uniforms: { uK: { value: 0 }, uColor: { value: new THREE.Color("#ffdca0") } },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: pool
      ? /* glsl */ `
        uniform float uK;
        uniform vec3 uColor;
        varying vec2 vUv;
        void main() {
          vec2 p = (vUv - vec2(0.42, 0.5)) * vec2(1.6, 2.2);
          float a = smoothstep(1.0, 0.0, length(p)) * smoothstep(0.0, 0.25, vUv.x);
          gl_FragColor = vec4(uColor, a * a * 0.5 * uK);
        }`
      : /* glsl */ `
        uniform float uK;
        uniform vec3 uColor;
        varying vec2 vUv;
        void main() {
          gl_FragColor = vec4(uColor, pow(vUv.y, 2.4) * 0.16 * uK);
        }`,
  });
}

/** The traffic's finishes: vertex-coloured ABS (so a whole car body is one draw), smoked glass, chrome, rubber. */
function carMaterials(): Omit<CarMaterials, "head" | "tail"> {
  const plastic = plasticMaterial();
  plastic.vertexColors = true;
  const beacon = (c: string) => new THREE.MeshPhysicalMaterial({ color: c, roughness: 0.15, clearcoat: 1, emissive: new THREE.Color(c), emissiveIntensity: 0.15 });
  return {
    plastic,
    glass: new THREE.MeshPhysicalMaterial({ color: "#2a3542", roughness: 0.04, metalness: 0.1, clearcoat: 1, clearcoatRoughness: 0.04, envMapIntensity: 1.8, transparent: true, opacity: 0.5, depthWrite: false }),
    chrome: new THREE.MeshStandardMaterial({ color: "#e8ecef", roughness: 0.12, metalness: 1, envMapIntensity: 1.4 }),
    tyre: new THREE.MeshPhysicalMaterial({ color: "#1d1f22", roughness: 0.7, clearcoat: 0.1, clearcoatRoughness: 0.6 }),
    beaconRed: beacon("#ff2418"),
    beaconBlue: beacon("#2a6bff"),
    beam: lightMaterial(false),
    pool: lightMaterial(true),
  };
}

type Fig = { id: number; fig: THREE.Group; animate: (t: number, standing: boolean) => void };
type Car = { id: number; car: THREE.Group; roll: (dx: number) => void; lastX: number };
type Slot = { mesh: THREE.InstancedMesh; index: number };
type Pool = { mesh: THREE.InstancedMesh; ids: number[] };

/**
 * Everything you see of the brick world. Pieces of one shape and finish share an instanced mesh,
 * split into strips along the world so the off-screen ones are culled; printed faces are thin
 * decal meshes that ride on their piece; minifigs, cars and thrown bricks follow their bodies.
 */
export class BrickRenderer {
  readonly root = new THREE.Group();
  /** meshes the pointer can pick (printed faces carry the piece's action) */
  readonly pickables: THREE.Mesh[] = [];
  /** where the street lamps stand (for the night lights) */
  readonly lamps: THREE.Vector3[] = [];
  private meshes: { mesh: THREE.InstancedMesh; ids: number[] }[] = [];
  /** where each piece is drawn while it stands in its build (a lean mesh: no hidden studs, no underside) */
  private slots: Slot[] = [];
  /** full-detail meshes for pieces that are loose or flying, packed at the front as they come loose */
  private pools: Pool[] = [];
  private poolOf: (Pool | undefined)[] = [];
  private moving: Uint8Array;
  private decals: Decal[] = [];
  private decalsById = new Map<number, Decal>();
  private figs: Fig[] = [];
  private cars: Car[] = [];
  private shots: THREE.InstancedMesh;
  private shotData: number[] = [];
  private byZone = new Map<number, number[]>();
  private hop: { zone: number; t0: number; x0: number; span: number } | null = null;
  private m = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private v = new THREE.Vector3();
  private s = new THREE.Vector3();
  private one = new THREE.Vector3(1, 1, 1);
  private zero = new THREE.Vector3(0, 0, 0);
  private plastic = plasticMaterial();
  private glassDark = glassMaterial(false);
  private glassLit = glassMaterial(true);
  private glow = glowMaterial();
  private head = glowMaterial();
  private tail = new THREE.MeshPhysicalMaterial({ color: "#a3170b", roughness: 0.2, clearcoat: 1, emissive: new THREE.Color("#ff2a10"), emissiveIntensity: 0.2 });
  /** the traffic's own finishes (see car.ts) */
  private car = carMaterials();
  private nightK = 0;
  /** the background (city, trees) is far off and softened by depth of field: standard shading will do */
  private plasticLite = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.26, envMapIntensity: 1 });
  private glassLiteDark = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.08, metalness: 0.35, envMapIntensity: 1.6 });
  private glassLiteLit = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.08, metalness: 0.35, envMapIntensity: 1.6, emissive: new THREE.Color("#ffc874"), emissiveIntensity: 0 });
  private pending: Promise<void>[] = [];
  private wasActive = false;

  constructor(
    private layout: Layout,
    private maxAniso: number,
    onProgress: (p: number) => void,
  ) {
    this.root.name = "bricks";
    // everything a paintball can land on shows paint (the cars and the thrown bricks share
    // the plastic, but carry no piece id, so they stay clean)
    for (const m of [this.plastic, this.glassDark, this.glassLit, this.glow, this.plasticLite, this.glassLiteDark, this.glassLiteLit]) paintPieces(m);
    this.buildPlates();
    this.head.emissive.set("#fff6e0");

    for (const p of layout.pieces) {
      if (!this.byZone.has(p.zone)) this.byZone.set(p.zone, []);
      this.byZone.get(p.zone)!.push(p.id);
      if (p.glow) this.lamps.push(new THREE.Vector3(p.x, p.y, p.z));
    }

    // —— the pieces, instanced by shape and finish, in strips along the world ——
    // a stud with a brick clipped onto it can't be seen, so standing pieces leave those out
    const covered = new Uint8Array(layout.pieces.length);
    {
      const byBottom = new Map<number, Piece[]>();
      const key = (y: number) => Math.round(y * 100);
      for (const p of layout.pieces) {
        const k = key(p.y - (p.h * PLATE) / 2);
        if (!byBottom.has(k)) byBottom.set(k, []);
        byBottom.get(k)!.push(p);
      }
      for (const p of layout.pieces) {
        let area = 0;
        for (const q of byBottom.get(key(p.y + (p.h * PLATE) / 2)) ?? []) {
          const ox = Math.min(p.x + p.w / 2, q.x + q.w / 2) - Math.max(p.x - p.w / 2, q.x - q.w / 2);
          const oz = Math.min(p.z + p.d / 2, q.z + q.d / 2) - Math.max(p.z - p.d / 2, q.z - q.d / 2);
          if (ox > 0 && oz > 0) area += ox * oz;
        }
        covered[p.id] = area >= p.w * p.d - 0.01 ? 1 : 0;
      }
    }
    this.moving = new Uint8Array(layout.pieces.length);
    const finishOf = (p: Piece) => p.glass ?? (p.glow ? "glow" : "plastic");
    const materialOf = (p: Piece) => (p.glass === "lit" ? this.glassLit : p.glass === "dark" ? this.glassDark : p.glow ? this.glow : this.plastic);
    const leanMaterialOf = (p: Piece) =>
      p.zone >= 0 || p.glow ? materialOf(p) : p.glass === "lit" ? this.glassLiteLit : p.glass === "dark" ? this.glassLiteDark : this.plasticLite;
    const leanOf = (p: Piece) => ({ w: p.w, d: p.d, h: p.h, round: p.round, studs: p.studs && !covered[p.id], under: false });
    const groups = new Map<string, Piece[]>();
    const full = new Map<string, Piece[]>();
    for (const p of layout.pieces) {
      if (p.special) continue;
      const k = `${geometryKey(leanOf(p))}|${finishOf(p)}|${p.zone < 0 ? "bg" : "fg"}|${Math.floor((p.x - layout.bounds.x0) / CHUNK)}`;
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k)!.push(p);
      const fk = `${geometryKey(p)}|${finishOf(p)}`;
      if (!full.has(fk)) full.set(fk, []);
      full.get(fk)!.push(p);
    }
    const color = new THREE.Color();
    for (const list of full.values()) {
      const mesh = new THREE.InstancedMesh(withIds(pieceGeometry(list[0]), new Float32Array(list.length), true), materialOf(list[0]), list.length);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.frustumCulled = false;
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      for (let i = 0; i < list.length; i++) mesh.setColorAt(i, color.set(0xffffff));
      mesh.count = 0;
      this.root.add(mesh);
      const pool: Pool = { mesh, ids: [] };
      for (const p of list) this.poolOf[p.id] = pool;
      this.pools.push(pool);
    }
    const box = new THREE.Box3();
    for (const list of groups.values()) {
      const first = list[0];
      const mesh = new THREE.InstancedMesh(withIds(pieceGeometry(leanOf(first)), Float32Array.from(list, (p) => p.id + 1)), leanMaterialOf(first), list.length);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      // moulded batches never match perfectly: a hair of variation reads as real plastic
      list.forEach((p, i) => {
        mesh.setColorAt(i, color.set(p.color).multiplyScalar(0.97 + ((p.id * 7919) % 61) / 1000));
        this.slots[p.id] = { mesh, index: i };
      });
      // cull by where the strip was built, padded for whatever gets knocked a little way off
      box.makeEmpty();
      for (const p of list) box.expandByPoint(this.v.set(p.x, p.y, p.z));
      mesh.boundingSphere = box.getBoundingSphere(new THREE.Sphere());
      mesh.boundingSphere.radius += 36;
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      this.root.add(mesh);
      this.meshes.push({ mesh, ids: list.map((p) => p.id) });
    }

    // —— printed faces ——
    let done = 0;
    const printed = layout.pieces.filter((p) => p.print);
    for (const p of printed) {
      const H = p.h * PLATE;
      const front = p.print!.face === "front";
      const fw = p.w - INSET * 2;
      const fh = (front ? H : p.d) - INSET * 2;
      const mat = new THREE.MeshPhysicalMaterial({
        color: p.color,
        roughness: 0.3,
        clearcoat: 0.55,
        clearcoatRoughness: 0.2,
        specularIntensity: 0.6,
        envMapIntensity: 0.85,
        polygonOffset: true,
        polygonOffsetFactor: -2,
      });
      const local = front
        ? new THREE.Matrix4().makeTranslation(0, 0, p.d / 2 + LIFT)
        : new THREE.Matrix4().makeTranslation(0, H / 2 + LIFT, 0).multiply(new THREE.Matrix4().makeRotationX(-Math.PI / 2));
      // the print takes paint too: its points and normal in its piece's frame, and the piece's id
      const plane = new THREE.PlaneGeometry(fw, fh);
      const pp = plane.attributes.position.clone().applyMatrix4(local);
      const pn = plane.attributes.normal.clone().applyNormalMatrix(new THREE.Matrix3().getNormalMatrix(local));
      plane.setAttribute("aPaintP", pp);
      plane.setAttribute("aPaintN", pn);
      plane.setAttribute("aPiece", new THREE.Float32BufferAttribute(new Float32Array(pp.count).fill(p.id + 1), 1));
      paintPieces(mat, { rot: new THREE.Matrix3().setFromMatrix4(local) });
      const mesh = new THREE.Mesh(plane, mat);
      mesh.receiveShadow = true;
      mesh.matrixAutoUpdate = false;
      mesh.userData.pick = p.pick;
      this.root.add(mesh);
      const decal = { mesh, piece: p, local };
      this.decals.push(decal);
      this.decalsById.set(p.id, decal);
      if (p.pick) this.pickables.push(mesh);
      this.pending.push(
        printArt(p.print!.art, fw, fh, maxAniso).then((tex) => {
          mat.map = tex;
          mat.color.set(0xffffff);
          mat.needsUpdate = true;
          onProgress(++done / printed.length);
        }),
      );
    }
    if (!printed.length) onProgress(1);

    // —— the cast, and the traffic ——
    for (const p of layout.pieces.filter((x) => x.special === "minifig")) {
      const { fig, animate } = buildMinifig(maxAniso, p.style ?? 0);
      fig.matrixAutoUpdate = false;
      this.root.add(fig);
      this.figs.push({ id: p.id, fig, animate });
    }
    const mats: CarMaterials = { ...this.car, head: this.head, tail: this.tail };
    for (const p of layout.pieces.filter((x) => x.special === "car")) {
      const { car, roll } = buildCar(p.color, mats, { model: p.style, dir: Math.sign(p.drive ?? 1) });
      car.matrixAutoUpdate = false;
      this.root.add(car);
      this.cars.push({ id: p.id, car, roll, lastX: p.x });
    }

    // —— thrown bricks ——
    this.shots = new THREE.InstancedMesh(pieceGeometry({ w: 4, d: 2, h: 3, studs: true }), this.plastic, MAX_SHOTS);
    this.shots.castShadow = true;
    this.shots.receiveShadow = true;
    this.shots.frustumCulled = false;
    this.shots.count = 0;
    for (let i = 0; i < MAX_SHOTS; i++) this.shots.setColorAt(i, SHOT_COLORS[0]);
    this.root.add(this.shots);
  }

  /** Resolves once every print is on its piece. */
  get loaded() {
    return Promise.all(this.pending).then(() => undefined);
  }

  /** 0 day … 1 night: windows, lamps and headlights come on. */
  setNight(k: number) {
    this.glassLit.emissiveIntensity = 2.8 * k;
    this.glassLiteLit.emissiveIntensity = 2.8 * k;
    this.glow.emissiveIntensity = 7 * k;
    this.head.emissiveIntensity = 0.35 + 5 * k;
    this.tail.emissiveIntensity = 0.2 + 3 * k;
    this.nightK = k;
    (this.car.beam as THREE.ShaderMaterial).uniforms.uK.value = k;
    (this.car.pool as THREE.ShaderMaterial).uniforms.uK.value = k;
  }

  /** Baseplates: a studded grid of plates (grass, plazas) and smooth road plates in front. */
  private buildPlates() {
    const stud = studGeometry(8, 0.3, 0.17, false);
    // baseplates fill most of the screen: plain standard shading (no clear coat) keeps them cheap
    const mats = new Map<string, THREE.MeshStandardMaterial>();
    const mat = (c: string) => {
      if (!mats.has(c)) {
        const m = new THREE.MeshStandardMaterial({ color: c, roughness: 0.36, envMapIntensity: 0.8 });
        paintGround(m);
        mats.set(c, m);
      }
      return mats.get(c)!;
    };
    let road: Promise<THREE.Texture> | null = null;
    for (const p of this.layout.plates) {
      const g = new RoundedBoxGeometry(p.w - 0.05, 0.32, p.d - 0.05, 2, 0.05);
      const plate = new THREE.Mesh(g, mat(p.color));
      plate.position.set(p.x + p.w / 2, -0.16, p.z + p.d / 2);
      plate.receiveShadow = true;
      this.root.add(plate);
      if (p.road) {
        road ??= printArt({ kind: "road" }, p.w, p.d, this.maxAniso);
        const deckMat = new THREE.MeshStandardMaterial({ color: p.color, roughness: 0.45, envMapIntensity: 0.7 });
        paintGround(deckMat);
        const deck = new THREE.Mesh(new THREE.PlaneGeometry(p.w - 0.1, p.d - 0.1), deckMat);
        deck.rotation.x = -Math.PI / 2;
        deck.position.set(p.x + p.w / 2, 0.002, p.z + p.d / 2);
        deck.receiveShadow = true;
        this.root.add(deck);
        void road.then((t) => {
          const m = deck.material as THREE.MeshStandardMaterial;
          m.map = t;
          m.color.set(0xffffff);
          m.needsUpdate = true;
        });
      }
      if (!p.studs) continue;
      const studs = new THREE.InstancedMesh(stud, mat(p.color), p.w * p.d);
      let i = 0;
      for (let x = 0; x < p.w; x++)
        for (let z = 0; z < p.d; z++) studs.setMatrixAt(i++, this.m.makeTranslation(p.x + x + 0.5, -0.002, p.z + z + 0.5));
      studs.receiveShadow = true;
      studs.computeBoundingSphere();
      this.root.add(studs);
    }
  }

  private pose(id: number, ph: BrickPhysics, out: THREE.Matrix4, lift = 0) {
    if (ph.lost[id]) return out.compose(this.v.set(0, -999, 0), this.q.identity(), this.zero);
    this.v.set(ph.pos[id * 3], ph.pos[id * 3 + 1] + lift, ph.pos[id * 3 + 2]);
    this.q.set(ph.quat[id * 4], ph.quat[id * 4 + 1], ph.quat[id * 4 + 2], ph.quat[id * 4 + 3]);
    // shrinking into the vacuum, or swelling back out of it
    const k = ph.scale[id];
    return out.compose(this.v, this.q, k === 1 ? this.one : this.s.setScalar(Math.max(k, 1e-3)));
  }

  /**
   * Say hello when the camera arrives: the build in front of you does a little Mexican wave,
   * each column hopping in turn from left to right.
   */
  wave(zone: number, t: number) {
    const ids = this.byZone.get(zone);
    if (!ids?.length || zone < 0) return;
    let x0 = Infinity;
    let x1 = -Infinity;
    for (const id of ids) {
      const p = this.layout.pieces[id];
      x0 = Math.min(x0, p.x);
      x1 = Math.max(x1, p.x);
    }
    this.hop = { zone, t0: t, x0, span: Math.max(1, x1 - x0) };
  }

  /** Every piece back in its build: lean meshes at their poses, the full-detail pools emptied. */
  private settle(ph: BrickPhysics) {
    this.moving.fill(0);
    for (const pool of this.pools) {
      pool.ids.length = 0;
      pool.mesh.count = 0;
    }
    for (const { mesh, ids } of this.meshes) {
      for (let i = 0; i < ids.length; i++) mesh.setMatrixAt(i, this.pose(ids[i], ph, this.m));
      mesh.instanceMatrix.needsUpdate = true;
    }
    for (const d of this.decals) d.mesh.matrix.multiplyMatrices(this.pose(d.piece.id, ph, this.m), d.local);
  }

  /** A piece comes loose: hide it in its build's mesh and draw it, studs and underside, from its pool. */
  private lift(id: number) {
    this.moving[id] = 1;
    const slot = this.slots[id];
    slot.mesh.setMatrixAt(slot.index, this.m.compose(this.v.set(0, -999, 0), this.q.identity(), this.zero));
    slot.mesh.instanceMatrix.needsUpdate = true;
    const pool = this.poolOf[id]!;
    const i = pool.ids.length;
    pool.ids.push(id);
    pool.mesh.count = pool.ids.length;
    pool.mesh.setColorAt(i, slot.mesh.getColorAt(slot.index, new THREE.Color()));
    if (pool.mesh.instanceColor) pool.mesh.instanceColor.needsUpdate = true;
    const ids = pool.mesh.geometry.attributes.aPiece as THREE.InstancedBufferAttribute;
    ids.setX(i, id + 1);
    ids.needsUpdate = true;
  }

  /** How high a piece is in the wave right now. */
  private hopLift(p: Piece, t: number) {
    const h = this.hop!;
    const u = (t - h.t0) * 1.9 - ((p.x - h.x0) / h.span) * 0.9;
    return u > 0 && u < 1 ? Math.sin(Math.PI * u) * 1.1 : 0;
  }

  /** Copy the physics poses onto everything drawn. `full` forces every instance (first frame). */
  sync(ph: BrickPhysics, t: number, full = false) {
    // the frame things come to rest (a rebuild landing), every piece goes back to its lean mesh
    const active = ph.active;
    if ((this.wasActive && !active) || full) this.settle(ph);
    this.wasActive = active;
    if (active) {
      // anything newly loose (or flying home) swaps to its full-detail mesh
      for (let id = 0; id < this.moving.length; id++) if (!this.moving[id] && this.slots[id] && (ph.loose[id] || ph.flying(id))) this.lift(id);
      for (const pool of this.pools) {
        if (!pool.ids.length) continue;
        for (let i = 0; i < pool.ids.length; i++) pool.mesh.setMatrixAt(i, this.pose(pool.ids[i], ph, this.m));
        pool.mesh.instanceMatrix.needsUpdate = true;
      }
      for (const d of this.decals) {
        if (!ph.loose[d.piece.id] && !ph.flying(d.piece.id)) continue;
        d.mesh.matrix.multiplyMatrices(this.pose(d.piece.id, ph, this.m), d.local);
      }
    }

    // the welcome wave (on pieces still standing; the physics never knows)
    if (this.hop && !ph.animating) {
      const done = (t - this.hop.t0) * 1.9 > 1.95;
      for (const id of this.byZone.get(this.hop.zone)!) {
        if (ph.loose[id] || this.moving[id]) continue;
        const p = this.layout.pieces[id];
        const lift = done ? 0 : this.hopLift(p, t);
        const slot = this.slots[id];
        if (slot) {
          slot.mesh.setMatrixAt(slot.index, this.pose(id, ph, this.m, lift));
          slot.mesh.instanceMatrix.needsUpdate = true;
        }
        const d = this.decalsById.get(id);
        if (d) d.mesh.matrix.multiplyMatrices(this.pose(id, ph, this.m, lift), d.local);
      }
      if (done) this.hop = null;
    }

    for (const f of this.figs) {
      const lift = this.hop && !ph.loose[f.id] ? this.hopLift(this.layout.pieces[f.id], t) * 0.8 : 0;
      this.pose(f.id, ph, f.fig.matrix, lift);
      f.animate(t, ph.atHome(f.id));
    }
    // the police lights: red, blue, red, blue, with a double flash
    const beat = (t * 2.2) % 1;
    const flash = (on: boolean) => (on && (beat % 0.5 < 0.12 || (beat % 0.5 > 0.2 && beat % 0.5 < 0.32)) ? 2.2 + 5 * this.nightK : 0.15);
    (this.car.beaconRed as THREE.MeshPhysicalMaterial).emissiveIntensity = flash(beat < 0.5);
    (this.car.beaconBlue as THREE.MeshPhysicalMaterial).emissiveIntensity = flash(beat >= 0.5);
    for (const c of this.cars) {
      this.pose(c.id, ph, c.car.matrix);
      const x = ph.pos[c.id * 3];
      const dx = x - c.lastX;
      // wheels turn with the road (not on the jump back round the world, nor once it's tumbling)
      if (!ph.loose[c.id] && Math.abs(dx) < 2) c.roll(dx);
      c.lastX = x;
    }

    const data = ph.ballPoses(this.shotData);
    const n = data.length / 9;
    this.shots.count = n;
    for (let i = 0; i < n; i++) {
      const o = i * 9;
      // pop in on launch, shrink away at the end of their life
      const age = data[o + 7];
      const sc = Math.max(0.001, Math.min(1, age * 8) * Math.min(1, Math.max(0, (30 - age) / 0.6)));
      this.v.set(data[o], data[o + 1], data[o + 2]);
      this.q.set(data[o + 3], data[o + 4], data[o + 5], data[o + 6]);
      this.shots.setMatrixAt(i, this.m.compose(this.v, this.q, this.s.setScalar(sc)));
      this.shots.setColorAt(i, SHOT_COLORS[data[o + 8] % SHOT_COLORS.length]);
    }
    if (n) {
      this.shots.instanceMatrix.needsUpdate = true;
      if (this.shots.instanceColor) this.shots.instanceColor.needsUpdate = true;
    }
  }

  /** The action under a ray, if any. */
  pick(ray: THREE.Raycaster): Pick | null {
    const hit = ray.intersectObjects(this.pickables, false)[0];
    return (hit?.object.userData.pick as Pick | undefined) ?? null;
  }

  dispose() {
    this.root.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.geometry) m.geometry.dispose();
      const mat = m.material as THREE.Material | THREE.Material[] | undefined;
      for (const x of Array.isArray(mat) ? mat : mat ? [mat] : []) {
        for (const v of Object.values(x)) if (v instanceof THREE.Texture) v.dispose();
        x.dispose();
      }
    });
  }
}
