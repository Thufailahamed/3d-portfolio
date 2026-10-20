import * as THREE from "three";
import type { PlanetLook } from "./worlds";

const KIND = { rocky: 0, cratered: 1, banded: 2, earth: 3, cloudy: 4, icy: 5, haze: 6 } as const;

const NOISE3 = /* glsl */ `
uniform int uK;
/* lattice hash built from exact small-integer arithmetic (a mod-289 permutation polynomial): the same lattice
   point hashes identically from every neighbouring cell even when the shader compiler reassociates the maths,
   so value noise and crater cells stay seamless far from the origin */
vec3 m289v(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
float prm(float x) { return mod((x * 34.0 + 1.0) * x, 289.0); }
float h31(vec3 p) {
  vec3 q = m289v(floor(p * 4.0 + 0.5));
  float a = prm(prm(prm(q.x) + q.y) + q.z);
  float b = prm(a + q.x + 7.0);
  return (a * 289.0 + b) * (1.0 / 83521.0);
}
float n3(vec3 p) {
  vec3 i = floor(p); vec3 f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(h31(i), h31(i + vec3(1,0,0)), f.x), mix(h31(i + vec3(0,1,0)), h31(i + vec3(1,1,0)), f.x), f.y),
             mix(mix(h31(i + vec3(0,0,1)), h31(i + vec3(1,0,1)), f.x), mix(h31(i + vec3(0,1,1)), h31(i + vec3(1,1,1)), f.x), f.y), f.z);
}
float fbm3(vec3 p) { float s = 0.0; float a = 0.5; for (int i = 0; i < 6 * uK; i++) { s += a * n3(p); p = p * 2.03 + 17.1; a *= 0.5; } return s; }
/* crater field: dark floors, bright rims, on the unit sphere */
float craters(vec3 p, float scale, float seed) {
  vec3 q = p * scale; vec3 i = floor(q); float r = 0.0;
  for (int z = -uK; z <= uK; z++) for (int y = -uK; y <= uK; y++) for (int x = -uK; x <= uK; x++) {
    vec3 c = i + vec3(x, y, z);
    float hh = h31(c + seed);
    if (hh > 0.45) continue;
    vec3 o = c + vec3(h31(c + 1.7 + seed), h31(c + 3.1 + seed), h31(c + 5.3 + seed));
    float rad = 0.15 + 0.3 * h31(c + 9.1 + seed);
    float d = length(q - o) / rad;
    r += (d < 1.0 ? -0.6 * (1.0 - d * d) : 0.0) + 0.5 * exp(-pow((d - 1.0) * 6.0, 2.0));
  }
  return r;
}
/* Saturn's ring opacity by radius (in planet radii) — shared by the rings and the shadow they cast */
float saturnRing(float r) {
  float t = (r - 1.24) / (2.27 - 1.24);
  if (t < 0.0 || t > 1.0) return 0.0;
  float bands = 0.55 + 0.45 * sin(t * 120.0) * sin(t * 37.0 + 1.0);
  float a = 0.35 + 0.5 * bands;
  a *= smoothstep(0.0, 0.04, t) * (1.0 - smoothstep(0.96, 1.0, t));
  a *= 1.0 - smoothstep(0.66, 0.68, t) * (1.0 - smoothstep(0.7, 0.72, t));
  a *= mix(0.3, 1.0, smoothstep(0.08, 0.25, t));
  return a;
}
`;

