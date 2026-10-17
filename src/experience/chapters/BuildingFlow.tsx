"use client";

import { Billboard, useGLTF } from "@react-three/drei";
import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { toCreasedNormals } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { FLOW_ORIGIN } from "@/lib/chapters";
import { sceneState } from "@/lib/sceneState";
import { useApp } from "@/store/useApp";
import { ROPE_R, SHOWCASE_CENTERS, walkWorld } from "../flowWalk";
import { palette } from "../palette";
import { getRealLib, peekRealLib, type RealLib } from "../real/materials";
import { realState } from "../real/realState";
import { prewarmReal } from "../real/prewarm";
import { HeatKind } from "../thermal/heat";
import ThermalPass from "../thermal/ThermalPass";
import { markStyleApplied, requestStyleSwap } from "../StyleTransition";
import PavilionDressing from "../real/PavilionDressing";
import GuestbookWall from "./GuestbookWall";
import RealWorld from "../real/RealWorld";
import ApseScreen from "./ApseScreen";
import FlowArchitecture, { ARCH_BOXES, ARCH_CIRCLES, makeStoneMaterial } from "./FlowArchitecture";
import FlowGalleryDetails, { BENCHES } from "./FlowGalleryDetails";
import FlowWalker from "./FlowWalker";

export const BUILDING_URL = "/models/building.glb";

const TAU = Math.PI * 2;
const { damp, smoothstep, lerp, clamp } = THREE.MathUtils;

/** Plan centre of the whole complex (portico, wings, rotunda and the 36m hall), local coords. */
const SITE_CENTER: [number, number, number] = [2, 3, -14];
/** Seconds the drone takes to climb to orbit altitude, and to land again. */
const LIFT_SECONDS = 5.0;
const LAND_SECONDS = 2.6;
/** Auto orbit speed at cruise (rad/s): one full revolution every ~45s. */
const ORBIT_SPEED = 0.14;

// Showcase Bay Coordinates (aligned with actual vitrine positions at x = ±4.4, y = 2.38, z = -7 / -17 / -27)
const SHOWCASE_CAMERAS: { pos: [number, number, number]; look: [number, number, number] }[] = [
  // 01 School System (Bay 1 Left)
  { pos: [-0.95, 2.38, -4.4], look: [-4.4, 2.28, -7.0] },
  // 02 Legal Workspace (Bay 1 Right)
  { pos: [0.95, 2.38, -4.4], look: [4.4, 2.28, -7.0] },
  // 03 LUXE (Bay 2 Left)
  { pos: [-0.95, 2.38, -14.4], look: [-4.4, 2.28, -17.0] },
  // 04 GoldOS (Bay 2 Right)
  { pos: [0.95, 2.38, -14.4], look: [4.4, 2.28, -17.0] },
  // 05 VYRO (Bay 3 Left)
  { pos: [-0.95, 2.38, -24.4], look: [-4.4, 2.28, -27.0] },
  // 06 HealthHub (Bay 3 Right)
  { pos: [0.95, 2.38, -24.4], look: [4.4, 2.28, -27.0] },
];

const SHOWCASE_SLUGS = [
  "school-system",
  "legal-workspace",
  "luxe",
  "goldos",
  "vyro",
  "healthhub",
];

const SHOWCASE_IDS = ["01", "02", "03", "04", "05", "06"];

/** Aerial callouts that appear once the drone is airborne: anchor on the building, label above it. */
const DRONE_CALLOUTS: { text: string; sub: string; anchor: [number, number, number]; rise: number }[] = [
  { text: "PORTICO", sub: "OCTASTYLE · 8 COL", anchor: [0, 12.6, -3.5], rise: 5.5 },
  { text: "ROTUNDA", sub: "THOLOS · 10 COL", anchor: [25.2, 12.4, 1.2], rise: 4.5 },
  { text: "EXHIBITION HALL", sub: "36M BARREL NAVE · 6 BAYS", anchor: [0, 10.4, -15], rise: 7.5 },
  { text: "WEST WING", sub: "COLONNADE · 11 COL", anchor: [-16.2, 7.6, 1.2], rise: 5.0 },
  { text: "ROSE WINDOW", sub: "APSE · 12 MULLION", anchor: [0, 8.5, -36.5], rise: 2.8 },
];

/** Model meshes you can stand on, and the ones that stop you, when walking in first person. */
const WALKABLE_MESHES = new Set(["GrandStylobate", "GalleryFloor"]);
const WALL_MESHES = new Set([
  "MainFacadeWalls",
  "GalleryOuterWalls",
  "ArchedWallNiches",
  "NichePilasters",
  "PortalDoorFrame",
  "GalleryApseFrame",
]);

/** Paired lamp posts lining the approach to the portal. */
const APPROACH_LAMPS: { z: number; h: number }[] = [
  { z: 7.5, h: 3.4 },
  { z: 12.0, h: 2.7 },
  { z: 16.5, h: 2.7 },
  { z: 21.0, h: 2.7 },
  { z: 25.5, h: 2.7 },
];

// Architectural CAD Blueprint Ground Shader for the site plan around the pavilion
const plazaVert = /* glsl */ `
  varying vec3 vWorldPos;
  void main() {
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vWorldPos = wp.xyz - vec3(0.0, 0.0, -480.0);
    gl_Position = projectionMatrix * viewMatrix * wp;
  }
`;

