/** GLSL ES 3.0. The compute passes run one fragment per particle; texel (x, y) is particle y·W + x. */

/** training points live in a 128-wide float texture, class-major */
export const DATA_W = 128;

export const quadVert = /* glsl */ `
void main() {
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

/** E[x0 | x_t] for every class, the class posterior, and the guided prediction — see denoiser.ts */
export const denoiseFrag = /* glsl */ `
precision highp float;
precision highp int;
uniform sampler2D uX;
uniform sampler2D uData;
uniform int uN;
uniform int uK;
uniform int uCls;
uniform float uA;
uniform float uInv2S2;
uniform float uG;
uniform float uW;
layout(location = 0) out vec4 oX0;
layout(location = 1) out vec4 oPost;

void main() {
  vec3 x = texelFetch(uX, ivec2(gl_FragCoord.xy), 0).xyz;
  vec4 mc = vec4(-1e30);
  vec4 sc = vec4(0.0);
  vec3 ac[4];
  for (int c = 0; c < 4; c++) {
    ac[c] = vec3(0.0);
    if (c >= uK) continue;
    float m = -1e30;
    float s = 0.0;
    vec3 acc = vec3(0.0);
    int base = c * uN;
    for (int j = 0; j < uN; j++) {
      int i = base + j;
      vec3 y = texelFetch(uData, ivec2(i & ${DATA_W - 1}, i >> ${Math.log2(DATA_W)}), 0).xyz;
      vec3 d = x - uA * y;
      float l = -dot(d, d) * uInv2S2;
      // online log-sum-exp: one exp per point, never underflows
      if (l > m) {
        float r = exp(m - l);
        s = s * r + 1.0;
        acc = acc * r + y;
        m = l;
      } else {
        float e = exp(l - m);
        s += e;
        acc += e * y;
      }
    }
    mc[c] = m;
    sc[c] = s;
    ac[c] = acc;
  }
  float M = max(max(mc.x, mc.y), max(mc.z, mc.w));
  vec4 sh = exp(mc - M);
  vec4 z = sc * sh;
  float Z = z.x + z.y + z.z + z.w;
  vec3 yu = (ac[0] * sh.x + ac[1] * sh.y + ac[2] * sh.z + ac[3] * sh.w) / Z;
  float k = 1.0 - uG * uA;
  vec3 x0 = k * yu + uG * x;
  if (uCls >= 0) {
    vec3 x0c = k * (ac[uCls] / sc[uCls]) + uG * x;
    x0 += uW * (x0c - x0);
  }
  oX0 = vec4(x0, 1.0);
  oPost = z / Z;
}
`;

/** x_s = cX·x_t + cA·x̂0 + cB·x̂0_prev + cZ·z — every sampler in schedule.ts reduces to this */
export const updateFrag = /* glsl */ `
precision highp float;
precision highp int;
uniform sampler2D uX;
uniform sampler2D uX0;
uniform sampler2D uX0Prev;
uniform float uCX;
uniform float uCA;
uniform float uCB;
uniform float uCZ;
uniform uint uSeed;
uniform uint uStep;
layout(location = 0) out vec4 oX;

// Jarzynski & Olano 2020
uvec4 pcg4d(uvec4 v) {
  v = v * 1664525u + 1013904223u;
  v.x += v.y * v.w; v.y += v.z * v.x; v.z += v.x * v.y; v.w += v.y * v.z;
  v ^= v >> 16u;
  v.x += v.y * v.w; v.y += v.z * v.x; v.z += v.x * v.y; v.w += v.y * v.z;
  return v;
}

void main() {
  ivec2 p = ivec2(gl_FragCoord.xy);
  vec3 x = texelFetch(uX, p, 0).xyz;
  vec3 x0 = texelFetch(uX0, p, 0).xyz;
  vec3 next = uCX * x + uCA * x0;
  if (uCB != 0.0) next += uCB * texelFetch(uX0Prev, p, 0).xyz;
  if (uCZ != 0.0) {
    uint idx = uint(p.y * textureSize(uX, 0).x + p.x);
    vec4 u = vec4(pcg4d(uvec4(idx, uStep, uSeed, 0x9e3779b9u)) >> 8u) / 16777216.0;
    // Box–Muller: four uniforms, three independent normals
    float r1 = sqrt(-2.0 * log(1.0 - u.x));
    float r2 = sqrt(-2.0 * log(1.0 - u.z));
    vec3 z = vec3(r1 * cos(6.28318531 * u.y), r1 * sin(6.28318531 * u.y), r2 * cos(6.28318531 * u.w));
    next += uCZ * z;
  }
  oX = vec4(next, 1.0);
}
`;

/* ——— display ——— */

const particleCommon = /* glsl */ `
precision highp float;
precision highp int;
in vec2 aCell;
uniform sampler2D uPosA;
uniform sampler2D uPosB;
uniform sampler2D uX0A;
uniform sampler2D uX0B;
uniform sampler2D uPostA;
uniform sampler2D uPostB;
uniform float uMix;
uniform vec3 uColors[4];
uniform float uSize;
uniform float uScale;
uniform float uFloor;
out vec3 vColor;
out float vAlpha;

