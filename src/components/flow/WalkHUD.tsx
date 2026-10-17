"use client";

import { useEffect, useRef, useState } from "react";
import { projects } from "@/content/site";
import { HALL, ROTUNDA, SHOWCASE_CENTERS, WALK_SETTINGS_KEY } from "@/experience/flowWalk";
import { sceneState } from "@/lib/sceneState";

const pad = (n: number) => String(n).padStart(2, "0");

const KEYS: [string, string][] = [
  ["W A S D", "Move"],
  ["MOUSE", "Look"],
  ["SHIFT", "Run"],
  ["SPACE", "Jump"],
  ["C", "Crouch"],
  ["E", "Inspect showcase"],
  ["M", "Plans"],
  ["ESC", "Pause"],
];

/** Plan of the site drawn north-up; player arrow and view cone on top. */
function Minimap() {
  const canvas = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const el = canvas.current;
    const ctx = el?.getContext("2d");
    if (!el || !ctx) return;
    const S = 168;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    el.width = S * dpr;
    el.height = S * dpr;
    let id = 0;

    const draw = () => {
      const fp = sceneState.flow.fp;
      // follow the player, zooming in once inside the hall
      const scale = fp.indoors ? 4.2 : 2.6;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, S, S);
      ctx.save();
      ctx.beginPath();
      ctx.arc(S / 2, S / 2, S / 2 - 1, 0, Math.PI * 2);
      ctx.clip();
      ctx.fillStyle = "rgba(2,4,8,0.82)";
      ctx.fillRect(0, 0, S, S);

      const px = (x: number) => S / 2 + (x - fp.x) * scale;
      const pz = (z: number) => S / 2 + (z - fp.z) * scale;

      // 4m grid
      ctx.strokeStyle = "rgba(140,160,190,0.12)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      const g0x = Math.floor((fp.x - 40) / 4) * 4;
      const g0z = Math.floor((fp.z - 40) / 4) * 4;
      for (let i = 0; i <= 20; i++) {
        ctx.moveTo(px(g0x + i * 4), 0);
        ctx.lineTo(px(g0x + i * 4), S);
        ctx.moveTo(0, pz(g0z + i * 4));
        ctx.lineTo(S, pz(g0z + i * 4));
      }
      ctx.stroke();

      const rect = (x0: number, z0: number, x1: number, z1: number) =>
        ctx.strokeRect(px(x0), pz(z0), (x1 - x0) * scale, (z1 - z0) * scale);

      // stylobate, steps, pools
      ctx.strokeStyle = "rgba(200,212,232,0.35)";
      rect(-27, -23.5, 27, 8.3);
      rect(-11.5, 3.9, 11.5, 8.3);
      ctx.strokeStyle = "rgba(200,212,232,0.28)";
      rect(4.2, 10.6, 11, 21.4);
      rect(-11, 10.6, -4.2, 21.4);

      // hall walls with the portal gap
      ctx.strokeStyle = "rgba(245,247,250,0.85)";
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(px(-1.1), pz(HALL.z0));
      ctx.lineTo(px(-HALL.x), pz(HALL.z0));
      ctx.lineTo(px(-HALL.x), pz(HALL.z1));
      ctx.lineTo(px(HALL.x), pz(HALL.z1));
      ctx.lineTo(px(HALL.x), pz(HALL.z0));
      ctx.lineTo(px(1.1), pz(HALL.z0));
      // facade
      ctx.moveTo(px(-26), pz(-0.9));
      ctx.lineTo(px(-HALL.x), pz(-0.9));
      ctx.moveTo(px(HALL.x), pz(-0.9));
      ctx.lineTo(px(26), pz(-0.9));
      ctx.stroke();

      // rotunda
      ctx.beginPath();
      ctx.arc(px(ROTUNDA.x), pz(ROTUNDA.z), ROTUNDA.r * scale, 0, Math.PI * 2);
      ctx.stroke();

      // showcases
      ctx.font = "600 8px monospace";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      SHOWCASE_CENTERS.forEach((c, i) => {
        const on = fp.target === i;
        ctx.fillStyle = on ? "#c8ff3d" : "rgba(255,255,255,0.9)";
        ctx.beginPath();
        ctx.arc(px(c.x), pz(c.z), on ? 3.5 : 2.5, 0, Math.PI * 2);
        ctx.fill();
        if (scale > 3) {
          ctx.fillStyle = "rgba(255,255,255,0.6)";
          ctx.fillText(pad(i + 1), px(c.x) + (c.x < 0 ? -9 : 9), pz(c.z));
        }
      });

      // view cone + player
      const yaw = fp.yaw;
      const dir = -Math.PI / 2 - yaw;
      const cone = ctx.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, 42);
      cone.addColorStop(0, "rgba(200,255,61,0.35)");
      cone.addColorStop(1, "rgba(200,255,61,0)");
      ctx.fillStyle = cone;
      ctx.beginPath();
      ctx.moveTo(S / 2, S / 2);
      ctx.arc(S / 2, S / 2, 42, dir - 0.55, dir + 0.55);
      ctx.closePath();
      ctx.fill();
      ctx.save();
      ctx.translate(S / 2, S / 2);
      ctx.rotate(dir + Math.PI / 2);
      ctx.fillStyle = "#ffffff";
      ctx.beginPath();
      ctx.moveTo(0, -6);
      ctx.lineTo(4.5, 5);
      ctx.lineTo(0, 2.5);
      ctx.lineTo(-4.5, 5);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
      ctx.restore();

      // bezel + north tick
      ctx.strokeStyle = "rgba(255,255,255,0.35)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(S / 2, S / 2, S / 2 - 1, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = "rgba(255,255,255,0.85)";
      ctx.font = "600 9px monospace";
      ctx.fillText("N", S / 2, 9);

      id = requestAnimationFrame(draw);
    };
    draw();
    return () => cancelAnimationFrame(id);
  }, []);

  return <canvas ref={canvas} style={{ width: 168, height: 168 }} className="rounded-full" />;
}

