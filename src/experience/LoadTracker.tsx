"use client";

import { useProgress } from "@react-three/drei";
import { useThree } from "@react-three/fiber";
import { useEffect } from "react";
import type * as THREE from "three";
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
    // compile() skips invisible objects, and most chapters start hidden: reveal
    // everything for the synchronous part of the call, then restore
    const hidden: THREE.Object3D[] = [];
    scene.traverse((o) => {
      if (!o.visible) {
        hidden.push(o);
        o.visible = true;
      }
    });
    const job = gl.compileAsync(scene, camera);
    for (const o of hidden) o.visible = false;
    job
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
