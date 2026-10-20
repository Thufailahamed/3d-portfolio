"use client";

import { Text } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { SAMPLE_RATE } from "../audio/frontend";
import { getLab } from "../lab";
import { X } from "../story";
import { useVoice } from "../store";
import { C, Caption, FONT_QUOTE, Label, MAT, approach, stageT } from "./common";
import { melTexture } from "./heat";

/**
 * 08 · Transcript. The text, and every word at the time DTW put it, over the spectrogram it was heard in;
 * colour is the word's probability under the decoder. While the clip plays, the word being said lights up.
 */

const LINE = { x: -4.4, y: 1.15, w: 8.8, h: 0.5 };

/** probability → colour: coral when unsure, through off-white, to tungsten when certain */
function confidence(p: number, out = new THREE.Color()) {
  const lo = new THREE.Color(C.unsure);
  const mid = new THREE.Color(C.fg);
  const hi = new THREE.Color(C.speech);
  return p < 0.75 ? out.copy(lo).lerp(mid, Math.max(0, (p - 0.3) / 0.45)) : out.copy(mid).lerp(hi, (p - 0.75) / 0.25);
}

export default function Transcript() {
  const runId = useVoice((s) => s.run);
  const align = useVoice((s) => s.align);
  const dec = useVoice((s) => s.dec);
  const lab = getLab();
  const run = lab?.run ?? null;
  const d = run ? run.clip.audio.length / SAMPLE_RATE : 1;
  const words = useMemo(() => (run?.align?.words ?? []).map((w, i) => ({ ...w, lane: i % 2 })), [run, runId, align]); // eslint-disable-line react-hooks/exhaustive-deps
  const tex = useMemo(() => (run ? melTexture(run.mel.mel, run.mel.contentFrames, run.mel.maxLog, 1) : null), [run, runId]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => tex?.dispose(), [tex]);
  const x = (t: number) => (Math.min(d, Math.max(0, t)) / d) * LINE.w;

  const refs = useRef<(THREE.Group | null)[]>([]);
  const bars = useRef<(THREE.Mesh | null)[]>([]);
  const head = useRef<THREE.Mesh>(null);
  const tmp = useMemo(() => new THREE.Color(), []);

  useFrame((_, dt) => {
    const t = getLab()?.playTime() ?? -1;
    const reveal = stageT("text");
    if (head.current) {
      head.current.visible = t >= 0;
      head.current.position.x = LINE.x + x(t);
    }
    words.forEach((w, i) => {
      const g = refs.current[i];
      if (!g) return;
      // words arrive in order through the stage, then all stay
      const shown = reveal >= 1 || i / Math.max(1, words.length) <= reveal * 1.6;
      const now = t >= w.start && t < w.end;
      g.visible = shown;
      const s = approach(g.scale.x, now ? 1.25 : 1, 14, dt);
      g.scale.setScalar(s);
      const b = bars.current[i];
      if (b) (b.material as THREE.MeshBasicMaterial).color.copy(now ? tmp.set(C.speech) : confidence(w.probability, tmp));
    });
  });

  const final = run?.final;
  const text = final?.text ?? "";
  const silent = dec === "done" && run && !run.segments.length;
  const v = run?.verdicts[run.verdicts.length - 1];

  return (
    <group position={[X.text, 0, 0]}>
      <Caption
        n="08"
        title="Transcript · when was each word said?"
        spec="word times from dynamic time warping over the cross-attention of 8 alignment heads (whisper/timing.py), after a median filter of width 7"
        tag={{ text: "live · word times by DTW", kind: "live" }}
        position={[-4.5, 4.55, 0]}
        width={8.8}
      />
      {/* the text */}
      <group position={[0, 3.25, 0]}>
        <mesh material={MAT.panel()} position={[0, 0, -0.05]}>
          <boxGeometry args={[9.1, 1.05, 0.04]} />
        </mesh>
        {/* the words, set as a printed quotation */}
        <Text font={FONT_QUOTE} fontSize={0.27} color={C.fg} anchorX="center" anchorY="middle" maxWidth={8.4} textAlign="center" lineHeight={1.18} material-toneMapped={false}>
          {silent ? "[ no speech: Whisper's own detector skipped this window ]" : text ? `“${text}”` : dec === "running" ? "decoding…" : " "}
        </Text>
        <Label fontSize={0.064} color={C.dim} anchorX="center" position={[0, -0.62, 0]}>
          {final && v
            ? `avg log p ${final.avgLogprob.toFixed(3)} · p(<|nospeech|>) ${final.noSpeechProb.toFixed(3)} · compression ${v.compression.toFixed(2)} · T = ${final.temperature}${run!.attempts.length > 1 ? ` after ${run!.attempts.length - 1} retries` : ""} · ${final.steps.length} tokens`
            : " "}
        </Label>
      </group>

      {/* the words in time */}
      <group position={[LINE.x, LINE.y, 0]}>
        <mesh material={MAT.panel()} position={[LINE.w / 2, 0.25, -0.05]}>
          <boxGeometry args={[LINE.w + 0.3, LINE.h + 1.05, 0.04]} />
        </mesh>
        {tex && (
          <mesh position={[LINE.w / 2, 0, 0]}>
            <planeGeometry args={[LINE.w, LINE.h]} />
            <meshBasicMaterial map={tex} toneMapped={false} />
          </mesh>
        )}
        {words.map((w, i) => {
          const a = x(w.start);
          const b = Math.max(a + 0.02, x(w.end));
          const y = LINE.h / 2 + 0.12 + w.lane * 0.26;
          return (
            <group key={`${runId}:${i}`} ref={(g) => void (refs.current[i] = g)} position={[(a + b) / 2, y, 0.01]}>
              <mesh ref={(m) => void (bars.current[i] = m)} position={[0, -0.07, 0]}>
                <planeGeometry args={[b - a - 0.01, 0.03]} />
                <meshBasicMaterial color={C.fg} toneMapped={false} />
              </mesh>
              <Label sans fontSize={0.1} color={C.fg} anchorX="center" position={[0, 0.03, 0]}>
                {w.word.trim()}
              </Label>
            </group>
          );
        })}
        {run?.segments.map((s, i) => (
          <group key={`s${i}`} position={[x(s.start), -LINE.h / 2 - 0.1, 0.01]}>
            <mesh position={[(x(s.end) - x(s.start)) / 2, 0, 0]}>
              <planeGeometry args={[Math.max(0.01, x(s.end) - x(s.start) - 0.02), 0.012]} />
              <meshBasicMaterial color={C.time} toneMapped={false} />
            </mesh>
            <Label fontSize={0.058} color={C.time} position={[0, -0.08, 0]}>
              {`<|${s.start.toFixed(2)}|> … <|${s.end.toFixed(2)}|>`}
            </Label>
          </group>
        ))}
        <mesh ref={head} position={[0, 0.25, 0.02]} visible={false}>
          <planeGeometry args={[0.012, LINE.h + 0.9]} />
          <meshBasicMaterial color="#ffffff" toneMapped={false} />
        </mesh>
        <Label fontSize={0.058} color={C.faint} position={[0, -LINE.h / 2 - 0.3, 0]}>
          {"0 s"}
        </Label>
        <Label fontSize={0.058} color={C.faint} anchorX="right" position={[LINE.w, -LINE.h / 2 - 0.3, 0]}>
          {`${d.toFixed(2)} s`}
        </Label>
      </group>
    </group>
  );
}
