/**
 * The handshake hero: a human hand (ink glyphs, paper side) and a machine hand (binary, night side)
 * reach for each other. `target` (0–1, from scroll) drives the scene:
 *   0–.32 rise · .22–.5 contact · ~.5 spark · .5–.92 a glyph shockwave turns the screen to night
 *   and the </> mark assembles where the fingertips met.
 * The pointer is a lens: glyphs under it scatter, swell and scramble.
 * Everything is drawn from vector shapes at runtime (no images), shaded with a distance field.
 */

/**
 * A reaching hand in a 300 × 170 box, pointing right, drawn for this site as parts so the
 * shading can crease where fingers meet the palm. Lines are tapered strokes (start → end width).
 */
type Part = { d: string } | { pts: [number, number][]; w: [number, number] };
const PARTS: Part[] = [
  // forearm and the back of the hand
  { d: "M-40 104 C0 96 52 86 100 78 L114 124 C66 130 14 138 -40 146 Z" },
  { d: "M94 76 C116 62 152 60 172 70 C186 80 186 108 172 118 C150 128 118 126 104 120 C92 108 88 88 94 76 Z" },
  // pinky, ring, middle — relaxed, curling down — then the index reaching, then the thumb on top
  { pts: [[156, 114], [175, 125], [186, 139], [189, 153]], w: [17, 11] },
  { pts: [[163, 103], [190, 113], [209, 128], [217, 145]], w: [20, 13] },
  { pts: [[166, 91], [198, 97], [227, 110], [245, 126]], w: [21, 14] },
  { pts: [[164, 78], [200, 77], [236, 81], [271, 90]], w: [21, 14] },
  { pts: [[116, 74], [139, 60], [162, 55], [184, 60]], w: [24, 15] },
];
const BOX = { w: 300, h: 170 };
const TIP = { x: 276, y: 91 };
const PIVOT = { x: 104, y: 100 };
/** The site mark, as strokes in a 100 × 100 box: front chevron, slash, back chevron. */
const MARK = ["M38 20 12 50l26 30", "M58 14 42 86", "M62 20l26 30-26 30"];

const GLYPHS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
const LIVE = "0123456789ABCDEF";
const HUMAN_RAMP = GLYPHS;
const WAVE = "01<>/{}[]=+*#ABCDEF";
const EMBLEM = "<>/{}01";

type RGB = [number, number, number];
const VIOLET: RGB = [255, 59, 18];
const LAVENDER: RGB = [255, 170, 140];
const CYAN: RGB = [255, 138, 99];
const WHITE: RGB = [241, 238, 230];
/** shade 0 → 1 */
const PAPER_STOPS: RGB[] = [[203, 200, 192], [150, 145, 137], [92, 88, 82], [17, 16, 15]];
const NIGHT_STOPS: RGB[] = [[48, 45, 41], [102, 98, 91], [170, 167, 159], [223, 220, 211], [255, 252, 245]];
const ramp = (stops: RGB[], t: number) => {
  const x = clamp(t) * (stops.length - 1);
  const i = Math.min(stops.length - 2, Math.floor(x));
  return mix(stops[i], stops[i + 1], x - i);
};

const clamp = (v: number) => Math.max(0, Math.min(1, v));
const range = (v: number, a: number, b: number) => clamp((v - a) / (b - a));
const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);
const mix = (a: RGB, b: RGB, t: number) => `rgb(${Math.round(a[0] + (b[0] - a[0]) * t)},${Math.round(a[1] + (b[1] - a[1]) * t)},${Math.round(a[2] + (b[2] - a[2]) * t)})`;
function seeded(seed: number) {
  let s = seed;
  return () => (s = (s * 16807) % 2147483647) / 2147483647;
}

type Cell = { x: number; y: number; ch: string; col: string; live: boolean; seed: number };
type Hand = { cells: Cell[]; w: number; h: number; tipX: number; tipY: number; pivotX: number; pivotY: number };
type Glyph = { dx: number; dy: number; col: string; seed: number };

