"use client";

import { useGLTF } from "@react-three/drei";
import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { chapter } from "@/lib/chapters";
import { rng } from "@/lib/random";
import { sceneState } from "@/lib/sceneState";
import { useApp } from "@/store/useApp";
import { dustFrag, dustVert, raysFrag, raysVert } from "../shaders/atmosphere";
import { weatherUniforms } from "../weatherUniforms";
import { bakedFrag, bakedVert, butterflyFrag, butterflyVert, fireflyFrag, fireflyVert } from "../shaders/forest";

export const FOREST_URL = "/models/forest.glb";
/** rune / portal blue */
export const RUNE_BLUE = new THREE.Color("#3d8bff");
/** must match BAKE_SCALE in art/export_intro.py (times a little display exposure) */
export const BAKE_EXPOSURE = 4 * 1.35;

/** Sunlight direction (light travels along this), same as the Blender scene. */
const SUN = new THREE.Vector3(-0.5, -1, -0.1).normalize();
const SHAFTS: { target: [number, number, number]; width: number; strength: number }[] = [
  { target: [0.2, 3.3, 0], width: 1.0, strength: 1 }, // the hero shaft on the arch
  { target: [1.4, 1.2, -1.2], width: 0.45, strength: 0.55 },
  { target: [2.8, 0.5, -3], width: 0.6, strength: 0.45 },
  { target: [-1.6, 0.6, 1.2], width: 0.35, strength: 0.35 },
  { target: [4.2, 1.5, 0.5], width: 0.5, strength: 0.4 },
];

/** A baked-lighting material (optionally with the lime rim the fracture uses). */
export function makeBakedMaterial(side: THREE.Side = THREE.FrontSide) {
  const m = new THREE.ShaderMaterial({
    vertexShader: bakedVert,
    fragmentShader: bakedFrag,
    vertexColors: true,
    fog: true,
    side,
    uniforms: THREE.UniformsUtils.merge([
      THREE.UniformsLib.fog,
      {
        uExposure: { value: BAKE_EXPOSURE },
        uAccent: { value: RUNE_BLUE.clone() },
        uRim: { value: 0 },
        uFill: { value: 0 },
        uTime: { value: 0 },
        uHoverPos: { value: new THREE.Vector3(0, -100, 0) },
        uHoverAmt: { value: 0 },
        uRune: { value: RUNE_BLUE.clone() },
        uRunesAll: { value: 0 },
      },
    ]),
  });
  // shared by reference (merge() would have copied them)
  Object.assign(m.uniforms, weatherUniforms);
  return m;
}

