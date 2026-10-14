import { snoise3 } from "./noise";

/**
 * Layered "phantom" crystal: one geometry drawn as
 *   LAYER_BACK    — inner walls seen through the glass
 *   LAYER_PHANTOM — nested growth shells (additive edges + rim)
 *   LAYER_FRONT   — smoky outer glass carrying the project image as a glowing core
 * The vertex shader morphs between two crystal variants (uMorph).
 */
export const crystalVert = /* glsl */ `
uniform float uMorph;
attribute vec3 aPos2;
attribute vec3 aNor2;
attribute vec3 aBary;
varying vec3 vWorld;
varying vec3 vN;
varying vec3 vNv;
varying vec3 vBary;
varying vec2 vScreen;
varying float vY;
void main(){
  vec3 p = mix(position, aPos2, uMorph);
  vec3 n = normalize(mix(normal, aNor2, uMorph));
  vec4 w = modelMatrix * vec4(p, 1.0);
  vWorld = w.xyz;
  vN = normalize(mat3(modelMatrix) * n);
  vNv = normalize(normalMatrix * n);
  vBary = aBary;
  vY = p.y;
  // view-space offset from the crystal's centre: the image "screen" always faces the camera
  vec4 v = viewMatrix * w;
  vec4 c = viewMatrix * modelMatrix * vec4(0.0, 0.0, 0.0, 1.0);
  vScreen = v.xy - c.xy;
  gl_Position = projectionMatrix * v;
}`;

export const crystalFrag = /* glsl */ `
uniform sampler2D uTexA;
uniform sampler2D uTexB;
uniform float uMix;
uniform float uTime;
uniform float uPulse;
uniform float uGlow;
uniform float uReflect;
uniform float uFloorY;
uniform vec3 uTint;
uniform vec2 uScreen;
varying vec3 vWorld;
varying vec3 vN;
varying vec3 vNv;
varying vec3 vBary;
varying vec2 vScreen;
varying float vY;
${snoise3}

// crisp, pixel-width facet outline plus a soft halo
float edgeLine(float px){
  vec3 d = max(fwidth(vBary), vec3(1e-4));
  vec3 a = smoothstep(vec3(0.0), d * px, vBary);
  return 1.0 - min(min(a.x, a.y), a.z);
}
float edgeHalo(){
  float m = min(min(vBary.x, vBary.y), vBary.z);
  return exp(-m * 22.0);
}

// soft sky/floor gradient only: flat facets would snap to white against anything sharper
vec3 env(vec3 R){
  float top = smoothstep(-0.2, 1.0, R.y);
  float bounce = smoothstep(0.0, -1.0, R.y);
  return vec3(0.75, 0.82, 0.9) * top * top * 0.12 + uTint * bounce * 0.04;
}

vec3 sampleImg(vec2 uv, vec2 off){
  vec3 a = vec3(texture2D(uTexA, uv + off).r, texture2D(uTexA, uv).g, texture2D(uTexA, uv - off).b);
  vec3 b = vec3(texture2D(uTexB, uv + off).r, texture2D(uTexB, uv).g, texture2D(uTexB, uv - off).b);
  // noise-dissolve between the two project images
  float n = snoise(vec3(uv * 3.2, uTime * 0.15)) * 0.5 + 0.5;
  float edge = uMix * 1.4 - 0.2;
  float t = smoothstep(edge - 0.12, edge + 0.12, n);
  vec3 col = mix(b, a, t);
  float seam = 1.0 - abs(t * 2.0 - 1.0);
  return col + uTint * seam * step(0.001, uMix) * step(uMix, 0.999) * 1.4;
}

void main(){
  vec3 N = normalize(vN);
  if (!gl_FrontFacing) N = -N;
  vec3 V = normalize(cameraPosition - vWorld);
  float facing = clamp(dot(N, V), 0.0, 1.0);
  float fres = pow(1.0 - facing, 3.0);
  float line = edgeLine(1.3);
  float halo = edgeHalo();
  vec3 col;
  float alpha;

#ifdef LAYER_FRONT
  // the image floats inside: each facet refracts it by its own normal
  vec3 Nv = normalize(vNv);
  vec2 uv = vScreen / uScreen + 0.5;
  float wobble = sin(uMix * 3.14159) * 0.05;
  uv -= Nv.xy * (0.06 - wobble);
  vec2 off = Nv.xy * (0.006 + wobble * 0.2);
  vec3 img = sampleImg(clamp(uv, 0.002, 0.998), off);

  float r = length(vScreen / vec2(0.78, 0.92));
  float mask = 1.0 - smoothstep(0.25, 1.0, r);
  float core = exp(-r * r * 2.2);

  col = img * mask * (1.0 + uPulse * 0.15);
  col += uTint * core * (0.04 + uPulse * 0.12);
  col *= mix(1.0, 0.45, fres);                       // grazing facets go smoky
  col += uTint * 0.012;                              // body colour of the glass
  col += env(reflect(-V, N)) * (0.05 + 0.7 * fres);
  col += (uTint * 0.3 + 0.08) * line * 0.12 + uTint * halo * 0.01;
  col += uTint * pow(fres, 1.5) * 0.12;
  alpha = clamp(0.7 + fres * 0.28 + line * 0.2, 0.0, 1.0);
#endif

#ifdef LAYER_BACK
  // inner walls: dark tinted glass with faint edges catching the core's light
  col = uTint * (0.015 + 0.03 * fres) + (uTint * 0.25 + 0.03) * line * 0.1 + uTint * halo * 0.01;
  col += env(reflect(-V, N)) * 0.04;
  alpha = 0.45;
#endif

#ifdef LAYER_PHANTOM
  // nested growth shell: a soft tinted rim and softened edges (additive, no hard lines)
  col = uTint * (0.01 + fres * 0.15) * uGlow;
  col += uTint * halo * 0.05 * uGlow;
  alpha = 1.0;
#endif

  // keep everything but the image under the bloom threshold: no flares
#ifdef LAYER_FRONT
  col = min(col, vec3(0.8));
#else
  col = min(col, vec3(0.3));
#endif

  if (uReflect > 0.5) {
    // mirrored copy under the floor: fade out with depth below the floor line
    float k = smoothstep(uFloorY - 2.6, uFloorY, vWorld.y) * 0.4;
    // water breaks the reflection into slow horizontal bands
    k *= 0.7 + 0.3 * sin(vWorld.y * 26.0 + uTime * 1.8 + sin(vWorld.x * 4.0 + uTime) * 1.5);
    col *= k;
#ifndef LAYER_PHANTOM
    alpha *= k;
#endif
  }
  gl_FragColor = vec4(col, alpha);
}`;

