import { snoise3 } from "./noise";

/**
 * "Signal": a swirling energy portal used both inside the shard ring (on a disc)
 * and as the full-screen tunnel. Same function → the hand-off is seamless.
 */
const signalFn = /* glsl */ `
${snoise3}
float fbm(vec3 p){
  float a = 0.5, s = 0.0;
  for(int i = 0; i < 4; i++){ s += a * snoise(p); p *= 2.03; a *= 0.5; }
  return s;
}
float fbm3(vec3 p){
  float a = 0.5, s = 0.0;
  for(int i = 0; i < 3; i++){ s += a * snoise(p); p *= 2.07; a *= 0.5; }
  return s;
}
// uv centred at 0, roughly -1..1. travel pushes us down the tunnel.
vec3 signal(vec2 uv, float time, float travel, vec3 accent){
  float r = length(uv) + 1e-4;
  float a = atan(uv.y, uv.x);
  float depth = 0.32 / r + travel * 3.0 + time * 0.12;
  float twist = a + depth * 0.9;
  vec2 tc = vec2(cos(twist), sin(twist)) * 1.3;

  // domain-warped noise: smoky, layered plasma rather than flat blobs
  vec3 q = vec3(tc, depth * 1.4);
  vec2 warp = vec2(fbm3(q + vec3(0.0, 0.0, time * 0.05)), fbm3(q + vec3(5.2, 1.3, 2.1)));
  float n = fbm(q + vec3(warp * 0.85, 0.0));

  // the tunnel's wall shells, split a touch per colour channel toward the rim (lens fringe)
  float ca = 0.03 * smoothstep(0.2, 1.2, r);
  vec3 bands = vec3(
    sin((depth + ca) * 18.0 + n * 6.0),
    sin(depth * 18.0 + n * 6.0),
    sin((depth - ca) * 18.0 + n * 6.0)
  ) * 0.5 + 0.5;

  vec3 deep = vec3(0.0015, 0.002, 0.0015);
  float body = smoothstep(0.3, 0.95, n * 0.5 + 0.5);
  vec3 col = mix(deep, accent * 0.3, body * body * bands.g);
  // thin energy filaments along the ridges of the smoke
  float fil = pow(1.0 - abs(n), 16.0);
  col += mix(accent, vec3(1.0), 0.35) * fil * 0.5 * smoothstep(0.08, 0.5, r);
  // streaks drawn along the flow
  float streak = pow(max(0.0, snoise(vec3(a * 9.0, depth * 2.2, time * 0.2))), 3.0);
  col += accent * streak * 0.85;
  // glowing shell edges (lime-white, fringed) instead of flat grey lines
  col += vec3(0.82, 1.0, 0.78) * pow(bands, vec3(26.0)) * 0.24 * smoothstep(0.0, 0.6, r);
  // depth haze: the far end glows, the near walls fall into shadow
  col += accent * exp(-r * 2.4) * 0.16;
  col *= mix(1.0, 0.55, smoothstep(0.5, 1.5, r));
  // a hot core you fall toward
  col += mix(accent, vec3(1.0), 0.55) * exp(-r * r * 34.0) * (0.45 + travel * 1.2);
  col += vec3(1.0) * exp(-r * r * 220.0) * (0.35 + travel * 0.6);
  return col;
}

// the portal: a deep-blue vortex of smoke spiralling into a bright eye
vec3 portal(vec2 uv, float t){
  float r = length(uv) + 1e-4;
  float a = atan(uv.y, uv.x);
  float swirl = a + 2.4 / (r + 0.28) - t * 0.9;
  vec2 p = vec2(cos(swirl), sin(swirl)) * (0.35 + r);
  float n = fbm(vec3(p * 2.1, t * 0.12));
  float n2 = fbm(vec3(p * 4.3 + n * 1.4, t * 0.18 + 3.0));
  float v = smoothstep(0.2, 0.95, n * 0.5 + 0.5 + n2 * 0.4);
  vec3 deep = vec3(0.0, 0.004, 0.035);
  vec3 mid = vec3(0.02, 0.12, 0.85);
  vec3 hi = vec3(0.55, 0.7, 1.0);
  vec3 col = mix(deep, mid, v);
  col = mix(col, hi, smoothstep(0.78, 1.0, v) * 0.6);
  // dark rifts between the arms
  col *= smoothstep(0.1, 0.45, v) * 0.92 + 0.08;
  col += mid * exp(-r * 2.6) * 0.45;
  col += hi * exp(-r * r * 30.0) * 0.45;
  return col;
}

float hash12(vec2 p){
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
`;

