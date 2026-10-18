import * as THREE from "three";
import type { Subject } from "./game";
import { ATTRACTIONS, type AttractionId, type Park, type Stop } from "./park";
import { attractionOf, type Sim } from "./sim";
import type { CamMode } from "./store";
import { newFrame, type Track } from "./track";
import { YARD, roadAt } from "./yard";

/** the stops' lens: long, so the park reads as a model you're looking down on */
export const STOP_FOV = 32;
const Y = new THREE.Vector3(0, 1, 0);

/** The part of the screen the interface leaves clear, in normalised device coordinates. */
export type SafeRect = { x0: number; x1: number; y0: number; y1: number };

type Pose = { pos: THREE.Vector3; quat: THREE.Quaternion; look: THREE.Vector3; dist: number };
const newPose = (): Pose => ({ pos: new THREE.Vector3(), quat: new THREE.Quaternion(), look: new THREE.Vector3(), dist: 100 });

/** A trackside camera: where it stands, and which attraction it covers. */
type Tripod = { pos: THREE.Vector3; attraction: AttractionId };

const smooth = (t: number) => t * t * (3 - 2 * t);
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const ease = (rate: number, dt: number) => 1 - Math.exp(-rate * dt);
const m4 = new THREE.Matrix4();

/**
 * Where the camera goes. At rest it sits at one of the park's stops, worked out to frame that
 * attraction in whatever part of the screen the interface leaves clear; with a car running it
 * follows it (chase, trackside or onboard), blending smoothly between the two.
 */
export class CameraRig {
  /** where along the stops it is (0 overview, 1.. the attractions), drag-to-look offsets, zoom */
  p = 0;
  yawOff = 0;
  pitchOff = 0;
  zoom = 1;
  dragging = false;
  lastDrag = -10;
  intro = 1;
  /** how much the follow camera has taken over (0..1) */
  followK = 0;
  /** the point the camera's looking at, for focus, shadows and fading the scenery */
  readonly look = new THREE.Vector3();
  /** roughly how wide the view is at the look point (cm), for the shadow box */
  span = 300;
  fov = STOP_FOV;
  near = 0.6;
  /** what must stay visible this frame (scenery in the way of any of these fades) */
  targets: THREE.Vector3[] = [];
  private stopTargets: THREE.Vector3[][] = [];
  /** camera shake: builds with each knock, dies away (its effect goes with the square) */
  private trauma = 0;
  private shakeT = 0;

  /** Knock the camera (0..1: a bump, a hard landing, a crash). */
  shake(k: number) {
    this.trauma = Math.min(1, this.trauma + k);
  }

  private A = newPose();
  private B = newPose();
  private stopPose = newPose();
  private follow = newPose();
  private tmp = { v: new THREE.Vector3(), w: new THREE.Vector3(), R: new THREE.Vector3(), U: new THREE.Vector3(), F: new THREE.Vector3(), q: new THREE.Quaternion() };
  private f = newFrame();
  private f2 = newFrame();
  // chase
  private off = new THREE.Vector3();
  private offInit = false;
  private lookSm = new THREE.Vector3();
  private freeDir = new THREE.Vector3(0, 0, 1);
  private clip = 1;
  private followFov = 42;
  // trackside
  private tripods: Tripod[] = [];
  private tp: Tripod | null = null;
  private tpSince = 0;
  private lastAttraction: AttractionId | null = null;
  // onboard
  private boardQ = new THREE.Quaternion();
  private boardInit = false;
  private lastMode: CamMode | null = null;
  private towers: { x: number; z: number; r: number; h: number }[] = [];

  constructor(
    private park: Park,
    private sim: Sim,
  ) {
    for (const p of park.props) if (p.kind === "tower") this.towers.push({ x: p.x, z: p.z, r: p.r, h: p.h });
    this.buildTripods();
    // a spread of each stop's points (a dozen or so) to keep clear of scenery
    this.stopTargets = park.stops.map((s) => s.pts.filter((_, i) => i % Math.max(1, Math.floor(s.pts.length / 14)) === 0));
  }

  // —————————————————————————————————————————— stops

