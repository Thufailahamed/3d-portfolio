"use client";

import { useGLTF } from "@react-three/drei";
import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { ABOUT_ORIGIN, chapter, local } from "@/lib/chapters";
import { rng } from "@/lib/random";
import { sceneState } from "@/lib/sceneState";
import { useApp } from "@/store/useApp";
import { palette } from "../palette";
import { bloomCoreFrag, bloomCoreVert, petalFrag, petalVert, ribbonFrag, ribbonVert } from "../shaders/about";

export const BLOOM_URL = "/models/bloom.glb";
const HEAD_Y = 2.75;
const SEG = 180;

const ease = (t: number) => t * t * (3 - 2 * t);
const seg = (t: number, a: number, b: number) => ease(THREE.MathUtils.clamp((t - a) / (b - a), 0, 1));

/**
 * Chapter 5 — light ribbons sweep through the dark, gather into a braided stem,
 * and a bloom of glass petals unfolds on top of it. All scroll-scrubbed.
 */
export default function About() {
  const group = useRef<THREE.Group>(null);
  const isMobile = useApp((s) => s.isMobile);
  const c = chapter("about");

  useFrame(() => {
    if (group.current) group.current.visible = sceneState.p >= c.start - 0.001 && sceneState.p <= c.end + 0.002;
  });

  return (
    <group ref={group} position={ABOUT_ORIGIN} visible={false}>
      <Ribbons count={isMobile ? 6 : 9} />
      <Bloom />
    </group>
  );
}

// ------------------------------------------------------------------ ribbons
type Ribbon = {
  geometry: THREE.BufferGeometry;
  material: THREE.ShaderMaterial;
  wild: Float32Array;
  conv: Float32Array;
  delay: number;
  lastK: number;
  buf: Float32Array;
};

const COLORS = ["#c8ff3d", "#f4f1e8", "#c8ff3d", "#a9d4ff", "#c8ff3d", "#f4f1e8"];