export const discVert = /* glsl */ `
varying vec2 vUv;
void main(){
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

export const discFrag = /* glsl */ `
uniform float uTime;
uniform float uOpacity;
uniform vec3 uAccent;
varying vec2 vUv;
${signalFn}
void main(){
  vec2 uv = (vUv - 0.5) * 2.0;
  float r = length(uv);
  // space bends toward the rim: the view inside is pulled in slightly, like a lens
  vec2 bent = uv * (1.0 + 0.18 * smoothstep(0.55, 1.0, r));
  vec3 col = portal(bent * 1.15, uTime);
  float edge = smoothstep(1.0, 0.82, r);
  // the membrane ripples outward from the centre
  float ring = exp(-pow((r - fract(uTime * 0.25)) * 10.0, 2.0)) * 0.15;
  col += uAccent * ring;
  // a bright, slightly unsteady lip where the portal meets the room
  float wob = snoise(vec3(atan(uv.y, uv.x) * 2.0, uTime * 0.6, 0.0)) * 0.015;
  float lip = exp(-pow((r - 0.9 - wob) * 30.0, 2.0));
  col += mix(uAccent, vec3(1.0), 0.2) * lip * 0.3;
  float alpha = max(edge, lip) * uOpacity;
  gl_FragColor = vec4(col, alpha);
}`;

export const tunnelVert = /* glsl */ `
varying vec2 vUv;
void main(){
  vUv = uv;
  // full-screen quad straight in clip space
  gl_Position = vec4(position.xy * 2.0, 0.0, 1.0);
}`;

export const tunnelFrag = /* glsl */ `
uniform float uTime;
uniform float uOpacity;
uniform float uTravel;
uniform vec2 uRes;
uniform vec3 uAccent;
varying vec2 vUv;
${signalFn}
void main(){
  vec2 uv = (vUv - 0.5) * vec2(uRes.x / uRes.y, 1.0) * 2.0;
  vec3 col = signal(uv * 1.4, uTime, uTravel, uAccent);
  // first the portal itself fills the screen, then it opens into the tunnel
  col = mix(portal(uv * 0.75, uTime), col, smoothstep(0.45, 0.8, uTravel));
  float r = length(uv);
  float a = atan(uv.y, uv.x);

  // light streaks rushing past: each angular lane has its own streak, speed and length
  float lanes = 140.0;
  float lane = (a / 6.2831853 + 0.5) * lanes;
  float id = floor(lane);
  float h = hash12(vec2(id, 7.0));
  float across = abs(fract(lane) - 0.5) * 2.0;           // 0 at the lane's centre
  float speed = 0.35 + h * 0.9;
  float ph = fract(h * 13.7 + uTime * speed * (0.4 + uTravel * 2.6));
  float at = mix(0.05, 1.9, ph * ph);                     // accelerates outward, toward us
  float len = 0.04 + 0.35 * ph * (0.4 + uTravel);
  float streaks = exp(-pow((r - at) / len, 2.0)) * smoothstep(1.0, 0.0, across) * step(0.45, h);
  col += mix(uAccent, vec3(1.0), 0.6) * streaks * smoothstep(0.12, 0.6, r) * (0.25 + uTravel * 0.9);

  // pull the eye to the centre; a whisper of grain keeps the gradients from banding
  col *= mix(1.0, 0.45, smoothstep(0.6, 1.6, r));
  col += (hash12(gl_FragCoord.xy + fract(uTime) * 91.0) - 0.5) * 0.012;
  gl_FragColor = vec4(col, uOpacity);
}`;

/** Inner cut faces of the shards: dark glass with a glowing lime rim. */
export const coreVert = /* glsl */ `
varying vec3 vN;
varying vec3 vV;
void main(){
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vN = normalize(normalMatrix * normal);
  vV = -mv.xyz;
  gl_Position = projectionMatrix * mv;
}`;

export const coreFrag = /* glsl */ `
uniform vec3 uAccent;
uniform float uRim;
uniform float uFill;
varying vec3 vN;
varying vec3 vV;
void main(){
  float f = pow(1.0 - abs(dot(normalize(vN), normalize(vV))), 2.2);
  vec3 col = vec3(0.012, 0.014, 0.01) + uAccent * (f * uRim + uFill);
  gl_FragColor = vec4(col, 1.0);
}`;