  /**
   * Frame a stop's points from its direction: the closest distance at which every point lands
   * inside the safe rectangle, then the sideways and vertical shift that centres them in it.
   * (For a fixed distance the shifts that work form an interval per axis; the distance search is
   * a bisection on whether both intervals are non-empty.)
   */
  private fit(stop: Stop, yaw: number, pitch: number, aspect: number, safe: SafeRect, out: Pose) {
    const { R, U, F } = this.tmp;
    F.set(-Math.sin(yaw) * Math.cos(pitch), -Math.sin(pitch), -Math.cos(yaw) * Math.cos(pitch));
    R.crossVectors(F, Y).normalize();
    U.crossVectors(R, F);
    const c = this.tmp.v.set(0, 0, 0);
    for (const p of stop.pts) c.add(p);
    c.divideScalar(stop.pts.length);
    const tanV = Math.tan(THREE.MathUtils.degToRad(STOP_FOV / 2));
    const tanH = tanV * aspect;
    const n = stop.pts.length;
    const xs = new Float32Array(n);
    const ys = new Float32Array(n);
    const zs = new Float32Array(n);
    let zMin = Infinity;
    for (let i = 0; i < n; i++) {
      const d = this.tmp.w.subVectors(stop.pts[i], c);
      xs[i] = d.dot(R);
      ys[i] = d.dot(U);
      zs[i] = d.dot(F);
      zMin = Math.min(zMin, zs[i]);
    }
    const solve = (D: number) => {
      let lx = -Infinity, hx = Infinity, ly = -Infinity, hy = Infinity;
      for (let i = 0; i < n; i++) {
        const depth = D + zs[i];
        lx = Math.max(lx, xs[i] - safe.x1 * tanH * depth);
        hx = Math.min(hx, xs[i] - safe.x0 * tanH * depth);
        ly = Math.max(ly, ys[i] - safe.y1 * tanV * depth);
        hy = Math.min(hy, ys[i] - safe.y0 * tanV * depth);
      }
      return { ok: lx <= hx && ly <= hy, ox: (lx + hx) / 2, oy: (ly + hy) / 2 };
    };
    let lo = Math.max(10, -zMin + 10);
    let hi = 30000;
    for (let k = 0; k < 32; k++) {
      const mid = (lo + hi) / 2;
      if (solve(mid).ok) hi = mid;
      else lo = mid;
    }
    const D = hi;
    const { ox, oy } = solve(D);
    out.pos.copy(c).addScaledVector(R, ox).addScaledVector(U, oy).addScaledVector(F, -D);
    // the point under the middle of the safe rectangle: what the stop is "looking at"
    const sx = (safe.x0 + safe.x1) / 2;
    const sy = (safe.y0 + safe.y1) / 2;
    out.look.copy(out.pos).addScaledVector(F, D).addScaledVector(R, sx * tanH * D).addScaledVector(U, sy * tanV * D);
    out.dist = D;
    m4.makeBasis(R, U, this.tmp.w.copy(F).negate());
    out.quat.setFromRotationMatrix(m4);
    return out;
  }

  private stop(i: number, aspect: number, safe: SafeRect, out: Pose) {
    const st = this.park.stops[i];
    const swoop = smooth(this.intro);
    const yaw = st.yaw + this.yawOff - swoop * 0.7;
    const pitch = THREE.MathUtils.clamp(st.pitch + this.pitchOff + swoop * 0.35, 0.06, 1.35);
    this.fit(st, yaw, pitch, aspect, safe, out);
    // zoom (and the intro's pull-back) towards / away from the framed centre
    const k = this.zoom * (1 + swoop * 0.9);
    out.pos.sub(out.look).multiplyScalar(k).add(out.look);
    out.dist *= k;
    out.pos.y = Math.max(out.pos.y, 4);
    return out;
  }

  // —————————————————————————————————————————— trackside cameras

