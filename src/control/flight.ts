/**
 * Powered flight from the pad to payload separation, integrated in 3D in the inertial frame.
 *
 *  - US Standard Atmosphere 1976 (pressure, density, speed of sound) for thrust, drag and Mach;
 *  - thrust varies with back-pressure between the sea-level and vacuum ratings, mass flow follows Isp;
 *  - first stage: vertical rise, pitch kick, then a zero-angle-of-attack gravity turn, throttled
 *    through Max-Q; above the sensible atmosphere a closed-loop explicit guidance law (the family of
 *    Shuttle PEG) flies the upper stage to the insertion target, steering out-of-plane errors too;
 *  - restartable upper stages coast and relight for circularisation, GTO or escape burns;
 *  - every recovered booster is its own simulation: boostback, entry burn and a hoverslam landing.
 *
 * Internals in SI (m, m/s, kg, N). Elements handed back are in km (see orbit.ts).
 */

import { DRONESHIPS, siteById, vehicleById, type PositionId, type Recovery, type Site, type StageSpec, type Vehicle, type VehicleId } from "./data";
import * as O from "./orbit";
import type { V3 } from "./orbit";

const MU = O.MU * 1e9;
const RE = O.RE * 1000;
const G0 = 9.80665;
const W = O.OMEGA_E;
const P0 = 101_325;
const D2R = Math.PI / 180;
const { add, sub, mul, dot, cross, len, norm, v3 } = O;

// ———————————————————————————— atmosphere ————————————————————————————

const LAYERS: [number, number, number, number][] = [
  [0, 288.15, -0.0065, 101325],
  [11000, 216.65, 0, 22632.1],
  [20000, 216.65, 0.001, 5474.89],
  [32000, 228.65, 0.0028, 868.019],
  [47000, 270.65, 0, 110.906],
  [51000, 270.65, -0.0028, 66.9389],
  [71000, 214.65, -0.002, 3.95642],
  [84852, 186.946, 0, 0.3734],
];
const R_AIR = 287.053;
export function atmosphere(h: number) {
  const hh = Math.max(0, h);
  let i = LAYERS.length - 1;
  while (i > 0 && LAYERS[i][0] > hh) i--;
  const [hb, Tb, L, pb] = LAYERS[i];
  let T: number;
  let p: number;
  if (i === LAYERS.length - 1) {
    T = Tb;
    p = pb * Math.exp(-(hh - hb) / 5800);
  } else {
    T = Tb + L * (hh - hb);
    p = L === 0 ? pb * Math.exp((-G0 * (hh - hb)) / (R_AIR * Tb)) : pb * Math.pow(Tb / T, G0 / (R_AIR * L));
  }
  return { p, rho: p / (R_AIR * T), a: Math.sqrt(1.4 * R_AIR * T), T };
}

const CD: [number, number][] = [[0, 0.3], [0.8, 0.32], [1.05, 0.55], [1.3, 0.52], [2, 0.42], [3, 0.33], [5, 0.27], [10, 0.25]];
function cd(mach: number) {
  if (mach >= CD[CD.length - 1][0]) return CD[CD.length - 1][1];
  for (let k = 1; k < CD.length; k++) {
    if (mach < CD[k][0]) {
      const [m0, c0] = CD[k - 1];
      const [m1, c1] = CD[k];
      return c0 + ((c1 - c0) * (mach - m0)) / (m1 - m0);
    }
  }
  return 0.3;
}

// ———————————————————————————— launch geometry ————————————————————————————

/**
 * Inertial launch azimuth (rad, from north) that reaches inclination `inc` from latitude `lat`,
 * picked inside the range's safety corridor; null when the range forbids it.
 */
export function chooseAzimuth(site: Site, incDeg: number) {
  const phi = site.lat * D2R;
  const x = Math.cos(incDeg * D2R) / Math.cos(phi);
  if (Math.abs(x) > 1.0005) return null;
  const b1 = Math.asin(Math.max(-1, Math.min(1, x)));
  const cands = [b1, Math.PI - b1];
  const vEq = W * RE * Math.cos(phi);
  for (const beta of cands) {
    // ground azimuth flown: the pad already moves east with the Earth
    const g = Math.atan2(7800 * Math.sin(beta) - vEq, 7800 * Math.cos(beta));
    let gd = g / D2R;
    const [a0, a1] = site.az;
    if (gd < a0 - 1) gd += 360;
    if (gd > a1 + 1) gd -= 360;
    if (gd >= a0 - 1 && gd <= a1 + 1) return { beta, ground: g, groundDeg: ((gd % 360) + 360) % 360, south: Math.cos(beta) < 0 };
  }
  return null;
}

/** the lowest inclination the range allows from this pad */
export function minInclination(site: Site) {
  let best = 180;
  for (let i = Math.ceil(Math.abs(site.lat) * 10) / 10; i <= 140; i += 0.1) {
    if (chooseAzimuth(site, i)) {
      best = i;
      break;
    }
  }
  return Math.round(best * 10) / 10;
}

export type Burn2 = { kind: "circ"; hp: number } | { kind: "gto"; ha: number } | { kind: "escape"; c3: number; label?: string };
export type Insertion = { hp1: number; ha1: number; inc: number; burn2?: Burn2; coast?: "apo" | "node" | "time"; coastTime?: number };

export type FlightPlan = {
  vehicle: VehicleId;
  payloadMass: number;
  site: string;
  recovery: Recovery;
  ins: Insertion;
  crewed: boolean;
  deployDelay: number;
  jd0: number;
  kick?: number;
  failure?: { kind: "engine"; t: number } | null;
};

export type FlightEvent = { t: number; id: string; label: string; who: PositionId; say?: string; tone?: "good" | "warn" | "bad" | "info" };
export type Sample = { t: number; h: number; dr: number; v: number; vs: number; a: number; q: number; mach: number; m: number; thr: number; pitch: number; stage: number; lat: number; lon: number; vr: number };

type Phase = "ascent" | "burn1" | "coast" | "burn2" | "coast2" | "deployed" | "failed" | "aborted";

