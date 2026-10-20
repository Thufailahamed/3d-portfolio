"use client";

import type { Playback } from "../playback";
import type { Timeline } from "../sim/types";

/** Rendered inside CrashCar, so it works in the car's own frame. */
export type DummyProps = { timeline: Timeline; bodyId: "a" | "b"; playback: Playback; lite: boolean };

/** STUB: the crash dummy and the airbags. */
export default function Dummy(props: DummyProps) {
  void props;
  return null;
}
