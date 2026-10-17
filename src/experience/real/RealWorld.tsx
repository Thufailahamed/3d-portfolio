"use client";

import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useLayoutEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { FLOW_ORIGIN } from "@/lib/chapters";
import { rng } from "@/lib/random";
import { thunder } from "@/lib/sound";
import { useApp } from "@/store/useApp";
import { glowFrag, glowVert } from "../chapters/FlowGalleryDetails";
import { HeatKind } from "../thermal/heat";
import { type RealLib, setEnvironments } from "./materials";
import { realState, realUniforms } from "./realState";
import { HALL_ENV_SIZE, SKY_CUBE } from "./prewarm";
import { skyDisplayFrag, skyVert } from "./sky";
import { createSkyBakeMaterial, placeholderEnv } from "./skyMaterial";

const { damp, lerp, clamp } = THREE.MathUtils;
const ORIGIN = new THREE.Vector3(...FLOW_ORIGIN);
/** Centre of the whole complex in plan (pavilion-local); the sun's shadow box is centred on it. */
const SITE = new THREE.Vector3(2, 0, -14);
/** Hall centre, where the interior reflections are captured (pavilion-local). */
const HALL_EYE = new THREE.Vector3(0, 3.2, -19);
const GROUND_Y = -0.42;
const APPROACH_LAMPS = [
  { z: 7.5, h: 3.4 },
  { z: 12.0, h: 2.7 },
  { z: 16.5, h: 2.7 },
  { z: 21.0, h: 2.7 },
  { z: 25.5, h: 2.7 },
];

// horizon / fog colours per weather (linear, HDR), matched to the sky shader's horizon
const FOG = {
  day: new THREE.Color(0.66, 0.74, 0.86),
  night: new THREE.Color(0.012, 0.016, 0.03),
  rain: new THREE.Color(0.17, 0.18, 0.2),
};

// ---------------------------------------------------------------- ground
const groundVertPars = /* glsl */ `varying vec3 vGP;`;
const groundVert = /* glsl */ `
  #include <begin_vertex>
  vGP = (modelMatrix * vec4(transformed, 1.0)).xyz;
`;
const groundFragPars = /* glsl */ `
  varying vec3 vGP;
  uniform sampler2D uPaveA;
  uniform sampler2D uPaveB;
  uniform sampler2D uGrassA;
  uniform sampler2D uGrassB;
  uniform vec3 uOrigin;
  uniform float uWet;
  uniform float uRainFall;
  uniform float uTime;
  float gHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float gBox(vec2 p, vec2 b) { vec2 d = abs(p) - b; return length(max(d, 0.0)) + min(max(d.x, d.y), 0.0); }
  vec2 gRipples(vec2 xz, float t) {
    vec2 rp = xz * 3.0;
    vec2 rn = vec2(0.0);
    for (int j = 0; j < 2; j++) {
      vec2 off = vec2(float(j) * 0.5);
      vec2 cell = floor(rp + off);
      float h = gHash(cell + float(j) * 13.0);
      float tt = fract(t * 0.9 + h);
      vec2 c = cell + 0.25 + 0.5 * vec2(h, gHash(cell + 7.0)) - off;
      vec2 dv = rp - c;
      float d = length(dv);
      float ring = sin((d - tt * 0.7) * 38.0) * smoothstep(0.0, 0.1, tt * 0.7 - d + 0.12) * smoothstep(tt * 0.7 + 0.02, tt * 0.7 - 0.1, d);
      rn += dv / max(d, 1e-3) * ring * (1.0 - tt);
    }
    return rn;
  }
`;
const groundMap = /* glsl */ `
  vec2 gp = vGP.xz - uOrigin.xz;
  // forecourt in front of the portico and a terrace round the whole building
  float dFore = gBox(gp - vec2(0.0, 15.2), vec2(16.0, 15.4));
  float dTerr = gBox(gp - vec2(2.0, -19.6), vec2(33.6, 24.2));
  float dPave = min(dFore, dTerr);
  float pave = 1.0 - smoothstep(-0.03, 0.03, dPave);
  float curb = step(-0.32, dPave) * step(dPave, 0.0);
  // twin reflecting pools on the approach
  float dPool = gBox(vec2(abs(gp.x) - 7.6, gp.y - 16.0), vec2(3.4, 5.4));
  float water = step(dPool, -0.38);
  float coping = step(dPool, 0.0) * (1.0 - water);

  vec4 pa = texture2D(uPaveA, vGP.xz / 4.0);
  vec4 pb = texture2D(uPaveB, vGP.xz / 4.0);
  vec4 ga = texture2D(uGrassA, vGP.xz / 3.0);
  vec4 gb = texture2D(uGrassB, vGP.xz / 3.0);
  float big = texture2D(uGrassA, vGP.xz / 41.0).a;
  // mown stripes and broad tonal drift across the lawn
  float stripe = smoothstep(0.45, 0.55, abs(fract(gp.x / 6.0) - 0.5) * 2.0);
  vec3 grassAlb = ga.rgb * ga.rgb * mix(0.9, 1.08, stripe) * (0.82 + 0.36 * big);
  vec3 paveAlb = pa.rgb * pa.rgb;
  // darker granite band down the axis of the approach
  float axis = step(abs(gp.x), 1.8) * step(1.5, gp.y);
  paveAlb *= mix(1.0, 0.55, axis);
  paveAlb = mix(paveAlb, paveAlb * 1.18 + 0.03, max(curb, coping));

  float isPave = max(pave, coping);
  vec3 gAlb = mix(grassAlb, paveAlb, isPave);
  float gRough = mix(gb.b, pb.b, isPave);
  float gAO = mix(gb.a, pb.a, isPave);
  float gH = mix(ga.a, pa.a, isPave);
  vec2 tn = mix(gb.xy, pb.xy, isPave) * 2.0 - 1.0;
  vec3 gN = normalize(vec3(tn.x * 1.2, 1.0, tn.y * 1.2));

  // rain: wet, darker, puddles in the low spots of the paving
  float wet = uWet;
  float puddle = 0.0;
  if (wet > 0.001) {
    puddle = smoothstep(0.62, 0.42, pa.a * 0.5 + big * 0.8) * isPave * smoothstep(0.25, 0.85, wet);
    gAlb *= mix(1.0, 0.5, wet);
    gAlb *= mix(1.0, 0.7, puddle);
    gRough = mix(gRough, mix(0.5, 0.15, isPave), wet * 0.7);
    gRough = mix(gRough, 0.03, puddle);
    gN = normalize(mix(gN, vec3(0.0, 1.0, 0.0), max(puddle, wet * 0.4 * isPave)));
  }
  if (water > 0.5) {
    vec2 wp = gp * 1.4;
    vec2 g = vec2(cos(wp.x * 1.3 + uTime * 0.9 + sin(wp.y * 0.7)), cos(wp.y * 1.7 - uTime * 0.7 + sin(wp.x * 0.9))) * 0.025;
    gN = normalize(vec3(g.x, 1.0, g.y));
    gAlb = vec3(0.006, 0.012, 0.014);
    gRough = 0.02;
    gAO = 1.0;
    puddle = 1.0;
  }
  if (uRainFall > 0.01) {
    vec2 rn = gRipples(vGP.xz, uTime) * uRainFall * mix(0.06, 0.4, puddle) * isPave;
    rn += gRipples(vGP.xz * 0.7 + 3.0, uTime * 1.13) * uRainFall * 0.4 * water;
    gN = normalize(gN + vec3(rn.x, 0.0, rn.y));
  }
  diffuseColor.rgb *= gAlb;
`;

