"use client";

import { Environment, Lightformer, MeshReflectorMaterial } from "@react-three/drei";
import { useFrame, useThree } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import * as THREE from "three";
import { mulberry32 } from "../rng";
import { put, type Theme } from "./common";

/**
 * The room both labs stand in: a dark hall with one pool of light per exhibit. Shafts, floor pools and the
 * dust that only shows inside them are cheap additive geometry; one real spot follows the exhibit on show, so
 * the metal and the floor pick up a moving highlight. Nothing here carries data.
 */

/** one exhibit's light: where it hangs, how wide it lands, and how lit it is right now (0 … 1) */
export type Lamp = { x: number; z?: number; height?: number; radius: number; level: () => number };

const NOISE_GLSL = /* glsl */ `
float hash3(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float vnoise(vec3 x) {
  vec3 i = floor(x);
  vec3 f = fract(x);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(hash3(i), hash3(i + vec3(1, 0, 0)), f.x), mix(hash3(i + vec3(0, 1, 0)), hash3(i + vec3(1, 1, 0)), f.x), f.y),
             mix(mix(hash3(i + vec3(0, 0, 1)), hash3(i + vec3(1, 0, 1)), f.x), mix(hash3(i + vec3(0, 1, 1)), hash3(i + vec3(1, 1, 1)), f.x), f.y), f.z);
}`;

const beamVert = /* glsl */ `
varying float vY;
varying vec3 vWorld;
varying vec3 vNormalW;
uniform float uHeight;
void main() {
  vY = position.y / uHeight + 0.5;
  vec4 w = modelMatrix * vec4(position, 1.0);
  vWorld = w.xyz;
  vNormalW = normalize(mat3(modelMatrix) * normal);
  gl_Position = projectionMatrix * viewMatrix * w;
}`;

const beamFrag = /* glsl */ `
uniform vec3 uColor;
uniform float uLevel;
uniform float uTime;
uniform float uFar;
varying float vY;
varying vec3 vWorld;
varying vec3 vNormalW;
${NOISE_GLSL}
void main() {
  vec3 view = normalize(cameraPosition - vWorld);
  // the middle of the cone holds more lit air than its grazing edges
  float body = pow(abs(dot(view, vNormalW)), 1.6);
  // brightest near the lamp, thinning toward the floor
  float fall = pow(vY, 1.35) * 0.85 + 0.15 * smoothstep(0.0, 0.12, vY);
  float drift = 0.72 + 0.28 * vnoise(vWorld * 0.55 + vec3(0.0, -uTime * 0.18, uTime * 0.07));
  float fade = 1.0 - smoothstep(uFar * 0.45, uFar, distance(cameraPosition, vWorld));
  float a = body * fall * drift * uLevel * fade;
  gl_FragColor = vec4(uColor * a, 1.0);
}`;

const poolFrag = /* glsl */ `
uniform vec3 uColor;
uniform float uLevel;
varying vec2 vUv;
void main() {
  float r = length(vUv - 0.5) * 2.0;
  float a = (1.0 - smoothstep(0.0, 1.0, r)) * (0.55 + 0.45 * (1.0 - smoothstep(0.55, 0.98, r)));
  a *= a;
  gl_FragColor = vec4(uColor * a * uLevel, 1.0);
}`;

function Shaft({ lamp, color, far }: { lamp: Lamp; color: THREE.Color; far: number }) {
  const h = lamp.height ?? 13;
  const mats = useMemo(() => {
    const beam = new THREE.ShaderMaterial({
      vertexShader: beamVert,
      fragmentShader: beamFrag,
      uniforms: { uColor: { value: color }, uLevel: { value: 0 }, uTime: { value: 0 }, uFar: { value: far }, uHeight: { value: h } },
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.FrontSide,
      toneMapped: false,
    });
    const pool = new THREE.ShaderMaterial({
      vertexShader: "varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }",
      fragmentShader: poolFrag,
      uniforms: { uColor: { value: color }, uLevel: { value: 0 } },
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      toneMapped: false,
    });
    return { beam, pool };
  }, [color, far, h]);
  const level = useRef(0);

  useFrame((state, dt) => {
    level.current += (lamp.level() - level.current) * (1 - Math.exp(-2.2 * Math.min(dt, 0.05)));
    const l = level.current;
    put(mats.beam.uniforms.uLevel, "value", 0.05 + 0.2 * l);
    put(mats.beam.uniforms.uTime, "value", state.clock.elapsedTime);
    put(mats.pool.uniforms.uLevel, "value", 0.05 + 0.3 * l);
  });

  return (
    <group position={[lamp.x, 0, lamp.z ?? -0.4]}>
      {/* an open cone, apex at the lamp */}
      <mesh material={mats.beam} position={[0, h / 2, 0]} renderOrder={2}>
        <coneGeometry args={[lamp.radius, h, 72, 1, true]} />
      </mesh>
      <mesh material={mats.pool} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.006, 0]} renderOrder={1}>
        <planeGeometry args={[lamp.radius * 2.6, lamp.radius * 2.6]} />
      </mesh>
      {/* the fixture itself, a short black can */}
      <mesh position={[0, h + 0.18, 0]}>
        <cylinderGeometry args={[0.16, 0.22, 0.42, 24]} />
        <meshStandardMaterial color="#0c0c0d" metalness={0.8} roughness={0.45} />
      </mesh>
      <mesh position={[0, h - 0.04, 0]} rotation={[Math.PI / 2, 0, 0]}>
        <circleGeometry args={[0.2, 24]} />
        <meshBasicMaterial color={color} toneMapped={false} />
      </mesh>
    </group>
  );
}

