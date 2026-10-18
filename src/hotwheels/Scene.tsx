"use client";

import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Bloom, DepthOfField, EffectComposer, N8AO, SMAA, ToneMapping, Vignette } from "@react-three/postprocessing";
import { ToneMappingMode, type BloomEffect, type DepthOfFieldEffect } from "postprocessing";
import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { CameraRig, STOP_FOV, type SafeRect } from "./camera";
import { Fx } from "./fx";
import { Game } from "./game";
import { ATTRACTIONS, buildPark, type Park } from "./park";
import { ParkView } from "./scenery";
import { Sim, initPhysics } from "./sim";
import { stopSound, unlockSound } from "./sound";
import { control, useHW } from "./store";
import { YARD, roadAt } from "./yard";

const DAY = { bg: new THREE.Color("#d8cfc2"), sun: new THREE.Color("#fff0dc"), hemi: new THREE.Color("#f4efe6"), ground: new THREE.Color("#8a6e52") };
const NIGHT = { bg: new THREE.Color("#0b0f1c"), sun: new THREE.Color("#8fa8ff"), hemi: new THREE.Color("#33406a"), ground: new THREE.Color("#141018") };
/** the window light comes from behind the park and to the left */
const SUN = new THREE.Vector3(-0.42, 0.78, -0.46).normalize();

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const damp = (a: number, b: number, rate: number, dt: number) => lerp(a, b, 1 - Math.exp(-rate * dt));

function Environment() {
  const get = useThree((s) => s.get);
  useEffect(() => {
    const { gl, scene } = get();
    const pmrem = new THREE.PMREMGenerator(gl);
    const env = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    scene.environment = env;
    scene.environmentIntensity = 0.55;
    return () => {
      scene.environment = null;
      env.dispose();
      pmrem.dispose();
    };
  }, [get]);
  return null;
}

/**
 * The part of the screen the page's interface leaves clear (in NDC): the attraction card down the
 * left on wider screens, the bar along the top, the launch button and the garage along the bottom.
 */
function safeRect(w: number, h: number, hud: boolean): SafeRect {
  if (!hud) return { x0: -0.9, x1: 0.9, y0: -0.86, y1: 0.86 };
  const md = w >= 768;
  const left = md ? Math.min(330, w * 0.3) + 40 : 14;
  const right = 22;
  const top = md ? 84 : 128;
  // the launch button (and its power meter) stand above the garage
  const bottom = md ? 318 : 300;
  const nx = (px: number) => (px / w) * 2 - 1;
  const ny = (py: number) => 1 - (py / h) * 2;
  return { x0: nx(left), x1: nx(w - right), y0: ny(h - bottom), y1: ny(top) };
}

/** The minimap: every track's outline as an SVG path over a square-ish box around the park. */
function mapOf(park: Park) {
  // the tracks and the Stunt Yard in front of them
  const b = park.bounds.clone().expandByPoint(new THREE.Vector3(YARD.x - YARD.w / 2, 0, YARD.z - YARD.d / 2)).expandByPoint(new THREE.Vector3(YARD.x + YARD.w / 2, 0, YARD.z + YARD.d / 2));
  const pad = 14;
  const x0 = b.min.x - pad;
  const z0 = b.min.z - pad;
  const w = b.max.x - b.min.x + pad * 2;
  const h = ((b.max.z - b.min.z + pad * 2) / w) * 100;
  const color = (id: string) => ATTRACTIONS.find((a) => a.tracks.includes(id) || (a.id === "jump" && id === "landing"))?.accent ?? "#ffffff";
  const paths = park.tracks.map((t) => {
    let d = "";
    for (let i = 0; i < t.n; i += 6) d += `${i ? "L" : "M"}${(((t.p[i * 3] - x0) / w) * 100).toFixed(1)},${(((t.p[i * 3 + 2] - z0) / w) * 100).toFixed(1)}`;
    return { d, color: color(t.id) };
  });
  let road = "";
  for (let i = 0; i <= 80; i++) {
    const { p } = roadAt(i / 80);
    road += `${i ? "L" : "M"}${(((p.x - x0) / w) * 100).toFixed(1)},${(((p.z - z0) / w) * 100).toFixed(1)}`;
  }
  paths.push({ d: road, color: "#ff7a00" });
  return { box: { x0, z0, w }, map: { paths, h } };
}

type Built = { park: Park; sim: Sim; view: ParkView; fx: Fx; game: Game; rig: CameraRig };

