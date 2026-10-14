/**
 * Imports the six SynapX project screenshots into public/projects/<slug>/:
 *   cover.webp (1600×1000) from each live-site screenshot.
 *
 *   node scripts/import-synapx.mjs [path/to/SynapX]
 */
import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const synapx = path.resolve(process.argv[2] ?? path.join(root, "..", "SynapX"));

const sources = {
  "school-system": "lms.webp",
  "legal-workspace": "legal.webp",
  luxe: "luxe.webp",
  goldos: "goldos.webp",
  vyro: "vyro.webp",
  healthhub: "healthhub.webp",
};

for (const [slug, file] of Object.entries(sources)) {
  const input = path.join(synapx, "public", "work", file);
  const outDir = path.join(root, "public", "projects", slug);
  fs.mkdirSync(outDir, { recursive: true });
  await sharp(input).resize(1600, 1000, { fit: "cover", position: "top" }).webp({ quality: 84 }).toFile(path.join(outDir, "cover.webp"));
  console.log("imported", slug);
}
