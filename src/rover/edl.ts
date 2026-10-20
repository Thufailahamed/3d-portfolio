import * as THREE from "three";
import { clamp, lerp, smoothstep } from "./noise";
import { aeroshell, descentStage, hardwareMaterials, parachute, setNozzleGlow } from "./hardware";
import type { Ground } from "./terrain";
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
/** the stage sits this far above the capsule's nose while stowed, and the rover hangs this far under the stage */
const STOW = 1.6;
const HANG = 1.05;

/** terminal velocity under the 21.5 m parachute: v = √(2mg / ρ·Cd·A) */
export function chuteSpeed(w: World) {
  return Math.sqrt((2 * ENTRY_MASS * w.g) / (Math.max(w.atm.rho, 1e-6) * CHUTE_CDA));
}

type Debris = { obj: THREE.Object3D; vel: THREE.Vector3; spin: THREE.Vector3; landed: boolean; kind: "shield" | "backshell" | "stage" };

/** faint motes hanging in the air along the descent path: with the camera riding the capsule they stream past and sell the speed */
function motes(world: World, site: THREE.Vector3) {
  const N = 900;
  const p = new Float32Array(N * 3);
  for (let i = 0; i < N; i++) {
    const a = Math.random() * Math.PI * 2;
    const r = 6 + Math.pow(Math.random(), 0.6) * 140;
    p[i * 3] = site.x + Math.cos(a) * r;
    p[i * 3 + 1] = site.y + 30 + Math.random() * 1900;
    p[i * 3 + 2] = site.z + Math.sin(a) * r;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(p, 3));
  const c = new THREE.Color(world.soil.dustColor).lerp(new THREE.Color(world.sky.horizon), 0.5);
  const m = new THREE.PointsMaterial({ color: c, size: 0.35, sizeAttenuation: true, transparent: true, opacity: 0.55, depthWrite: false });
  const pts = new THREE.Points(g, m);
  pts.frustumCulled = false;
  return pts;
}

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
  private m = hardwareMaterials();
  private cap = aeroshell(this.m);
  private chute = parachute();
  private stage: ReturnType<typeof descentStage>;
  private lines: THREE.Mesh[] = [];
  private motes: THREE.Points | null = null;
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
  private vacuum: boolean;
  /** a camera set down on the ground for the touchdown and flyaway, and where it is looking */
  private groundCam = new THREE.Vector3();
  private groundLook = new THREE.Vector3();
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
    this.dChute = clamp(800 / this.vChute, 7, 12);
    this.dPowered = this.hasChute ? 9 : 13;
    this.a0 = this.hasChute ? 1000 : 2400;
    this.vacuum = world.atm.rho < 0.001;
    this.stage = descentStage(this.m, this.vacuum);
    this.side = new THREE.Vector3(Math.cos(yaw), 0, -Math.sin(yaw));
    this.back = new THREE.Vector3(-Math.sin(yaw), 0, -Math.cos(yaw));
    this.drift = new THREE.Vector3(0.8, 0, 0.6).multiplyScalar(world.atm.wind + 2);
    this.fly.dir.copy(this.side).multiplyScalar(-1).addScaledVector(this.back, -0.6).normalize();

    // bridles: three nylon straps and the umbilical, as real geometry so they read at a distance
    const strap = new THREE.CylinderGeometry(1, 1, 1, 6, 1, true);
    strap.translate(0, 0.5, 0);
    const strapMat = new THREE.MeshStandardMaterial({ color: "#e6e0d2", roughness: 0.85 });
    const umbMat = new THREE.MeshStandardMaterial({ color: "#2a2b2f", roughness: 0.6, metalness: 0.3 });
    for (let i = 0; i < 4; i++) {
      const l = new THREE.Mesh(strap, i < 3 ? strapMat : umbMat);
      l.visible = false;
      l.frustumCulled = false;
      l.castShadow = true;
      this.lines.push(l);
      this.root.add(l);
    }
    this.disposables.push(strap, strapMat, umbMat);

    this.root.add(this.cap.g, this.chute.g, this.stage.g);
    if (this.world.atm.rho > 0.001 && this.hasChute) {
      this.motes = motes(world, this.site);
      this.root.add(this.motes);
      this.disposables.push(this.motes.geometry, this.motes.material as THREE.Material);
    }
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
    this.disposables.push(this.m, this.chute, this.stage.pm);
    this.root.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh && m.geometry !== strap) this.disposables.push(m.geometry);
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
    this.rover.pos.copy(this.stagePos).add(new THREE.Vector3(0, -HANG - this.bridle, 0));
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
      // a falling heat shield flutters and turns over; the stage tumbles
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
        // shield and stage hit at tens of metres a second: a crater and a plume of dust
        this.sounds.push({ s: d.kind === "backshell" ? "thud" : "crash", at: d.obj.position.clone() });
        if (d.kind === "backshell") {
          // the canopy collapses and lies down beside it
          this.chute.g.visible = true;
          this.root.attach(this.chute.g);
          this.chute.g.position.copy(d.obj.position).add(this.drift.clone().normalize().multiplyScalar(30));
          this.chute.g.position.y = this.ground.height(this.chute.g.position.x, this.chute.g.position.z) - 44 + 0.4;
          this.chute.g.rotation.set(0, Math.random() * 6, 0);
          this.chute.canopy.scale.set(1.1, 0.06, 0.8);
          this.chute.lines.visible = false;
          this.chute.riser.visible = false;
        }
        if (d.kind === "stage") {
          this.stage.plumes.forEach((p) => (p.visible = false));
          setNozzleGlow(this.m, 0, this.vacuum);
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
    // set a camera down on the ground, off the rover's front quarter, for the touchdown and flyaway
    // the first spot (starting behind the rover on the flyaway line) with a clear view of it over the dunes and rocks
    const r = this.rover.pos;
    const target = r.clone().add(new THREE.Vector3(0, 0.3, 0));
    let best: { p: THREE.Vector3; clear: number } | null = null;
    for (const da of [0, 0.5, -0.5, 1.0, -1.0, 1.6, -1.6, Math.PI]) {
      const dir = this.fly.dir.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), da);
      const across = new THREE.Vector3(dir.z, 0, -dir.x);
      const p = r.clone().addScaledVector(dir, -12.5).addScaledVector(across, 4.5);
      const gy = this.ground.ground(p.x, p.z);
      p.y = (gy > -1000 && gy > r.y - 30 ? gy : r.y - 1) + 1.3;
      let clear = Infinity;
      for (let k = 1; k < 12; k++) {
        const q = p.clone().lerp(target, k / 12);
        const g = this.ground.ground(q.x, q.z);
        if (g > -1000) clear = Math.min(clear, q.y - g);
      }
      if (!best || clear > best.clear) best = { p, clear };
      if (clear > 0.35) break;
    }
    this.groundCam.copy(best!.p);
    // nowhere clear: stand up taller
    if (best!.clear < 0.35) this.groundCam.y += 0.35 - best!.clear + 0.6;
    this.groundLook.copy(this.landedLook(r));
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
      // the capsule swings under the canopy, and the whole system drifts with the wind
      const sway = new THREE.Vector3(Math.sin(this.clock * 0.9) * 2.2, 0, Math.cos(this.clock * 0.7) * 1.6);
      const off = this.drift.clone().multiplyScalar(-(1 - u) * 6).add(sway);
      this.capsulePos.set(S.x + off.x, S.y + this.alt, S.z + off.z);
      this.cap.g.position.copy(this.capsulePos);
      const swing = new THREE.Euler(Math.sin(this.clock * 0.9 + 0.4) * 0.07, this.yaw, Math.cos(this.clock * 0.7) * 0.06);
      this.cap.g.rotation.copy(swing);
      this.chute.g.position.copy(this.capsulePos).add(new THREE.Vector3(0, 0.05, 0));
      this.chute.g.rotation.set(-Math.sin(this.clock * 0.9) * 0.04, 0, Math.cos(this.clock * 0.7) * 0.02);
      // the canopy snaps open, overshoots, and breathes
      const inflate = smoothstep(0, 0.7, this.pt);
      const over = 1 + Math.sin(Math.min(this.pt, 1.6) * 6) * 0.08 * (1 - smoothstep(0.6, 1.6, this.pt)) + Math.sin(this.clock * 3.1) * 0.012;
      this.chute.canopy.scale.set(lerp(0.08, 1, inflate) * over, lerp(1.6, 1, inflate), lerp(0.08, 1, inflate) * over);
      if (this.pt > 2.6 && this.cap.shield.parent === this.cap.g) {
        this.log.push("Heat shield separation");
        this.sounds.push({ s: "pyro" });
        this.release("shield", this.cap.shield, this.drift.clone().multiplyScalar(6 / this.dChute).add(new THREE.Vector3(0.6, -(800 / this.dChute) - 4, -0.4)), new THREE.Vector3(0.35, 0, 0.22));
        // the rover's wheels and the stage are visible through the open base now
        this.stage.g.visible = true;
      }
      // stowed inside the backshell, above the heat shield
      this.setStage(this.alt + STOW, off, dt);
      this.hangRover();
      const C = this.capsulePos;
      if (this.pt < 2.6) {
        // level with the riser, slowly orbiting: canopy above, capsule below, the hazy horizon behind
        const a = 0.35 + this.clock * 0.035;
        const p = C.clone().addScaledVector(this.side, Math.cos(a) * 80).addScaledVector(this.back, Math.sin(a) * 80).add(new THREE.Vector3(0, 12, 0));
        this.setShot("chute", p, C.clone().add(new THREE.Vector3(0, 19, 0)), 46, 0.0015, true);
      } else if (this.pt < 6.2) {
        // the downward-looking lander camera: the heat shield tumbles away toward the ground
        this.setShot("lcam", C.clone().add(new THREE.Vector3(0, 0.35, 0)), C.clone().add(new THREE.Vector3(0.01, -100, 0)).addScaledVector(this.back, 4), 58, 0.0012, true);
        sh.up.copy(this.side);
      } else {
        // just under the open backshell: rover and stage packed inside, the canopy high above
        const p = C.clone().addScaledVector(this.side, 10).addScaledVector(this.back, -3.5).add(new THREE.Vector3(0, -5.5, 0));
        this.setShot("under", p, C.clone().add(new THREE.Vector3(0, 7, 0)), 64, 0.002, true);
      }
      if (this.pt >= this.dChute) {
        this.phase = "separation";
        this.pt = 0;
        this.log.push("Backshell separation");
        this.sounds.push({ s: "pyro" });
        this.release("backshell", this.cap.back, new THREE.Vector3(this.drift.x, -this.vChute * this.timeScale, this.drift.z), new THREE.Vector3(0.05, 0, 0.08));
        // the chute rides away with the backshell
        this.cap.back.add(this.chute.g);
        this.chute.g.position.set(0, 0.05, 0);
        this.chute.g.rotation.set(0, 0, 0);
      }
    } else if (this.phase === "separation") {
      // a second of free fall before the engines light; the backshell and chute seem to shoot upward
      this.timeScale = 1.5;
      const v0 = 800 / this.dChute;
      const fall = v0 * this.pt + 0.5 * this.world.g * 3 * this.pt * this.pt;
      this.alt = 1000 + STOW - fall;
      this.vReal = (v0 + this.world.g * 3 * this.pt) / this.timeScale;
      this.setStage(this.alt, this.capsulePos.clone().sub(S), dt);
      this.hangRover();
      const p = this.stagePos.clone().addScaledVector(this.side, 13).addScaledVector(this.back, 5).add(new THREE.Vector3(0, -4, 0));
      this.setShot("sep", p, this.stagePos.clone().add(new THREE.Vector3(0, 4, 0)), 60, 0.004, true);
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
      if (u < 0.58) {
        // riding alongside: the stage and its tucked-in rover over the terrain, engines blazing
        const a = 2.2 + this.clock * 0.1;
        const p = this.stagePos.clone().addScaledVector(this.side, Math.cos(a) * 13).addScaledVector(this.back, Math.sin(a) * 13).add(new THREE.Vector3(0, 2.6, 0));
        this.setShot("powered", p, this.stagePos.clone().add(new THREE.Vector3(0, -1.6, 0)), 50, 0.004, true);
      } else {
        // from the ground: the stage comes down toward us out of the sky, the horizon along the bottom of the frame
        const gp = this.groundPoint(S.clone().addScaledVector(this.side, 22).addScaledVector(this.back, -17), 1.5);
        const fov = lerp(42, 50, smoothstep(0.58, 1, u));
        this.setShot("approach", gp, this.skyLook(gp, this.stagePos, fov), fov, 0.0015, true);
      }
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
      this.rover.pos.x += (Math.sin(this.clock * 1.7) * 0.06 * this.bridle) / 7.5;
      this.rover.pos.z += (Math.cos(this.clock * 1.3) * 0.04 * this.bridle) / 7.5;
      if (this.pt < 0.8) {
        const gp = this.groundPoint(S.clone().addScaledVector(this.side, 22).addScaledVector(this.back, -17), 1.5);
        this.setShot("approach", gp, this.skyLook(gp, this.stagePos, 50), 50, 0.0015, true);
      } else if (this.pt < 3.8) {
        // the rover's up-look camera: the stage overhead, its engines glowing, the bridles paying out
        const cam = this.rover.pos.clone().add(new THREE.Vector3(0, 0.95, 0)).addScaledVector(this.back, 0.15).addScaledVector(this.side, -0.6);
        const look = this.stagePos.clone().addScaledVector(this.back, -0.6);
        this.setShot("upcam", cam, look, 82, 0.0012, true);
        sh.up.copy(this.back).multiplyScalar(-1);
      } else {
        // the classic view: from the ground, looking up at the crane lowering the rover
        const gp = this.groundPoint(S.clone().addScaledVector(this.side, 17).addScaledVector(this.back, -11), 1.3);
        const mid = this.stagePos.clone().lerp(this.rover.pos, 0.52);
        this.setShot("ground", gp, mid, 54, 0.001, true);
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
      }
      if (roverNow) this.landedShot(roverNow, dt);
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
        const off = this.fly.dir.clone().multiplyScalar(Math.max(0, climb * climb * 4.2));
        this.alt = Math.max(this.alt, 0) + dt * Math.min(7, 1 + t * 3.5);
        this.setStage(this.alt, off, dt);
        if (t > 3.5) {
          this.throttle = 0;
          this.release("stage", this.stage.g, this.stageVel.clone(), new THREE.Vector3(0.4, 0, 0.7));
        }
      }
      if (roverNow) this.landedShot(roverNow, dt);
    }

    // stage plumes and the glow inside the nozzles
    const t = this.clock;
    const flame = this.throttle * (0.88 + Math.random() * 0.12);
    this.stage.pm.uniforms.uTime.value = t;
    this.stage.pm.uniforms.uPower.value = flame;
    this.stage.plumes.forEach((p, i) => p.scale.setScalar(this.throttle > 0.01 ? 0.75 + this.throttle * 0.45 + Math.sin(t * 50 + i) * 0.03 : 0.001));
    setNozzleGlow(this.m, this.stage.g.visible ? flame : 0, this.vacuum);
    if (this.motes) this.motes.visible = this.phase === "chute" || this.phase === "separation" || this.phase === "powered";

    // bridles and umbilical, from the reel under the stage to the rover's deck
    const show = (this.phase === "skycrane" || this.phase === "touchdown") && this.bridle > 0.05;
    const rp = this.attached || !roverNow ? this.rover : roverNow;
    const anchors = [new THREE.Vector3(0.55, 0.42, 0.55), new THREE.Vector3(-0.55, 0.42, 0.55), new THREE.Vector3(0, 0.42, -0.7), new THREE.Vector3(0.18, 0.45, 0.05)];
    const bud = this.stage.bud;
    const exits = [new THREE.Vector3(0.12, 0, 0.08), new THREE.Vector3(-0.12, 0, 0.08), new THREE.Vector3(0, 0, -0.12), new THREE.Vector3(0.05, -0.05, 0)];
    this.lines.forEach((l, i) => {
      l.visible = show;
      if (!show) return;
      const A = anchors[i].clone().applyQuaternion(rp.quat).add(rp.pos);
      const B = exits[i].clone().add(bud).applyQuaternion(this.stage.g.quaternion).add(this.stagePos);
      // slack after touchdown: the lines start to fall
      if (this.phase === "touchdown") A.lerp(B, 0.02);
      const d = B.clone().sub(A);
      const r = i < 3 ? 0.013 : 0.017;
      l.position.copy(A);
      l.scale.set(r, d.length(), r);
      l.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize());
    });

    this.updateDebris(dt);
  }

  /** aim from a ground camera toward something in the sky, holding the view down so the horizon stays in frame */
  private skyLook(cam: THREE.Vector3, target: THREE.Vector3, fov: number) {
    const d = target.clone().sub(cam);
    const h = Math.hypot(d.x, d.z);
    const hf = THREE.MathUtils.degToRad(fov / 2);
    const eS = Math.atan2(d.y, h);
    // the target in the upper part of the frame; the horizon kept in shot unless that would lose the target
    const e = clamp(eS - hf * 0.55, 0.04, Math.max(hf * 0.75, eS - hf * 0.8));
    return cam.clone().add(new THREE.Vector3(d.x, Math.tan(e) * h, d.z));
  }

  /** a point on the ground, `h` metres up (or level with the site where there is no ground, as over a gas giant's deck) */
  private groundPoint(p: THREE.Vector3, h: number) {
    const gy = this.ground.ground(p.x, p.z);
    p.y = (gy > -1000 && gy > this.site.y - 50 ? gy : this.site.y) + h;
    return p;
  }

  /** where the touchdown camera aims: the rover low in the frame, tilted up toward the stage while it is still in the air */
  private landedLook(r: THREE.Vector3) {
    const cam = this.groundCam;
    const toR = r.clone().sub(cam);
    const dR = Math.hypot(toR.x, toR.z);
    const eR = Math.atan2(toR.y + 0.6, dR);
    let e = eR + 0.12;
    const stageUp = !this.debris.some((d) => d.kind === "stage" && d.landed);
    if (stageUp) {
      const toS = this.stagePos.clone().sub(cam);
      const eS = Math.atan2(toS.y, Math.hypot(toS.x, toS.z));
      e = clamp(lerp(eR, eS, 0.55), eR + 0.12, eR + 0.36);
    }
    const h = new THREE.Vector3(toR.x, 0, toR.z).normalize();
    return cam.clone().addScaledVector(h, dR).add(new THREE.Vector3(0, Math.tan(e) * dR, 0));
  }

  /** after touchdown: the rover framed low in the shot, the stage climbing away beyond it */
  private landedShot(r: { pos: THREE.Vector3; quat: THREE.Quaternion }, dt: number) {
    this.groundLook.lerp(this.landedLook(r.pos), 1 - Math.exp(-2.5 * dt));
    this.setShot("landed", this.groundCam, this.groundLook, 50, 0.0006, true);
  }

  private setShot(name: string, pos: THREE.Vector3, look: THREE.Vector3, fov: number, shake: number, rigid = false) {
    const sh = this.shot;
    // rigid shots ride with what they film, so they are placed exactly each frame
    sh.cut = rigid || name !== this.shotName;
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
