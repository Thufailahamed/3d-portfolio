import { create } from "zustand";
import type { CamMode } from "./camera";
import type { Pick } from "./layout";

type LegoState = {
  /** physics, textures and the opening build */
  progress: number;
  ready: boolean;
  /** the opening build has finished (or a rebuild is running) */
  building: boolean;
  /** camera stop the view is heading to (fractional while scrolling) and the one it's nearest */
  target: number;
  stop: number;
  stopCount: number;
  knocked: number;
  total: number;
  throws: number;
  sound: boolean;
  /** lights out: the city glows */
  night: boolean;
  /** the sun low and warm, long shadows (only while it isn't night) */
  golden: boolean;
  /** which camera is shooting (see camera.ts) */
  cam: CamMode;
  /** the free-orbit camera's zoom (1 frames the stop; less is closer) */
  zoom: number;
  /** which car the chase camera rides with (an index into the traffic) */
  chaseCar: number;
  /** photo mode: the interface steps aside and the shutter takes a picture of the canvas */
  photo: boolean;
  shotTick: number;
  /** slow motion */
  slowmo: boolean;
  /** bumped to drop a shower of bricks from the sky onto the view */
  stormTick: number;
  /** gravity is off: the builds come apart and everything floats */
  zeroG: boolean;
  /** how much gravity there is right now (1 … 0), for the readout while it fades */
  gravity: number;
  /** the vacuum is out (it follows the pointer; holding the button boosts it) */
  vacuum: boolean;
  /** pieces it has swallowed since the last rebuild */
  sucked: number;
  /** the paintball marker is up (it aims at the pointer; press to fire, hold for full auto) */
  paint: boolean;
  /** which paint is loaded (an index into PAINTS) */
  paintColor: number;
  /** balls fired, and splats on the world since it was last washed */
  fired: number;
  splats: number;
  /** balls left in the loader (-1 while a fresh pod pours in) */
  ammo: number;
  /** bumped to wash the paint off */
  washTick: number;
  /** what the pointer is over, for the cursor */
  hover: Pick["kind"] | null;
  /** bumped to ask the scene to rebuild */
  rebuildTick: number;
  set: (s: Partial<Omit<LegoState, "set">>) => void;
};

export const useLego = create<LegoState>((set) => ({
  progress: 0,
  ready: false,
  building: false,
  target: 0,
  stop: 0,
  stopCount: 1,
  knocked: 0,
  total: 0,
  throws: 0,
  sound: true,
  night: false,
  golden: false,
  cam: "tour",
  zoom: 1,
  chaseCar: 0,
  photo: false,
  shotTick: 0,
  slowmo: false,
  stormTick: 0,
  zeroG: false,
  gravity: 1,
  vacuum: false,
  sucked: 0,
  paint: false,
  paintColor: 0,
  fired: 0,
  splats: 0,
  ammo: 0,
  washTick: 0,
  hover: null,
  rebuildTick: 0,
  set: (s) => set(s),
}));

/**
 * Picks made in the scene, handled by the page (it owns routing and toasts). `canPick` says
 * whether a printed piece acts as a button right now; when it doesn't, a click throws a ball at it.
 */
export const legoEvents: { onPick: (pick: Pick) => void; canPick: (pick: Pick) => boolean; onShot: (png: string) => void } = { onPick: () => {}, canPick: () => true, onShot: () => {} };
