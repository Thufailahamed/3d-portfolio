"use client";

import { Grid, OrbitControls } from "@react-three/drei";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Bloom, EffectComposer, SMAA, ToneMapping, Vignette } from "@react-three/postprocessing";
import { ToneMappingMode } from "postprocessing";
import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { buildDatasets, loadCar } from "./datasets";
import { FLOOR } from "./display";
import { supported } from "./engine";
import { Lab, type Tier } from "./lab";
import { useLab } from "./store";

/** held-out points per class for precision / recall */
const N_REF = 600;

const DESKTOP: Tier = { pw: 128, ph: 64, nMax: 2048, sizes: [48, 384, 2048], bead: 0.034 };
const MOBILE: Tier = { pw: 64, ph: 64, nMax: 1024, sizes: [48, 256, 1024], bead: 0.046 };

function World() {
  const gl = useThree((s) => s.gl);
  const camera = useThree((s) => s.camera) as THREE.PerspectiveCamera;
  const size = useThree((s) => s.size);
  const spin = useLab((s) => s.spin);
  const [lab, setLab] = useState<Lab | null>(null);
  const frames = useRef(0);

  useEffect(() => {
    const set = useLab.getState().set;
    if (!supported(gl)) {
      set({ error: "This lab needs WebGL 2 with float render targets (EXT_color_buffer_float), which this browser doesn't offer." });
      return;
    }
    const tier = matchMedia("(max-width: 767px), (pointer: coarse)").matches ? MOBILE : DESKTOP;
    set({ progress: 0.1, sizes: tier.sizes, particles: tier.pw * tier.ph, train: Math.min(useLab.getState().train, tier.sizes.length - 1) });
    let dead = false;
    let made: Lab | null = null;
    loadCar().then((car) => {
      if (dead) return;
      set({ progress: 0.6, carOk: !!car });
      // let the loader paint before sampling the surfaces
      setTimeout(() => {
        if (dead) return;
        made = new Lab(gl, buildDatasets(car, tier.nMax, N_REF), tier);
        if (process.env.NODE_ENV !== "production") Object.assign(window, { __lab: made, __labStore: useLab });
        set({ progress: 0.9 });
        setLab(made);
      }, 30);
    });
    return () => {
      dead = true;
      made?.dispose();
    };
  }, [gl]);

  useFrame((_, dt) => {
    if (!lab) return;
    lab.frame(Math.min(dt, 0.05), size.height * gl.getPixelRatio(), camera.fov);
    // lift the loader once real frames are on screen
    if (++frames.current === 3) useLab.getState().set({ ready: true, progress: 1 });
  });

  return (
    <>
      <color attach="background" args={["#060709"]} />
      {lab && <primitive object={lab.display.root} />}
      <Grid
        position={[0, FLOOR, 0]}
        args={[24, 24]}
        cellSize={0.5}
        cellThickness={0.55}
        cellColor="#1a202b"
        sectionSize={2.5}
        sectionThickness={0.9}
        sectionColor="#283244"
        fadeDistance={20}
        fadeStrength={1.8}
        infiniteGrid
      />
      <OrbitControls makeDefault enableDamping dampingFactor={0.08} autoRotate={spin} autoRotateSpeed={0.45} minDistance={3.5} maxDistance={18} maxPolarAngle={Math.PI * 0.6} target={[0, -0.15, 0]} />
      <EffectComposer multisampling={0} enableNormalPass={false}>
        <Bloom mipmapBlur intensity={0.55} luminanceThreshold={0.9} luminanceSmoothing={0.25} radius={0.6} />
        <ToneMapping mode={ToneMappingMode.AGX} />
        <Vignette offset={0.3} darkness={0.55} />
        <SMAA />
      </EffectComposer>
    </>
  );
}

export default function Scene() {
  return (
    <Canvas
      flat
      dpr={[1, 1.75]}
      gl={{ antialias: false, powerPreference: "high-performance", stencil: false }}
      camera={{ fov: 36, near: 0.1, far: 200, position: [5.2, 1.5, 6.1] }}
    >
      <World />
    </Canvas>
  );
}
