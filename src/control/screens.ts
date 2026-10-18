/**
 * Everything drawn on the glass: the front-wall displays (world map with ground tracks and the
 * terminator, ascent trajectory plots, vehicle schematic, countdown clock, launch weather, the Deep
 * Space Network, fleet status) and the console monitors. Plain 2D canvases uploaded as textures,
 * redrawn a few times a second in rotation.
 */

import * as THREE from "three";
import { STATIONS, siteById, vehicleById, SITES, POSITIONS, type Vehicle } from "./data";
import { mc, network, satNow, weather, dvBudget } from "./engine";
import { fmtT } from "./flight";
import * as O from "./orbit";
import { WARPS, useMC, type Sat } from "./store";

export const C = {
  bg: "#02060b",
  panel: "#06101a",
  grid: "#0d2033",
  line: "#173048",
  text: "#d3e6f4",
  dim: "#6d88a1",
  faint: "#3c5670",
  cyan: "#4fd1ff",
  lime: "#c8ff3d",
  amber: "#ffb020",
  red: "#ff4d5e",
  mag: "#ff6fb1",
  gold: "#ffd166",
  ocean: "#04101d",
};

let MONO = "monospace";
let SANS = "sans-serif";
export function initFonts() {
  const css = getComputedStyle(document.documentElement);
  MONO = css.getPropertyValue("--font-jetbrains").trim() || "ui-monospace, monospace";
  SANS = css.getPropertyValue("--font-inter-tight").trim() || "system-ui, sans-serif";
}
const mono = (px: number, w = 500) => `${w} ${px}px ${MONO}`;
const sans = (px: number, w = 600) => `${w} ${px}px ${SANS}`;

const pad = (n: number, k = 2) => String(Math.floor(Math.abs(n))).padStart(k, "0");
export function gmtStamp(jd: number) {
  const d = O.dateOf(jd);
  const start = Date.UTC(d.getUTCFullYear(), 0, 0);
  const doy = Math.floor((d.getTime() - start) / 86400000);
  return `${pad(doy, 3)}:${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`;
}
export function clock(sec: number, sign = true) {
  const s = Math.max(0, Math.round(Math.abs(sec)));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return `${sign ? "" : ""}${pad(h)}:${pad(m)}:${pad(s % 60)}`;
}
export const fmtN = (n: number, d = 0) => n.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });

function header(ctx: CanvasRenderingContext2D, w: number, title: string, right = "", tone = C.cyan, h = 34) {
  ctx.fillStyle = "#0a1826";
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = tone;
  ctx.fillRect(0, h - 2, w, 2);
  ctx.fillStyle = tone;
  ctx.fillRect(10, 9, 6, h - 18);
  ctx.font = mono(h * 0.5, 700);
  ctx.textBaseline = "middle";
  ctx.textAlign = "left";
  ctx.fillStyle = C.text;
  ctx.fillText(title, 26, h / 2);
  ctx.textAlign = "right";
  ctx.fillStyle = C.dim;
  ctx.fillText(right, w - 12, h / 2);
  ctx.textAlign = "left";
}

function kv(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, k: string, v: string, size = 16, color = C.text) {
  ctx.font = mono(size * 0.8, 500);
  ctx.fillStyle = C.dim;
  ctx.textAlign = "left";
  ctx.fillText(k, x, y);
  ctx.font = mono(size, 600);
  ctx.fillStyle = color;
  ctx.textAlign = "right";
  ctx.fillText(v, x + w, y);
  ctx.textAlign = "left";
}

function light(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, color: string, on = true) {
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fillStyle = on ? color : "#1a2a3a";
  ctx.fill();
  if (on) {
    ctx.beginPath();
    ctx.arc(x, y, r * 2.2, 0, Math.PI * 2);
    const g = ctx.createRadialGradient(x, y, r * 0.5, x, y, r * 2.2);
    g.addColorStop(0, color + "66");
    g.addColorStop(1, color + "00");
    ctx.fillStyle = g;
    ctx.fill();
  }
}

// ———————————————————————————— screen plumbing ————————————————————————————

export type ScreenId = "map" | "traj" | "clock" | "vehicle" | "weather" | "dsn" | "fleet" | "feedbar" | "orbitbar" | `con${number}`;

/** redraw rates: [while idle, while a mission is live] (Hz) */
type Surface = { id: ScreenId; canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D; tex: THREE.CanvasTexture; hz: [number, number]; last: number; draw: (ctx: CanvasRenderingContext2D, w: number, h: number, t: number) => void };

export class Screens {
  surfaces = new Map<ScreenId, Surface>();
  private base: HTMLCanvasElement | null = null;
  private night: HTMLCanvasElement | null = null;
  private coast: Float32Array | null = null;
  private borders: Float32Array | null = null;
  private order: ScreenId[] = [];
  private cursor = 0;
  private links: ReturnType<typeof network> = [];
  private linksAt = 0;

  constructor(bordersBin: ArrayBuffer | null, nightImg: HTMLImageElement | null, quality: number) {
    initFonts();
    if (bordersBin) {
      const head = new Uint32Array(bordersBin, 0, 2);
      const data = new Int16Array(bordersBin, 8);
      const nB = head[0], nC = head[1];
      this.borders = new Float32Array(nB * 4);
      this.coast = new Float32Array(nC * 4);
      for (let i = 0; i < nB + nC; i++) {
        const dst = i < nB ? this.borders : this.coast;
        const j = i < nB ? i : i - nB;
        for (let k = 0; k < 4; k++) dst[j * 4 + k] = data[i * 4 + k] / 100;
      }
    }
    const big = quality >= 1;
    this.add("map", big ? 2048 : 1400, big ? 714 : 488, [1.5, 3], (c, w, h) => this.drawMap(c, w, h));
    this.add("traj", big ? 1600 : 1024, big ? 900 : 576, [0.5, 3], (c, w, h) => this.drawTraj(c, w, h));
    this.add("clock", 1024, 466, [2, 4], (c, w, h) => this.drawClock(c, w, h));
    this.add("vehicle", 1024, 466, [0.5, 4], (c, w, h, t) => this.drawVehicle(c, w, h, t));
    this.add("weather", 1024, 466, [0.3, 0.3], (c, w, h) => this.drawWeather(c, w, h));
    this.add("dsn", 1024, 466, [1, 1], (c, w, h, t) => this.drawDsn(c, w, h, t));
    this.add("fleet", 1024, 466, [0.3, 0.5], (c, w, h) => this.drawFleet(c, w, h));
    this.add("feedbar", 1600, 64, [1, 3], (c, w, h) => this.drawFeedBar(c, w, h));
    this.add("orbitbar", 1024, 48, [0.3, 0.3], (c, w, h) => this.drawOrbitBar(c, w, h));
    for (let i = 0; i < 6; i++) this.add(`con${i}`, 512, 320, [0.8, 1.5], (c, w, h, t) => this.drawConsole(i, c, w, h, t));
    if (nightImg) {
      const s = this.surfaces.get("map")!;
      const mw = Math.round(s.canvas.height * 2);
      const n = document.createElement("canvas");
      n.width = mw;
      n.height = s.canvas.height;
      n.getContext("2d")!.drawImage(nightImg, 0, 0, n.width, n.height);
      this.night = n;
    }
  }

  private add(id: ScreenId, w: number, h: number, hz: [number, number], draw: Surface["draw"]) {
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d")!;
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 8;
    tex.generateMipmaps = true;
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    this.surfaces.set(id, { id, canvas, ctx, tex, hz, last: -1, draw });
    this.order.push(id);
    draw(ctx, w, h, 0);
    tex.needsUpdate = true;
  }

  tex(id: ScreenId) {
    return this.surfaces.get(id)!.tex;
  }
  canvas(id: ScreenId) {
    return this.surfaces.get(id)!.canvas;
  }

  /** redraw whatever is due; at most `budget` canvases per frame */
  update(t: number, budget = 1, focus?: ScreenId) {
    if (t - this.linksAt > 2) {
      this.linksAt = t;
      this.links = network(mc.jd, mc.fleet);
    }
    const live = useMC.getState().ops.phase !== "idle" ? 1 : 0;
    let n = 0;
    if (focus) {
      // the screen you walked up to runs at full rate
      const s = this.surfaces.get(focus);
      if (s && t - s.last >= 1 / Math.max(4, s.hz[live] * 2)) {
        this.redraw(s, t);
        n++;
      }
    }
    for (let k = 0; k < this.order.length && n < budget; k++) {
      this.cursor = (this.cursor + 1) % this.order.length;
      const s = this.surfaces.get(this.order[this.cursor])!;
      if (t - s.last >= 1 / s.hz[live]) {
        this.redraw(s, t);
        n++;
      }
    }
  }
  private redraw(s: Surface, t: number) {
    s.last = t;
    s.draw(s.ctx, s.canvas.width, s.canvas.height, t);
    s.tex.needsUpdate = true;
  }

