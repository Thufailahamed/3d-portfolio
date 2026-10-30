"use client";

import { Manrope, Noto_Sans_Sinhala, Noto_Sans_Tamil } from "next/font/google";
import Image from "next/image";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import type { Project } from "@/content/site";
import { gsap, useGSAP } from "@/lib/gsap";
import { CountUp, ScrollProgress, useLandingBoot, usePointer, useSectionProgress } from "../shared";
import "./health.css";

const manrope = Manrope({ subsets: ["latin"], variable: "--font-hh" });
const sinhala = Noto_Sans_Sinhala({ subsets: ["sinhala"], weight: ["400", "500"], variable: "--font-hh-si" });
const tamil = Noto_Sans_Tamil({ subsets: ["tamil"], weight: ["400", "500"], variable: "--font-hh-ta" });

type Props = { project: Project; prev: Project; next: Project };

/* ── content ──────────────────────────────────────────────────────────── */

const KINDS = ["Prescriptions", "Lab results", "Scans & X-rays", "Discharge notes", "Vaccinations", "Allergies", "Blood pressure", "Family records"];

const WHO = [
  { name: "Patients", img: "phone", line: "Your own history, finally in one place." },
  { name: "Families & carers", img: "hands", line: "A parent's records, in the language they read." },
  { name: "Doctors", img: "nurse", line: "A readable history before the first question." },
];

const RECORDS = [
  { name: "Prescriptions", img: "pills", tag: "Medication", body: "Every prescription you've been given, with the dose, the doctor and the date — and a reminder for the next one.", row: ["Metformin 500 mg", "Next dose 8:00 PM · after rice"] },
  { name: "Lab results", img: "lab", tag: "Diagnostics", body: "Blood tests and panels read off the report and plotted over time, so a trend is a line, not a pile of paper.", row: ["HbA1c · Durdans", "6.1% · ▼ 0.7 this year"] },
  { name: "Scans & X-rays", img: "xray", tag: "Imaging", body: "Imaging and the radiologist's report kept together, instead of a CD in a drawer and a photo on WhatsApp.", row: ["Chest X-ray", "Report attached · Jun '26"] },
  { name: "Check-ups", img: "vitals", tag: "Vitals", body: "Blood pressure, heart rate and weight logged at every visit — or at home — and shown as a history.", row: ["Blood pressure", "122/78 · this morning"] },
  { name: "Clinic visits", img: "clinic", tag: "Visits", body: "Each visit becomes a dated entry: who you saw, what they found and what they asked you to do next.", row: ["Asiri Central", "Follow-up in 6 weeks"] },
  { name: "Family records", img: "hands", tag: "Family", body: "Keep a parent's or a child's record beside your own, each in the language its reader prefers.", row: ["Amma · 74", "3 records this month"] },
];

const DOES = [
  { t: "Scan and index", icon: "scan", tags: ["Photo or PDF", "Handwriting", "3.8 s to index"], line: "Paper becomes a searchable record in seconds" },
  { t: "Three languages", icon: "lang", tags: ["English", "සිංහල", "தமிழ்"], line: "The whole record, read the way you read" },
  { t: "Doctor-ready summary", icon: "doc", tags: ["One page", "Latest results", "Current meds"], line: "The history a doctor needs, before the first question" },
  { t: "A timeline of care", icon: "time", tags: ["Every visit", "Every result", "Every dose"], line: "Your health as a story, not a stack of paper" },
  { t: "Gentle reminders", icon: "bell", tags: ["Next dose", "Follow-ups", "Refills"], line: "The 8 PM tablet, remembered for you" },
  { t: "Private by design", icon: "lock", tags: ["No ads", "No trackers", "You decide who sees"], line: "Built so your record stays yours" },
];

const LANGS = {
  en: { label: "English", title: "Prescription", dose: "One tablet twice a day, after meals", next: "Next dose 8:00 PM · after rice", cls: "" },
  si: { label: "සිංහල", title: "බෙහෙත් වට්ටෝරුව", dose: "දිනකට දෙවරක්, ආහාරයෙන් පසු එක් පෙත්තක්", next: "ඊළඟ මාත්‍රාව රාත්‍රී 8:00 · බත් කෑමෙන් පසු", cls: "hh-si" },
  ta: { label: "தமிழ்", title: "மருந்துச் சீட்டு", dose: "உணவுக்குப் பின், தினமும் இரண்டு முறை ஒரு மாத்திரை", next: "அடுத்த மருந்து இரவு 8:00 · சாப்பாட்டுக்குப் பின்", cls: "hh-ta" },
} as const;

