"use client";

import dynamic from "next/dynamic";
import { usePathname } from "next/navigation";
import { useEffect } from "react";
import { useApp } from "@/store/useApp";
import { lenis } from "./SmoothScroll";

const Experience = dynamic(() => import("@/experience/Experience"), { ssr: false });

export default function GlobalCanvas() {
  const pathname = usePathname();

  // /projects/[slug] swaps the journey for the detail backdrop, /board for the board
  useEffect(() => {
    const m = pathname.match(/^\/projects\/([^/]+)/);
    const onBoard = pathname === "/board";
    useApp.getState().set({ mode: m ? "detail" : onBoard ? "board" : "journey", detailSlug: m ? m[1] : null, boardFocus: null });
    if (m || onBoard) lenis?.scrollTo(0, { immediate: true, force: true });
  }, [pathname]);

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
