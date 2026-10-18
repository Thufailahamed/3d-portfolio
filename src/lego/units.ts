/**
 * Real brick proportions, in studs. One stud pitch (8 mm) is one world unit, so a plate is
 * 3.2 mm → 0.4 and a brick is three plates → 1.2. Studs are 4.8 mm across and 1.7 mm tall.
 */
export const PLATE = 0.4;
export const BRICK = 3 * PLATE;
export const STUD_R = 0.3;
export const STUD_H = 0.2;
/** the visible seam between neighbouring pieces (each side gives up half of it) */
export const GAP = 0.018;
/** edge rounding on every piece: moulded ABS is never knife-sharp */
export const BEVEL = 0.032;

/** Official-ish brick colours (sRGB), named the way builders name them. */
export const C = {
  white: "#f2f3f2",
  black: "#1b2a34",
  red: "#c91a09",
  darkRed: "#720e0f",
  yellow: "#f5cd2f",
  brightLightOrange: "#f8bb3d",
  orange: "#fe8a18",
  lime: "#bbe90b",
  green: "#237841",
  brightGreen: "#4b9f4a",
  darkGreen: "#184632",
  sandGreen: "#a0bcac",
  blue: "#0055bf",
  mediumBlue: "#5a93db",
  darkBlue: "#0a3463",
  mediumAzure: "#36aebf",
  darkTurquoise: "#008f9b",
  mediumLavender: "#ac78ba",
  magenta: "#923978",
  tan: "#e4cd9e",
  darkTan: "#958a73",
  reddishBrown: "#582a12",
  nougat: "#d09168",
  lightBluishGray: "#a0a5a9",
  darkBluishGray: "#6c6e68",
} as const;

/** Each project's tint, matched to the nearest real brick colour. */
export const TINT: Record<string, string> = {
  "school-system": C.lime,
  "legal-workspace": C.brightLightOrange,
  luxe: C.mediumLavender,
  goldos: C.orange,
  vyro: C.mediumBlue,
  healthhub: C.mediumAzure,
};
