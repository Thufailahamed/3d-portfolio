import * as THREE from "three";
import type { Art } from "./layout";

const fontVar = (name: string, fallback: string) => {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v ? `${v}, ${fallback}` : fallback;
};

const loadImage = (src: string) =>
  new Promise<HTMLImageElement | null>((resolve) => {
    const img = new Image();
    img.decoding = "async";
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });

const texture = (canvas: HTMLCanvasElement, maxAniso: number) => {
  const t = new THREE.CanvasTexture(canvas);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = maxAniso;
  t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  return t;
};

/** Shrink the font until the text fits the width. */
function fit(ctx: CanvasRenderingContext2D, text: string, font: (px: number) => string, px: number, maxW: number) {
  let size = px;
  ctx.font = font(size);
  while (size > 6 && ctx.measureText(text).width > maxW) {
    size *= 0.94;
    ctx.font = font(size);
  }
  return size;
}

/**
 * Pad printing, the way printed bricks are made: flat ink on the plastic's own colour.
 * `w`/`h` are the printed face in studs, so the texture keeps the right aspect.
 */
export async function printArt(art: Art, w: number, h: number, maxAniso: number) {
  const display = fontVar("--font-inter-tight", "Inter Tight, Arial, sans-serif");
  const mono = fontVar("--font-jetbrains", "ui-monospace, monospace");
  const ppu = art.kind === "image" ? 160 : 200;
  const canvas = document.createElement("canvas");
  canvas.width = Math.min(4096, Math.round(w * ppu));
  canvas.height = Math.min(4096, Math.round(h * ppu));
  const ctx = canvas.getContext("2d")!;
  const W = canvas.width;
  const H = canvas.height;

  if (art.kind === "label") {
    ctx.fillStyle = art.bg;
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = art.ink;
    ctx.textBaseline = "middle";
    const scale = art.size ?? 0.56;
    const pad = H * 0.32;
    if (art.sub) {
      // title left, a small monospaced tag on the right
      const sub = art.sub.toUpperCase();
      ctx.font = `500 ${H * 0.26}px ${mono}`;
      const subW = ctx.measureText(sub).width;
      ctx.textAlign = "right";
      ctx.globalAlpha = 0.6;
      ctx.fillText(sub, W - pad, H * 0.53);
      ctx.globalAlpha = 1;
      ctx.textAlign = "left";
      fit(ctx, art.text, (px) => `800 ${px}px ${display}`, H * scale, W - pad * 3 - subW);
      ctx.fillText(art.text, pad, H * 0.54);
    } else {
      ctx.textAlign = "center";
      fit(ctx, art.text, (px) => `800 ${px}px ${display}`, H * scale, W - pad * 2);
      ctx.fillText(art.text, W / 2, H * 0.54);
    }
  } else if (art.kind === "image") {
    ctx.fillStyle = art.bg;
    ctx.fillRect(0, 0, W, H);
    const img = await loadImage(art.src);
    const m = Math.round(H * 0.035);
    if (img) {
      // cover-crop into the printable area, inside a thin border of the panel's own colour
      const bw = W - m * 2;
      const bh = H - m * 2;
      const s = Math.max(bw / img.width, bh / img.height);
      const sw = bw / s;
      const sh = bh / s;
      ctx.drawImage(img, (img.width - sw) / 2, (img.height - sh) / 2, sw, sh, m, m, bw, bh);
    }
  } else {
    // a road plate: tarmac-grey plastic, white edge lines and a dashed centre line
    ctx.fillStyle = "#6c6e68";
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = "#f2f3f2";
    const u = H / 16;
    ctx.fillRect(0, u * 1.6, W, u * 0.35);
    ctx.fillRect(0, H - u * 1.95, W, u * 0.35);
    for (let x = u * 1; x < W; x += u * 8) ctx.fillRect(x, H / 2 - u * 0.2, u * 4, u * 0.4);
  }
  return texture(canvas, maxAniso);
}

