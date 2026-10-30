"use client";

import { Manrope } from "next/font/google";
import Image from "next/image";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import type { Project } from "@/content/site";
import { gsap, useGSAP } from "@/lib/gsap";
import { CountUp, ScrollProgress, useLandingBoot, usePointer, useSeen } from "../shared";
import "./legal.css";

const manrope = Manrope({ subsets: ["latin"], variable: "--font-manrope" });

type Props = { project: Project; prev: Project; next: Project };

/* ── content ──────────────────────────────────────────────────────────── */

const INTAKE_FIELDS = [
  { k: "Matter", v: "Acme Holdings v. Northwind Ltd" },
  { k: "Court", v: "Commercial High Court · Colombo" },
  { k: "Document", v: "Motion to compel discovery" },
  { k: "Filed", v: "14 Oct 2026" },
  { k: "Reply due", v: "28 Oct 2026 — added to calendar" },
  { k: "Bates range", v: "SYN-004211 → SYN-004236" },
];
const INTAKE_STEPS = ["Received", "OCR", "Bates", "Redact", "Extract", "Filed"];

const QUESTIONS = [
  {
    q: "Catch me up on Acme v. Northwind.",
    a: "Northwind moved to compel discovery on 14 Oct; your reply is due 28 Oct. Two items are still open: the seller's disclosure schedule and the revised indemnity language. Billing shows 6.4 hours logged this week, all assigned to the matter.",
    cites: ["Motion to compel · p.3", "Matter timeline", "Time entries · wk 42"],
  },
  {
    q: "Any non-reciprocal indemnities in the Acme NDA?",
    a: "Yes — two. Clause 7.2 indemnifies Acme only, and clause 9.1 caps Northwind's liability but not Acme's. Clause 11 (governing law) matches your precedent. A redline using the firm's standard mutual wording is ready for review.",
    cites: ["NDA_Acme_v3.docx · §7.2", "§9.1", "Precedent bank · Mutual NDA"],
  },
  {
    q: "What's due across my matters this week?",
    a: "Four deadlines: Acme reply (Tue), the Harbour Lane lease renewal notice (Wed), a compliance return for Meridian Trust (Thu) and a client update owed to Okafor & Sons (Fri). Nothing is overdue.",
    cites: ["Firm calendar", "Compliance register", "Real estate · Harbour Lane"],
  },
];

const CHIP_GROUPS: { label: string; chips: { id: string; name: string; pro?: boolean }[] }[] = [
  {
    label: "Intake",
    chips: [
      { id: "ocr", name: "OCR" },
      { id: "bates", name: "Bates numbering" },
      { id: "redact", name: "Redaction" },
      { id: "version", name: "Versioning" },
    ],
  },
  {
    label: "Intelligence",
    chips: [
      { id: "clauses", name: "Clause extraction", pro: true },
      { id: "deadlines", name: "Deadline detection", pro: true },
      { id: "conflicts", name: "Conflict check", pro: true },
      { id: "summaries", name: "Matter summaries", pro: true },
    ],
  },
];
const CHIP_PREVIEW: Record<string, { title: string; body: string; rows: [string, string][] }> = {
  ocr: { title: "Scans become text you can search.", body: "Every page of every filing is read on arrival — typed, scanned or photographed.", rows: [["Pages read", "26 / 26"], ["Confidence", "99.2%"], ["Languages", "EN · SI · TA"]] },
  bates: { title: "Numbered once, cited forever.", body: "Each page gets a Bates number the moment it lands, so every citation points at exactly one page.", rows: [["Prefix", "SYN-"], ["Range", "004211 → 004236"], ["Collisions", "0"]] },
  redact: { title: "Privileged lines never leave.", body: "Personal data and privileged passages are found and masked before anything is shared.", rows: [["NIC numbers", "3 masked"], ["Bank details", "1 masked"], ["Privileged", "2 passages"]] },
  version: { title: "Every draft, side by side.", body: "New versions stack on the old ones, with a diff a partner can read in seconds.", rows: [["Versions", "v1 → v4"], ["Changed", "11 clauses"], ["Approved by", "R. Perera"]] },
  clauses: { title: "Clauses pulled into fields.", body: "Indemnities, caps, governing law and termination are lifted into structured fields you can filter on.", rows: [["Indemnity", "Non-reciprocal ⚠"], ["Liability cap", "LKR 25M"], ["Governing law", "Sri Lanka"]] },
  deadlines: { title: "Dates find the calendar.", body: "Response windows and limitation periods are calculated and dropped onto the matter calendar.", rows: [["Reply due", "28 Oct"], ["Hearing", "12 Nov"], ["Reminders", "3 set"]] },
  conflicts: { title: "Conflicts caught at the door.", body: "New parties are checked against every client and counterparty the firm has ever recorded.", rows: [["Parties checked", "7"], ["Matches", "0"], ["Checked in", "0.4s"]] },
  summaries: { title: "The matter, in one paragraph.", body: "A summary that rewrites itself as filings arrive — and cites the page behind every line.", rows: [["Sources", "14 documents"], ["Updated", "2 min ago"], ["Citations", "9"]] },
};

