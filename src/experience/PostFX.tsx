"use client";

import { Bloom, EffectComposer, ToneMapping, Vignette } from "@react-three/postprocessing";
import { ToneMappingMode } from "postprocessing";
import { useThree } from "@react-three/fiber";
import { useApp } from "@/store/useApp";

export default function PostFX() {
  return (
    <EffectComposer multisampling={0}>
      <Bloom
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
