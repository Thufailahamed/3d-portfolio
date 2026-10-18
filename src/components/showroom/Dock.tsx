"use client";

import { useEffect, useRef, type ReactNode } from "react";

/**
 * The showroom's control dock: two rows of icon buttons along the bottom of the screen. A button
 * either flips a switch (a dot shows under it while it is on) or opens a small panel of options
 * that floats above the dock. Hovering names the button; Esc or a click elsewhere closes a panel.
 */
export type DockItem = {
  id: string;
  label: string;
  /** the keyboard shortcut, shown in the tooltip */
  hint?: string;
  icon: ReactNode;
  /** a switch that is on, or a panel whose setting is not the default */
  active?: boolean;
  disabled?: boolean;
  /** what opens above the dock; without one the button acts straight away */
  panel?: ReactNode;
  onClick?: () => void;
};

export default function Dock({ rows, open, onOpen, hidden }: { rows: DockItem[][]; open: string | null; onOpen: (id: string | null) => void; hidden?: boolean }) {
  const root = useRef<HTMLDivElement>(null);
  const all = rows.flat();
  const current = all.find((i) => i.id === open && i.panel);

  // a click outside the dock (and its panel) closes the panel
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (root.current && !root.current.contains(e.target as Node)) onOpen(null);
    };
    addEventListener("pointerdown", onDown);
    return () => removeEventListener("pointerdown", onDown);
  }, [open, onOpen]);

  return (
    <div
      ref={root}
      className={`sr-hud absolute inset-x-0 bottom-3 z-30 flex justify-center px-gutter transition-all duration-500 md:bottom-5 ${
        hidden ? "pointer-events-none translate-y-6 opacity-0" : "opacity-100"
      }`}
    >
      <div className="relative max-w-full">
        {current && (
          <div
            key={current.id}
            role="dialog"
            aria-label={current.label}
            className="sr-panel absolute bottom-full left-1/2 mb-3 w-max max-w-[calc(100vw-2rem)] -translate-x-1/2 rounded-2xl border border-fg/10 bg-[#121214]/85 p-3 shadow-[0_30px_80px_-30px_rgba(0,0,0,0.9)] backdrop-blur-xl"
          >
            <p className="label mb-2.5 px-1 !text-[9px]">{current.label}</p>
            {current.panel}
          </div>
        )}
        <div
          role="toolbar"
          aria-label="Showroom controls"
          data-lenis-prevent
          className="no-scrollbar grid max-w-full grid-flow-col grid-rows-2 gap-x-1 gap-y-1 overflow-x-auto rounded-2xl border border-fg/10 bg-[#121214]/70 p-1.5 shadow-[0_30px_80px_-30px_rgba(0,0,0,0.9)] backdrop-blur-xl md:gap-x-1.5"
          style={{ gridTemplateRows: "auto auto" }}
        >
          {/* column-major so the two rows read across: lay row 0 and row 1 out side by side */}
          {rows[0].map((top, i) => {
            const bottom = rows[1][i];
            return [top, bottom].filter(Boolean).map((item) => (
              <DockButton key={item.id} item={item} open={open === item.id} quiet={!!open} onOpen={onOpen} />
            ));
          })}
        </div>
      </div>
    </div>
  );
}

function DockButton({ item, open, quiet, onOpen }: { item: DockItem; open: boolean; quiet: boolean; onOpen: (id: string | null) => void }) {
  const on = item.active || open;
  return (
    <button
      type="button"
      disabled={item.disabled}
      aria-label={item.label}
      aria-pressed={item.panel ? undefined : !!item.active}
      aria-expanded={item.panel ? open : undefined}
      title={item.hint ? `${item.label} (${item.hint})` : item.label}
      onClick={() => {
        if (item.panel) onOpen(open ? null : item.id);
        else {
          item.onClick?.();
          onOpen(null);
        }
      }}
      className={`group relative grid h-11 w-11 place-items-center rounded-xl transition-colors duration-300 disabled:cursor-not-allowed disabled:opacity-30 ${
        open ? "bg-fg/12 text-fg" : on ? "text-accent hover:bg-fg/8" : "text-fg/75 hover:bg-fg/8 hover:text-fg"
      }`}
    >
      {item.icon}
      {/* lit while a switch is on */}
      <span className={`absolute bottom-1 h-1 w-1 rounded-full bg-current transition-opacity duration-300 ${item.active ? "opacity-100" : "opacity-0"}`} />
      {/* the name, on hover */}
      {!quiet && (
        <span className="pointer-events-none absolute bottom-full left-1/2 mb-2 hidden -translate-x-1/2 whitespace-nowrap rounded-md border border-fg/10 bg-[#0c0c0e]/90 px-2 py-1 font-mono text-[9px] uppercase tracking-[0.12em] text-fg/85 opacity-0 transition-opacity duration-200 group-hover:opacity-100 md:block">
          {item.label}
          {item.hint && <span className="ml-1.5 text-fg/40">{item.hint}</span>}
        </span>
      )}
    </button>
  );
}

