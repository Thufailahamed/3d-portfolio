"use client";

import { useSearchParams } from "next/navigation";
import CarsNav from "@/components/showroom/CarsNav";

/** /cars/compare (placeholder until the comparison is built). */
export default function CompareView() {
  const params = useSearchParams();
  return (
    <div className="fixed inset-0 grid place-items-center bg-bg">
      <CarsNav current="compare" a={params.get("a") ?? undefined} b={params.get("b") ?? undefined} />
      <p className="label">Compare</p>
    </div>
  );
}
