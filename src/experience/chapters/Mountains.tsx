"use client";

import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { projects } from "@/content/site";
import { gsap } from "@/lib/gsap";
import { perlin } from "@/lib/perlin";
import { rng } from "@/lib/random";
import { useApp } from "@/store/useApp";
import { cursorUniforms } from "../cursor";
import { palette } from "../palette";
import { glitterFrag, glitterVert, ridgeFrag, ridgeVert } from "../shaders/mountains";

const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

const NEAR_Z = 11;
const FAR_Z = 56;
const WIDTH = 130;
const LIGHT = new THREE.Vector3(0.45, 0.75, 0.5).normalize();

type Height = (x: number, z: number) => number;

/**
 * One landscape per project (local units; the crystal stands at the origin).
 * Every design keeps the low saddle behind the crystal, where the river comes out.
 */
function makeHeights(): Height[] {
  const n = perlin(11);
  const ridged = (x: number, z: number, oct: number) => {
    let s = 0;
    let a = 0.5;
    let f = 1;
    let w = 1;
    for (let i = 0; i < oct; i++) {
      let v = 1 - Math.abs(n(x * f, z * f));
      v *= v;
      v *= w;
      w = Math.min(1, Math.max(0, v * 1.7));
      s += v * a;
      f *= 2.03;
      a *= 0.5;
    }
    return s;
  };
  const fbm = (x: number, z: number, oct: number) => {
    let s = 0;
    let a = 0.5;
    let f = 1;
    for (let i = 0; i < oct; i++) {
      s += n(x * f + 17.3, z * f - 9.1) * a;
      f *= 2.01;
      a *= 0.5;
    }
    return s;
  };

  // shared framing: rise from the river plain, keep the saddle at x ≈ 1.5 open
  const frame = (f: (x: number, z: number, valley: number) => number): Height => (x, z) => {
    const ramp = smooth(-1, 13, -z - NEAR_Z);
    const valley = 0.32 + 0.68 * smooth(1.5, 12, Math.abs(x - 1.5));
    return (f(x, z, valley) + n(x * 0.9, z * 0.9) * 0.12) * ramp - 0.5;
  };

  // glasshouse: a field of crystalline spires
  const random = rng(77);
  const spires = Array.from({ length: 46 }, () => ({
    x: (random() - 0.5) * WIDTH * 0.9,
    z: -(NEAR_Z + 6 + random() * (FAR_Z - NEAR_Z - 8)),
    h: 3 + random() * 9,
    w: 1.2 + random() * 2.2,
  }));

  return [
    // halcyon — jagged peaks flanking the saddle
    frame((x, z, valley) => {
      const peaks = Math.pow(ridged(x * 0.034 + 3.1, z * 0.034 - 1.7, 6), 1.7) * 15;
      const hills = ridged(x * 0.1 + 7.3, z * 0.1, 5) * 2.6;
      return peaks * valley + hills;
    }),
    // atlas of sound — soft rolling swells
    frame((x, z, valley) => {
      const swell = Math.pow(fbm(x * 0.04, z * 0.05, 4) * 0.5 + 0.55, 1.6) * 11;
      const ripple = Math.sin(x * 0.22 + fbm(x * 0.05, z * 0.05, 2) * 4) * 0.6;
      return (swell + ripple) * (0.25 + 0.75 * valley);
    }),
    // parallel — stepped mesas with flat tops and sheer sides
    frame((x, z, valley) => {
      const base = Math.pow(ridged(x * 0.028 - 5.2, z * 0.028 + 2.4, 4), 1.2) * 13 * valley;
      const step = 2.4;
      const t = base / step;
      return (Math.floor(t) + smooth(0.78, 1, t - Math.floor(t))) * step + ridged(x * 0.12, z * 0.12, 3) * 0.6;
    }),
    // kiln — a broad volcano with a crater, and a smaller cone beside it
    frame((x, z, valley) => {
      const cone = (cx: number, cz: number, h: number, slope: number, crater: number) => {
        const r = Math.hypot(x - cx, (z - cz) * 1.1);
        return Math.max(0, h - r * slope) - smooth(crater, 0, r) * crater * 0.9;
      };
      const rough = ridged(x * 0.08 + 2.2, z * 0.08, 4);
      const v = cone(-11, -32, 15, 0.85, 3.2) + cone(16, -40, 9, 0.7, 1.6);
      return v * (0.85 + 0.3 * rough) + rough * 2.2 * valley;
    }),
    // northbound — tall, sharp alpine peaks
    frame((x, z, valley) => {
      const peaks = Math.pow(ridged(x * 0.05 - 8.4, z * 0.05 + 4.6, 7), 2.4) * 24;
      return peaks * valley + ridged(x * 0.14, z * 0.14 - 3.3, 4) * 1.6;
    }),
    // glasshouse — crystalline spires
    frame((x, z, valley) => {
      let h = 0;
      for (const s of spires) {
        const d = Math.hypot(x - s.x, z - s.z) / s.w;
        if (d < 1) h = Math.max(h, s.h * (1 - d) * (1 - d) * (0.8 + 0.2 * Math.abs(n(x * 0.7, z * 0.7))));
      }
      return h * valley + ridged(x * 0.09 + 1.1, z * 0.09, 4) * 2;
    }),
  ];
}

