/**
 * The launch video feed: its own scene, rendered into an HDR texture that the front wall shows.
 *
 * The scene is built in the pad's local east-north-up frame (x east, y up, −z north) in metres and
 * draws with a floating origin around whatever the camera is looking at, so a vehicle 2,000 km
 * downrange is as steady as one on the pad. The flight is read straight from the simulator: the
 * same state vectors, staging, plume back-pressure and recovered boosters.
 */

import * as THREE from "three";
import { siteById, vehicleById, type Site, type Vehicle } from "./data";
import { NOISE } from "./earth";
import { mc, weather } from "./engine";
import type { Flight, Returner } from "./flight";
import * as O from "./orbit";
import { autoCam } from "./screens";
import { useMC } from "./store";

const RE = O.RE * 1000;
const D2R = Math.PI / 180;

// ———————————————————————————— frame helpers ————————————————————————————

type Frame = { E: O.V3; N: O.V3; U: O.V3; site: O.V3 };
function padFrame(site: Site): Frame {
  const la = site.lat * D2R, lo = site.lon * D2R;
  return {
    E: O.v3(-Math.sin(lo), Math.cos(lo), 0),
    N: O.v3(-Math.sin(la) * Math.cos(lo), -Math.sin(la) * Math.sin(lo), Math.cos(la)),
    U: O.v3(Math.cos(la) * Math.cos(lo), Math.cos(la) * Math.sin(lo), Math.sin(la)),
    site: O.v3(RE * Math.cos(la) * Math.cos(lo), RE * Math.cos(la) * Math.sin(lo), RE * Math.sin(la)),
  };
}
/** ECI (m) at jd → local pad frame (m), as doubles */
function toLocal(fr: Frame, r: O.V3, jd: number, out: THREE.Vector3) {
  const e = O.eciToEcef(r, jd);
  const d = O.sub(e, fr.site);
  return out.set(O.dot(d, fr.E), O.dot(d, fr.U), -O.dot(d, fr.N));
}
function dirLocal(fr: Frame, v: O.V3, jd: number, out: THREE.Vector3) {
  const e = O.eciToEcef(v, jd);
  return out.set(O.dot(e, fr.E), O.dot(e, fr.U), -O.dot(e, fr.N)).normalize();
}

// ———————————————————————————— materials and textures ————————————————————————————

function canvasTex(w: number, h: number, draw: (c: CanvasRenderingContext2D) => void, srgb = true) {
  const cv = document.createElement("canvas");
  cv.width = w;
  cv.height = h;
  draw(cv.getContext("2d")!);
  const t = new THREE.CanvasTexture(cv);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  return t;
}

/**
 * A cauliflower puff: a cluster of soft lobes. Alpha is the density; red is how much the top-left
 * of each lobe faces the light, so a billboard reads as a lit, rounded cumulus and not a disc.
 */
const smokeTex = () =>
  canvasTex(256, 256, (c) => {
    const S = 256;
    const dens = new Float32Array(S * S);
    const lit = new Float32Array(S * S);
    const lobes: [number, number, number][] = [[128, 136, 70]];
    for (let i = 0; i < 26; i++) {
      const a = Math.random() * Math.PI * 2, r = 20 + Math.random() * 52;
      lobes.push([128 + Math.cos(a) * r, 132 + Math.sin(a) * r * 0.9, 18 + Math.random() * 30]);
    }
    for (const [lx, ly, lr] of lobes) {
      const x0 = Math.max(0, Math.floor(lx - lr)), x1 = Math.min(S - 1, Math.ceil(lx + lr));
      const y0 = Math.max(0, Math.floor(ly - lr)), y1 = Math.min(S - 1, Math.ceil(ly + lr));
      for (let y = y0; y <= y1; y++)
        for (let x = x0; x <= x1; x++) {
          const dx = (x - lx) / lr, dy = (y - ly) / lr;
          const d2 = dx * dx + dy * dy;
          if (d2 >= 1) continue;
          const k = y * S + x;
          const v = (1 - d2) * (1 - d2);
          dens[k] = Math.min(1, dens[k] + v * 0.75);
          // sphere normal facing up and a little toward the viewer
          const nz = Math.sqrt(1 - d2);
          lit[k] = Math.max(lit[k], (-dy * 0.75 + nz * 0.55 - dx * 0.15) * 0.5 + 0.5);
        }
    }
    const img = c.createImageData(S, S);
    for (let y = 0; y < S; y++)
      for (let x = 0; x < S; x++) {
        const k = y * S + x;
        const r = Math.hypot(x - 128, y - 128) / 128;
        const edge = Math.max(0, 1 - Math.pow(r, 3));
        const grain = 0.85 + Math.random() * 0.15;
        img.data[k * 4] = Math.round(255 * Math.min(1, lit[k] * grain));
        img.data[k * 4 + 1] = img.data[k * 4 + 2] = 255;
        img.data[k * 4 + 3] = Math.round(255 * Math.min(1, dens[k] * edge * 1.15));
      }
    c.putImageData(img, 0, 0);
  }, false);

/** soft radial glow for lamps and plume flare */
const glowTex = () =>
  canvasTex(128, 128, (c) => {
    const g = c.createRadialGradient(64, 64, 0, 64, 64, 64);
    g.addColorStop(0, "rgba(255,255,255,1)");
    g.addColorStop(0.12, "rgba(255,255,255,0.55)");
    g.addColorStop(0.4, "rgba(255,255,255,0.12)");
    g.addColorStop(1, "rgba(255,255,255,0)");
    c.fillStyle = g;
    c.fillRect(0, 0, 128, 128);
  }, false);

/** painted stage skin: panel seams, stringer shading, a name down the side and (optionally) flight soot */
function skinTex(base: string, opts: { soot?: boolean; text?: string; textColor?: string; seams?: number } = {}) {
  return canvasTex(512, 2048, (c) => {
    c.fillStyle = base;
    c.fillRect(0, 0, 512, 2048);
    // stringers: faint vertical shading
    for (let x = 0; x < 512; x += 16) {
      c.fillStyle = `rgba(0,0,0,${0.015 + Math.random() * 0.02})`;
      c.fillRect(x, 0, 2, 2048);
    }
    // barrel-section welds
    const seams = opts.seams ?? 9;
    for (let i = 1; i < seams; i++) {
      const y = (i / seams) * 2048;
      c.fillStyle = "rgba(0,0,0,0.13)";
      c.fillRect(0, y, 512, 3);
      c.fillStyle = "rgba(255,255,255,0.08)";
      c.fillRect(0, y + 3, 512, 2);
    }
    // a raceway (cable tunnel) down one side
    c.fillStyle = "rgba(0,0,0,0.1)";
    c.fillRect(380, 0, 18, 2048);
    c.fillStyle = "rgba(255,255,255,0.08)";
    c.fillRect(380, 0, 3, 2048);
    if (opts.text) {
      c.save();
      c.translate(128, 1650);
      c.rotate(-Math.PI / 2);
      c.fillStyle = opts.textColor ?? "#1b1d22";
      c.font = "bold 92px Arial, Helvetica, sans-serif";
      c.textBaseline = "middle";
      c.fillText(opts.text, 0, 0);
      c.restore();
    }
    if (opts.soot) {
      // a flown booster: soot streaks up from the engines and down from the interstage
      const g = c.createLinearGradient(0, 2048, 0, 1100);
      g.addColorStop(0, "rgba(28,24,20,0.92)");
      g.addColorStop(0.35, "rgba(40,34,28,0.45)");
      g.addColorStop(1, "rgba(40,34,28,0)");
      c.fillStyle = g;
      c.fillRect(0, 0, 512, 2048);
      for (let i = 0; i < 90; i++) {
        const x = Math.random() * 512, len = 200 + Math.random() * 900;
        const gs = c.createLinearGradient(0, 2048, 0, 2048 - len);
        gs.addColorStop(0, `rgba(20,16,12,${0.15 + Math.random() * 0.3})`);
        gs.addColorStop(1, "rgba(20,16,12,0)");
        c.fillStyle = gs;
        c.fillRect(x, 2048 - len, 4 + Math.random() * 14, len);
      }
      const top = c.createLinearGradient(0, 0, 0, 380);
      top.addColorStop(0, "rgba(30,26,22,0.5)");
      top.addColorStop(1, "rgba(30,26,22,0)");
      c.fillStyle = top;
      c.fillRect(0, 0, 512, 380);
    }
  });
}

const landingTex = (kind: "asds" | "lz") =>
  canvasTex(512, 512, (c) => {
    c.fillStyle = kind === "asds" ? "#2b2f33" : "#8d8a83";
    c.fillRect(0, 0, 512, 512);
    for (let i = 0; i < 1800; i++) {
      c.fillStyle = `rgba(${Math.random() > 0.5 ? "255,255,255" : "0,0,0"},${Math.random() * 0.05})`;
      c.fillRect(Math.random() * 512, Math.random() * 512, 3, 3);
    }
    c.strokeStyle = kind === "asds" ? "#f2f2f2" : "#f2f2f2";
    c.lineWidth = 16;
    c.beginPath();
    c.arc(256, 256, 190, 0, Math.PI * 2);
    c.stroke();
    c.lineWidth = 22;
    c.beginPath();
    c.moveTo(150, 150);
    c.lineTo(362, 362);
    c.moveTo(362, 150);
    c.lineTo(150, 362);
    c.stroke();
  });

// ———————————————————————————— vehicles ————————————————————————————

export type VehicleModel = {
  root: THREE.Group;
  core: THREE.Group;
  upper: THREE.Group;
  boosters: THREE.Group[];
  fairing: THREE.Mesh[];
  coreLen: number;
  upperBase: number;
  upperLen: number;
  topY: number;
  nozzleUpper: THREE.Mesh | null;
  legs: THREE.Mesh[];
  fins: THREE.Mesh[];
};

function lathe(profile: [number, number][], mat: THREE.Material, seg = 40) {
  return new THREE.Mesh(new THREE.LatheGeometry(profile.map(([r, y]) => new THREE.Vector2(r, y)), seg), mat);
}
function cyl(r: number, h: number, mat: THREE.Material, y0: number, rTop = r, seg = 40) {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(rTop, r, h, seg, 1), mat);
  m.position.y = y0 + h / 2;
  return m;
}
function ogive(r: number, h: number, y0: number, mat: THREE.Material, tipR = 0.05) {
  const pts: [number, number][] = [];
  for (let k = 0; k <= 16; k++) {
    const f = k / 16;
    pts.push([tipR + (r - tipR) * Math.sqrt(1 - f * f) ** 0.9, y0 + f * h]);
  }
  pts.push([0, y0 + h]);
  return lathe([[0, y0], ...pts], mat);
}
function nozzle(rExit: number, len: number, mat: THREE.Material) {
  const m = lathe([[rExit * 0.35, 0], [rExit * 0.42, -len * 0.25], [rExit * 0.7, -len * 0.6], [rExit, -len], [rExit * 0.97, -len]], mat, 48);
  return m;
}

function stdMat(color: string, rough = 0.55, metal = 0.05, extra: Partial<THREE.MeshStandardMaterialParameters> = {}) {
  return new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal, ...extra });
}

/**
 * The radiatively cooled vacuum bell (lathe v runs throat → exit, i.e. canvas bottom → top): the
 * regeneratively cooled throat stays dark, the extension glows hottest just below it and cools to a
 * dull cherry red at the lip.
 */
function nozzleGlowTex() {
  return canvasTex(64, 256, (c) => {
    const g = c.createLinearGradient(0, 256, 0, 0);
    g.addColorStop(0, "#000000");
    g.addColorStop(0.18, "#120200");
    g.addColorStop(0.3, "#d8561a");
    g.addColorStop(0.55, "#b23206");
    g.addColorStop(1, "#420800");
    c.fillStyle = g;
    c.fillRect(0, 0, 64, 256);
  });
}

