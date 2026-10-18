"use client";

import { ContactShadows, Environment, Grid, Html, Lightformer, Line, MeshReflectorMaterial, OrbitControls, PerspectiveCamera, Sparkles, useGLTF } from "@react-three/drei";
import { Bloom, ChromaticAberration, DepthOfField, EffectComposer, N8AO, Noise, ToneMapping, Vignette } from "@react-three/postprocessing";
import { Canvas, createPortal, useFrame, useThree, type ThreeEvent } from "@react-three/fiber";
import { useEffect, useId, useMemo, useRef, useState, type RefObject } from "react";
import type { OrbitControls as OrbitControlsImpl } from "three-stdlib";
import { BlendFunction, ToneMappingMode, type BloomEffect, type DepthOfFieldEffect } from "postprocessing";
import * as THREE from "three";

import type { CarView, PaintColor } from "@/content/cars";
import { cineShots, moodById, shots, type BackdropId, type Dims, type Look, type Mood, type MoodId, type Pin, type ShotId, type WeatherId } from "./studio";

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
  /** dimension lines round the car, measured off the model */
  measure: boolean;
  /** parts made see-through so the mechanicals show (the bodywork, for the X-ray view) */
  xray: string[];
  /** `n` changes to ask for a photo of the current frame; a wallpaper renders it 3840 px wide */
  snap: { n: number; wallpaper: boolean };
  onSnap: (png: string) => void;
  /** the camera as a photographer would read it: lens, height, angle round the car */
  onCamera: (c: CameraInfo) => void;
  /** what the dock sets: doors, brakes, finish, livery, the cockpit view, the stage and quality */
  look: Look;
  /** the parts to pin when the hotspots are on */
  pins: Pin[];
  onCinematicShot: (i: number) => void;
  onHover: (id: string | null, x?: number, y?: number) => void;
  onPick: (id: string) => void;
  onReady: (ids: string[]) => void;
};

export type CameraInfo = { mm: number; elevation: number; azimuth: number; distance: number };

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
  /** the driver's eye and where it looks, in the car's frame (for the cockpit view) */
  eye: THREE.Vector3 | null;
  /** how fast the car is rolling, m/s (the floor streams past at this speed) */
  drive: number;
  look: THREE.Vector3 | null;
  headColor: THREE.Color;
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
const TAIL = new THREE.Color(1, 0.04, 0.02);

type Door = { rec: PartRec; hinge: THREE.Vector3; side: number; base: THREE.Quaternion; t: number };
type Wheel = { rec: PartRec; roll: boolean; front: boolean; radius: number; base: THREE.Quaternion };
const TINT = new THREE.Color("#040506");
/** the drive mode's road speed, m/s: brisk enough to read, slow enough that the spokes don't strobe */
const DRIVE_SPEED = 4.5;
const DOOR_SWING = THREE.MathUtils.degToRad(64);
const DOOR_UP = THREE.MathUtils.degToRad(68);
const DOOR_OUT = THREE.MathUtils.degToRad(22);
const AX = new THREE.Vector3(1, 0, 0), AY = new THREE.Vector3(0, 1, 0), AZ = new THREE.Vector3(0, 0, 1);
const qa = new THREE.Quaternion(), qb = new THREE.Quaternion(), pv = new THREE.Vector3(), hv = new THREE.Vector3();

/**
 * The paint shader's extras, all worked out in the car's own frame:
 * - the livery: stripes, a side band or a two-tone roof
 * - metallic flake: each sub-millimetre flake tilts the base coat's normal a little, under a clear
 *   coat that stays smooth, so metallics sparkle as the light moves across them
 * - rain: beads of water on the upward faces, each a tiny dome bumped into both coats' normals
 */
const liveryIndex = { none: 0, stripes: 1, band: 2, twotone: 3 } as const;
const paintFxPars = /* glsl */ `
  uniform int uLivery;
  uniform vec3 uLiveryColor;
  uniform vec4 uBox;
  uniform float uFlake;
  uniform float uWet;
  varying vec3 vCarPos;
  vec3 fxHash3(vec3 p) {
    p = fract(p * vec3(443.897, 441.423, 437.195));
    p += dot(p, p.yxz + 19.19);
    return fract((p.xxy + p.yxx) * p.zyx);
  }
  uniform mat3 uCarRot;
  vec3 dropTilt = vec3(0.0);
`;
const paintFxNormal = /* glsl */ `
  #include <normal_fragment_maps>
  // rain beads: one per 26 mm cell, on surfaces that face the sky. Each is a dome: its normal leans
  // out from the bead's centre, more toward the rim (worked out directly, so no stair-stepping)
  if (uWet > 0.0) {
    vec3 wn = inverseTransformDirection(normal, viewMatrix);
    float up = smoothstep(0.25, 0.75, wn.y);
    vec2 g = vCarPos.xz * 38.0;
    vec2 id = floor(g);
    vec3 h = fxHash3(vec3(id, 3.7));
    vec2 d = fract(g) - 0.5 - (h.xy - 0.5) * 0.45;
    float r = 0.1 + 0.22 * h.z;
    float on = step(0.32, fxHash3(vec3(id, 9.1)).x) * up * uWet;
    float inside = 1.0 - smoothstep(r * 0.8, r, length(d));
    vec3 lean = uCarRot * vec3(d.x, 0.0, d.y) / r;
    dropTilt = (viewMatrix * vec4(lean, 0.0)).xyz * inside * on * 1.1;
    normal = normalize(normal + dropTilt);
    // wet paint reads a shade deeper
    diffuseColor.rgb *= 1.0 - 0.12 * uWet * up;
  }
  // flake: a random tilt per flake cell (about 0.7 mm)
  if (uFlake > 0.0) {
    vec3 rnd = fxHash3(floor(vCarPos * 1400.0)) - 0.5;
    normal = normalize(normal + rnd * uFlake);
  }
`;
function addLivery(mat: THREE.Material, u: Record<string, THREE.IUniform>) {
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, u);
    sh.vertexShader = sh.vertexShader
      .replace("#include <common>", "#include <common>\nuniform mat4 uCarInv;\nvarying vec3 vCarPos;")
      .replace("#include <project_vertex>", "#include <project_vertex>\nvCarPos = (uCarInv * modelMatrix * vec4(transformed, 1.0)).xyz;");
    sh.fragmentShader = sh.fragmentShader
      .replace("#include <common>", "#include <common>\n" + paintFxPars)
      .replace("#include <normal_fragment_maps>", paintFxNormal)
      // the beads sit on the clear coat too (the flake does not: it is under it)
      .replace("#include <clearcoat_normal_fragment_maps>", "#include <clearcoat_normal_fragment_maps>\n#ifdef USE_CLEARCOAT\nif (uWet > 0.0) clearcoatNormal = normalize(clearcoatNormal + dropTilt);\n#endif")
      .replace(
        "#include <color_fragment>",
        `#include <color_fragment>
        if (uLivery > 0) {
          // uBox: centre line z, floor y, height, half width
          vec3 p = vCarPos;
          float z = abs(p.z - uBox.x), y = p.y - uBox.y, h = uBox.z, aa = 0.005, m = 0.0;
          if (uLivery == 1) {
            m = smoothstep(0.045, 0.045 + aa, z) * (1.0 - smoothstep(0.17, 0.17 + aa, z)) * step(h * 0.3, y);
          } else if (uLivery == 2) {
            float c = h * 0.36;
            m = smoothstep(c - 0.045, c - 0.045 + aa, y) * (1.0 - smoothstep(c + 0.03, c + 0.03 + aa, y)) * smoothstep(uBox.w * 0.55, uBox.w * 0.6, z);
          } else {
            m = smoothstep(h * 0.66, h * 0.66 + aa, y);
          }
          diffuseColor.rgb = mix(diffuseColor.rgb, uLiveryColor, m);
        }`,
      );
  };
  mat.customProgramCacheKey = () => "paintfx";
  mat.needsUpdate = true;
}

