"use client";

import { useRef } from "react";
import { person, beats } from "@/content/site";
import { gsap, useGSAP } from "@/lib/gsap";

export default function Hero() {
  const root = useRef<HTMLElement>(null);

  useGSAP(
    () => {
      // Scrubbed exit: plays identically backward and forward.
      gsap
        .timeline({
          scrollTrigger: {
            // the sticky section's parent is the chapter slice
            trigger: root.current!.parentElement,
            start: "top top",
            end: "bottom bottom",
            scrub: true,
          },
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
        <h1 className="display text-[19vw] md:text-[11.5vw]">
          {person.shortName}
        </h1>
        <p className="display -mt-[0.5vw] text-[7.2vw] text-fg/80 md:text-[4.1vw]">
          {person.role.split("&")[0].trim()}
        </p>
      </div>

      <div className="hero-meta flex items-end justify-between gap-6">
        <p className="max-w-[30ch] text-balance text-sm leading-relaxed text-fg/70 md:text-base">
          {beats.hero[0]} {person.intro.split(".")[0]}.
        </p>
        <p className="label hidden text-right md:block">
          {person.location}
          <br />
          <span className="text-accent">●</span> Available for projects
        </p>
      </div>

      <div className="hero-hint label pointer-events-none absolute bottom-8 left-1/2 hidden md:block -translate-x-1/2 md:bottom-10">
        <span className="scroll-hint">Scroll to begin</span>
      </div>
    </section>
  );
}
