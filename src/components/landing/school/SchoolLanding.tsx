"use client";

import { Archivo } from "next/font/google";
import Image from "next/image";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import type { Project } from "@/content/site";
import { gsap, ScrollTrigger, SplitText, useGSAP } from "@/lib/gsap";
import { CountUp, ScrollProgress, useLandingBoot } from "../shared";
import "./school.css";

const archivo = Archivo({ subsets: ["latin"], axes: ["wdth"], variable: "--font-sc" });

type Props = { project: Project; prev: Project; next: Project };

/* ── content ──────────────────────────────────────────────────────────── */

const MODULES = ["Attendance", "Exams & marks", "Timetables", "Library", "Payments", "Ticketing", "Calendar", "Announcements", "Leave requests"];

const PORTALS = [
  { name: "Platform", who: "SynapX operators", icon: "M4 6h16v12H4zM4 10h16" },
  { name: "Admin", who: "Principals & office", icon: "M12 3l8 4v5c0 5-4 8-8 9-4-1-8-4-8-9V7z" },
  { name: "Teacher", who: "Classes & marks", icon: "M4 19V6l8-3 8 3v13M9 19v-6h6v6" },
  { name: "Student", who: "Timetable & results", icon: "M12 4 2 9l10 5 10-5zM6 11v5c3 2 9 2 12 0v-5" },
  { name: "Parent", who: "Attendance & fees", icon: "M8 8a3 3 0 1 0 0-.01M17 9a2 2 0 1 0 0-.01M3 20c0-4 3-6 5-6s5 2 5 6M14 20c0-3 1.5-5 3-5s3 2 3 5" },
  { name: "Library", who: "Circulation", icon: "M5 4h4v16H5zM10 4h4v16h-4zM15 5l3.5-1 3 15-3.5 1z" },
];

const SERVICES = [
  { left: "QR scan", name: "Attendance", right: "Geofenced", a: ["Dual-token QR", "Printed ID cards plus 90-second rotating HMAC tokens — a photo of yesterday's code is worthless."], b: ["Replay guard", "Scan cooldowns, replay protection and a geofence around the school gate."] },
  { left: "Grading", name: "Exams & marks", right: "Report cards", a: ["Marks entry", "Teachers enter marks per class and subject, validated server-side with Zod."], b: ["Results", "Students and parents see results the moment a term is published."] },
  { left: "Circulation", name: "Library", right: "Catalogue", a: ["Issue & return", "Books issued by scan, with due dates and fines tracked per student."], b: ["Catalogue", "One catalogue per school, searchable from the student portal."] },
  { left: "Fees", name: "Payments", right: "Receipts", a: ["Fee schedules", "Per-class fee plans with instalments and reminders to parents."], b: ["Receipts", "Every payment receipted and reconciled against the student's ledger."] },
  { left: "Support", name: "Ticketing", right: "SLA", a: ["Requests", "Parents and staff raise tickets that route to the right office."], b: ["Audit", "Every status change logged — who did what, and when."] },
];

const WORK = [
  { img: "teacher", tag: "Teacher portal", year: "Classes", title: "Mark a register in one scan", body: "Class lists, QR attendance, marks entry and timetables for the teacher's own subjects — nothing else." },
  { img: "students", tag: "Student portal", year: "Results", title: "Timetable, results, library", body: "A student sees their own timetable, published results and borrowed books — scoped by RLS to them alone." },
  { img: "kids", tag: "Parent portal", year: "Fees", title: "Attendance and fees, live", body: "Parents see attendance as it is scanned, pay fees, and raise tickets with the school office." },
  { img: "library", tag: "Library portal", year: "Circulation", title: "Circulation without paper", body: "Issue, return and fines by scan, against one catalogue per school." },
];

/* ── page ─────────────────────────────────────────────────────────────── */