type WalkSettings = typeof sceneState.flow.fp.settings;

/** Sensitivity, invert-Y, head bob and look smoothing; applied live and remembered per viewer. */
function SettingsPanel() {
  const [s, setS] = useState<WalkSettings>(() => ({ ...sceneState.flow.fp.settings }));
  const update = (patch: Partial<WalkSettings>) => {
    const next = { ...s, ...patch };
    setS(next);
    Object.assign(sceneState.flow.fp.settings, next);
    try {
      localStorage.setItem(WALK_SETTINGS_KEY, JSON.stringify(next));
    } catch {
      // storage unavailable: still applies for this visit
    }
  };
  const toggle = (key: "invertY" | "bob" | "smooth", label: string) => (
    <button
      type="button"
      role="switch"
      aria-checked={s[key]}
      onClick={() => update({ [key]: !s[key] })}
      className="flex items-center justify-between gap-3 py-1 text-[10px] tracking-[0.16em] text-white/70 hover:text-white"
    >
      <span>{label}</span>
      <span
        className={`relative inline-block h-3.5 w-7 rounded-full border transition-colors ${
          s[key] ? "border-accent bg-accent/25" : "border-white/30"
        }`}
      >
        <span
          className={`absolute top-1/2 h-2 w-2 -translate-y-1/2 rounded-full transition-all ${
            s[key] ? "left-[15px] bg-accent" : "left-[2px] bg-white/60"
          }`}
        />
      </span>
    </button>
  );

  return (
    <div className="mx-auto mt-6 max-w-[300px] border-t border-white/10 pt-4 text-left">
      <label className="flex items-center justify-between gap-3 text-[10px] tracking-[0.16em] text-white/70">
        <span>LOOK SENSITIVITY</span>
        <span className="tabular-nums text-white">{s.sens.toFixed(2)}×</span>
      </label>
      <input
        type="range"
        min={0.3}
        max={2.5}
        step={0.05}
        value={s.sens}
        onChange={(e) => update({ sens: parseFloat(e.target.value) })}
        aria-label="Look sensitivity"
        className="mt-1.5 w-full accent-[#c8ff3d]"
      />
      <div className="mt-2 flex flex-col">
        {toggle("smooth", "SMOOTH LOOK")}
        {toggle("bob", "HEAD BOB & LEAN")}
        {toggle("invertY", "INVERT Y")}
      </div>
    </div>
  );
}

