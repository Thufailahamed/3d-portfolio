"use client";

import { useRef } from "react";
import { gsap, ScrollTrigger, useGSAP } from "@/lib/gsap";

/** Fades `.reveal` children up as they enter the viewport. */
export default function Reveal({ children }: { children: React.ReactNode }) {
  const root = useRef<HTMLDivElement>(null);
  useGSAP(
    () => {
      if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
      const items = gsap.utils.toArray<HTMLElement>(".reveal");
      gsap.set(items, { opacity: 0, y: 30 });
      ScrollTrigger.batch(items, {
        start: "top 92%",
        onEnter: (batch) =>
          gsap.to(batch, { opacity: 1, y: 0, duration: 1, stagger: 0.08, ease: "power3.out", overwrite: true }),
      });
    },
    { scope: root },
  );
  return <div ref={root}>{children}</div>;
}
