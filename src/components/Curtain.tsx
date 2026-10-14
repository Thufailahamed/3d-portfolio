"use client";

import { useEffect, useRef } from "react";
import { gsap } from "@/lib/gsap";

type Cover = { x: number; y: number; tint: string; image: string };

let el: HTMLDivElement | null = null;
let covered = false;
let revealedAt = -Infinity;

/**
 * A full-screen iris that carries a transition across a route change: it opens from
 * a point (the crystal) filled with the project's light, the page swaps underneath,
 * and the next page dissolves it.
 */
export const curtain = {
  cover({ x, y, tint, image }: Cover) {
    return new Promise<void>((resolve) => {
      if (!el) return resolve();
      covered = true;
      el.style.setProperty("--tint", tint);
      const img = el.querySelector<HTMLDivElement>("[data-img]");
      if (img) img.style.backgroundImage = `url(${image})`;
      const r = Math.hypot(Math.max(x, innerWidth - x), Math.max(y, innerHeight - y));
      gsap.killTweensOf(el);
      gsap.set(el, { autoAlpha: 1, clipPath: `circle(0px at ${x}px ${y}px)`, filter: "blur(0px)" });
      gsap.fromTo(img, { scale: 1.6 }, { scale: 1.08, duration: 1.1, ease: "power3.out" });
      gsap.to(el, {
        clipPath: `circle(${r + 40}px at ${x}px ${y}px)`,
        duration: 0.85,
        ease: "power3.in",
        onComplete: resolve,
      });
    });
  },
  /**
   * Called by the incoming page; returns whether it arrived through the curtain.
   * The fade starts outside the caller's tick so a gsap context revert (e.g. React
   * strict mode re-running effects) can't cancel it, and repeat calls report the same.
   */
  reveal() {
    if (!el) return false;
    if (!covered) return performance.now() - revealedAt < 1500;
    covered = false;
    revealedAt = performance.now();
    const target = el;
    requestAnimationFrame(() =>
      gsap.to(target, { autoAlpha: 0, filter: "blur(18px)", duration: 1.1, delay: 0.1, ease: "power2.inOut" }),
    );
    return true;
  },
};

export default function Curtain() {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    el = ref.current;
    return () => {
      el = null;
    };
  }, []);

  return (
    <div
      ref={ref}
      aria-hidden
      className="pointer-events-none invisible fixed inset-0 z-[44] overflow-hidden bg-bg opacity-0"
    >
      <div data-img className="absolute inset-0 bg-cover bg-top opacity-30 blur-[1px]" />
      <div className="curtain-light absolute inset-0" />
    </div>
  );
}
