"use client";

import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { projects } from "@/content/site";
import { FLOW_ORIGIN } from "@/lib/chapters";
import { rng } from "@/lib/random";
import { useApp } from "@/store/useApp";
import { glowFrag, glowVert } from "../chapters/FlowGalleryDetails";
import type { RealLib } from "./materials";
import { realState } from "./realState";

/**
 * Dressing for the realistic pavilion's front:
 *
 * - project banners hung between the portico's front columns (skipping the door bay), one per
 *   project, swaying a little and more in the storm
 * - light spilling out of the open doors: a warm veil inside the opening and a pool of it on the
 *   portico floor, breathing slowly, strongest after dark
 * - fireflies drifting over the lawns and pools on a clear night
 */

const ORIGIN = new THREE.Vector3(...FLOW_ORIGIN);
const FLOOR = 0.88;
const FACADE_Z = -0.7;
const FACADE_BACK_Z = -1.3;
const ACCENT = "#c8ff3d";
const GOLD = "#c9a46a";

type Bay = { x: number; z: number; width: number; top: number; height: number };

/** Gaps between the portico's front columns, measured off the model (door bay left out). */
function measureBays(model: THREE.Object3D): Bay[] {
  model.updateWorldMatrix(true, true);
  const box = new THREE.Box3();
  const cols: { x: number; z: number; w: number; y0: number; y1: number }[] = [];
  model.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh || !m.name.includes("Col_")) return;
    box.setFromObject(m);
    box.min.sub(ORIGIN);
    box.max.sub(ORIGIN);
    const x = (box.min.x + box.max.x) / 2;
    // the portico only: the wings and the rotunda have their own colonnades
    if (Math.abs(x) > 9) return;
    cols.push({ x, z: (box.min.z + box.max.z) / 2, w: box.max.x - box.min.x, y0: box.min.y, y1: box.max.y });
  });
  if (cols.length < 2) return [];
  const front = Math.max(...cols.map((c) => c.z));
  const row = cols.filter((c) => front - c.z < 0.6).sort((a, b) => a.x - b.x);
  const bays: Bay[] = [];
  for (let i = 0; i < row.length - 1; i++) {
    const a = row[i];
    const b = row[i + 1];
    if (a.x < 0 && b.x > 0) continue; // the door bay stays open
    const clear = b.x - a.x - (a.w + b.w) / 2;
    if (clear < 0.4) continue;
    const shaft = Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0, FLOOR);
    const top = Math.min(a.y1, b.y1) - shaft * 0.09;
    bays.push({ x: (a.x + b.x) / 2, z: (a.z + b.z) / 2, width: clear * 0.72, top, height: shaft * 0.56 });
  }
  return bays;
}

function fontFamily(name: string, fallback: string) {
  if (typeof document === "undefined") return fallback;
  const v = getComputedStyle(document.body).getPropertyValue(name).trim() || getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v ? `${v}, ${fallback}` : fallback;
}

