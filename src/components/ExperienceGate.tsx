"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect } from "react";
import { useApp } from "@/store/useApp";
import GlobalCanvas from "./GlobalCanvas";
import Loader from "./Loader";
import PerfBanner from "./PerfBanner";
import SizeGate from "./SizeGate";
import { isLanding } from "./landing/routes";
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
    // the home page offers the choice again on every visit, so a lite pick only sticks elsewhere
    const pickedLite = chosen === "lite" && pathname !== "/";
    const want =
      onLitePath ||
      pickedLite ||
      (chosen !== "full" && (!hasWebGL2() || matchMedia("(prefers-reduced-motion: reduce)").matches));
    useApp.getState().set({ lite: want });
    if (want && pathname in LITE_HASH) router.replace(`/lite${LITE_HASH[pathname]}`);
  }, [pathname, onLitePath, router]);

  const onLanding = isLanding(pathname);

  // the journey locks scrolling until "Enter"; the lite site and the product landing pages never do
  useEffect(() => {
    if (lite || onLitePath || onLanding) lenis?.start();
    else if (!useApp.getState().entered) lenis?.stop();
  }, [lite, onLitePath, onLanding]);

  // the car showrooms, the brick world and the other playground pieces bring their own canvas; the journey must not render underneath them
  if (lite || onLitePath || pathname.startsWith("/lykan") || pathname.startsWith("/cars") || pathname.startsWith("/lego") || pathname.startsWith("/hotwheels") || pathname.startsWith("/rover") || pathname.startsWith("/diffusion") || pathname.startsWith("/voice") || onLanding) return null;
  return (
    <>
      <Loader />
      <GlobalCanvas />
      <PerfBanner />
      <SizeGate />
    </>
  );
}
