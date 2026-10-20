"use client";

import "katex/dist/katex.min.css";
import "./ui/pipeline.css";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { loadAssets } from "./assets";
import { Lab, getLab, setLab, DENOISE } from "./lab";
import { STAGES } from "./story";
import { stepCursor, useLab } from "./store";
import { Taesd } from "./taesd-gl";
import Controls, { RunSummary, generate, newSeed } from "./ui/Controls";
import Inspector from "./ui/Inspector";
import Intro, { begin } from "./ui/Intro";
import Method from "./ui/Method";
import Transport from "./ui/Transport";

const Scene = dynamic(() => import("./scene/Scene"), { ssr: false });

let booting: Promise<void> | null = null;

/** fetch the weights and latents, fit the denoiser, start the first run — once per page load */
function boot() {
  const set = useLab.getState().set;
  if (getLab()) return Promise.resolve();
  return (booting ??= (async () => {
    if (!Taesd.supported()) throw new Error("This page needs WebGL 2 with float render targets (EXT_color_buffer_float), which this browser doesn't offer.");
    const assets = await loadAssets((f) => set({ progress: 0.05 + f * 0.75 }));
    set({ progress: 0.85 });
    // let the loader paint before the fit blocks the thread for a moment
    await new Promise((r) => setTimeout(r, 40));
    const lab = new Lab(assets);
    setLab(lab);
    if (process.env.NODE_ENV !== "production") Object.assign(window, { __sd: lab, __sdStore: useLab });
    set({ status: "ready", progress: 1 });
    generate("tokens");
    // the sampler runs behind the title card; the story waits for it to be dismissed
    set({ stage: 0, p: 0, playing: !useLab.getState().intro });
  })().catch((e: Error) => set({ status: "error", error: e.message })));
}

function useKeys() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.closest?.("input, textarea, select") || e.metaKey || e.ctrlKey || e.altKey) return;
      const s = useLab.getState();
      if (s.status !== "ready") return;
      const k = e.code;
      if (s.intro && !s.method) {
        if (k === "Space" || k === "Enter") {
          begin();
          e.preventDefault();
        }
        return;
      }
      if (k === "Space") s.set(s.playing ? { playing: false } : s.stage === STAGES.length - 1 && s.p >= 1 ? { stage: 0, p: 0, playing: true } : { playing: true, follow: true });
      else if (k === "KeyR") {
        s.set({ seed: newSeed() });
        generate();
      } else if (k === "KeyO") s.set({ overview: !s.overview, follow: true });
      else if (k === "KeyF") s.set({ follow: !s.follow });
      else if (k === "KeyM") s.set({ method: !s.method });
      else if (k === "Escape") s.set({ method: false, panel: false });
      else if (k === "ArrowLeft" || k === "ArrowRight") {
        const d = k === "ArrowLeft" ? -1 : 1;
        const computed = getLab()?.run?.steps.length ?? 0;
        if (s.stage === DENOISE) {
          // step by step inside the loop, stage by stage outside it
          const c = Math.round(stepCursor(s.p, s.steps)) + d;
          if (c >= 0 && c <= Math.min(computed, s.steps)) return void (s.set({ p: c / s.steps, playing: false, follow: true }), e.preventDefault());
        }
        const i = Math.max(0, Math.min(STAGES.length - 1, s.stage + d));
        if (i > DENOISE && computed < s.steps) return;
        s.set({ stage: i, p: d < 0 && i === DENOISE ? 1 : 0, playing: false, follow: true, overview: false });
      } else return;
      e.preventDefault();
    };
    const regen = () => {
      useLab.getState().set({ seed: newSeed() });
      generate();
    };
    addEventListener("keydown", onKey);
    addEventListener("dl:regenerate", regen);
    return () => {
      removeEventListener("keydown", onKey);
      removeEventListener("dl:regenerate", regen);
    };
  }, []);
}

