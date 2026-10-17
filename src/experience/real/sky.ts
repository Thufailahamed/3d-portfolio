/**
 * The realistic pavilion's sky, one shader for every weather:
 *
 * - day: single-scattering atmosphere (Rayleigh + Mie) lit by the sun, a sun disc with limb
 *   darkening, a cumulus deck lit from the sun with silver linings, and high cirrus
 * - night: deep blue airglow and the city's warm glow on the horizon, the Milky Way with its
 *   bulge and dark dust lanes, a spiral galaxy, a pink emission nebula, and a phased, cratered
 *   moon with its halo
 * - rain: a low storm deck with fast scud beneath it
 *
 * The expensive part (skyFrag) is baked into an HDR cube map a face at a time; the dome the camera
 * sees (skyDisplayFrag) samples it and adds what must stay sharp or fast: the stars and their
 * twinkle, shooting stars and lightning in the clouds. The same cube feeds the reflections.
 */
export const skyVert = /* glsl */ `
  varying vec3 vDir;
  void main() {
    vDir = position;
    vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    gl_Position = p.xyww; // always at the far plane
  }
`;

export const skyFrag = /* glsl */ `
  precision highp float;
  uniform vec3 uSun;
  uniform vec3 uMoon;
  uniform float uDay;
  uniform float uNight;
  uniform float uRain;
  uniform float uTime;
  uniform vec3 uFog;
  // always 1: loop bounds read from a uniform cannot be unrolled, which keeps the program small
  // (unrolled, Direct3D took ~9s to compile it)
  uniform int uLoop;
  varying vec3 vDir;

  const float PI = 3.14159265;

  float hash13(vec3 p3) { p3 = fract(p3 * 0.1031); p3 += dot(p3, p3.zyx + 31.32); return fract((p3.x + p3.y) * p3.z); }
  float hash12(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
  float noise3(vec3 p) {
    vec3 i = floor(p), f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(mix(hash13(i), hash13(i + vec3(1, 0, 0)), f.x), mix(hash13(i + vec3(0, 1, 0)), hash13(i + vec3(1, 1, 0)), f.x), f.y),
               mix(mix(hash13(i + vec3(0, 0, 1)), hash13(i + vec3(1, 0, 1)), f.x), mix(hash13(i + vec3(0, 1, 1)), hash13(i + vec3(1, 1, 1)), f.x), f.y), f.z);
  }
  float fbm3(vec3 p, int oct) { float s = 0.0, a = 0.5, n = 0.0; for (int i = 0; i < oct * uLoop; i++) { s += a * noise3(p); n += a; p = p * 2.03 + 0.17; a *= 0.5; } return s / max(n, 1e-3) * 0.97; }
  float noise2(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash12(i), hash12(i + vec2(1, 0)), u.x), mix(hash12(i + vec2(0, 1)), hash12(i + vec2(1, 1)), u.x), u.y);
  }
  float fbm2(vec2 p, int oct) {
    float s = 0.0, a = 0.5;
    mat2 r = mat2(0.8, 0.6, -0.6, 0.8);
    for (int i = 0; i < oct * uLoop; i++) { s += a * noise2(p); p = r * p * 2.02 + 3.1; a *= 0.5; }
    return s;
  }

  // ---------------------------------------------------------------- atmosphere
  vec2 raySphere(vec3 ro, vec3 rd, float r) {
    float b = dot(ro, rd), c = dot(ro, ro) - r * r, d = b * b - c;
    if (d < 0.0) return vec2(1e9, -1e9);
    d = sqrt(d);
    return vec2(-b - d, -b + d);
  }
  vec3 atmosphere(vec3 rd, vec3 L, float intensity) {
    const float Re = 6371e3, Ra = 6471e3;
    vec3 ro = vec3(0.0, Re + 200.0, 0.0);
    const vec3 kR = vec3(5.5e-6, 13.0e-6, 22.4e-6);
    const float kM = 21e-6, hR = 8e3, hM = 1.2e3, g = 0.76;
    float tmax = raySphere(ro, rd, Ra).y;
    float mu = dot(rd, L), mu2 = mu * mu, gg = g * g;
    float pR = 3.0 / (16.0 * PI) * (1.0 + mu2);
    float pM = 3.0 / (8.0 * PI) * ((1.0 - gg) * (1.0 + mu2)) / ((2.0 + gg) * pow(1.0 + gg - 2.0 * mu * g, 1.5));
    const int N = 12, M = 5;
    float ds = tmax / float(N);
    vec3 sR = vec3(0.0), sM = vec3(0.0);
    float oR = 0.0, oM = 0.0;
    for (int i = 0; i < N * uLoop; i++) {
      vec3 x = ro + rd * (ds * (float(i) + 0.5));
      float h = length(x) - Re;
      float dR = exp(-h / hR) * ds, dM = exp(-h / hM) * ds;
      oR += dR; oM += dM;
      float tl = raySphere(x, L, Ra).y;
      float dl = tl / float(M);
      float lR = 0.0, lM = 0.0;
      for (int j = 0; j < M * uLoop; j++) {
        vec3 y = x + L * (dl * (float(j) + 0.5));
        float hl = max(length(y) - Re, 0.0);
        lR += exp(-hl / hR) * dl; lM += exp(-hl / hM) * dl;
      }
      vec3 att = exp(-(kR * (oR + lR) + kM * 1.1 * (oM + lM)));
      sR += dR * att; sM += dM * att;
    }
    return intensity * (sR * kR * pR + sM * kM * pM);
  }

  // ---------------------------------------------------------------- clouds
  // Height-field cloud deck projected onto a plane overhead, with a second sample toward the
  // light for self shadowing (and the bright, thin edges that face the sun).
  // Domain-warped fbm. Every noise evaluation goes through the single fbm2 call in this loop:
  // two warp lookups, then the density itself (each call site would be inlined separately).
  float cloudField(vec2 p, float cover, float t, float speed) {
    vec2 w = vec2(0.0);
    float n = 0.0;
    for (int k = 0; k < 3 * uLoop; k++) {
      vec2 q = k == 0 ? p * 0.6 + t * 0.01 * speed : k == 1 ? p * 0.6 + vec2(5.2, 1.3) - t * 0.008 * speed : p + 1.6 * w + vec2(t * 0.02 * speed, 0.0);
      float v = fbm2(q, k == 2 ? 6 : 4);
      if (k == 0) w.x = v; else if (k == 1) w.y = v; else n = v;
    }
    return smoothstep(1.0 - cover, 1.0 - cover + 0.32, n);
  }

  vec4 clouds(vec3 rd, vec3 L, vec3 lightCol, vec3 ambient, float cover, float speed, float dark) {
    if (rd.y <= 0.0) return vec4(0.0);
    float t = 1.0 / (rd.y + 0.06);
    vec2 p = rd.xz * t * 1.25;
    // the density here and a step toward the light (for self-shadowing), from one call site
    float d = 0.0, d2 = 0.0;
    vec2 toL = normalize(L.xz + 1e-4) * 0.11 * max(L.y, 0.15);
    for (int k = 0; k < 2 * uLoop; k++) {
      float v = cloudField(p + toL * float(k), cover, uTime, speed);
      if (k == 0) {
        d = v;
        if (d <= 0.001) return vec4(0.0);
      } else d2 = v;
    }
    float light = exp(-d2 * 3.2);
    float mu = max(dot(rd, L), 0.0);
    float silver = pow(mu, 9.0) * (1.0 - d) * 4.0 + pow(mu, 3.0) * 0.5;
    vec3 col = ambient * mix(1.0, 0.55, d) + lightCol * (light * 0.9 + silver) * (1.0 - dark);
    col *= mix(1.0, 0.4, dark * d);
    float a = d * smoothstep(0.0, 0.14, rd.y);
    return vec4(col, a);
  }

  float cirrus(vec3 rd) {
    if (rd.y <= 0.0) return 0.0;
    vec2 p = rd.xz / (rd.y + 0.2) * 0.9;
    p = vec2(p.x * 0.35 + p.y * 0.2, p.y * 1.4) + vec2(uTime * 0.004, 0.0);
    float n = noise2(p * 2.0) * 0.6 + noise2(p * 4.3 + 1.7) * 0.3 + noise2(p * 9.1 + 3.3) * 0.1;
    return smoothstep(0.52, 0.85, n) * smoothstep(0.02, 0.3, rd.y) * 0.5;
  }

  // ---------------------------------------------------------------- night
  vec3 nightSky(vec3 rd) {
    float up = max(rd.y, 0.0);
    // airglow gradient, a city glow from Colombo low on the western horizon
    vec3 col = mix(vec3(0.010, 0.016, 0.034), vec3(0.0018, 0.003, 0.009), pow(up, 0.45));
    float cityAz = max(dot(normalize(rd.xz + 1e-4), normalize(vec2(-0.8, 0.5))), 0.0);
    col += vec3(0.05, 0.028, 0.012) * exp(-up * 9.0) * (0.35 + 0.65 * pow(cityAz, 3.0));

    // Milky Way
    vec3 galN = normalize(vec3(0.243, 0.826, 0.509));
    vec3 gx = normalize(cross(galN, vec3(0.0, 1.0, 0.0)));
    vec3 gy = cross(galN, gx);
    float lat = dot(rd, galN);
    float lon = atan(dot(rd, gy), dot(rd, gx));
    float bulge = exp(-pow(lon + 2.2, 2.0) * 1.4);
    float width = 0.13 + 0.09 * bulge;
    float band = exp(-lat * lat / (width * width));
    // every noise of the night sky through one fbm3 call site: Milky Way glow, dust, fine star
    // clouds, nebula
    float n1 = 0.0, dn = 0.0, n2 = 0.0, nb = 0.0;
    for (int k = 0; k < 4 * uLoop; k++) {
      vec3 q = k == 0 ? rd * 5.0 : k == 1 ? rd * 9.0 + 9.0 : k == 2 ? rd * 16.0 + 4.0 : rd * 40.0;
      float v = fbm3(q, k < 2 ? 5 : 2);
      if (k == 0) n1 = v; else if (k == 1) dn = v; else if (k == 2) n2 = v; else nb = v;
    }
    float dust = smoothstep(0.42, 0.72, dn) * exp(-lat * lat / (0.05 * 0.05 + 0.03 * bulge));
    float lane = smoothstep(0.035, 0.0, abs(lat + 0.012 * sin(lon * 3.0) + 0.02 * (n1 - 0.5))) * (0.6 + 0.4 * bulge);
    float glow = band * (0.35 + 0.65 * n1) * (0.55 + 1.2 * bulge);
    glow *= 1.0 - 0.75 * dust - 0.6 * lane;
    vec3 mwCol = mix(vec3(0.5, 0.58, 0.85), vec3(1.0, 0.8, 0.58), bulge * band);
    col += mwCol * max(glow, 0.0) * 0.15;
    col += vec3(0.85, 0.88, 1.0) * pow(n2, 4.0) * band * 0.45 * (1.0 - dust);

    // pink emission nebula in the band
    vec3 nebD = normalize(gx * cos(-1.55) + gy * sin(-1.55) + galN * 0.02);
    float nd = length(rd - nebD);
    col += vec3(0.9, 0.25, 0.45) * exp(-nd * nd * 600.0) * nb * 0.3;

    // spiral galaxy (Andromeda-like): bright core, tilted disc, faint arms
    vec3 gd = normalize(vec3(-0.46, 0.34, -0.82));
    vec3 ta = normalize(cross(gd, vec3(0.0, 1.0, 0.0)));
    vec3 tb = cross(ta, gd);
    vec2 q = vec2(dot(rd - gd, ta), dot(rd - gd, tb)) / 0.045;
    q = mat2(0.82, 0.57, -0.57, 0.82) * q;
    q.y /= 0.32;
    float r = length(q);
    float ang = atan(q.y, q.x);
    float arms = 0.55 + 0.45 * sin(2.0 * ang - log(r + 0.05) * 5.0);
    float disc = exp(-r * 2.6) * arms;
    float core = exp(-r * r * 40.0);
    col += (vec3(0.65, 0.72, 1.0) * disc * 0.2 + vec3(1.0, 0.9, 0.75) * core * 1.4) * smoothstep(1.4, 0.2, r);

    // the moon: phase from the sun's side, craters and maria, a soft halo in the haze
    vec3 md = uMoon;
    float mr = 0.016;
    vec3 mx = normalize(cross(md, vec3(0.0, 1.0, 0.0)));
    vec3 my = cross(mx, md);
    vec2 mq = vec2(dot(rd, mx), dot(rd, my)) / mr;
    float m2 = dot(mq, mq);
    float dm = length(rd - md);
    if (m2 < 1.0 && dot(rd, md) > 0.0) {
      vec3 sn = vec3(mq, sqrt(1.0 - m2));
      vec3 sunL = normalize(vec3(0.75, 0.25, 0.35));
      float lit = smoothstep(-0.05, 0.12, dot(sn, sunL));
      float maria = 0.0, crater = 0.0;
      for (int k = 0; k < 2 * uLoop; k++) {
        float v = fbm2(k == 0 ? mq * 1.7 + 3.0 : mq * 6.0, 2);
        if (k == 0) maria = smoothstep(0.45, 0.65, v); else crater = smoothstep(0.1, 0.0, abs(v - 0.5)) * 0.15;
      }
      float alb = (0.9 - 0.35 * maria + crater) * (0.85 + 0.15 * sn.z);
      col = mix(col, vec3(1.0, 0.97, 0.9) * alb * 2.2 * lit + col * (1.0 - lit), smoothstep(1.0, 0.92, m2));
    }
    col += vec3(0.55, 0.62, 0.8) * (exp(-dm * 40.0) * 0.12 + exp(-dm * 7.0) * 0.03);
    // the moon lights the haze around it and along the horizon (analytic: a second scattering
    // march here doubled the program)
    float mh = max(dot(rd, md), 0.0);
    col += vec3(0.05, 0.06, 0.09) * (pow(mh, 6.0) * 0.6 + 0.25) * exp(-up * 3.0) * 0.12;
    return col;
  }

  // ---------------------------------------------------------------- compose
  void main() {
    vec3 rd = normalize(vDir);
    vec3 rdA = normalize(vec3(rd.x, max(rd.y, 0.0) + 0.001, rd.z));
    float up = max(rd.y, 0.0);

    // clear-sky base for each weather
    vec3 daySky = vec3(0.0);
    float ci = 0.0;
    if (uDay > 0.001) {
      daySky = atmosphere(rdA, uSun, 20.0);
      float sd = dot(rd, uSun);
      float disc = smoothstep(0.99988, 0.99993, sd);
      float limb = sqrt(max(1.0 - (1.0 - sd) / 0.00012, 0.0));
      daySky += vec3(1.0, 0.94, 0.82) * disc * (0.45 + 0.55 * limb) * 60.0;
      ci = cirrus(rd);
      daySky = mix(daySky, vec3(1.0, 0.98, 0.96) * 1.3, ci * 0.6);
    }
    vec3 nightCol = uNight > 0.001 ? nightSky(rd) : vec3(0.0);
    vec3 stormSky = mix(vec3(0.20, 0.215, 0.235), vec3(0.075, 0.085, 0.1), pow(up, 0.6));

    // The cloud layers, in one loop so the (large) cloud code is compiled once rather than
    // inlined for every weather: 0 day cumulus, 1 moonlit night clouds, 2 storm deck, 3 scud
    float dayA = 0.0, nightA = 0.0, deckA = 0.0, scudA = 0.0;
    for (int i = 0; i < 4 * uLoop; i++) {
      float w = i == 0 ? uDay : i == 1 ? uNight : uRain;
      if (w < 0.001) continue;
      vec3 dir = rd, L, lightCol, amb;
      float cover, speed, dark;
      if (i == 0) {
        L = uSun; lightCol = vec3(1.0, 0.93, 0.8) * 2.6; amb = vec3(0.42, 0.52, 0.68) * (0.75 + 0.5 * uSun.y);
        cover = 0.42; speed = 1.0; dark = 0.0;
      } else if (i == 1) {
        L = uMoon; lightCol = vec3(0.32, 0.36, 0.45) * 0.35;
        amb = vec3(0.008, 0.011, 0.02) + vec3(0.02, 0.012, 0.006) * exp(-up * 6.0);
        cover = 0.22; speed = 0.7; dark = 0.0;
      } else if (i == 2) {
        L = normalize(vec3(0.2, 1.0, 0.1)); lightCol = vec3(0.32, 0.34, 0.37); amb = vec3(0.11, 0.12, 0.135);
        cover = 0.96; speed = 3.2; dark = 0.55;
      } else {
        // lower scud racing beneath the deck
        dir = normalize(vec3(rd.x, rd.y * 1.9, rd.z));
        L = vec3(0.0, 1.0, 0.0); lightCol = vec3(0.16, 0.17, 0.19); amb = vec3(0.08, 0.09, 0.1);
        cover = 0.55; speed = 6.0; dark = 0.4;
      }
      vec4 cl = clouds(dir, L, lightCol, amb, cover, speed, dark);
      if (i == 0) { daySky = mix(daySky, cl.rgb, cl.a); dayA = cl.a; }
      else if (i == 1) { nightCol = mix(nightCol, cl.rgb, cl.a * 0.92); nightA = cl.a * 0.92; }
      else if (i == 2) { stormSky = mix(stormSky, cl.rgb, cl.a); deckA = cl.a; }
      else { stormSky = mix(stormSky, cl.rgb, cl.a * 0.7); scudA = cl.a; }
    }

    vec3 col = daySky * uDay + nightCol * uNight;
    float cover = max(dayA, ci * 0.4) * uDay + nightA * uNight;
    col = mix(col, stormSky, uRain);
    cover = mix(cover, max(deckA, scudA), uRain);

    // below the horizon the ground haze takes over (the fog matches it)
    col = mix(col, uFog, smoothstep(0.025, -0.06, rd.y));
    // alpha carries the cloud cover, so the display can hide the stars behind clouds
    gl_FragColor = vec4(col, clamp(cover, 0.0, 1.0));
  }
`;

