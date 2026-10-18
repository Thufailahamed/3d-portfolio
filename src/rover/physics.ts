import * as THREE from "three";
import { clamp, noise } from "./noise";
import type { Ground } from "./terrain";
import type { World } from "./worlds";

/**
 * A six-wheeled rover as one rigid body with per-wheel suspension, motor-driven wheels and
 * impulse-based tyre friction (true static friction, wheelspin and sliding all emerge from it).
 * Everything that differs between worlds is physical input: gravity, air density, wind, soil.
 *
 * Body frame: +z forward, +y up, +x to the rover's left.
 */
export const ROVER = {
  mass: 899,
  /** principal moments (kg·m²) about the centre of mass: pitch(x), yaw(y), roll(z) */
  inertia: new THREE.Vector3(820, 1180, 640),
  wheelR: 0.26,
  wheelW: 0.4,
  /** suspension: anchor→wheel-centre length when unloaded, usable travel, spring & damper per wheel */
  restLen: 0.5,
  maxComp: 0.36,
  k: 13500,
  c: 1500,
  /** wheel + gearbox inertia reflected to the wheel */
  Iw: 2.4,
  tMax: 290,
  /** drag area (Cd·A, m²) and the volume that displaces air (for buoyancy, m³) */
  cdA: 4.6,
  volume: 2.5,
  /** body-frame suspension anchors: FL, FR, ML, MR, RL, RR */
  mounts: [
    [1.22, -0.06, 1.12],
    [-1.22, -0.06, 1.12],
    [1.22, -0.06, 0.02],
    [-1.22, -0.06, 0.02],
    [1.22, -0.06, -1.06],
    [-1.22, -0.06, -1.06],
  ] as [number, number, number][],
  steerable: [true, true, false, false, true, true],
  /** points on the chassis, deck, mast and RTG that can touch the ground */
  hull: [
    [0.85, -0.16, 1.05], [-0.85, -0.16, 1.05], [0.85, -0.16, -1.05], [-0.85, -0.16, -1.05], [0, -0.18, 0],
    [0.85, 0.36, 1.05], [-0.85, 0.36, 1.05], [0.85, 0.36, -1.05], [-0.85, 0.36, -1.05],
    [0.55, 1.95, 0.72], [0, 0.55, -1.6], [0, 0.2, 1.35],
  ] as [number, number, number][],
  /** RTG electrical output (W) and battery capacity (Wh) — Curiosity's MMRTG and two Li-ion packs */
  rtgW: 110,
  batteryWh: 2350,
};

export const SPEEDS = [
  { id: "mission", label: "Mission", sub: "0.15 km/h — Curiosity's real pace", v: 0.042 },
  { id: "lrv", label: "Apollo LRV", sub: "18 km/h — the lunar rover's top speed", v: 5 },
  { id: "explorer", label: "Explorer", sub: "32 km/h", v: 9 },
  { id: "rally", label: "Rally", sub: "58 km/h — motors unrestricted", v: 16 },
] as const;

export type Wheel = {
  mount: THREE.Vector3;
  steer: number;
  omega: number;
  spin: number;
  len: number;
  comp: number;
  contact: boolean;
  load: number;
  normal: THREE.Vector3;
  center: THREE.Vector3;
  point: THREE.Vector3;
  fwd: THREE.Vector3;
  side: THREE.Vector3;
  slip: number;
  lat: number;
  torque: number;
  onRock: boolean;
  locked: boolean;
  jf: number;
  jl: number;
  bump: number;
};

export type SimEvent =
  | { type: "land"; air: number; height: number; dist: number; impact: number }
  | { type: "bump"; strength: number; at: THREE.Vector3 }
  | { type: "scrape"; strength: number; at: THREE.Vector3 }
  | { type: "takeoff" };

const STEP = 1 / 120;
const UP = new THREE.Vector3(0, 1, 0);
const v1 = new THREE.Vector3();
const v2 = new THREE.Vector3();
const v3 = new THREE.Vector3();
const rv = new THREE.Vector3();
const nrm = new THREE.Vector3();
const m3 = new THREE.Matrix3();