/** Bake the current blend into A, put `next` in B; the caller tweens uMorph 0 → 1. */
function retarget(geo: THREE.BufferGeometry, pairs: [string, string][], next: Float32Array[], m: number) {
  pairs.forEach(([a, b], i) => {
    const A = geo.getAttribute(a) as THREE.BufferAttribute;
    const B = geo.getAttribute(b) as THREE.BufferAttribute;
    const av = A.array as Float32Array;
    const bv = B.array as Float32Array;
    for (let j = 0; j < av.length; j++) av[j] += (bv[j] - av[j]) * m;
    bv.set(next[i]);
    A.needsUpdate = B.needsUpdate = true;
  });
}

function settle(geo: THREE.BufferGeometry, pairs: [string, string][], next: Float32Array[]) {
  pairs.forEach(([a], i) => {
    const A = geo.getAttribute(a) as THREE.BufferAttribute;
    (A.array as Float32Array).set(next[i]);
    A.needsUpdate = true;
  });
}

const RIDGE_PAIRS: [string, string][] = [
  ["aHA", "aHB"],
  ["aNA", "aNB"],
];
const GLITTER_PAIRS: [string, string][] = [
  ["aYA", "aYB"],
  ["aLA", "aLB"],
];

type Built = {
  ridgeGeo: THREE.BufferGeometry;
  glitterGeo: THREE.BufferGeometry;
  ridgeVariants: Float32Array[][];
  glitterVariants: Float32Array[][];
};

/**
 * Builds every landscape design plus the shared glitter. A generator so it can run in small
 * slices during idle time instead of freezing the page while it loads (see useIdleBuild).
 */
