"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { SAMPLERS, T, snrDb } from "../../schedule";
import { getLab } from "../lab";
import { effectiveCount, topK } from "../sampler";
import { LATENT, TAESD, TEXT_ENCODER, TOKENIZER, UNET, VAE } from "../sd15";
import { STAGES } from "../story";
import { useLab } from "../store";
import { useShownStep } from "../scene/useShownStep";
import { Eq, M } from "./Math";

const fmt = (v: number, d = 3) => v.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });
const sig = (v: number) => (v >= 0.01 ? v.toFixed(4) : v.toExponential(2));
const db = (ab: number) => {
  const v = snrDb(ab);
  return Number.isFinite(v) ? `${v > 0 ? "+" : ""}${v.toFixed(1)} dB` : "∞";
};
const coef = (v: number) => (v >= 0 ? v.toFixed(4) : `-${(-v).toFixed(4)}`);

function Pixels({ image, size, smooth }: { image: ImageData | null; size: number; smooth?: boolean }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current;
    if (!c || !image) return;
    c.width = image.width;
    c.height = image.height;
    c.getContext("2d")!.putImageData(image, 0, 0);
  }, [image]);
  return <canvas ref={ref} className="dl-thumb" style={{ width: size, height: size, imageRendering: smooth ? "auto" : "pixelated", background: "#000" }} />;
}

export function Thumb({ index, size }: { index: number; size: number }) {
  const lab = getLab();
  const cols = lab?.assets.manifest.thumb.cols ?? 16;
  const rows = Math.ceil((lab?.assets.manifest.images.length ?? 1) / cols);
  return (
    <span
      className="dl-thumb inline-block"
      style={{
        width: size,
        height: size,
        backgroundImage: "url(/diffusion/train.webp)",
        backgroundSize: `${cols * size}px ${rows * size}px`,
        backgroundPosition: `-${(index % cols) * size}px -${Math.floor(index / cols) * size}px`,
      }}
    />
  );
}

