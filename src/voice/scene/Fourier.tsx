"use client";

import { Line } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import * as THREE from "three";
import type { Line2 } from "three-stdlib";
import { HOP, N_BINS, N_FFT, SAMPLE_RATE, hann } from "../audio/frontend";
import { getLab } from "../lab";
import { X } from "../story";
import { C, Caption, Label, MAT, ramp, stageT } from "./common";

/**
 * 04 · Short-time Fourier transform. 100 ms of the 16 kHz signal with the 25 ms Hann windows that cut it every
 * 10 ms; the window under the playhead lifted out and multiplied; and its 201-bin power spectrum, 40 Hz per bin.
 */

const WAVE = { x: -4.3, y: 1.3, w: 4.0, h: 0.42 };
const FRAME = { x: -4.3, y: 3.0, w: 4.0, h: 0.42 };
const SPEC = { x: 1.0, y: 0.9, w: 3.8, h: 2.2, depth: 1.2 };
const SHOW_MS = 100;
const DB_RANGE = 80;

/** the frame under the playhead: it walks through the content frames as the stage plays */
export function stftFrame(stage: "stft" | "mel") {
  const r = getLab()?.run;
  if (!r) return 0;
  const F = Math.max(1, Math.min(r.mel.powerFrames, r.mel.contentFrames));
  return Math.min(F - 1, Math.floor(Math.min(0.999, Math.max(0, stageT(stage))) * F));
}

