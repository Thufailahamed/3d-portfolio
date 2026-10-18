import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { clamp, damp, lerp } from "./noise";
import { ROVER, type RoverSim } from "./physics";
import { makeFoilTexture } from "./textures";

/**
 * A Curiosity-class rover built from primitives: warm electronics box, rocker-bogie suspension,
 * six grousered aluminium wheels, remote-sensing mast, high-gain antenna, MMRTG, and the robotic arm.
 * Body frame matches the physics: +z forward, +x left, origin at the centre of mass.
 */

type Mats = Record<"white" | "foil" | "alu" | "dark" | "black" | "ti" | "fin" | "glass" | "lens" | "copper", THREE.MeshStandardMaterial>;

function mats(): Mats {
  const foilTex = makeFoilTexture();
  return {
    white: new THREE.MeshStandardMaterial({ color: "#bdb9b1", roughness: 0.68, metalness: 0.05 }),
    foil: new THREE.MeshStandardMaterial({ color: "#f2c46a", map: foilTex, roughness: 0.28, metalness: 0.75, emissive: "#3a2a08", emissiveIntensity: 0.6 }),
    // anodised wheels: mostly diffuse, so they still read under a black airless sky
    alu: new THREE.MeshStandardMaterial({ color: "#b9bdc3", roughness: 0.5, metalness: 0.35, side: THREE.DoubleSide }),
    dark: new THREE.MeshStandardMaterial({ color: "#3a3d42", roughness: 0.5, metalness: 0.6, side: THREE.DoubleSide }),
    black: new THREE.MeshStandardMaterial({ color: "#121316", roughness: 0.4, metalness: 0.3 }),
    ti: new THREE.MeshStandardMaterial({ color: "#9a9893", roughness: 0.42, metalness: 0.9 }),
    fin: new THREE.MeshStandardMaterial({ color: "#26282c", roughness: 0.7, metalness: 0.4 }),
    glass: new THREE.MeshStandardMaterial({ color: "#1b2a4a", roughness: 0.05, metalness: 0.9, emissive: "#0a1428", emissiveIntensity: 0.4 }),
    lens: new THREE.MeshStandardMaterial({ color: "#0c0d10", roughness: 0.1, metalness: 0.8 }),
    copper: new THREE.MeshStandardMaterial({ color: "#b0703e", roughness: 0.4, metalness: 0.9 }),
  };
}

const box = (w: number, h: number, d: number, m: THREE.Material, x = 0, y = 0, z = 0) => {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
  mesh.position.set(x, y, z);
  return mesh;
};
const cyl = (r: number, h: number, m: THREE.Material, seg = 16, r2 = r) => new THREE.Mesh(new THREE.CylinderGeometry(r2, r, h, seg), m);

/** one wheel: thin-skin drum with 24 chevron grousers, six curved titanium spokes; axle along x */
function wheelGeometry() {
  const R = ROVER.wheelR;
  const W = ROVER.wheelW;
  const parts: THREE.BufferGeometry[] = [];
  const drum = new THREE.CylinderGeometry(R - 0.012, R - 0.012, W, 48, 1, true);
  drum.rotateZ(Math.PI / 2);
  parts.push(drum);
  const n = 24;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    for (const side of [-1, 1]) {
      const g = new THREE.BoxGeometry(W * 0.5, 0.016, 0.01);
      g.rotateY(side * 0.17);
      g.translate((side * W) / 4.2, R, side * 0.02);
      g.rotateX(a);
      parts.push(g);
    }
  }
  const rim = mergeGeometries(parts.map((p) => p.toNonIndexed()))!;
  parts.forEach((p) => p.dispose());
  // spokes on the outer face: gentle S-curves that flex on impact
  const spokes: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    const pts: THREE.Vector3[] = [];
    for (let k = 0; k <= 8; k++) {
      const t = k / 8;
      const rr = 0.06 + t * (R - 0.075);
      const aa = a + Math.sin(t * Math.PI) * 0.45;
      pts.push(new THREE.Vector3(W / 2 - 0.02 - Math.sin(t * Math.PI) * 0.05, Math.cos(aa) * rr, Math.sin(aa) * rr));
    }
    spokes.push(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 10, 0.011, 5, false));
  }
  const hub = new THREE.CylinderGeometry(0.07, 0.07, 0.12, 16);
  hub.rotateZ(Math.PI / 2);
  hub.translate(W / 2 - 0.06, 0, 0);
  spokes.push(hub);
  const inner = new THREE.RingGeometry(0.05, R - 0.015, 32);
  inner.rotateY(-Math.PI / 2);
  inner.translate(-W / 2 + 0.03, 0, 0);
  const sp = mergeGeometries(spokes.map((p) => p.toNonIndexed()))!;
  spokes.forEach((p) => p.dispose());
  return { rim, spokes: sp, inner };
}

