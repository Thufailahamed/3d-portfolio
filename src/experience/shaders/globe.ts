import { gradientNoiseGlsl } from "./ascent";
import { valueNoiseGlsl } from "./night";

/**
 * Night-side Earth from NASA's Black Marble (2016) composite.
 *
 * uBody   — the planet's opacity
 * uPower  — the power wave: angle from the south pole (0 … 1 = north pole) it has reached;
 *           city lights switch on behind it
 * vPolar  — this point's angle from the south pole, 0 … 1
 */
export const earthVert = /* glsl */ `
varying vec2 vUv;
varying vec3 vN;
varying vec3 vW;
varying float vPolar;
void main(){
  vUv = uv;
  vPolar = acos(clamp(-normalize(position).y, -1.0, 1.0)) / 3.14159265;
  vec4 w = modelMatrix * vec4(position, 1.0);
  vW = w.xyz;
  vN = normalize(mat3(modelMatrix) * normal);
  gl_Position = projectionMatrix * viewMatrix * w;
}`;

export const earthFrag = /* glsl */ `
uniform sampler2D uMap;
uniform float uBody;
uniform float uPower;
uniform vec3 uMoon;      // soft moonlight direction (world)
uniform vec3 uAtmo;      // atmosphere colour
uniform vec3 uWave;      // colour of the power wave front
varying vec2 vUv;
varying vec3 vN;
varying vec3 vW;
varying float vPolar;
${valueNoiseGlsl}

void main(){
  vec3 tex = texture2D(uMap, vUv).rgb;   // sRGB texture → linear here
  float lum = dot(tex, vec3(0.2126, 0.7152, 0.0722));
  // city lights are bright and warm; moonlit land and ice are dim and cool
  float lights = smoothstep(0.02, 0.22, lum) * smoothstep(-0.005, 0.03, tex.r - tex.b);
  // seen close (the map magnified past its pixels) the lights break into streets and towns,
  // and the dim land and sea are read from a blurred level of the map, so its compression
  // blocks don't show as tiles across the ocean
  vec2 texel = vUv * vec2(4096.0, 2048.0);
  float tpp = max(length(dFdx(texel)), length(dFdy(texel)));
  float mag = smoothstep(1.1, 0.35, tpp);
  float mask = lights;   // (before the grain, which can take it past 1)
  // close in, the smaller towns come up too
  lights = mix(lights, smoothstep(0.012, 0.14, lum) * smoothstep(-0.005, 0.03, tex.r - tex.b), mag);
  float grain = vnoise(vec3(texel * 2.7, 0.5)) * 0.5 + 0.5;
  lights *= mix(1.0, 0.35 + 1.4 * grain * grain, mag * smoothstep(0.08, 0.3, lum));
  vec3 soft = texture2D(uMap, vUv, 3.5).rgb;
  float softLum = dot(soft, vec3(0.2126, 0.7152, 0.0722));
  // the surface without its city lights (added back sharp below). Close in that's the blurred
  // map held down to moonlit-land brightness, so the cities leave neither glow nor holes in it
  vec3 base = mix(tex * (1.0 - mask), min(soft, vec3(0.03, 0.033, 0.046)), mag);

  vec3 N = normalize(vN);
  vec3 V = normalize(cameraPosition - vW);
  float facing = max(dot(N, V), 0.0);
  float moon = 0.22 + 0.78 * smoothstep(-0.25, 0.95, dot(N, normalize(uMoon)));

  // the surface: moonlit land, ice and ocean, shaded so the planet reads as a sphere
  vec3 col = base * 1.8 * moon;
  // the cities switch on behind the power wave
  // (written with rising edges: smoothstep with edge0 > edge1 is undefined, and some GPUs return 0)
  float on = 1.0 - smoothstep(uPower - 0.06, uPower, vPolar);
  col += tex * lights * (0.06 + 2.6 * on);
  // the wave front itself: a thin travelling band of light
  float fd = (vPolar - uPower) / 0.022;   // (squared by hand: pow() of a negative is NaN)
  float front = exp(-fd * fd) * step(0.001, uPower) * (1.0 - smoothstep(1.0, 1.15, uPower));
  col += uWave * front * 0.55;
  // a faint moon sheen on the oceans, so the dark side still has a surface
  vec3 L = normalize(uMoon);
  // (close in, judged on the blurred map: on the sharp one the darkest specks between towns pass
  // for ocean and catch the sheen, leaving the rest of the land as dark pits)
  float ocean = 1.0 - smoothstep(0.004, 0.03, mix(lum, softLum, mag));
  float sheen = pow(max(dot(reflect(-L, N), V), 0.0), 18.0);
  col += uAtmo * sheen * ocean * 0.18;
  // atmosphere hugging the limb, brightest on the moonlit side
  float rim = pow(1.0 - facing, 2.6);
  col += uAtmo * rim * (0.12 + 0.88 * moon) * 0.75;

  // premultiplied: the planet fades in as a whole
  gl_FragColor = vec4(col * uBody, uBody);
}`;