/** On-screen thumbstick for touch devices; writes into sceneState.flow.fp.joy. */
function Joystick() {
  const base = useRef<HTMLDivElement>(null);
  const knob = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = base.current;
    if (!el) return;
    let active: number | null = null;
    const R = 46;
    const set = (e: PointerEvent) => {
      const b = el.getBoundingClientRect();
      let dx = e.clientX - (b.left + b.width / 2);
      let dy = e.clientY - (b.top + b.height / 2);
      const l = Math.hypot(dx, dy);
      if (l > R) {
        dx = (dx / l) * R;
        dy = (dy / l) * R;
      }
      sceneState.flow.fp.joy.x = dx / R;
      sceneState.flow.fp.joy.y = -dy / R;
      if (knob.current) knob.current.style.transform = `translate(${dx}px, ${dy}px)`;
    };
    const down = (e: PointerEvent) => {
      active = e.pointerId;
      el.setPointerCapture(e.pointerId);
      set(e);
      e.stopPropagation();
    };
    const move = (e: PointerEvent) => {
      if (e.pointerId === active) set(e);
    };
    const up = (e: PointerEvent) => {
      if (e.pointerId !== active) return;
      active = null;
      sceneState.flow.fp.joy.x = 0;
      sceneState.flow.fp.joy.y = 0;
      if (knob.current) knob.current.style.transform = "";
    };
    el.addEventListener("pointerdown", down);
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", up);
    el.addEventListener("pointercancel", up);
    return () => {
      el.removeEventListener("pointerdown", down);
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerup", up);
      el.removeEventListener("pointercancel", up);
      sceneState.flow.fp.joy.x = 0;
      sceneState.flow.fp.joy.y = 0;
    };
  }, []);

  return (
    <div
      ref={base}
      className="pointer-events-auto absolute bottom-28 left-8 z-20 flex h-32 w-32 touch-none items-center justify-center rounded-full border border-white/30 bg-black/30 backdrop-blur-sm"
    >
      <div ref={knob} className="h-14 w-14 rounded-full border border-white/70 bg-white/15 transition-transform duration-75" />
    </div>
  );
}

/**
 * First-person overlay: crosshair that reacts to showcases, the inspect prompt, zone and
 * coordinates, minimap, controls, the click-to-play / pause screen and touch controls.
 */
