"use client";

import { useEffect, useRef, useState } from "react";
import { SAMPLE_RATE } from "../audio/frontend";
import { MAX_SECONDS, getLab } from "../lab";
import { useVoice } from "../store";

const TEMPS = [
  [0, "0 · fallback", "Whisper's default: greedy, then T = 0.2 … 1.0 only if the text looks broken"],
  [0.5, "0.5", "sample every token from the softmax at T = 0.5: still mostly right, sometimes not"],
  [1, "1.0", "sample from the model's own distribution: watch it guess"],
] as const;

/** start or stop the microphone */
export function record() {
  const lab = getLab();
  if (!lab) return;
  if (lab.live) lab.stopLive();
  else void lab.record();
}

/** the recorder's live readout: state, clock and input level */
export function MicStatus() {
  const mic = useVoice((s) => s.mic);
  const recorded = useVoice((s) => s.recorded);
  const bar = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    let raf = 0;
    const loop = () => {
      const live = getLab()?.live;
      if (bar.current) bar.current.style.width = `${live ? Math.min(100, Math.max(0, ((live.level + 60) / 54) * 100)) : 0}%`;
      raf = requestAnimationFrame(loop);
    };
    loop();
    return () => cancelAnimationFrame(raf);
  }, []);
  const label = { off: "", asking: "asking for the microphone…", calibrating: "measuring the room", listening: "listening", speech: "hearing speech", done: "", denied: "no microphone" }[mic];
  return (
    <div className="vx-mic">
      <span className={`vx-dot ${mic === "speech" ? "on" : ""}`} />
      <span className="dl-mono text-[11px] text-[var(--fg-2)]">{label}</span>
      <span className="vx-meter">
        <span ref={bar} />
      </span>
      <span className="dl-mono w-[84px] shrink-0 whitespace-nowrap text-right text-[11px] text-[var(--fg-3)]">
        {recorded.toFixed(1)} / {MAX_SECONDS} s
      </span>
    </div>
  );
}

