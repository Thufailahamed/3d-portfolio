"use client";

import dynamic from "next/dynamic";
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { groups, type Car, type CarPart } from "@/content/cars";

const ShowroomScene = dynamic(() => import("./ShowroomScene"), { ssr: false });

/**
 * Exploded-view showroom for one car: click a part (or pick it from the index) to slide it out and
 * read about it. `switcher` renders under the title (the /cars page puts its car picker there).
 */
export default function Showroom({ car, switcher }: { car: Car; switcher?: ReactNode }) {
  const partById = useMemo(() => Object.fromEntries(car.parts.map((p) => [p.id, p])) as Record<string, CarPart>, [car]);
  const initialPart = useSearchParams().get("part");
  const [selected, setSelected] = useState<string | null>(initialPart && partById[initialPart] ? initialPart : null);
  const [exploded, setExploded] = useState(false);
  const [hover, setHover] = useState<{ id: string; x: number; y: number } | null>(null);
  const [ids, setIds] = useState<string[] | null>(null);
  const [listOpen, setListOpen] = useState(false);

  // only parts the model actually has, in the content's order
  const order = useMemo(() => car.parts.filter((p) => !ids || ids.includes(p.id)), [car, ids]);
  const part = selected ? partById[selected] : null;

  const select = useCallback((id: string | null) => {
    setSelected((cur) => (cur === id ? null : id));
    setListOpen(false);
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
    <div className="fixed inset-0 h-dvh overflow-hidden bg-bg" style={{ cursor: hover ? "pointer" : undefined }}>
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

      {!ids && (
        <div className="pointer-events-none absolute inset-0 grid place-items-center">
          <p className="label animate-pulse">Loading the {car.short}…</p>
        </div>
      )}

      {/* left column: title, picker, numbers, and the part index on wide screens */}
      <div
        className={`pointer-events-none absolute bottom-20 left-gutter right-gutter top-20 flex flex-col transition-opacity duration-500 md:top-24 lg:right-auto lg:w-[min(38rem,46vw)] ${
          part ? "max-md:opacity-0 max-md:[&_*]:pointer-events-none" : ""
        }`}
      >
        <p className="label">
          {car.maker} · {car.year}
        </p>
        <h1 className="display mt-2 text-[clamp(34px,6vw,84px)]">{car.name}</h1>
        <p className="mt-3 max-w-sm text-sm text-fg/70">{car.tagline}</p>
        {switcher && <div className="pointer-events-auto mt-5">{switcher}</div>}
        <dl className="mt-5 hidden gap-6 md:flex">
          {car.facts.map(([k, v]) => (
            <div key={k}>
              <dt className="label">{k}</dt>
              <dd className="mt-1 text-sm">{v}</dd>
            </div>
          ))}
        </dl>

        <nav
          aria-label="Parts"
          data-lenis-prevent
          className={`pointer-events-auto fixed bottom-20 left-gutter right-gutter z-20 max-h-[55dvh] overflow-y-auto rounded-xl border border-fg/10 bg-bg/85 p-4 backdrop-blur-md
            ${listOpen ? "block" : "hidden"}
            lg:static lg:mt-8 lg:block lg:max-h-none lg:min-h-0 lg:w-56 lg:flex-1 lg:rounded-none lg:border-0 lg:bg-transparent lg:p-0 lg:backdrop-blur-none`}
        >
          {groups.map((g) => {
            const list = order.filter((p) => p.group === g);
            if (!list.length) return null;
            return (
              <div key={g} className="mb-4">
                <p className="label mb-1.5">{g}</p>
                <ul>
                  {list.map((p) => (
                    <li key={p.id}>
                      <button
                        type="button"
                        aria-pressed={selected === p.id}
                        onClick={() => select(p.id)}
                        onMouseEnter={() => setHover({ id: p.id, x: -999, y: -999 })}
                        onMouseLeave={() => setHover(null)}
                        className={`w-full py-1 text-left text-sm transition-colors ${
                          selected === p.id ? "text-accent" : "text-fg/65 hover:text-fg"
                        }`}
                      >
                        {p.name}
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </nav>
      </div>

      {/* controls */}
      <div className="absolute bottom-5 left-gutter z-30 flex gap-2">
        <button
          type="button"
          className="hud-btn bg-bg/60 backdrop-blur lg:hidden"
          aria-expanded={listOpen}
          onClick={() => setListOpen((v) => !v)}
        >
          {listOpen ? "Close" : "Parts"}
        </button>
        <button
          type="button"
          className="hud-btn bg-bg/60 backdrop-blur"
          aria-pressed={exploded}
          onClick={() => {
            setExploded((v) => !v);
            setSelected(null);
          }}
        >
          {exploded ? "Reassemble" : "Explode all"}
        </button>
      </div>

      {car.credit && (
        <p className="label absolute bottom-6 right-gutter z-10 hidden max-w-xs text-right !text-[10px] md:block">
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

      {part && <Details part={part} onClose={() => setSelected(null)} onStep={step} />}

      {hover && hover.x > 0 && hover.id !== selected && partById[hover.id] && (
        <div
          className="pointer-events-none fixed z-40 -translate-x-1/2 rounded-full bg-fg px-3 py-1 font-mono text-[11px] uppercase tracking-[0.12em] text-bg"
          style={{ left: hover.x, top: hover.y - 36 }}
        >
          {partById[hover.id].name}
        </div>
      )}
    </div>
  );
}

function Details({ part, onClose, onStep }: { part: CarPart; onClose: () => void; onStep: (d: number) => void }) {
  return (
    <aside
      aria-live="polite"
      aria-label={`${part.name} details`}
      data-lenis-prevent
      className="absolute inset-x-0 bottom-0 z-30 max-h-[52dvh] overflow-y-auto rounded-t-2xl border-t border-fg/10 bg-bg/90 p-5 pb-20 backdrop-blur-md
        md:inset-x-auto md:bottom-auto md:right-gutter md:top-24 md:max-h-[calc(100dvh-8rem)] md:w-[380px] md:rounded-2xl md:border md:pb-5"
    >
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="label">{part.group}</p>
          <h2 className="mt-1 text-2xl font-semibold tracking-tight">{part.name}</h2>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close details"
          className="grid h-9 w-9 shrink-0 place-items-center rounded-full border border-fg/15 transition-colors hover:border-fg/50"
        >
          <span aria-hidden>×</span>
        </button>
      </div>
      <p className="mt-4 text-[15px] leading-relaxed text-fg/80">{part.summary}</p>
      {part.specs.length > 0 && (
        <dl className="mt-5 divide-y divide-fg/10 border-y border-fg/10">
          {part.specs.map(([k, v]) => (
            <div key={k} className="flex justify-between gap-4 py-2.5 text-sm">
              <dt className="text-fg/55">{k}</dt>
              <dd className="text-right">{v}</dd>
            </div>
          ))}
        </dl>
      )}
      {part.note && <p className="mt-4 text-xs leading-relaxed text-fg/50">{part.note}</p>}
      <div className="mt-5 flex gap-2">
        <button type="button" className="hud-btn flex-1" onClick={() => onStep(-1)}>
          ← Prev
        </button>
        <button type="button" className="hud-btn flex-1" onClick={() => onStep(1)}>
          Next →
        </button>
      </div>
    </aside>
  );
}
