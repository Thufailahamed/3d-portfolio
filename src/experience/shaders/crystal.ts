import { nightGlsl, valueNoiseGlsl } from "./night";

/** How many ripples can be running across the crystal at once. */
export const RIPPLES = 12;

/**
 * Ripples on the crystal, in its own space (they turn with it). Each starts at a point on the
 * surface and spreads outward as a decaying ring of waves, like a touch on still water.
 * Returns the height and its gradient.
 */
const rippleGlsl = /* glsl */ `
uniform vec4 uRip[${RIPPLES}];     // xyz: where it started, w: when
uniform float uRipAmp[${RIPPLES}];
uniform float uTime;
const float RIP_K = 24.0;            // wavenumber (wavelength ≈ 0.26)
const float RIP_SPEED = 0.7;
float ripple(vec3 p, out vec3 grad){
  float h = 0.0;
  grad = vec3(0.0);
  for (int i = 0; i < ${RIPPLES}; i++){
    float tau = uTime - uRip[i].w;
    if (tau < 0.0 || tau > 3.5 || uRipAmp[i] <= 0.0) continue;
    vec3 dv = p - uRip[i].xyz;
    float d = length(dv) + 1e-4;
    float front = RIP_SPEED * tau;
    // waves only behind the leading edge, fading with time and distance
    float env = uRipAmp[i] * exp(-tau * 1.3) * exp(-d * 1.4) * smoothstep(front + 0.05, front - 0.3, d);
    float ph = RIP_K * (d - front);
    h += sin(ph) * env;
    grad += (RIP_K * cos(ph) - 1.4 * sin(ph)) * env * dv / d;
  }
  return h;
}
`;

export const crystalVert = /* glsl */ `
attribute vec3 aBary;
uniform float uRipDepth;
varying vec3 vWorld;
varying vec3 vN;
varying vec3 vLocal;
varying vec3 vBary;
varying vec2 vScreen;
varying float vDepth;
${rippleGlsl}
void main(){
  vec3 n = normalize(normal);
  vec3 g;
  float h = ripple(position, g);
  // the surface itself rises and falls with the waves (flat facets: along their normal),
  // pinned at the facet edges so neighbouring faces never part
  float rim = smoothstep(0.0, 0.12, min(min(aBary.x, aBary.y), aBary.z));
  vec3 p = position + n * h * uRipDepth * rim;
  vec4 w = modelMatrix * vec4(p, 1.0);
  vWorld = w.xyz;
  vN = normalize(mat3(modelMatrix) * n);
  vLocal = position;
  vBary = aBary;
  // where this point sits relative to the crystal's centre, as seen from the camera
  vec4 v = viewMatrix * w;
  vec4 c = viewMatrix * modelMatrix * vec4(0.0, 0.0, 0.0, 1.0);
  vScreen = v.xy - c.xy;
  vDepth = v.z - c.z;
  gl_Position = projectionMatrix * v;
}`;

/**
 * Clear quartz. The valley behind it (rendered without the crystal, uScene) is refracted
 * through each facet and split into faint colour; inside, the light bounces off internal
 * faces and catches on milky veils. The surface reflects the night sky and flashes the moon.
 */
