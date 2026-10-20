/**
 * Bending the real models by the solver's crush, in the vertex shader of every material.
 *
 * The crush lives in a small per-car texture: NS samples round the outline × NB height bands, with
 * the skin's offset e (static), the surface crush C, the consumed depth L and the damage D. A vertex
 * takes two components from it, the way a corner sample of the solver crushes along its diagonal:
 * along x from the nose or tail at its z (the face, or the corner arc at that z), and along z from
 * the flank at its x (the flank, or the arc at that x). Inside the consumed layer (depth below the
 * skin d < L) the material compacts — the vertex moves in by C·(1 − d/L) — and behind it nothing
 * moves. Within the layer the sheet buckles along its own normal (folds a few centimetres long that
 * bunch as it compacts; carbon fractures into facets instead), and normals come from finite
 * differences of the same displacement so every fold catches the light. The folds and scuffs are
 * procedural; how far and where the car crushes is the solver's.
 */
import * as THREE from "three";
import type { CarInstance } from "@/components/showroom/carModel";
import { BAND_MID, GEOMETRY_GLSL } from "../sim/geometry";
import { NB, NS, type BodyDef } from "../sim/types";

export type CrushUniforms = {
  uCrush: THREE.IUniform<THREE.DataTexture>;
  uPlan: THREE.IUniform<THREE.Vector4>;
  uPlanC: THREE.IUniform<THREE.Vector2>;
  uBandMid: THREE.IUniform<number[]>;
  uCarInv: THREE.IUniform<THREE.Matrix4>;
  uCarMat: THREE.IUniform<THREE.Matrix4>;
  /** how the body fails: 0 steel folds, 1 aluminium folds sharper and tears, 2 composite / carbon fractures */
  uFail: THREE.IUniform<number>;
  /** 0 until anything has crushed (the shaders skip the work) */
  uCrushOn: THREE.IUniform<number>;
  uHood: THREE.IUniform<THREE.Vector4>;
  uHoodZ: THREE.IUniform<THREE.Vector2>;
};

/** Photogrammetry targets: centre (car frame), radius, and the axis the panel faces (0 +y, 1 −z, 2 +z, 3 +x, 4 −x). */
export type Marker = { at: [number, number, number]; r: number; axis: number };
export const MAX_MARKERS = 12;

