"use client";

import { useFrame } from "@react-three/fiber";
import { useMemo } from "react";
import * as THREE from "three";
import { L, getLab } from "../lab";
import { X } from "../story";
import { C, Caption, Label, Screen, Stand, approach, put, smooth, stageT } from "./common";
import { PHASE, stepPhase, useShownStep, within } from "./useShownStep";

/**
 * The latent z_t itself: 4 channels × 64 × 64 = 16,384 numbers, each channel a relief whose height and colour
 * are the values (blue below zero, ember above). Pure noise is jagged terrain; as the loop runs it settles into
 * the picture's structure. Heights come from a float texture in the vertex shader, so a step uploads 64 KB.
 */

const CELL = 0.042;
const GAP = 0.78;
const BASE = 1.75;
export const LATENT_TOP = BASE + 1.5 * GAP;
const SIDE = L * CELL;

const DIVERGING = /* glsl */ `
vec3 divergingMap(float v) {
  float x = clamp(v, -1.0, 1.0);
  vec3 c0 = vec3(0.07, 0.075, 0.085);
  vec3 m1 = x < 0.0 ? vec3(0.12, 0.33, 0.55) : vec3(0.52, 0.17, 0.08);
  vec3 m2 = x < 0.0 ? vec3(0.55, 0.78, 0.98) : vec3(1.0, 0.7, 0.5);
  float a = abs(x) * 2.0;
  vec3 c = a < 1.0 ? mix(c0, m1, a) : mix(m1, m2, a - 1.0);
  return pow(c, vec3(2.2));
}`;

function useSurfaces() {
  return useMemo(() => {
    const plane = new THREE.PlaneGeometry(1, 1, L - 1, L - 1);
    const geo = new THREE.InstancedBufferGeometry();
    geo.index = plane.index;
    geo.setAttribute("position", plane.getAttribute("position"));
    geo.setAttribute("uv", plane.getAttribute("uv"));
    geo.setAttribute("normal", plane.getAttribute("normal"));
    geo.setAttribute("aChan", new THREE.InstancedBufferAttribute(new Float32Array([0, 1, 2, 3]), 1));
    geo.instanceCount = 4;
    const uniforms = {
      uLatA: { value: null as THREE.Texture | null },
      uLatB: { value: null as THREE.Texture | null },
      uMix: { value: 0 },
      uHeight: { value: 0 },
      uRange: { value: 2.5 },
    };
    const mat = new THREE.MeshStandardMaterial({ roughness: 0.55, metalness: 0.0, side: THREE.DoubleSide });
    mat.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, uniforms);
      sh.vertexShader = sh.vertexShader
        .replace(
          "#include <common>",
          `#include <common>
attribute float aChan;
uniform sampler2D uLatA;
uniform sampler2D uLatB;
uniform float uMix;
uniform float uHeight;
uniform float uRange;
varying vec3 vData;
${DIVERGING}
float latent(vec2 ij) {
  vec2 t = (clamp(ij, 0.0, ${L - 1}.0) + 0.5) / ${L}.0;
  vec4 l = mix(texture2D(uLatA, t), texture2D(uLatB, t), uMix);
  return aChan < 0.5 ? l.x : aChan < 1.5 ? l.y : aChan < 2.5 ? l.z : l.w;
}`,
        )
        .replace(
          "#include <beginnormal_vertex>",
          `// column i from the left, row j from the top (the far edge), as in the image
vec2 ij = vec2(uv.x, 1.0 - uv.y) * ${L - 1}.0;
float val = latent(ij);
float dx = (latent(ij + vec2(1.0, 0.0)) - latent(ij - vec2(1.0, 0.0))) * uHeight / (2.0 * ${CELL});
float dz = (latent(ij + vec2(0.0, 1.0)) - latent(ij - vec2(0.0, 1.0))) * uHeight / (2.0 * ${CELL});
vec3 objectNormal = normalize(vec3(-dx, 1.0, -dz));
#ifdef USE_TANGENT
  vec3 objectTangent = vec3(tangent.xyz);
#endif`,
        )
        .replace(
          "#include <begin_vertex>",
          `vec3 transformed = vec3((uv.x - 0.5) * ${SIDE.toFixed(4)}, (1.5 - aChan) * ${GAP} + val * uHeight, (0.5 - uv.y) * ${SIDE.toFixed(4)});
vData = divergingMap(val / uRange);`,
        );
      sh.fragmentShader = sh.fragmentShader
        .replace("#include <common>", "#include <common>\nvarying vec3 vData;")
        .replace("#include <color_fragment>", "#include <color_fragment>\ndiffuseColor.rgb = vData;")
        .replace("#include <emissivemap_fragment>", "#include <emissivemap_fragment>\ntotalEmissiveRadiance += vData * 0.22;");
    };
    return { geo, mat, uniforms };
  }, []);
}

