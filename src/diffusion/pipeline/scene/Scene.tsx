"use client";

import { ContactShadows, OrbitControls } from "@react-three/drei";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Bloom, ChromaticAberration, EffectComposer, Noise, SMAA, ToneMapping, Vignette } from "@react-three/postprocessing";
import { BlendFunction, ToneMappingMode } from "postprocessing";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import type { OrbitControls as OrbitControlsImpl } from "three-stdlib";
import { DECODE, DENOISE, getLab } from "../lab";
import { INTRO, LOOP_TOUR, OVERVIEW, SHOTS, STAGES, X, stageDuration, type Shot, type StageId } from "../story";
import { stepCursor, useLab } from "../store";
import { Hall, type Lamp } from "./Atmosphere";
import { FONT, ThemeProvider, put, type Theme } from "./common";
import Decoder, { Output } from "./Decoder";
import Flows from "./Flows";
import Guidance from "./Guidance";
import Latent from "./Latent";
import TextEncoder from "./TextEncoder";
import Tokenizer from "./Tokenizer";
import UNet from "./UNet";

/** a darkroom turned gallery: warm black, a safelight glow low on the back wall, tungsten pools on each exhibit */
const THEME: Theme = {
  bg: "#0b0908",
  floor: "#0f0c0b",
  horizon: "#2c100b",
  sky: "#0d0a09",
  key: "#f6eadb",
  rim: ["#ff9a7a", "#a9b8dc"],
  beam: "#ffe0bf",
  spot: "#fff0dc",
  display: FONT.display,
  displayItalic: FONT.displayItalic,
  fg: "#efe8dc",
  dim: "#a39a8c",
  faint: "#655c52",
  accent: "#ff5a36",
};

/** the exhibit on show is lit; the rest of the hall keeps a low glow. Everything is lit for the wide views */
const lit = (...ids: StageId[]) => () => {
  const s = useLab.getState();
  if (s.intro || s.overview) return 0.72;
  return ids.includes(STAGES[s.stage].id) ? 1 : 0;
};
const LAMPS: Lamp[] = [
  { x: X.tokens, radius: 4.4, level: lit("prompt", "tokens") },
  { x: X.text + 0.75, radius: 4.8, level: lit("text") },
  { x: X.latent - 0.8, radius: 3.8, level: lit("noise", "denoise") },
  { x: X.unet - 2.6, radius: 4.2, level: lit("denoise") },
  { x: X.unet + 2.6, radius: 4.2, level: lit("denoise") },
  { x: X.guide, radius: 3.0, level: lit("denoise") },
  { x: X.vae - 0.4, radius: 4.6, level: lit("decode") },
  { x: X.out + 0.3, radius: 3.6, level: lit("decode", "image") },
];
const SPAN: [number, number] = [X.tokens - 8, X.out + 8];

type Insets = { left: number; right: number; top: number; bottom: number };

/** where the camera stands so a shot's box fills the part of the screen the panels leave free */
function pose(shot: Shot, fov: number, W: number, H: number, ins: Insets, out: THREE.Vector3) {
  const fw = Math.max(240, W - ins.left - ins.right);
  const fh = Math.max(200, H - ins.top - ins.bottom);
  const t = Math.tan(THREE.MathUtils.degToRad(fov) / 2);
  const d = Math.max(shot.w / 2 / ((t * fw) / H), shot.h / 2 / ((t * fh) / H)) * 1.06 + 0.6;
  const cp = Math.cos(shot.pitch);
  return out.set(shot.look[0] + d * Math.sin(shot.yaw) * cp, shot.look[1] + d * Math.sin(shot.pitch), shot.look[2] + d * Math.cos(shot.yaw) * cp);
}

