/**
 * Gradient (Perlin-style) noise with a sin-free hash. Clouds need it: with their hard edges,
 * value noise's contours run straight along its lattice and the clouds come out faceted.
 * gnoise returns roughly -1 … 1.
 */
export const gradientNoiseGlsl = /* glsl */ `
vec3 ghash(vec3 p){
  p = fract(p * vec3(0.1031, 0.1030, 0.0973));
  p += dot(p, p.yxz + 33.33);
  return -1.0 + 2.0 * fract((p.xxy + p.yxx) * p.zyx);
}
float gnoise(vec3 p){
  vec3 i = floor(p);
  vec3 f = fract(p);
  vec3 u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  return 1.6 * mix(
    mix(mix(dot(ghash(i), f), dot(ghash(i + vec3(1, 0, 0)), f - vec3(1, 0, 0)), u.x),
        mix(dot(ghash(i + vec3(0, 1, 0)), f - vec3(0, 1, 0)), dot(ghash(i + vec3(1, 1, 0)), f - vec3(1, 1, 0)), u.x), u.y),
    mix(mix(dot(ghash(i + vec3(0, 0, 1)), f - vec3(0, 0, 1)), dot(ghash(i + vec3(1, 0, 1)), f - vec3(1, 0, 1)), u.x),
        mix(dot(ghash(i + vec3(0, 1, 1)), f - vec3(0, 1, 1)), dot(ghash(i + vec3(1, 1, 1)), f - vec3(1, 1, 1)), u.x), u.y),
    u.z);
}
// turning the domain between octaves keeps any one lattice from showing through
const mat3 TURN = mat3(0.00, 0.80, 0.60, -0.80, 0.36, -0.48, -0.60, -0.48, 0.64);
`;

/**
 * Clouds for the zoom-out from the valley to the globe (see ascent.ts). A full-screen pass:
 * each pixel's view ray is traced against the valley's cloud decks (only the ones the camera
 * has climbed above), and a veil of
 * cloud fills the view around the hand-over to the globe, then parts from the middle outward
 * as the planet falls away.
 */
export const ascentVert = /* glsl */ `
uniform mat4 uInvProj;
uniform mat4 uCamWorld;
varying vec3 vRay;
varying vec2 vNdc;
void main(){
  vec2 ndc = position.xy * 2.0;
  vNdc = ndc;
  vec4 v = uInvProj * vec4(ndc, 1.0, 1.0);
  vRay = mat3(uCamWorld) * (v.xyz / v.w);
  gl_Position = vec4(ndc, 0.0, 1.0);
}`;

