import * as THREE from "three";
import type { WorldId } from "./worlds";

/**
 * Where everything really is. Planet positions use JPL's "Keplerian Elements for Approximate
 * Positions of the Major Planets" (Standish, table 1, valid 1800–2050): J2000 elements plus their
 * rates per century. Good to a fraction of a degree — far finer than anything on screen.
 *
 * Axes: heliocentric ecliptic J2000 mapped to three.js as x → x, ecliptic north → +y, y → −z,
 * so prograde motion is anticlockwise seen from above.
 */

export const AU_KM = 149_597_870.7;
const D2R = Math.PI / 180;
const OBLIQUITY = 23.43928 * D2R;

type Elements = { a: number; e: number; I: number; L: number; peri: number; node: number };
/** [J2000 value, rate per Julian century] for a, e, I, L, ϖ, Ω */
const PLANETS: Record<string, [Elements, Elements]> = {
  mercury: [
    { a: 0.38709927, e: 0.20563593, I: 7.00497902, L: 252.2503235, peri: 77.45779628, node: 48.33076593 },
    { a: 0.00000037, e: 0.00001906, I: -0.00594749, L: 149472.67411175, peri: 0.16047689, node: -0.12534081 },
  ],
  venus: [
    { a: 0.72333566, e: 0.00677672, I: 3.39467605, L: 181.9790995, peri: 131.60246718, node: 76.67984255 },
    { a: 0.0000039, e: -0.00004107, I: -0.0007889, L: 58517.81538729, peri: 0.00268329, node: -0.27769418 },
  ],
  earth: [
    { a: 1.00000261, e: 0.01671123, I: -0.00001531, L: 100.46457166, peri: 102.93768193, node: 0 },
    { a: 0.00000562, e: -0.00004392, I: -0.01294668, L: 35999.37244981, peri: 0.32327364, node: 0 },
  ],
  mars: [
    { a: 1.52371034, e: 0.0933941, I: 1.84969142, L: -4.55343205, peri: -23.94362959, node: 49.55953891 },
    { a: 0.00001847, e: 0.00007882, I: -0.00813131, L: 19140.30268499, peri: 0.44441088, node: -0.29257343 },
  ],
  jupiter: [
    { a: 5.202887, e: 0.04838624, I: 1.30439695, L: 34.39644051, peri: 14.72847983, node: 100.47390909 },
    { a: -0.00011607, e: -0.00013253, I: -0.00183714, L: 3034.74612775, peri: 0.21252668, node: 0.20469106 },
  ],
  saturn: [
    { a: 9.53667594, e: 0.05386179, I: 2.48599187, L: 49.95424423, peri: 92.59887831, node: 113.66242448 },
    { a: -0.0012506, e: -0.00050991, I: 0.00193609, L: 1222.49362201, peri: -0.41897216, node: -0.28867794 },
  ],
  uranus: [
    { a: 19.18916464, e: 0.04725744, I: 0.77263783, L: 313.23810451, peri: 170.9542763, node: 74.01692503 },
    { a: -0.00196176, e: -0.00004397, I: -0.00242939, L: 428.48202785, peri: 0.40805281, node: 0.04240589 },
  ],
  neptune: [
    { a: 30.06992276, e: 0.00859048, I: 1.77004347, L: -55.12002969, peri: 44.96476227, node: 131.78422574 },
    { a: 0.00026291, e: 0.00005105, I: 0.00035372, L: 218.45945325, peri: -0.32241464, node: -0.00508664 },
  ],
  pluto: [
    { a: 39.48211675, e: 0.2488273, I: 17.14001206, L: 238.92903833, peri: 224.06891629, node: 110.30393684 },
    { a: -0.00031596, e: 0.0000517, I: 0.00004818, L: 145.20780515, peri: -0.04062942, node: -0.01183482 },
  ],
};
export const PLANET_IDS = ["mercury", "venus", "earth", "mars", "jupiter", "saturn", "uranus", "neptune", "pluto"] as const;

export const J2000 = 2451545.0;
export const jdOf = (d: Date) => d.getTime() / 86400000 + 2440587.5;
export const dateOf = (jd: number) => new Date((jd - 2440587.5) * 86400000);
export const fmtDate = (jd: number) => dateOf(jd).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });

/** solve Kepler's equation M = E − e·sin E (radians) */
export function kepler(M: number, e: number) {
  // Danby's starting guess converges for any eccentricity below 1 (Halley's is 0.967)
  let E = M + 0.85 * e * Math.sign(Math.sin(M) || 1);
  for (let i = 0; i < 40; i++) {
    const d = (E - e * Math.sin(E) - M) / (1 - e * Math.cos(E));
    E -= Math.max(-1, Math.min(1, d));
    if (Math.abs(d) < 1e-11) break;
  }
  return E;
}

const ecl = (x: number, y: number, z: number, out: THREE.Vector3) => out.set(x, z, -y);

/** position (AU) in an orbit given classical elements in degrees, at mean anomaly M (degrees) */
export function orbitPoint(a: number, e: number, I: number, node: number, argPeri: number, Mdeg: number, out: THREE.Vector3) {
  let M = (Mdeg % 360) * D2R;
  if (M > Math.PI) M -= 2 * Math.PI;
  if (M < -Math.PI) M += 2 * Math.PI;
  const E = kepler(M, e);
  const xp = a * (Math.cos(E) - e);
  const yp = a * Math.sqrt(1 - e * e) * Math.sin(E);
  const w = argPeri * D2R;
  const O = node * D2R;
  const i = I * D2R;
  const cw = Math.cos(w), sw = Math.sin(w), cO = Math.cos(O), sO = Math.sin(O), ci = Math.cos(i), si = Math.sin(i);
  const x = (cw * cO - sw * sO * ci) * xp + (-sw * cO - cw * sO * ci) * yp;
  const y = (cw * sO + sw * cO * ci) * xp + (-sw * sO + cw * cO * ci) * yp;
  const z = sw * si * xp + cw * si * yp;
  return ecl(x, y, z, out);
}

export function elementsAt(id: string, jd: number) {
  const [e0, r] = PLANETS[id];
  const T = (jd - J2000) / 36525;
  const el = { a: e0.a + r.a * T, e: e0.e + r.e * T, I: e0.I + r.I * T, L: e0.L + r.L * T, peri: e0.peri + r.peri * T, node: e0.node + r.node * T };
  return el;
}

/** heliocentric position of a planet (AU, three.js axes) */
export function planetPos(id: string, jd: number, out = new THREE.Vector3()) {
  const el = elementsAt(id, jd);
  return orbitPoint(el.a, el.e, el.I, el.node, el.peri - el.node, el.L - el.peri, out);
}

/** heliocentric ecliptic longitude (radians) */
export function longitude(id: string, jd: number) {
  const p = planetPos(id, jd, new THREE.Vector3());
  return Math.atan2(-p.z, p.x);
}

/** one full orbit as points (AU), plus the mean anomaly of each point (for a fading trail) */
export function orbitPath(id: string, jd: number, n = 512) {
  const el = elementsAt(id, jd);
  const pts: THREE.Vector3[] = [];
  const ms: number[] = [];
  for (let k = 0; k <= n; k++) {
    const M = (k / n) * 360;
    pts.push(orbitPoint(el.a, el.e, el.I, el.node, el.peri - el.node, M, new THREE.Vector3()));
    ms.push(M);
  }
  return { pts, ms, M: (((el.L - el.peri) % 360) + 360) % 360 };
}

/** 1P/Halley (perihelion 9 Feb 1986; next 28 Jul 2061) */
export const HALLEY = { a: 17.834, e: 0.96714, I: 162.262, node: 58.42, argPeri: 111.332, Tp: 2446470.5, period: 27509 };
export function halleyPos(jd: number, out = new THREE.Vector3()) {
  const M = (360 * (jd - HALLEY.Tp)) / HALLEY.period;
  return orbitPoint(HALLEY.a, HALLEY.e, HALLEY.I, HALLEY.node, HALLEY.argPeri, M, out);
}

/** unit vector (three.js axes) for a direction given in J2000 equatorial RA/Dec (degrees) */
export function fromRaDec(raDeg: number, decDeg: number, out = new THREE.Vector3()) {
  const ra = raDeg * D2R;
  const de = decDeg * D2R;
  const x = Math.cos(de) * Math.cos(ra);
  const y = Math.cos(de) * Math.sin(ra);
  const z = Math.sin(de);
  // equatorial → ecliptic
  const ye = y * Math.cos(OBLIQUITY) + z * Math.sin(OBLIQUITY);
  const ze = -y * Math.sin(OBLIQUITY) + z * Math.cos(OBLIQUITY);
  return ecl(x, ye, ze, out).normalize();
}

