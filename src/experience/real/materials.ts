import * as THREE from "three";
import { HeatKind } from "../thermal/heat";
import { realUniforms } from "./realState";
import { loadTextures, type TexKind, type TexSet } from "./textures";

/**
 * Physically based materials for the realistic pavilion. Stone, marble, paving, bronze, wood
 * and foliage sample the baked maps triplanar in world space, and exterior surfaces darken,
 * gloss up, puddle and ripple as they get wet in the rain.
 */

type Opts = {
  kind: TexKind;
  /** metres per tile (defaults to the bake's own tile size) */
  scale?: number;
  tint?: THREE.ColorRepresentation;
  roughness?: number;
  metalness?: number;
  normalScale?: number;
  /** 1 for surfaces out in the weather, 0 indoors */
  wet?: number;
  /** extra strength for puddles on flat ground */
  puddles?: number;
  /** "interior" surfaces reflect the captured hall; "sky" ones reflect the sky */
  env?: "sky" | "interior";
  physical?: Partial<Pick<THREE.MeshPhysicalMaterialParameters, "clearcoat" | "clearcoatRoughness" | "sheen" | "sheenColor" | "sheenRoughness">>;
  side?: THREE.Side;
  /** leaves sway in the wind (instanced trees) */
  sway?: number;
  polygonOffset?: number;
};

const triVertPars = /* glsl */ `
  varying vec3 vTriPos;
  varying vec3 vTriN;
  uniform float uTime;
  uniform float uSway;
`;

const triVert = /* glsl */ `
  #include <begin_vertex>
  {
    mat4 triM = modelMatrix;
    #ifdef USE_INSTANCING
      triM = modelMatrix * instanceMatrix;
    #endif
    if (uSway > 0.0) {
      vec4 o = triM * vec4(0.0, 0.0, 0.0, 1.0);
      float k = max(transformed.y, 0.0);
      float ph = o.x * 0.37 + o.z * 0.23;
      transformed.x += (sin(uTime * 1.3 + ph) * 0.6 + sin(uTime * 3.1 + ph * 2.0) * 0.25) * uSway * k * k * 0.01;
      transformed.z += cos(uTime * 1.1 + ph) * uSway * k * k * 0.006;
    }
    vTriPos = (triM * vec4(transformed, 1.0)).xyz;
    vTriN = normalize(mat3(triM) * objectNormal);
  }
`;

const triFragPars = /* glsl */ `
  varying vec3 vTriPos;
  varying vec3 vTriN;
  uniform sampler2D uTexA;
  uniform sampler2D uTexB;
  uniform float uScale;
  uniform vec3 uTint;
  uniform float uNormalScale;
  uniform float uWetAmt;
  uniform float uPuddles;
  uniform float uWet;
  uniform float uRainFall;
  uniform float uTime;
  float triHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
`;

