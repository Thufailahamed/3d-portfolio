import { create } from "zustand";
import type { ChapterId } from "@/lib/chapters";

type Quality = "high" | "low";
export type Weather = "night" | "rain" | "day";

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
  /** index into projects[] shown in the carousel */
  activeProject: number;
  /** "journey" on the home routes, "detail" on /projects/[slug], "board" on /board, "flow" on /flow */
  mode: "journey" | "detail" | "board" | "flow";
  /** the card opened on the board (index into projects[]) */
  boardFocus: number | null;
  /** currently focused project showcase in the 3D flow pavilion (index into projects[]) */
  flowFocus: number | null;
  flowView: "exterior" | "hall" | "showcase";
  detailSlug: string | null;
  /** DOM-only experience (no WebGL) */
  lite: boolean;
  sound: boolean;
  /** the forest's sky: the original night, a storm, or daylight */
  weather: Weather;
  menuOpen: boolean;
  toast: string | null;
  set: (s: Partial<Omit<AppState, "set">>) => void;
};

export const useApp = create<AppState>((set) => ({
  quality: "high",
  isMobile: false,
  chapter: "hero",
  loadProgress: 0,
  ready: false,
  entered: false,
  activeProject: 0,
  mode: "journey",
  detailSlug: null,
  boardFocus: null,
  flowFocus: null,
  flowView: "exterior",
  lite: false,
  sound: false,
  weather: "night",
  menuOpen: false,
  toast: null,
  set: (s) => set(s),
}));
