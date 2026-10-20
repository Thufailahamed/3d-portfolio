/**
 * Measures each car of the line-up for the crash lab: its plan rectangle, the real surface round
 * every height band (how far in from the rectangle the outermost skin sits, per perimeter sample)
 * and the rest bounds of every Part_<id> group. Writes src/crash/data/outlines.ts, and an SVG of the
 * outlines per band for checking by eye.
 *
 * The triangles are sampled every 2 cm (some bodies have only a few thousand vertices, too sparse to
 * bin directly), each point is projected onto the plan rectangle exactly as the solver and the shader
 * do (src/crash/sim/geometry.ts), and the outermost point of each (band, sample) bin is the surface.
 *
 * Needs glTF-Transform and the Draco decoder, which the site does not depend on:
 *   npm i --no-save @gltf-transform/core @gltf-transform/extensions draco3dgltf
 * (or point GLTF_MODULES at a node_modules folder that has them), then
 *   node scripts/crash/outlines.mjs [svg-out-dir]
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { load } from "./ts.mjs";

const req = createRequire(process.env.GLTF_MODULES ? join(resolve(process.env.GLTF_MODULES), "x.js") : import.meta.url);
const imp = (name) => import(pathToFileURL(req.resolve(name)).href);
const { NodeIO } = await imp("@gltf-transform/core");
const { ALL_EXTENSIONS } = await imp("@gltf-transform/extensions");
const draco3d = (await imp("draco3dgltf")).default;

// the crash lab's own geometry, transpiled from the TypeScript the page runs
const geo = await load("crash/sim/geometry.ts");
const types = await load("crash/sim/types.ts");
const { NB, NS, NO_SURFACE, BAND_EDGES } = types;

const CARS = [
  ["lykan-hypersport", "public/models/lykan.glb"],
  ["jaguar-xj13", "public/models/cars/jaguar-xj13.glb"],
  ["toyota-land-cruiser", "public/models/cars/toyota-land-cruiser.glb"],
  ["ferrari-f40", "public/models/cars/ferrari-f40.glb"],
  ["ferrari-f40-liberty-walk", "public/models/cars/ferrari-f40-lb.glb"],
  ["aston-martin-vulcan", "public/models/cars/aston-martin-vulcan.glb"],
  ["toyota-supra-gt300", "public/models/cars/toyota-supra-gt300.glb"],
];
const STEP = 0.02;

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ "draco3d.decoder": await draco3d.createDecoderModule() });

const out = {};
for (const [slug, file] of CARS) {
  const doc = await io.read(file);
  const scene = doc.getRoot().getDefaultScene() ?? doc.getRoot().listScenes()[0];
  // every mesh node with the Part_ group it belongs to
  const meshes = [];
  const walk = (node, part) => {
    const name = node.getName();
    const p = name.startsWith("Part_") ? name.slice(5) : part;
    if (node.getMesh()) meshes.push({ node, part: p ?? "(none)" });
    for (const c of node.listChildren()) walk(c, p);
  };
  for (const n of scene.listChildren()) walk(n, null);

  const parts = {};
  const pts = []; // sampled surface points: x, y, z
  const grow = (id, x, y, z) => {
    const b = (parts[id] ??= [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity]);
    if (x < b[0]) b[0] = x;
    if (y < b[1]) b[1] = y;
    if (z < b[2]) b[2] = z;
    if (x > b[3]) b[3] = x;
    if (y > b[4]) b[4] = y;
    if (z > b[5]) b[5] = z;
  };
  for (const { node, part } of meshes) {
    const m = node.getWorldMatrix();
    const tf = (a, o) => {
      o[0] = m[0] * a[0] + m[4] * a[1] + m[8] * a[2] + m[12];
      o[1] = m[1] * a[0] + m[5] * a[1] + m[9] * a[2] + m[13];
      o[2] = m[2] * a[0] + m[6] * a[1] + m[10] * a[2] + m[14];
      return o;
    };
    for (const prim of node.getMesh().listPrimitives()) {
      const pos = prim.getAttribute("POSITION");
      if (!pos) continue;
      const n = pos.getCount();
      const v = new Float32Array(n * 3);
      const a = [0, 0, 0], o = [0, 0, 0];
      for (let i = 0; i < n; i++) {
        pos.getElement(i, a);
        tf(a, o);
        v[i * 3] = o[0];
        v[i * 3 + 1] = o[1];
        v[i * 3 + 2] = o[2];
        grow(part, o[0], o[1], o[2]);
      }
      const idx = prim.getIndices();
      const tri = idx ? idx.getArray() : Uint32Array.from({ length: n }, (_, i) => i);
      for (let t = 0; t + 2 < tri.length; t += 3) {
        const i0 = tri[t] * 3, i1 = tri[t + 1] * 3, i2 = tri[t + 2] * 3;
        const ax = v[i0], ay = v[i0 + 1], az = v[i0 + 2];
        const ex = v[i1] - ax, ey = v[i1 + 1] - ay, ez = v[i1 + 2] - az;
        const fx = v[i2] - ax, fy = v[i2 + 1] - ay, fz = v[i2 + 2] - az;
        const k = Math.max(1, Math.ceil(Math.max(Math.hypot(ex, ey, ez), Math.hypot(fx, fy, fz)) / STEP));
        for (let i = 0; i <= k; i++)
          for (let j = 0; i + j <= k; j++) {
            const s = i / k, r = j / k;
            pts.push(ax + ex * s + fx * r, ay + ey * s + fy * r, az + ez * s + fz * r);
          }
      }
    }
  }

  // the plan rectangle: the footprint's bounds, corners rounded like a car's in plan
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  for (let i = 0; i < pts.length; i += 3) {
    if (pts[i + 1] < BAND_EDGES[0]) continue;
    x0 = Math.min(x0, pts[i]);
    x1 = Math.max(x1, pts[i]);
    z0 = Math.min(z0, pts[i + 2]);
    z1 = Math.max(z1, pts[i + 2]);
  }
  const hx = (x1 - x0) / 2, hz = (z1 - z0) / 2;
  const plan = { hx: r3(hx), hz: r3(hz), rc: r3(Math.min(0.6, Math.max(0.3, hz * 0.42))), cx: r3((x0 + x1) / 2), cz: r3((z0 + z1) / 2) };

  // the outermost skin per (band, sample)
  const e = new Float32Array(NB * NS).fill(NO_SURFACE);
  const pr = { u: 0, d: 0, nx: 0, nz: 0 };
  for (let i = 0; i < pts.length; i += 3) {
    const b = geo.bandIndex(pts[i + 1]);
    if (b < 0) continue;
    geo.project(plan, pts[i], pts[i + 2], pr);
    const s = Math.round(pr.u * NS) % NS;
    const k = b * NS + s;
    if (pr.d < e[k]) e[k] = Math.max(0, pr.d);
  }
  // short gaps (a bin between two sparse points) take their neighbours' depth
  for (let b = 0; b < NB; b++) {
    const row = e.subarray(b * NS, (b + 1) * NS);
    const filled = Float32Array.from(row);
    for (let s = 0; s < NS; s++) {
      if (row[s] < NO_SURFACE) continue;
      for (let w = 1; w <= 3; w++) {
        const l = row[(s - w + NS) % NS], r = row[(s + w) % NS];
        if (l < NO_SURFACE && r < NO_SURFACE) {
          filled[s] = (l + r) / 2;
          break;
        }
      }
    }
    row.set(filled);
  }

  for (const id of Object.keys(parts)) parts[id] = parts[id].map(r3);
  out[slug] = { plan, surface: Array.from(e, r3), parts };
  const missing = e.reduce((n, x) => n + (x >= NO_SURFACE ? 1 : 0), 0);
  console.log(`${slug.padEnd(26)} plan ${JSON.stringify(plan)}  points ${(pts.length / 3) | 0}  empty bins ${missing}/${NB * NS}`);
}

const ts = `/**
 * Generated by scripts/crash/outlines.mjs from the GLBs in public/models: do not edit by hand.
 * Per car: the plan rectangle (see sim/geometry.ts), the inward depth of the real surface from it
 * for every (band, sample) of the crush grid (NB × NS, row = band; ${NO_SURFACE} = nothing there), and the rest
 * bounds of every Part_<id> group ([min x, y, z, max x, y, z], car frame, m).
 */
