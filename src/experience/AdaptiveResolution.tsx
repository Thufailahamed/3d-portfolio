"use client";

import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useRef } from "react";

const STEP = 0.25;
const LOW_FPS = 48;
const HIGH_FPS = 57;

/**
 * Keeps the frame rate up by trading resolution: measures fps once a second, drops the
 * pixel ratio a step when frames are slow, and raises it again after a few smooth seconds.
 * `max` is the best this device/quality level is allowed (never above the screen's own).
 */
export default function AdaptiveResolution({ max }: { max: number }) {
  const setDpr = useThree((s) => s.setDpr);
  const s = useRef({ dpr: 1, acc: 0, frames: 0, good: 0 });

  useEffect(() => {
    const top = Math.max(1, Math.min(window.devicePixelRatio || 1, max));
    s.current.dpr = top;
    setDpr(top);
  }, [max, setDpr]);

  useFrame((_, dt) => {
    const st = s.current;
    st.acc += dt;
    st.frames++;
    if (st.acc < 1) return;
    const fps = st.frames / st.acc;
    st.acc = 0;
    st.frames = 0;
    if (document.hidden) return;
    const top = Math.max(1, Math.min(window.devicePixelRatio || 1, max));
    if (fps < LOW_FPS && st.dpr > 1) {
      st.dpr = Math.max(1, st.dpr - STEP);
      st.good = 0;
      setDpr(st.dpr);
    } else if (fps > HIGH_FPS && st.dpr < top) {
      // be slow to climb back so it doesn't see-saw
      if (++st.good >= 4) {
        st.dpr = Math.min(top, st.dpr + STEP);
        st.good = 0;
        setDpr(st.dpr);
      }
    } else {
      st.good = 0;
    }
  });

  return null;
}
