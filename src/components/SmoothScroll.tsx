"use client";

import Lenis from "lenis";
import { useEffect } from "react";
import { gsap, ScrollTrigger } from "@/lib/gsap";
import { sceneState } from "@/lib/sceneState";
import { useApp } from "@/store/useApp";

export let lenis: Lenis | null = null;

/** Lenis drives the GSAP ticker so ScrollTrigger and smooth scroll share one clock. */
export default function SmoothScroll() {
  useEffect(() => {
    const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
    lenis = new Lenis({ autoRaf: false, lerp: reduce ? 1 : 0.095, wheelMultiplier: 1.0 });
    lenis.on("scroll", ScrollTrigger.update);

    // no browser scroll restoration: each route decides where it starts. Locked until "Enter".
    history.scrollRestoration = "manual";
    if (!useApp.getState().entered) lenis.stop();
    const unsub = useApp.subscribe((s, prev) => {
      if (s.entered && !prev.entered) lenis?.start();
    });
    const tick = (t: number) => lenis?.raf(t * 1000);
    gsap.ticker.add(tick);
    gsap.ticker.lagSmoothing(500, 33);

    const onMove = (e: PointerEvent) => {
      sceneState.mouse.x = (e.clientX / innerWidth) * 2 - 1;
      sceneState.mouse.y = -((e.clientY / innerHeight) * 2 - 1);
    };
    addEventListener("pointermove", onMove, { passive: true });

    return () => {
      unsub();
      gsap.ticker.remove(tick);
      removeEventListener("pointermove", onMove);
      lenis?.destroy();
      lenis = null;
    };
  }, []);
  return null;
}
