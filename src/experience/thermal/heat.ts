import * as THREE from "three";
import { FLOW_ORIGIN } from "@/lib/chapters";

/**
 * The thermal sensor's view of the pavilion: the whole scene is drawn once more with this one
 * material, which writes each surface's apparent temperature (°C) and its range (m) instead of a
 * colour. The binoculars' display then maps temperature to a palette.
 *
 * The model is simple but physical in spirit: surfaces sit near air temperature, gain heat from
 * the sun on the faces that see it (by how much light they absorb), lose it to the clear night sky
 * on the faces that see the sky, and masonry gives back the day's heat at night. Low-emissivity
 * surfaces (polished metal, glass, water) show mostly the reflection of what they face, so they
 * read cold where they mirror the sky. Lamps and people are their own sources, the hall keeps its
 * air-conditioned 25°C, and thermal contrast fades with range and humidity.
 */

export const HeatKind = {
  Surface: 0,
  Ground: 1,
  Emitter: 2,
  Glass: 3,
  Foliage: 4,
  Person: 5,
  Sky: 6,
  Device: 7,
} as const;
export type HeatKind = (typeof HeatKind)[keyof typeof HeatKind];

export type HeatInfo = {
  hide?: boolean;
  kind?: HeatKind;
  /** Surface: offset °C. Emitter / Device: its temperature. Glass / Person: offset. */
  heat?: number;
  /** how much of the sun's heat it takes in (dark stone > 1, pale marble < 1) */
  absorb?: number;
  /** thermal emissivity: 1 shows its own temperature, low values mirror the surroundings */
  emis?: number;
  /** ashlar masonry: its block joints (thermal bridges) and block-to-block tone show */
  masonry?: number;
};

const vert = /* glsl */ `
  #include <common>
  varying vec3 vW;
  varying vec3 vN;
  void main() {
    #include <beginnormal_vertex>
    #include <defaultnormal_vertex>
    #include <begin_vertex>
    #include <project_vertex>
    vec4 wp = vec4(transformed, 1.0);
    #ifdef USE_INSTANCING
      wp = instanceMatrix * wp;
    #endif
    vW = (modelMatrix * wp).xyz;
    // transformedNormal is in view space; take it back to world space
    vN = normalize((vec4(transformedNormal, 0.0) * viewMatrix).xyz);
  }
`;

