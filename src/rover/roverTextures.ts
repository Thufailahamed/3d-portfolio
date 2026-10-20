import * as THREE from "three";
import { rng } from "./noise";

/**
 * Canvas textures for the rover's surfaces. Everything tiles at one repeat per metre of
 * box-projected UV, so seams, rivets and labels keep a real-world size on every part.
 */

function canvas(w: number, h: number) {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  return [c, c.getContext("2d")!] as const;
}

function tex(c: HTMLCanvasElement, srgb: boolean, aniso = 4) {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = aniso;
  return t;
}

/** draw on a canvas so that shapes crossing an edge reappear on the other side */
function wrapped(g: CanvasRenderingContext2D, S: number, x: number, y: number, draw: (x: number, y: number) => void) {
  for (const dx of [-S, 0, S]) for (const dy of [-S, 0, S]) draw(x + dx, y + dy);
}

/**
 * Painted thermal-control panels: albedo (near white, the material colour sets the tint),
 * a bump map with panel seams, fastener heads and raised labels, and a roughness map.
 */
export function makePaintTextures() {
  const S = 512;
  const [cm, gm] = canvas(S, S);
  const [cb, gb] = canvas(S, S);
  const [cr, gr] = canvas(S, S);
  const r = rng(31);
  gm.fillStyle = "#f4f2ee";
  gm.fillRect(0, 0, S, S);
  gb.fillStyle = "#808080";
  gb.fillRect(0, 0, S, S);
  gr.fillStyle = "#b4b4b4";
  gr.fillRect(0, 0, S, S);

  // faint handling grime and paint variation
  for (let k = 0; k < 90; k++) {
    const x = r() * S;
    const y = r() * S;
    const rad = 10 + r() * 60;
    wrapped(gm, S, x, y, (px, py) => {
      const grd = gm.createRadialGradient(px, py, 0, px, py, rad);
      const dark = r() < 0.7;
      grd.addColorStop(0, dark ? `rgba(120,108,92,${0.025 + r() * 0.04})` : `rgba(255,255,255,${0.04 + r() * 0.04})`);
      grd.addColorStop(1, "rgba(0,0,0,0)");
      gm.fillStyle = grd;
      gm.fillRect(px - rad, py - rad, rad * 2, rad * 2);
    });
  }

  // panel seams: a few irregular divisions, each a groove with a rivet row beside it
  const us = [0, 0.58];
  const vs = [0, 0.43];
  const seam = (x0: number, y0: number, x1: number, y1: number) => {
    gm.strokeStyle = "rgba(70,64,56,0.38)";
    gm.lineWidth = 1.6;
    gm.beginPath();
    gm.moveTo(x0, y0);
    gm.lineTo(x1, y1);
    gm.stroke();
    gb.strokeStyle = "#2a2a2a";
    gb.lineWidth = 2.4;
    gb.beginPath();
    gb.moveTo(x0, y0);
    gb.lineTo(x1, y1);
    gb.stroke();
    gr.strokeStyle = "#e0e0e0";
    gr.lineWidth = 2;
    gr.beginPath();
    gr.moveTo(x0, y0);
    gr.lineTo(x1, y1);
    gr.stroke();
    const len = Math.hypot(x1 - x0, y1 - y0);
    const nx = -(y1 - y0) / len;
    const ny = (x1 - x0) / len;
    for (let d = 6; d < len; d += 11) {
      const px = x0 + ((x1 - x0) * d) / len + nx * 5;
      const py = y0 + ((y1 - y0) * d) / len + ny * 5;
      gm.fillStyle = "rgba(150,145,138,0.7)";
      gm.beginPath();
      gm.arc(px, py, 1.3, 0, Math.PI * 2);
      gm.fill();
      gb.fillStyle = "#d8d8d8";
      gb.beginPath();
      gb.arc(px, py, 1.6, 0, Math.PI * 2);
      gb.fill();
    }
  };
  for (const u of us) seam(u * S + 1, 0, u * S + 1, S);
  for (const v of vs) seam(0, v * S + 1, S, v * S + 1);
  // a couple of access hatches with corner fasteners
  for (let k = 0; k < 5; k++) {
    const w = 30 + r() * 60;
    const h = 24 + r() * 50;
    const x = r() * (S - w);
    const y = r() * (S - h);
    gm.strokeStyle = "rgba(90,84,76,0.45)";
    gm.lineWidth = 1.2;
    gm.strokeRect(x, y, w, h);
    gb.strokeStyle = "#4a4a4a";
    gb.lineWidth = 1.6;
    gb.strokeRect(x, y, w, h);
    for (const [cx, cy] of [[x + 4, y + 4], [x + w - 4, y + 4], [x + 4, y + h - 4], [x + w - 4, y + h - 4]]) {
      gm.fillStyle = "rgba(120,116,110,0.8)";
      gm.beginPath();
      gm.arc(cx, cy, 1.5, 0, Math.PI * 2);
      gm.fill();
      gb.fillStyle = "#e0e0e0";
      gb.beginPath();
      gb.arc(cx, cy, 1.8, 0, Math.PI * 2);
      gb.fill();
    }
  }
  // small instruction labels: unreadable printed lines on a raised film
  for (let k = 0; k < 7; k++) {
    const w = 14 + r() * 22;
    const h = 7 + r() * 9;
    const x = r() * (S - w);
    const y = r() * (S - h);
    const kind = r();
    if (kind < 0.18) {
      // hazard stripe tag
      gm.fillStyle = "#d9a21a";
      gm.fillRect(x, y, w, h * 0.7);
      gm.fillStyle = "#1b1b1b";
      for (let s = -h; s < w; s += 5) {
        gm.save();
        gm.beginPath();
        gm.rect(x, y, w, h * 0.7);
        gm.clip();
        gm.beginPath();
        gm.moveTo(x + s, y + h * 0.7);
        gm.lineTo(x + s + 2.5, y + h * 0.7);
        gm.lineTo(x + s + 2.5 + h * 0.7, y);
        gm.lineTo(x + s + h * 0.7, y);
        gm.fill();
        gm.restore();
      }
    } else if (kind < 0.35) {
      // amber polyimide tape
      gm.fillStyle = "rgba(196,120,36,0.55)";
      gm.fillRect(x, y, w * 1.6, h * 0.6);
    } else {
      gm.fillStyle = "#fbfaf6";
      gm.fillRect(x, y, w, h);
      gm.strokeStyle = "rgba(40,40,40,0.5)";
      gm.lineWidth = 0.6;
      gm.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
      gm.fillStyle = "rgba(30,30,30,0.55)";
      for (let l = y + 2.5; l < y + h - 2; l += 2.2) gm.fillRect(x + 2, l, (w - 4) * (0.4 + r() * 0.6), 0.8);
    }
    gb.fillStyle = "#909090";
    gb.fillRect(x, y, w, h);
    gr.fillStyle = "#6e6e6e";
    gr.fillRect(x, y, w, h);
  }
  return { map: tex(cm, true, 8), bump: tex(cb, false, 8), rough: tex(cr, false, 8) };
}