const pars = /* glsl */ `
  uniform sampler2D uCrush;
  uniform mat4 uCarInv;
  uniform mat4 uCarMat;
  uniform float uFail;
  uniform float uCrushOn;
  uniform vec4 uHood;   // bonnet: x from, x to, the height below which nothing tents, the tent height (m)
  uniform vec2 uHoodZ;  // bonnet half width, tent peak position along it (0 rear … 1 front)
  varying vec3 vCarPos0;
  varying vec3 vCarN0;
  varying float vDamage;
  ${GEOMETRY_GLSL}
  float crHash(vec3 p) {
    p = fract(p * 0.3183099 + vec3(0.71, 0.113, 0.419));
    p *= 17.0;
    return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
  }
  float crNoise(vec3 x) {
    vec3 i = floor(x), f = fract(x);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(mix(crHash(i), crHash(i + vec3(1, 0, 0)), f.x), mix(crHash(i + vec3(0, 1, 0)), crHash(i + vec3(1, 1, 0)), f.x), f.y),
               mix(mix(crHash(i + vec3(0, 0, 1)), crHash(i + vec3(1, 0, 1)), f.x), mix(crHash(i + vec3(0, 1, 1)), crHash(i + vec3(1, 1, 1)), f.x), f.y), f.z);
  }
  // one component of the crush: the texel at (u, band) gives e, C, L, D; depth below the skin along
  // the axis is dSkin; the component's share of the sample's normal is w
  float crComp(float u, float v, float depthToRect, float w, out float dmg, out float layer, out float comp) {
    vec4 t = texture2D(uCrush, vec2(u, v));
    float C = t.g * w, L = max(t.b * w, C + 1e-4);
    float d = depthToRect - t.r * w;
    comp = 0.0;
    layer = 0.0;
    dmg = 0.0;
    if (t.r > 8.0 || C < 1e-4) return 0.0;
    float dd = max(d, 0.0);
    if (dd >= L) return 0.0;
    layer = dd / L;
    comp = C / L;
    dmg = t.a * (1.0 - layer);
    return C * (1.0 - layer);
  }
  // the displacement (car frame) of a car-frame point, and the fold phase inputs
  vec3 crushDisp(vec3 p, vec3 n, out float damage) {
    damage = 0.0;
    float hx = uPlan.x, hz = uPlan.y, rc = uPlan.z;
    vec2 q2 = p.xz - uPlanC;
    float a = hx - rc, b = hz - rc, qa = 1.5707963 * rc;
    float P = 4.0 * a + 4.0 * b + 6.2831853 * rc;
    float sx = q2.x >= 0.0 ? 1.0 : -1.0, sz = q2.y >= 0.0 ? 1.0 : -1.0;
    float ax = abs(q2.x), az = abs(q2.y);
    float v = bandV(p.y);
    vec3 disp = vec3(0.0);
    float dmg, layer, comp, folds = 0.0, foldW = 0.0;

    // along x: the nose or the tail at this z (the straight face, or the corner arc where |z| > b)
    if (az <= hz) {
      float u, w = 1.0, skinRect;
      if (az <= b) {
        u = q2.x >= 0.0 ? (q2.y >= 0.0 ? q2.y : P + q2.y) : b + 2.0 * qa + 2.0 * a + (b - q2.y);
        skinRect = hx - ax;
      } else {
        float f = asin(clamp((az - b) / max(rc, 1e-4), 0.0, 1.0));
        w = cos(f);
        // the arc's own parameter for that corner
        u = q2.x >= 0.0 ? (q2.y >= 0.0 ? b + f * rc : 3.0 * b + 3.0 * qa + 4.0 * a + (1.5707963 - f) * rc)
                        : (q2.y >= 0.0 ? b + qa + 2.0 * a + (1.5707963 - f) * rc : 3.0 * b + 2.0 * qa + 2.0 * a + f * rc);
        skinRect = (a + rc * w) - ax;
      }
      float c = crComp(fract(u / P), v, skinRect, max(w, 1e-3), dmg, layer, comp);
      disp.x -= sx * c;
      damage = max(damage, dmg);
      if (c > 0.0) { folds += sin(3.14159 * layer) * sqrt(comp) * (layer * 9.0); foldW = max(foldW, sin(3.14159 * layer) * sqrt(comp)); }
    }
    // along z: the flank at this x (the straight side, or the arc where |x| > a)
    if (ax <= hx) {
      float u, w = 1.0, skinRect;
      if (ax <= a) {
        u = q2.y >= 0.0 ? b + qa + (a - q2.x) : 3.0 * b + 3.0 * qa + 2.0 * a + (q2.x + a);
        skinRect = hz - az;
      } else {
        float f = acos(clamp((ax - a) / max(rc, 1e-4), 0.0, 1.0));
        w = sin(f);
        u = q2.x >= 0.0 ? (q2.y >= 0.0 ? b + f * rc : 3.0 * b + 3.0 * qa + 4.0 * a + (1.5707963 - f) * rc)
                        : (q2.y >= 0.0 ? b + qa + 2.0 * a + (1.5707963 - f) * rc : 3.0 * b + 2.0 * qa + 2.0 * a + f * rc);
        skinRect = (b + rc * w) - az;
      }
      float c = crComp(fract(u / P), v, skinRect, max(w, 1e-3), dmg, layer, comp);
      disp.z -= sz * c;
      damage = max(damage, dmg);
      if (c > 0.0) { folds += sin(3.14159 * layer) * sqrt(comp) * (layer * 9.0); foldW = max(foldW, sin(3.14159 * layer) * sqrt(comp)); }
    }
    // the sheet buckles out of its own plane inside the consumed layer
    if (foldW > 0.0) {
      float lambda = uFail > 1.5 ? 0.05 : uFail > 0.5 ? 0.05 : 0.075;
      float ph = dot(p, vec3(1.0, 0.7, 1.0)) / lambda * 6.2831853 + crNoise(p * 9.0) * 4.0;
      float wave = uFail > 1.5 ? (abs(fract(ph / 6.2831853) - 0.5) * 4.0 - 1.0) * (0.6 + 0.8 * crNoise(p * 31.0)) : sin(ph);
      disp += n * wave * foldW * lambda * (uFail > 1.5 ? 0.12 : 0.18);
    }
    // the bonnet tents up in an inverted V as it loses length (and the boot lid likewise, mirrored)
    if (uHood.w > 0.002 && p.x > uHood.x && p.x < uHood.y && p.y > uHood.z) {
      float xn = (p.x - uHood.x) / (uHood.y - uHood.x);
      float pk = uHoodZ.y;
      float tri = xn < pk ? xn / pk : (1.0 - xn) / (1.0 - pk);
      float lat = sqrt(max(0.0, 1.0 - pow(abs(q2.y) / uHoodZ.x, 2.0)));
      disp.y += uHood.w * pow(clamp(tri, 0.0, 1.0), 0.8) * lat;
    }
    return disp;
  }
`;