function shotFor(stage: number, p: number, overview: boolean): Shot {
  // development only: scripts can pin the camera to a shot of their own
  const pinned = (globalThis as { __sdShot?: Shot }).__sdShot;
  if (pinned) return pinned;
  if (overview) return OVERVIEW;
  const id = STAGES[stage].id;
  if (id !== "denoise") return SHOTS[id];
  let shot = LOOP_TOUR[0][1];
  for (const [at, sh] of LOOP_TOUR) if (p >= at) shot = sh;
  return shot;
}

/** playback, sampling, decoding and the camera: everything that moves on its own */
function Director() {
  const camera = useThree((s) => s.camera) as THREE.PerspectiveCamera;
  const controls = useThree((s) => s.controls) as OrbitControlsImpl | null;
  const look = useRef(new THREE.Vector3());
  const pos = useRef(new THREE.Vector3());
  const goalPos = useRef(new THREE.Vector3());
  const placed = useRef(false);

  useEffect(() => {
    if (!controls) return;
    const grab = () => useLab.getState().set({ follow: false });
    controls.addEventListener("start", grab);
    return () => controls.removeEventListener("start", grab);
  }, [controls]);

  useFrame((state, rawDt) => {
    const lab = getLab();
    if (!lab) return;
    const dt = Math.min(rawDt, 0.05);
    // the sampler gets a slice of every frame; playback never overtakes it
    lab.tick(9);
    const s = useLab.getState();
    let { stage, p, playing } = s;
    const computed = lab.run?.steps.length ?? 0;
    if (playing) {
      const dur = stageDuration(stage, s.steps);
      p += (dt * s.speed) / dur;
      if (stage === DENOISE) p = Math.min(p, computed / s.steps);
      if (stage === DECODE && s.decode.status !== "done" && s.decode.status !== "error") p = Math.min(p, 0.9);
      if (p >= 1) {
        if (stage < STAGES.length - 1) {
          stage++;
          p = 0;
        } else {
          p = 1;
          playing = false;
        }
      }
    }
    if (stage >= DECODE && lab.run?.z0 && s.decode.status === "idle") void lab.decode();
    if (stage !== s.stage || p !== s.p || playing !== s.playing) s.set({ stage, p, playing });

    // the latent on show: z_T until the loop starts, z_0 after it
    const cursor = stage < DENOISE ? 0 : stage > DENOISE ? s.steps : stepCursor(p, s.steps);
    lab.show(cursor, stage >= DENOISE);

    // centre the projection on the free part of the screen
    const { width: W, height: H } = state.size;
    const ins = s.insets;
    // behind the title card the hall sits to the right of the type (above it, on a phone)
    if (s.intro) camera.setViewOffset(W, H, W < 768 ? 0 : -W * 0.2, W < 768 ? H * 0.16 : 0, W, H);
    else camera.setViewOffset(W, H, (ins.right - ins.left) / 2, (ins.bottom - ins.top) / 2, W, H);

    if (!controls) return;
    // the fog follows the shot, so a close-up keeps its depth and the overview stays visible
    const fog = state.scene.fog as THREE.Fog | null;
    if (fog) {
      const dist = camera.position.distanceTo(controls.target);
      put(fog, "near", Math.max(18, dist * 0.85));
      put(fog, "far", Math.max(70, dist * 2.4));
    }
    // the opening: standing at the door of the hall, looking down the line of lit exhibits
    if (s.intro) {
      const t = state.clock.elapsedTime;
      goalPos.current.set(INTRO.from[0] + Math.sin(t * 0.05) * 2.2, INTRO.from[1] + Math.sin(t * 0.08) * 0.25, INTRO.from[2] + Math.cos(t * 0.05) * 0.8);
      if (!placed.current) {
        pos.current.copy(goalPos.current);
        look.current.set(...INTRO.look);
        placed.current = true;
      }
      const k = 1 - Math.exp(-1.2 * dt);
      pos.current.lerp(goalPos.current, k);
      look.current.lerp(goalPos.current.set(INTRO.look[0] + Math.sin(t * 0.04) * 1.5, INTRO.look[1], INTRO.look[2]), k);
      camera.position.copy(pos.current);
      controls.target.copy(look.current);
      controls.update();
      return;
    }
    const shot = shotFor(stage, p, s.overview);
    if (!placed.current) {
      pose(shot, camera.fov, W, H, ins, pos.current);
      look.current.set(...shot.look);
      placed.current = true;
    }
    if (!s.follow) return;
    const goal = pose(shot, camera.fov, W, H, ins, goalPos.current);
    // the long loop gets a slow drift, so the U-Net reads in depth
    if (STAGES[stage].id === "denoise" && !s.overview) goal.setX(goal.x + Math.sin(state.clock.elapsedTime * 0.12) * 0.8);
    const k = 1 - Math.exp(-1.5 * dt);
    pos.current.lerp(goal, k);
    look.current.lerp(goalPos.current.set(...shot.look), 1 - Math.exp(-1.8 * dt));
    camera.position.copy(pos.current);
    controls.target.copy(look.current);
    controls.update();
  });

  // when the user asks to follow again, start from where the camera is
  const follow = useLab((s) => s.follow);
  useEffect(() => {
    if (follow && controls) {
      pos.current.copy(camera.position);
      look.current.copy(controls.target);
    }
  }, [follow, controls, camera]);
  return null;
}