/** Chamfer distance from each inside cell to the nearest outside one. */
function distance(mask: Uint8Array, cols: number, rows: number) {
  const BIG = 1e6;
  const d = new Float32Array(cols * rows);
  for (let i = 0; i < d.length; i++) d[i] = mask[i] ? BIG : 0;
  // past the left edge counts as inside, so the forearm keeps its volume as it leaves the screen
  const at = (x: number, y: number) => (x < 0 ? BIG : y < 0 || x >= cols || y >= rows ? 0 : d[y * cols + x]);
  for (let y = 0; y < rows; y++)
    for (let x = 0; x < cols; x++) {
      const i = y * cols + x;
      if (mask[i]) d[i] = Math.min(d[i], at(x - 1, y) + 1, at(x, y - 1) + 1, at(x - 1, y - 1) + 1.4, at(x + 1, y - 1) + 1.4);
    }
  for (let y = rows - 1; y >= 0; y--)
    for (let x = cols - 1; x >= 0; x--) {
      const i = y * cols + x;
      if (mask[i]) d[i] = Math.min(d[i], at(x + 1, y) + 1, at(x, y + 1) + 1, at(x + 1, y + 1) + 1.4, at(x - 1, y + 1) + 1.4);
    }
  return d;
}

/**
 * Rasterise the hand part by part. Each cell belongs to the topmost part covering it and is shaded by its
 * depth inside that part, so creases fall dark where a finger meets the palm. Light comes from the upper left.
 */
function buildHand(cell: number, rowH: number, w: number, h: number, machine: boolean): Hand {
  const cols = Math.max(24, Math.round(w / cell));
  const rows = Math.max(12, Math.round(h / rowH));
  const c = document.createElement("canvas");
  c.width = cols;
  c.height = rows;
  const g = c.getContext("2d", { willReadFrequently: true })!;
  const owner = new Int8Array(cols * rows).fill(-1);
  const depth = new Float32Array(cols * rows);
  const nx = new Float32Array(cols * rows);
  const ny = new Float32Array(cols * rows);
  // rows are taller than columns, so stroke widths are scaled on the column axis
  const sx = cols / BOX.w;
  const sy = rows / BOX.h;
  PARTS.forEach((part, k) => {
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, cols, rows);
    g.setTransform(sx, 0, 0, sy, 0, 0);
    g.fillStyle = g.strokeStyle = "#000";
    if ("d" in part) g.fill(new Path2D(part.d));
    else {
      g.lineCap = "round";
      g.lineJoin = "round";
      for (let i = 0; i < part.pts.length - 1; i++) {
        g.lineWidth = part.w[0] + ((part.w[1] - part.w[0]) * i) / (part.pts.length - 2 || 1);
        g.beginPath();
        g.moveTo(...part.pts[i]);
        g.lineTo(...part.pts[i + 1]);
        g.stroke();
      }
    }
    const px = g.getImageData(0, 0, cols, rows).data;
    const mask = new Uint8Array(cols * rows);
    for (let i = 0; i < mask.length; i++) mask[i] = px[i * 4 + 3] > 110 ? 1 : 0;
    const d = distance(mask, cols, rows);
    let max = 1;
    for (let i = 0; i < d.length; i++) if (mask[i] && d[i] < 1e5) max = Math.max(max, d[i]);
    const D = (x: number, y: number) => (x < 0 || y < 0 || x >= cols || y >= rows ? 0 : Math.min(d[y * cols + x], max));
    for (let y = 0; y < rows; y++)
      for (let x = 0; x < cols; x++) {
        const i = y * cols + x;
        if (!mask[i]) continue;
        owner[i] = k;
        depth[i] = Math.min(1, D(x, y) / max);
        nx[i] = D(x - 1, y) - D(x + 1, y);
        ny[i] = D(x, y - 1) - D(x, y + 1);
      }
  });

  const rnd = seeded(machine ? 97 : 41);
  const cells: Cell[] = [];
  const L = [-0.55, -0.83];
  for (let y = 0; y < rows; y++)
    for (let x = 0; x < cols; x++) {
      const i = y * cols + x;
      if (owner[i] < 0) continue;
      // the machine hand is jointed: hairline gaps across the index finger and the wrist
      const bx = ((x + 0.5) / cols) * BOX.w;
      const by = ((y + 0.5) / rows) * BOX.h;
      if (machine && (((Math.abs(bx - 206) < 2.6 || Math.abs(bx - 240) < 2.6) && by > 74 && by < 104) || Math.abs(bx - 108) < 2.2)) continue;
      const len = Math.hypot(nx[i], ny[i]) || 1;
      const lambert = Math.max(0, (nx[i] / len) * L[0] + (ny[i] / len) * L[1]);
      const dd = depth[i];
      // rounded volume: dark at the rim, lit on the upper-left faces, a soft core
      let shade = 0.18 + 0.5 * Math.pow(dd, 0.7) + 0.42 * lambert * (1 - dd * 0.6) + (rnd() - 0.5) * 0.16;
      if (dd < 0.18) shade *= 0.55 + dd * 2.5;
      shade = clamp(shade);
      // the deepest shadow drops out, so the hand reads as printed texture rather than a solid block
      if (shade < 0.16 || (shade < 0.3 && rnd() < 0.45)) continue;
      cells.push({
        x: (machine ? cols - 1 - x : x) * cell + cell / 2,
        y: y * rowH + rowH / 2,
        ch: GLYPHS[(rnd() * GLYPHS.length) | 0],
        col: ramp(machine ? NIGHT_STOPS : PAPER_STOPS, shade),
        live: rnd() < (machine ? 0.18 : 0.08),
        seed: (rnd() * 1000) | 0,
      });
    }
  const fx = (v: number) => (machine ? BOX.w - v : v) / BOX.w;
  return {
    cells,
    w: cols * cell,
    h: rows * rowH,
    tipX: fx(TIP.x) * cols * cell,
    tipY: (TIP.y / BOX.h) * rows * rowH,
    pivotX: fx(PIVOT.x) * cols * cell,
    pivotY: (PIVOT.y / BOX.h) * rows * rowH,
  };
}

