import type { Metadata } from "next";
import { Suspense } from "react";
import Showroom from "@/components/showroom/Showroom";
import { carBySlug } from "@/content/cars";

export const metadata: Metadata = {
  title: "Lykan HyperSport",
  description: "An exploded 3D model of the W Motors Lykan HyperSport. Click any part to pull it out and read about it.",
};

// the view reads ?part= on the client; the shell prerenders behind this boundary
export default function LykanPage() {
  return (
    <Suspense fallback={<div className="fixed inset-0 bg-bg" />}>
      <Showroom car={carBySlug["lykan-hypersport"]} />
    </Suspense>
  );
}