/** north poles (IAU, J2000 RA/Dec) and sidereal rotation (hours; negative = retrograde) */
export const SPIN: Record<string, { ra: number; dec: number; hours: number }> = {
  sun: { ra: 286.13, dec: 63.87, hours: 609.12 },
  mercury: { ra: 281.01, dec: 61.41, hours: 1407.6 },
  venus: { ra: 272.76, dec: 67.16, hours: -5832.5 },
  earth: { ra: 0, dec: 90, hours: 23.934 },
  moon: { ra: 269.99, dec: 66.54, hours: 655.73 },
  mars: { ra: 317.68, dec: 52.89, hours: 24.623 },
  jupiter: { ra: 268.06, dec: 64.5, hours: 9.925 },
  saturn: { ra: 40.59, dec: 83.54, hours: 10.656 },
  titan: { ra: 40.59, dec: 83.54, hours: 382.68 },
  uranus: { ra: 257.31, dec: -15.18, hours: -17.24 },
  neptune: { ra: 299.36, dec: 43.46, hours: 16.11 },
  pluto: { ra: 132.99, dec: -6.16, hours: -153.29 },
};

/** major moons: parent, orbit radius (km), period (days, negative = retrograde), radius (km), inclination to the parent's equator */
export type MoonDef = { id: string; name: string; parent: WorldId; aKm: number; days: number; rKm: number; inc: number; phase: number; color: string; world?: WorldId };
export const MOONS: MoonDef[] = [
  { id: "moon", name: "Moon", parent: "earth", aKm: 384400, days: 27.3217, rKm: 1737.4, inc: 5.145, phase: 0, color: "#9a9894", world: "moon" },
  { id: "phobos", name: "Phobos", parent: "mars", aKm: 9376, days: 0.31891, rKm: 11.3, inc: 1.1, phase: 40, color: "#5c4f45" },
  { id: "deimos", name: "Deimos", parent: "mars", aKm: 23463, days: 1.26244, rKm: 6.2, inc: 1.8, phase: 210, color: "#6c5c4e" },
  { id: "io", name: "Io", parent: "jupiter", aKm: 421700, days: 1.769, rKm: 1821.6, inc: 0.05, phase: 10, color: "#d9c25a" },
  { id: "europa", name: "Europa", parent: "jupiter", aKm: 671034, days: 3.551, rKm: 1560.8, inc: 0.47, phase: 190, color: "#d7cbb4" },
  { id: "ganymede", name: "Ganymede", parent: "jupiter", aKm: 1070412, days: 7.155, rKm: 2634.1, inc: 0.2, phase: 100, color: "#8f8576" },
  { id: "callisto", name: "Callisto", parent: "jupiter", aKm: 1882709, days: 16.689, rKm: 2410.3, inc: 0.19, phase: 280, color: "#5f574d" },
  { id: "rhea", name: "Rhea", parent: "saturn", aKm: 527108, days: 4.518, rKm: 763.8, inc: 0.35, phase: 70, color: "#b7b4ae" },
  { id: "titan", name: "Titan", parent: "saturn", aKm: 1221870, days: 15.945, rKm: 2574.7, inc: 0.35, phase: 160, color: "#d9a54e", world: "titan" },
  { id: "titania", name: "Titania", parent: "uranus", aKm: 435910, days: 8.706, rKm: 788.9, inc: 0.34, phase: 30, color: "#a8a39c" },
  { id: "oberon", name: "Oberon", parent: "uranus", aKm: 583520, days: 13.463, rKm: 761.4, inc: 0.06, phase: 220, color: "#9a918a" },
  { id: "triton", name: "Triton", parent: "neptune", aKm: 354759, days: -5.877, rKm: 1353.4, inc: 156.9, phase: 120, color: "#c9b8b0" },
  { id: "charon", name: "Charon", parent: "pluto", aKm: 19591, days: 6.387, rKm: 606, inc: 0, phase: 180, color: "#8f8a84" },
];

