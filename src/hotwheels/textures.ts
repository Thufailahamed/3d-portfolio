import * as THREE from "three";

/**
 * Every surface's texture is painted on a canvas at load: no image files. Wood grain, the rug's
 * weave, metal flake, car liveries, signs and the letters on the blocks.
 */

let seed = 1;
const rand = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
const reseed = (s: number) => void (seed = s >>> 0 || 1);

function canvas(w: number, h: number) {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  return { c, g: c.getContext("2d")! };
}

function tex(c: HTMLCanvasElement, opts: { srgb?: boolean; repeat?: [number, number]; aniso?: number } = {}) {
  const t = new THREE.CanvasTexture(c);
  if (opts.srgb !== false) t.colorSpace = THREE.SRGBColorSpace;
  if (opts.repeat) {
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(...opts.repeat);
  }
  t.anisotropy = opts.aniso ?? 8;
  t.needsUpdate = true;
  return t;
}

/** Value noise on a grid, smoothly interpolated (for grain, mottling, wear). */
function noise2(w: number, h: number, cells: number, s: number) {
  reseed(s);
  const gw = cells + 1;
  const grid = new Float32Array(gw * gw).map(() => rand());
  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const fx = (x / w) * cells;
      const fy = (y / h) * cells;
      const ix = Math.floor(fx);
      const iy = Math.floor(fy);
      const tx = fx - ix;
      const ty = fy - iy;
      const sx = tx * tx * (3 - 2 * tx);
      const sy = ty * ty * (3 - 2 * ty);
      const i0 = (iy % cells) * gw + (ix % cells);
      const i1 = (iy % cells) * gw + ((ix + 1) % cells);
      const i2 = ((iy + 1) % cells) * gw + (ix % cells);
      const i3 = ((iy + 1) % cells) * gw + ((ix + 1) % cells);
      const a = grid[i0] + (grid[i1] - grid[i0]) * sx;
      const b = grid[i2] + (grid[i3] - grid[i2]) * sx;
      out[y * w + x] = a + (b - a) * sy;
    }
  return out;
}

/** A tangent-space normal map from a height field (wraps at the edges). */
function normalFromHeight(hgt: Float32Array, w: number, h: number, strength: number) {
  const { c, g } = canvas(w, h);
  const img = g.createImageData(w, h);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const l = hgt[y * w + ((x - 1 + w) % w)];
      const r = hgt[y * w + ((x + 1) % w)];
      const u = hgt[((y - 1 + h) % h) * w + x];
      const d = hgt[((y + 1) % h) * w + x];
      const nx = (l - r) * strength;
      const ny = (d - u) * strength;
      const len = Math.hypot(nx, ny, 1);
      const o = (y * w + x) * 4;
      img.data[o] = ((nx / len) * 0.5 + 0.5) * 255;
      img.data[o + 1] = ((ny / len) * 0.5 + 0.5) * 255;
      img.data[o + 2] = ((1 / len) * 0.5 + 0.5) * 255;
      img.data[o + 3] = 255;
    }
  g.putImageData(img, 0, 0);
  return c;
}

// —————————————————————————————————————————— the floor

/**
 * Oak floorboards: planks 12 cm wide with staggered butt joints, each plank its own tone and
 * grain, a fine bevel at every seam, and a satin lacquer that's worn duller in places.
 * One texture covers a 240 × 240 cm patch.
 */
