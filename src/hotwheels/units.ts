/**
 * Real toy proportions, in centimetres. One world unit is 1 cm: a 1:64 car is about 7.6 cm long,
 * the orange track's bed is 4 cm across between two 0.8 cm walls.
 */
export const G = 981;
/** the bed's top surface sits this far above the track's centre line samples */
export const TRACK = {
  /** inner width of the bed, wall to wall */
  bed: 4.1,
  /** wall height above the bed, and thickness */
  wall: 0.85,
  wallT: 0.22,
  /** bed thickness (the plastic is thin, with a lip underneath) */
  thick: 0.2,
  /** a track piece is this long between connectors */
  piece: 30,
} as const;

/** the car's body origin rides this far above the bed (half its collider height) */
export const RIDE = 1.05;
export const CAR_LEN = 7.6;
export const CAR_W = 3.1;

/** slow motion: the sim runs at this fraction of real time */
export const TIME = { normal: 0.72, slow: 0.16 } as const;

export const ORANGE = "#ff6a0d";
export const COLORS = {
  orange: ORANGE,
  orangeDark: "#d94f00",
  connector: "#2a5bd7",
  launcher: "#1d2433",
  launcherAccent: "#ffd21f",
  booster: "#222831",
  boosterAccent: "#ff2d55",
  support: "#9aa7b8",
  ink: "#12141a",
  cream: "#fff6e8",
} as const;