const vertexMain = /* glsl */ `
  #include <beginnormal_vertex>
  vec3 crDispObj = vec3(0.0);
  {
    vec4 crW = modelMatrix * vec4(position, 1.0);
    vec3 crP = (uCarInv * crW).xyz;
    vec3 crN = normalize(mat3(uCarInv) * (mat3(modelMatrix) * objectNormal));
    vCarPos0 = crP;
    vCarN0 = crN;
    vDamage = 0.0;
    if (uCrushOn > 0.5) {
      float dmg, dmg1, dmg2;
      vec3 d0 = crushDisp(crP, crN, dmg);
      vDamage = dmg;
      if (dot(d0, d0) > 1e-10) {
        // the new normal from the displacement of two nearby points on the surface
        vec3 t1 = normalize(abs(crN.y) < 0.9 ? cross(crN, vec3(0.0, 1.0, 0.0)) : cross(crN, vec3(1.0, 0.0, 0.0)));
        vec3 t2 = cross(crN, t1);
        float e = 0.006;
        vec3 p1 = crP + t1 * e, p2 = crP + t2 * e;
        vec3 a1 = p1 + crushDisp(p1, crN, dmg1) - (crP + d0);
        vec3 a2 = p2 + crushDisp(p2, crN, dmg2) - (crP + d0);
        vec3 nn = normalize(cross(a1, a2));
        if (dot(nn, crN) < 0.0) nn = -nn;
        objectNormal = normalize(transpose(mat3(modelMatrix)) * (mat3(uCarMat) * nn));
        crDispObj = inverse(mat3(modelMatrix)) * (mat3(uCarMat) * d0);
      }
    }
  }
`;

const depthMain = /* glsl */ `
  #include <begin_vertex>
  {
    vec4 crW = modelMatrix * vec4(position, 1.0);
    vec3 crP = (uCarInv * crW).xyz;
    vCarPos0 = crP;
    if (uCrushOn > 0.5) {
      float dmg;
      vec3 crN = normalize(mat3(uCarInv) * (mat3(modelMatrix) * normal));
      transformed += inverse(mat3(modelMatrix)) * (mat3(uCarMat) * crushDisp(crP, crN, dmg));
    }
  }
`;

