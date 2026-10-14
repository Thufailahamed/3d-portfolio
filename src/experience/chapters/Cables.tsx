"use client";

import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { ABOUT_ORIGIN, chapter, local } from "@/lib/chapters";
import { rng } from "@/lib/random";
import { sceneState } from "@/lib/sceneState";
import { damp, keyWeights, LINES_OUT, PULSE, span, toSec } from "../aboutTimeline";
import { sparkFrag, sparkVert, strandFrag, strandVert } from "../shaders/cables";
import { GLOBE_R, GLOBE_Y, TILT } from "./Globe";

const DEPTH = 6;
const POINTS = 200;
/** Fraction of each strand that forms the stem; the rest becomes a meridian on the globe. */
const SPLIT = 0.45;
const BUD = 0.16;

type XY = [number, number];
/**
 * Wave keyframes in screen fractions (x: -1 left … 1 right, y: -1 bottom … 1 top),
 * matched to the reference frames. `at` is the reference second the shape is reached.
 */
const KEYS: { at: number; spine: XY[]; spread: number; loops: number }[] = [
  // 01–04: a bundled arc entering from the left at 20–40% height, rising then dipping
  { at: 3.0, spread: 0.12, loops: 0.15, spine: [[-1.25, 0.35], [-0.95, 0.5], [-0.75, 0.3], [-0.55, -0.1], [-0.3, -0.3], [0.05, -0.3], [0.45, -0.2], [0.9, -0.1]] },
  // 05–06: a big violet wave across the width, strands looping high toward the top right
  { at: 4.0, spread: 0.2, loops: 0.5, spine: [[-1.25, -0.25], [-0.7, -0.2], [-0.3, -0.25], [0.0, -0.05], [0.2, 0.3], [0.35, 0.6], [0.5, 0.85]] },
  // 07: violet → white S-wave, right end fraying out around 60% x
  { at: 5.0, spread: 0.16, loops: 0.3, spine: [[-1.25, -0.45], [-0.8, -0.1], [-0.45, 0.15], [-0.1, 0.0], [0.1, -0.1], [0.35, -0.2], [0.58, -0.18]] },
  // 08–09: flattened and lower, the right end bending upward
  { at: 6.6, spread: 0.12, loops: 0.12, spine: [[-1.25, -0.3], [-0.7, -0.2], [-0.3, -0.35], [0.1, -0.55], [0.4, -0.5], [0.58, -0.3], [0.65, 0.2]] },
  // 10: gathered into one bundle rising up the right side; the tail runs off bottom-left
  { at: 8.0, spread: 0.045, loops: 0, spine: [[-1.25, -0.85], [-0.6, -0.8], [0.0, -0.85], [0.35, -0.75], [0.55, -0.3], [0.66, 0.4], [0.71, 1.25]] },
];

const KEY_TIMES = KEYS.map((k) => k.at);

/** Gradient edges along the strand (violet below x, white above y), by reference second. */
const GRAD: [number, number, number][] = [
  [0, 1.3, 1.7],
  [4.2, 1.3, 1.7],
  [5.0, 0.35, 0.85],
  [6.0, 0.15, 0.6],
  [7.0, -0.05, 0.35],
  [8.0, -0.1, 0.25],
  [9.0, -0.6, -0.3],
];
const GRAD_TIMES = GRAD.map((g) => g[0]);

/**
 * About sequence (frames 01–15 of the reference, with the globe in place of the flower):
 * strands enter from the left, swell into a violet wave, calm and whiten, gather into a mint
 * stem on the right, curl into a bud at its tip and open into the globe's meridians.
 *
 * The wave is screen-locked (camera space, rewritten each frame); the stem and globe are in
 * world space so they stay attached to the planet while the camera pulls back.
 */
