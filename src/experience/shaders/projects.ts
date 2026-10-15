import { snoise3 } from "./noise";

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