const MOMENTS = [
  { text: "The prescription is in a drawer somewhere, and the pharmacist needs the exact dose.", who: "The drawer", img: "pills" },
  { text: "Last year's scan lives in a WhatsApp chat you can no longer find.", who: "The lost scan", img: "xray" },
  { text: "A new doctor asks about your history and you remember half of it.", who: "The first visit", img: "visit" },
  { text: "Your mother's results are in English; she reads Sinhala.", who: "The family", img: "hands" },
  { text: "Three clinics, three folders, and none of them talk to each other.", who: "The scattered file", img: "clinic" },
];

const FAQ = [
  ["Who can see my records?", "You. The record is private by default — nothing is shared unless you choose to show it to a doctor or a family member. There are no ads and no third-party trackers."],
  ["Which languages does it support?", "English, Sinhala and Tamil, natively — the interface and your record can be read in any of the three."],
  ["How does scanning work?", "Take a photo or upload a PDF of a prescription, report or scan. HealthHub reads it and indexes it into your record in about 3.8 seconds."],
  ["Can my doctor use it?", "Yes — the record is designed to be doctor-ready: a readable summary of your history, results and current medication you can show at the next visit."],
  ["Is it available now?", "HealthHub is in private beta in Colombo. You can open the live beta from this page."],
  ["What is it built on?", "Cloudflare Workers at the edge, with a multilingual front end built by Thufail Ahamed at SynapX."],
];

const HERO_CHIPS = [
  { k: "Next dose", t: "8:00 PM · after rice", i: "⏰", c: "#1a8cff" },
  { k: "Blood pressure", t: "122/78 · this morning", i: "♥", c: "#21c08b" },
  { k: "HbA1c · Durdans", t: "6.1% · ▼ 0.7 this year", i: "↘", c: "#7a5cff" },
  { k: "This week", t: "3 papers scanned in", i: "⎙", c: "#ff8a3d" },
];

/* ── page ─────────────────────────────────────────────────────────────── */

