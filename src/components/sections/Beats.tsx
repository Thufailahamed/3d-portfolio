"use client";

import { useRef } from "react";
import { chapterScroll, type ChapterId } from "@/lib/chapters";
import { gsap, SplitText, useGSAP } from "@/lib/gsap";

type Props = {
  chapter: ChapterId;
  label: string;
  lines: string[];
  /** fraction of the chapter where the beats play (start, end) */
  window?: [number, number];
  variant?: "large" | "label";
};

/**
 * Story beats pinned over a chapter. Each line reveals word by word and leaves
 * before the next arrives — all scrubbed, so it reverses exactly on scroll-up.
 */
export default function Beats({ chapter, label, lines, window = [0.05, 0.95], variant = "large" }: Props) {
  const root = useRef<HTMLElement>(null);

  useGSAP(
    () => {
      const mm = gsap.matchMedia();
      mm.add(
        // `all` guarantees the callback runs; the others just pick the variant
        { all: "all", desktop: "(min-width: 768px)", reduce: "(prefers-reduced-motion: reduce)" },
        (ctx) => {
          const { desktop, reduce } = ctx.conditions as { desktop: boolean; reduce: boolean };
          const els = gsap.utils.toArray<HTMLElement>(".beat", root.current);
          const splits = els.map((el) => SplitText.create(el, { type: "words", aria: "auto" }));

          const tl = gsap.timeline({
            defaults: { ease: "none" },
            scrollTrigger: { ...chapterScroll(chapter), scrub: true },
          });

          const [a, b] = window;
          tl.to({}, { duration: a * 10 });
          const per = ((b - a) * 10) / els.length;

          splits.forEach((split, i) => {
            const at = a * 10 + i * per;
            // desktop: words rise out of a blur; mobile: a cheaper rise + fade
            const from = desktop && !reduce
              ? { opacity: 0, yPercent: 60, filter: "blur(10px)" }
              : { opacity: 0, yPercent: reduce ? 0 : 40 };
            tl.set(els[i], { autoAlpha: 1 }, at);
            tl.fromTo(
              split.words,
              from,
              { opacity: 1, yPercent: 0, filter: "blur(0px)", stagger: per * 0.05, duration: per * 0.35 },
              at,
            );
            tl.to(
              split.words,
              { opacity: 0, yPercent: -40, stagger: per * 0.03, duration: per * 0.25 },
              at + per * 0.72,
            );
            tl.set(els[i], { autoAlpha: 0 }, at + per);
          });
          tl.to({}, { duration: (1 - b) * 10 });

          return () => splits.forEach((s) => s.revert());
        },
      );
    },
    { scope: root },
  );

  return (
    <section
      ref={root}
      aria-label={label}
      className="pointer-events-none fixed inset-x-0 top-0 z-10 flex h-svh items-end justify-center px-gutter pb-[18svh] md:items-center md:pb-0"
    >
      <div className="relative w-full">
        {lines.map((line, i) => (
          <p
            key={i}
            className={`beat invisible absolute inset-x-0 mx-auto text-center ${
              variant === "large"
                ? "max-w-[16ch] text-balance font-display text-[9vw] font-medium leading-[0.95] tracking-[-0.035em] md:max-w-[22ch] md:text-[4.6vw]"
                : "label !text-fg w-fit rounded-full bg-bg/70 px-4 py-2 backdrop-blur-sm"
            }`}
            style={{ top: "50%", transform: "translateY(-50%)" }}
          >
            {line}
          </p>
        ))}
      </div>
    </section>
  );
}
