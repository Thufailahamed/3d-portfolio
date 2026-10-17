"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { person, projects } from "@/content/site";
import { gsap, useGSAP } from "@/lib/gsap";
import { sceneState } from "@/lib/sceneState";
import { SPAWN_HALL, SPAWN_PLAZA, WALK_SETTINGS_KEY } from "@/experience/flowWalk";
import { useApp } from "@/store/useApp";
import NowBuilding from "@/components/NowBuilding";
import BlueprintOverlay from "./BlueprintOverlay";
import GuestbookPanel from "./GuestbookPanel";
import { showcaseStation } from "./blueprintSheets";
import RenderModePanel, { pickStyle, pickWeather } from "./RenderModePanel";
import ThermalHUD, { cyclePalette, toggleThermal, zoomBy } from "./ThermalHUD";
import WalkHUD from "./WalkHUD";

const pad = (n: number) => String(n).padStart(2, "0");

/**
 * High-DPI Vector-Sharp 3D Wireframe Icosahedron Emblem
 */
function WireframeEmblem() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = typeof window !== "undefined" ? Math.min(window.devicePixelRatio || 1, 2) : 1;
    const size = 32;
    canvas.width = size * dpr;
    canvas.height = size * dpr;
    ctx.scale(dpr, dpr);

    let animId = 0;
    let angleX = 0.25;
    let angleY = 0;

    // 12 vertices of an icosahedron
    const phi = (1 + Math.sqrt(5)) / 2;
    const rawVerts: [number, number, number][] = [
      [-1, phi, 0],
      [1, phi, 0],
      [-1, -phi, 0],
      [1, -phi, 0],
      [0, -1, phi],
      [0, 1, phi],
      [0, -1, -phi],
      [0, 1, -phi],
      [phi, 0, -1],
      [phi, 0, 1],
      [-phi, 0, -1],
      [-phi, 0, 1],
    ];
    const verts = rawVerts.map(([x, y, z]) => {
      const len = Math.hypot(x, y, z);
      return [x / len, y / len, z / len] as [number, number, number];
    });

    const edges: [number, number][] = [];
    for (let i = 0; i < verts.length; i++) {
      for (let j = i + 1; j < verts.length; j++) {
        const d = Math.hypot(
          verts[i][0] - verts[j][0],
          verts[i][1] - verts[j][1],
          verts[i][2] - verts[j][2],
        );
        if (Math.abs(d - 1.05146) < 0.15) {
          edges.push([i, j]);
        }
      }
    }

    const render = () => {
      angleY += 0.014;
      angleX += 0.006;

      ctx.clearRect(0, 0, size, size);
      const cx = size / 2;
      const cy = size / 2;
      const r = 13.5;

      const cosY = Math.cos(angleY);
      const sinY = Math.sin(angleY);
      const cosX = Math.cos(angleX);
      const sinX = Math.sin(angleX);

      const projected = verts.map(([x, y, z]) => {
        const x1 = x * cosY - z * sinY;
        const z1 = x * sinY + z * cosY;
        const y2 = y * cosX - z1 * sinX;
        const z2 = y * sinX + z1 * cosX;
        return [cx + x1 * r, cy - y2 * r, z2] as [number, number, number];
      });

      ctx.strokeStyle = "rgba(255, 255, 255, 0.78)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (const [i, j] of edges) {
        ctx.moveTo(projected[i][0], projected[i][1]);
        ctx.lineTo(projected[j][0], projected[j][1]);
      }
      ctx.stroke();

      animId = requestAnimationFrame(render);
    };

    render();
    return () => cancelAnimationFrame(animId);
  }, []);

  return (
    <canvas
      ref={canvasRef}
      style={{ width: 32, height: 32 }}
      className="inline-block pointer-events-auto my-1.5"
      aria-hidden="true"
    />
  );
}

type FlowViewName = "exterior" | "drone" | "walk" | "hall" | "showcase";

const COMPASS_PX_PER_DEG = 3;
const COMPASS_WIDTH = 300;
const CARDINALS: Record<number, string> = { 0: "N", 45: "NE", 90: "E", 135: "SE", 180: "S", 225: "SW", 270: "W", 315: "NW" };
const COMPASS_MARKS = Array.from({ length: 49 }, (_, i) => i * 15 - 180);

/**
 * Drone camera viewfinder: corner brackets, reticle, heading tape, altitude ladder and live
 * telemetry. Values are written straight into the DOM every frame from sceneState.
 */
