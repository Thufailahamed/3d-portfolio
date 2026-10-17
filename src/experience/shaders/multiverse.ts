/**
 * The multiverse fall (contact arch → click the doorway).
 *
 * Pass 1 (`universeFrag`) draws one universe per pixel: the current one (uA) outside a burning
 * sling-ring portal and the next one (uB) inside it, the ring expanding over the screen as we
 * fall through. It also opens the way in (a hole at the doorway, uEntry) and the way out
 * (a hole back to the clearing, uExit). Pass 2 (`postFrag`) adds the fall itself: a radial
 * zoom blur, chromatic aberration, bloom from the mips, grain and tone mapping.
 *
 * Universes: 0 the arch's light tunnel · 1 the mirror city · 2 oil paint · 3 an Apollonian
 * fractal · 4 a cartoon · 5 shattered glass · 6 a living cave · 7 deep space
 */
export const fullscreenVert = /* glsl */ `
varying vec2 vUv;
void main(){
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}`;

export const universeFrag = /* glsl */ `
precision highp float;
varying vec2 vUv;
uniform vec2 uRes;
uniform float uA;       // universe outside the ring
uniform float uB;       // universe inside it
uniform float uTA;      // their local clocks (s)
uniform float uTB;
uniform float uRing;    // 0 → 1 as the ring opens over the screen
uniform float uEntry;   // 0 → 1 the way in opens at the doorway
uniform float uExit;    // 0 → 1 the way out opens back to the clearing
uniform vec2 uDoor;     // the doorway on screen (same units as p)
uniform float uTime;
uniform float uSteps;   // raymarch budget, 0.5 … 1

#define PI 3.14159265
// a zero the compiler can't see through: keeps loops (and the maps inside them) from being unrolled and inlined
#define ZERO int(min(uTime, 0.0))
#define TAU 6.28318531

mat2 rot(float a){ float c = cos(a), s = sin(a); return mat2(c, -s, s, c); }
float hash11(float p){ p = fract(p * 0.1031); p *= p + 33.33; p *= p + p; return fract(p); }
float hash12(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
vec2 hash22(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973)); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.xx + p3.yz) * p3.zy); }
float noise(vec2 p){
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash12(i), hash12(i + vec2(1, 0)), u.x), mix(hash12(i + vec2(0, 1)), hash12(i + vec2(1, 1)), u.x), u.y);
}
float fbm(vec2 p){
  float s = 0.0, a = 0.5;
  mat2 m = mat2(1.6, 1.2, -1.2, 1.6);
  for (int i = ZERO; i < 5; i++){ s += a * noise(p); p = m * p; a *= 0.5; }
  return s;
}
#define NORMAL(MAP, pos, eps, out_) { vec3 n_ = vec3(0.0); for (int i_ = ZERO; i_ < 4; i_++){ vec3 e_ = 0.5773 * (2.0 * vec3(float(((i_ + 3) >> 1) & 1), float((i_ >> 1) & 1), float(i_ & 1)) - 1.0); n_ += e_ * MAP(pos + e_ * (eps)); } out_ = normalize(n_); }
float sdBox(vec3 p, vec3 b){ vec3 q = abs(p) - b; return length(max(q, 0.0)) + min(max(q.x, max(q.y, q.z)), 0.0); }
vec3 pal(float t, vec3 a, vec3 b, vec3 c, vec3 d){ return a + b * cos(TAU * (c * t + d)); }
int steps(int n){ return int(float(n) * uSteps) + ZERO; }

// ------------------------------------------------------------------ 0 · the arch's light
vec3 warp(vec2 p, float t){
  float r = length(p), a = atan(p.y, p.x);
  float z = 0.42 / (r + 0.015) + t * 7.0;
  float n = fbm(vec2(abs(a) * 1.9, z * 0.35));
  float ribs = pow(0.5 + 0.5 * sin(z * 2.4), 24.0);
  // streaks of light along the walls, one per sliver of angle (hashed periodically: no seam)
  float ca = (a / TAU + 0.5) * 150.0;
  float cid = mod(floor(ca), 150.0);
  float streak = pow(noise(vec2(cid * 3.1, z * 0.12 - t)), 6.0) * smoothstep(0.5, 0.15, abs(fract(ca) - 0.5)) * step(0.55, hash11(cid)) * 3.0;
  vec3 col = vec3(0.01, 0.06, 0.32) * n * n * 1.6 + vec3(0.45, 0.7, 1.0) * streak * 0.7 + vec3(0.15, 0.4, 1.0) * ribs * 0.9;
  col *= smoothstep(0.0, 0.25, r);
  col += vec3(0.6, 0.8, 1.0) * 0.0025 / (r * r + 0.002);
  return col;
}

// ------------------------------------------------------------------ 1 · the mirror city
// a kaleidoscope of skyscrapers folding round the fall, like the mirror dimension
float gCityT;
vec3 cityFold(vec3 p){
  p.xy *= rot(p.z * 0.035 + gCityT * 0.22);
  float sector = TAU / 6.0;
  float a = atan(p.y, p.x), r = length(p.xy);
  a = abs(mod(a + sector * 0.5, sector) - sector * 0.5);
  return vec3(cos(a) * r, sin(a) * r, p.z);
}
vec4 cityCell(vec3 q){
  vec2 c = vec2(q.y, q.z);
  vec2 id = floor(c / 2.4);
  vec2 f = mod(c, 2.4) - 1.2;
  float h = hash12(id + 7.0);
  return vec4(f, 1.2 + h * h * 5.0, h);
}
float cityMap(vec3 p){
  vec3 q = cityFold(p);
  const float G = 8.0;
  vec4 c = cityCell(q);
  float d = sdBox(vec3(q.x - (G - c.z * 0.5), c.x, c.y), vec3(c.z * 0.5, 0.82 + 0.18 * c.w, 0.9));
  return min(d, G - q.x);
}
vec3 city(vec2 p, float t){
  gCityT = t;
  vec3 ro = vec3(0.0, 0.0, t * 16.0);
  vec3 rd = normalize(vec3(p, 1.25));
  rd.xy *= rot(t * 0.3);
  float d = 0.0; int n = steps(96);
  float hit = 0.0;
  for (int i = 0; i < n; i++){
    float h = cityMap(ro + rd * d);
    if (h < 0.002 * d){ hit = 1.0; break; }
    d += h * 0.75;
    if (d > 90.0) break;
  }
  vec3 fogc = mix(vec3(0.95, 0.55, 0.22), vec3(0.15, 0.55, 0.6), smoothstep(-0.4, 0.6, p.y + 0.3 * sin(t)));
  vec3 col = fogc * 0.12;
  if (hit > 0.5){
    vec3 pos = ro + rd * d;
    vec3 nor; NORMAL(cityMap, pos, 0.01, nor)
    vec3 q = cityFold(pos);
    vec4 c = cityCell(q);
    // windows on the facades: a lit grid, some rooms dark
    vec2 w = vec2(c.x * 3.2, (8.0 - q.x) * 3.0);
    vec2 wi = floor(w);
    vec2 wf = fract(w);
    float lit = step(0.45, hash12(wi + c.w * 91.0)) * step(0.18, wf.x) * step(wf.x, 0.82) * step(0.25, wf.y) * step(wf.y, 0.8);
    float facade = step(q.x, 7.98);
    vec3 glass = vec3(0.04, 0.06, 0.08);
    float fres = pow(1.0 - max(dot(nor, -rd), 0.0), 4.0);
    col = glass + fogc * fres * 0.35;
    col += facade * lit * mix(vec3(1.0, 0.55, 0.18), vec3(0.5, 0.8, 1.0), hash12(wi)) * 1.5;
    col += max(dot(nor, normalize(vec3(0.3, 0.8, -0.5))), 0.0) * vec3(0.25, 0.2, 0.15);
    col = mix(col, fogc * 0.22, 1.0 - exp(-d * 0.03));
  }
  // light at the end of the fold
  col += vec3(1.0, 0.75, 0.45) * 0.004 / (dot(p, p) + 0.006);
  return col;
}

// ------------------------------------------------------------------ 2 · oil paint
vec3 paint(vec2 p, float t){
  p *= rot(t * 0.25) * (1.6 - 0.45 * t);
  vec2 q = vec2(fbm(p + vec2(0.0, t * 0.3)), fbm(p + vec2(5.2, 1.3)));
  vec2 r = vec2(fbm(p + 3.5 * q + vec2(1.7, 9.2) + t * 0.2), fbm(p + 3.5 * q + vec2(8.3, 2.8)));
  float f = fbm(p + 3.5 * r);
  // brush strokes follow the flow
  vec2 dir = normalize(r - 0.5 + 1e-4);
  vec2 sp = mat2(dir.x, -dir.y, dir.y, dir.x) * p;
  float stroke = noise(sp * vec2(3.0, 38.0)) * 0.5 + noise(sp * vec2(6.0, 75.0)) * 0.2;
  float h = f * 1.6 + stroke * 0.18;
  vec3 col = mix(vec3(0.02, 0.1, 0.45), vec3(0.95, 0.75, 0.1), smoothstep(0.35, 0.75, f));
  col = mix(col, vec3(0.85, 0.08, 0.15), smoothstep(0.55, 0.95, length(q) * 0.9) * 0.85);
  col = mix(col, vec3(0.05, 0.55, 0.5), smoothstep(0.6, 1.0, r.y) * 0.7);
  col = mix(col, vec3(0.98, 0.95, 0.85), smoothstep(0.82, 0.95, f));
  // thick paint: lit from its own relief, wet highlights
  vec3 nor = normalize(vec3(-dFdx(h) * 60.0, -dFdy(h) * 60.0, 1.0));
  vec3 L = normalize(vec3(-0.5, 0.6, 0.7));
  float dif = 0.45 + 0.55 * max(dot(nor, L), 0.0);
  float spec = pow(max(dot(reflect(-L, nor), vec3(0, 0, 1)), 0.0), 40.0);
  return col * col * dif * 1.1 + spec * 0.55;
}

// ------------------------------------------------------------------ 3 · an Apollonian fractal
float gTrap;
float apo(vec3 p){
  float s = 1.0;
  gTrap = 1e9;
  for (int i = ZERO; i < 7; i++){
    p = -1.0 + 2.0 * fract(0.5 * p + 0.5);
    float r2 = dot(p, p);
    gTrap = min(gTrap, r2);
    float k = 1.2 / r2;
    p *= k;
    s *= k;
  }
  return 0.25 * abs(p.y) / s;
}
vec3 fractal(vec2 p, float t){
  float tt = 3.0 + t * 0.55;
  vec3 ro = vec3(2.8 * cos(0.1 + 0.33 * tt), 0.4 + 0.3 * cos(0.37 * tt), 2.8 * cos(0.5 + 0.35 * tt));
  vec3 ta = vec3(1.9 * cos(1.2 + 0.41 * tt), 0.4 + 0.1 * cos(0.27 * tt), 1.9 * cos(2.0 + 0.38 * tt));
  vec3 ww = normalize(ta - ro), uu = normalize(cross(ww, vec3(sin(t * 0.4), 1.0, 0.0))), vv = cross(uu, ww);
  vec3 rd = normalize(p.x * uu + p.y * vv + 1.6 * ww);
  float d = 0.01; int n = steps(110); float k = 0.0; float hit = 0.0;
  for (int i = 0; i < n; i++){
    float h = apo(ro + rd * d);
    k = float(i);
    if (h < 0.0004 * d){ hit = 1.0; break; }
    d += h;
    if (d > 12.0) break;
  }
  vec3 bg = vec3(0.02, 0.005, 0.04) + vec3(0.5, 0.2, 0.9) * 0.01 / (dot(p, p) + 0.05);
  if (hit < 0.5) return bg;
  vec3 pos = ro + rd * d;
  float trap = gTrap;
  vec3 nor; NORMAL(apo, pos, 0.0008 * d, nor)
  float ao = 1.0 - k / float(n);
  vec3 base = pal(trap * 0.9 + t * 0.15, vec3(0.5), vec3(0.5), vec3(1.0), vec3(0.0, 0.33, 0.67));
  vec3 L = normalize(vec3(0.6, 0.7, -0.4));
  float dif = max(dot(nor, L), 0.0);
  float fres = pow(1.0 + dot(nor, rd), 3.0);
  base *= base;
  vec3 col = base * (0.08 + dif * 1.1) * ao * ao + vec3(1.0, 0.8, 0.5) * fres * 0.35 * ao;
  col += base * smoothstep(0.25, 0.0, trap) * 1.2;
  return mix(col, bg, 1.0 - exp(-d * 0.35));
}

// ------------------------------------------------------------------ 4 · a cartoon
float toonMap(vec3 p, out float id){
  float fl = p.y + 1.2;
  vec2 c = floor(p.xz / 3.0);
  vec3 q = vec3(mod(p.x, 3.0) - 1.5, p.y, mod(p.z, 3.0) - 1.5);
  float h = hash12(c);
  q.y -= 0.5 * abs(sin(gCityT * 4.0 + h * 6.0)) - 0.4;
  float s = h < 0.6 ? length(q) - 0.55 - 0.2 * h : length(vec2(length(q.xz) - 0.5, q.y)) - 0.18;
  id = s < fl ? 1.0 + h : 0.0;
  return min(s, fl);
}
float toonD(vec3 p){ float id; return toonMap(p, id); }
vec3 cartoon(vec2 p, float t){
  gCityT = t;
  vec3 ro = vec3(0.6, 0.6 + 0.2 * sin(t * 3.0), t * 9.0);
  vec3 rd = normalize(vec3(p.x, p.y - 0.18, 1.2));
  rd.xy *= rot(sin(t * 1.5) * 0.12);
  float d = 0.0, id = 0.0, minEdge = 1e9, edgeAt = 0.0; int n = steps(80); float hit = 0.0;
  for (int i = 0; i < n; i++){
    float h = toonMap(ro + rd * d, id);
    if (h < minEdge && d > 0.5){ minEdge = h; edgeAt = d; }
    if (h < 0.002){ hit = 1.0; break; }
    d += h;
    if (d > 60.0) break;
  }
  vec3 sky = mix(vec3(0.12, 0.45, 0.95), vec3(0.85, 0.75, 0.5), smoothstep(0.4, -0.2, p.y));
  vec2 cl = p * 3.0 + vec2(t * 0.5, 0.0);
  sky = mix(sky, vec3(0.9), step(0.62, fbm(cl)) * step(0.0, p.y));
  vec3 col = sky;
  if (hit > 0.5){
    vec3 pos = ro + rd * d;
    vec3 nor; NORMAL(toonD, pos, 0.002, nor)
    vec3 L = normalize(vec3(0.5, 0.8, -0.3));
    float dif = dot(nor, L);
    float band = dif > 0.55 ? 1.0 : dif > 0.05 ? 0.62 : 0.32;
    vec3 base = id < 0.5
      ? mix(vec3(0.35, 0.8, 0.3), vec3(0.95, 0.9, 0.35), mod(floor(pos.x * 0.5) + floor(pos.z * 0.5), 2.0))
      : pal(id * 2.3, vec3(0.55), vec3(0.45), vec3(1.0), vec3(0.0, 0.33, 0.67));
    base *= base;
    col = base * band;
    // halftone in the shade, a hard specular dot
    vec2 ht = gl_FragCoord.xy / 4.0;
    float dots = step(length(fract(ht) - 0.5), 0.32 * (1.0 - band));
    col *= 1.0 - dots * 0.35;
    col += step(0.96, dot(reflect(-L, nor), -rd)) * 0.6;
    // ink outline on silhouettes
    if (dot(nor, -rd) < 0.28 && id > 0.5) col *= 0.05;
    col = mix(col, sky, smoothstep(25.0, 60.0, d));
  }
  if (minEdge < 0.012 * edgeAt && (hit < 0.5 || d > edgeAt + 0.4)) col = vec3(0.02);
  return col;
}

// ------------------------------------------------------------------ 5 · shattered glass
vec3 glimpse(vec2 uv, float k){
  float f = fbm(uv * 2.0 + k * 13.0);
  vec3 a = pal(k, vec3(0.5), vec3(0.5), vec3(1.0), vec3(0.1, 0.4, 0.7));
  vec3 b = pal(k + 0.5, vec3(0.5), vec3(0.5), vec3(1.0, 0.8, 0.6), vec3(0.3, 0.2, 0.2));
  vec3 c = mix(a, b, smoothstep(0.3, 0.7, f)) * (0.3 + f * 0.8);
  return c * c;
}
vec3 glass(vec2 p, float t){
  vec2 g = p * (2.8 - t * 0.9);
  vec2 ip = floor(g), fp = fract(g);
  float md = 8.0, md2 = 8.0; vec2 mid = vec2(0.0), mr = vec2(0.0);
  for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++){
    vec2 o = vec2(float(i), float(j));
    vec2 h = hash22(ip + o);
    vec2 r = o + h - fp;
    float dd = dot(r, r);
    if (dd < md){ md2 = md; md = dd; mid = ip + o; mr = r; }
    else if (dd < md2) md2 = dd;
  }
  float edge = sqrt(md2) - sqrt(md);
  float k = hash12(mid);
  // each shard tilts on its own and holds another world, split by dispersion
  vec2 tilt = (hash22(mid + 3.0) - 0.5) * 2.0;
  vec2 uv = p + tilt * 0.25 * (0.5 + t) + mid * 0.05;
  vec3 col = vec3(glimpse(uv + 0.012 * tilt, k).r, glimpse(uv, k).g, glimpse(uv - 0.012 * tilt, k).b);
  vec3 nor = normalize(vec3(tilt * 0.35 + mr * 0.15, 1.0));
  vec3 L = normalize(vec3(sin(t * 2.0), 0.6, 0.8));
  float spec = pow(max(dot(reflect(-L, nor), vec3(0, 0, 1)), 0.0), 60.0);
  col += spec * 1.6 + pow(1.0 - nor.z, 2.0) * 0.8;
  // the shards drift apart: the gaps open onto the dark between worlds
  float gap = 0.03 + t * 0.06;
  col *= smoothstep(gap, gap + 0.025, edge);
  col += vec3(0.85, 0.95, 1.0) * smoothstep(gap + 0.03, gap, edge) * smoothstep(gap - 0.02, gap, edge) * 0.9;
  return col;
}

// ------------------------------------------------------------------ 6 · a living cave
vec2 cavePath(float z){ return vec2(sin(z * 0.21) * 1.6, cos(z * 0.17) * 1.1); }
float caveMap(vec3 p){
  vec2 c = p.xy - cavePath(p.z);
  float g = dot(sin(p * 1.6), cos(p.zxy * 1.6));
  float g2 = dot(sin(p * 4.1 + 1.0), cos(p.zxy * 4.1));
  return (1.9 - length(c)) * 0.8 + g * 0.32 + g2 * 0.08;
}
vec3 cave(vec2 p, float t){
  float z = t * 7.0;
  vec3 ro = vec3(cavePath(z), z);
  vec3 ta = vec3(cavePath(z + 2.0), z + 2.0);
  vec3 ww = normalize(ta - ro), uu = normalize(cross(ww, vec3(0, 1, 0))), vv = cross(uu, ww);
  vec3 rd = normalize(p.x * uu + p.y * vv + 1.3 * ww);
  float d = 0.0; int n = steps(80); float hit = 0.0;
  for (int i = 0; i < n; i++){
    float h = caveMap(ro + rd * d);
    if (h < 0.002 * d){ hit = 1.0; break; }
    d += h * 0.8;
    if (d > 30.0) break;
  }
  vec3 fogc = vec3(0.1, 0.02, 0.12);
  if (hit < 0.5) return fogc + vec3(0.2, 0.9, 0.8) * 0.03 / (dot(p, p) + 0.03);
  vec3 pos = ro + rd * d;
  vec3 nor; NORMAL(caveMap, pos, 0.01, nor)
  // wet, translucent walls lit by a lamp at the eye; veins that glow
  float wrap = max(dot(nor, -rd) * 0.6 + 0.4, 0.0);
  float atten = 1.0 / (1.0 + d * d * 0.05);
  vec3 skin = mix(vec3(0.25, 0.01, 0.08), vec3(0.75, 0.18, 0.22), wrap);
  float vein = smoothstep(0.035, 0.0, abs(fbm(pos.xz * 1.2 + pos.y * 0.7) - 0.5));
  float pulse = 0.6 + 0.4 * sin(t * 6.0 - pos.z * 0.8);
  vec3 col = skin * wrap * atten;
  col += vec3(0.0, 1.0, 0.7) * vein * pulse * 1.4 * (0.25 + atten);
  col += pow(max(dot(reflect(rd, nor), -rd), 0.0), 30.0) * atten * 0.6;
  return mix(col, fogc, 1.0 - exp(-d * 0.08));
}

// ------------------------------------------------------------------ 7 · deep space
vec3 stars(vec2 uv, float s){
  vec2 id = floor(uv), f = fract(uv) - 0.5;
  vec2 h = hash22(id + s);
  vec2 o = (h - 0.5) * 0.8;
  float d = length(f - o);
  float b = smoothstep(0.85, 1.0, h.x) * 0.002 / (d * d + 0.0005);
  return b * mix(vec3(1.0, 0.8, 0.6), vec3(0.6, 0.8, 1.0), h.y);
}
vec3 cosmos(vec2 p, float t){
  vec3 col = vec3(0.0);
  float r = length(p), a = atan(p.y, p.x);
  // a galaxy at the end of the fall
  vec2 gp = p * rot(t * 0.2) * vec2(1.0, 1.8);
  float gr = length(gp), ga = atan(gp.y, gp.x);
  float arms = pow(0.5 + 0.5 * sin(ga * 2.0 - log(gr + 1e-3) * 5.0 + t), 3.0);
  float dust = fbm(gp * 6.0 + t * 0.1);
  col += vec3(1.0, 0.75, 0.5) * exp(-gr * 14.0) * 1.6;
  col += mix(vec3(0.15, 0.25, 0.8), vec3(0.8, 0.3, 0.55), dust) * arms * exp(-gr * 4.5) * dust * dust * 1.2;
  // nebulae and stars rushing past in depth
  for (int i = ZERO; i < 5; i++){
    float fi = float(i);
    float depth = fract(fi / 5.0 + t * 0.35);
    float sc = mix(14.0, 0.6, depth);
    float fade = smoothstep(0.0, 0.25, depth) * smoothstep(1.0, 0.75, depth);
    vec2 uv = p * sc + fi * 7.3;
    float n = fbm(uv * 0.25 + fbm(uv * 0.15));
    vec3 neb = pal(fi * 0.21 + 0.6, vec3(0.5), vec3(0.5), vec3(1.0), vec3(0.0, 0.1, 0.2));
    col += neb * neb * pow(n, 4.0) * fade * 0.35;
    col += stars(uv * 2.0, fi) * fade;
  }
  return col;
}

vec3 universe(float id, vec2 p, float t){
  if (id < 0.5) return warp(p, t);
  if (id < 1.5) return city(p, t);
  if (id < 2.5) return paint(p, t);
  if (id < 3.5) return fractal(p, t);
  if (id < 4.5) return cartoon(p, t);
  if (id < 5.5) return glass(p, t);
  if (id < 6.5) return cave(p, t);
  return cosmos(p, t);
}

// ------------------------------------------------------------------ portals
/** The sling ring's burning edge: a jagged band, sparks racing round it, embers flung off. */
vec3 slingRing(vec2 p, float R, float t, vec3 hot, vec3 warm){
  float r = length(p), a = atan(p.y, p.x);
  float w = 0.01 + 0.018 * min(R, 1.0);
  float d = r - R + (fbm(p / max(r, 1e-3) * 2.5 + t * 3.0) - 0.5) * 0.05 * min(R * 3.0, 1.0);
  vec3 col = hot * exp(-d * d / (w * w * 0.12)) * 1.6;
  col += warm * exp(-abs(d) / (w * 1.6)) * 0.35;
  for (int k = ZERO; k < 3; k++){
    float fk = float(k);
    float dir = mod(fk, 2.0) * 2.0 - 1.0;
    float cells = 70.0 + fk * 45.0;
    float aa = (a / TAU + 0.5) * cells + t * (9.0 + fk * 5.0) * dir;
    float id = mod(floor(aa), cells), f = fract(aa);
    float h = hash11(id + fk * 31.0);
    float off = (h - 0.5) * w * 7.0;
    float len = 0.25 + 0.6 * hash11(id + 7.0);
    float arc = smoothstep(0.0, 0.05, f) * smoothstep(len, len - 0.15, f);
    float so = (d - off) / (w * 0.22);
    float spark = exp(-so * so) * arc * step(0.35, h);
    col += mix(warm, hot, h * h) * spark * 2.5;
  }
  float cells = 90.0;
  float ea = (a / TAU + 0.5) * cells;
  float eid = mod(floor(ea), cells);
  float h = hash11(eid * 1.37);
  float life = fract(t * (1.2 + h) + h * 9.0);
  float er = R + life * (0.08 + 0.3 * hash11(eid + 3.0));
  float ex = (fract(ea) - 0.5) * TAU * r / cells;
  float ember = exp(-(ex * ex + (r - er) * (r - er)) / 0.00002) * (1.0 - life) * step(0.5, h);
  col += mix(warm, hot, 0.3) * ember * 4.0;
  return col;
}

void main(){
  vec2 p = (gl_FragCoord.xy - 0.5 * uRes) / uRes.y;
  vec3 col;
  float alpha = 1.0;

  // the fall: outside the ring we rush on into the old world, inside the next one grows to meet us
  float e = uRing * uRing * (3.0 - 2.0 * uRing);
  float R = pow(uRing, 1.7) * 1.35;
  float r = length(p);
  bool inner = uRing > 0.0 && r < R;
  col = universe(inner ? uB : uA, inner ? p / mix(0.45, 1.0, e) : p * (1.0 - 0.35 * e), inner ? uTB : uTA);
  if (uRing > 0.0 && uRing < 1.0){
    col *= 1.0 - 0.6 * smoothstep(0.0, 0.25, R - r) * (1.0 - e) * step(r, R);
    col += slingRing(p, R, uTime, vec3(1.0, 0.62, 0.22), vec3(1.0, 0.28, 0.02)) * smoothstep(1.0, 0.85, uRing);
  }

  // the way in: a hole at the doorway, edged in the arch's blue
  if (uEntry < 1.0){
    vec2 q = p - uDoor * (1.0 - uEntry);
    float Re = pow(uEntry, 1.4) * 1.5;
    float m = smoothstep(Re, Re - 0.04, length(q));
    vec3 ring = slingRing(q, Re, uTime, vec3(0.6, 0.85, 1.0), vec3(0.1, 0.4, 1.0)) * smoothstep(0.0, 0.1, uEntry) * 1.8;
    col = col * m + ring;
    alpha = m;
  }
  // the way out: the clearing opens through the last of the light
  if (uExit > 0.0){
    vec2 q = p - uDoor * uExit;
    float Rx = pow(uExit, 1.3) * 1.6;
    float m = smoothstep(Rx - 0.04, Rx, length(q));
    vec3 ring = slingRing(q, Rx, uTime, vec3(0.6, 0.85, 1.0), vec3(0.1, 0.4, 1.0)) * smoothstep(1.0, 0.7, uExit) * 1.8;
    col = col * m + ring;
    alpha *= m;
  }
  gl_FragColor = vec4(col, alpha);
}`;

