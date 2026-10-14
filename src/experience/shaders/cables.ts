/**
 * Glowing strands for the About sequence.
 *
 * Each strand vertex has two lives:
 *   - `position`: the screen-locked wave (camera space), rewritten on the CPU every frame
 *   - `aWorld`: its stem → bud → globe position. Stem vertices hold an about-group position;
 *     globe vertices hold a direction on the globe (globe space). One attribute serves both.
 * Attributes are packed (WebGL caps how many a shader may use):
 *   aInfo = (onGlobe, side, s, seed)   aStyle = (core, weight)   aLive = (k, bloom, head)
 * k blends wave → stem/globe per strand; bloom grows the bud into the full globe.
 */
export const strandVert = /* glsl */ `
uniform float uPx;          // world units per pixel at depth 1
uniform mat4 uAbout;        // about group world matrix
uniform mat4 uGlobe;        // spinning globe world matrix
uniform float uR;           // globe radius
uniform float uBud;         // bud radius
uniform float uReveal;      // planet surface opacity
uniform float uDim;         // strands step back once the planet is in
attribute vec3 aTangent;
attribute vec3 aWorld;
attribute vec3 aWorldTan;
attribute vec4 aInfo;
attribute vec2 aStyle;
attribute vec3 aLive;
varying float vS;
varying float vSide;
varying float vSeed;
varying float vCore;
varying float vWeight;
varying float vHead;
varying float vK;
varying float vOcc;
varying float vPxW;

void main(){
  float aOnGlobe = aInfo.x;
  float aSide = aInfo.y;
  float aS = aInfo.z;
  float aSeed = aInfo.w;
  float aK = aLive.x;
  float aBloom = aLive.y;
  // where the strand is in its stem / globe life (world space)
  float r = mix(uBud, uR, aBloom) * (1.0 + aSeed * 0.03);
  vec3 local = vec3(0.0, -uR + r, 0.0) + r * aWorld;  // a sphere growing up from the south pole
  vec4 gw = aOnGlobe > 0.5 ? uGlobe * vec4(local, 1.0) : uAbout * vec4(aWorld, 1.0);
  vec3 gt = ((aOnGlobe > 0.5 ? uGlobe : uAbout) * vec4(aWorldTan, 0.0)).xyz;
  vec3 g = (viewMatrix * gw).xyz;
  gt = (viewMatrix * vec4(gt, 0.0)).xyz;

  // the strand flows into the stem head-first, its tail following
  float kk = clamp(aK * 1.5 - (1.0 - aS) * 0.5, 0.0, 1.0);
  kk = kk * kk * (3.0 - 2.0 * kk);
  vec3 p = mix(position, g, kk);
  vec3 T = normalize(mix(normalize(aTangent), normalize(gt), kk));
  vec3 V = normalize(-p);
  vec3 side = normalize(cross(T, V));

  // the quad is wide enough for the soft halo; the bright core is drawn inside it
  float W = 18.0;
  p += side * aSide * 0.5 * W * uPx * (-p.z);
  vPxW = W;

  // far-side strands sink behind the planet once it is in
  vec3 c = (uGlobe * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
  float front = smoothstep(-0.25, 0.12, dot(normalize(gw.xyz - c), normalize(cameraPosition - c)));
  vOcc = mix(1.0, front, aOnGlobe * kk * uReveal) * (1.0 - 0.55 * uDim * aOnGlobe);

  vS = aS;
  vSide = aSide;
  vSeed = aSeed;
  vCore = aStyle.x;
  vWeight = aStyle.y * mix(1.0, 0.5, aK);   // strands pile up in the stem
  vHead = aLive.z;
  vK = kk;
  gl_Position = projectionMatrix * vec4(p, 1.0);
}`;

