"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { about, beats, contact, person, projects } from "@/content/site";
import { useApp } from "@/store/useApp";
import { CAM, CAMS, nextCam, type CamMode } from "./camera";
import type { Pick } from "./layout";
import { PAINTS } from "./paint";
import { playShutter, unlockSound } from "./sound";
import { legoEvents, useLego } from "./store";
import { C, TINT } from "./units";

const LegoScene = dynamic(() => import("./LegoScene"), { ssr: false });

const pad = (n: number) => String(n).padStart(2, "0");
const host = (url: string) => url.replace(/^https?:\/\//, "").replace(/\/$/, "");
const INK = "#16181d";
/** the printed stock every control and readout sits on: warm white card, a hairline edge, a real shadow */
const SKIN = "rounded-[10px] bg-[#fbfaf6] text-[#16181d] shadow-[0_0_0_1px_rgba(22,24,29,.1),0_1px_2px_rgba(22,24,29,.08),0_12px_28px_-14px_rgba(22,24,29,.42)]";

/** A hex colour mixed toward white (t > 0) or black (t < 0), for the faces of a drawn brick. */
const shade = (hex: string, t: number) => {
  const n = parseInt(hex.slice(1), 16);
  const to = t > 0 ? 255 : 0;
  const k = Math.abs(t);
  return `rgb(${[16, 8, 0].map((s) => Math.round(((n >> s) & 255) * (1 - k) + to * k)).join(",")})`;
};

/** Stops: 0 home, 1 the projects heading, 2–7 one per project, then about and contact. */
const PROJECT0 = 2;
const ABOUT = PROJECT0 + projects.length;
const CONTACT = ABOUT + 1;
const GROUPS = [
  { label: "Home", stop: 0, has: (s: number) => s === 0 },
  { label: "Projects", stop: 1, has: (s: number) => s >= 1 && s < ABOUT },
  { label: "About", stop: ABOUT, has: (s: number) => s === ABOUT },
  { label: "Contact", stop: CONTACT, has: (s: number) => s === CONTACT },
];
const CURSOR: Record<string, string> = { project: "view", email: "copy", link: "open" };
/** the marker's sight: a ring and a broken cross, white with a dark edge so it reads on anything */
const RETICLE = `url("data:image/svg+xml,${encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="36" height="36" viewBox="0 0 36 36"><g fill="none" stroke-linecap="round"><g stroke="#15171c" stroke-width="4" opacity=".55"><circle cx="18" cy="18" r="9"/><path d="M18 2v7M18 27v7M2 18h7M27 18h7"/></g><g stroke="#fff" stroke-width="1.8"><circle cx="18" cy="18" r="9"/><path d="M18 2v7M18 27v7M2 18h7M27 18h7"/></g></g><circle cx="18" cy="18" r="1.6" fill="#ff2a85" stroke="#fff" stroke-width=".8"/></svg>',
)}") 18 18, crosshair`;

/** Holster one tool when the other comes out. */
const toggleVacuum = () => {
  const s = useLego.getState();
  s.set({ vacuum: !s.vacuum, paint: false });
};
const togglePaint = () => {
  const s = useLego.getState();
  s.set({ paint: !s.paint, vacuum: false });
};
/** Gravity off (or back on). Sound wakes here too: this is a press, and the hum wants to play. */
const toggleZeroG = () => {
  unlockSound();
  const s = useLego.getState();
  s.set({ zeroG: !s.zeroG });
};
const SPACE = "#0e1630";
const SPACE_INK = "#9fe6ff";
const GOLD = "#f6a65a";

/** Day → golden hour → night → day. */
const cycleTime = () => {
  const s = useLego.getState();
  if (s.night) s.set({ night: false, golden: false });
  else if (s.golden) s.set({ night: true, golden: false });
  else s.set({ golden: true });
};
type Light = "day" | "golden" | "night";
const LIGHT_NAME: Record<Light, string> = { day: "Daylight", golden: "Golden hour", night: "Night" };

/** The light as it is now: a sun, a sun on the horizon, or the moon. */
function LightIcon({ light }: { light: Light }) {
  return (
    <svg aria-hidden width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
      {light === "day" ? (
        <>
          <circle cx="12" cy="12" r="4.5" />
          <path d="M12 2v2.5M12 19.5V22M2 12h2.5M19.5 12H22M4.9 4.9l1.8 1.8M17.3 17.3l1.8 1.8M4.9 19.1l1.8-1.8M17.3 6.7l1.8-1.8" />
        </>
      ) : light === "golden" ? (
        <path d="M2.5 18h19M6.5 18a5.5 5.5 0 0 1 11 0M12 7.5V4.5M5.4 11.2 3.6 9.4M18.6 11.2l1.8-1.8M8 21.5h8" />
      ) : (
        <path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5Z" />
      )}
    </svg>
  );
}

/** Switch camera; the free orbit always starts from the stop's own framing. */
const setCam = (cam: CamMode) => useLego.getState().set({ cam, zoom: 1 });
/** Photo mode: the tools go down so they aren't in the shot. */
const togglePhoto = () => {
  const s = useLego.getState();
  s.set({ photo: !s.photo, paint: false, vacuum: false });
};
const toggleSlowmo = () => useLego.getState().set({ slowmo: !useLego.getState().slowmo });
const brickStorm = () => {
  unlockSound();
  const s = useLego.getState();
  s.set({ stormTick: s.stormTick + 1 });
};
const shutter = () => {
  unlockSound();
  const s = useLego.getState();
  if (s.sound) playShutter();
  s.set({ shotTick: s.shotTick + 1 });
};

/** One line-icon per camera, drawn on a 24 grid. */
function CamIcon({ id, size = 16 }: { id: CamMode | "camera"; size?: number }) {
  const paths: Record<CamMode | "camera", ReactNode> = {
    camera: (
      <>
        <path d="M4 8h3l1.6-2.2h6.8L17 8h3a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1z" />
        <circle cx="12" cy="13" r="3.6" />
      </>
    ),
    tour: (
      <>
        <path d="M5 18c3-1 4-5 7-6s5 1 7-5" />
        <circle cx="5" cy="18" r="1.8" />
        <circle cx="19" cy="7" r="1.8" />
      </>
    ),
    orbit: (
      <>
        <ellipse cx="12" cy="12" rx="9.5" ry="4.2" />
        <circle cx="12" cy="12" r="2.6" />
        <path d="m17.5 5.2 2.3 2.6-3.3.9" />
      </>
    ),
    street: (
      <>
        <path d="M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6z" />
        <circle cx="12" cy="12" r="2.8" />
      </>
    ),
    aerial: (
      <>
        <rect x="8.5" y="8.5" width="7" height="7" rx="1.5" />
        <path d="M8.5 8.5 5.5 5.5M15.5 8.5l3-3M8.5 15.5l-3 3M15.5 15.5l3 3" />
        <circle cx="5" cy="5" r="2" />
        <circle cx="19" cy="5" r="2" />
        <circle cx="5" cy="19" r="2" />
        <circle cx="19" cy="19" r="2" />
      </>
    ),
    chase: (
      <>
        <path d="M3 15.5V13l2.6-4.5h9.2L18 12.5h2.4a1.6 1.6 0 0 1 1.6 1.6v1.4" />
        <circle cx="7.2" cy="16.4" r="2" />
        <circle cx="16.8" cy="16.4" r="2" />
        <path d="M9.2 16.4h5.6M7.5 12.5h10" />
      </>
    ),
    cinema: (
      <>
        <rect x="3" y="9" width="18" height="11" rx="1.6" />
        <path d="m3.4 9-.6-3.4 16.6-2.9.6 3.4z" />
        <path d="m8 5.6 2 3M13.3 4.7l2 3" />
      </>
    ),
  };
  return (
    <svg aria-hidden width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      {paths[id]}
    </svg>
  );
}

/**
 * The camera bag: pick a camera, or reach for the photo kit (photo mode, slow motion, a brick
 * storm to shoot). Opens under its button and closes on a pick, a click outside or Escape.
 */
function CameraMenu({ cam, slowmo, sound, light }: { cam: CamMode; slowmo: boolean; sound: boolean; light: Light }) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => !box.current?.contains(e.target as Node) && setOpen(false);
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    addEventListener("pointerdown", away);
    addEventListener("keydown", esc);
    return () => {
      removeEventListener("pointerdown", away);
      removeEventListener("keydown", esc);
    };
  }, [open]);
  const item = "flex w-full items-center gap-3 rounded-[7px] px-2 py-1.5 text-left transition-colors";
  const well = (on = false) => `grid h-8 w-8 shrink-0 place-items-center rounded-[6px] ${on ? "bg-white/[0.12]" : "bg-[#16181d]/[0.06]"}`;
  return (
    <div ref={box} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label={`Camera: ${CAM[cam].label} (K to switch)`}
        className={`inline-flex h-11 items-center gap-2 px-3.5 text-[13px] font-semibold transition-colors ${SKIN} ${open ? "!bg-[#f1efe8]" : "hover:!bg-[#f1efe8]"}`}
      >
        <CamIcon id={cam === "tour" ? "camera" : cam} size={15} />
        <span className="hidden xl:inline">{cam === "tour" ? "Camera" : CAM[cam].label}</span>
        <svg aria-hidden width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" className={`opacity-50 transition-transform duration-200 max-sm:hidden ${open ? "rotate-180" : ""}`}>
          <path d="m2 3.75 3 3 3-3" />
        </svg>
      </button>
      {open && (
        <div role="menu" className="sr-rise absolute left-0 top-[calc(100%+8px)] z-30 w-[316px] max-w-[calc(100vw-32px)] rounded-[10px] bg-[#fbfaf6] p-1.5 text-[#16181d] shadow-[0_0_0_1px_rgba(22,24,29,.1),0_24px_60px_-20px_rgba(22,24,29,.5)] max-sm:fixed max-sm:inset-x-4 max-sm:top-[70px] max-sm:w-auto">
          <p className="brick-label flex items-center justify-between px-2 pb-1.5 pt-1.5 text-[#16181d]/45">
            Cameras <Kbd>K</Kbd>
          </p>
          {CAMS.map((c) => {
            const on = c.id === cam;
            return (
              <button
                key={c.id}
                type="button"
                role="menuitemradio"
                aria-checked={on}
                onClick={() => {
                  setCam(c.id);
                  setOpen(false);
                }}
                className={`${item} ${on ? "bg-[#16181d] text-[#fbfaf6]" : "hover:bg-[#16181d]/[0.05]"}`}
              >
                <span className={well(on)}>
                  <CamIcon id={c.id} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[13.5px] font-semibold leading-tight tracking-[-0.01em]">{c.label}</span>
                  <span className={`block truncate text-[12px] leading-snug ${on ? "text-white/55" : "text-[#16181d]/50"}`}>{c.blurb}</span>
                </span>
                <span className={`brick-num hidden text-[10.5px] font-medium sm:block ${on ? "text-white/45" : "text-[#16181d]/40"}`}>{c.lens.split(" · ")[0]}</span>
              </button>
            );
          })}
          <div className="mx-2 my-1.5 h-px bg-[#16181d]/[0.09]" />
          <p className="brick-label px-2 pb-1.5 pt-1 text-[#16181d]/45">Photo kit</p>
          <button type="button" role="menuitem" onClick={() => (togglePhoto(), setOpen(false))} className={`${item} hover:bg-[#16181d]/[0.05]`}>
            <span className={well()}>
              <svg aria-hidden width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <path d="M3 8V4h4M21 8V4h-4M3 16v4h4M21 16v4h-4" />
                <circle cx="12" cy="12" r="3" />
              </svg>
            </span>
            <span className="flex-1 text-[13.5px] font-semibold">Photo mode</span>
            <Kbd>F</Kbd>
          </button>
          <button type="button" role="menuitemcheckbox" aria-checked={slowmo} onClick={toggleSlowmo} className={`${item} hover:bg-[#16181d]/[0.05]`}>
            <span className={well()}>
              <svg aria-hidden width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="13" r="8" />
                <path d="M12 9v4l2.5 2.5M10 2.5h4" />
              </svg>
            </span>
            <span className="flex-1 text-[13.5px] font-semibold">Slow motion</span>
            <span className={`h-[18px] w-[30px] rounded-full p-[2px] transition-colors ${slowmo ? "bg-[#f5cd2f]" : "bg-[#16181d]/15"}`}>
              <span className={`block h-[14px] w-[14px] rounded-full transition-transform ${slowmo ? "translate-x-[12px] bg-[#16181d]" : "bg-white shadow-[0_1px_2px_rgba(0,0,0,.25)]"}`} />
            </span>
            <Kbd>T</Kbd>
          </button>
          <button type="button" role="menuitem" onClick={() => (brickStorm(), setOpen(false))} className={`${item} hover:bg-[#16181d]/[0.05]`}>
            <span className={well()}>
              <svg aria-hidden width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M6.5 15a4.5 4.5 0 1 1 1.2-8.8A5.5 5.5 0 0 1 18 8a3.5 3.5 0 0 1 .5 7z" />
                <rect x="7" y="18" width="3.5" height="2.5" rx=".5" />
                <rect x="13.5" y="17" width="3.5" height="2.5" rx=".5" />
              </svg>
            </span>
            <span className="flex-1 text-[13.5px] font-semibold">Brick storm</span>
            <Kbd>B</Kbd>
          </button>
          <button type="button" role="menuitem" onClick={cycleTime} className={`${item} hover:bg-[#16181d]/[0.05] sm:hidden`}>
            <span className={well()}>
              <LightIcon light={light} />
            </span>
            <span className="flex-1 text-[13.5px] font-semibold">{LIGHT_NAME[light]}</span>
            <span className="text-[11.5px] text-[#16181d]/40">Tap to change</span>
          </button>
          <button type="button" role="menuitemcheckbox" aria-checked={sound} onClick={() => useLego.getState().set({ sound: !sound })} className={`${item} hover:bg-[#16181d]/[0.05] sm:hidden`}>
            <span className={well()}>
              <SoundIcon on={sound} />
            </span>
            <span className="flex-1 text-[13.5px] font-semibold">{sound ? "Sound on" : "Sound off"}</span>
          </button>
        </div>
      )}
    </div>
  );
}