/** The fall itself: radial zoom blur, chromatic split, bloom from the mips, grain, tone map. */
export const postFrag = /* glsl */ `
precision highp float;
varying vec2 vUv;
uniform sampler2D tScene;
uniform vec2 uRes;
uniform float uBlur;    // radial zoom blur
uniform float uSplit;   // chromatic aberration
uniform float uFlash;   // white-out
uniform float uTime;
uniform float uBloom;

vec3 aces(vec3 x){ return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0); }
float hash(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }

void main(){
  vec2 c = vUv - 0.5;
  float dist = length(c * vec2(uRes.x / uRes.y, 1.0));
  vec4 acc = vec4(0.0);
  float jitter = hash(gl_FragCoord.xy + fract(uTime) * 100.0);
  const int N = 12;
  for (int i = 0; i < N; i++){
    float k = (float(i) + jitter) / float(N);
    float s = 1.0 - uBlur * k * dist;
    vec2 off = c * uSplit * dist;
    vec2 uv = 0.5 + c * s;
    vec4 tap = vec4(texture2D(tScene, uv + off).r, texture2D(tScene, uv).g, texture2D(tScene, uv - off).b, texture2D(tScene, uv).a);
    acc += tap;
  }
  acc /= float(N);
  vec3 glow = max(textureLod(tScene, vUv, 3.0).rgb - 0.7, 0.0) * 0.6 + max(textureLod(tScene, vUv, 5.0).rgb - 0.5, 0.0) * 0.8;
  vec3 col = acc.rgb + glow * uBloom;
  col = aces(col * 1.25);
  col = pow(col, vec3(0.85));
  col *= 1.0 - 0.45 * smoothstep(0.35, 0.95, dist) * acc.a;
  col += (jitter - 0.5) * 0.05 * acc.a;
  col = mix(col, vec3(1.0), uFlash);
  // premultiplied (pass 1 already masked the universe): the portals' light outside the holes
  // adds onto the page beneath
  gl_FragColor = vec4(col, max(acc.a, uFlash));
}`;