  private buildTripods() {
    const f = this.f;
    for (const a of ATTRACTIONS) {
      const st = this.park.stops.find((s) => s.id === a.id)!;
      // stay on the side the stop looks from: cuts never cross the line
      const toCam = new THREE.Vector3(Math.sin(st.yaw), 0, Math.cos(st.yaw));
      const ids = a.id === "jump" ? ["jump", "landing"] : a.id === "drag" ? ["drag-a"] : a.tracks;
      for (const id of ids) {
        const tr = this.park.byId.get(id)!;
        const every = tr.closed ? 48 : 58;
        for (let s = 14; s < tr.length - 6; s += every) {
          tr.frameAt(s, f);
          const side = Math.sign(f.side.dot(toCam)) || 1;
          const pos = f.p.clone().addScaledVector(f.side, side * (a.id === "drag" ? 46 : 30)).addScaledVector(f.t, 14);
          pos.y = Math.max(3.5, f.p.y + (a.id === "junction" ? 14 : 8));
          this.tripods.push({ pos: this.clear(pos), attraction: a.id });
        }
        // a camera on the outside of each loop, square to it
        for (const l of tr.loops) {
          tr.frameAt(l.s0, f);
          const base = f.p.clone();
          const sideN = f.side.clone();
          tr.frameAt((l.s0 + l.s1) / 2, this.f2);
          const centre = base.clone().add(this.f2.p).multiplyScalar(0.5);
          const r = base.distanceTo(this.f2.p) / 2;
          const sgn = Math.sign(sideN.dot(toCam)) || 1;
          this.tripods.push({ pos: centre.addScaledVector(sideN, sgn * r * 3.6).setY(centre.y + r * 0.2), attraction: a.id });
        }
        // a low camera just past the finish, the car flashing by
        if (tr.finish !== null) {
          tr.frameAt(tr.finish, f);
          const side = Math.sign(f.side.dot(toCam)) || 1;
          const pos = f.p.clone().addScaledVector(f.side, side * 16).addScaledVector(f.t, 22);
          pos.y = Math.max(2.5, f.p.y + 3);
          this.tripods.push({ pos, attraction: a.id });
        }
      }
    }
    // a few hand-placed ones: down on the castle, beside the ring, over the junction's X, the tower top
    const castle = this.park.props.find((p) => p.kind === "castle");
    if (castle?.kind === "castle") this.tripods.push({ pos: new THREE.Vector3(castle.x - 38, 9, castle.z + 34), attraction: "jump" });
    const ring = this.park.props.find((p) => p.kind === "ring");
    if (ring?.kind === "ring") this.tripods.push({ pos: new THREE.Vector3(ring.at[0] + 4, ring.at[1] - 2, ring.at[2] + 34), attraction: "jump" });
    const j = this.park.byId.get("junction");
    if (j) {
      j.frameAt(0, f);
      this.tripods.push({ pos: f.p.clone().add(new THREE.Vector3(0, 62, 46)), attraction: "junction" });
    }
    // round the Stunt Yard: just off the road, outside the loop, every tenth of a lap, and low by the ramps
    for (let i = 0; i < 10; i++) {
      const { p } = roadAt(i / 10 + 0.03);
      const out = new THREE.Vector3(p.x - YARD.x, 0, (p.z - YARD.z) * 1.8).normalize();
      this.tripods.push({ pos: p.clone().addScaledVector(out, 34).setY(10), attraction: "yard" });
    }
    this.tripods.push({ pos: new THREE.Vector3(150, 4, YARD.road.z1 + 30), attraction: "yard" });
    this.tripods.push({ pos: new THREE.Vector3(-80, 5, YARD.road.z0 - 26), attraction: "yard" });
    this.tripods.push({ pos: new THREE.Vector3(118, 6, 262), attraction: "yard" });
    this.tripods.push({ pos: new THREE.Vector3(-90, 24, 300), attraction: "yard" });
    const cyc = this.towers.find((t) => t.h > 80);
    if (cyc) this.tripods.push({ pos: new THREE.Vector3(cyc.x + 6, cyc.h + 30, cyc.z + 48), attraction: "cyclone" });
  }

  /** Keep a camera out of the towers and off the floor. */
  private clear(p: THREE.Vector3) {
    for (const t of this.towers) {
      if (p.y > t.h + 3) continue;
      const dx = p.x - t.x;
      const dz = p.z - t.z;
      const d = Math.hypot(dx, dz);
      const min = t.r + 4;
      if (d < min) {
        const k = min / (d || 1);
        p.x = t.x + dx * k;
        p.z = t.z + dz * k;
      }
    }
    p.y = Math.max(p.y, 2.2);
    return p;
  }

  // —————————————————————————————————————————— follow cameras