/** The minifig's face, wrapped round its head (u = 0.5 faces the camera). */
export function faceTexture(maxAniso: number, glasses = false) {
  const canvas = document.createElement("canvas");
  canvas.width = 1024;
  canvas.height = 512;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#f5cd2f";
  ctx.fillRect(0, 0, 1024, 512);
  ctx.fillStyle = "#1b1b1b";
  // eyes, with a little highlight
  for (const x of [452, 572]) {
    ctx.beginPath();
    ctx.ellipse(x, 230, 17, 25, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.fillStyle = "#ffffff";
  for (const x of [457, 577]) {
    ctx.beginPath();
    ctx.arc(x, 220, 6, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.strokeStyle = "#1b1b1b";
  ctx.lineCap = "round";
  if (glasses) {
    // round frames and a bridge
    ctx.lineWidth = 8;
    for (const x of [452, 572]) {
      ctx.beginPath();
      ctx.arc(x, 228, 40, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.beginPath();
    ctx.moveTo(492, 222);
    ctx.quadraticCurveTo(512, 210, 532, 222);
    ctx.stroke();
  } else {
    // brows
    ctx.lineWidth = 9;
    for (const [x, d] of [[452, -1], [572, 1]] as const) {
      ctx.beginPath();
      ctx.moveTo(x - 24, 182 + d * 3);
      ctx.quadraticCurveTo(x, 170, x + 24, 182 - d * 3);
      ctx.stroke();
    }
  }
  // a confident half-smile
  ctx.lineWidth = 11;
  ctx.beginPath();
  ctx.moveTo(458, 300);
  ctx.quadraticCurveTo(515, 352, 582, 292);
  ctx.stroke();
  // a hint of stubble
  ctx.globalAlpha = 0.12;
  ctx.beginPath();
  ctx.ellipse(512, 330, 92, 50, 0, 0, Math.PI);
  ctx.fill();
  return texture(canvas, maxAniso);
}

export type TorsoPrint = "hoodie" | "vest" | "shirt" | "hello";

/** Torso prints: the studio hoodie, a hi-vis vest, a shirt and tie, a "hello" tee. */
export function torsoTexture(maxAniso: number, kind: TorsoPrint, base: string) {
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 512;
  const ctx = canvas.getContext("2d")!;
  const display = fontVar("--font-inter-tight", "Inter Tight, Arial, sans-serif");
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, 512, 512);
  ctx.lineCap = "round";
  if (kind === "hoodie") {
    ctx.strokeStyle = "#e9ece9";
    ctx.lineWidth = 9;
    ctx.beginPath();
    ctx.moveTo(210, 40);
    ctx.lineTo(200, 150);
    ctx.moveTo(302, 40);
    ctx.lineTo(312, 150);
    ctx.stroke();
    ctx.strokeStyle = "rgba(255,255,255,.12)";
    ctx.lineWidth = 16;
    ctx.beginPath();
    ctx.arc(256, 0, 92, 0.15 * Math.PI, 0.85 * Math.PI);
    ctx.stroke();
    ctx.fillStyle = "#bbe90b";
    ctx.font = `800 64px ${display}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("SYNAPX", 256, 290);
    ctx.fillRect(176, 336, 160, 8);
    ctx.strokeStyle = "rgba(255,255,255,.12)";
    ctx.lineWidth = 6;
    ctx.strokeRect(150, 400, 212, 90);
  } else if (kind === "vest") {
    // a white tee under an orange vest with silver reflective bands
    ctx.fillStyle = "#f2f3f2";
    ctx.beginPath();
    ctx.moveTo(190, 0);
    ctx.lineTo(256, 120);
    ctx.lineTo(322, 0);
    ctx.fill();
    ctx.fillStyle = "#d8dde0";
    ctx.fillRect(0, 250, 512, 34);
    ctx.fillRect(0, 380, 512, 34);
    ctx.fillRect(150, 0, 30, 512);
    ctx.fillRect(332, 0, 30, 512);
    ctx.strokeStyle = "rgba(0,0,0,.25)";
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.moveTo(256, 120);
    ctx.lineTo(256, 512);
    ctx.stroke();
  } else if (kind === "shirt") {
    // collar, a dark tie and a lanyard badge
    ctx.fillStyle = "#e3e6e8";
    ctx.beginPath();
    ctx.moveTo(180, 0);
    ctx.lineTo(256, 70);
    ctx.lineTo(332, 0);
    ctx.fill();
    ctx.fillStyle = "#0a3463";
    ctx.beginPath();
    ctx.moveTo(240, 60);
    ctx.lineTo(272, 60);
    ctx.lineTo(284, 330);
    ctx.lineTo(256, 370);
    ctx.lineTo(228, 330);
    ctx.fill();
    ctx.strokeStyle = "#c91a09";
    ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.moveTo(196, 20);
    ctx.lineTo(330, 260);
    ctx.stroke();
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(312, 258, 60, 80);
    ctx.fillStyle = "#15171c";
    ctx.fillRect(322, 300, 40, 6);
    ctx.fillRect(322, 314, 28, 6);
  } else {
    ctx.fillStyle = "#ffffff";
    ctx.font = `800 88px ${display}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("HELLO", 256, 250);
    ctx.font = `600 34px ${display}`;
    ctx.fillText("say hi ↗", 256, 340);
  }
  return texture(canvas, maxAniso);
}
