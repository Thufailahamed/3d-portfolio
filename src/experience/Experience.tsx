"use client";

import { Environment, Lightformer } from "@react-three/drei";
import { Canvas } from "@react-three/fiber";
import { Suspense, useEffect, useState } from "react";
import * as THREE from "three";
import { chapter } from "@/lib/chapters";
import { useApp } from "@/store/useApp";
import Atmosphere from "./Atmosphere";
import CameraRig from "./CameraRig";
import About from "./chapters/About";
import Contact from "./chapters/Contact";
import Fades from "./chapters/Fades";
import DetailBackdrop from "./chapters/DetailBackdrop";
import Fracture from "./chapters/Fracture";
import Projects from "./chapters/Projects";
import Monolith from "./chapters/Monolith";
import Tunnel from "./chapters/Tunnel";
import AdaptiveResolution from "./AdaptiveResolution";
import { CompileGate, LoadProgress } from "./LoadTracker";
import { palette } from "./palette";
import PostFX from "./PostFX";

const tunnel = chapter("tunnel");
const monolithAtmosphereEnd = tunnel.start + (tunnel.end - tunnel.start) * 0.55;

/** The single, persistent WebGL canvas behind every page. */
export default function Experience() {
  const isMobile = useApp((s) => s.isMobile);
  const mode = useApp((s) => s.mode);
  const low = useApp((s) => s.quality === "low");
  const [frameloop, setFrameloop] = useState<"always" | "never">("always");

  // stop rendering entirely while the tab is hidden
  useEffect(() => {
    const onVis = () => setFrameloop(document.hidden ? "never" : "always");
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, []);

  return (
    <Canvas
      frameloop={frameloop}
      dpr={[1, low ? 1.25 : isMobile ? 1.5 : 2]}
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

        {/* the journey stays mounted (and cached) while a detail page is open */}
        <group visible={mode === "journey"}>
          <Monolith />
          <Fracture />
          <Tunnel />
          <Atmosphere dustCount={isMobile ? 700 : 1800} range={[-1, monolithAtmosphereEnd]} />
          <Projects />
          <About />
          <Contact />
          <Fades />
        </group>
        <DetailBackdrop />
        <CameraRig />
        <PostFX />
        <AdaptiveResolution max={low ? 1.25 : isMobile ? 1.5 : 2} />
        <CompileGate />
      </Suspense>
    </Canvas>
  );
}