const plazaFrag = /* glsl */ `
  uniform float uTime;
  uniform float uSpread; // 0 on the ground, 1 at drone altitude: widens the visible site plan
  varying vec3 vWorldPos;

  const float PI = 3.14159265;

  float gridAA(vec2 p, float scale) {
    vec2 q = p * scale;
    vec2 f = abs(fract(q - 0.5) - 0.5);
    vec2 df = fwidth(q);
    vec2 g = 1.0 - smoothstep(df * 0.4, df * 1.8, f);
    return max(g.x, g.y);
  }

  float lineAA(float d, float w) {
    float fw = fwidth(d);
    return 1.0 - smoothstep(w, w + fw * 1.5, abs(d));
  }

  void main() {
    float wx = vWorldPos.x;
    float wz = vWorldPos.z;
    vec2 p = vec2(wx, wz);

    // Pure black under the gallery footprint so exterior lines never bleed inside
    if (abs(wx) < 9.0 && wz < 1.0 && wz > -39.0) {
      gl_FragColor = vec4(0.002, 0.003, 0.005, 1.0);
      return;
    }

    vec3 col = vec3(0.002, 0.003, 0.005);

    // Visible radius: a forward fan from the plaza camera, a full disc around the site from the air
    vec2 fc = mix(vec2(0.0, 12.0), vec2(2.0, -14.0), uSpread);
    float dist = length(vec2((wx - fc.x) * mix(0.55, 1.0, uSpread), wz - fc.y));
    float distFade = 1.0 - smoothstep(mix(12.0, 34.0, uSpread), mix(52.0, 92.0, uSpread), dist);

    // 4m major grid + 1m minor grid that bows out before it moires
    float major = gridAA(p, 0.25);
    vec2 mpp = fwidth(p);
    float minorVis = 1.0 - smoothstep(0.06, 0.2, max(mpp.x, mpp.y));
    float minor = gridAA(p, 1.0) * minorVis;
    vec3 gridCol = vec3(0.32, 0.38, 0.46);
    col += gridCol * (major * 0.40 + minor * 0.09) * distFade;

    // Two bright perspective guide lines leading into the entrance doorway at x = ±1.8
    float pathMask = step(2.4, wz) * (1.0 - smoothstep(26.0, 36.0, wz));
    float pathLineL = lineAA(wx + 1.8, 0.02);
    float pathLineR = lineAA(wx - 1.8, 0.02);
    col += vec3(0.95, 0.98, 1.0) * (pathLineL + pathLineR) * pathMask * 0.95;
    // Stone paving joints between the guide lines
    float paving = lineAA(fract(wz * 0.5 + 0.5) - 0.5, 0.012) * step(abs(wx), 1.8);
    col += vec3(0.55, 0.62, 0.72) * paving * pathMask * 0.35;

    // Subtle luminous portal threshold glow directly in front of the door
    float portalHalo = exp(-(wx * wx * 0.45 + (wz - 2.8) * (wz - 2.8) * 0.55));
    col += vec3(0.90, 0.94, 1.0) * portalHalo * 0.45;

    // Twin reflecting pools flanking the approach, with coping lines and drifting ripples
    vec2 q = vec2(abs(wx) - 7.6, wz - 16.0);
    vec2 dd = abs(q) - vec2(3.4, 5.4);
    float sd = length(max(dd, 0.0)) + min(max(dd.x, dd.y), 0.0);
    float inPool = 1.0 - step(0.0, sd);
    col = mix(col, vec3(0.003, 0.005, 0.011), inPool);
    col += vec3(0.92, 0.96, 1.0) * lineAA(sd, 0.03) * 0.8 * distFade;
    col += vec3(0.62, 0.72, 0.9) * lineAA(sd + 0.38, 0.015) * 0.4 * distFade;
    float rip = sin(wz * 6.0 + sin(wx * 1.4 + uTime * 0.55) * 1.7 - uTime * 0.9);
    col += vec3(0.5, 0.62, 0.85) * smoothstep(0.93, 1.0, rip) * inPool * step(sd, -0.45) * 0.28;

    // Survey rings around the complex: solid 40m datum with degree ticks, dashed 54m boundary
    vec2 c = p - vec2(2.0, -14.0);
    float r = length(c);
    float ang = atan(c.y, c.x);
    float deg = ang * 180.0 / PI;
    float surveyW = mix(0.22, 0.6, uSpread);
    float rings = lineAA(r - 40.0, 0.035);
    rings += lineAA(r - 54.0, 0.03) * step(0.45, fract(deg / 2.5));
    rings += lineAA(r - 66.0, 0.02) * 0.5;
    float arc10 = abs(fract(deg / 10.0 + 0.5) - 0.5) * 10.0 * PI / 180.0 * r;
    float arc30 = abs(fract(deg / 30.0 + 0.5) - 0.5) * 30.0 * PI / 180.0 * r;
    rings += lineAA(arc10, 0.04) * step(40.0, r) * step(r, 41.6);
    rings += lineAA(arc30, 0.05) * step(40.0, r) * step(r, 43.5);
    // Radial site axes every 45 degrees between the datum and the boundary
    float arc45 = abs(fract(deg / 45.0 + 0.5) - 0.5) * 45.0 * PI / 180.0 * r;
    rings += lineAA(arc45, 0.025) * step(44.0, r) * step(r, 54.0) * 0.5;
    col += vec3(0.75, 0.83, 0.96) * rings * surveyW * (1.0 - smoothstep(70.0, 96.0, r));

    // Compass rose on the west lawn (north = -z)
    vec2 k = p - vec2(-19.0, 17.0);
    float kr = length(k);
    float compass = lineAA(kr - 2.6, 0.025) + lineAA(kr - 2.15, 0.015) * 0.6;
    compass += (lineAA(k.x, 0.015) + lineAA(k.y, 0.015)) * step(kr, 3.3) * 0.7;
    compass += lineAA(abs(k.x) - abs(k.y), 0.012) * step(kr, 2.15) * 0.45;
    float arrow = step(-4.3, k.y) * step(k.y, -2.6) * step(abs(k.x), (k.y + 4.3) * 0.32);
    compass += arrow * 0.9;
    col += vec3(0.9, 0.94, 1.0) * compass * 0.75 * distFade;

    // Periodic scan pulse that radiates from the portal and lights the grid as it passes
    float period = 7.5;
    float ph = fract(uTime / period);
    float pr = ph * 85.0;
    float pd = length(p - vec2(0.0, 2.5));
    float pulse = exp(-pow((pd - pr) * 0.9, 2.0)) * (1.0 - ph) * (1.0 - ph);
    col += vec3(0.72, 0.84, 1.0) * pulse * (0.06 + major * 0.9 + minor * 0.5 + rings * 0.6);

    // Outer edge horizon fade
    float edgeFade = 1.0 - smoothstep(mix(32.0, 70.0, uSpread), mix(55.0, 105.0, uSpread), dist);
    col *= edgeFade;

    gl_FragColor = vec4(col, 1.0);
  }
`;

// Slow-falling dust motes catching the light around the pavilion
const dustVert = /* glsl */ `
  uniform float uTime;
  uniform float uPix;
  attribute float aSeed;
  varying float vA;
  void main() {
    vec3 p = position;
    float t = uTime * (0.04 + aSeed * 0.06);
    p.y = mod(p.y + t * 5.0, 17.0) + 0.3;
    p.x += sin(t * 3.0 + aSeed * 40.0) * 0.9;
    p.z += cos(t * 2.3 + aSeed * 23.0) * 0.9;
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    gl_Position = projectionMatrix * mv;
    gl_PointSize = min(uPix * (0.5 + aSeed) * 22.0 / -mv.z, 5.0 * uPix);
    vA = smoothstep(0.3, 2.5, p.y) * (1.0 - smoothstep(12.0, 17.0, p.y)) * (0.35 + 0.65 * fract(aSeed * 17.0));
  }
`;

const dustFrag = /* glsl */ `
  varying float vA;
  void main() {
    float d = length(gl_PointCoord - 0.5);
    float a = smoothstep(0.5, 0.05, d) * vA * 0.6;
    gl_FragColor = vec4(vec3(0.86, 0.91, 1.0), a);
  }
`;

/**
 * Some of the model's stored normals point into the solid (the columns' shafts especially). The
 * blueprint never noticed (it is unlit), but lighting and shadow bias do: flip every normal that
 * disagrees with the triangles' own (correct) winding, keeping the authored smoothing.
 */
function orientNormals(geo: THREE.BufferGeometry) {
  if (geo.userData.normalsOriented) return;
  geo.userData.normalsOriented = true;
  const stored = geo.getAttribute("normal") as THREE.BufferAttribute | undefined;
  if (!stored) {
    geo.computeVertexNormals();
    return;
  }
  const authored = stored.clone();
  geo.computeVertexNormals();
  const wound = geo.getAttribute("normal") as THREE.BufferAttribute;
  for (let i = 0; i < wound.count; i++) {
    const ax = authored.getX(i), ay = authored.getY(i), az = authored.getZ(i);
    const d = ax * wound.getX(i) + ay * wound.getY(i) + az * wound.getZ(i);
    const k = d < 0 ? -1 : 1;
    wound.setXYZ(i, ax * k, ay * k, az * k);
  }
  wound.needsUpdate = true;
}

/**
 * The geometry a mesh should be lit with. A few of the model's solids (the columns) are built
 * inside-out, winding and normals both facing inward: harmless in the unlit blueprint, but lit
 * they shade backwards and shadow themselves. Those get a turned-out copy (the blueprint keeps
 * the original, so its hidden-line look is untouched).
 */
export function litGeometry(geo: THREE.BufferGeometry) {
  if (geo.userData.lit) return geo.userData.lit as THREE.BufferGeometry;
  const pos = geo.getAttribute("position");
  const idx = geo.index;
  const tri = idx ? idx.count / 3 : pos.count / 3;
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  let volume = 0;
  for (let t = 0; t < tri; t++) {
    const i0 = idx ? idx.getX(t * 3) : t * 3;
    const i1 = idx ? idx.getX(t * 3 + 1) : t * 3 + 1;
    const i2 = idx ? idx.getX(t * 3 + 2) : t * 3 + 2;
    a.fromBufferAttribute(pos, i0);
    b.fromBufferAttribute(pos, i1);
    c.fromBufferAttribute(pos, i2);
    volume += a.dot(b.cross(c)) / 6;
  }
  geo.computeBoundingBox();
  const size = geo.boundingBox!.getSize(new THREE.Vector3());
  let lit = geo;
  if (volume < -0.02 * size.x * size.y * size.z) {
    lit = geo.clone();
    if (lit.index) {
      const arr = lit.index.array;
      for (let i = 0; i < arr.length; i += 3) {
        const t = arr[i + 1];
        arr[i + 1] = arr[i + 2];
        arr[i + 2] = t;
      }
      lit.index.needsUpdate = true;
    }
    const n = lit.getAttribute("normal");
    if (n) {
      for (let i = 0; i < n.count; i++) n.setXYZ(i, -n.getX(i), -n.getY(i), -n.getZ(i));
      n.needsUpdate = true;
    }
  }
  orientNormals(lit);
  geo.userData.lit = lit;
  return lit;
}

