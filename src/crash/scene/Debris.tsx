"use client";

import type { Playback } from "../playback";
import type { Timeline } from "../sim/types";

export type DebrisProps = { timeline: Timeline; playback: Playback; lite: boolean };

/** STUB: debris, sparks, dust and skid marks from the timeline. */
export default function Debris(props: DebrisProps) {
  void props;
  return null;
}
