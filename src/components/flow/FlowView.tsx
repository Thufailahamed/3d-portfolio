"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef } from "react";
import { projects } from "@/content/site";
import { gsap, useGSAP } from "@/lib/gsap";
import { sceneState } from "@/lib/sceneState";
import { useApp } from "@/store/useApp";

const pad = (n: number) => String(n).padStart(2, "0");

export default function FlowView() {
  const root = useRef<HTMLDivElement>(null);
  const layer = useRef<HTMLDivElement>(null);
  const router = useRouter();
  const flowView = useApp((s) => s.flowView);
  const flowFocus = useApp((s) => s.flowFocus);
  const set = useApp((s) => s.set);

  const activeProject = flowFocus !== null ? projects[flowFocus] : null;

  const switchView = (view: "exterior" | "hall" | "showcase", focus: number | null = null) => {
    gsap.to(sceneState.flow, {
      pan: 0,
      tilt: 0,
      ...(view !== "hall" ? { walk: 0 } : {}),
      duration: 0.75,
      ease: "power2.out",
    });
    set({ flowView: view, flowFocus: focus });
  };

  useGSAP(
    () => {
      gsap.fromTo(
        ".flow-ui-in",
        { autoAlpha: 0, y: -10 },
        {
          autoAlpha: 1,
          y: 0,
          duration: 0.65,
          stagger: 0.04,
          ease: "power3.out",
          delay: 0.1,
        },
      );
      gsap.fromTo(
        ".flow-card-in",
        { autoAlpha: 0, y: 16 },
        {
          autoAlpha: 1,
          y: 0,
          duration: 0.55,
          ease: "power3.out",
          delay: 0.2,
        },
      );
    },
    { scope: root },
  );

  // Support optional ?view=hall or ?showcase=1..6 query parameters on load
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const v = params.get("view");
    const sc = params.get("showcase");
    if (sc !== null) {
      const idx = Math.max(0, Math.min(projects.length - 1, parseInt(sc, 10) - 1));
      if (!Number.isNaN(idx)) set({ flowView: "showcase", flowFocus: idx });
    } else if (v === "hall") {
      set({ flowView: "hall", flowFocus: null });
    } else if (v === "exterior") {
      set({ flowView: "exterior", flowFocus: null });
    }
  }, [set]);

  // Interactive drag-to-look, click-to-pick (portal & 6 showcases), and wheel stroll in hall
  useEffect(() => {
    const el = layer.current;
    if (!el) return;
    let down: { x: number; y: number } | null = null;
    let lastX = 0;
    let lastY = 0;

    const onDown = (e: PointerEvent) => {
      down = { x: e.clientX, y: e.clientY };
      lastX = e.clientX;
      lastY = e.clientY;
      try {
        el.setPointerCapture(e.pointerId);
      } catch {
        // ignore synthetic events
      }
      gsap.killTweensOf(sceneState.flow, "pan,tilt");
    };

    const onMove = (e: PointerEvent) => {
      const f = sceneState.flow;
      if (!down) {
        // Hover cursor feedback over portal or showcases
        const hit = f.pick((e.clientX / window.innerWidth) * 2 - 1, -(e.clientY / window.innerHeight) * 2 + 1);
        f.hover = hit;
        el.style.cursor = hit >= 0 ? "pointer" : "grab";
        return;
      }
      el.style.cursor = "grabbing";
      const dx = (e.clientX - lastX) / window.innerWidth;
      const dy = (e.clientY - lastY) / window.innerHeight;
      f.pan = gsap.utils.clamp(-1.1, 1.1, f.pan + dx * 2.2);
      f.tilt = gsap.utils.clamp(-0.55, 0.75, f.tilt - dy * 1.8);
      lastX = e.clientX;
      lastY = e.clientY;
    };

    const onUp = (e: PointerEvent) => {
      const start = down;
      down = null;
      el.style.cursor = "grab";
      if (!start || Math.hypot(e.clientX - start.x, e.clientY - start.y) > 8) return;

      const hit = sceneState.flow.pick(
        (e.clientX / window.innerWidth) * 2 - 1,
        -(e.clientY / window.innerHeight) * 2 + 1,
      );
      if (hit === 99) {
        switchView("hall", null);
      } else if (hit >= 0 && hit < projects.length) {
        switchView("showcase", hit);
      } else if (useApp.getState().flowView === "showcase") {
        switchView("hall", null);
      }
    };

    const onWheel = (e: WheelEvent) => {
      const currentView = useApp.getState().flowView;
      if (currentView === "hall") {
        e.preventDefault();
        sceneState.flow.walk = gsap.utils.clamp(0, 22, sceneState.flow.walk + e.deltaY * 0.015);
      }
    };

    el.addEventListener("pointerdown", onDown);
    el.addEventListener("pointermove", onMove);
    el.addEventListener("pointerup", onUp);
    el.addEventListener("wheel", onWheel, { passive: false });

    return () => {
      el.removeEventListener("pointerdown", onDown);
      el.removeEventListener("pointermove", onMove);
      el.removeEventListener("pointerup", onUp);
      el.removeEventListener("wheel", onWheel);
    };
  }, []);

  // Keyboard navigation shortcuts
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (flowView === "showcase") {
          switchView("hall", null);
        } else if (flowView === "hall") {
          switchView("exterior", null);
        } else {
          router.push("/projects");
        }
      } else if (e.key === "Enter" && flowView === "exterior") {
        switchView("hall", null);
      } else if (e.key === "ArrowRight") {
        const next = flowFocus === null ? 0 : (flowFocus + 1) % projects.length;
        switchView("showcase", next);
      } else if (e.key === "ArrowLeft") {
        const prev = flowFocus === null ? projects.length - 1 : (flowFocus - 1 + projects.length) % projects.length;
        switchView("showcase", prev);
      } else if (e.key >= "1" && e.key <= "6") {
        const idx = parseInt(e.key, 10) - 1;
        switchView("showcase", idx);
      } else if (e.key.toLowerCase() === "e") {
        switchView("exterior", null);
      } else if (e.key.toLowerCase() === "h") {
        switchView("hall", null);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [flowView, flowFocus, router]);

  return (
    <div
      ref={root}
      className="fixed inset-0 z-20 flex flex-col justify-between pointer-events-none px-4 pb-4 pt-16 md:px-gutter md:pb-8 md:pt-20"
      role="region"
      aria-label="3D Exhibition Flow"
    >
      {/* Interactive 3D Pointer Layer for Drag-to-Look & Raycast Picking */}
      <div ref={layer} aria-hidden className="pointer-events-auto absolute inset-0 touch-none cursor-grab" />

      {/* Top Header / View Presets Bar (positioned cleanly below global Header chrome) */}
      <header className="relative z-10 flex flex-wrap items-center justify-between gap-4 pointer-events-auto">
        <Link
          href="/projects"
          data-cursor="view"
          className="flow-ui-in group inline-flex items-center gap-2 rounded-full border border-fg/20 bg-black/65 px-4 py-2 text-xs font-mono uppercase tracking-widest text-fg/90 backdrop-blur-md transition-all hover:border-fg/60 hover:bg-black/85"
        >
          <span className="text-accent transition-transform group-hover:-translate-x-1">←</span>
          <span>Exit to Projects</span>
        </Link>

        {/* View Switcher Pills */}
        <div className="flow-ui-in flex flex-wrap items-center gap-1.5 rounded-full border border-fg/15 bg-black/75 p-1 backdrop-blur-md shadow-2xl">
          <button
            type="button"
            onClick={() => switchView("exterior", null)}
            className={`rounded-full px-3.5 py-1.5 text-xs font-mono uppercase tracking-wider transition-all ${
              flowView === "exterior"
                ? "bg-accent text-black font-semibold shadow-[0_0_15px_rgba(200,255,61,0.4)]"
                : "text-fg/70 hover:text-fg hover:bg-white/10"
            }`}
          >
            🏛 Exterior Plaza
          </button>
          <button
            type="button"
            onClick={() => switchView("hall", null)}
            className={`rounded-full px-3.5 py-1.5 text-xs font-mono uppercase tracking-wider transition-all ${
              flowView === "hall"
                ? "bg-accent text-black font-semibold shadow-[0_0_15px_rgba(200,255,61,0.4)]"
                : "text-fg/70 hover:text-fg hover:bg-white/10"
            }`}
          >
            🚶 Inside Hall
          </button>

          <span className="mx-1 h-3.5 w-px bg-fg/20" />

          {/* Individual Project Showcase Selectors */}
          {projects.map((p, i) => {
            const isSelected = flowView === "showcase" && flowFocus === i;
            return (
              <button
                key={p.slug}
                type="button"
                onClick={() => switchView("showcase", i)}
                className={`rounded-full px-2.5 py-1.5 text-xs font-mono transition-all ${
                  isSelected
                    ? "bg-accent text-black font-bold shadow-[0_0_12px_rgba(200,255,61,0.4)]"
                    : "text-fg/60 hover:text-fg hover:bg-white/10"
                }`}
                title={p.title}
              >
                {pad(i + 1)}
              </button>
            );
          })}
        </div>
      </header>

      {/* Center Guidance Hint when in Exterior or Hall Mode */}
      {flowView !== "showcase" && (
        <div className="flow-ui-in relative z-10 self-center text-center pointer-events-auto mt-auto mb-6">
          <button
            type="button"
            onClick={() =>
              flowView === "exterior" ? switchView("hall", null) : switchView("showcase", 0)
            }
            className="label rounded-full border border-fg/20 bg-black/60 px-5 py-2.5 backdrop-blur-md text-xs tracking-widest text-fg/80 transition-all hover:border-accent/60 hover:text-fg hover:bg-black/80"
          >
            {flowView === "exterior"
              ? "← Drag to look around · Click portal or here to enter Inside Hall →"
              : "← Drag to look · Scroll to stroll gallery · Click any showcase [01–06] →"}
          </button>
        </div>
      )}

      {/* Bottom Showcase Inspection Card (Active Project Details) */}
      <footer className="relative z-10 pointer-events-auto flex items-end justify-between gap-6">
        {activeProject ? (
          <div className="flow-card-in max-w-xl rounded-2xl border border-fg/20 bg-black/85 p-6 backdrop-blur-xl shadow-2xl">
            <div className="flex items-center justify-between gap-4">
              <span className="label text-xs uppercase tracking-widest text-accent">
                Showcase {pad((flowFocus ?? 0) + 1)} · {activeProject.category}
              </span>
              <div className="flex gap-1.5">
                <button
                  type="button"
                  onClick={() => {
                    const prev = (flowFocus! - 1 + projects.length) % projects.length;
                    switchView("showcase", prev);
                  }}
                  className="rounded-full border border-fg/20 px-2.5 py-1 text-xs hover:border-fg/60"
                  aria-label="Previous showcase"
                >
                  ←
                </button>
                <button
                  type="button"
                  onClick={() => {
                    const next = (flowFocus! + 1) % projects.length;
                    switchView("showcase", next);
                  }}
                  className="rounded-full border border-fg/20 px-2.5 py-1 text-xs hover:border-fg/60"
                  aria-label="Next showcase"
                >
                  →
                </button>
                <button
                  type="button"
                  onClick={() => switchView("hall", null)}
                  className="rounded-full border border-fg/20 px-2.5 py-1 text-xs hover:border-fg/60"
                  aria-label="Return to hall"
                >
                  ✕
                </button>
              </div>
            </div>

            <h2 className="display mt-2 text-2xl md:text-3xl text-fg font-normal tracking-tight">
              {activeProject.title}
            </h2>
            <p className="mt-2 text-sm text-fg/75 line-clamp-2">{activeProject.tagline}</p>

            <div className="mt-3 flex flex-wrap gap-1.5">
              {activeProject.stack.slice(0, 4).map((tech) => (
                <span
                  key={tech}
                  className="rounded-md border border-fg/10 bg-white/5 px-2 py-0.5 text-[10px] font-mono text-fg/70"
                >
                  {tech}
                </span>
              ))}
            </div>

            <div className="mt-5 flex items-center gap-4">
              <Link
                href={`/projects/${activeProject.slug}`}
                data-cursor="view"
                className="label inline-flex items-center gap-1.5 text-xs text-accent underline underline-offset-4 hover:brightness-125"
              >
                Open Full Case Study ↗
              </Link>
              {activeProject.link && (
                <a
                  href={activeProject.link}
                  target="_blank"
                  rel="noreferrer"
                  className="label inline-flex items-center gap-1.5 text-xs text-fg/60 hover:text-fg underline underline-offset-4"
                >
                  Visit Live Site ↗
                </a>
              )}
            </div>
          </div>
        ) : (
          <div className="flow-ui-in max-w-sm rounded-xl border border-fg/15 bg-black/65 p-4 backdrop-blur-md">
            <p className="text-xs font-mono uppercase tracking-widest text-accent mb-1">
              {flowView === "exterior" ? "Exterior Colonnade" : "Grand Nave Gallery"}
            </p>
            <p className="text-xs text-fg/70">
              {flowView === "exterior"
                ? "Classical octastyle temple portico, rotunda dome, and obsidian plaza inspired by virtuallyeverafter.xyz."
                : "36-meter coffered barrel vault with 6 custom project vitrines and Rose Window aperture."}
            </p>
          </div>
        )}

        {/* Quick Shortcut Badge */}
        <div className="flow-ui-in hidden md:flex flex-col items-end gap-1 text-[11px] font-mono text-fg/40">
          <span>[1-6] Jump Showcase</span>
          <span>[E] Exterior · [H] Inside Hall</span>
          <span>[Esc] Step Back / Exit</span>
        </div>
      </footer>
    </div>
  );
}
