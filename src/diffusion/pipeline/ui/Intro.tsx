"use client";

import Link from "next/link";
import { TAESD } from "../sd15";
import { STAGES } from "../story";
import { useLab } from "../store";

/** start the story from the top: the title card goes, the camera flies in from the door */
export function begin() {
  useLab.getState().set({ intro: false, stage: 0, p: 0, playing: true, follow: true, overview: false });
}

/** the title card: what this is, in one line, over the hall seen from its door */
export default function Intro({ leaving }: { leaving: boolean }) {
  const steps = useLab((s) => s.steps);
  const set = useLab((s) => s.set);
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

      <section className="pointer-events-auto absolute bottom-[clamp(28px,8vh,96px)] left-[clamp(16px,6vw,96px)] right-4 max-w-[760px]">
        <p className="dl-kicker">Stable Diffusion 1.5 · a working exhibit</p>
        <h1 className="dl-hero mt-6">
          <span className="line">
            <span>From noise,</span>
          </span>
          <span className="line">
            <span>
              <em>an image.</em>
            </span>
          </span>
        </h1>
        <p className="dl-lede mt-6">
          Follow one prompt through every stage of a text-to-image model at its real shapes, from tokens to pixels: sampled out of Gaussian noise one step at a time, then developed by a real decoder running on your GPU.
          Each stage is marked as computed live or stood in for.
        </p>
        <div className="dl-cta-row mt-8 flex flex-wrap items-center gap-6">
          <button type="button" className="dl-cta" onClick={begin}>
            Begin the exhibit
            <span aria-hidden>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
                <path d="M5 12h14M13 6l6 6-6 6" />
              </svg>
            </span>
          </button>
          <button type="button" className="dl-link" onClick={() => set({ method: true })}>
            What runs live, and what stands in
          </button>
        </div>
        <div className="dl-facts mt-10 max-sm:hidden">
          <div>
            <b>{String(STAGES.length).padStart(2, "0")}</b>
            <span>stages</span>
          </div>
          <div>
            <b>{steps}</b>
            <span>sampler steps</span>
          </div>
          <div>
            <b>16,384</b>
            <span>latent numbers</span>
          </div>
          <div>
            <b>{(TAESD.decoderParams / 1e6).toFixed(2)} M</b>
            <span>decoder weights on your GPU</span>
          </div>
        </div>
      </section>

      <p className="dl-mono absolute bottom-[clamp(28px,8vh,96px)] right-[clamp(16px,4vw,48px)] text-[10px] uppercase tracking-[0.2em] text-[var(--fg-4)] max-lg:hidden">
        press <kbd>space</kbd> to begin
      </p>
    </div>
  );
}