/** Chapter 1 — a ruined arch in a night forest; sun shafts, motes and fireflies. */
export default function Forest() {
  const { nodes } = useGLTF(FOREST_URL, "/draco/") as unknown as { nodes: Record<string, THREE.Object3D> };
  const isMobile = useApp((s) => s.isMobile);
  const dpr = useThree((s) => s.viewport.dpr);
  const group = useRef<THREE.Group>(null);

  const tu = chapter("tunnel");
  const hideAt = tu.start + (tu.end - tu.start) * 0.55;

  const mat = useMemo(() => makeBakedMaterial(THREE.DoubleSide), []);
  const scenery = useMemo(
    () =>
      ["Ground", "Ferns", "BroadLeaves", "Roots", "Rocks", "Trunks"]
        .map((n) => nodes[n] as THREE.Mesh | undefined)
        .filter((m): m is THREE.Mesh => !!m?.isMesh),
    [nodes],
  );

  // light shafts: open cones along the sun direction, narrow at the canopy
  const shaft = useMemo(() => {
    const geometry = new THREE.CylinderGeometry(0.22, 1, 18, 40, 1, true);
    const material = new THREE.ShaderMaterial({
      vertexShader: raysVert,
      fragmentShader: raysFrag,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: {
        uTime: { value: 0 },
        uIntensity: { value: 0 },
        uColor: { value: new THREE.Color("#ffd391") },
      },
    });
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), SUN.clone().negate());
    const placements = SHAFTS.map((s) => {
      // centre the cone so it passes through the target and runs on a few metres past it
      const pos = new THREE.Vector3(...s.target).addScaledVector(SUN, -(9 - 2.5));
      return { pos, scale: new THREE.Vector3(s.width, 1, s.width), strength: s.strength };
    });
    return { geometry, material, q, placements };
  }, []);

  // motes drifting through the beams
  const motes = useMemo(() => {
    const n = isMobile ? 500 : 1300;
    const random = rng(19);
    const pos = new Float32Array(n * 3);
    const rnd = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      pos[i * 3] = (random() - 0.5) * 12;
      pos[i * 3 + 1] = random() * 10;
      pos[i * 3 + 2] = (random() - 0.5) * 10;
      rnd[i] = random();
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    g.setAttribute("aRand", new THREE.BufferAttribute(rnd, 1));
    const m = new THREE.ShaderMaterial({
      vertexShader: dustVert,
      fragmentShader: dustFrag,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: {
        uTime: { value: 0 },
        uSize: { value: 20 },
        uPixelRatio: { value: dpr },
        uBeam: { value: new THREE.Vector3(1.2, 0, 0) },
        uColor: { value: new THREE.Color("#ffe2b0") },
      },
    });
    return { g, m };
  }, [isMobile, dpr]);

  const flies = useMemo(() => {
    const n = isMobile ? 36 : 72;
    const random = rng(41);
    const pos = new Float32Array(n * 3);
    const rnd = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      let x = (random() - 0.5) * 12;
      if (Math.abs(x) < 1.6) x += Math.sign(x || 1) * 2;
      pos[i * 3] = x;
      // mostly low, over the ferns; a few higher up
      pos[i * 3 + 1] = 0.25 + Math.pow(random(), 1.6) * 2.6;
      pos[i * 3 + 2] = 2.5 - random() * 8.5;
      rnd[i] = random();
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    g.setAttribute("aRand", new THREE.BufferAttribute(rnd, 1));
    const m = new THREE.ShaderMaterial({
      vertexShader: fireflyVert,
      fragmentShader: fireflyFrag,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      toneMapped: false,
      uniforms: {
        uTime: { value: 0 },
        uSize: { value: 105 },
        uPixelRatio: { value: dpr },
        uIntensity: { value: 0 },
        uColor: { value: new THREE.Color("#b4ff48") },
      },
    });
    return { g, m };
  }, [isMobile, dpr]);

  useEffect(
    () => () => {
      mat.dispose();
      shaft.geometry.dispose();
      shaft.material.dispose();
      motes.g.dispose();
      motes.m.dispose();
      flies.g.dispose();
      flies.m.dispose();
    },
    [mat, shaft, motes, flies],
  );

  useFrame((_, dt) => {
    const g = group.current;
    if (!g) return;
    g.visible = sceneState.p < hideAt;
    if (!g.visible) return;
    const intro = sceneState.intro;
    const { day, rain } = sceneState.weather;
    shaft.material.uniforms.uTime.value += dt;
    // stronger sunbeams by day, none under the storm clouds
    shaft.material.uniforms.uIntensity.value = 0.16 * (0.35 + 0.65 * intro) * (1 + 0.8 * day) * (1 - rain);
    motes.m.uniforms.uTime.value += dt;
    motes.m.uniforms.uSize.value = 20 * (1 - rain);
    flies.m.uniforms.uTime.value += dt;
    // fireflies are a night thing; a few still glow in the rain
    flies.m.uniforms.uIntensity.value = intro * (1 - day) * (1 - 0.6 * rain);
  });

  return (
    <group ref={group}>
      {scenery.map((m) => (
        <mesh key={m.name} geometry={m.geometry} material={mat} position={m.position} quaternion={m.quaternion} />
      ))}
      {shaft.placements.map((s, i) => (
        <mesh
          key={i}
          geometry={shaft.geometry}
          material={shaft.material}
          position={s.pos}
          quaternion={shaft.q}
          scale={s.scale}
          renderOrder={5}
        />
      ))}
      <points geometry={motes.g} material={motes.m} frustumCulled={false} />
      <points geometry={flies.g} material={flies.m} frustumCulled={false} renderOrder={6} />
      <Butterflies count={isMobile ? 5 : 9} />
    </group>
  );
}

// ------------------------------------------------------------------ butterflies
/** Right wing outline (x out from the body, z forward), fore- and hindwing in one. */
const WING: [number, number][] = [
  [0.02, 0.12], [0.3, 0.5], [0.62, 0.62], [0.9, 0.52], [1.0, 0.3], [0.86, 0.08],
  [0.6, -0.02], [0.72, -0.28], [0.64, -0.56], [0.42, -0.72], [0.2, -0.66], [0.04, -0.3],
];
const SPAN = 0.12; // half wingspan in metres (a touch larger than life, so they read from the path)