function plateTexture() {
  const c = document.createElement("canvas");
  c.width = c.height = 512;
  const g = c.getContext("2d")!;
  g.fillStyle = "#0b0c0f";
  g.fillRect(0, 0, 512, 512);
  g.strokeStyle = "rgba(236,233,226,0.08)";
  g.lineWidth = 1;
  for (let k = 0; k <= 64; k += 8) {
    const p = (k / 64) * 512;
    g.beginPath();
    g.moveTo(p, 0);
    g.lineTo(p, 512);
    g.moveTo(0, p);
    g.lineTo(512, p);
    g.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

export default function Latent() {
  const { geo, mat, uniforms } = useSurfaces();
  const plate = useMemo(() => plateTexture(), []);
  const lab = getLab();
  const step = useShownStep();
  const t = lab?.record(step.k);
  const tLabel = step.k >= step.steps ? "z(0) · clean latent" : step.k <= 0 && step.pre ? "z(T) ~ N(0, I)" : `z(t) · t = ${t?.t ?? 999}`;

  useFrame((_, dt) => {
    const l = getLab();
    if (!l) return;
    put(uniforms.uLatA, "value", l.latA);
    put(uniforms.uLatB, "value", l.latB);
    // z_t is only replaced once the scheduler has stepped
    const ph = stepPhase();
    put(uniforms.uMix, "value", ph < 0 ? 0 : smooth(0, 1, within(ph, PHASE.back)));
    const noise = stageT("noise");
    put(uniforms.uHeight, "value", approach(uniforms.uHeight.value, 0.085 * noise, 6, dt));
  });

  return (
    <group position={[X.latent, 0, 0]}>
      <Caption n="03" title="Latent" spec="1 × 4 × 64 × 64 · 16,384 numbers · 512 px / 8 = 64 · what every step reads and rewrites" tag={{ text: "live", kind: "live" }} position={[-1.6, 4.35, 0]} width={5.2} />
      <Label fontSize={0.11} color={C.fg} position={[-1.6, 3.62, 0]}>
        {tLabel}
      </Label>
      <mesh geometry={geo} material={mat} position={[0, BASE, 0]} frustumCulled={false} />
      {[0, 1, 2, 3].map((c) => (
        <group key={c} position={[0, BASE + (1.5 - c) * GAP, 0]}>
          <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.32, 0]}>
            <planeGeometry args={[SIDE + 0.12, SIDE + 0.12]} />
            <meshStandardMaterial map={plate} transparent opacity={0.35} roughness={0.25} metalness={0.2} depthWrite={false} />
          </mesh>
          <Label fontSize={0.085} color={C.faint} anchorX="right" position={[-SIDE / 2 - 0.14, 0, SIDE / 2]}>
            {`ch ${c}`}
          </Label>
        </group>
      ))}

      {/* what the latent looks like, and what the model currently thinks it will become */}
      <group position={[-3.45, 0, -0.7]} rotation={[0, 0.38, 0]}>
        <Stand height={0.68} />
        <Screen w={1.12} h={1.12} map={lab?.ztTex ?? null} position={[0, 2.62, 0]} />
        <Label fontSize={0.075} color={C.dim} position={[-0.56, 3.3, 0]}>
          {"z(t) · latent › RGB (linear fit)"}
        </Label>
        <Screen w={1.12} h={1.12} map={lab?.x0Tex ?? null} position={[0, 1.24, 0]} />
        <Label fontSize={0.075} color={C.dim} position={[-0.56, 1.92, 0]}>
          {"predicted z(0) · Tweedie"}
        </Label>
      </group>
    </group>
  );
}
