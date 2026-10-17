import * as THREE from "three";

/**
 * The projects valley at night: one moon, one sky, one haze, shared by every surface in it
 * so the mountains, banks, water and sky all melt into the same air.
 */
export const MOON_DIR = new THREE.Vector3(-0.45, 0.55, -0.7).normalize();

const c = (r: number, g: number, b: number) => new THREE.Color(r, g, b);
/** The valley's light in each weather (linear values). Night is the original moonlit look. */
const LOOKS = {
  night: {
    dir: MOON_DIR,
    light: c(0.44, 0.52, 0.72),
    sky: c(0.012, 0.018, 0.036),
    zenith: c(0.0018, 0.003, 0.0085),
    horizon: c(0.014, 0.021, 0.038),
    glow: c(0.02, 0.026, 0.04),
    haze: 0.02,
    mist: 0.5,
  },
  // a clear morning: low sun from the left, blue sky, a pale haze down the valley
  day: {
    dir: new THREE.Vector3(-0.62, 0.5, 0.2).normalize(),
    light: c(2.3, 2.05, 1.7),
    sky: c(0.32, 0.42, 0.62),
    zenith: c(0.07, 0.17, 0.48),
    horizon: c(0.42, 0.52, 0.64),
    glow: c(0.32, 0.26, 0.16),
    haze: 0.011,
    mist: 0.16,
  },
  // overcast and pouring: no direct light, a low grey sky, thick air
  rain: {
    dir: new THREE.Vector3(0.1, 1, 0.2).normalize(),
    light: c(0.07, 0.076, 0.085),
    sky: c(0.075, 0.082, 0.092),
    zenith: c(0.03, 0.034, 0.04),
    horizon: c(0.06, 0.066, 0.074),
    glow: c(0, 0, 0),
    haze: 0.036,
    mist: 0.75,
  },
};
const FLASH = c(0.35, 0.4, 0.55);

/** Shared by every material in the valley that includes nightGlsl (spread into its uniforms). */
export const valleyLight = {
  uLightDir: { value: MOON_DIR.clone() },
  uLightCol: { value: LOOKS.night.light.clone() },
  uSkyCol: { value: LOOKS.night.sky.clone() },
  uZenith: { value: LOOKS.night.zenith.clone() },
  uHorizon: { value: LOOKS.night.horizon.clone() },
  uGlow: { value: LOOKS.night.glow.clone() },
  uHaze: { value: LOOKS.night.haze },
  uMist: { value: LOOKS.night.mist },
  uDay: { value: 0 },
  uWet: { value: 0 },
  uFlash: { value: 0 },
};

/** Blends the valley's light: night → day (by `day`) → storm (by `wet`), plus a lightning flash. */
export function setValleyLight(day: number, wet: number, flash: number) {
  const u = valleyLight;
  const { night: n, day: d, rain: r } = LOOKS;
  u.uLightDir.value.copy(n.dir).lerp(d.dir, day).lerp(r.dir, wet).normalize();
  const col = (key: "light" | "sky" | "zenith" | "horizon" | "glow", out: THREE.Color) =>
    out.copy(n[key]).lerp(d[key], day).lerp(r[key], wet);
  col("light", u.uLightCol.value);
  col("sky", u.uSkyCol.value).lerp(FLASH, flash * 0.5);
  col("zenith", u.uZenith.value).lerp(FLASH, flash * 0.25);
  col("horizon", u.uHorizon.value).lerp(FLASH, flash * 0.3);
  col("glow", u.uGlow.value);
  u.uHaze.value = n.haze + (d.haze - n.haze) * day + (r.haze - n.haze) * wet;
  u.uMist.value = n.mist + (d.mist - n.mist) * day + (r.mist - n.mist) * wet;
  u.uDay.value = day;
  u.uWet.value = wet;
  u.uFlash.value = flash;
}

/** Cheap value noise + fbm (no simplex: these run on every pixel of the range). */
export const valueNoiseGlsl = /* glsl */ `
float vhash(vec3 p){
  p = fract(p * 0.3183099 + vec3(0.71, 0.113, 0.419));
  p *= 17.0;
  return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
}
float vnoise(vec3 x){
  vec3 i = floor(x);
  vec3 f = fract(x);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(vhash(i), vhash(i + vec3(1, 0, 0)), f.x),
                 mix(vhash(i + vec3(0, 1, 0)), vhash(i + vec3(1, 1, 0)), f.x), f.y),
             mix(mix(vhash(i + vec3(0, 0, 1)), vhash(i + vec3(1, 0, 1)), f.x),
                 mix(vhash(i + vec3(0, 1, 1)), vhash(i + vec3(1, 1, 1)), f.x), f.y), f.z) * 2.0 - 1.0;
}
float fbm3(vec3 p){
  float s = 0.0, a = 0.5;
  for (int i = 0; i < 3; i++){ s += a * vnoise(p); p = p * 2.03 + 1.7; a *= 0.5; }
  return s;
}
float fbm5(vec3 p){
  float s = 0.0, a = 0.5;
  for (int i = 0; i < 5; i++){ s += a * vnoise(p); p = p * 2.03 + 1.7; a *= 0.5; }
  return s;
}
`;

