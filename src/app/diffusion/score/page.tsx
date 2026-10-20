import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import View from "@/diffusion/View";

// the lab's own type: a neutral grotesk for the interface, its mono for every figure
const sans = Geist({ variable: "--font-lab-sans", subsets: ["latin"] });
const mono = Geist_Mono({ variable: "--font-lab-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Score-field lab",
  description:
    "A real diffusion model sampler in 3-D: thousands of samples denoised from Gaussian noise into a prompt's shape with the exact score, DDPM, DDIM and DPM-Solver++ samplers, classifier-free guidance and three noise schedules.",
};

export default function ScoreLabPage() {
  return (
    <div className={`${sans.variable} ${mono.variable}`}>
      <View />
    </div>
  );
}
