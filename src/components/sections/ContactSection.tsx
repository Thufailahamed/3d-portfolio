"use client";

import Link from "next/link";
import { useRef } from "react";
import { contact, person } from "@/content/site";
import { gsap, SplitText, useGSAP } from "@/lib/gsap";
import { useChapterActive } from "@/hooks/useChapterActive";
import CopyEmail from "../CopyEmail";

/** Final screen: the shard in its beam, the email, and the footer. */
export default function ContactSection() {
  const root = useRef<HTMLElement>(null);
  // the end lies past the bottom of the page, so it stays active at the very end
  const active = useChapterActive("contact", 0.3, 1.05);

  useGSAP(
    () => {
      const split = SplitText.create(".contact-heading", { type: "lines", mask: "lines", aria: "auto" });
      if (!active) {
        gsap.set(split.lines, { yPercent: 110 });
        gsap.set(".contact-in", { opacity: 0, y: 12 });
        return () => split.revert();
      }
      const tl = gsap
        .timeline()
        .to(split.lines, { yPercent: 0, duration: 1.1, stagger: 0.08, ease: "expo.out" })
        .to(".contact-in", { opacity: 1, y: 0, duration: 0.8, stagger: 0.06, ease: "power2.out" }, 0.25);
      return () => {
        tl.kill();
        split.revert();
      };
    },
    { scope: root, dependencies: [active] },
  );

  return (
    <section
      ref={root}
      id="contact"
      aria-labelledby="contact-title"
      className={`fixed inset-0 z-20 flex flex-col justify-end px-gutter pb-6 transition-[opacity,visibility] duration-700 md:pb-8 ${
        active ? "opacity-100" : "pointer-events-none invisible opacity-0"
      }`}
    >
      <div className="max-w-[min(56rem,92vw)]">
        <p className="contact-in label mb-4">
          <span className="text-accent">●</span> {contact.label}
        </p>
        <h2 id="contact-title" className="contact-heading display text-[11.5vw] md:text-[5.6vw]">
          {contact.heading}
        </h2>
        <CopyEmail className="contact-in mt-6 font-display text-[6.4vw] font-medium tracking-[-0.03em] md:mt-8 md:text-[2.6vw]" />
        <p className="contact-in mt-3 max-w-[44ch] text-sm text-fg/60 md:text-base">
          {contact.note}{" "}
          <a href={`mailto:${person.email}`} className="text-fg underline decoration-fg/30 underline-offset-4 hover:text-accent">
            Open mail app
          </a>
        </p>
      </div>

      <footer className="contact-in mt-8 flex flex-col gap-3 border-t border-fg/10 pt-4 md:mt-12 md:flex-row md:items-center md:justify-between">
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
