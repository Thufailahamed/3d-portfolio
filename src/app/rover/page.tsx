import type { Metadata } from "next";
import { Geist, IBM_Plex_Mono, Instrument_Serif } from "next/font/google";
import View from "@/rover/View";

// the rover's own type: a serif for world names, a neutral grotesk for the interface, Plex Mono for figures
const serif = Instrument_Serif({ variable: "--font-rover-serif", weight: "400", style: ["normal", "italic"], subsets: ["latin"] });
const sans = Geist({ variable: "--font-rover-sans", subsets: ["latin"] });
const plex = IBM_Plex_Mono({ variable: "--font-rover-mono", weight: ["400", "500"], subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Odyssey Rover",
  description:
    "Fly a Curiosity-class rover to any world in the Solar System — Hohmann transfer, atmospheric entry, parachute, sky-crane landing — then drive it with real gravity, air, dust and sound for each planet.",
};

export default function RoverPage() {
  return (
    <div className={`${serif.variable} ${sans.variable} ${plex.variable}`}>
      <View />
    </div>
  );
}
