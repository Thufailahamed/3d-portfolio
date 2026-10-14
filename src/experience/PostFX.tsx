"use client";

import { Bloom, EffectComposer, ToneMapping, Vignette } from "@react-three/postprocessing";
import { ToneMappingMode } from "postprocessing";
import { useApp } from "@/store/useApp";

export default function PostFX() {
  const quality = useApp((s) => s.quality);
  const isMobile = useApp((s) => s.isMobile);
  const low = quality === "low" || isMobile;

  return (
    <EffectComposer multisampling={low ? 0 : 4}>
      <Bloom
        mipmapBlur
        intensity={0.9}
        luminanceThreshold={0.62}
        luminanceSmoothing={0.2}
        radius={0.72}
        resolutionScale={low ? 0.5 : 1}
      />
      <ToneMapping mode={ToneMappingMode.NEUTRAL} />
      <Vignette offset={0.28} darkness={0.75} />
    </EffectComposer>
  );
}
