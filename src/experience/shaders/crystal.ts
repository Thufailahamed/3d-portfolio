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
  gl_Position = projectionMatrix * viewMatrix * w;
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
  vec3 through = vec3(scene(uv + off * 0.93).r, scene(uv + off).g, scene(uv + off * 1.08).b);

  // the body colour: pale, deeper where the path through the stone is longer
  vec3 bodyTint = mix(vec3(1.0), uTint, 0.22);
  float thick = 0.7 + 0.9 * cosV;
  through *= pow(bodyTint, vec3(thick * 1.4)) * 0.85;
  // part of what comes back out has bounced off an inner face: pieces of the sky, mirrored inside
  vec3 bounce = reflect(Rin, innerW);
  through += env(bounce) * bodyTint * 0.85;

  // inside: milky veils and a faint glow at the heart, marched along the refracted ray
  vec3 inside = vec3(0.0);
  vec3 p = vLocal;
  float veilSum = 0.0;
  for (int i = 0; i < 6; i++){
    p += RinL * 0.11;
    float veil = smoothstep(0.35, 0.75, vnoise(p * vec3(2.4, 0.9, 2.4) + 3.1) * 0.6 + vnoise(p * 7.0) * 0.4 + 0.25);
    float core = exp(-dot(p.xz, p.xz) * 7.0 - p.y * p.y * 0.9);
    veilSum += veil;
    inside += (MOON_LIGHT * 0.06 + uTint * (0.02 + 0.25 * uPulse) * core) * veil * 0.14;
    inside += uTint * core * (0.0025 + 0.05 * uPulse);
  }
  through = mix(through, through * 0.75, clamp(veilSum * 0.08, 0.0, 0.4));

  // light bouncing off the inner faces: the gem's sparkle
  float sb = max(dot(bounce, MOON_DIR), 0.0);
  float sparkle = pow(sb, 90.0);
  inside += MOON_LIGHT * sparkle * 0.7 * bodyTint;
  // fire: the bounce splits the moonlight into colour, a different hue in each inner face
  inside += spectrum(hash33(cell).x + dot(bounce, vec3(0.7))) * pow(sb, 22.0) * 0.12;

  // the surface: sky and moon in every facet
  vec3 R = reflect(-V, N);
  float m = max(dot(R, MOON_DIR), 0.0);
  vec3 surface = env(R) + MOON_LIGHT * (pow(m, 500.0) * 9.0 + pow(m, 40.0) * 0.1);

  vec3 col = (through + inside) * (1.0 - F) + surface * F;
  // facet edges catch a thin line of light; wave crests glint
  float line = edgeLine(1.2);
  col += vec3(0.75, 0.8, 0.9) * line * (0.07 + pow(m, 30.0) * 0.6);
  // the ripples: crests catch the sky and the moon as they run across the faces
  float wave = clamp(length(gw) * uRipDepth * 2.0, 0.0, 1.0);
  float sheen = pow(max(dot(R, normalize(vec3(-0.25, 0.75, 0.6))), 0.0), 18.0);
  col += (MOON_LIGHT * 0.5 * sheen + env(R) * 0.6) * wave;
  col += uTint * 0.03 * h;

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
  float g = exp(-d * d * 9.0) * 0.06 + exp(-d * d * 50.0) * 0.05;
  gl_FragColor = vec4(uTint * g * (1.0 + uPulse * 0.8), 1.0);
}`;

export const planeVert = /* glsl */ `
varying vec2 vUv;
void main(){
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;
