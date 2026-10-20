import * as THREE from "three";
import { plumeGeometry, plumeMaterial } from "./fx";
import { rng } from "./noise";

/**
 * Entry, descent and landing hardware in the Curiosity / Perseverance pattern, in metres:
 * a 4.5 m 70° sphere-cone heat shield tiled in PICA, a two-cone backshell with RCS thrusters and the
 * parachute can, a disk-gap-band parachute, and the sky-crane descent stage with eight canted
 * Mars Landing Engines, three propellant tanks, the Terminal Descent Sensor and the bridle reel.
 * Every model's axis is +y (heat shield facing −y); textures are drawn once on canvases.
 */

const D2R = Math.PI / 180;

function canvas(w: number, h: number) {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  return [c, c.getContext("2d")!] as const;
}

function tex(c: HTMLCanvasElement, color = true) {
  const t = new THREE.CanvasTexture(c);
  t.wrapS = THREE.RepeatWrapping;
  t.wrapT = THREE.ClampToEdgeWrapping;
  t.anisotropy = 8;
  if (color) t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** speckle a canvas with soft blotches (mottling, char, wear) */
function mottle(g: CanvasRenderingContext2D, w: number, h: number, n: number, rgba: (r: () => number) => string, size: [number, number], seed: number) {
  const r = rng(seed);
  for (let i = 0; i < n; i++) {
    const x = r() * w;
    const y = r() * h;
    const s = size[0] + r() * (size[1] - size[0]);
    const gr = g.createRadialGradient(x, y, 0, x, y, s);
    const c = rgba(r);
    gr.addColorStop(0, c);
    gr.addColorStop(1, c.replace(/[\d.]+\)$/, "0)"));
    g.fillStyle = gr;
    g.fillRect(x - s, y - s, s * 2, s * 2);
  }
}

// ———————————————————————————— textures ————————————————————————————

/**
 * PICA tiles on the heat shield, mapped around the lathe (u) and from nose to shoulder (v):
 * rings of tiles whose count grows with the circumference, gap-filler seams, and char mottling.
 * Returns colour and a bump map in which the seams are recessed.
 */
export function makePicaTextures() {
  const W = 1024;
  const H = 512;
  const [c, g] = canvas(W, H);
  const [b, gb] = canvas(W, H);
  g.fillStyle = "#3b2a1f";
  g.fillRect(0, 0, W, H);
  gb.fillStyle = "#808080";
  gb.fillRect(0, 0, W, H);
  mottle(g, W, H, 900, (r) => `rgba(${18 + r() * 30},${12 + r() * 18},${8 + r() * 12},${0.25 + r() * 0.35})`, [6, 40], 7);
  mottle(g, W, H, 400, (r) => `rgba(${90 + r() * 40},${62 + r() * 30},${40 + r() * 20},${0.12 + r() * 0.15})`, [4, 22], 9);
  // fine fibrous grain
  const r = rng(3);
  for (let i = 0; i < 26000; i++) {
    const v = 30 + r() * 60;
    g.fillStyle = `rgba(${v},${v * 0.72},${v * 0.5},0.18)`;
    g.fillRect(r() * W, r() * H, 1 + r() * 2, 1);
  }
  // tile rings: the nose tile is one piece, then ~8 rings out to the shoulder
  const rings = [0, 0.11, 0.24, 0.37, 0.5, 0.62, 0.74, 0.86, 0.96, 1];
  const seam = (ctx: CanvasRenderingContext2D, style: string, lw: number) => {
    ctx.strokeStyle = style;
    ctx.lineWidth = lw;
    for (let k = 1; k < rings.length - 1; k++) {
      const y = rings[k] * H;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(W, y);
      ctx.stroke();
    }
    for (let k = 1; k < rings.length - 1; k++) {
      const y0 = rings[k] * H;
      const y1 = rings[k + 1] * H;
      const n = Math.max(4, Math.round(6 + k * 4.2));
      const off = (k % 2) * 0.5;
      for (let j = 0; j < n; j++) {
        const x = ((j + off) / n) * W;
        ctx.beginPath();
        ctx.moveTo(x, y0);
        ctx.lineTo(x, y1);
        ctx.stroke();
      }
    }
  };
  seam(g, "rgba(150,120,92,0.75)", 2.2);
  seam(g, "rgba(20,14,10,0.6)", 0.8);
  seam(gb, "#2a2a2a", 3);
  // the shoulder ring is a darker, smoother band
  const sh = g.createLinearGradient(0, H * 0.92, 0, H);
  sh.addColorStop(0, "rgba(0,0,0,0)");
  sh.addColorStop(1, "rgba(10,8,6,0.55)");
  g.fillStyle = sh;
  g.fillRect(0, H * 0.92, W, H * 0.08);
  return { map: tex(c), bump: tex(b, false) };
}