/**
 * Photo mode's viewfinder: corner marks, a rule-of-thirds grid, the focus box, the lens readout,
 * and a bar along the bottom with the cameras, the shutter and the way out.
 */
function Viewfinder({ cam, golden, night, slowmo, flash, last }: { cam: CamMode; golden: boolean; night: boolean; slowmo: boolean; flash: number; last: string | null }) {
  const [grid, setGrid] = useState(true);
  const spec = CAM[cam];
  const light = night ? "Night · ISO 3200 · 1/30 s" : golden ? "Golden hour · ISO 200 · 1/125 s" : "Daylight · ISO 100 · 1/250 s";
  return (
    <div className="pointer-events-none absolute inset-0 z-20 text-white">
      {grid && (
        <div aria-hidden className="absolute inset-0">
          {[1, 2].map((i) => (
            <span key={`v${i}`} className="absolute inset-y-0 w-px bg-white/30 mix-blend-difference" style={{ left: `${(i * 100) / 3}%` }} />
          ))}
          {[1, 2].map((i) => (
            <span key={`h${i}`} className="absolute inset-x-0 h-px bg-white/30 mix-blend-difference" style={{ top: `${(i * 100) / 3}%` }} />
          ))}
        </div>
      )}
      {/* corner marks */}
      <div aria-hidden className="absolute inset-4 md:inset-8">
        {["left-0 top-0 border-l-2 border-t-2", "right-0 top-0 border-r-2 border-t-2", "bottom-0 left-0 border-b-2 border-l-2", "bottom-0 right-0 border-b-2 border-r-2"].map((c) => (
          <span key={c} className={`absolute h-7 w-7 border-white/90 drop-shadow-[0_1px_2px_rgba(0,0,0,.5)] ${c}`} />
        ))}
      </div>
      {/* focus box */}
      <span aria-hidden className="absolute left-1/2 top-1/2 h-12 w-16 -translate-x-1/2 -translate-y-1/2 rounded-[3px] border border-[#ffd34d] shadow-[0_0_0_1px_rgba(0,0,0,.25)]" />
      {/* readout */}
      <div className="absolute left-6 top-6 flex items-center gap-2 font-mono text-[10.5px] uppercase tracking-[0.14em] drop-shadow-[0_1px_2px_rgba(0,0,0,.6)] md:left-12 md:top-11">
        <span className="h-2 w-2 animate-pulse rounded-full bg-[#ff3b30]" />
        <span>{spec.label}</span>
        <span className="text-white/60">· {spec.lens}</span>
      </div>
      <p className="absolute right-6 top-6 font-mono text-[10.5px] uppercase tracking-[0.14em] text-white/80 drop-shadow-[0_1px_2px_rgba(0,0,0,.6)] md:right-12 md:top-11">
        {light}
        {slowmo && " · 0.2×"}
      </p>

      {/* the bar */}
      <div className="pointer-events-auto absolute inset-x-0 bottom-5 flex flex-col items-center gap-3 px-4 md:bottom-12">
        <p className="rounded-full bg-black/45 px-3 py-1.5 text-center font-mono text-[9.5px] uppercase tracking-[0.14em] text-white/80 backdrop-blur">
          Drag to frame · click the scene to throw · Space to shoot · Esc to leave
        </p>
        <div className="flex items-center gap-3 rounded-full bg-black/55 p-2 shadow-[0_20px_50px_-20px_rgba(0,0,0,.7)] ring-1 ring-white/10 backdrop-blur-xl">
          <div role="radiogroup" aria-label="Camera" className="flex items-center gap-1">
            {CAMS.map((c) => (
              <button
                key={c.id}
                type="button"
                role="radio"
                aria-checked={c.id === cam}
                aria-label={c.label}
                title={c.label}
                onClick={() => setCam(c.id)}
                className={`grid h-9 w-9 place-items-center rounded-full transition-colors ${c.id === cam ? "bg-white text-[#15171c]" : "text-white/75 hover:bg-white/10 hover:text-white"}`}
              >
                <CamIcon id={c.id} />
              </button>
            ))}
          </div>
          <button type="button" onClick={shutter} aria-label="Take a photo (Space)" title="Take a photo (Space)" className="grid h-14 w-14 place-items-center rounded-full bg-white/15 ring-2 ring-white transition-transform active:scale-95">
            <span className="h-11 w-11 rounded-full bg-white transition-colors hover:bg-[#ffd34d]" />
          </button>
          <div className="flex items-center gap-1">
            <button type="button" onClick={() => setGrid((g) => !g)} aria-pressed={grid} aria-label="Grid" title="Grid" className={`grid h-9 w-9 place-items-center rounded-full transition-colors ${grid ? "bg-white/20 text-white" : "text-white/60 hover:bg-white/10"}`}>
              <svg aria-hidden width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <rect x="3" y="3" width="18" height="18" rx="2" />
                <path d="M9 3v18M15 3v18M3 9h18M3 15h18" />
              </svg>
            </button>
            <button type="button" onClick={cycleTime} aria-label="Change the light" title="Light: day, golden hour, night (N)" className="grid h-9 w-9 place-items-center rounded-full text-white/75 transition-colors hover:bg-white/10 hover:text-white">
              <svg aria-hidden width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <path d="M3 18h18M6.5 18a5.5 5.5 0 0 1 11 0M12 7.5V5M5.8 11.3 4.2 9.7M18.2 11.3l1.6-1.6" />
              </svg>
            </button>
            <button type="button" onClick={togglePhoto} aria-label="Leave photo mode (Esc)" title="Leave photo mode (Esc)" className="grid h-9 w-9 place-items-center rounded-full text-white/75 transition-colors hover:bg-white/10 hover:text-white">
              <svg aria-hidden width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
                <path d="M6 6l12 12M18 6 6 18" />
              </svg>
            </button>
          </div>
        </div>
      </div>

      {/* the flash, and the last picture taken */}
      <div key={flash} aria-hidden className={`absolute inset-0 bg-white ${flash ? "lego-flash" : "opacity-0"}`} />
      {last && (
        <a
          key={flash}
          href={last}
          download
          className="lego-thumb pointer-events-auto absolute bottom-28 left-6 w-[140px] overflow-hidden rounded-[10px] bg-white p-1 shadow-[0_20px_40px_-16px_rgba(0,0,0,.6)] md:bottom-12 md:left-12 md:w-[180px]"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={last} alt="The photo just taken" className="block w-full rounded-[7px]" />
          <span className="block px-1 pb-0.5 pt-1 font-mono text-[9px] uppercase tracking-[0.12em] text-[#15171c]/60">Saved · click to save again</span>
        </a>
      )}
    </div>
  );
}