const fmtT = (t: number) => {
  const s = Math.max(0, Math.round(t));
  return `T+${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
};

/** thrust (N) and mass flow (kg/s) of a stage at ambient pressure p */
function engineOut(st: StageSpec, p: number, thr: number, frac = 1) {
  const fv = st.thrustVac * 1000;
  const fs = st.thrustSL * 1000;
  const F = Math.max(0, fv - (fv - fs) * (p / P0)) * thr * frac;
  const mdot = (fv * thr * frac) / (st.ispVac * G0);
  return { F, mdot };
}

// ———————————————————————————— recovered boosters ————————————————————————————

/** altitude (m) at which a vertical burn of thrust F started now would bring the stage to rest */
function stopAltitude(h: number, vUp: number, m: number, F: number, cdA: number) {
  let y = h;
  let v = vUp;
  const dt = 0.1;
  for (let t = 0; t < 90 && v < 0; t += dt) {
    const rho = atmosphere(y).rho;
    const a = F / m + (0.5 * rho * v * v * cdA) / m - G0;
    v += a * dt;
    y += v * dt;
    if (y < -200) break;
  }
  return y;
}

export type BoosterPhase = "coast" | "boostback" | "entry" | "descent" | "landing" | "landed" | "lost" | "chute" | "splash" | "impact" | "lesBurn";

export class Returner {
  phase: BoosterPhase = "coast";
  t = 0;
  hist: { t: number; h: number; v: number; dr: number }[] = [];
  done = false;
  entryV0 = 0;
  thr = 0;
  burning = 0;
  dir: V3;
  maxH = 0;
  landDr = 0;
  landEngines = 13;
  private lastS = -1;
  constructor(
    public label: string,
    public mode: Recovery | "capsule",
    public r: V3,
    public v: V3,
    public dry: number,
    public prop: number,
    public stage: StageSpec,
    public diameter: number,
    public lz: string,
    private f: Flight,
  ) {
    this.dir = norm(v);
  }
  get mass() {
    return this.dry + this.prop;
  }
  get h() {
    return len(this.r) - RE;
  }
  step(dt: number) {
    if (this.done) return;
    this.t += dt;
    // a spent stage that made orbit (SLS core) is no longer tracked by the recovery team
    if (this.mode === "expend" && this.t > 900 && len(this.r) - RE > 100_000) {
      this.phase = "impact";
      this.done = true;
      this.landDr = this.f.downrange(this.r) / 1000;
      return;
    }
    const rm = len(this.r);
    const h = rm - RE;
    const up = mul(this.r, 1 / rm);
    const atm = atmosphere(h);
    const vAtm = v3(-W * this.r.y, W * this.r.x, 0);
    const vRel = sub(this.v, vAtm);
    const vm = len(vRel);
    const g = MU / (rm * rm);
    const vr = dot(this.v, up);
    this.maxH = Math.max(this.maxH, h);
    let thrust = 0;
    let mdot = 0;
    let dir = this.dir;
    const perEngine = (n: number, thr = 1) => engineOut(this.stage, atm.p, thr, n / this.stage.engines);
    const say = (id: string, label: string, who: PositionId, tone: FlightEvent["tone"] = "info", text?: string) => this.f.emit(id + ":" + this.label, label, who, tone, text);

    if (this.mode === "capsule") {
      if (this.phase === "lesBurn") {
        thrust = this.mass * 9 * G0;
        dir = norm(add(up, mul(norm(vRel), 0.4)));
        if (this.t > 4) {
          this.phase = "coast";
          say("les-out", "Abort motors burnout — capsule coasting", "FLIGHT");
        }
      } else if (this.phase === "coast" && vr < 0 && h < 6500) {
        this.phase = "chute";
        say("mains", "Drogues and main parachutes deployed", "RECOVERY", "good", "Recovery: drogues out. Mains out. Four good mains.");
      }
    } else if (this.phase === "coast") {
      if (this.mode === "rtls" || this.mode === "catch") {
        if (this.t > 10 && this.entryV0 === 0) {
          this.phase = "boostback";
          say("boostback", `${this.label}: boostback burn startup`, "BOOSTER", "info", `${this.label} boostback burn startup.`);
        }
      } else if ((this.mode === "asds") && vr < 0 && h < 68_000 && vm > 900) {
        this.phase = "entry";
        this.entryV0 = vm;
        say("entry", `${this.label}: entry burn startup`, "BOOSTER", "info", "Entry burn startup.");
      } else if (this.mode === "chute" && vr < 0 && h < 9000 && vm < 280) {
        this.phase = "chute";
        say("chute", `${this.label}: parachute deployed`, "RECOVERY", "good", "Recovery: stage one parachute deploy confirmed.");
      }
    }

    if (this.phase === "boostback") {
      const site = this.f.siteNow();
      const d = sub(site, this.r);
      const dh = sub(d, mul(up, dot(d, up)));
      const dist = len(dh);
      const dhat = mul(dh, 1 / (dist || 1));
      const vToward = dot(vRel, dhat);
      const tFall = (vr + Math.sqrt(Math.max(0, vr * vr + 2 * g * Math.max(h, 0)))) / g;
      const remain = dist - vToward * tFall * 0.92;
      const n = this.mode === "catch" ? 13 : 3;
      ({ F: thrust, mdot } = perEngine(n));
      dir = norm(add(dhat, mul(up, 0.12)));
      if (remain <= 0 || this.prop < this.dry * 0.35) {
        this.phase = "coast";
        this.entryV0 = -1;
        say("bb-off", `${this.label}: boostback shutdown`, "BOOSTER", "info", "Boostback shutdown.");
      }
    }
    if ((this.mode === "rtls" || this.mode === "catch") && this.phase === "coast" && this.entryV0 === -1 && vr < 0 && h < 55_000 && vm > 700) {
      this.phase = "entry";
      this.entryV0 = vm;
      say("entry", `${this.label}: entry burn startup`, "BOOSTER", "info", "Entry burn startup.");
    }
    // aerodynamics: engines-first with grid fins, or under canopy
    let area = Math.PI * (this.diameter / 2) ** 2;
    let cdv = this.mode === "capsule" ? 1.2 : 1.25;
    if (this.phase === "chute") {
      area = this.mode === "capsule" ? 1200 : 160;
      cdv = 1.4;
    }
    const drag = h < 120_000 && vm > 0.1 ? 0.5 * atm.rho * vm * vm * cdv * area : 0;
    const dragA = drag / this.mass;
    // Super Heavy lights 13 engines, then drops to the centre 3 once they alone can finish the job
    if (this.mode === "catch" && this.phase === "landing" && this.landEngines === 13) {
      const a3 = engineOut(this.stage, atm.p, 1, 3 / this.stage.engines).F / this.mass - g;
      const vu = dot(vRel, up);
      if ((vu * vu) / (2 * Math.max(h - 2, 1)) < 0.6 * a3) this.landEngines = 3;
    }
    const nL = this.mode === "catch" ? this.landEngines : 1;
    const landable = this.mode === "asds" || this.mode === "rtls" || this.mode === "catch";
    const landF = landable ? engineOut(this.stage, P0, 1, nL / this.stage.engines).F : 0;
    // what the landing burn will need: ~550 m/s of Δv on the landing engines
    const landReserve = this.mass * (1 - Math.exp(-550 / (this.stage.ispSL * G0)));
    if (this.phase === "entry") {
      ({ F: thrust, mdot } = perEngine(3));
      dir = mul(norm(vRel), -1);
      if (vm < Math.max(this.entryV0 * 0.55, 750) || h < 30_000 || this.prop < landReserve * 1.15) {
        this.phase = "descent";
        say("entry-off", `${this.label}: entry burn shutdown`, "BOOSTER");
      }
    }
    // a hoverslam: light at the last moment, predicting the burn (drag included) to stop at the deck
    const vRelUp = dot(vRel, up);
    const vRelH = sub(vRel, mul(up, vRelUp));
    if (landable && (this.phase === "descent" || this.phase === "coast") && vRelUp < 0 && h < 14_000) {
      if (stopAltitude(h, vRelUp, this.mass, landF * 0.8, area * cdv) <= 45) {
        this.phase = "landing";
        say("landing", `${this.label}: landing burn startup`, "BOOSTER", "info", "Landing burn.");
      }
    }
    if (this.phase === "landing") {
      const full = engineOut(this.stage, atm.p, 1, nL / this.stage.engines);
      // constant deceleration to a stop 12 m above the deck (less the drag still helping), then a slow
      // terminal descent; sideways drift nulled by touchdown
      const hh = Math.max(h - 12, 0.5);
      const dragUp = vm > 0.1 ? dragA * (-vRelUp / vm) : 0;
      const az = h > 14 && vRelUp < -3 ? (vRelUp * vRelUp) / (2 * hh) + g - dragUp * 0.7 : g + 2.2 * (-2.2 - vRelUp);
      const tgo = Math.max(1, (2 * Math.max(h, 1)) / Math.max(1, -vRelUp));
      const aVec = add(mul(up, Math.max(0, az)), mul(vRelH, -Math.min(2, 2 / tgo)));
      const want = (len(aVec) * this.mass) / Math.max(full.F, 1);
      // a Merlin cannot throttle low enough to hover: below its floor, cut and fall a moment longer
      const thr = want < this.stage.minThrottle * 0.55 ? 0 : Math.max(this.stage.minThrottle, Math.min(1, want));
      if (thr > 0) ({ F: thrust, mdot } = perEngine(nL, thr));
      dir = len(aVec) > 0.01 ? norm(aVec) : up;
      if (h < 1.5 && -vRelUp < 4) {
        this.v = vAtm;
        this.finish(len(vRelH) < 5 ? "landed" : "lost");
        return;
      }
    }

    if (this.prop <= 0) {
      thrust = 0;
      mdot = 0;
    }
    this.thr = thrust;
    this.burning = thrust > 0 ? 1 : 0;
    this.dir = dir;
    const m = this.mass;
    const a = add(add(mul(this.r, -MU / (rm * rm * rm)), mul(dir, thrust / m)), mul(vRel, -drag / (m * Math.max(vm, 1e-3))));
    this.v = add(this.v, mul(a, dt));
    this.r = add(this.r, mul(this.v, dt));
    this.prop = Math.max(0, this.prop - mdot * dt);

    const tq = Math.floor(this.t / 0.5);
    if (tq !== this.lastS) {
      this.lastS = tq;
      this.hist.push({ t: this.f.t, h: h / 1000, v: vm, dr: this.f.downrange(this.r) / 1000 });
    }
    if (len(this.r) - RE <= 0) {
      const vImpact = vm;
      if (this.phase === "chute") this.finish("splash");
      else if (this.phase === "landing" && vImpact < 8) this.finish("landed");
      else this.finish(this.mode === "expend" ? "impact" : "lost");
    }
  }
  private finish(p: BoosterPhase) {
    this.phase = p;
    this.done = true;
    this.thr = 0;
    this.landDr = this.f.downrange(this.r) / 1000;
    const where = this.mode === "asds" ? `on ${this.lz}` : this.mode === "catch" ? "— caught by the tower chopsticks" : this.mode === "rtls" ? `at ${this.lz}` : "";
    if (p === "landed") this.f.emit("landed:" + this.label, `${this.label}: touchdown ${where}`, "BOOSTER", "good", this.mode === "catch" ? "Catch! Booster caught by the tower." : `${this.label} has landed ${where}. The Falcon has landed.`.replace("The Falcon has landed.", this.label.includes("ooster") || this.label.includes("core") || this.label.includes("stage") ? "The Falcon has landed." : ""));
    else if (p === "splash") this.f.emit("splash:" + this.label, `${this.label}: splashdown`, "RECOVERY", "good", this.mode === "capsule" ? "Splashdown. The crew is safe. Recovery forces are moving in." : "Stage one splashdown. Recovery vessel is on its way.");
    else if (p === "lost") this.f.emit("lost:" + this.label, `${this.label}: lost on landing`, "BOOSTER", "bad", "We have lost telemetry from the booster. Looks like a hard landing.");
    else if (p === "impact") this.f.emit("impact:" + this.label, `${this.label}: impact downrange`, "RANGE", "info");
  }
}

// ———————————————————————————— the flight ————————————————————————————

export class Flight {
  readonly veh: Vehicle;
  readonly site: Site;
  t = 0;
  r: V3;
  v: V3;
  dir: V3;
  phase: Phase = "ascent";
  result: "flying" | "orbit" | "failed" | "aborted" = "flying";
  why = "";
  // propellant and what is still attached
  bProp: number;
  cProp: number;
  uProp: number;
  bOn: boolean;
  cOn = true;
  uOn = true;
  fairingOn: boolean;
  bLit: boolean;
  cLit = true;
  uLit = false;
  cEngines: number;
  thrB = 0;
  thrC = 0;
  thrU = 0;
  /** thrust (N) per group this step, for plumes and sound */
  fB = 0;
  fC = 0;
  fU = 0;
  q = 0;
  qMax = 0;
  qMaxT = 0;
  mach = 0;
  acc = 0;
  pAmb = P0;
  events: FlightEvent[] = [];
  fresh: FlightEvent[] = [];
  hist: Sample[] = [];
  recov: Returner[] = [];
  capsule: Returner | null = null;
  payload: { r: V3; v: V3; jd: number } | null = null;
  coastEl: O.Elements | null = null;
  burn2At = Infinity;
  deployAt = Infinity;
  sepAt = Infinity;
  sesAt = Infinity;
  private hg: V3;
  private n: V3 | null = null;
  private kick: number;
  private stage1EG = false;
  private said = new Set<string>();
  private sampleEvery: number;
  private lastSample = -1;
  private liftoff = false;
  private site0: V3;
  private jdFlightPrev = 0;
  shortfall = 0;
  yawErr = 0;
  coreDelivered = false;
  meco = 0;
  seco = 0;
  constructor(public plan: FlightPlan, opts: { sample?: number } = {}) {
    this.veh = vehicleById[plan.vehicle];
    this.site = siteById[plan.site];
    this.sampleEvery = opts.sample ?? 0.5;
    const b = this.veh.boosters;
    this.bOn = !!b;
    this.bLit = !!b;
    this.bProp = b ? b.prop : 0;
    this.cProp = this.veh.stages[0].prop;
    this.uProp = this.veh.stages[1].prop;
    this.fairingOn = this.veh.fairing > 0;
    this.cEngines = this.veh.stages[0].engines;
    this.kick = plan.kick ?? 3;
    const site = this.site;
    this.r = mul(O.geoToEci(site.lat * D2R, site.lon * D2R, 0, plan.jd0), 1000);
    this.site0 = O.eciToEcef(this.r, plan.jd0);
    this.v = v3(-W * this.r.y, W * this.r.x, 0);
    const up = norm(this.r);
    this.dir = up;
    // ground heading for the pitch kick
    const az = chooseAzimuth(site, plan.ins.inc);
    const g = az ? az.ground : Math.PI / 2;
    const lonI = Math.atan2(up.y, up.x);
    const phi = Math.asin(up.z);
    const east = v3(-Math.sin(lonI), Math.cos(lonI), 0);
    const north = v3(-Math.sin(phi) * Math.cos(lonI), -Math.sin(phi) * Math.sin(lonI), Math.cos(phi));
    this.hg = norm(add(mul(east, Math.sin(g)), mul(north, Math.cos(g))));
    this.jdFlightPrev = plan.jd0;
  }

  get jd() {
    return this.plan.jd0 + this.t / 86400;
  }
  get mass() {
    const v = this.veh;
    let m = this.plan.payloadMass + (this.fairingOn ? v.fairing : 0);
    if (this.uOn) m += v.stages[1].dry + this.uProp;
    if (this.cOn) m += v.stages[0].dry + this.cProp;
    if (this.bOn && v.boosters) m += v.boosters.count * (v.boosters.dry + this.bProp);
    return m;
  }
  get alt() {
    return len(this.r) - RE;
  }
  get powered() {
    return this.phase === "ascent" || this.phase === "burn1" || this.phase === "burn2" || this.recov.some((b) => !b.done) || (this.capsule !== null && !this.capsule.done);
  }
  get stageIdx() {
    return this.bOn ? 0 : this.cOn ? 1 : 2;
  }
  get coreReserve() {
    return this.veh.stages[0].prop * (this.veh.reserve[this.plan.recovery] ?? 0);
  }
  get boosterReserve() {
    const b = this.veh.boosters;
    if (!b || b.solid) return 0;
    const mode = this.veh.boosterRecovery?.[0];
    return mode && this.plan.recovery !== "expend" ? b.prop * 0.13 : 0;
  }
  siteNow() {
    const g = O.gmst(this.jd);
    const c = Math.cos(g), s = Math.sin(g);
    const e = this.site0;
    return v3(c * e.x - s * e.y, s * e.x + c * e.y, e.z);
  }
  downrange(r: V3) {
    const ef = O.eciToEcef(r, this.jd);
    const a = norm(ef);
    const b = norm(this.site0);
    return Math.acos(Math.max(-1, Math.min(1, dot(a, b)))) * RE;
  }
  emit(id: string, label: string, who: PositionId, tone: FlightEvent["tone"] = "info", say?: string) {
    if (this.said.has(id)) return;
    this.said.add(id);
    const ev = { t: this.t, id, label, who, say, tone };
    this.events.push(ev);
    this.fresh.push(ev);
  }
  elements() {
    return O.elementsFromState(mul(this.r, 1 / 1000), mul(this.v, 1 / 1000), this.jd);
  }

  /** advance by `dt` seconds of mission time */
  advance(dt: number, h = 0.05) {
    let left = dt;
    let guard = 0;
    while (left > 1e-6 && guard++ < 200_000) {
      if (this.phase === "coast" || this.phase === "coast2" || this.phase === "deployed" || this.phase === "failed" || this.phase === "aborted") {
        // ballistic: exact Kepler propagation, boosters still integrated
        const boosting = this.recov.some((b) => !b.done) || (this.capsule && !this.capsule.done);
        const until = this.phase === "coast" ? this.burn2At : this.phase === "coast2" ? this.deployAt : Infinity;
        const step = boosting ? Math.min(left, h) : Math.min(left, Math.max(0, until - this.t));
        if (this.phase === "failed" || this.phase === "aborted") {
          if (this.phase === "failed" && this.alt > 0 && this.result !== "orbit") this.integrate(step, false);
          else this.t += step;
        } else this.coastTo(this.t + step);
        for (const b of this.recov) b.step(step);
        this.capsule?.step(step);
        left -= step;
        if (step === 0 || this.t >= until - 1e-9) {
          if (this.phase === "coast" && this.t >= this.burn2At - 1e-9) this.startBurn2();
          else if (this.phase === "coast2" && this.t >= this.deployAt - 1e-9) this.deploy();
          else if (step === 0) break;
        }
        this.sample();
        continue;
      }
      const s = Math.min(left, h);
      this.integrate(s, true);
      for (const b of this.recov) b.step(s);
      left -= s;
      this.sample();
    }
  }

  private coastTo(t: number) {
    if (!this.coastEl) this.coastEl = this.elements();
    this.t = t;
    const st = O.stateAt(this.coastEl, this.jd);
    this.r = mul(st.r, 1000);
    this.v = mul(st.v, 1000);
    this.fB = this.fC = this.fU = 0;
    this.q = 0;
    this.acc = 0;
    if (this.alt < 80_000 && this.phase !== "deployed") {
      this.coastEl = null;
      this.fail("Vehicle re-entered — orbit not achieved");
    }
  }

  private integrate(dt: number, powered: boolean) {
    const rm = len(this.r);
    const h = rm - RE;
    const up = mul(this.r, 1 / rm);
    const atm = atmosphere(h);
    this.pAmb = h > 150_000 ? 0 : atm.p;
    const vAtm = v3(-W * this.r.y, W * this.r.x, 0);
    const vRel = sub(this.v, vAtm);
    const vm = len(vRel);
    this.q = h > 150_000 ? 0 : 0.5 * atm.rho * vm * vm;
    this.mach = vm / atm.a;
    if (this.q > this.qMax && this.t > 5) {
      this.qMax = this.q;
      this.qMaxT = this.t;
    }
    const veh = this.veh;
    const b = veh.boosters;
    let F = 0;
    let fB = 0, fC = 0, fU = 0;
    let mdB = 0, mdC = 0, mdU = 0;
    if (powered && this.phase !== "failed") {
      const qLim = veh.qLimit * 1000;
      const qThr = this.q > qLim ? qLim / this.q : 1;
      const boostersBurning = this.bOn && this.bLit && this.bProp > this.boosterReserve;
      if (boostersBurning && b) {
        this.thrB = b.solid ? 1 : Math.max(b.minThrottle, Math.min(1, qThr));
        // solid grains tail off as the web burns through
        const left = this.bProp / b.prop;
        const tail = b.solid && left < 0.18 ? 0.3 + (0.7 * left) / 0.18 : 1;
        const e = engineOut(b, atm.p, this.thrB * tail);
        fB = e.F * b.count;
        mdB = e.mdot * b.count;
      } else this.thrB = 0;
      const s0 = veh.stages[0];
      if (this.cOn && this.cLit && this.cProp > this.coreReserve) {
        let thr = boostersBurning && veh.coreThrottleWithBoosters ? veh.coreThrottleWithBoosters : 1;
        thr = Math.min(thr, qThr);
        if (!this.bOn && s0.minThrottle < 1) {
          const aNow = engineOut(s0, atm.p, 1, this.cEngines / s0.engines).F / this.mass;
          const lim = (this.plan.crewed ? 4.2 : 5) * G0;
          if (aNow > lim) thr = Math.min(thr, lim / aNow);
        }
        this.thrC = Math.max(s0.minThrottle, thr);
        const e = engineOut(s0, atm.p, this.thrC, this.cEngines / s0.engines);
        fC = e.F;
        mdC = e.mdot;
      } else this.thrC = 0;
      const s1 = veh.stages[1];
      if (this.uOn && this.uLit && this.uProp > 0) {
        let thr = 1;
        const aNow = engineOut(s1, atm.p, 1).F / this.mass;
        const lim = (this.plan.crewed ? 4.2 : 5.5) * G0;
        if (aNow > lim) thr = Math.max(s1.minThrottle, lim / aNow);
        this.thrU = thr;
        const e = engineOut(s1, atm.p, thr);
        fU = e.F;
        mdU = e.mdot;
      } else this.thrU = 0;
      F = fB + fC + fU;
    }
    this.fB = fB;
    this.fC = fC;
    this.fU = fU;
    const m = this.mass;
    const mdot = mdB + mdC + mdU;
    // hold-down until thrust exceeds weight
    if (!this.liftoff) {
      const wgt = (m * MU) / (rm * rm);
      if (F > wgt * 1.02) {
        this.liftoff = true;
        this.emit("liftoff", "Liftoff", "PAO", "good", `And liftoff! Liftoff of ${veh.name}.`);
      } else {
        this.t += dt;
        this.r = O.mul(this.siteNow(), 1);
        this.v = v3(-W * this.r.y, W * this.r.x, 0);
        this.consume(mdB, mdC, mdU, dt);
        return;
      }
    }
    let dir = F > 0 ? this.guide(up, vRel, F, mdot, m) : this.dir;
    // a failed inertial platform walks the thrust vector off the trajectory
    if (this.yawErr > 0 && F > 0) dir = norm(add(dir, mul(norm(cross(up, dir)), this.yawErr)));
    this.dir = dir;
    const area = Math.PI * (veh.diameter / 2) ** 2 * (this.bOn && b ? 1 + 0.25 * b.count * (b.solid ? 0.7 : 1) : 1);
    const drag = h < 140_000 && vm > 0.1 ? this.q * cd(this.mach) * area : 0;
    const a = add(add(mul(this.r, -MU / (rm * rm * rm)), mul(dir, F / m)), mul(vRel, -drag / (m * Math.max(vm, 1e-3))));
    this.acc = len(sub(a, mul(this.r, -MU / (rm * rm * rm)))) / G0;
    this.v = add(this.v, mul(a, dt));
    this.r = add(this.r, mul(this.v, dt));
    this.t += dt;
    this.consume(mdB, mdC, mdU, dt);
    if (powered) this.sequence();
    if (len(this.r) - RE < -5 && this.t > 5 && this.phase !== "failed") this.fail("Vehicle impacted the ground");
  }

  private consume(mdB: number, mdC: number, mdU: number, dt: number) {
    const b = this.veh.boosters;
    if (b) this.bProp = Math.max(0, this.bProp - (mdB / b.count) * dt);
    this.cProp = Math.max(0, this.cProp - mdC * dt);
    this.uProp = Math.max(0, this.uProp - mdU * dt);
  }

  /** steering: where the thrust points */
  private guide(up: V3, vRel: V3, F: number, mdot: number, m: number): V3 {
    const h = this.alt;
    const tVert = this.veh.kit === "electron" ? 5 : this.veh.height > 90 ? 12 : 8;
    if (this.phase === "burn2") return norm(this.v);
    if (this.phase === "ascent") {
      if (this.t < tVert || h < 120) return up;
      const kickEnd = tVert + 8;
      const k = this.kick * D2R;
      if (this.t < kickEnd) {
        const f = (this.t - tVert) / 8;
        const a = k * f;
        return norm(add(mul(up, Math.cos(a)), mul(this.hg, Math.sin(a))));
      }
      const pitchV = Math.asin(Math.max(-1, Math.min(1, dot(norm(vRel), up))));
      if (!this.stage1EG && pitchV > Math.PI / 2 - k) return norm(add(mul(up, Math.cos(k)), mul(this.hg, Math.sin(k))));
      if (this.q < 800 && h > 45_000) this.stage1EG = true;
      if (!this.stage1EG) return norm(vRel);
    }
    return this.explicit(up, F, mdot, m);
  }

  private explicit(up: V3, F: number, mdot: number, m: number): V3 {
    const ins = this.plan.ins;
    const rm = len(this.r);
    if (!this.n) {
      // the target plane through the current position at the target inclination
      const lonI = Math.atan2(up.y, up.x);
      const phi = Math.asin(up.z);
      const east = v3(-Math.sin(lonI), Math.cos(lonI), 0);
      const north = v3(-Math.sin(phi) * Math.cos(lonI), -Math.sin(phi) * Math.sin(lonI), Math.cos(phi));
      const x = Math.max(-1, Math.min(1, Math.cos(ins.inc * D2R) / Math.cos(phi)));
      const b1 = Math.asin(x);
      const goingNorth = dot(this.v, north) >= 0;
      const beta = goingNorth ? b1 : Math.PI - b1;
      const hdg = add(mul(east, Math.sin(beta)), mul(north, Math.cos(beta)));
      this.n = norm(cross(up, hdg));
    }
    const n = this.n;
    const hh = norm(cross(n, up));
    const vr = dot(this.v, up);
    const vh = dot(this.v, hh);
    const vn = dot(this.v, n);
    const rn = dot(this.r, n);
    const rt = RE + ins.hp1 * 1000;
    const at = RE + ((ins.hp1 + ins.ha1) / 2) * 1000;
    const vht = Math.sqrt(MU * (2 / rt - 1 / at));
    const aT = F / m;
    const dv = Math.hypot(vht - vh, vr, vn);
    const ve = F / Math.max(mdot, 1e-6);
    let T = (m / Math.max(mdot, 1e-6)) * (1 - Math.exp(-dv / ve));
    if (this.cOn && this.cLit) {
      // time-to-go spans the rest of the core burn plus the upper stage
      const usable = Math.max(0, this.cProp - this.coreReserve);
      const dvCore = ve * Math.log(m / Math.max(1, m - usable));
      if (dv > dvCore) {
        const s1 = this.veh.stages[1];
        const mU = this.plan.payloadMass + s1.dry + this.uProp + (this.fairingOn ? this.veh.fairing * 0.3 : 0);
        const veU = s1.ispVac * G0;
        const mdU = (s1.thrustVac * 1000) / veU;
        T = usable / Math.max(mdot, 1e-6) + this.veh.stagingGap + (mU / mdU) * (1 - Math.exp(-(dv - dvCore) / veU));
      }
    }
    T = Math.max(T, 4);
    if (T < 7) return this.dir;
    const A = (6 * (rt - rm - (2 / 3) * vr * T)) / (T * T);
    const geff = MU / (rm * rm) - (vh * vh + vn * vn) / rm;
    // early in a long burn, never thrust downward (gravity does that for free); near the end, level off hard
    const floor = -0.12 - 0.45 * Math.max(0, Math.min(1, (220 - T) / 160));
    const sr = Math.max(floor, Math.min(0.92, (A + geff) / aT));
    const An = (6 * (-rn - (2 / 3) * vn * T)) / (T * T);
    const sn = Math.max(-0.3, Math.min(0.3, An / aT));
    const sh = Math.sqrt(Math.max(0.01, 1 - sr * sr - sn * sn));
    return norm(add(add(mul(up, sr), mul(hh, sh)), mul(n, sn)));
  }

  /** events and staging */
  private sequence() {
    const veh = this.veh;
    const h = this.alt;
    const b = veh.boosters;
    if (this.liftoff && h > (veh.height > 90 ? 150 : 110)) this.emit("tower", "Tower cleared", "FLIGHT", "info", "Tower cleared. Houston now controlling.");
    if (this.t > 20 && this.t < 40 && h > 2000) this.emit("pitch", "Pitch and roll program", "GUIDO", "info", "Vehicle is pitching downrange. Roll program complete.");
    if (this.qMax > 8000 && this.q < this.qMax * 0.94 && this.t - this.qMaxT > 2) this.emit("maxq", `Max-Q · ${(this.qMax / 1000).toFixed(1)} kPa`, "FIDO", "info", "Vehicle is passing through max Q, the period of maximum aerodynamic pressure on the rocket.");
    if (this.mach > 1 && this.t > 20) this.emit("mach1", "Supersonic", "FIDO", "info", "Vehicle is supersonic.");
    // boosters burn out
    if (this.bOn && b && this.bProp <= this.boosterReserve + 1) {
      this.bOn = false;
      this.bLit = false;
      const name = b.solid ? (veh.id === "sls" ? "Booster separation" : "Solid rocket booster jettison") : veh.id === "soyuz" ? "Strap-on booster separation — the Korolev cross" : "BECO · side booster separation";
      this.emit("beco", name, "BOOSTER", "info", b.solid ? "Solid rocket booster separation confirmed." : veh.id === "soyuz" ? "Strap-on boosters separation." : "Booster engine cutoff. Side booster separation.");
      const mode = this.plan.recovery !== "expend" ? veh.boosterRecovery?.[0] : undefined;
      if (mode) {
        ["Side booster A", "Side booster B"].forEach((label, i) => {
          const off = mul(norm(cross(up(this.r), this.v)), (i ? 1 : -1) * 4);
          this.recov.push(new Returner(label, mode, add(this.r, off), add(this.v, mul(off, 0.5)), b.dry, this.boosterReserve, b, veh.diameter, i ? "Landing Zone 2" : "Landing Zone 1", this));
        });
      } else if (!b.solid || veh.id === "sls") {
        this.recov.push(new Returner(b.name, "expend", this.r, this.v, b.dry, 0, b, veh.diameter, "", this));
      }
    }
    // core cutoff
    if (this.cOn && this.cLit && this.cProp <= this.coreReserve + 1) {
      this.cLit = false;
      this.meco = this.t;
      this.emit("meco", "MECO", "BOOSTER", "info", veh.hotStaging ? "Main engine cutoff. Hot staging." : "Main engine cutoff confirmed.");
      this.sepAt = this.t + (veh.hotStaging ? 0.6 : 3);
      this.sesAt = this.t + (veh.hotStaging ? 0 : veh.stagingGap);
      if (veh.hotStaging) {
        this.uLit = true;
        this.phase = "burn1";
      }
    }
    if (this.cOn && this.t >= this.sepAt) {
      this.cOn = false;
      this.emit("stagesep", "Stage separation", "BOOSTER", "info", "Stage separation confirmed.");
      const s0 = veh.stages[0];
      const mode = this.plan.recovery;
      const label = veh.id === "falconheavy" ? "Center core" : veh.id === "starship" ? "Super Heavy" : "First stage";
      const lz = mode === "asds" ? DRONESHIPS[Math.floor(this.plan.jd0 * 7) % DRONESHIPS.length] : mode === "rtls" ? this.site.lz ?? "Landing Zone 1" : mode === "catch" ? "the tower" : "";
      this.recov.push(new Returner(label, mode, this.r, this.v, s0.dry, this.cProp, s0, veh.diameter, lz, this));
      this.cProp = 0;
    }
    // core stage guidance cutoff: it already delivered the insertion energy (SLS puts itself in orbit)
    if (this.phase === "ascent" && this.cLit && this.stage1EG) {
      const E = dot(this.v, this.v) / 2 - MU / len(this.r);
      const at = RE + ((this.plan.ins.hp1 + this.plan.ins.ha1) / 2) * 1000;
      if (E >= -MU / (2 * at)) {
        this.coreDelivered = true;
        this.cProp = Math.min(this.cProp, this.coreReserve);
      }
    }
    if (!this.uLit && this.t >= this.sesAt && !this.cOn && this.phase === "ascent") {
      if (this.coreDelivered) {
        this.emit("park", `${veh.stages[0].name} delivered the parking orbit`, "FIDO", "good", "FIDO: core stage cutoff on target. We are in the parking orbit.");
        this.cutoff(1, this.elements(), true);
      } else {
        this.uLit = true;
        this.phase = "burn1";
        this.emit("ses1", veh.stages[1].name + " ignition", "BOOSTER", "info", `${veh.stages[1].engine} ignition. Second stage engine start.`);
      }
    }
    if (this.fairingOn && this.phase !== "ascent" && h > (this.plan.crewed ? 90_000 : 110_000)) {
      this.fairingOn = false;
      this.emit("fairing", this.plan.crewed ? "Launch abort system jettison" : "Fairing separation", "PAYLOADS", "info", this.plan.crewed ? "Launch escape system jettison." : "Fairing separation confirmed.");
    }
    if (veh.id === "electron" && this.phase === "burn1" && this.t - this.sesAt > 210) this.emit("battery", "Battery hot-swap", "EECOM", "info", "Battery hot swap complete.");
    // failures injected by the sim supervisor
    const fl = this.plan.failure;
    if (fl && fl.kind === "engine" && this.t >= fl.t && this.cOn && this.cLit && this.cEngines === veh.stages[0].engines) {
      if (veh.stages[0].engines > 1) {
        this.cEngines -= 1;
        this.emit("engine-out", `Engine out — ${this.cEngines} of ${veh.stages[0].engines} running`, "BOOSTER", "warn", `Flight, Booster. We've lost an engine. Remaining engines are compensating, guidance is re-targeting.`);
      } else this.fail("Main engine shutdown — loss of thrust");
    }
    // upper stage cutoffs
    if (this.phase === "burn1") {
      const el = this.elements();
      const E = dot(this.v, this.v) / 2 - MU / len(this.r);
      const at = RE + ((this.plan.ins.hp1 + this.plan.ins.ha1) / 2) * 1000;
      if (E >= -MU / (2 * at)) this.cutoff(1, el);
      else if (this.uProp <= 0) this.depleted(el);
    } else if (this.phase === "burn2") {
      const el = this.elements();
      const b2 = this.plan.ins.burn2!;
      let done = false;
      if (b2.kind === "circ") done = O.periapsis(el) >= b2.hp - 0.5 || O.apoapsis(el) > b2.hp + 400;
      else if (b2.kind === "gto") done = O.apoapsis(el) >= b2.ha;
      else done = (dot(this.v, this.v) / 2 - MU / len(this.r)) / 1e6 >= b2.c3 / 2;
      if (done) this.cutoff(2, el);
      else if (this.uProp <= 0) this.depleted(el);
    }
  }

  private cutoff(n: 1 | 2, el: O.Elements, silent = false) {
    this.uLit = false;
    this.seco = this.t;
    const ins = this.plan.ins;
    const hp = O.periapsis(el), ha = O.apoapsis(el);
    const orbitTxt = el.e < 1 ? `${Math.round(hp)} × ${Math.round(ha).toLocaleString("en-US")} km at ${(el.i / D2R).toFixed(1)}°` : `C3 ${((dot(this.v, this.v) / 2 - MU / len(this.r)) / 5e5).toFixed(1)} km²/s²`;
    if (!silent) this.emit("seco" + n, `SECO-${n} · ${orbitTxt}`, "FIDO", "good", n === 1 && ins.burn2 ? "Second engine cutoff. We are in the parking orbit." : "Second engine cutoff. Nominal orbit insertion.");
    this.coastEl = null;
    if (n === 1 && ins.burn2) {
      this.phase = "coast";
      this.coastEl = this.elements();
      const s1 = this.veh.stages[1];
      const ve = s1.ispVac * G0;
      const mdot = (s1.thrustVac * 1000) / ve;
      const m = this.mass;
      let dv = 0;
      let wait = 0;
      const b2 = ins.burn2;
      const jd = this.jd;
      if (b2.kind === "circ") {
        const ra = el.a * (1 + el.e) * 1000;
        const vApo = Math.sqrt(MU * (2 / ra - 1 / (el.a * 1000)));
        const rp2 = (RE + b2.hp * 1000);
        const a2 = (ra + rp2) / 2;
        dv = Math.sqrt(MU * (2 / ra - 1 / a2)) - vApo;
        wait = O.timeToAnomaly(el, jd, "apo");
      } else if (b2.kind === "gto") {
        const r = len(this.r);
        const a2 = (r + RE + b2.ha * 1000) / 2;
        dv = Math.sqrt(MU * (2 / r - 1 / a2)) - Math.sqrt(MU / r);
        const P = O.period(el.a);
        const tn = O.timeToNode(el, jd);
        const c = [tn, tn + P / 2, tn - P / 2, tn + P].filter((x) => x >= 540).sort((a, b) => a - b);
        wait = c[0] ?? 600;
      } else {
        const r = len(this.r);
        dv = Math.sqrt(b2.c3 * 1e6 + (2 * MU) / r) - Math.sqrt(MU / r);
        wait = el.e > 0.02 ? O.timeToAnomaly(el, jd, "peri") : ins.coastTime ?? 1200;
      }
      const tb = (m / mdot) * (1 - Math.exp(-Math.max(0, dv) / ve));
      this.burn2At = this.t + Math.max(60, wait - tb / 2);
    } else {
      this.phase = "coast2";
      this.coastEl = this.elements();
      this.deployAt = this.t + this.plan.deployDelay;
    }
  }

  private depleted(el: O.Elements) {
    this.uLit = false;
    const hp = O.periapsis(el);
    const rm = len(this.r);
    const ins = this.plan.ins;
    const at = RE + ((ins.hp1 + ins.ha1) / 2) * 1000;
    const vNeed = Math.sqrt(MU * (2 / rm - 1 / at));
    this.shortfall = Math.max(0, vNeed - len(this.v));
    if (hp > 140 && el.e < 1) {
      this.emit("depl", `Propellant depletion — off-nominal orbit ${Math.round(hp)} × ${Math.round(O.apoapsis(el))} km`, "FIDO", "warn", "Flight, FIDO. Premature shutdown, propellant depletion. We are in an off-nominal but stable orbit.");
      this.coastEl = null;
      this.phase = "coast2";
      this.coastEl = this.elements();
      this.deployAt = this.t + this.plan.deployDelay;
    } else {
      this.fail(`Propellant depleted ${Math.round(this.shortfall)} m/s short of orbit`);
    }
  }

  private startBurn2() {
    this.coastEl = null;
    this.phase = "burn2";
    this.uLit = true;
    const b2 = this.plan.ins.burn2!;
    const what = b2.kind === "circ" ? "circularisation burn" : b2.kind === "gto" ? "GTO burn" : b2.label ?? "Earth departure burn";
    this.emit("ses2", `SES-2 · ${what}`, "BOOSTER", "info", `Second engine start, number two. Beginning the ${what}.`);
  }

  private deploy() {
    this.phase = "deployed";
    this.result = "orbit";
    this.payload = { r: mul(this.r, 1 / 1000), v: mul(this.v, 1 / 1000), jd: this.jd };
    this.emit("deploy", this.plan.crewed ? "Spacecraft separation" : "Payload deploy", "PAYLOADS", "good", this.plan.crewed ? "Spacecraft separation confirmed. The crew is on their way." : "Payload deploy confirmed. We have spacecraft separation.");
  }

  fail(why: string) {
    if (this.phase === "failed") return;
    this.phase = "failed";
    this.result = "failed";
    this.why = why;
    this.uLit = this.cLit = this.bLit = false;
    this.fB = this.fC = this.fU = 0;
    this.emit("fail", why, "FLIGHT", "bad", `Flight, we have a problem. ${why}.`);
  }

  /** abort: the capsule pulls away; uncrewed vehicles are destroyed by range safety */
  abort() {
    if (this.result !== "flying") return;
    if (this.plan.crewed) {
      this.emit("abort", "ABORT — launch escape system fired", "FLIGHT", "bad", "Abort, abort, abort. Launch escape system is firing.");
      const c = new Returner("Crew capsule", "capsule", this.r, this.v, this.plan.payloadMass * 0.8, 0, this.veh.stages[1], 4, "", this);
      c.phase = this.alt > 100_000 ? "coast" : "lesBurn";
      this.capsule = c;
      this.phase = "aborted";
      this.result = "aborted";
      this.uLit = this.cLit = this.bLit = false;
      this.fB = this.fC = this.fU = 0;
      this.why = "Crew abort";
    } else {
      this.emit("fts", "Flight termination system activated", "RANGE", "bad", "Range Safety: flight termination. The vehicle has been destroyed over the ocean.");
      this.fail("Vehicle destroyed by range safety");
    }
  }

  private sample() {
    const tq = Math.floor(this.t / this.sampleEvery);
    if (tq === this.lastSample) return;
    this.lastSample = tq;
    const up = norm(this.r);
    const vAtm = v3(-W * this.r.y, W * this.r.x, 0);
    const g = O.eciToGeo(mul(this.r, 1 / 1000), this.jd);
    const vr = dot(this.v, up);
    const vhat = norm(this.dir);
    this.hist.push({
      t: this.t,
      h: this.alt / 1000,
      dr: this.downrange(this.r) / 1000,
      v: len(this.v),
      vs: len(sub(this.v, vAtm)),
      a: this.acc,
      q: this.q / 1000,
      mach: this.mach,
      m: this.mass / 1000,
      thr: Math.max(this.thrC, this.thrU, this.thrB),
      pitch: Math.asin(Math.max(-1, Math.min(1, dot(vhat, up)))) / D2R,
      stage: this.stageIdx,
      lat: g.lat,
      lon: g.lon,
      vr,
    });
    if (this.hist.length > 6000) this.hist.splice(0, this.hist.length - 6000);
  }
}

