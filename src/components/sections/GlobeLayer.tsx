"use client";

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
 *    (the scene reads the drag from sceneState.globeDrag)
 *  - arrows pointing at the marked cities, each labelled with its live local time
 * Positions come from the scene every frame (sceneState.globe / .markers).
 */
export default function GlobeLayer() {
  const hit = useRef<HTMLDivElement>(null);
  const labels = useRef<HTMLDivElement>(null);
  const svg = useRef<SVGSVGElement>(null);
  const hint = useRef<HTMLParagraphElement>(null);

  // drag → accumulated deltas; the scene consumes and resets them each frame
  useEffect(() => {
    const el = hit.current;
    if (!el) return;
    const drag = sceneState.globeDrag;
    let last: { x: number; y: number } | null = null;
    const down = (e: PointerEvent) => {
      if (!sceneState.globe.grabbable) return;
      el.setPointerCapture(e.pointerId);
      last = { x: e.clientX, y: e.clientY };
      drag.dragging = true;
    };
    const move = (e: PointerEvent) => {
      if (!last) return;
      drag.dx += e.clientX - last.x;
      drag.dy += e.clientY - last.y;
      last = { x: e.clientX, y: e.clientY };
    };
    const up = () => {
      last = null;
      drag.dragging = false;
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
  }, []);

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
        hint.current.style.transform = `translate(${g.x}px, ${g.y + g.r + 34}px) translateX(-50%)`;
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
        const x = left ? lx - card.offsetWidth - 8 : lx + 8;
        card.style.transform = `translate(${x}px, ${ly - card.offsetHeight / 2}px)`;
        a *= Math.min(1, Math.max(0, (x - edge) / 60));
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
        data-cursor="drag"
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
        className="label absolute left-0 top-0 hidden whitespace-nowrap opacity-0 transition-opacity duration-700 md:block"
      >
        ← Drag to spin the globe →
      </p>
    </div>
  );
}
