import * as THREE from "three";
import { ConvexGeometry } from "three/examples/jsm/geometries/ConvexGeometry.js";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import type { Park } from "./park";
import type { Sim } from "./sim";
import { archTexture, cardboardTexture, chevronTexture, coverTexture, matTexture, pagesTexture, pinTexture } from "./textures";
import { DOMINO, PIN, YARD, yardQuat, type YardProp } from "./yard";

const m4 = new THREE.Matrix4();
const v = new THREE.Vector3();
const q = new THREE.Quaternion();
const one = new THREE.Vector3(1, 1, 1);

const TITLES = ["Atlas of Roads", "Big Book of Cars", "Stories at Bedtime", "How Things Go", "Speed!"];

/**
 * What the Stunt Yard looks like: the play-mat, the ramps and books and tunnel, the checkpoint
 * arches (the next one lights up while you drive), and the dominoes and skittles, which follow
 * their physics bodies.
 */
export class YardView {
  readonly root = new THREE.Group();
  private dominoes: THREE.InstancedMesh | null = null;
  private pins: THREE.InstancedMesh | null = null;
  /** which sim toy each instance shows */
  private dominoIdx: number[] = [];
  private pinIdx: number[] = [];
  private arches: { i: number; mat: THREE.MeshStandardMaterial }[] = [];
  private next = -1;
  full = true;

