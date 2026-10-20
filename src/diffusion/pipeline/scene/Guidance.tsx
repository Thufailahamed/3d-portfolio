"use client";

import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { getLab } from "../lab";
import { SAMPLERS, T } from "../../schedule";
import { X } from "../story";
import { useLab } from "../store";
import { C, Caption, Label, Screen, Stand, smooth } from "./common";
import { PHASE, stepPhase, useShownStep, within } from "./useShownStep";

/**
 * Classifier-free guidance and the sampler step. The three panels are the real ε̂ tensors of the shown step
 * (four channels as a 2 × 2 grid, blue < 0 < ember); the dial has one tick per timestep in the plan.
 */

export const GUIDE_EPS: [number, number, number] = [X.guide, 3.05, 0];
export const RING: [number, number, number] = [X.guide, 1.22, 0];
const R = 0.8;

const angleOf = (t: number) => Math.PI / 2 - (1 - (t + 1) / T) * Math.PI * 2;

export default function Guidance() {
  const lab = getLab();
  const run = useLab((s) => s.run);
  const w = useLab((s) => s.w);
  const cls = useLab((s) => s.cls);
  const sampler = useLab((s) => s.sampler);
  const { k, steps, pre } = useShownStep();
  const rec = lab?.record(k);
  const plan = lab?.run?.plan;
  const ticks = useRef<THREE.InstancedMesh>(null);
  const head = useRef<THREE.Mesh>(null);
  const tickGeo = useMemo(() => new THREE.BoxGeometry(0.012, 0.1, 0.012), []);
  const tickMat = useMemo(() => new THREE.MeshBasicMaterial({ toneMapped: false }), []);

  // ticks at each planned timestep, coloured by done / current / to come
  useEffect(() => {
    const m = ticks.current;
    if (!m || !plan) return;
    const o = new THREE.Object3D();
    const col = new THREE.Color();
    plan.forEach((st, i) => {
      const a = angleOf(st.t);
      o.position.set(Math.cos(a) * R, Math.sin(a) * R, 0);
      o.rotation.set(0, 0, a - Math.PI / 2);
      o.scale.set(1, i === k && !pre ? 1.8 : 1, 1);
      o.updateMatrix();
      m.setMatrixAt(i, o.matrix);
      m.setColorAt(i, col.set(pre ? C.faint : i < k ? C.fg : i === k ? C.accent : C.faint));
    });
    m.count = plan.length;
    m.instanceMatrix.needsUpdate = true;
    if (m.instanceColor) m.instanceColor.needsUpdate = true;
  }, [plan, k, pre, run]);

  // the hand sweeps from t to s during the scheduler's share of the step
  useFrame(() => {
    const h = head.current;
    if (!h || !plan) return;
    const ph = stepPhase();
    const st = plan[Math.min(k, plan.length - 1)];
    if (!st) return;
    const f = ph < 0 ? (k >= steps ? 1 : 0) : smooth(0, 1, within(ph, PHASE.sched));
    const a0 = angleOf(st.t);
    const a1 = angleOf(st.s);
    const a = k >= steps ? angleOf(-1) : a0 + (a1 - a0) * f;
    h.rotation.z = a - Math.PI / 2;
  });

  const name = SAMPLERS.find((s) => s.id === sampler)?.label ?? sampler;
  const ts = rec ? (k >= steps ? "t = 0 · done" : `t ${rec.t} › ${rec.s < 0 ? 0 : rec.s}`) : "t 999";

  return (
    <group position={[X.guide, 0, 0]}>
      <Caption n="05" title="Guidance & scheduler" spec={`e = e(empty) + w · (e(prompt) − e(empty)),  w = ${cls < 0 ? "—" : w.toFixed(1)} · then one ${name} step`} tag={{ text: "live sampler", kind: "live" }} position={[-1.55, 6.25, 0]} width={4.4} />
      <Stand x={-0.72} height={4.1} z={-0.14} />
      <Stand x={0.72} height={4.1} z={-0.14} />
      <Screen w={1.14} h={1.14} map={lab?.epsTex[0] ?? null} position={[-0.72, 4.72, 0]} />
      <Screen w={1.14} h={1.14} map={lab?.epsTex[1] ?? null} position={[0.72, 4.72, 0]} />
      <Label fontSize={0.072} color={C.uncond} anchorX="center" position={[-0.72, 5.43, 0]}>
        {"noise pred · empty prompt"}
      </Label>
      <Label fontSize={0.072} color={C.accent} anchorX="center" position={[0.72, 5.43, 0]}>
        {"noise pred · prompt"}
      </Label>
      <Screen w={1.3} h={1.3} map={lab?.epsTex[2] ?? null} position={[0, GUIDE_EPS[1], 0]} />
      <Label fontSize={0.072} color={C.fg} anchorX="center" position={[0, 3.86, 0]}>
        {`guided noise · w = ${cls < 0 ? "—" : w.toFixed(1)}`}
      </Label>
      <Label fontSize={0.064} color={C.faint} anchorX="center" position={[0, 2.25, 0]}>
        {"4 channels as 2 × 2 · blue < 0 < ember"}
      </Label>

      {/* the scheduler's dial */}
      <group position={[0, RING[1], 0]}>
        <mesh>
          <torusGeometry args={[R, 0.006, 8, 160]} />
          <meshStandardMaterial color="#8e939a" metalness={1} roughness={0.3} />
        </mesh>
        <instancedMesh ref={ticks} args={[tickGeo, tickMat, 1000]} frustumCulled={false} />
        <mesh ref={head}>
          <boxGeometry args={[0.012, R * 0.82, 0.01]} />
          <meshBasicMaterial color={C.accent} toneMapped={false} />
        </mesh>
        <mesh>
          <circleGeometry args={[0.03, 20]} />
          <meshBasicMaterial color={C.accent} toneMapped={false} />
        </mesh>
        <Label fontSize={0.085} color={C.fg} anchorX="center" position={[0, -0.26, 0.01]}>
          {name}
        </Label>
        <Label fontSize={0.075} color={C.dim} anchorX="center" position={[0, -0.42, 0.01]}>
          {ts}
        </Label>
        <Label fontSize={0.062} color={C.faint} anchorX="center" position={[0, R + 0.16, 0]}>
          {"t = 999"}
        </Label>
      </group>
      <Label fontSize={0.064} color={C.faint} anchorX="center" position={[0, 0.2, 0]}>
        {`scaled-linear betas · 1000 training steps · ${steps} sampled, trailing spacing`}
      </Label>
    </group>
  );
}
