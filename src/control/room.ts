/**
 * The flight control room: four tiers of consoles facing a wall of displays, a glassed-in viewing
 * gallery at the back, acoustic walls, ceiling light coffers and the people on shift. Static
 * geometry is merged per material; chairs and people are instanced.
 */

import * as THREE from "three";
import { RectAreaLightUniformsLib } from "three/examples/jsm/lights/RectAreaLightUniformsLib.js";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { vehicleById } from "./data";
import type { Screens, ScreenId } from "./screens";
import { useMC, type Mission, type ViewId } from "./store";

// ———————————————————————————— textures ————————————————————————————

function tex(w: number, h: number, draw: (c: CanvasRenderingContext2D) => void, repeat: [number, number] = [1, 1]) {
  const cv = document.createElement("canvas");
  cv.width = w;
  cv.height = h;
  draw(cv.getContext("2d")!);
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(...repeat);
  t.anisotropy = 8;
  return t;
}
const rnd = (() => {
  let s = 1234567;
  return () => ((s = (s * 16807) % 2147483647) - 1) / 2147483646;
})();

const carpetTex = () =>
  tex(512, 512, (c) => {
    c.fillStyle = "#1c2330";
    c.fillRect(0, 0, 512, 512);
    for (let i = 0; i < 26000; i++) {
      const v = 20 + rnd() * 30;
      c.fillStyle = `rgb(${v},${v + 6},${v + 16})`;
      c.fillRect(rnd() * 512, rnd() * 512, 1.5, 1.5);
    }
    c.strokeStyle = "rgba(0,0,0,0.35)";
    c.lineWidth = 2;
    c.strokeRect(0, 0, 512, 512);
    c.strokeStyle = "rgba(80,100,130,0.12)";
    for (let k = 0; k < 512; k += 64) {
      c.beginPath();
      c.moveTo(k, 0);
      c.lineTo(k, 512);
      c.stroke();
    }
  });
const fabricTex = () =>
  tex(256, 256, (c) => {
    c.fillStyle = "#3a3f47";
    c.fillRect(0, 0, 256, 256);
    for (let x = 0; x < 256; x += 8) {
      c.fillStyle = x % 32 === 0 ? "#2a2e34" : "#40464f";
      c.fillRect(x, 0, 6, 256);
    }
    for (let i = 0; i < 5000; i++) {
      c.fillStyle = `rgba(255,255,255,${rnd() * 0.04})`;
      c.fillRect(rnd() * 256, rnd() * 256, 1, 2);
    }
  });
const woodTex = () =>
  tex(512, 128, (c) => {
    const g = c.createLinearGradient(0, 0, 0, 128);
    g.addColorStop(0, "#4a3326");
    g.addColorStop(1, "#3b281e");
    c.fillStyle = g;
    c.fillRect(0, 0, 512, 128);
    for (let i = 0; i < 90; i++) {
      c.strokeStyle = `rgba(${20 + rnd() * 30},${10 + rnd() * 15},5,${0.15 + rnd() * 0.25})`;
      c.lineWidth = 1 + rnd() * 2;
      c.beginPath();
      const y = rnd() * 128;
      c.moveTo(0, y);
      c.bezierCurveTo(170, y + (rnd() - 0.5) * 20, 340, y + (rnd() - 0.5) * 20, 512, y + (rnd() - 0.5) * 10);
      c.stroke();
    }
  });
const ceilingTex = () =>
  tex(256, 256, (c) => {
    c.fillStyle = "#23272d";
    c.fillRect(0, 0, 256, 256);
    for (let i = 0; i < 6000; i++) {
      c.fillStyle = `rgba(0,0,0,${rnd() * 0.25})`;
      c.fillRect(rnd() * 256, rnd() * 256, 1, 1);
    }
    c.strokeStyle = "#15181c";
    c.lineWidth = 6;
    c.strokeRect(0, 0, 256, 256);
  });
const panelKeys = () =>
  tex(256, 128, (c) => {
    c.fillStyle = "#14181d";
    c.fillRect(0, 0, 256, 128);
    const cols = ["#c8ff3d", "#ffb020", "#4fd1ff", "#ff4d5e", "#2a333d", "#2a333d", "#2a333d"];
    for (let y = 0; y < 4; y++)
      for (let x = 0; x < 8; x++) {
        c.fillStyle = cols[Math.floor(rnd() * cols.length)];
        c.fillRect(10 + x * 30, 10 + y * 28, 22, 18);
      }
  });

function label(text: string, w = 512, h = 112, color = "#ffd166") {
  return tex(w, h, (c) => {
    c.fillStyle = "#0a0d11";
    c.fillRect(0, 0, w, h);
    c.strokeStyle = "#2b333d";
    c.lineWidth = 6;
    c.strokeRect(3, 3, w - 6, h - 6);
    c.font = `800 ${Math.min(h * 0.56, (w * 0.9) / (text.length * 0.62))}px ui-monospace, monospace`;
    c.fillStyle = color;
    c.textAlign = "center";
    c.textBaseline = "middle";
    c.fillText(text, w / 2, h / 2 + 3);
  });
}