const SURFACE = /* glsl */ `
/* albedo of the planet at unit-sphere point p, with ocean glint, cloud cover, city lights and a relief height for bump shading */
vec3 planetSurface(vec3 p, out float spec, out float cloud, out float lights, out float relief) {
  vec3 sp = p + uSeed;
  vec3 col; spec = 0.0; cloud = 0.0; lights = 0.0; relief = 0.0;
  // craters at up to three scales, in one loop so the crater code is emitted once (fast to compile)
  float crater = 0.0;
  int nc = uKind == 1 ? 3 : (uKind == 0 || uKind == 5) ? 1 : 0;
  for (int s = 0; s < 3 * uK; s++) {
    if (s >= nc) break;
    float sc = uKind == 1 ? (s == 0 ? 6.0 : s == 1 ? 15.0 : 34.0) : (uKind == 0 ? 9.0 : 12.0);
    float wt = uKind == 1 ? (s == 0 ? 0.5 : s == 1 ? 0.35 : 0.2) : 1.0;
    crater += craters(p, sc, uSeed + float(s) * 4.0) * wt;
  }
  // every fbm sample this kind needs, gathered and evaluated in ONE loop: the noise code is emitted
  // once instead of ~20 times, which keeps Windows/D3D shader compilation fast
  vec3 Q[8]; int nF = 1;
  if (uKind == 0) { Q[0] = sp * 3.0; Q[1] = sp * 9.0; nF = 2; }
  else if (uKind == 1) { Q[0] = sp * 2.5; }
  else if (uKind == 2) { Q[0] = vec3(p.x * 3.0, p.y * 14.0, p.z * 3.0) + uSeed + vec3(uTime * 0.01, 0.0, 0.0); }
  else if (uKind == 3) { Q[0] = sp * 2.2; Q[1] = sp * 7.0; Q[2] = sp * 5.0; Q[3] = sp * 6.0; Q[4] = sp * 3.0 + vec3(uTime * 0.004, 0.0, 0.0); Q[5] = sp * 9.0; Q[6] = sp * 11.0; nF = 7; }
  else if (uKind == 4) { Q[0] = vec3(p.x * 2.0, p.y * 5.0, p.z * 2.0) + uSeed + vec3(abs(p.y) * 2.0, 0.0, 0.0); Q[1] = sp * 6.0; nF = 2; }
  else if (uKind == 5) { Q[0] = sp * 3.0; }
  else { Q[0] = vec3(p.x, p.y * 4.0, p.z) * 2.0 + uSeed; }
  bool grainy = uKind == 0 || uKind == 1 || uKind == 5;
  int gi = nF;
  if (grainy) { Q[nF] = sp * 90.0; nF++; }
  float F[8];
  for (int i = 0; i < 8 * uK; i++) { if (i >= nF) break; F[i] = fbm3(Q[i]); }
  if (uKind == 0) { // rocky (Mars)
    float n = F[0]; float m = F[1];
    col = mix(uC1, uC2, smoothstep(0.42, 0.62, n + (m - 0.5) * 0.25));
    // a long dark canyon system near the equator
    float canyon = exp(-pow((p.y + 0.12 + (n - 0.5) * 0.08) * 28.0, 2.0)) * smoothstep(0.2, 0.6, sin(atan(p.z, p.x) * 1.0 + 1.2));
    col *= 1.0 - canyon * 0.35;
    col *= 0.85 + 0.3 * crater * 0.3 + 0.15 * m;
    float cap = smoothstep(0.86, 0.92, abs(p.y) + (n - 0.5) * 0.12);
    col = mix(col, uC3, cap);
  } else if (uKind == 1) { // cratered (Moon, Mercury, small moons)
    col = mix(uC1, uC2, smoothstep(0.5, 0.62, F[0]));
    col *= 0.92 + crater * 0.35;
    col = mix(col, uC3, smoothstep(0.75, 1.1, crater) * 0.5);
  } else if (uKind == 2) { // banded giant
    float lat = p.y;
    float turb = F[0] - 0.5;
    float b = sin(lat * 22.0 + turb * 3.0) * 0.5 + 0.5;
    float b2 = sin(lat * 47.0 + turb * 5.0 + 1.3) * 0.5 + 0.5;
    col = mix(uC1, uC2, smoothstep(0.35, 0.75, b));
    col = mix(col, uC3, smoothstep(0.6, 0.95, b2) * 0.45);
    // darker, bluer polar regions
    col *= mix(1.0, 0.72, smoothstep(0.7, 0.95, abs(lat)));
    if (uHasSpot > 0.5) {
      vec2 sd = vec2(atan(p.z, p.x) - 1.1, (lat + 0.36) * 2.6);
      float s = 1.0 - smoothstep(0.08, 0.16, length(sd * vec2(1.0, 1.6)));
      col = mix(col, uSpot, s * 0.85);
    }
    if (uRings > 0.5 && lat > 0.84) {
      // Saturn s north-polar hexagon
      float a = atan(p.z, p.x);
      float r = length(p.xz);
      float hex = r * cos(mod(a + 0.3, 1.0471976) - 0.5235988);
      col = mix(col, vec3(0.42, 0.5, 0.52), (1.0 - smoothstep(0.33, 0.35, hex)) * 0.55);
    }
  } else if (uKind == 3) { // Earth
    float land = F[0] + F[1] * 0.25;
    float isLand = smoothstep(0.6, 0.63, land);
    float desert = smoothstep(0.45, 0.7, F[2]) * (1.0 - smoothstep(0.2, 0.45, abs(abs(p.y) - 0.42)));
    vec3 green = mix(uC2, vec3(0.62, 0.5, 0.32), desert);
    col = mix(uC1 * (0.7 + 0.3 * F[3]), green, isLand);
    float ice = smoothstep(0.8, 0.86, abs(p.y));
    col = mix(col, vec3(0.95), ice);
    spec = (1.0 - isLand) * (1.0 - ice);
    cloud = smoothstep(0.52, 0.72, F[4] + F[5] * 0.2);
    // cities: fine points, denser in temperate, coastal regions
    float pop = smoothstep(0.52, 0.7, F[6]) * (1.0 - smoothstep(0.55, 0.75, abs(p.y))) * smoothstep(0.6, 0.66, land);
    float towns = smoothstep(0.78, 0.86, n3(sp * 260.0)) + smoothstep(0.8, 0.9, n3(sp * 120.0 + 7.0)) * 0.6;
    lights = isLand * (1.0 - ice) * pop * towns * 0.7;
  } else if (uKind == 4) { // Venus cloud deck
    col = mix(uC2, uC1, smoothstep(0.3, 0.7, F[0]));
    col = mix(col, uC3, smoothstep(0.6, 0.8, F[1]) * 0.4);
  } else if (uKind == 5) { // icy (Pluto, Charon)
    col = mix(uC1, uC2, smoothstep(0.48, 0.6, F[0]));
    float heart = smoothstep(0.62, 0.5, length(vec2(atan(p.z, p.x) - 0.6, p.y + 0.15)));
    col = mix(col, uC3, heart * (uC3.r > 0.5 ? 0.9 : 0.0));
    col = mix(col, uC3, smoothstep(0.82, 0.9, p.y) * (uC3.r > 0.5 ? 0.0 : 0.8));
    col *= 0.92 + crater * 0.12;
  } else { // haze (Titan)
    col = mix(uC2, uC1, smoothstep(0.35, 0.65, F[0] * 0.5 + 0.5 - abs(p.y) * 0.4));
    col = mix(col, uC3, smoothstep(0.8, 0.95, p.y) * 0.5);
  }
  if (grainy) relief = crater * 0.5 + (F[0] - 0.5) * 0.6;
  // fine surface grain for close passes (solid worlds only), fading out where it would alias
  if (grainy) {
    float px = length(fwidth(p));
    col *= mix(0.84 + 0.32 * F[gi], 1.0, smoothstep(0.002, 0.01, px));
  }
  return col;
}
`;

