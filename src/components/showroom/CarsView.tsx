"use client";

import { useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { preload } from "react-dom";
import { carBySlug, cars } from "@/content/cars";
import Showroom from "./Showroom";

const pad = (n: number) => String(n).padStart(2, "0");

/** /cars: the exploded-view showroom with a picker for every car in the line-up (?car=slug). */
export default function CarsView() {
  const initial = useSearchParams().get("car");
  const [slug, setSlug] = useState(initial && carBySlug[initial] ? initial : cars[0].slug);
  const [switched, setSwitched] = useState(false);
  const car = carBySlug[slug];

  // warm the neighbours so stepping through is quick, without downloading the whole line-up
  useEffect(() => {
    const i = cars.findIndex((c) => c.slug === slug);
    for (const d of [-1, 1]) preload(cars[(i + d + cars.length) % cars.length].model, { as: "fetch", crossOrigin: "anonymous" });
  }, [slug]);

  const choose = (next: string) => {
    if (next === slug) return;
    const url = new URL(window.location.href);
    url.searchParams.set("car", next);
    url.searchParams.delete("part");
    window.history.replaceState(null, "", url);
    setSlug(next);
    setSwitched(true);
  };

  // rendered in two places (top on small screens, bottom on large), each with its own scroll state
  const switcher = <CarRail slug={slug} onChoose={choose} />;

  // a fresh showroom per car: selection, exploded state and camera all start over
  return <Showroom key={slug} car={car} switcher={switcher} initialPart={switched ? null : undefined} />;
}

/** The car picker: a pill of tabs that scrolls sideways when the line-up is wider than the screen. */
function CarRail({ slug, onChoose }: { slug: string; onChoose: (slug: string) => void }) {
  const rail = useRef<HTMLDivElement>(null);

  // keep the picked car in view
  useEffect(() => {
    const el = rail.current;
    const tab = el?.querySelector<HTMLElement>('[aria-selected="true"]');
    if (!el || !tab || el.scrollWidth <= el.clientWidth) return;
    el.scrollTo({ left: tab.offsetLeft - (el.clientWidth - tab.offsetWidth) / 2, behavior: "smooth" });
  }, [slug]);

  // a mouse wheel scrolls it sideways
  useEffect(() => {
    const el = rail.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (el.scrollWidth <= el.clientWidth || Math.abs(e.deltaX) > Math.abs(e.deltaY)) return;
      e.preventDefault();
      el.scrollLeft += e.deltaY;
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  return (
    <div
      ref={rail}
      role="tablist"
      aria-label="Cars"
      className="no-scrollbar flex max-w-full gap-1 overflow-x-auto rounded-full border border-fg/12 bg-[#121214]/70 p-1 shadow-[0_20px_50px_-20px_rgba(0,0,0,0.9)] backdrop-blur-xl"
    >
      {cars.map((c, i) => {
        const on = c.slug === slug;
        return (
          <button
            key={c.slug}
            type="button"
            role="tab"
            aria-selected={on}
            onClick={() => onChoose(c.slug)}
            className={`flex shrink-0 items-baseline gap-2 whitespace-nowrap rounded-full px-3.5 py-2.5 transition-colors duration-300 ${
              on ? "bg-fg text-bg" : "text-fg/60 hover:bg-fg/8 hover:text-fg"
            }`}
          >
            <span className={`font-mono text-[10px] tracking-[0.12em] ${on ? "text-bg/50" : "text-fg/35"}`}>{pad(i + 1)}</span>
            <span className="text-sm font-medium">{c.short}</span>
            {on && <span className="hidden font-mono text-[10px] text-bg/50 sm:inline">{c.year}</span>}
          </button>
        );
      })}
    </div>
  );
}
