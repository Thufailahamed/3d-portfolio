/**
 * Mission control: the clock, the countdown and its go/no-go polls, launch weather, the live flight,
 * and spacecraft operations afterwards (manoeuvres, orbit raising, drag decay, deep-space cruise,
 * docking). Pure logic; the room and the screens read `mc` every frame, the HTML reads the store.
 */

import { launchWindow, planetPos } from "@/rover/ephemeris";
import { RoomAudio } from "./audio";
import { CATALOG, COUNT_EVENTS, PAYLOADS, POSITIONS, STATIONS, payloadById, siteById, vehicleById, type PayloadKind, type PositionId, type Site, type Station, type VehicleId } from "./data";
import { Flight, chooseAzimuth, minInclination, predict, type FlightPlan, type Insertion } from "./flight";
import * as O from "./orbit";
import { WARPS, nextLine, useMC, zeroTele, type Burn, type Draft, type Sat, type VoiceLine } from "./store";

const G0 = 9.80665;
const D2R = Math.PI / 180;
const SOI = 925_000;

const hash = (s: string) => {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return (h >>> 0) / 4294967296;
};

// ———————————————————————————— launch weather ————————————————————————————

export type WeatherRule = { name: string; ok: boolean; value: string };
export type Weather = { temp: number; wind: number; gust: number; dir: number; shear: number; ceiling: number; vis: number; humidity: number; pressure: number; sea: number; cumulus: boolean; lightning: boolean; rules: WeatherRule[]; go: boolean; pov: number; recoveryGo: boolean };

export function weather(site: Site, jd: number, forceBad = false): Weather {
  const s = hash(site.id) * 100;
  const n = (p: number, k: number) => 0.5 + 0.5 * (0.6 * Math.sin((jd * Math.PI * 2) / p + s * k) + 0.4 * Math.sin((jd * Math.PI * 2) / (p * 0.37) + s * k * 1.7));
  const hour = ((((jd + 0.5) % 1) * 24 + site.lon / 15) % 24 + 24) % 24;
  const c = site.climate;
  const temp = c.temp + 5 * Math.sin(((hour - 9) / 24) * Math.PI * 2) + (n(5.3, 9) - 0.5) * 4;
  const wind = c.wind * (0.45 + 0.9 * n(1.3, 1));
  const gust = wind * (1.25 + 0.25 * n(0.4, 7));
  const shear = 30 + 80 * n(2.1, 2) ** 2;
  const cumulus = forceBad || n(0.7, 3) > 1 - c.storm * 0.85;
  const lightning = n(0.53, 4) > 1 - c.storm * 0.4;
  const ceiling = Math.round((2500 + 22000 * n(0.9, 5)) / 100) * 100;
  const vis = 3 + 7 * n(1.1, 6);
  const sea = 0.6 + 2.8 * n(1.7, 8) ** 1.6;
  const rules: WeatherRule[] = [
    { name: "Ground winds (peak)", ok: gust < 30, value: `${gust.toFixed(0)} kt` },
    { name: "Upper-level wind shear", ok: shear < 100, value: `${shear.toFixed(0)} %` },
    { name: "Cumulus clouds ≤ 10 nm", ok: !cumulus, value: cumulus ? "PRESENT" : "none" },
    { name: "Lightning ≤ 10 nm, 30 min", ok: !lightning, value: lightning ? "DETECTED" : "none" },
    { name: "Thick cloud layers", ok: ceiling > 4000 || !cumulus, value: `${ceiling.toLocaleString("en-US")} ft` },
  ];
  const go = rules.every((r) => r.ok);
  const margin = Math.min(1, Math.max(0, gust / 30), shear / 100, cumulus ? 1 : n(0.7, 3) / (1 - c.storm * 0.85 + 1e-3), lightning ? 1 : 0.5 * n(0.53, 4));
  return {
    temp, wind, gust, dir: (n(3.1, 11) * 360) | 0, shear, ceiling, vis, humidity: 50 + 45 * n(0.8, 12), pressure: 1008 + 14 * n(4.2, 13), sea, cumulus, lightning, rules, go,
    pov: go ? Math.round(Math.max(5, margin * 40) / 5) * 5 : Math.min(95, Math.round((60 + margin * 30) / 5) * 5),
    recoveryGo: sea < 2.8,
  };
}

// ———————————————————————————— planning ————————————————————————————

export function marsC3(jd: number) {
  const win = launchWindow("earth", "mars", jd - 25);
  const off = jd - win.launch;
  return { win, off, c3: 8.7 + (off / 11) ** 2, open: Math.abs(off) <= 21 };
}

export function resolveInclination(d: Draft, site: Site) {
  const p = payloadById[d.payload];
  const t = p.target;
  if (t.kind === "orbit") {
    if (d.payload === "custom") return d.inc;
    if (t.inc === "sso") return Math.round(O.ssoInclination(d.hp) * 100) / 100;
    if (t.inc === "site") return minInclination(site);
    return t.inc;
  }
  return Math.max(minInclination(site), d.payload === "custom" ? d.inc : 0);
}

export function buildPlan(d: Draft, jd: number): { plan: FlightPlan | null; error: string; note: string; dest?: string; c3?: number; arrive?: number } {
  const veh = vehicleById[d.vehicle];
  const site = siteById[d.site];
  const p = payloadById[d.payload];
  if (!veh.pads.includes(site.id)) return { plan: null, error: `${veh.name} does not fly from ${site.short}.`, note: "" };
  if (p.crew && !veh.crewRated) return { plan: null, error: `${veh.name} is not rated to carry crew.`, note: "" };
  const t = p.target;
  const inc = resolveInclination(d, site);
  let ins: Insertion;
  let note = "";
  let dest: string | undefined;
  let c3: number | undefined;
  let arrive: number | undefined;
  if (t.kind === "orbit") {
    const hp = Math.min(d.hp, d.ha);
    const ha = Math.max(d.hp, d.ha);
    ins = hp <= 330 ? { hp1: hp, ha1: ha, inc } : { hp1: 200, ha1: ha, inc, burn2: { kind: "circ", hp }, coast: "apo" };
    if (hp > 330) note = `Two-burn ascent: 200 × ${ha.toLocaleString("en-US")} km transfer, then a circularisation burn at apogee.`;
  } else if (t.kind === "gto") {
    ins = { hp1: 200, ha1: 200, inc, burn2: { kind: "gto", ha: 35_786 }, coast: "node" };
    note = "Parking orbit, coast to the equator crossing, then the GTO burn. The satellite finishes the climb to GEO itself.";
  } else {
    dest = t.dest;
    let label = "Earth departure burn";
    if (t.c3 === "mars") {
      const m = marsC3(jd);
      if (!m.open) {
        const opens = m.win.launch - 21;
        return { plan: null, error: `Mars is out of reach today: the next window opens ${O.dateOf(opens).toUTCString().slice(5, 16)}.`, note: "window", dest, arrive: m.win.arrive };
      }
      c3 = Math.round(m.c3 * 10) / 10;
      arrive = m.win.arrive + m.off * 0.4;
      label = "trans-Mars injection";
      note = `Mars window open (optimum ${O.dateOf(m.win.launch).toUTCString().slice(5, 16)}). C3 ${c3} km²/s², arrival ${O.dateOf(arrive).toUTCString().slice(5, 16)}.`;
    } else {
      c3 = t.c3;
      label = t.dest === "moon" ? "trans-lunar injection" : t.dest === "l2" ? "L2 transfer burn" : "Earth departure burn";
      note = t.dest === "jupiter" ? "C3 12 km²/s² with a Mars–Earth gravity assist (MEGA) trajectory." : t.dest === "moon" ? "Parking orbit, then trans-lunar injection at perigee." : "Departure toward the Sun–Earth L2 point, 1.5 million km away.";
    }
    ins = { hp1: 185, ha1: veh.id === "sls" ? 1_800 : 185, inc, burn2: { kind: "escape", c3, label }, coast: "time", coastTime: 1_150 };
  }
  if (!chooseAzimuth(site, inc)) return { plan: null, error: `Range safety: ${inc.toFixed(1)}° is outside the ${site.range} corridor from ${site.short} (${minInclination(site)}° minimum).`, note: "" };
  if (t.kind === "orbit" && Math.min(d.hp, d.ha) < 160) return { plan: null, error: "Perigee below 160 km: the orbit would decay within hours.", note: "" };
  const recovery = veh.recovery.includes(d.recovery) ? d.recovery : veh.recovery[0];
  return {
    plan: { vehicle: d.vehicle, payloadMass: d.mass, site: d.site, recovery, ins, crewed: !!p.crew, deployDelay: p.deployDelay, jd0: jd },
    error: "",
    note,
    dest,
    c3,
    arrive,
  };
}

