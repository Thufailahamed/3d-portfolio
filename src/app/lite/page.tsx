import type { Metadata, Viewport } from "next";
import { Archivo, IBM_Plex_Mono } from "next/font/google";
import Image from "next/image";
import Link from "next/link";
import CopyEmail from "@/components/CopyEmail";
import FullExperienceLink from "@/components/FullExperienceLink";
import { Arrow, EmbedCluster, LossCurve, Mark, Mast, NeuralNet, ServerHall } from "@/components/paper/art";
import LocalTime from "@/components/paper/LocalTime";
import Missions from "@/components/paper/Missions";
import PaperHeader from "@/components/paper/PaperHeader";
import PaperMotion from "@/components/paper/PaperMotion";
import SiteFooter from "@/components/SiteFooter";
import { chapters, crates, exchange, hero, marquee, process, stats, story } from "@/content/paper";
import { about, board, contact, person, projects } from "@/content/site";
import "./paper.css";

const archivo = Archivo({ variable: "--font-archivo", subsets: ["latin"], axes: ["wdth"] });
const plex = IBM_Plex_Mono({ variable: "--font-plex", subsets: ["latin"], weight: ["400", "500", "700"] });

export const metadata: Metadata = {
  title: "Lite — Human × Machine",
  description: `${person.intro} A fast, zero-WebGL edition of the portfolio.`,
  alternates: { canonical: "/lite" },
};

export const viewport: Viewport = { themeColor: "#f1eee6" };

