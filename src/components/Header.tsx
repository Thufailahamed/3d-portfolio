"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";
import { person } from "@/content/site";
import { landingY, type ChapterId } from "@/lib/chapters";
import { gsap, useGSAP } from "@/lib/gsap";
import { setSound } from "@/lib/sound";
import { useApp } from "@/store/useApp";
import FullExperienceLink from "./FullExperienceLink";
import { lenis } from "./SmoothScroll";

const NAV: { id: ChapterId; label: string; href: string; lite: string }[] = [
  { id: "hero", label: "Home", href: "/", lite: "/lite" },
  { id: "projects", label: "Projects", href: "/projects", lite: "/lite#work" },
  { id: "about", label: "About", href: "/about", lite: "/lite#about" },
  { id: "contact", label: "Contact", href: "/contact", lite: "/lite#contact" },
];
const JOURNEY = new Set(["/", "/projects", "/about", "/contact"]);

/** Persistent chrome: logo, sound, availability, and the full-screen menu. */
export default function Header() {
  const pathname = usePathname();
  const chapter = useApp((s) => s.chapter);
  const lite = useApp((s) => s.lite) || pathname.startsWith("/lite");
  const sound = useApp((s) => s.sound);
  const open = useApp((s) => s.menuOpen);
  const menu = useRef<HTMLDivElement>(null);
  const toggle = useRef<HTMLButtonElement>(null);
  const onJourney = JOURNEY.has(pathname) && !lite;
  const onFlow = pathname === "/flow";
  // on the hero the giant name *is* the logo
  const hideLogo = onJourney && chapter === "hero";

  const close = () => useApp.getState().set({ menuOpen: false });

  useEffect(() => setSound(sound), [sound]);

  // Esc closes; focus moves into the menu and back to the toggle
  useEffect(() => {
    if (!open) return;
    menu.current?.querySelector<HTMLElement>("a")?.focus();
    lenis?.stop();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && close();
    addEventListener("keydown", onKey);
    const btn = toggle.current;
    return () => {
      removeEventListener("keydown", onKey);
      if (useApp.getState().entered || useApp.getState().lite) lenis?.start();
      btn?.focus({ preventScroll: true });
    };
  }, [open]);

  useGSAP(
    () => {
      if (!open) return;
      gsap.fromTo(".menu-item", { yPercent: 100 }, { yPercent: 0, duration: 0.9, stagger: 0.05, ease: "expo.out" });
      gsap.fromTo(".menu-meta", { opacity: 0 }, { opacity: 1, duration: 0.6, delay: 0.3 });
    },
    { scope: menu, dependencies: [open] },
  );

  // within the journey, menu links fly the camera there instead of reloading the page
  const go = (e: React.MouseEvent, item: (typeof NAV)[number]) => {
    close();
    if (!onJourney || e.metaKey || e.ctrlKey) return;
    e.preventDefault();
    const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
    // wait a tick for the menu to release the scroll lock
    requestAnimationFrame(() =>
      lenis?.scrollTo(landingY(item.id), {
        duration: reduce ? 0 : 2.4,
        immediate: reduce,
        easing: (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2),
      }),
    );
  };

  return (
    <>
      {!onFlow && (
        <header className="pointer-events-none fixed inset-x-0 top-0 z-30 flex items-center justify-between px-gutter pt-5">
          <Link
            href={lite ? "/lite" : "/"}
            onClick={(e) => onJourney && go(e, NAV[0])}
            aria-label={`${person.name} — home`}
            className={`display pointer-events-auto text-lg transition-opacity duration-500 md:text-xl ${
              hideLogo ? "opacity-0" : "opacity-100"
            }`}
            tabIndex={hideLogo ? -1 : undefined}
          >
            {person.shortName}
          </Link>

          <div className="pointer-events-auto flex items-center gap-2">
            {person.available && (
              <p className="label hidden items-center gap-2 rounded-full border border-fg/15 px-3 py-2 !text-fg/80 md:flex">
                <span className="relative flex h-1.5 w-1.5">
                  <span className="absolute inset-0 animate-ping rounded-full bg-accent opacity-60" />
                  <span className="relative h-1.5 w-1.5 rounded-full bg-accent" />
                </span>
                Available
              </p>
            )}
            {!lite && (
              <button
                type="button"
                aria-pressed={sound}
                aria-label={sound ? "Turn sound off" : "Turn sound on"}
                onClick={() => useApp.getState().set({ sound: !sound })}
                className="flex h-9 w-9 items-center justify-center gap-[2px] rounded-full border border-fg/15 transition-colors hover:border-fg/50"
              >
                {[0, 1, 2, 3].map((i) => (
                  <span
                    key={i}
                    aria-hidden
                    className={`sound-bar w-[2px] rounded-full bg-fg ${sound ? "is-on" : ""}`}
                    style={{ animationDelay: `${i * 0.13}s` }}
                  />
                ))}
              </button>
            )}
            <button
              ref={toggle}
              type="button"
              aria-expanded={open}
              aria-controls="site-menu"
              aria-label={open ? "Close menu" : "Open menu"}
              onClick={() => useApp.getState().set({ menuOpen: !open })}
              className="label flex h-9 min-w-9 items-center justify-center rounded-full border border-fg/15 px-3 !text-fg transition-colors hover:bg-fg hover:!text-bg"
            >
              {open ? "Close" : "···"}
            </button>
          </div>
        </header>
      )}

      <div
        ref={menu}
        id="site-menu"
        role="dialog"
        aria-modal="true"
        aria-label="Menu"
        className={`fixed inset-0 z-[29] flex flex-col justify-between bg-bg/92 px-gutter pb-8 pt-24 backdrop-blur-md transition-[opacity,visibility] duration-500 ${
          open ? "opacity-100" : "pointer-events-none invisible opacity-0"
        }`}
      >
        <nav aria-label="Main">
          <ol>
            {NAV.map((item, i) => (
              <li key={item.id} className="overflow-hidden">
                <Link
                  href={lite ? item.lite : item.href}
                  onClick={(e) => go(e, item)}
                  className="menu-item group flex items-baseline gap-4 py-1"
                >
                  <span className="label">{String(i + 1).padStart(2, "0")}</span>
                  <span className="display text-[15vw] transition-colors group-hover:text-accent md:text-[7.5vw]">
                    {item.label}
                  </span>
                </Link>
              </li>
            ))}
            {/* a page of its own, not a journey chapter; it needs WebGL so the lite site skips it */}
            {!lite && (
              <li className="overflow-hidden">
                <Link href="/lykan" onClick={close} className="menu-item group flex items-baseline gap-4 py-1">
                  <span className="label">{String(NAV.length + 1).padStart(2, "0")}</span>
                  <span className="display text-[15vw] transition-colors group-hover:text-accent md:text-[7.5vw]">
                    Lykan
                  </span>
                </Link>
              </li>
            )}
          </ol>
        </nav>
        <div className="menu-meta flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
          {lite ? (
            <FullExperienceLink className="label !text-fg hover:!text-accent" />
          ) : (
            <Link
              href="/lite"
              onClick={close}
              className="label !text-fg hover:!text-accent"
            >
              Lite version (no WebGL) ↗
            </Link>
          )}
          <ul className="flex gap-5">
            {person.socials.map((s) => (
              <li key={s.label}>
                <a href={s.href} target="_blank" rel="noreferrer" className="label !text-fg hover:!text-accent">
                  {s.label} ↗
                </a>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </>
  );
}
