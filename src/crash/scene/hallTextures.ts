/**
 * The crash hall's painted and printed surfaces, drawn on canvases (no image assets): the floor's
 * photogrammetry grid, approach lane and distance marks; the barrier's load-cell face plate; hazard
 * stripes; the aluminium honeycomb of the deformable faces; the lab's stencil.
 */
import * as THREE from "three";

const YELLOW = "#ffc400";

function canvas(w: number, h: number) {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  return [c, c.getContext("2d")!] as const;
}

const tex = (c: HTMLCanvasElement, srgb = true) => {
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
};

/**
 * The floor markings over a `size` × `size` m square centred on the impact point, `ppm` pixels per
 * metre: a 0.5 m grid round the impact zone (fading out), the approach lane's centre line and the
 * tow-rail slot running back along −x, distance marks every metre with numerals, an impact cross.
 * Transparent where nothing is painted.
 */
export function floorMarkings(size = 28, ppm = 72, approach = 1) {
  const px = Math.round(size * ppm);
  const [c, g] = canvas(px, px);
  const X = (m: number) => px / 2 + m * ppm; // world x → canvas x
  const Z = (m: number) => px / 2 + m * ppm; // world z → canvas y
  g.clearRect(0, 0, px, px);
  // the grid: fine 0.5 m lines inside ±6 m, alpha falling off with distance
  for (let m = -6; m <= 6; m += 0.5) {
    const major = Math.abs(m % 1) < 1e-6;
    const a = 0.55 * (1 - Math.abs(m) / 7) * (major ? 1 : 0.6);
    g.strokeStyle = `rgba(20,20,22,${a})`;
    g.lineWidth = major ? 2.2 : 1.2;
    g.beginPath();
    g.moveTo(X(m), Z(-6));
    g.lineTo(X(m), Z(6));
    g.moveTo(X(-6), Z(m));
    g.lineTo(X(6), Z(m));
    g.stroke();
  }
  // the approach lane: a yellow centre line broken where the tow rail runs, the slot itself dark
  g.fillStyle = "rgba(14,14,16,0.92)";
  g.fillRect(X(-size / 2), Z(-0.035), X(-0.6) - X(-size / 2), 0.07 * ppm);
  g.fillStyle = "rgba(150,152,156,0.9)";
  g.fillRect(X(-size / 2), Z(-0.045), X(-0.6) - X(-size / 2), 0.012 * ppm);
  g.fillRect(X(-size / 2), Z(0.033), X(-0.6) - X(-size / 2), 0.012 * ppm);
  g.fillStyle = YELLOW;
  for (let m = -size / 2; m < -0.8; m += 1) {
    g.fillRect(X(m), Z(-0.12 * approach) - 0.02 * ppm, 0.5 * ppm, 0.04 * ppm);
    g.fillRect(X(m), Z(0.12 * approach) - 0.02 * ppm, 0.5 * ppm, 0.04 * ppm);
  }
  // distance marks: a tick every metre, the number every 2 m, on both sides of the lane
  g.font = `600 ${Math.round(0.26 * ppm)}px "JetBrains Mono", ui-monospace, monospace`;
  g.textAlign = "center";
  g.textBaseline = "middle";
  for (let m = 1; m <= size / 2 - 1; m++) {
    const x = X(-m);
    g.fillStyle = "rgba(235,235,232,0.85)";
    g.fillRect(x - 0.012 * ppm, Z(-1.6), 0.024 * ppm, 0.35 * ppm);
    g.fillRect(x - 0.012 * ppm, Z(1.25), 0.024 * ppm, 0.35 * ppm);
    if (m % 2 === 0) {
      g.save();
      g.translate(x, Z(-2.05));
      g.rotate(Math.PI / 2);
      g.fillText(`${m}`, 0, 0);
      g.restore();
      g.save();
      g.translate(x, Z(2.05));
      g.rotate(-Math.PI / 2);
      g.fillText(`${m}`, 0, 0);
      g.restore();
    }
  }
  // the impact cross
  g.strokeStyle = YELLOW;
  g.lineWidth = 0.05 * ppm;
  g.beginPath();
  g.moveTo(X(-0.35), Z(0));
  g.lineTo(X(0.35), Z(0));
  g.moveTo(X(0), Z(-0.35));
  g.lineTo(X(0), Z(0.35));
  g.stroke();
  const t = tex(c);
  t.premultiplyAlpha = false;
  return t;
}