function butterflyGeometry() {
  const pos: number[] = [];
  const side: number[] = [];
  const edge: number[] = [];
  const wing: number[] = [];
  for (const sd of [-1, 1]) {
    // fan from a point near the hinge; aEdge is 1 there, 0 on the outline
    const c: [number, number] = [0.3, -0.05];
    for (let i = 0; i < WING.length; i++) {
      const a = WING[i];
      const b = WING[(i + 1) % WING.length];
      for (const [x, z, e] of [
        [c[0], c[1], 1],
        [a[0], a[1], 0],
        [b[0], b[1], 0],
      ] as const) {
        pos.push(sd * x * SPAN, 0, z * SPAN);
        side.push(sd);
        edge.push(e);
        wing.push(x, z);
      }
    }
  }
  // the body: a thin dark sliver
  const body: [number, number][] = [[-0.012, 0.5], [0.012, 0.5], [0.012, -0.6], [-0.012, 0.5], [0.012, -0.6], [-0.012, -0.6]];
  for (const [x, z] of body) {
    pos.push(x, 0.002, z * SPAN);
    side.push(0);
    edge.push(1);
    wing.push(0, 0);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("aSide", new THREE.Float32BufferAttribute(side, 1));
  g.setAttribute("aEdge", new THREE.Float32BufferAttribute(edge, 1));
  g.setAttribute("aWing", new THREE.Float32BufferAttribute(wing, 2));
  return g;
}

type Flight = { c: THREE.Vector3; amp: THREE.Vector3; f: THREE.Vector3; ph: THREE.Vector3 };

/** Small blue butterflies flitting around the arch: wandering paths, flapping, now and then gliding. */
export function Butterflies({ count }: { count: number }) {
  const mesh = useRef<THREE.InstancedMesh>(null);

  const { geometry, material, flights } = useMemo(() => {
    const random = rng(77);
    const geometry = butterflyGeometry();
    geometry.setAttribute("aPhase", new THREE.InstancedBufferAttribute(Float32Array.from({ length: count }, () => random() * 6.28), 1));
    // 6–9 wingbeats a second
    geometry.setAttribute("aRate", new THREE.InstancedBufferAttribute(Float32Array.from({ length: count }, () => 38 + random() * 18), 1));
    const material = new THREE.ShaderMaterial({
      vertexShader: butterflyVert,
      fragmentShader: butterflyFrag,
      side: THREE.DoubleSide,
      fog: true,
      uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { uTime: { value: 0 }, uIntensity: { value: 0 } }]),
    });
    const flights: Flight[] = Array.from({ length: count }, () => ({
      // loiter around the arch, the ferns and the sunbeam
      c: new THREE.Vector3((random() - 0.5) * 5, 1 + random() * 1.8, (random() - 0.5) * 3 + 0.5),
      amp: new THREE.Vector3(0.8 + random() * 1.4, 0.3 + random() * 0.5, 0.6 + random() * 1.0),
      f: new THREE.Vector3(0.07 + random() * 0.08, 0.11 + random() * 0.1, 0.06 + random() * 0.07),
      ph: new THREE.Vector3(random() * 6.28, random() * 6.28, random() * 6.28),
    }));
    return { geometry, material, flights };
  }, [count]);

  useEffect(
    () => () => {
      geometry.dispose();
      material.dispose();
    },
    [geometry, material],
  );

  const tmp = useMemo(() => ({ o: new THREE.Object3D(), p: new THREE.Vector3(), q: new THREE.Vector3() }), []);
  const at = (fl: Flight, t: number, out: THREE.Vector3) =>
    out.set(
      fl.c.x + Math.sin(t * fl.f.x + fl.ph.x) * fl.amp.x + Math.sin(t * fl.f.x * 2.7 + fl.ph.y) * fl.amp.x * 0.25,
      fl.c.y + Math.sin(t * fl.f.y + fl.ph.y) * fl.amp.y + Math.sin(t * 3.1 + fl.ph.z) * 0.04,
      fl.c.z + Math.cos(t * fl.f.z + fl.ph.z) * fl.amp.z,
    );

  useFrame(({ clock }) => {
    const im = mesh.current;
    if (!im) return;
    if (im.parent && !im.parent.visible) return;
    if (im.parent?.parent && !im.parent.parent.visible) return;
    const t = clock.elapsedTime;
    material.uniforms.uTime.value = t;
    material.uniforms.uIntensity.value = 0.25 + 0.75 * sceneState.intro;
    // the butterflies take shelter from the rain
    const shelter = 1 - sceneState.weather.rain;
    flights.forEach((fl, i) => {
      at(fl, t, tmp.p);
      at(fl, t + 0.15, tmp.q);
      tmp.o.position.copy(tmp.p);
      tmp.o.lookAt(tmp.q);
      // bank into turns and pitch a little with the flutter
      const turn = Math.sin(t * fl.f.x + fl.ph.x + 1.57);
      tmp.o.rotateZ(turn * 0.35);
      tmp.o.rotateX(-0.25 + Math.sin(t * 7 + fl.ph.x) * 0.08);
      tmp.o.scale.setScalar(shelter);
      tmp.o.updateMatrix();
      im.setMatrixAt(i, tmp.o.matrix);
    });
    im.instanceMatrix.needsUpdate = true;
  });

  return <instancedMesh ref={mesh} args={[geometry, material, count]} frustumCulled={false} renderOrder={4} />;
}

useGLTF.preload(FOREST_URL, "/draco/");
