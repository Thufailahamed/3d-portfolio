"use client";

import { useMemo } from "react";
import { Eq, M } from "@/diffusion/pipeline/ui/Math";
import { BIN_HZ, HOP, N_BINS, N_FRAMES, N_SAMPLES, SAMPLE_RATE } from "../audio/frontend";
import { RESAMPLE, Resampler } from "../audio/resample";
import { VAD } from "../audio/vad";
import { FALLBACK, THRESHOLDS, getLab } from "../lab";
import { decoderStep, shownAttempt, tileText } from "../scene/Decoder";
import { STAGES, stageIndex } from "../story";
import { useVoice } from "../store";

const fmt = (v: number, d = 2) => v.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });
const int = (v: number) => Math.round(v).toLocaleString("en-US");
const db = (x: number) => (x > 0 ? 20 * Math.log10(x) : -Infinity);

type Badge = [string, "live" | "ref" | "stand"];

function Head({ i, badge }: { i: number; badge: Badge[] }) {
  return (
    <div className="dl-head">
      <p className="dl-eyebrow">
          <span className="dl-n">{String(i + 1).padStart(2, "0")}</span>
          {STAGES[i].title}
        </p>
      <div className="flex gap-1.5">
        {badge.map(([t, k]) => (
          <span key={t} className={`dl-badge ${k}`}>
            {t}
          </span>
        ))}
      </div>
    </div>
  );
}

/** a stage-local integer that changes rarely, so the card re-renders only when it does */
function useCursor(id: (typeof STAGES)[number]["id"], n: number) {
  return useVoice((s) => {
    const i = stageIndex(id);
    const t = s.stage > i ? 1 : s.stage < i ? 0 : s.p;
    return Math.min(n - 1, Math.max(0, Math.floor(Math.min(0.999, t) * n)));
  });
}

function ListenButton({ from = 0, label = "Listen" }: { from?: number; label?: string }) {
  const listening = useVoice((s) => s.listening);
  const lab = getLab();
  return (
    <button type="button" className="dl-btn !h-[30px]" onClick={() => (listening ? lab?.stopListening() : lab?.listen(from))}>
      {listening ? "Stop" : label}
      <span aria-hidden>{listening ? "■" : "▶"}</span>
    </button>
  );
}

function Sound() {
  const runId = useVoice((s) => s.run);
  const mic = useVoice((s) => s.mic);
  const lab = getLab();
  const r = lab?.run;
  const stats = useMemo(() => {
    if (!r) return null;
    const x = r.clip.raw.data;
    let pk = 0;
    let s = 0;
    for (const v of x) {
      pk = Math.max(pk, Math.abs(v));
      s += v * v;
    }
    return { peak: db(pk), rms: db(Math.sqrt(s / x.length)) };
  }, [r, runId]); // eslint-disable-line react-hooks/exhaustive-deps
  const live = !!lab?.live;
  return (
    <>
      <div className="dl-section">
        <h2 className="dl-title">Air pressure, as numbers</h2>
        <p className="dl-prose mt-3">
          Your voice is a pressure wave. The microphone&apos;s diaphragm follows it, and the sound card samples the voltage tens of thousands of times a second. What reaches this page is only a list of numbers between −1 and +1: no
          words, no syllables, not even pitch. Everything that follows is computed from these numbers.
        </p>
      </div>
      <div className="dl-section">
        <Eq n={1}>{"\\begin{aligned} x[n] &= x(n / f_s),\\quad n = 0,\\dots,N-1 \\\\ \\text{level} &= 20\\log_{10}|x|\\ \\text{dBFS} \\end{aligned}"}</Eq>
        <p className="dl-small mt-1">
          A man&apos;s voice repeats about every 8 ms (≈ 120 Hz), a woman&apos;s every 5 ms (≈ 210 Hz); at 48 kHz that is 240 to 400 samples per cycle.
        </p>
      </div>
      <div className="dl-section">
        {live ? (
          <p className="dl-prose">
            <b>Recording.</b> {mic === "calibrating" ? "Measuring the room's noise for 200 ms; stay quiet a moment." : "Speak; the recording stops by itself half a second after you finish."}
          </p>
        ) : (
          r &&
          stats && (
            <dl className="dl-kv">
              <dt>source</dt>
              <dd>{r.clip.name}</dd>
              <dt>sample rate</dt>
              <dd>{int(r.clip.raw.rate)} Hz</dd>
              <dt>samples · duration</dt>
              <dd>
                {int(r.clip.raw.data.length)} · {fmt(r.clip.raw.data.length / r.clip.raw.rate)} s
              </dd>
              <dt>peak · RMS</dt>
              <dd>
                {fmt(stats.peak, 1)} · {fmt(stats.rms, 1)} dBFS
              </dd>
            </dl>
          )
        )}
        {!live && r && (
          <div className="mt-3">
            <ListenButton />
          </div>
        )}
      </div>
    </>
  );
}

