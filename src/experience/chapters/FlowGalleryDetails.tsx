"use client";

import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo } from "react";
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { projects } from "@/content/site";
import { useApp } from "@/store/useApp";
import { getRealLib } from "../real/materials";
import { realState } from "../real/realState";
import { ROPE_R, SHOWCASE_CENTERS } from "../flowWalk";

/** Interior floor level of the hall and the inner face of its side walls. */
const FLOOR = 0.885;
const WALL_X = 7.48;

/** Benches down the centre of the nave, between the showcase bays (also used as colliders). */
export const BENCHES = [
  { x: 0, z: -12, hx: 0.3, hz: 1.3 },
  { x: 0, z: -22, hx: 0.3, hz: 1.3 },
];

/** Sconces on the plain wall panels between the niches. */
const SCONCE_Z = [-2.9, -12, -22, -32];
/** Skylight shafts, one per vault bay between the transverse ribs. */
const SHAFT_Z = [-4.5, -9.5, -14.5, -19.5, -24.5, -29.5, -34.5];
const NICHE_Z = [-7, -17, -27];

/** Lectern position on each rope ring: toward the aisle and the entrance, facing out. */
export const lecternFor = (i: number) => {
  const c = SHOWCASE_CENTERS[i];
  const sx = c.x < 0 ? 1 : -1;
  const dx = sx * Math.SQRT1_2;
  const dz = Math.SQRT1_2;
  return { x: c.x + dx * ROPE_R, z: c.z + dz * ROPE_R, ry: Math.atan2(dx, dz) };
};

export const glowVert = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

// 0: radial pool, 1: sconce wash (up + down cone), 2: niche uplight (from the floor)
export const glowFrag = /* glsl */ `
  uniform vec3 uColor;
  uniform float uIntensity;
  uniform int uMode;
  varying vec2 vUv;
  void main() {
    vec2 p = vUv - 0.5;
    float a;
    if (uMode == 0) {
      a = exp(-dot(p, p) * 9.0) * (1.0 - smoothstep(0.35, 0.5, length(p)));
    } else if (uMode == 1) {
      float spread = 0.05 + abs(p.y) * 0.6;
      a = exp(-(p.x * p.x) / (spread * spread)) * (1.0 - smoothstep(0.05, 0.5, abs(p.y)));
      a += exp(-dot(p, p) * 220.0) * 0.8;
    } else {
      float y = vUv.y;
      float spread = 0.1 + y * 0.45;
      a = exp(-(p.x * p.x) / (spread * spread)) * pow(1.0 - y, 1.6);
    }
    gl_FragColor = vec4(uColor, a * uIntensity);
  }
`;

// Volumetric skylight shaft: brightest where the volume is seen face-on, fading at its silhouette
const shaftVert = /* glsl */ `
  varying vec3 vN;
  varying vec3 vV;
  varying float vY;
  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vN = normalize(normalMatrix * normal);
    vV = -mv.xyz;
    vY = uv.y;
    gl_Position = projectionMatrix * mv;
  }
`;

const shaftFrag = /* glsl */ `
  uniform float uTime;
  uniform float uSeed;
  varying vec3 vN;
  varying vec3 vV;
  varying float vY;
  void main() {
    float f = abs(dot(normalize(vN), normalize(vV)));
    f = pow(f, 2.2);
    float fade = smoothstep(0.0, 0.3, vY) * (1.0 - smoothstep(0.85, 1.0, vY)) * (0.45 + 0.55 * vY);
    float flicker = 0.86 + 0.14 * sin(uTime * 0.45 + uSeed * 7.0 + vY * 5.0);
    float a = f * fade * flicker * 0.075;
    gl_FragColor = vec4(vec3(0.86, 0.91, 1.0), a);
  }
`;

export function placed(g: THREE.BufferGeometry, x: number, y: number, z: number, ry = 0, rx = 0) {
  const m = new THREE.Matrix4().compose(
    new THREE.Vector3(x, y, z),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, 0, "YXZ")),
    new THREE.Vector3(1, 1, 1),
  );
  return g.clone().applyMatrix4(m);
}

/**
 * Solid blueprint-black mass with crisp edge lines, matching the building's hidden-line look;
 * given a `real` material it is drawn as a lit, shadowed solid instead.
 */
export function Wire({
  geometry,
  occluder,
  line,
  threshold = 20,
  real,
}: {
  geometry: THREE.BufferGeometry;
  occluder: THREE.Material;
  line: THREE.LineBasicMaterial;
  threshold?: number;
  real?: THREE.Material | null;
}) {
  const edges = useMemo(() => new THREE.EdgesGeometry(geometry, threshold), [geometry, threshold]);
  useEffect(() => () => edges.dispose(), [edges]);
  if (real) {
    // the merged blueprint geometry is position-only; lighting needs (flat) normals
    if (!geometry.getAttribute("normal")) geometry.computeVertexNormals();
    return <mesh geometry={geometry} material={real} castShadow receiveShadow />;
  }
  return (
    <group>
      <mesh geometry={geometry} material={occluder} />
      <lineSegments geometry={edges} material={line} />
    </group>
  );
}