function Head({ i, badge }: { i: number; badge: [string, "live" | "ref" | "stand"][] }) {
  return (
    <div className="dl-head">
      <div>
        <p className="dl-eyebrow">
          <span className="dl-n">{String(i + 1).padStart(2, "0")}</span>
          {STAGES[i].title}
        </p>
      </div>
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

function Prompt() {
  const cls = useLab((s) => s.cls);
  const lab = getLab();
  const c = lab?.assets.manifest.classes[cls];
  return (
    <>
      <div className="dl-section">
        <h2 className="dl-title">The prompt</h2>
        <p className="dl-prose mt-3 font-[family-name:var(--serif)] text-[17px] italic leading-[1.4] text-[var(--fg)]">“{c?.prompt}”</p>
        <p className="dl-prose mt-3">
          The image model never sees characters. The prompt is tokenized and embedded by CLIP, and only that embedding reaches the U-Net, through cross-attention. For classifier-free guidance the <b>empty prompt</b> is encoded too, and
          both run as one batch of two at every step.
        </p>
      </div>
      <div className="dl-section">
        <dl className="dl-kv">
          <dt>characters</dt>
          <dd>{c?.prompt.length}</dd>
          <dt>batch</dt>
          <dd>[“”, prompt]</dd>
          <dt>resolution</dt>
          <dd>512 × 512</dd>
        </dl>
      </div>
    </>
  );
}

function Tokens() {
  const cls = useLab((s) => s.cls);
  const lab = getLab();
  const toks = lab?.assets.manifest.classes[cls]?.tokens ?? [];
  const ids = [TOKENIZER.bos, ...toks.map((t) => t[1]), TOKENIZER.eos];
  return (
    <>
      <div className="dl-section">
        <h2 className="dl-title">Byte-level BPE</h2>
        <p className="dl-prose mt-3">
          CLIP lower-cases the text, splits it into words and punctuation, maps each byte to a symbol and applies 48,894 learned merges. A piece that ends a word carries <code>&lt;/w&gt;</code>. The sequence is wrapped in{" "}
          <code>&lt;|startoftext|&gt;</code> and <code>&lt;|endoftext|&gt;</code>, then padded to 77 with the end token. Longer prompts are truncated, which is where SD 1.x&apos;s 75-token limit comes from.
        </p>
      </div>
      <div className="dl-section">
        <p className="dl-label">
          <span>pieces → ids</span>
          <span>{toks.length} + 2 special</span>
        </p>
        <div className="dl-scroll grid max-h-[176px] grid-cols-[1fr_auto] gap-x-4 overflow-y-auto pr-1 text-[12px]">
          {toks.map(([piece, id], i) => (
            <div key={i} className="contents">
              <span className="dl-mono border-b border-dotted border-[var(--line-2)] py-[3px] text-[var(--fg)]">
                {piece.replace("</w>", "")}
                {piece.endsWith("</w>") && <span className="text-[var(--fg-4)]">&lt;/w&gt;</span>}
              </span>
              <span className="dl-mono border-b border-dotted border-[var(--line-2)] py-[3px] text-right text-[var(--time)]">{id}</span>
            </div>
          ))}
        </div>
      </div>
      <div className="dl-section">
        <p className="dl-label">
          <span>input_ids</span>
          <span>[2, 77] int64</span>
        </p>
        <p className="dl-mono break-words text-[11px] leading-[1.6] text-[var(--fg-2)]">
          [{ids.join(", ")}, <span className="text-[var(--fg-4)]">{TOKENIZER.pad} × {TOKENIZER.context - ids.length}</span>]
        </p>
        <p className="dl-mono mt-1 text-[11px] leading-[1.6] text-[var(--fg-3)]">
          [{TOKENIZER.bos}, {TOKENIZER.eos}, {TOKENIZER.pad} × 75] <span className="text-[var(--fg-4)]">← the empty prompt</span>
        </p>
      </div>
    </>
  );
}

function Encoder() {
  return (
    <>
      <div className="dl-section">
        <h2 className="dl-title">CLIP text transformer</h2>
        <p className="dl-prose mt-3">
          Each id becomes a 768-dim vector, plus a learned position. Twelve pre-LayerNorm blocks follow, each with <b>causal</b> self-attention (position <M>{"i"}</M> sees only <M>{"j \\le i"}</M>) and an MLP. SD 1.x uses the final
          layer&apos;s normalised output at all 77 positions, padding included, as its conditioning.
        </p>
      </div>
      <div className="dl-section">
        <Eq n={1}>{"h^{(0)} = E[\\mathrm{ids}] + P,\\quad E\\in\\R^{49408\\times 768},\\ P\\in\\R^{77\\times768}"}</Eq>
        <Eq n={2}>{"h \\leftarrow h + \\mathrm{MHA}(\\mathrm{LN}(h)),\\quad h \\leftarrow h + \\mathrm{MLP}(\\mathrm{LN}(h))"}</Eq>
        <Eq n={3}>{"\\mathrm{Attn}(Q,K,V)=\\mathrm{softmax}\\!\\Big(\\tfrac{QK^\\top}{\\sqrt{64}} + M\\Big)V"}</Eq>
        <p className="dl-small -mt-1 mb-1 pl-1">
          <M>{"M_{ij} = -\\infty"}</M> where <M>{"j > i"}</M>: the causal mask. 64 is the head width, 768 / 12.
        </p>
        <Eq n={4}>{"c = \\mathrm{LN}(h^{(12)}) \\in \\R^{77\\times 768}"}</Eq>
      </div>
      <div className="dl-section">
        <dl className="dl-kv">
          <dt>layers · width · heads</dt>
          <dd>
            {TEXT_ENCODER.layers} · {TEXT_ENCODER.width} · {TEXT_ENCODER.heads}
          </dd>
          <dt>MLP · activation</dt>
          <dd>{TEXT_ENCODER.mlp} · quick-GELU</dd>
          <dt>parameters</dt>
          <dd>{(TEXT_ENCODER.params / 1e6).toFixed(2)} M</dd>
          <dt>output</dt>
          <dd>[2, 77, 768]</dd>
        </dl>
        <p className="dl-small mt-3">Not executed here: 123 M parameters is more than a page should download. The prompt chooses which training images the stand-in denoiser conditions on (see Method).</p>
      </div>
    </>
  );
}

function Noise() {
  const run = useLab((s) => s.run);
  const seed = useLab((s) => s.seed);
  const lab = getLab();
  const stats = useMemo(() => {
    const z = lab?.run?.zT;
    if (!z) return null;
    let s = 0;
    let s2 = 0;
    for (const v of z) {
      s += v;
      s2 += v * v;
    }
    const m = s / z.length;
    return { mean: m, std: Math.sqrt(s2 / z.length - m * m), img: lab!.previewImage(z) };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [run]);
  return (
    <>
      <div className="dl-section">
        <h2 className="dl-title">Sampling the start point</h2>
        <p className="dl-prose mt-3">
          The image is made in the VAE&apos;s latent space: 4 channels at 1/8 the resolution, <b>48× fewer numbers</b> than pixels. Latents are scaled by {LATENT.scale} so they have unit variance, the same as this noise.
        </p>
      </div>
      <div className="dl-section">
        <Eq n={5}>{"z_T \\sim \\N(0, I),\\qquad z_T \\in \\R^{1\\times4\\times64\\times64}"}</Eq>
      </div>
      <div className="dl-section flex gap-4">
        <Pixels image={stats?.img ?? null} size={92} />
        <dl className="dl-kv flex-1 self-start">
          <dt>seed</dt>
          <dd>{seed}</dd>
          <dt>mean</dt>
          <dd>{stats ? fmt(stats.mean) : "—"}</dd>
          <dt>std</dt>
          <dd>{stats ? fmt(stats.std) : "—"}</dd>
          <dt>numbers</dt>
          <dd>16,384</dd>
        </dl>
      </div>
      <div className="dl-section">
        <p className="dl-small">
          At <M>{"t=999"}</M> the scaled-linear schedule still keeps <M>{"\\sqrt{\\ab_{999}}=0.068"}</M> of the signal, so SD 1.5 never trained on pure noise. Lin et al. (2023) show this is why it can&apos;t make very dark or
          very bright images.
        </p>
      </div>
    </>
  );
}

function Denoise() {
  const { k, steps } = useShownStep();
  const sampler = useLab((s) => s.sampler);
  const w = useLab((s) => s.w);
  const cls = useLab((s) => s.cls);
  const lab = getLab();
  const rec = lab?.record(Math.min(k, steps - 1));
  const kk = Math.min(k, steps - 1);
  const imgs = useMemo(() => (rec && lab ? { z: lab.previewImage(rec.z), x0: lab.previewImage(rec.x0), eps: lab.gridImage(rec.eps) } : null), [rec, lab]);
  const [full, setFull] = useState<{ k: number; image: ImageData; ms: number } | null>(null);
  const [busy, setBusy] = useState(false);
  if (!rec || !imgs) return <div className="dl-section dl-small">Waiting for the sampler…</div>;
  const decodeX0 = async () => {
    setBusy(true);
    useLab.getState().set({ playing: false });
    const r = await lab!.decodeImage(rec.x0);
    setBusy(false);
    if (r) setFull({ k: kk, ...r });
  };
  const s = rec.s < 0 ? 0 : rec.s;
  const top = topK(rec.postC, 3);
  const name = SAMPLERS.find((x) => x.id === sampler)!.label;
  // the update rule, one equation per line so it fits the card
  const update =
    sampler === "ddim"
      ? ["z_s = \\sqrt{\\ab_s}\\,\\hz + \\sqrt{1-\\ab_s}\\,\\he"]
      : sampler === "ddpm"
        ? ["z_s = \\sqrt{\\ab_s}\\,\\hz + \\sqrt{1-\\ab_s-\\sigma_t^2}\\,\\he + \\sigma_t\\,\\xi", "\\sigma_t^2=\\tfrac{1-\\ab_s}{1-\\ab_t}\\Big(1-\\tfrac{\\ab_t}{\\ab_s}\\Big),\\quad \\xi\\sim\\N(0,I)"]
        : [
            "z_s = \\tfrac{\\sqrt{1-\\ab_s}}{\\sqrt{1-\\ab_t}}\\, z_t + \\sqrt{\\ab_s}\\big(1-e^{-h}\\big)\\,D",
            "D = \\big(1+\\tfrac{1}{2r}\\big)\\hz - \\tfrac{1}{2r}\\,\\hz^{\\,\\mathrm{prev}},\\quad r = h_{\\mathrm{prev}} / h",
            "h = \\lambda_s - \\lambda_t,\\quad \\lambda = \\log\\big(\\sqrt{\\ab}\\,/\\sqrt{1-\\ab}\\big)",
          ];
  const numeric = `z_{${s}} = ${coef(rec.cX)}\\,z_{${rec.t}} ${rec.cA >= 0 ? "+" : "-"} ${Math.abs(rec.cA).toFixed(4)}\\,\\hz${rec.cB ? ` ${rec.cB >= 0 ? "+" : "-"} ${Math.abs(rec.cB).toFixed(4)}\\,\\hz^{\\,\\mathrm{prev}}` : ""}${rec.cZ ? ` + ${rec.cZ.toFixed(4)}\\,\\xi` : ""}`;
  return (
    <>
      <div className="dl-section">
        <div className="flex items-baseline justify-between">
          <h2 className="dl-title">
            Step {k >= steps ? steps : kk + 1} <span className="text-[var(--fg-4)]">of {steps}</span>
          </h2>
          <span className="dl-mono text-[12px] text-[var(--fg-2)]">
            t {rec.t} → {s}
          </span>
        </div>
        <div className="mt-3 flex gap-3">
          {(
            [
              ["z_t", imgs.z, "latent → RGB"],
              ["\\hz", imgs.x0, "prediction"],
              ["\\he", imgs.eps, "guided noise"],
            ] as const
          ).map(([tex, img, cap]) => (
            <figure key={cap} className="m-0">
              <Pixels image={img} size={88} />
              <figcaption className="dl-small mt-1">
                <M>{tex}</M> <span className="text-[var(--fg-4)]">{cap}</span>
              </figcaption>
            </figure>
          ))}
        </div>
        {full?.k === kk ? (
          <figure className="m-0 mt-3">
            <Pixels image={full.image} size={196} smooth />
            <figcaption className="dl-small mt-1">
              <M>{"\\hz"}</M> through the real TAESD decoder · {full.ms.toFixed(0)} ms
            </figcaption>
          </figure>
        ) : (
          <button type="button" className="dl-btn mt-3 !h-[30px] w-full" onClick={decodeX0} disabled={busy}>
            {busy ? "Decoding…" : "Decode this prediction with TAESD"}
          </button>
        )}
      </div>
      <div className="dl-section">
        <dl className="dl-kv">
          <dt>
            <M>{"\\ab_t \\to \\ab_s"}</M>
          </dt>
          <dd>
            {sig(rec.abT)} → {sig(rec.abS)}
          </dd>
          <dt>
            signal <M>{"\\sqrt{\\ab_t}"}</M> · noise <M>{"\\sqrt{1-\\ab_t}"}</M>
          </dt>
          <dd>
            {fmt(Math.sqrt(rec.abT))} · {fmt(Math.sqrt(1 - rec.abT))}
          </dd>
          <dt>SNR</dt>
          <dd>{db(rec.abT)}</dd>
          <dt>U-Net evaluations</dt>
          <dd>
            {(kk + 1) * (cls >= 0 ? 2 : 1)} <span className="text-[var(--fg-4)]">/ {steps * (cls >= 0 ? 2 : 1)}</span>
          </dd>
        </dl>
      </div>
      <div className="dl-section">
        <p className="dl-label">
          <span>what the step computes</span>
          <span>{name}</span>
        </p>
        <Eq n={6}>{"z_t = \\sqrt{\\ab_t}\\,z_0 + \\sqrt{1-\\ab_t}\\,\\eps,\\quad \\eps\\sim\\N(0,I)"}</Eq>
        <Eq n={7}>{"\\he = \\he_\\varnothing + w\\,(\\he_c - \\he_\\varnothing)"}</Eq>
        <Eq n={8}>{"\\hz = \\big(z_t - \\sqrt{1-\\ab_t}\\,\\he\\big) / \\sqrt{\\ab_t}"}</Eq>
        {update.map((u, i) => (
          <Eq key={u} n={i ? `9${"abc"[i - 1]}` : 9}>
            {u}
          </Eq>
        ))}
        <div className="mt-1 overflow-x-auto rounded-[2px] bg-[rgba(236,233,226,0.04)] px-2 py-1.5">
          <M>{numeric}</M>
        </div>
        <p className="dl-small mt-2">
          {cls >= 0 ? (
            <>
              <M>{`w = ${w.toFixed(1)}`}</M>, and the prompt moves the prediction by <M>{`\\lVert\\he_c-\\he_\\varnothing\\rVert/\\sqrt{D} = ${rec.gap.toFixed(3)}`}</M>.
            </>
          ) : (
            "No prompt: the unconditional model alone, one evaluation per step."
          )}
        </p>
      </div>
      <div className="dl-section">
        <p className="dl-label">
          <span>stand-in denoiser</span>
          <span>
            Gaussian {fmt(1 - rec.beta, 2)} · exact {fmt(rec.beta, 2)}
          </span>
        </p>
        <p className="dl-small">Posterior over this prompt&apos;s training images, given <M>{"z_t"}</M>:</p>
        <div className="mt-2 flex gap-2.5">
          {top.map(([i, p]) => (
            <div key={i} className="flex items-center gap-2">
              <Thumb index={i} size={34} />
              <span className="dl-mono text-[11px] text-[var(--fg-2)]">{(p * 100).toFixed(p > 0.995 ? 0 : 1)}%</span>
            </div>
          ))}
        </div>
        <p className="dl-small mt-2">
          effective images <span className="dl-mono text-[var(--fg-2)]">{effectiveCount(rec.postC).toFixed(2)}</span> · at high noise only the Gaussian part drives the step, so many images still fit.
        </p>
      </div>
    </>
  );
}

function Decode() {
  const decode = useLab((s) => s.decode);
  const lab = getLab();
  return (
    <>
      <div className="dl-section">
        <h2 className="dl-title">Latent to pixels</h2>
        <p className="dl-prose mt-3">
          The finished latent goes through the VAE decoder once. SD&apos;s own decoder (AutoencoderKL) has {(VAE.decoderParams / 1e6).toFixed(1)} M parameters and attention at 64²; this is <b>TAESD</b>, a{" "}
          {(TAESD.decoderParams / 1e6).toFixed(2)} M-parameter student trained to reproduce it from the same latents. Its real weights run here as 35 convolutions in WebGL 2 shaders.
        </p>
      </div>
      <div className="dl-section">
        <Eq n={10}>{"x = \\mathcal{D}_{\\mathrm{TAESD}}(z_0) \\in [0,1]^{3\\times512\\times512}"}</Eq>
        <Eq n={11}>{"\\text{SD's VAE: } x = \\mathcal{D}(z_0 / 0.18215) \\in [-1,1]"}</Eq>
      </div>
      <div className="dl-section">
        <dl className="dl-kv">
          <dt>status</dt>
          <dd>{decode.status === "running" ? `stage ${Math.min(4, decode.stages + 1)} / 4` : decode.status}</dd>
          <dt>time on this GPU</dt>
          <dd>{decode.status === "done" ? `${decode.ms.toFixed(0)} ms` : "—"}</dd>
          <dt>layout</dt>
          <dd>64 ch · fp16 · 1 draw / 4 ch</dd>
          <dt>path</dt>
          <dd>64² → 128² → 256² → 512²</dd>
        </dl>
        {decode.status === "error" && <p className="dl-small mt-2 text-[var(--time)]">{lab?.decodeError}</p>}
      </div>
    </>
  );
}

function Result() {
  const lab = getLab();
  const done = useLab((s) => s.decode.status === "done");
  const run = useLab((s) => s.run);
  const near = useMemo(() => (done ? lab?.nearest() : null), [done, lab, run]); // eslint-disable-line react-hooks/exhaustive-deps
  const save = () => {
    const img = lab?.image;
    if (!img) return;
    const c = document.createElement("canvas");
    c.width = img.width;
    c.height = img.height;
    c.getContext("2d")!.putImageData(img, 0, 0);
    const s = useLab.getState();
    const a = document.createElement("a");
    a.download = `diffusion-${lab!.assets.manifest.classes[s.cls]?.id ?? "uncond"}-seed${s.seed}-${s.sampler}-${s.steps}.png`;
    a.href = c.toDataURL("image/png");
    a.click();
  };
  return (
    <>
      <div className="dl-section">
        <h2 className="dl-title">The result</h2>
        <div className="mt-3">
          <Pixels image={done ? (lab?.image ?? null) : null} size={330} smooth />
        </div>
        <div className="mt-3 flex gap-2">
          <button type="button" className="dl-btn" onClick={save} disabled={!done}>
            Download PNG
          </button>
          <button type="button" className="dl-btn" onClick={() => window.dispatchEvent(new CustomEvent("dl:regenerate"))}>
            New seed
          </button>
        </div>
      </div>
      {near && (
        <div className="dl-section">
          <p className="dl-label">
            <span>memorisation check</span>
            <span>nearest training latent</span>
          </p>
          <div className="flex items-center gap-3">
            <Thumb index={near.index} size={48} />
            <p className="dl-small">
              RMS distance <span className="dl-mono text-[var(--fg)]">{near.rms.toFixed(3)}</span> per latent value. Near zero means the stand-in has given back a training image: the exact optimum of a finite dataset
              memorises (Carlini et al., 2023). A real U-Net generalises because it can&apos;t represent that optimum.
            </p>
          </div>
        </div>
      )}
    </>
  );
}

const BADGES: [string, "live" | "ref" | "stand"][][] = [
  [["live", "live"]],
  [["live · real BPE", "live"]],
  [["reference", "ref"]],
  [["live", "live"]],
  [
    ["live sampler", "live"],
    ["U-Net stand-in", "stand"],
  ],
  [["live · real weights", "live"]],
  [["live", "live"]],
];

export default function Inspector({ className = "max-h-full" }: { className?: string }) {
  const stage = useLab((s) => s.stage);
  const Body = [Prompt, Tokens, Encoder, Noise, Denoise, Decode, Result][stage];
  return (
    <div className={`dl-card dl-scroll overflow-y-auto ${className}`} key={stage}>
      <Head i={stage} badge={BADGES[stage]} />
      <Body />
      {stage === 4 && (
        <div className="dl-section dl-small">
          {UNET.params.toLocaleString("en-US")} U-Net parameters in SD 1.5; {T} training timesteps.
        </div>
      )}
    </div>
  );
}
