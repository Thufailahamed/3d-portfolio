import * as THREE from "three";
import { clamp, lerp, smoothstep } from "./noise";
import { plumeGeometry, plumeMaterial } from "./fx";
import type { Ground } from "./terrain";
import { makeChuteTexture } from "./textures";
import type { World } from "./worlds";

/**
 * Entry, descent and landing. The sequence follows Curiosity/Perseverance: parachute, heat-shield
 * separation, backshell separation, powered descent with a divert, sky-crane lowering on bridles,
 * touchdown, bridle cut, flyaway. Airless worlds skip the parachute and brake on rockets alone.
 * Parachute speed is the real terminal velocity for that air density and gravity; the clock is
 * compressed (or slowed) so each phase plays in a watchable time, and the HUD shows the factor.
 */

export type EdlPhase = "chute" | "separation" | "powered" | "skycrane" | "touchdown" | "flyaway" | "done";
export type EdlSound = "chute" | "pyro" | "engines" | "touchdown" | "cut" | "crash" | "thud";
export type Shot = { pos: THREE.Vector3; look: THREE.Vector3; fov: number; cut: boolean; shake: number; up: THREE.Vector3 };

const ENTRY_MASS = 3300;
const CHUTE_CDA = 0.62 * Math.PI * 10.75 * 10.75;

/** terminal velocity under the 21.5 m parachute: v = √(2mg / ρ·Cd·A) */
export function chuteSpeed(w: World) {
  return Math.sqrt((2 * ENTRY_MASS * w.g) / (Math.max(w.atm.rho, 1e-6) * CHUTE_CDA));
}

function capsuleModel() {
  const g = new THREE.Group();
  const shieldMat = new THREE.MeshStandardMaterial({ color: "#3a2a1f", roughness: 0.95 });
  const backMat = new THREE.MeshStandardMaterial({ color: "#d8d4cb", roughness: 0.6, metalness: 0.1 });
  const shield = new THREE.Mesh(new THREE.ConeGeometry(2.25, 0.7, 48), shieldMat);
  shield.rotation.x = Math.PI;
  shield.position.y = -0.35;
  const back = new THREE.Group();
  const shell = new THREE.Mesh(new THREE.CylinderGeometry(0.85, 2.25, 2.4, 48, 1, false), backMat);
  shell.position.y = 1.2;
  const can = new THREE.Mesh(new THREE.CylinderGeometry(0.62, 0.7, 0.55, 24), backMat);
  can.position.y = 2.65;
  back.add(shell, can);
  // thruster quads and the cruise-stage interface ring
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + 0.4;
    const t = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.25, 0.2), new THREE.MeshStandardMaterial({ color: "#555", metalness: 0.7, roughness: 0.4 }));
    t.position.set(Math.cos(a) * 1.55, 1.1, Math.sin(a) * 1.55);
    back.add(t);
  }
  g.add(shield, back);
  g.traverse((o) => ((o as THREE.Mesh).isMesh ? (o.castShadow = true) : null));
  return { g, shield, back };
}

function chuteModel() {
  const g = new THREE.Group();
  const tex = makeChuteTexture();
  const diskTex = tex.clone();
  diskTex.repeat.set(1, -0.61);
  diskTex.offset.set(0, 1);
  diskTex.needsUpdate = true;
  const bandTex = tex.clone();
  bandTex.repeat.set(1, -0.26);
  bandTex.offset.set(0, 0.26);
  bandTex.needsUpdate = true;
  const canopy = new THREE.Group();
  canopy.position.y = 44;
  g.add(canopy);
  const diskPts: THREE.Vector2[] = [];
  for (let i = 0; i <= 14; i++) {
    const a = (i / 14) * 1.1;
    diskPts.push(new THREE.Vector2(Math.sin(a) * 9.4 + 0.01, Math.cos(a) * 6.5));
  }
  const disk = new THREE.Mesh(new THREE.LatheGeometry(diskPts, 80), new THREE.MeshStandardMaterial({ map: diskTex, side: THREE.DoubleSide, roughness: 0.85 }));
  const bandPts = [new THREE.Vector2(9.7, 1.6), new THREE.Vector2(10.5, -0.6), new THREE.Vector2(10.75, -2.6)];
  const band = new THREE.Mesh(new THREE.LatheGeometry(bandPts, 80), new THREE.MeshStandardMaterial({ map: bandTex, side: THREE.DoubleSide, roughness: 0.85 }));
  canopy.add(disk, band);
  // 40 suspension lines to the confluence, then a single riser to the backshell
  const v: number[] = [];
  for (let i = 0; i < 40; i++) {
    const a = (i / 40) * Math.PI * 2;
    v.push(Math.cos(a) * 10.75, 44 - 2.6, Math.sin(a) * 10.75, 0, 14, 0);
  }
  v.push(0, 14, 0, 0, 3.0, 0);
  const lg = new THREE.BufferGeometry();
  lg.setAttribute("position", new THREE.Float32BufferAttribute(v, 3));
  const lines = new THREE.LineSegments(lg, new THREE.LineBasicMaterial({ color: "#dedad2", transparent: true, opacity: 0.7 }));
  g.add(lines);
  disk.castShadow = band.castShadow = true;
  return { g, canopy, lines, textures: [tex, diskTex, bandTex] };
}

