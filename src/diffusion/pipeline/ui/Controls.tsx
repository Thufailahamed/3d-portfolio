"use client";

import { SAMPLERS } from "../../schedule";
import { getLab } from "../lab";
import { GUIDANCE, STEP_OPTIONS, useLab } from "../store";

export const newSeed = () => 1 + Math.floor(Math.random() * 99999);

/** start a run with the current settings; a new prompt replays from the tokenizer, anything else from the noise */
export function generate(from: "tokens" | "noise" = "noise") {
  const lab = getLab();
  if (!lab) return;
  const s = useLab.getState();
  lab.start({ cls: s.cls, steps: s.steps, sampler: s.sampler, schedule: "scaled", w: s.w, seed: s.seed });
  s.set({ stage: from === "tokens" ? 1 : 3, p: 0, playing: true, follow: true, overview: false });
}

export default function Controls() {
  const cls = useLab((s) => s.cls);
  const steps = useLab((s) => s.steps);
  const sampler = useLab((s) => s.sampler);
  const w = useLab((s) => s.w);
  const seed = useLab((s) => s.seed);
  const set = useLab((s) => s.set);
  const lab = getLab();
  const classes = lab?.assets.manifest.classes ?? [];

  const pick = (patch: Partial<ReturnType<typeof useLab.getState>>, from: "tokens" | "noise" = "noise") => {
    set(patch);
    generate(from);
  };

  return (
    <div className="dl-card dl-scroll max-h-full overflow-y-auto">
      <div className="dl-head !items-center">
        <p className="dl-eyebrow">Run settings</p>
        <button type="button" className="dl-btn !h-6 !px-2 !text-[11px]" onClick={() => set({ panel: false })} aria-label="Hide settings">
          Hide
        </button>
      </div>
      <div className="dl-section !px-2">
        <p className="dl-label px-2">
          <span>prompt</span>
          <span>{lab ? `${lab.tr.N} training images` : ""}</span>
        </p>
        {classes.map((c, i) => (
          <button key={c.id} type="button" className="dl-prompt" aria-pressed={cls === i} onClick={() => pick({ cls: i }, "tokens")}>
            <i style={{ background: c.color }} />
            <span>{c.prompt}</span>
            <span>{c.tokens.length}t</span>
          </button>
        ))}
      </div>
      <div className="dl-section">
        <p className="dl-label">
          <span>sampler</span>
        </p>
        <div className="dl-seg">
          {SAMPLERS.map((s) => (
            <button key={s.id} type="button" aria-pressed={sampler === s.id} title={s.note} onClick={() => pick({ sampler: s.id })}>
              {s.id === "dpm2m" ? "DPM++ 2M" : s.label}
            </button>
          ))}
        </div>
        <p className="dl-small mt-2">{SAMPLERS.find((s) => s.id === sampler)?.note}</p>
      </div>
      <div className="dl-section">
        <p className="dl-label">
          <span>steps</span>
          <span>{steps * 2} U-Net evaluations</span>
        </p>
        <div className="dl-seg">
          {STEP_OPTIONS.map((n) => (
            <button key={n} type="button" aria-pressed={steps === n} onClick={() => pick({ steps: n })}>
              {n}
            </button>
          ))}
        </div>
      </div>
      <div className="dl-section">
        <p className="dl-label">
          <span>guidance scale</span>
          <span className="dl-mono">w = {w.toFixed(1)}</span>
        </p>
        <input
          type="range"
          className="dl-range"
          min={GUIDANCE.min}
          max={GUIDANCE.max}
          step={0.5}
          value={w}
          style={{ "--fill": `${((w - GUIDANCE.min) / (GUIDANCE.max - GUIDANCE.min)) * 100}%` } as React.CSSProperties}
          onChange={(e) => set({ w: Number(e.target.value) })}
          onPointerUp={() => generate()}
          onKeyUp={() => generate()}
          aria-label="Guidance scale"
        />
        <p className="dl-small mt-1">1 samples the prompt&apos;s distribution as learned; higher pushes away from the unconditional model. SD&apos;s default is 7.5; this stand-in saturates sooner.</p>
      </div>
      <div className="dl-section">
        <p className="dl-label">
          <span>seed</span>
        </p>
        <div className="flex gap-2">
          <input
            className="dl-input"
            type="number"
            min={1}
            value={seed}
            onChange={(e) => set({ seed: Math.max(1, Math.floor(Number(e.target.value) || 1)) })}
            onKeyDown={(e) => e.key === "Enter" && generate()}
            aria-label="Seed"
          />
          <button type="button" className="dl-btn !px-2.5" onClick={() => pick({ seed: newSeed() })} title="New seed (R)" aria-label="New seed">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden>
              <rect x="4" y="4" width="16" height="16" rx="2" />
              <circle cx="9" cy="9" r="1.2" fill="currentColor" />
              <circle cx="15" cy="15" r="1.2" fill="currentColor" />
              <circle cx="15" cy="9" r="1.2" fill="currentColor" />
              <circle cx="9" cy="15" r="1.2" fill="currentColor" />
            </svg>
          </button>
        </div>
        <button type="button" className="dl-btn primary mt-3 w-full" onClick={() => generate()}>
          Generate
          <span aria-hidden>→</span>
        </button>
      </div>
    </div>
  );
}

/** the run in one card, for when the settings are put away */
export function RunSummary() {
  const cls = useLab((s) => s.cls);
  const steps = useLab((s) => s.steps);
  const sampler = useLab((s) => s.sampler);
  const w = useLab((s) => s.w);
  const seed = useLab((s) => s.seed);
  const set = useLab((s) => s.set);
  const c = getLab()?.assets.manifest.classes[cls];
  const name = SAMPLERS.find((s) => s.id === sampler)?.label ?? sampler;
  return (
    <button
      type="button"
      className="dl-card flex w-[340px] items-center gap-2.5 py-2 pl-3 pr-2 text-left transition-colors hover:border-[var(--line-2)]"
      onClick={() => set({ panel: true })}
      title="Run settings"
    >
      <i className="h-2 w-2 shrink-0 rounded-[1px]" style={{ background: c?.color }} />
      <span className="min-w-0 flex-1">
        <span className="block truncate font-[family-name:var(--serif)] text-[14px] leading-[1.3] text-[var(--fg)]">{c?.prompt}</span>
        <span className="dl-mono block text-[10px] text-[var(--fg-3)]">
          {name} · {steps} steps · w {w.toFixed(1)} · seed {seed}
        </span>
      </span>
      <span className="dl-btn !h-[28px] !px-2.5 !text-[11.5px]">Settings</span>
    </button>
  );
}
