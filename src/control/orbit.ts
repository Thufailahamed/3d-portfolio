/**
 * Earth-orbit mechanics for flight dynamics: classical elements ⇄ state vectors, secular J2
 * precession (what makes sun-synchronous orbits work), sidereal time, ground tracks, the Sun and
 * Moon, eclipses and ground-station visibility. Units: km, km/s, radians, Julian days. ECI is
 * the J2000 equatorial frame (x → vernal equinox, z → north pole).
 */

export const MU = 398_600.4418;
export const RE = 6_378.137;
export const J2 = 1.08262668e-3;
export const OMEGA_E = 7.2921159e-5;
export const DEG = Math.PI / 180;
export const TAU = Math.PI * 2;
export const GEO_R = 42_164.17;

export type V3 = { x: number; y: number; z: number };
export const v3 = (x = 0, y = 0, z = 0): V3 => ({ x, y, z });
export const add = (a: V3, b: V3): V3 => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z });
export const sub = (a: V3, b: V3): V3 => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
export const mul = (a: V3, k: number): V3 => ({ x: a.x * k, y: a.y * k, z: a.z * k });
export const dot = (a: V3, b: V3) => a.x * b.x + a.y * b.y + a.z * b.z;
export const cross = (a: V3, b: V3): V3 => ({ x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x });
export const len = (a: V3) => Math.hypot(a.x, a.y, a.z);
export const norm = (a: V3): V3 => {
  const l = len(a) || 1;
  return { x: a.x / l, y: a.y / l, z: a.z / l };
};
export const wrapPi = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
export const wrap2Pi = (a: number) => ((a % TAU) + TAU) % TAU;

export type Elements = {
  /** semi-major axis (km); negative for hyperbolic */
  a: number;
  e: number;
  i: number;
  raan: number;
  argp: number;
  /** mean anomaly at epoch (rad) */
  M0: number;
  epoch: number;
};

/** Greenwich mean sidereal angle (rad) */
export function gmst(jd: number) {
  return wrap2Pi((280.46061837 + 360.98564736629 * (jd - 2451545)) * DEG);
}

export function elementsFromState(r: V3, v: V3, jd: number): Elements {
  const rm = len(r);
  const vm2 = dot(v, v);
  const h = cross(r, v);
  const hm = len(h);
  const nv = v3(-h.y, h.x, 0);
  const nm = len(nv);
  const rv = dot(r, v);
  const ev = mul(sub(mul(r, vm2 - MU / rm), mul(v, rv)), 1 / MU);
  const e = len(ev);
  const energy = vm2 / 2 - MU / rm;
  const a = Math.abs(1 - e) < 1e-9 ? 1e12 : -MU / (2 * energy);
  const i = Math.acos(Math.max(-1, Math.min(1, h.z / hm)));
  let raan = nm > 1e-9 ? Math.atan2(nv.y, nv.x) : 0;
  raan = wrap2Pi(raan);
  let argp = 0;
  let nu = 0;
  if (e > 1e-7) {
    if (nm > 1e-9) {
      argp = Math.acos(Math.max(-1, Math.min(1, dot(nv, ev) / (nm * e))));
      if (ev.z < 0) argp = TAU - argp;
    } else {
      argp = wrap2Pi(Math.atan2(ev.y, ev.x) * Math.sign(h.z || 1));
    }
    nu = Math.acos(Math.max(-1, Math.min(1, dot(ev, r) / (e * rm))));
    if (rv < 0) nu = TAU - nu;
  } else if (nm > 1e-9) {
    nu = Math.acos(Math.max(-1, Math.min(1, dot(nv, r) / (nm * rm))));
    if (r.z < 0) nu = TAU - nu;
  } else {
    nu = wrap2Pi(Math.atan2(r.y, r.x));
  }
  let M: number;
  if (e < 1) {
    const E = 2 * Math.atan2(Math.sqrt(1 - e) * Math.sin(nu / 2), Math.sqrt(1 + e) * Math.cos(nu / 2));
    M = E - e * Math.sin(E);
  } else {
    const t = Math.sqrt((e - 1) / (e + 1)) * Math.tan(nu / 2);
    const F = 2 * Math.atanh(Math.max(-0.999999, Math.min(0.999999, t)));
    M = e * Math.sinh(F) - F;
  }
  return { a, e, i, raan, argp, M0: M, epoch: jd };
}

