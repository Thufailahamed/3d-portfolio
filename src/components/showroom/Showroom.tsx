"use client";

import { useProgress } from "@react-three/drei";
import dynamic from "next/dynamic";
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { groups, type Car, type CarPart } from "@/content/cars";
import type { CameraInfo } from "./ShowroomScene";
import { cineShots, moodById, moods, shots, type MoodId, type ShotId } from "./studio";

const ShowroomScene = dynamic(() => import("./ShowroomScene"), { ssr: false });

const pad = (n: number) => String(n).padStart(2, "0");
const NONE: string[] = [];

/**
 * Exploded-view showroom for one car: click a part (or pick it from the index) to slide it out and
 * read about it. `switcher` is the car picker (/cars puts one at the bottom of the screen).
 */
export default function Showroom({
  car,
  switcher,
  onCycle,
  initialPart: given,
}: {
  car: Car;
  switcher?: ReactNode;
  /** step to the previous (-1) or next (1) car in the line-up */
  onCycle?: (d: number) => void;
  /** overrides ?part= (null after switching cars, so the new car starts assembled) */
  initialPart?: string | null;
}) {
  const partById = useMemo(() => Object.fromEntries(car.parts.map((p) => [p.id, p])) as Record<string, CarPart>, [car]);
  // the model's part groups → the part that owns them (all four wheels belong to "wheels")
  const ownerOf = useMemo(() => {
    const m: Record<string, string> = {};
    for (const p of car.parts) for (const id of p.members ?? [p.id]) m[id] = p.id;
    return m;
  }, [car]);
  const fromUrl = useSearchParams().get("part");
  const initialPart = given === undefined ? fromUrl : given;
  // old links name a single wheel or door (?part=wheel_fl); they open its whole set
  const [selected, setSelected] = useState<string | null>(initialPart ? (ownerOf[initialPart] ?? null) : null);
  const [exploded, setExploded] = useState(false);
  const [hover, setHover] = useState<{ id: string; x: number; y: number } | null>(null);
  const [ids, setIds] = useState<string[] | null>(null);
  const [listOpen, setListOpen] = useState(false);
  const [touched, setTouched] = useState(false);

  // the studio: lighting mood, paint, lamps, turntable, camera presets and the cinematic reel
  const [mood, setMood] = useState<MoodId>("studio");
  const [paintIdx, setPaintIdx] = useState(0);
  const [lights, setLights] = useState(false);
  const [turntable, setTurntable] = useState(true);
  const [shot, setShot] = useState<{ id: ShotId; n: number } | null>(null);
  const [activeShot, setActiveShot] = useState<ShotId | null>(null);
  const [studioOpen, setStudioOpen] = useState(false);
  const [cinematic, setCinematic] = useState(false);
  const [blackout, setBlackout] = useState(false);
  const [scene, setScene] = useState(0);
  // tools: dimension lines, the see-through body, photos, and the keys for all of it
  const [measure, setMeasure] = useState(false);
  const [xray, setXray] = useState(false);
  const [snap, setSnap] = useState(0);
  const flash = useRef<HTMLDivElement>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [camera, setCamera] = useState<CameraInfo | null>(null);
  const [keysOpen, setKeysOpen] = useState(false);
  const timers = useRef<number[]>([]);
  useEffect(() => () => timers.current.forEach(clearTimeout), []);

  const view = useCallback((id: ShotId) => {
    setShot((s) => ({ id, n: (s?.n ?? 0) + 1 }));
    setActiveShot(id);
    setSelected(null);
    setTouched(true);
  }, []);

  // cut to black, switch, fade back up
  const film = useCallback((on: boolean) => {
    timers.current.forEach(clearTimeout);
    setBlackout(true);
    timers.current = [
      window.setTimeout(() => {
        setCinematic(on);
        setScene(0);
        if (on) {
          setSelected(null);
          setExploded(false);
          setListOpen(false);
          setStudioOpen(false);
          setActiveShot(null);
        }
      }, 550),
      window.setTimeout(() => setBlackout(false), 800),
    ];
  }, []);
  const onCinematicShot = useCallback((i: number) => setScene(i), []);

  // only parts the model actually has, in the content's order
  const order = useMemo(() => car.parts.filter((p) => !ids || (p.members ?? [p.id]).some((id) => ids.includes(id))), [car, ids]);
  const part = selected ? partById[selected] : null;
  const index = part ? order.findIndex((p) => p.id === part.id) : -1;

  const select = useCallback((id: string | null) => {
    setSelected((cur) => (cur === id ? null : id));
    setListOpen(false);
    setTouched(true);
  }, []);
  const pick = useCallback((id: string) => ownerOf[id] && select(ownerOf[id]), [ownerOf, select]);

  const step = useCallback(
    (d: number) => {
      const i = order.findIndex((p) => p.id === selected);
      const next = order[(i + d + order.length) % order.length];
      if (next) setSelected(next.id);
    },
    [order, selected],
  );

  // ?part=engine deep links, kept in sync with the selection
  useEffect(() => {
    const url = new URL(window.location.href);
    if (selected) url.searchParams.set("part", selected);
    else url.searchParams.delete("part");
    window.history.replaceState(null, "", url);
  }, [selected]);

  const exterior = useMemo(() => car.parts.filter((p) => p.group === "Exterior").flatMap((p) => p.members ?? [p.id]), [car]);

  const photo = useCallback(() => {
    setSnap((n) => n + 1);
    if (!matchMedia("(prefers-reduced-motion: reduce)").matches)
      flash.current?.animate([{ opacity: 0.55 }, { opacity: 0 }], { duration: 500, easing: "ease-out" });
  }, []);
  const onSnap = useCallback(
    (png: string) => {
      const name = `${car.slug}-${activeShot ?? "studio"}.png`;
      const a = document.createElement("a");
      a.href = png;
      a.download = name;
      a.click();
      setSaved(name);
      timers.current.push(window.setTimeout(() => setSaved(null), 2600));
    },
    [car.slug, activeShot],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.target instanceof HTMLElement && e.target.closest("input, textarea, select, [contenteditable]")) return;
      const k = e.key.toLowerCase();
      if (e.key === "Escape") {
        if (cinematic) film(false);
        else if (keysOpen) setKeysOpen(false);
        else setSelected(null);
      } else if (k === "c") film(!cinematic);
      else if (cinematic) return;
      else if (k === "l") setLights((v) => !v);
      else if (k === "e") {
        setExploded((v) => !v);
        setSelected(null);
      } else if (k === "m") setMeasure((v) => !v);
      else if (k === "x") setXray((v) => !v);
      else if (k === "p") photo();
      else if (k === "s") setTurntable((v) => !v);
      else if (k === "?" || (k === "/" && e.shiftKey)) setKeysOpen((v) => !v);
      else if (/^[1-6]$/.test(k)) view(shots[+k - 1].id);
      else if (selected && e.key === "ArrowRight") step(1);
      else if (selected && e.key === "ArrowLeft") step(-1);
      else if (!selected && onCycle && e.key === "ArrowRight") onCycle(1);
      else if (!selected && onCycle && e.key === "ArrowLeft") onCycle(-1);
    };
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  }, [selected, step, cinematic, film, photo, view, onCycle, keysOpen]);

  const onHover = useCallback((id: string | null, x = 0, y = 0) => setHover(id && ownerOf[id] ? { id: ownerOf[id], x, y } : null), [ownerOf]);
  // the scene works with the model's groups: a set selects (and lights up) every member
  const membersOf = useCallback((id: string | null) => (id ? (partById[id]?.members ?? [id]) : NONE), [partById]);
  const selectedIds = useMemo(() => membersOf(selected), [membersOf, selected]);
  const hoveredIds = useMemo(() => membersOf(cinematic ? null : (hover?.id ?? null)), [membersOf, cinematic, hover?.id]);
  const onReady = useCallback((found: string[]) => setIds(found), []);

  return (
    <div
      className="sr-root fixed inset-0 h-dvh overflow-hidden bg-bg"
      data-cine={cinematic || undefined}
      style={{ cursor: hover && !cinematic ? "pointer" : undefined }}
      onPointerDown={() => setTouched(true)}
    >
      <div className="absolute inset-0" onPointerDown={() => setActiveShot(null)}>
        <ShowroomScene
          url={car.model}
          view={car.view}
          selected={selectedIds}
          exploded={exploded}
          hovered={hoveredIds}
          paintMaterial={car.paint.material}
          paint={paintIdx ? car.paint.colors[paintIdx] : null}
          lamps={car.lamps}
          lights={lights}
          mood={mood}
          turntable={turntable}
          shot={shot}
          cinematic={cinematic}
          measure={measure}
          xray={xray ? exterior : NONE}
          snap={snap}
          onSnap={onSnap}
          onCamera={setCamera}
          onCinematicShot={onCinematicShot}
          onHover={onHover}
          onPick={pick}
          onReady={onReady}
        />
      </div>

      {/* shade behind the text so it reads over the studio */}
      <div aria-hidden className="sr-hud pointer-events-none absolute inset-x-0 top-0 h-48 bg-gradient-to-b from-bg/80 to-transparent" />
      <div aria-hidden className="sr-hud pointer-events-none absolute inset-x-0 bottom-0 h-40 bg-gradient-to-t from-bg/90 to-transparent" />
      <div aria-hidden className="sr-hud pointer-events-none absolute inset-y-0 left-0 hidden w-[44vw] bg-gradient-to-r from-bg/75 via-bg/30 to-transparent lg:block" />
      <div aria-hidden className="grain absolute" />

      {!ids && <Loading name={car.short} />}

      {/* left column: title, numbers, and the part index on wide screens */}
      <div
        className={`sr-hud pointer-events-none absolute bottom-24 left-gutter right-gutter top-20 flex flex-col transition-opacity duration-500 md:top-24 lg:right-auto lg:w-[min(30rem,36vw)] ${
          part ? "max-md:opacity-0 max-md:[&_*]:pointer-events-none" : ""
        }`}
      >
        <p key={`m${car.slug}`} className="sr-rise label flex items-center gap-2">
          <span className="h-1.5 w-1.5 rounded-full bg-accent" />
          {car.maker} <span className="text-fg/30">/</span> {car.year}
        </p>
        <h1 key={`t${car.slug}`} className="sr-rise display mt-3 text-[clamp(34px,4.6vw,76px)]" style={{ animationDelay: "60ms" }}>
          {car.name}
        </h1>
        <p key={`g${car.slug}`} className="sr-rise mt-4 max-w-xs text-[15px] leading-snug text-fg/65" style={{ animationDelay: "120ms" }}>
          {car.tagline}
        </p>
        {switcher && <div className="pointer-events-auto mt-5 max-w-full lg:hidden">{switcher}</div>}

        <nav
          aria-label="Parts"
          data-lenis-prevent
          className={`pointer-events-auto fixed bottom-20 left-gutter right-gutter z-20 max-h-[55dvh] overflow-y-auto rounded-2xl border border-fg/10 bg-[#121214]/90 p-4 shadow-2xl backdrop-blur-xl
            ${listOpen ? "block" : "hidden"}
            lg:static lg:mt-10 lg:block lg:max-h-none lg:min-h-0 lg:w-64 lg:flex-1 lg:rounded-none lg:border-0 lg:bg-transparent lg:p-0 lg:shadow-none lg:backdrop-blur-none lg:[mask-image:linear-gradient(to_bottom,black_85%,transparent)]`}
        >
          {groups.map((g) => {
            const list = order.filter((p) => p.group === g);
            if (!list.length) return null;
            return (
              <div key={g} className="mb-5">
                <p className="label mb-2 flex items-center gap-3 !text-[10px]">
                  {g}
                  <span className="h-px flex-1 bg-fg/10" />
                  <span className="text-fg/35">{pad(list.length)}</span>
                </p>
                <ul>
                  {list.map((p) => {
                    const on = selected === p.id;
                    return (
                      <li key={p.id}>
                        <button
                          type="button"
                          aria-pressed={on}
                          onClick={() => select(p.id)}
                          onMouseEnter={() => setHover({ id: p.id, x: -999, y: -999 })}
                          onMouseLeave={() => setHover(null)}
                          className={`group flex w-full items-center gap-3 py-[5px] text-left text-sm transition-colors ${
                            on ? "text-fg" : "text-fg/55 hover:text-fg"
                          }`}
                        >
                          <span
                            className={`h-px transition-all duration-300 ${on ? "w-5 bg-accent" : "w-2 bg-fg/25 group-hover:w-4 group-hover:bg-fg/60"}`}
                          />
                          {p.name}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </div>
            );
          })}
        </nav>
      </div>

      {/* right column: the headline numbers, until a part's details take its place */}
      <dl
        key={`f${car.slug}`}
        className={`sr-hud pointer-events-none absolute right-gutter top-28 hidden w-48 transition-all duration-500 md:block ${
          part ? "translate-x-6 opacity-0" : "opacity-100"
        }`}
      >
        {car.facts.map(([k, v], i) => (
          <div key={k} className="sr-rise border-t border-fg/12 py-3 text-right" style={{ animationDelay: `${150 + i * 70}ms` }}>
            <dt className="label !text-[10px]">{k}</dt>
            <dd className="mt-1 text-xl font-light tracking-tight">{v}</dd>
          </div>
        ))}
      </dl>

      {/* the camera, read out like a viewfinder */}
      {camera && !cinematic && (
        <div aria-hidden className="sr-hud pointer-events-none absolute bottom-[5.25rem] left-gutter z-20 hidden items-center gap-3 font-mono text-[10px] uppercase tracking-[0.14em] text-fg/45 lg:flex">
          <span className="relative h-2 w-2 rounded-full border border-fg/40">
            <span className="absolute inset-[2px] rounded-full bg-accent" />
          </span>
          <span className="tabular-nums text-fg/75">{camera.mm} mm</span>
          <span className="text-fg/20">/</span>
          <span className="tabular-nums">{camera.azimuth.toString().padStart(3, "0")}°</span>
          <span className="text-fg/20">/</span>
          <span className="tabular-nums">h {camera.elevation.toFixed(2)} m</span>
          <span className="text-fg/20">/</span>
          <span className="tabular-nums">{camera.distance.toFixed(1)} m out</span>
          {(measure || xray) && (
            <>
              <span className="text-fg/20">/</span>
              <span className="text-accent">{[measure && "Measuring", xray && "X-ray"].filter(Boolean).join(" · ")}</span>
            </>
          )}
        </div>
      )}

      {/* the shutter: a white flash, then where the photo went */}
      <div ref={flash} aria-hidden className="pointer-events-none absolute inset-0 z-[55] bg-white opacity-0" />
      <div
        role="status"
        className={`sr-hud pointer-events-none absolute left-1/2 top-24 z-50 -translate-x-1/2 rounded-full border border-fg/15 bg-[#121214]/85 px-4 py-2 font-mono text-[10px] uppercase tracking-[0.14em] text-fg backdrop-blur-md transition-all duration-500 ${
          saved ? "translate-y-0 opacity-100" : "-translate-y-2 opacity-0"
        }`}
      >
        <span className="mr-2 inline-block h-1.5 w-1.5 rounded-full bg-accent" />
        {saved ? `Saved ${saved}` : "\u00a0"}
      </div>

      {keysOpen && <Keys onClose={() => setKeysOpen(false)} cycle={!!onCycle} />}

      {/* bottom bar: controls, car picker, credit */}
      <div className="sr-hud absolute inset-x-gutter bottom-5 z-30 flex items-end justify-between gap-4">
        <div className="flex gap-2">
          <button
            type="button"
            className="hud-btn border-fg/15 bg-[#121214]/70 backdrop-blur-md lg:hidden"
            aria-expanded={listOpen}
            onClick={() => {
              setListOpen((v) => !v);
              setStudioOpen(false);
            }}
          >
            {listOpen ? "Close" : `Parts · ${order.length}`}
          </button>
          <button
            type="button"
            className={`hud-btn border-fg/15 backdrop-blur-md md:hidden ${studioOpen ? "!bg-fg !text-bg" : "bg-[#121214]/70"}`}
            aria-expanded={studioOpen}
            onClick={() => {
              setStudioOpen((v) => !v);
              setListOpen(false);
            }}
          >
            Studio
          </button>
          <button
            type="button"
            className={`hud-btn flex items-center gap-2 border-fg/15 backdrop-blur-md ${exploded ? "!bg-fg !text-bg" : "bg-[#121214]/70"}`}
            aria-pressed={exploded}
            onClick={() => {
              setExploded((v) => !v);
              setSelected(null);
              setTouched(true);
            }}
          >
            <ExplodeIcon open={exploded} />
            {exploded ? "Reassemble" : "Explode"}
          </button>
        </div>

        {/* centred between the left-hand buttons and (on the widest screens) the credit */}
        {switcher && (
          <div className="absolute bottom-0 left-1/2 hidden max-w-[calc(100vw-22rem)] -translate-x-1/2 lg:block 2xl:max-w-[calc(100vw-40rem)]">
            {switcher}
          </div>
        )}

        <div className="hidden max-w-[16rem] flex-col items-end gap-2 text-right 2xl:flex">
          <p className={`label !text-[10px] transition-opacity duration-700 ${touched ? "opacity-0" : "opacity-100"}`}>
            Drag to orbit · click a part
          </p>
          {car.credit && (
            <p className="label !text-[9px] !text-fg/40">
              Model:{" "}
              <a href={car.credit.url} target="_blank" rel="noreferrer" className="underline-offset-2 hover:text-fg hover:underline">
                {car.credit.title}
              </a>{" "}
              by {car.credit.author}
              {car.credit.license && (
                <>
                  {" "}·{" "}
                  <a href={car.credit.licenseUrl} target="_blank" rel="noreferrer" className="hover:text-fg hover:underline">
                    {car.credit.license}
                  </a>
                </>
              )}
              , split into parts
            </p>
          )}
        </div>
      </div>
      {/* the credit stays visible where the bottom bar is too narrow for it */}
      {car.credit && (
        <p className="sr-hud label absolute right-gutter top-[4.5rem] z-10 hidden max-w-[14rem] text-right !text-[9px] !text-fg/40 md:block 2xl:hidden">
          Model: {car.credit.title} by {car.credit.author}
          {car.credit.license && ` · ${car.credit.license}`}
        </p>
      )}

      <StudioDock
        car={car}
        hidden={!!part}
        open={studioOpen}
        mood={mood}
        onMood={setMood}
        paintIdx={paintIdx}
        onPaint={setPaintIdx}
        lights={lights}
        onLights={() => setLights((v) => !v)}
        turntable={turntable}
        onTurntable={() => {
          setTurntable((v) => !v);
          setActiveShot(null);
        }}
        activeShot={activeShot}
        onShot={view}
        onFilm={() => film(true)}
        measure={measure}
        onMeasure={() => setMeasure((v) => !v)}
        xray={xray}
        onXray={() => setXray((v) => !v)}
        onPhoto={photo}
        onKeys={() => setKeysOpen((v) => !v)}
      />

      <Film car={car} on={cinematic} scene={scene} onExit={() => film(false)} />
      <div aria-hidden className={`pointer-events-none absolute inset-0 z-[60] bg-black transition-opacity duration-500 ${blackout ? "opacity-100" : "opacity-0"}`} />

      {part && (
        <Details
          key={part.id}
          part={part}
          index={index}
          total={order.length}
          prev={order[(index - 1 + order.length) % order.length]?.name}
          next={order[(index + 1) % order.length]?.name}
          onClose={() => setSelected(null)}
          onStep={step}
        />
      )}

      {hover && hover.x > 0 && hover.id !== selected && partById[hover.id] && (
        <div
          className="sr-hud pointer-events-none fixed z-40 -translate-x-1/2 rounded-full border border-fg/15 bg-[#121214]/85 px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.14em] text-fg backdrop-blur-md"
          style={{ left: hover.x, top: hover.y - 40 }}
        >
          <span className="mr-2 inline-block h-1.5 w-1.5 rounded-full bg-accent" />
          {partById[hover.id].name}
        </div>
      )}
    </div>
  );
}

function Loading({ name }: { name: string }) {
  const progress = useProgress((s) => s.progress);
  return (
    <div className="pointer-events-none absolute inset-0 grid place-items-center">
      <div className="w-56 text-center">
        <p className="label">Rolling in the {name}</p>
        <div className="mt-3 h-px w-full overflow-hidden bg-fg/10">
          {/* until the loader reports progress, a pulse instead of a stuck 0% */}
          <div
            className={`h-full bg-accent transition-[width] duration-300 ${progress ? "" : "animate-pulse"}`}
            style={{ width: `${progress ? progress : 35}%` }}
          />
        </div>
        <p className="label mt-2 !text-[10px] tabular-nums">{progress ? `${Math.round(progress)}%` : "\u00a0"}</p>
      </div>
    </div>
  );
}

function ExplodeIcon({ open }: { open: boolean }) {
  const d = open ? 1.5 : 3;
  return (
    <svg aria-hidden width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.3">
      <rect x={d} y={d} width="3.4" height="3.4" className="transition-all duration-300" />
      <rect x={14 - d - 3.4} y={d} width="3.4" height="3.4" className="transition-all duration-300" />
      <rect x={d} y={14 - d - 3.4} width="3.4" height="3.4" className="transition-all duration-300" />
      <rect x={14 - d - 3.4} y={14 - d - 3.4} width="3.4" height="3.4" className="transition-all duration-300" />
    </svg>
  );
}

function Details({
  part,
  index,
  total,
  prev,
  next,
  onClose,
  onStep,
}: {
  part: CarPart;
  index: number;
  total: number;
  prev?: string;
  next?: string;
  onClose: () => void;
  onStep: (d: number) => void;
}) {
  return (
    <aside
      aria-live="polite"
      aria-label={`${part.name} details`}
      data-lenis-prevent
      className="sr-hud sr-panel absolute inset-x-0 bottom-0 z-30 max-h-[52dvh] overflow-y-auto rounded-t-3xl border-t border-fg/10 bg-[#121214]/85 p-6 pb-24 shadow-[0_30px_80px_-20px_rgba(0,0,0,0.8)] backdrop-blur-2xl
        md:inset-x-auto md:bottom-auto md:right-gutter md:top-24 md:max-h-[calc(100dvh-9.5rem)] md:w-[400px] md:rounded-3xl md:border md:pb-6"
    >
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="label flex items-center gap-2 !text-[10px]">
            <span className="text-accent">{pad(index + 1)}</span>
            <span className="text-fg/30">/ {pad(total)}</span>
            <span className="text-fg/30">·</span>
            {part.group}
          </p>
          <h2 className="mt-2 text-[28px] font-semibold leading-tight tracking-tight">{part.name}</h2>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close details"
          className="grid h-9 w-9 shrink-0 place-items-center rounded-full border border-fg/15 text-fg/70 transition-colors hover:border-fg hover:bg-fg hover:text-bg"
        >
          <svg aria-hidden width="10" height="10" viewBox="0 0 10 10" stroke="currentColor" strokeWidth="1.4">
            <path d="M1 1l8 8M9 1l-8 8" />
          </svg>
        </button>
      </div>
      <p className="mt-4 text-[15px] leading-relaxed text-fg/75">{part.summary}</p>
      {part.specs.length > 0 && (
        <dl className="mt-6 grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-fg/10 bg-fg/10">
          {part.specs.map(([k, v]) => (
            <div key={k} className="bg-[#141416] px-3.5 py-3">
              <dt className="label !text-[9px]">{k}</dt>
              <dd className="mt-1 text-sm leading-snug">{v}</dd>
            </div>
          ))}
        </dl>
      )}
      {part.note && <p className="mt-4 border-l border-accent/50 pl-3 text-xs leading-relaxed text-fg/50">{part.note}</p>}
      <div className="mt-6 grid grid-cols-2 gap-2">
        <button
          type="button"
          className="group rounded-xl border border-fg/10 px-3.5 py-3 text-left transition-colors hover:border-fg/40"
          onClick={() => onStep(-1)}
        >
          <span className="label !text-[9px]">← Prev</span>
          <span className="mt-0.5 block truncate text-sm text-fg/70 group-hover:text-fg">{prev}</span>
        </button>
        <button
          type="button"
          className="group rounded-xl border border-fg/10 px-3.5 py-3 text-right transition-colors hover:border-fg/40"
          onClick={() => onStep(1)}
        >
          <span className="label !text-[9px]">Next →</span>
          <span className="mt-0.5 block truncate text-sm text-fg/70 group-hover:text-fg">{next}</span>
        </button>
      </div>
    </aside>
  );
}

/** The studio controls: lighting mood, paint, camera presets, lamps, turntable and the film. */
function StudioDock({
  car,
  hidden,
  open,
  mood,
  onMood,
  paintIdx,
  onPaint,
  lights,
  onLights,
  turntable,
  onTurntable,
  activeShot,
  onShot,
  onFilm,
  measure,
  onMeasure,
  xray,
  onXray,
  onPhoto,
  onKeys,
}: {
  car: Car;
  hidden: boolean;
  open: boolean;
  mood: MoodId;
  onMood: (m: MoodId) => void;
  paintIdx: number;
  onPaint: (i: number) => void;
  lights: boolean;
  onLights: () => void;
  turntable: boolean;
  onTurntable: () => void;
  activeShot: ShotId | null;
  onShot: (id: ShotId) => void;
  onFilm: () => void;
  measure: boolean;
  onMeasure: () => void;
  xray: boolean;
  onXray: () => void;
  onPhoto: () => void;
  onKeys: () => void;
}) {
  const paint = car.paint.colors[paintIdx] ?? car.paint.colors[0];
  const ring = "scale-110 border-fg ring-2 ring-fg/20 ring-offset-2 ring-offset-[#121214]";
  return (
    <section
      aria-label="Studio"
      className={`sr-hud absolute bottom-20 left-gutter right-gutter z-20 rounded-2xl border border-fg/10 bg-[#121214]/80 p-4 shadow-[0_30px_80px_-30px_rgba(0,0,0,0.9)] backdrop-blur-xl transition-all duration-500
        md:left-auto md:block md:w-[17.5rem] md:bg-[#121214]/65
        ${open ? "block" : "hidden"}
        ${hidden ? "pointer-events-none translate-x-6 opacity-0" : "opacity-100"}`}
    >
      <Row label="Light" value={moodById[mood].name}>
        <div className="flex gap-2">
          {moods.map((m) => (
            <button
              key={m.id}
              type="button"
              aria-label={`${m.name} lighting`}
              aria-pressed={m.id === mood}
              title={m.name}
              onClick={() => onMood(m.id)}
              className={`h-7 w-7 rounded-full border transition-all duration-300 ${m.id === mood ? ring : "border-fg/20 hover:border-fg/60"}`}
              style={{ background: m.swatch }}
            />
          ))}
        </div>
      </Row>

      <Row label="Paint" value={paint.name}>
        <div className="flex flex-wrap gap-2">
          {car.paint.colors.map((c, i) => (
            <button
              key={c.name}
              type="button"
              aria-label={`${c.name} paint`}
              aria-pressed={i === paintIdx}
              title={c.name}
              onClick={() => onPaint(i)}
              className={`h-7 w-7 rounded-full border transition-all duration-300 ${i === paintIdx ? ring : "border-fg/20 hover:border-fg/60"}`}
              style={{
                // a little lacquered sphere
                background: `radial-gradient(circle at 32% 28%, rgba(255,255,255,0.55), rgba(255,255,255,0) 42%), radial-gradient(circle at 70% 80%, rgba(0,0,0,0.45), rgba(0,0,0,0) 60%), ${c.hex}`,
              }}
            />
          ))}
        </div>
      </Row>

      <Row label="View">
        <div className="grid grid-cols-6 gap-1">
          {shots.map((s, i) => (
            <button
              key={s.id}
              type="button"
              title={`${s.name} (${i + 1})`}
              onClick={() => onShot(s.id)}
              aria-pressed={activeShot === s.id}
              className={`rounded-md border py-1.5 font-mono text-[9px] uppercase tracking-[0.06em] transition-colors ${
                activeShot === s.id ? "border-fg bg-fg text-bg" : "border-fg/12 text-fg/60 hover:border-fg/40 hover:text-fg"
              }`}
            >
              {s.name}
            </button>
          ))}
        </div>
      </Row>

      <Row label="Tools">
        <div className="grid grid-cols-[1fr_1fr_1fr_auto] gap-1.5">
          <Tool on={measure} onClick={onMeasure} label="Measure" hint="M">
            <svg aria-hidden width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.2">
              <path d="M1.5 9.5h11M1.5 7.5v4M12.5 7.5v4" />
              <path d="M4 9.5v-1.2M6.5 9.5v-2M9 9.5v-1.2" />
              <path d="M3.5 3.5h7M3.5 2.5v2M10.5 2.5v2" opacity=".5" />
            </svg>
          </Tool>
          <Tool on={xray} onClick={onXray} label="X-ray" hint="X">
            <svg aria-hidden width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.2">
              <path d="M1.5 9c1-2.6 2.6-4 5.5-4s4.5 1.4 5.5 4" strokeDasharray="1.6 1.4" />
              <path d="M1.5 9h11" />
              <circle cx="4" cy="10" r="1.2" />
              <circle cx="10" cy="10" r="1.2" />
              <rect x="5.6" y="6.6" width="2.8" height="1.8" />
            </svg>
          </Tool>
          <Tool on={false} onClick={onPhoto} label="Photo" hint="P">
            <svg aria-hidden width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.2">
              <path d="M1.5 4.5h2.6l1-1.6h3.8l1 1.6h2.6v7h-11z" />
              <circle cx="7" cy="7.8" r="2.1" />
            </svg>
          </Tool>
          <button
            type="button"
            onClick={onKeys}
            title="Keyboard shortcuts (?)"
            aria-label="Keyboard shortcuts"
            className="grid w-8 place-items-center rounded-md border border-fg/12 font-mono text-[11px] text-fg/60 transition-colors hover:border-fg/40 hover:text-fg"
          >
            ?
          </button>
        </div>
      </Row>

      <div className="mt-4 flex gap-2">
        <Toggle on={lights} onClick={onLights} label="Lamps" hint="L">
          <svg aria-hidden width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.3">
            <path d="M8 3.5c2.2 0 3.5 1.6 3.5 3.5S10.2 10.5 8 10.5H6.5v-7H8z" />
            <path d="M4.5 4.5H1.5M4.5 7H1.5M4.5 9.5H1.5" />
          </svg>
        </Toggle>
        <Toggle on={turntable} onClick={onTurntable} label="Spin" hint="S">
          <svg aria-hidden width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.3">
            <ellipse cx="7" cy="8.5" rx="5.5" ry="2.2" />
            <path d="M10.5 3.2l1.4 1.1-1.6.8" />
            <path d="M3 5.2C4 4.2 5.4 3.8 7 3.8c1.9 0 3.6.5 4.6 1.4" />
          </svg>
        </Toggle>
        <button
          type="button"
          onClick={onFilm}
          title="Play the film (C)"
          className="flex flex-1 items-center justify-center gap-2 rounded-full bg-accent px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-bg transition-transform duration-300 hover:scale-[1.03]"
        >
          <svg aria-hidden width="9" height="10" viewBox="0 0 9 10" fill="currentColor">
            <path d="M0 0l9 5-9 5z" />
          </svg>
          Film
        </button>
      </div>
    </section>
  );
}

function Row({ label, value, children }: { label: string; value?: string; children: ReactNode }) {
  return (
    <div className="mb-4 last:mb-0">
      <p className="label mb-2 flex items-center justify-between gap-3 !text-[10px]">
        {label}
        {value && <span className="truncate normal-case tracking-normal text-fg/80">{value}</span>}
      </p>
      {children}
    </div>
  );
}

function Toggle({ on, onClick, label, hint, children }: { on: boolean; onClick: () => void; label: string; hint?: string; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onClick}
      title={hint ? `${label} (${hint})` : label}
      className={`flex items-center gap-1.5 rounded-full border px-3 py-2 text-[11px] transition-colors duration-300 ${
        on ? "border-fg bg-fg text-bg" : "border-fg/15 text-fg/70 hover:border-fg/50 hover:text-fg"
      }`}
    >
      {children}
      {label}
    </button>
  );
}

/** A studio tool: an icon over its name, lit while it is on. */
function Tool({ on, onClick, label, hint, children }: { on: boolean; onClick: () => void; label: string; hint: string; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onClick}
      title={`${label} (${hint})`}
      className={`flex flex-col items-center gap-1 rounded-md border py-2 font-mono text-[9px] uppercase tracking-[0.06em] transition-colors ${
        on ? "border-fg bg-fg text-bg" : "border-fg/12 text-fg/60 hover:border-fg/40 hover:text-fg"
      }`}
    >
      {children}
      {label}
    </button>
  );
}

const KEYS: [string, string][] = [
  ["E", "Explode or reassemble"],
  ["1–6", "Hero, front, side, rear, top, low"],
  ["M", "Measure"],
  ["X", "X-ray the bodywork"],
  ["P", "Take a photo"],
  ["L", "Lamps"],
  ["S", "Spin the turntable"],
  ["C", "Play the film"],
  ["← →", "Previous or next part (or car)"],
  ["Esc", "Close"],
];

/** The keyboard shortcuts, on a card in the middle of the screen. */
function Keys({ onClose, cycle }: { onClose: () => void; cycle: boolean }) {
  return (
    <div className="sr-hud absolute inset-0 z-[45] grid place-items-center bg-black/40 backdrop-blur-[2px]" onClick={onClose}>
      <div
        role="dialog"
        aria-label="Keyboard shortcuts"
        className="sr-panel w-[min(22rem,calc(100vw-2rem))] rounded-2xl border border-fg/10 bg-[#121214]/90 p-5 shadow-2xl backdrop-blur-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <p className="label mb-3 flex items-center justify-between !text-[10px]">
          Keyboard
          <button type="button" onClick={onClose} className="text-fg/50 hover:text-fg">
            Esc
          </button>
        </p>
        <dl className="divide-y divide-fg/8">
          {KEYS.map(([k, v]) => (
            <div key={k} className="flex items-center justify-between gap-4 py-2 text-sm">
              <dt className="text-fg/70">{k === "← →" && !cycle ? "Previous or next part" : v}</dt>
              <dd>
                <kbd className="rounded border border-fg/20 bg-fg/5 px-1.5 py-0.5 font-mono text-[10px] text-fg/80">{k}</kbd>
              </dd>
            </div>
          ))}
        </dl>
      </div>
    </div>
  );
}

/** The cinematic reel's frame: letterbox bars, a caption per scene and a way out. */
function Film({ car, on, scene, onExit }: { car: Car; on: boolean; scene: number; onExit: () => void }) {
  const shot = cineShots[scene] ?? cineShots[0];
  const finale = !shot.title;
  return (
    <div aria-hidden={!on} className="pointer-events-none absolute inset-0 z-40">
      <div className={`absolute inset-x-0 top-0 h-[11vh] bg-black transition-transform duration-700 ease-out ${on ? "translate-y-0" : "-translate-y-full"}`} />
      <div className={`absolute inset-x-0 bottom-0 h-[11vh] bg-black transition-transform duration-700 ease-out ${on ? "translate-y-0" : "translate-y-full"}`}>
        {on && (
          <div className="absolute inset-x-gutter top-1/2 flex -translate-y-1/2 items-center gap-4">
            <span className="label !text-[10px] tabular-nums !text-fg/50">
              {pad(scene + 1)} / {pad(cineShots.length)}
            </span>
            <span className="relative h-px flex-1 overflow-hidden bg-fg/10">
              <span key={scene} className="sr-progress absolute inset-y-0 left-0 bg-accent" style={{ animationDuration: `${shot.dur}s` }} />
            </span>
            <span className="label hidden !text-[10px] !text-fg/50 sm:inline">Esc to exit</span>
          </div>
        )}
      </div>

      {on && (
        <>
          <div key={scene} className="absolute bottom-[calc(11vh+2rem)] left-gutter right-gutter max-w-xl">
            <p className="sr-rise label flex items-center gap-2">
              <span className="h-1.5 w-1.5 rounded-full bg-accent" />
              {car.maker} <span className="text-fg/30">/</span> {car.year}
            </p>
            <h2
              className={`sr-rise display mt-3 ${finale ? "text-[clamp(40px,6vw,96px)]" : "text-[clamp(28px,3.4vw,54px)]"}`}
              style={{ animationDelay: "120ms" }}
            >
              {finale ? car.name : shot.title}
            </h2>
            {finale && (
              <p className="sr-rise mt-3 max-w-sm text-[15px] text-fg/65" style={{ animationDelay: "240ms" }}>
                {car.tagline}
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={onExit}
            className="hud-btn pointer-events-auto absolute right-gutter top-[calc(11vh+1.25rem)] flex items-center gap-2 border-fg/20 bg-black/40 backdrop-blur-md"
          >
            <svg aria-hidden width="10" height="10" viewBox="0 0 10 10" stroke="currentColor" strokeWidth="1.4">
              <path d="M1 1l8 8M9 1l-8 8" />
            </svg>
            Exit film
          </button>
        </>
      )}
    </div>
  );
}
