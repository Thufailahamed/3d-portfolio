import * as THREE from "three";
import { hash, rng } from "./noise";

/** Tileable value noise on a P×P lattice (wraps cleanly at the texture edge). */
function tileNoise(x: number, y: number, P: number, s: number) {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = x - ix;
  const fy = y - iy;
  const ux = fx * fx * (3 - 2 * fx);
  const uy = fy * fy * (3 - 2 * fy);
  const m = (v: number) => ((v % P) + P) % P;
  const a = hash(m(ix), m(iy), s);
  const b = hash(m(ix + 1), m(iy), s);
  const c = hash(m(ix), m(iy + 1), s);
  const d = hash(m(ix + 1), m(iy + 1), s);
  return a + (b - a) * ux + (c - a) * uy + (a - b - c + d) * ux * uy;
}

function tileFbm(u: number, v: number, P: number, oct: number, s: number) {
  let sum = 0;
  let amp = 0.5;
  let norm = 0;
  let p = P;
  for (let i = 0; i < oct; i++) {
    sum += amp * tileNoise(u * p, v * p, p, s + i);
    norm += amp;
    amp *= 0.5;
    p *= 2;
  }
  return sum / norm;
}

/** Four independent tileable noise fields, one per channel, at different grain. */
export function makeNoiseTexture(size = 256) {
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const u = x / size;
      const v = y / size;
      const i = (y * size + x) * 4;
      data[i] = tileFbm(u, v, 4, 4, 1) * 255;
      data[i + 1] = tileFbm(u, v, 8, 4, 7) * 255;
      data[i + 2] = tileFbm(u, v, 16, 3, 13) * 255;
      data[i + 3] = tileFbm(u, v, 3, 5, 19) * 255;
    }
  const t = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.needsUpdate = true;
  return t;
}

/** A regolith grain normal map: fine fbm plus scattered pits and pebble bumps. */
export function makeGrainNormal(size = 512) {
  const h = new Float32Array(size * size);
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) h[y * size + x] = tileFbm(x / size, y / size, 16, 5, 31) * 0.8;
  const r = rng(77);
  for (let k = 0; k < 900; k++) {
    const cx = r() * size;
    const cy = r() * size;
    const rad = 1.5 + r() * r() * 7;
    const amp = (r() < 0.6 ? 1 : -1) * (0.15 + r() * 0.35);
    const R = Math.ceil(rad);
    for (let dy = -R; dy <= R; dy++)
      for (let dx = -R; dx <= R; dx++) {
        const q = (dx * dx + dy * dy) / (rad * rad);
        if (q >= 1) continue;
        const px = (Math.floor(cx + dx) + size) % size;
        const py = (Math.floor(cy + dy) + size) % size;
        h[py * size + px] += amp * Math.sqrt(1 - q);
      }
  }
  const data = new Uint8Array(size * size * 4);
  const k = 2.2;
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const l = h[y * size + ((x - 1 + size) % size)];
      const rr = h[y * size + ((x + 1) % size)];
      const d = h[((y - 1 + size) % size) * size + x];
      const u = h[((y + 1) % size) * size + x];
      const nx = (l - rr) * k;
      const nz = (d - u) * k;
      const inv = 1 / Math.hypot(nx, 1, nz);
      const i = (y * size + x) * 4;
      data[i] = (nx * inv * 0.5 + 0.5) * 255;
      data[i + 1] = (nz * inv * 0.5 + 0.5) * 255;
      data[i + 2] = (inv * 0.5 + 0.5) * 255;
      data[i + 3] = 255;
    }
  const t = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.magFilter = THREE.LinearFilter;
  t.generateMipmaps = true;
  t.needsUpdate = true;
  return t;
}

export type DetailKind = "regolith" | "gravel" | "sand" | "ice" | "basalt";

/**
 * Close-up ground for one kind of surface, tileable: RG = normal (x, z), B = height (cavities dark),
 * A = albedo variation around 0.5. Regolith gets a power-law of micro-craters, gravel a desert
 * pavement of pebbles sat in sand, ice smooth sublimation pits, basalt vesicles and hairline cracks.
 */
