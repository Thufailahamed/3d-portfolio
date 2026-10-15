import { snoise3 } from "./noise";

/**
 * The forest's sky and rain. The dome's horizon matches the fog, so distant trees melt
 * into it; its colours (night / day / storm, blended on the CPU) come in as uniforms.
 */
export const skyVert = /* glsl */ `
varying vec3 vDir;
void main(){
  vDir = normalize(position);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

export const skyFrag = /* glsl */ `
uniform vec3 uHorizon;
uniform vec3 uZenith;
uniform vec3 uSunDir;
uniform vec3 uSun;
uniform vec3 uCloud;
uniform float uClouds;
uniform float uTime;
varying vec3 vDir;
${snoise3}
void main(){
  vec3 d = normalize(vDir);
  vec3 col = mix(uHorizon, uZenith, smoothstep(-0.02, 0.55, d.y));
  float s = max(dot(d, uSunDir), 0.0);
  col += uSun * (pow(s, 6.0) * 0.35 + pow(s, 60.0) * 0.6);
  // a slow drifting cloud deck, projected onto a plane overhead
  vec2 q = d.xz / max(d.y + 0.12, 0.05) * 0.9 + vec2(uTime * 0.012, uTime * 0.004);
  float n = snoise(vec3(q, uTime * 0.01)) * 0.6 + snoise(vec3(q * 2.3, uTime * 0.02)) * 0.3 + snoise(vec3(q * 5.1, 0.0)) * 0.1;
  float c = smoothstep(-0.15, 0.55, n) * smoothstep(-0.02, 0.25, d.y);
  col = mix(col, uCloud, c * uClouds);
  gl_FragColor = vec4(col, 1.0);
}`;

/**
 * Rain: thin streaks in a box that travels with the camera (each drop stays put in the
 * world and wraps round the box), facing the camera sideways, falling with a little wind.
 */
export const rainVert = /* glsl */ `
attribute vec4 aRand;    // x, y, z in the box (0..1), speed
attribute vec2 aCorner;  // side (-1 / 1), 0 = head … 1 = tail
uniform float uTime;
uniform vec3 uBox;
varying float vTail;
varying float vFade;
vec3 wrap(vec3 p){
  return cameraPosition + mod(p - cameraPosition + 0.5 * uBox, uBox) - 0.5 * uBox;
}
void main(){
  float fall = uTime * (10.0 + 5.0 * aRand.w);
  vec3 vel = normalize(vec3(-0.14, -1.0, 0.03));
  vec3 p = wrap(aRand.xyz * uBox + vel * fall);
  vec3 right = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
  float len = 0.22 + 0.22 * aRand.w;
  p += -vel * len * aCorner.y + right * aCorner.x * 0.0065;
  vec4 mv = viewMatrix * vec4(p, 1.0);
  float dist = -mv.z;
  vFade = smoothstep(0.5, 1.6, dist) * (1.0 - smoothstep(6.0, 9.5, dist));
  vTail = aCorner.y;
  gl_Position = projectionMatrix * mv;
}`;

export const rainFrag = /* glsl */ `
uniform float uRain;
uniform float uFlash;
varying float vTail;
varying float vFade;
void main(){
  float a = uRain * vFade * (1.0 - vTail * 0.85) * (0.22 + uFlash * 0.5);
  gl_FragColor = vec4(vec3(0.72, 0.78, 0.86) * a, a);
}`;
