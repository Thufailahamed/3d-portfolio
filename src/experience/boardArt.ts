import * as THREE from "three";
import { about, person, type Project } from "@/content/site";

/**
 * Paper for the investigation board, drawn on canvases: the project polaroids, the case
 * note, and the ink printed over the night map (graticule, place names). Text waits for
 * the site's fonts, then the textures update in place.
 */

const pad = (n: number) => String(n).padStart(2, "0");
const RED = "#a3141c";

/** The site's next/font families, resolved from their CSS variables. */
function fonts() {
  const css = getComputedStyle(document.documentElement);
  return {
    display: css.getPropertyValue("--font-inter-tight").trim() || "sans-serif",
    mono: css.getPropertyValue("--font-jetbrains").trim() || "monospace",
  };
}

async function fontsReady() {
  const f = fonts();
  await Promise.all([
    document.fonts.load(`700 40px ${f.display}`),
    document.fonts.load(`italic 700 40px ${f.display}`),
    document.fonts.load(`500 20px ${f.mono}`),
  ]).catch(() => {});
  return f;
}

function canvasTexture(w: number, h: number) {
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d")!;
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return { canvas, ctx, tex };
}

/** Warm photo paper with a little grain and uneven fading. */
function paper(ctx: CanvasRenderingContext2D, w: number, h: number, base: string, seed: number) {
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, w, h);
  let s = seed * 9301 + 49297;
  const rnd = () => ((s = (s * 9301 + 49297) % 233280) / 233280);
  for (let i = 0; i < 1800; i++) {
    ctx.fillStyle = `rgba(${rnd() < 0.5 ? "0,0,0" : "255,255,255"},${0.03 + rnd() * 0.04})`;
    ctx.fillRect(rnd() * w, rnd() * h, 1 + rnd() * 2, 1 + rnd() * 2);
  }
  const g = ctx.createRadialGradient(w * 0.45, h * 0.4, w * 0.1, w * 0.5, h * 0.5, w * 0.85);
  g.addColorStop(0, "rgba(255,250,235,0)");
  g.addColorStop(1, "rgba(120,95,60,0.18)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
}

function fitText(ctx: CanvasRenderingContext2D, text: string, max: number) {
  if (ctx.measureText(text).width <= max) return text;
  let t = text;
  while (t.length > 1 && ctx.measureText(`${t}…`).width > max) t = t.slice(0, -1);
  return `${t}…`;
}

export const CARD_PX = { w: 512, h: 636 };

