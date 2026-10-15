"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef } from "react";
import { person, projects } from "@/content/site";
import { gsap, useGSAP } from "@/lib/gsap";
import { sceneState } from "@/lib/sceneState";
import { useApp } from "@/store/useApp";

const pad = (n: number) => String(n).padStart(2, "0");

/**
 * High-DPI Vector-Sharp 3D Wireframe Icosahedron Emblem
 */
function WireframeEmblem() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = typeof window !== "undefined" ? Math.min(window.devicePixelRatio || 1, 2) : 1;
    const size = 32;
    canvas.width = size * dpr;
    canvas.height = size * dpr;
    ctx.scale(dpr, dpr);

    let animId = 0;
    let angleX = 0.25;
    let angleY = 0;

    // 12 vertices of an icosahedron
    const phi = (1 + Math.sqrt(5)) / 2;
    const rawVerts: [number, number, number][] = [
      [-1, phi, 0],
      [1, phi, 0],
      [-1, -phi, 0],
      [1, -phi, 0],
      [0, -1, phi],
      [0, 1, phi],
      [0, -1, -phi],
      [0, 1, -phi],
      [phi, 0, -1],
      [phi, 0, 1],
      [-phi, 0, -1],
      [-phi, 0, 1],
    ];
    const verts = rawVerts.map(([x, y, z]) => {
      const len = Math.hypot(x, y, z);
      return [x / len, y / len, z / len] as [number, number, number];
    });

    const edges: [number, number][] = [];
    for (let i = 0; i < verts.length; i++) {
      for (let j = i + 1; j < verts.length; j++) {
        const d = Math.hypot(
          verts[i][0] - verts[j][0],
          verts[i][1] - verts[j][1],
          verts[i][2] - verts[j][2],
        );
        if (Math.abs(d - 1.05146) < 0.15) {
          edges.push([i, j]);
        }
      }
    }

    const render = () => {
      angleY += 0.014;
      angleX += 0.006;

      ctx.clearRect(0, 0, size, size);
      const cx = size / 2;
      const cy = size / 2;
      const r = 13.5;

      const cosY = Math.cos(angleY);
      const sinY = Math.sin(angleY);
      const cosX = Math.cos(angleX);
      const sinX = Math.sin(angleX);

      const projected = verts.map(([x, y, z]) => {
        const x1 = x * cosY - z * sinY;
        const z1 = x * sinY + z * cosY;
        const y2 = y * cosX - z1 * sinX;
        const z2 = y * sinX + z1 * cosX;
        return [cx + x1 * r, cy - y2 * r, z2] as [number, number, number];
      });

      ctx.strokeStyle = "rgba(255, 255, 255, 0.78)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (const [i, j] of edges) {
        ctx.moveTo(projected[i][0], projected[i][1]);
        ctx.lineTo(projected[j][0], projected[j][1]);
      }
      ctx.stroke();

      animId = requestAnimationFrame(render);
    };

    render();
    return () => cancelAnimationFrame(animId);
  }, []);

  return (
    <canvas
      ref={canvasRef}
      style={{ width: 32, height: 32 }}
      className="inline-block pointer-events-auto my-1.5"
      aria-hidden="true"
    />
  );
}