function makeGroundMaterial(lib: RealLib) {
  const m = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, metalness: 0 });
  const uniforms = {
    uPaveA: { value: lib.tex.paving.a },
    uPaveB: { value: lib.tex.paving.b },
    uGrassA: { value: lib.tex.grass.a },
    uGrassB: { value: lib.tex.grass.b },
    uOrigin: { value: ORIGIN },
    uWet: realUniforms.uWet,
    uRainFall: realUniforms.uRainFall,
    uTime: realUniforms.uTime,
  };
  m.onBeforeCompile = (s) => {
    Object.assign(s.uniforms, uniforms);
    s.vertexShader = s.vertexShader
      .replace("#include <common>", `#include <common>\n${groundVertPars}`)
      .replace("#include <begin_vertex>", groundVert);
    s.fragmentShader = s.fragmentShader
      .replace("#include <common>", `#include <common>\n${groundFragPars}`)
      .replace("#include <map_fragment>", groundMap)
      .replace("#include <roughnessmap_fragment>", "float roughnessFactor = clamp(gRough, 0.02, 1.0);")
      .replace("#include <normal_fragment_maps>", "normal = normalize((viewMatrix * vec4(gN, 0.0)).xyz);")
      .replace(
        "#include <aomap_fragment>",
        "#include <aomap_fragment>\n reflectedLight.indirectDiffuse *= gAO; reflectedLight.indirectSpecular *= mix(1.0, gAO, 0.5);",
      );
  };
  m.customProgramCacheKey = () => "real-ground-v1";
  m.userData.env = "sky";
  m.userData.heat = { kind: HeatKind.Ground };
  return m;
}

// ---------------------------------------------------------------- trees
/** Deterministic value noise in JS for displacing the foliage meshes. */
function makeNoise(seed: number) {
  const r = rng(seed);
  const perm = Array.from({ length: 256 }, () => r());
  const h = (x: number, y: number, z: number) => perm[(((x * 73856093) ^ (y * 19349663) ^ (z * 83492791)) >>> 0) % 256];
  const s = (t: number) => t * t * (3 - 2 * t);
  return (x: number, y: number, z: number) => {
    const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
    const xf = s(x - xi), yf = s(y - yi), zf = s(z - zi);
    const l = (a: number, b: number, t: number) => a + (b - a) * t;
    return l(
      l(l(h(xi, yi, zi), h(xi + 1, yi, zi), xf), l(h(xi, yi + 1, zi), h(xi + 1, yi + 1, zi), xf), yf),
      l(l(h(xi, yi, zi + 1), h(xi + 1, yi, zi + 1), xf), l(h(xi, yi + 1, zi + 1), h(xi + 1, yi + 1, zi + 1), xf), yf),
      zf,
    );
  };
}