export const meanMotion = (a: number) => Math.sqrt(MU / Math.pow(Math.abs(a), 3));
export const period = (a: number) => TAU / meanMotion(a);

/** secular J2 drift of the node and perigee (rad/s) */
export function j2Rates(el: Elements) {
  if (el.e >= 1 || el.a <= 0) return { raan: 0, argp: 0 };
  const n = meanMotion(el.a);
  const p = el.a * (1 - el.e * el.e);
  const k = 1.5 * n * J2 * (RE / p) ** 2;
  const ci = Math.cos(el.i);
  return { raan: -k * ci, argp: 0.5 * k * (5 * ci * ci - 1) };
}

function solveKepler(M: number, e: number) {
  let E = e < 0.8 ? M : Math.PI;
  for (let k = 0; k < 30; k++) {
    const d = (E - e * Math.sin(E) - M) / (1 - e * Math.cos(E));
    E -= d;
    if (Math.abs(d) < 1e-12) break;
  }
  return E;
}
function solveHyper(M: number, e: number) {
  let F = Math.asinh(M / e);
  for (let k = 0; k < 40; k++) {
    const d = (e * Math.sinh(F) - F - M) / (e * Math.cosh(F) - 1);
    F -= d;
    if (Math.abs(d) < 1e-12) break;
  }
  return F;
}

export type State = { r: V3; v: V3; nu: number; M: number };

/** state vector (km, km/s) at Julian date `jd`, with secular J2 */
export function stateAt(el: Elements, jd: number): State {
  const dt = (jd - el.epoch) * 86400;
  const n = meanMotion(el.a);
  const rates = j2Rates(el);
  const raan = el.raan + rates.raan * dt;
  const argp = el.argp + rates.argp * dt;
  let nu: number;
  let rmag: number;
  let M: number;
  const p = el.a * (1 - el.e * el.e);
  if (el.e < 1) {
    M = wrap2Pi(el.M0 + n * dt);
    const E = solveKepler(M, el.e);
    nu = 2 * Math.atan2(Math.sqrt(1 + el.e) * Math.sin(E / 2), Math.sqrt(1 - el.e) * Math.cos(E / 2));
    rmag = el.a * (1 - el.e * Math.cos(E));
  } else {
    M = el.M0 + n * dt;
    const F = solveHyper(M, el.e);
    nu = 2 * Math.atan(Math.sqrt((el.e + 1) / (el.e - 1)) * Math.tanh(F / 2));
    rmag = p / (1 + el.e * Math.cos(nu));
  }
  const px = rmag * Math.cos(nu);
  const py = rmag * Math.sin(nu);
  const vk = Math.sqrt(MU / Math.abs(p));
  const vx = -vk * Math.sin(nu);
  const vy = vk * (el.e + Math.cos(nu));
  return { r: perifocal(px, py, raan, el.i, argp), v: perifocal(vx, vy, raan, el.i, argp), nu, M };
}

function perifocal(x: number, y: number, O: number, i: number, w: number): V3 {
  const cO = Math.cos(O), sO = Math.sin(O), ci = Math.cos(i), si = Math.sin(i), cw = Math.cos(w), sw = Math.sin(w);
  return {
    x: (cO * cw - sO * sw * ci) * x + (-cO * sw - sO * cw * ci) * y,
    y: (sO * cw + cO * sw * ci) * x + (-sO * sw + cO * cw * ci) * y,
    z: sw * si * x + cw * si * y,
  };
}

export const apoapsis = (el: Elements) => el.a * (1 + el.e) - RE;
export const periapsis = (el: Elements) => el.a * (1 - el.e) - RE;