export default function HealthLanding({ project: p, prev, next }: Props) {
  const root = useRef<HTMLDivElement>(null);
  useLandingBoot(root);

  useGSAP(
    () => {
      if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
      // each problem card sinks back into the dark as the next one slides over it
      const cards = gsap.utils.toArray<HTMLElement>(".hh-stackcard");
      cards.forEach((c, i) => {
        const nextCard = cards[i + 1];
        if (!nextCard) return;
        gsap.to(c, { scale: 0.9, filter: "brightness(0.45)", ease: "none", scrollTrigger: { trigger: nextCard, start: "top bottom", end: `top ${88 + (i + 1) * 18}px`, scrub: true } });
      });
      for (const img of gsap.utils.toArray<HTMLElement>(".hh-stackcard img")) {
        gsap.fromTo(img, { scale: 1.2 }, { scale: 1, ease: "none", scrollTrigger: { trigger: img.parentElement, start: "top bottom", end: "top top", scrub: true } });
      }
      gsap.fromTo(".hh-shot", { rotateX: 16, scale: 0.9, transformPerspective: 1600, transformOrigin: "50% 100%" }, { rotateX: 0, scale: 1, ease: "none", scrollTrigger: { trigger: ".hh-shot", start: "top bottom", end: "top 30%", scrub: 0.6 } });
      gsap.from(".hh-does-card", { x: 120, autoAlpha: 0, duration: 1.2, stagger: 0.08, ease: "expo.out", scrollTrigger: { trigger: ".hh-does", start: "top 85%", once: true } });
      gsap.from(".hh-moment", { scale: 0.6, autoAlpha: 0, duration: 1.2, stagger: 0.1, ease: "back.out(1.6)", clearProps: "transform", scrollTrigger: { trigger: ".hh-moments", start: "top 70%", once: true } });
    },
    { scope: root },
  );

  return (
    <div ref={root} className={`hh ${manrope.variable} ${sinhala.variable} ${tamil.variable}`}>
      <ScrollProgress color="linear-gradient(90deg, #8cc6ff, #1a8cff)" />
      <div className="hh-navwrap">
        <nav className="hh-nav" aria-label="HealthHub">
          <a href="#top" className="hh-logo">
            <sup>+</sup>HealthHub
          </a>
          <div className="hh-navlinks">
            <a href="#record">The record</a>
            <a href="#languages">Languages</a>
            <a href="#how">How it works</a>
            <a href="#faq">FAQ</a>
            <Link href="/projects">All work</Link>
          </div>
          <a href={p.link} target="_blank" rel="noreferrer" className="hh-btn hh-btn-black">
            Open HealthHub <Arrow />
          </a>
        </nav>
      </div>

      <Hero p={p} />

      {/* who it's for */}
      <section className="hh-sec">
        <div className="hh-shell">
          <Who />
        </div>
      </section>

      {/* everything in one record */}
      <section id="record" className="scroll-mt-4">
        <Records />
      </section>

      {/* problems, as stacked cards */}
      <section className="hh-sec hh-sec-tight">
        <div className="hh-shell">
          <h2 className="hh-h2 hh-mb" data-split>
            Why it had to exist
          </h2>
        </div>
        <div className="hh-stack">
          {p.challenges?.map((c, i) => (
            <article key={c.title} className="hh-stackcard" style={{ top: `${88 + i * 18}px` }}>
              <Image src={`/projects/healthhub/${["meds", "laptop", "hands"][i]}.webp`} alt="" fill sizes="100vw" />
              <div className="hh-stackcard-body">
                <p className="hh-chip hh-chip-glass">0{i + 1} · The problem</p>
                <h3 className="hh-h3">{c.title}</h3>
                <p>{c.problem}</p>
                <p className="hh-stack-move">
                  <b>HealthHub →</b> {c.move}
                </p>
              </div>
            </article>
          ))}
        </div>
      </section>

      {/* what it does */}
      <section className="hh-sec hh-sec-tight">
        <Does />
      </section>

      {/* languages */}
      <section id="languages" className="hh-sec hh-sec-tight scroll-mt-20">
        <div className="hh-shell">
          <Languages />
        </div>
      </section>

      {/* how it works */}
      <section id="how" className="hh-sec hh-sec-tight scroll-mt-20">
        <div className="hh-card-dark">
          <Capsules />
          <div className="hh-how">
            <div>
              <p className="hh-chip hh-chip-dark">How it works</p>
              <h2 className="hh-h2 hh-light">
                3-step
                <br />
                record
              </h2>
              <p className="hh-dim">From the paper in your hand to a history your doctor can read.</p>
            </div>
            <ol className="hh-how-steps">
              {[
                ["Snap it", "Photograph a prescription, report or scan — or upload the PDF the lab sent you."],
                ["We read it", "HealthHub reads it, dates it and files it into your timeline in about 3.8 seconds."],
                ["Keep it close", "Read it in English, Sinhala or Tamil, and show a doctor-ready summary at your next visit."],
              ].map(([t, b], i) => (
                <li key={t} data-reveal>
                  <span className="hh-step-dot">
                    <i /> Step {i + 1}
                  </span>
                  <b>{t}</b>
                  <p>{b}</p>
                </li>
              ))}
            </ol>
          </div>
        </div>
      </section>

      {/* moments */}
      <section className="hh-moments-wrap">
        <Moments />
      </section>

      {/* the build */}
      <section className="hh-sec hh-sec-tight">
        <div className="hh-shell hh-build">
          <div>
            <p className="hh-chip">The build</p>
            <h2 className="hh-h2" data-split>
              Designed and built
              <br />
              <span className="hh-blue">end to end.</span>
            </h2>
          </div>
          <div className="hh-build-grid">
            {p.metrics?.map((m) => (
              <div key={m.label} className="hh-metric" data-reveal data-glow data-tilt="10">
                <CountUp value={m.value} className="hh-metric-n" />
                <p>{m.label}</p>
              </div>
            ))}
            {p.facts?.map((f) => (
              <div key={f.label} className="hh-fact" data-reveal>
                <span>{f.label}</span>
                <b>{f.value}</b>
              </div>
            ))}
          </div>
        </div>
        <div className="hh-shell">
          <div className="hh-shot">
            <Image src={p.cover} alt="The live HealthHub app: a patient's record with HbA1c trend, next dose and blood pressure" width={1600} height={1000} />
          </div>
        </div>
      </section>

      {/* faq */}
      <section id="faq" className="hh-sec hh-sec-tight scroll-mt-20">
        <div className="hh-shell hh-faq">
          <h2 className="hh-h2" data-split>
            Answers to
            <br />
            popular questions
          </h2>
          <Faq />
        </div>
      </section>

      {/* footer */}
      <footer className="hh-foot">
        <div className="hh-blobs" aria-hidden>
          <i />
          <i />
          <i />
        </div>
        <div className="hh-shell hh-center">
          <h2 className="hh-h1" data-split>
            Your health has a history.
            <br />
            <span className="hh-blue">Keep it close.</span>
          </h2>
          <p className="hh-lede" data-reveal>
            {p.verdict?.statement}
          </p>
          <div className="hh-ctas" data-reveal>
            <a href={p.link} target="_blank" rel="noreferrer" className="hh-btn hh-btn-blue hh-btn-lg" data-magnetic>
              {p.liveLabel} <Arrow />
            </a>
            <Link href="/contact" className="hh-btn hh-btn-ghost hh-btn-lg" data-magnetic>
              Build something like this
            </Link>
          </div>
        </div>
        <div className="hh-shell hh-foot-nav">
          <Link href={`/projects/${prev.slug}`}>
            <span>← Previous</span>
            {prev.title}
          </Link>
          <Link href="/projects" className="hh-btn hh-btn-black">
            All work
          </Link>
          <Link href={`/projects/${next.slug}`} className="hh-foot-next">
            <span>Next →</span>
            {next.title}
          </Link>
        </div>
        <p className="hh-shell hh-foot-copy">
          <sup>+</sup>HealthHub · {p.category} · Designed and built by Thufail Ahamed
        </p>
      </footer>
    </div>
  );
}