function stageModel(vacuum: boolean) {
  const g = new THREE.Group();
  const frame = new THREE.MeshStandardMaterial({ color: "#2b2e33", metalness: 0.7, roughness: 0.45 });
  const foil = new THREE.MeshStandardMaterial({ color: "#c9a04a", metalness: 1, roughness: 0.35 });
  const ti = new THREE.MeshStandardMaterial({ color: "#b8b9bb", metalness: 0.85, roughness: 0.3 });
  const body = new THREE.Mesh(new THREE.CylinderGeometry(1.1, 1.25, 0.55, 8), foil);
  g.add(body);
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2 + 0.5;
    const tank = new THREE.Mesh(new THREE.SphereGeometry(0.42, 24, 16), ti);
    tank.position.set(Math.cos(a) * 0.95, 0.35, Math.sin(a) * 0.95);
    g.add(tank);
  }
  const plumes: THREE.Mesh[] = [];
  const pm = plumeMaterial(vacuum);
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
    const arm = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.12, 0.16), frame);
    arm.position.set(Math.cos(a) * 1.5, -0.05, Math.sin(a) * 1.5);
    arm.rotation.y = -a;
    g.add(arm);
    for (const off of [-0.22, 0.22]) {
      const px = Math.cos(a) * 2.0 - Math.sin(a) * off;
      const pz = Math.sin(a) * 2.0 + Math.cos(a) * off;
      const eng = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.16, 0.38, 14, 1, true), frame);
      eng.position.set(px, -0.2, pz);
      // engines are canted outward so the plume misses the rover hanging below
      const cant = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(-Math.sin(a), 0, Math.cos(a)), -0.28);
      eng.quaternion.copy(cant);
      g.add(eng);
      const pl = new THREE.Mesh(plumeGeometry(vacuum ? 7 : 4.5, 0.16), pm);
      pl.position.set(px, -0.38, pz);
      pl.quaternion.copy(cant);
      pl.frustumCulled = false;
      g.add(pl);
      plumes.push(pl);
    }
  }
  // landing radar, bridle-and-umbilical device (BUD) underneath
  const radar = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.18, 0.4), frame);
  radar.position.set(0.5, -0.35, 0.2);
  const bud = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 0.25, 16), ti);
  bud.position.y = -0.4;
  g.add(radar, bud);
  g.traverse((o) => ((o as THREE.Mesh).isMesh && !plumes.includes(o as THREE.Mesh) ? (o.castShadow = true) : null));
  return { g, plumes, pm };
}

type Debris = { obj: THREE.Object3D; vel: THREE.Vector3; spin: THREE.Vector3; landed: boolean; kind: "shield" | "backshell" | "stage" };