export default function FlowView() {
  const root = useRef<HTMLDivElement>(null);
  const layer = useRef<HTMLDivElement>(null);
  const router = useRouter();
  const flowView = useApp((s) => s.flowView);
  const flowFocus = useApp((s) => s.flowFocus);
  const sound = useApp((s) => s.sound);
  const set = useApp((s) => s.set);

  const activeProject = flowFocus !== null ? projects[flowFocus] : null;

  const switchView = (view: "exterior" | "hall" | "showcase", focus: number | null = null) => {
    gsap.to(sceneState.flow, {
      pan: 0,
      tilt: 0,
      ...(view !== "hall" ? { walk: 0 } : {}),
      duration: 0.85,
      ease: "power2.out",
    });
    set({ flowView: view, flowFocus: focus });
  };

  useGSAP(
    () => {
      gsap.fromTo(
        ".flow-cad-in",
        { autoAlpha: 0, y: -8 },
        {
          autoAlpha: 1,
          y: 0,
          duration: 0.7,
          stagger: 0.05,
          ease: "power3.out",
          delay: 0.1,
        },
      );
    },
    { scope: root },
  );

  // Support optional ?view=hall or ?showcase=1..6 query parameters
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

  // Interactive drag-to-look, click-to-pick (portal & showcases), and wheel stroll
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
      className="fixed inset-0 z-20 flex flex-col justify-between pointer-events-none p-6 sm:p-8 md:p-10 pb-8 sm:pb-10 md:pb-12 select-none"
      role="region"
      aria-label="Architectural CAD Blueprint Exhibition"
    >
      {/* Interactive 3D Pointer Layer for Drag-to-Look & Raycast Picking */}
      <div ref={layer} aria-hidden className="pointer-events-auto absolute inset-0 touch-none cursor-grab" />

      {/* TOP HEADER: Architectural Studio Manifesto, Brand Logo, and Menu */}
      <header className="relative z-10 flex items-start justify-between pointer-events-auto">
        {/* Top Left: Software Architect & Studio Title & Manifesto Paragraph */}
        <div className="flow-cad-in flex flex-col items-start gap-1 max-w-[290px] sm:max-w-xs">
          <h1 className="text-[10.5px] sm:text-[11px] font-mono uppercase tracking-[0.22em] text-white/90 font-medium">
            SOFTWARE ARCHITECT & STUDIO
          </h1>
          <WireframeEmblem />
          <p className="text-[9.5px] sm:text-[10.5px] font-mono leading-[1.65] text-white/60 tracking-wider">
            SynapX is an engineering studio founded by Thufail Ahamed based in Colombo.
            We design and build end-to-end software: multi-tenant SaaS, agentic AI copilots,
            cloud platforms, and spatial interactive 3D experiences. From schema to screen.
          </p>
        </div>

        {/* Top Center: Stylized Brand Logo */}
        <div className="flow-cad-in absolute left-1/2 -translate-x-1/2 top-1 text-center pointer-events-auto">
          <Link
            href="/"
            className="group inline-flex items-baseline gap-1.5 sm:gap-2 transition-opacity hover:opacity-80"
          >
            <span className="text-base sm:text-lg md:text-xl font-bold tracking-tight text-white font-sans uppercase">
              Thufail
            </span>
            <span className="text-base sm:text-lg md:text-xl italic font-serif text-white/90 font-normal">
              ahamed
            </span>
            <span className="hidden sm:inline-block text-[9.5px] font-mono text-accent tracking-widest uppercase border border-accent/40 rounded px-1.5 py-0.5 ml-1">
              SynapX
            </span>
          </Link>
        </div>

        {/* Top Right: Clean Spaced MENU Trigger Button & Availability */}
        <div className="flow-cad-in flex items-center gap-3 sm:gap-4 pointer-events-auto">
          {person.available && (
            <span className="hidden md:inline-flex items-center gap-1.5 text-[10px] font-mono uppercase tracking-widest text-white/60">
              <span className="w-1.5 h-1.5 rounded-full bg-accent animate-pulse" />
              Available
            </span>
          )}
          <button
            type="button"
            onClick={() => useApp.getState().set({ menuOpen: true })}
            className="text-[11px] sm:text-xs font-mono uppercase tracking-[0.3em] text-white/80 hover:text-white px-2 py-1 transition-colors"
            aria-label="Open Site Menu"
          >
            MENU
          </button>
        </div>
      </header>

      {/* Center Left Prompt: SKIP THE INTRO */}
      {flowView === "exterior" && (
        <div className="flow-cad-in pointer-events-auto absolute left-6 sm:left-10 top-1/2 -translate-y-1/2 hidden md:block">
          <button
            type="button"
            onClick={() => switchView("hall", null)}
            className="text-[10px] font-mono uppercase tracking-[0.25em] text-white/35 hover:text-white transition-colors"
          >
            SKIP THE INTRO →
          </button>
        </div>
      )}

      {/* BOTTOM SECTION: ENTER Button, Navigation Tabs, Status prompt, and Controls */}
      <footer className="relative z-10 flex flex-col md:flex-row md:items-end md:justify-between gap-6 pointer-events-auto">
        {/* Bottom Left: Solid White Circular Button + Tabs + Socials */}
        <div className="flow-cad-in flex flex-col items-start gap-4">
          {/* Prominent Solid White Circular Button (ENTER when exterior, EXIT when inside) */}
          <button
            type="button"
            onClick={() =>
              switchView(flowView === "exterior" ? "hall" : "exterior", null)
            }
            className="group relative flex h-20 w-20 sm:h-24 sm:w-24 items-center justify-center rounded-full bg-white text-black font-mono text-[11px] sm:text-xs uppercase tracking-[0.22em] font-semibold shadow-[0_0_35px_rgba(255,255,255,0.4)] hover:scale-105 active:scale-95 transition-all duration-300"
          >
            <span className="transition-transform group-hover:scale-110">
              {flowView === "exterior" ? "ENTER" : "EXIT"}
            </span>
          </button>

          {/* Navigation Tabs: LOBBY, GALLERY, OFFICE, ARCHIVE */}
          <div className="flex items-center gap-3 sm:gap-4 text-[11px] sm:text-xs font-mono uppercase tracking-[0.2em]">
            <button
              type="button"
              onClick={() => switchView("exterior", null)}
              className={`pb-0.5 transition-colors ${
                flowView === "exterior"
                  ? "text-white border-b border-white font-medium"
                  : "text-white/50 hover:text-white"
              }`}
            >
              LOBBY
            </button>
            <button
              type="button"
              onClick={() => switchView("hall", null)}
              className={`pb-0.5 transition-colors ${
                flowView === "hall"
                  ? "text-white border-b border-white font-medium"
                  : "text-white/50 hover:text-white"
              }`}
            >
              GALLERY
            </button>
            <button
              type="button"
              onClick={() => switchView("showcase", 0)}
              className={`pb-0.5 transition-colors ${
                flowView === "showcase"
                  ? "text-white border-b border-white font-medium"
                  : "text-white/50 hover:text-white"
              }`}
            >
              SHOWCASE
            </button>
            <Link
              href="/projects"
              className="text-white/50 hover:text-white pb-0.5 transition-colors"
            >
              ARCHIVE
            </Link>
          </div>

          {/* Location and Social Links */}
          <div className="flex items-center gap-3 text-[10px] font-mono uppercase tracking-widest text-white/50">
            <span title="Sri Lanka" className="text-xs">🇱🇰</span>
            <span>COLOMBO</span>
            <span className="text-white/20">/</span>
            {person.socials.map((s) => (
              <a
                key={s.label}
                href={s.href}
                target="_blank"
                rel="noreferrer"
                className="hover:text-white transition-colors"
              >
                {s.label.toUpperCase()}
              </a>
            ))}
            <a
              href={`mailto:${person.email}`}
              className="hover:text-white transition-colors"
            >
              MAIL
            </a>
          </div>
        </div>

        {/* Bottom Center Prompt: Pavilion Entry / Step Outside */}
        {flowView !== "showcase" && (
          <div className="flow-cad-in self-center md:self-end text-center pointer-events-auto pb-1">
            <button
              type="button"
              onClick={() =>
                flowView === "exterior" ? switchView("hall", null) : switchView("exterior", null)
              }
              className="text-[10px] sm:text-[11px] font-mono uppercase tracking-[0.22em] text-white/55 hover:text-white transition-colors"
            >
              {flowView === "exterior"
                ? "THE PAVILION · CLICK TO ENTER EXHIBITION HALL"
                : "THE PAVILION · CLICK TO STEP BACK OUTSIDE"}
            </button>
          </div>
        )}

        {/* Bottom Showcase Inspection Card (Active Project Details in Showcase View) */}
        {activeProject && flowView === "showcase" && (
          <div className="flow-cad-in max-w-lg rounded-xl border border-white/20 bg-black/90 p-5 backdrop-blur-xl shadow-2xl">
            <div className="flex items-center justify-between gap-4">
              <span className="text-[11px] font-mono uppercase tracking-[0.2em] text-white">
                Showcase {pad((flowFocus ?? 0) + 1)} · {activeProject.category}
              </span>
              <div className="flex gap-1.5 font-mono">
                <button
                  type="button"
                  onClick={() => {
                    const prev = (flowFocus! - 1 + projects.length) % projects.length;
                    switchView("showcase", prev);
                  }}
                  className="rounded border border-white/20 px-2 py-0.5 text-xs text-white/80 hover:border-white hover:text-white"
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
                  className="rounded border border-white/20 px-2 py-0.5 text-xs text-white/80 hover:border-white hover:text-white"
                  aria-label="Next showcase"
                >
                  →
                </button>
                <button
                  type="button"
                  onClick={() => switchView("hall", null)}
                  className="rounded border border-white/20 px-2 py-0.5 text-xs text-white/80 hover:border-white hover:text-white"
                  aria-label="Return to hall"
                >
                  ✕
                </button>
              </div>
            </div>

            <h2 className="mt-2 text-xl md:text-2xl text-white font-normal tracking-tight font-sans">
              {activeProject.title}
            </h2>
            <p className="mt-1.5 text-xs text-white/70 line-clamp-2 font-mono">
              {activeProject.tagline}
            </p>

            <div className="mt-3 flex flex-wrap gap-1.5">
              {activeProject.stack.slice(0, 4).map((tech) => (
                <span
                  key={tech}
                  className="rounded border border-white/10 bg-white/5 px-2 py-0.5 text-[9px] font-mono text-white/70"
                >
                  {tech}
                </span>
              ))}
            </div>

            <div className="mt-4 flex items-center gap-4 font-mono text-xs">
              <Link
                href={`/projects/${activeProject.slug}`}
                className="text-white underline underline-offset-4 hover:brightness-125"
              >
                Case Study ↗
              </Link>
              {activeProject.link && (
                <a
                  href={activeProject.link}
                  target="_blank"
                  rel="noreferrer"
                  className="text-white/55 hover:text-white underline underline-offset-4"
                >
                  Live Site ↗
                </a>
              )}
            </div>
          </div>
        )}

        {/* Bottom Right: CONTROLS, SOUND, & Keyboard Navigation */}
        <div className="flow-cad-in flex flex-col items-end gap-1 text-[10px] font-mono uppercase tracking-[0.2em] text-white/45">
          <div className="flex items-center gap-1.5">
            <span className="inline-block w-1 h-1 bg-white/70 rounded-full" />
            <span>CONTROLS</span>
          </div>
          <button
            type="button"
            onClick={() => set({ sound: !sound })}
            className="flex items-center gap-1.5 hover:text-white transition-colors"
          >
            <span
              className={`inline-block w-2 h-2 rounded-full border border-white/50 ${
                sound ? "bg-white" : ""
              }`}
            />
            <span>SOUND</span>
          </button>
          <div className="text-[9px] text-white/35 tracking-widest mt-0.5">
            &lt; SPACE / PAGE &gt;
          </div>
        </div>
      </footer>
    </div>
  );
}
