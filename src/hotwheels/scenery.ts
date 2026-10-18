import * as THREE from "three";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import { BLOCK, BOOSTER, LAUNCHER, connectorsFor, type Support } from "./furniture";
import type { Park, Prop } from "./park";
import type { Sim } from "./sim";
import { blockAtlas, finishTexture, floorTextures, labelTexture, rugTexture, signTexture, trackTextures, wallTexture } from "./textures";
import { newFrame, trackGeometry, type TrackFrame } from "./track";
import { COLORS, TRACK } from "./units";
import { YardView } from "./yardView";

const m4 = new THREE.Matrix4();
const q = new THREE.Quaternion();
const v = new THREE.Vector3();
const one = new THREE.Vector3(1, 1, 1);

/** A frame on the track as a matrix (left, up, forward), lifted `up` along the normal. */
function frameMatrix(f: TrackFrame, out: THREE.Matrix4, up = 0, fwd = 0) {
  out.makeBasis(f.side, f.u, f.t);
  out.setPosition(f.p.x + f.u.x * up + f.t.x * fwd, f.p.y + f.u.y * up + f.t.y * fwd, f.p.z + f.u.z * up + f.t.z * fwd);
  return out;
}

const plastic = (color: string, rough = 0.42, extra: THREE.MeshPhysicalMaterialParameters = {}) =>
  new THREE.MeshPhysicalMaterial({ color, roughness: rough, metalness: 0, clearcoat: 0.3, clearcoatRoughness: 0.35, ...extra });

type Launcher = { track: string; plunger: THREE.Group; knob: THREE.Object3D; pull: number; target: number; kick: number };
type Booster = { wheels: THREE.Mesh[]; led: THREE.MeshStandardMaterial; spin: number; hot: number; at: THREE.Vector3 };
type Gate = { track: string; arm: THREE.Group; open: number; target: number };
type Flag = { cloth: THREE.Mesh };
type Peg = { base: THREE.Matrix4; phase: number; jump: number };

/**
 * Everything static (or moulded) you see in the park. Owns the meshes; the scene just adds
 * `root` and calls `update` every frame.
 */
export class ParkView {
  readonly root = new THREE.Group();
  readonly lamps: THREE.Vector3[] = [];
  private launchers: Launcher[] = [];
  private boosters: Booster[] = [];
  private gates: Gate[] = [];
  private flags: Flag[] = [];
  private flagTime = { value: 0 };
  private glow = { value: 0 };
  private blocks: THREE.InstancedMesh | null = null;
  private crowds: { mesh: THREE.InstancedMesh; heads: THREE.InstancedMesh; list: Peg[] }[] = [];
  private tree: { amber: THREE.MeshStandardMaterial[][]; green: THREE.MeshStandardMaterial[]; red: THREE.MeshStandardMaterial[]; win: THREE.MeshStandardMaterial[] } | null = null;
  private bulbs: THREE.MeshStandardMaterial;
  private beams: THREE.MeshBasicMaterial;
  private disposables: { dispose: () => void }[] = [];
  readonly ringLight: THREE.PointLight;
  readonly ringAt = new THREE.Vector3();
  /** the Stunt Yard (its own module) */
  readonly yard: YardView;

