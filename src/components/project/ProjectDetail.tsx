"use client";

import Image from "next/image";
import Link from "next/link";
import { useRef } from "react";
import CopyEmail from "@/components/CopyEmail";
import { curtain } from "@/components/Curtain";
import type { Project } from "@/content/site";
import { gsap, ScrollTrigger, SplitText, useGSAP } from "@/lib/gsap";

const pad = (n: number) => String(n).padStart(2, "0");
/** a font size at which the title's longest word still fits the screen (never broken mid-word) */
const fitWord = (title: string) => `${(88 / (Math.max(...title.split(/\s+/).map((w) => w.length)) * 0.7)).toFixed(2)}vw`;
const host = (url: string) => url.replace(/^https?:\/\//, "").replace(/\/$/, "");

type Props = { project: Project; index: number; total: number; prev: Project; next: Project };

/**
 * The project case study, entered through the crystal. Tinted by the project's colour,
 * over the smoky backdrop the canvas draws behind /projects/[slug].
 */
export default function ProjectDetail({ project, index, total, prev, next }: Props) {
  const root = useRef<HTMLElement>(null);
  let section = 0;
  const num = () => pad(++section);

  useGSAP(
    () => {
      // arriving through the crystal: the curtain dissolves over the hero
      const through = curtain.reveal();
      if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
      const delay = through ? 0.55 : 0.15;

      const title = root.current!.querySelector<HTMLElement>("[data-title]")!;
      const split = SplitText.create(title, { type: "lines,words,chars", mask: "lines" });
      gsap.from(split.chars, { yPercent: 115, duration: 1.1, stagger: 0.028, ease: "expo.out", delay });
      gsap.from(".pd-in", { autoAlpha: 0, y: 24, duration: 0.9, stagger: 0.07, ease: "power3.out", delay: delay + 0.2 });
      gsap.from(".pd-hero-img", { scale: 1.25, autoAlpha: 0, duration: 2.2, ease: "power2.out", delay: delay - 0.3 });

      // reading progress
      gsap.fromTo(
        ".pd-progress",
        { scaleX: 0 },
        { scaleX: 1, ease: "none", scrollTrigger: { start: 0, end: "max", scrub: 0.3 } },
      );

      // the screen lifts out of the dark and flattens as it arrives
      gsap.fromTo(
        ".pd-frame",
        { scale: 0.86, rotateX: 14, y: 80, autoAlpha: 0.4 },
        {
          scale: 1,
          rotateX: 0,
          y: 0,
          autoAlpha: 1,
          ease: "none",
          scrollTrigger: { trigger: ".pd-frame", start: "top bottom", end: "top 25%", scrub: 0.6 },
        },
      );
      gsap.fromTo(
        ".pd-frame-img",
        { yPercent: -5 },
        { yPercent: 5, ease: "none", scrollTrigger: { trigger: ".pd-frame", start: "top bottom", end: "bottom top", scrub: true } },
      );

      // everything else rises out of a blur as it enters
      const items = gsap.utils.toArray<HTMLElement>(".pd-reveal");
      gsap.set(items, { autoAlpha: 0, y: 40, filter: "blur(8px)" });
      ScrollTrigger.batch(items, {
        start: "top 90%",
        onEnter: (batch) =>
          gsap.to(batch, { autoAlpha: 1, y: 0, filter: "blur(0px)", duration: 1, stagger: 0.09, ease: "power3.out", overwrite: true }),
      });

      // numbers count up
      for (const el of gsap.utils.toArray<HTMLElement>("[data-count]")) {
        const raw = el.dataset.count!;
        const m = raw.match(/^(\d+(?:\.\d+)?)(.*)$/);
        if (!m) continue;
        const target = parseFloat(m[1]);
        const o = { v: 0 };
        el.textContent = `0${m[2]}`;
        gsap.to(o, {
          v: target,
          duration: 1.6,
          ease: "power3.out",
          scrollTrigger: { trigger: el, start: "top 88%", once: true },
          onUpdate: () => void (el.textContent = `${Math.round(o.v)}${m[2]}`),
        });
      }

      // the timeline's spine fills as you read down it
      if (root.current!.querySelector(".pd-spine")) {
        gsap.fromTo(
          ".pd-spine-fill",
          { scaleY: 0 },
          { scaleY: 1, ease: "none", scrollTrigger: { trigger: ".pd-spine", start: "top 70%", end: "bottom 55%", scrub: 0.4 } },
        );
      }
      return () => split.revert();
    },
    { scope: root },
  );

  const p = project;

  return (
    <article ref={root} className="pd relative" style={{ "--tint": p.tint } as React.CSSProperties}>
      <div aria-hidden className="pd-progress fixed inset-x-0 top-0 z-[35] h-[2px] origin-left" />
      {/* keeps the fixed header legible over the page as it scrolls under */}
      <div aria-hidden className="pointer-events-none fixed inset-x-0 top-0 z-[30] h-24 bg-gradient-to-b from-bg via-bg/70 to-transparent" />

      {/* ── hero ───────────────────────────────────────────── */}
      <header className="relative flex min-h-svh flex-col overflow-hidden">
        <div aria-hidden className="pd-hero-img absolute inset-0">
          <Image src={p.cover} alt="" fill priority sizes="100vw" className="object-cover object-top opacity-[0.16] blur-[2px]" />
          <div className="pd-hero-wash absolute inset-0" />
        </div>

        <nav
          className="pd-in relative z-10 mx-auto flex w-full max-w-[1400px] items-center justify-between px-gutter pt-24 md:pt-28"
          aria-label="Project navigation"
        >
          <Link href="/projects" scroll={false} className="pd-back label !text-fg" data-cursor="view">
            <span aria-hidden className="pd-back-arrow">←</span> All work
          </Link>
          <span className="label tabular-nums">
            Project {pad(index + 1)} <span className="text-fg/30">/ {pad(total)}</span>
          </span>
        </nav>

        <div className="relative z-10 mx-auto mt-auto w-full max-w-[1400px] px-gutter pb-10 md:pb-14">
          <p className="pd-in pd-tag">[ {p.category} ]</p>
          <h1
            data-title
            className="display mt-5 text-[length:min(16vw,var(--fit))] md:text-[length:min(9.5vw,var(--fit))]"
            style={{ "--fit": fitWord(p.title) } as React.CSSProperties}
          >
            {p.title}
          </h1>

          <div className="mt-8 flex flex-col gap-7 border-b border-fg/10 pb-9 md:flex-row md:items-end md:justify-between">
            <p className="pd-in max-w-[36ch] text-balance text-xl leading-snug text-fg/80 md:text-[1.7rem]">{p.tagline}</p>
            {p.link && (
              <a href={p.link} target="_blank" rel="noreferrer" className="pd-in pd-cta" data-cursor="view">
                {p.liveLabel ?? "Visit live site"}
                <span aria-hidden className="pd-cta-arrow">↗</span>
              </a>
            )}
          </div>

          {p.facts && (
            <dl className="mt-7 grid grid-cols-2 gap-3 md:grid-cols-4">
              {p.facts.map((f) => (
                <div key={f.label} className="pd-in pd-glass px-5 py-4">
                  <dt className="label">{f.label}</dt>
                  <dd className="mt-1.5 text-base font-medium md:text-lg">{f.value}</dd>
                </div>
              ))}
            </dl>
          )}
        </div>
      </header>

      {/* ── the product, on screen ─────────────────────────── */}
      <section className="mx-auto max-w-[1400px] px-gutter pb-10 pt-8 [perspective:1600px]" aria-label="Product screen">
        <figure className="pd-frame">
          <div className="pd-frame-bar" aria-hidden>
            <span className="flex gap-1.5">
              <i />
              <i />
              <i />
            </span>
            <span className="pd-frame-url">{p.link ? host(p.link) : p.title.toLowerCase()}</span>
            <span className="w-10" />
          </div>
          <div className="relative aspect-[16/10] overflow-hidden">
            <div className="pd-frame-img absolute -inset-y-[6%] inset-x-0">
              <Image src={p.cover} alt={`${p.title} — the live product`} fill sizes="(min-width: 1400px) 1400px, 100vw" className="object-cover object-top" />
            </div>
          </div>
        </figure>
        <figcaption className="label mt-4 flex justify-between">
          <span>{p.title} — live product</span>
          <span>{p.year}</span>
        </figcaption>
      </section>

      {/* ── overview + numbers ─────────────────────────────── */}
      <section className="mx-auto grid max-w-[1400px] gap-12 px-gutter py-20 md:grid-cols-12 md:gap-16 md:py-28" aria-label="Overview">
        <div className="md:col-span-6">
          <SectionLabel n={num()}>Overview</SectionLabel>
          {p.verdict && <h2 className="pd-reveal pd-h2">{p.verdict.title}</h2>}
          <div className="mt-7 space-y-5 text-lg leading-relaxed text-fg/75 md:text-xl">
            {p.description.map((para, k) => (
              <p key={k} className="pd-reveal">
                {para}
              </p>
            ))}
          </div>
          <div className="pd-reveal mt-9 flex flex-wrap gap-2">
            {p.stack.map((s) => (
              <span key={s} className="pd-chip">
                {s}
              </span>
            ))}
          </div>
        </div>

        {p.metrics ? (
          <div className="grid gap-3 self-end sm:grid-cols-2 md:col-span-6">
            {p.metrics.map((m, k) => (
              <div key={m.label} className={`pd-reveal pd-glass pd-metric ${k === 0 ? "sm:col-span-2" : ""}`}>
                <div className="flex items-center justify-between">
                  <span className="label pd-tint">Metric {pad(k + 1)}</span>
                  <span aria-hidden className="pd-metric-pip" />
                </div>
                <p className="display mt-8 text-[22vw] !leading-[0.85] sm:text-[11vw] md:text-[6.4vw]" data-count={m.value}>
                  {m.value}
                </p>
                <p className="label mt-3 !text-fg/70">{m.label}</p>
                <div aria-hidden className="pd-metric-bar mt-6" />
              </div>
            ))}
          </div>
        ) : (
          p.verdict && (
            <div className="pd-reveal pd-glass pd-statement self-end md:col-span-6">
              <span className="label pd-tint">In one line</span>
              <p className="mt-6 text-2xl font-medium leading-snug tracking-tight md:text-3xl">{p.verdict.statement}</p>
            </div>
          )
        )}
      </section>

      {/* ── friction → move ────────────────────────────────── */}
      {p.challenges && (
        <section className="mx-auto max-w-[1400px] px-gutter py-20 md:py-28" aria-label="Challenges">
          <div className="mb-12 flex flex-col justify-between gap-6 md:flex-row md:items-end">
            <div>
              <SectionLabel n={num()}>Friction → Move</SectionLabel>
              <h2 className="pd-reveal pd-h2">What was hard, and what answered it.</h2>
            </div>
          </div>
          <div className="grid gap-4 md:grid-cols-3">
            {p.challenges.map((c, k) => (
              <div key={c.title} className="pd-reveal pd-glass pd-card group flex flex-col">
                <div className="flex items-center justify-between border-b border-fg/10 pb-4">
                  <span className="label">Friction {pad(k + 1)}</span>
                  <span className="label !text-fg/30">Solved</span>
                </div>
                <h3 className="mt-6 text-2xl font-semibold tracking-tight">{c.title}</h3>
                <p className="mt-3 text-[15px] leading-relaxed text-fg/60">{c.problem}</p>
                <div className="pd-move mt-auto">
                  <span className="label pd-tint flex items-center gap-2">
                    <span aria-hidden className="pd-move-dot" /> The move
                  </span>
                  <p className="mt-2.5 text-[15px] leading-relaxed text-fg/90">{c.move}</p>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* ── architecture ───────────────────────────────────── */}
      {p.architecture && (
        <section className="mx-auto grid max-w-[1400px] gap-12 px-gutter py-20 md:grid-cols-12 md:py-28" aria-label="Architecture">
          <div className="md:col-span-4">
            <SectionLabel n={num()}>Architecture</SectionLabel>
            <h2 className="pd-reveal pd-h2">How it&apos;s wired.</h2>
            <p className="pd-reveal mt-5 max-w-[34ch] text-fg/60">From the screen down to the data — every layer, one request&apos;s path.</p>
          </div>
          <ol className="pd-stack md:col-span-8">
            <span aria-hidden className="pd-stack-line">
              <span className="pd-stack-pulse" />
            </span>
            {p.architecture.map((layer, k) => (
              <li key={layer.label} className="pd-reveal pd-layer">
                <span aria-hidden className="pd-layer-node" />
                <span className="label w-8 shrink-0 tabular-nums">{pad(k + 1)}</span>
                <span className="label pd-tint w-28 shrink-0">{layer.label}</span>
                <span className="text-base text-fg/85 md:text-lg">{layer.detail}</span>
              </li>
            ))}
          </ol>
        </section>
      )}

      {/* ── sequence ───────────────────────────────────────── */}
      {p.timeline && (
        <section className="mx-auto max-w-[1400px] px-gutter py-20 md:py-28" aria-label="Process">
          <div className="mb-14 md:text-center">
            <div className="md:flex md:justify-center">
              <SectionLabel n={num()}>Sequence</SectionLabel>
            </div>
            <h2 className="pd-reveal pd-h2">From first visit to live.</h2>
          </div>
          <div className="pd-spine relative mx-auto max-w-5xl">
            <span aria-hidden className="pd-spine-track">
              <span className="pd-spine-fill" />
            </span>
            <ol className="space-y-10 md:space-y-16">
              {p.timeline.map((step, k) => (
                <li key={step.phase} className="relative grid pl-12 md:grid-cols-2 md:gap-24 md:pl-0">
                  <span aria-hidden className="pd-spine-node" />
                  <div className={`pd-reveal pd-glass pd-card ${k % 2 ? "md:col-start-2" : "md:text-right"}`}>
                    <span className="label pd-tint">
                      {pad(k + 1)} / {step.phase}
                    </span>
                    <h3 className="mt-3 text-2xl font-semibold tracking-tight">{step.title}</h3>
                    <p className="mt-3 text-[15px] leading-relaxed text-fg/60">{step.description}</p>
                  </div>
                </li>
              ))}
            </ol>
          </div>
        </section>
      )}

      {/* ── outcome ────────────────────────────────────────── */}
      {p.outcomes && p.verdict && (
        <section className="mx-auto max-w-[1400px] px-gutter py-20 md:py-28" aria-label="Outcome">
          <div className="pd-reveal pd-glass pd-outcome grid gap-10 md:grid-cols-12">
            <div className="md:col-span-6">
              <SectionLabel n={num()}>Outcome</SectionLabel>
              <p className="display text-[13vw] md:text-[5.2vw]">{p.verdict.title}</p>
              <p className="mt-6 max-w-[42ch] text-lg leading-relaxed text-fg/70">{p.verdict.statement}</p>
            </div>
            <ul className="space-y-5 self-end md:col-span-6">
              {p.outcomes.map((o) => (
                <li key={o} className="flex gap-4 border-b border-fg/10 pb-5 text-base leading-relaxed text-fg/85 md:text-lg">
                  <span aria-hidden className="pd-check">✓</span>
                  {o}
                </li>
              ))}
            </ul>
          </div>
        </section>
      )}

      {/* ── onward ─────────────────────────────────────────── */}
      <section className="mx-auto max-w-[1400px] px-gutter pb-28 pt-12" aria-label="More projects">
        <div className="grid gap-4 md:grid-cols-2">
          <Onward project={prev} dir="prev" />
          <Onward project={next} dir="next" />
        </div>
        <div className="pd-reveal mt-20 flex flex-col items-start justify-between gap-6 border-t border-fg/10 pt-10 md:flex-row md:items-end">
          <p className="max-w-[22ch] text-3xl font-semibold leading-tight tracking-tight md:text-5xl">Building something like this?</p>
          <CopyEmail className="text-xl md:text-3xl" />
        </div>
      </section>
    </article>
  );
}

function SectionLabel({ n, children }: { n: string; children: React.ReactNode }) {
  return (
    <p className="pd-reveal mb-6 flex items-center gap-3">
      <span aria-hidden className="pd-dot" />
      <span className="label pd-tint">
        {n} — {children}
      </span>
    </p>
  );
}

function Onward({ project, dir }: { project: Project; dir: "prev" | "next" }) {
  const next = dir === "next";
  return (
    <Link
      href={`/projects/${project.slug}`}
      className={`pd-reveal pd-onward group ${next ? "md:text-right" : ""}`}
      style={{ "--tint": project.tint } as React.CSSProperties}
      data-cursor="view"
    >
      <Image src={project.cover} alt="" fill sizes="(min-width: 768px) 50vw, 100vw" className="pd-onward-img object-cover object-top" />
      <span className="pd-onward-wash" aria-hidden />
      <span className={`relative flex h-full flex-col justify-end p-7 md:p-9 ${next ? "md:items-end" : ""}`}>
        <span className="label">{next ? "Next project →" : "← Previous project"}</span>
        <span className="display mt-3 text-[11vw] transition-colors duration-500 group-hover:text-[var(--tint)] md:text-[4.4vw]">
          {project.title}
        </span>
        <span className="label mt-3 !text-fg/50">{project.category}</span>
      </span>
    </Link>
  );
}
