import * as THREE from "three";
import { ABOUT_ORIGIN, at, chapter, clamp01, PROJECTS_ORIGIN } from "@/lib/chapters";
import { sceneState } from "@/lib/sceneState";

/**
 * Projects → About: one continuous zoom-out. The camera cranes up off the crystal, climbs
 * straight up over the valley through the low clouds, and (hidden inside the thickest cloud)
 * the valley hands over to the globe it was standing on, which keeps falling away below until
 * it settles beside the About copy.
 *
 * Everything is driven by u ∈ [0, 1], the scroll between FROM and TO, eased behind the scroll
 * (sceneState.ascent, see stepAscent).
 */
export const ASCENT_FROM = at("projects", 0.78);
export const ASCENT_TO = at("about", 0.5);
/** Where the valley hands over to the globe (fraction of u). */
export const U_CUT = 0.4;
/** Master progress of the hand-over. */
export const CUT_P = ASCENT_FROM + (ASCENT_TO - ASCENT_FROM) * U_CUT;

/** The globe, inside the about group. */
export const GLOBE_R = 1.25;
export const GLOBE_Y = 2.85;
export const TILT = 0.41; // Earth's axial tilt

/** Highest the camera climbs over the valley before the clouds close (valley units ≈ metres). */
export const VALLEY_TOP = 55;
/** Cloud decks over the valley (height above its floor), bottom to top. */
export const CLOUD_DECKS: [number, number, number, number] = [20, 28, 37, 46];
/** Distance from the globe's surface when it first shows through the clouds. */
const GLOBE_NEAR = 0.5;

export const ascentU = (p: number) => clamp01((p - ASCENT_FROM) / (ASCENT_TO - ASCENT_FROM));

/**
 * Advances the zoom-out's clock: u glides after the scroll, so a wheel step becomes a smooth
 * drift instead of a jump. Runs once per frame, before anything that reads it; the camera, the
 * clouds and which world is shown all read this one value, so they always agree.
 */
export function stepAscent(dt: number) {
  const a = sceneState.ascent;
  const target = ascentU(sceneState.p);
  const d = target - a.u;
  // a jump (menu, deep link, back from the board) lands directly, without flying the whole way
  if (Math.abs(d) > 0.3 || sceneState.unfold.t > 0 || Math.abs(d) < 1e-5) a.u = target;
  else a.u += d * (1 - Math.exp(-3.2 * Math.min(dt, 0.1)));
  a.active = a.u > 0 && a.u < 1;
}

const VALLEY_FROM = chapter("tunnel").end - 0.002;
const ABOUT_END = chapter("about").end + 0.002;
/** The projects valley is on screen (until the zoom-out leaves it in the clouds). */
export const showValley = (p: number) => {
  const u = sceneState.ascent.u;
  return u <= U_CUT && (u > 0 || p >= VALLEY_FROM);
};
/** The globe is on screen (from the hand-over in the clouds to the end of About). */
export const showGlobe = (p: number) => {
  const u = sceneState.ascent.u;
  return u > U_CUT && (u < 1 || p <= ABOUT_END);
};
/** 0 → 1 across the valley half (the climb). */
export const valleyX = (u: number) => clamp01(u / U_CUT);
/** 0 → 1 across the globe half (the pull-back). */
export const globeG = (u: number) => clamp01((u - U_CUT) / (1 - U_CUT));

const ease = (x: number) => {
  const t = clamp01(x);
  return t * t * (3 - 2 * t);
};
const lerp = THREE.MathUtils.lerp;

/** Camera height over the valley floor at climb progress x. */
export function valleyAltitude(x: number, mobile: boolean) {
  const r0 = 6.2 * (mobile ? 1.35 : 1);
  // slow to leave the ground, then accelerating upward into the clouds
  return r0 * Math.pow(VALLEY_TOP / r0, Math.pow(clamp01(x), 1.4));
}