/** A swallow-tailed fabric banner: number, project title down its length, category beside it. */
function bannerTexture(index: number, title: string, category: string, aspect: number) {
  const W = 320;
  const H = Math.round(W * aspect);
  const c = document.createElement("canvas");
  c.width = W;
  c.height = H;
  const g = c.getContext("2d")!;
  const display = fontFamily("--font-inter-tight", "sans-serif");
  const mono = fontFamily("--font-jetbrains", "monospace");
  const notch = W * 0.42;

  // cloth: swallow-tail outline, deep ink with a faint weave
  const outline = (inset: number) => {
    g.beginPath();
    g.moveTo(inset, inset);
    g.lineTo(W - inset, inset);
    g.lineTo(W - inset, H - inset);
    g.lineTo(W / 2, H - notch + inset * 0.6);
    g.lineTo(inset, H - inset);
    g.closePath();
  };
  outline(0);
  const fill = g.createLinearGradient(0, 0, W, 0);
  fill.addColorStop(0, "#0f1116");
  fill.addColorStop(0.5, "#1b1f27");
  fill.addColorStop(1, "#0f1116");
  g.fillStyle = fill;
  g.fill();
  g.save();
  g.clip();
  g.globalAlpha = 0.05;
  g.fillStyle = "#ffffff";
  for (let y = 0; y < H; y += 3) g.fillRect(0, y, W, 1);
  g.globalAlpha = 1;
  g.restore();

  // gold border and a brand-green hem across the head
  g.strokeStyle = GOLD;
  g.lineWidth = 4;
  outline(14);
  g.stroke();
  g.lineWidth = 1.5;
  outline(24);
  g.stroke();
  g.fillStyle = ACCENT;
  g.fillRect(14, 14, W - 28, 10);

  // number
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.fillStyle = ACCENT;
  g.font = `600 64px ${mono}`;
  g.fillText(String(index + 1).padStart(2, "0"), W / 2, 112);
  g.fillStyle = GOLD;
  g.fillRect(W / 2 - 34, 162, 68, 3);

  // title (and category) running down the banner
  const top = 200;
  const bottom = H - notch - 70;
  const run = bottom - top;
  g.save();
  g.translate(W / 2, (top + bottom) / 2);
  g.rotate(Math.PI / 2);
  const label = title.toUpperCase();
  let size = 132;
  g.font = `700 ${size}px ${display}`;
  const spaced = (s: string, px: number) => g.measureText(s).width + px * (s.length - 1);
  while (size > 40 && spaced(label, size * 0.12) > run) {
    size -= 4;
    g.font = `700 ${size}px ${display}`;
  }
  g.fillStyle = "#f3ece0";
  g.letterSpacing = `${Math.round(size * 0.12)}px`;
  g.fillText(label, 0, -18);
  g.font = `500 26px ${mono}`;
  g.letterSpacing = "4px";
  g.fillStyle = "rgba(243,236,224,0.6)";
  let cat = category.toUpperCase();
  while (cat.length > 4 && g.measureText(cat).width > run) cat = cat.slice(0, -2).trimEnd() + "…";
  g.fillText(cat, 0, size * 0.5 + 18);
  g.restore();

  // a small rosette above the tail
  g.strokeStyle = GOLD;
  g.lineWidth = 3;
  const ry = H - notch - 30;
  g.beginPath();
  for (let k = 0; k <= 6; k++) {
    const a = (k / 6) * Math.PI * 2 - Math.PI / 2;
    const px = W / 2 + Math.cos(a) * 18;
    const py = ry + Math.sin(a) * 18;
    if (k === 0) g.moveTo(px, py);
    else g.lineTo(px, py);
  }
  g.stroke();

  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

// ---------------------------------------------------------------- doorway veil
const veilFrag = /* glsl */ `
  uniform vec3 uColor;
  uniform float uIntensity;
  varying vec2 vUv;
  void main() {
    // brightest low in the opening, where the lit floor of the hall shows; soft at the jambs
    float edge = smoothstep(0.0, 0.18, vUv.x) * smoothstep(1.0, 0.82, vUv.x);
    float rise = mix(1.0, 0.35, vUv.y) * smoothstep(1.0, 0.9, vUv.y);
    gl_FragColor = vec4(uColor, edge * rise * uIntensity);
  }
`;

// ---------------------------------------------------------------- fireflies
const flyVert = /* glsl */ `
  attribute vec4 aSeed;
  uniform float uTime;
  uniform float uPix;
  varying float vGlow;
  void main() {
    float t = uTime * (0.25 + 0.2 * aSeed.w);
    vec3 p = position + vec3(
      sin(t * 1.3 + aSeed.x * 6.28) * 0.9 + sin(t * 2.9 + aSeed.y * 6.28) * 0.25,
      sin(t * 1.7 + aSeed.z * 6.28) * 0.35,
      cos(t * 1.1 + aSeed.y * 6.28) * 0.9
    );
    // each one glows for a moment, then goes dark
    float phase = fract(uTime * (0.12 + 0.1 * aSeed.z) + aSeed.x);
    vGlow = smoothstep(0.0, 0.08, phase) * (1.0 - smoothstep(0.12, 0.42, phase));
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    gl_PointSize = (2.0 + 2.0 * aSeed.w) * uPix * (14.0 / max(-mv.z, 1.0)) * (0.4 + vGlow);
    gl_Position = projectionMatrix * mv;
  }
`;
const flyFrag = /* glsl */ `
  uniform float uIntensity;
  varying float vGlow;
  void main() {
    vec2 q = gl_PointCoord - 0.5;
    float d = dot(q, q);
    float a = exp(-d * 18.0) + exp(-d * 90.0);
    a *= (0.08 + vGlow) * uIntensity;
    gl_FragColor = vec4(vec3(0.85, 1.0, 0.45) * a, a);
  }
`;

export default function PavilionDressing({ model, lib, live }: { model: THREE.Object3D; lib: RealLib; live: boolean }) {
  const gl = useThree((s) => s.gl);
  const isMobile = useApp((s) => s.isMobile);
  const swings = useRef<(THREE.Group | null)[]>([]);
  const fliesRef = useRef<THREE.Points>(null);

  // banners need the model measured and the page's fonts loaded before they are drawn
  const [banners, setBanners] = useState<{ bay: Bay; tex: THREE.CanvasTexture; mat: THREE.MeshStandardMaterial }[]>([]);
  useEffect(() => {
    let cancelled = false;
    const made: { bay: Bay; tex: THREE.CanvasTexture; mat: THREE.MeshStandardMaterial }[] = [];
    document.fonts.ready.then(() => {
      if (cancelled) return;
      const bays = measureBays(model).slice(0, projects.length);
      bays.forEach((bay, i) => {
        const p = projects[i];
        const tex = bannerTexture(i, p.title, p.category, bay.height / bay.width);
        const mat = new THREE.MeshStandardMaterial({
          map: tex,
          emissiveMap: tex,
          emissive: 0xffffff,
          emissiveIntensity: 0.05,
          roughness: 0.88,
          metalness: 0,
          alphaTest: 0.5,
          side: THREE.DoubleSide,
        });
        made.push({ bay, tex, mat });
      });
      setBanners(made);
    });
    return () => {
      cancelled = true;
      made.forEach((b) => {
        b.tex.dispose();
        b.mat.dispose();
      });
    };
  }, [model]);

  const geos = useMemo(
    () => ({
      cloth: new THREE.PlaneGeometry(1, 1, 1, 8).translate(0, -0.5, 0),
      rod: new THREE.CylinderGeometry(0.022, 0.022, 1, 10).rotateZ(Math.PI / 2),
      finial: new THREE.SphereGeometry(0.045, 12, 8),
    }),
    [],
  );

  const mats = useMemo(() => {
    const veil = new THREE.ShaderMaterial({
      vertexShader: glowVert,
      fragmentShader: veilFrag,
      uniforms: { uColor: { value: new THREE.Color("#ffc98a") }, uIntensity: { value: 0 } },
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      fog: false,
    });
    const spill = new THREE.ShaderMaterial({
      vertexShader: glowVert,
      fragmentShader: glowFrag,
      uniforms: { uColor: { value: new THREE.Color("#ffbf7a") }, uIntensity: { value: 0 }, uMode: { value: 2 } },
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      fog: false,
    });
    const flies = new THREE.ShaderMaterial({
      vertexShader: flyVert,
      fragmentShader: flyFrag,
      uniforms: { uTime: { value: 0 }, uPix: { value: 1 }, uIntensity: { value: 0 } },
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      fog: false,
    });
    return { veil, spill, flies };
  }, []);

  const flies = useMemo(() => {
    const n = isMobile ? 70 : 160;
    const r = rng(23);
    const pos = new Float32Array(n * 3);
    const seed = new Float32Array(n * 4);
    for (let i = 0; i < n; i++) {
      // over the lawns and pools either side of the approach, thicker near the hedges
      const side = r() < 0.5 ? -1 : 1;
      const x = side * (4.2 + Math.pow(r(), 0.7) * 13);
      const z = 2 + r() * 29;
      pos.set([x, -0.1 + r() * 2.1, z], i * 3);
      seed.set([r(), r(), r(), r()], i * 4);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    g.setAttribute("aSeed", new THREE.BufferAttribute(seed, 4));
    return g;
  }, [isMobile]);

  useEffect(
    () => () => {
      Object.values(geos).forEach((g) => g.dispose());
      Object.values(mats).forEach((m) => m.dispose());
      flies.dispose();
    },
    [geos, mats, flies],
  );

  useFrame((state) => {
    if (!live) return;
    const t = state.clock.elapsedTime;
    const dark = THREE.MathUtils.clamp(realState.night + realState.rain * 0.7, 0, 1);

    // banners: a slow sway from the top rod, gusting in the storm
    const amp = 0.02 + realState.rain * 0.08;
    swings.current.forEach((s, i) => {
      if (!s) return;
      s.rotation.x = Math.sin(t * 0.7 + i * 1.7) * amp + Math.sin(t * 1.9 + i) * amp * 0.35 + realState.rain * 0.05;
      s.rotation.z = Math.sin(t * 0.5 + i * 2.3) * amp * 0.3;
    });
    banners.forEach((b) => (b.mat.emissiveIntensity = 0.04 + 0.1 * dark));

    // the doorway breathes a little, like a room with people moving in it
    const breathe = 0.92 + 0.08 * Math.sin(t * 0.6) * Math.sin(t * 1.7 + 1.1);
    mats.veil.uniforms.uIntensity.value = (0.1 + 0.42 * dark) * breathe;
    mats.spill.uniforms.uIntensity.value = (0.05 + 0.5 * dark) * breathe;

    // fireflies only on a clear night
    const fly = realState.night * (1 - realState.rain);
    mats.flies.uniforms.uTime.value = t;
    mats.flies.uniforms.uPix.value = gl.getPixelRatio();
    mats.flies.uniforms.uIntensity.value = fly;
    if (fliesRef.current) fliesRef.current.visible = fly > 0.01;
  });

  return (
    <group visible={live}>
      {banners.map(({ bay, mat }, i) => (
        <group key={i} position={[bay.x, bay.top, bay.z]}>
          <mesh geometry={geos.rod} material={lib.blackMetal} scale={[bay.width + 0.22, 1, 1]} castShadow />
          {[-1, 1].map((s) => (
            <mesh key={s} geometry={geos.finial} material={lib.brassOut} position={[s * (bay.width / 2 + 0.13), 0, 0]} />
          ))}
          <group
            ref={(g) => {
              swings.current[i] = g;
            }}
            position={[0, -0.03, 0]}
          >
            <mesh geometry={geos.cloth} material={mat} scale={[bay.width, bay.height, 1]} castShadow receiveShadow />
          </group>
        </group>
      ))}

      {/* Light from the hall, inside the opening and spilling onto the portico floor */}
      <mesh
        position={[0, FLOOR + 1.9, FACADE_BACK_Z - 0.3]}
        material={mats.veil}
        renderOrder={6}
        userData={{ heat: { hide: true } }}
      >
        <planeGeometry args={[2.3, 3.8]} />
      </mesh>
      <mesh
        position={[0, FLOOR + 0.015, FACADE_Z + 1.7]}
        rotation={[-Math.PI / 2, 0, Math.PI]}
        material={mats.spill}
        renderOrder={6}
        userData={{ heat: { hide: true } }}
      >
        <planeGeometry args={[4.2, 3.4]} />
      </mesh>

      <points ref={fliesRef} geometry={flies} material={mats.flies} frustumCulled={false} renderOrder={8} userData={{ heat: { hide: true } }} />
    </group>
  );
}