/** sensible defaults when the payload or vehicle changes */
export function draftFor(payload: PayloadKind, prev?: Draft): Draft {
  const p = payloadById[payload];
  const vehicle: VehicleId = prev && p.prefer.includes(prev.vehicle) ? prev.vehicle : p.prefer[0];
  const veh = vehicleById[vehicle];
  let site = veh.pads[0];
  const t = p.target;
  if (t.kind === "orbit" && (t.inc === "sso" || (typeof t.inc === "number" && t.inc > 62))) site = veh.pads.find((s) => siteById[s].az[0] > 120) ?? veh.pads.find((s) => s === "mahia") ?? site;
  const hp = t.kind === "orbit" ? t.hp : 200;
  const ha = t.kind === "orbit" ? t.ha : 200;
  const inc = t.kind === "orbit" && typeof t.inc === "number" ? t.inc : 28.6;
  return { payload, vehicle, site, recovery: veh.recovery[0], mass: p.mass, hp, ha, inc, name: "" };
}

// ———————————————————————————— the catalogue ————————————————————————————

const KIND_COLOR: Record<string, string> = {
  station: "#ffd166", science: "#c39bff", nav: "#4fd1ff", geo: "#ff9f5a", eo: "#7ee08a", relay: "#9fb4ff", constellation: "#7d8fa8", deep: "#ff6fb1",
  starlink: "#c8ff3d", gps: "#4fd1ff", weather: "#ff9f5a", crew: "#ffd166", cargo: "#ffd166", l2: "#c39bff", lunar: "#e0e0e0", artemis: "#ffd166", marsrover: "#ff7a45", marsorbiter: "#ff7a45", outer: "#ffb86b", rideshare: "#c8ff3d", custom: "#c8ff3d",
};

function catalogSats(jd: number): Sat[] {
  const out: Sat[] = [];
  for (const c of CATALOG) {
    const h = hash(c.id);
    let el: O.Elements | null = null;
    if (c.kind !== "deep") {
      const a = O.RE + (c.hp + c.ha) / 2;
      const e = (c.ha - c.hp) / (2 * a);
      if (c.geoLon !== undefined) el = { a, e, i: c.inc * D2R, raan: (h * 40) * D2R, argp: 0, M0: c.geoLon * D2R + O.gmst(jd) - h * 40 * D2R, epoch: jd };
      else el = { a, e, i: c.inc * D2R, raan: h * Math.PI * 2, argp: hash(c.id + "w") * Math.PI * 2, M0: hash(c.id + "m") * Math.PI * 2, epoch: jd };
    }
    out.push({
      id: "cat-" + c.id, name: c.name, kind: c.kind, owner: "catalog", el, status: c.kind === "deep" ? "deep" : "active", mass: c.mass, dry: c.mass * 0.85, isp: 300, power: 4000,
      agency: c.agency, launched: c.launched, where: c.deep?.where, deep: c.deep, burns: [], color: KIND_COLOR[c.kind] ?? "#9fb4ff",
    });
  }
  // a sample of the 53° Starlink shell
  for (let p = 0; p < 8; p++) {
    for (let k = 0; k < 6; k++) {
      out.push({
        id: `cat-sl-${p}-${k}`, name: `STARLINK-${3000 + p * 6 + k}`, kind: "constellation", owner: "catalog",
        el: { a: O.RE + 550, e: 0.0001, i: 53 * D2R, raan: (p / 8) * Math.PI * 2, argp: 0, M0: (k / 6) * Math.PI * 2 + p * 0.4, epoch: jd },
        status: "active", mass: 800, dry: 700, isp: 1500, power: 9000, agency: "SpaceX", launched: 2023, burns: [], color: KIND_COLOR.constellation,
      });
    }
  }
  return out;
}

// ———————————————————————————— deep-space geometry ————————————————————————————

const EPS = 23.439 * D2R;
/** rover ephemeris (three.js ecliptic axes, AU) → equatorial ECI unit-free vector */
function eclToEq(p: { x: number; y: number; z: number }): O.V3 {
  const xe = p.x, ye = -p.z, ze = p.y;
  return O.v3(xe, ye * Math.cos(EPS) - ze * Math.sin(EPS), ye * Math.sin(EPS) + ze * Math.cos(EPS));
}
const AU = 149_597_870.7;

/** geocentric position (km) of a deep-space object */
export function deepPos(s: Sat, jd: number): O.V3 | null {
  const earth = planetPos("earth", jd);
  if (s.status === "cruise" && s.dest && s.departJd && s.arriveJd) {
    const a2 = s.dest === "mars" ? 1.524 : s.dest === "jupiter" ? 5.2 : 1;
    const f = Math.min(1, Math.max(0, (jd - s.departJd) / (s.arriveJd - s.departJd)));
    const e0 = planetPos("earth", s.departJd);
    const th0 = Math.atan2(-e0.z, e0.x);
    const a = (1 + a2) / 2;
    const e = (a2 - 1) / (a2 + 1);
    const nu = Math.PI * f;
    const r = (a * (1 - e * e)) / (1 + e * Math.cos(nu));
    const p = { x: r * Math.cos(th0 + nu), y: 0, z: -r * Math.sin(th0 + nu) };
    return O.mul(eclToEq({ x: p.x - earth.x, y: p.y - earth.y, z: p.z - earth.z }), AU);
  }
  const target = s.status === "arrived" || s.status === "deep" || s.status === "lunar" || s.status === "l2" ? s.deep?.planet ?? s.dest : undefined;
  if (target === "moon") return O.moonPos(jd);
  if (target === "l2" || (s.deep && s.deep.au && s.deep.au < 0.02)) return O.mul(O.sunDir(jd), -1.5e6);
  if (target && target !== "moon") {
    const p = planetPos(target, jd);
    return O.mul(eclToEq({ x: p.x - earth.x, y: p.y - earth.y, z: p.z - earth.z }), AU);
  }
  if (s.deep?.ra !== undefined && s.deep.dec !== undefined) return O.mul(O.raDec(s.deep.ra, s.deep.dec), (s.deep.au ?? 100) * AU);
  return null;
}