/**
 * A whole planet, procedurally, on a unit sphere (scale the mesh to size it): Mars-like rust,
 * cratered grey, gas-giant bands, a living Earth with city lights on its night side, Venus' cloud deck.
 * Saturn receives the shadow of its own rings.
 */
export function planetMaterial(look: PlanetLook, seed: number) {
  return new THREE.ShaderMaterial({
    uniforms: {
      uC1: { value: new THREE.Color(look.c1) },
      uC2: { value: new THREE.Color(look.c2) },
      uC3: { value: new THREE.Color(look.c3) },
      uRim: { value: new THREE.Color(look.rim) },
      uRimK: { value: look.rimK },
      uSpot: { value: new THREE.Color(look.spot ?? "#000000") },
      uHasSpot: { value: look.spot ? 1 : 0 },
      uKind: { value: KIND[look.kind] },
      uSeed: { value: seed },
      uSun: { value: new THREE.Vector3(1, 0.3, 0.4).normalize() },
      uTime: { value: 0 },
      uAmb: { value: 0.02 },
      uK: { value: 1 },
      uRings: { value: look.rings ? 1 : 0 },
    },
    vertexShader: /* glsl */ `
varying vec3 vObj; varying vec3 vWN; varying vec3 vWP; varying vec3 vCenter; varying vec3 vPole; varying float vScale;
void main() {
  vObj = normalize(position);
  vWN = normalize(mat3(modelMatrix) * normal);
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWP = wp.xyz;
  vCenter = (modelMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
  vPole = normalize(mat3(modelMatrix) * vec3(0.0, 1.0, 0.0));
  vScale = length(modelMatrix[0].xyz);
  gl_Position = projectionMatrix * viewMatrix * wp;
}`,
    fragmentShader: /* glsl */ `
uniform vec3 uC1; uniform vec3 uC2; uniform vec3 uC3; uniform vec3 uRim; uniform float uRimK;
uniform vec3 uSpot; uniform float uHasSpot; uniform int uKind; uniform float uSeed; uniform vec3 uSun; uniform float uTime; uniform float uAmb; uniform float uRings;
varying vec3 vObj; varying vec3 vWN; varying vec3 vWP; varying vec3 vCenter; varying vec3 vPole; varying float vScale;
${NOISE3}
${SURFACE}
void main() {
  vec3 p = vObj;
  float spec; float cloud; float lights; float relief;
  vec3 col = planetSurface(p, spec, cloud, lights, relief);
  vec3 N = normalize(vWN);
  vec3 V = normalize(cameraPosition - vWP);
  float nl = dot(N, uSun);
  float lit = smoothstep(-0.08, 0.25, nl) * max(nl, 0.0) * 0.8 + smoothstep(-0.1, 0.4, nl) * 0.2;
  // the rings' shadow across the cloud tops
  if (uRings > 0.5) {
    float dn = dot(uSun, vPole);
    if (abs(dn) > 1e-3) {
      float t = dot(vCenter - vWP, vPole) / dn;
      if (t > 0.0) {
        float rr = length(vWP + uSun * t - vCenter) / vScale;
        lit *= 1.0 - 0.8 * saturnRing(rr);
      }
    }
  }
  vec3 c = col * (lit + uAmb);
  c = mix(c, vec3(1.0) * (lit + uAmb * 0.5), cloud * 0.9);
  vec3 H = normalize(uSun + V);
  c += spec * (1.0 - cloud) * pow(max(dot(N, H), 0.0), 60.0) * 0.6 * step(0.0, nl);
  c += vec3(1.0, 0.7, 0.36) * lights * (1.0 - smoothstep(-0.15, 0.05, nl)) * (1.0 - cloud * 0.7) * 1.4;
  float fres = pow(1.0 - max(dot(N, V), 0.0), 3.0);
  c += uRim * uRimK * fres * smoothstep(-0.2, 0.4, nl) * 1.2;
  gl_FragColor = vec4(c, 1.0);
  #include <colorspace_fragment>
}`,
  });
}

