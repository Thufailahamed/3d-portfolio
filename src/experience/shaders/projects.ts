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
  p.y = h - 0.15;

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

export const prismVert = /* glsl */ `
uniform float uScreenH;
varying vec3 vWorld;
varying vec3 vN;
varying vec3 vNv;
varying vec2 vScreen;
void main(){
  vec4 w = modelMatrix * vec4(position, 1.0);
  vWorld = w.xyz;
  vN = normalize(mat3(modelMatrix) * normal);
  vNv = normalize(normalMatrix * normal);
  // camera-facing "screen" inside the crystal: view-space offset from the prism's centre
  vec4 v = viewMatrix * w;
  vec4 c = viewMatrix * modelMatrix * vec4(0.0, 0.0, 0.0, 1.0);
  vScreen = (v.xy - c.xy) / uScreenH;
  gl_Position = projectionMatrix * v;
}`;

export const prismFrag = /* glsl */ `
uniform sampler2D uTexA;
uniform sampler2D uTexB;
uniform float uMix;
uniform float uTime;
uniform vec3 uTint;
uniform float uReflect;
uniform float uFloorY;
varying vec3 vWorld;
varying vec3 vN;
varying vec3 vNv;
varying vec2 vScreen;
${snoise3}

vec3 sampleImg(vec2 uv, vec2 off){
  vec3 a = vec3(texture2D(uTexA, uv + off).r, texture2D(uTexA, uv).g, texture2D(uTexA, uv - off).b);
  vec3 b = vec3(texture2D(uTexB, uv + off).r, texture2D(uTexB, uv).g, texture2D(uTexB, uv - off).b);
  // noise-dissolve between the two project images
  float n = snoise(vec3(uv * 3.2, uTime * 0.15)) * 0.5 + 0.5;
  float edge = uMix * 1.4 - 0.2;
  float t = smoothstep(edge - 0.12, edge + 0.12, n);
  vec3 col = mix(b, a, t);
  // hot seam along the dissolve front
  float seam = 1.0 - abs(t * 2.0 - 1.0);
  return col + uTint * seam * step(0.001, uMix) * step(uMix, 0.999) * 1.4;
}

void main(){
  vec3 N = normalize(vN);
  if (!gl_FrontFacing) N = -N;
  vec3 V = normalize(cameraPosition - vWorld);
  float facing = abs(dot(N, V));
  float fres = pow(1.0 - facing, 2.6);

  // each facet bends the inner screen by its own (view-space) normal
  vec3 Nv = normalize(vNv);
  vec2 uv = vScreen * vec2(1.0, 1.0) + 0.5;
  uv = (uv - 0.5) * vec2(0.62, 1.0) + 0.5;          // cover-fit a 16:10 image into a tall prism
  uv -= Nv.xy * 0.09;
  float wobble = sin(uMix * 3.14159) * 0.06;
  uv += Nv.xy * wobble;
  vec2 off = Nv.xy * (0.005 + wobble * 0.2);

  vec3 img = sampleImg(clamp(uv, 0.0, 1.0), off);
  vec3 col = img * 1.05 * mix(vec3(1.0), uTint, 0.12);
  col *= 0.6 + 0.4 * facing;                         // darker toward the facet edges
  col += uTint * fres * 0.9;                          // tinted glass rim
  col += vec3(1.0) * pow(fres, 6.0) * 0.5;            // specular sliver

  if (uReflect > 0.5) {
    // mirrored copy under the floor: fade with distance below the floor line
    float k = smoothstep(uFloorY - 2.4, uFloorY, vWorld.y);
    col *= 0.28 * k;
  }
  gl_FragColor = vec4(col, 1.0);
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
  vec3 col = mix(vec3(0.02), uTint * 0.35, smoke);
  col += irid * pow(smoke, 3.0) * 0.12;
  col += vec3(0.8) * pow(smoke, 6.0) * 0.18;
  col *= 1.0 - 0.45 * length(uv);
  gl_FragColor = vec4(col, uOpacity);
}`;
