import type { Metadata } from "next";
import { IBM_Plex_Mono, IBM_Plex_Sans, Instrument_Serif, Newsreader } from "next/font/google";
import View from "@/diffusion/pipeline/View";

// a display serif for titles, a reading serif for the explanations, Plex Sans for the interface, Plex Mono for every number and shape
const display = Instrument_Serif({ variable: "--font-dl-display", subsets: ["latin"], weight: "400", style: ["normal", "italic"] });
const serif = Newsreader({ variable: "--font-dl-serif", subsets: ["latin"], style: ["normal", "italic"] });
const sans = IBM_Plex_Sans({ variable: "--font-dl-sans", subsets: ["latin"], weight: ["400", "500", "600"] });
const mono = IBM_Plex_Mono({ variable: "--font-dl-mono", subsets: ["latin"], weight: ["400", "500"] });

export const metadata: Metadata = {
  title: "Stable Diffusion, end to end",
  description:
    "Stable Diffusion 1.5's text-to-image pipeline in 3-D at its real shapes: CLIP tokenization, the text encoder, the U-Net denoising loop with classifier-free guidance and DDIM / DPM-Solver++ / DDPM sampling, and TAESD's real decoder running in WebGL.",
};

export default function DiffusionPage() {
  return (
    <div className={`${display.variable} ${serif.variable} ${sans.variable} ${mono.variable}`}>
      <View />
    </div>
  );
}
