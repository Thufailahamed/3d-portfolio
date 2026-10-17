"use client";

import { useEffect, useRef, useState } from "react";
import { projects } from "@/content/site";
import { FLOW_ORIGIN } from "@/lib/chapters";
import { sceneState } from "@/lib/sceneState";
import BlueprintPrototype from "./BlueprintPrototype";
import { SHEETS } from "./blueprintSheets";

const SHEET_KEY = "flowSheet";
const pad = (n: number) => String(n).padStart(2, "0");
const [OX, OY, OZ] = FLOW_ORIGIN;

/** Where the viewer is, in pavilion-local metres, and which way they face on the ground plane. */
function viewer(walking: boolean) {
  const f = sceneState.flow;
  if (walking) {
    const fp = f.fp;
    return { x: fp.x, h: fp.eye, z: fp.z, fx: -Math.sin(fp.viewYaw), fz: -Math.cos(fp.viewYaw) };
  }
  return {
    x: f.pos[0] - OX,
    h: f.pos[1] - OY,
    z: f.pos[2] - OZ,
    fx: f.look[0] - f.pos[0],
    fz: f.look[2] - f.pos[2],
  };
}

const LEGEND: [string, React.ReactNode][] = [
  ["Cut wall / column", <rect key="c" x="1" y="3" width="30" height="8" className="bp-cut" />],
  ["Overhead / beyond", <rect key="o" x="1" y="3" width="30" height="8" className="bp-over" />],
  ["Lit edge", <line key="g" x1="1" y1="7" x2="31" y2="7" className="bp-glow" />],
  ["Camera tour", <line key="r" x1="1" y1="7" x2="31" y2="7" className="bp-route" />],
];

/**
 * The pavilion's drawing set as an overlay on /flow: five measured sheets, a live marker for
 * where the camera (or the walker) stands, and showcases you can click to go to.
 */