  dispose() {
    for (const s of this.surfaces.values()) s.tex.dispose();
  }

  // ———————————————————————————— the world map ————————————————————————————

  private baseMap(w: number, h: number) {
    if (this.base && this.base.width === w && this.base.height === h) return this.base;
    const b = document.createElement("canvas");
    b.width = w;
    b.height = h;
    const c = b.getContext("2d")!;
    const g = c.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, "#041222");
    g.addColorStop(0.5, "#05182c");
    g.addColorStop(1, "#041222");
    c.fillStyle = g;
    c.fillRect(0, 0, w, h);
    c.strokeStyle = "#0e2740";
    c.lineWidth = 1;
    for (let lon = -180; lon <= 180; lon += 15) {
      const x = ((lon + 180) / 360) * w;
      c.beginPath();
      c.moveTo(x, 0);
      c.lineTo(x, h);
      c.stroke();
    }
    for (let lat = -75; lat <= 75; lat += 15) {
      const y = ((90 - lat) / 180) * h;
      c.beginPath();
      c.moveTo(0, y);
      c.lineTo(w, y);
      c.stroke();
    }
    c.strokeStyle = "#1a4566";
    c.lineWidth = 1.4;
    c.beginPath();
    c.moveTo(0, h / 2);
    c.lineTo(w, h / 2);
    c.stroke();
    c.font = mono(h * 0.016, 500);
    c.fillStyle = "#2c5576";
    for (let lon = -150; lon <= 180; lon += 30) c.fillText(`${Math.abs(lon)}°${lon < 0 ? "W" : lon > 0 ? "E" : ""}`, ((lon + 180) / 360) * w + 3, h - 6);
    for (let lat = -60; lat <= 60; lat += 30) c.fillText(`${Math.abs(lat)}°${lat < 0 ? "S" : lat > 0 ? "N" : ""}`, 4, ((90 - lat) / 180) * h - 3);
    const seg = (arr: Float32Array | null, color: string, lw: number) => {
      if (!arr) return;
      c.strokeStyle = color;
      c.lineWidth = lw;
      c.beginPath();
      for (let i = 0; i < arr.length; i += 4) {
        const x1 = ((arr[i] + 180) / 360) * w, y1 = ((90 - arr[i + 1]) / 180) * h;
        const x2 = ((arr[i + 2] + 180) / 360) * w, y2 = ((90 - arr[i + 3]) / 180) * h;
        if (Math.abs(x1 - x2) > w / 2) continue;
        c.moveTo(x1, y1);
        c.lineTo(x2, y2);
      }
      c.stroke();
    };
    seg(this.borders, "#173c58", 0.8);
    seg(this.coast, "#3f8db8", 1.3);
    this.base = b;
    return b;
  }

  private nightCv: HTMLCanvasElement | null = null;
  private nightKey = "";
  private nightLayer(mw: number, mh: number, sun: { lat: number; lon: number }) {
    const key = `${mw}|${Math.round(sun.lon / 0.006)}|${Math.round(sun.lat / 0.01)}`;
    if (this.nightCv && key === this.nightKey) return this.nightCv;
    this.nightKey = key;
    const cv = this.nightCv ?? document.createElement("canvas");
    cv.width = mw;
    cv.height = mh;
    this.nightCv = cv;
    const ctx = cv.getContext("2d")!;
    ctx.clearRect(0, 0, mw, mh);
    const X = (lon: number) => ((lon / O.DEG + 180) / 360) * mw;
    const Y = (lat: number) => ((90 - lat / O.DEG) / 180) * mh;
    const latT = (lon: number) => Math.atan(-Math.cos(lon - sun.lon) / Math.tan(sun.lat || 1e-4));
    const pts: [number, number][] = [];
    for (let k = 0; k <= 180; k++) {
      const lon = -Math.PI + (k / 180) * Math.PI * 2;
      pts.push([X(lon), Y(latT(lon))]);
    }
    const south = sun.lat > 0;
    const night = new Path2D();
    night.moveTo(0, south ? mh : 0);
    for (const [x, y] of pts) night.lineTo(x, y);
    night.lineTo(mw, south ? mh : 0);
    night.closePath();
    ctx.save();
    ctx.clip(night);
    ctx.fillStyle = "rgba(0,2,10,0.66)";
    ctx.fillRect(0, 0, mw, mh);
    if (this.night) {
      ctx.globalCompositeOperation = "lighter";
      ctx.globalAlpha = 0.55;
      ctx.drawImage(this.night, 0, 0, mw, mh);
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = "source-over";
    }
    ctx.restore();
    ctx.strokeStyle = "rgba(255,210,120,0.35)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
    ctx.stroke();
    return cv;
  }

  private drawMap(ctx: CanvasRenderingContext2D, W: number, H: number) {
    const s = useMC.getState();
    const jd = mc.jd;
    const top = 40;
    const mh = H - top;
    const mw = Math.round(mh * 2);
    const side = W - mw;
    ctx.fillStyle = C.bg;
    ctx.fillRect(0, 0, W, H);
    const f = mc.flight;
    header(ctx, W, "FLIGHT DYNAMICS · WORLD MAP · GROUND TRACK", `GMT ${gmtStamp(jd)}`, C.cyan, top - 4);
    ctx.save();
    ctx.translate(0, top);
    ctx.drawImage(this.baseMap(mw, mh), 0, 0);
    const X = (lon: number) => ((lon / O.DEG + 180) / 360) * mw;
    const Y = (lat: number) => ((90 - lat / O.DEG) / 180) * mh;
    // night side, city lights, terminator (the layer only changes as the Sun moves)
    const sun = O.subSolar(jd);
    ctx.drawImage(this.nightLayer(mw, mh, sun), 0, 0);
    // sun and moon
    const sx = X(sun.lon), sy = Y(sun.lat);
    light(ctx, sx, sy, 7, C.gold);
    ctx.font = mono(13, 600);
    ctx.fillStyle = C.gold;
    ctx.fillText("SUN", sx + 12, sy + 4);
    const mg = O.eciToGeo(O.moonPos(jd), jd);
    ctx.beginPath();
    ctx.arc(X(mg.lon), Y(mg.lat), 6, 0, Math.PI * 2);
    ctx.fillStyle = "#c9c9c9";
    ctx.fill();
    ctx.fillStyle = C.dim;
    ctx.fillText("MOON", X(mg.lon) + 10, Y(mg.lat) + 4);

    // stations & pads
    ctx.font = mono(12, 500);
    for (const st of STATIONS) {
      const x = X(st.lon * O.DEG), y = Y(st.lat * O.DEG);
      ctx.fillStyle = st.net === "DSN" ? C.mag : "#5f7c96";
      ctx.fillRect(x - 4, y - 4, 8, 8);
      if (st.net === "DSN") ctx.fillText(st.short.toUpperCase(), x + 8, y - 6);
    }
    for (const site of SITES) {
      const x = X(site.lon * O.DEG), y = Y(site.lat * O.DEG);
      ctx.beginPath();
      ctx.moveTo(x, y - 7);
      ctx.lineTo(x + 6, y + 5);
      ctx.lineTo(x - 6, y + 5);
      ctx.closePath();
      ctx.fillStyle = mc.pending?.draft.site === site.id ? C.lime : "#e7c47a";
      ctx.fill();
    }

    // ground tracks and fleet
    const fleet = s.fleet;
    const sel = fleet.find((x) => x.id === s.selected);
    const track = (sat: Sat, orbits: number, color: string, lw: number) => {
      if (!sat.el || sat.el.e >= 1 || sat.el.a > 60_000) return;
      const P = O.period(sat.el.a) / 86400;
      const n = Math.min(360, Math.round(140 * orbits));
      for (const [from, to, dash] of [[-0.35, 0, false], [0, orbits, true]] as [number, number, boolean][]) {
        ctx.beginPath();
        ctx.setLineDash(dash ? [8, 6] : []);
        let px = -1e9;
        for (let k = 0; k <= n; k++) {
          const tt = jd + (from + ((to - from) * k) / n) * P;
          const g = O.eciToGeo(O.stateAt(sat.el, tt).r, tt);
          const x = X(g.lon), y = Y(g.lat);
          if (Math.abs(x - px) > mw / 2 || k === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
          px = x;
        }
        ctx.strokeStyle = color;
        ctx.globalAlpha = dash ? 0.75 : 0.45;
        ctx.lineWidth = lw;
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
      ctx.setLineDash([]);
    };
    for (const sat of fleet) if (sat.owner === "ours" && sat !== sel && sat.status !== "reentered") track(sat, 1, sat.color, 1.6);
    if (sel) track(sel, 2.2, C.lime, 2.6);
    for (const sat of fleet) {
      const now = satNow(sat, jd);
      if (!now?.geo) continue;
      const x = X(now.geo.lon), y = Y(now.geo.lat);
      const ours = sat.owner === "ours";
      const isSel = sat === sel;
      if (sat.kind === "constellation") {
        ctx.fillStyle = "#6f86a0";
        ctx.fillRect(x - 1.5, y - 1.5, 3, 3);
        continue;
      }
      if (isSel) {
        // footprint
        const lam = O.footprint(now.geo.alt);
        ctx.beginPath();
        let px = -1e9;
        for (let k = 0; k <= 72; k++) {
          const az = (k / 72) * Math.PI * 2;
          const lat = Math.asin(Math.sin(now.geo.lat) * Math.cos(lam) + Math.cos(now.geo.lat) * Math.sin(lam) * Math.cos(az));
          const lon = now.geo.lon + Math.atan2(Math.sin(az) * Math.sin(lam) * Math.cos(now.geo.lat), Math.cos(lam) - Math.sin(now.geo.lat) * Math.sin(lat));
          const xx = X(O.wrapPi(lon)), yy = Y(lat);
          if (Math.abs(xx - px) > mw / 2 || k === 0) ctx.moveTo(xx, yy);
          else ctx.lineTo(xx, yy);
          px = xx;
        }
        ctx.strokeStyle = "rgba(200,255,61,0.55)";
        ctx.lineWidth = 1.5;
        ctx.stroke();
      }
      light(ctx, x, y, isSel ? 6 : ours ? 4.5 : 3.5, isSel ? C.lime : sat.color);
      if (ours || isSel || sat.kind === "station" || sat.kind === "science") {
        ctx.font = mono(isSel ? 15 : 12, isSel ? 700 : 500);
        ctx.fillStyle = isSel ? C.lime : ours ? C.text : C.dim;
        ctx.fillText(sat.name.split(" (")[0].toUpperCase(), x + 9, y - 7);
      }
    }
    // the ascent
    if (f) {
      const hist = f.hist;
      ctx.beginPath();
      let px = -1e9;
      for (let k = 0; k < hist.length; k += 2) {
        const x = X(hist[k].lon), y = Y(hist[k].lat);
        if (Math.abs(x - px) > mw / 2 || k === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
        px = x;
      }
      ctx.strokeStyle = C.lime;
      ctx.lineWidth = 3;


      ctx.stroke();

      const last = hist[hist.length - 1];
      if (last) {
        const x = X(last.lon), y = Y(last.lat);
        light(ctx, x, y, 7, C.lime);
        ctx.font = mono(16, 700);
        ctx.fillStyle = C.lime;
        ctx.fillText(`${vehicleById[f.plan.vehicle].name.toUpperCase()}  ${fmtN(last.h, 1)} KM`, x + 12, y + 20);
      }
    }
    ctx.restore();

    // side panel
    const x0 = mw + 14;
    const pw = side - 26;
    ctx.fillStyle = C.panel;
    ctx.fillRect(mw, top, side, H - top);
    ctx.fillStyle = C.line;
    ctx.fillRect(mw, top, 2, H - top);
    let y = top + 30;
    const t = s.tele;
    if (f && t && s.ops.phase !== "idle") {
      ctx.font = mono(15, 700);
      ctx.fillStyle = C.lime;
      ctx.fillText(`ASCENT · ${s.ops.mission.toUpperCase()}`.slice(0, 44), x0, y);
      y += 30;
      const rows: [string, string][] = [
        ["MET", fmtT(t.met).replace("T+", "")],
        ["ALTITUDE", `${fmtN(t.alt, 1)} km`],
        ["INERTIAL VEL", `${fmtN(t.vel)} m/s`],
        ["SURFACE SPEED", `${fmtN(t.vs * 3.6)} km/h`],
        ["DOWNRANGE", `${fmtN(t.dr, 0)} km`],
        ["ACCEL", `${t.acc.toFixed(2)} g`],
        ["DYN PRESSURE", `${t.q.toFixed(1)} kPa`],
        ["MACH", t.mach > 25 ? "—" : t.mach.toFixed(2)],
        ["STAGE", t.stage.toUpperCase().slice(0, 22)],
        ["PERIGEE", t.alt > 80 ? `${fmtN(t.hp)} km` : "—"],
        ["APOGEE", t.alt > 80 ? (isFinite(t.ha) ? `${fmtN(t.ha)} km` : "ESCAPE") : "—"],
        ["INCLINATION", t.alt > 80 ? `${t.inc.toFixed(2)}°` : "—"],
      ];
      for (const [k, v] of rows) {
        kv(ctx, x0, y, pw, k, v, 19);
        y += 30;
      }
      y += 10;
      ctx.font = mono(13, 700);
      ctx.fillStyle = C.dim;
      ctx.fillText("EVENTS", x0, y);
      y += 24;
      for (const e of f.events.slice(-8)) {
        ctx.font = mono(14, 500);
        ctx.fillStyle = e.tone === "bad" ? C.red : e.tone === "warn" ? C.amber : e.tone === "good" ? C.lime : C.text;
        ctx.fillText(`${fmtT(e.t)}  ${e.label}`.slice(0, 50), x0, y);
        y += 21;
      }
    } else if (sel) {
      const now = satNow(sel, jd);
      ctx.font = mono(13, 600);
      ctx.fillStyle = C.dim;
      ctx.fillText(sel.owner === "ours" ? "OUR SPACECRAFT" : `TRACKED · ${sel.agency.toUpperCase()}`.slice(0, 48), x0, y);
      y += 30;
      ctx.font = sans(26, 700);
      ctx.fillStyle = C.lime;
      ctx.fillText(sel.name.slice(0, 30), x0, y);
      y += 34;
      const el = sel.el;
      const rows: [string, string][] = [["STATUS", sel.status.toUpperCase()]];
      if (now?.geo && el) {
        rows.push(["ALTITUDE", `${fmtN(now.geo.alt, 1)} km`], ["VELOCITY", `${fmtN(O.len(now.v!) * 1000)} m/s`], ["LAT / LON", `${(now.geo.lat / O.DEG).toFixed(2)}°  ${(now.geo.lon / O.DEG).toFixed(2)}°`]);
        if (el.e < 1) rows.push(["PERIGEE × APOGEE", `${fmtN(O.periapsis(el))} × ${fmtN(O.apoapsis(el))} km`], ["INCLINATION", `${(el.i / O.DEG).toFixed(2)}°`], ["PERIOD", `${(O.period(el.a) / 60).toFixed(1)} min`], ["ECCENTRICITY", el.e.toFixed(5)]);
        rows.push(["SUNLIGHT", now.eclipse ? "ECLIPSE" : "SUNLIT"]);
      } else if (now) {
        rows.push(["DISTANCE", now.dist > 1.5e7 ? `${(now.dist / 149597870.7).toFixed(3)} AU` : `${fmtN(now.dist)} km`], ["LIGHT TIME", now.dist / 299792 > 120 ? `${(now.dist / 299792 / 60).toFixed(1)} min` : `${(now.dist / 299792).toFixed(2)} s`], ["WHERE", (sel.where ?? "").toUpperCase().slice(0, 26)]);
      }
      if (sel.owner === "ours") rows.push(["Δv REMAINING", `${fmtN(dvBudget(sel) * 1000)} m/s`], ["MASS", `${fmtN(sel.mass)} kg`]);
      for (const [k, v] of rows) {
        kv(ctx, x0, y, pw, k, v, 18, k === "STATUS" ? C.lime : k === "SUNLIGHT" && v === "ECLIPSE" ? C.amber : C.text);
        y += 28;
      }
      const links = this.links.filter((l) => l.sat.id === sel.id);
      y += 8;
      ctx.font = mono(13, 700);
      ctx.fillStyle = C.dim;
      ctx.fillText("GROUND CONTACT", x0, y);
      y += 24;
      ctx.font = mono(15, 600);
      if (links.length) for (const l of links.slice(0, 3)) {
        ctx.fillStyle = C.mag;
        ctx.fillText(`● ${l.station.short.toUpperCase()}  EL ${l.elev.toFixed(0)}°  ${l.band}`, x0, y);
        y += 22;
      }
      else {
        ctx.fillStyle = sel.el && sel.el.a < 9000 ? C.cyan : C.amber;
        ctx.fillText(sel.el && sel.el.a < 9000 ? "● VIA TDRS RELAY" : "○ NO CONTACT — LOS", x0, y);
        y += 22;
      }
      if (sel.burns.length) {
        y += 8;
        ctx.font = mono(13, 700);
        ctx.fillStyle = C.dim;
        ctx.fillText("PLANNED MANOEUVRES", x0, y);
        y += 22;
        for (const b of sel.burns.slice(0, 3)) {
          ctx.font = mono(14, 600);
          ctx.fillStyle = C.amber;
          ctx.fillText(`${clock((b.at - jd) * 86400)}  ${b.label}`.slice(0, 46), x0, y);
          y += 20;
        }
      }
    } else {
      ctx.font = mono(15, 700);
      ctx.fillStyle = C.dim;
      ctx.fillText("TRACKING", x0, y);
      y += 30;
      const counts = { leo: 0, meo: 0, geo: 0, deep: 0 };
      for (const sat of fleet) {
        const a = sat.el?.a ?? 1e9;
        if (sat.status === "reentered") continue;
        if (!sat.el || a > 60000) counts.deep++;
        else if (a < 8378) counts.leo++;
        else if (a < 40000) counts.meo++;
        else counts.geo++;
      }
      kv(ctx, x0, y, pw, "LOW EARTH ORBIT", String(counts.leo), 20);
      y += 32;
      kv(ctx, x0, y, pw, "MEDIUM EARTH ORBIT", String(counts.meo), 20);
      y += 32;
      kv(ctx, x0, y, pw, "GEOSYNCHRONOUS", String(counts.geo), 20);
      y += 32;
      kv(ctx, x0, y, pw, "DEEP SPACE", String(counts.deep), 20);
      y += 44;
      ctx.font = mono(14, 500);
      ctx.fillStyle = C.dim;
      const lines = ["Select a spacecraft to see its", "ground track, footprint and", "contact with the network.", "", "Dashed: next orbits.  Solid: past.", "Shaded: night side of the Earth."];
      for (const l of lines) {
        ctx.fillText(l, x0, y);
        y += 22;
      }
    }
  }

  // ———————————————————————————— trajectory plots ————————————————————————————

  private drawTraj(ctx: CanvasRenderingContext2D, W: number, H: number) {
    const s = useMC.getState();
    const f = mc.flight;
    const pr = s.prediction;
    ctx.fillStyle = C.bg;
    ctx.fillRect(0, 0, W, H);
    const live = !!f && s.ops.phase !== "idle";
    header(ctx, W, live ? "TRAJECTORY · ACTUAL vs PREDICTED" : "TRAJECTORY · FLIGHT DYNAMICS PREDICTION", live ? fmtT(f!.t) : pr ? (pr.ok ? "TRAJECTORY CLOSES" : "DOES NOT CLOSE") : "", live ? C.lime : pr && !pr.ok ? C.amber : C.cyan, 40);
    const pred = pr?.hist ?? [];
    const act = live ? f!.hist : [];
    if (!pred.length && !act.length) {
      ctx.font = mono(22, 600);
      ctx.fillStyle = C.dim;
      ctx.textAlign = "center";
      ctx.fillText("NO TRAJECTORY LOADED", W / 2, H / 2);
      ctx.textAlign = "left";
      return;
    }
    let tEnd = 600;
    for (const p of pred) if (p.h < 2000) tEnd = p.t;
    const tMax = Math.max(60, Math.min(Math.max(tEnd, act[act.length - 1]?.t ?? 0) * 1.05, 2400));
    const plots: { title: string; key: (p: (typeof pred)[number]) => number; x: (p: (typeof pred)[number]) => number; xMax: number; unit: string; xl: string; fmt: (v: number) => string }[] = [
      { title: "ALTITUDE vs DOWNRANGE", key: (p) => p.h, x: (p) => p.dr, xMax: 0, unit: "km", xl: "km downrange", fmt: (v) => fmtN(v, 0) },
      { title: "INERTIAL VELOCITY", key: (p) => p.v, x: (p) => p.t, xMax: tMax, unit: "m/s", xl: "s", fmt: (v) => fmtN(v, 0) },
      { title: "ACCELERATION", key: (p) => p.a, x: (p) => p.t, xMax: tMax, unit: "g", xl: "s", fmt: (v) => v.toFixed(1) },
      { title: "DYNAMIC PRESSURE", key: (p) => p.q, x: (p) => p.t, xMax: Math.min(tMax, 300), unit: "kPa", xl: "s", fmt: (v) => v.toFixed(0) },
    ];
    const drMax = Math.max(...pred.filter((p) => p.t <= tMax).map((p) => p.dr), ...act.map((p) => p.dr), 10);
    plots[0].xMax = drMax * 1.05;
    const gx = 18, gy = 52, gw = (W - gx * 3) / 2, gh = (H - gy - 18 * 2) / 2;
    plots.forEach((pl, i) => {
      const px = gx + (i % 2) * (gw + gx);
      const py = gy + Math.floor(i / 2) * (gh + 18);
      ctx.fillStyle = C.panel;
      ctx.fillRect(px, py, gw, gh);
      ctx.strokeStyle = C.line;
      ctx.strokeRect(px + 0.5, py + 0.5, gw - 1, gh - 1);
      const ix = px + 64, iy = py + 34, iw = gw - 80, ih = gh - 70;
      const all = [...pred.filter((p) => pl.x(p) <= pl.xMax), ...act];
      const yMax = Math.max(1, ...all.map(pl.key)) * 1.1;
      ctx.strokeStyle = C.grid;
      ctx.lineWidth = 1;
      ctx.font = mono(12, 500);
      ctx.fillStyle = C.faint;
      for (let k = 0; k <= 4; k++) {
        const y = iy + ih - (ih * k) / 4;
        ctx.beginPath();
        ctx.moveTo(ix, y);
        ctx.lineTo(ix + iw, y);
        ctx.stroke();
        ctx.textAlign = "right";
        ctx.fillText(pl.fmt((yMax * k) / 4), ix - 6, y + 4);
      }
      for (let k = 0; k <= 5; k++) {
        const x = ix + (iw * k) / 5;
        ctx.beginPath();
        ctx.moveTo(x, iy);
        ctx.lineTo(x, iy + ih);
        ctx.stroke();
        ctx.textAlign = "center";
        ctx.fillText(fmtN((pl.xMax * k) / 5, 0), x, iy + ih + 16);
      }
      ctx.textAlign = "left";
      ctx.font = mono(15, 700);
      ctx.fillStyle = C.text;
      ctx.fillText(pl.title, px + 12, py + 22);
      ctx.font = mono(12, 500);
      ctx.fillStyle = C.dim;
      ctx.textAlign = "right";
      ctx.fillText(`${pl.unit}  ·  x: ${pl.xl}`, px + gw - 12, py + 22);
      ctx.textAlign = "left";
      const line = (data: typeof pred, color: string, lw: number, dash: number[]) => {
        ctx.beginPath();
        ctx.setLineDash(dash);
        let started = false;
        for (const p of data) {
          const xv = pl.x(p);
          if (xv > pl.xMax) break;
          const x = ix + (xv / pl.xMax) * iw;
          const y = iy + ih - (Math.min(pl.key(p), yMax) / yMax) * ih;
          if (!started) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
          started = true;
        }
        ctx.strokeStyle = color;
        ctx.lineWidth = lw;
        ctx.stroke();
        ctx.setLineDash([]);
      };
      line(pred, live ? "rgba(79,209,255,0.55)" : C.cyan, 2, live ? [7, 6] : []);
      if (act.length) {


        line(act, C.lime, 3, []);

        const p = act[act.length - 1];
        const xv = pl.x(p);
        if (xv <= pl.xMax) light(ctx, ix + (xv / pl.xMax) * iw, iy + ih - (Math.min(pl.key(p), yMax) / yMax) * ih, 5, C.lime);
        ctx.font = mono(24, 700);
        ctx.fillStyle = C.lime;
        ctx.textAlign = "right";
        ctx.fillText(`${pl.fmt(pl.key(p))} ${pl.unit}`, px + gw - 14, py + 54);
        ctx.textAlign = "left";
      }
      // event markers on time plots
      if (i > 0 && pr) {
        for (const e of pr.events) {
          if (!/^(maxq|meco|beco|ses1|seco1|fairing)$/.test(e.id) || e.t > pl.xMax) continue;
          const x = ix + (e.t / pl.xMax) * iw;
          ctx.strokeStyle = "rgba(255,176,32,0.4)";
          ctx.setLineDash([3, 4]);
          ctx.beginPath();
          ctx.moveTo(x, iy);
          ctx.lineTo(x, iy + ih);
          ctx.stroke();
          ctx.setLineDash([]);
          ctx.save();
          ctx.translate(x + 4, iy + 6);
          ctx.rotate(Math.PI / 2);
          ctx.font = mono(11, 600);
          ctx.fillStyle = C.amber;
          ctx.fillText(e.id.toUpperCase().replace("SES1", "SES-1").replace("SECO1", "SECO-1"), 0, 0);
          ctx.restore();
        }
      }
    });
  }

  // ———————————————————————————— small screens ————————————————————————————

  private drawClock(ctx: CanvasRenderingContext2D, W: number, H: number) {
    const s = useMC.getState();
    const ops = s.ops;
    ctx.fillStyle = C.bg;
    ctx.fillRect(0, 0, W, H);
    const f = mc.flight;
    const flying = ops.phase === "flight" || ops.phase === "post";
    const tone = ops.holding ? C.amber : flying ? C.lime : ops.phase === "count" ? C.cyan : C.dim;
    header(ctx, W, "COUNTDOWN · MISSION ELAPSED TIME", ops.mission ? ops.mission.toUpperCase().slice(0, 34) : "NO MISSION IN WORK", tone, 40);
    const label = flying ? "MET" : ops.phase === "count" ? "T −" : "T −";
    const value = flying && f ? clock(f.t) : ops.phase === "count" ? clock(ops.tMinus) : "--:--:--";
    ctx.font = mono(48, 700);
    ctx.fillStyle = C.dim;
    ctx.fillText(label, 34, 160);
    ctx.font = mono(150, 700);
    ctx.fillStyle = tone;


    ctx.fillText(value, 140, 190);

    const status = ops.phase === "count" ? (ops.holding ? "HOLDING" : "COUNTING") : flying ? (ops.phase === "post" ? (ops.result === "success" ? "MISSION SUCCESS" : ops.result.toUpperCase()) : "IN FLIGHT") : "STANDBY";
    ctx.fillStyle = tone;
    ctx.fillRect(34, 230, 300, 52);
    ctx.font = mono(28, 800);
    ctx.fillStyle = C.bg;
    ctx.fillText(status, 48, 266);
    ctx.font = mono(20, 500);
    ctx.fillStyle = C.text;
    ctx.fillText(ops.holding ? ops.hold.toUpperCase().slice(0, 52) : "", 350, 264);
    const site = siteById[(mc.pending?.draft ?? s.draft).site];
    const zone = (tz: string) => {
      try {
        return O.dateOf(mc.jd).toLocaleTimeString("en-GB", { timeZone: tz, hour12: false });
      } catch {
        return "--:--:--";
      }
    };
    const cols: [string, string][] = [
      ["GMT", gmtStamp(mc.jd)],
      ["HOUSTON", zone("America/Chicago")],
      [site.short, zone(site.tz)],
      ["WARP", `×${fmtN(WARPS[s.warp])}`],
    ];
    cols.forEach(([k, v], i) => {
      const x = 34 + i * 246;
      ctx.font = mono(16, 600);
      ctx.fillStyle = C.dim;
      ctx.fillText(k, x, 330);
      ctx.font = mono(34, 700);
      ctx.fillStyle = k === "WARP" && s.warp > 0 ? C.amber : C.text;
      ctx.fillText(v, x, 372);
    });
    // next event
    const tl = s.timeline.find((e) => !e.done);
    ctx.font = mono(18, 600);
    ctx.fillStyle = C.dim;
    ctx.fillText("NEXT", 34, 430);
    ctx.fillStyle = C.text;
    const next = ops.phase === "count" ? countNext(ops.tMinus) : tl && f ? `${tl.label.toUpperCase()} IN ${clock(Math.max(0, tl.t - f.t))}` : "—";
    ctx.fillText(next.slice(0, 70), 100, 430);
  }

  private drawVehicle(ctx: CanvasRenderingContext2D, W: number, H: number, time: number) {
    const s = useMC.getState();
    const f = mc.flight;
    const veh: Vehicle = vehicleById[(mc.pending?.draft ?? s.draft).vehicle];
    ctx.fillStyle = C.bg;
    ctx.fillRect(0, 0, W, H);
    header(ctx, W, `BOOSTER · ${veh.name.toUpperCase()}`, veh.maker.toUpperCase(), C.cyan, 40);
    const props = f ? [veh.boosters ? f.bProp / veh.boosters.prop : 0, f.cProp / veh.stages[0].prop, f.uProp / veh.stages[1].prop] : [1, 1, 1];
    const lit = f ? [f.thrB > 0 && f.bOn, f.thrC > 0 && f.cOn, f.thrU > 0 && f.uOn] : [false, false, false];
    const on = f ? [f.bOn, f.cOn, f.uOn] : [true, true, true];
    // stack schematic
    const bx = 60, by = 70, bw = 120;
    const stack: { name: string; h: number; i: number }[] = [
      { name: veh.fairing ? (veh.crewRated && payloadCrew() ? "LES / CREW" : "FAIRING") : "PAYLOAD", h: 50, i: -1 },
      { name: veh.stages[1].name.toUpperCase(), h: 90, i: 2 },
      { name: veh.stages[0].name.toUpperCase(), h: 200, i: 1 },
    ];
    let y = by;
    for (const st of stack) {
      const attached = st.i < 0 ? !f || f.fairingOn || veh.fairing === 0 : on[st.i];
      ctx.strokeStyle = attached ? C.text : C.faint;
      ctx.lineWidth = 2;
      if (st.i < 0) {
        ctx.beginPath();
        ctx.moveTo(bx, y + st.h);
        ctx.quadraticCurveTo(bx, y, bx + bw / 2, y);
        ctx.quadraticCurveTo(bx + bw, y, bx + bw, y + st.h);
        ctx.closePath();
        ctx.stroke();
      } else {
        ctx.strokeRect(bx, y, bw, st.h);
        const p = props[st.i];
        ctx.fillStyle = attached ? (lit[st.i] ? "rgba(200,255,61,0.55)" : "rgba(79,209,255,0.35)") : "rgba(60,86,112,0.2)";
        ctx.fillRect(bx + 4, y + 4 + (st.h - 8) * (1 - p), bw - 8, (st.h - 8) * p);
        ctx.font = mono(14, 700);
        ctx.fillStyle = attached ? C.text : C.faint;
        ctx.fillText(`${(p * 100).toFixed(0)}%`, bx + bw + 10, y + st.h / 2 + 5);
      }
      ctx.font = mono(12, 600);
      ctx.fillStyle = attached ? C.dim : C.faint;
      ctx.fillText(attached ? st.name.slice(0, 18) : `${st.name.slice(0, 12)} · SEP`, bx + bw + 10, y + 16);
      y += st.h + 6;
    }
    if (veh.boosters) {
      const b = veh.boosters;
      const p = props[0];
      for (const side of [-1, 1]) {
        const x = side < 0 ? bx - 44 : bx + bw + 14;
        const yy = by + 160;
        ctx.strokeStyle = on[0] ? C.text : C.faint;
        ctx.strokeRect(x, yy, 30, 190);
        ctx.fillStyle = on[0] ? (lit[0] ? "rgba(200,255,61,0.55)" : "rgba(79,209,255,0.35)") : "rgba(60,86,112,0.2)";
        ctx.fillRect(x + 3, yy + 3 + 184 * (1 - p), 24, 184 * p);
      }
      ctx.font = mono(12, 600);
      ctx.fillStyle = on[0] ? C.dim : C.faint;
      ctx.fillText(`${b.count}× ${b.engine}${on[0] ? "" : " · SEP"}`, bx - 44, by + 370);
    }
    // engines
    const ex = 420, ey = 80;
    ctx.font = mono(14, 700);
    ctx.fillStyle = C.text;
    ctx.fillText(`${veh.stages[0].engines}× ${veh.stages[0].engine.toUpperCase()}`, ex, ey);
    const engs = layout(veh.stages[0].layout, veh.stages[0].engines);
    const cx = ex + 120, cy = ey + 130, R = 100;
    ctx.beginPath();
    ctx.arc(cx, cy, R + 8, 0, Math.PI * 2);
    ctx.strokeStyle = C.line;
    ctx.stroke();
    const out = f && f.cEngines < veh.stages[0].engines;
    engs.forEach(([x, y2], i) => {
      const dead = out && i === engs.length - 2;
      const flick = 0.85 + 0.15 * Math.sin(time * 30 + i * 2.3);
      light(ctx, cx + x * R, cy + y2 * R, engs.length > 20 ? 7 : engs.length > 8 ? 12 : 22, dead ? C.red : lit[1] ? (flick > 0.9 ? C.lime : "#b5f03a") : "#20384f", lit[1] || !!dead);
    });
    // upper stage engine
    ctx.font = mono(14, 700);
    ctx.fillStyle = C.text;
    ctx.fillText(`${veh.stages[1].engines}× ${veh.stages[1].engine.toUpperCase()}`.slice(0, 26), ex, ey + 280);
    const e2 = layout(veh.stages[1].layout, veh.stages[1].engines);
    e2.forEach(([x, y2]) => light(ctx, ex + 60 + x * 40, ey + 330 + y2 * 40, e2.length > 2 ? 9 : 18, lit[2] ? C.lime : "#20384f", lit[2]));
    // numbers
    const nx = 700;
    let ny = 80;
    const rows: [string, string][] = f
      ? [
          ["THRUST", `${fmtN((f.fB + f.fC + f.fU) / 1000)} kN`],
          ["THROTTLE", `${(Math.max(f.thrB, f.thrC, f.thrU) * 100).toFixed(0)} %`],
          ["MASS", `${fmtN(f.mass / 1000, 1)} t`],
          ["T/W", ((f.fB + f.fC + f.fU) / (f.mass * 9.81)).toFixed(2)],
          ["CHAMBER P", `${(Math.max(f.thrC, f.thrU) * 97 + (lit[1] || lit[2] ? Math.sin(time * 9) : 0)).toFixed(1)} bar`],
          ["TURBOPUMP", `${fmtN(Math.max(f.thrC, f.thrU) * 36_000 + (lit[1] || lit[2] ? Math.sin(time * 5) * 80 : 0))} rpm`],
          ["LOX TANK", `${(lit[1] || lit[2] ? 3.4 + Math.sin(time) * 0.03 : on[1] ? 3.1 : 0).toFixed(2)} bar`],
          ["FUEL TANK", `${(lit[1] || lit[2] ? 3.0 + Math.sin(time * 1.3) * 0.03 : on[1] ? 2.8 : 0).toFixed(2)} bar`],
        ]
      : [
          ["HEIGHT", `${veh.height} m`],
          ["DIAMETER", `${veh.diameter} m`],
          ["LIFTOFF THRUST", `${fmtN(veh.stages[0].thrustSL + (veh.boosters ? veh.boosters.thrustSL * veh.boosters.count : 0))} kN`],
          ["PROPELLANT", `${fmtN((veh.stages[0].prop + veh.stages[1].prop + (veh.boosters ? veh.boosters.prop * veh.boosters.count : 0)) / 1000)} t`],
          ["ISP S1 / S2", `${veh.stages[0].ispVac} / ${veh.stages[1].ispVac} s`],
          ["FIRST FLIGHT", String(veh.firstFlight)],
          ["COST", veh.cost],
          ["STATUS", mc.pending ? (useMC.getState().ops.tMinus < 2100 ? "PROPELLANT LOADED" : "ON THE PAD") : "IN HANGAR"],
        ];
    for (const [k, v] of rows) {
      kv(ctx, nx, ny, 290, k, v, 18);
      ny += 34;
    }
    if (f && f.recov.length) {
      ny += 6;
      for (const b of f.recov.filter((r) => r.mode !== "expend").slice(0, 3)) {
        ctx.font = mono(13, 600);
        ctx.fillStyle = b.phase === "landed" ? C.lime : b.phase === "lost" ? C.red : C.amber;
        ctx.fillText(`${b.label.toUpperCase()}: ${b.phase.toUpperCase()}  ${fmtN(b.h / 1000, 1)} km`.slice(0, 40), nx, ny);
        ny += 20;
      }
    }
  }

  private drawWeather(ctx: CanvasRenderingContext2D, W: number, H: number) {
    const s = useMC.getState();
    const site = siteById[(mc.pending?.draft ?? s.draft).site];
    const w = weather(site, mc.jd, mc.badWeather);
    ctx.fillStyle = C.bg;
    ctx.fillRect(0, 0, W, H);
    header(ctx, W, `LAUNCH WEATHER · ${site.short} · ${site.place.toUpperCase()}`, w.go ? "GO" : "NO-GO", w.go ? C.lime : C.red, 40);
    ctx.font = mono(15, 600);
    ctx.fillStyle = C.dim;
    ctx.fillText("PROBABILITY OF VIOLATING CONSTRAINTS", 30, 82);
    ctx.font = mono(72, 800);
    ctx.fillStyle = w.pov <= 30 ? C.lime : w.pov <= 60 ? C.amber : C.red;
    ctx.fillText(`${w.pov}%`, 30, 158);
    let y = 200;
    for (const r of w.rules) {
      light(ctx, 40, y - 6, 7, r.ok ? C.lime : C.red);
      ctx.font = mono(16, 600);
      ctx.fillStyle = C.text;
      ctx.fillText(r.name.toUpperCase(), 60, y);
      ctx.textAlign = "right";
      ctx.fillStyle = r.ok ? C.dim : C.red;
      ctx.fillText(r.value.toUpperCase(), 480, y);
      ctx.textAlign = "left";
      y += 34;
    }
    light(ctx, 40, y - 6, 7, w.recoveryGo ? C.lime : C.amber);
    ctx.font = mono(16, 600);
    ctx.fillStyle = C.text;
    ctx.fillText("RECOVERY AREA SEA STATE", 60, y);
    ctx.textAlign = "right";
    ctx.fillStyle = w.recoveryGo ? C.dim : C.amber;
    ctx.fillText(`${w.sea.toFixed(1)} M`, 480, y);
    ctx.textAlign = "left";
    // observations
    const ox = 540;
    let oy = 82;
    const obs: [string, string][] = [
      ["TEMPERATURE", `${w.temp.toFixed(1)} °C`],
      ["WIND", `${String(w.dir).padStart(3, "0")}° / ${w.wind.toFixed(0)} kt G${w.gust.toFixed(0)}`],
      ["CEILING", `${fmtN(w.ceiling)} ft`],
      ["VISIBILITY", `${w.vis.toFixed(0)} mi`],
      ["HUMIDITY", `${w.humidity.toFixed(0)} %`],
      ["PRESSURE", `${w.pressure.toFixed(1)} hPa`],
    ];
    for (const [k, v] of obs) {
      kv(ctx, ox, oy, 450, k, v, 18);
      oy += 32;
    }
    // upper-level winds profile
    oy += 10;
    ctx.font = mono(13, 600);
    ctx.fillStyle = C.dim;
    ctx.fillText("UPPER-LEVEL WINDS (kt)  0 → 60 km", ox, oy);
    oy += 12;
    const bars = 16;
    for (let k = 0; k < bars; k++) {
      const alt = k / (bars - 1);
      const v = w.wind * (1 + 6 * Math.exp(-((alt - 0.2) ** 2) / 0.012)) * (0.4 + 0.6 * (w.shear / 100));
      const bw = Math.min(450, v * 2.6);
      ctx.fillStyle = v > 110 ? C.red : v > 80 ? C.amber : C.cyan;
      ctx.fillRect(ox, oy + k * 8, bw, 6);
    }
  }

  private drawDsn(ctx: CanvasRenderingContext2D, W: number, H: number, t: number) {
    ctx.fillStyle = C.bg;
    ctx.fillRect(0, 0, W, H);
    header(ctx, W, "DEEP SPACE NETWORK · NOW", `${this.links.filter((l) => l.station.net === "DSN").length} LINKS · NEN ${this.links.filter((l) => l.station.net !== "DSN").length}`, C.mag, 40);
    const dsn = STATIONS.filter((s) => s.net === "DSN");
    const cw = (W - 40) / 3;
    dsn.forEach((st, i) => {
      const x = 20 + i * cw;
      const links = this.links.filter((l) => l.station.id === st.id).sort((a, b) => b.range - a.range);
      ctx.fillStyle = C.panel;
      ctx.fillRect(x, 54, cw - 12, H - 66);
      ctx.font = sans(24, 700);
      ctx.fillStyle = C.text;
      ctx.fillText(st.short.toUpperCase(), x + 14, 86);
      ctx.font = mono(12, 500);
      ctx.fillStyle = C.dim;
      ctx.fillText(`${Math.abs(st.lat).toFixed(1)}°${st.lat > 0 ? "N" : "S"} ${Math.abs(st.lon).toFixed(1)}°${st.lon > 0 ? "E" : "W"}`, x + 14, 106);
      st.dishes.forEach((d, k) => {
        const y = 130 + k * 78;
        const l = links[k];
        // dish glyph
        const gx = x + 30, gy = y + 26;
        ctx.strokeStyle = l ? C.mag : C.faint;
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        ctx.arc(gx, gy - 6, 16, Math.PI * 0.15, Math.PI * 0.85);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(gx, gy + 4);
        ctx.lineTo(gx, gy + 18);
        ctx.stroke();
        if (l) {
          for (let w = 0; w < 3; w++) {
            const ph = ((t * 0.8 + w / 3) % 1);
            ctx.strokeStyle = `rgba(255,111,177,${0.6 * (1 - ph)})`;
            ctx.beginPath();
            ctx.arc(gx, gy - 14, 8 + ph * 30, -Math.PI * 0.75, -Math.PI * 0.25);
            ctx.stroke();
          }
        }
        ctx.font = mono(13, 700);
        ctx.fillStyle = C.dim;
        ctx.fillText(d, x + 62, y + 14);
        ctx.font = mono(15, 700);
        ctx.fillStyle = l ? C.text : C.faint;
        ctx.fillText(l ? l.sat.name.split(" (")[0].toUpperCase().slice(0, 20) : "IDLE", x + 62, y + 34);
        if (l) {
          ctx.font = mono(12, 500);
          ctx.fillStyle = C.mag;
          const rate = l.rate > 1e6 ? `${(l.rate / 1e6).toFixed(1)} Mb/s` : l.rate > 1e3 ? `${(l.rate / 1e3).toFixed(1)} kb/s` : `${l.rate.toFixed(0)} b/s`;
          const rtlt = l.rtlt > 3600 ? `${(l.rtlt / 3600).toFixed(1)} h` : l.rtlt > 60 ? `${(l.rtlt / 60).toFixed(1)} min` : `${l.rtlt.toFixed(1)} s`;
          ctx.fillText(`${l.band} ${rate} · RTLT ${rtlt}`, x + 62, y + 52);
        }
      });
    });
  }

  private drawFleet(ctx: CanvasRenderingContext2D, W: number, H: number) {
    const s = useMC.getState();
    ctx.fillStyle = C.bg;
    ctx.fillRect(0, 0, W, H);
    const live = s.fleet.filter((x) => x.status !== "reentered" && x.kind !== "constellation");
    const ours = live.filter((x) => x.owner === "ours");
    header(ctx, W, "SPACECRAFT STATUS", `${ours.length} OURS · ${live.length - ours.length} TRACKED`, C.gold, 40);
    const rows = [...ours, ...live.filter((x) => x.owner !== "ours")].slice(0, 13);
    ctx.font = mono(13, 700);
    ctx.fillStyle = C.dim;
    const cols = [20, 330, 610, 720];
    ["SPACECRAFT", "ORBIT", "INC", "STATUS"].forEach((h, i) => ctx.fillText(h, cols[i], 70));
    rows.forEach((sat, k) => {
      const y = 100 + k * 27;
      if (sat.id === s.selected) {
        ctx.fillStyle = "rgba(200,255,61,0.12)";
        ctx.fillRect(10, y - 18, W - 20, 25);
      }
      ctx.fillStyle = sat.color;
      ctx.fillRect(cols[0], y - 11, 6, 12);
      ctx.font = mono(15, sat.owner === "ours" ? 700 : 500);
      ctx.fillStyle = sat.owner === "ours" ? C.text : C.dim;
      ctx.fillText(sat.name.slice(0, 26), cols[0] + 14, y);
      const el = sat.el;
      const orbit = el && el.e < 1 && sat.status !== "cruise" && sat.status !== "arrived" && sat.status !== "lunar" && sat.status !== "l2" ? `${fmtN(O.periapsis(el))} × ${fmtN(O.apoapsis(el))} km` : (sat.where ?? "Deep space").slice(0, 22);
      ctx.fillText(orbit, cols[1], y);
      ctx.fillText(el && el.e < 1 ? `${(el.i / O.DEG).toFixed(1)}°` : "—", cols[2], y);
      ctx.fillStyle = sat.status === "safe" ? C.amber : sat.burns.length ? C.amber : sat.owner === "ours" ? C.lime : C.dim;
      ctx.fillText((sat.burns.length ? `BURN IN ${clock((sat.burns[0].at - mc.jd) * 86400)}` : sat.status.toUpperCase()).slice(0, 20), cols[3], y);
    });
  }

  private drawFeedBar(ctx: CanvasRenderingContext2D, W: number, H: number) {
    const s = useMC.getState();
    const f = mc.flight;
    ctx.fillStyle = "#050a10";
    ctx.fillRect(0, 0, W, H);
    const live = s.ops.phase !== "idle";
    light(ctx, 30, H / 2, 9, live ? C.red : C.faint, live);
    ctx.font = mono(26, 800);
    ctx.fillStyle = C.text;
    ctx.textBaseline = "middle";
    const cam = feedName(s.feedCam, f);
    ctx.fillText(`${live ? "LIVE" : "PAD CAM"} · ${cam}`, 56, H / 2);
    ctx.textAlign = "right";
    ctx.fillStyle = C.lime;
    ctx.fillText(f ? `${fmtT(f.t)}   ${fmtN(f.alt / 1000, 1)} KM   ${fmtN((s.tele?.vs ?? 0) * 3.6)} KM/H` : s.ops.phase === "count" ? `T−${clock(s.ops.tMinus)}` : siteById[s.draft.site].name.toUpperCase(), W - 20, H / 2);
    ctx.textAlign = "left";
    ctx.textBaseline = "alphabetic";
  }

  private drawOrbitBar(ctx: CanvasRenderingContext2D, W: number, H: number) {
    const s = useMC.getState();
    ctx.fillStyle = "#0a1826";
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = C.cyan;
    ctx.fillRect(0, H - 2, W, 2);
    ctx.fillRect(10, 10, 6, H - 20);
    ctx.font = mono(22, 700);
    ctx.textBaseline = "middle";
    ctx.fillStyle = C.text;
    ctx.fillText("ORBIT VIEW · ECI J2000", 26, H / 2);
    ctx.textAlign = "right";
    ctx.fillStyle = C.dim;
    const sel = s.fleet.find((x) => x.id === s.selected);
    ctx.fillText(sel ? sel.name.toUpperCase().slice(0, 30) : "ALL OBJECTS", W - 12, H / 2);
    ctx.textAlign = "left";
    ctx.textBaseline = "alphabetic";
  }

  // ———————————————————————————— console monitors ————————————————————————————

  private strip: number[][] = [[], [], [], []];
  private drawConsole(i: number, ctx: CanvasRenderingContext2D, W: number, H: number, t: number) {
    const s = useMC.getState();
    const f = mc.flight;
    ctx.fillStyle = "#03080e";
    ctx.fillRect(0, 0, W, H);
    const pos = POSITIONS[(i * 3 + 1) % POSITIONS.length];
    const tele = s.tele;
    const live = !!f && s.ops.phase !== "idle";
    if (i === 0) {
      header(ctx, W, `${pos.id} · TELEMETRY`, gmtStamp(mc.jd).slice(4), C.cyan, 26);
      const rows: [string, string][] = [
        ["BUS A VOLTS", (28.1 + Math.sin(t * 1.3) * 0.05).toFixed(2)],
        ["BUS B VOLTS", (28.0 + Math.sin(t * 1.1 + 1) * 0.05).toFixed(2)],
        ["AVIONICS TEMP", `${(31.2 + Math.sin(t * 0.2) * 0.4).toFixed(1)} C`],
        ["GN2 PRESS", `${(4140 - (live ? (tele?.met ?? 0) * 0.8 : 0)).toFixed(0)} psi`],
        ["IMU STATUS", mc.guidanceFail && live ? "FAIL" : "NOMINAL"],
        ["FTS ARMED", s.ops.phase === "idle" ? "SAFE" : "ARMED"],
        ["ALT", live ? `${fmtN(tele?.alt ?? 0, 2)} km` : "0.00 km"],
        ["VEL", live ? `${fmtN(tele?.vel ?? 0, 1)} m/s` : "0.0 m/s"],
        ["THROTTLE", live ? `${((tele?.thr ?? 0) * 100).toFixed(0)} %` : "0 %"],
      ];
      rows.forEach(([k, v], j) => {
        const y = 52 + j * 29;
        ctx.font = mono(15, 500);
        ctx.fillStyle = C.dim;
        ctx.fillText(k, 14, y);
        ctx.font = mono(17, 700);
        ctx.fillStyle = v === "FAIL" ? C.red : v === "ARMED" ? C.amber : C.lime;
        ctx.textAlign = "right";
        ctx.fillText(v, W - 14, y);
        ctx.textAlign = "left";
      });
    } else if (i === 1) {
      header(ctx, W, "STRIP CHART", live ? fmtT(f!.t) : "STBY", C.lime, 26);
      const vals = live && tele ? [tele.alt / 200, tele.vel / 8000, tele.q / 40, tele.acc / 6] : [0.5 + Math.sin(t) * 0.02, 0.3 + Math.sin(t * 1.7) * 0.02, 0.6 + Math.sin(t * 0.7) * 0.03, 0.4 + Math.sin(t * 2.1) * 0.02];
      const colors = [C.lime, C.cyan, C.amber, C.mag];
      this.strip.forEach((arr, k) => {
        arr.push(vals[k]);
        if (arr.length > 120) arr.shift();
        ctx.beginPath();
        arr.forEach((v, j) => {
          const x = (j / 120) * W;
          const y = 40 + (H - 60) * (k * 0.25 + 0.22 - Math.min(1, v) * 0.2);
          if (j) ctx.lineTo(x, y);
          else ctx.moveTo(x, y);
        });
        ctx.strokeStyle = colors[k];
        ctx.lineWidth = 2;
        ctx.stroke();
        ctx.font = mono(11, 600);
        ctx.fillStyle = colors[k];
        ctx.fillText(["ALT", "VEL", "Q", "ACC"][k], 6, 40 + (H - 60) * (k * 0.25 + 0.05));
      });
    } else if (i === 2) {
      header(ctx, W, "PROPULSION SCHEMATIC", "", C.amber, 26);
      const thr = live ? tele?.thr ?? 0 : 0;
      ctx.lineWidth = 3;
      const pipe = (x1: number, y1: number, x2: number, y2: number, flow: boolean) => {
        ctx.strokeStyle = flow ? C.lime : C.faint;
        ctx.setLineDash(flow ? [10, 8] : []);
        ctx.lineDashOffset = -t * 40;
        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
        ctx.stroke();
        ctx.setLineDash([]);
      };
      ctx.strokeStyle = C.text;
      ctx.strokeRect(60, 60, 110, 90);
      ctx.strokeRect(330, 60, 110, 90);
      ctx.font = mono(14, 700);
      ctx.fillStyle = C.text;
      ctx.fillText("LOX", 95, 110);
      ctx.fillText("FUEL", 362, 110);
      pipe(115, 150, 115, 220, thr > 0);
      pipe(385, 150, 385, 220, thr > 0);
      pipe(115, 220, 220, 250, thr > 0);
      pipe(385, 220, 280, 250, thr > 0);
      ctx.beginPath();
      ctx.moveTo(220, 250);
      ctx.lineTo(280, 250);
      ctx.lineTo(300, 300);
      ctx.lineTo(200, 300);
      ctx.closePath();
      ctx.strokeStyle = thr > 0 ? C.lime : C.text;
      ctx.stroke();
      [115, 385].forEach((x) => light(ctx, x, 185, 7, thr > 0 ? C.lime : C.amber));
      ctx.font = mono(13, 600);
      ctx.fillStyle = C.dim;
      ctx.fillText(`MAIN VALVES ${thr > 0 ? "OPEN" : "CLOSED"}`, 290, 290);
    } else if (i === 3) {
      header(ctx, W, "GROUND TRACK", "", C.cyan, 26);
      const map = this.surfaces.get("map");
      if (map) {
        const mh = map.canvas.height - 40;
        ctx.drawImage(map.canvas, 0, 40, mh * 2, mh, 0, 30, W, H - 30);
      }
    } else if (i === 4) {
      header(ctx, W, "FLIGHT DIRECTOR LOOP", "", C.gold, 26);
      const lines = s.loop.slice(-9);
      lines.forEach((l, j) => {
        ctx.font = mono(13, 700);
        ctx.fillStyle = l.tone === "bad" ? C.red : l.tone === "warn" ? C.amber : l.tone === "good" ? C.lime : C.gold;
        ctx.fillText(String(l.who).slice(0, 8), 10, 50 + j * 30);
        ctx.font = mono(13, 500);
        ctx.fillStyle = C.text;
        ctx.fillText(l.text.slice(0, 50), 86, 50 + j * 30);
      });
    } else {
      header(ctx, W, "PROCEDURES", s.ops.phase.toUpperCase(), C.lime, 26);
      const steps = ["Console checkout", "Range conflict check", "Weather brief", "Propellant load poll", "Engine chill", "Terminal count", "Liftoff", "Orbit insertion", "Spacecraft separation"];
      const tm = s.ops.tMinus;
      const done = s.ops.phase === "idle" ? 1 : s.ops.phase === "count" ? (tm > 2280 ? 3 : tm > 420 ? 4 : tm > 60 ? 5 : 6) : s.ops.phase === "flight" ? (f?.phase === "deployed" ? 9 : f && f.alt > 120_000 ? 7 : 7) : 9;
      steps.forEach((st, j) => {
        const y = 52 + j * 29;
        ctx.font = mono(15, j < done ? 600 : 500);
        ctx.fillStyle = j < done ? C.lime : j === done ? C.amber : C.faint;
        ctx.fillText(`${j < done ? "✓" : j === done ? "▸" : "·"} ${st}`, 14, y);
      });
    }
  }
}

function countNext(t: number) {
  const ev = [
    [2280, "PROPELLANT LOAD POLL"], [2100, "FUEL LOAD"], [960, "STAGE 2 LOX LOAD"], [420, "ENGINE CHILL"], [60, "STARTUP"], [45, "GO FOR LAUNCH"], [3, "IGNITION"], [0, "LIFTOFF"],
  ] as const;
  const n = ev.find(([k]) => k < t);
  return n ? `${n[1]} AT T−${clock(n[0])}` : "LIFTOFF";
}

function payloadCrew() {
  const d = mc.pending?.draft ?? useMC.getState().draft;
  return d.payload === "crew" || d.payload === "artemis";
}

export function feedName(cam: string, f: typeof mc.flight) {
  const c = cam === "auto" ? autoCam(f) : cam;
  return c === "pad" ? "PAD CAMERA" : c === "tracking" ? "LONG-RANGE TRACKING" : c === "onboard" ? "UPPER STAGE ONBOARD" : "BOOSTER ONBOARD";
}

/** what a webcast director would cut to */
export function autoCam(f: typeof mc.flight): "pad" | "tracking" | "onboard" | "booster" {
  if (!f) return "pad";
  if (f.t < 4) return "pad";
  const b = f.recov.find((r) => r.mode !== "expend" && !r.done);
  if (b && b.phase === "landing") return "booster";
  if (b && b.h < 12_000 && b.phase !== "coast") return "booster";
  if (f.alt < 55_000 && f.cOn) return "tracking";
  return "onboard";
}

/** engine positions in a unit disc */
function layout(kind: string, n: number): [number, number][] {
  const ring = (k: number, r: number, off = 0): [number, number][] => Array.from({ length: k }, (_, i) => [Math.cos(off + (i / k) * Math.PI * 2) * r, Math.sin(off + (i / k) * Math.PI * 2) * r]);
  if (kind === "f9") return [...ring(8, 0.72), [0, 0]];
  if (kind === "raptor33") return [...ring(20, 0.85), ...ring(10, 0.5), ...ring(3, 0.16)];
  if (kind === "rs25") return ring(4, 0.5, Math.PI / 4);
  if (kind === "ship6") return [...ring(3, 0.2), ...ring(3, 0.65, Math.PI / 3)];
  if (kind === "rd180" || kind === "twin") return [[-0.3, 0], [0.3, 0]];
  if (kind === "rd107") return ring(4, 0.42, Math.PI / 4);
  if (kind === "electron9") return [...ring(8, 0.7), [0, 0]];
  if (n <= 1) return [[0, 0]];
  return ring(n, 0.6);
}