/** The rotunda's dome is coarse: shade its curve smoothly, keeping the mouldings' hard creases. */
export function smoothGeometry(geo: THREE.BufferGeometry) {
  if (geo.userData.smooth) return geo.userData.smooth as THREE.BufferGeometry;
  const g = toCreasedNormals(litGeometry(geo).clone(), THREE.MathUtils.degToRad(35));
  geo.userData.smooth = g;
  return g;
}

/** The realistic material for a model mesh. */
function realMaterialFor(
  name: string,
  lib: RealLib,
  extra: { apse: THREE.Material; skylight: THREE.Material; portal: THREE.Material },
  artifact: number,
) {
  if (name === "GrandStylobate") return lib.steps;
  if (name === "MainFacadeWalls" || name === "GalleryOuterWalls") return lib.ashlar;
  if (name === "ArchedWallNiches" || name === "NichePilasters") return lib.hallAshlar;
  if (name.startsWith("PorticoCol") || name.startsWith("WingCol") || name.startsWith("RotundaCol")) return lib.stoneLight;
  if (name === "Entablature" || name === "PorticoPediment") return lib.stoneLight;
  if (name === "RotundaDome") return lib.stone;
  if (name === "GalleryBarrelVault") return lib.vault;
  if (name === "VaultArchRibs" || name === "GalleryApseFrame") return lib.hallStone;
  if (name === "GalleryFloor") return lib.marbleFloor;
  if (name === "FloorBrassInlays" || name.startsWith("VitrineFrame_")) return lib.brass;
  if (name === "GalleryApseGlass") return extra.apse;
  if (name === "GallerySkylight") return extra.skylight;
  if (name.startsWith("Vitrine_")) return lib.glass;
  if (name.startsWith("ShowcasePlinth_")) return lib.nero;
  if (name.startsWith("Artifact_")) return artifact % 2 === 0 ? lib.gold : lib.chrome;
  if (name === "PortalDoorFrame" || name === "PortalSilhouetteFigure") return lib.bronze;
  if (name === "PortalGlowFrame") return extra.portal;
  return lib.stone;
}

/**
 * Drop every triangle of `mesh` with a vertex that fails `keep` (tested in model space).
 * Cleans up the stray, mis-offset vertices build_building.py leaves in a few meshes.
 */
function trimTriangles(mesh: THREE.Mesh, root: THREE.Object3D, keep: (v: THREE.Vector3) => boolean) {
  root.updateMatrixWorld(true);
  const toRoot = new THREE.Matrix4().copy(root.matrixWorld).invert().multiply(mesh.matrixWorld);
  const geo = mesh.geometry;
  const pos = geo.getAttribute("position");
  const v = new THREE.Vector3();
  const far = new Uint8Array(pos.count);
  for (let i = 0; i < pos.count; i++) {
    far[i] = keep(v.fromBufferAttribute(pos, i).applyMatrix4(toRoot)) ? 0 : 1;
  }
  const count = geo.index ? geo.index.count : pos.count;
  const at = (i: number) => (geo.index ? geo.index.getX(i) : i);
  const kept: number[] = [];
  for (let i = 0; i < count; i += 3) {
    const a = at(i);
    const b = at(i + 1);
    const c = at(i + 2);
    if (!far[a] && !far[b] && !far[c]) kept.push(a, b, c);
  }
  const trimmed = geo.clone();
  trimmed.setIndex(kept);
  trimmed.computeBoundingBox();
  trimmed.computeBoundingSphere();
  mesh.geometry = trimmed;
}

/** High-res canvas texture of spaced monospace text, for 3D blueprint labels. */
function useLabelTexture(text: string, letterSpacing: number, fontSize = 140) {
  return useMemo(() => {
    if (typeof document === "undefined") return { texture: null, aspect: 1 };
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");
    if (!ctx) return { texture: null, aspect: 1 };

    const displayText = text.split("").join(" ".repeat(Math.max(0, letterSpacing)));
    const font = `600 ${fontSize}px "JetBrains Mono", "IBM Plex Mono", monospace`;
    ctx.font = font;
    const metrics = ctx.measureText(displayText);
    const pad = 48;
    canvas.width = Math.ceil(metrics.width + pad * 2);
    canvas.height = Math.ceil(fontSize * 1.5 + pad);

    ctx.font = font;
    ctx.textBaseline = "middle";
    ctx.textAlign = "center";
    ctx.fillStyle = "#ffffff";
    ctx.fillText(displayText, canvas.width / 2, canvas.height / 2);

    const tex = new THREE.CanvasTexture(canvas);
    tex.minFilter = THREE.LinearFilter;
    tex.magFilter = THREE.LinearFilter;
    return { texture: tex, aspect: canvas.width / canvas.height };
  }, [text, letterSpacing, fontSize]);
}

/**
 * 3D Floating Architectural Text Label rendered via high-res Canvas 2D
 */
function ArchitecturalLabel3D({
  text,
  position,
  scale = 1.0,
  opacity = 0.92,
  hasLeader = false,
  leaderTo,
  letterSpacing = 2,
  real = false,
}: {
  real?: boolean;
  text: string;
  position: [number, number, number];
  scale?: number;
  opacity?: number;
  hasLeader?: boolean;
  leaderTo?: [number, number, number];
  letterSpacing?: number;
}) {
  const { texture, aspect } = useLabelTexture(text, letterSpacing);
  useEffect(() => () => texture?.dispose(), [texture]);

  const height = 0.65 * scale;
  const width = height * aspect;

  return (
    <group position={position}>
      {texture && !real && (
        <mesh>
          <planeGeometry args={[width, height]} />
          <meshBasicMaterial
            map={texture}
            transparent
            opacity={opacity}
            side={THREE.DoubleSide}
            toneMapped={false}
            depthWrite={false}
          />
        </mesh>
      )}
      {/* realistic: gilded bronze lettering set into the frieze */}
      {texture && real && (
        <mesh>
          <planeGeometry args={[width, height]} />
          <meshStandardMaterial
            color="#d2ad68"
            metalness={0.9}
            roughness={0.3}
            alphaMap={texture}
            transparent
            depthWrite={false}
          />
        </mesh>
      )}
      {hasLeader && leaderTo && (
        <lineSegments>
          <bufferGeometry>
            <bufferAttribute
              attach="attributes-position"
              args={[
                new Float32Array([
                  0,
                  -height / 2 - 0.05,
                  0,
                  leaderTo[0] - position[0],
                  leaderTo[1] - position[1],
                  leaderTo[2] - position[2],
                ]),
                3,
              ]}
            />
          </bufferGeometry>
          <lineBasicMaterial color="#ffffff" transparent opacity={0.65} />
        </lineSegments>
      )}
    </group>
  );
}

/**
 * Aerial callout: a camera-facing title + subtitle floating above the building with a
 * leader line dropping to a ring marker on the roofline. Fades in with the drone's altitude.
 */
