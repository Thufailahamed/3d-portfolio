"use client";

import { Bloom, EffectComposer, ToneMapping, Vignette } from "@react-three/postprocessing";
import { useFrame } from "@react-three/fiber";
import { BloomEffect, ToneMappingMode } from "postprocessing";
import { useRef } from "react";
import { sceneState } from "@/lib/sceneState";

export default function PostFX() {
  const bloom = useRef<BloomEffect>(null);
  // daylight would bloom everywhere: raise the threshold and soften the glow
  useFrame(() => {
    const b = bloom.current;
    if (!b) return;
    const day = sceneState.weather.day;
    b.intensity = 0.9 * (1 - 0.55 * day);
    b.luminanceMaterial.threshold = 0.62 + 0.3 * day;
  });
  return (
    <EffectComposer multisampling={0}>
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
      <Vignette offset={0.28} darkness={0.75} />
    </EffectComposer>
  );
}
