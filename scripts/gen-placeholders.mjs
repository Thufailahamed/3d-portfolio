/**
 * Generates abstract placeholder artwork for every project in src/content/site.ts.
 *   node scripts/gen-placeholders.mjs
 * Replace public/projects/<slug>/*.webp with real screenshots whenever you like.
 */
import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const src = fs.readFileSync(path.join(root, "src/content/site.ts"), "utf8");

// lightweight extraction of slug / title / tint triples from the data file
const projects = [...src.matchAll(/slug: "([^"]+)",\s*title: "([^"]+)",[\s\S]*?tint: "(#[0-9a-fA-F]{6})"/g)].map(
  (m) => ({ slug: m[1], title: m[2], tint: m[3] }),
);

function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const hash = (s) => [...s].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7);

function art({ slug, title, tint }, variant, w, h) {
  const r = rng(hash(slug) + variant * 101);
  const shapes = [];
  // soft glows
  for (let i = 0; i < 5; i++) {
    const cx = r() * w, cy = r() * h, rad = (0.2 + r() * 0.5) * w;
    shapes.push(`<circle cx="${cx}" cy="${cy}" r="${rad}" fill="url(#glow)" opacity="${0.25 + r() * 0.5}"/>`);
  }
  // flow lines
  for (let i = 0; i < 26; i++) {
    const y0 = r() * h, amp = 40 + r() * 160, ph = r() * 6;
    let d = `M0 ${y0}`;
    for (let x = 0; x <= w; x += w / 24) d += ` L${x.toFixed(1)} ${(y0 + Math.sin(x / w * 6 + ph + variant) * amp).toFixed(1)}`;
    shapes.push(`<path d="${d}" stroke="${i % 5 ? "#ece9e2" : tint}" stroke-opacity="${0.05 + r() * 0.25}" stroke-width="${0.6 + r() * 2.4}" fill="none"/>`);
  }
  // UI-ish frames
  for (let i = 0; i < 3; i++) {
    const fw = (0.2 + r() * 0.3) * w, fh = (0.15 + r() * 0.3) * h;
    shapes.push(`<rect x="${r() * (w - fw)}" y="${r() * (h - fh)}" width="${fw}" height="${fh}" rx="10" fill="#ece9e2" fill-opacity="0.04" stroke="#ece9e2" stroke-opacity="0.18"/>`);
  }
  const label = variant === 0
    ? `<text x="${w * 0.06}" y="${h * 0.9}" font-family="Helvetica, Arial, sans-serif" font-weight="700" font-size="${w * 0.11}" letter-spacing="-${w * 0.004}" fill="#ece9e2">${title.toUpperCase()}</text>`
    : `<text x="${w * 0.06}" y="${h * 0.92}" font-family="Menlo, monospace" font-size="${w * 0.018}" letter-spacing="4" fill="#ece9e2" fill-opacity="0.6">${title.toUpperCase()} — 0${variant}</text>`;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
  <defs>
    <radialGradient id="glow"><stop offset="0" stop-color="${tint}"/><stop offset="1" stop-color="${tint}" stop-opacity="0"/></radialGradient>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#101012"/><stop offset="1" stop-color="#050506"/></linearGradient>
  </defs>
  <rect width="100%" height="100%" fill="url(#bg)"/>
  ${shapes.join("\n  ")}
  ${label}
</svg>`;
}

for (const p of projects) {
  const dir = path.join(root, "public/projects", p.slug);
  fs.mkdirSync(dir, { recursive: true });
  const jobs = [
    ["cover.webp", 0, 1600, 1000],
    ["1.webp", 1, 1600, 1000],
    ["2.webp", 2, 1200, 1500],
    ["3.webp", 3, 1600, 1000],
  ];
  for (const [file, v, w, h] of jobs) {
    await sharp(Buffer.from(art(p, v, w, h))).webp({ quality: 78 }).toFile(path.join(dir, file));
  }
  console.log("✓", p.slug);
}
