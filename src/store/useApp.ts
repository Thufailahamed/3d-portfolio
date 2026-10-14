import { create } from "zustand";
import type { ChapterId } from "@/lib/chapters";

type Quality = "high" | "low";

type AppState = {
  quality: Quality;
  isMobile: boolean;
  chapter: ChapterId;
  /** 0..1 real asset-loading progress (THREE.DefaultLoadingManager) */
  loadProgress: number;
  /** assets loaded and shaders compiled */
  ready: boolean;
  /** visitor clicked Enter */
  entered: boolean;
  set: (s: Partial<Omit<AppState, "set">>) => void;
};

export const useApp = create<AppState>((set) => ({
  quality: "high",
  isMobile: false,
  chapter: "hero",
  loadProgress: 0,
  ready: false,
  entered: false,
  set: (s) => set(s),
}));
