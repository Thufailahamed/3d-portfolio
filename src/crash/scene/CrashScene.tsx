"use client";

import { Canvas, useFrame } from "@react-three/fiber";
import { Suspense, useMemo, useRef } from "react";
import type { BloomEffect, DepthOfFieldEffect } from "postprocessing";
import * as THREE from "three";
import { Post, type Rig } from "@/components/showroom/ShowroomScene";
import { carBySlug } from "@/content/cars";
import { autoSpeed, endOf, type Playback } from "../playback";
import type { Timeline } from "../sim/types";
import Barriers from "./Barriers";
import CrashCar from "./CrashCar";
import Debris from "./Debris";
import Director, { type CrashCameraId } from "./Director";
import Dummy from "./Dummy";
import Hall, { type HallLights } from "./Hall";

export type { CrashCameraId };

export type CrashSceneProps = {
  timeline: Timeline | null;
  /** the shared clock: the scene advances it every frame while `playing` */
  playback: Playback;
  camera: CrashCameraId;
  /** the hall's lamps: dark before a run, powering up in the countdown, on for the test */
  lights: HallLights;
  lite: boolean;
  /** the camera's name as it cuts, for the film overlay */
  onShot?: (name: string) => void;
};

/** Advances the clock: real time × the transport's speed (or the automatic slow motion). */
function Clock({ timeline, playback }: { timeline: Timeline | null; playback: Playback }) {
  useFrame((_, dt) => {
    if (!timeline || !playback.playing) return;
    const speed = playback.auto ? autoSpeed(timeline, playback.t) : playback.speed;
    playback.t = Math.min(endOf(timeline), playback.t + Math.min(dt, 1 / 20) * speed);
    if (playback.t >= endOf(timeline)) playback.playing = false;
  }, -1);
  return null;
}

/** The crash lab's 3D: the hall, the barrier, the cars with their dummies, the debris, the cameras. */
export default function CrashScene({ timeline, playback, camera, lights, lite, onShot }: CrashSceneProps) {
  const narrow = typeof window !== "undefined" && window.innerWidth < 768;
  const bloom = useRef<BloomEffect | null>(null);
  const dof = useRef<DepthOfFieldEffect | null>(null);
  const contact = timeline?.events.find((e) => e.type === "contact");
  const center: [number, number] = contact && contact.type === "contact" ? contact.at : [0, 0];
  // the post-processing only needs a focus point from the showroom's rig
  const rig = useMemo(() => ({ focus: new THREE.Vector3(center[0], 0.6, center[1]) }) as unknown as Rig, [center]);
  const cars = timeline?.bodies.filter((b) => b.kind === "car" && b.slug && carBySlug[b.slug]) ?? [];

  return (
    <Canvas shadows={{ type: THREE.PCFShadowMap }} dpr={lite ? 1 : [1, 2]} gl={{ antialias: false, powerPreference: "high-performance" }}>
      <Clock timeline={timeline} playback={playback} />
      <Hall lights={lights} lite={lite} center={[0, 0]} />
      <Suspense fallback={null}>
        {timeline && <Barriers timeline={timeline} playback={playback} />}
        {timeline &&
          cars.map((b) => (
            <CrashCar key={`${b.id}-${b.slug}`} timeline={timeline} bodyId={b.id as "a" | "b"} car={carBySlug[b.slug!]} playback={playback} lite={lite}>
              <Dummy timeline={timeline} bodyId={b.id as "a" | "b"} playback={playback} lite={lite} />
            </CrashCar>
          ))}
        {timeline && <Debris timeline={timeline} playback={playback} lite={lite} />}
      </Suspense>
      <Director timeline={timeline} playback={playback} camera={camera} onShot={onShot} />
      <Post narrow={narrow} lite={lite} cinematic={false} aperture={0} rig={rig} bloom={bloom} dof={dof} />
    </Canvas>
  );
}
