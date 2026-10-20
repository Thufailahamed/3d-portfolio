"use client";

import type { Car } from "@/content/cars";
import type { PerfTrace } from "../perf";

export type RaceCameraId = "tracking" | "side" | "drone" | "finish";

export type RaceSceneProps = {
  cars: [Car, Car];
  traces: [PerfTrace, PerfTrace];
  /** bumped to start a new run (the lights sequence, then the launch) */
  run: number;
  camera: RaceCameraId;
  lite: boolean;
  /** sound on: both engine notes */
  sound: boolean;
  /** race time (s, 0 at the green light) as it runs, and when both have crossed the line */
  onTime?: (t: number) => void;
  onFinish?: () => void;
};

/** STUB: the airfield drag race. */
export default function RaceScene(props: RaceSceneProps) {
  void props;
  return <div className="absolute inset-0 grid place-items-center text-fg/40">Race</div>;
}
