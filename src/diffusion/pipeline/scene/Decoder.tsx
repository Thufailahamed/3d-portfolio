"use client";

import { Text } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import * as THREE from "three";
import { getLab } from "../lab";
import { TAESD, VAE } from "../sd15";
import { X } from "../story";
import { useLab } from "../store";
import { Bezel, C, Caption, FONT, Label, MAT, Stand, approach, put, type Tag } from "./common";

/**
 * TAESD's decoder, run for real on the GPU: each panel is the activation after one resolution stage
 * (three channel-group means of 64 channels), filled in as the WebGL network reaches it.
 */

export const PANELS = [
  { side: 64, size: 0.86, x: -3.1, label: "64 × 64 × 64", detail: "conv 4 › 64 · 3 blocks" },
  { side: 128, size: 1.18, x: -1.78, label: "128 × 128 × 64", detail: "↑2 · conv · 3 blocks" },
  { side: 256, size: 1.6, x: -0.1, label: "256 × 256 × 64", detail: "↑2 · conv · 3 blocks" },
  { side: 512, size: 2.12, x: 2.0, label: "512 × 512 × 64", detail: "↑2 · conv · 1 block · conv 64 › 3" },
];
const FLOOR_GAP = 1.0;
export const VAE_IN: [number, number, number] = [X.vae - 4.25, 1.55, 0];
export const VAE_OUT: [number, number, number] = [X.vae + 2.0 + 1.06, FLOOR_GAP + 1.06, 0];

export default function Decoder() {
  const lab = getLab();
  const decode = useLab((s) => s.decode);
  const mats = useRef<(THREE.MeshBasicMaterial | null)[]>([]);
  const lit = useRef(PANELS.map(() => 0));

  useFrame((_, dt) => {
    const d = useLab.getState().decode;
    PANELS.forEach((_, i) => {
      lit.current[i] = approach(lit.current[i], d.stages > i ? 1 : 0.06, 5, dt);
      mats.current[i]?.color.setScalar(lit.current[i]);
    });
  });

  const status: Tag =
    decode.status === "running"
      ? { text: `real weights · decoding on your GPU · stage ${Math.min(4, decode.stages + 1)} of 4`, kind: "live" }
      : decode.status === "done"
        ? { text: `real weights · decoded in ${decode.ms.toFixed(0)} ms on your GPU`, kind: "live" }
        : decode.status === "error"
          ? { text: `GPU decode unavailable: ${lab?.decodeError ?? "unknown error"}`, kind: "ref" }
          : { text: "real weights · waits for the loop to finish", kind: "live" };

  return (
    <group position={[X.vae, 0, 0]}>
      <Caption
        n="06"
        title="VAE decoder"
        spec={`TAESD · ${(TAESD.decoderParams / 1e6).toFixed(2)} M params, distilled from SD's ${(VAE.decoderParams / 1e6).toFixed(1)} M-param decoder · same latent space · real weights`}
        tag={status}
        position={[-4.4, 4.05, 0]}
        width={7.6}
      />
      {/* tanh clamp, then the first conv */}
      <group position={[VAE_IN[0] - X.vae, VAE_IN[1], 0]}>
        <mesh material={MAT.cell()}>
          <boxGeometry args={[0.62, 0.42, 0.05]} />
        </mesh>
        <Bezel w={0.62} h={0.42} t={0.012} d={0.06} />
        <Label fontSize={0.07} color={C.fg} anchorX="center" position={[0, 0.05, 0.04]}>
          {"3 · tanh(z / 3)"}
        </Label>
        <Label fontSize={0.06} color={C.faint} anchorX="center" position={[0, -0.09, 0.04]}>
          {"clamp"}
        </Label>
        <Stand height={1.34} z={0} />
      </group>
      {PANELS.map((p, i) => (
        <group key={p.side} position={[p.x, 0, 0]}>
          <Stand height={FLOOR_GAP} />
          <group position={[0, FLOOR_GAP + p.size / 2, 0]}>
            <mesh material={MAT.panel()} position={[0, 0, -0.03]}>
              <boxGeometry args={[p.size + 0.02, p.size + 0.02, 0.04]} />
            </mesh>
            <mesh>
              <planeGeometry args={[p.size, p.size]} />
              <meshBasicMaterial ref={(m) => void (mats.current[i] = m)} map={lab?.vaeTex[i] ?? null} toneMapped={false} />
            </mesh>
            <Bezel w={p.size} h={p.size} />
          </group>
          <Label fontSize={0.078} color={C.fg} anchorX="center" position={[0, FLOOR_GAP - 0.16, 0.05]}>
            {p.label}
          </Label>
          <Label fontSize={0.064} color={C.faint} anchorX="center" position={[0, FLOOR_GAP - 0.3, 0.05]}>
            {p.detail}
          </Label>
        </group>
      ))}
    </group>
  );
}

const printVert = "varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }";

/**
 * The print develops as darkroom paper does: it starts as blank paper and the dark tones come up first, then the
 * mid-tones, with a little unevenness while the developer works. Only how the finished image arrives; once
 * developed it is the decoder's output, untouched.
 */
