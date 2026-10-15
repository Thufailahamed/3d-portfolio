import { riverGlsl } from "../river";
import { nightGlsl, valueNoiseGlsl } from "./night";

/**
 * The valley floor around the crystal. Every solid has a mirrored twin under the water
 * (uReflect): it is shaded as the real thing and cut off at the waterline, and the water
 * on top decides how much of it shows.
 */
const common = /* glsl */ `
uniform float uTime;
uniform float uReflect;
uniform float uFloorY;
uniform vec3 uTint;
uniform vec3 uCrystal;
${valueNoiseGlsl}
${nightGlsl}

/** The crystal as a small, coloured light hanging over the rock. */
vec3 crystalLight(vec3 albedo, vec3 P, vec3 N, float power){
  vec3 toC = uCrystal - P;
  float d = length(toC);
  return albedo * uTint * max(dot(N, toC / d), 0.0) * power / (d * d + 0.6);
}
`;

const solidVert = /* glsl */ `
varying vec3 vW;
varying vec3 vN;
varying vec3 vL;
void main(){
  vec4 local = vec4(position, 1.0);
  vec3 n = normal;
#ifdef USE_INSTANCING
  local = instanceMatrix * local;
  n = mat3(instanceMatrix) * n;
#endif
  vL = position;
  vec4 w = modelMatrix * local;
  vW = w.xyz;
  vN = normalize(mat3(modelMatrix) * n);
  gl_Position = projectionMatrix * viewMatrix * w;
}`;

/** Reflection bookkeeping shared by every solid: P / N as the real surface, y above the water. */
const mirror = /* glsl */ `
  vec3 P = vW;
  vec3 N = normalize(vN);
  if (uReflect > 0.5) { P.y = 2.0 * uFloorY - P.y; N.y = -N.y; }
  float y = P.y - uFloorY;
  if (y < -0.002) discard;             // under the water: the mirror shows only what stands above it
`;

export const bankVert = solidVert;
export const bankFrag = /* glsl */ `
${common}
varying vec3 vW;
varying vec3 vN;
varying vec3 vL;
void main(){
  ${mirror}
  // pebbles and gravel at the water's edge, turf and moss on the flats, rock where it's steep
  float pebble = vnoise(vec3(P.xz * 9.0, 1.3)) * 0.6 + vnoise(vec3(P.xz * 23.0, 4.1)) * 0.4;
  float turf = fbm3(vec3(P.xz * 1.6, 2.0));
  float shore = 1.0 - smoothstep(0.02, 0.35, y);
  float h = mix(turf * 0.35 + vnoise(vec3(P.xz * 6.0, 0.0)) * 0.08, pebble * 0.12, shore);
  vec3 Nb = bumpNormal(P, N, h, 1.0);

  float steep = 1.0 - smoothstep(0.72, 0.9, Nb.y);
  vec3 grass = mix(vec3(0.028, 0.04, 0.024), vec3(0.06, 0.07, 0.04), turf * 0.5 + 0.5);
  vec3 gravel = mix(vec3(0.07, 0.066, 0.06), vec3(0.16, 0.15, 0.14), smoothstep(-0.3, 0.6, pebble));
  vec3 rock = vec3(0.09, 0.088, 0.085) * (0.8 + 0.4 * turf);
  vec3 albedo = mix(grass, rock, steep);
  albedo = mix(albedo, gravel, shore);
  albedo *= 1.0 - 0.45 * (1.0 - smoothstep(0.0, 0.08, y));      // wet at the waterline
  // frost on the open ground, thickening up the hills
  float frost = smoothstep(0.55, 0.95, Nb.y) * smoothstep(0.2, 0.75, turf + y * 0.12) * (1.0 - shore);
  albedo = mix(albedo, vec3(0.5, 0.54, 0.6), frost * 0.55);

  vec3 col = nightLight(albedo, Nb) + crystalLight(albedo, P, Nb, 3.2);
  // a wet sheen on the stones by the water
  vec3 V = normalize(cameraPosition - P);
  col += MOON_LIGHT * pow(max(dot(reflect(-MOON_DIR, Nb), V), 0.0), 24.0) * shore * 0.025;
  col = nightAir(col, vW);
  gl_FragColor = vec4(col, 1.0);
}`;

