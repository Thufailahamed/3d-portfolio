"use client";

import { ContactShadows, OrbitControls } from "@react-three/drei";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Bloom, ChromaticAberration, EffectComposer, Noise, SMAA, ToneMapping, Vignette } from "@react-three/postprocessing";
import { BlendFunction, ToneMappingMode } from "postprocessing";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import type { OrbitControls as OrbitControlsImpl } from "three-stdlib";
import { getLab } from "../lab";
import { Hall, type Lamp } from "@/diffusion/pipeline/scene/Atmosphere";
import { INTRO, LIVE_SHOT, OVERVIEW, SHOTS, STAGES, X, stageDuration, type Shot, type StageId } from "../story";
import { useVoice } from "../store";
import { C, FONT_DISPLAY, ThemeProvider, put, type Theme } from "./common";
import Decoder, { shownAttempt } from "./Decoder";
import Detector from "./Detector";
import Encoder from "./Encoder";
import Flows from "./Flows";
import Fourier from "./Fourier";
import Mel from "./Mel";
import Microphone from "./Microphone";
import Resampler from "./Resampler";
import Transcript from "./Transcript";

/** a recording studio at night: cool steel, a teal wash low on the back wall, a tungsten lamp over each stage */
const THEME: Theme = {
  bg: "#06080b",
  floor: "#090b0e",
  horizon: "#0c1e27",
  sky: "#07090c",
  key: "#e6edf5",
  rim: ["#8fb0ff", "#ffc88a"],
  beam: "#ffd6a2",
  spot: "#ffe3c0",
  display: FONT_DISPLAY,
  fg: C.fg,
  dim: C.dim,
  faint: C.faint,
  accent: C.speech,
};

/** the stage on show is lit; recording lights the microphone and the detector */
const lit = (...ids: StageId[]) => () => {
  const s = useVoice.getState();
  if (getLab()?.live) return ids.includes("sound") || ids.includes("vad") ? 1 : 0;
  if (s.intro || s.overview) return 0.72;
  return ids.includes(STAGES[s.stage].id) ? 1 : 0;
};
const LAMPS: Lamp[] = [
  { x: X.mic + 0.9, radius: 4.2, level: lit("sound") },
  { x: X.vad, radius: 4.7, level: lit("vad") },
  { x: X.resample, radius: 4.7, level: lit("resample") },
  { x: X.stft - 1.4, radius: 5.2, level: lit("stft") },
  { x: X.mel, radius: 5.2, level: lit("mel") },
  { x: X.encoder - 0.3, radius: 4.6, level: lit("encoder") },
  { x: X.decoder, radius: 5.2, level: lit("decoder") },
  { x: X.text, radius: 4.8, level: lit("text") },
];
const SPAN: [number, number] = [X.mic - 8, X.text + 8];

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

function shotFor(stage: number, overview: boolean): Shot {
  // development only: scripts can pin the camera to a shot of their own
  const pinned = (globalThis as { __voiceShot?: Shot }).__voiceShot;
  if (pinned) return pinned;
  if (getLab()?.live) return LIVE_SHOT;
  if (overview) return OVERVIEW;
  return SHOTS[STAGES[stage].id];
}

/** how far into a stage playback may go before the work it shows exists */
function gate(stage: number) {
  const s = useVoice.getState();
  const r = getLab()?.run;
  if (!r) return 0;
  const id = STAGES[stage].id;
  if (id === "encoder") return s.enc === "done" || s.enc === "error" ? 1 : 0.55;
  if (id === "decoder") {
    if (s.dec === "done" || s.dec === "error") return 1;
    const n = shownAttempt(r)?.steps?.length ?? 0;
    return n ? (n - 0.5) / Math.max(n + 4, 10) : 0;
  }
  if (id === "text") return s.align === "done" || s.align === "error" ? 1 : 0.35;
  return 1;
}

