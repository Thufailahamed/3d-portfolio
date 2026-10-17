"use client";

import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo } from "react";
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { FLOW_ORIGIN } from "@/lib/chapters";
import { realState } from "../real/realState";
import { HeatKind } from "../thermal/heat";
import { Wire, glowFrag, glowVert, useRealLib } from "./FlowGalleryDetails";

/**
 * Architectural fit-out of the pavilion's walls and entrance, in the same hidden-line
 * blueprint language as the model:
 *
 * - ashlar masonry (rusticated base courses) on the facade and the hall's walls
 * - a classical door surround: architrave, pilasters, frieze inscription, cornice, pediment,
 *   consoles, threshold, open bronze double doors, wall lanterns, plaques and urns
 * - framed, lit windows with sills and hoods along both wings
 * - coffered ceilings over the portico and the wing colonnades
 * - marble paving on the portico and in the hall, and a runner carpet through the door
 * - skirting, chair rail, dado panels and a dentilled cornice inside the hall
 */

/** Facade front face, door opening and the hall's inner wall face (pavilion-local). */
const FACADE_Z = -0.7;
const FACADE_BACK_Z = -1.3;
const DOOR_X = 1.1;
const DOOR_TOP = 4.68;
const FLOOR = 0.88;
const WALL_TOP = 8.83;
const HALL_WALL_X = 7.5;
const HALL_END_Z = -37;
const WINDOW_X = [9.5, 12.9, 16.3, 19.7, 23.1];
/** Plain wall runs inside the hall between the niches (z ranges). */
const HALL_SPANS: [number, number][] = [
  [-1.3, -4.58],
  [-9.42, -14.58],
  [-19.42, -24.58],
  [-29.42, -37],
];

/** Colliders for the first-person walker: urn pedestals and the door surround / leaves. */
export const ARCH_CIRCLES = [
  { x: -5.3, z: -0.1, r: 0.45 },
  { x: 5.3, z: -0.1, r: 0.45 },
];
export const ARCH_BOXES = [
  { x0: -2.32, x1: -1.17, z0: -0.72, z1: -0.42 },
  { x0: 1.17, x1: 2.32, z0: -0.72, z1: -0.42 },
  { x0: -1.2, x1: -0.88, z0: -2.42, z1: -1.28 },
  { x0: 0.88, x1: 1.2, z0: -2.42, z1: -1.28 },
];

// ---------------------------------------------------------------- shaders

const worldVert = /* glsl */ `
  varying vec3 vW;
  varying vec2 vUv;
  void main() {
    vUv = uv;
    vec4 w = modelMatrix * vec4(position, 1.0);
    vW = w.xyz;
    gl_Position = projectionMatrix * viewMatrix * w;
  }
`;

const NOISE = /* glsl */ `
  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float noise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
  }
  float fbm(vec2 p) {
    float v = 0.0;
    float a = 0.5;
    for (int i = 0; i < 4; i++) { v += a * noise(p); p *= 2.03; a *= 0.5; }
    return v;
  }
`;

// Ashlar masonry: staggered courses, per-block tone, rusticated (chamfered) base courses
const masonryFrag = /* glsl */ `
  uniform vec3 uOrigin;
  uniform vec2 uAxis;
  uniform float uBase;
  uniform float uJoint;
  varying vec3 vW;
  ${NOISE}
  void main() {
    vec3 p = vW - uOrigin;
    float u = dot(p.xz, uAxis);
    float y = p.y - ${FLOOR.toFixed(2)};
    bool rustic = y < uBase;
    float ch = rustic ? 0.62 : 0.46;
    float bl = rustic ? 1.5 : 1.15;
    float yy = rustic ? y : y - uBase;
    float row = floor(yy / ch);
    float uu = u / bl + mod(row, 2.0) * 0.5;
    vec2 cell = vec2(floor(uu), row + (rustic ? 97.0 : 0.0));
    vec2 f = vec2(fract(uu) * bl, fract(yy / ch) * ch);
    vec2 d = min(f, vec2(bl, ch) - f);
    float e = min(d.x, d.y);
    float fw = max(fwidth(u), fwidth(y));
    float w = rustic ? 0.028 : 0.011;
    float joint = 1.0 - smoothstep(w, w + fw * 1.5, e);
    // joints dissolve before they can shimmer in the distance
    joint *= 1.0 - smoothstep(0.03, 0.09, fw);

    float tone = hash(cell);
    vec3 col = vec3(0.020, 0.022, 0.028) * (0.72 + tone * 0.56);
    col *= 0.9 + 0.2 * fbm(p.xy * 3.0 + p.zy * 3.0 + cell);
    if (rustic) col *= 0.7 + 0.3 * smoothstep(0.0, 0.07, e); // chamfered arrises read darker
    col = mix(col, vec3(0.30, 0.34, 0.42), joint * uJoint);
    gl_FragColor = vec4(col, 1.0);
  }
`;

