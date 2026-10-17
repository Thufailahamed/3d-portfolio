"use client";

import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import * as THREE from "three";
import { fullscreenVert, postFrag, universeFrag } from "@/experience/shaders/multiverse";
import { gsap } from "@/lib/gsap";
import { sceneState } from "@/lib/sceneState";
import { multiverseCue } from "@/lib/sound";
import { useApp } from "@/store/useApp";
import { lenis } from "./SmoothScroll";

/** The worlds we fall through, in order, and how long each holds the screen (s). */
const WORLDS = [
  { u: 0, d: 1.0, name: "The threshold" },
  { u: 1, d: 1.6, name: "Earth-838 · the mirror city" },
  { u: 2, d: 1.25, name: "Earth-1889 · oil on canvas" },
  { u: 3, d: 1.5, name: "Earth-7144 · the infinite" },
  { u: 4, d: 1.1, name: "Earth-65 · ink and colour" },
  { u: 5, d: 1.0, name: "Earth-2149 · shattered" },
  { u: 6, d: 1.3, name: "Earth-41 · alive" },
  { u: 7, d: 1.5, name: "Earth-0 · the far edge" },
  { u: 0, d: 1.0, name: "Earth-616 · home" },
];
/** How long each ring takes to open over the screen (s). */
const RING = 0.5;
const SEQ = WORLDS.reduce((s, w) => s + w.d, 0);
/** When, after the click, the doorway opens onto the first world (s). */
const ENTER_AT = 1.2;

let start: (() => void) | null = null;
/** Fall through the contact arch (no-op unless the overlay is mounted and idle). */
export const openMultiverse = () => start?.();

/**
 * The multiverse fall. Its own small WebGL canvas over everything, kept warm (shaders compiled)
 * while the contact chapter is on screen, so the click answers at once: the camera rushes the
 * doorway, the doorway opens, and we drop through world after world before landing back in the
 * clearing.
 */