function Detect() {
  const lab = getLab();
  const r = lab?.run;
  const F = r?.vad.frames ?? 1;
  const f = useCursor("vad", F);
  const st = r?.vad.steps[f];
  const speechFrames = r?.vad.steps.filter((s) => s.speech).length ?? 0;
  return (
    <>
      <div className="dl-section">
        <h2 className="dl-title">Is anyone speaking?</h2>
        <p className="dl-prose mt-3">
          Before any model runs, a detector decides which 10 ms frames hold speech. It treats every frequency bin as Gaussian: either <b>noise alone</b>, with the power it has learned for that bin, or <b>speech plus noise</b>, and
          asks which explains the frame better. That is a likelihood-ratio test. The noise is learned from the first 200 ms and re-learned whenever the detector says silence.
        </p>
        <p className="dl-prose mt-2">
          This is how a voice assistant knows you have stopped talking: the recorder here closes 0.5 s after the detector does, and the silence it is sure of is never sent to Whisper.
        </p>
      </div>
      <div className="dl-section">
        <Eq n={2}>{"\\begin{aligned} \\gamma_k &= |X_k|^2 / \\lambda_N(k) \\\\ \\xi_k &= a\\,G_k'^2\\gamma_k' + (1-a)\\max(\\gamma_k - 1, 0) \\end{aligned}"}</Eq>
        <Eq n={3}>{"\\begin{aligned} \\log\\Lambda_k &= \\frac{\\gamma_k\\,\\xi_k}{1+\\xi_k} - \\log(1+\\xi_k) \\\\ \\ell &= \\tfrac{1}{K}\\textstyle\\sum_{k}\\log\\Lambda_k \\end{aligned}"}</Eq>
        <p className="dl-small mt-1">
          <M>{"\\gamma"}</M> is the a-posteriori SNR, <M>{"\\xi"}</M> the a-priori SNR by the decision-directed rule (<M>{`a = ${VAD.dd}`}</M>, primes are the previous frame, <M>{"G = \\xi/(1+\\xi)"}</M>). (3) is the
          log-ratio of the two complex Gaussians, averaged over K = {VAD.hi - VAD.lo + 1} bins from 120 Hz to 8 kHz.
        </p>
        <p className="dl-small mt-2">
          Decision: open when <M>{`\\ell > ${VAD.on}`}</M> for {VAD.onFrames} frames (a click is shorter), close after {VAD.hangover} frames below <M>{`${VAD.off}`}</M> (the hangover keeps word endings), pad segments by {VAD.pad * 10} ms.
        </p>
      </div>
      {r && (
        <div className="dl-section">
          <dl className="dl-kv">
            <dt>frame under the playhead</dt>
            <dd>
              {f} · {fmt((f * HOP) / SAMPLE_RATE)} s
            </dd>
            <dt>statistic ℓ</dt>
            <dd>{st?.calibrating ? "calibrating" : `${fmt(st?.llr ?? 0, 2)} nats/bin`}</dd>
            <dt>state</dt>
            <dd className={st?.speech ? "!text-[var(--accent)]" : ""}>{st?.speech ? "speech" : "silence"}</dd>
            <dt>speech frames</dt>
            <dd>
              {int(speechFrames)} / {int(F)} ({fmt((100 * speechFrames) / F, 0)}%)
            </dd>
            <dt>segments</dt>
            <dd>{r.vad.segments.map((s) => `${fmt((s.start * HOP) / SAMPLE_RATE)}–${fmt((s.end * HOP) / SAMPLE_RATE)}`).join(", ") || "none"}</dd>
            <dt>sent to Whisper</dt>
            <dd>
              {fmt(r.clip.trim[0] / SAMPLE_RATE)}–{fmt(r.clip.trim[1] / SAMPLE_RATE)} s
            </dd>
          </dl>
          <p className="dl-small mt-3">Whisper has a detector of its own as well: the probability of &lt;|nospeech|&gt; at its first step (card 07).</p>
        </div>
      )}
    </>
  );
}