function* buildMountains(isMobile: boolean): Generator<void, Built> {
  const heights = makeHeights();
  const depth = FAR_Z - NEAR_Z;
  const segX = isMobile ? 220 : 380;
  const segZ = isMobile ? 80 : 140;
  const cols = segX + 1;
  const rows = segZ + 1;
  const dx = WIDTH / segX;
  const dz = depth / segZ;

  // every design sampled on one shared grid: heights + normals
  const grids: { h: Float32Array; nrm: Float32Array }[] = [];
  for (const height of heights) {
    const h = new Float32Array(cols * rows);
    for (let j = 0; j < rows; j++) {
      const z = -FAR_Z + j * dz;
      for (let i = 0; i < cols; i++) h[j * cols + i] = height(-WIDTH / 2 + i * dx, z);
      if (j % 6 === 5) yield;
    }
    const nrm = new Float32Array(cols * rows * 3);
    for (let j = 0; j < rows; j++)
      for (let i = 0; i < cols; i++) {
        const nx = (h[j * cols + Math.max(0, i - 1)] - h[j * cols + Math.min(cols - 1, i + 1)]) / (2 * dx);
        const nz = (h[Math.max(0, j - 1) * cols + i] - h[Math.min(rows - 1, j + 1) * cols + i]) / (2 * dz);
        const l = Math.hypot(nx, 1, nz);
        const o = (j * cols + i) * 3;
        nrm[o] = nx / l;
        nrm[o + 1] = 1 / l;
        nrm[o + 2] = nz / l;
      }
    grids.push({ h, nrm });
    yield;
  }

  // the solid range: xz from the plane, heights/normals from the active design
  const ridgeGeo = new THREE.PlaneGeometry(WIDTH, depth, segX, segZ);
  ridgeGeo.rotateX(-Math.PI / 2);
  ridgeGeo.translate(0, 0, -(NEAR_Z + depth / 2));
  const pos = ridgeGeo.attributes.position as THREE.BufferAttribute;
  const order = new Uint32Array(pos.count);
  for (let k = 0; k < pos.count; k++) {
    const i = Math.round((pos.getX(k) + WIDTH / 2) / dx);
    const j = Math.round((pos.getZ(k) + FAR_Z) / dz);
    order[k] = j * cols + i;
  }
  const ridgeVariants: Float32Array[][] = [];
  for (const { h, nrm } of grids) {
    const hv = new Float32Array(pos.count);
    const nv = new Float32Array(pos.count * 3);
    for (let k = 0; k < pos.count; k++) {
      hv[k] = h[order[k]];
      nv[k * 3] = nrm[order[k] * 3];
      nv[k * 3 + 1] = nrm[order[k] * 3 + 1];
      nv[k * 3 + 2] = nrm[order[k] * 3 + 2];
    }
    ridgeVariants.push([hv, nv]);
  }
  ridgeGeo.setAttribute("aHA", new THREE.BufferAttribute(ridgeVariants[0][0].slice(), 1));
  ridgeGeo.setAttribute("aHB", new THREE.BufferAttribute(ridgeVariants[0][0].slice(), 1));
  ridgeGeo.setAttribute("aNA", new THREE.BufferAttribute(ridgeVariants[0][1].slice(), 3));
  ridgeGeo.setAttribute("aNB", new THREE.BufferAttribute(ridgeVariants[0][1].slice(), 3));
  ridgeGeo.deleteAttribute("normal");
  yield;

  // glitter: fixed xz, per-design height and light. Points are kept where *any* design
  // lights them; brightness is rescaled so each design looks as if sampled on its own.
  // (No allocation per sample: this loop runs hundreds of thousands of times.)
  const D = grids.length;
  const sy = new Float32Array(D);
  const sk = new Float32Array(D);
  const sample = (x: number, z: number) => {
    const fx = Math.min(cols - 1.001, Math.max(0, (x + WIDTH / 2) / dx));
    const fz = Math.min(rows - 1.001, Math.max(0, (z + FAR_Z) / dz));
    const i = Math.floor(fx);
    const j = Math.floor(fz);
    const u = fx - i;
    const w = fz - j;
    const b = j * cols + i;
    const c = ((j + Math.round(w)) * cols + i + Math.round(u)) * 3;
    let kmax = 0;
    for (let d = 0; d < D; d++) {
      const { h, nrm } = grids[d];
      const y = (h[b] * (1 - u) + h[b + 1] * u) * (1 - w) + (h[b + cols] * (1 - u) + h[b + cols + 1] * u) * w;
      const l = Math.max(0, nrm[c] * LIGHT.x + nrm[c + 1] * LIGHT.y + nrm[c + 2] * LIGHT.z);
      const k = Math.pow(l, 2.5) * (0.3 + 0.7 * smooth(-0.3, 6, y));
      sy[d] = y;
      sk[d] = k;
      if (k > kmax) kmax = k;
    }
    return kmax;
  };
  const random = rng(23);
  const hueNoise = perlin(4);
  const want = isMobile ? 16000 : 60000;
  const xz = new Float32Array(want * 3);
  const ys = Array.from({ length: D }, () => new Float32Array(want));
  const ls = Array.from({ length: D }, () => new Float32Array(want));
  const rnd = new Float32Array(want);
  const hue = new Float32Array(want);
  let n = 0;
  for (let tries = 0; n < want && tries < want * 12; tries++) {
    const x = (random() - 0.5) * WIDTH;
    const z = -(NEAR_Z + Math.pow(random(), 0.8) * depth);
    const kmax = sample(x, z);
    if (kmax <= 0 || random() > kmax) continue;
    xz[n * 3] = x;
    xz[n * 3 + 2] = z;
    for (let d = 0; d < D; d++) {
      ys[d][n] = sy[d];
      ls[d][n] = (sk[d] * sk[d]) / kmax;
    }
    rnd[n] = random();
    hue[n] = hueNoise(x * 0.06, z * 0.06) * 0.5 + 0.5;
    n++;
    if (n % 3000 === 0) yield;
  }
  const glitterVariants = ys.map((y, d) => [y.slice(0, n), ls[d].slice(0, n)]);
  const glitterGeo = new THREE.BufferGeometry();
  glitterGeo.setAttribute("position", new THREE.BufferAttribute(xz.slice(0, n * 3), 3));
  glitterGeo.setAttribute("aYA", new THREE.BufferAttribute(glitterVariants[0][0].slice(), 1));
  glitterGeo.setAttribute("aYB", new THREE.BufferAttribute(glitterVariants[0][0].slice(), 1));
  glitterGeo.setAttribute("aLA", new THREE.BufferAttribute(glitterVariants[0][1].slice(), 1));
  glitterGeo.setAttribute("aLB", new THREE.BufferAttribute(glitterVariants[0][1].slice(), 1));
  glitterGeo.setAttribute("aRand", new THREE.BufferAttribute(rnd.slice(0, n), 1));
  glitterGeo.setAttribute("aHue", new THREE.BufferAttribute(hue.slice(0, n), 1));
  return { ridgeGeo, glitterGeo, ridgeVariants, glitterVariants };
}

