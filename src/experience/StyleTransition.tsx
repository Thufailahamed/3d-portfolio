"use client";

import { useFrame, useThree } from "@react-three/fiber";
import { BlendFunction, Effect, EffectAttribute } from "postprocessing";
import { useEffect, useMemo } from "react";
import * as THREE from "three";
import { FLOW_ORIGIN } from "@/lib/chapters";

/**
 * X-ray ⇄ realistic transition for the /flow pavilion.
 *
 * The two looks are a hard material swap spread over many components, so the transition lives in
 * post-processing: the frame on screen just before the swap is copied, the swap happens, and then a
 * scan front sweeps out from the camera through the real depth of the scene. Behind it the new look
 * develops; at it, a glowing band traces a 1 m construction grid on every surface it crosses; ahead
 * of it the old frame holds. The sky turns over last.
 */

const fragment = /* glsl */ `
  uniform sampler2D tPrev;
  uniform float uActive;
  uniform float uFade;
  uniform float uFront;
  uniform float uWidth;
  uniform float uMaxDist;
  uniform float uToReal;
  uniform vec2 uTan;
  uniform mat4 uCamWorld;

  float hash3(vec3 p) {
    p = fract(p * 0.3183099 + 0.1);
    p *= 17.0;
    return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
  }
  float noise3(vec3 x) {
    vec3 i = floor(x);
    vec3 f = fract(x);
    f = f * f * (3.0 - 2.0 * f);
    return mix(
      mix(mix(hash3(i), hash3(i + vec3(1, 0, 0)), f.x), mix(hash3(i + vec3(0, 1, 0)), hash3(i + vec3(1, 1, 0)), f.x), f.y),
      mix(mix(hash3(i + vec3(0, 0, 1)), hash3(i + vec3(1, 0, 1)), f.x), mix(hash3(i + vec3(0, 1, 1)), hash3(i + vec3(1, 1, 1)), f.x), f.y),
      f.z);
  }
  vec3 decodeSRGB(vec3 c) {
    return mix(c / 12.92, pow((c + 0.055) / 1.055, vec3(2.4)), step(0.04045, c));
  }

  void mainImage(const in vec4 inputColor, const in vec2 uv, const in float depth, out vec4 outputColor) {
    if (uActive < 0.5) {
      outputColor = inputColor;
      return;
    }
    // the captured frame is the screen's encoded output; the chain works in linear
    vec3 prev = decodeSRGB(texture2D(tPrev, uv).rgb);
    if (uFade >= 0.0) {
      outputColor = vec4(mix(prev, inputColor.rgb, uFade), inputColor.a);
      return;
    }

    bool sky = depth >= 0.99999;
    float viewZ = getViewZ(depth);
    vec3 viewPos = vec3((uv * 2.0 - 1.0) * uTan, -1.0) * (-viewZ);
    vec3 world = (uCamWorld * vec4(viewPos, 1.0)).xyz;
    vec3 accent = uToReal > 0.5 ? vec3(0.78, 1.0, 0.24) : vec3(0.72, 0.84, 1.0);

    if (sky) {
      // open sky turns over as the front leaves the building behind
      float k = smoothstep(uMaxDist - uWidth * 2.0, uMaxDist + uWidth, uFront);
      outputColor = vec4(mix(prev, inputColor.rgb, k), inputColor.a);
      return;
    }

    // a ragged front: the scan breaks over surfaces unevenly instead of as a perfect sphere
    float dist = length(viewPos) + ((noise3(world * 0.55) - 0.5) * 0.8 + (noise3(world * 2.3) - 0.5) * 0.25) * uWidth;
    float s = dist - uFront;
    float revealed = 1.0 - smoothstep(-uWidth * 0.12, uWidth * 0.12, s);

    // just behind the front the new look is still developing from a flattened, cooled tone
    float dev = smoothstep(-uWidth * 2.6, -uWidth * 0.1, s) * revealed;
    float lum = dot(inputColor.rgb, vec3(0.2126, 0.7152, 0.0722));
    vec3 developing = mix(inputColor.rgb, vec3(lum) * vec3(0.55, 0.62, 0.7), 0.65 * dev);
    vec3 col = mix(prev, developing, revealed);

    // the band: a soft glow, a bright leading edge, and a 1 m construction grid traced on surfaces
    vec3 g = abs(fract(world + 0.5) - 0.5) / max(fwidth(world), vec3(1e-4));
    float grid = 1.0 - smoothstep(0.0, 1.4, min(min(g.x, g.y), g.z));
    float band = exp(-pow(s / (uWidth * 0.55), 2.0));
    float core = exp(-pow(s / (uWidth * 0.07), 2.0));
    float trail = band * grid * (1.0 - smoothstep(-uWidth * 0.2, uWidth * 0.6, s));
    col += accent * (band * 0.1 + trail * 0.55 + core * 1.1);

    outputColor = vec4(col, inputColor.a);
  }
`;