function DroneHUD() {
  const root = useRef<HTMLDivElement>(null);
  const tc = useRef<HTMLSpanElement>(null);
  const mode = useRef<HTMLSpanElement>(null);
  const compass = useRef<HTMLDivElement>(null);
  const hdg = useRef<HTMLSpanElement>(null);
  const tape = useRef<HTMLDivElement>(null);
  const alt = useRef<HTMLSpanElement>(null);
  const dist = useRef<HTMLSpanElement>(null);
  const spd = useRef<HTMLSpanElement>(null);
  const gim = useRef<HTMLSpanElement>(null);
  const bat = useRef<HTMLSpanElement>(null);
  const batBar = useRef<HTMLSpanElement>(null);

  useGSAP(
    () => {
      gsap.fromTo(".drone-in", { autoAlpha: 0 }, { autoAlpha: 1, duration: 0.6, stagger: 0.06, delay: 0.5 });
    },
    { scope: root },
  );

  useEffect(() => {
    const start = performance.now();
    let id = 0;
    const tick = () => {
      const d = sceneState.flow.drone;
      const secs = (performance.now() - start) / 1000;
      const hh = Math.floor(secs / 3600);
      const mm = Math.floor(secs / 60) % 60;
      const ss = Math.floor(secs) % 60;
      const ff = Math.floor((secs % 1) * 24);
      if (tc.current) tc.current.textContent = `${pad(hh)}:${pad(mm)}:${pad(ss)}:${pad(ff)}`;
      if (mode.current) {
        mode.current.textContent = d.p < 0.98 ? "ASCENDING" : d.idle < 3.5 ? "MANUAL" : "AUTO ORBIT";
      }
      if (compass.current) {
        compass.current.style.transform = `translateX(${COMPASS_WIDTH / 2 - (d.heading + 180) * COMPASS_PX_PER_DEG}px)`;
      }
      if (hdg.current) hdg.current.textContent = `${String(Math.round(d.heading) % 360).padStart(3, "0")}°`;
      if (tape.current) tape.current.style.backgroundPositionY = `${d.alt * 6}px`;
      if (alt.current) alt.current.textContent = d.alt.toFixed(1).padStart(5, "0");
      if (dist.current) dist.current.textContent = `${d.dist.toFixed(1)} M`;
      if (spd.current) spd.current.textContent = `${d.speed.toFixed(1)} M/S`;
      if (gim.current) gim.current.textContent = `${d.pitch.toFixed(0)}°`;
      const charge = Math.max(14, 98 - secs / 9);
      if (bat.current) bat.current.textContent = `${charge.toFixed(0)}%`;
      if (batBar.current) batBar.current.style.width = `${charge}%`;
      id = requestAnimationFrame(tick);
    };
    tick();
    return () => cancelAnimationFrame(id);
  }, []);

  const corner = "drone-in absolute w-7 h-7 border-white/70";
  return (
    <div ref={root} aria-hidden className="pointer-events-none absolute inset-0 z-[5] font-mono uppercase">
      {/* Viewfinder frame */}
      <div className="absolute left-[6%] right-[6%] top-[18%] bottom-[30%] md:left-[22%] md:right-[18%] md:top-[17%] md:bottom-[24%]">
        <span className={`${corner} left-0 top-0 border-l border-t`} />
        <span className={`${corner} right-0 top-0 border-r border-t`} />
        <span className={`${corner} left-0 bottom-0 border-l border-b`} />
        <span className={`${corner} right-0 bottom-0 border-r border-b`} />

        {/* REC + timecode / flight mode */}
        <div className="drone-in absolute left-3 top-2 flex items-center gap-2 text-[9.5px] tracking-[0.2em] text-white/80">
          <span className="inline-block h-1.5 w-1.5 rounded-full bg-red-500 animate-pulse" />
          <span>REC</span>
          <span ref={tc} className="tabular-nums text-white/60" />
        </div>
        <div className="drone-in absolute right-3 top-2 text-right text-[9.5px] tracking-[0.2em] text-white/60">
          <span className="text-white/40">4K · 24P · </span>
          <span ref={mode} className="text-accent" />
        </div>

        {/* Heading tape */}
        <div className="drone-in absolute left-1/2 -top-9 -translate-x-1/2" style={{ width: COMPASS_WIDTH }}>
          <div
            className="relative h-6 overflow-hidden"
            style={{
              maskImage: "linear-gradient(90deg, transparent, #000 22%, #000 78%, transparent)",
              WebkitMaskImage: "linear-gradient(90deg, transparent, #000 22%, #000 78%, transparent)",
            }}
          >
            <div ref={compass} className="absolute left-0 top-0 h-full will-change-transform">
              {COMPASS_MARKS.map((deg) => {
                const n = ((deg % 360) + 360) % 360;
                const label = CARDINALS[n];
                return (
                  <div
                    key={deg}
                    className="absolute top-0 flex -translate-x-1/2 flex-col items-center"
                    style={{ left: (deg + 180) * COMPASS_PX_PER_DEG }}
                  >
                    <span className={`w-px ${n % 45 === 0 ? "h-2.5 bg-white/80" : "h-1.5 bg-white/40"}`} />
                    <span className={`mt-0.5 text-[8.5px] tracking-widest ${label ? "text-white" : "text-white/35"}`}>
                      {label ?? n}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
          <div className="mx-auto mt-0.5 w-fit border border-white/40 bg-black/60 px-1.5 text-[9px] tracking-widest text-white tabular-nums">
            <span ref={hdg} />
          </div>
        </div>

        {/* Altitude ladder */}
        <div className="drone-in absolute -left-16 top-1/2 hidden -translate-y-1/2 items-center gap-2 md:flex">
          <div
            ref={tape}
            className="h-40 w-3 border-r border-white/30"
            style={{
              backgroundImage:
                "repeating-linear-gradient(to bottom, rgba(255,255,255,0.55) 0 1px, transparent 1px 6px), repeating-linear-gradient(to bottom, rgba(255,255,255,0.9) 0 1px, transparent 1px 30px)",
              backgroundSize: "60% 100%, 100% 100%",
              backgroundRepeat: "repeat-y",
              backgroundPosition: "right 0",
              maskImage: "linear-gradient(transparent, #000 25%, #000 75%, transparent)",
              WebkitMaskImage: "linear-gradient(transparent, #000 25%, #000 75%, transparent)",
            }}
          />
          <div className="flex flex-col text-[9px] tracking-[0.2em] text-white/50">
            <span>ALT</span>
            <span className="border border-white/40 bg-black/60 px-1 text-[10px] text-white tabular-nums">
              <span ref={alt} />
              <span className="text-white/50"> M</span>
            </span>
          </div>
        </div>

        {/* Reticle */}
        <svg
          className="drone-in absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 text-white/70"
          width="64"
          height="64"
          viewBox="0 0 64 64"
          fill="none"
          stroke="currentColor"
          strokeWidth="1"
        >
          <circle cx="32" cy="32" r="11" strokeDasharray="3 4" />
          <path d="M32 4v12M32 48v12M4 32h12M48 32h12" />
          <circle cx="32" cy="32" r="1.2" fill="currentColor" />
        </svg>

        {/* GPS / gimbal */}
        <div className="drone-in absolute bottom-2 left-3 text-[9px] tracking-[0.18em] text-white/50">
          LAT 6.9271° N · LON 79.8612° E
        </div>
        <div className="drone-in absolute bottom-2 right-3 text-[9px] tracking-[0.18em] text-white/50">
          GIMBAL <span ref={gim} className="text-white tabular-nums" />
        </div>
      </div>

      {/* Telemetry */}
      <div className="drone-in absolute right-6 top-1/2 hidden -translate-y-1/2 flex-col gap-2 text-[9px] tracking-[0.2em] text-white/45 md:flex md:right-10">
        <div className="text-white/80">SYNAPX · DRONE 01</div>
        <div className="flex justify-between gap-6">
          <span>DIST</span>
          <span ref={dist} className="text-white tabular-nums" />
        </div>
        <div className="flex justify-between gap-6">
          <span>SPD</span>
          <span ref={spd} className="text-white tabular-nums" />
        </div>
        <div className="flex justify-between gap-6">
          <span>SIGNAL</span>
          <span className="flex items-end gap-px">
            {[3, 5, 7, 9].map((h) => (
              <span key={h} className="w-[3px] bg-white/80" style={{ height: h }} />
            ))}
          </span>
        </div>
        <div className="flex items-center justify-between gap-6">
          <span>BAT</span>
          <span className="flex items-center gap-1.5">
            <span className="relative inline-block h-2 w-7 border border-white/50 p-px">
              <span ref={batBar} className="block h-full bg-white/80" />
            </span>
            <span ref={bat} className="text-white tabular-nums" />
          </span>
        </div>
      </div>
    </div>
  );
}

/** Physical key codes (layout independent) to first-person movement intents. */
const WALK_KEYS: Record<string, "f" | "b" | "l" | "r" | "sprint" | "crouch"> = {
  KeyW: "f",
  ArrowUp: "f",
  KeyS: "b",
  ArrowDown: "b",
  KeyA: "l",
  ArrowLeft: "l",
  KeyD: "r",
  ArrowRight: "r",
  ShiftLeft: "sprint",
  ShiftRight: "sprint",
  KeyC: "crouch",
};

const KEYMAP: [string, string][] = [
  ["ENTER", "Enter the hall"],
  ["F", "Walk in first person"],
  ["D", "Drone / aerial view"],
  ["DRAG", "Look · orbit in drone"],
  ["SCROLL", "Walk · zoom in drone"],
  ["1 – 6", "Jump to a showcase"],
  ["← →", "Previous / next showcase"],
  ["E / H", "Exterior / hall"],
  ["X", "X-ray / realistic"],
  ["B", "Thermal binoculars (P palette)"],
  ["T", "Day · night · rain (realistic)"],
  ["M", "Plans · elevation · sections"],
  ["ESC", "Back · land"],
];

export default function FlowView() {
  const root = useRef<HTMLDivElement>(null);
  const layer = useRef<HTMLDivElement>(null);
  const router = useRouter();
  const flowView = useApp((s) => s.flowView);
  const flowFocus = useApp((s) => s.flowFocus);
  const sound = useApp((s) => s.sound);
  const set = useApp((s) => s.set);

  const [showKeys, setShowKeys] = useState(false);
  const [locked, setLocked] = useState(false);
  const [touch, setTouch] = useState(false);
  const [plans, setPlans] = useState(false);
  const pending = useRef<gsap.core.Tween | null>(null);
  const unlockedAt = useRef(0);

  const activeProject = flowFocus !== null ? projects[flowFocus] : null;
  const walking = flowView === "walk";
  const thermal = useApp((s) => s.thermal);

  useEffect(() => {
    const mq = matchMedia("(pointer: coarse)");
    const sync = () => setTouch(mq.matches);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);

  const lockPointer = () => {
    const el = layer.current;
    if (!el || matchMedia("(pointer: coarse)").matches || document.pointerLockElement === el) return;
    const plain = () => {
      try {
        const r = el.requestPointerLock() as unknown as Promise<void> | undefined;
        r?.catch?.(() => {});
      } catch {
        // no pointer lock (iframe / unsupported): the pause screen stays up
      }
    };
    try {
      // raw mouse counts, without the OS pointer acceleration curve, where supported
      const r = (
        el.requestPointerLock as unknown as (o?: { unadjustedMovement?: boolean }) => Promise<void> | undefined
      ).call(el, { unadjustedMovement: true });
      if (r && typeof r.catch === "function") r.catch(plain);
    } catch {
      plain();
    }
  };

  // Walk preferences survive reloads (per viewer, best effort)
  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(WALK_SETTINGS_KEY) ?? "null");
      if (saved && typeof saved === "object") Object.assign(sceneState.flow.fp.settings, saved);
    } catch {
      // storage unavailable: defaults
    }
  }, []);

  const releaseKeys = () => {
    const k = sceneState.flow.fp.keys;
    k.f = k.b = k.l = k.r = k.sprint = k.crouch = k.jump = false;
  };

  const applyView = (view: FlowViewName, focus: number | null) => {
    gsap.to(sceneState.flow, {
      pan: 0,
      tilt: 0,
      ...(view !== "hall" ? { walk: 0 } : {}),
      duration: 0.85,
      ease: "power2.out",
    });
    if (view === "drone") sceneState.flow.drone.idle = 99;
    if (view !== "walk") {
      releaseKeys();
      if (document.pointerLockElement) document.exitPointerLock();
    }
    set({ flowView: view, flowFocus: focus });
  };

  /** Drop into first person: inside the portal if we were in the hall, otherwise on the plaza. */
  const startWalk = (fromIndoors: boolean) => {
    const sp = fromIndoors ? SPAWN_HALL : SPAWN_PLAZA;
    Object.assign(sceneState.flow.fp, {
      x: sp.x,
      z: sp.z,
      yaw: sp.yaw,
      pitch: -0.02,
      vx: 0,
      vz: 0,
      vy: 0,
      phase: 0,
      needsGround: true,
      frozen: false,
      crouch: 0,
      roll: 0,
      target: -1,
    });
    releaseKeys();
    applyView("walk", null);
    lockPointer();
  };

  const switchView = (view: FlowViewName, focus: number | null = null, force = false) => {
    // the binoculars hold the view: no flying, walking or moving between views while they are up
    if (useApp.getState().thermal && !force) return;
    pending.current?.kill();
    pending.current = null;
    const current = useApp.getState().flowView;
    const indoors = (v: FlowViewName) =>
      v === "hall" || v === "showcase" || (v === "walk" && sceneState.flow.fp.indoors);
    const airborne = current === "drone" || sceneState.flow.drone.p > 0.02;

    if (view === "walk") {
      if (airborne) {
        applyView("exterior", null);
        pending.current = gsap.delayedCall(sceneState.flow.drone.p * 2.6 + 0.4, () => startWalk(false));
      } else {
        startWalk(indoors(current));
      }
      return;
    }
    // Never cut through the roof: land on the plaza before walking in,
    // and walk back out through the portal before taking off.
    if (indoors(view) && airborne) {
      applyView("exterior", null);
      pending.current = gsap.delayedCall(sceneState.flow.drone.p * 2.6 + 0.4, () => applyView(view, focus));
      return;
    }
    if (view === "drone" && indoors(current)) {
      applyView("exterior", null);
      pending.current = gsap.delayedCall(1.4, () => applyView("drone", null));
      return;
    }
    applyView(view, focus);
  };

  const exitWalk = () => switchView(sceneState.flow.fp.indoors ? "hall" : "exterior", null);

  useEffect(() => {
    if (!thermal) return;
    if (flowView === "drone") switchView("exterior", null, true);
    else if (flowView === "walk") switchView(sceneState.flow.fp.indoors ? "hall" : "exterior", null, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [thermal]);

  const inspect = (i: number) => {
    if (i < 0) return;
    releaseKeys();
    set({ flowFocus: i });
    if (document.pointerLockElement) document.exitPointerLock();
  };

  const closeInspect = () => {
    set({ flowFocus: null });
    lockPointer();
  };

  /** The drawing set: walking pauses (mouse released) while it is up and resumes on close. */
  const openPlans = () => {
    if (useApp.getState().thermal) return;
    releaseKeys();
    if (document.pointerLockElement) document.exitPointerLock();
    setPlans(true);
  };

  const closePlans = () => {
    setPlans(false);
    if (useApp.getState().flowView === "walk" && useApp.getState().flowFocus === null) lockPointer();
  };

  /** From a plan: walk to the showcase's camera station facing its vitrine, or fly the camera there. */
  const goToShowcase = (i: number) => {
    setPlans(false);
    if (useApp.getState().flowView !== "walk") {
      switchView("showcase", i);
      return;
    }
    const st = showcaseStation(i);
    Object.assign(sceneState.flow.fp, {
      x: st.x,
      z: st.z,
      yaw: st.yaw,
      pitch: -0.06,
      viewPitch: -0.06,
      vx: 0,
      vz: 0,
      vy: 0,
      needsGround: true,
      target: -1,
    });
    releaseKeys();
    lockPointer();
  };

  useEffect(() => () => void pending.current?.kill(), []);

  // Pointer lock state, and raw mouse look while locked
  useEffect(() => {
    const onChange = () => {
      const on = document.pointerLockElement === layer.current;
      setLocked(on);
      if (!on) {
        unlockedAt.current = performance.now();
        releaseKeys();
      }
    };
    const onMouse = (e: MouseEvent) => {
      if (document.pointerLockElement !== layer.current) return;
      const fp = sceneState.flow.fp;
      // ignore the occasional huge spike some browsers emit on lock
      if (Math.abs(e.movementX) > 800 || Math.abs(e.movementY) > 800) return;
      fp.lookDX += e.movementX;
      fp.lookDY += e.movementY;
    };
    const onBlur = () => releaseKeys();
    document.addEventListener("pointerlockchange", onChange);
    document.addEventListener("mousemove", onMouse);
    window.addEventListener("blur", onBlur);
    return () => {
      document.removeEventListener("pointerlockchange", onChange);
      document.removeEventListener("mousemove", onMouse);
      window.removeEventListener("blur", onBlur);
      if (document.pointerLockElement) document.exitPointerLock();
    };
  }, []);

  // No walking while a placard card is open
  useEffect(() => {
    sceneState.flow.fp.frozen = walking && flowFocus !== null;
  }, [walking, flowFocus]);

  useGSAP(
    () => {
      gsap.fromTo(
        ".flow-cad-in",
        { autoAlpha: 0, y: -8 },
        {
          autoAlpha: 1,
          y: 0,
          duration: 0.7,
          stagger: 0.05,
          ease: "power3.out",
          delay: 0.1,
        },
      );
    },
    { scope: root },
  );

  // Support optional ?view=hall or ?showcase=1..6 query parameters
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const v = params.get("view");
    const sc = params.get("showcase");
    if (sc !== null) {
      const idx = Math.max(0, Math.min(projects.length - 1, parseInt(sc, 10) - 1));
      if (!Number.isNaN(idx)) set({ flowView: "showcase", flowFocus: idx });
    } else if (v === "hall") {
      set({ flowView: "hall", flowFocus: null });
    } else if (v === "drone") {
      set({ flowView: "drone", flowFocus: null });
    } else if (v === "walk") {
      // optional ?at=x,z,yawDegrees drops you at a specific spot
      const [ax, az, ayaw] = (params.get("at") ?? "").split(",").map(Number);
      const at =
        Number.isFinite(ax) && Number.isFinite(az)
          ? { x: ax, z: az, yaw: Number.isFinite(ayaw) ? (ayaw * Math.PI) / 180 : 0 }
          : SPAWN_PLAZA;
      Object.assign(sceneState.flow.fp, { ...at, pitch: -0.02, needsGround: true });
      set({ flowView: "walk", flowFocus: null });
    } else if (v === "exterior") {
      set({ flowView: "exterior", flowFocus: null });
    }
  }, [set]);

  // Interactive drag-to-look, click-to-pick (portal & showcases), and wheel stroll
  useEffect(() => {
    const el = layer.current;
    if (!el) return;
    let down: { x: number; y: number } | null = null;
    let lastX = 0;
    let lastY = 0;

    const isWalk = () => useApp.getState().flowView === "walk";

    const onDown = (e: PointerEvent) => {
      if (isWalk() && e.pointerType === "mouse") {
        // first person on desktop: any click captures the mouse
        if (useApp.getState().flowFocus === null) lockPointer();
        return;
      }
      down = { x: e.clientX, y: e.clientY };
      lastX = e.clientX;
      lastY = e.clientY;
      try {
        el.setPointerCapture(e.pointerId);
      } catch {
        // ignore synthetic events
      }
      gsap.killTweensOf(sceneState.flow, "pan,tilt");
    };

    const onMove = (e: PointerEvent) => {
      const f = sceneState.flow;
      if (isWalk()) {
        // touch look: drag anywhere outside the joystick
        if (down) {
          f.fp.lookDX += (e.clientX - lastX) * 1.6;
          f.fp.lookDY += (e.clientY - lastY) * 1.6;
          lastX = e.clientX;
          lastY = e.clientY;
        }
        return;
      }
      if (!down) {
        if (useApp.getState().thermal) {
          f.hover = -1;
          el.style.cursor = "grab";
          return;
        }
        const hit = f.pick((e.clientX / window.innerWidth) * 2 - 1, -(e.clientY / window.innerHeight) * 2 + 1);
        f.hover = hit;
        el.style.cursor = hit >= 0 ? "pointer" : "grab";
        return;
      }
      el.style.cursor = "grabbing";
      const dx = (e.clientX - lastX) / window.innerWidth;
      const dy = (e.clientY - lastY) / window.innerHeight;
      if (useApp.getState().flowView === "drone") {
        // orbit freely around the complex; drag down to climb for a steeper plan view
        f.drone.spin -= dx * 4.2;
        f.drone.height = gsap.utils.clamp(-20, 34, f.drone.height + dy * 46);
        f.drone.idle = 0;
        lastX = e.clientX;
        lastY = e.clientY;
        return;
      }
      f.pan = gsap.utils.clamp(-1.1, 1.1, f.pan + dx * 2.2);
      f.tilt = gsap.utils.clamp(-0.55, 0.75, f.tilt - dy * 1.8);
      lastX = e.clientX;
      lastY = e.clientY;
    };

    const onUp = (e: PointerEvent) => {
      const start = down;
      down = null;
      el.style.cursor = "grab";
      if (!start || Math.hypot(e.clientX - start.x, e.clientY - start.y) > 8) return;
      if (useApp.getState().thermal) return;
      if (isWalk()) {
        // a tap on touch inspects what the crosshair is on
        inspect(sceneState.flow.fp.target);
        return;
      }

      const hit = sceneState.flow.pick(
        (e.clientX / window.innerWidth) * 2 - 1,
        -(e.clientY / window.innerHeight) * 2 + 1,
      );
      if (hit === 99) {
        switchView("hall", null);
      } else if (hit >= 0 && hit < projects.length) {
        switchView("showcase", hit);
      } else if (useApp.getState().flowView === "showcase") {
        switchView("hall", null);
      }
    };

    const onWheel = (e: WheelEvent) => {
      const currentView = useApp.getState().flowView;
      if (currentView === "hall") {
        e.preventDefault();
        sceneState.flow.walk = gsap.utils.clamp(0, 22, sceneState.flow.walk + e.deltaY * 0.015);
      } else if (currentView === "drone") {
        e.preventDefault();
        const d = sceneState.flow.drone;
        d.zoom = gsap.utils.clamp(-26, 44, d.zoom + e.deltaY * 0.035);
        d.idle = Math.min(d.idle, 1.2);
      }
    };

    el.addEventListener("pointerdown", onDown);
    el.addEventListener("pointermove", onMove);
    el.addEventListener("pointerup", onUp);
    el.addEventListener("wheel", onWheel, { passive: false });

    return () => {
      el.removeEventListener("pointerdown", onDown);
      el.removeEventListener("pointermove", onMove);
      el.removeEventListener("pointerup", onUp);
      el.removeEventListener("wheel", onWheel);
    };
  }, []);

  // Keyboard navigation shortcuts
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement | null)?.closest?.("input, textarea, [contenteditable]")) return;
      // the drawing set takes its own keys while it is open
      if (plans) return;
      // thermal binoculars: B raises / lowers; while up, P palette, + / − zoom, Esc lowers
      const key = e.key.toLowerCase();
      if (key === "b" && !e.repeat) {
        toggleThermal();
        return;
      }
      if (key === "m" && !e.repeat && !useApp.getState().thermal) {
        openPlans();
        return;
      }
      if (useApp.getState().thermal) {
        if (key === "p" && !e.repeat) cyclePalette();
        else if (key === "+" || key === "=") zoomBy(1.25);
        else if (key === "-" || key === "_") zoomBy(0.8);
        else if (e.key === "Escape") toggleThermal(false);
        if (WALK_KEYS[e.code] || e.code === "Space") e.preventDefault();
        return;
      }
      if ((e.target as HTMLElement | null)?.closest?.("input, textarea, [contenteditable]")) return;
      if (flowView === "walk") {
        const k = sceneState.flow.fp.keys;
        if (WALK_KEYS[e.code]) {
          k[WALK_KEYS[e.code]] = true;
          e.preventDefault();
        } else if (e.code === "Space") {
          if (!e.repeat) k.jump = true;
          e.preventDefault();
        } else if (e.code === "KeyE" && !e.repeat) {
          if (flowFocus !== null) closeInspect();
          else inspect(sceneState.flow.fp.target);
        } else if (e.key === "Escape") {
          if (flowFocus !== null) {
            set({ flowFocus: null });
          } else if (!document.pointerLockElement && performance.now() - unlockedAt.current > 400) {
            // the first Esc only releases the mouse (pause); a second one leaves first person
            exitWalk();
          }
        }
        return;
      }
      if (e.key === "Escape") {
        if (flowView === "showcase") {
          switchView("hall", null);
        } else if (flowView === "hall" || flowView === "drone") {
          switchView("exterior", null);
        } else {
          router.push("/projects");
        }
      } else if (e.key === "Enter" && (flowView === "exterior" || flowView === "drone")) {
        switchView("hall", null);
      } else if (e.key.toLowerCase() === "d") {
        switchView(flowView === "drone" ? "exterior" : "drone", null);
      } else if (e.key.toLowerCase() === "f") {
        switchView("walk", null);
      } else if (e.key === "ArrowRight") {
        const next = flowFocus === null ? 0 : (flowFocus + 1) % projects.length;
        switchView("showcase", next);
      } else if (e.key === "ArrowLeft") {
        const prev = flowFocus === null ? projects.length - 1 : (flowFocus - 1 + projects.length) % projects.length;
        switchView("showcase", prev);
      } else if (e.key >= "1" && e.key <= "6") {
        const idx = parseInt(e.key, 10) - 1;
        switchView("showcase", idx);
      } else if (e.key.toLowerCase() === "e") {
        switchView("exterior", null);
      } else if (e.key.toLowerCase() === "h") {
        switchView("hall", null);
      } else if (e.key.toLowerCase() === "g" && flowView === "hall" && !e.repeat) {
        e.preventDefault();
        set({ guestbookOpen: true });
      } else if (e.key.toLowerCase() === "x") {
        pickStyle(useApp.getState().flowStyle === "real" ? "xray" : "real");
      } else if (e.key.toLowerCase() === "t" && useApp.getState().flowStyle === "real") {
        const order = ["day", "night", "rain"] as const;
        pickWeather(order[(order.indexOf(useApp.getState().weather) + 1) % order.length]);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [flowView, flowFocus, router, plans]);

  // Key releases for first-person movement (always listening so nothing sticks)
  useEffect(() => {
    const onUp = (e: KeyboardEvent) => {
      const key = WALK_KEYS[e.code];
      if (key) sceneState.flow.fp.keys[key] = false;
    };
    window.addEventListener("keyup", onUp);
    return () => window.removeEventListener("keyup", onUp);
  }, []);

  return (
    <div
      ref={root}
      className="fixed inset-0 z-20 flex flex-col justify-between pointer-events-none p-6 sm:p-8 md:p-10 pb-8 sm:pb-10 md:pb-12 select-none"
      role="region"
      aria-label="Architectural CAD Blueprint Exhibition"
    >
      {/* Interactive 3D Pointer Layer for Drag-to-Look & Raycast Picking */}
      <div ref={layer} aria-hidden className="pointer-events-auto absolute inset-0 touch-none cursor-grab" />

      {/* Drone camera viewfinder overlay */}
      {flowView === "drone" && <DroneHUD />}

      {/* First-person overlay */}
      {walking && (
        <WalkHUD
          locked={locked}
          touch={touch}
          inspecting={flowFocus !== null}
          onResume={lockPointer}
          onExit={exitWalk}
          onJump={() => {
            sceneState.flow.fp.keys.jump = true;
          }}
        />
      )}

      {/* TOP HEADER: Architectural Studio Manifesto, Brand Logo, and Menu */}
      <header
        className={`relative z-10 flex items-start justify-between transition-opacity duration-500 ${
          thermal ? "pointer-events-none opacity-0" : "pointer-events-auto"
        }`}
      >
        {/* Top Left: Software Architect & Studio Title & Manifesto Paragraph */}
        <div className="flow-cad-in flex flex-col items-start gap-1 max-w-[290px] sm:max-w-xs">
          <h1 className="text-[10.5px] sm:text-[11px] font-mono uppercase tracking-[0.22em] text-white/90 font-medium">
            SOFTWARE ARCHITECT & STUDIO
          </h1>
          <WireframeEmblem />
          {!walking && (
            <p className="text-[9.5px] sm:text-[10.5px] font-mono leading-[1.65] text-white/60 tracking-wider">
              SynapX is an engineering studio founded by Thufail Ahamed based in Colombo.
              We design and build end-to-end software: multi-tenant SaaS, agentic AI copilots,
              cloud platforms, and spatial interactive 3D experiences. From schema to screen.
            </p>
          )}
        </div>

        {/* Top Center: Stylized Brand Logo */}
        <div className="flow-cad-in absolute left-1/2 -translate-x-1/2 top-1 text-center pointer-events-auto">
          <Link
            href="/"
            className="group inline-flex items-baseline gap-1.5 sm:gap-2 transition-opacity hover:opacity-80"
          >
            <span className="text-base sm:text-lg md:text-xl font-bold tracking-tight text-white font-sans uppercase">
              Thufail
            </span>
            <span className="text-base sm:text-lg md:text-xl italic font-serif text-white/90 font-normal">
              ahamed
            </span>
            <span className="hidden sm:inline-block text-[9.5px] font-mono text-accent tracking-widest uppercase border border-accent/40 rounded px-1.5 py-0.5 ml-1">
              SynapX
            </span>
          </Link>
        </div>

        {/* Top Right: Clean Spaced MENU Trigger Button & Availability */}
        <div className="flow-cad-in flex items-center gap-3 sm:gap-4 pointer-events-auto">
          {person.available && (
            <span className="hidden md:flex flex-col items-end gap-1">
              <span className="inline-flex items-center gap-1.5 text-[10px] font-mono uppercase tracking-widest text-white/60">
                <span className="w-1.5 h-1.5 rounded-full bg-accent animate-pulse" />
                Available
              </span>
              <NowBuilding />
            </span>
          )}
          <button
            type="button"
            onClick={() => useApp.getState().set({ menuOpen: true })}
            className="text-[11px] sm:text-xs font-mono uppercase tracking-[0.3em] text-white/80 hover:text-white px-2 py-1 transition-colors"
            aria-label="Open Site Menu"
          >
            MENU
          </button>
        </div>
      </header>

      {/* Right edge: X-ray / realistic render and the weather */}
      {!walking && <RenderModePanel />}

      {/* Thermal binoculars: the readout in the eyepieces */}
      <ThermalHUD />

      {/* Guestbook: loads the signatures for the hall's tablet; the form to sign it */}
      <GuestbookPanel />

      {/* Drawing set: plans, elevation and sections with a live marker */}
      {plans && <BlueprintOverlay walking={walking} onClose={closePlans} onGo={goToShowcase} />}

      {/* Center Left Prompt: SKIP THE INTRO */}
      {flowView === "exterior" && !thermal && (
        <div className="flow-cad-in pointer-events-auto absolute left-6 sm:left-10 top-1/2 -translate-y-1/2 hidden md:block">
          <button
            type="button"
            onClick={() => switchView("hall", null)}
            className="text-[10px] font-mono uppercase tracking-[0.25em] text-white/35 hover:text-white transition-colors"
          >
            SKIP THE INTRO →
          </button>
        </div>
      )}

      {/* BOTTOM SECTION: ENTER Button, Navigation Tabs, Status prompt, and Controls */}
      <footer
        className={`relative z-10 flex flex-col md:flex-row md:items-end md:justify-between gap-6 transition-opacity duration-500 ${
          thermal ? "pointer-events-none opacity-0" : "pointer-events-auto"
        }`}
      >
        {/* Bottom Left: Solid White Circular Button + Tabs + Socials */}
        <div className="flow-cad-in flex flex-col items-start gap-4">
          <div className="flex items-center gap-3 sm:gap-4">
            {/* Prominent Solid White Circular Button (ENTER outside, EXIT when inside) */}
            <button
              type="button"
              onClick={() =>
                walking
                  ? exitWalk()
                  : switchView(flowView === "exterior" || flowView === "drone" ? "hall" : "exterior", null)
              }
              className="group relative flex h-20 w-20 sm:h-24 sm:w-24 items-center justify-center rounded-full bg-white text-black font-mono text-[11px] sm:text-xs uppercase tracking-[0.22em] font-semibold shadow-[0_0_35px_rgba(255,255,255,0.4)] hover:scale-105 active:scale-95 transition-all duration-300"
            >
              <span className="transition-transform group-hover:scale-110">
                {flowView === "exterior" || flowView === "drone" ? "ENTER" : "EXIT"}
              </span>
            </button>

            {/* Outlined drone launch / land toggle */}
            <button
              type="button"
              onClick={() => switchView(flowView === "drone" ? "exterior" : "drone", null)}
              aria-pressed={flowView === "drone"}
              className={`group relative flex h-14 w-14 sm:h-16 sm:w-16 flex-col items-center justify-center rounded-full border font-mono text-[9px] sm:text-[10px] uppercase tracking-[0.2em] transition-all duration-300 hover:scale-105 active:scale-95 ${
                flowView === "drone"
                  ? "border-accent text-accent shadow-[0_0_24px_rgba(200,255,61,0.25)]"
                  : "border-white/50 text-white/85 hover:border-white hover:text-white"
              }`}
            >
              <svg width="18" height="12" viewBox="0 0 18 12" fill="none" stroke="currentColor" strokeWidth="1" aria-hidden>
                <path d="M4 6h10M6 6l-2 4M12 6l2 4" />
                <ellipse cx="3" cy="2" rx="2.6" ry="0.8" />
                <ellipse cx="15" cy="2" rx="2.6" ry="0.8" />
                <path d="M3 2v4M15 2v4" />
                <rect x="7" y="4.5" width="4" height="3" />
              </svg>
              <span className="mt-0.5">{flowView === "drone" ? "LAND" : "FLY"}</span>
            </button>

            {/* Outlined first-person walk toggle */}
            <button
              type="button"
              onClick={() => (walking ? exitWalk() : switchView("walk", null))}
              aria-pressed={walking}
              className={`group relative flex h-14 w-14 sm:h-16 sm:w-16 flex-col items-center justify-center rounded-full border font-mono text-[9px] sm:text-[10px] uppercase tracking-[0.2em] transition-all duration-300 hover:scale-105 active:scale-95 ${
                walking
                  ? "border-accent text-accent shadow-[0_0_24px_rgba(200,255,61,0.25)]"
                  : "border-white/50 text-white/85 hover:border-white hover:text-white"
              }`}
            >
              <svg width="12" height="14" viewBox="0 0 12 14" fill="none" stroke="currentColor" strokeWidth="1" aria-hidden>
                <circle cx="6.5" cy="2" r="1.4" />
                <path d="M6 4.5l-1.5 4 2 1.5-.5 3.5M4.5 8.5L2.5 13M6 4.5l2.5 2.5 2 .5M6 4.5L3.5 6 2.5 8" />
              </svg>
              <span className="mt-0.5">{walking ? "STOP" : "WALK"}</span>
            </button>
          </div>

          {/* Navigation Tabs: LOBBY, AERIAL, GALLERY, SHOWCASE, ARCHIVE */}
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 sm:gap-x-4 text-[11px] sm:text-xs font-mono uppercase tracking-[0.2em]">
            <button
              type="button"
              onClick={() => switchView("exterior", null)}
              className={`pb-0.5 transition-colors ${
                flowView === "exterior"
                  ? "text-white border-b border-white font-medium"
                  : "text-white/50 hover:text-white"
              }`}
            >
              LOBBY
            </button>
            <button
              type="button"
              onClick={() => switchView("drone", null)}
              className={`pb-0.5 transition-colors ${
                flowView === "drone"
                  ? "text-white border-b border-white font-medium"
                  : "text-white/50 hover:text-white"
              }`}
            >
              AERIAL
            </button>
            <button
              type="button"
              onClick={() => switchView("walk", null)}
              className={`pb-0.5 transition-colors ${
                walking ? "text-white border-b border-white font-medium" : "text-white/50 hover:text-white"
              }`}
            >
              WALK
            </button>
            <button
              type="button"
              onClick={() => switchView("hall", null)}
              className={`pb-0.5 transition-colors ${
                flowView === "hall"
                  ? "text-white border-b border-white font-medium"
                  : "text-white/50 hover:text-white"
              }`}
            >
              GALLERY
            </button>
            <button
              type="button"
              onClick={() => switchView("showcase", 0)}
              className={`pb-0.5 transition-colors ${
                flowView === "showcase"
                  ? "text-white border-b border-white font-medium"
                  : "text-white/50 hover:text-white"
              }`}
            >
              SHOWCASE
            </button>
            <Link
              href="/projects"
              className="text-white/50 hover:text-white pb-0.5 transition-colors"
            >
              ARCHIVE
            </Link>
          </div>

          {/* Location and Social Links */}
          <div className="flex items-center gap-3 text-[10px] font-mono uppercase tracking-widest text-white/50">
            <span title="Sri Lanka" className="text-xs">🇱🇰</span>
            <span>COLOMBO</span>
            <span className="text-white/20">/</span>
            {person.socials.map((s) => (
              <a
                key={s.label}
                href={s.href}
                target="_blank"
                rel="noreferrer"
                className="hover:text-white transition-colors"
              >
                {s.label.toUpperCase()}
              </a>
            ))}
            <a
              href={`mailto:${person.email}`}
              className="hover:text-white transition-colors"
            >
              MAIL
            </a>
          </div>
        </div>

        {/* Bottom Center Prompt: Pavilion Entry / Step Outside */}
        {flowView !== "showcase" && !walking && (
          <div className="flow-cad-in self-center md:self-end text-center pointer-events-auto pb-1">
            <button
              type="button"
              onClick={() =>
                flowView === "hall" ? switchView("exterior", null) : switchView("hall", null)
              }
              className="text-[10px] sm:text-[11px] font-mono uppercase tracking-[0.22em] text-white/55 hover:text-white transition-colors"
            >
              {flowView === "exterior"
                ? "THE PAVILION · CLICK TO ENTER EXHIBITION HALL"
                : flowView === "drone"
                  ? "AERIAL SURVEY · DRAG TO ORBIT · SCROLL TO ZOOM"
                  : "THE PAVILION · CLICK TO STEP BACK OUTSIDE"}
            </button>
            {flowView === "exterior" && (
              <div className="mt-1.5 flex justify-center gap-5">
                <button
                  type="button"
                  onClick={() => switchView("walk", null)}
                  className="text-[9.5px] font-mono uppercase tracking-[0.22em] text-white/35 hover:text-accent transition-colors"
                >
                  [F] WALK IN FIRST PERSON
                </button>
                <button
                  type="button"
                  onClick={() => switchView("drone", null)}
                  className="text-[9.5px] font-mono uppercase tracking-[0.22em] text-white/35 hover:text-accent transition-colors"
                >
                  [D] AERIAL VIEW ↑
                </button>
              </div>
            )}
            {flowView === "hall" && (
              <div className="mt-1.5 flex justify-center gap-5">
                <button
                  type="button"
                  onClick={() => switchView("walk", null)}
                  className="text-[9.5px] font-mono uppercase tracking-[0.22em] text-white/35 hover:text-accent transition-colors"
                >
                  [F] WALK THE GALLERY IN FIRST PERSON
                </button>
                <button
                  type="button"
                  onClick={() => set({ guestbookOpen: true })}
                  className="text-[9.5px] font-mono uppercase tracking-[0.22em] text-white/35 hover:text-accent transition-colors"
                >
                  [G] SIGN THE GUESTBOOK
                </button>
              </div>
            )}
            {flowView === "drone" && (
              <button
                type="button"
                onClick={() => switchView("exterior", null)}
                className="mt-1.5 block w-full text-[9.5px] font-mono uppercase tracking-[0.22em] text-white/35 hover:text-accent transition-colors"
              >
                [ESC] LAND ON THE PLAZA ↓
              </button>
            )}
          </div>
        )}

        {/* Bottom Showcase Inspection Card (Active Project Details in Showcase View) */}
        {activeProject && (flowView === "showcase" || walking) && (
          <div className="flow-cad-in max-w-lg rounded-xl border border-white/20 bg-black/90 p-5 backdrop-blur-xl shadow-2xl">
            <div className="flex items-center justify-between gap-4">
              <span className="text-[11px] font-mono uppercase tracking-[0.2em] text-white">
                Showcase {pad((flowFocus ?? 0) + 1)} · {activeProject.category}
              </span>
              <div className="flex gap-1.5 font-mono">
                <button
                  type="button"
                  onClick={() => {
                    const prev = (flowFocus! - 1 + projects.length) % projects.length;
                    if (walking) set({ flowFocus: prev });
                    else switchView("showcase", prev);
                  }}
                  className="rounded border border-white/20 px-2 py-0.5 text-xs text-white/80 hover:border-white hover:text-white"
                  aria-label="Previous showcase"
                >
                  ←
                </button>
                <button
                  type="button"
                  onClick={() => {
                    const next = (flowFocus! + 1) % projects.length;
                    if (walking) set({ flowFocus: next });
                    else switchView("showcase", next);
                  }}
                  className="rounded border border-white/20 px-2 py-0.5 text-xs text-white/80 hover:border-white hover:text-white"
                  aria-label="Next showcase"
                >
                  →
                </button>
                <button
                  type="button"
                  onClick={() => (walking ? closeInspect() : switchView("hall", null))}
                  className="rounded border border-white/20 px-2 py-0.5 text-xs text-white/80 hover:border-white hover:text-white"
                  aria-label={walking ? "Close and keep walking" : "Return to hall"}
                >
                  ✕
                </button>
              </div>
            </div>

            <h2 className="mt-2 text-xl md:text-2xl text-white font-normal tracking-tight font-sans">
              {activeProject.title}
            </h2>
            <p className="mt-1.5 text-xs text-white/70 line-clamp-2 font-mono">
              {activeProject.tagline}
            </p>

            <div className="mt-3 flex flex-wrap gap-1.5">
              {activeProject.stack.slice(0, 4).map((tech) => (
                <span
                  key={tech}
                  className="rounded border border-white/10 bg-white/5 px-2 py-0.5 text-[9px] font-mono text-white/70"
                >
                  {tech}
                </span>
              ))}
            </div>

            <div className="mt-4 flex items-center gap-4 font-mono text-xs">
              <Link
                href={`/projects/${activeProject.slug}`}
                className="text-white underline underline-offset-4 hover:brightness-125"
              >
                Case Study ↗
              </Link>
              {activeProject.link && (
                <a
                  href={activeProject.link}
                  target="_blank"
                  rel="noreferrer"
                  className="text-white/55 hover:text-white underline underline-offset-4"
                >
                  Live Site ↗
                </a>
              )}
            </div>
          </div>
        )}

        {/* Bottom Right: CONTROLS, SOUND, & Keyboard Navigation */}
        <div className="flow-cad-in relative flex flex-col items-end gap-1 text-[10px] font-mono uppercase tracking-[0.2em] text-white/45">
          {showKeys && (
            <div className="absolute bottom-full right-0 mb-3 w-64 rounded-lg border border-white/15 bg-black/85 p-3 backdrop-blur-xl">
              {KEYMAP.map(([k, label]) => (
                <div key={k} className="flex items-center justify-between gap-3 py-0.5 text-[9.5px] tracking-[0.14em]">
                  <span className="rounded border border-white/25 px-1.5 text-white/85">{k}</span>
                  <span className="text-white/50 normal-case tracking-wider">{label}</span>
                </div>
              ))}
            </div>
          )}
          <button
            type="button"
            onClick={openPlans}
            aria-haspopup="dialog"
            className="flex items-center gap-1.5 hover:text-white transition-colors"
          >
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1" aria-hidden>
              <rect x="0.5" y="0.5" width="9" height="9" />
              <path d="M0.5 4h4v5.5M4.5 4V0.5M6.5 9.5V6.5h3" />
            </svg>
            <span>PLANS</span>
            <span className="text-white/30">[M]</span>
          </button>
          <button
            type="button"
            onClick={() => setShowKeys((v) => !v)}
            aria-expanded={showKeys}
            className="flex items-center gap-1.5 hover:text-white transition-colors"
          >
            <span className={`inline-block w-1 h-1 rounded-full ${showKeys ? "bg-accent" : "bg-white/70"}`} />
            <span>CONTROLS</span>
          </button>
          <button
            type="button"
            onClick={() => set({ sound: !sound })}
            className="flex items-center gap-1.5 hover:text-white transition-colors"
          >
            <span
              className={`inline-block w-2 h-2 rounded-full border border-white/50 ${
                sound ? "bg-white" : ""
              }`}
            />
            <span>SOUND</span>
          </button>
          <div className="text-[9px] text-white/35 tracking-widest mt-0.5">
            &lt; SPACE / PAGE &gt;
          </div>
        </div>
      </footer>
    </div>
  );
}