/** playback and the camera */
function Director() {
  const camera = useThree((s) => s.camera) as THREE.PerspectiveCamera;
  const controls = useThree((s) => s.controls) as OrbitControlsImpl | null;
  const look = useRef(new THREE.Vector3());
  const pos = useRef(new THREE.Vector3());
  const goalPos = useRef(new THREE.Vector3());
  const placed = useRef(false);

  useEffect(() => {
    if (!controls) return;
    const grab = () => useVoice.getState().set({ follow: false });
    controls.addEventListener("start", grab);
    return () => controls.removeEventListener("start", grab);
  }, [controls]);

  useFrame((state, rawDt) => {
    const lab = getLab();
    if (!lab) return;
    // development only: scripts inspect the scene graph
    if (process.env.NODE_ENV !== "production") (globalThis as { __voiceScene?: THREE.Scene }).__voiceScene = state.scene;
    const dt = Math.min(rawDt, 0.05);
    const s = useVoice.getState();
    let { stage, p, playing } = s;
    if (playing && !lab.live && lab.run) {
      const n = shownAttempt(lab.run)?.steps?.length ?? 0;
      p = Math.min(p + (dt * s.speed) / stageDuration(stage, n), gate(stage));
      if (p >= 1) {
        if (stage < STAGES.length - 1) {
          stage++;
          p = 0;
        } else {
          p = 1;
          playing = false;
        }
      }
      if (stage !== s.stage || p !== s.p || playing !== s.playing) s.set({ stage, p, playing });
    }

    const { width: W, height: H } = state.size;
    const ins = s.insets;
    // behind the title card the hall sits to the right of the type (above it, on a phone)
    if (s.intro && !lab.live) camera.setViewOffset(W, H, W < 768 ? 0 : -W * 0.2, W < 768 ? H * 0.16 : 0, W, H);
    else camera.setViewOffset(W, H, (ins.right - ins.left) / 2, (ins.bottom - ins.top) / 2, W, H);
    if (!controls) return;
    const fog = state.scene.fog as THREE.Fog | null;
    if (fog) {
      const dist = camera.position.distanceTo(controls.target);
      put(fog, "near", Math.max(18, dist * 0.85));
      put(fog, "far", Math.max(70, dist * 2.4));
    }
    // the opening: at the studio door, looking down the line of lit stages
    if (s.intro && !lab.live) {
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
    const shot = shotFor(stage, s.overview);
    if (!placed.current) {
      pose(shot, camera.fov, W, H, ins, pos.current);
      look.current.set(...shot.look);
      placed.current = true;
    }
    if (!s.follow && !lab.live) return;
    const goal = pose(shot, camera.fov, W, H, ins, goalPos.current);
    // a slow drift, so the panels read in depth
    if (!s.overview) goal.setX(goal.x + Math.sin(state.clock.elapsedTime * 0.11) * 0.45);
    pos.current.lerp(goal, 1 - Math.exp(-1.5 * dt));
    look.current.lerp(goalPos.current.set(...shot.look), 1 - Math.exp(-1.8 * dt));
    camera.position.copy(pos.current);
    controls.target.copy(look.current);
    controls.update();
  });

  // when the user asks to follow again, start from where the camera is
  const follow = useVoice((s) => s.follow);
  useEffect(() => {
    if (follow && controls) {
      pos.current.copy(camera.position);
      look.current.copy(controls.target);
    }
  }, [follow, controls, camera]);
  return null;
}

function Stations() {
  const ready = useVoice((s) => s.status === "ready");
  if (!ready) return null;
  return (
    <>
      <Microphone />
      <Detector />
      <Resampler />
      <Fourier />
      <Mel />
      <Encoder />
      <Decoder />
      <Transcript />
      <Flows />
      <ContactShadows position={[0, 0.004, 0]} scale={[100, 22]} resolution={2048} blur={2.4} opacity={0.6} far={5} frames={1} color="#000000" />
    </>
  );
}

export default function Scene() {
  const lite = useMemo(() => typeof window !== "undefined" && matchMedia("(max-width: 767px), (pointer: coarse)").matches, []);
  return (
    <Canvas flat dpr={lite ? [1, 1.5] : [1, 1.75]} gl={{ antialias: false, powerPreference: "high-performance", stencil: false }} camera={{ fov: 34, near: 0.1, far: 280, position: INTRO.from }}>
      <ThemeProvider value={THEME}>
        <color attach="background" args={[THEME.bg]} />
        <fog attach="fog" args={[THEME.bg, 30, 95]} />
        <hemisphereLight args={["#dfe7f0", "#0d1014", 0.42]} />
        <directionalLight position={[-10, 16, 12]} intensity={1.2} color="#fff0de" />
        <directionalLight position={[14, 8, -10]} intensity={0.5} color="#bcd0ff" />
        <Hall theme={THEME} lamps={LAMPS} span={SPAN} lite={lite} />
        <Stations />
        <Director />
        <OrbitControls makeDefault enableDamping dampingFactor={0.08} minDistance={2} maxDistance={130} maxPolarAngle={Math.PI * 0.49} target={INTRO.look} />
        <EffectComposer multisampling={0} enableNormalPass={false}>
          <Bloom mipmapBlur intensity={0.62} luminanceThreshold={0.78} luminanceSmoothing={0.22} radius={0.62} />
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
