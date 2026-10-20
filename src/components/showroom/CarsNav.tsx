"use client";

import Link from "next/link";
import type { ReactNode } from "react";

export type CarsMode = "showroom" | "compare" | "crash";

const Svg = ({ children }: { children: ReactNode }) => (
  <svg aria-hidden width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    {children}
  </svg>
);

const icons: Record<CarsMode, ReactNode> = {
  // a car on its turntable
  showroom: (
    <Svg>
      <path d="M5 13.5v-2l1.6-3.2c.3-.6.9-1 1.6-1h7.6c.7 0 1.3.4 1.6 1l1.6 3.2v2" />
      <path d="M4.5 13.5h15v1.8H4.5z" />
      <ellipse cx="12" cy="19" rx="9" ry="2.2" />
    </Svg>
  ),
  // two cars, one taller than the other
  compare: (
    <Svg>
      <path d="M3 17V9.5l1.4-2.8c.2-.4.6-.7 1.1-.7h3c.5 0 .9.3 1.1.7L11 9.5V17" />
      <path d="M13 17v-5l1.2-2.4c.2-.4.6-.6 1-.6h3.6c.4 0 .8.2 1 .6L21 12v5" />
      <path d="M2 17h20" />
    </Svg>
  ),
  // a car nose-first into a wall, with the impact star
  crash: (
    <Svg>
      <path d="M20 4v16" />
      <path d="M3 15.5v-2.2l1.7-3.3c.3-.6.9-1 1.6-1h5.4c.7 0 1.3.4 1.6 1l1.2 2.4" />
      <path d="M3 15.5h12.6" />
      <path d="M16.5 8.5l1.4 1.6 1.8-.9-.6 1.9 1.4 1.4" />
    </Svg>
  ),
};

const LABEL: Record<CarsMode, string> = { showroom: "Showroom", compare: "Compare", crash: "Crash lab" };

/**
 * The /cars section's switch between the showroom, the comparison and the crash lab, top centre
 * (icons only on phones, where it sits between the logo and the menu). It carries the cars across:
 * the showroom's car becomes car A of the other two, and A and B travel between compare and crash.
 */
export default function CarsNav({ current, a, b, className = "" }: { current: CarsMode; a?: string; b?: string; className?: string }) {
  const q = (o: Record<string, string | undefined>) => {
    const s = new URLSearchParams();
    for (const [k, v] of Object.entries(o)) if (v) s.set(k, v);
    const str = s.toString();
    return str ? `?${str}` : "";
  };
  const href: Record<CarsMode, string> = {
    showroom: `/cars${q({ car: a })}`,
    compare: `/cars/compare${q({ a, b })}`,
    crash: `/cars/crash${q({ a, b })}`,
  };
  return (
    <nav
      aria-label="Cars section"
      // phones: beside the header's sound and menu buttons, clear of the logo; wider screens: centred
      className={`pointer-events-auto fixed right-[calc(var(--spacing-gutter)+6.4rem)] top-5 z-30 md:left-1/2 md:right-auto md:-translate-x-1/2 ${className}`}
    >
      <ul className="flex gap-0.5 rounded-full border border-fg/12 bg-[#121214]/70 p-1 shadow-[0_20px_50px_-20px_rgba(0,0,0,0.9)] backdrop-blur-xl">
        {(["showroom", "compare", "crash"] as const).map((m) => {
          const on = m === current;
          return (
            <li key={m}>
              <Link
                href={href[m]}
                aria-current={on ? "page" : undefined}
                aria-label={LABEL[m]}
                title={LABEL[m]}
                className={`flex h-7 items-center gap-2 rounded-full px-2 text-[13px] font-medium transition-colors duration-300 md:px-3.5 ${
                  on ? "bg-fg text-bg" : "text-fg/60 hover:bg-fg/8 hover:text-fg"
                }`}
              >
                {icons[m]}
                <span className="hidden md:inline">{LABEL[m]}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
