/**
 * Contact finale: the arch's light, drawn live over its baked surroundings.
 *
 * uOn     0 → 1 as the visitor arrives: the light climbs the arch from the ground up
 * uFlare  a brief surge (the email was copied)
 * uPortal 0 → 1 the doorway was clicked: the gate wakes before the multiverse fall
 */
export const glowVert = /* glsl */ `
varying vec3 vPos;
varying vec3 vWorld;
void main(){
  vPos = position;
  vec4 w = modelMatrix * vec4(position, 1.0);
  vWorld = w.xyz;
  gl_Position = projectionMatrix * viewMatrix * w;
}`;

/** Light in the stone joints and the inlaid lines. */
export const glowFrag = /* glsl */ `
uniform vec3 uColor;
uniform float uIntensity;
uniform float uOn;
uniform float uFlare;
uniform float uTime;
uniform float uTop;      // height the light has to climb to
uniform vec3 uHoverPos;  // world point under the cursor on the arch
uniform float uHoverAmt;
uniform float uPortal;
varying vec3 vPos;
varying vec3 vWorld;
void main(){
  // the joints near the cursor run hot
  float near = smoothstep(1.1, 0.0, distance(vWorld, uHoverPos)) * uHoverAmt;
  // climbs from the ground to the crown as it switches on
  float h = vPos.y / uTop;
  float lit = smoothstep(h - 0.02, h + 0.12, uOn * 1.15);
  // a slow pulse running upward, like current through the stone
  float run = 0.5 + 0.5 * sin(vPos.y * 2.2 - uTime * 1.4);
  float k = uIntensity * (0.8 + 0.25 * run + uFlare * 1.6 + near * 2.2 + uPortal * (2.4 + 1.2 * sin(vPos.y * 6.0 - uTime * 12.0)));
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
uniform float uHoverAmt;
uniform float uPortal;
varying vec3 vPos;
void main(){
  float y = vPos.y / uTop;
  float x = abs(vPos.x) / uHalf;
  float body = pow(1.0 - y, 2.2) * (1.0 - smoothstep(0.55, 1.0, x));
  // fine vertical threads drifting upward
  float threads = 0.85 + 0.15 * sin(vPos.x * 42.0 + sin(vPos.y * 3.0 + uTime * 0.6) * 1.5);
  float shimmer = 0.85 + 0.15 * sin(vPos.y * 9.0 - uTime * 1.2);
  float a = body * threads * shimmer * (0.1 + uFlare * 0.35 + uHoverAmt * 0.12) * uOn;
  // clicked: the sheet winds up into a whirling gate, brightest at its heart
  vec2 g = vec2(vPos.x / uHalf, (vPos.y - uTop * 0.48) / (uTop * 0.5));
  float gr = length(g);
  float swirl = 0.5 + 0.5 * sin(atan(g.y, g.x) * 5.0 + gr * 16.0 - uTime * 9.0);
  a += uPortal * (0.35 + 0.65 * swirl) * smoothstep(1.1, 0.0, gr) * (0.6 + 2.4 * uPortal) * (1.0 - smoothstep(0.85, 1.0, x));
  gl_FragColor = vec4(mix(uColor, vec3(0.85, 0.93, 1.0), uPortal * smoothstep(0.7, 0.0, gr)) * a, 1.0);
}`;
