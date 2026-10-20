"use client";

import { useVoice } from "../store";

const REFS = [
  ["Radford, Kim, Xu, Brockman, McLeavey & Sutskever", "Robust Speech Recognition via Large-Scale Weak Supervision", "ICML 2023 · github.com/openai/whisper"],
  ["Sohn, Kim & Sung", "A Statistical Model-Based Voice Activity Detection", "IEEE Signal Processing Letters 6(1), 1999"],
  ["Ephraim & Malah", "Speech Enhancement Using a Minimum Mean-Square Error Short-Time Spectral Amplitude Estimator", "IEEE Trans. ASSP 32(6), 1984"],
  ["Vaswani et al.", "Attention Is All You Need", "NeurIPS 2017"],
  ["Hendrycks & Gimpel", "Gaussian Error Linear Units (GELUs)", "2016"],
  ["Slaney", "Auditory Toolbox, version 2", "Interval Research Technical Report, 1998"],
  ["Kaiser", "Nonrecursive Digital Filter Design Using the I₀-sinh Window Function", "IEEE ISCAS 1974"],
  ["Sakoe & Chiba", "Dynamic Programming Algorithm Optimization for Spoken Word Recognition", "IEEE Trans. ASSP 26(1), 1978"],
  ["Gerganov et al.", "whisper.cpp (the q8_0 block format; the JFK test clip)", "github.com/ggerganov/whisper.cpp"],
];

/** measured by scripts/voice/check.mjs (CPU) and gpu.mjs (WebGL on an Intel integrated GPU, ANGLE / D3D11) on the JFK clip */
const CHECKS = [
  ["400-point FFT vs a direct DFT", "max error 1.1 × 10⁻¹⁴ of the peak bin"],
  ["mel filterbank vs OpenAI's mel_filters.npz", "max |Δ| 1.9 × 10⁻⁹"],
  ["log-mel [80 × 3000] vs an independent direct-DFT front end", "max |Δ| 1.2 × 10⁻⁷"],
  ["shipped encoder weights vs the checkpoint", "identical (fp16)"],
  ["WebGL encoder vs a float32 CPU encoder", "relative RMS error 1.7 × 10⁻⁶"],
  ["int8 decoder: tokens vs the float32 model's argmax", "25 / 25 and 28 / 28 (with timestamps)"],
  ["WebGL decoder vs the CPU decoder", "identical tokens and word times"],
];

