"use client";

import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { SAMPLE_RATE } from "../audio/frontend";
import { getLab, type Run } from "../lab";
import { STAGES, X, stageIndex } from "../story";
import { useVoice } from "../store";
import type { Tokenizer } from "../whisper/tokenizer";
import { C, Caption, Label, MAT, approach, axis30 } from "./common";
import { activationTexture } from "./heat";
import { Segments, commit, hideSegments, setSegment } from "./Segments";

/**
 * 07 · Text decoder. Tokens as the decoder emits them, each with the distribution it was picked from; under
 * them the encoder's 1500 audio features, and from the newest token beams to where its cross-attention
 * (the alignment heads, averaged) is looking.
 */

const STRIP = { x: -4.6, y: 0.62, w: 9.2, h: 0.42 };
const ROWS_Y = [3.05, 2.55, 2.05];
const ROW_W = 8.4;
const BEAMS = 18;
const HEAT = 240;
const CAND = { x: 3.15, y: 4.25 };

/** a token as a tile shows it: a space as a dot, specials by name */
export function tileText(tok: Tokenizer, id: number) {
  if (id === tok.sp.eot) return "<|endoftext|>";
  if (tok.isTimestamp(id)) return `<|${tok.seconds(id).toFixed(2)}|>`;
  const s = tok.decodeWithTimestamps([id]);
  if (s.includes("�")) return tok.label(id);
  return s.replace(/^ /, "·").replace(/\n/g, "⏎");
}

/** the attempt on show: the final one when decoding is done, else the one in progress */
export function shownAttempt(r: Run | null) {
  if (!r) return null;
  return r.final ?? r.attempts[r.attempts.length - 1] ?? null;
}

/** the step the decoder stage is showing */
export function decoderStep(n: number) {
  const s = useVoice.getState();
  const i = stageIndex("decoder");
  if (s.stage > i) return n - 1;
  if (s.stage < i) return -1;
  return Math.min(n - 1, Math.floor(s.p * n));
}

type Tile = { id: number; text: string; w: number; x: number; y: number; kind: "text" | "time" | "end" };

