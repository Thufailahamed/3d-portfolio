"use client";

import { useRef } from "react";
import { lenis } from "@/components/SmoothScroll";
import { gsap, ScrollTrigger, SplitText, useGSAP } from "@/lib/gsap";
import { createHandshake } from "./handshake";

// a hard load evaluates this module afresh and plays the loader; client navigations back skip it
let booted = false;
const q = <T extends Element = HTMLElement>(root: ParentNode, sel: string) => root.querySelector<T>(sel);
const qa = <T extends Element = HTMLElement>(root: ParentNode, sel: string) => Array.from(root.querySelectorAll<T>(sel));
const lines = (root: ParentNode | null, cap: string) => (root ? qa(root, `[data-cap="${cap}"] .p-cap__line > span`) : []);

/**
 * Every moving part of the paper edition, wired by data attributes on server-rendered markup.
 * Without JS, or with reduced motion, the page reads top to bottom and the strips scroll natively.
 */
export default function PaperMotion({ className = "", children }: { className?: string; children: React.ReactNode }) {
  const root = useRef<HTMLDivElement>(null);

  useGSAP(
    (_, contextSafe) => {
      const el = root.current!;
      const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
      const fine = matchMedia("(pointer: fine)").matches;

      /* ── anchors glide through Lenis (pins included) ───────────────── */
      const onClick = (e: MouseEvent) => {
        const a = (e.target as Element).closest<HTMLAnchorElement>('a[href^="#"]');
        const id = a?.getAttribute("href")?.slice(1);
        if (!a || !id) return;
        const target = document.getElementById(id);
        if (!target) return;
        e.preventDefault();
        if (lenis) lenis.scrollTo(target, { duration: reduce ? 0 : 1.6, immediate: reduce });
        else target.scrollIntoView();
        history.replaceState(null, "", `#${id}`);
      };
      document.addEventListener("click", onClick);

      /* ── progress bar ──────────────────────────────────────────────── */
      const bar = q(el, "[data-progress]");
      if (bar)
        ScrollTrigger.create({
          start: 0,
          end: "max",
          onUpdate: (s) => gsap.set(bar, { scaleX: s.progress }),
        });

      /* ── paper / night under the header and the rail ───────────────── */
      const header = document.querySelector<HTMLElement>("[data-paper-header]");
      const rail = q(el, "[data-rail]");
      const toneAt = (x: number, y: number) => {
        for (const hit of document.elementsFromPoint(x, y)) {
          if (hit.closest("[data-paper-header], [data-rail]")) continue;
          const t = hit.closest<HTMLElement>("[data-tone]")?.dataset.tone;
          if (t) return t;
        }
        return "paper";
      };
      const chapters = qa(el, "[data-chapter]");
      const railLinks = rail ? qa<HTMLAnchorElement>(rail, "a") : [];
      let frame = 0;
      const watch = () => {
        if (frame++ % 3) return;
        if (header) {
          header.dataset.left = toneAt(40, 30);
          header.dataset.right = toneAt(innerWidth - 40, 30);
        }
        if (rail) {
          rail.dataset.tone = toneAt(innerWidth - 24, innerHeight / 2);
          const mid = innerHeight / 2;
          const at = chapters.findIndex((c) => {
            const r = c.getBoundingClientRect();
            return r.top <= mid && r.bottom > mid;
          });
          railLinks.forEach((a, i) => (i === at ? a.setAttribute("aria-current", "true") : a.removeAttribute("aria-current")));
        }
      };
      gsap.ticker.add(watch);

      /* ── the handshake canvas runs in every mode (a still frame when motion is reduced) ── */
      const hs = q(el, "[data-handshake]");
      const hsCanvas = hs && q<HTMLCanvasElement>(hs, "[data-hs-canvas]");
      const hsLeft = hs && q(hs, "[data-hs-left]");
      const shake = hsCanvas
        ? createHandshake(hsCanvas, {
            reduce,
            onTone: (t) => {
              if (hsLeft) hsLeft.dataset.tone = t;
            },
          })
        : null;

      /* ── curves: Catmull-Rom through points, as cubic Bézier segments ── */
      type Pt = { x: number; y: number };
      const lerp = (a: Pt, b: Pt, t: number): Pt => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
      const segment = (P: Pt[], i: number): [Pt, Pt, Pt, Pt] => {
        const p0 = P[i - 1] ?? P[i];
        const p1 = P[i];
        const p2 = P[i + 1];
        const p3 = P[i + 2] ?? p2;
        return [p1, { x: p1.x + (p2.x - p0.x) / 6, y: p1.y + (p2.y - p0.y) / 6 }, { x: p2.x - (p3.x - p1.x) / 6, y: p2.y - (p3.y - p1.y) / 6 }, p2];
      };
      const place = (c: SVGCircleElement, p: Pt) => {
        c.setAttribute("cx", String(p.x));
        c.setAttribute("cy", String(p.y));
      };

      /* ── the hero's thread: arrives part-drawn, scroll pulls it through the headline ── */
      const heroSvg = q<SVGSVGElement>(el, "[data-thread]");
      const heroThread = heroSvg
        ? (() => {
            const pts: [number, number][] = JSON.parse(heroSvg.dataset.points ?? "[]");
            const path = heroSvg.querySelector("path")!;
            const [dot, ring, head] = Array.from(heroSvg.querySelectorAll("circle"));
            const at = { intro: reduce ? 1 : 0, scroll: 0 };
            let len = 1;
            const layout = () => {
              const w = heroSvg.clientWidth;
              const h = heroSvg.clientHeight;
              heroSvg.setAttribute("viewBox", `0 0 ${w} ${h}`);
              const P = pts.map(([x, y]) => ({ x: x * w, y: y * h }));
              let d = `M${P[0].x} ${P[0].y}`;
              for (let i = 0; i < P.length - 1; i++) {
                const [, c1, c2, p2] = segment(P, i);
                d += ` C${c1.x} ${c1.y} ${c2.x} ${c2.y} ${p2.x} ${p2.y}`;
              }
              path.setAttribute("d", d);
              place(dot, P[0]);
              len = path.getTotalLength() || 1;
              path.style.strokeDasharray = `${len}`;
            };
            // the drawn share is the intro's, topped up by the scroll; the head rides the tip
            const update = () => {
              const p = at.intro + (1 - at.intro) * at.scroll;
              path.style.strokeDashoffset = String(len * (1 - p));
              const tip = path.getPointAtLength(len * p);
              place(ring, tip);
              place(head, tip);
              ring.style.opacity = head.style.opacity = p > 0.01 ? "1" : "0";
            };
            layout();
            update();
            return { at, layout, update };
          })()
        : null;

      /* ── the rope: one line through the lower half of the page; its head follows the scroll ── */
      const ropeSvg = q<SVGSVGElement>(el, "[data-rope]");
      const marks = qa(el, "[data-rope-at]");
      const rope =
        ropeSvg && marks.length > 1
          ? (() => {
              const path = ropeSvg.querySelector("path")!;
              const [start, ring, head] = Array.from(ropeSvg.querySelectorAll("circle"));
              let doc: Pt[] = [];
              let reach: number[] = [];
              let last = NaN;
              // waypoints in page coordinates, and the scroll at which each one reaches the head line
              const measure = () => {
                const sy = scrollY;
                const line = innerHeight * 0.6;
                doc = marks.map((m) => {
                  const r = m.getBoundingClientRect();
                  return { x: r.left, y: r.top + sy };
                });
                reach = [];
                doc.forEach((p, i) => reach.push(i ? Math.max(p.y - line, reach[i - 1] + 1) : p.y - line));
                last = NaN;
              };
              const render = () => {
                const sy = scrollY;
                if (sy === last) return;
                last = sy;
                const y = reduce ? Infinity : sy;
                if (y < reach[0]) {
                  ropeSvg.style.opacity = "0";
                  return;
                }
                ropeSvg.style.opacity = "1";
                const P = doc.map((p) => ({ x: p.x, y: p.y - sy }));
                let k = reach.length - 1;
                while (k > 0 && reach[k] > y) k--;
                const f = k < reach.length - 1 ? Math.min(1, Math.max(0, (y - reach[k]) / (reach[k + 1] - reach[k]))) : 0;
                let d = `M${P[0].x} ${P[0].y}`;
                let tip = P[0];
                for (let i = 0; i < k; i++) {
                  const [, c1, c2, p2] = segment(P, i);
                  d += ` C${c1.x} ${c1.y} ${c2.x} ${c2.y} ${p2.x} ${p2.y}`;
                  tip = p2;
                }
                // the segment being drawn, cut at the scroll's share (de Casteljau)
                if (f > 0 && k < P.length - 1) {
                  const [a, b, c, e] = segment(P, k);
                  const ab = lerp(a, b, f);
                  const bc = lerp(b, c, f);
                  const ce = lerp(c, e, f);
                  const abc = lerp(ab, bc, f);
                  tip = lerp(abc, lerp(bc, ce, f), f);
                  d += ` C${ab.x} ${ab.y} ${abc.x} ${abc.y} ${tip.x} ${tip.y}`;
                }
                path.setAttribute("d", d);
                place(start, P[0]);
                place(ring, tip);
                place(head, tip);
              };
              measure();
              render();
              return {
                measure,
                render,
                refresh: () => {
                  measure();
                  render();
                },
              };
            })()
          : null;
      if (rope) gsap.ticker.add(rope.render);

      const reflow = () => {
        heroThread?.layout();
        heroThread?.update();
        rope?.refresh();
      };
      ScrollTrigger.addEventListener("refresh", reflow);

      /* ── loader, then the hero's first frame ───────────────────────── */
      const loader = q(el, "[data-loader]");
      const story = q(el, "[data-story]");
      const intro = () => {
        booted = true;
        el.classList.add("is-ready");
        if (reduce) return;
        // the hands slide in from the edges as the headline rises
        if (shake) gsap.to(shake, { enter: 1, duration: 2.6, ease: "expo.out" });
        // the hero's thread arrives part-drawn; scrolling pulls the rest of it through the headline
        if (heroThread) gsap.to(heroThread.at, { intro: 0.42, duration: 1.8, delay: 0.5, ease: "power2.inOut", onUpdate: heroThread.update });
        if (hs) {
          gsap.from(qa(hs, "[data-hs-line]"), { yPercent: 115, duration: 1.3, stagger: 0.09, ease: "expo.out" });
          gsap.from(qa(hs, "[data-hs-in]"), { y: 26, autoAlpha: 0, duration: 1.1, stagger: 0.08, delay: 0.35, ease: "expo.out" });
        }
      };
      if (!loader || reduce || booted) {
        if (loader) gsap.set(loader, { display: "none" });
        intro();
      } else {
        // a training run: the curve falls, epochs tick, the boot log fills, then the halves part like curtains
        const count = q(loader, "[data-count]");
        const epoch = q(loader, "[data-epoch]");
        const loss = q(loader, "[data-loss]");
        const curve = q<SVGPathElement>(loader, "[data-loader-curve]");
        const logs = qa(loader, "[data-log]");
        const n = { v: 0 };
        const show = () => {
          if (count) count.textContent = String(Math.round(n.v)).padStart(3, "0");
          if (epoch) epoch.textContent = String(Math.round((n.v / 100) * 12)).padStart(2, "0");
          if (loss) loss.textContent = (2.36 * Math.exp(-n.v / 26) + 0.041).toFixed(3);
        };
        gsap.set(curve, { strokeDasharray: 1, strokeDashoffset: 1 });
        gsap.set(q(loader, "[data-loader-bar]"), { scaleX: 0 });
        gsap.set(logs, { autoAlpha: 0, x: -14 });
        gsap
          .timeline()
          .from(qa(loader, ".p-loader__top > span"), { yPercent: 120, autoAlpha: 0, duration: 0.8, stagger: 0.1, ease: "expo.out" }, 0)
          .from(count, { yPercent: 30, autoAlpha: 0, duration: 0.9, ease: "expo.out" }, 0.05)
          .to(n, { v: 100, duration: 2.2, ease: "power2.inOut", onUpdate: show }, 0.15)
          .to(curve, { strokeDashoffset: 0, duration: 2.2, ease: "power2.inOut" }, 0.15)
          .to(q(loader, "[data-loader-bar]"), { scaleX: 1, duration: 2.2, ease: "power2.inOut" }, 0.15)
          .to(logs, { autoAlpha: 1, x: 0, duration: 0.5, stagger: 0.48, ease: "power3.out" }, 0.25)
          .to(qa(loader, "[data-loader-fade]"), { autoAlpha: 0, y: -24, duration: 0.45, stagger: 0.03, ease: "power2.in" }, "+=0.25")
          .to(q(loader, '[data-loader-half="front"]'), { xPercent: -100, duration: 1.15, ease: "expo.inOut" }, "-=0.1")
          .to(q(loader, '[data-loader-half="back"]'), { xPercent: 100, duration: 1.15, ease: "expo.inOut" }, "<")
          .add(() => {
            scrollTo(0, 0);
            intro();
          }, "-=0.75")
          .set(loader, { display: "none" });
      }

      if (reduce) {
        return () => {
          document.removeEventListener("click", onClick);
          gsap.ticker.remove(watch);
          shake?.destroy();
        ScrollTrigger.removeEventListener("refresh", reflow);
        if (rope) gsap.ticker.remove(rope.render);
        };
      }
      el.classList.add("is-driven");

      /* ── 00 the handshake: pinned; scroll drives the hands, the copy steps aside ── */
      if (hs && shake) {
        gsap
          .timeline({
            defaults: { ease: "none" },
            scrollTrigger: {
              trigger: hs,
              start: "top top",
              end: "+=210%",
              pin: true,
              scrub: 0.6,
              onUpdate: (s) => {
                shake.target = s.progress;
                if (heroThread) {
                  heroThread.at.scroll = Math.min(1, s.progress / 0.13);
                  heroThread.update();
                }
              },
            },
          })
          .to(qa(hs, "[data-hs-fade]"), { autoAlpha: 0, y: -50, duration: 0.16, stagger: 0.01, ease: "power2.in" }, 0)
          .to(q(hs, "[data-hs-thread]"), { autoAlpha: 0, duration: 0.05 }, 0.14)
          .fromTo(q(hs, "[data-hs-after]"), { autoAlpha: 0, y: 40 }, { autoAlpha: 1, y: 0, duration: 0.14, ease: "power2.out" }, 0.74)
          .to({}, { duration: 0.12 }, 0.88);
      }

      /* ── 01 the split arrives: its first frame plays as it comes into view ── */
      if (story) {
        const name = q(story, "[data-name-text]");
        gsap
          .timeline({ scrollTrigger: { trigger: story, start: "top 70%", onEnter: () => story.classList.add("is-live") } })
          .from(lines(story, "open"), { yPercent: 115, duration: 1.2, stagger: 0.09, ease: "expo.out" }, 0)
          .from(q(story, "[data-banner-inner]"), { scale: 0.6, autoAlpha: 0, duration: 1, ease: "back.out(1.7)" }, 0.25)
          .from(qa(story, "[data-device]"), { y: 60, autoAlpha: 0, duration: 1.3, stagger: 0.12, ease: "expo.out" }, 0.3)
          .from(q(story, "[data-hint]"), { y: 20, autoAlpha: 0, duration: 0.8, ease: "expo.out" }, 0.7)
          .from(qa(story, "[data-chat]"), { y: 24, scale: 0.94, autoAlpha: 0, duration: 0.9, stagger: 0.7, ease: "expo.out" }, 0.6)
          .to(name, { duration: 1.6, scrambleText: { text: name?.textContent ?? "", chars: "upperCase", speed: 0.5 } }, 0.4);
      }

      /* ── 01 the split: halves part, the stack rises, halves close ──── */
      if (story) {
        const front = q(story, '[data-half="front"]');
        const back = q(story, '[data-half="back"]');
        const hero = q(story, "[data-hero]");
        gsap.set([...lines(story, "pick"), ...lines(story, "hood"), ...lines(story, "close")], { yPercent: 115 });
        const sides = q(story, "[data-nn-sides]");
        const unify = q(story, "[data-nn-unify]");
        gsap.set(hero, { yPercent: 18, autoAlpha: 0 });
        gsap.set([sides, unify], { autoAlpha: 0 });
        gsap
          .timeline({
            defaults: { ease: "none" },
            scrollTrigger: { trigger: story, start: "top top", end: "+=280%", pin: true, scrub: 0.8 },
          })
          .to(q(story, "[data-hint]"), { autoAlpha: 0, y: 20, duration: 0.4 }, 0)
          .to(qa(story, '[data-cap="open"]'), { yPercent: -40, autoAlpha: 0, duration: 1 }, 0)
          .to(qa(story, "[data-chat]"), { y: -30, autoAlpha: 0, duration: 0.7, stagger: 0.1 }, 0)
          .to(q(story, "[data-banner]"), { scale: 0.85, autoAlpha: 0, duration: 0.8 }, 0.4)
          .to(q(story, "[data-name]"), { autoAlpha: 0, y: 20, duration: 0.6 }, 0.4)
          .to(front, { xPercent: -100, duration: 2, ease: "power2.inOut" }, 0.8)
          .to(back, { xPercent: 100, duration: 2, ease: "power2.inOut" }, 0.8)
          .to(hero, { yPercent: 0, autoAlpha: 1, duration: 1.6, ease: "power2.out" }, 1.5)
          .to(lines(story, "pick"), { yPercent: 0, duration: 0.8, stagger: 0.12 }, 2.8)
          .to(sides, { autoAlpha: 1, duration: 0.8 }, 2.9)
          .to(lines(story, "pick"), { yPercent: -115, duration: 0.6, stagger: 0.08 }, 4.4)
          .to(sides, { autoAlpha: 0, duration: 0.7 }, 4.5)
          .to(lines(story, "hood"), { yPercent: 0, duration: 0.8, stagger: 0.12 }, 5)
          .to(unify, { autoAlpha: 1, duration: 1 }, 5.1)
          .to(lines(story, "hood"), { yPercent: -115, duration: 0.6, stagger: 0.08 }, 6.8)
          .to(hero, { scale: 0.92, duration: 1.6 }, 7)
          .to(front, { xPercent: 0, duration: 1.8, ease: "power2.inOut" }, 7.1)
          .to(back, { xPercent: 0, duration: 1.8, ease: "power2.inOut" }, 7.1)
          .to(lines(story, "close"), { yPercent: 0, duration: 0.8, stagger: 0.1 }, 8.6)
          .to(q(story, "[data-name]"), { autoAlpha: 1, y: 0, duration: 0.6 }, 9.2)
          .to({}, { duration: 0.6 });
      }

      /* ── horizontal strips: the street and the engine room ─────────── */
      const strip = (section: HTMLElement, onMove: (x: number, dist: number) => void) => {
        const track = q(section, "[data-track]")!;
        const dist = () => Math.max(0, track.scrollWidth - innerWidth);
        gsap.to(track, {
          x: () => -dist(),
          ease: "none",
          onUpdate() {
            onMove(gsap.getProperty(track, "x") as number, dist());
          },
          scrollTrigger: {
            trigger: section,
            start: "top top",
            end: () => `+=${dist()}`,
            pin: true,
            scrub: 0.6,
            invalidateOnRefresh: true,
          },
        });
      };

      const street = q(el, "[data-street]");
      if (street) {
        const shops = qa(street, "[data-shop]");
        const counter = q(street, "[data-open]");
        const runner = q(street, "[data-runner]");
        const layers = qa(street, "[data-depth]").map((n) => ({ n, d: parseFloat(n.dataset.depth!) }));
        const nowTitle = q(street, "[data-now-title]");
        const nowLine = q(street, "[data-now-line]");
        let active = 0;
        shops[0]?.classList.add("is-active");
        const serve = contextSafe!((i: number) => {
          shops[active]?.classList.remove("is-active");
          shops[i].classList.add("is-active");
          active = i;
          if (nowTitle) gsap.to(nowTitle, { duration: 0.6, scrambleText: { text: shops[i].dataset.title ?? "", chars: "upperCase", speed: 0.8 }, overwrite: true });
          if (nowLine) gsap.to(nowLine, { duration: 1, scrambleText: { text: shops[i].dataset.tagline ?? "", chars: "lowerCase", speed: 1.2 }, overwrite: true });
        });
        strip(street, (x, dist) => {
          const p = dist ? -x / dist : 0;
          layers.forEach(({ n, d }) => gsap.set(n, { x: x * d }));
          // a stream of tokens runs the bus as you scroll
          if (runner) gsap.set(runner, { x: p * (innerWidth + runner.offsetWidth * 2) - runner.offsetWidth * 1.5 });
          // the unit nearest the centre of the screen is the one "serving"
          let best = 0;
          let gap = Infinity;
          shops.forEach((s, i) => {
            const d = Math.abs(s.offsetLeft + x + s.offsetWidth / 2 - innerWidth / 2);
            if (d < gap) [gap, best] = [d, i];
          });
          if (counter) counter.textContent = String(best + 1).padStart(2, "0");
          if (best !== active) serve(best);
        });
      }

      const factory = q(el, "[data-factory]");
      if (factory) {
        const crates = qa(factory, "[data-crate]");
        const shipped = q(factory, "[data-shipped]");
        const press = q(factory, "[data-press]");
        const head = press && q(press, "[data-press-head]");
        const layers = qa(factory, "[data-depth]").map((n) => ({ n, d: parseFloat(n.dataset.depth!) }));
        const stamp = contextSafe!(() => {
          if (!head) return;
          gsap.timeline().to(head, { y: "1.6svh", duration: 0.09, ease: "power2.in" }).to(head, { y: 0, duration: 0.45, ease: "elastic.out(1,.5)" });
          gsap.fromTo(qa(press!, "[data-spark]"), { scale: 0, autoAlpha: 1, x: 0, y: 0 }, {
            scale: 1,
            autoAlpha: 0,
            x: () => gsap.utils.random(-70, 70),
            y: () => gsap.utils.random(-40, 10),
            duration: 0.6,
            ease: "power2.out",
          });
        });
        // the readout at the top names the last crate stamped
        const hud = q(factory, "[data-hud]");
        const hudName = q(factory, "[data-hud-name]");
        const hudDesc = q(factory, "[data-hud-desc]");
        const hudBar = q(factory, "[data-hud-bar]");
        gsap.set(hud, { autoAlpha: 0, y: -16 });
        gsap.set(hudBar, { scaleX: 0 });
        let last = 0;
        const readout = contextSafe!((done: number) => {
          gsap.to(hud, { autoAlpha: done ? 1 : 0, y: done ? 0 : -16, duration: 0.5, ease: "expo.out", overwrite: "auto" });
          gsap.to(hudBar, { scaleX: done / crates.length, duration: 0.6, ease: "expo.out" });
          const c = crates[done - 1];
          if (!c) return;
          if (hudName) gsap.to(hudName, { duration: 0.6, scrambleText: { text: c.dataset.name ?? "", chars: "lowerCase", speed: 0.9 }, overwrite: true });
          if (hudDesc) hudDesc.textContent = c.dataset.desc ?? "";
        });
        strip(factory, (x) => {
          layers.forEach(({ n, d }) => gsap.set(n, { x: x * d }));
          factory.style.setProperty("--travel", `${x}px`);
          factory.style.setProperty("--spin", String(-x * 0.9));
          const line = innerWidth / 2;
          let done = 0;
          crates.forEach((c) => {
            const now = c.offsetLeft + x + c.offsetWidth / 2 < line;
            if (now) done++;
            if (now !== c.classList.contains("is-done")) {
              c.classList.toggle("is-done", now);
              if (now) stamp();
            }
          });
          if (shipped) shipped.textContent = String(done).padStart(2, "0");
          if (done !== last) {
            last = done;
            readout(done);
          }
        });
      }

      /* ── finale: the halves close as it arrives ────────────────────── */
      const finale = q(el, "[data-finale]");
      if (finale) {
        const scrub = { trigger: finale, start: "top 95%", end: "top 15%", scrub: 0.6 };
        gsap.fromTo(q(finale, '[data-half="front"]'), { xPercent: -100 }, { xPercent: 0, ease: "power2.out", scrollTrigger: scrub });
        gsap.fromTo(q(finale, '[data-half="back"]'), { xPercent: 100 }, { xPercent: 0, ease: "power2.out", scrollTrigger: scrub });
        gsap.from(qa(finale, ".p-cap__line > span"), {
          yPercent: 115,
          duration: 1.1,
          stagger: 0.08,
          ease: "expo.out",
          scrollTrigger: { trigger: finale, start: "top 25%" },
        });
        gsap.from(q(finale, "[data-cta]"), { y: 40, autoAlpha: 0, duration: 1, ease: "expo.out", scrollTrigger: { trigger: finale, start: "top 20%" } });
      }

      /* ── fade-ups, counters, balance meter ─────────────────────────── */
      const ups = qa(el, "[data-reveal]");
      gsap.set(ups, { y: 40, autoAlpha: 0 });
      ScrollTrigger.batch(ups, {
        start: "top 90%",
        onEnter: (b) => gsap.to(b, { y: 0, autoAlpha: 1, duration: 1.1, stagger: 0.1, ease: "expo.out", overwrite: true }),
      });

      qa(el, "[data-count-to]").forEach((n) => {
        const target = n.dataset.countTo!;
        const to = parseInt(target, 10);
        const o = { v: 0 };
        gsap.to(o, {
          v: to,
          duration: 1.8,
          ease: "power3.out",
          scrollTrigger: { trigger: n, start: "top 92%" },
          onUpdate: () => void (n.textContent = String(Math.round(o.v)).padStart(target.length, "0")),
        });
      });

      const balance = q(el, "[data-balance]");
      if (balance)
        gsap.fromTo(balance, { left: "6%" }, { left: "50%", duration: 2.4, ease: "elastic.out(1,.35)", scrollTrigger: { trigger: balance, start: "top 92%" } });

      /* ── magnetic buttons ──────────────────────────────────────────── */
      const cleanups: (() => void)[] = [];
      if (fine)
        qa(el, "[data-magnetic]").forEach((b) => {
          const mx = gsap.quickTo(b, "x", { duration: 0.6, ease: "power3" });
          const my = gsap.quickTo(b, "y", { duration: 0.6, ease: "power3" });
          const move = (e: PointerEvent) => {
            const r = b.getBoundingClientRect();
            mx((e.clientX - r.left - r.width / 2) * 0.3);
            my((e.clientY - r.top - r.height / 2) * 0.4);
          };
          const leave = () => {
            mx(0);
            my(0);
          };
          b.addEventListener("pointermove", move);
          b.addEventListener("pointerleave", leave);
          cleanups.push(() => {
            b.removeEventListener("pointermove", move);
            b.removeEventListener("pointerleave", leave);
          });
        });

      /* ── hero devices tilt toward the pointer ───────────────────────── */
      const devices = story ? qa(story, "[data-device]") : [];
      if (fine && devices.length) {
        gsap.set(devices, { transformPerspective: 1100 });
        const ry = devices.map((d) => gsap.quickTo(d, "rotationY", { duration: 0.9, ease: "power3" }));
        const rx = devices.map((d) => gsap.quickTo(d, "rotationX", { duration: 0.9, ease: "power3" }));
        const tilt = (e: PointerEvent) => {
          const nx = e.clientX / innerWidth - 0.5;
          const ny = e.clientY / innerHeight - 0.5;
          ry.forEach((f) => f(nx * 12));
          rx.forEach((f) => f(-ny * 9));
        };
        addEventListener("pointermove", tilt, { passive: true });
        cleanups.push(() => removeEventListener("pointermove", tilt));
      }

      /* ── tickers: drift on their own, rush and lean with the scroll ── */
      qa(el, "[data-marquee]").forEach((m) => {
        const track = q(m, "[data-marquee-track]")!;
        const rev = m.hasAttribute("data-reverse");
        const loop = gsap.fromTo(track, { xPercent: rev ? -50 : 0 }, { xPercent: rev ? 0 : -50, duration: 42, ease: "none", repeat: -1 });
        const skew = gsap.quickTo(track, "skewX", { duration: 0.5, ease: "power3" });
        ScrollTrigger.create({
          trigger: m,
          start: "top bottom",
          end: "bottom top",
          onUpdate: (self) => {
            const v = self.getVelocity();
            loop.timeScale(self.direction * (1 + Math.min(Math.abs(v) / 250, 7)));
            gsap.to(loop, { timeScale: self.direction, duration: 1.4, ease: "power2.out", overwrite: true });
            skew(gsap.utils.clamp(-8, 8, -v / 220));
            gsap.delayedCall(0.15, () => skew(0));
          },
        });
      });

      /* ── the process: a line draws through four steps ──────────────── */
      const proc = q(el, "[data-process]");
      if (proc) {
        const steps = qa(proc, "[data-step]");
        gsap.fromTo(
          q(proc, "[data-process-line]"),
          { scaleX: 0 },
          {
            scaleX: 1,
            ease: "none",
            scrollTrigger: {
              trigger: proc,
              start: "top 75%",
              end: "bottom 70%",
              scrub: 0.6,
              onUpdate: (s) => steps.forEach((st, i) => st.classList.toggle("is-on", s.progress >= i / steps.length + 0.04)),
            },
          },
        );
        gsap.fromTo(
          steps,
          { y: 50, autoAlpha: 0 },
          { y: 0, autoAlpha: 1, duration: 1.1, stagger: 0.12, ease: "expo.out", scrollTrigger: { trigger: proc, start: "top 80%" } },
        );
      }

      /* ── kickers decode as they arrive; the map opens like a shutter ── */
      qa(el, ".p-kicker span").forEach((k) => {
        const strip = k.closest("[data-street], [data-factory]");
        gsap.to(k, {
          duration: 1.2,
          scrambleText: { text: k.textContent ?? "", chars: "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789", speed: 0.6 },
          scrollTrigger: { trigger: strip ?? k, start: strip ? "top 60%" : "top 92%" },
        });
      });
      const map = q(el, ".p-map__frame");
      if (map)
        gsap.fromTo(
          map,
          { clipPath: "inset(0% 0% 100% 0% round 12px)" },
          { clipPath: "inset(0% 0% 0% 0% round 12px)", duration: 1.6, ease: "expo.out", scrollTrigger: { trigger: map, start: "top 85%" } },
        );

      /* ── type: titles by character, the lead word by word ──────────── */
      const splits: SplitText[] = [];
      const setType = contextSafe!(() => {
        qa(el, "[data-chars]").forEach((t) => {
          const strip = t.closest("[data-street], [data-factory]");
          const s = SplitText.create(t, { type: "lines,words,chars", mask: "lines", linesClass: "p-split-line" });
          splits.push(s);
          gsap.from(s.chars, {
            yPercent: 115,
            duration: 1,
            stagger: 0.016,
            ease: "expo.out",
            scrollTrigger: { trigger: strip ?? t, start: strip ? "top 55%" : "top 88%" },
          });
        });
        qa(el, "[data-words]").forEach((t) => {
          const s = SplitText.create(t, { type: "words" });
          splits.push(s);
          gsap.fromTo(s.words, { opacity: 0.16 }, { opacity: 1, stagger: 0.1, ease: "none", scrollTrigger: { trigger: t, start: "top 82%", end: "bottom 55%", scrub: true } });
        });
        ScrollTrigger.refresh();
        // a deep link (/lite#about) lands where the pins put it, not where the browser guessed
        const target = location.hash && document.getElementById(location.hash.slice(1));
        if (target && lenis) lenis.scrollTo(target, { immediate: true, force: true });
        else if (target) target.scrollIntoView();
      });
      let live = true;
      document.fonts.ready.then(() => live && setType());

      return () => {
        live = false;
        document.removeEventListener("click", onClick);
        shake?.destroy();
        ScrollTrigger.removeEventListener("refresh", reflow);
        if (rope) gsap.ticker.remove(rope.render);
        gsap.ticker.remove(watch);
        cleanups.forEach((c) => c());
        splits.forEach((s) => s.revert());
        el.classList.remove("is-driven");
      };
    },
    { scope: root },
  );

  return (
    <div ref={root} className={`paper ${className}`}>
      {children}
    </div>
  );
}
