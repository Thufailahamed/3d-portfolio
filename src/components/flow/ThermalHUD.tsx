"use client";

import { useEffect, useRef } from "react";
import { sceneState } from "@/lib/sceneState";
import { useApp } from "@/store/useApp";

export const PALETTES = ["WHT HOT", "BLK HOT", "IRONBOW"];
const ZOOM_MIN = 1.5;
const ZOOM_MAX = 12;

export function toggleThermal(on?: boolean) {
  const s = useApp.getState();
  s.set({ thermal: on ?? !s.thermal });
}

export function cyclePalette() {
  const s = useApp.getState();
  s.set({ thermalPalette: (s.thermalPalette + 1) % PALETTES.length });
}

function zoomBy(factor: number) {
  const t = sceneState.thermal;
  t.zoomTarget = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, t.zoomTarget * factor));
}

/** The binoculars' button at the side of the pavilion. */
export function ThermalButton() {
  const on = useApp((s) => s.thermal);
  return (
    <button
      type="button"
      onClick={() => toggleThermal()}
      aria-pressed={on}
      aria-label={on ? "Lower the thermal binoculars" : "Raise the thermal binoculars"}
      className={`group flex items-center gap-2.5 rounded-full border px-3.5 py-2 font-mono text-[10px] uppercase tracking-[0.22em] backdrop-blur-md transition-colors duration-300 ${
        on ? "border-white bg-white text-black" : "border-white/20 bg-black/45 text-white/75 hover:border-white/60 hover:text-white"
      }`}
    >
      <span>{on ? "Lower" : "Thermal"}</span>
      <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <path d="M4.5 9.5 6 5.5h3.5l.8 4M19.5 9.5 18 5.5h-3.5l-.8 4" />
        <circle cx="6.5" cy="14.5" r="4" />
        <circle cx="17.5" cy="14.5" r="4" />
        <path d="M10.5 13h3" />
      </svg>
    </button>
  );
}

/**
 * What is seen through the thermal binoculars, drawn over the eyepieces: a stadiametric
 * reticle, compass tape, spot temperature and range under the reticle, the auto-gain span,
 * magnification, palette, battery and recording state. Values update every frame from the
 * render pass's telemetry without re-rendering React.
 */
