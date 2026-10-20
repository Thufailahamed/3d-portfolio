"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useEffect, useMemo } from "react";
import { CLASSES } from "./datasets";
import { SAMPLERS, SCHEDULES, T, alphaBars, nfe, snrDb, timesteps } from "./schedule";
import { GUIDANCE_MAX, STEP_OPTIONS, useLab } from "./store";

const Scene = dynamic(() => import("./Scene"), { ssr: false });

const ACCENT = "#7fe3ff";
const mono = { fontFamily: "var(--font-lab-mono), var(--font-jetbrains), ui-monospace, monospace" } as const;
const sans = { fontFamily: "var(--font-lab-sans), var(--font-inter-tight), system-ui, sans-serif" } as const;

const fmt = (n: number, d = 0) => n.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });
const fmtAb = (ab: number) => (ab >= 1 ? "1" : ab < 1e-3 ? ab.toExponential(2) : ab.toFixed(4));
const fmtDb = (ab: number) => {
  const v = snrDb(ab);
  return Number.isFinite(v) ? `${v > 0 ? "+" : ""}${fmt(v, 1)} dB` : "∞";
};
const pct = (v: number | null) => (v == null ? "—" : `${fmt(v * 100, 1)}%`);

function promptOf(cls: number, carOk: boolean) {
  if (cls < 0) return "";
  return cls === 0 && !carOk ? "a torus knot" : CLASSES[cls].prompt;
}