/** seconds until the orbit next reaches true anomaly 0 (perigee) or π (apogee) */
export function timeToAnomaly(el: Elements, jd: number, target: "peri" | "apo") {
  if (el.e >= 1) return Infinity;
  const n = meanMotion(el.a);
  const M = wrap2Pi(el.M0 + n * (jd - el.epoch) * 86400);
  const Mt = target === "apo" ? Math.PI : TAU;
  return wrap2Pi(Mt - M) / n;
}

/** seconds until the next ascending node (argument of latitude 0) */
export function timeToNode(el: Elements, jd: number) {
  if (el.e >= 1) return Infinity;
  const n = meanMotion(el.a);
  const rates = j2Rates(el);
  const argp = el.argp + rates.argp * (jd - el.epoch) * 86400;
  // true anomaly of the node, then the mean anomaly there
  const nuN = wrap2Pi(-argp);
  const E = 2 * Math.atan2(Math.sqrt(1 - el.e) * Math.sin(nuN / 2), Math.sqrt(1 + el.e) * Math.cos(nuN / 2));
  const Mn = wrap2Pi(E - el.e * Math.sin(E));
  const M = wrap2Pi(el.M0 + n * (jd - el.epoch) * 86400);
  return wrap2Pi(Mn - M) / n;
}

// ———————————————————————————— Earth-fixed geometry ————————————————————————————

export type Geo = { lat: number; lon: number; alt: number };

export function eciToGeo(r: V3, jd: number): Geo {
  const lon = wrapPi(Math.atan2(r.y, r.x) - gmst(jd));
  const lat = Math.atan2(r.z, Math.hypot(r.x, r.y));
  return { lat, lon, alt: len(r) - RE };
}

export function geoToEci(lat: number, lon: number, alt: number, jd: number): V3 {
  const th = lon + gmst(jd);
  const r = RE + alt;
  return v3(r * Math.cos(lat) * Math.cos(th), r * Math.cos(lat) * Math.sin(th), r * Math.sin(lat));
}

/** rotate an ECI vector into the Earth-fixed frame */
export function eciToEcef(r: V3, jd: number): V3 {
  const g = gmst(jd);
  const c = Math.cos(g), s = Math.sin(g);
  return v3(c * r.x + s * r.y, -s * r.x + c * r.y, r.z);
}

/** elevation (rad) of a target seen from a ground site */
export function elevation(r: V3, lat: number, lon: number, jd: number) {
  const st = geoToEci(lat, lon, 0, jd);
  const d = sub(r, st);
  const up = norm(st);
  return Math.asin(Math.max(-1, Math.min(1, dot(d, up) / len(d))));
}

