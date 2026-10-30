"use client";

import { useEffect, useRef, useState } from "react";
import { curtain } from "@/components/Curtain";
import { lenis } from "@/components/SmoothScroll";
import { gsap, ScrollTrigger, SplitText, useGSAP } from "@/lib/gsap";
import "./landing.css";

export { isLanding, LANDING_SLUGS } from "./routes";

const reduced = () => matchMedia("(prefers-reduced-motion: reduce)").matches;

/**
 * Shared boot for a landing page: dissolve the crystal curtain, unlock smooth scroll, start at the top,
 * and wire the shared effects by attribute:
 * - `data-reveal`   fades up as it scrolls in
 * - `data-split`    headline whose lines rise out of a mask as it scrolls in ("load" plays at once)
 * - `data-scramble` text that decodes itself as it scrolls in (each `[data-line]` inside, or the element)
 * - `data-clip`     wipes open from the bottom as it scrolls in
 * - `data-parallax` drifts by that fraction of its height while it crosses the viewport
 * - `data-magnetic` leans toward the pointer; `data-tilt` turns in 3D under it; `data-glow` gets a spotlight
 * A `.lp-progress` bar anywhere in the page fills with reading progress.
 */
export function useLandingBoot(scope: React.RefObject<HTMLElement | null>) {
  useEffect(() => {
    curtain.reveal();
    lenis?.start();
    lenis?.scrollTo(0, { immediate: true, force: true });
    document.documentElement.dataset.surface = "";
  }, []);

  useGSAP(
    (_, contextSafe) => {
      gsap.fromTo(".lp-progress", { scaleX: 0 }, { scaleX: 1, ease: "none", scrollTrigger: { start: 0, end: "max", scrub: 0.3 } });
      if (reduced()) return;

      const items = gsap.utils.toArray<HTMLElement>("[data-reveal]");
      gsap.set(items, { autoAlpha: 0, y: 28 });
      ScrollTrigger.batch(items, {
        start: "top 92%",
        once: true,
        onEnter: (b) => gsap.to(b, { autoAlpha: 1, y: 0, duration: 1, stagger: 0.08, ease: "power3.out", overwrite: true }),
      });

      for (const el of gsap.utils.toArray<HTMLElement>("[data-clip]")) {
        gsap.fromTo(
          el,
          { clipPath: "inset(100% 0% 0% 0%)" },
          { clipPath: "inset(0% 0% 0% 0%)", duration: 1.3, ease: "expo.inOut", scrollTrigger: { trigger: el, start: "top 88%", once: true } },
        );
      }

      for (const el of gsap.utils.toArray<HTMLElement>("[data-parallax]")) {
        const k = parseFloat(el.dataset.parallax || "0.15");
        gsap.fromTo(el, { yPercent: -k * 100 }, { yPercent: k * 100, ease: "none", scrollTrigger: { trigger: el.parentElement, start: "top bottom", end: "bottom top", scrub: true } });
      }

      for (const el of gsap.utils.toArray<HTMLElement>("[data-scramble]")) {
        const lines = el.querySelectorAll<HTMLElement>("[data-line]");
        const targets = lines.length ? [...lines] : [el];
        const chars = el.dataset.scramble || "upperAndLowerCase";
        const play = () =>
          targets.forEach((t, i) => {
            const text = t.dataset.text ?? (t.dataset.text = t.textContent ?? "");
            gsap.to(t, { duration: 1.2 + text.length * 0.012, delay: i * 0.12, scrambleText: { text, chars, speed: 0.5, revealDelay: 0.2 }, ease: "none" });
          });
        if (el.dataset.when === "load") play();
        else ScrollTrigger.create({ trigger: el, start: "top 88%", once: true, onEnter: play });
      }

      // headlines are split once the fonts have settled, so the lines break where they will stay
      const split = contextSafe!(() => {
        for (const el of gsap.utils.toArray<HTMLElement>("[data-split]")) {
          SplitText.create(el, {
            type: "lines",
            mask: "lines",
            autoSplit: true,
            onSplit: (self) =>
              gsap.from(self.lines, {
                yPercent: 115,
                rotate: 2,
                duration: 1.15,
                stagger: 0.09,
                ease: "expo.out",
                delay: el.dataset.split === "load" ? 0.15 : 0,
                scrollTrigger: el.dataset.split === "load" ? undefined : { trigger: el, start: "top 90%", once: true },
              }),
          });
        }
        ScrollTrigger.refresh();
      });
      document.fonts?.ready.then(split);

      const id = setTimeout(() => ScrollTrigger.refresh(), 800);
      return () => clearTimeout(id);
    },
    { scope },
  );

  // pointer effects, by delegation so re-rendered children keep them
  useEffect(() => {
    const root = scope.current;
    if (!root || reduced() || !matchMedia("(pointer: fine)").matches) return;
    let tilt: HTMLElement | null = null;
    let mag: HTMLElement | null = null;
    const release = (next: { tilt: HTMLElement | null; mag: HTMLElement | null }) => {
      if (tilt && tilt !== next.tilt) gsap.to(tilt, { rotateX: 0, rotateY: 0, duration: 0.9, ease: "power3.out" });
      if (mag && mag !== next.mag) gsap.to(mag, { x: 0, y: 0, duration: 0.9, ease: "elastic.out(1, 0.4)" });
      tilt = next.tilt;
      mag = next.mag;
    };
    const move = (e: PointerEvent) => {
      const t = e.target as Element;
      const g = t.closest<HTMLElement>("[data-glow]");
      if (g) {
        const r = g.getBoundingClientRect();
        g.style.setProperty("--mx", `${e.clientX - r.left}px`);
        g.style.setProperty("--my", `${e.clientY - r.top}px`);
      }
      const nt = t.closest<HTMLElement>("[data-tilt]");
      const nm = t.closest<HTMLElement>("[data-magnetic]");
      release({ tilt: nt, mag: nm });
      if (nt) {
        const r = nt.getBoundingClientRect();
        const x = (e.clientX - r.left) / r.width - 0.5;
        const y = (e.clientY - r.top) / r.height - 0.5;
        const k = parseFloat(nt.dataset.tilt || "7");
        gsap.to(nt, { rotateY: x * k, rotateX: -y * k, transformPerspective: 1000, duration: 0.6, ease: "power3.out" });
      }
      if (nm) {
        const r = nm.getBoundingClientRect();
        gsap.to(nm, { x: (e.clientX - r.left - r.width / 2) * 0.3, y: (e.clientY - r.top - r.height / 2) * 0.4, duration: 0.45, ease: "power3.out" });
      }
    };
    const leave = () => release({ tilt: null, mag: null });
    root.addEventListener("pointermove", move);
    root.addEventListener("pointerleave", leave);
    return () => {
      root.removeEventListener("pointermove", move);
      root.removeEventListener("pointerleave", leave);
    };
  }, [scope]);
}

