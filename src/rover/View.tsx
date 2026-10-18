"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { SPEEDS } from "./physics";
import { CAMS, SCALES, WARPS, control, useRover, type FeedItem } from "./store";
import { MOONS, PLANET_IDS, dateOf, fmtDate, launchWindow, planetPos } from "./ephemeris";
import { EARTH_G, WORLDS, commDelay, hohmannDv, worldById, type PlanetLook, type World } from "./worlds";

const Scene = dynamic(() => import("./Scene"), { ssr: false });

const ACCENT = "#c8ff3d";
const WARN = "#ffb020";
const mono = { fontFamily: "var(--font-jetbrains), ui-monospace, monospace" } as const;
const helioOf = (w: World) => (w.parent ? WORLDS.find((p) => p.name === w.parent)! : w);

const fmt = (n: number, d = 0) => n.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });
const fmtTemp = (c: number) => `${c > 0 ? "+" : ""}${fmt(c)} °C`;
function fmtPressure(bar: number) {
  if (bar === 0) return "vacuum";
  if (bar < 0.001) return `${fmt(bar * 1e6, 0)} µbar`;
  if (bar < 0.1) return `${fmt(bar * 1000, 1)} mbar`;
  return `${fmt(bar, bar < 10 ? 2 : 0)} bar`;
}
function fmtDelay(min: number) {
  if (min === 0) return "—";
  if (min < 1) return `${fmt(min * 60, 2)} s`;
  if (min < 90) return `${fmt(min, 1)} min`;
  return `${fmt(min / 60, 1)} h`;
}
function fmtDays(d: number) {
  if (d < 30) return `${fmt(d, 0)} days`;
  if (d < 730) return `${fmt(d / 30.44, 1)} months`;
  return `${fmt(d / 365.25, 1)} years`;
}

function Panel({ children, className = "", style }: { children: React.ReactNode; className?: string; style?: React.CSSProperties }) {
  return (
    <div
      className={`rover-panel pointer-events-auto rounded-2xl border border-white/[0.08] bg-[linear-gradient(180deg,rgba(24,28,37,.78),rgba(9,11,16,.74))] shadow-[inset_0_1px_0_rgba(255,255,255,.07),0_30px_80px_-30px_rgba(0,0,0,.95)] backdrop-blur-xl backdrop-saturate-150 ${className}`}
      style={style}
    >
      {children}
    </div>
  );
}

function Stat({ k, v, sub }: { k: string; v: string; sub?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-white/[0.06] py-[6px] last:border-0">
      <span className="text-[10px] uppercase tracking-[0.14em] text-white/45">{k}</span>
      <span className="text-right text-[12px] text-white/90 tabular-nums" style={mono}>
        {v}
        {sub && <span className="ml-1 text-white/40">{sub}</span>}
      </span>
    </div>
  );
}

function Btn({ onClick, children, active, title, className = "" }: { onClick: () => void; children: React.ReactNode; active?: boolean; title?: string; className?: string }) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      onClick={() => {
        control.unlock();
        onClick();
      }}
      className={`pointer-events-auto flex h-9 items-center justify-center gap-1.5 rounded-xl px-3 text-[11px] font-semibold uppercase tracking-[0.12em] transition-[background,color,box-shadow,transform] active:scale-[0.97] ${active ? "bg-[#c8ff3d] text-[#0b0d12] shadow-[0_0_24px_-8px_rgba(200,255,61,.8)]" : "bg-[#0b0d12]/60 text-white/80 ring-1 ring-inset ring-white/10 backdrop-blur hover:bg-white/[0.08] hover:text-white hover:ring-white/20"} ${className}`}
      style={mono}
    >
      {children}
    </button>
  );
}

const ICONS: Record<string, React.ReactNode> = {
  rew: <path d="M11.5 6.5 5 12l6.5 5.5zM19 6.5 12.5 12l6.5 5.5z" fill="currentColor" />,
  ff: <path d="M5 6.5 11.5 12 5 17.5zM12.5 6.5 19 12l-6.5 5.5z" fill="currentColor" />,
  play: <path d="M8 5.5v13l10.5-6.5z" fill="currentColor" />,
  pause: <path d="M7 5.5h3.5v13H7zM13.5 5.5H17v13h-3.5z" fill="currentColor" />,
  now: (
    <g fill="none" stroke="currentColor" strokeWidth="1.8">
      <circle cx="12" cy="12" r="7" />
      <circle cx="12" cy="12" r="2" fill="currentColor" />
      <path d="M12 2v3M12 19v3M2 12h3M19 12h3" />
    </g>
  ),
  orbit: (
    <g fill="none" stroke="currentColor" strokeWidth="1.6">
      <circle cx="12" cy="12" r="2.6" fill="currentColor" />
      <ellipse cx="12" cy="12" rx="9.5" ry="4.5" transform="rotate(-20 12 12)" />
    </g>
  ),
  left: <path d="m14.5 6-6 6 6 6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />,
  right: <path d="m9.5 6 6 6-6 6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />,
  arrow: <path d="M4 12h15m-5-6 6 6-6 6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />,
  pin: (
    <g fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M12 21s-6.5-5.7-6.5-11a6.5 6.5 0 1 1 13 0c0 5.3-6.5 11-6.5 11z" />
      <circle cx="12" cy="10" r="2.2" />
    </g>
  ),
  signal: (
    <g fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
      <path d="M5 19a10 10 0 0 1 0-14M19 5a10 10 0 0 1 0 14M8.5 15.5a5 5 0 0 1 0-7M15.5 8.5a5 5 0 0 1 0 7" />
      <circle cx="12" cy="12" r="1.4" fill="currentColor" />
    </g>
  ),
};

function Icon({ name, size = 14 }: { name: keyof typeof ICONS; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden className="shrink-0">
      {ICONS[name]}
    </svg>
  );
}