export class RoverSim {
  pos = new THREE.Vector3();
  quat = new THREE.Quaternion();
  vel = new THREE.Vector3();
  ang = new THREE.Vector3();
  wheels: Wheel[];
  input = { throttle: 0, steer: 0, brake: false };
  vmax = 9;
  enabled = false;
  time = 0;
  /** telemetry */
  odometer = 0;
  battery = 1;
  powerW = 0;
  airborne = false;
  airT = 0;
  airStart = new THREE.Vector3();
  airApex = 0;
  bestAir = 0;
  upright = 1;
  overturned = 0;
  pointTurn = false;
  gLoad = 1;
  hullForce = 0;
  wind = new THREE.Vector3();
  events: SimEvent[] = [];
  private acc = 0;
  private F = new THREE.Vector3();
  private T = new THREE.Vector3();
  private R = new THREE.Matrix3();
  private invI = new THREE.Vector3();
  private lastBump = 0;

  constructor(
    public world: World,
    public groundFn: Ground,
  ) {
    this.invI.set(1 / ROVER.inertia.x, 1 / ROVER.inertia.y, 1 / ROVER.inertia.z);
    this.wheels = ROVER.mounts.map((m) => ({
      mount: new THREE.Vector3(...m),
      steer: 0,
      omega: 0,
      spin: 0,
      len: ROVER.restLen,
      comp: 0,
      contact: false,
      load: 0,
      normal: new THREE.Vector3(0, 1, 0),
      center: new THREE.Vector3(),
      point: new THREE.Vector3(),
      fwd: new THREE.Vector3(),
      side: new THREE.Vector3(),
      slip: 0,
      lat: 0,
      torque: 0,
      onRock: false,
      locked: false,
      jf: 0,
      jl: 0,
      bump: 0,
    }));
  }

  /** set the rover down at rest, wheels at their loaded sag */
  place(x: number, z: number, yaw: number, dropHeight = 0) {
    const g = this.groundFn;
    const sag = Math.min(ROVER.maxComp * 0.9, (ROVER.mass * this.world.g) / 6 / ROVER.k);
    const hc = Math.max(g.ground(x, z), g.ground(x + 1, z + 1), g.ground(x - 1, z - 1), g.ground(x + 1, z - 1), g.ground(x - 1, z + 1));
    const y = hc + ROVER.wheelR + (ROVER.restLen - sag) + 0.06 + dropHeight;
    this.pos.set(x, y, z);
    this.quat.setFromAxisAngle(UP, yaw);
    this.vel.set(0, 0, 0);
    this.ang.set(0, 0, 0);
    for (const w of this.wheels) {
      w.omega = 0;
      w.comp = sag;
      w.len = ROVER.restLen - sag;
      w.steer = 0;
    }
    this.airborne = false;
    this.overturned = 0;
  }

  /** rotate a world vector by the inverse inertia tensor */
  private applyInvI(v: THREE.Vector3, out: THREE.Vector3) {
    m3.copy(this.R).transpose();
    out.copy(v).applyMatrix3(m3);
    out.set(out.x * this.invI.x, out.y * this.invI.y, out.z * this.invI.z);
    return out.applyMatrix3(this.R);
  }

  /** height of the wheel centre needed to touch the ground under (x, z), treating the wheel as a circle */
  private wheelSeat(x: number, z: number, fx: number, fz: number) {
    const g = this.groundFn;
    const r = ROVER.wheelR;
    const a = 0.62 * r;
    const lift = Math.sqrt(r * r - a * a);
    const c = g.ground(x, z) + r;
    const f = g.ground(x + fx * a, z + fz * a) + lift;
    const b = g.ground(x - fx * a, z - fz * a) + lift;
    return Math.max(c, f, b);
  }

  step(dt: number) {
    if (!this.enabled) return;
    this.acc += Math.min(dt, 0.1);
    let n = 0;
    while (this.acc >= STEP && n < 12) {
      this.substep(STEP);
      this.acc -= STEP;
      n++;
    }
    if (n === 12) this.acc = 0;
  }