export type ApproachAtmosphere = {
  /** scale height and vertical optical depth, in the approach scene's units (planet radius 100) */
  H: number;
  tau: number;
  /** colour of the sky light scattered sideways (Rayleigh-like) and forward toward the Sun (dust, haze) */
  scatter: THREE.Color;
  forward: THREE.Color;
};

/**
 * The planet for the close approach, ray-traced per pixel inside a bounding shell (so the limb is a
 * perfect curve at any distance): the same procedural surface as the map, plus finer albedo, craters
 * and bump-shaded relief that resolve as the camera drops, and a single-scattering atmosphere that
 * glows along the limb, softens the terminator, reddens the light through long paths and veils the
 * ground below. Writes true depth, so rings and spacecraft sort against it.
 */
export function approachPlanetMaterial(look: PlanetLook, seed: number, atm: ApproachAtmosphere | null) {
  const R = 100;
  const top = atm ? R + atm.H * 9 : R * 1.001;
  return {
    top,
    mat: new THREE.ShaderMaterial({
      uniforms: {
        uC1: { value: new THREE.Color(look.c1) },
        uC2: { value: new THREE.Color(look.c2) },
        uC3: { value: new THREE.Color(look.c3) },
        uSpot: { value: new THREE.Color(look.spot ?? "#000000") },
        uHasSpot: { value: look.spot ? 1 : 0 },
        uKind: { value: KIND[look.kind] },
        uSeed: { value: seed },
        uSun: { value: new THREE.Vector3(1, 0.3, 0.4).normalize() },
        uTime: { value: 0 },
        uAmb: { value: 0.015 },
        uK: { value: 1 },
        uRings: { value: look.rings ? 1 : 0 },
        uCenter: { value: new THREE.Vector3() },
        uPole: { value: new THREE.Vector3(0, 1, 0) },
        uW2O: { value: new THREE.Matrix3() },
        uR: { value: R },
        uTop: { value: top },
        uH: { value: atm?.H ?? 1 },
        uDens: { value: atm ? atm.tau / atm.H : 0 },
        uScatter: { value: atm?.scatter ?? new THREE.Color(0, 0, 0) },
        uForward: { value: atm?.forward ?? new THREE.Color(0, 0, 0) },
        uBump: { value: 0.32 },
      },
      vertexShader: /* glsl */ `
varying vec3 vWP;
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWP = wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
}`,
      fragmentShader: /* glsl */ `
uniform vec3 uC1; uniform vec3 uC2; uniform vec3 uC3;
uniform vec3 uSpot; uniform float uHasSpot; uniform int uKind; uniform float uSeed; uniform vec3 uSun; uniform float uTime; uniform float uAmb; uniform float uRings;
uniform vec3 uCenter; uniform vec3 uPole; uniform mat3 uW2O; uniform float uR; uniform float uTop; uniform float uH; uniform float uDens;
uniform vec3 uScatter; uniform vec3 uForward; uniform float uBump;
uniform mat4 projectionMatrix;
varying vec3 vWP;
${NOISE3}
${SURFACE}
/* fbm whose octaves fade out before they get finer than a pixel (fp = pixel footprint × base frequency), so close-range relief never aliases */
float fbmBL(vec3 p, float fp) {
  float s = 0.0; float a = 0.5; float fr = 1.0;
  for (int i = 0; i < 6; i++) {
    s += a * (n3(p) - 0.5) * (1.0 - smoothstep(0.12, 0.35, fr * fp));
    p = p * 2.03 + 17.1; fr *= 2.03; a *= 0.5;
  }
  return s + 0.5;
}
void main() {
  vec3 rd = normalize(vWP - cameraPosition);
  vec3 oc = cameraPosition - uCenter;
  float b = dot(oc, rd);
  float c0 = dot(oc, oc);
  float hA = b * b - (c0 - uTop * uTop);
  if (hA <= 0.0) discard;
  float hP = b * b - (c0 - uR * uR);
  float tP = hP > 0.0 ? -b - sqrt(hP) : -1.0;
  bool hit = tP > 0.0;
  float t0 = max(-b - sqrt(hA), 0.0);
  float t1 = hit ? tP : -b + sqrt(hA);
  if (t1 <= t0) discard;

  // —— single scattering along the view ray ——
  float tau = 0.0;
  vec3 ins = vec3(0.0);
  vec3 sunCol = vec3(0.0);
  if (uDens > 0.0) {
    const int NS = 14;
    float ds = (t1 - t0) / float(NS);
    for (int i = 0; i < NS; i++) {
      vec3 q = oc + rd * (t0 + (float(i) + 0.5) * ds);
      float r = length(q);
      float d = exp(-(r - uR) / uH);
      float mu = dot(q / r, uSun);
      // optical depth toward the Sun (Chapman-ish), and the planet's own shadow
      float tSun = uDens * uH * d / max(mu + 0.14, 0.035);
      float lit = smoothstep(-0.16, 0.06, mu);
      float dt = uDens * d * ds;
      vec3 sunT = exp(-tSun * vec3(0.55, 0.8, 1.15));
      ins += dt * exp(-tau) * lit * sunT;
      tau += dt;
    }
  }
  float cosT = dot(rd, uSun);
  float phR = 0.75 * (1.0 + cosT * cosT);
  float g = 0.72;
  float phM = (1.0 - g * g) / pow(1.0 + g * g - 2.0 * g * cosT, 1.5) * 0.08;
  vec3 scat = ins * (uScatter * phR + uForward * phM) * 1.35;

  if (!hit) {
    float a = clamp(1.0 - exp(-tau), 0.0, 1.0);
    gl_FragColor = vec4(scat, a * 0.6);
    gl_FragDepth = 1.0;
    #include <colorspace_fragment>
    return;
  }

  vec3 q = oc + rd * tP;
  vec3 N = q / uR;
  vec3 Pw = uCenter + q;
  vec3 p = normalize(uW2O * N);
  float spec; float cloud; float lights; float relief;
  vec3 col = planetSurface(p, spec, cloud, lights, relief);
  // close-range detail on solid worlds: finer albedo, small craters, relief that resolves as we descend
  if (uKind == 0 || uKind == 1 || uKind == 5) {
    vec3 sp = p + uSeed;
    float px = length(fwidth(p));
    float near = 1.0 - smoothstep(0.0008, 0.006, px);
    float d0 = smoothstep(0.3, 0.7, fbmBL(sp * 13.0 + 7.7, px * 13.0));
    float d1 = fbmBL(sp * 44.0, px * 44.0);
    float d2 = fbmBL(sp * 210.0 + 3.1, px * 210.0);
    float cr = craters(p, 64.0, uSeed + 11.0) * (uKind == 1 ? 1.0 : 0.55);
    // a finer generation of small craters, only once they span a few pixels
    cr += craters(p, 190.0, uSeed + 23.0) * (uKind == 1 ? 0.7 : 0.35) * (1.0 - smoothstep(0.0006, 0.0018, px));
    float streak = uKind == 0 ? smoothstep(0.55, 0.75, fbm3(vec3(sp.x * 30.0, sp.y * 90.0, sp.z * 30.0))) : 0.0;
    float c1 = smoothstep(0.28, 0.72, d1);
    float c2 = smoothstep(0.3, 0.7, d2);
    col *= mix(1.0, (0.78 + 0.44 * d0) * (0.72 + 0.56 * c1) * (0.86 + 0.28 * c2) * (1.0 + cr * 0.22) * (1.0 - streak * 0.22), near);
    relief += (cr * 0.8 + (d0 - 0.5) * 3.0 + (d1 - 0.5) * 2.4 + (d2 - 0.5) * 0.9) * near;
  }
  // bump shading from the relief, by screen-space surface gradient
  vec3 Nb = N;
  if (uKind == 0 || uKind == 1 || uKind == 5) {
    float hs = relief * uBump;
    vec3 dpdx = dFdx(Pw); vec3 dpdy = dFdy(Pw);
    vec3 r1 = cross(dpdy, N); vec3 r2 = cross(N, dpdx);
    float det = dot(dpdx, r1);
    vec3 grad = sign(det) * (dFdx(hs) * r1 + dFdy(hs) * r2);
    // surface slope, clamped so sharp crater rims cannot flip the normal from one pixel quad to the next
    vec3 slope = grad / max(abs(det), 1e-12);
    float sl = length(slope);
    if (sl > 0.9) slope *= 0.9 / sl;
    Nb = abs(det) > 1e-14 ? normalize(N - slope) : N;
  }
  float nl = dot(N, uSun);
  float nlb = dot(Nb, uSun);
  float lit = smoothstep(-0.06, 0.2, nl) * max(nlb, 0.0) * 0.85 + smoothstep(-0.1, 0.35, nl) * 0.15 * max(nlb + 0.3, 0.0);
  // sunlight reaching the ground has crossed the atmosphere: dimmer and redder near the terminator
  vec3 sunTint = uDens > 0.0 ? exp(-min(uDens * uH, 2.0) / max(nl + 0.12, 0.04) * vec3(0.3, 0.45, 0.7)) : vec3(1.0);
  if (uRings > 0.5) {
    float dn = dot(uSun, uPole);
    if (abs(dn) > 1e-3) {
      float t = dot(-q, uPole) / dn;
      if (t > 0.0) lit *= 1.0 - 0.8 * saturnRing(length(q + uSun * t) / uR);
    }
  }
  vec3 V = -rd;
  vec3 c = col * (lit * sunTint + uAmb);
  c = mix(c, vec3(1.0) * (lit + uAmb * 0.5), cloud * 0.9);
  vec3 H = normalize(uSun + V);
  c += spec * (1.0 - cloud) * pow(max(dot(N, H), 0.0), 80.0) * 0.7 * step(0.0, nl) * sunTint;
  c += vec3(1.0, 0.7, 0.36) * lights * (1.0 - smoothstep(-0.15, 0.05, nl)) * (1.0 - cloud * 0.7) * 1.4;
  // the air between us and the ground
  c = c * exp(-tau * 0.85) + scat;
  vec4 clip = projectionMatrix * viewMatrix * vec4(Pw, 1.0);
  gl_FragDepth = clamp(clip.z / clip.w * 0.5 + 0.5, 0.0, 1.0);
  gl_FragColor = vec4(c, 1.0);
  #include <colorspace_fragment>
}`,
      side: THREE.BackSide,
      blending: THREE.CustomBlending,
      blendSrc: THREE.OneFactor,
      blendDst: THREE.OneMinusSrcAlphaFactor,
      depthWrite: true,
      depthTest: true,
    }),
  };
}