const frag = /* glsl */ `
  uniform float uHide;
  uniform int uKind;
  uniform float uHeat;
  uniform float uAbsorb;
  uniform float uEmis;
  uniform float uMasonry;
  uniform vec3 uOrigin;
  uniform vec3 uSun;
  uniform float uSolar;
  uniform float uAir;
  uniform float uSkyZ;
  uniform float uSkyH;
  uniform float uCool;
  uniform float uRelease;
  uniform float uHumid;
  uniform float uLampOn;
  uniform samplerCube uClouds;
  uniform float uHasClouds;
  varying vec3 vW;
  varying vec3 vN;

  float h13(vec3 p) { p = fract(p * 0.1031); p += dot(p, p.zyx + 31.32); return fract((p.x + p.y) * p.z); }
  float vnoise(vec3 p) {
    vec3 i = floor(p), f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(mix(h13(i), h13(i + vec3(1, 0, 0)), f.x), mix(h13(i + vec3(0, 1, 0)), h13(i + vec3(1, 1, 0)), f.x), f.y),
               mix(mix(h13(i + vec3(0, 0, 1)), h13(i + vec3(1, 0, 1)), f.x), mix(h13(i + vec3(0, 1, 1)), h13(i + vec3(1, 1, 1)), f.x), f.y), f.z);
  }
  float box2(vec2 p, vec2 b) { vec2 d = abs(p) - b; return length(max(d, 0.0)) + min(max(d.x, d.y), 0.0); }

  // apparent temperature of the sky in a direction: coldest overhead, warmer toward the horizon,
  // clouds much warmer than clear sky; below the horizon, the ground's
  float skyT(vec3 d) {
    if (d.y < 0.0) return uAir - 1.0;
    float t = mix(uSkyH, uSkyZ, pow(clamp(d.y, 0.0, 1.0), 0.45));
    if (uHasClouds > 0.5) t = mix(t, uAir - 7.0, textureCube(uClouds, d).a * 0.85);
    return t;
  }

  void main() {
    if (uHide > 0.5) discard;
    vec3 toP = vW - cameraPosition;
    float dist = length(toP);
    vec3 V = toP / max(dist, 1e-4);
    // some blueprint geometry carries no normals: face it toward the viewer
    vec3 N = dot(vN, vN) > 1e-6 ? normalize(vN) : -V;
    if (!gl_FrontFacing) N = -N;
    vec3 lp = vW - uOrigin;
    // inside the exhibition hall: air conditioned, its lights always on
    bool inside = abs(lp.x) < 7.45 && lp.z < -1.35 && lp.z > -37.2 && lp.y > 0.4 && lp.y < 10.6;
    float n = vnoise(vW * 1.7) * 0.6 + vnoise(vW * 6.3) * 0.4;
    float sun = max(dot(N, uSun), 0.0) * uSolar;
    float facing = pow(1.0 - max(dot(-V, N), 0.0), 5.0);
    float T;

    // under the portico and the wing colonnades: shaded by day, sheltered from the night sky
    // (the back wall and the walk behind the columns; the front columns themselves stand in the sun)
    bool sheltered = lp.z > -0.8 && lp.y < 8.7 && lp.y > 0.4 && (abs(lp.x) < 7.2 ? lp.z < 2.9 : abs(lp.x) < 26.5 && lp.z < 0.75);
    float vert = 1.0 - abs(N.y);
    if (uKind == 0) {
      float sunHere = sheltered ? sun * 0.15 : sun;
      T = uAir + sunHere * uAbsorb + uRelease * vert - uCool * max(N.y, 0.0) * (sheltered ? 0.2 : 1.0) + uHeat + (n - 0.5) * 1.6;
      // warm air rises: the day's heat sits higher on the walls at night, and pools under cover
      T += (lp.y - 4.0) * 0.06 * uRelease + (sheltered ? 0.45 * uRelease : 0.0);
      if (inside) {
        // the hall: air conditioned, stratified (warmer toward the vault)
        T = 24.3 + (lp.y - 1.0) * 0.32 + uHeat * 0.25 + (n - 0.5) * 0.9;
      }
      if (uMasonry > 0.0 && vert > 0.5) {
        // ashlar courses (0.6m) of staggered 1.2m blocks; the joints are thermal bridges
        vec2 w2 = abs(N.x) > abs(N.z) ? vec2(vW.z, vW.y) : vec2(vW.x, vW.y);
        float row = floor(w2.y / 0.6);
        float bxu = w2.x / 1.2 + mod(row, 2.0) * 0.5;
        float bx = fract(bxu), by = fract(w2.y / 0.6);
        float joint = max(1.0 - smoothstep(0.0, 0.025, min(bx, 1.0 - bx)), 1.0 - smoothstep(0.0, 0.05, min(by, 1.0 - by)));
        float tone = h13(vec3(floor(bxu), row, 3.0)) - 0.5;
        T += (tone * 1.3 - joint * (0.6 + 0.3 * uRelease)) * uMasonry;
      }
      if (uEmis < 0.99) T = mix(inside ? 23.6 + max(reflect(V, N).y, 0.0) * 2.5 : skyT(reflect(V, N)), T, uEmis);
    } else if (uKind == 1) {
      // the site: paved forecourt and terrace, lawn, the two reflecting pools
      float dPave = min(box2(lp.xz - vec2(0.0, 15.2), vec2(16.0, 15.4)), box2(lp.xz - vec2(2.0, -19.6), vec2(33.6, 24.2)));
      float pave = 1.0 - smoothstep(-0.05, 0.05, dPave);
      float water = 1.0 - smoothstep(-0.42, -0.36, box2(vec2(abs(lp.x) - 7.6, lp.z - 16.0), vec2(3.4, 5.4)));
      float Tp = uAir + sun * 1.05 + uRelease * 0.5 - uCool * 0.7 + (n - 0.5) * 1.6;
      float Tg = uAir + sun * 0.35 - uCool * 1.5 + (vnoise(vW * 0.9) - 0.5) * 2.2;
      float Tw = mix(uAir - 3.0, skyT(reflect(V, vec3(0.0, 1.0, 0.0))), 0.12 + 0.75 * facing);
      T = mix(mix(Tg, Tp, pave), Tw, water);
      if (inside) T = 24.0 + (n - 0.5) * 0.5;
    } else if (uKind == 2) {
      float on = inside ? 1.0 : uLampOn;
      T = mix(uAir + sun * 0.6, uHeat, on);
    } else if (uKind == 3) {
      float own = inside ? 25.0 : uAir + uHeat + sun * 0.3;
      T = mix(own, inside ? 24.0 : skyT(reflect(V, N)), 0.55 + 0.4 * facing);
    } else if (uKind == 4) {
      T = uAir + sun * 0.18 - 1.3 - uCool * 0.5 * max(N.y, 0.0) + (vnoise(vW * 3.1) - 0.5) * 2.6;
    } else if (uKind == 5) {
      T = 33.8 + uHeat + (n - 0.5) * 0.8;
    } else if (uKind == 6) {
      T = skyT(V);
      dist = 9000.0;
    } else {
      T = uHeat;
    }

    // thermal contrast fades with range: the air in between (and rain) adds its own glow
    if (uKind != 6) T = mix(uAir - 1.5, T, exp(-dist * (0.002 + uHumid * 0.012)));
    gl_FragColor = vec4(T, dist, 0.0, 1.0);
  }
`;