const pad = (n: number) => String(n).padStart(2, "0");
const host = (url: string) => url.replace(/^https?:\/\//, "").replace(/\/$/, "");
const bySlug = new Map(projects.map((p) => [p.slug, p]));
const SHOP_TONES = ["ink", "violet", "porcelain", "indigo", "ink", "violet"];

/** Convert lon/lat to SVG viewBox (1000 × 500 equirectangular) coordinates. */
function mapXY(lon: number, lat: number) {
  const x = ((lon + 180) / 360) * 1000;
  const y = ((90 - lat) / 180) * 500;
  return { x: Math.round(x * 10) / 10, y: Math.round(y * 10) / 10 };
}

/** The loader's training curve: loss falling fast, then settling. */
const LOADER_CURVE = (() => {
  const pts: string[] = [];
  for (let x = 0; x <= 1000; x += 8) {
    const y = 250 - 200 * Math.exp(-x / 220) + 9 * Math.exp(-x / 500) * Math.sin(x / 13);
    pts.push(`${x} ${Math.round(y * 10) / 10}`);
  }
  return `M${pts.join(" L")}`;
})();
const BOOT = ["Loading weights", "Warming the edge", "Grounding in records", "Calibrating human × machine"];

/** A ticker band: the stack in big type, sped up and reversed by the way you scroll. */
function Marquee({ words, tone, reverse = false }: { words: string[]; tone: "paper" | "night"; reverse?: boolean }) {
  const row = words.map((w, i) => (
    <span key={i} className={`p-marquee__item ${i % 2 ? "is-outline" : ""}`}>
      {w}
      <i className="p-marquee__dot" />
    </span>
  ));
  return (
    <div className={`p-marquee p-marquee--${tone}`} data-marquee data-reverse={reverse ? "" : undefined} data-tone={tone} aria-hidden>
      <div className="p-marquee__track" data-marquee-track>
        <div className="p-marquee__row">{row}</div>
        <div className="p-marquee__row">{row}</div>
      </div>
    </div>
  );
}

/** The orange thread: a smooth line through normalised points, drawn on load or as its section scrolls by. */
function Thread({ points, mode = "scroll", className = "" }: { points: [number, number][]; mode?: "scroll" | "load"; className?: string }) {
  return (
    <svg className={`p-thread ${className}`} data-thread={mode} data-points={JSON.stringify(points)} aria-hidden>
      <path />
      <circle r="4" />
      <circle className="p-thread__ring" r="9" />
      <circle r="3.5" />
    </svg>
  );
}

/** Waypoints for the page rope, as positions inside their section. PaperMotion threads one line through them. */
function RopeAt({ points }: { points: [string, string][] }) {
  return (
    <>
      {points.map(([left, top], i) => (
        <i key={i} className="p-rope-at" data-rope-at style={{ left, top }} />
      ))}
    </>
  );
}

/** A caption whose lines rise out of a mask; the last line takes the accent. */
function Cap({ side, cap, words, em = true }: { side: "front" | "back" | "center"; cap: string; words: string[]; em?: boolean }) {
  return (
    <p className={`p-cap p-cap--${side}`} data-cap={cap}>
      {words.map((w, i) => (
        <span key={i} className="p-cap__line">
          <span>{em && i === words.length - 1 ? <em>{w}</em> : w}</span>
        </span>
      ))}
    </p>
  );
}

/** What the machine half is running: the legal copilot's pipeline, as it works in production. */
const TERMINAL = [
  { t: "$ copilot ingest ./filings", c: "cmd" },
  { t: "  ocr → bates → redact → records", c: "" },
  { t: "$ copilot embed --store pgvector", c: "cmd" },
  { t: "  indexed against the practice", c: "" },
  { t: '$ copilot ask "summarise matter"', c: "cmd" },
  { t: "  retrieving · grounding · citing", c: "dim" },
  { t: "✓ answer cites the firm's own files", c: "ok" },
].map((l, i, all) => ({
  ...l,
  // each line starts typing once the previous one has finished
  delay: all.slice(0, i).reduce((s, p) => s + p.t.length * 0.028 + 0.22, 0.9),
}));

/** The paper edition: the whole site without WebGL, told as two sides of one street. */
export default function LitePage() {
  const home = about.places[0];
  const homePt = mapXY(home.lon, home.lat);
  // the copilot the terminal is driving
  const lead2 = bySlug.get("legal-workspace") ?? projects[0];

  return (
    <PaperMotion className={`${archivo.variable} ${plex.variable}`}>
      <noscript>
        <style>{`.p-loader{display:none!important}.p-terminal__line{animation-play-state:running!important}`}</style>
      </noscript>

      {/* plays on a hard load; PaperMotion hides it before paint when navigating back in */}
      <div className="p-loader" data-loader aria-hidden>
        <div className="p-loader__half p-loader__half--front" data-loader-half="front" />
        <div className="p-loader__half p-loader__half--back" data-loader-half="back" />
        <svg className="p-loader__curve" viewBox="0 0 1000 300" preserveAspectRatio="none" data-loader-fade>
          <defs>
            <linearGradient id="p-ld" x1="0" x2="1" y1="0" y2="0">
              <stop offset="0" stopColor="#ff3b12" />
              <stop offset="0.5" stopColor="#ff5a2c" />
              <stop offset="0.5" stopColor="#ff8a63" />
              <stop offset="1" stopColor="#ff8a63" />
            </linearGradient>
          </defs>
          <path d={LOADER_CURVE} pathLength={1} data-loader-curve />
        </svg>
        <div className="p-loader__top p-mono" data-loader-fade>
          <span>
            <Mark /> Training run 001
          </span>
          <span>Human × Machine</span>
        </div>
        <p className="p-loader__count" data-loader-fade>
          <span data-count>000</span>
        </p>
        <div className="p-loader__bar" data-loader-fade>
          <i data-loader-bar />
        </div>
        <ol className="p-loader__log p-mono" data-loader-fade>
          {BOOT.map((l) => (
            <li key={l} data-log>
              <span>{l}</span>
              <b>ok</b>
            </li>
          ))}
        </ol>
        <dl className="p-loader__meta p-mono" data-loader-fade>
          <div>
            <dt>Epoch</dt>
            <dd data-epoch>00</dd>
          </div>
          <div>
            <dt>Loss</dt>
            <dd data-loss>2.400</dd>
          </div>
          <div>
            <dt>Operator</dt>
            <dd>{person.name}</dd>
          </div>
        </dl>
      </div>

      <div className="p-grain" aria-hidden />
      <div className="p-gridlines" aria-hidden>
        {Array.from({ length: 6 }, (_, i) => (
          <span key={i} />
        ))}
      </div>
      <div className="p-progress" data-progress aria-hidden />
      <svg className="p-rope" data-rope aria-hidden>
        <path />
        <circle r="4" />
        <circle className="p-rope__ring" r="10" />
        <circle r="4" />
      </svg>
      <PaperHeader />

      <nav className="p-rail" data-rail data-tone="paper" aria-label="Chapters">
        <ol>
          {chapters.map((c) => (
            <li key={c.id}>
              <a href={`#${c.id}`}>
                <span className="p-rail__label p-mono">{c.label}</span>
                <span className="p-rail__tick" />
              </a>
            </li>
          ))}
        </ol>
      </nav>

      {/* ── 00 The handshake ─────────────────────────────────────── */}
      <section className="p-hs" id="top" data-chapter data-handshake aria-labelledby="hs-title">
        <div className="p-hs__stage">
          <div className="p-hs__tone p-hs__tone--left" data-tone="paper" data-hs-left />
          <div className="p-hs__tone p-hs__tone--right" data-tone="night" />
          <canvas className="p-hs__canvas" data-hs-canvas aria-hidden />

          <div className="p-hs__thread" data-hs-thread>
            <Thread
              mode="load"
              points={[[0.07, 0], [0.16, 0.16], [0.5, 0.27], [0.8, 0.36], [0.62, 0.5], [0.26, 0.56], [0.03, 0.7], [0.1, 0.88], [0.46, 0.92]]}
            />
          </div>
          <div className="p-hs__copy" data-hs-fade>
            <p className="p-hs__kicker p-mono" data-hs-in>
              <i className="p-status" />
              {person.name} · {person.role}
            </p>
            <h1 id="hs-title" className="p-hs__title">
              <span className="sr-only">
                {person.name}, {person.role}, {person.location}.{" "}
              </span>
              {hero.title.map((l, i) => (
                <span key={l} className="p-hs__line">
                  <span data-hs-line>{i === 1 ? <em>{l}</em> : i === 3 ? <>and <em>AI.</em></> : l}</span>
                </span>
              ))}
            </h1>
          </div>

          <div className="p-hs__side" data-hs-fade>
            <p className="p-hs__intro" data-hs-in>
              {hero.intro}
            </p>
            <div className="p-hs__actions" data-hs-in>
              <a className="p-button p-button--solid" href={`mailto:${person.email}`} data-magnetic>
                <span className="p-button__fill" />
                <span>Start a project</span>
                <Arrow />
              </a>
              <a className="p-hs__link p-mono" href="#work">
                See the work ↓
              </a>
            </div>
          </div>

          <p className="p-hs__hint p-mono" data-hs-fade aria-hidden>
            <span data-hs-in>
              Scroll to shake on it
              <svg viewBox="0 0 24 24" fill="none" strokeWidth="2" aria-hidden>
                <path d="M12 4v16m0 0-6-6m6 6 6-6" />
              </svg>
            </span>
          </p>

          <div className="p-hs__after" data-hs-after aria-hidden>
            <p className="p-hs__after-title">
              {hero.after[0]} <em>{hero.after[1]}</em>
            </p>
            <p className="p-mono">{hero.afterNote}</p>
          </div>
        </div>
      </section>

      {/* ── 01 Two minds ─────────────────────────────────────────── */}
      <section className="p-split p-split--story" id="two-minds" data-chapter data-story>
        <div className="p-split__stage" data-tone="night">
          <h2 className="sr-only">Every AI product has two minds</h2>
          <div className="p-split__glow" aria-hidden />
          <div className="p-split__hero" data-hero aria-hidden>
            <NeuralNet />
          </div>
          <Cap side="center" cap="pick" words={story.pick} />
          <Cap side="center" cap="hood" words={story.hood} />

          <div className="p-split__half p-split__half--front" data-half="front" data-tone="paper">
            <Cap side="front" cap="open" words={story.open.front} />
            <Cap side="front" cap="close" words={story.close.front} />
            <p className="p-chat p-chat--human" data-chat>
              <span className="p-mono">You</span>
              {exchange.human}
            </p>
            <figure className="p-browser" data-device aria-hidden>
              <div className="p-browser__bar">
                <i />
                <i />
                <i />
                <span className="p-mono">{lead2.link ? host(lead2.link) : lead2.slug}</span>
              </div>
              <div className="p-browser__view">
                <Image src={lead2.cover} alt="" fill priority sizes="(min-width: 768px) 38vw, 1px" />
              </div>
            </figure>
          </div>

          <div className="p-split__half p-split__half--back" data-half="back" data-tone="night">
            <Cap side="back" cap="open" words={story.open.back} />
            <Cap side="back" cap="close" words={story.close.back} />
            <p className="p-chat p-chat--machine" data-chat>
              <span className="p-mono">Copilot</span>
              {exchange.machine}
            </p>
            <figure className="p-terminal" data-device aria-hidden>
              <div className="p-terminal__bar p-mono">
                <span>copilot · gemini + rag</span>
                <span className="p-terminal__live">● live</span>
              </div>
              <div className="p-terminal__body p-mono">
                {TERMINAL.map((l) => (
                  <span
                    key={l.t}
                    className={`p-terminal__line ${l.c ? `is-${l.c}` : ""}`}
                    style={{ "--n": l.t.length, "--d": `${l.delay.toFixed(2)}s` } as React.CSSProperties}
                  >
                    {l.t}
                  </span>
                ))}
                <span className="p-terminal__caret" />
              </div>
            </figure>
          </div>

          <p className="p-split__name p-mono" data-name>
            <span data-name-text>
              {person.name} · {person.role} · {person.location}
            </span>
          </p>
          <div className="p-split__banner" data-banner aria-hidden>
            <p className="p-split__banner-inner" data-banner-inner>
              <span className="p-split__banner-front">Human</span>
              <span className="p-split__hex">×</span>
              <span className="p-split__banner-back">Machine</span>
            </p>
          </div>
          <p className="p-split__hint p-mono" data-hint aria-hidden>
            <span>Scroll down</span>
            <svg viewBox="0 0 24 24" fill="none" strokeWidth="2" aria-hidden>
              <path d="M12 4v16m0 0-6-6m6 6 6-6" />
            </svg>
          </p>
        </div>
      </section>

      <Marquee words={marquee} tone="paper" />

      {/* ── 02 The street ────────────────────────────────────────── */}
      <section className="p-street p-marks" id="work" data-chapter data-street data-strip data-tone="paper" aria-labelledby="street-title">
        <div className="p-street__sky" aria-hidden>
          <span className="p-street__orb" data-depth="0.05" />
          <div className="p-street__cluster p-street__cluster--a" data-depth="0.12">
            <EmbedCluster seed={3} label="intent · billing" />
          </div>
          <div className="p-street__cluster p-street__cluster--b" data-depth="0.16">
            <EmbedCluster seed={9} label="intent · records" />
          </div>
          <div className="p-street__cluster p-street__cluster--c" data-depth="0.2">
            <EmbedCluster seed={21} label="intent · pricing" />
          </div>
          <div className="p-street__skyline" data-depth="0.3">
            <LossCurve />
          </div>
        </div>
        <div className="p-street__ground" aria-hidden />
        <p className="p-street__now">
          <span className="p-street__now-label p-mono">
            <i className="p-status" />
            Now serving
          </span>
          <b data-now-title>{projects[0].title}</b>
          <span className="p-street__now-line" data-now-line>
            {projects[0].tagline}
          </span>
        </p>
        <div className="p-street__runner p-mono" data-runner aria-hidden>
          <i />
          <i />
          <i />
          tokens
        </div>

        <header className="p-street__head">
          <p className="p-kicker p-mono">
            <b>02</b>
            <span>Inference row</span>
          </p>
          <h2 id="street-title" className="p-title" data-chars>
            Where models <em>meet people.</em>
          </h2>
          <p className="p-hint p-mono">
            <i />
            <span>Scroll sideways</span>
          </p>
        </header>
        <p className="p-street__count p-mono" aria-hidden>
          <b data-open>01</b> / {pad(projects.length)} serving
        </p>

        <div className="p-street__viewport">
          <div className="p-street__track" data-track>
            {projects.map((p, i) => (
              <div key={p.slug} className="p-street__lot">
                <Link
                  className={`p-shop p-shop--${SHOP_TONES[i % SHOP_TONES.length]}`}
                  href={`/projects/${p.slug}`}
                  data-shop
                  data-title={p.title}
                  data-tagline={p.tagline}
                  data-cursor="view"
                  aria-label={`${p.title}: ${p.category}, ${p.year}`}
                  style={{ "--glow": p.tint } as React.CSSProperties}
                >
                  <span className="p-shop__upper" aria-hidden>
                    {Array.from({ length: 6 }, (_, k) => (
                      <i key={k} style={{ animationDelay: `-${((i * 7 + k * 3) % 10) / 4}s` }} />
                    ))}
                  </span>
                  <span className="p-shop__sign">
                    <span className="p-shop__num p-mono">{pad(i + 1)}</span>
                    <span className="p-shop__name">{p.title}</span>
                    {p.link && <span className="p-shop__live p-mono">Live</span>}
                  </span>
                  <span className="p-shop__status p-mono" aria-hidden>
                    <span>serving · {p.stack[0]}</span>
                  </span>
                  <span className="p-shop__front">
                    <span className="p-shop__window">
                      <Image src={p.cover} alt="" fill sizes="(min-width: 768px) 40vh, 70vw" />
                    </span>
                    <span className="p-shop__door" aria-hidden>
                      <i />
                    </span>
                  </span>
                  <span className="p-shop__plate p-mono">
                    {p.category} · {p.year}
                  </span>
                </Link>
                {i < projects.length - 1 && (
                  <span className="p-street__lamp" aria-hidden>
                    <Mast />
                  </span>
                )}
              </div>
            ))}
            <div className="p-street__end">
              <p className="p-mono p-dim">
                {pad(projects.length)} / {pad(projects.length)} serving
              </p>
              <FullExperienceLink className="p-signboard">
                Ride the 3D city <Arrow />
              </FullExperienceLink>
              <span className="p-street__pole" aria-hidden />
            </div>
          </div>
        </div>
      </section>

      {/* ── 03 The engine room ───────────────────────────────────── */}
      <section className="p-factory" id="engine-room" data-chapter data-factory data-strip data-tone="night" aria-labelledby="engine-title">
        <div className="p-factory__backdrop" aria-hidden>
          <div className="p-factory__wall" data-depth="0.25">
            <ServerHall />
          </div>
        </div>
        <div className="p-factory__floor" aria-hidden />
        <p className="p-factory__count p-mono" aria-hidden>
          <b data-shipped>00</b> / {pad(crates.length)} deployed
        </p>
        <div className="p-factory__hud" data-hud aria-hidden>
          <p className="p-factory__hud-label p-mono">
            <i />
            Last deployed
          </p>
          <p className="p-factory__hud-name" data-hud-name>
            —
          </p>
          <p className="p-factory__hud-desc" data-hud-desc />
          <div className="p-factory__hud-bar">
            <i data-hud-bar />
          </div>
        </div>
        <div className="p-press" data-press aria-hidden>
          <span className="p-press__body" />
          <span className="p-press__head" data-press-head />
          {Array.from({ length: 7 }, (_, i) => (
            <i key={i} className="p-press__spark" data-spark />
          ))}
        </div>

        <div className="p-factory__viewport">
          <div className="p-factory__track" data-track>
            <header className="p-factory__head">
              <p className="p-kicker p-mono">
                <b>03</b>
                <span>The training floor</span>
              </p>
              <h2 id="engine-title" className="p-title" data-chars>
                Behind every product, <em>a training floor.</em>
              </h2>
              <p className="p-factory__lead">
                The parts every live system is built from. Each one comes off the belt untrained, and is stamped only once it runs in production.
              </p>
              <p className="p-hint p-mono">
                <i />
                <span>Scroll sideways</span>
              </p>
            </header>

            {crates.map((c) => {
              const p = bySlug.get(c.project);
              return (
                <Link
                  key={c.name + c.thin}
                  className={`p-crate ${c.legendary ? "p-crate--legendary" : ""}`}
                  href={`/projects/${c.project}`}
                  data-crate
                  data-name={c.name + c.thin}
                  data-desc={c.desc}
                  data-cursor="open"
                  aria-label={`${c.name}${c.thin}, from ${p?.title}: ${c.desc}`}
                >
                  <span className="p-crate__raw" aria-hidden>
                    <span className="p-crate__code p-mono">init()</span>
                    <span className="p-crate__noise" />
                    <span className="p-crate__raw-name p-mono">
                      {c.name}
                      {c.thin}
                    </span>
                  </span>
                  <span className="p-crate__done" aria-hidden>
                    <span className="p-crate__tape" />
                    <span className="p-crate__label">
                      <span className="p-crate__vendor p-mono">
                        <Mark /> synapx
                      </span>
                      <span className="p-crate__name">
                        {c.name}
                        <span className="text-thin">{c.thin}</span>
                      </span>
                      <span className="p-crate__desc">{c.desc}</span>
                    </span>
                    <span className="p-crate__foot p-mono">
                      <span>{c.stat}</span>
                      <span>{p?.title}</span>
                    </span>
                    <span className="p-crate__stamp p-mono">Deployed</span>
                  </span>
                </Link>
              );
            })}

            <div className="p-factory__dock">
              <p className="p-mono p-dim">All {pad(crates.length)} in production</p>
              <a className="p-signboard p-signboard--amber" href="#missions">
                Pick a mission <Arrow />
              </a>
              <span className="p-factory__pole" aria-hidden />
            </div>
          </div>
          <span className="p-belt" aria-hidden>
            <span className="p-belt__rollers">
              {Array.from({ length: 48 }, (_, i) => (
                <i key={i} />
              ))}
            </span>
          </span>
        </div>
      </section>

      {/* ── 04 Under the hood ────────────────────────────────────── */}
      <section className="p-player p-marks" id="about" data-chapter data-tone="night" aria-labelledby="player-title">
        <RopeAt
          points={[
            ["94%", "0%"],
            ["80%", "5%"],
            ["52%", "9%"],
            ["22%", "8%"],
            ["5%", "17%"],
            ["12%", "33%"],
            ["47%", "43%"],
            ["52%", "57%"],
            ["30%", "66%"],
            ["7%", "73%"],
            ["24%", "86%"],
            ["62%", "92%"],
            ["90%", "99%"],
          ]}
        />
        <header className="p-container p-section-head">
          <p className="p-kicker p-mono">
            <b>04</b>
            <span>The engineer</span>
          </p>
          <h2 id="player-title" className="p-title" data-chars>
            Who trains <em>the machine?</em>
          </h2>
        </header>

        <div className="p-container p-player__grid">
          <div className="p-player__stage" data-reveal>
            <figure className="p-map">
              <div className="p-map__frame">
                <Image src="/earth/night.webp" alt={`World at night, with arcs from ${home.city} to every city the work reaches`} fill sizes="(min-width: 1024px) 40vw, 92vw" />
                <svg viewBox="0 0 1000 500" aria-hidden>
                  {about.places.slice(1).map((pl) => {
                    const pt = mapXY(pl.lon, pl.lat);
                    const mx = (homePt.x + pt.x) / 2;
                    const my = Math.min(homePt.y, pt.y) - Math.abs(homePt.x - pt.x) * 0.16;
                    return <path key={pl.city} className="p-map__arc" d={`M ${homePt.x} ${homePt.y} Q ${mx} ${my} ${pt.x} ${pt.y}`} />;
                  })}
                  {about.places.map((pl, i) => {
                    const pt = mapXY(pl.lon, pl.lat);
                    return (
                      <g key={pl.city} transform={`translate(${pt.x} ${pt.y})`}>
                        {i === 0 && <circle className="p-map__pulse" r="16" />}
                        <circle className={i === 0 ? "p-map__home" : "p-map__city"} r={i === 0 ? 5 : 3} />
                      </g>
                    );
                  })}
                </svg>
              </div>
              <figcaption className="p-mono">{board.heading}</figcaption>
            </figure>
            <ul className="p-clocks p-mono" aria-label="Local times">
              {about.places.map((pl, i) => (
                <li key={pl.city} className={i === 0 ? "is-home" : ""}>
                  <span>{pl.city}</span>
                  <LocalTime tz={pl.tz} />
                </li>
              ))}
            </ul>
            <span className="p-player__pedestal" aria-hidden />
          </div>

          <article className="p-player__card" data-reveal>
            <header className="p-player__top p-mono">
              <span>Operator 01</span>
              {person.available && (
                <span className="p-player__status">
                  <i className="p-status" />
                  Available for work
                </span>
              )}
            </header>
            <h3 className="p-player__name">{person.name}</h3>
            <p className="p-player__class p-mono">
              {person.role} · {person.location}
            </p>
            <p className="p-player__lead" data-words>
              {person.intro}
            </p>
            <div className="p-player__body">
              {about.body.map((b) => (
                <p key={b}>{b}</p>
              ))}
            </div>
            <dl className="p-player__stats p-mono">
              {stats.map((s) => (
                <div key={s.label}>
                  <dt>{s.label}</dt>
                  <dd data-count-to={s.value}>{s.value}</dd>
                </div>
              ))}
            </dl>
            <ul className="p-pills" aria-label="Capabilities">
              {about.services.map((s) => (
                <li key={s} className="p-pill">
                  {s}
                </li>
              ))}
            </ul>
            <div className="p-player__balance p-mono" role="img" aria-label="Human and machine, in balance">
              <span>Human</span>
              <span className="p-player__meter">
                <i data-balance />
              </span>
              <span>Machine</span>
            </div>
          </article>
        </div>

        <div className="p-container p-process" data-process>
          <div className="p-process__head">
            <p className="p-kicker p-mono">
              <b className="is-mark">—</b>
              <span>How the work runs</span>
            </p>
            <h3 className="p-process__heading" data-chars>
              Four moves, <em>every time.</em>
            </h3>
          </div>
          <div className="p-process__line" aria-hidden>
            <i data-process-line />
          </div>
          <ol className="p-process__steps">
            {process.map((st, i) => (
              <li key={st.title} className="p-process__step" data-step>
                <span className="p-process__num p-mono">{pad(i + 1)}</span>
                <h4 className="p-process__title">{st.title}</h4>
                <p>{st.text}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* ── 05 Missions ──────────────────────────────────────────── */}
      <Missions />

      {/* ── 06 Both sides ────────────────────────────────────────── */}
      <section className="p-split p-split--finale" id="contact" data-chapter data-finale aria-labelledby="finale-title">
        <div className="p-split__stage" data-tone="night">
          <h2 id="finale-title" className="sr-only">
            {contact.heading}
          </h2>
          <div className="p-split__glow" aria-hidden />
          <div className="p-split__half p-split__half--front" data-half="front" data-tone="paper">
            <Cap side="front" cap="open" words={story.finale.front} em={false} />
            <span className="p-finale__lamp p-finale__lamp--front" aria-hidden>
              <Mast />
            </span>
          </div>
          <div className="p-split__half p-split__half--back" data-half="back" data-tone="night">
            <Cap side="back" cap="open" words={story.finale.back} />
            <span className="p-finale__lamp" aria-hidden>
              <Mast />
            </span>
          </div>
          <RopeAt
            points={[
              ["50%", "3%"],
              ["78%", "36%"],
              ["62%", "80%"],
              ["30%", "84%"],
              ["12%", "97%"],
            ]}
          />
          <div className="p-split__cta" data-cta>
            <p className="p-split__note">{contact.note}</p>
            <div className="p-split__actions">
              <a className="p-button p-button--solid" href={`mailto:${person.email}`} data-magnetic>
                <span className="p-button__fill" />
                <span>Start a project</span>
                <Arrow />
              </a>
              <CopyEmail className="p-split__mail p-mono" />
            </div>
          </div>
        </div>
      </section>

      <Marquee words={marquee} tone="night" reverse />

      <SiteFooter />
    </PaperMotion>
  );
}
