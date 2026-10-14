import * as THREE from "three";
import { about, person, projects, type Project } from "@/content/site";

/**
 * Paper for the investigation board, drawn on canvases: the project dossier polaroids,
 * the case note, the telemetry blueprint slip, and the cartographic ink printed over the
 * night map (coastlines, country borders, graticule, radar rings, place reticles).
 * Text waits for the site's fonts, then the textures update in place.
 */

const pad = (n: number) => String(n).padStart(2, "0");
const RED = "#b81822";

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
    document.fonts.load(`600 24px ${f.mono}`),
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

/** Warm archival card stock with subtle fiber grain and soft edge vignette. */
function paper(ctx: CanvasRenderingContext2D, w: number, h: number, base: string, seed: number) {
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, w, h);
  let s = seed * 9301 + 49297;
  const rnd = () => ((s = (s * 9301 + 49297) % 233280) / 233280);
  for (let i = 0; i < 2200; i++) {
    ctx.fillStyle = `rgba(${rnd() < 0.5 ? "18,16,14" : "255,253,248"},${0.02 + rnd() * 0.032})`;
    ctx.fillRect(rnd() * w, rnd() * h, 1 + rnd() * 2, 1 + rnd() * 2);
  }
  const g = ctx.createRadialGradient(w * 0.48, h * 0.42, w * 0.15, w * 0.5, h * 0.5, w * 0.85);
  g.addColorStop(0, "rgba(255,252,244,0)");
  g.addColorStop(1, "rgba(110,88,58,0.13)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
  // Crisp outer paper edge rule
  ctx.strokeStyle = "rgba(35,28,20,0.18)";
  ctx.lineWidth = 3;
  ctx.strokeRect(1.5, 1.5, w - 3, h - 3);
}

function fitText(ctx: CanvasRenderingContext2D, text: string, max: number) {
  if (ctx.measureText(text).width <= max) return text;
  let t = text;
  while (t.length > 1 && ctx.measureText(`${t}…`).width > max) t = t.slice(0, -1);
  return `${t}…`;
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
}

export const CARD_PX = { w: 680, h: 720 };

/**
 * An archival dossier Polaroid of the project:
 * - Top evidence strip with file code + live status
 * - Full 16:10 screenshot viewport so hero typography & dashboards are never cropped off
 * - Red marker index, project title, category, stack pills, and metric stamp below
 */