import type { Plan } from "../sim/types";

export type Outline = { plan: Plan; surface: number[]; parts: Record<string, [number, number, number, number, number, number]> };

export const outlines: Record<string, Outline> = ${JSON.stringify(out)};
`;
mkdirSync("src/crash/data", { recursive: true });
writeFileSync("src/crash/data/outlines.ts", ts);
console.log(`wrote src/crash/data/outlines.ts (${(ts.length / 1024).toFixed(0)} KB)`);

// an SVG per car: the plan rectangle and the real outline of every band, for checking by eye
const svgDir = process.argv[2];
if (svgDir) {
  mkdirSync(svgDir, { recursive: true });
  const colours = ["#4a5bd8", "#3b8de0", "#25b8d0", "#2ac48a", "#7cc53b", "#d6c22a", "#f0902a", "#e85a2c", "#d6306a", "#a43ad0"];
  for (const [slug, o] of Object.entries(out)) {
    const S = 140, W = 1000, H = 520;
    const px = (x) => W / 2 + x * S, pz = (z) => H / 2 + z * S;
    let body = "";
    const bp = { x: 0, z: 0, nx: 0, nz: 0 };
    const rr = [];
    for (let i = 0; i <= 400; i++) {
      geo.pointAt(o.plan, i / 400, bp);
      rr.push(`${px(bp.x).toFixed(1)},${pz(bp.z).toFixed(1)}`);
    }
    body += `<polyline points="${rr.join(" ")}" fill="none" stroke="#999" stroke-dasharray="4 4"/>`;
    for (let b = 0; b < NB; b++) {
      const seg = [];
      for (let s = 0; s <= NS; s++) {
        const d = o.surface[b * NS + (s % NS)];
        if (d >= NO_SURFACE) {
          if (seg.length) body += `<polyline points="${seg.join(" ")}" fill="none" stroke="${colours[b]}" stroke-width="1.4"/>`;
          seg.length = 0;
          continue;
        }
        geo.pointAt(o.plan, s / NS, bp);
        seg.push(`${px(bp.x - bp.nx * d).toFixed(1)},${pz(bp.z - bp.nz * d).toFixed(1)}`);
      }
      if (seg.length) body += `<polyline points="${seg.join(" ")}" fill="none" stroke="${colours[b]}" stroke-width="1.4"/>`;
      body += `<text x="10" y="${20 + b * 16}" fill="${colours[b]}" font-size="12" font-family="monospace">${BAND_EDGES[b]}–${BAND_EDGES[b + 1]} m</text>`;
    }
    for (const [id, bx] of Object.entries(o.parts)) {
      if (!/engine|wheel|seats|steering|dashboard/.test(id)) continue;
      body += `<rect x="${px(bx[0])}" y="${pz(bx[2])}" width="${(bx[3] - bx[0]) * S}" height="${(bx[5] - bx[2]) * S}" fill="none" stroke="#fff" stroke-opacity="0.35"/>`;
    }
    writeFileSync(join(svgDir, `${slug}.svg`), `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}"><rect width="100%" height="100%" fill="#111"/><text x="${W - 10}" y="20" fill="#ccc" font-size="13" text-anchor="end" font-family="monospace">${slug} (nose → right, +z down)</text>${body}</svg>`);
  }
  console.log(`svgs in ${svgDir}`);
}

function r3(x) {
  return Math.round(x * 1000) / 1000;
}