// ---------------------------------------------------------------------- panel parts

export function Swatches({ children }: { children: ReactNode }) {
  return <div className="flex max-w-[22rem] flex-wrap items-center gap-2 px-1">{children}</div>;
}

export function Swatch({ on, label, background, onClick }: { on: boolean; label: string; background: string; onClick: () => void }) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={on}
      title={label}
      onClick={onClick}
      className={`h-8 w-8 rounded-full border transition-all duration-300 ${
        on ? "scale-110 border-fg ring-2 ring-fg/20 ring-offset-2 ring-offset-[#121214]" : "border-fg/20 hover:border-fg/60"
      }`}
      style={{ background }}
    />
  );
}

/** a lacquered sphere for a paint colour */
export const lacquer = (hex: string) =>
  `radial-gradient(circle at 32% 28%, rgba(255,255,255,0.55), rgba(255,255,255,0) 42%), radial-gradient(circle at 70% 80%, rgba(0,0,0,0.45), rgba(0,0,0,0) 60%), ${hex}`;

export function Chips({ children }: { children: ReactNode }) {
  return <div className="flex max-w-[24rem] flex-wrap gap-1.5">{children}</div>;
}

export function Chip({ on, onClick, children, title }: { on: boolean; onClick: () => void; children: ReactNode; title?: string }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      title={title}
      onClick={onClick}
      className={`rounded-lg border px-3 py-2 font-mono text-[10px] uppercase tracking-[0.08em] transition-colors ${
        on ? "border-fg bg-fg text-bg" : "border-fg/12 text-fg/70 hover:border-fg/40 hover:text-fg"
      }`}
    >
      {children}
    </button>
  );
}

export function Slider({ label, value, min, max, step, onChange, format }: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
  format?: (v: number) => string;
}) {
  return (
    <label className="grid grid-cols-[6.5rem_1fr_2.75rem] items-center gap-3 px-1 py-1.5 text-xs text-fg/70">
      {label}
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(+e.target.value)} className="w-full accent-[#c8ff3d]" />
      <span className="text-right font-mono text-[10px] tabular-nums text-fg/50">{format ? format(value) : value.toFixed(2)}</span>
    </label>
  );
}

export function ColorField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <label className="grid grid-cols-[6.5rem_1fr_2.75rem] items-center gap-3 px-1 py-1.5 text-xs text-fg/70">
      {label}
      <input type="color" value={value} onChange={(e) => onChange(e.target.value)} className="h-7 w-full cursor-pointer rounded-md border border-fg/15 bg-transparent" />
      <span className="text-right font-mono text-[10px] uppercase text-fg/50">{value.slice(1)}</span>
    </label>
  );
}

// ---------------------------------------------------------------------- icons (24 × 24, drawn for the dock)

const Svg = ({ children }: { children: ReactNode }) => (
  <svg aria-hidden width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
    {children}
  </svg>
);

