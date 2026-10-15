"use client";

import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { PROJECTS_ORIGIN } from "@/lib/chapters";
import { perlin } from "@/lib/perlin";
import { rng } from "@/lib/random";
import { sceneState } from "@/lib/sceneState";
import { useApp } from "@/store/useApp";
import { riverInside } from "../river";
import { fireflyFrag, fireflyVert } from "../shaders/forest";
import { flowerFrag, flowerVert, mushroomFrag, mushroomVert, poolFrag, poolVert } from "../shaders/meadow";
import { valleyLight } from "../shaders/night";
import { bankHeight, type Cluster } from "../valley";
import { Butterflies } from "./Forest";

type Env = { uTime: THREE.IUniform<number>; uTint: THREE.IUniform<THREE.Color> };
/** The cursor, as the grass sees it (Grass keeps these up to date). */
export type Cursor = { uRayO: THREE.IUniform<THREE.Vector3>; uRayD: THREE.IUniform<THREE.Vector3>; uPush: THREE.IUniform<number> };

const CRYSTAL = new THREE.Vector3(PROJECTS_ORIGIN[0], PROJECTS_ORIGIN[1] + 1.85, PROJECTS_ORIGIN[2]);
const ORIGIN = new THREE.Vector3(...PROJECTS_ORIGIN);
const PETALS = 5;

/** One wildflower: stem, five petals, a centre (see flowerVert for the attributes). */
function flowerGeometry() {
  const part: number[] = [];
  const t: number[] = [];
  const petal: number[] = [];
  const v = (pa: number, tt: number, a: number, r: number, w: number) => {
    part.push(pa);
    t.push(tt);
    petal.push(a, r, w);
  };
  const SEG = 4;
  for (let i = 0; i < SEG; i++) {
    const [a, b] = [i / SEG, (i + 1) / SEG];
    for (const [tt, w] of [[a, -1], [a, 1], [b, -1], [b, -1], [a, 1], [b, 1]]) v(0, tt, 0, 0, w);
  }
  // petals: a rounded blade from the centre outward (r along it, w across it)
  const shape: [number, number][][] = [
    [[0, 0], [0.35, -0.2], [0.35, 0.2]],
    [[0.35, -0.2], [0.75, -0.18], [0.35, 0.2]],
    [[0.35, 0.2], [0.75, -0.18], [0.75, 0.18]],
    [[0.75, -0.18], [1, 0], [0.75, 0.18]],
  ];
  for (let k = 0; k < PETALS; k++) {
    const a = (k / PETALS) * Math.PI * 2;
    for (const tri of shape) for (const [r, w] of tri) v(1, 1, a, r, w);
  }
  // the centre: a little domed disc
  for (let k = 0; k < 8; k++) {
    const [a, b] = [(k / 8) * Math.PI * 2, ((k + 1) / 8) * Math.PI * 2];
    for (const [aa, r] of [[a, 0], [a, 1], [b, 1]]) v(2, 1, aa, r, 0);
  }
  const g = new THREE.InstancedBufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(new Array(part.length * 3).fill(0), 3));
  g.setAttribute("aPart", new THREE.Float32BufferAttribute(part, 1));
  g.setAttribute("aT", new THREE.Float32BufferAttribute(t, 1));
  g.setAttribute("aPetal", new THREE.Float32BufferAttribute(petal, 3));
  return g;
}

/** One mushroom (about 25 cm tall at scale 1): stem, a domed cap, gills underneath. */
function mushroomGeometry() {
  const tag = (g: THREE.BufferGeometry, part: number, uvY: (p: THREE.Vector3) => number) => {
    const n = g.index ? g.toNonIndexed() : g;
    n.deleteAttribute("uv");
    const pos = n.attributes.position as THREE.BufferAttribute;
    const p = new THREE.Vector3();
    const uv = new Float32Array(pos.count * 2);
    for (let i = 0; i < pos.count; i++) uv[i * 2 + 1] = uvY(p.fromBufferAttribute(pos, i));
    n.setAttribute("aUV", new THREE.BufferAttribute(uv, 2));
    n.setAttribute("aPart", new THREE.BufferAttribute(new Float32Array(pos.count).fill(part), 1));
    return n;
  };
  const stem = new THREE.CylinderGeometry(0.016, 0.024, 0.16, 10, 3, true).translate(0, 0.08, 0);
  const profile: THREE.Vector2[] = [];
  for (let k = 0; k <= 10; k++) {
    const phi = (k / 10) * (Math.PI / 2);
    profile.push(new THREE.Vector2(0.075 * Math.pow(Math.cos(phi), 0.7) + 1e-3, 0.152 + 0.055 * Math.sin(phi)));
  }
  const cap = new THREE.LatheGeometry(profile.reverse(), 18);
  const gills = new THREE.RingGeometry(0.016, 0.075, 18, 2).rotateX(Math.PI / 2).translate(0, 0.152, 0);
  const parts = [
    tag(stem, 0, (p) => p.y / 0.16),
    tag(cap, 1, (p) => 1 - (p.y - 0.152) / 0.055),
    tag(gills, 2, (p) => Math.hypot(p.x, p.z) / 0.075),
  ];
  const g = mergeGeometries(parts)!;
  parts.forEach((p) => p.dispose());
  return g;
}