/** the backshell's thermal-protection panels: off-white cork-like coating, seams, fittings and a little scorch */
export function makeBackshellTextures() {
  const W = 1024;
  const H = 512;
  const [c, g] = canvas(W, H);
  const [b, gb] = canvas(W, H);
  g.fillStyle = "#d6d1c6";
  g.fillRect(0, 0, W, H);
  gb.fillStyle = "#808080";
  gb.fillRect(0, 0, W, H);
  mottle(g, W, H, 700, (r) => `rgba(${150 + r() * 60},${140 + r() * 55},${120 + r() * 50},${0.08 + r() * 0.12})`, [6, 36], 21);
  const r = rng(5);
  for (let i = 0; i < 30000; i++) {
    const v = 150 + r() * 90;
    g.fillStyle = `rgba(${v},${v * 0.97},${v * 0.9},0.12)`;
    g.fillRect(r() * W, r() * H, 1, 1);
  }
  // panel seams: 16 gores, three circumferential joints
  for (const [ctx, style, lw] of [
    [g, "rgba(120,114,104,0.65)", 1.6],
    [gb, "#3a3a3a", 2.4],
  ] as [CanvasRenderingContext2D, string, number][]) {
    ctx.strokeStyle = style;
    ctx.lineWidth = lw;
    for (let j = 0; j < 16; j++) {
      const x = (j / 16) * W;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, H * 0.72);
      ctx.stroke();
    }
    for (const v of [0.18, 0.46, 0.72, 0.86]) {
      ctx.beginPath();
      ctx.moveTo(0, v * H);
      ctx.lineTo(W, v * H);
      ctx.stroke();
    }
  }
  // fittings: dark plume shields beside the thrusters, small sensor plugs, alignment marks
  for (let j = 0; j < 4; j++) {
    const x = ((j + 0.13) / 4) * W;
    g.fillStyle = "#4a4743";
    g.fillRect(x - 18, H * 0.5, 36, 40);
    g.fillStyle = "#2a2826";
    g.fillRect(x - 10, H * 0.52, 20, 26);
  }
  for (let k = 0; k < 40; k++) {
    g.fillStyle = r() < 0.5 ? "#77726a" : "#3e3b37";
    g.beginPath();
    g.arc(r() * W, H * (0.08 + r() * 0.6), 2 + r() * 3, 0, Math.PI * 2);
    g.fill();
  }
  for (let j = 0; j < 8; j++) {
    const x = ((j + 0.5) / 8) * W;
    g.fillStyle = "#1b1b1b";
    g.fillRect(x - 6, H * 0.03, 12, 12);
    g.fillStyle = "#f2f0ea";
    g.fillRect(x - 6, H * 0.03, 6, 6);
    g.fillRect(x, H * 0.03 + 6, 6, 6);
  }
  // scorch toward the shoulder, where the wake heats the shell
  const sc = g.createLinearGradient(0, 0, 0, H);
  sc.addColorStop(0, "rgba(60,40,24,0)");
  sc.addColorStop(0.6, "rgba(60,40,24,0)");
  sc.addColorStop(1, "rgba(60,40,24,0.35)");
  g.fillStyle = sc;
  g.fillRect(0, 0, W, H);
  return { map: tex(c), bump: tex(b, false) };
}

