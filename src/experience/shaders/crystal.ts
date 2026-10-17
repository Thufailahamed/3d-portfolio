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
 * Smoked quartz, rough-cut. The valley behind it (rendered without the crystal, uScene) is
 * refracted through each facet and mostly swallowed by the dark glass; the relic at its heart
 * (rendered alone, uCore) shines through, broken up a little by the facets and haloed in its
 * own light. The faces catch two soft studio lights and the sky; the edges split into colour.
 */
export const crystalFrag = /* glsl */ `
uniform sampler2D uScene;
uniform sampler2D uCore;
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
/** Two big soft boxes fixed to the camera (view space): a cool one high left, a strip low right.
 *  As the stone turns, each facet swings through them and lights up as a whole grey plane. */
vec3 studio(vec3 Rv){
  float key = smoothstep(0.78, 0.99, dot(Rv, normalize(vec3(-0.55, 0.65, 0.5))));
  float strip = smoothstep(0.9, 0.995, dot(Rv, normalize(vec3(0.75, -0.1, 0.65))));
  float top = smoothstep(0.8, 1.0, Rv.y);
  return vec3(0.62, 0.68, 0.78) * key * 0.55 + vec3(0.8, 0.82, 0.86) * strip * 0.4 + vec3(0.35, 0.38, 0.45) * top * 0.25;
}
vec3 scene(vec2 uv){
  return texture2D(uScene, clamp(uv, vec2(0.001), vec2(0.999))).rgb;
}
vec3 relic(vec2 uv, float bias){
  return texture2D(uCore, clamp(uv, vec2(0.001), vec2(0.999)), bias).rgb;
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
  vec2 off = Nv.xy * 0.045 + Iv.xy * 0.025;
  vec3 through = vec3(scene(uv + off * 0.86).r, scene(uv + off).g, scene(uv + off * 1.18).b);

  // smoked quartz: almost all the light through it is swallowed; what's left is faintly tinted
  vec3 smoke = mix(vec3(0.3, 0.33, 0.36), uTint * 0.4, 0.25);
  float thick = 0.7 + 0.9 * cosV;
  through *= pow(smoke, vec3(0.6 + thick * 0.7)) * 0.5;
  vec3 bounce = reflect(Rin, innerW);
  through += env(bounce) * smoke * 0.25;

  // every project's colour glows equally bright (lime would otherwise outshine violet)
  vec3 hue = uTint * (0.5 / max(dot(uTint, vec3(0.2126, 0.7152, 0.0722)), 0.2));
  float power = 1.0 + uPulse * 0.6;

  // the relic: seen through the facet it's bent a little (so each face shows it slightly
  // shifted, like a real object inside cut glass), colours parting at the shift
  vec2 coff = Nv.xy * 0.014 + Iv.xy * 0.006;
  vec3 holo = vec3(relic(uv + coff * 0.8, 0.0).r, relic(uv + coff, 0.0).g, relic(uv + coff * 1.25, 0.0).b);
  // its light scatters in the glass around it: a soft halo, wider and dimmer the further out
  vec3 halo = relic(uv + coff, 3.0) * 0.7 + relic(uv + coff, 4.5) * 0.8 + relic(uv, 6.0) * 0.6;

  // a faint cloud of the same light hangs around it, where the view meets the plane through the centre
  vec3 Rv = normalize((viewMatrix * vec4(Rin, 0.0)).xyz);
  float travel = max(vDepth, 0.0) / max(-Rv.z, 0.25);
  vec2 hit = vScreen + Rv.xy * travel;
  vec2 q = hit / vec2(0.5, 0.62);
  float r = length(q);
  float t = uTime * 0.12;
  float swirl = fbm3(vec3(q * 1.6 + vec2(sin(t * 1.3), cos(t)) * 0.3, t));
  vec3 core = holo + halo * 0.6;
  core += hue * exp(-r * r * 3.0) * (0.03 + 0.04 * smoothstep(-0.3, 0.6, swirl));
  core += hue * exp(-r * r * 0.8) * 0.008;
  core *= power;

  // inside: thin smoky veils, lit by the relic
  vec3 inside = vec3(0.0);
  vec3 p = vLocal;
  for (int i = 0; i < 4; i++){
    p += RinL * 0.14;
    float veil = smoothstep(0.45, 0.85, vnoise(p * vec3(2.4, 0.9, 2.4) + 3.1) * 0.6 + vnoise(p * 7.0) * 0.4 + 0.25);
    float glow = exp(-dot(p.xz, p.xz) * 4.0 - p.y * p.y * 1.2);
    inside += hue * glow * veil * 0.02 * power + MOON_LIGHT * veil * 0.003;
  }
  // light bouncing off the inner faces: a few hard sparkles and their fire
  float sb = max(dot(bounce, MOON_DIR), 0.0);
  inside += MOON_LIGHT * pow(sb, 120.0) * 0.5;
  inside += spectrum(hash33(cell).x + dot(bounce, vec3(0.7))) * pow(sb, 26.0) * 0.07;

  // the surface: polished, mirroring the sky and the studio lights, the moon or sun as a hard glint
  vec3 R = reflect(-V, N);
  vec3 Rvw = normalize((viewMatrix * vec4(R, 0.0)).xyz);
  float m = max(dot(R, MOON_DIR), 0.0);
  // each facet is a flat mirror: a faint per-face grain keeps them from looking like plastic
  float grain = 0.94 + 0.12 * vnoise(vLocal * 9.0);
  vec3 surface = (env(R) * 0.9 + studio(Rvw) * grain) + MOON_LIGHT * (pow(m, 600.0) * 10.0 + pow(m, 50.0) * 0.1);
  // smoky glass reflects more than it lets through: a floor so every face shows a little sheen
  float Fs = max(F, 0.09);

  vec3 col = (through + core + inside) * (1.0 - Fs) + surface * Fs * 2.6;

  // rims: thin glass at the silhouette splits the light into colour (red one side, blue the other)
  float rim = pow(1.0 - cosV, 3.0);
  vec3 rimCol = mix(vec3(0.95, 0.25, 0.3), vec3(0.25, 0.5, 1.0), smoothstep(-0.35, 0.35, Nv.x));
  col += rimCol * rim * 0.16;
  col += spectrum(cosV * 2.2 + Nv.x * 0.6 + Nv.y * 0.3) * pow(rim, 1.3) * 0.12;
  // facet edges: a fine bright line, brighter where a light catches it
  float line = edgeLine(1.0);
  float catchL = max(max(dot(studio(Rvw), vec3(0.6)), pow(m, 30.0)), 0.0);
  col += (vec3(0.65, 0.7, 0.8) * (0.025 + catchL * 0.5) + rimCol * rim * 0.3 + hue * 0.02) * line;
  // the ripples: crests catch the light as they run across the faces
  float wave = clamp(length(gw) * uRipDepth * 2.0, 0.0, 1.0);
  float sheen = pow(max(dot(R, normalize(vec3(-0.25, 0.75, 0.6))), 0.0), 18.0);
  col += (MOON_LIGHT * 0.4 * sheen + env(R) * 0.5 + rimCol * 0.15) * wave;
  col += hue * 0.04 * h * exp(-r * r);

  if (uReflect > 0.5) col *= 0.55;
  gl_FragColor = vec4(min(col, vec3(4.0)), 1.0);
}`;

