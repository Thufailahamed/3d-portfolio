"use client";

import { useState } from "react";
import { chapterScroll, type ChapterId } from "@/lib/chapters";
import { ScrollTrigger, useGSAP } from "@/lib/gsap";

/** True while the journey is inside [from, to] of a chapter (frame-locked to the 3D). */
export function useChapterActive(id: ChapterId, from: number, to: number) {
  const [active, setActive] = useState(false);
  useGSAP(() => {
    const st = ScrollTrigger.create({
      ...chapterScroll(id, from, to),
      onToggle: (self) => setActive(self.isActive),
    });
    return () => st.kill();
  });
  return active;
}
