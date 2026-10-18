"use client";

import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Bloom, ChromaticAberration, DepthOfField, EffectComposer, N8AO, Noise, SMAA, ToneMapping, Vignette } from "@react-three/postprocessing";
import { BlendFunction, ToneMappingMode, type BloomEffect, type DepthOfFieldEffect, type VignetteEffect } from "postprocessing";
import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { CAM, frameShot, poseAt, type CamMode, type Shot } from "./camera";
import { Dust } from "./dust";
import { pieceGeometry, plasticMaterial } from "./geometry";
import { buildLayout, type Layout } from "./layout";
import { BALL_SPEED, Paint, paintGround } from "./paint";
import { PaintGun } from "./paintgun";
import { BrickPhysics, initPhysics } from "./physics";
import { BrickRenderer, SHOT_COLOR_COUNT, SHOT_COLORS } from "./render";
import { playBounce, playFeed, playGravity, playImpact, playShot, playSlurp, playSplat, playStorm, setVacuum, setZeroG, soundReady, unlockSound } from "./sound";
import { legoEvents, useLego } from "./store";
import { Vacuum } from "./vacuum";

const FOV = 30;
/** a seamless studio backdrop by day (warm grey at the table line, lighter above); deep blue by night */
const DAY = { horizon: new THREE.Color("#ddd8cf"), zenith: new THREE.Color("#f4f2ee") };
const NIGHT = { horizon: new THREE.Color("#1c2333"), zenith: new THREE.Color("#070a14") };
/** golden hour: a peach haze along the table line under a cool, pale sky */
const GOLD = { horizon: new THREE.Color("#efb487"), zenith: new THREE.Color("#b8c5de") };
/** where the sun (or moon) sits, relative to whatever the camera is looking at */
const SUN = new THREE.Vector3(-0.66, 0.6, 0.45).normalize();
/** …and where it sits at golden hour: low over the front left, so every build throws a long shadow */
const SUN_GOLD = new THREE.Vector3(-0.8, 0.2, 0.56).normalize();
/** slow motion: how much of real time passes */
const SLOWMO = 0.2;
/** a brick storm: how many fall, and how quickly they come */
const STORM_BRICKS = 34;
const STORM_RATE = 14;
const LAMP_LIGHTS = 4;
/** full auto: how fast it cycles once the trigger has been held a moment */
const AUTO_BPS = 12.5;
const AUTO_AFTER = 0.22;
const BOKEH = 2.2;
const CA_OFFSET = new THREE.Vector2(0.0007, 0.0005);
/** weightless: gravity takes this long to fade away, and this long to come back */
const ZG_FADE = 1.6;
const ZG_RETURN = 0.75;
/** how far either side of the view the float wave reaches */
const ZG_REACH = 85;

const smooth = (t: number) => t * t * (3 - 2 * t);
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const damp = (a: number, b: number, rate: number, dt: number) => lerp(a, b, 1 - Math.exp(-rate * dt));

/** Shared between the components below: how far into the night it is (0..1), and into golden hour. */
const night = { k: 0 };
const golden = { k: 0 };
const sunDir = SUN.clone();
const horizon = DAY.horizon.clone();

/** The launch velocity that carries a ball from `from` onto `to` at roughly `speed` (aimed high by what gravity `g` takes). */
function ballistic(from: THREE.Vector3, to: THREE.Vector3, speed: number, g: number, out: THREE.Vector3) {
  const t = Math.max(0.04, from.distanceTo(to) / speed);
  return out.subVectors(to, from).divideScalar(t).setY((to.y - from.y) / t + 0.5 * g * t);
}

/** Fade the backdrop and the stars with the night. */
function tintSky(mat: THREE.ShaderMaterial, stars: THREE.Points, t: number) {
  mat.uniforms.uTop.value.copy(DAY.zenith).lerp(GOLD.zenith, golden.k).lerp(NIGHT.zenith, night.k);
  mat.uniforms.uBottom.value.copy(DAY.horizon).lerp(GOLD.horizon, golden.k).lerp(NIGHT.horizon, night.k);
  // the glow round the sun: barely there by day, a warm bloom low in the sky at golden hour
  mat.uniforms.uSun.value.copy(sunDir);
  mat.uniforms.uGlow.value = (0.06 + golden.k * 0.55) * (1 - night.k);
  const sm = stars.material as THREE.ShaderMaterial;
  sm.uniforms.uK.value = Math.max(0, night.k * 1.2 - 0.2);
  sm.uniforms.uTime.value = t;
  stars.visible = night.k > 0.02;
}

type Cloud = { g: THREE.Group; x: number; y: number; speed: number; phase: number };

/** Drift each cloud right (wrapping round the length of the world) and bob it. */
function driftClouds(clouds: Cloud[], t: number) {
  for (const c of clouds) {
    c.g.position.x = ((c.x + t * c.speed + 90) % 560) - 90;
    c.g.position.y = c.y + Math.sin(t * 0.4 + c.phase) * 0.8;
  }
}