/** Wet river stones: worn rock, lichen, a darker band where the water laps. */
export const rockVert = solidVert;
export const rockFrag = /* glsl */ `
${common}
uniform float uPower;
varying vec3 vW;
varying vec3 vN;
varying vec3 vL;
void main(){
  ${mirror}
  float grain = fbm3(vL * 3.5) + vnoise(vL * 14.0) * 0.12;
  vec3 Nb = bumpNormal(P, N, grain * 0.06, 1.0);
  vec3 albedo = mix(vec3(0.07, 0.068, 0.066), vec3(0.19, 0.18, 0.17), smoothstep(-0.4, 0.5, grain));
  // pale lichen patches on the upper faces
  float lichen = smoothstep(0.3, 0.55, vnoise(vL * 6.0) * 0.6 + grain * 0.6) * smoothstep(0.2, 0.7, Nb.y);
  albedo = mix(albedo, vec3(0.26, 0.27, 0.2), lichen * 0.5);
  float wet = exp(-y * 7.0);
  albedo *= 1.0 - 0.55 * wet;

  vec3 V = normalize(cameraPosition - P);
  vec3 col = nightLight(albedo, Nb) + crystalLight(albedo, P, Nb, uPower);
  // wet stone shines: the moon and the crystal, sharper near the water
  float rough = mix(18.0, 90.0, wet);
  col += MOON_LIGHT * pow(max(dot(reflect(-MOON_DIR, Nb), V), 0.0), rough) * (0.05 + 0.25 * wet);
  vec3 L = normalize(uCrystal - P);
  col += uTint * pow(max(dot(reflect(-L, Nb), V), 0.0), rough) * (0.1 + 0.5 * wet) * uPower * 0.12;
  col = nightAir(col, vW);
  gl_FragColor = vec4(col, 1.0);
}`;

/** Pines: dark needles, thin silver edges where the moon catches them, snow on the tiers. */
export const pineVert = /* glsl */ `
attribute float aUp;
varying vec3 vW;
varying vec3 vN;
varying vec3 vL;
varying float vUp;
uniform float uTime;
void main(){
  vec3 p = position;
  vec4 base = vec4(0.0, 0.0, 0.0, 1.0);
#ifdef USE_INSTANCING
  base = instanceMatrix * base;
#endif
  // a slow sway, more at the top
  p.x += sin(uTime * 0.6 + base.x * 0.7 + base.z) * 0.025 * aUp * aUp;
  // soft, rounded foliage normals rather than the cones' facets
  vec3 n = normalize(vec3(position.x, 0.55, position.z) + normal * 0.6);
  vec4 local = vec4(p, 1.0);
#ifdef USE_INSTANCING
  local = instanceMatrix * local;
  n = mat3(instanceMatrix) * n;
#endif
  vL = position;
  vUp = aUp;
  vec4 w = modelMatrix * local;
  vW = w.xyz;
  vN = normalize(mat3(modelMatrix) * n);
  gl_Position = projectionMatrix * viewMatrix * w;
}`;

export const pineFrag = /* glsl */ `
${common}
varying vec3 vW;
varying vec3 vN;
varying vec3 vL;
varying float vUp;
void main(){
  ${mirror}
  float needles = vnoise(vL * vec3(40.0, 18.0, 40.0)) * 0.6 + vnoise(vL * 9.0) * 0.4;
  // branch tips catch the light; deep inside a tier, and low on the tree, it's dark
  float tip = smoothstep(0.05, 0.4, length(vL.xz) / (0.55 - vUp * 0.4));
  vec3 albedo = vec3(0.016, 0.026, 0.02) * (0.6 + 0.8 * needles) * (0.35 + 0.65 * tip) * (0.55 + 0.45 * vUp);
  if (length(vL.xz) < 0.07 && vL.y < 0.4) albedo = vec3(0.04, 0.032, 0.026);   // trunk
  float snow = smoothstep(0.7, 0.95, N.y + needles * 0.35) * smoothstep(0.25, 0.6, tip) * 0.45;
  albedo = mix(albedo, vec3(0.6, 0.64, 0.7), snow);
  vec3 col = nightLight(albedo, N);
  // the moon behind the tree: light bleeds through the outer twigs
  vec3 V = normalize(cameraPosition - P);
  float rim = pow(1.0 - max(dot(N, V), 0.0), 3.0) * max(dot(-V, MOON_DIR) * 0.5 + 0.5, 0.0);
  col += MOON_LIGHT * 0.05 * rim;
  col += crystalLight(albedo, P, N, 4.0);
  col = nightAir(col, vW);
  gl_FragColor = vec4(col, 1.0);
}`;