/** the Moon's mean geocentric ecliptic longitude and node (Meeus, low precision) */
export function moonGeocentric(jd: number, out = new THREE.Vector3()) {
  const d = jd - J2000;
  const L = (218.316 + 13.176396 * d) * D2R;
  const node = (125.04 - 0.052954 * d) * D2R;
  const i = 5.145 * D2R;
  const x = Math.cos(L);
  const y = Math.sin(L);
  const z = Math.sin(i) * Math.sin(L - node);
  return ecl(x, y, z, out).normalize();
}

/** bright stars (J2000 RA hours, Dec degrees, visual magnitude, B−V colour index): the ones you'd recognise */
export const BRIGHT_STARS: [string, number, number, number, number][] = [
  ["Sirius", 6.752, -16.72, -1.46, 0.0], ["Canopus", 6.399, -52.7, -0.74, 0.15], ["Rigil Kentaurus", 14.66, -60.83, -0.27, 0.71],
  ["Arcturus", 14.261, 19.18, -0.05, 1.23], ["Vega", 18.616, 38.78, 0.03, 0.0], ["Capella", 5.278, 46.0, 0.08, 0.8],
  ["Rigel", 5.242, -8.2, 0.13, -0.03], ["Procyon", 7.655, 5.22, 0.34, 0.42], ["Achernar", 1.629, -57.24, 0.46, -0.16],
  ["Betelgeuse", 5.919, 7.41, 0.5, 1.85], ["Hadar", 14.064, -60.37, 0.61, -0.23], ["Altair", 19.846, 8.87, 0.76, 0.22],
  ["Acrux", 12.443, -63.1, 0.77, -0.24], ["Aldebaran", 4.599, 16.51, 0.86, 1.54], ["Antares", 16.49, -26.43, 0.96, 1.83],
  ["Spica", 13.42, -11.16, 0.97, -0.23], ["Pollux", 7.755, 28.03, 1.14, 1.0], ["Fomalhaut", 22.961, -29.62, 1.16, 0.09],
  ["Deneb", 20.69, 45.28, 1.25, 0.09], ["Mimosa", 12.795, -59.69, 1.25, -0.23], ["Regulus", 10.14, 11.97, 1.35, -0.11],
  ["Adhara", 6.977, -28.97, 1.5, -0.21], ["Castor", 7.577, 31.89, 1.58, 0.03], ["Shaula", 17.56, -37.1, 1.62, -0.22],
  ["Gacrux", 12.519, -57.11, 1.63, 1.6], ["Bellatrix", 5.419, 6.35, 1.64, -0.22], ["Elnath", 5.438, 28.61, 1.65, -0.13],
  ["Alnilam", 5.604, -1.2, 1.69, -0.18], ["Alnitak", 5.679, -1.94, 1.77, -0.21], ["Mintaka", 5.533, -0.3, 2.23, -0.22],
  ["Saiph", 5.796, -9.67, 2.09, -0.18], ["Alioth", 12.9, 55.96, 1.77, -0.02], ["Dubhe", 11.062, 61.75, 1.79, 1.07],
  ["Alkaid", 13.792, 49.31, 1.86, -0.19], ["Mizar", 13.399, 54.93, 2.23, 0.02], ["Merak", 11.031, 56.38, 2.37, 0.03],
  ["Phecda", 11.897, 53.69, 2.44, 0.0], ["Megrez", 12.257, 57.03, 3.31, 0.08], ["Polaris", 2.53, 89.26, 1.98, 0.6],
  ["Schedar", 0.675, 56.54, 2.24, 1.17], ["Caph", 0.153, 59.15, 2.28, 0.34], ["Navi", 0.945, 60.72, 2.15, -0.15],
  ["Ruchbah", 1.43, 60.24, 2.66, 0.13], ["Segin", 1.907, 63.67, 3.35, -0.15], ["Sargas", 17.622, -43.0, 1.86, 0.4],
  ["Kaus Australis", 18.403, -34.38, 1.85, -0.03], ["Nunki", 18.921, -26.3, 2.05, -0.13], ["Peacock", 20.427, -56.74, 1.94, -0.2],
  ["Mirfak", 3.405, 49.86, 1.79, 0.48], ["Alhena", 6.629, 16.4, 1.9, 0.0], ["Menkalinan", 5.992, 44.95, 1.9, 0.08],
  ["Atria", 16.811, -69.03, 1.91, 1.44], ["Avior", 8.375, -59.51, 1.86, 1.28], ["Alphard", 9.46, -8.66, 1.99, 1.44],
  ["Hamal", 2.12, 23.46, 2.0, 1.15], ["Diphda", 0.727, -17.99, 2.04, 1.02], ["Denebola", 11.818, 14.57, 2.13, 0.09],
  ["Algol", 3.136, 40.96, 2.12, -0.05], ["Alpheratz", 0.14, 29.09, 2.06, -0.11], ["Markab", 23.08, 15.21, 2.48, -0.04],
];

