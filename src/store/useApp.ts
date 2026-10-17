import { create } from "zustand";
import type { ChapterId } from "@/lib/chapters";

type Quality = "high" | "low";
export type Weather = "night" | "rain" | "day";
/** the pavilion drawn as a hidden-line blueprint, or rendered as a real, lit building */
export type FlowStyle = "xray" | "real";
export type GuestEntry = { id: string; name: string; line: string; at: number };

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
  /** "drone" lifts off from the plaza and orbits the whole complex; "walk" is first person */
  flowView: "exterior" | "drone" | "walk" | "hall" | "showcase";
  detailSlug: string | null;
  /** DOM-only experience (no WebGL) */
  lite: boolean;
  sound: boolean;
  /** the forest's sky (and the realistic pavilion's): the original night, a storm, or daylight */
  weather: Weather;
  /** how the /flow pavilion is drawn */
  flowStyle: FlowStyle;
  /** the realistic pavilion's textures and shaders are still being prepared */
  flowPreparing: boolean;
  /** the realistic pavilion is prepared and on screen (components swap to their real materials) */
  flowRealLive: boolean;
  /** the board's / pavilion's assets have started loading, so their components may mount */
  warmBoard: boolean;
  warmFlow: boolean;
  /** the thermal binoculars are raised (pavilion) */
  thermal: boolean;
  /** thermal palette: 0 white-hot, 1 black-hot, 2 ironbow */
  thermalPalette: number;
  /** the binoculars fill the view completely (the normal render can be skipped) */
  thermalFull: boolean;
  menuOpen: boolean;
  /** the multiverse fills the screen (the journey's canvas can stop rendering underneath) */
  multiverseCover: boolean;
  /** guestbook signatures (newest first), shown on the marble tablet in the hall */
  guestbook: GuestEntry[];
  guestbookOpen: boolean;
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
  flowStyle: "xray",
  flowPreparing: false,
  flowRealLive: false,
  warmBoard: false,
  warmFlow: false,
  thermal: false,
  thermalPalette: 0,
  thermalFull: false,
  menuOpen: false,
  multiverseCover: false,
  guestbook: [],
  guestbookOpen: false,
  toast: null,
  set: (s) => set(s),
}));
