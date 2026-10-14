"use client";

import { useRef } from "react";
import { ScrollTrigger, useGSAP } from "@/lib/gsap";
import { chapters, chapterAt, TRACK_VH } from "@/lib/chapters";
import { sceneState } from "@/lib/sceneState";
import { useApp } from "@/store/useApp";
import Hero from "./sections/Hero";

/**
 * The scroll track. Its height defines how long the journey is; one ScrollTrigger
 * maps scroll position → sceneState.p, and every chapter reads from that.
 */
export default function Journey() {
  const track = useRef<HTMLDivElement>(null);

  useGSAP(
    () => {
      const st = ScrollTrigger.create({
        trigger: track.current,
        start: "top top",
        end: "bottom bottom",
        onUpdate: (self) => {
          sceneState.p = self.progress;
          const c = chapterAt(self.progress).id;
          if (useApp.getState().chapter !== c) useApp.getState().set({ chapter: c });
        },
      });
      sceneState.p = st.progress;
      return () => st.kill();
    },
    { scope: track },
  );

  return (
    <div
      ref={track}
      className="journey relative"
      style={
        {
          "--track-d": `${TRACK_VH.desktop}svh`,
          "--track-m": `${TRACK_VH.mobile}svh`,
        } as React.CSSProperties
      }
    >
      {chapters.map((c) => (
        <div
          key={c.id}
          id={`ch-${c.id}`}
          data-chapter={c.id}
          className="absolute inset-x-0"
          style={{ top: `${c.start * 100}%`, height: `${(c.end - c.start) * 100}%` }}
        >
          {c.id === "hero" && <Hero />}
        </div>
      ))}
    </div>
  );
}
