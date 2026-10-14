"use client";

import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { curtain } from "@/components/Curtain";
import { board, projects } from "@/content/site";
import { landing } from "@/lib/chapters";
import { gsap, useGSAP } from "@/lib/gsap";
import { sceneState } from "@/lib/sceneState";
import { useApp } from "@/store/useApp";

const pad = (n: number) => String(n).padStart(2, "0");
const reduced = () => matchMedia("(prefers-reduced-motion: reduce)").matches;

/**
 * DOM over the investigation board: the way back to the globe, a live telemetry header,
 * an index dock of the six project files, and the dossier panel of whichever card is open.
 * Clicks on the board itself are picked in the scene (sceneState.board.pick).
 */
export default function BoardView() {
  const root = useRef<HTMLDivElement>(null);
  const layer = useRef<HTMLDivElement>(null);
  const panel = useRef<HTMLElement>(null);
  const router = useRouter();
  const focus = useApp((s) => s.boardFocus);
  const [hovered, setHovered] = useState<number>(-1);
  const open = (i: number | null) => useApp.getState().set({ boardFocus: i });
  const project = focus === null ? null : projects[focus];
  const peek = focus === null && hovered >= 0 ? projects[hovered] : null;

  // arriving through the globe: the curtain lifts over the board
  useGSAP(
    () => {
      // (or through the globe opening: the camera is still on the map, pulling back)
      const unfolded = sceneState.board.arrive < 1;
      const through = curtain.reveal();
      if (reduced()) return;
      gsap.from(".bd-in", {
        autoAlpha: 0,
        y: 14,
        duration: 0.85,
        stagger: 0.055,
        ease: "power3.out",
        delay: unfolded ? 2.2 : through ? 1.05 : 0.35,
      });
    },
    { scope: root },
  );

  // the file slides in, and its contents rise after it
  useGSAP(
    () => {
      if (!project || reduced()) return;
      gsap.fromTo(
        ".bd-file-in",
        { autoAlpha: 0, y: 12 },
        { autoAlpha: 1, y: 0, duration: 0.6, stagger: 0.035, ease: "power3.out", delay: 0.1 },
      );
    },
    { scope: panel, dependencies: [focus] },
  );

  // clicking the board: a card opens its file, anywhere else closes it
  useEffect(() => {
    const el = layer.current;
    if (!el) return;
    let down: { x: number; y: number } | null = null;
    let lastX = 0;
    const onDown = (e: PointerEvent) => {
      down = { x: e.clientX, y: e.clientY };
      lastX = e.clientX;
      try {
        el.setPointerCapture(e.pointerId);
      } catch {
        // the pointer is already gone (e.g. a synthetic event); nothing to capture
      }
      gsap.killTweensOf(sceneState.board, "pan");
    };
    // phones: swipe along the board (the scene clamps it to the board's edges)
    const onMove = (e: PointerEvent) => {
      if (!down || useApp.getState().boardFocus !== null || !useApp.getState().isMobile) return;
      const b = sceneState.board;
      b.pan = gsap.utils.clamp(-1, 1, b.pan - ((e.clientX - lastX) / innerWidth) * 1.6);
      lastX = e.clientX;
    };
    const onUp = (e: PointerEvent) => {
      const start = down;
      down = null;
      if (!start || Math.hypot(e.clientX - start.x, e.clientY - start.y) > 8) return;
      const i = sceneState.board.pick((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1);
      open(i >= 0 ? i : null);
    };
    el.addEventListener("pointerdown", onDown);
    el.addEventListener("pointermove", onMove);
    el.addEventListener("pointerup", onUp);

    // the cursor says "Open" over a card and updates the HUD peek state
    let over = -2;
    let lastHint = -2;
    const watch = () => {
      const h = sceneState.board.hover;
      const hint = sceneState.board.hint;
      const activeHover = h >= 0 ? h : hint;
      if (activeHover !== lastHint) {
        lastHint = activeHover;
        setHovered(activeHover);
      }
      if (h === over) return;
      over = h;
      el.dataset.cursor = h >= 0 ? "open" : "";
      el.style.cursor = h >= 0 ? "pointer" : "";
      el.dispatchEvent(new PointerEvent("pointerover", { bubbles: true }));
    };
    gsap.ticker.add(watch);
    return () => {
      el.removeEventListener("pointerdown", onDown);
      el.removeEventListener("pointermove", onMove);
      el.removeEventListener("pointerup", onUp);
      gsap.ticker.remove(watch);
    };
  }, []);

  /**
   * Back to the globe: the arrival in reverse. The camera pushes back in onto the map as the
   * room dims and the threads rewind (Board keys all of that to `arrive`); then, under the
   * identical flat map, the canvas cuts to the globe's scene before the route has even
   * changed, and the About page rolls the map back up into the globe.
   */
  function backToGlobe() {
    const b = sceneState.board;
    if (b.leaving) return;
    if (reduced()) return router.push("/about", { scroll: false });
    router.prefetch("/about");
    b.leaving = true;
    useApp.getState().set({ boardFocus: null });
    gsap.to("[data-board-overlay]", { autoAlpha: 0, duration: 0.5, ease: "power2.out" });
    gsap.to(b, {
      arrive: 0,
      duration: 1.7,
      ease: "power2.inOut",
      // the camera eases a beat behind its target: let it arrive on the map before the cut
      onComplete: () =>
        void gsap.delayedCall(0.35, () => {
          sceneState.unfold.t = 1;
          document.documentElement.dataset.unfold = "";
          sceneState.p = landing("about");
          sceneState.aboutSec = 16.0;
          useApp.getState().set({ mode: "journey", chapter: "about" });
          router.push("/about", { scroll: false });
        }),
    });
  }

  // Esc closes the file; arrows walk the cards (even starting from overview); 1..6 jump directly
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      const f = useApp.getState().boardFocus;
      if (e.key === "Escape") {
        if (f !== null) {
          open(null);
        } else {
          backToGlobe();
        }
        return;
      }
      if (e.key === "ArrowRight") {
        e.preventDefault();
        open(f === null ? 0 : (f + 1) % projects.length);
        return;
      }
      if (e.key === "ArrowLeft") {
        e.preventDefault();
        open(f === null ? projects.length - 1 : (f - 1 + projects.length) % projects.length);
        return;
      }
      if (!e.metaKey && !e.ctrlKey && !e.altKey && e.key >= "1" && e.key <= "6") {
        const idx = Number(e.key) - 1;
        if (idx < projects.length) open(f === idx ? null : idx);
      }
    };
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  }, []);

  // leaving: the curtain closes from the centre of the screen
  const leave = (href: string, tint: string, image: string) => (e: React.MouseEvent) => {
    if (e.metaKey || e.ctrlKey) return;
    e.preventDefault();
    if (reduced()) return router.push(href, { scroll: href !== "/about" });
    router.prefetch(href);
    // back to the globe: transition immediately to the globe with the rolling animation only
    if (href === "/about") return backToGlobe();
    const x = e.clientX || innerWidth / 2;
    const y = e.clientY || innerHeight / 2;
    curtain.cover({ x, y, tint, image }).then(() => router.push(href));
  };

  const hostLabel = project
    ? project.link
      ? project.link.replace(/^https?:\/\//, "").replace(/\/$/, "")
      : `${project.slug}.synapx.lk`
    : "";

  return (
    <div ref={root} data-board-overlay className="fixed inset-0 z-20">
      <div ref={layer} aria-hidden className="absolute inset-0 touch-none" />

      {/* top HUD header */}
      <div className="pointer-events-none absolute left-gutter right-gutter top-[68px] md:top-[76px]">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="bd-in flex flex-wrap items-center gap-2">
            <Link
              href="/about"
              scroll={false}
              onClick={leave("/about", "#5c9dff", "/earth/night.webp")}
              className="pd-back label pointer-events-auto rounded-full border border-fg/15 bg-bg/70 px-3.5 py-1.5 !text-fg backdrop-blur-md transition-colors hover:border-fg/40"
              data-cursor="view"
            >
              <span aria-hidden className="pd-back-arrow text-accent">
                ←
              </span>{" "}
              Back to the globe
            </Link>

            {project ? (
              <button
                type="button"
                onClick={() => open(null)}
                className="label pointer-events-auto inline-flex items-center gap-2 rounded-full border border-fg/20 bg-bg/75 px-3.5 py-1.5 !text-fg backdrop-blur-md transition-colors hover:border-accent hover:!text-accent"
              >
                <span aria-hidden>↖</span> Full board{" "}
                <span className="rounded border border-fg/20 px-1.5 py-0.2 text-[9px] text-fg/55">ESC</span>
              </button>
            ) : (
              <span className="label hidden items-center gap-2 rounded-full border border-fg/10 bg-bg/45 px-3 py-1.5 !text-[10px] !text-fg/65 backdrop-blur-md sm:inline-flex">
                <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-accent shadow-[0_0_8px_#c8ff3d]" />
                Origin · 06.93°N 79.85°E · Colombo
              </span>
            )}
          </div>
        </div>

        <div
          className={`mt-3 flex flex-col gap-3 transition-all duration-500 md:mt-3.5 md:flex-row md:items-end md:justify-between md:gap-8 ${
            project ? "pointer-events-none -translate-y-2 opacity-0" : ""
          }`}
        >
          <div>
            <h1 className="bd-in display text-[7.5vw] md:text-[clamp(24px,min(2.35vw,4.3vh),42px)]">
              {board.heading}
            </h1>
          </div>

          {/* Right HUD status / live hover card */}
          <div className="bd-in hidden shrink-0 md:block">
            <div className="rounded-2xl border border-fg/12 bg-bg/60 px-4 py-2.5 text-right backdrop-blur-md">
              <p className="label flex items-center justify-end gap-2 !text-[10px] !text-fg/85">
                <span
                  aria-hidden
                  className="h-1.5 w-1.5 rounded-full transition-colors duration-300"
                  style={{
                    backgroundColor: peek ? peek.tint : "#ff3b2f",
                    boxShadow: `0 0 10px ${peek ? peek.tint : "#ff3b2f"}`,
                  }}
                />
                {peek ? `EVIDENCE #${pad(hovered + 1)} // ${peek.title.toUpperCase()}` : `${board.label} // 06 FILES`}
              </p>
              <p className="mt-1 max-w-[38ch] text-balance text-xs leading-relaxed text-fg/65">
                {peek ? `${peek.category} — click polaroid to inspect file.` : board.note}
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* bottom evidence index dock */}
      <nav
        aria-label="Projects on the board"
        className={`pointer-events-none absolute inset-x-0 bottom-0 px-gutter pb-4 transition-opacity duration-500 md:pb-5 ${
          project ? "opacity-0 md:opacity-100" : ""
        }`}
      >
        <p className="bd-in label mb-2.5 md:hidden">← Swipe along the board · tap a card →</p>

        <div className="bd-in flex flex-col gap-2.5 xl:flex-row xl:items-center xl:justify-between">
          <ol className="no-scrollbar pointer-events-auto -mx-gutter flex flex-nowrap gap-1.5 overflow-x-auto px-gutter pb-1 md:mx-0 md:gap-2 md:px-0 md:pb-0 md:pl-10">
            {projects.map((p, i) => {
              const active = focus === i;
              const isHover = hovered === i && focus === null;
              return (
                <li key={p.slug} className="shrink-0">
                  <button
                    type="button"
                    onClick={() => open(active ? null : i)}
                    onPointerEnter={() => (sceneState.board.hint = i)}
                    onPointerLeave={() => (sceneState.board.hint = -1)}
                    onFocus={() => (sceneState.board.hint = i)}
                    onBlur={() => (sceneState.board.hint = -1)}
                    aria-pressed={active}
                    className={`bd-chip ${active ? "is-on" : ""} ${isHover ? "is-peek" : ""}`}
                    style={{ "--tint": p.tint } as React.CSSProperties}
                  >
                    <span
                      aria-hidden
                      className="bd-chip-dot"
                      style={{ backgroundColor: active ? "currentColor" : p.tint }}
                    />
                    <span className="bd-chip-num tabular-nums">{pad(i + 1)}</span>
                    <span className="font-semibold">{p.title}</span>
                  </button>
                </li>
              );
            })}
          </ol>

          <div
            className={`pointer-events-auto hidden shrink-0 items-center justify-end gap-4 transition-opacity duration-300 md:flex ${
              project ? "pointer-events-none opacity-0" : "opacity-100"
            }`}
          >
            <p className="label !text-[10px]">
              <span className="text-fg/80">[Click]</span> Open · <span className="text-fg/80">[1–6 / ← →]</span> Walk ·{" "}
              <span className="text-fg/80">[Esc]</span> Back
            </p>
            <span aria-hidden className="h-3 w-px bg-fg/15" />
            <a href={board.credit.href} target="_blank" rel="noreferrer" className="label !text-[10px] hover:!text-fg">
              {board.credit.label} ↗
            </a>
          </div>
        </div>
      </nav>

      {/* the open case file dossier */}
      <aside
        ref={panel}
        aria-live="polite"
        aria-label={project ? `${project.title} — file` : undefined}
        className={`bd-file no-scrollbar ${project ? "is-open" : ""}`}
        style={{ "--tint": project?.tint ?? "#ece9e2" } as React.CSSProperties}
      >
        {project && focus !== null && (
          <div className="flex min-h-full flex-col">
            {/* Top dossier navigation bar */}
            <div className="bd-file-in flex shrink-0 items-center justify-between gap-2 border-b border-fg/10 pb-3.5">
              <div className="flex items-center gap-2.5">
                <span
                  aria-hidden
                  className="h-2 w-2 rounded-full"
                  style={{ backgroundColor: project.tint, boxShadow: `0 0 12px ${project.tint}` }}
                />
                <p className="label tabular-nums !text-[10px] !text-fg/90">
                  CASE FILE <span className="font-bold text-[color:var(--tint)]">#{pad(focus + 1)}</span>
                  <span className="text-fg/35"> / {pad(projects.length)}</span>
                </p>
                <span className="hidden rounded-full border border-fg/12 bg-fg/[0.04] px-2 py-0.5 font-mono text-[9px] uppercase tracking-widest text-fg/55 sm:inline-block">
                  CMB · {project.year}
                </span>
              </div>

              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  className="bd-icon"
                  aria-label="Previous file"
                  onClick={() => open((focus - 1 + projects.length) % projects.length)}
                >
                  ←
                </button>
                <button
                  type="button"
                  className="bd-icon"
                  aria-label="Next file"
                  onClick={() => open((focus + 1) % projects.length)}
                >
                  →
                </button>
                <button type="button" className="bd-icon" aria-label="Close file" onClick={() => open(null)}>
                  ✕
                </button>
              </div>
            </div>

            {/* Crisp 16:10 screenshot preview window (shrink-0 prevents flex collapse) */}
            <div className="bd-file-in bd-preview mt-4 shrink-0">
              <div className="flex items-center justify-between border-b border-white/10 bg-white/[0.03] px-3.5 py-2">
                <div className="flex items-center gap-1.5">
                  <span className="h-2 w-2 rounded-full bg-[#ff5f56]/75" />
                  <span className="h-2 w-2 rounded-full bg-[#ffbd2e]/75" />
                  <span className="h-2 w-2 rounded-full bg-[#27c93f]/75" />
                </div>
                <span className="font-mono text-[10px] tracking-wider text-fg/60">{hostLabel}</span>
                <span className="inline-flex items-center gap-1.5 font-mono text-[9px] font-semibold uppercase tracking-widest text-[color:var(--tint)]">
                  <span
                    className="h-1.5 w-1.5 rounded-full"
                    style={{ backgroundColor: project.tint, boxShadow: `0 0 8px ${project.tint}` }}
                  />
                  Live
                </span>
              </div>

              <div className="relative aspect-[16/10] w-full overflow-hidden bg-black">
                <Image
                  src={project.cover}
                  alt={project.title}
                  fill
                  sizes="(min-width: 768px) 440px, 92vw"
                  className="object-cover object-top transition-transform duration-700 hover:scale-[1.03]"
                />
                <div
                  className="pointer-events-none absolute inset-0"
                  style={{
                    background:
                      "linear-gradient(to top, rgba(10,11,14,0.88) 0%, rgba(10,11,14,0.18) 42%, transparent 100%)",
                  }}
                />
                <div className="pointer-events-none absolute inset-x-3 bottom-2.5 flex items-end justify-between gap-2">
                  <span className="rounded-md border border-white/12 bg-black/75 px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.18em] text-[color:var(--tint)] backdrop-blur-md">
                    {project.category}
                  </span>
                  <span className="rounded-md border border-white/10 bg-black/70 px-2 py-0.5 font-mono text-[10px] text-fg/75 backdrop-blur-md">
                    {project.role}
                  </span>
                </div>
              </div>
            </div>

            {/* Title & Tagline */}
            <div className="bd-file-in mt-4 shrink-0">
              <h2 className="display text-[8vw] md:text-[clamp(28px,2.2vw,38px)]">{project.title}</h2>
              <p className="mt-2 text-[14px] leading-relaxed text-fg/75">{project.tagline}</p>
            </div>

            {/* 3-Column Headline Telemetry Metrics */}
            {project.metrics && (
              <dl className="bd-file-in mt-4 grid shrink-0 grid-cols-3 gap-2">
                {project.metrics.map((m) => (
                  <div key={m.label} className="bd-metric">
                    <div className="bd-metric-bar" />
                    <dt className="sr-only">{m.label}</dt>
                    <dd className="display mt-1.5 text-xl text-[color:var(--tint)] md:text-[23px]">{m.value}</dd>
                    <dd className="mt-1 text-[10.5px] leading-snug text-fg/65">{m.label}</dd>
                  </div>
                ))}
              </dl>
            )}

            {/* 2x2 Key Facts */}
            {project.facts && (
              <dl className="bd-file-in mt-4 grid shrink-0 grid-cols-2 gap-x-4 gap-y-2.5 rounded-xl border border-fg/10 bg-white/[0.02] p-3.5">
                {project.facts.map((f) => (
                  <div key={f.label}>
                    <dt className="label !text-[9.5px] !text-fg/45">{f.label}</dt>
                    <dd className="mt-0.5 text-[12.5px] font-medium text-fg/92">{f.value}</dd>
                  </div>
                ))}
              </dl>
            )}

            {/* Verdict Statement */}
            {project.verdict && (
              <div className="bd-file-in bd-verdict mt-3.5 shrink-0">
                <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.16em] text-[color:var(--tint)]">
                  Verdict — {project.verdict.title}
                </p>
                <p className="mt-1 text-[12px] leading-relaxed text-fg/72">{project.verdict.statement}</p>
              </div>
            )}

            {/* Stack Chips */}
            <ul className="bd-file-in mt-3.5 flex shrink-0 flex-wrap gap-1.5" aria-label="Stack">
              {project.stack.map((s) => (
                <li
                  key={s}
                  className="rounded-full border border-fg/12 bg-white/[0.03] px-2.5 py-1 font-mono text-[10px] uppercase tracking-wider text-fg/80"
                >
                  {s}
                </li>
              ))}
            </ul>

            {/* Side-by-Side Primary & Secondary CTAs */}
            <div
              className={`bd-file-in mt-auto grid shrink-0 gap-2 pt-4 ${
                project.link ? "grid-cols-2" : "grid-cols-1"
              }`}
            >
              <Link
                href={`/projects/${project.slug}`}
                onClick={leave(`/projects/${project.slug}`, project.tint, project.cover)}
                className="bd-cta bd-cta--primary"
                data-cursor="view"
              >
                <span>Case study</span>
                <span aria-hidden>↘</span>
              </Link>
              {project.link && (
                <a
                  href={project.link}
                  target="_blank"
                  rel="noreferrer"
                  className="bd-cta bd-cta--secondary"
                  data-cursor="view"
                >
                  <span className="truncate">{project.liveLabel ?? "Live site"}</span>
                  <span aria-hidden>↗</span>
                </a>
              )}
            </div>
          </div>
        )}
      </aside>
    </div>
  );
}