/**
 * Light and air. Needs valueNoiseGlsl and a \`uTime\` uniform declared before it.
 * Radiance is linear and kept well under the bloom threshold, except where light really is hot.
 */
export const nightGlsl = /* glsl */ `
uniform vec3 uLightDir;
uniform vec3 uLightCol;
uniform vec3 uSkyCol;
uniform vec3 uZenith;
uniform vec3 uHorizon;
uniform vec3 uGlow;
uniform float uHaze;
uniform float uMist;
uniform float uDay;
uniform float uWet;
uniform float uFlash;
// the key light is the moon by night and the sun by day (names kept from the night-only valley)
#define MOON_DIR uLightDir
#define MOON_LIGHT uLightCol
#define SKY_LIGHT uSkyCol
#define ZENITH uZenith
#define HORIZON uHorizon

/** The sky's colour in direction d (and the haze, looking at or below the horizon). */
vec3 nightSky(vec3 d){
  float up = max(d.y, 0.0);
  vec3 col = mix(HORIZON, ZENITH, pow(up, 0.45));
  float m = max(dot(d, MOON_DIR), 0.0);
  // moonlit air: a broad glow on the moon's side of the sky, a tighter halo near it
  col += uGlow * (pow(m, 3.0) + 2.2 * pow(m, 40.0));
  return col;
}

/** Simple diffuse shading under the moon and the sky dome. */
vec3 nightLight(vec3 albedo, vec3 N){
  float lam = max(dot(N, MOON_DIR), 0.0);
  return albedo * (MOON_LIGHT * lam + SKY_LIGHT * (0.6 + 0.4 * N.y));
}

/** Aerial perspective, plus a low mist that drifts over the water and pools in the valley. */
vec3 nightAir(vec3 col, vec3 W){
  vec3 toP = W - cameraPosition;
  float dist = length(toP);
  vec3 d = toP / dist;
  vec3 haze = nightSky(normalize(vec3(d.x, max(d.y, 0.0) * 0.25, d.z) + vec3(0.0, 1e-4, 0.0)));
  // looking steeply down (climbing out of the valley) the view's horizontal heading is noise:
  // the haze would swing across the moon's glow in a bright fan. Down there it's the plain horizon
  haze = mix(haze, HORIZON + uGlow * 0.6, smoothstep(0.55, 0.9, -d.y));
  col = mix(col, haze, 1.0 - exp(-pow(dist * uHaze, 1.7)));
  float mist = exp(-max(W.y, 0.0) * 1.8) * (1.0 - exp(-dist * 0.05));
  mist *= 0.55 + 0.45 * vnoise(vec3(W.xz * 0.16 + vec2(uTime * 0.05, uTime * 0.012), uTime * 0.03));
  return mix(col, haze * 1.5 + vec3(0.003, 0.004, 0.006), clamp(mist, 0.0, 1.0) * uMist);
}

/**
 * Perturbs N by a scalar height field h over the surface (Mikkelsen's surface gradient).
 * Reflections (MIRROR) skip it: the water blurs that detail away, and the height field
 * feeding it is then compiled out.
 */
#ifdef MIRROR
vec3 bumpNormal(vec3 P, vec3 N, float h, float strength){ return N; }
#else
vec3 bumpNormal(vec3 P, vec3 N, float h, float strength){
  vec3 dpx = dFdx(P);
  vec3 dpy = dFdy(P);
  vec3 r1 = cross(dpy, N);
  vec3 r2 = cross(N, dpx);
  float det = dot(dpx, r1);
  vec3 grad = sign(det) * (dFdx(h) * r1 + dFdy(h) * r2);
  vec3 b = abs(det) * N - grad * strength;
  // degenerate (a surface seen exactly edge-on or from straight above): normalising zero would
  // give NaN, which the bloom smears into blocks
  return dot(b, b) > 1e-20 ? normalize(b) : N;
}
#endif
`;

/** The sky dome: gradient, stars (with a faint band of the galaxy), the moon and a few wisps. */
export const skyVert = /* glsl */ `
varying vec3 vDir;
void main(){
  vDir = position;
  vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  gl_Position = p.xyww;   // on the far plane: behind everything
}`;

