"use client";

import { Line } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import * as THREE from "three";
import { X } from "../story";
import { C, approach, stageT } from "./common";
import { VAE_IN, VAE_OUT } from "./Decoder";
import { RING } from "./Guidance";
import { LATENT_TOP } from "./Latent";
import { BUS_Y, BUS_Z, UNET_IN, UNET_OUT } from "./UNet";
import { PHASE, stepPhase, within } from "./useShownStep";

/**
 * The tensors moving between stations. Dashes run while a connection carries data; during the loop a bead
 * travels each hop in the order the step really executes (see PHASE).
 */

type V3 = [number, number, number];
type Flow = {
  pts: V3[];
  color: string;
  /** how busy the connection is right now, 0 … 1 */
  active: () => number;
  /** the share of a denoising step in which a bead runs along it */
  bead?: readonly [number, number];
};

const F = 0.025;

const FLOWS: Flow[] = [
  {
    pts: [[X.tokens + 3.55, 1.35, 0], [X.tokens + 5.4, 1.55, 0], [X.text - 3.8, 1.78, 0]],
    color: C.fg,
    active: () => (stageT("tokens") > 0.85 && stageT("text") < 0.4 ? 1 : 0),
  },
  {
    pts: [[X.text + 3.8, 3.05, -0.15], [X.text + 3.85, BUS_Y - 0.3, BUS_Z * 0.8], [X.text + 4.4, BUS_Y, BUS_Z], [X.unet + 5.0, BUS_Y, BUS_Z]],
    color: C.text,
    active: () => (stageT("text") > 0.8 && stageT("denoise") < 1 ? 1 : 0),
  },
  {
    pts: [[X.latent + 1.45, LATENT_TOP + 0.2, 0], [X.latent + 3.6, 5.3, 0], [UNET_IN[0] - 0.85, UNET_IN[1], 0]],
    color: C.fg,
    active: () => (stageT("noise") > 0.7 && stageT("denoise") < 1 ? 1 : 0),
    bead: PHASE.toUnet,
  },
  {
    pts: [[UNET_OUT[0] + 0.75, UNET_OUT[1], 0], [X.guide - 1.0, 5.15, 0], [X.guide - 1.32, 4.72, 0]],
    color: C.fg,
    active: () => (stageT("denoise") > 0 && stageT("denoise") < 1 ? 1 : 0),
    bead: PHASE.toGuide,
  },
  {
    // the loop: z_{t-1} goes back to be the next step's input
    pts: [[X.guide, RING[1] - 0.86, 0], [X.guide, F, 0.9], [X.guide - 1.2, F, 2.55], [X.latent + 2.2, F, 2.55], [X.latent + 1.45, F, 1.45]],
    color: C.accent,
    active: () => (stageT("denoise") > 0 && stageT("denoise") < 1 ? 1 : 0),
    bead: [PHASE.sched[1], 1],
  },
  {
    pts: [[X.latent + 1.45, F, 1.6], [X.latent + 2.4, F, 3.55], [VAE_IN[0] - 0.4, F, 3.55], [VAE_IN[0], F, 0.5]],
    color: C.pixel,
    active: () => (stageT("decode") > 0 && stageT("decode") < 1 ? 1 : 0),
  },
  {
    pts: [[VAE_OUT[0] + 0.12, VAE_OUT[1], 0], [X.out - 2.6, 2.5, 0], [X.out - 2.0, 2.95, 0]],
    color: C.pixel,
    active: () => (stageT("decode") > 0.7 ? 1 : 0),
  },
];

function FlowLine({ flow }: { flow: Flow }) {
  const curve = useMemo(() => new THREE.CatmullRomCurve3(flow.pts.map((p) => new THREE.Vector3(...p)), false, "centripetal", 0.5), [flow]);
  const points = useMemo(() => curve.getPoints(80), [curve]);
  const line = useRef<{ material: { dashOffset: number; opacity: number } } | null>(null);
  const bead = useRef<THREE.Mesh>(null);
  const level = useRef(0);

  useFrame((_, dt) => {
    level.current = approach(level.current, flow.active(), 3, dt);
    const m = line.current?.material;
    if (m) {
      m.dashOffset -= dt * 0.9 * level.current;
      m.opacity = 0.16 + 0.7 * level.current;
    }
    const b = bead.current;
    if (!b) return;
    const ph = stepPhase();
    const on = !!flow.bead && ph >= 0 && ph >= flow.bead[0] && ph <= flow.bead[1];
    b.visible = on;
    if (on) curve.getPointAt(within(ph, flow.bead!), b.position);
  });

  return (
    <>
      <Line ref={line as never} points={points} color={flow.color} lineWidth={1.4} dashed dashSize={0.16} gapSize={0.1} transparent opacity={0.2} toneMapped={false} />
      {flow.bead && (
        <mesh ref={bead} visible={false}>
          <sphereGeometry args={[0.06, 16, 12]} />
          <meshBasicMaterial color={flow.color} toneMapped={false} />
        </mesh>
      )}
    </>
  );
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
