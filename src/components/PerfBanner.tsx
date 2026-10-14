"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useApp } from "@/store/useApp";

const WINDOW = 2000;
const LOW_FPS = 32;

/**
 * Watches the frame rate after Enter. First drop → lower the render quality;
 * if it's still struggling, offer the lite version.
 */
export default function PerfBanner() {
  const entered = useApp((s) => s.entered);
  const [show, setShow] = useState(false);

  useEffect(() => {
    if (!entered || sessionStorage.getItem("perf-dismissed")) return;
    let frames = 0;
    let start = 0;
    let strikes = 0;
    let raf = 0;
    const loop = (t: number) => {
      if (document.hidden) {
        start = 0;
      } else if (!start) {
        start = t;
        frames = 0;
      } else {
        frames++;
        if (t - start >= WINDOW) {
          const fps = (frames * 1000) / (t - start);
          start = t;
          frames = 0;
          strikes = fps < LOW_FPS ? strikes + 1 : Math.max(0, strikes - 1);
          if (strikes === 2 && useApp.getState().quality === "high") {
            useApp.getState().set({ quality: "low" });
            strikes = 0;
          } else if (strikes >= 2) {
            setShow(true);
            return;
          }
        }
      }
      raf = requestAnimationFrame(loop);
    };
    // give the first scene time to settle before judging
    const id = setTimeout(() => (raf = requestAnimationFrame(loop)), 3000);
    return () => {
      clearTimeout(id);
      cancelAnimationFrame(raf);
    };
  }, [entered]);

  if (!show) return null;
  const dismiss = () => {
    sessionStorage.setItem("perf-dismissed", "1");
    setShow(false);
  };
  return (
    <div role="alertdialog" aria-label="Low performance detected" className="fixed inset-x-0 bottom-6 z-40 flex justify-center px-gutter">
      <div className="flex flex-col items-start gap-3 rounded-2xl border border-fg/15 bg-bg/85 p-4 backdrop-blur-md md:flex-row md:items-center md:gap-5">
        <p className="label !text-fg">
          <span className="text-accent">●</span> Low performance detected
        </p>
        <div className="flex gap-2">
          <Link href="/lite" onClick={() => setShow(false)} className="hud-btn !border-accent !text-accent hover:!bg-accent hover:!text-bg">
            Switch to lite
          </Link>
          <button type="button" onClick={dismiss} className="hud-btn">
            Continue anyway
          </button>
        </div>
      </div>
    </div>
  );
}
