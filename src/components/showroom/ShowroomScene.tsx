"use client";

import { ContactShadows, Environment, Lightformer, MeshReflectorMaterial, OrbitControls, PerspectiveCamera, useGLTF } from "@react-three/drei";
import { Bloom, DepthOfField, EffectComposer, N8AO, Noise, ToneMapping, Vignette } from "@react-three/postprocessing";
import { Canvas, createPortal, useFrame, useThree, type ThreeEvent } from "@react-three/fiber";
import { useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { BlendFunction, ToneMappingMode, type BloomEffect, type DepthOfFieldEffect } from "postprocessing";
import * as THREE from "three";

import type { CarView, PaintColor } from "@/content/cars";
import { cineShots, moodById, shots, type Dims, type Mood, type MoodId, type ShotId } from "./studio";

const ACCENT = new THREE.Color("#c8ff3d");
const GHOST = 0.18;
const TAU = Math.PI * 2;

type Mat = THREE.MeshPhysicalMaterial;
type MatState = { mat: Mat; opacity: number; transparent: boolean; depthWrite: boolean; emissive: THREE.Color; glow: boolean };
type PartRec = {
  id: string;
  obj: THREE.Object3D;
  home: THREE.Vector3;
  out: THREE.Vector3;
  center: THREE.Vector3;
  /** bounds at rest, in the car's frame */
  box: THREE.Box3;
  t: number;
  ghost: number;
  hover: number;
  mats: MatState[];
};
type Base = {
  opacity: number;
  transparent: boolean;
  depthWrite: boolean;
  emissive: THREE.Color;
  emissiveIntensity: number;
  color?: THREE.Color;
  metalness?: number;
  roughness?: number;
};

export type SceneProps = {
  url: string;
  view: CarView;
  /** the model's part groups that are picked (a set such as the four wheels moves together) */
  selected: string[];
  exploded: boolean;
  hovered: string[];
  paintMaterial: string;
  /** null: the model's own paint */
  paint: PaintColor | null;
  lamps: { head: string[]; tail: string[] };
  lights: boolean;
  mood: MoodId;
  turntable: boolean;
  /** a preset view; `n` changes to ask for the same view again */
  shot: { id: ShotId; n: number } | null;
  cinematic: boolean;
  onCinematicShot: (i: number) => void;
  onHover: (id: string | null, x?: number, y?: number) => void;
  onPick: (id: string) => void;
  onReady: (ids: string[]) => void;
};

/** What the car, the studio and the camera share from frame to frame. */
type Rig = {
  focus: THREE.Vector3;
  table: THREE.Group | null;
  dims: Dims;
  /** last orbit drag (ms); Infinity while dragging */
  lastDrag: number;
  /** turn the car back to face the camera's presets */
  square: boolean;
  speed: number;
  /** clock time the studio powered up */
  t0: number;
  /** clock time of the last light sweep */
  sweep: number;
  lamps: number;
  cineLamps: boolean;
};

const ease = (t: number) => t * t * (3 - 2 * t);
const clamp01 = (t: number) => Math.min(1, Math.max(0, t));
const reducedMotion = () => typeof matchMedia !== "undefined" && matchMedia("(prefers-reduced-motion: reduce)").matches;

/** Group the model by its Part_* empties (pure: no changes to the shared, cached scene). */
function useParts(scene: THREE.Group) {
  const parts = useMemo(() => {
    const recs = new Map<string, PartRec>();
    scene.updateMatrixWorld(true);
    for (const obj of scene.children) {
      if (!obj.name.startsWith("Part_")) continue;
      const id = (obj.userData.part as string) ?? obj.name.slice(5);
      const ex = (obj.userData.explode as number[] | undefined) ?? [0, 0, 0];
      // a previous visit may have left the part slid out; its effect stashed the true rest position
      const home = (obj.userData.home as THREE.Vector3 | undefined)?.clone() ?? obj.position.clone();
      const box = new THREE.Box3().setFromObject(obj);
      box.translate(home.clone().sub(obj.position));
      const center = box.getCenter(new THREE.Vector3());
      recs.set(id, { id, obj, home, out: new THREE.Vector3(...ex), center, box, t: 0, ghost: 0, hover: 0, mats: [] });
    }
    return recs;
  }, [scene]);

  // Give every part its own material copies so one part can glow or fade alone. Idempotent: copies
  // are tagged with their part and reset to their base look, so StrictMode re-runs and revisits
  // (the glTF is cached) start clean.
  useEffect(() => {
    for (const rec of parts.values()) {
      const seen = new Map<string, MatState>();
      rec.mats = [];
      rec.t = rec.ghost = rec.hover = 0;
      rec.obj.userData.home = rec.home.clone();
      rec.obj.position.copy(rec.home);
      rec.obj.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (!mesh.isMesh || mesh.userData.fx) return; // skip the lamp beams mounted inside parts
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        const own = (m: THREE.Material) => {
          let c = m as Mat;
          if (c.userData.part !== rec.id) {
            c = m.clone() as Mat;
            c.userData.part = rec.id;
            c.userData.base = {
              opacity: c.opacity,
              transparent: c.transparent,
              depthWrite: c.depthWrite,
              emissive: c.emissive ? c.emissive.clone() : new THREE.Color(0),
              emissiveIntensity: c.emissiveIntensity ?? 1,
              color: c.color?.clone(),
              metalness: c.metalness,
              roughness: c.roughness,
            } satisfies Base;
          }
          const st = seen.get(c.uuid);
          if (st) return c;
          const base = c.userData.base as Base;
          c.opacity = base.opacity;
          c.transparent = base.transparent;
          c.depthWrite = base.depthWrite;
          c.visible = true;
          if (c.emissive) c.emissive.copy(base.emissive);
          if (c.emissiveIntensity !== undefined) c.emissiveIntensity = base.emissiveIntensity ?? 1;
          if (base.color) c.color.copy(base.color);
          if (base.metalness !== undefined) c.metalness = base.metalness;
          if (base.roughness !== undefined) c.roughness = base.roughness;
          c.needsUpdate = true;
          const state: MatState = {
            mat: c,
            ...base,
            // lamps and screens keep their own glow
            glow: !!c.emissive && !c.emissiveMap && base.emissive.getHex() === 0,
          };
          seen.set(c.uuid, state);
          rec.mats.push(state);
          return c;
        };
        mesh.material = Array.isArray(mesh.material) ? mesh.material.map(own) : own(mesh.material);
      });
    }
  }, [parts]);

  return parts;
}

