"use client";

import dynamic from "next/dynamic";
import { useEffect } from "react";
import { useApp } from "@/store/useApp";

const Experience = dynamic(() => import("@/experience/Experience"), { ssr: false });

export default function GlobalCanvas() {
  useEffect(() => {
    const mq = matchMedia("(max-width: 767px), (pointer: coarse)");
    const sync = () => useApp.getState().set({ isMobile: mq.matches });
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);

  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 z-0">
      <Experience />
    </div>
  );
}