/** crinkled multi-layer insulation: gold (Kapton) or silver */
export function makeMliTexture(gold: boolean, seed = 1) {
  const S = 256;
  const [c, g] = canvas(S, S);
  g.fillStyle = gold ? "#c89a3c" : "#b9bcc0";
  g.fillRect(0, 0, S, S);
  const r = rng(seed);
  for (let i = 0; i < 380; i++) {
    const x = r() * S;
    const y = r() * S;
    const s = 6 + r() * 26;
    const a = r() * Math.PI;
    const v = r();
    g.fillStyle = gold ? `rgba(${200 + v * 55},${150 + v * 70},${50 + v * 60},${0.25 + r() * 0.4})` : `rgba(${150 + v * 105},${152 + v * 103},${158 + v * 97},${0.25 + r() * 0.4})`;
    g.beginPath();
    g.moveTo(x, y);
    for (let k = 0; k < 4; k++) g.lineTo(x + Math.cos(a + k * 1.7 + r()) * s, y + Math.sin(a + k * 1.7 + r()) * s);
    g.closePath();
    g.fill();
  }
  // tape seams
  g.fillStyle = gold ? "rgba(120,80,20,0.5)" : "rgba(90,92,96,0.5)";
  g.fillRect(0, S * 0.5 - 2, S, 4);
  g.fillRect(S * 0.5 - 2, 0, 4, S);
  const t = tex(c);
  t.wrapT = THREE.RepeatWrapping;
  return t;
}

/** structural panels: anodised grey with a grid of fasteners */
function makePanelTexture() {
  const S = 256;
  const [c, g] = canvas(S, S);
  g.fillStyle = "#5c6066";
  g.fillRect(0, 0, S, S);
  mottle(g, S, S, 60, (r) => `rgba(${70 + r() * 40},${74 + r() * 40},${80 + r() * 40},0.25)`, [10, 40], 31);
  g.strokeStyle = "rgba(25,27,30,0.8)";
  g.lineWidth = 2;
  g.strokeRect(4, 4, S - 8, S - 8);
  g.strokeRect(S / 2, 4, 0.1, S - 8);
  g.fillStyle = "rgba(190,195,200,0.7)";
  for (let i = 0; i < 8; i++)
    for (const y of [10, S - 10]) {
      g.beginPath();
      g.arc(14 + i * ((S - 28) / 7), y, 2, 0, Math.PI * 2);
      g.fill();
    }
  const t = tex(c);
  t.wrapT = THREE.RepeatWrapping;
  return t;
}

/** disk-gap-band canopy: 80 gores in alternating orange and white, with darker reinforcing tapes */
export function makeCanopyTexture() {
  const W = 1024;
  const H = 256;
  const [c, g] = canvas(W, H);
  const gores = 80;
  for (let i = 0; i < gores; i++) {
    const x0 = (i / gores) * W;
    // the coded ring pattern: blocks of orange on white
    const orange = (i % 8 < 4) !== (i % 20 < 3);
    g.fillStyle = orange ? "#d4582c" : "#ece7dc";
    g.fillRect(x0, 0, W / gores + 1, H);
  }
  // a darker band near the vent and the skirt, and the radial tapes
  g.fillStyle = "rgba(160,60,30,0.35)";
  g.fillRect(0, H * 0.02, W, H * 0.06);
  g.strokeStyle = "rgba(80,60,50,0.45)";
  g.lineWidth = 1.5;
  for (let i = 0; i < gores; i++) {
    const x = (i / gores) * W;
    g.beginPath();
    g.moveTo(x, 0);
    g.lineTo(x, H);
    g.stroke();
  }
  for (const v of [0.25, 0.5, 0.75, 0.98]) {
    g.beginPath();
    g.moveTo(0, v * H);
    g.lineTo(W, v * H);
    g.stroke();
  }
  return tex(c);
}

