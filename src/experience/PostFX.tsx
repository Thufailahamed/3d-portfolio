"use client";

import { Bloom, EffectComposer, ToneMapping, Vignette } from "@react-three/postprocessing";
import { ToneMappingMode } from "postprocessing";
import { useThree } from "@react-three/fiber";
import { useApp } from "@/store/useApp";

export default function PostFX() {
  const quality = useApp((s) => s.quality);
  const isMobile = useApp((s) => s.isMobile);
  const low = quality === "low" || isMobile;
  // MSAA is ~4× the fill cost; above ~1.4× pixel ratio the edges are already fine without it
  const dpr = useThree((s) => s.viewport.dpr);
  const msaa = low || dpr >= 1.4 ? 0 : 4;

  return (
    <EffectComposer multisampling={msaa}>
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
