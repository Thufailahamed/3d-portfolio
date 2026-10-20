"use client";

import { useFrame } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import * as THREE from "three";
import { getLab } from "../lab";
import { TEXT_ENCODER, TOKENIZER } from "../sd15";
import { X } from "../story";
import { useLab } from "../store";
import { C, Caption, Label, approach, put, stageT } from "./common";

/**
 * CLIP's text transformer as 12 layers the 77 token positions stream through. Each layer carries the causal
 * mask it really applies (position i attends to positions ≤ i); SD 1.x reads the last layer's normed output.
 */

const LAYERS = TEXT_ENCODER.layers;
const SPAN = 5.0;
const TOP = 2.95;
const BOTTOM = 0.62;
const PANE_W = 1.3;
const PANE_H = TOP - BOTTOM + 0.26;
const YAW = -0.92;
const x0 = -SPAN / 2;
const rowY = (r: number) => TOP - (r / (TOKENIZER.context - 1)) * (TOP - BOTTOM);

function causalMask() {
  const n = TOKENIZER.context;
  const s = 4;
  const c = document.createElement("canvas");
  c.width = c.height = n * s;
  const g = c.getContext("2d")!;
  g.fillStyle = "#101318";
  g.fillRect(0, 0, c.width, c.height);
  for (let i = 0; i < n; i++)
    for (let j = 0; j <= i; j++) {
      g.fillStyle = i === j ? "rgba(190,212,255,1)" : `rgba(130,165,240,${0.16 + 0.22 * (1 - (i - j) / n)})`;
      g.fillRect(j * s, i * s, s - 1, s - 1);
    }
  g.strokeStyle = "rgba(236,233,226,0.5)";
  g.lineWidth = 2;
  g.strokeRect(1, 1, c.width - 2, c.height - 2);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

function embedding(content: number, bright: number) {
  const n = TOKENIZER.context;
  const c = document.createElement("canvas");
  c.width = 384;
  c.height = n * 4;
  const g = c.getContext("2d")!;
  g.fillStyle = "#07080a";
  g.fillRect(0, 0, c.width, c.height);
  for (let r = 0; r < n; r++) {
    const a = r < content ? bright : bright * 0.28;
    g.fillStyle = `rgba(143,180,255,${a})`;
    g.fillRect(0, r * 4, c.width, 3);
  }
  // column rules every 16 of the 768 features
  g.fillStyle = "rgba(7,8,10,0.6)";
  for (let k = 0; k < 48; k++) g.fillRect(k * 8, 0, 1, c.height);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

const streamVert = /* glsl */ `
attribute float aOn;
varying float vOn;
varying float vX;
void main() {
  vOn = aOn;
  vX = position.x;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;
const streamFrag = /* glsl */ `
uniform float uHead;
uniform vec3 uColor;
varying float vOn;
varying float vX;
void main() {
  float lit = smoothstep(uHead + 0.05, uHead - 0.35, vX);
  float head = exp(-pow((vX - uHead) / 0.18, 2.0));
  float a = (0.07 + 0.5 * lit + 0.9 * head) * mix(0.32, 1.0, vOn);
  gl_FragColor = vec4(uColor * a * 1.6, 1.0);
}`;

export default function TextEncoder() {
  const cls = useLab((s) => s.cls);
  const lab = getLab();
  const n = (lab?.assets.manifest.classes[cls]?.tokens.length ?? 0) + 2;

  const mask = useMemo(() => causalMask(), []);
  const embC = useMemo(() => embedding(n, 0.8), [n]);
  const embU = useMemo(() => embedding(2, 0.45), []);
  const paneMats = useMemo(
    () =>
      Array.from(
        { length: LAYERS },
        () => new THREE.MeshStandardMaterial({ map: mask, emissiveMap: mask, emissive: new THREE.Color(C.text), emissiveIntensity: 0.15, color: "#9aa3b4", roughness: 0.35, metalness: 0.05, transparent: true, opacity: 0.9, side: THREE.DoubleSide }),
      ),
    [mask],
  );

  const streams = useMemo(() => {
    const pos: number[] = [];
    const on: number[] = [];
    for (let r = 0; r < TOKENIZER.context; r++) {
      const y = rowY(r);
      pos.push(x0 - 1.2, y, 0, SPAN / 2 + 0.85, y, 0);
      const v = r < n ? 1 : 0;
      on.push(v, v);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute("aOn", new THREE.Float32BufferAttribute(on, 1));
    return g;
  }, [n]);
  const streamMat = useMemo(
    () => new THREE.ShaderMaterial({ vertexShader: streamVert, fragmentShader: streamFrag, uniforms: { uHead: { value: -10 }, uColor: { value: new THREE.Color(C.text) } }, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false }),
    [],
  );
  const outGlow = useRef(0);
  const outMat = useRef<THREE.MeshBasicMaterial>(null);

  useFrame((_, dt) => {
    const t = stageT("text");
    // the activations sweep through the layers in order
    const head = t <= 0 ? x0 - 1.4 : t >= 1 ? SPAN / 2 + 2 : x0 - 1.2 + t * (SPAN + 2.6);
    put(streamMat.uniforms.uHead, "value", head);
    paneMats.forEach((m, i) => {
      const px = x0 + (i + 0.5) * (SPAN / LAYERS);
      const near = Math.exp(-(((head - px) / 0.4) ** 2));
      put(m, "emissiveIntensity", approach(m.emissiveIntensity, 0.22 + (t >= 1 ? 0.2 : 0) + 1.6 * near, 10, dt));
    });
    outGlow.current = approach(outGlow.current, t > 0.82 ? 1 : 0.25, 3, dt);
    if (outMat.current) outMat.current.color.setScalar(0.35 + 0.75 * outGlow.current);
  });

  return (
    <group position={[X.text, 0, 0]}>
      <Caption
        n="02"
        title="Text encoder"
        spec={`CLIP ViT-L/14 · ${LAYERS} × (causal self-attention + MLP ${TEXT_ENCODER.mlp}) · d ${TEXT_ENCODER.width} · ${TEXT_ENCODER.heads} heads · 123.06 M params`}
        tag={{ text: "reference · not executed here", kind: "ref" }}
        position={[-3.6, 4.05, 0]}
        width={7.4}
      />
      <lineSegments geometry={streams} material={streamMat} />
      {paneMats.map((m, i) => (
        <group key={i} position={[x0 + (i + 0.5) * (SPAN / LAYERS), (TOP + BOTTOM) / 2, 0]} rotation={[0, YAW, 0]}>
          <mesh material={m} rotation={[0, Math.PI / 2, 0]}>
            <planeGeometry args={[PANE_W, PANE_H]} />
          </mesh>
          <mesh position={[0, PANE_H / 2 + 0.01, 0]}>
            <boxGeometry args={[0.012, 0.012, PANE_W]} />
            <meshStandardMaterial color="#8e939a" metalness={1} roughness={0.3} />
          </mesh>
          <Label fontSize={0.07} color={C.faint} anchorX="center" position={[0, -PANE_H / 2 - 0.1, 0]} rotation={[0, -YAW, 0]}>
            {String(i + 1)}
          </Label>
        </group>
      ))}
      <Label fontSize={0.075} color={C.faint} position={[x0 - 1.2, TOP + 0.24, 0]}>
        {"77 token positions · embed + position"}
      </Label>
      <Label fontSize={0.075} color={C.faint} position={[x0 + 0.3, BOTTOM - 0.62, 0.4]}>
        {"layers 1–12 · each shows its causal attention mask (77 × 77)"}
      </Label>

      {/* the two conditioning tensors the U-Net cross-attends to */}
      <group position={[SPAN / 2 + 1.25, (TOP + BOTTOM) / 2, 0]} rotation={[0, -0.45, 0]}>
        <mesh position={[0, 0, -1.05]}>
          <planeGeometry args={[1.05, PANE_H]} />
          <meshBasicMaterial map={embU} toneMapped={false} color={[0.55, 0.55, 0.55]} />
        </mesh>
        <mesh>
          <planeGeometry args={[1.05, PANE_H]} />
          <meshBasicMaterial ref={outMat} map={embC} toneMapped={false} />
        </mesh>
        <Label fontSize={0.085} color={C.text} position={[-0.52, PANE_H / 2 + 0.14, 0]}>
          {"c · prompt  [77 × 768]"}
        </Label>
        <Label fontSize={0.075} color={C.faint} position={[-0.52, PANE_H / 2 + 0.14, -1.05]}>
          {"c · empty prompt"}
        </Label>
      </group>
    </group>
  );
}
