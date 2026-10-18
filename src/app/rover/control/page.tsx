import type { Metadata } from "next";
import View from "@/control/View";

export const metadata: Metadata = {
  title: "Mission Control",
  description:
    "A flight control room for the Solar System: plan a mission, run the countdown and the go/no-go poll, fly real rockets with real physics on the big screens, land the boosters, then operate the spacecraft — orbit raising, Hohmann transfers, Mars cruises and more.",
};

export default function MissionControlPage() {
  return <View />;
}
