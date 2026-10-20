"use client";

import Link from "next/link";
import { HANDOVER, SIGMA_D } from "../sampler";
import { useLab } from "../store";
import { Eq, M } from "./Math";

const REFS = [
  ["Ho, Jain & Abbeel", "Denoising Diffusion Probabilistic Models", "NeurIPS 2020"],
  ["Song, Meng & Ermon", "Denoising Diffusion Implicit Models", "ICLR 2021"],
  ["Rombach et al.", "High-Resolution Image Synthesis with Latent Diffusion Models", "CVPR 2022"],
  ["Ho & Salimans", "Classifier-Free Diffusion Guidance", "2022"],
  ["Lu et al.", "DPM-Solver++: Fast Solver for Guided Sampling of Diffusion Probabilistic Models", "2022"],
  ["Radford et al.", "Learning Transferable Visual Models From Natural Language Supervision", "ICML 2021"],
  ["Efron", "Tweedie’s Formula and Selection Bias", "JASA 2011"],
  ["Wang & Vastola", "Diffusion Models Generate Images Like Painters: an Analytical Theory of Outline First, Details Later", "2023"],
  ["Wang & Vastola", "The Hidden Linear Structure in Score-Based Models and its Application", "2023"],
  ["Lin et al.", "Common Diffusion Noise Schedules and Sample Steps are Flawed", "WACV 2024"],
  ["Carlini et al.", "Extracting Training Data from Diffusion Models", "USENIX Security 2023"],
  ["Boer Bohan", "TAESD: Tiny AutoEncoder for Stable Diffusion", "github.com/madebyollin/taesd"],
];

