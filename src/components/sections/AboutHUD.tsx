"use client";

import { useEffect, useRef } from "react";
import { about, person } from "@/content/site";
import { gsap, SplitText, useGSAP } from "@/lib/gsap";
import { useChapterActive } from "@/hooks/useChapterActive";

const pad = (n: number) => String(n).padStart(2, "0");
const home = about.places[0];

/**
 * About copy beside the globe: headline, story, what I do and the studio facts,
 * plus a live local-time readout for home in the corner.
 */
export default function AboutHUD() {
  const root = useRef<HTMLElement>(null);
  const clock = useRef<HTMLSpanElement>(null);
  const active = useChapterActive("about", 0.52, 0.94);

  // reveal once the globe has formed
  useGSAP(
    () => {
      const split = SplitText.create(".about-headline", { type: "lines", mask: "lines", aria: "auto" });
      if (!active) {
        gsap.set(split.lines, { yPercent: 110 });
        gsap.set(".about-in", { opacity: 0, y: 14 });
        gsap.set(".about-rule", { scaleX: 0 });
        return () => split.revert();
      }
      const tl = gsap.timeline();
      tl.to(split.lines, { yPercent: 0, duration: 1.1, stagger: 0.08, ease: "expo.out" })
        .to(".about-rule", { scaleX: 1, duration: 1.2, stagger: 0.05, ease: "expo.inOut" }, 0.1)
        .to(".about-in", { opacity: 1, y: 0, duration: 0.8, stagger: 0.05, ease: "power2.out" }, 0.25);
      return () => {
        tl.kill();
        split.revert();
      };
    },
    { scope: root, dependencies: [active] },
  );

  // home's local time, ticking
  useEffect(() => {
    const fmt = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false, timeZone: home.tz });
    const update = () => {
      if (clock.current) clock.current.textContent = fmt.format(new Date());
    };
    update();
    const id = setInterval(update, 1000);
    return () => clearInterval(id);
  }, []);

  return (
    <section
      ref={root}
      aria-labelledby="about-title"
      className={`fixed inset-0 z-20 transition-[opacity,visibility] duration-700 ${
        active ? "opacity-100" : "pointer-events-none invisible opacity-0"
      }`}
    >
      {/* a soft shade behind the copy, so it reads over the stars and strands */}
      <div aria-hidden className="about-shade pointer-events-none absolute inset-0" />

      <div className="absolute inset-x-0 bottom-0 px-gutter pb-7 md:bottom-auto md:top-1/2 md:w-[min(44vw,640px)] md:-translate-y-[46%] md:pb-0 md:pr-0">
        <div className="about-in mb-5 flex items-center gap-4 md:mb-7">
          <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-accent shadow-[0_0_8px_var(--color-accent)]" />
          <span className="label">About — How I work</span>
          <span aria-hidden className="about-rule h-px flex-1 origin-left bg-fg/15" />
        </div>

        <h2 id="about-title" className="about-headline display text-[12vw] md:text-[clamp(44px,min(5.1vw,9.5vh),96px)]">
          {about.headline}
        </h2>

        <div className="mt-5 max-w-[48ch] space-y-3 text-[15px] leading-relaxed text-fg/70 md:mt-7 md:text-[16px] 2xl:text-[17px]">
          {about.body.map((p, i) => (
            <p key={i} className={`about-in ${i === 0 ? "text-fg/90" : "hidden md:block md:[@media(max-height:780px)]:hidden"}`}>
              {p}
            </p>
          ))}
        </div>

        {/* what I do */}
        <ul className="mt-6 grid grid-cols-2 md:mt-8" aria-label="Services">
          {about.services.map((s, i) => (
            <li key={s} className="about-in about-service">
              <span className="label tabular-nums !text-accent">{pad(i + 1)}</span>
              <span className="text-[13px] md:text-[15px]">{s}</span>
            </li>
          ))}
        </ul>

        {/* the studio, in four facts */}
        <dl className="mt-5 grid grid-cols-2 gap-x-6 gap-y-4 md:mt-8 xl:grid-cols-4">
          {about.annotations.map((n) => (
            <div key={n.label} className="about-in">
              <dt className="label !text-[10px]">{n.label}</dt>
              <dd className="mt-1 text-[12px] leading-snug text-fg/90 md:text-[13px]">{n.value}</dd>
            </div>
          ))}
        </dl>
      </div>

      {/* home, live */}
      <div className="about-in absolute bottom-8 right-gutter hidden text-right md:block" aria-label={`Local time in ${home.city}`}>
        <p className="label flex items-center justify-end gap-2">
          <span aria-hidden className="inline-block h-1.5 w-1.5 rounded-full bg-accent shadow-[0_0_8px_var(--color-accent)]" />
          Local time · {home.city}
        </p>
        <p className="mt-1 font-mono text-[28px] font-light tabular-nums tracking-tight text-fg">
          <span ref={clock}>--:--:--</span>
        </p>
        <p className="label mt-1">
          {home.lat.toFixed(2)}° N · {home.lon.toFixed(2)}° E — {person.available ? "taking new builds" : "booked"}
        </p>
      </div>
    </section>
  );
}