const dustVert = /* glsl */ `
attribute vec4 aSeed;
uniform float uTime;
uniform vec3 uBox;
uniform vec4 uLamps[12];
uniform float uLevels[12];
uniform float uPx;
varying float vA;
void main() {
  vec3 p = position;
  // slow Brownian drift, and a gentle fall that wraps around
  p.x += sin(uTime * (0.07 + aSeed.x * 0.08) + aSeed.y * 6.28) * 0.6;
  p.z += cos(uTime * (0.06 + aSeed.z * 0.07) + aSeed.x * 6.28) * 0.5;
  p.y = mod(p.y - uTime * (0.025 + aSeed.w * 0.05), uBox.y);
  // lit only inside a shaft: distance to each cone's axis against its radius at this height
  float lit = 0.0;
  for (int i = 0; i < 12; i++) {
    vec4 L = uLamps[i];
    if (L.w <= 0.0) continue;
    float r = L.w * (1.0 - p.y / 13.0) + 0.05;
    float d = length(p.xz - L.xz);
    lit += uLevels[i] * (1.0 - smoothstep(r * 0.5, r, d));
  }
  float tw = 0.55 + 0.45 * sin(uTime * (0.8 + aSeed.w * 2.0) + aSeed.z * 31.0);
  vA = (0.06 + 0.94 * min(lit, 1.0)) * tw;
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = uPx * (0.6 + aSeed.y) / -mv.z;
}`;

const dustFrag = /* glsl */ `
uniform vec3 uColor;
varying float vA;
void main() {
  vec2 c = gl_PointCoord - 0.5;
  float a = smoothstep(0.5, 0.0, length(c));
  gl_FragColor = vec4(uColor * a * a * vA, 1.0);
}`;