function Arrow() {
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M3 8h10M9 4l4 4-4 4" />
    </svg>
  );
}

/* ── hero: the picture opens out to fill the card as you scroll ───────── */

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

function Hero({ p }: { p: Project }) {
  const [ref, pr] = useSectionProgress<HTMLDivElement>();
  // on a phone the picture starts as a band under the headline, clear of the stat below
  const [narrow, setNarrow] = useState(false);
  useEffect(() => {
    const mq = matchMedia("(max-width: 899px)");
    const sync = () => setNarrow(mq.matches);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);
  const from = narrow ? { top: 31, bottom: 52, side: 6 } : { top: 40, bottom: 21, side: 30 };
  const tilt = usePointer<HTMLDivElement>();
  const t = Math.min(1, pr * 1.35);
  const e = t * t * (3 - 2 * t);
  const ink = Math.round(lerp(17, 255, e));
  return (
    <header id="top" ref={ref} className="hh-hero" style={{ height: "210vh" }}>
      <div className="hh-hero-stick">
        <div ref={tilt} className="hh-hero-card">
          <div
            className="hh-hero-chips"
            aria-hidden
            style={{
              top: `${lerp(from.top, 0, e)}%`,
              bottom: `${lerp(from.bottom, 0, e)}%`,
              left: `${lerp(from.side, 0, e)}%`,
              right: `${lerp(from.side, 0, e)}%`,
              opacity: Math.max(0, 1 - Math.max(0, e - 0.45) / 0.35),
            }}
          >
            {HERO_CHIPS.map((c, i) => (
              <span key={c.t} className={`hh-chipcard hh-chipcard-${i}`}>
                <i style={{ background: c.c }}>{c.i}</i>
                <span>
                  <small>{c.k}</small>
                  {c.t}
                </span>
              </span>
            ))}
          </div>
          <div
            className="hh-hero-img"
            style={{
              top: `${lerp(from.top, 0, e)}%`,
              bottom: `${lerp(from.bottom, 0, e)}%`,
              left: `${lerp(from.side, 0, e)}%`,
              right: `${lerp(from.side, 0, e)}%`,
              borderRadius: `${lerp(22, 0, e)}px`,
            }}
          >
            <Image src="/projects/healthhub/visit.webp" alt="A doctor talking a patient through her results" fill priority sizes="100vw" />
            <div className="hh-hero-shade" style={{ opacity: e * 0.62 }} />
            <span className="hh-hero-plus" style={{ opacity: 1 - e }}>
              +
            </span>
          </div>
          <div className="hh-hero-inner" style={{ color: `rgb(${ink},${ink},${ink})` }}>
            <h1 className="hh-h1" data-split="load">
              Every prescription, scan and result —
              <br />
              <span className="hh-blue">in one place.</span>
            </h1>
            <div className="hh-hero-row">
              <div className="hh-hero-stat">
                <svg viewBox="0 0 40 24" width="44" height="26" fill="none" stroke="#1a8cff" strokeWidth="1.6" aria-hidden>
                  <path d="M2 18h8l4-12 6 16 4-8h14" />
                </svg>
                <CountUp value="3.8s" className="hh-stat" />
                <p>Paper to digital record</p>
                <p className="hh-hero-soft">Private beta · Colombo</p>
              </div>
              <div className="hh-hero-side">
                <p className="hh-hero-soft">Private, readable and doctor-ready — in English, Sinhala and Tamil.</p>
                <a href={p.link} target="_blank" rel="noreferrer" className="hh-btn hh-btn-blue hh-btn-lg" data-magnetic>
                  Open HealthHub <Arrow />
                </a>
              </div>
            </div>
            <div className="hh-kinds">
              <span>Keeps:</span>
              {KINDS.map((k) => (
                <em key={k}>
                  <i /> {k}
                </em>
              ))}
            </div>
          </div>
        </div>
      </div>
    </header>
  );
}

/* ── who it's for ─────────────────────────────────────────────────────── */

function Who() {
  const [on, setOn] = useState(0);
  return (
    <div className="hh-who">
      <div>
        <h2 className="hh-h3 hh-who-h" data-split>
          Who it&apos;s for
        </h2>
        <ol className="hh-who-list">
          {WHO.map((w, i) => (
            <li key={w.name} data-reveal>
              <button type="button" className={i === on ? "is-on" : ""} onMouseEnter={() => setOn(i)} onFocus={() => setOn(i)} onClick={() => setOn(i)}>
                <span className="hh-who-n">0{i + 1}</span>
                {w.name}
              </button>
            </li>
          ))}
        </ol>
      </div>
      <div className="hh-who-media" data-reveal data-tilt="6">
        {WHO.map((w, i) => (
          <div key={w.name} className={`hh-who-img ${i === on ? "is-on" : ""}`}>
            <Image src={`/projects/healthhub/${w.img}.webp`} alt="" fill sizes="(min-width: 900px) 40vw, 100vw" />
          </div>
        ))}
        <p className="hh-who-line">{WHO[on].line}</p>
      </div>
    </div>
  );
}

/* ── pinned: one record, many kinds of paper ──────────────────────────── */

function Records() {
  const [ref, pr] = useSectionProgress<HTMLDivElement>();
  const n = RECORDS.length;
  const on = Math.min(n - 1, Math.floor(pr * n));
  const r = RECORDS[on];
  return (
    <div ref={ref} style={{ height: `${n * 70 + 40}vh` }}>
      <div className="hh-rec-stick">
        <div className="hh-rec-card">
          {RECORDS.map((x, i) => (
            <div key={x.name} className={`hh-rec-bg ${i === on ? "is-on" : ""}`}>
              <Image src={`/projects/healthhub/${x.img}.webp`} alt="" fill sizes="100vw" />
            </div>
          ))}
          <div className="hh-rec-shade" />
          <div className="hh-rec-inner">
            <div className="hh-rec-list" aria-hidden>
              <div style={{ transform: `translateY(${-on * 100}px)` }}>
                {RECORDS.map((x, i) => (
                  <p key={x.name} className={i === on ? "is-on" : Math.abs(i - on) === 1 ? "is-near" : ""}>
                    {x.name}
                  </p>
                ))}
              </div>
            </div>
            <div className="hh-rec-side">
              <p className="hh-rec-kicker">
                Everything in one record{" "}
                <span className="hh-rec-count">
                  {String(on + 1).padStart(2, "0")} / {String(n).padStart(2, "0")}
                </span>
              </p>
              <div className="hh-rec-detail" key={on}>
                <p className="hh-rec-name">
                  <b>{r.name}</b>
                  <span>{r.tag}</span>
                </p>
                <p className="hh-rec-body">{r.body}</p>
                <div className="hh-rec-ui">
                  <span className="hh-rec-ui-ico">AP</span>
                  <div>
                    <b>{r.row[0]}</b>
                    <span>{r.row[1]}</span>
                  </div>
                  <em>Live</em>
                </div>
              </div>
            </div>
          </div>
          <div className="hh-rec-dots" aria-hidden>
            {RECORDS.map((x, i) => (
              <i key={x.name} className={i === on ? "is-on" : ""} />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ── what it does: a carousel of soft grey cards ──────────────────────── */

function Does() {
  const track = useRef<HTMLDivElement>(null);
  const drag = useRef<{ x: number; left: number } | null>(null);
  const go = (d: number) => track.current?.scrollBy({ left: d * (track.current.clientWidth * 0.8), behavior: "smooth" });
  const down = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.pointerType !== "mouse") return;
    drag.current = { x: e.clientX, left: e.currentTarget.scrollLeft };
    e.currentTarget.classList.add("is-drag");
  };
  const move = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!drag.current) return;
    e.currentTarget.scrollLeft = drag.current.left - (e.clientX - drag.current.x);
  };
  const up = (e: React.PointerEvent<HTMLDivElement>) => {
    drag.current = null;
    e.currentTarget.classList.remove("is-drag");
  };
  return (
    <>
      <div className="hh-shell hh-does-head">
        <h2 className="hh-h2" data-split>
          What it does
        </h2>
        <div className="hh-arrows">
          <button type="button" onClick={() => go(-1)} aria-label="Previous">
            ←
          </button>
          <button type="button" onClick={() => go(1)} aria-label="Next">
            →
          </button>
        </div>
      </div>
      <div ref={track} className="hh-does" data-lenis-prevent-horizontal onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerLeave={up}>
        {DOES.map((d) => (
          <article key={d.t} className="hh-does-card" data-glow data-tilt="8">
            <Clay kind={d.icon} />
            <h3 className="hh-h3">{d.t}</h3>
            <div className="hh-tags">
              {d.tags.map((t) => (
                <span key={t}>{t}</span>
              ))}
            </div>
            <p>{d.line}</p>
          </article>
        ))}
      </div>
    </>
  );
}

/** Soft grey "clay" icons, drawn rather than rendered. */
function Clay({ kind }: { kind: string }) {
  const body = {
    scan: (
      <>
        <rect x="34" y="18" width="62" height="80" rx="8" fill="url(#hh-c1)" />
        <path d="M46 36h38M46 48h30M46 60h36M46 72h22" stroke="#b9bcc2" strokeWidth="4" strokeLinecap="round" />
        <rect x="24" y="54" width="82" height="6" rx="3" fill="#1a8cff" opacity=".85" />
        <path d="M22 30V20h10M108 30V20H98M22 90v10h10M108 90v10H98" stroke="#8d9097" strokeWidth="4" fill="none" strokeLinecap="round" />
      </>
    ),
    lang: (
      <>
        <rect x="18" y="26" width="58" height="42" rx="10" fill="url(#hh-c1)" />
        <rect x="54" y="52" width="58" height="42" rx="10" fill="url(#hh-c2)" />
        <text x="47" y="54" textAnchor="middle" fontSize="20" fill="#7d8087" fontWeight="600">
          Aa
        </text>
        <text x="83" y="80" textAnchor="middle" fontSize="18" fill="#fff" fontWeight="500">
          අ த
        </text>
      </>
    ),
    doc: (
      <>
        <rect x="28" y="14" width="64" height="86" rx="8" fill="url(#hh-c1)" />
        <circle cx="48" cy="36" r="9" fill="#cfd2d7" />
        <path d="M62 32h20M62 40h14M40 58h40M40 68h40M40 78h26" stroke="#b9bcc2" strokeWidth="4" strokeLinecap="round" />
        <circle cx="90" cy="88" r="16" fill="#1a8cff" />
        <path d="m83 88 5 5 9-10" stroke="#fff" strokeWidth="4" fill="none" strokeLinecap="round" strokeLinejoin="round" />
      </>
    ),
    time: (
      <>
        <path d="M20 84 C 40 80, 50 50, 66 54 S 92 30, 108 22" stroke="#9fa3aa" strokeWidth="5" fill="none" strokeLinecap="round" />
        {[
          [20, 84],
          [50, 62],
          [80, 44],
          [108, 22],
        ].map(([x, y], i) => (
          <circle key={i} cx={x} cy={y} r={i === 3 ? 10 : 8} fill={i === 3 ? "#1a8cff" : "url(#hh-c1)"} stroke="#fff" strokeWidth="3" />
        ))}
      </>
    ),
    bell: (
      <>
        <path d="M64 18c-16 0-26 12-26 28v18l-8 12h68l-8-12V46c0-16-10-28-26-28z" fill="url(#hh-c1)" />
        <circle cx="64" cy="86" r="8" fill="#a9acb3" />
        <circle cx="92" cy="30" r="12" fill="#1a8cff" />
        <text x="92" y="35" textAnchor="middle" fontSize="13" fill="#fff" fontWeight="700">
          8
        </text>
      </>
    ),
    lock: (
      <>
        <path d="M64 12 98 24v28c0 22-16 38-34 46-18-8-34-24-34-46V24z" fill="url(#hh-c1)" />
        <rect x="50" y="48" width="28" height="22" rx="5" fill="#1a8cff" />
        <path d="M56 48v-6a8 8 0 0 1 16 0v6" stroke="#9fa3aa" strokeWidth="4" fill="none" />
      </>
    ),
  }[kind];
  return (
    <svg viewBox="0 0 128 112" className="hh-clay" aria-hidden>
      <defs>
        <linearGradient id="hh-c1" x1="0" y1="0" x2="0.6" y2="1">
          <stop offset="0" stopColor="#fbfbfc" />
          <stop offset="1" stopColor="#d5d7db" />
        </linearGradient>
        <linearGradient id="hh-c2" x1="0" y1="0" x2="0.6" y2="1">
          <stop offset="0" stopColor="#5aaeff" />
          <stop offset="1" stopColor="#1a7ae6" />
        </linearGradient>
        <filter id="hh-sh" x="-20%" y="-20%" width="140%" height="150%">
          <feDropShadow dx="0" dy="6" stdDeviation="5" floodColor="#000" floodOpacity="0.14" />
        </filter>
      </defs>
      <g filter="url(#hh-sh)">{body}</g>
    </svg>
  );
}

/* ── languages ────────────────────────────────────────────────────────── */

function Languages() {
  const [lang, setLang] = useState<keyof typeof LANGS>("si");
  const [auto, setAuto] = useState(true);
  const L = LANGS[lang];
  useEffect(() => {
    if (!auto) return;
    const order = Object.keys(LANGS) as (keyof typeof LANGS)[];
    const id = setTimeout(() => setLang(order[(order.indexOf(lang) + 1) % order.length]), 3200);
    return () => clearTimeout(id);
  }, [lang, auto]);
  return (
    <div className="hh-lang">
      <div className="hh-lang-copy">
        <p className="hh-chip">Languages</p>
        <h2 className="hh-h2" data-split>
          One record,
          <br />
          <span className="hh-blue">three languages.</span>
        </h2>
        <p className="hh-body" data-reveal>
          Patients and families across Sri Lanka read in different languages. HealthHub keeps the whole record — and the instructions on it — readable in
          English, Sinhala and Tamil. Switch below.
        </p>
        <div className="hh-seg" role="tablist" aria-label="Language">
          {(Object.keys(LANGS) as (keyof typeof LANGS)[]).map((k) => (
            <button key={k} type="button" role="tab" aria-selected={k === lang} className={`${k === lang ? "is-on" : ""} ${LANGS[k].cls}`} onClick={() => {
                setAuto(false);
                setLang(k);
              }}
            >
              {LANGS[k].label}
            </button>
          ))}
        </div>
      </div>
      <div className="hh-lang-stage">
        <div className="hh-rx" key={lang}>
          <div className="hh-rx-head">
            <span className="hh-rx-avatar">AP</span>
            <div>
              <b>Amara Perera</b>
              <span>Colombo 07 · 52y</span>
            </div>
            <em>Sample record</em>
          </div>
          <p className={`hh-rx-title ${L.cls}`}>{L.title}</p>
          <div className="hh-rx-med">
            <b>Metformin 500 mg</b>
            <span className={L.cls}>{L.dose}</span>
          </div>
          <div className="hh-rx-next">
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
              <path d="M6 16V11a6 6 0 0 1 12 0v5l2 2H4zM10 21h4" />
            </svg>
            <span className={L.cls}>{L.next}</span>
          </div>
          <div className="hh-rx-foot">
            <span>Dr. N. Fernando · 14 Oct 2026</span>
            <span>Scanned in 3.8 s</span>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ── floating capsules for the dark card ──────────────────────────────── */

function Capsules() {
  const ref = usePointer<HTMLDivElement>();
  return (
    <div ref={ref} className="hh-caps" aria-hidden>
      {[
        { x: "6%", y: "18%", r: -30, s: 1, b: 0 },
        { x: "18%", y: "62%", r: 20, s: 0.7, b: 2 },
        { x: "38%", y: "8%", r: 60, s: 0.6, b: 3 },
        { x: "46%", y: "72%", r: -50, s: 1.1, b: 1 },
        { x: "84%", y: "12%", r: 35, s: 0.8, b: 2 },
        { x: "90%", y: "70%", r: -15, s: 1.2, b: 0 },
      ].map((c, i) => (
        <i
          key={i}
          style={{
            left: `calc(${c.x} + var(--px, 0) * ${(c.b + 1) * 26 * (i % 2 ? 1 : -1)}px)`,
            top: `calc(${c.y} + var(--py, 0) * ${(c.b + 1) * 26 * (i % 2 ? 1 : -1)}px)`,
            transform: `rotate(${c.r}deg) scale(${c.s})`,
            filter: `blur(${c.b}px)`,
            animationDelay: `${i * -1.3}s`,
          }}
        />
      ))}
      <b className="hh-caps-ring" style={{ left: "70%", top: "40%" }} />
      <b className="hh-caps-ring" style={{ left: "28%", top: "34%", transform: "scale(.6)", filter: "blur(2px)" }} />
    </div>
  );
}

/* ── moments, floating around a heading ───────────────────────────────── */

const SPOTS = [
  { l: "4%", t: "8%", r: -6 },
  { l: "70%", t: "4%", r: 5 },
  { l: "-2%", t: "56%", r: 4 },
  { l: "40%", t: "62%", r: -3 },
  { l: "76%", t: "54%", r: -5 },
];

/** How far each card leans with the pointer, in px across the section. */
const DEPTH = [-60, 80, 50, -90, 70];

function Moments() {
  const ref = usePointer<HTMLDivElement>();
  return (
    <div ref={ref} className="hh-shell hh-moments">
      <h2 className="hh-h1 hh-moments-h" data-split>
        Built for the moments
        <br />
        <span className="hh-blue">care gets lost.</span>
      </h2>
      {MOMENTS.map((m, i) => (
        <figure key={m.who} className="hh-moment" style={{
            left: `calc(${SPOTS[i].l} + var(--px, 0) * ${DEPTH[i]}px)`,
            top: `calc(${SPOTS[i].t} + var(--py, 0) * ${DEPTH[i]}px)`,
            ["--r" as string]: `${SPOTS[i].r}deg`,
            animationDelay: `${i * -2.1}s`,
          }}
        >
          <span className="hh-quote" aria-hidden>
            “
          </span>
          <blockquote>{m.text}</blockquote>
          <figcaption>— {m.who}</figcaption>
          <div className="hh-moment-img">
            <Image src={`/projects/healthhub/${m.img}.webp`} alt="" fill sizes="240px" />
          </div>
        </figure>
      ))}
    </div>
  );
}

/* ── faq ──────────────────────────────────────────────────────────────── */

function Faq() {
  const [open, setOpen] = useState<number | null>(0);
  return (
    <div className="hh-faq-list">
      {FAQ.map(([q, a], i) => (
        <div key={q} className={`hh-faq-item ${open === i ? "is-open" : ""}`}>
          <button type="button" aria-expanded={open === i} onClick={() => setOpen(open === i ? null : i)}>
            {q}
            <span className="hh-faq-ico" aria-hidden>
              <Arrow />
            </span>
          </button>
          <div className="hh-faq-a">
            <p>{a}</p>
          </div>
        </div>
      ))}
    </div>
  );
}
