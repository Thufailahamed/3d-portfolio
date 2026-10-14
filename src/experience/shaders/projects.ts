import { snoise3 } from "./noise";

export const duneVert = /* glsl */ `
uniform float uTime;
uniform float uSize;
uniform float uPixelRatio;
uniform vec3 uTint;
attribute float aRand;
varying vec3 vColor;
varying float vAlpha;
${snoise3}
void main(){
  vec3 p = position;
  float d = length(p.xz);
  // rolling dunes drift slowly with the wind; a calm basin around the prism
  float h = snoise(vec3(p.xz * 0.09 + vec2(uTime * 0.02, 0.0), 0.0)) * 1.8
          + snoise(vec3(p.xz * 0.35, uTime * 0.04)) * 0.25;
  h *= smoothstep(1.8, 9.0, d);
  p.y = abs(h) * 0.7 + 0.02;                // always above the opaque banks

  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;

  float crest = smoothstep(-0.6, 1.8, h);
  vec3 base = vec3(0.55, 0.56, 0.52) * (0.18 + 0.6 * crest);
  vColor = mix(base, uTint * 1.4, exp(-d * 0.22) * 0.9);
  vAlpha = smoothstep(42.0, 10.0, -mv.z) * (0.35 + 0.65 * aRand);
  gl_PointSize = uSize * (0.5 + aRand) * uPixelRatio / -mv.z;
}`;

export const duneFrag = /* glsl */ `
uniform float uOpacity;
varying vec3 vColor;
varying float vAlpha;
void main(){
  float d = length(gl_PointCoord - 0.5);
  float a = smoothstep(0.5, 0.1, d) * vAlpha * uOpacity;
  gl_FragColor = vec4(vColor * a, a);
}`;

/** Smoky, iridescent backdrop behind project detail pages. */
export const backdropFrag = /* glsl */ `
uniform float uTime;
uniform float uOpacity;
uniform vec3 uTint;
uniform vec2 uRes;
varying vec2 vUv;
${snoise3}
float fbm(vec3 p){ float a=0.5,s=0.0; for(int i=0;i<5;i++){ s+=a*snoise(p); p*=2.02; a*=0.5; } return s; }
void main(){
  vec2 uv = (vUv - 0.5) * vec2(uRes.x / uRes.y, 1.0);
  float t = uTime * 0.04;
  vec2 q = vec2(fbm(vec3(uv * 1.4, t)), fbm(vec3(uv * 1.4 + 5.2, t)));
  float n = fbm(vec3(uv * 1.2 + q * 1.6, t * 1.5));
  float smoke = smoothstep(-0.3, 0.9, n);
  // thin-film style rainbow on the smoke ridges
  vec3 irid = 0.5 + 0.5 * cos(6.2831 * (n * 1.4 + vec3(0.0, 0.33, 0.67)));
  // mostly dark: the smoke only gathers toward the top, so the copy reads on near-black
  float fall = smoothstep(-0.7, 0.6, uv.y);
  vec3 col = mix(vec3(0.014), uTint * 0.09, smoke * fall);
  col += irid * pow(smoke, 3.0) * 0.03 * fall;
  col += vec3(0.8) * pow(smoke, 6.0) * 0.06 * fall;
  col *= 1.0 - 0.5 * length(uv);
  gl_FragColor = vec4(col, uOpacity);
}`;
