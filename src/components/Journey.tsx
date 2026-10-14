"use client";

import { useRef } from "react";
import { ScrollTrigger, useGSAP } from "@/lib/gsap";
import { curtain } from "./Curtain";
import { lenis } from "./SmoothScroll";
import { chapters, chapterAt, landing, TRACK_VH, type ChapterId } from "@/lib/chapters";
import { sceneState } from "@/lib/sceneState";
import { useApp } from "@/store/useApp";
import { beats, person } from "@/content/site";
import Beats from "./sections/Beats";
import Hero from "./sections/Hero";
import ProjectsHUD from "./sections/ProjectsHUD";
import AboutCaptions from "./sections/AboutCaptions";
import AboutHUD from "./sections/AboutHUD";
import GlobeLayer from "./sections/GlobeLayer";
import ContactSection from "./sections/ContactSection";

/**
 * The scroll track. Its height defines how long the journey is; one ScrollTrigger
 * maps scroll position → sceneState.p, and every chapter reads from that.
 */
export default function Journey({ initial }: { initial?: ChapterId }) {
  const track = useRef<HTMLDivElement>(null);

  useGSAP(
    () => {
      sceneState.dive = 0;
      // coming back from the board through the curtain: it lifts over the globe
      curtain.reveal();
      // back from the board: the globe is whole again, and the About copy returns
      sceneState.unfold.t = 0;
      delete document.documentElement.dataset.unfold;

      let historyTimer: ReturnType<typeof setTimeout> | undefined;
      const st = ScrollTrigger.create({
        trigger: track.current,
        start: "top top",
        end: "bottom bottom",
        onUpdate: (self) => {
          sceneState.p = self.progress;
          const c = chapterAt(self.progress);
          if (useApp.getState().chapter === c.id) return;
          useApp.getState().set({ chapter: c.id });
          // debounce history replace to avoid router re-renders while scrolling
          clearTimeout(historyTimer);
          historyTimer = setTimeout(() => {
            if (location.pathname !== c.path) history.replaceState(null, "", c.path);
            document.title = c.title === "Home" ? `${person.name} — ${person.role}` : `${c.title} · ${person.name}`;
          }, 180);
        },
      });

      // deep links (/projects, /about, …) land on their chapter, settled. Re-run after
      // the router's own scroll-to-top and once layout has settled.
      const jump = () => {
        st.refresh();
        let y = 0;
        if (initial) y = st.start + (st.end - st.start) * landing(initial);
        if (lenis) lenis.scrollTo(y, { immediate: true, force: true });
        else window.scrollTo(0, y);
        ScrollTrigger.update();
      };
      jump();
      let raf = requestAnimationFrame(() => (raf = requestAnimationFrame(jump)));
      // the previous route can linger in the DOM for a moment during client navigation:
      // keep re-landing while the layout settles, until the visitor scrolls themselves
      const ro = new ResizeObserver(() => jump());
      ro.observe(document.body);
      const settle = () => ro.disconnect();
      const settleTimer = setTimeout(settle, 1200);
      addEventListener("wheel", settle, { once: true, passive: true });
      addEventListener("touchstart", settle, { once: true, passive: true });

      sceneState.p = st.progress;
      return () => {
        cancelAnimationFrame(raf);
        clearTimeout(settleTimer);
        clearTimeout(historyTimer);
        settle();
        removeEventListener("wheel", settle);
        removeEventListener("touchstart", settle);
        st.kill();
      };
    },
    { scope: track, dependencies: [initial] },
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
          {c.id === "fracture" && (
            <Beats chapter="fracture" label="The rule" lines={beats.fracture} window={[0.06, 0.9]} />
          )}
          {c.id === "projects" && <ProjectsHUD />}
          {c.id === "about" && (
            <>
              <AboutCaptions />
              <AboutHUD />
              <GlobeLayer />
            </>
          )}
          {c.id === "contact" && <ContactSection />}
          {c.id === "tunnel" && (
            <Beats
              chapter="tunnel"
              label="Into the work"
              lines={["Entering — selected work, 2023 → 2026"]}
              window={[0.45, 1.05]}
              variant="label"
            />
          )}
        </div>
      ))}
    </div>
  );
}
