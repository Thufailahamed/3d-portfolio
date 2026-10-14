import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import CopyEmail from "@/components/CopyEmail";
import FullExperienceLink from "@/components/FullExperienceLink";
import Reveal from "@/components/Reveal";
import { about, beats, board, contact, person, projects } from "@/content/site";

export const metadata: Metadata = {
  title: "Lite — Editorial Index",
  description: `${person.intro} A fast, zero-WebGL editorial edition of the portfolio.`,
  alternates: { canonical: "/lite" },
};

const pad = (n: number) => String(n).padStart(2, "0");
const host = (url: string) => url.replace(/^https?:\/\//, "").replace(/\/$/, "");

/** Convert lon/lat to SVG viewBox (1000 × 500 equirectangular) coordinates. */
function mapXY(lon: number, lat: number) {
  const x = ((lon + 180) / 360) * 1000;
  const y = ((90 - lat) / 180) * 500;
  return { x: Math.round(x * 10) / 10, y: Math.round(y * 10) / 10 };
}

const STUDIO_STATS = [
  { value: "06", label: "Production systems live" },
  { value: "252", label: "Row-level security policies" },
  { value: "865", label: "API route handlers shipped" },
  { value: "327", label: "Cloudflare Edge endpoints" },
];

/** The whole site without WebGL: same content, rich architectural editorial layout. */
export default function LitePage() {
  const home = about.places[0];
  const homePt = mapXY(home.lon, home.lat);

  const manifestoChapters = [
    {
      index: "01",
      tag: "Origin // The Rule",
      quote: beats.hero[0],
      detail: "Every database schema, permission boundary and interface starts from a single invariant that holds under pressure.",
    },
    {
      index: "02",
      tag: "Deconstruct // The Fracture",
      quote: beats.fracture.join(" "),
      detail: "Multi-tenant isolation, edge routing and real-time ledgers split across portals while reconciling to one source of truth.",
    },
    {
      index: "03",
      tag: "Scale // The Living System",
      quote: beats.about.join(" "),
      detail: "From PostgreSQL row-level security and pgvector RAG copilots to the final pixel people work in every day.",
    },
  ];

  return (
    <Reveal>
      <div className="relative overflow-hidden">
        {/* Ambient architectural backdrop (zero WebGL) */}
        <div aria-hidden className="loader-grid pointer-events-none fixed inset-0 opacity-65" />
        <div aria-hidden className="lite-wash pointer-events-none absolute inset-x-0 top-0 h-[1100px]" />

        <div className="relative z-10 mx-auto max-w-[1440px] px-gutter pb-14 pt-24 md:pt-32">
          {/* ── Top Telemetry Bar ────────────────────────────────── */}
          <div className="flex flex-wrap items-center justify-between gap-4 border-b border-fg/10 pb-5">
            <div className="flex flex-wrap items-center gap-2.5">
              <span className="label inline-flex items-center gap-2 rounded-full border border-fg/15 bg-fg/[0.03] px-3.5 py-1.5 !text-fg/90">
                <span className="h-1.5 w-1.5 rounded-full bg-accent shadow-[0_0_8px_#c8ff3d]" />
                {person.location} — Lite Edition
              </span>
              <span className="label hidden rounded-full border border-fg/10 px-3 py-1.5 !text-[10px] !text-fg/50 sm:inline-block">
                06.93°N · 079.85°E · Zero-WebGL
              </span>
            </div>

            <nav aria-label="Section jump" className="flex flex-wrap items-center gap-2">
              <a href="#work" className="label rounded-full border border-fg/12 px-3 py-1.5 transition-colors hover:border-fg/40 hover:!text-fg">
                Work ({pad(projects.length)})
              </a>
              <a href="#about" className="label rounded-full border border-fg/12 px-3 py-1.5 transition-colors hover:border-fg/40 hover:!text-fg">
                Studio &amp; Reach
              </a>
              <a href="#contact" className="label rounded-full border border-fg/12 px-3 py-1.5 transition-colors hover:border-fg/40 hover:!text-fg">
                Contact
              </a>
              <FullExperienceLink className="label rounded-full border border-accent/40 bg-accent/10 px-3.5 py-1.5 !text-accent transition-all hover:bg-accent hover:!text-bg" />
            </nav>
          </div>

          {/* ── 01 // Hero + Studio Dossier ──────────────────────── */}
          <section aria-labelledby="lite-title" className="border-b border-fg/10 py-14 md:py-20">
            <div className="grid items-start gap-12 lg:grid-cols-12 lg:gap-10">
              {/* Left column: Monumental Headline & Intro */}
              <div className="lg:col-span-7">
                <p className="label mb-4 flex items-center gap-2.5 !text-accent">
                  <span aria-hidden className="pd-dot" />
                  01 — Architecture · SaaS · Agentic AI · Cloud
                </p>

                <h1 id="lite-title" className="display text-[14.5vw] leading-[0.82] lg:text-[7.2vw]">
                  {person.shortName}
                </h1>
                <p className="display mt-2 text-[6.8vw] text-fg/75 lg:text-[3.1vw]">{person.role}</p>

                <p className="reveal mt-8 max-w-[56ch] text-lg leading-relaxed text-fg/78 md:text-xl">
                  {person.intro}
                </p>

                <div className="reveal mt-9 flex flex-wrap items-center gap-3">
                  <FullExperienceLink className="pd-cta" />
                  <a href="#work" className="contact-btn !py-4 !px-6 !text-xs">
                    Explore {pad(projects.length)} systems <span aria-hidden>↓</span>
                  </a>
                  <Link href="/board" className="contact-btn !py-4 !px-6 !text-xs">
                    Investigation board <span aria-hidden>↗</span>
                  </Link>
                </div>

                {/* Studio Headline Metrics Row */}
                <dl className="reveal mt-12 grid grid-cols-2 gap-3 sm:grid-cols-4">
                  {STUDIO_STATS.map((st) => (
                    <div key={st.label} className="pd-glass px-4 py-4">
                      <dt className="sr-only">{st.label}</dt>
                      <dd className="display text-3xl text-accent md:text-4xl">{st.value}</dd>
                      <dd className="mt-1.5 font-mono text-[10px] uppercase tracking-wider text-fg/55">{st.label}</dd>
                    </div>
                  ))}
                </dl>
              </div>

              {/* Right column: Archival Production Ledger Card */}
              <aside aria-label="Production systems index" className="reveal pd-glass p-6 md:p-7 lg:col-span-5">
                <div className="flex items-center justify-between border-b border-fg/10 pb-4">
                  <div className="flex items-center gap-2.5">
                    <span className="h-2 w-2 rounded-full bg-[#ff3b2f] shadow-[0_0_8px_#ff3b2f]" />
                    <span className="label !text-fg/90">SynapX // Production Index</span>
                  </div>
                  <span className="label !text-[10px]">Colombo Desk</span>
                </div>

                <p className="mt-3.5 text-xs leading-relaxed text-fg/60">
                  Six live software systems engineered end to end from Colombo. Select a file to jump to its brief or open its full case study.
                </p>

                <ol className="mt-5 divide-y divide-fg/10">
                  {projects.map((p, i) => (
                    <li key={p.slug}>
                      <Link
                        href={`/projects/${p.slug}`}
                        className="group flex items-center justify-between gap-4 py-3.5 transition-colors hover:bg-fg/[0.02]"
                      >
                        <div className="flex min-w-0 items-center gap-3.5">
                          <span
                            aria-hidden
                            className="h-2.5 w-2.5 shrink-0 rounded-full transition-transform group-hover:scale-125"
                            style={{ backgroundColor: p.tint, boxShadow: `0 0 10px ${p.tint}` }}
                          />
                          <span className="font-mono text-xs tabular-nums text-fg/40">{pad(i + 1)}</span>
                          <div className="min-w-0">
                            <p className="truncate font-display text-lg font-semibold uppercase tracking-tight text-fg transition-colors group-hover:text-accent">
                              {p.title}
                            </p>
                            <p className="truncate font-mono text-[10px] uppercase tracking-wider text-fg/50">
                              {p.category}
                            </p>
                          </div>
                        </div>

                        <div className="flex shrink-0 items-center gap-3">
                          {p.metrics?.[0] && (
                            <span
                              className="hidden rounded-full border border-fg/12 px-2.5 py-0.5 font-mono text-[10px] font-semibold sm:inline-block"
                              style={{ color: p.tint }}
                            >
                              {p.metrics[0].value} {p.metrics[0].label.split(" ")[0]}
                            </span>
                          )}
                          <span
                            aria-hidden
                            className="font-mono text-xs text-fg/40 transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5 group-hover:text-fg"
                          >
                            ↗
                          </span>
                        </div>
                      </Link>
                    </li>
                  ))}
                </ol>

                <div className="mt-5 flex items-center justify-between border-t border-fg/10 pt-4">
                  <span className="label !text-[10px]">All systems verified in production</span>
                  <Link href="/board" className="label !text-[10px] !text-accent hover:underline">
                    Open 3D Board ↗
                  </Link>
                </div>
              </aside>
            </div>
          </section>

          {/* ── 02 // Engineering Manifesto ──────────────────────── */}
          <section aria-label="Manifesto" className="border-b border-fg/10 py-16 md:py-24">
            <div className="mb-10 flex flex-col justify-between gap-4 md:flex-row md:items-end">
              <div>
                <p className="label mb-3 flex items-center gap-2.5 !text-accent">
                  <span aria-hidden className="pd-dot" />
                  02 — Engineering Philosophy
                </p>
                <h2 className="display text-[10vw] md:text-[4.2vw]">How the work holds its shape.</h2>
              </div>
              <p className="label">Three movements · From invariant to scale</p>
            </div>

            <div className="grid gap-5 md:grid-cols-3">
              {manifestoChapters.map((ch) => (
                <div key={ch.index} className="reveal pd-glass flex flex-col justify-between p-7 md:p-8">
                  <div>
                    <div className="flex items-center justify-between border-b border-fg/10 pb-4">
                      <span className="label !text-accent">{ch.tag}</span>
                      <span className="font-mono text-xs text-fg/35">{ch.index} / 03</span>
                    </div>
                    <p className="mt-7 font-display text-2xl font-semibold leading-tight tracking-[-0.03em] text-fg md:text-3xl">
                      &ldquo;{ch.quote}&rdquo;
                    </p>
                  </div>
                  <p className="mt-6 border-t border-fg/10 pt-4 text-sm leading-relaxed text-fg/62">{ch.detail}</p>
                </div>
              ))}
            </div>
          </section>

          {/* ── 03 // Selected Work (6 Production Dossiers) ──────── */}
          <section id="work" aria-labelledby="work-title" className="scroll-mt-24 border-b border-fg/10 py-16 md:py-24">
            <div className="mb-12 flex flex-col justify-between gap-4 md:flex-row md:items-end">
              <div>
                <p className="label mb-3 flex items-center gap-2.5 !text-accent">
                  <span aria-hidden className="pd-dot" />
                  03 — Selected Work
                </p>
                <h2 id="work-title" className="display text-[11vw] md:text-[5.2vw]">
                  Six systems, one desk.
                </h2>
              </div>
              <p className="max-w-[40ch] text-sm leading-relaxed text-fg/60">
                Multi-tenant SaaS, AI copilots, marketplaces and ERPs — designed, architected and shipped end to end.
              </p>
            </div>

            <ol className="grid gap-8 lg:grid-cols-2">
              {projects.map((p, i) => (
                <li
                  key={p.slug}
                  className="reveal lite-card flex flex-col p-5 md:p-7"
                  style={{ "--tint": p.tint } as React.CSSProperties}
                >
                  {/* Top Dossier Meta Bar */}
                  <div className="mb-4 flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2.5">
                      <span
                        aria-hidden
                        className="h-2 w-2 rounded-full"
                        style={{ backgroundColor: p.tint, boxShadow: `0 0 10px ${p.tint}` }}
                      />
                      <span className="font-mono text-xs font-semibold uppercase tracking-widest text-[color:var(--tint)]">
                        File #{pad(i + 1)}
                      </span>
                      <span className="text-fg/25">·</span>
                      <span className="font-mono text-[11px] uppercase tracking-wider text-fg/65">{p.category}</span>
                    </div>
                    <span className="rounded-full border border-fg/12 bg-fg/[0.03] px-2.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-fg/60">
                      {p.role}
                    </span>
                  </div>

                  {/* Browser Window Screenshot Frame */}
                  <Link href={`/projects/${p.slug}`} className="group block">
                    <div className="overflow-hidden rounded-xl border border-fg/12 bg-[#0b0c10] shadow-xl">
                      <div className="flex items-center justify-between border-b border-fg/10 bg-white/[0.02] px-3.5 py-2">
                        <div className="flex items-center gap-1.5">
                          <span className="h-2 w-2 rounded-full bg-fg/20" />
                          <span className="h-2 w-2 rounded-full bg-fg/20" />
                          <span className="h-2 w-2 rounded-full bg-fg/20" />
                        </div>
                        <span className="font-mono text-[10px] tracking-wider text-fg/50">
                          {p.link ? host(p.link) : `${p.slug}.synapx.lk`}
                        </span>
                        <span className="font-mono text-[10px] font-semibold uppercase tracking-widest text-[color:var(--tint)]">
                          ● Live
                        </span>
                      </div>

                      <div className="relative aspect-[16/10] overflow-hidden bg-black">
                        <Image
                          src={p.cover}
                          alt={`${p.title} — live product screenshot`}
                          fill
                          sizes="(min-width: 1024px) 46vw, 96vw"
                          className="object-cover object-top transition-transform duration-700 group-hover:scale-[1.03]"
                        />
                        <div
                          aria-hidden
                          className="pointer-events-none absolute inset-0"
                          style={{
                            background: "linear-gradient(to top, rgba(11,11,12,0.55) 0%, transparent 40%)",
                          }}
                        />
                      </div>
                    </div>
                  </Link>

                  {/* Title & Tagline */}
                  <div className="mt-6 flex items-baseline justify-between gap-4">
                    <Link href={`/projects/${p.slug}`} className="group">
                      <h3 className="display text-3xl transition-colors group-hover:text-[color:var(--tint)] md:text-4xl">
                        {p.title}
                      </h3>
                    </Link>
                    <span className="label shrink-0 tabular-nums">{p.year}</span>
                  </div>

                  <p className="mt-2.5 text-[15px] leading-relaxed text-fg/80">{p.tagline}</p>
                  {p.description[0] && (
                    <p className="mt-2 text-xs leading-relaxed text-fg/55 line-clamp-2">{p.description[0]}</p>
                  )}

                  {/* 3-Column Metrics Strip */}
                  {p.metrics && (
                    <dl className="mt-5 grid grid-cols-3 gap-2">
                      {p.metrics.map((m) => (
                        <div key={m.label} className="bd-metric">
                          <div className="bd-metric-bar" />
                          <dt className="sr-only">{m.label}</dt>
                          <dd className="display mt-1.5 text-xl text-[color:var(--tint)] md:text-2xl">{m.value}</dd>
                          <dd className="mt-1 text-[10.5px] leading-snug text-fg/60">{m.label}</dd>
                        </div>
                      ))}
                    </dl>
                  )}

                  {/* Stack Chips */}
                  <ul className="mt-5 flex flex-wrap gap-1.5" aria-label="Tech stack">
                    {p.stack.map((s) => (
                      <li
                        key={s}
                        className="rounded-full border border-fg/12 bg-fg/[0.03] px-2.5 py-1 font-mono text-[10px] uppercase tracking-wider text-fg/75"
                      >
                        {s}
                      </li>
                    ))}
                  </ul>

                  {/* Card Footer CTAs */}
                  <div className="mt-auto flex flex-wrap items-center gap-2.5 border-t border-fg/10 pt-5 mt-6">
                    <Link href={`/projects/${p.slug}`} className="bd-cta bd-cta--primary flex-1">
                      <span>Open case study</span>
                      <span aria-hidden>↘</span>
                    </Link>
                    {p.link && (
                      <a href={p.link} target="_blank" rel="noreferrer" className="bd-cta bd-cta--secondary">
                        <span>{p.liveLabel ?? "Live site"}</span>
                        <span aria-hidden>↗</span>
                      </a>
                    )}
                  </div>
                </li>
              ))}
            </ol>
          </section>

          {/* ── 04 // Studio Architecture & 2D Global Reach Map ──── */}
          <section id="about" aria-labelledby="about-lite-title" className="scroll-mt-24 border-b border-fg/10 py-16 md:py-24">
            <div className="grid items-start gap-12 lg:grid-cols-12">
              {/* Left Column: About & Services */}
              <div className="lg:col-span-5">
                <p className="label mb-3 flex items-center gap-2.5 !text-accent">
                  <span aria-hidden className="pd-dot" />
                  04 — Studio &amp; Architecture
                </p>
                <h2 id="about-lite-title" className="display text-[11vw] md:text-[4.6vw]">
                  {about.headline}
                </h2>

                <div className="mt-6 space-y-4 text-base leading-relaxed text-fg/75 md:text-lg">
                  {about.body.map((b, i) => (
                    <p key={i} className="reveal">
                      {b}
                    </p>
                  ))}
                </div>

                <dl className="reveal mt-8 grid grid-cols-2 gap-2.5">
                  {about.annotations.map((n) => (
                    <div key={n.label} className="pd-glass px-4 py-3.5">
                      <dt className="label !text-[10px]">{n.label}</dt>
                      <dd className="mt-1 text-sm font-medium text-fg">{n.value}</dd>
                    </div>
                  ))}
                </dl>

                <div className="reveal mt-8">
                  <p className="label mb-3">Core Capabilities</p>
                  <ul className="grid grid-cols-2 gap-2" aria-label="Services">
                    {about.services.map((s, idx) => (
                      <li
                        key={s}
                        className="flex items-center gap-2.5 rounded-xl border border-fg/12 bg-fg/[0.02] px-3.5 py-2.5 font-mono text-xs text-fg/85"
                      >
                        <span className="text-[10px] text-accent">{pad(idx + 1)}</span>
                        <span>{s}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>

              {/* Right Column: 2D Cartographic Night Map & Global Reach */}
              <div className="reveal lg:col-span-7">
                <div className="pd-glass overflow-hidden p-5 md:p-6">
                  <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <p className="label flex items-center gap-2 !text-fg/90">
                        <span className="h-2 w-2 rounded-full bg-accent shadow-[0_0_8px_#c8ff3d]" />
                        {board.heading}
                      </p>
                      <p className="mt-1 text-xs text-fg/55">
                        Origin Hub: Colombo (06.93°N, 079.85°E) · Global client &amp; deployment reach
                      </p>
                    </div>
                    <Link
                      href="/board"
                      className="label rounded-full border border-fg/15 bg-fg/[0.04] px-3.5 py-1.5 !text-[10px] !text-fg transition-colors hover:border-accent hover:!text-accent"
                    >
                      Interactive 3D Board ↗
                    </Link>
                  </div>

                  {/* 2D Night Earth Map + SVG Great-Circle Arcs */}
                  <div className="relative aspect-[2/1] w-full overflow-hidden rounded-xl border border-fg/15 bg-[#060a14]">
                    <Image
                      src="/earth/night.webp"
                      alt="World at night showing global reach from Colombo"
                      fill
                      sizes="(min-width: 1024px) 55vw, 95vw"
                      className="object-cover opacity-80"
                    />
                    <svg
                      viewBox="0 0 1000 500"
                      className="absolute inset-0 h-full w-full"
                      aria-hidden
                    >
                      {/* Subtle equirectangular graticule */}
                      {[125, 250, 375].map((y) => (
                        <line
                          key={`lat-${y}`}
                          x1={0}
                          y1={y}
                          x2={1000}
                          y2={y}
                          stroke="rgba(180,210,255,0.12)"
                          strokeDasharray={y === 250 ? "8 4" : "2 6"}
                        />
                      ))}
                      {[200, 400, 600, 800].map((x) => (
                        <line
                          key={`lon-${x}`}
                          x1={x}
                          y1={0}
                          x2={x}
                          y2={500}
                          stroke="rgba(180,210,255,0.12)"
                          strokeDasharray="2 6"
                        />
                      ))}

                      {/* Geodesic arcs from Colombo to every global node */}
                      {about.places.slice(1).map((pl) => {
                        const pt = mapXY(pl.lon, pl.lat);
                        const mx = (homePt.x + pt.x) / 2;
                        const my = Math.min(homePt.y, pt.y) - Math.abs(homePt.x - pt.x) * 0.16;
                        return (
                          <g key={pl.city}>
                            <path
                              d={`M ${homePt.x} ${homePt.y} Q ${mx} ${my} ${pt.x} ${pt.y}`}
                              fill="none"
                              stroke="rgba(159, 208, 255, 0.3)"
                              strokeWidth="1.2"
                            />
                            <path
                              d={`M ${homePt.x} ${homePt.y} Q ${mx} ${my} ${pt.x} ${pt.y}`}
                              fill="none"
                              stroke="#c8ff3d"
                              strokeWidth="1.5"
                              strokeOpacity="0.65"
                              className="lite-arc"
                            />
                          </g>
                        );
                      })}

                      {/* City nodes */}
                      {about.places.map((pl, idx) => {
                        const pt = mapXY(pl.lon, pl.lat);
                        const isHome = idx === 0;
                        return (
                          <g key={pl.city} transform={`translate(${pt.x}, ${pt.y})`}>
                            {isHome && (
                              <>
                                <circle r="18" fill="none" stroke="#c8ff3d" strokeOpacity="0.35" strokeWidth="1.2" />
                                <circle r="9" fill="none" stroke="#c8ff3d" strokeOpacity="0.7" strokeWidth="1.5" />
                              </>
                            )}
                            <circle r={isHome ? 4.5 : 3} fill={isHome ? "#c8ff3d" : "#fff1d6"} />
                          </g>
                        );
                      })}
                    </svg>
                  </div>

                  {/* 8-City Telemetry Matrix */}
                  <ul className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4" aria-label="Global hubs">
                    {about.places.map((pl, idx) => {
                      const isHome = idx === 0;
                      return (
                        <li
                          key={pl.city}
                          className={`rounded-lg border px-3 py-2 font-mono text-[10px] ${
                            isHome
                              ? "border-accent/45 bg-accent/10 text-accent"
                              : "border-fg/10 bg-fg/[0.02] text-fg/75"
                          }`}
                        >
                          <div className="flex items-center justify-between">
                            <span className="font-semibold uppercase">{pl.city}</span>
                            <span>{isHome ? "ORIGIN" : pad(idx + 1)}</span>
                          </div>
                          <p className="mt-0.5 text-[9px] opacity-65">
                            {Math.abs(pl.lat).toFixed(1)}°{pl.lat < 0 ? "S" : "N"} · {Math.abs(pl.lon).toFixed(1)}°
                            {pl.lon < 0 ? "W" : "E"}
                          </p>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              </div>
            </div>
          </section>

          {/* ── 05 // Contact CTA Banner ─────────────────────────── */}
          <section id="contact" aria-labelledby="contact-lite-title" className="scroll-mt-24 py-16 md:py-24">
            <div className="pd-glass pd-outcome relative overflow-hidden">
              <div className="grid items-end gap-10 lg:grid-cols-12">
                <div className="lg:col-span-7">
                  <p className="label mb-4 flex items-center gap-2.5 !text-accent">
                    <span aria-hidden className="pd-dot" />
                    05 — {contact.label} · Available for new builds
                  </p>
                  <h2 id="contact-lite-title" className="display text-[11vw] leading-[0.86] md:text-[5vw]">
                    {contact.heading}
                  </h2>
                  <p className="mt-5 max-w-[48ch] text-base leading-relaxed text-fg/70 md:text-lg">{contact.note}</p>
                </div>

                <div className="flex flex-col items-start gap-4 lg:col-span-5 lg:items-end">
                  <p className="label">Direct line — click to copy</p>
                  <CopyEmail className="font-display text-2xl font-semibold tracking-[-0.03em] md:text-3xl" />
                  <div className="mt-3 flex flex-wrap gap-3">
                    <a href={`mailto:${person.email}`} className="pd-cta">
                      Send an email <span aria-hidden>↗</span>
                    </a>
                    <FullExperienceLink className="contact-btn !py-4 !px-6 !text-xs" />
                  </div>
                </div>
              </div>
            </div>
          </section>

          {/* ── Footer ───────────────────────────────────────────── */}
          <footer className="flex flex-col gap-4 border-t border-fg/10 pt-6 md:flex-row md:items-center md:justify-between">
            <div className="flex flex-wrap items-center gap-5">
              <span className="display text-base">{person.shortName}</span>
              <ul className="flex gap-5" aria-label="Elsewhere">
                {person.socials.map((s) => (
                  <li key={s.label}>
                    <a href={s.href} target="_blank" rel="noreferrer" className="label !text-fg hover:!text-accent">
                      {s.label} ↗
                    </a>
                  </li>
                ))}
              </ul>
            </div>
            <p className="label">
              © {contact.year} {person.name} · {contact.footer}
            </p>
          </footer>
        </div>
      </div>
    </Reveal>
  );
}