function Resample() {
  const r = getLab()?.run;
  const rate = r?.clip.raw.rate ?? SAMPLE_RATE;
  const rs = new Resampler(rate, SAMPLE_RATE);
  const n = r?.clip.audio.length ?? 0;
  return (
    <>
      <div className="dl-section">
        <h2 className="dl-title">What Whisper expects</h2>
        <p className="dl-prose mt-3">
          Whisper was trained on 16 kHz audio, so it can only use frequencies up to 8 kHz (half the sample rate, Nyquist). A 48 kHz microphone must first lose everything above that, or those frequencies would fold back as{" "}
          <b>aliasing</b>. A windowed sinc is the ideal low-pass made finite; evaluating it at each new instant both filters and resamples. The result is rounded to 16-bit, as Whisper&apos;s ffmpeg loader does.
        </p>
        <p className="dl-prose mt-2">
          Then the window. Whisper always reads <b>30 seconds</b>: shorter audio is padded with zeros, so for one sentence most of what it sees is silence.
        </p>
      </div>
      <div className="dl-section">
        <Eq n={4}>{"\\begin{aligned} y[n] &= \\frac{\\sum_k x[k]\\,h\\!\\left(\\tfrac{n}{16000} - \\tfrac{k}{f_{\\mathrm{in}}}\\right)}{\\sum_k h(\\cdot)} \\\\ h(\\tau) &= \\mathrm{sinc}(2 f_c \\tau)\\,\\frac{I_0\\big(\\beta\\sqrt{1-(\\tau/T)^2}\\big)}{I_0(\\beta)} \\end{aligned}"}</Eq>
        <p className="dl-small mt-1">
          <M>{`f_c = ${RESAMPLE.cutoff} \\times 8\\,\\mathrm{kHz} = ${fmt(rs.fc / 1000, 2)}\\,\\mathrm{kHz}`}</M>, <M>{`\\beta = ${RESAMPLE.beta}`}</M>, <M>{`T = ${RESAMPLE.zeros}/16000\\,\\mathrm{s}`}</M>: ffmpeg&apos;s default design. Dividing by the
          taps&apos; sum makes a constant stay exactly constant.
        </p>
        <Eq n={5}>{"\\mathtt{N\\_SAMPLES} = 30 \\times 16\\,000 = 480\\,000"}</Eq>
      </div>
      {r && (
        <div className="dl-section">
          <dl className="dl-kv">
            <dt>in</dt>
            <dd>
              {int(rate)} Hz{rate === SAMPLE_RATE ? " (no resampling)" : ` · ${Math.round(2 * rs.T * rate)} taps per output sample`}
            </dd>
            <dt>speech kept</dt>
            <dd>
              {int(n)} samples · {fmt(n / SAMPLE_RATE)} s
            </dd>
            <dt>zeros added</dt>
            <dd>
              {int(N_SAMPLES - n)} · {fmt((N_SAMPLES - n) / SAMPLE_RATE)} s
            </dd>
            <dt>tensor</dt>
            <dd>[480 000] float32</dd>
          </dl>
        </div>
      )}
    </>
  );
}

