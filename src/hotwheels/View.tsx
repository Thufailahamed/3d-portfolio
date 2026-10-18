"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { person } from "@/content/site";
import { MODELS, sample, type Model } from "./car";
import { scaleKmh } from "./game";
import { ATTRACTIONS, type AttractionId } from "./park";
import { playClick, setMuted, unlockSound } from "./sound";
import { CHALLENGES } from "./challenges";
import { ChallengeToast, ChallengesPanel, DriveHud, TouchPads } from "./DriveUI";
import { CAM_MODES, announce, control, useHW, type CamMode, type FeedItem } from "./store";

const Scene = dynamic(() => import("./Scene"), { ssr: false });

const STOPS: { id: "overview" | AttractionId; label: string }[] = [
  { id: "overview", label: "Park" },
  { id: "loop", label: "Mega Loop" },
  { id: "jump", label: "Sky Jump" },
  { id: "drag", label: "Drag Strip" },
  { id: "cyclone", label: "Cyclone" },
  { id: "junction", label: "Junction" },
  { id: "yard", label: "Stunt Yard" },
];

const nextCam = (c: CamMode): CamMode => CAM_MODES[(CAM_MODES.findIndex((m) => m.id === c) + 1) % CAM_MODES.length].id;
const CAM_HINT: Record<CamMode, string> = { chase: "Rides behind the car, out to the side through loops", tv: "Trackside cameras cut as the car goes by", onboard: "On the roof, every loop and roll included", orbit: "Stays on the attraction" };
/** Move to the next camera mode and say which it is. */
function switchCam(c: CamMode) {
  const next = nextCam(c);
  useHW.getState().set({ cam: next });
  announce(`CAMERA · ${CAM_MODES.find((m) => m.id === next)!.label}`, "info", CAM_HINT[next]);
}

/** The camera-mode button: shows the current mode, a click (or C) moves to the next. */
function CamButton({ cam }: { cam: CamMode }) {
  const label = CAM_MODES.find((m) => m.id === cam)!.label;
  return (
    <button
      type="button"
      onClick={() => {
        unlockSound();
        playClick();
        switchCam(cam);
      }}
      aria-label={`Camera: ${label} (C to change)`}
      title={`Camera: ${label} (C)`}
      className="flex h-10 items-center gap-2 rounded-full px-3 text-[12px] font-bold uppercase tracking-wide text-[#0f1115]"
      style={{ background: FLAME }}
    >
      <svg aria-hidden width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round">
        <path d="M3 7h3l2-3h8l2 3h3v12H3z" />
        <circle cx="12" cy="13" r="3.6" />
      </svg>
      <span className="hidden min-w-[66px] text-left min-[1700px]:inline">{label}</span>
    </button>
  );
}

/** A top-down map of the park: every track in its attraction's colour, and a dot per car. */
function MiniMap() {
  const map = useHW((s) => s.map);
  const dots = useHW((s) => s.dots);
  if (!map) return null;
  return (
    <div className="pointer-events-none rounded-[14px] bg-black/50 p-2 ring-1 ring-white/10 backdrop-blur-xl">
      <svg viewBox={`0 0 100 ${map.h.toFixed(1)}`} className="block w-[210px]" aria-hidden>
        {map.paths.map((p, i) => (
          <path key={i} d={p.d} fill="none" stroke={p.color} strokeOpacity={0.85} strokeWidth={1.3} strokeLinecap="round" strokeLinejoin="round" />
        ))}
        {dots.map((d, i) => (
          <g key={i}>
            {d.me && <circle cx={d.x} cy={d.y} r={3.4} fill="none" stroke="#fff" strokeWidth={0.7} />}
            <circle cx={d.x} cy={d.y} r={d.me ? 1.9 : 1.4} fill={d.color} stroke="#000" strokeWidth={0.35} />
          </g>
        ))}
      </svg>
    </div>
  );
}

const FLAME = "linear-gradient(100deg,#ffd21f 0%,#ff7a00 45%,#ff2d1a 100%)";
const INK = "#0f1115";

/** The park's mark: a strip of orange track swooping through a loop. */
function Logo() {
  return (
    <svg aria-hidden width="38" height="26" viewBox="0 0 38 26" fill="none">
      <path d="M2 21c8 0 12-1 16-6s2-11-3-11-6 7-1 10 10 3 22 3" stroke="url(#hwg)" strokeWidth="4.4" strokeLinecap="round" />
      <path d="M2 21c8 0 12-1 16-6s2-11-3-11-6 7-1 10 10 3 22 3" stroke="#fff" strokeOpacity=".5" strokeWidth="1" strokeLinecap="round" />
      <defs>
        <linearGradient id="hwg" x1="0" y1="0" x2="38" y2="0" gradientUnits="userSpaceOnUse">
          <stop stopColor="#ffd21f" />
          <stop offset=".5" stopColor="#ff7a00" />
          <stop offset="1" stopColor="#ff2d1a" />
        </linearGradient>
      </defs>
    </svg>
  );
}