function displace(g: THREE.BufferGeometry, amp: number, freq: number, seed: number) {
  const n = makeNoise(seed);
  const pos = g.getAttribute("position");
  const v = new THREE.Vector3();
  const c = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    c.set(0, v.y, 0);
    const dir = v.clone().sub(c);
    const len = dir.length();
    if (len < 1e-4) continue;
    dir.divideScalar(len);
    const k = (n(v.x * freq, v.y * freq, v.z * freq) - 0.5) * 2 + (n(v.x * freq * 2.7, v.y * freq * 2.7, v.z * freq * 2.7) - 0.5) * 0.6;
    v.addScaledVector(dir, k * amp * len);
    pos.setXYZ(i, v.x, v.y, v.z);
  }
  g.computeVertexNormals();
  return g;
}

/** Italian cypress: a tall flame of foliage, 1 unit high (scaled per instance). */
function cypressGeometry() {
  const pts: THREE.Vector2[] = [];
  for (let i = 0; i <= 18; i++) {
    const t = i / 18;
    const r = 0.13 * Math.pow(Math.sin(Math.PI * Math.min(t * 1.08, 1)), 0.75) * (1 - 0.35 * t) + (t < 0.03 ? 0.02 : 0);
    pts.push(new THREE.Vector2(Math.max(r, 0.004), t));
  }
  return displace(new THREE.LatheGeometry(pts, 20), 0.22, 9, 3);
}

function crownGeometry() {
  // welded first, so the displaced crown shades smoothly instead of as facets
  const g = mergeVertices(new THREE.IcosahedronGeometry(1, 3).deleteAttribute("normal").deleteAttribute("uv"));
  return displace(g, 0.28, 2.2, 11);
}

type Tree = { x: number; z: number; s: number; h: number; r: number };

function layoutTrees() {
  const r = rng(42);
  const cypress: Tree[] = [];
  // avenues of cypress outside the pools, along the forecourt
  for (const sx of [-1, 1]) for (let z = 3; z <= 28; z += 3.6) cypress.push({ x: sx * 18.2, z, s: 1, h: 0, r: r() });
  // flanking the building's ends and closing the view behind it
  for (let z = -40; z <= -2; z += 4.4) {
    cypress.push({ x: -37.5, z, s: 1, h: 0, r: r() });
    cypress.push({ x: 41.5, z, s: 1, h: 0, r: r() });
  }
  for (let x = -32; x <= 36; x += 4.5) cypress.push({ x, z: -48.5, s: 1, h: 0, r: r() });
  cypress.forEach((t) => {
    t.h = 7.5 + r() * 3.2;
    t.s = 0.9 + r() * 0.3;
  });
  // broadleaf parkland further out, clear of the approach
  const broad: Tree[] = [];
  let guard = 0;
  while (broad.length < 70 && guard++ < 2000) {
    const a = r() * Math.PI * 2;
    const d = 60 + r() * 55;
    const x = SITE.x + Math.cos(a) * d;
    const z = SITE.z + Math.sin(a) * d;
    if (Math.abs(x) < 22 && z > 0) continue;
    broad.push({ x, z, s: 0.8 + r() * 0.7, h: 0, r: r() });
  }
  return { cypress, broad };
}

// ---------------------------------------------------------------- rain
const rainVert = /* glsl */ `
  attribute vec4 aRand;
  attribute vec2 aCorner;
  uniform float uTime;
  uniform vec3 uBox;
  varying float vTail;
  varying float vFade;
  vec3 wrap(vec3 p) { return cameraPosition + mod(p - cameraPosition + 0.5 * uBox, uBox) - 0.5 * uBox; }
  void main() {
    float fall = uTime * (11.0 + 5.0 * aRand.w);
    vec3 vel = normalize(vec3(-0.16, -1.0, 0.05));
    vec3 p = wrap(aRand.xyz * uBox + vel * fall);
    vec3 right = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
    float len = 0.3 + 0.3 * aRand.w;
    vec4 mv0 = viewMatrix * vec4(p, 1.0);
    float width = 0.006 + 0.0012 * -mv0.z;
    p += -vel * len * aCorner.y + right * aCorner.x * width;
    vec4 mv = viewMatrix * vec4(p, 1.0);
    float dist = -mv.z;
    vFade = smoothstep(0.4, 1.5, dist) * (1.0 - smoothstep(10.0, 19.0, dist));
    vTail = aCorner.y;
    gl_Position = projectionMatrix * mv;
  }
`;
const rainFrag = /* glsl */ `
  uniform float uRain;
  uniform float uFlash;
  uniform vec3 uTint;
  varying float vTail;
  varying float vFade;
  void main() {
    float a = uRain * vFade * (1.0 - vTail * 0.85) * (0.28 + uFlash * 0.6);
    gl_FragColor = vec4(uTint * a, a);
  }
`;

// ---------------------------------------------------------------- component

