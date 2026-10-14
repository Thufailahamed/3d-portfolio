import { cursorGlsl } from "./cursor";
import { snoise3 } from "./noise";

/** Dark rock mass of the mountain range; ridges catch a cool key light and glitter. */
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
uniform vec3 uBg;
uniform vec3 uCrystal;
uniform vec3 uLight;
uniform float uReflect;
uniform float uTime;
varying vec3 vW;
varying vec3 vNrm;
varying float vH;
${snoise3}

float hash(vec3 p){
  p = fract(p * vec3(0.1031, 0.1030, 0.0973));
  p += dot(p, p.yxz + 33.33);
  return fract((p.x + p.y) * p.z);
}

// cool mineral palette (deep blue → cyan → moss), nudged toward the project tint
vec3 mineral(float t){
  vec3 a = mix(vec3(0.05, 0.16, 0.75), vec3(0.05, 0.6, 0.75), smoothstep(0.0, 0.55, t));
  return mix(a, vec3(0.3, 0.75, 0.25), smoothstep(0.55, 1.0, t));
}

void main(){
  if (vH < 0.0) discard;                     // below the floor: never seen, and must not poke out of the mirror
  vec3 N = normalize(vNrm);
  if (uReflect > 0.5) N.y = -N.y;            // shade the reflection like the real slope
  float lit = max(dot(N, normalize(uLight)), 0.0);
  float crest = smoothstep(-0.5, 7.0, vH);

  // fine mineral grain: most cells dark, a few sparkle
  vec3 cell = floor(vW * 34.0);
  float g = hash(cell);
  float spark = smoothstep(0.72, 1.0, g) * (0.55 + 0.45 * sin(uTime * (1.5 + g * 3.0) + g * 40.0));

  float hue = snoise(vec3(vW.xz * 0.06, 1.7)) * 0.5 + 0.5;
  vec3 tone = mix(mineral(hue), uTint, 0.35);

  vec3 col = vec3(0.006, 0.008, 0.012);
  col += tone * pow(lit, 2.2) * (0.05 + 1.1 * spark) * (0.25 + 0.95 * crest);
  // the crystal lights the near slopes
  vec3 toC = uCrystal - vW;
  float dc = length(toC);
  col += uTint * max(dot(N, toC / dc), 0.0) * 7.0 / (dc * dc + 6.0) * (0.4 + spark);

  // valleys sink into haze; distance fades to the scene background
  col *= 0.3 + 0.7 * smoothstep(-0.6, 2.5, vH);
  col *= 1.0 - 0.6 * uReflect;
  float dist = length(cameraPosition - vW);
  float fog = 1.0 - exp(-pow(dist * 0.021, 2.2));
  col = mix(col, uBg, fog);
  gl_FragColor = vec4(col, 1.0);
}`;

/** Glitter sitting on the lit ridges. */
export const glitterVert = /* glsl */ `
uniform float uTime;
uniform float uSize;
uniform float uPixelRatio;
uniform vec3 uTint;
uniform float uReflect;
#ifdef MORPH
// mountain glitter: height and light for two landscape designs, blended by uMorph
uniform float uMorph;
attribute float aYA;
attribute float aYB;
attribute float aLA;
attribute float aLB;
#else
attribute float aLit;
#endif
attribute float aRand;
attribute float aHue;
varying vec3 vColor;
varying float vAlpha;
${cursorGlsl}

vec3 mineral(float t){
  vec3 a = mix(vec3(0.1, 0.3, 1.0), vec3(0.1, 0.85, 0.9), smoothstep(0.0, 0.55, t));
  return mix(a, vec3(0.45, 1.0, 0.35), smoothstep(0.55, 1.0, t));
}

void main(){
#ifdef MORPH
  vec3 p = vec3(position.x, mix(aYA, aYB, uMorph) + 0.04, position.z);
  float lit = mix(aLA, aLB, uMorph);
#else
  vec3 p = position;
  float lit = aLit;
#endif
  vec4 w = modelMatrix * vec4(p, 1.0);
  float m = uReflect > 0.5 ? -1.0 : 1.0;
  float hover;
  vec3 push = cursorPush(vec3(w.x, w.y * m, w.z), 1.0, hover);
  w.xyz += vec3(push.x, push.y * m, push.z);
  vec4 mv = viewMatrix * w;
  gl_Position = projectionMatrix * mv;
  float twinkle = 0.45 + 0.55 * sin(uTime * (0.8 + aRand * 2.4) + aRand * 60.0);
  vColor = mix(mineral(aHue), uTint, 0.35) * (0.4 + 0.9 * lit);
  float dist = -mv.z;
  vAlpha = lit * twinkle * exp(-pow(dist * 0.02, 2.2)) * (1.0 - 0.7 * uReflect) * step(0.0, p.y);
  vAlpha *= 1.0 + hover * 1.5;
  gl_PointSize = uSize * (0.35 + aRand * 0.9) * (1.0 + hover * 0.5) * uPixelRatio / dist;
}`;

export const glitterFrag = /* glsl */ `
varying vec3 vColor;
varying float vAlpha;
void main(){
  float d = length(gl_PointCoord - 0.5);
  float a = smoothstep(0.5, 0.0, d) * vAlpha;
  gl_FragColor = vec4(vColor * a, 1.0);
}`;
