"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef } from "react";
import { about } from "@/content/site";
import { gsap } from "@/lib/gsap";
import { sceneState } from "@/lib/sceneState";

const ARROW = 56; // px from the city to its label
/** Labels fade out rather than land on the About copy (left column, desktop). */
const copyEdge = () => Math.min(innerWidth * 0.44, 640) + 56;

/**
 * DOM side of the About globe:
 *  - an invisible circle that tracks the globe on screen, so it can be grabbed and spun
 *    (the scene reads the drag from sceneState.globeDrag); a click opens the board
 *  - arrows pointing at the marked cities, each labelled with its live local time
 * Positions come from the scene every frame (sceneState.globe / .markers).
 */
export default function GlobeLayer() {
  const hit = useRef<HTMLDivElement>(null);
  const labels = useRef<HTMLDivElement>(null);
  const svg = useRef<SVGSVGElement>(null);
  const hint = useRef<HTMLParagraphElement>(null);
  const router = useRouter();

  // drag → accumulated deltas; the scene consumes and resets them each frame
  useEffect(() => {
    const el = hit.current;
    if (!el) return;
    const drag = sceneState.globeDrag;
    let last: { x: number; y: number } | null = null;
    let travel = 0;
    let leaving = false;
    const down = (e: PointerEvent) => {
      if (!sceneState.globe.grabbable) return;
      el.setPointerCapture(e.pointerId);
      last = { x: e.clientX, y: e.clientY };
      travel = 0;
      drag.dragging = true;
      router.prefetch("/board");
    };
    const move = (e: PointerEvent) => {
      if (!last) return;
      drag.dx += e.clientX - last.x;
      drag.dy += e.clientY - last.y;
      travel += Math.hypot(e.clientX - last.x, e.clientY - last.y);
      last = { x: e.clientX, y: e.clientY };
    };
    const up = (e?: PointerEvent) => {
      const clicked = !!last && e?.type === "pointerup" && travel < 6;
      last = null;
      drag.dragging = false;
      if (!clicked || leaving) return;
      // a click (not a spin) opens the board: the globe turns, opens like a mat and lies flat
      // as the board's map; the board's camera picks up on that map and pulls back
      leaving = true;
      if (matchMedia("(prefers-reduced-motion: reduce)").matches) return router.push("/board");
      router.prefetch("/board");
      document.documentElement.dataset.unfold = "";
      gsap.to(sceneState.unfold, {
        t: 1,
        duration: 2.6,
        ease: "power1.inOut",
        onComplete: () => {
          sceneState.board.fromGlobe = true;
          sceneState.board.arrive = 0;
          router.push("/board");
        },
      });
    };
    el.addEventListener("pointerdown", down);
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", up);
    el.addEventListener("pointercancel", up);
    return () => {
      el.removeEventListener("pointerdown", down);
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerup", up);
      el.removeEventListener("pointercancel", up);
      up();
    };
  }, [router]);

  // follow the globe and the markers every frame
  useEffect(() => {
    const cards = Array.from(labels.current?.children ?? []) as HTMLElement[];
    const lines = Array.from(svg.current?.querySelectorAll("line") ?? []);
    let wasActive = true;
    const tick = () => {
      const g = sceneState.globe;
      // outside the globe's moment: tidy up once, then do nothing
      const active = g.grabbable || sceneState.markers.some((m) => m.facing > 0.01);
      if (!active && !wasActive) return;
      wasActive = active;
      const el = hit.current;
      if (el) {
        el.style.display = g.grabbable ? "block" : "none";
        el.style.transform = `translate(${g.x - g.r}px, ${g.y - g.r}px)`;
        el.style.width = el.style.height = `${g.r * 2}px`;
      }
      if (hint.current) {
        hint.current.style.opacity = g.grabbable ? "1" : "0";
        // under the globe; on phones the headline sits there, so above it, clear of the header
        const y = innerWidth < 768 ? Math.max(g.y - g.r - 30, 76) : g.y + g.r + 34;
        hint.current.style.transform = `translate(${g.x}px, ${y}px) translateX(-50%)`;
      }
      const desktop = innerWidth >= 768;
      const edge = copyEdge();
      sceneState.markers.forEach((m, i) => {
        const card = cards[i];
        const line = lines[i];
        if (!card || !line) return;
        let a = desktop ? m.facing : 0;
        if (a <= 0.01) {
          card.style.opacity = line.style.opacity = "0";
          return;
        }
        // the label sits outward from the globe's centre; the arrow points back at the city
        let dx = m.x - g.x;
        let dy = m.y - g.y;
        const len = Math.hypot(dx, dy) || 1;
        dx /= len;
        dy /= len;
        const lx = m.x + dx * ARROW;
        const ly = m.y + dy * ARROW;
        line.setAttribute("x1", String(lx));
        line.setAttribute("y1", String(ly));
        line.setAttribute("x2", String(m.x + dx * 7));
        line.setAttribute("y2", String(m.y + dy * 7));
        const left = dx < 0;
        const cardAnchorX = left ? lx - 8 : lx + 8;
        card.style.transform = left
          ? `translate(${cardAnchorX}px, ${ly}px) translate(-100%, -50%)`
          : `translate(${cardAnchorX}px, ${ly}px) translateY(-50%)`;
        const estLeft = left ? cardAnchorX - 140 : cardAnchorX;
        a *= Math.min(1, Math.max(0, (estLeft - edge) / 60));
        card.style.opacity = line.style.opacity = String(a);
      });
    };
    gsap.ticker.add(tick);
    return () => gsap.ticker.remove(tick);
  }, []);

  // live local times, refreshed every few seconds
  useEffect(() => {
    const fmts = about.places.map(
      (p) => new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: p.tz }),
    );
    const update = () => {
      const now = new Date();
      labels.current?.querySelectorAll<HTMLElement>("[data-time]").forEach((el, i) => {
        el.textContent = fmts[i]?.format(now) ?? "";
      });
    };
    update();
    const id = setInterval(update, 5000);
    return () => clearInterval(id);
  }, []);

  return (
    <div className="pointer-events-none fixed inset-0 z-[25]">
      <div
        ref={hit}
        data-cursor="open"
        aria-hidden
        className="pointer-events-auto absolute left-0 top-0 hidden cursor-grab touch-pan-y rounded-full active:cursor-grabbing"
      />
      <svg ref={svg} aria-hidden className="absolute inset-0 h-full w-full overflow-visible">
        {about.places.map((p, i) => (
          <line
            key={p.city}
            stroke={i === 0 ? "rgba(200,255,61,0.7)" : "rgba(236,233,226,0.32)"}
            strokeWidth="1"
            style={{ opacity: 0 }}
          />
        ))}
      </svg>
      <div ref={labels} aria-hidden>
        {about.places.map((p, i) => (
          <div
            key={p.city}
            className={`globe-label absolute left-0 top-0 whitespace-nowrap ${i === 0 ? "is-home" : ""}`}
            style={{ opacity: 0 }}
          >
            {i === 0 ? `Home · ${p.city}` : p.city}
            <span data-time className="ml-2.5 tabular-nums" />
          </div>
        ))}
      </div>
      <p
        ref={hint}
        aria-hidden
        className="label absolute left-0 top-0 whitespace-nowrap opacity-0 transition-opacity duration-700"
      >
        <span className="md:hidden">Tap the globe to open the board</span>
        <span className="hidden md:inline">← Drag to spin · click to open the board →</span>
      </p>
    </div>
  );
}
