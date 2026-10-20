"use client";

import { Line } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import * as THREE from "three";
import { X, type StageId } from "../story";
import { C, approach, isLive, stageT } from "./common";

/** The signal moving between stations: each hop's dashes run while it hands its tensor on. */

type V3 = [number, number, number];
type Flow = { pts: V3[]; from: StageId; to: StageId; color: string };

const FLOWS: Flow[] = [
  { pts: [[X.mic + 5.65, 1.55, 0], [X.mic + 6.2, 1.75, 0.3], [X.vad - 4.15, 1.95, 0]], from: "sound", to: "vad", color: C.fg },
  { pts: [[X.vad + 2.25, 1.15, 0], [X.vad + 4.2, 0.35, 1.0], [X.resample - 4.55, 0.95, 0]], from: "vad", to: "resample", color: C.speech },
  { pts: [[X.resample + 4.45, 0.95, 0], [X.resample + 5.2, 0.55, 0.6], [X.stft - 6.35, 1.3, 0]], from: "resample", to: "stft", color: C.fg },
  { pts: [[X.stft + 3.0, 1.6, 0], [X.stft + 6.6, 2.0, 0.5], [X.mel - 4.85, 2.75, 0]], from: "stft", to: "mel", color: C.time },
  { pts: [[X.mel + 4.7, 0.4, 0.8], [X.mel + 7.6, 0.25, 1.2], [X.encoder - 2.15, 0.7, 0]], from: "mel", to: "encoder", color: C.fg },
  { pts: [[X.encoder + 3.15, 4.4, 0], [X.encoder + 6.6, 2.4, 0.6], [X.decoder - 4.65, 0.62, 0]], from: "encoder", to: "decoder", color: C.text },
  { pts: [[X.decoder + 4.3, 2.55, 0], [X.decoder + 5.9, 3.0, 0.5], [X.text - 4.6, 3.25, 0]], from: "decoder", to: "text", color: C.text },
];

function FlowLine({ flow }: { flow: Flow }) {
  const points = useMemo(() => new THREE.CatmullRomCurve3(flow.pts.map((p) => new THREE.Vector3(...p)), false, "centripetal").getPoints(60), [flow]);
  const line = useRef<{ material: { dashOffset: number; opacity: number } } | null>(null);
  const level = useRef(0);
  useFrame((_, dt) => {
    const a = stageT(flow.from);
    const b = stageT(flow.to);
    const on = !isLive() && ((a > 0.75 && a < 1) || (a >= 1 && b < 0.25));
    level.current = approach(level.current, on ? 1 : 0, 3, dt);
    const m = line.current?.material;
    if (!m) return;
    m.dashOffset -= dt * 0.9 * level.current;
    m.opacity = 0.14 + 0.72 * level.current;
  });
  return <Line ref={line as never} points={points} color={flow.color} lineWidth={1.4} dashed dashSize={0.16} gapSize={0.1} transparent opacity={0.14} toneMapped={false} />;
}

export default function Flows() {
  return (
    <group>
      {FLOWS.map((f, i) => (
        <FlowLine key={i} flow={f} />
      ))}
    </group>
  );
}
