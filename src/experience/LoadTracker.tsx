"use client";

import { useProgress } from "@react-three/drei";
import { useThree } from "@react-three/fiber";
import { useEffect } from "react";
import { useApp } from "@/store/useApp";

/** Mirrors three's loading manager into the app store (lives outside Suspense). */
export function LoadProgress() {
  const progress = useProgress((s) => s.progress);
  useEffect(() => {
    useApp.getState().set({ loadProgress: progress / 100 });
  }, [progress]);
  return null;
}

/**
 * Mounted as the last child inside <Suspense>, so it only runs once every asset
 * has resolved. Precompiles all shader programs so the first scroll doesn't hitch.
 */
export function CompileGate() {
  const { gl, scene, camera } = useThree();
  useEffect(() => {
    let cancelled = false;
    gl.compileAsync(scene, camera)
      .catch(() => undefined)
      .then(() => {
        if (!cancelled) useApp.getState().set({ loadProgress: 1, ready: true });
      });
    return () => {
      cancelled = true;
    };
  }, [gl, scene, camera]);
  return null;
}