function Ribbons({ count }: { count: number }) {
  const ribbons = useMemo<Ribbon[]>(() => {
    const random = rng(71);
    const r = (a: number, b: number) => a + random() * (b - a);
    const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

    return Array.from({ length: count }, (_, i) => {
      const side = i % 2 ? 1 : -1;
      // sweeping path across the camera's view, off-screen at both ends
      const start = V(side * 16, r(0.5, 5.5), r(-6, 4));
      const curve = new THREE.CatmullRomCurve3(
        [
          start,
          V(side * 7, r(1, 5), r(-2, 7)),
          V(r(-2.5, 2.5), r(1, 4.5), r(-3, 8)),
          V(-side * 6, r(0.5, 5), r(-4, 6)),
          V(-side * 15, r(1, 5), r(-8, 2)),
        ],
        false,
        "centripetal",
      );
      const wild = new Float32Array(SEG * 3);
      const conv = new Float32Array(SEG * 3);
      const tmp = new THREE.Vector3();

      // converged path: spiral in from the same start, then climb the stem as one strand of a braid
      const a0 = Math.atan2(start.z, start.x);
      const r0 = Math.hypot(start.x, start.z);
      const phase = (i / count) * Math.PI * 2;
      const aEnd = phase;
      const aStart = aEnd - side * Math.PI * 2 * 0.9;
      const SPLIT = 0.55;
      for (let j = 0; j < SEG; j++) {
        const s = j / (SEG - 1);
        curve.getPoint(s, tmp);
        tmp.toArray(wild, j * 3);
        let x: number, y: number, z: number;
        if (s < SPLIT) {
          const u = s / SPLIT;
          const e = ease(u);
          // blend from the start's own angle into the spiral so the tail doesn't jump
          const a = THREE.MathUtils.lerp(a0, aStart, Math.min(1, u * 4)) + (aEnd - aStart) * u;
          const rr = THREE.MathUtils.lerp(r0, 0.09, e);
          x = Math.cos(a) * rr;
          z = Math.sin(a) * rr;
          y = THREE.MathUtils.lerp(start.y, 0.05, e);
        } else {
          const u = (s - SPLIT) / (1 - SPLIT);
          const a = aEnd + side * u * Math.PI * 2.5;
          const rr = 0.09 - 0.045 * u;
          x = Math.cos(a) * rr;
          z = Math.sin(a) * rr;
          y = 0.05 + u * (HEAD_Y - 0.1);
        }
        conv[j * 3] = x;
        conv[j * 3 + 1] = y;
        conv[j * 3 + 2] = z;
      }

      const geometry = new THREE.BufferGeometry();
      const pos = new Float32Array(SEG * 2 * 3);
      const tan = new Float32Array(SEG * 2 * 3);
      const aS = new Float32Array(SEG * 2);
      const aSide = new Float32Array(SEG * 2);
      const index: number[] = [];
      for (let j = 0; j < SEG; j++) {
        aS[j * 2] = aS[j * 2 + 1] = j / (SEG - 1);
        aSide[j * 2] = -1;
        aSide[j * 2 + 1] = 1;
        if (j < SEG - 1) {
          const a = j * 2;
          index.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
        }
      }
      geometry.setAttribute("position", new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
      geometry.setAttribute("aTangent", new THREE.BufferAttribute(tan, 3).setUsage(THREE.DynamicDrawUsage));
      geometry.setAttribute("aS", new THREE.BufferAttribute(aS, 1));
      geometry.setAttribute("aSide", new THREE.BufferAttribute(aSide, 1));
      geometry.setIndex(index);

      const material = new THREE.ShaderMaterial({
        vertexShader: ribbonVert,
        fragmentShader: ribbonFrag,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
        toneMapped: false,
        uniforms: {
          uTime: { value: 0 },
          uWidth: { value: r(0.07, 0.2) },
          uK: { value: 0 },
          uSeed: { value: random() * 10 },
          uHead: { value: 0 },
          uIntensity: { value: 1.1 },
          uColor: { value: new THREE.Color(COLORS[i % COLORS.length]) },
        },
      });
      return { geometry, material, wild, conv, delay: random(), lastK: -1, buf: new Float32Array(SEG * 3) };
    });
  }, [count]);

  useEffect(
    () => () => {
      for (const r of ribbons) {
        r.geometry.dispose();
        r.material.dispose();
      }
    },
    [ribbons],
  );

  useFrame((_, dt) => {
    const t = local(sceneState.p, "about");
    for (let i = 0; i < ribbons.length; i++) {
      const rb = ribbons[i];
      const u = rb.material.uniforms;
      u.uTime.value += dt;
      // heads draw across the screen one after another
      const d = rb.delay * 0.12;
      u.uHead.value = seg(t, 0.015 + d, 0.2 + d) * 1.02;
      const k = seg(t, 0.46 + i * 0.012, 0.7 + i * 0.012);
      u.uK.value = k;
      if (Math.abs(k - rb.lastK) < 1e-4) continue;
      rb.lastK = k;
      writeRibbon(rb, k);
    }
  });

  return (
    <>
      {ribbons.map((r, i) => (
        <mesh key={i} geometry={r.geometry} material={r.material} frustumCulled={false} renderOrder={3} />
      ))}
    </>
  );
}

/** Blend the wild and converged centrelines and recompute tangents. */
function writeRibbon(rb: Ribbon, k: number) {
  const pos = rb.geometry.attributes.position as THREE.BufferAttribute;
  const tan = rb.geometry.attributes.aTangent as THREE.BufferAttribute;
  const P = pos.array as Float32Array;
  const T = tan.array as Float32Array;
  const { wild, conv } = rb;
  const c = rb.buf;
  for (let j = 0; j < SEG * 3; j++) c[j] = wild[j] + (conv[j] - wild[j]) * k;
  for (let j = 0; j < SEG; j++) {
    const a = Math.max(0, j - 1) * 3;
    const b = Math.min(SEG - 1, j + 1) * 3;
    let tx = c[b] - c[a];
    let ty = c[b + 1] - c[a + 1];
    let tz = c[b + 2] - c[a + 2];
    const l = Math.hypot(tx, ty, tz) || 1;
    tx /= l;
    ty /= l;
    tz /= l;
    for (let s = 0; s < 2; s++) {
      const o = (j * 2 + s) * 3;
      P[o] = c[j * 3];
      P[o + 1] = c[j * 3 + 1];
      P[o + 2] = c[j * 3 + 2];
      T[o] = tx;
      T[o + 1] = ty;
      T[o + 2] = tz;
    }
  }
  pos.needsUpdate = true;
  tan.needsUpdate = true;
}

// ------------------------------------------------------------------ bloom
type Petal = { az: number; len: number; closed: number; open: number; ring: number; jitter: number };

const RINGS = [
  { n: 7, len: 0.72, closed: 0.12, open: 0.7, r: 0.04 },
  { n: 8, len: 1.0, closed: 0.18, open: 1.12, r: 0.08 },
  { n: 9, len: 1.32, closed: 0.24, open: 1.55, r: 0.12 },
];
/** petal tip in the model's own space (glTF: grows along +Y, curls to +Z) */
const TIP = new THREE.Vector3(0, 1, 0.32);

function Bloom() {
  const { nodes } = useGLTF(BLOOM_URL, "/draco/") as unknown as { nodes: Record<string, THREE.Mesh> };
  const mesh = useRef<THREE.InstancedMesh>(null);
  const core = useRef<THREE.Mesh>(null);
  const camera = useThree((s) => s.camera);
  const size = useThree((s) => s.size);

  const petals = useMemo<Petal[]>(() => {
    const random = rng(97);
    const out: Petal[] = [];
    let k = 0;
    RINGS.forEach((ring, ri) => {
      for (let i = 0; i < ring.n; i++) {
        out.push({
          az: k * 2.39996 + random() * 0.2,
          len: ring.len * (0.9 + random() * 0.2),
          closed: ring.closed,
          open: ring.open * (0.92 + random() * 0.16),
          ring: ri,
          jitter: random(),
        });
        k++;
      }
    });
    return out;
  }, []);

  const { petalMat, coreMat, geometry } = useMemo(() => {
    const geometry = nodes.Petal.geometry.clone();
    geometry.setAttribute(
      "aIdx",
      new THREE.InstancedBufferAttribute(Float32Array.from(petals, (_, i) => i), 1),
    );
    return {
      geometry,
      petalMat: new THREE.ShaderMaterial({
        vertexShader: petalVert,
        fragmentShader: petalFrag,
        side: THREE.DoubleSide,
        toneMapped: false,
        uniforms: { uTime: { value: 0 }, uGlow: { value: 0 }, uAccent: { value: palette.accent.clone() } },
      }),
      coreMat: new THREE.ShaderMaterial({
        vertexShader: bloomCoreVert,
        fragmentShader: bloomCoreFrag,
        toneMapped: false,
        uniforms: { uTime: { value: 0 }, uGlow: { value: 0 }, uAccent: { value: palette.accent.clone() } },
      }),
    };
  }, [nodes, petals]);

  useEffect(
    () => () => {
      geometry.dispose();
      petalMat.dispose();
      coreMat.dispose();
    },
    [geometry, petalMat, coreMat],
  );

  const tmp = useMemo(
    () => ({
      m: new THREE.Matrix4(),
      q: new THREE.Quaternion(),
      qx: new THREE.Quaternion(),
      p: new THREE.Vector3(),
      s: new THREE.Vector3(),
      v: new THREE.Vector3(),
      X: new THREE.Vector3(1, 0, 0),
      Y: new THREE.Vector3(0, 1, 0),
    }),
    [],
  );

  // which petals carry the HUD notes: two outer, one middle
  const anchorPetals = useMemo(() => {
    const outer = petals.map((p, i) => [p, i] as const).filter(([p]) => p.ring === 2);
    const mid = petals.map((p, i) => [p, i] as const).filter(([p]) => p.ring === 1);
    return [outer[1][1], mid[3][1], outer[6][1]];
  }, [petals]);

  useFrame(({ clock }) => {
    const im = mesh.current;
    if (!im) return;
    const time = clock.elapsedTime;
    const t = local(sceneState.p, "about");
    const grow = seg(t, 0.64, 0.8);
    const glow = seg(t, 0.68, 0.9);
    petalMat.uniforms.uTime.value = time;
    petalMat.uniforms.uGlow.value = glow;
    coreMat.uniforms.uTime.value = time;
    coreMat.uniforms.uGlow.value = grow * (1 + Math.sin(time * 1.6) * 0.08);

    for (let i = 0; i < petals.length; i++) {
      const pt = petals[i];
      // outer rings unfold a beat later than inner ones
      const open = seg(t, 0.7 + pt.ring * 0.04 + pt.jitter * 0.03, 0.9 + pt.ring * 0.03);
      const breathe = Math.sin(time * 0.8 + pt.jitter * 6) * 0.04 * open;
      const tilt = THREE.MathUtils.lerp(pt.closed, pt.open, open) + breathe;
      const sc = pt.len * seg(t, 0.62 + pt.ring * 0.03, 0.76 + pt.ring * 0.03);
      const spin = time * 0.06;
      tmp.q.setFromAxisAngle(tmp.Y, pt.az + spin);
      tmp.qx.setFromAxisAngle(tmp.X, tilt);
      tmp.q.multiply(tmp.qx);
      tmp.p.set(Math.sin(pt.az + spin), 0, Math.cos(pt.az + spin)).multiplyScalar(RINGS[pt.ring].r * grow);
      tmp.p.y = HEAD_Y - 0.05;
      tmp.s.set(sc * 1.1, sc, sc);
      tmp.m.compose(tmp.p, tmp.q, tmp.s);
      im.setMatrixAt(i, tmp.m);
    }
    im.instanceMatrix.needsUpdate = true;

    if (core.current) {
      core.current.scale.setScalar(Math.max(0.0001, grow * (1 + Math.sin(time * 1.6) * 0.04)));
      core.current.rotation.y = time * 0.3;
    }

    // project the note anchors to screen space for the DOM HUD
    const on = !!im.parent?.visible && t > 0.75;
    for (let a = 0; a < anchorPetals.length; a++) {
      const out = sceneState.anchors[a];
      if (!on) {
        out.visible = false;
        continue;
      }
      im.getMatrixAt(anchorPetals[a], tmp.m);
      tmp.v.copy(TIP).applyMatrix4(tmp.m).applyMatrix4(im.matrixWorld).project(camera);
      out.x = (tmp.v.x * 0.5 + 0.5) * size.width;
      out.y = (-tmp.v.y * 0.5 + 0.5) * size.height;
      out.visible = tmp.v.z < 1;
    }
  });

  return (
    <>
      <instancedMesh
        ref={mesh}
        args={[geometry, petalMat, petals.length]}
        frustumCulled={false}
      />
      <mesh ref={core} geometry={nodes.BloomCore.geometry} material={coreMat} position={[0, HEAD_Y + 0.05, 0]} />
    </>
  );
}

useGLTF.preload(BLOOM_URL, "/draco/");
