"use client";

import Link from "next/link";
import { useEffect, useRef } from "react";
import { about, contact, footer, person, projects } from "@/content/site";
import { gsap, useGSAP } from "@/lib/gsap";
import { perlin } from "@/lib/perlin";
import FullExperienceLink from "./FullExperienceLink";
import { PLAYGROUND } from "./Header";
import { lenis } from "./SmoothScroll";

const home = about.places[0];
/** the footer is the lite edition's night side (see .site-footer in globals.css) */
const NIGHT = "#050505";
/** resting weight of the big name; the cursor pulls letters up to 900 */
const REST = 140;
const REST_TOUCH = 320;

const EXPLORE = [
  { label: "The board", href: "/board" },
  { label: "System flow", href: "/flow" },
  ...PLAYGROUND.filter((p) => ["/cars", "/rover", "/diffusion", "/voice"].includes(p.href)),
];

/**
 * The lite edition's last word, on its night side: a ridge-line range that breathes and rises under the cursor,
 * the name in a variable face whose letters thicken as the pointer passes, and the index.
 */
export default function SiteFooter() {
  const root = useRef<HTMLElement>(null);
  const art = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const name = useRef<HTMLParagraphElement>(null);
  const clock = useRef<HTMLSpanElement>(null);

  // entrance: the name rises letter by letter, the index follows
  useGSAP(
    () => {
      const chars = gsap.utils.toArray<HTMLElement>(".ft-char");
      gsap.set(chars, { yPercent: 105 });
      gsap.set(".ft-in", { opacity: 0, y: 24 });
      gsap
        .timeline({ scrollTrigger: { trigger: root.current, start: "top 70%", once: true } })
        .to(chars, { yPercent: 0, duration: 1.3, stagger: 0.035, ease: "expo.out" })
        .to(".ft-in", { opacity: 1, y: 0, duration: 0.9, stagger: 0.06, ease: "power3.out" }, 0.35);
    },
    { scope: root },
  );

  // ridges + the name's weight field, run only while the footer is on screen
  useEffect(() => {
    const cv = canvas.current;
    const host = art.current;
    const ctx = cv?.getContext("2d");
    if (!cv || !host || !ctx || !name.current) return;

    const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
    const fine = matchMedia("(hover: hover) and (pointer: fine)").matches;
    const chars = Array.from(name.current.querySelectorAll<HTMLElement>(".ft-char"));
    const rest: number = fine ? REST : REST_TOUCH;
    const weights = chars.map(() => rest);
    const setWeight = (el: HTMLElement, w: number) => (el.style.fontVariationSettings = `"wght" ${w.toFixed(0)}, "opsz" 72`);
    chars.forEach((c) => setWeight(c, rest));

    const noise = perlin(1937);
    const fbm = (x: number, y: number) => noise(x, y) * 0.62 + noise(x * 2.3, y * 2.3) * 0.38;

    let w = 0;
    let h = 0;
    let dpr = 1;
    const resize = () => {
      const r = cv.getBoundingClientRect();
      dpr = Math.min(devicePixelRatio || 1, 2);
      w = r.width;
      h = r.height;
      cv.width = Math.round(w * dpr);
      cv.height = Math.round(h * dpr);
    };

    // pointer, in the art's own pixels; `over` eases in and out so the range never snaps
    const m = { x: 0, y: 0, cx: 0, inside: false, over: 0, shift: 0 };
    const onMove = (e: PointerEvent) => {
      const r = host.getBoundingClientRect();
      m.x = e.clientX - r.left;
      m.y = e.clientY - r.top;
      m.cx = e.clientX;
      m.inside = m.y > -40 && m.y < r.height + 60 && m.x >= 0 && m.x <= r.width;
    };
    const onLeave = () => (m.inside = false);

    const pts: number[] = [];
    const draw = (t: number) => {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.fillStyle = NIGHT;
      ctx.fillRect(0, 0, w, h);
      ctx.lineWidth = 1;
      ctx.lineJoin = "round";

      const gap = Math.max(7, h / 58);
      const rows = Math.floor((h * 0.86) / gap);
      const step = Math.max(3, w / 360);
      const spread = w * 0.17;
      const cx = w * 0.5 + m.shift;
      const top = h * 0.16;

      // back to front: each ridge is filled with the ground, hiding the ones behind it
      for (let i = 0; i < rows; i++) {
        const y0 = top + i * gap;
        const row = i / rows;
        // the range is tallest in the middle rows and settles toward the front
        const lift = Math.sin(Math.PI * Math.min(1, row * 1.25)) ** 0.8;
        pts.length = 0;
        for (let x = 0; x <= w + step; x += step) {
          const e = Math.exp(-(((x - cx) / (spread * (0.8 + 0.4 * noise(i * 0.21, t * 0.03)))) ** 2));
          const k = 0.5 + 0.5 * fbm(x * 0.011, i * 0.19 + t * 0.05);
          let d =
            gap * 15 * lift * e * (0.12 + 0.88 * k * k) +
            gap * 1.1 * e * noise(x * 0.06, i * 0.9 + t * 0.25) +
            gap * 0.4 * noise(x * 0.025, i * 0.45 + t * 0.18);
          if (m.over > 0.001) {
            const dx = (x - m.x) / (w * 0.07);
            const dy = (y0 - m.y) / (gap * 12);
            d += gap * 6 * m.over * Math.exp(-dx * dx - dy * dy) * (0.6 + 0.4 * k);
          }
          pts.push(x, y0 - d);
        }
        ctx.beginPath();
        ctx.moveTo(pts[0], pts[1]);
        for (let j = 2; j < pts.length; j += 2) ctx.lineTo(pts[j], pts[j + 1]);
        ctx.lineTo(w + step, h);
        ctx.lineTo(0, h);
        ctx.closePath();
        ctx.fill();
        ctx.beginPath();
        ctx.moveTo(pts[0], pts[1]);
        for (let j = 2; j < pts.length; j += 2) ctx.lineTo(pts[j], pts[j + 1]);
        ctx.strokeStyle = `rgba(241, 238, 230, ${0.16 + 0.42 * row})`;
        ctx.stroke();
      }
    };

    const tick = (time: number) => {
      m.over += ((m.inside ? 1 : 0) - m.over) * 0.06;
      m.shift += ((m.inside ? (m.x - w / 2) * 0.22 : 0) - m.shift) * 0.03;
      draw(time);

      if (!fine) return;
      // the name: read every letter first, then write, so layout runs once a frame
      const centers = chars.map((c) => {
        const r = c.getBoundingClientRect();
        return r.left + r.width / 2;
      });
      const radius = (name.current?.offsetWidth ?? w) * 0.13;
      chars.forEach((c, i) => {
        const target = m.inside ? rest + (900 - rest) * Math.exp(-(((centers[i] - m.cx) / radius) ** 2)) : rest;
        const next = weights[i] + (target - weights[i]) * 0.16;
        if (Math.abs(next - weights[i]) < 0.5) return;
        weights[i] = next;
        setWeight(c, next);
      });
    };

    resize();
    draw(0);
    if (reduce) {
      const ro = new ResizeObserver(() => (resize(), draw(0)));
      ro.observe(cv);
      return () => ro.disconnect();
    }

    let running = false;
    const io = new IntersectionObserver(([e]) => {
      if (e.isIntersecting === running) return;
      running = e.isIntersecting;
      if (running) {
        gsap.ticker.add(tick);
        addEventListener("pointermove", onMove, { passive: true });
        document.addEventListener("pointerleave", onLeave);
      } else {
        gsap.ticker.remove(tick);
        removeEventListener("pointermove", onMove);
        document.removeEventListener("pointerleave", onLeave);
      }
    });
    io.observe(host);
    const ro = new ResizeObserver(() => (resize(), draw(gsap.ticker.time)));
    ro.observe(cv);
    return () => {
      io.disconnect();
      ro.disconnect();
      gsap.ticker.remove(tick);
      removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerleave", onLeave);
    };
  }, []);

  // home's local time, to the second
  useEffect(() => {
    const fmt = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false, timeZone: home.tz });
    const update = () => {
      if (clock.current) clock.current.textContent = fmt.format(new Date());
    };
    update();
    const id = setInterval(update, 1000);
    return () => clearInterval(id);
  }, []);

  // all the way back up; on the journey that replays every chapter in reverse
  const toTop = () => {
    const d = Math.min(4.5, 1.2 + scrollY / 6000);
    if (lenis) lenis.scrollTo(0, { duration: d, easing: (t) => 1 - Math.pow(1 - t, 4) });
    else scrollTo({ top: 0, behavior: "smooth" });
  };

  return (
    <footer ref={root} className="site-footer relative w-full border-t border-fg/10 bg-bg" data-tone="night" role="contentinfo">
      <div ref={art} className="relative h-[46vw] max-h-[560px] min-h-[280px] overflow-hidden">
        <canvas ref={canvas} aria-hidden className="absolute inset-0 h-full w-full" />
        <div aria-hidden className="ft-fade pointer-events-none absolute inset-0" />
        <p
          ref={name}
          aria-hidden
          className="ft-name absolute inset-x-0 bottom-0 select-none whitespace-nowrap px-2 text-center text-[16.5vw]"
        >
          {person.shortName.split("").map((ch, i) => (
            <span key={i} className="ft-char inline-block">
              {ch === " " ? " " : ch}
            </span>
          ))}
        </p>
      </div>

      <div className="grid grid-cols-2 gap-x-6 gap-y-12 px-gutter py-14 sm:gap-x-12 md:py-20 lg:grid-cols-12">
        <div className="ft-in col-span-2 lg:col-span-4">
          <div className="flex items-center gap-4">
            <span className="ft-mono">TA</span>
            <span className="label flex items-center gap-2 !text-fg/80">
              <span aria-hidden className="ft-pulse" />
              {person.available ? "Taking new builds" : "Booked for now"}
            </span>
          </div>
          <p className="mt-6 font-mono text-[12px] uppercase tracking-[0.08em] text-fg">
            {person.role} — {person.location}.
          </p>
          <p className="mt-3 max-w-sm text-sm leading-relaxed text-fg/55">{footer.blurb}</p>
          <a href={`mailto:${person.email}`} className="ft-mail mt-7 inline-flex items-center gap-3" data-cursor="view">
            <span>{person.email}</span>
            <span aria-hidden>↗</span>
          </a>
        </div>

        <Column n="01" title="Projects" label="Projects">
          {projects.map((p) => (
            <li key={p.slug}>
              <Link href={`/projects/${p.slug}`} className="ft-link">
                {p.title}
              </Link>
            </li>
          ))}
        </Column>

        <Column n="02" title="Social" label="Social">
          {person.socials.map((s) => (
            <li key={s.label}>
              <a href={s.href} target="_blank" rel="noreferrer" className="ft-link">
                {s.label} ↗
              </a>
            </li>
          ))}
          <li>
            <a href={`mailto:${person.email}`} className="ft-link">
              Email ↗
            </a>
          </li>
        </Column>

        <Column n="03" title="Explore" label="Explore">
          {EXPLORE.map((e) => (
            <li key={e.href}>
              <Link href={e.href} className="ft-link">
                {e.label}
              </Link>
            </li>
          ))}
          <li>
            <FullExperienceLink className="ft-link">Full 3D experience ↗</FullExperienceLink>
          </li>
        </Column>

        <div className="ft-in lg:col-span-2">
          <p aria-hidden className="label mb-2">
            04
          </p>
          <h3 className="ft-head mb-5">{home.city}</h3>
          <p className="font-mono text-[12px] uppercase tracking-[0.08em] text-fg/60">Sri Lanka</p>
          <p className="mt-1 font-mono text-[12px] uppercase tracking-[0.08em] text-fg/45">{footer.coords}</p>
          <p className="mt-5 font-mono text-[12px] uppercase tracking-[0.08em] text-fg/60">
            <span ref={clock} className="tabular-nums text-fg">
              --:--:--
            </span>{" "}
            · GMT+5:30
          </p>
        </div>
      </div>

      <div className="ft-in flex flex-col items-start justify-between gap-4 border-t border-fg/10 px-gutter py-6 sm:flex-row sm:items-center">
        <div className="space-y-1">
          <p className="label !text-fg/80">
            © {contact.year} {person.name}. All rights reserved
          </p>
          <p className="label !text-fg/45">{footer.credits}</p>
        </div>
        <button type="button" onClick={toTop} className="ft-top label group flex items-center gap-2 !text-fg/80 hover:!text-fg">
          Back to top
          <span aria-hidden className="inline-block transition-transform duration-300 group-hover:-translate-y-1">
            ↑
          </span>
        </button>
      </div>
    </footer>
  );
}

function Column({ n, title, label, children }: { n: string; title: string; label: string; children: React.ReactNode }) {
  return (
    <nav className="ft-in flex flex-col lg:col-span-2" aria-label={label}>
      <p aria-hidden className="label mb-2">
        {n}
      </p>
      <h3 className="ft-head mb-5">{title}</h3>
      <ul className="space-y-3">{children}</ul>
    </nav>
  );
}