export default function Method() {
  const set = useVoice((s) => s.set);
  return (
    <div className="pointer-events-auto fixed inset-0 z-30 flex items-start justify-center overflow-y-auto bg-black/65 p-4 backdrop-blur-sm md:p-10" onClick={() => set({ method: false })}>
      <article className="dl-card w-[min(780px,100%)]" onClick={(e) => e.stopPropagation()}>
        <div className="dl-head">
          <p className="dl-eyebrow">Method</p>
          <button type="button" className="dl-btn !h-7" onClick={() => set({ method: false })}>
            Close <kbd>esc</kbd>
          </button>
        </div>
        <div className="dl-section !px-6 !py-6">
          <h2 className="dl-title !text-[34px]">Nothing here stands in</h2>
          <p className="dl-prose mt-4 max-w-[62ch]">
            Every number on this page is computed in your browser from the audio you give it. The model is OpenAI&apos;s <b>Whisper tiny.en</b>, converted from the original checkpoint (37.2 M parameters,
            sha256 d3dd57d3…) and run as WebGL shaders on your GPU. Your recording never leaves the page.
          </p>
        </div>

        <div className="grid md:grid-cols-2">
          <section className="dl-section !px-6 md:border-r md:border-[var(--line)]">
            <p className="dl-label">
              <span className="text-[var(--accent)]">computed live</span>
            </p>
            <ul className="dl-prose space-y-2.5 !text-[13.5px]">
              <li>
                <b>Voice detection.</b> Sohn&apos;s likelihood-ratio test with decision-directed a-priori SNR, noise re-estimated in silence, hysteresis and a 200 ms hangover; it also ends the recording.
              </li>
              <li>
                <b>Front end.</b> whisper/audio.py exactly: 16 kHz, 16-bit grid, 30 s padding, centred 400-point STFT with a periodic Hann window, Slaney mel filters, log₁₀, 8-decade clamp, (x + 4) / 4.
              </li>
              <li>
                <b>Encoder.</b> Both convolutions, sinusoidal positions, four pre-LN blocks with exact (erf) GELU, ln_post: the checkpoint&apos;s fp16 weights, computed in float32.
              </li>
              <li>
                <b>Decoder.</b> KV-cached, with decoding.py&apos;s rules: SuppressBlank, the 90 suppressed tokens, ApplyTimestampRules, p(&lt;|nospeech|&gt;), avg_logprob, and transcribe.py&apos;s temperature fallback.
              </li>
              <li>
                <b>Word times.</b> timing.py&apos;s find_alignment on the 8 alignment heads OpenAI lists for tiny.en, median filter, DTW, merge_punctuations.
              </li>
            </ul>
          </section>
          <section className="dl-section !px-6">
            <p className="dl-label">
              <span className="text-[var(--time)]">where it differs</span>
            </p>
            <ul className="dl-prose space-y-2.5 !text-[13.5px]">
              <li>
                <b>Decoder weights are int8,</b> in blocks of 32 with one scale each (whisper.cpp&apos;s q8_0), so the download is 49 MB instead of 75. The encoder is not quantised.
              </li>
              <li>
                <b>The resampler</b> follows ffmpeg&apos;s default design (Kaiser-windowed sinc, β = 9, cut-off 0.97) but is not bit-identical to it. Files arrive already decoded by the browser.
              </li>
              <li>
                <b>Greedy or sampled,</b> as whisper.transcribe() does by default. The command line&apos;s beam search (5 beams) and best-of-5 are not implemented.
              </li>
              <li>
                <b>One 30-second window.</b> No long-form loop or conditioning on previous text, so recordings stop at 30 s.
              </li>
              <li>
                <b>The detector is statistical,</b> not a neural VAD such as Silero, which many voice agents use. Whisper has no VAD of its own; its &lt;|nospeech|&gt; probability is shown at the decoder.
              </li>
            </ul>
          </section>
        </div>

        <section className="dl-section !px-6">
          <p className="dl-label">
            <span>verification</span>
            <span>scripts/voice/check.mjs, gpu.mjs</span>
          </p>
          <dl className="dl-kv">
            {CHECKS.map(([k, v]) => (
              <div key={k} className="contents">
                <dt>{k}</dt>
                <dd>{v}</dd>
              </div>
            ))}
          </dl>
          <p className="dl-small mt-3">
            On the JFK clip, with timestamp tokens (the default here) the page writes &ldquo;And so my fellow Americans ask not what your country can do for you ask what you can do for your country.&rdquo; in two
            segments, 0–8 s and 8–11 s (avg log p −0.285); with &lt;|notimestamps|&gt;, &ldquo;… can do for you, ask what you can do …&rdquo; (−0.130). p(&lt;|nospeech|&gt;) is 0.029 either way.
          </p>
        </section>

        <section className="dl-section !px-6">
          <p className="dl-label">
            <span>things to try</span>
          </p>
          <ul className="dl-prose list-disc space-y-1.5 pl-5 !text-[13.5px]">
            <li>Speak, then stay quiet: the lamp goes out after the hangover and the recorder stops by itself.</li>
            <li>Watch the spectrum at card 04 while you say &ldquo;ssss&rdquo; and then &ldquo;oooo&rdquo;: noise above 4 kHz against a ladder of harmonics.</li>
            <li>Set T = 1.0 and press New sample: the same audio, different text. Words with low probability change first.</li>
            <li>Upload music: p(&lt;|nospeech|&gt;) rises and Whisper may skip the window as silence.</li>
            <li>Click a word on the last card to hear it from where DTW put it.</li>
          </ul>
          <p className="dl-small mt-3">
            Keys: <kbd>space</kbd> play · <kbd>←</kbd>
            <kbd>→</kbd> stage · <kbd>R</kbd> record · <kbd>L</kbd> listen · <kbd>O</kbd> overview · <kbd>F</kbd> follow camera · <kbd>M</kbd> this sheet
          </p>
        </section>

        <section className="dl-section !px-6">
          <p className="dl-label">
            <span>references</span>
          </p>
          <ol className="space-y-1.5 text-[12px] leading-[1.45] text-[var(--fg-3)]">
            {REFS.map(([who, title, where], i) => (
              <li key={i} className="grid grid-cols-[22px_1fr] gap-1">
                <span className="dl-mono text-[var(--fg-4)]">{i + 1}</span>
                <span>
                  {who}. <i className="font-[family-name:var(--serif)] text-[13px] text-[var(--fg-2)]">{title}</i>. {where}.
                </span>
              </li>
            ))}
          </ol>
          <p className="dl-small mt-4">Whisper&apos;s code and weights are MIT-licensed by OpenAI. The JFK recording (1961) is in the public domain.</p>
        </section>
      </article>
    </div>
  );
}