function placardTexture(i: number) {
  if (typeof document === "undefined") return null;
  const p = projects[i];
  const W = 1024;
  const H = 680;
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d");
  if (!ctx || !p) return null;
  ctx.fillStyle = "#04060a";
  ctx.fillRect(0, 0, W, H);
  ctx.strokeStyle = "rgba(255,255,255,0.75)";
  ctx.lineWidth = 4;
  ctx.strokeRect(18, 18, W - 36, H - 36);
  ctx.strokeStyle = "rgba(255,255,255,0.25)";
  ctx.lineWidth = 2;
  ctx.strokeRect(34, 34, W - 68, H - 68);

  const mono = `"JetBrains Mono", "IBM Plex Mono", monospace`;
  ctx.fillStyle = "rgba(255,255,255,0.55)";
  ctx.font = `500 34px ${mono}`;
  ctx.fillText(`SHOWCASE ${String(i + 1).padStart(2, "0")}  ·  ${p.year}`, 70, 110);
  ctx.fillStyle = "#ffffff";
  ctx.font = `700 88px ${mono}`;
  ctx.fillText(p.title.toUpperCase(), 70, 220, W - 140);
  ctx.fillStyle = "rgba(255,255,255,0.7)";
  ctx.font = `500 34px ${mono}`;
  ctx.fillText(p.category.toUpperCase(), 70, 285, W - 140);

  // tagline, wrapped
  ctx.fillStyle = "rgba(255,255,255,0.6)";
  ctx.font = `400 30px ${mono}`;
  const words = p.tagline.split(" ");
  let line = "";
  let y = 370;
  for (const w of words) {
    const test = line ? `${line} ${w}` : w;
    if (ctx.measureText(test).width > W - 140 && line) {
      ctx.fillText(line, 70, y);
      line = w;
      y += 44;
      if (y > 500) break;
    } else line = test;
  }
  if (y <= 500) ctx.fillText(line, 70, y);

  ctx.fillStyle = "rgba(255,255,255,0.25)";
  ctx.fillRect(70, 560, W - 140, 2);
  ctx.fillStyle = "#c8ff3d";
  ctx.font = `600 30px ${mono}`;
  ctx.fillText("[ E ]  INSPECT", 70, 620);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

/**
 * Museum fit-out of the exhibition hall: rope-and-stanchion barriers round each plinth,
 * lecterns with project placards, benches, wall sconces with light washes, warm niche
 * uplights, and volumetric light shafts falling from the skylight onto the marble.
 */
/** True while the pavilion is drawn realistically (and the library to draw it with). */
export function useRealLib() {
  const gl = useThree((s) => s.gl);
  const real = useApp((s) => s.flowRealLive && s.mode === "flow");
  return useMemo(() => (real ? getRealLib(gl) : null), [real, gl]);
}

export default function FlowGalleryDetails() {
  const lib = useRealLib();
  const mats = useMemo(() => {
    const glow = (color: string, intensity: number, mode: number) =>
      new THREE.ShaderMaterial({
        vertexShader: glowVert,
        fragmentShader: glowFrag,
        uniforms: {
          uColor: { value: new THREE.Color(color) },
          uIntensity: { value: intensity },
          uMode: { value: mode },
        },
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
      });
    return {
      occluder: new THREE.MeshBasicMaterial({
        color: 0x020305,
        polygonOffset: true,
        polygonOffsetFactor: 1,
        polygonOffsetUnits: 1,
      }),
      line: new THREE.LineBasicMaterial({ color: 0xf5f7fa, transparent: true, opacity: 0.85, depthWrite: false }),
      soft: new THREE.LineBasicMaterial({ color: 0x8894a8, transparent: true, opacity: 0.7, depthWrite: false }),
      rope: new THREE.LineBasicMaterial({ color: 0xe8d9c4, transparent: true, opacity: 0.85 }),
      bulb: new THREE.MeshBasicMaterial({ color: 0xfff4e6, toneMapped: false }),
      pool: glow("#dfe8ff", 0.16, 0),
      wash: glow("#ffeedd", 0.3, 1),
      uplight: glow("#ffe9d2", 0.22, 2),
      shafts: SHAFT_Z.map(
        (_, i) =>
          new THREE.ShaderMaterial({
            vertexShader: shaftVert,
            fragmentShader: shaftFrag,
            uniforms: { uTime: { value: 0 }, uSeed: { value: i * 1.37 } },
            transparent: true,
            depthWrite: false,
            blending: THREE.AdditiveBlending,
            side: THREE.DoubleSide,
          }),
      ),
    };
  }, []);

  const geos = useMemo(() => {
    // ---- stanchions: 8 posts per ring with finials and weighted bases
    const post = new THREE.CylinderGeometry(0.025, 0.025, 0.9, 8);
    const finial = new THREE.SphereGeometry(0.05, 10, 8);
    const base = new THREE.CylinderGeometry(0.16, 0.18, 0.04, 16);
    const posts: THREE.BufferGeometry[] = [];
    const rope: number[] = [];
    const ropeY = FLOOR + 0.86;
    for (const c of SHOWCASE_CENTERS) {
      const pts: [number, number][] = [];
      for (let k = 0; k < 8; k++) {
        const a = ((k + 0.5) / 8) * Math.PI * 2;
        const px = c.x + Math.cos(a) * ROPE_R;
        const pz = c.z + Math.sin(a) * ROPE_R;
        pts.push([px, pz]);
        posts.push(placed(post, px, FLOOR + 0.47, pz));
        posts.push(placed(finial, px, FLOOR + 0.95, pz));
        posts.push(placed(base, px, FLOOR + 0.02, pz));
      }
      // velvet ropes hang in a shallow catenary between neighbouring posts
      for (let k = 0; k < 8; k++) {
        const [ax, az] = pts[k];
        const [bx, bz] = pts[(k + 1) % 8];
        const seg = 14;
        for (let s = 0; s < seg; s++) {
          for (const t of [s / seg, (s + 1) / seg]) {
            rope.push(ax + (bx - ax) * t, ropeY - 0.16 * 4 * t * (1 - t), az + (bz - az) * t);
          }
        }
      }
    }

    // ---- lecterns: slim column, foot plate and a tilted reading panel
    const lecterns: THREE.BufferGeometry[] = [];
    const panelTilt = -0.62;
    SHOWCASE_CENTERS.forEach((_, i) => {
      const l = lecternFor(i);
      const parts = [
        placed(new THREE.BoxGeometry(0.42, 0.03, 0.32), 0, FLOOR + 0.015, 0),
        placed(new THREE.BoxGeometry(0.07, 0.98, 0.07), 0, FLOOR + 0.5, 0),
        placed(new THREE.BoxGeometry(0.66, 0.46, 0.035), 0, FLOOR + 1.06, 0, 0, panelTilt),
      ];
      const m = new THREE.Matrix4().compose(
        new THREE.Vector3(l.x, 0, l.z),
        new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), l.ry),
        new THREE.Vector3(1, 1, 1),
      );
      for (const p of parts) lecterns.push(p.applyMatrix4(m));
    });

    // ---- benches: thick slab on two plinth legs
    const benches: THREE.BufferGeometry[] = [];
    for (const b of BENCHES) {
      benches.push(placed(new THREE.BoxGeometry(b.hx * 2 + 0.1, 0.08, b.hz * 2 + 0.1), b.x, FLOOR + 0.46, b.z));
      for (const s of [-1, 1]) {
        benches.push(placed(new THREE.BoxGeometry(b.hx * 2 - 0.08, 0.42, 0.14), b.x, FLOOR + 0.21, b.z + s * (b.hz - 0.25)));
      }
    }

    // ---- sconces: back plate, arm and a frosted globe on both walls
    const sconces: THREE.BufferGeometry[] = [];
    const bulbs: THREE.BufferGeometry[] = [];
    for (const side of [-1, 1]) {
      for (const z of SCONCE_Z) {
        const x = side * (WALL_X - 0.02);
        sconces.push(placed(new THREE.BoxGeometry(0.04, 0.42, 0.2), x, FLOOR + 3.3, z));
        sconces.push(placed(new THREE.BoxGeometry(0.22, 0.03, 0.03), x - side * 0.11, FLOOR + 3.3, z));
        bulbs.push(placed(new THREE.SphereGeometry(0.09, 14, 10), x - side * 0.24, FLOOR + 3.34, z));
      }
    }

    const ropeGeo = new THREE.BufferGeometry();
    ropeGeo.setAttribute("position", new THREE.Float32BufferAttribute(rope, 3));
    // the same catenaries as solid velvet cord for the realistic hall
    const cords: THREE.BufferGeometry[] = [];
    const per = 14 * 2 * 3;
    for (let r = 0; r < rope.length; r += per) {
      const pts: THREE.Vector3[] = [];
      for (let k = 0; k < per; k += 6) pts.push(new THREE.Vector3(rope[r + k], rope[r + k + 1], rope[r + k + 2]));
      pts.push(new THREE.Vector3(rope[r + per - 3], rope[r + per - 2], rope[r + per - 1]));
      cords.push(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 16, 0.016, 6, false));
    }

    const out = {
      posts: mergeGeometries(posts)!,
      rope: ropeGeo,
      lecterns: mergeGeometries(lecterns)!,
      benches: mergeGeometries(benches)!,
      sconces: mergeGeometries(sconces)!,
      bulbs: mergeGeometries(bulbs)!,
      cords: mergeGeometries(cords)!,
      shaft: new THREE.CylinderGeometry(1.25, 1.9, 9.1, 24, 1, true),
      plane: new THREE.PlaneGeometry(1, 1),
    };
    [post, finial, base, ...posts, ...lecterns, ...benches, ...sconces, ...bulbs, ...cords].forEach((g) => g.dispose());
    return out;
  }, []);

  const placards = useMemo(() => SHOWCASE_CENTERS.map((_, i) => placardTexture(i)), []);

  useEffect(
    () => () => {
      Object.values(geos).forEach((g) => g.dispose());
      placards.forEach((t) => t?.dispose());
      const { shafts, ...rest } = mats;
      Object.values(rest).forEach((m) => m.dispose());
      shafts.forEach((m) => m.dispose());
    },
    [geos, mats, placards],
  );

  useFrame((state) => {
    for (const m of mats.shafts) m.uniforms.uTime.value = state.clock.elapsedTime;
    // realistic: daylight shafts only in the sun, warm washes come up as it gets dark
    const sunK = lib ? realState.day * 1.1 + realState.rain * 0.2 : 1;
    const dark = lib ? 0.45 + 0.8 * (realState.night + realState.rain * 0.5) : 1;
    mats.pool.uniforms.uIntensity.value = 0.16 * sunK;
    mats.wash.uniforms.uIntensity.value = 0.3 * dark;
    mats.uplight.uniforms.uIntensity.value = 0.22 * dark;
    for (const m of mats.shafts) m.visible = sunK > 0.02;
  });

  return (
    <group>
      <Wire geometry={geos.posts} occluder={mats.occluder} line={mats.soft} threshold={30} real={lib?.brass} />
      {lib ? (
        <mesh geometry={geos.cords} material={lib.velvet} castShadow receiveShadow />
      ) : (
        <lineSegments geometry={geos.rope} material={mats.rope} />
      )}
      <Wire geometry={geos.lecterns} occluder={mats.occluder} line={mats.line} real={lib?.bronzeIn} />
      <Wire geometry={geos.benches} occluder={mats.occluder} line={mats.line} real={lib?.wood} />
      <Wire geometry={geos.sconces} occluder={mats.occluder} line={mats.line} real={lib?.brass} />
      <mesh geometry={geos.bulbs} material={mats.bulb} />

      {/* Placard faces on the lecterns */}
      {SHOWCASE_CENTERS.map((_, i) => {
        const l = lecternFor(i);
        const tex = placards[i];
        if (!tex) return null;
        return (
          <group key={i} position={[l.x, 0, l.z]} rotation-y={l.ry}>
            <mesh position={[0, FLOOR + 1.06, 0]} rotation-x={-0.62}>
              <mesh position={[0, 0, 0.019]}>
                <planeGeometry args={[0.62, 0.41]} />
                <meshBasicMaterial map={tex} toneMapped={false} />
              </mesh>
            </mesh>
          </group>
        );
      })}

      {/* Sconce light washing up and down the wall */}
      {[-1, 1].flatMap((side) =>
        SCONCE_Z.map((z) => (
          <mesh
            key={`w${side}${z}`}
            geometry={geos.plane}
            material={mats.wash}
            position={[side * (WALL_X - 0.03), FLOOR + 3.34, z]}
            rotation-y={side * -Math.PI * 0.5}
            scale={[2.2, 4.6, 1]}
          />
        )),
      )}

      {/* Warm uplight rising up the back of each arched niche */}
      {[-1, 1].flatMap((side) =>
        NICHE_Z.map((z) => (
          <mesh
            key={`n${side}${z}`}
            geometry={geos.plane}
            material={mats.uplight}
            position={[side * (WALL_X + 0.5), FLOOR + 2.6, z]}
            rotation-y={side * -Math.PI * 0.5}
            scale={[3.8, 5.2, 1]}
          />
        )),
      )}

      {/* Skylight shafts and the light they pool on the marble */}
      {SHAFT_Z.map((z, i) => (
        <group key={z}>
          <mesh
            geometry={geos.shaft}
            material={mats.shafts[i]}
            position={[-0.55, FLOOR + 4.55, z]}
            rotation-z={-0.13}
            scale={[1, 1, 1.25]}
          />
          <mesh
            geometry={geos.plane}
            material={mats.pool}
            position={[-1.15, FLOOR + 0.006, z]}
            rotation-x={-Math.PI / 2}
            scale={[4.2, 5.4, 1]}
          />
        </group>
      ))}
    </group>
  );
}
