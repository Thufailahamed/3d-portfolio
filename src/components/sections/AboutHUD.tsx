"use client";

import { useRef } from "react";
import { about } from "@/content/site";
import { gsap, SplitText, useGSAP } from "@/lib/gsap";
import { sceneState } from "@/lib/sceneState";
import { useChapterActive } from "@/hooks/useChapterActive";

/**
 * About copy beside the globe, plus annotation notes whose leader lines are
 * pinned to spots on the globe (projected from 3D every frame).
 */
export default function AboutHUD() {
  const root = useRef<HTMLElement>(null);
  const active = useChapterActive("about", 0.8, 0.95);

  // reveal once the globe has formed
  useGSAP(
    () => {
      const split = SplitText.create(".about-headline", { type: "lines", mask: "lines", aria: "auto" });
      if (!active) {
        gsap.set(split.lines, { yPercent: 110 });
        gsap.set(".about-in", { opacity: 0, y: 14 });
        gsap.set(".note", { opacity: 0 });
        return () => split.revert();
      }
      const tl = gsap.timeline();
      tl.to(split.lines, { yPercent: 0, duration: 1.1, stagger: 0.08, ease: "expo.out" })
        .to(".about-in", { opacity: 1, y: 0, duration: 0.8, stagger: 0.06, ease: "power2.out" }, 0.2)
        .to(".note", { opacity: 1, duration: 0.6, stagger: 0.12 }, 0.5)
        .fromTo(".note-line", { strokeDashoffset: 1 }, { strokeDashoffset: 0, duration: 0.8, stagger: 0.12 }, 0.4);
      return () => {
        tl.kill();
        split.revert();
      };
    },
    { scope: root, dependencies: [active] },
  );

  // follow the projected anchors (desktop only — mobile shows the notes inline)
  useGSAP(
    () => {
      if (!active) return;
      const notes = gsap.utils.toArray<HTMLElement>(".note", root.current);
      const lines = gsap.utils.toArray<SVGLineElement>(".note-line", root.current);
      const tick = () => {
        const desktop = innerWidth >= 768;
        const xs = sceneState.anchors.map((a) => a.x);
        const mid = xs.reduce((s, x) => s + x, 0) / xs.length;
        sceneState.anchors.forEach((a, i) => {
          const note = notes[i];
          const line = lines[i];
          if (!note || !line) return;
          const show = desktop && a.visible;
          note.style.visibility = show ? "visible" : "hidden";
          line.style.visibility = show ? "visible" : "hidden";
          if (!show) return;
          // push each note outward from the globe, a little above its anchor
          const dir = a.x >= mid ? 1 : -1;
          const nx = a.x + dir * (70 + i * 14);
          const ny = a.y - 56 + i * 12;
          const w = note.offsetWidth;
          note.style.transform = `translate(${dir > 0 ? nx : nx - w}px, ${ny - note.offsetHeight / 2}px)`;
          line.setAttribute("x1", String(a.x));
          line.setAttribute("y1", String(a.y));
          line.setAttribute("x2", String(nx));
          line.setAttribute("y2", String(ny));
        });
      };
      gsap.ticker.add(tick);
      return () => gsap.ticker.remove(tick);
    },
    { scope: root, dependencies: [active] },
  );

  return (
    <section
      ref={root}
      aria-labelledby="about-title"
      className={`fixed inset-0 z-20 transition-[opacity,visibility] duration-700 ${
        active ? "opacity-100" : "pointer-events-none invisible opacity-0"
      }`}
    >
      {/* leader lines + anchor dots, in screen space */}
      <svg aria-hidden className="pointer-events-none absolute inset-0 hidden h-full w-full md:block">
        {about.annotations.map((_, i) => (
          <line
            key={i}
            className="note-line"
            pathLength={1}
            strokeDasharray="1"
            stroke="var(--color-accent)"
            strokeOpacity="0.7"
            strokeWidth="1"
          />
        ))}
      </svg>
      <div aria-hidden className="pointer-events-none absolute inset-0 hidden md:block">
        {about.annotations.map((n) => (
          <div key={n.label} className="note hud-card absolute left-0 top-0 whitespace-nowrap">
            <span className="text-accent">● </span>
            {n.label}
            <span className="mt-1 block text-[11px] tracking-normal text-fg normal-case">{n.value}</span>
          </div>
        ))}
      </div>

      <div className="absolute inset-x-0 bottom-0 px-gutter pb-8 md:bottom-auto md:top-1/2 md:max-w-[46vw] md:-translate-y-1/2 md:pb-0">
        <p className="about-in label mb-4">About — How I work</p>
        <h2 id="about-title" className="about-headline display text-[11vw] md:text-[5.4vw]">
          {about.headline}
        </h2>
        <div className="mt-5 max-w-[46ch] space-y-3 text-sm leading-relaxed text-fg/75 md:mt-7 md:text-base">
          {about.body.map((p, i) => (
            <p key={i} className={`about-in ${i > 0 ? "hidden md:block" : ""}`}>
              {p}
            </p>
          ))}
        </div>
        <ul className="about-in mt-5 flex flex-wrap gap-2 md:mt-7" aria-label="Services">
          {about.services.map((s) => (
            <li key={s} className="label rounded-full border border-fg/15 px-3 py-1.5 !text-fg/80">
              {s}
            </li>
          ))}
        </ul>
        {/* on phones the notes sit inline instead of floating on the globe */}
        <dl className="about-in mt-4 grid grid-cols-3 gap-2 md:sr-only">
          {about.annotations.map((n) => (
            <div key={n.label} className="hud-card">
              <dt>{n.label}</dt>
              <dd className="mt-1 text-[10px] tracking-normal text-fg normal-case">{n.value}</dd>
            </div>
          ))}
        </dl>
      </div>
    </section>
  );
}
