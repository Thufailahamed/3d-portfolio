"use client";

import { ContactShadows, Environment, Lightformer, OrbitControls, PerspectiveCamera, useGLTF } from "@react-three/drei";
import { Canvas, useFrame, useThree, type ThreeEvent } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";

export const LYKAN_URL = "/models/lykan.glb";
const HOME_TARGET = new THREE.Vector3(0, 0.5, 0);
const ACCENT = new THREE.Color("#c8ff3d");
const GHOST = 0.18;

type Mat = THREE.MeshStandardMaterial & { transmission?: number };
type MatState = { mat: Mat; opacity: number; transparent: boolean; depthWrite: boolean; emissive: THREE.Color; glow: boolean };
type PartRec = {
  id: string;
  obj: THREE.Object3D;
  home: THREE.Vector3;
  out: THREE.Vector3;
  center: THREE.Vector3;
  t: number;
  ghost: number;
  hover: number;
  mats: MatState[];
};

export type SceneProps = {
  selected: string | null;
  exploded: boolean;
  hovered: string | null;
  onHover: (id: string | null, x?: number, y?: number) => void;
  onPick: (id: string) => void;
  onReady: (ids: string[]) => void;
};

const ease = (t: number) => t * t * (3 - 2 * t);

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
      const center = new THREE.Box3().setFromObject(obj).getCenter(new THREE.Vector3()).sub(obj.position).add(home);
      recs.set(id, { id, obj, home, out: new THREE.Vector3(...ex), center, t: 0, ghost: 0, hover: 0, mats: [] });
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
        if (!mesh.isMesh) return;
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
            };
          }
          const st = seen.get(c.uuid);
          if (st) return c;
          const base = c.userData.base;
          c.opacity = base.opacity;
          c.transparent = base.transparent;
          c.depthWrite = base.depthWrite;
          c.visible = true;
          if (c.emissive) c.emissive.copy(base.emissive);
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

function Car({ selected, exploded, hovered, onHover, onPick, onReady }: SceneProps) {
  const { scene } = useGLTF(LYKAN_URL, "/draco/");
  const parts = useParts(scene);
  const controls = useThree((s) => s.controls) as unknown as { target: THREE.Vector3; update: () => void } | null;
  const focus = useRef(HOME_TARGET.clone());

  useEffect(() => onReady([...parts.keys()]), [parts, onReady]);

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
    // ease the orbit pivot onto the picked part (where it has slid to), back to the car when cleared
    const goal = selected && parts.get(selected)
      ? parts.get(selected)!.center.clone().addScaledVector(parts.get(selected)!.out, ease(parts.get(selected)!.t))
      : HOME_TARGET;
    focus.current.lerp(goal, k * 0.8);
    if (controls) {
      controls.target.copy(focus.current);
      controls.update();
    }
  });

  return (
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
  );
}

function Studio() {
  return (
    <Environment resolution={256} frames={1}>
      <color attach="background" args={["#0b0b0c"]} />
      <Lightformer form="rect" intensity={3} position={[0, 6, 0]} rotation-x={Math.PI / 2} scale={[10, 4, 1]} />
      <Lightformer form="rect" intensity={1.6} position={[6, 2, 3]} rotation-y={-Math.PI / 2} scale={[8, 2, 1]} />
      <Lightformer form="rect" intensity={1.2} position={[-6, 2, -2]} rotation-y={Math.PI / 2} scale={[8, 2, 1]} />
      <Lightformer form="rect" intensity={0.8} position={[0, 1.5, 7]} scale={[10, 1.5, 1]} />
      <Lightformer form="ring" intensity={2} color="#ffe2c4" position={[-4, 4, 5]} scale={2} />
    </Environment>
  );
}

const START: [number, number, number] = [5.4, 2.0, 5.6];
const START_NARROW: [number, number, number] = [8.2, 3.4, 8.6];

/**
 * Wider lens on phones so the whole car fits a portrait screen. While the details panel is open the
 * view is shifted so the picked part sits in the free space: above the bottom sheet on phones, left
 * of the side panel on wider screens.
 */
function Camera({ panel }: { panel: boolean }) {
  const narrow = useThree((s) => s.size.width < 768);
  const shift = useRef({ x: 0, y: 0 });
  useFrame((state, dt) => {
    const cam = state.camera as THREE.PerspectiveCamera;
    const { width: w, height: h } = state.size;
    const goalX = panel && !narrow ? 200 : 0;
    const goalY = panel && narrow ? h * 0.24 : 0;
    const k = 1 - Math.exp(-dt * 5);
    shift.current.x += (goalX - shift.current.x) * k;
    shift.current.y += (goalY - shift.current.y) * k;
    if (Math.abs(shift.current.x) < 0.5 && Math.abs(shift.current.y) < 0.5) {
      if (cam.view?.enabled) cam.clearViewOffset();
      return;
    }
    cam.setViewOffset(w, h, shift.current.x, shift.current.y, w, h);
  });
  return <PerspectiveCamera makeDefault position={narrow ? START_NARROW : START} fov={narrow ? 46 : 34} near={0.05} far={60} />;
}

export default function LykanScene(props: SceneProps) {
  return (
    <Canvas
      shadows={{ type: THREE.PCFShadowMap }}
      dpr={[1, 2]}
      gl={{ antialias: true, toneMapping: THREE.ACESFilmicToneMapping, toneMappingExposure: 1.05 }}
      onPointerMissed={() => props.onHover(null)}
    >
      <color attach="background" args={["#0b0b0c"]} />
      <fog attach="fog" args={["#0b0b0c", 9, 22]} />
      <Studio />
      <directionalLight position={[4, 7, 3]} intensity={1.6} castShadow shadow-mapSize={[2048, 2048]}
        shadow-camera-left={-4} shadow-camera-right={4} shadow-camera-top={4} shadow-camera-bottom={-4} />
      <ambientLight intensity={0.15} />
      <Car {...props} />
      <ContactShadows position={[0, 0.001, 0]} scale={12} resolution={512} blur={2.4} opacity={0.75} far={3} />
      <mesh rotation-x={-Math.PI / 2} position={[0, -0.001, 0]} receiveShadow>
        <circleGeometry args={[14, 64]} />
        <meshStandardMaterial color="#111113" roughness={0.42} metalness={0.25} />
      </mesh>
      <OrbitControls makeDefault enableDamping dampingFactor={0.08} minDistance={1.2} maxDistance={16}
        maxPolarAngle={Math.PI * 0.49} enablePan={false} />
      <Camera panel={!!props.selected} />
    </Canvas>
  );
}

useGLTF.preload(LYKAN_URL, "/draco/");
