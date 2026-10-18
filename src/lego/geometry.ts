import * as THREE from "three";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import type { Piece } from "./layout";
import { BEVEL, GAP, PLATE, STUD_H, STUD_R } from "./units";

const flat = (g: THREE.BufferGeometry) => (g.index ? g.toNonIndexed() : g);

/**
 * A stud: a short cylinder whose top edge is softly chamfered, the way the mould leaves it.
 * It starts a little below zero so it seats into the bevel of the face it stands on.
 */
export function studGeometry(segments = 24, r = STUD_R, h = STUD_H, detail = true) {
  // bottom to top, so the lathe's normals face outwards; the rounded chamfer is a single facet
  // when `detail` is off (a stud is a few pixels across: thousands of them add up)
  const pts = detail
    ? [new THREE.Vector2(r, -0.03), new THREE.Vector2(r, h - 0.04), new THREE.Vector2(r - 0.012, h - 0.01), new THREE.Vector2(r - 0.04, h), new THREE.Vector2(0.0001, h)]
    : [new THREE.Vector2(r, -0.03), new THREE.Vector2(r, h - 0.035), new THREE.Vector2(r - 0.035, h), new THREE.Vector2(0.0001, h)];
  return new THREE.LatheGeometry(pts, segments);
}

/** A cylinder with rounded rims (round bricks and plates). */
function roundBody(radius: number, height: number, segments = 40) {
  const b = Math.min(BEVEL, height / 4);
  const hh = height / 2;
  const pts: THREE.Vector2[] = [new THREE.Vector2(0.0001, -hh)];
  for (let i = 0; i <= 3; i++) {
    const a = (i / 3) * (Math.PI / 2);
    pts.push(new THREE.Vector2(radius - b + Math.sin(a) * b, -hh + b - Math.cos(a) * b));
  }
  for (let i = 0; i <= 3; i++) {
    const a = (i / 3) * (Math.PI / 2);
    pts.push(new THREE.Vector2(radius - b + Math.cos(a) * b, hh - b + Math.sin(a) * b));
  }
  pts.push(new THREE.Vector2(0.0001, hh));
  return new THREE.LatheGeometry(pts, segments);
}

type Shape = Pick<Piece, "w" | "d" | "h" | "studs" | "round"> & { under?: boolean };
export const geometryKey = (p: Shape) => `${p.w}x${p.d}x${p.h}${p.studs ? "" : "t"}${p.round ? "r" : ""}${p.under === false ? "s" : ""}`;

const cache = new Map<string, THREE.BufferGeometry>();

/** Drop the triangles a predicate picks out (geometry must be non-indexed). */
function dropTriangles(g: THREE.BufferGeometry, drop: (ys: number[], ny: number) => boolean) {
  const pos = g.attributes.position;
  const nrm = g.attributes.normal;
  const keep: number[] = [];
  for (let t = 0; t < pos.count; t += 3) {
    const ys = [pos.getY(t), pos.getY(t + 1), pos.getY(t + 2)];
    if (!drop(ys, nrm.getY(t))) keep.push(t);
  }
  const out = new THREE.BufferGeometry();
  for (const name of ["position", "normal", "uv"] as const) {
    const src = g.attributes[name] as THREE.BufferAttribute;
    const n = src.itemSize;
    const arr = new Float32Array(keep.length * 3 * n);
    keep.forEach((t, k) => arr.set((src.array as Float32Array).subarray(t * n, (t + 3) * n), k * 3 * n));
    out.setAttribute(name, new THREE.BufferAttribute(arr, n));
  }
  return out;
}

/** Turn a closed shape inside out, so it is seen from within (a cavity). */
function inside(g: THREE.BufferGeometry) {
  for (const name of ["position", "normal", "uv"] as const) {
    const a = g.attributes[name] as THREE.BufferAttribute;
    const n = a.itemSize;
    const arr = a.array as Float32Array;
    for (let t = 0; t < a.count; t += 3) {
      for (let k = 0; k < n; k++) {
        const i1 = (t + 1) * n + k;
        const i2 = (t + 2) * n + k;
        [arr[i1], arr[i2]] = [arr[i2], arr[i1]];
      }
    }
  }
  const nrm = g.attributes.normal.array as Float32Array;
  for (let i = 0; i < nrm.length; i++) nrm[i] = -nrm[i];
  return g;
}

/**
 * The underside of a brick, as moulded: a hollow shell with walls 1.2 mm thick, and the tubes the
 * studs below clip into (thin pins on one-wide pieces). Only seen when a piece tumbles — which is
 * exactly when a solid block would give the game away.
 */