/**
 * Rings, in units of the planet's radius (geometry 1.24–2.27 for Saturn). Style 0: Saturn's broad icy
 * rings with the Cassini division; style 1: the narrow, coal-dark rings of Uranus and Neptune.
 * Where the planet blocks the Sun, the rings fall into its shadow.
 */
export function ringMaterial(style = 0) {
  return new THREE.ShaderMaterial({
    uniforms: {
      uInner: { value: 1.24 },
      uOuter: { value: 2.27 },
      uSun: { value: new THREE.Vector3(1, 0.3, 0.2).normalize() },
      uBright: { value: 1 },
      uStyle: { value: style },
      uShadow: { value: 0 },
      uK: { value: 1 },
    },
    vertexShader: /* glsl */ `
varying vec3 vP; varying vec3 vWN; varying vec3 vWP; varying vec3 vCenter; varying float vScale;
void main() {
  vP = position;
  vWN = normalize(mat3(modelMatrix) * normal);
  vWP = (modelMatrix * vec4(position, 1.0)).xyz;
  vCenter = (modelMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
  vScale = length(modelMatrix[0].xyz);
  gl_Position = projectionMatrix * viewMatrix * vec4(vWP, 1.0);
}`,
    fragmentShader: /* glsl */ `
uniform float uInner; uniform float uOuter; uniform vec3 uSun; uniform float uBright; uniform float uStyle; uniform float uShadow;
varying vec3 vP; varying vec3 vWN; varying vec3 vWP; varying vec3 vCenter; varying float vScale;
${NOISE3}
float h(float x) { return fract(sin(x * 127.1) * 43758.5453); }
void main() {
  float r = length(vP.xy) * 1.24 / uInner;
  float a; vec3 col;
  if (uStyle < 0.5) {
    a = saturnRing(r);
    float fine = h(floor((r - 1.24) * 290.0));
    a *= 0.8 + fine * 0.35;
    col = mix(vec3(0.78, 0.7, 0.55), vec3(0.95, 0.9, 0.8), fine);
  } else {
    // a handful of narrow dark rings (Uranus' epsilon ring is the widest and outermost)
    a = 0.0;
    float rings[6] = float[6](1.64, 1.68, 1.73, 1.79, 1.86, 2.0);
    for (int i = 0; i < 6; i++) a += exp(-pow((r - rings[i]) * (i == 5 ? 110.0 : 260.0), 2.0)) * (i == 5 ? 0.9 : 0.55);
    col = vec3(0.13, 0.13, 0.14);
  }
  if (a < 0.003) discard;
  float lit = 0.35 + 0.65 * abs(dot(normalize(vWN), uSun));
  // the planet's shadow on the rings
  if (uShadow > 0.5) {
    vec3 oc = vWP - vCenter;
    float b = dot(oc, uSun);
    float cc = dot(oc, oc) - vScale * vScale;
    if (b < 0.0 && b * b - cc > 0.0) lit *= 0.06;
  }
  gl_FragColor = vec4(col * lit * uBright, min(a, 1.0) * 0.92);
  #include <colorspace_fragment>
}`,
    transparent: true,
    side: THREE.DoubleSide,
    depthWrite: false,
  });
}