function partOf(o: THREE.Object3D | null): string | null {
  while (o) {
    if (o.name.startsWith("Part_")) return (o.userData.part as string) ?? o.name.slice(5);
    o = o.parent;
  }
  return null;
}

type Lamp = { s: MatState; head: boolean; lit: boolean; base: Base };
const HEAD = new THREE.Color(1, 0.93, 0.82);
const TAIL = new THREE.Color(1, 0.04, 0.02);

function Car({ url, view, selected, exploded, hovered, paint, paintMaterial, lamps, lights, turntable, cinematic, onHover, onPick, onReady, rig }: SceneProps & { rig: Rig }) {
  const { scene } = useGLTF(url, "/draco/");
  const home = useMemo(() => new THREE.Vector3(...view.target), [view]);
  const parts = useParts(scene);
  const table = useRef<THREE.Group>(null);
  const finish = useRef<{ paint: MatState[]; lamps: Lamp[] }>({ paint: [], lamps: [] });
  const goal = useMemo(() => ({ color: new THREE.Color(), metal: 0, rough: 0 }), []);

  useEffect(() => onReady([...parts.keys()]), [parts, onReady]);
  useEffect(() => {
    rig.table = table.current;
    return () => void (rig.table = null);
  }, [rig]);

  // the car's size, for the cinematic moves
  useEffect(() => {
    const all = new THREE.Box3();
    for (const p of parts.values()) all.union(p.box);
    const size = all.getSize(new THREE.Vector3());
    rig.dims = { l: Math.max(size.x, size.z) / 2, w: Math.min(size.x, size.z) / 2, h: size.y, y: home.y };
  }, [parts, rig, home]);

  // find the paint and the lamps among the part's material copies (runs after useParts' effect)
  useEffect(() => {
    const paintSet = new Set<MatState>();
    const lampList: Lamp[] = [];
    for (const rec of parts.values()) {
      for (const s of rec.mats) {
        if (s.mat.name === paintMaterial) paintSet.add(s);
        const head = rec.id === "headlights" && lamps.head.includes(s.mat.name);
        const tail = rec.id === "taillights" && lamps.tail.includes(s.mat.name);
        if (!head && !tail) continue;
        s.glow = false;
        const base = s.mat.userData.base as Base;
        lampList.push({ s, head, lit: base.emissive.getHex() !== 0, base });
      }
    }
    for (const s of paintSet) {
      // a fresh coat of lacquer on every colour
      if ("clearcoat" in s.mat) {
        s.mat.clearcoat = Math.max(s.mat.clearcoat, 0.8);
        s.mat.clearcoatRoughness = Math.min(s.mat.clearcoatRoughness, 0.06);
      }
    }
    finish.current = { paint: [...paintSet], lamps: lampList };
  }, [parts, paintMaterial, lamps]);

  // first hit that belongs to a part that isn't faded out
  const pick = (e: ThreeEvent<PointerEvent | MouseEvent>) => {
    for (const hit of e.intersections) {
      const id = partOf(hit.object);
      if (id && (parts.get(id)?.ghost ?? 0) < 0.5) return id;
    }
    return null;
  };

  useFrame((_, dt) => {
    const k = 1 - Math.exp(-dt * 5);
    for (const p of parts.values()) {
      const picked = selected.includes(p.id);
      const out = exploded || picked ? 1 : 0;
      const ghost = selected.length && !exploded && !picked ? 1 : 0;
      const hover = hovered.includes(p.id) && !picked ? 1 : 0;
      p.t += (out - p.t) * k;
      p.obj.position.copy(p.home).addScaledVector(p.out, ease(p.t));
      const g0 = p.ghost, h0 = p.hover;
      p.ghost += (ghost - p.ghost) * k;
      p.hover += (hover - p.hover) * k * 1.6;
      if (Math.abs(p.ghost - g0) < 1e-4 && Math.abs(p.hover - h0) < 1e-4) continue;
      const a = 1 - (1 - GHOST) * p.ghost;
      for (const s of p.mats) {
        const fading = p.ghost > 0.01;
        if (s.mat.transparent !== (fading || s.transparent)) s.mat.needsUpdate = true;
        s.mat.transparent = fading || s.transparent;
        s.mat.opacity = s.opacity * a;
        s.mat.depthWrite = p.ghost < 0.5 ? s.depthWrite : false;
        if (s.mat.transmission !== undefined && s.mat.transmission > 0) s.mat.visible = p.ghost < 0.5;
        if (s.glow) s.mat.emissive.copy(s.emissive).lerp(ACCENT, p.hover * 0.05);
      }
    }

    // paint: ease into the picked colour
    const { paint: coat, lamps: lampList } = finish.current;
    const base0 = coat[0]?.mat.userData.base as Base | undefined;
    if (base0?.color) {
      if (paint) goal.color.set(paint.hex);
      else goal.color.copy(base0.color);
      goal.metal = paint?.metalness ?? base0.metalness ?? 0.5;
      goal.rough = paint?.roughness ?? base0.roughness ?? 0.3;
      const kp = k * 0.7;
      for (const s of coat) {
        s.mat.color.lerp(goal.color, kp);
        s.mat.metalness += (goal.metal - s.mat.metalness) * kp;
        s.mat.roughness += (goal.rough - s.mat.roughness) * kp;
      }
    }

    // lamps: a quick ignition flicker, then full glow
    const on = lights || (cinematic && rig.cineLamps);
    const l0 = rig.lamps;
    rig.lamps += ((on ? 1 : 0) - rig.lamps) * Math.min(1, k * 1.8);
    if (Math.abs(rig.lamps - l0) > 1e-4) {
      const flick = on && rig.lamps < 0.6 ? (Math.random() > 0.35 ? 1 : 0.15) : 1;
      const lv = rig.lamps * flick;
      for (const { s, head, lit, base } of lampList) {
        if (lit) {
          s.mat.emissive.copy(base.emissive);
          s.mat.emissiveIntensity = base.emissiveIntensity * (1 + lv * 2.5);
        } else {
          s.mat.emissive.copy(head ? HEAD : TAIL).multiplyScalar(lv);
          s.mat.emissiveIntensity = head ? 7 : 5;
        }
      }
    }

    // the turntable: a slow spin while nobody is busy; squared up for the camera presets
    const g = table.current;
    if (g) {
      const idle = turntable && !selected.length && !cinematic && !rig.square && performance.now() - rig.lastDrag > 4000;
      rig.speed += ((idle && !reducedMotion() ? 0.12 : 0) - rig.speed) * k * 0.4;
      if (rig.square) {
        const near = Math.round(g.rotation.y / TAU) * TAU;
        g.rotation.y += (near - g.rotation.y) * k * 0.9;
      } else g.rotation.y += rig.speed * dt;
      if (cinematic) g.rotation.y = 0;
    }

    // ease the orbit pivot onto the picked part (where it has slid to), back to the car when cleared
    // (for a set, the middle of all its members)
    const sel = selected.map((id) => parts.get(id)).filter((p) => p !== undefined);
    const target = sel.length ? new THREE.Vector3() : home.clone();
    for (const p of sel) target.add(p.center.clone().addScaledVector(p.out, ease(p.t)).divideScalar(sel.length));
    if (sel.length && g) target.applyMatrix4(g.matrixWorld);
    rig.focus.lerp(target, k * 0.8);
  });

  const headRec = parts.get("headlights");
  const tailRec = parts.get("taillights");

  return (
    <group ref={table}>
      <primitive
        object={scene}
        onPointerMove={(e: ThreeEvent<PointerEvent>) => {
          e.stopPropagation();
          onHover(pick(e), e.nativeEvent.clientX, e.nativeEvent.clientY);
        }}
        onPointerOut={() => onHover(null)}
        onClick={(e: ThreeEvent<MouseEvent>) => {
          e.stopPropagation();
          if (e.delta > 6) return; // a drag to orbit, not a click
          const id = pick(e);
          if (id) onPick(id);
        }}
      />
      {headRec && createPortal(<HeadBeams rec={headRec} rig={rig} />, headRec.obj)}
      {tailRec && createPortal(<TailGlow rec={tailRec} rig={rig} />, tailRec.obj)}
    </group>
  );
}