export function cardTexture(p: Project, i: number) {
  const { w, h } = CARD_PX;
  const { ctx, tex } = canvasTexture(w, h);
  const barH = 26;
  const photo = { x: 28, y: 54 + barH, w: w - 56, h: 382 };

  const draw = (img: HTMLImageElement | null, f: ReturnType<typeof fonts>) => {
    paper(ctx, w, h, "#f1ece0", i + 1);

    // Top archival metadata strip above the print
    ctx.textBaseline = "middle";
    ctx.fillStyle = RED;
    ctx.font = `600 16px ${f.mono}`;
    ctx.textAlign = "left";
    ctx.fillText(`EVIDENCE // FILE #${pad(i + 1)}`, 30, 31);

    ctx.fillStyle = "rgba(23,24,27,0.52)";
    ctx.font = `500 15px ${f.mono}`;
    ctx.textAlign = "right";
    ctx.fillText(`CMB-0${i + 1} · ${p.year}`, w - 30, 31);
    ctx.textAlign = "left";

    // Dark browser chrome bar above the 16:10 screenshot so light UIs frame cleanly
    ctx.fillStyle = "#14161b";
    roundRect(ctx, photo.x, photo.y - barH, photo.w, barH + photo.h, 8);
    ctx.fill();

    // Window traffic-light dots + URL bar in the dark frame header
    const dotY = photo.y - barH / 2;
    ["#ff5f56", "#ffbd2e", "#27c93f"].forEach((col, d) => {
      ctx.fillStyle = col;
      ctx.beginPath();
      ctx.arc(photo.x + 16 + d * 13, dotY, 4, 0, Math.PI * 2);
      ctx.fill();
    });
    ctx.fillStyle = "rgba(255,255,255,0.45)";
    ctx.font = `500 12px ${f.mono}`;
    const host = p.link ? p.link.replace(/^https?:\/\//, "").replace(/\/$/, "") : `${p.slug}.synapx.lk`;
    ctx.fillText(host, photo.x + 64, dotY + 1);

    // Live indicator pill in browser bar
    ctx.fillStyle = p.tint;
    ctx.beginPath();
    ctx.arc(photo.x + photo.w - 58, dotY, 3.8, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "rgba(255,255,255,0.72)";
    ctx.font = `600 11px ${f.mono}`;
    ctx.fillText("LIVE", photo.x + photo.w - 48, dotY + 1);

    // Screenshot area
    ctx.fillStyle = "#0e1014";
    ctx.fillRect(photo.x, photo.y, photo.w, photo.h);

    if (img) {
      // 624x382 is ~1.63:1, matching the 16:10 cover screenshots almost 1:1 without cropping sides
      const k = Math.max(photo.w / img.width, photo.h / img.height);
      const sw = photo.w / k;
      const sh = photo.h / k;
      ctx.save();
      ctx.beginPath();
      ctx.rect(photo.x, photo.y, photo.w, photo.h);
      ctx.clip();
      ctx.filter = "contrast(1.05) saturate(0.96)";
      ctx.drawImage(img, (img.width - sw) / 2, 0, sw, sh, photo.x, photo.y, photo.w, photo.h);
      ctx.filter = "none";

      // Subtle glossy photo sheen across top-left to bottom-right
      const sheen = ctx.createLinearGradient(photo.x, photo.y, photo.x + photo.w * 0.7, photo.y + photo.h);
      sheen.addColorStop(0, "rgba(255,255,255,0.09)");
      sheen.addColorStop(0.35, "rgba(255,255,255,0.0)");
      sheen.addColorStop(1, "rgba(0,0,0,0.22)");
      ctx.fillStyle = sheen;
      ctx.fillRect(photo.x, photo.y, photo.w, photo.h);

      // Bottom edge gradient for metric badge legibility
      const botGrad = ctx.createLinearGradient(0, photo.y + photo.h - 68, 0, photo.y + photo.h);
      botGrad.addColorStop(0, "rgba(10,12,16,0)");
      botGrad.addColorStop(1, "rgba(10,12,16,0.68)");
      ctx.fillStyle = botGrad;
      ctx.fillRect(photo.x, photo.y + photo.h - 68, photo.w, 68);

      // Headline metric badge overlaid inside bottom-right of the photo
      const m0 = p.metrics?.[0];
      if (m0) {
        const badgeText = `${m0.value} ${m0.label}`.toUpperCase();
        ctx.font = `600 14px ${f.mono}`;
        const tw = ctx.measureText(badgeText).width;
        const bx = photo.x + photo.w - tw - 34;
        const by = photo.y + photo.h - 38;
        ctx.fillStyle = "rgba(12,13,16,0.86)";
        roundRect(ctx, bx, by, tw + 24, 28, 6);
        ctx.fill();
        ctx.strokeStyle = p.tint;
        ctx.lineWidth = 1.5;
        ctx.stroke();
        ctx.fillStyle = p.tint;
        ctx.textBaseline = "middle";
        ctx.fillText(badgeText, bx + 12, by + 14.5);
      }

      ctx.restore();
    }

    // Crisp dark border around viewport
    ctx.strokeStyle = "rgba(16,18,22,0.55)";
    ctx.lineWidth = 2.5;
    roundRect(ctx, photo.x, photo.y - barH, photo.w, barH + photo.h, 8);
    ctx.stroke();

    // Lower caption block on the Polaroid paper
    const top = photo.y + photo.h;
    ctx.textBaseline = "alphabetic";

    // Red marker number #01
    ctx.fillStyle = RED;
    ctx.font = `italic 700 54px ${f.display}`;
    ctx.fillText(`#${pad(i + 1)}`, 28, top + 64);

    // Project title beside or below marker
    ctx.fillStyle = "#121316";
    ctx.font = `700 38px ${f.display}`;
    ctx.fillText(fitText(ctx, p.title.toUpperCase(), w - 210), 134, top + 62);

    // Accent tint seal on the right
    ctx.fillStyle = "#16181d";
    ctx.beginPath();
    ctx.arc(w - 50, top + 46, 20, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = p.tint;
    ctx.beginPath();
    ctx.arc(w - 50, top + 46, 11, 0, Math.PI * 2);
    ctx.fill();

    // Divider line
    ctx.strokeStyle = "rgba(20,22,26,0.14)";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(28, top + 82);
    ctx.lineTo(w - 28, top + 82);
    ctx.stroke();

    // Category + Role
    ctx.fillStyle = "rgba(18,19,22,0.78)";
    ctx.font = `600 20px ${f.mono}`;
    ctx.fillText(fitText(ctx, `${p.category.toUpperCase()} — ${p.role.toUpperCase()}`, w - 56), 28, top + 114);

    // Stack chips row at the bottom of the card
    let cx = 28;
    const cy = top + 132;
    ctx.font = `600 15px ${f.mono}`;
    ctx.textBaseline = "middle";
    p.stack.slice(0, 3).forEach((tech) => {
      const label = tech.toUpperCase();
      const tw = ctx.measureText(label).width + 20;
      if (cx + tw > w - 120) return;
      ctx.fillStyle = "rgba(20,22,27,0.08)";
      roundRect(ctx, cx, cy, tw, 28, 5);
      ctx.fill();
      ctx.strokeStyle = "rgba(20,22,27,0.2)";
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.fillStyle = "#1c1e24";
      ctx.fillText(label, cx + 10, cy + 14.5);
      cx += tw + 8;
    });

    // Mini barcode stamp at bottom-right
    const bx0 = w - 102;
    for (let b = 0; b < 18; b++) {
      const bw = b % 3 === 0 ? 3 : 1.5;
      ctx.fillStyle = "rgba(20,22,27,0.45)";
      ctx.fillRect(bx0 + b * 4.2, cy + 2, bw, 24);
    }

    tex.needsUpdate = true;
  };

  const img = new Image();
  img.decoding = "async";
  img.src = p.cover;
  draw(null, fonts());
  Promise.all([fontsReady(), img.decode().then(() => img, () => null)]).then(([f, im]) => draw(im, f));
  return tex;
}

export const NOTE_PX = { w: 680, h: 460 };

/** The primary case note: a ruled archival index card with a verification stamp. */
export function noteTexture(lines: string[]) {
  const { w, h } = NOTE_PX;
  const { ctx, tex } = canvasTexture(w, h);
  const draw = (f: ReturnType<typeof fonts>) => {
    paper(ctx, w, h, "#efe8d8", 77);
    // Blue horizontal ruled lines
    ctx.strokeStyle = "rgba(50,105,185,0.26)";
    ctx.lineWidth = 2;
    for (let y = 136; y < h - 18; y += 52) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
      ctx.stroke();
    }
    // Red top margin rule
    ctx.strokeStyle = "rgba(195,38,38,0.55)";
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.moveTo(0, 86);
    ctx.lineTo(w, 86);
    ctx.stroke();

    ctx.textBaseline = "alphabetic";
    ctx.fillStyle = RED;
    ctx.font = `italic 700 42px ${f.display}`;
    ctx.fillText(lines[0], 34, 64);

    ctx.font = `600 16px ${f.mono}`;
    ctx.textAlign = "right";
    ctx.fillStyle = "rgba(27,28,32,0.55)";
    ctx.fillText("REF // CMB-LK", w - 32, 58);
    ctx.textAlign = "left";

    lines.slice(1).forEach((l, k) => {
      ctx.font = k === 0 ? `700 31px ${f.mono}` : `500 24px ${f.mono}`;
      ctx.fillStyle = k === 0 ? "#141519" : "rgba(24,25,30,0.82)";
      ctx.fillText(fitText(ctx, l, w - 68), 34, 126 + k * 52);
    });

    // Angled red verification stamp in bottom-right
    ctx.save();
    ctx.translate(w - 135, h - 76);
    ctx.rotate(-0.14);
    ctx.strokeStyle = "rgba(184,24,34,0.72)";
    ctx.lineWidth = 3;
    roundRect(ctx, -92, -26, 184, 52, 6);
    ctx.stroke();
    ctx.fillStyle = "rgba(184,24,34,0.78)";
    ctx.font = `700 19px ${f.mono}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("6 LIVE · PROD", 0, -6);
    ctx.font = `500 13px ${f.mono}`;
    ctx.fillText("COLOMBO ORIGIN", 0, 13);
    ctx.restore();

    tex.needsUpdate = true;
  };
  draw(fonts());
  fontsReady().then(draw);
  return tex;
}

export const caseNote = () =>
  noteTexture([
    "Case file — 2026",
    person.name.toUpperCase(),
    "Founder & engineer, SynapX",
    "6 production systems · 1 desk",
    "Origin: Colombo (6.93°N 79.85°E)",
    "All systems verified live.",
  ]);

/**
 * Secondary pinned field artifact: a dark technical blueprint / telemetry card
 * summarizing the architecture across all six systems on the board.
 */
export function telemetryNote() {
  const { w, h } = NOTE_PX;
  const { ctx, tex } = canvasTexture(w, h);
  const draw = (f: ReturnType<typeof fonts>) => {
    ctx.fillStyle = "#101622";
    ctx.fillRect(0, 0, w, h);

    // Subtle blueprint grid
    ctx.strokeStyle = "rgba(120,175,255,0.1)";
    ctx.lineWidth = 1;
    for (let x = 24; x < w; x += 32) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, h);
      ctx.stroke();
    }
    for (let y = 24; y < h; y += 32) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
      ctx.stroke();
    }

    // Outer technical frame
    ctx.strokeStyle = "rgba(159,208,255,0.45)";
    ctx.lineWidth = 3;
    ctx.strokeRect(14, 14, w - 28, h - 28);

    ctx.textBaseline = "alphabetic";
    ctx.fillStyle = "#c8ff3d";
    ctx.font = `600 20px ${f.mono}`;
    ctx.fillText("TELEMETRY // ARCHITECTURE SPEC", 36, 56);

    ctx.strokeStyle = "rgba(200,255,61,0.35)";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(36, 72);
    ctx.lineTo(w - 36, 72);
    ctx.stroke();

    const rows = [
      ["01 SCHOOL", "252 RLS · 68 TABLES · 6 PORTALS", "#c8ff3d"],
      ["02 LEGAL", "298 MODELS · 865 ROUTES · 40 AI", "#e8c27a"],
      ["03 LUXE", "205 SQL RPCs · 327 EDGE · 6 RAILS", "#d18cff"],
      ["04 GOLDOS", "SHOWROOM · VAULT · LIVE KARAT", "#ffb347"],
      ["05 VYRO", "MILL-DIRECT B2B · LIVE LKR CART", "#7aa8ff"],
      ["06 HEALTH", "EN/SI/TA RECORDS · 3.8S OCR", "#6ff0c8"],
    ];

    rows.forEach(([code, spec, tint], idx) => {
      const y = 114 + idx * 52;
      ctx.fillStyle = tint;
      ctx.beginPath();
      ctx.arc(44, y - 7, 5, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = "#ffffff";
      ctx.font = `700 20px ${f.mono}`;
      ctx.fillText(code, 60, y);

      ctx.fillStyle = "rgba(215,230,250,0.78)";
      ctx.font = `500 18px ${f.mono}`;
      ctx.fillText(spec, 210, y);
    });

    ctx.fillStyle = "rgba(159,208,255,0.6)";
    ctx.font = `500 15px ${f.mono}`;
    ctx.fillText(`STACK: NEXT.JS · SUPABASE · WORKERS · GEMINI RAG · ${projects.length} LIVE`, 36, h - 32);

    tex.needsUpdate = true;
  };
  draw(fonts());
  fontsReady().then(draw);
  return tex;
}

export type MapFrame = { lonC: number; lat0: number; lat1: number };

/** Lon/lat → 0..1 across the printed map (the map is centred on lonC). */
export function mapUv(lon: number, lat: number, f: MapFrame) {
  const u = ((((lon - f.lonC + 540) % 360) + 360) % 360) / 360;
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

export const WALL_SHEET_PX = { w: 520, h: 760 };

/**
 * Left studio wall sheet: Colombo Meridian & Geodesic Azimuth schematic
 * hanging on the wall beside the corkboard.
 */
export function wallBlueprintLeft() {
  const { w, h } = WALL_SHEET_PX;
  const { ctx, tex } = canvasTexture(w, h);
  const draw = (f: ReturnType<typeof fonts>) => {
    ctx.fillStyle = "#0b111c";
    ctx.fillRect(0, 0, w, h);

    // Fine blueprint grid
    ctx.strokeStyle = "rgba(120,170,240,0.09)";
    ctx.lineWidth = 1;
    for (let x = 20; x < w; x += 26) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, h);
      ctx.stroke();
    }
    for (let y = 20; y < h; y += 26) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
      ctx.stroke();
    }

    // Outer technical border
    ctx.strokeStyle = "rgba(155,198,255,0.38)";
    ctx.lineWidth = 2.5;
    ctx.strokeRect(16, 16, w - 32, h - 32);
    ctx.lineWidth = 1;
    ctx.strokeRect(24, 24, w - 48, h - 48);

    // Header block
    ctx.fillStyle = "#c8ff3d";
    ctx.font = `700 18px ${f.mono}`;
    ctx.fillText("SECTOR SURVEY // CMB-01", 42, 58);
    ctx.fillStyle = "rgba(190,215,255,0.62)";
    ctx.font = `500 13px ${f.mono}`;
    ctx.fillText("AZIMUTH PROJECTION · 06.93°N 079.85°E", 42, 80);

    // Geodesic azimuth compass rose diagram
    const cx = w / 2;
    const cy = 248;
    [42, 84, 126].forEach((r, idx) => {
      ctx.strokeStyle = idx === 0 ? "rgba(200,255,61,0.6)" : "rgba(155,198,255,0.28)";
      ctx.lineWidth = idx === 0 ? 1.8 : 1.2;
      ctx.setLineDash(idx === 1 ? [5, 5] : []);
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.stroke();
    });
    ctx.setLineDash([]);

    // Radial spokes every 30 deg
    ctx.strokeStyle = "rgba(155,198,255,0.2)";
    for (let a = 0; a < 12; a++) {
      const ang = (a * Math.PI) / 6;
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(ang) * 18, cy + Math.sin(ang) * 18);
      ctx.lineTo(cx + Math.cos(ang) * 134, cy + Math.sin(ang) * 134);
      ctx.stroke();
    }

    // Center hub dot
    ctx.fillStyle = "#c8ff3d";
    ctx.beginPath();
    ctx.arc(cx, cy, 5, 0, Math.PI * 2);
    ctx.fill();

    // Global reach vector table below compass
    ctx.fillStyle = "rgba(255,255,255,0.88)";
    ctx.font = `600 15px ${f.mono}`;
    ctx.fillText("GLOBAL NODE TELEMETRY", 42, 424);

    ctx.strokeStyle = "rgba(155,198,255,0.25)";
    ctx.beginPath();
    ctx.moveTo(42, 438);
    ctx.lineTo(w - 42, 438);
    ctx.stroke();

    about.places.slice(0, 7).forEach((pl, idx) => {
      const y = 468 + idx * 34;
      const isHome = idx === 0;
      ctx.fillStyle = isHome ? "#c8ff3d" : "rgba(210,228,255,0.85)";
      ctx.font = `600 14px ${f.mono}`;
      ctx.textAlign = "left";
      ctx.fillText(`${pad(idx + 1)}  ${pl.city.toUpperCase()}`, 42, y);

      ctx.fillStyle = "rgba(165,195,240,0.6)";
      ctx.font = `500 13px ${f.mono}`;
      ctx.textAlign = "right";
      ctx.fillText(
        `${Math.abs(pl.lat).toFixed(1)}°${pl.lat < 0 ? "S" : "N"}  ${Math.abs(pl.lon).toFixed(1)}°${pl.lon < 0 ? "W" : "E"}`,
        w - 42,
        y,
      );
    });
    ctx.textAlign = "left";

    ctx.fillStyle = "rgba(155,198,255,0.48)";
    ctx.font = `500 12px ${f.mono}`;
    ctx.fillText("SYNAPX ENGINEERING STUDIO · ARCHIVE SHEET A-01", 42, h - 38);

    tex.needsUpdate = true;
  };
  draw(fonts());
  fontsReady().then(draw);
  return tex;
}

/**
 * Right studio wall sheet: System Architecture & Layer Stack schematic
 * hanging on the right wall beside the corkboard.
 */
export function wallBlueprintRight() {
  const { w, h } = WALL_SHEET_PX;
  const { ctx, tex } = canvasTexture(w, h);
  const draw = (f: ReturnType<typeof fonts>) => {
    ctx.fillStyle = "#0b111c";
    ctx.fillRect(0, 0, w, h);

    // Fine blueprint grid
    ctx.strokeStyle = "rgba(120,170,240,0.09)";
    ctx.lineWidth = 1;
    for (let x = 20; x < w; x += 26) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, h);
      ctx.stroke();
    }
    for (let y = 20; y < h; y += 26) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
      ctx.stroke();
    }

    ctx.strokeStyle = "rgba(155,198,255,0.38)";
    ctx.lineWidth = 2.5;
    ctx.strokeRect(16, 16, w - 32, h - 32);
    ctx.lineWidth = 1;
    ctx.strokeRect(24, 24, w - 48, h - 48);

    ctx.fillStyle = "#c8ff3d";
    ctx.font = `700 18px ${f.mono}`;
    ctx.fillText("SYSTEM TOPOLOGY // REV 4.2", 42, 58);
    ctx.fillStyle = "rgba(190,215,255,0.62)";
    ctx.font = `500 13px ${f.mono}`;
    ctx.fillText("END-TO-END STACK · SCHEMA TO SCREEN", 42, 80);

    const layers = [
      { code: "L1 // CLIENTS", title: "NEXT.JS WEB + EXPO NATIVE", sub: "Role portals · realtime state · WebGL", col: "#c8ff3d" },
      { code: "L2 // EDGE API", title: "CLOUDFLARE WORKERS + HONO", sub: "327 edge endpoints · Zod server actions", col: "#7aa8ff" },
      { code: "L3 // COPILOT", title: "GEMINI AI + PGVECTOR RAG", sub: "40 grounded features · source citations", col: "#e8c27a" },
      { code: "L4 // LEDGER", title: "POSTGRESQL + SUPABASE RLS", sub: "252 tenant policies · 205 SQL RPCs", col: "#d18cff" },
      { code: "L5 // RAILS", title: "MULTI-GATEWAY RECONCILIATION", sub: "6 payment rails · live karat & LKR feeds", col: "#6ff0c8" },
    ];

    layers.forEach((l, idx) => {
      const bx = 42;
      const by = 114 + idx * 112;
      const bw = w - 84;
      const bh = 88;

      ctx.fillStyle = "rgba(18,28,46,0.78)";
      roundRect(ctx, bx, by, bw, bh, 8);
      ctx.fill();
      ctx.strokeStyle = "rgba(155,198,255,0.28)";
      ctx.lineWidth = 1.4;
      ctx.stroke();

      // Left accent bar
      ctx.fillStyle = l.col;
      ctx.fillRect(bx, by + 10, 4, bh - 20);

      ctx.fillStyle = l.col;
      ctx.font = `600 13px ${f.mono}`;
      ctx.fillText(l.code, bx + 18, by + 26);

      ctx.fillStyle = "#ffffff";
      ctx.font = `700 17px ${f.mono}`;
      ctx.fillText(l.title, bx + 18, by + 50);

      ctx.fillStyle = "rgba(185,208,245,0.68)";
      ctx.font = `500 13px ${f.mono}`;
      ctx.fillText(l.sub, bx + 18, by + 72);

      // Vertical connector wire to next block
      if (idx < layers.length - 1) {
        ctx.strokeStyle = "rgba(200,255,61,0.45)";
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(w / 2, by + bh);
        ctx.lineTo(w / 2, by + 112);
        ctx.stroke();
      }
    });

    ctx.fillStyle = "rgba(155,198,255,0.48)";
    ctx.font = `500 12px ${f.mono}`;
    ctx.fillText("ALL 6 SYSTEMS VERIFIED IN PRODUCTION · SHEET B-02", 42, h - 38);

    tex.needsUpdate = true;
  };
  draw(fonts());
  fontsReady().then(draw);
  return tex;
}


/** The board's printed map: centred on 10°E, from the Southern Ocean to the Arctic. */
export const BOARD_FRAME: MapFrame = { lonC: 10, lat0: -58, lat1: 78 };
/**
 * How much of the screen's width the map fills where the globe's unfolding ends — and where
 * the board's camera starts, so the cut between the two scenes doesn't show.
 */
export const UNFOLD_FILL = 0.9;

let ink: THREE.CanvasTexture | null = null;
/** One ink texture for the board's map and the unfolding globe (same print, same pixels). */
export const sharedInk = () => (ink ??= inkTexture(BOARD_FRAME, 0));