/** Swap a standard material for a physical one with the same look, so it can take iridescence. */
function toPhysical(rec: PartRec, s: MatState) {
  if ((s.mat as THREE.MeshPhysicalMaterial).isMeshPhysicalMaterial) return;
  const old = s.mat as unknown as THREE.MeshStandardMaterial;
  const phys = new THREE.MeshPhysicalMaterial();
  THREE.MeshStandardMaterial.prototype.copy.call(phys, old);
  phys.userData = old.userData;
  phys.clearcoat = 0.8;
  phys.clearcoatRoughness = 0.06;
  rec.obj.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    if (Array.isArray(mesh.material)) mesh.material = mesh.material.map((m) => (m === old ? phys : m));
    else if (mesh.material === old) mesh.material = phys;
  });
  s.mat = phys;
  old.dispose();
}

function Car({ url, view, selected, exploded, hovered, paint, paintMaterial, lamps, lights, turntable, cinematic, measure, xray, look, pins, onHover, onPick, onReady, rig }: SceneProps & { rig: Rig }) {
  const { scene } = useGLTF(url, "/draco/");
  const home = useMemo(() => new THREE.Vector3(...view.target), [view]);
  const parts = useParts(scene);
  const table = useRef<THREE.Group>(null);
  const finish = useRef<{ paint: MatState[]; lamps: Lamp[]; calipers: MatState[] }>({ paint: [], lamps: [], calipers: [] });
  const goal = useMemo(() => ({ color: new THREE.Color(), metal: 0, rough: 0, brake: new THREE.Color() }), []);
  const livery = useMemo<Record<string, THREE.IUniform>>(
    () => ({
      uLivery: { value: 0 },
      uLiveryColor: { value: new THREE.Color() },
      uCarInv: { value: new THREE.Matrix4() },
      uBox: { value: new THREE.Vector4() },
      uFlake: { value: 0 },
      uWet: { value: 0 },
      uCarRot: { value: new THREE.Matrix3() },
    }),
    [],
  );

  // doors hinge at their front edge, on the outside: a swing outward, or up and out
  const doors = useMemo(() => {
    const list: Door[] = [];
    for (const rec of parts.values()) {
      if (!rec.id.startsWith("door")) continue;
      const b = rec.box, c = rec.center;
      const side = c.z >= 0 ? 1 : -1;
      const hinge = new THREE.Vector3(b.max.x - 0.04, look.doorStyle === "butterfly" ? b.min.y + (b.max.y - b.min.y) * 0.75 : c.y, side > 0 ? b.max.z : b.min.z);
      const base = (rec.obj.userData.baseQ as THREE.Quaternion | undefined)?.clone() ?? rec.obj.quaternion.clone();
      rec.obj.userData.baseQ = base.clone();
      list.push({ rec, hinge, side, base, t: 0 });
    }
    return list;
  }, [parts, look.doorStyle]);
  useEffect(() => () => doors.forEach((d) => d.rec.obj.quaternion.copy(d.base)), [doors]);

  // wheels roll about their axles and the fronts steer; brakes steer with them but do not roll
  const wheels = useMemo(() => {
    const list: Wheel[] = [];
    const all = new THREE.Box3();
    for (const p of parts.values()) all.union(p.box);
    const midX = all.getCenter(new THREE.Vector3()).x;
    for (const rec of parts.values()) {
      const roll = rec.id.startsWith("wheel_");
      if (!roll && !rec.id.startsWith("brake_")) continue;
      const base = (rec.obj.userData.baseQ as THREE.Quaternion | undefined)?.clone() ?? rec.obj.quaternion.clone();
      rec.obj.userData.baseQ = base.clone();
      list.push({ rec, roll, front: rec.center.x > midX, radius: Math.max(0.2, (rec.box.max.y - rec.box.min.y) / 2), base });
    }
    return list;
  }, [parts]);
  useEffect(() => () => wheels.forEach((w) => w.rec.obj.quaternion.copy(w.base)), [wheels]);
  const pose = useRef({ steer: 0, ride: 0, tint: 0, speed: 0, roll: 0 });
  // glass, for the tint: see-through materials that are not lamps
  const glass = useMemo(() => {
    const list: { s: MatState; rec: PartRec }[] = [];
    for (const rec of parts.values()) {
      if (rec.id === "headlights" || rec.id === "taillights") continue;
      for (const st of rec.mats) if (st.transparent && st.opacity < 0.9 && st.opacity > 0.05) list.push({ s: st, rec });
    }
    return list;
  }, [parts]);

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
    const mid = all.getCenter(new THREE.Vector3());
    livery.uBox.value.set(mid.z, all.min.y, size.y, size.z / 2);
    // the driver's eye: behind and above the steering wheel, or a guess from the car's size
    const wheel = parts.get("steering");
    if (wheel) {
      rig.eye = wheel.center.clone().add(new THREE.Vector3(-0.5, 0.26, 0));
    } else {
      rig.eye = new THREE.Vector3(mid.x - size.x * 0.06, all.min.y + size.y * 0.72, mid.z + size.z * 0.2);
    }
    rig.look = rig.eye.clone().add(new THREE.Vector3(1, -0.1, 0));
  }, [parts, rig, home, livery]);

  // find the paint and the lamps among the part's material copies (runs after useParts' effect)
  useEffect(() => {
    const paintSet = new Set<MatState>();
    const lampList: Lamp[] = [];
    const caliperSet = new Set<MatState>();
    for (const rec of parts.values()) {
      for (const s of rec.mats) {
        if (s.mat.name === paintMaterial) {
          toPhysical(rec, s);
          paintSet.add(s);
        }
        if (look.calipers.includes(s.mat.name)) caliperSet.add(s);
        const head = rec.id === "headlights" && lamps.head.includes(s.mat.name);
        const tail = rec.id === "taillights" && lamps.tail.includes(s.mat.name);
        if (!head && !tail) continue;
        s.glow = false;
        const base = s.mat.userData.base as Base;
        lampList.push({ s, head, lit: base.emissive.getHex() !== 0, base });
      }
    }
    for (const s of paintSet) {
      // a fresh coat of lacquer on every colour, a pearl that shifts with the angle, and the livery
      s.mat.clearcoat = Math.max(s.mat.clearcoat, 0.8);
      s.mat.clearcoatRoughness = Math.min(s.mat.clearcoatRoughness, 0.06);
      s.mat.iridescenceIOR = 1.45;
      s.mat.iridescenceThicknessRange = [180, 720];
      addLivery(s.mat, livery);
    }
    finish.current = { paint: [...paintSet], lamps: lampList, calipers: [...caliperSet] };
  }, [parts, paintMaterial, lamps, look.calipers, livery]);

  // first hit that belongs to a part that isn't faded out
  const pick = (e: ThreeEvent<PointerEvent | MouseEvent>) => {
    for (const hit of e.intersections) {
      const id = partOf(hit.object);
      if (id && (parts.get(id)?.ghost ?? 0) < 0.5) return id;
    }
    return null;
  };

  useFrame((state, dt) => {
    const k = 1 - Math.exp(-dt * 5);
    const ps = pose.current;
    const driving = look.drive && !cinematic;
    ps.steer += (THREE.MathUtils.degToRad(look.steer) - ps.steer) * k * 0.6;
    ps.ride += (look.ride - ps.ride) * k * 0.6;
    ps.tint += (look.tint - ps.tint) * k;
    ps.speed += ((driving ? DRIVE_SPEED : 0) - ps.speed) * Math.min(1, dt * 0.9);
    rig.drive = ps.speed;
    const bodyY = ps.ride + (ps.speed > 0.1 ? Math.sin(state.clock.elapsedTime * 37) * 0.0012 * (ps.speed / DRIVE_SPEED) : 0);
    for (const p of parts.values()) {
      const picked = selected.includes(p.id);
      const out = exploded || picked ? 1 : 0;
      const ghost = (selected.length && !exploded) || xray.includes(p.id) ? (picked ? 0 : 1) : 0;
      const hover = hovered.includes(p.id) && !picked ? 1 : 0;
      p.t += (out - p.t) * k;
      p.obj.position.copy(p.home).addScaledVector(p.out, ease(p.t));
      // the body sits on its springs: lowered or raised, and a faint shiver from the engine on the move
      if (!p.id.startsWith("wheel_") && !p.id.startsWith("brake_")) p.obj.position.y += bodyY;
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

    // doors: swing about their hinges (on top of any slide-out from the explode)
    for (const d of doors) {
      d.t += ((look.doors && !cinematic ? 1 : 0) - d.t) * k * 0.7;
      const u = ease(d.t);
      if (look.doorStyle === "butterfly") qa.setFromAxisAngle(AX, d.side * DOOR_OUT * u).multiply(qb.setFromAxisAngle(AZ, -DOOR_UP * u));
      else qa.setFromAxisAngle(AY, d.side * DOOR_SWING * u);
      const o = d.rec.obj;
      hv.copy(d.hinge).addScaledVector(d.rec.out, ease(d.rec.t));
      hv.y += bodyY;
      pv.copy(o.position).sub(hv).applyQuaternion(qa).add(hv);
      o.position.copy(pv);
      o.quaternion.copy(qa).multiply(d.base);
    }

    // wheels: roll with the speed, fronts turned by the steering
    ps.roll += ps.speed * dt;
    for (const w of wheels) {
      const o = w.rec.obj;
      qa.setFromAxisAngle(AY, w.front ? ps.steer : 0);
      if (w.roll) qa.multiply(qb.setFromAxisAngle(AZ, -ps.roll / w.radius));
      hv.copy(w.rec.center).addScaledVector(w.rec.out, ease(w.rec.t));
      pv.copy(o.position).sub(hv).applyQuaternion(qa).add(hv);
      o.position.copy(pv);
      o.quaternion.copy(qa).multiply(w.base);
    }
    // window tint: darker and more opaque glass
    for (const { s: st, rec } of glass) {
      const base = st.mat.userData.base as Base;
      const op = base.opacity + (0.94 - base.opacity) * ps.tint;
      st.opacity = op;
      st.mat.opacity = op * (1 - (1 - GHOST) * rec.ghost);
      if (base.color) st.mat.color.copy(base.color).lerp(TINT, ps.tint);
    }

    // paint: ease into the picked colour
    const { paint: coat, lamps: lampList, calipers } = finish.current;
    const base0 = coat[0]?.mat.userData.base as Base | undefined;
    if (base0?.color) {
      if (paint) goal.color.set(paint.hex);
      else goal.color.copy(base0.color);
      goal.metal = paint?.metalness ?? base0.metalness ?? 0.5;
      goal.rough = paint?.roughness ?? base0.roughness ?? 0.3;
      const kp = k * 0.7;
      const iri = look.iridescent ? 1 : 0;
      for (const s of coat) {
        s.mat.color.lerp(goal.color, kp);
        s.mat.metalness += (goal.metal - s.mat.metalness) * kp;
        s.mat.roughness += (goal.rough - s.mat.roughness) * kp;
        s.mat.iridescence = Math.abs(iri - s.mat.iridescence) < 0.01 ? iri : s.mat.iridescence + (iri - s.mat.iridescence) * kp;
      }
    }
    // the livery's colour and the car's frame for the shader
    livery.uLivery.value = liveryIndex[look.livery];
    // flake in metallic paint only; beads fade in as the rain sets in, and off again more slowly
    const metal = coat[0]?.mat.metalness ?? 0;
    livery.uFlake.value = THREE.MathUtils.clamp((metal - 0.25) * 0.5, 0, 0.22);
    const wet = look.weather === "rain" ? 1 : look.weather === "wet" ? 0.55 : 0;
    livery.uWet.value += (wet - livery.uWet.value) * Math.min(1, dt * (wet > livery.uWet.value ? 0.6 : 0.25));
    livery.uLiveryColor.value.set(look.liveryColor);
    if (table.current) {
      livery.uCarInv.value.copy(table.current.matrixWorld).invert();
      livery.uCarRot.value.setFromMatrix4(table.current.matrixWorld);
    }
    // brake calipers
    for (const s of calipers) {
      const base = s.mat.userData.base as Base;
      if (look.brake) goal.brake.set(look.brake);
      else if (base.color) goal.brake.copy(base.color);
      s.mat.color.lerp(goal.brake, k * 0.7);
    }
    rig.headColor.set(look.tuning.headColor);

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
          s.mat.emissive.copy(head ? rig.headColor : TAIL).multiplyScalar(lv);
          s.mat.emissiveIntensity = head ? 7 : 5;
        }
      }
    }

    // the turntable: a slow spin while nobody is busy; squared up for the camera presets
    const g = table.current;
    if (g) {
      if ((measure || look.interior || driving) && !cinematic) rig.square = true;
      const idle = turntable && !selected.length && !cinematic && !rig.square && performance.now() - rig.lastDrag > 4000;
      rig.speed += ((idle && !reducedMotion() ? 0.12 * look.tuning.spin : 0) - rig.speed) * k * 0.4;
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
      <Dimensions parts={parts} on={measure && !cinematic} />
      {look.pins && !cinematic && !look.interior && <Pins pins={pins} parts={parts} selected={selected} onPick={onPick} />}
      {headRec && createPortal(<HeadBeams rec={headRec} rig={rig} />, headRec.obj)}
      {tailRec && createPortal(<TailGlow rec={tailRec} rig={rig} />, tailRec.obj)}
    </group>
  );
}