class StyleTransitionEffect extends Effect {
  constructor() {
    super("StyleTransitionEffect", fragment, {
      attributes: EffectAttribute.DEPTH,
      blendFunction: BlendFunction.NORMAL,
      uniforms: new Map<string, THREE.Uniform>([
        ["tPrev", new THREE.Uniform(null)],
        ["uActive", new THREE.Uniform(0)],
        ["uFade", new THREE.Uniform(-1)],
        ["uFront", new THREE.Uniform(0)],
        ["uWidth", new THREE.Uniform(2)],
        ["uMaxDist", new THREE.Uniform(100)],
        ["uToReal", new THREE.Uniform(1)],
        ["uTan", new THREE.Uniform(new THREE.Vector2(1, 1))],
        ["uCamWorld", new THREE.Uniform(new THREE.Matrix4())],
      ]),
    });
  }
}

// ---------------------------------------------------------------- swap requests

type Phase = "idle" | "hold" | "run";

const state = {
  queue: [] as { toReal: boolean; swap: () => void; timer: number }[],
  phase: "idle" as Phase,
  toReal: true,
  /** frames held on the captured frame while the swap lands */
  held: 0,
  /** bumped by the scene once the new materials are really on the meshes */
  applied: 0,
  appliedAtSwap: 0,
  t: 0,
  maxDist: 100,
  width: 2,
  /** whether a mounted, running transition can take requests (otherwise swap straight away) */
  mounted: false,
};

/**
 * Ask for the look to change. `swap` performs the actual change; it runs right after the current
 * frame has been captured, and the transition then plays over it. Returns a cancel function.
 */
export function requestStyleSwap(toReal: boolean, swap: () => void) {
  if (!state.mounted) {
    swap();
    return () => {};
  }
  // if no frame comes to capture it (hidden tab, composer off), swap anyway
  const entry = {
    toReal,
    swap,
    timer: window.setTimeout(() => {
      const i = state.queue.indexOf(entry);
      if (i >= 0) {
        state.queue.splice(i, 1);
        swap();
      }
    }, 400),
  };
  state.queue.push(entry);
  return () => {
    const i = state.queue.indexOf(entry);
    if (i >= 0) {
      window.clearTimeout(entry.timer);
      state.queue.splice(i, 1);
    }
  };
}

/** The scene calls this once the swapped materials are in place on the meshes. */
export function markStyleApplied() {
  state.applied++;
}

const SITE = new THREE.Vector3(FLOW_ORIGIN[0] + 2, FLOW_ORIGIN[1] + 3, FLOW_ORIGIN[2] - 14);
/** Fast out of the gate (the near ground fills most of the screen), settling as it reaches the far side. */
const sweep = (x: number) => 1 - Math.pow(1 - x, 2.4);

