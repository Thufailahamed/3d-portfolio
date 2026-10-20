"use client";

import "katex/dist/katex.min.css";
import "@/diffusion/pipeline/ui/pipeline.css";
import "./ui/voice.css";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Lab, getLab, setLab } from "./lab";
import { STAGES } from "./story";
import { useVoice } from "./store";
import { WhisperGL } from "./whisper/gl";
import Controls, { RunSummary, record } from "./ui/Controls";
import Inspector from "./ui/Inspector";
import Intro, { begin } from "./ui/Intro";
import Method from "./ui/Method";
import Transport from "./ui/Transport";

const Scene = dynamic(() => import("./scene/Scene"), { ssr: false });

let booting: Promise<void> | null = null;

/** fetch the vocabulary and the sample, start the story, and let the weights stream in behind it */
function boot() {
  const set = useVoice.getState().set;
  if (getLab()) return Promise.resolve();
  return (booting ??= (async () => {
    if (!WhisperGL.supported()) throw new Error("This page runs Whisper on your GPU and needs WebGL 2 with float render targets (EXT_color_buffer_float), which this browser doesn't offer.");
    const lab = await Lab.boot();
    setLab(lab);
    if (process.env.NODE_ENV !== "production") Object.assign(window, { __voice: lab, __voiceStore: useVoice });
    set({ status: "ready" });
    lab.start({ ...lab.sample });
    // the run starts behind the title card; the story waits for it to be dismissed
    if (useVoice.getState().intro) set({ playing: false });
    void lab.loadModel();
  })().catch((e: Error) => set({ status: "error", error: e.message })));
}

function useKeys() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.closest?.("input, textarea, select") || e.metaKey || e.ctrlKey || e.altKey) return;
      const s = useVoice.getState();
      if (s.status !== "ready") return;
      const lab = getLab();
      const k = e.code;
      if (s.intro && !s.method) {
        if (k === "Space" || k === "Enter") {
          begin();
          e.preventDefault();
        }
        return;
      }
      if (k === "Space") s.set(s.playing ? { playing: false } : s.stage === STAGES.length - 1 && s.p >= 1 ? { stage: 0, p: 0, playing: true } : { playing: true, follow: true });
      else if (k === "KeyR") record();
      else if (k === "KeyL") {
        if (s.listening) lab?.stopListening();
        else lab?.listen();
      }
      else if (k === "KeyO") s.set({ overview: !s.overview, follow: true });
      else if (k === "KeyF") s.set({ follow: !s.follow });
      else if (k === "KeyM") s.set({ method: !s.method });
      else if (k === "Escape") s.set({ method: false, panel: false });
      else if (k === "ArrowLeft" || k === "ArrowRight") {
        if (lab?.live) return;
        const i = Math.max(0, Math.min(STAGES.length - 1, s.stage + (k === "ArrowLeft" ? -1 : 1)));
        s.set({ stage: i, p: 0, playing: false, follow: true, overview: false });
      } else return;
      e.preventDefault();
    };
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  }, []);
}

function ModelChip() {
  const model = useVoice((s) => s.model);
  const bytes = getLab()?.manifest.bytes ?? 0;
  if (model.error) return <span className="vx-chip !text-[var(--time)]">weights: {model.error}</span>;
  if (model.ready)
    return (
      <span className="vx-chip max-md:hidden">
        <i className="led" />
        Whisper tiny.en · on your GPU
      </span>
    );
  return (
    <span className="vx-chip" title="The model streams in while the story starts">
      weights {((model.progress * bytes) / 1e6).toFixed(1)} / {(bytes / 1e6).toFixed(1)} MB
      <i>
        <b style={{ width: `${model.progress * 100}%` }} />
      </i>
    </span>
  );
}