function Stft() {
  const r = getLab()?.run;
  const F = Math.max(1, Math.min(r?.mel.powerFrames ?? 1, r?.mel.contentFrames ?? 1));
  const f = useCursor("stft", F);
  const peak = useMemo(() => {
    if (!r || f >= r.mel.powerFrames) return null;
    const P = r.mel.power.subarray(f * N_BINS, (f + 1) * N_BINS);
    let k = 0;
    let e = 0;
    for (let i = 0; i < N_BINS; i++) {
      e += P[i];
      if (P[i] > P[k]) k = i;
    }
    return { k, e };
  }, [r, f]);
  return (
    <>
      <div className="dl-section">
        <h2 className="dl-title">Which frequencies, when?</h2>
        <p className="dl-prose mt-3">
          A voice is a sum of vibrations: the vocal folds&apos; fundamental and its harmonics, shaped by the resonances of the mouth (the <b>formants</b>, which make an &ldquo;ee&rdquo; differ from an &ldquo;oo&rdquo;). A Fourier
          transform measures how much of each frequency a stretch of signal contains. Speech changes every few tens of milliseconds, so it is taken over short windows: 25 ms, every 10 ms.
        </p>
        <p className="dl-prose mt-2">
          Cutting a window out leaves sharp edges that smear energy across all frequencies. A <b>Hann window</b> tapers each frame to zero at both ends, which keeps the harmonics sharp.
        </p>
      </div>
      <div className="dl-section">
        <Eq n={6}>{"X_t[k] = \\sum_{n=0}^{399} x[160t + n - 200]\\, w[n]\\, e^{-2\\pi i\\,kn/400}"}</Eq>
        <Eq n={7}>{"\\begin{aligned} w[n] &= \\tfrac12 - \\tfrac12\\cos\\!\\big(2\\pi n/400\\big) \\\\ P_t[k] &= |X_t[k]|^2,\\quad k = 0,\\dots,200 \\end{aligned}"}</Eq>
        <p className="dl-small mt-1">
          Bin <M>{"k"}</M> is <M>{`${BIN_HZ}k`}</M> Hz. Frames are centred (200 samples of reflect padding each side) and the last is dropped, so 480 000 samples give exactly {int(N_FRAMES)} frames. 400 is not a power of two;
          the FFT here factors it as 4·4·5·5 (checked against a direct DFT to 10⁻¹⁴).
        </p>
      </div>
      {r && peak && (
        <div className="dl-section">
          <dl className="dl-kv">
            <dt>frame</dt>
            <dd>
              {f} of {F} · {fmt((f * HOP) / SAMPLE_RATE)} s
            </dd>
            <dt>strongest bin</dt>
            <dd>
              {peak.k} · {int(peak.k * BIN_HZ)} Hz
            </dd>
            <dt>frame energy Σ P</dt>
            <dd>{fmt(10 * Math.log10(peak.e + 1e-12), 1)} dB</dd>
            <dt>output</dt>
            <dd>[201, 3000] power</dd>
          </dl>
        </div>
      )}
    </>
  );
}

function MelCard() {
  const r = getLab()?.run;
  return (
    <>
      <div className="dl-section">
        <h2 className="dl-title">What an ear would keep</h2>
        <p className="dl-prose mt-3">
          We hear low frequencies finely and high ones coarsely: 100 to 200 Hz is an octave, 7 000 to 7 100 Hz is barely a change. The <b>mel scale</b> models this. Eighty triangular filters, evenly spaced in mel (linear
          below 1 kHz, logarithmic above), pool the 201 bins into 80 bands. Loudness is heard logarithmically too, so Whisper takes log₁₀, keeps 8 decades (80 dB) below the loudest value, and rescales to about −1 … 1.
        </p>
      </div>
      <div className="dl-section">
        <Eq n={8}>{"m(f) = \\begin{cases} 3f/200 & f < 1000 \\\\ 15 + 27\\,\\log_{6.4}(f/1000) & f \\ge 1000 \\end{cases}"}</Eq>
        <Eq n={9}>{"\\begin{aligned} \\mathrm{mel}_t[m] &= \\textstyle\\sum_k M[m,k]\\, P_t[k] \\\\ \\textstyle\\sum_k M[m,k]\\,\\Delta f &\\approx 1 \\end{aligned}"}</Eq>
        <Eq n={10}>{"\\begin{aligned} L &= \\log_{10}\\max(\\mathrm{mel}, 10^{-10}) \\\\ L &\\leftarrow \\max(L,\\ \\max L - 8) \\\\ \\tilde L &= (L + 4)/4 \\end{aligned}"}</Eq>
        <p className="dl-small mt-1">
          (8) is Slaney&apos;s mel scale (librosa&apos;s default), and M&apos;s triangles are scaled by <M>{"2/(f_{m+2}-f_m)"}</M> so each band has equal area. The filters here match OpenAI&apos;s mel_filters.npz to 2 × 10⁻⁹.
        </p>
      </div>
      {r && (
        <div className="dl-section">
          <dl className="dl-kv">
            <dt>loudest log₁₀ (this clip)</dt>
            <dd>{fmt(r.mel.maxLog, 3)}</dd>
            <dt>floor, after scaling</dt>
            <dd>{fmt((r.mel.maxLog - 4) / 4, 3)}</dd>
            <dt>frames of speech · padding</dt>
            <dd>
              {int(r.mel.contentFrames)} · {int(N_FRAMES - r.mel.contentFrames)}
            </dd>
            <dt>output</dt>
            <dd>[80, 3000] float32</dd>
          </dl>
        </div>
      )}
    </>
  );
}

