// Procedural surfaces for the realistic pavilion, baked to public/textures/real by bake.mjs.
// Pass 0 writes sqrt(albedo) + height, pass 1 writes the normal (xy), roughness and AO.
precision highp float;
  uniform int uKind;
  uniform int uPass;
  uniform float uTile;
  uniform float uTexel;
  varying vec2 vUv;
  const float PI = 3.14159265;

  float hash12(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
  vec2 hash22(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973)); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.xx + p3.yz) * p3.zy); }
  // value noise and fbm that wrap with the given period, so every map tiles seamlessly
  float pnoise(vec2 p, vec2 per) {
    vec2 i = floor(p), f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    float a = hash12(mod(i, per)), b = hash12(mod(i + vec2(1, 0), per));
    float c = hash12(mod(i + vec2(0, 1), per)), d = hash12(mod(i + vec2(1, 1), per));
    return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
  }
  float pfbm(vec2 p, vec2 per, int oct) {
    float s = 0.0, a = 0.5;
    for (int i = 0; i < 8; i++) { if (i >= oct) break; s += a * pnoise(p, per); p *= 2.0; per *= 2.0; a *= 0.5; }
    return s;
  }
  float pworley(vec2 p, vec2 per) {
    vec2 i = floor(p), f = fract(p);
    float d = 9.0;
    for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
      vec2 g = vec2(x, y);
      vec2 o = hash22(mod(i + g, per));
      d = min(d, length(g + o - f));
    }
    return d;
  }

  // ---- surfaces: albedo (linear), height 0..1, roughness, ambient occlusion
  void ashlar(vec2 uv, out vec3 alb, out float h, out float r, out float ao) {
    float rows = 4.0, cols = 2.0;
    float row = floor(uv.y * rows);
    float x = uv.x * cols + mod(row, 2.0) * 0.5;
    vec2 cell = vec2(mod(floor(x), cols), row);
    vec2 f = vec2(fract(x), fract(uv.y * rows));
    vec2 e = min(f, 1.0 - f) * vec2(1.2, 0.6);
    float edge = min(e.x, e.y);
    float joint = 1.0 - smoothstep(0.004, 0.008, edge);
    float tone = hash12(cell + 3.7);
    vec3 base = mix(vec3(0.50, 0.45, 0.36), vec3(0.62, 0.57, 0.46), tone);
    float big = pfbm(uv * 3.0 + cell * 0.37, vec2(3.0), 5);
    base *= 0.86 + 0.28 * big;
    // fine pores and a few darker fossil flecks
    float pores = smoothstep(0.08, 0.0, pworley(uv * 70.0, vec2(70.0)));
    base *= 1.0 - 0.25 * pores;
    // rain-washed streaks running down from the top of each block
    float streak = pfbm(vec2(uv.x * 48.0, uv.y * 3.0), vec2(48.0, 3.0), 4);
    base *= 1.0 - 0.18 * smoothstep(0.55, 0.85, streak) * (0.4 + 0.6 * (1.0 - f.y));
    // the arrises are slightly rounded and soiled
    float arris = smoothstep(0.0, 0.03, edge);
    base *= 0.82 + 0.18 * arris;
    alb = mix(base, vec3(0.34, 0.32, 0.29), joint);
    h = mix(0.15, 0.62 + 0.1 * big - 0.12 * pores, smoothstep(0.004, 0.022, edge));
    r = mix(0.97, 0.78 + 0.12 * big, 1.0 - joint);
    ao = mix(0.55, 1.0, smoothstep(0.0, 0.03, edge));
  }

  void stone(vec2 uv, out vec3 alb, out float h, out float r, out float ao) {
    float big = pfbm(uv * 2.0, vec2(2.0), 6);
    float bed = sin(uv.y * PI * 14.0 + pfbm(uv * 4.0, vec2(4.0), 4) * 5.0) * 0.5 + 0.5;
    vec3 base = mix(vec3(0.53, 0.48, 0.39), vec3(0.64, 0.6, 0.5), big);
    base *= 0.94 + 0.08 * bed;
    float pores = smoothstep(0.07, 0.0, pworley(uv * 90.0, vec2(90.0)));
    base *= 1.0 - 0.22 * pores;
    float soil = smoothstep(0.6, 0.9, pfbm(uv * 6.0 + 4.0, vec2(6.0), 5));
    base *= 1.0 - 0.15 * soil;
    alb = base;
    h = 0.5 + 0.25 * pfbm(uv * 16.0, vec2(16.0), 4) - 0.2 * pores;
    r = 0.62 + 0.18 * big;
    ao = 1.0 - 0.3 * pores;
  }

  float veins(vec2 uv, float freq, float warp, vec2 per) {
    float n = pfbm(uv * per.x, per, 6);
    float v = abs(sin((uv.x * 2.0 + uv.y * 1.0) * PI * freq + n * warp));
    return smoothstep(0.08, 0.0, v);
  }

  void marble(vec2 uv, out vec3 alb, out float h, out float r, out float ao) {
    vec2 g = floor(uv * 2.0);
    vec2 f = fract(uv * 2.0);
    float black = mod(g.x + g.y, 2.0);
    vec2 e = min(f, 1.0 - f) * 1.5;
    float joint = 1.0 - smoothstep(0.0012, 0.003, min(e.x, e.y));
    float cloud = pfbm(uv * 4.0 + g * 1.7, vec2(4.0), 6);
    float v1 = veins(uv + g * 0.31, 2.0, 9.0, vec2(4.0));
    float v2 = veins(uv + 0.5 + g * 0.17, 6.0, 6.0, vec2(8.0));
    vec3 white = mix(vec3(0.72, 0.72, 0.70), vec3(0.82, 0.82, 0.80), cloud);
    white = mix(white, vec3(0.42, 0.43, 0.45), v1 * 0.7 + v2 * 0.25);
    vec3 nero = vec3(0.012, 0.012, 0.014) * (0.8 + 0.5 * cloud);
    nero = mix(nero, vec3(0.62, 0.6, 0.56), v1 * 0.85 + v2 * 0.35);
    alb = mix(white, nero, black);
    alb = mix(alb, vec3(0.08, 0.08, 0.08), joint);
    h = 0.5 - joint * 0.4;
    float scratch = smoothstep(0.985, 1.0, pnoise(vec2(uv.x * 3.0, uv.y * 900.0), vec2(3.0, 900.0)));
    r = 0.06 + 0.05 * cloud + 0.12 * scratch + 0.4 * joint;
    ao = 1.0 - 0.4 * joint;
  }

  void nero(vec2 uv, out vec3 alb, out float h, out float r, out float ao) {
    float cloud = pfbm(uv * 3.0, vec2(3.0), 6);
    float v1 = veins(uv, 2.0, 10.0, vec2(3.0));
    float v2 = veins(uv + 0.37, 6.0, 7.0, vec2(6.0));
    alb = vec3(0.011, 0.011, 0.013) * (0.8 + 0.6 * cloud);
    alb = mix(alb, vec3(0.6, 0.58, 0.54), v1 * 0.8 + v2 * 0.3);
    h = 0.5;
    r = 0.07 + 0.05 * cloud;
    ao = 1.0;
  }

  void paving(vec2 uv, out vec3 alb, out float h, out float r, out float ao) {
    // five courses of travertine, each laid as one of a few slab patterns that span 4m exactly
    float rows = 5.0;
    float row = floor(uv.y * rows);
    float fy = fract(uv.y * rows);
    float pat = floor(hash12(vec2(row, 7.0)) * 4.0);
    float L[4];
    if (pat < 1.0) { L[0] = 1.2; L[1] = 1.6; L[2] = 1.2; L[3] = 0.0; }
    else if (pat < 2.0) { L[0] = 0.8; L[1] = 1.2; L[2] = 0.8; L[3] = 1.2; }
    else if (pat < 3.0) { L[0] = 1.6; L[1] = 0.8; L[2] = 1.6; L[3] = 0.0; }
    else { L[0] = 2.0; L[1] = 2.0; L[2] = 0.0; L[3] = 0.0; }
    float shift = floor(hash12(vec2(row, 3.0)) * 10.0) * 0.4;
    float xm = mod(uv.x * 4.0 + shift, 4.0);
    float acc = 0.0, x0 = 0.0, x1 = 4.0, idx = 0.0;
    for (int i = 0; i < 4; i++) {
      if (L[i] <= 0.0) break;
      if (xm >= acc && xm < acc + L[i]) { x0 = acc; x1 = acc + L[i]; idx = float(i); }
      acc += L[i];
    }
    vec2 cell = vec2(idx, row);
    float ex = min(xm - x0, x1 - xm);
    float ey = min(fy, 1.0 - fy) * 0.8;
    float edge = min(ex, ey);
    float joint = 1.0 - smoothstep(0.003, 0.007, edge);
    float tone = hash12(cell + row * 1.3);
    vec3 base = mix(vec3(0.46, 0.40, 0.31), vec3(0.58, 0.52, 0.41), tone);
    // travertine banding and its characteristic voids
    float band = pfbm(vec2(uv.x * 2.0, uv.y * 30.0), vec2(2.0, 30.0), 5);
    base *= 0.9 + 0.2 * band;
    float voids = smoothstep(0.12, 0.02, pworley(vec2(uv.x * 30.0, uv.y * 90.0), vec2(30.0, 90.0)));
    voids *= step(0.55, pnoise(uv * 20.0, vec2(20.0)));
    base *= 1.0 - 0.45 * voids;
    float grime = smoothstep(0.5, 0.95, pfbm(uv * 5.0 + 9.0, vec2(5.0), 5));
    base *= 1.0 - 0.2 * grime;
    alb = mix(base, vec3(0.2, 0.19, 0.17), joint);
    h = mix(0.1, 0.6 + 0.08 * band - 0.35 * voids, smoothstep(0.003, 0.015, edge));
    r = mix(0.95, 0.72 + 0.12 * grime, 1.0 - joint);
    ao = mix(0.5, 1.0 - 0.3 * voids, smoothstep(0.0, 0.02, edge));
  }

  void grass(vec2 uv, out vec3 alb, out float h, out float r, out float ao) {
    // blades in three directions, each laid out so it still wraps with the tile
    float blades = pnoise(vec2(uv.x * 420.0, uv.y * 60.0), vec2(420.0, 60.0));
    blades += pnoise(vec2(uv.x * 60.0, uv.y * 420.0), vec2(60.0, 420.0));
    blades += pnoise(vec2((uv.x + uv.y) * 210.0, (uv.x - uv.y) * 30.0), vec2(210.0, 30.0));
    blades /= 3.0;
    float patchy = pfbm(uv * 3.0, vec2(3.0), 5);
    float dry = smoothstep(0.55, 0.8, pfbm(uv * 2.0 + 5.0, vec2(2.0), 4));
    vec3 g1 = vec3(0.035, 0.075, 0.018);
    vec3 g2 = vec3(0.09, 0.16, 0.035);
    alb = mix(g1, g2, blades * 0.8 + patchy * 0.4);
    alb = mix(alb, vec3(0.16, 0.15, 0.06), dry * 0.45);
    float clover = smoothstep(0.12, 0.0, pworley(uv * 40.0, vec2(40.0))) * step(0.6, patchy);
    alb = mix(alb, vec3(0.03, 0.09, 0.02), clover * 0.6);
    h = blades * 0.8 + 0.2 * patchy;
    r = 0.88;
    ao = 0.65 + 0.35 * blades;
  }

  void bronze(vec2 uv, out vec3 alb, out float h, out float r, out float ao) {
    float n = pfbm(uv * 5.0, vec2(5.0), 6);
    float fine = pfbm(uv * 40.0, vec2(40.0), 3);
    float patina = smoothstep(0.55, 0.78, n + 0.15 * fine);
    vec3 metal = mix(vec3(0.42, 0.28, 0.15), vec3(0.62, 0.45, 0.26), fine);
    alb = mix(metal, vec3(0.14, 0.26, 0.21), patina * 0.75);
    h = 0.5 + 0.1 * fine - 0.1 * patina;
    r = mix(0.32, 0.75, patina) + 0.08 * fine;
    ao = 1.0 - 0.25 * patina;
  }

  void wood(vec2 uv, out vec3 alb, out float h, out float r, out float ao) {
    float warp = pfbm(uv * vec2(2.0, 8.0), vec2(2.0, 8.0), 5);
    float g = sin((uv.x * 60.0 + warp * 10.0) * PI) * 0.5 + 0.5;
    float fleck = pnoise(vec2(uv.x * 300.0, uv.y * 12.0), vec2(300.0, 12.0));
    alb = mix(vec3(0.07, 0.035, 0.018), vec3(0.17, 0.09, 0.045), g * 0.7 + fleck * 0.3);
    h = 0.5 + 0.08 * g;
    r = 0.38 + 0.15 * fleck;
    ao = 1.0;
  }

  void foliage(vec2 uv, out vec3 alb, out float h, out float r, out float ao) {
    float w1 = pworley(uv * 14.0, vec2(14.0));
    float w2 = pworley(uv * 37.0 + 3.0, vec2(37.0));
    float leaf = 1.0 - smoothstep(0.0, 0.7, w1);
    float small = 1.0 - smoothstep(0.0, 0.6, w2);
    float n = pfbm(uv * 4.0, vec2(4.0), 4);
    h = leaf * 0.65 + small * 0.35;
    alb = mix(vec3(0.012, 0.03, 0.01), vec3(0.06, 0.11, 0.03), h * 0.8 + n * 0.3);
    r = 0.75;
    ao = 0.25 + 0.75 * smoothstep(0.1, 0.8, h);
  }

  void plaster(vec2 uv, out vec3 alb, out float h, out float r, out float ao) {
    float n = pfbm(uv * 4.0, vec2(4.0), 6);
    float fine = pnoise(uv * 200.0, vec2(200.0));
    alb = mix(vec3(0.6, 0.57, 0.5), vec3(0.68, 0.65, 0.58), n);
    h = 0.5 + 0.1 * fine + 0.1 * n;
    r = 0.85;
    ao = 1.0;
  }

  void surf(vec2 uv, out vec3 alb, out float h, out float r, out float ao) {
    uv = fract(uv);
    if (uKind == 0) ashlar(uv, alb, h, r, ao);
    else if (uKind == 1) stone(uv, alb, h, r, ao);
    else if (uKind == 2) marble(uv, alb, h, r, ao);
    else if (uKind == 3) nero(uv, alb, h, r, ao);
    else if (uKind == 4) paving(uv, alb, h, r, ao);
    else if (uKind == 5) grass(uv, alb, h, r, ao);
    else if (uKind == 6) bronze(uv, alb, h, r, ao);
    else if (uKind == 7) wood(uv, alb, h, r, ao);
    else if (uKind == 8) foliage(uv, alb, h, r, ao);
    else plaster(uv, alb, h, r, ao);
  }

  float heightAt(vec2 uv) { vec3 a; float h, r, o; surf(uv, a, h, r, o); return h; }

  void main() {
    vec3 alb; float h, r, ao;
    surf(vUv, alb, h, r, ao);
    if (uPass == 0) {
      gl_FragColor = vec4(sqrt(clamp(alb, 0.0, 1.0)), h);
    } else {
      // height is in units of ~4mm of relief; slope per metre gives the normal
      float e = uTexel;
      float hx = heightAt(vUv + vec2(e, 0.0)) - heightAt(vUv - vec2(e, 0.0));
      float hy = heightAt(vUv + vec2(0.0, e)) - heightAt(vUv - vec2(0.0, e));
      float metres = 2.0 * e * uTile;
      vec3 n = normalize(vec3(-hx / metres * 0.004, -hy / metres * 0.004, 1.0));
      gl_FragColor = vec4(n.xy * 0.5 + 0.5, clamp(r, 0.0, 1.0), clamp(ao, 0.0, 1.0));
    }
  }