const MODULES = [
  { name: "Matters", tag: "Core", body: "Every case, its parties, filings, deadlines and time — on one timeline.", bullets: ["Matter timeline", "Party & counsel records", "Linked documents and time"] },
  { name: "Documents", tag: "Core", body: "The document store the intake pipeline files into: searchable, versioned and Bates-stamped.", bullets: ["Full-text search across OCR", "Version diffs", "Privilege flags"] },
  { name: "Copilot", tag: "AI", body: "Forty AI features grounded in the practice's own records through vector retrieval.", bullets: ["Cited answers", "Drafts in firm style", "Clause review"] },
  { name: "Compliance", tag: "Module", body: "Registers, returns and KYC checks with reminders that don't depend on memory.", bullets: ["Filing calendar", "KYC records", "Audit trail"] },
  { name: "Real estate", tag: "Module", body: "Leases, title records and renewal notices, tracked per property.", bullets: ["Renewal alerts", "Title history", "Lease abstracts"] },
  { name: "Billing", tag: "Module", body: "Time captured against matters and turned into invoices without re-typing.", bullets: ["Time entries", "Invoices & retainers", "Trust ledger"] },
];

const DESTINATIONS = [
  { name: "Document store", meta: "Versioned · Bates", line: "26 pages stored as v1 under SYN-004211" },
  { name: "Copilot index", meta: "pgvector", line: "26 chunks embedded, ready to cite" },
  { name: "Matter timeline", meta: "Acme v. Northwind", line: "“Motion to compel” added to 14 Oct" },
  { name: "Firm calendar", meta: "Deadlines", line: "Reply due 28 Oct — 3 reminders set" },
  { name: "Compliance audit", meta: "Tenant-scoped", line: "Access logged · tenant SYN-07 only" },
];

const AUDIT = [
  ["ok", "tenant-audit", "scanning 298 models for tenantId scope"],
  ["ok", "tenant-audit", "865 route handlers resolve tenant from session"],
  ["ok", "rls", "cross-tenant read: firm_a → firm_b  denied"],
  ["ok", "rls", "cross-tenant write: firm_b → firm_a  denied"],
  ["ok", "copilot", "retrieval filtered to tenant SYN-07 (0 foreign chunks)"],
  ["ok", "release", "no tenant leaks found — release unblocked"],
] as const;

const AREAS_A = ["Litigation", "Corporate", "Real estate", "Compliance", "Employment"];
const AREAS_B = ["Intellectual property", "Tax", "Banking", "Family", "Arbitration"];

/* ── icons ────────────────────────────────────────────────────────────── */

const Arrow = () => <span aria-hidden className="lg-arrow">→</span>;
const Mark = () => (
  <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d="M12 3v18M5 21h14M4 7h16M7 7l-3 7a3 3 0 0 0 6 0L7 7Zm10 0-3 7a3 3 0 0 0 6 0l-3-7Z" />
  </svg>
);
const Check = () => (
  <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d="m3 8.5 3 3 7-7" />
  </svg>
);
const SIDEBAR = ["M3 10.5 12 3l9 7.5V21H3z", "M5 4h14v16H5zM9 9h6M9 13h6", "M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z", "M12 3a9 9 0 1 0 9 9M12 7v5l3 3", "M4 6h16M4 12h16M4 18h10", "M3 7h18v12H3zM3 11h18"];

/* ── page ─────────────────────────────────────────────────────────────── */

