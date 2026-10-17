"use client";

import { useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
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

  // warm the other models so switching is quick
  useEffect(() => {
    for (const c of cars) if (c.slug !== slug) preload(c.model, { as: "fetch", crossOrigin: "anonymous" });
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

  const switcher = (
    <div
      role="tablist"
      aria-label="Cars"
      className="flex gap-1 rounded-full border border-fg/12 bg-[#121214]/70 p-1 shadow-[0_20px_50px_-20px_rgba(0,0,0,0.9)] backdrop-blur-xl"
    >
      {cars.map((c, i) => {
        const on = c.slug === slug;
        return (
          <button
            key={c.slug}
            type="button"
            role="tab"
            aria-selected={on}
            onClick={() => choose(c.slug)}
            className={`flex items-baseline gap-2 whitespace-nowrap rounded-full px-4 py-2.5 transition-colors duration-300 ${
              on ? "bg-fg text-bg" : "text-fg/60 hover:bg-fg/8 hover:text-fg"
            }`}
          >
            <span className={`font-mono text-[10px] tracking-[0.12em] ${on ? "text-bg/50" : "text-fg/35"}`}>{pad(i + 1)}</span>
            <span className="text-sm font-medium">{c.short}</span>
            <span className={`hidden font-mono text-[10px] sm:inline ${on ? "text-bg/50" : "text-fg/35"}`}>{c.year}</span>
          </button>
        );
      })}
    </div>
  );

  // a fresh showroom per car: selection, exploded state and camera all start over
  return <Showroom key={slug} car={car} switcher={switcher} initialPart={switched ? null : undefined} />;
}
