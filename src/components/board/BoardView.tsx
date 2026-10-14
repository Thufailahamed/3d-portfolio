"use client";

import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { curtain } from "@/components/Curtain";
import { board, projects } from "@/content/site";
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
        { autoAlpha: 1, y: 0, duration: 0.65, stagger: 0.035, ease: "power3.out", delay: 0.12 },
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

  // Esc closes the file; arrows walk the cards (even starting from overview); 1..6 jump directly
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      const f = useApp.getState().boardFocus;
      if (e.key === "Escape") {
        open(null);
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
    if (reduced()) return router.push(href);
    router.prefetch(href);
    const x = e.clientX || innerWidth / 2;
    const y = e.clientY || innerHeight / 2;
    curtain.cover({ x, y, tint, image }).then(() => router.push(href));
  };

  return (
    <div ref={root} className="fixed inset-0 z-20">
      <div ref={layer} aria-hidden className="absolute inset-0 touch-none" />

      {/* top HUD header */}
      <div className="pointer-events-none absolute left-gutter right-gutter top-[68px] md:top-[76px]">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="bd-in flex flex-wrap items-center gap-2.5">
            <Link
              href="/about"
              scroll={false}
              onClick={leave("/about", "#5c9dff", "/earth/night.webp")}
              className="pd-back label pointer-events-auto rounded-full border border-fg/15 bg-bg/65 px-3.5 py-1.5 !text-fg backdrop-blur-md transition-colors hover:border-fg/40"
              data-cursor="view"
            >
              <span aria-hidden className="pd-back-arrow text-accent">
                ←
              </span>{" "}
              Back to the globe
            </Link>
            <span className="label hidden items-center gap-2 rounded-full border border-fg/10 bg-bg/45 px-3 py-1.5 !text-[10px] !text-fg/65 backdrop-blur-md sm:inline-flex">
              <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-accent shadow-[0_0_8px_#c8ff3d]" />
              Origin · 06.93°N 79.85°E · Colombo
            </span>
          </div>

          {project && (
            <button
              type="button"
              onClick={() => open(null)}
              className="bd-in label pointer-events-auto inline-flex items-center gap-2 rounded-full border border-fg/20 bg-bg/75 px-3.5 py-1.5 !text-fg backdrop-blur-md transition-colors hover:border-accent hover:!text-accent"
            >
              <span aria-hidden>↖</span> Step back to full board
            </button>
          )}
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

          <div className="pointer-events-auto hidden shrink-0 items-center justify-end gap-4 md:flex">
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
        className={`bd-file ${project ? "is-open" : ""}`}
        style={{ "--tint": project?.tint ?? "#ece9e2" } as React.CSSProperties}
      >
        {project && focus !== null && (
          <div className="flex h-full flex-col">
            {/* Dossier header bar */}
            <div className="bd-file-in flex items-center justify-between gap-2">
              <div className="flex items-center gap-2.5">
                <span
                  aria-hidden
                  className="h-2 w-2 rounded-full"
                  style={{ backgroundColor: project.tint, boxShadow: `0 0 10px ${project.tint}` }}
                />
                <p className="label tabular-nums !text-fg/85">
                  Case File <span className="font-bold text-[color:var(--tint)]">#{pad(focus + 1)}</span>
                  <span className="text-fg/35"> / {pad(projects.length)}</span>
                </p>
              </div>
              <div className="flex gap-1.5">
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

            {/* Visual screenshot preview card inside the dossier */}
            <div className="bd-file-in relative mt-4 overflow-hidden rounded-xl border border-fg/15 bg-black/60 shadow-lg">
              <div className="flex items-center justify-between border-b border-fg/10 bg-white/[0.03] px-3 py-1.5">
                <div className="flex items-center gap-1.5">
                  <span className="h-2 w-2 rounded-full bg-fg/20" />
                  <span className="h-2 w-2 rounded-full bg-fg/20" />
                  <span className="h-2 w-2 rounded-full bg-fg/20" />
                </div>
                <span className="font-mono text-[10px] tracking-wider text-fg/50">
                  {project.link ? project.link.replace(/^https?:\/\//, "").replace(/\/$/, "") : `${project.slug}.synapx.lk`}
                </span>
                <span className="font-mono text-[10px] font-semibold uppercase tracking-widest text-[color:var(--tint)]">
                  ● Live
                </span>
              </div>
              <div className="relative aspect-[16/9] w-full overflow-hidden">
                <Image
                  src={project.cover}
                  alt={project.title}
                  fill
                  sizes="(min-width: 768px) 420px, 92vw"
                  className="object-cover object-top"
                />
                <div
                  className="pointer-events-none absolute inset-0"
                  style={{
                    background: "linear-gradient(to top, rgba(11,11,12,0.75) 0%, transparent 50%)",
                  }}
                />
                <span className="pd-tag absolute bottom-2.5 left-3 rounded-md bg-bg/80 px-2 py-0.5 !text-[10px] backdrop-blur-md">
                  [ {project.category} ]
                </span>
              </div>
            </div>

            <h2 className="bd-file-in display mt-4 text-[8.5vw] md:text-[clamp(28px,2.3vw,40px)]">{project.title}</h2>
            <p className="bd-file-in mt-2.5 text-sm leading-relaxed text-fg/75 md:text-[15px]">{project.tagline}</p>

            {project.metrics && (
              <dl className="bd-file-in mt-4 grid grid-cols-3 gap-2">
                {project.metrics.map((m) => (
                  <div key={m.label} className="bd-metric">
                    <dt className="sr-only">{m.label}</dt>
                    <dd className="display text-xl text-[color:var(--tint)] md:text-2xl">{m.value}</dd>
                    <dd className="mt-1 text-[11px] leading-snug text-fg/60">{m.label}</dd>
                  </div>
                ))}
              </dl>
            )}

            {project.facts && (
              <dl className="bd-file-in mt-4 grid grid-cols-2 gap-x-4 gap-y-2.5 border-t border-fg/10 pt-3.5">
                {project.facts.map((f) => (
                  <div key={f.label}>
                    <dt className="label !text-[10px]">{f.label}</dt>
                    <dd className="mt-0.5 text-[13px] font-medium text-fg/90">{f.value}</dd>
                  </div>
                ))}
              </dl>
            )}

            {project.verdict && (
              <div className="bd-file-in mt-4 rounded-xl border border-fg/10 bg-fg/[0.03] px-3.5 py-2.5">
                <p className="font-mono text-[10px] uppercase tracking-widest text-[color:var(--tint)]">
                  Verdict — {project.verdict.title}
                </p>
                <p className="mt-1 text-xs leading-relaxed text-fg/70">{project.verdict.statement}</p>
              </div>
            )}

            <ul className="bd-file-in mt-4 flex flex-wrap gap-1.5" aria-label="Stack">
              {project.stack.map((s) => (
                <li key={s} className="pd-chip !px-3 !py-1 !text-[10px]">
                  {s}
                </li>
              ))}
            </ul>

            <div className="bd-file-in mt-auto flex flex-wrap gap-2 pt-5">
              <Link
                href={`/projects/${project.slug}`}
                onClick={leave(`/projects/${project.slug}`, project.tint, project.cover)}
                className="contact-btn contact-btn--solid flex-1 justify-center"
                data-cursor="view"
              >
                Open case study <span aria-hidden>↘</span>
              </Link>
              {project.link && (
                <a
                  href={project.link}
                  target="_blank"
                  rel="noreferrer"
                  className="contact-btn justify-center"
                  data-cursor="view"
                >
                  {project.liveLabel ?? "Live site"} <span aria-hidden>↗</span>
                </a>
              )}
            </div>
          </div>
        )}
      </aside>
    </div>
  );
}