export default function Controls() {
  const set = useVoice((s) => s.set);
  const mic = useVoice((s) => s.mic);
  const error = useVoice((s) => s.error);
  const temperature = useVoice((s) => s.temperature);
  const timestamps = useVoice((s) => s.timestamps);
  const seed = useVoice((s) => s.seed);
  const enc = useVoice((s) => s.enc);
  const source = useVoice((s) => s.source);
  const file = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const recording = mic === "asking" || mic === "calibrating" || mic === "listening" || mic === "speech";
  const lab = getLab();

  const decode = (patch: Partial<ReturnType<typeof useVoice.getState>>) => {
    set(patch);
    lab?.redecode();
  };

  return (
    <div className="dl-card dl-scroll max-h-full overflow-y-auto">
      <div className="dl-head !items-center">
        <p className="dl-eyebrow">Input & decoding</p>
        <button type="button" className="dl-btn !h-6 !px-2 !text-[11px]" onClick={() => set({ panel: false })} aria-label="Hide settings">
          Hide
        </button>
      </div>
      <div className="dl-section">
        <p className="dl-label">
          <span>your voice</span>
          <span>up to {MAX_SECONDS} s · English</span>
        </p>
        <button type="button" className={`vx-speak big ${recording ? "on" : ""}`} onClick={record}>
          <span className={`vx-rec ${recording ? "on" : ""}`} aria-hidden />
          {recording ? "Stop and transcribe" : "Speak"}
        </button>
        {recording && (
          <div className="mt-2.5">
            <MicStatus />
          </div>
        )}
        <p className="dl-small mt-2">
          The microphone is read raw (no echo cancellation, noise suppression or gain control) and never leaves this page. The detector stops the recording half a second after you finish.
        </p>
        {error && <p className="dl-small mt-2 !text-[var(--time)]">{error}</p>}
      </div>
      <div className="dl-section">
        <p className="dl-label">
          <span>or</span>
        </p>
        <div className="flex gap-2">
          <button type="button" className="dl-btn flex-1" aria-pressed={source === "sample"} onClick={() => lab && lab.start({ ...lab.sample, trim: [0, lab.sample.full.length], audio: lab.sample.full })}>
            JFK, 1961
          </button>
          <button type="button" className="dl-btn flex-1" aria-pressed={source === "file"} disabled={busy} onClick={() => file.current?.click()}>
            {busy ? "Reading…" : "Audio file"}
          </button>
          <input
            ref={file}
            type="file"
            accept="audio/*"
            className="hidden"
            onChange={async (e) => {
              const f = e.target.files?.[0];
              e.target.value = "";
              if (!f || !lab) return;
              setBusy(true);
              try {
                await lab.fromFile(f);
                set({ error: null });
              } catch {
                set({ error: `Couldn't decode ${f.name}.` });
              } finally {
                setBusy(false);
              }
            }}
          />
        </div>
        <p className="dl-small mt-2">Files are decoded by the browser, mixed to mono, resampled to 16 kHz and cut at 30 s, Whisper&apos;s window.</p>
      </div>
      <div className="dl-section">
        <p className="dl-label">
          <span>temperature</span>
          <span className="dl-mono">T = {temperature}</span>
        </p>
        <div className="dl-seg">
          {TEMPS.map(([t, label, note]) => (
            <button key={t} type="button" aria-pressed={temperature === t} title={note} onClick={() => decode({ temperature: t })} disabled={enc !== "done"}>
              {label}
            </button>
          ))}
        </div>
        <p className="dl-small mt-2">{TEMPS.find(([t]) => t === temperature)?.[2]}</p>
      </div>
      <div className="dl-section">
        <p className="dl-label">
          <span>timestamp tokens</span>
        </p>
        <div className="dl-seg">
          {([true, false] as const).map((v) => (
            <button key={String(v)} type="button" aria-pressed={timestamps === v} onClick={() => decode({ timestamps: v })} disabled={enc !== "done"}>
              {v ? "predicted" : "<|notimestamps|>"}
            </button>
          ))}
        </div>
        <div className="mt-3 flex gap-2">
          <button type="button" className="dl-btn flex-1" onClick={() => decode({ seed: seed + 1 })} disabled={enc !== "done" || temperature === 0} title="Sampling only">
            New sample · seed {seed}
          </button>
        </div>
      </div>
    </div>
  );
}

/** the run in one card, for when the settings are put away */
export function RunSummary() {
  const set = useVoice((s) => s.set);
  const run = useVoice((s) => s.run);
  const dec = useVoice((s) => s.dec);
  const temperature = useVoice((s) => s.temperature);
  const r = getLab()?.run;
  void run;
  return (
    <button type="button" className="dl-card flex w-[340px] items-center gap-2.5 py-2 pl-3 pr-2 text-left transition-colors hover:border-[var(--line-2)]" onClick={() => set({ panel: true })} title="Input & decoding">
      <i className={`h-2 w-2 shrink-0 rounded-full ${r?.clip.source === "mic" ? "bg-[var(--rec)]" : "bg-[var(--accent)]"}`} />
      <span className="min-w-0 flex-1">
        <span className="block truncate font-[family-name:var(--serif)] text-[14px] leading-[1.3] text-[var(--fg)]">{dec === "done" && r?.final ? `“${r.final.text || "…"}”` : (r?.clip.name ?? "")}</span>
        <span className="dl-mono block text-[10px] text-[var(--fg-3)]">
          {r ? `${r.clip.name} · ${(r.clip.audio.length / SAMPLE_RATE).toFixed(2)} s${temperature ? ` · T = ${temperature}` : ""}` : ""}
        </span>
      </span>
      <span className="dl-btn !h-[28px] !px-2.5 !text-[11.5px]">Input</span>
    </button>
  );
}
