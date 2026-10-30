"use client";

import { useEffect, useRef } from "react";

/** A city's local HH:MM, ticking. Renders a placeholder on the server so hydration matches. */
export default function LocalTime({ tz, className = "" }: { tz: string; className?: string }) {
  const el = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const fmt = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: tz });
    const update = () => {
      if (el.current) el.current.textContent = fmt.format(new Date());
    };
    update();
    const id = setInterval(update, 10_000);
    return () => clearInterval(id);
  }, [tz]);
  return (
    <span ref={el} className={`tabular-nums ${className}`}>
      --:--
    </span>
  );
}
