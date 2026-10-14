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
  // thin atmosphere hugging the limb
  col += uAtmo * pow(1.0 - facing, 3.0) * (0.25 + 0.5 * moon) * 0.5;

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
  float glow = pow(clamp(0.7 + d, 0.0, 1.0), 5.0);
  gl_FragColor = vec4(uAtmo * glow * 0.45 * uBody, 1.0);
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
varying float vFront;
varying float vPhase;
void main(){
  vec4 w = modelMatrix * vec4(position, 1.0);
  vec3 c = (modelMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
  vFront = smoothstep(0.05, 0.3, dot(normalize(w.xyz - c), normalize(cameraPosition - w.xyz)));
  vPhase = fract(uTime * 0.45 + aSeed);
  gl_PointSize = 34.0 * uPixelRatio;
  gl_Position = projectionMatrix * viewMatrix * w;
}`;

export const markerFrag = /* glsl */ `
uniform vec3 uColor;
uniform float uOn;
varying float vFront;
varying float vPhase;
void main(){
  float d = length(gl_PointCoord - 0.5) * 2.0;     // 0 centre … 1 edge
  float dot_ = smoothstep(0.16, 0.08, d);
  float ring = smoothstep(0.05, 0.0, abs(d - vPhase)) * (1.0 - vPhase);
  float a = (dot_ + ring * 0.6) * vFront * uOn;
  gl_FragColor = vec4(uColor * a, 1.0);
}`;
