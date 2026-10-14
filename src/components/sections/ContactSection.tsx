"use client";

import Link from "next/link";
import { useEffect, useRef } from "react";
import { about, contact, person } from "@/content/site";
import { gsap, SplitText, useGSAP } from "@/lib/gsap";
import { useChapterActive } from "@/hooks/useChapterActive";
import CopyEmail from "../CopyEmail";
import { lenis } from "../SmoothScroll";

const home = about.places[0];

/** Final screen: the arch, years later, the email, and the way back to the start. */
export default function ContactSection() {
  const root = useRef<HTMLElement>(null);
  const clock = useRef<HTMLSpanElement>(null);
  // the end lies past the bottom of the page, so it stays active at the very end
  const active = useChapterActive("contact", 0.3, 1.05);

  useGSAP(
    () => {
      const split = SplitText.create(".contact-heading", { type: "lines", mask: "lines", aria: "auto" });
      if (!active) {
        gsap.set(split.lines, { yPercent: 110 });
        gsap.set(".contact-in", { opacity: 0, y: 12 });
        gsap.set(".contact-rule", { scaleX: 0 });
        return () => split.revert();
      }
      const tl = gsap
        .timeline()
        .to(split.lines, { yPercent: 0, duration: 1.1, stagger: 0.08, ease: "expo.out" })
        .to(".contact-rule", { scaleX: 1, duration: 1.2, ease: "expo.inOut" }, 0.1)
        .to(".contact-in", { opacity: 1, y: 0, duration: 0.8, stagger: 0.05, ease: "power2.out" }, 0.25);
      return () => {
        tl.kill();
        split.revert();
      };
    },
    { scope: root, dependencies: [active] },
  );

  // home's local time
  useEffect(() => {
    const fmt = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: home.tz });
    const update = () => {
      if (clock.current) clock.current.textContent = fmt.format(new Date());
    };
    update();
    const id = setInterval(update, 10000);
    return () => clearInterval(id);
  }, []);

  // all the way back: the journey replays in reverse to the forest
  const toStart = () => {
    if (lenis) lenis.scrollTo(0, { duration: 4.5, easing: (t) => 1 - Math.pow(1 - t, 4) });
    else scrollTo({ top: 0, behavior: "smooth" });
  };

  return (
    <section
      ref={root}
      id="contact"
      aria-labelledby="contact-title"
      className={`fixed inset-0 z-20 flex flex-col justify-end px-gutter pb-6 transition-[opacity,visibility] duration-700 md:pb-8 ${
        active ? "opacity-100" : "pointer-events-none invisible opacity-0"
      }`}
    >
      <div aria-hidden className="contact-shade pointer-events-none absolute inset-0" />

      <div className="relative md:w-[min(54vw,860px)]">
        <div className="contact-in mb-5 flex items-center gap-4">
          <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-accent shadow-[0_0_8px_var(--color-accent)]" />
          <span className="label">
            {contact.label} — {person.available ? "taking new builds" : "booked for now"}
          </span>
          <span aria-hidden className="contact-rule hidden h-px flex-1 origin-left bg-fg/15 md:block" />
        </div>

        <h2 id="contact-title" className="contact-heading display text-[12vw] md:text-[clamp(52px,min(5.2vw,10vh),112px)]">
          {contact.heading}
        </h2>

        <CopyEmail className="contact-in mt-6 font-display text-[6.2vw] font-medium tracking-[-0.03em] md:mt-8 md:text-[clamp(24px,2.3vw,44px)]" />
        <p className="contact-in mt-3 hidden max-w-[46ch] text-sm leading-relaxed text-fg/60 md:block md:text-[15px]">{contact.note}</p>

        <div className="contact-in mt-5 flex gap-2 md:mt-8 md:gap-2.5">
          <a href={`mailto:${person.email}`} className="contact-btn contact-btn--solid" data-cursor="view">
            Write to me <span aria-hidden>↗</span>
          </a>
          <button type="button" onClick={toStart} className="contact-btn">
            Back to the forest <span aria-hidden>↑</span>
          </button>
        </div>

        <dl className="contact-in mt-7 hidden grid-cols-3 gap-4 border-t border-fg/10 pt-4 md:mt-10 md:grid md:max-w-[560px]">
          <div>
            <dt className="label !text-[10px]">Based in</dt>
            <dd className="mt-1 text-[12px] text-fg/90 md:text-[13px]">{person.location}</dd>
          </div>
          <div>
            <dt className="label !text-[10px]">Local time</dt>
            <dd className="mt-1 text-[12px] tabular-nums text-fg/90 md:text-[13px]">
              <span ref={clock}>--:--</span> · GMT+5:30
            </dd>
          </div>
          <div>
            <dt className="label !text-[10px]">Studio</dt>
            <dd className="mt-1 text-[12px] text-fg/90 md:text-[13px]">SynapX</dd>
          </div>
        </dl>
      </div>

      <footer className="contact-in relative mt-7 flex flex-col gap-3 border-t border-fg/10 pt-4 md:mt-10 md:flex-row md:items-center md:justify-between">
        <ul className="flex gap-5" aria-label="Elsewhere">
          {person.socials.map((s) => (
            <li key={s.label}>
              <a href={s.href} target="_blank" rel="noreferrer" className="label !text-fg hover:!text-accent">
                {s.label} ↗
              </a>
            </li>
          ))}
        </ul>
        <p className="label">
          © {contact.year} {person.name} · {contact.footer} ·{" "}
          <Link href="/lite" className="!text-fg underline underline-offset-4 hover:!text-accent">
            Lite version
          </Link>
        </p>
      </footer>
    </section>
  );
}
