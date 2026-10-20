"use client";

import { OrbitControls, PerspectiveCamera } from "@react-three/drei";
import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import type { OrbitControls as OrbitControlsImpl } from "three-stdlib";
import * as THREE from "three";
import { FX_LAYER } from "@/components/showroom/ShowroomScene";
import { frameAt, impactWindow, lerpRow, type Playback } from "../playback";
import type { Timeline } from "../sim/types";

export type CrashCameraId = "director" | "overhead" | "side" | "front" | "onboard" | "chase" | "free";

export const CAMERA_NAMES: Record<CrashCameraId, string> = {
  director: "Director",
  overhead: "Overhead",
  side: "Side",
  front: "Front ¾",
  onboard: "Onboard",
  chase: "Chase",
  free: "Free",
};

const qYaw = new THREE.Quaternion(), qP = new THREE.Quaternion(), qR = new THREE.Quaternion(), q = new THREE.Quaternion();
const AY = new THREE.Vector3(0, 1, 0), AX = new THREE.Vector3(1, 0, 0), AZ = new THREE.Vector3(0, 0, 1);

/** A body's pose as a matrix (car frame → world), as the cars are posed. */
function poseMatrix(p: Float32Array, out: THREE.Matrix4) {
  qYaw.setFromAxisAngle(AY, p[3]);
  qP.setFromAxisAngle(AZ, -p[4]);
  qR.setFromAxisAngle(AX, p[5]);
  q.copy(qYaw).multiply(qP).multiply(qR);
  return out.compose(new THREE.Vector3(p[0], p[1], p[2]), q, new THREE.Vector3(1, 1, 1));
}

/**
 * The cameras of a crash-test film: an overhead high-speed camera looking straight down, a side
 * camera on a long lens at bumper height, a low front three-quarter, an onboard camera bolted in car
 * A's cabin (it shakes with the car), a chase, free orbit, and a director who cuts between them:
 * alongside on the approach, the side camera through the impact, overhead as the cars separate, a wide
 * shot as they settle. Everything is framed from the timeline, so every test and pair is framed.
 */