// ---------------------------------------------------------------------- lamps

const beamVert = /* glsl */ `
  varying vec3 vPos;
  varying vec3 vNormal;
  varying vec3 vView;
  void main() {
    vPos = position;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vView = -mv.xyz;
    vNormal = normalMatrix * normal;
    gl_Position = projectionMatrix * mv;
  }
`;
const beamFrag = /* glsl */ `
  uniform vec3 uColor;
  uniform float uOpacity;
  uniform float uLength;
  varying vec3 vPos;
  varying vec3 vNormal;
  varying vec3 vView;
  void main() {
    float along = clamp(vPos.x / uLength, 0.0, 1.0);
    float fall = pow(1.0 - along, 2.2) * smoothstep(0.0, 0.06, along);
    float rim = pow(abs(dot(normalize(vNormal), normalize(vView))), 1.6);
    gl_FragColor = vec4(uColor * fall * rim * uOpacity, 1.0);
  }
`;

const BEAM_LEN = 6;

/** Headlamp beams: real spot lights for the pools on the floor, plus a soft volumetric cone each. */
function HeadBeams({ rec, rig }: { rec: PartRec; rig: Rig }) {
  const { spots, geo, mat } = useMemo(() => {
    const local = rec.box.clone().translate(rec.home.clone().negate());
    const size = local.getSize(new THREE.Vector3());
    const c = local.getCenter(new THREE.Vector3());
    const x = local.max.x - Math.min(0.08, size.x * 0.25);
    const off = Math.max(0.25, size.z * 0.36);
    const spots = [-1, 1].map((sd) => new THREE.Vector3(x, c.y, c.z + sd * off));
    const geo = new THREE.ConeGeometry(1.15, BEAM_LEN, 40, 1, true);
    geo.translate(0, -BEAM_LEN / 2, 0);
    geo.rotateZ(Math.PI / 2 - 0.09); // open toward +x, dipped toward the floor
    const mat = new THREE.ShaderMaterial({
      uniforms: { uColor: { value: new THREE.Color(1, 0.93, 0.8) }, uOpacity: { value: 0 }, uLength: { value: BEAM_LEN } },
      vertexShader: beamVert,
      fragmentShader: beamFrag,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      toneMapped: false,
    });
    return { spots, geo, mat };
  }, [rec]);
  const lights = useRef<(THREE.SpotLight | null)[]>([]);
  const beams = useRef<(THREE.Mesh | null)[]>([]);
  useEffect(() => () => { geo.dispose(); mat.dispose(); }, [geo, mat]);

  useFrame(() => {
    const lv = rig.lamps;
    mat.uniforms.uOpacity.value = lv * 0.16;
    for (const l of lights.current) if (l) l.intensity = lv * 70;
    for (const b of beams.current) if (b) b.visible = lv > 0.01;
  });

  return (
    <>
      {spots.map((p, i) => (
        <group key={i} position={p}>
          <spotLight
            ref={(l) => {
              lights.current[i] = l;
              // aim down the road; parented to the lamp so it turns with the car
              if (l && l.target.parent !== l) {
                l.add(l.target);
                l.target.position.set(6, -0.75, 0);
              }
            }}
            intensity={0}
            angle={0.42}
            penumbra={0.7}
            decay={2}
            color="#fff1dc"
          />
          <mesh ref={(m) => void (beams.current[i] = m)} geometry={geo} material={mat} raycast={() => null} renderOrder={10} userData={{ fx: true }} />
        </group>
      ))}
    </>
  );
}

