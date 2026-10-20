"use client";

import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { SAMPLE_RATE } from "../audio/frontend";
import { getLab } from "../lab";
import { X } from "../story";
import { useVoice } from "../store";
import { C, Caption, Label, MAT, axis30, stageT } from "./common";
import { activationTexture, melTexture } from "./heat";
import { Segments, commit, hideSegments, setSegment } from "./Segments";

/**
 * 06 · Audio encoder. The real tensors, bottom to top: the log-mel input, the convolutional stem with its
 * sinusoidal positions, the residual stream after each of the four transformer blocks, and ln_post's output.
 * Time is aligned across all of them; each row of a panel is two of the 384 channels. Arcs on top are one
 * head's self-attention from the frame under the marker, read back from the GPU.
 */

const W = 5.2;
const PH = 0.5;
const GAP = 0.13;
const X0 = -2.1;
const Y0 = 0.45;
const ARCS = 12;
const ARC_STEPS = 18;

type Panel = { key: string; name: string; spec: string; tex: THREE.Texture | null };

export default function Encoder() {
  const runId = useVoice((s) => s.run);
  const enc = useVoice((s) => s.enc);
  const run = getLab()?.run ?? null;
  const dims = getLab()?.manifest.dims;

  const panels = useMemo<Panel[]>(() => {
    const out: Panel[] = [];
    const tokens = run ? Math.max(1, Math.floor(run.mel.contentFrames / 2)) : 1;
    const D = dims?.n_audio_state ?? 384;
    const T = dims?.n_audio_ctx ?? 1500;
    out.push({ key: "mel", name: "input", spec: "log-mel [80 × 3000]", tex: run ? melTexture(run.mel.mel, run.mel.contentFrames, run.mel.maxLog) : null });
    const e = run?.enc;
    out.push({ key: "stem", name: "conv stem", spec: "conv1 k3 · GELU · conv2 k3 s2 · GELU · + sinusoids → [1500 × 384]", tex: e ? activationTexture(e.stem, T, D, tokens) : null });
    for (let l = 0; l < (dims?.n_audio_layer ?? 4); l++)
      out.push({ key: `b${l}`, name: `block ${l + 1}`, spec: "x += MHA(LN x), 6 heads × 64 · x += MLP(LN x), 384 → 1536 → 384", tex: e ? activationTexture(e.blocks[l], T, D, tokens) : null });
    out.push({ key: "xa", name: "ln_post", spec: "audio features [1500 × 384], 20 ms each · the decoder's memory", tex: e ? activationTexture(e.xa, T, D, tokens) : null });
    return out;
  }, [run, runId, enc, dims]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => panels.forEach((p) => p.tex?.dispose()), [panels]);

  const ax = useMemo(() => axis30(run ? run.clip.audio.length / SAMPLE_RATE : 10, W), [run, runId]); // eslint-disable-line react-hooks/exhaustive-deps
  const top = Y0 + panels.length * (PH + GAP);
  const marker = useRef<THREE.Mesh>(null);
  const arcs = useRef<THREE.InstancedMesh>(null);
  const label = useRef<{ text: string } | null>(null);
  const timeHue = useMemo(() => new THREE.Color(C.time), []);
  const last = useRef("");

  useFrame(() => {
    const r = getLab()?.run;
    const e = r?.enc;
    const t = stageT("encoder");
    const on = !!e && t > 0 && t < 1 && e.probes.length > 0;
    if (marker.current) marker.current.visible = on;
    const am = arcs.current;
    if (am) am.visible = on;
    if (!on || !e || !am) return;
    // walk the heads of the last block, and the probed frames within each
    const L = e.probes.length - 1;
    const H = e.probes[L].length;
    const u = Math.min(0.9999, t) * H;
    const head = Math.floor(u);
    const qi = Math.min(e.probeFrames.length - 1, Math.floor((u - head) * e.probeFrames.length));
    const key = `${r!.id}:${head}:${qi}`;
    if (key === last.current) return;
    last.current = key;
    const q = e.probeFrames[qi];
    const row = e.probes[L][head].subarray(qi * 1500, (qi + 1) * 1500);
    const xq = X0 + ax(q * 0.02);
    if (marker.current) marker.current.position.x = xq;
    // the strongest keys
    const order = Array.from(row.keys()).sort((a, b) => row[b] - row[a]).slice(0, ARCS);
    const w0 = row[order[0]] || 1;
    // each arc a parabola from the query up and over to the key, as short segments
    order.forEach((k, i) => {
      const xk = X0 + ax(k * 0.02);
      const h = 0.3 + Math.min(1.2, Math.abs(xk - xq) * 0.35);
      const w = 0.15 + 0.85 * (row[k] / w0);
      const at = (u: number): [number, number, number] => [xq + (xk - xq) * u, top + 4 * h * u * (1 - u), 0.02];
      for (let s = 0; s < ARC_STEPS; s++) setSegment(am, i * ARC_STEPS + s, at(s / ARC_STEPS), at((s + 1) / ARC_STEPS), 0.016, timeHue, w);
    });
    hideSegments(am, order.length * ARC_STEPS);
    commit(am);
    if (label.current) {
      const sum = order.reduce((s, k) => s + row[k], 0);
      label.current.text = `block ${L + 1}, head ${head + 1} of ${H}: from ${(q * 0.02).toFixed(2)} s, the ${ARCS} strongest keys hold ${(sum * 100).toFixed(0)}% of the attention`;
    }
  });

  return (
    <group position={[X.encoder, 0, 0]}>
      <Caption
        n="06"
        title="Audio encoder · what the sound means"
        spec="2 convolutions (stride 2: 3000 frames → 1500 tokens) · sinusoidal positions · 4 pre-LN transformer blocks · d = 384, 6 heads · 7.6 M parameters"
        tag={{ text: "live · OpenAI's tiny.en weights on your GPU", kind: "live" }}
        position={[X0 - 0.2, top + 1.75, 0]}
        width={8}
      />
      {panels.map((p, i) => {
        const y = Y0 + i * (PH + GAP) + PH / 2;
        return (
          <group key={p.key} position={[X0, y, -i * 0.02]}>
            <mesh material={MAT.panel()} position={[W / 2, 0, -0.03]}>
              <boxGeometry args={[W + 0.06, PH + 0.06, 0.03]} />
            </mesh>
            {p.tex ? (
              <mesh position={[W / 2, 0, 0]}>
                <planeGeometry args={[W, PH]} />
                <meshBasicMaterial map={p.tex} toneMapped={false} />
              </mesh>
            ) : (
              <Label fontSize={0.07} color={C.faint} position={[0.12, 0, 0.01]}>
                {enc === "running" ? "computing on the GPU…" : "waiting for the weights"}
              </Label>
            )}
            <Label fontSize={0.095} color={i === 0 || i === panels.length - 1 ? C.fg : C.dim} anchorX="right" position={[-0.1, 0.09, 0]} medium>
              {p.name}
            </Label>
            <Label fontSize={0.06} color={C.faint} anchorX="right" position={[-0.1, -0.07, 0]} maxWidth={2.0} textAlign="right">
              {p.spec}
            </Label>
          </group>
        );
      })}
      {/* the padding boundary, and the probed frame */}
      <mesh position={[X0 + ax(run ? run.clip.audio.length / SAMPLE_RATE : 10), (Y0 + top) / 2, 0.01]}>
        <planeGeometry args={[0.006, top - Y0]} />
        <meshBasicMaterial color={C.dim} transparent opacity={0.5} toneMapped={false} />
      </mesh>
      <Label fontSize={0.058} color={C.faint} position={[X0 + ax(run ? run.clip.audio.length / SAMPLE_RATE : 10) + 0.05, Y0 - 0.12, 0]}>
        {"padding ›"}
      </Label>
      <mesh ref={marker} position={[0, (Y0 + top) / 2, 0.02]} visible={false}>
        <planeGeometry args={[0.012, top - Y0 + 0.1]} />
        <meshBasicMaterial color={C.time} toneMapped={false} />
      </mesh>
      <Segments ref={arcs} count={ARCS * ARC_STEPS} />
      <Label ref={label as never} fontSize={0.075} color={C.time} position={[X0, top + 1.3, 0]}>
        {" "}
      </Label>
      <Label fontSize={0.06} color={C.faint} position={[X0, Y0 - 0.12, 0]}>
        {"0 s"}
      </Label>
      <Label fontSize={0.06} color={C.faint} anchorX="right" position={[X0 + W, Y0 - 0.12, 0]}>
        {"30 s"}
      </Label>
    </group>
  );
}
