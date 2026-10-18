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
const INK = "#15171c";

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
  const item = "flex w-full items-center gap-3 rounded-[12px] px-2.5 py-2 text-left transition-colors";
  return (
    <div ref={box} className="relative">
      <BrickButton
        color={cam === "tour" ? "#ffffff" : "#15171c"}
        ink={cam === "tour" ? INK : "#ffffff"}
        studs={2}
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label={`Camera: ${CAM[cam].label} (K to switch)`}
        title="Camera (K)"
        className="max-sm:!px-3 lg:max-2xl:!px-3"
      >
        <CamIcon id={cam === "tour" ? "camera" : cam} size={15} />
        <span className="hidden xl:inline">{cam === "tour" ? "Camera" : CAM[cam].label}</span>
      </BrickButton>
      {open && (
        <div role="menu" className="sr-rise absolute left-0 top-[calc(100%+10px)] z-30 w-[300px] max-w-[calc(100vw-32px)] rounded-[18px] bg-white/92 p-2 text-[#15171c] shadow-[0_30px_70px_-28px_rgba(16,24,40,.6)] ring-1 ring-black/[0.07] backdrop-blur-xl max-sm:fixed max-sm:inset-x-4 max-sm:top-[70px] max-sm:w-auto">
          <p className="px-2.5 pb-1.5 pt-1 font-mono text-[9.5px] uppercase tracking-[0.16em] text-[#15171c]/45">Camera · K to cycle</p>
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
                className={`${item} ${on ? "bg-[#15171c] text-white" : "hover:bg-black/[0.05]"}`}
              >
                <span className={`grid h-8 w-8 shrink-0 place-items-center rounded-[9px] ${on ? "bg-white/12" : "bg-black/[0.05]"}`}>
                  <CamIcon id={c.id} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[13px] font-semibold leading-tight">{c.label}</span>
                  <span className={`block truncate text-[11.5px] leading-tight ${on ? "text-white/60" : "text-[#15171c]/55"}`}>{c.blurb}</span>
                </span>
                <span className={`hidden font-mono text-[9px] uppercase tracking-[0.08em] sm:block ${on ? "text-white/50" : "text-[#15171c]/35"}`}>{c.lens.split(" · ")[0]}</span>
              </button>
            );
          })}
          <div className="my-1.5 h-px bg-black/[0.07]" />
          <p className="px-2.5 pb-1.5 pt-0.5 font-mono text-[9.5px] uppercase tracking-[0.16em] text-[#15171c]/45">Photo kit</p>
          <button type="button" role="menuitem" onClick={() => (togglePhoto(), setOpen(false))} className={`${item} hover:bg-black/[0.05]`}>
            <span className="grid h-8 w-8 shrink-0 place-items-center rounded-[9px] bg-black/[0.05]">
              <svg aria-hidden width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <path d="M3 8V4h4M21 8V4h-4M3 16v4h4M21 16v4h-4" />
                <circle cx="12" cy="12" r="3" />
              </svg>
            </span>
            <span className="flex-1 text-[13px] font-semibold">Photo mode</span>
            <kbd className="font-mono text-[10px] text-[#15171c]/40">F</kbd>
          </button>
          <button type="button" role="menuitemcheckbox" aria-checked={slowmo} onClick={toggleSlowmo} className={`${item} hover:bg-black/[0.05]`}>
            <span className="grid h-8 w-8 shrink-0 place-items-center rounded-[9px] bg-black/[0.05]">
              <svg aria-hidden width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="13" r="8" />
                <path d="M12 9v4l2.5 2.5M10 2.5h4" />
              </svg>
            </span>
            <span className="flex-1 text-[13px] font-semibold">Slow motion</span>
            <span className={`h-[18px] w-[30px] rounded-full p-[2px] transition-colors ${slowmo ? "bg-[#15171c]" : "bg-black/15"}`}>
              <span className={`block h-[14px] w-[14px] rounded-full bg-white transition-transform ${slowmo ? "translate-x-[12px]" : ""}`} />
            </span>
            <kbd className="font-mono text-[10px] text-[#15171c]/40">T</kbd>
          </button>
          <button type="button" role="menuitem" onClick={() => (brickStorm(), setOpen(false))} className={`${item} hover:bg-black/[0.05]`}>
            <span className="grid h-8 w-8 shrink-0 place-items-center rounded-[9px] bg-black/[0.05]">
              <svg aria-hidden width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M6.5 15a4.5 4.5 0 1 1 1.2-8.8A5.5 5.5 0 0 1 18 8a3.5 3.5 0 0 1 .5 7z" />
                <rect x="7" y="18" width="3.5" height="2.5" rx=".5" />
                <rect x="13.5" y="17" width="3.5" height="2.5" rx=".5" />
              </svg>
            </span>
            <span className="flex-1 text-[13px] font-semibold">Brick storm</span>
            <kbd className="font-mono text-[10px] text-[#15171c]/40">B</kbd>
          </button>
          <button type="button" role="menuitem" onClick={cycleTime} className={`${item} hover:bg-black/[0.05] sm:hidden`}>
            <span className="grid h-8 w-8 shrink-0 place-items-center rounded-[9px] bg-black/[0.05]">
              <LightIcon light={light} />
            </span>
            <span className="flex-1 text-[13px] font-semibold">{LIGHT_NAME[light]}</span>
            <span className="font-mono text-[10px] text-[#15171c]/40">tap to change</span>
          </button>
          <button type="button" role="menuitemcheckbox" aria-checked={sound} onClick={() => useLego.getState().set({ sound: !sound })} className={`${item} hover:bg-black/[0.05] sm:hidden`}>
            <span className="grid h-8 w-8 shrink-0 place-items-center rounded-[9px] bg-black/[0.05]">
              <svg aria-hidden width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M11 5 6 9H3v6h3l5 4z" />
                {sound ? <path d="M15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13" /> : <path d="m16 9 5 6M21 9l-5 6" />}
              </svg>
            </span>
            <span className="flex-1 text-[13px] font-semibold">{sound ? "Sound on" : "Sound off"}</span>
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
      <span aria-hidden className="relative h-[26px] w-[6px] overflow-hidden rounded-full bg-white/15">
        <span className="absolute inset-x-0 bottom-0 rounded-full transition-[height] duration-100" style={{ height: `${g * 100}%`, background: g < 0.04 ? SPACE_INK : "#ffffff", boxShadow: g < 0.04 ? `0 0 8px ${SPACE_INK}` : undefined }} />
      </span>
      <p className="text-[13px] leading-tight">
        <span className="display text-[17px] tabular-nums">{g.toFixed(2)}</span>
        <span className="text-white/55"> g</span>
        <span className="block font-mono text-[9.5px] uppercase tracking-[0.14em] text-white/55">{state}</span>
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