function World() {
  const { camera, gl, scene } = useThree();
  const [state, setState] = useState<Built | null>(null);
  const sun = useRef<THREE.DirectionalLight>(null);
  const hemi = useRef<THREE.HemisphereLight>(null);
  const head = useRef<THREE.SpotLight>(null);
  const fog = useRef<THREE.Fog>(null);
  const dof = useRef<DepthOfFieldEffect>(null);
  const bloom = useRef<BloomEffect>(null);
  const isMobile = useMemo(() => matchMedia("(max-width: 767px), (pointer: coarse)").matches, []);
  const [tier, setTier] = useState(isMobile ? 0 : 2);
  const tierRef = useRef(tier);
  const perf = useRef({ frames: 0, time: 0, settle: 6 });
  const setDpr = useThree((s) => s.setDpr);
  const nightOn = useHW((s) => s.night);
  const night = useRef(0);
  useEffect(() => {
    tierRef.current = tier;
    const native = window.devicePixelRatio || 1;
    setDpr(tier === 2 ? Math.min(native, 1.5) : tier === 1 ? Math.min(native, 1.25) : 1);
  }, [tier, setDpr]);

  // —— build ——
  useEffect(() => {
    let cancelled = false;
    let built: Built | null = null;
    (async () => {
      const set = useHW.getState().set;
      set({ progress: 0.05 });
      await initPhysics();
      if (cancelled) return;
      set({ progress: 0.2 });
      const park = buildPark();
      const sim = new Sim(park);
      set({ progress: 0.4 });
      // let the loader paint between the heavy steps
      await new Promise((r) => setTimeout(r, 16));
      const aniso = gl.capabilities.getMaxAnisotropy();
      const view = new ParkView(park, sim, aniso);
      set({ progress: 0.75 });
      await new Promise((r) => setTimeout(r, 16));
      const fx = new Fx();
      for (const p of park.props) if (p.kind === "ring") fx.setRing(new THREE.Vector3(...p.at), p.r, p.yaw);
      const game = new Game(park, sim, view, fx, camera, aniso);
      const rig = new CameraRig(park, sim);
      const { box, map } = mapOf(park);
      game.setMapBox(box);
      if (cancelled) {
        sim.dispose();
        view.dispose();
        return;
      }
      built = { park, sim, view, fx, game, rig };
      control.press = () => game.press();
      control.release = () => game.release();
      control.launchAll = () => game.launchAll();
      control.reset = () => game.reset();
      control.race = () => game.press();
      control.replay = () => (game.replaying ? game.stopReplay() : game.startReplay());
      control.drive = (c) => game.setDrive(c);
      control.respawn = () => game.respawn();
      control.resetToys = () => game.resetToys();
      control.stopDrive = () => game.stopDrive();
      game.shake = (k) => rig.shake(k);
      set({ progress: 0.92, map });
      setState(built);
    })();
    return () => {
      cancelled = true;
      control.press = control.release = control.launchAll = control.reset = control.race = control.replay = control.respawn = control.resetToys = control.stopDrive = () => {};
      control.drive = () => {};
      built?.sim.dispose();
      built?.view.dispose();
      built?.fx.dispose();
      built?.game.dispose();
      stopSound();
    };
  }, [gl, camera]);

  // —— compile everything before the first frame (the fading scenery's ghosts too), then lift the loader ——
  useEffect(() => {
    if (!state) return;
    state.view.setOccludersGhost(true);
    gl.compile(scene, camera);
    state.view.setOccludersGhost(false);
    gl.compile(scene, camera);
    useHW.getState().set({ progress: 1, ready: true });
  }, [state, gl, scene, camera]);

  // —— pointer: drag to look around, wheel to zoom, click to drop (in drop mode) ——
  useEffect(() => {
    if (!state) return;
    const el = gl.domElement;
    const ray = new THREE.Raycaster();
    const ndc = new THREE.Vector2();
    const rig = state.rig;
    let down: { x: number; y: number; id: number } | null = null;
    let last = { x: 0, y: 0 };
    let moved = 0;
    const onDown = (e: PointerEvent) => {
      unlockSound();
      if (e.button !== 0 && e.button !== 2) return;
      down = { x: e.clientX, y: e.clientY, id: e.pointerId };
      last = { x: e.clientX, y: e.clientY };
      moved = 0;
    };
    const onMove = (e: PointerEvent) => {
      if (!down || e.pointerId !== down.id) return;
      moved = Math.max(moved, Math.hypot(e.clientX - down.x, e.clientY - down.y));
      if (moved > 5) {
        rig.dragging = true;
        rig.yawOff = THREE.MathUtils.clamp(rig.yawOff - (e.clientX - last.x) * 0.0042, -1.6, 1.6);
        rig.pitchOff = THREE.MathUtils.clamp(rig.pitchOff + (e.clientY - last.y) * 0.003, -0.32, 0.7);
        if (!el.hasPointerCapture(e.pointerId)) el.setPointerCapture(e.pointerId);
      }
      last = { x: e.clientX, y: e.clientY };
    };
    const onUp = (e: PointerEvent) => {
      if (!down || e.pointerId !== down.id) return;
      rig.dragging = false;
      rig.lastDrag = performance.now() / 1000;
      down = null;
      if (moved > 5 || !useHW.getState().drop) return;
      const rect = el.getBoundingClientRect();
      ndc.set(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
      ray.setFromCamera(ndc, camera);
      const hit = state.sim.castRay(ray.ray.origin, ray.ray.direction);
      if (hit) state.game.drop(hit);
    };
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const dy = (e.deltaMode === 1 ? 16 : 1) * e.deltaY;
      rig.zoom = THREE.MathUtils.clamp(rig.zoom * Math.exp(dy * 0.0012), 0.3, 1.8);
      rig.lastDrag = performance.now() / 1000;
    };
    // two-finger pinch zooms on touch
    let pinch = 0;
    const onTouch = (e: TouchEvent) => {
      if (e.touches.length !== 2) return (pinch = 0);
      const d = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY);
      if (pinch) rig.zoom = THREE.MathUtils.clamp(rig.zoom * (pinch / d), 0.3, 1.8);
      pinch = d;
    };
    const noMenu = (e: Event) => e.preventDefault();
    el.addEventListener("pointerdown", onDown);
    el.addEventListener("pointermove", onMove);
    el.addEventListener("pointerup", onUp);
    el.addEventListener("pointercancel", onUp);
    el.addEventListener("wheel", onWheel, { passive: false });
    el.addEventListener("touchmove", onTouch, { passive: true });
    el.addEventListener("contextmenu", noMenu);
    return () => {
      el.removeEventListener("pointerdown", onDown);
      el.removeEventListener("pointermove", onMove);
      el.removeEventListener("pointerup", onUp);
      el.removeEventListener("pointercancel", onUp);
      el.removeEventListener("wheel", onWheel);
      el.removeEventListener("touchmove", onTouch);
      el.removeEventListener("contextmenu", noMenu);
    };
  }, [state, gl, camera]);

  const tmp = useMemo(() => ({ fwd: new THREE.Vector3(), c: new THREE.Color(), down: new THREE.Vector3(0, -2, 0) }), []);
  useFrame(({ camera: cam, size, gl: renderer, scene: sc }, rawDt) => {
    if (!state) return;
    const dt = Math.min(rawDt, 0.05);
    const { game, view, fx, rig } = state;
    const hw = useHW.getState();
    const now = performance.now() / 1000;

    game.update(dt);

    // —— day ⇄ night ——
    night.current = damp(night.current, hw.night ? 1 : 0, 1.8, dt);
    const k = night.current;
    view.setNight(k);
    game.setNight(k);
    fx.setLight(lerp(1, 0.35, k));
    tmp.c.copy(DAY.bg).lerp(NIGHT.bg, k);
    renderer.setClearColor(tmp.c);
    if (fog.current) fog.current.color.copy(tmp.c);
    sc.environmentIntensity = lerp(0.55, 0.08, k);
    if (hemi.current) {
      hemi.current.intensity = lerp(0.55, 0.22, k);
      hemi.current.color.copy(DAY.hemi).lerp(NIGHT.hemi, k);
      hemi.current.groundColor.copy(DAY.ground).lerp(NIGHT.ground, k);
    }
    if (bloom.current) {
      bloom.current.intensity = lerp(0.35, 1.1, k);
      bloom.current.luminanceMaterial.threshold = lerp(1.1, 0.55, k);
    }

    // —— camera ——
    const sub = game.subject;
    const following = game.replaying || game.driving || (!!sub && now - game.focusT < 2.2);
    // replays cut between trackside cameras unless you've asked to ride along
    const mode = game.replaying && (hw.cam === "chase" || hw.cam === "orbit") ? "tv" : hw.cam;
    const persp = cam as THREE.PerspectiveCamera;
    const { stopIndex, nearStop } = rig.update(persp, dt, now, size.width / size.height, safeRect(size.width, size.height, hw.hud), hw.target, mode, sub, following);
    if (nearStop && stopIndex !== hw.stop) hw.set({ stop: stopIndex });
    // scenery between the lens and the subject fades out of the way
    view.fade(cam.position, rig.targets, rig.followK > 0.5, dt);

    // —— the sun's shadow box follows the view ——
    const s = sun.current;
    if (s) {
      const box = THREE.MathUtils.clamp(rig.span * 0.62, 50, 380);
      const sc2 = s.shadow.camera as THREE.OrthographicCamera;
      if (Math.abs(sc2.right - box) > Math.max(2, box * 0.06)) {
        sc2.left = sc2.bottom = -box;
        sc2.right = sc2.top = box;
        sc2.updateProjectionMatrix();
      }
      const texel = (box * 2) / s.shadow.mapSize.width;
      const fx0 = Math.round(rig.look.x / texel) * texel;
      const fz0 = Math.round(rig.look.z / texel) * texel;
      s.target.position.set(fx0, 0, fz0);
      s.position.set(fx0 + SUN.x * 600, SUN.y * 600, fz0 + SUN.z * 600);
      s.target.updateMatrixWorld();
      s.intensity = lerp(3.4, 0.5, k);
      s.color.copy(DAY.sun).lerp(NIGHT.sun, k);
    }
    // a headlight beam on the followed car after dark
    if (head.current) {
      head.current.visible = k > 0.05 && !!sub;
      if (sub) {
        const fw = tmp.fwd.set(0, 0, 1).applyQuaternion(sub.quat);
        head.current.position.copy(sub.pos).addScaledVector(fw, 3.9);
        head.current.target.position.copy(sub.pos).addScaledVector(fw, 40).add(tmp.down);
        head.current.target.updateMatrixWorld();
        head.current.intensity = 2600 * k;
      }
    }
    view.update(dt, now, state.sim, 1, !game.replaying);

    fx.resize(size.height * renderer.getPixelRatio(), rig.fov);
    fx.update(dt, performance.now());

    // focus where the camera's looking: the followed car, or the middle of the stop's frame
    if (dof.current) {
      const ft = (dof.current.target ??= new THREE.Vector3());
      ft.lerp(rig.look, 1 - Math.exp(-8 * dt));
      const d = cam.position.distanceTo(ft);
      dof.current.cocMaterial.worldFocusRange = Math.max(rig.followK > 0.5 ? 8 : 14, d * 0.55);
    }

    // step quality down if frames run slow (never back up: each change recompiles the effects)
    const pf = perf.current;
    if (pf.settle > 0) pf.settle -= dt;
    else if (rawDt < 0.25) {
      pf.frames++;
      pf.time += rawDt;
      if (pf.time > 2) {
        const fps = pf.frames / pf.time;
        pf.frames = pf.time = 0;
        if (fps < 45 && tierRef.current > 0) {
          setTier(tierRef.current - 1);
          pf.settle = 3;
        }
      }
    }
  });

  const bloomOn = tier >= 1 || nightOn;
  return (
    <>
      <Environment />
      <fog ref={fog} attach="fog" args={[DAY.bg, 1100, 2800]} />
      <hemisphereLight ref={hemi} args={[DAY.hemi, DAY.ground, 0.55]} />
      <directionalLight
        ref={sun}
        color={DAY.sun}
        intensity={3.4}
        castShadow
        shadow-mapSize={isMobile ? [2048, 2048] : [4096, 4096]}
        shadow-bias={-0.00025}
        shadow-normalBias={0.05}
        shadow-radius={4}
        shadow-camera-near={50}
        shadow-camera-far={1400}
      />
      <spotLight ref={head} color="#fff1d6" angle={0.42} penumbra={0.6} distance={260} decay={2} intensity={0} visible={false} />
      {state && (
        <>
          <primitive object={state.view.root} />
          <primitive object={state.game.root} />
          <primitive object={state.fx.root} />
        </>
      )}
      <EffectComposer key={`${tier}${bloomOn ? "b" : ""}`} multisampling={0} enableNormalPass={false}>
        {[
          <N8AO key="ao" aoRadius={1.3} distanceFalloff={0.6} intensity={2.2} quality={tier === 0 ? "low" : "medium"} halfRes color="#1a120a" />,
          ...(tier === 2 ? [<DepthOfField key="dof" ref={dof} worldFocusRange={80} bokehScale={2.6} resolutionScale={0.5} />] : []),
          ...(bloomOn ? [<Bloom key="bloom" ref={bloom} mipmapBlur intensity={0.35} luminanceThreshold={1.1} luminanceSmoothing={0.3} radius={0.72} resolutionScale={0.5} />] : []),
          <ToneMapping key="tm" mode={ToneMappingMode.NEUTRAL} />,
          <Vignette key="vg" offset={0.3} darkness={0.48} />,
          <SMAA key="aa" />,
        ]}
      </EffectComposer>
    </>
  );
}

export default function Scene() {
  return (
    <Canvas
      flat
      shadows={{ type: THREE.PCFShadowMap }}
      dpr={[1, 1.5]}
      gl={{ antialias: false, powerPreference: "high-performance", stencil: false }}
      camera={{ fov: STOP_FOV, near: 0.6, far: 6000, position: [0, 400, 700] }}
      onCreated={({ gl }) => gl.setClearColor(DAY.bg)}
    >
      <World />
    </Canvas>
  );
}