function patch(m: Mission) {
  return tex(256, 256, (c) => {
    const g = c.createRadialGradient(128, 110, 10, 128, 128, 128);
    g.addColorStop(0, "#1d2c4a");
    g.addColorStop(1, "#0b1222");
    c.fillStyle = g;
    c.beginPath();
    c.arc(128, 128, 122, 0, Math.PI * 2);
    c.fill();
    c.lineWidth = 10;
    c.strokeStyle = m.result === "success" ? "#d9b45a" : m.result === "partial" ? "#c9c9c9" : "#7a3030";
    c.stroke();
    c.fillStyle = m.color;
    c.beginPath();
    c.arc(128, 128, 40, 0, Math.PI * 2);
    c.fill();
    c.strokeStyle = "#ffffff";
    c.lineWidth = 3;
    c.beginPath();
    c.ellipse(128, 128, 90, 34, -0.4, 0, Math.PI * 2);
    c.stroke();
    // rocket glyph
    c.fillStyle = "#f2f2f2";
    c.beginPath();
    c.moveTo(128, 46);
    c.lineTo(140, 80);
    c.lineTo(140, 150);
    c.lineTo(116, 150);
    c.lineTo(116, 80);
    c.closePath();
    c.fill();
    c.font = "800 22px ui-monospace, monospace";
    c.textAlign = "center";
    c.fillStyle = "#ffffff";
    c.fillText(m.name.split(" · ")[0], 128, 205);
    c.font = "600 13px ui-monospace, monospace";
    c.fillStyle = "#d9b45a";
    c.fillText(vehicleById[m.vehicle].name.toUpperCase().slice(0, 18), 128, 228);
  });
}

// ———————————————————————————— builder ————————————————————————————

class Merge {
  private parts = new Map<THREE.Material, THREE.BufferGeometry[]>();
  add(geo: THREE.BufferGeometry, mat: THREE.Material, m?: THREE.Matrix4) {
    const g = geo.index ? geo : geo;
    if (m) g.applyMatrix4(m);
    if (!this.parts.has(mat)) this.parts.set(mat, []);
    this.parts.get(mat)!.push(g.index ? g.toNonIndexed() : g);
  }
  box(w: number, h: number, d: number, x: number, y: number, z: number, mat: THREE.Material, rx = 0, ry = 0, uvScale = 0) {
    const g = new THREE.BoxGeometry(w, h, d);
    if (uvScale) {
      const uv = g.getAttribute("uv") as THREE.BufferAttribute;
      const pos = g.getAttribute("position") as THREE.BufferAttribute;
      const nrm = g.getAttribute("normal") as THREE.BufferAttribute;
      for (let i = 0; i < uv.count; i++) {
        const nx = Math.abs(nrm.getX(i)), ny = Math.abs(nrm.getY(i));
        const px = pos.getX(i) + x, py = pos.getY(i) + y, pz = pos.getZ(i) + z;
        if (ny > 0.5) uv.setXY(i, px / uvScale, pz / uvScale);
        else if (nx > 0.5) uv.setXY(i, pz / uvScale, py / uvScale);
        else uv.setXY(i, px / uvScale, py / uvScale);
      }
    }
    this.add(g, mat, new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, 0)), new THREE.Vector3(1, 1, 1)));
  }
  build(group: THREE.Group) {
    for (const [mat, list] of this.parts) {
      const g = mergeGeometries(list, false);
      if (!g) continue;
      const mesh = new THREE.Mesh(g, mat);
      mesh.receiveShadow = true;
      group.add(mesh);
    }
    this.parts.clear();
  }
}

// ———————————————————————————— layout ————————————————————————————

export const ROOM = { w: 34, front: -13, back: 15, ceil: 10 };

type Big = { id: ViewId; screen: ScreenId | "feed" | "orbit"; x: number; y: number; w: number; h: number };
export const BIG: Big[] = [
  { id: "s-feed", screen: "feed", x: -11.4, y: 4.3, w: 9.6, h: 5.4 },
  { id: "s-map", screen: "map", x: 0, y: 3.69, w: 12.2, h: 4.25 },
  { id: "s-traj", screen: "traj", x: 11.4, y: 4.3, w: 9.6, h: 5.4 },
  { id: "s-clock", screen: "clock", x: -11.95, y: 8.45, w: 4.3, h: 1.96 },
  { id: "s-vehicle", screen: "vehicle", x: -7.25, y: 8.45, w: 4.3, h: 1.96 },
  { id: "s-orbit", screen: "orbit", x: -2.4, y: 8.45, w: 4.3, h: 1.96 },
  { id: "s-weather", screen: "weather", x: 2.4, y: 8.45, w: 4.3, h: 1.96 },
  { id: "s-dsn", screen: "dsn", x: 7.25, y: 8.45, w: 4.3, h: 1.96 },
  { id: "s-fleet", screen: "fleet", x: 11.95, y: 8.45, w: 4.3, h: 1.96 },
];

const ROWS: { z: number; y: number; names: string[] }[] = [
  { z: -4.8, y: 0, names: ["BOOSTER", "RETRO", "FIDO", "GUIDO", "SURGEON", "PROP", "GNC"] },
  { z: -1.1, y: 0.45, names: ["EECOM", "INCO", "PAYLOADS", "NETWORK", "GC", "DSN", "FAO"] },
  { z: 2.6, y: 0.9, names: ["RANGE", "WEATHER", "FLIGHT", "CAPCOM", "LD", "SAFETY"] },
  { z: 6.3, y: 1.35, names: ["PAO", "RECOVERY", "MOD", "SIMSUP", "PLANNING", "ODYSSEY"] },
];
const CW = 2.32;

