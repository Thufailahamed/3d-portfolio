/**
 * Night-side Earth from NASA's Black Marble (2016) composite.
 *
 * uBody   — the planet's opacity (it forms inside the strands)
 * uPower  — the power wave: angle from the south pole (0 … 1 = north pole) it has reached;
 *           city lights switch on behind it
 * vPolar  — this point's angle from the south pole, 0 … 1 (the strands feed in at the south pole)
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
void main(){
  vec3 tex = texture2D(uMap, vUv).rgb;   // sRGB texture → linear here
  float lum = dot(tex, vec3(0.2126, 0.7152, 0.0722));
  // city lights are bright and warm; moonlit land and ice are dim and cool
  float lights = smoothstep(0.02, 0.22, lum) * smoothstep(-0.005, 0.03, tex.r - tex.b);

  vec3 N = normalize(vN);
  vec3 V = normalize(cameraPosition - vW);
  float facing = max(dot(N, V), 0.0);
  float moon = 0.22 + 0.78 * smoothstep(-0.25, 0.95, dot(N, normalize(uMoon)));

  // the surface: moonlit land, ice and ocean, shaded so the planet reads as a sphere
  vec3 col = tex * (1.0 - lights) * 1.8 * moon;
  // the cities switch on behind the power wave
  float on = smoothstep(uPower, uPower - 0.06, vPolar);
  col += tex * lights * (0.06 + 2.6 * on);
  // the wave front itself: a thin travelling band of light
  float front = exp(-pow((vPolar - uPower) / 0.022, 2.0)) * step(0.001, uPower) * (1.0 - smoothstep(1.0, 1.15, uPower));
  col += uWave * front * 0.55;
  // a faint moon sheen on the oceans, so the dark side still has a surface
  vec3 L = normalize(uMoon);
  float ocean = 1.0 - smoothstep(0.004, 0.03, lum);
  float sheen = pow(max(dot(reflect(-L, N), V), 0.0), 18.0);
  col += uAtmo * sheen * ocean * 0.18;
  // atmosphere hugging the limb, brightest on the moonlit side
  float rim = pow(1.0 - facing, 2.6);
  col += uAtmo * rim * (0.12 + 0.88 * moon) * 0.75;

  // premultiplied: the planet fades in as a whole
  gl_FragColor = vec4(col * uBody, uBody);
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
  float band = exp(-pow((vPolar - uPower + 0.03) / 0.07, 2.0)) * step(0.001, uPower);
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