/** The photosphere: boiling granulation, sunspots in the active latitudes, limb darkening. */
export function sunMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uK: { value: 1 } },
    vertexShader: /* glsl */ `
varying vec3 vObj; varying vec3 vWN; varying vec3 vWP;
void main() { vObj = normalize(position); vWN = normalize(mat3(modelMatrix) * normal); vec4 wp = modelMatrix * vec4(position, 1.0); vWP = wp.xyz; gl_Position = projectionMatrix * viewMatrix * wp; }`,
    fragmentShader: /* glsl */ `
uniform float uTime;
varying vec3 vObj; varying vec3 vWN; varying vec3 vWP;
${NOISE3}
void main() {
  vec3 p = vObj;
  float mu = max(dot(normalize(vWN), normalize(cameraPosition - vWP)), 0.0);
  float gran = fbm3(p * 38.0 + vec3(uTime * 0.07, -uTime * 0.05, uTime * 0.04));
  float coarse = fbm3(p * 7.0 + uTime * 0.01);
  // spots live between ~5° and ~35° latitude
  float band = smoothstep(0.08, 0.15, abs(p.y)) * (1.0 - smoothstep(0.5, 0.62, abs(p.y)));
  float sn = fbm3(p * 5.0 + 3.7);
  float spot = smoothstep(0.66, 0.74, sn) * band;
  float umbra = smoothstep(0.71, 0.76, sn) * band;
  // limb darkening (Eddington-ish) and the colour shift toward the limb
  float limb = 0.3 + 0.7 * pow(mu, 0.6);
  vec3 core = vec3(1.0, 0.7, 0.32);
  vec3 edge = vec3(0.9, 0.26, 0.03);
  vec3 c = mix(edge, core, pow(mu, 0.45)) * limb;
  // granulation: bright cell tops, dark intergranular lanes
  c *= 0.72 + 0.56 * gran + 0.12 * coarse;
  c *= 1.0 - spot * 0.45 - umbra * 0.4;
  // faculae: bright patches near the limb
  c += vec3(1.0, 0.85, 0.6) * smoothstep(0.62, 0.7, coarse) * (1.0 - mu) * 0.4;
  // pre-saturated for AgX, and kept below full white so granulation, spots and the orange limb survive the bloom
  gl_FragColor = vec4(c * 2.1, 1.0);
}`,
  });
}