/**
 * Multi-layer insulation: crumpled metallised film. Height field from wrapped crease lines,
 * turned into a normal map; the colour darkens in the folds.
 */
export function makeFoilTextures(base = [214, 166, 74]) {
  const S = 256;
  const h = new Float32Array(S * S);
  const r = rng(77);
  for (let k = 0; k < 110; k++) {
    const cx = r() * S;
    const cy = r() * S;
    const a = r() * Math.PI;
    const dx = Math.cos(a);
    const dy = Math.sin(a);
    const half = 24 + r() * 80;
    const w = 3 + r() * 9;
    const amp = (r() - 0.5) * 2 * (0.6 + r());
    const x0 = Math.floor(cx - half - w);
    const x1 = Math.ceil(cx + half + w);
    const y0 = Math.floor(cy - half - w);
    const y1 = Math.ceil(cy + half + w);
    for (let y = y0; y <= y1; y++)
      for (let x = x0; x <= x1; x++) {
        const px = x - cx;
        const py = y - cy;
        const along = px * dx + py * dy;
        if (Math.abs(along) > half) continue;
        const perp = Math.abs(-px * dy + py * dx);
        if (perp > w) continue;
        const fall = 1 - Math.pow(Math.abs(along) / half, 2);
        const i = (((y % S) + S) % S) * S + (((x % S) + S) % S);
        h[i] += amp * (1 - perp / w) * fall;
      }
  }
  const [cm, gm] = canvas(S, S);
  const [cn, gn] = canvas(S, S);
  const [cr, gr] = canvas(S, S);
  const im = gm.createImageData(S, S);
  const inn = gn.createImageData(S, S);
  const ir = gr.createImageData(S, S);
  const at = (x: number, y: number) => h[(((y % S) + S) % S) * S + (((x % S) + S) % S)];
  for (let y = 0; y < S; y++)
    for (let x = 0; x < S; x++) {
      const nx = (at(x - 1, y) - at(x + 1, y)) * 1.6;
      const ny = (at(x, y - 1) - at(x, y + 1)) * 1.6;
      const l = Math.hypot(nx, ny, 1);
      const i = (y * S + x) * 4;
      inn.data[i] = ((nx / l) * 0.5 + 0.5) * 255;
      inn.data[i + 1] = ((ny / l) * 0.5 + 0.5) * 255;
      inn.data[i + 2] = ((1 / l) * 0.5 + 0.5) * 255;
      inn.data[i + 3] = 255;
      const crease = Math.min(1, Math.hypot(nx, ny) * 0.9);
      const shade = 0.9 + (nx - ny) * 0.16 - crease * 0.12;
      im.data[i] = Math.min(255, base[0] * shade);
      im.data[i + 1] = Math.min(255, base[1] * shade);
      im.data[i + 2] = Math.min(255, base[2] * shade);
      im.data[i + 3] = 255;
      const rough = 192 + crease * 63;
      ir.data[i] = ir.data[i + 1] = ir.data[i + 2] = rough;
      ir.data[i + 3] = 255;
    }
  gm.putImageData(im, 0, 0);
  gn.putImageData(inn, 0, 0);
  gr.putImageData(ir, 0, 0);
  return { map: tex(cm, true), normal: tex(cn, false), rough: tex(cr, false) };
}

