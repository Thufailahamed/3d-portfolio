/**
 * The investigation board: a printed night-lights map under a desk lamp, its cities
 * glowing, and the light threads from home out to the places the work reaches.
 */

/** Shared: the lamp's pool of light (a soft spot cone) on a surface with normal n. */
const lamp = /* glsl */ `
uniform vec3 uLampPos;
uniform vec3 uLampDir;
uniform float uLampOn;  // the lamp's dimmer, 0 → 1 as it warms up
float lampLight(vec3 world, vec3 n){
  vec3 L = normalize(uLampPos - world);
  float c = dot(-L, uLampDir);
  float cone = smoothstep(0.55, 0.98, c) * 0.8 + smoothstep(0.35, 0.75, c) * 0.2;
  float d = distance(uLampPos, world);
  return max(dot(n, L), 0.0) * cone * 1.95 / (0.4 + d * d * 0.25) * uLampOn;
}`;

export const mapVert = /* glsl */ `
varying vec2 vUv;
varying vec3 vWorld;
void main(){
  vUv = uv;
  vec4 w = modelMatrix * vec4(position, 1.0);
  vWorld = w.xyz;
  gl_Position = projectionMatrix * viewMatrix * w;
}`;

/**
 * The map: Black Marble, printed on creased paper. The paper's creases catch the lamp;
 * the city lights glow on their own (they switch on east to west as the board wakes).
 */
export const mapFrag = /* glsl */ `
uniform sampler2D uNight;
uniform sampler2D uPaper;
uniform sampler2D uInk;
uniform vec4 uRect;     // u0, u1, v0, v1 of the crop inside the equirectangular texture
uniform float uOn;      // 0 → 1: the lights come on
uniform float uTime;
uniform vec2 uHub;      // home, in map uv
uniform float uFocus;   // a card is open: the map dims a little
varying vec2 vUv;
varying vec3 vWorld;
${lamp}
void main(){
  vec2 tuv = vec2(mix(uRect.x, uRect.y, vUv.x), mix(uRect.z, uRect.w, vUv.y));
  vec3 night = texture2D(uNight, tuv).rgb;
  vec3 n = texture2D(uPaper, vUv).xyz * 2.0 - 1.0;
  n = normalize(vec3(n.xy * 1.4, n.z));
  float lit = lampLight(vWorld, n);

  // the print: deep ink-blue paper, the planet a shade lighter
  float lum = dot(night, vec3(0.299, 0.587, 0.114));
  // ink-navy: the ocean's blue pulled down, so the lights carry the colour
  vec3 base = mix(night, vec3(lum) * vec3(0.55, 0.7, 1.0), 0.55);
  vec3 paper = vec3(0.01, 0.013, 0.024) + base * 0.3;
  vec3 col = paper * (0.45 + lit * 0.8);
  // paper sheen where the creases face the lamp
  col += vec3(0.035, 0.04, 0.055) * pow(lit, 2.0);

  // printed ink (graticule, coastlines, labels): pale, lit by the lamp
  vec4 ink = texture2D(uInk, vUv);
  col = mix(col, vec3(0.58, 0.64, 0.75) * (0.28 + lit * 0.62), ink.a * 0.78);

  // the cities, switching on from the east as the board wakes
  float wave = smoothstep(1.0 - uOn * 1.3, 1.2 - uOn * 1.3, vUv.x);
  float cities = smoothstep(0.06, 0.55, lum);
  float flicker = 0.92 + 0.08 * sin(uTime * 3.0 + tuv.x * 900.0 + tuv.y * 700.0);
  vec3 glow = night * vec3(1.1, 0.95, 0.8) * cities * 2.4 * flicker * wave;
  col += glow * (1.0 - uFocus * 0.35);

  // home burns brighter, with a slow ring around it
  vec2 d = (vUv - uHub) * vec2(2.647, 1.0);
  float r = length(d);
  float ring = exp(-pow((r - fract(uTime * 0.35) * 0.06) / 0.003, 2.0)) * (1.0 - fract(uTime * 0.35));
  col += vec3(0.78, 1.0, 0.24) * (exp(-r * r / 0.00006) * 2.0 + ring * 0.9) * uOn;

  gl_FragColor = vec4(col * (1.0 - uFocus * 0.25), 1.0);
}`;