// ———————————————————————————— shared materials ————————————————————————————

export type HwMats = ReturnType<typeof hardwareMaterials>;

export function hardwareMaterials() {
  const pica = makePicaTextures();
  const shell = makeBackshellTextures();
  const gold = makeMliTexture(true, 4);
  const silver = makeMliTexture(false, 8);
  const panel = makePanelTexture();
  const m = {
    pica: new THREE.MeshStandardMaterial({ map: pica.map, bumpMap: pica.bump, bumpScale: 2.5, roughness: 0.92, metalness: 0, color: "#ffffff" }),
    shieldBack: new THREE.MeshStandardMaterial({ color: "#c9c3b6", roughness: 0.6, metalness: 0.25, side: THREE.DoubleSide }),
    shell: new THREE.MeshStandardMaterial({ map: shell.map, bumpMap: shell.bump, bumpScale: 1.5, roughness: 0.78, metalness: 0.02 }),
    shellIn: new THREE.MeshStandardMaterial({ color: "#3d3f44", roughness: 0.7, metalness: 0.4, side: THREE.BackSide }),
    gold: new THREE.MeshStandardMaterial({ map: gold, bumpMap: gold, bumpScale: 1.2, color: "#ffffff", roughness: 0.3, metalness: 0.85, emissive: "#2a1a04", emissiveIntensity: 0.4 }),
    silver: new THREE.MeshStandardMaterial({ map: silver, bumpMap: silver, bumpScale: 1, color: "#ffffff", roughness: 0.32, metalness: 0.8 }),
    frame: new THREE.MeshStandardMaterial({ map: panel, color: "#ffffff", roughness: 0.55, metalness: 0.55 }),
    beam: new THREE.MeshStandardMaterial({ color: "#2b2e33", roughness: 0.5, metalness: 0.7 }),
    ti: new THREE.MeshStandardMaterial({ color: "#b5b4b0", roughness: 0.28, metalness: 0.95 }),
    white: new THREE.MeshStandardMaterial({ color: "#e4e1da", roughness: 0.55, metalness: 0.05 }),
    nozzle: new THREE.MeshStandardMaterial({ color: "#3a3540", roughness: 0.35, metalness: 0.9, side: THREE.DoubleSide }),
    black: new THREE.MeshStandardMaterial({ color: "#121316", roughness: 0.45, metalness: 0.4 }),
    /** inside of a firing nozzle; colour is pushed past 1 so the bloom catches it */
    hot: new THREE.MeshBasicMaterial({ color: new THREE.Color(0, 0, 0), side: THREE.DoubleSide, toneMapped: false }),
  };
  const textures = [pica.map, pica.bump, shell.map, shell.bump, gold, silver, panel];
  return { ...m, dispose: () => [...Object.values(m), ...textures].forEach((x) => x.dispose()) };
}

const castAll = (g: THREE.Object3D) => g.traverse((o) => ((o as THREE.Mesh).isMesh ? ((o.castShadow = true), (o.receiveShadow = true)) : null));

// ———————————————————————————— aeroshell ————————————————————————————

export const AEROSHELL_R = 2.25;

