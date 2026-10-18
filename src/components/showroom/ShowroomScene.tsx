"use client";

import { ContactShadows, Environment, Lightformer, MeshReflectorMaterial, OrbitControls, PerspectiveCamera, useGLTF } from "@react-three/drei";
import { Bloom, DepthOfField, EffectComposer, ToneMapping, Vignette } from "@react-three/postprocessing";
import { Canvas, createPortal, useFrame, useThree, type ThreeEvent } from "@react-three/fiber";
import { useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { ToneMappingMode, type BloomEffect, type DepthOfFieldEffect } from "postprocessing";
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
  selected: string | null;
  exploded: boolean;
  hovered: string | null;
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
      const out = exploded || p.id === selected ? 1 : 0;
      const ghost = selected && !exploded && p.id !== selected ? 1 : 0;
      const hover = p.id === hovered && p.id !== selected ? 1 : 0;
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
      const idle = turntable && !selected && !cinematic && !rig.square && performance.now() - rig.lastDrag > 4000;
      rig.speed += ((idle && !reducedMotion() ? 0.12 : 0) - rig.speed) * k * 0.4;
      if (rig.square) {
        const near = Math.round(g.rotation.y / TAU) * TAU;
        g.rotation.y += (near - g.rotation.y) * k * 0.9;
      } else g.rotation.y += rig.speed * dt;
      if (cinematic) g.rotation.y = 0;
    }

    // ease the orbit pivot onto the picked part (where it has slid to), back to the car when cleared
    const sel = selected ? parts.get(selected) : undefined;
    const target = sel ? sel.center.clone().addScaledVector(sel.out, ease(sel.t)) : home.clone();
    if (sel && g) target.applyMatrix4(g.matrixWorld);
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

const FLOOR_R = 7; // polished floor; the cove takes over from here
const COVE_R = 3.2; // radius of the floor-to-wall curve
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