export function buildVehicle(v: Vehicle, crewed: boolean, flown = false): VehicleModel {
  const root = new THREE.Group();
  const core = new THREE.Group();
  const upper = new THREE.Group();
  root.add(core, upper);
  const boosters: THREE.Group[] = [];
  const fairing: THREE.Mesh[] = [];
  const legs: THREE.Mesh[] = [];
  const fins: THREE.Mesh[] = [];
  const P = v.paint;
  const body = P.metal ? stdMat(P.body, 0.38, 0.85) : new THREE.MeshStandardMaterial({ map: skinTex(P.body, { seams: 5 }), roughness: 0.55, metalness: 0.05 });
  // the stages that have a name painted on them, and the booster that has flown before
  const label = v.kit === "f9" || v.kit === "fh" ? v.name.replace(/ Block \d+/, "").toUpperCase() : "";
  const stage1 = P.metal ? body : new THREE.MeshStandardMaterial({ map: skinTex(P.body, { soot: flown, text: label, seams: 9 }), roughness: flown ? 0.7 : 0.55, metalness: 0.05 });
  const inter = stdMat(P.inter, 0.6, P.metal ? 0.8 : 0.1);
  const accent = stdMat(P.accent, 0.5);
  const dark = stdMat("#1b1c1e", 0.7, 0.2);
  // bells are open shells: render both faces so you can see into them
  const engineMat = stdMat("#3a3532", 0.35, 0.85, { side: THREE.DoubleSide });
  const nozzleMat = new THREE.MeshStandardMaterial({ color: "#2b2725", roughness: 0.6, metalness: 0.7, emissive: new THREE.Color("#ffffff"), emissiveMap: nozzleGlowTex(), emissiveIntensity: 0, side: THREE.DoubleSide });
  const R = v.diameter / 2;
  let coreLen = 0;
  let upperBase = 0;
  let upperLen = 0;
  let nozzleUpper: THREE.Mesh | null = null;

  const addEngines = (g: THREE.Group, n: number, ringR: number, rExit: number, len: number, y: number) => {
    const pos: [number, number][] = n === 1 ? [[0, 0]] : n === 9 ? [[0, 0], ...Array.from({ length: 8 }, (_, i) => [Math.cos((i / 8) * Math.PI * 2) * ringR, Math.sin((i / 8) * Math.PI * 2) * ringR] as [number, number])] : Array.from({ length: n }, (_, i) => [Math.cos((i / n) * Math.PI * 2) * ringR, Math.sin((i / n) * Math.PI * 2) * ringR]);
    for (const [x, z] of pos) {
      const nz = nozzle(rExit, len, engineMat);
      nz.position.set(x, y, z);
      g.add(nz);
    }
  };

  if (v.kit === "f9" || v.kit === "fh") {
    const s1 = 41.2, is = 6.7, s2 = 12.6;
    core.add(cyl(R, s1, stage1, 0));
    core.add(cyl(R, 0.6, dark, 0));
    addEngines(core, 9, R * 0.62, 0.48, 1.4, 0);
    // landing legs folded against the stage, grid fins at the top of the interstage
    for (let k = 0; k < 4; k++) {
      const a = (k / 4) * Math.PI * 2 + Math.PI / 4;
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.5, 9.5, 1.1), dark);
      leg.geometry.translate(0, 4.75, 0);
      const holder = new THREE.Group();
      holder.position.set(Math.cos(a) * (R + 0.2), 0.3, Math.sin(a) * (R + 0.2));
      holder.rotation.y = -a;
      holder.add(leg);
      core.add(holder);
      legs.push(leg);
      const fin = new THREE.Mesh(new THREE.BoxGeometry(0.15, 1.4, 1.2), dark);
      fin.position.set(Math.cos(a) * (R + 0.15), s1 + is - 0.9, Math.sin(a) * (R + 0.15));
      fin.rotation.y = -a;
      core.add(fin);
      fins.push(fin);
    }
    core.add(cyl(R, is, inter, s1));
    coreLen = s1 + is;
    upperBase = coreLen;
    const mv = nozzle(1.6, 3.2, nozzleMat);
    mv.position.y = upperBase + 0.4;
    upper.add(mv);
    nozzleUpper = mv;
    upper.add(cyl(R, s2, body, upperBase));
    upperLen = s2;
    const top = upperBase + s2;
    if (crewed) {
      upper.add(cyl(R, 3.6, stdMat("#e9e9e9", 0.5), top));
      const panel = cyl(R + 0.01, 1.6, stdMat("#1f2b44", 0.3, 0.6), top + 0.4);
      upper.add(panel);
      upper.add(cyl(R, 3.2, stdMat("#f4f4f4", 0.45), top + 3.6, 1.2));
      upper.add(ogive(1.2, 1.2, top + 6.8, stdMat("#f4f4f4", 0.45), 0.3));
    } else {
      const fr = 2.6;
      const halves = [0, Math.PI].map((th) => {
        const prof: [number, number][] = [[fr, 0], [fr, 6.7]];
        for (let k = 1; k <= 14; k++) {
          const f = k / 14;
          prof.push([0.25 + (fr - 0.25) * Math.sqrt(1 - f * f), 6.7 + f * 6.4]);
        }
        prof.push([0, 13.1]);
        const g = new THREE.LatheGeometry(prof.map(([r, y]) => new THREE.Vector2(r, y)), 24, th, Math.PI);
        const m = new THREE.Mesh(g, body);
        m.position.y = top;
        upper.add(m);
        return m;
      });
      fairing.push(...halves);
    }
    if (v.kit === "fh") {
      for (const side of [-1, 1]) {
        const b = new THREE.Group();
        b.add(cyl(R, s1, stage1, 0));
        b.add(cyl(R, 0.6, dark, 0));
        addEngines(b, 9, R * 0.62, 0.48, 1.4, 0);
        b.add(ogive(R, 6, s1, stdMat("#e8e8e6", 0.5)));
        b.add(cyl(R * 1.002, 1.2, dark, s1 - 1.2));
        b.position.x = side * (v.diameter + 0.5);
        root.add(b);
        boosters.push(b);
      }
    }
  } else if (v.kit === "starship") {
    const sh = 71, ship = 52;
    core.add(cyl(R, sh, body, 0));
    core.add(cyl(R * 1.01, 2, dark, sh - 2));
    addEngines(core, 13, R * 0.5, 0.65, 2.2, 0);
    addEngines(core, 20, R * 0.85, 0.65, 2.0, 0.2);
    for (let k = 0; k < 4; k++) {
      const a = (k / 4) * Math.PI * 2 + Math.PI / 4;
      const fin = new THREE.Mesh(new THREE.BoxGeometry(0.3, 3.2, 3.2), stdMat("#6e7176", 0.4, 0.8));
      fin.position.set(Math.cos(a) * (R + 0.2), sh - 5, Math.sin(a) * (R + 0.2));
      fin.rotation.y = -a;
      core.add(fin);
      fins.push(fin);
    }
    coreLen = sh;
    upperBase = sh;
    const tiles = stdMat("#151617", 0.85);
    const half = (mat: THREE.Material, th: number) => {
      const m = new THREE.Mesh(new THREE.CylinderGeometry(R, R, ship - 14, 40, 1, false, th, Math.PI), mat);
      m.position.y = upperBase + (ship - 14) / 2;
      upper.add(m);
    };
    half(body, 0);
    half(tiles, Math.PI);
    const nose = ogive(R, 14, upperBase + ship - 14, body, 0.6);
    upper.add(nose);
    for (const [y, s] of [[upperBase + 3, 1], [upperBase + ship - 9, 0.6]] as [number, number][]) {
      for (const side of [-1, 1]) {
        const flap = new THREE.Mesh(new THREE.BoxGeometry(0.4, 9 * s, 4.5 * s), tiles);
        flap.position.set(side * (R + 1.6 * s), y + 4.5 * s, 0);
        upper.add(flap);
      }
    }
    const rv = nozzle(1.15, 2.8, nozzleMat);
    rv.position.y = upperBase + 0.2;
    upper.add(rv);
    nozzleUpper = rv;
    upperLen = ship;
  } else if (v.kit === "sls") {
    const cs = 65;
    core.add(cyl(R, cs, body, 0));
    core.add(cyl(R * 1.01, 0.8, stdMat("#e8e2d6"), cs - 0.8));
    addEngines(core, 4, R * 0.42, 1.2, 4.2, 0);
    coreLen = cs;
    upperBase = cs;
    upper.add(cyl(R, 3, stdMat("#e8e2d6", 0.5), upperBase, 2.6));
    upper.add(cyl(2.6, 10, stdMat("#e4e4e4", 0.5), upperBase + 3));
    const n2 = nozzle(1.0, 2.2, nozzleMat);
    n2.position.y = upperBase + 3.2;
    upper.add(n2);
    nozzleUpper = n2;
    upper.add(cyl(2.6, 4, stdMat("#d8d8d8", 0.4, 0.3), upperBase + 13, 2.5));
    upper.add(cyl(2.5, 3.5, stdMat("#f2f2f2", 0.4), upperBase + 17, 1.1));
    const las = new THREE.Group();
    las.add(cyl(1.1, 2.5, stdMat("#f2f2f2"), upperBase + 20.5, 0.4));
    las.add(cyl(0.38, 7, stdMat("#e9e9e9"), upperBase + 23));
    las.add(ogive(0.38, 2, upperBase + 30, stdMat("#e9e9e9")));
    upper.add(las);
    fairing.push(...(las.children as THREE.Mesh[]));
    upperLen = 33;
    for (const side of [-1, 1]) {
      const b = new THREE.Group();
      b.add(cyl(1.85, 47, stdMat("#f1f0ec", 0.55), 0));
      b.add(cyl(1.85, 4, dark, 0, 1.85));
      b.add(ogive(1.85, 7, 47, stdMat("#f1f0ec", 0.55), 0.2));
      const n = nozzle(1.9, 3.8, engineMat);
      b.add(n);
      b.position.x = side * (R + 2.2);
      root.add(b);
      boosters.push(b);
    }
  } else if (v.kit === "atlas") {
    const ccb = 32.5;
    core.add(cyl(R, ccb, stdMat(P.accent, 0.6), 0));
    addEngines(core, 2, 0.8, 0.9, 3.2, 0);
    core.add(cyl(R, 4, stdMat("#efefef"), ccb));
    coreLen = ccb + 4;
    upperBase = coreLen;
    const n2 = nozzle(0.65, 2, nozzleMat);
    n2.position.y = upperBase + 0.3;
    upper.add(n2);
    nozzleUpper = n2;
    const fr = 2.7;
    const halves = [0, Math.PI].map((th) => {
      const prof: [number, number][] = [[fr, 0], [fr, 12]];
      for (let k = 1; k <= 14; k++) {
        const f = k / 14;
        prof.push([0.3 + (fr - 0.3) * Math.sqrt(1 - f * f), 12 + f * 8.7]);
      }
      prof.push([0, 20.7]);
      const m = new THREE.Mesh(new THREE.LatheGeometry(prof.map(([r, y]) => new THREE.Vector2(r, y)), 24, th, Math.PI), body);
      m.position.y = upperBase;
      upper.add(m);
      return m;
    });
    fairing.push(...halves);
    upperLen = 20.7;
    for (let k = 0; k < 5; k++) {
      const a = (k / 5) * Math.PI * 2 + 0.3;
      const b = new THREE.Group();
      b.add(cyl(0.8, 17, stdMat("#f2f2f2", 0.6), 0));
      b.add(ogive(0.8, 3, 17, stdMat("#f2f2f2", 0.6)));
      const n = nozzle(0.75, 1.6, engineMat);
      n.rotation.z = 0.05;
      b.add(n);
      b.position.set(Math.cos(a) * (R + 0.85), 1, Math.sin(a) * (R + 0.85));
      root.add(b);
      boosters.push(b);
    }
  } else if (v.kit === "ariane") {
    const cs = 30;
    core.add(cyl(R, cs, body, 0));
    core.add(cyl(R * 1.005, 2, dark, cs - 2));
    addEngines(core, 1, 0, 1.05, 3.2, 0);
    coreLen = cs;
    upperBase = cs;
    upper.add(cyl(R, 6, dark, upperBase));
    const n2 = nozzle(1.1, 2.6, nozzleMat);
    n2.position.y = upperBase + 0.2;
    upper.add(n2);
    nozzleUpper = n2;
    const fr = R;
    const halves = [0, Math.PI].map((th) => {
      const prof: [number, number][] = [[fr, 0], [fr, 12]];
      for (let k = 1; k <= 14; k++) {
        const f = k / 14;
        prof.push([0.3 + (fr - 0.3) * Math.sqrt(1 - f * f), 12 + f * 8]);
      }
      prof.push([0, 20]);
      const m = new THREE.Mesh(new THREE.LatheGeometry(prof.map(([r, y]) => new THREE.Vector2(r, y)), 24, th, Math.PI), body);
      m.position.y = upperBase + 6;
      upper.add(m);
      return m;
    });
    fairing.push(...halves);
    upperLen = 26;
    for (let k = 0; k < 4; k++) {
      const a = (k / 4) * Math.PI * 2 + Math.PI / 4;
      const b = new THREE.Group();
      b.add(cyl(1.7, 11.5, stdMat("#f2f2f0", 0.55), 0));
      b.add(ogive(1.7, 3.5, 11.5, stdMat("#f2f2f0", 0.55), 0.15));
      b.add(nozzle(1.3, 2.2, engineMat));
      b.position.set(Math.cos(a) * (R + 1.75), 0, Math.sin(a) * (R + 1.75));
      root.add(b);
      boosters.push(b);
    }
  } else if (v.kit === "soyuz") {
    core.add(lathe([[1.35, 0], [1.47, 6], [1.47, 22], [1.2, 27.1], [1.2, 27.2]], body));
    addEngines(core, 4, 0.55, 0.45, 1.4, 0);
    core.add(cyl(1.2, 1.4, dark, 27.1, 1.3));
    coreLen = 28.5;
    upperBase = coreLen;
    upper.add(cyl(1.33, 6.7, body, upperBase));
    const n2 = nozzle(0.4, 1.1, nozzleMat);
    n2.position.y = upperBase + 0.2;
    upper.add(n2);
    nozzleUpper = n2;
    upper.add(cyl(1.33, 2, stdMat("#cfd3cc"), upperBase + 6.7, 2.05));
    if (crewed) {
      upper.add(cyl(1.5, 7.5, body, upperBase + 8.7, 1.1));
      const tower = cyl(0.35, 6, stdMat("#d0d4ce"), upperBase + 16.2, 0.15);
      upper.add(tower);
      fairing.push(tower);
      upperLen = 22;
    } else {
      const halves = [0, Math.PI].map((th) => {
        const prof: [number, number][] = [[2.05, 0], [2.05, 6]];
        for (let k = 1; k <= 12; k++) {
          const f = k / 12;
          prof.push([0.25 + 1.8 * Math.sqrt(1 - f * f), 6 + f * 5]);
        }
        prof.push([0, 11]);
        const m = new THREE.Mesh(new THREE.LatheGeometry(prof.map(([r, y]) => new THREE.Vector2(r, y)), 24, th, Math.PI), body);
        m.position.y = upperBase + 8.7;
        upper.add(m);
        return m;
      });
      fairing.push(...halves);
      upperLen = 20;
    }
    for (let k = 0; k < 4; k++) {
      const a = (k / 4) * Math.PI * 2;
      const b = new THREE.Group();
      const cone = lathe([[1.34, 0], [1.34, 4], [0.45, 19.6], [0.1, 20]], body);
      b.add(cone);
      b.add(nozzle(0.42, 1.2, engineMat));
      const vane = new THREE.Mesh(new THREE.BoxGeometry(0.06, 1.2, 1.4), stdMat(P.accent, 0.5));
      vane.position.set(0.9, 0.6, 0);
      b.add(vane);
      b.position.set(Math.cos(a) * 2.25, 0, Math.sin(a) * 2.25);
      b.rotation.y = -a;
      b.rotation.z = 0.035;
      root.add(b);
      boosters.push(b);
    }
  } else {
    // electron
    core.add(cyl(R, 12.1, body, 0));
    addEngines(core, 9, R * 0.6, 0.15, 0.5, 0);
    coreLen = 12.1;
    upperBase = coreLen;
    upper.add(cyl(R, 2.4, body, upperBase));
    const n2 = nozzle(0.3, 0.8, nozzleMat);
    n2.position.y = upperBase + 0.1;
    upper.add(n2);
    nozzleUpper = n2;
    const halves = [0, Math.PI].map((th) => {
      const prof: [number, number][] = [[R, 0], [R, 1.2]];
      for (let k = 1; k <= 10; k++) {
        const f = k / 10;
        prof.push([0.06 + (R - 0.06) * Math.sqrt(1 - f * f), 1.2 + f * 1.3]);
      }
      prof.push([0, 2.5]);
      const m = new THREE.Mesh(new THREE.LatheGeometry(prof.map(([r, y]) => new THREE.Vector2(r, y)), 20, th, Math.PI), body);
      m.position.y = upperBase + 2.4;
      upper.add(m);
      return m;
    });
    fairing.push(...halves);
    upperLen = 4.9;
    // the "Electron" stripe
    upper.add(cyl(R * 1.01, 0.4, accent, upperBase + 1.2));
  }
  root.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) {
      o.castShadow = true;
      o.receiveShadow = true;
    }
  });
  const box = new THREE.Box3().setFromObject(root);
  return { root, core, upper, boosters, fairing, coreLen, upperBase, upperLen, topY: box.max.y, nozzleUpper, legs, fins };
}

