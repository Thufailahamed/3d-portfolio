"use client";

import { useFrame } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import * as THREE from "three";
import { HOP, N_BINS, SAMPLE_RATE } from "../audio/frontend";
import { VAD } from "../audio/vad";
import { getLab } from "../lab";
import { X } from "../story";
import { useVoice } from "../store";
import { Bezel, C, Caption, Label, MAT, approach, isLive, put, stageT } from "./common";

/**
 * 02 · Voice detection. The detector's statistic for every 10 ms frame (mean log-likelihood ratio, nats per bin,
 * log scale), its two thresholds, the segments it keeps, and for the frame under the playhead the per-bin
 * a-posteriori SNR it is computed from. The lamp is the detector's state.
 */

const PANEL = { x: -0.9, y: 1.95, w: 6.2, h: 1.7 };
const COLS = 400;
const LIVE_FRAMES = 400;
const SNR = { x: 3.95, y: 1.15, w: 2.1, h: 1.3, bars: 66 };
const LLR_MAX = 1e4;

/** nats per bin → height, log scale from 0.01 */
const lift = (v: number) => Math.max(0, Math.log10(Math.max(v, 0.01) / 0.01) / Math.log10(LLR_MAX / 0.01));

function Lamp({ on }: { on: () => number }) {
  const face = useMemo(() => new THREE.MeshStandardMaterial({ color: "#0d0f0b", emissive: new THREE.Color(C.speech), emissiveIntensity: 0, roughness: 0.25, metalness: 0 }), []);
  const glow = useRef(0);
  const txt = useRef<{ color: THREE.Color | string; fillOpacity: number } | null>(null);
  useFrame((_, dt) => {
    glow.current = approach(glow.current, on(), 14, dt);
    put(face, "emissiveIntensity", 0.04 + glow.current * 1.6);
    if (txt.current) txt.current.fillOpacity = 0.35 + 0.65 * glow.current;
  });
  return (
    <group position={[PANEL.x, PANEL.y + PANEL.h / 2 + 0.72, 0]}>
      <mesh material={MAT.darkMetal()} position={[0, 0, -0.08]}>
        <boxGeometry args={[1.5, 0.46, 0.16]} />
      </mesh>
      <mesh material={face} position={[0, 0, 0.002]}>
        <planeGeometry args={[1.36, 0.34]} />
      </mesh>
      <Bezel w={1.36} h={0.34} t={0.02} d={0.03} />
      <Label ref={txt as never} sans medium fontSize={0.17} color="#0b0d06" anchorX="center" position={[0, -0.005, 0.01]} letterSpacing={0.24}>
        {"SPEECH"}
      </Label>
      <mesh material={MAT.darkMetal()} position={[0, -0.37, -0.08]}>
        <boxGeometry args={[0.04, 0.3, 0.04]} />
      </mesh>
    </group>
  );
}