/**
 * The river's surface. Rippling, flowing water: it lets the mirrored world below show by the
 * Fresnel law, lays the moon's glitter and the crystal's light on the ripples, and is dark
 * where you look straight into it.
 */
export const waterVert = /* glsl */ `
varying vec3 vW;
void main(){
  vec4 w = modelMatrix * vec4(position, 1.0);
  vW = w.xyz;
  gl_Position = projectionMatrix * viewMatrix * w;
}`;

export const waterFrag = /* glsl */ `
uniform float uTime;
uniform vec3 uTint;
uniform vec3 uCrystal;
uniform vec3 uOrigin;
${valueNoiseGlsl}
${nightGlsl}
${riverGlsl}
varying vec3 vW;

float waves(vec2 p){
  vec2 flow = vec2(0.0, uTime * 0.35);   // downstream is +z, toward the camera
  return vnoise(vec3(p * vec2(1.3, 0.55) - flow * 0.6, uTime * 0.18)) * 0.4
       + vnoise(vec3(p * vec2(3.4, 1.6) - flow * 1.1, uTime * 0.35)) * 0.33
       + vnoise(vec3(p * vec2(9.0, 6.0) - flow * 2.0, uTime * 0.7)) * 0.27;
}

void main(){
  vec2 local = vW.xz - uOrigin.xz;
  if (riverInside(local) < -2.5) discard;
  vec3 V = normalize(cameraPosition - vW);
  float dist = length(cameraPosition - vW);

  // ripple normal from the height field (finite differences), calmer far away
  float e = 0.04;
  float h0 = waves(local);
  float hx = waves(local + vec2(e, 0.0));
  float hz = waves(local + vec2(0.0, e));
  float amp = 0.075 * (1.0 - smoothstep(10.0, 40.0, dist));
  vec3 N = normalize(vec3(-(hx - h0) / e * amp, 1.0, -(hz - h0) / e * amp));

  float cosV = max(dot(N, V), 0.0);
  float F = 0.02 + 0.98 * pow(1.0 - cosV, 5.0);
  // the mirrored world shows through by F (a little more, so the night has reflections)
  float refl = clamp(F * 1.6 + 0.12, 0.0, 0.95);
  vec3 R = reflect(-V, N);

  // the water's own colour: very dark, faintly green in the crystal's light
  vec3 col = vec3(0.002, 0.004, 0.006) * (1.0 - refl);
  // the ripples tilt toward the sky and catch its haze
  col += nightSky(normalize(vec3(R.x, max(R.y, 0.02), R.z))) * refl * 0.35;
  // moon glitter
  float m = max(dot(R, MOON_DIR), 0.0);
  col += MOON_LIGHT * (pow(m, 220.0) * 6.0 + pow(m, 30.0) * 0.06);
  // the crystal's light, smeared down the ripples toward the viewer
  vec3 L = normalize(uCrystal - vW);
  float c = max(dot(R, L), 0.0);
  float near = 1.0 / (1.0 + dot(local, local) * 0.06);
  col += uTint * (pow(c, 500.0) * 0.5 + pow(c, 40.0) * 0.03) * near;

  float air = 1.0 - exp(-pow(dist * 0.024, 1.5));
  vec3 haze = nightSky(normalize(vec3(-V.x, 0.0, -V.z)));
  col = mix(col, haze * (1.0 - refl), air);
  // premultiplied: rgb is what the surface adds, alpha how much of the reflection it hides
  gl_FragColor = vec4(col, 1.0 - refl);
}`;