/** Tail lamps throw a red wash onto the floor behind the car. */
function TailGlow({ rec, rig }: { rec: PartRec; rig: Rig }) {
  const pos = useMemo(() => {
    const local = rec.box.clone().translate(rec.home.clone().negate());
    const c = local.getCenter(new THREE.Vector3());
    return new THREE.Vector3(local.min.x - 0.25, c.y, c.z);
  }, [rec]);
  const light = useRef<THREE.PointLight>(null);
  useFrame(() => {
    if (light.current) light.current.intensity = rig.lamps * 6;
  });
  return <pointLight ref={light} position={pos} intensity={0} distance={4} decay={2} color="#ff1a0a" />;
}

// ---------------------------------------------------------------------- the studio

const FLOOR_R = 9.5; // polished floor; the cove takes over from here
const COVE_R = 3.5; // radius of the floor-to-wall curve
const WALL_R = FLOOR_R + COVE_R;
const STRIPS = 8; // light bars standing around the cove
const TABLE_R = 3.43; // turntable seam
const stripAngle = (i: number) => (i / STRIPS) * TAU + Math.PI / STRIPS;

/** The mood's colours and levels, eased each frame so a change of mood cross-fades the whole studio. */
type Live = {
  bg: THREE.Color;
  cove: THREE.Color;
  floor: THREE.Color;
  stripA: THREE.Color;
  stripB: THREE.Color;
  ceiling: THREE.Color;
  key: THREE.Color;
  rim: THREE.Color;
  ring: THREE.Color;
  horizon: THREE.Color;
  ringLevel: number;
  stripLevel: number;
  ceilingLevel: number;
  keyI: number;
  rimI: number;
  hemi: number;
  envStrip: number;
  envCeiling: number;
  bloom: number;
};
const liveOf = (m: Mood): Live => ({
  bg: new THREE.Color(m.bg),
  cove: new THREE.Color(m.cove),
  floor: new THREE.Color(m.floor),
  stripA: new THREE.Color(m.strips[0]),
  stripB: new THREE.Color(m.strips[1]),
  ceiling: new THREE.Color(m.ceiling),
  key: new THREE.Color(m.key.color),
  rim: new THREE.Color(m.rim.color),
  ring: new THREE.Color(m.ring),
  horizon: new THREE.Color(m.horizon),
  ringLevel: m.ringLevel,
  stripLevel: m.stripLevel,
  ceilingLevel: m.ceilingLevel,
  keyI: m.key.intensity,
  rimI: m.rim.intensity,
  hemi: m.hemi,
  envStrip: m.envStrip,
  envCeiling: m.envCeiling,
  bloom: m.bloom,
});
function stepLive(cur: Live, goal: Live, k: number) {
  for (const key of Object.keys(cur) as (keyof Live)[]) {
    const c = cur[key], g = goal[key];
    if (c instanceof THREE.Color) c.lerp(g as THREE.Color, k);
    else (cur as unknown as Record<string, number>)[key] = c + ((g as number) - c) * k;
  }
}

/** Power-up on arrival: bars blink on one by one round the cove, then the soft box, then the key. */
function power(rig: Rig, now: number, delay: number, len = 0.35) {
  const u = clamp01((now - rig.t0 - delay) / len);
  if (u <= 0) return 0;
  if (u < 1 && Math.random() < 0.35) return 0.12; // tube flicker
  return ease(u);
}
const stripDelay = (i: number) => 0.35 + ((i * 3) % STRIPS) * 0.11;

/** Height profile of the cove, so the wall can be shaded by how high up it is. */
function coveHeights(geo: THREE.BufferGeometry) {
  const pos = geo.attributes.position;
  return Array.from({ length: pos.count }, (_, i) => pos.getY(i));
}

/**
 * Smooth value noise on a canvas: the faint trowel marks and wear of a polished concrete floor,
 * used to vary its roughness and to waver its reflections.
 */
function floorNoise(size = 256) {
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const g = c.getContext("2d")!;
  const img = g.createImageData(size, size);
  const grid = (n: number) => Array.from({ length: n * n }, () => Math.random());
  const octaves = [6, 12, 24, 48, 96].map((n) => ({ n, v: grid(n) }));
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      let v = 0, amp = 0.5, tot = 0;
      for (const { n, v: cells } of octaves) {
        const fx = (x / size) * n, fy = (y / size) * n;
        const x0 = Math.floor(fx), y0 = Math.floor(fy);
        const tx = ease(fx - x0), ty = ease(fy - y0);
        const at = (i: number, j: number) => cells[((j + n) % n) * n + ((i + n) % n)];
        const a = at(x0, y0) + (at(x0 + 1, y0) - at(x0, y0)) * tx;
        const b = at(x0, y0 + 1) + (at(x0 + 1, y0 + 1) - at(x0, y0 + 1)) * tx;
        v += (a + (b - a) * ty) * amp;
        tot += amp;
        amp *= 0.55;
      }
      const k = (y * size + x) * 4;
      img.data[k] = img.data[k + 1] = img.data[k + 2] = Math.round((0.5 + (v / tot - 0.5) * 0.45) * 255);
      img.data[k + 3] = 255;
    }
  g.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(5, 5);
  return tex;
}