/** A polaroid of the project: its cover, its number in red marker, its name typed below. */
export function cardTexture(p: Project, i: number) {
  const { w, h } = CARD_PX;
  const { ctx, tex } = canvasTexture(w, h);
  const photo = { x: 30, y: 30, w: w - 60, h: 420 };

  const draw = (img: HTMLImageElement | null, f: ReturnType<typeof fonts>) => {
    paper(ctx, w, h, "#e8e2d4", i + 1);
    ctx.fillStyle = "#14161a";
    ctx.fillRect(photo.x, photo.y, photo.w, photo.h);
    if (img) {
      // cover-fit, anchored to the top of the screenshot
      const k = Math.max(photo.w / img.width, photo.h / img.height);
      const sw = photo.w / k;
      const sh = photo.h / k;
      ctx.save();
      ctx.beginPath();
      ctx.rect(photo.x, photo.y, photo.w, photo.h);
      ctx.clip();
      ctx.filter = "saturate(0.75) contrast(1.05)";
      ctx.drawImage(img, (img.width - sw) / 2, 0, sw, sh, photo.x, photo.y, photo.w, photo.h);
      ctx.filter = "none";
      // the project's light washed over the print, and a darker edge
      ctx.globalCompositeOperation = "soft-light";
      ctx.fillStyle = p.tint;
      ctx.globalAlpha = 0.35;
      ctx.fillRect(photo.x, photo.y, photo.w, photo.h);
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = "source-over";
      const v = ctx.createRadialGradient(w / 2, photo.y + photo.h / 2, 60, w / 2, photo.y + photo.h / 2, photo.w * 0.75);
      v.addColorStop(0, "rgba(0,0,0,0)");
      v.addColorStop(1, "rgba(0,0,0,0.45)");
      ctx.fillStyle = v;
      ctx.fillRect(photo.x, photo.y, photo.w, photo.h);
      ctx.restore();
    }
    // inner edge of the print
    ctx.strokeStyle = "rgba(0,0,0,0.25)";
    ctx.lineWidth = 2;
    ctx.strokeRect(photo.x, photo.y, photo.w, photo.h);

    const top = photo.y + photo.h;
    ctx.textBaseline = "alphabetic";
    // number, in marker
    ctx.fillStyle = RED;
    ctx.font = `italic 700 50px ${f.display}`;
    ctx.fillText(`#${pad(i + 1)}`, 34, top + 70);
    // the project's colour, as a small sticker
    ctx.fillStyle = p.tint;
    ctx.beginPath();
    ctx.arc(w - 52, top + 52, 15, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "rgba(0,0,0,0.25)";
    ctx.stroke();
    // name and kind, typed
    ctx.fillStyle = "#17181b";
    ctx.font = `600 31px ${f.mono}`;
    ctx.fillText(fitText(ctx, p.title.toUpperCase(), w - 70), 34, top + 122);
    ctx.fillStyle = "rgba(23,24,27,0.62)";
    ctx.font = `500 19px ${f.mono}`;
    ctx.fillText(fitText(ctx, `${p.category} · ${p.year}`, w - 70), 34, top + 158);
    tex.needsUpdate = true;
  };

  const img = new Image();
  img.decoding = "async";
  img.src = p.cover;
  draw(null, fonts());
  Promise.all([fontsReady(), img.decode().then(() => img, () => null)]).then(([f, im]) => draw(im, f));
  return tex;
}

export const NOTE_PX = { w: 640, h: 420 };

/** The case note: a ruled index card, typed. */
export function noteTexture(lines: string[]) {
  const { w, h } = NOTE_PX;
  const { ctx, tex } = canvasTexture(w, h);
  const draw = (f: ReturnType<typeof fonts>) => {
    paper(ctx, w, h, "#ece6d6", 77);
    ctx.strokeStyle = "rgba(60,110,190,0.28)";
    ctx.lineWidth = 2;
    for (let y = 132; y < h - 10; y += 52) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
      ctx.stroke();
    }
    ctx.strokeStyle = "rgba(190,40,40,0.5)";
    ctx.beginPath();
    ctx.moveTo(0, 86);
    ctx.lineTo(w, 86);
    ctx.stroke();
    ctx.fillStyle = RED;
    ctx.font = `italic 700 44px ${f.display}`;
    ctx.fillText(lines[0], 36, 66);
    ctx.fillStyle = "#1b1c20";
    ctx.font = `600 30px ${f.mono}`;
    lines.slice(1).forEach((l, k) => {
      ctx.font = k === 0 ? `600 30px ${f.mono}` : `500 24px ${f.mono}`;
      ctx.fillStyle = k === 0 ? "#1b1c20" : "rgba(27,28,32,0.75)";
      ctx.fillText(fitText(ctx, l, w - 72), 36, 122 + k * 52);
    });
    tex.needsUpdate = true;
  };
  draw(fonts());
  fontsReady().then(draw);
  return tex;
}

export const caseNote = () =>
  noteTexture(["Case file — 2026", person.name.toUpperCase(), "Founder & engineer, SynapX", "Six systems, one desk.", "Built in Colombo."]);

export type MapFrame = { lonC: number; lat0: number; lat1: number };

/** Lon/lat → 0..1 across the printed map (the map is centred on lonC). */
export function mapUv(lon: number, lat: number, f: MapFrame) {
  const u = (((lon - f.lonC + 540) % 360) + 360) % 360 / 360;
  return [u, (lat - f.lat0) / (f.lat1 - f.lat0)] as const;
}