export type SatNow = { r: O.V3; v: O.V3 | null; geo: O.Geo | null; dist: number; eclipse: boolean };
export function satNow(s: Sat, jd: number): SatNow | null {
  if (s.status === "reentered") return null;
  if (s.el && s.status !== "cruise" && s.status !== "arrived" && s.status !== "lunar" && s.status !== "l2" && s.status !== "deep") {
    const st = O.stateAt(s.el, jd);
    const d = O.len(st.r);
    return { r: st.r, v: st.v, geo: d < 60_000 ? O.eciToGeo(st.r, jd) : null, dist: d, eclipse: O.inEclipse(st.r, jd) };
  }
  const r = deepPos(s, jd);
  if (!r) return null;
  return { r, v: null, geo: null, dist: O.len(r), eclipse: false };
}

// ———————————————————————————— ground network ————————————————————————————

export type Link = { station: Station; sat: Sat; elev: number; range: number; rate: number; rtlt: number; band: string };
export function network(jd: number, fleet: Sat[]): Link[] {
  const out: Link[] = [];
  for (const s of fleet) {
    const now = satNow(s, jd);
    if (!now) continue;
    const deep = now.dist > 60_000;
    for (const st of STATIONS) {
      if (deep !== (st.net === "DSN")) continue;
      const el = O.elevation(now.r, st.lat * D2R, st.lon * D2R, jd);
      if (el < 10 * D2R) continue;
      const range = deep ? now.dist : O.len(O.sub(now.r, O.geoToEci(st.lat * D2R, st.lon * D2R, 0, jd)));
      const rate = deep ? Math.min(6e6, 3e17 / (range * range)) : 2e8 / Math.max(1, (range / 1000) ** 2);
      out.push({ station: st, sat: s, elev: el / D2R, range, rate, rtlt: (2 * range) / 299_792.458, band: deep ? (range > 3e8 ? "X-band" : "Ka-band") : "S-band" });
    }
  }
  return out;
}

// ———————————————————————————— manoeuvres ————————————————————————————

function rodrigues(v: O.V3, k: O.V3, a: number): O.V3 {
  const c = Math.cos(a), s = Math.sin(a);
  return O.add(O.add(O.mul(v, c), O.mul(O.cross(k, v), s)), O.mul(k, O.dot(k, v) * (1 - c)));
}

/** new velocity after a burn of this kind at this state (km/s) */
export function burnVelocity(r: O.V3, v: O.V3, kind: Burn["kind"], target = 0): O.V3 {
  const r0 = O.len(r);
  const up = O.mul(r, 1 / r0);
  const vh = O.sub(v, O.mul(up, O.dot(v, up)));
  const hdir = O.norm(vh);
  if (kind === "circ") return O.mul(hdir, Math.sqrt(O.MU / r0));
  if (kind === "geo") {
    let east = O.norm(O.cross(O.v3(0, 0, 1), up));
    if (O.dot(east, hdir) < 0) east = O.mul(east, -1);
    return O.mul(east, Math.sqrt(O.MU / r0));
  }
  if (kind === "apo" || kind === "peri" || kind === "deorbit" || kind === "raise") {
    const other = O.RE + (kind === "deorbit" ? 40 : target);
    const a = (r0 + other) / 2;
    const vm = Math.sqrt(Math.max(0, O.MU * (2 / r0 - 1 / a)));
    return O.mul(hdir, vm);
  }
  if (kind === "plane") return rodrigues(v, up, target * D2R);
  return O.add(v, O.mul(O.norm(v), 0.0004));
}

export function burnTime(el: O.Elements, jd: number, kind: Burn["kind"]) {
  const circ = el.e < 0.002;
  let dt = 600;
  if (kind === "apo" || kind === "raise") dt = circ ? 600 : O.timeToAnomaly(el, jd, "peri");
  else if (kind === "peri" || kind === "deorbit" || kind === "geo") dt = circ ? 600 : O.timeToAnomaly(el, jd, "apo");
  else if (kind === "plane") dt = O.timeToNode(el, jd);
  else if (kind === "circ") dt = circ ? 600 : O.timeToAnomaly(el, jd, "apo");
  return jd + Math.max(120, dt) / 86400;
}

export const dvBudget = (s: Sat) => ((s.isp * G0) / 1000) * Math.log(s.mass / Math.max(1, s.dry));

// ———————————————————————————— the controller ————————————————————————————

type Pending = { draft: Draft; plan: FlightPlan; name: string; dest?: string; arrive?: number; kick: number };
type PollStep = { who: PositionId; label: string; ask: boolean; t: number };

export type SimFailure = "engine" | "guidance" | "comm" | "weather";

class MissionControl {
  audio = new RoomAudio();
  jd = O.jdOf(Date.now());
  flight: Flight | null = null;
  pending: Pending | null = null;
  /** the room listens to this for the launch camera */
  liftoffJd = 0;
  losUntil = 0;
  badWeather = false;
  guidanceFail = false;
  private poll: PollStep[] = [];
  private pollAt = 0;
  private uiAt = 0;
  private saveAt = 0;
  private replanTimer: ReturnType<typeof setTimeout> | null = null;
  private fired = new Set<number>();
  private decayAt = 0;
  private finishedAt = 0;
  private started = false;

  init() {
    if (this.started) return;
    this.started = true;
    const s = useMC.getState();
    const now = O.jdOf(Date.now());
    this.jd = s.jd && Math.abs(s.jd - now) < 365 * 40 ? Math.max(s.jd, now - 1) : now;
    const ours = s.fleet.filter((f) => f.owner === "ours");
    s.set({ fleet: [...catalogSats(this.jd), ...ours], jd: this.jd, ops: { ...s.ops, phase: "idle", holding: false, pollState: "none", poll: [] }, tele: null, timeline: [] });
    this.audio.setMuted(!s.sound);
    this.audio.setVoice(s.voice);
    this.replan();
    this.say("FLIGHT", "Flight: good morning, everyone. All positions, this is Flight on the loop. We are in planning.", "info", false);
  }

  unlock() {
    this.audio.unlock();
  }

  get fleet() {
    return useMC.getState().fleet;
  }
  get site() {
    const d = this.pending?.draft ?? useMC.getState().draft;
    return siteById[d.site];
  }

  say(who: VoiceLine["who"], text: string, tone: VoiceLine["tone"] = "info", speak = true) {
    const s = useMC.getState();
    const met = this.flight ? this.flight.t : null;
    // the transcript already shows who is talking; the voice still says it
    const shown = text.replace(/^(?:[A-Z][A-Za-z]+(?: [A-Z][A-Za-z]+)?):\s+/, "");
    const line: VoiceLine = { id: nextLine(), jd: this.jd, met, who, text: shown, tone };
    s.set({ loop: [...s.loop.slice(-119), line] });
    if (speak && s.voice) this.audio.say(text, String(who), who === "CAPCOM" || who === "FLIGHT");
    if (tone === "bad") this.audio.alarm();
    else if (tone === "good") this.audio.good();
    else this.audio.chirp();
  }