// Albedo, height, roughness, AO and a perturbed world normal, blended from three projections
const triMap = /* glsl */ `
  vec3 triN = normalize(vTriN);
  #ifdef DOUBLE_SIDED
    triN *= gl_FrontFacing ? 1.0 : -1.0;
  #endif
  vec3 triW = pow(abs(triN), vec3(4.0));
  triW /= (triW.x + triW.y + triW.z);
  vec2 uvX = vTriPos.zy / uScale;
  vec2 uvY = vTriPos.xz / uScale;
  vec2 uvZ = vTriPos.xy / uScale;
  vec4 aX = texture2D(uTexA, uvX), aY = texture2D(uTexA, uvY), aZ = texture2D(uTexA, uvZ);
  vec4 bX = texture2D(uTexB, uvX), bY = texture2D(uTexB, uvY), bZ = texture2D(uTexB, uvZ);
  vec4 triA = aX * triW.x + aY * triW.y + aZ * triW.z;
  vec4 triB = bX * triW.x + bY * triW.y + bZ * triW.z;
  vec3 triAlbedo = triA.rgb * triA.rgb;
  float triH = triA.a;
  float triRough = triB.b;
  float triAO = triB.a;
  vec3 tnX = vec3((bX.xy * 2.0 - 1.0) * uNormalScale, 1.0);
  vec3 tnY = vec3((bY.xy * 2.0 - 1.0) * uNormalScale, 1.0);
  vec3 tnZ = vec3((bZ.xy * 2.0 - 1.0) * uNormalScale, 1.0);
  tnX = vec3(tnX.xy + triN.zy, abs(tnX.z) * triN.x);
  tnY = vec3(tnY.xy + triN.xz, abs(tnY.z) * triN.y);
  tnZ = vec3(tnZ.xy + triN.xy, abs(tnZ.z) * triN.z);
  vec3 triWorldN = normalize(tnX.zyx * triW.x + tnY.xzy * triW.y + tnZ.xyz * triW.z);

  // ---- rain: porous surfaces darken, flat ground collects puddles that ripple while it falls
  float wet = uWet * uWetAmt;
  float triUp = smoothstep(0.55, 0.95, triN.y);
  float triPuddle = 0.0;
  if (wet > 0.001) {
    float low = texture2D(uTexA, vTriPos.xz / (uScale * 6.7) + 0.31).a;
    triPuddle = smoothstep(0.62, 0.4, triH * 0.55 + low * 0.75) * triUp * uPuddles * smoothstep(0.25, 0.85, wet);
    triAlbedo *= mix(1.0, 0.5, wet * (0.55 + 0.45 * triUp));
    triAlbedo *= mix(1.0, 0.75, triPuddle);
    triRough = mix(triRough, 0.18, wet * 0.6);
    triRough = mix(triRough, 0.03, triPuddle);
    triWorldN = normalize(mix(triWorldN, triN, max(triPuddle, wet * 0.4)));
    if (uRainFall > 0.01 && triUp > 0.0) {
      // expanding rings from drops landing on a jittered grid
      vec2 rp = vTriPos.xz * 3.0;
      vec2 rn = vec2(0.0);
      for (int j = 0; j < 2; j++) {
        vec2 off = vec2(float(j) * 0.5);
        vec2 cell = floor(rp + off);
        float h = triHash(cell + float(j) * 13.0);
        float t = fract(uTime * 0.9 + h);
        vec2 c = cell + 0.25 + 0.5 * vec2(h, triHash(cell + 7.0)) - off;
        vec2 dv = rp - c;
        float d = length(dv);
        float ring = sin((d - t * 0.7) * 38.0) * smoothstep(0.0, 0.1, t * 0.7 - d + 0.12) * smoothstep(t * 0.7 + 0.02, t * 0.7 - 0.1, d);
        rn += dv / max(d, 1e-3) * ring * (1.0 - t);
      }
      float rippleAmt = uRainFall * triUp * mix(0.08, 0.35, triPuddle);
      triWorldN = normalize(triWorldN + vec3(rn.x, 0.0, rn.y) * rippleAmt);
    }
  }
  diffuseColor.rgb *= triAlbedo * uTint;
`;

function patch(m: THREE.MeshStandardMaterial, tex: TexSet, o: Opts) {
  const uniforms = {
    uTexA: { value: tex.a },
    uTexB: { value: tex.b },
    uScale: { value: o.scale ?? tex.tile },
    uTint: { value: new THREE.Color(o.tint ?? 0xffffff) },
    uNormalScale: { value: o.normalScale ?? 1 },
    uWetAmt: { value: o.wet ?? 0 },
    uPuddles: { value: o.puddles ?? 0 },
    uSway: { value: o.sway ?? 0 },
    uTime: realUniforms.uTime,
    uWet: realUniforms.uWet,
    uRainFall: realUniforms.uRainFall,
  };
  m.userData.tri = uniforms;
  m.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", `#include <common>\n${triVertPars}`)
      .replace("#include <begin_vertex>", triVert);
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", `#include <common>\n${triFragPars}`)
      .replace("#include <map_fragment>", triMap)
      .replace(
        "#include <roughnessmap_fragment>",
        "float roughnessFactor = clamp(roughness * triRough, 0.02, 1.0);",
      )
      .replace("#include <normal_fragment_maps>", "normal = normalize((viewMatrix * vec4(triWorldN, 0.0)).xyz);")
      .replace(
        "#include <aomap_fragment>",
        "#include <aomap_fragment>\n reflectedLight.indirectDiffuse *= triAO; reflectedLight.indirectSpecular *= mix(1.0, triAO, 0.6);",
      );
  };
  // one compiled program per variant of the patch (instancing etc. is handled by three's own keys)
  m.customProgramCacheKey = () => "tri-v1";
}