/** A side silhouette of a model, drawn from the same profiles the 3D body is lofted from. */
function Silhouette({ m, className = "" }: { m: Model; className?: string }) {
  const d = useMemo(() => {
    const W = 100;
    const H = 34;
    const sx = (z: number) => ((z + 1) / 2) * W;
    const sy = (y: number) => H - 2 - y * 9.2;
    const top: string[] = [];
    const bot: string[] = [];
    for (let i = 0; i <= 60; i++) {
      const z = -1 + (i / 60) * 2;
      let t = sample(m.body.top, z);
      if (z >= m.cabin.z0 && z <= m.cabin.z1) t = Math.max(t, sample(m.cabin.roof, z));
      for (const e of m.extras) if (e.k === "wing" && Math.abs(z - e.z) < 0.08) t = Math.max(t, e.h + 0.05);
      top.push(`${sx(z).toFixed(1)},${sy(t).toFixed(1)}`);
      bot.unshift(`${sx(z).toFixed(1)},${sy(sample(m.body.bottom, z)).toFixed(1)}`);
    }
    return `M${top.join("L")}L${bot.join("L")}Z`;
  }, [m]);
  const wheels = [m.wheels.front, m.wheels.rear];
  return (
    <svg aria-hidden viewBox="0 0 100 34" className={className}>
      <path d={d} fill={m.paint.color} stroke="rgba(0,0,0,.35)" strokeWidth=".6" />
      {wheels.map((w, i) => (
        <g key={i}>
          <circle cx={((w.z + 1) / 2) * 100} cy={34 - 2 - w.r * 9.2} r={w.r * 9.2} fill="#141414" />
          <circle cx={((w.z + 1) / 2) * 100} cy={34 - 2 - w.r * 9.2} r={w.r * 6} fill="#d9dde2" />
        </g>
      ))}
    </svg>
  );
}

function Pip({ n, of = 5, color }: { n: number; of?: number; color: string }) {
  return (
    <span className="flex gap-[3px]">
      {Array.from({ length: of }, (_, i) => (
        <span key={i} className="h-[5px] w-[9px] skew-x-[-20deg] rounded-[1px]" style={{ background: i < n ? color : "rgba(255,255,255,.14)" }} />
      ))}
    </span>
  );
}

/** A car in its blister pack: card back with the name, the car in a bubble. */
function CarCard({ m, i, on, onPick }: { m: Model; i: number; on: boolean; onPick: () => void }) {
  return (
    <button
      type="button"
      onClick={onPick}
      aria-pressed={on}
      title={`${m.name} (${i + 1})`}
      className={`group relative flex w-[132px] shrink-0 flex-col overflow-hidden rounded-[14px] text-left transition-all duration-300 md:w-[150px] ${on ? "-translate-y-2 ring-2 ring-[#ffd21f]" : "opacity-80 ring-1 ring-white/10 hover:-translate-y-1 hover:opacity-100"}`}
      style={{ background: `linear-gradient(160deg, ${m.paint.color}33, #11131a 60%)` }}
    >
      <span className="flex items-center justify-between px-2.5 pt-2">
        <span className="font-mono text-[9px] uppercase tracking-[0.16em] text-white/50">{String(i + 1).padStart(2, "0")} / 06</span>
        <span className="rounded-[3px] px-1 font-mono text-[8.5px] font-bold uppercase tracking-wider" style={{ background: on ? FLAME : "rgba(255,255,255,.12)", color: on ? INK : "rgba(255,255,255,.7)" }}>
          1:64
        </span>
      </span>
      {/* the blister bubble */}
      <span className="mx-2 mt-1.5 rounded-[12px] bg-gradient-to-b from-white/[0.16] to-white/[0.04] px-2 py-1.5 shadow-[inset_0_1px_0_rgba(255,255,255,.35),inset_0_-8px_16px_rgba(0,0,0,.25)]">
        <Silhouette m={m} className="h-[30px] w-full drop-shadow-[0_3px_3px_rgba(0,0,0,.5)] transition-transform duration-300 group-hover:translate-x-1" />
      </span>
      <span className="px-2.5 pb-2 pt-1.5">
        <span className="block text-[13px] font-black italic uppercase leading-tight tracking-[-0.01em] text-white">{m.name}</span>
        <span className="mt-0.5 block truncate text-[10px] text-white/50">{m.tag}</span>
        <span className="mt-1.5 grid grid-cols-[auto_1fr] items-center gap-x-2 gap-y-0.5 font-mono text-[8.5px] uppercase tracking-wider text-white/45">
          Speed <Pip n={m.stats.speed} color="#ffd21f" />
          Weight <Pip n={m.stats.weight} color="#ff7a00" />
        </span>
      </span>
    </button>
  );
}

function FeedLine({ f }: { f: FeedItem }) {
  const color = f.tone === "bad" ? "#ff5a4a" : f.tone === "gold" ? "#ffd21f" : f.tone === "good" ? "#ffffff" : "rgba(255,255,255,.75)";
  return (
    <div className="hw-pop text-right">
      <p className="text-[clamp(22px,2.6vw,38px)] font-black italic uppercase leading-[0.95] tracking-[-0.02em] drop-shadow-[0_4px_14px_rgba(0,0,0,.6)]" style={{ color, ...(f.tone === "gold" ? { backgroundImage: FLAME, WebkitBackgroundClip: "text", backgroundClip: "text", color: "transparent" } : {}) }}>
        {f.text}
      </p>
      {f.sub && <p className="mt-1 font-mono text-[10.5px] uppercase tracking-[0.14em] text-white/70 drop-shadow">{f.sub}</p>}
    </div>
  );
}