export type Pose = { pos: THREE.Vector3; look: THREE.Vector3; fov: number };

export class ControlRoom {
  group = new THREE.Group();
  pickables: THREE.Mesh[] = [];
  private heads: THREE.InstancedMesh[] = [];
  private bodies: THREE.InstancedMesh[] = [];
  private bodyBase: THREE.Matrix4[] = [];
  private lean = 0;
  private cheer = 0;
  private headBase: { p: THREE.Vector3; yaw: number; seed: number; row: number }[] = [];
  private sign: THREE.Mesh;
  private signText = "";
  private patches = new THREE.Group();
  private patchKey = "";
  private feedMat!: THREE.MeshBasicMaterial;
  private areaLights: THREE.RectAreaLight[] = [];
  private t = 0;

  constructor(screens: Screens, feedTex: THREE.Texture, orbitTex: THREE.Texture, quality: number) {
    RectAreaLightUniformsLib.init();
    const g = this.group;
    const M = new Merge();
    const carpet = new THREE.MeshStandardMaterial({ map: carpetTex(), roughness: 0.95 });
    const fabric = new THREE.MeshStandardMaterial({ map: fabricTex(), roughness: 0.95 });
    const wood = new THREE.MeshStandardMaterial({ map: woodTex(), roughness: 0.55, metalness: 0.05 });
    const ceiling = new THREE.MeshStandardMaterial({ map: ceilingTex(), roughness: 0.95 });
    const black = new THREE.MeshStandardMaterial({ color: "#07090c", roughness: 0.6, metalness: 0.2 });
    const bezel = new THREE.MeshStandardMaterial({ color: "#0d1014", roughness: 0.4, metalness: 0.5 });
    const consoleBody = new THREE.MeshStandardMaterial({ color: "#2a3340", roughness: 0.5, metalness: 0.35 });
    const deskTop = new THREE.MeshStandardMaterial({ color: "#b9b6ad", roughness: 0.45, metalness: 0.05 });
    const steel = new THREE.MeshStandardMaterial({ color: "#8a9099", roughness: 0.3, metalness: 0.9 });
    const ledStrip = new THREE.MeshBasicMaterial({ color: new THREE.Color("#7fb8ff").multiplyScalar(1.6), toneMapped: false });
    const warmGlow = new THREE.MeshBasicMaterial({ color: new THREE.Color("#ffe1b0").multiplyScalar(1.2), toneMapped: false });
    const ceilPanel = new THREE.MeshBasicMaterial({ color: new THREE.Color("#fff3df").multiplyScalar(1.05), toneMapped: false });
    const keys = new THREE.MeshBasicMaterial({ map: panelKeys(), toneMapped: false });
    const glass = new THREE.MeshStandardMaterial({ color: "#88a0b8", roughness: 0.05, metalness: 0.9, transparent: true, opacity: 0.16, depthWrite: false });
    const { w, front, back, ceil } = ROOM;
    const hw = w / 2;

    // —— shell ——
    M.box(w, 0.2, back - front, 0, -0.1, (front + back) / 2, carpet, 0, 0, 3);
    M.box(w, 0.2, back - front, 0, ceil + 0.1, (front + back) / 2, ceiling, 0, 0, 1.2);
    for (const s of [-1, 1]) {
      M.box(0.2, ceil, back - front, s * (hw + 0.1), ceil / 2, (front + back) / 2, fabric, 0, 0, 2);
      M.box(0.06, 1.25, back - front, s * (hw - 0.03), 0.62, (front + back) / 2, wood, 0, 0, 2.5);
      M.box(0.04, 0.06, back - front, s * (hw - 0.05), 1.27, (front + back) / 2, steel);
      // vertical acoustic battens
      for (let z = front + 1; z < back; z += 2.2) M.box(0.12, ceil - 1.4, 0.14, s * (hw - 0.06), 1.3 + (ceil - 1.4) / 2, z, wood);
    }
    M.box(w, ceil, 0.2, 0, ceil / 2, front - 0.1, black);
    M.box(w, ceil, 0.2, 0, ceil / 2, back + 0.1, fabric, 0, 0, 2);
    // soffit over the screens and a light trough
    M.box(w, 0.5, 2.2, 0, ceil - 0.25, front + 1.1, ceiling, 0, 0, 1.2);
    M.box(w - 1, 0.05, 0.3, 0, ceil - 0.52, front + 2.1, warmGlow);

    // —— the screen wall ——
    for (const b of BIG) {
      M.box(b.w + 0.24, b.h + 0.24, 0.18, b.x, b.y, front + 0.1, bezel);
      const mat =
        b.screen === "feed"
          ? (this.feedMat = new THREE.MeshBasicMaterial({ map: feedTex, toneMapped: false }))
          : b.screen === "orbit"
            ? new THREE.MeshBasicMaterial({ map: orbitTex, toneMapped: false })
            : new THREE.MeshBasicMaterial({ map: screens.tex(b.screen), toneMapped: false, color: new THREE.Color(1.08, 1.08, 1.08) });
      const scr = new THREE.Mesh(new THREE.PlaneGeometry(b.w, b.h), mat);
      scr.position.set(b.x, b.y, front + 0.2);
      scr.userData.view = b.id;
      g.add(scr);
      this.pickables.push(scr);
    }
    // feed caption strip and orbit caption
    const feedBar = new THREE.Mesh(new THREE.PlaneGeometry(9.6, 0.384), new THREE.MeshBasicMaterial({ map: screens.tex("feedbar"), toneMapped: false }));
    feedBar.position.set(-11.4, 1.3, front + 0.2);
    g.add(feedBar);
    const orbitBar = new THREE.Mesh(new THREE.PlaneGeometry(4.3, 0.2), new THREE.MeshBasicMaterial({ map: screens.tex("orbitbar"), toneMapped: false, transparent: true, opacity: 0.92 }));
    orbitBar.position.set(-2.4, 9.33, front + 0.22);
    g.add(orbitBar);
    // status sign over the map (like an ON AIR light)
    this.sign = new THREE.Mesh(new THREE.PlaneGeometry(3.6, 0.5), new THREE.MeshBasicMaterial({ map: label("PLANNING", 720, 100, "#4fd1ff"), toneMapped: false }));
    this.sign.position.set(0, 6.2, front + 0.2);
    g.add(this.sign);
    M.box(4.0, 0.7, 0.16, 0, 6.2, front + 0.1, bezel);

    // —— tiers ——
    const tiers = [
      { y: 0.45, z0: -2.7, z1: 0.95 },
      { y: 0.9, z0: 0.95, z1: 4.65 },
      { y: 1.35, z0: 4.65, z1: 8.4 },
      { y: 2.4, z0: 9.9, z1: back },
    ];
    for (const t of tiers) {
      M.box(w - 0.2, t.y, t.z1 - t.z0, 0, t.y / 2, (t.z0 + t.z1) / 2, carpet, 0, 0, 3);
      M.box(w - 0.2, Math.min(t.y, 0.45), 0.05, 0, t.y - Math.min(t.y, 0.45) / 2, t.z0 - 0.02, wood, 0, 0, 2);
      M.box(w - 0.2, 0.03, 0.02, 0, t.y - 0.03, t.z0 - 0.05, ledStrip);
    }
    // between tier 3 and the gallery: a solid wall under the glass
    M.box(w - 0.2, 2.4, 1.5, 0, 1.2, 9.15, wood, 0, 0, 2);
    // gallery glass with mullions
    const gl = new THREE.Mesh(new THREE.PlaneGeometry(w - 0.4, 4.6), glass);
    gl.position.set(0, 2.4 + 2.3, 9.9);
    gl.rotation.y = Math.PI;
    g.add(gl);
    for (let x = -hw + 1.6; x <= hw - 0.2; x += 2.8) M.box(0.1, 4.6, 0.12, x, 4.7, 9.9, black);
    M.box(w - 0.4, 0.14, 0.16, 0, 7.0, 9.9, black);
    M.box(w - 0.4, 0.14, 0.16, 0, 2.45, 9.9, black);
    // railings along each tier edge
    for (const t of tiers.slice(0, 3)) {
      for (const s of [-1, 1]) {
        const x0 = s * 9.4, x1 = s * (hw - 0.4);
        M.box(Math.abs(x1 - x0), 0.05, 0.05, (x0 + x1) / 2, t.y + 0.95, t.z0 + 0.15, steel);
        for (let x = Math.min(x0, x1); x <= Math.max(x0, x1); x += 1.4) M.box(0.04, 0.95, 0.04, x, t.y + 0.475, t.z0 + 0.15, steel);
      }
    }
    // aisle steps
    for (const s of [-1, 1]) {
      for (const t of tiers.slice(0, 3)) {
        const prev = t.y - 0.45;
        M.box(1.4, 0.225, 0.35, s * 9.95, prev + 0.11, t.z0 - 0.35, wood);
        M.box(1.4, 0.03, 0.02, s * 9.95, prev + 0.21, t.z0 - 0.52, ledStrip);
      }
    }

    // —— consoles ——
    const monVariants = 6;
    const monParts: THREE.BufferGeometry[][] = Array.from({ length: monVariants }, () => []);
    const chairMats: THREE.Matrix4[] = [];
    const people: { m: THREE.Matrix4; shirt: THREE.Color; skin: THREE.Color; hair: THREE.Color; head: THREE.Vector3; yaw: number; row: number }[] = [];
    const shirts = ["#f2f2f0", "#cfe0f2", "#3b4a66", "#e8e2d4", "#1f2733", "#a8c4e0", "#6b7d94", "#f5f5f5", "#2f3d52"];
    const skins = ["#f1c9a5", "#e0ac83", "#c68a62", "#8d5a3b", "#5e3b25", "#f6d6bd", "#b77a52"];
    const hairs = ["#1b1410", "#3a2a1c", "#6b4a2b", "#b8a17a", "#9c9c9c", "#151515", "#4a2f1d"];
    let k = 0;
    ROWS.forEach((row, ri) => {
      const n = row.names.length;
      row.names.forEach((name, i) => {
        const x = (i - (n - 1) / 2) * CW;
        const z = row.z;
        const y = row.y;
        k++;
        // cabinet and desk
        M.box(CW - 0.06, 0.74, 0.78, x, y + 0.37, z, consoleBody);
        M.box(CW - 0.02, 0.045, 1.08, x, y + 0.76, z + 0.15, deskTop);
        M.box(CW - 0.06, 0.06, 0.06, x, y + 0.72, z + 0.66, steel);
        M.box(CW - 0.06, 0.62, 0.3, x, y + 1.1, z - 0.24, consoleBody);
        M.box(CW - 0.08, 0.025, 0.06, x, y + 0.79, z - 0.05, warmGlow);
        // comm loop keyset
        M.box(0.32, 0.05, 0.2, x + CW / 2 - 0.3, y + 0.8, z + 0.25, bezel);
        M.box(0.28, 0.005, 0.15, x + CW / 2 - 0.3, y + 0.828, z + 0.25, keys);
        // keyboard and mouse
        M.box(0.46, 0.022, 0.15, x - 0.15, y + 0.79, z + 0.42, bezel);
        M.box(0.06, 0.02, 0.1, x + 0.22, y + 0.79, z + 0.42, bezel);
        if (rnd() < 0.5) M.add(new THREE.CylinderGeometry(0.04, 0.035, 0.1, 12), wood, new THREE.Matrix4().makeTranslation(x - 0.75, y + 0.83, z + 0.45));
        // monitors: three below, two above
        const mons: [number, number, number, number, number][] = [
          [-0.72, 1.18, 0.64, 0.4, 0.18],
          [0, 1.18, 0.64, 0.4, 0],
          [0.72, 1.18, 0.64, 0.4, -0.18],
          [-0.37, 1.63, 0.6, 0.37, 0.08],
          [0.37, 1.63, 0.6, 0.37, -0.08],
        ];
        mons.forEach(([mx, my, mw, mh, yaw], j) => {
          if (name === "FLIGHT" && j >= 3) return;
          const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(-0.12, yaw, 0));
          const c = new THREE.Vector3(x + mx, y + my, z - 0.2);
          const bm = new THREE.Matrix4().compose(c, q, new THREE.Vector3(1, 1, 1));
          M.add(new THREE.BoxGeometry(mw + 0.04, mh + 0.04, 0.035), bezel, bm);
          const sp = new THREE.PlaneGeometry(mw, mh);
          sp.applyMatrix4(new THREE.Matrix4().compose(new THREE.Vector3(0, 0, 0.019), new THREE.Quaternion(), new THREE.Vector3(1, 1, 1)));
          sp.applyMatrix4(bm);
          monParts[(k * 2 + j) % monVariants].push(sp);
          if (j >= 3) M.box(0.04, 0.3, 0.04, x + mx, y + 1.38, z - 0.26, steel);
        });
        // nameplate facing the people behind, and one facing the operator
        // (the Flight Director sits right behind FLIGHT and CAPCOM: no tall placards in their line of sight)
        if (name && name !== "FLIGHT" && name !== "CAPCOM") {
          const plate = new THREE.Mesh(new THREE.PlaneGeometry(1.05, 0.23), new THREE.MeshBasicMaterial({ map: label(name, 512, 112, name === "FLIGHT" ? "#c8ff3d" : "#ffd166"), toneMapped: false }));
          plate.position.set(x, y + 1.97, z - 0.27);
          plate.rotation.y = Math.PI;
          g.add(plate);
          const plate2 = plate.clone();
          plate2.rotation.y = 0;
          plate2.position.z = z - 0.23;
          plate2.scale.setScalar(0.6);
          plate2.position.y = y + 1.95;
          g.add(plate2);
          M.box(1.1, 0.27, 0.03, x, y + 1.97, z - 0.25, bezel);
        }
        // chair and the controller on shift
        const cz = z + 0.98;
        const yaw = (rnd() - 0.5) * 0.5;
        chairMats.push(new THREE.Matrix4().compose(new THREE.Vector3(x + (rnd() - 0.5) * 0.2, y, cz), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, yaw, 0)), new THREE.Vector3(1, 1, 1)));
        const fdSeat = name === "FLIGHT";
        if (!fdSeat && rnd() < 0.82) {
          people.push({
            m: new THREE.Matrix4().compose(new THREE.Vector3(x, y, cz - 0.05), new THREE.Quaternion().setFromEuler(new THREE.Euler(0.12, yaw * 0.3, 0)), new THREE.Vector3(1, 1, 1)),
            shirt: new THREE.Color(shirts[Math.floor(rnd() * shirts.length)]),
            skin: new THREE.Color(skins[Math.floor(rnd() * skins.length)]),
            hair: new THREE.Color(hairs[Math.floor(rnd() * hairs.length)]),
            head: new THREE.Vector3(x, y + 1.33, cz - 0.12),
            yaw: yaw * 0.3,
            row: ri,
          });
        }
      });
    });
    // gallery seating and spectators
    for (let r = 0; r < 3; r++) {
      for (let i = 0; i < 16; i++) {
        const x = (i - 7.5) * 1.05;
        const z = 11.2 + r * 1.3;
        const y = 2.4 + r * 0.35;
        if (r > 0) M.box(w - 0.4, 0.35, 1.3, 0, y - 0.175, z, carpet);
        chairMats.push(new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion(), new THREE.Vector3(1, 1, 1)));
        if (rnd() < 0.35) people.push({ m: new THREE.Matrix4().compose(new THREE.Vector3(x, y, z - 0.05), new THREE.Quaternion(), new THREE.Vector3(1, 1, 1)), shirt: new THREE.Color(shirts[Math.floor(rnd() * shirts.length)]), skin: new THREE.Color(skins[Math.floor(rnd() * skins.length)]), hair: new THREE.Color(hairs[Math.floor(rnd() * hairs.length)]), head: new THREE.Vector3(x, y + 1.33, z - 0.12), yaw: 0, row: 4 });
      }
    }
    // ceiling coffers over each row
    for (const row of ROWS) {
      M.box(18, 0.04, 1.1, 0, ceil - 0.03, row.z + 0.6, ceilPanel);
      M.box(18.4, 0.16, 1.4, 0, ceil - 0.06, row.z + 0.6, black);
    }
    for (const x of [-13.5, 13.5]) for (let z = -10; z < 9; z += 3.2) M.box(0.7, 0.04, 0.7, x, ceil - 0.03, z, ceilPanel);
    // wall clocks and signage on the right wall
    const sign2 = new THREE.Mesh(new THREE.PlaneGeometry(7.5, 1.1), new THREE.MeshBasicMaterial({ map: label("MISSION OPERATIONS · FCR-1", 1400, 200, "#d9e6f2"), toneMapped: false }));
    sign2.position.set(hw - 0.12, 7.6, -2);
    sign2.rotation.y = -Math.PI / 2;
    g.add(sign2);
    M.box(0.08, 1.3, 7.8, hw - 0.06, 7.6, -2, bezel);
    // flags
    const flag = new THREE.Mesh(
      new THREE.PlaneGeometry(3.2, 1.7),
      new THREE.MeshStandardMaterial({
        map: tex(380, 200, (c) => {
          for (let i = 0; i < 13; i++) {
            c.fillStyle = i % 2 ? "#f2f2f2" : "#b22234";
            c.fillRect(0, (i * 200) / 13, 380, 200 / 13 + 1);
          }
          c.fillStyle = "#3c3b6e";
          c.fillRect(0, 0, 152, 108);
          c.fillStyle = "#fff";
          for (let r = 0; r < 9; r++) for (let s = 0; s < (r % 2 ? 5 : 6); s++) c.fillRect(8 + s * 25 + (r % 2 ? 12 : 0), 6 + r * 11, 4, 4);
        }),
        roughness: 0.9,
      }),
    );
    flag.position.set(hw - 0.24, 5.0, 5.5);
    flag.rotation.y = -Math.PI / 2;
    g.add(flag);
    M.build(g);

    // —— monitors (shared console textures) ——
    monParts.forEach((list, j) => {
      if (!list.length) return;
      const geo = mergeGeometries(list.map((x) => (x.index ? x.toNonIndexed() : x)), false)!;
      const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ map: screens.tex(`con${j}` as ScreenId), toneMapped: false, color: new THREE.Color(0.92, 0.95, 1) }));
      g.add(m);
    });

    // —— chairs ——
    const chairGeo = mergeGeometries(
      [
        new THREE.BoxGeometry(0.52, 0.08, 0.5).translate(0, 0.5, 0),
        new THREE.BoxGeometry(0.5, 0.62, 0.07).translate(0, 0.86, 0.26).rotateX(-0.08),
        new THREE.CylinderGeometry(0.03, 0.03, 0.42, 8).translate(0, 0.25, 0),
        ...[0, 1, 2, 3, 4].map((i) => new THREE.BoxGeometry(0.05, 0.04, 0.32).translate(0, 0.05, 0.16).rotateY((i / 5) * Math.PI * 2)),
        new THREE.BoxGeometry(0.06, 0.05, 0.3).translate(0.28, 0.66, 0.02),
        new THREE.BoxGeometry(0.06, 0.05, 0.3).translate(-0.28, 0.66, 0.02),
      ].map((x) => x.toNonIndexed()),
      false,
    )!;
    const chairs = new THREE.InstancedMesh(chairGeo, new THREE.MeshStandardMaterial({ color: "#16191e", roughness: 0.7, metalness: 0.2 }), chairMats.length);
    chairMats.forEach((m, i) => chairs.setMatrixAt(i, m));
    g.add(chairs);

    // —— people ——
    // seated figure: a limb is a capsule from joint to joint; forearms rest on the desk edge
    const limb = (a: [number, number, number], b: [number, number, number], r: number) => {
      const A = new THREE.Vector3(...a), B = new THREE.Vector3(...b);
      const g = new THREE.CapsuleGeometry(r, Math.max(0.01, A.distanceTo(B)), 4, 8);
      g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), B.clone().sub(A).normalize()));
      g.translate((A.x + B.x) / 2, (A.y + B.y) / 2, (A.z + B.z) / 2);
      return g.toNonIndexed();
    };
    const shirtGeo = mergeGeometries(
      [
        new THREE.CapsuleGeometry(0.17, 0.36, 4, 12).scale(1.2, 1, 0.72).translate(0, 0.98, 0.02).toNonIndexed(),
        new THREE.SphereGeometry(0.075, 10, 8).translate(0.2, 1.13, 0.02).toNonIndexed(),
        new THREE.SphereGeometry(0.075, 10, 8).translate(-0.2, 1.13, 0.02).toNonIndexed(),
        ...[1, -1].flatMap((s) => [limb([s * 0.21, 1.12, 0.02], [s * 0.25, 0.9, -0.14], 0.052), limb([s * 0.25, 0.9, -0.14], [s * 0.17, 0.84, -0.42], 0.045)]),
      ],
      false,
    )!;
    const pantsGeo = mergeGeometries(
      [
        new THREE.CapsuleGeometry(0.15, 0.12, 4, 10).scale(1.25, 0.8, 1).translate(0, 0.62, 0.02).toNonIndexed(),
        ...[1, -1].flatMap((s) => [
          limb([s * 0.1, 0.58, 0], [s * 0.11, 0.56, -0.42], 0.07),
          limb([s * 0.11, 0.56, -0.42], [s * 0.12, 0.1, -0.48], 0.055),
          new THREE.BoxGeometry(0.1, 0.07, 0.24).translate(s * 0.12, 0.035, -0.54).toNonIndexed(),
        ]),
      ],
      false,
    )!;
    const skinGeo = mergeGeometries(
      [
        new THREE.CylinderGeometry(0.05, 0.055, 0.12, 10).translate(0, 1.22, 0).toNonIndexed(),
        new THREE.SphereGeometry(0.045, 10, 8).scale(1, 0.6, 1.4).translate(0.16, 0.84, -0.47).toNonIndexed(),
        new THREE.SphereGeometry(0.045, 10, 8).scale(1, 0.6, 1.4).translate(-0.16, 0.84, -0.47).toNonIndexed(),
      ],
      false,
    )!;
    const bodies = new THREE.InstancedMesh(shirtGeo, new THREE.MeshStandardMaterial({ roughness: 0.85 }), people.length);
    const pants = new THREE.InstancedMesh(pantsGeo, new THREE.MeshStandardMaterial({ roughness: 0.9 }), people.length);
    const skin = new THREE.InstancedMesh(skinGeo, new THREE.MeshStandardMaterial({ roughness: 0.65 }), people.length);
    const trousers = ["#1d2330", "#2b2f36", "#3d3a33", "#1a1a1d", "#4a4538", "#22324a"];
    people.forEach((p, i) => {
      pants.setMatrixAt(i, p.m);
      pants.setColorAt(i, new THREE.Color(trousers[i % trousers.length]));
      skin.setMatrixAt(i, p.m);
      skin.setColorAt(i, p.skin);
    });
    g.add(pants, skin);
    const headGeo = new THREE.SphereGeometry(0.115, 16, 12).scale(0.92, 1.08, 1);
    const hairGeo = new THREE.SphereGeometry(0.122, 16, 10, 0, Math.PI * 2, 0, Math.PI * 0.55).scale(0.95, 1.05, 1.03).translate(0, 0.012, 0.01);
    const setGeo = new THREE.TorusGeometry(0.125, 0.012, 6, 20, Math.PI).rotateZ(0).translate(0, 0.02, 0);
    const heads = new THREE.InstancedMesh(headGeo, new THREE.MeshStandardMaterial({ roughness: 0.65 }), people.length);
    const hair = new THREE.InstancedMesh(hairGeo, new THREE.MeshStandardMaterial({ roughness: 0.9 }), people.length);
    const sets = new THREE.InstancedMesh(setGeo, new THREE.MeshStandardMaterial({ color: "#111", roughness: 0.5 }), people.length);
    people.forEach((p, i) => {
      bodies.setMatrixAt(i, p.m);
      bodies.setColorAt(i, p.shirt);
      heads.setColorAt(i, p.skin);
      hair.setColorAt(i, p.hair);
      this.headBase.push({ p: p.head, yaw: p.yaw, seed: rnd() * 100, row: p.row });
    });
    g.add(bodies, heads, hair, sets);
    this.heads = [heads, hair, sets];
    this.bodies = [bodies, pants, skin];
    this.bodyBase = people.map((p) => p.m.clone());
    this.updateHeads(0);

    // —— light ——
    const hemi = new THREE.HemisphereLight("#8ea4c4", "#191c22", 0.35);
    g.add(hemi);
    // the wall of displays is the main light in the room; the ceiling coffers add a warm wash
    const wall = new THREE.RectAreaLight("#93bdff", 2.2, 32, 7.5);
    wall.position.set(0, 5.4, front + 0.3);
    wall.lookAt(0, 4, 10);
    g.add(wall);
    this.areaLights.push(wall);
    const wash = new THREE.DirectionalLight("#ffe2bd", quality >= 1 ? 0.55 : 0.75);
    wash.position.set(2, ceil, 6);
    wash.target.position.set(0, 0, 0);
    g.add(wash, wash.target);
    const lamp = new THREE.PointLight("#ffd9a0", 6, 9, 2);
    lamp.position.set(0, 3.2, 3.4);
    g.add(lamp);
    g.add(this.patches);
  }

  private updateHeads(t: number, dt = 0) {
    const s = useMC.getState();
    const live = s.ops.phase === "flight";
    // the room leans in from the last minute of the count through powered flight, and erupts when it is over
    const tense = live || (s.ops.phase === "count" && !s.ops.holding && s.ops.tMinus < 60);
    const won = s.ops.phase === "post" && s.ops.result === "success";
    this.lean += ((tense ? 1 : 0) - this.lean) * Math.min(1, dt * 1.5);
    this.cheer += ((won ? 1 : 0) - this.cheer) * Math.min(1, dt * (won ? 3 : 0.4));
    const dummy = new THREE.Object3D();
    const lift = new THREE.Matrix4();
    const tilt = new THREE.Matrix4();
    const m4 = new THREE.Matrix4();
    const moving = this.lean > 0.002 || this.cheer > 0.002;
    this.headBase.forEach((h, i) => {
      // applause: a bounce in the seat, out of step from one person to the next; the gallery is the loudest
      const clap = this.cheer * Math.max(0, Math.sin(t * (8 + (h.seed % 3)) + h.seed)) * (h.row === 4 ? 0.07 : 0.045);
      const lean = this.lean * (h.row === 4 ? 0.04 : 0.1) * (0.6 + 0.4 * Math.sin(h.seed));
      // watch the wall during flight, the monitors otherwise
      const look = live ? -0.18 + Math.sin(t * 0.4 + h.seed) * 0.05 : this.cheer > 0.3 ? -0.25 + Math.sin(t * 3 + h.seed) * 0.1 : 0.18 + Math.sin(t * 0.25 + h.seed) * 0.08;
      const yaw = h.yaw + Math.sin(t * 0.17 + h.seed * 2) * 0.35 * (h.row === 4 ? 0.3 : 1) * (1 - this.lean * 0.7) + (Math.sin(t * 0.05 + h.seed) > 0.97 ? 0.8 : 0) + this.cheer * Math.sin(t * 1.3 + h.seed) * 0.5;
      dummy.position.copy(h.p);
      dummy.position.y += clap - lean * 0.9;
      dummy.position.z -= lean * 1.25;
      dummy.rotation.set(look, yaw, 0, "YXZ");
      dummy.updateMatrix();
      for (const m of this.heads) m.setMatrixAt(i, dummy.matrix);
      if (moving || dt === 0) {
        lift.makeTranslation(0, clap, 0);
        tilt.makeRotationX(-lean);
        m4.multiplyMatrices(lift, this.bodyBase[i]).multiply(tilt);
        for (const b of this.bodies) b.setMatrixAt(i, m4);
      }
    });
    for (const m of this.heads) m.instanceMatrix.needsUpdate = true;
    if (moving || dt === 0) for (const b of this.bodies) b.instanceMatrix.needsUpdate = true;
  }

  update(dt: number) {
    this.t += dt;
    this.updateHeads(this.t, dt);
    const s = useMC.getState();
    const text = s.ops.phase === "count" ? (s.ops.holding ? "HOLDING" : "COUNTDOWN") : s.ops.phase === "flight" ? "IN FLIGHT" : s.ops.phase === "post" ? (s.ops.result === "success" ? "MISSION SUCCESS" : s.ops.result.toUpperCase()) : "PLANNING";
    if (text !== this.signText) {
      this.signText = text;
      const color = text === "IN FLIGHT" ? "#ff4d5e" : text === "HOLDING" ? "#ffb020" : text === "COUNTDOWN" ? "#c8ff3d" : text === "MISSION SUCCESS" ? "#c8ff3d" : text === "PLANNING" ? "#4fd1ff" : "#ff4d5e";
      const mat = this.sign.material as THREE.MeshBasicMaterial;
      mat.map?.dispose();
      mat.map = label(text, 720, 100, color);
      mat.color.setScalar(text === "IN FLIGHT" ? 1.5 : 1.1);
      mat.needsUpdate = true;
    }
    // the feed lights the room
    const f = s.ops.phase === "flight";
    this.areaLights[0].intensity = 2.2 + (f ? Math.sin(this.t * 31) * 0.12 : 0);
    // mission patches on the left wall
    const key = s.history.filter((m) => m.result !== "scrub").slice(0, 12).map((m) => m.id).join();
    if (key !== this.patchKey) {
      this.patchKey = key;
      this.patches.clear();
      s.history.filter((m) => m.result !== "scrub").slice(0, 12).forEach((m, i) => {
        const mesh = new THREE.Mesh(new THREE.CircleGeometry(0.62, 40), new THREE.MeshStandardMaterial({ map: patch(m), roughness: 0.7 }));
        const col = i % 6, row = Math.floor(i / 6);
        mesh.position.set(-ROOM.w / 2 + 0.13, 5.6 - row * 1.6, -8 + col * 1.75);
        mesh.rotation.y = Math.PI / 2;
        this.patches.add(mesh);
      });
    }
  }

  /** camera poses: seats and the screens themselves */
  pose(view: ViewId, aspect: number): Pose {
    const f = ROOM.front;
    switch (view) {
      case "fd":
        return { pos: new THREE.Vector3(0, 3.05, 4.55), look: new THREE.Vector3(0, 4.3, f), fov: 50 };
      case "overview":
        return { pos: new THREE.Vector3(0, 6.1, 13.6), look: new THREE.Vector3(0, 3.2, -6), fov: 58 };
      case "front":
        return { pos: new THREE.Vector3(0, 1.75, -7.2), look: new THREE.Vector3(0, 5.6, f), fov: 70 };
      case "gallery":
        return { pos: new THREE.Vector3(-12.5, 4.1, 12.2), look: new THREE.Vector3(2, 2.2, -4), fov: 55 };
      default: {
        const b = BIG.find((x) => x.id === view)!;
        const fov = 40;
        const tan = Math.tan(((fov / 2) * Math.PI) / 180);
        const d = Math.max(b.h / 2 / tan, b.w / 2 / (tan * aspect)) * 1.08;
        return { pos: new THREE.Vector3(b.x, b.y, f + 0.2 + d), look: new THREE.Vector3(b.x, b.y, f), fov };
      }
    }
  }
}
