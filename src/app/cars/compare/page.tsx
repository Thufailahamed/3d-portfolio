import type { Metadata } from "next";
import { Suspense } from "react";
import CompareView from "@/compare/CompareView";

export const metadata: Metadata = {
  title: "Compare cars",
  description:
    "Two cars of the line-up side by side at true scale: a ghost overlay and blueprint elevations, a sourced spec sheet, a physics model of 0–100, the quarter mile and top speed, and a drag race on an airfield runway.",
};

// the view reads ?a= and ?b= on the client; the shell prerenders behind this boundary
export default function ComparePage() {
  return (
    <Suspense fallback={<div className="fixed inset-0 bg-bg" />}>
      <CompareView />
    </Suspense>
  );
}