  constructor(
    private park: Park,
    sim: Sim,
    aniso: number,
  ) {
    this.bulbs = new THREE.MeshStandardMaterial({ color: "#fff3d0", emissive: new THREE.Color("#ffcf7a"), emissiveIntensity: 0.2, roughness: 0.3 });
    this.beams = new THREE.MeshBasicMaterial({ color: "#ff2a2a", transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });
    this.buildRoom(aniso);
    this.buildTracks();
    this.buildSupports(sim.supports);
    const f = newFrame();
    for (const p of park.props) this.buildProp(p, f);
    this.buildBlocks(sim);
    this.yard = new YardView(park, sim, aniso);
    this.root.add(this.yard.root);
    this.ringLight = new THREE.PointLight("#ff7a1a", 0, 70, 2);
    this.ringLight.position.copy(this.ringAt);
    this.root.add(this.ringLight);
    this.root.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (mesh.isMesh && mesh.userData.noShadow !== true) {
        mesh.castShadow = mesh.userData.cast !== false;
        mesh.receiveShadow = true;
      }
    });
  }

  private add<T extends THREE.Object3D>(o: T) {
    this.root.add(o);
    return o;
  }

  // —————————————————————————————————————————— scenery that gets out of the camera's way

  private occluders: { box: THREE.Box3; parts: { mesh: THREE.Mesh; orig: THREE.Material | THREE.Material[]; ghost: THREE.MeshBasicMaterial[] }[]; k: number; min: number; followOnly: boolean; ghosted: boolean }[] = [];
  private ray = new THREE.Ray();
  private ghostNight = 0;
  private hit = new THREE.Vector3();

  /**
   * Mark something tall or in-between (a flag, the bunting, a grandstand) as scenery that fades
   * to a ghost when it comes between the camera and what it's looking at, or right up against
   * the lens. `followOnly`: part of the view at a stop (a tower), so it only gets out of the way
   * of a camera following a car.
   *
   * Fading swaps each mesh onto a plain unlit see-through copy of its own colour and texture,
   * rather than turning its real material transparent: a handful of cheap shaders instead of a
   * see-through twin of every lit one.
   */
  private occlude(o: THREE.Object3D | THREE.Object3D[], min: number, followOnly = false) {
    const list = Array.isArray(o) ? o : [o];
    const box = new THREE.Box3();
    const parts: { mesh: THREE.Mesh; orig: THREE.Material | THREE.Material[]; ghost: THREE.MeshBasicMaterial[] }[] = [];
    const ghostOf = (m: THREE.Material) => {
      const src = m as THREE.MeshStandardMaterial;
      const g = new THREE.MeshBasicMaterial({ color: src.color ? src.color.clone() : 0xffffff, map: src.map ?? null, side: src.side, transparent: true, depthWrite: false });
      // remember its own colour: the unlit ghost is dimmed by hand after dark
      g.userData.base = g.color.clone();
      // keep a flag's cloth waving while it's a ghost
      if (m.onBeforeCompile !== THREE.Material.prototype.onBeforeCompile) g.onBeforeCompile = m.onBeforeCompile;
      return g;
    };
    for (const obj of list) {
      obj.updateMatrixWorld(true);
      box.expandByObject(obj);
      obj.traverse((x) => {
        const mesh = x as THREE.Mesh;
        if (!mesh.isMesh) return;
        const orig = mesh.material;
        parts.push({ mesh, orig, ghost: (Array.isArray(orig) ? orig : [orig]).map(ghostOf) });
      });
    }
    this.occluders.push({ box, parts, k: 1, min, followOnly, ghosted: false });
  }

  private ghost(o: (typeof this.occluders)[number], on: boolean) {
    o.ghosted = on;
    for (const p of o.parts) p.mesh.material = on ? (Array.isArray(p.orig) ? p.ghost : p.ghost[0]) : p.orig;
  }

  /**
   * Fade whatever stands between the camera and what it must show (call every frame): the car
   * it's following, or a spread of points across the attraction at a stop.
   */
  fade(cam: THREE.Vector3, targets: THREE.Vector3[], following: boolean, dt: number) {
    const rate = 1 - Math.exp(-7 * dt);
    for (const o of this.occluders) {
      let block = o.box.distanceToPoint(cam) < 5;
      if (o.followOnly && !following) block = false;
      else
        for (let i = 0; i < targets.length && !block; i++) {
          const len = cam.distanceTo(targets[i]);
          this.ray.origin.copy(cam);
          this.ray.direction.subVectors(targets[i], cam).divideScalar(len || 1);
          if (this.ray.intersectBox(o.box, this.hit)) block = this.hit.distanceTo(cam) < len - 4;
        }
      const k = o.k + ((block ? o.min : 1) - o.k) * rate;
      if (Math.abs(k - o.k) < 0.001 && (k === 1 || k === o.min)) continue;
      o.k = Math.abs(k - 1) < 0.01 ? 1 : k;
      const want = o.k < 0.99;
      if (want !== o.ghosted) this.ghost(o, want);
      if (want) for (const p of o.parts) for (const g of p.ghost) g.opacity = o.k;
    }
  }

  /** Put every fadeable thing in (or out of) its ghost, so the ghosts' shaders can be compiled up front. */
  setOccludersGhost(on: boolean) {
    for (const o of this.occluders) if (o.k === 1) this.ghost(o, on);
  }

  /** Pose the castle from a recorded frame (the replay), seven floats a block. */
  setBlocks(arr: Float32Array) {
    // the toys come after the castle in the record
    this.yard.setToys(arr, (this.blocks?.count ?? 0) * 7);
    if (!this.blocks) return;
    const n = Math.min(this.blocks.count, arr.length / 7);
    for (let i = 0; i < n; i++) {
      v.set(arr[i * 7], arr[i * 7 + 1], arr[i * 7 + 2]);
      q.set(arr[i * 7 + 3], arr[i * 7 + 4], arr[i * 7 + 5], arr[i * 7 + 6]);
      this.blocks.setMatrixAt(i, m4.compose(v, q, one));
    }
    this.blocks.instanceMatrix.needsUpdate = true;
  }

  // —————————————————————————————————————————— the room

  private buildRoom(aniso: number) {
    const fl = floorTextures(aniso);
    const REP = 240;
    const W = 1600;
    const D = 1100;
    for (const t of [fl.map, fl.roughness, fl.normal]) t.repeat.set(W / REP, D / REP);
    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(W, D),
      new THREE.MeshPhysicalMaterial({ map: fl.map, roughnessMap: fl.roughness, normalMap: fl.normal, normalScale: new THREE.Vector2(0.6, 0.6), roughness: 1, clearcoat: 0.12, clearcoatRoughness: 0.45, envMapIntensity: 0.32 }),
    );
    floor.rotation.x = -Math.PI / 2;
    floor.position.set(0, 0, 150);
    floor.userData.cast = false;
    this.add(floor);

    // the back wall, a skirting board, and a sofa against it (scale: this is somebody's living room)
    const wall = new THREE.Mesh(new THREE.PlaneGeometry(W, 340), new THREE.MeshStandardMaterial({ map: wallTexture(), roughness: 0.95 }));
    wall.position.set(0, 170, -330);
    wall.userData.cast = false;
    this.add(wall);
    const skirt = new THREE.Mesh(new THREE.BoxGeometry(W, 14, 2), new THREE.MeshStandardMaterial({ color: "#f2efe8", roughness: 0.5 }));
    skirt.position.set(0, 7, -328.5);
    this.add(skirt);
    const fabric = new THREE.MeshStandardMaterial({ color: "#5b6b7d", roughness: 0.92 });
    const sofa = new THREE.Group();
    const seat = new THREE.Mesh(new RoundedBoxGeometry(260, 22, 90, 4, 8), fabric);
    seat.position.set(0, 26, 0);
    const back = new THREE.Mesh(new RoundedBoxGeometry(260, 60, 24, 4, 10), fabric);
    back.position.set(0, 60, -36);
    sofa.add(seat, back);
    for (const sx of [-1, 1]) {
      const arm = new THREE.Mesh(new RoundedBoxGeometry(26, 44, 90, 4, 10), fabric);
      arm.position.set(sx * 130, 36, 0);
      sofa.add(arm);
      for (const sz of [-1, 1]) {
        const leg = new THREE.Mesh(new THREE.CylinderGeometry(2.4, 1.8, 15, 12), new THREE.MeshStandardMaterial({ color: "#4a3424", roughness: 0.5 }));
        leg.position.set(sx * 125, 7.5, sz * 38);
        sofa.add(leg);
      }
    }
    for (let i = 0; i < 3; i++) {
      const cushion = new THREE.Mesh(new RoundedBoxGeometry(80, 14, 74, 4, 6), fabric);
      cushion.position.set(-84 + i * 84, 44, 6);
      sofa.add(cushion);
    }
    sofa.position.set(-160, 0, -270);
    this.add(sofa);
    // a toy chest on the right, lid propped open
    const chest = new THREE.Group();
    const wood = new THREE.MeshStandardMaterial({ color: "#c94b32", roughness: 0.6 });
    const box = new THREE.Mesh(new RoundedBoxGeometry(110, 60, 60, 3, 3), wood);
    box.position.y = 30;
    const lid = new THREE.Mesh(new RoundedBoxGeometry(112, 6, 62, 3, 2.5), wood);
    lid.position.set(0, 62, -30);
    lid.rotation.x = -1.1;
    lid.geometry.translate(0, 0, 30);
    chest.add(box, lid);
    chest.position.set(240, 0, -280);
    chest.rotation.y = -0.25;
    this.add(chest);
    this.occlude(chest, 0.3);
    this.aniso = aniso;
  }

  private aniso = 1;

  /** A cotton rug (a car can roll onto it: the physics has it as a slab of floor). */
  private buildRug(p: Extract<Prop, { kind: "rug" }>) {
    const edge = new THREE.MeshStandardMaterial({ color: "#d9cfbc", roughness: 1 });
    const rug = new THREE.Mesh(new RoundedBoxGeometry(p.w, 0.5, p.d, 2, 0.2), [edge, edge, new THREE.MeshStandardMaterial({ map: rugTexture(this.aniso), roughness: 0.96 }), edge, edge, edge]);
    rug.position.set(p.x, 0.25, p.z);
    rug.userData.cast = false;
    this.add(rug);
  }

  /** The junction's moulded crossing piece: a square plate under the X that both lanes clip into. */
  private buildXPlate(p: Extract<Prop, { kind: "xplate" }>) {
    const g = new THREE.Group();
    g.position.set(p.x, 0, p.z);
    g.rotation.y = p.yaw;
    const plate = new THREE.Mesh(new RoundedBoxGeometry(p.s, 0.6, p.s, 2, 0.2), plastic(COLORS.connector, 0.4));
    plate.position.y = 0.3;
    g.add(plate);
    // four corner clips, the way the real piece locks the lanes down
    for (const [sx, sz] of [
      [-1, -1],
      [1, -1],
      [-1, 1],
      [1, 1],
    ]) {
      const clip = new THREE.Mesh(new RoundedBoxGeometry(1.6, 0.9, 1.6, 1, 0.25), plastic("#ffd21f", 0.35));
      clip.position.set((sx * p.s) / 2 - sx * 1.0, 0.45, (sz * p.s) / 2 - sz * 1.0);
      g.add(clip);
    }
    this.add(g);
  }

  // —————————————————————————————————————————— the tracks

  private buildTracks() {
    const tt = trackTextures();
    const mat = new THREE.MeshPhysicalMaterial({
      color: COLORS.orange,
      map: tt.map,
      roughnessMap: tt.roughness,
      roughness: 0.62,
      metalness: 0,
      clearcoat: 0.42,
      clearcoatRoughness: 0.22,
      sheen: 0.2,
      sheenColor: new THREE.Color("#ffb380"),
      envMapIntensity: 0.9,
    });
    // glow-in-the-dark strips along the wall tops, after dark
    const glow = this.glow;
    mat.onBeforeCompile = (sh) => {
      sh.uniforms.uGlow = glow;
      sh.vertexShader = sh.vertexShader
        .replace("#include <common>", "#include <common>\nattribute float aGlow;\nvarying float vGlow;")
        .replace("#include <begin_vertex>", "#include <begin_vertex>\nvGlow = aGlow;");
      sh.fragmentShader = sh.fragmentShader
        .replace("#include <common>", "#include <common>\nuniform float uGlow;\nvarying float vGlow;")
        .replace("#include <emissivemap_fragment>", "#include <emissivemap_fragment>\ntotalEmissiveRadiance += vec3(0.35, 1.0, 0.6) * vGlow * uGlow * 2.2;");
    };
    const connector = new RoundedBoxGeometry(3.4, 0.5, 2.6, 2, 0.12);
    const conMat = plastic(COLORS.connector, 0.4);
    const all: THREE.Matrix4[] = [];
    for (const tr of this.park.tracks) {
      const g = trackGeometry(tr);
      const mesh = new THREE.Mesh(g, mat);
      mesh.name = `track-${tr.id}`;
      this.add(mesh);
      for (const c of connectorsFor(tr)) all.push(frameMatrix(c.f, new THREE.Matrix4(), -TRACK.thick - 0.38));
    }
    const inst = new THREE.InstancedMesh(connector, conMat, all.length);
    all.forEach((mm, i) => inst.setMatrixAt(i, mm));
    this.add(inst);
  }

  private buildSupports(supports: Support[]) {
    const mat = plastic("#5f7186", 0.5);
    const pillars = supports.filter((s) => s.kind === "pillar");
    const arms = supports.filter((s) => s.kind === "arm");
    const col = new THREE.CylinderGeometry(0.75, 0.9, 1, 14);
    col.translate(0, 0.5, 0);
    const foot = new THREE.CylinderGeometry(3.0, 3.3, 0.5, 24);
    foot.translate(0, 0.25, 0);
    const saddle = new RoundedBoxGeometry(5.4, 0.55, 2.4, 2, 0.15);
    const iCol = new THREE.InstancedMesh(col, mat, pillars.length);
    const iFoot = new THREE.InstancedMesh(foot, mat, pillars.length);
    const iSad = new THREE.InstancedMesh(saddle, mat, pillars.length);
    pillars.forEach((p, i) => {
      if (p.kind !== "pillar") return;
      iCol.setMatrixAt(i, m4.compose(v.set(p.x, 0, p.z), q.identity(), new THREE.Vector3(1, p.top, 1)));
      iFoot.setMatrixAt(i, m4.compose(v.set(p.x, 0, p.z), q.identity(), one));
      iSad.setMatrixAt(i, m4.compose(v.set(p.x, p.top - 0.27, p.z), q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), p.yaw), one));
    });
    this.add(iCol);
    this.add(iFoot);
    this.add(iSad);
    const bar = new RoundedBoxGeometry(1.2, 1.0, 1, 1, 0.2);
    const iArm = new THREE.InstancedMesh(bar, mat, arms.length);
    arms.forEach((a, i) => {
      if (a.kind !== "arm") return;
      const len = a.from.distanceTo(a.to);
      iArm.setMatrixAt(i, m4.compose(v.copy(a.from).add(a.to).multiplyScalar(0.5), q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), a.yaw), new THREE.Vector3(1, 1, len)));
    });
    this.add(iArm);
  }

  // —————————————————————————————————————————— furniture on and around the tracks

  private buildProp(p: Prop, f: TrackFrame) {
    switch (p.kind) {
      case "launcher":
        return this.buildLauncher(p.track, f);
      case "booster":
        return this.buildBooster(p.track, p.s, f);
      case "gate":
        return this.buildGate(p.track, p.s, f);
      case "finish":
        return this.buildFinish(p.track, p.s, p.label, p.width ?? 0, f);
      case "tower":
        return this.buildTower(p);
      case "pad": {
        const a = new THREE.Vector3(...p.from);
        const b = new THREE.Vector3(...p.to);
        const d = b.clone().sub(a);
        const g = new RoundedBoxGeometry(p.w, 1.2, d.length(), 2, 0.3);
        const mesh = new THREE.Mesh(g, plastic("#3a4250", 0.45));
        mesh.position.copy(a).add(b).multiplyScalar(0.5).setY(p.from[1] - 0.6);
        mesh.rotation.y = Math.atan2(d.x, d.z);
        this.add(mesh);
        return;
      }
      case "ring":
        return this.buildRing(p);
      case "bin":
        return this.buildBin(p);
      case "tree":
        return this.buildTree(p);
      case "sign":
        return this.buildSign(p);
      case "flag":
        return this.buildFlag(p);
      case "stand":
        return this.buildStand(p);
      case "bunting":
        return this.buildBunting(p);
      case "rug":
        return this.buildRug(p);
      case "xplate":
        return this.buildXPlate(p);
      case "castle":
      case "mat":
      case "wedge":
      case "slab":
      case "checkpoint":
      case "domino":
      case "pin":
        // the castle is built from the physics; the yard has its own view
        return;
    }
  }

  /**
   * The spring launcher: a moulded housing the track clips into, a plunger paddle behind the
   * car, and a knob on top you pull back to load the spring.
   */
  private buildLauncher(trackId: string, f: TrackFrame) {
    const tr = this.park.byId.get(trackId)!;
    tr.frameAt(0, f);
    const g = new THREE.Group();
    g.matrixAutoUpdate = false;
    // flat on the floor, facing along the track
    const yaw = Math.atan2(f.t.x, f.t.z);
    g.matrix.compose(v.set(f.p.x, 0, f.p.z), q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw), one);
    const shell = plastic(COLORS.launcher, 0.36, { clearcoat: 0.6 });
    const accent = plastic(COLORS.launcherAccent, 0.35);
    const L = LAUNCHER.len;
    // the housing, with a slot down its middle for the plunger
    for (const sx of [-1, 1]) {
      const side = new THREE.Mesh(new RoundedBoxGeometry(2.4, LAUNCHER.h, L, 3, 0.4), shell);
      side.position.set(sx * (LAUNCHER.w / 2 - 1.2), LAUNCHER.h / 2, 3 - L / 2);
      g.add(side);
    }
    const back = new THREE.Mesh(new RoundedBoxGeometry(LAUNCHER.w, LAUNCHER.h, 2.2, 3, 0.4), shell);
    back.position.set(0, LAUNCHER.h / 2, 3 - L + 1.1);
    g.add(back);
    const floorPlate = new THREE.Mesh(new RoundedBoxGeometry(LAUNCHER.w, 0.7, L, 2, 0.2), shell);
    floorPlate.position.set(0, 0.35, 3 - L / 2);
    g.add(floorPlate);
    // a stripe and the label on top
    const stripe = new THREE.Mesh(new RoundedBoxGeometry(LAUNCHER.w + 0.05, 0.5, 1.2, 1, 0.1), accent);
    stripe.position.set(0, LAUNCHER.h - 0.9, 2.2);
    g.add(stripe);
    const label = new THREE.Mesh(new THREE.PlaneGeometry(2.1, 6.5), new THREE.MeshStandardMaterial({ map: labelTexture("LAUNCH", COLORS.launcher, COLORS.launcherAccent, 320, 100), roughness: 0.4 }));
    label.rotation.set(-Math.PI / 2, 0, Math.PI / 2);
    for (const sx of [-1, 1]) {
      const l = label.clone();
      l.position.set(sx * (LAUNCHER.w / 2 - 1.2), LAUNCHER.h + 0.01, 3 - L / 2 - 1);
      g.add(l);
    }
    // the plunger: paddle + rod + knob riding in the slot
    const plunger = new THREE.Group();
    const paddle = new THREE.Mesh(new RoundedBoxGeometry(3.3, 1.6, 0.55, 2, 0.15), accent);
    paddle.position.set(0, 0.65 + 1.0, 0);
    const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 7, 10).rotateX(Math.PI / 2), new THREE.MeshStandardMaterial({ color: "#c9cdd2", metalness: 1, roughness: 0.25 }));
    rod.position.set(0, 1.65, -3.6);
    const spring = new THREE.Mesh(
      new THREE.TubeGeometry(new THREE.CatmullRomCurve3(Array.from({ length: 60 }, (_, i) => new THREE.Vector3(Math.cos(i * 0.9) * 0.5, 1.65 + Math.sin(i * 0.9) * 0.5, -i * 0.11))), 120, 0.07, 6),
      new THREE.MeshStandardMaterial({ color: "#d9dde2", metalness: 1, roughness: 0.2 }),
    );
    const knob = new THREE.Mesh(new THREE.SphereGeometry(0.95, 18, 12), plastic("#ff3b30", 0.3, { clearcoat: 1 }));
    knob.position.set(0, LAUNCHER.h + 0.7, -4.8);
    const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, LAUNCHER.h - 1.2, 8), new THREE.MeshStandardMaterial({ color: "#c9cdd2", metalness: 1, roughness: 0.3 }));
    stem.position.set(0, (LAUNCHER.h + 1.2) / 2 + 0.6, -4.8);
    plunger.add(paddle, rod, knob, stem);
    g.add(spring);
    g.add(plunger);
    // the plunger rests just behind where a waiting car's rear bumper sits
    const rest = (tr.hold?.s ?? 7) - 3.8 - 0.3;
    plunger.position.z = rest;
    plunger.userData.rest = rest;
    spring.userData.rest = rest;
    g.updateMatrix();
    this.add(g);
    this.launchers.push({ track: trackId, plunger, knob: spring, pull: 0, target: 0, kick: 0 });
  }

  /**
   * A motorised booster: a housing straddling the track with two spinning foam wheels that grab
   * a car as it passes and fling it on. The wheels spin all the time; an LED flares on a boost.
   */
  private buildBooster(trackId: string, s: number, f: TrackFrame) {
    const tr = this.park.byId.get(trackId)!;
    tr.frameAt(s, f);
    const g = new THREE.Group();
    g.matrixAutoUpdate = false;
    frameMatrix(f, g.matrix);
    const shell = plastic(COLORS.booster, 0.4, { clearcoat: 0.5 });
    const accent = plastic(COLORS.boosterAccent, 0.3, { clearcoat: 0.8 });
    const half = TRACK.bed / 2 + TRACK.wallT;
    const sideW = (BOOSTER.w / 2 - half) * 1;
    const wheels: THREE.Mesh[] = [];
    for (const sx of [-1, 1]) {
      const box = new THREE.Mesh(new RoundedBoxGeometry(sideW, BOOSTER.h, BOOSTER.len, 3, 0.5), shell);
      box.position.set(sx * (half + sideW / 2), BOOSTER.h / 2 - 0.6, 0);
      g.add(box);
      const stripe = new THREE.Mesh(new RoundedBoxGeometry(sideW + 0.05, 0.6, BOOSTER.len + 0.05, 1, 0.1), accent);
      stripe.position.set(sx * (half + sideW / 2), BOOSTER.h - 1.6, 0);
      g.add(stripe);
      // the wheel peeks through a cut-out on the inner face, its tread at the car's flank
      const wheel = new THREE.Mesh(new THREE.CylinderGeometry(BOOSTER.wheelR, BOOSTER.wheelR, 1.6, 26), new THREE.MeshStandardMaterial({ color: "#2b2d31", roughness: 0.85 }));
      const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.8, 0.8, 1.65, 6), plastic("#ffd21f", 0.3));
      wheel.add(hub);
      wheel.position.set(sx * (half + BOOSTER.wheelR - 1.1), 1.3, 0);
      g.add(wheel);
      wheels.push(wheel);
    }
    // the bridge over the top (cars pass underneath), and the battery hatch
    const roof = new THREE.Mesh(new RoundedBoxGeometry(BOOSTER.w, 0.8, BOOSTER.len * 0.7, 2, 0.3), shell);
    roof.position.set(0, BOOSTER.h - 0.6 + 0.2, 0);
    g.add(roof);
    const hatch = new THREE.Mesh(new RoundedBoxGeometry(BOOSTER.w * 0.55, 0.15, BOOSTER.len * 0.42, 1, 0.06), plastic("#3a3f48", 0.5));
    hatch.position.set(0, BOOSTER.h - 0.6 + 0.65, -0.5);
    g.add(hatch);
    const label = new THREE.Mesh(new THREE.PlaneGeometry(BOOSTER.w * 0.62, 2.0), new THREE.MeshStandardMaterial({ map: labelTexture("TURBO", COLORS.booster, "#ff2d55", 320, 100), roughness: 0.4 }));
    label.rotation.x = -Math.PI / 2;
    label.position.set(0, BOOSTER.h - 0.6 + 0.62, 2.6);
    label.rotation.z = Math.PI;
    g.add(label);
    const led = new THREE.MeshStandardMaterial({ color: "#ff3355", emissive: new THREE.Color("#ff2244"), emissiveIntensity: 1, roughness: 0.2 });
    const ledMesh = new THREE.Mesh(new THREE.SphereGeometry(0.4, 12, 8), led);
    ledMesh.position.set(BOOSTER.w / 2 - 1.2, BOOSTER.h - 0.6 + 0.65, BOOSTER.len * 0.25);
    g.add(ledMesh);
    g.updateMatrixWorld();
    this.add(g);
    this.boosters.push({ wheels, led, spin: 0, hot: 0, at: f.p.clone() });
  }

  /** A start gate: a striped barrier arm across the track that swings up to let the car go. */
  private buildGate(trackId: string, s: number, f: TrackFrame) {
    const tr = this.park.byId.get(trackId)!;
    tr.frameAt(s, f);
    const g = new THREE.Group();
    g.matrixAutoUpdate = false;
    frameMatrix(f, g.matrix);
    const half = TRACK.bed / 2 + TRACK.wallT;
    const post = new THREE.Mesh(new RoundedBoxGeometry(1.4, 5, 1.4, 2, 0.3), plastic("#2a2f38", 0.4));
    post.position.set(half + 0.9, 2.2, 0);
    g.add(post);
    const arm = new THREE.Group();
    arm.position.set(half + 0.9, 1.6, 0);
    const c = document.createElement("canvas");
    c.width = 256;
    c.height = 32;
    const x = c.getContext("2d")!;
    for (let i = 0; i < 8; i++) {
      x.fillStyle = i % 2 ? "#111" : "#ffd21f";
      x.beginPath();
      x.moveTo(i * 32, 32);
      x.lineTo(i * 32 + 16, 0);
      x.lineTo(i * 32 + 48, 0);
      x.lineTo(i * 32 + 32, 32);
      x.fill();
    }
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    const bar = new THREE.Mesh(new RoundedBoxGeometry(half * 2 + 1.6, 0.7, 0.6, 2, 0.2), new THREE.MeshPhysicalMaterial({ map: t, roughness: 0.35, clearcoat: 0.6 }));
    bar.position.set(-(half * 2 + 1.6) / 2, 0, 0);
    arm.add(bar);
    g.add(arm);
    g.updateMatrixWorld();
    this.add(g);
    this.gates.push({ track: trackId, arm, open: 0, target: 0 });
  }

  private buildFinish(trackId: string, s: number, label: string, width: number, f: TrackFrame) {
    const tr = this.park.byId.get(trackId)!;
    tr.frameAt(s, f);
    const g = new THREE.Group();
    g.matrixAutoUpdate = false;
    const yaw = Math.atan2(f.t.x, f.t.z);
    const span = width + 9;
    const off = width ? -(width - 8) / 2 : 0;
    const base = f.p.clone().addScaledVector(f.side, off);
    g.matrix.compose(v.set(base.x, 0, base.z), q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw), one);
    const metal = new THREE.MeshStandardMaterial({ color: "#e6e8eb", metalness: 0.9, roughness: 0.3 });
    const top = f.p.y + 22;
    for (const sx of [-1, 1]) {
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.75, 0.8, top, 14), metal);
      post.position.set(sx * span * 0.5, top / 2, 0);
      g.add(post);
      const foot = new THREE.Mesh(new THREE.CylinderGeometry(2.2, 2.5, 0.6, 18), plastic("#2a2f38", 0.4));
      foot.position.set(sx * span * 0.5, 0.3, 0);
      g.add(foot);
      // the timing eyes either side of the line
      const eye = new THREE.Mesh(new RoundedBoxGeometry(1.4, 1.4, 1.4, 1, 0.2), plastic("#1b1d22", 0.3));
      eye.position.set(sx * (span * 0.5 - 1.6), f.p.y + 1.6, 0);
      g.add(eye);
    }
    const banner = new THREE.Mesh(new RoundedBoxGeometry(span + 2, 6, 0.5, 2, 0.2), [
      plastic("#f4f4f4"),
      plastic("#f4f4f4"),
      plastic("#f4f4f4"),
      plastic("#f4f4f4"),
      new THREE.MeshStandardMaterial({ map: finishTexture(label), roughness: 0.5 }),
      new THREE.MeshStandardMaterial({ map: finishTexture(label), roughness: 0.5 }),
    ]);
    banner.position.set(0, top - 3, 0);
    g.add(banner);
    // the beam across the track (a red line at bed height, brighter at night)
    const beam = new THREE.Mesh(new THREE.BoxGeometry(span - 3, 0.12, 0.12), this.beams);
    beam.position.set(0, f.p.y + 1.6, 0);
    beam.userData.noShadow = true;
    g.add(beam);
    g.updateMatrixWorld();
    this.add(g);
    this.occlude(g, 0.15);
  }

  private buildTower(p: Extract<Prop, { kind: "tower" }>) {
    const g = new THREE.Group();
    g.position.set(p.x, 0, p.z);
    // banded plastic segments like a stacking stunt tower, with a ribbed core
    const c = document.createElement("canvas");
    c.width = 512;
    c.height = 1024;
    const x = c.getContext("2d")!;
    x.fillStyle = p.color;
    x.fillRect(0, 0, 512, 1024);
    for (let i = 0; i < 24; i++) {
      x.fillStyle = i % 2 ? "rgba(0,0,0,0.16)" : "rgba(255,255,255,0.1)";
      x.fillRect(0, i * (1024 / 24), 512, 1024 / 48);
    }
    // a spiral stripe (it reads as motion even standing still)
    x.strokeStyle = "rgba(255,255,255,0.85)";
    x.lineWidth = 34;
    for (let k = -3; k < 6; k++) {
      x.beginPath();
      x.moveTo(-100, k * 260);
      x.lineTo(612, k * 260 + 340);
      x.stroke();
    }
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    t.wrapS = THREE.RepeatWrapping;
    t.repeat.set(2, 1);
    const body = new THREE.Mesh(new THREE.CylinderGeometry(p.r, p.r * 1.06, p.h, 48, 1, false), plastic("#ffffff", 0.38, { map: t, clearcoat: 0.6 }));
    body.position.y = p.h / 2;
    g.add(body);
    for (let i = 0; i <= Math.floor(p.h / 18); i++) {
      const ring = new THREE.Mesh(new THREE.TorusGeometry(p.r * 1.03, 0.55, 8, 48), plastic("#20242c", 0.35));
      ring.rotation.x = Math.PI / 2;
      ring.position.y = Math.min(p.h - 0.6, 0.6 + i * 18);
      g.add(ring);
    }
    const foot = new THREE.Mesh(new THREE.CylinderGeometry(p.r * 1.35, p.r * 1.45, 1.4, 48), plastic("#20242c", 0.4));
    foot.position.y = 0.7;
    g.add(foot);
    const cap = new THREE.Mesh(new THREE.CylinderGeometry(p.r * 1.08, p.r * 1.08, 1.6, 48), plastic("#20242c", 0.35));
    cap.position.y = p.h + 0.2;
    g.add(cap);
    if (p.label) {
      const lab = new THREE.Mesh(
        new THREE.CylinderGeometry(p.r * 1.012, p.r * 1.012, 7, 48, 1, true, -Math.PI * 0.42, Math.PI * 0.84),
        new THREE.MeshStandardMaterial({ map: labelTexture(p.label, "#15171c", "#ffffff", 1024, 140), roughness: 0.4 }),
      );
      lab.position.y = p.h * 0.62;
      g.add(lab);
    }
    // a pennant on top
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 22, 8), new THREE.MeshStandardMaterial({ color: "#e6e8eb", metalness: 0.9, roughness: 0.3 }));
    pole.position.set(0, p.h + 11, 0);
    g.add(pole);
    this.add(g);
    this.occlude(g, 0.28, true);
    this.buildFlag({ kind: "flag", x: p.x, z: p.z, h: p.h + 22, color: p.color }, true);
  }

  /** The ring of fire: a steel hoop on a post (the flames themselves are particles, in fx.ts). */
  private buildRing(p: Extract<Prop, { kind: "ring" }>) {
    const g = new THREE.Group();
    g.position.set(...p.at);
    g.rotation.y = p.yaw;
    const steel = new THREE.MeshStandardMaterial({ color: "#3b3f45", metalness: 0.9, roughness: 0.35 });
    const hoop = new THREE.Mesh(new THREE.TorusGeometry(p.r, 0.55, 12, 64), steel);
    g.add(hoop);
    // wicks round the hoop, charred
    const wick = new THREE.Mesh(new THREE.TorusGeometry(p.r, 0.75, 6, 64), new THREE.MeshStandardMaterial({ color: "#2a1b12", roughness: 0.95 }));
    wick.scale.set(1, 1, 0.6);
    g.add(wick);
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 0.6, p.at[1] - p.r, 10), steel);
    post.position.set(0, -(p.at[1] - p.r) / 2 - p.r, 0);
    g.add(post);
    const foot = new THREE.Mesh(new THREE.CylinderGeometry(3.4, 3.8, 0.6, 20), plastic("#20242c", 0.4));
    foot.position.set(0, -p.at[1] + 0.3, 0);
    g.add(foot);
    this.add(g);
    this.ringAt.set(...p.at);
  }

  private buildBin(p: Extract<Prop, { kind: "bin" }>) {
    const g = new THREE.Group();
    g.position.set(p.x, 0, p.z);
    g.rotation.y = p.yaw;
    const mat = plastic("#e3261c", 0.4, { clearcoat: 0.5 });
    const walls: [number, number, number, number, number, number][] = [
      [0, 0.3, 0, 28, 0.6, 28],
      [0, 6, 14, 28, 12, 0.8],
      [-14, 6, 0, 0.8, 12, 28],
      [14, 6, 0, 0.8, 12, 28],
      [0, 1.4, -14, 28, 2.8, 0.8],
    ];
    for (const [x, y, z, w, h, d] of walls) {
      const m = new THREE.Mesh(new RoundedBoxGeometry(w, h, d, 2, 0.3), mat);
      m.position.set(x, y, z);
      g.add(m);
    }
    const lab = new THREE.Mesh(new THREE.PlaneGeometry(22, 5), new THREE.MeshStandardMaterial({ map: labelTexture("CRASH BIN", "#e3261c", "#ffffff", 512, 116), roughness: 0.4 }));
    lab.position.set(0, 7, 14.45);
    g.add(lab);
    this.add(g);
    this.occlude(g, 0.25, true);
  }

  /** The drag strip's start tree: three ambers, a green and a red per lane, and a win light on top. */
  private buildTree(p: Extract<Prop, { kind: "tree" }>) {
    const g = new THREE.Group();
    g.position.set(p.x, 0, p.z);
    const dark = plastic("#16181d", 0.35, { clearcoat: 0.6 });
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(1.2, 1.5, 20, 12), dark);
    pole.position.y = 10;
    g.add(pole);
    const housing = new THREE.Mesh(new RoundedBoxGeometry(8.4, 17, 2.4, 2, 0.4), dark);
    housing.position.y = 28;
    g.add(housing);
    const foot = new THREE.Mesh(new THREE.CylinderGeometry(4, 4.4, 0.8, 20), dark);
    foot.position.y = 0.4;
    g.add(foot);
    const lamp = new THREE.SphereGeometry(0.95, 16, 10);
    const make = (color: string) => new THREE.MeshStandardMaterial({ color: "#222", emissive: new THREE.Color(color), emissiveIntensity: 0, roughness: 0.2 });
    const amber: THREE.MeshStandardMaterial[][] = [[], [], []];
    const green: THREE.MeshStandardMaterial[] = [];
    const red: THREE.MeshStandardMaterial[] = [];
    const win: THREE.MeshStandardMaterial[] = [];
    for (const lane of [0, 1]) {
      const x = lane ? 2.1 : -2.1;
      for (let i = 0; i < 3; i++) {
        const m = make("#ffae00");
        amber[i].push(m);
        const l = new THREE.Mesh(lamp, m);
        l.position.set(x, 33.5 - i * 2.6, 1.3);
        g.add(l);
      }
      const gm = make("#21ff5a");
      green.push(gm);
      const gl = new THREE.Mesh(lamp, gm);
      gl.position.set(x, 25.6, 1.3);
      g.add(gl);
      const rm = make("#ff1e1e");
      red.push(rm);
      const rl = new THREE.Mesh(lamp, rm);
      rl.position.set(x, 23, 1.3);
      g.add(rl);
      const wm = make("#ffffff");
      win.push(wm);
      const wl = new THREE.Mesh(new RoundedBoxGeometry(2.6, 1.2, 0.6, 1, 0.2), wm);
      wl.position.set(x, 37.4, 1.1);
      g.add(wl);
    }
    // turned to face the cars on the line (the lanes run along +x; the tree stands at their left)
    g.rotation.y = -Math.PI / 2;
    this.add(g);
    this.occlude(g, 0.15);
    this.tree = { amber, green, red, win };
  }

  private buildSign(p: Extract<Prop, { kind: "sign" }>) {
    const g = new THREE.Group();
    g.position.set(p.x, 0, p.z);
    g.rotation.y = p.yaw;
    const metal = new THREE.MeshStandardMaterial({ color: "#d6d9de", metalness: 0.9, roughness: 0.3 });
    for (const sx of [-1, 1]) {
      const post = new THREE.Mesh(new THREE.CylinderGeometry(1.2, 1.4, 22 + p.h, 12), metal);
      post.position.set(sx * (p.w / 2 - 4), (22 + p.h) / 2, -1.6);
      g.add(post);
    }
    const front = new THREE.MeshStandardMaterial({ map: signTexture(p.text, p.sub, p.color, p.w, p.h), roughness: 0.45 });
    const edge = plastic("#ffffff", 0.4);
    const panel = new THREE.Mesh(new RoundedBoxGeometry(p.w, p.h, 2, 3, 0.5), [edge, edge, edge, edge, front, plastic(p.color, 0.5)]);
    panel.position.set(0, 22 + p.h / 2, 0);
    g.add(panel);
    // marquee bulbs round the edge, lit at night
    const bulb = new THREE.SphereGeometry(0.55, 10, 8);
    const n = Math.floor((p.w + p.h) * 2 / 5);
    const per = (p.w + p.h) * 2;
    for (let i = 0; i < n; i++) {
      let d = (i / n) * per;
      let x = 0;
      let y = 0;
      if (d < p.w) [x, y] = [-p.w / 2 + d, p.h / 2];
      else if ((d -= p.w) < p.h) [x, y] = [p.w / 2, p.h / 2 - d];
      else if ((d -= p.h) < p.w) [x, y] = [p.w / 2 - d, -p.h / 2];
      else [x, y] = [-p.w / 2, -p.h / 2 + (d - p.w)];
      const b = new THREE.Mesh(bulb, this.bulbs);
      b.position.set(x * 0.97, 22 + p.h / 2 + y * 0.92, 1.2);
      b.userData.cast = false;
      g.add(b);
    }
    this.lamps.push(new THREE.Vector3(p.x, 22 + p.h / 2, p.z + 14));
    this.add(g);
    this.occlude(g, 0.12);
  }

  private flagMaterial(color: string) {
    const c = document.createElement("canvas");
    c.width = 128;
    c.height = 80;
    const x = c.getContext("2d")!;
    x.fillStyle = color;
    x.fillRect(0, 0, 128, 80);
    x.fillStyle = "#ffffff";
    for (let i = 0; i < 8; i++) for (let j = 0; j < 2; j++) if ((i + j) % 2) x.fillRect(i * 16, 64 + j * 8, 16, 8);
    x.beginPath();
    x.arc(48, 32, 16, 0, Math.PI * 2);
    x.fill();
    x.fillStyle = color;
    x.font = "italic 900 20px system-ui";
    x.textAlign = "center";
    x.textBaseline = "middle";
    x.fillText("64", 48, 33);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    const mat = new THREE.MeshStandardMaterial({ map: t, side: THREE.DoubleSide, roughness: 0.85 });
    const time = this.flagTime;
    mat.onBeforeCompile = (sh) => {
      sh.uniforms.uTime = time;
      sh.vertexShader = sh.vertexShader
        .replace("#include <common>", "#include <common>\nuniform float uTime;")
        .replace(
          "#include <begin_vertex>",
          `#include <begin_vertex>
          float k = uv.x;
          transformed.z += sin(uv.x * 6.0 - uTime * 5.0 + position.y * 0.2) * 0.9 * k + sin(uv.x * 13.0 - uTime * 9.0) * 0.25 * k;
          transformed.y -= k * k * 1.2;`,
        );
    };
    return mat;
  }

  private buildFlag(p: Extract<Prop, { kind: "flag" }>, poleOnly = false) {
    const g = new THREE.Group();
    g.position.set(p.x, 0, p.z);
    if (!poleOnly) {
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.45, p.h, 8), new THREE.MeshStandardMaterial({ color: "#e6e8eb", metalness: 0.9, roughness: 0.3 }));
      pole.position.y = p.h / 2;
      g.add(pole);
      const foot = new THREE.Mesh(new THREE.CylinderGeometry(2.4, 2.8, 0.7, 16), plastic("#20242c", 0.4));
      foot.position.y = 0.35;
      g.add(foot);
    }
    const ball = new THREE.Mesh(new THREE.SphereGeometry(0.7, 12, 8), new THREE.MeshStandardMaterial({ color: "#ffd21f", metalness: 0.8, roughness: 0.3 }));
    ball.position.y = p.h + 0.6;
    g.add(ball);
    const geo = new THREE.PlaneGeometry(16, 10, 24, 8);
    geo.translate(8, 0, 0);
    const cloth = new THREE.Mesh(geo, this.flagMaterial(p.color));
    cloth.position.set(0.3, p.h - 5.5, 0);
    cloth.rotation.y = -0.6 + (p.x % 7) * 0.05;
    g.add(cloth);
    this.flags.push({ cloth });
    this.add(g);
    this.occlude(g, 0.08);
  }

  /** Bleachers with a crowd of peg figures, who jump up when something good happens. */
  private buildStand(p: Extract<Prop, { kind: "stand" }>) {
    const g = new THREE.Group();
    g.position.set(p.x, 0, p.z);
    g.rotation.y = p.yaw;
    const step = plastic("#c9cdd3", 0.5);
    const seat = plastic("#2a5bd7", 0.4);
    for (let i = 0; i < 4; i++) {
      const s = new THREE.Mesh(new RoundedBoxGeometry(60, 4 * (i + 1), 6, 2, 0.4), step);
      s.position.set(0, 2 * (i + 1), -9 + i * 6);
      g.add(s);
      const strip = new THREE.Mesh(new RoundedBoxGeometry(58, 0.6, 3, 1, 0.2), seat);
      strip.position.set(0, 4 * (i + 1) + 0.3, -9 + i * 6 - 1);
      g.add(strip);
    }
    const roofMat = plastic("#ff3b30", 0.4);
    for (const sx of [-1, 1]) {
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 0.6, 34, 8), new THREE.MeshStandardMaterial({ color: "#e6e8eb", metalness: 0.9, roughness: 0.3 }));
      post.position.set(sx * 29, 17, 11);
      g.add(post);
    }
    const roof = new THREE.Mesh(new RoundedBoxGeometry(64, 1.2, 28, 2, 0.4), roofMat);
    roof.position.set(0, 34, 0);
    roof.rotation.x = 0.12;
    g.add(roof);
    // the crowd: peg people, a head and a body, in bright clothes
    reseedCrowd(p.x);
    const bodies: Peg[] = [];
    for (let row = 0; row < 4; row++)
      for (let i = 0; i < 11; i++) {
        if (crowd() < 0.18) continue;
        const local = new THREE.Vector3(-26 + i * 5.2 + (crowd() - 0.5) * 1.4, 4 * (row + 1) + 0.6, -9 + row * 6 + 0.6);
        bodies.push({ base: new THREE.Matrix4().makeTranslation(local.x, local.y, local.z), phase: crowd() * 6, jump: 0 });
      }
    const bodyGeo = new THREE.CylinderGeometry(1.0, 1.15, 3.2, 12);
    bodyGeo.translate(0, 1.6, 0);
    const headGeo = new THREE.SphereGeometry(0.95, 14, 10);
    headGeo.translate(0, 4.1, 0);
    const mesh = new THREE.InstancedMesh(bodyGeo, plastic("#ffffff", 0.35, { clearcoat: 0.6 }), bodies.length);
    const heads = new THREE.InstancedMesh(headGeo, plastic("#f2c9a0", 0.4), bodies.length);
    const shirts = ["#ff3b30", "#0a84ff", "#ffcc00", "#34c759", "#bf5af2", "#ff9f0a", "#f2f2f2", "#1c1c1e"];
    const skins = ["#f2c9a0", "#d9a374", "#a8714a", "#7a4e2d", "#f5d6b8"];
    const col = new THREE.Color();
    bodies.forEach((b, i) => {
      mesh.setColorAt(i, col.set(shirts[Math.floor(crowd() * shirts.length)]));
      heads.setColorAt(i, col.set(skins[Math.floor(crowd() * skins.length)]));
      mesh.setMatrixAt(i, b.base);
      heads.setMatrixAt(i, b.base);
    });
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    heads.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    g.add(mesh, heads);
    this.add(g);
    this.occlude(g, 0.12);
    this.crowds.push({ mesh, heads, list: bodies });
  }

  /** A string of pennants (and little bulbs between them) hung between two points. */
  private buildBunting(p: Extract<Prop, { kind: "bunting" }>) {
    const a = new THREE.Vector3(...p.a);
    const b = new THREE.Vector3(...p.b);
    const pts: THREE.Vector3[] = [];
    const N = 40;
    for (let i = 0; i <= N; i++) {
      const t = i / N;
      pts.push(a.clone().lerp(b, t).add(new THREE.Vector3(0, -Math.sin(Math.PI * t) * p.sag, 0)));
    }
    const curve = new THREE.CatmullRomCurve3(pts);
    const line = new THREE.Mesh(new THREE.TubeGeometry(curve, 60, 0.12, 5), new THREE.MeshStandardMaterial({ color: "#f0f0f0", roughness: 0.6 }));
    this.add(line);
    const len = a.distanceTo(b);
    const count = Math.floor(len / 6);
    const tri = new THREE.BufferGeometry();
    tri.setAttribute("position", new THREE.Float32BufferAttribute([-1.9, 0, 0, 1.9, 0, 0, 0, -4.2, 0], 3));
    tri.setAttribute("normal", new THREE.Float32BufferAttribute([0, 0, 1, 0, 0, 1, 0, 0, 1], 3));
    const pen = new THREE.InstancedMesh(tri, new THREE.MeshStandardMaterial({ side: THREE.DoubleSide, roughness: 0.8 }), count);
    const bulbs = new THREE.InstancedMesh(new THREE.SphereGeometry(0.45, 8, 6), this.bulbs, count);
    const colors = ["#ff3b30", "#ffcc00", "#0a84ff", "#34c759", "#ffffff", "#ff9f0a"];
    const dir = b.clone().sub(a).setY(0).normalize();
    const yaw = Math.atan2(dir.x, dir.z) - Math.PI / 2;
    const col = new THREE.Color();
    for (let i = 0; i < count; i++) {
      const t = (i + 0.5) / count;
      const at = curve.getPointAt(t);
      pen.setMatrixAt(i, m4.compose(at, q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw), one));
      pen.setColorAt(i, col.set(colors[i % colors.length]));
      const bt = Math.min(1, (i + 1) / count);
      bulbs.setMatrixAt(i, m4.compose(curve.getPointAt(bt).add(new THREE.Vector3(0, -0.5, 0)), q.identity(), one));
    }
    pen.userData.cast = false;
    bulbs.userData.cast = false;
    this.add(pen);
    this.add(bulbs);
    this.occlude([line, pen, bulbs], 0.08);
  }

  // —————————————————————————————————————————— the block castle

  private buildBlocks(sim: Sim) {
    if (!sim.blocks.length) return;
    const atlas = blockAtlas();
    const geo = new RoundedBoxGeometry(BLOCK, BLOCK, BLOCK, 3, 0.28);
    const cells = new Float32Array(sim.blocks.length * 2);
    sim.blocks.forEach((b, i) => {
      cells[i * 2] = b.letter % 4;
      cells[i * 2 + 1] = 3 - Math.floor(b.letter / 4);
    });
    geo.setAttribute("aCell", new THREE.InstancedBufferAttribute(cells, 2));
    const mat = new THREE.MeshPhysicalMaterial({ map: atlas, roughness: 0.55, clearcoat: 0.35, clearcoatRoughness: 0.4 });
    mat.onBeforeCompile = (sh) => {
      sh.vertexShader = sh.vertexShader
        .replace("#include <common>", "#include <common>\nattribute vec2 aCell;")
        .replace("#include <uv_vertex>", "#include <uv_vertex>\nvMapUv = (uv + aCell) / 4.0;");
    };
    const mesh = new THREE.InstancedMesh(geo, mat, sim.blocks.length);
    const col = new THREE.Color();
    sim.blocks.forEach((b, i) => {
      mesh.setColorAt(i, col.set(b.color));
      mesh.setMatrixAt(i, m4.compose(b.pos, b.quat, one));
    });
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.frustumCulled = false;
    this.blocks = mesh;
    this.add(mesh);
  }

  // —————————————————————————————————————————— live state

  /** How far back a launcher's plunger is pulled (0..1). */
  setPull(trackId: string, k: number) {
    for (const l of this.launchers) if (l.track === trackId) l.target = k;
  }
  /** The plunger fires: it snaps forward. */
  kick(trackId: string) {
    for (const l of this.launchers)
      if (l.track === trackId) {
        l.kick = 1;
        l.target = 0;
      }
  }
  setGate(trackId: string, open: boolean) {
    for (const g of this.gates) if (g.track === trackId) g.target = open ? 1 : 0;
  }
  /** The start tree: how many ambers are lit, green, a red light (per lane), and who won. */
  setTree(s: { ambers: number; green: boolean; red: [boolean, boolean]; win: [boolean, boolean] }) {
    if (!this.tree) return;
    for (let i = 0; i < 3; i++) for (const m of this.tree.amber[i]) m.emissiveIntensity = s.ambers > i ? 5 : 0;
    for (const m of this.tree.green) m.emissiveIntensity = s.green ? 6 : 0;
    this.tree.red.forEach((m, i) => (m.emissiveIntensity = s.red[i] ? 6 : 0));
    this.tree.win.forEach((m, i) => (m.emissiveIntensity = s.win[i] ? 4 : 0));
  }
  /** The crowd jumps. */
  cheer(strength = 1) {
    for (const c of this.crowds) for (const p of c.list) p.jump = Math.max(p.jump, strength * (0.6 + Math.random() * 0.6));
  }
  /** A booster flares when a car passes through it. */
  boost(at: THREE.Vector3) {
    let best: Booster | null = null;
    let d = Infinity;
    for (const b of this.boosters) {
      const dd = b.at.distanceToSquared(at);
      if (dd < d) [best, d] = [b, dd];
    }
    if (best) best.hot = 1;
  }

  setNight(k: number) {
    this.glow.value = k;
    this.bulbs.emissiveIntensity = 0.2 + k * 6;
    this.beams.opacity = 0.35 + k * 0.6;
    // the ghosts are unlit, so they'd glow in the dark: dim them with the room
    if (Math.abs(k - this.ghostNight) > 0.01) {
      this.ghostNight = k;
      for (const o of this.occluders) for (const p of o.parts) for (const g of p.ghost) g.color.copy(g.userData.base as THREE.Color).multiplyScalar(1 - 0.75 * k);
    }
  }

  update(dt: number, t: number, sim: Sim, fire: number, blocksLive = true) {
    this.flagTime.value = t;
    for (const l of this.launchers) {
      // pulled back slowly against the spring; released, it snaps forward and bounces
      if (l.kick > 0) {
        l.kick = Math.max(0, l.kick - dt * 4);
        l.pull = -Math.sin((1 - l.kick) * Math.PI) * 0.12 * l.kick;
      } else l.pull += (l.target - l.pull) * Math.min(1, dt * 10);
      const rest = l.plunger.userData.rest as number;
      l.plunger.position.z = rest - l.pull * 4.4;
      // the spring squeezes up as the plunger comes back
      const spring = l.knob as THREE.Mesh;
      spring.scale.z = Math.max(0.35, 1 - l.pull * 0.6);
      spring.position.z = rest - 0.3 - l.pull * 4.4 + (1 - spring.scale.z) * 0;
    }
    for (const b of this.boosters) {
      b.hot = Math.max(0, b.hot - dt * 2.5);
      b.spin += dt * (24 + b.hot * 30);
      b.wheels[0].rotation.y = b.spin;
      b.wheels[1].rotation.y = -b.spin;
      b.led.emissiveIntensity = 0.8 + b.hot * 8 + Math.sin(t * 6) * 0.3;
    }
    for (const g of this.gates) {
      g.open += (g.target - g.open) * Math.min(1, dt * 9);
      g.arm.rotation.z = -g.open * 1.45;
    }
    // the castle follows its physics
    if (blocksLive) this.yard.update(sim, t);
    if (this.blocks && blocksLive) {
      for (let i = 0; i < sim.blockBodies.length; i++) {
        const rb = sim.blockBodies[i];
        if (rb.isSleeping() && !this.blocks.userData.full) continue;
        this.blocks.setMatrixAt(i, m4.compose(v.copy(rb.translation() as THREE.Vector3), q.copy(rb.rotation() as THREE.Quaternion), one));
      }
      this.blocks.userData.full = false;
      this.blocks.instanceMatrix.needsUpdate = true;
    }
    for (const c of this.crowds) {
      let dirty = false;
      c.list.forEach((p, i) => {
        if (p.jump <= 0.001 && Math.sin(t * 1.3 + p.phase) < 0.995) return;
        p.jump = Math.max(0, p.jump - dt * 0.9);
        const hop = Math.abs(Math.sin((t * 9 + p.phase) * 1.0)) * 1.6 * Math.min(1, p.jump * 2);
        m4.copy(p.base).multiply(new THREE.Matrix4().makeTranslation(0, hop, 0));
        c.mesh.setMatrixAt(i, m4);
        c.heads.setMatrixAt(i, m4);
        dirty = true;
      });
      if (dirty) {
        c.mesh.instanceMatrix.needsUpdate = true;
        c.heads.instanceMatrix.needsUpdate = true;
      }
    }
    // the ring of fire lights its surroundings, flickering
    this.ringLight.intensity = fire * (240 + Math.sin(t * 23) * 45 + Math.sin(t * 37 + 1) * 35);
  }

  /** After a reset the castle needs every block redrawn once. */
  refresh() {
    if (this.blocks) this.blocks.userData.full = true;
    this.yard.full = true;
  }

  dispose() {
    // everything back on its real material (so the sweep below finds them), then the ghosts go
    for (const o of this.occluders) {
      if (o.ghosted) this.ghost(o, false);
      for (const p of o.parts) for (const g of p.ghost) g.dispose();
    }
    this.root.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (mesh.geometry) mesh.geometry.dispose();
      const mat = mesh.material as THREE.Material | THREE.Material[] | undefined;
      for (const x of Array.isArray(mat) ? mat : mat ? [mat] : []) {
        for (const val of Object.values(x)) if (val instanceof THREE.Texture) val.dispose();
        x.dispose();
      }
    });
    for (const d of this.disposables) d.dispose();
  }
}

let crowdSeed = 1;
const reseedCrowd = (s: number) => void (crowdSeed = (Math.abs(Math.floor(s * 97)) + 13) >>> 0);
const crowd = () => ((crowdSeed = (crowdSeed * 1664525 + 1013904223) >>> 0) / 4294967296);