/** profile of the 70° sphere-cone, nose (0,0) to shoulder (2.25, ~0.8) */
export function shieldProfile(standoff = 0, steps = 1) {
  const R = AEROSHELL_R + standoff;
  const rn = 1.125 + standoff;
  const pts: THREE.Vector2[] = [];
  const cone = 20 * D2R;
  // spherical nose cap
  for (let i = 0; i <= 8 * steps; i++) {
    const a = (i / (8 * steps)) * cone;
    pts.push(new THREE.Vector2(Math.max(rn * Math.sin(a), 0.002), rn - rn * Math.cos(a) - standoff));
  }
  const r0 = rn * Math.sin(cone);
  const y0 = rn - rn * Math.cos(cone) - standoff;
  // the cone runs out to a rounded shoulder whose outermost point is the full radius
  const rs = 0.1 + standoff * 0.5;
  const rEnd = R - rs + rs * Math.sin(cone);
  for (let i = 1; i <= 10 * steps; i++) {
    const r = r0 + ((rEnd - r0) * i) / (10 * steps);
    pts.push(new THREE.Vector2(r, y0 + (r - r0) * Math.tan(cone)));
  }
  const last = pts[pts.length - 1];
  const cx = last.x - rs * Math.sin(cone);
  const cy = last.y + rs * Math.cos(cone);
  for (let i = 1; i <= 6; i++) {
    const a = -Math.PI / 2 + cone + ((Math.PI / 2 - cone + 0.6) * i) / 6;
    pts.push(new THREE.Vector2(cx + rs * Math.cos(a), cy + rs * Math.sin(a)));
  }
  return pts;
}

export function heatShield(m: HwMats) {
  const g = new THREE.Group();
  const outer = new THREE.Mesh(new THREE.LatheGeometry(shieldProfile(), 96), m.pica);
  // the inside: honeycomb carrier structure with a ring of attach fittings
  const top = shieldProfile()[shieldProfile().length - 1];
  const inner = new THREE.Mesh(
    new THREE.LatheGeometry([new THREE.Vector2(top.x - 0.01, top.y), new THREE.Vector2(top.x - 0.25, top.y + 0.03), new THREE.Vector2(1.2, 0.5), new THREE.Vector2(0.02, 0.18)], 64),
    m.shieldBack,
  );
  g.add(outer, inner);
  for (let i = 0; i < 9; i++) {
    const a = (i / 9) * Math.PI * 2;
    const f = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.08, 0.12), m.ti);
    f.position.set(Math.cos(a) * 1.95, top.y + 0.04, Math.sin(a) * 1.95);
    f.rotation.y = -a;
    g.add(f);
  }
  castAll(g);
  return g;
}

/** backshell profile from the shoulder (y ≈ 0.86) up to the parachute can */
const BACKSHELL: [number, number][] = [
  [2.24, 0.84],
  [2.18, 0.93],
  [1.62, 1.86],
  [1.5, 1.95],
  [1.08, 2.55],
  [0.98, 2.62],
  [0.98, 2.98],
  [0.86, 3.08],
  [0.3, 3.14],
  [0.02, 3.15],
];

export function backshell(m: HwMats) {
  const g = new THREE.Group();
  const prof = BACKSHELL.map(([r, y]) => new THREE.Vector2(r, y));
  const shell = new THREE.Mesh(new THREE.LatheGeometry(prof, 96), m.shell);
  // the inside is visible once the heat shield has gone
  const inside = new THREE.Mesh(new THREE.LatheGeometry(prof.slice(0, 7), 48), m.shellIn);
  g.add(shell, inside);
  // cruise-stage interface ring and the parachute mortar cover
  const ring = new THREE.Mesh(new THREE.TorusGeometry(1.0, 0.045, 8, 64), m.ti);
  ring.rotation.x = Math.PI / 2;
  ring.position.y = 2.62;
  const cover = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.45, 0.08, 32), m.gold);
  cover.position.y = 3.17;
  g.add(ring, cover);
  // four RCS thruster pairs on the lower cone, with their plume shields
  const slope = Math.atan2(2.18 - 1.62, 1.86 - 0.93);
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + 0.8;
    const pod = new THREE.Group();
    pod.position.set(Math.cos(a) * 1.86, 1.45, Math.sin(a) * 1.86);
    pod.rotation.y = -a;
    pod.rotateZ(-slope);
    const block = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.32, 0.26), m.black);
    pod.add(block);
    for (const z of [-0.07, 0.07]) {
      const n = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.05, 0.1, 12, 1, true), m.nozzle);
      n.rotation.z = -Math.PI / 2;
      n.position.set(0.08, 0.05, z);
      pod.add(n);
    }
    g.add(pod);
  }
  // entry balance masses near the shoulder (dropped before parachute deploy on the real thing)
  for (const a of [0.3, 0.3 + Math.PI]) {
    const bm = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.14, 0.3), m.ti);
    bm.position.set(Math.cos(a) * 2.1, 1.05, Math.sin(a) * 2.1);
    bm.rotation.y = -a;
    g.add(bm);
  }
  castAll(g);
  return g;
}