/** The paint's extras: metallic flake and the photogrammetry targets (on the undeformed panel), scuffs where it crushed. */
const paintFrag = /* glsl */ `
  uniform vec4 uMarkers[${MAX_MARKERS}];
  uniform float uMarkerAxis[${MAX_MARKERS}];
  uniform int uMarkerCount;
  uniform float uFlake;
`;
const paintColor = /* glsl */ `
  #include <color_fragment>
  {
    // targets: yellow and black quadrants in a thin black ring
    for (int i = 0; i < ${MAX_MARKERS}; i++) {
      if (i >= uMarkerCount) break;
      vec4 m = uMarkers[i];
      float ax = uMarkerAxis[i];
      vec3 axis = ax < 0.5 ? vec3(0, 1, 0) : ax < 1.5 ? vec3(0, 0, -1) : ax < 2.5 ? vec3(0, 0, 1) : ax < 3.5 ? vec3(1, 0, 0) : vec3(-1, 0, 0);
      if (dot(normalize(vCarN0), axis) < 0.55) continue;
      vec3 rel = vCarPos0 - m.xyz;
      rel -= axis * dot(rel, axis);
      float r = length(rel);
      if (r > m.w) continue;
      vec3 t1 = abs(axis.y) > 0.5 ? vec3(1, 0, 0) : vec3(0, 1, 0);
      vec3 t2 = cross(axis, t1);
      float s = dot(rel, t1), t = dot(rel, t2);
      float quad = step(0.0, s) == step(0.0, t) ? 1.0 : 0.0;
      vec3 col = r > m.w * 0.86 ? vec3(0.015) : mix(vec3(0.015), vec3(0.95, 0.72, 0.0), quad);
      diffuseColor.rgb = col;
    }
    // where it crushed: the clear coat cracks, paint flakes to primer and bare metal along the folds
    if (vDamage > 0.02) {
      float n1 = crNoise(vCarPos0 * 60.0), n2 = crNoise(vCarPos0 * 13.0 + 7.0);
      float scuff = smoothstep(0.55, 0.95, vDamage * 0.9 + n2 * 0.45);
      vec3 primer = vec3(0.32, 0.33, 0.33), metal = vec3(0.55, 0.56, 0.57);
      vec3 under = uFail > 1.5 ? vec3(0.03, 0.03, 0.035) : mix(primer, metal, step(0.6, n1));
      diffuseColor.rgb = mix(diffuseColor.rgb, under, scuff * 0.85);
      diffuseColor.rgb *= 1.0 - 0.25 * smoothstep(0.3, 1.0, vDamage) * n1; // grime in the creases
    }
  }
`;
const paintRough = /* glsl */ `
  #include <roughnessmap_fragment>
  roughnessFactor = min(1.0, roughnessFactor + vDamage * 0.5);
`;
const flakeNormal = /* glsl */ `
  #include <normal_fragment_maps>
  if (uFlake > 0.0) {
    vec3 rnd = vec3(crHash(floor(vCarPos0 * 1400.0)), crHash(floor(vCarPos0 * 1400.0) + 3.1), crHash(floor(vCarPos0 * 1400.0) + 7.7)) - 0.5;
    normal = normalize(normal + rnd * uFlake);
  }
`;
/** Carbon and composite panels break into fragments where badly crushed: holes, not folds. */
const fractureFrag = /* glsl */ `
  #include <clipping_planes_fragment>
  if (uFail > 1.5 && vDamage > 0.35) {
    float f = crNoise(vCarPos0 * 28.0) * 0.7 + crNoise(vCarPos0 * 90.0) * 0.3;
    if (f < (vDamage - 0.35) * 0.9) discard;
  }
`;

const glassPars = /* glsl */ `
  uniform vec4 uPane[6];       // per pane: crack (0..1), shattered radius (m, < 0 intact), unused, unused
  uniform vec3 uPaneAt[6];     // where each pane broke from (car frame)
  uniform vec4 uCabin;         // rear bulkhead x, front bulkhead x, beltline y, B-pillar x
`;
const glassFrag = /* glsl */ `
  #include <clipping_planes_fragment>
  float crGlassWhite = 0.0;
  {
    vec3 n = normalize(vCarN0);
    vec3 p = vCarPos0;
    int pane = -1;
    if (n.x > 0.3 && p.x > uCabin.y - 0.4) pane = 0;            // windscreen
    else if (n.x < -0.3) pane = 1;                               // rear screen
    else if (abs(n.z) > 0.4) pane = (n.z < 0.0 ? 2 : 3) + (p.x < uCabin.w ? 2 : 0); // left/right, front/rear
    if (pane >= 0) {
      vec4 st = uPane[pane];
      float r = length(p - uPaneAt[pane]);
      // tempered glass gone: an expanding front of crazed glass, then nothing
      if (st.y >= 0.0) {
        float edge = st.y + (crNoise(p * 40.0) - 0.5) * 0.08;
        if (r < edge) discard;
        crGlassWhite = max(crGlassWhite, smoothstep(edge + 0.12, edge, r) * 0.8);
      }
      // laminated glass cracked: a star of radial cracks and rings round the strike, staying in
      if (st.x > 0.0) {
        vec3 d = p - uPaneAt[pane];
        float ang = atan(d.y, d.z);
        float radial = abs(sin(ang * 9.0 + crNoise(p * 6.0) * 6.0));
        float lines = smoothstep(0.035, 0.0, radial) * smoothstep(0.75 * st.x, 0.0, r);
        float rings = smoothstep(0.012, 0.0, abs(fract(r * 9.0 + crNoise(p * 12.0) * 0.6) - 0.5) * 0.5) * smoothstep(0.35 * st.x, 0.0, r);
        float craze = smoothstep(0.08 * st.x, 0.0, r);
        crGlassWhite = max(crGlassWhite, max(max(lines, rings * 0.8), craze) * st.x);
      }
    }
  }
`;
const glassColor = /* glsl */ `
  #include <color_fragment>
  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.85, 0.88, 0.9), crGlassWhite);
  diffuseColor.a = max(diffuseColor.a, crGlassWhite * 0.95);
`;

