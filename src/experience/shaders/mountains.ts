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

  float dist = length(cameraPosition - vW);
  float near = 1.0 - smoothstep(30.0, 70.0, dist);     // fine detail only where it can be seen

  // couloirs: gullies and ribs running straight down each face. The noise is stretched along
  // the fall line (the slope's own downhill direction), so it streaks the way erosion does.
  // (blended between the two world axes by which way the slope faces: stable, no warping)
  vec2 fall = N.xz * N.xz;
  float wx = fall.x / (fall.x + fall.y + 1e-4);
  float gz = vnoise(vec3(P.x * 0.9, y * 0.09, 1.7)) * 0.65 + vnoise(vec3(P.x * 2.6, y * 0.22, 5.1)) * 0.35;
  float gx = vnoise(vec3(P.z * 0.9, y * 0.09, 8.3)) * 0.65 + vnoise(vec3(P.z * 2.6, y * 0.22, 2.9)) * 0.35;
  float gully = mix(gz, gx, smoothstep(0.25, 0.75, wx));
  float rough = vnoise(P * 0.9);
  float relief = gully * 0.9 + rough * 0.35 + vnoise(P * 3.4) * 0.08 * near;
  vec3 Nb = bumpNormal(P, N, relief, 1.0 * near + 0.35);

  // rock: grey-brown, banded, darker down in the gullies, paler on the ribs
  float strata = vnoise(vec3(P.x * 0.05, y * 0.8 + rough * 1.5, P.z * 0.05));
  vec3 rock = mix(vec3(0.07, 0.066, 0.062), vec3(0.17, 0.158, 0.145), 0.5 + 0.5 * strata);
  float cavity = smoothstep(-0.55, 0.45, gully);
  rock *= 0.55 + 0.6 * cavity;
  // dark scrub and turf on the gentle lower slopes
  float veg = (1.0 - smoothstep(0.6, 3.0, y + rough)) * smoothstep(0.68, 0.88, Nb.y);
  vec3 albedo = mix(rock, mix(vec3(0.03, 0.045, 0.028), vec3(0.06, 0.08, 0.035), uDay), veg);

  // snow: above a ragged line it settles on anything flat enough, and fills the gullies below it,
  // so the faces show long white couloirs between dark ribs of rock
  float line = 4.8 + rough * 2.2;
  float high = smoothstep(line - 2.5, line + 2.0, y);
  // judged on the smooth slope (the bumped normal would scatter it into spots); the gullies
  // only nudge it, which draws the streaks
  float hold = N.y + (0.1 - gully) * 0.3 + high * 0.12 + (Nb.y - N.y) * 0.15;
  float snow = high * smoothstep(0.6, 0.7, hold);
  snow = max(snow, smoothstep(line + 5.0, line + 8.0, y) * smoothstep(0.4, 0.52, hold));
  vec3 snowCol = vec3(0.8, 0.84, 0.9) * (0.9 + 0.1 * rough);
  albedo = mix(albedo, snowCol, snow);

  vec3 col = nightLight(albedo, Nb);
  // the ribs shade the gullies a little (cheap occlusion), snow most of all keeps its light
  col *= mix(0.65 + 0.35 * cavity, 1.0, snow * 0.7);
  // snow glints
  vec3 V = normalize(cameraPosition - P);
  float g = vhash(floor(P * 26.0));
  float glint = step(0.985, g) * pow(max(dot(reflect(-MOON_DIR, Nb), V), 0.0), 2.0) * near;
  col += MOON_LIGHT * 0.6 * glint * snow * (0.6 + 0.4 * sin(uTime * 3.0 + g * 80.0));

  // the crystal's light on the near slopes
  vec3 toC = uCrystal - P;
  float dc = length(toC);
  col += albedo * uTint * max(dot(Nb, toC / dc), 0.0) * 9.0 / (dc * dc + 5.0);

  col = nightAir(col, vW);
  gl_FragColor = vec4(col, 1.0);
}`;
