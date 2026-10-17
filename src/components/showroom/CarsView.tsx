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
  };

  const switcher = (
    <div role="tablist" aria-label="Cars" className="flex flex-wrap gap-2">
      {cars.map((c, i) => (
        <button
          key={c.slug}
          type="button"
          role="tab"
          aria-selected={c.slug === slug}
          onClick={() => choose(c.slug)}
          className={`group flex items-baseline gap-2 rounded-full border px-3.5 py-2 text-left transition-colors ${
            c.slug === slug ? "border-fg bg-fg text-bg" : "border-fg/15 bg-bg/50 backdrop-blur hover:border-fg/50"
          }`}
        >
          <span className={`font-mono text-[10px] tracking-[0.12em] ${c.slug === slug ? "text-bg/60" : "text-fg/45"}`}>
            {pad(i + 1)}
          </span>
          <span className="text-sm font-medium">{c.short}</span>
          <span className={`font-mono text-[10px] ${c.slug === slug ? "text-bg/60" : "text-fg/45"}`}>{c.year}</span>
        </button>
      ))}
    </div>
  );

  // a fresh showroom per car: selection, exploded state and camera all start over
  return <Showroom key={slug} car={car} switcher={switcher} />;
}