export type CrashMaterials = {
  uniforms: CrushUniforms;
  texture: THREE.DataTexture;
  /** per-pane glass state (crack, shattered radius) and origins */
  glass: { pane: THREE.Vector4[]; at: THREE.Vector3[] };
  /** the meshes of parts that move as wholes (engine, wheels, brakes, steering, radiator) */
  rigid: Map<string, THREE.Object3D[]>;
  /** upload a crush grid (NB × NS × {C, L, D}) */
  setCrush: (grid: Float32Array) => void;
  dispose: () => void;
};

const RIGID_PARTS = ["engine", "radiator", "wheel_fl", "wheel_fr", "wheel_rl", "wheel_rr", "brake_fl", "brake_fr", "brake_rl", "brake_rr", "steering"];

/** Patch every material of a car instance for the crash lab and set up its crush texture. */
export function crashMaterials(inst: CarInstance, def: BodyDef, opts: { markers: Marker[]; lite: boolean }): CrashMaterials {
  const n = NS * NB;
  const data = new Uint16Array(n * 4);
  for (let k = 0; k < n; k++) {
    data[k * 4] = THREE.DataUtils.toHalfFloat(def.surface[k]);
    data[k * 4 + 1] = data[k * 4 + 2] = data[k * 4 + 3] = 0;
  }
  const texture = new THREE.DataTexture(data, NS, NB, THREE.RGBAFormat, THREE.HalfFloatType);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.magFilter = texture.minFilter = THREE.LinearFilter;
  texture.needsUpdate = true;
  const fail = def.bodyMaterial === "carbon" || def.bodyMaterial === "composite" ? 2 : def.bodyMaterial === "aluminium" ? 1 : 0;
  const uniforms: CrushUniforms = {
    uCrush: { value: texture },
    uPlan: { value: new THREE.Vector4(def.plan.hx, def.plan.hz, def.plan.rc, 0) },
    uPlanC: { value: new THREE.Vector2(def.plan.cx, def.plan.cz) },
    uBandMid: { value: BAND_MID },
    uCarInv: { value: new THREE.Matrix4() },
    uCarMat: { value: new THREE.Matrix4() },
    uFail: { value: fail },
    uCrushOn: { value: 0 },
    uHood: { value: new THREE.Vector4(0, 0, 9, 0) },
    uHoodZ: { value: new THREE.Vector2(1, 0.55) },
  };
  const markers = opts.markers.slice(0, MAX_MARKERS);
  const markerU = {
    uMarkers: { value: Array.from({ length: MAX_MARKERS }, (_, i) => (markers[i] ? new THREE.Vector4(...markers[i].at, markers[i].r) : new THREE.Vector4())) },
    uMarkerAxis: { value: Array.from({ length: MAX_MARKERS }, (_, i) => markers[i]?.axis ?? 0) },
    uMarkerCount: { value: markers.length },
    // metallic paint sparkles with flake; a solid colour does not (as in the showroom)
    uFlake: { value: Math.min(0.22, Math.max(0, ((inst.paint[0]?.metalness ?? 0) - 0.25) * 0.5)) },
  };
  const cabin = def.cabin ?? [def.axleR, def.axleF];
  const glass = { pane: Array.from({ length: 6 }, () => new THREE.Vector4(0, -1, 0, 0)), at: Array.from({ length: 6 }, () => new THREE.Vector3()) };
  const glassU = {
    uPane: { value: glass.pane },
    uPaneAt: { value: glass.at },
    uCabin: { value: new THREE.Vector4(cabin[0], cabin[1], def.beltline ?? 0.9, def.hPoint[0] - 0.22) },
  };

  // rigid parts get their own material copies, which the deformation leaves alone
  const rigid = new Map<string, THREE.Object3D[]>();
  const rigidMats = new Map<string, THREE.Material>();
  const owned: THREE.Material[] = [];
  for (const id of RIGID_PARTS) {
    const obj = inst.parts.get(id);
    if (!obj) continue;
    const key = id.startsWith("brake_") ? `wheel_${id.slice(6)}` : id;
    rigid.set(key, [...(rigid.get(key) ?? []), obj]);
    obj.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      const swap = (m: THREE.Material) => {
        let c = rigidMats.get(m.uuid);
        if (!c) {
          c = m.clone();
          rigidMats.set(m.uuid, c);
          owned.push(c);
        }
        return c;
      };
      mesh.material = Array.isArray(mesh.material) ? mesh.material.map(swap) : swap(mesh.material);
    });
  }
  const rigidSet = new Set(owned);

  const paint = new Set<THREE.Material>(inst.paint);
  const glassMats = new Set<THREE.Material>(inst.glass.map((g) => g.mat));
  const depth = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });
  depth.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, uniforms);
    sh.vertexShader = sh.vertexShader.replace("#include <common>", `#include <common>\n${pars}`).replace("#include <begin_vertex>", depthMain);
  };
  depth.customProgramCacheKey = () => "crashdepth";
  owned.push(depth);

  const patched = new Set<THREE.Material>();
  inst.root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    if (mats.some((m) => rigidSet.has(m))) return;
    mesh.customDepthMaterial = depth;
    for (const m of mats) {
      if (patched.has(m)) continue;
      patched.add(m);
      const isPaint = paint.has(m), isGlass = glassMats.has(m);
      // compose with the material's own hook, never with an earlier crash patch (set-up can run twice)
      m.userData.crashBase ??= m.onBeforeCompile;
      const base = m.userData.crashBase as THREE.Material["onBeforeCompile"];
      const prev = (sh: THREE.WebGLProgramParametersWithUniforms, r: THREE.WebGLRenderer) => base.call(m, sh, r);
      m.onBeforeCompile = (sh, r) => {
        prev(sh, r);
        Object.assign(sh.uniforms, uniforms, isPaint ? markerU : {}, isGlass ? glassU : {});
        sh.vertexShader = sh.vertexShader
          .replace("#include <common>", `#include <common>\n${pars}`)
          .replace("#include <beginnormal_vertex>", vertexMain)
          .replace("#include <begin_vertex>", "#include <begin_vertex>\ntransformed += crDispObj;");
        let fs = sh.fragmentShader.replace("#include <common>", `#include <common>\n${pars.replace(/uniform mat4 uCarInv;|uniform mat4 uCarMat;/g, "")}\n${isPaint ? paintFrag : ""}\n${isGlass ? glassPars : ""}`);
        fs = fs.replace("#include <clipping_planes_fragment>", isGlass ? glassFrag : fractureFrag);
        if (isPaint) {
          fs = fs.replace("#include <color_fragment>", paintColor).replace("#include <roughnessmap_fragment>", paintRough);
          if (!opts.lite) fs = fs.replace("#include <normal_fragment_maps>", flakeNormal);
        } else if (isGlass) {
          fs = fs.replace("#include <color_fragment>", glassColor);
        } else {
          fs = fs.replace("#include <roughnessmap_fragment>", paintRough);
        }
        sh.fragmentShader = fs;
      };
      m.customProgramCacheKey = () => `crash-${isPaint ? "p" : isGlass ? "g" : "o"}-${opts.lite ? 1 : 0}`;
      m.needsUpdate = true;
    }
  });

  // smoothing across samples so panels bend instead of stepping (wider for folding metal than for carbon)
  const kernel = fail === 2 ? [1, 2, 1] : [1, 3, 5, 3, 1];
  const ksum = kernel.reduce((a, b) => a + b, 0), kh = (kernel.length - 1) / 2;
  const tmp = new Float32Array(n * 3);
  const hood = inst.boxes.get("hood");
  const hoodLen = hood ? hood.max.x - hood.min.x : 0;
  if (hood) {
    uniforms.uHood.value.set(hood.min.x, hood.max.x, hood.min.y + (hood.max.y - hood.min.y) * 0.45, 0);
    uniforms.uHoodZ.value.set(Math.max(0.3, (hood.max.z - hood.min.z) / 2), 0.55);
  }
  const hoodBand = hood ? Math.max(0, Math.min(NB - 1, BAND_MID.findIndex((y) => y > (hood.min.y + hood.max.y) / 2) - 1)) : 0;
  const setCrush = (grid: Float32Array) => {
    let any = 0;
    for (let b = 0; b < NB; b++)
      for (let i = 0; i < NS; i++) {
        for (let ch = 0; ch < 3; ch++) {
          let s = 0;
          for (let j = 0; j < kernel.length; j++) s += grid[(b * NS + ((i + j - kh + NS) % NS)) * 3 + ch] * kernel[j];
          tmp[(b * NS + i) * 3 + ch] = s / ksum;
        }
      }
    for (let k = 0; k < n; k++) {
      const C = Math.max(tmp[k * 3], grid[k * 3] * 0.6), L = Math.max(tmp[k * 3 + 1], C);
      any = Math.max(any, C);
      data[k * 4 + 1] = THREE.DataUtils.toHalfFloat(C);
      data[k * 4 + 2] = THREE.DataUtils.toHalfFloat(L);
      data[k * 4 + 3] = THREE.DataUtils.toHalfFloat(Math.min(1, tmp[k * 3 + 2]));
    }
    texture.needsUpdate = true;
    uniforms.uCrushOn.value = any > 1e-4 ? 1 : 0;
    // the bonnet: the length it lost is the crush at its height across the nose; the tent rises by the
    // height a hinged strip of that length needs to fit the shorter span, capped (it creases, then folds)
    if (hood && hoodLen > 0.3) {
      let lost = 0;
      for (let i = NS - 8; i < NS + 8; i++) lost = Math.max(lost, grid[(hoodBand * NS + (i % NS)) * 3]);
      const dl = Math.min(lost, hoodLen * 0.5);
      const h = Math.sqrt(Math.max(0, (hoodLen / 2) ** 2 - ((hoodLen - dl) / 2) ** 2));
      uniforms.uHood.value.w = Math.min(0.32, h * 0.8);
    }
  };

  return {
    uniforms,
    texture,
    glass,
    rigid,
    setCrush,
    dispose: () => {
      texture.dispose();
      owned.forEach((m) => m.dispose());
    },
  };
}