/** approximate star colour (linear RGB) from a B−V index */
export function bvColor(bv: number, out = new THREE.Color()) {
  const t = Math.max(0, Math.min(1, (bv + 0.3) / 2.2));
  const stops: [number, [number, number, number]][] = [
    [0, [0.62, 0.72, 1.0]],
    [0.18, [0.8, 0.86, 1.0]],
    [0.32, [1.0, 1.0, 1.0]],
    [0.5, [1.0, 0.95, 0.82]],
    [0.7, [1.0, 0.82, 0.58]],
    [1, [1.0, 0.62, 0.38]],
  ];
  for (let k = 1; k < stops.length; k++) {
    if (t <= stops[k][0]) {
      const [t0, c0] = stops[k - 1];
      const [t1, c1] = stops[k];
      const u = (t - t0) / (t1 - t0);
      return out.setRGB(c0[0] + (c1[0] - c0[0]) * u, c0[1] + (c1[1] - c0[1]) * u, c0[2] + (c1[2] - c0[2]) * u);
    }
  }
  return out.setRGB(1, 0.62, 0.38);
}

/** galactic north pole and galactic centre (J2000) */
export const GAL_NORTH = fromRaDec(192.8595, 27.1283);
export const GAL_CENTER = fromRaDec(266.405, -28.936);

/** Hohmann transfer time between two mean orbits (days) */
export function hohmannTime(a1: number, a2: number) {
  const a = (a1 + a2) / 2;
  return 0.5 * Math.pow(a, 1.5) * 365.25;
}

/**
 * The next launch window from planet `from` to planet `to` on or after `jd`: the date when, after
 * a Hohmann transfer, the target will sit 180° around the Sun from the departure point.
 */
export function launchWindow(from: string, to: string, jd: number) {
  const a1 = elementsAt(from, jd).a;
  const a2 = elementsAt(to, jd).a;
  const days = hohmannTime(a1, a2);
  const n1 = 360 / (Math.pow(a1, 1.5) * 365.25);
  const n2 = 360 / (Math.pow(a2, 1.5) * 365.25);
  const synodic = Math.min(365.25 * 200, 360 / Math.abs(n1 - n2));
  const miss = (t: number) => {
    let d = longitude(to, t + days) - (longitude(from, t) + Math.PI);
    d = Math.atan2(Math.sin(d), Math.cos(d));
    return Math.abs(d);
  };
  // the earliest date where the geometry lines up (windows recur every synodic period)
  const steps = 900;
  const dt = (synodic * 1.02) / steps;
  const ms: number[] = [];
  for (let k = 0; k <= steps; k++) ms.push(miss(jd + k * dt));
  let bestK = 0;
  let bestM = Infinity;
  for (let k = 0; k <= steps; k++) {
    const localMin = (k === 0 || ms[k] <= ms[k - 1]) && (k === steps || ms[k] <= ms[k + 1]);
    if (localMin && ms[k] < 0.06) {
      bestK = k;
      break;
    }
    if (ms[k] < bestM) {
      bestM = ms[k];
      bestK = k;
    }
  }
  const best = jd + bestK * dt;
  let lo = Math.max(jd, best - dt * 2);
  let hi = best + dt * 2;
  for (let k = 0; k < 40; k++) {
    const m1 = lo + (hi - lo) / 3;
    const m2 = hi - (hi - lo) / 3;
    if (miss(m1) < miss(m2)) hi = m2;
    else lo = m1;
  }
  const launch = (lo + hi) / 2;
  return { launch, arrive: launch + days, days, a1, a2, synodic };
}