export class RoverModel {
  readonly root = new THREE.Group();
  readonly body = new THREE.Group();
  wheels: { steer: THREE.Group; spin: THREE.Group; strut: THREE.Mesh; motor: THREE.Mesh | null }[] = [];
  private links: { mesh: THREE.Mesh; a: THREE.Vector3; b: THREE.Vector3 }[] = [];
  private m: Mats;
  private mast = new THREE.Group();
  private mastHead = new THREE.Group();
  private mastTilt = new THREE.Group();
  private hga = new THREE.Group();
  private hgaDish = new THREE.Group();
  private diff = new THREE.Group();
  private arm: { base: THREE.Group; shoulder: THREE.Group; elbow: THREE.Group; wrist: THREE.Group; turret: THREE.Group; drill: THREE.Mesh };
  /** 0 stowed (cruise), 1 deployed */
  deploy = 1;
  /** mobility: wheels folded under (0) or standing (1) */
  standing = 1;
  armPose = 0;
  armTarget = 0;
  drillSpin = 0;
  mastYaw = 0;
  mastPitch = 0;
  mastAim: { yaw: number; pitch: number } | null = null;
  lights: THREE.SpotLight[] = [];
  dust = 0;
  private dustColor = new THREE.Color();
  private clean: Record<string, THREE.Color> = {};
  private geos: THREE.BufferGeometry[] = [];