  private substep(h: number) {
    const W = this.world;
    const g = this.groundFn;
    const rho = W.atm.rho;
    this.time += h;
    this.R.setFromMatrix4(new THREE.Matrix4().makeRotationFromQuaternion(this.quat));
    const up = v1.set(0, 1, 0).applyQuaternion(this.quat);
    const fwdB = new THREE.Vector3(0, 0, 1).applyQuaternion(this.quat);
    this.upright = up.y;
    const F = this.F.set(0, -W.g * ROVER.mass, 0);
    const T = this.T.set(0, 0, 0);

    // —— steering & drive commands ——
    const speedFwd = this.vel.dot(fwdB);
    const { throttle, steer, brake } = this.input;
    const absV = Math.abs(speedFwd);
    this.pointTurn = Math.abs(throttle) < 0.05 && Math.abs(steer) > 0.1 && absV < 0.5 && !brake;
    const mu = W.soil.mu;
    let kappa = 0;
    if (!this.pointTurn) {
      // tighter turns at low speed; at speed, limit the demanded lateral acceleration to what gravity allows... loosely
      const kMax = Math.min(1 / 2.6, Math.max((1.1 * mu * W.g) / Math.max(absV * absV, 0.01), 1 / 22));
      kappa = steer * kMax;
    }
    const batteryLimit = this.battery > 0.001 ? 1 : 0.35;
    const vCmd = throttle * this.vmax * batteryLimit;
    const yawRateCmd = steer * Math.min(0.5, this.vmax / 2.2);
    const steerRate = 1.8;

    for (let i = 0; i < 6; i++) {
      const w = this.wheels[i];
      const m = w.mount;
      let target = 0;
      let wheelV = vCmd;
      if (this.pointTurn) {
        if (ROVER.steerable[i]) {
          target = Math.atan2(-m.z, m.x);
          if (target > Math.PI / 2) target -= Math.PI;
          if (target < -Math.PI / 2) target += Math.PI;
        }
        wheelV = yawRateCmd * (m.z * Math.sin(target) - m.x * Math.cos(target));
      } else {
        if (ROVER.steerable[i] && Math.abs(kappa) > 1e-4) {
          const R0 = 1 / kappa;
          target = Math.atan2(m.z, R0 - m.x);
          if (target > Math.PI / 2) target -= Math.PI;
          if (target < -Math.PI / 2) target += Math.PI;
        }
        wheelV = vCmd * Math.hypot(1 - kappa * m.x, kappa * m.z);
      }
      const ds = clamp(target - w.steer, -steerRate * h, steerRate * h);
      w.steer += ds;
      w.locked = (brake || (Math.abs(throttle) < 0.02 && !this.pointTurn && absV < 0.08)) && w.contact;
      // motor: proportional speed control, torque-limited
      const omegaT = wheelV / ROVER.wheelR;
      const tLim = brake ? ROVER.tMax * 1.6 : ROVER.tMax * (Math.abs(throttle) < 0.02 && !this.pointTurn ? 0.7 : 1);
      w.torque = clamp((omegaT - w.omega) * 320, -tLim, tLim);
    }

    // —— suspension ——
    const down = v2.copy(up).negate();
    const contacts: number[] = [];
    for (let i = 0; i < 6; i++) {
      const w = this.wheels[i];
      const A = rv.copy(w.mount).applyMatrix3(this.R).add(this.pos);
      const hx = Math.sin(w.steer);
      const hz = Math.cos(w.steer);
      const head = v3.set(hx, 0, hz).applyQuaternion(this.quat);
      const hl = Math.hypot(head.x, head.z) || 1;
      const fx = head.x / hl;
      const fz = head.z / hl;
      // solve along the suspension axis for where the wheel circle meets the ground
      const dy = Math.min(-0.25, down.y);
      let t = (A.y - this.wheelSeat(A.x, A.z, fx, fz)) / -dy;
      for (let it = 0; it < 2; it++) {
        const cx = A.x + down.x * t;
        const cz = A.z + down.z * t;
        t = (A.y - this.wheelSeat(cx, cz, fx, fz)) / -dy;
      }
      const prevComp = w.comp;
      if (t >= ROVER.restLen) {
        w.contact = false;
        w.len = ROVER.restLen;
        w.comp = 0;
        w.load = 0;
        w.bump = 0;
      } else {
        w.contact = true;
        const comp = ROVER.restLen - t;
        w.comp = Math.min(comp, ROVER.maxComp + 0.08);
        w.len = ROVER.restLen - w.comp;
        const cv = (w.comp - prevComp) / h;
        let Fs = ROVER.k * comp + ROVER.c * cv;
        w.bump = 0;
        if (comp > ROVER.maxComp) {
          // bump stop: the rocker hits its hard stop
          const over = comp - ROVER.maxComp;
          const fb = 260000 * over + 9000 * Math.max(0, cv);
          Fs += fb;
          w.bump = fb;
        }
        Fs = clamp(Fs, 0, 120000);
        w.load = Fs;
        contacts.push(i);
      }
      w.center.copy(A).addScaledVector(down, w.len);
      if (w.contact) {
        g.normal(w.center.x, w.center.z, nrm);
        w.normal.copy(nrm);
        w.point.copy(w.center).addScaledVector(nrm, -ROVER.wheelR);
        w.onRock = g.onRock(w.point.x, w.point.z);
        const force = rv.copy(up).multiplyScalar(w.load);
        F.add(force);
        T.add(v3.copy(w.center).sub(this.pos).cross(force));
        // contact frame: wheel heading projected onto the ground
        w.fwd.set(hx, 0, hz).applyQuaternion(this.quat);
        w.fwd.addScaledVector(nrm, -w.fwd.dot(nrm)).normalize();
        w.side.copy(nrm).cross(w.fwd).normalize();
      }
    }
    // a hard hit on the bump stops
    const bumpMax = Math.max(...this.wheels.map((w) => w.bump));
    if (bumpMax > 8000 && this.time - this.lastBump > 0.25) {
      this.lastBump = this.time;
      this.events.push({ type: "bump", strength: Math.min(1, bumpMax / 60000), at: this.pos.clone() });
    }

    // —— hull against the ground (rolling over, high-centring on a rock) ——
    let hullF = 0;
    for (const p of ROVER.hull) {
      const P = rv.set(p[0], p[1], p[2]).applyMatrix3(this.R).add(this.pos);
      const gy = g.ground(P.x, P.z);
      const pen = gy - P.y;
      if (pen <= 0) continue;
      g.normal(P.x, P.z, nrm);
      const r = v3.copy(P).sub(this.pos);
      const vp = new THREE.Vector3().copy(this.ang).cross(r).add(this.vel);
      const vn = vp.dot(nrm);
      const fn = Math.max(0, 240000 * pen - 9000 * vn);
      const vt = vp.addScaledVector(nrm, -vn);
      const vtl = vt.length();
      const ft = vt.multiplyScalar((-mu * fn * Math.tanh(vtl / 0.15)) / Math.max(vtl, 1e-6));
      const f = ft.addScaledVector(nrm, fn);
      F.add(f);
      T.add(r.clone().cross(f));
      hullF += fn;
    }
    this.hullForce = hullF;
    if (hullF > 20000 && this.time - this.lastBump > 0.3) {
      this.lastBump = this.time;
      this.events.push({ type: "scrape", strength: Math.min(1, hullF / 120000), at: this.pos.clone() });
    }

    // —— the air: drag against the wind, buoyancy, a little rotational damping ——
    if (rho > 0) {
      const gust = W.atm.gust * (0.5 + 0.5 * noise(this.time * 0.35, 3.1, 7)) * Math.max(0, noise(this.time * 0.11, 9.2, 8) + 0.3);
      this.wind.set(0.8, 0, 0.6).multiplyScalar(W.atm.wind + gust);
      const rel = v3.copy(this.vel).sub(this.wind);
      const sp = rel.length();
      F.addScaledVector(rel, -0.5 * rho * ROVER.cdA * sp);
      F.y += rho * ROVER.volume * W.g;
      T.addScaledVector(this.ang, -rho * 14 * this.ang.length());
    } else this.wind.set(0, 0, 0);
    T.addScaledVector(this.ang, -12);

    // —— integrate velocities ——
    this.vel.addScaledVector(F, h / ROVER.mass);
    this.ang.add(this.applyInvI(T, v3).multiplyScalar(h));

    // —— wheels: motor torque and rolling resistance ——
    let power = 0;
    for (const w of this.wheels) {
      if (w.locked) {
        w.omega = 0;
        continue;
      }
      w.omega += (w.torque * h) / ROVER.Iw;
      if (w.contact) {
        const rr = W.soil.crr * w.load * ROVER.wheelR * h / ROVER.Iw;
        w.omega = Math.abs(w.omega) <= rr ? 0 : w.omega - Math.sign(w.omega) * rr;
      } else w.omega *= 1 - 0.4 * h;
      power += Math.max(0, w.torque * w.omega);
    }

    // —— tyre friction: sequential impulses inside each wheel's friction circle ——
    for (const i of contacts) {
      const w = this.wheels[i];
      w.jf = 0;
      w.jl = 0;
    }
    const tmpA = new THREE.Vector3();
    const tmpB = new THREE.Vector3();
    for (let it = 0; it < 5; it++) {
      for (const i of contacts) {
        const w = this.wheels[i];
        const r = tmpA.copy(w.point).sub(this.pos);
        const vp = tmpB.copy(this.ang).cross(r).add(this.vel);
        const maxJ = mu * w.load * h;
        // longitudinal (the wheel's own spin is part of the constraint)
        const vf = vp.dot(w.fwd) - w.omega * ROVER.wheelR;
        const rf = v1.copy(r).cross(w.fwd);
        const kf = 1 / ROVER.mass + this.applyInvI(rf, v2).dot(rf) + (w.locked ? 0 : (ROVER.wheelR * ROVER.wheelR) / ROVER.Iw);
        let jf = -vf / kf;
        // lateral
        const vl = vp.dot(w.side);
        const rl = v1.copy(r).cross(w.side);
        const kl = 1 / ROVER.mass + this.applyInvI(rl, v2).dot(rl);
        let jl = -vl / kl;
        // clamp the accumulated pair to the friction circle
        let nf = w.jf + jf;
        let nl = w.jl + jl;
        const mag = Math.hypot(nf, nl);
        if (mag > maxJ) {
          nf *= maxJ / mag;
          nl *= maxJ / mag;
        }
        jf = nf - w.jf;
        jl = nl - w.jl;
        w.jf = nf;
        w.jl = nl;
        const J = v3.copy(w.fwd).multiplyScalar(jf).addScaledVector(w.side, jl);
        this.vel.addScaledVector(J, 1 / ROVER.mass);
        this.ang.add(this.applyInvI(v1.copy(r).cross(J), v2));
        if (!w.locked) w.omega -= (jf * ROVER.wheelR) / ROVER.Iw;
      }
    }
    for (const w of this.wheels) {
      if (!w.contact) {
        w.slip = 0;
        w.lat = 0;
        continue;
      }
      const r = tmpA.copy(w.point).sub(this.pos);
      const vp = tmpB.copy(this.ang).cross(r).add(this.vel);
      w.slip = vp.dot(w.fwd) - w.omega * ROVER.wheelR;
      w.lat = vp.dot(w.side);
    }

    // —— integrate pose ——
    this.pos.addScaledVector(this.vel, h);
    const a = this.ang;
    const q = this.quat;
    const dq = new THREE.Quaternion(a.x * h * 0.5, a.y * h * 0.5, a.z * h * 0.5, 0).multiply(q);
    q.set(q.x + dq.x, q.y + dq.y, q.z + dq.z, q.w + dq.w).normalize();
    for (const w of this.wheels) w.spin += w.omega * h;

    // —— bookkeeping: odometer, battery, air time, rollover ——
    const gs = Math.hypot(this.vel.x, this.vel.z);
    if (contacts.length) this.odometer += gs * h;
    const elec = power / 0.62 + 45;
    this.powerW = this.powerW + (elec - this.powerW) * Math.min(1, h * 6);
    this.battery = clamp(this.battery + ((ROVER.rtgW - elec) * h) / 3600 / ROVER.batteryWh, 0, 1);
    const totalLoad = this.wheels.reduce((s, w) => s + w.load, 0) + hullF;
    this.gLoad = totalLoad / (ROVER.mass * EARTH);

    const air = contacts.length === 0 && hullF === 0;
    if (air && !this.airborne) {
      this.airborne = true;
      this.airT = 0;
      this.airStart.copy(this.pos);
      this.airApex = 0;
      this.events.push({ type: "takeoff" });
    }
    if (this.airborne) {
      this.airT += h;
      const above = this.pos.y - g.ground(this.pos.x, this.pos.z) - 0.85;
      this.airApex = Math.max(this.airApex, above);
      if (!air) {
        this.airborne = false;
        if (this.airT > 0.35) {
          const dist = Math.hypot(this.pos.x - this.airStart.x, this.pos.z - this.airStart.z);
          this.events.push({ type: "land", air: this.airT, height: this.airApex, dist, impact: Math.abs(this.vel.y) });
          this.bestAir = Math.max(this.bestAir, this.airT);
        }
      }
    }
    if (this.upright < 0.25 && gs < 1.5) this.overturned += h;
    else this.overturned = 0;
  }

  /** right the rover where it stands */
  recover() {
    const yaw = Math.atan2(new THREE.Vector3(0, 0, 1).applyQuaternion(this.quat).x, new THREE.Vector3(0, 0, 1).applyQuaternion(this.quat).z);
    this.place(this.pos.x, this.pos.z, yaw, 0.6);
  }

  forwardSpeed() {
    return this.vel.dot(new THREE.Vector3(0, 0, 1).applyQuaternion(this.quat));
  }
}

export const EARTH = 9.80665;
