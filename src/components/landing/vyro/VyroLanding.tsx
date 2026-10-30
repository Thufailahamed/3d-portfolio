"use client";

import { IBM_Plex_Mono } from "next/font/google";
import Image from "next/image";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import type { Project } from "@/content/site";
import { lenis } from "@/components/SmoothScroll";
import { gsap, ScrollTrigger, useGSAP } from "@/lib/gsap";
import { ScrollProgress, useLandingBoot, useSectionProgress } from "../shared";
import "./vyro.css";

const mono = IBM_Plex_Mono({ subsets: ["latin"], weight: ["400", "500", "600"], variable: "--font-vy-mono" });

type Props = { project: Project; prev: Project; next: Project };

/** The characters the pixel headlines pass through as they decode. */
const GLYPHS = "01<>/#%░▒▓";

/* ── content ──────────────────────────────────────────────────────────── */

const COMMODITIES = ["Samba rice", "Ceylon tea", "White sugar", "Coconut oil", "Wheat flour", "Red dhal", "Cement", "Spices", "Milk powder", "Onions", "Canned fish", "Soap & detergent"];

const AISLES = [
  { img: "rice", name: "Rice & grains", tag: "Mill-direct", line: "Samba, nadu and keeri samba from verified mills · 25 kg bags · MOQ 5" },
  { img: "tea", name: "Ceylon tea", tag: "Estate direct", line: "BOPF and dust grades from estate packers, priced live in LKR" },
  { img: "spices", name: "Spices", tag: "Grade 1 export", line: "Pepper, cinnamon, cloves and chilli from licensed exporters" },
  { img: "wheat", name: "Flour & pulses", tag: "Importer direct", line: "Wheat flour, dhal and chickpeas straight from the importer" },
  { img: "produce", name: "Fresh produce", tag: "Dambulla hub", line: "Vegetables and fruit from the economic centres, next-day delivery" },
  { img: "cement", name: "Building supplies", tag: "Distributor", line: "Cement, steel and roofing from licensed distributors, site delivery" },
];

const OFFERS = [
  { name: "Lanka Agro Mills", tag: "Best price", price: 4200, eta: "48h" },
  { name: "Colombo Wholesalers", tag: "Best value", price: 4450, eta: "36h" },
  { name: "Island Logistics", tag: "Fastest", price: 4620, eta: "24h" },
];

type Line = { t: string; kind?: "dim" | "ok" | "hi" | "row" };
const MODES = ["COMPARE", "ORDER", "TRACK"] as const;
type Mode = (typeof MODES)[number];
const script = (mode: Mode, q: string): Line[] => {
  const item = q.trim() || "Samba rice · 25 kg";
  if (mode === "ORDER")
    return [
      { t: `> cart: ${item} × 40, white sugar × 200 kg`, kind: "dim" },
      { t: "> splitting across verified suppliers…", kind: "dim" },
      { t: "Lanka Agro Mills ........ 40 bags   Rs 168,000", kind: "row" },
      { t: "Ceylon Sugar Importers .. 200 kg    Rs  44,400", kind: "row" },
      { t: "✓ one cart · two suppliers · one invoice", kind: "ok" },
      { t: "PO #2026-0841 raised — Rs 212,400", kind: "hi" },
    ];
  if (mode === "TRACK")
    return [
      { t: "> track PO #2026-0841", kind: "dim" },
      { t: "✓ packed       Polonnaruwa mill   Tue 09:12", kind: "ok" },
      { t: "✓ dispatched   Colombo 11 hub     Tue 16:40", kind: "ok" },
      { t: "● in transit   A1 → Kandy         Wed 07:05", kind: "hi" },
      { t: "○ delivered    Kandy · Peradeniya Rd  ETA Thu", kind: "dim" },
    ];
  return [
    { t: `> search "${item}"`, kind: "dim" },
    { t: "> 214 verified suppliers · 9 in stock · 3 live offers", kind: "dim" },
    ...OFFERS.map((o) => ({ t: `${o.name.padEnd(22, ".")} Rs ${o.price.toLocaleString("en-US")}  ${o.eta}  ${o.tag}`, kind: "row" as const })),
    { t: "benchmark Rs 4,390 · best offer is 4.3% under", kind: "hi" },
  ];
};

const STORY = [
  { title: "The buyer asks", status: "waiting" },
  { title: "VYRO checks every supplier", status: "working" },
  { title: "One cart, many suppliers", status: "thinking" },
  { title: "Orders dispatched", status: "working" },
  { title: "Prices keep getting better", status: "done" },
];

