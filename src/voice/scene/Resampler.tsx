"use client";

import { Line } from "@react-three/drei";
import { useMemo } from "react";
import { SAMPLE_RATE } from "../audio/frontend";
import { RESAMPLE, Resampler as Rs } from "../audio/resample";
import { getLab } from "../lab";
import { X } from "../story";
import { useVoice } from "../store";
import { C, Caption, Label, MAT, axis30, envelope } from "./common";

/**
 * 03 · 16 kHz, 30 s. Under a magnifier, the input samples, the windowed-sinc kernel that makes one output
 * sample, and the 16 kHz samples that result; below, the 30-second window Whisper always reads, the clip at its
 * start and zeros after it.
 */

const MAG = { x: -1.7, y: 2.75, w: 4.8, h: 1.1 };
const TAPE = { x: -4.4, y: 0.95, w: 8.8, h: 0.34 };
/** the magnifier shows ±1.25 ms */
const SPAN = 0.00125;

export default function Resampler() {
  const runId = useVoice((s) => s.run);
  const run = getLab()?.run ?? null;

  const mag = useMemo(() => {
    if (!run) return null;
    const { rate, data } = run.clip.raw;
    // centre the magnifier on the loudest 10 ms of the clip
    const win = Math.round(rate * 0.01);
    let best = 0;
    let at = 0;
    for (let i = 0; i + win < data.length; i += win) {
      let s = 0;
      for (let k = i; k < i + win; k++) s += data[k] * data[k];
      if (s > best) {
        best = s;
        at = i + win / 2;
      }
    }
    const tc = at / rate;
    // the output sample nearest the centre, and its neighbours inside the window
    const n0 = Math.round(tc * SAMPLE_RATE);
    const t0 = n0 / SAMPLE_RATE;
    const i0 = Math.ceil((t0 - SPAN) * rate);
    const i1 = Math.floor((t0 + SPAN) * rate);
    const peak = Math.max(1e-6, ...Array.from(data.subarray(Math.max(0, i0), i1 + 1), Math.abs));
    const sx = (t: number) => ((t - t0) / SPAN) * (MAG.w / 2);
    const sy = (v: number) => (v / peak) * MAG.h * 0.42;
    const inPts: [number, number, number][] = [];
    for (let i = i0; i <= i1; i++) inPts.push([sx(i / rate), sy(data[Math.max(0, i)] ?? 0), 0]);
    const out: { x: number; y: number }[] = [];
    for (let n = Math.ceil((t0 - SPAN) * SAMPLE_RATE); n <= Math.floor((t0 + SPAN) * SAMPLE_RATE); n++) {
      out.push({ x: sx(n / SAMPLE_RATE), y: sy(run.clip.full[n] ?? 0) });
    }
    const rs = new Rs(rate, SAMPLE_RATE);
    const kernel: [number, number, number][] = [];
    for (let k = 0; k <= 160; k++) {
      const tau = ((k / 160) * 2 - 1) * SPAN;
      kernel.push([sx(t0 + tau), rs.kernel(tau) * MAG.h * 0.42, 0.01]);
    }
    return { rate, tc, inPts, out, kernel, same: rate === SAMPLE_RATE, fc: rs.fc, taps: Math.round(2 * rs.T * rate) };
  }, [run, runId]); // eslint-disable-line react-hooks/exhaustive-deps

  const tape = useMemo(() => {
    if (!run) return null;
    const d = run.clip.audio.length / SAMPLE_RATE;
    const ax = axis30(d, TAPE.w);
    const cols = 220;
    const env = envelope(run.clip.audio, cols);
    let peak = 1e-6;
    for (let c = 0; c < cols; c++) peak = Math.max(peak, -env.lo[c], env.hi[c]);
    // one vertical segment per column, min to max
    const segs = new Float32Array(cols * 6);
    for (let c = 0; c < cols; c++) {
      const x = ax(((c + 0.5) / cols) * d);
      segs.set([x, (env.hi[c] / peak) * TAPE.h, 0, x, (env.lo[c] / peak) * TAPE.h, 0], c * 6);
    }
    return { d, ax, segs };
  }, [run, runId]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <group position={[X.resample, 0, 0]}>
      <Caption
        n="03"
        title="16 kHz, 30 seconds · what Whisper expects"
        spec={`band-limit to 0.97 × 8 kHz and resample: y[n] = Σ_k x[k] · h(n/16000 − k/f_in), h = Kaiser(β = ${RESAMPLE.beta})-windowed sinc, ±${RESAMPLE.zeros} zero crossings`}
        tag={{ text: "live", kind: "live" }}
        position={[-4.5, 4.4, 0]}
        width={8.8}
      />

      {/* the magnifier */}
      <group position={[MAG.x, MAG.y, 0]}>
        <mesh material={MAT.panel()} position={[0, 0, -0.05]}>
          <boxGeometry args={[MAG.w + 0.3, MAG.h + 0.5, 0.04]} />
        </mesh>
        <mesh position={[0, 0, -0.025]}>
          <planeGeometry args={[MAG.w, 0.004]} />
          <meshBasicMaterial color={C.wire} toneMapped={false} />
        </mesh>
        {mag && (
          <>
            {!mag.same && <Line points={mag.kernel} color={C.time} lineWidth={1.4} transparent opacity={0.85} toneMapped={false} />}
            {mag.inPts.length > 1 && <Line points={mag.inPts} color={C.dim} lineWidth={0.8} transparent opacity={0.5} toneMapped={false} />}
            {mag.inPts.map((p, i) => (
              <mesh key={`i${i}`} position={p}>
                <circleGeometry args={[mag.same ? 0.03 : 0.016, 12]} />
                <meshBasicMaterial color={mag.same ? C.speech : C.fg} toneMapped={false} />
              </mesh>
            ))}
            {!mag.same &&
              mag.out.map((o, i) => (
                <group key={`o${i}`} position={[o.x, 0, 0.02]}>
                  <mesh position={[0, o.y / 2, 0]}>
                    <planeGeometry args={[0.012, Math.max(0.004, Math.abs(o.y))]} />
                    <meshBasicMaterial color={C.speech} toneMapped={false} />
                  </mesh>
                  <mesh position={[0, o.y, 0]}>
                    <circleGeometry args={[0.034, 16]} />
                    <meshBasicMaterial color={C.speech} toneMapped={false} />
                  </mesh>
                </group>
              ))}
            <Label fontSize={0.07} color={C.dim} position={[-MAG.w / 2, MAG.h / 2 + 0.13, 0]}>
              {mag.same
                ? `the source is already 16 kHz: every sample passes straight through · 2.5 ms at ${mag.tc.toFixed(2)} s`
                : `2.5 ms at ${mag.tc.toFixed(3)} s · ● ${mag.rate.toLocaleString("en-US")} Hz in · ● 16 kHz out · kernel of the centre sample, ${mag.taps} taps`}
            </Label>
            {!mag.same && (
              <Label fontSize={0.062} color={C.time} anchorX="right" position={[MAG.w / 2, -MAG.h / 2 - 0.12, 0]}>
                {`h(τ), cut-off ${(mag.fc / 1000).toFixed(2)} kHz: nothing above 8 kHz may survive, or it would alias`}
              </Label>
            )}
          </>
        )}
      </group>

      {/* the 30-second window */}
      <group position={[TAPE.x, TAPE.y, 0]}>
        <mesh material={MAT.panel()} position={[TAPE.w / 2, 0, -0.05]}>
          <boxGeometry args={[TAPE.w + 0.3, TAPE.h * 2 + 0.5, 0.04]} />
        </mesh>
        {tape && (
          <>
            <lineSegments>
              <bufferGeometry>
                <bufferAttribute attach="attributes-position" args={[tape.segs, 3]} />
              </bufferGeometry>
              <lineBasicMaterial color={C.fg} toneMapped={false} />
            </lineSegments>
            <mesh position={[(tape.ax(tape.d) + TAPE.w) / 2, 0, 0]}>
              <planeGeometry args={[TAPE.w - tape.ax(tape.d), 0.008]} />
              <meshBasicMaterial color={C.dim} toneMapped={false} />
            </mesh>
            {[0, tape.d, 30].map((t, i) => (
              <group key={i} position={[tape.ax(t), -TAPE.h - 0.1, 0]}>
                <mesh position={[0, 0.05, 0]}>
                  <planeGeometry args={[0.006, 0.08]} />
                  <meshBasicMaterial color={C.faint} toneMapped={false} />
                </mesh>
                <Label fontSize={0.064} color={i === 1 ? C.fg : C.faint} anchorX="center" position={[0, -0.05, 0]}>
                  {`${t.toFixed(t % 1 ? 2 : 0)} s`}
                </Label>
              </group>
            ))}
            <Label fontSize={0.066} color={C.faint} anchorX="center" position={[(tape.ax(tape.d) + TAPE.w) / 2, 0.1, 0]}>
              {`${(30 - tape.d).toFixed(2)} s of zeros (drawn compressed)`}
            </Label>
            <Label fontSize={0.07} color={C.dim} position={[0, TAPE.h + 0.14, 0]}>
              {`audio [480 000] float32 · ${Math.round(tape.d * SAMPLE_RATE).toLocaleString("en-US")} samples of speech, then ${(480000 - Math.round(tape.d * SAMPLE_RATE)).toLocaleString("en-US")} zeros`}
            </Label>
          </>
        )}
      </group>
    </group>
  );
}