function Panel({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <div className={`lab-panel pointer-events-auto rounded-lg border border-white/[0.08] bg-[#0b0c0f]/[0.86] text-[#e8e9ec] shadow-[0_24px_60px_-28px_rgba(0,0,0,.95)] backdrop-blur-md ${className}`}>{children}</div>;
}

function Label({ children, hint }: { children: React.ReactNode; hint?: React.ReactNode }) {
  return (
    <div className="mb-2 flex items-baseline justify-between gap-3">
      <p className="text-[10.5px] uppercase tracking-[0.16em] text-white/40" style={mono}>
        {children}
      </p>
      {hint && <p className="text-[11px] text-white/55 tabular-nums" style={mono}>{hint}</p>}
    </div>
  );
}

function Note({ children }: { children: React.ReactNode }) {
  return <p className="mt-2 text-[11.5px] leading-[1.5] text-white/45">{children}</p>;
}

function Seg<T extends string | number>({ value, options, onChange, small }: { value: T; options: { id: T; label: React.ReactNode; title?: string }[]; onChange: (v: T) => void; small?: boolean }) {
  return (
    <div className="flex rounded-md border border-white/[0.08] bg-black/30 p-[3px]">
      {options.map((o) => (
        <button
          key={String(o.id)}
          type="button"
          title={o.title}
          aria-pressed={o.id === value}
          onClick={() => onChange(o.id)}
          className={`flex-1 whitespace-nowrap rounded-[5px] px-2 ${small ? "py-1 text-[11px]" : "py-1.5 text-[12px]"} font-medium transition-colors ${o.id === value ? "bg-[#e8e9ec] text-[#0b0c0f]" : "text-white/60 hover:text-white"}`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function Btn({ onClick, children, active, title, className = "" }: { onClick: () => void; children: React.ReactNode; active?: boolean; title?: string; className?: string }) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      aria-pressed={active}
      onClick={onClick}
      className={`pointer-events-auto flex h-9 items-center justify-center gap-1.5 rounded-md px-3 text-[12.5px] font-medium transition-colors ${active ? "bg-[#e8e9ec] text-[#0b0c0f]" : "border border-white/[0.08] bg-[#0b0c0f]/80 text-white/70 backdrop-blur-md hover:border-white/20 hover:text-white"} ${className}`}
    >
      {children}
    </button>
  );
}

function Stat({ k, v, sub }: { k: React.ReactNode; v: React.ReactNode; sub?: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-white/[0.06] py-[6px] last:border-0">
      <span className="shrink-0 text-[12px] text-white/45">{k}</span>
      <span className="text-right text-[12px] text-white/90 tabular-nums" style={mono}>
        {v}
        {sub && <span className="ml-1.5 text-white/35">{sub}</span>}
      </span>
    </div>
  );
}

const newSeed = () => 1 + Math.floor(Math.random() * 99999);

/* ——— left: prompt and sampler ——— */

function PromptPanel() {
  const cls = useLab((s) => s.cls);
  const w = useLab((s) => s.w);
  const sampler = useLab((s) => s.sampler);
  const steps = useLab((s) => s.steps);
  const schedule = useLab((s) => s.schedule);
  const train = useLab((s) => s.train);
  const sizes = useLab((s) => s.sizes);
  const seed = useLab((s) => s.seed);
  const carOk = useLab((s) => s.carOk);
  const set = useLab((s) => s.set);
  const guideNote =
    cls < 0
      ? "No prompt: the sampler draws from the mixture of all four classes, and guidance has nothing to steer toward."
      : w === 0
        ? "w = 0 ignores the prompt entirely: this is the unconditional model."
        : w === 1
          ? "w = 1 samples p(x | prompt) exactly. No guidance."
          : w < 1
            ? "0 < w < 1 blends the prompt with the unconditional model."
            : "w > 1 is classifier-free guidance: samples are pushed away from the other classes, sharper and less diverse.";

  return (
    <Panel className="w-[312px] p-4 max-md:w-full">
      <Label>Prompt</Label>
      <div className="flex min-h-[42px] items-center gap-2 rounded-md border border-white/[0.1] bg-black/40 px-3 py-2.5 text-[14px]" style={mono}>
        <span style={{ color: ACCENT }}>›</span>
        {cls >= 0 ? <span className="text-white">{promptOf(cls, carOk)}</span> : <span className="text-white/35">∅ (no prompt)</span>}
        <span className="lab-caret ml-[-2px] inline-block h-[15px] w-[7px]" style={{ background: ACCENT }} />
      </div>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {CLASSES.map((c, i) => (
          <button
            key={c.id}
            type="button"
            onClick={() => set({ cls: i })}
            aria-pressed={cls === i}
            className={`flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11.5px] transition-colors ${cls === i ? "border-white/60 bg-white/[0.08] text-white" : "border-white/[0.09] text-white/60 hover:border-white/25 hover:text-white"}`}
          >
            <span className="h-2 w-2 rounded-full" style={{ background: c.color }} />
            {promptOf(i, carOk).replace(/^an? /, "")}
          </button>
        ))}
        <button
          type="button"
          onClick={() => set({ cls: -1 })}
          aria-pressed={cls < 0}
          className={`rounded-full border px-2.5 py-1 text-[11.5px] transition-colors ${cls < 0 ? "border-white/60 bg-white/[0.08] text-white" : "border-white/[0.09] text-white/60 hover:border-white/25 hover:text-white"}`}
        >
          ∅ none
        </button>
      </div>

      <div className="mt-3 flex items-center gap-2">
        <label className="flex h-9 flex-1 items-center gap-2 rounded-md border border-white/[0.1] bg-black/40 px-3 focus-within:border-white/30">
          <span className="text-[10.5px] uppercase tracking-[0.16em] text-white/40" style={mono}>
            Seed
          </span>
          <input
            type="number"
            min={1}
            value={seed}
            onChange={(e) => set({ seed: Math.max(1, Math.floor(Number(e.target.value) || 1)) })}
            className="w-full min-w-0 bg-transparent text-[13px] text-white outline-none"
            style={mono}
            aria-label="Seed"
          />
        </label>
        <button
          type="button"
          onClick={() => set({ seed: newSeed(), mode: "generate" })}
          className="flex h-9 items-center gap-2 rounded-md px-4 text-[12.5px] font-semibold text-[#071014] transition-[filter] hover:brightness-110"
          style={{ background: ACCENT }}
          title="Sample again with a new seed (R)"
        >
          Generate
          <span aria-hidden>→</span>
        </button>
      </div>

      <div className={`mt-4 ${cls < 0 ? "opacity-40" : ""}`}>
        <Label hint={`w = ${fmt(w, 2)}`}>Guidance scale</Label>
        <input
          type="range"
          min={0}
          max={GUIDANCE_MAX}
          step={0.25}
          value={w}
          disabled={cls < 0}
          onChange={(e) => set({ w: Number(e.target.value) })}
          className="lab-range w-full"
          aria-label="Guidance scale"
        />
        <div className="flex justify-between text-[10px] text-white/30" style={mono}>
          <span>0 · uncond.</span>
          <span>1 · exact</span>
          <span>{GUIDANCE_MAX}</span>
        </div>
      </div>
      <Note>{guideNote}</Note>

      <div className="mt-4">
        <Label>Sampler</Label>
        <Seg value={sampler} onChange={(v) => set({ sampler: v })} options={SAMPLERS.map((s) => ({ id: s.id, label: s.id === "dpm2m" ? "DPM++ 2M" : s.label, title: s.note }))} />
        <Note>{SAMPLERS.find((s) => s.id === sampler)!.note}</Note>
      </div>

      <div className="mt-4">
        <Label hint={`${fmt(nfe(steps, cls >= 0 && w !== 1 && w !== 0))} NFE`}>Steps</Label>
        <Seg small value={steps} onChange={(v) => set({ steps: v })} options={STEP_OPTIONS.map((n) => ({ id: n, label: n }))} />
      </div>

      <div className="mt-4">
        <Label>Noise schedule</Label>
        <Seg small value={schedule} onChange={(v) => set({ schedule: v })} options={SCHEDULES.map((s) => ({ id: s.id, label: s.label, title: s.note }))} />
        <Note>{SCHEDULES.find((s) => s.id === schedule)!.note}</Note>
      </div>

      <div className="mt-4">
        <Label hint="per class">Training set</Label>
        <Seg small value={train} onChange={(v) => set({ train: v })} options={sizes.map((n, i) => ({ id: i, label: `${fmt(n)} pts` }))} />
        <Note>{train === 0 ? "A perfect denoiser of 48 points can only give those 48 points back: watch the samples collapse onto them, and recall fall." : "The exact denoiser memorises its training set. Real networks generalise because they can't fit this score exactly."}</Note>
      </div>
    </Panel>
  );
}

/* ——— right: what the model is doing ——— */

function Readout() {
  const st = useLab((s) => s.stats);
  const mode = useLab((s) => s.mode);
  const cls = useLab((s) => s.cls);
  const w = useLab((s) => s.w);
  const carOk = useLab((s) => s.carOk);
  const particles = useLab((s) => s.particles);
  const sizes = useLab((s) => s.sizes);
  const train = useLab((s) => s.train);
  const guided = cls >= 0 && w !== 1 && w !== 0;
  const done = st.precision != null;
  return (
    <Panel className="w-[284px] p-4">
      <Label hint={mode === "generate" ? "reverse process" : "forward process"}>State</Label>
      <Stat k="Timestep" v={st.t < 0 ? "clean" : `t = ${st.t}`} />
      <Stat k="ᾱₜ" v={fmtAb(st.ab)} />
      <Stat k="Signal √ᾱ · noise √(1−ᾱ)" v={`${fmt(Math.sqrt(st.ab), 3)} · ${fmt(Math.sqrt(1 - st.ab), 3)}`} />
      <Stat k="SNR" v={fmtDb(st.ab)} />
      {mode === "generate" && (
        <>
          <Stat k="Step" v={`${st.step} / ${st.steps}`} />
          <Stat k="Network evaluations" v={fmt(nfe(st.step, guided))} sub={guided ? "cond + uncond" : undefined} />
          <Stat k="GPU" v={`${fmt(st.ms, 1)} ms`} sub="/ step" />
        </>
      )}
      <Stat k="Samples · training pts" v={`${fmt(particles)} · ${fmt(sizes[train] * CLASSES.length)}`} />

      <div className="mt-4">
        <Label hint="mean p(c | xₜ)">Model belief</Label>
        <div className="space-y-1.5">
          {CLASSES.map((c, i) => (
            <div key={c.id} className="flex items-center gap-2 text-[11.5px]">
              <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: c.color }} />
              <span className={`w-[104px] truncate ${i === cls ? "text-white" : "text-white/55"}`}>{promptOf(i, carOk).replace(/^an? /, "")}</span>
              <span className="relative h-[5px] flex-1 overflow-hidden rounded-full bg-white/[0.07]">
                <span className="absolute inset-y-0 left-0 rounded-full transition-[width] duration-150" style={{ width: `${st.belief[i] * 100}%`, background: c.color }} />
              </span>
              <span className="w-[38px] text-right tabular-nums text-white/70" style={mono}>
                {fmt(st.belief[i] * 100, 0)}%
              </span>
            </div>
          ))}
        </div>
        <Note>Each sample&apos;s colour is this posterior: grey while the noise hides its class, its prompt&apos;s colour once the model has decided.</Note>
      </div>

      <div className="mt-4">
        <Label hint={cls >= 0 ? promptOf(cls, carOk).replace(/^an? /, "") : "all classes"}>Sample quality</Label>
        <Stat k="Distance to shape" v={st.dist == null ? "—" : fmt(st.dist, 3)} sub="mean NN" />
        <Stat k="Precision" v={done ? pct(st.precision) : "—"} sub="fidelity" />
        <Stat k="Recall" v={done ? pct(st.recall) : "—"} sub="coverage" />
        <Note>{done ? "k-NN precision / recall (Kynkäänniemi et al. 2019) against held-out points of the true shape." : mode === "generate" ? "Precision and recall are measured once the sample is finished." : "Precision and recall are measured on finished samples."}</Note>
      </div>
    </Panel>
  );
}

/* ——— bottom: schedule and timeline ——— */

function ScheduleChart() {
  const schedule = useLab((s) => s.schedule);
  const steps = useLab((s) => s.steps);
  const mode = useLab((s) => s.mode);
  const t = useLab((s) => s.stats.t);
  const W = 600;
  const H = 54;
  // generation reads left to right from noise to data; the forward view the other way round
  const xOf = (tt: number) => (mode === "generate" ? ((T - 1 - tt) / (T - 1)) * W : (tt / (T - 1)) * W);
  const { sig, noi } = useMemo(() => {
    const ab = alphaBars(schedule);
    const pts = (f: (a: number) => number) => {
      const out: string[] = [];
      for (let tt = 0; tt < T; tt += 4) out.push(`${xOf(tt).toFixed(1)},${(H - 4 - f(ab[tt]) * (H - 8)).toFixed(1)}`);
      return out.join(" ");
    };
    return { sig: pts((a) => Math.sqrt(a)), noi: pts((a) => Math.sqrt(1 - a)) };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [schedule, mode]);
  const ticks = useMemo(() => (mode === "generate" && steps <= 100 ? timesteps(steps) : []), [steps, mode]);
  const tx = t < 0 ? xOf(0) : xOf(t);
  const ab = t < 0 ? 1 : alphaBars(schedule)[t];
  return (
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="h-[54px] w-full" aria-hidden>
      <polyline points={noi} fill="none" stroke="rgba(255,255,255,.28)" strokeWidth="1.25" strokeDasharray="3 3" vectorEffect="non-scaling-stroke" />
      <polyline points={sig} fill="none" stroke={ACCENT} strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
      {ticks.map((tt) => (
        <line key={tt} x1={xOf(tt)} x2={xOf(tt)} y1={H - 3} y2={H} stroke="rgba(255,255,255,.35)" strokeWidth="1" vectorEffect="non-scaling-stroke" />
      ))}
      <line x1={tx} x2={tx} y1={0} y2={H} stroke="rgba(255,255,255,.55)" strokeWidth="1" vectorEffect="non-scaling-stroke" />
      <circle cx={tx} cy={H - 4 - Math.sqrt(ab) * (H - 8)} r="2.6" fill={ACCENT} />
      <circle cx={tx} cy={H - 4 - Math.sqrt(1 - ab) * (H - 8)} r="2.6" fill="rgba(255,255,255,.7)" />
    </svg>
  );
}

function Timeline() {
  const mode = useLab((s) => s.mode);
  const cursor = useLab((s) => s.cursor);
  const snaps = useLab((s) => s.snaps);
  const avail = useLab((s) => s.avail);
  const fwd = useLab((s) => s.fwd);
  const playing = useLab((s) => s.playing);
  const set = useLab((s) => s.set);
  const gen = mode === "generate";
  const max = gen ? snaps : 1000;
  const value = gen ? cursor : fwd;
  const computed = gen && snaps ? Math.max(0, avail - 1) / snaps : 1;
  const toggle = () => {
    if (playing) return set({ playing: false });
    if (gen) set(cursor >= snaps ? { cursor: 0, playing: true } : { playing: true });
    else set(fwd >= 1000 ? { fwd: 0, playing: true } : { playing: true });
  };
  return (
    <Panel className="w-full px-4 pb-3 pt-3">
      <div className="flex items-center gap-3">
        <Btn onClick={toggle} title={playing ? "Pause (space)" : "Play (space)"} className="w-10 shrink-0 !px-0">
          <svg width="14" height="14" viewBox="0 0 24 24" aria-hidden>
            {playing ? <path d="M7 5.5h3.5v13H7zM13.5 5.5H17v13h-3.5z" fill="currentColor" /> : <path d="M8 5.5v13l10.5-6.5z" fill="currentColor" />}
          </svg>
        </Btn>
        <div className="min-w-0 flex-1">
          <div className="relative">
            <ScheduleChart />
          </div>
          <div className="relative mt-1">
            {gen && <div className="pointer-events-none absolute left-0 top-1/2 h-[3px] -translate-y-1/2 rounded-full bg-white/[0.12]" style={{ width: `${computed * 100}%` }} />}
            <input
              type="range"
              min={0}
              max={max}
              step={gen ? 0.001 : 1}
              value={value}
              onChange={(e) => {
                const v = Number(e.target.value);
                set(gen ? { cursor: Math.min(v, Math.max(0, avail - 1)), playing: false } : { fwd: v, playing: false });
              }}
              className="lab-range relative w-full"
              aria-label={gen ? "Sampling progress" : "Noise level"}
            />
          </div>
          <div className="flex justify-between text-[10.5px] text-white/40" style={mono}>
            <span>{gen ? "x_T · pure noise" : "x₀ · training data"}</span>
            <span className="max-sm:hidden">
              <span style={{ color: ACCENT }}>━</span> signal √ᾱ <span className="ml-2 text-white/40">┅</span> noise √(1−ᾱ)
              {gen && <span className="ml-2">| steps</span>}
            </span>
            <span>{gen ? "x₀ · sample" : "x_T · pure noise"}</span>
          </div>
        </div>
      </div>
    </Panel>
  );
}

/* ——— help ——— */

function Help({ onClose }: { onClose: () => void }) {
  const particles = useLab((s) => s.particles);
  return (
    <div className="pointer-events-auto absolute inset-0 z-20 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm" onClick={onClose}>
      <Panel className="max-h-[86vh] w-[min(680px,100%)] overflow-y-auto p-6">
        <div onClick={(e) => e.stopPropagation()}>
          <p className="text-[10.5px] uppercase tracking-[0.18em]" style={{ ...mono, color: ACCENT }}>
            How it works
          </p>
          <h2 className="mt-2 text-[24px] font-semibold leading-tight text-white">A real diffusion sampler, small enough to see</h2>
          <div className="mt-4 space-y-4 text-[13.5px] leading-[1.65] text-white/70">
            <p>
              <b className="text-white">Every bead is one sample.</b> An image model draws a single point in a space with millions of dimensions. Here the space has three, so {fmt(particles)} independent samples show you the
              whole learned distribution at once, and you can watch it turn from a Gaussian blob into the shape you asked for.
            </p>
            <p>
              <b className="text-white">Forward process.</b> Training data is destroyed step by step: q(xₜ | x₀) = 𝒩(√ᾱₜ x₀, (1 − ᾱₜ) I). Switch to <i>Noise</i> to scrub it. It ends at exactly the noise the same seed&apos;s generation starts from.
            </p>
            <p>
              <b className="text-white">The model.</b> A network is trained to predict the noise, and the best possible prediction is the posterior mean E[x₀ | xₜ] (Tweedie&apos;s formula). For a finite training set that optimum has a closed
              form, a softmax over the training points, so this lab computes it exactly on the GPU against every training point, for every sample, at every step. No network approximates anything here. That is also why it
              memorises: shrink the training set and samples collapse onto the training points. Real models generalise precisely because they cannot fit this exact score.
            </p>
            <p>
              <b className="text-white">Samplers.</b> DDPM denoises and re-injects noise (stochastic). DDIM follows the deterministic probability-flow path. The same seed always gives the same sample. DPM-Solver++ (2M) is a
              second-order solver for that path, and reaches the same quality in a fraction of the steps. All three run on the same denoiser.
            </p>
            <p>
              <b className="text-white">Guidance.</b> Classifier-free guidance extrapolates from the unconditional prediction toward the conditional one: ε̂ = ε̂ᵤ + w(ε̂_c − ε̂ᵤ). At w = 1 you sample p(x | prompt) exactly. Above
              1, samples are pushed out of regions other prompts also explain, so they get sharper and less diverse. Watch recall drop as you turn it up.
            </p>
            <p>
              <b className="text-white">What the overlays mean.</b> <i>x̂₀</i> is the model&apos;s current guess of the finished sample: blurry at first, sharp near the end. <i>Trails</i> are the paths of 120 samples. DDIM&apos;s
              are smooth, DDPM&apos;s jitter. <i>Field</i> is the score ∇log pₜ(x) on a horizontal slice: the direction that makes the noisy data more likely.
            </p>
            <p className="text-white/45">
              Keys: space play / pause · R new seed · N noise view · 1–4 prompts, 0 none · ← → step · G x̂₀ · T trails · V field · ? help
            </p>
          </div>
          <div className="mt-5">
            <Btn onClick={onClose} active>
              Got it
            </Btn>
          </div>
        </div>
      </Panel>
    </div>
  );
}

export default function View() {
  const ready = useLab((s) => s.ready);
  const progress = useLab((s) => s.progress);
  const error = useLab((s) => s.error);
  const mode = useLab((s) => s.mode);
  const ghost = useLab((s) => s.ghost);
  const trails = useLab((s) => s.trails);
  const field = useLab((s) => s.field);
  const spin = useLab((s) => s.spin);
  const help = useLab((s) => s.help);
  const panel = useLab((s) => s.panel);
  const particles = useLab((s) => s.particles);
  const set = useLab((s) => s.set);

  // a fresh visit starts with a fresh run (the store outlives the page)
  useEffect(() => {
    useLab.getState().set({ ready: false, progress: 0, error: null, mode: "generate", playing: true, cursor: 0, help: false, panel: false });
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.closest?.("input, textarea, select") || e.metaKey || e.ctrlKey || e.altKey) return;
      const s = useLab.getState();
      const k = e.code;
      if (k === "Space") {
        if (s.playing) s.set({ playing: false });
        else if (s.mode === "generate") s.set(s.cursor >= s.snaps ? { cursor: 0, playing: true } : { playing: true });
        else s.set(s.fwd >= 1000 ? { fwd: 0, playing: true } : { playing: true });
      } else if (k === "KeyR") s.set({ seed: newSeed(), mode: "generate" });
      else if (k === "KeyN") s.set({ mode: s.mode === "generate" ? "forward" : "generate", playing: false });
      else if (k === "Digit0") s.set({ cls: -1 });
      else if (k >= "Digit1" && k <= "Digit4") s.set({ cls: Number(k.slice(5)) - 1 });
      else if (k === "KeyG") s.set({ ghost: !s.ghost });
      else if (k === "KeyT") s.set({ trails: !s.trails });
      else if (k === "KeyV") s.set({ field: !s.field });
      else if (k === "ArrowLeft" || k === "ArrowRight") {
        const d = k === "ArrowLeft" ? -1 : 1;
        if (s.mode === "generate") s.set({ playing: false, cursor: Math.max(0, Math.min(Math.max(0, s.avail - 1), Math.round(s.cursor) + d)) });
        else s.set({ playing: false, fwd: Math.max(0, Math.min(1000, Math.round(s.fwd) + d * 10)) });
      } else if (k === "Slash") s.set({ help: !s.help });
      else if (k === "Escape") s.set({ help: false, panel: false });
      else return;
      e.preventDefault();
    };
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  }, []);

  return (
    <div className="fixed inset-0 overflow-hidden bg-[#060709] text-white" style={sans}>
      <style>{`
        .lab-panel { animation: lab-panel .45s cubic-bezier(.2,.8,.2,1) both; }
        @keyframes lab-panel { from { opacity: 0; transform: translateY(6px) } }
        .lab-caret { animation: lab-caret 1.1s steps(1) infinite; }
        @keyframes lab-caret { 50% { opacity: 0 } }
        .lab-range { accent-color: ${ACCENT}; height: 18px; cursor: pointer; background: transparent; }
        .lab-range:disabled { cursor: not-allowed; }
        @media (prefers-reduced-motion: reduce) { .lab-panel, .lab-caret { animation: none } }
      `}</style>
      <div className="absolute inset-0">
        <Scene />
      </div>

      {ready && !error && (
        <div className="pointer-events-none absolute inset-0">
          {/* top bar */}
          <div className="absolute inset-x-0 top-0 flex items-start justify-between gap-2 px-4 pt-4">
            <div className="pointer-events-auto flex items-center gap-3">
              <Link href="/" className="flex h-9 items-center gap-1.5 rounded-md border border-white/[0.08] bg-[#0b0c0f]/80 px-3 text-[12.5px] font-medium text-white/70 backdrop-blur-md transition-colors hover:border-white/20 hover:text-white">
                ←<span className="max-sm:hidden">Portfolio</span>
              </Link>
              <div className="max-sm:hidden">
                <p className="text-[19px] font-semibold leading-none tracking-[-0.01em] text-white">Diffusion Lab</p>
                <p className="mt-1 text-[11.5px] text-white/40">Exact-score diffusion in 3-D · {fmt(particles)} samples</p>
              </div>
            </div>
            <div className="pointer-events-auto flex flex-wrap items-center justify-end gap-1.5">
              <div className="w-[196px]">
                <Seg
                  value={mode}
                  onChange={(v) => set({ mode: v, playing: false })}
                  options={[
                    { id: "generate", label: "Generate", title: "Reverse process: noise → sample" },
                    { id: "forward", label: "Noise", title: "Forward process: data → noise (N)" },
                  ]}
                />
              </div>
              <Btn onClick={() => set({ ghost: !ghost })} active={ghost} title="Show the model's prediction x̂₀ (G)">
                x̂₀
              </Btn>
              <Btn onClick={() => set({ trails: !trails })} active={trails} title="Sample trajectories (T)" className="max-sm:hidden">
                Trails
              </Btn>
              <Btn onClick={() => set({ field: !field })} active={field} title="Score field on the y = 0 slice (V)">
                Field
              </Btn>
              <Btn onClick={() => set({ spin: !spin })} active={spin} title="Auto-rotate" className="max-sm:hidden">
                ⟳
              </Btn>
              <Btn onClick={() => set({ panel: !panel })} active={panel} title="Settings" className="md:hidden">
                ⚙
              </Btn>
              <Btn onClick={() => set({ help: !help })} title="How it works (?)">
                ?
              </Btn>
            </div>
          </div>

          <div className={`absolute left-4 top-[76px] max-h-[calc(100%-200px)] overflow-y-auto pb-1 max-md:inset-x-4 max-md:top-[64px] max-md:max-h-[calc(100%-190px)] ${panel ? "" : "max-md:hidden"}`}>
            <PromptPanel />
          </div>
          <div className="absolute right-4 top-[76px] max-h-[calc(100%-200px)] overflow-y-auto pb-1 max-lg:hidden">
            <Readout />
          </div>
          <div className="absolute inset-x-4 bottom-4 md:left-[340px] lg:right-[316px]">
            <Timeline />
          </div>
        </div>
      )}

      {help && <Help onClose={() => set({ help: false })} />}

      {error && (
        <div className="absolute inset-0 flex items-center justify-center p-4">
          <Panel className="w-[min(440px,100%)] p-6">
            <p className="text-[10.5px] uppercase tracking-[0.18em] text-[#ffb020]" style={mono}>
              Not supported here
            </p>
            <p className="mt-2 text-[14px] leading-relaxed text-white/75">{error}</p>
            <Link href="/" className="mt-4 inline-flex h-9 items-center rounded-md bg-[#e8e9ec] px-3 text-[12.5px] font-medium text-[#0b0c0f]">
              Back to the portfolio
            </Link>
          </Panel>
        </div>
      )}

      {/* loader */}
      <div className={`pointer-events-none absolute inset-0 flex flex-col items-center justify-center bg-[#060709] transition-opacity duration-700 ${ready || error ? "opacity-0" : "opacity-100"}`}>
        <p className="text-[12px] text-white/40">Diffusion Lab</p>
        <p className="mt-1 text-[30px] font-semibold leading-none tracking-[-0.02em] text-white">Sampling the training sets</p>
        <div className="mt-6 h-px w-56 overflow-hidden bg-white/10">
          <div className="h-full transition-[width] duration-300" style={{ width: `${progress * 100}%`, background: ACCENT }} />
        </div>
      </div>
    </div>
  );
}
