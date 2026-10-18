import type { Metadata } from "next";
import View from "@/hotwheels/View";

export const metadata: Metadata = {
  title: "Die-Cast Speedway",
  description:
    "A 1:64 die-cast stunt park on the living-room floor: spring launchers, loops, a ring-of-fire jump, a drag strip, a spiral tower and a figure-8 crash junction, all real-time physics with chase, trackside and onboard cameras and instant replays.",
};

export default function HotWheelsPage() {
  return <View />;
}