export default function Detector() {
  const runId = useVoice((s) => s.run);
  useVoice((s) => s.mic);
  const run = getLab()?.run ?? null;
  const bars = useRef<THREE.InstancedMesh>(null);
  const snr = useRef<THREE.InstancedMesh>(null);
  const head = useRef<THREE.Mesh>(null);
  const noise = useRef<THREE.BufferGeometry>(null);
  const geo = useMemo(() => new THREE.BoxGeometry(1, 1, 1), []);
  const mat = useMemo(() => new THREE.MeshBasicMaterial({ toneMapped: false }), []);
  const snrMat = useMemo(() => new THREE.MeshStandardMaterial({ metalness: 0.2, roughness: 0.5 }), []);
  const tmp = useMemo(() => ({ m: new THREE.Matrix4(), q: new THREE.Quaternion(), p: new THREE.Vector3(), s: new THREE.Vector3(), c: new THREE.Color() }), []);
  const tone = useMemo(() => ({ s: new THREE.Color(C.speech), q: new THREE.Color("#5f636b"), cal: new THREE.Color("#2a2c30"), hot: new THREE.Color(C.fg), cool: new THREE.Color("#4b5a7a") }), []);
  const noisePos = useMemo(() => new Float32Array(SNR.bars * 3), []);

  // the kept segments and the part sent to Whisper, as bands under the plot
  const bands = useMemo(() => {
    if (!run) return { segs: [] as [number, number][], trim: [0, 1] as [number, number] };
    const frames = run.vad.frames;
    const total = run.clip.full.length;
    return {
      segs: run.vad.segments.map((s) => [s.start / frames, s.end / frames] as [number, number]),
      trim: [run.clip.trim[0] / total, run.clip.trim[1] / total] as [number, number],
    };
  }, [run, runId]); // eslint-disable-line react-hooks/exhaustive-deps

  const lampOn = () => {
    const lab = getLab();
    if (lab?.live) return lab.live.vad.open ? 1 : 0;
    const r = lab?.run;
    const t = stageT("vad");
    if (!r || t <= 0 || t >= 1) return 0;
    return r.vad.steps[Math.min(r.vad.frames - 1, Math.floor(t * r.vad.frames))]?.speech ? 1 : 0;
  };

  useFrame(() => {
    const lab = getLab();
    const m = bars.current;
    const sm = snr.current;
    if (!m || !sm || !lab) return;
    const live = lab.live;
    const r = lab.run;
    const cw = PANEL.w / COLS;
    let frame = -1;
    let gamma: ArrayLike<number> | null = null;
    let lambda: ArrayLike<number> | null = null;
    const steps = live ? live.steps : (r?.vad.steps ?? []);
    if (live) {
      const n = steps.length;
      for (let c = 0; c < COLS; c++) {
        const f = n - LIVE_FRAMES + c;
        const st = f >= 0 ? steps[f] : undefined;
        const h = st ? lift(st.llr) * PANEL.h : 0;
        tmp.p.set(-PANEL.w / 2 + (c + 0.5) * cw, h / 2 - PANEL.h / 2, 0);
        tmp.s.set(cw * 0.7, Math.max(0.004, h), 0.02);
        tmp.m.compose(tmp.p, tmp.q, tmp.s);
        m.setMatrixAt(c, tmp.m);
        m.setColorAt(c, !st || st.calibrating ? tone.cal : st.speech ? tone.s : tone.q);
      }
      frame = n - 1;
      gamma = live.vad.gamma;
      lambda = live.vad.noise;
      if (head.current) head.current.visible = false;
    } else if (r) {
      const F = r.vad.frames;
      const t = stageT("vad");
      for (let c = 0; c < COLS; c++) {
        const a = Math.floor((c / COLS) * F);
        const b = Math.max(a + 1, Math.floor(((c + 1) / COLS) * F));
        let mx = 0;
        let sp = false;
        let cal = false;
        for (let f = a; f < b && f < F; f++) {
          mx = Math.max(mx, steps[f].llr);
          sp ||= steps[f].speech;
          cal ||= steps[f].calibrating;
        }
        // the plot fills in as the playhead passes
        const shown = t >= 1 || (c + 0.5) / COLS <= t;
        const h = shown ? lift(mx) * PANEL.h : 0;
        tmp.p.set(-PANEL.w / 2 + (c + 0.5) * cw, h / 2 - PANEL.h / 2, 0);
        tmp.s.set(cw * 0.7, Math.max(0.004, h), 0.02);
        tmp.m.compose(tmp.p, tmp.q, tmp.s);
        m.setMatrixAt(c, tmp.m);
        m.setColorAt(c, cal ? tone.cal : sp ? tone.s : tone.q);
      }
      frame = Math.min(F - 1, Math.floor(Math.min(0.999, t) * F));
      if (frame >= 0 && t > 0) {
        gamma = r.vad.gammaDb.subarray(frame * N_BINS, (frame + 1) * N_BINS);
        lambda = r.vad.noiseDb.subarray(frame * N_BINS, (frame + 1) * N_BINS);
      }
      if (head.current) {
        head.current.visible = t > 0 && t < 1;
        head.current.position.x = -PANEL.w / 2 + t * PANEL.w;
      }
    }
    m.instanceMatrix.needsUpdate = true;
    if (m.instanceColor) m.instanceColor.needsUpdate = true;

    // this frame's γ_k in groups of 3 bins (dB), and the noise floor λ_N(k) as a line
    const bw = SNR.w / SNR.bars;
    let lo = Infinity;
    let hi = -Infinity;
    if (lambda) {
      for (let k = VAD.lo; k <= VAD.hi; k++) {
        const v = live ? 10 * Math.log10(Math.max(1e-12, lambda[k])) : lambda[k];
        lo = Math.min(lo, v);
        hi = Math.max(hi, v);
      }
    }
    for (let i = 0; i < SNR.bars; i++) {
      let g = 0;
      let nz = 0;
      for (let j = 0; j < 3; j++) {
        const k = VAD.lo + i * 3 + j;
        if (gamma) g = Math.max(g, live ? 10 * Math.log10(Math.max(1e-3, gamma[k])) : gamma[k]);
        if (lambda) nz += (live ? 10 * Math.log10(Math.max(1e-12, lambda[k])) : lambda[k]) / 3;
      }
      const h = (Math.min(40, Math.max(0, g)) / 40) * SNR.h;
      tmp.p.set(-SNR.w / 2 + (i + 0.5) * bw, h / 2, 0);
      tmp.s.set(bw * 0.72, Math.max(0.004, h), bw * 0.72);
      tmp.m.compose(tmp.p, tmp.q, tmp.s);
      sm.setMatrixAt(i, tmp.m);
      sm.setColorAt(i, tmp.c.copy(tone.cool).lerp(tone.hot, Math.min(1, g / 30)));
      const y = lambda && hi > lo ? ((nz - lo) / (hi - lo)) * SNR.h * 0.5 : 0;
      noisePos[i * 3] = -SNR.w / 2 + (i + 0.5) * bw;
      noisePos[i * 3 + 1] = y;
      noisePos[i * 3 + 2] = -0.2;
    }
    sm.instanceMatrix.needsUpdate = true;
    if (sm.instanceColor) sm.instanceColor.needsUpdate = true;
    const ng = noise.current;
    if (ng) {
      (ng.getAttribute("position") as THREE.BufferAttribute).needsUpdate = true;
      ng.setDrawRange(0, lambda ? SNR.bars : 0);
    }
    void frame;
  });

  const yOf = (v: number) => lift(v) * PANEL.h - PANEL.h / 2;
  const dur = run ? run.clip.full.length / SAMPLE_RATE : 0;

  return (
    <group position={[X.vad, 0, 0]}>
      <Caption
        n="02"
        title="Voice detection · is anyone speaking?"
        spec="Sohn's likelihood-ratio test on every 25 ms frame: log Λ_k = γ_k ξ_k / (1 + ξ_k) − log(1 + ξ_k), averaged over 120 Hz – 8 kHz"
        tag={{ text: "live · computed in this tab", kind: "live" }}
        position={[-4.3, 4.35, 0]}
        width={8.4}
      />
      <Lamp on={lampOn} />

      {/* the statistic over time */}
      <group position={[PANEL.x, PANEL.y, 0]}>
        <mesh material={MAT.panel()} position={[0, 0.02, -0.05]}>
          <boxGeometry args={[PANEL.w + 0.3, PANEL.h + 0.62, 0.04]} />
        </mesh>
        <instancedMesh ref={bars} args={[geo, mat, COLS]} frustumCulled={false} />
        {(
          [
            [VAD.on, `open  ›  ${VAD.on} nats / bin`, C.speech],
            [VAD.off, `close  ›  ${VAD.off} (after ${VAD.hangover * 10} ms below)`, C.dim],
          ] as const
        ).map(([v, t, col]) => (
          <group key={t} position={[0, yOf(v), 0.012]}>
            <mesh>
              <planeGeometry args={[PANEL.w, 0.006]} />
              <meshBasicMaterial color={col} toneMapped={false} transparent opacity={0.8} />
            </mesh>
            <Label fontSize={0.062} color={col} anchorX="right" position={[PANEL.w / 2 - 0.02, 0.05, 0]}>
              {t}
            </Label>
          </group>
        ))}
        {[0.01, 1, 100, 10000].map((v) => (
          <Label key={v} fontSize={0.058} color={C.faint} anchorX="right" position={[-PANEL.w / 2 - 0.04, yOf(v), 0]}>
            {v >= 1 ? v.toLocaleString("en-US") : String(v)}
          </Label>
        ))}
        <mesh ref={head} position={[0, 0, 0.015]}>
          <planeGeometry args={[0.01, PANEL.h + 0.1]} />
          <meshBasicMaterial color="#ffffff" toneMapped={false} />
        </mesh>
        {/* segments, padded, and what is sent on */}
        <group position={[0, -PANEL.h / 2 - 0.13, 0.01]}>
          {!isLive() &&
            bands.segs.map(([a, b], i) => (
              <mesh key={i} position={[-PANEL.w / 2 + ((a + b) / 2) * PANEL.w, 0, 0]}>
                <planeGeometry args={[(b - a) * PANEL.w, 0.06]} />
                <meshBasicMaterial color={C.speech} toneMapped={false} />
              </mesh>
            ))}
          {!isLive() && (
            <mesh position={[-PANEL.w / 2 + ((bands.trim[0] + bands.trim[1]) / 2) * PANEL.w, -0.085, 0]}>
              <planeGeometry args={[(bands.trim[1] - bands.trim[0]) * PANEL.w, 0.012]} />
              <meshBasicMaterial color={C.fg} toneMapped={false} />
            </mesh>
          )}
          <Label fontSize={0.06} color={C.dim} position={[-PANEL.w / 2, -0.17, 0]}>
            {isLive() ? "listening · the recording stops 0.5 s after you stop speaking" : run ? `segments ${run.vad.segments.map((s) => `${((s.start * HOP) / SAMPLE_RATE).toFixed(2)}–${((s.end * HOP) / SAMPLE_RATE).toFixed(2)} s`).join(", ") || "none"}` : ""}
          </Label>
          <Label fontSize={0.06} color={C.faint} anchorX="right" position={[PANEL.w / 2, -0.17, 0]}>
            {run && !isLive() ? `sent to Whisper: ${(run.clip.trim[0] / SAMPLE_RATE).toFixed(2)}–${(run.clip.trim[1] / SAMPLE_RATE).toFixed(2)} s of ${dur.toFixed(2)} s` : ""}
          </Label>
        </group>
        <Label fontSize={0.068} color={C.dim} position={[-PANEL.w / 2, PANEL.h / 2 + 0.16, 0]}>
          {"frame statistic  ·  mean log Λ_k, nats per bin (log scale)  ·  10 ms per frame"}
        </Label>
      </group>

      {/* this frame against the noise floor */}
      <group position={[SNR.x, SNR.y, 0.4]} rotation={[0, -0.42, 0]}>
        <mesh material={MAT.cell()} position={[0, -0.03, 0]}>
          <boxGeometry args={[SNR.w + 0.2, 0.05, 0.8]} />
        </mesh>
        <instancedMesh ref={snr} args={[geo, snrMat, SNR.bars]} frustumCulled={false} />
        <line>
          <bufferGeometry ref={noise}>
            <bufferAttribute attach="attributes-position" args={[noisePos, 3]} />
          </bufferGeometry>
          <lineBasicMaterial color={C.time} toneMapped={false} />
        </line>
        <Label fontSize={0.07} color={C.fg} position={[-SNR.w / 2, SNR.h + 0.25, 0]}>
          {"this frame: γ_k = |X_k|² / λ_N(k), 0 – 40 dB"}
        </Label>
        <Label fontSize={0.06} color={C.time} position={[-SNR.w / 2, SNR.h + 0.12, 0]}>
          {"— noise estimate λ_N(k), re-learned in silence"}
        </Label>
        <Label fontSize={0.058} color={C.faint} position={[-SNR.w / 2, -0.16, 0.42]}>
          {"120 Hz"}
        </Label>
        <Label fontSize={0.058} color={C.faint} anchorX="right" position={[SNR.w / 2, -0.16, 0.42]}>
          {"8 kHz"}
        </Label>
      </group>
    </group>
  );
}
