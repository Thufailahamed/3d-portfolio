"use client";

import Image from "next/image";
import Link from "next/link";
import { useRef } from "react";
import CopyEmail from "@/components/CopyEmail";
import { curtain } from "@/components/Curtain";
import { person, projects, type Project } from "@/content/site";
import { gsap, ScrollTrigger, SplitText, useGSAP } from "@/lib/gsap";
import { dotRuler, halftoneWipe } from "./canvasFx";
import DotViz, { type DotKind } from "./DotViz";
import { grotesk } from "./font";
import Halftone from "./Halftone";

const pad = (n: number) => String(n).padStart(2, "0");
const host = (url: string) => url.replace(/^https?:\/\//, "").replace(/\/$/, "");
const WORDS = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight"];
const VIZ: DotKind[] = ["bars", "steps", "marquee", "fill"];
// the light surface the halftone wipe resolves into
const LIGHT = "#e7e7e7";

type Props = { project: Project; index: number; total: number; prev: Project; next: Project };

/**
 * The project case study, entered through the crystal. A monochrome, printed-feeling page:
 * a halftone light over grey, a black story told against a dot ruler, then a halftone wipe
 * into light where the work orbits, all set in Overused Grotesk.
 */
export default function ProjectDetail({ project, index, total, prev, next }: Props) {
  const root = useRef<HTMLElement>(null);
  const p = project;

  // the story: the build sequence if there is one, otherwise each friction and its move
  const story = p.timeline
    ? p.timeline.map((s) => ({ label: s.phase, lead: s.title, body: s.description }))
    : (p.challenges ?? []).map((c) => ({ label: c.title, lead: c.title, body: c.move }));
  const count = `${WORDS[story.length] ?? story.length} ${p.timeline ? "steps" : "moves"}`;

  // the bento: three numbers and the stack, each with its own dot display
  const tiles = [
    ...(p.metrics ?? p.facts?.map((f) => ({ value: f.value, label: f.label })) ?? []).slice(0, 3).map((m) => ({ head: m.value, text: m.label })),
    { head: "Stack", text: p.stack.join(" · ") },
  ];
  const lead = p.metrics?.[0];
  const status = p.facts?.find((f) => f.label === "Status")?.value ?? "Live";
  const ring = [...projects.slice(index), ...projects.slice(0, index)];
  const outcomes = p.outcomes ?? p.challenges?.map((c) => c.move);

  useGSAP(
    () => {
      const el = root.current!;
      const html = document.documentElement;
      const q = <T extends HTMLElement = HTMLElement>(s: string) => el.querySelector<T>(s);
      const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;

      // the fixed header reads ink on paper, paper on the dark
      for (const s of gsap.utils.toArray<HTMLElement>("[data-surface]")) {
        ScrollTrigger.create({
          trigger: s,
          start: "top 40px",
          end: "bottom 40px",
          onToggle: (self) => self.isActive && (html.dataset.surface = s.dataset.surface),
        });
      }

      // ── the wordmark: fitted edge to edge, its letters rolling over as the hero leaves
      const mark = q(".pd-mark")!;
      // (a short title would grow too tall, so it is capped and its letters spread across instead)
      const fit = () => {
        mark.style.width = "max-content";
        mark.style.fontSize = "100px";
        const size = (100 * mark.parentElement!.clientWidth) / mark.scrollWidth;
        const cap = innerHeight * 0.26;
        mark.style.fontSize = `${Math.min(size, cap)}px`;
        mark.style.width = size > cap ? "100%" : "max-content";
      };
      fit();
      document.fonts?.ready.then(fit);
      const ro = new ResizeObserver(fit);
      ro.observe(mark.parentElement!);

      // arriving through the crystal: the curtain dissolves over the hero
      const through = curtain.reveal();
      const delay = through ? 0.55 : 0.2;
      const head = q(".pd-hero-head")!;
      const split = SplitText.create(head, { type: "lines", mask: "lines" });

      if (!reduce) {
        gsap.from(split.lines, { yPercent: 110, duration: 1.3, stagger: 0.09, ease: "expo.out", delay });
        gsap.from(".pd-ch-in", { yPercent: 50, duration: 1.4, stagger: 0.045, ease: "expo.out", delay: delay + 0.1 });
        gsap.from(".pd-in", { autoAlpha: 0, y: 18, duration: 1, stagger: 0.07, ease: "power3.out", delay: delay + 0.35 });
        gsap.fromTo(
          ".pd-ch-in",
          { yPercent: 0 },
          {
            yPercent: -50,
            ease: "none",
            stagger: 0.06,
            immediateRender: false,
            scrollTrigger: { trigger: ".pd-hero", start: "top top", end: "bottom top", scrub: 0.4 },
          },
        );
        gsap.to(".pd-hero-fx", { yPercent: 18, autoAlpha: 0.2, ease: "none", scrollTrigger: { trigger: ".pd-hero", start: "top top", end: "bottom top", scrub: true } });
      }

      // reading progress
      gsap.fromTo(".pd-progress", { scaleX: 0 }, { scaleX: 1, ease: "none", scrollTrigger: { start: 0, end: "max", scrub: 0.3 } });

      // ── the backdrop: grey, sinking into black, then light once the wipe has passed
      gsap.fromTo(".pd-bg-black", { opacity: 0 }, { opacity: 1, ease: "none", scrollTrigger: { trigger: ".pd-bento", start: "top 75%", end: "top 5%", scrub: true } });
      const light = q(".pd-bg-light")!;

      // ── bento: tiles lift in, and the numbers count up
      ScrollTrigger.batch(".pd-tile", {
        start: "top 90%",
        onEnter: (b) => gsap.fromTo(b, { autoAlpha: 0, y: 60, scale: 0.96 }, { autoAlpha: 1, y: 0, scale: 1, duration: 1.2, stagger: 0.08, ease: "expo.out", overwrite: true }),
      });
      gsap.set(".pd-tile", { autoAlpha: 0 });
      for (const n of gsap.utils.toArray<HTMLElement>("[data-count]")) {
        const m = n.dataset.count!.match(/^(\d+(?:\.(\d+))?)(.*)$/);
        if (!m) continue;
        const dp = m[2]?.length ?? 0;
        const width = m[1].split(".")[0].length;
        const fmt = (v: number) => `${v.toFixed(dp).padStart(width + (dp ? dp + 1 : 0), "0")}${m[3]}`;
        const o = { v: 0 };
        n.textContent = fmt(0);
        gsap.to(o, { v: parseFloat(m[1]), duration: 1.8, ease: "power3.out", scrollTrigger: { trigger: n, start: "top 92%", once: true }, onUpdate: () => void (n.textContent = fmt(o.v)) });
      }

      // ── story: one pinned stage; the ruler scrolls and each sentence lights word by word
      const stage = q(".pd-story");
      if (stage) {
        const blocks = gsap.utils.toArray<HTMLElement>(".pd-say", stage);
        const words = blocks.map((b) => gsap.utils.toArray<HTMLElement>(".pd-w", b));
        const ruler = dotRuler(q<HTMLCanvasElement>(".pd-ruler")!, story.map((s) => s.label));
        const steps = story.length;
        let on = -1;
        const paint = (pr: number) => {
          const at = Math.min(blocks.length - 0.001, pr * blocks.length);
          const k = Math.floor(at);
          if (k !== on) {
            blocks.forEach((b, i) => b.classList.toggle("is-on", i === k));
            on = k;
          }
          words.forEach((ws, i) => {
            const local = Math.max(0, Math.min(1, (at - i) / 0.7));
            ws.forEach((w, j) => (w.style.opacity = String(0.16 + 0.84 * Math.max(0, Math.min(1, local * ws.length - j)))));
          });
          ruler(Math.max(0, Math.min(1, (at - 1) / Math.max(1, steps - 1))));
        };
        paint(0);
        ScrollTrigger.create({ trigger: stage, start: "top top", end: "bottom bottom", onUpdate: (self) => paint(self.progress) });
      }

      // ── the wipe: dots swell into light; the light surface takes over as it completes
      const wipe = q(".pd-wipe");
      if (wipe) {
        const draw = halftoneWipe(q<HTMLCanvasElement>(".pd-wipe-canvas")!, LIGHT);
        draw(0);
        ScrollTrigger.create({
          trigger: wipe,
          start: "top bottom",
          end: "bottom bottom",
          onUpdate: (self) => {
            draw(self.progress);
            light.style.opacity = String(Math.max(0, Math.min(1, (self.progress - 0.9) / 0.1)));
          },
          onLeaveBack: () => void (light.style.opacity = "0"),
          onLeave: () => void (light.style.opacity = "1"),
        });
      }

      // ── the orbit: every project's screen circles the title as you scroll
      if (!reduce) {
        gsap.fromTo(
          ".pd-ring",
          { "--spin": "30deg" },
          { "--spin": "-250deg", ease: "none", scrollTrigger: { trigger: ".pd-orbit", start: "top top", end: "bottom bottom", scrub: 0.8 } },
        );
        gsap.from(".pd-scene", { scale: 0.7, autoAlpha: 0, ease: "power2.out", scrollTrigger: { trigger: ".pd-orbit", start: "top 80%", end: "top top", scrub: true } });
      }

      // ── everything else rises as it enters, headings unmasking line by line
      const items = gsap.utils.toArray<HTMLElement>(".pd-reveal");
      gsap.set(items, { autoAlpha: 0, y: 40 });
      ScrollTrigger.batch(items, {
        start: "top 90%",
        onEnter: (b) => gsap.to(b, { autoAlpha: 1, y: 0, duration: 1.2, stagger: 0.08, ease: "expo.out", overwrite: true }),
      });
      const splits = gsap.utils.toArray<HTMLElement>(".pd-split").map((h) => {
        const s = SplitText.create(h, { type: "lines", mask: "lines" });
        if (!reduce) gsap.from(s.lines, { yPercent: 105, duration: 1.2, stagger: 0.08, ease: "expo.out", scrollTrigger: { trigger: h, start: "top 88%", once: true } });
        return s;
      });

      return () => {
        ro.disconnect();
        split.revert();
        splits.forEach((s) => s.revert());
        delete html.dataset.surface;
      };
    },
    { scope: root },
  );

  return (
    <article ref={root} className={`pd ${grotesk.variable}`} style={{ "--tint": p.tint } as React.CSSProperties}>
      {/* the backdrop: three surfaces, drifting light, and the printed dot lattice */}
      <div aria-hidden className="pd-bg">
        <div className="pd-bg-layer pd-bg-grey" />
        <div className="pd-bg-layer pd-bg-black" />
        <div className="pd-bg-layer pd-bg-light" />
        <div className="pd-blobs">
          <i />
          <i />
          <i />
        </div>
      </div>
      <div aria-hidden className="pd-progress fixed inset-x-0 top-0 z-[35] h-[2px] origin-left" />
      <div aria-hidden className="pd-topfade pointer-events-none fixed inset-x-0 top-0 z-[30] h-24" />

      {/* ── hero ───────────────────────────────────────────── */}
      <header className="pd-hero pd-dark relative flex min-h-svh flex-col overflow-hidden" data-surface="dark">
        <div className="pd-hero-fx absolute inset-0">
          <Halftone seed={index * 1.7} className="absolute inset-0 h-full w-full" />
        </div>

        <nav className="pd-in pd-shell relative z-10 flex items-center justify-between pt-24 md:pt-28" aria-label="Project navigation">
          <Link href="/projects" scroll={false} className="pd-back pd-chip-btn" data-cursor="view">
            <span aria-hidden className="pd-back-arrow">←</span> All work
          </Link>
          <span className="pd-caption tabular-nums">
            Project {pad(index + 1)} <span className="pd-soft">/ {pad(total)}</span>
          </span>
        </nav>

        <div className="pd-shell relative z-10 mt-auto grid gap-10 pb-8 md:grid-cols-12 md:items-end md:pb-10">
          <div className="order-2 md:order-1 md:col-span-5">
            {lead && (
              <div className="pd-in">
                <p className="pd-caption">In numbers</p>
                <p className="pd-price mt-1">
                  {lead.value} <span className="pd-soft">/{lead.label.toLowerCase()}</span>
                </p>
              </div>
            )}
            <div className="mt-5 flex flex-wrap gap-2.5">
              {p.link && (
                <a href={p.link} target="_blank" rel="noreferrer" className="pd-in pd-btn pd-btn-tint" data-cursor="view">
                  <span className="pd-btn-dot" aria-hidden>
                    →
                  </span>
                  <span className="flex flex-col leading-none">
                    {p.liveLabel ?? "Visit live site"}
                    <small>{host(p.link)}</small>
                  </span>
                </a>
              )}
              <a href="#approach" className="pd-in pd-btn pd-btn-ghost">
                <span className="pd-btn-dot" aria-hidden>
                  ↓
                </span>
                Read the case
              </a>
            </div>
          </div>
          <div className="order-1 md:order-2 md:col-span-6 md:col-start-7 md:self-start md:pb-24">
            <p className="pd-in pd-caption mb-4 flex items-center gap-2.5">
              <span aria-hidden className="pd-live" /> {p.category} <span className="pd-soft">· {p.year}</span>
            </p>
            <h1 className="pd-hero-head">
              <span>{p.title}.</span> <span className="pd-soft">{p.tagline}</span>
            </h1>
          </div>
        </div>

        <div className="pd-shell relative z-10 pb-6">
          <div className="pd-rule" />
          <div className="overflow-hidden" aria-hidden>
            <p className="pd-mark">
              {[...p.title.toUpperCase()].map((c, k) =>
                c === " " ? (
                  <span key={k} className="pd-ch-space" />
                ) : (
                  <span key={k} className="pd-ch">
                    <span className="pd-ch-in">
                      <span>{c}</span>
                      <span>{c}</span>
                    </span>
                  </span>
                ),
              )}
            </p>
          </div>
        </div>
      </header>

      {/* ── approach: a bento of dark glass ────────────────── */}
      <section id="approach" className="pd-bento pd-dark pd-shell scroll-mt-20 py-16 md:py-24" aria-label="Overview" data-surface="dark">
        <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
          <article className="pd-tile pd-glass flex flex-col p-7 md:p-10">
            <div className="flex">
              <span className="pd-avatar" style={{ background: p.tint, color: "#111" }}>
                {p.title[0]}
              </span>
              <span className="pd-avatar -ml-2.5 bg-[#2a2a2a]">TA</span>
            </div>
            <h2 className="mt-8 text-[clamp(1.4rem,1.1rem+0.8vw,1.9rem)] leading-[1.05] tracking-[-0.045em]">
              {p.verdict?.title ?? `${p.title}.`} <span className="pd-soft block">{p.category}.</span>
            </h2>
            <div className="mt-6 space-y-3 text-[15px] leading-snug tracking-[-0.01em] text-[var(--soft)]">
              {p.description.map((d, k) => (
                <p key={k}>{d}</p>
              ))}
            </div>
            {p.link && (
              <a href={p.link} target="_blank" rel="noreferrer" className="pd-btn pd-btn-ghost mt-8 self-end md:mt-auto" data-cursor="view">
                <span className="pd-btn-dot" aria-hidden>
                  ↗
                </span>
                Open it
              </a>
            )}
          </article>
          <div className="grid gap-3 sm:grid-cols-2">
            {tiles.map((t, k) => (
              <article key={t.head + k} className="pd-tile pd-glass grid grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)] gap-4 p-4 md:p-5">
                <div className="flex flex-col p-2 md:p-3">
                  <p className="text-[clamp(1.5rem,1.1rem+1.2vw,2.4rem)] font-medium leading-none tracking-[-0.05em] tabular-nums" data-count={k < 3 ? t.head : undefined}>
                    {t.head}
                  </p>
                  <p className="mt-2 text-[15px] leading-tight tracking-[-0.015em] text-[var(--soft)]">{t.text}</p>
                  <p className="pd-caption mt-auto pt-6">{pad(k + 1)}.</p>
                </div>
                <div className="pd-well">
                  <DotViz kind={VIZ[k]} seed={index + k} className="h-full w-full" />
                </div>
              </article>
            ))}
          </div>
        </div>
      </section>

      {/* ── story: pinned, told against the dot ruler ──────── */}
      {story.length > 0 && (
        <section className="pd-story pd-dark relative" style={{ height: `${(story.length + 1) * 95 + 100}vh` }} aria-label="Process" data-surface="dark">
          <div className="sticky top-0 grid h-svh items-center overflow-hidden md:grid-cols-2">
            <canvas aria-hidden className="pd-ruler absolute inset-y-0 left-0 hidden h-full w-1/2 md:block" />
            <div className="pd-shell md:col-start-2 md:!pl-0">
              <div className="relative h-[60vh]">
              <div className="pd-say">
                <p>
                  <Words text={p.timeline ? "A clear process," : "What was hard,"} />{" "}
                  <span className="pd-shimmer">
                    <Words text={p.timeline ? `in ${count}.` : `and the ${count} that answered it.`} />
                  </span>
                </p>
              </div>
              {story.map((s, k) => (
                <div key={s.label} className="pd-say">
                  <p className="pd-caption mb-5 tabular-nums">
                    {pad(k + 1)} / {pad(story.length)} — {s.label}
                  </p>
                  <p>
                    <Words text={`${s.lead}.`} accent /> <Words text={s.body} />
                  </p>
                </div>
              ))}
              </div>
            </div>
          </div>
        </section>
      )}

      {/* ── the wipe: dark into light ──────────────────────── */}
      <div className="pd-wipe relative h-[130vh]" aria-hidden data-surface="dark">
        <canvas className="pd-wipe-canvas sticky top-0 h-svh w-full" />
      </div>

      {/* ── the work, in orbit ─────────────────────────────── */}
      <section className="pd-orbit pd-light relative h-[280vh]" aria-label="The product" data-surface="paper">
        <div className="sticky top-0 flex h-svh items-center justify-center overflow-hidden [perspective:1600px]">
          <div className="pd-scene">
            <p className="pd-orbit-title">
              {p.title}, on screen. <span className="pd-soft">{status}.</span>
            </p>
            <div className="pd-ring">
              {ring.map((r, k) => (
                <Link
                  key={r.slug}
                  href={`/projects/${r.slug}`}
                  className="pd-card"
                  // alternate heights, so the title always shows between the screens
                  style={{ "--a": `${(360 / ring.length) * k}deg`, "--y": k % 2 ? "-34%" : "30%" } as React.CSSProperties}
                  data-cursor="view"
                  aria-label={r.slug === p.slug ? `${r.title} (this project)` : `Open ${r.title}`}
                >
                  <Image src={r.cover} alt="" fill sizes="420px" className="object-cover object-top" />
                </Link>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ── friction → move, as white panels ───────────────── */}
      {p.timeline && p.challenges && (
        <section className="pd-light pd-shell py-16 md:py-24" aria-label="Challenges" data-surface="paper">
          <Kicker n="01" of="03">
            Friction
          </Kicker>
          <h2 className="pd-h2 pd-split">
            What was hard. <span className="pd-soft">What answered it.</span>
          </h2>
          <div className="mt-10 grid gap-3">
            {p.challenges.map((c, k) => (
              <article key={c.title} className="pd-reveal pd-panel grid gap-6 p-3 md:grid-cols-[220px_minmax(0,1fr)_minmax(0,1fr)] md:gap-10">
                <div className="pd-well pd-well-grey aspect-square md:aspect-auto md:h-[220px]">
                  <DotViz kind="glyph" text={String(k + 1)} seed={k} className="h-full w-full" />
                </div>
                <div className="px-3 md:py-5">
                  <h3 className="text-[1.6rem] font-medium leading-tight tracking-[-0.045em]">{c.title}</h3>
                  <p className="mt-2 text-[15px] leading-snug text-[var(--soft)]">{c.problem}</p>
                </div>
                <div className="px-3 pb-4 md:py-5 md:pr-8">
                  <p className="pd-caption">The move</p>
                  <p className="mt-3 flex gap-3 text-[16px] leading-snug tracking-[-0.01em]">
                    <span aria-hidden className="pd-tick">✓</span>
                    {c.move}
                  </p>
                </div>
              </article>
            ))}
          </div>
        </section>
      )}

      {/* ── architecture, as a summary ─────────────────────── */}
      {p.architecture && (
        <section className="pd-light pd-shell py-16 md:py-24" aria-label="Architecture" data-surface="paper">
          <div className="grid gap-10 md:grid-cols-12">
            <div className="md:col-span-5">
              <Kicker n={p.timeline && p.challenges ? "02" : "01"} of={p.timeline && p.challenges ? "03" : "02"}>
                Architecture
              </Kicker>
              <h2 className="pd-h2 pd-split">
                How it&apos;s wired. <span className="pd-soft">Layer by layer.</span>
              </h2>
              <p className="pd-reveal mt-6 max-w-[34ch] text-[var(--soft)]">From the screen down to the data — one request&apos;s path through every layer.</p>
            </div>
            <div className="pd-reveal pd-panel p-3 md:col-span-7">
              <div className="pd-summary">
                <div>
                  <p className="text-2xl font-medium tracking-[-0.045em]">{p.title}</p>
                  <p className="mt-1 max-w-[36ch] text-[14px] leading-snug opacity-75">{p.stack.join(" · ")}</p>
                </div>
                <span className="pd-caption !text-white/80">{pad(p.architecture.length)} layers</span>
              </div>
              <ol className="px-5 pb-3 pt-2 md:px-7">
                {p.architecture.map((l, k) => (
                  <li key={l.label} className="pd-layer">
                    <span className="flex items-baseline gap-3">
                      <span className="pd-caption tabular-nums">{pad(k + 1)}</span>
                      <span className="font-medium">+ {l.label}</span>
                    </span>
                    <span className="text-right text-[15px] text-[var(--soft)]">{l.detail}</span>
                  </li>
                ))}
              </ol>
            </div>
          </div>
        </section>
      )}

      {/* ── outcome, on a dashed card ──────────────────────── */}
      {p.verdict && (
        <section className="pd-light pd-shell py-16 md:py-24" aria-label="Outcome" data-surface="paper">
          <div className="pd-reveal pd-outcome relative mx-auto max-w-[920px] px-6 py-16 text-center md:px-16 md:py-24">
            <svg aria-hidden className="pd-dash absolute inset-3 h-[calc(100%-24px)] w-[calc(100%-24px)]" preserveAspectRatio="none">
              <rect x="1" y="1" rx="22" />
            </svg>
            <svg aria-hidden viewBox="0 0 48 48" className="pd-cube mx-auto h-14 w-14">
              <path d="M24 4 41 14v20L24 44 7 34V14Z" fill="none" stroke="currentColor" strokeWidth="2.5" strokeDasharray="7 5" />
              <path d="M7 14l17 10 17-10M24 24v20" fill="none" stroke="currentColor" strokeWidth="2.5" />
            </svg>
            <p className="pd-caption mt-8">Outcome</p>
            <h2 className="pd-h2 pd-split mx-auto mt-3 max-w-[16ch]">{p.verdict.title}</h2>
            <p className="pd-reveal mx-auto mt-5 max-w-[44ch] text-lg leading-snug tracking-[-0.02em] text-[var(--soft)] md:text-xl">{p.verdict.statement}</p>
            {outcomes && (
              <ul className="mx-auto mt-12 grid max-w-[760px] gap-3 text-left md:grid-cols-3">
                {outcomes.map((o) => (
                  <li key={o} className="pd-reveal flex gap-3 rounded-2xl bg-white/70 p-4 text-[14px] leading-snug tracking-[-0.01em]">
                    <span aria-hidden className="pd-tick">✓</span>
                    {o}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>
      )}

      {/* ── the end of the page ────────────────────────────── */}
      <footer className="pd-light pd-shell pb-16 pt-20 md:pt-32" data-surface="paper">
        <div className="grid gap-14 md:grid-cols-12">
          <div className="md:col-span-7">
            <p className="pd-h2 pd-split">
              <span className="pd-soft">This is only the end of the case.</span> Imagine what comes next.
            </p>
            <div className="pd-reveal mt-8 flex flex-wrap gap-2.5">
              <Link href="/contact" className="pd-btn pd-btn-tint" data-cursor="view">
                <span className="pd-btn-dot" aria-hidden>
                  →
                </span>
                <span className="flex flex-col leading-none">
                  Start a project
                  <small>Reply within a day</small>
                </span>
              </Link>
              <Link href={`/projects/${next.slug}`} className="pd-btn pd-btn-ghost" data-cursor="view">
                <span className="pd-btn-dot" aria-hidden>
                  →
                </span>
                Next: {next.title}
              </Link>
            </div>
            <div className="pd-reveal mt-10">
              <CopyEmail className="text-lg md:text-xl" />
            </div>
          </div>
          <nav className="pd-reveal grid grid-cols-2 gap-8 text-[15px] md:col-span-5" aria-label="More work">
            <div>
              <p className="pd-caption mb-4">More work</p>
              <ul className="space-y-1.5">
                {projects.map((r) => (
                  <li key={r.slug}>
                    <Link href={`/projects/${r.slug}`} className="pd-flink" aria-current={r.slug === p.slug ? "page" : undefined}>
                      {r.title}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
            <div className="text-right">
              <p className="pd-caption mb-4">Elsewhere</p>
              <ul className="space-y-1.5">
                <li>
                  <Link href="/projects" className="pd-flink">
                    All work
                  </Link>
                </li>
                <li>
                  <Link href={`/projects/${prev.slug}`} className="pd-flink">
                    Previous
                  </Link>
                </li>
                <li>
                  <Link href="/contact" className="pd-flink">
                    Contact
                  </Link>
                </li>
                {person.socials.map((s) => (
                  <li key={s.href}>
                    <a href={s.href} target="_blank" rel="noreferrer" className="pd-flink">
                      {s.label}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          </nav>
        </div>
        <div className="pd-rule mt-16" />
        <p className="pd-caption mt-5 flex justify-between">
          <span>{person.name}</span>
          <span>{person.location}</span>
        </p>
      </footer>
    </article>
  );
}

/** a sentence split into words the story lights one by one; with `accent`, its last word takes the tint */
function Words({ text, accent = false }: { text: string; accent?: boolean }) {
  const ws = text.split(" ");
  return ws.map((w, k) => (
    <span key={k} className={`pd-w ${accent && k === ws.length - 1 ? "pd-accent" : ""}`}>
      {w}
      {k < ws.length - 1 ? " " : ""}
    </span>
  ));
}

function Kicker({ n, of, children }: { n: string; of: string; children: React.ReactNode }) {
  return (
    <p className="pd-reveal pd-caption mb-4 flex items-center gap-2">
      <span aria-hidden className="pd-live" />
      {children} <span className="tabular-nums">{n}</span>
      <span className="pd-soft -ml-1.5 tabular-nums">/{of}</span>
    </p>
  );
}