function Studio({ live, rig, narrow }: { live: Live; rig: Rig; narrow: boolean }) {
  const scene = useThree((s) => s.scene);
  const cove = useRef<THREE.MeshStandardMaterial>(null);
  const floor = useRef<THREE.MeshStandardMaterial>(null);
  const key = useRef<THREE.SpotLight>(null);
  const rim = useRef<THREE.SpotLight>(null);
  const hemi = useRef<THREE.HemisphereLight>(null);

  // infinity cove: floor curving up into the wall, painted lighter low down where the lamps reach
  // and falling away into shadow toward the grid, the way a real cyclorama reads on camera
  const { coveGeo, glowGeo } = useMemo(() => {
    const pts: THREE.Vector2[] = [];
    for (let i = 0; i <= 32; i++) {
      const a = (i / 32) * (Math.PI / 2);
      pts.push(new THREE.Vector2(FLOOR_R + Math.sin(a) * COVE_R, COVE_R - Math.cos(a) * COVE_R));
    }
    for (const y of [4.5, 6, 8, 11, 16]) pts.push(new THREE.Vector2(WALL_R, y));
    const coveGeo = new THREE.LatheGeometry(pts, 160);
    const ys = coveHeights(coveGeo);
    coveGeo.setAttribute("color", new THREE.Float32BufferAttribute(ys.flatMap((y) => {
      const v = 0.18 + 0.82 * Math.exp(-Math.max(0, y - 0.2) / 2.6);
      return [v, v, v];
    }), 3));
    // the horizon: a soft band of light where the floor turns into the wall, seen all the way round
    const glowGeo = coveGeo.clone();
    glowGeo.setAttribute("color", new THREE.Float32BufferAttribute(ys.flatMap((y) => {
      const v = Math.exp(-(((y - 1.25) / 1.15) ** 2)) * (0.35 + 0.65 * Math.min(1, y / 0.5));
      return [v, v, v];
    }), 3));
    return { coveGeo, glowGeo };
  }, []);
  const noise = useMemo(() => floorNoise(), []);
  const strips = useMemo(
    () => Array.from({ length: STRIPS }, () => new THREE.MeshBasicMaterial({ color: 0, toneMapped: false, fog: false })),
    [],
  );
  const ceiling = useMemo(() => new THREE.MeshBasicMaterial({ color: 0, toneMapped: false, fog: false }), []);
  const glow = useMemo(
    () => new THREE.MeshBasicMaterial({ color: 0, vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.BackSide, fog: false }),
    [],
  );
  const ring = useMemo(() => new THREE.MeshBasicMaterial({ color: 0, toneMapped: false }), []);
  const seam = useMemo(() => new THREE.MeshBasicMaterial({ color: new THREE.Color(0.012, 0.012, 0.014) }), []);
  useEffect(() => () => { coveGeo.dispose(); glowGeo.dispose(); noise.dispose(); }, [coveGeo, glowGeo, noise]);

  useFrame((state) => {
    const now = state.clock.elapsedTime;
    if (scene.background instanceof THREE.Color) scene.background.copy(live.bg);
    if (scene.fog instanceof THREE.Fog) scene.fog.color.copy(live.bg);
    cove.current?.color.copy(live.cove);
    floor.current?.color.copy(live.floor);
    strips.forEach((m, i) => m.color.copy(i % 2 ? live.stripB : live.stripA).multiplyScalar(live.stripLevel * power(rig, now, stripDelay(i))));
    ceiling.color.copy(live.ceiling).multiplyScalar(live.ceilingLevel * power(rig, now, 1.35, 0.5));
    glow.color.copy(live.horizon).multiplyScalar(0.42 * power(rig, now, 1.0, 1.2));
    // the LED line breathes gently
    const breathe = 0.85 + Math.sin(now * 1.2) * 0.15;
    ring.color.copy(live.ring).multiplyScalar(live.ringLevel * breathe * power(rig, now, 2.1, 0.6));
    if (key.current) {
      key.current.color.copy(live.key);
      key.current.intensity = live.keyI * power(rig, now, 1.7, 0.7);
    }
    if (rim.current) {
      rim.current.color.copy(live.rim);
      rim.current.intensity = live.rimI * power(rig, now, 2.0, 0.6);
    }
    if (hemi.current) hemi.current.intensity = live.hemi * (0.25 + 0.75 * power(rig, now, 1.6, 0.8));
  });

  return (
    <group>
      <mesh geometry={coveGeo} receiveShadow>
        <meshStandardMaterial ref={cove} color="#34363b" vertexColors roughness={0.92} metalness={0} side={THREE.BackSide} />
      </mesh>
      <mesh geometry={glowGeo} material={glow} scale={[0.995, 1, 0.995]} raycast={() => null} />

      {/* dark polished concrete: blurred, slightly wavering reflections, with a satin sheen that varies across the slab */}
      <mesh rotation-x={-Math.PI / 2} receiveShadow>
        <circleGeometry args={[FLOOR_R + 0.02, 160]} />
        <MeshReflectorMaterial
          ref={floor as never}
          resolution={narrow ? 512 : 1024}
          blur={[260, 90]}
          mixBlur={0.9}
          mixStrength={7}
          mixContrast={1.15}
          depthScale={1.2}
          minDepthThreshold={0.3}
          maxDepthThreshold={1.4}
          roughnessMap={noise}
          roughness={0.72}
          metalness={0.15}
          color="#141518"
        />
      </mesh>

      {/* softboxes standing round the cove: a diffuser in a black frame */}
      {strips.map((m, i) => {
        const a = stripAngle(i);
        return (
          <group key={i} position={[Math.sin(a) * (WALL_R - 0.6), COVE_R + 2.3, Math.cos(a) * (WALL_R - 0.6)]} rotation-y={a + Math.PI}>
            <mesh position-z={-0.02}>
              <planeGeometry args={[0.78, 4.9]} />
              <meshBasicMaterial color="#030304" />
            </mesh>
            <mesh material={m}>
              <planeGeometry args={[0.6, 4.6]} />
            </mesh>
          </group>
        );
      })}

      {/* the overhead scrim: one long diffuser down the length of the car, the line every studio car shot has on its roof */}
      <group position-y={6.4} rotation-x={Math.PI / 2}>
        <mesh position-z={-0.01}>
          <planeGeometry args={[9.6, 3.8]} />
          <meshBasicMaterial color="#040405" side={THREE.DoubleSide} />
        </mesh>
        <mesh material={ceiling}>
          <planeGeometry args={[9.2, 3.4]} />
        </mesh>
      </group>

      {/* turntable: a flush disc set into the floor, edged in brushed steel with a thin LED line */}
      <mesh rotation-x={-Math.PI / 2} position-y={0.003} material={seam}>
        <ringGeometry args={[TABLE_R - 0.025, TABLE_R + 0.012, 200]} />
      </mesh>
      <mesh rotation-x={-Math.PI / 2} position-y={0.0035} receiveShadow>
        <ringGeometry args={[TABLE_R + 0.012, TABLE_R + 0.07, 200]} />
        <meshStandardMaterial color="#9a9ca2" metalness={1} roughness={0.32} />
      </mesh>
      <mesh rotation-x={-Math.PI / 2} position-y={0.004} material={ring}>
        <ringGeometry args={[TABLE_R - 0.018, TABLE_R - 0.006, 200]} />
      </mesh>

      {/* key light: a pool on the floor round the car that falls off into the cove */}
      <spotLight ref={key} position={[0, 9, 1.5]} angle={0.55} penumbra={1} intensity={0} decay={2} />
      {/* rim light from behind and above, for the silhouette */}
      <spotLight ref={rim} position={[-6, 5.5, -6]} angle={0.45} penumbra={1} intensity={0} decay={2} />
      <directionalLight position={[2.5, 8, 2]} intensity={1.1} castShadow shadow-mapSize={narrow ? [1024, 1024] : [2048, 2048]}
        shadow-bias={-0.0003} shadow-normalBias={0.02} shadow-radius={6}
        shadow-camera-left={-4} shadow-camera-right={4} shadow-camera-top={4} shadow-camera-bottom={-4} />
      <hemisphereLight ref={hemi} args={["#cfd6e6", "#0a0a0b", 0]} />
      {/* a broad soft shadow under the car, and a tight dark one where the tyres meet the floor */}
      <ContactShadows position={[0, 0.005, 0]} scale={12} resolution={1024} blur={2.6} opacity={0.9} far={2.2} />
      {!narrow && <ContactShadows position={[0, 0.006, 0]} scale={12} resolution={1024} blur={0.9} opacity={0.65} far={0.35} />}
    </group>
  );
}