function DroneCallout({
  text,
  sub,
  anchor,
  rise,
}: {
  text: string;
  sub: string;
  anchor: [number, number, number];
  rise: number;
}) {
  const title = useLabelTexture(text, 2);
  const subtitle = useLabelTexture(sub, 1, 110);
  const root = useRef<THREE.Group>(null);
  const mats = useRef<(THREE.Material | null)[]>([]);

  useEffect(
    () => () => {
      title.texture?.dispose();
      subtitle.texture?.dispose();
    },
    [title.texture, subtitle.texture],
  );

  const leader = useMemo(() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(new Float32Array([0, 0, 0, 0, rise - 0.75, 0]), 3));
    return g;
  }, [rise]);
  useEffect(() => () => leader.dispose(), [leader]);

  useFrame(() => {
    const lift = sceneState.flow.drone.lift;
    const a = smoothstep(lift, 0.55, 0.95);
    if (root.current) root.current.visible = a > 0.01;
    const base = [0.95, 0.6, 0.55, 0.9];
    mats.current.forEach((m, i) => {
      if (m) m.opacity = a * base[i];
    });
  });

  const th = 0.95;
  const sh = 0.5;
  return (
    <group ref={root} position={anchor} visible={false}>
      <Billboard position={[0, rise, 0]}>
        {title.texture && (
          <mesh position={[0, 0.42, 0]}>
            <planeGeometry args={[th * title.aspect, th]} />
            <meshBasicMaterial
              ref={(m) => {
                mats.current[0] = m;
              }}
              map={title.texture}
              transparent
              toneMapped={false}
              depthWrite={false}
              depthTest={false}
            />
          </mesh>
        )}
        {subtitle.texture && (
          <mesh position={[0, -0.35, 0]}>
            <planeGeometry args={[sh * subtitle.aspect, sh]} />
            <meshBasicMaterial
              ref={(m) => {
                mats.current[1] = m;
              }}
              map={subtitle.texture}
              transparent
              toneMapped={false}
              depthWrite={false}
              depthTest={false}
            />
          </mesh>
        )}
      </Billboard>
      <lineSegments geometry={leader}>
        <lineBasicMaterial
          ref={(m) => {
            mats.current[2] = m;
          }}
          color="#ffffff"
          transparent
          depthWrite={false}
        />
      </lineSegments>
      <mesh rotation-x={-Math.PI / 2}>
        <ringGeometry args={[0.32, 0.42, 32]} />
        <meshBasicMaterial
          ref={(m) => {
            mats.current[3] = m;
          }}
          color="#ffffff"
          transparent
          side={THREE.DoubleSide}
          toneMapped={false}
          depthWrite={false}
        />
      </mesh>
    </group>
  );
}

/**
 * Paired lamp posts along the approach: slender standard, cross-arm and a glowing lantern
 * that the bloom pass picks up. Ground rings mark each footing on the plaza plan.
 */
function ApproachLamps() {
  const geos = useMemo(() => {
    const posts = new Float32Array(APPROACH_LAMPS.length * 2 * 6 * 3);
    let o = 0;
    const seg = (a: number[], b: number[]) => {
      posts.set(a, o);
      posts.set(b, o + 3);
      o += 6;
    };
    for (const { z, h } of APPROACH_LAMPS) {
      for (const x of [-3.2, 3.2]) {
        seg([x, 0, z], [x, h, z]);
        seg([x - 0.22, h - 0.32, z], [x + 0.22, h - 0.32, z]);
        seg([x, h - 0.32, z - 0.22], [x, h - 0.32, z + 0.22]);
      }
    }
    const post = new THREE.BufferGeometry();
    post.setAttribute("position", new THREE.BufferAttribute(posts.subarray(0, o), 3));
    return { post, bulb: new THREE.SphereGeometry(0.075, 12, 12), foot: new THREE.RingGeometry(0.28, 0.33, 28) };
  }, []);
  useEffect(
    () => () => {
      geos.post.dispose();
      geos.bulb.dispose();
      geos.foot.dispose();
    },
    [geos],
  );

  return (
    <group>
      <lineSegments geometry={geos.post}>
        <lineBasicMaterial color="#ffffff" transparent opacity={0.8} />
      </lineSegments>
      {APPROACH_LAMPS.flatMap(({ z, h }) =>
        [-3.2, 3.2].map((x) => (
          <group key={`${x}:${z}`} position={[x, 0, z]}>
            <mesh position={[0, h, 0]} geometry={geos.bulb}>
              <meshBasicMaterial color="#ffffff" toneMapped={false} />
            </mesh>
            <mesh position={[0, 0.02, 0]} rotation-x={-Math.PI / 2} geometry={geos.foot}>
              <meshBasicMaterial color="#cfd8ea" transparent opacity={0.55} side={THREE.DoubleSide} />
            </mesh>
          </group>
        )),
      )}
    </group>
  );
}