  constructor(park: Park, sim: Sim, aniso: number) {
    const props = park.props.filter((p): p is YardProp => ["mat", "wedge", "slab", "checkpoint"].includes(p.kind));
    const n = props.filter((p) => p.kind === "checkpoint").length;
    let book = 0;
    for (const p of props) {
      if (p.kind === "mat") this.buildMat(p, aniso);
      else if (p.kind === "wedge") this.buildWedge(p);
      else if (p.kind === "slab") this.buildSlab(p, p.look === "book" ? TITLES[book++ % TITLES.length] : undefined);
      else if (p.kind === "checkpoint") this.buildArch(p, n);
    }
    this.buildToys(sim);
    this.root.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (mesh.isMesh) {
        mesh.castShadow = mesh.userData.cast !== false;
        mesh.receiveShadow = true;
      }
    });
  }

  private buildMat(p: Extract<YardProp, { kind: "mat" }>, aniso: number) {
    const mat = new THREE.Mesh(new THREE.PlaneGeometry(p.w, p.d), new THREE.MeshStandardMaterial({ map: matTexture(YARD, aniso), roughness: 0.94, metalness: 0 }));
    mat.rotation.x = -Math.PI / 2;
    mat.position.set(p.x, 0.315, p.z);
    mat.userData.cast = false;
    this.root.add(mat);
    // the mat's thickness: a felt binding round the edge (only the edge, so nothing fights the print)
    const felt = new THREE.MeshStandardMaterial({ color: "#2f5fb3", roughness: 1 });
    const t = 1.2;
    for (const [w, d, x, z] of [
      [p.w + t * 2, t, p.x, p.z - p.d / 2 - t / 2],
      [p.w + t * 2, t, p.x, p.z + p.d / 2 + t / 2],
      [t, p.d, p.x - p.w / 2 - t / 2, p.z],
      [t, p.d, p.x + p.w / 2 + t / 2, p.z],
    ]) {
      const edge = new THREE.Mesh(new RoundedBoxGeometry(w, 0.34, d, 1, 0.1), felt);
      edge.position.set(x, 0.17, z);
      edge.userData.cast = false;
      this.root.add(edge);
    }
  }

  private buildWedge(p: Extract<YardProp, { kind: "wedge" }>) {
    const pts = p.pts.map((a) => new THREE.Vector3(...a));
    const body = new THREE.Mesh(new ConvexGeometry(pts), new THREE.MeshStandardMaterial({ color: p.color, roughness: 0.7, flatShading: true }));
    this.root.add(body);
    // chevrons on the running surface: the low edge (points 0 and 3) up to the lip (2 and 5)
    const [a, b, c, d] = [pts[0], pts[3], pts[5], pts[2]];
    const n = new THREE.Vector3().subVectors(d, a).cross(new THREE.Vector3().subVectors(b, a)).normalize();
    if (n.y < 0) n.negate();
    const lift = (x: THREE.Vector3) => x.clone().addScaledVector(n, 0.04);
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute([...lift(a).toArray(), ...lift(b).toArray(), ...lift(c).toArray(), ...lift(d).toArray()], 3));
    g.setAttribute("uv", new THREE.Float32BufferAttribute([0, 0, 1, 0, 1, 2, 0, 2], 2));
    g.setIndex([0, 2, 1, 0, 3, 2]);
    g.computeVertexNormals();
    // make the face point up whichever way the corners wound
    if (g.attributes.normal.getY(0) < 0) {
      g.setIndex([0, 1, 2, 0, 2, 3]);
      g.computeVertexNormals();
    }
    const top = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ map: chevronTexture(), roughness: 0.6, side: THREE.DoubleSide }));
    top.userData.cast = false;
    this.root.add(top);
  }

  private buildSlab(p: Extract<YardProp, { kind: "slab" }>, title?: string) {
    const geo = new THREE.BoxGeometry(p.half[0] * 2, p.half[1] * 2, p.half[2] * 2);
    let mat: THREE.Material | THREE.Material[];
    if (p.look === "book") {
      const cover = new THREE.MeshStandardMaterial({ color: p.color, roughness: 0.55 });
      const front = new THREE.MeshStandardMaterial({ map: coverTexture(p.color, title ?? ""), roughness: 0.5 });
      const pages = new THREE.MeshStandardMaterial({ map: pagesTexture(), roughness: 0.9 });
      // +x pages, -x spine, +y the cover, -y the back, ±z pages
      mat = [pages, cover, front, cover, pages, pages];
    } else if (p.look === "cardboard") {
      const plain = new THREE.MeshStandardMaterial({ map: cardboardTexture(), roughness: 0.95 });
      const printed = new THREE.MeshStandardMaterial({ map: cardboardTexture(p.label), roughness: 0.95 });
      mat = p.label ? [plain, plain, printed, plain, plain, plain] : [plain, plain, plain, plain, printed, printed];
    } else mat = new THREE.MeshStandardMaterial({ color: p.color, roughness: 0.7 });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(...p.center);
    mesh.quaternion.copy(yardQuat(p.yaw, p.pitch));
    this.root.add(mesh);
  }

  private buildArch(p: Extract<YardProp, { kind: "checkpoint" }>, n: number) {
    const g = new THREE.Group();
    g.position.set(p.at[0], 0, p.at[2]);
    g.rotation.y = p.yaw;
    const metal = new THREE.MeshStandardMaterial({ color: "#e6e8eb", metalness: 0.9, roughness: 0.3 });
    for (const side of [-1, 1]) {
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.7, 0.8, p.h + 2, 12), metal);
      post.position.set(side * (p.w / 2 + 1), (p.h + 2) / 2, 0);
      g.add(post);
      const foot = new THREE.Mesh(new THREE.CylinderGeometry(2, 2.3, 0.6, 16), new THREE.MeshStandardMaterial({ color: "#20242c", roughness: 0.4 }));
      foot.position.set(side * (p.w / 2 + 1), 0.3, 0);
      g.add(foot);
    }
    const map = archTexture(p.i, n);
    const face = new THREE.MeshStandardMaterial({ map, emissiveMap: map, emissive: new THREE.Color("#ffffff"), emissiveIntensity: 0, roughness: 0.5 });
    const rim = new THREE.MeshStandardMaterial({ color: "#20242c", roughness: 0.4 });
    // the banner faces back down the road (the way you come at it): the box's ±z faces carry it
    const banner = new THREE.Mesh(new THREE.BoxGeometry(p.w + 4, 4.6, 0.6), [rim, rim, rim, rim, face, face]);
    banner.position.set(0, p.h + 1.2, 0);
    g.add(banner);
    this.root.add(g);
    this.arches.push({ i: p.i, mat: face });
  }

  private buildToys(sim: Sim) {
    sim.toys.forEach((t, i) => (t.kind === "domino" ? this.dominoIdx : this.pinIdx).push(i));
    if (this.dominoIdx.length) {
      const geo = new RoundedBoxGeometry(DOMINO.w, DOMINO.h, DOMINO.t, 2, 0.12);
      const mat = new THREE.MeshPhysicalMaterial({ color: "#ffffff", roughness: 0.45, clearcoat: 0.6, clearcoatRoughness: 0.3 });
      const mesh = new THREE.InstancedMesh(geo, mat, this.dominoIdx.length);
      const c = new THREE.Color();
      this.dominoIdx.forEach((ti, k) => mesh.setColorAt(k, c.set(sim.toys[ti].color)));
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.frustumCulled = false;
      this.dominoes = mesh;
      this.root.add(mesh);
    }
    if (this.pinIdx.length) {
      // a skittle's outline, base to crown
      const h = PIN.h;
      const R = PIN.r;
      const prof = [
        [0, 0],
        [R * 0.62, 0],
        [R * 0.9, h * 0.1],
        [R, h * 0.28],
        [R * 0.82, h * 0.48],
        [R * 0.45, h * 0.66],
        [R * 0.42, h * 0.74],
        [R * 0.6, h * 0.86],
        [R * 0.5, h * 0.96],
        [0, h],
      ].map(([x, y]) => new THREE.Vector2(x, y - h / 2));
      const geo = new THREE.LatheGeometry(prof, 20);
      const mat = new THREE.MeshPhysicalMaterial({ map: pinTexture(), roughness: 0.3, clearcoat: 1, clearcoatRoughness: 0.1 });
      const mesh = new THREE.InstancedMesh(geo, mat, this.pinIdx.length);
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.frustumCulled = false;
      this.pins = mesh;
      this.root.add(mesh);
    }
  }

  /** Light up the arch you're heading for (-1: none). */
  setNext(i: number) {
    if (i === this.next) return;
    this.next = i;
    for (const a of this.arches) a.mat.emissiveIntensity = a.i === i ? 0.9 : 0;
  }

  /** The toys follow their bodies (only the ones moving, unless a full redraw is due). */
  update(sim: Sim, t: number) {
    const sync = (mesh: THREE.InstancedMesh | null, idx: number[]) => {
      if (!mesh) return;
      let dirty = false;
      idx.forEach((ti, k) => {
        const rb = sim.toyBodies[ti];
        if (rb.isSleeping() && !this.full) return;
        mesh.setMatrixAt(k, m4.compose(v.copy(rb.translation() as THREE.Vector3), q.copy(rb.rotation() as THREE.Quaternion), one));
        dirty = true;
      });
      if (dirty) mesh.instanceMatrix.needsUpdate = true;
    };
    sync(this.dominoes, this.dominoIdx);
    sync(this.pins, this.pinIdx);
    this.full = false;
    // the arch you're heading for pulses
    for (const a of this.arches) if (a.i === this.next) a.mat.emissiveIntensity = 0.6 + Math.sin(t * 6) * 0.35;
  }

  /** Pose the toys from a recorded frame (the replay), seven floats each, in sim order. */
  setToys(arr: Float32Array, offset: number) {
    const put = (mesh: THREE.InstancedMesh | null, idx: number[]) => {
      if (!mesh) return;
      idx.forEach((ti, k) => {
        const o = offset + ti * 7;
        if (o + 6 >= arr.length) return;
        v.set(arr[o], arr[o + 1], arr[o + 2]);
        q.set(arr[o + 3], arr[o + 4], arr[o + 5], arr[o + 6]);
        mesh.setMatrixAt(k, m4.compose(v, q, one));
      });
      mesh.instanceMatrix.needsUpdate = true;
    };
    put(this.dominoes, this.dominoIdx);
    put(this.pins, this.pinIdx);
  }
}