// ———————————————————————————— plumes ————————————————————————————

const plumeVert = /* glsl */ `
  varying float vAx; varying vec2 vUv; varying vec3 vN; varying vec3 vV;
  void main(){ vUv = uv; vAx = 1.0 - uv.y; vN = normalize(normalMatrix * normal); vec4 mv = modelViewMatrix * vec4(position,1.0); vV = -mv.xyz; gl_Position = projectionMatrix * mv; }`;
const plumeFrag = /* glsl */ `
  uniform float uTime; uniform float uThr; uniform float uVac; uniform vec3 uCore; uniform vec3 uOuter; uniform float uSeed;
  varying float vAx; varying vec2 vUv; varying vec3 vN; varying vec3 vV;
  float h(float n){ return fract(sin(n) * 43758.5453); }
  float n1(float x){ float i = floor(x); float f = fract(x); return mix(h(i), h(i+1.0), f*f*(3.0-2.0*f)); }
  void main(){
    float edge = pow(clamp(abs(dot(normalize(vN), normalize(vV))), 1e-4, 1.0), mix(1.4, 1.8, uVac)); // view vector per fragment: no seams on a huge vacuum plume
    float ax = clamp(vAx, 0.0, 1.0);
    float fall = pow(max(1.0 - ax, 1e-5), mix(2.2, 3.5, uVac));
    float flick = 0.8 + 0.2 * n1(uTime * 37.0 + uSeed + ax * 9.0) + 0.15 * n1(vUv.x * 30.0 + uTime * 12.0);
    float diamonds = (1.0 - uVac) * smoothstep(0.55, 1.0, 0.5 + 0.5 * sin(ax * 46.0 - uTime * 2.0)) * smoothstep(0.42, 0.05, ax) * 0.9;
    vec3 col = mix(uOuter, uCore, clamp(pow(max(1.0 - ax, 1e-5), 3.0) * edge * 1.4 + diamonds, 0.0, 1.0));
    float a = fall * edge * flick * uThr * mix(1.0, 0.05, uVac);
    gl_FragColor = vec4(max(col * a * (2.4 + diamonds * 3.0), vec3(0.0)), clamp(a, 0.0, 1.0));
  }`;

function plumeMesh(seed: number, core = "#fff3d6", outer = "#ff7a2a") {
  // a little wider downstream; back-pressure (sea level) squeezes it, vacuum lets it bloom
  const g = new THREE.CylinderGeometry(0.55, 1, 1, 64, 12, true);
  g.translate(0, -0.5, 0);
  const m = new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uThr: { value: 0 }, uVac: { value: 0 }, uCore: { value: new THREE.Color(core) }, uOuter: { value: new THREE.Color(outer) }, uSeed: { value: seed } },
    vertexShader: plumeVert,
    fragmentShader: plumeFrag,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    toneMapped: false,
  });
  const mesh = new THREE.Mesh(g, m);
  mesh.frustumCulled = false;
  mesh.renderOrder = 5;
  return mesh;
}
function setPlume(p: THREE.Mesh, thr: number, vac: number, r: number, len: number, t: number) {
  const u = (p.material as THREE.ShaderMaterial).uniforms;
  u.uThr.value = thr;
  u.uVac.value = vac;
  u.uTime.value = t;
  p.visible = thr > 0.01;
  const spread = (1.3 + vac * vac * 8.5) * (1 - 0.25 * (1 - vac));
  p.scale.set(r * spread, len * (1 + vac * 2.5), r * spread);
}

// ———————————————————————————— smoke ————————————————————————————