/**
 * The cloud cover: a shell just above the surface (so close in it drifts over the ground with
 * real parallax, and thickens toward the limb). Weather-like systems from warped fbm, frayed at
 * the edges; moonlit on top, and glowing warm from below where cities shine up into it.
 * uCloud — how much of it shows (thick close in, a light cover from space).
 */
export const cloudVert = /* glsl */ `
varying vec2 vUv;
varying vec3 vP;
varying vec3 vN;
varying vec3 vW;
void main(){
  vUv = uv;
  vP = normalize(position);
  vec4 w = modelMatrix * vec4(position, 1.0);
  vW = w.xyz;
  vN = normalize(mat3(modelMatrix) * normal);
  gl_Position = projectionMatrix * viewMatrix * w;
}`;

export const cloudFrag = /* glsl */ `
uniform sampler2D uMap;
uniform vec3 uMoon;
uniform float uCloud;
uniform float uTime;
varying vec2 vUv;
varying vec3 vP;
varying vec3 vN;
varying vec3 vW;
${gradientNoiseGlsl}
float fbmT(vec3 p){
  float s = 0.0, a = 0.5;
  for (int i = 0; i < 5; i++){ s += a * gnoise(p); p = TURN * p * 2.03 + 1.7; a *= 0.5; }
  return s;
}
void main(){
  vec3 q = vP * 4.2 + vec3(uTime * 0.003, 0.0, -uTime * 0.002);
  // warped twice, so the systems curl and stream like real weather
  q += 0.8 * vec3(gnoise(q * 0.5 + 3.1), gnoise(q * 0.5 + 7.7), gnoise(q * 0.5 + 1.3));
  q += 0.25 * vec3(gnoise(q * 1.7 + 5.2), gnoise(q * 1.7 + 2.4), gnoise(q * 1.7 + 9.6));
  float body = fbmT(q) * 0.5 + 0.5;
  // fine streaks, seen only close in (no finer: specks of dark cloud read as holes over the cities)
  body += 0.035 * gnoise(TURN * q * 17.0);
  // a little more weather at the mid-latitudes, clearer over the subtropics
  body += 0.04 * cos(abs(vP.y) * 9.0);
  float d = body - 0.535;
  d -= (gnoise(TURN * TURN * q * 9.0 + 1.9) * 0.5 + 0.5) * 0.09 * (1.0 - smoothstep(0.0, 0.12, d));
  float dens = smoothstep(0.0, 0.2, d);

  vec3 N = normalize(vN);
  vec3 V = normalize(cameraPosition - vW);
  float facing = max(dot(N, V), 0.0);
  dens = 1.0 - pow(1.0 - dens, 1.0 + 1.6 * (1.0 - facing));   // more air to look through at the limb
  float moon = 0.12 + 0.88 * smoothstep(-0.25, 0.95, dot(N, normalize(uMoon)));
  // thick cores stand taller and catch more moonlight; thin edges stay dark and blue
  vec3 col = mix(vec3(0.026, 0.031, 0.045), vec3(0.08, 0.09, 0.115), smoothstep(0.5, 0.78, body)) * moon;
  // the cities below light it up from underneath (a blurred read of the map): thin cloud glows
  // with them, thick cloud only faintly
  vec3 under = texture2D(uMap, vUv, 3.0).rgb;
  float warm = smoothstep(-0.005, 0.03, under.r - under.b);
  col += vec3(1.0, 0.74, 0.45) * under * warm * 2.4 * (0.35 + 0.65 * (1.0 - smoothstep(0.55, 0.8, body)));

  float a = dens * 0.92 * uCloud;
  gl_FragColor = vec4(col * a, a);
}`;

/** Soft atmosphere halo just outside the limb (back faces, additive). */
export const atmoVert = /* glsl */ `
varying vec3 vN;
varying vec3 vW;
void main(){
  vec4 w = modelMatrix * vec4(position, 1.0);
  vW = w.xyz;
  vN = normalize(mat3(modelMatrix) * normal);
  gl_Position = projectionMatrix * viewMatrix * w;
}`;

export const atmoFrag = /* glsl */ `
uniform vec3 uAtmo;
uniform float uBody;
varying vec3 vN;
varying vec3 vW;
void main(){
  vec3 V = normalize(cameraPosition - vW);
  float d = dot(normalize(vN), V);                   // back faces: negative toward the limb
  // a crisp bright edge at the limb with a long soft falloff into space
  float k = clamp(0.7 + d, 0.0, 1.0);
  float glow = pow(k, 9.0) * 0.75 + pow(k, 3.0) * 0.16;
  gl_FragColor = vec4(uAtmo * glow * uBody, 1.0);
}`;

