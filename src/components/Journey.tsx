"use client";

import { useRef } from "react";
import { gsap, ScrollTrigger, useGSAP } from "@/lib/gsap";
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

      // the scene and camera start on the target chapter from the very first frame
      if (initial) {
        sceneState.p = landing(initial);
        if (initial === "about") sceneState.aboutSec = 16.0;
      }

      // back from the board: the board left its map flat on the screen. Once the page has
      // landed on the globe, that map rolls back up into it; then the About copy returns
      // (every chapter's copy stays hidden until then — see html[data-unfold] in globals.css)
      sceneState.board.leaving = false;
      const sections = Array.from(track.current?.children ?? []) as HTMLElement[];
      const restore = () => {
        delete document.documentElement.dataset.unfold;
        const about = sections.find((s) => s.dataset.chapter === "about");
        gsap.set(sections.filter((s) => s !== about), { clearProps: "opacity,visibility" });
        if (about) gsap.to(about, { autoAlpha: 1, duration: 0.7, ease: "power2.out", clearProps: "opacity,visibility" });
      };
      if (sceneState.unfold.t > 0) {
        // hidden before the first paint, so nothing (the hero's title above all) can flash
        // over the map while the page lands
        gsap.set(sections, { autoAlpha: 0 });
        gsap.fromTo(sceneState.unfold, { t: 1 }, { t: 0, duration: 3.2, delay: 0.1, ease: "sine.inOut", onComplete: restore });
      } else restore();

      let historyTimer: ReturnType<typeof setTimeout> | undefined;
      const st = ScrollTrigger.create({
        trigger: track.current,
        start: "top top",
        end: "bottom bottom",
        onUpdate: (self) => {
          // While the globe is performing its rolling animation, keep camera locked on the globe
          if (sceneState.unfold.t > 0) {
            sceneState.p = landing("about");
            return;
          }
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
      const target = () => {
        if (!initial) return 0;
        const max = document.documentElement.scrollHeight - window.innerHeight;
        const fallback = landing(initial) * max;
        const stMax = st.end - st.start;
        return stMax > 100 ? st.start + stMax * landing(initial) : fallback;
      };
      const jump = () => {
        st.refresh();
        const y = target();
        if (lenis) lenis.scrollTo(y, { immediate: true, force: true });
        else window.scrollTo(0, y);
        if (initial) {
          sceneState.p = landing(initial);
        }
        ScrollTrigger.update();
      };
      jump();
      let raf = requestAnimationFrame(() => (raf = requestAnimationFrame(jump)));
      // the previous route can linger in the DOM for a moment during client navigation, and
      // a slow first load can lay the track out late: keep re-landing until the page has sat
      // on its chapter for a moment, or the visitor scrolls themselves
      const ro = new ResizeObserver(() => jump());
      ro.observe(document.body);
      let steady = 0;
      const hold = () => {
        if (Math.abs(scrollY - target()) > 2) {
          steady = 0;
          jump();
        } else if (++steady > 30) settle();
      };
      gsap.ticker.add(hold);
      const settle = () => {
        ro.disconnect();
        gsap.ticker.remove(hold);
      };
      const settleTimer = setTimeout(settle, 4000);
      addEventListener("wheel", settle, { once: true, passive: true });
      addEventListener("touchstart", settle, { once: true, passive: true });
      addEventListener("keydown", settle, { once: true });

      sceneState.p = st.progress;
      return () => {
        cancelAnimationFrame(raf);
        clearTimeout(settleTimer);
        clearTimeout(historyTimer);
        settle();
        removeEventListener("wheel", settle);
        removeEventListener("touchstart", settle);
        removeEventListener("keydown", settle);
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