function Stations() {
  const ready = useLab((s) => s.status === "ready");
  if (!ready) return null;
  return (
    <>
      <Tokenizer />
      <TextEncoder />
      <Latent />
      <UNet />
      <Guidance />
      <Decoder />
      <Output />
      <Flows />
      {/* soft grounding under everything that stands on the floor, rendered once */}
      <ContactShadows position={[0, 0.004, 0]} scale={[92, 22]} resolution={2048} blur={2.4} opacity={0.7} far={5} frames={1} color="#000000" />
    </>
  );
}

export default function Scene() {
  const lite = useMemo(() => typeof window !== "undefined" && matchMedia("(max-width: 767px), (pointer: coarse)").matches, []);
  return (
    <Canvas
      flat
      dpr={lite ? [1, 1.5] : [1, 1.75]}
      gl={{ antialias: false, powerPreference: "high-performance", stencil: false }}
      camera={{ fov: 34, near: 0.1, far: 260, position: INTRO.from }}
    >
      <ThemeProvider value={THEME}>
        <color attach="background" args={[THEME.bg]} />
        <fog attach="fog" args={[THEME.bg, 30, 95]} />
        <hemisphereLight args={["#efe6da", "#1a120d", 0.42]} />
        <directionalLight position={[-10, 16, 12]} intensity={1.2} color="#fff0de" />
        <directionalLight position={[14, 8, -10]} intensity={0.45} color="#c9d2f0" />
        <Hall theme={THEME} lamps={LAMPS} span={SPAN} lite={lite} />
        <Stations />
        <Director />
        <OrbitControls makeDefault enableDamping dampingFactor={0.08} minDistance={2} maxDistance={120} maxPolarAngle={Math.PI * 0.49} target={INTRO.look} />
        <EffectComposer multisampling={0} enableNormalPass={false}>
          <Bloom mipmapBlur intensity={0.62} luminanceThreshold={0.78} luminanceSmoothing={0.22} radius={0.62} />
          {/* Khronos PBR Neutral: keeps the decoded image's colours where they are */}
          <ToneMapping mode={ToneMappingMode.NEUTRAL} />
          <ChromaticAberration offset={[0.00045, 0.0003]} radialModulation modulationOffset={0.35} />
          <Vignette offset={0.28} darkness={0.72} />
          {/* film grain, stronger in the light than in the blacks */}
          <Noise premultiply blendFunction={BlendFunction.SOFT_LIGHT} opacity={0.2} />
          <SMAA />
        </EffectComposer>
      </ThemeProvider>
    </Canvas>
  );
}