export const strandFrag = /* glsl */ `
uniform float uTime;
uniform float uGrey;        // 1 at the start: strands enter grey-white
uniform vec2 uGrad;         // violet → white gradient edges along the strand
uniform float uMint;        // the white end turns mint
uniform float uPulse;       // light front running along the strands (0 = stem base … 1 = end)
uniform float uFade;        // the strands fade away once the globe is powered
varying float vS;
varying float vSide;
varying float vSeed;
varying float vCore;
varying float vWeight;
varying float vHead;
varying float vK;
varying float vOcc;
varying float vPxW;

const vec3 VIOLET = vec3(0.258, 0.047, 1.0);      // #8B3DFF (linear)
const vec3 MAGENTA = vec3(0.527, 0.069, 0.896);   // #C04BFF
const vec3 LAVENDER = vec3(0.585, 0.474, 1.0);    // #C9B6FF
const vec3 WHITE = vec3(0.89, 0.86, 1.0);
const vec3 MINT = vec3(0.737, 0.913, 0.855);      // #DFF5EE
const vec3 MINT_GLOW = vec3(0.347, 0.745, 0.604); // #9FE0CC

void main(){
  if (vS > vHead) discard;
  // soft fading head, and frayed far ends while the strand is still a wave
  float head = smoothstep(vHead, vHead - 0.06, vS);
  float fray = mix(smoothstep(1.0, 0.82, vS), 1.0, vK);

  // thin bright core + a wide soft halo
  float x = abs(vSide) * vPxW * 0.5;              // pixels from the centre line
  float coreW = 0.8 + vCore * 0.9;
  float core = exp(-x * x / (coreW * coreW));
  float halo = exp(-x * x / 30.0) * 0.16;

  // colour: violet/magenta → lavender → white along the strand; the white end turns mint late
  vec3 violet = mix(VIOLET, MAGENTA, vCore * 0.8);
  float g = smoothstep(uGrad.x, uGrad.y, vS);
  vec3 warm = mix(violet, LAVENDER, smoothstep(0.0, 0.5, g));
  vec3 col = mix(warm, mix(WHITE, MINT, uMint), smoothstep(0.4, 1.0, g));
  col = mix(col, vec3(0.62, 0.63, 0.7), uGrey);
  vec3 glow = mix(col, MINT_GLOW, uMint * smoothstep(0.4, 1.0, g));

  float shimmer = 0.85 + 0.15 * sin(vS * 40.0 - uTime * 2.0 + vSeed * 20.0);
  vec3 c = col * core * 0.9 + glow * halo;

  // the power pulse: a bright bead with the strand left energised behind it
  float live = step(0.001, uPulse) * (1.0 - smoothstep(1.05, 1.15, uPulse));
  float bead = exp(-pow((vS - uPulse) * 26.0, 2.0)) * live;
  float behind = smoothstep(uPulse, uPulse - 0.08, vS) * step(0.001, uPulse);
  c += vec3(1.0, 0.98, 0.94) * bead * (core * 1.4 + halo * 2.0);
  c += col * behind * core * 0.5;

  gl_FragColor = vec4(c * vWeight * head * fray * shimmer * vOcc * (1.0 - uFade), 1.0);
}`;

/** Sparkles drifting off the stem, and the faint starfield. World space, additive. */
export const sparkVert = /* glsl */ `
uniform float uTime;
uniform float uPixelRatio;
uniform float uSize;
attribute float aSeed;
varying float vAlpha;
void main(){
  vec3 p = position;
  p.y += sin(uTime * 0.2 + aSeed * 30.0) * 0.04;
  p.x += cos(uTime * 0.17 + aSeed * 17.0) * 0.04;
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  vAlpha = 0.45 + 0.55 * sin(uTime * (0.6 + aSeed * 1.8) + aSeed * 50.0);
  gl_PointSize = uSize * (0.6 + aSeed) * uPixelRatio;
  gl_Position = projectionMatrix * mv;
}`;

export const sparkFrag = /* glsl */ `
uniform vec3 uColor;
uniform float uOpacity;
varying float vAlpha;
void main(){
  float d = length(gl_PointCoord - 0.5);
  gl_FragColor = vec4(uColor * smoothstep(0.5, 0.0, d) * vAlpha * uOpacity, 1.0);
}`;
