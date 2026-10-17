"use client";

import { useEffect } from "react";
import { type FlowStyle, type Weather, useApp } from "@/store/useApp";
import { ThermalButton } from "./ThermalHUD";

const STYLE_KEY = "flowStyle";
const WEATHER_KEY = "weather";

const STYLES: { id: FlowStyle; label: string }[] = [
  { id: "xray", label: "X-Ray" },
  { id: "real", label: "Real" },
];

const WEATHERS: { id: Weather; label: string; icon: React.ReactNode }[] = [
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
  { id: "night", label: "Night", icon: <path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5Z" /> },
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
];

export function pickStyle(s: FlowStyle) {
  useApp.getState().set({ flowStyle: s });
  try {
    localStorage.setItem(STYLE_KEY, s);
  } catch {}
}

export function pickWeather(w: Weather) {
  useApp.getState().set({ weather: w });
  try {
    localStorage.setItem(WEATHER_KEY, w);
  } catch {}
}

/** X-ray blueprint or realistic render, and (when realistic) the pavilion's weather. */
export default function RenderModePanel() {
  const style = useApp((s) => s.flowStyle);
  const weather = useApp((s) => s.weather);
  const preparing = useApp((s) => s.flowPreparing);
  const thermal = useApp((s) => s.thermal);

  useEffect(() => {
    try {
      const saved = localStorage.getItem(STYLE_KEY) as FlowStyle | null;
      if (saved === "xray" || saved === "real") useApp.getState().set({ flowStyle: saved });
    } catch {}
  }, []);

  const real = style === "real";
  return (
    <div className="flow-cad-in pointer-events-auto absolute right-6 sm:right-10 top-1/2 z-10 -translate-y-1/2 flex flex-col items-end gap-3 font-mono">
      <div
        role="radiogroup"
        aria-label="Render mode"
        className={`relative flex rounded-full border border-white/20 bg-black/45 p-1 backdrop-blur-md transition-opacity duration-500 ${
          thermal ? "invisible opacity-0" : "opacity-100"
        }`}
      >
        <span
          aria-hidden
          className="absolute top-1 left-1 h-[calc(100%-8px)] w-[calc(50%-4px)] rounded-full bg-white transition-transform duration-500 ease-[cubic-bezier(.2,.8,.2,1)]"
          style={{ transform: `translateX(${real ? "100%" : "0%"})` }}
        />
        {STYLES.map((o) => (
          <button
            key={o.id}
            type="button"
            role="radio"
            aria-checked={style === o.id}
            onClick={() => pickStyle(o.id)}
            aria-busy={o.id === "real" && preparing}
            className={`relative z-10 w-16 py-1.5 text-[10px] uppercase tracking-[0.22em] transition-colors duration-500 ${
              style === o.id ? "text-black" : "text-white/65 hover:text-white"
            } ${o.id === "real" && preparing ? "animate-pulse" : ""}`}
          >
            {o.label}
          </button>
        ))}
      </div>
      {preparing && (
        <span role="status" className="text-[9px] uppercase tracking-[0.22em] text-white/55">
          Preparing materials…
        </span>
      )}

      <div
        role="radiogroup"
        aria-label="Weather"
        aria-hidden={!real}
        className={`flex flex-col gap-1 rounded-2xl border border-white/15 bg-black/40 p-1 backdrop-blur-md transition-[opacity,translate,visibility] duration-500 ${
          real && !thermal ? "visible opacity-100" : "invisible translate-x-3 opacity-0"
        }`}
      >
        {WEATHERS.map((o) => {
          const on = weather === o.id;
          return (
            <button
              key={o.id}
              type="button"
              role="radio"
              aria-checked={on}
              tabIndex={real ? 0 : -1}
              onClick={() => pickWeather(o.id)}
              className={`flex items-center justify-end gap-2.5 rounded-xl px-3 py-1.5 text-[10px] uppercase tracking-[0.22em] transition-colors duration-300 ${
                on ? "bg-white text-black" : "text-white/60 hover:text-white"
              }`}
            >
              <span>{o.label}</span>
              <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                {o.icon}
              </svg>
            </button>
          );
        })}
      </div>
      <ThermalButton />
    </div>
  );
}
