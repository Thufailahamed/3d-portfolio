"use client";

import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Bloom, EffectComposer, HueSaturation, SMAA, ToneMapping, Vignette } from "@react-three/postprocessing";
import { ToneMappingMode } from "postprocessing";
import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { Game } from "./game";
import { control, useRover } from "./store";
import { worldById, type WorldId } from "./worlds";

const MOVE_KEYS = new Set(["KeyW", "KeyA", "KeyS", "KeyD", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Space"]);

function World() {
  const { gl, scene, camera } = useThree();
  const setDpr = useThree((s) => s.setDpr);
  const isMobile = useMemo(() => matchMedia("(max-width: 767px), (pointer: coarse)").matches, []);
  const quality = isMobile ? 0 : 2;
  const [game, setGame] = useState<Game | null>(null);
  const [tier, setTier] = useState(isMobile ? 0 : 2);
  const perf = useRef({ frames: 0, time: 0, settle: 8 });
  const lights = useRover((s) => s.lights);
  const sound = useRover((s) => s.sound);

  useEffect(() => {
    const set = useRover.getState().set;
    set({ progress: 0.15 });
    let g: Game | null = null;
    // let the loader paint before the heavy texture generation
    const id = setTimeout(() => {
      g = new Game(gl, scene, camera as THREE.PerspectiveCamera, quality);
      if (process.env.NODE_ENV !== "production") (window as unknown as { __rover: Game }).__rover = g;
      set({ progress: 0.7 });
      setGame(g);
    }, 30);
    return () => {
      clearTimeout(id);
      g?.dispose();
    };
  }, [gl, scene, camera, quality]);

  useEffect(() => {
    if (!game) return;
    let live = true;
    const start = () => {
      if (!live) return;
      useRover.getState().set({ progress: 1 });
      // lift the loader once a couple of real frames have been drawn
      requestAnimationFrame(() => requestAnimationFrame(() => useRover.getState().set({ ready: true })));
      // deep links: /rover?world=mars (fly there), &land (skip the cruise), &drive (skip the landing too)
      const q = new URLSearchParams(location.search);
      const id = q.get("world") as WorldId | null;
      if (id && id in worldById) {
        useRover.getState().set({ selected: id });
        game.autoSkip = q.has("drive") ? 2 : q.has("land") ? 1 : 0;
        game.go(id);
      }
    };
    useRover.getState().set({ progress: 0.85 });
    game.precompile(game.root).then(start, start);
    return () => {
      live = false;
    };
  }, [game, gl, scene, camera]);

  useEffect(() => game?.rover.setLights(lights), [game, lights]);
  useEffect(() => control.setMuted(!sound), [game, sound]);
  useEffect(() => {
    const native = window.devicePixelRatio || 1;
    setDpr(tier === 2 ? Math.min(native, 1.5) : tier === 1 ? Math.min(native, 1.2) : 1);
  }, [tier, setDpr]);

  // —— keyboard (driving) and pointer (looking around, picking planets) ——
  useEffect(() => {
    if (!game) return;
    const el = gl.domElement;
    const onKey = (e: KeyboardEvent, down: boolean) => {
      if ((e.target as HTMLElement)?.closest?.("input, textarea") || e.metaKey || e.ctrlKey || e.altKey) return;
      if (!MOVE_KEYS.has(e.code)) return;
      control.unlock();
      game.key(e.code, down);
      e.preventDefault();
    };
    const kd = (e: KeyboardEvent) => onKey(e, true);
    const ku = (e: KeyboardEvent) => onKey(e, false);
    const blur = () => ["KeyW", "KeyA", "KeyS", "KeyD", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Space"].forEach((k) => game.key(k, false));
    let down: { x: number; y: number; id: number } | null = null;
    let last = { x: 0, y: 0 };
    let moved = 0;
    const ndc = (e: PointerEvent) => {
      const r = el.getBoundingClientRect();
      return new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    };
    const pd = (e: PointerEvent) => {
      control.unlock();
      down = { x: e.clientX, y: e.clientY, id: e.pointerId };
      last = { x: e.clientX, y: e.clientY };
      moved = 0;
    };
    let hoverT = 0;
    const pm = (e: PointerEvent) => {
      if (!down) {
        const now = performance.now();
        if (now - hoverT > 80) {
          hoverT = now;
          const h = game.hoverPick(ndc(e));
          if (h !== useRover.getState().hover) useRover.getState().set({ hover: h });
          el.style.cursor = h ? "pointer" : "";
        }
        return;
      }
      if (e.pointerId !== down.id) return;
      moved = Math.max(moved, Math.hypot(e.clientX - down.x, e.clientY - down.y));
      if (moved > 4) {
        game.drag(e.clientX - last.x, e.clientY - last.y);
        if (!el.hasPointerCapture(e.pointerId)) el.setPointerCapture(e.pointerId);
      }
      last = { x: e.clientX, y: e.clientY };
    };
    const pu = (e: PointerEvent) => {
      if (!down || e.pointerId !== down.id) return;
      if (moved <= 4) game.pick(ndc(e));
      game.endDrag();
      down = null;
    };
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      game.zoom((e.deltaMode === 1 ? 16 : 1) * e.deltaY);
    };
    const noMenu = (e: Event) => e.preventDefault();
    addEventListener("keydown", kd);
    addEventListener("keyup", ku);
    addEventListener("blur", blur);
    el.addEventListener("pointerdown", pd);
    el.addEventListener("pointermove", pm);
    el.addEventListener("pointerup", pu);
    el.addEventListener("pointercancel", pu);
    el.addEventListener("wheel", wheel, { passive: false });
    el.addEventListener("contextmenu", noMenu);
    return () => {
      removeEventListener("keydown", kd);
      removeEventListener("keyup", ku);
      removeEventListener("blur", blur);
      el.removeEventListener("pointerdown", pd);
      el.removeEventListener("pointermove", pm);
      el.removeEventListener("pointerup", pu);
      el.removeEventListener("pointercancel", pu);
      el.removeEventListener("wheel", wheel);
      el.removeEventListener("contextmenu", noMenu);
    };
  }, [game, gl]);

  useFrame((_, rawDt) => {
    if (!game) return;
    game.update(Math.min(rawDt, 0.05));
    // step the resolution down if frames run slow
    const pf = perf.current;
    if (pf.settle > 0) pf.settle -= rawDt;
    else if (rawDt < 0.25) {
      pf.frames++;
      pf.time += rawDt;
      if (pf.time > 2.5) {
        const fps = pf.frames / pf.time;
        pf.frames = pf.time = 0;
        if (fps < 42 && tier > 0) {
          setTier((t) => t - 1);
          pf.settle = 4;
        }
      }
    }
  });

  // after the composer has drawn the frame: grab it for a photo
  useFrame(() => {
    if (!game?.wantPhoto) return;
    game.wantPhoto = false;
    try {
      useRover.getState().set({ photo: gl.domElement.toDataURL("image/png") });
    } catch {
      /* tainted or lost context: no photo */
    }
  }, 2);

  return (
    <>
      {game && <primitive object={game.root} />}
      <EffectComposer key={tier} multisampling={0} enableNormalPass={false}>
        <Bloom mipmapBlur intensity={0.55} luminanceThreshold={1.4} luminanceSmoothing={0.25} radius={0.7} resolutionScale={tier === 2 ? 0.5 : 0.35} />
        <ToneMapping mode={ToneMappingMode.AGX} />
        {/* AgX is gentle on colour; a touch more saturation brings back the look of a real camera */}
        <HueSaturation saturation={0.08} />
        <Vignette offset={0.32} darkness={0.5} />
        <SMAA />
      </EffectComposer>
    </>
  );
}

export default function Scene() {
  return (
    <Canvas
      flat
      shadows={{ type: THREE.PCFSoftShadowMap }}
      dpr={[1, 1.5]}
      gl={{ antialias: false, powerPreference: "high-performance", stencil: false }}
      camera={{ fov: 42, near: 0.1, far: 4000, position: [0, 60, 100] }}
      onCreated={({ gl }) => gl.setClearColor("#000000")}
    >
      <World />
    </Canvas>
  );
}
