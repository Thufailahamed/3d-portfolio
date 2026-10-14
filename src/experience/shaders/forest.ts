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
varying vec3 vLocal;
void main(){
  #include <color_vertex>
  vLocal = position;
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
uniform float uRunesAll;
varying vec3 vN;
varying vec3 vV;
varying vec3 vWorld;
varying vec3 vLocal;

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

  // runes: woken locally by the hover, or across every stone once the ring has formed.
  // The pattern lives in each stone's own space so it travels with the stone.
  if (uHoverAmt > 0.001 || uRunesAll > 0.001){
    float d = length(vWorld - uHoverPos);
    float edge = hash3(floor(vWorld * 9.0)).x * 0.12;
    float hoverMask = smoothstep(0.85 * uHoverAmt + 0.05, 0.15, d + edge) * uHoverAmt;
    float id;
    vec2 c = cells(vLocal * 4.2, id);
    // with uRunesAll the cells light up one by one rather than all at once
    float mask = max(hoverMask, smoothstep(id, id + 0.25, uRunesAll * 1.25));
    if (mask > 0.0){
      float lineA = 1.0 - smoothstep(0.02, 0.07, c.y - c.x);
      float id2;
      vec2 c2 = cells(vLocal * 9.0 + 3.7, id2);
      float lineB = (1.0 - smoothstep(0.01, 0.06, c2.y - c2.x)) * step(0.45, id);
      float flicker = 0.75 + 0.25 * sin(uTime * (14.0 + id * 20.0) + id * 50.0);
      float pulse = 0.75 + 0.25 * sin(uTime * 3.0 - d * 10.0);
      // ivy stays leafy: no runes where the bake is clearly green
      float leaf = smoothstep(0.0, 0.004, vColor.g - max(vColor.r, vColor.b) * 1.15);
      // the fine second layer only under the cursor; the lit ring keeps to the bold cracks
      float runes = max(lineA, lineB * 0.8 * hoverMask) * flicker * pulse * mask * (1.0 - leaf);
      col = mix(col, col * vec3(0.6, 0.72, 1.0), mask * 0.45);
      col += uRune * (runes * 3.2 + mask * 0.035);
    }
  }
  gl_FragColor = vec4(col, 1.0);
  #include <fog_fragment>
}`;

/** Fireflies: drifting points that flash yellow-green now and then. */
export const fireflyVert = /* glsl */ `
uniform float uTime;
uniform float uSize;
uniform float uPixelRatio;
attribute float aRand;
varying float vBlink;
void main(){
  vec3 p = position;
  // lazy wandering: two octaves of drift per fly, plus a slow rise and dip
  float t = uTime;
  p.x += sin(t * 0.13 * (1.0 + aRand) + aRand * 40.0) * 0.8 + sin(t * 0.41 + aRand * 11.0) * 0.18;
  p.y += sin(t * 0.21 + aRand * 20.0) * 0.35 + sin(t * 0.9 + aRand * 5.0) * 0.05;
  p.z += cos(t * 0.11 * (1.0 + aRand) + aRand * 30.0) * 0.8 + cos(t * 0.37 + aRand * 17.0) * 0.18;
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;
  // each fly has its own rhythm: a short flash (some double-flash), then dark for a few seconds
  float cycle = fract(t * (0.18 + aRand * 0.16) + aRand * 7.0);
  float flash = exp(-pow((cycle - 0.1) * 16.0, 2.0));
  flash += exp(-pow((cycle - 0.24) * 16.0, 2.0)) * step(0.55, fract(aRand * 13.0));
  vBlink = 0.05 + flash;
  gl_PointSize = uSize * (0.6 + aRand * 0.7) * uPixelRatio / -mv.z;
}`;

export const fireflyFrag = /* glsl */ `
uniform vec3 uColor;
uniform float uIntensity;
varying float vBlink;
void main(){
  float d = length(gl_PointCoord - 0.5);
  float glow = smoothstep(0.5, 0.0, d);
  // hot core, soft halo
  float a = (pow(glow, 8.0) * 3.2 + pow(glow, 2.2) * 0.45) * vBlink * uIntensity;
  vec3 c = mix(uColor, vec3(1.0, 1.0, 0.85), pow(glow, 10.0) * 0.6);
  gl_FragColor = vec4(c * a, a);
}`;

/**
 * Butterflies: one instanced mesh. Wings hinge on the body axis (+Z is forward);
 * aSide is -1 / +1 for the left / right wing, 0 for the body.
 */
export const butterflyVert = /* glsl */ `
#include <common>
#include <fog_pars_vertex>
uniform float uTime;
attribute float aSide;
attribute float aEdge;
attribute vec2 aWing;
attribute float aPhase;
attribute float aRate;
varying float vEdge;
varying vec2 vWing;
varying float vSide;
varying vec3 vN;
varying vec3 vV;
void main(){
  vec3 p = position;
  // flap: quick downstroke, slower upstroke; now and then the wings rest open (a glide)
  float ph = uTime * aRate + aPhase;
  float s = sin(ph);
  float glide = smoothstep(0.55, 0.9, sin(uTime * 0.37 + aPhase * 3.1));
  float angle = mix(mix(-0.25, 1.15, 0.5 + 0.5 * s * abs(s) ), 0.12, glide);
  float ax = abs(p.x);
  if (aSide != 0.0){
    p.y = ax * sin(angle);
    p.x = sign(p.x) * ax * cos(angle);
  }
  vec3 n = aSide == 0.0 ? vec3(0.0, 1.0, 0.0) : normalize(vec3(-sign(p.x) * sin(angle), cos(angle), 0.0));
  vec4 w = modelMatrix * instanceMatrix * vec4(p, 1.0);
  vN = normalize(mat3(modelMatrix * instanceMatrix) * n);
  vV = cameraPosition - w.xyz;
  vEdge = aEdge;
  vWing = aWing;
  vSide = aSide;
  vec4 mvPosition = viewMatrix * w;
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}`;

export const butterflyFrag = /* glsl */ `
#include <common>
#include <fog_pars_fragment>
uniform float uIntensity;
varying float vEdge;
varying vec2 vWing;
varying float vSide;
varying vec3 vN;
varying vec3 vV;
void main(){
  if (vSide == 0.0){
    gl_FragColor = vec4(vec3(0.012, 0.012, 0.016), 1.0);
    #include <fog_fragment>
    return;
  }
  vec3 N = normalize(vN);
  vec3 V = normalize(vV);
  float facing = abs(dot(N, V));
  // morpho-style structural blue: shifts from deep violet-blue to bright cyan with the viewing angle
  float r = length(vWing);
  vec3 deep = vec3(0.01, 0.03, 0.22);
  vec3 bright = vec3(0.16, 0.58, 1.0);
  vec3 sheen = vec3(0.55, 0.85, 1.0);
  vec3 col = mix(deep, bright, smoothstep(0.1, 0.85, facing) * (1.0 - smoothstep(0.55, 1.05, r) * 0.6));
  col = mix(col, sheen, pow(facing, 6.0) * 0.35);
  // veins radiating from the hinge
  float ang = atan(vWing.y, abs(vWing.x));
  float vein = smoothstep(0.88, 1.0, abs(sin(ang * 7.0))) * smoothstep(0.15, 0.4, r);
  col *= 1.0 - vein * 0.45;
  // dark margin with a row of pale dots, as on real wings
  float margin = 1.0 - smoothstep(0.0, 0.22, vEdge);
  col = mix(col, vec3(0.01, 0.01, 0.02), margin * 0.92);
  float dots = smoothstep(0.55, 0.35, length(fract(vec2(ang * 3.2, vEdge * 7.0)) - 0.5)) * step(0.06, vEdge) * step(vEdge, 0.17);
  col += vec3(0.6, 0.75, 0.9) * dots * 0.25;
  // a faint inner glow so they read in the dark forest
  col += bright * 0.4 * (1.0 - margin) * (0.6 + 0.4 * facing);
  gl_FragColor = vec4(col * uIntensity, 1.0);
  #include <fog_fragment>
}`;