function EncoderCard() {
  const enc = useVoice((s) => s.enc);
  const model = useVoice((s) => s.model);
  const lab = getLab();
  const r = lab?.run;
  const params = lab?.manifest.tensors.filter((t) => t.name.startsWith("encoder.")).reduce((a, t) => a + t.shape.reduce((x, y) => x * y, 1), 0) ?? 0;
  return (
    <>
      <div className="dl-section">
        <h2 className="dl-title">What the sound means</h2>
        <p className="dl-prose mt-3">
          The encoder is a transformer that reads the spectrogram. Two 1-D convolutions look at three frames at a time; the second steps by two, so 3 000 frames become <b>1 500 positions, 20 ms each</b>. Sinusoids add
          each position&apos;s place in time. Then four blocks of <b>self-attention</b>, where every position can draw on every other (heads learn to look at neighbours, at the same sound elsewhere, at the silence), each
          followed by an MLP.
        </p>
      </div>
      <div className="dl-section">
        <Eq n={11}>{"\\begin{aligned} h &= \\mathrm{GELU}(\\mathrm{conv}_2(\\mathrm{GELU}(\\mathrm{conv}_1\\tilde L))) + PE \\\\ PE_{t,i} &= \\begin{cases}\\sin(t\\,\\omega_i) & i < 192\\\\ \\cos(t\\,\\omega_{i-192}) & \\text{else}\\end{cases} \\end{aligned}"}</Eq>
        <Eq n={12}>{"\\begin{aligned} h &\\leftarrow h + \\mathrm{MHA}(\\mathrm{LN}(h)) \\\\ h &\\leftarrow h + W_2\\,\\mathrm{GELU}(W_1\\,\\mathrm{LN}(h)) \\end{aligned}"}</Eq>
        <Eq n={13}>{"\\begin{aligned} \\mathrm{Attn}(Q,K,V) &= \\mathrm{softmax}\\!\\big(QK^\\top/\\sqrt{64}\\big)\\,V \\\\ \\mathrm{GELU}(x) &= x\\,\\Phi(x) \\end{aligned}"}</Eq>
        <p className="dl-small mt-1">
          <M>{"\\omega_i = 10000^{-i/191}"}</M>; 6 heads of 64; LayerNorm before each sub-layer (pre-LN), and once more at the end (ln_post).
        </p>
      </div>
      <div className="dl-section">
        <dl className="dl-kv">
          <dt>parameters</dt>
          <dd>{(params / 1e6).toFixed(2)} M · fp16 as published</dd>
          <dt>layers · width · heads</dt>
          <dd>4 · 384 · 6</dd>
          <dt>status</dt>
          <dd>{!model.ready ? `loading weights ${Math.round(model.progress * 100)}%` : enc === "done" ? `${fmt(r?.ms.enc ?? 0, 0)} ms on this GPU` : enc}</dd>
          <dt>GPU</dt>
          <dd className="max-w-[210px] truncate">{lab?.model?.renderer.replace(/^ANGLE \(|\)$/g, "") ?? "—"}</dd>
        </dl>
        <p className="dl-small mt-3">The same encoder in float32 on the CPU (scripts/voice/check.mjs) agrees with this WebGL one to a relative error of 1.7 × 10⁻⁶.</p>
      </div>
    </>
  );
}