export function createHeatMaterial() {
  return new THREE.ShaderMaterial({
    vertexShader: vert,
    fragmentShader: frag,
    side: THREE.DoubleSide,
    fog: false,
    uniforms: {
      uHide: { value: 0 },
      uKind: { value: 0 },
      uHeat: { value: 0 },
      uAbsorb: { value: 0.9 },
      uEmis: { value: 0.95 },
      uMasonry: { value: 0 },
      uOrigin: { value: new THREE.Vector3(...FLOW_ORIGIN) },
      uSun: { value: new THREE.Vector3(0, 1, 0) },
      uSolar: { value: 0 },
      uAir: { value: 26 },
      uSkyZ: { value: -30 },
      uSkyH: { value: 14 },
      uCool: { value: 3 },
      uRelease: { value: 2 },
      uHumid: { value: 0.2 },
      uLampOn: { value: 1 },
      uClouds: { value: null as THREE.Texture | null },
      uHasClouds: { value: 0 },
    },
  });
}

const HIDE: HeatInfo = { hide: true };
const STONE: HeatInfo = { kind: HeatKind.Surface, heat: 0, absorb: 0.9, emis: 0.95 };

const luminance = (c: THREE.Color) => 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;

/** What an object looks like to the sensor (cached per object and material). */
export function heatOf(object: THREE.Object3D): HeatInfo {
  const o = object as THREE.Mesh;
  const raw = o.material as THREE.Material | THREE.Material[] | undefined;
  const mat = Array.isArray(raw) ? raw[0] : raw;
  const cached = o.userData.__heat as { mat: unknown; info: HeatInfo } | undefined;
  if (cached && cached.mat === mat) return cached.info;
  const info = classify(o, mat);
  o.userData.__heat = { mat, info };
  return info;
}

function classify(o: THREE.Mesh, mat: THREE.Material | undefined): HeatInfo {
  // lines (the blueprint's edges), points (stars, dust) and sprites have no thermal body
  const any = o as unknown as { isLine?: boolean; isPoints?: boolean; isSprite?: boolean };
  if (any.isLine || any.isPoints || any.isSprite) return HIDE;
  if (o.userData.heat) return o.userData.heat as HeatInfo;
  if (!mat || mat.visible === false) return HIDE;
  if (mat.userData.heat) return mat.userData.heat as HeatInfo;

  const name = o.name;
  if (name === "PortalSilhouetteFigure") return { kind: HeatKind.Person };
  if (name === "PortalGlowFrame") return { kind: HeatKind.Device, heat: 31 };
  if (name.startsWith("Vitrine_") || name === "GallerySkylight" || name === "GalleryApseGlass") return { kind: HeatKind.Glass, heat: 0 };
  if (name.startsWith("Artifact_")) return { kind: HeatKind.Surface, emis: 0.2 };
  if (name === "MainFacadeWalls" || name === "GalleryOuterWalls") return { kind: HeatKind.Surface, masonry: 1 };
  // slender columns hold less of the day's heat than the walls behind them
  if (name.startsWith("PorticoCol") || name.startsWith("WingCol") || name.startsWith("RotundaCol")) return { kind: HeatKind.Surface, heat: -1.1, absorb: 0.8 };

  // light effects (glows, shafts, rain, washes) and floating type are not physical surfaces
  if (mat.blending === THREE.AdditiveBlending) return HIDE;
  if (mat.transparent) return HIDE;

  if ((mat as THREE.MeshBasicMaterial).isMeshBasicMaterial) {
    const b = mat as THREE.MeshBasicMaterial;
    if (b.map) return { kind: HeatKind.Device, heat: 30 }; // screens and lit placards (an LED panel's face)
    if (luminance(b.color) > 0.4) return { kind: HeatKind.Emitter, heat: 85 }; // bulbs
    return STONE;
  }
  const s = mat as THREE.MeshStandardMaterial;
  if (s.isMeshStandardMaterial && s.metalness > 0.7) return { kind: HeatKind.Surface, emis: 0.3, absorb: 0.8 };
  return STONE;
}