export default function ThermalHUD() {
  const on = useApp((s) => s.thermal);
  const palette = useApp((s) => s.thermalPalette);
  const root = useRef<HTMLDivElement>(null);
  const tape = useRef<HTMLDivElement>(null);
  const spotRef = useRef<HTMLSpanElement>(null);
  const rangeRef = useRef<HTMLSpanElement>(null);
  const spanRef = useRef<HTMLSpanElement>(null);
  const zoomRef = useRef<HTMLSpanElement>(null);
  const elRef = useRef<HTMLSpanElement>(null);
  const hdgRef = useRef<HTMLSpanElement>(null);
  const nucRef = useRef<HTMLDivElement>(null);
  const clockRef = useRef<HTMLSpanElement>(null);
  const stadiaRef = useRef<SVGSVGElement>(null);

  // scroll to zoom while the binoculars are up (ahead of the pavilion's own wheel handling)
  useEffect(() => {
    if (!on) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      e.stopPropagation();
      zoomBy(Math.exp(-e.deltaY * 0.0016));
    };
    window.addEventListener("wheel", onWheel, { passive: false, capture: true });
    return () => window.removeEventListener("wheel", onWheel, { capture: true });
  }, [on]);

  useEffect(() => {
    let id = 0;
    const started = performance.now();
    const fmt = (v: number, d = 1) => (Number.isFinite(v) ? v.toFixed(d) : "--");
    const tick = () => {
      id = requestAnimationFrame(tick);
      const t = sceneState.thermal;
      const r = root.current;
      if (!r) return;
      // the readout appears once the eyepieces have settled at the eyes
      const show = Math.max(0, (t.raise - 0.82) / 0.18);
      r.style.opacity = String(show);
      r.style.visibility = show > 0.001 ? "visible" : "hidden";
      if (show <= 0.001) return;
      const e = {
        spot: spotRef.current,
        range: rangeRef.current,
        span: spanRef.current,
        zoom: zoomRef.current,
        el: elRef.current,
        hdg: hdgRef.current,
        nuc: nucRef.current,
        clock: clockRef.current,
        stadia: stadiaRef.current,
      };
      if (e.spot) e.spot.textContent = `${fmt(t.spot)}°C`;
      if (e.range) e.range.textContent = t.range > 2000 ? "----" : String(Math.round(t.range)).padStart(4, "0");
      if (e.span) e.span.textContent = `${fmt(t.lo)} – ${fmt(t.hi)}°C`;
      if (e.zoom) e.zoom.textContent = `×${t.zoom.toFixed(1)}`;
      if (e.el) e.el.textContent = `${t.elevation >= 0 ? "+" : "−"}${fmt(Math.abs(t.elevation))}°`;
      if (e.hdg) e.hdg.textContent = String(Math.round(t.heading) % 360).padStart(3, "0");
      if (e.nuc) e.nuc.style.opacity = t.nuc ? "1" : "0";
      if (e.clock) {
        const s = Math.floor((performance.now() - started) / 1000);
        e.clock.textContent = `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
      }
      // compass tape: 3px per degree, centred on the heading
      if (tape.current) tape.current.style.transform = `translateX(${-t.heading * 3}px)`;
      // stadia scale with magnification
      if (e.stadia) e.stadia.style.transform = `translate(-50%, -50%) scale(${Math.min(1.6, 0.7 + t.zoom * 0.08)})`;
    };
    tick();
    return () => cancelAnimationFrame(id);
  }, []);

  const ticks = [];
  for (let d = -360; d <= 720; d += 5) {
    const major = d % 15 === 0;
    const deg = ((d % 360) + 360) % 360;
    const label = deg % 90 === 0 ? ["N", "E", "S", "W"][deg / 90] : major ? String(deg).padStart(3, "0") : "";
    ticks.push(
      <div key={d} className="absolute top-0 flex flex-col items-center" style={{ left: d * 3, transform: "translateX(-50%)" }}>
        <span className={`block w-px bg-white/80 ${major ? "h-2.5" : "h-1.5"}`} />
        {label && <span className="mt-0.5 text-[9px] tracking-wider text-white/85">{label}</span>}
      </div>,
    );
  }

  return (
    <div ref={root} aria-hidden className="pointer-events-none fixed inset-0 z-30 select-none font-mono text-white" style={{ opacity: 0, visibility: "hidden", textShadow: "0 0 6px rgba(0,0,0,0.85)" }}>
      {/* compass tape across the top of the eyepieces */}
      <div className="absolute left-1/2 overflow-hidden" style={{ top: "calc(50vh - 36vh)", width: "34vh", height: 30, transform: "translateX(-50%)", maskImage: "linear-gradient(90deg, transparent, #000 25%, #000 75%, transparent)" }}>
        <div className="absolute left-1/2 top-0">
          <div ref={tape} className="relative">
            {ticks}
          </div>
        </div>
      </div>
      <div className="absolute left-1/2 text-center" style={{ top: "calc(50vh - 36vh + 30px)", transform: "translateX(-50%)" }}>
        <span className="block h-0 w-0 border-x-4 border-b-[5px] border-x-transparent border-b-white mx-auto" />
        <span ref={hdgRef} className="text-[11px] tracking-[0.2em]">000</span>
      </div>

      {/* reticle: open cross, centre dot, stadia ladder for ranging a standing figure */}
      <svg className="absolute left-1/2 top-1/2" width="220" height="220" viewBox="-110 -110 220 220" style={{ transform: "translate(-50%, -50%)" }}>
        <g stroke="white" strokeWidth="1.2" fill="none" opacity="0.9">
          <line x1="-100" y1="0" x2="-14" y2="0" />
          <line x1="14" y1="0" x2="100" y2="0" />
          <line x1="0" y1="-100" x2="0" y2="-14" />
          <line x1="0" y1="14" x2="0" y2="60" />
          <circle cx="0" cy="0" r="1.6" fill="white" />
          {[-80, -60, -40, 40, 60, 80].map((x) => (
            <line key={x} x1={x} y1="-4" x2={x} y2="4" />
          ))}
        </g>
      </svg>
      <svg ref={stadiaRef} className="absolute left-1/2 top-1/2" width="60" height="120" viewBox="0 0 60 120" style={{ transform: "translate(-50%, -50%)" }}>
        <g stroke="white" strokeWidth="1" fill="none" opacity="0.55" transform="translate(42 0)">
          <line x1="0" y1="20" x2="0" y2="100" />
          {[20, 40, 60, 80, 100].map((y) => (
            <line key={y} x1="0" y1={y} x2={y % 40 === 20 ? 8 : 5} y2={y} />
          ))}
        </g>
      </svg>

      {/* spot temperature and range under the reticle */}
      <div className="absolute text-[11px] leading-5 tracking-[0.18em]" style={{ left: "calc(50% + 8vh)", top: "calc(50% + 2.5vh)" }}>
        <div>
          <span className="text-white/60">SPOT </span>
          <span ref={spotRef} className="text-[13px]">--</span>
        </div>
        <div>
          <span className="text-white/60">RNG </span>
          <span ref={rangeRef}>----</span>
          <span className="text-white/60"> m</span>
        </div>
        <div>
          <span className="text-white/60">EL </span>
          <span ref={elRef}>+0.0°</span>
        </div>
      </div>

      {/* status along the bottom of the eyepieces */}
      <div className="absolute left-1/2 flex items-center gap-5 text-[10px] tracking-[0.22em]" style={{ top: "calc(50vh + 31vh)", transform: "translateX(-50%)" }}>
        <span ref={zoomRef}>×2.5</span>
        <span>{PALETTES[palette]}</span>
        <span className="text-white/70">AGC <span ref={spanRef} /></span>
      </div>
      <div className="absolute left-1/2 flex items-center gap-4 text-[10px] tracking-[0.22em]" style={{ top: "calc(50vh + 34.5vh)", transform: "translateX(-50%)" }}>
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-red-500" />
          REC <span ref={clockRef}>00:00</span>
        </span>
        <span className="flex items-center gap-1">
          <span className="relative inline-block h-2 w-4 border border-white/80">
            <span className="absolute inset-y-0 left-0 w-[72%] bg-white/80" />
          </span>
          72%
        </span>
        <span className="text-white/70">LWIR 8–14µm</span>
      </div>
      <div ref={nucRef} className="absolute left-1/2 text-[11px] tracking-[0.3em] transition-opacity" style={{ top: "calc(50vh - 30vh)", transform: "translateX(-50%)", opacity: 0 }}>
        NUC
      </div>

      {/* how to use it, under the eyepieces */}
      <div className="absolute bottom-6 left-1/2 flex gap-5 text-[9.5px] tracking-[0.22em] text-white/55" style={{ transform: "translateX(-50%)" }}>
        <span>SCROLL / + − ZOOM</span>
        <span>P PALETTE</span>
        <span>B / ESC LOWER</span>
      </div>
    </div>
  );
}

export { zoomBy };