export default function LegalLanding({ project: p, prev, next }: Props) {
  const root = useRef<HTMLDivElement>(null);
  useLandingBoot(root);
  const hero = usePointer<HTMLElement>();

  useGSAP(
    () => {
      if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
      // the demo card lies back like a page on a desk, and stands up as you scroll to it
      gsap.fromTo(
        ".lg-hero-card",
        { rotateX: 24, scale: 0.9, y: 40, transformPerspective: 1600, transformOrigin: "50% 0%" },
        { rotateX: 0, scale: 1, y: 0, ease: "none", scrollTrigger: { trigger: ".lg-hero-card", start: "top 98%", end: "top 30%", scrub: 0.6 } },
      );
      gsap.fromTo(
        ".lg-shot-3d",
        { rotateX: 18, scale: 0.92, transformPerspective: 1600, transformOrigin: "50% 100%" },
        { rotateX: 0, scale: 1, ease: "none", scrollTrigger: { trigger: ".lg-shot-3d", start: "top 100%", end: "top 35%", scrub: 0.6 } },
      );
      gsap.to(".lg-hero .lg-center", { yPercent: -18, autoAlpha: 0.2, ease: "none", scrollTrigger: { trigger: ".lg-hero", start: "top top", end: "45% top", scrub: true } });
      // the marquee rows run against each other as the page moves
      gsap.fromTo(".lg-mq-a", { xPercent: 0 }, { xPercent: -30, ease: "none", scrollTrigger: { trigger: ".lg-mq", start: "top bottom", end: "bottom top", scrub: 0.5 } });
      gsap.fromTo(".lg-mq-b", { xPercent: -30 }, { xPercent: 0, ease: "none", scrollTrigger: { trigger: ".lg-mq", start: "top bottom", end: "bottom top", scrub: 0.5 } });
      for (const img of gsap.utils.toArray<HTMLElement>(".lg-step-img img")) {
        gsap.fromTo(img, { yPercent: -8, scale: 1.18 }, { yPercent: 8, scale: 1.18, ease: "none", scrollTrigger: { trigger: img.parentElement, start: "top bottom", end: "bottom top", scrub: true } });
      }
      gsap.fromTo(".lg-closing-img", { scale: 1.25 }, { scale: 1, ease: "none", scrollTrigger: { trigger: ".lg-closing", start: "top bottom", end: "bottom bottom", scrub: true } });
      gsap.from(".lg-bignum", { scale: 0.6, transformOrigin: "0% 100%", ease: "expo.out", duration: 1.6, scrollTrigger: { trigger: ".lg-bignum", start: "top 90%", once: true } });
      gsap.from(".lg-stat", { y: 40, autoAlpha: 0, stagger: 0.1, duration: 1, ease: "power3.out", scrollTrigger: { trigger: ".lg-stats", start: "top 90%", once: true } });
    },
    { scope: root },
  );

  const [scrolled, setScrolled] = useState(false);
  const [light, setLight] = useState(false);
  useEffect(() => {
    // the nav turns to paper over the cream sections, glass over the dark ones
    const on = () => {
      setScrolled(scrollY > 40);
      const under = document.elementsFromPoint(innerWidth / 2, 38).find((e) => !e.closest(".lg-navwrap"));
      setLight(!!under?.closest(".lg-cream"));
    };
    on();
    addEventListener("scroll", on, { passive: true });
    return () => removeEventListener("scroll", on);
  }, []);

  return (
    <div ref={root} className={`lg ${manrope.variable}`}>
      <ScrollProgress color="linear-gradient(90deg, #6ee9d0, #f6f2a6)" />
      {/* nav */}
      <div className="lg-navwrap">
        <nav className={`lg-nav ${scrolled ? "is-scrolled" : ""} ${light ? "is-light" : ""}`} aria-label="Legal Workspace">
          <a href="#top" className="lg-logo">
            <Mark /> synapsole
          </a>
          <div className="lg-navlinks">
            <a href="#intake">Intake</a>
            <a href="#copilot">Copilot</a>
            <a href="#modules">Modules</a>
            <a href="#security">Security</a>
            <a href="#build">The build</a>
          </div>
          <div className="lg-navend">
            <Link href="/projects" className="lg-navback">
              All work
            </Link>
            <a href={p.link} target="_blank" rel="noreferrer" className="lg-pill lg-pill-white lg-pill-sm">
              Open live
            </a>
          </div>
        </nav>
      </div>

      {/* hero */}
      <header id="top" ref={hero} className="lg-dark lg-hero">
        <Flutes />
        <Floaters />
        <div className="lg-shell lg-center relative">
          <p className="lg-eyebrow" data-reveal>
            <span className="lg-dot" /> {p.category} · {p.year}
          </p>
          <h1 className="lg-h1" data-split="load">
            A legal practice
            <br />
            that files itself.
          </h1>
          <p className="lg-lede" data-reveal>
            Filings are read, numbered, redacted and filed into the right matter the moment they arrive — and a copilot that knows the practice answers with
            citations to the firm&apos;s own records.
          </p>
          <div className="lg-ctas" data-reveal>
            <a href={p.link} target="_blank" rel="noreferrer" className="lg-pill lg-pill-white" data-magnetic>
              Open the live workspace <Arrow />
            </a>
            <a href="#intake" className="lg-pill lg-pill-ghost" data-magnetic>
              Watch a filing arrive
            </a>
          </div>
        </div>
        <div id="intake" className="lg-shell relative scroll-mt-24">
          <IntakeDemo />
        </div>
      </header>

      {/* below the hero card */}
      <section className="lg-cream lg-after-hero">
        <div className="lg-shell lg-center">
          <p className="lg-small" data-reveal>
            298 data models · 865 API routes · 40 AI features · one multi-tenant login.
          </p>
          <a href="#build" className="lg-ulink" data-reveal>
            See how it was built <Arrow />
          </a>
        </div>
      </section>

      <section className="lg-cream lg-mq" aria-label="Practice areas">
        {(["a", "b"] as const).map((k) => (
          <div key={k} className={`lg-mq-row lg-mq-${k}`} aria-hidden={k === "b"}>
            {[0, 1].map((r) => (
              <span key={r}>
                {(k === "a" ? AREAS_A : AREAS_B).map((w) => (
                  <em key={w}>
                    {w} <Mark />
                  </em>
                ))}
              </span>
            ))}
          </div>
        ))}
      </section>

      {/* copilot */}
      <section id="copilot" className="lg-cream lg-sec scroll-mt-20">
        <div className="lg-shell lg-center">
          <h2 className="lg-h2" data-split>
            Ask about a matter and get an answer that cites the file. <span className="lg-badge">AI</span>
          </h2>
          <p className="lg-body" data-reveal>
            A generic chatbot that doesn&apos;t know the practice is worse than none. This copilot retrieves from the firm&apos;s own matters, filings and
            precedents before it says a word, and every sentence points back to the page it came from. Pick a question below to see it work.
          </p>
        </div>
        <div className="lg-shell-wide">
          <CopilotDemo />
        </div>
        <div className="lg-shell lg-cards3">
          {[
            ["Grounded in records", "Retrieval over the practice's own matters and archives through pgvector — never the open internet."],
            ["Cites every line", "Each answer links to the filing, page and clause it came from, so a partner can check it in one click."],
            ["Stays in the firm", "Retrieval is filtered to the tenant before ranking. One firm's records never reach another firm's answers."],
          ].map(([t, b]) => (
            <article key={t} className="lg-card" data-reveal data-tilt="6" data-glow>
              <h3>{t}</h3>
              <p>{b}</p>
            </article>
          ))}
        </div>
      </section>

      {/* intake chips */}
      <section className="lg-dark lg-sec lg-sec-flow">
        <Flutes />
        <div className="lg-shell lg-center relative">
          <h2 className="lg-h2" data-split>
            Every filing, structured on arrival.
          </h2>
          <p className="lg-body" data-reveal>
            Filings used to arrive with few conventions, metadata lived in associates&apos; heads and compliance depended on someone remembering to check.
            Now eight steps run on every document before a person opens it. Choose one to see what it does.
          </p>
        </div>
        <div className="lg-shell relative">
          <ChipExplorer />
        </div>
      </section>

      {/* modules bento */}
      <section id="modules" className="lg-dark lg-sec lg-sec-tight lg-sec-flow scroll-mt-20">
        <Flutes />
        <div className="lg-shell lg-center relative">
          <h2 className="lg-h2" data-split>
            Ten practice modules. One login.
          </h2>
          <p className="lg-body" data-reveal>
            Matters, documents, compliance, real estate and billing share one data model, so a filing, a deadline and an invoice all know which matter they
            belong to.
          </p>
        </div>
        <div className="lg-shell relative">
          <ModuleExplorer />
          <div className="lg-bento2">
            <article className="lg-glass lg-big" data-reveal data-glow data-tilt="5">
              <p className="lg-caption">Data models</p>
              <CountUp value="298" className="lg-bignum" />
              <p className="lg-muted">Prisma models on Neon Postgres, each scoped to a tenant. Matters, parties, filings, clauses, time entries and invoices, all related.</p>
            </article>
            <article className="lg-glass" data-reveal data-glow>
              <h3 className="lg-h3">The numbers behind it.</h3>
              <p className="lg-muted">A full enterprise backend, not a demo — built and shipped in twelve weeks.</p>
              <div className="lg-stats">
                {[
                  ["865", "API route handlers"],
                  ["40", "AI copilot features"],
                  ["10", "Practice modules"],
                  ["12", "Weeks to live"],
                ].map(([v, l]) => (
                  <div key={l} className="lg-stat">
                    <CountUp value={v} className="lg-statnum" />
                    <span>{l}</span>
                  </div>
                ))}
              </div>
            </article>
          </div>
        </div>
      </section>

      {/* pipeline */}
      <section className="lg-dark lg-sec lg-sec-tight">
        <Flutes />
        <div className="lg-shell lg-center relative">
          <h2 className="lg-h2" data-split>
            One filing in. Five systems updated.
          </h2>
          <p className="lg-body" data-reveal>
            Nobody re-types a filing. When a document is accepted it is stored, embedded for the copilot, placed on the matter timeline, its deadlines
            calendared and its access logged — in one pass.
          </p>
        </div>
        <div className="lg-shell relative">
          <Pipeline />
        </div>
      </section>

      {/* real product */}
      <section className="lg-cream lg-sec">
        <div className="lg-shell lg-center">
          <h2 className="lg-h2" data-split>
            The workspace, live.
          </h2>
          <p className="lg-body" data-reveal>
            This is the production app firms sign in to — a matter-aware chief of staff that drafts, scans, captures billing and keeps the practice on time.
          </p>
        </div>
        <div className="lg-shell-wide">
          <div className="lg-frame lg-shot lg-shot-3d">
            <div className="lg-frame-bar">
              <span />
              <span />
              <span />
              <em>{p.link?.replace(/^https?:\/\//, "").replace(/\/$/, "")}</em>
            </div>
            <Image src={p.cover} alt="The live Legal Workspace dashboard" width={1600} height={1000} className="lg-shot-img" />
          </div>
        </div>
      </section>

      {/* security */}
      <section id="security" className="lg-cream lg-sec scroll-mt-20">
        <div className="lg-shell lg-split">
          <div>
            <p className="lg-kicker" data-reveal>
              Security
            </p>
            <h2 className="lg-h2 lg-left" data-split>
              Isolation you can audit, on every release.
            </h2>
            <p className="lg-body lg-left" data-reveal>
              Every firm on the platform is hard-separated from every other firm. A tenant audit runs in CI and blocks the release if a single model, route
              or retrieval query could reach across the line.
            </p>
            <ul className="lg-checks" data-reveal>
              <li>
                <Check /> Tenant resolved from the session, never the request body
              </li>
              <li>
                <Check /> Copilot retrieval filtered by tenant before ranking
              </li>
              <li>
                <Check /> Every document access written to an audit log
              </li>
            </ul>
          </div>
          <AuditLog />
        </div>
        <div className="lg-shell lg-cards3 lg-cards3-tall">
          {p.challenges?.map((c, i) => (
            <article key={c.title} className="lg-card" data-reveal data-tilt="5" data-glow>
              <p className="lg-caption">0{i + 1} · The problem</p>
              <h3>{c.title}</h3>
              <p>{c.problem}</p>
              <p className="lg-move">
                <span>The move</span>
                {c.move}
              </p>
            </article>
          ))}
        </div>
      </section>

      {/* build story with photography */}
      <section id="build" className="lg-dark lg-sec scroll-mt-20">
        <Flutes />
        <div className="lg-shell lg-center relative">
          <h2 className="lg-h2" data-split>
            Built from inside the practice.
          </h2>
          <p className="lg-body" data-reveal>
            Twelve weeks from the first afternoon spent watching filings arrive to a workspace firms run on. Here is how it went.
          </p>
        </div>
        <div className="lg-shell relative lg-story">
          {p.timeline?.map((t, i) => (
            <article key={t.phase} className="lg-step" data-reveal data-tilt="6" data-glow>
              <div className="lg-step-img">
                <Image src={`/projects/legal-workspace/${["library", "signing", "justice", "columns"][i]}.webp`} alt="" fill sizes="(min-width: 768px) 25vw, 90vw" />
              </div>
              <p className="lg-caption">
                Step {i + 1} · {t.phase}
              </p>
              <h3 className="lg-h3">{t.title}</h3>
              <p className="lg-muted">{t.description}</p>
            </article>
          ))}
        </div>
      </section>

      {/* "pricing" — the brief and the outcome */}
      <section className="lg-cream lg-sec">
        <div className="lg-shell lg-center">
          <h2 className="lg-h2" data-split>
            What was asked for, and what shipped.
          </h2>
          <a href={p.link} target="_blank" rel="noreferrer" className="lg-ulink" data-reveal>
            Open the live workspace <Arrow />
          </a>
        </div>
        <div className="lg-shell">
          <p className="lg-kicker mb-4" data-reveal>
            The project
          </p>
          <div className="lg-plans">
            <article className="lg-plan" data-reveal data-glow>
              <div className="lg-plan-head">
                <h3>The brief</h3>
                <span className="lg-plan-price">12 wks</span>
              </div>
              <p className="lg-muted-ink">An enterprise workspace for a legal practice, multi-tenant from day one.</p>
              <ul className="lg-planlist">
                {p.facts?.map((f) => (
                  <li key={f.label}>
                    <Check />
                    <span>
                      <b>{f.label}</b> — {f.value}
                    </span>
                  </li>
                ))}
                {p.stack.map((s) => (
                  <li key={s}>
                    <Check /> {s}
                  </li>
                ))}
              </ul>
            </article>
            <article className="lg-plan lg-plan-teal" data-reveal data-glow>
              <div className="lg-plan-head">
                <h3>The outcome</h3>
                <span className="lg-plan-tag">Live</span>
              </div>
              <p>{p.verdict?.statement}</p>
              <ul className="lg-planlist">
                {p.outcomes?.map((o) => (
                  <li key={o}>
                    <Check /> {o}
                  </li>
                ))}
              </ul>
              <a href={p.link} target="_blank" rel="noreferrer" className="lg-pill lg-pill-white mt-8 self-start">
                {p.liveLabel ?? "Open"} <Arrow />
              </a>
            </article>
          </div>
        </div>
      </section>

      {/* closing */}
      <footer className="lg-dark lg-closing">
        <div className="lg-closing-img">
          <Image src="/projects/legal-workspace/library.webp" alt="" fill sizes="100vw" />
        </div>
        <Flutes />
        <div className="lg-shell lg-center relative">
          <h2 className="lg-h1 lg-h1-sm" data-split>
            {p.verdict?.title}
          </h2>
          <p className="lg-lede" data-reveal>
            {p.tagline}
          </p>
          <div className="lg-ctas" data-reveal>
            <a href={p.link} target="_blank" rel="noreferrer" className="lg-pill lg-pill-white" data-magnetic>
              {p.liveLabel} <Arrow />
            </a>
            <Link href="/contact" className="lg-pill lg-pill-ghost" data-magnetic>
              Build something like this
            </Link>
          </div>
        </div>
        <div className="lg-shell relative lg-foot">
          <Link href={`/projects/${prev.slug}`} className="lg-foot-link">
            <span className="lg-caption">← Previous</span>
            {prev.title}
          </Link>
          <Link href="/projects" className="lg-foot-mid">
            <Mark /> All work
          </Link>
          <Link href={`/projects/${next.slug}`} className="lg-foot-link lg-foot-right">
            <span className="lg-caption">Next →</span>
            {next.title}
          </Link>
        </div>
      </footer>
    </div>
  );
}

/* ── the fluted-glass backdrop ────────────────────────────────────────── */

function Flutes() {
  return (
    <div aria-hidden className="lg-flutes">
      <div className="lg-glow lg-glow-a" />
      <div className="lg-glow lg-glow-b" />
      <div className="lg-cursorlight" />
      <div className="lg-ribs" />
    </div>
  );
}

/* ── document chips drifting around the headline, leaning with the pointer ── */

const FLOATERS = ["OCR · 26 pages", "SYN-004211", "Reply due 28 Oct", "§7.2 non-reciprocal", "Redacted · 3 NICs"];

function Floaters() {
  return (
    <div aria-hidden className="lg-floaters">
      {FLOATERS.map((t, i) => (
        <span key={t} className={`lg-floater lg-floater-${i}`}>
          <i />
          {t}
        </span>
      ))}
    </div>
  );
}

/* ── hero demo: a filing arriving ─────────────────────────────────────── */

function useInView<T extends HTMLElement>(threshold = 0.35) {
  const ref = useRef<T>(null);
  const [seen, setSeen] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(([e]) => e.isIntersecting && setSeen(true), { threshold });
    io.observe(el);
    return () => io.disconnect();
  }, [threshold]);
  return [ref, seen] as const;
}