/** Rasterise the mark into glyph cells: front in violet, slash in white, back in cyan. */
function buildEmblem(size: number, cell: number): Glyph[] {
  const n = Math.max(18, Math.round(size / cell));
  const c = document.createElement("canvas");
  c.width = c.height = n;
  const g = c.getContext("2d")!;
  g.scale(n / 100, n / 100);
  g.lineWidth = 12;
  g.lineCap = "square";
  ["#f00", "#0f0", "#00f"].forEach((col, i) => {
    g.strokeStyle = col;
    g.stroke(new Path2D(MARK[i]));
  });
  const px = g.getImageData(0, 0, n, n).data;
  const rnd = seeded(23);
  const out: Glyph[] = [];
  for (let y = 0; y < n; y++)
    for (let x = 0; x < n; x++) {
      const i = (y * n + x) * 4;
      if (px[i + 3] < 120) continue;
      const which = px[i] > px[i + 1] && px[i] > px[i + 2] ? 0 : px[i + 1] > px[i + 2] ? 1 : 2;
      const col = which === 0 ? mix(VIOLET, LAVENDER, rnd() * 0.6) : which === 1 ? mix(WHITE, LAVENDER, rnd() * 0.2) : mix(CYAN, WHITE, rnd() * 0.3);
      out.push({ dx: (x + 0.5 - n / 2) * (size / n), dy: (y + 0.5 - n / 2) * (size / n), col, seed: (rnd() * 1000) | 0 });
    }
  return out;
}

export type Handshake = {
  /** scroll progress, 0–1; the scene eases toward it */
  target: number;
  /** 0 = hands offstage, 1 = in place (the intro tweens this) */
  enter: number;
  destroy(): void;
};