export function floorTextures(aniso: number) {
  const S = 2048;
  // 16 boards across (15 cm each); kept a whole number of pixels so every row is painted
  const PLANK = S / 16;
  const { c, g } = canvas(S, S);
  const rough = canvas(S, S);
  const height = new Float32Array(S * S).fill(1);
  const grainN = noise2(S, S, 64, 7);
  const big = noise2(S, S, 6, 9);
  reseed(42);
  const tones = ["#b98a5a", "#a87a4c", "#c39466", "#9e6f43", "#b3834f", "#c8a070", "#a5774a"];
  const img = g.createImageData(S, S);
  const rimg = rough.g.createImageData(S, S);
  const rows = S / PLANK;
  for (let r = 0; r < rows; r++) {
    // butt joints: each row's boards are a different length
    let x = -Math.floor(rand() * S * 0.5);
    while (x < S) {
      const len = Math.floor(S * (0.32 + rand() * 0.45));
      const base = new THREE.Color(tones[Math.floor(rand() * tones.length)]);
      const shade = 0.9 + rand() * 0.18;
      // flat-sawn oak: a handful of long, gently wandering grain lines per board
      const grainF = 5 + rand() * 7;
      const phase = rand() * 100;
      const knot = rand() < 0.35 ? { x: x + rand() * len, y: r * PLANK + PLANK * (0.25 + rand() * 0.5), r: 4 + rand() * 7 } : null;
      for (let px = Math.max(0, x); px < Math.min(S, x + len); px++)
        for (let py = r * PLANK; py < (r + 1) * PLANK; py++) {
          const i = py * S + px;
          const ly = (py - r * PLANK) / PLANK;
          // flat-sawn grain: long wavy lines that drift across the board
          let w = Math.sin((ly * grainF + grainN[i] * 1.3 + Math.sin(px * 0.0025 + phase) * 0.9) * Math.PI);
          if (knot) {
            const d = Math.hypot(px - knot.x, (py - knot.y) * 2.2);
            w = Math.sin((d / knot.r) * 3 + grainN[i] * 2) * Math.exp(-d / (knot.r * 6)) + w * (1 - Math.exp(-d / (knot.r * 3)));
          }
          const line = Math.pow(Math.abs(w), 10);
          // fine fibres along the board, under the grain lines
          const fibre = Math.sin(py * 2.7 + Math.sin(px * 0.02 + phase) * 3) * 0.5 + 0.5;
          const k = shade * (1 - line * 0.13 - fibre * 0.035) * (0.95 + big[i] * 0.1) * (0.98 + grainN[i] * 0.04);
          const o = i * 4;
          img.data[o] = Math.min(255, base.r * 255 * k);
          img.data[o + 1] = Math.min(255, base.g * 255 * k);
          img.data[o + 2] = Math.min(255, base.b * 255 * k);
          img.data[o + 3] = 255;
          // lacquer: glossy, with the grain lines and worn patches a little rougher
          const rv = 0.32 + line * 0.18 + (1 - big[i]) * 0.16;
          rimg.data[o] = rimg.data[o + 1] = rimg.data[o + 2] = rv * 255;
          rimg.data[o + 3] = 255;
          height[i] = 1 - line * 0.015;
        }
      // the seam at the board's end
      for (let py = r * PLANK; py < (r + 1) * PLANK; py++)
        for (const ex of [x, x + 1, x + len - 1])
          if (ex >= 0 && ex < S) {
            const i = py * S + ex;
            height[i] = 0;
            img.data[i * 4] *= 0.55;
            img.data[i * 4 + 1] *= 0.55;
            img.data[i * 4 + 2] *= 0.55;
          }
      x += len;
    }
    // the long seam between rows
    for (let px = 0; px < S; px++)
      for (const py of [r * PLANK, r * PLANK + 1]) {
        const i = py * S + px;
        height[i] = 0;
        img.data[i * 4] *= 0.5;
        img.data[i * 4 + 1] *= 0.5;
        img.data[i * 4 + 2] *= 0.5;
      }
  }
  g.putImageData(img, 0, 0);
  rough.g.putImageData(rimg, 0, 0);
  const normal = normalFromHeight(height, S, S, 2.2);
  return {
    map: tex(c, { repeat: [1, 1], aniso }),
    roughness: tex(rough.c, { srgb: false, repeat: [1, 1], aniso }),
    normal: tex(normal, { srgb: false, repeat: [1, 1], aniso }),
  };
}

/** A flat-woven cotton rug: a soft cream field, a woven border in the park's colours. */
export function rugTexture(aniso: number) {
  const W = 1024;
  const H = 512;
  const { c, g } = canvas(W, H);
  g.fillStyle = "#e9e0cf";
  g.fillRect(0, 0, W, H);
  const band = (inset: number, width: number, color: string) => {
    g.strokeStyle = color;
    g.lineWidth = width;
    g.strokeRect(inset, inset, W - inset * 2, H - inset * 2);
  };
  band(14, 18, "#1f3c73");
  band(40, 6, "#d8452f");
  band(56, 4, "#e6b23a");
  // a row of diamonds inside the border
  g.fillStyle = "#1f3c73";
  for (let x = 90; x < W - 70; x += 46) {
    for (const y of [78, H - 78]) {
      g.beginPath();
      g.moveTo(x, y - 9);
      g.lineTo(x + 9, y);
      g.lineTo(x, y + 9);
      g.lineTo(x - 9, y);
      g.fill();
    }
  }
  // the weave: fine crossing threads
  const img = g.getImageData(0, 0, W, H);
  reseed(5);
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const o = (y * W + x) * 4;
      const weave = ((x + (y % 2)) % 2 ? 0.93 : 1.04) * (0.96 + rand() * 0.08) * (y % 3 === 0 ? 0.97 : 1);
      img.data[o] *= weave;
      img.data[o + 1] *= weave;
      img.data[o + 2] *= weave;
    }
  g.putImageData(img, 0, 0);
  return tex(c, { aniso });
}