export default function Multiverse({ onTravel }: { onTravel: (on: boolean) => void }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const wrap = useRef<HTMLDivElement>(null);
  const label = useRef<HTMLSpanElement>(null);
  const count = useRef<HTMLSpanElement>(null);
  const hud = useRef<HTMLDivElement>(null);
  const skip = useRef<() => void>(() => {});
  const travel = useRef(onTravel);
  useEffect(() => {
    travel.current = onTravel;
  }, [onTravel]);

  useEffect(() => {
    const box = wrap.current;
    if (!box) return;
    // a fresh canvas each time: a context, once lost, never comes back on the same element
    const el = document.createElement("canvas");
    el.setAttribute("aria-hidden", "true");
    el.className = "absolute inset-0 h-full w-full";
    box.prepend(el);
    canvas.current = el;
    const isMobile = useApp.getState().isMobile;
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ canvas: el, alpha: true, premultipliedAlpha: true, antialias: false, powerPreference: "high-performance" });
    } catch {
      // no second WebGL context to be had: the arch simply stays an arch
      el.remove();
      return;
    }
    renderer.setClearColor(0x000000, 0);
    const half = renderer.extensions.has("EXT_color_buffer_float");
    const rt = new THREE.WebGLRenderTarget(4, 4, {
      type: half ? THREE.HalfFloatType : THREE.UnsignedByteType,
      generateMipmaps: true,
      minFilter: THREE.LinearMipmapLinearFilter,
      magFilter: THREE.LinearFilter,
      depthBuffer: false,
    });

    const worlds = new THREE.ShaderMaterial({
      vertexShader: fullscreenVert,
      fragmentShader: universeFrag,
      depthTest: false,
      depthWrite: false,
      uniforms: {
        uRes: { value: new THREE.Vector2(4, 4) },
        uA: { value: 0 },
        uB: { value: 0 },
        uTA: { value: 0 },
        uTB: { value: 0 },
        uRing: { value: 0 },
        uEntry: { value: 0 },
        uExit: { value: 0 },
        uDoor: { value: new THREE.Vector2() },
        uTime: { value: 0 },
        uSteps: { value: isMobile ? 0.6 : 1 },
      },
    });
    const post = new THREE.ShaderMaterial({
      vertexShader: fullscreenVert,
      fragmentShader: postFrag,
      depthTest: false,
      depthWrite: false,
      transparent: true,
      blending: THREE.NoBlending,
      uniforms: {
        tScene: { value: rt.texture },
        uRes: { value: new THREE.Vector2(4, 4) },
        uBlur: { value: 0 },
        uSplit: { value: 0 },
        uFlash: { value: 0 },
        uTime: { value: 0 },
        uBloom: { value: 0.55 },
      },
    });
    const scene = new THREE.Scene();
    const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), worlds);
    quad.frustumCulled = false;
    scene.add(quad);

    // the worlds render below screen resolution (they are raymarched); the fall's blur hides it
    let scale = isMobile ? 0.42 : 0.6;
    const resize = () => {
      const dpr = Math.min(devicePixelRatio || 1, 1.5);
      renderer.setPixelRatio(Math.min(dpr, 1.25));
      renderer.setSize(innerWidth, innerHeight, false);
      const w = Math.max(64, Math.round(innerWidth * dpr * scale));
      const h = Math.max(64, Math.round(innerHeight * dpr * scale));
      rt.setSize(w, h);
      worlds.uniforms.uRes.value.set(w, h);
      post.uniforms.uRes.value.set(innerWidth, innerHeight);
    };
    resize();
    addEventListener("resize", resize);

    const draw = () => {
      quad.material = worlds;
      renderer.setRenderTarget(rt);
      renderer.render(scene, cam);
      quad.material = post;
      renderer.setRenderTarget(null);
      renderer.render(scene, cam);
    };

    // compile now (in parallel where the driver allows), then draw once so the first real frame is cheap
    const ready = (async () => {
      try {
        // each with the target it draws into (three builds a different program for a render target)
        quad.material = worlds;
        renderer.setRenderTarget(rt);
        await renderer.compileAsync(scene, cam);
        quad.material = post;
        renderer.setRenderTarget(null);
        await renderer.compileAsync(scene, cam);
      } catch {
        /* the draw below compiles synchronously instead */
      }
      draw();
    })();

    // the timeline's state, read by the render loop
    const st = { seq: 0, entry: 0, exit: 0, flash: 0, kick: 0 };
    let playing = false;
    let raf = 0;
    let last = 0;
    let world = -1;
    let jumped = -1;
    const perf = { acc: 0, n: 0 };
    let tl: gsap.core.Timeline | null = null;

    const setLabel = (i: number) => {
      if (!label.current || !count.current) return;
      label.current.textContent = WORLDS[i].name;
      count.current.textContent = `${String(i + 1).padStart(2, "0")} / ${String(WORLDS.length).padStart(2, "0")}`;
      gsap.fromTo(label.current, { opacity: 0, letterSpacing: "0.5em" }, { opacity: 1, letterSpacing: "0.22em", duration: 0.5, ease: "expo.out" });
    };

    const frame = (now: number) => {
      raf = requestAnimationFrame(frame);
      const dt = Math.min(0.1, last ? (now - last) / 1000 : 0.016);
      last = now;
      const u = worlds.uniforms;
      u.uTime.value += dt;
      post.uniforms.uTime.value = u.uTime.value;

      // which world holds the screen, and is the next one tearing open?
      const s = Math.min(st.seq, SEQ - 1e-4);
      let i = 0;
      let acc = 0;
      while (i < WORLDS.length - 1 && s >= acc + WORLDS[i].d) {
        acc += WORLDS[i].d;
        i++;
      }
      const end = acc + WORLDS[i].d;
      // each world's clock starts as its ring opens, so it is already moving when it arrives
      u.uA.value = WORLDS[i].u;
      u.uTA.value = s - acc + (i > 0 ? RING : 0);
      let ring = 0;
      if (i < WORLDS.length - 1 && s > end - RING) {
        ring = (s - (end - RING)) / RING;
        u.uB.value = WORLDS[i + 1].u;
        u.uTB.value = s - (end - RING);
        if (jumped !== i && st.entry >= 1) {
          jumped = i;
          multiverseCue("jump");
        }
      }
      u.uRing.value = ring;
      const shown = ring > 0.55 ? i + 1 : i;
      if (shown !== world && st.entry > 0.3) {
        world = shown;
        setLabel(shown);
      }
      u.uEntry.value = st.entry;
      u.uExit.value = st.exit;
      u.uDoor.value.set(sceneState.portal.screen.x * 0.5 * (innerWidth / innerHeight), sceneState.portal.screen.y * 0.5);

      // the fall: the blur and the colour split surge as each ring passes over us
      const surge = Math.sin(Math.PI * ring);
      post.uniforms.uBlur.value = 0.1 + 0.5 * surge + st.kick;
      post.uniforms.uSplit.value = 0.004 + 0.022 * surge + st.kick * 0.05;
      post.uniforms.uFlash.value = st.flash;
      draw();

      // too slow? draw the worlds smaller
      if (st.entry >= 1 && st.exit === 0) {
        perf.acc += dt;
        perf.n++;
        if (perf.n === 40) {
          if (perf.acc / perf.n > 0.026 && scale > 0.3) {
            scale *= 0.8;
            resize();
          }
          perf.acc = 0;
          perf.n = 0;
        }
      }
    };

    const finish = () => {
      playing = false;
      cancelAnimationFrame(raf);
      tl?.kill();
      tl = null;
      useApp.getState().set({ multiverseCover: false });
      sceneState.portal.dive = 0;
      sceneState.portal.glow = 0;
      if (wrap.current) wrap.current.style.visibility = "hidden";
      renderer.setRenderTarget(null);
      renderer.clear();
      lenis?.start();
      travel.current(false);
    };

    start = () => {
      if (playing) return;
      if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
      playing = true;
      world = -1;
      jumped = -1;
      Object.assign(st, { seq: 0, entry: 0, exit: 0, flash: 0, kick: 0 });
      lenis?.stop();
      travel.current(true);
      multiverseCue("open");
      const portal = sceneState.portal;
      gsap.to(portal, { glow: 1, duration: 1.3, ease: "power2.in", overwrite: true });
      gsap.to(portal, { dive: 1, duration: 1.75, ease: "power3.in" });

      const t0 = performance.now();
      ready.then(() => {
        if (!playing) return;
        if (wrap.current) wrap.current.style.visibility = "visible";
        last = 0;
        raf = requestAnimationFrame(frame);
        const wait = Math.max(0, ENTER_AT - (performance.now() - t0) / 1000);
        const out = 0.85 + SEQ;
        tl = gsap
          .timeline({ delay: wait, onComplete: finish })
          // the doorway opens over the screen and swallows us
          .to(st, { entry: 1, duration: 0.75, ease: "power2.in" }, 0)
          .fromTo(st, { kick: 0.6 }, { kick: 0, duration: 1.2, ease: "power2.out" }, 0.55)
          .call(() => useApp.getState().set({ multiverseCover: true }), [], 0.8)
          .to(st, { seq: SEQ, duration: SEQ, ease: "none" }, 0.85)
          .addLabel("out", out - 0.45)
          // the clearing again: the canvas wakes, the camera is thrown back out of the doorway
          .call(() => useApp.getState().set({ multiverseCover: false }), [], "out")
          .call(() => multiverseCue("close"), [], out)
          .set(portal, { glow: 0.7 }, "out")
          .to(st, { exit: 1, duration: 1.1, ease: "power2.out" }, out)
          .fromTo(st, { kick: 0.5 }, { kick: 0, duration: 1.1, ease: "power2.out" }, out)
          .to(portal, { dive: 0, duration: 1.7, ease: "power3.out" }, out)
          .to(portal, { glow: 0, duration: 1.4, ease: "power2.out" }, out + 0.3)
          .call(() => travel.current(false), [], out + 0.5)
          // the label and the way out only while we are between worlds
          .fromTo(hud.current, { autoAlpha: 0 }, { autoAlpha: 1, duration: 0.5 }, 0.6)
          .to(hud.current, { autoAlpha: 0, duration: 0.4 }, "out");
      });
    };

    // skip ahead to the way home
    skip.current = () => {
      if (!tl) return;
      const at = tl.labels.out;
      if (tl.time() < at) {
        st.seq = SEQ;
        tl.seek(at, false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") skip.current();
    };
    addEventListener("keydown", onKey);

    return () => {
      if (playing) finish();
      start = null;
      removeEventListener("resize", resize);
      removeEventListener("keydown", onKey);
      // after any compile in flight has settled (it polls the programs it is building)
      ready.finally(() => {
        worlds.dispose();
        post.dispose();
        quad.geometry.dispose();
        rt.dispose();
        renderer.dispose();
        renderer.forceContextLoss();
        el.remove();
      });
    };
  }, []);

  // only mounted on the client, once the contact chapter is on screen
  if (typeof document === "undefined") return null;
  return createPortal(
    <div ref={wrap} className="pointer-events-none fixed inset-0 z-[80]" style={{ visibility: "hidden" }}>
      <div ref={hud} className="invisible absolute inset-x-0 bottom-0 flex items-end justify-between px-gutter pb-6 opacity-0 md:pb-8">
        <p className="flex flex-col gap-1.5">
          <span ref={count} className="label !text-[10px] !text-white/50" />
          <span ref={label} className="label !text-white [text-shadow:0_0_12px_rgba(0,0,0,0.8)]" />
        </p>
        <button type="button" onClick={() => skip.current()} className="contact-btn pointer-events-auto !text-white">
          Skip <span aria-hidden>esc</span>
        </button>
      </div>
    </div>,
    document.body,
  );
}