export default function Method() {
  const set = useLab((s) => s.set);
  return (
    <div className="pointer-events-auto fixed inset-0 z-30 flex items-start justify-center overflow-y-auto bg-black/65 p-4 backdrop-blur-sm md:p-10" onClick={() => set({ method: false })}>
      <article className="dl-card w-[min(760px,100%)]" onClick={(e) => e.stopPropagation()}>
        <div className="dl-head">
          <p className="dl-eyebrow">Method</p>
          <button type="button" className="dl-btn !h-7" onClick={() => set({ method: false })}>
            Close <kbd>esc</kbd>
          </button>
        </div>
        <div className="dl-section !px-6 !py-6">
          <h2 className="dl-title !text-[34px]">What runs, and what stands in</h2>
          <p className="dl-prose mt-4 max-w-[60ch]">
            This is Stable Diffusion 1.5&apos;s pipeline at its real shapes, from prompt to pixels. Everything that can run in a browser does, with SD&apos;s own numbers. The two networks that can&apos;t, at 123 M and 860 M
            parameters, are drawn from their architectures and stood in for as described below.
          </p>
        </div>

        <div className="grid md:grid-cols-2">
          <section className="dl-section !px-6 md:border-r md:border-[var(--line)]">
            <p className="dl-label">
              <span className="text-[var(--accent)]">computed live</span>
            </p>
            <ul className="dl-prose space-y-2.5 !text-[13.5px]">
              <li>
                <b>Tokenization.</b> The ids are OpenAI CLIP&apos;s byte-level BPE on each prompt (vocabulary of 49,408), padded to 77 with <code>&lt;|endoftext|&gt;</code>.
              </li>
              <li>
                <b>Schedule.</b> SD 1.5&apos;s scaled-linear <M>{"\\beta\\in[0.00085, 0.012]"}</M> over 1000 training steps, with trailing timestep spacing.
              </li>
              <li>
                <b>Sampling.</b> DDIM (<M>{"\\eta=0"}</M>), ancestral DDPM (<M>{"\\eta=1"}</M>) and DPM-Solver++ (2M), with classifier-free guidance on <M>{"\\epsilon"}</M>, every step in float32.
              </li>
              <li>
                <b>Latent space.</b> 100 training latents, 4 × 64 × 64 each, made from this portfolio&apos;s own renders by TAESD&apos;s encoder. Their std is 0.99, the unit variance SD&apos;s 0.18215 scaling targets.
              </li>
              <li>
                <b>Decoder.</b> TAESD&apos;s real weights (1.22 M parameters) run in WebGL 2. Checked against a CPU reference, the mean pixel error is 0.1%.
              </li>
            </ul>
          </section>
          <section className="dl-section !px-6">
            <p className="dl-label">
              <span className="text-[var(--time)]">stand-ins</span>
            </p>
            <ul className="dl-prose space-y-2.5 !text-[13.5px]">
              <li>
                <b>Text encoder.</b> CLIP ViT-L/14 is drawn at its real size but not executed. The prompt selects the set of training images the denoiser is conditioned on, which is the role <M>{"c"}</M> plays for the U-Net.
              </li>
              <li>
                <b>U-Net.</b> Replaced by a closed-form denoiser: what a network trained to optimality on these 100 latents would compute, in the two regimes where that is known.
              </li>
            </ul>
          </section>
        </div>

        <section className="dl-section !px-6">
          <p className="dl-label">
            <span>the denoiser</span>
          </p>
          <p className="dl-prose">
            The U-Net is trained to predict the noise, and the best possible prediction is the posterior mean (Tweedie). At <b>high noise</b>, a trained network is close to the Wiener filter of its data&apos;s mean and
            covariance, which recovers high-variance directions (layout, colour) first and fine detail last: outline first, details later. At <b>low noise</b>, the optimum for a finite set is the exact empirical score,
            a softmax over training images.
          </p>
          <Eq n="A">{"\\hz^{G} = \\mu + \\sum_k \\frac{\\sqrt{\\ab}\\,\\lambda_k}{\\ab\\,\\lambda_k + 1-\\ab}\\,\\big\\langle z_t - \\sqrt{\\ab}\\,\\mu,\\ u_k\\big\\rangle\\, u_k"}</Eq>
          <Eq n="B">{"\\hz^{E} = \\sum_i w_i\\, y_i,\\qquad w_i \\propto \\exp\\!\\Big(-\\frac{\\lVert z_t-\\sqrt{\\ab}\\,y_i\\rVert^2}{2(\\ab\\sigma_d^2 + 1-\\ab)}\\Big)"}</Eq>
          <Eq n="C">{"\\hz = (1-\\beta_t)\\,\\hz^{G} + \\beta_t\\,\\hz^{E},\\qquad \\he = \\frac{z_t-\\sqrt{\\ab_t}\\,\\hz}{\\sqrt{1-\\ab_t}}"}</Eq>
          <p className="dl-small mt-2">
            <M>{"(\\mu, \\lambda_k, u_k)"}</M> are each prompt&apos;s mean and principal axes, fitted when the page loads; the unconditional model <M>{"\\he_\\varnothing"}</M> uses all 100 images. <M>{"\\beta_t"}</M> rises
            smoothly over log-SNR ∈ [{HANDOVER[0]}, {HANDOVER[1]}]; <M>{`\\sigma_d = ${SIGMA_D}`}</M> (B also has a small term in <M>{"z_t"}</M>, omitted here, from smoothing each image by <M>{"\\sigma_d"}</M>). Because
            (B) memorises, the finished image is close to a training image. The last card measures how close.
          </p>
        </section>

        <section className="dl-section !px-6">
          <p className="dl-label">
            <span>things to try</span>
          </p>
          <ul className="dl-prose list-disc space-y-1.5 pl-5 !text-[13.5px]">
            <li>Watch the prediction <M>{"\\hz"}</M> next to <M>{"z_t"}</M>: layout appears first, then detail.</li>
            <li>DDIM is deterministic: the same seed gives the same image. DDPM re-injects noise at every step.</li>
            <li>DPM++ 2M at 10 steps against DDIM at 10 steps: the second-order solver holds together.</li>
            <li>Raise the guidance scale: colour saturates as samples are pushed away from the unconditional model.</li>
          </ul>
          <p className="dl-small mt-3">
            Keys: <kbd>space</kbd> play · <kbd>←</kbd>
            <kbd>→</kbd> stage or step · <kbd>R</kbd> new seed · <kbd>O</kbd> overview · <kbd>F</kbd> follow camera · <kbd>M</kbd> this sheet
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
          <p className="dl-small mt-4">
            The same mathematics on a dataset small enough to see in full: <Link className="text-[var(--fg)] underline decoration-[var(--line-2)] underline-offset-4 hover:decoration-[var(--fg)]" href="/diffusion/score">the 3-D score-field lab</Link>.
          </p>
        </section>
      </article>
    </div>
  );
}