/** Weightless: what gravity is doing right now, as a reading and a gauge. */
function GravityGauge({ g, on }: { g: number; on: boolean }) {
  const state = on ? (g > 0.04 ? "Gravity fading" : "Weightless") : "Gravity returning";
  return (
    <div className="flex items-center gap-3">
      <span aria-hidden className="relative h-[26px] w-[5px] overflow-hidden rounded-full bg-white/15">
        <span className="absolute inset-x-0 bottom-0 rounded-full transition-[height] duration-100" style={{ height: `${g * 100}%`, background: g < 0.04 ? SPACE_INK : "#ffffff", boxShadow: g < 0.04 ? `0 0 8px ${SPACE_INK}` : undefined }} />
      </span>
      <p className="leading-tight">
        <span className="brick-num text-[15px] text-white">{g.toFixed(2)}</span>
        <span className="brick-num text-[12px] text-white/50"> g</span>
        <span className="block text-[11.5px] text-white/50">{state}</span>
      </p>
    </div>
  );
}

async function copy(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

function SoundIcon({ on }: { on: boolean }) {
  return (
    <svg aria-hidden width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M11 5 6 9H3v6h3l5 4z" />
      {on ? <path d="M15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13" /> : <path d="m16 9 5 6M21 9l-5 6" />}
    </svg>
  );
}

/** A keycap, for shortcuts: a little white cap with a thicker lip on the near edge. */
function Kbd({ children, dark = false }: { children: ReactNode; dark?: boolean }) {
  return (
    <kbd
      className={`brick-num inline-grid h-[19px] min-w-[19px] place-items-center rounded-[4px] border border-b-[2px] px-1 text-[10.5px] font-semibold leading-none ${dark ? "border-white/15 border-b-white/25 bg-white/[0.08] text-white/80" : "border-[#16181d]/15 border-b-[#16181d]/30 bg-white text-[#16181d]/75"}`}
    >
      {children}
    </kbd>
  );
}

/** A row of studs, seen from the side: each one shaded like the cylinder it is. */
function Studs({ n, color, className = "" }: { n: number; color: string; className?: string }) {
  return (
    <span aria-hidden className={`pointer-events-none absolute -top-[4px] left-0 right-0 flex justify-evenly px-1.5 ${className}`}>
      {Array.from({ length: n }, (_, i) => (
        <span
          key={i}
          className="h-[5px] w-[16px] rounded-t-[3px]"
          style={{
            background: `linear-gradient(to right, ${shade(color, -0.22)}, ${shade(color, 0.28)} 32%, ${color} 62%, ${shade(color, -0.2)})`,
          }}
        />
      ))}
    </span>
  );
}

/** A button moulded like a brick: studs on top, a darker lip underneath. */
function BrickButton({ color, ink = INK, studs = 2, children, className = "", ...rest }: React.ButtonHTMLAttributes<HTMLButtonElement> & { color: string; ink?: string; studs?: number }) {
  return (
    <button
      type="button"
      {...rest}
      className={`relative mt-[4px] inline-flex h-11 items-center justify-center gap-2 rounded-[4px] px-5 text-[14px] font-bold tracking-[-0.005em] transition-[transform,filter,box-shadow] duration-150 [font-stretch:104%] hover:-translate-y-px hover:brightness-[1.05] active:translate-y-[2px] disabled:opacity-50 ${className}`}
      style={{ background: color, color: ink, boxShadow: `inset 0 -4px 0 ${shade(color, -0.24)}, inset 0 1px 0 rgba(255,255,255,.35), 0 0 0 1px ${shade(color, -0.32)}, 0 8px 14px -8px rgba(22,24,29,.55)` }}
    >
      <Studs n={studs} color={color} />
      {children}
    </button>
  );
}

/** A small button for the chips: quiet by default, or a solid colour when it should stand out. */
function ChipButton({ color, ink = INK, children, className = "", ...rest }: React.ButtonHTMLAttributes<HTMLButtonElement> & { color?: string; ink?: string }) {
  return (
    <button
      type="button"
      {...rest}
      className={`inline-flex h-8 items-center gap-1.5 rounded-[6px] px-3 text-[12.5px] font-semibold transition-[background-color,filter] duration-150 disabled:opacity-40 ${color ? "hover:brightness-[1.05]" : "bg-[#16181d]/[0.06] text-[#16181d] hover:bg-[#16181d]/[0.11]"} ${className}`}
      style={color ? { background: color, color: ink, boxShadow: `inset 0 -2px 0 ${color.startsWith("#") ? shade(color, -0.22) : "rgba(0,0,0,.2)"}, inset 0 1px 0 rgba(255,255,255,.3)` } : undefined}
    >
      {children}
    </button>
  );
}

/**
 * One tool in the toolbar. Idle it's a quiet icon; switched on it fills with its own colour, like a
 * brick pressed into place. Hovering shows its name and key.
 */
function Tool({ label, k, on = false, color = INK, ink = "#fbfaf6", children, className = "", ...rest }: React.ButtonHTMLAttributes<HTMLButtonElement> & { label: string; k?: string; on?: boolean; color?: string; ink?: string }) {
  return (
    <button
      type="button"
      {...rest}
      className={`group relative grid h-9 w-9 shrink-0 place-items-center rounded-[7px] transition-[background-color,color,transform] duration-150 active:translate-y-px disabled:cursor-default disabled:opacity-40 ${on ? "" : "text-[#16181d]/70 hover:bg-[#16181d]/[0.06] hover:text-[#16181d]"} ${className}`}
      style={on ? { background: color, color: ink, boxShadow: `inset 0 -2px 0 ${shade(color, -0.25)}, inset 0 1px 0 rgba(255,255,255,.3)` } : undefined}
    >
      {children}
      <span
        aria-hidden
        className="pointer-events-none absolute right-0 top-[calc(100%+10px)] z-30 flex items-center gap-2 whitespace-nowrap rounded-[6px] bg-[#16181d] py-1.5 pl-2.5 pr-1.5 text-[12px] font-medium text-white opacity-0 shadow-[0_12px_28px_-10px_rgba(0,0,0,.6)] transition-opacity duration-150 group-hover:opacity-100 group-hover:delay-300 group-focus-visible:opacity-100"
      >
        {label}
        {k && <Kbd dark>{k}</Kbd>}
      </span>
    </button>
  );
}

const Divider = ({ className = "" }: { className?: string }) => <span aria-hidden className={`mx-1 h-5 w-px shrink-0 bg-[#16181d]/[0.12] ${className}`} />;

/** The site's logo, as a 2 × 4 brick seen from above. */
function BrickLogo() {
  return (
    <span aria-hidden className="grid h-[20px] w-[36px] grid-cols-4 grid-rows-2 place-items-center rounded-[3px] p-[2.5px]" style={{ background: C.red, boxShadow: "inset 0 -2px 0 rgba(0,0,0,.25), inset 0 1px 0 rgba(255,255,255,.2), 0 0 0 1px #8f1206" }}>
      {Array.from({ length: 8 }, (_, i) => (
        <span key={i} className="h-[5.5px] w-[5.5px] rounded-full" style={{ background: "#d92a14", boxShadow: "inset -1px -1px 0 rgba(0,0,0,.28), inset 1px 1px 0 rgba(255,255,255,.32)" }} />
      ))}
    </span>
  );
}

/**
 * A brick drawn the way the parts callouts draw them: a three-quarter view with an ink outline,
 * the top face lit, the end in shadow, and its studs standing up off the top.
 */
function Part({ studs = 2, color, size = 1 }: { studs?: number; color: string; size?: number }) {
  const u = 9;
  const w = studs * u;
  const dx = 5;
  const dy = 3.6;
  const bh = 9.5;
  const sh = 2.2;
  const r = 2.5;
  const top = sh + 1.6 + dy;
  const line = shade(color, -0.55);
  const edge = { stroke: line, strokeWidth: 0.7, strokeLinejoin: "round" as const };
  return (
    <svg aria-hidden width={(w + dx + 2) * size} height={(top + bh + 2) * size} viewBox={`-1 -1 ${w + dx + 2} ${top + bh + 2}`} className="shrink-0 overflow-visible">
      <path d={`M0 ${top}h${w}v${bh}H0z`} fill={color} {...edge} />
      <path d={`M${w} ${top}l${dx} ${-dy}v${bh}l${-dx} ${dy}z`} fill={shade(color, -0.22)} {...edge} />
      <path d={`M0 ${top}l${dx} ${-dy}h${w}l${-dx} ${dy}z`} fill={shade(color, 0.22)} {...edge} />
      {Array.from({ length: studs }, (_, i) => {
        const cx = (i + 0.5) * u + dx / 2;
        const cy = top - dy / 2;
        return (
          <g key={i}>
            <path d={`M${cx - r} ${cy}v${-sh}a${r} ${r * 0.42} 0 0 0 ${2 * r} 0v${sh}a${r} ${r * 0.42} 0 0 1 ${-2 * r} 0z`} fill={color} {...edge} />
            <ellipse cx={cx} cy={cy - sh} rx={r} ry={r * 0.42} fill={shade(color, 0.3)} {...edge} />
          </g>
        );
      })}
    </svg>
  );
}
/** how many studs each line of a parts list gets, so a list reads as a handful of different pieces */
const PART_STUDS = [2, 4, 1, 3, 2, 1];

/**
 * A card, printed like a page from the instruction booklet: warm white stock, a band of the
 * section's colour along the top edge, and an optional strip at the foot for the small print.
 */
function Card({ children, className = "", k, scroll, foot, color }: { children: ReactNode; className?: string; k: string; scroll?: boolean; foot?: ReactNode; color: string }) {
  return (
    <section
      key={k}
      data-scroll={scroll || undefined}
      className={`sr-panel pointer-events-auto overflow-hidden rounded-[8px] bg-[#fbfaf6] text-[#16181d] shadow-[0_0_0_1px_rgba(22,24,29,.1),0_2px_4px_rgba(22,24,29,.06),0_28px_60px_-28px_rgba(22,24,29,.55)] ${className}`}
    >
      <div aria-hidden className="h-[6px]" style={{ background: color, boxShadow: `inset 0 -1px 0 ${shade(color, -0.25)}` }} />
      <div className="px-5 pb-5 pt-4 md:px-7 md:pb-7 md:pt-5">{children}</div>
      {foot && <div className="flex items-center justify-between gap-3 border-t border-[#16181d]/[0.09] bg-[#f1efe8] px-5 py-2.5 text-[12px] text-[#16181d]/55 md:px-7">{foot}</div>}
    </section>
  );
}

/**
 * A card's first line, set like a booklet step: the big step number, what this step is,
 * and anything that sits opposite.
 */
function CardHead({ n, children, sub, aside }: { n: number; children: ReactNode; sub?: ReactNode; aside?: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <div className="flex min-w-0 items-end gap-3">
        <span className="brick-step text-[46px] md:text-[52px]">{n}</span>
        <p className="min-w-0 pb-[3px] leading-tight">
          <span className="block truncate text-[13px] font-semibold">{children}</span>
          {sub && <span className="brick-num block truncate text-[11.5px] text-[#16181d]/50">{sub}</span>}
        </p>
      </div>
      {aside}
    </div>
  );
}

/** The light-blue box a booklet puts the parts for a step in. */
function Callout({ title, children, className = "" }: { title?: string; children: ReactNode; className?: string }) {
  return (
    <div className={`rounded-[6px] border border-[#b3c9dc] bg-[#dde9f3] px-3.5 pb-3 pt-2.5 ${className}`}>
      {title && <p className="brick-label mb-2 text-[#16181d]/50">{title}</p>}
      {children}
    </div>
  );
}

/** How to play: keycaps and what they do. Fades once it's been learned. */
function Legend({ items, gone = false, bg }: { items: [string, string][]; gone?: boolean; bg?: string }) {
  const dark = Boolean(bg);
  return (
    <p className={`flex flex-wrap items-center justify-end gap-x-3.5 gap-y-1.5 px-3 py-2 text-[12px] transition-opacity duration-700 ${SKIN} ${dark ? "!text-white/70" : "text-[#16181d]/65"} ${gone ? "opacity-0" : "opacity-100"}`} style={bg ? { background: bg } : undefined}>
      {items.map(([key, does]) => (
        <span key={key} className="flex items-center gap-1.5">
          <Kbd dark={dark}>{key}</Kbd>
          {does}
        </span>
      ))}
    </p>
  );
}

export default function LegoView() {
  const router = useRouter();
  const ready = useLego((s) => s.ready);
  const progress = useLego((s) => s.progress);
  const stop = useLego((s) => s.stop);
  const knocked = useLego((s) => s.knocked);
  const total = useLego((s) => s.total);
  const throws = useLego((s) => s.throws);
  const building = useLego((s) => s.building);
  const sound = useLego((s) => s.sound);
  const night = useLego((s) => s.night);
  const zeroG = useLego((s) => s.zeroG);
  const gravity = useLego((s) => s.gravity);
  const hover = useLego((s) => s.hover);
  const vacuum = useLego((s) => s.vacuum);
  const sucked = useLego((s) => s.sucked);
  const paint = useLego((s) => s.paint);
  const paintColor = useLego((s) => s.paintColor);
  const splats = useLego((s) => s.splats);
  const ammo = useLego((s) => s.ammo);
  const fired = useLego((s) => s.fired);
  const cam = useLego((s) => s.cam);
  const golden = useLego((s) => s.golden);
  const photo = useLego((s) => s.photo);
  const slowmo = useLego((s) => s.slowmo);
  const chaseCar = useLego((s) => s.chaseCar);
  const [shown, setShown] = useState(false);
  /** photo mode: bumped on every picture (for the flash), and the last picture taken */
  const [flash, setFlash] = useState(0);
  const [lastShot, setLastShot] = useState<string | null>(null);
  const wrap = useRef<HTMLDivElement>(null);
  const count = useLego((s) => s.stopCount);

  const go = useCallback((s: number) => {
    const n = useLego.getState().stopCount;
    useLego.getState().set({ target: Math.max(0, Math.min(n - 1, s)) });
  }, []);
  const step = useCallback((d: number) => go(Math.round(useLego.getState().target) + d), [go]);
  const rebuild = useCallback(() => {
    // putting it all back brings gravity back with it
    if (!useLego.getState().building) useLego.getState().set({ rebuildTick: useLego.getState().rebuildTick + 1, zeroG: false });
  }, []);

  // a fresh visit starts from the top, with the loader up (the store outlives the page)
  useEffect(() => {
    useLego.getState().set({ ready: false, building: false, progress: 0, knocked: 0, throws: 0, hover: null, target: 0, stop: 0, night: false, golden: false, zeroG: false, gravity: 1, vacuum: false, sucked: 0, paint: false, fired: 0, splats: 0, cam: "tour", zoom: 1, photo: false, slowmo: false });
  }, []);

  // the shutter: the frame comes back as a PNG, saved straight away
  useEffect(() => {
    legoEvents.onShot = (png: string) => {
      const d = new Date();
      const stamp = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
      const a = document.createElement("a");
      a.href = png;
      a.download = `brick-edition-${useLego.getState().cam}-${stamp}.png`;
      a.click();
      setLastShot(png);
      setFlash((f) => f + 1);
    };
    return () => {
      legoEvents.onShot = () => {};
    };
  }, []);

  // /lego?paint arrives with the marker already up; ?cam=street and ?light=golden pick the camera and the light
  useEffect(() => {
    if (!ready) return;
    const q = new URLSearchParams(window.location.search);
    if (q.has("paint")) useLego.getState().set({ paint: true, vacuum: false });
    const cam = CAMS.find((c) => c.id === q.get("cam"));
    if (cam) setCam(cam.id);
    const light = q.get("light");
    if (light === "golden" || light === "night") useLego.getState().set({ golden: light === "golden", night: light === "night" });
  }, [ready]);

  // what a printed piece does when it's clicked: a poster seen from elsewhere flies you to it,
  // and once you're in front of it, it's a target like everything else
  useEffect(() => {
    legoEvents.canPick = (pick: Pick) => pick.kind !== "project" || useLego.getState().stop !== PROJECT0 + pick.index;
    legoEvents.onPick = async (pick: Pick) => {
      if (pick.kind === "project") go(PROJECT0 + pick.index);
      else if (pick.kind === "email") {
        const ok = await copy(person.email);
        useApp.getState().set({ toast: ok ? "Email copied to clipboard" : person.email });
      } else window.open(pick.href, "_blank", "noopener,noreferrer");
    };
  }, [go, router]);

  // wheel and swipes move between stops; keys too
  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    let snap = 0;
    const onWheel = (e: WheelEvent) => {
      if ((e.target as HTMLElement).closest("[data-scroll]")) return;
      e.preventDefault();
      const dy = (e.deltaMode === 1 ? 16 : 1) * (Math.abs(e.deltaY) > Math.abs(e.deltaX) ? e.deltaY : e.deltaX);
      const s = useLego.getState();
      // the free orbit zooms instead
      if (s.cam === "orbit") return s.set({ zoom: Math.max(0.3, Math.min(2.4, s.zoom * Math.exp(dy * 0.0011))) });
      s.set({ target: Math.max(0, Math.min(s.stopCount - 1, s.target + dy * 0.0016)) });
      clearTimeout(snap);
      snap = window.setTimeout(() => go(Math.round(useLego.getState().target)), 160);
    };
    let touch: { x: number; y: number } | null = null;
    const onTouchStart = (e: TouchEvent) => (touch = { x: e.touches[0].clientX, y: e.touches[0].clientY });
    const onTouchEnd = (e: TouchEvent) => {
      if (!touch) return;
      const dy = e.changedTouches[0].clientY - touch.y;
      const dx = e.changedTouches[0].clientX - touch.x;
      // while the vacuum is out a drag steers it instead, and with the marker up a tap fires
      if (!useLego.getState().vacuum && !useLego.getState().paint && useLego.getState().cam !== "orbit" && Math.abs(dy) > 50 && Math.abs(dy) > Math.abs(dx) * 1.2) step(dy < 0 ? 1 : -1);
      touch = null;
    };
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.closest("input, textarea")) return;
      const s = useLego.getState();
      const plain = !e.metaKey && !e.ctrlKey && !e.altKey;
      // photo mode: Space or Enter is the shutter, Escape the way out
      // (a focused button already answers Space and Enter itself)
      if (s.photo && (e.key === " " || e.key === "Enter")) {
        if ((e.target as HTMLElement)?.closest("button, a")) return;
        shutter();
      }
      else if (s.photo && e.key === "Escape") togglePhoto();
      // riding along: left and right hop to another car
      else if (s.cam === "chase" && (e.key === "ArrowLeft" || e.key === "ArrowRight")) s.set({ chaseCar: s.chaseCar + (e.key === "ArrowLeft" ? -1 : 1) });
      else if (e.key.toLowerCase() === "k" && plain) setCam(nextCam(s.cam, e.shiftKey ? -1 : 1));
      else if (e.key.toLowerCase() === "f" && plain) togglePhoto();
      else if (e.key.toLowerCase() === "t" && plain) toggleSlowmo();
      else if (e.key.toLowerCase() === "b" && plain) brickStorm();
      else if (["ArrowDown", "ArrowRight", "PageDown", " "].includes(e.key)) step(1);
      else if (["ArrowUp", "ArrowLeft", "PageUp"].includes(e.key)) step(-1);
      else if (e.key === "Home") go(0);
      else if (e.key === "End") go(useLego.getState().stopCount - 1);
      else if (e.key.toLowerCase() === "r" && !e.metaKey && !e.ctrlKey) rebuild();
      else if (e.key.toLowerCase() === "n" && !e.metaKey && !e.ctrlKey) cycleTime();
      else if (e.key.toLowerCase() === "v" && !e.metaKey && !e.ctrlKey) toggleVacuum();
      else if (e.key.toLowerCase() === "p" && !e.metaKey && !e.ctrlKey) togglePaint();
      else if (e.key.toLowerCase() === "g" && !e.metaKey && !e.ctrlKey) toggleZeroG();
      else if (e.key.toLowerCase() === "c" && !e.metaKey && !e.ctrlKey) useLego.getState().set({ washTick: useLego.getState().washTick + 1 });
      else if (/^[1-8]$/.test(e.key) && !e.metaKey && !e.ctrlKey) useLego.getState().set({ paintColor: Number(e.key) - 1 });
      else return;
      e.preventDefault();
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    el.addEventListener("touchstart", onTouchStart, { passive: true });
    el.addEventListener("touchend", onTouchEnd, { passive: true });
    addEventListener("keydown", onKey);
    return () => {
      clearTimeout(snap);
      el.removeEventListener("wheel", onWheel);
      el.removeEventListener("touchstart", onTouchStart);
      el.removeEventListener("touchend", onTouchEnd);
      removeEventListener("keydown", onKey);
    };
  }, [go, step, rebuild]);

  // the loader lifts once the opening build is under way
  useEffect(() => {
    if (!ready) return;
    const id = setTimeout(() => setShown(true), 150);
    return () => clearTimeout(id);
  }, [ready]);

  const onReady = useCallback(() => {}, []);
  const light: Light = night ? "night" : golden ? "golden" : "day";
  /** the interface (it steps aside for photo mode) */
  const ui = shown && !photo;
  const project = stop >= PROJECT0 && stop < ABOUT ? projects[stop - PROJECT0] : null;
  const pi = stop - PROJECT0;

  return (
    <div
      ref={wrap}
      data-lenis-prevent
      data-cursor={hover ? CURSOR[hover] : undefined}
      className="brick-ui fixed inset-0 h-dvh select-none overflow-hidden bg-[#e9eee9] text-[#15171c]"
      style={{ cursor: paint ? RETICLE : hover ? "pointer" : "crosshair" }}
    >
      <div className="absolute inset-0 touch-none">
        <LegoScene onReady={onReady} />
      </div>

      {/* —— cinematic: the frame narrows to 2.39:1 —— */}
      {[0, 1].map((i) => (
        <div
          key={i}
          aria-hidden
          className={`pointer-events-none absolute inset-x-0 z-[5] bg-[#07080a] transition-[height] duration-1000 ease-[cubic-bezier(.65,0,.35,1)] ${i ? "bottom-0" : "top-0"}`}
          style={{ height: cam === "cinema" ? "min(14dvh, max(0px, calc((100dvh - 100vw / 2.39) / 2)))" : 0 }}
        />
      ))}

      {/* —— photo mode —— */}
      {photo && <Viewfinder cam={cam} golden={golden} night={night} slowmo={slowmo} flash={flash} last={lastShot} />}

      {/* —— top bar —— */}
      <header className={`pointer-events-none absolute inset-x-0 top-0 z-20 flex items-start justify-between gap-3 px-gutter pt-4 transition-opacity duration-300 md:pt-5 ${photo ? "invisible opacity-0" : ""}`}>
        <div className="pointer-events-auto flex items-center gap-2">
          <Link href="/" className={`inline-flex h-11 items-center gap-3 pl-3.5 pr-4 transition-colors hover:!bg-[#f1efe8] ${SKIN}`} aria-label={`${person.name} — back to the main site`}>
            <BrickLogo />
            <span className="flex items-baseline gap-2 leading-none max-[420px]:hidden">
              <span className="text-[14px] font-extrabold tracking-[-0.01em] [font-stretch:112%]">{person.shortName}</span>
              <span className="brick-label hidden !text-[9.5px] text-[#16181d]/45 sm:inline">Brick Edition</span>
            </span>
          </Link>
          <CameraMenu cam={cam} slowmo={slowmo} sound={sound} light={light} />
        </div>

        <nav aria-label="Sections" className={`pointer-events-auto absolute left-1/2 top-4 hidden -translate-x-1/2 items-center gap-0.5 p-1 md:top-5 lg:flex ${SKIN}`}>
          {GROUPS.map((g) => {
            const on = g.has(stop);
            return (
              <button
                key={g.label}
                type="button"
                onClick={() => go(g.stop)}
                aria-current={on ? "true" : undefined}
                className={`h-9 rounded-[7px] px-4 text-[13px] font-semibold transition-colors ${on ? "bg-[#16181d] text-[#fbfaf6] shadow-[inset_0_-2px_0_rgba(0,0,0,.5)]" : "text-[#16181d]/60 hover:bg-[#16181d]/[0.05] hover:text-[#16181d]"}`}
              >
                {g.label}
              </button>
            );
          })}
        </nav>

        <div role="toolbar" aria-label="Tools" className={`pointer-events-auto flex h-11 items-center gap-0.5 p-1 ${SKIN}`}>
          <Tool label={building ? "Building…" : "Rebuild"} k="R" onClick={rebuild} disabled={building} aria-label="Rebuild everything (R)">
            <svg aria-hidden width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.3" strokeLinecap="round" strokeLinejoin="round" className={building ? "animate-spin [animation-direction:reverse]" : ""}>
              <path d="M3 12a9 9 0 1 0 3-6.7L3 8" />
              <path d="M3 3v5h5" />
            </svg>
          </Tool>
          <Divider />
          <Tool label="Vacuum" k="V" on={vacuum} color={C.brightGreen} ink="#fff" onClick={toggleVacuum} aria-pressed={vacuum} aria-label={vacuum ? "Put the vacuum away (V)" : "Get the vacuum out (V)"}>
            <svg aria-hidden width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round">
              <path d="M17 2.5v4.5" />
              <rect x="14.5" y="7" width="5" height="6.5" rx="2.2" />
              <path d="M17 13.5 9.5 19" />
              <path d="M4 19.5h8.5a1.5 1.5 0 0 0 0-3H6a2 2 0 0 0-2 2z" />
            </svg>
          </Tool>
          <Tool
            label="Paintball"
            k="P"
            on={paint}
            color={PAINTS[paintColor].hex}
            ink={paintColor >= 4 && paintColor <= 6 ? "#fff" : INK}
            onClick={togglePaint}
            aria-pressed={paint}
            aria-label={paint ? "Put the paintball marker away (P)" : "Pick up the paintball marker (P)"}
          >
            <svg aria-hidden width="16" height="15" viewBox="0 0 26 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M2 10h17.5M19.5 8.6h4.5v2.8h-4.5" />
              <path d="M2.5 7.5h15v5.5H8.5l-1.5 8H3.5l1.4-8H2.5z" />
              <path d="M11 13v3.5h3" />
              <ellipse cx="12" cy="4.2" rx="4.4" ry="2.6" />
            </svg>
          </Tool>
          <Tool label="Zero gravity" k="G" on={zeroG} color={SPACE} ink={SPACE_INK} onClick={toggleZeroG} aria-pressed={zeroG} aria-label={zeroG ? "Bring gravity back (G)" : "Switch gravity off (G)"}>
            <svg aria-hidden width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <circle cx="12" cy="12" r="3.6" />
              <ellipse cx="12" cy="12" rx="10" ry="4.2" transform="rotate(-28 12 12)" />
              <circle cx="20.9" cy="8.9" r="1.4" fill="currentColor" stroke="none" />
            </svg>
          </Tool>
          <Divider className="max-sm:hidden" />
          <Tool
            label={LIGHT_NAME[light]}
            k="N"
            on={light !== "day"}
            color={night ? "#25356d" : GOLD}
            ink={night ? "#ffe3a6" : INK}
            onClick={cycleTime}
            aria-label={`Light: ${LIGHT_NAME[light]} — switch to ${LIGHT_NAME[light === "day" ? "golden" : light === "golden" ? "night" : "day"]} (N)`}
            className="max-sm:!hidden"
          >
            <LightIcon light={light} />
          </Tool>
          <Tool label={sound ? "Sound on" : "Sound off"} onClick={() => useLego.getState().set({ sound: !sound })} aria-pressed={sound} aria-label={sound ? "Mute brick sounds" : "Unmute brick sounds"} className="max-sm:!hidden">
            <SoundIcon on={sound} />
          </Tool>
          <Link href="/" className="ml-1 hidden h-9 items-center gap-1.5 rounded-[7px] bg-[#16181d] px-3.5 text-[13px] font-semibold text-[#fbfaf6] shadow-[inset_0_-2px_0_rgba(0,0,0,.5)] transition-colors hover:bg-[#2a2d34] md:inline-flex">
            Exit
            <svg aria-hidden width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" className="opacity-60">
              <path d="M3 7 7 3M3.5 3H7v3.5" />
            </svg>
          </Link>
        </div>
      </header>

      {/* —— which camera is rolling (anything but the tour) —— */}
      {ui && cam !== "tour" && (
        <div key={cam} className={`sr-rise pointer-events-auto absolute left-gutter top-[72px] z-10 hidden items-center gap-3 py-1.5 pl-3.5 pr-1.5 md:top-[80px] md:flex ${SKIN}`}>
          <span className="h-2 w-2 animate-pulse rounded-full bg-[#e3261b] shadow-[0_0_0_3px_rgba(227,38,27,.18)]" />
          <p className="text-[12.5px] font-semibold leading-tight">
            {CAM[cam].label}
            <span className="block text-[11.5px] font-normal text-[#16181d]/50">
              {cam === "chase" ? `Car ${(((chaseCar % 8) + 8) % 8) + 1} of 8 · ← → to switch` : cam === "orbit" ? "Drag to circle · scroll to zoom" : cam === "cinema" ? "Rolling on its own · scroll to steer" : CAM[cam].lens}
            </span>
          </p>
          {cam === "chase" && <ChipButton onClick={() => useLego.getState().set({ chaseCar: chaseCar + 1 })}>Next car</ChipButton>}
          <ChipButton onClick={() => setCam("tour")}>Exit</ChipButton>
        </div>
      )}

      {/* —— the page of the booklet for the current stop —— */}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 z-10 px-gutter pb-4 md:bottom-6 md:left-0 md:right-auto md:w-[min(452px,42vw)] md:pb-0">
        {ui && stop === 0 && (
          <Card
            k="hero"
            color={C.red}
            foot={
              <>
                <span className="truncate">{person.location}</span>
                {total > 0 && (
                  <span className="brick-num shrink-0 font-semibold text-[#16181d]">
                    {total.toLocaleString()}
                    <span className="font-normal text-[#16181d]/50"> pcs/pzs</span>
                  </span>
                )}
              </>
            }
          >
            <CardHead n={stop + 1} sub={`Step ${stop + 1} of ${count}`}>
              {person.role}
            </CardHead>
            <h1 className="brick-display mt-5 text-[clamp(32px,3.3vw,48px)]">{beats.hero[0]}</h1>
            <p className="mt-4 hidden text-pretty text-[15px] leading-[1.6] text-[#16181d]/70 md:block">{person.intro}</p>
            <p className="mt-3 text-[14.5px] leading-[1.55] text-[#16181d]/70 md:hidden">Everything here is built from bricks — and everything can be knocked down.</p>
            <div className="mt-6 flex flex-wrap items-center gap-4">
              <BrickButton color={C.red} ink="#fff" onClick={() => go(1)} studs={3}>
                See the work
                <svg aria-hidden width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M3 8h10M9 4l4 4-4 4" />
                </svg>
              </BrickButton>
              <span className="flex items-center gap-2 text-[12.5px] text-[#16181d]/50">
                <Kbd>↓</Kbd> or scroll
              </span>
            </div>
          </Card>
        )}

        {ui && stop === 1 && (
          <Card
            k="projects"
            color={C.blue}
            foot={
              <>
                <span>Click a poster to open it — or knock it over first</span>
                <span className="brick-num shrink-0 font-semibold text-[#16181d]">{projects.length} builds</span>
              </>
            }
          >
            <CardHead n={stop + 1} sub={`Step ${stop + 1} of ${count}`}>
              Selected work
            </CardHead>
            <h2 className="brick-display mt-5 text-[clamp(28px,2.8vw,40px)]">Six systems, built brick by brick.</h2>
            <ol className="mt-5 border-t border-[#16181d]/[0.1]">
              {projects.map((p, i) => (
                <li key={p.slug}>
                  <button type="button" onClick={() => go(PROJECT0 + i)} className="group flex w-full items-center gap-3 border-b border-[#16181d]/[0.08] py-2.5 text-left">
                    <span className="brick-num w-4 text-[11px] font-semibold text-[#16181d]/35">{i + 1}</span>
                    <span className="grid w-[30px] place-items-center">
                      <Part studs={2} color={TINT[p.slug]} />
                    </span>
                    <span className="shrink-0 text-[14.5px] font-semibold underline decoration-transparent underline-offset-4 transition-colors group-hover:decoration-[#16181d]/40">{p.title}</span>
                    <span className="hidden min-w-0 flex-1 truncate text-right text-[12px] text-[#16181d]/45 sm:block">{p.category}</span>
                    <svg aria-hidden width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" className="-translate-x-1 opacity-0 transition-[opacity,transform] duration-200 group-hover:translate-x-0 group-hover:opacity-100">
                      <path d="M3 8h10M9 4l4 4-4 4" />
                    </svg>
                  </button>
                </li>
              ))}
            </ol>
          </Card>
        )}

        {ui && project && (
          <Card
            k={project.slug}
            color={TINT[project.slug]}
            className="max-md:max-h-[50dvh] max-md:overflow-y-auto"
            scroll
            foot={
              <>
                {project.link ? (
                  <a href={project.link} target="_blank" rel="noreferrer" className="truncate font-medium text-[#16181d]/70 underline decoration-[#16181d]/25 underline-offset-4 transition-colors hover:text-[#16181d] hover:decoration-[#16181d]/70">
                    {host(project.link)} ↗
                  </a>
                ) : (
                  <span>{project.category}</span>
                )}
                <span className="brick-num shrink-0">
                  {project.year}
                </span>
              </>
            }
          >
            <CardHead
              n={pi + 1}
              sub={`Build ${pi + 1} of ${projects.length}`}
              aside={
                <div className="flex shrink-0 gap-1">
                  {[-1, 1].map((d) => (
                    <button
                      key={d}
                      type="button"
                      onClick={() => step(d)}
                      aria-label={d < 0 ? "Previous" : "Next"}
                      className="grid h-8 w-8 place-items-center rounded-[6px] border border-[#16181d]/[0.12] bg-white text-[#16181d]/70 shadow-[inset_0_-2px_0_rgba(22,24,29,.08)] transition-colors hover:border-[#16181d]/25 hover:text-[#16181d]"
                    >
                      <svg aria-hidden width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" className={d < 0 ? "rotate-180" : ""}>
                        <path d="M3 8h10M9 4l4 4-4 4" />
                      </svg>
                    </button>
                  ))}
                </div>
              }
            >
              {project.category}
            </CardHead>
            <h2 className="brick-display mt-5 text-[clamp(32px,3.4vw,50px)]">{project.title}</h2>
            <p className="mt-3 text-pretty text-[15px] leading-[1.55] text-[#16181d]/70">{project.tagline}</p>
            {project.metrics && (
              <dl className="mt-5 grid grid-cols-3 divide-x divide-[#16181d]/[0.1] border-y border-[#16181d]/[0.1]">
                {project.metrics.map((m) => (
                  <div key={m.label} className="py-3 pl-3 pr-2 first:pl-0">
                    <dt className="sr-only">{m.label}</dt>
                    <dd className="brick-display brick-num text-[24px]">{m.value}</dd>
                    <dd className="mt-1.5 text-[11.5px] leading-snug text-[#16181d]/55">{m.label}</dd>
                  </div>
                ))}
              </dl>
            )}
            <Callout title="In the box" className="mt-5">
              {/* laid out the way a booklet lays out a step's parts: each piece, its count under it */}
              <ul className="grid grid-cols-4 gap-x-3 gap-y-3">
                {project.stack.map((s, i) => (
                  <li key={s} className="min-w-0">
                    <span className="flex h-[27px] items-end">
                      <Part studs={PART_STUDS[i % PART_STUDS.length]} color={TINT[project.slug]} size={1.15} />
                    </span>
                    <span className="brick-num mt-1.5 block text-[12.5px] font-bold leading-none">1×</span>
                    <span className="mt-1 block text-[11.5px] font-medium leading-[1.25] text-[#16181d]/70 [overflow-wrap:anywhere]">{s}</span>
                  </li>
                ))}
              </ul>
            </Callout>
            <div className="mt-6">
              <BrickButton color={TINT[project.slug]} studs={3} onClick={() => router.push(`/projects/${project.slug}`)}>
                Open the case study
                <svg aria-hidden width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M3 8h10M9 4l4 4-4 4" />
                </svg>
              </BrickButton>
            </div>
          </Card>
        )}

        {ui && stop === ABOUT && (
          <Card k="about" color={C.darkTurquoise}>
            <CardHead n={stop + 1} sub={`Step ${stop + 1} of ${count}`}>
              About the builder
            </CardHead>
            <h2 className="brick-display mt-5 text-[clamp(30px,3.1vw,46px)]">{about.headline}</h2>
            {about.body.map((b) => (
              <p key={b} className="mt-3 text-pretty text-[14.5px] leading-[1.6] text-[#16181d]/70 max-md:[&:not(:first-of-type)]:hidden">
                {b}
              </p>
            ))}
            <dl className="mt-6 border-t border-[#16181d]/[0.1]">
              {about.annotations.map((a) => (
                <div key={a.label} className="flex items-baseline justify-between gap-4 border-b border-[#16181d]/[0.08] py-2.5">
                  <dt className="shrink-0 text-[12.5px] text-[#16181d]/55">{a.label}</dt>
                  <dd className="truncate text-right text-[14px] font-semibold tracking-[-0.01em]">{a.value}</dd>
                </div>
              ))}
            </dl>
          </Card>
        )}

        {ui && stop === CONTACT && (
          <Card
            k="contact"
            color={C.lime}
            foot={
              <>
                <span className="truncate">
                  © {contact.year} {person.name}
                </span>
                <span className="shrink-0">three.js · Rapier</span>
              </>
            }
          >
            <CardHead n={stop + 1} sub={`Step ${stop + 1} of ${count} · last one`}>
              {contact.label}
            </CardHead>
            <h2 className="brick-display mt-5 text-[clamp(30px,3.1vw,46px)]">{contact.heading}</h2>
            <p className="mt-3 text-pretty text-[14.5px] leading-[1.6] text-[#16181d]/70">{contact.note}</p>
            <div className="mt-6 flex flex-wrap items-center gap-x-5 gap-y-3">
              <BrickButton
                color={C.lime}
                studs={4}
                onClick={async () => {
                  const ok = await copy(person.email);
                  useApp.getState().set({ toast: ok ? "Email copied to clipboard" : person.email });
                }}
              >
                {person.email}
              </BrickButton>
              <span className="flex flex-wrap gap-x-4 gap-y-1">
                {person.socials.map((s) => (
                  <a key={s.label} href={s.href} target="_blank" rel="noreferrer" className="text-[13px] font-semibold text-[#16181d]/75 underline decoration-[#16181d]/25 underline-offset-4 transition-colors hover:text-[#16181d] hover:decoration-[#16181d]/70">
                    {s.label} ↗
                  </a>
                ))}
              </span>
            </div>
          </Card>
        )}
      </div>

      {/* —— bottom right: how to play, and the damage done —— */}
      {ui && (
        <div className="pointer-events-none absolute bottom-6 right-gutter z-10 hidden max-w-[min(560px,50vw)] flex-col items-end gap-2 md:flex">
          {slowmo && (
            <div key="slowmo" className={`sr-rise pointer-events-auto flex items-center gap-3 py-1.5 pl-4 pr-1.5 ${SKIN}`}>
              <p className="text-[12.5px] text-[#16181d]/55">
                <span className="brick-num text-[15px] font-bold text-[#16181d]">0.2×</span> slow motion
              </p>
              <ChipButton onClick={toggleSlowmo}>Real time</ChipButton>
            </div>
          )}
          {(zeroG || gravity < 1) && (
            <div key="zerog" className={`sr-rise pointer-events-auto flex items-center gap-4 py-1.5 pl-4 pr-1.5 !text-white ${SKIN}`} style={{ background: `color-mix(in oklab, ${SPACE} 96%, transparent)` }}>
              <GravityGauge g={gravity} on={zeroG} />
              <ChipButton color={zeroG ? SPACE_INK : "#2a3456"} ink={zeroG ? SPACE : "#fff"} onClick={toggleZeroG} disabled={!zeroG}>
                Gravity on
              </ChipButton>
            </div>
          )}
          {paint && (
            <div key="paint" className={`sr-rise pointer-events-auto flex items-center gap-3.5 py-1.5 pl-4 pr-1.5 ${SKIN}`}>
              <p className="text-[12.5px] text-[#16181d]/55">
                <span className="brick-num text-[15px] font-bold text-[#16181d]">{ammo < 0 ? "··" : ammo}</span> {ammo < 0 ? "loading" : "balls"} · <span className="brick-num font-semibold text-[#16181d]/80">{splats}</span> splats
              </p>
              <div role="radiogroup" aria-label="Paint colour" className="flex items-center gap-1.5">
                {PAINTS.map((c, i) => (
                  <button
                    key={c.hex}
                    type="button"
                    role="radio"
                    aria-checked={i === paintColor}
                    aria-label={`${c.name} (${i + 1})`}
                    title={`${c.name} (${i + 1})`}
                    onClick={() => useLego.getState().set({ paintColor: i })}
                    className={`h-[17px] w-[17px] rounded-full transition-transform duration-150 hover:scale-110 ${i === paintColor ? "scale-110 ring-2 ring-[#16181d] ring-offset-2 ring-offset-[#fbfaf6]" : ""}`}
                    style={{ background: `radial-gradient(circle at 35% 30%, ${shade(c.hex, 0.45)}, ${c.hex} 60%)`, boxShadow: "inset 0 -2px 3px rgba(0,0,0,.25), 0 0 0 1px rgba(22,24,29,.15)" }}
                  />
                ))}
              </div>
              <ChipButton onClick={() => useLego.getState().set({ washTick: useLego.getState().washTick + 1 })} disabled={!splats}>
                Wash
              </ChipButton>
            </div>
          )}
          {vacuum && (
            <div key="sucked" className={`sr-rise pointer-events-none flex items-center gap-2.5 py-2.5 pl-3.5 pr-4 ${SKIN}`}>
              <span className="h-2 w-2 animate-pulse rounded-full" style={{ background: C.brightGreen, boxShadow: `0 0 0 3px ${shade(C.brightGreen, 0.7)}` }} />
              <p className="text-[12.5px] text-[#16181d]/55">
                <span className="brick-num text-[15px] font-bold text-[#16181d]">{sucked}</span> {sucked === 1 ? "brick" : "bricks"} in the bin
              </p>
            </div>
          )}
          {knocked > 0 && (
            <div key="knocked" className={`sr-rise pointer-events-auto flex items-center gap-3 py-1.5 pl-4 pr-1.5 ${SKIN}`}>
              <p className="text-[12.5px] text-[#16181d]/55">
                <span className="brick-num text-[15px] font-bold text-[#16181d]">{knocked}</span>
                <span className="brick-num text-[#16181d]/40"> / {total}</span> pieces loose
              </p>
              <ChipButton color={C.yellow} onClick={rebuild} disabled={building}>
                Rebuild
              </ChipButton>
            </div>
          )}
          {zeroG && !paint && !vacuum ? (
            <Legend key="zg-hint" gone={throws > 8} bg={`color-mix(in oklab, ${SPACE} 96%, transparent)`} items={[["Click", "throw — it flies dead straight"], ["G", "gravity back"], ["R", "rebuild"]]} />
          ) : paint ? (
            <Legend key="paint-hint" gone={fired > 40} items={[["Click", "fire"], ["Hold", "full auto"], ["1–8", "colour"], ["C", "wash"], ["P", "put down"]]} />
          ) : vacuum ? (
            <Legend key="vac-hint" items={[["Move", "steer"], ["Hold", "boost"], ["R", "put it back"], ["V", "stop"]]} />
          ) : (
            <Legend key="hint" gone={throws > 2} items={[["Click", "throw a brick"], ["Drag", "look"], ["Scroll", "explore"], ["K", "cameras"], ["F", "photo"], ["B", "storm"]]} />
          )}
        </div>
      )}

      {/* —— progress rail (stops), stacked like 1 × 2 plates —— */}
      {ui && (
        <div aria-hidden className="pointer-events-none absolute right-gutter top-1/2 z-10 hidden -translate-y-1/2 flex-col items-center gap-1.5 lg:flex">
          {Array.from({ length: count }, (_, i) => (
            <span
              key={i}
              className="block rounded-[2px] transition-all duration-500"
              style={{ width: 7, height: i === stop ? 26 : 7, background: i === stop ? C.red : "#fbfaf6", boxShadow: i === stop ? "inset 0 -2px 0 rgba(0,0,0,.25), 0 0 0 1px #8f1206" : "0 0 0 1px rgba(22,24,29,.22), 0 1px 2px rgba(22,24,29,.2)" }}
            />
          ))}
        </div>
      )}

      {/* —— mobile: a hint under the top bar —— */}
      {ui && vacuum && (
        <p className="pointer-events-none absolute inset-x-0 top-[72px] z-10 flex justify-center md:hidden">
          <span className={`px-3 py-1.5 text-[12px] text-[#16181d]/70 ${SKIN}`}>
            Drag to vacuum · <span className="brick-num font-bold text-[#16181d]">{sucked}</span> in the bin
          </span>
        </p>
      )}
      {ui && paint && (
        <div className="pointer-events-auto absolute inset-x-0 top-[72px] z-10 flex flex-col items-center gap-2 md:hidden">
          <div className={`flex gap-1.5 p-1.5 ${SKIN}`}>
            {PAINTS.map((c, i) => (
              <button
                key={c.hex}
                type="button"
                aria-label={c.name}
                onClick={() => useLego.getState().set({ paintColor: i })}
                className={`h-6 w-6 rounded-full ${i === paintColor ? "ring-2 ring-[#16181d] ring-offset-2 ring-offset-[#fbfaf6]" : ""}`}
                style={{ background: c.hex, boxShadow: "inset 0 -2px 3px rgba(0,0,0,.25)" }}
              />
            ))}
          </div>
          <p className={`px-3 py-1.5 text-[12px] text-[#16181d]/70 ${SKIN}`}>
            Tap to fire · hold for full auto · <span className="brick-num font-bold text-[#16181d]">{splats}</span> splats
          </p>
        </div>
      )}
      {ui && zeroG && !vacuum && !paint && (
        <p className="pointer-events-none absolute inset-x-0 top-[72px] z-10 flex justify-center md:hidden">
          <span className={`px-3 py-1.5 text-[12px] !text-white/75 ${SKIN}`} style={{ background: SPACE }}>
            <span className="brick-num font-bold text-white">{gravity.toFixed(2)} g</span> · {gravity > 0.04 ? "gravity fading" : "weightless"} · tap to throw
          </span>
        </p>
      )}
      {ui && !vacuum && !paint && !zeroG && throws === 0 && (
        <p className="pointer-events-none absolute inset-x-0 top-[72px] z-10 flex justify-center md:hidden">
          <span className={`px-3 py-1.5 text-[12px] text-[#16181d]/70 ${SKIN}`}>Tap to throw · swipe to move</span>
        </p>
      )}

{/* —— loader —— */}
      <div
        aria-hidden={shown}
        className={`absolute inset-0 z-30 flex flex-col items-center justify-center gap-7 bg-[#e9eee9] transition-opacity duration-700 ${shown ? "pointer-events-none opacity-0" : "opacity-100"}`}
      >
        <div className="relative flex h-16 items-end gap-1">
          {[C.red, C.yellow, C.blue, C.lime].map((c, i) => (
            <span
              key={c}
              className="lego-loader-brick relative block h-5 w-10 rounded-[3px]"
              style={{ background: c, animationDelay: `${i * 0.18}s`, boxShadow: "inset 0 -3px 0 rgba(0,0,0,.18), inset 0 1px 0 rgba(255,255,255,.3)" }}
            >
              <Studs n={2} color={c} className="!-top-[4px]" />
            </span>
          ))}
        </div>
        <div className="flex flex-col items-center">
          <p className="brick-display text-[28px]">Sorting the bricks</p>
          <div className="mt-4 flex items-center gap-3">
            <span className="relative h-[3px] w-40 overflow-hidden rounded-full bg-[#131417]/10">
              <span className="absolute inset-y-0 left-0 rounded-full bg-[#131417] transition-[width] duration-300" style={{ width: `${Math.round(progress * 100)}%` }} />
            </span>
            <span className="brick-num w-9 text-[11px] text-[#131417]/55">{Math.round(progress * 100)}%</span>
          </div>
        </div>
      </div>
    </div>
  );
}