/** A thin reading-progress bar pinned to the top of the viewport. */
export function ScrollProgress({ color }: { color: string }) {
  return <div aria-hidden className="lp-progress" style={{ background: color }} />;
}

/** Pointer position over an element as -0.5…0.5, smoothed; for parallax layers. */
export function usePointer<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el || reduced() || !matchMedia("(pointer: fine)").matches) return;
    const o = { x: 0, y: 0 };
    const set = () => {
      el.style.setProperty("--px", o.x.toFixed(4));
      el.style.setProperty("--py", o.y.toFixed(4));
    };
    const move = (e: PointerEvent) => {
      const r = el.getBoundingClientRect();
      gsap.to(o, { x: (e.clientX - r.left) / r.width - 0.5, y: (e.clientY - r.top) / r.height - 0.5, duration: 0.9, ease: "power3.out", onUpdate: set, overwrite: true });
      el.style.setProperty("--cx", `${e.clientX - r.left}px`);
      el.style.setProperty("--cy", `${e.clientY - r.top}px`);
    };
    el.addEventListener("pointermove", move);
    return () => el.removeEventListener("pointermove", move);
  }, []);
  return ref;
}

/** True once the element has come into view (stays true). */
export function useSeen<T extends HTMLElement>(threshold = 0.3) {
  const ref = useRef<T>(null);
  const [seen, setSeen] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(([e]) => e.isIntersecting && setSeen(true), { threshold });
    io.observe(el);
    return () => io.disconnect();
  }, [threshold]);
  return [ref, seen] as const;
}

/** How far the page has scrolled through a tall section, 0 at its top to 1 when its end reaches the viewport's bottom. */
export function useSectionProgress<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [pr, setPr] = useState(0);
  useEffect(() => {
    const on = () => {
      const el = ref.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      const span = r.height - innerHeight;
      setPr(Math.min(1, Math.max(0, -r.top / Math.max(1, span))));
    };
    on();
    addEventListener("scroll", on, { passive: true });
    addEventListener("resize", on);
    return () => {
      removeEventListener("scroll", on);
      removeEventListener("resize", on);
    };
  }, []);
  return [ref, pr] as const;
}

/** Counts a number up when it scrolls into view; keeps any prefix/suffix (e.g. "298", "3.8s", "N→1" is left alone). */
export function CountUp({ value, className }: { value: string; className?: string }) {
  const m = value.match(/^(\D*)(\d+(?:\.\d+)?)(.*)$/);
  return (
    <span
      className={className}
      ref={(el) => {
        if (!el || !m || el.dataset.counted) return;
        el.dataset.counted = "1";
        const [, pre, num, post] = m;
        const dp = num.split(".")[1]?.length ?? 0;
        const target = parseFloat(num);
        const o = { v: 0 };
        el.textContent = `${pre}${(0).toFixed(dp)}${post}`;
        gsap.to(o, {
          v: target,
          duration: 1.8,
          ease: "power3.out",
          scrollTrigger: { trigger: el, start: "top 95%", once: true },
          onUpdate: () => void (el.textContent = `${pre}${o.v.toFixed(dp).padStart(num.length, "0")}${post}`),
        });
      }}
    >
      {value}
    </span>
  );
}