export default function Fourier() {
  const win = useMemo(() => hann(), []);
  const wave = useRef<Line2>(null);
  const framed = useRef<Line2>(null);
  const arches = useRef<(Line2 | null)[]>([]);
  const bars = useRef<THREE.InstancedMesh>(null);
  const label = useRef<{ text: string } | null>(null);
  const geo = useMemo(() => new THREE.BoxGeometry(1, 1, 1), []);
  const mat = useMemo(() => new THREE.MeshStandardMaterial({ roughness: 0.45, metalness: 0.1, toneMapped: false }), []);
  const tmp = useMemo(() => ({ m: new THREE.Matrix4(), q: new THREE.Quaternion(), p: new THREE.Vector3(), s: new THREE.Vector3(), c: new THREE.Color() }), []);
  const bufs = useMemo(() => ({ wave: new Float32Array(321 * 3), framed: new Float32Array(N_FFT * 3), arch: new Float32Array(41 * 3) }), []);
  const last = useRef({ run: -1, f: -1 });
  // the windows whose centres fall inside the 100 ms shown
  const nArch = SHOW_MS / 10 - 1;

  useFrame(() => {
    const lab = getLab();
    const r = lab?.run;
    if (!r) return;
    const f = stftFrame("stft");
    if (last.current.run === r.id && last.current.f === f) return;
    last.current = { run: r.id, f };
    const x = r.clip.audio;
    const c = f * HOP; // the frame is centred on this sample
    const span = (SHOW_MS / 1000) * SAMPLE_RATE;
    let peak = 1e-6;
    for (let i = c - span / 2; i < c + span / 2; i++) if (i >= 0 && i < x.length) peak = Math.max(peak, Math.abs(x[i]));
    // 100 ms around the frame, every 5th sample
    for (let k = 0; k <= 320; k++) {
      const i = Math.round(c - span / 2 + k * (span / 320));
      bufs.wave.set([-WAVE.w / 2 + (k / 320) * WAVE.w, ((x[i] ?? 0) / peak) * WAVE.h, 0], k * 3);
    }
    wave.current?.geometry.setPositions(bufs.wave);
    // Hann windows every 10 ms, the playhead's in front
    for (let a = 0; a < nArch; a++) {
      const L = arches.current[a];
      if (!L) continue;
      const fc = f - Math.floor(nArch / 2) + a;
      const cx = -WAVE.w / 2 + ((fc * HOP - (c - span / 2)) / span) * WAVE.w;
      const half = ((N_FFT / 2) / span) * WAVE.w;
      for (let k = 0; k <= 40; k++) {
        const u = k / 40;
        bufs.arch.set([cx - half + 2 * half * u, -WAVE.h + (0.5 - 0.5 * Math.cos(2 * Math.PI * u)) * WAVE.h * 2.1, a === Math.floor(nArch / 2) ? 0.03 : 0.01], k * 3);
      }
      L.geometry.setPositions(bufs.arch);
      L.visible = fc >= 0;
    }
    // the frame times the window
    let fp = 1e-6;
    for (let i = 0; i < N_FFT; i++) fp = Math.max(fp, Math.abs((x[c - N_FFT / 2 + i] ?? 0) * win[i]));
    for (let i = 0; i < N_FFT; i++) bufs.framed.set([-FRAME.w / 2 + (i / (N_FFT - 1)) * FRAME.w, (((x[c - N_FFT / 2 + i] ?? 0) * win[i]) / fp) * FRAME.h, 0], i * 3);
    framed.current?.geometry.setPositions(bufs.framed);
    // |X[k]|² in dB, the frame's own peak at the top
    const m = bars.current;
    if (m && f < r.mel.powerFrames) {
      const P = r.mel.power.subarray(f * N_BINS, (f + 1) * N_BINS);
      let top = -Infinity;
      for (let k = 0; k < N_BINS; k++) top = Math.max(top, 10 * Math.log10(P[k] + 1e-12));
      const bw = SPEC.w / N_BINS;
      for (let k = 0; k < N_BINS; k++) {
        const db = 10 * Math.log10(P[k] + 1e-12);
        const v = Math.max(0, (db - (top - DB_RANGE)) / DB_RANGE);
        const h = Math.max(0.003, v * SPEC.h);
        tmp.p.set(-SPEC.w / 2 + (k + 0.5) * bw, h / 2, 0);
        tmp.s.set(bw * 0.7, h, 0.05);
        tmp.m.compose(tmp.p, tmp.q, tmp.s);
        m.setMatrixAt(k, tmp.m);
        m.setColorAt(k, ramp(0.15 + 0.85 * v, tmp.c));
      }
      m.instanceMatrix.needsUpdate = true;
      if (m.instanceColor) m.instanceColor.needsUpdate = true;
      if (label.current) label.current.text = `frame ${f} · t = ${((f * HOP) / SAMPLE_RATE).toFixed(2)} s · peak ${top.toFixed(1)} dB`;
    }
  });

  // placeholders; the frame loop writes the real positions
  const flat = useMemo(() => {
    const make = (n: number) => Array.from({ length: n }, (_, i) => [i * 0.001, 0, 0] as [number, number, number]);
    return { 321: make(321), 41: make(41), [N_FFT]: make(N_FFT) } as Record<number, [number, number, number][]>;
  }, []);

  return (
    <group position={[X.stft, 0, 0]}>
      <Caption
        n="04"
        title="Short-time Fourier transform"
        spec="X_t[k] = Σ_{n=0}^{399} x[160t + n − 200] · w[n] · e^{−2πi kn/400},  w[n] = ½ − ½ cos(2πn / 400),  power |X_t[k]|²"
        tag={{ text: "live · 25 ms windows every 10 ms", kind: "live" }}
        position={[-6.3, 4.4, 0]}
        width={10}
      />
      {/* the signal and its windows */}
      <group position={[WAVE.x, WAVE.y, 0]}>
        <mesh material={MAT.panel()} position={[0, 0.05, -0.05]}>
          <boxGeometry args={[WAVE.w + 0.3, WAVE.h * 2 + 0.6, 0.04]} />
        </mesh>
        <Line ref={wave} points={flat[321]} color={C.fg} lineWidth={1.3} toneMapped={false} />
        {Array.from({ length: nArch }, (_, a) => (
          <Line
            key={a}
            ref={(l) => void (arches.current[a] = l as Line2 | null)}
            points={flat[41]}
            color={a === Math.floor(nArch / 2) ? C.time : C.dim}
            lineWidth={a === Math.floor(nArch / 2) ? 1.8 : 0.8}
            transparent
            opacity={a === Math.floor(nArch / 2) ? 1 : 0.35}
            toneMapped={false}
          />
        ))}
        <Label fontSize={0.068} color={C.dim} position={[-WAVE.w / 2, WAVE.h + 0.3, 0]}>
          {"100 ms of x[n] at 16 kHz · Hann windows every 10 ms"}
        </Label>
      </group>
      {/* one window's worth, multiplied */}
      <group position={[FRAME.x, FRAME.y, 0.15]}>
        <mesh material={MAT.panel()} position={[0, 0, -0.05]}>
          <boxGeometry args={[FRAME.w + 0.3, FRAME.h * 2 + 0.36, 0.04]} />
        </mesh>
        <Line ref={framed} points={flat[N_FFT]} color={C.time} lineWidth={1.3} toneMapped={false} />
        <Label fontSize={0.068} color={C.time} position={[-FRAME.w / 2, FRAME.h + 0.1, 0]}>
          {"x[n] · w[n] · 400 samples (25 ms) → FFT"}
        </Label>
      </group>
      <Line points={[[FRAME.x + FRAME.w / 2 + 0.2, FRAME.y, 0.15], [SPEC.x - SPEC.w / 2 - 0.1, SPEC.y + SPEC.h * 0.75, 0]]} color={C.dim} lineWidth={1} dashed dashSize={0.08} gapSize={0.06} toneMapped={false} />

      {/* the power spectrum */}
      <group position={[SPEC.x, SPEC.y, 0]} rotation={[0, -0.18, 0]}>
        <mesh material={MAT.cell()} position={[0, -0.03, 0]}>
          <boxGeometry args={[SPEC.w + 0.24, 0.05, SPEC.depth]} />
        </mesh>
        <instancedMesh ref={bars} args={[geo, mat, N_BINS]} frustumCulled={false} />
        {[0, 2, 4, 6, 8].map((k) => (
          <Label key={k} fontSize={0.064} color={C.faint} anchorX="center" position={[-SPEC.w / 2 + (k / 8) * SPEC.w, -0.12, SPEC.depth / 2]}>
            {`${k} kHz`}
          </Label>
        ))}
        <Label ref={label as never} fontSize={0.07} color={C.fg} position={[-SPEC.w / 2, SPEC.h + 0.24, 0]}>
          {" "}
        </Label>
        <Label fontSize={0.062} color={C.dim} position={[-SPEC.w / 2, SPEC.h + 0.1, 0]}>
          {`|X[k]|² in dB, top ${DB_RANGE} dB · 201 bins, 40 Hz apart · harmonics of the voice are the ridges`}
        </Label>
      </group>
    </group>
  );
}
