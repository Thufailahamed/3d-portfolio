"use client";

import { useEffect, useRef, useState } from "react";
import FullExperienceLink from "@/components/FullExperienceLink";
import { lenis } from "@/components/SmoothScroll";
import { about, person } from "@/content/site";
import { Mark } from "./art";
import LocalTime from "./LocalTime";

const NAV = [
  { label: "Index", href: "#top" },
  { label: "Work", href: "#work" },
  { label: "Contact", href: "#contact" },
];

/**
 * The paper edition's own chrome. It tucks away on the way down, returns on the way up,
 * and PaperMotion flips each side between paper and night via data-left / data-right.
 */
export default function PaperHeader() {
  const [open, setOpen] = useState(false);
  const bar = useRef<HTMLElement>(null);
  const burger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLElement>(null);

  // stuck past the top, tucked while scrolling down
  useEffect(() => {
    let last = scrollY;
    const onScroll = () => {
      const y = scrollY;
      const el = bar.current;
      if (!el) return;
      el.classList.toggle("is-stuck", y > 24);
      if (Math.abs(y - last) > 6) {
        el.classList.toggle("is-tucked", y > last && y > innerHeight * 0.6);
        last = y;
      }
    };
    onScroll();
    addEventListener("scroll", onScroll, { passive: true });
    return () => removeEventListener("scroll", onScroll);
  }, []);

  // the menu holds the page still, closes on Esc and hands focus back
  useEffect(() => {
    if (!open) return;
    lenis?.stop();
    menu.current?.querySelector<HTMLElement>("a")?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    addEventListener("keydown", onKey);
    const btn = burger.current;
    return () => {
      removeEventListener("keydown", onKey);
      lenis?.start();
      btn?.focus({ preventScroll: true });
    };
  }, [open]);

  return (
    <>
      <header ref={bar} className="p-head" data-paper-header data-left="paper" data-right="night">
        <div className="p-head__inner">
          <a className="p-brand" href="#top" aria-label={`${person.name} — top of page`}>
            <Mark />
            <span className="p-brand__word">
              {person.shortName.split(" ")[0]}
              <span className="text-thin">{person.shortName.split(" ").slice(1).join(" ").toLowerCase()}</span>
            </span>
          </a>
          <nav className="p-head__nav" aria-label="Main">
            <ul>
              {NAV.map((n) => (
                <li key={n.href}>
                  <a className="p-navlink p-mono" href={n.href}>
                    {n.label}
                  </a>
                </li>
              ))}
              <li>
                <FullExperienceLink className="p-navlink p-mono">3D version</FullExperienceLink>
              </li>
            </ul>
          </nav>
          <p className="p-head__meta p-mono">
            <i className="p-status" aria-hidden />
            <span>{about.places[0].city}</span>
            <LocalTime tz={about.places[0].tz} />
          </p>
          <button
            ref={burger}
            type="button"
            className={`p-burger ${open ? "is-open" : ""}`}
            aria-label={open ? "Close menu" : "Open menu"}
            aria-expanded={open}
            aria-controls="paper-menu"
            onClick={() => setOpen((o) => !o)}
          >
            <span />
            <span />
          </button>
        </div>
      </header>

      <nav
        ref={menu}
        id="paper-menu"
        className={`p-menu ${open ? "is-open" : ""}`}
        data-tone="paper"
        aria-label="Menu"
        aria-hidden={!open}
        inert={!open}
      >
        <ol className="p-menu__list">
          {NAV.map((n, i) => (
            <li key={n.href}>
              <a className="p-display" href={n.href} onClick={() => setOpen(false)}>
                <span className="p-mono p-dim">{String(i + 1).padStart(2, "0")}</span>
                {n.label}
              </a>
            </li>
          ))}
        </ol>
        <div className="p-menu__foot">
          <a className="p-mono" href={`mailto:${person.email}`}>
            {person.email}
          </a>
          {person.socials.map((s) => (
            <a key={s.label} className="p-mono" href={s.href} target="_blank" rel="noreferrer">
              {s.label}
            </a>
          ))}
          <FullExperienceLink className="p-mono" />
        </div>
      </nav>
    </>
  );
}