/**
 * Life on the banks: wildflowers in the grass, glowing mushrooms in little clearings,
 * fireflies after dark and butterflies by day (and a few glowing ones at night).
 */
export default function Meadow({ env, cursor, clusters }: { env: Env; cursor: Cursor; clusters: Cluster[] }) {
  const isMobile = useApp((s) => s.isMobile);
  const low = useApp((s) => s.quality === "low");
  const dpr = useThree((s) => s.viewport.dpr);
  const mushrooms = useRef<THREE.InstancedMesh>(null);
  const pools = useRef<THREE.InstancedMesh>(null);

  const common = useMemo(
    () => ({
      ...valleyLight,
      uTime: env.uTime,
      uTint: env.uTint,
      uCrystal: { value: CRYSTAL },
      uOrigin: { value: ORIGIN },
      uRayO: cursor.uRayO,
      uRayD: cursor.uRayD,
      uPush: cursor.uPush,
    }),
    [env, cursor],
  );

  // wildflowers, in patches of a kind, standing a little above the grass
  const flowers = useMemo(() => {
    const count = (isMobile ? 700 : 1800) * (low ? 0.5 : 1);
    const random = rng(211);
    const patch = perlin(212);
    const roots = new Float32Array(count * 3);
    const data = new Float32Array(count * 4);
    let n = 0;
    for (let tries = 0; n < count && tries < count * 30; tries++) {
      const x = (random() - 0.5) * 40;
      const z = 3 - Math.pow(random(), 1.2) * 22;
      const y = bankHeight(x, z);
      if (y < 0.04 || -riverInside(x, z) < 0.4) continue;
      const p = patch(x * 0.25, z * 0.25);
      if (random() > Math.max(0, p) * 2.2) continue;
      if (clusters.some((c) => Math.hypot(c.x - x, c.z - z) < c.r + 0.15)) continue;
      roots.set([x, y - 0.02, z], n * 3);
      // one kind per patch, mostly: the colour pick follows a slow noise
      const pick = Math.min(0.999, Math.max(0, patch(x * 0.07 + 9, z * 0.07) * 0.6 + 0.5 + (random() - 0.5) * 0.15));
      data.set([0.45 + random() * 0.45, 0.045 + random() * 0.035, pick, random()], n * 4);
      n++;
    }
    const geometry = flowerGeometry();
    geometry.setAttribute("aRoot", new THREE.InstancedBufferAttribute(roots.subarray(0, n * 3), 3));
    geometry.setAttribute("aFlower", new THREE.InstancedBufferAttribute(data.subarray(0, n * 4), 4));
    geometry.instanceCount = n;
    const material = new THREE.ShaderMaterial({
      vertexShader: flowerVert,
      fragmentShader: flowerFrag,
      side: THREE.DoubleSide,
      uniforms: common,
    });
    return { geometry, material };
  }, [isMobile, low, clusters, common]);

  // mushrooms in their clearings
  const shrooms = useMemo(() => {
    const geometry = mushroomGeometry();
    const material = new THREE.ShaderMaterial({
      vertexShader: mushroomVert,
      fragmentShader: mushroomFrag,
      side: THREE.DoubleSide,
      uniforms: common,
    });
    const poolMaterial = new THREE.ShaderMaterial({
      vertexShader: poolVert,
      fragmentShader: poolFrag,
      uniforms: common,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    const random = rng(307);
    const items: { x: number; z: number; s: number; tilt: number; yaw: number }[] = [];
    for (const c of clusters)
      for (let i = 0; i < c.n; i++) {
        const a = random() * Math.PI * 2;
        const d = Math.sqrt(random()) * c.r;
        // a big one or two in each cluster, the rest small
        const s = (i === 0 ? 1.6 : 0.7 + random() * 0.7) * (0.9 + c.seed * 0.5);
        items.push({ x: c.x + Math.cos(a) * d, z: c.z + Math.sin(a) * d, s, tilt: (random() - 0.5) * 0.35, yaw: random() * 6.28 });
      }
    return { geometry, material, poolMaterial, items, plane: new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2) };
  }, [clusters, common]);

  useEffect(() => {
    const o = new THREE.Object3D();
    const im = mushrooms.current;
    if (im) {
      shrooms.items.forEach((it, i) => {
        o.position.set(it.x, bankHeight(it.x, it.z) - 0.01, it.z);
        o.rotation.set(it.tilt, it.yaw, it.tilt * 0.6);
        o.scale.setScalar(it.s);
        o.updateMatrix();
        im.setMatrixAt(i, o.matrix);
      });
      im.instanceMatrix.needsUpdate = true;
    }
    const pm = pools.current;
    if (pm) {
      clusters.forEach((c, i) => {
        o.position.set(c.x, c.y + 0.03, c.z);
        o.rotation.set(0, 0, 0);
        o.scale.setScalar(c.r * 3.2 + 0.6);
        o.updateMatrix();
        pm.setMatrixAt(i, o.matrix);
      });
      pm.instanceMatrix.needsUpdate = true;
    }
  }, [shrooms, clusters]);

  // fireflies drifting over the banks and the water
  const flies = useMemo(() => {
    const n = isMobile ? 70 : 150;
    const random = rng(401);
    const pos = new Float32Array(n * 3);
    const rnd = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const x = (random() - 0.5) * 26;
      const z = 3 - random() * 18;
      pos.set([x, Math.max(0, bankHeight(x, z)) + 0.25 + Math.pow(random(), 1.5) * 1.6, z], i * 3);
      rnd[i] = random();
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    geometry.setAttribute("aRand", new THREE.BufferAttribute(rnd, 1));
    const material = new THREE.ShaderMaterial({
      vertexShader: fireflyVert,
      fragmentShader: fireflyFrag,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      toneMapped: false,
      uniforms: {
        uTime: env.uTime,
        uSize: { value: 90 },
        uPixelRatio: { value: dpr },
        uIntensity: { value: 0 },
        uColor: { value: new THREE.Color("#c4ff5a") },
      },
    });
    return { geometry, material };
  }, [isMobile, dpr, env]);

  useEffect(
    () => () => {
      flowers.geometry.dispose();
      flowers.material.dispose();
      shrooms.geometry.dispose();
      shrooms.material.dispose();
      shrooms.poolMaterial.dispose();
      shrooms.plane.dispose();
      flies.geometry.dispose();
      flies.material.dispose();
    },
    [flowers, shrooms, flies],
  );

  useFrame(() => {
    const { day, rain } = sceneState.valley;
    flies.material.uniforms.uIntensity.value = (1 - day) * (1 - 0.65 * rain);
  });

  const butterflyArea = useMemo(() => ({ centre: [0.5, 1.1, -3.5] as [number, number, number], spread: [14, 1.2, 9] as [number, number, number] }), []);
  // by day in full colour; at night a few faint glowing ones; none in the rain
  const butterflyWeather = useMemo(
    () => () => ({ shelter: sceneState.valley.rain, glow: 0.35 + 0.65 * sceneState.valley.day }),
    [],
  );

  return (
    <>
      <mesh geometry={flowers.geometry} material={flowers.material} frustumCulled={false} renderOrder={-1} />
      <instancedMesh ref={mushrooms} args={[shrooms.geometry, shrooms.material, shrooms.items.length]} frustumCulled={false} />
      <instancedMesh ref={pools} args={[shrooms.plane, shrooms.poolMaterial, clusters.length]} frustumCulled={false} renderOrder={9} />
      <points geometry={flies.geometry} material={flies.material} frustumCulled={false} renderOrder={10} />
      <Butterflies count={isMobile ? 6 : 12} area={butterflyArea} weather={butterflyWeather} />
    </>
  );
}
