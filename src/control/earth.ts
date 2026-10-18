/**
 * One Earth for every view: a land mask rasterised from the Natural Earth coastlines (flood-filled
 * from the open ocean), NASA's Black Marble city lights for the night side, procedural clouds, and an
 * atmosphere limb. Lit by the real Sun direction.
 */

import * as THREE from "three";

/** coastline segments → equirectangular land mask (white = land); null if the fill leaked */
export function landMask(bin: ArrayBuffer, W = 2048, H = 1024): HTMLCanvasElement | null {
  const head = new Uint32Array(bin, 0, 2);
  const data = new Int16Array(bin, 8);
  const nB = head[0];
  const nC = head[1];
  const cv = document.createElement("canvas");
  cv.width = W;
  cv.height = H;
  const c = cv.getContext("2d")!;
  c.fillStyle = "#000";
  c.fillRect(0, 0, W, H);
  c.strokeStyle = "#fff";
  c.lineWidth = 2.2;
  c.beginPath();
  for (let i = nB; i < nB + nC; i++) {
    const x1 = ((data[i * 4] / 100 + 180) / 360) * W, y1 = ((90 - data[i * 4 + 1] / 100) / 180) * H;
    const x2 = ((data[i * 4 + 2] / 100 + 180) / 360) * W, y2 = ((90 - data[i * 4 + 3] / 100) / 180) * H;
    if (Math.abs(x1 - x2) > W / 2) continue;
    c.moveTo(x1, y1);
    c.lineTo(x2, y2);
  }
  c.stroke();
  const img = c.getImageData(0, 0, W, H);
  const px = img.data;
  const wall = new Uint8Array(W * H);
  for (let i = 0; i < W * H; i++) wall[i] = px[i * 4] > 60 ? 1 : 0;
  // flood the ocean from several open-water seeds (Pacific, Atlantic, Indian, Southern)
  const sea = new Uint8Array(W * H);
  const stack: number[] = [];
  const seed = (lon: number, lat: number) => {
    const x = Math.floor(((lon + 180) / 360) * W), y = Math.floor(((90 - lat) / 180) * H);
    const i = y * W + x;
    if (!wall[i] && !sea[i]) {
      sea[i] = 1;
      stack.push(i);
    }
  };
  [[-150, 0], [-30, 0], [75, -20], [0, -55], [-170, 40], [160, -40], [-40, 40], [170, 10]].forEach(([a, b]) => seed(a, b));
  while (stack.length) {
    const i = stack.pop()!;
    const x = i % W, y = (i / W) | 0;
    const nbrs = [y > 0 ? i - W : -1, y < H - 1 ? i + W : -1, x > 0 ? i - 1 : i + W - 1, x < W - 1 ? i + 1 : i - W + 1];
    for (const j of nbrs) {
      if (j < 0 || sea[j] || wall[j]) continue;
      sea[j] = 1;
      stack.push(j);
    }
  }
  let land = 0;
  for (let i = 0; i < W * H; i++) {
    const isLand = !sea[i];
    if (isLand) land++;
    const v = isLand ? 255 : 0;
    px[i * 4] = px[i * 4 + 1] = px[i * 4 + 2] = v;
    px[i * 4 + 3] = 255;
  }
  const frac = land / (W * H);
  // ~29 % of the surface is land, more in equirectangular because of the poles
  if (frac < 0.2 || frac > 0.5) return null;
  c.putImageData(img, 0, 0);
  // soften the coast so the shader can blend beaches
  const soft = document.createElement("canvas");
  soft.width = W;
  soft.height = H;
  const s = soft.getContext("2d")!;
  s.filter = "blur(1.5px)";
  s.drawImage(cv, 0, 0);
  return soft;
}

export const NOISE = /* glsl */ `
  float h3(vec3 p){ p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
  float n3(vec3 x){ vec3 i = floor(x); vec3 f = fract(x); f = f*f*(3.0-2.0*f);
    return mix(mix(mix(h3(i), h3(i+vec3(1,0,0)), f.x), mix(h3(i+vec3(0,1,0)), h3(i+vec3(1,1,0)), f.x), f.y),
               mix(mix(h3(i+vec3(0,0,1)), h3(i+vec3(1,0,1)), f.x), mix(h3(i+vec3(0,1,1)), h3(i+vec3(1,1,1)), f.x), f.y), f.z); }
  float fbm(vec3 p){ float a = 0.5, s = 0.0; for (int i = 0; i < 6; i++){ s += a * n3(p); p = p * 2.03 + 1.7; a *= 0.5; } return s; }
`;

/**
 * Earth surface in the Earth-fixed frame of the mesh: +Y north pole, longitude 0 toward +X,
 * longitude 90°E toward −Z (three.js SphereGeometry UVs).
 */
