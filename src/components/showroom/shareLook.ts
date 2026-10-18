import type { PaintColor } from "@/content/cars";
import type { BackdropId, LiveryId, MoodId, WeatherId } from "./studio";

/**
 * A configuration someone built, carried in the link (?look=…) so it opens the same for whoever
 * they send it to. Short keys, base64url JSON; anything missing or malformed falls back to the
 * defaults, so an old or hand-edited link still opens the car.
 */
export type SharedLook = {
  paintIdx?: number;
  custom?: PaintColor;
  mood?: MoodId;
  backdrop?: BackdropId;
  livery?: LiveryId;
  liveryColor?: string;
  brake?: string;
  iridescent?: boolean;
  lights?: boolean;
  doors?: boolean;
  steer?: number;
  ride?: number;
  tint?: number;
  sun?: number;
  weather?: WeatherId;
  aperture?: number;
};

const KEYS: [keyof SharedLook, string][] = [
  ["paintIdx", "p"],
  ["custom", "c"],
  ["mood", "m"],
  ["backdrop", "b"],
  ["livery", "l"],
  ["liveryColor", "lc"],
  ["brake", "k"],
  ["iridescent", "i"],
  ["lights", "h"],
  ["doors", "d"],
  ["steer", "s"],
  ["ride", "r"],
  ["tint", "t"],
  ["sun", "u"],
  ["weather", "w"],
  ["aperture", "f"],
];

export function encodeLook(look: SharedLook): string {
  const short: Record<string, unknown> = {};
  for (const [k, s] of KEYS) if (look[k] !== undefined) short[s] = look[k];
  return btoa(JSON.stringify(short)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function decodeLook(raw: string | null): SharedLook {
  if (!raw) return {};
  try {
    const json = atob(raw.replace(/-/g, "+").replace(/_/g, "/"));
    const short = JSON.parse(json) as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const [k, s] of KEYS) if (short[s] !== undefined) out[k] = short[s];
    return out as SharedLook;
  } catch {
    return {};
  }
}
