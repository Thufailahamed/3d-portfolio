"use client";

import dynamic from "next/dynamic";
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { groups, lykan, partById, parts, type LykanPart } from "@/content/lykan";

const LykanScene = dynamic(() => import("./LykanScene"), { ssr: false });

/** Exploded-view showroom: click a part (or pick it from the index) to slide it out and read about it. */
export default function LykanView() {
  const initialPart = useSearchParams().get("part");
  const [selected, setSelected] = useState<string | null>(initialPart && partById[initialPart] ? initialPart : null);
  const [exploded, setExploded] = useState(false);
  const [hover, setHover] = useState<{ id: string; x: number; y: number } | null>(null);
  const [ids, setIds] = useState<string[] | null>(null);
  const [listOpen, setListOpen] = useState(false);

  const order = useMemo(() => parts.filter((p) => !ids || ids.includes(p.id)), [ids]);
  const part = selected ? partById[selected] : null;

  const select = useCallback((id: string | null) => {
    setSelected((cur) => (cur === id ? null : id));
    setListOpen(false);
  }, []);

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

  const onHover = useCallback((id: string | null, x = 0, y = 0) => setHover(id ? { id, x, y } : null), []);
  const onReady = useCallback((found: string[]) => setIds(found), []);

  return (
    <div className="fixed inset-0 h-dvh overflow-hidden bg-bg" style={{ cursor: hover ? "pointer" : undefined }}>
      <div className="absolute inset-0">
        <LykanScene
          selected={selected}
          exploded={exploded}
          hovered={hover?.id ?? null}
          onHover={onHover}
          onPick={select}
          onReady={onReady}
        />
      </div>

      {!ids && (
        <div className="pointer-events-none absolute inset-0 grid place-items-center">
          <p className="label animate-pulse">Loading the car…</p>
        </div>
      )}

      {/* title and headline numbers */}
      <div className="pointer-events-none absolute left-gutter right-gutter top-20 md:top-24">
        <p className="label">{lykan.maker}</p>
        <h1 className="display mt-2 text-[clamp(34px,6vw,84px)]">{lykan.name}</h1>
        <p className="mt-3 max-w-sm text-sm text-fg/70">{lykan.tagline}</p>
        <dl className="mt-5 hidden gap-6 md:flex">
          {lykan.facts.map(([k, v]) => (
            <div key={k}>
              <dt className="label">{k}</dt>
              <dd className="mt-1 text-sm">{v}</dd>
            </div>
          ))}
        </dl>
      </div>

      {/* part index: a column on desktop, a sheet on phones */}
      <nav
        aria-label="Parts"
        data-lenis-prevent
        className={`absolute left-gutter z-20 overflow-y-auto rounded-xl border border-fg/10 bg-bg/80 p-4 backdrop-blur-md
          bottom-20 max-h-[55dvh] w-[calc(100%-2*var(--spacing-gutter))] ${listOpen ? "block" : "hidden"}
          lg:bottom-auto lg:top-[22rem] lg:block lg:max-h-[calc(100dvh-26rem)] lg:w-56 lg:border-0 lg:bg-transparent lg:p-0 lg:backdrop-blur-none`}
      >
        {groups.map((g) => (
          <div key={g} className="mb-4">
            <p className="label mb-1.5">{g}</p>
            <ul>
              {order
                .filter((p) => p.group === g)
                .map((p) => (
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
        ))}
      </nav>

      {/* controls */}
      <div className="absolute bottom-5 left-gutter z-30 flex gap-2">
        <button type="button" className="hud-btn bg-bg/60 backdrop-blur lg:hidden" aria-expanded={listOpen} onClick={() => setListOpen((v) => !v)}>
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

function Details({ part, onClose, onStep }: { part: LykanPart; onClose: () => void; onStep: (d: number) => void }) {
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
        <button type="button" onClick={onClose} aria-label="Close details"
          className="grid h-9 w-9 shrink-0 place-items-center rounded-full border border-fg/15 transition-colors hover:border-fg/50">
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
        <button type="button" className="hud-btn flex-1" onClick={() => onStep(-1)}>← Prev</button>
        <button type="button" className="hud-btn flex-1" onClick={() => onStep(1)}>Next →</button>
      </div>
    </aside>
  );
}
