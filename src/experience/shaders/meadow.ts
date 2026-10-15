import { nightGlsl, valueNoiseGlsl } from "./night";
import { meadowGlsl } from "./valley";

/**
 * Wildflowers. One instanced flower: a stem (aPart 0, aT root → tip) and a head of petals
 * (aPart 1, aPetal = angle around the head, distance out along the petal, across it) around a
 * small centre (aPart 2). The stem moves like the grass; the petals open with the daylight,
 * fold up at night and in the rain, and open for the cursor.
 */
export const flowerVert = /* glsl */ `
attribute float aPart;
attribute float aT;
attribute vec3 aPetal;
attribute vec3 aRoot;
attribute vec4 aFlower;   // height, head size, colour pick, random
uniform float uDay;
varying float vPart;
varying float vR;
varying float vPick;
varying vec3 vW;
varying vec3 vN;
${meadowGlsl}
void main(){
  float h = aFlower.x;
  float r = aFlower.w;
  vec3 root = aRoot + uOrigin;
  float push;
  vec2 bend = meadowBend(root, h, r, push) * 0.7;   // a little stiffer than grass
  vec3 tip = stemPoint(root, h, bend, 1.0);
  vec3 up = normalize(tip - stemPoint(root, h, bend, 0.9));

  // open by day, folded at night and in the rain; the cursor coaxes them open
  float open = clamp(0.2 + 0.8 * uDay - 0.5 * uWet + push * 0.9, 0.0, 1.0);
  open = open * open * (3.0 - 2.0 * open);

  vec3 p;
  vec3 n;
  // the head's frame: up along the stem, a fixed sideways reference
  vec3 ax = normalize(cross(up, vec3(0.31, 0.0, 0.95)));
  vec3 az = cross(ax, up);
  if (aPart < 0.5){
    vec2 toCam = normalize(cameraPosition.xz - root.xz);
    vec3 side = vec3(-toCam.y, 0.0, toCam.x);
    p = stemPoint(root, h, bend, aT) + side * aPetal.z * 0.006;
    n = normalize(vec3(toCam.x, 0.4, toCam.y));
  } else {
    float s = aFlower.y;
    float a = aPetal.x;
    vec3 radial = cos(a) * ax + sin(a) * az;
    vec3 tangent = -sin(a) * ax + cos(a) * az;
    if (aPart < 1.5){
      // the petal lifts from flat (open) toward upright (closed), cupping as it goes
      float lift = mix(1.35, 0.12, open) + aPetal.y * aPetal.y * mix(0.25, 0.05, open);
      vec3 out_ = radial * cos(lift) + up * sin(lift);
      p = tip + (out_ * aPetal.y + tangent * aPetal.z) * s;
      n = normalize(cross(tangent, out_)) * sign(dot(cross(tangent, out_), up) + 1e-3);
    } else {
      p = tip + (radial * aPetal.y * 0.32 + up * (0.12 - aPetal.y * 0.08)) * s;
      n = up;
    }
  }
  vPart = aPart;
  vR = aPetal.y;
  vPick = aFlower.z;
  vW = p;
  vN = n;
  gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
}`;

export const flowerFrag = /* glsl */ `
uniform float uTime;
uniform vec3 uTint;
uniform vec3 uCrystal;
varying float vPart;
varying float vR;
varying float vPick;
varying vec3 vW;
varying vec3 vN;
${valueNoiseGlsl}
${nightGlsl}
vec3 petalColour(float k){
  if (k < 0.3) return vec3(0.85, 0.85, 0.8);        // daisies
  if (k < 0.55) return vec3(0.9, 0.62, 0.05);       // buttercups
  if (k < 0.75) return vec3(0.8, 0.28, 0.45);       // campion pink
  if (k < 0.9) return vec3(0.35, 0.36, 0.85);       // harebell blue
  return vec3(0.75, 0.12, 0.08);                    // poppy
}
void main(){
  vec3 N = normalize(vN);
  if (!gl_FrontFacing) N = -N;
  vec3 V = normalize(cameraPosition - vW);
  vec3 albedo;
  if (vPart < 0.5) albedo = vec3(0.04, 0.09, 0.025);
  else if (vPart < 1.5) albedo = petalColour(vPick) * (0.75 + 0.25 * vR);
  else albedo = vec3(0.85, 0.6, 0.08);
  float lam = dot(N, MOON_DIR) * 0.5 + 0.5;
  vec3 col = albedo * (MOON_LIGHT * lam * 0.9 + SKY_LIGHT * 1.3);
  // thin petals glow with light from behind
  if (vPart > 0.5 && vPart < 1.5) col += albedo * MOON_LIGHT * pow(max(dot(-V, MOON_DIR), 0.0), 2.0) * 0.8;
  vec3 toC = uCrystal - vW;
  float dc = length(toC);
  col += albedo * uTint * 3.0 / (dc * dc + 1.0);
  col *= 1.0 - 0.3 * uWet;
  col = nightAir(col, vW);
  gl_FragColor = vec4(col, 1.0);
}`;

/**
 * Glowing mushrooms. One instanced mushroom: stem (aPart 0), cap (1, top) and gills (2,
 * underneath); aUV.y runs up the stem / out across the cap. By day they are ordinary caps
 * (some red with white spots); after dark they glow in slow pulses, and they swell and
 * brighten — bloom — when the cursor comes near.
 */
