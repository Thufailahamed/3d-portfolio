"use client";

import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Bloom, EffectComposer, SMAA, ToneMapping, Vignette } from "@react-three/postprocessing";
import { ToneMappingMode } from "postprocessing";
import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { landMask } from "./earth";
import { mc } from "./engine";
import { LaunchFeed } from "./feed";
import { OrbitView } from "./orbitview";
import { ControlRoom } from "./room";
import { Screens, type ScreenId } from "./screens";
import { useMC, type ViewId } from "./store";

type Rig = { room: ControlRoom; screens: Screens; feed: LaunchFeed; orbit: OrbitView };

const SCREEN_OF: Partial<Record<ViewId, ScreenId>> = { "s-map": "map", "s-traj": "traj", "s-clock": "clock", "s-vehicle": "vehicle", "s-weather": "weather", "s-dsn": "dsn", "s-fleet": "fleet" };

async function loadAssets() {
  const [bin, img] = await Promise.all([
    fetch("/earth/borders.bin").then((r) => (r.ok ? r.arrayBuffer() : null)).catch(() => null),
    new Promise<HTMLImageElement | null>((res) => {
      const i = new Image();
      i.onload = () => res(i);
      i.onerror = () => res(null);
      i.src = "/earth/night.webp";
    }),
  ]);
  return { bin, img };
}

