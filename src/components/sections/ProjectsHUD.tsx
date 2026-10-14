"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { projects } from "@/content/site";
import { chapterScroll } from "@/lib/chapters";
import { gsap, Observer, ScrollTrigger, useGSAP } from "@/lib/gsap";
import { sceneState } from "@/lib/sceneState";
import { useApp } from "@/store/useApp";

const pad = (n: number) => String(n).padStart(2, "0");
const CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";

/**
 * Carousel controls layered over the prism: drag / swipe / arrow keys / buttons
 * switch the project; "Discover" dives the camera into the prism and opens the page.
 */
export default function ProjectsHUD() {
  const root = useRef<HTMLDivElement>(null);
  const dragLayer = useRef<HTMLDivElement>(null);
  const title = useRef<HTMLHeadingElement>(null);
  const router = useRouter();
  const index = useApp((s) => s.activeProject);
  const [active, setActive] = useState(false);
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
    const obs = Observer.create({
      target: dragLayer.current,
      type: "pointer,touch",
      dragMinimum: 6,
      lockAxis: true,
      onPress: (self) => {
        startX = self.x ?? 0;
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
    return () => {
      obs.kill();
      removeEventListener("keydown", onKey);
    };
  }, [active]);

  const discover = (e: React.MouseEvent<HTMLAnchorElement>) => {
    if (e.metaKey || e.ctrlKey || matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    e.preventDefault();
    const href = `/projects/${project.slug}`;
    gsap.to(root.current, { autoAlpha: 0, duration: 0.4 });
    gsap.to(sceneState, {
      dive: 1,
      duration: 1.1,
      ease: "power3.in",
      onComplete: () => router.push(href),
    });
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
        ← Drag to switch project →
      </p>

      <div className="pointer-events-none absolute inset-x-0 bottom-0 flex items-end justify-between gap-6 px-gutter pb-8 md:pb-10">
        <div className="pointer-events-auto max-w-[min(42rem,70vw)]" aria-live="polite">
          <p className="hud-meta label mb-2">
            {project.year} — {project.role}
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
