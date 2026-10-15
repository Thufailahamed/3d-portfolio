"use client";

import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";
import { useApp, type Weather } from "@/store/useApp";

const KEY = "weather";
const OPTIONS: { id: Weather; label: string; icon: React.ReactNode }[] = [
  {
    id: "night",
    label: "Night",
    icon: <path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5Z" />,
  },
  {
    id: "rain",
    label: "Rain",
    icon: (
      <>
        <path d="M7 15.5a4.5 4.5 0 0 1-.4-9A6 6 0 0 1 18 8a3.75 3.75 0 0 1-.5 7.5Z" />
        <path d="M9 18.5 8 21M13 18.5 12 21M17 18.5 16 21" />
      </>
    ),
  },
  {
    id: "day",
    label: "Day",
    icon: (
      <>
        <circle cx="12" cy="12" r="4" />
        <path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4" />
      </>
    ),
  },
];

/** A small switch on the right edge: night, rain or day in the forest. Only shown while the forest is. */
export default function WeatherSwitch() {
  const pathname = usePathname();
  const weather = useApp((s) => s.weather);
  const chapter = useApp((s) => s.chapter);
  const entered = useApp((s) => s.entered);
  const lite = useApp((s) => s.lite);
  const group = useRef<HTMLDivElement>(null);
  const shown = entered && !lite && pathname === "/" && (chapter === "hero" || chapter === "fracture");

  // remember the visitor's sky
  useEffect(() => {
    try {
      const saved = localStorage.getItem(KEY) as Weather | null;
      if (saved && OPTIONS.some((o) => o.id === saved)) useApp.getState().set({ weather: saved });
    } catch {}
  }, []);
  useEffect(() => {
    document.documentElement.dataset.weather = weather;
    try {
      localStorage.setItem(KEY, weather);
    } catch {}
  }, [weather]);

  const pick = (w: Weather) => useApp.getState().set({ weather: w });
  const onKey = (e: React.KeyboardEvent) => {
    const step = e.key === "ArrowDown" || e.key === "ArrowRight" ? 1 : e.key === "ArrowUp" || e.key === "ArrowLeft" ? -1 : 0;
    if (!step) return;
    e.preventDefault();
    const i = (OPTIONS.findIndex((o) => o.id === weather) + step + OPTIONS.length) % OPTIONS.length;
    pick(OPTIONS[i].id);
    group.current?.querySelectorAll<HTMLButtonElement>("button")[i]?.focus();
  };
  const index = OPTIONS.findIndex((o) => o.id === weather);

  return (
    <div
      ref={group}
      role="radiogroup"
      aria-label="Weather"
      onKeyDown={onKey}
      className={`weather-switch fixed right-gutter top-1/2 z-30 -translate-y-1/2 transition-[opacity,visibility,translate] duration-700 ${
        shown ? "visible opacity-100" : "invisible translate-x-3 opacity-0"
      }`}
    >
      <div className="relative flex flex-col gap-1 rounded-full border border-fg/15 bg-bg/35 p-1 backdrop-blur-md">
        {/* the active marker slides between the options */}
        <span
          aria-hidden
          className="absolute left-1 top-1 h-8 w-8 rounded-full bg-fg transition-transform duration-500 ease-[cubic-bezier(.2,.8,.2,1)]"
          style={{ transform: `translateY(${index * 36}px)` }}
        />
        {OPTIONS.map((o) => {
          const on = o.id === weather;
          return (
            <button
              key={o.id}
              type="button"
              role="radio"
              aria-checked={on}
              aria-label={o.label}
              tabIndex={on ? 0 : -1}
              onClick={() => pick(o.id)}
              className={`group relative flex h-8 w-8 items-center justify-center rounded-full transition-colors duration-500 ${
                on ? "text-bg" : "text-fg/70 hover:text-fg"
              }`}
            >
              <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                {o.icon}
              </svg>
              <span className="label pointer-events-none absolute right-full mr-3 whitespace-nowrap !text-fg opacity-0 transition-opacity duration-300 group-hover:opacity-100 group-focus-visible:opacity-100">
                {o.label}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