/** brushed / machined metal: fine streaks along u in the roughness */
export function makeBrushedTexture() {
  const S = 256;
  const [c, g] = canvas(S, S);
  g.fillStyle = "#8a8a8a";
  g.fillRect(0, 0, S, S);
  const r = rng(5);
  for (let k = 0; k < 900; k++) {
    const y = r() * S;
    const v = 100 + r() * 70;
    g.fillStyle = `rgba(${v},${v},${v},${0.25 + r() * 0.4})`;
    const x = r() * S;
    const len = 30 + r() * 200;
    g.fillRect(x, y, len, 0.8 + r() * 0.8);
    g.fillRect(x - S, y, len, 0.8 + r() * 0.8);
  }
  // a few scuffs
  for (let k = 0; k < 40; k++) {
    g.fillStyle = `rgba(200,200,200,${0.2 + r() * 0.3})`;
    g.fillRect(r() * S, r() * S, 2 + r() * 8, 1 + r() * 3);
  }
  return tex(c, false, 8);
}

/** the colour-chip calibration target with its shadow-post rings */
export function makeCalibrationTexture() {
  const S = 128;
  const [c, g] = canvas(S, S);
  g.fillStyle = "#8e8c88";
  g.fillRect(0, 0, S, S);
  const chips = ["#b5372b", "#2f7d43", "#2d4f9c", "#e1b52c"];
  chips.forEach((col, i) => {
    g.fillStyle = col;
    g.fillRect(i % 2 ? S - 30 : 6, i < 2 ? 6 : S - 30, 24, 24);
  });
  for (const [rad, col] of [[44, "#f1f0ec"], [34, "#4a4a48"], [24, "#c9c8c4"], [14, "#1e1e1e"]] as [number, string][]) {
    g.fillStyle = col;
    g.beginPath();
    g.arc(S / 2, S / 2, rad, 0, Math.PI * 2);
    g.fill();
  }
  const t = tex(c, true);
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  return t;
}

/** an engraved anodised nameplate */
export function makePlateTexture(text: string) {
  const [c, g] = canvas(512, 128);
  g.fillStyle = "#2b2d31";
  g.fillRect(0, 0, 512, 128);
  g.strokeStyle = "#8d9097";
  g.lineWidth = 4;
  g.strokeRect(10, 10, 492, 108);
  g.fillStyle = "#c9ccd2";
  g.font = "600 54px ui-sans-serif, system-ui, sans-serif";
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.fillText(text, 256, 66);
  for (const x of [26, 486]) {
    g.beginPath();
    g.arc(x, 64, 6, 0, Math.PI * 2);
    g.fill();
  }
  const t = tex(c, true);
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  return t;
}