/**
 * Reflections on the paint: the same rig as the visible one, re-rendered live (it is only a dozen
 * quads) so mood changes cross-fade on the bodywork and a light bar can sweep across it. Big, soft,
 * clean shapes, as in a real studio: the overhead scrim for the roof line, a long low strip either
 * side for the horizon line down the doors, and a grey floor for the sills to pick up.
 */
function Reflections({ live, rig, narrow }: { live: Live; rig: Rig; narrow: boolean }) {
  const ceiling = useRef<THREE.Mesh>(null);
  const strips = useRef<(THREE.Mesh | null)[]>([]);
  const sides = useRef<(THREE.Mesh | null)[]>([]);
  const sweep = useRef<THREE.Mesh>(null);
  const bg = useRef<THREE.Color>(null);
  const tint = useMemo(() => new THREE.Color(), []);

  useFrame((state) => {
    const now = state.clock.elapsedTime;
    const set = (m: THREE.Mesh | null, c: THREE.Color, i: number) => (m?.material as THREE.MeshBasicMaterial | undefined)?.color.copy(c).multiplyScalar(i);
    set(ceiling.current, live.ceiling, live.envCeiling * power(rig, now, 1.35, 0.5));
    strips.current.forEach((m, i) => set(m, i % 2 ? live.stripB : live.stripA, live.envStrip * power(rig, now, stripDelay(i))));
    sides.current.forEach((m) => set(m, tint.copy(live.stripA).lerp(live.horizon, 0.35), live.envStrip * 0.55 * power(rig, now, 1.0, 1.2)));
    bg.current?.copy(live.bg).multiplyScalar(0.8);
    // every so often a tall light bar glides past the car and its highlight rolls along the paint
    const u = (now - rig.sweep) / 2.6;
    if (sweep.current) {
      const on = u > 0 && u < 1;
      sweep.current.visible = on;
      if (on) {
        sweep.current.position.set(-13 + ease(u) * 26, 2.6, 6.5);
        set(sweep.current, tint.set(1, 1, 1).lerp(live.stripA, 0.25), 9 * Math.sin(u * Math.PI));
      }
    }
  });

  return (
    <Environment resolution={narrow ? 256 : 512} frames={Infinity}>
      <color ref={bg} attach="background" args={["#08080a"]} />
      <Lightformer ref={ceiling} form="rect" position={[0, 6.4, 0]} rotation-x={Math.PI / 2} scale={[9.2, 3.4, 1]} />
      {Array.from({ length: STRIPS }, (_, i) => {
        const a = stripAngle(i);
        return (
          <Lightformer key={i} ref={(m: THREE.Mesh | null) => void (strips.current[i] = m)} form="rect"
            position={[Math.sin(a) * 9.6, 5.5, Math.cos(a) * 9.6]} rotation-y={a + Math.PI} scale={[0.6, 4.6, 1]} />
        );
      })}
      {[-1, 1].map((sd, i) => (
        <Lightformer key={sd} ref={(m: THREE.Mesh | null) => void (sides.current[i] = m)} form="rect"
          position={[0, 1.5, sd * 9]} rotation-y={sd > 0 ? Math.PI : 0} scale={[20, 0.45, 1]} />
      ))}
      <Lightformer ref={sweep} form="rect" rotation-y={Math.PI} scale={[0.9, 9, 1]} visible={false} />
      <Lightformer form="rect" intensity={0.5} color="#d9dde6" position={[10, 2.5, 0]} rotation-y={-Math.PI / 2} scale={[8, 3, 1]} />
      <Lightformer form="rect" intensity={0.35} color="#ffe4c8" position={[-10, 2.5, 0]} rotation-y={Math.PI / 2} scale={[8, 3, 1]} />
      <Lightformer form="rect" intensity={0.6} color="#ffffff" position={[-5, 4, 5]} scale={[3, 3, 1]} target={[0, 0, 0]} />
      {/* the floor, for the sills and lower doors */}
      <Lightformer form="rect" intensity={0.12} color="#9a9ca4" position={[0, -0.6, 0]} rotation-x={-Math.PI / 2} scale={[14, 14, 1]} />
    </Environment>
  );
}