export function triplanar(tex: Record<TexKind, TexSet>, o: Opts) {
  const params: THREE.MeshPhysicalMaterialParameters = {
    color: 0xffffff,
    roughness: o.roughness ?? 1,
    metalness: o.metalness ?? 0,
    side: o.side ?? THREE.FrontSide,
  };
  if (o.polygonOffset) {
    params.polygonOffset = true;
    params.polygonOffsetFactor = o.polygonOffset;
    params.polygonOffsetUnits = o.polygonOffset;
  }
  const m = o.physical ? new THREE.MeshPhysicalMaterial({ ...params, ...o.physical }) : new THREE.MeshStandardMaterial(params);
  patch(m, tex[o.kind], o);
  m.userData.env = o.env ?? "sky";
  return m;
}

/** A plain (non-textured) PBR material that still follows the library's environment. */
function plain(params: THREE.MeshPhysicalMaterialParameters, env: "sky" | "interior" = "sky", physical = false) {
  const m = physical ? new THREE.MeshPhysicalMaterial(params) : new THREE.MeshStandardMaterial(params);
  m.userData.env = env;
  return m;
}

export type RealLib = ReturnType<typeof createLib>;

function createLib(gl: THREE.WebGLRenderer) {
  const { sets: tex, ready } = loadTextures(gl);
  const t = (o: Opts) => triplanar(tex, o);
  const lib = {
    tex,
    // ---- exterior masonry
    ashlar: t({ kind: "ashlar", wet: 1, puddles: 0, normalScale: 1.2, roughness: 1 }),
    ashlarFacade: t({ kind: "ashlar", wet: 1, normalScale: 1.2, polygonOffset: -1, side: THREE.DoubleSide }),
    stone: t({ kind: "stone", wet: 1, puddles: 0.4, normalScale: 1.0 }),
    stoneLight: t({ kind: "stone", wet: 1, puddles: 0.4, tint: 0xf4efe6 }),
    paving: t({ kind: "paving", wet: 1, puddles: 1, normalScale: 1.1 }),
    steps: t({ kind: "paving", scale: 3.2, wet: 1, puddles: 0.7, tint: 0xf2ece2, polygonOffset: 1 }),
    // ---- interior
    hallStone: t({ kind: "stone", env: "interior", tint: 0xf3ece0, side: THREE.DoubleSide, polygonOffset: -1 }),
    hallAshlar: t({ kind: "ashlar", env: "interior", tint: 0xf6efe3, side: THREE.DoubleSide, polygonOffset: -1 }),
    vault: t({ kind: "plaster", env: "interior", tint: 0xf3eadb, side: THREE.DoubleSide }),
    marbleFloor: t({
      kind: "marble",
      env: "interior",
      physical: { clearcoat: 1, clearcoatRoughness: 0.04 },
      roughness: 1,
    }),
    porticoMarble: t({
      kind: "marble",
      scale: 2.4,
      wet: 1,
      puddles: 0.3,
      physical: { clearcoat: 0.6, clearcoatRoughness: 0.12 },
    }),
    nero: t({ kind: "nero", env: "interior", physical: { clearcoat: 1, clearcoatRoughness: 0.05 } }),
    // ---- metals and wood
    bronze: t({ kind: "bronze", metalness: 1, roughness: 1, wet: 1 }),
    bronzeIn: t({ kind: "bronze", metalness: 1, roughness: 0.8, env: "interior", tint: 0xffe2b0 }),
    brass: plain({ color: 0xc9a25e, metalness: 1, roughness: 0.28 }, "interior"),
    brassOut: plain({ color: 0xb08a4f, metalness: 1, roughness: 0.4 }),
    blackMetal: plain({ color: 0x15171a, metalness: 0.85, roughness: 0.45 }),
    wood: t({ kind: "wood", env: "interior", physical: { clearcoat: 0.6, clearcoatRoughness: 0.25 } }),
    velvet: plain(
      { color: 0x5a0a12, roughness: 0.9, sheen: 1, sheenColor: new THREE.Color(0xd04050), sheenRoughness: 0.5 },
      "interior",
      true,
    ),
    carpet: plain(
      { color: 0x4a0810, roughness: 0.95, sheen: 0.8, sheenColor: new THREE.Color(0xa83040), sheenRoughness: 0.6 },
      "sky",
      true,
    ),
    // ---- glass
    glass: plain(
      {
        color: 0xffffff,
        metalness: 0,
        roughness: 0.02,
        transparent: true,
        opacity: 0.16,
        depthWrite: false,
        clearcoat: 1,
        clearcoatRoughness: 0,
        specularIntensity: 1,
      },
      "interior",
      true,
    ),
    windowGlass: plain({ color: 0x0b0f14, metalness: 0.2, roughness: 0.04, emissive: 0xffc98a, emissiveIntensity: 0 }),
    // ---- showcase sculptures (polished metals)
    gold: plain({ color: 0xf2c46a, metalness: 1, roughness: 0.16, clearcoat: 0.6 }, "interior", true),
    chrome: plain({ color: 0xe6e9ee, metalness: 1, roughness: 0.06 }, "interior", true),
    // ---- landscape
    grass: t({ kind: "grass", wet: 1, scale: 3.0, normalScale: 1.3 }),
    foliage: t({ kind: "foliage", wet: 0.4, normalScale: 2.2, sway: 1 }),
    bark: t({ kind: "wood", scale: 0.8, tint: 0x8a7a6a, wet: 1 }),
  };

  // how the thermal binoculars see them (anything untagged is judged from the material)
  lib.glass.userData.heat = { kind: HeatKind.Glass, heat: 0 };
  lib.windowGlass.userData.heat = { kind: HeatKind.Glass, heat: 2 };
  lib.foliage.userData.heat = { kind: HeatKind.Foliage };
  lib.blackMetal.userData.heat = { kind: HeatKind.Surface, emis: 0.92, absorb: 1.25 };
  lib.chrome.userData.heat = { kind: HeatKind.Surface, emis: 0.12 };
  lib.gold.userData.heat = { kind: HeatKind.Surface, emis: 0.15 };
  lib.brass.userData.heat = { kind: HeatKind.Surface, emis: 0.3 };
  lib.marbleFloor.userData.heat = { kind: HeatKind.Surface, absorb: 0.7 };
  for (const m of [lib.ashlar, lib.ashlarFacade, lib.hallAshlar]) m.userData.heat = { kind: HeatKind.Surface, masonry: 1 };

  const all: THREE.MeshStandardMaterial[] = Object.values(lib).filter(
    (v): v is THREE.MeshStandardMaterial => v instanceof THREE.MeshStandardMaterial,
  );
  return { ...lib, all, ready };
}

let shared: RealLib | null = null;

/** The realistic material library, created on first use (its textures stream in) and shared. */
export function getRealLib(gl: THREE.WebGLRenderer) {
  if (!shared) shared = createLib(gl);
  return shared;
}

export function peekRealLib() {
  return shared;
}

/** Point every library material (and any extra ones) at the current sky / hall environment. */
export function setEnvironments(
  mats: THREE.Material[],
  sky: THREE.Texture | null,
  interior: THREE.Texture | null,
  skyIntensity: number,
  interiorIntensity: number,
) {
  for (const m of mats) {
    const s = m as THREE.MeshStandardMaterial;
    if (!("envMap" in s)) continue;
    const inside = s.userData.env === "interior";
    const want = inside ? interior ?? sky : sky;
    if (s.envMap !== want) {
      s.envMap = want;
      s.needsUpdate = true;
    }
    s.envMapIntensity = inside && interior ? interiorIntensity : skyIntensity;
  }
}