// ---------------------------------------------------------------------- hotspots

/**
 * A pin on each part, at the middle of it as it sits assembled (a set such as the wheels is pinned
 * on its near-side member): a pulsing dot that names the part on hover and opens it on a click.
 * Pins on the far side of the car fade back.
 */
function Pins({ pins, parts, selected, onPick }: { pins: Pin[]; parts: Map<string, PartRec>; selected: string[]; onPick: (id: string) => void }) {
  const spots = useMemo(() => {
    const all = new THREE.Box3();
    for (const p of parts.values()) all.union(p.box);
    const mid = all.getCenter(new THREE.Vector3());
    return pins
      .map((pin) => {
        const recs = pin.members.map((m) => parts.get(m)).filter((r) => r !== undefined);
        if (!recs.length) return null;
        const at = new THREE.Vector3();
        for (const r of recs) at.add(r.center);
        at.divideScalar(recs.length);
        // a set (four wheels) sits between its members: pin the nearest one instead
        if (recs.length > 1) at.copy(recs.reduce((a, r) => (r.center.z > a.center.z || (r.center.z === a.center.z && r.center.x > a.center.x) ? r : a)).center);
        return { pin, recs, at, out: at.clone().sub(mid).normalize() };
      })
      .filter((x) => x !== null);
  }, [pins, parts]);
  const els = useRef<(HTMLElement | null)[]>([]);
  const groupRef = useRef<THREE.Group>(null);
  const world = useMemo(() => new THREE.Vector3(), []);
  const normal = useMemo(() => new THREE.Vector3(), []);
  const toCam = useMemo(() => new THREE.Vector3(), []);

  useFrame(({ camera }) => {
    const g = groupRef.current;
    if (!g) return;
    spots.forEach((sp, i) => {
      const el = els.current[i];
      if (!el) return;
      world.copy(sp.at).applyMatrix4(g.matrixWorld);
      normal.copy(sp.out).transformDirection(g.matrixWorld);
      toCam.copy(camera.position).sub(world).normalize();
      el.style.opacity = normal.dot(toCam) > -0.15 ? "1" : "0.28";
    });
  });

  return (
    <group ref={groupRef}>
      {spots.map((sp, i) => {
        const on = sp.recs.some((r) => selected.includes(r.id));
        return (
          <Html key={sp.pin.id} position={sp.at} center zIndexRange={[25, 0]}>
            <button
              ref={(el) => void (els.current[i] = el)}
              type="button"
              aria-label={sp.pin.name}
              onClick={() => onPick(sp.pin.members[0])}
              className="group relative grid h-6 w-6 place-items-center transition-opacity duration-300"
            >
              <span className={`absolute inset-0 animate-ping rounded-full ${on ? "bg-accent/40" : "bg-white/25"}`} style={{ animationDuration: "2.4s" }} />
              <span className={`relative h-2.5 w-2.5 rounded-full border border-black/40 ${on ? "bg-accent" : "bg-white"} shadow-[0_0_10px_rgba(255,255,255,0.6)]`} />
              <span className="pointer-events-none absolute bottom-full left-1/2 mb-1.5 -translate-x-1/2 whitespace-nowrap rounded-full border border-fg/15 bg-[#0c0c0e]/85 px-2.5 py-1 font-mono text-[9px] uppercase tracking-[0.12em] text-fg opacity-0 backdrop-blur-md transition-opacity group-hover:opacity-100">
                {sp.pin.name}
              </span>
            </button>
          </Html>
        );
      })}
    </group>
  );
}