  private chase(sub: Subject, dt: number, out: Pose) {
    const { v, w } = this.tmp;
    const D = 24 * this.zoom;
    const H = 7 * this.zoom + 1.6;
    const want = v;
    const speed = Math.abs(sub.v);
    if (sub.track) {
      const tr = sub.track;
      const dir = sub.v >= -5 ? 1 : -1;
      // behind the car along its own track, so the camera swings round bends with it
      tr.frameAt(sub.s - dir * D, this.f);
      want.copy(this.f.p).addScaledVector(Y, H);
      // in and around a loop: out to the side, square to it, so you see the whole circle
      for (const l of tr.loops) {
        const before = l.s0 - sub.s;
        const after = sub.s - l.s1;
        const wgt = smooth(THREE.MathUtils.clamp(1 - Math.max(before, after, 0) / 30, 0, 1));
        if (wgt <= 0) continue;
        tr.frameAt(l.s0, this.f);
        const base = this.f.p.clone();
        const sideN = this.f.side.clone();
        tr.frameAt((l.s0 + l.s1) / 2, this.f2);
        const centre = base.clone().add(this.f2.p).multiplyScalar(0.5);
        const r = base.distanceTo(this.f2.p) / 2;
        const toCam = w.subVectors(this.off.lengthSq() ? this.off.clone().add(sub.pos) : sub.pos, centre);
        const sgn = Math.sign(sideN.dot(toCam)) || 1;
        const side = centre.addScaledVector(sideN, sgn * r * 3.3).addScaledVector(this.f.t, -r * 0.5).setY(centre.y + r * 0.35);
        want.lerp(side, wgt);
      }
      this.freeDir.copy(this.f.t).setY(0).normalize();
    } else {
      // flying or loose: behind it along its (level) direction of travel; as it comes to rest the
      // camera rises to look down on it (into the bin, over the wreck)
      if (sub.driven) {
        // your own car: the camera sits behind its nose, not its path (so it swings with your steering)
        const h = w.set(0, 0, 1).applyQuaternion(sub.quat).setY(0);
        if (h.lengthSq() > 0.05) this.freeDir.lerp(h.normalize(), ease(sub.airborne ? 1.5 : 6, dt)).normalize();
        want.copy(sub.pos).addScaledVector(this.freeDir, -D * 0.85).addScaledVector(Y, H * 0.85);
      } else {
        const h = w.copy(sub.vel).setY(0);
        if (h.lengthSq() > 400) this.freeDir.lerp(h.normalize(), ease(4, dt)).normalize();
        const settle = 1 - Math.min(1, sub.vel.length() / 120);
        want
          .copy(sub.pos)
          .addScaledVector(this.freeDir, -D * (1 - settle * 0.55))
          .addScaledVector(Y, H + settle * 24);
      }
    }
    // the drag-to-look offsets swing the camera round the car
    const offset = want.sub(sub.pos);
    if (this.yawOff || this.pitchOff) {
      offset.applyAxisAngle(Y, this.yawOff);
      const right = w.crossVectors(offset, Y).normalize();
      offset.applyAxisAngle(right, -this.pitchOff * 0.8);
    }
    // smooth the offset, not the position: the camera never trails a fast car
    if (!this.offInit) {
      this.off.copy(offset);
      this.offInit = true;
    }
    this.off.lerp(offset, ease(sub.track ? 5 : 3, dt));
    out.pos.copy(sub.pos).add(this.off);
    // don't let fixed things (the floor, other track, a tower) come between the camera and the car
    const from = w.copy(sub.pos).addScaledVector(Y, 1);
    const to = this.tmp.R.subVectors(out.pos, from);
    const len = to.length();
    const hit = len > 1 ? this.sim.castFixed(from, to.divideScalar(len), len) : null;
    const k = hit !== null && hit < len * 0.92 ? Math.max(0.12, (hit - 1.5) / len) : 1;
    this.clip += (k - this.clip) * ease(k < this.clip ? 14 : 2, dt);
    out.pos.copy(from).addScaledVector(to, len * this.clip);
    this.clear(out.pos);
    // look a little ahead of the car, where it's going
    const ahead = this.tmp.U.copy(sub.track ? this.tmp.F.set(0, 0, 1).applyQuaternion(sub.quat).multiplyScalar(Math.sign(sub.v || 1)) : sub.driven ? this.tmp.F.copy(this.freeDir) : this.tmp.F.copy(sub.vel)).setLength(Math.min(6, 2 + speed / 90));
    const lookAt = this.tmp.F.copy(sub.pos).add(ahead).addScaledVector(Y, 0.8);
    if (!this.lookSm.lengthSq() || this.lastMode !== "chase") this.lookSm.copy(lookAt);
    this.lookSm.lerp(lookAt, ease(12, dt));
    out.look.copy(this.lookSm);
    m4.lookAt(out.pos, out.look, Y);
    out.quat.setFromRotationMatrix(m4);
    out.dist = out.pos.distanceTo(out.look);
    // a wider lens with speed
    this.followFov = lerp(this.followFov, 44 + Math.min(16, speed / 30), ease(3, dt));
    return this.followFov;
  }