/** Distance from the globe's surface at pull-back progress g. */
export function globeDistance(g: number, far: number) {
  // continues the climb's speed, then settles
  const e = 1 - Math.pow(1 - clamp01(g), 2.2);
  return GLOBE_NEAR * Math.pow(far / GLOBE_NEAR, e);
}

const P = (x: number, y: number, z: number, out: THREE.Vector3) =>
  out.set(PROJECTS_ORIGIN[0] + x, PROJECTS_ORIGIN[1] + y, PROJECTS_ORIGIN[2] + z);
const A = (x: number, y: number, z: number, out: THREE.Vector3) =>
  out.set(ABOUT_ORIGIN[0] + x, ABOUT_ORIGIN[1] + y, ABOUT_ORIGIN[2] + z);

/** Where the camera settles on the globe (the first About keyframe). */
export function globeRest(mobile: boolean, pos: THREE.Vector3, look: THREE.Vector3) {
  if (mobile) {
    A(0, 3.1, 8.6, pos);
    A(0, 1.55, 0, look);
  } else {
    A(-0.2, 3.1, 6.4, pos);
    A(-1, 2.8, 0, look);
  }
}

const v = {
  a: new THREE.Vector3(),
  b: new THREE.Vector3(),
  c: new THREE.Vector3(),
  rest: new THREE.Vector3(),
  restLook: new THREE.Vector3(),
  dir: new THREE.Vector3(),
};

/**
 * The camera along the zoom-out. `home` is the world direction from the globe's centre to
 * the studio (the valley's place on Earth), so the pull-back starts right above it.
 */
export function ascentCamera(
  u: number,
  mobile: boolean,
  home: THREE.Vector3,
  pos: THREE.Vector3,
  look: THREE.Vector3,
) {
  if (u <= U_CUT) {
    const x = valleyX(u);
    const r = valleyAltitude(x, mobile);
    const r0 = 6.2 * (mobile ? 1.35 : 1);
    // a crane shot: orbit up and over the crystal, keeping it centred, until looking straight down
    const tilt = ease(x / 0.6);
    const theta = lerp(Math.atan2(0.4, r0), THREE.MathUtils.degToRad(88), tilt);
    const phi = lerp(Math.atan2(0.25, r0), -0.32, tilt);
    // the aim slides from the crystal to the middle of the valley floor below
    const k = ease(x / 0.7);
    P(0, 1.65 * (1 - k), -4 * k, look);
    pos.set(Math.sin(phi) * Math.cos(theta), Math.sin(theta), Math.cos(phi) * Math.cos(theta)).multiplyScalar(r).add(look);
    return;
  }

  const g = globeG(u);
  globeRest(mobile, v.rest, v.restLook);
  const centre = A(0, GLOBE_Y, 0, v.c);
  const restDir = v.dir.copy(v.rest).sub(centre);
  const far = restDir.length() - GLOBE_R;
  restDir.normalize();
  // straight above home first, swinging round to the resting view as it pulls back
  const w = ease((g - 0.12) / 0.78);
  v.a.copy(home).lerp(restDir, w).normalize();
  pos.copy(centre).addScaledVector(v.a, GLOBE_R + globeDistance(g, far));
  // looking down at the planet, then aiming past it so it slides over beside the copy
  look.copy(centre).lerp(v.restLook, ease((g - 0.3) / 0.7));
}

/**
 * How the clouds read at progress u (all 0..1):
 * decks — the valley's cloud decks; veil — cloud filling the view around the hand-over;
 * open — how far the veil has parted over the globe; zoom — screen scale of the veil's billows.
 */
export function ascentClouds(u: number) {
  const x = valleyX(u);
  const g = globeG(u);
  const valley = u <= U_CUT;
  return {
    decks: valley ? 1 : 0,
    veil: valley ? ease((x - 0.9) / 0.1) : 1,
    open: valley ? 0 : ease(g / 0.22),
    zoom: valley ? 0.55 + 0.45 * x : 1 + 2.2 * Math.pow(g, 0.8),
  };
}
