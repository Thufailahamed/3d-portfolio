"use client";

import { useEffect, useRef } from "react";
import { beats } from "@/content/site";
import { atSec } from "@/experience/aboutTimeline";
import { chapter } from "@/lib/chapters";
import { gsap } from "@/lib/gsap";
import { sceneState } from "@/lib/sceneState";

/** When each About line is on screen, in reference seconds (see aboutTimeline). */
const SLOTS: [number, number][] = [
  [2.0, 3.4],
  [3.6, 5.8],
  [6.8, 8.2],
  [8.6, 10.8],
];
const STAGGER = 0.025; // seconds between letters
const FADE = 0.25; // each letter's fade

/**
 * Small captions near the bottom of the About sequence. Each line types in letter by
 * letter (each letter fading up), holds, then fades out the same way. Scrubbed by scroll.
 */
export default function AboutCaptions() {
  const root = useRef<HTMLDivElement>(null);
  const lines = beats.about.slice(0, SLOTS.length);

  useEffect(() => {
    const el = root.current;
    if (!el) return;
    const rows = Array.from(el.querySelectorAll<HTMLElement>("[data-caption]"));
    const letters = rows.map((r) => Array.from(r.querySelectorAll<HTMLElement>("[data-ch]")));
    const c = chapter("about");
    const clamp = (x: number) => Math.min(1, Math.max(0, x));
    const tick = () => {
      const p = sceneState.p;
      const on = p >= c.start + (c.end - c.start) * atSec(0) && p <= c.end;
      el.style.visibility = on ? "visible" : "hidden";
      if (!on) return;
      const sec = sceneState.aboutSec; // same damped clock as the strands
      letters.forEach((chars, i) => {
        const [from, to] = SLOTS[i];
        const live = sec > from - 0.1 && sec < to + chars.length * STAGGER + FADE + 0.1;
        rows[i].style.visibility = live ? "visible" : "hidden";
        if (!live) return;
        chars.forEach((ch, j) => {
          const d = j * STAGGER;
          ch.style.opacity = String(clamp((sec - from - d) / FADE) * (1 - clamp((sec - to - d) / FADE)));
        });
      });
    };
    gsap.ticker.add(tick);
    return () => gsap.ticker.remove(tick);
  }, []);

  return (
    <div
      ref={root}
      className="pointer-events-none invisible fixed inset-x-0 top-[90svh] z-10 -translate-y-1/2 px-gutter text-center"
    >
      <p className="sr-only">{lines.join(" ")}</p>
      {lines.map((line, i) => (
        <p
          key={i}
          aria-hidden
          data-caption
          className="invisible absolute inset-x-0 text-[15px] tracking-[-0.01em] text-white/75"
        >
          {Array.from(line).map((ch, j) => (
            <span key={j} data-ch style={{ opacity: 0 }}>
              {ch}
            </span>
          ))}
        </p>
      ))}
    </div>
  );
}