export class EDL {
  readonly root = new THREE.Group();
  phase: EdlPhase;
  pt = 0;
  clock = 0;
  timeScale = 1;
  alt = 0;
  vReal = 0;
  throttle = 0;
  bridle = 0;
  attached = true;
  standing = 0;
  deploy = 0;
  stagePos = new THREE.Vector3();
  stageVel = new THREE.Vector3();
  rover = { pos: new THREE.Vector3(), quat: new THREE.Quaternion() };
  log: string[] = [];
  sounds: { s: EdlSound; at?: THREE.Vector3 }[] = [];
  landed: { kind: Debris["kind"]; at: THREE.Vector3 }[] = [];
  shot: Shot = { pos: new THREE.Vector3(), look: new THREE.Vector3(), fov: 50, cut: true, shake: 0, up: new THREE.Vector3(0, 1, 0) };
  readonly vChute: number;
  readonly site: THREE.Vector3;
  readonly hasChute: boolean;
  private cap = capsuleModel();
  private chute = chuteModel();
  private stage: ReturnType<typeof stageModel>;
  private bridles: THREE.LineSegments;
  private debris: Debris[] = [];
  private capsulePos = new THREE.Vector3();
  private side: THREE.Vector3;
  private back: THREE.Vector3;
  private fly = { dir: new THREE.Vector3(), burn: 0 };
  private dChute: number;
  private dPowered: number;
  private a0: number;
  private drift: THREE.Vector3;
  private shotName = "";
  private stageOrient = new THREE.Quaternion();
  private touchT = 0;
  private yaw: number;
  private disposables: { dispose(): void }[] = [];