/** The corona and glare around the Sun: a camera-facing quad (half-size `q` sun radii) with streamers. */
export function coronaMaterial(q: number) {
  return new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uQ: { value: q }, uK: { value: 1 } },
    vertexShader: /* glsl */ `varying vec2 vUv; void main() { vUv = uv * 2.0 - 1.0; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: /* glsl */ `
uniform float uTime; uniform float uQ;
varying vec2 vUv;
float hh(float x) { return fract(sin(x * 91.7) * 43758.5453); }
float n1(float x) { float i = floor(x); float f = fract(x); f = f * f * (3.0 - 2.0 * f); return mix(hh(i), hh(i + 1.0), f); }
void main() {
  float r = length(vUv) * uQ;
  float ang = atan(vUv.y, vUv.x);
  float k = max(r - 1.0, 0.0);
  float streak = 0.55 + 0.45 * n1(ang * 9.0 + uTime * 0.03) * n1(ang * 23.0 - uTime * 0.02 + 4.0) * 2.0;
  float corona = exp(-k * 3.6) * 1.1 * streak + exp(-k * 1.6) * 0.18;
  float glare = exp(-length(vUv) * 6.0) * 0.35;
  float fade = 1.0 - smoothstep(0.7, 1.0, length(vUv));
  vec3 c = (vec3(1.0, 0.86, 0.66) * corona + vec3(1.0, 0.8, 0.55) * glare) * fade;
  gl_FragColor = vec4(c, 1.0);
}`,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
}

/** The Milky Way: a faint band along the galactic plane, brightest toward Sagittarius, split by dust lanes. */
export function milkyWayMaterial(north: THREE.Vector3, center: THREE.Vector3) {
  return new THREE.ShaderMaterial({
    uniforms: { uN: { value: north.clone() }, uC: { value: center.clone() }, uK: { value: 1 }, uBright: { value: 1 } },
    vertexShader: /* glsl */ `varying vec3 vDir; void main() { vDir = position; vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0); gl_Position = vec4(p.xy, p.w * 0.99999, p.w); }`,
    fragmentShader: /* glsl */ `
