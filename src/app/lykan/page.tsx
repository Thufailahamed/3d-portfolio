import type { Metadata } from "next";
import { Suspense } from "react";
import LykanView from "@/components/lykan/LykanView";

export const metadata: Metadata = {
  title: "Lykan HyperSport",
  description: "An exploded 3D model of the W Motors Lykan HyperSport. Click any part to pull it out and read about it.",
};

// the view reads ?part= on the client; the shell prerenders behind this boundary
export default function LykanPage() {
  return (
    <Suspense fallback={<div className="fixed inset-0 bg-bg" />}>
      <LykanView />
    </Suspense>
  );
}