// Polished stone paving: two-tone marble chequer, veining, fine joints and a soft sheen
const marbleFrag = /* glsl */ `
  uniform vec3 uOrigin;
  uniform float uTile;
  uniform float uSheen;
  varying vec3 vW;
  ${NOISE}
  void main() {
    vec2 p = (vW - uOrigin).xz;
    vec2 t = p / uTile;
    vec2 id = floor(t);
    vec2 f = fract(t);
    float checker = mod(id.x + id.y, 2.0);
    vec3 col = mix(vec3(0.014, 0.016, 0.021), vec3(0.04, 0.043, 0.05), checker);
    float n = fbm(p * 0.8 + id * 3.7);
    float vein = 1.0 - smoothstep(0.0, 0.05, abs(sin(p.x * 0.9 + p.y * 0.55 + n * 6.0)));
    col += vec3(0.22, 0.23, 0.26) * vein * mix(0.05, 0.11, checker);
    col *= 0.88 + 0.24 * n;
    vec2 d = min(f, 1.0 - f) * uTile;
    vec2 fw = fwidth(p);
    float j = 1.0 - smoothstep(0.005, 0.005 + max(fw.x, fw.y) * 1.5, min(d.x, d.y));
    j *= 1.0 - smoothstep(0.03, 0.08, max(fw.x, fw.y));
    col = mix(col, vec3(0.17, 0.19, 0.23), j * 0.6);
    // the skylight's long reflection down the middle of the polished floor
    col += vec3(0.05, 0.055, 0.07) * uSheen * exp(-p.x * p.x * 0.3);
    gl_FragColor = vec4(col, 1.0);
  }
`;

// Runner carpet: deep crimson pile, darker selvedge and a fine gold border line
const carpetFrag = /* glsl */ `
  uniform vec2 uSize;
  varying vec2 vUv;
  ${NOISE}
  void main() {
    vec2 m = vUv * uSize;
    float bx = min(m.x, uSize.x - m.x);
    vec3 col = vec3(0.085, 0.014, 0.018);
    col *= 0.82 + 0.18 * hash(floor(m * 55.0));
    col *= 0.9 + 0.1 * fbm(m * 1.5);
    if (bx < 0.1) col *= 0.62;
    float border = smoothstep(0.115, 0.125, bx) - smoothstep(0.14, 0.15, bx);
    col = mix(col, vec3(0.62, 0.5, 0.27), border * 0.85);
    // end fringe
    float ends = min(m.y, uSize.y - m.y);
    col *= smoothstep(0.0, 0.06, ends) * 0.4 + 0.6;
    gl_FragColor = vec4(col, 1.0);
  }
`;

// Window glazing: warm interior light behind a 2×4 muntin grid, with a cool sky reflection
const glassFrag = /* glsl */ `
  uniform float uSeed;
  varying vec2 vUv;
  ${NOISE}
  void main() {
    vec2 g = vUv * vec2(2.0, 4.0);
    vec2 id = floor(g);
    vec2 f = fract(g);
    vec2 d = min(f, 1.0 - f) * vec2(0.54, 0.92);
    float muntin = 1.0 - smoothstep(0.016, 0.026, min(d.x, d.y));
    float edge = min(min(vUv.x, 1.0 - vUv.x) * 1.08, min(vUv.y, 1.0 - vUv.y) * 3.7);
    float frame = 1.0 - smoothstep(0.035, 0.05, edge);
    vec3 warm = vec3(1.0, 0.84, 0.62) * (0.1 + 0.12 * (1.0 - vUv.y)) * (0.75 + 0.5 * hash(id + uSeed));
    // a curtain half-drawn in some panes
    warm *= mix(1.0, 0.45, step(0.62, hash(vec2(uSeed, id.y))) * smoothstep(0.3, 0.5, f.x));
    float refl = smoothstep(0.35, 0.0, abs(vUv.x - vUv.y * 0.45 - 0.25)) * 0.05;
    vec3 col = warm + vec3(0.6, 0.7, 0.9) * refl;
    col = mix(col, vec3(0.012, 0.013, 0.016), max(muntin, frame));
    gl_FragColor = vec4(col, 1.0);
  }
`;

