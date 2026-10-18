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

const smokeTex = () =>
  canvasTex(128, 128, (c) => {
    const g = c.createRadialGradient(64, 64, 4, 64, 64, 62);
    g.addColorStop(0, "rgba(255,255,255,1)");
    g.addColorStop(0.45, "rgba(255,255,255,0.65)");
    g.addColorStop(1, "rgba(255,255,255,0)");
    c.fillStyle = g;
    c.fillRect(0, 0, 128, 128);
    for (let i = 0; i < 260; i++) {
      const a = Math.random() * Math.PI * 2, r = Math.random() * 50;
      c.fillStyle = `rgba(0,0,0,${Math.random() * 0.12})`;
      c.beginPath();
      c.arc(64 + Math.cos(a) * r, 64 + Math.sin(a) * r, 3 + Math.random() * 9, 0, Math.PI * 2);
      c.fill();
    }
  }, false);

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
  const m = lathe([[rExit * 0.35, 0], [rExit * 0.42, -len * 0.25], [rExit * 0.7, -len * 0.6], [rExit, -len], [rExit * 0.97, -len]], mat, 24);
  return m;
}

function stdMat(color: string, rough = 0.55, metal = 0.05, extra: Partial<THREE.MeshStandardMaterialParameters> = {}) {
  return new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal, ...extra });
}