  constructor(
    private world: World,
    private ground: Ground,
    siteXZ: { x: number; z: number },
    yaw: number,
  ) {
    this.yaw = yaw;
    this.site = new THREE.Vector3(siteXZ.x, ground.height(siteXZ.x, siteXZ.z), siteXZ.z);
    this.hasChute = world.edl.chute;
    this.vChute = chuteSpeed(world);
    this.dChute = clamp(800 / this.vChute, 6, 12);
    this.dPowered = this.hasChute ? 9 : 13;
    this.a0 = this.hasChute ? 1000 : 2400;
    const vacuum = world.atm.rho < 0.001;
    this.stage = stageModel(vacuum);
    this.side = new THREE.Vector3(Math.cos(yaw), 0, -Math.sin(yaw));
    this.back = new THREE.Vector3(-Math.sin(yaw), 0, -Math.cos(yaw));
    this.drift = new THREE.Vector3(0.8, 0, 0.6).multiplyScalar(world.atm.wind + 2);

    const bg = new THREE.BufferGeometry();
    bg.setAttribute("position", new THREE.BufferAttribute(new Float32Array(8 * 3), 3));
    this.bridles = new THREE.LineSegments(bg, new THREE.LineBasicMaterial({ color: "#1b1c1f" }));
    this.bridles.frustumCulled = false;
    this.bridles.visible = false;

    this.root.add(this.cap.g, this.chute.g, this.stage.g, this.bridles);
    this.stage.g.visible = !this.hasChute;
    this.cap.g.visible = this.hasChute;
    this.chute.g.visible = this.hasChute;
    this.phase = this.hasChute ? "chute" : "powered";
    if (this.hasChute) {
      this.log.push("Parachute deployed");
      this.sounds.push({ s: "chute" });
    } else {
      this.log.push("Braking burn");
      this.sounds.push({ s: "engines" });
    }
    this.disposables.push(bg, this.bridles.material as THREE.Material, ...this.chute.textures, this.stage.pm);
    this.root.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) {
        this.disposables.push(m.geometry);
        (Array.isArray(m.material) ? m.material : [m.material]).forEach((x) => this.disposables.push(x));
      }
    });
  }

  /** the stage and the rover hanging from it are inside the backshell until separation */
  private setStage(alt: number, offset: THREE.Vector3, dt: number) {
    const prev = this.stagePos.clone();
    this.stagePos.set(this.site.x + offset.x, this.site.y + alt, this.site.z + offset.z);
    if (dt > 0) this.stageVel.subVectors(this.stagePos, prev).divideScalar(dt);
    this.stage.g.position.copy(this.stagePos);
    // tilt against the velocity, as a thrust vector would
    const lateral = new THREE.Vector3(this.stageVel.x, 0, this.stageVel.z).multiplyScalar(0.02);
    const tiltAxis = new THREE.Vector3(lateral.z, 0, -lateral.x);
    const tilt = Math.min(0.45, tiltAxis.length());
    const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), this.yaw);
    if (tilt > 1e-4) q.premultiply(new THREE.Quaternion().setFromAxisAngle(tiltAxis.normalize(), -tilt));
    this.stageOrient.slerp(q, 1 - Math.exp(-4 * Math.max(dt, 0.016)));
    this.stage.g.quaternion.copy(this.stageOrient);
  }

  private hangRover() {
    // the rover hangs under the stage (bridle 0 = tucked in against it)
    const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), this.yaw);
    this.rover.quat.copy(q);
    this.rover.pos.copy(this.stagePos).add(new THREE.Vector3(0, -1.05 - this.bridle, 0));
  }

  private release(kind: Debris["kind"], obj: THREE.Object3D, vel: THREE.Vector3, spin: THREE.Vector3) {
    const world = new THREE.Vector3();
    const q = new THREE.Quaternion();
    obj.getWorldPosition(world);
    obj.getWorldQuaternion(q);
    this.root.attach(obj);
    obj.position.copy(world);
    obj.quaternion.copy(q);
    this.debris.push({ obj, vel, spin, landed: false, kind });
  }

  private updateDebris(dt: number) {
    const g = this.world.g;
    const rho = this.world.atm.rho;
    for (const d of this.debris) {
      if (d.landed) continue;
      // shield and stage fall hard; the backshell drifts on its parachute
      if (d.kind === "backshell") {
        d.vel.lerp(new THREE.Vector3(this.drift.x * 1.5, -this.vChute * this.timeScale, this.drift.z * 1.5), 1 - Math.exp(-1.5 * dt));
      } else {
        d.vel.y -= g * dt * (d.kind === "shield" ? Math.max(1, this.timeScale * 0.8) : 1);
        if (rho > 0.001 && d.kind === "shield") d.vel.multiplyScalar(1 - Math.min(0.5, rho * 0.6 * dt));
      }
      d.obj.position.addScaledVector(d.vel, dt);
      d.obj.rotation.x += d.spin.x * dt;
      d.obj.rotation.z += d.spin.z * dt;
      if (d.kind === "stage") this.stagePos.copy(d.obj.position);
      const gy = this.ground.height(d.obj.position.x, d.obj.position.z);
      if (gy < -1000 && d.obj.position.y < -400) {
        // fell into a gas giant's clouds
        d.landed = true;
        d.obj.visible = false;
        continue;
      }
      if (d.obj.position.y <= gy + 0.2) {
        d.landed = true;
        d.obj.position.y = gy + (d.kind === "shield" ? 0.05 : 0.6);
        d.obj.rotation.set(d.kind === "shield" ? Math.PI + 0.25 : 1.2, d.obj.rotation.y, 0.3);
        this.landed.push({ kind: d.kind, at: d.obj.position.clone() });
        this.sounds.push({ s: d.kind === "stage" ? "crash" : "thud", at: d.obj.position.clone() });
        if (d.kind === "backshell") {
          // the canopy collapses and lies down beside it
          this.chute.g.visible = true;
          this.root.attach(this.chute.g);
          this.chute.g.position.copy(d.obj.position).add(this.drift.clone().normalize().multiplyScalar(30));
          this.chute.g.position.y = this.ground.height(this.chute.g.position.x, this.chute.g.position.z) - 44 + 0.4;
          this.chute.g.rotation.set(0, Math.random() * 6, 0);
          this.chute.canopy.scale.set(1.1, 0.06, 0.8);
          this.chute.lines.visible = false;
        }
        if (d.kind === "stage") {
          this.stage.plumes.forEach((p) => (p.visible = false));
          d.obj.rotation.set(0.5, 0.3, 0.9);
          d.obj.position.y = gy + 0.3;
        }
      }
    }
  }

  private skipped = false;
  skip() {
    this.skipped = true;
    this.throttle = 0;
    this.attached = false;
    this.phase = "done";
    this.pt = 0;
    this.standing = 1;
    this.deploy = 1;
    this.root.visible = false;
  }

  /** the game reports that a wheel has touched; the rover now belongs to the physics */
  touchdown() {
    if (!this.attached) return;
    this.attached = false;
    this.phase = "touchdown";
    this.pt = 0;
    this.touchT = this.clock;
    this.log.push("Touchdown confirmed");
    this.sounds.push({ s: "touchdown" });
  }

  update(dt: number, roverNow: { pos: THREE.Vector3; quat: THREE.Quaternion } | null) {
    if (this.skipped) return;
    this.clock += dt;
    this.pt += dt;
    const S = this.site;
    const sh = this.shot;
    sh.up.set(0, 1, 0);
    sh.cut = false;

    if (this.phase === "chute") {
      const u = this.pt / this.dChute;
      this.timeScale = 800 / this.dChute / this.vChute;
      this.alt = lerp(1800, 1000, u);
      this.vReal = this.vChute;
      const sway = new THREE.Vector3(Math.sin(this.clock * 0.9) * 2.2, 0, Math.cos(this.clock * 0.7) * 1.6);
      const off = this.drift.clone().multiplyScalar(-(1 - u) * 6).add(sway);
      this.capsulePos.set(S.x + off.x, S.y + this.alt, S.z + off.z);
      this.cap.g.position.copy(this.capsulePos);
      this.cap.g.rotation.set(Math.sin(this.clock * 0.9) * 0.05, this.yaw, Math.cos(this.clock * 0.7) * 0.04);
      this.chute.g.position.copy(this.capsulePos).add(new THREE.Vector3(0, 2.9, 0));
      this.chute.g.rotation.set(-Math.sin(this.clock * 0.9) * 0.04, 0, 0);
      const inflate = smoothstep(0, 0.9, this.pt);
      const over = 1 + Math.sin(Math.min(this.pt, 1.6) * 6) * 0.08 * (1 - smoothstep(0.6, 1.6, this.pt));
      this.chute.canopy.scale.set(lerp(0.08, 1, inflate) * over, lerp(1.6, 1, inflate), lerp(0.08, 1, inflate) * over);
      if (this.pt > 2.6 && this.cap.shield.parent === this.cap.g) {
        this.log.push("Heat shield separation");
        this.sounds.push({ s: "pyro" });
        this.release("shield", this.cap.shield, new THREE.Vector3(this.drift.x * 2, -(800 / this.dChute) - 6, this.drift.z * 2), new THREE.Vector3(0.6, 0, 0.4));
        // the rover's wheels and the stage are visible through the open base now
        this.stage.g.visible = true;
      }
      // stowed inside the backshell, above the heat shield
      this.setStage(this.alt + 1.6, off, dt);
      this.hangRover();
      // shots: wide under the canopy; after the shield drops, the downward lander camera
      const lcam = this.pt > 2.6 && this.pt < 6.2;
      if (lcam) {
        this.setShot("lcam", this.capsulePos.clone().add(new THREE.Vector3(0, -2.4, 0)), this.capsulePos.clone().add(new THREE.Vector3(0.01, -100, 0)), 70, 0.002);
        sh.up.set(this.side.x, 0, this.side.z);
      } else {
        const p = this.capsulePos.clone().addScaledVector(this.side, 62).addScaledVector(this.back, 22).add(new THREE.Vector3(0, -6, 0));
        this.setShot("chute", p, this.capsulePos.clone().add(new THREE.Vector3(0, 20, 0)), 55, 0.004);
      }
      if (this.pt >= this.dChute) {
        this.phase = "separation";
        this.pt = 0;
        this.log.push("Backshell separation");
        this.sounds.push({ s: "pyro" });
        this.release("backshell", this.cap.back, new THREE.Vector3(this.drift.x, -this.vChute * this.timeScale, this.drift.z), new THREE.Vector3(0.05, 0, 0.08));
        // the chute rides away with the backshell
        this.cap.back.add(this.chute.g);
        this.chute.g.position.set(0, 2.9, 0);
        this.chute.g.rotation.set(0, 0, 0);
      }
    } else if (this.phase === "separation") {
      // a second of free fall before the engines light
      this.timeScale = 1.5;
      const v0 = 800 / this.dChute;
      const fall = v0 * this.pt + 0.5 * this.world.g * 3 * this.pt * this.pt;
      this.alt = 1000 + 1.6 - fall;
      this.vReal = (v0 + this.world.g * 3 * this.pt) / this.timeScale;
      this.setStage(this.alt, this.capsulePos.clone().sub(S), dt);
      this.hangRover();
      this.setShot("sep", this.capsulePos.clone().addScaledVector(this.side, 26).add(new THREE.Vector3(0, -30, 0)), this.stagePos, 55, 0.006);
      if (this.pt > 1.2) {
        this.phase = "powered";
        this.pt = 0;
        this.a0 = this.alt;
        this.log.push("Powered descent");
        this.sounds.push({ s: "engines" });
      }
    }
    if (this.phase === "powered") {
      const u = clamp(this.pt / this.dPowered, 0, 1);
      this.timeScale = this.hasChute ? 4.5 : 30;
      this.alt = 21 + (this.a0 - 21) * Math.pow(1 - u, 3);
      this.vReal = (3 * (this.a0 - 21) * (1 - u) * (1 - u)) / this.dPowered / this.timeScale;
      // divert: swing clear of the falling backshell, then settle over the target; airless landers come in low and long
      const off = new THREE.Vector3();
      if (this.hasChute) {
        const base = this.capsulePos.clone().sub(S).multiplyScalar(Math.pow(1 - u, 2));
        off.copy(base).addScaledVector(this.side, 34 * Math.sin(Math.PI * u) * (1 - u * 0.4));
      } else off.copy(this.back).multiplyScalar(650 * Math.pow(1 - u, 2.2));
      this.throttle = lerp(0.95, 0.6, u);
      this.setStage(this.alt, off, dt);
      this.hangRover();
      const p = this.stagePos.clone().addScaledVector(this.side, 24).addScaledVector(this.back, 16).add(new THREE.Vector3(0, 7, 0));
      this.setShot("powered", p, this.stagePos.clone().add(new THREE.Vector3(0, -5, 0)), 50, 0.01);
      if (u >= 1) {
        this.phase = "skycrane";
        this.pt = 0;
        this.log.push("Sky crane: lowering rover");
        this.sounds.push({ s: "pyro" });
      }
    } else if (this.phase === "skycrane") {
      this.timeScale = 2.5;
      const vs = 0.75 * this.timeScale;
      this.alt = 21 - vs * this.pt;
      this.vReal = 0.75;
      this.bridle = Math.min(7.5, this.pt * 2.6);
      this.standing = smoothstep(0.5, 2.8, this.pt);
      this.throttle = 0.55;
      this.setStage(this.alt, new THREE.Vector3(), dt);
      this.hangRover();
      // gentle pendulum on the bridles
      this.rover.pos.x += Math.sin(this.clock * 1.7) * 0.06 * this.bridle / 7.5;
      // upward-looking camera for the first seconds, then the classic view from the ground
      if (this.pt < 3) {
        const cam = this.rover.pos.clone().add(new THREE.Vector3(0, 0.75, 0));
        this.setShot("upcam", cam, this.stagePos, 78, 0.004);
        sh.up.set(this.back.x, 0, this.back.z);
      } else {
        const gp = S.clone().addScaledVector(this.side, 26).addScaledVector(this.back, -22);
        gp.y = this.ground.height(gp.x, gp.z) + 1.7;
        if (gp.y < S.y - 50) gp.y = S.y + 1.7;
        const mid = this.stagePos.clone().lerp(this.rover.pos, 0.55);
        this.setShot("ground", gp, mid, 46, 0.003);
      }
    } else if (this.phase === "touchdown") {
      // hold the hover while the bridles go slack, then fire the cutters
      this.timeScale = 1;
      this.alt = Math.max(this.alt - 0.3 * dt, 0);
      this.setStage(this.alt, new THREE.Vector3(), dt);
      if (this.pt > 0.8) {
        this.phase = "flyaway";
        this.pt = 0;
        this.log.push("Bridles cut — flyaway");
        this.sounds.push({ s: "cut" });
        this.fly.dir.copy(this.side).multiplyScalar(-1).addScaledVector(this.back, -0.6).normalize();
      }
      if (roverNow) this.chaseShot(roverNow, this.stagePos, 1);
    } else if (this.phase === "flyaway" || this.phase === "done") {
      this.timeScale = 1;
      if (this.phase === "flyaway") {
        this.deploy = smoothstep(1.0, 4.0, this.pt);
        if (this.pt > 4.2) {
          this.phase = "done";
          this.log.push("Rover deployed — drive!");
        }
      }
      const stageFlying = !this.debris.some((d) => d.kind === "stage");
      if (stageFlying) {
        // climb and pitch away at full throttle for ~3.5 s, then the tanks run dry
        const t = this.clock - this.touchT - 0.8;
        this.throttle = 1;
        const climb = Math.min(t, 3.5);
        const off = this.fly.dir.clone().multiplyScalar(Math.max(0, climb * climb * 2.6));
        this.alt = Math.max(this.alt, 0) + dt * Math.min(12, 1 + t * 6);
        this.setStage(this.alt, off, dt);
        if (t > 3.5) {
          this.throttle = 0;
          this.release("stage", this.stage.g, this.stageVel.clone(), new THREE.Vector3(0.4, 0, 0.7));
        }
      }
      if (roverNow) this.chaseShot(roverNow, this.stagePos, this.phase === "flyaway" ? 1 : 0);
    }

    // stage plumes
    const t = this.clock;
    this.stage.pm.uniforms.uTime.value = t;
    this.stage.pm.uniforms.uPower.value = this.throttle * (0.85 + Math.random() * 0.15);
    this.stage.plumes.forEach((p, i) => p.scale.setScalar(this.throttle > 0.01 ? 0.7 + this.throttle * 0.5 + Math.sin(t * 50 + i) * 0.04 : 0.001));

    // bridles
    this.bridles.visible = (this.phase === "skycrane" || this.phase === "touchdown") && this.bridle > 0.05;
    if (this.bridles.visible) {
      const rp = this.attached || !roverNow ? this.rover : roverNow;
      const pos = this.bridles.geometry.attributes.position as THREE.BufferAttribute;
      const anchors = [new THREE.Vector3(0.6, 0.38, 0.6), new THREE.Vector3(-0.6, 0.38, 0.6), new THREE.Vector3(0, 0.38, -0.75), new THREE.Vector3(0.2, 0.4, 0)];
      const tops = [new THREE.Vector3(0.35, -0.45, 0.35), new THREE.Vector3(-0.35, -0.45, 0.35), new THREE.Vector3(0, -0.45, -0.45), new THREE.Vector3(0, -0.5, 0)];
      anchors.forEach((a, i) => {
        const A = a.clone().applyQuaternion(rp.quat).add(rp.pos);
        const B = tops[i].clone().applyQuaternion(this.stage.g.quaternion).add(this.stagePos);
        // slack after touchdown: the lines sag
        if (this.phase === "touchdown") A.lerp(B, 0.02);
        pos.setXYZ(i * 2, A.x, A.y, A.z);
        pos.setXYZ(i * 2 + 1, B.x, B.y, B.z);
      });
      pos.needsUpdate = true;
    }

    this.updateDebris(dt);
  }

  private chaseShot(r: { pos: THREE.Vector3; quat: THREE.Quaternion }, look: THREE.Vector3, k: number) {
    const fwd = new THREE.Vector3(0, 0, 1).applyQuaternion(r.quat);
    const p = r.pos.clone().addScaledVector(fwd, -8).add(new THREE.Vector3(0, 3.4, 0)).addScaledVector(this.side, 2.5);
    const target = r.pos.clone().lerp(look, 0.25 * k).add(new THREE.Vector3(0, 0.8, 0));
    this.setShot("chase", p, target, 55, 0);
  }

  private setShot(name: string, pos: THREE.Vector3, look: THREE.Vector3, fov: number, shake: number) {
    const sh = this.shot;
    sh.cut = name !== this.shotName && ["lcam", "upcam", "ground", "chute", "sep"].includes(name);
    if (this.shotName === "lcam" || this.shotName === "upcam") sh.cut = name !== this.shotName;
    this.shotName = name;
    sh.pos.copy(pos);
    sh.look.copy(look);
    sh.fov = fov;
    sh.shake = shake;
  }

  /** stage, shield and backshell remain on the ground as places to visit */
  dispose() {
    this.disposables.forEach((d) => d.dispose());
  }
}