const MAXP = 1400;
class Smoke {
  mesh: THREE.Mesh;
  pos = new Float32Array(MAXP * 3);
  vel = new Float32Array(MAXP * 3);
  age = new Float32Array(MAXP);
  life = new Float32Array(MAXP);
  size0 = new Float32Array(MAXP);
  grow = new Float32Array(MAXP);
  heat = new Float32Array(MAXP);
  shade = new Float32Array(MAXP);
  n = 0;
  private aC: THREE.InstancedBufferAttribute;
  private aS: THREE.InstancedBufferAttribute;
  private aA: THREE.InstancedBufferAttribute;
  private aH: THREE.InstancedBufferAttribute;
  private order: number[] = [];
  mat: THREE.ShaderMaterial;
  constructor() {
    const g = new THREE.InstancedBufferGeometry();
    const base = new THREE.PlaneGeometry(1, 1);
    g.index = base.index;
    g.attributes.position = base.attributes.position;
    g.attributes.uv = base.attributes.uv;
    this.aC = new THREE.InstancedBufferAttribute(new Float32Array(MAXP * 3), 3);
    this.aS = new THREE.InstancedBufferAttribute(new Float32Array(MAXP), 1);
    this.aA = new THREE.InstancedBufferAttribute(new Float32Array(MAXP * 2), 2);
    this.aH = new THREE.InstancedBufferAttribute(new Float32Array(MAXP), 1);
    [this.aC, this.aS, this.aA, this.aH].forEach((a) => a.setUsage(THREE.DynamicDrawUsage));
    g.setAttribute("aC", this.aC);
    g.setAttribute("aS", this.aS);
    g.setAttribute("aA", this.aA);
    g.setAttribute("aH", this.aH);
    g.instanceCount = 0;
    this.mat = new THREE.ShaderMaterial({
      uniforms: { uTex: { value: smokeTex() }, uSun: { value: new THREE.Vector3(0, 1, 0) }, uLight: { value: new THREE.Color(1, 1, 1) }, uAmb: { value: new THREE.Color(0.4, 0.45, 0.55) }, uGlow: { value: 0 } },
      vertexShader: /* glsl */ `
        attribute vec3 aC; attribute float aS; attribute vec2 aA; attribute float aH;
        varying vec2 vUv; varying float vA; varying float vH; varying float vRot; varying float vSh;
        void main(){
          // mirror half the puffs; only a small roll, so the lit side of each lobe stays on top
          vUv = vec2(aA.y > 0.5 ? 1.0 - uv.x : uv.x, uv.y); vA = aA.x; vH = aH; vSh = aA.y;
          vec4 mv = modelViewMatrix * vec4(aC, 1.0);
          float r = (fract(aA.y * 7.13) - 0.5) * 0.9;
          vec2 p = mat2(cos(r), -sin(r), sin(r), cos(r)) * position.xy;
          mv.xy += p * aS;
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: /* glsl */ `
        uniform sampler2D uTex; uniform vec3 uSun; uniform vec3 uLight; uniform vec3 uAmb; uniform float uGlow;
        varying vec2 vUv; varying float vA; varying float vH; varying float vSh;
        void main(){
          vec4 t = texture2D(uTex, vUv);
          float a = t.a * vA;
          if (a < 0.004) discard;
          // lobes facing the sky and sun are bright, the undersides fall into blue-grey shadow
          float sunUp = clamp(uSun.y * 2.0 + 0.4, 0.0, 1.0);
          float lit = clamp(t.r * (0.55 + 0.45 * sunUp) + 0.08, 0.0, 1.0);
          vec3 c = mix(uAmb, uLight, lit);
          // the plume lights the cloud from inside and below
          c += vec3(1.0, 0.5, 0.18) * uGlow * (vH * 1.6 + (1.0 - t.r) * vH * 1.2);
          gl_FragColor = vec4(c, a);
        }`,
      transparent: true,
      depthWrite: false,
    });
    this.mesh = new THREE.Mesh(g, this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 4;
  }
  spawn(x: number, y: number, z: number, vx: number, vy: number, vz: number, size: number, grow: number, life: number, heat = 0) {
    let i = this.n;
    if (this.n < MAXP) this.n++;
    else {
      // recycle the oldest
      let best = 0;
      for (let k = 0; k < MAXP; k++) if (this.age[k] / this.life[k] > this.age[best] / this.life[best]) best = k;
      i = best;
    }
    this.pos[i * 3] = x;
    this.pos[i * 3 + 1] = y;
    this.pos[i * 3 + 2] = z;
    this.vel[i * 3] = vx;
    this.vel[i * 3 + 1] = vy;
    this.vel[i * 3 + 2] = vz;
    this.age[i] = 0;
    this.life[i] = life;
    this.size0[i] = size;
    this.grow[i] = grow;
    this.heat[i] = heat;
    this.shade[i] = Math.random();
  }
  clear() {
    this.n = 0;
  }
  /** shift every particle (floating origin moves) */
  update(dt: number, wind: THREE.Vector3, origin: THREE.Vector3, cam: THREE.Vector3) {
    let w = 0;
    for (let i = 0; i < this.n; i++) {
      this.age[i] += dt;
      if (this.age[i] >= this.life[i]) continue;
      const k = i * 3;
      const drag = Math.exp(-dt * 0.9);
      this.vel[k] = this.vel[k] * drag + wind.x * (1 - drag);
      this.vel[k + 1] = this.vel[k + 1] * drag + (wind.y + 1.2) * (1 - drag);
      this.vel[k + 2] = this.vel[k + 2] * drag + wind.z * (1 - drag);
      this.pos[k] += this.vel[k] * dt;
      this.pos[k + 1] += this.vel[k + 1] * dt;
      this.pos[k + 2] += this.vel[k + 2] * dt;
      if (this.pos[k + 1] < 1) {
        this.pos[k + 1] = 1;
        this.vel[k + 1] = Math.abs(this.vel[k + 1]) * 0.2;
      }
      this.heat[i] *= Math.exp(-dt * 1.6);
      if (w !== i) {
        this.pos.copyWithin(w * 3, k, k + 3);
        this.vel.copyWithin(w * 3, k, k + 3);
        this.age[w] = this.age[i];
        this.life[w] = this.life[i];
        this.size0[w] = this.size0[i];
        this.grow[w] = this.grow[i];
        this.heat[w] = this.heat[i];
        this.shade[w] = this.shade[i];
      }
      w++;
    }
    this.n = w;
    // back-to-front
    const ord = this.order;
    ord.length = this.n;
    const d = new Float32Array(this.n);
    for (let i = 0; i < this.n; i++) {
      ord[i] = i;
      const dx = this.pos[i * 3] - cam.x, dy = this.pos[i * 3 + 1] - cam.y, dz = this.pos[i * 3 + 2] - cam.z;
      d[i] = dx * dx + dy * dy + dz * dz;
    }
    ord.sort((a, b) => d[b] - d[a]);
    const C = this.aC.array as Float32Array, S = this.aS.array as Float32Array, A = this.aA.array as Float32Array, H = this.aH.array as Float32Array;
    for (let j = 0; j < this.n; j++) {
      const i = ord[j];
      const f = this.age[i] / this.life[i];
      C[j * 3] = this.pos[i * 3] - origin.x;
      C[j * 3 + 1] = this.pos[i * 3 + 1] - origin.y;
      C[j * 3 + 2] = this.pos[i * 3 + 2] - origin.z;
      S[j] = this.size0[i] + this.grow[i] * Math.sqrt(this.age[i]);
      A[j * 2] = Math.min(1, this.age[i] * 3) * (1 - f) * (1 - f) * 0.85;
      A[j * 2 + 1] = this.shade[i];
      H[j] = this.heat[i];
    }
    (this.mesh.geometry as THREE.InstancedBufferGeometry).instanceCount = this.n;
    [this.aC, this.aS, this.aA, this.aH].forEach((a) => (a.needsUpdate = true));
  }
}

// ———————————————————————————— the camera chain ————————————————————————————

/**
 * What the range cameras add on their way to the wall: lens glare around anything brighter than
 * white, a little chromatic fringe toward the corners, heat shimmer over hot ground, sensor grain
 * that grows in the dark, a soft vignette, the on-screen display, and — when the downlink is
 * struggling — dropped macroblocks, smeared rows and a frozen frame.
 */
const BROADCAST = {
  depthTest: false,
  depthWrite: false,
  toneMapped: false,
  vertexShader: /* glsl */ `varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D tRaw; uniform sampler2D tOsd; uniform vec2 uRes; uniform float uTime;
    uniform float uGrain; uniform float uGlitch; uniform float uShimmer; uniform float uShimmerY; uniform float uCA; uniform float uFish;
    varying vec2 vUv;
    float h2(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
    vec3 hot(vec3 c){ return max(c - vec3(1.1), vec3(0.0)); }
    void main(){
      vec2 uv = vUv;
      vec2 cc = uv - 0.5;
      // wide-angle onboard lenses barrel a little
      uv = 0.5 + cc * (1.0 - uFish * dot(cc, cc) * 0.35);
      // heat shimmer: strongest low in the frame, where the long lens looks through hot air
      float sh = uShimmer * (0.35 + 0.65 * smoothstep(uShimmerY + 0.25, uShimmerY - 0.2, uv.y));
      uv.x += sh * (sin(uv.y * 310.0 + uTime * 23.0) * 0.6 + sin(uv.y * 133.0 - uTime * 17.0) * 0.4) * 0.00035;
      uv.y += sh * sin(uv.x * 240.0 + uTime * 19.0) * 0.00018;
      // the downlink: lost macroblocks hold stale or smeared data
      float g = uGlitch;
      if (g > 0.0) {
        vec2 blk = floor(uv * vec2(48.0, 27.0));
        float t8 = floor(uTime * 9.0);
        float r = h2(blk + t8);
        float rowR = h2(vec2(blk.y, t8 * 1.7));
        if (rowR < g * 0.35) uv.x = floor(uv.x * 48.0) / 48.0 + (h2(vec2(blk.y, t8)) - 0.5) * 0.08 * g;
        if (r < g * 0.25) uv = (blk + vec2(h2(blk + 3.0), h2(blk + 5.0)) * 0.6) / vec2(48.0, 27.0);
      }
      vec2 ca = (uv - 0.5) * uCA;
      vec3 col = vec3(texture2D(tRaw, uv - ca).r, texture2D(tRaw, uv).g, texture2D(tRaw, uv + ca).b);
      // lens glare: a soft halo and a faint horizontal streak around blown-out highlights
      vec2 px = 1.0 / uRes;
      vec3 gl = vec3(0.0);
      for (int i = 0; i < 12; i++) {
        float a = float(i) * 2.3998;
        float rr = (2.0 + float(i) * 2.6);
        gl += hot(texture2D(tRaw, uv + vec2(cos(a), sin(a)) * rr * px).rgb) * (1.0 - float(i) / 13.0);
      }
      for (int i = 1; i < 13; i++) {
        float o = float(i) * 4.0;
        gl += (hot(texture2D(tRaw, uv + vec2(o, 0.0) * px).rgb) + hot(texture2D(tRaw, uv - vec2(o, 0.0) * px).rgb)) * 0.12 * (1.0 - float(i) / 13.0);
      }
      col += gl * 0.09;
      if (g > 0.0) {
        // badly hit blocks lose their detail: one flat colour per 8×8 macroblock
        vec2 blk = floor(vUv * vec2(160.0, 90.0));
        if (h2(floor(blk / 4.0) + floor(uTime * 9.0) + 11.0) < g * 0.3) col = texture2D(tRaw, (blk + 0.5) / vec2(160.0, 90.0)).rgb * 1.05;
        col *= 1.0 - g * 0.25 * step(0.92, h2(vec2(floor(uv.y * 140.0), floor(uTime * 24.0))));
      }
      // sensor grain: grows in the shadows
      float lum = dot(col, vec3(0.299, 0.587, 0.114));
      float n = h2(vUv * uRes + fract(uTime * 7.31) * 913.0) - 0.5;
      col += n * uGrain * (0.25 + 0.75 * (1.0 - smoothstep(0.0, 0.6, lum))) * (0.25 + sqrt(max(lum, 0.0)));
      col *= 1.0 - 0.32 * smoothstep(0.35, 0.85, length(cc * vec2(1.0, 0.8)) * 1.3);
      vec4 o = texture2D(tOsd, vUv);
      col = mix(col, o.rgb * 1.1, o.a);
      gl_FragColor = vec4(max(col, vec3(0.0)), 1.0);
    }`,
};

// ———————————————————————————— the feed ————————————————————————————

type Debris = { mesh: THREE.Object3D; p: THREE.Vector3; v: THREE.Vector3; w: THREE.Vector3; t: number };

export class LaunchFeed {
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(30, 16 / 9, 0.5, 6e7);
  rt: THREE.WebGLRenderTarget;
  private world = new THREE.Group();
  private ground: THREE.Mesh;
  private groundMat: THREE.ShaderMaterial;
  private sky: THREE.Mesh;
  private skyMat: THREE.ShaderMaterial;
  private stars: THREE.Points;
  private sun = new THREE.DirectionalLight("#fff4e0", 3);
  private hemi = new THREE.HemisphereLight("#9cc4ff", "#5a5040", 0.8);
  private plumeLight = new THREE.PointLight("#ff9a4a", 0, 0, 2);
  private padLights: THREE.SpotLight[] = [];
  private pad = new THREE.Group();
  private tower = new THREE.Group();
  private strongback: THREE.Group | null = null;
  private model: VehicleModel | null = null;
  private modelKey = "";
  private plumes: { mesh: THREE.Mesh; group: "b" | "c" | "u"; obj: THREE.Object3D; y: number; r: number; len: number }[] = [];
  private returners = new Map<Returner, { obj: THREE.Group; plume: THREE.Mesh; legs: THREE.Mesh[]; len: number }>();
  private debris: Debris[] = [];
  private smoke = new Smoke();
  private landing = new THREE.Group();
  private landingSet: Returner | null = null;
  private frame: Frame;
  private siteId = "";
  private focus = new THREE.Vector3();
  private camPos = new THREE.Vector3();
  private camLook = new THREE.Vector3();
  private camFov = 30;
  private camUp = new THREE.Vector3(0, 1, 0);
  private camMode = "";
  private lastFlight: Flight | null = null;
  private seen = new Set<string>();
  private tmp = new THREE.Vector3();
  private tmp2 = new THREE.Vector3();
  private quat = new THREE.Quaternion();
  private Y = new THREE.Vector3(0, 1, 0);
  private boom = 0;
  private trailAt: THREE.Vector3 | null = null;
  private t = 0;
  private asdsTex = landingTex("asds");
  private lzTex = landingTex("lz");
  // night lighting on the pad and the glare of the engines
  private glow = glowTex();
  private beacons: THREE.Sprite[] = [];
  private lampGlows: THREE.Sprite[] = [];
  private beams: THREE.Mesh[] = [];
  private flare: THREE.Sprite;
  private night = 0;
  // the camera itself: the scene renders to `raw`, the broadcast pass composites it into `rt`
  private raw: THREE.WebGLRenderTarget;
  private post: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>;
  private postScene = new THREE.Scene();
  private postCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private osd: HTMLCanvasElement;
  private osdTex: THREE.CanvasTexture;
  private osdKey = "";
  private glitch = 0;
  private dropT = 0;

  constructor(private renderer: THREE.WebGLRenderer, nightTex: THREE.Texture | null, landTex: THREE.Texture | null, quality: number) {
    const w = quality >= 2 ? 1280 : quality === 1 ? 1024 : 768;
    const h = Math.round((w * 9) / 16);
    this.raw = new THREE.WebGLRenderTarget(w, h, { type: THREE.HalfFloatType, samples: quality >= 1 ? 4 : 0 });
    this.raw.texture.generateMipmaps = false;
    this.rt = new THREE.WebGLRenderTarget(w, h, { type: THREE.HalfFloatType, depthBuffer: false });
    this.rt.texture.generateMipmaps = false;
    this.osd = document.createElement("canvas");
    this.osd.width = 1024;
    this.osd.height = 576;
    this.osdTex = new THREE.CanvasTexture(this.osd);
    this.osdTex.colorSpace = THREE.SRGBColorSpace;
    this.post = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.ShaderMaterial({ ...BROADCAST, uniforms: { tRaw: { value: this.raw.texture }, tOsd: { value: this.osdTex }, uRes: { value: new THREE.Vector2(w, h) }, uTime: { value: 0 }, uGrain: { value: 0.04 }, uGlitch: { value: 0 }, uShimmer: { value: 0 }, uShimmerY: { value: 0.5 }, uCA: { value: 0.0015 }, uFish: { value: 0 } } }));
    this.post.frustumCulled = false;
    this.postScene.add(this.post);
    this.flare = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.glow, color: new THREE.Color(1, 0.72, 0.42), blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false, transparent: true, toneMapped: false }));
    this.flare.renderOrder = 8;
    this.world.add(this.flare);
    this.scene.add(this.world, this.sun, this.sun.target, this.hemi, this.plumeLight, this.smoke.mesh);
    // sky-and-ground image lighting for paint and steel
    const envScene = new THREE.Scene();
    envScene.add(
      new THREE.Mesh(
        new THREE.SphereGeometry(10, 32, 16),
        new THREE.ShaderMaterial({
          side: THREE.BackSide,
          vertexShader: `varying vec3 vP; void main(){ vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
          fragmentShader: `varying vec3 vP; void main(){ float y = normalize(vP).y; vec3 c = y > 0.0 ? mix(vec3(0.75,0.82,0.92), vec3(0.25,0.45,0.85), pow(y, 0.6)) : mix(vec3(0.42,0.40,0.34), vec3(0.18,0.2,0.12), min(1.0, -y * 3.0)); gl_FragColor = vec4(c, 1.0); }`,
        }),
      ),
    );
    const pm = new THREE.PMREMGenerator(renderer);
    this.scene.environment = pm.fromScene(envScene, 0.02).texture;
    pm.dispose();
    this.sun.castShadow = quality >= 1;
    this.sun.shadow.autoUpdate = false;
    this.sun.shadow.mapSize.set(1024, 1024);
    this.sun.shadow.bias = -0.0004;
    // sky
    // the sky and the whole planet, ray-traced per pixel: no facets at any altitude, and the ocean is
    // there under a booster 600 km downrange
    this.skyMat = new THREE.ShaderMaterial({
      uniforms: {
        uSun: { value: new THREE.Vector3(0, 1, 0) },
        uAlt: { value: 0 },
        uDip: { value: 0 },
        uCam: { value: new THREE.Vector3(0, O.RE, 0) },
        uRot: { value: new THREE.Matrix3() },
        uLand: { value: landTex },
        uNight: { value: nightTex },
        uHasLand: { value: landTex ? 1 : 0 },
        uHasNight: { value: nightTex ? 1 : 0 },
        uTime: { value: 0 },
      },
      side: THREE.BackSide,
      depthWrite: false,
      vertexShader: /* glsl */ `varying vec3 vD; void main(){ vD = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); gl_Position.z = gl_Position.w * 0.99999; }`,
      fragmentShader: /* glsl */ `
        uniform vec3 uSun; uniform float uAlt; uniform float uDip; uniform vec3 uCam; uniform mat3 uRot;
        uniform sampler2D uLand; uniform sampler2D uNight; uniform float uHasLand; uniform float uHasNight; uniform float uTime;
        varying vec3 vD;
        ${NOISE}
        const float R = ${O.RE.toFixed(3)};
        vec3 shade(vec3 n, vec3 d, vec3 s){
          vec3 e = uRot * n;
          float lat = asin(clamp(e.z, -1.0, 1.0));
          float lon = atan(e.y, e.x);
          vec2 uv = vec2((lon + 3.14159265) / 6.2831853, (lat + 1.5707963) / 3.14159265);
          // the coastline mask is ~20 km a pixel: wobble the lookup so coasts read as coasts, not stair steps
          vec2 wob = (vec2(fbm(e * 60.0), fbm(e * 60.0 + 7.3)) - 0.5) * 0.0025;
          float L = uHasLand > 0.5 ? smoothstep(0.3, 0.7, texture2D(uLand, uv + wob).r) : 0.0;
          vec3 p = e * 3.0;
          float tex = fbm(p * 9.0);
          vec3 ocean = mix(vec3(0.010, 0.040, 0.105), vec3(0.020, 0.085, 0.190), fbm(p * 2.0));
          float alat = abs(lat);
          vec3 green = mix(vec3(0.04, 0.075, 0.025), vec3(0.11, 0.13, 0.06), tex);
          vec3 desert = mix(vec3(0.42, 0.33, 0.20), vec3(0.56, 0.45, 0.30), tex);
          float dry = smoothstep(0.17, 0.30, alat) * (1.0 - smoothstep(0.48, 0.62, alat)) * smoothstep(0.35, 0.7, fbm(p * 1.3 + 4.0));
          vec3 landC = mix(green, desert, dry);
          landC = mix(landC, vec3(0.85, 0.88, 0.92), smoothstep(1.08, 1.22, alat));
          vec3 surf = mix(ocean, landC, L);
          vec3 cp = e * 2.6 + vec3(uTime * 0.003, 0.0, uTime * 0.002);
          float cl = fbm(cp * 4.0 + fbm(cp * 2.0) * 1.5);
          float band = 0.62 + 0.2 * cos(lat * 6.0);
          // below the cloud deck you see the sea, not the cloud tops
          float cloud = smoothstep(band, band + 0.2, cl) * smoothstep(4.0, 14.0, uAlt);
          float sunD = dot(n, s);
          float lit = max(sunD, 0.0);
          float day = smoothstep(-0.08, 0.18, sunD);
          vec3 col = surf * (0.04 + 1.2 * lit);
          vec3 H = normalize(s - d);
          col += (1.0 - L) * (1.0 - cloud) * pow(max(dot(n, H), 0.0), 220.0) * 2.0 * day;
          col = mix(col, vec3(0.95) * (0.05 + 1.15 * lit), cloud * 0.9);
          if (uHasNight > 0.5) col += pow(texture2D(uNight, uv).rgb, vec3(1.6)) * vec3(1.0, 0.82, 0.55) * 1.3 * (1.0 - day) * (1.0 - cloud * 0.7);
          return col;
        }
        void main(){
          vec3 d = normalize(vD); vec3 s = normalize(uSun);
          float alt = max(uAlt, 0.0);
          // sky as seen from the ground
          float day = smoothstep(-0.16, 0.10, s.y);
          float thin = exp(-alt / 9.0);
          float mu = d.y + uDip;
          float hz = pow(1.0 - clamp(mu, 0.0, 1.0), 6.0);
          vec3 zen = mix(vec3(0.004, 0.008, 0.02), vec3(0.10, 0.26, 0.70), day);
          vec3 hor = mix(vec3(0.02, 0.03, 0.06), vec3(0.62, 0.74, 0.92), day);
          float cs = max(dot(d, s), 0.0);
          float set = (1.0 - smoothstep(0.0, 0.35, s.y)) * day;
          hor = mix(hor, vec3(1.0, 0.55, 0.25), set * pow(cs, 3.0) * 0.9);
          vec3 groundSky = mix(zen * thin, hor * mix(thin, 1.0, 0.25) * (0.3 + 0.7 * thin), hz);
          groundSky += vec3(1.0, 0.85, 0.6) * pow(cs, 6.0) * 0.35 * day * thin;
          // from space: black, with the thin blue line of the atmosphere along the limb
          vec3 o = uCam;
          float b = dot(o, d);
          float tca = -b;
          float hmin = tca > 0.0 ? sqrt(max(dot(o, o) - tca * tca, 0.0)) - R : alt;
          vec3 pc = tca > 0.0 ? normalize(o + d * tca) : normalize(o);
          float sl = dot(pc, s);
          vec3 limb = mix(vec3(1.0, 0.42, 0.16), vec3(0.32, 0.58, 1.0), smoothstep(-0.05, 0.3, sl)) * smoothstep(-0.25, 0.08, sl);
          vec3 space = limb * exp(-max(hmin, 0.0) / 7.0) * 1.3;
          vec3 col = mix(space, groundSky, 1.0 - smoothstep(14.0, 60.0, alt));
          col += vec3(1.0, 0.95, 0.85) * smoothstep(0.999955, 0.999975, cs) * 30.0;
          // stars, where the sky is dark enough to show them
          vec3 sg = d * 380.0; vec3 si = floor(sg); float sh = h3(si);
          float star = step(0.9965, sh) * smoothstep(0.5, 0.05, length(fract(sg) - 0.5)) * (0.4 + 2.2 * fract(sh * 91.7));
          float dark = 1.0 - clamp(max(max(col.r, col.g), col.b) * 6.0, 0.0, 1.0);
          col += vec3(0.9, 0.95, 1.0) * star * dark;
          col += vec3(1.0, 0.9, 0.7) * pow(cs, 2000.0) * 2.5;
          // the planet
          float c = dot(o, o) - R * R;
          float disc = b * b - c;
          if (disc > 0.0) {
            float th = -b - sqrt(disc);
            if (th > 0.0) {
              vec3 n = normalize(o + d * th);
              vec3 surf = shade(n, d, s);
              float haze = 1.0 - exp(-th * 0.0024 * (0.3 + 0.7 * exp(-alt / 12.0)));
              float dh = smoothstep(-0.1, 0.25, dot(n, s));
              vec3 hc = mix(vec3(0.008, 0.012, 0.025), vec3(0.42, 0.58, 0.9), dh);
              col = mix(surf, hc, clamp(haze, 0.0, 1.0));
            }
          }
          gl_FragColor = vec4(max(col, vec3(0.0)), 1.0);
        }`,
    });
    this.sky = new THREE.Mesh(new THREE.SphereGeometry(1, 48, 24), this.skyMat);
    this.sky.scale.setScalar(1e7);
    this.sky.frustumCulled = false;
    this.sky.renderOrder = -2;
    this.scene.add(this.sky);
    const sp = new Float32Array(3000 * 3);
    for (let i = 0; i < 3000; i++) {
      const v = new THREE.Vector3().randomDirection().multiplyScalar(5e6);
      sp.set([v.x, v.y, v.z], i * 3);
    }
    const sg = new THREE.BufferGeometry();
    sg.setAttribute("position", new THREE.BufferAttribute(sp, 3));
    this.stars = new THREE.Points(sg, new THREE.PointsMaterial({ color: "#ffffff", size: 1.4, sizeAttenuation: false, transparent: true, opacity: 0, depthWrite: false }));
    this.stars.frustumCulled = false;
    // stars are drawn by the sky shader, which knows where the planet is
    // ground
    this.groundMat = new THREE.ShaderMaterial({
      uniforms: { uSun: { value: new THREE.Vector3(0, 1, 0) }, uSea: { value: new THREE.Vector3(1, 0, 0) }, uSeaD: { value: 1500 }, uLand: { value: new THREE.Color("#5f6d3c") }, uHaze: { value: new THREE.Color("#a9c4df") }, uHasSea: { value: 1 }, uOrigin: { value: new THREE.Vector3() }, uDay: { value: 1 }, uOpacity: { value: 1 }, uLamps: { value: 0 }, uBlast: { value: 0 }, uBlastAt: { value: new THREE.Vector2() }, uTime: { value: 0 } },
      transparent: true,
      vertexShader: /* glsl */ `varying vec3 vW; varying vec3 vP; void main(){ vP = position; vec4 w = modelMatrix * vec4(position,1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
      fragmentShader: /* glsl */ `
        uniform vec3 uSun; uniform vec3 uSea; uniform float uSeaD; uniform vec3 uLand; uniform vec3 uHaze; uniform float uHasSea; uniform float uDay; uniform float uOpacity;
        uniform float uLamps; uniform float uBlast; uniform vec2 uBlastAt; uniform float uTime;
        varying vec3 vW; varying vec3 vP;
        float h(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        float n(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f); return mix(mix(h(i), h(i+vec2(1,0)), f.x), mix(h(i+vec2(0,1)), h(i+vec2(1,1)), f.x), f.y); }
        float fbm(vec2 p){ float s = 0.0, a = 0.5; for (int i = 0; i < 5; i++){ s += a * n(p); p *= 2.07; a *= 0.5; } return s; }
        float pool(vec2 p, vec2 c, float r){ vec2 d = p - c; return exp(-dot(d, d) / (r * r)); }
        void main(){
          // the circle is built in its own XY plane and laid flat: x is east, y is north
          vec2 p = vP.xy;
          float coast = dot(p, uSea.xy) - uSeaD + (fbm(p * 0.0007) - 0.5) * 2600.0;
          float water = uHasSea * smoothstep(-40.0, 40.0, coast);
          float beach = uHasSea * (1.0 - smoothstep(0.0, 160.0, abs(coast + 60.0)));
          // coastal scrub: muted olive with darker palmetto clumps, sandy clearings and dirt tracks
          vec3 base = mix(uLand, vec3(dot(uLand, vec3(0.3, 0.55, 0.15))), 0.35);
          float clump = smoothstep(0.45, 0.7, fbm(p * 0.03));
          float clear = smoothstep(0.62, 0.8, fbm(p * 0.006 + 3.1));
          vec3 land = base * (0.7 + 0.5 * fbm(p * 0.004)) * (0.8 + 0.35 * n(p * 0.9));
          land = mix(land, base * 0.45, clump * 0.7);
          land = mix(land, vec3(0.55, 0.5, 0.4), clear * 0.45);
          land = mix(land, vec3(0.66, 0.61, 0.5), beach * 0.8);
          // the pad apron: weathered concrete with expansion joints and scorch around the flame trench
          float padD = max(abs(p.x), abs(p.y));
          vec2 j = abs(fract(p / 6.0) - 0.5);
          float joint = 1.0 - smoothstep(0.0, 0.015, min(j.x, j.y));
          vec3 conc = vec3(0.56, 0.55, 0.52) * (0.88 + 0.14 * n(p * 0.5)) * (1.0 - joint * 0.25);
          float scorch = exp(-(p.x * p.x) / 300.0 - pow(max(0.0, -p.y - 8.0), 2.0) / 4000.0) * step(p.y, 0.0);
          conc *= 1.0 - 0.6 * scorch;
          land = mix(conc, land, smoothstep(60.0, 66.0, padD));
          // the crawlerway/access road west, and a perimeter road
          float road = (1.0 - smoothstep(4.0, 6.0, abs(p.y))) * step(p.x, -60.0) * step(-2400.0, p.x);
          float ring = 1.0 - smoothstep(3.0, 4.5, abs(padD - 230.0));
          land = mix(land, vec3(0.3, 0.3, 0.31) * (0.9 + 0.2 * n(p * 0.3)), max(road, ring));
          vec3 sea = mix(vec3(0.03, 0.12, 0.2), vec3(0.06, 0.2, 0.28), fbm(p * 0.002));
          float waves = fbm(p * 0.05 + vec2(uTime * 0.4, uTime * 0.25));
          vec3 col = mix(land, sea, water);
          float lit = max(uSun.y, 0.0);
          col *= 0.02 + 1.15 * lit + 0.12 * smoothstep(-0.2, 0.0, uSun.y);
          // at night the xenon floods make pools of hard white light around the pad
          float lamps = pool(p, vec2(0.0), 85.0) * 1.1 + pool(p, vec2(-120.0, 90.0), 30.0) + pool(p, vec2(130.0, 100.0), 30.0) + pool(p, vec2(0.0, -140.0), 30.0);
          // sodium street lights every 60 m along the access road
          float sl = mod(p.x, 60.0) - 30.0;
          lamps += 0.5 * exp(-(sl * sl + p.y * p.y) / 60.0) * step(p.x, -70.0) * step(-2400.0, p.x);
          col += uLamps * lamps * vec3(1.0, 0.93, 0.8) * (land * 1.6 + 0.02);
          // and the plume turns the whole pad orange
          float bd = length(p - uBlastAt);
          col += uBlast * vec3(1.0, 0.55, 0.22) * (exp(-bd / 70.0) * 1.2 + exp(-bd / 300.0) * 0.1) * (0.15 + land);
          vec3 V = normalize(cameraPosition - vW);
          vec3 H = normalize(normalize(uSun) + V);
          col += water * pow(max(H.y, 0.0), 180.0) * 3.0 * uDay * (0.7 + 0.6 * waves);
          float d = length(vW - cameraPosition);
          float fog = 1.0 - exp(-d / 26000.0);
          col = mix(col, uHaze, fog);
          gl_FragColor = vec4(col, uOpacity);
        }`,
    });
    this.ground = new THREE.Mesh(new THREE.CircleGeometry(90_000, 96), this.groundMat);
    this.ground.rotation.x = -Math.PI / 2;
    this.ground.position.y = -3;
    this.ground.receiveShadow = true;
    this.world.add(this.ground);
    // the planet for high altitude
    this.world.add(this.pad, this.landing);
    this.frame = padFrame(siteById.slc40);
  }

  // —— the pad ——
  private buildPad(site: Site, v: Vehicle) {
    this.pad.clear();
    this.tower.clear();
    this.strongback = null;
    this.tower.visible = true;
    const concrete = stdMat("#a9a59c", 0.9);
    const steel = stdMat("#8c8f93", 0.5, 0.7);
    const red = stdMat("#9b3f2c", 0.6, 0.4);
    const small = v.kit === "electron";
    const deck = new THREE.Mesh(new THREE.BoxGeometry(small ? 9 : 28, 3, small ? 9 : 28), concrete);
    deck.position.y = -1.5;
    deck.receiveShadow = true;
    this.pad.add(deck);
    const trench = new THREE.Mesh(new THREE.BoxGeometry(small ? 3 : 14, 3.2, small ? 12 : 70), stdMat("#2a2826", 1));
    trench.position.set(0, -1.6, small ? 9 : 48);
    this.pad.add(trench);
    // lattice tower
    const H = v.kit === "starship" ? 146 : v.kit === "sls" ? 110 : v.kit === "electron" ? 24 : v.kit === "soyuz" ? 52 : 86;
    const W = v.kit === "starship" ? 14 : v.kit === "electron" ? 3 : 10;
    const box = new THREE.BoxGeometry(1, 1, 1);
    const mats: THREE.Matrix4[] = [];
    const m4 = (x: number, y: number, z: number, sx: number, sy: number, sz: number, rx = 0, rz = 0) =>
      mats.push(new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, 0, rz)), new THREE.Vector3(sx, sy, sz)));
    const half = W / 2;
    for (const [cx, cz] of [[-half, -half], [half, -half], [-half, half], [half, half]]) m4(cx, H / 2, cz, 0.8, H, 0.8);
    const step = 6;
    for (let y = step; y <= H; y += step) {
      m4(0, y, -half, W, 0.45, 0.45);
      m4(0, y, half, W, 0.45, 0.45);
      m4(-half, y, 0, 0.45, 0.45, W);
      m4(half, y, 0, 0.45, 0.45, W);
      const dl = Math.hypot(W, step);
      const ang = Math.atan2(step, W);
      m4(0, y - step / 2, -half, dl, 0.3, 0.3, 0, ang);
      m4(0, y - step / 2, half, dl, 0.3, 0.3, 0, -ang);
      m4(-half, y - step / 2, 0, 0.3, 0.3, dl, ang, 0);
      m4(half, y - step / 2, 0, 0.3, 0.3, dl, -ang, 0);
    }
    const lattice = new THREE.InstancedMesh(box, v.kit === "starship" ? steel : red, mats.length);
    mats.forEach((m, i) => lattice.setMatrixAt(i, m));
    lattice.castShadow = true;
    this.tower.add(lattice);
    // service arms
    const arm = new THREE.Mesh(new THREE.BoxGeometry(W * 0.9, 2.2, 2.6), steel);
    arm.position.set(half + W * 0.45, H * 0.82, 0);
    this.tower.add(arm);
    if (v.kit === "starship") {
      for (const s of [-1, 1]) {
        const chop = new THREE.Mesh(new THREE.BoxGeometry(22, 2.4, 1.6), steel);
        chop.position.set(half + 10, H * 0.62, s * 5.5);
        this.tower.add(chop);
      }
    }
    this.tower.position.set(-(v.diameter / 2 + half + (v.kit === "starship" ? 6 : 3)), 0, 0);
    this.pad.add(this.tower);
    // SpaceX strongback: hugs the rocket, retracts before launch
    if (v.kit === "f9" || v.kit === "fh") {
      const sb = new THREE.Group();
      const beams: THREE.Matrix4[] = [];
      for (let y = 0; y < v.height - 5; y += 4) {
        beams.push(new THREE.Matrix4().compose(new THREE.Vector3(0, y, -1.2), new THREE.Quaternion(), new THREE.Vector3(0.5, 4, 0.5)));
        beams.push(new THREE.Matrix4().compose(new THREE.Vector3(0, y, 1.2), new THREE.Quaternion(), new THREE.Vector3(0.5, 4, 0.5)));
        beams.push(new THREE.Matrix4().compose(new THREE.Vector3(0, y, 0), new THREE.Quaternion(), new THREE.Vector3(0.4, 0.4, 2.4)));
      }
      const im = new THREE.InstancedMesh(box, stdMat("#d7d4cf", 0.6, 0.3), beams.length);
      beams.forEach((b, i) => im.setMatrixAt(i, b));
      im.position.set(-(v.diameter / 2 + (v.kit === "fh" ? v.diameter + 1.8 : 1.2)), 2, 0);
      sb.add(im);
      sb.position.set(0, 0, 0);
      this.pad.add(sb);
      this.strongback = sb;
      this.tower.visible = v.kit === "fh" || site.id === "lc39a";
    }
    // lightning masts and catenary wires
    const mastH = Math.max(120, H + 30);
    const mastPts: THREE.Vector3[] = [];
    const masts = [[-160, -120], [160, -120], [-160, 160], [160, 160]];
    for (const [x, z] of masts) {
      const m = cyl(1.2, mastH, steel, -3, 0.5, 8);
      m.position.set(x, -3 + mastH / 2, z);
      this.pad.add(m);
    }
    for (let a = 0; a < masts.length; a++) {
      const [x1, z1] = masts[a];
      const [x2, z2] = masts[(a + 1) % masts.length];
      for (let k = 0; k < 24; k++) {
        const f1 = k / 24, f2 = (k + 1) / 24;
        const sag = (f: number) => mastH - 3 - 40 * 4 * f * (1 - f);
        mastPts.push(new THREE.Vector3(x1 + (x2 - x1) * f1, sag(f1), z1 + (z2 - z1) * f1), new THREE.Vector3(x1 + (x2 - x1) * f2, sag(f2), z1 + (z2 - z1) * f2));
      }
      mastPts.push(new THREE.Vector3(x1, mastH - 3, z1), new THREE.Vector3(0, H + 8, 0));
    }
    this.pad.add(new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(mastPts), new THREE.LineBasicMaterial({ color: "#2b2b2b", transparent: true, opacity: 0.3 })));
    // water tower, propellant farm
    const wt = new THREE.Group();
    for (const [x, z] of [[-5, -5], [5, -5], [-5, 5], [5, 5]]) wt.add(cyl(0.5, 60, steel, -3, 0.5, 8).translateX(x).translateZ(z));
    const ball = new THREE.Mesh(new THREE.SphereGeometry(9, 24, 16), stdMat("#d8d6cf", 0.5, 0.3));
    ball.position.y = 64;
    wt.add(ball);
    wt.position.set(280, 0, -260);
    wt.visible = !small;
    this.pad.add(wt);
    const lox = new THREE.Mesh(new THREE.SphereGeometry(11, 24, 16), stdMat("#efefef", 0.45, 0.2));
    lox.position.set(-180, 9, 140);
    lox.visible = !small;
    this.pad.add(lox);
    for (let k = 0; k < 3; k++) {
      const t = new THREE.Mesh(new THREE.CylinderGeometry(2.5, 2.5, 20, 20), stdMat("#d9d9d9", 0.5, 0.2));
      t.rotation.z = Math.PI / 2;
      t.position.set(-170, 0, -150 + k * 7);
      this.pad.add(t);
    }
    // pad floodlights: xenon banks on poles, their beams standing in the humid night air
    for (const l of this.padLights) this.scene.remove(l, l.target);
    this.padLights = [];
    this.lampGlows = [];
    this.beams = [];
    this.beacons = [];
    // point sources keep the same size on screen at any range, like a real lamp seen through a lens
    const glowSprite = (color: THREE.ColorRepresentation, size: number) => {
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.glow, color, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, toneMapped: false, sizeAttenuation: false }));
      sp.scale.setScalar(size);
      sp.renderOrder = 6;
      return sp;
    };
    const aim = new THREE.Vector3(0, v.height * 0.5, 0);
    for (const [x, z] of [[-120, -90], [130, -100], [0, 140]]) {
      const s = new THREE.SpotLight("#fff1d6", 0, 900, 0.3, 0.7, 2);
      s.position.set(x, 18, z);
      s.target.position.copy(aim);
      this.pad.add(s, s.target);
      this.padLights.push(s);
      const lamp = new THREE.Mesh(new THREE.BoxGeometry(3, 2, 1), new THREE.MeshBasicMaterial({ color: new THREE.Color("#fff4dd").multiplyScalar(3), toneMapped: false }));
      lamp.position.set(x, 18, z);
      lamp.lookAt(aim);
      const pole = cyl(0.35, 18, stdMat("#6f7378", 0.6, 0.5), -3, 0.35, 8);
      pole.position.set(x, 6, z);
      this.pad.add(pole);
      this.pad.add(lamp);
      const g = glowSprite("#fff0d8", 0.05);
      g.position.set(x, 18, z).lerp(aim, 0.012);
      this.pad.add(g);
      this.lampGlows.push(g);
      // the beam: an open cone from the lamp toward the vehicle, brightest at the lamp, soft at its edges
      const from = new THREE.Vector3(x, 18, z);
      const dir = aim.clone().sub(from);
      const len = dir.length() * 1.25;
      const cone = new THREE.CylinderGeometry(1.2, len * 0.16, len, 32, 1, true);
      cone.translate(0, -len / 2, 0);
      const beam = new THREE.Mesh(cone, new THREE.ShaderMaterial({
        uniforms: { uI: { value: 0 } },
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
        toneMapped: false,
        vertexShader: /* glsl */ `varying vec2 vUv; varying vec3 vN; varying vec3 vV; void main(){ vUv = uv; vN = normalize(normalMatrix * normal); vec4 mv = modelViewMatrix * vec4(position, 1.0); vV = -mv.xyz; gl_Position = projectionMatrix * mv; }`,
        fragmentShader: /* glsl */ `uniform float uI; varying vec2 vUv; varying vec3 vN; varying vec3 vV;
          void main(){ float edge = pow(abs(dot(normalize(vN), normalize(vV))), 2.0); float a = uI * pow(vUv.y, 2.2) * edge; gl_FragColor = vec4(vec3(1.0, 0.95, 0.85) * a, a); }`,
      }));
      beam.position.copy(from);
      beam.quaternion.setFromUnitVectors(new THREE.Vector3(0, -1, 0), dir.normalize());
      beam.renderOrder = 3;
      this.pad.add(beam);
      this.beams.push(beam);
    }
    // red obstruction beacons on the lightning masts and the top of the tower
    for (const [x, z] of masts) {
      const b = glowSprite("#ff2a1a", 0.022);
      b.position.set(x, mastH - 2, z);
      this.pad.add(b);
      this.beacons.push(b);
    }
    const tb = glowSprite("#ff2a1a", 0.02);
    tb.position.set(this.tower.position.x, H + 1.5, 0);
    tb.visible = this.tower.visible;
    this.pad.add(tb);
    this.beacons.push(tb);
    this.pad.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) {
        o.castShadow = true;
        o.receiveShadow = true;
      }
    });
    for (const b of this.beams) b.castShadow = b.receiveShadow = false;
    // ground shading for this site
    const u = this.groundMat.uniforms;
    u.uLand.value.set(site.land);
    u.uHasSea.value = site.sea ? 1 : 0;
    if (site.sea) {
      const a = site.sea[0] * D2R;
      u.uSea.value.set(Math.sin(a), Math.cos(a), 0);
      u.uSeaD.value = site.sea[1];
    }
  }

  private ensure() {
    const s = useMC.getState();
    const d = mc.pending?.draft ?? s.draft;
    const crewed = d.payload === "crew" || d.payload === "artemis";
    // a recoverable Falcon is flight-proven: it rolls out with the soot of its earlier flights
    const flown = d.recovery !== "expend";
    const key = `${d.vehicle}|${d.site}|${crewed}|${flown}`;
    if (key === this.modelKey && this.lastFlight === mc.flight) return;
    const vehicleChanged = key !== this.modelKey;
    this.modelKey = key;
    this.lastFlight = mc.flight;
    const v = vehicleById[d.vehicle];
    const site = siteById[d.site];
    if (vehicleChanged || this.siteId !== site.id) {
      this.siteId = site.id;
      this.frame = padFrame(site);
      this.buildPad(site, v);
    }
    // a fresh vehicle on the pad
    if (this.model) this.world.remove(this.model.root);
    for (const p of this.plumes) p.mesh.removeFromParent();
    this.plumes = [];
    for (const r of this.returners.values()) r.obj.removeFromParent();
    this.returners.clear();
    for (const d2 of this.debris) d2.mesh.removeFromParent();
    this.debris = [];
    this.seen.clear();
    this.smoke.clear();
    this.landing.clear();
    this.landingSet = null;
    this.boom = 0;
    const m = buildVehicle(v, crewed, flown);
    this.model = m;
    this.world.add(m.root);
    // plumes: one per engine group
    const addPlume = (obj: THREE.Object3D, group: "b" | "c" | "u", y: number, r: number, len: number, seed: number) => {
      const p = plumeMesh(seed, group === "u" ? "#e8f0ff" : "#fff1cc", group === "u" ? "#8fb4ff" : v.stages[0].engine.includes("RS-25") || v.kit === "ariane" ? "#ffd6a8" : v.kit === "starship" ? "#7aa6ff" : "#ff7d2e");
      p.position.y = y;
      obj.add(p);
      this.plumes.push({ mesh: p, group, obj, y, r, len });
    };
    const R = v.diameter / 2;
    addPlume(m.core, "c", -0.8, R * 0.95, v.height * 0.9, 1);
    for (const [i, b] of m.boosters.entries()) addPlume(b, "b", -0.5, v.kit === "atlas" ? 0.8 : v.kit === "soyuz" ? 0.9 : R * 0.9, v.height * 0.8, 2 + i);
    addPlume(m.upper, "u", m.upperBase - 2.5, R * 0.45, v.height * 0.5, 9);
  }

  /** visible altitude band crossfade between the flat ground and the round planet */
  private updateEnvironment(jd: number, camAltM: number) {
    const fr = this.frame;
    const s = O.sunDir(jd);
    const sl = dirLocal(fr, s, jd, this.tmp).clone();
    this.sun.position.copy(sl).multiplyScalar(5000).add(this.camLook);
    this.sun.target.position.copy(this.camLook);
    const day = THREE.MathUtils.smoothstep(sl.y, -0.12, 0.12);
    this.sun.intensity = 3.2 * day;
    this.sun.color.setHSL(0.09, 0.6 * (1 - THREE.MathUtils.smoothstep(sl.y, 0.05, 0.4)), 0.6 + 0.3 * day);
    this.hemi.intensity = 0.15 + 0.6 * day;
    this.scene.environmentIntensity = 0.08 + 0.75 * day;
    this.hemi.color.set(day > 0.5 ? "#9cc4ff" : "#2a3550");
    this.skyMat.uniforms.uSun.value.copy(sl);
    this.skyMat.uniforms.uAlt.value = camAltM / 1000;
    this.skyMat.uniforms.uDip.value = camAltM > 0 ? Math.acos(RE / (RE + camAltM)) : 0;
    this.groundMat.uniforms.uSun.value.copy(sl);
    this.groundMat.uniforms.uDay.value = day;
    // the same haze the planet shader fades to, so the flat pad ground melts into the round Earth
    this.groundMat.uniforms.uHaze.value.setRGB(0.008, 0.012, 0.025).lerp(new THREE.Color(0.55, 0.68, 0.92), THREE.MathUtils.smoothstep(sl.y, -0.1, 0.25));
    const fade = 1 - THREE.MathUtils.smoothstep(camAltM, 9000, 26_000);
    this.groundMat.uniforms.uOpacity.value = fade;
    this.ground.visible = fade > 0.01;
    const su = this.skyMat.uniforms;
    su.uCam.value.set(this.camPos.x / 1000, this.camPos.y / 1000 + O.RE, this.camPos.z / 1000);
    (su.uRot.value as THREE.Matrix3).set(fr.E.x, fr.U.x, -fr.N.x, fr.E.y, fr.U.y, -fr.N.y, fr.E.z, fr.U.z, -fr.N.z);
    su.uTime.value = this.t;
    this.stars.visible = false;
    const smokeU = this.smoke.mat.uniforms;
    smokeU.uSun.value.copy(sl);
    smokeU.uLight.value.setRGB(1, 0.97, 0.92).multiplyScalar(0.2 + 0.95 * day);
    smokeU.uAmb.value.setRGB(0.3, 0.36, 0.46).multiplyScalar(0.25 + 0.75 * day);
    for (const l of this.padLights) l.intensity = (1 - day) * (1 - day) * 9e4;
    // night lighting: floods, their beams in the haze, the blinking obstruction lights
    const night = (this.night = (1 - day) * (1 - day));
    const lowCam = 1 - THREE.MathUtils.smoothstep(camAltM, 3000, 12_000);
    this.groundMat.uniforms.uLamps.value = night;
    this.groundMat.uniforms.uTime.value = this.t;
    for (const b of this.beams) {
      (b.material as THREE.ShaderMaterial).uniforms.uI.value = night * 0.16 * lowCam;
      b.visible = night > 0.02;
    }
    for (const g of this.lampGlows) {
      g.material.opacity = 0.25 + 0.75 * night;
      g.material.color.setRGB(1, 0.94, 0.85).multiplyScalar(0.4 + 1.6 * night);
    }
    const blink = Math.sin(this.t * Math.PI * 2 * 0.5) > 0 ? 1 : 0.08;
    for (const b of this.beacons) b.material.color.setRGB(1, 0.16, 0.1).multiplyScalar((0.4 + 3 * night) * blink);
    return day;
  }

  update(dt: number) {
    this.t += dt;
    this.ensure();
    const m = this.model!;
    const f = mc.flight;
    const s = useMC.getState();
    const jd = mc.jd;
    const fr = this.frame;
    const site = siteById[this.siteId];
    const v = vehicleById[(mc.pending?.draft ?? s.draft).vehicle];
    const w = weather(site, jd);
    const windA = w.dir * D2R;
    const wind = new THREE.Vector3(-Math.sin(windA), 0, Math.cos(windA)).multiplyScalar(w.wind * 0.514);
    const rocketPos = this.tmp2.set(0, 0, 0);
    const up = new THREE.Vector3(0, 1, 0);
    let vac = 0;
    // —— the vehicle ——
    if (f) {
      toLocal(fr, f.r, f.jd, rocketPos);
      dirLocal(fr, f.dir, f.jd, up);
      vac = 1 - Math.min(1, f.pAmb / 101325) ** 0.35;
      // staging events
      const ev = (id: string) => f.events.some((e) => e.id === id) && !this.seen.has(id) && (this.seen.add(id), true);
      const vLocal = new THREE.Vector3();
      const vl = () => {
        dirLocal(fr, f.v, f.jd, vLocal).multiplyScalar(O.len(f.v));
        // subtract the pad's motion (Earth rotation) — we are in the rotating frame
        const om = O.v3(-O.OMEGA_E * f.r.y, O.OMEGA_E * f.r.x, 0);
        const vo = new THREE.Vector3();
        dirLocal(fr, om, f.jd, vo).multiplyScalar(O.len(om));
        return vLocal.sub(vo);
      };
      if (ev("beco") || (!f.bOn && m.boosters.length && m.boosters[0].parent === m.root)) {
        for (const [i, b] of m.boosters.entries()) {
          const wp = new THREE.Vector3();
          b.getWorldPosition(wp);
          const world = wp.add(this.focus);
          m.root.remove(b);
          this.world.add(b);
          b.quaternion.copy(m.root.quaternion);
          const out = new THREE.Vector3(b.position.x, 0, b.position.z).normalize();
          const ret = f.recov.find((r) => r.label === (i ? "Side booster B" : "Side booster A"));
          if (ret) this.attachReturner(ret, b, v.height * 0.6);
          else this.debris.push({ mesh: b, p: world, v: vl().add(out.applyQuaternion(m.root.quaternion).multiplyScalar(6)), w: new THREE.Vector3(out.z, 0, -out.x).multiplyScalar(0.35), t: 0 });
        }
        for (const p of this.plumes) if (p.group === "b") p.mesh.visible = false;
      }
      if (!f.cOn && m.core.parent === m.root) {
        m.root.remove(m.core);
        this.world.add(m.core);
        m.core.quaternion.copy(m.root.quaternion);
        const ret = f.recov.find((r) => r.mode !== "expend" && r.label !== "Side booster A" && r.label !== "Side booster B") ?? f.recov.find((r) => r.label === "First stage" || r.label === "Center core" || r.label === "Super Heavy");
        if (ret) this.attachReturner(ret, m.core, m.coreLen);
        else this.debris.push({ mesh: m.core, p: rocketPos.clone(), v: vl().multiplyScalar(0.98), w: new THREE.Vector3(0.02, 0, 0.05), t: 0 });
      }
      if (!f.fairingOn && m.fairing.length && m.fairing[0].parent) {
        for (const [i, half] of m.fairing.entries()) {
          const wp = new THREE.Vector3();
          half.getWorldPosition(wp);
          half.removeFromParent();
          this.world.add(half);
          half.quaternion.copy(m.root.quaternion);
          const side = new THREE.Vector3(i % 2 ? 1 : -1, 0, 0).applyQuaternion(m.root.quaternion);
          this.debris.push({ mesh: half, p: wp.add(this.focus), v: vl().add(side.multiplyScalar(3)), w: new THREE.Vector3(0, 0, i % 2 ? 0.4 : -0.4), t: 0 });
        }
      }
      if ((f.result === "failed" || f.phase === "failed") && !this.boom && f.alt < 100_000) {
        this.boom = this.t;
        for (let k = 0; k < 160; k++) {
          const d = new THREE.Vector3().randomDirection();
          this.smoke.spawn(rocketPos.x, rocketPos.y, rocketPos.z, d.x * 60, d.y * 60, d.z * 60, 10, 18, 25 + Math.random() * 20, 1);
        }
        m.root.visible = false;
      }
      if (f.result === "aborted") m.core.visible = f.alt > 0 && this.t - this.boom < 9999;
    } else {
      // count: on the pad; the strongback swings back at T-4 min
      rocketPos.set(0, 0, 0);
      up.set(0, 1, 0);
    }
    m.root.position.copy(rocketPos);
    this.quat.setFromUnitVectors(this.Y, up);
    m.root.quaternion.copy(this.quat);
    if (this.strongback) {
      const tm = s.ops.phase === "count" ? s.ops.tMinus : s.ops.phase === "idle" ? 9999 : 0;
      const ang = tm < 300 ? Math.min(1, (300 - tm) / 30) * 0.32 : 0;
      this.strongback.rotation.z = ang;
      this.strongback.position.x = -(v.diameter / 2 + 1.5) * 0 - ang * 4;
    }
    // —— plumes and the upper-stage nozzle glow ——
    const thr = { b: f ? f.thrB * (f.bOn ? 1 : 0) : 0, c: f ? f.thrC * (f.cOn ? 1 : 0) : 0, u: f ? f.thrU : 0 };
    const preIgn = s.ops.phase === "count" && s.ops.tMinus < 3 ? (3 - s.ops.tMinus) / 3 : 0;
    if (!f) thr.c = preIgn * 0.9;
    if (!f && preIgn && v.boosters && !v.boosters.solid) thr.b = preIgn * 0.9;
    for (const p of this.plumes) {
      const t = thr[p.group];
      // a vacuum engine plume is almost transparent: a faint blue haze, not a cone of smoke
      setPlume(p.mesh, p.group === "u" ? t * 0.3 : t, vac, p.r, p.len * (0.5 + 0.5 * t), this.t);
      if (p.group === "u") p.mesh.visible = t > 0.01;
      if (p.group === "b" && p.obj.parent !== m.root) p.mesh.visible = false;
      if (p.group === "c" && p.obj.parent !== m.root) p.mesh.visible = false;
    }
    if (m.nozzleUpper) {
      const mat = m.nozzleUpper.material as THREE.MeshStandardMaterial;
      const target = thr.u > 0 ? 1.1 : 0;
      mat.emissiveIntensity += (target - mat.emissiveIntensity) * Math.min(1, dt * 0.25);
    }
    // —— returners (boosters flying home) ——
    for (const [ret, o] of this.returners) {
      toLocal(fr, ret.r, f!.jd, this.tmp);
      o.obj.position.copy(this.tmp);
      const vAtm = O.v3(-O.OMEGA_E * ret.r.y, O.OMEGA_E * ret.r.x, 0);
      const vRel = O.sub(ret.v, vAtm);
      const nose = new THREE.Vector3();
      if (ret.burning) dirLocal(fr, ret.dir, f!.jd, nose);
      else if (O.len(vRel) > 30) dirLocal(fr, O.mul(vRel, -1), f!.jd, nose);
      else nose.set(0, 1, 0);
      const q = new THREE.Quaternion().setFromUnitVectors(this.Y, nose);
      o.obj.quaternion.slerp(q, Math.min(1, dt * 1.2));
      const pa = 1 - Math.min(1, atmP(ret.h) / 101325) ** 0.35;
      setPlume(o.plume, ret.burning ? 1 : 0, pa, o.len > 60 ? 3 : 1.4, o.len * (ret.phase === "landing" ? 0.35 : 0.6), this.t);
      const deploy = ret.phase === "landing" ? Math.min(1, (o.legs[0]?.rotation.x ?? 0) + dt * 0.8) : 0;
      for (const l of o.legs) l.rotation.x = -deploy * 1.9;
      if (ret.phase === "landing" && ret.h < 1500 && ret.h > 0) {
        const gp = groundBelow(o.obj.position);
        for (let k = 0; k < 3; k++) this.smoke.spawn(gp.x + (Math.random() - 0.5) * 6, gp.y + 2, gp.z + (Math.random() - 0.5) * 6, (Math.random() - 0.5) * 40, 2, (Math.random() - 0.5) * 40, 4, 6, 6, 0.6);
      }
      // the landing site appears under the booster on the way down
      if (ret.h < 25_000 && !ret.done && this.landingSet !== ret && (ret.mode === "asds" || ret.mode === "rtls" || ret.mode === "catch")) this.placeLanding(ret, o.obj.position);
      if (this.landingSet === ret && ret.h > 400 && !ret.done) {
        const g = groundBelow(o.obj.position);
        this.landing.position.lerp(g, Math.min(1, dt * 0.6));
        this.landing.quaternion.setFromUnitVectors(this.Y, g.clone().add(new THREE.Vector3(0, RE, 0)).normalize());
      }
    }
    // —— debris (fairing halves, spent stages) ——
    for (const d of this.debris) {
      d.t += dt;
      const r = d.p.clone().add(new THREE.Vector3(0, RE, 0));
      const g = r.clone().normalize().multiplyScalar(-9.6);
      d.v.addScaledVector(g, dt);
      d.p.addScaledVector(d.v, dt);
      d.mesh.position.copy(d.p);
      d.mesh.rotateX(d.w.x * dt);
      d.mesh.rotateZ(d.w.z * dt);
      if (d.t > 300) d.mesh.visible = false;
    }
    // —— smoke: liftoff clouds, contrail, LOX venting ——
    const liftT = f ? f.t : s.ops.phase === "count" ? -s.ops.tMinus : -999;
    if (liftT > -2.5 && liftT < 14 && (!f || f.alt < 400)) {
      const rate = Math.round(dt * (f ? 90 : 40));
      for (let k = 0; k < rate; k++) {
        const side = Math.random() < 0.7 ? 1 : -1;
        const sp = 30 + Math.random() * 50;
        this.smoke.spawn((Math.random() - 0.5) * 12, 2 + Math.random() * 3, side * (14 + Math.random() * 10), (Math.random() - 0.5) * 18, 4 + Math.random() * 10, side * sp, 6 + Math.random() * 4, 10 + Math.random() * 6, 45 + Math.random() * 30, 1);
      }
    }
    // exhaust trail: laid continuously along the path behind the plume while the air is thick
    const tail = rocketPos.clone().addScaledVector(up, -v.height * 0.55);
    if (f && (f.cOn || f.bOn) && f.thrC + f.thrB > 0 && f.alt < 16_000) {
      if (!this.trailAt) this.trailAt = tail.clone();
      const gap = Math.max(3, v.diameter * 1.1) * (1 + f.alt / 4000);
      const d = this.trailAt.distanceTo(tail);
      const n = Math.min(40, Math.floor(d / gap));
      for (let k = 1; k <= n; k++) {
        const p = this.trailAt.clone().lerp(tail, k / Math.max(1, d / gap));
        this.smoke.spawn(p.x + (Math.random() - 0.5) * 2, p.y, p.z + (Math.random() - 0.5) * 2, (Math.random() - 0.5) * 3, -1, (Math.random() - 0.5) * 3, gap * 1.7, 1.6 + f.alt / 2500, 70 + Math.random() * 40, 0.15);
      }
      if (n) this.trailAt.copy(this.trailAt.clone().lerp(tail, (n * gap) / Math.max(d, 1e-3)));
    } else this.trailAt = null;
    if (!f && s.ops.phase === "count" && s.ops.tMinus < 2100 && Math.random() < dt * 6) {
      const y = Math.random() < 0.6 ? m.coreLen * (0.4 + Math.random() * 0.5) : m.upperBase + 2;
      const a = Math.random() * Math.PI * 2;
      this.smoke.spawn(Math.cos(a) * v.diameter * 0.55, y, Math.sin(a) * v.diameter * 0.55, Math.cos(a) * 0.6, -1.6, Math.sin(a) * 0.6, 1.2, 1.6, 9, 0);
    }
    // sound suppression: the deluge floods the deck from T−6 s and the exhaust flashes it to steam
    if (liftT > -6 && liftT < 9 && (!f || f.alt < 300)) {
      const hot = liftT > -2.5 ? 1 : 0.35;
      const rate = Math.round(dt * 70 * hot) + (Math.random() < dt * 70 * hot % 1 ? 1 : 0);
      for (let k = 0; k < rate; k++) {
        const a = Math.random() * Math.PI * 2, r = v.diameter * (0.8 + Math.random() * 2);
        const out = 6 + Math.random() * 14 * hot;
        this.smoke.spawn(Math.cos(a) * r, 0.5, Math.sin(a) * r, Math.cos(a) * out, 6 + Math.random() * 16 * hot, Math.sin(a) * out, 3 + Math.random() * 3, 6 + Math.random() * 5, 18 + Math.random() * 14, 0.35 * hot);
      }
    }
    // —— plume light ——
    const totalF = f ? f.fB + f.fC : preIgn * 5e6;
    this.plumeLight.intensity = Math.min(2.6e4, totalF * 1.6e-3) * (1 - vac);
    this.plumeLight.position.copy(rocketPos).addScaledVector(up, -10);
    this.smoke.mat.uniforms.uGlow.value = Math.min(1, totalF / 4e7) * (1 - vac);
    // the plume floods the pad with orange light while the vehicle is still close to it
    const gu = this.groundMat.uniforms;
    const near = 1 - THREE.MathUtils.smoothstep(rocketPos.y, 80, 1500);
    gu.uBlast.value = Math.min(1, totalF / 6e6) * near * (0.4 + 0.6 * this.night) * (0.9 + 0.1 * Math.sin(this.t * 41));
    gu.uBlastAt.value.set(rocketPos.x, -rocketPos.z);
    // engine flare: the brightest thing in any night shot
    const thrAll = Math.max(thr.b, thr.c, thr.u);
    this.flare.visible = thrAll > 0.02 && m.root.visible;
    if (this.flare.visible) {
      const below = thr.c > 0.02 || thr.b > 0.02 ? -2 : m.upperBase - 3;
      this.flare.position.copy(rocketPos).addScaledVector(up, below);
      const dist = Math.max(1, this.camPos.distanceTo(this.flare.position));
      const sz = Math.min(dist * 0.03, v.diameter * (thr.c > 0.02 ? 4 : 2.2)) * (0.7 + 0.3 * thrAll) * (0.6 + 0.6 * this.night) * (1 - 0.5 * vac);
      this.flare.scale.setScalar(sz * (0.95 + 0.05 * Math.sin(this.t * 53)));
      this.flare.material.color.setRGB(1, 0.72, 0.42).multiplyScalar(thr.c > 0.02 || thr.b > 0.02 ? 1.6 : 0.6);
    }

    // —— camera ——
    const mode = s.feedCam === "auto" ? autoCam(f) : s.feedCam;
    const camAlt = this.placeCamera(mode, f, rocketPos, up, m, dt);
    // shadows only read in the wide pad shot
    if (mode === "pad" && camAlt < 2000) this.sun.shadow.needsUpdate = true;
    // floating origin
    this.focus.copy(this.camPos);
    this.world.position.copy(this.focus).multiplyScalar(-1);
    this.camera.position.set(0, 0, 0);
    this.camera.up.copy(this.camUp);
    this.camera.lookAt(this.tmp.copy(this.camLook).sub(this.focus));
    this.camera.fov = this.camFov;
    this.camera.near = Math.max(0.3, Math.min(50, this.camPos.distanceTo(this.camLook) * 0.004));
    this.camera.updateProjectionMatrix();
    this.sky.position.set(0, 0, 0);
    this.stars.position.set(0, 0, 0);
    this.updateEnvironment(f ? f.jd : jd, camAlt);
    this.smoke.update(dt, wind, this.focus, this.camPos);
    this.plumeLight.position.sub(this.focus);
    this.sun.position.sub(this.focus);
    this.sun.target.position.sub(this.focus);
    this.sun.shadow.camera.left = this.sun.shadow.camera.bottom = -140;
    this.sun.shadow.camera.right = this.sun.shadow.camera.top = 140;
    this.sun.shadow.camera.far = 12000;
    this.sun.shadow.camera.updateProjectionMatrix();

    // —— the downlink and the camera chain ——
    const los = performance.now() < mc.losUntil;
    const onboard = mode === "onboard" || mode === "booster";
    // onboard video rides a narrow link: it breaks up now and then, and badly far downrange
    if (onboard && f) {
      this.dropT -= dt;
      if (this.dropT <= 0) {
        this.dropT = 2 + Math.random() * 7;
        this.glitch = Math.random() < 0.3 + Math.min(0.5, f.t / 1200) ? 0.25 + Math.random() * 0.5 : 0;
      }
      this.glitch *= Math.exp(-dt * 1.4);
    } else this.glitch = 0;
    const pu = this.post.material.uniforms;
    pu.uTime.value = this.t;
    pu.uGlitch.value = los ? 0.9 : Math.min(1, this.glitch);
    pu.uGrain.value = (mode === "tracking" ? 0.06 : onboard ? 0.08 : 0.035) * (1 + this.night * 1.5);
    pu.uCA.value = mode === "tracking" ? 0.003 : onboard ? 0.004 : 0.0015;
    pu.uFish.value = onboard ? 1 : 0;
    // heat haze: the long lens looks through kilometres of warm air; the pad camera through the exhaust
    const lowAlt = f ? 1 - THREE.MathUtils.smoothstep(f.alt, 200, 3000) : 0;
    pu.uShimmer.value = onboard ? 0 : mode === "tracking" ? 0.5 + (1 - this.night) * 0.5 + lowAlt : lowAlt * Math.min(1, totalF / 5e6) * 1.6;
    pu.uShimmerY.value = 0.45;
    this.drawOsd(mode, f, los, s.ops.phase === "count" ? -s.ops.tMinus : f ? f.t : null, jd, site);

    const r = this.renderer;
    const prev = r.getRenderTarget();
    // a lost signal freezes the last good frame
    if (!los) {
      r.setRenderTarget(this.raw);
      r.clear();
      r.render(this.scene, this.camera);
    }
    r.setRenderTarget(this.rt);
    r.render(this.postScene, this.postCam);
    r.setRenderTarget(prev);
  }

  /** the burnt-in camera caption, redrawn only when its text changes */
  private drawOsd(mode: string, f: Flight | null, los: boolean, met: number | null, jd: number, site: Site) {
    const v = vehicleById[(mc.pending?.draft ?? useMC.getState().draft).vehicle];
    const dist = mode === "tracking" ? this.camPos.distanceTo(this.camLook) : 0;
    const cam =
      mode === "pad" ? `CAM 2 · ${site.short} PAD PERIMETER`
      : mode === "tracking" ? `LRT-3 TRACKER · ${(dist / 1000).toFixed(1)} KM · ${this.camFov < 1 ? "2000" : this.camFov < 4 ? "800" : "300"} MM`
      : mode === "onboard" ? `${v.kit === "starship" ? "SHIP" : "STAGE 2"} ONBOARD · AFT`
      : `${v.kit === "starship" ? "BOOSTER" : "STAGE 1"} ONBOARD · AFT`;
    const sec = Math.floor(met ?? 0);
    const g = O.dateOf(jd);
    const tc = `${String(g.getUTCHours()).padStart(2, "0")}:${String(g.getUTCMinutes()).padStart(2, "0")}:${String(g.getUTCSeconds()).padStart(2, "0")}`;
    const metTxt = met === null ? "" : `${met < 0 ? "T−" : "T+"}${String(Math.floor(Math.abs(sec) / 3600)).padStart(2, "0")}:${String(Math.floor((Math.abs(sec) % 3600) / 60)).padStart(2, "0")}:${String(Math.abs(sec) % 60).padStart(2, "0")}`;
    const alt = f && mode !== "pad" ? `ALT ${(f.alt / 1000).toFixed(1)} KM` : "";
    const blink = Math.floor(this.t * 1.2) % 2 === 0;
    const key = `${cam}|${tc}|${metTxt}|${alt}|${los}|${blink}`;
    if (key === this.osdKey) return;
    this.osdKey = key;
    const c = this.osd.getContext("2d")!;
    const W = this.osd.width, H = this.osd.height;
    c.clearRect(0, 0, W, H);
    c.font = "600 14px 'JetBrains Mono', ui-monospace, Consolas, monospace";
    c.textBaseline = "top";
    const txt = (s: string, x: number, y: number, align: CanvasTextAlign = "left", color = "rgba(255,255,255,0.86)") => {
      c.textAlign = align;
      c.fillStyle = "rgba(0,0,0,0.55)";
      c.fillText(s, x + 1.5, y + 1.5);
      c.fillStyle = color;
      c.fillText(s, x, y);
    };
    txt(cam, 26, 22);
    if (los) txt("NO SIGNAL · HOLDING LAST FRAME", W / 2, H / 2 - 10, "center", "rgba(255,190,80,0.95)");
    else {
      if (blink) {
        c.fillStyle = "#ff3b30";
        c.beginPath();
        c.arc(W - 92, 32, 6, 0, Math.PI * 2);
        c.fill();
      }
      txt("LIVE", W - 26, 22, "right");
    }
    txt(`${tc} UTC`, 26, H - 40);
    if (metTxt) txt(metTxt, W - 26, H - 40, "right");
    if (alt) txt(alt, W - 26, H - 64, "right", "rgba(255,255,255,0.7)");
    // framing corners on the long-lens tracker
    if (mode === "tracking") {
      c.strokeStyle = "rgba(255,255,255,0.5)";
      c.lineWidth = 2;
      const bx = W / 2, by = H / 2, s = 60, l = 14;
      for (const [sx, sy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
        c.beginPath();
        c.moveTo(bx + sx * s, by + sy * (s - l));
        c.lineTo(bx + sx * s, by + sy * s);
        c.lineTo(bx + sx * (s - l), by + sy * s);
        c.stroke();
      }
    }
    this.osdTex.needsUpdate = true;
  }

  private attachReturner(ret: Returner, obj: THREE.Group, len: number) {
    const plume = plumeMesh(7, "#fff1cc", "#ff8a3a");
    plume.position.y = -0.8;
    obj.add(plume);
    const legs: THREE.Mesh[] = [];
    obj.traverse((o) => {
      if ((o as THREE.Mesh).isMesh && (o as THREE.Mesh).geometry.type === "BoxGeometry" && (o.parent as THREE.Group)?.isGroup && o.parent !== obj && o.position.y === 0) legs.push(o as THREE.Mesh);
    });
    this.returners.set(ret, { obj, plume, legs: this.model?.legs.filter((l) => obj.getObjectById(l.id)) ?? legs, len });
    for (const fin of this.model?.fins ?? []) if (obj.getObjectById(fin.id)) fin.rotation.x = 0.4;
  }

  private placeLanding(ret: Returner, at: THREE.Vector3) {
    this.landingSet = ret;
    this.landing.clear();
    const kind = ret.mode === "asds" ? "asds" : "lz";
    if (ret.mode === "catch") {
      const t = this.tower.clone();
      t.position.set(-12, -3, 0);
      this.landing.add(t);
      const deck = new THREE.Mesh(new THREE.CylinderGeometry(16, 16, 3, 32), stdMat("#9e9a92", 0.9));
      deck.position.y = -1.5;
      this.landing.add(deck);
    } else {
      const deck = new THREE.Mesh(new THREE.BoxGeometry(kind === "asds" ? 91 : 86, 3, kind === "asds" ? 52 : 86), [stdMat("#2b2f33"), stdMat("#2b2f33"), new THREE.MeshStandardMaterial({ map: kind === "asds" ? this.asdsTex : this.lzTex, roughness: 0.8 }), stdMat("#2b2f33"), stdMat("#2b2f33"), stdMat("#2b2f33")]);
      deck.position.y = kind === "asds" ? -1.5 : -2.9;
      this.landing.add(deck);
      if (kind === "asds") {
        for (const s of [-1, 1]) {
          const wall = new THREE.Mesh(new THREE.BoxGeometry(91, 4, 1.2), stdMat("#3d4247", 0.7, 0.3));
          wall.position.set(0, 1, s * 25.6);
          this.landing.add(wall);
        }
        const hull = new THREE.Mesh(new THREE.BoxGeometry(95, 6, 56), stdMat("#1e2226", 0.8));
        hull.position.y = -6;
        this.landing.add(hull);
      }
    }
    this.landing.position.copy(groundBelow(at));
    this.landing.quaternion.setFromUnitVectors(this.Y, this.landing.position.clone().add(new THREE.Vector3(0, RE, 0)).normalize());
  }

  private placeCamera(mode: string, f: Flight | null, rp: THREE.Vector3, up: THREE.Vector3, m: VehicleModel, dt: number) {
    const v = vehicleById[(mc.pending?.draft ?? useMC.getState().draft).vehicle];
    const H = v.height;
    const az = f ? 0 : 0;
    void az;
    const lerp = (a: THREE.Vector3, b: THREE.Vector3, k: number) => a.lerp(b, 1 - Math.exp(-dt * k));
    const snap = this.camMode !== mode;
    this.camMode = mode;
    const pos = new THREE.Vector3();
    const look = new THREE.Vector3();
    let fov = 30;
    this.camUp.set(0, 1, 0);
    if (mode === "pad") {
      pos.set(260, 6, -330);
      look.copy(rp).addScaledVector(up, H * 0.45);
      const d = pos.distanceTo(look);
      fov = THREE.MathUtils.clamp((2 * Math.atan((H * 1.25) / d) * 180) / Math.PI, 5, 42);
      pos.y += Math.sin(this.t * 0.7) * 0.15;
    } else if (mode === "tracking") {
      // a long-lens tracker 6 km off the flight line
      pos.set(-4200, 12, -4300);
      look.copy(rp).addScaledVector(up, H * 0.2);
      const d = pos.distanceTo(look);
      const frame = H * 2.1;
      fov = THREE.MathUtils.clamp((2 * Math.atan(frame / 2 / d) * 180) / Math.PI, 0.25, 30);
      look.x += Math.sin(this.t * 1.7) * d * 0.0004;
      look.y += Math.sin(this.t * 2.3) * d * 0.0003;
    } else if (mode === "onboard") {
      // a ride-along camera on the skin looking aft: down the side of the first stage while it burns,
      // then at the glowing vacuum bell once the upper stage is alone
      const side = new THREE.Vector3(1, 0, 0).applyQuaternion(m.root.quaternion);
      const R = v.diameter / 2;
      if (m.core.parent === m.root) {
        pos.copy(rp).addScaledVector(up, m.coreLen - 1.5).addScaledVector(side, R + 0.45);
        look.copy(rp).addScaledVector(up, -60).addScaledVector(side, R + 9);
        fov = 78;
      } else {
        pos.copy(rp).addScaledVector(up, m.upperBase - 0.15).addScaledVector(side, R + 0.3);
        look.copy(rp).addScaledVector(up, m.upperBase - 9).addScaledVector(side, -R * 0.1);
        fov = 72;
      }
      // the camera is bolted to the vehicle: it rolls and pitches with it
      this.camUp.set(0, 0, 1).applyQuaternion(m.root.quaternion);
    } else {
      const ret = [...this.returners.keys()].find((r) => !r.done) ?? [...this.returners.keys()][0];
      const o = ret ? this.returners.get(ret) : null;
      if (o && ret) {
        const ax = new THREE.Vector3(0, 1, 0).applyQuaternion(o.obj.quaternion);
        const side = new THREE.Vector3(1, 0, 0).applyQuaternion(o.obj.quaternion);
        // on the interstage, looking down the booster at its engines, the legs and the ground coming up
        pos.copy(o.obj.position).addScaledVector(ax, o.len - 2.5).addScaledVector(side, v.diameter / 2 + 0.45);
        look.copy(o.obj.position).addScaledVector(ax, -o.len * 0.9).addScaledVector(side, v.diameter / 2 + 7);
        fov = 78;
        this.camUp.set(0, 0, 1).applyQuaternion(o.obj.quaternion);
      } else {
        pos.set(260, 6, -330);
        look.copy(rp);
      }
    }
    // a tracking mount locks on: aim straight at the vehicle, only the zoom eases
    if (snap || mode !== "pad") {
      this.camPos.copy(pos);
      this.camLook.copy(look);
    } else {
      lerp(this.camPos, pos, 4);
      lerp(this.camLook, look, 6);
    }
    if (snap || mode === "onboard" || mode === "booster") this.camFov = fov;
    else this.camFov += (fov - this.camFov) * (1 - Math.exp(-dt * 2.5));
    // altitude of the camera above the ellipsoid
    const c = this.camPos.clone().add(new THREE.Vector3(0, RE, 0));
    return c.length() - RE;
  }

  dispose() {
    this.rt.dispose();
    this.raw.dispose();
    this.osdTex.dispose();
    this.post.geometry.dispose();
    this.post.material.dispose();
    this.scene.traverse((o) => {
      const mm = o as THREE.Mesh;
      mm.geometry?.dispose();
      const mat = mm.material as THREE.Material | THREE.Material[] | undefined;
      if (Array.isArray(mat)) mat.forEach((x) => x.dispose());
      else mat?.dispose();
    });
  }
}

function atmP(h: number) {
  return 101325 * Math.exp(-Math.max(0, h) / 7200);
}

/** the point on the round Earth directly below a local-frame position (Earth centre at (0, −RE, 0)) */
function groundBelow(p: THREE.Vector3) {
  const c = new THREE.Vector3(0, -RE, 0);
  return p.clone().sub(c).normalize().multiplyScalar(RE).add(c);
}
