"use client";

import { useFrame, useThree } from "@react-three/fiber";
import { useMemo } from "react";
import * as THREE from "three";
import { chapter } from "@/lib/chapters";
import { sceneState } from "@/lib/sceneState";
import { useApp } from "@/store/useApp";

type Key = { p: number; pos: [number, number, number]; look: [number, number, number] };

const smooth = (t: number) => t * t * (3 - 2 * t);

/**
 * Camera keyframes along the master progress. Between keys the camera eases;
 * the pointer adds a small parallax on top (desktop only).
 */
export default function CameraRig() {
  const camera = useThree((s) => s.camera);
  const isMobile = useApp((s) => s.isMobile);

  const keys = useMemo<Key[]>(() => {
    const hero = chapter("hero");
    const fr = chapter("fracture");
    const tu = chapter("tunnel");
    const at = (c: { start: number; end: number }, f: number) => c.start + (c.end - c.start) * f;
    // mobile frames the tall monolith / ring from further back
    const z = isMobile ? 1.12 : 1;
    const ringZ = isMobile ? 9.5 : 7.4;
    return [
      { p: 0, pos: [0, 1.3, 12.5 * z], look: [0, 2.9, 0] },
      { p: hero.end, pos: [-1.1, 2.5, 6.4 * z], look: [0, 2.7, 0] },
      // pull back to watch the burst
      { p: at(fr, 0.3), pos: [1.2, 3.1, 11 * z], look: [0, 3, 0] },
      { p: at(fr, 0.55), pos: [-0.6, 3.3, 10 * z], look: [0, 3.1, 0] },
      // square up to the ring
      { p: fr.end, pos: [0, 3.2, ringZ], look: [0, 3.2, 0] },
      // dive through the membrane
      { p: at(tu, 0.5), pos: [0, 3.2, 0.3], look: [0, 3.2, -6] },
      { p: tu.end, pos: [0, 3.2, -4], look: [0, 3.2, -10] },
      { p: 1, pos: [0, 3.2, -4], look: [0, 3.2, -10] },
    ];
  }, [isMobile]);

  const tmp = useMemo(
    () => ({ pos: new THREE.Vector3(), look: new THREE.Vector3(), a: new THREE.Vector3(), b: new THREE.Vector3(), m: new THREE.Vector2() }),
    [],
  );

  useFrame((_, dt) => {
    const p = sceneState.p;
    let i = 0;
    while (i < keys.length - 2 && p > keys[i + 1].p) i++;
    const k0 = keys[i];
    const k1 = keys[i + 1];
    const t = smooth(THREE.MathUtils.clamp((p - k0.p) / (k1.p - k0.p || 1), 0, 1));

    tmp.pos.lerpVectors(tmp.a.fromArray(k0.pos), tmp.b.fromArray(k1.pos), t);
    tmp.look.lerpVectors(tmp.a.fromArray(k0.look), tmp.b.fromArray(k1.look), t);

    // eased pointer parallax
    const f = isMobile ? 0 : 1;
    tmp.m.x += (sceneState.mouse.x * f - tmp.m.x) * Math.min(1, dt * 2.5);
    tmp.m.y += (sceneState.mouse.y * f - tmp.m.y) * Math.min(1, dt * 2.5);
    tmp.pos.x += tmp.m.x * 0.45;
    tmp.pos.y += tmp.m.y * 0.25;

    // intro: settle down from above as the visitor enters
    const intro = 1 - sceneState.intro;
    tmp.pos.y += intro * 2.2;
    tmp.pos.z += intro * 3;

    camera.position.copy(tmp.pos);
    camera.lookAt(tmp.look);
  });

  return null;
}