function Studio({ live, rig, narrow }: { live: Live; rig: Rig; narrow: boolean }) {
  const scene = useThree((s) => s.scene);
  const cove = useRef<THREE.MeshStandardMaterial>(null);
  const floor = useRef<THREE.MeshStandardMaterial>(null);
  const key = useRef<THREE.SpotLight>(null);
  const rim = useRef<THREE.SpotLight>(null);
  const hemi = useRef<THREE.HemisphereLight>(null);
  const ticks = useRef<THREE.Group>(null);

  const coveGeo = useMemo(() => {
    const pts: THREE.Vector2[] = [];
    for (let i = 0; i <= 24; i++) {
      const a = (i / 24) * (Math.PI / 2);
      pts.push(new THREE.Vector2(FLOOR_R + Math.sin(a) * COVE_R, COVE_R - Math.cos(a) * COVE_R));
    }
    pts.push(new THREE.Vector2(WALL_R, 16));
    return new THREE.LatheGeometry(pts, 128);
  }, []);
  const strips = useMemo(
    () => Array.from({ length: STRIPS }, () => new THREE.MeshBasicMaterial({ color: 0, toneMapped: false, fog: false })),
    [],
  );
  const ceiling = useMemo(() => new THREE.MeshBasicMaterial({ color: 0, toneMapped: false, fog: false }), []);
  const ring = useMemo(() => new THREE.MeshBasicMaterial({ color: 0, toneMapped: false }), []);
  const tick = useMemo(() => new THREE.MeshBasicMaterial({ color: 0, toneMapped: false }), []);
  const seam = useMemo(() => new THREE.MeshBasicMaterial({ color: new THREE.Color(0.1, 0.1, 0.1), toneMapped: false }), []);

  useFrame((state) => {
    const now = state.clock.elapsedTime;
    if (scene.background instanceof THREE.Color) scene.background.copy(live.bg);
    if (scene.fog instanceof THREE.Fog) scene.fog.color.copy(live.bg);
    cove.current?.color.copy(live.cove);
    floor.current?.color.copy(live.floor);
    strips.forEach((m, i) => m.color.copy(i % 2 ? live.stripB : live.stripA).multiplyScalar(live.stripLevel * power(rig, now, stripDelay(i))));
    ceiling.color.copy(live.ceiling).multiplyScalar(live.ceilingLevel * power(rig, now, 1.35, 0.5));
    // the LED ring breathes gently
    const breathe = 0.75 + Math.sin(now * 1.4) * 0.25;
    const ringOn = power(rig, now, 2.1, 0.6);
    ring.color.copy(live.ring).multiplyScalar(1.6 * breathe * ringOn);
    tick.color.copy(live.ring).multiplyScalar(0.35 * ringOn);
    if (key.current) {
      key.current.color.copy(live.key);
      key.current.intensity = live.keyI * power(rig, now, 1.7, 0.7);
    }
    if (rim.current) {
      rim.current.color.copy(live.rim);
      rim.current.intensity = live.rimI * power(rig, now, 2.0, 0.6);
    }
    if (hemi.current) hemi.current.intensity = live.hemi * (0.25 + 0.75 * power(rig, now, 1.6, 0.8));
    // turntable markings turn with the car
    if (ticks.current && rig.table) ticks.current.rotation.y = rig.table.rotation.y;
  });

  return (
    <group>
      {/* infinity cove: the floor curves up into the wall all the way round */}
      <mesh geometry={coveGeo} receiveShadow>
        <meshStandardMaterial ref={cove} color="#3a3c41" roughness={0.95} metalness={0} side={THREE.BackSide} />
      </mesh>

      {/* dark polished concrete with soft, blurred reflections of the car */}
      <mesh rotation-x={-Math.PI / 2} receiveShadow>
        <circleGeometry args={[FLOOR_R + 0.02, 128]} />
        <MeshReflectorMaterial
          ref={floor as never}
          resolution={narrow ? 512 : 1024}
          blur={[400, 120]}
          mixBlur={1}
          mixStrength={6}
          mixContrast={1.1}
          depthScale={1.1}
          minDepthThreshold={0.35}
          maxDepthThreshold={1.3}
          roughness={0.85}
          metalness={0.25}
          color="#1a1b1e"
        />
      </mesh>

      {/* light bars round the cove */}
      {strips.map((m, i) => {
        const a = stripAngle(i);
        return (
          <mesh key={i} position={[Math.sin(a) * (WALL_R - 0.25), COVE_R + 2.6, Math.cos(a) * (WALL_R - 0.25)]} rotation-y={a + Math.PI} material={m}>
            <planeGeometry args={[0.55, 4.6]} />
          </mesh>
        );
      })}

      {/* overhead soft box: a 3x2 grid of diffusers in a black frame; mostly out of shot, but the floor and paint catch it */}
      <group position-y={6.2} rotation-x={Math.PI / 2}>
        <mesh position-z={-0.01}>
          <planeGeometry args={[6.1, 2.9]} />
          <meshBasicMaterial color="#050506" side={THREE.DoubleSide} />
        </mesh>
        {[-1, 0, 1].flatMap((cx) =>
          [-0.5, 0.5].map((cy) => (
            <mesh key={`${cx}${cy}`} position={[cx * 1.95, cy * 1.3, 0]} material={ceiling}>
              <planeGeometry args={[1.85, 1.2]} />
            </mesh>
          )),
        )}
      </group>

      {/* turntable: a seam in the floor, an LED ring that breathes and markings that turn with the car */}
      <mesh rotation-x={-Math.PI / 2} position-y={0.003} material={seam}>
        <ringGeometry args={[TABLE_R - 0.03, TABLE_R + 0.03, 160]} />
      </mesh>
      <mesh rotation-x={-Math.PI / 2} position-y={0.004} material={ring}>
        <ringGeometry args={[TABLE_R + 0.035, TABLE_R + 0.055, 160]} />
      </mesh>
      <group ref={ticks} position-y={0.004}>
        {Array.from({ length: 72 }, (_, i) => {
          const a = (i / 72) * TAU;
          const long = i % 6 === 0;
          const r = TABLE_R - 0.12 - (long ? 0.04 : 0);
          return (
            <mesh key={i} position={[Math.sin(a) * r, 0, Math.cos(a) * r]} rotation={[-Math.PI / 2, 0, -a]} material={tick}>
              <planeGeometry args={[0.012, long ? 0.16 : 0.07]} />
            </mesh>
          );
        })}
      </group>

      {/* key light: a pool on the floor round the car that falls off into the cove */}
      <spotLight ref={key} position={[0, 9, 1.5]} angle={0.52} penumbra={1} intensity={0} decay={2} />
      {/* rim light from behind and above, for the silhouette */}
      <spotLight ref={rim} position={[-6, 5.5, -6]} angle={0.45} penumbra={1} intensity={0} decay={2} />
      <directionalLight position={[4, 7, 3]} intensity={1.3} castShadow shadow-mapSize={[2048, 2048]} shadow-bias={-0.0004}
        shadow-camera-left={-4} shadow-camera-right={4} shadow-camera-top={4} shadow-camera-bottom={-4} />
      <hemisphereLight ref={hemi} args={["#cfd6e6", "#0a0a0b", 0]} />
      <ContactShadows position={[0, 0.005, 0]} scale={12} resolution={1024} blur={2.2} opacity={0.88} far={2.5} />
    </group>
  );
}

/**
 * Reflections on the paint: the same rig as the visible one, re-rendered live (it is only a dozen
 * quads) so mood changes cross-fade on the bodywork and a light bar can sweep across it.
 */
