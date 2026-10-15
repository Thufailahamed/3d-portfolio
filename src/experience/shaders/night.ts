import * as THREE from "three";

/**
 * The projects valley at night: one moon, one sky, one haze, shared by every surface in it
 * so the mountains, banks, water and sky all melt into the same air.
 */
export const MOON_DIR = new THREE.Vector3(-0.45, 0.55, -0.7).normalize();

const v3 = (v: THREE.Vector3) => `vec3(${v.x.toFixed(4)}, ${v.y.toFixed(4)}, ${v.z.toFixed(4)})`;

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
const vec3 MOON_DIR = ${v3(MOON_DIR)};
const vec3 MOON_LIGHT = vec3(0.44, 0.52, 0.72);
const vec3 SKY_LIGHT = vec3(0.012, 0.018, 0.036);
const vec3 ZENITH = vec3(0.0018, 0.0030, 0.0085);
const vec3 HORIZON = vec3(0.014, 0.021, 0.038);

/** The sky's colour in direction d (and the haze, looking at or below the horizon). */
vec3 nightSky(vec3 d){
  float up = max(d.y, 0.0);
  vec3 col = mix(HORIZON, ZENITH, pow(up, 0.45));
  float m = max(dot(d, MOON_DIR), 0.0);
  // moonlit air: a broad glow on the moon's side of the sky, a tighter halo near it
  col += vec3(0.020, 0.026, 0.040) * pow(m, 3.0) + vec3(0.05, 0.06, 0.08) * pow(m, 40.0);
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
  vec3 haze = nightSky(normalize(vec3(d.x, max(d.y, 0.0) * 0.25, d.z)));
  col = mix(col, haze, 1.0 - exp(-pow(dist * 0.02, 1.7)));
  float mist = exp(-max(W.y, 0.0) * 1.8) * (1.0 - exp(-dist * 0.05));
  mist *= 0.55 + 0.45 * vnoise(vec3(W.xz * 0.16 + vec2(uTime * 0.05, uTime * 0.012), uTime * 0.03));
  return mix(col, haze * 1.5 + vec3(0.003, 0.004, 0.006), clamp(mist, 0.0, 1.0) * 0.5);
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
  return normalize(abs(det) * N - grad * strength);
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

  // a faint, dusty band of the galaxy across the sky
  vec3 band = normalize(vec3(0.35, 0.2, 0.92));
  float g = exp(-pow(dot(d, band) * 3.2, 2.0));
  float dust = fbm3(d * 7.0) * 0.5 + 0.5;
  col += vec3(0.010, 0.011, 0.016) * g * smoothstep(0.35, 0.9, dust) * up;

  // stars thin out toward the hazy horizon and near the moon
  float moonWash = 1.0 - smoothstep(0.93, 0.995, dot(d, MOON_DIR));
  float s = stars(d, 160.0, 0.18) * 0.9 + stars(d, 320.0, 0.25) * 0.45 + stars(d, 60.0, 0.05) * 1.4;
  s *= (0.25 + 0.75 * g * smoothstep(0.4, 0.8, dust) + 0.45) * up * moonWash * smoothstep(0.0, 0.25, d.y);
  vec3 h = hash33(floor(d * 160.0));
  vec3 starCol = mix(vec3(1.0, 0.82, 0.65), vec3(0.75, 0.85, 1.0), h.y);
  col += starCol * s * 0.9;

  // the moon: a small bright disc with a little texture, and its halo
  float md = acos(clamp(dot(d, MOON_DIR), -1.0, 1.0));
  float disc = smoothstep(0.022, 0.019, md);
  float maria = 0.82 + 0.18 * vnoise(d * 220.0);
  col = mix(col, vec3(2.6, 2.55, 2.4) * maria, disc);
  col += vec3(0.10, 0.11, 0.13) * exp(-md * 26.0);

  // thin high wisps, lit from the moon's side
  float w = fbm3(vec3(d.xz / max(d.y + 0.15, 0.05) * 0.8 + vec2(uTime * 0.004, 0.0), 2.0));
  float wisp = smoothstep(0.15, 0.6, w) * smoothstep(0.02, 0.2, d.y) * (1.0 - smoothstep(0.5, 0.9, d.y));
  col = mix(col, nightSky(d) * 1.8 + vec3(0.012, 0.014, 0.02) * pow(max(dot(d, MOON_DIR), 0.0), 2.0), wisp * 0.6);

  // the active project's colour, barely, in the air low over the range
  col += uTint * 0.0025 * (1.0 - smoothstep(0.0, 0.35, d.y));
  gl_FragColor = vec4(col, 1.0);
}`;