export function makeDetailTexture(kind: DetailKind, size = 512) {
  const N = size * size;
  const h = new Float32Array(N);
  const alb = new Float32Array(N).fill(0.5);
  const fine = kind === "ice" ? 0.12 : kind === "sand" ? 0.35 : 0.5;
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const i = y * size + x;
      h[i] = (tileFbm(x / size, y / size, 32, 4, 31) - 0.5) * fine;
      alb[i] += (tileFbm(x / size, y / size, 8, 4, 57) - 0.5) * 0.35;
    }
  const r = rng(kind.length * 977 + 13);
  const wrap = (v: number) => ((v % size) + size) % size;
  /** stamp a radial profile f(q) (q = d²/R²) into height and albedo */
  const stamp = (cx: number, cy: number, R: number, fh: (q: number) => number, fa?: (q: number) => number, sy = 1) => {
    const Ri = Math.ceil(R * 1.6);
    for (let dy = -Ri; dy <= Ri; dy++)
      for (let dx = -Ri; dx <= Ri; dx++) {
        const q = (dx * dx + (dy * dy) / (sy * sy)) / (R * R);
        if (q >= 2.6) continue;
        const i = wrap(Math.floor(cy + dy)) * size + wrap(Math.floor(cx + dx));
        h[i] += fh(q);
        if (fa) alb[i] += fa(q);
      }
  };
  if (kind === "regolith") {
    // micro-craters: many tiny, few large; raised rims, fresh ones with bright ejecta
    for (let k = 0; k < 900; k++) {
      const R = 1.2 + Math.pow(r(), 3.2) * 30;
      const depth = R * (0.025 + r() * 0.035);
      const fresh = r() < 0.2;
      stamp(r() * size, r() * size, R, (q) => (q < 1 ? (q - 1) * depth * 1.1 + depth * 0.25 : depth * 0.25 * Math.exp(-(q - 1) * 4)), fresh ? (q) => (q < 2.4 ? 0.12 * Math.exp(-q * 0.8) : 0) : undefined);
    }
    for (let k = 0; k < 160; k++) {
      const R = 1 + r() * r() * 3;
      const a = r() * 2;
      stamp(r() * size, r() * size, R, (q) => (q < 1 ? Math.sqrt(1 - q) * R * 0.25 : 0), (q) => (q < 1 ? (a - 1) * 0.12 : 0));
    }
  } else if (kind === "gravel") {
    // desert pavement: angular-ish pebbles of every size, sat in finer sand
    for (let k = 0; k < 2600; k++) {
      const R = 1.1 + Math.pow(r(), 2.4) * 9;
      const sy = 0.6 + r() * 0.8;
      const tone = (r() - 0.5) * 0.55;
      stamp(r() * size, r() * size, R, (q) => (q < 1 ? Math.pow(1 - q, 0.6) * R * 0.32 : 0), (q) => (q < 1 ? tone - 0.04 : q < 1.5 ? -0.06 * (1.5 - q) : 0), sy);
    }
  } else if (kind === "sand") {
    for (let k = 0; k < 1800; k++) {
      const R = 0.8 + r() * r() * 3;
      const tone = (r() - 0.5) * 0.4;
      stamp(r() * size, r() * size, R, (q) => (q < 1 ? Math.sqrt(1 - q) * R * 0.25 : 0), (q) => (q < 1 ? tone : 0));
    }
  } else if (kind === "ice") {
    // shallow sublimation pits with dark tholin-stained floors
    for (let k = 0; k < 320; k++) {
      const R = 3 + Math.pow(r(), 2) * 22;
      const d = R * (0.04 + r() * 0.04);
      stamp(r() * size, r() * size, R, (q) => (q < 1 ? -(1 - q) * (1 - q) * d * 2 : 0), (q) => (q < 1 ? -0.18 * (1 - q) : 0));
    }
  } else {
    // basalt: vesicles and a hairline crack web
    for (let k = 0; k < 900; k++) {
      const R = 0.8 + r() * r() * 3;
      stamp(r() * size, r() * size, R, (q) => (q < 1 ? -(1 - q) * R * 0.4 : 0), (q) => (q < 1 ? -0.12 : 0));
    }
    const P = 9;
    const pts: [number, number][] = [];
    for (let j = 0; j < P; j++) for (let i = 0; i < P; i++) pts.push([(i + 0.15 + 0.7 * r()) / P, (j + 0.15 + 0.7 * r()) / P]);
    for (let y = 0; y < size; y++)
      for (let x = 0; x < size; x++) {
        const u = x / size;
        const v = y / size;
        let f1 = 9;
        let f2 = 9;
        const ci = Math.floor(u * P);
        const cj = Math.floor(v * P);
        for (let oy = -1; oy <= 1; oy++)
          for (let ox = -1; ox <= 1; ox++) {
            const ii = ci + ox;
            const jj = cj + oy;
            const wi = ((ii % P) + P) % P;
            const wj = ((jj % P) + P) % P;
            const [px, py] = pts[wj * P + wi];
            const d = Math.hypot(u - (px + (ii - wi) / P), v - (py + (jj - wj) / P));
            if (d < f1) {
              f2 = f1;
              f1 = d;
            } else if (d < f2) f2 = d;
          }
        const e = (f2 - f1) * P;
        const c = 1 - Math.min(1, e / 0.05);
        h[y * size + x] -= c * 1.2;
        alb[y * size + x] -= c * 0.25;
      }
  }
  const data = new Uint8Array(N * 4);
  let lo = Infinity;
  let hi = -Infinity;
  for (let i = 0; i < N; i++) {
    lo = Math.min(lo, h[i]);
    hi = Math.max(hi, h[i]);
  }
  const k = 1.4;
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const l = h[y * size + wrap(x - 1)];
      const rr = h[y * size + wrap(x + 1)];
      const d = h[wrap(y - 1) * size + x];
      const u = h[wrap(y + 1) * size + x];
      const nx = (l - rr) * k;
      const nz = (d - u) * k;
      const inv = 1 / Math.hypot(nx, 1, nz);
      const i = (y * size + x) * 4;
      data[i] = (nx * inv * 0.5 + 0.5) * 255;
      data[i + 1] = (nz * inv * 0.5 + 0.5) * 255;
      data[i + 2] = ((h[y * size + x] - lo) / Math.max(1e-6, hi - lo)) * 255;
      data[i + 3] = Math.max(0, Math.min(1, alb[y * size + x])) * 255;
    }
  const t = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.magFilter = THREE.LinearFilter;
  t.anisotropy = 8;
  t.generateMipmaps = true;
  t.needsUpdate = true;
  return t;
}