/** The transition effect for the EffectComposer chain (keep it last, after tone mapping). */
export default function StyleTransition() {
  const gl = useThree((s) => s.gl);
  const effect = useMemo(() => new StyleTransitionEffect(), []);
  const tmp = useMemo(() => ({ size: new THREE.Vector2(), tex: null as THREE.FramebufferTexture | null }), []);
  const reduced = useMemo(() => typeof window !== "undefined" && matchMedia("(prefers-reduced-motion: reduce)").matches, []);

  useEffect(() => {
    state.mounted = true;
    return () => {
      state.mounted = false;
      state.phase = "idle";
      for (const q of state.queue.splice(0)) {
        window.clearTimeout(q.timer);
        q.swap();
      }
      tmp.tex?.dispose();
      effect.dispose();
    };
  }, [effect, tmp]);

  // after the composer has drawn the frame (priority 1), so the canvas holds the finished image
  useFrame(({ camera }, dt) => {
    const u = effect.uniforms;

    if (state.queue.length) {
      // capture what is on screen now (mid-transition too: a new request picks up from there)
      gl.getDrawingBufferSize(tmp.size);
      const w = Math.max(1, Math.floor(tmp.size.x));
      const h = Math.max(1, Math.floor(tmp.size.y));
      if (!tmp.tex || tmp.tex.image.width !== w || tmp.tex.image.height !== h) {
        tmp.tex?.dispose();
        tmp.tex = new THREE.FramebufferTexture(w, h);
      }
      const prev = gl.getRenderTarget();
      gl.setRenderTarget(null);
      gl.copyFramebufferToTexture(tmp.tex);
      gl.setRenderTarget(prev);
      u.get("tPrev")!.value = tmp.tex;

      const reqs = state.queue.splice(0);
      const last = reqs[reqs.length - 1];
      state.toReal = last.toReal;
      state.appliedAtSwap = state.applied;
      for (const r of reqs) {
        window.clearTimeout(r.timer);
        r.swap();
      }

      // how far the front must travel: past the far side of the pavilion from where we stand
      const cam = camera.position;
      state.maxDist = Math.min((camera as THREE.PerspectiveCamera).far * 0.95 || 320, cam.distanceTo(SITE) + 46);
      state.width = THREE.MathUtils.clamp(state.maxDist * 0.028, 1.1, 4.5);
      state.phase = "hold";
      state.held = 0;
      state.t = 0;
      u.get("uActive")!.value = 1;
      u.get("uToReal")!.value = state.toReal ? 1 : 0;
      u.get("uFade")!.value = reduced ? 0 : -1;
      u.get("uFront")!.value = -state.width * 3;
      u.get("uMaxDist")!.value = state.maxDist;
      u.get("uWidth")!.value = state.width;
    }

    if (state.phase === "idle") return;

    // keep the depth reconstruction in step with the camera
    const pc = camera as THREE.PerspectiveCamera;
    const tan = Math.tan(THREE.MathUtils.degToRad(pc.fov ?? 50) / 2);
    u.get("uTan")!.value.set(tan * (pc.aspect ?? 1), tan);
    u.get("uCamWorld")!.value.copy(camera.matrixWorld);

    if (state.phase === "hold") {
      // stay on the captured frame until the new materials are drawn (a couple of frames)
      state.held++;
      const landed = state.applied !== state.appliedAtSwap;
      if ((landed && state.held >= 3) || state.held >= 30) {
        state.phase = "run";
        state.t = 0;
      }
      return;
    }

    const duration = reduced ? 0.35 : state.toReal ? 2.1 : 1.6;
    state.t = Math.min(1, state.t + Math.min(dt, 1 / 30) / duration);
    if (reduced) {
      u.get("uFade")!.value = state.t;
    } else {
      const span = state.maxDist + state.width * 4;
      u.get("uFront")!.value = -state.width * 2 + sweep(state.t) * span;
    }
    if (state.t >= 1) {
      state.phase = "idle";
      u.get("uActive")!.value = 0;
    }
  }, 2);

  return <primitive object={effect} dispose={null} />;
}