/** Runs a generator a few milliseconds at a time in idle callbacks; returns its result when done. */
function useIdleBuild<T>(make: () => Generator<void, T>, key: unknown) {
  const [result, setResult] = useState<{ key: unknown; value: T } | null>(null);
  useEffect(() => {
    let cancelled = false;
    const it = make();
    const idle =
      typeof requestIdleCallback === "function"
        ? (cb: () => void) => requestIdleCallback(cb, { timeout: 200 })
        : (cb: () => void) => setTimeout(cb, 16);
    const step = () => {
      if (cancelled) return;
      const until = performance.now() + 6;
      let r = it.next();
      while (!r.done && performance.now() < until) r = it.next();
      if (r.done) setResult({ key, value: r.value });
      else idle(step);
    };
    idle(step);
    return () => {
      cancelled = true;
    };
    // the generator is rebuilt only when `key` changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return result && result.key === key ? result.value : null;
}

/** Chapter 4 backdrop — a glittering mountain range that reshapes itself for every project. */
export default function Mountains({ crystal }: { crystal: [number, number, number] }) {
  const isMobile = useApp((s) => s.isMobile);
  const dpr = useThree((s) => s.viewport.dpr);
  const gl = useThree((s) => s.gl);
  const camera = useThree((s) => s.camera);
  const scene = useThree((s) => s.scene);
  const root = useRef<THREE.Group>(null);

  // built in the background; nothing renders until it is ready (the chapter is far from the start)
  const built = useIdleBuild(() => buildMountains(isMobile), isMobile);

  const uniforms = useMemo(
    () => ({
      uTime: { value: 0 },
      uMorph: { value: 0 },
      uTint: { value: new THREE.Color(projects[0].tint) },
    }),
    [],
  );

  // [real, mirrored-in-the-river]
  const mats = useMemo(
    () =>
      [false, true].map((reflect) => ({
        ridge: new THREE.ShaderMaterial({
          vertexShader: ridgeVert,
          fragmentShader: ridgeFrag,
          uniforms: {
            ...uniforms,
            uBg: { value: palette.bg },
            uCrystal: { value: new THREE.Vector3(...crystal) },
            uLight: { value: LIGHT },
            uReflect: { value: reflect ? 1 : 0 },
          },
        }),
        glitter: new THREE.ShaderMaterial({
          vertexShader: glitterVert,
          fragmentShader: glitterFrag,
          defines: { MORPH: 1 },
          transparent: true,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
          uniforms: {
            ...uniforms,
            uSize: { value: 26 },
            uPixelRatio: { value: dpr },
            uReflect: { value: reflect ? 1 : 0 },
            ...cursorUniforms,
          },
        }),
      })),
    [uniforms, crystal, dpr],
  );

  useEffect(
    () => () => {
      for (const m of mats) {
        m.ridge.dispose();
        m.glitter.dispose();
      }
    },
    [mats],
  );

  useEffect(() => {
    if (!built) return;
    // catch up if the visitor already switched projects while it was building
    const cur = useApp.getState().activeProject;
    if (cur) {
      // both blend ends (A and B) jump straight to the current design
      const ends = (pairs: [string, string][]) => [pairs, pairs.map(([, b]) => [b, b] as [string, string])];
      for (const p of ends(RIDGE_PAIRS)) settle(built.ridgeGeo, p, built.ridgeVariants[cur]);
      for (const p of ends(GLITTER_PAIRS)) settle(built.glitterGeo, p, built.glitterVariants[cur]);
    }
    return () => {
      built.ridgeGeo.dispose();
      built.glitterGeo.dispose();
    };
  }, [built]);

  // compile the shaders as soon as the range exists, not on first sight (which would stutter)
  useEffect(() => {
    if (built && root.current) gl.compileAsync(root.current, camera, scene).catch(() => undefined);
  }, [built, gl, camera, scene]);

  // the range picks up the active project's tint (even before it has finished building)
  useEffect(
    () =>
      useApp.subscribe((s, prev) => {
        if (s.activeProject === prev.activeProject) return;
        const c = new THREE.Color(projects[s.activeProject].tint);
        gsap.to(uniforms.uTint.value, { r: c.r, g: c.g, b: c.b, duration: 1.4, ease: "power2.inOut" });
      }),
    [uniforms],
  );

  // each project reshapes the range: a slow morph from whatever is on screen to the next design
  useEffect(() => {
    if (!built) return;
    const { ridgeGeo, glitterGeo, ridgeVariants, glitterVariants } = built;
    return useApp.subscribe((s, prev) => {
      if (s.activeProject === prev.activeProject) return;
      const next = s.activeProject;
      const m = uniforms.uMorph.value;
      retarget(ridgeGeo, RIDGE_PAIRS, ridgeVariants[next], m);
      retarget(glitterGeo, GLITTER_PAIRS, glitterVariants[next], m);
      gsap.fromTo(
        uniforms.uMorph,
        { value: 0 },
        {
          value: 1,
          duration: 2.4,
          ease: "power2.inOut",
          overwrite: true,
          onComplete: () => {
            settle(ridgeGeo, RIDGE_PAIRS, ridgeVariants[next]);
            settle(glitterGeo, GLITTER_PAIRS, glitterVariants[next]);
            uniforms.uMorph.value = 0;
          },
        },
      );
    });
  }, [built, uniforms]);

  useFrame((_, dt) => {
    uniforms.uTime.value += dt;
  });

  if (!built) return null;
  return (
    <group ref={root}>
      <mesh geometry={built.ridgeGeo} material={mats[0].ridge} frustumCulled={false} />
      <points geometry={built.glitterGeo} material={mats[0].glitter} frustumCulled={false} />
      {/* the range mirrored in the river (the ground hides it everywhere else) */}
      <group scale={[1, -1, 1]}>
        <mesh geometry={built.ridgeGeo} material={mats[1].ridge} frustumCulled={false} />
        {!isMobile && <points geometry={built.glitterGeo} material={mats[1].glitter} frustumCulled={false} />}
      </group>
    </group>
  );
}