export const mushroomVert = /* glsl */ `
attribute float aPart;
attribute vec2 aUV;
varying float vPart;
varying vec2 vUV;
varying vec3 vW;
varying vec3 vN;
varying vec3 vL;
varying float vRand;
varying float vNear;
${meadowGlsl}
void main(){
  vec3 base = vec3(0.0);
  float rand = 0.0;
#ifdef USE_INSTANCING
  base = (modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
  rand = fract(sin(dot(base.xz, vec2(12.9898, 78.233))) * 43758.5453);
#endif
  vec2 away;
  float near = cursorNear(base + vec3(0.0, 0.15, 0.0), away);
  vec3 p = position;
  // the cap swells as it blooms (the cursor), and breathes slowly on its own
  float swell = 1.0 + near * 0.35 + 0.04 * sin(uTime * 1.3 + rand * 20.0);
  if (aPart > 0.5){
    p.xz *= swell;
    p.y += (swell - 1.0) * 0.02;
  }
  vec3 n = normal;
  vec4 local = vec4(p, 1.0);
#ifdef USE_INSTANCING
  local = instanceMatrix * local;
  n = mat3(instanceMatrix) * n;
#endif
  vec4 w = modelMatrix * local;
  vPart = aPart;
  vUV = aUV;
  vW = w.xyz;
  vN = normalize(mat3(modelMatrix) * n);
  vL = position;
  vRand = rand;
  vNear = near;
  gl_Position = projectionMatrix * viewMatrix * w;
}`;

export const mushroomFrag = /* glsl */ `
uniform float uTime;
uniform vec3 uTint;
varying float vPart;
varying vec2 vUV;
varying vec3 vW;
varying vec3 vN;
varying vec3 vL;
varying float vRand;
varying float vNear;
${valueNoiseGlsl}
${nightGlsl}
void main(){
  vec3 N = normalize(vN);
  if (!gl_FrontFacing) N = -N;
  // two kinds: fly agarics (red, white warts) and pale little bonnets
  bool agaric = vRand > 0.62;
  vec3 capCol = agaric ? vec3(0.62, 0.05, 0.02) : mix(vec3(0.55, 0.42, 0.28), vec3(0.75, 0.68, 0.55), fract(vRand * 7.0));
  float spots = agaric ? smoothstep(0.62, 0.7, vnoise(vL * 46.0 + vRand * 10.0)) : 0.0;
  vec3 albedo = vPart < 0.5 ? vec3(0.78, 0.74, 0.66) : (vPart < 1.5 ? mix(capCol, vec3(0.92, 0.9, 0.84), spots) : vec3(0.7, 0.62, 0.52));
  // darker at the cap's crown, paler at its rim
  if (vPart > 0.5 && vPart < 1.5) albedo *= 0.75 + 0.35 * vUV.y;

  float lam = dot(N, MOON_DIR) * 0.5 + 0.5;
  vec3 col = albedo * (MOON_LIGHT * lam * 0.8 + SKY_LIGHT * 1.4);

  // bioluminescence: after dark the gills and cap rims glow, in slow waves that pass through
  // the cluster; the cursor makes them flare
  float dark = (1.0 - uDay) * (1.0 - 0.35 * uWet);
  vec3 glowCol = mix(vec3(0.15, 0.95, 0.75), vec3(0.35, 0.6, 1.0), fract(vRand * 3.7));
  glowCol = mix(glowCol, uTint, 0.25);
  float wave = 0.55 + 0.45 * sin(uTime * 1.1 - (vW.x + vW.z) * 1.7 + vRand * 6.0);
  float where = vPart > 1.5 ? 1.0 : (vPart > 0.5 ? 0.5 + 0.5 * smoothstep(0.4, 1.0, vUV.y) : 0.15 + 0.35 * vUV.y);
  float glow = where * wave * (0.7 + vNear * 2.5) * (agaric ? 0.3 : 1.0);
  // the cap is translucent: lit from within, so it reads as glowing, not painted
  col = mix(col, col * 0.4, dark);
  col += glowCol * glow * dark * 2.6;
  col = nightAir(col, vW);
  gl_FragColor = vec4(col, 1.0);
}`;

/** A soft pool of mushroom light on the ground under each cluster (additive). */
export const poolVert = /* glsl */ `
varying vec2 vUv;
varying float vRand;
void main(){
  vUv = uv;
  vec4 w = modelMatrix * instanceMatrix * vec4(position, 1.0);
  vRand = fract(sin(dot(w.xz, vec2(12.9898, 78.233))) * 43758.5453);
  gl_Position = projectionMatrix * viewMatrix * w;
}`;

export const poolFrag = /* glsl */ `
uniform float uDay;
uniform float uWet;
uniform float uTime;
varying vec2 vUv;
varying float vRand;
void main(){
  float d = length(vUv - 0.5) * 2.0;
  float g = exp(-d * d * 5.0) * (1.0 - smoothstep(0.8, 1.0, d));
  float wave = 0.65 + 0.35 * sin(uTime * 1.1 + vRand * 6.0);
  vec3 c = mix(vec3(0.1, 0.8, 0.6), vec3(0.3, 0.5, 1.0), fract(vRand * 3.7));
  gl_FragColor = vec4(c * g * wave * 0.4 * (1.0 - uDay) * (1.0 - 0.35 * uWet), 1.0);
}`;