/** Faint star field on a high dome; only really reads once the drone looks across the sky. */
function Starfield() {
  const geo = useMemo(() => {
    const n = 1400;
    const pos = new Float32Array(n * 3);
    let s = 7;
    const rnd = () => {
      s = (s * 16807) % 2147483647;
      return s / 2147483647;
    };
    for (let i = 0; i < n; i++) {
      const az = rnd() * TAU;
      const el = Math.asin(0.04 + rnd() * 0.96);
      const r = 320;
      pos[i * 3] = Math.cos(el) * Math.cos(az) * r;
      pos[i * 3 + 1] = Math.sin(el) * r - 20;
      pos[i * 3 + 2] = Math.cos(el) * Math.sin(az) * r - 14;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    return g;
  }, []);
  useEffect(() => () => geo.dispose(), [geo]);

  return (
    <points geometry={geo}>
      <pointsMaterial
        color="#c9d3ec"
        size={1.4}
        sizeAttenuation={false}
        transparent
        opacity={0.55}
        depthWrite={false}
        fog={false}
      />
    </points>
  );
}

/** Drifting dust in the air volume around the portico and wings. */
function DustMotes({ mat }: { mat: THREE.ShaderMaterial }) {
  const geo = useMemo(() => {
    const n = 650;
    const pos = new Float32Array(n * 3);
    const seed = new Float32Array(n);
    let s = 11;
    const rnd = () => {
      s = (s * 16807) % 2147483647;
      return s / 2147483647;
    };
    for (let i = 0; i < n; i++) {
      pos[i * 3] = (rnd() - 0.5) * 64;
      pos[i * 3 + 1] = rnd() * 17;
      pos[i * 3 + 2] = 28 - rnd() * 70;
      seed[i] = rnd();
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    g.setAttribute("aSeed", new THREE.BufferAttribute(seed, 1));
    return g;
  }, []);
  useEffect(() => () => geo.dispose(), [geo]);

  return <points geometry={geo} material={mat} frustumCulled={false} />;
}

export default function BuildingFlow() {
  const group = useRef<THREE.Group>(null);
  const groundLabels = useRef<THREE.Group>(null);
  const animatedNodes = useRef<THREE.Object3D[]>([]);
  const pickTargets = useRef<{ mesh: THREE.Mesh; code: number }[]>([]);
  const lastCam = useRef<THREE.Vector3 | null>(null);
  const silhouette = useRef<THREE.Object3D | null>(null);
  const plaza = useRef<THREE.Mesh>(null);
  const decks = useRef<(THREE.Mesh | null)[]>([]);
  const mode = useApp((s) => s.mode);
  const flowView = useApp((s) => s.flowView);
  const flowFocus = useApp((s) => s.flowFocus);
  const isMobile = useApp((s) => s.isMobile);

  const threeScene = useThree((s) => s.scene);
  const camera = useThree((s) => s.camera);
  const dpr = useThree((s) => s.viewport.dpr);
  const gl = useThree((s) => s.gl);
  const flowStyle = useApp((s) => s.flowStyle);
  const real = flowStyle === "real" && mode === "flow";
  // the realistic library is baked the first time it is needed, then kept
  const lib = useMemo(() => (real ? getRealLib(gl) : peekRealLib()), [real, gl]);
  const realExtra = useMemo(
    () =>
      lib
        ? {
            apse: new THREE.MeshStandardMaterial({ color: 0x000000, emissive: 0xfff3df, emissiveIntensity: 2.4, roughness: 0.25 }),
            skylight: new THREE.MeshStandardMaterial({ color: 0x000000, emissive: 0xe6efff, emissiveIntensity: 1.4 }),
            portal: new THREE.MeshStandardMaterial({ color: 0x000000, emissive: 0xffd9a8, emissiveIntensity: 1.6 }),
          }
        : null,
    [lib],
  );
  useEffect(
    () => () => {
      if (realExtra) Object.values(realExtra).forEach((m) => m.dispose());
    },
    [realExtra],
  );
  // realistic programs compiled and textures loaded: until then the blueprint stays on screen
  const [realReady, setRealReady] = useState(false);
  const liveTarget = real && !!lib && realReady;
  // what is drawn: it follows the target only once the frame on screen has been captured, so the
  // post-processing transition can sweep the new look in over the old one (outside /flow: at once)
  const [live, setLive] = useState(false);
  useEffect(() => {
    if (liveTarget === live) return;
    const swap = () => {
      setLive(liveTarget);
      useApp.getState().set({ flowRealLive: liveTarget });
    };
    if (mode !== "flow") {
      swap();
      return;
    }
    return requestStyleSwap(liveTarget, swap);
  }, [liveTarget, live, mode]);

  const { scene } = useGLTF(BUILDING_URL, "/draco/");

  // Exterior Plaza Floor Shader Material
  const plazaMat = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader: plazaVert,
        fragmentShader: plazaFrag,
        uniforms: { uTime: { value: 0 }, uSpread: { value: 0 } },
      }),
    [],
  );

  const dustMat = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader: dustVert,
        fragmentShader: dustFrag,
        uniforms: { uTime: { value: 0 }, uPix: { value: 1 } },
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    [],
  );

  // 1. SOLID OCCLUDER: Solid blueprint black massing with polygonOffset to enable clean Hidden-Line Removal (HLR)
  const solidOccluderMat = useMemo(
    () =>
      new THREE.MeshBasicMaterial({
        color: 0x020305,
        polygonOffset: true,
        polygonOffsetFactor: 1.0,
        polygonOffsetUnits: 1.0,
        depthWrite: true,
        depthTest: true,
      }),
    [],
  );

  // 2. PRIMARY ARCHITECTURAL WIREFRAME: Luminous crisp off-white for silhouettes, entablatures, vitrine frames
  const primaryWireMat = useMemo(
    () =>
      new THREE.LineBasicMaterial({
        color: 0xf5f7fa,
        transparent: true,
        opacity: 0.88,
        depthTest: true,
        depthWrite: false,
      }),
    [],
  );

  // 3. SECONDARY ARCHITECTURAL WIREFRAME: Elegant slate-grey for inner flutes, steps, arch ribs
  const secondaryWireMat = useMemo(
    () =>
      new THREE.LineBasicMaterial({
        color: 0x8894a8,
        transparent: true,
        opacity: 0.65,
        depthTest: true,
        depthWrite: false,
      }),
    [],
  );

  // 4. EMISSIVE PORTAL & ACCENT MATERIALS
  const portalGlowMat = useMemo(
    () =>
      new THREE.MeshBasicMaterial({
        color: 0xffffff,
      }),
    [],
  );

  const silhouetteMat = useMemo(
    () =>
      new THREE.MeshBasicMaterial({
        color: 0x010102,
      }),
    [],
  );

  // the blueprint's site plan is the ground to the thermal binoculars
  useEffect(() => {
    plazaMat.userData.heat = { kind: HeatKind.Ground };
  }, [plazaMat]);

  // Stone surface for the stylobate and grand steps
  const stoneMat = useMemo(() => makeStoneMaterial(), []);
  useEffect(() => () => stoneMat.dispose(), [stoneMat]);

  const glassVitrineMat = useMemo(
    () =>
      new THREE.MeshBasicMaterial({
        color: 0x080a12,
        transparent: true,
        opacity: 0.12,
        depthWrite: false,
      }),
    [],
  );

  useEffect(
    () => () => {
      plazaMat.dispose();
      dustMat.dispose();
      solidOccluderMat.dispose();
      primaryWireMat.dispose();
      secondaryWireMat.dispose();
      portalGlowMat.dispose();
      silhouetteMat.dispose();
      glassVitrineMat.dispose();
    },
    [
      plazaMat,
      dustMat,
      solidOccluderMat,
      primaryWireMat,
      secondaryWireMat,
      portalGlowMat,
      silhouetteMat,
      glassVitrineMat,
    ],
  );

  // Prepare and curate scene geometry for authentic museum-grade architectural CAD rendering
  useEffect(() => {
    if (!scene) return;
    const anim: THREE.Object3D[] = [];
    const picks: { mesh: THREE.Mesh; code: number }[] = [];

    scene.traverse((child) => {
      if ((child as THREE.Mesh).isMesh) {
        const mesh = child as THREE.Mesh;
        mesh.castShadow = false;
        mesh.receiveShadow = false;

        // 1. Hide messy / redundant items
        // - PlazaHaze & Plaque_01..06
        // - InteractiveKiosk_... & KioskScreen_... (slanted poles that clutter plinth sides)
        // - PlinthCornerTrim_... (prevents double-line artifacts with ShowcasePlinth)
        // - GLB Labels (we render high-res Canvas 3D labels)
        if (
          mesh.name.startsWith("PlazaHaze") ||
          mesh.name.startsWith("Plaque_") ||
          mesh.name.startsWith("Label_") ||
          mesh.name.startsWith("InteractiveKiosk_") ||
          mesh.name.startsWith("KioskScreen_") ||
          mesh.name.startsWith("PlinthCornerTrim_")
        ) {
          mesh.visible = false;
          return;
        }

        // 1b. Stylobate and grand steps: stone treads under the blueprint edges
        if (mesh.name === "GrandStylobate") {
          mesh.material = stoneMat;
          if (!mesh.userData.__wireAdded) {
            mesh.userData.__wireAdded = true;
            mesh.add(new THREE.LineSegments(new THREE.EdgesGeometry(mesh.geometry, 12), primaryWireMat));
          }
          return;
        }

        // 2. Exterior Plaza Floor: replaced by a much larger site-plan plane so the drone never sees its edge
        if (mesh.name === "ReflectivePlaza") {
          mesh.visible = false;
          return;
        }

        // 3. Classical Frieze Inscription (hidden to use custom high-res Thufail Ahamed label)
        if (mesh.name === "FriezeText") {
          mesh.visible = false;
          return;
        }

        // 4. Portal Glow Frame & Door Frame
        if (mesh.name === "PortalGlowFrame" || mesh.name === "PortalDoorFrame") {
          mesh.material = portalGlowMat;
          picks.push({ mesh, code: 99 });
          return;
        }

        // 5. Entrance Silhouette Figure
        if (mesh.name === "PortalSilhouetteFigure") {
          mesh.material = silhouetteMat;
          picks.push({ mesh, code: 99 });
          return;
        }

        // 6. Enter button click target
        if (mesh.name === "PlazaEnterButton") {
          mesh.visible = false;
          picks.push({ mesh, code: 99 });
          return;
        }

        // 7. Rose Window / Gallery Apse
        if (mesh.name === "GalleryApseGlass") {
          // Luminous celestial circular aperture
          mesh.material = new THREE.MeshBasicMaterial({
            color: 0xffffff,
            transparent: true,
            opacity: 0.95,
          });
          return;
        }

        if (mesh.name === "GalleryApseFrame") {
          mesh.material = solidOccluderMat;
          if (!mesh.userData.__wireAdded) {
            mesh.userData.__wireAdded = true;
            // build_building.py offsets the apse dais twice, leaving it floating ~37m behind the hall
            trimTriangles(mesh, scene, (v) => v.z > -40);
            // High angle threshold (45 deg) to keep perimeter circle and main mullions without dense torus loops
            const edges = new THREE.EdgesGeometry(mesh.geometry, 45);
            const wire = new THREE.LineSegments(edges, primaryWireMat);
            mesh.add(wire);
          }
          return;
        }

        // 8. Gallery Barrel Vault: keep smooth arch curves without diagonal triangulation
        if (mesh.name === "GalleryBarrelVault") {
          mesh.material = solidOccluderMat;
          if (!mesh.userData.__wireAdded) {
            mesh.userData.__wireAdded = true;
            // Angle 35 deg ensures no diagonal triangulation across vault curve
            const edges = new THREE.EdgesGeometry(mesh.geometry, 35);
            const wire = new THREE.LineSegments(edges, secondaryWireMat);
            mesh.add(wire);
          }
          return;
        }

        // 9. Vitrine Glass Panels vs Vitrine Brass Frames
        if (mesh.name.startsWith("Vitrine_")) {
          // Ultra-clear transparent vitrine glass panel (no wireframe lines to avoid duplicates)
          mesh.material = glassVitrineMat;
          return;
        }

        if (mesh.name.startsWith("VitrineFrame_")) {
          // Single, elegant brass architectural vitrine frame
          mesh.material = solidOccluderMat;
          if (!mesh.userData.__wireAdded) {
            mesh.userData.__wireAdded = true;
            const edges = new THREE.EdgesGeometry(mesh.geometry, 15);
            const wire = new THREE.LineSegments(edges, primaryWireMat);
            mesh.add(wire);
          }
          return;
        }

        // 10. Showcase Plinths (Monolithic Beveled Stone Pedestals)
        if (mesh.name.startsWith("ShowcasePlinth_")) {
          mesh.material = solidOccluderMat;
          if (!mesh.userData.__wireAdded) {
            mesh.userData.__wireAdded = true;
            // stray vertices reach from each plinth to the doorway; keep only the pedestal itself
            const c = SHOWCASE_CENTERS[parseInt(mesh.name.split("_")[1], 10) - 1];
            if (c) trimTriangles(mesh, scene, (v) => Math.hypot(v.x - c.x, v.z - c.z) < 1.9 && v.y > 0.6);
            const edges = new THREE.EdgesGeometry(mesh.geometry, 15);
            const wire = new THREE.LineSegments(edges, primaryWireMat);
            mesh.add(wire);
          }
          return;
        }

        // 11. Gallery Interior Floor & Brass Runner Inlays
        if (mesh.name === "GalleryFloor") {
          mesh.material = solidOccluderMat;
          return;
        }

        if (mesh.name === "FloorBrassInlays") {
          mesh.material = solidOccluderMat;
          if (!mesh.userData.__wireAdded) {
            mesh.userData.__wireAdded = true;
            const edges = new THREE.EdgesGeometry(mesh.geometry, 15);
            const wire = new THREE.LineSegments(edges, primaryWireMat);
            mesh.add(wire);
          }
          return;
        }

        // 12. Showcase Artifact Centerpieces (Holographic Cybernetic Models)
        if (mesh.name.startsWith("Artifact_")) {
          anim.push(mesh);
          mesh.material = new THREE.MeshBasicMaterial({
            color: 0xffffff,
            wireframe: true,
            transparent: true,
            opacity: 0.85,
            blending: THREE.AdditiveBlending,
          });
        } else {
          // 13. General Classical Architecture (Columns, Pediment, Entablature, Arch Ribs, Stylobate)
          mesh.material = solidOccluderMat;

          if (!mesh.userData.__wireAdded) {
            mesh.userData.__wireAdded = true;
            if (mesh.name === "RotundaDome") {
              // drop the stray spikes above the dome and below the drum
              trimTriangles(mesh, scene, (v) => Math.hypot(v.x - 25.2, v.z - 1.2) < 4.6 && v.y > 0.5 && v.y < 12.3);
            }
            try {
              const isCol = mesh.name.includes("Col_");
              const threshold = isCol ? 8 : 12;
              const wireMat = isCol ? secondaryWireMat : primaryWireMat;
              const edges = new THREE.EdgesGeometry(mesh.geometry, threshold);
              const wireLines = new THREE.LineSegments(edges, wireMat);
              mesh.add(wireLines);
            } catch {
              // Ignore degenerate geometries
            }
          }
        }

        // Register showcase plinths, vitrines, artifacts (codes 0..5)
        for (let i = 0; i < SHOWCASE_IDS.length; i++) {
          const id = SHOWCASE_IDS[i];
          const slug = SHOWCASE_SLUGS[i];
          if (mesh.name.includes(`_${id}`) || mesh.name.includes(`_${slug}`)) {
            picks.push({ mesh, code: i });
            break;
          }
        }
      }
    });

    animatedNodes.current = anim;
    pickTargets.current = picks;
    silhouette.current = scene.getObjectByName("PortalSilhouetteFigure") ?? null;
  }, [
    scene,
    plazaMat,
    solidOccluderMat,
    primaryWireMat,
    secondaryWireMat,
    portalGlowMat,
    silhouetteMat,
    glassVitrineMat,
    stoneMat,
  ]);

  // X-ray or realistic: swap every model mesh between its blueprint material and its real one
  const applyStyle = (on: boolean) => {
    if (!scene) return;
    let artifact = 0;
    scene.traverse((child) => {
      const mesh = child as THREE.Mesh;
      if (!mesh.isMesh) return;
      if (mesh.userData.xrayMat === undefined) {
        // meshes the blueprint hides (plaques, kiosks, the GLB's own labels) stay hidden
        if (!mesh.visible && mesh.name !== "PortalSilhouetteFigure") return;
        mesh.userData.xrayMat = mesh.material;
      }
      const isArtifact = mesh.name.startsWith("Artifact_");
      const m = on && lib && realExtra ? realMaterialFor(mesh.name, lib, realExtra, isArtifact ? artifact++ : 0) : null;
      if (mesh.userData.xrayGeo === undefined) mesh.userData.xrayGeo = mesh.geometry;
      const xrayGeo = mesh.userData.xrayGeo as THREE.BufferGeometry;
      mesh.geometry = m ? (mesh.name === "RotundaDome" ? smoothGeometry(xrayGeo) : litGeometry(xrayGeo)) : xrayGeo;
      mesh.material = m ?? (mesh.userData.xrayMat as THREE.Material);
      const see = mesh.name.startsWith("Vitrine_") || mesh.name === "GalleryApseGlass" || mesh.name === "GallerySkylight";
      mesh.castShadow = !!m && !see;
      mesh.receiveShadow = !!m;
      for (const c of mesh.children) if ((c as THREE.LineSegments).isLineSegments) c.visible = !m;
    });
  };
  useEffect(() => {
    applyStyle(live);
    markStyleApplied();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scene, live, lib, realExtra]);

  // The first switch to realistic brings dozens of new shader programs. Drawn straight away they
  // froze the page for many seconds while the GPU compiled them. Instead, for one synchronous
  // moment put the realistic materials and world in place, hand every program to the parallel
  // compiler, and put the blueprint straight back: frames keep rendering it (already compiled)
  // while the realistic programs build in the background and the textures stream in.
  useLayoutEffect(() => {
    if (!real || !lib || realReady) return;
    let cancelled = false;
    useApp.getState().set({ flowPreparing: true });
    const world = realState.root;
    // every library material, on stand-in meshes, so ones used only by other components compile too
    const proxies = new THREE.Group();
    const box = new THREE.BoxGeometry(0.01, 0.01, 0.01);
    // (plus the textured lettering and plaques, whose materials are created inline elsewhere)
    const dummy = new THREE.DataTexture(new Uint8Array(4), 1, 1);
    const lettering = new THREE.MeshStandardMaterial({ alphaMap: dummy, transparent: true, depthWrite: false });
    const plaque = new THREE.MeshStandardMaterial({ map: dummy });
    for (const m of [...lib.all, lettering, plaque]) {
      const p = new THREE.Mesh(box, m);
      p.castShadow = p.receiveShadow = true;
      proxies.add(p);
    }
    group.current?.add(proxies);
    applyStyle(true);
    if (world) world.visible = true;
    // compile as frames are really drawn: into an offscreen target (the post-processing buffer),
    // which changes the programs' tone mapping and output colour space from the screen's
    const target = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType });
    const prevTarget = gl.getRenderTarget();
    gl.setRenderTarget(target);
    const jobs: Promise<unknown>[] = [lib.ready, gl.compileAsync(threeScene, camera)];
    if (realState.skyScene && realState.skyCamera) jobs.push(gl.compileAsync(realState.skyScene, realState.skyCamera));
    gl.setRenderTarget(prevTarget);
    target.dispose();
    applyStyle(false);
    if (world) world.visible = false;
    group.current?.remove(proxies);
    box.dispose();
    // (their programs stay cached while the real lettering and plaques use them)
    dummy.dispose();
    Promise.all(jobs)
      .catch(() => undefined)
      .then(() => {
        if (!cancelled) setRealReady(true);
      })
      .finally(() => useApp.getState().set({ flowPreparing: false }));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [real, lib, realReady, gl, threeScene, camera]);

  // a little after the pavilion has settled, get the realistic render ready in the background
  const appReady = useApp((s) => s.ready);
  useEffect(() => {
    if (mode !== "flow" || !appReady) return;
    const id = window.setTimeout(() => {
      prewarmReal(gl, isMobile);
      // and the lit copies of the model's geometry (normal repair, dome smoothing), cached
      scene?.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (!mesh.isMesh || mesh.userData.xrayMat === undefined) return;
        const geo = (mesh.userData.xrayGeo as THREE.BufferGeometry | undefined) ?? mesh.geometry;
        if (mesh.name === "RotundaDome") smoothGeometry(geo);
        else litGeometry(geo);
      });
    }, 2500);
    return () => window.clearTimeout(id);
  }, [mode, appReady, gl, isMobile, scene]);

  // First-person world: real floors and walls from the model, analytic colliders for the rest
  useEffect(() => {
    if (!scene) return;
    const walkables: THREE.Object3D[] = [];
    const walls: THREE.Object3D[] = [];
    const circles: { x: number; z: number; r: number }[] = [];
    const root = group.current;
    root?.updateMatrixWorld(true);
    const toLocal = new THREE.Matrix4().copy(root?.matrixWorld ?? new THREE.Matrix4()).invert();
    const box = new THREE.Box3();

    scene.traverse((child) => {
      const mesh = child as THREE.Mesh;
      if (!mesh.isMesh) return;
      if (WALKABLE_MESHES.has(mesh.name)) walkables.push(mesh);
      if (WALL_MESHES.has(mesh.name)) walls.push(mesh);
      if (mesh.name.includes("Col_")) {
        box.setFromObject(mesh).applyMatrix4(toLocal);
        const r = (Math.min(box.max.x - box.min.x, box.max.z - box.min.z) / 2) * 0.8;
        circles.push({ x: (box.min.x + box.max.x) / 2, z: (box.min.z + box.max.z) / 2, r });
      }
    });
    if (plaza.current) walkables.push(plaza.current);
    for (const d of decks.current) if (d) walkables.push(d);
    for (const c of SHOWCASE_CENTERS) circles.push({ x: c.x, z: c.z, r: ROPE_R + 0.05 });
    for (const { z } of APPROACH_LAMPS) for (const x of [-3.2, 3.2]) circles.push({ x, z, r: 0.12 });
    circles.push(...ARCH_CIRCLES);

    walkWorld.walkables = walkables;
    walkWorld.walls = walls;
    walkWorld.circles = circles;
    walkWorld.boxes = [
      ...BENCHES.map((b) => ({ x0: b.x - b.hx, x1: b.x + b.hx, z0: b.z - b.hz, z1: b.z + b.hz })),
      ...ARCH_BOXES,
    ];
    return () => {
      walkWorld.walkables = [];
      walkWorld.walls = [];
      walkWorld.circles = [];
      walkWorld.boxes = [];
    };
  }, [scene]);

  // Raycast picker so clicking the portal enters the hall and clicking a showcase inspects it
  const raycaster = useMemo(() => new THREE.Raycaster(), []);
  const ndc = useMemo(() => new THREE.Vector2(), []);

  useEffect(() => {
    sceneState.flow.pick = (x: number, y: number) => {
      if (!group.current?.visible) return -1;
      ndc.set(x, y);
      raycaster.setFromCamera(ndc, camera);
      const meshes = pickTargets.current.map((p) => p.mesh);
      const hits = raycaster.intersectObjects(meshes, false);
      if (!hits.length) return -1;
      const hitMesh = hits[0].object as THREE.Mesh;
      const match = pickTargets.current.find((p) => p.mesh === hitMesh);
      return match ? match.code : -1;
    };
    return () => {
      sceneState.flow.pick = () => -1;
      sceneState.flow.active = false;
    };
  }, [camera, raycaster, ndc]);

  // Set deep void background, fog and a far clip plane deep enough for the aerial orbit when in /flow
  const prevMode = useRef(mode);
  useEffect(() => {
    const cam = camera as THREE.PerspectiveCamera;
    const leaving = prevMode.current === "flow" && mode !== "flow";
    prevMode.current = mode;
    if (mode !== "flow" && !leaving) return;
    if (mode === "flow") {
      threeScene.background = new THREE.Color("#000000");
      const fog = threeScene.fog as THREE.FogExp2 | null;
      if (fog && fog.isFogExp2) {
        fog.color.set("#000000");
        fog.density = 0.005;
      }
      cam.far = 700;
    } else {
      threeScene.background = palette.bg;
      const fog = threeScene.fog as THREE.FogExp2 | null;
      if (fog && fog.isFogExp2) {
        fog.density = 0.045;
        fog.color.copy(palette.fog);
      }
      cam.far = 120;
    }
    cam.updateProjectionMatrix();
  }, [mode, threeScene, camera]);

  // Synchronize camera target positions, drone flight, fog density, and artifact rotation
  useFrame((state, dt) => {
    const isFlowMode = mode === "flow";
    sceneState.flow.active = isFlowMode;

    if (group.current) {
      group.current.visible = isFlowMode;
    }
    if (!isFlowMode) return;

    const step = Math.min(dt, 0.1);
    const time = state.clock.elapsedTime;
    const drone = sceneState.flow.drone;
    const flying = flowView === "drone";

    // Lift-off / landing progress, eased so the climb starts and settles gently
    drone.p = clamp(drone.p + (flying ? step / LIFT_SECONDS : -step / LAND_SECONDS), 0, 1);
    drone.lift = drone.p * drone.p * drone.p * (drone.p * (drone.p * 6 - 15) + 10);
    drone.idle += step;
    if (flying) {
      // Climb vertically first, then bank into the orbit; pause briefly after a manual drag
      const cruise = smoothstep(drone.p, 0.45, 1) * smoothstep(drone.idle, 1.2, 3.5);
      drone.spin += step * ORBIT_SPEED * cruise;
    } else {
      // Unwind to the nearest full turn so the drone always lands facing the portico
      const home = Math.round(drone.spin / TAU) * TAU;
      drone.spin = damp(drone.spin, home, 2.2, step);
      drone.zoom = damp(drone.zoom, 0, 2.2, step);
      drone.height = damp(drone.height, 0, 2.2, step);
    }

    plazaMat.uniforms.uTime.value = time;
    if (live && realExtra) {
      const dk = realState.night + realState.rain * 0.6;
      (realExtra.apse as THREE.MeshStandardMaterial).emissiveIntensity = 3.2 * realState.day + 0.9 * dk;
      (realExtra.skylight as THREE.MeshStandardMaterial).emissiveIntensity = 1.1 * realState.day + 0.05;
      (realExtra.portal as THREE.MeshStandardMaterial).emissiveIntensity = 0.8 + 1.6 * dk;
    }
    plazaMat.uniforms.uSpread.value = drone.lift;
    dustMat.uniforms.uTime.value = time;
    dustMat.uniforms.uPix.value = dpr;
    if (groundLabels.current) groundLabels.current.visible = drone.lift < 0.05;
    // in first person you are the figure in the doorway
    if (silhouette.current) silhouette.current.visible = flowView !== "walk";

    // Adjust scene fog density for exterior vs aerial vs interior hall
    const fog = threeScene.fog as THREE.FogExp2 | null;
    if (fog && fog.isFogExp2) {
      const outside =
        flowView === "exterior" || flowView === "drone" || (flowView === "walk" && !sceneState.flow.fp.indoors);
      const targetDensity = outside ? lerp(0.0055, 0.0028, drone.lift) : 0.0035;
      fog.density = damp(fog.density, targetDensity, 4, step);
    }

    // Rotate showcase centerpieces gently around their local vertical axis
    const rotSpeed = step * 0.55;
    for (const ob of animatedNodes.current) {
      ob.rotation.y += rotSpeed;
    }

    const [ox, oy, oz] = FLOW_ORIGIN;
    const mouseX = sceneState.mouse.x * (isMobile ? 0.15 : 0.65);
    const mouseY = sceneState.mouse.y * (isMobile ? 0.1 : 0.35);
    const pan = sceneState.flow.pan;
    const tilt = sceneState.flow.tilt;
    const walk = sceneState.flow.walk;

    if (flowView === "exterior" || flowView === "drone") {
      // One continuous path: grounded it is the wide establishing shot of the octastyle portico;
      // airborne it climbs straight up, pulls back and orbits the whole complex.
      const camZ = isMobile ? 38.0 : 34.0;
      const [cx, cy, cz] = SITE_CENTER;
      const climb = drone.lift;
      const pull = smoothstep(drone.lift, 0.2, 1);
      const ground = 1 - pull;

      const radius = lerp(camZ - cz, (isMobile ? 82 : 66) + drone.zoom, pull);
      const spin = drone.spin + mouseX * 0.06 * pull;
      const bob = (Math.sin(time * 0.9) * 0.35 + Math.sin(time * 2.3) * 0.08) * climb;
      const sway = Math.sin(time * 0.6 + 1.3) * 0.25 * climb;
      const height = lerp(2.3 + tilt * 1.8 + mouseY * 0.4, 30 + drone.height + mouseY * 1.5, climb) + bob;

      sceneState.flow.pos = [
        ox + cx * pull + Math.sin(spin) * radius + Math.cos(spin) * sway + (pan * 8.0 + mouseX * 1.2) * ground,
        oy + height,
        oz + cz + Math.cos(spin) * radius - Math.sin(spin) * sway,
      ];

      const look = smoothstep(climb, 0, 0.7);
      sceneState.flow.look = [
        ox + lerp(pan * 14.0 + mouseX * 1.8, cx, look),
        oy + lerp(5.1 + tilt * 3.2 + mouseY * 0.55, cy + drone.height * 0.12, look),
        oz + lerp(1.0, cz, look),
      ];
    } else if (flowView === "hall") {
      // Positioned inside looking down the 36m nave gallery
      sceneState.flow.pos = [
        ox + pan * 1.6 + mouseX * 0.45,
        oy + 2.15 + tilt * 0.8 + mouseY * 0.25,
        oz - 2.4 - walk,
      ];
      sceneState.flow.look = [
        ox + pan * 5.5 + mouseX * 0.9,
        oy + 2.65 + tilt * 2.2 + mouseY * 0.35,
        oz - 23.5 - walk * 0.55,
      ];
    } else if (flowView === "showcase" && flowFocus !== null) {
      const cfg = SHOWCASE_CAMERAS[flowFocus] || SHOWCASE_CAMERAS[0];
      sceneState.flow.pos = [
        ox + cfg.pos[0] + pan * 0.45 + mouseX * 0.18,
        oy + cfg.pos[1] + tilt * 0.35 + mouseY * 0.12,
        oz + cfg.pos[2] + pan * 0.35,
      ];
      sceneState.flow.look = [
        ox + cfg.look[0],
        oy + cfg.look[1] + tilt * 0.25,
        oz + cfg.look[2],
      ];
    }

    // Flight telemetry for the drone HUD, measured off the camera the rig actually moved
    const cam = state.camera;
    if (!lastCam.current) lastCam.current = cam.position.clone();
    const v = cam.position.distanceTo(lastCam.current) / Math.max(step, 1e-3);
    lastCam.current.copy(cam.position);
    const dir = cam.getWorldDirection(tmpDir);
    drone.alt = cam.position.y - oy;
    drone.dist = Math.hypot(cam.position.x - ox - SITE_CENTER[0], cam.position.z - oz - SITE_CENTER[2]);
    drone.heading = ((Math.atan2(dir.x, -dir.z) * 180) / Math.PI + 360) % 360;
    drone.pitch = (Math.asin(clamp(dir.y, -1, 1)) * 180) / Math.PI;
    drone.speed = damp(drone.speed, v, 3, step);
  });

  return (
    <group ref={group} position={FLOW_ORIGIN} visible={false}>
      {/* Subtle ambient for CAD depth contrast */}
      <ambientLight intensity={0.15} />

      {/* Site plan ground: blueprint grid, survey rings, reflecting pools, compass rose, scan pulse */}
      <mesh ref={plaza} rotation-x={-Math.PI / 2} position={[0, -0.42, -14]} material={plazaMat} visible={!live}>
        <planeGeometry args={[440, 440]} />
      </mesh>

      {/* Invisible walking decks: the portico / wing colonnade floor and the rotunda floor sit at
          the column bases, which the model leaves open over the low stylobate */}
      <mesh
        ref={(m) => {
          decks.current[0] = m;
        }}
        position={[0, 0.88, 1.31]}
        rotation-x={-Math.PI / 2}
      >
        <planeGeometry args={[54, 5.22]} />
        <meshBasicMaterial visible={false} />
      </mesh>
      <mesh
        ref={(m) => {
          decks.current[1] = m;
        }}
        position={[25.2, 0.88, 1.2]}
        rotation-x={-Math.PI / 2}
      >
        <circleGeometry args={[4.6, 32]} />
        <meshBasicMaterial visible={false} />
      </mesh>

      {/* The 3D Architecture & Exhibition Model */}
      <primitive object={scene} />

      {/* Realistic rendering: sky, weather, light and landscape */}
      {(real || live) && lib && <RealWorld lib={lib} live={live} />}
      {/* Project banners in the portico, light from the doors, fireflies */}
      {(real || live) && lib && <PavilionDressing model={scene} lib={lib} live={live} />}

      {/* Thermal binoculars (drawn over everything while raised) */}
      {mode === "flow" && <ThermalPass />}

      {/* Hanging cinema screen in front of the rose window, looping the studio reel */}
      <ApseScreen model={scene} />

      {/* Museum fit-out: ropes, lecterns, benches, sconces, niche uplights, skylight shafts */}
      <FlowGalleryDetails />
      {/* Guestbook tablet on the hall wall */}
      <GuestbookWall />
      {/* Walls and entrance: masonry, door surround and doors, windows, coffers, marble, carpet */}
      <FlowArchitecture />
      <FlowWalker />

      {/* Atmosphere: stars on a high dome and dust drifting through the colonnades */}
      {!live && <Starfield />}
      {!live && <DustMotes mat={dustMat} />}

      {/* Paired lamp posts lining the approach (Exterior & Aerial) */}
      {!live && flowView !== "hall" && flowView !== "showcase" && <ApproachLamps />}

      {/* Aerial callouts: billboarded so they read from any orbit angle */}
      {DRONE_CALLOUTS.map((c) => (
        <DroneCallout key={c.text} {...c} />
      ))}

      {/* 3D Floating Architectural Blueprint Labels (Exterior, hidden while airborne) */}
      {(flowView === "exterior" || flowView === "drone" || flowView === "walk") && (
        <group ref={groundLabels}>
          {!live && (
            <>
          <ArchitecturalLabel3D
            text="SYNAPX STUDIO"
            position={[0, 14.6, 3.2]}
            scale={1.1}
            opacity={0.92}
          />
          <ArchitecturalLabel3D
            text="LOBBY"
            position={[0, 11.4, 2.6]}
            scale={0.95}
            hasLeader={true}
            leaderTo={[0, 9.8, 2.6]}
          />
          <ArchitecturalLabel3D
            text="THE GALLERY"
            position={[0, 10.4, 2.6]}
            scale={0.65}
            opacity={0.75}
          />
          <ArchitecturalLabel3D
            text="ROTUNDA"
            position={[25.2, 13.5, 1.2]}
            scale={0.85}
            opacity={0.88}
          />
            </>
          )}
          <ArchitecturalLabel3D
            real={live}
            text="THUFAIL AHAMED"
            position={[0, 8.28, 4.05]}
            scale={0.52}
            letterSpacing={3}
            opacity={0.95}
          />
        </group>
      )}
    </group>
  );
}

const tmpDir = new THREE.Vector3();

