"use client";

import { useFrame, useThree } from "@react-three/fiber";
import { useMemo } from "react";
import * as THREE from "three";
import { ABOUT_ORIGIN, at as atP, chapter, CONTACT_ORIGIN, PROJECTS_ORIGIN } from "@/lib/chapters";
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
    // mobile frames the arch / ring from further back
    const z = isMobile ? 1.12 : 1;
    const ringZ = isMobile ? 9.5 : 7.4;
    const pr = chapter("projects");
    const [ox, oy, oz] = PROJECTS_ORIGIN;
    const P = (x: number, y: number, zz: number): [number, number, number] => [ox + x, oy + y, oz + zz];
    const pz = isMobile ? 1.35 : 1;
    const az = isMobile ? 1.3 : 1;
    const off = (o: [number, number, number]) => (x: number, y: number, zz: number): [number, number, number] => [
      o[0] + x,
      o[1] + y,
      o[2] + zz,
    ];
    const A = off(ABOUT_ORIGIN);
    const C = off(CONTACT_ORIGIN);
    return [
      // the forest arch, framed as in the Blender scene; scrolling walks up to it
      { p: 0, pos: [0, 1.55, 10.5 * z], look: [0, 2.05, 0] },
      { p: hero.end, pos: [-0.9, 2.3, 6.6 * z], look: [0, 2.6, 0] },
      // pull back to watch the burst
      { p: at(fr, 0.3), pos: [1.2, 3.1, 11 * z], look: [0, 3, 0] },
      { p: at(fr, 0.55), pos: [-0.6, 3.3, 10 * z], look: [0, 3.1, 0] },
      // square up to the ring
      { p: fr.end, pos: [0, 3.2, ringZ], look: [0, 3.2, 0] },
      // dive through the membrane
      { p: at(tu, 0.5), pos: [0, 3.2, 0.3], look: [0, 3.2, -6] },
      { p: tu.end, pos: [0, 3.2, -4], look: [0, 3.2, -10] },
      // hidden cut (the tunnel is opaque): land high above the dune and descend
      { p: tu.end + 0.0005, pos: P(0, 5.5, 13 * pz), look: P(0, 1.2, 0) },
      { p: at(pr, 0.22), pos: P(0, 2.1, 6.4 * pz), look: P(0, 1.65, 0) },
      { p: at(pr, 0.8), pos: P(1.1, 1.8, 5.8 * pz), look: P(0, 1.65, 0) },
      { p: pr.end, pos: P(0.4, 4.5, 4.5 * pz), look: P(0, 6, -8) },
      // dip to black → about: drift through the ribbons toward the bloom
      { p: atP("about", 0.012), pos: A(0, 3, 17 * az), look: A(0, 2.6, 0) },
      { p: atP("about", 0.45), pos: A(-1.4, 2.6, 12 * az), look: A(0, 2.4, 0) },
      { p: atP("about", 0.7), pos: A(1, 2.2, 9.5 * az), look: A(0, 2, 0) },
      // desktop frames the bloom on the right, leaving room for the copy
      isMobile
        ? { p: atP("about", 0.86), pos: A(0, 3.1, 8.6), look: A(0, 1.55, 0) }
        : { p: atP("about", 0.86), pos: A(-0.2, 3.1, 6.4), look: A(-1, 2.8, 0) },
      isMobile
        ? { p: atP("about", 0.99), pos: A(0.3, 3.2, 8.2), look: A(0, 1.6, 0) }
        : { p: atP("about", 0.99), pos: A(0.4, 3.3, 5.8), look: A(-0.95, 2.85, 0) },
      // dip to black → contact: the clearing, years later. Phones look down on it, so the
      // arch sits in the top half above the copy
      { p: atP("contact", 0.012), pos: C(0, 4, 12 * az), look: C(0, 1.8, 0) },
      ...(isMobile
        ? [
            { p: atP("contact", 0.6), pos: C(-0.3, 2.9, 9.6), look: C(0, -0.2, 0) },
            { p: 1, pos: C(0, 2.6, 9), look: C(0, -0.6, 0) },
          ]
        : [
            { p: atP("contact", 0.6), pos: C(-0.5, 2, 7.5), look: C(0, 1.9, 0) },
            { p: 1, pos: C(0.2, 1.9, 6.6), look: C(0, 2.1, 0) },
          ]),
    ];
  }, [isMobile]);

  const [ox, oy, oz] = PROJECTS_ORIGIN;
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

    // "Discover project": push into the prism
    if (sceneState.dive > 0) {
      const d = sceneState.dive * sceneState.dive;
      tmp.b.set(ox, oy + 1.7, oz + 0.6);
      tmp.pos.lerp(tmp.b, d);
      tmp.look.lerp(tmp.a.set(ox, oy + 1.7, oz - 2), d);
    }

    // intro: settle down from above as the visitor enters
    const intro = 1 - sceneState.intro;
    tmp.pos.y += intro * 2.2;
    tmp.pos.z += intro * 3;

    camera.position.copy(tmp.pos);
    camera.lookAt(tmp.look);
  });

  return null;
}
