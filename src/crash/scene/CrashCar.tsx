"use client";

import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef, type ReactNode } from "react";
import * as THREE from "three";
import { setLamps, useCarInstance, type CarInstance } from "@/components/showroom/carModel";
import type { Car } from "@/content/cars";
import { crushAt, frameAt, lerpRow, type Playback } from "../playback";
import { NB, NS, type Pane, type Timeline } from "../sim/types";
import { crashMaterials, markersFor } from "./deform";

export type CrashCarProps = {
  timeline: Timeline;
  bodyId: "a" | "b";
  /** the content record: model, paint and lamp materials */
  car: Car;
  playback: Playback;
  lite: boolean;
  /** rendered in the car's own frame (the dummy, the airbags) */
  children?: ReactNode;
  onLoaded?: (inst: CarInstance) => void;
};

const PANES: Pane[] = ["windscreen", "rear", "left-front", "right-front", "left-rear", "right-rear"];
const AY = new THREE.Vector3(0, 1, 0), AZ = new THREE.Vector3(0, 0, 1);
const qa = new THREE.Quaternion(), qb = new THREE.Quaternion(), pv = new THREE.Vector3(), cv = new THREE.Vector3();

/**
 * A car of the line-up on the timeline: posed by its track, bent by its crush (deform.ts), its rigid
 * parts (engine, wheels, steering column) shoved as wholes, its wheels turning and steered by the
 * impact, its glass cracking and bursting and its lamps dying as the events say — all evaluated at
 * the playback time, so scrubbing in either direction shows exactly the same car.
 */
export default function CrashCar({ timeline, bodyId, car, playback, lite, children, onLoaded }: CrashCarProps) {
  const inst = useCarInstance(car);
  const group = useRef<THREE.Group>(null);
  const def = useMemo(() => timeline.bodies.find((b) => b.id === bodyId)!, [timeline, bodyId]);
  const bi = timeline.bodies.indexOf(def);
  const track = timeline.tracks[bi];
  const crush = timeline.crush[bi];
  const mats = useMemo(() => crashMaterials(inst, def, { markers: markersFor(inst, def), lite }), [inst, def, lite]);
  useEffect(() => () => mats.dispose(), [mats]);
  useEffect(() => onLoaded?.(inst), [inst, onLoaded]);

  // rest pose of every rigid part, and the hub centres for spinning and steering the wheels
  const parts = useMemo(() => {
    const list: { id: string; objs: { obj: THREE.Object3D; pos: THREE.Vector3; q: THREE.Quaternion; spin: boolean }[]; center: THREE.Vector3; ri: number; wi: number }[] = [];
    for (const [id, objs] of mats.rigid) {
      const b = inst.boxes.get(id) ?? new THREE.Box3().setFromObject(objs[0]);
      list.push({
        id,
        objs: objs.map((obj) => ({ obj, pos: obj.position.clone(), q: obj.quaternion.clone(), spin: obj.name.startsWith("Part_wheel_") })),
        center: b.getCenter(new THREE.Vector3()),
        ri: track.rigidIds.indexOf(id),
        wi: ["wheel_fl", "wheel_fr", "wheel_rl", "wheel_rr"].indexOf(id),
      });
    }
    return list;
  }, [mats, inst, track]);
  useEffect(
    () => () => {
      for (const p of parts) for (const o of p.objs) o.obj.position.copy(o.pos), o.obj.quaternion.copy(o.q);
    },
    [parts],
  );

  const pose = useMemo(() => new Float32Array(6), []);
  const wheels = useMemo(() => new Float32Array(6), []);
  const rigid = useMemo(() => new Float32Array(Math.max(4, track.rigidIds.length * 4)), [track]);
  const grid = useMemo(() => new Float32Array(NB * NS * 3), []);
  const last = useRef({ t: NaN, lamps: -1 });
  const glassEvents = useMemo(() => timeline.events.filter((e) => e.type === "glass" && e.body === bodyId), [timeline, bodyId]);
  const lampEvents = useMemo(() => timeline.events.filter((e) => e.type === "lamp" && e.body === bodyId), [timeline, bodyId]);

  useFrame(() => {
    const g = group.current;
    if (!g) return;
    const t = playback.t;
    const [i, f] = frameAt(timeline.times, t);
    lerpRow(track.pose, 6, i, f, pose);
    g.position.set(pose[0], pose[1], pose[2]);
    g.rotation.set(0, 0, 0);
    g.rotateY(pose[3]);
    g.rotateZ(-pose[4]);
    g.rotateX(pose[5]);
    g.updateMatrixWorld(true);
    mats.uniforms.uCarMat.value.copy(inst.root.matrixWorld);
    mats.uniforms.uCarInv.value.copy(inst.root.matrixWorld).invert();

    if (t === last.current.t) return;
    last.current.t = t;

    // the crush
    mats.setCrush(crushAt(crush, t, grid));

    // rigid parts: shoved by the crush, wheels spinning and steered
    lerpRow(track.wheels, 6, i, f, wheels);
    const nr = track.rigidIds.length;
    if (nr) {
      const a = i * nr * 4, b = Math.min(i + 1, timeline.times.length - 1) * nr * 4;
      for (let k = 0; k < nr * 4; k++) rigid[k] = track.rigid[a + k] + (track.rigid[b + k] - track.rigid[a + k]) * f;
    }
    for (const p of parts) {
      const off = p.ri >= 0 ? [rigid[p.ri * 4], rigid[p.ri * 4 + 1], rigid[p.ri * 4 + 2], rigid[p.ri * 4 + 3]] : [0, 0, 0, 0];
      const steer = p.wi === 0 || p.wi === 1 ? wheels[4 + p.wi] : off[3];
      for (const o of p.objs) {
        qa.setFromAxisAngle(AY, p.wi >= 0 ? steer : off[3]);
        if (o.spin && p.wi >= 0) qa.multiply(qb.setFromAxisAngle(AZ, -wheels[p.wi]));
        // rotate about the hub (or the part's centre), then shove
        cv.copy(p.center);
        pv.copy(o.pos).sub(cv).applyQuaternion(qa).add(cv);
        o.obj.position.set(pv.x + off[0], pv.y + off[1], pv.z + off[2]);
        o.obj.quaternion.copy(qa).multiply(o.q);
      }
    }

    // glass: cracked or burst by now?
    for (const pn of mats.glass.pane) pn.set(0, -1, 0, 0);
    for (const e of glassEvents) {
      if (e.type !== "glass" || e.t > t) continue;
      const k = PANES.indexOf(e.pane);
      const age = t - e.t;
      if (e.kind === "crack") mats.glass.pane[k].x = Math.min(1, age / 0.004);
      else mats.glass.pane[k].y = age * 400; // the shatter front runs across the pane in a few milliseconds
      mats.glass.at[k].set(e.origin[0], e.origin[1], e.origin[2]);
    }

    // lamps: on for the run-up, dead once broken
    const broken = lampEvents.some((e) => e.t <= t);
    const lv = broken ? 0 : 0.35;
    if (lv !== last.current.lamps) {
      setLamps(inst, lv);
      last.current.lamps = lv;
    }
  });

  return (
    <group ref={group}>
      <primitive object={inst.root} />
      {children}
    </group>
  );
}