/**
 * The relic inside: a solid little model lit like a hologram, in the project's colour, with a
 * white-hot top light, a bright rim and fine scanlines climbing through it.
 */
export const coreVert = /* glsl */ `
varying vec3 vN;
varying vec3 vLocal;
varying vec3 vView;
void main(){
  vLocal = position;
  vec4 w = modelMatrix * vec4(position, 1.0);
  vN = normalize(mat3(modelMatrix) * normal);
  vView = cameraPosition - w.xyz;
  gl_Position = projectionMatrix * viewMatrix * w;
}`;

export const coreFrag = /* glsl */ `
uniform vec3 uTint;
uniform float uTime;
uniform float uPulse;
varying vec3 vN;
varying vec3 vLocal;
varying vec3 vView;
void main(){
  vec3 N = normalize(vN);
  vec3 V = normalize(vView);
  if (!gl_FrontFacing) N = -N;
  vec3 hue = uTint * (0.5 / max(dot(uTint, vec3(0.2126, 0.7152, 0.0722)), 0.2));
  float key = max(dot(N, normalize(vec3(-0.3, 0.85, 0.45))), 0.0);
  float fill = max(dot(N, normalize(vec3(0.6, -0.1, 0.8))), 0.0);
  float fres = pow(1.0 - abs(dot(N, V)), 2.0);
  float shade = 0.08 + key * 0.8 + fill * 0.25 + fres * 0.7;
  // scanlines, and a brighter band sweeping up through the model
  float scan = 0.82 + 0.18 * sin(vLocal.y * 260.0 - uTime * 4.0);
  float band = exp(-pow(fract(vLocal.y * 0.6 - uTime * 0.18) - 0.5, 2.0) * 160.0);
  vec3 col = hue * shade * scan * (1.0 + band * 0.8);
  col += vec3(1.0) * pow(key, 8.0) * 0.4 + hue * fres * 0.3;
  gl_FragColor = vec4(col * 0.95 * (1.0 + uPulse * 0.5), 1.0);
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
