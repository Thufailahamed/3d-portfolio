"use client";

import { useRef } from "react";
import { person, beats } from "@/content/site";
import { chapterScroll } from "@/lib/chapters";
import { gsap, SplitText, useGSAP } from "@/lib/gsap";
import { useApp } from "@/store/useApp";

export default function Hero() {
  const root = useRef<HTMLElement>(null);
  const entered = useApp((s) => s.entered);

  // entrance: letters rise out of a mask once the loader wipes away
  useGSAP(
    () => {
      const split = SplitText.create(".hero-title", { type: "chars,lines", mask: "lines", aria: "auto" });
      if (!entered) {
        gsap.set(split.chars, { yPercent: 110 });
        gsap.set(".hero-meta-in", { opacity: 0 });
        return;
      }
      gsap
        .timeline({ delay: 0.75 })
        .to(split.chars, { yPercent: 0, duration: 1.3, stagger: 0.035, ease: "expo.out" })
        .to(".hero-meta-in", { opacity: 1, duration: 1.2, stagger: 0.1, ease: "power2.out" }, 0.4);
      return () => split.revert();
    },
    { scope: root, dependencies: [entered] },
  );

  useGSAP(
    () => {
      // Scrubbed exit: plays identically backward and forward.
      gsap
        .timeline({
          scrollTrigger: { ...chapterScroll("hero", 0, 0.8), scrub: true },
        })
        .to(".hero-name", { yPercent: -35, opacity: 0, ease: "none" }, 0)
        .to(".hero-meta", { y: -40, opacity: 0, ease: "none" }, 0)
        .to(".hero-hint", { opacity: 0, ease: "none", duration: 0.3 }, 0);
    },
    { scope: root },
  );

  return (
    <section
      ref={root}
      aria-label="Introduction"
      className="sticky top-0 flex h-svh flex-col justify-between px-gutter pb-8 pt-6 md:pb-10"
    >
      <div className="hero-name pt-16 md:pt-4">
        <h1 className="hero-title display text-[15vw] md:text-[10vw]">
          {person.shortName}
        </h1>
        <p className="hero-title display -mt-[0.5vw] text-[6vw] text-fg/80 md:text-[3.4vw]">
          {person.role}
        </p>
      </div>

      <div className="hero-meta hero-meta-in flex items-end justify-between gap-6">
        <p className="max-w-[30ch] text-balance text-sm leading-relaxed text-fg/70 md:text-base">
          {beats.hero[0]} {person.intro.split(".")[0]}.
        </p>
        <p className="label hidden text-right md:block">
          {person.location}
          <br />
          <span className="text-accent">●</span> Available for projects
        </p>
      </div>

      <div className="hero-hint hero-meta-in label pointer-events-none absolute bottom-8 left-1/2 hidden md:block -translate-x-1/2 md:bottom-10">
        <span className="scroll-hint">Scroll to begin</span>
      </div>
    </section>
  );
}