/**
 * Everything the realistic pavilion adds around the model: the sky and its reflections, the
 * weather (eased mix, wetness, lightning, meteors), sun / moon with shadows, night lighting,
 * and the landscape (paved forecourt, striped lawn, reflecting pools, hedges, cypress avenues,
 * parkland, lamp posts) plus the rain itself.
 */
export default function RealWorld({ lib, live }: { lib: RealLib; live: boolean }) {
  const gl = useThree((s) => s.gl);
  const scene = useThree((s) => s.scene);
  const isMobile = useApp((s) => s.isMobile);
  const root = useRef<THREE.Group>(null);
  const dome = useRef<THREE.Mesh>(null);
  const sun = useRef<THREE.DirectionalLight>(null);
  const hemi = useRef<THREE.HemisphereLight>(null);
  const rainMesh = useRef<THREE.Mesh>(null);
  const floods = useRef<(THREE.SpotLight | null)[]>([]);
  const lampLights = useRef<(THREE.PointLight | null)[]>([]);
  const hallLights = useRef<(THREE.PointLight | null)[]>([]);

  const skyMat = useMemo(() => createSkyBakeMaterial(), []);

  // The sky is expensive: bake it into an HDR cube (one face per frame) and let the dome and
  // the reflections sample that
  const env = useMemo(() => {
    const pmrem = new THREE.PMREMGenerator(gl);
    const skyScene = new THREE.Scene();
    const m = new THREE.Mesh(new THREE.SphereGeometry(50, 48, 24), skyMat);
    m.frustumCulled = false;
    skyScene.add(m);
    const cube = new THREE.WebGLCubeRenderTarget(isMobile ? SKY_CUBE.mobile : SKY_CUBE.desktop, {
      type: THREE.HalfFloatType,
      generateMipmaps: false,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
    });
    const cam = new THREE.CubeCamera(0.1, 100, cube);
    skyScene.add(cam);
    return {
      pmrem,
      skyScene,
      cube,
      cam,
      face: 0,
      tick: 0,
      warm: 0,
      sky: null as THREE.WebGLRenderTarget | null,
      hall: null as THREE.WebGLRenderTarget | null,
    };
  }, [gl, skyMat, isMobile]);

  const displayMat = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader: skyVert,
        fragmentShader: skyDisplayFrag,
        side: THREE.BackSide,
        depthWrite: false,
        depthTest: false,
        fog: false,
        uniforms: {
          uSky: { value: env.cube.texture },
          uNight: { value: 1 },
          uRain: { value: 0 },
          uTime: { value: 0 },
          uFlash: { value: 0 },
          uFlashDir: { value: new THREE.Vector3(0, 0.4, -1).normalize() },
          uMeteorA: { value: new THREE.Vector4(0, 1, 0, -1) },
          uMeteorB: { value: new THREE.Vector3(0, 1, 0) },
        },
      }),
    [env],
  );

  const groundMat = useMemo(() => makeGroundMaterial(lib), [lib]);


  const trees = useMemo(() => {
    const { cypress, broad } = layoutTrees();
    const cg = cypressGeometry();
    const crown = crownGeometry();
    const trunk = new THREE.CylinderGeometry(0.14, 0.24, 1, 8).translate(0, 0.5, 0);
    const mk = (geo: THREE.BufferGeometry, mat: THREE.Material, list: Tree[], f: (t: Tree, m: THREE.Matrix4) => void) => {
      const im = new THREE.InstancedMesh(geo, mat, list.length);
      const mtx = new THREE.Matrix4();
      list.forEach((t, i) => {
        f(t, mtx);
        im.setMatrixAt(i, mtx);
      });
      im.castShadow = true;
      im.receiveShadow = true;
      im.frustumCulled = false;
      return im;
    };
    const q = new THREE.Quaternion();
    const up = new THREE.Vector3(0, 1, 0);
    const cyp = mk(cg, lib.foliage, cypress, (t, m) =>
      m.compose(new THREE.Vector3(t.x, GROUND_Y, t.z), q.setFromAxisAngle(up, t.r * 6.28), new THREE.Vector3(t.s * 7, t.h, t.s * 7)),
    );
    const crowns = mk(crown, lib.foliage, broad, (t, m) =>
      m.compose(new THREE.Vector3(t.x, GROUND_Y + 3.6 * t.s + 2.2 * t.s, t.z), q.setFromAxisAngle(up, t.r * 6.28), new THREE.Vector3(3.6 * t.s, 2.9 * t.s, 3.6 * t.s)),
    );
    const trunks = mk(trunk, lib.bark, broad, (t, m) =>
      m.compose(new THREE.Vector3(t.x, GROUND_Y, t.z), q.identity(), new THREE.Vector3(t.s * 1.2, 4.2 * t.s, t.s * 1.2)),
    );
    return { cyp, crowns, trunks, geos: [cg, crown, trunk] };
  }, [lib]);

  // clipped box hedges framing the forecourt (open at the front for the approach)
  const hedges = useMemo(() => {
    const parts: THREE.BufferGeometry[] = [];
    const add = (w: number, d: number, x: number, z: number) => parts.push(new THREE.BoxGeometry(w, 1.1, d).translate(x, GROUND_Y + 0.55, z));
    for (const s of [-1, 1]) {
      add(0.9, 29, s * 16.6, 15.2);
      add(11.5, 0.9, s * 10.6, 30.9);
    }
    const g = mergeAll(parts);
    return g;
  }, []);

  const lamps = useMemo(() => {
    const post = new THREE.CylinderGeometry(0.045, 0.06, 1, 12).translate(0, 0.5, 0);
    const base = new THREE.CylinderGeometry(0.13, 0.16, 0.42, 16).translate(0, 0.21, 0);
    const cage = new THREE.CylinderGeometry(0.15, 0.11, 0.42, 6, 1, true);
    const cap = new THREE.ConeGeometry(0.2, 0.2, 6).translate(0, 0.31, 0);
    const glow = new THREE.SphereGeometry(0.1, 16, 12);
    return { post, base, cage, cap, glow };
  }, []);

  const mats = useMemo(
    () => ({
      bulb: new THREE.MeshBasicMaterial({ color: new THREE.Color(1, 0.78, 0.5), toneMapped: false }),
      lampGlass: new THREE.MeshStandardMaterial({
        color: 0xf2efe8,
        emissive: new THREE.Color(1, 0.74, 0.42),
        emissiveIntensity: 0,
        roughness: 0.08,
        transparent: true,
        opacity: 0.28,
        side: THREE.DoubleSide,
        depthWrite: false,
      }),
      pool: new THREE.ShaderMaterial({
        vertexShader: glowVert,
        fragmentShader: glowFrag,
        uniforms: { uColor: { value: new THREE.Color("#ffb46a") }, uIntensity: { value: 0 }, uMode: { value: 0 } },
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    }),
    [],
  );

  const rain = useMemo(() => {
    const n = isMobile ? 2600 : 7000;
    const random = rng(97);
    const rand = new Float32Array(n * 4 * 4);
    const corner = new Float32Array(n * 4 * 2);
    const index: number[] = [];
    for (let i = 0; i < n; i++) {
      const r = [random(), random(), random(), random()];
      for (let k = 0; k < 4; k++) {
        rand.set(r, (i * 4 + k) * 4);
        corner.set([k % 2 ? 1 : -1, k < 2 ? 0 : 1], (i * 4 + k) * 2);
      }
      const v = i * 4;
      index.push(v, v + 1, v + 2, v + 2, v + 1, v + 3);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(n * 4 * 3), 3));
    g.setAttribute("aRand", new THREE.BufferAttribute(rand, 4));
    g.setAttribute("aCorner", new THREE.BufferAttribute(corner, 2));
    g.setIndex(index);
    const m = new THREE.ShaderMaterial({
      vertexShader: rainVert,
      fragmentShader: rainFrag,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: {
        uTime: realUniforms.uTime,
        uBox: { value: new THREE.Vector3(26, 16, 26) },
        uRain: { value: 0 },
        uFlash: realUniforms.uFlash,
        uTint: { value: new THREE.Color(0.75, 0.8, 0.88) },
      },
    });
    return { g, m };
  }, [isMobile]);

  // to the thermal binoculars: the dome is the sky, the lamps are heat sources (switched by night)
  useEffect(() => {
    displayMat.userData.heat = { kind: HeatKind.Sky };
    mats.bulb.userData.heat = { kind: HeatKind.Emitter, heat: 90 };
    mats.lampGlass.userData.heat = { kind: HeatKind.Emitter, heat: 55 };
  }, [displayMat, mats]);

  // shadows on while the realistic pavilion is mounted (before the programs are compiled)
  useLayoutEffect(() => {
    const prev = { enabled: gl.shadowMap.enabled, type: gl.shadowMap.type };
    gl.shadowMap.enabled = true;
    // PCF (r186 draws PCFSoft as PCF anyway, and the compiled programs must match what is drawn)
    gl.shadowMap.type = THREE.PCFShadowMap;
    return () => {
      gl.shadowMap.enabled = prev.enabled;
      gl.shadowMap.type = prev.type;
    };
  }, [gl]);

  useLayoutEffect(() => {
    realState.active = true;
    realState.skyScene = env.skyScene;
    realState.skyCamera = env.cam.children[0] as THREE.Camera;
    realState.root = root.current;
    // stand-in reflections of the final kind and size, so the programs compiled before going live
    // already have their environment-map variant (assigning one later would recompile them); the
    // real maps replace them on the first live frame, before anything is drawn with them
    if (!env.sky) setEnvironments([...lib.all, groundMat, mats.lampGlass], placeholderEnv(env.cube.width), placeholderEnv(HALL_ENV_SIZE), 1, 1.1);
    return () => {
      realState.active = false;
      realState.skyScene = null;
      realState.skyCamera = null;
      realState.root = null;
    };
  }, [env, lib, groundMat, mats]);

  useEffect(
    () => () => {
      skyMat.dispose();
      displayMat.dispose();
      env.cube.dispose();
      env.sky?.dispose();
      env.hall?.dispose();
      env.pmrem.dispose();
      (env.skyScene.children[0] as THREE.Mesh).geometry.dispose();
      groundMat.dispose();
      trees.geos.forEach((g) => g.dispose());
      trees.cyp.dispose();
      trees.crowns.dispose();
      trees.trunks.dispose();
      hedges.dispose();
      Object.values(lamps).forEach((g) => g.dispose());
      Object.values(mats).forEach((m) => m.dispose());
      rain.g.dispose();
      rain.m.dispose();
    },
    [skyMat, displayMat, env, groundMat, trees, hedges, lamps, mats, rain],
  );

  // eased weather, lightning and meteors
  const sim = useMemo(() => {
    // open on the visitor's weather; only later changes are eased
    const w = useApp.getState().weather;
    return {
      day: w === "day" ? 1 : 0,
      night: w === "night" ? 1 : 0,
      rain: w === "rain" ? 1 : 0,
      wet: w === "rain" ? 1 : 0,
      bolt: { next: 4, t: -1, random: rng(5) },
      meteor: { next: 3, t: -1, a: new THREE.Vector3(), b: new THREE.Vector3(), random: rng(17) },
      envClock: 0,
      envDirty: true,
      hallFrames: 0,
      shadowFrames: 90,
      shadowClock: 0,
      settled: false,
      last: "",
    };
  }, []);

  const tmp = useMemo(() => ({ v: new THREE.Vector3(), c: new THREE.Color(), dir: new THREE.Vector3() }), []);

  useFrame((state, dt) => {
    // nothing renders (sky bake, reflections, shadows) until the programs are compiled
    if (!live) return;
    const step = Math.min(dt, 0.1);
    const w = useApp.getState().weather;
    const target = { day: w === "day" ? 1 : 0, night: w === "night" ? 1 : 0, rain: w === "rain" ? 1 : 0 };
    if (w !== sim.last) {
      sim.last = w;
      sim.settled = false;
    }
    sim.day = damp(sim.day, target.day, 1.6, step);
    sim.night = damp(sim.night, target.night, 1.6, step);
    sim.rain = damp(sim.rain, target.rain, 1.6, step);
    const moving = Math.abs(sim.day - target.day) + Math.abs(sim.night - target.night) + Math.abs(sim.rain - target.rain) > 0.004;
    // surfaces soak quickly in the rain and dry out slowly after it
    sim.wet = target.rain ? Math.min(1, sim.wet + step * 0.35) : Math.max(0, sim.wet - step * 0.06);
    realState.day = sim.day;
    realState.night = sim.night;
    realState.rain = sim.rain;

    const time = state.clock.elapsedTime;
    realUniforms.uTime.value = time;
    realUniforms.uWet.value = sim.wet;
    realUniforms.uRainFall.value = sim.rain;
    realUniforms.uNight.value = sim.night;

    // lightning in the storm: a double flash, now and then, with thunder a moment later
    const bolt = sim.bolt;
    bolt.next -= step;
    if (sim.rain > 0.6 && bolt.next < 0 && bolt.t < 0) {
      bolt.t = 0;
      bolt.next = 5 + bolt.random() * 9;
      const a = bolt.random() * Math.PI * 2;
      displayMat.uniforms.uFlashDir.value.set(Math.cos(a), 0.25 + bolt.random() * 0.35, Math.sin(a)).normalize();
      if (useApp.getState().sound) thunder(0.6 + bolt.random() * 1.8);
    }
    let flash = 0;
    if (bolt.t >= 0) {
      const t = (bolt.t += step);
      flash = Math.exp(-t * 14) + (t > 0.16 ? 0.75 * Math.exp(-(t - 0.16) * 7) : 0);
      if (t > 1.2) bolt.t = -1;
    }
    flash *= sim.rain;
    realState.flash = flash;
    realUniforms.uFlash.value = flash;

    // a shooting star every so often on a clear night
    const met = sim.meteor;
    met.next -= step;
    if (sim.night > 0.6 && met.next < 0 && met.t < 0) {
      met.t = 0;
      met.next = 6 + met.random() * 10;
      const az = -1.9 + met.random() * 1.6;
      const el = 0.35 + met.random() * 0.4;
      met.a.set(Math.cos(az) * Math.cos(el), Math.sin(el), Math.sin(az) * Math.cos(el));
      met.b.set(Math.cos(az + 0.35) * Math.cos(el - 0.22), Math.sin(el - 0.22), Math.sin(az + 0.35) * Math.cos(el - 0.22));
    }
    const mu = displayMat.uniforms.uMeteorA.value as THREE.Vector4;
    if (met.t >= 0) {
      met.t += step / 0.9;
      mu.set(met.a.x, met.a.y, met.a.z, met.t);
      (displayMat.uniforms.uMeteorB.value as THREE.Vector3).copy(met.b);
      if (met.t > 1) met.t = -1;
    } else mu.w = -1;

    // sky
    const u = skyMat.uniforms;
    u.uDay.value = sim.day;
    u.uNight.value = sim.night;
    u.uRain.value = sim.rain;
    u.uTime.value = time;
    const du = displayMat.uniforms;
    du.uNight.value = sim.night;
    du.uRain.value = sim.rain;
    du.uTime.value = time;
    du.uFlash.value = flash;
    const fogC = tmp.c
      .setRGB(0, 0, 0)
      .add(FOG.day.clone().multiplyScalar(sim.day))
      .add(FOG.night.clone().multiplyScalar(sim.night))
      .lerp(FOG.rain, sim.rain);
    u.uFog.value.copy(fogC);
    const fog = scene.fog as THREE.FogExp2 | null;
    if (fog) {
      fog.color.copy(fogC).lerp(new THREE.Color(0.5, 0.55, 0.65), flash * 0.25);
      // rain closes the view in; BuildingFlow sets the base density for the view
      fog.density *= 1 + sim.rain * 0.012 * step * 60;
    }
    if (dome.current && root.current) {
      root.current.worldToLocal(dome.current.position.copy(state.camera.position));
    }

    // sun by day, moon by night (one light), overcast in the storm
    const L = tmp.dir.copy(realState.sunDir).multiplyScalar(sim.day + sim.rain * 0.7).addScaledVector(realState.moonDir, sim.night).normalize();
    if (sun.current) {
      const s = sun.current;
      s.position.copy(SITE).addScaledVector(L, 90);
      // the target sits outside the scene graph, so it takes world coordinates
      if (root.current) root.current.localToWorld(s.target.position.copy(SITE));
      s.target.updateMatrixWorld();
      s.intensity = sim.day * 6.5 + sim.night * 0.45 + sim.rain * 0.35 + flash * 2.5;
      s.color.setRGB(1, 0.94, 0.85).multiplyScalar(sim.day).add(tmp.c.setRGB(0.58, 0.68, 1).multiplyScalar(sim.night)).add(tmp.c.setRGB(0.8, 0.84, 0.9).multiplyScalar(sim.rain));
      s.shadow.radius = 2 + sim.rain * 10;
      sim.shadowClock -= step;
      if (sim.shadowFrames > 0 || (moving && sim.shadowClock <= 0)) {
        s.shadow.needsUpdate = true;
        sim.shadowClock = 0.25;
      }
      if (sim.shadowFrames > 0) sim.shadowFrames--;
    }
    if (hemi.current) {
      const h = hemi.current;
      h.intensity = sim.day * 0.12 + sim.night * 0.06 + sim.rain * 0.55 + flash * 3.0;
      h.color.setRGB(0.62, 0.72, 0.9).multiplyScalar(sim.day).add(tmp.c.setRGB(0.25, 0.32, 0.55).multiplyScalar(sim.night)).add(tmp.c.setRGB(0.6, 0.64, 0.7).multiplyScalar(sim.rain));
      h.groundColor.setRGB(0.32, 0.28, 0.22).multiplyScalar(sim.day + sim.rain * 0.6).add(tmp.c.setRGB(0.05, 0.04, 0.03).multiplyScalar(sim.night));
    }
    // artificial light comes up as the daylight goes
    const dark = clamp(sim.night + sim.rain * 0.7, 0, 1);
    floods.current.forEach((f) => {
      if (!f) return;
      f.intensity = 520 * dark;
      if (root.current) root.current.localToWorld(f.target.position.fromArray(f.userData.aim));
      f.target.updateMatrixWorld();
    });
    lampLights.current.forEach((l) => l && (l.intensity = 22 * dark));
    hallLights.current.forEach((l) => l && (l.intensity = lerp(26, 42, dark)));
    mats.lampGlass.emissiveIntensity = 4.5 * dark;
    mats.bulb.color.setRGB(1, 0.78, 0.5).multiplyScalar(0.04 + 1.6 * dark);
    mats.pool.uniforms.uIntensity.value = 0.55 * dark;
    lib.windowGlass.emissiveIntensity = 1.3 * dark;

    if (rainMesh.current) rainMesh.current.visible = sim.rain > 0.01;
    rain.m.uniforms.uRain.value = sim.rain;

    // bake the sky: all six faces at once the first time, then a face every few frames as the clouds drift
    // (the first frames bake every face: the program may still be compiling on the first one)
    if (env.warm < 10) {
      env.cam.update(gl, env.skyScene);
      if (++env.warm === 10) sim.envDirty = true;
    } else if (++env.tick % 6 === 0 || moving) {
      const prev = gl.getRenderTarget();
      const cams = env.cam.children as THREE.Camera[];
      gl.setRenderTarget(env.cube, env.face);
      gl.render(env.skyScene, cams[env.face]);
      gl.setRenderTarget(prev);
      env.face = (env.face + 1) % 6;
    }

    // reflections: the sky's PMREM follows the weather; the hall is captured once it settles
    sim.envClock -= step;
    if (sim.envClock <= 0 || sim.envDirty) {
      sim.envClock = moving ? 0.5 : 8;
      if (sim.envDirty) sim.hallFrames = 0;
      sim.envDirty = false;
      const rt = env.pmrem.fromCubemap(env.cube.texture);
      env.sky?.dispose();
      env.sky = rt;
    }
    if (!moving && !sim.settled) {
      sim.settled = true;
      sim.envDirty = true;
    }
    sim.hallFrames++;
    if (sim.hallFrames === 30 && root.current) {
      // the hall's own reflections: one capture from the middle of the nave
      const pos = root.current.localToWorld(tmp.v.copy(HALL_EYE));
      const was = rainMesh.current?.visible ?? false;
      if (rainMesh.current) rainMesh.current.visible = false;
      const rt = env.pmrem.fromScene(scene, 0, 0.1, 120, { size: HALL_ENV_SIZE, position: pos.clone() });
      if (rainMesh.current) rainMesh.current.visible = was;
      env.hall?.dispose();
      env.hall = rt;
    }
    // until the hall has been captured, an empty map of the same size keeps its materials' variant
    if (!env.hall) env.hall = env.pmrem.fromScene(new THREE.Scene(), 0, 0.1, 1, { size: HALL_ENV_SIZE });
    setEnvironments([...lib.all, groundMat, mats.lampGlass], env.sky?.texture ?? null, env.hall.texture, sim.day * 0.3 + sim.night * 1.0 + sim.rain * 0.55, 1.1);
  });

  const shadowSize = isMobile ? 1024 : 2048;

  return (
    <group ref={root} visible={live}>
      {/* Sky dome: follows the camera, drawn behind everything */}
      <mesh ref={dome} material={displayMat} renderOrder={-100} frustumCulled={false}>
        <sphereGeometry args={[600, 64, 32]} />
      </mesh>

      {/* Sun / moon, with the site's shadows */}
      <directionalLight
        ref={sun}
        castShadow
        shadow-mapSize-width={shadowSize}
        shadow-mapSize-height={shadowSize}
        shadow-camera-left={-58}
        shadow-camera-right={58}
        shadow-camera-top={58}
        shadow-camera-bottom={-58}
        shadow-camera-near={1}
        shadow-camera-far={220}
        shadow-bias={-0.00025}
        shadow-normalBias={0.035}
        shadow-autoUpdate={false}
      />
      <hemisphereLight ref={hemi} />

      {/* Night floodlighting washing up the portico columns */}
      {[-1, 1].map((s, i) => (
        <spotLight
          key={s}
          ref={(l) => {
            floods.current[i] = l;
          }}
          userData={{ aim: [s * 3.2, 9.5, -0.6] }}
          position={[s * 4.5, 0.3, 9.5]}
          color="#ffd2a1"
          angle={0.62}
          penumbra={0.75}
          decay={2}
          intensity={0}
        />
      ))}

      {/* Warm light from the lamps nearest the portal */}
      {[-3.2, 3.2].flatMap((x, i) =>
        [7.5].map((z) => (
          <pointLight
            key={`${x}${z}`}
            ref={(l) => {
              lampLights.current[i] = l;
            }}
            position={[x, 3.3, z]}
            color="#ffb877"
            distance={20}
            decay={2}
            intensity={0}
          />
        )),
      )}

      {/* The hall's lighting */}
      {[-7, -18, -29].map((z, i) => (
        <pointLight
          key={z}
          ref={(l) => {
            hallLights.current[i] = l;
          }}
          position={[0, 6.4, z]}
          color="#ffdcb0"
          distance={22}
          decay={2}
          intensity={30}
        />
      ))}

      {/* Ground: forecourt paving, terrace, lawn and pools */}
      <mesh rotation-x={-Math.PI / 2} position={[0, GROUND_Y, -14]} material={groundMat} receiveShadow>
        <planeGeometry args={[700, 700, 1, 1]} />
      </mesh>
      <mesh geometry={hedges} material={lib.foliage} castShadow receiveShadow />
      <primitive object={trees.cyp} />
      <primitive object={trees.crowns} />
      <primitive object={trees.trunks} />

      {/* Lamp posts along the approach */}
      {APPROACH_LAMPS.flatMap(({ z, h }) =>
        [-3.2, 3.2].map((x) => (
          <group key={`${x}:${z}`} position={[x, GROUND_Y, z]}>
            <mesh geometry={lamps.base} material={lib.blackMetal} castShadow />
            <mesh geometry={lamps.post} material={lib.blackMetal} scale={[1, h - GROUND_Y - 0.3, 1]} castShadow />
            <group position={[0, h - GROUND_Y - 0.08, 0]}>
              <mesh geometry={lamps.cage} material={mats.lampGlass} />
              <mesh geometry={lamps.cap} material={lib.blackMetal} castShadow />
              <mesh geometry={lamps.glow} material={mats.bulb} />
            </group>
            <mesh rotation-x={-Math.PI / 2} position={[0, 0.02, 0]} material={mats.pool}>
              <planeGeometry args={[6, 6]} />
            </mesh>
          </group>
        )),
      )}

      <mesh ref={rainMesh} geometry={rain.g} material={rain.m} frustumCulled={false} renderOrder={7} visible={false} />
    </group>
  );
}

function mergeAll(parts: THREE.BufferGeometry[]) {
  // boxes only carry position / normal / uv; merging keeps them in one draw call
  const g = parts.length === 1 ? parts[0] : mergeGeometries(parts);
  parts.forEach((p) => p !== g && p.dispose());
  return g;
}

import { mergeGeometries, mergeVertices } from "three/examples/jsm/utils/BufferGeometryUtils.js";