function DecoderCard() {
  const tokens = useVoice((s) => s.tokens);
  const dec = useVoice((s) => s.dec);
  const lab = getLab();
  const r = lab?.run ?? null;
  const a = shownAttempt(r);
  const n = a?.steps?.length ?? 0;
  const k = useVoice(() => decoderStep(n));
  const step = k >= 0 ? a?.steps[k] : undefined;
  void tokens;
  return (
    <>
      <div className="dl-section">
        <h2 className="dl-title">Which token comes next?</h2>
        <p className="dl-prose mt-3">
          Here Whisper is generative: it writes the transcript the way a language model writes text, <b>one token at a time</b>, each conditioned on the tokens so far (masked self-attention) and on the audio
          (cross-attention to the 1 500 features). It starts from &lt;|startoftranscript|&gt;; every step gives 51 864 scores, a softmax turns them into probabilities, and greedy decoding takes the most likely.
        </p>
        <p className="dl-prose mt-2">
          Whisper&apos;s rules sit on top: no blank first token, no non-speech symbols (♪, brackets, speaker tags), timestamps only in pairs and never going back, and a timestamp is forced when all timestamps together outweigh the
          best word. If the text looks broken, it is decoded again hotter.
        </p>
      </div>
      <div className="dl-section">
        <Eq n={14}>{"\\begin{aligned} p(y_i \\mid y_{<i}, \\text{audio}) &= \\mathrm{softmax}\\big(\\mathrm{LN}(h_i)\\,E^\\top + \\text{mask}\\big) \\\\ y_i &= \\arg\\max\\, p \\end{aligned}"}</Eq>
        <Eq n={15}>{"\\begin{aligned} \\overline{\\log p} &= \\tfrac{1}{n+1}\\textstyle\\sum_{i}\\log p(y_i) \\\\ \\text{ratio} &= |\\text{text}|\\,/\\,|\\mathrm{zlib}(\\text{text})| \\end{aligned}"}</Eq>
        <p className="dl-small mt-1">
          Retry at T = {FALLBACK.slice(1).join(", ")} if ratio &gt; {THRESHOLDS.compression} (repetition) or <M>{"\\overline{\\log p}"}</M> &lt; {THRESHOLDS.logprob}; <M>{"E"}</M>, the token embedding, is also the output layer.
        </p>
      </div>
      {step && lab && a && (
        <div className="dl-section">
          <p className="dl-label">
            <span>step {k + 1}</span>
            <span>{a.temperature > 0 ? `sampled, T = ${a.temperature}` : "greedy"}</span>
          </p>
          <div className="space-y-1">
            {step.top.map(([id, p]) => (
              <div key={id} className="grid grid-cols-[96px_1fr_52px] items-center gap-2 text-[12px]">
                <span className={`dl-mono truncate ${id === step.token ? "text-[var(--accent)]" : "text-[var(--fg-2)]"}`}>{tileText(lab.tok, id)}</span>
                <span className="h-[6px] rounded-[1px] bg-[var(--line)]">
                  <span className="block h-full rounded-[1px]" style={{ width: `${p * 100}%`, background: id === step.token ? "var(--accent)" : "var(--fg-4)" }} />
                </span>
                <span className="dl-mono text-right text-[var(--fg-3)]">{fmt(p * 100, 1)}%</span>
              </div>
            ))}
          </div>
          <p className="dl-small mt-2">
            p of the timestamp tokens together: <span className="dl-mono text-[var(--fg-2)]">{fmt(step.timeMass * 100, 1)}%</span>
          </p>
        </div>
      )}
      {r && a && (
        <div className="dl-section">
          <dl className="dl-kv">
            <dt>p(&lt;|nospeech|&gt;) at the start</dt>
            <dd>{Number.isFinite(a.noSpeechProb) ? fmt(a.noSpeechProb, 3) : "—"}</dd>
            <dt>tokens · avg log p</dt>
            <dd>
              {n} · {dec === "done" ? fmt(a.avgLogprob, 3) : "…"}
            </dd>
            <dt>attempts</dt>
            <dd>{r.verdicts.map((v) => `T=${v.temperature}${v.failed ? " ✗" : " ✓"}`).join("  ") || "…"}</dd>
            <dt>time on this GPU</dt>
            <dd>{dec === "done" ? `${fmt(r.ms.dec, 0)} ms · ${fmt(r.ms.dec / Math.max(1, n), 1)} ms/token` : "…"}</dd>
          </dl>
          {r.verdicts.some((v) => v.failed) && <p className="dl-small mt-2">{r.verdicts.filter((v) => v.failed).map((v) => `T=${v.temperature}: ${v.failed}`).join(" · ")}</p>}
        </div>
      )}
    </>
  );
}