  // —— planning ——
  setDraft(d: Partial<Draft>) {
    const s = useMC.getState();
    let next = { ...s.draft, ...d };
    if (d.payload && d.payload !== s.draft.payload) next = { ...draftFor(d.payload, s.draft), name: s.draft.name };
    if (d.vehicle && d.vehicle !== s.draft.vehicle) {
      const veh = vehicleById[d.vehicle];
      if (!veh.pads.includes(next.site)) next.site = veh.pads[0];
      if (!veh.recovery.includes(next.recovery)) next.recovery = veh.recovery[0];
    }
    if (d.hp !== undefined || d.payload) {
      const p = payloadById[next.payload];
      if (p.target.kind === "orbit" && p.target.inc === "sso") next.inc = O.ssoInclination(next.hp);
    }
    s.set({ draft: next });
    this.replan();
  }

  replan() {
    if (this.replanTimer) clearTimeout(this.replanTimer);
    const s = useMC.getState();
    s.set({ predicting: true });
    this.replanTimer = setTimeout(() => {
      const st = useMC.getState();
      const b = buildPlan(st.draft, this.jd);
      if (!b.plan) {
        st.set({ prediction: null, predicting: false, planError: b.error, planNote: b.note });
        return;
      }
      const pr = predict(b.plan);
      st.set({ prediction: pr, predicting: false, planError: "", planNote: b.note });
    }, 60);
  }

  warpToWindow() {
    const m = marsC3(this.jd);
    const target = Math.max(this.jd, m.win.launch - 1);
    this.jd = target;
    useMC.getState().set({ jd: target });
    this.say("FIDO", `FIDO: clock advanced to the Mars window. Optimum departure ${O.dateOf(m.win.launch).toUTCString().slice(5, 16)}.`, "info");
    this.replan();
  }

  // —— the count ——
  startCount() {
    const s = useMC.getState();
    if (s.ops.phase !== "idle") return;
    const b = buildPlan(s.draft, this.jd);
    if (!b.plan) return;
    const kick = s.prediction?.kick ?? 3;
    const p = payloadById[s.draft.payload];
    const veh = vehicleById[s.draft.vehicle];
    const name = s.draft.name.trim() || `ODY-${s.counter} · ${p.short}`;
    this.pending = { draft: { ...s.draft }, plan: b.plan, name, dest: b.dest, arrive: b.arrive, kick };
    this.fired.clear();
    this.badWeather = false;
    this.guidanceFail = false;
    const timeline = (s.prediction?.events ?? [])
      .filter((e) => /^(liftoff|maxq|beco|meco|stagesep|ses1|fairing|seco1|ses2|seco2|deploy|park|landed:.*|landing:.*|entry:.*|boostback:.*)$/.test(e.id) && !/Side booster B/.test(e.id))
      .map((e) => ({ id: e.id, label: e.label.replace(/^(First stage|Center core|Super Heavy|Side booster A): /, ""), t: e.t, done: false }));
    s.set({
      ops: { phase: "count", tMinus: 45 * 60, holding: false, hold: "", pollState: "none", poll: [], mission: name, result: "" },
      tab: "launch",
      timeline,
      warp: Math.min(s.warp, 4),
      counter: s.counter + 1,
      feedCam: "auto",
    });
    this.say("LD", `Launch Director: all stations, this is the Launch Director. We are picking up the count for ${name} on ${veh.name} from ${siteById[s.draft.site].name}. T minus 45 minutes and counting.`, "info");
  }

  holdCount(reason = "Hold called by the Launch Director") {
    const s = useMC.getState();
    if (s.ops.phase !== "count" || s.ops.holding) return;
    s.set({ ops: { ...s.ops, holding: true, hold: reason } });
    this.say("LD", `Hold, hold, hold. ${reason}.`, "warn");
  }
  resume() {
    const s = useMC.getState();
    if (s.ops.phase !== "count" || !s.ops.holding) return;
    if (s.ops.pollState === "due" || s.ops.pollState === "nogo") return;
    s.set({ ops: { ...s.ops, holding: false, hold: "" } });
    this.say("LD", "Resuming the count.", "info");
  }
  recycle() {
    const s = useMC.getState();
    if (s.ops.phase !== "count") return;
    const t = Math.max(s.ops.tMinus, 600);
    for (const k of [...this.fired]) if (k <= t) this.fired.delete(k);
    s.set({ ops: { ...s.ops, tMinus: t, holding: true, hold: "Recycled to T-10:00 — awaiting resume" } });
    this.say("LD", "We are recycling to T minus ten minutes. Stand by.", "warn");
  }
  scrub(why = "Scrubbed by the Launch Director") {
    const s = useMC.getState();
    if (s.ops.phase !== "count" || !this.pending) return;
    const pd = this.pending;
    this.record("scrub", why);
    this.pending = null;
    s.set({ ops: { ...s.ops, phase: "idle", holding: false, hold: "", pollState: "none", poll: [] }, timeline: [], tab: "plan" });
    this.say("LD", `We are scrubbing today's attempt of ${pd.name}. ${why}. We will turn around for the next opportunity.`, "warn");
  }
  skipTo(t: number) {
    const s = useMC.getState();
    if (s.ops.phase !== "count" || s.ops.holding || s.ops.tMinus <= t) return;
    if (s.ops.tMinus > 2280 && t < 2280) t = 2281;
    this.jd += (s.ops.tMinus - t) / 86400;
    for (const e of COUNT_EVENTS) if (e.t > t && !e.tag) this.fired.add(e.t);
    s.set({ ops: { ...s.ops, tMinus: t } });
  }

  conductPoll() {
    const s = useMC.getState();
    if (s.ops.phase !== "count" || (s.ops.pollState !== "due" && s.ops.pollState !== "nogo")) return;
    const list = POSITIONS.filter((p) => p.poll && p.id !== "FLIGHT").map((p) => ({ who: p.id, label: p.poll, answer: "" as const }));
    list.push({ who: "FLIGHT", label: "Flight", answer: "" });
    this.poll = [];
    let t = 0;
    this.poll.push({ who: "LD", label: "", ask: true, t: (t += 0.2) });
    for (const p of list) {
      this.poll.push({ who: p.who, label: p.label, ask: true, t: (t += 1.0) });
      this.poll.push({ who: p.who, label: p.label, ask: false, t: (t += 0.9) });
    }
    this.pollAt = performance.now();
    s.set({ ops: { ...s.ops, pollState: "running", poll: list } });
    this.say("LD", "All stations, stand by for the go, no-go poll for propellant load.", "info");
  }