export default function WalkHUD({
  locked,
  touch,
  inspecting,
  onResume,
  onExit,
  onJump,
}: {
  locked: boolean;
  touch: boolean;
  inspecting: boolean;
  onResume: () => void;
  onExit: () => void;
  onJump: () => void;
}) {
  const reticle = useRef<HTMLDivElement>(null);
  const prompt = useRef<HTMLDivElement>(null);
  const promptTitle = useRef<HTMLSpanElement>(null);
  const zone = useRef<HTMLSpanElement>(null);
  const coords = useRef<HTMLSpanElement>(null);
  const pace = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    let id = 0;
    let last = -2;
    const tick = () => {
      const fp = sceneState.flow.fp;
      if (fp.target !== last) {
        last = fp.target;
        const on = fp.target >= 0;
        reticle.current?.classList.toggle("is-target", on);
        if (prompt.current) prompt.current.style.opacity = on ? "1" : "0";
        if (on && promptTitle.current) {
          promptTitle.current.textContent = `${pad(fp.target + 1)} · ${projects[fp.target]?.title ?? ""}`;
        }
      }
      if (zone.current && zone.current.textContent !== fp.zone) zone.current.textContent = fp.zone;
      if (coords.current) {
        const hdg = ((((-fp.yaw * 180) / Math.PI) % 360) + 360) % 360;
        coords.current.textContent = `X ${fp.x.toFixed(1)}  Z ${fp.z.toFixed(1)}  ·  HDG ${String(Math.round(hdg) % 360).padStart(3, "0")}°`;
      }
      if (pace.current) {
        pace.current.textContent =
          fp.crouch > 0.5 ? "CROUCHING" : fp.speed < 0.3 ? "STANDING" : fp.sprinting ? "RUNNING" : "WALKING";
      }
      id = requestAnimationFrame(tick);
    };
    tick();
    return () => cancelAnimationFrame(id);
  }, []);

  const paused = !locked && !touch && !inspecting;

  return (
    <div aria-hidden={!paused} className="pointer-events-none absolute inset-0 z-[6] font-mono uppercase">
      {/* Crosshair */}
      {!paused && !inspecting && (
        <div ref={reticle} className="walk-reticle absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2">
          <span />
        </div>
      )}

      {/* Inspect prompt */}
      <div
        ref={prompt}
        className="absolute left-1/2 top-[calc(50%+34px)] -translate-x-1/2 text-center opacity-0 transition-opacity duration-200"
      >
        <div className="text-[11px] tracking-[0.22em] text-white">
          <span ref={promptTitle} />
        </div>
        <div className="mt-1.5 inline-flex items-center gap-2 text-[9.5px] tracking-[0.25em] text-white/60">
          {touch ? (
            <span className="text-accent">TAP INSPECT</span>
          ) : (
            <>
              <span className="rounded border border-accent/70 px-1.5 py-px text-accent">E</span> INSPECT
            </>
          )}
        </div>
      </div>

      {/* Zone + telemetry */}
      <div className="absolute left-1/2 top-[13%] -translate-x-1/2 text-center">
        <div className="text-[9px] tracking-[0.35em] text-white/40">LOCATION</div>
        <div className="mt-1 text-[12px] tracking-[0.3em] text-white">
          <span ref={zone} />
        </div>
      </div>

      <div className="absolute right-6 top-24 flex flex-col items-end gap-2 md:right-10">
        <Minimap />
        <span ref={coords} className="text-[9px] tracking-[0.18em] text-white/45 tabular-nums" />
        <span ref={pace} className="text-[9px] tracking-[0.25em] text-accent/80" />
      </div>

      {/* Key hints */}
      {!touch && !paused && (
        <div className="absolute bottom-[26%] right-6 hidden flex-col items-end gap-1 text-[9px] tracking-[0.2em] text-white/35 md:right-10 lg:flex">
          {KEYS.map(([k, label]) => (
            <div key={k} className="flex items-center gap-2">
              <span className="text-white/30">{label}</span>
              <span className="rounded border border-white/20 px-1.5 text-white/60">{k}</span>
            </div>
          ))}
        </div>
      )}

      {/* Touch controls */}
      {touch && !inspecting && (
        <>
          <Joystick />
          <button
            type="button"
            onPointerDown={(e) => {
              e.stopPropagation();
              onJump();
            }}
            className="pointer-events-auto absolute bottom-32 right-8 z-20 h-16 w-16 rounded-full border border-white/40 bg-black/30 text-[9px] tracking-[0.2em] text-white/80 backdrop-blur-sm"
          >
            JUMP
          </button>
        </>
      )}

      {/* Click-to-play / pause */}
      {paused && (
        <div className="pointer-events-auto absolute inset-0 z-30 flex items-center justify-center bg-black/55 backdrop-blur-[2px]">
          <div className="max-h-[92vh] w-[min(420px,88vw)] overflow-y-auto rounded-2xl border border-white/15 bg-black/80 p-7 text-center shadow-2xl">
            <div className="text-[10px] tracking-[0.35em] text-white/45">FIRST PERSON · THE PAVILION</div>
            <h2 className="mt-3 font-sans text-2xl normal-case tracking-tight text-white">Walk the exhibition</h2>
            <div className="mx-auto mt-5 grid max-w-[300px] grid-cols-2 gap-x-4 gap-y-1.5 text-left text-[10px] tracking-[0.16em]">
              {KEYS.map(([k, label]) => (
                <div key={k} className="contents">
                  <span className="text-white/85">{k}</span>
                  <span className="text-white/45 normal-case tracking-wider">{label}</span>
                </div>
              ))}
            </div>
            <SettingsPanel />
            <div className="mt-6 flex items-center justify-center gap-3">
              <button
                type="button"
                onClick={onResume}
                className="rounded-full bg-white px-6 py-2.5 text-[11px] font-semibold tracking-[0.22em] text-black transition-transform hover:scale-105"
              >
                CLICK TO WALK
              </button>
              <button
                type="button"
                onClick={onExit}
                className="rounded-full border border-white/30 px-5 py-2.5 text-[11px] tracking-[0.22em] text-white/75 transition-colors hover:border-white hover:text-white"
              >
                EXIT
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