function World() {
  const { gl, scene, camera } = useThree();
  const get = useThree((s) => s.get);
  const setDpr = useThree((s) => s.setDpr);
  const isMobile = useMemo(() => matchMedia("(max-width: 767px), (pointer: coarse)").matches, []);
  const [tier, setTier] = useState(isMobile ? 0 : 2);
  const [rig, setRig] = useState<Rig | null>(null);
  const perf = useRef({ frames: 0, time: 0, settle: 10 });
  const cam = useRef({ pos: new THREE.Vector3(0, 6, 14), look: new THREE.Vector3(0, 3, -10), fov: 58, yaw: 0, pitch: 0, zoom: 1 });
  const frame = useRef(0);
  const clock = useRef(0);
  const accum = useRef({ feed: 0, orbit: 0 });

  // —— build the room once ——
  useEffect(() => {
    let live = true;
    let built: Rig | null = null;
    const set = useMC.getState().set;
    set({ progress: 0.1 });
    loadAssets().then(({ bin, img }) => {
      if (!live) return;
      set({ progress: 0.35 });
      setTimeout(() => {
        if (!live) return;
        const quality = isMobile ? 0 : 2;
        const nightTex = img ? new THREE.Texture(img) : null;
        if (nightTex) {
          nightTex.colorSpace = THREE.SRGBColorSpace;
          nightTex.anisotropy = 8;
          nightTex.needsUpdate = true;
        }
        let landTex: THREE.Texture | null = null;
        if (bin) {
          const m = landMask(bin, isMobile ? 1024 : 2048, isMobile ? 512 : 1024);
          if (m) {
            landTex = new THREE.CanvasTexture(m);
            landTex.anisotropy = 8;
          }
        }
        set({ progress: 0.55 });
        mc.init();
        if (process.env.NODE_ENV !== "production") (window as unknown as { __mc: unknown }).__mc = { mc, useMC };
        const screens = new Screens(bin, img, quality);
        const feed = new LaunchFeed(gl, nightTex, landTex, quality);
        const orbit = new OrbitView(gl, nightTex, landTex);
        const room = new ControlRoom(screens, feed.rt.texture, orbit.rt.texture, quality);
        const pm = new THREE.PMREMGenerator(gl);
        scene.environment = pm.fromScene(new RoomEnvironment(), 0.04).texture;
        scene.environmentIntensity = 0.22;
        pm.dispose();
        scene.add(room.group);
        built = { room, screens, feed, orbit };
        if (process.env.NODE_ENV !== "production") (window as unknown as { __rig: unknown }).__rig = built;
        set({ progress: 0.85 });
        // compile everything before lifting the curtain
        feed.update(0.016);
        orbit.update(0.016);
        gl.compileAsync(scene, camera).then(
          () => live && (setRig(built), requestAnimationFrame(() => requestAnimationFrame(() => useMC.getState().set({ ready: true, progress: 1 })))),
          () => live && (setRig(built), useMC.getState().set({ ready: true, progress: 1 })),
        );
      }, 40);
    });
    return () => {
      live = false;
      if (built) {
        scene.remove(built.room.group);
        built.feed.dispose();
        built.orbit.dispose();
        built.screens.dispose();
      }
      mc.dispose();
    };
  }, [gl, scene, camera, isMobile]);

  useEffect(() => {
    const native = window.devicePixelRatio || 1;
    setDpr(tier === 2 ? Math.min(native, 1.5) : tier === 1 ? Math.min(native, 1.2) : 1);
  }, [tier, setDpr]);

  // —— looking around and picking screens ——
  useEffect(() => {
    if (!rig) return;
    const el = get().gl.domElement;
    let down: { x: number; y: number; id: number } | null = null;
    let moved = 0;
    let last = { x: 0, y: 0 };
    const ray = new THREE.Raycaster();
    const pick = (e: PointerEvent) => {
      const r = el.getBoundingClientRect();
      ray.setFromCamera(new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1), get().camera);
      const hit = ray.intersectObjects(rig.room.pickables, false)[0];
      return hit ? (hit.object.userData.view as ViewId) : null;
    };
    const pd = (e: PointerEvent) => {
      mc.unlock();
      down = { x: e.clientX, y: e.clientY, id: e.pointerId };
      last = { x: e.clientX, y: e.clientY };
      moved = 0;
    };
    let hoverT = 0;
    const pm = (e: PointerEvent) => {
      if (!down) {
        const now = performance.now();
        if (now - hoverT > 90) {
          hoverT = now;
          el.style.cursor = pick(e) ? "zoom-in" : "grab";
        }
        return;
      }
      if (e.pointerId !== down.id) return;
      moved = Math.max(moved, Math.hypot(e.clientX - down.x, e.clientY - down.y));
      if (moved > 4) {
        const c = cam.current;
        c.yaw = THREE.MathUtils.clamp(c.yaw - (e.clientX - last.x) * 0.0032, -1.1, 1.1);
        c.pitch = THREE.MathUtils.clamp(c.pitch - (e.clientY - last.y) * 0.0028, -0.55, 0.6);
        if (!el.hasPointerCapture(e.pointerId)) el.setPointerCapture(e.pointerId);
        el.style.cursor = "grabbing";
      }
      last = { x: e.clientX, y: e.clientY };
    };
    const pu = (e: PointerEvent) => {
      if (!down || e.pointerId !== down.id) return;
      if (moved <= 4) {
        const v = pick(e);
        const s = useMC.getState();
        if (v) {
          s.set({ view: s.view === v ? "fd" : v });
          cam.current.yaw = cam.current.pitch = 0;
          cam.current.zoom = 1;
        }
      }
      down = null;
      el.style.cursor = "grab";
    };
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      const c = cam.current;
      c.zoom = THREE.MathUtils.clamp(c.zoom * Math.exp((e.deltaMode === 1 ? 16 : 1) * e.deltaY * 0.001), 0.35, 1.25);
    };
    const key = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.closest?.("input, textarea, select")) return;
      if (e.code === "Escape") {
        useMC.getState().set({ view: "fd" });
        cam.current.yaw = cam.current.pitch = 0;
        cam.current.zoom = 1;
      }
    };
    el.addEventListener("pointerdown", pd);
    el.addEventListener("pointermove", pm);
    el.addEventListener("pointerup", pu);
    el.addEventListener("pointercancel", pu);
    el.addEventListener("wheel", wheel, { passive: false });
    addEventListener("keydown", key);
    el.style.cursor = "grab";
    // a new view resets the free look
    const unsub = useMC.subscribe((s, p) => {
      if (s.view !== p.view) {
        cam.current.yaw = cam.current.pitch = 0;
        cam.current.zoom = 1;
      }
    });
    return () => {
      el.removeEventListener("pointerdown", pd);
      el.removeEventListener("pointermove", pm);
      el.removeEventListener("pointerup", pu);
      el.removeEventListener("pointercancel", pu);
      el.removeEventListener("wheel", wheel);
      removeEventListener("keydown", key);
      unsub();
    };
  }, [rig, get]);

  useFrame((state, rawDt) => {
    if (!rig) return;
    const dt = Math.min(rawDt, 0.05);
    clock.current += dt;
    frame.current++;
    mc.update(dt);
    const s = useMC.getState();
    const focus = SCREEN_OF[s.view];
    const acc = accum.current;
    acc.feed += dt;
    acc.orbit += dt;
    // the launch feed is the most expensive view: full rate when you are looking at it, ~30 Hz in flight, ~8 Hz idle
    const feedEvery = s.view === "s-feed" ? 0 : s.ops.phase !== "idle" ? 1 / 32 : 1 / 8;
    if (acc.feed >= feedEvery) {
      rig.feed.update(Math.min(acc.feed, 0.1));
      acc.feed = 0;
    }
    if (acc.orbit >= (s.view === "s-orbit" ? 0 : 1 / 12)) {
      rig.orbit.update(acc.orbit);
      acc.orbit = 0;
    }
    rig.screens.update(clock.current, 1, focus);
    rig.room.update(dt);
    // camera rig
    const pose = rig.room.pose(s.view, state.size.width / state.size.height);
    const c = cam.current;
    const k = 1 - Math.exp(-dt * 3.2);
    c.pos.lerp(pose.pos, k);
    c.look.lerp(pose.look, k);
    c.fov += (pose.fov * c.zoom - c.fov) * k;
    const pc = state.camera as THREE.PerspectiveCamera;
    pc.position.copy(c.pos);
    const dir = c.look.clone().sub(c.pos);
    const sph = new THREE.Spherical().setFromVector3(dir);
    sph.theta += c.yaw;
    sph.phi = THREE.MathUtils.clamp(sph.phi - c.pitch, 0.2, Math.PI - 0.2);
    pc.lookAt(c.pos.clone().add(new THREE.Vector3().setFromSpherical(sph)));
    pc.fov = c.fov;
    pc.updateProjectionMatrix();
    // step the resolution down if frames run slow
    const pf = perf.current;
    if (pf.settle > 0) pf.settle -= rawDt;
    else if (rawDt < 0.25) {
      pf.frames++;
      pf.time += rawDt;
      if (pf.time > 3) {
        const fps = pf.frames / pf.time;
        pf.frames = pf.time = 0;
        if (fps < 40 && tier > 0) {
          setTier((t) => t - 1);
          pf.settle = 5;
        }
      }
    }
  });

  return (
    <EffectComposer key={tier} multisampling={0} enableNormalPass={false}>
      <Bloom mipmapBlur intensity={0.7} luminanceThreshold={1.05} luminanceSmoothing={0.3} radius={0.72} resolutionScale={tier === 2 ? 0.5 : 0.35} />
      <ToneMapping mode={ToneMappingMode.NEUTRAL} />
      <Vignette offset={0.3} darkness={0.55} />
      <SMAA />
    </EffectComposer>
  );
}

export default function Scene() {
  return (
    <Canvas
      flat
      dpr={[1, 1.5]}
      gl={{ antialias: false, powerPreference: "high-performance", stencil: false }}
      camera={{ fov: 58, near: 0.05, far: 400, position: [0, 6, 14] }}
      onCreated={({ gl }) => {
        gl.setClearColor("#000000");
        gl.shadowMap.enabled = true;
        gl.shadowMap.type = THREE.PCFSoftShadowMap;
      }}
    >
      <World />
    </Canvas>
  );
}