  private tv(sub: Subject, dt: number, now: number, out: Pose) {
    const at = sub.driven ? "yard" : sub.track ? attractionOf(sub.track.id) : this.lastAttraction;
    if (at) this.lastAttraction = at;
    const pool = this.tripods.filter((t) => t.attraction === at);
    const ahead = this.tmp.v.copy(sub.pos).addScaledVector(sub.vel, 0.35);
    let best: Tripod | null = null;
    let bestD = Infinity;
    for (const t of pool) {
      const d = t.pos.distanceTo(ahead);
      if (d < bestD) [best, bestD] = [t, d];
    }
    const curD = this.tp && pool.includes(this.tp) ? this.tp.pos.distanceTo(ahead) : Infinity;
    let cut = false;
    if (best && (curD === Infinity || curD > 170 || (now - this.tpSince > 1.1 && bestD < curD * 0.62))) {
      if (best !== this.tp) cut = true;
      this.tp = best;
      this.tpSince = now;
    }
    if (!this.tp) {
      // nowhere to stand (a car loose on the floor somewhere): fall back to the chase
      return this.chase(sub, dt, out);
    }
    out.pos.copy(this.tp.pos);
    const lookAt = this.tmp.w.copy(sub.pos).addScaledVector(sub.vel, 0.05).addScaledVector(Y, 0.6);
    if (cut || this.lastMode !== "tv") this.lookSm.copy(lookAt);
    this.lookSm.lerp(lookAt, ease(9, dt));
    out.look.copy(this.lookSm);
    m4.lookAt(out.pos, out.look, Y);
    out.quat.setFromRotationMatrix(m4);
    out.dist = out.pos.distanceTo(out.look);
    // the operator zooms to keep the car a steady size in frame
    const want = THREE.MathUtils.clamp(2 * THREE.MathUtils.radToDeg(Math.atan(15 / out.dist)), 7, 52);
    this.followFov = cut || this.lastMode !== "tv" ? want : lerp(this.followFov, want, ease(4, dt));
    return this.followFov;
  }