  private pollAnswer(who: PositionId): { go: boolean; note?: string } {
    const w = weather(this.site, this.jd, this.badWeather);
    const pr = useMC.getState().prediction;
    const veh = this.pending ? vehicleById[this.pending.draft.vehicle] : null;
    if (who === "WEATHER" && !w.go) return { go: false, note: w.rules.find((r) => !r.ok)?.name };
    if (who === "RECOVERY" && veh && this.pending?.plan.recovery === "asds" && !w.recoveryGo) return { go: false, note: `sea state ${w.sea.toFixed(1)} m at the drone ship` };
    if (who === "FIDO" && pr && !pr.ok) return { go: false, note: "the trajectory does not close with this payload" };
    return { go: true };
  }

  private stepPoll(dtReal: number) {
    if (!this.poll.length) return;
    const el = (performance.now() - this.pollAt) / 1000;
    void dtReal;
    const s = useMC.getState();
    while (this.poll.length && this.poll[0].t <= el) {
      const step = this.poll.shift()!;
      if (step.who === "LD") continue;
      if (step.ask) this.say("LD", `${step.label}?`, "info");
      else {
        const a = this.pollAnswer(step.who);
        const ops = useMC.getState().ops;
        const poll = ops.poll.map((p) => (p.who === step.who ? { ...p, answer: a.go ? ("go" as const) : ("nogo" as const), note: a.note } : p));
        useMC.getState().set({ ops: { ...ops, poll } });
        this.say(step.who, a.go ? `${step.label} is go.` : `${step.label} is no-go. ${a.note ?? ""}.`, a.go ? "info" : "warn");
      }
    }
    if (!this.poll.length) {
      const ops = useMC.getState().ops;
      const nogo = ops.poll.filter((p) => p.answer === "nogo");
      if (nogo.length) {
        s.set({ ops: { ...ops, pollState: "nogo", hold: `No-go from ${nogo.map((p) => p.label).join(", ")}` } });
        this.say("LD", `We have a no-go from ${nogo.map((p) => p.label).join(" and ")}. We will remain in the hold and reassess.`, "warn");
      } else {
        s.set({ ops: { ...ops, pollState: "go", holding: false, hold: "" } });
        this.say("LD", "Launch Director copies all go. We are go for propellant load. Resuming the count.", "good");
      }
    }
  }

  private stepCount(dtSim: number) {
    const s = useMC.getState();
    const ops = s.ops;
    if (ops.phase !== "count" || !this.pending) return;
    if (ops.holding) return;
    let t = ops.tMinus - dtSim;
    // built-in hold for the propellant-load poll
    if (ops.tMinus > 2280 && t <= 2280 && ops.pollState !== "go") {
      t = 2280;
      s.set({ ops: { ...ops, tMinus: t, holding: true, hold: "Built-in hold: go/no-go poll for propellant load", pollState: "due" } });
      this.say("LD", "We are in the planned built-in hold at T minus 38 minutes. Stand by for the poll.", "info");
      return;
    }
    for (const e of COUNT_EVENTS) {
      if (this.fired.has(e.t)) continue;
      if (t <= e.t) {
        this.fired.add(e.t);
        const veh = vehicleById[this.pending.draft.vehicle];
        let text = e.text;
        if (e.t === 2100 && veh.id !== "falcon9" && veh.id !== "falconheavy") text = veh.stages[0].engine.includes("RS-25") || veh.kit === "ariane" ? "Propulsion: core stage liquid hydrogen and oxygen loading is under way." : veh.kit === "starship" ? "Propulsion: methane and oxygen load is under way on booster and ship." : text;
        if (e.t === 300 && veh.kit !== "f9" && veh.kit !== "fh") text = "Ground: crew access and umbilical arms retracted.";
        if (e.t === 120) {
          const w = weather(this.site, this.jd, this.badWeather);
          if (!w.go) {
            const r = w.rules.find((x) => !x.ok)!;
            s.set({ ops: { ...ops, tMinus: e.t, holding: true, hold: `Weather violation: ${r.name}` } });
            this.say("WEATHER", `Hold, hold, hold. Weather is red: ${r.name}, ${r.value}.`, "warn");
            return;
          }
        }
        this.say(e.who, text, e.t <= 10 ? "info" : "info", true);
        if (e.t <= 10) this.audio.beep();
      }
    }
    if (t <= 0) {
      this.launch();
      return;
    }
    s.set({ ops: { ...ops, tMinus: t } });
  }

  private launch() {
    const s = useMC.getState();
    const pd = this.pending!;
    const plan: FlightPlan = { ...pd.plan, jd0: this.jd, kick: pd.kick, failure: null };
    this.flight = new Flight(plan);
    this.liftoffJd = this.jd;
    this.finishedAt = 0;
    s.set({ ops: { ...s.ops, phase: "flight", tMinus: 0, holding: false }, warp: Math.min(s.warp, 3) });
  }

  // —— in flight ——
  abort() {
    const f = this.flight;
    if (!f || f.result !== "flying") return;
    this.say("FLIGHT", f.plan.crewed ? "Abort! Abort! Abort!" : "Range, Flight: terminate. Send the destruct.", "bad");
    f.abort();
  }

  inject(kind: SimFailure) {
    const s = useMC.getState();
    if (kind === "weather") {
      this.badWeather = !this.badWeather;
      this.say("SIM", this.badWeather ? "SimSup: injecting a weather case — cumulus build-up over the range." : "SimSup: weather case cleared.", "warn", false);
      return;
    }
    const f = this.flight;
    if (!f || f.result !== "flying") return;
    if (kind === "engine") {
      f.plan.failure = { kind: "engine", t: f.t + 0.5 };
      this.say("SIM", "SimSup: injecting an engine failure.", "warn", false);
    } else if (kind === "guidance") {
      this.guidanceFail = true;
      this.say("SIM", "SimSup: injecting an inertial measurement unit failure.", "warn", false);
    } else if (kind === "comm") {
      this.losUntil = performance.now() + 14_000;
      this.say("SIM", "SimSup: injecting a telemetry dropout.", "warn", false);
      setTimeout(() => this.say("INCO", "Flight, INCO: we have loss of signal. Working it.", "warn"), 600);
      setTimeout(() => this.say("INCO", "Flight, INCO: acquisition of signal. Data is good.", "good"), 14_200);
    }
    s.set({});
  }

  private stepFlight(dtSim: number) {
    const f = this.flight;
    if (!f) return;
    if (this.guidanceFail && f.result === "flying") {
      // the platform drifts: thrust walks off the trajectory
      f.yawErr = Math.min(0.6, f.yawErr + dtSim * 0.02);
      if (f.yawErr > 0.25) {
        this.guidanceFail = false;
        if (f.plan.crewed) this.abort();
        else {
          this.say("RANGE", "Range Safety: the vehicle has crossed the destruct line. Sending the destruct command.", "bad");
          f.abort();
        }
      }
    }
    f.advance(dtSim, 0.05);
    for (const ev of f.fresh) {
      const tone = ev.tone === "bad" ? "bad" : ev.tone === "warn" ? "warn" : ev.tone === "good" ? "good" : "info";
      this.say(ev.who, ev.say ?? ev.label, tone, !!ev.say);
      const tl = useMC.getState().timeline;
      if (tl.some((x) => x.id === ev.id && !x.done)) useMC.getState().set({ timeline: tl.map((x) => (x.id === ev.id ? { ...x, done: true, t: ev.t } : x)) });
      if (ev.id === "deploy") this.deployed();
    }
    f.fresh.length = 0;
    // done?
    const recovering = f.recov.some((b) => !b.done) || (f.capsule && !f.capsule.done);
    if (f.result !== "flying" && !recovering && !this.finishedAt) {
      this.finishedAt = performance.now();
      this.finish();
    }
  }