/**
 * Weathered stone for the model's own stylobate and steps: same paving language as the
 * portico, pushed back with polygon offset so the building's edge lines stay on top.
 */
export function makeStoneMaterial() {
  return new THREE.ShaderMaterial({
    vertexShader: worldVert,
    fragmentShader: marbleFrag,
    uniforms: {
      uOrigin: { value: new THREE.Vector3(...FLOW_ORIGIN) },
      uTile: { value: 1.1 },
      uSheen: { value: 0 },
    },
    polygonOffset: true,
    polygonOffsetFactor: 1,
    polygonOffsetUnits: 1,
  });
}

// ---------------------------------------------------------------- geometry helpers

/** Position-only, non-indexed copy so boxes, lathes and extrusions can be merged together. */
function bare(g: THREE.BufferGeometry) {
  const src = g.index ? g.toNonIndexed() : g;
  const out = new THREE.BufferGeometry();
  out.setAttribute("position", src.getAttribute("position").clone());
  if (src !== g) src.dispose();
  g.dispose();
  return out;
}

/** Box of size (w, h, d) centred at (x, y, z). */
const box = (w: number, h: number, d: number, x: number, y: number, z: number) =>
  bare(new THREE.BoxGeometry(w, h, d).translate(x, y, z));

const merge = (parts: THREE.BufferGeometry[]) => {
  const g = mergeGeometries(parts)!;
  parts.forEach((p) => p.dispose());
  return g;
};

/** Lines for a coffered ceiling at height y: beams hanging 0.14 below it, inset coffers, mitres and rosettes. */
function cofferLines(out: number[], x0: number, x1: number, z0: number, z1: number, y: number, cell: number) {
  const nx = Math.max(1, Math.round((x1 - x0) / cell));
  const nz = Math.max(1, Math.round((z1 - z0) / cell));
  const cx = (x1 - x0) / nx;
  const cz = (z1 - z0) / nz;
  const seg = (a: number[], b: number[]) => out.push(...a, ...b);
  const yb = y - 0.14; // beam soffits
  for (let i = 0; i <= nx; i++) seg([x0 + i * cx, yb, z0], [x0 + i * cx, yb, z1]);
  for (let j = 0; j <= nz; j++) seg([x0, yb, z0 + j * cz], [x1, yb, z0 + j * cz]);
  const ins = Math.min(cx, cz) * 0.17;
  for (let i = 0; i < nx; i++) {
    for (let j = 0; j < nz; j++) {
      const ax = x0 + i * cx;
      const az = z0 + j * cz;
      const yi = y - 0.004; // coffer back, on the ceiling
      const a = [ax + ins, yi, az + ins];
      const b = [ax + cx - ins, yi, az + ins];
      const c = [ax + cx - ins, yi, az + cz - ins];
      const d = [ax + ins, yi, az + cz - ins];
      seg(a, b);
      seg(b, c);
      seg(c, d);
      seg(d, a);
      seg([ax, yb, az], a);
      seg([ax + cx, yb, az], b);
      seg([ax + cx, yb, az + cz], c);
      seg([ax, yb, az + cz], d);
      // rosette
      const mx = ax + cx / 2;
      const mz = az + cz / 2;
      const r = Math.min(cx, cz) * 0.12;
      for (let k = 0; k < 8; k++) {
        const t0 = (k / 8) * Math.PI * 2;
        const t1 = ((k + 1) / 8) * Math.PI * 2;
        seg([mx + Math.cos(t0) * r, yi, mz + Math.sin(t0) * r], [mx + Math.cos(t1) * r, yi, mz + Math.sin(t1) * r]);
      }
    }
  }
}

