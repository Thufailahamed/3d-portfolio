import { create } from "zustand";
import type { ChapterId } from "@/lib/chapters";

type Quality = "high" | "low";

type AppState = {
  quality: Quality;
  isMobile: boolean;
  chapter: ChapterId;
  set: (s: Partial<Omit<AppState, "set">>) => void;
};

export const useApp = create<AppState>((set) => ({
  quality: "high",
  isMobile: false,
  chapter: "hero",
  set: (s) => set(s),
}));
