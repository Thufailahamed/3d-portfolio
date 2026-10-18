import type { Metadata } from "next";
import View from "@/rover/View";

export const metadata: Metadata = {
  title: "Odyssey Rover",
  description:
    "Fly a Curiosity-class rover to any world in the Solar System — Hohmann transfer, atmospheric entry, parachute, sky-crane landing — then drive it with real gravity, air, dust and sound for each planet.",
};

export default function RoverPage() {
  return <View />;
}