export default function Decoder() {
  const runId = useVoice((s) => s.run);
  const tokens = useVoice((s) => s.tokens);
  const enc = useVoice((s) => s.enc);
  const lab = getLab();
  const run = lab?.run ?? null;
  const att = shownAttempt(run);

  const tiles = useMemo<Tile[]>(() => {
    if (!att || !lab) return [];
    const out: Tile[] = [];
    let x = 0;
    let row = 0;
    for (const s of att.steps ?? []) {
      const text = tileText(lab.tok, s.token);
      const w = Math.max(0.36, text.length * 0.082 + 0.14);
      if (x + w > ROW_W && row < ROWS_Y.length - 1) {
        x = 0;
        row++;
      }
      out.push({ id: s.token, text, w, x: -ROW_W / 2 + x + w / 2, y: ROWS_Y[row], kind: s.token === lab.tok.sp.eot ? "end" : lab.tok.isTimestamp(s.token) ? "time" : "text" });
      x += w + 0.05;
    }
    return out;
  }, [att, tokens, runId, lab]); // eslint-disable-line react-hooks/exhaustive-deps

  const strip = useMemo(() => (run?.enc ? activationTexture(run.enc.xa, 1500, 384, Math.max(1, Math.floor(run.mel.contentFrames / 2)), 64) : null), [run, runId, enc]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => strip?.dispose(), [strip]);
  const ax = useMemo(() => axis30(run ? run.clip.audio.length / SAMPLE_RATE : 10, STRIP.w), [run, runId]); // eslint-disable-line react-hooks/exhaustive-deps

  const tileRefs = useRef<(THREE.Group | null)[]>([]);
  const glow = useRef<THREE.Mesh>(null);
  const beams = useRef<THREE.InstancedMesh>(null);
  const heat = useRef<THREE.InstancedMesh>(null);
  const cands = useRef<({ bar: THREE.Mesh | null; txt: { text: string; color: string | THREE.Color } | null; pct: { text: string } | null })[]>(Array.from({ length: 6 }, () => ({ bar: null, txt: null, pct: null })));
  const head = useRef<{ text: string } | null>(null);
  const geo = useMemo(() => new THREE.BoxGeometry(1, 1, 1), []);
  const heatMat = useMemo(() => new THREE.MeshBasicMaterial({ color: C.speech, toneMapped: false, transparent: true, opacity: 0.9 }), []);
  const tmp = useMemo(() => ({ m: new THREE.Matrix4(), q: new THREE.Quaternion(), p: new THREE.Vector3(), s: new THREE.Vector3() }), []);
  const hot = useMemo(() => new THREE.Color(C.speech), []);
  const level = useRef(0);
  const shown = useRef("");

  useFrame((_, dt) => {
    const l = getLab();
    const r = l?.run;
    const a = shownAttempt(r ?? null);
    const n = a?.steps?.length ?? 0;
    const k = decoderStep(n);
    const live = STAGES[useVoice.getState().stage]?.id === "decoder";
    tileRefs.current.forEach((g, i) => {
      if (!g) return;
      g.visible = i <= k;
      const target = i === k && live ? 1.12 : 1;
      g.scale.setScalar(approach(g.scale.x, target, 10, dt));
    });
    level.current = approach(level.current, live && k >= 0 ? 1 : 0, 4, dt);
    const step = k >= 0 && a ? a.steps[k] : null;
    const tile = k >= 0 ? tiles[k] : null;
    if (glow.current) {
      glow.current.visible = !!tile && level.current > 0.02;
      if (tile) glow.current.position.set(tile.x, tile.y, -0.03);
      if (tile) glow.current.scale.set(tile.w + 0.12, 1, 1);
    }
    // cross-attention: a heat bar over the audio, and beams to its peaks
    const hm = heat.current;
    if (hm) {
      const T = r ? Math.max(1, Math.floor(r.mel.contentFrames / 2)) : 1;
      let mx = 1e-9;
      if (step) for (let j = 0; j < T; j++) mx = Math.max(mx, step.attn[j]);
      for (let c = 0; c < HEAT; c++) {
        const j0 = Math.floor((c / HEAT) * T);
        const j1 = Math.max(j0 + 1, Math.floor(((c + 1) / HEAT) * T));
        let v = 0;
        if (step) for (let j = j0; j < j1; j++) v = Math.max(v, step.attn[j]);
        const h = Math.max(0.002, (v / mx) * 0.5 * level.current);
        const x0 = ax(j0 * 0.02);
        const x1 = ax(j1 * 0.02);
        tmp.p.set(STRIP.x + (x0 + x1) / 2, STRIP.y + STRIP.h / 2 + 0.02 + h / 2, 0.02);
        tmp.s.set(Math.max(0.004, (x1 - x0) * 0.8), h, 0.02);
        tmp.m.compose(tmp.p, tmp.q, tmp.s);
        hm.setMatrixAt(c, tmp.m);
      }
      hm.instanceMatrix.needsUpdate = true;
    }
    const key = `${r?.id}:${a?.temperature}:${k}`;
    if (key !== shown.current) {
      shown.current = key;
      const order = step ? Array.from(step.attn.keys()).sort((p, q) => step.attn[q] - step.attn[p]).slice(0, BEAMS) : [];
      const w0 = step ? step.attn[order[0]] || 1 : 1;
      const bm = beams.current;
      if (bm) {
        if (step && tile) order.forEach((j, i) => setSegment(bm, i, [tile.x, tile.y - 0.2, 0], [STRIP.x + ax(j * 0.02), STRIP.y + STRIP.h / 2, 0.02], 0.014, hot, 0.12 + 0.88 * (step.attn[j] / w0)));
        hideSegments(bm, step && tile ? order.length : 0);
        commit(bm);
      }
      cands.current.forEach((cd, i) => {
        const c = step?.top[i];
        if (cd.bar) {
          cd.bar.visible = !!c;
          if (c) {
            cd.bar.scale.x = Math.max(0.01, c[1]) * 2.2;
            cd.bar.position.x = (Math.max(0.01, c[1]) * 2.2) / 2;
            (cd.bar.material as THREE.MeshBasicMaterial).color.set(c[0] === step!.token ? (l!.tok.isTimestamp(c[0]) ? C.time : C.speech) : C.silence);
          }
        }
        if (cd.txt) cd.txt.text = c ? tileText(l!.tok, c[0]) : " ";
        if (cd.pct) cd.pct.text = c ? `${(c[1] * 100).toFixed(c[1] > 0.999 ? 1 : 1)}%` : " ";
      });
      if (head.current)
        head.current.text = step
          ? `step ${k + 1} · position ${step.pos} · chose ${tileText(l!.tok, step.token)} · log p = ${step.logprob.toFixed(3)}${a!.temperature > 0 ? ` · sampled at T = ${a!.temperature}` : " · greedy"}`
          : " ";
    }
  });

  return (
    <group position={[X.decoder, 0, 0]}>
      <Caption
        n="07"
        title="Text decoder · which token comes next?"
        spec="4 blocks: masked self-attention over the tokens so far · cross-attention over the 1500 audio features · MLP; logits = h · E^T over 51 864 tokens"
        tag={{ text: "live · real weights · Whisper's decoding rules", kind: "live" }}
        position={[-4.7, 4.95, 0]}
        width={7.4}
      />
      {/* the audio features */}
      <group position={[STRIP.x, STRIP.y, 0]}>
        <mesh material={MAT.panel()} position={[STRIP.w / 2, 0, -0.03]}>
          <boxGeometry args={[STRIP.w + 0.08, STRIP.h + 0.08, 0.03]} />
        </mesh>
        {strip && (
          <mesh position={[STRIP.w / 2, 0, 0]}>
            <planeGeometry args={[STRIP.w, STRIP.h]} />
            <meshBasicMaterial map={strip} toneMapped={false} />
          </mesh>
        )}
        <Label fontSize={0.064} color={C.dim} position={[0, -STRIP.h / 2 - 0.12, 0]}>
          {"encoder output [1500 × 384]: one column per 20 ms · the beams show where the alignment heads read"}
        </Label>
      </group>
      <instancedMesh ref={heat} args={[geo, heatMat, HEAT]} frustumCulled={false} />
      <Segments ref={beams} count={BEAMS} />

      {/* the tokens */}
      <mesh ref={glow} visible={false}>
        <boxGeometry args={[1, 0.5, 0.02]} />
        <meshBasicMaterial color={C.speech} transparent opacity={0.22} toneMapped={false} />
      </mesh>
      {tiles.map((t, i) => (
        <group key={`${runId}:${i}:${t.id}`} ref={(g) => void (tileRefs.current[i] = g)} position={[t.x, t.y, 0]} visible={false}>
          <mesh material={MAT.cell()} position={[0, 0, -0.02]}>
            <boxGeometry args={[t.w, 0.42, 0.03]} />
          </mesh>
          <Label fontSize={0.13} color={t.kind === "time" ? C.time : t.kind === "end" ? C.dim : C.fg} anchorX="center" position={[0, 0.055, 0.001]}>
            {t.text}
          </Label>
          <Label fontSize={0.066} color={t.kind === "time" ? C.time : C.text} anchorX="center" position={[0, -0.125, 0.001]}>
            {String(t.id)}
          </Label>
        </group>
      ))}
      <Label fontSize={0.07} color={C.faint} position={[-ROW_W / 2, ROWS_Y[0] + 0.36, 0]}>
        {"<|startoftranscript|> 50257  ›"}
      </Label>

      {/* what it chose from */}
      <group position={[CAND.x, CAND.y, 0.2]}>
        <Label ref={head as never} fontSize={0.085} color={C.fg} position={[-7.75, 0.0, 0]}>
          {" "}
        </Label>
        <Label fontSize={0.072} color={C.dim} position={[-1.0, 0.3, 0]}>
          {"top candidates · p after Whisper's filters"}
        </Label>
        {Array.from({ length: 6 }, (_, i) => (
          <group key={i} position={[0, 0.05 - i * 0.19, 0]}>
            <Label ref={(t) => void (cands.current[i].txt = t as never)} fontSize={0.095} color={C.fg} anchorX="right" position={[-0.08, 0, 0]}>
              {" "}
            </Label>
            <mesh ref={(m) => void (cands.current[i].bar = m)} position={[0, 0, 0]}>
              <boxGeometry args={[1, 0.12, 0.02]} />
              <meshBasicMaterial color={C.silence} toneMapped={false} />
            </mesh>
            <Label ref={(t) => void (cands.current[i].pct = t as never)} fontSize={0.085} color={C.dim} position={[2.32, 0, 0]}>
              {" "}
            </Label>
          </group>
        ))}
      </group>
    </group>
  );
}
