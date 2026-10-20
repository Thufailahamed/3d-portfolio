"use client";

import { useRef } from "react";
import { DECODE, DENOISE, getLab } from "../lab";
import { STAGES, stageDuration } from "../story";
import { stepCursor, useLab } from "../store";
import { generate, newSeed } from "./Controls";

const SPEEDS = [0.5, 1, 2];

/** the whole pipeline as one timeline: a segment per stage, one tick per denoising step */
export default function Transport() {
  const stage = useLab((s) => s.stage);
  const p = useLab((s) => s.p);
  const playing = useLab((s) => s.playing);
  const steps = useLab((s) => s.steps);
  const speed = useLab((s) => s.speed);
  const computed = useLab((s) => s.computed);
  const decode = useLab((s) => s.decode.status);
  const cls = useLab((s) => s.cls);
  const w = useLab((s) => s.w);
  const seed = useLab((s) => s.seed);
  const sampler = useLab((s) => s.sampler);
  const set = useLab((s) => s.set);
  const track = useRef<HTMLDivElement>(null);
  const durs = STAGES.map((_, i) => stageDuration(i, steps));
  const total = durs.reduce((a, b) => a + b, 0);

  const seek = (clientX: number) => {
    const el = track.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    let x = ((clientX - r.left) / r.width) * total;
    let i = 0;
    while (i < STAGES.length - 1 && x > durs[i]) x -= durs[i++];
    let q = Math.min(1, Math.max(0, x / durs[i]));
    // the future isn't computed yet: the loop can't be shown past the sampler, nor the image before z_0
    if (i === DENOISE) q = Math.min(q, computed / steps);
    if (i > DENOISE && computed < steps) {
      i = DENOISE;
      q = computed / steps;
    }
    if (i === DECODE + 1 && decode !== "done") {
      i = DECODE;
      q = 0.5;
    }
    set({ stage: i, p: q, playing: false, follow: true, overview: false });
  };

  const toggle = () => {
    if (playing) return set({ playing: false });
    if (stage === STAGES.length - 1 && p >= 1) return set({ stage: 0, p: 0, playing: true, follow: true });
    set({ playing: true, follow: true });
  };

  const cursor = stepCursor(p, steps);
  const k = Math.min(steps, Math.floor(cursor));
  const t = getLab()?.record(Math.min(k, steps - 1))?.t;
  const readout =
    stage === DENOISE ? (
      <>
        step <b className="text-[var(--fg)]">{Math.min(steps, k + 1)}</b>/{steps} · t <b className="text-[var(--fg)]">{k >= steps ? 0 : (t ?? 999)}</b>
      </>
    ) : (
      STAGES[stage].title
    );

  return (
    <div>
      <div className="dl-bar">
        <button type="button" className="dl-play" onClick={toggle} title={playing ? "Pause (space)" : "Play (space)"} aria-label={playing ? "Pause" : "Play"}>
          <svg width="13" height="13" viewBox="0 0 24 24" aria-hidden>
            {playing ? <path d="M6 4h4v16H6zM14 4h4v16h-4z" fill="currentColor" /> : <path d="M7 4v16l13-8z" fill="currentColor" />}
          </svg>
        </button>
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
              <div key={s.id} className={`seg ${i === stage ? "on" : ""} ${i < stage ? "done" : ""}`} style={{ flex: durs[i] }}>
                {i === DENOISE && <div className="absolute bottom-[6px] left-0 z-[1] h-[2px] bg-[rgba(239,232,220,0.12)]" style={{ width: `${(computed / steps) * 100}%` }} />}
                <div className="fill" style={{ width: `${fill * 100}%` }} />
                {i === DENOISE && steps <= 50 && Array.from({ length: steps - 1 }, (_, j) => <span key={j} className="tick" style={{ left: `${((j + 1) / steps) * 100}%` }} />)}
                <span className="name max-md:hidden">
                  <i>{String(i + 1).padStart(2, "0")}</i>
                  {i === DENOISE ? `${s.title} · ${steps} steps` : s.title}
                </span>
              </div>
            );
          })}
        </div>
        <p className="dl-mono w-[132px] shrink-0 text-right text-[11px] text-[var(--fg-3)] max-sm:hidden">{readout}</p>
        <button
          type="button"
          className="dl-btn primary shrink-0"
          onClick={() => {
            set({ seed: newSeed() });
            generate();
          }}
          title="Generate again with a new seed (R)"
        >
          New seed <span aria-hidden>→</span>
        </button>
        <div className="dl-seg max-sm:hidden">
          {SPEEDS.map((v) => (
            <button key={v} type="button" aria-pressed={speed === v} onClick={() => set({ speed: v })} className="!px-2.5">
              {v}×
            </button>
          ))}
        </div>
      </div>
      <div className="dl-rebate mt-2 pl-[54px] max-md:hidden" aria-hidden>
        <span>SD 1.5</span>
        <span>{getLab()?.assets.manifest.classes[cls]?.id ?? "uncond"}</span>
        <span>{sampler}</span>
        <span>{steps} steps</span>
        <span>w {w.toFixed(1)}</span>
        <span>seed {seed}</span>
        <span>512 × 512</span>
        <span>
          frame {String(stage + 1).padStart(2, "0")}/{String(STAGES.length).padStart(2, "0")}
        </span>
      </div>
    </div>
  );
}