  private onboard(sub: Subject, dt: number, out: Pose) {
    const up = this.tmp.U.set(0, 1, 0).applyQuaternion(sub.quat);
    const fwd = this.tmp.F.set(0, 0, 1).applyQuaternion(sub.quat);
    out.pos.copy(sub.pos).addScaledVector(up, 2.05).addScaledVector(fwd, -0.6);
    // looking forward along the car, a touch down onto the bonnet; the car's roll and pitch are ours
    const target = this.tmp.q.copy(sub.quat).multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(0.1, Math.PI, 0)));
    if (!this.boardInit || this.lastMode !== "onboard") {
      this.boardQ.copy(target);
      this.boardInit = true;
    }
    this.boardQ.slerp(target, ease(16, dt));
    out.quat.copy(this.boardQ);
    out.look.copy(out.pos).addScaledVector(fwd, 30);
    out.dist = 30;
    return 66;
  }

  // —————————————————————————————————————————— every frame

  update(cam: THREE.PerspectiveCamera, dt: number, now: number, aspect: number, safe: SafeRect, target: number, mode: CamMode, sub: Subject | null, following: boolean) {
    // the stops: where along them, and the blend between the two either side
    this.p += (target - this.p) * ease(2.4, dt);
    if (!this.dragging && now - this.lastDrag > 2.5) {
      this.yawOff += (0 - this.yawOff) * ease(1.2, dt);
      this.pitchOff += (0 - this.pitchOff) * ease(1.2, dt);
    }
    this.intro = Math.max(0, this.intro - dt / 3.6);
    const n = this.park.stops.length;
    const i = Math.max(0, Math.min(n - 1, Math.floor(this.p)));
    const j = Math.min(n - 1, i + 1);
    const f = smooth(Math.max(0, Math.min(1, this.p - i)));
    const A = this.stop(i, aspect, safe, this.A);
    const sp = this.stopPose;
    if (f > 0.001 && j !== i) {
      const B = this.stop(j, aspect, safe, this.B);
      sp.pos.lerpVectors(A.pos, B.pos, f);
      // long hops rise like a crane
      sp.pos.y += Math.sin(Math.PI * f) * Math.min(90, A.look.distanceTo(B.look) * 0.2);
      sp.quat.slerpQuaternions(A.quat, B.quat, f);
      sp.look.lerpVectors(A.look, B.look, f);
      sp.dist = lerp(A.dist, B.dist, f);
    } else {
      sp.pos.copy(A.pos);
      sp.quat.copy(A.quat);
      sp.look.copy(A.look);
      sp.dist = A.dist;
    }

    // the follow camera, when there's a car to follow
    const on = following && !!sub && mode !== "orbit";
    this.followK += ((on ? 1 : 0) - this.followK) * ease(on ? 4.5 : 1.6, dt);
    let fFov = this.followFov;
    if (sub && mode !== "orbit") {
      if (mode === "chase") fFov = this.chase(sub, dt, this.follow);
      else if (mode === "tv") fFov = this.tv(sub, dt, now, this.follow);
      else fFov = this.onboard(sub, dt, this.follow);
      this.lastMode = mode;
    } else {
      this.offInit = false;
      this.lastMode = null;
    }
    if (!sub) {
      this.offInit = false;
      this.boardInit = false;
    }
    // onboard cuts straight in and out (a blend through the car's roof looks wrong); the others glide
    const k = mode === "onboard" ? (this.followK > 0.5 ? 1 : 0) : smooth(this.followK);
    cam.position.lerpVectors(sp.pos, this.follow.pos, k);
    if (k <= 0 || k >= 1) cam.quaternion.copy(k >= 1 ? this.follow.quat : sp.quat);
    else {
      // glide the point it's aimed at (the stop's screen centre → the car), so the view never swings off over the park
      const stopAim = this.tmp.v.set(0, 0, -1).applyQuaternion(sp.quat).multiplyScalar(sp.dist).add(sp.pos);
      const aim = stopAim.lerp(this.follow.look, k);
      m4.lookAt(cam.position, aim, Y);
      cam.quaternion.setFromRotationMatrix(m4);
    }
    this.look.lerpVectors(sp.look, this.follow.look, k);
    this.fov = lerp(STOP_FOV, fFov, k);
    this.near = mode === "onboard" && k > 0.5 ? 0.12 : 0.6;
    if (Math.abs(cam.fov - this.fov) > 0.01 || cam.near !== this.near) {
      cam.fov = this.fov;
      cam.near = this.near;
      cam.updateProjectionMatrix();
    }
    const tanV = Math.tan(THREE.MathUtils.degToRad(this.fov / 2));
    this.span = 2 * tanV * aspect * lerp(sp.dist, this.follow.dist, k);
    // shake: a smooth wobble (summed sines), its size by how far away the camera is
    if (this.trauma > 0.001) {
      this.shakeT += dt;
      const t = this.shakeT * 31;
      const a = this.trauma * this.trauma;
      const amp = lerp(this.span * 0.006, 0.9, k) * a;
      const n = (o: number) => Math.sin(t + o) * 0.6 + Math.sin(t * 2.3 + o * 1.7) * 0.4;
      cam.position.x += n(0) * amp;
      cam.position.y += n(11) * amp;
      cam.position.z += n(23) * amp;
      cam.rotateZ(n(37) * 0.02 * a);
      this.trauma = Math.max(0, this.trauma - dt * 1.6);
    }
    this.targets = k > 0.5 && sub ? [this.look, sub.pos] : [this.look, ...this.stopTargets[Math.round(this.p)]];
    return { stopIndex: Math.round(this.p), nearStop: Math.abs(this.p - Math.round(this.p)) < 0.3 };
  }

  /** The tracks this attraction's cameras watch (for the minimap highlight). */
  static tracksOf(id: AttractionId, park: Park): Track[] {
    const a = ATTRACTIONS.find((x) => x.id === id);
    return a ? a.tracks.map((t) => park.byId.get(t)!).filter(Boolean) : [];
  }
}