function underside(w: number, d: number, H: number) {
  const parts: THREE.BufferGeometry[] = [];
  const ow = w - GAP;
  const od = d - GAP;
  const hh = (H - GAP * 0.5) / 2;
  const wall = 0.15;
  const top = Math.min(0.13, H * 0.3);
  const iw = ow - wall * 2;
  const id = od - wall * 2;
  const ih = H - GAP * 0.5 - top;
  // the cavity, seen from inside, open at the bottom
  const cavity = dropTriangles(flat(new THREE.BoxGeometry(iw, ih, id)), (_, ny) => ny < -0.5);
  cavity.translate(0, -hh + ih / 2, 0);
  parts.push(inside(cavity));
  // the rim between the outer bevel and the inner wall, facing down
  const rx = ow / 2 - BEVEL;
  const rz = od / 2 - BEVEL;
  const shape = new THREE.Shape([new THREE.Vector2(-rx, -rz), new THREE.Vector2(rx, -rz), new THREE.Vector2(rx, rz), new THREE.Vector2(-rx, rz)]);
  shape.holes.push(new THREE.Path([new THREE.Vector2(-iw / 2, -id / 2), new THREE.Vector2(-iw / 2, id / 2), new THREE.Vector2(iw / 2, id / 2), new THREE.Vector2(iw / 2, -id / 2)]));
  const rim = flat(new THREE.ShapeGeometry(shape));
  rim.rotateX(Math.PI / 2);
  rim.translate(0, -hh, 0);
  parts.push(rim);
  // tubes between the studs (or pins, on a one-wide piece)
  const y = -hh + ih / 2;
  if (w >= 2 && d >= 2) {
    const outer = flat(new THREE.CylinderGeometry(0.325, 0.325, ih, 12, 1, true));
    const inner = inside(flat(new THREE.CylinderGeometry(0.24, 0.24, ih, 10, 1, true)));
    const ring = flat(new THREE.RingGeometry(0.24, 0.325, 12));
    ring.rotateX(Math.PI / 2);
    ring.translate(0, -ih / 2, 0);
    for (let i = 1; i < w; i++)
      for (let j = 1; j < d; j++)
        for (const g of [outer, inner, ring]) {
          const c = g.clone();
          c.translate(i - w / 2, y, j - d / 2);
          parts.push(c);
        }
  } else if (w * d >= 2) {
    const pin = flat(new THREE.CylinderGeometry(0.16, 0.16, ih, 10, 1, false));
    for (let i = 1; i < Math.max(w, d); i++) {
      const c = pin.clone();
      if (w > d) c.translate(i - w / 2, y, 0);
      else c.translate(0, y, i - d / 2);
      parts.push(c);
    }
  }
  return parts;
}

/**
 * One piece: a beveled body (shrunk by the seam gap so neighbours read as separate pieces) with
 * its studs on top and a hollow, tubed underside, centred on its own middle so it maps straight
 * onto its rigid body.
 */
export function pieceGeometry(p: Shape) {
  const key = geometryKey(p);
  const hit = cache.get(key);
  if (hit) return hit;
  const H = p.h * PLATE;
  const parts: THREE.BufferGeometry[] = [];
  if (p.round) parts.push(flat(roundBody(p.w / 2 - GAP / 2, H - GAP * 0.5)));
  else {
    const hh = (H - GAP * 0.5) / 2;
    // the outer shell without its flat bottom, which the underside replaces
    // the outer shell; its flat bottom is replaced by the hollow underside — unless the piece is
    // standing in a build, where nobody can see beneath it
    const shell = flat(new RoundedBoxGeometry(p.w - GAP, H - GAP * 0.5, p.d - GAP, p.under === false ? 1 : 2, BEVEL));
    if (p.under === false) parts.push(dropTriangles(shell, (ys) => ys.every((y) => y < -hh + 1e-4)));
    else {
      parts.push(dropTriangles(shell, (ys) => ys.every((y) => y < -hh + 1e-4)));
      parts.push(...underside(p.w, p.d, H));
    }
  }
  if (p.studs) {
    const stud = flat(studGeometry(p.w * p.d > 8 ? 12 : 14, STUD_R, STUD_H, false));
    for (let i = 0; i < p.w; i++)
      for (let j = 0; j < p.d; j++) {
        const s = stud.clone();
        s.translate(i - (p.w - 1) / 2, H / 2 - GAP * 0.25, j - (p.d - 1) / 2);
        parts.push(s);
      }
  }
  for (const g of parts) {
    // keep every part identical in layout so they merge
    g.clearGroups();
    for (const name of Object.keys(g.attributes)) if (!["position", "normal", "uv"].includes(name)) g.deleteAttribute(name);
  }
  const merged = mergeGeometries(parts, false)!;
  merged.computeBoundingSphere();
  cache.set(key, merged);
  return merged;
}