function Stage({ mood, rig, narrow, bloom }: { mood: MoodId; rig: Rig; narrow: boolean; bloom: RefObject<BloomEffect | null> }) {
  const goal = useMemo(() => liveOf(moodById[mood]), [mood]);
  const [live] = useState(() => liveOf(moodById[mood]));
  useFrame((state, dt) => {
    stepLive(live, goal, 1 - Math.exp(-dt * 2.6));
    if (bloom.current) bloom.current.intensity = live.bloom;
    const now = state.clock.elapsedTime;
    if (rig.t0 < 0) rig.t0 = reducedMotion() ? now - 10 : now;
    // first sweep once the lights are up, then one every 12 s
    if (now - rig.sweep > 12 && now - rig.t0 > 2.4) rig.sweep = now;
  });
  return (
    <>
      {/* colours come from the eased mood each frame */}
      <color attach="background" args={["#0a0a0b"]} />
      <fog attach="fog" args={["#0a0a0b", 14, 34]} />
      <Reflections live={live} rig={rig} narrow={narrow} />
      <Studio live={live} rig={rig} narrow={narrow} />
    </>
  );
}

// ---------------------------------------------------------------------- the camera

const sph = new THREE.Spherical();
const sphGoal = new THREE.Spherical();
const tmp = new THREE.Vector3();

/**
 * The camera: orbit by hand, ease to a preset view, or run the cinematic reel. Wider lens on phones
 * so the whole car fits a portrait screen. While the details panel is open the view is shifted so
 * the picked part sits in the free space: above the bottom sheet on phones, left of the side panel
 * on wider screens.
 */
function Director({ view, panel, shot, cinematic, rig, onCinematicShot, dof }: {
  view: CarView;
  panel: boolean;
  shot: SceneProps["shot"];
  cinematic: boolean;
  rig: Rig;
  onCinematicShot: (i: number) => void;
  dof: RefObject<DepthOfFieldEffect | null>;
}) {
  const narrow = useThree((s) => s.size.width < 768);
  const controls = useRef<{ target: THREE.Vector3; update: () => void; enabled: boolean } | null>(null);
  const shift = useRef({ x: 0, y: 0 });
  const goal = useRef<THREE.Vector3 | null>(null);
  const cine = useRef({ start: -1, index: -1 });
  const look = useMemo(() => new THREE.Vector3(), []);
  const baseFov = narrow ? 46 : 27;
  const fov = useRef(baseFov);
  const pivot = useMemo(() => new THREE.Vector3(...view.target), [view]);
  // hero: a three-quarter front view from about head height on a longish lens, the way a car is
  // photographed (phones stand further back and higher so the whole car fits a portrait screen)
  const hero = useMemo(() => {
    if (narrow) return new THREE.Vector3(...view.cameraNarrow).multiplyScalar(1.1);
    const d = new THREE.Vector3(...view.camera).sub(pivot);
    const flat = Math.hypot(d.x, d.z);
    const dist = d.length() * 1.34;
    const el = THREE.MathUtils.degToRad(8);
    return new THREE.Vector3((d.x / flat) * Math.cos(el) * dist, Math.sin(el) * dist, (d.z / flat) * Math.cos(el) * dist).add(pivot);
  }, [narrow, view, pivot]);

  // the studio powers up while the camera glides in from low at the front
  const intro = useMemo(() => {
    const d = hero.clone().sub(pivot);
    return pivot.clone().add(new THREE.Vector3(d.length() * 0.62, 0.15, d.length() * 0.18));
  }, [hero, pivot]);
  useEffect(() => {
    if (!reducedMotion()) goal.current = hero.clone();
  }, [hero]);

  // a preset view: squared up to the car, at the car's own scale
  useEffect(() => {
    if (!shot) return;
    const def = shots.find((s) => s.id === shot.id);
    if (!def) return;
    const d = hero.clone().sub(pivot);
    const dir = def.dir ? new THREE.Vector3(...def.dir).normalize() : d.clone().normalize();
    goal.current = pivot.clone().addScaledVector(dir, d.length() * def.dist);
    // never below the floor: the low shot sits a hand's width above it
    goal.current.y = Math.max(goal.current.y, 0.22);
    fov.current = narrow ? baseFov : (def.fov ?? baseFov);
    rig.square = true;
  }, [shot, hero, pivot, rig, narrow, baseFov]);

  useEffect(() => {
    cine.current = { start: -1, index: -1 };
    if (!cinematic) {
      goal.current = hero.clone();
      fov.current = baseFov;
      rig.cineLamps = false;
    }
  }, [cinematic, hero, rig, baseFov]);

  useFrame((state, dt) => {
    const cam = state.camera as THREE.PerspectiveCamera;
    const { width: w, height: h } = state.size;
    const k = 1 - Math.exp(-dt * 5);
    const c = controls.current;

    if (cinematic) {
      if (c) c.enabled = false;
      if (cam.view?.enabled) cam.clearViewOffset();
      const now = state.clock.elapsedTime;
      if (cine.current.start < 0) cine.current.start = now;
      const total = cineShots.reduce((s, x) => s + x.dur, 0);
      let t = (now - cine.current.start) % total;
      let i = 0;
      while (t > cineShots[i].dur) t -= cineShots[i++].dur;
      const s = cineShots[i];
      if (i !== cine.current.index) {
        cine.current.index = i;
        rig.cineLamps = !!s.lamps;
        onCinematicShot(i);
      }
      const u = ease(t / s.dur);
      const d = rig.dims;
      cam.position.fromArray(s.from(d)).lerp(tmp.fromArray(s.to(d)), u);
      const [l0, l1] = s.look(d);
      look.fromArray(l0).lerp(tmp.fromArray(l1), u);
      cam.lookAt(look);
      cam.fov = s.fov[0] + (s.fov[1] - s.fov[0]) * u;
      cam.updateProjectionMatrix();
      if (dof.current) {
        dof.current.target ??= new THREE.Vector3();
        dof.current.target.copy(look);
      }
      return;
    }

    if (c) c.enabled = true;
    if (Math.abs(cam.fov - fov.current) > 0.01) {
      cam.fov += (fov.current - cam.fov) * k * 0.6;
      cam.updateProjectionMatrix();
    }

    // ease toward a preset, swinging round the pivot rather than cutting through the car
    if (goal.current) {
      sph.setFromVector3(tmp.copy(cam.position).sub(rig.focus));
      sphGoal.setFromVector3(tmp.copy(goal.current).sub(pivot));
      let dTheta = sphGoal.theta - sph.theta;
      dTheta = ((dTheta + Math.PI * 3) % TAU) - Math.PI;
      const kk = k * 0.55;
      sph.theta += dTheta * kk;
      sph.phi += (sphGoal.phi - sph.phi) * kk;
      sph.radius += (sphGoal.radius - sph.radius) * kk;
      sph.makeSafe();
      cam.position.setFromSpherical(sph).add(rig.focus);
      if (Math.abs(dTheta) < 0.002 && Math.abs(sphGoal.phi - sph.phi) < 0.002 && Math.abs(sphGoal.radius - sph.radius) < 0.01) goal.current = null;
    }
    if (c) {
      c.target.copy(rig.focus);
      c.update();
    }

    // wide screens: the title column sits on the left, so the car stands right of centre
    const goalX = narrow ? 0 : panel ? 210 : w >= 1024 ? -w * 0.08 : 0;
    const goalY = panel && narrow ? h * 0.24 : 0;
    shift.current.x += (goalX - shift.current.x) * k;
    shift.current.y += (goalY - shift.current.y) * k;
    if (Math.abs(shift.current.x) < 0.5 && Math.abs(shift.current.y) < 0.5) {
      if (cam.view?.enabled) cam.clearViewOffset();
      return;
    }
    cam.setViewOffset(w, h, shift.current.x, shift.current.y, w, h);
  });

  const start = useMemo(() => (reducedMotion() ? hero : intro).toArray() as [number, number, number], [hero, intro]);
  return (
    <>
      <PerspectiveCamera makeDefault position={start} fov={baseFov} near={0.05} far={60} />
      <OrbitControls ref={controls as never} makeDefault enableDamping dampingFactor={0.08} minDistance={1.2} maxDistance={12}
        maxPolarAngle={Math.PI * 0.505} enablePan={false}
        onStart={() => {
          rig.lastDrag = Infinity;
          goal.current = null;
          rig.square = false;
        }}
        onEnd={() => (rig.lastDrag = performance.now())} />
    </>
  );
}

