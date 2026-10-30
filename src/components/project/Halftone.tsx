"use client";

import { useEffect, useRef } from "react";

const VERT = `attribute vec2 p; void main() { gl_Position = vec4(p, 0.0, 1.0); }`;

// A slow swoosh of light ribbons, printed as a halftone: each cell's dot grows with the light under it.
const FRAG = `
precision highp float;
uniform vec2 uRes;
uniform float uTime;
uniform float uCell;
uniform vec2 uMouse;
uniform float uFade;
uniform float uSeed;

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
}
float fbm(vec2 p) {
  float v = 0.0, a = 0.5;
  for (int i = 0; i < 4; i++) { v += a * noise(p); p *= 2.03; a *= 0.5; }
  return v;
}
mat2 rot(float a) { float c = cos(a), s = sin(a); return mat2(c, -s, s, c); }

float light(vec2 p) {
  float t = uTime * 0.12 + uSeed;
  vec2 q = rot(0.55 + 0.12 * sin(t * 0.7)) * p;
  // the ribbons bend through a slowly drifting warp
  float w = fbm(q * 1.3 + vec2(t * 0.6, -t * 0.4));
  float bend = q.y * q.y * 1.6 + w * 1.1;
  float phase = (q.x + bend) * 4.2 + t * 1.4;
  float band = abs(sin(phase));
  float ribbon = pow(1.0 - band, 9.0) * 1.25 + pow(1.0 - band, 3.0) * 0.18;
  // shading along each ribbon, so it reads as a turning surface
  ribbon *= 0.55 + 0.45 * sin(q.y * 4.0 - t * 2.0 + w * 3.0);
  // held inside a soft lens left of centre (pulled in on narrow screens), with a hot core
  float asp = uRes.x / uRes.y;
  vec2 m = p - vec2(-0.08 * min(1.0, asp / 1.6), 0.2);
  float r = length(m * vec2(0.95, 1.2));
  float lens = 1.0 - smoothstep(0.08, 0.62, r);
  ribbon *= 1.0 + 0.8 * (1.0 - smoothstep(0.0, 0.3, r));
  float v = ribbon * lens;
  // the pointer warms the dots it passes
  v += 0.55 * (1.0 - smoothstep(0.0, 0.32, length(p - uMouse))) * (0.4 + 0.6 * w);
  return clamp(v, 0.0, 1.0);
}

void main() {
  vec2 cell = floor(gl_FragCoord.xy / uCell);
  vec2 c = (cell + 0.5) * uCell;
  vec2 p = (c - 0.5 * uRes) / uRes.y;
  float v = light(p) * uFade;
  float r = sqrt(v) * 0.56 * uCell;
  float d = length(gl_FragCoord.xy - c);
  float a = (1.0 - smoothstep(r - 0.75, r + 0.35, d)) * step(0.035, v);
  gl_FragColor = vec4(a); // premultiplied white
}
`;

/** The hero's halftone light: a full-bleed WebGL canvas, paused while off screen. */
export default function Halftone({ seed = 0, className = "" }: { seed?: number; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // a fresh canvas per mount: a context lost in cleanup can't be reused (StrictMode mounts twice)
    const canvas = document.createElement("canvas");
    canvas.style.cssText = "position:absolute;inset:0;width:100%;height:100%";
    ref.current!.append(canvas);
    // premultiplied output: the shader writes vec4(a) for white at coverage a
    const gl = canvas.getContext("webgl", { alpha: true, antialias: false });
    if (!gl) return;

    const sh = (type: number, src: string) => {
      const s = gl.createShader(type)!;
      gl.shaderSource(s, src);
      gl.compileShader(s);
      return s;
    };
    const prog = gl.createProgram()!;
    gl.attachShader(prog, sh(gl.VERTEX_SHADER, VERT));
    gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, FRAG));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) return;
    gl.useProgram(prog);

    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(prog, "p");
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);

    const u = (n: string) => gl.getUniformLocation(prog, n);
    const uRes = u("uRes"), uTime = u("uTime"), uCell = u("uCell"), uMouse = u("uMouse"), uFade = u("uFade"), uSeed = u("uSeed");
    gl.uniform1f(uSeed, seed);

    const dpr = Math.min(devicePixelRatio, 1.5);
    const resize = () => {
      const { width, height } = canvas.getBoundingClientRect();
      canvas.width = Math.max(1, Math.round(width * dpr));
      canvas.height = Math.max(1, Math.round(height * dpr));
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.uniform2f(uRes, canvas.width, canvas.height);
      gl.uniform1f(uCell, Math.round((width < 768 ? 6 : 7.5) * dpr));
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);

    // the pointer, eased, in the shader's units
    const mouse = { x: 9, y: 9, tx: 9, ty: 9 };
    const onMove = (e: PointerEvent) => {
      const r = canvas.getBoundingClientRect();
      mouse.tx = (e.clientX - r.left - r.width / 2) / r.height;
      mouse.ty = -(e.clientY - r.top - r.height / 2) / r.height;
    };
    addEventListener("pointermove", onMove, { passive: true });

    const still = matchMedia("(prefers-reduced-motion: reduce)").matches;
    let visible = true;
    const io = new IntersectionObserver(([e]) => (visible = e.isIntersecting));
    io.observe(canvas);

    let raf = 0;
    let fade = 0;
    const t0 = performance.now();
    const frame = (now: number) => {
      raf = requestAnimationFrame(frame);
      if (!visible) return;
      fade = Math.min(1, fade + 0.012);
      mouse.x += (mouse.tx - mouse.x) * 0.06;
      mouse.y += (mouse.ty - mouse.y) * 0.06;
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.uniform1f(uTime, still ? 8 : (now - t0) / 1000);
      gl.uniform1f(uFade, still ? 1 : 1 - Math.pow(1 - fade, 3));
      gl.uniform2f(uMouse, mouse.x, mouse.y);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    };
    raf = requestAnimationFrame(frame);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      io.disconnect();
      removeEventListener("pointermove", onMove);
      gl.getExtension("WEBGL_lose_context")?.loseContext();
      canvas.remove();
    };
  }, [seed]);

  return <div ref={ref} aria-hidden className={className} />;
}
