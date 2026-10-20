import type { Metadata } from "next";
import { Suspense } from "react";
import CrashView from "@/crash/CrashView";

export const metadata: Metadata = {
  title: "Crash lab",
  description:
    "A crash-test lab for the line-up: rigid wall, offset barrier, pole, side barrier or car against car. A crush-zone solver computes the impact; the real models crumple, the glass breaks and a dummy is thrown into its belts, replayed in high-speed slow motion with the crash pulse, Δv, crush and injury measures.",
};

// the view reads the test from the query string on the client; the shell prerenders behind this boundary
export default function CrashPage() {
  return (
    <Suspense fallback={<div className="fixed inset-0 bg-bg" />}>
      <CrashView />
    </Suspense>
  );
}