export default function SchoolLanding({ project: p, prev, next }: Props) {
  const root = useRef<HTMLDivElement>(null);
  useLandingBoot(root);

  // the wordmark is fitted edge to edge; the ruler's orange bar fills as you scroll
  useGSAP(
    (_, contextSafe) => {
      const fit = () => {
        for (const el of gsap.utils.toArray<HTMLElement>(".sc-fit")) {
          el.style.fontSize = "100px";
          const w = el.parentElement!.clientWidth;
          el.style.fontSize = `${(100 * w) / el.scrollWidth}px`;
        }
      };
      fit();
      const ro = new ResizeObserver(fit);
      ro.observe(root.current!);
      const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;

      // the letters of the wordmark rise one by one, then the two lines part as the hero leaves
      document.fonts?.ready.then(
        contextSafe!(() => {
          fit();
          if (reduce) return;
          const split = SplitText.create(".sc-fit", { type: "chars" });
          fit();
          gsap.from(split.chars, { yPercent: 110, duration: 1.1, stagger: 0.035, ease: "expo.out", delay: 0.2 });
          gsap.to(".sc-fit:first-child", { xPercent: -9, ease: "none", scrollTrigger: { trigger: ".sc-mark", start: "top 60%", end: "bottom top", scrub: true } });
          gsap.to(".sc-fit:last-child", { xPercent: 7, ease: "none", scrollTrigger: { trigger: ".sc-mark", start: "top 60%", end: "bottom top", scrub: true } });
        }),
      );

      gsap.fromTo(".sc-ruler-bar", { scaleY: 0.15 }, { scaleY: 1, ease: "none", scrollTrigger: { trigger: ".sc-ruler", start: "top 85%", end: "bottom 40%", scrub: true } });
      gsap.to(".sc-bleed img", { yPercent: 12, ease: "none", scrollTrigger: { trigger: ".sc-bleed", start: "top bottom", end: "bottom top", scrub: true } });
      if (reduce) return () => ro.disconnect();

      // full-bleed photographs open out from a framed window
      for (const el of gsap.utils.toArray<HTMLElement>(".sc-bleed")) {
        gsap.fromTo(el, { clipPath: "inset(9% 11% 9% 11%)" }, { clipPath: "inset(0% 0% 0% 0%)", ease: "none", scrollTrigger: { trigger: el, start: "top bottom", end: "top 15%", scrub: true } });
      }
      gsap.fromTo(".sc-outcome-img img", { scale: 1.3 }, { scale: 1, ease: "none", scrollTrigger: { trigger: ".sc-outcome", start: "top bottom", end: "bottom top", scrub: true } });
      gsap.to(".sc-petal", { rotate: 120, ease: "none", scrollTrigger: { trigger: ".sc-infra", start: "top bottom", end: "bottom top", scrub: true } });

      // portal icons draw themselves; process rules draw across
      gsap.fromTo(".sc-portal path", { strokeDashoffset: 1 }, { strokeDashoffset: 0, duration: 1.6, stagger: 0.12, ease: "power2.inOut", scrollTrigger: { trigger: ".sc-portals-cells", start: "top 85%", once: true } });
      gsap.from(".sc-step-line", { scaleX: 0, duration: 1.4, stagger: 0.15, ease: "expo.inOut", scrollTrigger: { trigger: ".sc-steps", start: "top 80%", once: true } });
      gsap.from(".sc-status-row i", { scaleX: 0, transformOrigin: "left", duration: 1.2, stagger: 0.08, ease: "expo.out", delay: 0.6 });

      // the ticker runs faster with the scroll, and backwards when you scroll up
      const tl = gsap.to(".sc-ticker-track", { xPercent: -50, duration: 40, ease: "none", repeat: -1 });
      let boost = 0;
      ScrollTrigger.create({ onUpdate: (self) => void (boost = gsap.utils.clamp(-8, 8, self.getVelocity() / 200)) });
      const tick = () => {
        boost *= 0.93;
        tl.timeScale(1 + boost);
      };
      gsap.ticker.add(tick);
      return () => {
        ro.disconnect();
        gsap.ticker.remove(tick);
      };
    },
    { scope: root },
  );

  // an engineering crosshair with a live coordinate readout follows the pointer over the hero
  const cross = useRef<HTMLDivElement>(null);
  const readout = useRef<HTMLSpanElement>(null);
  const trace = (e: React.PointerEvent<HTMLElement>) => {
    const c = cross.current;
    if (!c || e.pointerType !== "mouse") return;
    const r = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - r.left;
    const y = e.clientY - r.top;
    c.style.setProperty("--x", `${x}px`);
    c.style.setProperty("--y", `${y}px`);
    c.classList.add("is-on");
    if (readout.current) readout.current.textContent = `X ${String(Math.round(x)).padStart(4, "0")} · Y ${String(Math.round(y)).padStart(4, "0")}`;
  };

  return (
    <div ref={root} className={`sc ${archivo.variable}`}>
      <ScrollProgress color="#ff5f15" />
      <nav className="sc-nav" aria-label="Ledger EMS">
        <a href="#top" className="sc-cell sc-logo">
          LEDGER EMS
        </a>
        <a href="#portals" className="sc-cell sc-navlink">
          Portals
        </a>
        <a href="#modules" className="sc-cell sc-navlink">
          Modules
        </a>
        <a href="#attendance" className="sc-cell sc-navlink">
          Attendance
        </a>
        <a href="#process" className="sc-cell sc-navlink">
          Process
        </a>
        <Link href="/projects" className="sc-cell sc-navlink">
          All work
        </Link>
        <a href={p.link} target="_blank" rel="noreferrer" className="sc-cell sc-cta">
          Open platform <span aria-hidden>→</span>
        </a>
      </nav>

      {/* hero */}
      <header id="top" className="sc-panel sc-hero" onPointerMove={trace} onPointerLeave={() => cross.current?.classList.remove("is-on")}>
        <div className="sc-cols" aria-hidden />
        <div ref={cross} className="sc-cross" aria-hidden>
          <i className="sc-cross-x" />
          <i className="sc-cross-y" />
          <span ref={readout} className="sc-cross-label sc-caps" />
        </div>
        <div className="sc-hero-top sc-caps">
          <span>School management platform</span>
          <span>Colombo, Sri Lanka</span>
          <span>Live · {p.year}</span>
        </div>
        <div className="sc-hero-mid">
          <div className="sc-badge" data-reveal>
            <svg className="sc-badge-ring" viewBox="0 0 200 200" aria-hidden>
              <defs>
                <path id="sc-ring" d="M100,100 m-86,0 a86,86 0 1,1 172,0 a86,86 0 1,1 -172,0" />
              </defs>
              <text>
                <textPath href="#sc-ring">ROW-LEVEL SECURITY · PER TENANT · AUDITED · ROW-LEVEL SECURITY · PER TENANT · AUDITED ·</textPath>
              </text>
            </svg>
            <CountUp value="252" className="sc-badge-n" />
            <span>
              RLS policies
              <br />
              per tenant
            </span>
          </div>
          <div className="sc-caps sc-chain" data-reveal>
            <p>Admin → Teacher → Student → Parent → Library</p>
            <p className="sc-soft">Six portals, one login</p>
          </div>
          <div className="sc-hero-copy" data-reveal>
            <p>
              One codebase serving many schools — each one a tenant whose data is walled off by the database itself. Attendance, exams, library, payments
              and ticketing, live in days rather than weeks.
            </p>
            <a href={p.link} target="_blank" rel="noreferrer" className="sc-btn sc-btn-orange" data-magnetic>
              Open the platform <span aria-hidden>→</span>
            </a>
          </div>
        </div>
        <h1 className="sc-mark" aria-label="Ledger School System">
          <span className="sc-fit">LEDGER</span>
          <span className="sc-fit">SCHOOL SYSTEM</span>
        </h1>
        <div className="sc-hero-foot">
          <div className="sc-tab sc-caps">Live / Colombo</div>
          <div className="sc-wire">
            <Wire shape="school" />
          </div>
          <div className="sc-status" data-scramble="0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ">
            <p className="sc-status-h">
              System status <i className="sc-pulse" />
            </p>
            {[
              ["Tenants", "Isolated"],
              ["Portals", "6"],
              ["Tables", "68"],
              ["RLS policies", "252"],
              ["QR token TTL", "90 s"],
              ["Time to live", "10 weeks"],
            ].map(([k, v]) => (
              <p key={k} className="sc-status-row sc-caps">
                <span>{k}</span>
                <i />
                <b data-line>{v}</b>
              </p>
            ))}
          </div>
        </div>
      </header>

      {/* ticker */}
      <div className="sc-ticker" aria-hidden>
        <div className="sc-ticker-track">
          {[0, 1].map((k) => (
            <span key={k}>
              {MODULES.map((m) => (
                <em key={m}>
                  {m} <b>/</b>
                </em>
              ))}
            </span>
          ))}
        </div>
      </div>

      {/* bleed image */}
      <section className="sc-bleed" aria-label="Classroom">
        <Image src="/projects/school-system/classroom.webp" alt="An empty classroom, desks in rows" fill sizes="100vw" />
        <a href={p.link} target="_blank" rel="noreferrer" className="sc-round" aria-label="Open the live platform">
          <svg viewBox="0 0 24 24" width="34" height="34" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden>
            <path d="m9 5 7 7-7 7" />
          </svg>
        </a>
        <p className="sc-bleed-cap sc-caps">Every classroom, one register — scanned, signed, synced.</p>
      </section>

      {/* manifesto + ruler */}
      <section className="sc-panel sc-manifesto">
        <div className="sc-hero-top sc-caps">
          <span>Multi-tenant</span>
          <span>Role-based</span>
          <span>Auditable</span>
        </div>
        <div className="sc-ruler" aria-hidden>
          <div className="sc-ruler-bar">
            <i />
          </div>
          {Array.from({ length: 16 }, (_, i) => (
            <span key={i} className={i > 4 && i < 14 ? "is-short" : ""} />
          ))}
        </div>
        <div className="sc-manifesto-body">
          <div className="sc-hatch" aria-hidden />
          <div>
            <h2 className="sc-h2" data-split>
              We built a school system schools can trust with their children&apos;s data.
            </h2>
            <p className="sc-body" data-reveal>
              {p.description[0]} {p.description[1]}
            </p>
            <a href="#process" className="sc-link sc-caps" data-reveal>
              How it was built <span aria-hidden>→</span>
            </a>
          </div>
        </div>
      </section>

      {/* portals */}
      <section id="portals" className="sc-portals scroll-mt-16">
        <div className="sc-barcode" aria-hidden />
        <div className="sc-portals-row">
          <div className="sc-portals-lead">
            <div className="sc-portals-orange sc-caps">One login</div>
            <div className="sc-portals-dark sc-caps">Portals:</div>
          </div>
          <div className="sc-portals-cells">
            {PORTALS.map((x) => (
              <div key={x.name} className="sc-portal" data-reveal data-tilt="10">
                <svg viewBox="0 0 24 24" width="30" height="30" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" strokeLinecap="round" aria-hidden>
                  <path d={x.icon} pathLength={1} />
                </svg>
                <b>{x.name}</b>
                <span>{x.who}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* modules */}
      <section id="modules" className="sc-split scroll-mt-16">
        <Modules />
      </section>

      {/* selected portals */}
      <section className="sc-panel sc-work-head">
        <div>
          <h2 className="sc-h2 sc-h2-xl" data-split>
            Inside the portals
          </h2>
          <p className="sc-body" data-reveal>
            Each role sees exactly its own slice of the school — enforced by the database on every query.
          </p>
        </div>
        <a href={p.link} target="_blank" rel="noreferrer" className="sc-btn sc-btn-dark" data-magnetic>
          View live platform <span aria-hidden>→</span>
        </a>
      </section>
      <section className="sc-work">
        {WORK.map((w) => (
          <article key={w.title} className="sc-card" data-clip>
            <div className="sc-card-img" data-glow>
              <Image src={`/projects/school-system/${w.img}.webp`} alt="" fill sizes="(min-width: 768px) 50vw, 100vw" />
              <i className="sc-screw sc-screw-a" />
              <i className="sc-screw sc-screw-b" />
            </div>
            <div className="sc-card-body">
              <p className="sc-caps sc-card-meta">
                <span>{w.tag}</span>
                <span>{w.year}</span>
              </p>
              <h3 className="sc-h3">{w.title}</h3>
              <p className="sc-body-s">{w.body}</p>
            </div>
            <a href={p.link} target="_blank" rel="noreferrer" className="sc-card-foot sc-caps">
              Open portal <span aria-hidden>→</span>
            </a>
          </article>
        ))}
      </section>

      {/* bento */}
      <section id="attendance" className="sc-bento scroll-mt-16">
        <div className="sc-b sc-b-grey" data-clip>
          <p className="sc-body-s">
            A register that works once is easy. This one is designed for the hundredth school: the shared phone, the screenshot of a code, the parent at
            the gate.
          </p>
          <h2 className="sc-h2 sc-h2-xl" data-split>
            Attendance you can&apos;t fake.
          </h2>
          <p className="sc-body-s sc-b-note">
            Printed ID cards carry a static token; the teacher&apos;s screen shows a second, HMAC-signed token that rotates every 90 seconds. Both must match,
            inside the geofence, once.
          </p>
        </div>
        <div className="sc-b sc-b-dark" data-clip>
          <h3 className="sc-h3">Isolation by default</h3>
          <p className="sc-body-s">Every school is a tenant. 252 row-level security policies across 68 tables mean a query can only ever see its own school.</p>
        </div>
        <div className="sc-b sc-b-white sc-b-qr" data-clip>
          <Qr />
        </div>
        <div className="sc-b sc-b-white sc-b-stat" data-clip>
          <CountUp value="68" className="sc-stat" />
          <p className="sc-caps">Tables, one schema</p>
        </div>
        <div className="sc-b sc-b-orange" data-clip>
          <h3 className="sc-h3">Live in 48 hours</h3>
          <p className="sc-body-s">A rollout path that takes a new school from signed contract to scanning registers in two days.</p>
        </div>
      </section>

      {/* process */}
      <section id="process" className="sc-panel sc-process scroll-mt-16">
        <div className="sc-process-head">
          <p className="sc-caps sc-soft">Process / 10 weeks</p>
          <h2 className="sc-h2 sc-h2-xl" data-split>
            From register to release
          </h2>
        </div>
        <ol className="sc-steps">
          {p.timeline?.map((t, i) => (
            <li key={t.phase} data-reveal>
              <i className="sc-step-line" aria-hidden />
              <span className="sc-step-n" data-scramble="0123456789">
                0{i + 1}
              </span>
              <span className="sc-caps sc-step-phase">{t.phase}</span>
              <b className="sc-step-t">{t.title}</b>
              <span className="sc-body-s">{t.description}</span>
            </li>
          ))}
        </ol>
      </section>

      {/* infrastructure */}
      <section className="sc-bleed sc-bleed-short" aria-label="Campus">
        <Image src="/projects/school-system/campus.webp" alt="A school campus building across a lawn" fill sizes="100vw" />
      </section>
      <section className="sc-panel sc-infra-head">
        <h2 className="sc-h2 sc-h2-xl">The stack underneath</h2>
      </section>
      <section className="sc-infra">
        {[
          { t: "Next.js", b: "Six role portals in one app, routed by RBAC claims carried in the session JWT.", s: 5 },
          { t: "Supabase + RLS", b: "PostgreSQL with 252 row-level security policies — isolation as a database guarantee.", s: 7 },
          { t: "Zod Server Actions", b: "Every write validated on the server before it touches a table.", s: 4 },
          { t: "QR Attendance", b: "Dual-token, HMAC-signed, replay-guarded and geofenced.", s: 9 },
        ].map((x) => (
          <article key={x.t} className="sc-infra-cell" data-clip>
            <Petal n={x.s} />
            <h3 className="sc-h3">{x.t}</h3>
            <p className="sc-body-s">{x.b}</p>
          </article>
        ))}
      </section>

      {/* outcome */}
      <section className="sc-outcome">
        <div className="sc-outcome-img">
          <Image src="/projects/school-system/grads.webp" alt="Graduates throwing caps into the air" fill sizes="(min-width: 900px) 50vw, 100vw" />
        </div>
        <div className="sc-outcome-body">
          <p className="sc-caps">The result</p>
          <h2 className="sc-h2 sc-h2-xl">{p.verdict?.title}</h2>
          <p className="sc-body">{p.verdict?.statement}</p>
          <ul className="sc-outcomes">
            {p.outcomes?.map((o) => (
              <li key={o}>{o}</li>
            ))}
          </ul>
          <a href={p.link} target="_blank" rel="noreferrer" className="sc-btn sc-btn-dark" data-magnetic>
            {p.liveLabel} <span aria-hidden>→</span>
          </a>
        </div>
      </section>

      <footer className="sc-panel sc-foot">
        <div className="sc-foot-grid">
          <div>
            <p className="sc-foot-mark">LEDGER EMS</p>
            <p className="sc-body-s">{p.tagline}</p>
          </div>
          <div className="sc-caps sc-foot-col">
            <span className="sc-soft">Role</span>
            {p.role}
          </div>
          <div className="sc-caps sc-foot-col">
            <span className="sc-soft">Stack</span>
            {p.stack.join(" · ")}
          </div>
        </div>
        <div className="sc-foot-nav">
          <Link href={`/projects/${prev.slug}`} className="sc-foot-link">
            <span className="sc-caps sc-soft">← Previous</span>
            {prev.title}
          </Link>
          <Link href="/projects" className="sc-btn sc-btn-dark" data-magnetic>
            All work
          </Link>
          <Link href={`/projects/${next.slug}`} className="sc-foot-link sc-foot-right">
            <span className="sc-caps sc-soft">Next →</span>
            {next.title}
          </Link>
        </div>
      </footer>
    </div>
  );
}

/* ── modules: a table on the left, a globe and the detail on the right ── */

function Modules() {
  const [on, setOn] = useState(0);
  const s = SERVICES[on];
  return (
    <>
      <div className="sc-split-left">
        <div className="sc-bar sc-caps">
          <span>Core modules</span>
          <span aria-hidden>{">>>>>>>>>><<<<<<<<<<"}</span>
        </div>
        <div className="sc-split-pad">
          <h2 className="sc-h2 sc-h2-xl" data-split>
            Modules
          </h2>
          <p className="sc-body" data-reveal>
            Five modules, one tenant model. Each one written once and served to every school, with the school&apos;s data scoped by the database.
          </p>
          <a href="#attendance" className="sc-btn sc-btn-dark" data-magnetic>
            See attendance <span aria-hidden>→</span>
          </a>
          <div className="sc-table" role="tablist">
            {SERVICES.map((x, i) => (
              <button key={x.name} type="button" role="tab" aria-selected={i === on} className={i === on ? "is-on" : ""} onClick={() => setOn(i)}>
                <span>{x.left}</span>
                <b>{x.name}</b>
                <span>{x.right}</span>
              </button>
            ))}
          </div>
        </div>
      </div>
      <div className="sc-split-gap" aria-hidden />
      <div className="sc-split-right">
        <div className="sc-dots">
          <Wire shape="sphere" />
        </div>
        <div className="sc-detail" key={on}>
          <div className="sc-detail-head">
            <p className="sc-caps">{s.left}</p>
            <h3 className="sc-h2">{s.name}</h3>
          </div>
          <div className="sc-detail-cols">
            {[s.a, s.b].map(([t, b]) => (
              <div key={t}>
                <b>{t}</b>
                <p className="sc-body-s">{b}</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </>
  );
}

/* ── a dashed wireframe, turning slowly ───────────────────────────────── */

type V = [number, number, number];

function shapeOf(kind: "school" | "sphere"): [V, V][] {
  const e: [V, V][] = [];
  if (kind === "sphere") {
    const seg = 28;
    for (let m = 0; m < 6; m++) {
      const a = (m / 6) * Math.PI;
      for (let k = 0; k < seg; k++) {
        const t0 = (k / seg) * Math.PI * 2;
        const t1 = ((k + 1) / seg) * Math.PI * 2;
        const pt = (t: number): V => [Math.cos(t) * Math.cos(a), Math.sin(t), Math.cos(t) * Math.sin(a)];
        e.push([pt(t0), pt(t1)]);
      }
    }
    for (const lat of [-0.5, 0, 0.5]) {
      const r = Math.sqrt(1 - lat * lat);
      for (let k = 0; k < seg; k++) {
        const t0 = (k / seg) * Math.PI * 2;
        const t1 = ((k + 1) / seg) * Math.PI * 2;
        e.push([
          [Math.cos(t0) * r, lat, Math.sin(t0) * r],
          [Math.cos(t1) * r, lat, Math.sin(t1) * r],
        ]);
      }
    }
    return e;
  }
  // a school block: a long hall with a pitched roof and a bell tower
  const box = (x0: number, x1: number, y0: number, y1: number, z0: number, z1: number) => {
    const c: V[] = [
      [x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1],
      [x0, y1, z0], [x1, y1, z0], [x1, y1, z1], [x0, y1, z1],
    ];
    const idx = [[0, 1], [1, 2], [2, 3], [3, 0], [4, 5], [5, 6], [6, 7], [7, 4], [0, 4], [1, 5], [2, 6], [3, 7]];
    idx.forEach(([a, b]) => e.push([c[a], c[b]]));
  };
  box(-1.3, 1.3, -0.5, 0.15, -0.45, 0.45);
  e.push([[-1.3, 0.15, -0.45], [-1.3, 0.5, 0]], [[-1.3, 0.15, 0.45], [-1.3, 0.5, 0]], [[1.3, 0.15, -0.45], [1.3, 0.5, 0]], [[1.3, 0.15, 0.45], [1.3, 0.5, 0]], [[-1.3, 0.5, 0], [1.3, 0.5, 0]]);
  box(-0.2, 0.2, 0.15, 0.95, -0.2, 0.2);
  e.push([[-0.2, 0.95, -0.2], [0, 1.2, 0]], [[0.2, 0.95, -0.2], [0, 1.2, 0]], [[0.2, 0.95, 0.2], [0, 1.2, 0]], [[-0.2, 0.95, 0.2], [0, 1.2, 0]]);
  for (let i = -3; i <= 3; i++) if (i) e.push([[i * 0.36, -0.15, 0.45], [i * 0.36, 0.0, 0.45]]);
  return e;
}

function Wire({ shape }: { shape: "school" | "sphere" }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current!;
    const g = c.getContext("2d")!;
    const edges = shapeOf(shape);
    const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
    let raf = 0;
    let visible = true;
    const io = new IntersectionObserver(([e]) => (visible = e.isIntersecting));
    io.observe(c);
    const draw = (t: number) => {
      raf = requestAnimationFrame(draw);
      if (!visible) return;
      const dpr = Math.min(devicePixelRatio, 2);
      const w = c.clientWidth;
      const h = c.clientHeight;
      if (c.width !== Math.round(w * dpr)) {
        c.width = Math.round(w * dpr);
        c.height = Math.round(h * dpr);
      }
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.clearRect(0, 0, w, h);
      const a = reduce ? 0.7 : t / 4200;
      const tilt = shape === "sphere" ? 0.35 : 0.42;
      const scale = Math.min(w, h) * (shape === "sphere" ? 0.36 : 0.3);
      const proj = ([x, y, z]: V) => {
        const x1 = x * Math.cos(a) - z * Math.sin(a);
        const z1 = x * Math.sin(a) + z * Math.cos(a);
        const y1 = y * Math.cos(tilt) - z1 * Math.sin(tilt);
        const z2 = y * Math.sin(tilt) + z1 * Math.cos(tilt);
        const f = 3.2 / (3.2 + z2);
        return [w / 2 + x1 * scale * f, h / 2 - y1 * scale * f, z2] as const;
      };
      g.setLineDash(shape === "sphere" ? [] : [5, 4]);
      g.lineWidth = 1;
      for (const [p0, p1] of edges) {
        const A = proj(p0);
        const B = proj(p1);
        const depth = (A[2] + B[2]) / 2;
        g.strokeStyle = `rgba(235, 238, 242, ${shape === "sphere" ? 0.25 + (1 - depth) * 0.25 : 0.45 + (1 - depth) * 0.3})`;
        g.beginPath();
        g.moveTo(A[0], A[1]);
        g.lineTo(B[0], B[1]);
        g.stroke();
      }
      if (reduce) cancelAnimationFrame(raf);
    };
    raf = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(raf);
      io.disconnect();
    };
  }, [shape]);
  return <canvas ref={ref} aria-hidden className="sc-wire-canvas" />;
}

/* ── a rotating attendance token ──────────────────────────────────────── */

const N = 21;
function qrBits(seed: number) {
  let s = (seed * 2654435761) >>> 0;
  const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
  const bits: boolean[] = [];
  for (let y = 0; y < N; y++)
    for (let x = 0; x < N; x++) {
      const inFinder = (cx: number, cy: number) => x >= cx && x < cx + 7 && y >= cy && y < cy + 7;
      const finder = inFinder(0, 0) || inFinder(N - 7, 0) || inFinder(0, N - 7);
      if (finder) {
        const fx = x >= N - 7 ? x - (N - 7) : x;
        const fy = y >= N - 7 ? y - (N - 7) : y;
        const ring = Math.max(Math.abs(fx - 3), Math.abs(fy - 3));
        bits.push(ring !== 2);
      } else bits.push(rnd() > 0.52);
    }
  return bits;
}
const hex = (seed: number) => ((seed * 2246822519) >>> 0).toString(16).padStart(8, "0");

function Qr() {
  const PERIOD = 9;
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, []);
  const seed = 7 + Math.floor(tick / PERIOD);
  const left = PERIOD - (tick % PERIOD);
  const bits = qrBits(seed);
  return (
    <div className="sc-qr">
      <div className="sc-qr-top sc-caps">
        <span>Grade 9-B · Period 2</span>
        <span className="sc-qr-live">
          <i className="sc-pulse" /> Live token
        </span>
      </div>
      <div className="sc-qr-grid" key={seed}>
        {bits.map((b, i) => (
          <i key={i} className={b ? "is-on" : ""} />
        ))}
      </div>
      <div className="sc-qr-meta sc-caps">
        <span>
          hmac <b>{hex(seed)}…</b>
        </span>
        <span>
          rotates in <b>{String(left).padStart(2, "0")}s</b>
        </span>
      </div>
      <div className="sc-qr-bar">
        <i style={{ transform: `scaleX(${left / PERIOD})` }} />
      </div>
      <p className="sc-qr-note">Demo token — 90 s in production, sped up here.</p>
    </div>
  );
}

/* ── line-art flower for the stack cells ──────────────────────────────── */

function Petal({ n }: { n: number }) {
  const lines = [];
  for (let k = 0; k < n; k++) {
    const a = (k / n) * Math.PI * 2;
    for (let j = 0; j < 9; j++) {
      const spread = (j - 4) * 0.06;
      const x = 50 + Math.cos(a + spread) * 44;
      const y = 50 + Math.sin(a + spread) * 44;
      const cx = 50 + Math.cos(a + spread * 4 + 0.5) * 22;
      const cy = 50 + Math.sin(a + spread * 4 + 0.5) * 22;
      lines.push(<path key={`${k}-${j}`} d={`M50 50 Q ${cx.toFixed(1)} ${cy.toFixed(1)} ${x.toFixed(1)} ${y.toFixed(1)}`} />);
    }
  }
  return (
    <svg viewBox="0 0 100 100" className="sc-petal" aria-hidden>
      <g fill="none" stroke="currentColor" strokeWidth="0.45">
        {lines}
      </g>
    </svg>
  );
}