/** heat shield + backshell, the aeroshell as it flies the entry */
export function aeroshell(m: HwMats) {
  const g = new THREE.Group();
  const shield = heatShield(m);
  const back = backshell(m);
  g.add(shield, back);
  return { g, shield, back };
}

// ———————————————————————————— parachute ————————————————————————————

/** disk-gap-band parachute, 21.5 m across, canopy apex at +44 m over the confluence */
export function parachute() {
  const g = new THREE.Group();
  const tx = makeCanopyTexture();
  const mat = new THREE.MeshStandardMaterial({ map: tx, side: THREE.DoubleSide, roughness: 0.9, transparent: true, opacity: 0.97 });
  const canopy = new THREE.Group();
  canopy.position.y = 44;
  g.add(canopy);
  // the disk: slightly scalloped between the radial tapes
  const diskPts: THREE.Vector2[] = [new THREE.Vector2(0.6, 6.55)];
  for (let i = 1; i <= 16; i++) {
    const a = (i / 16) * 1.1;
    diskPts.push(new THREE.Vector2(Math.sin(a) * 9.4, Math.cos(a) * 6.5));
  }
  const diskGeo = new THREE.LatheGeometry(diskPts, 160);
  const bandPts = [new THREE.Vector2(9.75, 1.5), new THREE.Vector2(10.3, 0.4), new THREE.Vector2(10.6, -1.0), new THREE.Vector2(10.75, -2.6)];
  const bandGeo = new THREE.LatheGeometry(bandPts, 160);
  // billow between gores: push vertices out a little mid-gore
  for (const geo of [diskGeo, bandGeo]) {
    const p = geo.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i);
      const z = p.getZ(i);
      const a = Math.atan2(z, x);
      const k = 1 + Math.abs(Math.sin(a * 40)) * 0.012;
      p.setXYZ(i, x * k, p.getY(i), z * k);
    }
    geo.computeVertexNormals();
  }
  const disk = new THREE.Mesh(diskGeo, mat);
  const band = new THREE.Mesh(bandGeo, mat);
  canopy.add(disk, band);
  // 80 suspension lines to the confluence, then the riser down to the backshell
  const v: number[] = [];
  for (let i = 0; i < 80; i++) {
    const a = (i / 80) * Math.PI * 2;
    v.push(Math.cos(a) * 10.75, 44 - 2.6, Math.sin(a) * 10.75, 0, 14, 0);
  }
  v.push(0, 14, 0, 0, 3.1, 0);
  const lg = new THREE.BufferGeometry();
  lg.setAttribute("position", new THREE.Float32BufferAttribute(v, 3));
  const lineMat = new THREE.LineBasicMaterial({ color: "#efe9dd", transparent: true, opacity: 0.55 });
  const lines = new THREE.LineSegments(lg, lineMat);
  // the riser is a real strap, visible from far away
  const riser = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 10.9, 6), new THREE.MeshStandardMaterial({ color: "#e8e1d0", roughness: 0.8 }));
  riser.position.y = 3.1 + 10.9 / 2;
  g.add(lines, riser);
  disk.castShadow = band.castShadow = true;
  return { g, canopy, lines, riser, dispose: () => [tx, mat, lineMat, lg, diskGeo, bandGeo, riser.geometry, riser.material as THREE.Material].forEach((d) => d.dispose()) };
}

// ———————————————————————————— descent stage ————————————————————————————