/** Ink printed over the night map: frame, graticule, degree ticks, place names, the title. */
export function inkTexture(f: MapFrame, home: number) {
  const w = 2048;
  const h = Math.round((w * (f.lat1 - f.lat0)) / 360);
  const { ctx, tex } = canvasTexture(w, h);
  tex.colorSpace = THREE.NoColorSpace;
  const X = (u: number) => u * w;
  const Y = (v: number) => (1 - v) * h;

  const draw = (fnt: ReturnType<typeof fonts>) => {
    ctx.clearRect(0, 0, w, h);
    ctx.strokeStyle = ctx.fillStyle = "#fff";
    // frame: a heavy rule and a hairline inside it
    ctx.lineWidth = 5;
    ctx.strokeRect(10, 10, w - 20, h - 20);
    ctx.lineWidth = 1.5;
    ctx.strokeRect(24, 24, w - 48, h - 48);

    // graticule every 30°, dotted; the equator solid
    ctx.globalAlpha = 0.32;
    ctx.setLineDash([2, 7]);
    for (let lon = -180; lon < 180; lon += 30) {
      const x = X(mapUv(lon, 0, f)[0]);
      ctx.beginPath();
      ctx.moveTo(x, 24);
      ctx.lineTo(x, h - 24);
      ctx.stroke();
    }
    for (let lat = -30; lat <= 60; lat += 30) {
      const y = Y(mapUv(0, lat, f)[1]);
      if (lat === 0) ctx.setLineDash([14, 8]);
      ctx.beginPath();
      ctx.moveTo(24, y);
      ctx.lineTo(w - 24, y);
      ctx.stroke();
      ctx.setLineDash([2, 7]);
    }
    ctx.setLineDash([]);

    // degree ticks along the frame
    ctx.globalAlpha = 0.7;
    ctx.font = `500 15px ${fnt.mono}`;
    ctx.textBaseline = "middle";
    for (let lon = -150; lon <= 180; lon += 30) {
      const x = X(mapUv(lon, 0, f)[0]);
      if (x < 70 || x > w - 70) continue;
      const t = lon === 0 ? "0°" : lon === 180 ? "180°" : `${Math.abs(lon)}°${lon < 0 ? "W" : "E"}`;
      ctx.textAlign = "center";
      ctx.fillText(t, x, h - 44);
      ctx.fillText(t, x, 44);
    }
    ctx.textAlign = "left";
    for (let lat = -30; lat <= 60; lat += 30) {
      const y = Y(mapUv(0, lat, f)[1]);
      ctx.fillText(lat === 0 ? "EQUATOR" : `${Math.abs(lat)}°${lat < 0 ? "S" : "N"}`, 38, y - 14);
    }

    // places, typed beside their lights
    about.places.forEach((p, i) => {
      const [u, v] = mapUv(p.lon, p.lat, f);
      const x = X(u);
      const y = Y(v);
      const isHome = i === home;
      ctx.globalAlpha = isHome ? 1 : 0.85;
      ctx.font = isHome ? `600 22px ${fnt.mono}` : `500 17px ${fnt.mono}`;
      const label = isHome ? `${p.city.toUpperCase()} — HOME` : p.city.toUpperCase();
      const right = x < w - 260;
      ctx.textAlign = right ? "left" : "right";
      ctx.fillText(label, x + (right ? 16 : -16), y - (isHome ? 22 : 16));
      ctx.globalAlpha = 0.55;
      ctx.font = `500 13px ${fnt.mono}`;
      const coords = `${Math.abs(p.lat).toFixed(2)}°${p.lat < 0 ? "S" : "N"} ${Math.abs(p.lon).toFixed(2)}°${p.lon < 0 ? "W" : "E"}`;
      ctx.fillText(coords, x + (right ? 16 : -16), y - (isHome ? 22 : 16) + (isHome ? 24 : 19));
    });

    // the title block
    ctx.textAlign = "left";
    ctx.globalAlpha = 0.9;
    ctx.font = `700 34px ${fnt.display}`;
    ctx.fillText("THE WORLD AT NIGHT", 48, h - 108);
    ctx.globalAlpha = 0.55;
    ctx.font = `500 14px ${fnt.mono}`;
    ctx.fillText("CITY LIGHTS · NASA BLACK MARBLE · EQUIRECTANGULAR", 50, h - 78);
    ctx.globalAlpha = 1;
    tex.needsUpdate = true;
  };
  draw(fonts());
  fontsReady().then(draw);
  return tex;
}