function canvas(w: number, h: number) {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  return [c, c.getContext("2d")!] as const;
}

/**
 * A wheel print: chevron grousers, and the holes Curiosity's wheels punch in Morse code
 * (".--- .--. .-.." — JPL) so drivers can measure slip from the track.
 */
export function makeTrackTexture() {
  // three.js alpha maps read the green channel: paint opacity as white on black
  const [c, g] = canvas(128, 256);
  g.fillStyle = "#000";
  g.fillRect(0, 0, 128, 256);
  // compacted band
  const grad = g.createLinearGradient(0, 0, 128, 0);
  grad.addColorStop(0, "rgb(0,0,0)");
  grad.addColorStop(0.14, "rgb(120,120,120)");
  grad.addColorStop(0.86, "rgb(120,120,120)");
  grad.addColorStop(1, "rgb(0,0,0)");
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 256);
  // grouser chevrons press deeper
  g.strokeStyle = "rgb(255,255,255)";
  g.lineWidth = 7;
  g.lineCap = "round";
  for (let k = 0; k < 8; k++) {
    const y = k * 32 + 10;
    g.beginPath();
    g.moveTo(14, y + 12);
    g.lineTo(64, y);
    g.lineTo(114, y + 12);
    g.stroke();
  }
  // the Morse-code holes leave little raised patches that stay undisturbed
  const morse = ".---.--..-..";
  g.fillStyle = "rgb(30,30,30)";
  let y = 4;
  for (const ch of morse) {
    const len = ch === "." ? 8 : 20;
    g.fillRect(54, y, 20, len);
    y += len + 6;
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.NoColorSpace;
  t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 4;
  return t;
}