/** great-circle angle between two points (rad) */
export function centralAngle(lat1: number, lon1: number, lat2: number, lon2: number) {
  const s = Math.sin((lat2 - lat1) / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin((lon2 - lon1) / 2) ** 2;
  return 2 * Math.asin(Math.min(1, Math.sqrt(s)));
}

/** angular radius of the footprint where the satellite is above `mask` elevation */
export function footprint(altKm: number, mask = 5 * DEG) {
  const r = RE + Math.max(0, altKm);
  return Math.acos((RE / r) * Math.cos(mask)) - mask;
}

// ———————————————————————————— Sun and Moon ————————————————————————————

/** unit vector to the Sun in ECI (low-precision solar coordinates, ±0.01°) */
export function sunDir(jd: number): V3 {
  const n = jd - 2451545;
  const L = (280.46 + 0.9856474 * n) * DEG;
  const g = (357.528 + 0.9856003 * n) * DEG;
  const lam = L + (1.915 * Math.sin(g) + 0.02 * Math.sin(2 * g)) * DEG;
  const eps = (23.439 - 0.0000004 * n) * DEG;
  return v3(Math.cos(lam), Math.cos(eps) * Math.sin(lam), Math.sin(eps) * Math.sin(lam));
}

/** geocentric Moon (km, ECI) — the Astronomical Almanac's low-precision series */
export function moonPos(jd: number): V3 {
  const T = (jd - 2451545) / 36525;
  const s = (a: number, b: number) => Math.sin((a + b * T) * DEG);
  const c = (a: number, b: number) => Math.cos((a + b * T) * DEG);
  const L = (218.32 + 481267.881 * T + 6.29 * s(135.0, 477198.87) - 1.27 * s(259.3, -413335.36) + 0.66 * s(235.7, 890534.22) + 0.21 * s(269.9, 954397.74) - 0.19 * s(357.5, 35999.05) - 0.11 * s(186.5, 966404.03)) * DEG;
  const B = (5.13 * s(93.3, 483202.02) + 0.28 * s(228.2, 960400.89) - 0.28 * s(318.3, 6003.15) - 0.17 * s(217.6, -407332.21)) * DEG;
  const P = (0.9508 + 0.0518 * c(135.0, 477198.87) + 0.0095 * c(259.3, -413335.36) + 0.0078 * c(235.7, 890534.22) + 0.0028 * c(269.9, 954397.74)) * DEG;
  const r = RE / Math.sin(P);
  const eps = 23.439 * DEG;
  const x = r * Math.cos(B) * Math.cos(L);
  const y = r * (Math.cos(eps) * Math.cos(B) * Math.sin(L) - Math.sin(eps) * Math.sin(B));
  const z = r * (Math.sin(eps) * Math.cos(B) * Math.sin(L) + Math.cos(eps) * Math.sin(B));
  return v3(x, y, z);
}

/** the satellite is in Earth's shadow (cylindrical shadow model) */
export function inEclipse(r: V3, jd: number) {
  const s = sunDir(jd);
  const d = dot(r, s);
  if (d > 0) return false;
  const perp = len(sub(r, mul(s, d)));
  return perp < RE;
}

/** sub-solar point */
export function subSolar(jd: number): { lat: number; lon: number } {
  const s = sunDir(jd);
  return { lat: Math.asin(s.z), lon: wrapPi(Math.atan2(s.y, s.x) - gmst(jd)) };
}

/** right ascension / declination (deg) → ECI unit vector */
export function raDec(ra: number, dec: number): V3 {
  return v3(Math.cos(dec * DEG) * Math.cos(ra * DEG), Math.cos(dec * DEG) * Math.sin(ra * DEG), Math.sin(dec * DEG));
}

/** inclination that makes the node precess 360° per year at this altitude */
export function ssoInclination(altKm: number) {
  const a = RE + altKm;
  const c = -Math.pow(a / 12352, 3.5);
  return Math.acos(Math.max(-1, Math.min(1, c))) / DEG;
}

/** thermosphere density (kg/m³) for moderate solar activity */
export function thermoDensity(hKm: number) {
  const T: [number, number][] = [
    [100, 5.3e-7], [120, 2.2e-8], [150, 2.0e-9], [200, 2.5e-10], [250, 6.0e-11], [300, 1.9e-11], [350, 7.0e-12],
    [400, 2.8e-12], [450, 1.2e-12], [500, 5.2e-13], [600, 1.1e-13], [700, 3.1e-14], [800, 1.1e-14], [1000, 3.0e-15],
  ];
  if (hKm <= T[0][0]) return T[0][1];
  if (hKm >= T[T.length - 1][0]) return T[T.length - 1][1] * Math.exp(-(hKm - 1000) / 250);
  for (let k = 1; k < T.length; k++) {
    if (hKm < T[k][0]) {
      const [h0, r0] = T[k - 1];
      const [h1, r1] = T[k];
      return r0 * Math.pow(r1 / r0, (hKm - h0) / (h1 - h0));
    }
  }
  return 0;
}

/** Julian date ⇄ JS Date */
export const jdOf = (d: Date | number) => (typeof d === "number" ? d : d.getTime()) / 86400000 + 2440587.5;
export const dateOf = (jd: number) => new Date((jd - 2440587.5) * 86400000);
