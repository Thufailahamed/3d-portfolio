"use client";

import { Environment, Lightformer, useGLTF, useTexture } from "@react-three/drei";
import { Canvas } from "@react-three/fiber";
import { Suspense, useEffect, useState } from "react";
import * as THREE from "three";
import { useApp } from "@/store/useApp";
import CameraRig from "./CameraRig";
import About from "./chapters/About";
import Ascent from "./chapters/Ascent";
import Board, { BOARD_URL, PAPER_URL } from "./chapters/Board";
import BuildingFlow, { BUILDING_URL } from "./chapters/BuildingFlow";
import Contact from "./chapters/Contact";
import Fades from "./chapters/Fades";
import DetailBackdrop from "./chapters/DetailBackdrop";
import Fracture from "./chapters/Fracture";
import Projects from "./chapters/Projects";
import Forest from "./chapters/Forest";
import Tunnel from "./chapters/Tunnel";
import AdaptiveResolution from "./AdaptiveResolution";
import { CompileGate, LoadProgress } from "./LoadTracker";
import { palette } from "./palette";
import PostFX from "./PostFX";
import Weather from "./Weather";

// The board and the pavilion load on demand. A load must start outside React's render (three's
// loading manager updates the progress store, and a store update mid-render is an error), so it
// starts here or in an effect, and their components only mount once it has.
const warm = {
  board: () => {
    useGLTF.preload(BOARD_URL, "/draco/");
    useTexture.preload(PAPER_URL);
    useApp.getState().set({ warmBoard: true });
  },
  flow: () => {
    useGLTF.preload(BUILDING_URL, "/draco/");
    useApp.getState().set({ warmFlow: true });
  },
};
// the page we landed on needs its assets right away (this runs as the module loads)
if (typeof window !== "undefined") {
  if (window.location.pathname === "/board") warm.board();
  if (window.location.pathname === "/flow") warm.flow();
}

/** The single, persistent WebGL canvas behind every page. */
export default function Experience() {
  const isMobile = useApp((s) => s.isMobile);
  const mode = useApp((s) => s.mode);
  const low = useApp((s) => s.quality === "low");
  const maxDpr = low ? 1.15 : isMobile ? 1.25 : 1.5;
  const [frameloop, setFrameloop] = useState<"always" | "never">("always");
  // nothing of the journey shows while the multiverse fills the screen
  const covered = useApp((s) => s.multiverseCover);

  // The board and the pavilion are only seen on their own pages. Elsewhere they load quietly a
  // few seconds after the page is ready, so a first visit doesn't download, decode and compile
  // them before anything appears (and a later visit to those pages still finds them warm).
  const ready = useApp((s) => s.ready);
  const [idle, setIdle] = useState(false);
  useEffect(() => {
    if (!ready || idle) return;
    const id = window.setTimeout(() => setIdle(true), 4000);
    return () => window.clearTimeout(id);
  }, [ready, idle]);
  const warmBoard = useApp((s) => s.warmBoard);
  const warmFlow = useApp((s) => s.warmFlow);
  useEffect(() => {
    if (!warmBoard && (mode === "board" || idle)) warm.board();
    if (!warmFlow && (mode === "flow" || idle)) warm.flow();
  }, [mode, idle, warmBoard, warmFlow]);

  // stop rendering entirely while the tab is hidden
  useEffect(() => {
    const onVis = () => setFrameloop(document.hidden ? "never" : "always");
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, []);

  return (
    <Canvas
      frameloop={covered ? "never" : frameloop}
      dpr={[1, maxDpr]}
      camera={{ fov: isMobile ? 48 : 35, near: 0.1, far: 120, position: [0, 1.3, 12.5] }}
      gl={{ antialias: false, powerPreference: "high-performance", stencil: false }}
      onCreated={({ scene }) => {
        scene.background = palette.bg;
        scene.fog = new THREE.FogExp2(palette.fog, 0.045);
      }}
    >
      <LoadProgress />
      <Suspense fallback={null}>
        <Environment resolution={128} frames={1}>
          {/* procedural studio: long soft strips give the obsidian its streaky reflections */}
          <Lightformer form="rect" intensity={2.2} color="#e9eee0" position={[0, 9, 1]} rotation-x={Math.PI / 2} scale={[3, 12, 1]} />
          <Lightformer form="rect" intensity={0.7} color="#c8ff3d" position={[-6, 2, -3]} rotation-y={Math.PI / 2.5} scale={[8, 0.4, 1]} />
          <Lightformer form="rect" intensity={0.5} color="#ffffff" position={[6, 3, 4]} rotation-y={-Math.PI / 2.5} scale={[6, 0.25, 1]} />
          {/* faint gradient softbox behind the camera so the front face isn't a black hole */}
          <Lightformer form="ring" intensity={0.35} color="#dfe3d8" position={[0, 7, 14]} scale={9} />
          {/* tall side strips draw thin highlights down the slab's edges */}
          <Lightformer form="rect" intensity={3} color="#ffffff" position={[-4, 3, 5]} rotation-y={-Math.PI / 4} scale={[0.35, 10, 1]} />
          <Lightformer form="rect" intensity={1.6} color="#ffffff" position={[4.5, 3, 4]} rotation-y={Math.PI / 4} scale={[0.25, 10, 1]} />
        </Environment>

        <group visible={mode !== "flow"}>
          <ambientLight intensity={0.03} />
          <spotLight
            position={[0.6, 13, 1.2]}
            angle={0.32}
            penumbra={1}
            intensity={120}
            decay={1.6}
            color="#eef2e6"
          />
          <pointLight position={[0, 3, -3]} intensity={6} distance={9} color="#c8ff3d" />
          {/* cool rim from behind separates the silhouette from the fog */}
          <directionalLight position={[-3, 6, -8]} intensity={0.8} color="#cfd8ff" />
        </group>

        {/* the journey stays mounted (and cached) while a detail page is open */}
        <group visible={mode === "journey"}>
          <Forest />
          <Fracture />
          <Tunnel />
          <Projects />
          <About />
          <Ascent />
          <Contact />
          <Fades />
        </group>
        <Weather />
        {warmBoard && mode === "board" && <Board />}
        {warmFlow && mode === "flow" && <BuildingFlow />}
        <DetailBackdrop />
        <CameraRig />
        <PostFX />
        <AdaptiveResolution max={maxDpr} />
        <CompileGate />
      </Suspense>
      <Suspense fallback={null}>
        {warmBoard && idle && mode !== "board" && <Board />}
        {warmFlow && idle && mode !== "flow" && <BuildingFlow />}
      </Suspense>
    </Canvas>
  );
}
