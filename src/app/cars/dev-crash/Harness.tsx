"use client";

import dynamic from "next/dynamic";
import { useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import type { Playback } from "@/crash/playback";
import { solve } from "@/crash/solve";
import { scenarioFor } from "@/crash/sim/tests";
import type { TestId, Timeline } from "@/crash/sim/types";
import type { CrashCameraId } from "@/crash/scene/CrashScene";

const CrashScene = dynamic(() => import("@/crash/scene/CrashScene"), { ssr: false });

// TEMPORARY: ?test=wall&a=ferrari-f40&b=…&t=0.05&cam=side&lights=on — window.__pb is the clock
export default function Harness() {
  const q = useSearchParams();
  const [tl, setTl] = useState<Timeline | null>(null);
  const pb = useRef<Playback>({ t: Number(q.get("t") ?? -0.5), speed: 1, playing: false, auto: true });
  useEffect(() => {
    const s = scenarioFor((q.get("test") ?? "wall") as TestId, q.get("a") ?? "ferrari-f40", q.get("b") ?? "toyota-land-cruiser", {});
    solve(s).then((t) => {
      if (!t) return;
      setTl(t);
      (window as unknown as { __tl: Timeline }).__tl = t;
    });
    (window as unknown as { __pb: Playback }).__pb = pb.current;
  }, [q]);
  return (
    <div className="fixed inset-0 bg-black">
      <CrashScene timeline={tl} playback={pb.current} camera={(q.get("cam") ?? "free") as CrashCameraId} lights={(q.get("lights") ?? "on") as "on"} lite={q.get("lite") === "1"} />
      <div id="ready" className="absolute left-2 top-2 font-mono text-xs text-white">{tl ? `solved ${tl.solveMs.toFixed(0)} ms` : "solving"}</div>
    </div>
  );
}