/** A row of studs, for anything that wants to look like it's made of bricks. */
function Studs({ n, color, className = "" }: { n: number; color: string; className?: string }) {
  return (
    <span aria-hidden className={`pointer-events-none absolute -top-[5px] left-0 right-0 flex justify-evenly ${className}`}>
      {Array.from({ length: n }, (_, i) => (
        <span
          key={i}
          className="h-[7px] w-[18px] rounded-t-[4px]"
          style={{ background: `linear-gradient(to bottom, color-mix(in oklab, ${color} 70%, white), ${color})`, boxShadow: "inset 0 -1px 0 rgba(0,0,0,.12)" }}
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
      className={`relative mt-[5px] inline-flex items-center justify-center gap-2 rounded-[7px] px-4 py-2.5 text-[13px] font-semibold tracking-[-0.01em] transition-[transform,filter] duration-150 hover:brightness-105 active:translate-y-[2px] disabled:opacity-50 ${className}`}
      style={{ background: color, color: ink, boxShadow: "inset 0 -3px 0 rgba(0,0,0,.18), inset 0 1px 0 rgba(255,255,255,.35), 0 8px 18px -10px rgba(20,25,35,.55)" }}
    >
      <Studs n={studs} color={color} />
      {children}
    </button>
  );
}

/** The site's logo, as a 2 × 4 brick seen from above. */
function BrickLogo() {
  return (
    <span aria-hidden className="grid h-[22px] w-[38px] grid-cols-4 grid-rows-2 place-items-center rounded-[4px] p-[3px]" style={{ background: C.red, boxShadow: "inset 0 -2px 0 rgba(0,0,0,.2)" }}>
      {Array.from({ length: 8 }, (_, i) => (
        <span key={i} className="h-[6px] w-[6px] rounded-full" style={{ background: "#e0331f", boxShadow: "inset -1px -1px 0 rgba(0,0,0,.25), inset 1px 1px 0 rgba(255,255,255,.3)" }} />
      ))}
    </span>
  );
}

function Card({ children, className = "", k, scroll }: { children: ReactNode; className?: string; k: string; scroll?: boolean }) {
  return (
    <div
      key={k}
      data-scroll={scroll || undefined}
      className={`sr-panel pointer-events-auto rounded-[20px] bg-white/85 p-5 text-[#15171c] shadow-[0_28px_70px_-30px_rgba(16,24,40,.55)] ring-1 ring-black/[0.06] backdrop-blur-xl md:p-6 ${className}`}
    >
      {children}
    </div>
  );
}

const Kicker = ({ children, color = C.red }: { children: ReactNode; color?: string }) => (
  <p className="flex items-center gap-2 font-mono text-[10.5px] uppercase tracking-[0.16em] text-[#15171c]/60">
    <span className="h-2 w-2 rounded-[2px]" style={{ background: color }} />
    {children}
  </p>
);

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
      className="fixed inset-0 h-dvh select-none overflow-hidden bg-[#e9eee9] text-[#15171c]"
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
        <div className="pointer-events-auto flex items-start gap-2">
          <Link href="/" className="flex items-center gap-3 rounded-full bg-white/80 py-2 pl-3 pr-4 shadow-[0_10px_30px_-18px_rgba(16,24,40,.6)] ring-1 ring-black/5 backdrop-blur-xl" aria-label={`${person.name} — back to the main site`}>
            <BrickLogo />
            <span className="display text-[15px] leading-none max-[420px]:hidden md:text-base">{person.shortName}</span>
            <span className="hidden rounded-full bg-[#15171c] px-2 py-1 font-mono text-[9.5px] uppercase leading-none tracking-[0.14em] text-[#f5cd2f] sm:inline">Brick edition</span>
          </Link>
          <CameraMenu cam={cam} slowmo={slowmo} sound={sound} light={light} />
        </div>

        <nav aria-label="Sections" className="pointer-events-auto absolute left-1/2 top-5 hidden -translate-x-1/2 gap-1 rounded-full bg-white/80 p-1 shadow-[0_10px_30px_-18px_rgba(16,24,40,.6)] ring-1 ring-black/5 backdrop-blur-xl lg:flex">
          {GROUPS.map((g) => {
            const on = g.has(stop);
            return (
              <button
                key={g.label}
                type="button"
                onClick={() => go(g.stop)}
                aria-current={on ? "true" : undefined}
                className={`rounded-full px-4 py-2 text-[13px] font-semibold transition-colors ${on ? "bg-[#15171c] text-white" : "text-[#15171c]/60 hover:bg-black/5 hover:text-[#15171c]"}`}
              >
                {g.label}
              </button>
            );
          })}
        </nav>

        <div className="pointer-events-auto flex items-center gap-1.5 sm:gap-2">
          <BrickButton color={C.yellow} onClick={rebuild} disabled={building} aria-label="Rebuild everything (R)" title="Rebuild (R)" className="max-sm:!px-3 lg:max-2xl:!px-3">
            <svg aria-hidden width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 12a9 9 0 1 0 3-6.7L3 8" />
              <path d="M3 3v5h5" />
            </svg>
            <span className="hidden sm:inline lg:hidden 2xl:inline">{building ? "Building…" : "Rebuild"}</span>
          </BrickButton>
          <BrickButton
            color={vacuum ? "#3dff86" : "#ffffff"}
            studs={2}
            onClick={toggleVacuum}
            aria-pressed={vacuum}
            aria-label={vacuum ? "Put the vacuum away (V)" : "Get the vacuum out (V)"}
            title="Vacuum (V)"
            className="max-sm:!px-3 lg:max-2xl:!px-3"
          >
            <svg aria-hidden width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M17 2.5v4.5" />
              <rect x="14.5" y="7" width="5" height="6.5" rx="2.2" />
              <path d="M17 13.5 9.5 19" />
              <path d="M4 19.5h8.5a1.5 1.5 0 0 0 0-3H6a2 2 0 0 0-2 2z" />
            </svg>
            <span className="hidden sm:inline lg:hidden 2xl:inline">{vacuum ? "Vacuuming" : "Vacuum"}</span>
          </BrickButton>
          <BrickButton
            color={paint ? PAINTS[paintColor].hex : "#ffffff"}
            ink={paint && paintColor >= 4 && paintColor <= 6 ? "#fff" : INK}
            studs={2}
            onClick={togglePaint}
            aria-pressed={paint}
            aria-label={paint ? "Put the paintball marker away (P)" : "Pick up the paintball marker (P)"}
            title="Paintball (P)"
            className="max-sm:!px-3 lg:max-2xl:!px-3"
          >
            <svg aria-hidden width="16" height="15" viewBox="0 0 26 24" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round">
              <path d="M2 10h17.5M19.5 8.6h4.5v2.8h-4.5" />
              <path d="M2.5 7.5h15v5.5H8.5l-1.5 8H3.5l1.4-8H2.5z" />
              <path d="M11 13v3.5h3" />
              <ellipse cx="12" cy="4.2" rx="4.4" ry="2.6" />
            </svg>
            <span className="hidden sm:inline lg:hidden 2xl:inline">{paint ? "Painting" : "Paintball"}</span>
          </BrickButton>
          <BrickButton
            color={zeroG ? SPACE : "#ffffff"}
            ink={zeroG ? SPACE_INK : INK}
            studs={2}
            onClick={toggleZeroG}
            aria-pressed={zeroG}
            aria-label={zeroG ? "Bring gravity back (G)" : "Switch gravity off (G)"}
            title="Zero gravity (G)"
            className="max-sm:!px-3 lg:max-2xl:!px-3"
          >
            <svg aria-hidden width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round">
              <circle cx="12" cy="12" r="3.6" />
              <ellipse cx="12" cy="12" rx="10" ry="4.2" transform="rotate(-28 12 12)" />
              <circle cx="20.9" cy="8.9" r="1.4" fill="currentColor" stroke="none" />
            </svg>
            <span className="hidden sm:inline lg:hidden 2xl:inline">{zeroG ? "Floating" : "Zero-G"}</span>
          </BrickButton>
          <BrickButton
            color={night ? "#1b2a5a" : golden ? GOLD : "#ffffff"}
            ink={night ? "#ffe3a6" : INK}
            studs={1}
            onClick={cycleTime}
            aria-label={`Light: ${LIGHT_NAME[light]} — switch to ${LIGHT_NAME[light === "day" ? "golden" : light === "golden" ? "night" : "day"]} (N)`}
            title={`${LIGHT_NAME[light]} (N)`}
            className="!px-3 max-sm:!hidden"
          >
            <LightIcon light={light} />
          </BrickButton>
          <BrickButton color="#ffffff" studs={1} onClick={() => useLego.getState().set({ sound: !sound })} aria-pressed={sound} aria-label={sound ? "Mute brick sounds" : "Unmute brick sounds"} className="!px-3 max-sm:!hidden">
            <svg aria-hidden width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
              <path d="M11 5 6 9H3v6h3l5 4z" />
              {sound ? <path d="M15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13" /> : <path d="m16 9 5 6M21 9l-5 6" />}
            </svg>
          </BrickButton>
          <Link
            href="/"
            className="relative mt-[5px] hidden items-center gap-1.5 rounded-[7px] bg-[#15171c] px-4 py-2.5 text-[13px] font-semibold text-white shadow-[inset_0_-3px_0_rgba(0,0,0,.4),0_8px_18px_-10px_rgba(20,25,35,.55)] md:inline-flex"
          >
            <Studs n={2} color="#2a2d35" />
            Exit
            <span aria-hidden>↗</span>
          </Link>
        </div>
      </header>

      {/* —— which camera is rolling (anything but the tour) —— */}
      {ui && cam !== "tour" && (
        <div key={cam} className="sr-rise pointer-events-auto absolute left-gutter top-[76px] z-10 hidden items-center gap-3 rounded-full bg-[#15171c]/80 py-1.5 pl-3 pr-1.5 text-white shadow-[0_10px_30px_-18px_rgba(16,24,40,.6)] backdrop-blur-xl md:top-[84px] md:flex">
          <span className="h-2 w-2 animate-pulse rounded-full bg-[#ff3b30] shadow-[0_0_8px_#ff3b30]" />
          <p className="font-mono text-[10px] uppercase leading-tight tracking-[0.14em]">
            {CAM[cam].label}
            <span className="block text-white/50">
              {cam === "chase" ? `Car ${(((chaseCar % 8) + 8) % 8) + 1} of 8 · ← → to switch` : cam === "orbit" ? "Drag to circle · scroll to zoom" : cam === "cinema" ? "Rolling on its own · scroll to steer" : CAM[cam].lens}
            </span>
          </p>
          {cam === "chase" && (
            <BrickButton color="#ffffff" onClick={() => useLego.getState().set({ chaseCar: chaseCar + 1 })} className="!mt-0 !py-1.5 !text-[12px]" studs={2} title="Ride another car (→)">
              Next car
            </BrickButton>
          )}
          <BrickButton color="#ffffff" onClick={() => setCam("tour")} className="!mt-0 !py-1.5 !text-[12px]" studs={2} title="Back to the tour">
            Exit
          </BrickButton>
        </div>
      )}

      {/* —— the panel for the current stop —— */}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 z-10 px-gutter pb-4 md:bottom-6 md:left-0 md:right-auto md:w-[min(440px,42vw)] md:pb-0">
        {ui && stop === 0 && (
          <Card k="hero">
            <Kicker>{person.role} · {person.location}</Kicker>
            <h1 className="display mt-3 text-[clamp(28px,3.2vw,44px)]">{beats.hero[0]}</h1>
            <p className="mt-3 hidden text-[14.5px] leading-relaxed text-[#15171c]/70 md:block">{person.intro}</p>
            <p className="mt-3 text-[14px] leading-relaxed text-[#15171c]/70 md:hidden">Everything here is built from bricks — and everything can be knocked down.</p>
            <div className="mt-4 flex flex-wrap items-center gap-2">
              <BrickButton color={C.red} ink="#fff" onClick={() => go(1)} studs={3}>
                See the work <span aria-hidden>→</span>
              </BrickButton>
              <span className="font-mono text-[10.5px] uppercase tracking-[0.12em] text-[#15171c]/50">or scroll</span>
            </div>
          </Card>
        )}

        {ui && stop === 1 && (
          <Card k="projects">
            <Kicker color={C.blue}>Selected work · {pad(projects.length)} builds</Kicker>
            <h2 className="display mt-3 text-[clamp(26px,2.8vw,40px)]">Six systems, built brick by brick.</h2>
            <p className="mt-3 text-[14.5px] leading-relaxed text-[#15171c]/70">Each one stands on its own plinth. Scroll to walk the line, click a poster to open its file — or knock it over first.</p>
            <ol className="mt-4 grid grid-cols-2 gap-x-4 gap-y-1.5">
              {projects.map((p, i) => (
                <li key={p.slug}>
                  <button type="button" onClick={() => go(PROJECT0 + i)} className="group flex w-full items-center gap-2 text-left text-[13px] font-medium">
                    <span className="h-2.5 w-2.5 shrink-0 rounded-[2px]" style={{ background: TINT[p.slug] }} />
                    <span className="truncate group-hover:underline">{p.title}</span>
                  </button>
                </li>
              ))}
            </ol>
          </Card>
        )}

        {ui && project && (
          <Card k={project.slug} className="max-md:max-h-[46dvh] max-md:overflow-y-auto" scroll>
            <div className="flex items-center justify-between gap-3">
              <Kicker color={TINT[project.slug]}>
                {pad(pi + 1)} / {pad(projects.length)} · {project.category}
              </Kicker>
              <div className="flex gap-1">
                <button type="button" onClick={() => step(-1)} aria-label="Previous" className="h-8 w-8 rounded-full text-[#15171c]/60 ring-1 ring-black/10 transition-colors hover:bg-black/5 hover:text-[#15171c]">←</button>
                <button type="button" onClick={() => step(1)} aria-label="Next" className="h-8 w-8 rounded-full text-[#15171c]/60 ring-1 ring-black/10 transition-colors hover:bg-black/5 hover:text-[#15171c]">→</button>
              </div>
            </div>
            <h2 className="display mt-3 text-[clamp(30px,3.4vw,50px)]">{project.title}</h2>
            <p className="mt-3 text-[15px] leading-snug text-[#15171c]/75">{project.tagline}</p>
            {project.metrics && (
              <dl className="mt-4 grid grid-cols-3 gap-2">
                {project.metrics.map((m) => (
                  <div key={m.label} className="rounded-[10px] bg-[#15171c]/[0.04] px-3 py-2.5">
                    <dt className="sr-only">{m.label}</dt>
                    <dd className="display text-[22px]">{m.value}</dd>
                    <dd className="mt-1 text-[11px] leading-tight text-[#15171c]/55">{m.label}</dd>
                  </div>
                ))}
              </dl>
            )}
            <ul className="mt-3 flex flex-wrap gap-1.5">
              {project.stack.map((s) => (
                <li key={s} className="rounded-full px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.08em] text-[#15171c]/70 ring-1 ring-black/10">
                  {s}
                </li>
              ))}
            </ul>
            <div className="mt-4 flex flex-wrap items-center gap-2">
              <BrickButton color={TINT[project.slug]} studs={3} onClick={() => router.push(`/projects/${project.slug}`)}>
                Open the case study
              </BrickButton>
              {project.link && (
                <a href={project.link} target="_blank" rel="noreferrer" className="text-[13px] font-semibold underline decoration-black/20 underline-offset-4 hover:decoration-black/60">
                  {host(project.link)} ↗
                </a>
              )}
            </div>
          </Card>
        )}

        {ui && stop === ABOUT && (
          <Card k="about">
            <Kicker color={C.darkTurquoise}>About</Kicker>
            <h2 className="display mt-3 text-[clamp(28px,3vw,44px)]">{about.headline}</h2>
            {about.body.map((b) => (
              <p key={b} className="mt-3 text-[14px] leading-relaxed text-[#15171c]/70 max-md:[&:not(:first-of-type)]:hidden">
                {b}
              </p>
            ))}
            <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-2.5 border-t border-black/[0.07] pt-4">
              {about.annotations.map((a) => (
                <div key={a.label}>
                  <dt className="font-mono text-[10px] uppercase tracking-[0.14em] text-[#15171c]/45">{a.label}</dt>
                  <dd className="text-[13.5px] font-semibold">{a.value}</dd>
                </div>
              ))}
            </dl>
          </Card>
        )}

        {ui && stop === CONTACT && (
          <Card k="contact">
            <Kicker color={C.lime}>{contact.label}</Kicker>
            <h2 className="display mt-3 text-[clamp(28px,3vw,44px)]">{contact.heading}</h2>
            <p className="mt-3 text-[14px] leading-relaxed text-[#15171c]/70">{contact.note}</p>
            <div className="mt-4 flex flex-wrap items-center gap-2">
              <BrickButton
                color="#15171c"
                ink={C.lime}
                studs={4}
                onClick={async () => {
                  const ok = await copy(person.email);
                  useApp.getState().set({ toast: ok ? "Email copied to clipboard" : person.email });
                }}
              >
                {person.email}
              </BrickButton>
              {person.socials.map((s) => (
                <a key={s.label} href={s.href} target="_blank" rel="noreferrer" className="px-1 text-[13px] font-semibold underline decoration-black/20 underline-offset-4 hover:decoration-black/60">
                  {s.label} ↗
                </a>
              ))}
            </div>
            <p className="mt-4 font-mono text-[10px] uppercase tracking-[0.14em] text-[#15171c]/40">© {contact.year} {person.name} · Built with three.js and Rapier</p>
          </Card>
        )}
      </div>

      {/* —— bottom right: how to play, and the damage done —— */}
      {ui && (
        <div className="pointer-events-none absolute bottom-6 right-gutter z-10 hidden flex-col items-end gap-2 md:flex">
          {slowmo && (
            <div key="slowmo" className="sr-rise pointer-events-auto flex items-center gap-3 rounded-full bg-[#15171c]/85 py-1.5 pl-4 pr-1.5 text-white shadow-[0_10px_30px_-18px_rgba(16,24,40,.6)] backdrop-blur-xl">
              <p className="text-[13px]">
                <span className="display text-[17px] tabular-nums">0.2×</span>
                <span className="text-white/55"> slow motion</span>
              </p>
              <BrickButton color="#ffffff" onClick={toggleSlowmo} className="!mt-0 !py-1.5 !text-[12px]" studs={2} title="Back to real time (T)">
                Real time
              </BrickButton>
            </div>
          )}
          {(zeroG || gravity < 1) && (
            <div key="zerog" className="sr-rise pointer-events-auto flex items-center gap-4 rounded-full py-1.5 pl-4 pr-1.5 text-white shadow-[0_10px_30px_-18px_rgba(16,24,40,.6)] backdrop-blur-xl" style={{ background: `color-mix(in oklab, ${SPACE} 88%, transparent)` }}>
              <GravityGauge g={gravity} on={zeroG} />
              <BrickButton color={zeroG ? "#ffffff" : SPACE_INK} onClick={toggleZeroG} disabled={!zeroG} className="!mt-0 !py-1.5 !text-[12px]" studs={2} title="Bring gravity back (G)">
                Gravity on
              </BrickButton>
            </div>
          )}
          {paint && (
            <div key="paint" className="sr-rise pointer-events-auto flex items-center gap-3 rounded-full bg-[#15171c]/85 py-1.5 pl-4 pr-1.5 text-white shadow-[0_10px_30px_-18px_rgba(16,24,40,.6)] backdrop-blur-xl">
              <p className="text-[13px] tabular-nums">
                <span className="display text-[17px]">{ammo < 0 ? "··" : ammo}</span>
                <span className="text-white/55"> {ammo < 0 ? "loading" : "balls"} · {splats} splats</span>
              </p>
              <div role="radiogroup" aria-label="Paint colour" className="flex items-center gap-1">
                {PAINTS.map((c, i) => (
                  <button
                    key={c.hex}
                    type="button"
                    role="radio"
                    aria-checked={i === paintColor}
                    aria-label={`${c.name} (${i + 1})`}
                    title={`${c.name} (${i + 1})`}
                    onClick={() => useLego.getState().set({ paintColor: i })}
                    className={`h-[18px] w-[18px] rounded-full transition-transform duration-150 hover:scale-110 ${i === paintColor ? "scale-110 ring-2 ring-white ring-offset-2 ring-offset-[#15171c]" : ""}`}
                    style={{ background: `radial-gradient(circle at 35% 30%, color-mix(in oklab, ${c.hex} 55%, white), ${c.hex} 60%)`, boxShadow: "inset 0 -2px 3px rgba(0,0,0,.25)" }}
                  />
                ))}
              </div>
              <BrickButton color="#ffffff" onClick={() => useLego.getState().set({ washTick: useLego.getState().washTick + 1 })} disabled={!splats} className="!mt-0 !py-1.5 !text-[12px]" studs={2} title="Wash the paint off (C)">
                Wash
              </BrickButton>
            </div>
          )}
          {vacuum && (
            <div key="sucked" className="sr-rise pointer-events-none flex items-center gap-2.5 rounded-full bg-[#15171c]/85 py-2 pl-3 pr-4 text-white shadow-[0_10px_30px_-18px_rgba(16,24,40,.6)] backdrop-blur-xl">
              <span className="h-2 w-2 animate-pulse rounded-full bg-[#3dff86] shadow-[0_0_10px_#3dff86]" />
              <p className="text-[13px]">
                <span className="display text-[17px] tabular-nums">{sucked}</span>
                <span className="text-white/60"> {sucked === 1 ? "brick" : "bricks"} in the bin</span>
              </p>
            </div>
          )}
          {knocked > 0 && (
            <div key="knocked" className="sr-rise pointer-events-auto flex items-center gap-3 rounded-full bg-white/85 py-1.5 pl-4 pr-1.5 shadow-[0_10px_30px_-18px_rgba(16,24,40,.6)] ring-1 ring-black/5 backdrop-blur-xl">
              <p className="text-[13px]">
                <span className="display text-[17px] tabular-nums">{knocked}</span>
                <span className="text-[#15171c]/55"> of {total} bricks knocked loose</span>
              </p>
              <BrickButton color={C.yellow} onClick={rebuild} disabled={building} className="!mt-0 !py-1.5 !text-[12px]" studs={2}>
                Rebuild
              </BrickButton>
            </div>
          )}
          {zeroG && !paint && !vacuum ? (
            <p key="zg-hint" className={`rounded-full px-4 py-2 font-mono text-[10.5px] uppercase tracking-[0.12em] text-white/85 backdrop-blur transition-opacity duration-700 ${throws > 8 ? "opacity-0" : "opacity-100"}`} style={{ background: `color-mix(in oklab, ${SPACE} 80%, transparent)` }}>
              Click to throw — no arc, it flies dead straight · G brings gravity back · R rebuilds
            </p>
          ) : paint ? (
            <p key="paint-hint" className={`rounded-full bg-[#15171c]/80 px-4 py-2 font-mono text-[10.5px] uppercase tracking-[0.12em] text-white/85 backdrop-blur transition-opacity duration-700 ${fired > 40 ? "opacity-0" : "opacity-100"}`}>
              Click to fire · Hold for full auto · 1–8 paint · C washes it off · P to put it down
            </p>
          ) : vacuum ? (
            <p key="vac-hint" className="rounded-full bg-[#15171c]/80 px-4 py-2 font-mono text-[10.5px] uppercase tracking-[0.12em] text-white/85 backdrop-blur">
              Move to steer · Hold to boost · R puts it all back · V to stop
            </p>
          ) : (
            <p className={`rounded-full bg-[#15171c]/80 px-4 py-2 font-mono text-[10.5px] uppercase tracking-[0.12em] text-white/85 backdrop-blur transition-opacity duration-700 ${throws > 2 ? "opacity-0" : "opacity-100"}`}>
              Click to throw a brick · Drag to look · Scroll to explore · K for cameras · F for photo mode · B for a brick storm
            </p>
          )}
        </div>
      )}

      {/* —— progress rail (stops) —— */}
      {ui && (
        <div aria-hidden className="pointer-events-none absolute right-gutter top-1/2 z-10 hidden -translate-y-1/2 flex-col items-center gap-2 lg:flex">
          {Array.from({ length: count }, (_, i) => (
            <span key={i} className="block rounded-full transition-all duration-500" style={{ width: 8, height: i === stop ? 22 : 8, background: i === stop ? C.red : "rgba(21,23,28,.22)" }} />
          ))}
        </div>
      )}

      {/* —— mobile: a hint under the panel —— */}
      {ui && vacuum && (
        <p className="pointer-events-none absolute inset-x-0 top-[72px] z-10 text-center font-mono text-[10px] uppercase tracking-[0.14em] text-[#15171c]/60 md:hidden">
          Drag to vacuum · {sucked} in the bin
        </p>
      )}
      {ui && paint && (
        <div className="pointer-events-auto absolute inset-x-0 top-[72px] z-10 flex flex-col items-center gap-2 md:hidden">
          <div className="flex gap-1.5 rounded-full bg-[#15171c]/80 p-1.5 backdrop-blur">
            {PAINTS.map((c, i) => (
              <button
                key={c.hex}
                type="button"
                aria-label={c.name}
                onClick={() => useLego.getState().set({ paintColor: i })}
                className={`h-6 w-6 rounded-full ${i === paintColor ? "ring-2 ring-white ring-offset-2 ring-offset-[#15171c]" : ""}`}
                style={{ background: c.hex }}
              />
            ))}
          </div>
          <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-[#15171c]/60">Tap to fire · Hold for full auto · {splats} splats</p>
        </div>
      )}
      {ui && zeroG && !vacuum && !paint && (
        <p className="pointer-events-none absolute inset-x-0 top-[72px] z-10 text-center font-mono text-[10px] uppercase tracking-[0.14em] text-[#15171c]/60 md:hidden">
          {gravity.toFixed(2)} g · {gravity > 0.04 ? "gravity fading" : "weightless"} · tap to throw
        </p>
      )}
      {ui && !vacuum && !paint && !zeroG && throws === 0 && (
        <p className="pointer-events-none absolute inset-x-0 top-[72px] z-10 text-center font-mono text-[10px] uppercase tracking-[0.14em] text-[#15171c]/60 md:hidden">Tap to throw · Swipe to move</p>
      )}

      {/* —— loader —— */}
      <div
        aria-hidden={shown}
        className={`absolute inset-0 z-30 flex flex-col items-center justify-center gap-6 bg-[#e9eee9] transition-opacity duration-700 ${shown ? "pointer-events-none opacity-0" : "opacity-100"}`}
      >
        <div className="relative flex h-16 items-end gap-1">
          {[C.red, C.yellow, C.blue, C.lime].map((c, i) => (
            <span
              key={c}
              className="lego-loader-brick relative block h-5 w-10 rounded-[3px]"
              style={{ background: c, animationDelay: `${i * 0.18}s`, boxShadow: "inset 0 -3px 0 rgba(0,0,0,.18)" }}
            >
              <Studs n={2} color={c} className="!-top-[4px]" />
            </span>
          ))}
        </div>
        <div className="text-center">
          <p className="display text-2xl">Sorting the bricks</p>
          <p className="mt-2 font-mono text-[11px] uppercase tracking-[0.16em] text-[#15171c]/55">{Math.round(progress * 100)}%</p>
        </div>
      </div>
    </div>
  );
}