export function earthMaterial(night: THREE.Texture | null, land: THREE.Texture | null) {
  return new THREE.ShaderMaterial({
    uniforms: {
      uNight: { value: night },
      uLand: { value: land },
      uHasLand: { value: land ? 1 : 0 },
      uSun: { value: new THREE.Vector3(1, 0, 0) },
      uTime: { value: 0 },
      uExposure: { value: 1 },
    },
    vertexShader: /* glsl */ `
      varying vec3 vN; varying vec3 vW; varying vec2 vUv; varying vec3 vLocal;
      void main(){
        vUv = uv; vLocal = normalize(position);
        vN = normalize(mat3(modelMatrix) * normal);
        vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz;
        gl_Position = projectionMatrix * viewMatrix * w;
      }`,
    fragmentShader: /* glsl */ `
      uniform sampler2D uNight; uniform sampler2D uLand; uniform float uHasLand; uniform vec3 uSun; uniform float uTime; uniform float uExposure;
      varying vec3 vN; varying vec3 vW; varying vec2 vUv; varying vec3 vLocal;
      ${NOISE}
      void main(){
        vec3 N = normalize(vN);
        vec3 V = normalize(cameraPosition - vW);
        float sunD = dot(N, normalize(uSun));
        float day = smoothstep(-0.08, 0.18, sunD);
        float lat = asin(clamp(vLocal.y, -1.0, 1.0));
        float L = uHasLand > 0.5 ? texture2D(uLand, vUv).r : 0.0;
        vec3 p = vLocal * 3.0;
        float tex = fbm(p * 9.0);
        vec3 ocean = mix(vec3(0.010, 0.040, 0.105), vec3(0.020, 0.085, 0.190), fbm(p * 2.0));
        float alat = abs(lat);
        vec3 green = mix(vec3(0.07, 0.12, 0.04), vec3(0.16, 0.18, 0.08), tex);
        vec3 desert = mix(vec3(0.42, 0.33, 0.20), vec3(0.56, 0.45, 0.30), tex);
        float dry = smoothstep(0.17, 0.30, alat) * (1.0 - smoothstep(0.48, 0.62, alat)) * smoothstep(0.35, 0.7, fbm(p * 1.3 + 4.0));
        vec3 landC = mix(green, desert, dry);
        landC = mix(landC, vec3(0.85, 0.88, 0.92), smoothstep(1.08, 1.22, alat));
        vec3 surf = mix(ocean, landC, L);
        // clouds drift slowly
        vec3 cp = vLocal * 2.6 + vec3(uTime * 0.003, 0.0, uTime * 0.002);
        float cl = fbm(cp * 4.0 + fbm(cp * 2.0) * 1.5);
        float band = 0.55 + 0.25 * cos(lat * 6.0);
        float cloud = smoothstep(band, band + 0.22, cl);
        float lit = max(sunD, 0.0);
        vec3 col = surf * (0.04 + 1.2 * lit);
        // sun glint on the sea
        vec3 H = normalize(normalize(uSun) + V);
        col += (1.0 - L) * (1.0 - cloud) * pow(max(dot(N, H), 0.0), 120.0) * 1.6 * day;
        col = mix(col, vec3(0.95) * (0.05 + 1.15 * lit), cloud * 0.92);
        // city lights on the night side
        vec3 lights = texture2D(uNight, vUv).rgb;
        col += pow(lights, vec3(1.6)) * vec3(1.0, 0.82, 0.55) * 1.4 * (1.0 - day) * (1.0 - cloud * 0.7);
        // limb: Rayleigh blue on the day side, orange at the terminator
        float fres = pow(1.0 - max(dot(N, V), 0.0), 3.0);
        vec3 rim = mix(vec3(1.0, 0.45, 0.15), vec3(0.30, 0.55, 1.0), smoothstep(-0.05, 0.3, sunD));
        col += rim * fres * smoothstep(-0.25, 0.15, sunD) * 0.9;
        gl_FragColor = vec4(col * uExposure, 1.0);
      }`,
  });
}

/** thin glowing shell outside the planet */
export function atmosphereMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: { uSun: { value: new THREE.Vector3(1, 0, 0) }, uK: { value: 1 } },
    transparent: true,
    depthWrite: false,
    side: THREE.BackSide,
    blending: THREE.AdditiveBlending,
    vertexShader: /* glsl */ `
      varying vec3 vN; varying vec3 vW;
      void main(){ vN = normalize(mat3(modelMatrix) * normal); vec4 w = modelMatrix * vec4(position,1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uSun; uniform float uK; varying vec3 vN; varying vec3 vW;
      void main(){
        vec3 V = normalize(cameraPosition - vW);
        float rim = pow(clamp(1.0 + dot(normalize(vN), V) * 1.0, 0.0, 1.0), 4.0);
        float d = dot(normalize(vN), normalize(uSun));
        vec3 c = mix(vec3(1.0, 0.4, 0.15), vec3(0.32, 0.6, 1.0), smoothstep(-0.1, 0.35, d));
        gl_FragColor = vec4(c * rim * smoothstep(-0.35, 0.2, d) * 1.6 * uK, 1.0);
      }`,
  });
}