function rgba(hex: string, a: number) {
  let h = hex.replace("#", "");
  if (h.length === 3) h = [...h].map((c) => c + c).join("");
  const n = parseInt(h, 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

/** a painted miniature of each world's surface: maria, bands, caps and clouds, as the 3D shader does it */
function surfaceOf(l: PlanetLook) {
  const blob = (w: number, h: number, x: number, y: number, c: string, soft = 62) => `radial-gradient(ellipse ${w}% ${h}% at ${x}% ${y}%, ${c} 0 40%, transparent ${soft}%)`;
  switch (l.kind) {
    case "banded":
      return [
        l.spot ? blob(16, 8, 60, 63, l.spot, 75) : "",
        `linear-gradient(176deg, ${l.c2} 0%, ${l.c1} 8%, ${l.c3} 15%, ${l.c3} 19%, ${l.c2} 25%, ${l.c1} 31%, ${l.c3} 38%, ${l.c3} 44%, ${l.c1} 50%, ${l.c2} 56%, ${l.c3} 62%, ${l.c1} 69%, ${l.c3} 76%, ${l.c2} 83%, ${l.c1} 91%, ${l.c2} 100%)`,
      ];
    case "earth":
      return [
        blob(70, 16, 50, 0, "#f4f8ff", 70),
        blob(38, 9, 38, 30, rgba(l.c3, 0.8), 75),
        blob(46, 8, 66, 68, rgba(l.c3, 0.7), 75),
        blob(26, 10, 26, 84, rgba(l.c3, 0.55), 75),
        blob(20, 32, 32, 52, l.c2),
        blob(20, 22, 68, 40, "#9a8550"),
        blob(14, 14, 60, 82, l.c2),
        `radial-gradient(circle at 45% 45%, ${l.c1}, #0b2a58)`,
      ];
    case "rocky":
      return [
        blob(44, 12, 50, 1, l.c3, 70),
        blob(30, 12, 50, 99, rgba(l.c3, 0.8), 70),
        blob(30, 14, 36, 48, rgba(l.c2, 0.85), 70),
        blob(18, 22, 66, 58, rgba(l.c2, 0.7), 70),
        blob(40, 10, 54, 30, rgba(l.c2, 0.4), 80),
        `radial-gradient(circle at 45% 45%, ${l.c1}, ${l.c2})`,
      ];
    case "cratered":
      return [
        blob(9, 9, 64, 30, rgba(l.c3, 0.9), 55),
        blob(6, 6, 30, 66, rgba(l.c3, 0.8), 55),
        blob(7, 7, 74, 72, rgba(l.c2, 0.9), 55),
        blob(26, 20, 40, 34, rgba(l.c2, 0.75), 70),
        blob(20, 16, 58, 58, rgba(l.c2, 0.6), 70),
        `radial-gradient(circle at 40% 40%, ${l.c3}, ${l.c1} 55%, ${l.c2})`,
      ];
    case "icy":
      return [
        blob(22, 24, 64, 60, l.c3, 66),
        blob(26, 16, 28, 62, rgba(l.c2, 0.85), 70),
        `radial-gradient(circle at 45% 40%, ${l.c3}, ${l.c1} 50%, ${l.c2})`,
      ];
    default:
      // cloudy and haze: soft, low-contrast cloud decks
      return [blob(60, 14, 40, 36, rgba(l.c3, 0.7), 80), blob(70, 12, 58, 70, rgba(l.c2, 0.5), 85), `linear-gradient(168deg, ${l.c3}, ${l.c1} 35%, ${l.c2} 65%, ${l.c1} 85%, ${l.c2})`];
  }
}

function PlanetDot({ w, size = 16 }: { w: World; size?: number }) {
  const l = w.look;
  const ring = l.rings;
  const ringStyle = (front: boolean): React.CSSProperties => ({
    position: "absolute",
    left: "50%",
    top: "50%",
    width: size * (size < 30 ? 1.75 : 2),
    height: size * (size < 30 ? 0.52 : 0.6),
    borderRadius: "50%",
    transform: "translate(-50%, -50%) rotate(-16deg)",
    clipPath: front ? "inset(50% 0 0 0)" : "inset(0 0 50% 0)",
    background: `radial-gradient(closest-side, transparent 54%, ${rgba(l.c3, 0.55)} 58%, ${rgba(l.c2, 0.8)} 70%, ${rgba(l.c2, 0.15)} 73%, ${rgba(l.c1, 0.75)} 77%, ${rgba(l.c3, 0.5)} 92%, transparent 100%)`,
  });
  return (
    <span aria-hidden className="relative inline-block shrink-0" style={{ width: size, height: size }}>
      {ring && <span style={ringStyle(false)} />}
      <span
        className="absolute inset-0 rounded-full"
        style={{
          backgroundImage: [
            `radial-gradient(circle at 34% 30%, rgba(255,255,255,.3), rgba(255,255,255,0) 34%)`,
            `radial-gradient(circle at 30% 28%, rgba(0,0,0,0) 40%, rgba(0,0,0,.5) 66%, rgba(0,0,0,.93) 98%)`,
            ...surfaceOf(l).filter(Boolean),
          ].join(","),
          boxShadow: l.rimK > 0 ? `0 0 ${Math.max(3, size * 0.22)}px ${rgba(l.rim, 0.3 * l.rimK)}, inset ${size * 0.05}px ${size * 0.05}px ${size * 0.12}px ${rgba(l.rim, 0.55 * l.rimK)}` : "0 0 0 0.5px rgba(255,255,255,.06)",
        }}
      />
      {ring && <span style={ringStyle(true)} />}
    </span>
  );
}

// ———————————————————————————— mission select ————————————————————————————

const LIGHT_MIN_PER_AU = 8.3167;
const MAX_G = Math.max(...WORLDS.map((w) => w.g));

function Tile({ k, v, sub, bar, children }: { k: string; v: string; sub?: string; bar?: number; children?: React.ReactNode }) {
  return (
    <div className="min-w-0 rounded-xl bg-white/[0.035] p-3 ring-1 ring-inset ring-white/[0.05]">
      <p className="text-[9.5px] uppercase tracking-[0.16em] text-white/45" style={mono}>
        {k}
      </p>
      <p className="mt-1 truncate text-[17px] font-semibold leading-tight tracking-tight text-white tabular-nums">{v}</p>
      {sub && (
        <p className="mt-0.5 truncate text-[10.5px] text-white/45" title={sub}>
          {sub}
        </p>
      )}
      {bar !== undefined && (
        <div className="mt-2 h-1 overflow-hidden rounded-full bg-white/[0.08]">
          <div className="h-full rounded-full" style={{ width: `${Math.max(3, Math.min(1, bar) * 100)}%`, background: `linear-gradient(90deg, ${rgba(ACCENT, 0.5)}, ${ACCENT})` }} />
        </div>
      )}
      {children}
    </div>
  );
}

function WorldPicker() {
  const selected = useRover((s) => s.selected);
  const hover = useRover((s) => s.hover);
  const current = useRover((s) => s.world);
  const jd = useRover((s) => s.jd);
  const [tab, setTab] = useState<"mission" | "world">("mission");
  const w = worldById[hover ?? selected];
  const from = current ? worldById[current] : worldById.earth;
  const local = helioOf(from).id === helioOf(w).id;
  const day = Math.floor(jd);
  // live geometry from the ephemeris, and the next real launch window from where you are
  const live = useMemo(() => {
    const p = planetPos(helioOf(w).id, day);
    const e = planetPos("earth", day);
    const sun = p.length();
    const earth = w.id === "moon" ? 384400 / 149597870.7 : w.id === "earth" ? 0 : p.distanceTo(e);
    return { sun, earth };
  }, [w, day]);
  const win = useMemo(() => (local ? null : launchWindow(helioOf(from).id, helioOf(w).id, day)), [local, from, w, day]);
  const days = local ? (w.id === from.id ? 0 : w.id === "moon" || from.id === "moon" ? 3 : 8) : win!.days;
  const dv = local ? 3.1 : hohmannDv(win!.a1, win!.a2);
  const [dmin, dmax] = commDelay(w);
  const delayNow = live.earth * LIGHT_MIN_PER_AU;
  const idx = WORLDS.findIndex((x) => x.id === w.id);
  const step = (d: number) => control.select(WORLDS[(idx + d + WORLDS.length) % WORLDS.length].id);
  const here = w.id === from.id;
  const gEarth = w.g / EARTH_G;
  return (
    <>
      <Panel className="absolute left-4 top-[76px] w-[256px] overflow-hidden max-md:hidden">
        <div className="flex items-center justify-between px-4 pb-2 pt-3.5">
          <p className="text-[10px] uppercase tracking-[0.2em] text-white/45" style={mono}>
            Destinations
          </p>
          <p className="text-[10px] text-white/30" style={mono}>
            {WORLDS.length} worlds
          </p>
        </div>
        <ul className="max-h-[calc(100vh-260px)] overflow-y-auto px-2 pb-2 [scrollbar-width:thin]">
          {WORLDS.map((x) => {
            const on = selected === x.id;
            return (
              <li key={x.id} className="relative">
                {x.parent && <span aria-hidden className="absolute bottom-1/2 left-[19px] top-[-6px] w-2.5 rounded-bl-md border-b border-l border-white/15" />}
                <button
                  type="button"
                  onMouseEnter={() => useRover.getState().set({ hover: x.id })}
                  onMouseLeave={() => useRover.getState().set({ hover: null })}
                  onClick={() => control.select(x.id)}
                  className={`group relative flex w-full items-center gap-3 rounded-xl py-[7px] pr-2.5 text-left transition-colors ${x.parent ? "pl-8" : "pl-2.5"} ${on ? "bg-white/[0.09] ring-1 ring-inset ring-white/10" : "hover:bg-white/[0.045]"}`}
                >
                  {on && <span aria-hidden className="absolute -left-2 top-1/2 h-5 w-[3px] -translate-y-1/2 rounded-r-full" style={{ background: ACCENT, boxShadow: `0 0 10px ${ACCENT}` }} />}
                  <PlanetDot w={x} size={x.parent ? 15 : 20} />
                  <span className="min-w-0 flex-1">
                    <span className={`block truncate text-[13px] leading-tight ${on ? "font-medium text-white" : "text-white/75 group-hover:text-white"}`}>{x.name}</span>
                    <span className="block text-[9.5px] leading-tight text-white/35" style={mono}>
                      {x.parent ? `moon of ${x.parent}` : `${x.au.toFixed(2)} AU`}
                      {current === x.id && <span style={{ color: ACCENT }}> · rover here</span>}
                    </span>
                  </span>
                  <span className="flex w-11 flex-col items-end gap-1">
                    <span className={`text-[10px] tabular-nums ${on ? "text-white/80" : "text-white/45"}`} style={mono}>
                      {(x.g / EARTH_G).toFixed(2)}g
                    </span>
                    <span className="h-[2px] w-full overflow-hidden rounded-full bg-white/[0.08]">
                      <span className="block h-full rounded-full" style={{ width: `${Math.max(4, (x.g / MAX_G) * 100)}%`, background: on ? ACCENT : "rgba(255,255,255,.35)" }} />
                    </span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </Panel>

      <Panel className="absolute bottom-4 right-4 flex max-h-[calc(100vh-92px)] w-[min(384px,calc(100vw-32px))] flex-col overflow-hidden max-md:left-4 max-md:max-h-[56vh]">
        {/* header: the world, with a lit globe */}
        <div className="relative shrink-0 overflow-hidden px-5 pb-4 pt-5">
          <div aria-hidden className="pointer-events-none absolute -right-10 -top-12 h-48 w-48 rounded-full opacity-40 blur-3xl" style={{ background: w.look.c1 }} />
          <div className="relative flex items-start gap-4">
            <span className={`mt-0.5 ${w.look.rings ? "mx-[24px]" : ""}`}>
              <PlanetDot w={w} size={58} />
            </span>
            <div className="min-w-0 flex-1">
              <p className="flex items-center gap-1.5 text-[10px] uppercase tracking-[0.18em] text-white/50" style={mono}>
                {w.kind}
                {w.parent ? ` · ${w.parent}` : ""}
                {current === w.id && (
                  <span className="rounded-full px-1.5 py-px text-[8.5px] font-bold tracking-[0.12em] text-[#0b0d12]" style={{ background: ACCENT }}>
                    You are here
                  </span>
                )}
              </p>
              <h2 className="mt-0.5 text-[28px] font-semibold leading-none tracking-tight text-white">{w.name}</h2>
              <p className="mt-2 flex items-start gap-1 text-[11.5px] leading-snug text-white/55">
                <span className="mt-px text-white/40">
                  <Icon name="pin" size={12} />
                </span>
                {w.site}
              </p>
            </div>
            <div className="flex gap-1">
              {(["left", "right"] as const).map((d) => (
                <button
                  key={d}
                  type="button"
                  aria-label={d === "left" ? "Previous world" : "Next world"}
                  onClick={() => step(d === "left" ? -1 : 1)}
                  className="flex h-7 w-7 items-center justify-center rounded-lg text-white/50 ring-1 ring-inset ring-white/10 transition-colors hover:bg-white/10 hover:text-white"
                >
                  <Icon name={d} size={14} />
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-1 [scrollbar-width:thin]">
          {/* key numbers */}
          <div className="grid grid-cols-2 gap-2">
            <Tile k="Gravity" v={`${gEarth.toFixed(2)} g`} sub={`${w.g} m/s² · rover ${fmt(899 * gEarth)} kgf`} bar={w.g / MAX_G} />
            <Tile k="Surface" v={fmtTemp(w.atm.tempC)} sub={w.atm.tempRange} />
            <Tile k="Pressure" v={fmtPressure(w.atm.pressureBar)} sub={w.surface === "deck" ? "no solid surface" : w.atm.pressureBar > 0 ? `${fmt((w.atm.pressureBar / 1.013) * 100, w.atm.pressureBar < 0.1 ? 2 : 0)}% of Earth` : "airless"} />
            <Tile k="Day" v={w.dayLength.replace(/\s*\(.*\)/, "")} sub={`${fmt(w.radiusKm)} km radius`} />
          </div>

          {/* tabs */}
          <div className="relative mt-4 grid grid-cols-2 rounded-xl bg-white/[0.04] p-1 ring-1 ring-inset ring-white/[0.05]">
            <span aria-hidden className="absolute bottom-1 top-1 w-[calc(50%-4px)] rounded-lg bg-white/[0.1] shadow-[inset_0_1px_0_rgba(255,255,255,.08)] transition-transform duration-300" style={{ left: 4, transform: tab === "world" ? "translateX(100%)" : "none" }} />
            {(["mission", "world"] as const).map((t) => (
              <button key={t} type="button" onClick={() => setTab(t)} className={`relative py-1.5 text-[10.5px] font-semibold uppercase tracking-[0.14em] transition-colors ${tab === t ? "text-white" : "text-white/45 hover:text-white/75"}`} style={mono}>
                {t === "mission" ? "Mission" : "Environment"}
              </button>
            ))}
          </div>

          {tab === "mission" ? (
            <div className="mt-3">
              {here ? (
                <p className="rounded-xl bg-white/[0.035] p-3 text-[12px] leading-relaxed text-white/60 ring-1 ring-inset ring-white/[0.05]">
                  {current === w.id ? `The rover is already on ${w.name}. Land again to start a fresh traverse at ${w.site.split(",")[0]}.` : `Home turf: no launch window needed. The rover is trucked straight to ${w.site.split(",")[0]} for a test drive.`}
                </p>
              ) : (
                <div className="rounded-xl bg-white/[0.035] p-3 ring-1 ring-inset ring-white/[0.05]">
                  <div className="flex items-center gap-2">
                    <PlanetDot w={from} size={20} />
                    <div className="relative h-8 flex-1">
                      <svg className="absolute inset-0 h-full w-full overflow-visible" viewBox="0 0 100 32" preserveAspectRatio="none" aria-hidden>
                        <path d="M2 28 Q50 -6 98 28" fill="none" stroke={rgba(ACCENT, 0.7)} strokeWidth="1.4" strokeDasharray="3 3" vectorEffect="non-scaling-stroke" className="rover-dash" />
                      </svg>
                      <span className="absolute left-1/2 top-[5px] -translate-x-1/2 whitespace-nowrap rounded-full bg-[#0b0d12] px-2 py-px text-[10px] text-white/80 ring-1 ring-white/10" style={mono}>
                        {local ? `${days} days` : fmtDays(days)}
                      </span>
                    </div>
                    <PlanetDot w={w} size={20} />
                  </div>
                  <div className="mt-2 grid grid-cols-3 gap-2 text-[10.5px]" style={mono}>
                    <div>
                      <p className="uppercase tracking-[0.12em] text-white/40">Launch</p>
                      <p className="mt-0.5 text-white/90">{win ? fmtDate(win.launch) : "Any day"}</p>
                      <p className="text-white/40">{win ? (win.launch - day < 1 ? <span style={{ color: ACCENT }}>open now</span> : `in ${fmtDays(win.launch - day)}`) : `from ${from.name}`}</p>
                    </div>
                    <div className="text-center">
                      <p className="uppercase tracking-[0.12em] text-white/40">Δv</p>
                      <p className="mt-0.5 text-white/90">{dv.toFixed(1)} km/s</p>
                      <p className="text-white/40">{local ? "local hop" : "Hohmann"}</p>
                    </div>
                    <div className="text-right">
                      <p className="uppercase tracking-[0.12em] text-white/40">Arrive</p>
                      <p className="mt-0.5 text-white/90">{win ? fmtDate(win.arrive) : `+${days} days`}</p>
                      <p className="text-white/40">{w.edl.chute ? "chute + crane" : "powered"}</p>
                    </div>
                  </div>
                </div>
              )}
              {w.id !== "earth" && (
                <div className="mt-2 rounded-xl bg-white/[0.035] p-3 ring-1 ring-inset ring-white/[0.05]">
                  <div className="flex items-center justify-between">
                    <p className="flex items-center gap-1.5 text-[9.5px] uppercase tracking-[0.16em] text-white/45" style={mono}>
                      <Icon name="signal" size={12} /> Signal to Earth
                    </p>
                    <p className="text-[12px] text-white tabular-nums" style={mono}>
                      {fmtDelay(delayNow)} <span className="text-white/40">one way</span>
                    </p>
                  </div>
                  {dmin !== dmax && (
                    <>
                      <div className="relative mt-2.5 h-1 rounded-full bg-white/[0.08]">
                        <span className="absolute top-1/2 h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-[#0b0d12]" style={{ left: `${Math.min(100, Math.max(0, ((delayNow - dmin) / (dmax - dmin)) * 100))}%`, background: ACCENT, boxShadow: `0 0 10px ${ACCENT}` }} />
                      </div>
                      <div className="mt-1.5 flex justify-between text-[9.5px] text-white/35" style={mono}>
                        <span>closest {fmtDelay(dmin)}</span>
                        <span>{live.earth < 0.01 ? `${fmt(live.earth * 149597870.7)} km` : `${live.earth.toFixed(3)} AU`} today</span>
                        <span>farthest {fmtDelay(dmax)}</span>
                      </div>
                    </>
                  )}
                </div>
              )}
              <p className="mt-3 border-l-2 pl-3 text-[11.5px] leading-relaxed text-white/55" style={{ borderColor: rgba(ACCENT, 0.5) }}>
                {w.edl.note}
              </p>
            </div>
          ) : (
            <div className="mt-3">
              <Stat k="Atmosphere" v={w.atm.composition.split(",")[0]} />
              <Stat k="Temperature" v={w.atm.tempRange} />
              <Stat k="Sun distance today" v={`${live.sun.toFixed(3)} AU`} sub={`${fmt(1361 / (live.sun * live.sun))} W/m²`} />
              <Stat k="Sunlight" v={`${fmt((1 / (live.sun * live.sun)) * 100, live.sun > 3 ? 1 : 0)}% of Earth's`} />
              <Stat k="Speed of sound" v={w.atm.sound ? `${w.atm.sound} m/s` : "no air"} />
              <Stat k="Typical wind" v={w.atm.rho > 0 ? `${w.atm.wind} m/s` : "none"} sub={w.atm.rho > 0 ? `gusts ${w.atm.gust}` : undefined} />
              <Stat k="Ground" v={w.soil.name} />
              <ul className="mt-3 space-y-1.5">
                {w.facts.map((f) => (
                  <li key={f} className="flex gap-2 text-[11.5px] leading-snug text-white/55">
                    <span className="mt-[5px] h-1 w-1 shrink-0 rounded-full" style={{ background: ACCENT }} />
                    {f}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>

        <div className="shrink-0 border-t border-white/[0.06] p-4">
          <button
            type="button"
            onClick={() => {
              control.unlock();
              control.go(w.id);
            }}
            className="group relative flex w-full items-center justify-center gap-2 overflow-hidden rounded-xl bg-[#c8ff3d] py-3.5 text-[12.5px] font-bold uppercase tracking-[0.18em] text-[#0b0d12] shadow-[0_10px_40px_-12px_rgba(200,255,61,.7),inset_0_1px_0_rgba(255,255,255,.5)] transition-transform hover:brightness-105 active:scale-[0.985]"
            style={mono}
          >
            <span aria-hidden className="rover-sheen pointer-events-none absolute inset-y-0 -left-1/3 w-1/3 bg-gradient-to-r from-transparent via-white/50 to-transparent" />
            {current === w.id ? "Land again" : `Launch to ${w.name}`}
            <span className="transition-transform group-hover:translate-x-1">
              <Icon name="arrow" size={16} />
            </span>
          </button>
          <ul className="mt-3 flex flex-wrap gap-1.5 md:hidden">
            {WORLDS.map((x) => (
              <li key={x.id}>
                <button type="button" onClick={() => control.select(x.id)} className={`flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] ${selected === x.id ? "bg-white/15 text-white" : "bg-white/5 text-white/60"}`}>
                  <PlanetDot w={x} size={10} />
                  {x.name}
                </button>
              </li>
            ))}
          </ul>
        </div>
      </Panel>
    </>
  );
}

/** date, time-warp and scale controls for the map */
function TimeBar() {
  const jd = useRover((s) => s.jd);
  const warp = useRover((s) => s.warp);
  const scale = useRover((s) => s.scale);
  const focus = useRover((s) => s.mapFocus);
  const set = useRover.getState().set;
  const step = (d: number) => set({ warp: Math.max(0, Math.min(WARPS.length - 1, warp + d)) });
  const date = dateOf(jd);
  const iconBtn = "flex h-8 w-8 items-center justify-center rounded-lg text-white/70 transition-colors hover:bg-white/10 hover:text-white";
  return (
    <Panel className="absolute bottom-4 left-4 flex flex-wrap items-center gap-2 p-2 max-md:bottom-auto max-md:left-3 max-md:right-3 max-md:top-16 max-md:justify-center md:max-w-[calc(100vw-440px)]">
      <div className="flex items-center gap-3 rounded-xl bg-white/[0.035] py-1.5 pl-3 pr-4 ring-1 ring-inset ring-white/[0.05]">
        <span className="relative flex h-2 w-2">
          {warp > 0 && <span className="absolute inline-flex h-full w-full animate-ping rounded-full opacity-60" style={{ background: ACCENT }} />}
          <span className="relative inline-flex h-2 w-2 rounded-full" style={{ background: warp > 0 ? ACCENT : "rgba(255,255,255,.35)" }} />
        </span>
        <div>
          <p className="text-[14px] font-semibold leading-tight text-white tabular-nums" style={mono}>
            {fmtDate(jd)}
          </p>
          <p className="text-[9.5px] uppercase tracking-[0.16em] text-white/45" style={mono}>
            {date.toLocaleDateString("en-GB", { weekday: "short", timeZone: "UTC" })} · {WARPS[warp].label}
          </p>
        </div>
      </div>
      <div className="flex items-center gap-0.5 rounded-xl bg-white/[0.035] p-0.5 ring-1 ring-inset ring-white/[0.05]">
        <button type="button" title="Slower" aria-label="Slower" onClick={() => step(-1)} className={iconBtn}>
          <Icon name="rew" />
        </button>
        <button
          type="button"
          title={warp === 0 ? "Play" : "Pause"}
          aria-label={warp === 0 ? "Play" : "Pause"}
          onClick={() => set({ warp: warp === 0 ? 3 : 0 })}
          className={`${iconBtn} ${warp === 0 ? "!bg-[#c8ff3d] !text-[#0b0d12]" : ""}`}
        >
          <Icon name={warp === 0 ? "play" : "pause"} />
        </button>
        <button type="button" title="Faster" aria-label="Faster" onClick={() => step(1)} className={iconBtn}>
          <Icon name="ff" />
        </button>
        <span className="mx-0.5 h-5 w-px bg-white/10" />
        <button type="button" title="Jump to today's real positions" onClick={control.now} className={`${iconBtn} w-auto gap-1.5 px-2.5 text-[10.5px] font-semibold uppercase tracking-[0.12em]`} style={mono}>
          <Icon name="now" size={13} /> Now
        </button>
      </div>
      <div className="relative grid grid-cols-3 rounded-xl bg-white/[0.035] p-0.5 ring-1 ring-inset ring-white/[0.05]">
        <span aria-hidden className="absolute bottom-0.5 top-0.5 w-[calc((100%-4px)/3)] rounded-lg bg-white shadow-[0_2px_10px_-2px_rgba(0,0,0,.5)] transition-transform duration-300" style={{ left: 2, transform: `translateX(${scale * 100}%)` }} />
        {SCALES.map((s, i) => (
          <button
            key={s.label}
            type="button"
            title={s.sub}
            onClick={() => set({ scale: i })}
            className={`relative whitespace-nowrap rounded-lg px-2.5 py-2 text-[10px] font-semibold uppercase tracking-[0.1em] transition-colors ${scale === i ? "text-[#0b0d12]" : "text-white/60 hover:text-white"}`}
            style={mono}
          >
            {s.label}
          </button>
        ))}
      </div>
      <Btn onClick={control.overview} active={focus === null} title="See the whole Solar System">
        <Icon name="orbit" size={14} /> Overview
      </Btn>
    </Panel>
  );
}

/** names that float over the bodies (positioned every frame by the scene) */
function SpaceLabels() {
  const register = (id: string) => (el: HTMLButtonElement | null) => {
    if (el) control.labels.set(id, el);
    else control.labels.delete(id);
  };
  const items: { id: string; name: string; kind: string }[] = [
    { id: "sun", name: "Sun", kind: "sun" },
    ...PLANET_IDS.map((id) => ({ id, name: worldById[id].name, kind: "planet" })),
    ...MOONS.map((m) => ({ id: m.id, name: m.name, kind: m.world ? "world" : "moon" })),
    { id: "halley", name: "1P/Halley", kind: "comet" },
  ];
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden">
      {items.map((it) => (
        <button
          key={it.id}
          ref={register(it.id)}
          type="button"
          data-kind={it.kind}
          style={{ display: "none" }}
          onClick={() => {
            control.unlock();
            if (it.id === "sun") control.overview();
            else control.select(it.id);
          }}
          className="space-label pointer-events-auto absolute left-0 top-0"
        >
          <span className="space-label-in" style={mono}>
            {it.name}
          </span>
        </button>
      ))}
    </div>
  );
}

// ———————————————————————————— cruise & landing ————————————————————————————

function CruisePanel() {
  const c = useRover((s) => s.cruise);
  const jd = useRover((s) => s.jd);
  if (!c) return null;
  const from = worldById[c.from];
  const to = worldById[c.to];
  const local = helioOf(from).id === helioOf(to).id;
  const waiting = c.phase === "wait";
  const progress = waiting ? 0 : c.t;
  return (
    <Panel className="absolute bottom-6 left-1/2 w-[min(560px,calc(100vw-32px))] -translate-x-1/2 p-4">
      <div className="flex items-center justify-between">
        <p className="text-[10px] uppercase tracking-[0.18em] text-white/50" style={mono}>
          {waiting ? "Waiting for the launch window" : local ? "Transfer" : "Hohmann transfer orbit"}
        </p>
        <Btn onClick={control.skip} title="Skip the cruise (Enter)">
          Skip ›
        </Btn>
      </div>
      <div className="mt-1 flex items-center gap-3 text-white">
        <PlanetDot w={from} size={18} />
        <span className="text-lg font-semibold">{from.name}</span>
        <span className="text-white/40">→</span>
        <PlanetDot w={to} size={18} />
        <span className="text-lg font-semibold">{to.name}</span>
        <span className="ml-auto text-[13px] text-white/80" style={mono}>
          {fmtDate(jd)}
        </span>
      </div>
      <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-white/10">
        <div className="h-full rounded-full transition-[width] duration-100" style={{ width: `${progress * 100}%`, background: waiting ? "rgba(255,255,255,.4)" : ACCENT }} />
      </div>
      <div className="mt-2 grid grid-cols-3 gap-2 text-[11px] text-white/60" style={mono}>
        <span>
          Launch {fmtDate(c.launch)}
          {c.wait > 1 && <span className="block text-white/40">after {fmtDays(c.wait)} wait</span>}
        </span>
        <span className="text-center">
          {waiting ? "Planets aligning…" : `Day ${fmt(c.day)} of ${fmt(c.days)}`}
          <span className="block text-white/40">Δv {c.dv.toFixed(1)} km/s</span>
        </span>
        <span className="text-right">
          Arrive {fmtDate(c.arrive)}
          <span className="block text-white/40">{waiting ? "" : c.t < 0.08 ? "Departure burn" : c.t > 0.92 ? "Capture & approach" : "Coasting"}</span>
        </span>
      </div>
    </Panel>
  );
}


function EdlPanel() {
  const e = useRover((s) => s.edl);
  const phase = useRover((s) => s.phase);
  const world = useRover((s) => s.world) ?? useRover.getState().selected;
  const w = worldById[world];
  const steps = w.edl.chute
    ? ["Parachute deployed", "Heat shield separation", "Backshell separation", "Powered descent", "Sky crane: lowering rover", "Touchdown confirmed", "Bridles cut — flyaway", "Rover deployed — drive!"]
    : ["Braking burn", "Powered descent", "Sky crane: lowering rover", "Touchdown confirmed", "Bridles cut — flyaway", "Rover deployed — drive!"];
  const done = new Set(e.log);
  const altStr = e.alt > 10000 ? `${fmt(e.alt / 1000, 1)} km` : `${fmt(e.alt, e.alt < 30 ? 1 : 0)} m`;
  const vStr = e.v > 2000 ? `${fmt(e.v / 1000, 2)} km/s` : `${fmt(e.v, e.v < 10 ? 2 : 0)} m/s`;
  return (
    <Panel className="absolute right-4 top-20 w-[min(300px,calc(100vw-32px))] p-4">
      <p className="text-[10px] uppercase tracking-[0.18em] text-white/45" style={mono}>
        {phase === "approach" ? "Entry" : "Entry · Descent · Landing"} — {w.name}
      </p>
      <p className="mt-1 text-xl font-semibold text-white">{e.phase}</p>
      <div className="mt-3 grid grid-cols-2 gap-3">
        <div>
          <p className="text-[10px] uppercase tracking-[0.14em] text-white/45">Altitude</p>
          <p className="text-2xl text-white" style={mono}>
            {altStr}
          </p>
        </div>
        <div>
          <p className="text-[10px] uppercase tracking-[0.14em] text-white/45">Velocity</p>
          <p className="text-2xl text-white" style={mono}>
            {vStr}
          </p>
        </div>
      </div>
      {e.ts > 1.05 && (
        <p className="mt-2 inline-block rounded bg-white/10 px-2 py-0.5 text-[10px] uppercase tracking-[0.14em] text-white/70" style={mono}>
          Time ×{e.ts < 10 ? e.ts.toFixed(1) : fmt(e.ts)}
        </p>
      )}
      {phase === "descent" && (
        <ol className="mt-3 space-y-1">
          {steps.map((s) => (
            <li key={s} className={`flex items-center gap-2 text-[11.5px] ${done.has(s) ? "text-white" : "text-white/35"}`}>
              <span className="inline-flex h-3.5 w-3.5 items-center justify-center rounded-full border text-[8px]" style={{ borderColor: done.has(s) ? ACCENT : "rgba(255,255,255,.25)", color: ACCENT }}>
                {done.has(s) ? "✓" : ""}
              </span>
              {s}
            </li>
          ))}
        </ol>
      )}
      <div className="mt-3 flex justify-end">
        <Btn onClick={control.skip} title="Skip the landing (Enter)">
          Skip landing ›
        </Btn>
      </div>
    </Panel>
  );
}

// ———————————————————————————— driving instruments ————————————————————————————

function Attitude({ pitch, roll }: { pitch: number; roll: number }) {
  const danger = Math.max(Math.abs(pitch), Math.abs(roll)) > 25;
  return (
    <svg width="86" height="86" viewBox="-43 -43 86 86" aria-label={`Pitch ${pitch.toFixed(0)}°, roll ${roll.toFixed(0)}°`}>
      <defs>
        <clipPath id="att">
          <circle r="40" />
        </clipPath>
      </defs>
      <g clipPath="url(#att)">
        <g transform={`rotate(${-roll}) translate(0 ${pitch * 1.2})`}>
          <rect x="-80" y="-120" width="160" height="120" fill="#2b4a72" />
          <rect x="-80" y="0" width="160" height="120" fill="#6a4a30" />
          <line x1="-80" x2="80" y1="0" y2="0" stroke="#fff" strokeWidth="1.2" />
          {[-20, -10, 10, 20].map((p) => (
            <line key={p} x1="-8" x2="8" y1={-p * 1.2} y2={-p * 1.2} stroke="rgba(255,255,255,.6)" strokeWidth="1" />
          ))}
        </g>
      </g>
      <circle r="40" fill="none" stroke={danger ? WARN : "rgba(255,255,255,.25)"} strokeWidth="2" />
      <path d="M-18 0 H-6 L0 5 L6 0 H18" fill="none" stroke={ACCENT} strokeWidth="2" />
    </svg>
  );
}

function Wheels() {
  const wheels = useRover((s) => s.tele.wheels);
  const pos = [
    [16, 12], [56, 12],
    [16, 44], [56, 44],
    [16, 76], [56, 76],
  ];
  return (
    <svg width="72" height="96" viewBox="0 0 72 96" aria-label="Wheel loads">
      <rect x="24" y="14" width="24" height="68" rx="4" fill="rgba(255,255,255,.08)" stroke="rgba(255,255,255,.2)" />
      {wheels.map((w, i) => {
        // FL is at +x (left): draw it on the left
        const [x, y] = pos[i];
        const load = Math.min(2, w.load);
        const slip = Math.min(1, Math.abs(w.slip) / 1.5);
        const color = !w.contact ? "rgba(255,255,255,.18)" : slip > 0.5 ? WARN : `rgba(200,255,61,${0.35 + load * 0.3})`;
        return (
          <g key={i} transform={`translate(${x} ${y}) rotate(${(-w.steer * 180) / Math.PI})`}>
            <rect x="-5" y="-9" width="10" height="18" rx="2.5" fill={color} />
          </g>
        );
      })}
    </svg>
  );
}

function Compass({ heading }: { heading: number }) {
  const marks = [];
  for (let d = -90; d <= 90; d += 15) {
    const h = Math.round((heading + d) / 15) * 15;
    const off = h - heading;
    if (Math.abs(off) > 90) continue;
    const label = ({ 0: "N", 90: "E", 180: "S", 270: "W", 360: "N" } as Record<number, string>)[((h % 360) + 360) % 360];
    marks.push(
      <div key={h} className="absolute top-0 -translate-x-1/2 text-center" style={{ left: `${50 + (off / 90) * 50}%` }}>
        <div className={`mx-auto w-px ${label ? "h-2.5 bg-white" : "h-1.5 bg-white/40"}`} />
        {label && <div className="text-[9px] text-white/80">{label}</div>}
      </div>,
    );
  }
  return (
    <div className="relative h-6 w-[180px] overflow-hidden" style={mono}>
      {marks}
      <div className="absolute left-1/2 top-0 h-3 w-0.5 -translate-x-1/2" style={{ background: ACCENT }} />
    </div>
  );
}

function DriveHud() {
  const t = useRover((s) => s.tele);
  const world = useRover((s) => s.world);
  const speedIdx = useRover((s) => s.speedIdx);
  const best = useRover((s) => s.bestAir);
  if (!world) return null;
  const w = worldById[world];
  const kmh = t.speed * 3.6;
  const [dmin, dmax] = commDelay(w);
  return (
    <>
      <Panel className="absolute bottom-4 left-4 flex items-end gap-4 p-4 max-md:bottom-3 max-md:left-3 max-md:gap-2 max-md:p-3 max-md:scale-[0.7] max-md:origin-bottom-left">
        <div>
          <p className="text-[10px] uppercase tracking-[0.16em] text-white/45" style={mono}>
            {t.pointTurn ? "Point turn" : SPEEDS[speedIdx].label}
          </p>
          <p className="text-5xl font-semibold leading-none tracking-tight text-white tabular-nums" style={mono}>
            {Math.abs(kmh) < 10 ? Math.abs(kmh).toFixed(1) : fmt(Math.abs(kmh))}
            <span className="ml-1 text-sm text-white/50">km/h</span>
          </p>
          <p className="mt-1 text-[11px] text-white/55" style={mono}>
            {kmh < -0.2 ? "REVERSE · " : ""}
            {fmt(t.odo, t.odo < 100 ? 1 : 0)} m driven
          </p>
          <div className="mt-2">
            <Compass heading={t.heading} />
          </div>
        </div>
        <Attitude pitch={t.pitch} roll={t.roll} />
        <div className="max-md:hidden">
          <Wheels />
        </div>
        <div className="w-[118px] max-md:hidden">
          <Stat k="Pitch" v={`${t.pitch.toFixed(0)}°`} />
          <Stat k="Roll" v={`${t.roll.toFixed(0)}°`} />
          <Stat k="Slip" v={`${fmt(t.slip * 100)}%`} />
          <Stat k="Load" v={`${t.gLoad.toFixed(2)} g`} />
          <div className="mt-2">
            <div className="flex justify-between text-[10px] uppercase tracking-[0.14em] text-white/45">
              <span>Battery</span>
              <span style={mono}>{fmt(t.battery * 100)}%</span>
            </div>
            <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-white/10">
              <div className="h-full" style={{ width: `${t.battery * 100}%`, background: t.battery < 0.2 ? WARN : ACCENT }} />
            </div>
            <p className="mt-1 text-[10px] text-white/45" style={mono}>
              {t.power > 1000 ? `${(t.power / 1000).toFixed(1)} kW` : `${fmt(t.power)} W`} draw · RTG 110 W
            </p>
          </div>
        </div>
      </Panel>

      <Panel className="absolute bottom-4 right-4 w-[230px] p-3 max-lg:hidden">
        <p className="mb-1 text-[10px] uppercase tracking-[0.18em] text-white/45" style={mono}>
          {w.name} · environment
        </p>
        <Stat k="Gravity" v={`${(w.g / EARTH_G).toFixed(3)} g`} />
        <Stat k="Pressure" v={fmtPressure(w.atm.pressureBar)} />
        <Stat k="Temp" v={fmtTemp(w.atm.tempC)} />
        <Stat k="Wind" v={w.atm.rho > 0 ? `${t.wind.toFixed(1)} m/s` : "none"} />
        <Stat k="Sound" v={w.atm.sound ? `${w.atm.sound} m/s` : "no air"} />
        <Stat k="Signal delay" v={dmin === dmax ? fmtDelay(dmin) : `${fmtDelay(dmin)}–${fmtDelay(dmax)}`} />
        <Stat k="Elevation" v={`${fmt(t.elev, 1)} m`} />
        {best > 0 && <Stat k="Best air" v={`${best.toFixed(1)} s`} />}
      </Panel>

      {t.air > 0.25 && (
        <div className="pointer-events-none absolute left-1/2 top-[22%] -translate-x-1/2 text-center">
          <p className="text-[11px] uppercase tracking-[0.3em] text-white/70" style={mono}>
            Airborne
          </p>
          <p className="text-5xl font-semibold text-white drop-shadow-[0_4px_20px_rgba(0,0,0,.6)]" style={mono}>
            {t.air.toFixed(1)}s
          </p>
        </div>
      )}
    </>
  );
}

function Minimap() {
  const ref = useRef<HTMLCanvasElement>(null);
  const pois = useRover((s) => s.pois);
  useEffect(() => {
    let raf = 0;
    let last = 0;
    const loop = (t: number) => {
      raf = requestAnimationFrame(loop);
      if (t - last < 100) return;
      last = t;
      const c = ref.current;
      const ctx = c?.getContext("2d");
      if (c && ctx) control.minimap(ctx, c.width, c.height);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);
  const found = pois.filter((p) => p.found).length;
  return (
    <Panel className="absolute right-4 top-16 overflow-hidden max-md:right-3 max-md:top-16 max-md:scale-[0.58] max-md:origin-top-right">
      <canvas ref={ref} width={190} height={190} className="block" aria-label="Map around the rover" />
      <div className="flex items-center justify-between border-t border-white/10 px-2.5 py-1.5 text-[10px] text-white/60" style={mono}>
        <span>260 m</span>
        {pois.length > 0 && (
          <span style={{ color: found === pois.length ? ACCENT : WARN }}>
            ◆ {found}/{pois.length} found
          </span>
        )}
      </div>
    </Panel>
  );
}

function Feed() {
  const feed = useRover((s) => s.feed);
  const [now, setNow] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setNow(performance.now()), 300);
    return () => clearInterval(id);
  }, []);
  const live = feed.filter((f) => now - f.t < 6000);
  const color = (f: FeedItem) => (f.tone === "warn" ? WARN : f.tone === "gold" ? ACCENT : "#fff");
  return (
    <div className="pointer-events-none absolute left-1/2 top-16 max-md:top-[38%] flex w-[min(560px,calc(100vw-32px))] -translate-x-1/2 flex-col items-center gap-2" aria-live="polite">
      {live.map((f) => (
        <div key={f.id} className="rover-pop rounded-lg bg-[#0b0d12]/70 px-4 py-2 text-center backdrop-blur" style={{ opacity: Math.min(1, (6000 - (now - f.t)) / 800) }}>
          <p className="text-[14px] font-semibold" style={{ color: color(f) }}>
            {f.text}
          </p>
          {f.sub && <p className="mt-0.5 text-[11px] text-white/60">{f.sub}</p>}
        </div>
      ))}
    </div>
  );
}

function SampleCard() {
  const s = useRover((x) => x.sample);
  if (!s) return null;
  const max = Math.max(...s.items.map((i) => i[1]));
  return (
    <Panel className="absolute left-1/2 top-1/2 w-[min(420px,calc(100vw-32px))] -translate-x-1/2 -translate-y-1/2 p-5">
      <p className="text-[10px] uppercase tracking-[0.18em] text-white/45" style={mono}>
        Sample analysis · CheMin / APXS
      </p>
      <h3 className="mt-1 text-lg font-semibold text-white">{s.title}</h3>
      <ul className="mt-3 space-y-1.5">
        {s.items.map(([k, v]) => (
          <li key={k} className="grid grid-cols-[120px_1fr_48px] items-center gap-2 text-[12px]">
            <span className="text-white/75">{k}</span>
            <span className="h-1.5 overflow-hidden rounded-full bg-white/10">
              <span className="block h-full rounded-full" style={{ width: `${(v / max) * 100}%`, background: ACCENT }} />
            </span>
            <span className="text-right text-white/80" style={mono}>
              {v < 1 ? v.toFixed(3) : v.toFixed(1)}%
            </span>
          </li>
        ))}
      </ul>
      <p className="mt-3 text-[12px] leading-relaxed text-white/55">{s.note}</p>
      <div className="mt-4 flex justify-end">
        <Btn onClick={() => useRover.getState().set({ sample: null })}>Close</Btn>
      </div>
    </Panel>
  );
}

function Help({ onClose }: { onClose: () => void }) {
  const rows: [string, string][] = [
    ["W A S D / arrows", "Drive and steer"],
    ["Steer while stopped", "Point turn on the spot"],
    ["Space", "Brake"],
    ["Drag · wheel", "Look around · zoom"],
    ["C", "Camera: chase, mastcam, hazcam, wheel, cinematic"],
    ["V", "Speed limit (Mission → Rally)"],
    ["F", "Deploy arm and drill a sample"],
    ["L", "Work lights"],
    ["R", "Recover if overturned"],
    ["M", "Solar System map / choose a world"],
    ["P", "Photo"],
    ["H", "Hide the HUD"],
    ["Enter", "Skip cruise / landing"],
    ["Gamepad", "Stick steers, triggers drive"],
  ];
  return (
    <Panel className="absolute left-1/2 top-1/2 w-[min(440px,calc(100vw-32px))] -translate-x-1/2 -translate-y-1/2 p-5">
      <h3 className="text-lg font-semibold text-white">Controls</h3>
      <ul className="mt-3">
        {rows.map(([k, v]) => (
          <li key={k} className="flex justify-between gap-4 border-b border-white/[0.06] py-1.5 text-[12px] last:border-0">
            <span className="text-white" style={mono}>
              {k}
            </span>
            <span className="text-right text-white/60">{v}</span>
          </li>
        ))}
      </ul>
      <p className="mt-3 text-[11.5px] leading-relaxed text-white/50">
        Physics is real: the same rover, motors and tyres on every world. Gravity sets how much grip and spring sag you get, air density sets drag, buoyancy, dust and sound.
      </p>
      <div className="mt-4 flex justify-end">
        <Btn onClick={onClose}>Got it</Btn>
      </div>
    </Panel>
  );
}

/** a thumb-stick for touch screens: up/down drives, left/right steers */
function TouchStick() {
  const [knob, setKnob] = useState({ x: 0, y: 0 });
  const base = useRef<HTMLDivElement>(null);
  const move = (e: React.PointerEvent) => {
    const r = base.current!.getBoundingClientRect();
    const x = Math.max(-1, Math.min(1, (e.clientX - (r.left + r.width / 2)) / (r.width / 2)));
    const y = Math.max(-1, Math.min(1, (e.clientY - (r.top + r.height / 2)) / (r.height / 2)));
    setKnob({ x, y });
    control.touch.active = true;
    control.touch.throttle = Math.abs(y) > 0.15 ? -y : 0;
    control.touch.steer = Math.abs(x) > 0.15 ? -x : 0;
  };
  const end = () => {
    setKnob({ x: 0, y: 0 });
    control.touch.throttle = 0;
    control.touch.steer = 0;
  };
  return (
    <>
      <div
        ref={base}
        className="pointer-events-auto absolute bottom-6 right-6 h-32 w-32 touch-none rounded-full border border-white/20 bg-black/30 backdrop-blur md:hidden"
        onPointerDown={(e) => {
          (e.target as HTMLElement).setPointerCapture(e.pointerId);
          control.unlock();
          move(e);
        }}
        onPointerMove={(e) => e.buttons && move(e)}
        onPointerUp={end}
        onPointerCancel={end}
      >
        <div className="absolute h-12 w-12 rounded-full bg-white/70" style={{ left: `calc(50% - 24px + ${knob.x * 40}px)`, top: `calc(50% - 24px + ${knob.y * 40}px)` }} />
      </div>
      <button
        type="button"
        className="pointer-events-auto absolute bottom-44 right-12 h-14 w-14 touch-none rounded-full border border-white/20 bg-black/40 text-[10px] font-bold uppercase text-white md:hidden"
        onPointerDown={() => {
          control.touch.active = true;
          control.touch.brake = true;
        }}
        onPointerUp={() => (control.touch.brake = false)}
        onPointerCancel={() => (control.touch.brake = false)}
        style={mono}
      >
        Brake
      </button>
    </>
  );
}

// ———————————————————————————— page ————————————————————————————

export default function View() {
  const ready = useRover((s) => s.ready);
  const progress = useRover((s) => s.progress);
  const phase = useRover((s) => s.phase);
  const cam = useRover((s) => s.cam);
  const speedIdx = useRover((s) => s.speedIdx);
  const sound = useRover((s) => s.sound);
  const hud = useRover((s) => s.hud);
  const lights = useRover((s) => s.lights);
  const help = useRover((s) => s.help);
  const overturned = useRover((s) => s.overturned);
  const lost = useRover((s) => s.lost);
  const photo = useRover((s) => s.photo);
  const world = useRover((s) => s.world);
  const fade = useRef<HTMLDivElement>(null);

  // a fresh visit starts at the map (the store outlives the page)
  useEffect(() => {
    useRover.getState().set({ ready: false, progress: 0, phase: "loading", world: null, feed: [], sample: null, lost: null, photo: null, pois: [], overturned: false, hover: null });
  }, []);
  useEffect(() => {
    control.fade = fade.current;
    return () => {
      control.fade = null;
    };
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.closest?.("input, textarea") || e.metaKey || e.ctrlKey || e.altKey) return;
      const s = useRover.getState();
      const k = e.code;
      control.unlock();
      if (k === "KeyC") {
        const i = CAMS.findIndex((c) => c.id === s.cam);
        s.set({ cam: CAMS[(i + 1) % CAMS.length].id });
      } else if (k === "KeyV") s.set({ speedIdx: (s.speedIdx + 1) % SPEEDS.length });
      else if (k === "KeyF") control.sample();
      else if (k === "KeyR") control.recover();
      else if (k === "KeyL") s.set({ lights: !s.lights });
      else if (k === "KeyH") s.set({ hud: !s.hud });
      else if (k === "KeyM") control.menu();
      else if (k === "KeyP") control.photo();
      else if (k === "Enter") {
        if (s.phase === "menu") control.go(s.selected);
        else control.skip();
      } else if (k === "Slash" || k === "KeyI") s.set({ help: !s.help });
      else if (k === "Escape") s.set({ help: false, sample: null, photo: null });
      else return;
      e.preventDefault();
    };
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  }, []);

  const show = hud || phase === "menu";
  const driving = phase === "drive" || phase === "lost";

  return (
    <div className="fixed inset-0 overflow-hidden bg-black text-white" style={{ fontFamily: "var(--font-inter-tight), system-ui, sans-serif" }}>
      <style>{`
        .rover-pop { animation: rover-pop .35s cubic-bezier(.2,.9,.3,1.3) both; }
        @keyframes rover-pop { from { transform: translateY(-8px) scale(.96); opacity: 0 } to { transform: none; opacity: 1 } }
        .rover-flash { animation: rover-flash .35s ease-out both; }
        .space-label { transform-origin: 0 0; will-change: transform; }
        .space-label-in { position: absolute; left: 0; bottom: 6px; transform: translateX(-50%); white-space: nowrap; font-size: 10.5px; letter-spacing: .08em; text-transform: uppercase; color: rgba(255,255,255,.62); padding: 2px 6px; border-radius: 4px; transition: color .2s, background .2s; text-shadow: 0 1px 3px rgba(0,0,0,.9); }
        .space-label-in::after { content: ""; position: absolute; left: 50%; top: 100%; width: 1px; height: 6px; background: rgba(255,255,255,.35); }
        .space-label[data-kind="moon"] .space-label-in { font-size: 9px; color: rgba(255,255,255,.42); }
        .space-label[data-kind="sun"] .space-label-in { color: rgba(255,226,170,.7); }
        .space-label[data-kind="comet"] .space-label-in { color: rgba(140,210,255,.6); font-size: 9.5px; }
        .space-label:hover .space-label-in, .space-label[data-active="true"] .space-label-in { color: #0b0d12; background: #c8ff3d; text-shadow: none; }
        @keyframes rover-flash { from { opacity: .75 } to { opacity: 0 } }
        .rover-dash { animation: rover-dash 1.2s linear infinite; }
        @keyframes rover-dash { to { stroke-dashoffset: -12 } }
        .rover-sheen { animation: rover-sheen 3.6s ease-in-out infinite; }
        @keyframes rover-sheen { 0%, 60% { transform: translateX(0) skewX(-20deg) } 100% { transform: translateX(450%) skewX(-20deg) } }
        .rover-panel { animation: rover-panel .5s cubic-bezier(.2,.8,.2,1) both; }
        @keyframes rover-panel { from { opacity: 0; transform: translateY(8px) } }
        @media (prefers-reduced-motion: reduce) { .rover-dash, .rover-sheen, .rover-panel { animation: none } }
      `}</style>
      <div className="absolute inset-0">
        <Scene />
      </div>
      <div ref={fade} aria-hidden className="pointer-events-none absolute inset-0" style={{ background: "#000", opacity: 1 }} />

      {show && (
        <div className="pointer-events-none absolute inset-0">
          {/* top bar */}
          <div className="absolute inset-x-0 top-0 flex items-center justify-between gap-2 px-4 pt-4">
            <div className="pointer-events-auto flex items-center gap-3">
              <Link href="/" className="flex h-9 items-center rounded-lg bg-[#0b0d12]/70 px-3 text-[11px] font-semibold uppercase tracking-[0.12em] text-white/80 ring-1 ring-white/12 backdrop-blur hover:text-white" style={mono}>
                ←<span className="ml-1.5 max-sm:hidden">Portfolio</span>
              </Link>
              <div className="max-sm:hidden">
                <p className="text-[13px] font-semibold leading-tight text-white">Odyssey Rover</p>
                <p className="text-[10px] uppercase tracking-[0.16em] text-white/45" style={mono}>
                  {world ? `${worldById[world].name} · ${worldById[world].site.split(",")[0]}` : "Mission control"}
                </p>
              </div>
            </div>
            <div className="pointer-events-auto flex flex-wrap items-center justify-end gap-1.5">
              {(phase === "menu" || driving) && (
                <Link
                  href="/rover/control"
                  title="Mission Control: launch rockets and run satellites"
                  className="flex h-9 items-center gap-1.5 rounded-lg bg-[#c8ff3d] px-3 text-[11px] font-bold uppercase tracking-[0.12em] text-[#0b0d12] shadow-[0_0_24px_-6px_rgba(200,255,61,.7)] transition-transform hover:scale-[1.03]"
                  style={mono}
                >
                  ◉<span className="max-sm:hidden">Mission Control</span>
                </Link>
              )}
              {(driving || (phase === "menu" && world)) && (
                <Btn onClick={control.menu} active={phase === "menu"} title="Solar System map (M)">
                  {phase === "menu" ? "Back to rover" : "Map"}
                </Btn>
              )}
              {driving && (
                <>
                  <Btn
                    onClick={() => {
                      const i = CAMS.findIndex((c) => c.id === cam);
                      useRover.getState().set({ cam: CAMS[(i + 1) % CAMS.length].id });
                    }}
                    title="Camera (C)"
                  >
                    ◉<span className="max-sm:hidden">{CAMS.find((c) => c.id === cam)?.label}</span>
                  </Btn>
                  <Btn onClick={() => useRover.getState().set({ speedIdx: (speedIdx + 1) % SPEEDS.length })} title={`Speed limit: ${SPEEDS[speedIdx].sub} (V)`}>
                    ⏱<span className="max-sm:hidden">{SPEEDS[speedIdx].label}</span>
                  </Btn>
                  <Btn onClick={control.sample} title="Drill a sample (F)" className="max-sm:hidden">
                    ⛏ Sample
                  </Btn>
                  <Btn onClick={() => useRover.getState().set({ lights: !lights })} active={lights} title="Work lights (L)" className="max-sm:hidden">
                    ☀
                  </Btn>
                  <Btn onClick={control.photo} title="Take a photo (P)" className="max-sm:hidden">
                    ◫
                  </Btn>
                </>
              )}
              <Btn onClick={() => useRover.getState().set({ sound: !sound })} active={!sound} title={sound ? "Mute (sound on)" : "Unmute (sound off)"}>
                {sound ? "♪" : "✕♪"}
              </Btn>
              <Btn onClick={() => useRover.getState().set({ help: !help })} title="Controls (?)">
                ?
              </Btn>
            </div>
          </div>

          <SpaceLabels />
          {phase === "menu" && <WorldPicker />}
          {phase === "menu" && <TimeBar />}
          {phase === "menu" && (
            <div className="absolute left-1/2 top-[22px] -translate-x-1/2 max-lg:hidden">
              <p className="flex items-center gap-2.5 whitespace-nowrap rounded-full bg-[#0b0d12]/55 px-3.5 py-1.5 text-[9.5px] uppercase tracking-[0.2em] text-white/50 ring-1 ring-inset ring-white/[0.07] backdrop-blur-md" style={mono}>
                <span className="text-white/80">Choose a world</span>
                <span className="text-white/20">/</span> Click to select
                <span className="text-white/20">/</span> Drag to orbit
                <span className="text-white/20">/</span> Scroll to zoom
              </p>
            </div>
          )}
          {phase === "cruise" && <CruisePanel />}
          {(phase === "approach" || phase === "descent") && <EdlPanel />}
          {driving && <DriveHud />}
          {driving && world && <Minimap />}
          <Feed />
          <SampleCard />
          {driving && <TouchStick />}
          {overturned && phase === "drive" && (
            <Panel className="absolute left-1/2 top-[38%] -translate-x-1/2 p-4 text-center">
              <p className="font-semibold" style={{ color: WARN }}>
                Rover overturned
              </p>
              <p className="mt-1 text-[12px] text-white/60">No real rover could recover from this.</p>
              <div className="mt-3 flex justify-center">
                <Btn onClick={control.recover}>Recover (R)</Btn>
              </div>
            </Panel>
          )}
        </div>
      )}

      {lost && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
          <Panel className="w-[min(460px,100%)] p-6">
            <p className="text-[10px] uppercase tracking-[0.2em]" style={{ ...mono, color: WARN }}>
              Loss of signal
            </p>
            <p className="mt-2 text-[14px] leading-relaxed text-white/80">{lost}</p>
            <div className="mt-5 flex gap-2">
              <Btn onClick={control.redeploy} active>
                Land a new rover
              </Btn>
              <Btn onClick={control.menu}>Choose another world</Btn>
            </div>
          </Panel>
        </div>
      )}

      {help && <Help onClose={() => useRover.getState().set({ help: false })} />}

      {photo && <div key={photo.length} className="rover-flash pointer-events-none absolute inset-0 bg-white" />}
      {photo && (
        <Panel className="absolute bottom-24 left-1/2 w-[min(360px,calc(100vw-32px))] -translate-x-1/2 p-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={photo} alt="Photo from the rover" className="w-full rounded-md" />
          <div className="mt-2 flex justify-between">
            <a href={photo} download={`rover-${world ?? "space"}.png`} className="pointer-events-auto flex h-9 items-center rounded-lg bg-[#c8ff3d] px-3 text-[11px] font-bold uppercase tracking-[0.12em] text-[#0b0d12]" style={mono}>
              Download
            </a>
            <Btn onClick={() => useRover.getState().set({ photo: null })}>Close</Btn>
          </div>
        </Panel>
      )}

      {/* loader */}
      <div className={`pointer-events-none absolute inset-0 flex flex-col items-center justify-center bg-black transition-opacity duration-700 ${ready ? "opacity-0" : "opacity-100"}`}>
        <p className="text-[10px] uppercase tracking-[0.3em] text-white/50" style={mono}>
          Odyssey Rover · Mission control
        </p>
        <p className="mt-2 text-2xl font-semibold text-white">Generating the Solar System</p>
        <div className="mt-5 h-1 w-56 overflow-hidden rounded-full bg-white/10">
          <div className="h-full transition-[width] duration-300" style={{ width: `${progress * 100}%`, background: ACCENT }} />
        </div>
      </div>
    </div>
  );
}