export type Stage = {
  g: THREE.Group;
  plumes: THREE.Mesh[];
  pm: THREE.ShaderMaterial;
  /** where the bridles and umbilical leave the stage (stage frame) */
  bud: THREE.Vector3;
};

/**
 * The sky crane: a dark machined frame carrying three propellant tanks and two pressurant tanks,
 * four outrigger pods of two Mars Landing Engines each (canted ~22° out so the plumes miss the rover),
 * the six-beam Terminal Descent Sensor radar, MLI blankets, and the bridle-umbilical device underneath.
 */
export function descentStage(m: HwMats, vacuum: boolean): Stage {
  const g = new THREE.Group();
  const add = (mesh: THREE.Mesh, x: number, y: number, z: number) => {
    mesh.position.set(x, y, z);
    g.add(mesh);
    return mesh;
  };
  const box = (w: number, h: number, d: number, mat: THREE.Material) => new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  const cyl = (r1: number, r2: number, h: number, mat: THREE.Material, seg = 16, open = false) => new THREE.Mesh(new THREE.CylinderGeometry(r1, r2, h, seg, 1, open), mat);

  // central body: panel box wrapped in MLI, with a silver radiator on top
  add(box(1.5, 0.34, 1.16, m.frame), 0, 0.02, 0);
  add(box(1.54, 0.12, 1.2, m.gold), 0, 0.2, 0);
  add(box(0.7, 0.02, 0.5, m.silver), 0.2, 0.27, -0.15);
  // main beams and cross members
  for (const z of [-0.6, 0.6]) add(box(3.3, 0.13, 0.14, m.beam), 0, -0.1, z);
  for (const x of [-1.25, 1.25]) add(box(0.14, 0.13, 2.5, m.beam), x, -0.1, 0);
  // underside truss: diagonals from the centre to the pods (what you see from the rover)
  const tube = (a: THREE.Vector3, b: THREE.Vector3, r: number, mat: THREE.Material) => {
    const d = b.clone().sub(a);
    const t = cyl(r, r, d.length(), mat, 8);
    t.position.copy(a).addScaledVector(d, 0.5);
    t.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize());
    g.add(t);
  };
  const pods: THREE.Vector3[] = [];
  for (const sx of [-1, 1])
    for (const sz of [-1, 1]) {
      const p = new THREE.Vector3(sx * 1.55, -0.08, sz * 1.18);
      pods.push(p);
      tube(new THREE.Vector3(sx * 0.4, -0.22, sz * 0.3), p.clone().setY(-0.16), 0.035, m.ti);
      tube(new THREE.Vector3(sx * 0.75, 0.12, sz * 0.58), p.clone().setY(0.0), 0.03, m.ti);
    }
  // tanks: three propellant spheres and two pressurant bottles
  for (const [x, z] of [
    [-0.62, -0.28],
    [0.62, -0.28],
    [0, 0.5],
  ]) {
    const t = new THREE.Mesh(new THREE.SphereGeometry(0.4, 32, 20), m.ti);
    add(t, x, 0.5, z);
    add(cyl(0.42, 0.42, 0.05, m.beam, 32), x, 0.5, z); // girth ring
    add(cyl(0.05, 0.05, 0.3, m.beam, 8), x, 0.18, z);
  }
  for (const x of [-1.0, 1.0]) {
    const t = new THREE.Mesh(new THREE.CapsuleGeometry(0.17, 0.35, 8, 16), m.silver);
    t.rotation.x = Math.PI / 2;
    add(t, x, 0.3, 0.45);
  }
  // engine pods: bracket, valves and two canted MLEs each
  const pm = plumeMaterial(vacuum);
  const plumes: THREE.Mesh[] = [];
  const bell = new THREE.LatheGeometry(
    Array.from({ length: 9 }, (_, i) => {
      const t = i / 8;
      return new THREE.Vector2(0.045 + 0.105 * Math.pow(t, 0.7), -t * 0.3);
    }),
    24,
  );
  const glowDisc = new THREE.CircleGeometry(0.135, 20);
  glowDisc.rotateX(Math.PI / 2);
  const plumeGeo = plumeGeometry(vacuum ? 9 : 4.6, 0.15);
  for (const p of pods) {
    const out = new THREE.Vector3(p.x, 0, p.z).normalize();
    const tang = new THREE.Vector3(-out.z, 0, out.x);
    add(box(0.42, 0.16, 0.42, m.beam), p.x, p.y, p.z).rotation.y = Math.atan2(out.x, out.z);
    add(box(0.44, 0.06, 0.44, m.gold), p.x, p.y + 0.11, p.z).rotation.y = Math.atan2(out.x, out.z);
    for (const off of [-0.16, 0.16]) {
      const eng = new THREE.Group();
      eng.position.copy(p).addScaledVector(tang, off).addScaledVector(out, 0.08);
      eng.position.y -= 0.1;
      // cant: tip the nozzle outward
      eng.quaternion.setFromAxisAngle(tang, 22 * D2R);
      const chamber = cyl(0.07, 0.06, 0.16, m.ti, 14);
      chamber.position.y = -0.04;
      const valve = box(0.1, 0.08, 0.1, m.black);
      valve.position.y = 0.05;
      const nz = new THREE.Mesh(bell, m.nozzle);
      nz.position.y = -0.12;
      const hot = new THREE.Mesh(glowDisc, m.hot);
      hot.position.y = -0.38;
      const pl = new THREE.Mesh(plumeGeo, pm);
      pl.position.y = -0.42;
      pl.frustumCulled = false;
      pl.renderOrder = 6;
      eng.add(chamber, valve, nz, hot, pl);
      g.add(eng);
      plumes.push(pl);
    }
  }
  // Terminal Descent Sensor: six radar antennas on a canted plate at the back
  const tds = new THREE.Group();
  tds.position.set(0, -0.26, -0.72);
  tds.rotation.x = 0.35;
  tds.add(box(0.9, 0.05, 0.36, m.frame));
  for (let i = 0; i < 6; i++) {
    const a = cyl(0.065, 0.065, 0.04, m.white, 16);
    a.position.set(-0.36 + i * 0.145, -0.04, (i % 2) * 0.1 - 0.05);
    tds.add(a);
  }
  g.add(tds);
  // bridle-umbilical device: a reel under the middle
  const bud = new THREE.Vector3(0, -0.42, 0.05);
  const reel = cyl(0.2, 0.2, 0.36, m.ti, 24);
  reel.rotation.z = Math.PI / 2;
  add(reel, bud.x, bud.y + 0.14, bud.z);
  add(cyl(0.22, 0.22, 0.04, m.gold, 24), bud.x - 0.2, bud.y + 0.14, bud.z).rotation.z = Math.PI / 2;
  add(cyl(0.22, 0.22, 0.04, m.gold, 24), bud.x + 0.2, bud.y + 0.14, bud.z).rotation.z = Math.PI / 2;
  add(box(0.5, 0.1, 0.3, m.beam), bud.x, bud.y + 0.34, bud.z);
  // UHF antenna and a couple of thermal radiators
  add(cyl(0.03, 0.03, 0.5, m.white, 8), -0.8, 0.45, -0.55);
  add(box(0.02, 0.3, 0.5, m.silver), 0.82, 0.1, -0.1);
  g.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (mesh.isMesh && mesh.material !== pm && mesh.material !== m.hot) {
      mesh.castShadow = true;
      mesh.receiveShadow = true;
    }
  });
  return { g, plumes, pm, bud };
}

/** set the glow inside every firing nozzle (0..1) */
export function setNozzleGlow(m: HwMats, k: number, vacuum: boolean) {
  const c = vacuum ? [1.6, 2.0, 3.2] : [5.5, 2.6, 1.0];
  m.hot.color.setRGB(c[0] * k, c[1] * k, c[2] * k);
}