/** The steel face plate of a rigid barrier: a grid of load-cell plates with bolt heads, a little rust and scuffing. */
export function loadCellPlate(cells = 8, rows = 4) {
  const cw = 128;
  const [c, g] = canvas(cells * cw, rows * cw);
  g.fillStyle = "#6c6e70";
  g.fillRect(0, 0, c.width, c.height);
  for (let i = 0; i < cells; i++)
    for (let j = 0; j < rows; j++) {
      const x = i * cw, y = j * cw;
      const shade = 96 + ((i * 7 + j * 13) % 9) * 4;
      g.fillStyle = `rgb(${shade},${shade + 2},${shade + 5})`;
      g.fillRect(x + 3, y + 3, cw - 6, cw - 6);
      g.fillStyle = "rgba(0,0,0,0.55)";
      g.fillRect(x, y, cw, 3);
      g.fillRect(x, y, 3, cw);
      for (const [bx, by] of [[14, 14], [cw - 14, 14], [14, cw - 14], [cw - 14, cw - 14]]) {
        g.fillStyle = "#2a2b2d";
        g.beginPath();
        g.arc(x + bx, y + by, 7, 0, Math.PI * 2);
        g.fill();
        g.fillStyle = "#a9abad";
        g.beginPath();
        g.arc(x + bx - 1.5, y + by - 1.5, 4, 0, Math.PI * 2);
        g.fill();
      }
      // scuffs and paint transfer from earlier tests
      for (let k = 0; k < 6; k++) {
        g.strokeStyle = `rgba(${k % 2 ? "40,40,42" : "160,60,40"},${0.08 + ((i + j + k) % 5) * 0.03})`;
        g.lineWidth = 1 + (k % 3);
        g.beginPath();
        const sx = x + ((i * 37 + k * 23) % cw), sy = y + ((j * 53 + k * 17) % cw);
        g.moveTo(sx, sy);
        g.lineTo(sx + 30 - k * 9, sy + 6 + k * 3);
        g.stroke();
      }
    }
  return tex(c);
}

/** Diagonal black and safety-yellow stripes. */
export function hazard(repeat = 6) {
  const [c, g] = canvas(256, 256);
  g.fillStyle = "#121214";
  g.fillRect(0, 0, 256, 256);
  g.fillStyle = YELLOW;
  for (let i = -256; i < 512; i += 64) {
    g.beginPath();
    g.moveTo(i, 0);
    g.lineTo(i + 32, 0);
    g.lineTo(i + 32 - 256, 256);
    g.lineTo(i - 256, 256);
    g.closePath();
    g.fill();
  }
  // worn: the yellow chipped at the edges
  g.globalCompositeOperation = "multiply";
  for (let k = 0; k < 220; k++) {
    g.fillStyle = `rgba(60,60,60,${0.15 + (k % 4) * 0.1})`;
    g.fillRect((k * 97) % 256, (k * 61) % 256, 2 + (k % 5), 2 + (k % 3));
  }
  const t = tex(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeat, 1);
  return t;
}

/** Aluminium honeycomb, end-on: hexagonal cells of thin foil, catching light at their walls. */
export function honeycomb() {
  const [c, g] = canvas(512, 512);
  g.fillStyle = "#3d4044";
  g.fillRect(0, 0, 512, 512);
  const r = 14, h = r * Math.sqrt(3);
  g.lineWidth = 2.2;
  for (let row = -1; row < 512 / h + 2; row++)
    for (let col = -1; col < 512 / (r * 1.5) + 2; col++) {
      const cx = col * r * 1.5, cy = row * h + (col % 2 ? h / 2 : 0);
      g.strokeStyle = `rgb(${170 + ((row * 7 + col * 3) % 6) * 8},${172 + ((row * 5 + col) % 5) * 8},${176 + ((row + col * 7) % 5) * 7})`;
      g.beginPath();
      for (let k = 0; k <= 6; k++) {
        const a = (Math.PI / 3) * k;
        const x = cx + r * Math.cos(a), y = cy + r * Math.sin(a);
        if (k) g.lineTo(x, y);
        else g.moveTo(x, y);
      }
      g.stroke();
    }
  const t = tex(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

/** The lab's stencil for the barrier's flank. */
export function stencil(text = "IMPACT LAB", sub = "BARRIER 02 · 90 t") {
  const [c, g] = canvas(1024, 256);
  g.clearRect(0, 0, 1024, 256);
  g.fillStyle = "rgba(235,232,224,0.82)";
  g.font = `800 120px "Inter Tight", "Arial Narrow", sans-serif`;
  g.textBaseline = "alphabetic";
  g.fillText(text, 24, 150);
  g.font = `600 40px "JetBrains Mono", ui-monospace, monospace`;
  g.fillStyle = "rgba(235,232,224,0.6)";
  g.fillText(sub, 28, 215);
  return tex(c);
}

/** A target band for the pole: yellow and black quadrant circles round a painted tube. */
export function poleBand() {
  const [c, g] = canvas(512, 128);
  g.fillStyle = "#2b2d30";
  g.fillRect(0, 0, 512, 128);
  for (let i = 0; i < 4; i++) {
    const cx = 64 + i * 128, cy = 64, r = 40;
    for (let q = 0; q < 4; q++) {
      g.fillStyle = q % 2 ? "#0d0d0e" : YELLOW;
      g.beginPath();
      g.moveTo(cx, cy);
      g.arc(cx, cy, r, (q * Math.PI) / 2, ((q + 1) * Math.PI) / 2);
      g.closePath();
      g.fill();
    }
    g.strokeStyle = "#0d0d0e";
    g.lineWidth = 6;
    g.beginPath();
    g.arc(cx, cy, r, 0, Math.PI * 2);
    g.stroke();
  }
  const t = tex(c);
  t.wrapS = THREE.RepeatWrapping;
  return t;
}