function IntakeDemo() {
  const [ref, seen] = useInView<HTMLDivElement>(0.3);
  const [step, setStep] = useState(0);
  const [run, setRun] = useState(0);

  useEffect(() => {
    if (!seen) return;
    let s = 0;
    const id = setInterval(() => {
      s += 1;
      setStep(s);
      if (s >= INTAKE_STEPS.length + INTAKE_FIELDS.length) clearInterval(id);
    }, 520);
    return () => clearInterval(id);
  }, [seen, run]);

  const stage = Math.min(step, INTAKE_STEPS.length - 1);
  const fields = Math.max(0, step - 3);
  const done = step >= INTAKE_STEPS.length + INTAKE_FIELDS.length - 1;

  return (
    <div ref={ref} className="lg-frame lg-hero-card">
      <div className="lg-frame-top">
        <span>Document intake</span>
        <span className="lg-soft-ink">Live demo · sample filing, nothing is stored</span>
      </div>
      <div className="lg-intake">
        <div className="lg-doc">
          <div className={`lg-doc-page ${stage >= 1 ? "is-read" : ""}`}>
            <div className="lg-doc-scan" style={{ animationPlayState: stage >= 1 && stage < 3 ? "running" : "paused", opacity: stage >= 1 && stage < 3 ? 1 : 0 }} />
            <p className="lg-doc-court">IN THE COMMERCIAL HIGH COURT OF COLOMBO</p>
            <p className="lg-doc-title">Motion to Compel Discovery</p>
            {Array.from({ length: 11 }, (_, i) => (
              <span key={i} className={`lg-doc-line ${stage >= 3 && (i === 3 || i === 7) ? "is-redacted" : ""}`} style={{ width: `${[92, 86, 95, 60, 88, 91, 78, 54, 93, 84, 40][i]}%` }} />
            ))}
            <span className={`lg-bates ${stage >= 2 ? "is-on" : ""}`}>SYN-004211</span>
          </div>
        </div>
        <div className="lg-intake-side">
          <ol className="lg-steps">
            {INTAKE_STEPS.map((s, i) => (
              <li key={s} className={i < stage || done ? "is-done" : i === stage ? "is-now" : ""}>
                <span className="lg-step-dot">{i < stage || done ? <Check /> : i + 1}</span>
                {s}
              </li>
            ))}
          </ol>
          <dl className="lg-fields">
            {INTAKE_FIELDS.map((f, i) => (
              <div key={f.k} className={i < fields ? "is-in" : ""}>
                <dt>{f.k}</dt>
                <dd>{f.v}</dd>
              </div>
            ))}
          </dl>
          <div className="lg-intake-foot">
            <span className="lg-soft-ink">{done ? "Filed into the matter in 3.1s — no typing." : "Reading the filing…"}</span>
            <button type="button" className="lg-pill lg-pill-teal lg-pill-sm" onClick={() => {
                setStep(0);
                setRun((r) => r + 1);
              }}
              disabled={!done}>
              Replay
            </button>
          </div>
        </div>
      </div>
      <div className="lg-madewith">
        Made with <b>synapsole</b>
      </div>
    </div>
  );
}