/** Light threads from home to the other places, drawn in as the board wakes. */
export const reachVert = /* glsl */ `
attribute float aT;
attribute float aSeed;
varying float vT;
varying float vSeed;
void main(){
  vT = aT;
  vSeed = aSeed;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

export const reachFrag = /* glsl */ `
uniform vec3 uColor;
uniform float uDraw;
uniform float uTime;
uniform float uFocus;
varying float vT;
varying float vSeed;
void main(){
  float head = uDraw * 1.6 - vSeed * 0.6;
  if (vT > head) discard;
  // a pulse running out from home, and the line fading toward its far end
  float pulse = exp(-pow((fract(vT - uTime * 0.18 + vSeed) - 0.5) / 0.05, 2.0));
  float a = (0.28 + pulse * 1.4) * (1.0 - vT * 0.35) * (1.0 - uFocus * 0.6);
  gl_FragColor = vec4(uColor * a, 1.0);
}`;

/** The place markers on the map: small glowing points, home in the accent. */
export const dotVert = /* glsl */ `
uniform float uPixelRatio;
uniform float uSize;
attribute float aHome;
varying float vHome;
void main(){
  vHome = aHome;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = uSize * (1.0 + aHome * 0.8) * uPixelRatio / -mv.z;
  gl_Position = projectionMatrix * mv;
}`;

export const dotFrag = /* glsl */ `
uniform vec3 uColor;
uniform vec3 uHome;
uniform float uOn;
varying float vHome;
void main(){
  float r = length(gl_PointCoord - 0.5) * 2.0;
  float core = smoothstep(0.35, 0.0, r);
  float halo = exp(-r * r * 5.0) * 0.5;
  gl_FragColor = vec4(mix(uColor, uHome, vHome) * (core * 1.6 + halo) * uOn, 1.0);
}`;

/** Soft shadow a card or note throws on the cork. */
export const shadowVert = /* glsl */ `
varying vec2 vUv;
void main(){
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

export const shadowFrag = /* glsl */ `
uniform float uOpacity;
uniform vec2 uSize;    // the card's size; the quad is larger by the blur
uniform float uBlur;
varying vec2 vUv;
void main(){
  vec2 half_ = uSize * 0.5;
  vec2 p = (vUv - 0.5) * (uSize + uBlur * 2.0);
  vec2 q = abs(p) - half_ + uBlur * 0.5;
  float d = length(max(q, 0.0)) + min(max(q.x, q.y), 0.0);
  float a = 1.0 - smoothstep(-uBlur * 0.5, uBlur, d);
  gl_FragColor = vec4(0.0, 0.0, 0.0, a * uOpacity);
}`;

/** Cork, drawn rather than textured (the model's own is baked full of old shadows). */
export const corkFrag = /* glsl */ `
uniform float uFocus;
varying vec2 vUv;
varying vec3 vWorld;
${lamp}
float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p){
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
}
// granules: the nearest of a jittered grid of cells, each its own shade
vec2 granule(vec2 p){
  vec2 i = floor(p), f = fract(p);
  float d = 9.0, id = 0.0;
  for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++){
    vec2 g = vec2(x, y);
    vec2 o = vec2(hash(i + g), hash(i + g + 7.3));
    float k = length(g + o - f);
    if (k < d){ d = k; id = hash(i + g + 3.1); }
  }
  return vec2(d, id);
}
float cork(vec2 p, float fade){
  vec2 g = granule(p * 260.0);
  float v = mix(0.5, g.y, fade) * 0.55 + noise(p * 90.0) * 0.3 + noise(p * 14.0) * 0.25;
  // dark pits between granules
  v -= smoothstep(0.75, 1.1, g.x) * 0.35 * fade;
  return v;
}
void main(){
  vec2 p = vWorld.xy;
  // fade the finest grain out where it would alias
  float fade = 1.0 - smoothstep(0.0012, 0.0035, length(fwidth(p)));
  float h = cork(p, fade);
  float e = 0.0015;
  vec3 n = normalize(vec3((cork(p - vec2(e, 0), fade) - cork(p + vec2(e, 0), fade)) * 0.9,
                          (cork(p - vec2(0, e), fade) - cork(p + vec2(0, e), fade)) * 0.9, 1.0));
  vec3 dark = vec3(0.13, 0.06, 0.025);
  vec3 light = vec3(0.5, 0.27, 0.11);
  vec3 col = mix(dark, light, clamp(h, 0.0, 1.0));
  // the occasional pale fleck
  col += vec3(0.18, 0.12, 0.06) * step(0.985, noise(p * 420.0)) * fade;
  float lit = lampLight(vWorld, n);
  col *= 0.08 + lit * 1.02;
  gl_FragColor = vec4(col * (1.0 - uFocus * 0.3), 1.0);
}`;

/** Subtle architectural slate studio wall behind the board with soft warm lamp falloff. */
export const wallFrag = /* glsl */ `
uniform float uFocus;
varying vec2 vUv;
varying vec3 vWorld;
${lamp}
float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p){
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
}
void main(){
  vec2 p = vWorld.xy;
  float g = noise(p * 20.0) * 0.6 + noise(p * 60.0) * 0.4;
  float seamX = smoothstep(0.006, 0.0, abs(fract(p.x / 0.48 + 0.5) - 0.5) * 0.48);
  vec3 n = vec3(0.0, 0.0, 1.0);

  vec3 baseWall = mix(vec3(0.032, 0.036, 0.045), vec3(0.052, 0.058, 0.072), g);
  baseWall *= 1.0 - seamX * 0.22;

  float lit = lampLight(vWorld, n);
  vec3 col = baseWall * (0.35 + lit * 1.15);

  // Soft drop shadow behind the wooden board frame
  vec2 bHalf = vec2(1.06, 0.585);
  vec2 q = abs(p) - bHalf;
  float bDist = length(max(q, 0.0)) + min(max(q.x, q.y), 0.0);
  float boardShadow = smoothstep(-0.01, 0.12, bDist);
  col *= 0.12 + 0.88 * boardShadow;

  gl_FragColor = vec4(col * (1.0 - uFocus * 0.3), 1.0);
}`;