  private deployed() {
    const f = this.flight!;
    const pd = this.pending!;
    const p = payloadById[pd.draft.payload];
    const pay = f.payload!;
    const el = O.elementsFromState(pay.r, pay.v, pay.jd);
    const id = `sat-${Date.now().toString(36)}`;
    let status: Sat["status"] = "active";
    let arriveJd: number | undefined;
    let raiseTo: number | undefined;
    const dest = pd.dest as Sat["dest"];
    if (p.id === "starlink") {
      status = "raising";
      raiseTo = 550;
    } else if (p.id === "geo" || p.id === "weather") status = "transfer";
    else if (p.id === "crew" || p.id === "cargo") {
      status = "transfer";
      arriveJd = this.jd + 0.95;
    } else if (dest) {
      status = "departing";
      arriveJd = dest === "moon" ? this.jd + Math.min(6, O.timeToAnomaly(el, this.jd, "apo") / 86400) : dest === "l2" ? this.jd + 29 : dest === "mars" ? pd.arrive ?? this.jd + 210 : this.jd + 5.5 * 365.25;
    }
    const sat: Sat = {
      id, name: pd.name.replace(/^ODY-\d+ · /, "") + ` (${pd.name.split(" · ")[0]})`, kind: p.id, owner: "ours", el, status, mass: pd.draft.mass, dry: pd.draft.mass * (1 - p.propFrac), isp: p.isp, power: p.power, crew: p.crew,
      agency: "Odyssey Mission Control", launched: O.dateOf(this.jd).getUTCFullYear(), vehicle: pd.draft.vehicle, site: pd.draft.site, missionId: pd.name, dest, departJd: this.jd, arriveJd, raiseTo, burns: [], color: KIND_COLOR[p.id] ?? "#c8ff3d",
      where: dest === "mars" ? "Trans-Mars cruise" : dest === "moon" ? "Translunar coast" : dest === "l2" ? "Cruise to L2" : dest === "jupiter" ? "Outer cruise" : undefined,
    };
    const s = useMC.getState();
    s.set({ fleet: [...s.fleet, sat], selected: id });
    if (status === "transfer" && (p.id === "geo" || p.id === "weather")) setTimeout(() => this.say("PAYLOADS", "Payloads: spacecraft is healthy in GTO. Solar arrays deployed. Ready for apogee raising on your command.", "good"), 4000);
  }

  private finish() {
    const f = this.flight!;
    const pd = this.pending!;
    const res = f.result === "orbit" ? (f.events.some((e) => e.id === "depl") ? "partial" : "success") : f.result === "aborted" ? "abort" : "failure";
    const landed = f.recov.filter((b) => b.phase === "landed").length;
    const lost = f.recov.filter((b) => b.phase === "lost").length;
    const rec = f.recov.filter((b) => b.mode !== "expend");
    const recTxt = rec.length ? (lost ? `${landed}/${rec.length} boosters recovered` : `${landed} booster${landed > 1 ? "s" : ""} recovered`) : "Expendable";
    const summary = res === "success" ? "Nominal flight, payload delivered." : res === "partial" ? "Off-nominal orbit — payload delivered low." : res === "abort" ? "Crew abort — capsule recovered." : f.why;
    this.record(res, summary, recTxt);
    const s = useMC.getState();
    s.set({ ops: { ...s.ops, phase: "post", result: res } });
    if (res === "success") this.say("FLIGHT", `Flight: congratulations, team. ${pd.name} is a success.`, "good");
    else if (res === "abort") this.say("FLIGHT", "Flight: the crew is safe. Lock your consoles, preserve your data. We will begin the investigation.", "warn");
    else if (res === "failure") this.say("FLIGHT", "Flight: all controllers, lock your consoles and preserve your data. Contingency procedures are in effect.", "bad");
  }

  private record(result: "success" | "partial" | "failure" | "scrub" | "abort", summary: string, recovery = "") {
    const pd = this.pending;
    if (!pd) return;
    const s = useMC.getState();
    const sat = s.fleet.find((x) => x.missionId === pd.name);
    s.set({
      history: [
        { id: `m-${Date.now().toString(36)}`, name: pd.name, vehicle: pd.draft.vehicle, payload: pd.draft.payload, site: pd.draft.site, jd: this.jd, result, summary, recovery, satId: sat?.id, color: KIND_COLOR[pd.draft.payload] ?? "#c8ff3d" },
        ...s.history,
      ].slice(0, 60),
    });
  }

  closeMission() {
    const s = useMC.getState();
    if (s.ops.phase !== "post") return;
    this.flight = null;
    this.pending = null;
    s.set({ ops: { ...s.ops, phase: "idle", result: "", holding: false, pollState: "none", poll: [] }, tele: null, timeline: [], tab: "fleet" });
    this.replan();
  }

  // —— spacecraft operations ——
  planBurn(satId: string, kind: Burn["kind"], target = 0, label?: string) {
    const s = useMC.getState();
    const sat = s.fleet.find((x) => x.id === satId);
    if (!sat || !sat.el || sat.el.e >= 1) return;
    const lastAt = sat.burns.length ? sat.burns[sat.burns.length - 1].at : this.jd;
    const base = lastAt > this.jd ? lastAt + 0.01 : this.jd;
    let el = sat.el;
    // planning after a queued burn: assume it happened
    if (sat.burns.length) el = this.simulateBurns(sat).el ?? el;
    const at = burnTime(el, base, kind);
    const st = O.stateAt(el, at);
    const nv = burnVelocity(st.r, st.v, kind, target);
    const dv = O.len(O.sub(nv, st.v));
    const names: Record<Burn["kind"], string> = { circ: "Circularise", apo: `Set apogee ${target.toLocaleString("en-US")} km`, peri: `Set perigee ${target.toLocaleString("en-US")} km`, plane: `Plane change ${target > 0 ? "+" : ""}${target}°`, geo: "Apogee burn → GEO", deorbit: "Deorbit burn", avoid: "Collision avoidance", raise: `Raise to ${target} km` };
    const burn: Burn = { id: `b-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 5)}`, label: label ?? names[kind], at, dv: [dv, target, 0], kind };
    const upd = { ...sat, burns: [...sat.burns, burn] };
    s.set({ fleet: s.fleet.map((x) => (x.id === satId ? upd : x)) });
    this.say("FIDO", `FIDO: ${burn.label} for ${sat.name} is in the plan. Δv ${(dv * 1000).toFixed(0)} m/s at ${O.dateOf(at).toISOString().slice(11, 19)} GMT.`, "info", false);
    if (kind === "apo" && Math.abs(target - (el.a * (1 - el.e) - O.RE)) > 50) {
      // Hohmann: the matching circularisation half an orbit later
      const rp = el.a * (1 - el.e);
      const aT = (rp + O.RE + target) / 2;
      const at2 = at + O.period(aT) / 2 / 86400;
      const b2: Burn = { id: burn.id + "c", label: `Circularise at ${target.toLocaleString("en-US")} km`, at: at2, dv: [0, 0, 0], kind: "circ" };
      const upd2 = { ...upd, burns: [...upd.burns, b2] };
      s.set({ fleet: useMC.getState().fleet.map((x) => (x.id === satId ? upd2 : x)) });
    }
  }

