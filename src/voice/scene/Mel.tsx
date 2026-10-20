"use client";

import { useFrame } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import * as THREE from "three";
import { HOP, N_BINS, N_FRAMES, N_MELS, SAMPLE_RATE, melFilters } from "../audio/frontend";
import { getLab } from "../lab";
import { X } from "../story";
import { useVoice } from "../store";
import { C, Caption, Label, MAT, axis30, ramp, stageT } from "./common";
import { stftFrame } from "./Fourier";

/**
 * 05 · Log-mel spectrogram. The 80 triangular filters over the linear spectrum, the frame's 80 band energies
 * after log10, and the whole [80 × 3000] input as a terrain: time left to right, mel band front to back,
 * height and colour the normalised log energy. Padding frames sit at the floor value, max − 8.
 */

const BANK = { x: -2.6, y: 2.35, w: 4.4, h: 1.1 };
const BANDS = { x: 2.55, y: 2.35, w: 3.6, h: 1.1 };
const TERRAIN = { x: -4.6, w: 9.2, d: 2.3, z: 1.75, h: 0.95 };
const CONTENT_COLS = 420;
const PAD_COLS = 24;

export default function Mel() {
  const runId = useVoice((s) => s.run);
  const run = getLab()?.run ?? null;
  const { weights, edges } = useMemo(() => melFilters(), []);

  // the filterbank, each triangle scaled to the tallest one
  const bank = useMemo(() => {
    let peak = 0;
    for (const v of weights) peak = Math.max(peak, v);
    const segs: number[] = [];
    for (let m = 0; m < N_MELS; m++) {
      const lo = edges[m] / 8000;
      const mid = edges[m + 1] / 8000;
      const hi = edges[m + 2] / 8000;
      let top = 0;
      for (let k = 0; k < N_BINS; k++) top = Math.max(top, weights[m * N_BINS + k]);
      const y = (top / peak) * BANK.h;
      const x = (u: number) => -BANK.w / 2 + u * BANK.w;
      segs.push(x(lo), 0, 0, x(mid), y, 0, x(mid), y, 0, x(hi), 0, 0);
    }
    return new Float32Array(segs);
  }, [weights, edges]);

  const spec = useRef<THREE.InstancedMesh>(null);
  const bands = useRef<THREE.InstancedMesh>(null);
  const sweep = useRef<THREE.Mesh>(null);
  const label = useRef<{ text: string } | null>(null);
  const geo = useMemo(() => new THREE.BoxGeometry(1, 1, 1), []);
  const specMat = useMemo(() => new THREE.MeshBasicMaterial({ color: "#4c5566", transparent: true, opacity: 0.55, toneMapped: false }), []);
  const bandMat = useMemo(() => new THREE.MeshStandardMaterial({ roughness: 0.45, metalness: 0.1, toneMapped: false }), []);
  const tmp = useMemo(() => ({ m: new THREE.Matrix4(), q: new THREE.Quaternion(), p: new THREE.Vector3(), s: new THREE.Vector3(), c: new THREE.Color() }), []);
  const last = useRef({ run: -1, f: -1 });

  // the terrain: columns spaced evenly over the clip's frames, a few over the padding
  const terrain = useMemo(() => {
    if (!run) return null;
    const { mel, contentFrames, maxLog } = run.mel;
    const floor = (maxLog - 8 + 4) / 4;
    const d = run.clip.audio.length / SAMPLE_RATE;
    const ax = axis30(d, TERRAIN.w);
    const cols = CONTENT_COLS + PAD_COLS;
    const frameAt = (c: number) => (c < CONTENT_COLS ? (c / (CONTENT_COLS - 1)) * Math.max(1, contentFrames - 1) : contentFrames + ((c - CONTENT_COLS + 1) / PAD_COLS) * (N_FRAMES - 1 - contentFrames));
    const g = new THREE.BufferGeometry();
    const pos = new Float32Array(cols * N_MELS * 3);
    const col = new Float32Array(cols * N_MELS * 3);
    const c3 = new THREE.Color();
    for (let c = 0; c < cols; c++) {
      const fr = frameAt(c);
      const f0 = Math.floor(fr);
      const x = ax((fr * HOP) / SAMPLE_RATE);
      for (let m = 0; m < N_MELS; m++) {
        // the max over the frames this column stands for, so short events survive
        const f1 = c < CONTENT_COLS - 1 ? Math.max(f0 + 1, Math.floor(frameAt(c + 1))) : f0 + 1;
        let v = -Infinity;
        for (let f = f0; f < Math.min(f1, N_FRAMES); f++) v = Math.max(v, mel[m * N_FRAMES + f]);
        const u = Math.min(1, Math.max(0, (v - floor) / 2));
        const i = c * N_MELS + m;
        // low bands at the front
        pos.set([x, u * TERRAIN.h, (1 - m / (N_MELS - 1)) * TERRAIN.d], i * 3);
        ramp(0.06 + 0.94 * u, c3);
        col.set([c3.r, c3.g, c3.b], i * 3);
      }
    }
    const idx: number[] = [];
    for (let c = 0; c < cols - 1; c++)
      for (let m = 0; m < N_MELS - 1; m++) {
        const a = c * N_MELS + m;
        const b = (c + 1) * N_MELS + m;
        idx.push(a, b, a + 1, b, b + 1, a + 1);
      }
    g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    g.setAttribute("color", new THREE.BufferAttribute(col, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    return { g, ax, d };
  }, [run, runId]); // eslint-disable-line react-hooks/exhaustive-deps

  const terrainMat = useMemo(() => new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55, metalness: 0.05, emissive: new THREE.Color("#ffffff"), emissiveIntensity: 0.0, side: THREE.DoubleSide, flatShading: false }), []);

  useFrame(() => {
    const r = getLab()?.run;
    if (!r) return;
    const t = stageT("mel");
    const f = stftFrame("mel");
    if (sweep.current && terrain) {
      sweep.current.visible = t > 0 && t < 1;
      sweep.current.position.x = TERRAIN.x + terrain.ax((f * HOP) / SAMPLE_RATE);
    }
    if (last.current.run === r.id && last.current.f === f) return;
    last.current = { run: r.id, f };
    if (f >= r.mel.powerFrames) return;
    const P = r.mel.power.subarray(f * N_BINS, (f + 1) * N_BINS);
    // the linear spectrum under the filters (dB, top 80)
    const sm = spec.current;
    let top = -Infinity;
    for (let k = 0; k < N_BINS; k++) top = Math.max(top, 10 * Math.log10(P[k] + 1e-12));
    if (sm) {
      const bw = BANK.w / N_BINS;
      for (let k = 0; k < N_BINS; k++) {
        const v = Math.max(0, (10 * Math.log10(P[k] + 1e-12) - (top - 80)) / 80);
        const h = Math.max(0.002, v * BANK.h * 0.9);
        tmp.p.set(-BANK.w / 2 + (k + 0.5) * bw, h / 2, -0.01);
        tmp.s.set(bw * 0.8, h, 0.005);
        tmp.m.compose(tmp.p, tmp.q, tmp.s);
        sm.setMatrixAt(k, tmp.m);
      }
      sm.instanceMatrix.needsUpdate = true;
    }
    // the frame's 80 normalised log-mel values, read from the spectrogram the encoder sees
    const bm = bands.current;
    if (bm) {
      const floor = (r.mel.maxLog - 8 + 4) / 4;
      const bw = BANDS.w / N_MELS;
      for (let m = 0; m < N_MELS; m++) {
        const v = r.mel.mel[m * N_FRAMES + f];
        const u = Math.min(1, Math.max(0, (v - floor) / 2));
        const h = Math.max(0.003, u * BANDS.h);
        tmp.p.set(-BANDS.w / 2 + (m + 0.5) * bw, h / 2, 0);
        tmp.s.set(bw * 0.72, h, 0.06);
        tmp.m.compose(tmp.p, tmp.q, tmp.s);
        bm.setMatrixAt(m, tmp.m);
        bm.setColorAt(m, ramp(0.1 + 0.9 * u, tmp.c));
      }
      bm.instanceMatrix.needsUpdate = true;
      if (bm.instanceColor) bm.instanceColor.needsUpdate = true;
    }
    if (label.current) label.current.text = `frame ${f} (${((f * HOP) / SAMPLE_RATE).toFixed(2)} s) · 80 values in [${((r.mel.maxLog - 4) / 4).toFixed(2)}, ${((r.mel.maxLog + 4) / 4).toFixed(2)}]`;
  });

  const r = run;
  return (
    <group position={[X.mel, 0, 0]}>
      <Caption
        n="05"
        title="Log-mel spectrogram · what an ear would keep"
        spec="mel_m = Σ_k M[m, k] · |X[k]|²  ·  L = log10(max(mel, 1e-10))  ·  L ← max(L, max L − 8)  ·  (L + 4) / 4"
        tag={{ text: "live · Whisper's exact front end", kind: "live" }}
        position={[-4.8, 4.45, 0]}
        width={9.6}
      />
      {/* the filters over the linear spectrum */}
      <group position={[BANK.x, BANK.y, 0]}>
        <mesh material={MAT.panel()} position={[0, BANK.h / 2 - 0.02, -0.05]}>
          <boxGeometry args={[BANK.w + 0.3, BANK.h + 0.62, 0.04]} />
        </mesh>
        <instancedMesh ref={spec} args={[geo, specMat, N_BINS]} frustumCulled={false} />
        <lineSegments>
          <bufferGeometry>
            <bufferAttribute attach="attributes-position" args={[bank, 3]} />
          </bufferGeometry>
          <lineBasicMaterial color={C.time} transparent opacity={0.9} toneMapped={false} />
        </lineSegments>
        {[0, 1, 2, 4, 6, 8].map((k) => (
          <Label key={k} fontSize={0.06} color={C.faint} anchorX="center" position={[-BANK.w / 2 + (k / 8) * BANK.w, -0.1, 0]}>
            {`${k} kHz`}
          </Label>
        ))}
        <Label fontSize={0.066} color={C.time} position={[-BANK.w / 2, BANK.h + 0.14, 0]}>
          {"80 mel filters M[m, k] over |X[k]|² (grey): narrow and dense below 1 kHz, wide above"}
        </Label>
      </group>
      <Label fontSize={0.09} color={C.dim} anchorX="center" position={[(BANK.x + BANK.w / 2 + BANDS.x - BANDS.w / 2) / 2, BANK.y + 0.55, 0]}>
        {"›"}
      </Label>
      {/* the 80 values of this frame */}
      <group position={[BANDS.x, BANDS.y, 0]}>
        <mesh material={MAT.panel()} position={[0, BANDS.h / 2 - 0.02, -0.05]}>
          <boxGeometry args={[BANDS.w + 0.3, BANDS.h + 0.62, 0.04]} />
        </mesh>
        <instancedMesh ref={bands} args={[geo, bandMat, N_MELS]} frustumCulled={false} />
        <Label fontSize={0.06} color={C.faint} position={[-BANDS.w / 2, -0.1, 0]}>
          {"mel 0"}
        </Label>
        <Label fontSize={0.06} color={C.faint} anchorX="right" position={[BANDS.w / 2, -0.1, 0]}>
          {"mel 79"}
        </Label>
        <Label ref={label as never} fontSize={0.066} color={C.fg} position={[-BANDS.w / 2, BANDS.h + 0.14, 0]}>
          {" "}
        </Label>
      </group>

      {/* the whole input, as a terrain */}
      {terrain && (
        <group position={[TERRAIN.x, 0.03, TERRAIN.z - TERRAIN.d]}>
          <mesh geometry={terrain.g} material={terrainMat} />
          <mesh ref={sweep} position={[0, TERRAIN.h / 2 + 0.05, TERRAIN.d / 2]}>
            <boxGeometry args={[0.012, TERRAIN.h + 0.1, TERRAIN.d + 0.1]} />
            <meshBasicMaterial color={C.time} transparent opacity={0.7} toneMapped={false} />
          </mesh>
          <Label fontSize={0.075} color={C.dim} position={[0, TERRAIN.h + 0.25, 0]}>
            {r ? `log-mel [80 × 3000] · ${r.mel.contentFrames} frames of speech, ${N_FRAMES - r.mel.contentFrames} of padding at the floor (max − 8)` : ""}
          </Label>
          <Label fontSize={0.064} color={C.faint} position={[terrain.ax(terrain.d) + 0.08, 0.12, TERRAIN.d + 0.12]} rotation={[-Math.PI / 2, 0, 0]}>
            {"padding, compressed"}
          </Label>
          <Label fontSize={0.064} color={C.faint} position={[-0.06, 0.02, TERRAIN.d]} anchorX="right" rotation={[-Math.PI / 2, 0, 0]}>
            {"low"}
          </Label>
          <Label fontSize={0.064} color={C.faint} position={[-0.06, 0.02, 0]} anchorX="right" rotation={[-Math.PI / 2, 0, 0]}>
            {"8 kHz"}
          </Label>
        </group>
      )}
    </group>
  );
}