export const icons = {
  car: (
    <Svg>
      <path d="M3.5 15.5v-3l2-4.2c.3-.7 1-1.1 1.8-1.1h9.4c.8 0 1.5.4 1.8 1.1l2 4.2v3" />
      <path d="M3 15.5h18v2.2a.8.8 0 0 1-.8.8H18.5a.8.8 0 0 1-.8-.8v-.7H6.3v.7a.8.8 0 0 1-.8.8H3.8a.8.8 0 0 1-.8-.8z" />
      <path d="M5.5 12.2h13" />
      <circle cx="7" cy="14" r=".6" fill="currentColor" />
      <circle cx="17" cy="14" r=".6" fill="currentColor" />
    </Svg>
  ),
  paint: (
    <Svg>
      <path d="M12 3.5c3 3.7 5.5 6.8 5.5 10a5.5 5.5 0 0 1-11 0c0-3.2 2.5-6.3 5.5-10z" />
      <path d="M9.5 14.5a2.6 2.6 0 0 0 2.2 2.4" />
    </Svg>
  ),
  brakes: (
    <Svg>
      <circle cx="12" cy="12" r="8" />
      <circle cx="12" cy="12" r="2.4" />
      {[0, 60, 120, 180, 240, 300].map((a) => (
        // rounded, so the server and the browser draw the same numbers
        <circle key={a} cx={(12 + Math.cos((a * Math.PI) / 180) * 5.2).toFixed(2)} cy={(12 + Math.sin((a * Math.PI) / 180) * 5.2).toFixed(2)} r=".55" fill="currentColor" stroke="none" />
      ))}
      <path d="M17.2 5.2a9.6 9.6 0 0 1 2.9 4.4" strokeWidth="3" />
    </Svg>
  ),
  iridescence: (
    <Svg>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7.2c.5 2.6 1.5 3.6 4.1 4.1-2.6.5-3.6 1.5-4.1 4.1-.5-2.6-1.5-3.6-4.1-4.1 2.6-.5 3.6-1.5 4.1-4.1z" />
      <path d="M16.5 6.7v1.6M15.7 7.5h1.6" />
    </Svg>
  ),
  livery: (
    <Svg>
      <rect x="3.5" y="5" width="17" height="14" rx="3" />
      <path d="M9 5l-3.5 14M13 5l-3.5 14" />
      <path d="M17 9h1.5" />
    </Svg>
  ),
  doors: (
    <Svg>
      <path d="M9 3.5h6c1.1 0 2 .9 2 2v13c0 1.1-.9 2-2 2H9a2 2 0 0 1-2-2v-13c0-1.1.9-2 2-2z" />
      <path d="M8.5 8.5h7M8.5 15h7" />
      <path d="M7 9.5l-3.5 2.3M17 9.5l3.5 2.3" />
      <path d="M3.5 11.8v2.2M20.5 11.8v2.2" strokeDasharray="1 1.4" />
    </Svg>
  ),
  lights: (
    <Svg>
      <path d="M13 6.5c3.6 0 6 2.4 6 5.5s-2.4 5.5-6 5.5h-2v-11z" />
      <path d="M8 8H4M8 12H3.5M8 16H4" />
    </Svg>
  ),
  xray: (
    <Svg>
      <path d="M3 15c1.6-4.4 4.4-6.8 9-6.8s7.4 2.4 9 6.8" strokeDasharray="2 1.8" />
      <path d="M3 15h18" />
      <circle cx="7" cy="16.5" r="1.9" />
      <circle cx="17" cy="16.5" r="1.9" />
      <rect x="9.6" y="11.2" width="4.8" height="2.6" rx=".4" />
    </Svg>
  ),
  measure: (
    <Svg>
      <path d="M3 16h18M3 13v6M21 13v6" />
      <path d="M7 16v-2M11 16v-3M15 16v-2M19 16v-1.5" opacity=".7" />
      <path d="M6 6.5h12M6 5v3M18 5v3" opacity=".55" />
    </Svg>
  ),
  keys: (
    <Svg>
      <rect x="3" y="6.5" width="18" height="11" rx="2" />
      <path d="M6.5 10h1M10 10h1M13.5 10h1M17 10h.5M7.5 14h9" />
    </Svg>
  ),
  interior: (
    <Svg>
      <circle cx="12" cy="12" r="8.5" />
      <circle cx="12" cy="12.5" r="2" />
      <path d="M3.8 11c2.6-1.4 5.3-2 8.2-2s5.6.6 8.2 2M10.3 14.2L8 20M13.7 14.2L16 20" />
    </Svg>
  ),
  views: (
    <Svg>
      <path d="M12 3.8l7 4v8.4l-7 4-7-4V7.8z" />
      <path d="M5 7.8l7 4 7-4M12 11.8v8.4" />
    </Svg>
  ),
  spin: (
    <Svg>
      <ellipse cx="12" cy="15" rx="8.5" ry="3.4" />
      <path d="M16.8 5.6l2.2 1.8-2.6 1.1" />
      <path d="M4.6 9.6C6.2 8 8.7 7.2 12 7.2c2.8 0 5.2.6 6.9 1.6" />
    </Svg>
  ),
  mood: (
    <Svg>
      <path d="M9 18h6M10 21h4" />
      <path d="M12 3.5a5.5 5.5 0 0 0-3.2 10c.7.5 1.2 1.4 1.2 2.3v.2h4v-.2c0-.9.5-1.8 1.2-2.3A5.5 5.5 0 0 0 12 3.5z" />
    </Svg>
  ),
  backdrop: (
    <Svg>
      <rect x="3" y="5" width="15" height="14" rx="2" />
      <path d="M3 16l4.2-4.2a1.5 1.5 0 0 1 2.1 0L15 17.5" />
      <path d="M13 13.5l1.3-1.3a1.5 1.5 0 0 1 2.1 0L18 13.8" />
      <path d="M20.5 3.5v3M19 5h3" />
    </Svg>
  ),
  grid: (
    <Svg>
      <path d="M2.5 19.5h19L17.5 9h-11z" />
      <path d="M4 15.5h16M5.3 12h13.4M9.3 9L8 19.5M14.7 9l1.3 10.5M12 9v10.5" />
    </Svg>
  ),
  quality: (
    <Svg>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 3.5a8.5 8.5 0 0 1 0 17z" fill="currentColor" />
    </Svg>
  ),
  sound: (
    <Svg>
      <path d="M4 9.5h3.2L12 5.5v13l-4.8-4H4z" />
      <path d="M15.5 9a4.2 4.2 0 0 1 0 6M18 6.5a7.6 7.6 0 0 1 0 11" />
    </Svg>
  ),
  settings: (
    <Svg>
      <path d="M4 7h9M17 7h3M4 12h3M11 12h9M4 17h11M19 17h1" />
      <circle cx="15" cy="7" r="2" />
      <circle cx="9" cy="12" r="2" />
      <circle cx="17" cy="17" r="2" />
    </Svg>
  ),
  capture: (
    <Svg>
      <path d="M3.5 8V5.5c0-1.1.9-2 2-2H8M16 3.5h2.5c1.1 0 2 .9 2 2V8M20.5 16v2.5c0 1.1-.9 2-2 2H16M8 20.5H5.5c-1.1 0-2-.9-2-2V16" />
      <path d="M7.5 9.5h2l1-1.5h3l1 1.5h2v6h-9z" />
      <circle cx="12" cy="12.6" r="1.7" />
    </Svg>
  ),
  pose: (
    <Svg>
      <circle cx="7" cy="16" r="3.2" />
      <circle cx="17" cy="16" r="3.2" />
      <path d="M7 16l1.8-1.6M17 16l-1.6-1.8" />
      <path d="M4 11.5l3-3.5h8l3.5 3.5" />
      <path d="M12 3v3M10.5 4.5L12 3l1.5 1.5" />
    </Svg>
  ),
  pins: (
    <Svg>
      <path d="M12 21s-6-5.4-6-10.2A6 6 0 0 1 18 10.8C18 15.6 12 21 12 21z" />
      <circle cx="12" cy="10.6" r="2.2" />
    </Svg>
  ),
  drive: (
    <Svg>
      <path d="M2.5 19.5l4.5-15M21.5 19.5l-4.5-15" />
      <path d="M12 5v2.5M12 10.5v3M12 16.5v3" />
    </Svg>
  ),
  share: (
    <Svg>
      <path d="M10 14l4-4" />
      <path d="M8.5 11.5l-2 2a3.5 3.5 0 0 0 5 5l2-2M15.5 12.5l2-2a3.5 3.5 0 0 0-5-5l-2 2" />
    </Svg>
  ),
  full: (
    <svg aria-hidden width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.3">
      <path d="M1.5 5V1.5H5M9 1.5h3.5V5M12.5 9v3.5H9M5 12.5H1.5V9" />
    </svg>
  ),
  unfull: (
    <svg aria-hidden width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.3">
      <path d="M5 1.5V5H1.5M12.5 5H9V1.5M9 12.5V9h3.5M1.5 9H5v3.5" />
    </svg>
  ),
  film: (
    <svg aria-hidden width="9" height="10" viewBox="0 0 9 10" fill="currentColor">
      <path d="M0 0l9 5-9 5z" />
    </svg>
  ),
};