  private simulateBurns(sat: Sat) {
    let el = sat.el;
    for (const b of sat.burns) {
      if (!el) break;
      const st = O.stateAt(el, b.at);
      el = O.elementsFromState(st.r, burnVelocity(st.r, st.v, b.kind, b.dv[1]), b.at);
    }
    return { el };
  }

  cancelBurns(satId: string) {
    const s = useMC.getState();
    s.set({ fleet: s.fleet.map((x) => (x.id === satId ? { ...x, burns: [] } : x)) });
  }

  toggleKeep(satId: string) {
    const s = useMC.getState();
    s.set({ fleet: s.fleet.map((x) => (x.id === satId ? { ...x, keep: !x.keep } : x)) });
  }
  safeMode(satId: string) {
    const s = useMC.getState();
    const sat = s.fleet.find((x) => x.id === satId);
    if (!sat) return;
    const on = sat.status !== "safe";
    s.set({ fleet: s.fleet.map((x) => (x.id === satId ? { ...x, status: on ? "safe" : "active" } : x)) });
    this.say("EECOM", on ? `EECOM: ${sat.name} commanded to safe mode. Sun-pointing, payload off.` : `EECOM: ${sat.name} recovered from safe mode.`, on ? "warn" : "good", false);
  }
  remove(satId: string) {
    const s = useMC.getState();
    s.set({ fleet: s.fleet.filter((x) => x.id !== satId), selected: s.selected === satId ? null : s.selected });
  }

  nextBurnJd() {
    let best = Infinity;
    for (const s of this.fleet) for (const b of s.burns) best = Math.min(best, b.at);
    return best;
  }

  warpToNextBurn() {
    const t = this.nextBurnJd();
    if (t === Infinity || t < this.jd) return;
    this.jd = t - 30 / 86400;
    useMC.getState().set({ jd: this.jd, warp: 0 });
  }

  private execBurn(sat: Sat, b: Burn): Sat {
    if (!sat.el) return { ...sat, burns: sat.burns.filter((x) => x.id !== b.id) };
    const st = O.stateAt(sat.el, b.at);
    const nv = burnVelocity(st.r, st.v, b.kind, b.dv[1]);
    let dv = O.sub(nv, st.v);
    let dvm = O.len(dv);
    const ve = (sat.isp * G0) / 1000;
    const prop = sat.mass - sat.dry;
    let used = sat.mass * (1 - Math.exp(-dvm / ve));
    let partial = false;
    if (used > prop) {
      const dvMax = ve * Math.log(sat.mass / sat.dry);
      dv = O.mul(dv, dvMax / dvm);
      dvm = dvMax;
      used = prop;
      partial = true;
    }
    const el = O.elementsFromState(st.r, O.add(st.v, dv), b.at);
    const hp = O.periapsis(el), ha = O.apoapsis(el);
    let status = sat.status;
    if (b.kind === "geo" && !partial) status = "active";
    if (b.kind === "deorbit") status = sat.status;
    this.say(
      "FIDO",
      partial
        ? `FIDO: ${sat.name} ${b.label} cut short — propellant depleted after ${(dvm * 1000).toFixed(0)} m/s. Orbit now ${hp.toFixed(0)} by ${ha.toFixed(0)} kilometres.`
        : `FIDO: ${b.label} complete on ${sat.name}. ${(dvm * 1000).toFixed(0)} metres per second. Orbit ${hp.toFixed(0)} by ${ha.toLocaleString("en-US", { maximumFractionDigits: 0 })} kilometres, ${(el.i / D2R).toFixed(1)} degrees.`,
      partial ? "warn" : "good",
      false,
    );
    return { ...sat, el, mass: sat.mass - used, status, burns: sat.burns.filter((x) => x.id !== b.id) };
  }

