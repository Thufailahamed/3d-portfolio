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
varying vec3 vWorld;
void main(){
  #include <color_vertex>
  vWorld = (modelMatrix * vec4(position, 1.0)).xyz;
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
uniform float uTime;
uniform vec3 uHoverPos;
uniform float uHoverAmt;
uniform vec3 uRune;
varying vec3 vN;
varying vec3 vV;
varying vec3 vWorld;

vec3 hash3(vec3 p){
  p = vec3(dot(p, vec3(127.1, 311.7, 74.7)), dot(p, vec3(269.5, 183.3, 246.1)), dot(p, vec3(113.5, 271.9, 124.6)));
  return fract(sin(p) * 43758.5453);
}
// Chebyshev cells: square-ish, angular borders read as carved runes / cracks
vec2 cells(vec3 x, out float id){
  vec3 p = floor(x);
  vec3 f = fract(x);
  float d1 = 8.0, d2 = 8.0;
  id = 0.0;
  for (int k = -1; k <= 1; k++)
  for (int j = -1; j <= 1; j++)
  for (int i = -1; i <= 1; i++){
    vec3 b = vec3(float(i), float(j), float(k));
    vec3 h = hash3(p + b);
    vec3 r = b - f + h;
    float d = max(abs(r.x), max(abs(r.y), abs(r.z)));
    if (d < d1){ d2 = d1; d1 = d; id = h.x; } else if (d < d2){ d2 = d; }
  }
  return vec2(d1, d2);
}

void main(){
  vec3 col = vColor.rgb * uExposure;
  float f = pow(1.0 - abs(dot(normalize(vN), normalize(vV))), 2.5);
  col += uAccent * (f * uRim + uFill);

  // hover: glowing runes wake up in the stone around the cursor
  if (uHoverAmt > 0.001){
    float d = length(vWorld - uHoverPos);
    float edge = hash3(floor(vWorld * 9.0)).x * 0.12;
    float mask = smoothstep(0.85 * uHoverAmt + 0.05, 0.15, d + edge) * uHoverAmt;
    if (mask > 0.0){
      float id;
      vec2 c = cells(vWorld * 4.2, id);
      float lineA = 1.0 - smoothstep(0.02, 0.07, c.y - c.x);
      float id2;
      vec2 c2 = cells(vWorld * 9.0 + 3.7, id2);
      float lineB = (1.0 - smoothstep(0.01, 0.06, c2.y - c2.x)) * step(0.45, id);
      float flicker = 0.75 + 0.25 * sin(uTime * (14.0 + id * 20.0) + id * 50.0);
      float pulse = 0.75 + 0.25 * sin(uTime * 3.0 - d * 10.0);
      // ivy stays leafy: no runes where the bake is clearly green
      float leaf = smoothstep(0.0, 0.004, vColor.g - max(vColor.r, vColor.b) * 1.15);
      float runes = max(lineA, lineB * 0.8) * flicker * pulse * mask * (1.0 - leaf);
      col = mix(col, col * vec3(0.6, 0.72, 1.0), mask * 0.45);
      col += uRune * (runes * 3.2 + mask * 0.035);
    }
  }
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
