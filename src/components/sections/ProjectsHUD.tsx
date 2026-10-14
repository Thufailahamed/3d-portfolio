"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { projects } from "@/content/site";
import { chapterScroll } from "@/lib/chapters";
import { gsap, Observer, ScrollTrigger, useGSAP } from "@/lib/gsap";
import { sceneState } from "@/lib/sceneState";
import { useApp } from "@/store/useApp";
import { curtain } from "../Curtain";

const pad = (n: number) => String(n).padStart(2, "0");
const CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";

/**
 * Carousel controls layered over the prism: drag / swipe / arrow keys / buttons
 * switch the project; clicking the crystal (or "Discover") dives the camera into it and opens the page.
 */
export default function ProjectsHUD() {
  const root = useRef<HTMLDivElement>(null);
  const dragLayer = useRef<HTMLDivElement>(null);
  const title = useRef<HTMLHeadingElement>(null);
  const router = useRouter();
  const index = useApp((s) => s.activeProject);
  const [active, setActive] = useState(false);
  const entering = useRef(false);
  const enterRef = useRef(() => {});
  const isMobile = useApp((s) => s.isMobile);
  const project = projects[index];

  const go = (dir: number) => {
    const n = projects.length;
    const next = (useApp.getState().activeProject + dir + n) % n;
    useApp.getState().set({ activeProject: next });
  };

  // HUD is live only while the camera is settled on the prism
  useGSAP(() => {
    // undo the fade from a previous "Discover" dive if this page was restored from cache
    gsap.set(root.current, { clearProps: "opacity,visibility" });
    entering.current = false;
    const st = ScrollTrigger.create({
      ...chapterScroll("projects", 0.16, 0.88),
      onToggle: (self) => setActive(self.isActive),
    });
    return () => st.kill();
  });

  // title scramble + meta fade on every switch
  useGSAP(
    () => {
      if (!title.current) return;
      gsap.to(title.current, {
        duration: 0.9,
        scrambleText: { text: project.title.toUpperCase(), chars: CHARS, speed: 0.6, revealDelay: 0.2 },
        ease: "none",
      });
      gsap.fromTo(".hud-meta", { opacity: 0, y: 8 }, { opacity: 1, y: 0, duration: 0.6, stagger: 0.05, delay: 0.25 });
    },
    { scope: root, dependencies: [index] },
  );

  // drag / swipe: horizontal only, vertical scrolling stays native
  useEffect(() => {
    if (!active || !dragLayer.current) return;
    let startX = 0;
    let startY = 0;
    const layer = dragLayer.current;
    const obs = Observer.create({
      target: layer,
      type: "pointer,touch",
      dragMinimum: 6,
      lockAxis: true,
      onPress: (self) => {
        startX = self.x ?? 0;
        startY = self.y ?? 0;
      },
      // a tap (no drag) on the crystal enters the project
      onClick: (self) => {
        const x = self.x ?? 0;
        const y = self.y ?? 0;
        if (Math.hypot(x - startX, y - startY) > 8) return;
        if (sceneState.crystal.pick((x / innerWidth) * 2 - 1, -(y / innerHeight) * 2 + 1)) enterRef.current();
      },
      onDrag: (self) => {
        sceneState.drag = gsap.utils.clamp(-1, 1, ((self.x ?? 0) - startX) / (innerWidth * 0.4));
      },
      onRelease: (self) => {
        const dx = (self.x ?? 0) - startX;
        if (Math.abs(dx) > 60) go(dx < 0 ? 1 : -1);
        gsap.to(sceneState, { drag: 0, duration: 0.8, ease: "power3.out" });
      },
    });
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight") go(1);
      if (e.key === "ArrowLeft") go(-1);
    };
    addEventListener("keydown", onKey);

    // the cursor says "Enter" over the crystal
    let over = false;
    const watch = () => {
      if (sceneState.crystal.hover !== over) {
        over = sceneState.crystal.hover;
        layer.dataset.cursor = over ? "enter" : "drag";
        layer.style.cursor = over ? "pointer" : "";
        layer.dispatchEvent(new PointerEvent("pointerover", { bubbles: true }));
      }
    };
    gsap.ticker.add(watch);
    return () => {
      obs.kill();
      removeEventListener("keydown", onKey);
      gsap.ticker.remove(watch);
    };
  }, [active]);

  // camera pushes into the crystal, its light opens over the screen, the page swaps underneath
  const enter = () => {
    if (entering.current) return;
    const href = `/projects/${project.slug}`;
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) return router.push(href);
    entering.current = true;
    router.prefetch(href);
    gsap.to(root.current, { autoAlpha: 0, duration: 0.4 });
    gsap.to(sceneState, { dive: 1, duration: 1.3, ease: "power3.in" });
    gsap.delayedCall(0.75, () => {
      curtain
        .cover({ x: sceneState.crystal.x, y: sceneState.crystal.y, tint: project.tint, image: project.cover })
        .then(() => router.push(href));
    });
  };
  useEffect(() => {
    enterRef.current = enter;
  });

  const discover = (e: React.MouseEvent<HTMLAnchorElement>) => {
    if (e.metaKey || e.ctrlKey) return;
    e.preventDefault();
    enter();
  };

  return (
    <div
      ref={root}
      className={`fixed inset-0 z-20 transition-opacity duration-700 ${
        active ? "opacity-100" : "pointer-events-none invisible opacity-0"
      }`}
      role="region"
      aria-roledescription="carousel"
      aria-label="Selected projects"
    >
      <div
        ref={dragLayer}
        data-cursor="drag"
        className="absolute inset-0 cursor-grab touch-pan-y active:cursor-grabbing"
        aria-hidden
      />

      <p className="label pointer-events-none absolute left-1/2 top-[62svh] -translate-x-1/2 md:top-[70svh]">
        ← Drag to switch · {isMobile ? "tap" : "click"} the crystal to enter →
      </p>

      <div className="pointer-events-none absolute inset-x-0 bottom-0 flex items-end justify-between gap-6 px-gutter pb-8 md:pb-10">
        <div className="pointer-events-auto max-w-[min(42rem,70vw)]" aria-live="polite">
          <p className="hud-meta label mb-2">
            {project.category}
          </p>
          <h2 ref={title} className="display text-[11vw] md:text-[6.2vw]" aria-label={project.title}>
            {project.title.toUpperCase()}
          </h2>
          <p className="hud-meta mt-3 max-w-[38ch] text-sm text-fg/70 md:text-base">{project.tagline}</p>
          <Link
            href={`/projects/${project.slug}`}
            onClick={discover}
            data-cursor="view"
            className="hud-meta label mt-5 inline-flex items-center gap-2 !text-fg underline decoration-accent underline-offset-[6px] hover:text-accent"
          >
            Discover project ↘
          </Link>
        </div>

        <div className="pointer-events-auto flex flex-col items-end gap-3">
          <p className="display whitespace-nowrap text-[9vw] tabular-nums md:text-[3.4vw]">
            {pad(index + 1)}
            <span className="text-fg/35"> / {pad(projects.length)}</span>
          </p>
          <div className="flex gap-2">
            <button type="button" onClick={() => go(-1)} className="hud-btn" aria-label="Previous project">
              ←
            </button>
            <button type="button" onClick={() => go(1)} className="hud-btn label !text-fg">
              Next project →
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