export default function BlueprintOverlay({
  walking,
  onClose,
  onGo,
}: {
  walking: boolean;
  onClose: () => void;
  onGo: (index: number) => void;
}) {
  const [idx, setIdx] = useState(() => {
    if (sceneState.flow.fp.indoors || sceneState.flow.view === "hall" || sceneState.flow.view === "showcase") return 1;
    try {
      const saved = SHEETS.findIndex((s) => s.id === localStorage.getItem(SHEET_KEY));
      return saved >= 0 ? saved : 0;
    } catch {
      return 0;
    }
  });
  const [hover, setHover] = useState<number | null>(null);
  /** the plans built up as a 3D maquette, in place of the sheet */
  const [proto, setProto] = useState(false);
  const sheet = SHEETS[idx];
  const dialog = useRef<HTMLDivElement>(null);
  const marker = useRef<SVGGElement>(null);
  const cone = useRef<SVGGElement>(null);
  const readout = useRef<HTMLSpanElement>(null);
  const status = useRef<HTMLSpanElement>(null);

  const pick = (i: number) => {
    setIdx(i);
    setProto(false);
    try {
      localStorage.setItem(SHEET_KEY, SHEETS[i].id);
    } catch {
      // storage unavailable: the sheet still changes
    }
  };

  useEffect(() => {
    dialog.current?.focus();
  }, []);

  // Keys while open: M / Esc close, ← → or 1–5 change sheet; nothing reaches the walk controls.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const k = e.key.toLowerCase();
      // the prototype's timeline slider keeps its own arrow keys
      if (k !== "escape" && (e.target as HTMLElement | null)?.tagName === "INPUT") return;
      let handled = true;
      if (k === "escape" && proto) setProto(false);
      else if (k === "escape" || (k === "m" && !e.repeat)) onClose();
      else if (k === "p" && !e.repeat) setProto((v) => !v);
      else if (k === "arrowright") pick((idx + 1) % SHEETS.length);
      else if (k === "arrowleft") pick((idx - 1 + SHEETS.length) % SHEETS.length);
      else if (k >= "1" && k <= String(SHEETS.length)) pick(parseInt(k, 10) - 1);
      else handled = false;
      if (handled) {
        e.preventDefault();
        e.stopImmediatePropagation();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [idx, onClose, proto]);

  // Live "you are here": written straight to the SVG every frame, no React renders.
  useEffect(() => {
    let id = 0;
    const tick = () => {
      const v = viewer(walking);
      const p = sheet.frame(v.x, v.h, v.z, v.fx, v.fz);
      if (marker.current) {
        marker.current.style.display = p ? "" : "none";
        if (p) marker.current.setAttribute("transform", `translate(${p.X.toFixed(3)} ${p.Y.toFixed(3)}) scale(${sheet.unit})`);
      }
      if (cone.current && p) {
        const show = Math.abs(p.dx) + Math.abs(p.dy) > 0.01;
        cone.current.style.display = show ? "" : "none";
        if (show) cone.current.setAttribute("transform", `rotate(${((Math.atan2(p.dy, p.dx) * 180) / Math.PI).toFixed(1)})`);
      }
      if (readout.current) {
        const hdg = ((((Math.atan2(v.fx, -v.fz) * 180) / Math.PI) % 360) + 360) % 360;
        readout.current.textContent = `X ${v.x.toFixed(1)}  Z ${v.z.toFixed(1)}  H +${v.h.toFixed(2)}  ·  ${String(Math.round(hdg) % 360).padStart(3, "0")}°`;
      }
      if (status.current) status.current.textContent = p ? (walking ? "You" : "Camera") : "Not on this sheet";
      id = requestAnimationFrame(tick);
    };
    tick();
    return () => cancelAnimationFrame(id);
  }, [sheet, walking]);

  const [vx, vy, vw, vh] = sheet.viewBox;

  return (
    <div
      ref={dialog}
      role="dialog"
      aria-modal="true"
      aria-labelledby="bp-title"
      tabIndex={-1}
      className="bp-in pointer-events-auto absolute inset-0 z-40 flex flex-col gap-4 overflow-y-auto bg-[#04060a]/90 p-4 font-mono text-white outline-none backdrop-blur-md sm:p-6 md:p-8 lg:overflow-hidden"
    >
      {/* Title block */}
      <div className="flex flex-wrap items-end justify-between gap-4 border-b border-white/10 pb-4">
        <div>
          <div className="text-[9.5px] uppercase tracking-[0.35em] text-white/40">Drawing set · The pavilion</div>
          <h2 id="bp-title" className="mt-1.5 flex items-baseline gap-3 font-sans text-2xl tracking-tight text-white sm:text-3xl">
            <span className="font-mono text-[11px] tracking-[0.2em] text-accent">{sheet.code}</span>
            {sheet.title}
          </h2>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="flex items-center gap-2 rounded-full border border-white/25 px-4 py-2 text-[10px] uppercase tracking-[0.25em] text-white/75 transition-colors hover:border-white hover:text-white"
        >
          Close <span className="rounded border border-white/25 px-1.5 text-white/60">M</span>
        </button>
      </div>

      {/* Sheet index */}
      <nav aria-label="Sheets" className="-mx-1 flex gap-1 overflow-x-auto pb-1">
        {SHEETS.map((s, i) => (
          <button
            key={s.id}
            type="button"
            onClick={() => pick(i)}
            aria-pressed={i === idx}
            className={`flex shrink-0 items-baseline gap-2 rounded-md border px-3 py-2 text-[10px] uppercase tracking-[0.18em] transition-colors ${
              i === idx ? "border-accent/60 bg-accent/10 text-white" : "border-white/10 text-white/50 hover:border-white/30 hover:text-white"
            }`}
          >
            <span className={i === idx ? "text-accent" : "text-white/35"}>{s.code}</span>
            {s.title}
          </button>
        ))}
      </nav>

      <div className="grid min-h-0 flex-1 gap-4 lg:grid-cols-[minmax(0,1fr)_280px]">
        {/* Drawing, or the plans built up as a prototype */}
        {proto ? (
          <figure className="bp-in relative flex min-h-[60vh] flex-col overflow-hidden rounded-lg border border-accent/30 lg:min-h-0">
            <figcaption className="flex items-center justify-between gap-3 border-b border-white/10 px-4 py-2 text-[9.5px] uppercase tracking-[0.22em] text-white/45">
              <span>Simulation · the drawing set assembled as a 1:200 maquette</span>
              <span className="hidden text-accent sm:inline">Live model</span>
            </figcaption>
            <BlueprintPrototype onExit={() => setProto(false)} />
          </figure>
        ) : (
        <figure className="bp-sheet relative flex min-h-[52vh] flex-col overflow-hidden rounded-lg border border-white/10 lg:min-h-0">
          <figcaption className="flex items-center justify-between gap-3 border-b border-white/10 px-4 py-2 text-[9.5px] uppercase tracking-[0.22em] text-white/45">
            <span>{sheet.view}</span>
            <span className="hidden sm:inline">Metres · scale bar 10 m</span>
          </figcaption>
          <div className="min-h-0 flex-1 overflow-x-auto">
            <svg
              key={sheet.id}
              viewBox={`${vx} ${vy} ${vw} ${vh}`}
              preserveAspectRatio="xMidYMid meet"
              role="img"
              aria-label={`${sheet.title}. ${sheet.caption}`}
              className="bp-svg bp-draw h-full min-w-[720px] w-full"
              style={{ fontSize: `${sheet.unit}px` }}
            >
              <g dangerouslySetInnerHTML={{ __html: sheet.body }} />

              {/* Showcases you can go to */}
              {sheet.picks.map((p) => (
                <g
                  key={p.i}
                  role="button"
                  tabIndex={0}
                  aria-label={`Go to showcase ${pad(p.i + 1)}, ${projects[p.i]?.title ?? ""}`}
                  className="bp-pick"
                  onClick={() => onGo(p.i)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      onGo(p.i);
                    }
                  }}
                  onPointerEnter={() => setHover(p.i)}
                  onPointerLeave={() => setHover((h) => (h === p.i ? null : h))}
                  onFocus={() => setHover(p.i)}
                  onBlur={() => setHover((h) => (h === p.i ? null : h))}
                >
                  <circle cx={p.X} cy={p.Y} r={p.r} className="bp-hit" />
                  <circle cx={p.X} cy={p.Y} r={p.r} className="bp-hitring" />
                </g>
              ))}

              {/* You are here */}
              <g ref={marker} style={{ display: "none" }} className="pointer-events-none">
                <g ref={cone}>
                  <path d="M0 0 L3.95 -2.16 A4.5 4.5 0 0 1 3.95 2.16 Z" className="bp-cone" />
                </g>
                <circle r="1.3" className="bp-pulse" />
                <circle r="0.5" className="bp-me" />
              </g>
            </svg>
          </div>
          {hover !== null && (
            <div className="pointer-events-none absolute bottom-3 left-3 rounded-md border border-accent/40 bg-black/85 px-3 py-2 text-[10px] uppercase tracking-[0.2em]">
              <span className="text-accent">{pad(hover + 1)}</span> · {projects[hover]?.title}
              <span className="ml-2 text-white/45">{walking ? "Click to walk there" : "Click to fly there"}</span>
            </div>
          )}
          <button
            type="button"
            onClick={() => setProto(true)}
            className="bp-cta group absolute bottom-3 right-3 flex items-center gap-2.5 rounded-full border border-accent/60 bg-black/80 py-2 pl-2 pr-4 text-[10px] uppercase tracking-[0.22em] text-white backdrop-blur-sm transition-colors hover:bg-accent hover:text-black"
          >
            <span className="flex h-6 w-6 items-center justify-center rounded-full bg-accent text-black transition-colors group-hover:bg-black group-hover:text-accent">
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.2" aria-hidden>
                <path d="M6 1.2 10.6 3.8v4.4L6 10.8 1.4 8.2V3.8L6 1.2Z" />
                <path d="M1.4 3.8 6 6.4l4.6-2.6M6 6.4v4.4" />
              </svg>
            </span>
            Simulate prototype
            <span className="rounded border border-current/40 px-1.5 text-[9px] opacity-70">P</span>
          </button>
        </figure>
        )}

        {/* Notes column */}
        <aside className="flex min-h-0 flex-col gap-5 text-[11px] leading-relaxed lg:overflow-y-auto">
          {proto ? (
            <>
              <p className="font-sans text-[13.5px] leading-relaxed text-white/75">
                The same pavilion the drawings describe, built from its real model. It starts as the site plan seen from
                above, then rises stage by stage: foundation, walls, colonnades, roof and fit-out.
              </p>
              <ol className="grid gap-px overflow-hidden rounded-md border border-white/10 bg-white/10">
                {["Foundation", "Walls", "Colonnades", "Roof", "Fit-out"].map((t, i) => (
                  <li key={t} className="flex items-baseline gap-3 bg-[#070a0f] px-3 py-2">
                    <span className="text-[9px] text-accent">{String(i + 1).padStart(2, "0")}</span>
                    <span className="text-[11px] uppercase tracking-[0.18em] text-white/80">{t}</span>
                  </li>
                ))}
              </ol>
              <ul className="grid gap-1.5 text-[10px] uppercase tracking-[0.16em] text-white/50">
                <li>Drag · orbit the model</li>
                <li>Scroll · zoom</li>
                <li>Timeline · scrub the build</li>
                <li>Cutaway · lift the vault to see inside</li>
              </ul>
              <div className="mt-auto hidden gap-1 border-t border-white/10 pt-4 text-[9px] uppercase tracking-[0.2em] text-white/35 lg:grid">
                <span>P or Esc · back to the drawings</span>
                <span>M · back to the pavilion</span>
              </div>
            </>
          ) : (
            <>
          <p className="font-sans text-[13.5px] leading-relaxed text-white/75">{sheet.caption}</p>

          <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-md border border-white/10 bg-white/10">
            {sheet.figures.map(([k, v]) => (
              <div key={k} className="bg-[#070a0f] px-3 py-2.5">
                <dt className="text-[9px] uppercase tracking-[0.22em] text-white/40">{k}</dt>
                <dd className="mt-1 text-[13px] tabular-nums text-white">{v}</dd>
              </div>
            ))}
          </dl>

          <div className="rounded-md border border-accent/25 bg-accent/[0.04] px-3 py-2.5">
            <div className="flex items-center gap-2 text-[9px] uppercase tracking-[0.25em] text-accent">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-accent" />
              <span ref={status}>Camera</span>
            </div>
            <span ref={readout} className="mt-1.5 block text-[10px] tracking-[0.12em] text-white/60 tabular-nums" />
          </div>

          {sheet.picks.length > 0 && (
            <p className="text-[10px] uppercase tracking-[0.18em] text-white/45">
              Click a numbered showcase to {walking ? "walk" : "fly"} there.
            </p>
          )}

          <ul className="grid gap-2 border-t border-white/10 pt-4 text-[10px] uppercase tracking-[0.16em] text-white/55">
            {LEGEND.map(([label, mark]) => (
              <li key={label} className="flex items-center gap-3">
                <svg viewBox="0 0 32 14" className="bp-svg h-3.5 w-8 shrink-0" aria-hidden>
                  {mark}
                </svg>
                {label}
              </li>
            ))}
          </ul>

          <div className="mt-auto hidden gap-1 border-t border-white/10 pt-4 text-[9px] uppercase tracking-[0.2em] text-white/35 lg:grid">
            <span>← → or 1–5 · change sheet</span>
            <span>P · simulate the prototype</span>
            <span>M or Esc · back to the pavilion</span>
          </div>
            </>
          )}
        </aside>
      </div>
    </div>
  );
}