const SCENES = [
  { key: "SOURCE", title: "Source.", sub: "Every verified mill, importer and distributor, in one search." },
  { key: "COMPARE", title: "Compare.", sub: "Live LKR prices against a benchmark that updates as the market moves." },
  { key: "DELIVER", title: "Deliver.", sub: "One order, tracked from the mill door to yours." },
];

/* ── page ─────────────────────────────────────────────────────────────── */

export default function VyroLanding({ project: p, prev, next }: Props) {
  const root = useRef<HTMLDivElement>(null);
  useLandingBoot(root);

  useGSAP(
    () => {
      if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
      // the device tips up out of the heat as you scroll to it
      gsap.fromTo(
        ".vy-device",
        { rotateX: 28, scale: 0.86, y: 60, transformPerspective: 1500, transformOrigin: "50% 0%" },
        { rotateX: 0, scale: 1, y: 0, ease: "none", scrollTrigger: { trigger: ".vy-device", start: "top 100%", end: "top 25%", scrub: 0.6 } },
      );
      gsap.to(".vy-hero-head", { yPercent: -30, autoAlpha: 0, ease: "none", scrollTrigger: { trigger: ".vy-hero", start: "top top", end: "40% top", scrub: true } });
      gsap.fromTo(".vy-cta-img", { scale: 1.3 }, { scale: 1, ease: "none", scrollTrigger: { trigger: ".vy-cta", start: "top bottom", end: "bottom top", scrub: true } });
      gsap.fromTo(".vy-proof-img img", { scale: 1.25, yPercent: -6 }, { scale: 1.05, yPercent: 6, ease: "none", scrollTrigger: { trigger: ".vy-proof-img", start: "top bottom", end: "bottom top", scrub: true } });
      gsap.fromTo(".vy-foot-mark", { yPercent: 70 }, { yPercent: 0, ease: "none", scrollTrigger: { trigger: ".vy-foot", start: "top bottom", end: "bottom bottom", scrub: true } });

      // the commodity marquee runs faster with the scroll, and backwards when you scroll up
      const tl = gsap.to(".vy-marquee-track", { xPercent: -50, duration: 46, ease: "none", repeat: -1 });
      let boost = 0;
      ScrollTrigger.create({ onUpdate: (self) => void (boost = gsap.utils.clamp(-7, 7, self.getVelocity() / 220)) });
      const tick = () => {
        boost *= 0.93;
        tl.timeScale(1 + boost);
      };
      gsap.ticker.add(tick);
      return () => gsap.ticker.remove(tick);
    },
    { scope: root },
  );

  return (
    <div ref={root} className={`vy ${mono.variable}`}>
      <ScrollProgress color="linear-gradient(90deg, #f2d94a, #ff6a1f, #2f6cc0)" />
      <nav className="vy-nav" aria-label="VYRO">
        <a href="#top" className="vy-logo">
          <svg viewBox="0 0 28 20" width="26" height="18" aria-hidden>
            <path d="M1 18 9 4l6 9 4-6 8 11" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinejoin="round" strokeLinecap="round" />
          </svg>
          VYRO
        </a>
        <div className="vy-navlinks">
          <a href="#platform">Platform</a>
          <a href="#aisles">Aisles</a>
          <a href="#how">How it works</a>
          <a href="#build">The build</a>
        </div>
        <div className="vy-navend">
          <Link href="/projects" className="vy-navlink">
            All work
          </Link>
          <a href={p.link} target="_blank" rel="noreferrer" className="vy-btn" data-magnetic>
            Open VYRO
          </a>
        </div>
      </nav>

      {/* hero */}
      <header id="top" className="vy-hero">
        <Heat />
        <div className="vy-shell vy-hero-head">
          <div>
            <p className="vy-eyebrow" data-reveal>
              <i /> B2B wholesale marketplace · Sri Lanka
            </p>
            <h1 className="vy-pixel vy-h1" data-scramble={GLYPHS} data-when="load">
              <span data-line className="block">
                Straight
              </span>
              <span data-line className="block">
                to the source.
              </span>
            </h1>
          </div>
          <p className="vy-hero-lede" data-reveal>
            Buyers source direct from verified mills, importers and distributors — with real-time LKR prices, one cart across every supplier, and delivery
            tracked to the door.
          </p>
        </div>
        <div id="platform" className="vy-shell scroll-mt-24">
          <Device />
        </div>
      </header>

      {/* marquee */}
      <section className="vy-marquee" aria-label="What buyers source">
        <div className="vy-marquee-track">
          {[0, 1].map((k) => (
            <div key={k} className="vy-marquee-row" aria-hidden={k === 1}>
              {COMMODITIES.map((c) => (
                <span key={c}>
                  <i /> {c}
                </span>
              ))}
            </div>
          ))}
        </div>
      </section>

      {/* aisles */}
      <section id="aisles" className="vy-sec vy-grid scroll-mt-16">
        <div className="vy-shell">
          <p className="vy-eyebrow" data-reveal>
            <i /> Aisles
          </p>
          <Aisles link={p.link!} />
        </div>
      </section>

      {/* story */}
      <section id="how" className="vy-grid scroll-mt-16">
        <Story />
      </section>

      {/* source / compare / deliver */}
      <section className="vy-scenes-wrap">
        <Scenes />
      </section>

      {/* the build, told like a customer story */}
      <section id="build" className="vy-sec vy-grid scroll-mt-16">
        <div className="vy-shell vy-proof">
          <div className="vy-proof-img" data-clip>
            <Image src="/projects/vyro/warehouse.webp" alt="Warehouse aisles stacked with wholesale stock" fill sizes="(min-width: 900px) 40vw, 100vw" />
            <span className="vy-proof-tag">Built by Thufail Ahamed · SynapX</span>
          </div>
          <div className="vy-proof-body">
            <p className="vy-eyebrow" data-reveal>
              <i /> The build
            </p>
            <h2 className="vy-pixel vy-h2" data-scramble={GLYPHS}>
              Wholesale, with the middlemen taken out.
            </h2>
            <blockquote className="vy-quote" data-reveal>
              “Wholesale buyers rarely reach the mill or the importer, and every hop adds cost. VYRO puts verified suppliers, live prices and one cart in front
              of them — so the shortest route is also the easiest one.”
            </blockquote>
            <p className="vy-cite" data-reveal>
              <b>Thufail Ahamed</b> — {p.role}, {p.year}
            </p>
            <div className="vy-results" data-reveal data-scramble="0123456789→N">
              {p.metrics?.map((m) => (
                <div key={m.label}>
                  <span className="vy-pixel vy-result" data-line>
                    {m.value}
                  </span>
                  <span className="vy-mono-s">{m.label}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* challenges */}
      <section className="vy-sec vy-sec-top0 vy-grid">
        <div className="vy-shell">
          <p className="vy-eyebrow" data-reveal>
            <i /> Problems it solves
          </p>
          <div className="vy-challenges">
            {p.challenges?.map((c, i) => (
              <article key={c.title} className="vy-chal" data-reveal data-glow>
                <span className="vy-mono-s">0{i + 1}</span>
                <h3>{c.title}</h3>
                <p className="vy-dim">{c.problem}</p>
                <p className="vy-chal-move">
                  <span className="vy-mono-s vy-orange">→ VYRO</span>
                  {c.move}
                </p>
              </article>
            ))}
          </div>
        </div>
      </section>

      {/* cta */}
      <section className="vy-cta">
        <Image src="/projects/vyro/truck.webp" alt="" fill sizes="100vw" className="vy-cta-img" />
        <div className="vy-shell vy-cta-inner">
          <p className="vy-eyebrow" data-reveal>
            <i /> B2B wholesale, live
          </p>
          <h2 className="vy-pixel vy-h2" data-scramble={GLYPHS}>
            <span data-line className="block">
              See what VYRO would
            </span>
            <span data-line className="block">
              source for your business.
            </span>
          </h2>
          <p className="vy-hero-lede vy-cta-lede" data-reveal>
            Rice, sugar, tea, cement — search the catalog and compare live offers from verified suppliers.
          </p>
          <form
            className="vy-cta-form"
            data-reveal
            onSubmit={(e) => {
              e.preventDefault();
              window.open(p.link, "_blank", "noreferrer");
            }}
          >
            <input aria-label="What do you buy?" placeholder="What do you buy? e.g. samba rice" />
            <button type="submit" className="vy-btn" data-magnetic>
              Show me
            </button>
          </form>
        </div>
      </section>

      {/* built on */}
      <section className="vy-sec vy-grid">
        <div className="vy-shell">
          <p className="vy-eyebrow" data-reveal>
            <i /> Built on
          </p>
          <div className="vy-badges">
            {[
              ["Cloudflare Pages", "Edge-deployed storefront — fast in Colombo, fast in Jaffna."],
              ["Real-time pricing", "LKR benchmarks recalculated as offers change, never a stale list."],
              ["Verified suppliers", "Mills, importers and distributors checked before they can list."],
              ["Delivery tracking", "Every order tracked from dispatch to the buyer's door."],
            ].map(([t, b]) => (
              <article key={t} className="vy-badge" data-reveal data-glow data-tilt="8">
                <span className="vy-badge-ico" aria-hidden>
                  <i />
                </span>
                <h3>{t}</h3>
                <p className="vy-dim">{b}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <footer className="vy-foot vy-grid">
        <div className="vy-shell">
          <div className="vy-foot-grid">
            <div>
              <a href="#top" className="vy-logo vy-logo-lg">
                VYRO
              </a>
              <p className="vy-dim vy-foot-blurb">{p.tagline}</p>
            </div>
            {[
              ["Project", [p.category, p.role, `${p.year}`]],
              ["Stack", p.stack],
              ["Status", p.facts?.map((f) => `${f.label}: ${f.value}`) ?? []],
            ].map(([h, items]) => (
              <div key={h as string}>
                <p className="vy-mono-s vy-foot-h">{h as string}</p>
                <ul>
                  {(items as string[]).map((x) => (
                    <li key={x}>{x}</li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
          <div className="vy-foot-nav">
            <Link href={`/projects/${prev.slug}`}>
              <span className="vy-mono-s">← Previous</span>
              {prev.title}
            </Link>
            <Link href="/projects" className="vy-btn vy-btn-ghost">
              All work
            </Link>
            <Link href={`/projects/${next.slug}`} className="vy-foot-next">
              <span className="vy-mono-s">Next →</span>
              {next.title}
            </Link>
          </div>
          <p className="vy-mono-s vy-foot-copy">© {p.year} VYRO · Designed and built by Thufail Ahamed</p>
        </div>
        <div className="vy-foot-markwrap" aria-hidden>
          <p className="vy-pixel vy-foot-mark">VYRO</p>
        </div>
      </footer>
    </div>
  );
}

/* ── the heat gradient behind the hero ────────────────────────────────── */

const HEAT = ["#f2d94a", "#ef8a24", "#d4471f", "#9c2f3a", "#5a3a8a", "#2f6cc0", "#6fb6e0"];

function Heat() {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current!;
    const g = c.getContext("2d")!;
    const W = 96;
    const H = 64;
    c.width = W;
    c.height = H;
    const cols = 16;
    const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
    let raf = 0;
    let visible = true;
    const io = new IntersectionObserver(([e]) => (visible = e.isIntersecting));
    io.observe(c);
    // the pointer pushes the bands in the columns nearest it, then lets them settle
    const m = { x: 0.5, y: 0.5, tx: 0.5, ty: 0.5, a: 0, ta: 0 };
    const move = (e: PointerEvent) => {
      const r = c.getBoundingClientRect();
      m.tx = (e.clientX - r.left) / r.width;
      m.ty = (e.clientY - r.top) / r.height;
      m.ta = m.ty > -0.1 && m.ty < 1.1 ? 1 : 0;
    };
    addEventListener("pointermove", move, { passive: true });
    const draw = (t: number) => {
      raf = requestAnimationFrame(draw);
      if (!visible) return;
      const s = t / 1000;
      m.x += (m.tx - m.x) * 0.06;
      m.y += (m.ty - m.y) * 0.06;
      m.a += (m.ta - m.a) * 0.04;
      for (let i = 0; i < cols; i++) {
        const x = (i / cols) * W;
        const near = Math.exp(-(((i + 0.5) / cols - m.x) ** 2) / 0.012) * m.a;
        // each column of "glass" shifts the bands a little, and breathes
        const off =
          Math.sin(s * 0.5 + i * 0.9) * 0.07 + Math.sin(s * 0.23 + i * 2.1) * 0.05 - 0.12 + ((i % 3) - 1) * 0.03 + near * (m.y - 0.35) * 0.45;
        const grad = g.createLinearGradient(0, H * off, 0, H * (1.15 + off));
        HEAT.forEach((col, k) => grad.addColorStop(k / (HEAT.length - 1), col));
        g.fillStyle = grad;
        g.fillRect(x, 0, W / cols + 1, H);
        // a soft highlight down the edge of each column
        const edge = g.createLinearGradient(x, 0, x + W / cols, 0);
        edge.addColorStop(0, "rgba(255,255,255,0.18)");
        edge.addColorStop(0.25, "rgba(255,255,255,0)");
        edge.addColorStop(0.8, "rgba(0,0,0,0)");
        edge.addColorStop(1, "rgba(0,0,0,0.22)");
        g.fillStyle = edge;
        g.fillRect(x, 0, W / cols + 1, H);
      }
      if (reduce) cancelAnimationFrame(raf);
    };
    raf = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(raf);
      io.disconnect();
      removeEventListener("pointermove", move);
    };
  }, []);
  return (
    <div aria-hidden className="vy-heat">
      <canvas ref={ref} />
    </div>
  );
}

/* ── the hero device: a terminal on the left, a big button on the right ─ */

function Device() {
  const [mode, setMode] = useState<Mode>("COMPARE");
  const [query, setQuery] = useState("");
  const [lines, setLines] = useState<Line[]>([]);
  const [shown, setShown] = useState(0);
  const [pressed, setPressed] = useState(false);
  const prompt = "try sourcing a product";
  const [typed, setTyped] = useState(0);

  useEffect(() => {
    const id = setInterval(() => setTyped((n) => (n >= prompt.length ? (clearInterval(id), n) : n + 1)), 55);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    if (!lines.length) return;
    const id = setInterval(() => setShown((n) => (n >= lines.length ? (clearInterval(id), n) : n + 1)), 360);
    return () => clearInterval(id);
  }, [lines]);

  const run = (m: Mode = mode) => {
    setShown(0);
    setLines(script(m, query));
    setPressed(true);
    setTimeout(() => setPressed(false), 220);
  };

  return (
    <div className="vy-device">
      <div className="vy-screen">
        <p className="vy-screen-prompt">
          {prompt.slice(0, typed)}
          {!lines.length && <span className="vy-caret">_</span>}
        </p>
        <div className="vy-screen-out" aria-live="polite">
          {lines.slice(0, shown).map((l, i) => (
            <p key={`${l.t}-${i}`} className={`vy-ln vy-ln-${l.kind ?? "row"}`}>
              {l.t}
            </p>
          ))}
          {lines.length > 0 && shown < lines.length && <span className="vy-caret">_</span>}
        </div>
        <p className="vy-screen-hint">{lines.length ? "Try another mode on the right, or type what you buy." : "Type what you buy, then press the button."}</p>
        <form
          className="vy-screen-form"
          onSubmit={(e) => {
            e.preventDefault();
            run();
          }}
        >
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Samba rice · 25 kg" aria-label="Product to source" />
          <button type="submit">Search</button>
        </form>
        <p className="vy-screen-note">A simulated session with sample suppliers and prices.</p>
      </div>
      <div className="vy-panel">
        <span className="vy-screw vy-screw-a" />
        <span className="vy-screw vy-screw-b" />
        <span className="vy-grille" aria-hidden>
          {Array.from({ length: 14 }, (_, i) => (
            <i key={i} />
          ))}
        </span>
        <span className="vy-panel-brand">VYRO</span>
        <button type="button" className={`vy-knob ${pressed ? "is-pressed" : ""}`} onClick={() => run()} aria-label={`Run ${mode.toLowerCase()}`}>
          <span className="vy-knob-ring">
            <span className="vy-knob-face">
              <i />
              {mode === "COMPARE" ? "SOURCE" : mode}
            </span>
          </span>
        </button>
        <div className="vy-modes">
          {MODES.map((m) => (
            <button
              key={m}
              type="button"
              className={m === mode ? "is-on" : ""}
              onClick={() => {
                setMode(m);
                run(m);
              }}
            >
              <i /> {m}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ── aisles: an image deck ────────────────────────────────────────────── */

function Aisles({ link }: { link: string }) {
  const [on, setOn] = useState(0);
  const [held, setHeld] = useState(false);
  const go = (d: number) => setOn((k) => (k + d + AISLES.length) % AISLES.length);
  useEffect(() => {
    if (held) return;
    const id = setTimeout(() => setOn((k) => (k + 1) % AISLES.length), 4500);
    return () => clearTimeout(id);
  }, [on, held]);
  return (
    <>
      <div className="vy-aisles-head">
        <div>
          <h2 className="vy-pixel vy-h2" data-scramble={GLYPHS}>
            Built for every aisle.
          </h2>
          <p className="vy-dim vy-sub" data-reveal>
            Swap phone calls and price lists for live offers from the people who actually make the stock.
          </p>
        </div>
        <div className="vy-arrows" data-reveal>
          <button type="button" onClick={() => go(-1)} aria-label="Previous aisle">
            ←
          </button>
          <button type="button" onClick={() => go(1)} aria-label="Next aisle">
            →
          </button>
        </div>
      </div>
      <div className="vy-deck" data-reveal onMouseEnter={() => setHeld(true)} onMouseLeave={() => setHeld(false)}>
        <div className="vy-deck-card">
          <p className="vy-deck-text">
            {AISLES[on].name}. <span>{AISLES[on].line}.</span>
          </p>
          <div className="vy-deck-foot">
            <span className="vy-mono-s">
              {String(on + 1).padStart(2, "0")} / {String(AISLES.length).padStart(2, "0")} · {AISLES[on].tag}
            </span>
            <a href={link} target="_blank" rel="noreferrer" className="vy-btn" data-magnetic>
              Start sourcing
            </a>
          </div>
        </div>
        <div className="vy-rail">
          {AISLES.map((a, i) => (
            <button key={a.img} type="button" className={`vy-slice ${i === on ? "is-on" : ""}`} onClick={() => setOn(i)} aria-label={a.name}>
              <Image src={`/projects/vyro/${a.img}.webp`} alt="" fill sizes="(min-width: 900px) 40vw, 80vw" />
              <span className="vy-slice-label">
                <em className="vy-mono-s vy-orange">{a.tag}</em>
                {a.name}
              </span>
              {i === on && <i key={`${on}-${held}`} className={`vy-slice-bar ${held ? "is-held" : ""}`} />}
            </button>
          ))}
        </div>
      </div>
    </>
  );
}

/* ── sticky story: steps on the left, the conversation on the right ───── */

function Story() {
  const [ref, pr] = useSectionProgress<HTMLDivElement>();
  const n = STORY.length;
  const at = Math.min(n - 0.001, pr * n * 1.05);
  const step = Math.floor(at);
  const within = at - step;

  return (
    <div ref={ref} className="vy-story" style={{ height: `${n * 75 + 60}vh` }}>
      <div className="vy-story-stick">
        <div className="vy-shell vy-story-grid">
          <div className="vy-story-left">
            <div>
              <h2 className="vy-pixel vy-h2" data-scramble={GLYPHS}>
                <span data-line className="block">
                  Sourcing that keeps
                </span>
                <span data-line className="block">
                  getting cheaper.
                </span>
              </h2>
              <p className="vy-dim vy-sub">Search, compare, order and track — inside one conversation with the market.</p>
            </div>
            <ol className="vy-steps">
              {STORY.map((s, i) => (
                <li key={s.title} className={i === step ? "is-on" : i < step ? "is-past" : ""}>
                  <span className="vy-mono-s">{String(i + 1).padStart(2, "0")}</span>
                  {s.title}
                  {i === step && <i className="vy-steps-bar" style={{ transform: `scaleX(${within})` }} />}
                </li>
              ))}
            </ol>
          </div>
          <div className="vy-chat">
            <div className="vy-chat-head">
              <span key={STORY[step].status} className="vy-chat-status">
                {STORY[step].status}
              </span>
              <span className="vy-mono-s">
                BUYER <b>Perera Stores · Kandy</b>
              </span>
            </div>
            <div className="vy-chat-body">
              <Bubble show me>
                Need 40 bags of samba rice and 200 kg of sugar in Kandy by Friday.
              </Bubble>
              <Log show={step >= 1} lines={["Checking suppliers ⌄", "214 verified · 9 in stock", "Benchmarking LKR prices"]} />
              <Bubble show={step >= 1}>Three mills can do the rice and two importers have sugar. Best combined price is Rs 212,400 — 6% under this week&apos;s benchmark.</Bubble>
              <Bubble show={step >= 2} me>
                Do it. One invoice please.
              </Bubble>
              <Log show={step >= 2} lines={["Cart split · 2 suppliers", "1 invoice · net 14 days"]} />
              <Bubble show={step >= 3}>Both orders are on the way — rice arrives Thursday, sugar Friday morning. Tracking is live.</Bubble>
              <Log show={step >= 3} lines={["PO #2026-0841 dispatched", "Colombo 11 → Kandy · ETA Thu"]} />
              <Log show={step >= 4} good lines={["Outcome logged", "Rs 13,600 saved vs benchmark", "Supplier ratings updated"]} />
            </div>
            <div className="vy-chat-input">
              <span>Message</span>
              <span aria-hidden>↑</span>
            </div>
            <div className="vy-chat-foot">
              <span className="vy-mono-s">VYRO</span>
              <span className="vy-mono-s">
                <i className="vy-led" /> LIVE
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function Bubble({ show, me, children }: { show: boolean; me?: boolean; children: React.ReactNode }) {
  return <p className={`vy-bubble ${me ? "is-me" : ""} ${show ? "is-in" : ""}`}>{children}</p>;
}
function Log({ show, lines, good }: { show: boolean; lines: string[]; good?: boolean }) {
  return (
    <div className={`vy-log ${show ? "is-in" : ""} ${good ? "is-good" : ""}`}>
      {lines.map((l, i) => (
        <p key={l} className={i === 0 ? "is-head" : ""}>
          {l}
        </p>
      ))}
    </div>
  );
}

/* ── pinned scenes: source / compare / deliver ────────────────────────── */

const SW = 1200;
const SH = 600;
const NODE = { x: 860, y: 340 };
const BUNDLES = [
  { label: "Mills", y: 150, x: 90 },
  { label: "Importers", y: 330, x: 50 },
  { label: "Distributors", y: 500, x: 110 },
];

function Scenes() {
  const [ref, pr] = useSectionProgress<HTMLDivElement>();
  const scene = Math.min(2, Math.floor(pr * 3));

  const jump = (i: number) => {
    const el = ref.current;
    if (!el) return;
    const top = el.getBoundingClientRect().top + scrollY;
    const span = el.offsetHeight - innerHeight;
    const y = top + span * ((i + 0.35) / 3);
    if (lenis) lenis.scrollTo(y, { duration: 1.2 });
    else scrollTo({ top: y, behavior: "smooth" });
  };

  return (
    <div ref={ref} className="vy-scenes" style={{ height: "330vh" }}>
      <div className="vy-scenes-stick">
        {SCENES.map((s, i) => (
          <div key={s.key} className={`vy-scene-text ${i === scene ? "is-on" : ""} ${i === 0 ? "is-top" : ""}`}>
            <h2 className="vy-scene-h">{s.title}</h2>
            <p className="vy-dim">{s.sub}</p>
          </div>
        ))}
        <svg className="vy-scene-svg" viewBox={`0 0 ${SW} ${SH}`} preserveAspectRatio="xMidYMid meet" aria-hidden>
          <defs>
            <linearGradient id="vy-curve" x1="0" x2="1">
              <stop offset="0" stopColor="#ffffff" stopOpacity="0.2" />
              <stop offset="0.5" stopColor="#ffb08a" />
              <stop offset="0.8" stopColor="#9fd0ff" />
              <stop offset="1" stopColor="#ffffff" />
            </linearGradient>
            <radialGradient id="vy-glow">
              <stop offset="0" stopColor="#ff7a2f" stopOpacity="0.25" />
              <stop offset="1" stopColor="#ff7a2f" stopOpacity="0" />
            </radialGradient>
          </defs>

          {/* SOURCE: three bundles of suppliers converge on one cart */}
          <g className={`vy-sc ${scene === 0 ? "is-on" : ""}`}>
            {BUNDLES.map((b, bi) => (
              <g key={b.label}>
                <text x={b.x - 10} y={b.y - 70} className="vy-svg-label">
                  {b.label}
                </text>
                {Array.from({ length: 12 }, (_, k) => {
                  const sy = b.y - 50 + k * 9;
                  const sx = b.x + (k % 4) * 3;
                  const mid = 470 + bi * 10;
                  const d = `M ${sx} ${sy} C ${mid - 120} ${sy}, ${mid - 40} ${b.y}, ${mid} ${b.y} S ${NODE.x - 120} ${NODE.y}, ${NODE.x} ${NODE.y}`;
                  return (
                    <g key={k}>
                      <circle cx={sx} cy={sy} r="1.6" fill="#fff" opacity={0.8} />
                      <path d={d} pathLength={1} className="vy-strand" style={{ strokeDashoffset: scene === 0 ? 0 : 1, opacity: 0.12 + (k % 5) * 0.08, transitionDelay: scene === 0 ? `${bi * 0.15 + k * 0.03}s` : "0s" }} />
                      {scene === 0 && k % 3 === 0 && (
                        <circle r="2.4" className="vy-spark">
                          <animateMotion dur={`${2.2 + (k % 4) * 0.45}s`} begin={`${1.4 + bi * 0.35 + k * 0.07}s`} repeatCount="indefinite" path={d} />
                        </circle>
                      )}
                    </g>
                  );
                })}
              </g>
            ))}
            <rect x={NODE.x - 7} y={NODE.y - 7} width="14" height="14" rx="3" fill="#fff" />
            <text x={NODE.x + 26} y={NODE.y + 6} className="vy-svg-node">
              Your cart
            </text>
          </g>

          {/* COMPARE: margin kept, rising after the switch */}
          <g className={`vy-sc ${scene === 1 ? "is-on" : ""}`}>
            <ellipse cx="900" cy="300" rx="360" ry="260" fill="url(#vy-glow)" />
            <line x1="110" y1="470" x2="1060" y2="470" stroke="#fff" strokeOpacity="0.35" />
            <text x="200" y="450" className="vy-svg-label">
              Margin kept per order
            </text>
            <line x1="480" y1="470" x2="480" y2="484" stroke="#fff" strokeOpacity="0.5" />
            <text x="480" y="506" textAnchor="middle" className="vy-svg-label">
              Switched to VYRO
            </text>
            <path d="M 480 470 C 700 466, 900 420, 1060 200" pathLength={1} className="vy-curve" style={{ strokeDashoffset: scene === 1 ? 0 : 1 }} />
            {scene === 1 && (
              <circle r="6" className="vy-spark vy-spark-hot">
                <animateMotion dur="2.8s" begin="1.9s" repeatCount="indefinite" path="M 480 470 C 700 466, 900 420, 1060 200" />
              </circle>
            )}
            <rect x="1053" y="193" width="14" height="14" rx="3" fill="#fff" style={{ opacity: scene === 1 ? 1 : 0, transitionDelay: scene === 1 ? "1.5s" : "0s" }} className="vy-fade" />
            <text x="1060" y="176" textAnchor="middle" className="vy-svg-node">
              Improved
            </text>
            <line x1="1090" y1="200" x2="1090" y2="470" stroke="#fff" strokeOpacity="0.4" />
            <text x="1100" y="340" className="vy-svg-label">
              Saved
            </text>
            <text x="1060" y="500" textAnchor="end" className="vy-svg-label">
              Today
            </text>
          </g>

          {/* DELIVER: one route, tracked */}
          <g className={`vy-sc ${scene === 2 ? "is-on" : ""}`}>
            <path id="vy-route" d="M 140 420 C 340 420, 380 300, 600 300 S 860 420, 1060 380" className="vy-route" />
            <path d="M 140 420 C 340 420, 380 300, 600 300 S 860 420, 1060 380" pathLength={1} className="vy-route-done" style={{ strokeDashoffset: scene === 2 ? 0 : 1 }} />
            {scene === 2 && (
              <g className="vy-truck">
                <circle r="16" className="vy-truck-halo" />
                <rect x="-9" y="-6" width="18" height="12" rx="3" fill="#ff6a1f" />
                <animateMotion dur="5.5s" begin="0.6s" repeatCount="indefinite" rotate="auto" path="M 140 420 C 340 420, 380 300, 600 300 S 860 420, 1060 380" />
              </g>
            )}
            {[
              { x: 140, y: 420, t: "Packed · Polonnaruwa mill" },
              { x: 600, y: 300, t: "Dispatched · Colombo 11" },
              { x: 1060, y: 380, t: "Delivered · Kandy" },
            ].map((m, i) => (
              <g key={m.t}>
                <rect x={m.x - 6} y={m.y - 6} width="12" height="12" rx="3" fill={scene === 2 ? "#fff" : "#444"} className="vy-fade" style={{ transitionDelay: scene === 2 ? `${i * 0.8}s` : "0s" }} />
                <text x={m.x} y={m.y + (i === 1 ? -26 : 38)} textAnchor="middle" className="vy-svg-label">
                  {m.t}
                </text>
              </g>
            ))}
          </g>
        </svg>
        <div className="vy-seg">
          <div className="vy-seg-tabs">
            {SCENES.map((s, i) => (
              <button key={s.key} type="button" className={i === scene ? "is-on" : ""} onClick={() => jump(i)}>
                {s.key}
              </button>
            ))}
          </div>
          <a href="#build" className="vy-seg-cta">
            <i /> See the build ↗
          </a>
        </div>
      </div>
    </div>
  );
}
