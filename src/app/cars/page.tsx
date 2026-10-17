import type { Metadata } from "next";
import { Suspense } from "react";
import CarsView from "@/components/showroom/CarsView";

export const metadata: Metadata = {
  title: "Cars",
  description:
    "Exploded 3D models of the Lykan HyperSport, Jaguar XJ13 and Toyota Land Cruiser 300. Click any part to pull it out and read about it.",
};

// the view reads ?car= and ?part= on the client; the shell prerenders behind this boundary
export default function CarsPage() {
  return (
    <Suspense fallback={<div className="fixed inset-0 bg-bg" />}>
      <CarsView />
    </Suspense>
  );
}
