"use client";

import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo } from "react";
import * as THREE from "three";
import { PROJECTS_ORIGIN } from "@/lib/chapters";
import { perlin } from "@/lib/perlin";
import { rng } from "@/lib/random";
import { sceneState } from "@/lib/sceneState";
import { useApp } from "@/store/useApp";
import { grassFrag, grassVert } from "../shaders/valley";
import { bankHeight } from "../valley";

const SEGMENTS = 5;
const raycaster = new THREE.Raycaster();
const ndc = new THREE.Vector2();
const canHover = typeof matchMedia !== "undefined" && matchMedia("(hover: hover) and (pointer: fine)").matches;

/** One blade: pairs of vertices up its length, closing to a single tip. */
function bladeGeometry() {
  const t: number[] = [];
  const side: number[] = [];
  for (let i = 0; i < SEGMENTS; i++) {
    t.push(i / SEGMENTS, i / SEGMENTS);
    side.push(-1, 1);
  }
  t.push(1);
  side.push(0);
  const index: number[] = [];
  for (let i = 0; i < SEGMENTS - 1; i++) {
    const a = i * 2;
    index.push(a, a + 1, a + 2, a + 2, a + 1, a + 3);
  }
  const last = (SEGMENTS - 1) * 2;
  index.push(last, last + 1, last + 2);
  const g = new THREE.InstancedBufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(new Array(t.length * 3).fill(0), 3));
  g.setAttribute("aT", new THREE.Float32BufferAttribute(t, 1));
  g.setAttribute("aSide", new THREE.Float32BufferAttribute(side, 1));
  g.setIndex(index);
  return g;
}

/**
 * A meadow on the river banks (local units): clumps of tall grass, thicker toward the water's
 * edge and the camera, sparse up the hills. Blades sway in the wind and part around the cursor.
 */
export default function Grass({ tint, time }: { tint: THREE.IUniform<THREE.Color>; time: THREE.IUniform<number> }) {
  const isMobile = useApp((s) => s.isMobile);

  const geometry = useMemo(() => {
    const count = isMobile ? 30000 : 75000;
    const random = rng(83);
    const clumps = perlin(91);
    const roots = new Float32Array(count * 3);
    const blades = new Float32Array(count * 4);
    let n = 0;
    for (let tries = 0; n < count && tries < count * 8; tries++) {
      // more of the meadow near the camera and along the banks it looks across
      const x = (random() - 0.5) * 52;
      const z = 4 - Math.pow(random(), 1.25) * 26;
      const y = bankHeight(x, z);
      if (y < 0.02) continue; // the river (and its wet edge)
      // clumps and bare patches; fewer blades up the hills
      const c = clumps(x * 0.35, z * 0.35) * 0.5 + 0.5;
      const keep = Math.pow(c, 1.6) * 1.5 * (1 - Math.min(0.7, y * 0.18));
      if (random() > keep) continue;
      // steep ground stays bare
      const slope = Math.hypot(bankHeight(x + 0.3, z) - y, bankHeight(x, z + 0.3) - y) / 0.3;
      if (slope > 0.9) continue;
      roots.set([x, y - 0.02, z], n * 3);
      const tall = 0.32 + random() * 0.38 + c * 0.35;
      blades.set([tall, 0.025 + random() * 0.03, random() * Math.PI * 2, random()], n * 4);
      n++;
    }
    const g = bladeGeometry();
    g.setAttribute("aRoot", new THREE.InstancedBufferAttribute(roots.subarray(0, n * 3), 3));
    g.setAttribute("aBlade", new THREE.InstancedBufferAttribute(blades.subarray(0, n * 4), 4));
    g.instanceCount = n;
    return g;
  }, [isMobile]);

  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader: grassVert,
        fragmentShader: grassFrag,
        side: THREE.DoubleSide,
        uniforms: {
          uTime: time,
          uTint: tint,
          uCrystal: { value: new THREE.Vector3(PROJECTS_ORIGIN[0], PROJECTS_ORIGIN[1] + 1.85, PROJECTS_ORIGIN[2]) },
          uOrigin: { value: new THREE.Vector3(...PROJECTS_ORIGIN) },
          uRayO: { value: new THREE.Vector3() },
          uRayD: { value: new THREE.Vector3(0, -1, 0) },
          uPush: { value: 0 },
        },
      }),
    [time, tint],
  );

  useEffect(
    () => () => {
      geometry.dispose();
      material.dispose();
    },
    [geometry, material],
  );

  // the cursor ray, smoothed so the grass trails the pointer; it presses harder while moving
  const s = useMemo(() => ({ x: 0, y: 0, px: 0, py: 0, energy: 0 }), []);
  useFrame(({ camera }, dt) => {
    if (!canHover) return;
    const { x, y } = sceneState.mouse;
    const k = Math.min(1, dt * 8);
    s.x += (x - s.x) * k;
    s.y += (y - s.y) * k;
    const speed = Math.hypot(x - s.px, y - s.py) / Math.max(dt, 1e-3);
    s.px = x;
    s.py = y;
    const target = 0.55 + 0.45 * Math.min(1, speed * 0.8);
    s.energy += (target - s.energy) * Math.min(1, dt * (target > s.energy ? 6 : 1.5));
    ndc.set(s.x, s.y);
    raycaster.setFromCamera(ndc, camera);
    material.uniforms.uRayO.value.copy(raycaster.ray.origin);
    material.uniforms.uRayD.value.copy(raycaster.ray.direction);
    material.uniforms.uPush.value = s.energy;
  });

  // drawn before the ground, so the ground hidden behind the blades is never shaded
  return <mesh geometry={geometry} material={material} frustumCulled={false} renderOrder={-1} />;
}
