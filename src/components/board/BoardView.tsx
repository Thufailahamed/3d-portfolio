"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef } from "react";
import { curtain } from "@/components/Curtain";
import { board, projects } from "@/content/site";
import { gsap, useGSAP } from "@/lib/gsap";
import { sceneState } from "@/lib/sceneState";
import { useApp } from "@/store/useApp";

const pad = (n: number) => String(n).padStart(2, "0");
const reduced = () => matchMedia("(prefers-reduced-motion: reduce)").matches;

/**
 * DOM over the investigation board: the way back to the globe, an index of the cards,
 * and the file of whichever card is open. Clicks on the board itself are picked in the
 * scene (sceneState.board.pick).
 */
export default function BoardView() {
  const root = useRef<HTMLDivElement>(null);
  const layer = useRef<HTMLDivElement>(null);
  const panel = useRef<HTMLElement>(null);
  const router = useRouter();
  const focus = useApp((s) => s.boardFocus);
  const open = (i: number | null) => useApp.getState().set({ boardFocus: i });
  const project = focus === null ? null : projects[focus];

  // arriving through the globe: the curtain lifts over the board
  useGSAP(
    () => {
      const through = curtain.reveal();
      if (reduced()) return;
      gsap.from(".bd-in", { autoAlpha: 0, y: 16, duration: 0.9, stagger: 0.06, ease: "power3.out", delay: through ? 1.1 : 0.4 });
    },
    { scope: root },
  );

  // the file slides in, and its contents rise after it
  useGSAP(
    () => {
      if (!project || reduced()) return;
      gsap.fromTo(".bd-file-in", { autoAlpha: 0, y: 14 }, { autoAlpha: 1, y: 0, duration: 0.7, stagger: 0.04, ease: "power3.out", delay: 0.15 });
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

    // the cursor says "Open" over a card
    let over = -2;
    const watch = () => {
      const h = sceneState.board.hover;
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

  // Esc closes the file; arrows walk the cards
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const f = useApp.getState().boardFocus;
      if (e.key === "Escape") open(null);
      if (f === null) return;
      if (e.key === "ArrowRight") open((f + 1) % projects.length);
      if (e.key === "ArrowLeft") open((f - 1 + projects.length) % projects.length);
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

      {/* heading */}
      <div className="pointer-events-none absolute left-gutter right-gutter top-20 md:top-[88px]">
        <Link
          href="/about"
          scroll={false}
          onClick={leave("/about", "#5c9dff", "/earth/night.webp")}
          className="bd-in pd-back label pointer-events-auto !text-fg"
          data-cursor="view"
        >
          <span aria-hidden className="pd-back-arrow">←</span> Back to the globe
        </Link>
        <div
          className={`mt-4 flex flex-col gap-3 transition-opacity duration-500 md:mt-6 md:flex-row md:items-end md:justify-between md:gap-10 ${
            project ? "opacity-0" : ""
          }`}
        >
          <h1 className="bd-in display text-[8.5vw] md:text-[clamp(26px,min(2.7vw,5vh),46px)]">{board.heading}</h1>
          <div className="bd-in hidden shrink-0 pb-1 text-right md:block">
            <p className="label flex items-center justify-end gap-2.5">
              <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-[#ff3b2f] shadow-[0_0_8px_#ff3b2f]" />
              {board.label}
            </p>
            <p className="mt-1.5 max-w-[34ch] text-sm leading-relaxed text-fg/55">{board.note}</p>
          </div>
        </div>
      </div>

      {/* the index of cards */}
      <nav
        aria-label="Projects on the board"
        className={`absolute inset-x-0 bottom-0 px-gutter pb-5 transition-opacity duration-500 md:pb-7 ${
          project ? "pointer-events-none opacity-0 md:pointer-events-auto md:opacity-100" : ""
        }`}
      >
        <p className="bd-in label mb-3 md:hidden">← Swipe along the board · tap a card →</p>
        <ol className="bd-in no-scrollbar -mx-gutter flex gap-1.5 overflow-x-auto px-gutter pb-1 md:mx-0 md:flex-wrap md:gap-2 md:px-0">
          {projects.map((p, i) => (
            <li key={p.slug} className="shrink-0">
              <button
                type="button"
                onClick={() => open(focus === i ? null : i)}
                onPointerEnter={() => (sceneState.board.hint = i)}
                onPointerLeave={() => (sceneState.board.hint = -1)}
                onFocus={() => (sceneState.board.hint = i)}
                onBlur={() => (sceneState.board.hint = -1)}
                aria-pressed={focus === i}
                className={`bd-chip ${focus === i ? "is-on" : ""}`}
                style={{ "--tint": p.tint } as React.CSSProperties}
              >
                <span className="tabular-nums text-fg/45">{pad(i + 1)}</span> {p.title}
              </button>
            </li>
          ))}
        </ol>
        <div className="mt-4 hidden items-center justify-between md:flex">
          <p className="label">Click a card · ← → to walk · Esc to step back</p>
          <a href={board.credit.href} target="_blank" rel="noreferrer" className="label hover:!text-fg">
            {board.credit.label} ↗
          </a>
        </div>
      </nav>

      {/* the open file */}
      <aside
        ref={panel}
        aria-live="polite"
        aria-label={project ? `${project.title} — file` : undefined}
        className={`bd-file ${project ? "is-open" : ""}`}
        style={{ "--tint": project?.tint ?? "#ece9e2" } as React.CSSProperties}
      >
        {project && focus !== null && (
          <div className="flex h-full flex-col">
            <div className="bd-file-in flex items-center justify-between">
              <p className="label tabular-nums">
                File <span className="text-[color:var(--tint)]">#{pad(focus + 1)}</span>
                <span className="text-fg/30"> / {pad(projects.length)}</span>
              </p>
              <div className="flex gap-1.5">
                <button type="button" className="bd-icon" aria-label="Previous file" onClick={() => open((focus - 1 + projects.length) % projects.length)}>
                  ←
                </button>
                <button type="button" className="bd-icon" aria-label="Next file" onClick={() => open((focus + 1) % projects.length)}>
                  →
                </button>
                <button type="button" className="bd-icon" aria-label="Close file" onClick={() => open(null)}>
                  ✕
                </button>
              </div>
            </div>

            <p className="bd-file-in pd-tag mt-5 md:mt-6">[ {project.category} ]</p>
            <h2 className="bd-file-in display mt-3 text-[9vw] md:text-[clamp(32px,2.6vw,46px)]">{project.title}</h2>
            <p className="bd-file-in mt-3 text-[15px] leading-relaxed text-fg/75 md:text-base">{project.tagline}</p>

            {project.metrics && (
              <dl className="bd-file-in mt-5 grid grid-cols-3 gap-2">
                {project.metrics.map((m) => (
                  <div key={m.label} className="bd-metric">
                    <dt className="sr-only">{m.label}</dt>
                    <dd className="display text-2xl text-[color:var(--tint)] md:text-[28px]">{m.value}</dd>
                    <dd className="mt-1 text-[11px] leading-snug text-fg/55">{m.label}</dd>
                  </div>
                ))}
              </dl>
            )}

            {project.facts && (
              <dl className="bd-file-in mt-5 grid grid-cols-2 gap-x-4 gap-y-3 border-t border-fg/10 pt-4">
                {project.facts.map((f) => (
                  <div key={f.label}>
                    <dt className="label !text-[10px]">{f.label}</dt>
                    <dd className="mt-1 text-[13px] text-fg/90">{f.value}</dd>
                  </div>
                ))}
              </dl>
            )}

            <ul className="bd-file-in mt-5 flex flex-wrap gap-1.5" aria-label="Stack">
              {project.stack.map((s) => (
                <li key={s} className="pd-chip">
                  {s}
                </li>
              ))}
            </ul>

            <div className="bd-file-in mt-auto flex flex-wrap gap-2 pt-6">
              <Link
                href={`/projects/${project.slug}`}
                onClick={leave(`/projects/${project.slug}`, project.tint, project.cover)}
                className="contact-btn contact-btn--solid"
                data-cursor="view"
              >
                Open the case study <span aria-hidden>↘</span>
              </Link>
              {project.link && (
                <a href={project.link} target="_blank" rel="noreferrer" className="contact-btn" data-cursor="view">
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
