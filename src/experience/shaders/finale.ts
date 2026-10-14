/**
 * Contact finale: the arch's light, drawn live over its baked surroundings.
 *
 * uOn     0 → 1 as the visitor arrives: the light climbs the arch from the ground up
 * uFlare  a brief surge (the email was copied)
 */
export const glowVert = /* glsl */ `
varying vec3 vPos;
void main(){
  vPos = position;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

/** Light in the stone joints and the inlaid lines. */
export const glowFrag = /* glsl */ `
uniform vec3 uColor;
uniform float uIntensity;
uniform float uOn;
uniform float uFlare;
uniform float uTime;
uniform float uTop;      // height the light has to climb to
varying vec3 vPos;
void main(){
  // climbs from the ground to the crown as it switches on
  float h = vPos.y / uTop;
  float lit = smoothstep(h - 0.02, h + 0.12, uOn * 1.15);
  // a slow pulse running upward, like current through the stone
  float run = 0.5 + 0.5 * sin(vPos.y * 2.2 - uTime * 1.4);
  float k = uIntensity * (0.8 + 0.25 * run + uFlare * 1.6);
  // a bright edge at the climbing front
  float front = exp(-pow((h - uOn * 1.15 + 0.05) / 0.05, 2.0)) * (1.0 - step(1.0, uOn));
  gl_FragColor = vec4(uColor * (k * lit + front * 2.5), 1.0);
}`;

/** The doorway: a faint standing sheet of light, strongest at the threshold. */
export const veilFrag = /* glsl */ `
uniform vec3 uColor;
uniform float uOn;
uniform float uFlare;
uniform float uTime;
uniform float uTop;
uniform float uHalf;     // half the doorway's width
varying vec3 vPos;
void main(){
  float y = vPos.y / uTop;
  float x = abs(vPos.x) / uHalf;
  float body = pow(1.0 - y, 2.2) * (1.0 - smoothstep(0.55, 1.0, x));
  // fine vertical threads drifting upward
  float threads = 0.85 + 0.15 * sin(vPos.x * 42.0 + sin(vPos.y * 3.0 + uTime * 0.6) * 1.5);
  float shimmer = 0.85 + 0.15 * sin(vPos.y * 9.0 - uTime * 1.2);
  float a = body * threads * shimmer * (0.1 + uFlare * 0.35) * uOn;
  gl_FragColor = vec4(uColor * a, 1.0);
}`;
