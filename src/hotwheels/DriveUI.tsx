"use client";

import { useRef, useState } from "react";
import { CHALLENGES } from "./challenges";
import { ATTRACTIONS } from "./park";
import { playClick, unlockSound } from "./sound";
import { control, useHW } from "./store";

const FLAME = "linear-gradient(100deg,#ffd21f 0%,#ff7a00 45%,#ff2d1a 100%)";
const fmt = (t: number | null) => (t === null ? "—" : `${t.toFixed(2)}s`);

/** While you drive: the lap, the score, the nitro, the toys, and what the keys do. */
export function DriveHud() {
  const d = useHW((s) => s.drive);
  const coarse = useCoarse();
  return (
    <div className="pointer-events-none flex w-full flex-col items-center gap-2 px-gutter">
      <div className="pointer-events-auto flex flex-wrap items-stretch justify-center gap-2 rounded-[18px] bg-black/60 p-2 ring-1 ring-white/12 backdrop-blur-xl">
        <div className="min-w-[120px] rounded-[12px] bg-white/[0.06] px-3 py-2">
          <p className="font-mono text-[9px] uppercase tracking-[0.16em] text-white/50">Lap</p>
          <p className="text-[26px] font-black italic leading-none tabular-nums">{d.lap === null ? "Cross the line" : d.lap.toFixed(2)}</p>
          <p className="mt-1 font-mono text-[9.5px] uppercase tracking-[0.12em] text-white/55">
            last {fmt(d.last)} · best {fmt(d.best)}
          </p>
        </div>
        <div className="hidden rounded-[12px] bg-white/[0.06] px-3 py-2 md:block">
          <p className="font-mono text-[9px] uppercase tracking-[0.16em] text-white/50">Next</p>
          <p className="text-[22px] font-black italic leading-none">{d.next === 0 ? "Finish" : `CP ${d.next}`}</p>
          <div className="mt-2 flex gap-1">
            {Array.from({ length: d.of }, (_, i) => (
              <span key={i} className="h-[5px] w-4 rounded-full" style={{ background: d.lap === null ? "rgba(255,255,255,.15)" : i === 0 ? (d.next === 0 ? "#ffd21f" : "rgba(255,255,255,.6)") : i < d.next ? "#34c759" : i === d.next ? "#ffd21f" : "rgba(255,255,255,.15)" }} />
            ))}
          </div>
        </div>
        <div className="rounded-[12px] bg-white/[0.06] px-3 py-2">
          <p className="font-mono text-[9px] uppercase tracking-[0.16em] text-white/50">Trick score</p>
          <p className="text-[26px] font-black italic leading-none tabular-nums" style={{ backgroundImage: FLAME, WebkitBackgroundClip: "text", backgroundClip: "text", color: "transparent" }}>
            {d.score.toLocaleString()}
          </p>
          <p className="mt-1 hidden font-mono text-[9.5px] uppercase tracking-[0.12em] text-white/55 md:block">
            dominoes {d.dominoes[0]}/{d.dominoes[1]} · skittles {d.pins[0]}/{d.pins[1]}
          </p>
        </div>
        <div className="flex min-w-[110px] flex-col justify-center rounded-[12px] bg-white/[0.06] px-3 py-2">
          <p className="font-mono text-[9px] uppercase tracking-[0.16em] text-white/50">Nitro {d.nitro && <span className="text-[#ffd21f]">· burning</span>}</p>
          <span className="relative mt-1.5 h-[8px] overflow-hidden rounded-full bg-black/50">
            <span className="absolute inset-y-0 left-0 rounded-full" style={{ width: `${d.fuel * 100}%`, background: d.fuel < 0.2 ? "#ff3b30" : FLAME, boxShadow: d.nitro ? "0 0 12px rgba(255,140,0,.9)" : undefined }} />
          </span>
        </div>
        <div className="flex flex-col justify-center gap-1">
          <HudButton label="Restart" k="R" onClick={() => control.respawn()} />
          <span className="hidden md:contents">
            <HudButton label="Stand toys up" k="T" onClick={() => control.resetToys()} />
          </span>
          <HudButton label="Leave car" k="Esc" onClick={() => control.stopDrive()} />
        </div>
      </div>
      {!coarse && (
        <p className="rounded-full bg-black/50 px-3 py-1 font-mono text-[9.5px] uppercase tracking-[0.14em] text-white/75 backdrop-blur">
          W A S D / arrows drive · Space hop · Shift nitro · X handbrake slide · in the air: W S flip, A D roll · C camera · R restart
        </p>
      )}
    </div>
  );
}

