"use client";

import { ContactShadows, Environment, Lightformer, MeshReflectorMaterial, OrbitControls, PerspectiveCamera, useGLTF } from "@react-three/drei";
import { Bloom, EffectComposer, ToneMapping, Vignette } from "@react-three/postprocessing";
import { Canvas, useFrame, useThree, type ThreeEvent } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import { ToneMappingMode } from "postprocessing";
import * as THREE from "three";

import type { CarView } from "@/content/cars";

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
  url: string;
  view: CarView;
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

function Car({ url, view, selected, exploded, hovered, onHover, onPick, onReady }: SceneProps) {
  const { scene } = useGLTF(url, "/draco/");
  const home = useMemo(() => new THREE.Vector3(...view.target), [view]);
  const parts = useParts(scene);
  const controls = useThree((s) => s.controls) as unknown as { target: THREE.Vector3; update: () => void } | null;
  const focus = useRef<THREE.Vector3 | null>(null);

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
      : home;
    focus.current ??= home.clone();
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

// ---------------------------------------------------------------------- the studio

const BG = "#0a0a0b";
const FLOOR_R = 7; // polished floor; the cove takes over from here
const COVE_R = 3.2; // radius of the floor-to-wall curve
const WALL_R = FLOOR_R + COVE_R;
const STRIPS = 8; // light bars standing around the cove

/** An infinity cove: the floor curves up into the wall all the way round, like a photo studio. */
function Cove() {
  const geo = useMemo(() => {
    const pts: THREE.Vector2[] = [];
    for (let i = 0; i <= 24; i++) {
      const a = (i / 24) * (Math.PI / 2);
      pts.push(new THREE.Vector2(FLOOR_R + Math.sin(a) * COVE_R, COVE_R - Math.cos(a) * COVE_R));
    }
    pts.push(new THREE.Vector2(WALL_R, 16));
    return new THREE.LatheGeometry(pts, 128);
  }, []);
  return (
    <mesh geometry={geo} receiveShadow>
      <meshStandardMaterial color="#3a3c41" roughness={0.95} metalness={0} side={THREE.BackSide} />
    </mesh>
  );
}

/** Dark polished concrete with soft, blurred reflections of the car. */
function Floor({ narrow }: { narrow: boolean }) {
  return (
    <mesh rotation-x={-Math.PI / 2} receiveShadow>
      <circleGeometry args={[FLOOR_R + 0.02, 128]} />
      <MeshReflectorMaterial
        resolution={narrow ? 512 : 1024}
        blur={[400, 120]}
        mixBlur={1}
        mixStrength={5}
        mixContrast={1}
        depthScale={1.1}
        minDepthThreshold={0.35}
        maxDepthThreshold={1.3}
        roughness={0.9}
        metalness={0.2}
        color="#1a1b1e"
      />
    </mesh>
  );
}

/** What the camera sees of the lighting rig: light bars round the cove, a turntable ring, a soft box. */
function Rig() {
  const bar = useMemo(() => new THREE.MeshBasicMaterial({ color: new THREE.Color(2.4, 2.35, 2.25), toneMapped: false, fog: false }), []);
  const dim = useMemo(() => new THREE.MeshBasicMaterial({ color: new THREE.Color(0.14, 0.14, 0.135), toneMapped: false }), []);
  const strips = useMemo(
    () =>
      Array.from({ length: STRIPS }, (_, i) => {
        const a = (i / STRIPS) * Math.PI * 2 + Math.PI / STRIPS;
        return { a, x: Math.sin(a) * (WALL_R - 0.25), z: Math.cos(a) * (WALL_R - 0.25) };
      }),
    [],
  );
  return (
    <group>
      {strips.map(({ a, x, z }) => (
        <mesh key={a} position={[x, COVE_R + 2.6, z]} rotation-y={a + Math.PI} material={bar}>
          <planeGeometry args={[0.55, 4.6]} />
        </mesh>
      ))}
      {/* turntable seam */}
      <mesh rotation-x={-Math.PI / 2} position-y={0.003} material={dim}>
        <ringGeometry args={[3.42, 3.44, 160]} />
      </mesh>
      {/* overhead soft box: mostly out of shot, but the floor catches it */}
      <mesh position-y={6.2} rotation-x={Math.PI / 2} material={bar}>
        <planeGeometry args={[5.5, 2.4]} />
      </mesh>
    </group>
  );
}

/** Reflections on the paint: the same rig as the visible one, so the highlights read as real. */
function Reflections() {
  return (
    <Environment resolution={512} frames={1}>
      <color attach="background" args={["#08080a"]} />
      <Lightformer form="rect" intensity={4} position={[0, 6.2, 0]} rotation-x={Math.PI / 2} scale={[5.5, 2.4, 1]} />
      {Array.from({ length: STRIPS }, (_, i) => {
        const a = (i / STRIPS) * Math.PI * 2 + Math.PI / STRIPS;
        return (
          <Lightformer key={i} form="rect" intensity={3} position={[Math.sin(a) * 9.8, 5.8, Math.cos(a) * 9.8]}
            rotation-y={a + Math.PI} scale={[0.25, 4.2, 1]} />
        );
      })}
      <Lightformer form="rect" intensity={0.6} color="#d9dde6" position={[0, 2, 10]} scale={[16, 2.5, 1]} />
      <Lightformer form="rect" intensity={0.4} color="#ffe4c8" position={[0, 2, -10]} rotation-y={Math.PI} scale={[16, 2.5, 1]} />
      <Lightformer form="ring" intensity={1.5} color="#ffffff" position={[-5, 3.5, 4]} scale={1.6} target={[0, 0, 0]} />
    </Environment>
  );
}

/**
 * Wider lens on phones so the whole car fits a portrait screen. While the details panel is open the
 * view is shifted so the picked part sits in the free space: above the bottom sheet on phones, left
 * of the side panel on wider screens.
 */
function Camera({ panel, view }: { panel: boolean; view: CarView }) {
  const narrow = useThree((s) => s.size.width < 768);
  const shift = useRef({ x: 0, y: 0 });
  useFrame((state, dt) => {
    const cam = state.camera as THREE.PerspectiveCamera;
    const { width: w, height: h } = state.size;
    // wide screens: the title column sits on the left, so the car stands right of centre
    const goalX = narrow ? 0 : panel ? 210 : w >= 1024 ? -w * 0.08 : 0;
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
  const pos = useMemo(() => (narrow ? view.cameraNarrow : view.camera).map((v) => v * (narrow ? 1.12 : 1.3)) as [number, number, number], [narrow, view]);
  return <PerspectiveCamera makeDefault position={pos} fov={narrow ? 46 : 32} near={0.05} far={60} />;
}

/** A slow turntable spin while nobody is looking at a part; any drag pauses it for a while. */
function Controls({ idle }: { idle: boolean }) {
  const last = useRef(-Infinity);
  const reduce = useMemo(() => typeof matchMedia !== "undefined" && matchMedia("(prefers-reduced-motion: reduce)").matches, []);
  const ref = useRef<{ autoRotate: boolean }>(null);
  useFrame(() => {
    if (ref.current) ref.current.autoRotate = idle && !reduce && performance.now() - last.current > 6000;
  });
  return (
    <OrbitControls ref={ref as never} makeDefault enableDamping dampingFactor={0.08} minDistance={1.2} maxDistance={11}
      maxPolarAngle={Math.PI * 0.48} enablePan={false} autoRotateSpeed={0.35}
      onStart={() => (last.current = Infinity)}
      onEnd={() => (last.current = performance.now())} />
  );
}

function Stage({ narrow }: { narrow: boolean }) {
  return (
    <>
      <color attach="background" args={[BG]} />
      <fog attach="fog" args={[BG, 10, 24]} />
      <Reflections />
      <Cove />
      <Floor narrow={narrow} />
      <Rig />
      {/* key light: a pool on the floor round the car that falls off into the cove */}
      <spotLight position={[0, 9, 1.5]} angle={0.52} penumbra={1} intensity={160} decay={2} color="#fff6ec" />
      <directionalLight position={[4, 7, 3]} intensity={1.3} castShadow shadow-mapSize={[2048, 2048]} shadow-bias={-0.0004}
        shadow-camera-left={-4} shadow-camera-right={4} shadow-camera-top={4} shadow-camera-bottom={-4} />
      <hemisphereLight args={["#cfd6e6", "#0a0a0b", 0.6]} />
      <ContactShadows position={[0, 0.004, 0]} scale={12} resolution={1024} blur={2.2} opacity={0.85} far={2.5} />
    </>
  );
}

export default function ShowroomScene(props: SceneProps) {
  const narrow = typeof window !== "undefined" && window.innerWidth < 768;
  return (
    <Canvas
      shadows={{ type: THREE.PCFShadowMap }}
      dpr={[1, 2]}
      gl={{ antialias: false, powerPreference: "high-performance" }}
      onPointerMissed={() => props.onHover(null)}
    >
      <Stage narrow={narrow} />
      <Car {...props} />
      <Controls idle={!props.selected} />
      <Camera panel={!!props.selected} view={props.view} />
      <EffectComposer multisampling={narrow ? 0 : 4}>
        <Bloom mipmapBlur intensity={0.55} luminanceThreshold={1} luminanceSmoothing={0.15} radius={0.7} />
        <ToneMapping mode={ToneMappingMode.ACES_FILMIC} />
        <Vignette offset={0.3} darkness={0.55} />
      </EffectComposer>
    </Canvas>
  );
}