export const skyDisplayFrag = /* glsl */ `
  precision highp float;
  uniform samplerCube uSky;
  uniform float uNight;
  uniform float uRain;
  uniform float uTime;
  uniform float uFlash;
  uniform vec3 uFlashDir;
  uniform vec4 uMeteorA; // xyz start direction, w progress 0..1 (or < 0 when none)
  uniform vec3 uMeteorB;
  varying vec3 vDir;
  const float PI = 3.14159265;

  float hash13(vec3 p3) { p3 = fract(p3 * 0.1031); p3 += dot(p3, p3.zyx + 31.32); return fract((p3.x + p3.y) * p3.z); }
  vec3 hash33(vec3 p3) { p3 = fract(p3 * vec3(0.1031, 0.1030, 0.0973)); p3 += dot(p3, p3.yxz + 33.33); return fract((p3.xxy + p3.yxx) * p3.zyx); }

  // one star per occupied cell of a grid on the sphere: brightness power law, colour
  // temperature, and a twinkle that gets stronger toward the horizon
  vec3 starLayer(vec3 rd, float scale, float density, float seed, float boost) {
    vec3 p = rd * scale;
    vec3 c = floor(p);
    vec3 f = fract(p) - 0.5;
    float h = hash13(c + seed);
    float thresh = 1.0 - density;
    if (h < thresh) return vec3(0.0);
    vec3 off = (hash33(c + seed * 1.7) - 0.5) * 0.6;
    float d = length(f - off);
    float b = pow((h - thresh) / max(density, 1e-4), 4.0);
    float core = exp(-d * d * mix(260.0, 90.0, b));
    float temp = hash13(c + seed + 11.0);
    vec3 tint = temp < 0.3 ? vec3(1.0, 0.78, 0.6) : temp < 0.75 ? vec3(1.0, 0.96, 0.9) : vec3(0.72, 0.82, 1.0);
    float tw = 0.7 + 0.3 * sin(uTime * (1.5 + 5.0 * h) + h * 80.0);
    tw = mix(1.0, tw, smoothstep(0.5, 0.05, rd.y));
    return tint * core * (0.25 + b * 3.5) * tw * boost;
  }

  void main() {
    vec3 rd = normalize(vDir);
    vec4 sky = textureCube(uSky, rd);
    vec3 col = sky.rgb;
    if (uNight > 0.001 && rd.y > -0.02) {
      // denser along the Milky Way (the same plane as the baked glow)
      vec3 galN = normalize(vec3(0.243, 0.826, 0.509));
      float lat = dot(rd, galN);
      float band = exp(-lat * lat / 0.03);
      vec3 st = starLayer(rd, 420.0, 0.06 + 0.16 * band, 1.0, 0.35);
      st += starLayer(rd, 240.0, 0.035 + 0.05 * band, 7.0, 0.7);
      st += starLayer(rd, 120.0, 0.018, 13.0, 1.5);
      float clear = (1.0 - sky.a) * smoothstep(-0.02, 0.12, rd.y);
      col += st * clear * uNight * (1.0 - uRain);
      // shooting star
      if (uMeteorA.w >= 0.0) {
        float pr = uMeteorA.w;
        vec3 a = normalize(mix(uMeteorA.xyz, uMeteorB, max(pr - 0.25, 0.0)));
        vec3 b = normalize(mix(uMeteorA.xyz, uMeteorB, pr));
        vec3 ab = b - a;
        float tt = clamp(dot(rd - a, ab) / max(dot(ab, ab), 1e-6), 0.0, 1.0);
        float dd = length(rd - (a + ab * tt));
        col += vec3(0.85, 0.92, 1.0) * exp(-dd * dd * 2.5e6) * tt * tt * sin(pr * PI) * 3.0 * clear;
      }
    }
    if (uFlash > 0.001) {
      // lightning lights the cloud deck from within
      float fl = max(dot(rd, uFlashDir), 0.0);
      col += vec3(0.75, 0.8, 1.0) * uFlash * uRain * (0.35 * pow(fl, 3.0) + 0.12) * (0.4 + 0.6 * sky.a) * smoothstep(-0.05, 0.1, rd.y);
    }
    gl_FragColor = vec4(col, 1.0);
  }
`;
