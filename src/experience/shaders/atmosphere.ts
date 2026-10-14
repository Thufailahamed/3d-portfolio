import { snoise3 } from "./noise";

export const groundVert = /* glsl */ `
varying vec3 vWorld;
void main(){
  vec4 w = modelMatrix * vec4(position,1.0);
  vWorld = w.xyz;
  gl_Position = projectionMatrix * viewMatrix * w;
}`;

export const groundFrag = /* glsl */ `
uniform vec3 uColor;
uniform vec3 uLight;
uniform vec3 uAccent;
uniform vec3 uFog;
uniform float uFogDensity;
uniform float uTime;
varying vec3 vWorld;
${snoise3}
void main(){
  vec2 xz = vWorld.xz;
  // wind-blown sand ripples, warped by low-frequency noise
  float warp = snoise(vec3(xz * 0.08, 0.0)) * 3.0 + snoise(vec3(xz * 0.6, 2.0)) * 0.8;
  float ripple = sin(xz.y * 4.2 + xz.x * 1.3 + warp) * 0.5 + 0.5;
  ripple *= smoothstep(-0.3, 0.6, snoise(vec3(xz * 0.25, 3.0)));
  float grain = snoise(vec3(xz * 9.0, 0.0)) * 0.5 + 0.5;
  float dune = snoise(vec3(xz * 0.05, 1.0)) * 0.5 + 0.5;

  vec3 col = uColor * (0.55 + 0.45 * dune) * (0.85 + 0.15 * ripple) * (0.92 + 0.08 * grain);

  // pool of light under the god rays
  float d = length(xz - uLight.xz);
  float pool = exp(-d * d * 0.07);
  col += vec3(0.82, 0.86, 0.80) * pool * (0.07 + 0.035 * ripple);
  // faint accent spill at the monolith's foot
  col += uAccent * exp(-d * d * 1.6) * 0.035;

  float dist = length(vWorld - cameraPosition);
  float fog = 1.0 - exp(-pow(dist * uFogDensity, 2.0));
  gl_FragColor = vec4(mix(col, uFog, fog), 1.0);
}`;

export const raysVert = /* glsl */ `
varying vec2 vUv;
varying vec3 vNormalW;
varying vec3 vWorld;
void main(){
  vUv = uv;
  vec4 w = modelMatrix * vec4(position,1.0);
  vWorld = w.xyz;
  vNormalW = normalize(mat3(modelMatrix) * normal);
  gl_Position = projectionMatrix * viewMatrix * w;
}`;

export const raysFrag = /* glsl */ `
uniform float uTime;
uniform float uIntensity;
uniform vec3 uColor;
varying vec2 vUv;
varying vec3 vNormalW;
varying vec3 vWorld;
${snoise3}
void main(){
  vec3 v = normalize(cameraPosition - vWorld);
  // bright where the cone faces the camera, soft at the silhouette
  float facing = pow(abs(dot(vNormalW, v)), 2.2);
  float streaks = snoise(vec3(vUv.x * 28.0, vUv.y * 1.5 - uTime * 0.06, uTime * 0.05)) * 0.5 + 0.5;
  streaks = mix(0.35, 1.0, streaks);
  float fadeY = smoothstep(0.0, 0.35, vUv.y) * smoothstep(1.0, 0.55, vUv.y);
  float a = facing * streaks * fadeY * uIntensity;
  gl_FragColor = vec4(uColor * a, a);
}`;

export const dustVert = /* glsl */ `
uniform float uTime;
uniform float uSize;
uniform float uPixelRatio;
uniform vec3 uBeam;
attribute float aRand;
varying float vLit;
varying float vAlpha;
void main(){
  vec3 p = position;
  float h = 10.0;
  p.y = mod(p.y + uTime * (0.04 + aRand * 0.08), h);
  p.x += sin(uTime * 0.25 + aRand * 31.0) * 0.35;
  p.z += cos(uTime * 0.2 + aRand * 17.0) * 0.35;
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;
  float r = length(p.xz - uBeam.xz);
  vLit = exp(-r * r * 0.35);
  vAlpha = smoothstep(0.0, 1.0, p.y) * smoothstep(h, h - 2.0, p.y);
  gl_PointSize = uSize * (0.4 + aRand) * uPixelRatio / -mv.z;
}`;

export const dustFrag = /* glsl */ `
uniform vec3 uColor;
varying float vLit;
varying float vAlpha;
void main(){
  float d = length(gl_PointCoord - 0.5);
  float a = smoothstep(0.5, 0.0, d);
  a *= (0.08 + vLit * 1.2) * vAlpha;
  gl_FragColor = vec4(uColor * a, a);
}`;

export const glyphVert = /* glsl */ `
varying float vY;
void main(){
  vec4 w = modelMatrix * vec4(position,1.0);
  vY = w.y;
  gl_Position = projectionMatrix * viewMatrix * w;
}`;

export const glyphFrag = /* glsl */ `
uniform vec3 uColor;
uniform float uTime;
uniform float uPower;
varying float vY;
void main(){
  // a scan pulse travels up the glyph every few seconds
  float scan = fract(uTime * 0.18);
  float pulse = exp(-pow((vY / 4.6 - scan) * 9.0, 2.0));
  float flicker = 0.92 + 0.08 * sin(uTime * 23.0 + vY * 7.0);
  float k = (0.55 + pulse * 2.6) * flicker * uPower;
  gl_FragColor = vec4(uColor * k, 1.0);
}`;