/** Deck plating: panels, seams, anti-slip dimples. */
export function makeDeckTexture() {
  const [c, g] = canvas(512, 512);
  g.fillStyle = "#8a8f96";
  g.fillRect(0, 0, 512, 512);
  const r = rng(5);
  for (let py = 0; py < 4; py++)
    for (let px = 0; px < 4; px++) {
      const v = 128 + Math.floor((r() - 0.5) * 22);
      g.fillStyle = `rgb(${v},${v + 4},${v + 10})`;
      g.fillRect(px * 128 + 2, py * 128 + 2, 124, 124);
      g.fillStyle = "rgba(0,0,0,0.12)";
      for (let k = 0; k < 64; k++) {
        const x = px * 128 + 10 + (k % 8) * 14 + (Math.floor(k / 8) % 2) * 7;
        const y = py * 128 + 10 + Math.floor(k / 8) * 14;
        g.fillRect(x, y, 5, 2);
      }
      g.fillStyle = "rgba(20,20,24,0.8)";
      for (const [ox, oy] of [[6, 6], [118, 6], [6, 118], [118, 118]]) {
        g.beginPath();
        g.arc(px * 128 + ox + 2, py * 128 + oy + 2, 2.5, 0, Math.PI * 2);
        g.fill();
      }
    }
  for (let k = 0; k < 40; k++) {
    g.fillStyle = `rgba(60,40,20,${0.03 + r() * 0.05})`;
    g.beginPath();
    g.arc(r() * 512, r() * 512, 10 + r() * 60, 0, Math.PI * 2);
    g.fill();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  return t;
}

export function makeHazardTexture() {
  const [c, g] = canvas(256, 32);
  g.fillStyle = "#f2b705";
  g.fillRect(0, 0, 256, 32);
  g.fillStyle = "#16161a";
  for (let x = -32; x < 256; x += 32) {
    g.beginPath();
    g.moveTo(x, 32);
    g.lineTo(x + 16, 0);
    g.lineTo(x + 32, 0);
    g.lineTo(x + 16, 32);
    g.fill();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = THREE.RepeatWrapping;
  return t;
}

/** Disk-gap-band canopy gores in Perseverance's red-and-white binary pattern. */
export function makeChuteTexture() {
  const [c, g] = canvas(512, 256);
  const gores = 80;
  // "DARE MIGHTY THINGS" in 7-bit code, ring by ring, as on the 2021 canopy
  const rings = ["1000100", "1001101", "1010100", "0101101"];
  for (let i = 0; i < gores; i++) {
    const x = (i / gores) * 512;
    for (let r = 0; r < 4; r++) {
      const bit = rings[r][i % 7] === "1";
      const y0 = r < 3 ? r * 52 : 190;
      const hh = r < 3 ? 52 : 66;
      g.fillStyle = bit ? "#c4381f" : "#f3efe6";
      g.fillRect(x, y0, 512 / gores + 0.5, hh);
    }
    g.fillStyle = "rgba(0,0,0,0.15)";
    g.fillRect(x, 0, 1, 256);
  }
  // the gap between disk and band
  g.clearRect(0, 156, 512, 34);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = THREE.RepeatWrapping;
  return t;
}

/** Crinkled gold multilayer insulation. */
export function makeFoilTexture() {
  const [c, g] = canvas(256, 256);
  g.fillStyle = "#c79a3a";
  g.fillRect(0, 0, 256, 256);
  const r = rng(9);
  for (let k = 0; k < 260; k++) {
    const x = r() * 256;
    const y = r() * 256;
    const w = 10 + r() * 50;
    const a = r() * Math.PI;
    g.strokeStyle = r() < 0.5 ? `rgba(255,236,170,${0.15 + r() * 0.35})` : `rgba(90,60,10,${0.15 + r() * 0.3})`;
    g.lineWidth = 1 + r() * 3;
    g.beginPath();
    g.moveTo(x, y);
    g.lineTo(x + Math.cos(a) * w, y + Math.sin(a) * w);
    g.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

/** Soft, lumpy sprite for dust and exhaust: a gaussian core broken up by noise, no visible rim. */
export function makePuffTexture() {
  const S = 64;
  const data = new Uint8Array(S * S * 4);
  for (let y = 0; y < S; y++)
    for (let x = 0; x < S; x++) {
      const u = (x + 0.5) / S - 0.5;
      const v = (y + 0.5) / S - 0.5;
      const r2 = (u * u + v * v) * 4;
      const lump = 0.65 + 0.35 * tileFbm(x / S, y / S, 4, 3, 91);
      const a = Math.exp(-r2 * 4.2) * (1 - Math.min(1, r2)) * lump;
      const i = (y * S + x) * 4;
      data[i] = data[i + 1] = data[i + 2] = Math.min(255, a * 255);
      data[i + 3] = 255;
    }
  const t = new THREE.DataTexture(data, S, S, THREE.RGBAFormat);
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.needsUpdate = true;
  return t;
}
