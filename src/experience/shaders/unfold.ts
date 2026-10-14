/**
 * The globe opening into the board's map. One grid in (longitude, latitude) is drawn three
 * ways and blended on the GPU:
 *   sphere   — the globe as it was, turned so the map's centre meridian faces us (uM)
 *   cylinder — latitudes straighten into rows (uK1), the poles beyond the map fall away
 *   sheet    — the cylinder unrolls like a mat from the front outward: its curvature eases
 *              to nothing while every row keeps its length (uK2)
 * Positions are in the globe group's frame; the sheet is laid out in the camera's
 * frame (uCr / uCu / uCd, origin uO) so it lands flat and square on the screen.
 */
export const unfoldVert = /* glsl */ `
attribute float aTheta;   // longitude east of the map's centre, radians (-π … π)
attribute float aLat;     // latitude, degrees
uniform mat3 uM;          // sphere (canonical: front = +z, north = +y) → globe frame, as it is now
uniform vec3 uO;          // where the sheet's centre of curvature is (globe frame)
uniform vec3 uCr;
uniform vec3 uCu;
uniform vec3 uCd;         // camera right / up / back
uniform float uR;         // globe radius
uniform float uRc;        // cylinder radius = sheet width / 2π
uniform float uH;         // sheet height
uniform float uLat0;
uniform float uLat1;
uniform float uLonC;
uniform float uK1;
uniform float uK2;
varying vec2 vUv;
varying vec2 vInkUv;
varying vec3 vN;
varying vec3 vW;
varying float vClip;
void main(){
  float L = radians(aLat);
  vec3 sc = vec3(uR * cos(L) * sin(aTheta), uR * sin(L), uR * cos(L) * cos(aTheta));

  // the cylinder, unrolling: radius grows without bound while arc length is kept
  float y = (aLat - 0.5 * (uLat0 + uLat1)) / (uLat1 - uLat0) * uH;
  float a = aTheta * uRc;
  float rk = uRc / max(1.0 - uK2, 0.0004);
  float ph = a / rk;
  float s = sin(0.5 * ph);
  vec3 sheet = vec3(rk * sin(ph), y, uRc - 2.0 * rk * s * s);
  vec3 v = mix(sc, sheet, uK1);

  // the turning sphere, plus how far the shape has travelled from the aligned sphere
  vec3 p = uM * sc + (uO + uCr * v.x + uCu * v.y + uCd * v.z) - (uCr * sc.x + uCu * sc.y + uCd * sc.z);

  vN = normalize(mix(uM * normalize(sc), uCd, uK1));
  vUv = vec2((uLonC + degrees(aTheta) + 180.0) / 360.0, (aLat + 90.0) / 180.0);
  vInkUv = vec2(degrees(aTheta) / 360.0 + 0.5, (aLat - uLat0) / (uLat1 - uLat0));
  vClip = mix(1.0, smoothstep(uLat0 - 3.0, uLat0, aLat) * smoothstep(uLat1 + 3.0, uLat1, aLat), uK1);
  vec4 w = modelMatrix * vec4(p, 1.0);
  vW = w.xyz;
  gl_Position = projectionMatrix * viewMatrix * w;
}`;

/** Starts as the night globe (moonlit, a rim of atmosphere), ends as the board's printed map. */
export const unfoldFrag = /* glsl */ `
uniform sampler2D uMap;
uniform sampler2D uInk;
uniform vec3 uMoon;
uniform vec3 uAtmo;
uniform float uK1;
uniform float uK2;
uniform float uTime;
varying vec2 vUv;
varying vec2 vInkUv;
varying vec3 vN;
varying vec3 vW;
varying float vClip;
void main(){
  if (vClip < 0.004) discard;
  vec3 tex = texture2D(uMap, vUv).rgb;
  float lum = dot(tex, vec3(0.2126, 0.7152, 0.0722));

  // the globe (as Globe draws it, fully powered)
  float lights = smoothstep(0.02, 0.22, lum) * smoothstep(-0.005, 0.03, tex.r - tex.b);
  vec3 N = normalize(vN);
  if (!gl_FrontFacing) N = -N;
  vec3 V = normalize(cameraPosition - vW);
  float facing = max(dot(N, V), 0.0);
  float moon = 0.22 + 0.78 * smoothstep(-0.25, 0.95, dot(N, normalize(uMoon)));
  vec3 globe = tex * (1.0 - lights) * 1.8 * moon + tex * lights * 2.66;
  globe += uAtmo * pow(1.0 - facing, 2.6) * (0.12 + 0.88 * moon) * 0.75;

  // the print (as the board's map draws it before the lamp comes on)
  float l2 = dot(tex, vec3(0.299, 0.587, 0.114));
  vec3 base = mix(tex, vec3(l2) * vec3(0.55, 0.7, 1.0), 0.55);
  vec3 print = (vec3(0.01, 0.013, 0.024) + base * 0.3) * 0.45;
  float ink = texture2D(uInk, vInkUv).a * uK2;
  print = mix(print, vec3(0.58, 0.64, 0.75) * 0.28, ink * 0.78);
  float flicker = 0.92 + 0.08 * sin(uTime * 3.0 + vUv.x * 900.0 + vUv.y * 700.0);
  print += tex * vec3(1.1, 0.95, 0.8) * smoothstep(0.06, 0.55, l2) * 2.4 * flicker;

  // the back of the sheet, while it swings round, is plain dark paper
  vec3 back = vec3(0.02, 0.022, 0.03);
  vec3 col = mix(globe, print, smoothstep(0.0, 1.0, uK1));
  if (!gl_FrontFacing) col = mix(col, back, uK1);
  gl_FragColor = vec4(col * vClip, 1.0);
}`;
