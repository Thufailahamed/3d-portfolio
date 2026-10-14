"use client";

import { useTexture } from "@react-three/drei";
import { useFrame, useLoader, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { about } from "@/content/site";
import { local } from "@/lib/chapters";
import { sceneState } from "@/lib/sceneState";
import { damp, LINES_OUT, POWER, span } from "../aboutTimeline";
import {
  atmoFrag,
  atmoVert,
  borderFrag,
  borderVert,
  earthFrag,
  earthVert,
  markerFrag,
  markerVert,
} from "../shaders/globe";

/** NASA Black Marble 2016 night-lights composite, 4096 × 2048. */
export const NIGHT_URL = "/earth/night.webp";
export const BORDERS_URL = "/earth/borders.bin";
export const GLOBE_R = 1.25;
/** Globe centre inside the about group (where the bloom used to open). */
export const GLOBE_Y = 2.85;
const ATMO = new THREE.Color("#5c9dff");
const WAVE = new THREE.Color("#dff5ee");
/** Soft moonlight from the upper left, so the night side still reads as a sphere. */
const MOON = new THREE.Vector3(-0.6, 0.5, 0.65).normalize();
const asBinary = (l: THREE.Loader) => (l as THREE.FileLoader).setResponseType("arraybuffer");
/** Starting turn so Europe / Africa / Asia face the camera. */
const START_TURN = (240 * Math.PI) / 180;
export const TILT = 0.41; // Earth's axial tilt
/** The globe can be grabbed once the visitor has read in (≈ the HUD hand-off). */
const GRAB_FROM = 12;
const AUTO_SPIN = 0.035; // rad/s

/** Longitude/latitude (degrees) → point on a sphere, matching three's SphereGeometry UVs. */
export function lonLat(lon: number, lat: number, r: number, out = new THREE.Vector3()) {
  const phi = ((lon + 180) * Math.PI) / 180;
  const theta = ((90 - lat) * Math.PI) / 180;
  return out.set(-Math.cos(phi) * Math.sin(theta) * r, Math.cos(theta) * r, Math.sin(phi) * Math.sin(theta) * r);
}

/** Front-facing spots (about-group space, not rotating) where the HUD notes pin their lines. */
const ANCHORS = [
  new THREE.Vector3(0.55, 0.5, 0.67),
  new THREE.Vector3(0.78, -0.12, 0.62),
  new THREE.Vector3(-0.3, -0.6, 0.74),
].map((d) => d.normalize().multiplyScalar(GLOBE_R).add(new THREE.Vector3(0, GLOBE_Y, 0)));

/**
 * Night-side Earth that the strands open into. Light runs up the strands and powers it:
 * a wave sweeps from the south pole to the north, tracing country borders as it passes
 * and switching the city lights on behind it. Afterwards it can be grabbed and spun, and
 * marks a few cities (their labels and live times are drawn by the DOM, see GlobeLayer).
 * `spin` is the rotating group the strands read.
 */
export default function Globe({ spin }: { spin: React.RefObject<THREE.Group | null> }) {
  const map = useTexture(NIGHT_URL);
  const borders = useLoader(THREE.FileLoader, BORDERS_URL, asBinary) as ArrayBuffer;
  const camera = useThree((s) => s.camera);
  const size = useThree((s) => s.size);
  const dpr = useThree((s) => s.viewport.dpr);

  useMemo(() => {
    map.colorSpace = THREE.SRGBColorSpace;
    map.anisotropy = 8;
  }, [map]);

  const { earthMat, atmoMat, borderMat, borderGeo, markerMat, markerGeo } = useMemo(() => {
    const body = { value: 0 };
    const power = { value: 0 };
    const atmo = { value: ATMO };
    // borders.bin: [nBorder, nCoast] then int16 (lon, lat) * 100 segment pairs
    const head = new Uint32Array(borders, 0, 2);
    const data = new Int16Array(borders, 8);
    const nSeg = head[0] + head[1];
    const pos = new Float32Array(nSeg * 6);
    const kind = new Float32Array(nSeg * 2);
    const v = new THREE.Vector3();
    for (let i = 0; i < nSeg; i++) {
      for (let e = 0; e < 2; e++) {
        lonLat(data[i * 4 + e * 2] / 100, data[i * 4 + e * 2 + 1] / 100, GLOBE_R * 1.003, v).toArray(pos, i * 6 + e * 3);
        kind[i * 2 + e] = i < head[0] ? 1 : 0;
      }
    }
    const borderGeo = new THREE.BufferGeometry();
    borderGeo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    borderGeo.setAttribute("aKind", new THREE.BufferAttribute(kind, 1));

    const markerGeo = new THREE.BufferGeometry();
    markerGeo.setAttribute(
      "position",
      new THREE.BufferAttribute(Float32Array.from(about.places.flatMap((p) => lonLat(p.lon, p.lat, GLOBE_R * 1.008).toArray())), 3),
    );
    markerGeo.setAttribute("aSeed", new THREE.BufferAttribute(Float32Array.from(about.places, (_, i) => i * 0.37), 1));

    const glass: THREE.ShaderMaterialParameters = {
      transparent: true,
      depthWrite: false,
      toneMapped: false,
    };
    return {
      borderGeo,
      markerGeo,
      earthMat: new THREE.ShaderMaterial({
        ...glass,
        vertexShader: earthVert,
        fragmentShader: earthFrag,
        blending: THREE.CustomBlending,
        blendEquation: THREE.AddEquation,
        blendSrc: THREE.OneFactor,
        blendDst: THREE.OneMinusSrcAlphaFactor,
        uniforms: {
          uMap: { value: map },
          uBody: body,
          uPower: power,
          uMoon: { value: MOON },
          uAtmo: atmo,
          uWave: { value: WAVE },
        },
      }),
      atmoMat: new THREE.ShaderMaterial({
        ...glass,
        vertexShader: atmoVert,
        fragmentShader: atmoFrag,
        side: THREE.BackSide,
        blending: THREE.AdditiveBlending,
        uniforms: { uAtmo: atmo, uBody: body },
      }),
      borderMat: new THREE.ShaderMaterial({
        ...glass,
        vertexShader: borderVert,
        fragmentShader: borderFrag,
        blending: THREE.AdditiveBlending,
        uniforms: { uColor: { value: new THREE.Color("#cfeee4") }, uPower: power },
      }),
      markerMat: new THREE.ShaderMaterial({
        ...glass,
        vertexShader: markerVert,
        fragmentShader: markerFrag,
        blending: THREE.AdditiveBlending,
        uniforms: {
          uColor: { value: new THREE.Color("#fff1d6") },
          uOn: { value: 0 },
          uTime: { value: 0 },
          uPixelRatio: { value: dpr },
        },
      }),
    };
  }, [map, borders, dpr]);

  useEffect(
    () => () => {
      for (const o of [borderGeo, markerGeo, earthMat, atmoMat, borderMat, markerMat]) o.dispose();
    },
    [borderGeo, markerGeo, earthMat, atmoMat, borderMat, markerMat],
  );

  const tmp = useMemo(
    () => ({ v: new THREE.Vector3(), c: new THREE.Vector3(), e: new THREE.Vector3(), n: new THREE.Vector3() }),
    [],
  );
  const group = useRef<THREE.Group>(null);
  const pitchGroup = useRef<THREE.Group>(null);
  const motion = useRef({ yaw: 0, pitch: 0, vel: 0 });
  const places = useMemo(() => about.places.map((p) => lonLat(p.lon, p.lat, GLOBE_R * 1.008)), []);

  useFrame(({ clock }, delta) => {
    const dt = Math.min(delta, 0.1);
    const t = local(sceneState.p, "about");
    const time = clock.elapsedTime;
    const sec = sceneState.aboutSec;
    // the dark planet forms inside the opening strands; then the light arriving through
    // them sweeps it pole to pole and the cities switch on
    earthMat.uniforms.uBody.value = span(sec, 10.6, 11.6);
    earthMat.uniforms.uPower.value = span(sec, POWER[0], POWER[1]) * 1.2;
    const markersOn = span(sec, POWER[1], POWER[1] + 0.6);
    markerMat.uniforms.uOn.value = markersOn;
    markerMat.uniforms.uTime.value = time;

    // grab and spin: dragging turns it on its axis (yaw) and tips it toward you (pitch),
    // with momentum on release; it drifts on its own when left alone
    const live = !!group.current?.parent?.visible;
    const grabbable = live && sec >= GRAB_FROM;
    const m = motion.current;
    const drag = sceneState.globeDrag;
    const rPx = Math.max(40, sceneState.globe.r);
    if (grabbable && drag.dragging) {
      const dYaw = drag.dx / rPx;
      m.yaw += dYaw;
      m.vel = damp(m.vel, dYaw / Math.max(dt, 1e-3), 12, dt);
      m.pitch += drag.dy / rPx;
    } else {
      m.yaw += m.vel * dt;
      m.vel = damp(m.vel, 0, 1.8, dt);
    }
    drag.dx = drag.dy = 0;
    if (!drag.dragging) m.yaw += AUTO_SPIN * dt;
    // tipping only once the strands are gone (they hang off the south pole); otherwise ease back
    const pitchFree = sec >= LINES_OUT[1];
    m.pitch = pitchFree ? THREE.MathUtils.clamp(m.pitch, -0.55, 0.55) : damp(m.pitch, 0, 6, dt);
    if (spin.current) spin.current.rotation.y = START_TURN + m.yaw + sceneState.mouse.x * 0.08;
    if (pitchGroup.current) pitchGroup.current.rotation.x = m.pitch;

    if (!group.current) return;
    const parent = group.current.parent!;
    // the globe on screen, for the DOM drag target
    tmp.c.set(0, GLOBE_Y, 0).applyMatrix4(parent.matrixWorld);
    tmp.e.copy(tmp.c).addScaledVector(tmp.n.set(1, 0, 0).applyQuaternion(camera.quaternion), GLOBE_R);
    tmp.v.copy(tmp.c).project(camera);
    tmp.e.project(camera);
    const g = sceneState.globe;
    g.x = (tmp.v.x * 0.5 + 0.5) * size.width;
    g.y = (-tmp.v.y * 0.5 + 0.5) * size.height;
    g.r = Math.abs(tmp.e.x - tmp.v.x) * 0.5 * size.width;
    g.grabbable = grabbable;

    // city markers → screen, with how squarely each faces the camera
    if (spin.current) spin.current.updateWorldMatrix(true, false);
    sceneState.markers.length = places.length;
    places.forEach((p, i) => {
      const out = (sceneState.markers[i] ??= { x: 0, y: 0, facing: 0 });
      if (!live || !spin.current || markersOn <= 0) {
        out.facing = 0;
        return;
      }
      tmp.v.copy(p).applyMatrix4(spin.current.matrixWorld);
      tmp.n.copy(tmp.v).sub(tmp.c).normalize();
      tmp.e.copy(camera.position).sub(tmp.v).normalize();
      out.facing = THREE.MathUtils.smoothstep(tmp.n.dot(tmp.e), 0.25, 0.55) * markersOn;
      tmp.v.project(camera);
      out.x = (tmp.v.x * 0.5 + 0.5) * size.width;
      out.y = (-tmp.v.y * 0.5 + 0.5) * size.height;
    });

    // project the note anchors to screen space for the DOM HUD
    const on = live && t > 0.75;
    for (let a = 0; a < ANCHORS.length; a++) {
      const out = sceneState.anchors[a];
      if (!on) {
        out.visible = false;
        continue;
      }
      tmp.v.copy(ANCHORS[a]).applyMatrix4(parent.matrixWorld).project(camera);
      out.x = (tmp.v.x * 0.5 + 0.5) * size.width;
      out.y = (-tmp.v.y * 0.5 + 0.5) * size.height;
      out.visible = tmp.v.z < 1;
    }
  });

  return (
    <group ref={group} position-y={GLOBE_Y}>
      <group ref={pitchGroup}>
        <group rotation-z={TILT}>
          <group ref={spin}>
            <mesh material={earthMat} renderOrder={10}>
              <sphereGeometry args={[GLOBE_R, 160, 80]} />
            </mesh>
            <lineSegments geometry={borderGeo} material={borderMat} renderOrder={11} />
            <points geometry={markerGeo} material={markerMat} renderOrder={13} frustumCulled={false} />
          </group>
          <mesh material={atmoMat} scale={1.14} renderOrder={9}>
            <sphereGeometry args={[GLOBE_R, 64, 32]} />
          </mesh>
        </group>
      </group>
    </group>
  );
}

// start both loads at import time, never during render (the load tracker updates state)
useTexture.preload(NIGHT_URL);
useLoader.preload(THREE.FileLoader, BORDERS_URL, asBinary);
