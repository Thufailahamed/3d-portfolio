import { snoise3 } from "./noise";

/**
 * "Signal": swirling interference used both inside the shard ring (on a disc)
 * and as the full-screen tunnel. Same function → the hand-off is seamless.
 */
const signalFn = /* glsl */ `
${snoise3}
float fbm(vec3 p){
  float a = 0.5, s = 0.0;
  for(int i = 0; i < 4; i++){ s += a * snoise(p); p *= 2.03; a *= 0.5; }
  return s;
}
// uv centred at 0, roughly -1..1. travel pushes us down the tunnel.
vec3 signal(vec2 uv, float time, float travel, vec3 accent){
  float r = length(uv) + 1e-4;
  float a = atan(uv.y, uv.x);
  float depth = 0.32 / r + travel * 3.0 + time * 0.12;
  float twist = a + depth * 0.9;
  vec2 tc = vec2(cos(twist), sin(twist)) * 1.3;
  float n = fbm(vec3(tc, depth * 1.4));
  float bands = sin(depth * 18.0 + n * 6.0) * 0.5 + 0.5;
  float streak = pow(max(0.0, snoise(vec3(a * 9.0, depth * 2.2, time * 0.2))), 3.0);

  vec3 deep = vec3(0.0015, 0.002, 0.0015);
  float body = smoothstep(0.35, 0.95, n * 0.5 + 0.5) * bands;
  vec3 col = mix(deep, accent * 0.32, body * body);
  col += accent * streak * 1.1;
  col += vec3(1.0) * pow(bands, 28.0) * 0.28 * smoothstep(0.0, 0.6, r);
  // a hot core you fall toward
  col += mix(accent, vec3(1.0), 0.5) * exp(-r * r * 34.0) * (0.45 + travel * 1.2);
  return col;
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
  vec3 col = signal(uv * 1.4, uTime, 0.0, uAccent);
  float edge = smoothstep(1.0, 0.82, r);
  // the membrane ripples outward from the centre
  float ring = exp(-pow((r - fract(uTime * 0.25)) * 10.0, 2.0)) * 0.4;
  col += uAccent * ring;
  gl_FragColor = vec4(col * edge * uOpacity, edge * uOpacity);
}`;

export const tunnelVert = /* glsl */ `
varying vec2 vUv;
void main(){
  vUv = uv;
  // full-screen triangle-free quad straight in clip space
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
  // radial speed lines grow with travel
  float r = length(uv);
  float a = atan(uv.y, uv.x);
  float lines = pow(max(0.0, sin(a * 60.0 + snoise(vec3(a * 4.0, uTravel * 6.0, 0.0)) * 8.0)), 40.0);
  col += vec3(0.9, 1.0, 0.85) * lines * smoothstep(0.2, 1.2, r) * uTravel * 0.35;
  // darken the rim so the eye is pulled to the centre
  col *= mix(1.0, 0.45, smoothstep(0.6, 1.6, r));
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