function HudButton({ label, k, onClick }: { label: string; k: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={() => {
        playClick();
        onClick();
      }}
      className="flex items-center justify-between gap-3 rounded-full bg-white/10 px-3 py-1 text-[10.5px] font-bold uppercase tracking-wide text-white hover:bg-white/20"
    >
      {label}
      <span className="font-mono text-[9px] text-white/50">{k}</span>
    </button>
  );
}

/** Is this a touch screen? */
function useCoarse() {
  // only ever mounted in the browser (while you drive), so it can read the media query straight away
  const [c] = useState(() => typeof window !== "undefined" && matchMedia("(pointer: coarse)").matches);
  return c;
}

/** On a touch screen: steer on the left, pedals and buttons on the right. */
export function TouchPads() {
  const coarse = useCoarse();
  const keys = useRef({ l: false, r: false, g: false, b: false });
  if (!coarse) return null;
  const sync = () => {
    const k = keys.current;
    control.drive({ steer: (k.r ? 1 : 0) - (k.l ? 1 : 0), throttle: (k.g ? 1 : 0) - (k.b ? 1 : 0) });
  };
  const pad = (key: "l" | "r" | "g" | "b", label: string, cls: string) => (
    <button
      type="button"
      className={`pointer-events-auto flex select-none items-center justify-center rounded-full bg-black/45 text-[13px] font-black uppercase text-white ring-1 ring-white/20 backdrop-blur active:bg-white/30 ${cls}`}
      onPointerDown={(e) => {
        e.preventDefault();
        unlockSound();
        (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
        keys.current[key] = true;
        sync();
      }}
      onPointerUp={() => ((keys.current[key] = false), sync())}
      onPointerCancel={() => ((keys.current[key] = false), sync())}
    >
      {label}
    </button>
  );
  const tap = (label: string, cls: string, down: () => void, up?: () => void) => (
    <button
      type="button"
      className={`pointer-events-auto flex select-none items-center justify-center rounded-full text-[11px] font-black uppercase ring-1 ring-white/20 backdrop-blur ${cls}`}
      onPointerDown={(e) => {
        e.preventDefault();
        down();
      }}
      onPointerUp={up}
      onPointerCancel={up}
    >
      {label}
    </button>
  );
  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-5 z-20 flex items-end justify-between px-4">
      <div className="flex gap-3">
        {pad("l", "◀", "h-16 w-16 text-[22px]")}
        {pad("r", "▶", "h-16 w-16 text-[22px]")}
      </div>
      <div className="flex items-end gap-2">
        <div className="flex flex-col gap-2">
          {tap("Hop", "h-12 w-12 bg-white/80 text-[#0f1115]", () => control.drive({ hop: true }))}
          {tap("Nitro", "h-12 w-12 bg-[#ffd21f] text-[#0f1115]", () => control.drive({ nitro: true }), () => control.drive({ nitro: false }))}
        </div>
        <div className="flex flex-col gap-2">
          {pad("g", "Gas", "h-16 w-16 !bg-[#34c759]/80")}
          {pad("b", "Brake", "h-14 w-16 !bg-[#ff3b30]/70")}
        </div>
      </div>
    </div>
  );
}

