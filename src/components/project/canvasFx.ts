/** Scroll-driven canvas pieces for the case study: the story's dot ruler and the halftone wipe. */

type Surface = { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D; W: number; H: number };

const surface = (canvas: HTMLCanvasElement): Surface => {
  const ctx = canvas.getContext("2d")!;
  const s = { canvas, ctx, W: 0, H: 0 };
  const fit = () => {
    const dpr = Math.min(devicePixelRatio, 2);
    const r = canvas.getBoundingClientRect();
    s.W = r.width;
    s.H = r.height;
    canvas.width = Math.max(1, Math.round(r.width * dpr));
    canvas.height = Math.max(1, Math.round(r.height * dpr));
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  };
  fit();
  new ResizeObserver(fit).observe(canvas);
  return s;
};

/**
 * A vertical ruler of dotted rows that scrolls with the story. Each step owns a run of rows,
 * opened by a long labelled row; the rows of the step in view swell into solid dot bars,
 * and the whole ruler bows toward the reader at its centre.
 */
export function dotRuler(canvas: HTMLCanvasElement, labels: string[]) {
  const s = surface(canvas);
  const ROW = 30;
  const PER = 9;
  const total = labels.length * PER;
  const font = getComputedStyle(canvas).fontFamily;

  return (progress: number) => {
    const { ctx, W, H } = s;
    ctx.clearRect(0, 0, W, H);
    // progress 0 holds the first step at the centre, 1 the last
    const pos = progress * (total - PER) + PER / 2;
    const active = Math.min(labels.length - 1, Math.floor(pos / PER));
    const baseX = W * 0.42;
    for (let i = -2; i < total + 2; i++) {
      const y = H / 2 + (i - pos) * ROW;
      if (y < -ROW || y > H + ROW) continue;
      const k = Math.floor(i / PER);
      const major = i >= 0 && i % PER === 0;
      const dy = (y - H / 2) / (H / 2);
      const fade = Math.max(0, 1 - Math.abs(dy) ** 2.2);
      const bow = 34 * (1 - dy * dy);
      const x0 = baseX - bow;
      const inStep = k === active && !major && i >= 0 && i < total;
      const len = major ? 22 : inStep ? 11 : 9;
      const r = inStep ? 2.3 : major ? 1.5 : 1.2;
      const alpha = (inStep ? 1 : major ? 0.85 : 0.5) * fade;
      ctx.fillStyle = "#fff";
      for (let d = 0; d < len; d++) {
        const x = x0 + d * 6.6;
        ctx.globalAlpha = alpha * (inStep ? 1 : 1 - d / (len * 1.6));
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fill();
        // the step in view prints as a thick bar: three lines of dots
        if (inStep) {
          for (const off of [-4.6, 4.6]) {
            ctx.beginPath();
            ctx.arc(x, y + off, r * 0.9, 0, Math.PI * 2);
            ctx.fill();
          }
        }
      }
      if (major && i < total) {
        ctx.globalAlpha = fade * (k === active ? 0.9 : 0.4);
        ctx.font = `500 12px ${font}`;
        ctx.textAlign = "right";
        ctx.textBaseline = "middle";
        ctx.fillText(labels[k], x0 - 34, y);
      }
    }
    ctx.globalAlpha = 1;
  };
}

/**
 * The dark→light passage: horizontal bands of dots swell from the top down until they
 * merge into a solid light surface, in the colour of the light that follows.
 */
export function halftoneWipe(canvas: HTMLCanvasElement, color: string) {
  const s = surface(canvas);
  const GAP = 9;
  return (progress: number) => {
    const { ctx, W, H } = s;
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = color;
    const cols = Math.ceil(W / GAP) + 1;
    const rows = Math.ceil(H / GAP) + 1;
    for (let y = 0; y < rows; y++) {
      const ny = y / rows;
      // a front that sweeps down, with bands that run ahead of it
      const band = 0.5 + 0.5 * Math.sin(ny * 26 + progress * 9);
      const v = Math.min(1, Math.max(0, (progress * 1.7 - ny * 0.7) * 1.6 + band * 0.25 - 0.25));
      if (v <= 0.02) continue;
      const r = (GAP / 2) * 1.5 * Math.sqrt(v);
      if (v >= 0.98) {
        // a hair of overlap so solid rows never show seams between them
        ctx.fillRect(0, y * GAP - GAP / 2 - 0.5, W, GAP + 1);
        continue;
      }
      for (let x = 0; x < cols; x++) {
        ctx.beginPath();
        ctx.arc(x * GAP, y * GAP, r, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  };
}
