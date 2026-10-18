"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { SPEEDS } from "./physics";
import { CAMS, SCALES, WARPS, control, useRover, type FeedItem } from "./store";
import { MOONS, PLANET_IDS, fmtDate, launchWindow, planetPos } from "./ephemeris";
import { EARTH_G, WORLDS, commDelay, hohmannDv, worldById, type World } from "./worlds";

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
    <div className={`pointer-events-auto rounded-xl border border-white/10 bg-[#0b0d12]/72 shadow-[0_20px_60px_-20px_rgba(0,0,0,.8)] backdrop-blur-md ${className}`} style={style}>
      {children}
    </div>
  );
}

function Stat({ k, v, sub }: { k: string; v: string; sub?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-white/[0.06] py-[5px] last:border-0">
      <span className="text-[10px] uppercase tracking-[0.14em] text-white/45">{k}</span>
      <span className="text-right text-[12px] text-white/90" style={mono}>
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
      className={`pointer-events-auto flex h-9 items-center gap-1.5 rounded-lg px-3 text-[11px] font-semibold uppercase tracking-[0.12em] transition-colors ${active ? "bg-[#c8ff3d] text-[#0b0d12]" : "bg-[#0b0d12]/70 text-white/80 ring-1 ring-white/12 backdrop-blur hover:bg-white/10 hover:text-white"} ${className}`}
      style={mono}
    >
      {children}
    </button>
  );
}

function PlanetDot({ w, size = 16 }: { w: World; size?: number }) {
  const l = w.look;
  const bg =
    l.kind === "banded"
      ? `repeating-linear-gradient(0deg, ${l.c1} 0 3px, ${l.c2} 3px 5px, ${l.c3} 5px 6px)`
      : l.kind === "earth"
        ? `radial-gradient(circle at 35% 35%, ${l.c2} 0 22%, ${l.c1} 40%)`
        : `radial-gradient(circle at 35% 35%, ${l.c3}, ${l.c1} 45%, ${l.c2})`;
  return <span aria-hidden className="inline-block shrink-0 rounded-full shadow-[inset_-3px_-3px_6px_rgba(0,0,0,.55)]" style={{ width: size, height: size, background: bg }} />;
}

// ———————————————————————————— mission select ————————————————————————————

const LIGHT_MIN_PER_AU = 8.3167;