export function buildVehicle(v: Vehicle, crewed: boolean): VehicleModel {
  const root = new THREE.Group();
  const core = new THREE.Group();
  const upper = new THREE.Group();
  root.add(core, upper);
  const boosters: THREE.Group[] = [];
  const fairing: THREE.Mesh[] = [];
  const legs: THREE.Mesh[] = [];
  const fins: THREE.Mesh[] = [];
  const P = v.paint;
  const body = stdMat(P.body, P.metal ? 0.38 : 0.55, P.metal ? 0.85 : 0.05);
  const inter = stdMat(P.inter, 0.6, P.metal ? 0.8 : 0.1);
  const accent = stdMat(P.accent, 0.5);
  const dark = stdMat("#1b1c1e", 0.7, 0.2);
  const engineMat = stdMat("#3a3532", 0.35, 0.85);
  const nozzleMat = new THREE.MeshStandardMaterial({ color: "#5b4a3d", roughness: 0.3, metalness: 0.9, emissive: new THREE.Color("#ff5a1a"), emissiveIntensity: 0 });
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
    core.add(cyl(R, s1, body, 0));
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
        b.add(cyl(R, s1, body, 0));
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
    float a = fall * edge * flick * uThr * mix(1.0, 0.1, uVac);
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
  const spread = (0.75 + vac * vac * 9) * (1 - 0.25 * (1 - vac));
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
          vUv = uv; vA = aA.x; vH = aH; vSh = aA.y;
          vec4 mv = modelViewMatrix * vec4(aC, 1.0);
          float r = aA.y * 6.2831;
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
          float lit = 0.45 + 0.55 * clamp(uSun.y * 1.4 + (vUv.y - 0.5) * 0.8, 0.0, 1.0);
          vec3 c = mix(uAmb, uLight, lit) * (0.82 + 0.18 * t.r);
          c += vec3(1.0, 0.55, 0.2) * vH * uGlow * 0.7;
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

  constructor(private renderer: THREE.WebGLRenderer, nightTex: THREE.Texture | null, landTex: THREE.Texture | null, quality: number) {
    const w = quality >= 2 ? 1280 : quality === 1 ? 1024 : 768;
    this.rt = new THREE.WebGLRenderTarget(w, Math.round((w * 9) / 16), { type: THREE.HalfFloatType, samples: quality >= 1 ? 4 : 0 });
    this.rt.texture.generateMipmaps = false;
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
      uniforms: { uSun: { value: new THREE.Vector3(0, 1, 0) }, uSea: { value: new THREE.Vector3(1, 0, 0) }, uSeaD: { value: 1500 }, uLand: { value: new THREE.Color("#5f6d3c") }, uHaze: { value: new THREE.Color("#a9c4df") }, uHasSea: { value: 1 }, uOrigin: { value: new THREE.Vector3() }, uDay: { value: 1 }, uOpacity: { value: 1 } },
      transparent: true,
      vertexShader: /* glsl */ `varying vec3 vW; varying vec3 vP; void main(){ vP = position; vec4 w = modelMatrix * vec4(position,1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
      fragmentShader: /* glsl */ `
        uniform vec3 uSun; uniform vec3 uSea; uniform float uSeaD; uniform vec3 uLand; uniform vec3 uHaze; uniform float uHasSea; uniform float uDay; uniform float uOpacity;
        varying vec3 vW; varying vec3 vP;
        float h(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        float n(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f); return mix(mix(h(i), h(i+vec2(1,0)), f.x), mix(h(i+vec2(0,1)), h(i+vec2(1,1)), f.x), f.y); }
        float fbm(vec2 p){ float s = 0.0, a = 0.5; for (int i = 0; i < 5; i++){ s += a * n(p); p *= 2.07; a *= 0.5; } return s; }
        void main(){
          vec2 p = vP.xz;
          float coast = dot(vec2(p.x, -p.y), uSea.xy) - uSeaD + (fbm(p * 0.0007) - 0.5) * 2600.0;
          float water = uHasSea * smoothstep(-40.0, 40.0, coast);
          float beach = uHasSea * (1.0 - smoothstep(0.0, 160.0, abs(coast + 60.0)));
          vec3 land = uLand * (0.75 + 0.5 * fbm(p * 0.004)) * (0.85 + 0.3 * fbm(p * 0.05));
          land = mix(land, vec3(0.62, 0.58, 0.48), beach * 0.7);
          float padD = max(abs(p.x), abs(p.y));
          land = mix(vec3(0.55, 0.54, 0.52) * (0.9 + 0.1 * n(p * 0.5)), land, smoothstep(60.0, 75.0, padD));
          float road = (1.0 - smoothstep(4.0, 6.0, abs(p.y + 0.0))) * step(p.x, -60.0) * step(-2000.0, p.x);
          land = mix(land, vec3(0.32, 0.32, 0.33), road);
          vec3 sea = mix(vec3(0.03, 0.12, 0.2), vec3(0.06, 0.2, 0.28), fbm(p * 0.002));
          vec3 col = mix(land, sea, water);
          float lit = max(uSun.y, 0.0);
          col *= 0.18 + 1.1 * lit;
          vec3 V = normalize(cameraPosition - vW);
          vec3 H = normalize(normalize(uSun) + V);
          col += water * pow(max(H.y, 0.0), 180.0) * 3.0 * uDay;
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
    this.pad.add(new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(mastPts), new THREE.LineBasicMaterial({ color: "#2b2b2b", transparent: true, opacity: 0.6 })));
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
    // pad floodlights
    for (const l of this.padLights) this.scene.remove(l, l.target);
    this.padLights = [];
    for (const [x, z] of [[-120, -90], [130, -100], [0, 140]]) {
      const s = new THREE.SpotLight("#fff1d6", 0, 900, 0.3, 0.7, 2);
      s.position.set(x, 18, z);
      s.target.position.set(0, v.height * 0.5, 0);
      this.pad.add(s, s.target);
      this.padLights.push(s);
      const lamp = new THREE.Mesh(new THREE.BoxGeometry(3, 2, 1), new THREE.MeshBasicMaterial({ color: "#fff4dd" }));
      lamp.position.set(x, 18, z);
      lamp.lookAt(0, 30, 0);
      const pole = cyl(0.35, 18, stdMat("#6f7378", 0.6, 0.5), -3, 0.35, 8);
      pole.position.set(x, 6, z);
      this.pad.add(pole);
      this.pad.add(lamp);
    }
    this.pad.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) {
        o.castShadow = true;
        o.receiveShadow = true;
      }
    });
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
    const key = `${d.vehicle}|${d.site}|${crewed}`;
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
    const m = buildVehicle(v, crewed);
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
      setPlume(p.mesh, t, vac, p.r, p.len * (0.5 + 0.5 * t), this.t);
      if (p.group === "b" && p.obj.parent !== m.root) p.mesh.visible = false;
      if (p.group === "c" && p.obj.parent !== m.root) p.mesh.visible = false;
    }
    if (m.nozzleUpper) {
      const mat = m.nozzleUpper.material as THREE.MeshStandardMaterial;
      const target = thr.u > 0 ? 2.5 : 0;
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
    // —— plume light ——
    const totalF = f ? f.fB + f.fC : preIgn * 5e6;
    this.plumeLight.intensity = Math.min(2.6e4, totalF * 1.6e-3) * (1 - vac);
    this.plumeLight.position.copy(rocketPos).addScaledVector(up, -10);
    this.smoke.mat.uniforms.uGlow.value = Math.min(1, totalF / 4e7) * (1 - vac);

    // —— camera ——
    const mode = s.feedCam === "auto" ? autoCam(f) : s.feedCam;
    const camAlt = this.placeCamera(mode, f, rocketPos, up, m, dt);
    // shadows only read in the wide pad shot
    if (mode === "pad" && camAlt < 2000) this.sun.shadow.needsUpdate = true;
    // floating origin
    this.focus.copy(this.camPos);
    this.world.position.copy(this.focus).multiplyScalar(-1);
    this.camera.position.set(0, 0, 0);
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

    const r = this.renderer;
    const prev = r.getRenderTarget();
    r.setRenderTarget(this.rt);
    r.clear();
    r.render(this.scene, this.camera);
    r.setRenderTarget(prev);
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
      // on the upper stage looking aft
      const side = new THREE.Vector3(1, 0, 0).applyQuaternion(m.root.quaternion);
      pos.copy(rp).addScaledVector(up, m.upperBase + m.upperLen * 0.8).addScaledVector(side, v.diameter / 2 + 3.4);
      look.copy(rp).addScaledVector(up, m.upperBase - 45).addScaledVector(side, v.diameter * 0.55);
      fov = 70;
    } else {
      const ret = [...this.returners.keys()].find((r) => !r.done) ?? [...this.returners.keys()][0];
      const o = ret ? this.returners.get(ret) : null;
      if (o && ret) {
        const ax = new THREE.Vector3(0, 1, 0).applyQuaternion(o.obj.quaternion);
        const side = new THREE.Vector3(1, 0, 0).applyQuaternion(o.obj.quaternion);
        pos.copy(o.obj.position).addScaledVector(ax, o.len * 0.9).addScaledVector(side, v.diameter / 2 + 1.6);
        look.copy(o.obj.position).addScaledVector(ax, -o.len * 1.4).addScaledVector(side, v.diameter * 1.6 + o.len * 0.25);
        fov = 70;
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
