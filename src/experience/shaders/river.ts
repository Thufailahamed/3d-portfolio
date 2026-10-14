import { riverGlsl } from "../river";
import { snoise3 } from "./noise";

/** Flat XZ surfaces (ground, water): vP is the group-local position on the floor. */
export const floorVert = /* glsl */ `
varying vec2 vP;
varying vec3 vW;
void main(){
  vP = position.xz;
  vec4 w = modelMatrix * vec4(position, 1.0);
  vW = w.xyz;
  gl_Position = projectionMatrix * viewMatrix * w;
}`;

/** Dark banks either side of the river; opaque, so reflections only show through the water. */
export const groundFrag = /* glsl */ `
uniform vec3 uTint;
uniform vec3 uBg;
varying vec2 vP;
varying vec3 vW;
${snoise3}
${riverGlsl}
void main(){
  float inside = riverInside(vP);
  if (inside > 0.0) discard;
  float n = snoise(vec3(vP * 0.7, 0.0)) * 0.5 + 0.5;
  vec3 col = vec3(0.007, 0.008, 0.01) * (0.7 + 0.6 * n);
  col *= 1.0 - 0.5 * exp(inside * 3.0);            // wet, darker earth at the waterline
  col += uTint * 0.035 * exp(-dot(vP, vP) * 0.07);  // the crystal's light spills onto the banks
  float dist = length(cameraPosition - vW);
  col = mix(col, uBg, 1.0 - exp(-pow(dist * 0.03, 2.0)));
  gl_FragColor = vec4(col, 1.0);
}`;

/**
 * Still, dark water between the river particles. The reflections are real mirrored
 * geometry drawn underneath; this only decides how much of them shows (more at grazing angles).
 */
export const waterFrag = /* glsl */ `
uniform vec3 uBg;
varying vec2 vP;
varying vec3 vW;
${riverGlsl}
void main(){
  if (riverInside(vP) < 0.0) discard;
  vec3 V = normalize(cameraPosition - vW);
  float fres = pow(1.0 - max(V.y, 0.0), 4.0);
  float alpha = mix(0.75, 0.4, fres);
  float fog = 1.0 - exp(-pow(length(cameraPosition - vW) * 0.03, 2.0));
  // premultiplied: rgb is what the surface adds, alpha how much of the reflection it hides
  gl_FragColor = vec4(mix(vec3(0.002, 0.003, 0.005), uBg, fog), mix(alpha, 1.0, fog));
}`;

/**
 * The river itself: glitter drifting downstream. Each particle keeps its place across
 * the stream (aAcross, -1 bank … 1 bank) and follows the river curve as it flows.
 */
export const streamVert = /* glsl */ `
uniform float uTime;
uniform float uSize;
uniform float uPixelRatio;
uniform vec3 uTint;
attribute float aAcross;
attribute float aRand;
attribute float aHue;
varying vec3 vColor;
varying float vAlpha;
${riverGlsl}

vec3 mineral(float t){
  vec3 a = mix(vec3(0.1, 0.3, 1.0), vec3(0.1, 0.85, 0.9), smoothstep(0.0, 0.55, t));
  return mix(a, vec3(0.45, 1.0, 0.35), smoothstep(0.55, 1.0, t));
}

void main(){
  const float START = -13.0;
  const float LEN = 23.0;
  // faster mid-stream, lazy along the banks
  float speed = 0.22 * (1.0 - 0.6 * abs(aAcross)) * (0.7 + 0.6 * aRand);
  float t = mod(position.z - START + uTime * speed, LEN);
  float z = START + t;
  float x = riverX(z) + aAcross * riverHalfWidth(z) * 0.97;
  vec4 mv = modelViewMatrix * vec4(x, 0.012, z, 1.0);
  gl_Position = projectionMatrix * mv;

  float edge = smoothstep(0.55, 1.0, abs(aAcross));
  float near = exp(-(x * x + z * z) * 0.06);
  float twinkle = 0.45 + 0.55 * sin(uTime * (0.8 + aRand * 2.4) + aRand * 60.0);
  vColor = mix(mineral(aHue), uTint, 0.3 + 0.4 * near);
  float dist = -mv.z;
  // fade in at the source and out at the end so the wrap never pops
  float ends = smoothstep(0.0, 2.5, t) * smoothstep(LEN, LEN - 2.5, t);
  vAlpha = (0.25 + 0.75 * edge) * (0.5 + 0.8 * near) * twinkle * ends * exp(-pow(dist * 0.02, 2.2));
  gl_PointSize = uSize * (0.35 + aRand * 0.9) * uPixelRatio / dist;
}`;

/** Faceted wet stone under the crystal, lit from above by its glow. */
export const rockVert = /* glsl */ `
varying vec3 vW;
varying vec3 vN;
void main(){
  vec4 w = modelMatrix * vec4(position, 1.0);
  vW = w.xyz;
  vN = normalize(mat3(modelMatrix) * normal);
  gl_Position = projectionMatrix * viewMatrix * w;
}`;

export const rockFrag = /* glsl */ `
uniform vec3 uTint;
uniform vec3 uLight;
uniform float uReflect;
uniform float uFloorY;
varying vec3 vW;
varying vec3 vN;

float hash(vec3 p){
  p = fract(p * vec3(0.1031, 0.1030, 0.0973));
  p += dot(p, p.yxz + 33.33);
  return fract((p.x + p.y) * p.z);
}

void main(){
  vec3 N = normalize(vN);
  vec3 P = vW;
  // shade the mirrored copy as the real rock, then darken it
  if (uReflect > 0.5) { N.y = -N.y; P.y = 2.0 * uFloorY - P.y; }
  float y = P.y - uFloorY;
  if (y < -0.005) discard;                         // only what stands above the water

  vec3 V = normalize(cameraPosition - P);
  vec3 L = uLight - P;
  float dl = length(L);
  L /= dl;
  float grain = hash(floor(P * 42.0));
  float lit = max(dot(N, L), 0.0);

  vec3 col = vec3(0.01, 0.011, 0.014) * (0.7 + 0.6 * grain);
  col += uTint * lit * 0.35 / (1.0 + dl * dl * 1.1) * (0.6 + 0.8 * grain);
  col += vec3(0.6, 0.75, 1.0) * pow(1.0 - max(dot(N, V), 0.0), 4.0) * 0.05;  // cool rim
  float wet = exp(-y * 9.0);
  col *= 1.0 - 0.45 * wet;
  col += mix(vec3(0.5, 0.7, 1.0), uTint, 0.5) * exp(-y * 70.0) * 0.12;        // waterline
  if (uReflect > 0.5) col *= 0.3;
  gl_FragColor = vec4(col, 1.0);
}`;