export default function Director({ timeline, playback, camera, onShot }: { timeline: Timeline | null; playback: Playback; camera: CrashCameraId; onShot?: (name: string) => void }) {
  const cam = useRef<THREE.PerspectiveCamera>(null);
  const controls = useRef<OrbitControlsImpl | null>(null);
  const narrow = useThree((s) => s.size.width < 768);
  const shot = useRef("");
  const pose = useMemo(() => new Float32Array(6), []);
  const poseB = useMemo(() => new Float32Array(6), []);
  const m = useMemo(() => new THREE.Matrix4(), []);
  const goal = useMemo(() => ({ pos: new THREE.Vector3(-8, 3, 8), look: new THREE.Vector3(0, 0.6, 0), fov: 30 }), []);
  const cur = useMemo(() => ({ pos: new THREE.Vector3(-8, 3, 8), look: new THREE.Vector3(0, 0.6, 0), fov: 30, init: false }), []);

  // the impact point and the line A came in on
  const scene = useMemo(() => {
    if (!timeline) return null;
    const contact = timeline.events.find((e) => e.type === "contact");
    const at = contact && contact.type === "contact" ? contact.at : [0, 0];
    const ta = timeline.tracks.find((t) => t.id === "a")!;
    const yaw0 = ta.pose[3];
    const fwd = new THREE.Vector3(Math.cos(yaw0), 0, -Math.sin(yaw0));
    const side = new THREE.Vector3(Math.sin(yaw0), 0, Math.cos(yaw0));
    const [, end] = impactWindow(timeline);
    const a = timeline.bodies.find((b) => b.id === "a")!;
    return { at: new THREE.Vector3(at[0], 0, at[1]), fwd, side, end, a };
  }, [timeline]);

  useEffect(() => {
    cur.init = false;
  }, [camera, cur]);

  useFrame((state, dt) => {
    const c = cam.current;
    if (!c || !timeline || !scene) return;
    const t = playback.t;
    const [i, f] = frameAt(timeline.times, t);
    const ta = timeline.tracks.find((tr) => tr.id === "a")!;
    lerpRow(ta.pose, 6, i, f, pose);
    const tb = timeline.tracks.find((tr) => tr.id !== "a");
    if (tb) lerpRow(tb.pose, 6, i, f, poseB);
    const A = new THREE.Vector3(pose[0], 0, pose[2]);
    const mid = tb && timeline.bodies.find((b) => b.id === tb.id)?.kind !== "wall" ? A.clone().lerp(new THREE.Vector3(poseB[0], 0, poseB[2]), 0.5) : A.clone().lerp(scene.at, 0.5);
    const far = narrow ? 1.35 : 1;

    let mode = camera;
    if (camera === "director") {
      mode = t < -0.45 ? "chase" : t < scene.end + 0.05 ? "side" : t < scene.end + 1.2 ? "overhead" : "front";
    }
    let snap = !cur.init;
    const name = camera === "director" ? `${CAMERA_NAMES.director} · ${CAMERA_NAMES[mode]}` : CAMERA_NAMES[camera];
    if (name !== shot.current) {
      shot.current = name;
      onShot?.(name);
      snap = true; // a cut, not a pan
    }

    switch (mode) {
      case "overhead":
        goal.pos.copy(scene.at).add(new THREE.Vector3(0.001, 13 * far, 0.001)).addScaledVector(scene.fwd, -0.6);
        goal.look.copy(scene.at).addScaledVector(scene.fwd, -0.6);
        goal.fov = 30;
        break;
      case "side":
        goal.pos.copy(scene.at).addScaledVector(scene.side, 9.5 * far).addScaledVector(scene.fwd, -1.2).setY(0.75);
        goal.look.copy(scene.at).addScaledVector(scene.fwd, -1.2).setY(0.55);
        goal.fov = 24;
        break;
      case "front":
        goal.pos.copy(mid).addScaledVector(scene.fwd, -6.5 * far).addScaledVector(scene.side, -5.5 * far).setY(1.1);
        goal.look.copy(mid).setY(0.55);
        goal.fov = 32;
        break;
      case "chase": {
        // alongside car A, a little ahead of it, on a long lens
        const fw = new THREE.Vector3(Math.cos(pose[3]), 0, -Math.sin(pose[3]));
        const sd = new THREE.Vector3(Math.sin(pose[3]), 0, Math.cos(pose[3]));
        goal.pos.copy(A).addScaledVector(sd, 6.5 * far).addScaledVector(fw, 2.2).setY(1.0);
        goal.look.copy(A).addScaledVector(fw, 0.6).setY(0.55);
        goal.fov = 28;
        break;
      }
      case "onboard": {
        // bolted in the passenger's side of car A's cabin, looking across at the driver
        const d = scene.a;
        poseMatrix(pose, m);
        const ps = -d.driverSide;
        goal.pos.set(d.hPoint[0] + 0.25, d.hPoint[1] + 0.45, ps * Math.max(0.15, Math.abs(d.hPoint[2]) * 0.9)).applyMatrix4(m);
        goal.look.set(d.hPoint[0] + 0.1, d.hPoint[1] + 0.4, d.hPoint[2]).applyMatrix4(m);
        goal.fov = 62;
        snap = true; // rigidly mounted: it must shake with the car
        break;
      }
      case "free":
        if (!cur.init && controls.current) {
          c.position.copy(scene.at).add(new THREE.Vector3(-7, 3.5, 7.5));
          controls.current.target.copy(scene.at).setY(0.6);
          controls.current.update();
          cur.init = true;
        }
        if (Math.abs(c.fov - 32) > 0.01) {
          c.fov = 32;
          c.updateProjectionMatrix();
        }
        return;
    }
    const k = snap ? 1 : 1 - Math.exp(-dt * 4);
    cur.pos.lerp(goal.pos, k);
    cur.look.lerp(goal.look, k);
    cur.fov += (goal.fov - cur.fov) * k;
    cur.init = true;
    c.position.copy(cur.pos);
    c.lookAt(cur.look);
    if (Math.abs(c.fov - cur.fov) > 0.001) {
      c.fov = cur.fov;
      c.updateProjectionMatrix();
    }
    c.near = mode === "onboard" ? 0.02 : 0.05;
  });

  return (
    <>
      <PerspectiveCamera ref={cam} makeDefault position={[-8, 3, 8]} fov={30} near={0.05} far={300} onUpdate={(c) => c.layers.enable(FX_LAYER)} />
      {camera === "free" && <OrbitControls ref={controls as never} makeDefault enableDamping dampingFactor={0.08} minDistance={1.5} maxDistance={30} maxPolarAngle={Math.PI * 0.49} />}
    </>
  );
}