function Dust({ lamps, color, span }: { lamps: Lamp[]; color: THREE.Color; span: [number, number] }) {
  const gl = useThree((s) => s.gl);
  const { geo, mat } = useMemo(() => {
    const n = 2600;
    const pos = new Float32Array(n * 3);
    const seed = new Float32Array(n * 4);
    const [x0, x1] = span;
    const rnd = mulberry32(7);
    for (let i = 0; i < n; i++) {
      // most of the dust where the lamps are
      const L = lamps[i % lamps.length];
      const near = rnd() < 0.8;
      pos[i * 3] = near ? L.x + (rnd() - 0.5) * L.radius * 2.2 : x0 + rnd() * (x1 - x0);
      pos[i * 3 + 1] = rnd() * 11;
      pos[i * 3 + 2] = near ? (L.z ?? -0.4) + (rnd() - 0.5) * L.radius * 2.2 : -6 + rnd() * 12;
      for (let k = 0; k < 4; k++) seed[i * 4 + k] = rnd();
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    g.setAttribute("aSeed", new THREE.BufferAttribute(seed, 4));
    const lampsU = Array.from({ length: 12 }, (_, i) => {
      const L = lamps[i];
      return L ? new THREE.Vector4(L.x, 0, L.z ?? -0.4, L.radius) : new THREE.Vector4(0, 0, 0, 0);
    });
    const m = new THREE.ShaderMaterial({
      vertexShader: dustVert,
      fragmentShader: dustFrag,
      uniforms: {
        uTime: { value: 0 },
        uBox: { value: new THREE.Vector3(0, 11, 0) },
        uLamps: { value: lampsU },
        uLevels: { value: new Array(12).fill(0) },
        uColor: { value: color },
        uPx: { value: 60 },
      },
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      toneMapped: false,
    });
    return { geo: g, mat: m };
  }, [lamps, color, span]);
  const levels = useRef(lamps.map(() => 0));

  useFrame((state, dt) => {
    put(mat.uniforms.uTime, "value", state.clock.elapsedTime);
    put(mat.uniforms.uPx, "value", 46 * gl.getPixelRatio() * (state.size.height / 900));
    const lv = mat.uniforms.uLevels.value as number[];
    lamps.forEach((L, i) => {
      levels.current[i] += (L.level() - levels.current[i]) * (1 - Math.exp(-2.2 * Math.min(dt, 0.05)));
      put(lv, i, 0.25 + 0.75 * levels.current[i]);
    });
  });

  return <points geometry={geo} material={mat} frustumCulled={false} renderOrder={3} />;
}

/** one real spot that glides to the lit exhibit, so lacquer and metal catch a moving highlight */
function FollowSpot({ lamps, color }: { lamps: Lamp[]; color: string }) {
  const light = useRef<THREE.SpotLight>(null);
  const target = useMemo(() => new THREE.Object3D(), []);
  const x = useRef<number | null>(null);
  useFrame((_, dt) => {
    const l = light.current;
    if (!l) return;
    let best = lamps[0];
    let bv = -1;
    for (const L of lamps) {
      const v = L.level();
      if (v > bv) {
        bv = v;
        best = L;
      }
    }
    x.current ??= best.x;
    x.current += (best.x - x.current) * (1 - Math.exp(-1.6 * Math.min(dt, 0.05)));
    l.position.set(x.current - 1.5, 11, 6.5);
    target.position.set(x.current, 1.6, -0.3);
    target.updateMatrixWorld();
  });
  return (
    <>
      <primitive object={target} />
      <spotLight ref={light} target={target} angle={0.36} penumbra={0.85} intensity={140} distance={30} decay={1.6} color={color} />
    </>
  );
}

const coveVert = /* glsl */ `
varying vec3 vWorld;
void main() {
  vec4 w = modelMatrix * vec4(position, 1.0);
  vWorld = w.xyz;
  gl_Position = projectionMatrix * viewMatrix * w;
}`;

const coveFrag = /* glsl */ `
uniform vec3 uBg;
uniform vec3 uHorizon;
uniform vec3 uSky;
uniform vec2 uSpan;
varying vec3 vWorld;
void main() {
  // a glow low on the wall, as if a lamp on the floor washed it, falling into the dark above
  float y = vWorld.y;
  float g = smoothstep(0.2, 2.6, y) * (1.0 - smoothstep(3.2, 11.0, y));
  vec3 c = mix(uBg, uHorizon, g);
  c = mix(c, uSky, smoothstep(9.0, 26.0, y));
  // darker toward both ends of the hall
  float u = (vWorld.x - uSpan.x) / (uSpan.y - uSpan.x);
  float side = smoothstep(-0.25, 0.2, u) * smoothstep(1.25, 0.8, u);
  gl_FragColor = vec4(mix(uBg, c, side), 1.0);
}`;

/**
 * An infinity cove: the floor bends up into the back wall along a quarter circle, so there is no line where
 * one meets the other.
 */
function Cove({ theme, span, width }: { theme: Theme; span: [number, number]; width: number }) {
  const { geo, mat } = useMemo(() => {
    const prof: [number, number][] = [];
    const z0 = -10;
    const R = 6;
    // just below the floor where it starts, so the floor hides the seam
    prof.push([z0 + 1, -0.02]);
    for (let i = 0; i <= 24; i++) {
      const a = (i / 24) * (Math.PI / 2);
      prof.push([z0 - R * Math.sin(a), R - R * Math.cos(a)]);
    }
    prof.push([z0 - R, 46]);
    const pos: number[] = [];
    const idx: number[] = [];
    const cx = (span[0] + span[1]) / 2;
    prof.forEach(([z, y], i) => {
      pos.push(cx - width / 2, y, z, cx + width / 2, y, z);
      if (i) idx.push(2 * i - 2, 2 * i - 1, 2 * i, 2 * i - 1, 2 * i + 1, 2 * i);
    });
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    g.setIndex(idx);
    const m = new THREE.ShaderMaterial({
      vertexShader: coveVert,
      fragmentShader: coveFrag,
      uniforms: {
        uBg: { value: new THREE.Color(theme.bg) },
        uHorizon: { value: new THREE.Color(theme.horizon) },
        uSky: { value: new THREE.Color(theme.sky) },
        uSpan: { value: new THREE.Vector2(span[0], span[1]) },
      },
      side: THREE.DoubleSide,
      fog: false,
    });
    return { geo: g, mat: m };
  }, [theme, span, width]);
  return <mesh geometry={geo} material={mat} renderOrder={-1} />;
}

/** a soft, uneven roughness for the polished floor, so its reflections break up like concrete */
function floorNoise() {
  const rnd = mulberry32(3);
  const s = 256;
  const c = document.createElement("canvas");
  c.width = c.height = s;
  const g = c.getContext("2d")!;
  const img = g.createImageData(s, s);
  for (let i = 0; i < s * s; i++) {
    const v = 110 + rnd() * 40;
    img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = v;
    img.data[i * 4 + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  // a few broad blotches over the fine grain
  for (let k = 0; k < 40; k++) {
    const x = rnd() * s;
    const y = rnd() * s;
    const r = 20 + rnd() * 60;
    const grd = g.createRadialGradient(x, y, 0, x, y, r);
    const a = rnd() * 0.18;
    grd.addColorStop(0, `rgba(${rnd() < 0.5 ? "0,0,0" : "255,255,255"},${a})`);
    grd.addColorStop(1, "rgba(0,0,0,0)");
    g.fillStyle = grd;
    g.fillRect(0, 0, s, s);
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(24, 9);
  return t;
}

function Floor({ theme, lite, width }: { theme: Theme; lite: boolean; width: number }) {
  const noise = useMemo(() => (lite ? null : floorNoise()), [lite]);
  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]}>
      <planeGeometry args={[width, 90]} />
      {lite || !noise ? (
        <meshStandardMaterial color={theme.floor} roughness={0.55} metalness={0.2} />
      ) : (
        <MeshReflectorMaterial
          blur={[520, 160]}
          resolution={1024}
          mixBlur={1.2}
          mixStrength={34}
          mixContrast={1.15}
          roughness={0.88}
          depthScale={1.2}
          minDepthThreshold={0.3}
          maxDepthThreshold={1.5}
          color={theme.floor}
          metalness={0.6}
          mirror={0.7}
          distortionMap={noise}
          distortion={0.22}
          roughnessMap={noise}
        />
      )}
    </mesh>
  );
}

/** an environment of soft boxes, tinted by the theme, for every reflective surface */
function Studio({ theme }: { theme: Theme }) {
  return (
    <Environment resolution={256} frames={1}>
      <color attach="background" args={[theme.bg]} />
      <Lightformer form="rect" intensity={2.6} color={theme.key} position={[0, 10, 3]} rotation={[Math.PI / 2, 0, 0]} scale={[100, 2.4, 1]} />
      <Lightformer form="rect" intensity={1.6} color={theme.rim[0]} position={[-40, 5, 14]} rotation={[0, Math.PI / 3, 0]} scale={[18, 6, 1]} />
      <Lightformer form="rect" intensity={1.6} color={theme.rim[1]} position={[40, 5, 14]} rotation={[0, -Math.PI / 3, 0]} scale={[18, 6, 1]} />
      <Lightformer form="rect" intensity={0.7} color={theme.key} position={[0, 4, 24]} scale={[100, 3, 1]} />
      <Lightformer form="ring" intensity={2.2} color={theme.beam} position={[0, 14, -2]} rotation={[Math.PI / 2, 0, 0]} scale={6} />
    </Environment>
  );
}

/** the hall: environment, backdrop, floor, shafts, dust and the follow spot */
export function Hall({ theme, lamps, span, lite }: { theme: Theme; lamps: Lamp[]; span: [number, number]; lite: boolean }) {
  const beam = useMemo(() => new THREE.Color(theme.beam), [theme.beam]);
  const width = span[1] - span[0] + 140;
  return (
    <>
      <Studio theme={theme} />
      <Cove theme={theme} span={span} width={width} />
      <Floor theme={theme} lite={lite} width={width} />
      {lamps.map((L, i) => (
        <Shaft key={i} lamp={L} color={beam} far={lite ? 60 : 90} />
      ))}
      {!lite && <Dust lamps={lamps} color={beam} span={span} />}
      <FollowSpot lamps={lamps} color={theme.spot} />
    </>
  );
}