/** Where the targets go on a car: roof, bonnet and boot, each door at seat height, the B-pillars. */
export function markersFor(inst: CarInstance, def: BodyDef): Marker[] {
  const out: Marker[] = [];
  const box = inst.box;
  const top = box.max.y;
  const hp = def.hPoint;
  const half = def.plan.hz;
  out.push({ at: [hp[0] + 0.15, top, 0], r: 0.05, axis: 0 });
  out.push({ at: [hp[0] - 0.3, top, 0], r: 0.05, axis: 0 });
  const hood = inst.boxes.get("hood"), lid = inst.boxes.get("lid");
  if (hood) out.push({ at: [(hood.min.x + hood.max.x) / 2, hood.max.y, 0], r: 0.05, axis: 0 });
  if (lid) out.push({ at: [(lid.min.x + lid.max.x) / 2, lid.max.y, 0], r: 0.05, axis: 0 });
  const belt = def.beltline ?? 0.8;
  for (const s of [-1, 1]) {
    out.push({ at: [hp[0] + 0.05, belt - 0.15, s * half], r: 0.045, axis: s < 0 ? 1 : 2 });
    out.push({ at: [hp[0] - 0.22, belt + 0.12, s * half], r: 0.03, axis: s < 0 ? 1 : 2 });
    out.push({ at: [def.axleF, belt - 0.05, s * half], r: 0.035, axis: s < 0 ? 1 : 2 });
  }
  return out;
}
