/**
 * Forest intro. Lighting is baked in Blender (Cycles) into vertex colours, stored
 * as radiance / BAKE_SCALE; the shader scales it back and adds an optional rim glow.
 */
export const bakedVert = /* glsl */ `
#include <common>
#include <color_pars_vertex>
#include <fog_pars_vertex>
varying vec3 vN;
varying vec3 vV;
void main(){
  #include <color_vertex>
  vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
  vN = normalize(normalMatrix * normal);
  vV = -mvPosition.xyz;
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}`;

export const bakedFrag = /* glsl */ `
#include <common>
#include <color_pars_fragment>
#include <fog_pars_fragment>
uniform float uExposure;
uniform vec3 uAccent;
uniform float uRim;
uniform float uFill;
varying vec3 vN;
varying vec3 vV;
void main(){
  vec3 col = vColor.rgb * uExposure;
  float f = pow(1.0 - abs(dot(normalize(vN), normalize(vV))), 2.5);
  col += uAccent * (f * uRim + uFill);
  gl_FragColor = vec4(col, 1.0);
  #include <fog_fragment>
}`;

/** Blue fireflies: drifting, blinking points. */
export const fireflyVert = /* glsl */ `
uniform float uTime;
uniform float uSize;
uniform float uPixelRatio;
attribute float aRand;
varying float vBlink;
void main(){
  vec3 p = position;
  p.x += sin(uTime * 0.3 + aRand * 40.0) * 0.3;
  p.y += sin(uTime * 0.45 + aRand * 20.0) * 0.2;
  p.z += cos(uTime * 0.25 + aRand * 30.0) * 0.3;
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;
  vBlink = smoothstep(0.15, 1.0, sin(uTime * (0.5 + aRand * 1.3) + aRand * 60.0) * 0.5 + 0.5);
  gl_PointSize = uSize * (0.6 + aRand * 0.7) * uPixelRatio / -mv.z;
}`;

export const fireflyFrag = /* glsl */ `
uniform vec3 uColor;
uniform float uIntensity;
varying float vBlink;
void main(){
  float d = length(gl_PointCoord - 0.5);
  float glow = smoothstep(0.5, 0.0, d);
  float a = (pow(glow, 6.0) * 3.0 + pow(glow, 2.0) * 0.35) * vBlink * uIntensity;
  gl_FragColor = vec4(uColor * a, a);
}`;