const up = (r: V3) => norm(r);

// ———————————————————————————— flight dynamics: plan and predict ————————————————————————————

export type Prediction = {
  ok: boolean;
  kick: number;
  result: Flight["result"];
  why: string;
  events: { t: number; id: string; label: string }[];
  el: O.Elements | null;
  residual: number;
  residualFrac: number;
  qMax: number;
  qMaxT: number;
  shortfall: number;
  boosters: { label: string; outcome: BoosterPhase; dr: number; lz: string }[];
  hist: Sample[];
  maxG: number;
};

function runOnce(plan: FlightPlan, kick: number) {
  const f = new Flight({ ...plan, kick, failure: null }, { sample: 2 });
  const tMax = 30_000;
  while (f.t < tMax && f.result === "flying") {
    f.advance(5, 0.2);
    if (f.phase === "coast" || f.phase === "coast2") f.advance(Math.max(0, Math.min(f.burn2At, f.deployAt) - f.t), 0.2);
  }
  // let the boosters finish
  let guard = 0;
  while (f.recov.some((b) => !b.done) && guard++ < 400) f.advance(5, 0.2);
  return f;
}

/** Flight dynamics: find the pitch kick that delivers the most margin, then report the nominal profile */
export function predict(plan: FlightPlan): Prediction {
  const score = (f: Flight) => (f.result === "orbit" ? 1 + f.uProp / f.veh.stages[1].prop : -f.shortfall / 10000 - (f.result === "failed" && f.shortfall === 0 ? 1 : 0));
  let best: Flight | null = null;
  let bestK = 3;
  const kicks = [0.6, 1, 1.5, 2, 2.5, 3, 4, 5, 6.5, 8, 10];
  for (const k of kicks) {
    const f = runOnce(plan, k);
    if (!best || score(f) > score(best)) {
      best = f;
      bestK = k;
    }
  }
  for (const d of [-0.25, 0.25]) {
    const k = bestK + d;
    if (k <= 0.2) continue;
    const f = runOnce(plan, k);
    if (score(f) > score(best!)) {
      best = f;
      bestK = k;
    }
  }
  const f = best!;
  const el = f.payload ? O.elementsFromState(f.payload.r, f.payload.v, f.payload.jd) : null;
  return {
    ok: f.result === "orbit",
    kick: bestK,
    result: f.result,
    why: f.why,
    events: f.events.map((e) => ({ t: e.t, id: e.id, label: e.label })),
    el,
    residual: f.uProp,
    residualFrac: f.uProp / f.veh.stages[1].prop,
    qMax: f.qMax / 1000,
    qMaxT: f.qMaxT,
    shortfall: f.shortfall,
    boosters: f.recov.map((b) => ({ label: b.label, outcome: b.phase, dr: b.done ? b.landDr : f.downrange(b.r) / 1000, lz: b.lz })),
    hist: f.hist,
    maxG: Math.max(...f.hist.map((s) => s.a)),
  };
}

export { fmtT };
