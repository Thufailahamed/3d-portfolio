"use client";

import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useRef } from "react";

const STEP = 0.25;
const LOW_FPS = 38;
const HIGH_FPS = 58;

/**
 * Keeps the frame rate up by trading resolution without thrashing framebuffers.
 */
export default function AdaptiveResolution({ max }: { max: number }) {
  const setDpr = useThree((s) => s.setDpr);
  const s = useRef({ dpr: 1, acc: 0, frames: 0, good: 0, bad: 0 });

  useEffect(() => {
    const top = Math.max(1, Math.min(window.devicePixelRatio || 1, max));
    s.current.dpr = top;
    setDpr(top);
  }, [max, setDpr]);

  useFrame((_, dt) => {
    const st = s.current;
    st.acc += dt;
    st.frames++;
    if (st.acc < 1.5) return;
    const fps = st.frames / st.acc;
    st.acc = 0;
    st.frames = 0;
    if (document.hidden) return;
    const top = Math.max(1, Math.min(window.devicePixelRatio || 1, max));
    if (fps < LOW_FPS && st.dpr > 1) {
      if (++st.bad >= 2) {
        st.dpr = Math.max(1, st.dpr - STEP);
        st.bad = 0;
        st.good = 0;
        setDpr(st.dpr);
      }
    } else if (fps > HIGH_FPS && st.dpr < top) {
      st.bad = 0;
      // be very slow to climb back to avoid see-sawing framebuffer resizes
      if (++st.good >= 8) {
        st.dpr = Math.min(top, st.dpr + STEP);
        st.good = 0;
        setDpr(st.dpr);
      }
    } else {
      st.bad = 0;
      st.good = 0;
    }
  });

  return null;
}