/** The backdrop: a soft sweep from the table line up into light, with stars after dark. */
function Sky() {
  const mat = useMemo(
    () =>
      new THREE.ShaderMaterial({
        side: THREE.BackSide,
        depthWrite: false,
        fog: false,
        uniforms: { uTop: { value: DAY.zenith.clone() }, uBottom: { value: DAY.horizon.clone() }, uSun: { value: SUN.clone() }, uGlow: { value: 0 } },
        vertexShader: /* glsl */ `
          varying vec3 vDir;
          void main() {
            vDir = normalize(position);
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          }`,
        fragmentShader: /* glsl */ `
          uniform vec3 uTop;
          uniform vec3 uBottom;
          uniform vec3 uSun;
          uniform float uGlow;
          varying vec3 vDir;
          void main() {
            float h = clamp(vDir.y * 2.2 + 0.02, 0.0, 1.0);
            vec3 c = mix(uBottom, uTop, smoothstep(0.0, 1.0, h));
            // a soft halo round the sun, wide and faint with a brighter core
            float s = max(dot(normalize(vDir), uSun), 0.0);
            c += vec3(1.0, 0.78, 0.52) * uGlow * (pow(s, 6.0) * 0.55 + pow(s, 48.0) * 0.9);
            gl_FragColor = vec4(c, 1.0);
            #include <colorspace_fragment>
          }`,
      }),
    [],
  );
  const stars = useMemo(() => {
    const n = 900;
    const pos = new Float32Array(n * 3);
    const size = new Float32Array(n);
    let seed = 5;
    const rand = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
    for (let i = 0; i < n; i++) {
      const a = rand() * Math.PI * 2;
      const y = 0.08 + rand() * 0.92;
      const r = Math.sqrt(1 - y * y);
      pos.set([Math.cos(a) * r * 760, y * 760, Math.sin(a) * r * 760], i * 3);
      size[i] = 1 + rand() * rand() * 3;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    g.setAttribute("aSize", new THREE.BufferAttribute(size, 1));
    const m = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      fog: false,
      uniforms: { uK: { value: 0 }, uTime: { value: 0 } },
      vertexShader: /* glsl */ `
        attribute float aSize;
        uniform float uTime;
        varying float vTw;
        void main() {
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = aSize * 1.6;
          vTw = 0.65 + 0.35 * sin(uTime * 2.0 + position.x * 0.13 + position.z * 0.07);
        }`,
      fragmentShader: /* glsl */ `
        uniform float uK;
        varying float vTw;
        void main() {
          float d = length(gl_PointCoord - 0.5);
          if (d > 0.5) discard;
          gl_FragColor = vec4(vec3(1.0, 0.97, 0.9), uK * vTw * smoothstep(0.5, 0.1, d));
        }`,
    });
    return new THREE.Points(g, m);
  }, []);
  const ref = useRef<THREE.Group>(null);
  useFrame(({ camera, clock }) => {
    ref.current?.position.copy(camera.position);
    tintSky(mat, stars, clock.elapsedTime);
  });
  return (
    <group ref={ref}>
      <mesh material={mat} renderOrder={-2} frustumCulled={false}>
        <sphereGeometry args={[800, 32, 16]} />
      </mesh>
      <primitive object={stars} renderOrder={-1} frustumCulled={false} />
    </group>
  );
}

/**
 * Clouds made of white bricks, hanging over the city and drifting slowly along it, each one
 * bobbing gently on its own.
 */
function Clouds() {
  const clouds = useMemo(() => {
    const mat = plasticMaterial();
    mat.color.set("#f7f8f8");
    let seed = 17;
    const rand = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
    const list: Cloud[] = [];
    for (let i = 0; i < 9; i++) {
      const g = new THREE.Group();
      // a stack of bricks, widest in the middle, stepping in towards the top
      const layers = [
        [10 + Math.floor(rand() * 6), 4],
        [6 + Math.floor(rand() * 5), 4],
        [3 + Math.floor(rand() * 3), 2],
      ];
      let y = 0;
      layers.forEach(([w, d], li) => {
        const m = new THREE.Mesh(pieceGeometry({ w, d, h: 3, studs: true }), mat);
        m.position.set((rand() - 0.5) * 3 * li, y, 0);
        m.castShadow = false;
        g.add(m);
        y += 1.2;
      });
      const under = new THREE.Mesh(pieceGeometry({ w: layers[0][0] - 4, d: 2, h: 3, studs: true }), mat);
      under.position.set(1, -1.2, 0);
      g.add(under);
      const x = -60 + i * 58 + rand() * 20;
      const yy = 30 + rand() * 18;
      g.position.set(x, yy, -70 - rand() * 40);
      g.scale.setScalar(1.3 + rand() * 0.6);
      list.push({ g, x, y: yy, speed: 0.6 + rand() * 0.8, phase: rand() * 6 });
    }
    return list;
  }, []);
  useFrame(({ clock }) => driftClouds(clouds, clock.elapsedTime));
  return (
    <>
      {clouds.map((c, i) => (
        <primitive key={i} object={c.g} />
      ))}
    </>
  );
}

/** Image-based light from a neutral studio room, so the plastic has something to reflect. */
function Environment() {
  const get = useThree((s) => s.get);
  useEffect(() => {
    const { gl, scene } = get();
    const pmrem = new THREE.PMREMGenerator(gl);
    const env = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    scene.environment = env;
    scene.environmentIntensity = 0.36;
    return () => {
      scene.environment = null;
      env.dispose();
      pmrem.dispose();
    };
  }, [get]);
  return null;
}

/**
 * Photo mode's shutter: right after the frame is composited (this runs after the effect
 * composer), the canvas still holds it, so it can be read out without keeping the drawing buffer.
 */
function Capture() {
  const gl = useThree((s) => s.gl);
  const last = useRef(useLego.getState().shotTick);
  useFrame(() => {
    const tick = useLego.getState().shotTick;
    if (tick === last.current) return;
    last.current = tick;
    try {
      legoEvents.onShot(gl.domElement.toDataURL("image/png"));
    } catch {
      // a tainted or lost context: nothing to save
    }
  }, 2);
  return null;
}

/**
 * The table the diorama stands on: matte, faintly mottled, running off into the backdrop.
 */
