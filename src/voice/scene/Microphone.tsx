"use client";

import { useFrame, useThree } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import * as THREE from "three";
import { mulberry32 } from "@/diffusion/pipeline/rng";
import { SAMPLE_RATE } from "../audio/frontend";
import { getLab } from "../lab";
import { X } from "../story";
import { useVoice } from "../store";
import { C, Caption, Label, MAT, approach, envelope, isLive, put, stageT } from "./common";
import Scope from "./Scope";

/**
 * 01 · Sound. A large-diaphragm condenser microphone on a stand, the voice reaching it as pressure fronts, and
 * the samples it hands over: the clip (or the live input) as a waveform.
 */

const SCOPE = { x: 3.25, y: 1.55, w: 4.6, h: 0.62, cols: 300 };
const LIVE_SECONDS = 4;

/** a woven wire mesh, for the grille's alpha */
function meshTexture() {
  const s = 256;
  const c = document.createElement("canvas");
  c.width = c.height = s;
  const g = c.getContext("2d")!;
  g.fillStyle = "#000";
  g.fillRect(0, 0, s, s);
  g.strokeStyle = "#fff";
  g.lineWidth = 7;
  for (let k = -s; k <= 2 * s; k += 32) {
    g.beginPath();
    g.moveTo(k, 0);
    g.lineTo(k + s, s);
    g.moveTo(k + s, 0);
    g.lineTo(k, s);
    g.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(22, 9);
  t.anisotropy = 8;
  return t;
}

/** the microphone itself: body, grille basket, capsule, shock mount and stand */
function Mic() {
  const mats = useMemo(() => {
    const alpha = meshTexture();
    return {
      body: new THREE.MeshPhysicalMaterial({ color: "#c9ccd2", metalness: 1, roughness: 0.26, clearcoat: 0.6, clearcoatRoughness: 0.15 }),
      chrome: new THREE.MeshStandardMaterial({ color: "#e8eaee", metalness: 1, roughness: 0.08 }),
      grille: new THREE.MeshStandardMaterial({ color: "#d5d8dd", metalness: 1, roughness: 0.32, alphaMap: alpha, alphaTest: 0.5, side: THREE.DoubleSide }),
      inner: new THREE.MeshStandardMaterial({ color: "#0b0c0e", metalness: 0.4, roughness: 0.7 }),
      gold: new THREE.MeshStandardMaterial({ color: "#d9b46a", metalness: 1, roughness: 0.22 }),
      rubber: new THREE.MeshStandardMaterial({ color: "#121214", metalness: 0, roughness: 0.85 }),
      led: new THREE.MeshBasicMaterial({ color: C.speech, toneMapped: false }),
    };
  }, []);
  // lathe profiles (radius, height), turned about y
  const bodyGeo = useMemo(() => {
    const pts = [
      [0, 0],
      [0.13, 0],
      [0.155, 0.02],
      [0.17, 0.08],
      [0.19, 0.5],
      [0.2, 0.62],
      [0.2, 0.66],
      [0, 0.66],
    ].map(([r, y]) => new THREE.Vector2(r, y));
    return new THREE.LatheGeometry(pts, 64);
  }, []);
  const headGeo = useMemo(() => {
    const pts: THREE.Vector2[] = [];
    // a cylinder with a domed top
    for (let i = 0; i <= 6; i++) pts.push(new THREE.Vector2(0.205, (i / 6) * 0.2));
    for (let i = 1; i <= 16; i++) {
      const a = (i / 16) * (Math.PI / 2);
      pts.push(new THREE.Vector2(0.205 * Math.cos(a) + 0.0001, 0.2 + 0.205 * Math.sin(a)));
    }
    return new THREE.LatheGeometry(pts, 72);
  }, []);
  const led = useRef<THREE.Mesh>(null);
  useFrame((state) => {
    const on = isLive() || useVoice.getState().listening;
    if (led.current) led.current.visible = on ? Math.floor(state.clock.elapsedTime * 2) % 2 === 0 || !isLive() : false;
  });
  return (
    <group>
      {/* stand: cast base, chrome pole, yoke */}
      <mesh material={MAT.darkMetal()} position={[0, 0.025, 0]}>
        <cylinderGeometry args={[0.52, 0.56, 0.05, 64]} />
      </mesh>
      <mesh material={mats.chrome} position={[0, 0.78, 0]}>
        <cylinderGeometry args={[0.022, 0.022, 1.5, 24]} />
      </mesh>
      <mesh material={mats.chrome} position={[0, 0.07, 0]}>
        <cylinderGeometry args={[0.05, 0.06, 0.06, 24]} />
      </mesh>
      <group position={[0, 1.56, 0]} rotation={[0, 0, 0.12]}>
        {/* shock mount: a ring held by four elastic cords */}
        <mesh material={MAT.darkMetal()} position={[0, 0.36, 0]} rotation={[Math.PI / 2, 0, 0]}>
          <torusGeometry args={[0.33, 0.018, 12, 64]} />
        </mesh>
        <mesh material={MAT.darkMetal()} position={[0, 0.06, 0]}>
          <cylinderGeometry args={[0.03, 0.03, 0.12, 16]} />
        </mesh>
        <mesh material={MAT.darkMetal()} position={[0, 0.12, 0]} rotation={[0, 0, Math.PI / 2]}>
          <torusGeometry args={[0.24, 0.014, 10, 48, Math.PI]} />
        </mesh>
        {[0, 1, 2, 3].map((i) => {
          const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
          return (
            <mesh key={i} material={mats.rubber} position={[Math.cos(a) * 0.265, 0.36, Math.sin(a) * 0.265]} rotation={[0, -a, Math.PI / 2]}>
              <cylinderGeometry args={[0.008, 0.008, 0.14, 8]} />
            </mesh>
          );
        })}
        {/* body, collar, grille, capsule */}
        <mesh geometry={bodyGeo} material={mats.body} position={[0, 0.04, 0]} />
        <mesh material={mats.chrome} position={[0, 0.71, 0]}>
          <cylinderGeometry args={[0.212, 0.212, 0.035, 64]} />
        </mesh>
        <group position={[0, 0.727, 0]}>
          <mesh geometry={headGeo} material={mats.grille} />
          <mesh geometry={headGeo} material={mats.grille} scale={0.965} rotation={[0, 0.4, 0]} />
          <mesh material={mats.inner} position={[0, 0.2, 0]}>
            <sphereGeometry args={[0.17, 32, 24]} />
          </mesh>
          {/* the diaphragm: a gold disc, edge-on to the voice */}
          <mesh material={mats.gold} position={[0, 0.2, 0]} rotation={[Math.PI / 2, 0, 0]}>
            <cylinderGeometry args={[0.14, 0.14, 0.012, 48]} />
          </mesh>
          <mesh material={mats.chrome} position={[0, 0.2, 0]} rotation={[Math.PI / 2, 0, 0]}>
            <torusGeometry args={[0.145, 0.008, 8, 48]} />
          </mesh>
        </group>
        {/* the front badge and the signal lamp */}
        <mesh material={mats.gold} position={[0, 0.52, 0.196]}>
          <circleGeometry args={[0.035, 32]} />
        </mesh>
        <mesh ref={led} material={mats.led} position={[0, 0.2, 0.188]}>
          <circleGeometry args={[0.012, 16]} />
        </mesh>
      </group>
    </group>
  );
}

const airVert = /* glsl */ `
attribute vec4 aSeed;
uniform float uTime;
uniform float uLevel;
uniform vec3 uSrc;
uniform float uPx;
varying float vB;
varying float vA;
const float K = 6.2831853 / 0.34;
const float W = 6.2831853 * 1.25;
void main() {
  // spherical waves from the talker's mouth: each particle swings along the ray from the source, and its
  // brightness is the local compression, -du/dr
  vec3 d = position - uSrc;
  float r = length(d);
  vec3 dir = d / max(r, 1e-3);
  float phase = K * r - W * uTime;
  float spread = 1.0 / (1.0 + 0.9 * r);
  float amp = 0.055 * uLevel * spread;
  vec3 p = position + dir * amp * sin(phase);
  // a little thermal jitter, so the air never looks like a lattice
  p += 0.012 * vec3(sin(uTime * 1.3 + aSeed.x * 40.0), sin(uTime * 1.1 + aSeed.y * 40.0), sin(uTime * 0.9 + aSeed.z * 40.0));
  float comp = -cos(phase);
  vB = clamp(0.5 + 0.5 * comp * min(1.0, uLevel * 1.6), 0.0, 1.0);
  // a cone of air opening from the mouth toward the capsule, soft at its edges
  float along = clamp(d.x / 2.5, 0.0, 1.0);
  float off = length(d.yz) / (0.12 + along * 0.95);
  vA = (1.0 - smoothstep(0.55, 1.0, off)) * smoothstep(0.0, 0.08, along) * (1.0 - smoothstep(0.88, 1.0, along));
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = uPx * (0.7 + 0.6 * aSeed.w) * (0.75 + 0.6 * vB) / -mv.z;
}`;

const airFrag = /* glsl */ `
uniform vec3 uCold;
uniform vec3 uHot;
uniform float uLevel;
varying float vB;
varying float vA;
void main() {
  float a = smoothstep(0.5, 0.15, length(gl_PointCoord - 0.5));
  vec3 c = mix(uCold, uHot, vB * vB);
  float lum = (0.18 + 0.82 * vB * vB) * (0.35 + 0.65 * min(1.0, uLevel * 1.4 + 0.15));
  gl_FragColor = vec4(c * lum * a * vA, 1.0);
}`;

/**
 * The air between the talker and the capsule as particles. Sound is a longitudinal wave: the air swings back and
 * forth along the direction of travel, bunching into compressions (bright) and thinning into rarefactions.
 * Shown slowed and enlarged (real speech moves at 343 m/s with wavelengths of centimetres to metres); how hard
 * the air swings follows the clip's level at the playhead, or the microphone's while recording.
 */
function Air({ level }: { level: () => number }) {
  const gl = useThree((st) => st.gl);
  const SRC = useMemo(() => new THREE.Vector3(-2.75, 3.3, 0.05), []);
  const { geo, mat } = useMemo(() => {
    const n = 15000;
    const pos = new Float32Array(n * 3);
    const seed = new Float32Array(n * 4);
    const rnd = mulberry32(11);
    for (let i = 0; i < n; i++) {
      // spread through the cone, denser near its axis
      const along = rnd();
      const rad = (0.12 + along * 0.95) * Math.sqrt(rnd()) * 0.95;
      const ang = rnd() * Math.PI * 2;
      pos[i * 3] = SRC.x + along * 2.5;
      pos[i * 3 + 1] = SRC.y + Math.cos(ang) * rad;
      pos[i * 3 + 2] = SRC.z + Math.sin(ang) * rad;
      for (let k = 0; k < 4; k++) seed[i * 4 + k] = rnd();
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    g.setAttribute("aSeed", new THREE.BufferAttribute(seed, 4));
    const m = new THREE.ShaderMaterial({
      vertexShader: airVert,
      fragmentShader: airFrag,
      uniforms: {
        uTime: { value: 0 },
        uLevel: { value: 0 },
        uSrc: { value: SRC },
        uPx: { value: 20 },
        uCold: { value: new THREE.Color("#5b7aa6") },
        uHot: { value: new THREE.Color(C.speech) },
      },
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      toneMapped: false,
    });
    return { geo: g, mat: m };
  }, [SRC]);
  const amp = useRef(0);
  useFrame((state, dt) => {
    amp.current = approach(amp.current, level(), 8, dt);
    put(mat.uniforms.uTime, "value", state.clock.elapsedTime);
    put(mat.uniforms.uLevel, "value", amp.current);
    put(mat.uniforms.uPx, "value", 26 * gl.getPixelRatio() * (state.size.height / 900));
  });
  return (
    <group>
      <points geometry={geo} material={mat} frustumCulled={false} renderOrder={4} />
      {/* the mouth: where the waves start */}
      <mesh position={SRC}>
        <sphereGeometry args={[0.035, 16, 12]} />
        <meshBasicMaterial color={C.speech} toneMapped={false} />
      </mesh>
    </group>
  );
}

/** a nylon pop filter on a gooseneck, between the talker and the capsule */
function PopFilter() {
  const { tube, mesh } = useMemo(() => {
    const curve = new THREE.CatmullRomCurve3([new THREE.Vector3(0.15, 1.95, 0), new THREE.Vector3(-0.1, 2.35, 0.06), new THREE.Vector3(-0.55, 2.62, 0.04), new THREE.Vector3(-0.92, 2.86, 0.02)]);
    const c = document.createElement("canvas");
    c.width = c.height = 256;
    const g = c.getContext("2d")!;
    g.fillStyle = "#000";
    g.fillRect(0, 0, 256, 256);
    g.strokeStyle = "#fff";
    g.lineWidth = 1;
    for (let k = 0; k <= 256; k += 4) {
      g.beginPath();
      g.moveTo(k + 0.5, 0);
      g.lineTo(k + 0.5, 256);
      g.moveTo(0, k + 0.5);
      g.lineTo(256, k + 0.5);
      g.stroke();
    }
    const t = new THREE.CanvasTexture(c);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(3, 3);
    return { tube: new THREE.TubeGeometry(curve, 48, 0.012, 8, false), mesh: t };
  }, []);
  return (
    <group>
      <mesh geometry={tube} material={MAT.darkMetal()} />
      <group position={[-0.95, 3.3, 0.02]} rotation={[0, Math.PI / 2, 0]}>
        <mesh material={MAT.darkMetal()}>
          <torusGeometry args={[0.42, 0.016, 10, 72]} />
        </mesh>
        <mesh>
          <circleGeometry args={[0.41, 64]} />
          <meshStandardMaterial color="#1a1d22" alphaMap={mesh} transparent opacity={0.85} side={THREE.DoubleSide} depthWrite={false} roughness={0.9} />
        </mesh>
        <mesh>
          <circleGeometry args={[0.41, 64]} />
          <meshBasicMaterial color="#0b0d10" transparent opacity={0.28} side={THREE.DoubleSide} depthWrite={false} />
        </mesh>
      </group>
    </group>
  );
}

export default function Microphone() {
  const runId = useVoice((s) => s.run);
  useVoice((s) => s.mic);
  const run = getLab()?.run ?? null;
  const env = useMemo(() => (run ? envelope(run.clip.full, SCOPE.cols) : null), [run, runId]); // eslint-disable-line react-hooks/exhaustive-deps
  const liveEnv = useMemo(() => ({ lo: new Float32Array(SCOPE.cols), hi: new Float32Array(SCOPE.cols) }), []);
  const tone = useMemo(() => ({ a: new THREE.Color(C.fg), b: new THREE.Color(C.faint), s: new THREE.Color(C.speech), q: new THREE.Color(C.silence) }), []);

  /** the clip time shown at the mic: the playhead sweeps it during this stage */
  const clipTime = () => {
    const r = getLab()?.run;
    if (!r) return 0;
    return stageT("sound") * (r.clip.full.length / SAMPLE_RATE);
  };
  const level = () => {
    const lab = getLab();
    if (lab?.live) return Math.min(1, Math.max(0, (lab.live.level + 60) / 45));
    const r = lab?.run;
    if (!r || stageT("sound") <= 0 || stageT("sound") >= 1) return 0;
    const i = Math.floor(clipTime() * SAMPLE_RATE);
    let s = 0;
    const n = 480;
    for (let k = Math.max(0, i - n); k < Math.min(r.clip.full.length, i + n); k++) s += r.clip.full[k] ** 2;
    return Math.min(1, Math.max(0, (10 * Math.log10(s / (2 * n) + 1e-10) + 55) / 40));
  };

  const read = () => {
    const lab = getLab();
    const live = lab?.live;
    if (live) {
      const span = LIVE_SECONDS * SAMPLE_RATE;
      const to = live.n;
      const from = to - span;
      const per = span / SCOPE.cols;
      for (let c = 0; c < SCOPE.cols; c++) {
        let mn = 0;
        let mx = 0;
        for (let i = Math.floor(from + c * per); i < Math.floor(from + (c + 1) * per); i++) {
          if (i < 0) continue;
          const v = live.samples[i];
          if (v < mn) mn = v;
          if (v > mx) mx = v;
        }
        liveEnv.lo[c] = mn;
        liveEnv.hi[c] = mx;
      }
      const frames = live.steps;
      return {
        ...liveEnv,
        color: (i: number, out: THREE.Color) => {
          const f = Math.floor((from + (i + 0.5) * per) / 160);
          const st = f >= 0 ? frames[f] : undefined;
          out.copy(st?.speech ? tone.s : st?.calibrating ? tone.b : tone.a);
        },
      };
    }
    const r = lab?.run;
    if (!r || !env) return null;
    const head = stageT("sound");
    const shown = stageT("vad") > 0;
    const frames = r.vad.steps;
    const total = r.clip.full.length;
    return {
      ...env,
      head: head > 0 && head < 1 ? head : undefined,
      color: (i: number, out: THREE.Color) => {
        const x = (i + 0.5) / SCOPE.cols;
        if (shown) {
          const st = frames[Math.floor((x * total) / 160)];
          out.copy(st?.speech ? tone.s : tone.q);
        } else out.copy(head > 0 && x > head && head < 1 ? tone.b : tone.a);
      },
    };
  };

  const r = run;
  const peak = useMemo(() => {
    if (!r) return -Infinity;
    let m = 0;
    for (const v of r.clip.raw.data) m = Math.max(m, Math.abs(v));
    return 20 * Math.log10(m || 1e-9);
  }, [r]);

  return (
    <group position={[X.mic, 0, 0]}>
      <Caption n="01" title="Sound · the microphone" spec="air pressure, sampled f_s times a second (48 000 for most microphones), each a float32 between −1 and +1" tag={{ text: "live input", kind: "live" }} position={[-2.4, 4.0, 0]} width={6.6} />
      <group scale={1.35} position={[0.15, 0, 0]}>
        <Mic />
      </group>
      <Air level={level} />
      <PopFilter />
      <Label fontSize={0.07} color={C.faint} position={[-2.85, 2.3, 0]} maxWidth={2.6} lineHeight={1.5}>
        {"air between mouth and capsule · slowed and enlarged · bright where it is compressed · swing follows the clip's level"}
      </Label>

      {/* the samples */}
      <group position={[SCOPE.x, SCOPE.y, 0]}>
        <mesh material={MAT.panel()} position={[0, 0, -0.06]}>
          <boxGeometry args={[SCOPE.w + 0.24, SCOPE.h * 2 + 0.34, 0.04]} />
        </mesh>
        <mesh position={[0, 0, -0.035]}>
          <planeGeometry args={[SCOPE.w, 0.004]} />
          <meshBasicMaterial color={C.wire} toneMapped={false} />
        </mesh>
        <Scope cols={SCOPE.cols} width={SCOPE.w} height={SCOPE.h} read={read} />
        <Label fontSize={0.075} color={C.dim} position={[-SCOPE.w / 2, SCOPE.h + 0.08, 0]}>
          {isLive() ? "live input · last 4 s" : r ? `${r.clip.name} · ${(r.clip.full.length / SAMPLE_RATE).toFixed(2)} s` : ""}
        </Label>
        <Label fontSize={0.07} color={C.faint} anchorX="right" position={[SCOPE.w / 2, -SCOPE.h - 0.08, 0]}>
          {r ? `${r.clip.raw.rate.toLocaleString("en-US")} Hz · peak ${peak.toFixed(1)} dBFS · ${r.clip.raw.data.length.toLocaleString("en-US")} samples` : ""}
        </Label>
        <Label fontSize={0.06} color={C.faint} anchorX="right" position={[-SCOPE.w / 2 - 0.04, SCOPE.h, 0]}>
          {"+1"}
        </Label>
        <Label fontSize={0.06} color={C.faint} anchorX="right" position={[-SCOPE.w / 2 - 0.04, -SCOPE.h, 0]}>
          {"−1"}
        </Label>
      </group>
    </group>
  );
}