vec3 beliefColor(vec4 post) {
  vec3 c = post.x * uColors[0] + post.y * uColors[1] + post.z * uColors[2] + post.w * uColors[3];
  // certainty: 0 at the uniform prior, 1 when one class has all the mass
  float top = max(max(post.x, post.y), max(post.z, post.w));
  float sure = clamp((top - 0.25) / 0.75, 0.0, 1.0);
  return mix(vec3(0.62, 0.66, 0.72), c, pow(sure, 0.6));
}
`;

/** the samples themselves, drawn as lit beads */
export const particleVert = /* glsl */ `
${particleCommon}
out float vLight;
void main() {
  ivec2 c = ivec2(aCell);
  vec3 p = mix(texelFetch(uPosA, c, 0).xyz, texelFetch(uPosB, c, 0).xyz, uMix);
  vec4 post = mix(texelFetch(uPostA, c, 0), texelFetch(uPostB, c, 0), uMix);
  vColor = beliefColor(post);
  vAlpha = 1.0;
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = max(1.5, uSize * uScale / -mv.z);
  // particles below the floor sit in its shade
  vLight = smoothstep(uFloor - 0.6, uFloor + 0.4, p.y);
}
`;

export const particleFrag = /* glsl */ `
precision highp float;
in vec3 vColor;
in float vAlpha;
in float vLight;
layout(location = 0) out vec4 oColor;
void main() {
  vec2 q = gl_PointCoord * 2.0 - 1.0;
  q.y = -q.y;
  float r2 = dot(q, q);
  if (r2 > 1.0) discard;
  vec3 n = vec3(q, sqrt(1.0 - r2));
  vec3 L = normalize(vec3(-0.45, 0.7, 0.55));
  float diff = max(dot(n, L), 0.0);
  float spec = pow(max(dot(reflect(-L, n), vec3(0.0, 0.0, 1.0)), 0.0), 28.0);
  float rim = pow(1.0 - n.z, 2.5);
  vec3 col = vColor * (0.16 + 0.9 * diff) + vec3(spec) * 0.9 + vColor * rim * 0.45;
  oColor = vec4(col * mix(0.35, 1.0, vLight), 1.0);
}
`;

/** the model's current guess of the clean sample, x̂0: a faint glow that leads the beads */
export const ghostVert = /* glsl */ `
${particleCommon}
void main() {
  ivec2 c = ivec2(aCell);
  vec3 p = mix(texelFetch(uX0A, c, 0).xyz, texelFetch(uX0B, c, 0).xyz, uMix);
  vec4 post = mix(texelFetch(uPostA, c, 0), texelFetch(uPostB, c, 0), uMix);
  vColor = beliefColor(post);
  vAlpha = 0.8;
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = max(1.5, uSize * 2.4 * uScale / -mv.z);
}
`;

export const ghostFrag = /* glsl */ `
precision highp float;
in vec3 vColor;
in float vAlpha;
layout(location = 0) out vec4 oColor;
void main() {
  vec2 q = gl_PointCoord * 2.0 - 1.0;
  float a = exp(-dot(q, q) * 3.5) * vAlpha;
  oColor = vec4((vColor * 0.75 + 0.25) * a * 0.7, a);
}
`;

/** each bead's shadow on the floor, wider and fainter the higher it floats */
export const shadowVert = /* glsl */ `
${particleCommon}
void main() {
  ivec2 c = ivec2(aCell);
  vec3 p = mix(texelFetch(uPosA, c, 0).xyz, texelFetch(uPosB, c, 0).xyz, uMix);
  float h = p.y - uFloor;
  vColor = vec3(0.0);
  vAlpha = h > 0.0 ? 0.2 / (1.0 + 0.9 * h) : 0.0;
  vec4 mv = modelViewMatrix * vec4(p.x, uFloor + 0.002, p.z, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = h > 0.0 ? uSize * (2.2 + 1.1 * h) * uScale / -mv.z : 0.0;
}
`;

export const shadowFrag = /* glsl */ `
precision highp float;
in vec3 vColor;
in float vAlpha;
layout(location = 0) out vec4 oColor;
void main() {
  vec2 q = gl_PointCoord * 2.0 - 1.0;
  float a = exp(-dot(q, q) * 2.5) * vAlpha;
  oColor = vec4(0.0, 0.0, 0.0, a);
}
`;

/** the score ∇log p_t on a horizontal slice, as arrows: tail, tip, and two barbs */
export const fieldVert = /* glsl */ `
precision highp float;
precision highp int;
in vec2 aCell;
in float aKind;
uniform sampler2D uGrid;
uniform sampler2D uGridX0;
uniform float uA;
uniform float uS2;
uniform float uCell;
out vec3 vColor;
out float vAlpha;
void main() {
  ivec2 c = ivec2(aCell);
  vec3 x = texelFetch(uGrid, c, 0).xyz;
  vec3 x0 = texelFetch(uGridX0, c, 0).xyz;
  // s²·∇log p_t(x) = √ᾱ·E[x0|x] − x: points at where the noisy data is densest
  vec3 v = uA * x0 - x;
  float mag = length(v);
  vec3 dir = mag > 1e-6 ? v / mag : vec3(1.0, 0.0, 0.0);
  float L = uCell * 0.92 * (1.0 - exp(-mag / (uCell * 0.7)));
  vec3 tip = x + dir * L;
  vec3 side = normalize(cross(dir, abs(dir.y) > 0.95 ? vec3(1.0, 0.0, 0.0) : vec3(0.0, 1.0, 0.0)));
  vec3 back = tip - dir * L * 0.32;
  vec3 p = aKind < 0.5 ? x : aKind < 1.5 ? tip : back + side * L * (aKind < 2.5 ? 0.16 : -0.16);
  // colour by |score| on a log scale
  float s = log(1.0 + mag / uS2) / log(1.0 + 30.0);
  vColor = mix(vec3(0.25, 0.55, 1.0), vec3(1.0, 0.85, 0.45), clamp(s, 0.0, 1.0));
  vAlpha = (aKind < 0.5 ? 0.25 : 0.85) * smoothstep(0.0, uCell * 0.15, L);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
}
`;

export const fieldFrag = /* glsl */ `
precision highp float;
in vec3 vColor;
in float vAlpha;
layout(location = 0) out vec4 oColor;
void main() {
  oColor = vec4(vColor, vAlpha);
}
`;
