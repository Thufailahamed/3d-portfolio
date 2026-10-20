"use client";

import { useSearchParams } from "next/navigation";
import CarsNav from "@/components/showroom/CarsNav";

/** /cars/crash (placeholder until the lab is built). */
export default function CrashView() {
  const params = useSearchParams();
  return (
    <div className="fixed inset-0 grid place-items-center bg-bg">
      <CarsNav current="crash" a={params.get("a") ?? undefined} b={params.get("b") ?? undefined} />
      <p className="label">Crash lab</p>
    </div>
  );
}