export default function View() {
  const status = useVoice((s) => s.status);
  const error = useVoice((s) => s.error);
  const follow = useVoice((s) => s.follow);
  const overview = useVoice((s) => s.overview);
  const method = useVoice((s) => s.method);
  const panel = useVoice((s) => s.panel);
  const intro = useVoice((s) => s.intro);
  const mic = useVoice((s) => s.mic);
  const set = useVoice((s) => s.set);
  const header = useRef<HTMLElement>(null);
  const left = useRef<HTMLElement>(null);
  const right = useRef<HTMLElement>(null);
  const bottom = useRef<HTMLDivElement>(null);
  const summary = useRef<HTMLDivElement>(null);
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
    return () => getLab()?.stopListening();
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
      useVoice.getState().set({
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

  const onAir = mic === "calibrating" || mic === "listening" || mic === "speech";
  return (
    <div className="dl vx fixed inset-0 overflow-hidden bg-[var(--bg)]">
      <div className="absolute inset-0">
        <Scene />
      </div>
      <div className="dl-grain pointer-events-none absolute inset-0" />

      {ready && !intro && (
        <div className="pointer-events-none absolute inset-0">
          <div className="dl-scrim-top absolute inset-x-0 top-0 h-[140px]" />
          <div className="dl-scrim-bottom absolute inset-x-0 bottom-0 h-[150px]" />
          <header ref={header} className="absolute inset-x-0 top-0 flex items-start justify-between gap-3 px-5 pt-4">
            <div className="pointer-events-auto flex items-center gap-5">
              <Link href="/" className="dl-btn" aria-label="Back to the portfolio">
                ← <span className="max-sm:hidden">Portfolio</span>
              </Link>
              <div className="max-sm:hidden">
                <h1 className="flex items-center gap-3 font-[family-name:var(--display)] text-[19px] font-semibold uppercase leading-none tracking-[-0.01em] text-[var(--fg)] [font-stretch:125%]">
                  Whisper, end to end
                  <span className={`vx-onair ${onAir ? "on" : ""}`}>ON AIR</span>
                </h1>
                <p className="dl-mono mt-2 text-[10px] uppercase tracking-[0.16em] text-[var(--fg-4)]">your voice to text · OpenAI&apos;s real tiny.en weights · computed in your browser</p>
              </div>
            </div>
            <div className="pointer-events-auto flex items-center gap-1.5">
              <ModelChip />
              <button type="button" className="dl-btn" aria-pressed={overview} onClick={() => set({ overview: !overview, follow: true })} title="Whole pipeline (O)">
                Overview
              </button>
              <button type="button" className="dl-btn max-sm:hidden" aria-pressed={follow} onClick={() => set({ follow: !follow })} title="Camera follows the stage (F)">
                Follow
              </button>
              <button type="button" className="dl-btn lg:hidden" aria-pressed={sheet} onClick={() => setSheet(!sheet)}>
                Details
              </button>
              <button type="button" className="dl-btn" onClick={() => set({ method: true })} title="What runs, and how it was checked (M)">
                Method
              </button>
            </div>
          </header>

          {panel ? (
            <aside ref={left} className="pointer-events-auto absolute bottom-[104px] left-5 top-[84px] w-[310px] max-md:inset-x-4 max-md:w-auto">
              <Controls />
            </aside>
          ) : (
            <div ref={summary} className="pointer-events-auto absolute left-5 top-[84px] max-md:hidden">
              <RunSummary />
            </div>
          )}
          {!panel && (
            <button type="button" className="dl-btn pointer-events-auto absolute left-4 top-[78px] md:hidden" onClick={() => set({ panel: true })}>
              Input
            </button>
          )}
          <aside ref={right} className="pointer-events-auto absolute bottom-[104px] right-5 top-[84px] w-[390px] max-lg:hidden">
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

      <div className={`pointer-events-none absolute inset-0 flex flex-col items-start justify-end bg-[var(--bg)] px-[clamp(16px,6vw,96px)] pb-[clamp(28px,8vh,96px)] transition-opacity duration-1000 ${ready || status === "error" ? "opacity-0" : "opacity-100"}`}>
        <div className="dl-grain absolute inset-0" />
        <p className="dl-kicker">Whisper, end to end</p>
        <p className="dl-loader-n mt-5 uppercase">Setting up the studio</p>
        <p className="dl-mono mt-5 text-[10px] uppercase tracking-[0.16em] text-[var(--fg-4)]">vocabulary 0.4 MB · sample 0.35 MB · then 48.7 MB of weights, in the background</p>
      </div>
    </div>
  );
}
