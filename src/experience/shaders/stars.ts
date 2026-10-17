import { gradientNoiseGlsl } from "./ascent";

/** The starfield behind the globe. World space, additive; each star has its own size and colour. */
export const starVert = /* glsl */ `
uniform float uTime;
uniform float uPixelRatio;
uniform float uSize;
attribute float aSeed;
attribute float aMag;    // 0 faint … 1 brightest
attribute vec3 aTint;
varying float vAlpha;
varying vec3 vTint;
varying float vMag;
void main(){
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  // a gentle scintillation, stronger on the faint ones
  vAlpha = (0.55 + 0.45 * aMag) * (1.0 - (1.0 - aMag) * 0.35 * (0.5 + 0.5 * sin(uTime * (0.6 + aSeed * 1.8) + aSeed * 50.0)));
  vTint = aTint;
  vMag = aMag;
  gl_PointSize = uSize * (0.8 + 4.5 * aMag * aMag) * uPixelRatio;
  gl_Position = projectionMatrix * mv;
}`;

export const starFrag = /* glsl */ `
uniform vec3 uColor;
uniform float uOpacity;
varying float vAlpha;
varying vec3 vTint;
varying float vMag;
void main(){
  vec2 p = gl_PointCoord - 0.5;
  float d = length(p);
  // a sharp core with a soft halo; the brightest get faint cross spikes
  float core = exp(-d * d / 0.006);
  float halo = exp(-d / 0.12) * 0.25 * vMag;
  float spikes = (exp(-abs(p.x) / 0.012) + exp(-abs(p.y) / 0.012)) * smoothstep(0.5, 0.0, d) * 0.35 * smoothstep(0.75, 1.0, vMag);
  float a = (core + halo + spikes) * smoothstep(0.5, 0.42, d);
  gl_FragColor = vec4(uColor * vTint * a * vAlpha * uOpacity, 1.0);
}`;

/** A faint band of the Milky Way: unresolved starlight with dark dust lanes, on a far backdrop. */
export const galaxyVert = /* glsl */ `
varying vec2 vUv;
void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;

export const galaxyFrag = /* glsl */ `
uniform float uOpacity;
varying vec2 vUv;
${gradientNoiseGlsl}
float fbm(vec3 p){
  float s = 0.0, a = 0.5;
  for (int i = 0; i < 5; i++){ s += a * gnoise(p); p = TURN * p * 2.07 + 1.3; a *= 0.5; }
  return s;
}
void main(){
  vec2 q = vUv * vec2(4.0, 2.25);
  float y = (vUv.y - 0.5) * 2.0;
  // the band, wandering a little along its length
  float off = 0.12 * gnoise(vec3(q.x * 0.35, 1.7, 0.0));
  float w = (y - off) / 0.28;
  float band = exp(-w * w);
  float glow = fbm(vec3(q * 1.2, 0.0)) * 0.5 + 0.5;
  float dust = smoothstep(0.48, 0.72, fbm(vec3(q * 2.3, 4.0)) * 0.5 + 0.5);
  float lane = exp(-pow((y - off + 0.03) / 0.07, 2.0)) * smoothstep(0.35, 0.6, fbm(vec3(q * 1.6, 9.0)) * 0.5 + 0.5);
  float light = band * (0.35 + 0.9 * glow) * (1.0 - 0.75 * dust) * (1.0 - 0.8 * lane);
  // a warmer core toward one end, cooler arms
  vec3 col = mix(vec3(0.55, 0.62, 0.85), vec3(1.0, 0.82, 0.62), smoothstep(0.3, 0.75, vUv.x) * band);
  // a faint unresolved haze of tiny stars
  float grain = smoothstep(0.82, 1.0, gnoise(vec3(q * 60.0, 2.0)) * 0.5 + 0.5);
  float edge = smoothstep(0.0, 0.2, vUv.x) * smoothstep(1.0, 0.8, vUv.x);
  gl_FragColor = vec4(col * (light * 0.1 + grain * band * 0.25) * edge * uOpacity, 1.0);
}`;