function textTexture(lines: { text: string; size: number; weight?: number; color?: string; spacing?: number }[], w: number, h: number, bg?: string) {
  if (typeof document === "undefined") return null;
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  if (bg) {
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, w, h);
  }
  const total = lines.reduce((s, l) => s + l.size * 1.35, 0);
  let y = (h - total) / 2;
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  for (const l of lines) {
    ctx.font = `${l.weight ?? 600} ${l.size}px "Cormorant Garamond", "Times New Roman", serif`;
    ctx.fillStyle = l.color ?? "#e9e4d8";
    const spaced = l.text.split("").join(l.spacing ? " ".repeat(l.spacing) : "");
    ctx.fillText(spaced, w / 2, y, w * 0.94);
    y += l.size * 1.35;
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

// ---------------------------------------------------------------- component

export default function FlowArchitecture() {
  const origin = useMemo(() => new THREE.Vector3(...FLOW_ORIGIN), []);
  const lib = useRealLib();

  const mats = useMemo(() => {
    const masonry = (axis: [number, number], base: number, joint: number) =>
      new THREE.ShaderMaterial({
        vertexShader: worldVert,
        fragmentShader: masonryFrag,
        uniforms: {
          uOrigin: { value: origin },
          uAxis: { value: new THREE.Vector2(...axis) },
          uBase: { value: base },
          uJoint: { value: joint },
        },
        side: THREE.DoubleSide,
        polygonOffset: true,
        polygonOffsetFactor: -1,
        polygonOffsetUnits: -1,
      });
    const marble = (tile: number, sheen: number) =>
      new THREE.ShaderMaterial({
        vertexShader: worldVert,
        fragmentShader: marbleFrag,
        uniforms: { uOrigin: { value: origin }, uTile: { value: tile }, uSheen: { value: sheen } },
      });
    const glow = (color: string, intensity: number, mode: number) =>
      new THREE.ShaderMaterial({
        vertexShader: glowVert,
        fragmentShader: glowFrag,
        uniforms: { uColor: { value: new THREE.Color(color) }, uIntensity: { value: intensity }, uMode: { value: mode } },
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
      });
    return {
      facade: masonry([1, 0], 0.62 * 2, 0.36),
      hallWall: masonry([0, 1], 0, 0.2),
      hallBack: masonry([1, 0], 0, 0.2),
      porticoFloor: marble(1.2, 0),
      hallFloor: marble(1.5, 0.55),
      carpet: new THREE.ShaderMaterial({
        vertexShader: worldVert,
        fragmentShader: carpetFrag,
        uniforms: { uSize: { value: new THREE.Vector2(1.6, 7.7) } },
      }),
      glass: WINDOW_X.flatMap((_, i) =>
        [-1, 1].map(
          (s) =>
            new THREE.ShaderMaterial({
              vertexShader: worldVert,
              fragmentShader: glassFrag,
              uniforms: { uSeed: { value: i * 3.1 + (s > 0 ? 17 : 0) } },
            }),
        ),
      ),
      occluder: new THREE.MeshBasicMaterial({
        color: 0x020305,
        polygonOffset: true,
        polygonOffsetFactor: 1,
        polygonOffsetUnits: 1,
      }),
      line: new THREE.LineBasicMaterial({ color: 0xf5f7fa, transparent: true, opacity: 0.85, depthWrite: false }),
      soft: new THREE.LineBasicMaterial({ color: 0x8894a8, transparent: true, opacity: 0.55, depthWrite: false }),
      bronze: new THREE.LineBasicMaterial({ color: 0xc9a46a, transparent: true, opacity: 0.85, depthWrite: false }),
      bulb: new THREE.MeshBasicMaterial({ color: 0xfff1dc, toneMapped: false }),
      wash: glow("#ffe7cc", 0.34, 1),
    };
  }, [origin]);

  const geos = useMemo(() => {
    // ---- door surround (outside face)
    const zf = FACADE_Z;
    const surround: THREE.BufferGeometry[] = [];
    for (const s of [-1, 1]) {
      surround.push(box(0.34, 4.14, 0.14, s * 1.41, FLOOR + 2.07, zf + 0.07)); // architrave jamb
      surround.push(box(0.06, 4.2, 0.2, s * 1.61, FLOOR + 2.1, zf + 0.1)); // outer bead
      surround.push(box(0.42, 4.37, 0.2, s * 2.05, FLOOR + 2.185, zf + 0.1)); // pilaster shaft
      surround.push(box(0.56, 0.35, 0.28, s * 2.05, FLOOR + 0.175, zf + 0.14)); // pilaster base
      surround.push(box(0.56, 0.25, 0.28, s * 2.05, 5.125, zf + 0.14)); // pilaster capital
      surround.push(box(0.18, 0.42, 0.32, s * 2.5, 5.52, zf + 0.16)); // console
      // inner face (hall side) architrave
      surround.push(box(0.3, 4.1, 0.1, s * 1.38, FLOOR + 2.05, FACADE_BACK_Z - 0.05));
    }
    surround.push(box(3.16, 0.34, 0.14, 0, DOOR_TOP + 0.17, zf + 0.07)); // architrave head
    surround.push(box(3.3, 0.06, 0.2, 0, DOOR_TOP + 0.37, zf + 0.1)); // bead head
    surround.push(box(2.96, 0.3, 0.1, 0, DOOR_TOP + 0.15, FACADE_BACK_Z - 0.05)); // inner head
    surround.push(box(4.7, 0.5, 0.16, 0, 5.5, zf + 0.08)); // frieze
    surround.push(box(5.0, 0.08, 0.3, 0, 5.79, zf + 0.15)); // bed moulding
    surround.push(box(5.3, 0.16, 0.42, 0, 5.91, zf + 0.21)); // cornice
    // pediment over the door
    const tri = new THREE.Shape();
    tri.moveTo(-2.65, 0);
    tri.lineTo(2.65, 0);
    tri.lineTo(0, 0.85);
    tri.closePath();
    surround.push(bare(new THREE.ExtrudeGeometry(tri, { depth: 0.32, bevelEnabled: false }).translate(0, 5.99, zf)));
    // marble threshold through the wall
    surround.push(box(3.0, 0.06, 1.3, 0, FLOOR + 0.03, (zf + FACADE_BACK_Z) / 2));

    // ---- bronze double doors, swung open into the hall
    const leaf = (sign: number) => {
      const parts: THREE.BufferGeometry[] = [];
      const w = 1.08;
      const cx = sign * (w / 2);
      parts.push(box(w, 3.78, 0.07, cx, FLOOR + 1.89, 0));
      for (const [py, ph] of [
        [FLOOR + 0.6, 0.8],
        [FLOOR + 1.85, 1.3],
        [FLOOR + 3.2, 0.95],
      ]) {
        parts.push(box(w - 0.3, ph, 0.1, cx, py, 0)); // raised panel
      }
      parts.push(box(0.04, 0.5, 0.14, sign * (w - 0.12), FLOOR + 1.45, 0)); // pull handle
      const g = merge(parts);
      const open = THREE.MathUtils.degToRad(80);
      g.rotateY(sign > 0 ? open : -open);
      g.translate(-sign * DOOR_X, 0, FACADE_BACK_Z + 0.04);
      return g;
    };
    const doors = merge([leaf(1), leaf(-1)]);

    // ---- wall lanterns either side of the door
    const lanterns: THREE.BufferGeometry[] = [];
    const bulbs: THREE.BufferGeometry[] = [];
    for (const s of [-1, 1]) {
      const x = s * 2.95;
      lanterns.push(box(0.06, 0.06, 0.34, x, 3.78, zf + 0.17)); // bracket arm
      lanterns.push(box(0.16, 0.26, 0.03, x, 3.7, zf + 0.015)); // wall plate
      lanterns.push(box(0.24, 0.4, 0.24, x, 3.55, zf + 0.34)); // lantern body
      lanterns.push(bare(new THREE.ConeGeometry(0.2, 0.16, 4).rotateY(Math.PI / 4).translate(x, 3.83, zf + 0.34)));
      lanterns.push(box(0.12, 0.05, 0.12, x, 3.33, zf + 0.34)); // finial base
      bulbs.push(bare(new THREE.SphereGeometry(0.075, 14, 10).translate(x, 3.55, zf + 0.34)));
    }

    // ---- urns on pedestals in the portico
    const urnProfile = [
      [0, 0],
      [0.16, 0],
      [0.17, 0.04],
      [0.1, 0.1],
      [0.12, 0.16],
      [0.26, 0.32],
      [0.3, 0.48],
      [0.27, 0.62],
      [0.18, 0.72],
      [0.16, 0.78],
      [0.22, 0.84],
      [0.2, 0.88],
      [0, 0.88],
    ].map(([r, y]) => new THREE.Vector2(r, y));
    const urns: THREE.BufferGeometry[] = [];
    for (const c of ARCH_CIRCLES) {
      urns.push(box(0.62, 0.95, 0.62, c.x, FLOOR + 0.475, c.z));
      urns.push(box(0.74, 0.07, 0.74, c.x, FLOOR + 0.985, c.z));
      urns.push(box(0.7, 0.08, 0.7, c.x, FLOOR + 0.04, c.z));
      urns.push(bare(new THREE.LatheGeometry(urnProfile, 20).translate(c.x, FLOOR + 1.02, c.z)));
    }

    // ---- wing windows: architrave, sill, apron, hood and keystone
    const windows: THREE.BufferGeometry[] = [];
    const wf = -0.5; // front face of the model's window blocks
    for (const s of [-1, 1]) {
      for (const wx0 of WINDOW_X) {
        const wx = s * wx0;
        windows.push(box(0.12, 3.9, 0.08, wx - 0.6, 4.3, wf + 0.04));
        windows.push(box(0.12, 3.9, 0.08, wx + 0.6, 4.3, wf + 0.04));
        windows.push(box(1.44, 0.14, 0.08, wx, 6.27, wf + 0.04));
        windows.push(box(1.6, 0.1, 0.3, wx, 2.33, wf + 0.08));
        windows.push(box(1.1, 0.6, 0.04, wx, 1.95, FACADE_Z + 0.02));
        windows.push(box(1.75, 0.12, 0.32, wx, 6.43, wf + 0.09));
        windows.push(box(0.22, 0.34, 0.12, wx, 6.2, wf + 0.06));
      }
    }

    // ---- facade base plinth and string course (left and right of the door surround)
    const courses: THREE.BufferGeometry[] = [];
    for (const s of [-1, 1]) {
      const x0 = 2.32;
      const x1 = 26;
      const w = x1 - x0;
      const cx = s * (x0 + w / 2);
      courses.push(box(w, 0.5, 0.12, cx, FLOOR + 0.25, FACADE_Z + 0.06));
      courses.push(box(w, 0.06, 0.16, cx, FLOOR + 0.53, FACADE_Z + 0.08));
      courses.push(box(w, 0.18, 0.12, cx, 6.85, FACADE_Z + 0.06));
    }

    // ---- hall interior: skirting, chair rail, dentilled cornice
    const hallTrim: THREE.BufferGeometry[] = [];
    const dado: number[] = [];
    for (const s of [-1, 1]) {
      const x = s * (HALL_WALL_X - 0.03);
      for (const [za, zb] of HALL_SPANS) {
        const len = Math.abs(zb - za);
        const cz = (za + zb) / 2;
        hallTrim.push(box(0.06, 0.28, len, x, FLOOR + 0.14, cz));
        hallTrim.push(box(0.07, 0.07, len, s * (HALL_WALL_X - 0.035), FLOOR + 0.98, cz));
        // dado panels between skirting and chair rail
        const n = Math.max(1, Math.round(len / 1.25));
        const pw = len / n;
        const px = s * (HALL_WALL_X - 0.006);
        for (let k = 0; k < n; k++) {
          const z0 = Math.max(za, zb) - k * pw - 0.12;
          const z1 = Math.max(za, zb) - (k + 1) * pw + 0.12;
          const y0 = FLOOR + 0.42;
          const y1 = FLOOR + 0.84;
          dado.push(px, y0, z0, px, y0, z1, px, y0, z1, px, y1, z1, px, y1, z1, px, y1, z0, px, y1, z0, px, y0, z0);
        }
      }
      const cz = (-1.3 + HALL_END_Z) / 2;
      const clen = Math.abs(HALL_END_Z + 1.3);
      hallTrim.push(box(0.22, 0.2, clen, s * (HALL_WALL_X - 0.11), 7.05, cz));
      hallTrim.push(box(0.12, 0.06, clen, s * (HALL_WALL_X - 0.06), 6.92, cz));
      for (let z = -1.5; z > HALL_END_Z + 0.2; z -= 0.32) {
        hallTrim.push(box(0.1, 0.12, 0.12, s * (HALL_WALL_X - 0.08), 6.83, z));
      }
    }
    const dadoGeo = new THREE.BufferGeometry();
    dadoGeo.setAttribute("position", new THREE.Float32BufferAttribute(dado, 3));

    // ---- coffered ceilings: portico and both wing colonnades
    const coffer: number[] = [];
    cofferLines(coffer, -7.0, 7.0, -0.6, 3.95, 7.47, 0.9);
    cofferLines(coffer, -24.2, -6.4, -0.65, 2.35, 7.07, 0.95);
    cofferLines(coffer, 6.4, 24.2, -0.65, 2.35, 7.07, 0.95);
    const cofferGeo = new THREE.BufferGeometry();
    cofferGeo.setAttribute("position", new THREE.Float32BufferAttribute(coffer, 3));

    return {
      surround: merge(surround),
      doors,
      lanterns: merge(lanterns),
      bulbs: merge(bulbs),
      urns: merge(urns),
      windows: merge(windows),
      courses: merge(courses),
      hallTrim: merge(hallTrim),
      dado: dadoGeo,
      coffer: cofferGeo,
      plane: new THREE.PlaneGeometry(1, 1),
    };
  }, []);

  const texts = useMemo(
    () => ({
      frieze: textTexture([{ text: "EXHIBITION · HALL", size: 120, weight: 600, spacing: 3 }], 2048, 180),
      plaqueL: textTexture(
        [
          { text: "SYNAPX STUDIO", size: 92, weight: 700, color: "#e6cf9c" },
          { text: "ENGINEERING · DESIGN · 3D", size: 44, weight: 500, color: "#cdb98c" },
          { text: "COLOMBO", size: 44, weight: 500, color: "#cdb98c" },
        ],
        1024,
        700,
        "#1a140c",
      ),
      plaqueR: textTexture(
        [
          { text: "THE COLLECTION", size: 86, weight: 700, color: "#e6cf9c" },
          { text: "SIX WORKS ON PERMANENT VIEW", size: 40, weight: 500, color: "#cdb98c" },
          { text: "OPEN DAILY · ENTER FREELY", size: 40, weight: 500, color: "#cdb98c" },
        ],
        1024,
        700,
        "#1a140c",
      ),
    }),
    [],
  );

  useEffect(
    () => () => {
      Object.values(geos).forEach((g) => g.dispose());
      Object.values(texts).forEach((t) => t?.dispose());
      const { glass, ...rest } = mats;
      Object.values(rest).forEach((m) => m.dispose());
      glass.forEach((m) => m.dispose());
    },
    [geos, mats, texts],
  );

  // to the thermal binoculars the blueprint's masonry planes are masonry too
  useEffect(() => {
    for (const m of [mats.facade, mats.hallWall, mats.hallBack]) m.userData.heat = { kind: HeatKind.Surface, masonry: 1 };
  }, [mats]);

  // realistic: the lanterns' wall wash only shows once it is dark
  useFrame(() => {
    mats.wash.uniforms.uIntensity.value = lib ? 0.34 * Math.min(1, realState.night + realState.rain * 0.6) : 0.34;
  });

  const zf = FACADE_Z;
  const facadeH = WALL_TOP - FLOOR;
  const sideW = 26 - DOOR_X;
  const hallLen = Math.abs(HALL_END_Z - FACADE_BACK_Z);
  const hallMidZ = (HALL_END_Z + FACADE_BACK_Z) / 2;
  const innerSideW = HALL_WALL_X - DOOR_X;

  return (
    <group>
      {/* Ashlar masonry: facade (both sides of the door and over the lintel) */}
      {[-1, 1].map((s) => (
        <mesh
          key={`f${s}`}
          geometry={geos.plane}
          material={lib?.ashlarFacade ?? mats.facade}
          receiveShadow={!!lib}
          position={[s * (DOOR_X + sideW / 2), FLOOR + facadeH / 2, zf - 0.003]}
          scale={[sideW, facadeH, 1]}
        />
      ))}
      <mesh
        geometry={geos.plane}
        material={lib?.ashlarFacade ?? mats.facade}
        receiveShadow={!!lib}
        position={[0, (DOOR_TOP + WALL_TOP) / 2, zf - 0.003]}
        scale={[DOOR_X * 2, WALL_TOP - DOOR_TOP, 1]}
      />
      {/* ...the inside of the facade wall, and both long walls of the hall */}
      {[-1, 1].map((s) => (
        <mesh
          key={`b${s}`}
          geometry={geos.plane}
          material={lib?.hallAshlar ?? mats.hallBack}
          receiveShadow={!!lib}
          position={[s * (DOOR_X + innerSideW / 2), FLOOR + 3.525, FACADE_BACK_Z - 0.003]}
          scale={[innerSideW, 7.05, 1]}
        />
      ))}
      <mesh
        geometry={geos.plane}
        material={lib?.hallAshlar ?? mats.hallBack}
        receiveShadow={!!lib}
        position={[0, (DOOR_TOP + 7.93) / 2, FACADE_BACK_Z - 0.003]}
        scale={[DOOR_X * 2, 7.93 - DOOR_TOP, 1]}
      />
      {[-1, 1].map((s) => (
        <mesh
          key={`h${s}`}
          geometry={geos.plane}
          material={lib?.hallAshlar ?? mats.hallWall}
          receiveShadow={!!lib}
          position={[s * (HALL_WALL_X - 0.004), FLOOR + 3.525, hallMidZ]}
          rotation-y={(s * Math.PI) / 2}
          scale={[hallLen, 7.05, 1]}
        />
      ))}

      {/* Marble paving: portico & colonnades, and the hall */}
      <mesh
        geometry={geos.plane}
        material={lib?.porticoMarble ?? mats.porticoFloor}
        receiveShadow={!!lib}
        position={[0, FLOOR + 0.002, (zf + 3.92) / 2]}
        rotation-x={-Math.PI / 2}
        scale={[52, 3.92 - zf, 1]}
      />
      <mesh
        geometry={geos.plane}
        material={lib?.marbleFloor ?? mats.hallFloor}
        receiveShadow={!!lib}
        position={[0, FLOOR + 0.004, hallMidZ]}
        rotation-x={-Math.PI / 2}
        scale={[HALL_WALL_X * 2, hallLen, 1]}
      />
      {/* Runner carpet from the top step, through the doors, into the nave */}
      <mesh
        geometry={geos.plane}
        material={lib?.carpet ?? mats.carpet}
        receiveShadow={!!lib}
        position={[0, FLOOR + 0.0095, 3.9 - 7.7 / 2]}
        rotation-x={-Math.PI / 2}
        scale={[1.6, 7.7, 1]}
      />

      {/* Door surround, doors, lanterns, urns */}
      <Wire geometry={geos.surround} occluder={mats.occluder} line={mats.line} threshold={25} real={lib?.stoneLight} />
      <Wire geometry={geos.doors} occluder={mats.occluder} line={mats.bronze} threshold={25} real={lib?.bronze} />
      <Wire geometry={geos.lanterns} occluder={mats.occluder} line={mats.bronze} threshold={25} real={lib?.bronze} />
      <mesh geometry={geos.bulbs} material={mats.bulb} />
      <Wire geometry={geos.urns} occluder={mats.occluder} line={mats.line} threshold={18} real={lib?.stoneLight} />
      {[-1, 1].map((s) => (
        <mesh
          key={`lw${s}`}
          geometry={geos.plane}
          material={mats.wash}
          position={[s * 2.95, 3.55, zf + 0.01]}
          scale={[1.7, 3.6, 1]}
        />
      ))}

      {/* Frieze inscription and bronze plaques */}
      {texts.frieze && (
        <mesh position={[0, 5.5, zf + 0.165]}>
          <planeGeometry args={[3.9, 0.34]} />
          {lib ? (
            <meshStandardMaterial color="#d2ad68" metalness={0.9} roughness={0.3} alphaMap={texts.frieze} transparent depthWrite={false} />
          ) : (
            <meshBasicMaterial map={texts.frieze} transparent toneMapped={false} depthWrite={false} />
          )}
        </mesh>
      )}
      {texts.plaqueL && (
        <mesh position={[-3.75, 2.35, zf + 0.012]}>
          <planeGeometry args={[0.86, 0.59]} />
          {lib ? (
            <meshStandardMaterial map={texts.plaqueL} metalness={0.6} roughness={0.4} />
          ) : (
            <meshBasicMaterial map={texts.plaqueL} toneMapped={false} />
          )}
        </mesh>
      )}
      {texts.plaqueR && (
        <mesh position={[3.75, 2.35, zf + 0.012]}>
          <planeGeometry args={[0.86, 0.59]} />
          {lib ? (
            <meshStandardMaterial map={texts.plaqueR} metalness={0.6} roughness={0.4} />
          ) : (
            <meshBasicMaterial map={texts.plaqueR} toneMapped={false} />
          )}
        </mesh>
      )}

      {/* Wing windows: lit glazing behind framed openings */}
      {[-1, 1].flatMap((s, si) =>
        WINDOW_X.map((wx, i) => (
          <mesh
            key={`g${s}${wx}`}
            geometry={geos.plane}
            material={lib?.windowGlass ?? mats.glass[i * 2 + si]}
            position={[s * wx, 4.3, -0.496]}
            scale={[1.08, 3.7, 1]}
          />
        )),
      )}
      <Wire geometry={geos.windows} occluder={mats.occluder} line={mats.line} threshold={25} real={lib?.stoneLight} />
      <Wire geometry={geos.courses} occluder={mats.occluder} line={mats.soft} threshold={25} real={lib?.stoneLight} />

      {/* Hall interior trim */}
      <Wire geometry={geos.hallTrim} occluder={mats.occluder} line={mats.soft} threshold={25} real={lib?.hallStone} />
      <lineSegments geometry={geos.dado} material={mats.soft} visible={!lib} />

      {/* Coffered ceilings */}
      <lineSegments geometry={geos.coffer} material={mats.soft} visible={!lib} />
    </group>
  );
}
