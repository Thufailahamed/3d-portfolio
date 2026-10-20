"use client";

import { useFrame } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import * as THREE from "three";
import { getLab } from "../lab";
import { TOKENIZER } from "../sd15";
import { X } from "../story";
import { useLab } from "../store";
import { Bezel, C, Caption, Label, MAT, smooth, stageT } from "./common";

/**
 * Prompt → CLIP BPE pieces → ids → the 77-slot context, padded with <|endoftext|>.
 * Ids and pieces are the real tokenizer's output (scripts/diffusion/clip-tokenizer.mjs).
 */

const COLS = 11;
const ROWS = 7;
const CW = 0.58;
const CH = 0.205;
const GRID_Y = 2.05;
const PLATE_Y = 3.42;
const TILE_Y = 2.72;

const CHAR = 0.62;

type Slot = { id: number; kind: "bos" | "tok" | "eos" | "pad" };

export default function Tokenizer() {
  const cls = useLab((s) => s.cls);
  const run = useLab((s) => s.run);
  const lab = getLab();
  const cl = lab?.assets.manifest.classes[cls];
  const tokens = useMemo(() => cl?.tokens ?? [], [cl]);
  const prompt = cl?.prompt ?? "";

  const tiles = useMemo(() => {
    const fs = 0.1;
    const widths = tokens.map(([piece]) => Math.max(0.3, piece.replace("</w>", "").length * fs * CHAR + 0.14));
    const gap = 0.05;
    const total = widths.reduce((a, b) => a + b, 0) + gap * (widths.length - 1);
    const out: { piece: string; end: boolean; id: number; w: number; x: number }[] = [];
    let x = -total / 2;
    for (let i = 0; i < tokens.length; i++) {
      const [piece, id] = tokens[i];
      out.push({ piece: piece.replace("</w>", ""), end: piece.endsWith("</w>"), id, w: widths[i], x: x + widths[i] / 2 });
      x += widths[i] + gap;
    }
    return out;
  }, [tokens]);

  const slots = useMemo<Slot[]>(() => {
    const s: Slot[] = [{ id: TOKENIZER.bos, kind: "bos" }, ...tokens.map(([, id]) => ({ id, kind: "tok" as const })), { id: TOKENIZER.eos, kind: "eos" }];
    while (s.length < TOKENIZER.context) s.push({ id: TOKENIZER.pad, kind: "pad" });
    return s;
  }, [tokens]);

  const tileRefs = useRef<(THREE.Group | null)[]>([]);
  const cellRefs = useRef<(THREE.Group | null)[]>([]);
  const caret = useRef<THREE.Mesh>(null);
  const hint = useRef<THREE.Object3D>(null);

  useFrame((state) => {
    const tk = stageT("tokens");
    if (caret.current) caret.current.visible = tk < 0.05 && Math.floor(state.clock.elapsedTime * 1.8) % 2 === 0;
    if (hint.current) hint.current.visible = tk > 0.3;
    // pieces drop out of the prompt one after another, then their ids fill the context in order
    tiles.forEach((t, i) => {
      const g = tileRefs.current[i];
      if (!g) return;
      const a = smooth(0.02 + (i / tiles.length) * 0.3, 0.1 + (i / tiles.length) * 0.3, tk);
      g.position.y = TILE_Y + (1 - a) * 0.42;
      g.scale.setScalar(0.6 + 0.4 * a);
      g.visible = a > 0.001;
    });
    slots.forEach((s, i) => {
      const g = cellRefs.current[i];
      if (!g) return;
      const n = tokens.length + 2;
      const start = i < n ? 0.4 + (i / n) * 0.3 : 0.72 + ((i - n) / (TOKENIZER.context - n)) * 0.18;
      const a = smooth(start, start + 0.06, tk);
      g.visible = a > 0.01;
      g.scale.set(1, 0.2 + 0.8 * a, 1);
      const txt = g.children[1] as unknown as { fillOpacity: number } | undefined;
      if (txt) txt.fillOpacity = a;
    });
  });

  const cellColor = (k: Slot["kind"]) => (k === "tok" ? C.fg : k === "pad" ? C.faint : C.time);

  return (
    <group position={[X.tokens, 0, 0]} key={run}>
      <Caption n="01" title="Prompt & tokenizer" spec={`CLIP byte-level BPE · ${TOKENIZER.vocab.toLocaleString("en-US")} tokens · lower-cased · context ${TOKENIZER.context}`} tag={{ text: "live · real CLIP BPE", kind: "live" }} position={[-3.4, 4.45, 0]} />

      {/* the prompt */}
      <group position={[0, PLATE_Y, 0]}>
        <mesh material={MAT.panel()} position={[0, 0, -0.03]}>
          <boxGeometry args={[6.9, 0.62, 0.05]} />
        </mesh>
        <Bezel w={6.9} h={0.62} t={0.018} d={0.06} />
        <Label
          sans
          fontSize={0.165}
          color={C.fg}
          position={[-3.28, 0.0, 0.01]}
          maxWidth={6.5}
          onSync={(t: { textRenderInfo?: { blockBounds: number[] } }) => {
            // the caret sits where troika measured the text to end
            const end = t.textRenderInfo?.blockBounds[2];
            if (end !== undefined) caret.current?.position.setX(-3.28 + end + 0.04);
          }}
        >
          {prompt}
        </Label>
        <mesh ref={caret} position={[-3.28, 0, 0.01]}>
          <planeGeometry args={[0.012, 0.22]} />
          <meshBasicMaterial color={C.accent} toneMapped={false} />
        </mesh>
        <Label fontSize={0.075} color={C.faint} position={[-3.45, 0.43, 0]}>
          {"prompt  ·  plus the empty prompt for classifier-free guidance"}
        </Label>
      </group>

      {/* BPE pieces with their ids */}
      {tiles.map((t, i) => (
        <group key={i} ref={(g) => void (tileRefs.current[i] = g)} position={[t.x, TILE_Y, 0]}>
          <mesh material={MAT.cell()} position={[0, 0, -0.02]}>
            <boxGeometry args={[t.w, 0.36, 0.03]} />
          </mesh>
          <Label fontSize={0.1} color={C.fg} anchorX="center" position={[0, 0.06, 0.001]}>
            {t.piece}
          </Label>
          <Label fontSize={0.068} color={C.time} anchorX="center" position={[0, -0.1, 0.001]}>
            {String(t.id)}
          </Label>
          {t.end && (
            <mesh position={[0, -0.172, 0.001]}>
              <planeGeometry args={[t.w - 0.06, 0.008]} />
              <meshBasicMaterial color={C.dim} toneMapped={false} />
            </mesh>
          )}
        </group>
      ))}
      <Label ref={hint} fontSize={0.07} color={C.faint} anchorX="center" position={[0, 2.38, 0]}>
        {"underline = end of word (</w>)"}
      </Label>

      {/* the 77-slot context */}
      <group position={[-((COLS - 1) * CW) / 2, GRID_Y, 0]}>
        {slots.map((s, i) => {
          const c = i % COLS;
          const r = Math.floor(i / COLS);
          return (
            <group key={i} ref={(g) => void (cellRefs.current[i] = g)} position={[c * CW, -r * CH - 0.12, 0]}>
              <mesh material={MAT.cell()} position={[0, 0, -0.015]}>
                <boxGeometry args={[CW - 0.04, CH - 0.035, 0.02]} />
              </mesh>
              <Label fontSize={0.074} color={cellColor(s.kind)} anchorX="center" position={[0, 0, 0.001]}>
                {String(s.id)}
              </Label>
            </group>
          );
        })}
      </group>
      <Label fontSize={0.075} color={C.faint} position={[-3.45, GRID_Y - ROWS * CH - 0.12, 0]} maxWidth={7}>
        {`input_ids [77]: <|startoftext|> ${TOKENIZER.bos}, ${tokens.length} prompt tokens, <|endoftext|> ${TOKENIZER.eos}, then ${TOKENIZER.context - tokens.length - 2} × pad (${TOKENIZER.pad})`}
      </Label>
      <Label fontSize={0.075} color={C.faint} position={[-3.45, GRID_Y - ROWS * CH - 0.3, 0]} maxWidth={7}>
        {`empty prompt  ""  ›  ${TOKENIZER.bos}, ${TOKENIZER.eos}, ${TOKENIZER.pad} × 75`}
      </Label>
    </group>
  );
}