export const ascentFrag = /* glsl */ `
uniform vec3 uCam;        // camera position (world)
uniform vec4 uDecks;      // cloud deck heights (world y), bottom → top
uniform float uDecksOn;
uniform float uVeil;      // 0 … 1: cloud filling the view
uniform float uOpen;      // 0 … 1: the veil parting
uniform float uZoom;      // the veil's billows shrink as the camera pulls away
uniform float uAspect;
uniform float uTime;
uniform vec3 uLit;        // moonlit cloud tops
uniform vec3 uShade;      // their shadowed sides
uniform vec3 uGlow;       // the crystal (world): its light shows through the lowest decks
uniform vec3 uTint;
varying vec3 vRay;
varying vec2 vNdc;
${gradientNoiseGlsl}
float fbm4(vec3 p){
  float s = 0.0, a = 0.5;
  for (int i = 0; i < 4; i++){ s += a * gnoise(p); p = TURN * p * 2.03 + 1.7; a *= 0.5; }
  return s;
}

/**
 * Cumulus-like density at p (z = seed / slow evolution): a warped fbm for the billows, eroded
 * by fine noise along its edges so they fray into wisps instead of ending in a soft blur.
 */
float cloud(vec3 p, float cover, out float body){
  vec2 w = vec2(gnoise(TURN * p * 0.45 + 3.1), gnoise(TURN * p * 0.45 + 8.7));
  vec3 q = TURN * (p + vec3(w * 0.9, 0.0));
  body = fbm4(q) * 0.5 + 0.5;
  float d = body - cover;
  // erosion: strongest where the cloud is thin
  d -= (gnoise(TURN * TURN * q * 5.3 + 1.9) * 0.5 + 0.5) * 0.1 * (1.0 - smoothstep(0.0, 0.18, d));
  return smoothstep(0.0, 0.2, d);
}

/** A cloud's colour: moonlit where it swells tall, dark and blue in its thin frayed edges. */
vec3 shadeCloud(float dens, float body){
  float swell = smoothstep(0.3, 0.85, body);
  return mix(uShade, uLit, 0.15 + 0.85 * swell * (0.45 + 0.55 * dens));
}

const float SCALE[4] = float[4](5.5, 7.0, 8.5, 10.0);  // world units per billow
const float COVER[4] = float[4](0.55, 0.5, 0.45, 0.4); // higher decks are thicker
const float MIST[4] = float[4](0.35, 0.5, 0.65, 0.85);  // how dense each is to fly through

void main(){
  vec3 rd = normalize(vRay);
  vec4 acc = vec4(0.0);
  float mist = 0.0;
  if (uDecksOn > 0.0) {
    // nearest deck first (the highest one below the camera), compositing front to back
    for (int i = 3; i >= 0; i--) {
      float above = uCam.y - uDecks[i];
      // passing through a deck: the view fills with its mist
      // (squared by hand: pow() of a negative is undefined, and one NaN blooms into blocks)
      float m = above / 3.5;
      mist = max(mist, exp(-m * m) * MIST[i]);
      if (above <= 0.0 || rd.y > -0.02 || acc.a > 0.97 || uVeil > 0.995) continue;
      float fi = float(i);
      vec3 P = uCam + rd * (above / -rd.y);
      vec2 xz = P.xz / SCALE[i] + vec2(fi * 17.3, -fi * 9.1) + vec2(0.02, 0.008) * uTime;
      float body;
      float dens = cloud(vec3(xz, fi * 3.7 + uTime * 0.012), COVER[i], body);
      vec3 c = shadeCloud(dens, body);
      float gd = length(P.xz - uGlow.xz);
      c += uTint * 0.07 * exp(-gd * gd / 30.0);
      // a deck just climbed out of is still thin (the mist covers that moment)
      float a = dens * smoothstep(0.0, 4.0, above) * 0.92;
      acc.rgb += (1.0 - acc.a) * c * a;
      acc.a += (1.0 - acc.a) * a;
    }
  }

  // the veil: two layers of billows in screen space. They spread outward at different rates
  // (the nearer faster) as the view pulls away, so flying up through it has depth
  vec2 s = vNdc * vec2(uAspect, 1.0);
  float veil = max(mist, uVeil);
  vec4 vAcc = vec4(0.0);
  if (veil > 0.002) {
    for (int k = 0; k < 2; k++) {
      float fk = float(k);
      float z = uZoom * (0.6 + 0.9 * fk);
      vec2 vs = s * 2.4 * z + vec2(fk * 5.1, uTime * 0.01 - fk * 3.3);
      float body;
      float dens = cloud(vec3(vs, fk * 7.1 + uTime * 0.02), 0.32 - 0.06 * fk, body);
      vec3 c = shadeCloud(dens, body);
      // over the globe it parts in the middle first, the gaps spreading outward (far layer first)
      float edge = uOpen * (1.5 + 0.35 * fk) - 0.1;
      float a = smoothstep(edge, edge + 0.3, body + 0.22 * length(s)) * mix(1.0, dens, 0.55);
      // under the veil, it is a fog: always at least a thin haze while it is closed
      a = max(a, (1.0 - uOpen) * 0.6);
      vAcc.rgb += (1.0 - vAcc.a) * c * a;
      vAcc.a += (1.0 - vAcc.a) * a;
    }
    vAcc *= veil;
  }

  vec3 col = vAcc.rgb + acc.rgb * (1.0 - vAcc.a);
  float alpha = vAcc.a + acc.a * (1.0 - vAcc.a);
  // a touch of dither: the dark gradients would band otherwise
  col += (fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453) - 0.5) / 255.0 * alpha;
  gl_FragColor = vec4(col, alpha);
}`;
