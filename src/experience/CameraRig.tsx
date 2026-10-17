"use client";

import { useFrame, useThree } from "@react-three/fiber";
import { useMemo } from "react";
import * as THREE from "three";
import { ABOUT_ORIGIN, at as atP, chapter, CONTACT_ORIGIN, PROJECTS_ORIGIN } from "@/lib/chapters";
import { ASCENT_FROM, ASCENT_TO, ascentCamera, globeRest } from "./ascent";
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
    const rest = { pos: new THREE.Vector3(), look: new THREE.Vector3() };
    globeRest(isMobile, rest.pos, rest.look);
    const C = off(CONTACT_ORIGIN);
    return [
      // the forest arch: hold/pause at opening, then walk up to it
      { p: 0, pos: [0, 1.55, 10.5 * z], look: [0, 2.05, 0] },
      { p: at(hero, 0.35), pos: [0, 1.55, 10.5 * z], look: [0, 2.05, 0] },
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
      { p: at(pr, 0.18), pos: P(0, 2.1, 6.4 * pz), look: P(0, 1.65, 0) },
      // holds calmly on the project crystal for steady showcase browsing
      { p: ASCENT_FROM, pos: P(0.25, 2.05, 6.2 * pz), look: P(0, 1.65, 0) },
      // … then zooms out to the globe (see ascent.ts); desktop frames it on the right,
      // leaving room for the copy, and holds paused across the section
      { p: ASCENT_TO, pos: rest.pos.toArray(), look: rest.look.toArray() },
      isMobile
        ? { p: atP("about", 0.92), pos: A(0.15, 3.15, 8.3), look: A(0, 1.58, 0) }
        : { p: atP("about", 0.92), pos: A(0.05, 3.15, 6.2), look: A(-0.95, 2.82, 0) },
      isMobile
        ? { p: atP("about", 0.99), pos: A(0.3, 3.2, 8.2), look: A(0, 1.6, 0) }
        : { p: atP("about", 0.99), pos: A(0.4, 3.3, 5.8), look: A(-0.95, 2.85, 0) },
      // dip to black → contact: the clearing, years later
      { p: atP("contact", 0.012), pos: C(0, 4, 12 * az), look: C(0, 1.8, 0) },
      ...(isMobile
        ? [
            { p: atP("contact", 0.35), pos: C(-0.3, 2.9, 9.6), look: C(0, -0.2, 0) },
            { p: 1, pos: C(0, 2.6, 9), look: C(0, -0.6, 0) },
          ]
        : [
            { p: atP("contact", 0.35), pos: C(-0.5, 2, 7.5), look: C(0, 1.9, 0) },
            { p: 1, pos: C(0.2, 1.9, 6.6), look: C(0, 2.1, 0) },
          ]),
    ];
  }, [isMobile]);

  const [ox, oy, oz] = PROJECTS_ORIGIN;
  const tmp = useMemo(
    () => ({
      pos: new THREE.Vector3(),
      look: new THREE.Vector3(),
      a: new THREE.Vector3(),
      b: new THREE.Vector3(),
      m: new THREE.Vector2(),
      home: new THREE.Vector3(),
      // the board's camera, eased toward where the board asks for it
      bPos: new THREE.Vector3(),
      bLook: new THREE.Vector3(),
      inBoard: false,
      // the flow pavilion's camera, eased toward where flow asks for it
      fPos: new THREE.Vector3(),
      fLook: new THREE.Vector3(),
      inFlow: false,
    }),
    [],
  );

  useFrame((_, dt) => {
    // /flow owns the camera; glides between exterior, interior hall, and individual showcases
    const flow = sceneState.flow;
    if (flow.active) {
      tmp.a.fromArray(flow.pos);
      tmp.b.fromArray(flow.look);
      if (!tmp.inFlow) {
        tmp.fPos.copy(tmp.a);
        tmp.fLook.copy(tmp.b);
        tmp.inFlow = true;
      }
      // first person locks on once its follow rate has ramped up; everything else glides
      const k = flow.rigRate >= 200 ? 1 : 1 - Math.exp(-Math.min(dt, 0.1) * flow.rigRate);
      tmp.fPos.lerp(tmp.a, k);
      tmp.fLook.lerp(tmp.b, k);
      camera.position.copy(tmp.fPos);
      camera.lookAt(tmp.fLook);
      if (flow.roll) camera.rotateZ(flow.roll);
      return;
    }
    tmp.inFlow = false;

    // /board owns the camera; it cuts there under the curtain, then glides between cards
    const board = sceneState.board;
    if (board.active) {
      tmp.a.fromArray(board.pos);
      tmp.b.fromArray(board.look);
      if (!tmp.inBoard) {
        tmp.bPos.copy(tmp.a);
        tmp.bLook.copy(tmp.b);
        tmp.inBoard = true;
      }
      const k = 1 - Math.exp(-Math.min(dt, 0.1) * 3.4);
      tmp.bPos.lerp(tmp.a, k);
      tmp.bLook.lerp(tmp.b, k);
      camera.position.copy(tmp.bPos);
      camera.lookAt(tmp.bLook);
      return;
    }
    tmp.inBoard = false;

    const p = sceneState.p;
    if (sceneState.ascent.active) {
      ascentCamera(sceneState.ascent.u, isMobile, tmp.home.fromArray(sceneState.globe.home), tmp.pos, tmp.look);
    } else {
      let i = 0;
      while (i < keys.length - 2 && p > keys[i + 1].p) i++;
      const k0 = keys[i];
      const k1 = keys[i + 1];
      const t = smooth(THREE.MathUtils.clamp((p - k0.p) / (k1.p - k0.p || 1), 0, 1));
      tmp.pos.lerpVectors(tmp.a.fromArray(k0.pos), tmp.b.fromArray(k1.pos), t);
      tmp.look.lerpVectors(tmp.a.fromArray(k0.look), tmp.b.fromArray(k1.look), t);
    }

    // eased pointer parallax
    // (it eases out while the globe opens into the map, so the map lands square)
    const f = (isMobile ? 0 : 1) * (1 - sceneState.unfold.t);
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

    // the contact arch, clicked: rush the doorway (the multiverse opens as we reach it)
    const portal = sceneState.portal;
    if (portal.dive > 0) {
      const [dx, dy, dz] = portal.door;
      tmp.pos.lerp(tmp.b.set(dx, dy, dz + 0.45), portal.dive);
      tmp.look.lerp(tmp.a.set(dx, dy, dz - 4), Math.min(1, portal.dive * 1.6));
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
