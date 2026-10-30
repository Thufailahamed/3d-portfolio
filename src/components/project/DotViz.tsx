"use client";

import { useEffect, useRef } from "react";

export type DotKind = "bars" | "steps" | "marquee" | "fill" | "glyph";

/**
 * A small dot-matrix display: a dim grid of dots with some of them lit, animating while in view.
 * "glyph" prints a short text (a number, a letter) as a halftone that breathes.
 */
export default function DotViz({ kind, text = "", seed = 0, className = "" }: { kind: DotKind; text?: string; seed?: number; className?: string }) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current!;
    const ctx = canvas.getContext("2d")!;
    const dpr = Math.min(devicePixelRatio, 2);
    let W = 0, H = 0;
    const gap = kind === "glyph" ? 7 : 8;
    let cols = 0, rows = 0;
    let mask: Float32Array | null = null;

    // the glyph's coverage per cell, sampled from text drawn offscreen
    const sampleGlyph = () => {
      const off = document.createElement("canvas");
      off.width = cols;
      off.height = rows;
      const o = off.getContext("2d")!;
      o.fillStyle = "#fff";
      o.textAlign = "center";
      o.textBaseline = "middle";
      o.font = `500 ${Math.round(rows * 0.92)}px ${getComputedStyle(canvas).fontFamily}`;
      o.fillText(text, cols / 2, rows * 0.54);
      const px = o.getImageData(0, 0, cols, rows).data;
      mask = new Float32Array(cols * rows);
      for (let i = 0; i < cols * rows; i++) mask[i] = px[i * 4 + 3] / 255;
    };

    const resize = () => {
      const r = canvas.getBoundingClientRect();
      W = r.width;
      H = r.height;
      canvas.width = Math.round(W * dpr);
      canvas.height = Math.round(H * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      cols = Math.floor(W / gap);
      rows = Math.floor(H / gap);
      if (kind === "glyph") sampleGlyph();
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);
    // the glyph is printed in the page's face, once it has loaded
    if (kind === "glyph") document.fonts?.ready.then(() => cols && sampleGlyph());

    const rnd = (i: number) => {
      const x = Math.sin(i * 12.9898 + seed * 78.233) * 43758.5453;
      return x - Math.floor(x);
    };
    const dot = (cx: number, cy: number, r: number, a: number) => {
      ctx.globalAlpha = a;
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.fill();
    };

    const draw = (t: number) => {
      ctx.clearRect(0, 0, W, H);
      ctx.fillStyle = "#fff";
      const ox = (W - (cols - 1) * gap) / 2;
      const oy = (H - (rows - 1) * gap) / 2;
      for (let x = 0; x < cols; x++) {
        for (let y = 0; y < rows; y++) {
          const cx = ox + x * gap, cy = oy + y * gap;
          const fromBottom = rows - 1 - y;
          let lit = 0;
          if (kind === "bars") {
            // columns rise and settle, every other column a solid bar
            const col = Math.floor(x / 2);
            if (x % 2 === 0) {
              const h = (0.35 + 0.6 * (0.5 + 0.5 * Math.sin(t * 1.3 + col * 0.9 + seed))) * (0.4 + 0.6 * (col / (cols / 2)));
              lit = fromBottom < h * rows ? 1 : 0;
            }
          } else if (kind === "steps") {
            // paired columns that step up and down in turn
            const col = Math.floor(x / 3);
            if (x % 3 !== 2) {
              const h = 0.25 + 0.45 * (0.5 + 0.5 * Math.sin(t * 2 - col * 0.8));
              lit = fromBottom < h * rows ? (x % 3 === 0 ? 1 : 0.6) : 0;
            }
          } else if (kind === "marquee") {
            // rows of blocks sliding past at their own pace
            if (y % 3 !== 2) {
              const lane = Math.floor(y / 3);
              const pos = Math.floor(x + t * (3 + lane * 1.7) * (lane % 2 ? -1 : 1));
              const block = Math.floor(pos / 3);
              lit = rnd(block * 7 + lane * 131) > 0.55 ? 1 : 0;
            }
          } else if (kind === "fill") {
            // bars fill left to right, then a dotted rule marks the end
            const p = (t * 0.25) % 1.4;
            const edge = Math.floor(Math.min(p, 1) * cols * 0.78);
            if (x === Math.floor(cols * 0.84)) lit = y % 2 ? 0 : 1;
            else if (x % 2 === 0 && x < edge && y > rows * 0.2 && y < rows * 0.8) lit = 1;
          } else if (kind === "glyph" && mask) {
            const m = mask[y * cols + x];
            const wave = 0.75 + 0.25 * Math.sin(t * 1.6 - (x + y) * 0.18);
            if (m > 0.04) {
              dot(cx, cy, Math.max(0.6, (gap / 2) * Math.sqrt(m) * wave), 0.95);
              continue;
            }
          }
          if (lit) dot(cx, cy, gap * 0.3, lit);
          else dot(cx, cy, 0.8, 0.22);
        }
      }
      ctx.globalAlpha = 1;
    };

    const still = matchMedia("(prefers-reduced-motion: reduce)").matches;
    let visible = false;
    const io = new IntersectionObserver(([e]) => (visible = e.isIntersecting));
    io.observe(canvas);
    let raf = 0;
    const t0 = performance.now();
    let last = 0;
    const frame = (now: number) => {
      raf = requestAnimationFrame(frame);
      // ~30 fps is plenty for a dot display
      if (!visible || now - last < 33) return;
      last = now;
      draw(still ? 2 : (now - t0) / 1000);
    };
    draw(2);
    raf = requestAnimationFrame(frame);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      io.disconnect();
    };
  }, [kind, text, seed]);

  return <canvas ref={ref} aria-hidden className={className} />;
}