export const skyFrag = /* glsl */ `
uniform float uTime;
uniform vec3 uTint;
varying vec3 vDir;
${valueNoiseGlsl}
${nightGlsl}

vec3 hash33(vec3 p){
  p = fract(p * vec3(0.1031, 0.1030, 0.0973));
  p += dot(p, p.yxz + 33.33);
  return fract((p.xxy + p.yxx) * p.zyx);
}

// one layer of stars: a jittered point per cell, sized to the pixel so they stay crisp
float stars(vec3 d, float scale, float density){
  vec3 p = d * scale;
  vec3 c = floor(p);
  vec3 h = hash33(c);
  if (h.x > density) return 0.0;
  vec3 q = fract(p) - 0.5 - (h - 0.5) * 0.7;
  float px = length(fwidth(p));
  float r = px * (0.55 + 0.9 * h.y * h.y);
  float s = smoothstep(r, r * 0.25, length(q));
  float tw = 0.7 + 0.3 * sin(uTime * (1.5 + h.z * 4.0) + h.y * 60.0);
  return s * pow(h.z, 2.5) * tw;
}

void main(){
  vec3 d = normalize(vDir);
  vec3 col = nightSky(d);
  float up = smoothstep(-0.02, 0.12, d.y);

  // what shows by night: neither sun nor cloud cover
  float night = (1.0 - uDay) * (1.0 - uWet);

  // a faint, dusty band of the galaxy across the sky
  vec3 band = normalize(vec3(0.35, 0.2, 0.92));
  float g = exp(-pow(dot(d, band) * 3.2, 2.0));
  float dust = fbm3(d * 7.0) * 0.5 + 0.5;
  col += vec3(0.010, 0.011, 0.016) * g * smoothstep(0.35, 0.9, dust) * up * night;

  // stars thin out toward the hazy horizon and near the moon
  float moonWash = 1.0 - smoothstep(0.93, 0.995, dot(d, MOON_DIR));
  float s = stars(d, 160.0, 0.18) * 0.9 + stars(d, 320.0, 0.25) * 0.45 + stars(d, 60.0, 0.05) * 1.4;
  s *= (0.25 + 0.75 * g * smoothstep(0.4, 0.8, dust) + 0.45) * up * moonWash * smoothstep(0.0, 0.25, d.y);
  vec3 h = hash33(floor(d * 160.0));
  vec3 starCol = mix(vec3(1.0, 0.82, 0.65), vec3(0.75, 0.85, 1.0), h.y);
  col += starCol * s * 0.9 * night;

  // the moon by night (a small textured disc), the sun by day; both gone behind the rain
  float md = acos(clamp(dot(d, MOON_DIR), -1.0, 1.0));
  float maria = 0.82 + 0.18 * vnoise(d * 220.0);
  vec3 discCol = mix(vec3(2.6, 2.55, 2.4) * maria, vec3(40.0, 36.0, 30.0), uDay);
  float disc = smoothstep(mix(0.022, 0.03, uDay), mix(0.019, 0.026, uDay), md) * (1.0 - uWet);
  col = mix(col, discCol, disc);
  col += mix(vec3(0.10, 0.11, 0.13), vec3(1.1, 0.95, 0.7), uDay) * exp(-md * mix(26.0, 9.0, uDay)) * (1.0 - uWet);

  // clouds: thin high wisps by night, fair-weather cumulus by day, a low grey ceiling in the rain
  float drift = uTime * mix(0.004, 0.025, uWet);
  vec2 cq = d.xz / max(d.y + 0.15, 0.05);
  float w = fbm3(vec3(cq * mix(0.8, 1.1, uDay) + vec2(drift, drift * 0.3), 2.0)) + vnoise(vec3(cq * 4.0, uTime * 0.02)) * 0.12 * uDay;
  float cover = mix(mix(0.15, 0.02, uDay), -0.75, uWet);
  float cloud = smoothstep(cover, cover + mix(0.45, 0.25, uDay), w) * smoothstep(0.0, 0.18, d.y);
  cloud *= mix(1.0 - smoothstep(0.5, 0.9, d.y), 1.0, max(uDay, uWet));
  float toSun = pow(max(dot(d, MOON_DIR), 0.0), 2.0);
  vec3 nightCloud = nightSky(d) * 1.8 + vec3(0.012, 0.014, 0.02) * toSun;
  vec3 dayCloud = mix(vec3(0.48, 0.54, 0.64), vec3(1.5, 1.42, 1.3), smoothstep(-0.1, 0.5, w - cover + toSun * 0.4));
  vec3 rainCloud = vec3(0.04, 0.045, 0.052) * (0.65 + 0.7 * smoothstep(-0.6, 0.6, w)) + vec3(0.5, 0.55, 0.7) * uFlash * 0.4;
  vec3 cloudCol = mix(mix(nightCloud, dayCloud, uDay), rainCloud, uWet);
  col = mix(col, cloudCol, cloud * mix(mix(0.6, 0.9, uDay), 1.0, uWet));

  // the active project's colour, barely, in the air low over the range
  col += uTint * 0.0025 * (1.0 - smoothstep(0.0, 0.35, d.y));
  gl_FragColor = vec4(col, 1.0);
}`;