function Post({ narrow, cinematic, bloom, dof }: {
  narrow: boolean;
  cinematic: boolean;
  bloom: RefObject<BloomEffect | null>;
  dof: RefObject<DepthOfFieldEffect | null>;
}) {
  // ambient occlusion seats the car on the floor and darkens its panel gaps and wheel arches; a
  // touch of film grain keeps the dark gradients from banding. The reel adds a shallow depth of
  // field, in a fresh composer so the everyday view stays cheap.
  const ao = !narrow && <N8AO halfRes quality="medium" aoRadius={0.9} distanceFalloff={0.6} intensity={2.2} color="#000000" />;
  return cinematic ? (
    <EffectComposer key="cine" multisampling={narrow ? 0 : 4}>
      {ao || <></>}
      <DepthOfField ref={dof} worldFocusRange={2.2} bokehScale={narrow ? 2.5 : 4.5} />
      <Bloom ref={bloom} mipmapBlur intensity={0.55} luminanceThreshold={1} luminanceSmoothing={0.15} radius={0.75} />
      <ToneMapping mode={ToneMappingMode.AGX} />
      <Noise premultiply blendFunction={BlendFunction.SOFT_LIGHT} opacity={0.22} />
      <Vignette offset={0.25} darkness={0.75} />
    </EffectComposer>
  ) : (
    <EffectComposer key="view" multisampling={narrow ? 0 : 4}>
      {ao || <></>}
      <Bloom ref={bloom} mipmapBlur intensity={0.55} luminanceThreshold={1} luminanceSmoothing={0.15} radius={0.7} />
      <ToneMapping mode={ToneMappingMode.AGX} />
      <Noise premultiply blendFunction={BlendFunction.SOFT_LIGHT} opacity={0.12} />
      <Vignette offset={0.3} darkness={0.6} />
    </EffectComposer>
  );
}

export default function ShowroomScene(props: SceneProps) {
  const narrow = typeof window !== "undefined" && window.innerWidth < 768;
  const rig = useMemo<Rig>(
    () => ({
      focus: new THREE.Vector3(...props.view.target),
      table: null,
      dims: { l: 2.4, w: 1, h: 1.2, y: props.view.target[1] },
      lastDrag: -Infinity,
      square: false,
      speed: 0,
      t0: -1,
      sweep: -100,
      lamps: 0,
      cineLamps: false,
    }),
    // one rig per car (the showroom is remounted for each)
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );
  const bloom = useRef<BloomEffect | null>(null);
  const dof = useRef<DepthOfFieldEffect | null>(null);

  return (
    <Canvas
      shadows={{ type: THREE.PCFShadowMap }}
      dpr={[1, 2]}
      gl={{ antialias: false, powerPreference: "high-performance" }}
      onPointerMissed={() => props.onHover(null)}
    >
      <Stage mood={props.mood} rig={rig} narrow={narrow} bloom={bloom} />
      <Car {...props} rig={rig} />
      <Director view={props.view} panel={props.selected.length > 0} shot={props.shot} cinematic={props.cinematic} rig={rig}
        onCinematicShot={props.onCinematicShot} dof={dof} />
      <Post narrow={narrow} cinematic={props.cinematic} bloom={bloom} dof={dof} />
    </Canvas>
  );
}