function WorldPicker() {
  const selected = useRover((s) => s.selected);
  const hover = useRover((s) => s.hover);
  const current = useRover((s) => s.world);
  const jd = useRover((s) => s.jd);
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
  return (
    <>
      <Panel className="absolute left-4 top-20 w-[260px] p-2 max-md:hidden">
        <p className="px-2 pb-2 pt-1 text-[10px] uppercase tracking-[0.18em] text-white/45" style={mono}>
          Destinations
        </p>
        <ul>
          {WORLDS.map((x) => (
            <li key={x.id}>
              <button
                type="button"
                onMouseEnter={() => useRover.getState().set({ hover: x.id })}
                onMouseLeave={() => useRover.getState().set({ hover: null })}
                onClick={() => control.select(x.id)}
                className={`flex w-full items-center gap-3 rounded-lg px-2 py-[7px] text-left transition-colors ${selected === x.id ? "bg-white/10" : "hover:bg-white/5"}`}
              >
                <PlanetDot w={x} />
                <span className={`flex-1 text-[13px] ${selected === x.id ? "text-white" : "text-white/75"}`}>
                  {x.name}
                  {x.parent && <span className="ml-1.5 text-[10px] text-white/35">· {x.parent}</span>}
                </span>
                <span className="text-[10px] text-white/45" style={mono}>
                  {(x.g / EARTH_G).toFixed(2)} g
                </span>
              </button>
            </li>
          ))}
        </ul>
      </Panel>

      <Panel className="absolute bottom-4 right-4 w-[min(380px,calc(100vw-32px))] p-5 max-md:left-4 max-md:max-h-[52vh] max-md:overflow-y-auto">
        <div className="flex items-center gap-3">
          <PlanetDot w={w} size={34} />
          <div>
            <p className="text-[10px] uppercase tracking-[0.18em] text-white/45" style={mono}>
              {w.kind}
              {w.parent ? ` of ${w.parent}` : ""}
            </p>
            <h2 className="text-2xl font-semibold tracking-tight text-white">{w.name}</h2>
          </div>
        </div>
        <p className="mt-2 text-[12px] text-white/60">Landing site: {w.site}</p>
        <div className="mt-3">
          <Stat k="Gravity" v={`${(w.g / EARTH_G).toFixed(2)} g`} sub={`${w.g} m/s²`} />
          <Stat k="Rover weighs" v={`${fmt((899 * w.g) / EARTH_G)} kgf`} sub="(899 kg)" />
          <Stat k="Pressure" v={fmtPressure(w.atm.pressureBar)} sub={w.surface === "deck" ? "no surface" : undefined} />
          <Stat k="Temperature" v={fmtTemp(w.atm.tempC)} />
          <Stat k="Sun distance today" v={`${live.sun.toFixed(3)} AU`} sub={`${fmt(1361 / (live.sun * live.sun))} W/m²`} />
          {w.id !== "earth" && <Stat k="From Earth today" v={live.earth < 0.01 ? `${fmt(live.earth * 149597870.7)} km` : `${live.earth.toFixed(3)} AU`} sub={`signal ${fmtDelay(delayNow)}`} />}
          {w.id !== "earth" && dmin !== dmax && <Stat k="Signal delay range" v={`${fmtDelay(dmin)}–${fmtDelay(dmax)}`} />}
          {win && <Stat k="Next launch window" v={fmtDate(win.launch)} sub={win.launch - day < 1 ? "open now" : `in ${fmtDays(win.launch - day)}`} />}
          {w.id !== from.id && <Stat k={`Flight from ${from.name}`} v={local ? `${days} days` : fmtDays(days)} sub={`Δv ${dv.toFixed(1)} km/s`} />}
          {win && <Stat k="Arrival" v={fmtDate(win.arrive)} />}
        </div>
        <p className="mt-3 text-[12px] leading-relaxed text-white/55">{w.edl.note}</p>
        <button
          type="button"
          onClick={() => {
            control.unlock();
            control.go(w.id);
          }}
          className="mt-4 flex w-full items-center justify-center gap-2 rounded-lg bg-[#c8ff3d] py-3 text-[13px] font-bold uppercase tracking-[0.16em] text-[#0b0d12] transition-transform active:scale-[0.98]"
          style={mono}
        >
          {current === w.id ? "Land again" : `Launch to ${w.name}`} →
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
  return (
    <Panel className="absolute bottom-4 left-4 flex flex-wrap items-center gap-2 p-2 max-md:bottom-auto max-md:left-3 max-md:right-3 max-md:top-16 max-md:justify-center md:max-w-[calc(100vw-440px)]">
      <div className="px-2">
        <p className="text-[15px] font-semibold leading-tight text-white" style={mono}>
          {fmtDate(jd)}
        </p>
        <p className="text-[9.5px] uppercase tracking-[0.16em] text-white/45" style={mono}>
          {WARPS[warp].label}
        </p>
      </div>
      <div className="flex items-center gap-1">
        <Btn onClick={() => step(-1)} title="Slower">
          ‹‹
        </Btn>
        <Btn onClick={() => set({ warp: warp === 0 ? 3 : 0 })} active={warp === 0} title={warp === 0 ? "Play" : "Pause"}>
          {warp === 0 ? "▶" : "❚❚"}
        </Btn>
        <Btn onClick={() => step(1)} title="Faster">
          ››
        </Btn>
        <Btn onClick={control.now} title="Jump to today's real positions">
          Now
        </Btn>
      </div>
      <div className="flex items-center gap-1 rounded-lg bg-white/[0.04] p-1">
        {SCALES.map((s, i) => (
          <button
            key={s.label}
            type="button"
            title={s.sub}
            onClick={() => set({ scale: i })}
            className={`rounded-md px-2.5 py-1.5 text-[10.5px] font-semibold uppercase tracking-[0.1em] transition-colors ${scale === i ? "bg-white text-[#0b0d12]" : "text-white/70 hover:text-white"}`}
            style={mono}
          >
            {s.label}
          </button>
        ))}
      </div>
      <Btn onClick={control.overview} active={focus === null} title="See the whole Solar System">
        Overview
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
            <div className="absolute left-1/2 top-20 -translate-x-1/2 text-center max-md:hidden">
              <p className="text-[10px] uppercase tracking-[0.3em] text-white/45" style={mono}>
                Choose a world · click a planet or name · drag to orbit · scroll to zoom
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