  constructor() {
    const m = (this.m = mats());
    for (const [k, v] of Object.entries(m)) this.clean[k] = v.color.clone();
    this.root.add(this.body);

    // —— warm electronics box ——
    const web = new THREE.Group();
    web.position.y = 0.1;
    this.body.add(web);
    web.add(box(1.72, 0.48, 2.12, m.white));
    // deck trim and gold-foil equipment
    web.add(box(1.76, 0.03, 2.16, m.ti, 0, 0.245, 0));
    web.add(box(0.62, 0.16, 0.5, m.foil, -0.35, 0.33, 0.35));
    web.add(box(0.42, 0.12, 0.38, m.foil, 0.42, 0.31, -0.25));
    web.add(box(0.3, 0.2, 0.3, m.white, -0.5, 0.35, -0.55));
    web.add(box(1.0, 0.05, 0.08, m.dark, 0, 0.27, 0.85));
    // sample inlets (SAM, CheMin) — small funnels on the deck
    for (const [x, z] of [[0.15, 0.55], [0.32, 0.5], [-0.05, 0.62]] as [number, number][]) {
      const f = cyl(0.04, 0.05, m.alu, 10, 0.06);
      f.position.set(x, 0.29, z);
      web.add(f);
    }
    // sides: radiator panels and cable runs
    for (const s of [-1, 1]) {
      web.add(box(0.02, 0.36, 1.7, m.ti, s * 0.87, 0, 0));
      for (let k = 0; k < 4; k++) web.add(box(0.025, 0.02, 1.6, m.copper, s * 0.885, -0.12 + k * 0.07, 0));
    }
    // hazcams front and back
    for (const z of [1.07, -1.07]) {
      const bar = box(0.7, 0.07, 0.07, m.dark, 0, -0.16, z);
      web.add(bar);
      for (const x of [-0.28, -0.14, 0.14, 0.28]) {
        const l = cyl(0.022, 0.03, m.lens, 12);
        l.rotation.x = Math.PI / 2;
        l.position.set(x, -0.16, z + Math.sign(z) * 0.04);
        web.add(l);
      }
    }
    // sundial calibration target, UHF and low-gain antennas
    const uhf = cyl(0.03, 0.32, m.white, 10);
    uhf.position.set(0.55, 0.42, -0.75);
    web.add(uhf);
    const lga = cyl(0.05, 0.24, m.alu, 10, 0.02);
    lga.position.set(-0.7, 0.38, -0.85);
    web.add(lga);
    const cal = box(0.12, 0.04, 0.12, m.white, 0.75, 0.28, 0.2);
    web.add(cal);

    // —— MMRTG: finned cylinder tilted up at the back ——
    const rtg = new THREE.Group();
    rtg.position.set(0, 0.25, -1.28);
    rtg.rotation.x = -0.55;
    this.body.add(rtg);
    const core = cyl(0.17, 0.66, m.fin, 20);
    core.rotation.x = Math.PI / 2;
    core.position.z = -0.25;
    rtg.add(core);
    for (let i = 0; i < 8; i++) {
      const fin = box(0.02, 0.34, 0.62, m.fin);
      const a = (i / 8) * Math.PI * 2;
      fin.position.set(Math.cos(a) * 0.3, Math.sin(a) * 0.3, -0.25);
      fin.rotation.z = a + Math.PI / 2;
      rtg.add(fin);
    }
    const strut = box(0.08, 0.08, 0.4, m.ti, 0, 0, 0.1);
    rtg.add(strut);

    // —— remote-sensing mast ——
    this.mast.position.set(0.55, 0.36, 0.72);
    this.body.add(this.mast);
    const pole = cyl(0.055, 1.25, m.white, 14);
    pole.position.y = 0.62;
    this.mast.add(pole);
    // weather-station booms (REMS)
    for (const s of [-1, 1]) {
      const b = box(0.02, 0.02, 0.22, m.ti, 0, 0.9, s * 0.1);
      b.rotation.y = s * 0.6;
      b.position.x = s * 0.08;
      this.mast.add(b);
    }
    this.mastHead.position.y = 1.28;
    this.mast.add(this.mastHead);
    this.mastHead.add(this.mastTilt);
    const head = box(0.34, 0.2, 0.26, m.white);
    this.mastTilt.add(head);
    const chem = cyl(0.075, 0.12, m.white, 18);
    chem.rotation.x = Math.PI / 2;
    chem.position.set(0, 0.16, 0.02);
    this.mastTilt.add(chem);
    const chemLens = cyl(0.058, 0.02, m.glass, 18);
    chemLens.rotation.x = Math.PI / 2;
    chemLens.position.set(0, 0.16, 0.09);
    this.mastTilt.add(chemLens);
    for (const x of [-0.11, -0.04, 0.04, 0.11]) {
      const l = cyl(x * x > 0.005 ? 0.024 : 0.018, 0.04, m.lens, 12);
      l.rotation.x = Math.PI / 2;
      l.position.set(x, -0.03, 0.14);
      this.mastTilt.add(l);
    }

    // —— high-gain antenna on a two-axis gimbal ——
    this.hga.position.set(-0.52, 0.36, -0.42);
    this.body.add(this.hga);
    const post = cyl(0.04, 0.32, m.ti, 10);
    post.position.y = 0.16;
    this.hga.add(post);
    this.hgaDish.position.y = 0.34;
    this.hga.add(this.hgaDish);
    const dish = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 0.035, 6), m.white);
    dish.rotation.x = Math.PI / 2;
    this.hgaDish.add(dish);
    const feed = cyl(0.03, 0.09, m.foil, 8);
    feed.rotation.x = Math.PI / 2;
    feed.position.z = 0.06;
    this.hgaDish.add(feed);

    // —— robotic arm (shoulder azimuth → shoulder → elbow → wrist → turret) ——
    const base = new THREE.Group();
    base.position.set(0.35, 0.15, 1.1);
    this.body.add(base);
    const shoulder = new THREE.Group();
    base.add(shoulder);
    shoulder.add(cyl(0.07, 0.14, m.white, 12));
    const upper = box(0.09, 0.09, 1.05, m.white, 0, 0, 0.52);
    shoulder.add(upper);
    const elbow = new THREE.Group();
    elbow.position.z = 1.05;
    shoulder.add(elbow);
    elbow.add(cyl(0.065, 0.12, m.white, 12));
    elbow.add(box(0.08, 0.08, 0.85, m.white, 0, 0, 0.42));
    const wrist = new THREE.Group();
    wrist.position.z = 0.85;
    elbow.add(wrist);
    const turret = new THREE.Group();
    turret.position.z = 0.1;
    wrist.add(turret);
    turret.add(box(0.2, 0.2, 0.2, m.foil));
    const drill = cyl(0.03, 0.3, m.ti, 10);
    drill.position.set(0, -0.22, 0);
    turret.add(drill);
    const tool2 = cyl(0.05, 0.14, m.dark, 10);
    tool2.rotation.z = Math.PI / 2;
    tool2.position.set(0.17, 0, 0);
    turret.add(tool2);
    const tool3 = box(0.12, 0.12, 0.16, m.white, -0.16, 0, 0);
    turret.add(tool3);
    const mahli = cyl(0.03, 0.08, m.lens, 10);
    mahli.position.set(0, 0.16, 0);
    turret.add(mahli);
    this.arm = { base, shoulder, elbow, wrist, turret, drill };

    // —— rocker-bogie and wheels ——
    const wg = wheelGeometry();
    this.geos.push(wg.rim, wg.spokes, wg.inner);
    for (let i = 0; i < 6; i++) {
      const steer = new THREE.Group();
      this.root.add(steer);
      const spin = new THREE.Group();
      steer.add(spin);
      const side = ROVER.mounts[i][0] > 0 ? 1 : -1;
      const rim = new THREE.Mesh(wg.rim, m.alu);
      const spokes = new THREE.Mesh(wg.spokes, m.ti);
      const inner = new THREE.Mesh(wg.inner, m.dark);
      // the spoked face points outward on both sides
      const flip = new THREE.Group();
      flip.scale.x = side;
      flip.add(rim, spokes, inner);
      spin.add(flip);
      rim.castShadow = spokes.castShadow = true;
      const strutM = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 1, 8), m.ti);
      this.root.add(strutM);
      let motor: THREE.Mesh | null = null;
      if (ROVER.steerable[i]) {
        motor = cyl(0.07, 0.16, m.dark, 12);
        this.root.add(motor);
      }
      const hubCap = cyl(0.06, 0.1, m.dark, 10);
      hubCap.rotation.z = Math.PI / 2;
      hubCap.position.x = -side * 0.22;
      steer.add(hubCap);
      this.wheels.push({ steer, spin, strut: strutM, motor });
    }
    // linkage tubes: rocker (pivot→rear, pivot→bogie), bogie (→front, →middle), per side
    for (let k = 0; k < 8; k++) {
      const mesh = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 1, 10), m.ti);
      mesh.castShadow = true;
      this.root.add(mesh);
      this.links.push({ mesh, a: new THREE.Vector3(), b: new THREE.Vector3() });
    }
    // differential bar across the deck
    this.diff.position.set(0, 0.42, -0.1);
    this.body.add(this.diff);
    this.diff.add(box(1.7, 0.05, 0.06, m.ti));

    // work lights (off by default)
    for (const x of [-0.5, 0.5]) {
      const l = new THREE.SpotLight("#fff3e0", 0, 60, 0.55, 0.5, 1.5);
      l.position.set(x, 0.1, 1.15);
      l.target.position.set(x * 2, -1.5, 9);
      this.body.add(l, l.target);
      this.lights.push(l);
    }

    this.root.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) {
        o.castShadow = true;
        o.receiveShadow = true;
      }
    });
  }

  /** settle the dust colour for this world (the rover gets dirtier as it drives) */
  setDust(color: string) {
    this.dustColor.set(color);
  }

  setLights(on: boolean) {
    for (const l of this.lights) l.intensity = on ? 60 : 0;
  }

  private placeLink(k: number, a: THREE.Vector3, b: THREE.Vector3) {
    const L = this.links[k];
    const d = new THREE.Vector3().subVectors(b, a);
    const len = d.length();
    L.mesh.position.copy(a).addScaledVector(d, 0.5);
    L.mesh.scale.set(1, Math.max(0.01, len), 1);
    L.mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize());
  }

  /**
   * Pose the model from the sim (or from a kinematic pose during the landing).
   * `fold` (0..1) tucks the wheels under the belly as they were for the cruise.
   */
  update(dt: number, sim: RoverSim | null, pose?: { pos: THREE.Vector3; quat: THREE.Quaternion }, sinkK = 0) {
    const pos = sim && sim.enabled ? sim.pos : pose!.pos;
    const quat = sim && sim.enabled ? sim.quat : pose!.quat;
    this.root.position.set(0, 0, 0);
    this.body.position.copy(pos);
    this.body.quaternion.copy(quat);
    this.body.updateMatrixWorld();
    const M = this.body.matrixWorld;
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(quat);
    const fold = 1 - this.standing;

    const hubs: THREE.Vector3[] = [];
    const tops: THREE.Vector3[] = [];
    for (let i = 0; i < 6; i++) {
      const w = this.wheels[i];
      const mount = ROVER.mounts[i];
      const simW = sim?.enabled ? sim.wheels[i] : null;
      let len = simW ? simW.len : ROVER.restLen;
      // stowed: wheels pulled up and in under the chassis
      len = lerp(len, 0.22, fold);
      const local = new THREE.Vector3(mount[0] * (1 - fold * 0.3), mount[1] - len, mount[2] * (1 - fold * 0.12));
      const hub = local.clone().applyMatrix4(M);
      if (simW?.contact) hub.addScaledVector(up, -sinkK * Math.min(1, simW.load / 4000));
      hubs.push(hub);
      w.steer.position.copy(hub);
      const steerA = simW ? simW.steer : 0;
      w.steer.quaternion.copy(quat).multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), steerA));
      w.spin.rotation.x = simW ? simW.spin : w.spin.rotation.x;
      // strut from the hub up to the linkage
      const top = hub.clone().addScaledVector(up, 0.42);
      tops.push(top);
      const mid = hub.clone().addScaledVector(up, 0.21);
      w.strut.position.copy(mid);
      w.strut.quaternion.copy(quat);
      w.strut.scale.set(1, 0.42, 1);
      // the strut sits inboard of the wheel
      const inb = new THREE.Vector3(-Math.sign(mount[0]) * 0.24, 0, 0).applyQuaternion(quat);
      w.strut.position.add(inb);
      tops[i].add(inb);
      if (w.motor) {
        w.motor.position.copy(top);
        w.motor.quaternion.copy(quat);
      }
    }
    for (let s = 0; s < 2; s++) {
      const sx = s === 0 ? 1 : -1;
      const pivot = new THREE.Vector3(sx * 0.98, 0.02, -0.12).applyMatrix4(M);
      const front = tops[s];
      const middle = tops[2 + s];
      const rear = tops[4 + s];
      const bogie = front.clone().add(middle).multiplyScalar(0.5).addScaledVector(up, 0.14);
      this.placeLink(s * 4, pivot, rear);
      this.placeLink(s * 4 + 1, pivot, bogie);
      this.placeLink(s * 4 + 2, bogie, front);
      this.placeLink(s * 4 + 3, bogie, middle);
    }
    // differential: the bar rocks with the difference between the rockers
    if (sim?.enabled) {
      const dl = sim.wheels[4].comp - (sim.wheels[0].comp + sim.wheels[2].comp) / 2;
      const dr = sim.wheels[5].comp - (sim.wheels[1].comp + sim.wheels[3].comp) / 2;
      this.diff.rotation.y = clamp((dl - dr) * 0.8, -0.25, 0.25);
    }

    // mast: folds flat on the deck for the cruise, stands and scans once deployed
    const d = this.deploy;
    this.mast.rotation.x = lerp(-Math.PI / 2 + 0.05, 0, clamp(d * 1.6, 0, 1));
    const aim = this.mastAim;
    const idle = performance.now() / 1000;
    const ty = aim ? aim.yaw : Math.sin(idle * 0.23) * 0.7;
    const tp = aim ? aim.pitch : -0.18 + Math.sin(idle * 0.31) * 0.1;
    this.mastYaw = damp(this.mastYaw, ty, aim ? 10 : 1.2, dt);
    this.mastPitch = damp(this.mastPitch, tp, aim ? 10 : 1.2, dt);
    this.mastHead.rotation.y = this.mastYaw * clamp(d * 2 - 1, 0, 1);
    this.mastTilt.rotation.x = -this.mastPitch * clamp(d * 2 - 1, 0, 1);
    // HGA unfolds, then keeps pointing at Earth
    this.hga.rotation.x = lerp(-Math.PI / 2, 0, clamp(d * 2 - 0.6, 0, 1));

    // arm: stowed across the front, or reaching to the ground for a sample
    this.armPose = damp(this.armPose, this.armTarget, 1.6, dt);
    const p = this.armPose;
    const a = this.arm;
    a.base.rotation.y = lerp(-1.25, 0, p);
    a.shoulder.rotation.x = lerp(0.05, 0.55, p);
    a.elbow.rotation.x = lerp(-2.6, -0.2, p);
    a.wrist.rotation.x = lerp(2.4, 1.2, p);
    this.drillSpin += dt * (p > 0.92 && this.armTarget > 0.5 ? 40 : 0);
    a.drill.rotation.y = this.drillSpin;

    // dust settles on everything with distance driven
    const k = clamp(this.dust, 0, 0.55);
    for (const key of ["white", "alu", "ti", "foil", "dark"] as const) this.m[key].color.copy(this.clean[key]).lerp(this.dustColor, key === "white" ? k : k * 0.6);
  }

  /** point the HGA at a direction in world space (Earth) */
  aimHGA(dirWorld: THREE.Vector3) {
    const inv = this.body.quaternion.clone().invert();
    const local = dirWorld.clone().applyQuaternion(inv);
    const yaw = Math.atan2(local.x, local.z);
    const pitch = Math.atan2(local.y, Math.hypot(local.x, local.z));
    this.hgaDish.rotation.set(0, 0, 0);
    this.hgaDish.rotateY(yaw);
    this.hgaDish.rotateX(-pitch);
  }

  /** world position of the mast camera (for the Navcam view) */
  mastCamera(out: THREE.Vector3) {
    return this.mastTilt.getWorldPosition(out);
  }

  drillTip(out: THREE.Vector3) {
    return this.arm.drill.localToWorld(out.set(0, -0.16, 0));
  }

  dispose() {
    this.geos.forEach((g) => g.dispose());
    this.root.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (mesh.isMesh) mesh.geometry.dispose();
    });
    Object.values(this.m).forEach((m) => {
      m.map?.dispose();
      m.dispose();
    });
  }
}