export function createHandshake(
  canvas: HTMLCanvasElement,
  { reduce = false, onTone }: { reduce?: boolean; onTone?: (left: "paper" | "night") => void } = {},
): Handshake {
  const ctx = canvas.getContext("2d")!;
  const state: Handshake = { target: 0, enter: reduce ? 1 : 0, destroy };
  let W = 0;
  let H = 0;
  let dpr = 1;
  let cell = 11;
  let rowH = 14;
  let human: Hand | null = null;
  let machine: Hand | null = null;
  let emblem: Glyph[] = [];
  let emblemCell = 14;
  let dust: { x: number; y: number; seed: number; a: number }[] = [];
  let p = reduce ? 0.5 : 0;
  let raf = 0;
  let visible = true;
  let tone: "paper" | "night" = "paper";
  const lens = { x: 0, y: 0, tx: 0, ty: 0, on: 0, want: 0 };
  const family = getComputedStyle(canvas).getPropertyValue("--mono").trim() || "ui-monospace, monospace";

  function build() {
    const r = canvas.getBoundingClientRect();
    W = Math.max(1, r.width);
    H = Math.max(1, r.height);
    dpr = Math.min(devicePixelRatio || 1, 2);
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    const portrait = H > W;
    cell = W >= 1200 ? 10 : W >= 700 ? 9 : 7;
    rowH = cell * 1.38;
    const hw = portrait ? W * 0.72 : Math.min(W * 0.56, 1040);
    const hh = (hw * BOX.h) / BOX.w;
    dust = Array.from({ length: Math.round((W * H) / 5200) }, (_, i) => ({
      x: Math.round(Math.random() * (W / cell)) * cell + cell / 2,
      y: Math.round(Math.random() * (H / rowH)) * rowH + rowH / 2,
      seed: i * 37,
      a: 0.08 + Math.random() * 0.22,
    }));
    human = buildHand(cell, rowH, hw, hh, false);
    machine = buildHand(cell, rowH, hw, hh, true);
    const es = Math.min(H * 0.4, W * (portrait ? 0.62 : 0.3));
    emblemCell = Math.max(9, cell * 1.5);
    emblem = buildEmblem(es, emblemCell);
    if (reduce) draw(performance.now() / 1000);
  }

  /** Where a point of the hand (in its 300 × 170 drawing box) lands on screen, once placed and rotated. */
  function pointOf(hand: Hand, ox: number, oy: number, ang: number, bx: number, by: number, isMachine: boolean) {
    const lx = ((isMachine ? BOX.w - bx : bx) / BOX.w) * hand.w - hand.pivotX;
    const ly = (by / BOX.h) * hand.h - hand.pivotY;
    return {
      x: ox + hand.pivotX + lx * Math.cos(ang) - ly * Math.sin(ang),
      y: oy + hand.pivotY + lx * Math.sin(ang) + ly * Math.cos(ang),
    };
  }

  function drawHand(
    hand: Hand,
    ox: number,
    oy: number,
    ang: number,
    t: number,
    wave: { R: number; tx: number; ty: number },
    isMachine: boolean,
    heat: { x: number; y: number; k: number },
  ) {
    const heatR = cell * 9;
    const cos = Math.cos(ang);
    const sin = Math.sin(ang);
    const LR = Math.max(90, W * 0.08);
    const font = `700 ${cell * 1.18}px ${family}`;
    ctx.font = font;
    let big = false;
    for (const c of hand.cells) {
      // rotate about the wrist, then place
      const lx = c.x - hand.pivotX;
      const ly = c.y - hand.pivotY;
      let x = ox + hand.pivotX + lx * cos - ly * sin;
      let y = oy + hand.pivotY + lx * sin + ly * cos;
      let ch = c.ch;
      let col = c.col;
      let alpha = 1;
      let scale = 1;
      if (c.live && (((t * (isMachine ? 9 : 3) + c.seed) | 0) % 4 === 0))
      {
        ch = isMachine ? LIVE[((t * 14 + c.seed) | 0) % LIVE.length] : GLYPHS[((t * 6 + c.seed) | 0) % GLYPHS.length];
        col = isMachine ? "rgb(255,106,61)" : "rgb(255,59,18)";
      }
      // fingertips warm to orange as they close in
      if (heat.k > 0) {
        const f = (1 - Math.hypot(x - heat.x, y - heat.y) / heatR) * heat.k;
        if (f > 0.15) {
          col = f > 0.5 ? "rgb(255,59,18)" : isMachine ? "rgb(255,138,99)" : "rgb(217,46,10)";
          if (f > 0.5) ch = GLYPHS[((t * 18 + c.seed) | 0) % GLYPHS.length];
        }
      }
      // the shockwave lifts the hands apart into glyph dust
      if (wave.R > 0) {
        const dx = x - wave.tx;
        const dy = y - wave.ty;
        const dd = Math.hypot(dx, dy) || 1;
        if (dd < wave.R) {
          const k = Math.min(1, (wave.R - dd) / (W * 0.22));
          x += (dx / dd) * k * W * 0.14;
          y += (dy / dd) * k * W * 0.14 - k * 60;
          alpha = 1 - k;
          col = isMachine ? mix(CYAN, WHITE, k) : mix(VIOLET, CYAN, k);
        }
      }
      // the lens: glyphs scatter, swell and scramble under the pointer
      if (lens.on > 0.01) {
        const dx = x - lens.x;
        const dy = y - lens.y;
        const dd = Math.hypot(dx, dy) || 1;
        if (dd < LR) {
          const f = (1 - dd / LR) * lens.on;
          x += (dx / dd) * f * 18;
          y += (dy / dd) * f * 18;
          scale = 1 + f * 0.9;
          if (f > 0.25) ch = (isMachine ? LIVE : HUMAN_RAMP)[((t * 24 + c.seed) | 0) % (isMachine ? LIVE.length : HUMAN_RAMP.length)];
          col = isMachine ? mix(CYAN, WHITE, f) : mix(VIOLET, [8, 6, 60], Math.min(1, f * 1.4));
        }
      }
      if (alpha < 0.02) continue;
      if (scale !== 1) {
        ctx.font = `700 ${cell * 1.18 * scale}px ${family}`;
        big = true;
      } else if (big) {
        ctx.font = font;
        big = false;
      }
      ctx.globalAlpha = alpha;
      ctx.fillStyle = col;
      ctx.fillText(ch, x, y);
    }
  }

  function draw(t: number) {
    if (!human || !machine) return;
    p += reduce ? 0 : (state.target - p) * 0.14;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    const portrait = H > W;
    const settle = ease(range(p, 0, 0.25));
    const contact = ease(range(p, 0.12, 0.5));
    const spark = range(p, 0.42, 0.52) * (1 - range(p, 0.6, 0.74));
    const tx = W / 2;
    const ty = H * (portrait ? 0.5 : 0.6);
    const maxR = Math.hypot(Math.max(tx, W - tx), Math.max(ty, H - ty)) + cell * 6;
    const R = maxR * Math.pow(range(p, 0.5, 0.92), 1.15);
    const wave = { R, tx, ty };

    // behind the wave front the screen is already night
    if (R > 0) {
      const gr = ctx.createRadialGradient(tx, ty, 0, tx, ty, R);
      gr.addColorStop(0, "#2a1008");
      gr.addColorStop(0.55, "#120807");
      gr.addColorStop(1, "#050505");
      ctx.globalAlpha = 1;
      ctx.fillStyle = gr;
      ctx.beginPath();
      ctx.arc(tx, ty, R, 0, Math.PI * 2);
      ctx.fill();
    }

    // glyph dust in the air, fading as the wave takes over
    ctx.font = `700 ${cell * 1.05}px ${family}`;
    const dustOn = 1 - range(p, 0.55, 0.8);
    if (dustOn > 0)
      for (const d of dust) {
        const tw = Math.sin(t * 0.9 + d.seed) * 0.5 + 0.5;
        const a = d.a * tw * dustOn;
        if (a < 0.03) continue;
        ctx.globalAlpha = a;
        ctx.fillStyle = d.x < W / 2 ? "rgb(102,98,91)" : "rgb(170,167,159)";
        ctx.fillText(GLYPHS[(d.seed + ((t * 1.5 + d.seed) | 0)) % GLYPHS.length], d.x, d.y);
      }

    // the hands: offstage → risen → reaching → touching
    // at rest the hands are already in frame, level and reaching, a held gap apart; they inch toward each other
    const reach = Math.sin(t * 1.1) * cell * 0.9 * (1 - contact);
    const gap = Math.max(0, (portrait ? W * 0.12 : W * 0.16) * (1 - contact) + W * 0.004 - reach);
    const out = W * 0.45 * (1 - state.enter);
    const drop = H * 0.02 * (1 - settle);
    const ang = 0.035 * (1 - contact);
    const breathe = Math.sin(t * 1.3) * 3 * (1 - contact);
    const hx = tx - gap / 2 - human.tipX - out;
    const hy = ty - human.tipY + drop + breathe;
    const mx = tx + gap / 2 - machine.tipX + out;
    const my = ty - machine.tipY + drop - breathe;
    const tipH = pointOf(human, hx, hy, ang, TIP.x, TIP.y, false);
    const tipM = pointOf(machine, mx, my, -ang, TIP.x, TIP.y, true);
    const heat = range(p, 0.22, 0.5);
    drawHand(human, hx, hy, ang, t, wave, false, { ...tipH, k: heat });
    drawHand(machine, mx, my, -ang, t, wave, true, { ...tipM, k: heat });

    ctx.strokeStyle = ctx.fillStyle = "#ff3b12";
    ctx.lineWidth = 1;

    // a drafting dimension between the fingertips, counting down to contact
    const dimA = (1 - range(contact, 0.82, 0.97)) * state.enter;
    if (dimA > 0.02 && tipM.x - tipH.x > cell) {
      const y = Math.min(tipH.y, tipM.y) - cell * 4.4;
      ctx.globalAlpha = dimA;
      ctx.beginPath();
      ctx.moveTo(tipH.x, tipH.y - cell * 1.4);
      ctx.lineTo(tipH.x, y - cell * 0.9);
      ctx.moveTo(tipM.x, tipM.y - cell * 1.4);
      ctx.lineTo(tipM.x, y - cell * 0.9);
      ctx.moveTo(tipH.x, y);
      ctx.lineTo(tipM.x, y);
      for (const x of [tipH.x, tipM.x]) {
        ctx.moveTo(x - 4, y + 4);
        ctx.lineTo(x + 4, y - 4);
      }
      ctx.stroke();
      const midX = (tipH.x + tipM.x) / 2;
      ctx.font = `600 ${Math.max(10, cell * 1.15)}px ${family}`;
      ctx.fillText(`${Math.round(tipM.x - tipH.x)} PX`, midX, y - cell * 1.3);
      ctx.globalAlpha = dimA * 0.75;
      ctx.font = `500 ${Math.max(8, cell * 0.85)}px ${family}`;
      ctx.fillText("TO CONTACT", midX, y - cell * 2.9);
    }

    // drafted callouts: a leader from each palm to its label in the corner
    const calloutA = (1 - range(p, 0.03, 0.15)) * state.enter;
    if (calloutA > 0.02 && !portrait) {
      const gut = Math.min(72, Math.max(20, W * 0.034));
      const ly = H * 0.93 - 6;
      const notes: [Hand, number, number, number, boolean, string, string, string][] = [
        [human, hx, hy, ang, false, "A /", "HUMAN — JUDGEMENT, CRAFT, TRUST", "rgb(102,98,91)"],
        [machine, mx, my, -ang, true, "B /", "MACHINE — MEMORY, SCALE, SPEED", "rgb(170,167,159)"],
      ];
      ctx.font = `500 ${Math.max(9, cell * 0.95)}px ${family}`;
      for (const [hand, ox, oy, a, isM, tag, text, ink] of notes) {
        const at = pointOf(hand, ox, oy, a, 140, 100, isM);
        const edge = isM ? W - gut : gut;
        const elbow = { x: at.x + (isM ? 1 : -1) * Math.max(24, (ly - 16 - at.y) * 0.55), y: ly - 16 };
        ctx.globalAlpha = calloutA * 0.9;
        ctx.strokeStyle = "#ff3b12";
        ctx.beginPath();
        ctx.moveTo(at.x, at.y);
        ctx.lineTo(elbow.x, elbow.y);
        ctx.lineTo(edge, elbow.y);
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(at.x, at.y, 5, 0, Math.PI * 2);
        ctx.stroke();
        ctx.fillStyle = "#ff3b12";
        ctx.beginPath();
        ctx.arc(at.x, at.y, 2, 0, Math.PI * 2);
        ctx.fill();
        // label: the letter in orange, the words in the side's ink
        ctx.textAlign = isM ? "right" : "left";
        const tagW = ctx.measureText(`${tag} `).width;
        const textW = ctx.measureText(text).width;
        ctx.globalAlpha = calloutA;
        ctx.fillStyle = "#ff3b12";
        ctx.fillText(tag, isM ? edge - textW - 6 : edge, ly);
        ctx.fillStyle = ink;
        ctx.fillText(text, isM ? edge : edge + tagW, ly);
      }
      ctx.textAlign = "center";
    }
    ctx.globalAlpha = 1;

    // the spark where the fingertips meet
    if (spark > 0) {
      const r = 26 + 170 * spark;
      const gr = ctx.createRadialGradient(tx, ty, 0, tx, ty, r);
      gr.addColorStop(0, `rgba(255,255,255,${0.95 * spark})`);
      gr.addColorStop(0.25, `rgba(255,59,18,${0.75 * spark})`);
      gr.addColorStop(0.6, `rgba(255,138,99,${0.25 * spark})`);
      gr.addColorStop(1, "rgba(255,138,99,0)");
      ctx.globalAlpha = 1;
      ctx.fillStyle = gr;
      ctx.beginPath();
      ctx.arc(tx, ty, r, 0, Math.PI * 2);
      ctx.fill();
    }

    // the wave front: a ring of glyphs, violet on the human side, cyan on the machine side
    if (R > 0 && R < maxR) {
      const band = cell * 2.8;
      ctx.font = `${cell * 1.2}px ${family}`;
      const step = (t * 22) | 0;
      for (let gy = 0; gy * rowH < H + rowH; gy++) {
        const y = gy * rowH + rowH / 2;
        const dy = y - ty;
        if (Math.abs(dy) > R + band) continue;
        const o = Math.sqrt((R + band) ** 2 - dy * dy);
        const inSq = (R - band) ** 2 - dy * dy;
        const i = inSq > 0 ? Math.sqrt(inSq) : 0;
        for (const [a, b] of [
          [tx - o, tx - i],
          [tx + i, tx + o],
        ]) {
          for (let x = Math.max(cell / 2, Math.floor(a / cell) * cell + cell / 2); x <= Math.min(W, b); x += cell) {
            const k = 1 - Math.abs(Math.hypot(x - tx, dy) - R) / band;
            if (k <= 0) continue;
            const gx = (x / cell) | 0;
            ctx.globalAlpha = k * 0.95;
            ctx.fillStyle = x < tx ? mix(VIOLET, WHITE, k * 0.5) : mix(CYAN, WHITE, k * 0.5);
            ctx.fillText(WAVE[(((gx * 73856093) ^ (gy * 19349663) ^ step) >>> 0) % WAVE.length], x, y);
          }
        }
      }
    }

    // the mark assembles where they met
    const ea = range(p, 0.6, 0.86);
    if (ea > 0) {
      ctx.font = `${emblemCell * 1.15}px ${family}`;
      const slow = (t * 4) | 0;
      for (const g of emblem) {
        const reveal = clamp((R - Math.hypot(g.dx, g.dy) - 40) / 220) * ea;
        if (reveal <= 0.01) continue;
        ctx.globalAlpha = reveal;
        ctx.fillStyle = g.col;
        ctx.fillText(EMBLEM[(g.seed + slow) % EMBLEM.length], tx + g.dx, ty - H * 0.06 + g.dy);
      }
    }
    ctx.globalAlpha = 1;

    // the header reads the left half as night once the wave has passed it
    const next = R > Math.hypot(tx - 40, ty - 30) ? "night" : "paper";
    if (next !== tone) {
      tone = next;
      onTone?.(tone);
    }
  }

  function loop(ms: number) {
    raf = 0;
    if (!visible) return;
    lens.on += (lens.want - lens.on) * 0.12;
    lens.x += (lens.tx - lens.x) * 0.25;
    lens.y += (lens.ty - lens.y) * 0.25;
    draw(ms / 1000);
    raf = requestAnimationFrame(loop);
  }

  const onMove = (e: PointerEvent) => {
    const r = canvas.getBoundingClientRect();
    lens.tx = e.clientX - r.left;
    lens.ty = e.clientY - r.top;
    const inside = lens.tx >= 0 && lens.ty >= 0 && lens.tx <= r.width && lens.ty <= r.height;
    if (inside && !lens.want) {
      lens.x = lens.tx;
      lens.y = lens.ty;
    }
    lens.want = inside && e.pointerType === "mouse" ? 1 : 0;
  };
  const onLeave = () => void (lens.want = 0);

  const ro = new ResizeObserver(() => build());
  ro.observe(canvas);
  const io = new IntersectionObserver(([e]) => {
    visible = e.isIntersecting;
    if (visible && !raf && !reduce) raf = requestAnimationFrame(loop);
  });
  io.observe(canvas);
  build();
  if (!reduce) {
    addEventListener("pointermove", onMove, { passive: true });
    document.addEventListener("pointerleave", onLeave);
    raf = requestAnimationFrame(loop);
  }

  function destroy() {
    cancelAnimationFrame(raf);
    ro.disconnect();
    io.disconnect();
    removeEventListener("pointermove", onMove);
    document.removeEventListener("pointerleave", onLeave);
  }

  return state;
}