uniform vec3 uN; uniform vec3 uC; uniform float uBright;
varying vec3 vDir;
${NOISE3}
void main() {
  vec3 d = normalize(vDir);
  float b = dot(d, uN);
  float toC = dot(d, uC);
  float clump = fbm3(d * 9.0);
  float fine = fbm3(d * 34.0);
  float band = exp(-b * b / (0.022 + 0.02 * clump));
  float bulge = exp(-(1.0 - toC) * 5.0) * exp(-b * b / 0.04);
  float lane = exp(-pow(b + 0.012 * (clump - 0.5), 2.0) / 0.0009) * smoothstep(0.35, 0.65, fbm3(d * 14.0)) * (0.5 + bulge);
  float glow = (band * (0.55 + 0.6 * clump) * (0.75 + 0.5 * fine) + bulge * 1.2) * (1.0 - lane * 0.85);
  vec3 col = mix(vec3(0.58, 0.64, 0.82), vec3(1.0, 0.86, 0.66), clamp(bulge * 1.5 + 0.15, 0.0, 1.0));
  // a few reddish emission nebulae along the band
  col += vec3(0.6, 0.1, 0.15) * smoothstep(0.72, 0.8, fbm3(d * 18.0 + 5.0)) * band * 0.6;
  gl_FragColor = vec4(col * glow * 0.075 * uBright, 1.0);
}`,
    side: THREE.BackSide,
    depthWrite: false,
    depthTest: false,
  });
}
