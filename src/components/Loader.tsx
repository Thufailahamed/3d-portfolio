"use client";

import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { person } from "@/content/site";
import { gsap } from "@/lib/gsap";
import { sceneState } from "@/lib/sceneState";
import { useApp } from "@/store/useApp";

/**
 * Full-screen loader. The counter eases toward *real* progress (three's loading
 * manager + font loading + shader precompile) and never runs ahead of it.
 */
export default function Loader() {
  const pathname = usePathname();
  const root = useRef<HTMLDivElement>(null);
  const counter = useRef<HTMLSpanElement>(null);
  const bar = useRef<HTMLSpanElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const shown = useRef({ v: 0 });
  const [gone, setGone] = useState(false);
  const [canEnter, setCanEnter] = useState(false);

  // /flow is a direct standalone 3D exhibition space; skip the hero intro gate
  useEffect(() => {
    if (pathname === "/flow") {
      useApp.getState().set({ entered: true });
      sceneState.intro = 1;
      setGone(true);
    }
  }, [pathname]);

  // fonts are part of "loaded"
  const [fontsReady, setFontsReady] = useState(false);
  useEffect(() => {
    document.fonts.ready.then(() => setFontsReady(true));
  }, []);

  useEffect(() => {
    const update = () => {
      const { loadProgress, ready } = useApp.getState();
      const target = ready && fontsReady ? 100 : Math.min(99, loadProgress * 100);
      gsap.to(shown.current, {
        v: target,
        duration: 0.9,
        ease: "power2.out",
        overwrite: true,
        onUpdate: () => {
          const v = Math.round(shown.current.v);
          if (counter.current) counter.current.textContent = String(v).padStart(3, "0");
          if (bar.current) bar.current.style.transform = `scaleX(${shown.current.v / 100})`;
        },
        onComplete: () => {
          if (target === 100) setCanEnter(true);
        },
      });
    };
    update();
    return useApp.subscribe(update);
  }, [fontsReady]);

  useEffect(() => {
    if (canEnter && pathname !== "/flow") {
      button.current?.focus({ preventScroll: true });
    }
  }, [canEnter, pathname]);

  const enter = () => {
    if (!canEnter) return;
    useApp.getState().set({ entered: true });
    if (!root.current) {
      sceneState.intro = 1;
      setGone(true);
      return;
    }
    const fades = root.current.querySelectorAll(".loader-fade");
    gsap
      .timeline({ onComplete: () => setGone(true) })
      .to(fades, { opacity: 0, y: -12, duration: 0.5, stagger: 0.04, ease: "power2.in" })
      .to(root.current, { clipPath: "inset(0% 0% 100% 0%)", duration: 1.3, ease: "expo.inOut" }, 0.25)
      .to(sceneState, { intro: 1, duration: 2.6, ease: "power3.out" }, 0.45);
  };

  if (gone || pathname === "/flow") return null;

  return (
    <div
      ref={root}
      role="dialog"
      aria-modal="true"
      aria-label="Loading experience"
      className="loader fixed inset-0 z-50 flex flex-col justify-between overflow-hidden bg-bg px-gutter pb-6 pt-6"
      style={{ clipPath: "inset(0% 0% 0% 0%)" }}
    >
      <div className="loader-grid pointer-events-none absolute inset-0" aria-hidden />

      <div className="loader-fade relative">
        <p className="display text-[19vw] md:text-[8vw]">{person.shortName}</p>
        <p className="display text-[6.4vw] text-fg/70 md:text-[2.8vw]">{person.role}</p>
      </div>

      <div className="relative flex flex-1 items-center">
        <button
          ref={button}
          type="button"
          onClick={enter}
          disabled={!canEnter}
          data-cursor="enter"
          className="loader-fade group label relative !text-fg transition-opacity duration-500 disabled:cursor-wait disabled:opacity-40 md:ml-[16vw]"
        >
          {canEnter ? "Enter the experience" : "Calibrating signal"}
          <span className="absolute -bottom-2 left-0 h-px w-full origin-left bg-fg/20" />
          <span
            ref={bar}
            className="absolute -bottom-2 left-0 h-px w-full origin-left bg-accent"
            style={{ transform: "scaleX(0)" }}
          />
        </button>
      </div>

      <div className="relative flex items-end justify-between gap-4">
        <p className="loader-fade label hidden max-w-[34ch] md:block">
          Best experienced with sound off and a mouse. A lighter version is available from the menu.
        </p>

        <div className="loader-fade ml-auto flex items-end gap-3">
          <HudCards />
          <span
            ref={counter}
            aria-live="polite"
            className="display min-w-[3ch] text-right text-[16vw] tabular-nums md:text-[6vw]"
          >
            000
          </span>
        </div>
      </div>
    </div>
  );
}

/** Small decorative HUD collage — purely visual. */
function HudCards() {
  return (
    <div aria-hidden className="hidden gap-2 md:flex">
      <div className="hud-card w-36">
        <div className="flex justify-between">
          <span>OBJ—01</span>
          <span className="text-accent">●</span>
        </div>
        <svg viewBox="0 0 60 90" className="mx-auto my-2 h-24 text-fg/50">
          <rect x="18" y="4" width="24" height="82" fill="none" stroke="currentColor" strokeWidth="0.6" />
          {[14, 20, 23, 30, 41, 47, 58, 66].map((y, i) => (
            <rect key={i} x={29 + (i % 3) - 1} y={y} width={i % 2 ? 1 : 2} height={i % 3 ? 3 : 6} className="fill-accent" />
          ))}
          <line x1="0" y1="86" x2="60" y2="86" stroke="currentColor" strokeWidth="0.4" />
        </svg>
        <span>ARCH / 3.90M</span>
      </div>
      <div className="hud-card w-40">
        <div className="flex justify-between">
          <span>SIGNAL</span>
          <span>41 STONES</span>
        </div>
        <svg viewBox="0 0 80 80" className="mx-auto my-2 h-24 text-fg/40">
          {[36, 28, 20, 12].map((r) => (
            <circle key={r} cx="40" cy="40" r={r} fill="none" stroke="currentColor" strokeWidth="0.5" strokeDasharray={r === 36 ? "2 3" : undefined} />
          ))}
          <circle cx="40" cy="40" r="3" className="fill-accent" />
        </svg>
        <div className="flex h-4 items-end gap-[2px]">
          {Array.from({ length: 30 }, (_, i) => (
            <span key={i} className="w-[2px] bg-fg/40" style={{ height: `${30 + ((i * 37) % 70)}%` }} />
          ))}
        </div>
      </div>
    </div>
  );
}