/** Window glass: dark and mirror-smooth by day; `lit` panes glow warm at night. */
export function glassMaterial(lit: boolean) {
  return new THREE.MeshPhysicalMaterial({
    color: 0xffffff,
    roughness: 0.06,
    metalness: 0.1,
    clearcoat: 1,
    clearcoatRoughness: 0.05,
    envMapIntensity: 1.5,
    emissive: lit ? new THREE.Color("#ffc874") : new THREE.Color(0x000000),
    emissiveIntensity: 0,
  });
}

/** Lamp heads and lights: pale translucent-looking plastic that glows after dark. */
export function glowMaterial() {
  return new THREE.MeshPhysicalMaterial({
    color: 0xffffff,
    roughness: 0.15,
    clearcoat: 1,
    clearcoatRoughness: 0.1,
    transmission: 0,
    emissive: new THREE.Color("#ffe3a6"),
    emissiveIntensity: 0,
  });
}

/** the wear map's mid-grey: roughness values below are divided by it, so an untouched patch reads as before */
const WEAR_MID = 0.62;
let wear: THREE.CanvasTexture | null = null;

/**
 * Handling wear for the plastic's roughness: bricks that have been played with are never
 * perfectly glossy. Soft smudges, the odd fingerprint whorl and hairline scratches, all faint,
 * so the reflections break up the way they do on a real, handled piece.
 */
function wearMap() {
  if (wear || typeof document === "undefined") return wear;
  const S = 512;
  const c = document.createElement("canvas");
  c.width = c.height = S;
  const ctx = c.getContext("2d")!;
  const mid = Math.round(WEAR_MID * 255);
  ctx.fillStyle = `rgb(${mid},${mid},${mid})`;
  ctx.fillRect(0, 0, S, S);
  let seed = 23;
  const rand = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
  // smudges: broad, soft, a little rougher than the surface round them
  for (let i = 0; i < 14; i++) {
    const x = rand() * S;
    const y = rand() * S;
    const r = 30 + rand() * 90;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, `rgba(255,255,255,${0.05 + rand() * 0.07})`);
    g.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = g;
    ctx.fillRect(x - r, y - r, r * 2, r * 2);
  }
  // fingerprints: tight whorls of ridges
  ctx.lineWidth = 1.1;
  for (let i = 0; i < 4; i++) {
    const x = rand() * S;
    const y = rand() * S;
    const rot = rand() * Math.PI;
    const k = 0.55 + rand() * 0.25;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(rot);
    for (let r = 3; r < 34; r += 2.6) {
      ctx.strokeStyle = `rgba(255,255,255,${0.09 * (1 - r / 40)})`;
      ctx.beginPath();
      ctx.ellipse(0, 0, r, r * k, 0, rand() * 0.6, Math.PI * 2 - rand() * 0.8);
      ctx.stroke();
    }
    ctx.restore();
  }
  // hairline scratches
  for (let i = 0; i < 70; i++) {
    const x = rand() * S;
    const y = rand() * S;
    const a = rand() * Math.PI * 2;
    const l = 8 + rand() * rand() * 120;
    ctx.strokeStyle = `rgba(255,255,255,${0.06 + rand() * 0.12})`;
    ctx.lineWidth = 0.5 + rand() * 0.7;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.quadraticCurveTo(x + Math.cos(a) * l * 0.5 + (rand() - 0.5) * 6, y + Math.sin(a) * l * 0.5 + (rand() - 0.5) * 6, x + Math.cos(a) * l, y + Math.sin(a) * l);
    ctx.stroke();
  }
  // and a fine grain over all of it
  const img = ctx.getImageData(0, 0, S, S);
  for (let i = 0; i < img.data.length; i += 4) {
    const n = (rand() - 0.5) * 10;
    img.data[i] = img.data[i + 1] = img.data[i + 2] = Math.max(0, Math.min(255, img.data[i + 1] + n));
  }
  ctx.putImageData(img, 0, 0);
  wear = new THREE.CanvasTexture(c);
  wear.colorSpace = THREE.NoColorSpace;
  wear.anisotropy = 4;
  return wear;
}

/** The shared ABS plastic: smooth, glossy, with a clear-coat sheen that catches the sky (and the marks of being handled). */
export function plasticMaterial() {
  const map = wearMap();
  return new THREE.MeshPhysicalMaterial({
    color: 0xffffff,
    roughness: map ? 0.24 / WEAR_MID : 0.24,
    roughnessMap: map,
    metalness: 0,
    clearcoat: 0.55,
    clearcoatRoughness: map ? 0.2 / WEAR_MID : 0.2,
    clearcoatRoughnessMap: map,
    specularIntensity: 0.6,
    ior: 1.46,
    envMapIntensity: 0.85,
  });
}