const printFrag = /* glsl */ `
uniform sampler2D uMap;
uniform float uDev;
uniform vec3 uPaper;
varying vec2 vUv;
float h(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float vn(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(h(i), h(i + vec2(1, 0)), f.x), mix(h(i + vec2(0, 1)), h(i + vec2(1, 1)), f.x), f.y);
}
void main() {
  vec3 img = texture2D(uMap, vUv).rgb;
  float lum = dot(img, vec3(0.2126, 0.7152, 0.0722));
  float mottle = (vn(vUv * 9.0) - 0.5) * 0.35 + (vn(vUv * 31.0) - 0.5) * 0.15;
  float k = clamp(uDev * 1.7 - lum * 0.7 + mottle * (1.0 - uDev), 0.0, 1.0);
  k = uDev >= 1.0 ? 1.0 : k * k * (3.0 - 2.0 * k);
  gl_FragColor = vec4(mix(uPaper, img, k), 1.0);
}`;

export function Output() {
  const lab = getLab();
  const cls = useLab((s) => s.cls);
  const steps = useLab((s) => s.steps);
  const sampler = useLab((s) => s.sampler);
  const w = useLab((s) => s.w);
  const seed = useLab((s) => s.seed);
  const done = useLab((s) => s.decode.status === "done");
  const prompt = lab?.assets.manifest.classes[cls]?.prompt ?? "";
  const dev = useRef(0);
  const SIZE = 3.0;
  const MAT_W = 0.36;
  const FRAME = 0.075;
  const print = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader: printVert,
        fragmentShader: printFrag,
        uniforms: { uMap: { value: lab?.outTex ?? null }, uDev: { value: 0 }, uPaper: { value: new THREE.Color("#3a3631") } },
        toneMapped: false,
      }),
    [lab],
  );
  const frame = useMemo(() => new THREE.MeshStandardMaterial({ color: "#0d0b0a", roughness: 0.42, metalness: 0.15 }), []);
  const board = useMemo(() => new THREE.MeshStandardMaterial({ color: "#8e877c", roughness: 0.96, metalness: 0 }), []);

  useFrame((_, dt) => {
    // developing takes a few seconds; a new run puts fresh paper in
    const d = useLab.getState().decode.status === "done";
    dev.current = d ? Math.min(1, dev.current + dt / 3.2) : 0;
    put(print.uniforms.uDev, "value", dev.current);
  });

  const outer = SIZE + 2 * MAT_W;
  return (
    <group position={[X.out, 0, 0]}>
      <Caption n="07" title="Image" spec="1 × 3 × 512 × 512 · clamped to [0, 1] · nothing after the decoder" position={[-1.5, 5.55, 0]} width={4} />
      <group position={[0, 1.1 + outer / 2, 0]}>
        {/* a black frame, a bone mat, and the print behind its window */}
        <mesh material={frame} position={[0, 0, -0.05]}>
          <boxGeometry args={[outer + 2 * FRAME, outer + 2 * FRAME, 0.09]} />
        </mesh>
        <mesh material={board} position={[0, 0, 0.0]}>
          <planeGeometry args={[outer, outer]} />
        </mesh>
        <mesh material={print} position={[0, 0, 0.004]}>
          <planeGeometry args={[SIZE, SIZE]} />
        </mesh>
        {/* the mat's bevelled window catches a thin line of light */}
        <Bezel w={SIZE} h={SIZE} t={0.012} d={0.012} material={board} />
      </group>
      <Stand x={-1.1} height={1.1} z={-0.08} />
      <Stand x={1.1} height={1.1} z={-0.08} />
      {/* the wall label */}
      <group position={[outer / 2 + 0.45, 2.3, 0]}>
        <mesh position={[0.95, -0.38, -0.01]}>
          <planeGeometry args={[2.1, 1.12]} />
          <meshStandardMaterial color="#14110f" roughness={0.8} />
        </mesh>
        <Label sans medium fontSize={0.062} color={C.accent} position={[0.08, 0.06, 0]} letterSpacing={0.14}>
          {done ? "NO. 07 · DEVELOPED" : "NO. 07 · AWAITING THE DECODER"}
        </Label>
        <Text font={FONT.displayItalic} fontSize={0.15} color={done ? C.fg : C.faint} maxWidth={1.9} anchorX="left" anchorY="top" position={[0.08, -0.06, 0]} lineHeight={1.12} material-toneMapped={false}>
          {`“${prompt}”`}
        </Text>
        <Label fontSize={0.06} color={C.dim} position={[0.08, -0.82, 0]} maxWidth={1.9}>
          {`seed ${seed} · ${sampler.toUpperCase()} · ${steps} steps · w ${w.toFixed(1)}`}
        </Label>
      </group>
      <spotLight position={[0, 7.5, 5]} angle={0.4} penumbra={0.9} intensity={40} distance={18} color="#fff1df">
        <object3D attach="target" position={[0, -5.0, -5]} />
      </spotLight>
    </group>
  );
}
