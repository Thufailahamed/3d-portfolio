"use client";

import { Bloom, EffectComposer, ToneMapping, Vignette } from "@react-three/postprocessing";
import { useFrame } from "@react-three/fiber";
import { BloomEffect, ToneMappingMode } from "postprocessing";
import { useRef } from "react";
import { sceneState } from "@/lib/sceneState";
import { useApp } from "@/store/useApp";
import { realState } from "./real/realState";
import StyleTransition from "./StyleTransition";

export default function PostFX() {
  const bloom = useRef<BloomEffect>(null);
  // the realistic pavilion only retunes values: changing the passes themselves would recompile the
  // post-processing shaders (SMAA's took seconds on Direct3D), so the chain stays the same
  const real = useApp((s) => s.flowRealLive && s.mode === "flow");
  // with the thermal binoculars fully raised nothing of the normal render is visible: skip it
  const thermalFull = useApp((s) => s.thermalFull);
  // daylight would bloom everywhere: raise the threshold and soften the glow
  useFrame(() => {
    const b = bloom.current;
    if (!b) return;
    if (real) {
      b.intensity = 0.55 + 0.35 * realState.night;
      b.luminanceMaterial.threshold = 0.95 + 1.1 * realState.day;
      return;
    }
    const day = Math.max(sceneState.weather.day, sceneState.valley.day);
    b.intensity = 0.9 * (1 - 0.55 * day);
    b.luminanceMaterial.threshold = 0.62 + 0.3 * day;
  });
  return (
    <EffectComposer multisampling={0} enabled={!thermalFull}>
      <Bloom
        ref={bloom}
        mipmapBlur
        intensity={0.9}
        luminanceThreshold={0.62}
        luminanceSmoothing={0.2}
        radius={0.72}
        // the mip-mapped blur hides the lower resolution; this pass was a large share of each frame
        resolutionScale={0.5}
      />
      <ToneMapping mode={ToneMappingMode.NEUTRAL} />
      <Vignette offset={0.28} darkness={real ? 0.45 : 0.75} />
      {/* X-ray ⇄ realistic sweep; last, so it blends finished frames */}
      <StyleTransition />
    </EffectComposer>
  );
}