/* ── copilot demo ─────────────────────────────────────────────────────── */

function CopilotDemo() {
  const [qi, setQi] = useState(0);
  const [shown, setShown] = useState(0);
  const [ref, seen] = useInView<HTMLDivElement>(0.3);
  const answer = QUESTIONS[qi].a;

  useEffect(() => {
    if (!seen) return;
    const id = setInterval(() => setShown((n) => (n >= answer.length ? (clearInterval(id), n) : n + 3)), 16);
    return () => clearInterval(id);
  }, [qi, seen, answer]);

  const typing = shown < answer.length;
  return (
    <div ref={ref} className="lg-frame lg-dash" data-reveal>
      <div className="lg-frame-top">
        <span>Your workspace</span>
        <span className="lg-soft-ink">Tenant SYN-07 · 4 sources indexed</span>
      </div>
      <div className="lg-dash-body">
        <aside className="lg-dash-side" aria-hidden>
          <span className="lg-dash-logo">
            <Mark />
          </span>
          {SIDEBAR.map((d, i) => (
            <span key={d} className={`lg-dash-ico ${i === 3 ? "is-on" : ""}`}>
              <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round">
                <path d={d} />
              </svg>
            </span>
          ))}
        </aside>
        <div className="lg-dash-main">
          <p className="lg-soft-ink">Copilot</p>
          <h3 className="lg-dash-h">Good morning, Rehana.</h3>
          <div className="lg-panel">
            <p className="lg-panel-h">
              Ask the practice <span className="lg-badge">AI</span>
            </p>
            <p className="lg-soft-ink">Answers come only from this firm&apos;s matters, filings and precedents — each one cited.</p>
            <div className="lg-chiprow">
              {QUESTIONS.map((q, i) => (
                <button key={q.q} type="button" className={`lg-chip-ink ${i === qi ? "is-on" : ""}`} onClick={() => {
                    setQi(i);
                    setShown(0);
                  }}
                >
                  {q.q}
                </button>
              ))}
            </div>
            <div className="lg-convo">
              <p className="lg-ask">{QUESTIONS[qi].q}</p>
              <div className="lg-answer">
                <span className="lg-answer-ico">
                  <Mark />
                </span>
                <div>
                  <p>
                    {answer.slice(0, shown)}
                    {typing && <span className="lg-caret" />}
                  </p>
                  <div className={`lg-cites ${typing ? "" : "is-in"}`}>
                    {QUESTIONS[qi].cites.map((c, i) => (
                      <span key={c} className="lg-cite">
                        <b>{i + 1}</b> {c}
                      </span>
                    ))}
                    <span className="lg-grounded">Grounded · {QUESTIONS[qi].cites.length} sources · 0.85s</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ── chip explorer ────────────────────────────────────────────────────── */

function ChipExplorer() {
  const [on, setOn] = useState("clauses");
  const all = CHIP_GROUPS.flatMap((g) => g.chips);
  const chip = all.find((c) => c.id === on)!;
  const pv = CHIP_PREVIEW[on];
  return (
    <div className="lg-explorer">
      <div>
        {CHIP_GROUPS.map((g) => (
          <div key={g.label} className="lg-chipgroup" data-reveal>
            <p className="lg-kicker lg-kicker-light">{g.label}</p>
            <div className="lg-chipwrap">
              {g.chips.map((c) => (
                <button key={c.id} type="button" className={`lg-chip ${on === c.id ? "is-on" : ""}`} onClick={() => setOn(c.id)}>
                  {c.name}
                  {c.pro && <span className="lg-badge lg-badge-dark">AI</span>}
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
      <article key={on} className="lg-glass lg-preview" data-glow data-tilt="4">
        <p className="lg-kicker lg-kicker-mint">{chip.name}</p>
        <h3 className="lg-h3">{pv.title}</h3>
        <p className="lg-muted">{pv.body}</p>
        <div className="lg-rows">
          {pv.rows.map(([k, v]) => (
            <div key={k}>
              <span>{k}</span>
              <b>{v}</b>
            </div>
          ))}
        </div>
      </article>
    </div>
  );
}

/* ── module explorer ──────────────────────────────────────────────────── */

function ModuleExplorer() {
  const [on, setOn] = useState(0);
  const m = MODULES[on];
  return (
    <div className="lg-modules">
      <div className="lg-glass lg-modlist" data-reveal>
        {MODULES.map((x, i) => (
          <button key={x.name} type="button" className={i === on ? "is-on" : ""} onClick={() => setOn(i)}>
            <span className="lg-modico" aria-hidden>
              {Array.from({ length: 3 }, (_, k) => (
                <i key={k} style={{ width: `${[100, 70, 85][(k + i) % 3]}%` }} />
              ))}
            </span>
            {x.name}
            <em>{x.tag}</em>
          </button>
        ))}
      </div>
      <div className="lg-glass lg-modview" data-reveal data-glow>
        <div className="lg-modart" key={on}>
          <div className="lg-modart-head" />
          {m.bullets.map((b, i) => (
            <div key={b} className="lg-modart-row" style={{ animationDelay: `${i * 90}ms` }}>
              <i />
              {b}
            </div>
          ))}
        </div>
        <div>
          <h3 className="lg-h3">{m.name}</h3>
          <p className="lg-muted lg-modbody">{m.body}</p>
          <ul className="lg-bullets">
            {m.bullets.map((b) => (
              <li key={b}>{b}</li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}

/* ── pipeline diagram ─────────────────────────────────────────────────── */

const PIPE_W = 1100;
const PIPE_H = 620;
const SRC = { x: 300, y: 330 };
const DEST_Y = DESTINATIONS.map((_, i) => 70 + i * 120);
const DEST_X = 640;
const pathFor = (y: number) => `M ${SRC.x} ${SRC.y} C ${SRC.x + 170} ${SRC.y}, ${DEST_X - 170} ${y}, ${DEST_X} ${y}`;

function Pipeline() {
  const [clicks, setClicks] = useState(0);
  const [landed, setLanded] = useState(0);
  const [ref, seen] = useSeen<HTMLDivElement>(0.45);
  // the first run starts by itself when the diagram comes into view
  const sent = clicks + (seen ? 1 : 0);

  useEffect(() => {
    if (!sent) return;
    const ids = DESTINATIONS.map((_, i) => setTimeout(() => setLanded(i + 1), 900 + i * 260));
    return () => ids.forEach(clearTimeout);
  }, [sent]);

  return (
    <div ref={ref} className="lg-pipe" data-reveal>
      <svg className="lg-pipe-svg" viewBox={`0 0 ${PIPE_W} ${PIPE_H}`} preserveAspectRatio="none" aria-hidden>
        {DEST_Y.map((y, i) => (
          <g key={i}>
            <path d={pathFor(y)} className={`lg-wire ${sent ? "is-live" : ""}`} />
            <circle cx={DEST_X} cy={y} r="4" className="lg-wire-end" />
            {sent > 0 && (
              <circle key={`${sent}-${i}`} r="4.5" className="lg-pulse">
                <animateMotion dur="0.9s" begin={`${i * 0.26}s`} fill="freeze" path={pathFor(y)} />
              </circle>
            )}
          </g>
        ))}
        <circle cx={SRC.x} cy={SRC.y} r="5" className="lg-wire-src" />
      </svg>

      <div className="lg-pipe-src">
        <div className="lg-glass lg-resp">
          <div className="lg-resp-top">
            <span className="lg-kicker lg-kicker-light">Incoming filing</span>
            <span className={`lg-status ${sent ? "is-done" : ""}`}>{sent ? "Accepted" : "Pending"}</span>
          </div>
          <p className="lg-resp-h">
            Filing #1042 <small>SYN-004211</small>
          </p>
          {[
            ["Matter", "Acme v. Northwind"],
            ["Document", "Motion to compel"],
            ["Received from", "court e-filing"],
          ].map(([k, v]) => (
            <div key={k} className="lg-resp-field">
              <span>{k}</span>
              <b>{v}</b>
            </div>
          ))}
          <button type="button" className="lg-pill lg-pill-white lg-pill-block" onClick={() => {
              setLanded(0);
              setClicks((s) => s + 1);
            }}
          >
            {sent ? "Send it again" : "Accept filing #1042"} <Arrow />
          </button>
          <p className="lg-soft">Accept it and watch where it goes.</p>
        </div>
      </div>

      <div className="lg-pipe-dests">
        {DESTINATIONS.map((d, i) => (
          <div key={d.name} className={`lg-glass lg-dest ${i < landed ? "is-in" : ""}`} style={{ top: `${(DEST_Y[i] / PIPE_H) * 100}%` }}>
            <div className="lg-dest-top">
              <b>{d.name}</b>
              <span>{d.meta}</span>
            </div>
            <p>{i < landed ? d.line : "Waiting for a filing…"}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ── CI audit log ─────────────────────────────────────────────────────── */

function AuditLog() {
  const [ref, seen] = useInView<HTMLDivElement>(0.4);
  const [n, setN] = useState(0);
  useEffect(() => {
    if (!seen) return;
    const id = setInterval(() => setN((k) => (k >= AUDIT.length ? (clearInterval(id), k) : k + 1)), 420);
    return () => clearInterval(id);
  }, [seen]);
  return (
    <div ref={ref} className="lg-term" data-reveal>
      <div className="lg-term-top">
        <span />
        <span />
        <span />
        <em>ci / tenant-audit</em>
      </div>
      <div className="lg-term-body">
        <p className="lg-term-cmd">$ npm run audit:tenants</p>
        {AUDIT.slice(0, n).map(([s, tag, msg]) => (
          <p key={msg}>
            <span className="lg-term-ok">✓ {s}</span> <span className="lg-term-tag">[{tag}]</span> {msg}
          </p>
        ))}
        {n >= AUDIT.length ? <p className="lg-term-pass">PASS · release v4.12 can ship</p> : <span className="lg-caret lg-caret-light" />}
      </div>
    </div>
  );
}
