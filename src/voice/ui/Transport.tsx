"use client";

import { useRef } from "react";
import { getLab } from "../lab";
import { shownAttempt } from "../scene/Decoder";
import { STAGES, stageDuration, stageIndex } from "../story";
import { useVoice } from "../store";
import { MicStatus, record } from "./Controls";

const SPEEDS = [0.5, 1, 2];
const ENCODER = stageIndex("encoder");
const DECODER = stageIndex("decoder");
const TEXT = stageIndex("text");

/** the whole pipeline as one timeline: a segment per stage, one tick per token */
export default function Transport() {
  const stage = useVoice((s) => s.stage);
  const p = useVoice((s) => s.p);
  const playing = useVoice((s) => s.playing);
  const speed = useVoice((s) => s.speed);
  const tokens = useVoice((s) => s.tokens);
  const enc = useVoice((s) => s.enc);
  const dec = useVoice((s) => s.dec);
  const align = useVoice((s) => s.align);
  const mic = useVoice((s) => s.mic);
  const model = useVoice((s) => s.model);
  const set = useVoice((s) => s.set);
  const track = useRef<HTMLDivElement>(null);
  const recording = mic === "asking" || mic === "calibrating" || mic === "listening" || mic === "speech";
  const n = shownAttempt(getLab()?.run ?? null)?.steps?.length ?? tokens;
  const durs = STAGES.map((_, i) => stageDuration(i, n));
  const total = durs.reduce((a, b) => a + b, 0);

  const seek = (clientX: number) => {
    const el = track.current;
    if (!el || recording) return;
    const r = el.getBoundingClientRect();
    let x = ((clientX - r.left) / r.width) * total;
    let i = 0;
    while (i < STAGES.length - 1 && x > durs[i]) x -= durs[i++];
    let q = Math.min(1, Math.max(0, x / durs[i]));
    // nothing past what has been computed
    if (i >= ENCODER && enc !== "done") {
      i = ENCODER;
      q = Math.min(q, 0.5);
    }
    if (i >= DECODER && dec !== "done") {
      i = DECODER;
      q = Math.min(q, 0.3);
    }
    if (i === TEXT && align !== "done" && align !== "error") q = Math.min(q, 0.3);
    set({ stage: i, p: q, playing: false, follow: true, overview: false });
  };

  const toggle = () => {
    if (playing) return set({ playing: false });
    if (stage === STAGES.length - 1 && p >= 1) return set({ stage: 0, p: 0, playing: true, follow: true });
    set({ playing: true, follow: true });
  };

  const waiting =
    stage === ENCODER && enc !== "done" ? (model.ready ? "encoding on the GPU…" : `weights ${Math.round(model.progress * 100)}%`) : stage === DECODER && dec === "running" ? `token ${tokens}` : stage === TEXT && align === "running" ? "aligning words…" : null;

  return (
    <div className="dl-bar">
      <button type="button" className="dl-play" onClick={toggle} title={playing ? "Pause (space)" : "Play (space)"} aria-label={playing ? "Pause" : "Play"} disabled={recording}>
        <svg width="13" height="13" viewBox="0 0 24 24" aria-hidden>
          {playing ? <path d="M6 4h4v16H6zM14 4h4v16h-4z" fill="currentColor" /> : <path d="M7 4v16l13-8z" fill="currentColor" />}
        </svg>
      </button>
      {recording ? (
        <div className="min-w-0 flex-1">
          <MicStatus />
        </div>
      ) : (
        <div
          ref={track}
          className="dl-track min-w-0 flex-1"
          onPointerDown={(e) => {
            (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
            seek(e.clientX);
          }}
          onPointerMove={(e) => e.buttons === 1 && seek(e.clientX)}
          role="slider"
          aria-label="Pipeline progress"
          aria-valuemin={0}
          aria-valuemax={STAGES.length}
          aria-valuenow={stage + p}
        >
          {STAGES.map((s, i) => {
            const fill = i < stage ? 1 : i === stage ? p : 0;
            return (
              <div key={s.id} className={`seg ${i === stage ? "on" : ""} ${i < stage ? "done" : ""}`} style={{ flex: durs[i] }} title={s.ask}>
                <div className="fill" style={{ width: `${fill * 100}%` }} />
                {i === DECODER && n > 1 && n <= 120 && Array.from({ length: n - 1 }, (_, j) => <span key={j} className="tick" style={{ left: `${((j + 1) / n) * 100}%` }} />)}
                <span className="name max-md:hidden">
                  <i>{String(i + 1).padStart(2, "0")}</i>
                  {s.title}
                </span>
              </div>
            );
          })}
        </div>
      )}
      <p className="dl-mono w-[150px] shrink-0 truncate text-right text-[11px] text-[var(--fg-3)] max-sm:hidden">{recording ? "recording" : (waiting ?? STAGES[stage].ask)}</p>
      <button type="button" className={`vx-speak shrink-0 ${recording ? "on" : ""}`} onClick={record} title="Record yourself (R)">
        <span className={`vx-rec ${recording ? "on" : ""}`} aria-hidden />
        {recording ? "Stop" : "Speak"}
      </button>
      <div className="dl-seg max-sm:hidden">
        {SPEEDS.map((v) => (
          <button key={v} type="button" aria-pressed={speed === v} onClick={() => set({ speed: v })} className="!px-2.5">
            {v}×
          </button>
        ))}
      </div>
    </div>
  );
}