export const crystalFrag = /* glsl */ `
uniform sampler2D uScene;
uniform vec2 uRes;
uniform mat3 uRot;          // crystal space → world (rotation only)
uniform vec3 uTint;
uniform float uPulse;
uniform float uReflect;
uniform float uRipDepth;
varying vec3 vWorld;
varying vec3 vN;
varying vec3 vLocal;
varying vec3 vBary;
varying vec2 vScreen;
varying float vDepth;
${rippleGlsl}
${valueNoiseGlsl}
${nightGlsl}

vec3 hash33(vec3 p){
  p = fract(p * vec3(0.1031, 0.1030, 0.0973));
  p += dot(p, p.yxz + 33.33);
  return fract((p.xxy + p.yxx) * p.zyx);
}
float edgeLine(float px){
  vec3 d = max(fwidth(vBary), vec3(1e-4));
  vec3 a = smoothstep(vec3(0.0), d * px, vBary);
  return 1.0 - min(min(a.x, a.y), a.z);
}
vec3 spectrum(float x){
  return clamp(abs(fract(x + vec3(0.0, 0.333, 0.667)) * 6.0 - 3.0) - 1.0, 0.0, 1.0);
}
vec3 env(vec3 R){
  // the night sky, a little brighter than the eye sees it directly, and the moon's glow
  // (the night sky is lifted so the facets read; daylight needs no help)
  vec3 sky = nightSky(normalize(vec3(R.x, max(R.y, 0.0), R.z))) * mix(5.0, 1.1, uDay)
           + MOON_LIGHT * pow(max(dot(R, MOON_DIR), 0.0), 8.0) * 0.22;
  vec3 ground = vec3(0.004, 0.005, 0.007) + uTint * 0.01;
  return mix(ground, sky, smoothstep(-0.08, 0.05, R.y));
}
vec3 scene(vec2 uv){
  return texture2D(uScene, clamp(uv, vec2(0.001), vec2(0.999))).rgb;
}

void main(){
  vec3 N = normalize(vN);
  vec3 V = normalize(cameraPosition - vWorld);

  // ripples tilt the surface: a water-like distortion of everything seen through and on it
  vec3 g;
  float h = ripple(vLocal, g);
  vec3 gw = uRot * g;
  gw -= N * dot(gw, N);
  N = normalize(N - gw * uRipDepth * 1.6);

  float cosV = clamp(dot(N, V), 0.0, 1.0);
  float F = 0.045 + 0.955 * pow(1.0 - cosV, 5.0);   // quartz, n ≈ 1.54

  // into the stone; the inside has its own faces (hashed by direction, turning with the crystal)
  vec3 Rin = refract(-V, N, 1.0 / 1.54);
  vec3 RinL = Rin * uRot;                            // inverse rotation: world → crystal space
  vec3 cell = floor(RinL * 2.2 + 0.5);
  vec3 inner = normalize(hash33(cell + 7.0) - 0.5);
  vec3 innerW = uRot * inner;

  // refraction: bend the scene behind by the facet and the inner face, each colour a little differently
  vec2 uv = gl_FragCoord.xy / uRes;
  vec3 Nv = normalize((viewMatrix * vec4(N, 0.0)).xyz);
  vec3 Iv = normalize((viewMatrix * vec4(innerW, 0.0)).xyz);
  vec2 off = Nv.xy * 0.04 + Iv.xy * 0.025;
  vec3 through = vec3(scene(uv + off * 0.88).r, scene(uv + off).g, scene(uv + off * 1.16).b);

  // smoky quartz: most of the light through it is swallowed; what's left is faintly tinted
  vec3 smoke = mix(vec3(0.16, 0.15, 0.18), uTint * 0.22, 0.25);
  float thick = 0.7 + 0.9 * cosV;
  through *= pow(smoke, vec3(0.35 + thick * 0.5)) * 0.6;
  vec3 bounce = reflect(Rin, innerW);
  through += env(bounce) * smoke * 0.6;

  // the heart: a cloud of light hanging in the middle of the stone. The view refracts in
  // through the facet and meets it on a plane through the centre, so it shifts with the
  // angle like something really inside.
  vec3 Rv = normalize((viewMatrix * vec4(Rin, 0.0)).xyz);
  float travel = max(vDepth, 0.0) / max(-Rv.z, 0.25);
  vec2 hit = vScreen + Rv.xy * travel;
  vec2 q = hit / vec2(0.46, 0.6);
  float r = length(q);
  // every project's colour glows equally bright (lime would otherwise outshine violet)
  vec3 hue = uTint * (0.5 / max(dot(uTint, vec3(0.2126, 0.7152, 0.0722)), 0.2));
  // slow currents and fine bright filaments drifting through it
  float t = uTime * 0.12;
  float swirl = fbm3(vec3(q * 1.8 + vec2(sin(t * 1.3), cos(t)) * 0.3, t));
  float fil = vnoise(vec3(q * 8.0 + swirl * 1.4, t * 2.0));
  fil = pow(1.0 - abs(fil), 10.0);
  // fine cellular web, like circuitry etched inside the core
  vec2 wq = q * 5.0 + swirl * 0.8;
  vec2 wi = floor(wq), wf = fract(wq);
  float d1 = 9.0, d2 = 9.0;
  for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++){
    vec2 o = vec2(float(i), float(j));
    vec2 pt = 0.5 + 0.45 * sin(uTime * 0.25 + 6.2831 * hash33(vec3(wi + o, 1.0)).xy);
    float d = length(o + pt - wf);
    if (d < d1){ d2 = d1; d1 = d; } else if (d < d2) d2 = d;
  }
  float web = 1.0 - smoothstep(0.0, 0.09, d2 - d1);
  fil = max(fil, web * 0.8);
  float body = exp(-r * r * 2.6);
  float power = 1.0 + uPulse * 0.6;
  float energy = body * (0.6 + 0.4 * smoothstep(-0.4, 0.6, swirl)) + fil * body * body * 0.3;
  // white-hot at the centre, the project's colour toward the edges of the glow
  vec3 heart = mix(hue, vec3(1.0), exp(-r * r * 12.0) * 0.5 + fil * 0.1);
  float coreMask = smoothstep(1.4, 0.0, r);
  vec3 core = heart * energy * 2.1 * power;
  core += hue * web * body * body * 0.9 * power;
  // its light fills the stone around it, fading toward the faces
  core += hue * exp(-r * r * 1.6) * 0.06 * power;
  core += hue * exp(-r * r * 0.3) * 0.012;

  // inside: smoky veils, lit by the core
  vec3 inside = vec3(0.0);
  vec3 p = vLocal;
  for (int i = 0; i < 5; i++){
    p += RinL * 0.12;
    float veil = smoothstep(0.4, 0.8, vnoise(p * vec3(2.4, 0.9, 2.4) + 3.1) * 0.6 + vnoise(p * 7.0) * 0.4 + 0.25);
    float glow = exp(-dot(p.xz, p.xz) * 5.0 - p.y * p.y * 0.8);
    inside += uTint * glow * veil * 0.03 * power + MOON_LIGHT * veil * 0.004;
  }
  // light bouncing off the inner faces: a few hard sparkles and their fire
  float sb = max(dot(bounce, MOON_DIR), 0.0);
  inside += MOON_LIGHT * pow(sb, 120.0) * 0.6;
  inside += spectrum(hash33(cell).x + dot(bounce, vec3(0.7))) * pow(sb, 26.0) * 0.08;

  // the surface: a deep, polished reflection of the sky, the moon or sun as a hard glint
  vec3 R = reflect(-V, N);
  float m = max(dot(R, MOON_DIR), 0.0);
  vec3 surface = env(R) * 1.4 + MOON_LIGHT * (pow(m, 600.0) * 10.0 + pow(m, 50.0) * 0.12);

  vec3 col = (through + core + inside) * (1.0 - F) + surface * F;

  // studio rims: a warm light from the left and a cool one from the right graze the edges,
  // split into colour where the glass is thin
  vec3 Nv2 = normalize((viewMatrix * vec4(N, 0.0)).xyz);
  float rim = pow(1.0 - cosV, 4.0);
  vec3 rimCol = mix(vec3(0.9, 0.22, 0.32), vec3(0.22, 0.5, 1.0), smoothstep(-0.35, 0.35, Nv2.x));
  col += rimCol * rim * 0.22;
  col += spectrum(cosV * 1.7 + Nv2.x * 0.5) * pow(rim, 1.5) * 0.06;
  // facet edges: a fine bright line, brighter where a light catches it
  float line = edgeLine(1.1);
  col += (vec3(0.7, 0.75, 0.85) * (0.03 + pow(m, 30.0) * 0.6) + rimCol * rim * 0.4) * line;
  // the ripples: crests catch the light as they run across the faces
  float wave = clamp(length(gw) * uRipDepth * 2.0, 0.0, 1.0);
  float sheen = pow(max(dot(R, normalize(vec3(-0.25, 0.75, 0.6))), 0.0), 18.0);
  col += (MOON_LIGHT * 0.4 * sheen + env(R) * 0.5 + rimCol * 0.15) * wave;
  col += uTint * 0.05 * h * coreMask;

  if (uReflect > 0.5) col *= 0.55;
  gl_FragColor = vec4(min(col, vec3(4.0)), 1.0);
}`;

/** Soft pool of tinted light on the floor under the crystal. */
export const floorGlowFrag = /* glsl */ `
uniform vec3 uTint;
uniform float uPulse;
varying vec2 vUv;
void main(){
  float d = length(vUv - 0.5) * 2.0;
  // the core's light pooled on the water and the stone below
  float g = exp(-d * d * 7.0) * 0.12 + exp(-d * d * 40.0) * 0.1;
  gl_FragColor = vec4(uTint * g * (1.0 + uPulse * 0.8), 1.0);
}`;

export const planeVert = /* glsl */ `
varying vec2 vUv;
void main(){
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;
