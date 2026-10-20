"use client";

import Link from "next/link";
import { getLab } from "../lab";
import { STAGES } from "../story";
import { useVoice } from "../store";
import { record } from "./Controls";

/** start the story from the top: the title card goes, the camera walks in from the door */
export function begin() {
  useVoice.getState().set({ intro: false, stage: 0, p: 0, playing: true, follow: true, overview: false });
}

/** the title card: what this is, in one line, over the studio seen from its door */
export default function Intro({ leaving }: { leaving: boolean }) {
  const model = useVoice((s) => s.model);
  const set = useVoice((s) => s.set);
  const m = getLab()?.manifest;
  const mb = (m?.bytes ?? 0) / 1e6;
  return (
    <div className={`dl-intro pointer-events-none absolute inset-0 ${leaving ? "out" : ""}`}>
      <div className="dl-intro-shade absolute inset-0" />
      <header className="pointer-events-auto absolute inset-x-0 top-0 flex items-center justify-between px-[clamp(16px,4vw,48px)] pt-[clamp(16px,3vh,32px)]">
        <Link href="/" className="dl-link">
          ← Portfolio
        </Link>
        <button type="button" className="dl-link" onClick={() => set({ method: true })}>
          Method
        </button>
      </header>

      <section className="pointer-events-auto absolute bottom-[clamp(28px,8vh,96px)] left-[clamp(16px,6vw,96px)] right-4 max-w-[780px]">
        <p className="dl-kicker">Whisper tiny.en · running on your GPU</p>
        <h1 className="dl-hero mt-6">
          <span className="line">
            <span>Speech,</span>
          </span>
          <span className="line">
            <span>
              <em>becoming text.</em>
            </span>
          </span>
        </h1>
        <p className="dl-lede mt-6">
          Follow John F. Kennedy&apos;s voice, or your own, from air pressure to words: a voice detector, a Fourier transform, the log-mel spectrogram, and OpenAI&apos;s real Whisper network, computed in this tab down to the
          moment each word was said.
        </p>
        <div className="dl-cta-row mt-8 flex flex-wrap items-center gap-4">
          <button type="button" className="dl-cta" onClick={begin}>
            Begin with JFK, 1961
            <span aria-hidden>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
                <path d="M5 12h14M13 6l6 6-6 6" />
              </svg>
            </span>
          </button>
          <button
            type="button"
            className="vx-speak !h-[52px] !px-6"
            onClick={() => {
              begin();
              record();
            }}
          >
            <span className="vx-rec" aria-hidden />
            Use my microphone
          </button>
        </div>
        <div className="dl-facts mt-10 max-sm:hidden">
          <div>
            <b>{String(STAGES.length).padStart(2, "0")}</b>
            <span>stages</span>
          </div>
          <div>
            <b>{m ? `${(m.params / 1e6).toFixed(1)} M` : "—"}</b>
            <span>real Whisper weights</span>
          </div>
          <div>
            <b>{model.ready ? `${mb.toFixed(1)} MB` : `${Math.round(model.progress * 100)}%`}</b>
            <span>{model.ready ? "loaded on your GPU" : `of ${mb.toFixed(1)} MB streaming in`}</span>
          </div>
          <div>
            <b>0</b>
            <span>bytes of audio uploaded</span>
          </div>
        </div>
      </section>

      <p className="dl-mono absolute bottom-[clamp(28px,8vh,96px)] right-[clamp(16px,4vw,48px)] text-[10px] uppercase tracking-[0.2em] text-[var(--fg-4)] max-lg:hidden">
        press <kbd>space</kbd> to begin
      </p>
    </div>
  );
}
