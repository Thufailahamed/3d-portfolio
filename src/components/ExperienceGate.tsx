"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect } from "react";
import { useApp } from "@/store/useApp";
import GlobalCanvas from "./GlobalCanvas";
import Loader from "./Loader";
import PerfBanner from "./PerfBanner";
import SizeGate from "./SizeGate";
import { lenis } from "./SmoothScroll";

const LITE_HASH: Record<string, string> = { "/": "", "/projects": "#work", "/about": "#about", "/contact": "#contact", "/board": "#work" };

const hasWebGL2 = () => {
  try {
    return !!document.createElement("canvas").getContext("webgl2");
  } catch {
    return false;
  }
};

/**
 * Decides between the WebGL journey and the DOM-only lite site.
 * Lite when: on /lite, chosen earlier this session, no WebGL2, or reduced motion
 * (unless the visitor explicitly asked for the full experience).
 */
export default function ExperienceGate() {
  const pathname = usePathname();
  const router = useRouter();
  const lite = useApp((s) => s.lite);
  const onLitePath = pathname.startsWith("/lite");

  useEffect(() => {
    const chosen = sessionStorage.getItem("mode");
    if (onLitePath) sessionStorage.setItem("mode", "lite");
    const want =
      onLitePath ||
      chosen === "lite" ||
      (chosen !== "full" && (!hasWebGL2() || matchMedia("(prefers-reduced-motion: reduce)").matches));
    useApp.getState().set({ lite: want });
    if (want && pathname in LITE_HASH) router.replace(`/lite${LITE_HASH[pathname]}`);
  }, [pathname, onLitePath, router]);

  // the journey locks scrolling until "Enter"; the lite site never does
  useEffect(() => {
    if (lite || onLitePath) lenis?.start();
    else if (!useApp.getState().entered) lenis?.stop();
  }, [lite, onLitePath]);

  if (lite || onLitePath) return null;
  return (
    <>
      <Loader />
      <GlobalCanvas />
      <PerfBanner />
      <SizeGate />
    </>
  );
}