export default function View() {
  const status = useLab((s) => s.status);
  const progress = useLab((s) => s.progress);
  const error = useLab((s) => s.error);
  const follow = useLab((s) => s.follow);
  const overview = useLab((s) => s.overview);
  const method = useLab((s) => s.method);
  const panel = useLab((s) => s.panel);
  const intro = useLab((s) => s.intro);
  const set = useLab((s) => s.set);
  const header = useRef<HTMLElement>(null);
  const left = useRef<HTMLElement>(null);
  const right = useRef<HTMLElement>(null);
  const bottom = useRef<HTMLDivElement>(null);
  const summary = useRef<HTMLDivElement>(null);
  // below lg the stage card is a sheet you open
  const [sheet, setSheet] = useState(false);
  // the title card stays mounted while it fades out (it only ever goes away)
  const [card, setCard] = useState(true);
  useEffect(() => {
    if (intro) return;
    const t = setTimeout(() => setCard(false), 800);
    return () => clearTimeout(t);
  }, [intro]);
  useKeys();

  useEffect(() => {
    void boot();
  }, []);

  const ready = status === "ready";

  // tell the camera which part of the screen the panels cover
  useEffect(() => {
    if (!ready) return;
    const measure = () => {
      const W = innerWidth;
      const H = innerHeight;
      const vis = (el: HTMLElement | null) => (el && el.offsetParent !== null ? el.getBoundingClientRect() : null);
      const l = vis(left.current);
      const r = vis(right.current);
      const h = vis(header.current);
      const b = vis(bottom.current);
      const sum = vis(summary.current);
      const narrow = W < 768;
      useLab.getState().set({
        insets: {
          left: l && !narrow ? l.right + 8 : 0,
          right: r ? W - r.left + 8 : 0,
          top: Math.max(h ? h.bottom + 4 : 0, sum ? sum.bottom + 6 : 0),
          bottom: b ? H - b.top + 4 : 0,
        },
      });
    };
    measure();
    const ro = new ResizeObserver(measure);
    for (const el of [left.current, right.current, header.current, bottom.current, summary.current]) if (el) ro.observe(el);
    addEventListener("resize", measure);
    return () => {
      ro.disconnect();
      removeEventListener("resize", measure);
    };
  }, [ready, panel, intro]);
  return (
    <div className="dl fixed inset-0 overflow-hidden bg-[var(--bg)]">
      <div className="absolute inset-0">
        <Scene />
      </div>
      <div className="dl-grain pointer-events-none absolute inset-0" />

      {ready && !intro && (
        <div className="pointer-events-none absolute inset-0">
          <div className="dl-scrim-top absolute inset-x-0 top-0 h-[140px]" />
          <div className="dl-scrim-bottom absolute inset-x-0 bottom-0 h-[150px]" />
          {/* masthead */}
          <header ref={header} className="absolute inset-x-0 top-0 flex items-start justify-between gap-3 px-5 pt-4">
            <div className="pointer-events-auto flex items-center gap-5">
              <Link href="/" className="dl-btn" aria-label="Back to the portfolio">
                ← <span className="max-sm:hidden">Portfolio</span>
              </Link>
              <div className="max-sm:hidden">
                <h1 className="font-[family-name:var(--display)] text-[27px] leading-none tracking-[-0.01em] text-[var(--fg)]">
                  Stable Diffusion, <i>end to end</i>
                </h1>
                <p className="dl-mono mt-1.5 text-[10px] uppercase tracking-[0.16em] text-[var(--fg-4)]">SD 1.5 at its real shapes · computed in your browser</p>
              </div>
            </div>
            <div className="pointer-events-auto flex items-center gap-1.5">
              <button type="button" className="dl-btn" aria-pressed={overview} onClick={() => set({ overview: !overview, follow: true })} title="Whole pipeline (O)">
                Overview
              </button>
              <button type="button" className="dl-btn max-sm:hidden" aria-pressed={follow} onClick={() => set({ follow: !follow })} title="Camera follows the stage (F)">
                Follow
              </button>
              <button type="button" className="dl-btn lg:hidden" aria-pressed={sheet} onClick={() => setSheet(!sheet)}>
                Details
              </button>
              <button type="button" className="dl-btn" onClick={() => set({ method: true })} title="What runs and what stands in (M)">
                Method
              </button>
            </div>
          </header>

          {panel ? (
            <aside ref={left} className="pointer-events-auto absolute left-5 top-[84px] bottom-[104px] w-[310px] max-md:inset-x-4 max-md:w-auto">
              <Controls />
            </aside>
          ) : (
            <div ref={summary} className="pointer-events-auto absolute left-5 top-[84px] max-md:hidden">
              <RunSummary />
            </div>
          )}
          {!panel && (
            <button type="button" className="dl-btn pointer-events-auto absolute left-4 top-[78px] md:hidden" onClick={() => set({ panel: true })}>
              Settings
            </button>
          )}
          <aside ref={right} className="pointer-events-auto absolute right-5 top-[84px] bottom-[104px] w-[384px] max-lg:hidden">
            <Inspector />
          </aside>
          {sheet && (
            <div className="pointer-events-auto absolute inset-x-4 bottom-[100px] lg:hidden">
              <Inspector className="max-h-[56vh]" />
            </div>
          )}
          <div ref={bottom} className="pointer-events-auto absolute inset-x-5 bottom-3">
            <Transport />
          </div>
        </div>
      )}

      {ready && card && <Intro leaving={!intro} />}

      {method && <Method />}

      {status === "error" && (
        <div className="absolute inset-0 flex items-center justify-center p-4">
          <div className="dl-card w-[min(460px,100%)] p-6">
            <p className="dl-eyebrow text-[var(--time)]">Not supported here</p>
            <p className="dl-prose mt-3">{error}</p>
            <Link href="/" className="dl-btn mt-5">
              Back to the portfolio
            </Link>
          </div>
        </div>
      )}

      {/* loader */}
      <div className={`pointer-events-none absolute inset-0 flex flex-col items-start justify-end bg-[var(--bg)] px-[clamp(16px,6vw,96px)] pb-[clamp(28px,8vh,96px)] transition-opacity duration-1000 ${ready || status === "error" ? "opacity-0" : "opacity-100"}`}>
        <div className="dl-grain absolute inset-0" />
        <p className="dl-kicker">Stable Diffusion, end to end</p>
        <p className="dl-loader-n mt-5">{String(Math.round(progress * 100)).padStart(2, "0")}</p>
        <p className="mt-4 font-[family-name:var(--display)] text-[clamp(22px,2.4vw,32px)] italic leading-none text-[var(--fg-2)]">
          {progress < 0.82 ? "Loading the decoder and latents" : "Fitting the denoiser"}
        </p>
        <div className="mt-6 h-px w-[min(420px,80vw)] overflow-hidden bg-[var(--line-2)]">
          <div className="h-full bg-[var(--accent)] transition-[width] duration-300" style={{ width: `${progress * 100}%` }} />
        </div>
        <p className="dl-mono mt-3 text-[10px] uppercase tracking-[0.16em] text-[var(--fg-4)]">TAESD weights 2.4 MB · 100 training latents 1.6 MB</p>
      </div>
    </div>
  );
}
