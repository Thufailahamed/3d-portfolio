import { nightGlsl, valueNoiseGlsl } from "./night";

/** The mountain range: moonlit rock with snow on the heights, sinking into the night haze. */
export const ridgeVert = /* glsl */ `
// two landscape designs (A → B) blended by uMorph
uniform float uMorph;
attribute float aHA;
attribute float aHB;
attribute vec3 aNA;
attribute vec3 aNB;
varying vec3 vW;
varying vec3 vNrm;
varying float vH;
void main(){
  vec3 p = vec3(position.x, mix(aHA, aHB, uMorph), position.z);
  vec4 w = modelMatrix * vec4(p, 1.0);
  vW = w.xyz;
  vNrm = normalize(mat3(modelMatrix) * normalize(mix(aNA, aNB, uMorph)));
  vH = p.y;
  gl_Position = projectionMatrix * viewMatrix * w;
}`;

export const ridgeFrag = /* glsl */ `
uniform vec3 uTint;
uniform vec3 uCrystal;
uniform float uReflect;
uniform float uFloorY;
uniform float uTime;
varying vec3 vW;
varying vec3 vNrm;
varying float vH;
${valueNoiseGlsl}
${nightGlsl}

void main(){
  if (vH < 0.0) discard;                     // below the floor: never seen, and must not poke out of the mirror
  // the reflection is shaded as the real slope it mirrors
  vec3 P = vW;
  vec3 N = normalize(vNrm);
  if (uReflect > 0.5) { P.y = 2.0 * uFloorY - P.y; N.y = -N.y; }
  float y = P.y - uFloorY;

  // relief finer than the mesh: gullies, ledges and loose rock
  float relief = fbm3(P * vec3(0.32, 0.5, 0.32)) * 1.4 + vnoise(P * 2.6) * 0.16;
  vec3 Nb = bumpNormal(P, N, relief, 1.0);

  // layered rock: banded strata, broken up
  float strata = vnoise(vec3(P.x * 0.04, y * 0.9 + fbm3(P * 0.07) * 2.2, P.z * 0.04));
  vec3 rock = mix(vec3(0.075, 0.072, 0.07), vec3(0.16, 0.15, 0.14), 0.5 + 0.5 * strata);
  rock *= 0.75 + 0.5 * (vnoise(P * 0.8) * 0.5 + 0.5);
  // dark scrub on the gentle lower slopes
  float veg = (1.0 - smoothstep(0.8, 3.2, y + relief)) * smoothstep(0.7, 0.9, Nb.y);
  vec3 albedo = mix(rock, vec3(0.03, 0.042, 0.03), veg);
  // snow above a ragged line, only where the slope can hold it
  float line = 5.2 + fbm3(P * 0.09) * 3.0;
  float snow = smoothstep(line, line + 1.4, y) * smoothstep(0.42, 0.72, Nb.y + relief * 0.12);
  albedo = mix(albedo, vec3(0.78, 0.82, 0.88), snow);

  vec3 col = nightLight(albedo, Nb);
  // snow glints in the moonlight
  vec3 V = normalize(cameraPosition - P);
  float g = vhash(floor(P * 26.0));
  float glint = step(0.985, g) * pow(max(dot(reflect(-MOON_DIR, Nb), V), 0.0), 2.0);
  col += vec3(0.6, 0.7, 0.9) * glint * snow * (0.6 + 0.4 * sin(uTime * 3.0 + g * 80.0));

  // the crystal's light on the near slopes
  vec3 toC = uCrystal - P;
  float dc = length(toC);
  col += albedo * uTint * max(dot(Nb, toC / dc), 0.0) * 9.0 / (dc * dc + 5.0);

  col = nightAir(col, vW);
  gl_FragColor = vec4(col, 1.0);
}`;
