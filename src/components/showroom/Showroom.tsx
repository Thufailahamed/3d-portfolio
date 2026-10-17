"use client";

import { useProgress } from "@react-three/drei";
import dynamic from "next/dynamic";
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { groups, type Car, type CarPart } from "@/content/cars";

const ShowroomScene = dynamic(() => import("./ShowroomScene"), { ssr: false });

const pad = (n: number) => String(n).padStart(2, "0");

/**
 * Exploded-view showroom for one car: click a part (or pick it from the index) to slide it out and
 * read about it. `switcher` is the car picker (/cars puts one at the bottom of the screen).
 */
export default function Showroom({
  car,
  switcher,
  initialPart: given,
}: {
  car: Car;
  switcher?: ReactNode;
  /** overrides ?part= (null after switching cars, so the new car starts assembled) */
  initialPart?: string | null;
}) {
  const partById = useMemo(() => Object.fromEntries(car.parts.map((p) => [p.id, p])) as Record<string, CarPart>, [car]);
  const fromUrl = useSearchParams().get("part");
  const initialPart = given === undefined ? fromUrl : given;
  const [selected, setSelected] = useState<string | null>(initialPart && partById[initialPart] ? initialPart : null);
  const [exploded, setExploded] = useState(false);
  const [hover, setHover] = useState<{ id: string; x: number; y: number } | null>(null);
  const [ids, setIds] = useState<string[] | null>(null);
  const [listOpen, setListOpen] = useState(false);
  const [touched, setTouched] = useState(false);

  // only parts the model actually has, in the content's order
  const order = useMemo(() => car.parts.filter((p) => !ids || ids.includes(p.id)), [car, ids]);
  const part = selected ? partById[selected] : null;
  const index = part ? order.findIndex((p) => p.id === part.id) : -1;

  const select = useCallback((id: string | null) => {
    setSelected((cur) => (cur === id ? null : id));
    setListOpen(false);
    setTouched(true);
  }, []);
  const pick = useCallback((id: string) => partById[id] && select(id), [partById, select]);

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

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setSelected(null);
      else if (selected && e.key === "ArrowRight") step(1);
      else if (selected && e.key === "ArrowLeft") step(-1);
    };
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  }, [selected, step]);

  const onHover = useCallback((id: string | null, x = 0, y = 0) => setHover(id && partById[id] ? { id, x, y } : null), [partById]);
  const onReady = useCallback((found: string[]) => setIds(found), []);

  return (
    <div
      className="fixed inset-0 h-dvh overflow-hidden bg-bg"
      style={{ cursor: hover ? "pointer" : undefined }}
      onPointerDown={() => setTouched(true)}
    >
      <div className="absolute inset-0">
        <ShowroomScene
          url={car.model}
          view={car.view}
          selected={selected}
          exploded={exploded}
          hovered={hover?.id ?? null}
          onHover={onHover}
          onPick={pick}
          onReady={onReady}
        />
      </div>

      {/* shade behind the text so it reads over the studio */}
      <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-48 bg-gradient-to-b from-bg/80 to-transparent" />
      <div aria-hidden className="pointer-events-none absolute inset-x-0 bottom-0 h-40 bg-gradient-to-t from-bg/90 to-transparent" />
      <div aria-hidden className="pointer-events-none absolute inset-y-0 left-0 hidden w-[44vw] bg-gradient-to-r from-bg/75 via-bg/30 to-transparent lg:block" />
      <div aria-hidden className="grain absolute" />

      {!ids && <Loading name={car.short} />}

      {/* left column: title, numbers, and the part index on wide screens */}
      <div
        className={`pointer-events-none absolute bottom-24 left-gutter right-gutter top-20 flex flex-col transition-opacity duration-500 md:top-24 lg:right-auto lg:w-[min(30rem,36vw)] ${
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
        {switcher && <div className="pointer-events-auto mt-5 md:hidden">{switcher}</div>}

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
        className={`pointer-events-none absolute right-gutter top-28 hidden w-48 transition-all duration-500 md:block ${
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

      {/* bottom bar: controls, car picker, credit */}
      <div className="absolute inset-x-gutter bottom-5 z-30 flex items-end justify-between gap-4">
        <div className="flex gap-2">
          <button
            type="button"
            className="hud-btn border-fg/15 bg-[#121214]/70 backdrop-blur-md lg:hidden"
            aria-expanded={listOpen}
            onClick={() => setListOpen((v) => !v)}
          >
            {listOpen ? "Close" : `Parts · ${order.length}`}
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

        {switcher && <div className="absolute bottom-0 left-1/2 hidden -translate-x-1/2 md:block">{switcher}</div>}

        <div className="hidden max-w-[16rem] flex-col items-end gap-2 text-right xl:flex">
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
        <p className="label absolute right-gutter top-[4.5rem] z-10 hidden max-w-[14rem] text-right !text-[9px] !text-fg/40 md:block xl:hidden">
          Model: {car.credit.title} by {car.credit.author}
          {car.credit.license && ` · ${car.credit.license}`}
        </p>
      )}

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
          className="pointer-events-none fixed z-40 -translate-x-1/2 rounded-full border border-fg/15 bg-[#121214]/85 px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.14em] text-fg backdrop-blur-md"
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
      className="sr-panel absolute inset-x-0 bottom-0 z-30 max-h-[52dvh] overflow-y-auto rounded-t-3xl border-t border-fg/10 bg-[#121214]/85 p-6 pb-24 shadow-[0_30px_80px_-20px_rgba(0,0,0,0.8)] backdrop-blur-2xl
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