// ---------------------------------------------------------------------- dimensions

const mm = (m: number) => `${(Math.round(m * 100) * 10).toLocaleString("en-GB")} mm`;
type V3 = [number, number, number];
type Dim = { label: string; value: string; segs: V3[]; at: V3 };

/**
 * A technical drawing laid round the car: overall length and wheelbase down the near side, width
 * across the nose and height at the tail, each with extension lines and end ticks. Measured off the
 * model at rest, so they turn with the turntable and ignore any exploded parts.
 */
function Dimensions({ parts, on }: { parts: Map<string, PartRec>; on: boolean }) {
  const dims = useMemo(() => {
    const b = new THREE.Box3();
    for (const p of parts.values()) b.union(p.box);
    if (b.isEmpty()) return [];
    const y = 0.012;
    const t = 0.06; // half a tick
    const zL = b.max.z + 0.95; // length line, out on the floor beside the car
    const xW = b.max.x + 0.55; // width line, ahead of the nose
    const xH = b.min.x - 0.4; // height line, behind the tail
    const out: Dim[] = [
      {
        label: "Length",
        value: mm(b.max.x - b.min.x),
        segs: [
          [b.min.x, y, zL], [b.max.x, y, zL],
          [b.min.x, y, b.max.z + 0.08], [b.min.x, y, zL + 0.1],
          [b.max.x, y, b.max.z + 0.08], [b.max.x, y, zL + 0.1],
          [b.min.x - t, y, zL + t], [b.min.x + t, y, zL - t],
          [b.max.x - t, y, zL + t], [b.max.x + t, y, zL - t],
        ],
        // label toward the tail, clear of the wheelbase's
        at: [b.min.x + (b.max.x - b.min.x) * 0.2, y, zL],
      },
      {
        label: "Width",
        value: mm(b.max.z - b.min.z),
        segs: [
          [xW, y, b.min.z], [xW, y, b.max.z],
          [b.max.x + 0.08, y, b.min.z], [xW + 0.1, y, b.min.z],
          [b.max.x + 0.08, y, b.max.z], [xW + 0.1, y, b.max.z],
          [xW - t, y, b.min.z - t], [xW + t, y, b.min.z + t],
          [xW - t, y, b.max.z - t], [xW + t, y, b.max.z + t],
        ],
        at: [xW, y, (b.min.z + b.max.z) / 2],
      },
      {
        label: "Height",
        value: mm(b.max.y - Math.max(0, b.min.y)),
        segs: [
          [xH, Math.max(0, b.min.y), b.max.z], [xH, b.max.y, b.max.z],
          [xH - 0.1, b.max.y, b.max.z], [b.min.x + 0.35, b.max.y, b.max.z],
          [xH - t, b.max.y - t, b.max.z], [xH + t, b.max.y + t, b.max.z],
          [xH - t, Math.max(0, b.min.y) - t, b.max.z], [xH + t, Math.max(0, b.min.y) + t, b.max.z],
        ],
        at: [xH, b.max.y / 2, b.max.z],
      },
    ];
    // wheelbase: between the front and rear hub centres
    const hubs = (front: boolean) => {
      const xs = [...parts.values()].filter((p) => p.id.startsWith(front ? "wheel_f" : "wheel_r")).map((p) => p.center.x);
      return xs.length ? xs.reduce((a, c) => a + c, 0) / xs.length : null;
    };
    const f = hubs(true), r = hubs(false);
    if (f !== null && r !== null && Math.abs(f - r) > 0.5) {
      const z = b.max.z + 0.3;
      out.push({
        label: "Wheelbase",
        value: mm(Math.abs(f - r)),
        segs: [
          [r, y, z], [f, y, z],
          [r, y, z - 0.08], [r, y, z + 0.08],
          [f, y, z - 0.08], [f, y, z + 0.08],
        ],
        at: [(f + r) / 2, y, z],
      });
    }
    return out;
  }, [parts]);

  const group = useRef<THREE.Group>(null);
  const fade = useRef(0);
  useFrame((_, dt) => {
    fade.current += ((on ? 1 : 0) - fade.current) * (1 - Math.exp(-dt * 6));
    const g = group.current;
    if (!g) return;
    g.visible = fade.current > 0.01;
    g.traverse((o) => {
      const m = (o as THREE.Mesh).material as THREE.Material & { opacity: number } | undefined;
      if (m && "opacity" in m) m.opacity = fade.current * 0.9;
    });
  });

  return (
    <group ref={group} visible={false}>
      {dims.map((d) => (
        <group key={d.label}>
          <Line points={d.segs} segments color="#f2efe8" lineWidth={1.2} transparent depthTest={false} renderOrder={20} raycast={() => null} />
          {on && (
            <Html position={d.at} center zIndexRange={[20, 0]} style={{ pointerEvents: "none" }}>
              <div className="sr-rise whitespace-nowrap rounded-full border border-fg/20 bg-[#0c0c0e]/85 px-2.5 py-1 text-center font-mono text-[10px] uppercase tracking-[0.12em] text-fg backdrop-blur-md">
                <span className="text-fg/45">{d.label}</span> {d.value}
              </div>
            </Html>
          )}
        </group>
      ))}
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
/** render layer for glow that should show to the camera but stay out of shadow and depth passes */
const FX_LAYER = 1;

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
  // the cones only exist while the lamps are lit
  const [lit, setLit] = useState(false);
  useEffect(() => () => { geo.dispose(); mat.dispose(); }, [geo, mat]);
  const token = useId();
  useEffect(() => sweep(rec.obj, "beam", token), [rec, token]);

  useFrame(() => {
    const lv = rig.lamps;
    mat.uniforms.uOpacity.value = lv * 0.16;
    mat.uniforms.uColor.value.copy(rig.headColor);
    for (const l of lights.current) if (l) {
      l.intensity = lv * 70;
      l.color.copy(rig.headColor);
    }
    if (lv > 0.01 !== lit) setLit(lv > 0.01);
  });

  return (
    <>
      {spots.map((p, i) => (
        <group key={i} position={p} userData={{ beam: token }}>
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
          {/* glow only, on its own layer: the floor's contact shadow renders layer 0 and would print the
              cone into it as a dark wedge ahead of the car; the main camera sees both layers */}
          {lit && (
            <mesh ref={(m) => {
              beams.current[i] = m;
              m?.layers.set(FX_LAYER);
            }} geometry={geo} material={mat} raycast={() => null} renderOrder={10} userData={{ fx: true }} />
          )}
        </group>
      ))}
    </>
  );
}

/**
 * The glTF scene is cached and the lamps are portalled into it, so a remount can leave the last
 * visit's beams behind, still visible (and printed into the floor's contact shadow as dark cones).
 * Clear out any that are not this mount's own.
 */
function sweep(obj: THREE.Object3D, tag: "beam" | "tail", token: string) {
  for (const c of [...obj.children]) if (c.userData[tag] && c.userData[tag] !== token) obj.remove(c);
}

/** Tail lamps throw a red wash onto the floor behind the car. */
function TailGlow({ rec, rig }: { rec: PartRec; rig: Rig }) {
  const pos = useMemo(() => {
    const local = rec.box.clone().translate(rec.home.clone().negate());
    const c = local.getCenter(new THREE.Vector3());
    return new THREE.Vector3(local.min.x - 0.25, c.y, c.z);
  }, [rec]);
  const light = useRef<THREE.PointLight>(null);
  const token = useId();
  useEffect(() => sweep(rec.obj, "tail", token), [rec, token]);
  useFrame(() => {
    if (light.current) light.current.intensity = rig.lamps * 6;
  });
  return <pointLight ref={light} position={pos} intensity={0} distance={4} decay={2} color="#ff1a0a" userData={{ tail: token }} />;
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
/** The backdrop repaints the set under the mood's lights: a white cyc, a black void, or open sky. */
function withBackdrop(l: Live, b: BackdropId, sun = 0.6): Live {
  if (b === "white") {
    l.bg.set("#c9cacd");
    l.cove.set("#f0f0f2");
    l.floor.set("#8e9094");
    l.horizon.set("#3a3b3e");
    l.hemi += 0.5;
  } else if (b === "void") {
    l.bg.set("#000000");
    l.cove.set("#000000");
    l.horizon.set("#000000");
    l.stripLevel = 0;
    l.ceilingLevel = 0;
    l.floor.set("#0c0c0e");
  } else if (b === "sky") {
    // the haze the floor fades into: blue by day, amber at sunrise
    l.bg.set("#b3c9e6").lerp(new THREE.Color("#e8a070"), Math.max(0, 1 - sun * 2.5));
    l.horizon.set("#000000");
    l.stripLevel = 0;
    l.ceilingLevel = 0;
    l.floor.set("#26272b");
    l.hemi += 0.6;
    l.envStrip *= 0.4;
    l.envCeiling *= 0.4;
  }
  return l;
}

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

// ---------------------------------------------------------------------- weather

const rainVert = /* glsl */ `
  attribute vec4 aSeed;
  uniform float uTime;
  varying float vA;
  void main() {
    // each drop falls through a 9 m column and wraps; the second end of the streak trails above it
    float y = mod(aSeed.y * 9.0 - uTime * (8.0 + aSeed.w * 3.0), 9.0);
    vec3 p = vec3((aSeed.x - 0.5) * 26.0, y + position.y * 0.38, (aSeed.z - 0.5) * 26.0);
    p.x += position.y * 0.05; // a breath of wind
    vA = (1.0 - position.y * 0.85) * smoothstep(0.0, 0.6, y) * (0.5 + aSeed.w * 0.5);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
  }
`;
const rainFrag = /* glsl */ `
  varying float vA;
  void main() { gl_FragColor = vec4(vec3(0.62, 0.68, 0.78) * vA * 0.55, 1.0); }
`;
const rippleVert = /* glsl */ `
  attribute vec3 aSeed;
  uniform float uTime;
  varying vec2 vUv;
  varying float vAge;
  void main() {
    vUv = uv;
    // a ripple per instance: it spreads and fades over 0.7 s, then starts again somewhere else
    float t = uTime / 0.7 + aSeed.z * 10.0;
    float cycle = floor(t);
    vAge = fract(t);
    vec2 at = (fract(vec2(sin(cycle * 12.9898 + aSeed.x * 78.2), sin(cycle * 39.346 + aSeed.y * 11.1)) * 43758.5453) - 0.5) * 16.0;
    float size = 0.06 + vAge * 0.22;
    vec3 p = vec3(at.x + position.x * size, 0.008, at.y + position.y * size);
    gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
  }
`;
const rippleFrag = /* glsl */ `
  varying vec2 vUv;
  varying float vAge;
  void main() {
    float r = length(vUv - 0.5) * 2.0;
    float ring = smoothstep(0.08, 0.0, abs(r - 0.82)) * (1.0 - vAge);
    gl_FragColor = vec4(vec3(0.7, 0.75, 0.82) * ring * 0.35, 1.0);
  }
`;

/** A small seeded random generator (mulberry32), so the rain is the same every time it is built. */
function seeded(seed: number) {
  let t = seed >>> 0;
  return () => {
    t = (t + 0x6d2b79f5) >>> 0;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r;
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

/** Rain: streaks falling round the car (motion-blurred, as a camera sees them) and rings where they land. */
function Rain({ lite }: { lite: boolean }) {
  const { streaks, ripples, mat, ripMat } = useMemo(() => {
    const rnd = seeded(7);
    const n = lite ? 1400 : 3200;
    const pos = new Float32Array(n * 6);
    const seed = new Float32Array(n * 8);
    for (let i = 0; i < n; i++) {
      pos.set([0, 0, 0, 0, 1, 0], i * 6);
      const sd = [rnd(), rnd(), rnd(), rnd()];
      seed.set([...sd, ...sd], i * 8);
    }
    const streaks = new THREE.BufferGeometry();
    streaks.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    streaks.setAttribute("aSeed", new THREE.BufferAttribute(seed, 4));
    const m = lite ? 90 : 220;
    const plane = new THREE.PlaneGeometry(1, 1);
    const ripples = new THREE.InstancedBufferGeometry();
    ripples.setIndex(plane.index);
    ripples.setAttribute("position", plane.attributes.position);
    ripples.setAttribute("uv", plane.attributes.uv);
    ripples.instanceCount = m;
    const rs = new Float32Array(m * 3);
    for (let i = 0; i < rs.length; i++) rs[i] = rnd();
    ripples.setAttribute("aSeed", new THREE.InstancedBufferAttribute(rs, 3));
    const common = { transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false, fog: false };
    const mat = new THREE.ShaderMaterial({ uniforms: { uTime: { value: 0 } }, vertexShader: rainVert, fragmentShader: rainFrag, ...common });
    const ripMat = new THREE.ShaderMaterial({ uniforms: { uTime: { value: 0 } }, vertexShader: rippleVert, fragmentShader: rippleFrag, ...common });
    return { streaks, ripples, mat, ripMat };
  }, [lite]);
  useEffect(() => () => {
    streaks.dispose();
    ripples.dispose();
    mat.dispose();
    ripMat.dispose();
  }, [streaks, ripples, mat, ripMat]);
  useFrame(({ clock }) => {
    mat.uniforms.uTime.value = clock.elapsedTime;
    ripMat.uniforms.uTime.value = clock.elapsedTime;
  });
  return (
    <>
      <lineSegments geometry={streaks} material={mat} frustumCulled={false} raycast={() => null} />
      <mesh geometry={ripples} material={ripMat} frustumCulled={false} raycast={() => null} />
    </>
  );
}

const shaftFrag = /* glsl */ `
  varying vec3 vPos;
  varying vec3 vNormal;
  varying vec3 vView;
  void main() {
    float h = clamp(vPos.y / 6.4 + 0.5, 0.0, 1.0);
    float rim = pow(abs(dot(normalize(vNormal), normalize(vView))), 2.0);
    gl_FragColor = vec4(vec3(1.0, 0.97, 0.92) * rim * pow(h, 1.6) * 0.07, 1.0);
  }
`;

/** The light from the overhead scrim, made visible by the haze: a soft column down to the car. */
function LightShaft() {
  const mat = useMemo(
    () => new THREE.ShaderMaterial({ vertexShader: beamVert, fragmentShader: shaftFrag, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, toneMapped: false }),
    [],
  );
  useEffect(() => () => mat.dispose(), [mat]);
  return (
    <mesh material={mat} position-y={3.2} scale={[4.4, 1, 1.7]} raycast={() => null} renderOrder={5}>
      <cylinderGeometry args={[1, 1.3, 6.4, 64, 1, true]} />
    </mesh>
  );
}

const skyVert = /* glsl */ `
  varying vec3 vDir;
  void main() {
    vDir = normalize(position);
    vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    gl_Position = p.xyww;
  }
`;
const tmpSun = new THREE.Vector3();
const skyFrag = /* glsl */ `
  uniform vec3 uSun;
  uniform float uDusk;
  varying vec3 vDir;
  void main() {
    vec3 d = normalize(vDir);
    float up = clamp(d.y, 0.0, 1.0);
    // haze at the horizon into a deep blue overhead, a warm glow round a low sun
    vec3 zenith = mix(vec3(0.05, 0.17, 0.52), vec3(0.10, 0.12, 0.30), uDusk);
    vec3 horizon = mix(vec3(0.70, 0.79, 0.90), vec3(1.0, 0.62, 0.38), uDusk);
    vec3 col = mix(horizon, zenith, pow(up, 0.55));
    float s = max(dot(d, normalize(uSun)), 0.0);
    col += mix(vec3(1.0, 0.78, 0.52), vec3(1.0, 0.45, 0.2), uDusk) * (pow(s, 8.0) * (0.35 + uDusk * 0.6) + pow(s, 900.0) * 6.0);
    // below the horizon: the haze carries on, a touch darker, under the floor's edge
    col = mix(col, horizon * 0.85, smoothstep(0.0, -0.08, d.y));
    gl_FragColor = vec4(col, 1.0);
  }
`;

/**
 * A simple daylight sky: horizon haze, blue overhead and the sun behind the car. `sun` runs from a
 * low, warm sun just over the horizon (0) to high noon (1).
 */
function SkyDome({ sun }: { sun: number }) {
  const mat = useMemo(
    () => new THREE.ShaderMaterial({
      uniforms: { uSun: { value: new THREE.Vector3(-0.55, 0.18, -0.8) }, uDusk: { value: 0 } },
      vertexShader: skyVert,
      fragmentShader: skyFrag,
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
    }),
    [],
  );
  useEffect(() => () => mat.dispose(), [mat]);
  useFrame((_, dt) => {
    const el = THREE.MathUtils.degToRad(3 + sun * 62);
    const goal = tmpSun.set(-0.57 * Math.cos(el), Math.sin(el), -0.82 * Math.cos(el));
    mat.uniforms.uSun.value.lerp(goal, Math.min(1, dt * 3));
    mat.uniforms.uDusk.value += (Math.max(0, 1 - sun * 2.5) - mat.uniforms.uDusk.value) * Math.min(1, dt * 3);
  });
  return (
    <mesh material={mat} scale={500} renderOrder={-10} raycast={() => null}>
      <sphereGeometry args={[1, 48, 24]} />
    </mesh>
  );
}

function Studio({ live, rig, narrow, backdrop, sun, weather }: { live: Live; rig: Rig; narrow: boolean; backdrop: BackdropId; sun: number; weather: WeatherId }) {
  const sky = backdrop === "sky";
  const wet = weather === "wet" || weather === "rain";
  const scene = useThree((s) => s.scene);
  const cove = useRef<THREE.MeshStandardMaterial>(null);
  const floor = useRef<THREE.MeshStandardMaterial>(null);
  const key = useRef<THREE.SpotLight>(null);
  const rim = useRef<THREE.SpotLight>(null);
  const hemi = useRef<THREE.HemisphereLight>(null);
  const turntable = useRef<THREE.Group>(null);

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

  useFrame((state, dt) => {
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
    // on the move the slab streams past under the car (one tile of the sheen is 2R / 5 across)
    noise.offset.x += (rig.drive * dt) / ((2 * FLOOR_R) / 5);
    if (turntable.current) turntable.current.visible = rig.drive < 0.2;
  });

  return (
    <group>
      {sky && <SkyDome sun={sun} />}
      <mesh geometry={coveGeo} receiveShadow visible={!sky}>
        <meshStandardMaterial ref={cove} color="#34363b" vertexColors roughness={0.92} metalness={0} side={THREE.BackSide} />
      </mesh>
      <mesh geometry={glowGeo} material={glow} scale={[0.995, 1, 0.995]} raycast={() => null} visible={!sky} />

      {/* dark polished concrete: blurred reflections with a satin sheen that varies across the slab; wet, it
          turns to a near mirror. Under open sky the slab runs out to the horizon, where the haze swallows it */}
      <mesh rotation-x={-Math.PI / 2} receiveShadow scale={sky ? 5 : 1}>
        <circleGeometry args={[FLOOR_R + 0.02, 160]} />
        <MeshReflectorMaterial
          ref={floor as never}
          resolution={narrow ? 512 : 1024}
          blur={wet ? [130, 44] : [260, 90]}
          mixBlur={wet ? 0.6 : 0.9}
          mixStrength={wet ? 9.5 : 7}
          mixContrast={1.15}
          depthScale={1.2}
          minDepthThreshold={0.3}
          maxDepthThreshold={1.4}
          roughnessMap={noise}
          roughness={wet ? 0.32 : 0.72}
          metalness={wet ? 0.3 : 0.15}
          color="#141518"
        />
      </mesh>

      {/* softboxes standing round the cove: a diffuser in a black frame (struck for the void and the sky) */}
      {backdrop !== "sky" && backdrop !== "void" && strips.map((m, i) => {
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
      <group position-y={6.4} rotation-x={Math.PI / 2} visible={backdrop !== "sky" && backdrop !== "void"}>
        <mesh position-z={-0.01}>
          <planeGeometry args={[9.6, 3.8]} />
          <meshBasicMaterial color="#040405" side={THREE.DoubleSide} />
        </mesh>
        <mesh material={ceiling}>
          <planeGeometry args={[9.2, 3.4]} />
        </mesh>
      </group>

      {weather === "rain" && <Rain lite={narrow} />}
      {weather === "haze" && (
        <>
          {/* dust turning in the light, and the shaft it shows up under the overhead scrim */}
          <Sparkles count={narrow ? 120 : 260} scale={[15, 6.5, 15]} position-y={3.3} size={2.2} speed={0.22} opacity={0.5} noise={1.2} color="#fff6e8" />
          {!sky && backdrop !== "void" && <LightShaft />}
        </>
      )}

      {/* turntable: a flush disc set into the floor, edged in brushed steel with a thin LED line */}
      <group ref={turntable}>
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
      </group>

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
function Reflections({ live, rig, narrow, backdrop, sun }: { live: Live; rig: Rig; narrow: boolean; backdrop: BackdropId; sun: number }) {
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
      {backdrop === "sky" && <SkyDome sun={sun} />}
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

function Stage({ mood, backdrop, grid, tuning, sun, weather, rig, lite, bloom }: {
  mood: MoodId;
  weather: WeatherId;
  sun: number;
  backdrop: BackdropId;
  grid: boolean;
  tuning: Look["tuning"];
  rig: Rig;
  lite: boolean;
  bloom: RefObject<BloomEffect | null>;
}) {
  const scene = useThree((st) => st.scene);
  const goal = useMemo(() => withBackdrop(liveOf(moodById[mood]), backdrop, sun), [mood, backdrop, sun]);
  const [live] = useState(() => withBackdrop(liveOf(moodById[mood]), backdrop));
  const fog = useRef<THREE.Fog>(null);
  const gridRef = useRef<THREE.Mesh>(null);
  const travelled = useRef(0);
  useFrame((state, dt) => {
    // the grid streams past while the car drives (it repeats every 2.5 m section)
    travelled.current = (travelled.current + rig.drive * dt) % 2.5;
    if (gridRef.current) gridRef.current.position.x = -travelled.current;
    stepLive(live, goal, 1 - Math.exp(-dt * 2.6));
    if (bloom.current) bloom.current.intensity = live.bloom * tuning.bloom;
    scene.environmentIntensity += (tuning.reflections - scene.environmentIntensity) * Math.min(1, dt * 6);
    if (fog.current) {
      fog.current.near = backdrop === "sky" ? 12 : 14;
      fog.current.far = backdrop === "sky" ? 46 : 34;
    }
    const now = state.clock.elapsedTime;
    if (rig.t0 < 0) rig.t0 = reducedMotion() ? now - 10 : now;
    // first sweep once the lights are up, then one every 12 s
    if (now - rig.sweep > 12 && now - rig.t0 > 2.4) rig.sweep = now;
  });
  const light = backdrop === "white";
  return (
    <>
      {/* colours come from the eased mood each frame */}
      <color attach="background" args={["#0a0a0b"]} />
      <fog ref={fog} attach="fog" args={["#0a0a0b", 14, 34]} />
      <Reflections live={live} rig={rig} narrow={lite} backdrop={backdrop} sun={sun} />
      <Studio live={live} rig={rig} narrow={lite} backdrop={backdrop} sun={sun} weather={weather} />
      {grid && (
        <Grid ref={gridRef} position={[0, 0.006, 0]} args={[40, 40]} infiniteGrid cellSize={0.5} sectionSize={2.5} cellThickness={0.6} sectionThickness={1.1}
          cellColor={light ? "#6d6f74" : "#4a4c52"} sectionColor={light ? "#45474c" : "#8b8e96"} fadeDistance={24} fadeStrength={1.6} />
      )}
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
function Director({ view, panel, shot, cinematic, interior, rig, onCinematicShot, onCamera, dof }: {
  view: CarView;
  panel: boolean;
  /** the cockpit view: in the driver's seat, free to look round */
  interior: boolean;
  shot: SceneProps["shot"];
  cinematic: boolean;
  rig: Rig;
  onCinematicShot: (i: number) => void;
  onCamera: (c: CameraInfo) => void;
  dof: RefObject<DepthOfFieldEffect | null>;
}) {
  const reading = useRef({ at: 0, key: "" });
  const narrow = useThree((s) => s.size.width < 768);
  const controls = useRef<OrbitControlsImpl | null>(null);
  const inside = useRef({ on: false, settled: false });
  const eyeW = useMemo(() => new THREE.Vector3(), []);
  const lookW = useMemo(() => new THREE.Vector3(), []);
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

    // the readout: 35 mm-equivalent focal length (24 mm frame height), camera height, and the angle
    // round the car in its own frame (0° is dead ahead), a few times a second when it changes
    const now = state.clock.elapsedTime;
    if (now - reading.current.at > 0.15) {
      reading.current.at = now;
      tmp.copy(cam.position).sub(rig.focus);
      const turn = rig.table?.rotation.y ?? 0;
      const az = ((THREE.MathUtils.radToDeg(Math.atan2(tmp.z, tmp.x) + turn) % 360) + 360) % 360;
      const c: CameraInfo = {
        mm: Math.round(12 / Math.tan(THREE.MathUtils.degToRad(cam.fov / 2))),
        elevation: Math.round(cam.position.y * 100) / 100,
        azimuth: Math.round(az),
        distance: Math.round(tmp.length() * 10) / 10,
      };
      const key = `${c.mm}|${c.elevation}|${c.azimuth}|${c.distance}`;
      if (key !== reading.current.key) {
        reading.current.key = key;
        onCamera(c);
      }
    }
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

    // the cockpit: glide in through the side window to the driver's eye, then look round from there
    if (interior && rig.eye && rig.look && rig.table && c) {
      const m = rig.table.matrixWorld;
      eyeW.copy(rig.eye).applyMatrix4(m);
      lookW.copy(rig.look).applyMatrix4(m);
      const ahead = tmp.copy(lookW).sub(eyeW).normalize().multiplyScalar(0.06).add(eyeW);
      if (!inside.current.on) {
        inside.current = { on: true, settled: false };
        goal.current = null;
        fov.current = 64;
      }
      // set every frame: a re-render hands the controls their outside props again
      const settled = inside.current.settled;
      c.minDistance = settled ? 0.06 : 0.001;
      c.maxDistance = settled ? 0.06 : 40;
      c.maxPolarAngle = Math.PI * 0.85;
      c.minPolarAngle = Math.PI * 0.15;
      c.enableZoom = false;
      c.rotateSpeed = -0.35; // drag the view, not the world
      if (!settled) {
        cam.position.lerp(eyeW, k * 0.7);
        c.target.lerp(ahead, k * 0.9);
        if (cam.position.distanceTo(eyeW) < 0.02) inside.current.settled = true;
      }
      c.update();
      if (cam.near !== 0.01) {
        cam.near = 0.01;
        cam.updateProjectionMatrix();
      }
      if (Math.abs(cam.fov - fov.current) > 0.01) {
        cam.fov += (fov.current - cam.fov) * k * 0.6;
        cam.updateProjectionMatrix();
      }
      if (cam.view?.enabled) cam.clearViewOffset();
      shift.current.x = shift.current.y = 0;
      return;
    }
    if (inside.current.on && c) {
      // back out to the hero view
      inside.current = { on: false, settled: false };
      c.minDistance = 1.2;
      c.maxDistance = 12;
      c.maxPolarAngle = Math.PI * 0.505;
      c.minPolarAngle = 0;
      c.enableZoom = true;
      c.rotateSpeed = 1;
      cam.near = 0.05;
      cam.updateProjectionMatrix();
      fov.current = baseFov;
      goal.current = hero.clone();
    }

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
      <PerspectiveCamera makeDefault position={start} fov={baseFov} near={0.05} far={1200} onUpdate={(c) => c.layers.enable(FX_LAYER)} />
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

/**
 * A photo of the frame just drawn: runs after the composer, while the drawing buffer still holds
 * it. A wallpaper first raises the pixel ratio to 3840 px across, waits for the composer to catch
 * up, then takes the shot and puts the ratio back.
 */
function Snapper({ snap, onSnap }: { snap: SceneProps["snap"]; onSnap: (png: string) => void }) {
  const gl = useThree((s) => s.gl);
  const setDpr = useThree((s) => s.setDpr);
  const width = useThree((s) => s.size.width);
  const taken = useRef(snap.n);
  const job = useRef<{ frames: number; dpr: number } | null>(null);
  useFrame(() => {
    if (job.current) {
      if (--job.current.frames > 0) return;
      onSnap(gl.domElement.toDataURL("image/png"));
      setDpr(job.current.dpr);
      job.current = null;
      return;
    }
    if (snap.n === taken.current) return;
    taken.current = snap.n;
    if (snap.wallpaper) {
      const dpr = gl.getPixelRatio();
      setDpr(Math.min(4, 3840 / width));
      job.current = { frames: 3, dpr };
    } else onSnap(gl.domElement.toDataURL("image/png"));
  }, 2);
  return null;
}

const FRINGE = new THREE.Vector2(0.0007, 0.0005);

function Post({ narrow, lite, cinematic, aperture, rig, bloom, dof }: {
  lite: boolean;
  narrow: boolean;
  cinematic: boolean;
  /** the everyday view's depth of field: 0 is off */
  aperture: number;
  rig: Rig;
  bloom: RefObject<BloomEffect | null>;
  dof: RefObject<DepthOfFieldEffect | null>;
}) {
  // the lens holds focus on whatever the camera orbits: the car, or the part picked out of it
  useFrame(() => {
    if (cinematic || !aperture || !dof.current) return;
    dof.current.target ??= new THREE.Vector3();
    dof.current.target.copy(rig.focus);
    dof.current.bokehScale = aperture;
  });

  // ambient occlusion seats the car on the floor and darkens its panel gaps and wheel arches; a
  // touch of film grain keeps the dark gradients from banding, and a whisper of colour fringing at
  // the frame's edges is what a real lens adds. The reel has a shallow depth of field; the everyday
  // view has one when the aperture is opened. Each is its own composer, so an unused effect costs nothing.
  const ao = !lite && <N8AO halfRes quality="medium" aoRadius={0.9} distanceFalloff={0.6} intensity={2.2} color="#000000" />;
  const fringe = !lite && <ChromaticAberration offset={FRINGE} radialModulation modulationOffset={0.4} />;
  return cinematic ? (
    <EffectComposer key={`cine${lite}`} multisampling={lite ? 0 : 4}>
      {ao || <></>}
      <DepthOfField ref={dof} worldFocusRange={2.2} bokehScale={narrow ? 2.5 : 4.5} />
      <Bloom ref={bloom} mipmapBlur intensity={0.55} luminanceThreshold={1} luminanceSmoothing={0.15} radius={0.75} />
      <ToneMapping mode={ToneMappingMode.AGX} />
      {fringe || <></>}
      <Noise premultiply blendFunction={BlendFunction.SOFT_LIGHT} opacity={0.22} />
      <Vignette offset={0.25} darkness={0.75} />
    </EffectComposer>
  ) : (
    <EffectComposer key={`view${lite}${aperture > 0}`} multisampling={lite ? 0 : 4}>
      {ao || <></>}
      {aperture > 0 ? <DepthOfField ref={dof} worldFocusRange={3.2} bokehScale={aperture} /> : <></>}
      <Bloom ref={bloom} mipmapBlur intensity={0.55} luminanceThreshold={1} luminanceSmoothing={0.15} radius={0.7} />
      <ToneMapping mode={ToneMappingMode.AGX} />
      {fringe || <></>}
      <Noise premultiply blendFunction={BlendFunction.SOFT_LIGHT} opacity={0.12} />
      <Vignette offset={0.3} darkness={0.6} />
    </EffectComposer>
  );
}

export default function ShowroomScene(props: SceneProps) {
  const narrow = typeof window !== "undefined" && window.innerWidth < 768;
  // performance mode: one pixel per pixel, no ambient occlusion or MSAA, lighter reflections
  const lite = narrow || props.look.quality === "performance";
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
      eye: null,
      drive: 0,
      look: null,
      headColor: new THREE.Color(props.look.tuning.headColor),
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
      dpr={lite ? 1 : [1, 2]}
      gl={{ antialias: false, powerPreference: "high-performance" }}
      onPointerMissed={() => props.onHover(null)}
    >
      <Stage mood={props.mood} backdrop={props.look.backdrop} grid={props.look.grid || props.look.drive} tuning={props.look.tuning} sun={props.look.sun} weather={props.look.weather} rig={rig} lite={lite} bloom={bloom} />
      <Car {...props} rig={rig} />
      <Director view={props.view} panel={props.selected.length > 0} shot={props.shot} cinematic={props.cinematic} interior={props.look.interior} rig={rig}
        onCinematicShot={props.onCinematicShot} onCamera={props.onCamera} dof={dof} />
      <Snapper snap={props.snap} onSnap={props.onSnap} />
      <Post narrow={narrow} lite={lite} cinematic={props.cinematic} aperture={props.look.aperture} rig={rig} bloom={bloom} dof={dof} />
    </Canvas>
  );
}