/** Every challenge, by ride, with what's done ticked off. */
export function ChallengesPanel() {
  const open = useHW((s) => s.panel);
  const done = useHW((s) => s.challengesDone);
  if (!open) return null;
  const groups = [...ATTRACTIONS.map((a) => ({ id: a.id as string, name: a.name, accent: a.accent })), { id: "park", name: "Anywhere", accent: "#ffffff" }];
  return (
    <div className="pointer-events-auto absolute inset-0 z-40 flex items-center justify-center bg-black/55 p-4 backdrop-blur-sm" onClick={() => useHW.getState().set({ panel: false })}>
      <div className="hw-pop max-h-[86vh] w-[min(720px,100%)] overflow-y-auto rounded-[22px] bg-[#14161d] p-5 ring-1 ring-white/10 md:p-7" onClick={(e) => e.stopPropagation()} data-lenis-prevent>
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-white/50">Challenges</p>
            <h2 className="mt-1 text-[32px] font-black italic uppercase leading-none tracking-[-0.02em]">
              {done.length} <span className="text-white/40">/ {CHALLENGES.length}</span>
            </h2>
          </div>
          <button type="button" onClick={() => useHW.getState().set({ panel: false })} className="rounded-full bg-white px-4 py-2 text-[12px] font-bold uppercase text-[#0f1115]">
            Close
          </button>
        </div>
        <span className="mt-4 block h-[6px] overflow-hidden rounded-full bg-white/10">
          <span className="block h-full rounded-full" style={{ width: `${(done.length / CHALLENGES.length) * 100}%`, background: FLAME }} />
        </span>
        <div className="mt-5 grid gap-5 md:grid-cols-2">
          {groups.map((g) => {
            const list = CHALLENGES.filter((c) => c.ride === g.id);
            if (!list.length) return null;
            return (
              <div key={g.id}>
                <p className="flex items-center gap-2 text-[13px] font-black italic uppercase">
                  <span className="h-2 w-2 rounded-full" style={{ background: g.accent }} />
                  {g.name}
                </p>
                <ul className="mt-2 space-y-1.5">
                  {list.map((c) => {
                    const ok = done.includes(c.id);
                    return (
                      <li key={c.id} className={`flex gap-3 rounded-[12px] px-3 py-2 ${ok ? "bg-[#34c759]/15" : "bg-white/[0.05]"}`}>
                        <span className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px] font-black ${ok ? "bg-[#34c759] text-[#0f1115]" : "ring-1 ring-white/25"}`}>{ok ? "✓" : ""}</span>
                        <span>
                          <span className={`block text-[13px] font-bold ${ok ? "text-white" : "text-white/85"}`}>{c.title}</span>
                          <span className="block text-[11.5px] leading-snug text-white/55">{c.desc}</span>
                        </span>
                      </li>
                    );
                  })}
                </ul>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/** A challenge just completed: a banner across the top for a few seconds. */
export function ChallengeToast() {
  // the game clears it again after a few seconds
  const shown = useHW((s) => s.toast);
  if (!shown) return null;
  return (
    <div key={shown.id} className="hw-pop pointer-events-none absolute left-1/2 top-[124px] z-30 w-[min(520px,92vw)] -translate-x-1/2">
      <div className="rounded-[18px] p-[2px]" style={{ background: FLAME }}>
        <div className="flex items-center gap-4 rounded-[16px] bg-[#14161d] px-5 py-3">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-[22px]" style={{ background: FLAME }}>
            🏆
          </span>
          <span>
            <span className="block font-mono text-[9.5px] uppercase tracking-[0.16em] text-[#ffd21f]">Challenge complete</span>
            <span className="block text-[20px] font-black italic uppercase leading-tight">{shown.title}</span>
            <span className="block text-[11.5px] text-white/60">{shown.desc}</span>
          </span>
        </div>
      </div>
    </div>
  );
}