export default function Cables({ count, globe }: { count: number; globe: React.RefObject<THREE.Group | null> }) {
  const group = useRef<THREE.Group>(null);
  const aboutRef = useRef<THREE.Group>(null);
  const camera = useThree((s) => s.camera) as THREE.PerspectiveCamera;
  const size = useThree((s) => s.size);
  const dpr = useThree((s) => s.viewport.dpr);
  const fov = camera.fov;
  const c = chapter("about");

  const built = useMemo(() => {
    const random = rng(53);
    const r = (a: number, b: number) => a + random() * (b - a);
    const randn = () => (random() + random() + random() - 1.5) / 0.5;
    const split = Math.round(SPLIT * (POINTS - 1));

    // per-strand character
    const strands = Array.from({ length: count }, (_, i) => ({
      a: randn() * 0.5,
      b: randn() * 0.5,
      f: r(1.5, 4),
      ph: r(0, Math.PI * 2),
      loop: random() < 0.25 ? { s0: r(0.35, 0.8), w: r(0.08, 0.16), h: r(0.25, 0.6) } : null,
      delay: random() * 0.35,
      seed: random(),
      core: Math.exp(-((i / Math.max(1, count - 1) - 0.5) ** 2) * 10) * r(0.6, 1),
      weight: 0.55 * r(0.6, 1),
      lon: (i / count) * Math.PI + r(-0.04, 0.04),
    }));

    // wave keyframes → per-strand polylines in screen fractions
    const keys = KEYS.map((k) => {
      const spine = new THREE.CatmullRomCurve3(
        k.spine.map(([x, y]) => new THREE.Vector3(x, y, 0)),
        false,
        "centripetal",
      );
      const frames = Array.from({ length: POINTS }, (_, j) => {
        const p = spine.getPointAt(j / (POINTS - 1));
        const t = spine.getTangentAt(j / (POINTS - 1));
        const n = new THREE.Vector2(-t.y, t.x).normalize();
        if (n.y < 0) n.negate(); // the "up" side of the bundle
        return { p, n };
      });
      return strands.map((st) => {
        const out = new Float32Array(POINTS * 2);
        for (let j = 0; j < POINTS; j++) {
          const s = j / (POINTS - 1);
          const { p, n } = frames[j];
          let o = k.spread * (0.7 + 0.6 * Math.sin(Math.PI * s)) * (st.a + 0.35 * Math.sin(s * st.f * Math.PI + st.ph));
          if (st.loop) o += k.loops * st.loop.h * Math.exp(-(((s - st.loop.s0) / st.loop.w) ** 2));
          out[j * 2] = p.x + n.x * o;
          out[j * 2 + 1] = p.y + n.y * o;
        }
        return out;
      });
    });

    // stem (about-group space): from below the frame up into the globe's south pole
    const pole = new THREE.Vector3(GLOBE_R * Math.sin(TILT), GLOBE_Y - GLOBE_R * Math.cos(TILT), 0);
    const axisOut = new THREE.Vector3(Math.sin(TILT), -Math.cos(TILT), 0);
    const stemCurve = new THREE.CatmullRomCurve3(
      [
        new THREE.Vector3(-0.9, -2.8, 1.6),
        new THREE.Vector3(-0.35, -0.6, 1.0),
        new THREE.Vector3(0.2, 0.75, 0.4),
        pole.clone().addScaledVector(axisOut, 0.35),
        pole,
      ],
      false,
      "centripetal",
    );

    const verts = count * POINTS * 2;
    const A = (n: number) => new Float32Array(verts * n);
    // packed: aInfo = (onGlobe, side, s, seed), aStyle = (core, weight), aLive = (k, bloom, head)
    const attr = {
      position: A(3),
      aTangent: A(3),
      aWorld: A(3),
      aWorldTan: A(3),
      aInfo: A(4),
      aStyle: A(2),
      aLive: A(3),
    };
    const index: number[] = [];
    const v = new THREE.Vector3();
    const tg = new THREE.Vector3();
    strands.forEach((st, i) => {
      for (let j = 0; j < POINTS; j++) {
        const s = j / (POINTS - 1);
        const onGlobe = j > split;
        if (!onGlobe) {
          const u = j / split;
          stemCurve.getPointAt(u, v);
          stemCurve.getTangentAt(u, tg);
          const taper = (1 - u) * (1 - u);
          v.x += st.a * 0.06 * taper;
          v.z += st.b * 0.06 * taper;
        } else {
          // meridian loop starting and ending at the south pole
          const th = ((j - split) / (POINTS - 1 - split)) * Math.PI * 2;
          v.set(Math.sin(th) * Math.cos(st.lon), -Math.cos(th), Math.sin(th) * Math.sin(st.lon));
          tg.set(Math.cos(th) * Math.cos(st.lon), Math.sin(th), Math.cos(th) * Math.sin(st.lon));
        }
        for (let k = 0; k < 2; k++) {
          const o = (i * POINTS + j) * 2 + k;
          // stem vertices store a position, globe vertices a direction on the globe
          v.toArray(attr.aWorld, o * 3);
          tg.toArray(attr.aWorldTan, o * 3);
          attr.aTangent.set([1, 0, 0], o * 3);
          attr.aInfo.set([onGlobe ? 1 : 0, k ? 1 : -1, s, st.seed], o * 4);
          attr.aStyle.set([st.core, st.weight], o * 2);
        }
        if (j < POINTS - 1) {
          const q = (i * POINTS + j) * 2;
          index.push(q, q + 1, q + 2, q + 1, q + 3, q + 2);
        }
      }
    });

    const g = new THREE.BufferGeometry();
    const itemSize: Record<string, number> = { aInfo: 4, aStyle: 2 };
    const dynamic = ["position", "aTangent", "aLive"];
    for (const [name, arr] of Object.entries(attr)) {
      const ba = new THREE.BufferAttribute(arr, itemSize[name] ?? 3);
      if (dynamic.includes(name)) ba.setUsage(THREE.DynamicDrawUsage);
      g.setAttribute(name, ba);
    }
    g.setIndex(index);
    const tanH = Math.tan(THREE.MathUtils.degToRad(fov / 2));
    const strandMat = new THREE.ShaderMaterial({
      vertexShader: strandVert,
      fragmentShader: strandFrag,
      transparent: true,
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
      uniforms: {
        uTime: { value: 0 },
        uPx: { value: (2 * tanH) / size.height },
        uAbout: { value: new THREE.Matrix4() },
        uGlobe: { value: new THREE.Matrix4() },
        uR: { value: GLOBE_R },
        uBud: { value: BUD },
        uReveal: { value: 0 },
        uDim: { value: 0 },
        uGrey: { value: 1 },
        uGrad: { value: new THREE.Vector2(1.3, 1.7) },
        uMint: { value: 0 },
        uPulse: { value: 0 },
        uFade: { value: 0 },
      },
    });
    const mesh = new THREE.Mesh(g, strandMat);
    mesh.frustumCulled = false;
    mesh.renderOrder = 12; // under the dip-to-black (15)

    // sparkles drifting off the stem (about-group space)
    const nSparks = 70;
    const sparkPos = new Float32Array(nSparks * 3);
    const sparkSeed = new Float32Array(nSparks);
    for (let i = 0; i < nSparks; i++) {
      stemCurve.getPointAt(r(0.15, 1), v);
      v.x += r(0.08, 0.45) * (random() < 0.5 ? -1 : 1);
      v.z += r(-0.3, 0.3);
      v.toArray(sparkPos, i * 3);
      sparkSeed[i] = random();
    }
    // faint starfield behind the globe
    const nStars = 1600;
    const starPos = new Float32Array(nStars * 3);
    const starSeed = new Float32Array(nStars);
    for (let i = 0; i < nStars; i++) {
      starPos.set([r(-45, 45), r(-18, 32), r(-50, -6)], i * 3);
      starSeed[i] = random();
    }
    const points = (pos: Float32Array, seed: Float32Array, color: string, sz: number) => {
      const pg = new THREE.BufferGeometry();
      pg.setAttribute("position", new THREE.BufferAttribute(pos, 3));
      pg.setAttribute("aSeed", new THREE.BufferAttribute(seed, 1));
      const pm = new THREE.ShaderMaterial({
        vertexShader: sparkVert,
        fragmentShader: sparkFrag,
        transparent: true,
        depthWrite: false,
        toneMapped: false,
        blending: THREE.AdditiveBlending,
        uniforms: {
          uTime: { value: 0 },
          uPixelRatio: { value: dpr },
          uSize: { value: sz },
          uColor: { value: new THREE.Color(color) },
          uOpacity: { value: 0 },
        },
      });
      const pts = new THREE.Points(pg, pm);
      pts.frustumCulled = false;
      return pts;
    };
    const sparks = points(sparkPos, sparkSeed, "#dff5ee", 2.6);
    const stars = points(starPos, starSeed, "#ffffff", 1.4);

    return { strands, keys, mesh, sparks, stars, tanH, line: new Float32Array(POINTS * 2), kw: [] as number[] };
  }, [count, fov, size.height, dpr]);

  useEffect(
    () => () => {
      for (const o of [built.mesh, built.sparks, built.stars]) {
        o.geometry.dispose();
        (o.material as THREE.Material).dispose();
      }
    },
    [built],
  );

  useFrame((_, dt) => {
    const p = sceneState.p;
    // the sequence clock trails the scroll slightly, so wheel steps glide instead of jump
    const target = toSec(local(p, "about"));
    sceneState.aboutSec =
      Math.abs(target - sceneState.aboutSec) > 3 ? target : damp(sceneState.aboutSec, target, 4.5, Math.min(dt, 0.1));
    const on = p >= c.start - 0.001 && p <= c.end + 0.002;
    if (group.current) group.current.visible = on;
    if (!on) return;

    const sec = sceneState.aboutSec;
    const { strands, keys, mesh, sparks, stars, tanH, line, kw } = built;
    const g = mesh.geometry;
    const u = (mesh.material as THREE.ShaderMaterial).uniforms;
    u.uTime.value += dt;
    const time = u.uTime.value as number;

    // colour story: grey-white → violet → violet/white gradient sliding left → mint
    u.uGrey.value = 1 - span(sec, 1.4, 2.6);
    u.uMint.value = span(sec, 6.8, 8.2);
    keyWeights(GRAD_TIMES, sec, kw);
    let ga = 0;
    let gb = 0;
    GRAD.forEach(([, a, b], gi) => {
      ga += a * kw[gi];
      gb += b * kw[gi];
    });
    u.uGrad.value.set(ga, gb);
    u.uReveal.value = span(sec, 10.6, 11.6); // far-side strands hide as the planet body forms
    u.uDim.value = span(sec, 12.2, 12.8);
    // light runs up the strands into the globe, then the lines fade away
    u.uPulse.value = span(sec, PULSE[0], PULSE[1]) * 1.15;
    const fadeOut = span(sec, LINES_OUT[0], LINES_OUT[1]);
    u.uFade.value = fadeOut;
    mesh.visible = fadeOut < 1;

    if (aboutRef.current) {
      aboutRef.current.updateWorldMatrix(true, false);
      u.uAbout.value.copy(aboutRef.current.matrixWorld);
    }
    if (globe.current) {
      globe.current.updateWorldMatrix(true, false);
      u.uGlobe.value.copy(globe.current.matrixWorld);
    }

    // wave: blend the keyframes per strand (each on its own delay), write camera-space points
    const pos = g.attributes.position.array as Float32Array;
    const tan = g.attributes.aTangent.array as Float32Array;
    const live = g.attributes.aLive.array as Float32Array;
    const sx = tanH * (size.width / size.height) * DEPTH;
    const sy = tanH * DEPTH;
    strands.forEach((st, i) => {
      const ls = sec - st.delay;
      // one continuous spline through all wave shapes: no stop at each keyframe
      keyWeights(KEY_TIMES, ls, kw);
      line.fill(0);
      for (let q = 0; q < keys.length; q++) {
        const w = kw[q];
        if (w === 0) continue;
        const K = keys[q][i];
        for (let j = 0; j < POINTS * 2; j++) line[j] += K[j] * w;
      }
      for (let j = 0; j < POINTS; j++) {
        const s = j / (POINTS - 1);
        // slow organic drift, two frequencies per strand so it never looks like a loop
        line[j * 2] += Math.sin(time * 0.31 + s * 4 + st.ph * 1.3) * 0.006;
        line[j * 2 + 1] +=
          Math.sin(time * 0.7 + s * 6 + st.ph) * 0.011 + Math.sin(time * 0.43 + s * 11 + st.ph * 1.7) * 0.006;
      }
      // the head draws in on one smooth, accelerating curve
      const head = Math.pow(Math.min(1, Math.max(0, ls / 4.6)), 1.5);
      const k = span(ls, 8.0, 9.2);
      const bloom = span(ls, 10.4, 11.6);
      for (let j = 0; j < POINTS; j++) {
        const ja = Math.max(0, j - 1) * 2;
        const jb = Math.min(POINTS - 1, j + 1) * 2;
        const tx = (line[jb] - line[ja]) * sx;
        const ty = (line[jb + 1] - line[ja + 1]) * sy;
        const tl = Math.hypot(tx, ty) || 1;
        for (let e = 0; e < 2; e++) {
          const o = (i * POINTS + j) * 2 + e;
          pos[o * 3] = line[j * 2] * sx;
          pos[o * 3 + 1] = line[j * 2 + 1] * sy;
          pos[o * 3 + 2] = -DEPTH;
          tan[o * 3] = tx / tl;
          tan[o * 3 + 1] = ty / tl;
          tan[o * 3 + 2] = 0;
          live[o * 3] = k;
          live[o * 3 + 1] = bloom;
          live[o * 3 + 2] = Math.max(0, head) * 1.001;
        }
      }
    });
    for (const n of ["position", "aTangent", "aLive"]) g.attributes[n].needsUpdate = true;

    // sparkles off the stem; the starfield fades in from ~10s and stays
    const fade: [THREE.Points, number][] = [
      [sparks, span(sec, 8.6, 9.6) * 0.9 * (1 - fadeOut)],
      [stars, span(sec, 10, 11.5) * 0.3],
    ];
    for (const [pts, op] of fade) {
      const pu = (pts.material as THREE.ShaderMaterial).uniforms;
      pu.uTime.value = time;
      pu.uOpacity.value = op;
    }
    stars.rotation.y = time * 0.004;
  });

  return (
    <group ref={group} visible={false}>
      <primitive object={built.mesh} />
      <group ref={aboutRef} position={ABOUT_ORIGIN}>
        <primitive object={built.sparks} />
        <primitive object={built.stars} />
      </group>
    </group>
  );
}
