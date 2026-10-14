"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

/** Extreme window shapes break the framing — say so instead of showing a broken scene. */
export default function SizeGate() {
  const [bad, setBad] = useState(false);
  useEffect(() => {
    const check = () => {
      const w = innerWidth;
      const h = innerHeight;
      setBad(w / h > 2.8 || (w >= 768 && h < 400) || w < 280);
    };
    check();
    addEventListener("resize", check);
    return () => removeEventListener("resize", check);
  }, []);
  if (!bad) return null;
  return (
    <div role="alertdialog" aria-label="Window size not supported" className="fixed inset-0 z-[45] flex flex-col items-center justify-center gap-5 bg-bg px-gutter text-center">
      <p className="display text-4xl md:text-6xl">Window size not supported</p>
      <p className="max-w-[40ch] text-fg/70">Resize your window to a more usual shape to continue, or read the lighter version.</p>
      <Link href="/lite" className="hud-btn">
        Switch to lite version
      </Link>
    </div>
  );
}