  private stepFleet(dtSim: number) {
    const s = useMC.getState();
    let changed = false;
    const jd = this.jd;
    this.decayAt += dtSim;
    const doDecay = this.decayAt > 120;
    const decayDt = this.decayAt;
    if (doDecay) this.decayAt = 0;
    const iss = s.fleet.find((x) => x.id === "cat-iss");
    const fleet = s.fleet.map((sat0) => {
      if (sat0.owner !== "ours") return sat0;
      let sat = sat0;
      for (const b of sat.burns) {
        if (b.at <= jd) {
          sat = this.execBurn(sat, b);
          changed = true;
        }
      }
      if (!sat.el) return sat;
      if (sat.status === "raising" && sat.raiseTo) {
        const alt = sat.el.a - O.RE;
        if (alt >= sat.raiseTo) {
          sat = { ...sat, status: "active", raiseTo: undefined };
          changed = true;
          this.say("PAYLOADS", `Payloads: ${sat.name} has reached the ${sat.raiseTo ?? 550} kilometre operational shell. Handing over to constellation operations.`, "good", false);
        } else if (dtSim > 0) {
          // krypton Hall thrusters: ~10 km/day of climb
          const da = (dtSim / 86400) * 10;
          const st = O.stateAt(sat.el, jd);
          const r = O.len(st.r);
          const el = O.elementsFromState(st.r, O.mul(O.norm(st.v), Math.sqrt(O.MU * (2 / r - 1 / (sat.el.a + da)))), jd);
          sat = { ...sat, el };
        }
      }
      if ((sat.status === "transfer" && sat.arriveJd && (sat.kind === "crew" || sat.kind === "cargo") && jd >= sat.arriveJd) && iss?.el) {
        sat = { ...sat, status: "docked", el: { ...iss.el }, where: "Docked to the ISS — Harmony forward port" };
        changed = true;
        this.say("CAPCOM", `Capsule contact and capture confirmed. ${sat.name} is docked to the International Space Station. ${sat.crew ? `Welcome aboard, crew.` : "Hatch opening in two hours."}`, "good");
      }
      if (sat.status === "docked" && iss?.el) sat = { ...sat, el: iss.el };
      if (sat.status === "departing" && sat.arriveJd && sat.el) {
        const r = O.len(O.stateAt(sat.el, jd).r);
        if (sat.dest === "moon" && jd >= sat.arriveJd) {
          const flyby = sat.kind === "artemis";
          sat = { ...sat, status: flyby ? "cruise" : "lunar", where: flyby ? "Free-return trajectory home" : "Lunar orbit, 100 km", deep: { planet: "moon" }, arriveJd: flyby ? jd + 5 : undefined, departJd: jd, dest: flyby ? undefined : "moon" };
          changed = true;
          this.say("CAPCOM", flyby ? `Orion, Houston: you are behind the Moon. Closest approach 130 kilometres above the far side. Looking forward to hearing from you on the other side.` : `FIDO: lunar orbit insertion burn complete. ${sat.name} is in lunar orbit.`, "good");
        } else if (sat.dest === "l2" && jd >= sat.arriveJd) {
          sat = { ...sat, status: "l2", where: "Sun–Earth L2 halo orbit", deep: { planet: "l2", au: 0.0101 } };
          changed = true;
          this.say("FIDO", `FIDO: L2 insertion burn complete. ${sat.name} is in its halo orbit, one point five million kilometres from Earth.`, "good");
        } else if ((sat.dest === "mars" || sat.dest === "jupiter") && r > SOI) {
          sat = { ...sat, status: "cruise", departJd: sat.departJd ?? jd, where: sat.dest === "mars" ? "Interplanetary cruise to Mars" : "Interplanetary cruise (MEGA trajectory)" };
          changed = true;
          this.say("NETWORK", `Network: ${sat.name} has left Earth's sphere of influence. Handing over to the Deep Space Network for the cruise.`, "info", false);
        }
      }
      if (sat.status === "cruise" && sat.arriveJd && jd >= sat.arriveJd) {
        if (sat.kind === "artemis") {
          sat = { ...sat, status: "reentered", where: "Splashdown, Pacific Ocean" };
          this.say("CAPCOM", "Splashdown! Orion has splashed down in the Pacific. The crew is home.", "good");
        } else {
          const rover = sat.kind === "marsrover";
          sat = { ...sat, status: "arrived", where: rover ? "Landed — Gale crater, Mars" : sat.dest === "mars" ? "Mars orbit" : "Jupiter orbit", deep: { planet: sat.dest } };
          this.say(rover ? "CAPCOM" : "FIDO", rover ? `Touchdown confirmed! We are safe on Mars. ${sat.name} is on the floor of Gale crater. Seven minutes of terror are over.` : `FIDO: orbit insertion burn complete. ${sat.name} is in orbit around ${sat.dest === "mars" ? "Mars" : "Jupiter"}.`, "good");
        }
        changed = true;
      }
      // drag
      if (doDecay && sat.el && sat.el.e < 1 && (sat.status === "active" || sat.status === "raising" || sat.status === "safe" || sat.status === "transfer")) {
        const hp = O.periapsis(sat.el);
        if (hp < 700) {
          const rho = O.thermoDensity(hp + (O.apoapsis(sat.el) - hp) * 0.2);
          const B = 0.012;
          const daKm = (rho * B * Math.sqrt(O.MU * 1e9 * sat.el.a * 1000) * decayDt) / 1000;
          if (sat.keep && sat.mass > sat.dry * 1.002) {
            const dvKm = (daKm / (2 * sat.el.a)) * Math.sqrt(O.MU / sat.el.a);
            sat = { ...sat, mass: sat.mass * Math.exp(-dvKm / ((sat.isp * G0) / 1000)) };
          } else {
            const el = { ...sat.el, a: sat.el.a - daKm * (1 + sat.el.e * 4) };
            el.e = Math.max(0, sat.el.e - (daKm / sat.el.a) * 0.6);
            sat = { ...sat, el };
            if (O.periapsis(el) < 125) {
              sat = { ...sat, status: "reentered", where: "Re-entered the atmosphere" };
              changed = true;
              this.say("FIDO", `FIDO: ${sat.name} has re-entered the atmosphere${sat.burns.length ? "" : " and burned up"}.`, "warn", false);
            }
          }
          changed = true;
        }
      }
      return sat;
    });
    if (changed) s.set({ fleet });
  }

  // —— the frame ——
  update(dtReal: number) {
    const s = useMC.getState();
    const ops = s.ops;
    let warp = WARPS[s.warp] ?? 1;
    const powered = this.flight?.powered ?? false;
    if ((ops.phase === "flight" && powered) && warp > 10) {
      warp = 10;
      s.set({ warp: 3 });
    }
    if (ops.phase === "count" && warp > 100) {
      warp = 100;
      s.set({ warp: 5 });
    }
    if (performance.now() < this.losUntil) {
      /* telemetry is gone but the vehicle flies on */
    }
    const dtSim = dtReal * warp;
    this.jd += dtSim / 86400;
    this.stepPoll(dtReal);
    this.stepCount(dtSim);
    if (ops.phase === "flight" || ops.phase === "post") this.stepFlight(dtSim);
    // don't warp through a planned burn
    const nb = this.nextBurnJd();
    if (nb < this.jd + dtSim / 86400 && warp > 100) s.set({ warp: 3 });
    this.stepFleet(dtSim);
    const f = this.flight;
    if (f && ops.phase !== "idle") this.audio.launch(f.fB + f.fC + f.fU, f.alt / 1000);
    else this.audio.launch(0, 0);

    const now = performance.now();
    if (now - this.uiAt > 100) {
      this.uiAt = now;
      const patch: Partial<ReturnType<typeof useMC.getState>> = { jd: this.jd };
      if (f && performance.now() >= this.losUntil) patch.tele = this.telemetry(f);
      s.set(patch);
    }
    if (now - this.saveAt > 5000) {
      this.saveAt = now;
      s.set({ jd: this.jd });
    }
  }

  telemetry(f: Flight) {
    const last = f.hist[f.hist.length - 1];
    const el = f.alt > 80_000 ? f.elements() : null;
    const veh = f.veh;
    const stage = f.bOn ? `${veh.boosters?.name ?? "Boosters"} + ${veh.stages[0].name}` : f.cOn ? veh.stages[0].name : f.uOn ? veh.stages[1].name : "Payload";
    return {
      ...zeroTele,
      met: f.t,
      alt: f.alt / 1000,
      vel: last?.v ?? 0,
      vs: last?.vs ?? 0,
      dr: last?.dr ?? 0,
      acc: f.acc,
      q: f.q / 1000,
      mach: f.mach,
      mass: f.mass / 1000,
      thr: Math.max(f.thrB, f.thrC, f.thrU),
      stage,
      phase: f.phase,
      pitch: last?.pitch ?? 90,
      hp: el && el.e < 1 ? O.periapsis(el) : el ? O.periapsis(el) : 0,
      ha: el && el.e < 1 ? O.apoapsis(el) : Infinity,
      inc: el ? el.i / D2R : 0,
      prop: [veh.boosters ? f.bProp / veh.boosters.prop : 0, f.cProp / veh.stages[0].prop, f.uProp / veh.stages[1].prop],
      boosters: f.recov.filter((b) => b.mode !== "expend").map((b) => ({ label: b.label, alt: b.h / 1000, vel: b.hist[b.hist.length - 1]?.v ?? 0, phase: b.phase, prop: b.prop })),
    };
  }

  setWarp(i: number) {
    const s = useMC.getState();
    const powered = this.flight?.powered ?? false;
    let k = Math.max(0, Math.min(WARPS.length - 1, i));
    if (s.ops.phase === "flight" && powered) k = Math.min(k, 3);
    if (s.ops.phase === "count") k = Math.min(k, 5);
    s.set({ warp: k });
  }

  dispose() {
    this.audio.dispose();
    this.audio = new RoomAudio();
    this.started = false;
    if (this.replanTimer) clearTimeout(this.replanTimer);
  }
}

export const mc = new MissionControl();
export { PAYLOADS };