/** Country borders and coastlines: only lit as the power wave passes over them. */
export const borderVert = /* glsl */ `
attribute float aKind;   // 1 = border between countries, 0 = coastline
varying float vKind;
varying float vFront;
varying float vPolar;
void main(){
  vec4 w = modelMatrix * vec4(position, 1.0);
  vec3 c = (modelMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
  vFront = smoothstep(-0.02, 0.18, dot(normalize(w.xyz - c), normalize(cameraPosition - c)));
  vPolar = acos(clamp(-normalize(position).y, -1.0, 1.0)) / 3.14159265;
  vKind = aKind;
  gl_Position = projectionMatrix * viewMatrix * w;
}`;

export const borderFrag = /* glsl */ `
uniform vec3 uColor;
uniform float uPower;
varying float vKind;
varying float vFront;
varying float vPolar;
void main(){
  // a band trailing just behind the wave front
  float bd = (vPolar - uPower + 0.03) / 0.07;   // (squared by hand: pow() of a negative is NaN)
  float band = exp(-bd * bd) * step(0.001, uPower);
  float a = mix(0.45, 0.8, vKind) * band * vFront;
  gl_FragColor = vec4(uColor * a, 1.0);
}`;

/** City markers: a bright dot with a slow pulsing ring, hidden on the far side. */
export const markerVert = /* glsl */ `
uniform float uPixelRatio;
uniform float uTime;
attribute float aSeed;
attribute float aHome;
varying float vFront;
varying float vPhase;
varying float vHome;
void main(){
  vHome = aHome;
  vec4 w = modelMatrix * vec4(position, 1.0);
  vec3 c = (modelMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
  vFront = smoothstep(0.05, 0.3, dot(normalize(w.xyz - c), normalize(cameraPosition - w.xyz)));
  vPhase = fract(uTime * 0.45 + aSeed);
  gl_PointSize = mix(34.0, 58.0, aHome) * uPixelRatio;
  gl_Position = projectionMatrix * viewMatrix * w;
}`;

export const markerFrag = /* glsl */ `
uniform vec3 uColor;
uniform vec3 uHome;
uniform float uOn;
varying float vFront;
varying float vPhase;
varying float vHome;
void main(){
  float d = length(gl_PointCoord - 0.5) * 2.0;     // 0 centre … 1 edge
  float dot_ = smoothstep(mix(0.16, 0.12, vHome), mix(0.08, 0.05, vHome), d);
  float ring = smoothstep(0.05, 0.0, abs(d - vPhase)) * (1.0 - vPhase);
  // home gets a second, steady ring
  float halo = smoothstep(0.04, 0.0, abs(d - 0.42)) * 0.45 * vHome;
  float a = (dot_ + ring * 0.6 + halo) * vFront * uOn;
  gl_FragColor = vec4(mix(uColor, uHome, vHome) * a, 1.0);
}`;

/**
 * Great-circle arcs from home to each marked city. Each grows out from home, then
 * carries a travelling pulse of light; hidden wherever the planet stands in the way.
 */
export const arcVert = /* glsl */ `
uniform float uR;
attribute float aT;      // 0 at home … 1 at the city
attribute float aSeed;
varying float vT;
varying float vSeed;
varying float vVis;
void main(){
  vec4 w = modelMatrix * vec4(position, 1.0);
  vec3 c = (modelMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
  // does the ray from here to the camera hit the planet?
  vec3 dir = normalize(cameraPosition - w.xyz);
  vec3 oc = w.xyz - c;
  float b = dot(oc, dir);
  float disc = b * b - (dot(oc, oc) - uR * uR);
  vVis = (disc > 0.0 && -b - sqrt(max(disc, 0.0)) > 0.0) ? 0.0 : 1.0;
  vT = aT;
  vSeed = aSeed;
  gl_Position = projectionMatrix * viewMatrix * w;
}`;

export const arcFrag = /* glsl */ `
uniform vec3 uColor;
uniform float uDraw;
uniform float uTime;
varying float vT;
varying float vSeed;
varying float vVis;
void main(){
  // grows out from home, each arc a little after the last
  float reach = uDraw * 1.5 - vSeed * 0.5;
  float drawn = smoothstep(reach, reach - 0.04, vT);
  // a comet of light running out to the city, then a pause
  float head = fract(uTime * 0.16 + vSeed) * 1.6 - 0.2;
  float trail = smoothstep(head - 0.28, head, vT) * smoothstep(head + 0.01, head, vT);
  float a = (0.32 + trail * 1.8) * drawn * vVis;
  a *= smoothstep(0.0, 0.03, vT);
  gl_FragColor = vec4(uColor * a, 1.0);
}`;

/** Faint latitude / longitude grid, front side only, once the planet is powered. */
export const gridVert = /* glsl */ `
varying float vFront;
void main(){
  vec4 w = modelMatrix * vec4(position, 1.0);
  vec3 c = (modelMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
  vFront = smoothstep(0.0, 0.35, dot(normalize(w.xyz - c), normalize(cameraPosition - c)));
  gl_Position = projectionMatrix * viewMatrix * w;
}`;

export const gridFrag = /* glsl */ `
uniform vec3 uColor;
uniform float uOn;
varying float vFront;
void main(){
  gl_FragColor = vec4(uColor * 0.07 * vFront * uOn, 1.0);
}`;