function TextCard() {
  const align = useVoice((s) => s.align);
  const r = getLab()?.run;
  const words = r?.align?.words ?? [];
  const save = () => {
    if (!r?.final) return;
    const lines = [r.final.text, "", ...words.map((w) => `${w.start.toFixed(2)}\t${w.end.toFixed(2)}\t${w.probability.toFixed(3)}\t${w.word.trim()}`)];
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([lines.join("\n")], { type: "text/plain" }));
    a.download = "whisper-transcript.txt";
    a.click();
  };
  return (
    <>
      <div className="dl-section">
        <h2 className="dl-title">When was each word said?</h2>
        <p className="dl-prose mt-3">
          Whisper keeps two clocks. Its <b>timestamp tokens</b> time whole segments on a 20 ms grid. For words, OpenAI found eight cross-attention heads in tiny.en whose attention follows the audio: feed the transcript back,
          take those heads&apos; attention over time, normalise it per frame, median-filter it, and find with <b>dynamic time warping</b> the monotonic path from first token to last that stays where the attention is.
        </p>
      </div>
      <div className="dl-section">
        <Eq n={16}>{"D_{i,j} = -A_{i,j} + \\min(D_{i-1,j-1},\\ D_{i-1,j},\\ D_{i,j-1})"}</Eq>
        <p className="dl-small mt-1">
          <M>{"A"}</M>: attention of token <M>{"i"}</M> to audio position <M>{"j"}</M>, standardised over tokens, median of 7, mean of the 8 heads. A word starts where the path first reaches its first token.
        </p>
      </div>
      <div className="dl-section">
        <p className="dl-label">
          <span>words</span>
          <span>{align === "done" ? `${words.length} · start – end · p` : align}</span>
        </p>
        <div className="dl-scroll grid max-h-[200px] grid-cols-[1fr_auto_auto] gap-x-3 overflow-y-auto pr-1 text-[12px]">
          {words.map((w, i) => (
            <button key={i} type="button" className="contents text-left" onClick={() => getLab()?.listen(Math.max(0, w.start - 0.05))}>
              <span className="border-b border-dotted border-[var(--line-2)] py-[3px] font-[family-name:var(--serif)] text-[13.5px] text-[var(--fg)] hover:text-[var(--accent)]">{w.word.trim()}</span>
              <span className="dl-mono border-b border-dotted border-[var(--line-2)] py-[3px] text-right text-[var(--time)]">
                {w.start.toFixed(2)}–{w.end.toFixed(2)}
              </span>
              <span className="dl-mono border-b border-dotted border-[var(--line-2)] py-[3px] text-right text-[var(--fg-3)]">{Math.round(w.probability * 100)}%</span>
            </button>
          ))}
        </div>
        <div className="mt-3 flex gap-2">
          <ListenButton label="Play with the words" />
          <button type="button" className="dl-btn !h-[30px]" onClick={save} disabled={!words.length}>
            Save .txt
          </button>
        </div>
      </div>
    </>
  );
}

const BADGES: Badge[][] = [
  [["live", "live"]],
  [["live", "live"]],
  [["live", "live"]],
  [["live", "live"]],
  [["live · whisper/audio.py", "live"]],
  [["live · real weights", "live"]],
  [["live · real weights", "live"]],
  [["live", "live"]],
];

export default function Inspector({ className = "max-h-full" }: { className?: string }) {
  const stage = useVoice((s) => s.stage);
  const Body = [Sound, Detect, Resample, Stft, MelCard, EncoderCard, DecoderCard, TextCard][stage];
  return (
    <div className={`dl-card dl-scroll vx-insp overflow-y-auto ${className}`} key={stage}>
      <Head i={stage} badge={BADGES[stage]} />
      <Body />
    </div>
  );
}