function Reflections({ live, rig, narrow }: { live: Live; rig: Rig; narrow: boolean }) {
  const ceiling = useRef<THREE.Mesh>(null);
  const strips = useRef<(THREE.Mesh | null)[]>([]);
  const sweep = useRef<THREE.Mesh>(null);
  const bg = useRef<THREE.Color>(null);
  const tint = useMemo(() => new THREE.Color(), []);

  useFrame((state) => {
    const now = state.clock.elapsedTime;
    const set = (m: THREE.Mesh | null, c: THREE.Color, i: number) => (m?.material as THREE.MeshBasicMaterial | undefined)?.color.copy(c).multiplyScalar(i);
    set(ceiling.current, live.ceiling, live.envCeiling * power(rig, now, 1.35, 0.5));
    strips.current.forEach((m, i) => set(m, i % 2 ? live.stripB : live.stripA, live.envStrip * power(rig, now, stripDelay(i))));
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
      <Lightformer ref={ceiling} form="rect" position={[0, 6.2, 0]} rotation-x={Math.PI / 2} scale={[6, 2.8, 1]} />
      {Array.from({ length: STRIPS }, (_, i) => {
        const a = stripAngle(i);
        return (
          <Lightformer key={i} ref={(m: THREE.Mesh | null) => void (strips.current[i] = m)} form="rect"
            position={[Math.sin(a) * 9.8, 5.8, Math.cos(a) * 9.8]} rotation-y={a + Math.PI} scale={[0.25, 4.2, 1]} />
        );
      })}
      <Lightformer ref={sweep} form="rect" rotation-y={Math.PI} scale={[0.9, 9, 1]} visible={false} />
      <Lightformer form="rect" intensity={0.6} color="#d9dde6" position={[0, 2, 10]} scale={[16, 2.5, 1]} />
      <Lightformer form="rect" intensity={0.4} color="#ffe4c8" position={[0, 2, -10]} rotation-y={Math.PI} scale={[16, 2.5, 1]} />
      <Lightformer form="ring" intensity={1.5} color="#ffffff" position={[-5, 3.5, 4]} scale={1.6} target={[0, 0, 0]} />
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
      <fog attach="fog" args={["#0a0a0b", 10, 24]} />
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
  const scale = narrow ? 1.12 : 1.3;
  const fov = narrow ? 46 : 32;
  const hero = useMemo(() => new THREE.Vector3(...(narrow ? view.cameraNarrow : view.camera)).multiplyScalar(scale), [narrow, view, scale]);
  const pivot = useMemo(() => new THREE.Vector3(...view.target), [view]);

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
    rig.square = shot.id !== "hero";
  }, [shot, hero, pivot, rig]);

  useEffect(() => {
    cine.current = { start: -1, index: -1 };
    if (!cinematic) {
      goal.current = hero.clone();
      rig.cineLamps = false;
    }
  }, [cinematic, hero, rig]);

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
    if (Math.abs(cam.fov - fov) > 0.01) {
      cam.fov += (fov - cam.fov) * k;
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
      <PerspectiveCamera makeDefault position={start} fov={fov} near={0.05} far={60} />
      <OrbitControls ref={controls as never} makeDefault enableDamping dampingFactor={0.08} minDistance={1.2} maxDistance={11}
        maxPolarAngle={Math.PI * 0.48} enablePan={false}
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
  // the reel gets a shallow depth of field; a fresh composer for it keeps the everyday view cheap
  return cinematic ? (
    <EffectComposer key="cine" multisampling={narrow ? 0 : 4}>
      <DepthOfField ref={dof} worldFocusRange={2.2} bokehScale={narrow ? 2.5 : 4.5} />
      <Bloom ref={bloom} mipmapBlur intensity={0.55} luminanceThreshold={1} luminanceSmoothing={0.15} radius={0.75} />
      <ToneMapping mode={ToneMappingMode.ACES_FILMIC} />
      <Vignette offset={0.25} darkness={0.75} />
    </EffectComposer>
  ) : (
    <EffectComposer key="view" multisampling={narrow ? 0 : 4}>
      <Bloom ref={bloom} mipmapBlur intensity={0.55} luminanceThreshold={1} luminanceSmoothing={0.15} radius={0.7} />
      <ToneMapping mode={ToneMappingMode.ACES_FILMIC} />
      <Vignette offset={0.3} darkness={0.55} />
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
      <Director view={props.view} panel={!!props.selected} shot={props.shot} cinematic={props.cinematic} rig={rig}
        onCinematicShot={props.onCinematicShot} dof={dof} />
      <Post narrow={narrow} cinematic={props.cinematic} bloom={bloom} dof={dof} />
    </Canvas>
  );
}

