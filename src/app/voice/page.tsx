import type { Metadata } from "next";
import { Archivo, IBM_Plex_Mono, IBM_Plex_Sans, Newsreader } from "next/font/google";
import View from "@/voice/View";

// the studio's type: an expanded grotesque for titles, a reading serif for the explanations, Plex Sans for the interface, Plex Mono for every number
const display = Archivo({ variable: "--font-vx-display", subsets: ["latin"], axes: ["wdth"] });
const serif = Newsreader({ variable: "--font-dl-serif", subsets: ["latin"], style: ["normal", "italic"] });
const sans = IBM_Plex_Sans({ variable: "--font-dl-sans", subsets: ["latin"], weight: ["400", "500", "600"] });
const mono = IBM_Plex_Mono({ variable: "--font-dl-mono", subsets: ["latin"], weight: ["400", "500"] });

export const metadata: Metadata = {
  title: "Whisper, end to end",
  description:
    "Speech to text in 3-D, computed in the browser: a likelihood-ratio voice detector on the microphone, Whisper's exact log-mel front end, and OpenAI's real Whisper tiny.en encoder and decoder running as WebGL shaders, down to word timestamps.",
};

export default function VoicePage() {
  return (
    <div className={`${display.variable} ${serif.variable} ${sans.variable} ${mono.variable}`}>
      <View />
    </div>
  );
}