/** The wall behind the park: warm painted plaster above a white skirting board. */
export function wallTexture() {
  const { c, g } = canvas(512, 512);
  const grad = g.createLinearGradient(0, 0, 0, 512);
  grad.addColorStop(0, "#c9c0b3");
  grad.addColorStop(1, "#ddd5c8");
  g.fillStyle = grad;
  g.fillRect(0, 0, 512, 512);
  reseed(3);
  for (let i = 0; i < 6000; i++) {
    g.fillStyle = `rgba(${rand() > 0.5 ? "255,255,255" : "80,70,60"},${0.02 + rand() * 0.03})`;
    g.fillRect(rand() * 512, rand() * 512, 2, 2);
  }
  return tex(c, { repeat: [6, 1] });
}

// —————————————————————————————————————————— plastic and metal

/** Fine metal flake under clear coat, as a normal map (tiled very small). */
export function flakeNormal() {
  const S = 256;
  reseed(77);
  const { c, g } = canvas(S, S);
  const img = g.createImageData(S, S);
  for (let i = 0; i < S * S; i++) {
    // each flake is a tiny tilted mirror
    const a = rand() * Math.PI * 2;
    const t = Math.pow(rand(), 2) * 0.55;
    img.data[i * 4] = (Math.cos(a) * t * 0.5 + 0.5) * 255;
    img.data[i * 4 + 1] = (Math.sin(a) * t * 0.5 + 0.5) * 255;
    img.data[i * 4 + 2] = 255;
    img.data[i * 4 + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  return tex(c, { srgb: false, repeat: [9, 3] });
}

/**
 * The track's surface: moulded orange plastic. One repeat is one 30 cm piece: a faint joint seam
 * at each end, a fine stipple from the mould, and the slightly glossier wall tops.
 */
export function trackTextures() {
  const W = 512;
  const H = 128;
  const { c, g } = canvas(W, H);
  g.fillStyle = "#ffffff";
  g.fillRect(0, 0, W, H);
  reseed(11);
  for (let i = 0; i < 9000; i++) {
    g.fillStyle = `rgba(${rand() > 0.5 ? "255,240,220" : "120,50,0"},${0.02 + rand() * 0.035})`;
    g.fillRect(rand() * W, rand() * H, 1.5, 1.5);
  }
  // the joint: two thin grooves either side of a tight seam
  for (const x of [0, 1, W - 2, W - 1]) {
    g.fillStyle = "rgba(90,30,0,0.55)";
    g.fillRect(x, 0, 1, H);
  }
  g.fillStyle = "rgba(90,30,0,0.18)";
  g.fillRect(5, 0, 1, H);
  g.fillRect(W - 6, 0, 1, H);
  // faint moulded ribs across the bed every couple of centimetres (they show at grazing light)
  const r = canvas(W, H);
  r.g.fillStyle = "rgb(120,120,120)";
  r.g.fillRect(0, 0, W, H);
  for (let x = 0; x < W; x += W / 15) {
    r.g.fillStyle = "rgb(150,150,150)";
    r.g.fillRect(x, 0, 2, H);
  }
  for (let i = 0; i < 5000; i++) {
    r.g.fillStyle = `rgba(${rand() > 0.5 ? "170,170,170" : "95,95,95"},0.25)`;
    r.g.fillRect(rand() * W, rand() * H, 2, 2);
  }
  const t = tex(c, { aniso: 8 });
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  const rt = tex(r.c, { srgb: false, aniso: 8 });
  rt.wrapS = rt.wrapT = THREE.RepeatWrapping;
  return { map: t, roughness: rt };
}

// —————————————————————————————————————————— liveries

export type Livery = {
  base: string;
  stripes?: { color: string; width: number; gap: number; edge?: string };
  flames?: { from: string; to: string; edge: string };
  side?: { color: string; from: number; to: number };
  number?: { n: string; at: number; ring: string; ink: string };
  logo?: { text: string; at: number; color: string };
};

/**
 * A car body's paint and graphics, laid out on the body's UVs: u runs nose-to-tail along the car
 * (0 = rear, 1 = front), v round the cross-section (0 bottom, .25 left flank, .5 top, .75 right).
 * Side graphics are mirrored on the left so they read correctly from outside.
 */
export function liveryTexture(l: Livery, aniso: number) {
  const W = 1024;
  const H = 512;
  const { c, g } = canvas(W, H);
  const vy = (v: number) => (1 - v) * H;
  g.fillStyle = l.base;
  g.fillRect(0, 0, W, H);

  // a flank in the car's own terms: x along the car (rear → front, as u), y from the bottom of the
  // side (0) to its top (100). Shapes drawn here sit the same way on both sides.
  const K = 0.0046;
  const shape = (left: boolean, draw: () => void) => {
    g.save();
    g.translate(0, (left ? 0.98 : 0.02) * H);
    g.scale(1, (left ? -K : K) * H);
    draw();
    g.restore();
  };
  const both = (draw: () => void) => {
    shape(true, draw);
    shape(false, draw);
  };
  // lettering centred at (u, y) on a flank, upright and reading the right way round from outside
  // (canvas pixels across the car are about half the size of pixels round it, hence the squash)
  const label = (u: number, y: number, draw: () => void) => {
    for (const left of [true, false]) {
      g.save();
      g.translate(u * W, (left ? 0.98 - K * y : 0.02 + K * y) * H);
      g.scale(left ? -1 : 1, left ? 0.44 : -0.44);
      draw();
      g.restore();
    }
  };

  if (l.side) {
    const s = l.side;
    both(() => {
      g.fillStyle = s.color;
      g.fillRect(0, s.from, W, s.to - s.from);
    });
  }
  if (l.flames) {
    const fl = l.flames;
    both(() => {
      // tongues of flame licking back from the nose
      const grad = g.createLinearGradient(W, 0, W * 0.3, 0);
      grad.addColorStop(0, fl.from);
      grad.addColorStop(1, fl.to);
      g.fillStyle = grad;
      g.strokeStyle = fl.edge;
      g.lineWidth = 5;
      g.beginPath();
      g.moveTo(W, 78);
      const tongues: [number, number][] = [
        [0.7, 74],
        [0.6, 56],
        [0.46, 70],
        [0.36, 48],
        [0.3, 60],
      ];
      let y = 76;
      for (const [x, ty] of tongues) {
        g.bezierCurveTo(W * (x + 0.12), y + 2, W * (x + 0.03), ty + 6, W * x, ty);
        y -= 7;
        g.bezierCurveTo(W * (x + 0.05), ty - 2, W * (x + 0.07), y + 4, W * (x + 0.1), y);
      }
      g.lineTo(W * 0.42, 26);
      g.bezierCurveTo(W * 0.6, 22, W * 0.8, 24, W, 22);
      g.closePath();
      g.fill();
      g.stroke();
    });
  }
  if (l.stripes) {
    const s = l.stripes;
    // twin stripes over the top, nose to tail
    for (const sgn of [-1, 1]) {
      const v0 = 0.5 + sgn * (s.gap / 2);
      const v1 = 0.5 + sgn * (s.gap / 2 + s.width);
      if (s.edge) {
        g.fillStyle = s.edge;
        g.fillRect(0, Math.min(vy(v0), vy(v1)) - 4, W, Math.abs(vy(v1) - vy(v0)) + 8);
      }
      g.fillStyle = s.color;
      g.fillRect(0, Math.min(vy(v0), vy(v1)), W, Math.abs(vy(v1) - vy(v0)));
    }
  }
  if (l.number) {
    const n = l.number;
    label(n.at, 52, () => {
      g.fillStyle = n.ring;
      g.beginPath();
      g.arc(0, 0, 62, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = n.ink;
      g.font = "900 84px system-ui, sans-serif";
      g.textAlign = "center";
      g.textBaseline = "middle";
      g.fillText(n.n, 0, 5);
    });
  }
  if (l.logo) {
    const lg = l.logo;
    label(lg.at, 34, () => {
      g.font = "italic 900 64px system-ui, sans-serif";
      g.fillStyle = lg.color;
      g.textAlign = "center";
      g.textBaseline = "middle";
      g.fillText(lg.text, 0, 0);
    });
  }
  return tex(c, { aniso });
}

/** The greenhouse: tinted glass, with the roof and pillars in the body colour. */
export function cabinTexture(paint: string, frame: { ws: number; rs: number; b: number }, aniso: number) {
  const W = 512;
  const H = 256;
  const { c, g } = canvas(W, H);
  g.fillStyle = "#0d1218";
  g.fillRect(0, 0, W, H);
  // reflections baked faintly into the tint
  const grad = g.createLinearGradient(0, 0, W, H);
  grad.addColorStop(0, "rgba(120,150,180,0.12)");
  grad.addColorStop(0.5, "rgba(20,30,40,0)");
  grad.addColorStop(1, "rgba(120,150,180,0.08)");
  g.fillStyle = grad;
  g.fillRect(0, 0, W, H);
  g.fillStyle = paint;
  const vy = (v: number) => (1 - v) * H;
  // roof panel, between the windscreen and the rear screen
  g.fillRect(W * frame.rs, vy(0.66), W * (1 - frame.ws - frame.rs), vy(0.34) - vy(0.66));
  // the door frames along the bottom of the side glass
  g.fillRect(0, vy(0.06), W, vy(0) - vy(0.06));
  g.fillRect(0, vy(1), W, vy(0.94) - vy(1));
  // A, B and C pillars on each side
  for (const [v0, v1] of [
    [0.06, 0.36],
    [0.64, 0.94],
  ]) {
    g.fillRect(W * (1 - frame.ws) - 10, vy(v1), 22, vy(v0) - vy(v1));
    g.fillRect(W * frame.b - 9, vy(v1), 18, vy(v0) - vy(v1));
    g.fillRect(W * frame.rs - 12, vy(v1), 24, vy(v0) - vy(v1));
  }
  return tex(c, { aniso });
}

// —————————————————————————————————————————— signs and print

/** Bold sign lettering on a coloured panel with a white keyline. */
export function signTexture(text: string, sub: string | undefined, color: string, w: number, h: number) {
  const W = 1024;
  const H = Math.round((W * h) / w);
  const { c, g } = canvas(W, H);
  g.fillStyle = color;
  g.fillRect(0, 0, W, H);
  // a diagonal sheen stripe and a checker band along the bottom
  g.fillStyle = "rgba(255,255,255,0.08)";
  g.beginPath();
  g.moveTo(W * 0.15, 0);
  g.lineTo(W * 0.35, 0);
  g.lineTo(W * 0.2, H);
  g.lineTo(0, H);
  g.fill();
  g.strokeStyle = "#ffffff";
  g.lineWidth = H * 0.04;
  g.strokeRect(H * 0.05, H * 0.05, W - H * 0.1, H - H * 0.1);
  const sq = H * 0.09;
  for (let x = 0; x < W; x += sq) for (let r = 0; r < 2; r++) {
    g.fillStyle = ((x / sq + r) | 0) % 2 ? "#111" : "#fff";
    g.fillRect(x, H - H * 0.12 - sq * (r + 1) + sq, sq, sq);
  }
  g.fillStyle = "#ffffff";
  g.textAlign = "center";
  g.textBaseline = "middle";
  let size = H * (sub ? 0.36 : 0.5);
  g.font = `italic 900 ${size}px system-ui, sans-serif`;
  while (g.measureText(text).width > W * 0.86) {
    size *= 0.94;
    g.font = `italic 900 ${size}px system-ui, sans-serif`;
  }
  g.shadowColor = "rgba(0,0,0,0.35)";
  g.shadowOffsetY = size * 0.06;
  g.fillText(text, W / 2, H * (sub ? 0.4 : 0.47));
  if (sub) {
    g.shadowColor = "transparent";
    g.font = `800 ${H * 0.12}px system-ui, sans-serif`;
    g.fillStyle = "#ffe6a6";
    g.fillText(sub, W / 2, H * 0.66);
  }
  return tex(c);
}

/** A finish banner: checkers and a name. */
export function finishTexture(label: string) {
  const W = 1024;
  const H = 160;
  const { c, g } = canvas(W, H);
  const sq = H / 4;
  for (let x = 0; x < W / sq; x++)
    for (let y = 0; y < 4; y++) {
      g.fillStyle = (x + y) % 2 ? "#111" : "#f4f4f4";
      g.fillRect(x * sq, y * sq, sq, sq);
    }
  g.fillStyle = "#ffffff";
  g.fillRect(W * 0.2, H * 0.12, W * 0.6, H * 0.76);
  g.fillStyle = "#e3261c";
  g.font = `italic 900 ${H * 0.44}px system-ui, sans-serif`;
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.fillText(`${label} · FINISH`, W / 2, H / 2 + 2);
  return tex(c);
}

/** Short labels for moulded parts (launchers, boosters, towers). */
export function labelTexture(text: string, bg: string, ink: string, w = 256, h = 96) {
  const { c, g } = canvas(w, h);
  g.fillStyle = bg;
  g.fillRect(0, 0, w, h);
  g.fillStyle = ink;
  let size = h * 0.62;
  g.font = `italic 900 ${size}px system-ui, sans-serif`;
  while (g.measureText(text).width > w * 0.88) {
    size *= 0.92;
    g.font = `italic 900 ${size}px system-ui, sans-serif`;
  }
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.fillText(text, w / 2, h / 2 + 2);
  return tex(c);
}

/** Sixteen letters for the alphabet blocks, 4 × 4, each embossed on a light panel. */
export function blockAtlas() {
  const S = 1024;
  const cell = S / 4;
  const { c, g } = canvas(S, S);
  const letters = "ABCDEFGHJKMPRSTW";
  const inks = ["#c62f25", "#2457b8", "#2a8a49", "#d8a21c"];
  for (let i = 0; i < 16; i++) {
    const x = (i % 4) * cell;
    const y = Math.floor(i / 4) * cell;
    // natural wood border, painted panel inside (multiplied by the block's colour)
    g.fillStyle = "#f3e4c8";
    g.fillRect(x, y, cell, cell);
    g.fillStyle = "#ffffff";
    g.fillRect(x + cell * 0.12, y + cell * 0.12, cell * 0.76, cell * 0.76);
    g.fillStyle = inks[i % inks.length];
    g.font = `900 ${cell * 0.62}px Georgia, serif`;
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.fillText(letters[i], x + cell / 2, y + cell / 2 + cell * 0.04);
  }
  return tex(c);
}

// —————————————————————————————————————————— the Stunt Yard

type YardLayout = { x: number; z: number; w: number; d: number; road: { x0: number; x1: number; z0: number; z1: number; r: number; w: number } };

/**
 * A kids' road play-mat, printed: grass, a grey road loop with edge lines and a dashed centre,
 * a chequered start line, arrows, and a little town in and around it (houses, trees, a pond, a
 * car park). The mat's far edge is the canvas's top.
 */
export function matTexture(yard: YardLayout, aniso: number) {
  const W = 2048;
  const H = Math.round((W * yard.d) / yard.w);
  const { c, g } = canvas(W, H);
  const k = W / yard.w;
  const X = (x: number) => (x - (yard.x - yard.w / 2)) * k;
  const Z = (z: number) => (z - (yard.z - yard.d / 2)) * k;
  reseed(64);
  // felt-like grass, lighter and darker patches
  g.fillStyle = "#6cbf4c";
  g.fillRect(0, 0, W, H);
  for (let i = 0; i < 2600; i++) {
    g.fillStyle = rand() < 0.5 ? "rgba(255,255,255,0.05)" : "rgba(0,60,0,0.06)";
    g.beginPath();
    g.arc(rand() * W, rand() * H, 2 + rand() * 9, 0, Math.PI * 2);
    g.fill();
  }
  // the stitched border
  g.strokeStyle = "#2f5fb3";
  g.lineWidth = 16;
  g.strokeRect(8, 8, W - 16, H - 16);
  g.setLineDash([10, 10]);
  g.strokeStyle = "#f4f1e8";
  g.lineWidth = 3;
  g.strokeRect(22, 22, W - 44, H - 44);
  g.setLineDash([]);

  const { x0, x1, z0, z1, r, w } = yard.road;
  const loop = (o = 0) => {
    g.beginPath();
    g.roundRect(X(x0 - o), Z(z0 - o), (x1 - x0 + 2 * o) * k, (z1 - z0 + 2 * o) * k, Math.max(4, (r + o) * k));
  };
  // the road, its edge lines, its dashed centre
  loop();
  g.strokeStyle = "#45484f";
  g.lineWidth = w * k;
  g.stroke();
  for (const off of [-1, 1]) {
    loop(off * (w / 2 - 1.6));
    g.strokeStyle = "#f2f2f0";
    g.lineWidth = 1.1 * k;
    g.stroke();
  }
  loop();
  g.setLineDash([5 * k, 4 * k]);
  g.strokeStyle = "#f5c518";
  g.lineWidth = 0.9 * k;
  g.stroke();
  g.setLineDash([]);
  // a chequered start/finish across the near straight, at x = 0
  const cell = (w / 6) * k;
  for (let i = 0; i < 6; i++)
    for (let j = 0; j < 2; j++) {
      g.fillStyle = (i + j) % 2 ? "#111" : "#fff";
      g.fillRect(X(0) - cell + j * cell, Z(z1 - w / 2) + i * cell, cell, cell);
    }
  // direction arrows on each straight
  const arrow = (x: number, z: number, ang: number) => {
    g.save();
    g.translate(X(x), Z(z));
    g.rotate(ang);
    g.fillStyle = "rgba(255,255,255,0.75)";
    g.beginPath();
    g.moveTo(10 * k, 0);
    g.lineTo(0, -5 * k);
    g.lineTo(0, -2 * k);
    g.lineTo(-10 * k, -2 * k);
    g.lineTo(-10 * k, 2 * k);
    g.lineTo(0, 2 * k);
    g.lineTo(0, 5 * k);
    g.closePath();
    g.fill();
    g.restore();
  };
  arrow(-140, z1, 0);
  arrow(60, z1, 0);
  arrow(x1, (z0 + z1) / 2 + 20, -Math.PI / 2);
  arrow(20, z0, Math.PI);
  arrow(x0, (z0 + z1) / 2 - 20, Math.PI / 2);
  // a zebra crossing on the right-hand side
  for (let i = 0; i < 6; i++) {
    g.fillStyle = "#f2f2f0";
    g.fillRect(X(x1 - w / 2 + 3), Z(z0 + 70) + i * 2.4 * k, (w - 6) * k, 1.3 * k);
  }

  // the town: houses with ridged roofs, trees, a pond, a car park
  const house = (x: number, z: number, wd: number, dp: number, roof: string) => {
    g.fillStyle = "rgba(0,0,0,0.18)";
    g.fillRect(X(x) + 4, Z(z) + 5, wd * k, dp * k);
    g.fillStyle = roof;
    g.fillRect(X(x), Z(z), wd * k, dp * k);
    g.fillStyle = "rgba(0,0,0,0.22)";
    g.fillRect(X(x), Z(z) + (dp * k) / 2 - 2, wd * k, 4);
    g.fillStyle = "rgba(255,255,255,0.18)";
    g.fillRect(X(x), Z(z), wd * k, (dp * k) / 2 - 2);
  };
  const tree = (x: number, z: number, s: number) => {
    g.fillStyle = "rgba(0,0,0,0.18)";
    g.beginPath();
    g.arc(X(x) + 4, Z(z) + 5, s * k, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = rand() < 0.5 ? "#2f8f3a" : "#3ea347";
    g.beginPath();
    g.arc(X(x), Z(z), s * k, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = "rgba(255,255,255,0.18)";
    g.beginPath();
    g.arc(X(x) - s * k * 0.3, Z(z) - s * k * 0.3, s * k * 0.45, 0, Math.PI * 2);
    g.fill();
  };
  const roofs = ["#c0392b", "#d35400", "#8e44ad", "#2c3e50", "#16a085", "#b9770e"];
  for (let i = 0; i < 9; i++) house(-240 + i * 46, 140, 30, 14, roofs[i % roofs.length]);
  for (let i = 0; i < 4; i++) house(-250 + i * 40, 336, 28, 11, roofs[(i + 2) % roofs.length]);
  for (let i = 0; i < 4; i++) house(110 + i * 38, 336, 26, 11, roofs[(i + 4) % roofs.length]);
  // the pond, inside the loop
  g.fillStyle = "#3d8fd6";
  g.beginPath();
  g.ellipse(X(40), Z(212), 26 * k, 9 * k, 0, 0, Math.PI * 2);
  g.fill();
  g.strokeStyle = "rgba(255,255,255,0.5)";
  g.lineWidth = 3;
  g.stroke();
  // a car park with bays and a P
  g.fillStyle = "#5a5d63";
  g.fillRect(X(130), Z(266), 46 * k, 22 * k);
  g.strokeStyle = "#f2f2f0";
  g.lineWidth = 2;
  for (let i = 1; i < 6; i++) {
    g.beginPath();
    g.moveTo(X(130 + i * 7.6), Z(266));
    g.lineTo(X(130 + i * 7.6), Z(274));
    g.stroke();
  }
  g.fillStyle = "#2f5fb3";
  g.fillRect(X(168), Z(276), 7 * k, 8 * k);
  g.fillStyle = "#fff";
  g.font = `900 ${6.5 * k}px system-ui, sans-serif`;
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.fillText("P", X(171.5), Z(280.3));
  for (let i = 0; i < 26; i++) {
    const x = rand() < 0.5 ? -258 + rand() * 36 : 222 + rand() * 36;
    tree(x, 160 + rand() * 170, 3 + rand() * 3);
  }
  for (let i = 0; i < 8; i++) tree(-60 + rand() * 100, 270 + rand() * 16, 2.5 + rand() * 2);
  // the town's name, painted on the grass
  g.fillStyle = "rgba(255,255,255,0.55)";
  g.font = `italic 900 ${11 * k}px system-ui, sans-serif`;
  g.fillText("TOY TOWN", X(-90), Z(205));
  return tex(c, { aniso });
}

/** A hardcover's cover: its colour, a border, a gold title. */
export function coverTexture(color: string, title: string) {
  const { c, g } = canvas(512, 384);
  g.fillStyle = color;
  g.fillRect(0, 0, 512, 384);
  g.strokeStyle = "rgba(255,215,120,0.8)";
  g.lineWidth = 6;
  g.strokeRect(26, 26, 460, 332);
  g.fillStyle = "rgba(255,220,140,0.95)";
  g.font = "italic 700 46px Georgia, serif";
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.fillText(title, 256, 192);
  return tex(c);
}

/** A book's page edges: cream with fine lines. */
export function pagesTexture() {
  const { c, g } = canvas(256, 64);
  g.fillStyle = "#f3ead6";
  g.fillRect(0, 0, 256, 64);
  for (let y = 2; y < 64; y += 3) {
    g.fillStyle = `rgba(120,100,70,${0.08 + (y % 7) * 0.01})`;
    g.fillRect(0, y, 256, 1);
  }
  return tex(c);
}

/** Corrugated brown cardboard, with a printed label if given. */
export function cardboardTexture(label?: string) {
  const { c, g } = canvas(512, 256);
  g.fillStyle = "#b98b5a";
  g.fillRect(0, 0, 512, 256);
  for (let x = 0; x < 512; x += 10) {
    g.fillStyle = "rgba(90,60,30,0.12)";
    g.fillRect(x, 0, 4, 256);
  }
  reseed(9);
  for (let i = 0; i < 300; i++) {
    g.fillStyle = "rgba(60,40,20,0.06)";
    g.fillRect(rand() * 512, rand() * 256, 2, 2);
  }
  if (label) {
    g.fillStyle = "rgba(30,30,30,0.75)";
    g.font = "900 64px system-ui, sans-serif";
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.fillText(label, 256, 120);
    g.font = "700 22px system-ui, sans-serif";
    g.fillText("THIS WAY UP  ↑  FRAGILE", 256, 186);
  }
  return tex(c);
}

/** Yellow-and-black chevrons, for the top of a kicker ramp. */
export function chevronTexture() {
  const { c, g } = canvas(256, 256);
  g.fillStyle = "#ffd21f";
  g.fillRect(0, 0, 256, 256);
  g.fillStyle = "#151515";
  for (let i = -2; i < 6; i++) {
    g.beginPath();
    g.moveTo(0, i * 64);
    g.lineTo(128, i * 64 + 48);
    g.lineTo(256, i * 64);
    g.lineTo(256, i * 64 + 26);
    g.lineTo(128, i * 64 + 74);
    g.lineTo(0, i * 64 + 26);
    g.closePath();
    g.fill();
  }
  return tex(c);
}

/** A checkpoint arch's banner: its number, or START · FINISH on a chequer. */
export function archTexture(i: number, of: number) {
  const { c, g } = canvas(512, 96);
  if (i === 0) {
    for (let x = 0; x < 16; x++)
      for (let y = 0; y < 3; y++) {
        g.fillStyle = (x + y) % 2 ? "#111" : "#fff";
        g.fillRect(x * 32, y * 32, 32, 32);
      }
    g.fillStyle = "rgba(255,59,48,0.92)";
    g.fillRect(96, 14, 320, 68);
    g.fillStyle = "#fff";
    g.font = "italic 900 44px system-ui, sans-serif";
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.fillText("START · FINISH", 256, 50);
  } else {
    g.fillStyle = "#ff7a00";
    g.fillRect(0, 0, 512, 96);
    g.fillStyle = "#111";
    g.font = "italic 900 50px system-ui, sans-serif";
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.fillText(`CHECKPOINT ${i} / ${of - 1}`, 256, 50);
  }
  return tex(c);
}

/** A skittle's paint: white with two red bands at the neck (v runs up the pin). */
export function pinTexture() {
  const { c, g } = canvas(16, 256);
  g.fillStyle = "#f6f3ec";
  g.fillRect(0, 0, 16, 256);
  g.fillStyle = "#d62828";
  g.fillRect(0, 70, 16, 12);
  g.fillRect(0, 92, 16, 12);
  return tex(c);
}