function tableMaterial() {
  const c = document.createElement("canvas");
  c.width = c.height = 512;
  const ctx = c.getContext("2d")!;
  ctx.fillStyle = "#d9d3c9";
  ctx.fillRect(0, 0, 512, 512);
  // a fine, uneven mottle so it reads as a real surface rather than flat colour
  let seed = 11;
  const rand = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
  for (let i = 0; i < 9000; i++) {
    ctx.fillStyle = `rgba(${rand() > 0.5 ? "255,255,255" : "90,80,70"},${0.02 + rand() * 0.035})`;
    const r = 1 + rand() * 3;
    ctx.fillRect(rand() * 512, rand() * 512, r, r);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(60, 60);
  t.anisotropy = 8;
  return new THREE.MeshStandardMaterial({ map: t, roughness: 0.86, metalness: 0, envMapIntensity: 0.5 });
}

function Table() {
  const mat = useMemo(() => {
    const m = tableMaterial();
    paintGround(m);
    return m;
  }, []);
  return (
    <mesh material={mat} rotation-x={-Math.PI / 2} position={[190, -0.33, 0]} receiveShadow>
      <planeGeometry args={[3000, 3000]} />
    </mesh>
  );
}

function World({ onReady }: { onReady: () => void }) {
  const { camera, gl, scene } = useThree();
  const [state, setState] = useState<{ layout: Layout; physics: BrickPhysics; view: BrickRenderer; dust: Dust; vac: Vacuum; paint: Paint; gun: PaintGun } | null>(null);
  /** the vacuum: where the pointer is (NDC), whether the button is held for boost, the motor as last set */
  const vacInput = useRef({ ndc: new THREE.Vector2(0, -0.2), boost: false, sound: "", inflow: 0 });
  /** the marker: the trigger held (and since when), a press not yet fired, the last shot */
  const gunInput = useRef({ held: false, downAt: 0, pending: false, last: -10, ammo: -2 });
  const sun = useRef<THREE.DirectionalLight>(null);
  const hemi = useRef<THREE.HemisphereLight>(null);
  const fog = useRef<THREE.Fog>(null);
  const dof = useRef<DepthOfFieldEffect>(null);
  const bloom = useRef<BloomEffect>(null);
  const vignette = useRef<VignetteEffect>(null);
  const lampLights = useRef<(THREE.PointLight | null)[]>([]);
  /** gravity: whether it's off, how far it has come back (0 … 1, eased), and the cabin hum as last set */
  const zero = useRef({ on: false, p: 1, sound: "" });
  const rig = useRef({
    p: 0,
    yawOff: 0,
    pitchOff: 0,
    dragging: false,
    lastDrag: -10,
    focus: new THREE.Vector3(),
    intro: 0,
    shake: 0,
    stop: -1,
    /** the camera in use, and the glide from the last one (blend 0 … 1, from where it was) */
    mode: "tour" as CamMode,
    blend: 1,
    from: new THREE.Vector3(),
    fromLook: new THREE.Vector3(),
    look: new THREE.Vector3(),
    /** the free orbit, kept where you leave it; its zoom, eased */
    orbitYaw: 0,
    orbitPitch: 0,
    zoom: 1,
    /** the lens and its depth of field, eased between cameras */
    range: 60,
    bokeh: 2.2,
    shadow: 54,
    vignette: 0.42,
    /** the cinematic camera's clock towards its next stop, and the stop it last saw */
    cineT: 0,
    cineFrom: -1,
    /** how fast time runs (1 … SLOWMO), and the world's own clock at that rate */
    ts: 1,
    simT: 0,
    /** a brick storm: how many still to fall, and the spawn clock */
    storm: 0,
    stormAcc: 0,
  });
  const shot = useMemo<Shot>(() => ({ pos: new THREE.Vector3(), look: new THREE.Vector3(), focus: new THREE.Vector3(), roll: 0 }), []);
  /** the traffic, for the chase camera */
  const carIds = useMemo(() => (state ? state.layout.pieces.filter((p) => p.special === "car").map((p) => p.id) : []), [state]);
  const isMobile = useMemo(() => matchMedia("(max-width: 767px), (pointer: coarse)").matches, []);
  // quality tier: 2 full, 1 without depth of field, 0 also at 1× resolution with lighter AO and no bloom
  const [tier, setTier] = useState(isMobile ? 0 : 2);
  // bloom is what makes the windows and lamps glow: kept at night even on the lightest tier
  const nightOn = useLego((s) => s.night);
  const bloomOn = tier >= 1 || nightOn;
  const tierRef = useRef(tier);
  const perf = useRef({ frames: 0, time: 0, settle: 5 });
  const setDpr = useThree((s) => s.setDpr);
  useEffect(() => {
    tierRef.current = tier;
    const native = window.devicePixelRatio || 1;
    setDpr(tier === 2 ? Math.min(native, 1.5) : tier === 1 ? Math.min(native, 1.25) : 1);
  }, [tier, setDpr]);

  // —— build the world ——
  useEffect(() => {
    let cancelled = false;
    let built: { physics: BrickPhysics; view: BrickRenderer; dust: Dust; vac: Vacuum; paint: Paint; gun: PaintGun } | null = null;
    (async () => {
      const layout = buildLayout();
      await Promise.all([initPhysics(), document.fonts?.ready]);
      if (cancelled) return;
      const physics = new BrickPhysics(layout);
      const view = new BrickRenderer(layout, gl.capabilities.getMaxAnisotropy(), (p) => useLego.getState().set({ progress: 0.25 + p * 0.75 }));
      const dust = new Dust();
      view.root.add(dust.points);
      const vac = new Vacuum(gl.capabilities.getMaxAnisotropy());
      view.root.add(vac.root);
      const paint = new Paint(layout, isMobile);
      view.root.add(paint.root);
      const gun = new PaintGun(gl.capabilities.getMaxAnisotropy());
      view.root.add(gun.root);
      built = { physics, view, dust, vac, paint, gun };
      useLego.getState().set({ total: layout.pieces.length, stopCount: layout.stops.length, progress: 0.25 });
      await view.loaded;
      if (cancelled) return;
      let lastPuff = 0;
      physics.onImpact = (kind, strength, at) => {
        const now = performance.now();
        // a thrown brick landing kicks up a puff and jolts the camera; a hard landing, a small puff
        if (kind === "ball") {
          dust.burst(at, strength);
          rig.current.shake = Math.min(0.9, rig.current.shake + strength * 0.5);
        } else if (kind === "brick" && strength > 0.45 && now - lastPuff > 40) {
          lastPuff = now;
          dust.burst(at, strength * 0.35);
        }
        if (!useLego.getState().sound) return;
        const d = camera.position.distanceTo(at as THREE.Vector3);
        const ndc = new THREE.Vector3(at.x, at.y, at.z).project(camera);
        playImpact(kind, strength, 1 / (1 + d / 45), ndc.x * 0.7);
      };
      physics.onRebuilt = () => useLego.getState().set({ building: false, knocked: 0 });
      // a piece goes up the wand: a miniature of it lands in the bin, with a rattle and a puff
      let lastSlurp = 0;
      physics.onSwallow = (kind, v, at) => {
        const piece = kind === "piece" ? layout.pieces[v] : null;
        const area = piece ? piece.w * piece.d : 8;
        vac.swallow(piece ? piece.color : SHOT_COLORS[v % SHOT_COLORS.length], area, performance.now() / 1000);
        dust.burst(at, 0.1);
        useLego.getState().set({ sucked: vac.count });
        const now = performance.now();
        if (useLego.getState().sound && now - lastSlurp > 30) {
          lastSlurp = now;
          playSlurp(Math.min(1, area / 8));
        }
      };
      // a ball bursts (or bounces): the sound, from where it happened, and the count
      paint.onHit = ({ at, strength, kind }) => {
        if (kind === "splat") useLego.getState().set({ splats: paint.splats });
        if (!useLego.getState().sound) return;
        const d = camera.position.distanceTo(at);
        const ndc = at.clone().project(camera);
        if (kind === "splat") playSplat(strength, 1 / (1 + d / 50), ndc.x * 0.7);
        else playBounce(1 / (1 + d / 50), ndc.x * 0.7);
      };
      view.sync(physics, 0, true);
      setState({ layout, physics, view, dust, vac, paint, gun });
    })();
    return () => {
      cancelled = true;
      built?.physics.dispose();
      built?.view.dispose();
      built?.dust.dispose();
      built?.vac.dispose();
      built?.paint.dispose();
      built?.gun.dispose();
      setVacuum(false, false, true);
      setZeroG(false, true);
    };
  }, [gl, camera, isMobile]);

  // —— opening build (with the camera swooping in), and rebuilds on request ——
  useEffect(() => {
    if (!state) return;
    // compile every shader before the first visible frame so the build doesn't stutter
    // compiled with the vacuum showing, so it doesn't hitch the first time it comes out
    // (and the marker, for the same reason)
    state.vac.root.children.forEach((c) => (c.visible = true));
    state.gun.prewarm(true);
    state.paint.prewarm(true, gl);
    gl.compile(scene, camera);
    state.paint.prewarm(false, gl);
    state.vac.root.children.forEach((c) => (c.visible = c instanceof THREE.Light));
    state.gun.prewarm(false);
    onReady();
    state.physics.rebuild(true, state.layout.stops[0].target[0]);
    rig.current.intro = 1;
    useLego.getState().set({ building: true, ready: true });
    let tick = useLego.getState().rebuildTick;
    let wash = useLego.getState().washTick;
    let storm = useLego.getState().stormTick;
    return useLego.subscribe((s) => {
      if (s.washTick !== wash) {
        wash = s.washTick;
        state.paint.washOff();
      }
      if (s.stormTick !== storm) {
        storm = s.stormTick;
        rig.current.storm = STORM_BRICKS;
        rig.current.stormAcc = 1;
        if (s.sound) playStorm();
      }
      if (s.rebuildTick === tick) return;
      tick = s.rebuildTick;
      // swallowed pieces fly home out of the bin, which tips out as they go
      state.physics.steer({ bin: state.vac.shown > 0.5 ? state.vac.binWorld.clone() : null });
      state.physics.rebuild(false, rig.current.focus.x);
      state.vac.empty();
      useLego.getState().set({ building: true, sucked: 0 });
    });
  }, [state, gl, scene, camera, onReady]);

  // —— pointer: drag to look around, click to throw (or to use a printed piece) ——
  useEffect(() => {
    if (!state) return;
    const el = gl.domElement;
    const ray = new THREE.Raycaster();
    const ndc = new THREE.Vector2();
    let down: { x: number; y: number; t: number; id: number } | null = null;
    let last = { x: 0, y: 0 };
    let hoverFrame = 0;
    const toRay = (e: PointerEvent) => {
      const r = el.getBoundingClientRect();
      ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
      ray.setFromCamera(ndc, camera);
    };
    const vacuumOut = () => useLego.getState().vacuum;
    const gunUp = () => useLego.getState().paint;
    const aim = (e: PointerEvent) => {
      const r = el.getBoundingClientRect();
      vacInput.current.ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    };
    const onDown = (e: PointerEvent) => {
      if (e.button !== 0) return;
      down = { x: e.clientX, y: e.clientY, t: performance.now(), id: e.pointerId };
      last = { x: e.clientX, y: e.clientY };
      unlockSound();
      // with the marker up, pressing is the trigger (aimed where you press)
      if (gunUp()) {
        aim(e);
        const g = gunInput.current;
        g.held = true;
        g.pending = true;
        g.downAt = performance.now() / 1000;
        if (!el.hasPointerCapture(e.pointerId)) el.setPointerCapture(e.pointerId);
        return;
      }
      // with the vacuum out, pressing is the boost trigger (and the head goes where you press)
      if (vacuumOut()) {
        aim(e);
        vacInput.current.boost = true;
        if (!el.hasPointerCapture(e.pointerId)) el.setPointerCapture(e.pointerId);
      }
    };
    const onMove = (e: PointerEvent) => {
      aim(e);
      if (vacuumOut() || gunUp()) {
        if (useLego.getState().hover) useLego.getState().set({ hover: null });
        return;
      }
      if (down && e.pointerId === down.id) {
        const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y);
        if (moved > 6) {
          const r = rig.current;
          r.dragging = true;
          if (useLego.getState().cam === "orbit") {
            // the free orbit goes all the way round, and from the baseplate to straight down
            r.orbitYaw -= (e.clientX - last.x) * 0.0062;
            r.orbitPitch = Math.max(-1.3, Math.min(1.2, r.orbitPitch + (e.clientY - last.y) * 0.0042));
          } else {
            r.yawOff = Math.max(-0.6, Math.min(0.6, r.yawOff - (e.clientX - last.x) * 0.0035));
            // on touch, vertical swipes move between stops instead
            if (e.pointerType !== "touch") r.pitchOff = Math.max(-0.12, Math.min(0.5, r.pitchOff + (e.clientY - last.y) * 0.0025));
          }
          if (!el.hasPointerCapture(e.pointerId)) el.setPointerCapture(e.pointerId);
        }
        last = { x: e.clientX, y: e.clientY };
        return;
      }
      if (e.pointerType !== "mouse" || ++hoverFrame % 2) return;
      toRay(e);
      const hit = state.view.pick(ray);
      const kind = hit && legoEvents.canPick(hit) ? hit.kind : null;
      if (useLego.getState().hover !== kind) useLego.getState().set({ hover: kind });
    };
    const onUp = (e: PointerEvent) => {
      gunInput.current.held = false;
      if (!down || e.pointerId !== down.id) return;
      const r = rig.current;
      const wasDrag = r.dragging;
      r.dragging = false;
      r.lastDrag = performance.now() / 1000;
      down = null;
      vacInput.current.boost = false;
      if (vacuumOut() || gunUp()) return;
      if (wasDrag || state.physics.animating) return;
      toRay(e);
      const pick = state.view.pick(ray);
      if (pick && legoEvents.canPick(pick)) return legoEvents.onPick(pick);
      // throw a brick at whatever's under the pointer, from just below the lens
      const o = ray.ray.origin;
      const d = ray.ray.direction;
      const to = state.physics.castRay(o, d) ?? o.clone().addScaledVector(d, 160);
      const down3 = new THREE.Vector3(0, -1, 0).applyQuaternion(camera.quaternion);
      const from = o.clone().addScaledVector(d, 3).addScaledVector(down3, 1.4);
      state.physics.throwBall(from, to, 78, Math.floor(Math.random() * SHOT_COLOR_COUNT));
      useLego.getState().set({ throws: useLego.getState().throws + 1 });
    };
    const onLeave = () => useLego.getState().hover && useLego.getState().set({ hover: null });
    el.addEventListener("pointerdown", onDown);
    el.addEventListener("pointermove", onMove);
    el.addEventListener("pointerup", onUp);
    el.addEventListener("pointercancel", onUp);
    el.addEventListener("pointerleave", onLeave);
    return () => {
      el.removeEventListener("pointerdown", onDown);
      el.removeEventListener("pointermove", onMove);
      el.removeEventListener("pointerup", onUp);
      el.removeEventListener("pointercancel", onUp);
      el.removeEventListener("pointerleave", onLeave);
    };
  }, [state, gl, camera]);

  // —— every frame: physics, then the camera, then the lights follow the camera ——
  const counter = useRef(0);
  const gunTmp = useMemo(() => ({ to: new THREE.Vector3(), from: new THREE.Vector3(), vel: new THREE.Vector3(), dir: new THREE.Vector3(), focus: new THREE.Vector3() }), []);
  const vacTmp = useMemo(() => ({ ray: new THREE.Raycaster(), floor: new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), hit: new THREE.Vector3(), mouth: new THREE.Vector3() }), []);
  const tmp = useMemo(
    () => ({
      sunDay: new THREE.Color("#fff4e6"),
      sunGold: new THREE.Color("#ffad62"),
      sunNight: new THREE.Color("#9db4ff"),
      hemiDay: new THREE.Color("#f3f1ec"),
      hemiGold: new THREE.Color("#ffd6b0"),
      hemiNight: new THREE.Color("#5a6c99"),
      from: new THREE.Vector3(),
      to: new THREE.Vector3(),
    }),
    [],
  );
  useFrame(({ clock, pointer, camera: cam, size, gl: renderer, scene: sc }, dt) => {
    if (!state) return;
    const { physics, view, layout, dust } = state;
    const t = clock.elapsedTime;
    const lego = useLego.getState();
    const r = rig.current;
    const pc = cam as THREE.PerspectiveCamera;
    counter.current++;
    // slow motion: the world's clock runs at a fraction of real time (eased in and out)
    const tsGoal = lego.slowmo ? SLOWMO : 1;
    let ts = damp(r.ts, tsGoal, 5, Math.min(dt, 0.05));
    if (Math.abs(ts - tsGoal) < 1e-3) ts = tsGoal;
    if (ts !== r.ts) physics.setTimeScale(ts);
    r.ts = ts;
    r.simT += dt * r.ts;
    const st = r.simT;
    physics.update(dt);
    view.sync(physics, st);
    dust.resize(size.height * renderer.getPixelRatio(), pc.fov);
    dust.update(Math.min(dt, 0.05) * r.ts);
    state.paint.resize(size.height * renderer.getPixelRatio(), pc.fov);

    // a brick storm: a shower of bricks out of the sky onto whatever's in view
    if (r.storm > 0) {
      r.stormAcc += Math.min(dt, 0.1) * STORM_RATE;
      while (r.stormAcc >= 1 && r.storm > 0) {
        r.stormAcc -= 1;
        r.storm--;
        const fx = r.focus.x;
        tmp.from.set(fx + (Math.random() - 0.5) * 70, 64 + Math.random() * 24, -16 + Math.random() * 30);
        tmp.to.set(fx + (Math.random() - 0.5) * 64, 0.5, -9 + Math.random() * 16);
        physics.throwBall(tmp.from, tmp.to, 52 + Math.random() * 16, Math.floor(Math.random() * SHOT_COLOR_COUNT));
      }
    }

    // —— gravity: it ebbs away gently, the way a drop begins, and comes back quicker, with a clunk ——
    const z = zero.current;
    if (lego.zeroG !== z.on) {
      z.on = lego.zeroG;
      if (!z.on) physics.endFloat();
      if (lego.sound) playGravity(z.on);
    }
    const was = z.p;
    z.p = z.on ? Math.max(0, z.p - Math.min(dt, 0.05) / ZG_FADE) : Math.min(1, z.p + Math.min(dt, 0.05) / ZG_RETURN);
    const gk = smooth(z.p);
    physics.setGravity(gk);
    dust.setWeight(gk);
    // the field catching again jolts the camera
    if (was < 1 && z.p === 1) r.shake = Math.min(0.9, r.shake + 0.55);
    // once it's all but gone, the wave of release spreads out from the view (and follows it about)
    if (z.on && gk < 0.06 && counter.current % 6 === 0) {
      const n = physics.float(r.focus.x, ZG_REACH);
      if (n) dust.motes(r.focus, ZG_REACH * 2, Math.min(280, 50 + n * 0.12));
    }
    const readout = Math.round(gk * 100) / 100;
    if (readout !== lego.gravity && (counter.current % 3 === 0 || readout === 0 || readout === 1)) lego.set({ gravity: readout });
    const zKey = `${z.on}|${lego.sound}|${soundReady()}`;
    if (zKey !== z.sound) {
      z.sound = zKey;
      setZeroG(z.on, !lego.sound);
    }

    // day ⇄ golden hour ⇄ night
    const ld = Math.min(dt, 0.05);
    night.k = damp(night.k, lego.night ? 1 : 0, 1.6, ld);
    golden.k = damp(golden.k, lego.golden && !lego.night ? 1 : 0, 1.3, ld);
    const k = night.k;
    const g = golden.k;
    // windows and lamps come on as the light goes (a few already at golden hour)
    const glowK = Math.max(k, g * 0.3);
    sunDir.copy(SUN).lerp(SUN_GOLD, g).normalize();
    horizon.copy(DAY.horizon).lerp(GOLD.horizon, g).lerp(NIGHT.horizon, k);
    if (fog.current) fog.current.color.copy(horizon);
    renderer.setClearColor(horizon);
    sc.environmentIntensity = lerp(lerp(0.36, 0.27, g), 0.09, k);
    view.setNight(glowK);
    dust.setLight(lerp(lerp(1, 0.9, g), 0.25, k));
    state.paint.setLight(lerp(1, 0.3, k));
    if (hemi.current) {
      hemi.current.intensity = lerp(lerp(0.32, 0.22, g), 0.24, k);
      hemi.current.color.copy(tmp.hemiDay).lerp(tmp.hemiGold, g).lerp(tmp.hemiNight, k);
    }
    if (bloom.current) {
      bloom.current.intensity = lerp(0.25, 1.15, glowK);
      bloom.current.luminanceMaterial.threshold = lerp(1.6, 0.75, glowK);
    }

    // the cinematic camera walks the line by itself, lingering at each stop
    if (lego.cam === "cinema") {
      const at = Math.round(lego.target);
      if (at !== r.cineFrom) {
        r.cineFrom = at;
        r.cineT = 0;
      }
      if (Math.abs(r.p - lego.target) < 0.05) r.cineT += dt;
      if (r.cineT > 9) lego.set({ target: (at + 1) % layout.stops.length });
    }
    // the chase camera rides with a car (skipping any that have been knocked off the world)
    let car: { x: number; y: number; z: number; dir: number } | null = null;
    if (lego.cam === "chase" && carIds.length) {
      for (let i = 0; i < carIds.length; i++) {
        const id = carIds[(((lego.chaseCar + i) % carIds.length) + carIds.length) % carIds.length];
        if (physics.lost[id] || physics.pos[id * 3 + 1] < -5) continue;
        car = { x: physics.pos[id * 3], y: physics.pos[id * 3 + 1], z: physics.pos[id * 3 + 2], dir: Math.sign(physics.drives[id]) || 1 };
        break;
      }
      // the panel follows the ride: whichever stop the car is passing
      if (car) {
        let best = 0;
        layout.stops.forEach((s, i) => {
          if (Math.abs(s.target[0] - car!.x) < Math.abs(layout.stops[best].target[0] - car!.x)) best = i;
        });
        if (best !== Math.round(lego.target)) lego.set({ target: best });
      }
    }

    r.p = damp(r.p, lego.target, 2.6, ld);
    const nearest = Math.round(r.p);
    if (nearest !== lego.stop && Math.abs(r.p - nearest) < 0.35) lego.set({ stop: nearest });
    // arriving at a stop: the build there waves hello
    if (Math.abs(r.p - nearest) < 0.06 && r.stop !== nearest && !physics.animating && !z.on) {
      r.stop = nearest;
      view.wave(nearest, st);
    }
    // let go of a drag and the view eases back to its framing (the free orbit stays put, and drifts round)
    if (!r.dragging && t - r.lastDrag > 1.2) {
      r.yawOff = damp(r.yawOff, 0, 1.4, dt);
      r.pitchOff = damp(r.pitchOff, 0, 1.4, dt);
      if (lego.cam === "orbit" && t - r.lastDrag > 4) r.orbitYaw += ld * 0.05;
    }

    const aspect = size.width / size.height;
    const portrait = aspect < 0.9;
    const pose = poseAt(layout.stops, r.p, portrait);
    // the opening: start high and wide, swing round and settle on the name as it builds
    r.intro = Math.max(0, r.intro - ld / 4.2);
    const swoop = smooth(r.intro);
    const spec = CAM[lego.cam];
    // the lens: each camera has its own focal length, and racks between them
    const fov = damp(pc.fov, spec.fov, 2.6, ld);
    if (Math.abs(fov - pc.fov) > 1e-4) {
      pc.fov = Math.abs(fov - spec.fov) < 0.01 ? spec.fov : fov;
      pc.updateProjectionMatrix();
    }
    r.zoom = damp(r.zoom, lego.zoom, 6, ld);
    frameShot(
      { mode: lego.cam, pose, aspect, portrait, fov: pc.fov, t, swoop, pointer, yawOff: r.yawOff, pitchOff: r.pitchOff, orbitYaw: r.orbitYaw, orbitPitch: r.orbitPitch, zoom: r.zoom, car },
      shot,
    );
    // a new camera glides over from wherever the last one was
    if (lego.cam !== r.mode) {
      r.mode = lego.cam;
      r.from.copy(cam.position);
      r.fromLook.copy(r.look);
      r.blend = 0;
      if (lego.cam !== "orbit") r.orbitYaw = r.orbitPitch = 0;
    }
    r.blend = Math.min(1, r.blend + ld / 1.7);
    const b = smooth(r.blend);
    cam.position.lerpVectors(r.from, shot.pos, b);
    r.look.lerpVectors(r.fromLook, shot.look, b);
    // weightless, the camera floats too: a slow drift that never quite repeats, and a hint of roll
    const wl = 1 - gk;
    if (wl > 0.001) {
      cam.position.x += (Math.sin(t * 0.37) + Math.sin(t * 0.13 + 2) * 0.6) * 0.9 * wl;
      cam.position.y += (Math.sin(t * 0.29 + 1.3) + Math.sin(t * 0.11) * 0.5) * 0.7 * wl;
      cam.position.z += Math.sin(t * 0.23 + 2.1) * 0.8 * wl;
    }
    // a thrown brick landing gives the camera a little jolt
    r.shake *= Math.exp(-dt * 7);
    if (r.shake > 0.002) {
      cam.position.x += Math.sin(t * 61) * r.shake * 0.5;
      cam.position.y += Math.sin(t * 47 + 1) * r.shake * 0.5;
    }
    cam.lookAt(r.look);
    cam.rotateZ(shot.roll * b + (wl > 0.001 ? (Math.sin(t * 0.17) * 0.7 + Math.sin(t * 0.07 + 1) * 0.3) * 0.02 * wl : 0));
    // what the shot is about: the stop's subject, or the car being chased
    r.focus.copy(shot.focus);
    // fog backs off as the camera pulls away, so the long lens up high still sees the city clearly
    if (fog.current) {
      const extra = Math.max(0, cam.position.distanceTo(r.look) - 110);
      fog.current.near = 150 + extra;
      fog.current.far = 520 + extra * 1.2;
    }

    // the vacuum: its head goes where the pointer meets the floor (kept on the baseplates, near the view)
    const { vac } = state;
    const vi = vacInput.current;
    if (lego.vacuum || vac.shown > 0) {
      cam.updateMatrixWorld();
      vacTmp.ray.setFromCamera(vi.ndc, cam);
      const hit = vacTmp.ray.ray.intersectPlane(vacTmp.floor, vacTmp.hit) ?? vacTmp.hit.set(r.focus.x, 0, 6);
      hit.x = THREE.MathUtils.clamp(hit.x, r.focus.x - 70, r.focus.x + 70);
      hit.x = THREE.MathUtils.clamp(hit.x, layout.bounds.x0 + 7, layout.bounds.x1 - 7);
      hit.z = THREE.MathUtils.clamp(hit.z, -44, 21);
      const boost = vi.boost && lego.vacuum;
      vac.update(dt, t, { on: lego.vacuum, boost, target: hit, camera: cam as THREE.PerspectiveCamera, night: k });
      physics.steer({ on: vac.live && lego.vacuum && !physics.animating, boost, x: vac.x, z: vac.z, yaw: vac.yaw, bin: vac.shown > 0.5 ? vac.binWorld : null, wand: vac.wandLine });
      vac.light.position.set(vac.x + Math.sin(vac.yaw) * 3.2, 1.2, vac.z + Math.cos(vac.yaw) * 3.2);
      // dust streaming into the intake
      if (physics.suction.on) {
        vi.inflow += dt * (boost ? 110 : 45);
        const n = Math.floor(vi.inflow);
        vi.inflow -= n;
        if (n) dust.inflow(vacTmp.mouth.set(vac.x + Math.sin(vac.yaw) * 1.6, 0.5, vac.z + Math.cos(vac.yaw) * 1.6), vac.yaw, n);
      }
    } else if (physics.suction.on) physics.steer({ on: false });

    // the marker: find what's under the pointer, swing the barrel onto the arc that reaches it, fire
    const { gun, paint } = state;
    const gi = gunInput.current;
    if (lego.paint || gun.shown > 0) {
      cam.updateMatrixWorld();
      vacTmp.ray.setFromCamera(vi.ndc, cam);
      const o = vacTmp.ray.ray.origin;
      const d = vacTmp.ray.ray.direction;
      const hit = physics.castRay(o, d, 400);
      const to = hit ? gunTmp.to.set(hit.x, hit.y, hit.z) : gunTmp.to.copy(o).addScaledVector(d, 260);
      const from = gun.shown > 0 ? gun.muzzle(gunTmp.from) : gunTmp.from.copy(cam.position);
      ballistic(from, to, BALL_SPEED, physics.gravity, gunTmp.vel);
      gun.setColor(lego.paintColor);
      gun.update(dt, t, { on: lego.paint, camera: cam as THREE.PerspectiveCamera, dir: gunTmp.dir.copy(gunTmp.vel).normalize(), portrait });
      gunTmp.focus.lerp(to, 1 - Math.exp(-8 * Math.min(dt, 0.05)));
      const now = performance.now() / 1000;
      // a press fires at once; held, it ramps into full auto
      const due = gi.pending || (gi.held && now - gi.downAt > AUTO_AFTER && now - gi.last >= 1 / AUTO_BPS);
      if (lego.paint && due && gun.ready) {
        gi.pending = false;
        gi.last = now;
        gun.root.updateMatrixWorld(true);
        const m = gun.muzzle(gunTmp.from);
        const v = ballistic(m, to, BALL_SPEED, physics.gravity, gunTmp.vel);
        // no two balls fly quite the same: seams, spin, a breath of air
        const sp = v.length() * 0.007;
        v.x += (Math.random() - 0.5) * sp;
        v.y += (Math.random() - 0.5) * sp;
        v.z += (Math.random() - 0.5) * sp;
        paint.fire(m, v, lego.paintColor);
        paint.puff(m, gun.forward(gunTmp.dir));
        gun.fired(t);
        if (lego.sound) {
          playShot();
          playFeed();
        }
        lego.set({ fired: lego.fired + 1 });
      } else if (!gi.held) gi.pending = false;
      const ammo = gun.reloading ? -1 : gun.ammo;
      if (ammo !== gi.ammo) {
        gi.ammo = ammo;
        lego.set({ ammo });
      }
    }
    paint.update(dt * r.ts, st, physics, renderer);
    // the motor, told only when something changes
    const motorKey = `${lego.vacuum && vac.shown > 0.3}|${vi.boost && lego.vacuum}|${lego.sound}`;
    if (motorKey !== vi.sound) {
      vi.sound = motorKey;
      setVacuum(lego.vacuum && vac.shown > 0.3, vi.boost, !lego.sound);
    }

    // the sun's shadow box follows the view, snapped to its texels so edges don't crawl
    const s = sun.current;
    if (s) {
      // the long lens up high sees more of the world: the shadow box widens to cover it
      r.shadow = damp(r.shadow, spec.shadow, 3, ld);
      const sc0 = s.shadow.camera;
      if (Math.abs(sc0.right - r.shadow) > 0.5) {
        sc0.left = sc0.bottom = -r.shadow;
        sc0.right = sc0.top = r.shadow;
        sc0.updateProjectionMatrix();
        renderer.shadowMap.needsUpdate = true;
      }
      const texel = (s.shadow.camera.right * 2) / s.shadow.mapSize.width;
      const fx = Math.round(r.focus.x / texel) * texel;
      const fz = Math.round(Math.max(-30, Math.min(20, r.focus.z)) / texel) * texel;
      // the shadow map only changes when the light moves or something in it does: redraw it then,
      // and every third frame otherwise for the traffic and the minifigs
      const moved = s.target.position.x !== fx || s.target.position.z !== fz;
      renderer.shadowMap.autoUpdate = false;
      if (moved || physics.active || paint.active || vac.shown > 0 || counter.current % 3 === 0) renderer.shadowMap.needsUpdate = true;
      s.target.position.set(fx, 0, fz);
      const sunMoved = s.position.x !== fx + sunDir.x * 120 || s.position.y !== sunDir.y * 120;
      if (sunMoved) renderer.shadowMap.needsUpdate = true;
      s.position.set(fx + sunDir.x * 120, sunDir.y * 120, fz + sunDir.z * 120);
      s.target.updateMatrixWorld();
      s.intensity = lerp(lerp(3.8, 3.3, g), 0.95, k);
      s.color.copy(tmp.sunDay).lerp(tmp.sunGold, g).lerp(tmp.sunNight, k);
    }
    // the street lamps nearest the view throw real light after dark
    const near = [...view.lamps].sort((a, b) => Math.abs(a.x - r.focus.x) - Math.abs(b.x - r.focus.x));
    lampLights.current.forEach((l, i) => {
      if (!l) return;
      const at = near[i];
      l.visible = !!at && glowK > 0.01;
      if (at) l.position.set(at.x, at.y + 0.3, at.z + 0.6);
      l.intensity = 90 * glowK;
    });
    // in focus: whatever the view is on, or the vacuum head while it's out; with the marker up the
    // blur goes, so the marker (right in front of the lens) and what it's aimed at are both sharp
    if (dof.current) {
      const f = (dof.current.target ??= new THREE.Vector3());
      if (gun.shown > 0.5) f.copy(gunTmp.focus);
      else if (vac.shown > 0.5) f.lerp(vacTmp.mouth.set(vac.x, 1, vac.z), 1 - Math.exp(-6 * Math.min(dt, 0.05)));
      else f.copy(r.focus);
      // each camera has its own depth of field: deep for the tour, paper-thin on the macro and the tilt-shift
      r.range = damp(r.range, spec.focusRange, 2.4, ld);
      r.bokeh = damp(r.bokeh, spec.bokeh, 2.4, ld);
      dof.current.cocMaterial.focusRange = r.range;
      dof.current.bokehScale = r.bokeh * (1 - gun.shown);
    }
    if (vignette.current) {
      r.vignette = damp(r.vignette, spec.vignette, 2.4, ld);
      vignette.current.darkness = r.vignette;
    }

    // step the quality down (never up: each change recompiles the effects) if frames run slow
    const pf = perf.current;
    if (pf.settle > 0) pf.settle -= Math.min(dt, 0.1);
    else if (dt < 0.25) {
      pf.frames++;
      pf.time += dt;
      if (pf.time > 2) {
        const fps = pf.frames / pf.time;
        pf.frames = pf.time = 0;
        if (fps < 48 && tierRef.current > 0) {
          setTier(tierRef.current - 1);
          pf.settle = 3;
        }
      }
    }

    // the knocked-down count, a few times a second
    if (counter.current % 15 === 0) {
      const kn = physics.displaced();
      if (kn !== lego.knocked) lego.set({ knocked: kn });
    }
  });

  return (
    <>
      <Sky />
      <Clouds />
      <Environment />
      <fog ref={fog} attach="fog" args={[DAY.horizon, 150, 520]} />
      <Table />
      <hemisphereLight ref={hemi} args={["#f3f1ec", "#9a948a", 0.32]} />
      <directionalLight
        ref={sun}
        color="#fff4e6"
        intensity={3.8}
        castShadow
        shadow-mapSize={isMobile ? [2048, 2048] : [4096, 4096]}
        shadow-bias={-0.0002}
        shadow-normalBias={0.035}
        shadow-radius={3}
        shadow-camera-left={-54}
        shadow-camera-right={54}
        shadow-camera-top={54}
        shadow-camera-bottom={-54}
        shadow-camera-near={10}
        shadow-camera-far={320}
      />
      {Array.from({ length: LAMP_LIGHTS }, (_, i) => (
        <pointLight
          key={i}
          ref={(l) => {
            lampLights.current[i] = l;
          }}
          color="#ffd59a"
          intensity={0}
          distance={34}
          decay={2}
          visible={false}
        />
      ))}
      {state && <primitive object={state.view.root} />}
      {/*
        AO is what makes it look real (contact shading under every piece and round every stud),
        so it always stays; it runs at half resolution with depth-aware upsampling, and SMAA
        stands in for MSAA, which costs far more alongside it. Depth of field is the first
        thing to go on a slower GPU, then bloom.
      */}
      <EffectComposer key={`${tier}${bloomOn ? "b" : ""}`} multisampling={0} enableNormalPass={false}>
        {[
          <N8AO key="ao" aoRadius={1.6} distanceFalloff={0.5} intensity={3} quality={tier === 0 ? "low" : "medium"} halfRes color="#0d1a10" />,
          ...(tier === 2 ? [<DepthOfField key="dof" ref={dof} focusRange={60} bokehScale={BOKEH} resolutionScale={0.5} />] : []),
          ...(bloomOn ? [<Bloom key="bloom" ref={bloom} mipmapBlur intensity={0.25} luminanceThreshold={1.6} luminanceSmoothing={0.3} radius={0.7} resolutionScale={0.5} />] : []),
          <ToneMapping key="tm" mode={ToneMappingMode.NEUTRAL} />,
          // a real lens: the faintest colour fringe towards the corners, and a whisper of film grain
          ...(tier === 2 ? [<ChromaticAberration key="ca" offset={CA_OFFSET} radialModulation modulationOffset={0.35} />] : []),
          <Vignette key="vg" ref={vignette} offset={0.32} darkness={0.42} />,
          ...(tier >= 1 ? [<Noise key="grain" blendFunction={BlendFunction.SOFT_LIGHT} opacity={0.2} />] : []),
          <SMAA key="aa" />,
        ]}
      </EffectComposer>
    </>
  );
}

/** The brick world's canvas. */
export default function LegoScene({ onReady }: { onReady: () => void }) {
  return (
    <Canvas
      flat
      shadows={{ type: THREE.PCFShadowMap }}
      dpr={[1, 1.75]}
      gl={{ antialias: false, powerPreference: "high-performance", stencil: false }}
      camera={{ fov: FOV, near: 1, far: 1800, position: [0, 30, 120] }}
      onCreated={({ gl }) => {
        gl.setClearColor(DAY.horizon);
      }}
    >
      <World onReady={onReady} />
      <Capture />
    </Canvas>
  );
}
