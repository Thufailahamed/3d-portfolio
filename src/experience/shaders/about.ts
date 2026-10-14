import { snoise3 } from "./noise";

/**
 * Light ribbons: the CPU writes each ribbon's centreline (position + tangent);
 * the vertex shader extrudes it sideways, facing the camera, with a twist.
 */
export const ribbonVert = /* glsl */ `
uniform float uTime;
uniform float uWidth;
uniform float uK;
uniform float uSeed;
attribute vec3 aTangent;
attribute float aS;
attribute float aSide;
varying float vS;
varying float vSide;
varying float vFacing;
varying float vFog;
void main(){
  vec4 w = modelMatrix * vec4(position, 1.0);
  vec3 T = normalize(mat3(modelMatrix) * aTangent);
  vec3 V = normalize(cameraPosition - w.xyz);
  vec3 S = normalize(cross(T, V));
  vec3 N = cross(S, T);
  // loose ribbons twist and drift; once gathered into the stem they calm down
  float loose = 1.0 - uK;
  float tw = sin(aS * 7.0 + uSeed * 3.1 + uTime * 0.6) * 1.15 * loose;
  vec3 dir = S * cos(tw) + N * sin(tw);
  w.xyz += N * sin(aS * 11.0 + uTime * 0.9 + uSeed) * 0.12 * loose;
  float taper = smoothstep(0.0, 0.08, aS) * mix(1.0, 0.35, uK * smoothstep(0.35, 0.6, aS));
  w.xyz += dir * aSide * uWidth * taper;
  vS = aS;
  vSide = aSide;
  vFacing = mix(0.35, 1.0, abs(cos(tw)));
  vec4 mv = viewMatrix * w;
  float d = -mv.z;
  vFog = exp(-pow(max(d - 4.0, 0.0) * 0.06, 2.0));
  gl_Position = projectionMatrix * mv;
}`;

export const ribbonFrag = /* glsl */ `
uniform float uTime;
uniform float uHead;
uniform float uSeed;
uniform float uIntensity;
uniform vec3 uColor;
varying float vS;
varying float vSide;
varying float vFacing;
varying float vFog;
void main(){
  if (vS > uHead) discard;
  float x = abs(vSide);
  float body = pow(1.0 - x, 1.6);
  float core = pow(1.0 - x, 10.0);
  // light pulses running along the ribbon toward its head
  float pulse = pow(sin((vS * 3.0 - uTime * 0.35 + uSeed) * 6.2831) * 0.5 + 0.5, 3.0);
  float head = exp(-pow((uHead - vS) * 14.0, 2.0));
  float tail = smoothstep(0.0, 0.18, vS);
  vec3 col = mix(uColor, vec3(1.0), core * 0.7);
  float k = body * (0.22 + pulse * 0.75 + head * 2.2) * tail * vFacing * vFog * uIntensity;
  gl_FragColor = vec4(col * k, k);
}`;

/** Petals: instanced blades of dark glass with a glowing vein and lime rim. */
export const petalVert = /* glsl */ `
attribute float aIdx;
varying vec2 vUv;
varying vec3 vN;
varying vec3 vV;
varying float vIdx;
void main(){
  vUv = uv;
  vIdx = aIdx;
  mat4 m = modelMatrix * instanceMatrix;
  vec4 w = m * vec4(position, 1.0);
  vN = normalize(mat3(m) * normal);
  vV = normalize(cameraPosition - w.xyz);
  gl_Position = projectionMatrix * viewMatrix * w;
}`;

export const petalFrag = /* glsl */ `
uniform float uTime;
uniform float uGlow;
uniform vec3 uAccent;
varying vec2 vUv;
varying vec3 vN;
varying vec3 vV;
varying float vIdx;
void main(){
  vec3 n = normalize(vN);
  if (!gl_FrontFacing) n = -n;
  float fres = pow(1.0 - abs(dot(n, normalize(vV))), 2.5);
  float vein = exp(-pow((vUv.x - 0.5) * 9.0, 2.0));
  // sap of light climbing each petal, offset per petal
  float climb = exp(-pow((fract(uTime * 0.22 + vIdx * 0.137) - vUv.y) * 7.0, 2.0));
  float tip = smoothstep(0.7, 1.0, vUv.y);
  vec3 glass = vec3(0.025, 0.028, 0.03) + vec3(0.06, 0.07, 0.065) * (1.0 - vUv.y);
  vec3 col = glass;
  col += uAccent * fres * (0.35 + 0.9 * uGlow);
  col += mix(uAccent, vec3(1.0), 0.35) * vein * (0.15 + climb * 1.6) * uGlow;
  col += vec3(1.0) * tip * fres * 0.6 * uGlow;
  gl_FragColor = vec4(col, 1.0);
}`;

export const bloomCoreVert = /* glsl */ `
varying vec3 vN;
varying vec3 vV;
varying vec3 vP;
void main(){
  vec4 w = modelMatrix * vec4(position, 1.0);
  vN = normalize(mat3(modelMatrix) * normal);
  vV = normalize(cameraPosition - w.xyz);
  vP = position;
  gl_Position = projectionMatrix * viewMatrix * w;
}`;

export const bloomCoreFrag = /* glsl */ `
uniform float uTime;
uniform float uGlow;
uniform vec3 uAccent;
varying vec3 vN;
varying vec3 vV;
varying vec3 vP;
${snoise3}
void main(){
  float fres = pow(1.0 - abs(dot(normalize(vN), normalize(vV))), 1.5);
  float n = snoise(vP * 6.0 + uTime * 0.4) * 0.5 + 0.5;
  vec3 col = mix(uAccent, vec3(1.0), 0.45 + 0.4 * n) * (0.4 + fres * 1.4 + n * 0.5) * uGlow;
  gl_FragColor = vec4(col, 1.0);
}`;

/** Full-screen dip to black (hides the cuts between scenes). */
export const fadeVert = /* glsl */ `
void main(){ gl_Position = vec4(position.xy * 2.0, 0.0, 1.0); }`;

export const fadeFrag = /* glsl */ `
uniform float uOpacity;
uniform vec3 uColor;
void main(){ gl_FragColor = vec4(uColor, uOpacity); }`;