/** Hold-to-launch with the power meter: it sweeps while held; the green band is the clean run. */
function LaunchButton({ label, sub, meter }: { label: string; sub: string; meter: boolean }) {
  const charge = useHW((s) => s.charge);
  const charging = useHW((s) => s.charging);
  const sweet = useHW((s) => s.sweet);
  const down = useRef(false);
  const press = (e: React.PointerEvent) => {
    e.preventDefault();
    unlockSound();
    down.current = true;
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
    control.press();
  };
  const release = () => {
    if (!down.current) return;
    down.current = false;
    control.release();
  };
  const inSweet = sweet && charge >= sweet[0] && charge <= sweet[1];
  return (
    <div className="pointer-events-auto flex flex-col items-center gap-2">
      {meter && (
        <div className={`relative h-[12px] w-[min(320px,70vw)] overflow-hidden rounded-full bg-black/50 ring-1 ring-white/15 transition-opacity duration-300 ${charging ? "opacity-100" : "opacity-60"}`}>
          {sweet && <span className="absolute inset-y-0 bg-[#34c759]/40" style={{ left: `${sweet[0] * 100}%`, width: `${(sweet[1] - sweet[0]) * 100}%` }} />}
          <span className="absolute inset-y-0 left-0 rounded-full" style={{ width: `${charge * 100}%`, background: FLAME, boxShadow: "0 0 14px rgba(255,120,0,.7)" }} />
          {[0.25, 0.5, 0.75].map((t) => (
            <span key={t} className="absolute inset-y-0 w-px bg-white/25" style={{ left: `${t * 100}%` }} />
          ))}
        </div>
      )}
      <button
        type="button"
        onPointerDown={press}
        onPointerUp={release}
        onPointerCancel={release}
        onLostPointerCapture={release}
        className="relative select-none rounded-[18px] px-9 py-3.5 text-[22px] font-black italic uppercase leading-none tracking-[-0.01em] text-[#0f1115] shadow-[0_18px_40px_-14px_rgba(255,90,0,.8),inset_0_-4px_0_rgba(0,0,0,.22),inset_0_2px_0_rgba(255,255,255,.5)] transition-transform duration-100 active:translate-y-[2px] md:text-[26px]"
        style={{ background: FLAME, transform: charging ? `scale(${1 + charge * 0.05})` : undefined }}
      >
        {charging && meter ? `${Math.round(charge * 100)}%` : label}
        <span className="mt-1 block font-mono text-[9.5px] font-bold not-italic tracking-[0.16em] text-[#0f1115]/70">{charging && meter ? (inSweet ? "IN THE GREEN — LET GO" : "RELEASE TO FIRE") : sub}</span>
      </button>
    </div>
  );
}

function Toggle({ on, onClick, label, k, children, wide = false }: { on: boolean; onClick: () => void; label: string; k: string; children: React.ReactNode; wide?: boolean }) {
  return (
    <button
      type="button"
      onClick={() => {
        unlockSound();
        playClick();
        onClick();
      }}
      aria-pressed={on}
      aria-label={`${label} (${k})`}
      title={`${label} (${k})`}
      className={`${wide ? "hidden sm:flex" : "flex"} h-10 items-center gap-1.5 rounded-full px-3 text-[12px] font-bold uppercase tracking-wide transition-colors ${on ? "text-[#0f1115]" : "bg-black/45 text-white/80 ring-1 ring-white/12 hover:bg-black/60 hover:text-white"}`}
      style={on ? { background: FLAME } : undefined}
    >
      {children}
      <span className="hidden min-[1880px]:inline">{label}</span>
    </button>
  );
}

const ico = { width: 16, height: 16, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 2.2, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };

export default function View() {
  const ready = useHW((s) => s.ready);
  const progress = useHW((s) => s.progress);
  const stop = useHW((s) => s.stop);
  const model = useHW((s) => s.model);
  const feed = useHW((s) => s.feed);
  const records = useHW((s) => s.records);
  const race = useHW((s) => s.race);
  const cam = useHW((s) => s.cam);
  const hud = useHW((s) => s.hud);
  const g = useHW((s) => s.g);
  const air = useHW((s) => s.air);
  const junction = useHW((s) => s.junction);
  const replay = useHW((s) => s.replay);
  const canReplay = useHW((s) => s.canReplay);
  const driving = useHW((s) => s.driving);
  const ghosts = useHW((s) => s.ghosts);
  const challengesDone = useHW((s) => s.challengesDone);
  const slowmo = useHW((s) => s.slowmo);
  const night = useHW((s) => s.night);
  const sound = useHW((s) => s.sound);
  const drop = useHW((s) => s.drop);
  const speed = useHW((s) => s.speed);
  const blocksDown = useHW((s) => s.blocksDown);
  const last = useHW((s) => s.last);
  const [shown, setShown] = useState(false);
  const [now, setNow] = useState(0);
  const wrap = useRef<HTMLDivElement>(null);

  const go = useCallback((i: number) => {
    const n = STOPS.length;
    useHW.getState().set({ target: Math.max(0, Math.min(n - 1, i)), charging: false, last: null });
  }, []);

  // a fresh visit starts on the overview with the loader up (the store outlives the page)
  useEffect(() => {
    useHW.getState().set({ ready: false, progress: 0, target: 0, stop: 0, charging: false, charge: 0, feed: [], last: null, race: { phase: "idle", ambers: 0 }, drop: false, slowmo: false, hud: true, replay: { on: false, k: 0 }, canReplay: false, dots: [] });
  }, []);
  useEffect(() => setMuted(!sound), [sound]);
  useEffect(() => {
    if (!ready) return;
    const id = setTimeout(() => setShown(true), 200);
    return () => clearTimeout(id);
  }, [ready]);
  // the feed fades on its own clock
  useEffect(() => {
    const id = setInterval(() => setNow(performance.now()), 250);
    return () => clearInterval(id);
  }, []);

  // keys
  useEffect(() => {
    let spaceDown = false;
    // driving: which keys are held, turned into throttle and steering
    const held = new Set<string>();
    const steerKeys = () => {
      const on = (...ks: string[]) => ks.some((x) => held.has(x));
      control.drive({ throttle: (on("w", "arrowup") ? 1 : 0) - (on("s", "arrowdown") ? 1 : 0), steer: (on("d", "arrowright") ? 1 : 0) - (on("a", "arrowleft") ? 1 : 0), nitro: on("shift"), handbrake: on("x") });
    };
    const onDriveKey = (e: KeyboardEvent, down: boolean) => {
      const k = e.key.toLowerCase();
      if (["w", "a", "s", "d", "arrowup", "arrowdown", "arrowleft", "arrowright", "shift", "x"].includes(k)) {
        if (down) held.add(k);
        else held.delete(k);
        steerKeys();
        return true;
      }
      if (!down) return k === " ";
      if (k === " ") control.drive({ hop: true });
      else if (k === "r") control.respawn();
      else if (k === "t") control.resetToys();
      else if (k === "escape") control.stopDrive();
      else return false;
      return true;
    };
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.closest("input, textarea") || e.metaKey || e.ctrlKey || e.altKey) return;
      const s = useHW.getState();
      const k = e.key.toLowerCase();
      if (s.driving && !s.replay.on && onDriveKey(e, true)) {
        e.preventDefault();
        return;
      }
      if (k === "j") {
        s.set({ panel: !s.panel });
        e.preventDefault();
        return;
      }
      if (k === "g") {
        s.set({ ghosts: !s.ghosts });
        announce(s.ghosts ? "Ghosts off" : "Ghosts on", "info", s.ghosts ? "" : "Your best runs race alongside you");
        e.preventDefault();
        return;
      }
      if (e.key === "Escape" && s.panel) {
        s.set({ panel: false });
        e.preventDefault();
        return;
      }
      if (e.key === " " || e.key === "Enter") {
        if (!spaceDown) {
          spaceDown = true;
          unlockSound();
          if (s.stop === 0) control.launchAll();
          else control.press();
        }
      } else if (e.key === "ArrowRight") go(Math.round(s.target) + 1);
      else if (e.key === "ArrowLeft") go(Math.round(s.target) - 1);
      else if (/^[1-6]$/.test(e.key)) s.set({ model: Number(e.key) - 1 });
      else if (k === "c") switchCam(s.cam);
      else if (k === "p") control.replay();
      else if (k === "h") s.set({ hud: !s.hud });
      else if (e.key === "Escape" && s.replay.on) control.replay();
      else if (k === "s") s.set({ slowmo: !s.slowmo });
      else if (k === "l" || k === "n") s.set({ night: !s.night });
      else if (k === "d") s.set({ drop: !s.drop });
      else if (k === "r") control.reset();
      else if (k === "a") control.launchAll();
      else if (k === "m") s.set({ sound: !s.sound });
      else if (e.key === "Home") go(0);
      else return;
      e.preventDefault();
    };
    const onUp = (e: KeyboardEvent) => {
      if (useHW.getState().driving && onDriveKey(e, false)) return;
      if (e.key === " " || e.key === "Enter") {
        spaceDown = false;
        control.release();
      }
    };
    addEventListener("keydown", onKey);
    addEventListener("keyup", onUp);
    return () => {
      removeEventListener("keydown", onKey);
      removeEventListener("keyup", onUp);
    };
  }, [go]);

  const a = stop > 0 ? ATTRACTIONS.find((x) => x.id === STOPS[stop].id)! : null;
  const rec = a ? records[a.id] : undefined;
  const live = feed.filter((f) => now - f.t < 3800);

  let launch: { label: string; sub: string; meter: boolean } = { label: "Launch all", sub: "SPACE · EVERY ATTRACTION", meter: false };
  if (replay.on) launch = { label: "Back to live", sub: "SPACE · P · ESC", meter: false };
  else if (a?.id === "drag") {
    launch =
      race.phase === "countdown" || race.phase === "go"
        ? { label: race.phase === "go" ? "GO!" : "Hold…", sub: "RELEASE ON GREEN", meter: true }
        : race.phase === "racing"
          ? { label: "Racing", sub: "…", meter: false }
          : { label: race.phase === "done" ? "Rematch" : "Start race", sub: "HOLD SPACE · RELEASE ON GREEN", meter: false };
  } else if (a?.kind === "launcher") launch = { label: "Launch", sub: "HOLD SPACE · RELEASE TO FIRE", meter: true };
  else if (a?.kind === "drive") launch = { label: "Drive", sub: "SPACE · TAKE THE WHEEL", meter: false };
  else if (a?.kind === "drop") launch = { label: "Drop in", sub: `SPACE · ${junction.cars ? `${junction.cars} ON THE 8 · ADD ANOTHER` : "SET A CAR DOWN"}`, meter: false };
  else if (a) launch = { label: "Release", sub: "SPACE · OPEN THE GATE", meter: false };

  const startKind = (k: string) => (k === "launcher" ? "spring launcher" : k === "drop" ? "hand-placed · boosted" : k === "drive" ? "you drive" : "gravity start");
  const tiles: [string, string][] =
    a?.id === "yard"
      ? [
          ["Best lap", rec?.time !== undefined ? `${rec.time.toFixed(2)}s` : "—"],
          ["Best score", rec?.score ? rec.score.toLocaleString() : "—"],
          ["Challenges", `${CHALLENGES.filter((c) => c.ride === "yard" && challengesDone.includes(c.id)).length}/${CHALLENGES.filter((c) => c.ride === "yard").length}`],
        ]
      : a?.id === "junction"
      ? [
          ["Streak", `${junction.streak}`],
          ["Best streak", rec?.laps ? `${rec.laps}` : "—"],
          ["On the 8", `${junction.cars}`],
        ]
      : [
          ["Best time", rec?.time !== undefined ? `${rec.time.toFixed(2)}s` : "—"],
          [a?.id === "drag" ? "Top speed" : "Best air", a?.id === "drag" ? (rec?.top ? `${scaleKmh(rec.top)}` : "—") : rec?.air ? `${rec.air.toFixed(2)}s` : "—"],
          [a?.id === "drag" ? "Cars" : "Peak load", a?.id === "drag" ? "2" : rec?.g ? `${rec.g.toFixed(1)}g` : "—"],
        ];
  const camLabel = CAM_MODES.find((m) => m.id === cam)!.label;

  return (
    <div ref={wrap} data-lenis-prevent className="fixed inset-0 h-dvh select-none overflow-hidden bg-[#d8cfc2] text-white" style={{ cursor: drop ? "copy" : "grab" }}>
      <div className="absolute inset-0 touch-none">
        <Scene />
      </div>

      {/* —— the interface hidden: just a way back —— */}
      {shown && !hud && (
        <button type="button" onClick={() => useHW.getState().set({ hud: true })} className="absolute bottom-4 right-gutter z-20 rounded-full bg-black/45 px-3.5 py-2 font-mono text-[10px] uppercase tracking-[0.14em] text-white/80 backdrop-blur hover:bg-black/60">
          H · show interface
        </button>
      )}

      {/* —— instant replay —— */}
      {shown && replay.on && (
        <div className="pointer-events-none absolute inset-x-0 top-[86px] z-20 flex justify-center px-gutter min-[1760px]:top-[78px]">
          <div className="hw-pop pointer-events-auto flex items-center gap-3 rounded-full bg-black/65 py-1.5 pl-2 pr-1.5 ring-1 ring-white/12 backdrop-blur-xl">
            <span className="flex items-center gap-1.5 rounded-full bg-[#ff2d1a] px-2.5 py-1 text-[11px] font-black italic uppercase tracking-wide">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-white" />
              Replay
            </span>
            <span className="relative h-[5px] w-[min(260px,40vw)] overflow-hidden rounded-full bg-white/15">
              <span className="absolute inset-y-0 left-0 rounded-full" style={{ width: `${replay.k * 100}%`, background: FLAME }} />
            </span>
            <span className="font-mono text-[9.5px] uppercase tracking-[0.14em] text-white/60">{cam === "onboard" ? "onboard" : "trackside"} · ¼ speed</span>
            <button type="button" onClick={() => control.replay()} className="rounded-full bg-white px-3 py-1 text-[11px] font-bold uppercase tracking-wide text-[#0f1115]">
              Exit
            </button>
          </div>
        </div>
      )}

      {hud && (
        <>
          {/* —— top bar —— */}
          <header className="pointer-events-none absolute inset-x-0 top-0 z-20 flex items-start justify-between gap-3 px-gutter pt-4">
            <Link href="/" className="pointer-events-auto flex shrink-0 items-center gap-2.5 rounded-full bg-black/55 py-2 pl-3 pr-3 ring-1 sm:pr-4 ring-white/10 backdrop-blur-xl" aria-label={`${person.name} — back to the main site`}>
              <Logo />
              <span className="hidden leading-none sm:block">
                <span className="block text-[14px] font-black italic uppercase tracking-[-0.01em]">Die-Cast Speedway</span>
                <span className="mt-0.5 block font-mono text-[9px] uppercase tracking-[0.16em] text-white/55">{person.shortName} · stunt park</span>
              </span>
            </Link>

            <nav aria-label="Attractions" className="pointer-events-auto absolute left-1/2 top-4 hidden -translate-x-1/2 gap-1 rounded-full bg-black/55 p-1 ring-1 ring-white/10 backdrop-blur-xl min-[1760px]:flex">
              {STOPS.map((s, i) => {
                const at = ATTRACTIONS.find((x) => x.id === s.id);
                const on = i === stop;
                return (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => {
                      playClick();
                      go(i);
                    }}
                    aria-current={on ? "true" : undefined}
                    className={`flex items-center gap-2 rounded-full px-3.5 py-2 text-[12.5px] font-black italic uppercase tracking-[-0.005em] transition-colors ${on ? "text-[#0f1115]" : "text-white/70 hover:bg-white/10 hover:text-white"}`}
                    style={on ? { background: FLAME } : undefined}
                  >
                    {at && <span className="h-2 w-2 rounded-full" style={{ background: on ? INK : at.accent }} />}
                    {s.label}
                  </button>
                );
              })}
            </nav>

            <div className="pointer-events-auto flex flex-wrap items-center justify-end gap-1.5">
              <button
                type="button"
                onClick={() => {
                  playClick();
                  useHW.getState().set({ panel: true });
                }}
                title="Challenges (J)"
                aria-label={`Challenges: ${challengesDone.length} of ${CHALLENGES.length} done (J)`}
                className="flex h-10 items-center gap-1.5 rounded-full bg-black/45 px-3 text-[12px] font-bold text-white ring-1 ring-white/12 hover:bg-black/60"
              >
                <span aria-hidden>🏆</span>
                <span className="tabular-nums">
                  {challengesDone.length}/{CHALLENGES.length}
                </span>
              </button>
              <CamButton cam={cam} />
              <Toggle on={replay.on} onClick={() => control.replay()} label="Replay" k="P">
                <svg aria-hidden {...ico}>
                  <path d="M4 12a8 8 0 1 0 2.4-5.7L4 8.6" />
                  <path d="M4 3.5v5.1h5.1" />
                  <path d="m10.5 9.2 4.5 2.8-4.5 2.8z" fill="currentColor" />
                </svg>
              </Toggle>
              <Toggle on={ghosts} onClick={() => useHW.getState().set({ ghosts: !ghosts })} label="Ghosts" k="G" wide>
                <svg aria-hidden {...ico}>
                  <path d="M5 21V11a7 7 0 0 1 14 0v10l-2.5-2-2.3 2-2.2-2-2.2 2-2.3-2z" />
                  <circle cx="9.5" cy="11" r="1" fill="currentColor" />
                  <circle cx="14.5" cy="11" r="1" fill="currentColor" />
                </svg>
              </Toggle>
              <Toggle on={slowmo} onClick={() => useHW.getState().set({ slowmo: !slowmo })} label="Slow-mo" k="S">
                <svg aria-hidden {...ico}>
                  <circle cx="12" cy="13" r="8" />
                  <path d="M12 9v4l2.5 2.5M9.5 2.5h5" />
                </svg>
              </Toggle>
              <Toggle on={drop} onClick={() => useHW.getState().set({ drop: !drop })} label="Drop cars" k="D" wide>
                <svg aria-hidden {...ico}>
                  <path d="M12 3v11M7 9.5l5 5 5-5M4 20h16" />
                </svg>
              </Toggle>
              <Toggle on={night} onClick={() => useHW.getState().set({ night: !night })} label="Lights out" k="L">
                <svg aria-hidden {...ico}>
                  <path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5Z" />
                </svg>
              </Toggle>
              <Toggle on={!sound} onClick={() => useHW.getState().set({ sound: !sound })} label={sound ? "Mute" : "Unmute"} k="M">
                <svg aria-hidden {...ico}>
                  <path d="M11 5 6 9H3v6h3l5 4z" />
                  {sound ? <path d="M15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13" /> : <path d="m16 9 5 6M21 9l-5 6" />}
                </svg>
              </Toggle>
              <Toggle on={false} onClick={() => control.reset()} label="Reset" k="R">
                <svg aria-hidden {...ico}>
                  <path d="M3 12a9 9 0 1 0 3-6.7L3 8" />
                  <path d="M3 3v5h5" />
                </svg>
              </Toggle>
              <Toggle on={false} onClick={() => useHW.getState().set({ hud: false })} label="Hide interface" k="H" wide>
                <svg aria-hidden {...ico}>
                  <path d="M3 3l18 18M10.6 10.6a2 2 0 0 0 2.8 2.8M9.9 5.2A10.4 10.4 0 0 1 12 5c6.5 0 10 7 10 7a17 17 0 0 1-3.2 4M6.6 6.6C3.6 8.5 2 12 2 12s3.5 7 10 7a9.7 9.7 0 0 0 5.4-1.6" />
                </svg>
              </Toggle>
              <Link href="/" className="hidden h-10 items-center rounded-full bg-white px-4 text-[12px] font-bold uppercase tracking-wide text-[#0f1115] md:flex">
                Exit ↗
              </Link>
            </div>
          </header>

          {/* —— narrower screens: attraction switcher —— */}
          <div className="pointer-events-auto absolute inset-x-0 top-[74px] z-20 flex justify-center px-gutter min-[1760px]:hidden">
            <div className="flex items-center gap-1 rounded-full bg-black/55 p-1 ring-1 ring-white/10 backdrop-blur-xl">
              <button type="button" onClick={() => go(stop - 1)} className="h-8 w-8 rounded-full text-white/80" aria-label="Previous attraction">
                ←
              </button>
              <span className="min-w-[120px] text-center text-[13px] font-black italic uppercase">{STOPS[stop].label}</span>
              <button type="button" onClick={() => go(stop + 1)} className="h-8 w-8 rounded-full text-white/80" aria-label="Next attraction">
                →
              </button>
            </div>
          </div>

          {/* —— the attraction card —— */}
          {shown && (
            <div key={stop} className="sr-panel pointer-events-none absolute left-gutter top-[132px] z-10 hidden w-[min(330px,30vw)] md:block min-[1760px]:top-[86px]">
              <div className="pointer-events-auto rounded-[20px] bg-black/55 p-5 ring-1 ring-white/10 backdrop-blur-xl">
                {a ? (
                  <>
                    <p className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.16em] text-white/55">
                      <span className="h-2 w-2 rounded-full" style={{ background: a.accent }} />
                      Attraction {String(stop).padStart(2, "0")} · {startKind(a.kind)}
                    </p>
                    <h2 className="mt-2 text-[34px] font-black italic uppercase leading-[0.9] tracking-[-0.03em]">{a.name}</h2>
                    <p className="mt-2.5 text-[13.5px] leading-relaxed text-white/72">{a.blurb}</p>
                    <dl className="mt-4 grid grid-cols-3 gap-2">
                      {tiles.map(([k, val]) => (
                        <div key={k} className="rounded-[10px] bg-white/[0.06] px-2.5 py-2">
                          <dt className="font-mono text-[8.5px] uppercase tracking-[0.14em] text-white/45">{k}</dt>
                          <dd className="mt-0.5 text-[18px] font-black italic tabular-nums">{val}</dd>
                        </div>
                      ))}
                    </dl>
                    {a.id === "jump" && <p className="mt-3 font-mono text-[10px] uppercase tracking-[0.14em] text-white/50">Castle: {blocksDown} blocks down</p>}
                    {a.id === "loop" && <p className="mt-3 font-mono text-[10px] uppercase tracking-[0.14em] text-white/50">Let go in the green band to clear both loops · each car&apos;s band is its own</p>}
                    {a.id === "junction" && <p className="mt-3 font-mono text-[10px] uppercase tracking-[0.14em] text-white/50">Laps count while two or more cars are running</p>}
                    {a.id === "drag" && <p className="mt-3 font-mono text-[10px] uppercase tracking-[0.14em] text-white/50">Lighter cars leave the spring faster; sleeker ones hold their speed</p>}
                  </>
                ) : (
                  <>
                    <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-white/55">Welcome to the park</p>
                    <h1 className="mt-2 text-[36px] font-black italic uppercase leading-[0.88] tracking-[-0.03em]">
                      Six rides.
                      <br />
                      <span style={{ backgroundImage: FLAME, WebkitBackgroundClip: "text", backgroundClip: "text", color: "transparent" }}>Six cars.</span>
                    </h1>
                    <p className="mt-2.5 text-[13.5px] leading-relaxed text-white/72">A stunt park on the living-room floor. Pick a car, pick a ride, and send it. Every loop, jump and crash is real physics — each car&apos;s weight and shape changes how it runs. Then take the wheel yourself in the Stunt Yard.</p>
                    <ul className="mt-3 space-y-1.5">
                      {ATTRACTIONS.map((x, i) => (
                        <li key={x.id}>
                          <button type="button" onClick={() => go(i + 1)} className="group flex w-full items-center gap-2 text-left text-[13px] font-bold italic uppercase">
                            <span className="h-2 w-2 rounded-full" style={{ background: x.accent }} />
                            <span className="group-hover:underline">{x.name}</span>
                            <span className="ml-auto font-mono text-[9.5px] not-italic text-white/40">
                              {x.id === "yard" ? (records.yard?.time !== undefined ? `${records.yard.time.toFixed(2)}s lap` : "→") : x.id === "junction" ? (records.junction?.laps ? `${records.junction.laps} laps` : "→") : records[x.id]?.time !== undefined ? `${records[x.id]!.time!.toFixed(2)}s` : "→"}
                            </span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  </>
                )}
              </div>
            </div>
          )}

          {/* —— the stunt feed —— */}
          <div aria-live="polite" className="pointer-events-none absolute right-gutter top-[132px] z-10 flex max-w-[48vw] flex-col items-end gap-3 min-[1760px]:top-[96px]">
            {live.map((f) => (
              <FeedLine key={f.id} f={f} />
            ))}
          </div>

          {/* —— speedometer and load meter —— */}
          {shown && speed > 20 && (
            <div className="pointer-events-none absolute bottom-[218px] right-gutter z-10 text-right md:bottom-[230px]">
              <p className="text-[clamp(30px,3.4vw,48px)] font-black italic leading-none tabular-nums drop-shadow-[0_4px_14px_rgba(0,0,0,.5)]">
                {scaleKmh(speed)}
                <span className="ml-1 text-[14px] text-white/70">km/h</span>
              </p>
              <p className="mt-1 font-mono text-[9.5px] uppercase tracking-[0.14em] text-white/65 drop-shadow">scale speed · {(speed / 100).toFixed(2)} m/s real</p>
              {!replay.on && (
                <p className="mt-1.5 flex items-center justify-end gap-2 font-mono text-[10px] font-bold uppercase tracking-[0.14em] drop-shadow">
                  {air ? (
                    <span className="rounded-[4px] bg-[#ffd21f] px-1.5 py-0.5 text-[#0f1115]">Airborne</span>
                  ) : (
                    <>
                      <span className="text-white/55">load</span>
                      <span className="relative h-[6px] w-[90px] overflow-hidden rounded-full bg-black/40">
                        <span className="absolute inset-y-0 left-0 rounded-full" style={{ width: `${Math.min(100, (Math.max(0, g) / 6) * 100)}%`, background: g > 4 ? "#ff3b30" : FLAME }} />
                      </span>
                      <span className="w-[38px] tabular-nums text-white">{Math.max(0, g).toFixed(1)}g</span>
                    </>
                  )}
                </p>
              )}
            </div>
          )}

          {/* —— minimap —— */}
          {shown && (
            <div className="absolute bottom-4 right-gutter z-10 hidden min-[1500px]:block">
              <MiniMap />
            </div>
          )}

          {/* —— drag result —— */}
          {shown && a?.id === "drag" && race.phase === "done" && race.result && !replay.on && (
            <div className="sr-rise pointer-events-none absolute left-1/2 top-[38%] z-10 -translate-x-1/2 text-center">
              <p className="text-[clamp(40px,6vw,86px)] font-black italic uppercase leading-[0.85] tracking-[-0.03em] drop-shadow-[0_8px_30px_rgba(0,0,0,.6)]" style={race.result.win ? { backgroundImage: FLAME, WebkitBackgroundClip: "text", backgroundClip: "text", color: "transparent" } : { color: "#ff5a4a" }}>
                {race.result.foul ? "Red light" : race.result.win ? "You win" : "Rival wins"}
              </p>
              <p className="mt-2 font-mono text-[11px] uppercase tracking-[0.14em] text-white/80 drop-shadow">
                {race.result.you !== undefined && `You ${race.result.you.toFixed(3)}s`}
                {race.result.rival !== undefined && ` · Rival ${race.result.rival.toFixed(3)}s`}
                {race.result.reaction !== null && ` · Reaction ${race.result.reaction.toFixed(3)}s`}
              </p>
            </div>
          )}

          {/* —— last run —— */}
          {shown && last && a && last.attraction === a.id && a.id !== "drag" && !replay.on && (
            <div key={`${last.time}-${last.air}`} className="sr-rise absolute bottom-[218px] left-gutter z-10 hidden md:block md:bottom-[230px]">
              <div className="rounded-[16px] bg-black/55 px-4 py-3 ring-1 ring-white/10 backdrop-blur-xl">
                <p className="font-mono text-[9.5px] uppercase tracking-[0.16em] text-white/50">Last run {last.record && "· new record"}</p>
                <p className="mt-1 flex gap-4 text-[15px] font-black italic tabular-nums">
                  <span>{last.time !== undefined ? `${last.time.toFixed(2)}s` : last.crashed ? "DNF" : "—"}</span>
                  <span className="text-white/70">{scaleKmh(last.top)} km/h</span>
                  <span className="text-white/70">{last.maxG.toFixed(1)}g</span>
                  {last.air > 0.1 && <span className="text-white/70">{last.air.toFixed(2)}s air</span>}
                  {last.loops > 0 && <span className="text-white/70">{last.loops}× loop</span>}
                  {last.ring && <span style={{ color: "#ffb21f" }}>ring</span>}
                </p>
                {canReplay && (
                  <button type="button" onClick={() => control.replay()} className="mt-2 flex items-center gap-1.5 rounded-full bg-white/10 px-3 py-1 text-[11px] font-bold uppercase tracking-wide text-white hover:bg-white/20">
                    ▶ Watch the replay <span className="font-mono text-[9px] text-white/50">P</span>
                  </button>
                )}
              </div>
            </div>
          )}

          {/* —— bottom: the launch control and the garage —— */}
          {shown && driving && !replay.on && (
            <div className="pointer-events-none absolute inset-x-0 top-[124px] z-10 flex flex-col items-center md:bottom-0 md:top-auto md:pb-4">
              <DriveHud />
            </div>
          )}
          {shown && driving && !replay.on && <TouchPads />}
          {shown && !(driving && !replay.on) && (
            <div className="pointer-events-none absolute inset-x-0 bottom-0 z-10 flex flex-col items-center gap-3 pb-3 md:pb-4">
              {drop && !replay.on ? (
                <p className="rounded-full bg-black/60 px-4 py-2 font-mono text-[10.5px] uppercase tracking-[0.14em] text-white/85 backdrop-blur">Click anywhere to drop the {MODELS[model].name} · D to stop</p>
              ) : (
                <LaunchButton key={`${stop}${replay.on}`} label={launch.label} sub={launch.sub} meter={launch.meter} />
              )}
              <div className="pointer-events-auto flex max-w-full gap-2 overflow-x-auto px-gutter pb-1 pt-3 [scrollbar-width:none]" data-scroll>
                {MODELS.map((m, i) => (
                  <CarCard
                    key={m.name}
                    m={m}
                    i={i}
                    on={i === model}
                    onPick={() => {
                      unlockSound();
                      playClick();
                      useHW.getState().set({ model: i });
                    }}
                  />
                ))}
              </div>
              <p className="hidden font-mono text-[9.5px] uppercase tracking-[0.14em] text-black/55 xl:block">
                Space launch · ← → rides · 1–6 cars · drag to look · scroll to zoom · C camera ({camLabel}) · P replay · J challenges · G ghosts · S slow-mo · D drop · L lights · A all · H hide · R reset
              </p>
            </div>
          )}
        </>
      )}

      {shown && <ChallengeToast />}
      <ChallengesPanel />

      {/* —— loader —— */}
      <div aria-hidden={shown} className={`absolute inset-0 z-30 flex flex-col items-center justify-center gap-6 bg-[#11131a] transition-opacity duration-700 ${shown ? "pointer-events-none opacity-0" : "opacity-100"}`}>
        <div className="relative h-[10px] w-[220px] overflow-hidden rounded-full bg-white/10">
          <span className="absolute inset-y-0 left-0 rounded-full transition-[width] duration-300" style={{ width: `${Math.max(4, progress * 100)}%`, background: FLAME }} />
          <span className="hw-loader-car absolute top-1/2 h-[14px] w-[26px] -translate-y-1/2 rounded-[4px] bg-white" style={{ left: `calc(${Math.max(4, progress * 100)}% - 26px)` }} />
        </div>
        <div className="text-center">
          <p className="text-[30px] font-black italic uppercase leading-none tracking-[-0.02em]">Laying the track</p>
          <p className="mt-2 font-mono text-[11px] uppercase tracking-[0.16em] text-white/50">{Math.round(progress * 100)}% · building cars, loops, a castle and a crossing</p>
        </div>
      </div>
    </div>
  );
}