/** Camera-facing glow behind the core (drives the bloom halo). */
export const glowVert = /* glsl */ `
uniform float uSize;
varying vec2 vUv;
void main(){
  vUv = uv;
  vec4 mv = modelViewMatrix * vec4(0.0, 0.0, 0.0, 1.0);
  mv.xy += position.xy * uSize;
  gl_Position = projectionMatrix * mv;
}`;

export const glowFrag = /* glsl */ `
uniform vec3 uTint;
uniform float uPulse;
uniform float uIntensity;
uniform float uTime;
varying vec2 vUv;
void main(){
  float d = length(vUv - 0.5) * 2.0;
  float breathe = 0.9 + 0.1 * sin(uTime * 1.3);
  float g = exp(-d * d * 5.0) * 0.55 + exp(-d * d * 26.0) * 0.5;
  vec3 col = uTint * g * (breathe + uPulse * 0.3) + vec3(1.0) * exp(-d * d * 60.0) * 0.06;
  gl_FragColor = vec4(col * uIntensity * smoothstep(1.0, 0.7, d), 1.0);
}`;

/** Soft pool of tinted light on the floor under the crystal. */
export const floorGlowFrag = /* glsl */ `
uniform vec3 uTint;
uniform float uPulse;
varying vec2 vUv;
void main(){
  float d = length(vUv - 0.5) * 2.0;
  float g = exp(-d * d * 9.0) * 0.1 + exp(-d * d * 50.0) * 0.08;
  gl_FragColor = vec4(uTint * g * (1.0 + uPulse * 0.8), 1.0);
}`;

export const planeVert = /* glsl */ `
varying vec2 vUv;
void main(){
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;
