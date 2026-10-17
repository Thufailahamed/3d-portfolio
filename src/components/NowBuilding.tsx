"use client";

import { useEffect, useState } from "react";
import { person } from "@/content/site";

const REFRESH_MS = 5 * 60 * 1000;

function ago(at: number) {
  const m = Math.max(1, Math.round((Date.now() - at) / 60000));
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  return h < 48 ? `${h}h ago` : `${Math.round(h / 24)}d ago`;
}

/** "Now building: …" under the Available badge, refreshed every few minutes. */
export default function NowBuilding({ className = "" }: { className?: string }) {
  const [now, setNow] = useState<{ label: string; at: number | null }>({ label: person.now, at: null });

  useEffect(() => {
    let alive = true;
    const load = () =>
      fetch("/api/now")
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => alive && d?.label && setNow(d))
        .catch(() => {});
    load();
    const id = window.setInterval(load, REFRESH_MS);
    return () => {
      alive = false;
      window.clearInterval(id);
    };
  }, []);

  return (
    <span className={`text-[9px] font-mono uppercase tracking-widest text-white/40 whitespace-nowrap ${className}`}>
      Now building: <span className="text-white/70">{now.label}</span>
      {now.at !== null && <span className="text-white/30"> · {ago(now.at)}</span>}
    </span>
  );
}
