"use client";

import { useTexture } from "@react-three/drei";
import { useFrame, useLoader, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { about } from "@/content/site";
import { sceneState } from "@/lib/sceneState";
import { damp, ease } from "../aboutTimeline";
import { GLOBE_R, GLOBE_Y, globeG, TILT } from "../ascent";
import { BOARD_FRAME, sharedInk, UNFOLD_FILL } from "../boardArt";
import { unfoldFrag, unfoldVert } from "../shaders/unfold";
import {
  arcFrag,
  arcVert,
  atmoFrag,
  atmoVert,
  borderFrag,
  borderVert,
  cloudFrag,
  cloudVert,
  earthFrag,
  earthVert,
  gridFrag,
  gridVert,
  markerFrag,
  markerVert,
} from "../shaders/globe";

/** NASA Black Marble 2016 night-lights composite, 4096 × 2048. */
export const NIGHT_URL = "/earth/night.webp";
export const BORDERS_URL = "/earth/borders.bin";
const ATMO = new THREE.Color("#5c9dff");
const WAVE = new THREE.Color("#dff5ee");
/** Soft moonlight from the upper left, so the night side still reads as a sphere. */
const MOON = new THREE.Vector3(-0.6, 0.5, 0.65).normalize();
const asBinary = (l: THREE.Loader) => (l as THREE.FileLoader).setResponseType("arraybuffer");
/** Starting turn so home (Colombo) and the arcs flying out of it face the camera. */
const START_TURN = (175 * Math.PI) / 180;
const AUTO_SPIN = 0.035; // rad/s

/** Longitude/latitude (degrees) → point on a sphere, matching three's SphereGeometry UVs. */
export function lonLat(lon: number, lat: number, r: number, out = new THREE.Vector3()) {
  const phi = ((lon + 180) * Math.PI) / 180;
  const theta = ((90 - lat) * Math.PI) / 180;
  return out.set(-Math.cos(phi) * Math.sin(theta) * r, Math.cos(theta) * r, Math.sin(phi) * Math.sin(theta) * r);
}

/** Where the studio is: arcs fly out from here and its marker wears the accent. */
const HOME = 0;
const ACCENT = new THREE.Color("#c8ff3d");

/** Great-circle arcs from home to every other place, lifted higher the further they fly. */
function arcGeometry() {
  const SEG = 72;
  const home = lonLat(about.places[HOME].lon, about.places[HOME].lat, 1);
  const pos: number[] = [];
  const t: number[] = [];
  const seed: number[] = [];
  const a = new THREE.Vector3();
  const q = new THREE.Quaternion();
  let k = 0;
  about.places.forEach((p, i) => {
    if (i === HOME) return;
    const to = lonLat(p.lon, p.lat, 1);
    const angle = home.angleTo(to);
    const axis = new THREE.Vector3().crossVectors(home, to).normalize();
    const lift = 0.05 + 0.32 * (angle / Math.PI);
    const point = (u: number) => {
      q.setFromAxisAngle(axis, angle * u);
      return a.copy(home).applyQuaternion(q).multiplyScalar(GLOBE_R * (1.006 + Math.sin(Math.PI * u) * lift)).toArray();
    };
    for (let s = 0; s < SEG; s++) {
      const u0 = s / SEG;
      const u1 = (s + 1) / SEG;
      pos.push(...point(u0), ...point(u1));
      t.push(u0, u1);
      seed.push(k / 7, k / 7);
    }
    k++;
  });
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("aT", new THREE.Float32BufferAttribute(t, 1));
  g.setAttribute("aSeed", new THREE.Float32BufferAttribute(seed, 1));
  return g;
}

/** Latitude rings and meridians every 20°. */
function gridGeometry() {
  const pos: number[] = [];
  const v = new THREE.Vector3();
  const r = GLOBE_R * 1.001;
  const push = (lon: number, lat: number) => pos.push(...lonLat(lon, lat, r, v).toArray());
  for (let lat = -60; lat <= 60; lat += 20)
    for (let lon = -180; lon < 180; lon += 3) {
      push(lon, lat);
      push(lon + 3, lat);
    }
  for (let lon = -180; lon < 180; lon += 20)
    for (let lat = -80; lat < 80; lat += 3) {
      push(lon, lat);
      push(lon, lat + 3);
    }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  return g;
}

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

  const { earthMat, cloudMat, atmoMat, borderMat, borderGeo, markerMat, markerGeo, arcGeo, arcMat, gridGeo, gridMat } = useMemo(() => {
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
    markerGeo.setAttribute("aHome", new THREE.BufferAttribute(Float32Array.from(about.places, (_, i) => (i === HOME ? 1 : 0)), 1));

    const glass: THREE.ShaderMaterialParameters = {
      transparent: true,
      depthWrite: false,
      toneMapped: false,
    };
    return {
      borderGeo,
      markerGeo,
      arcGeo: arcGeometry(),
      gridGeo: gridGeometry(),
      arcMat: new THREE.ShaderMaterial({
        ...glass,
        vertexShader: arcVert,
        fragmentShader: arcFrag,
        blending: THREE.AdditiveBlending,
        uniforms: {
          uColor: { value: new THREE.Color("#9fd0ff") },
          uR: { value: GLOBE_R * 0.995 },
          uDraw: { value: 0 },
          uTime: { value: 0 },
        },
      }),
      gridMat: new THREE.ShaderMaterial({
        ...glass,
        vertexShader: gridVert,
        fragmentShader: gridFrag,
        blending: THREE.AdditiveBlending,
        uniforms: { uColor: { value: new THREE.Color("#8fb8ff") }, uOn: { value: 0 } },
      }),
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
      cloudMat: new THREE.ShaderMaterial({
        ...glass,
        vertexShader: cloudVert,
        fragmentShader: cloudFrag,
        blending: THREE.CustomBlending,
        blendEquation: THREE.AddEquation,
        blendSrc: THREE.OneFactor,
        blendDst: THREE.OneMinusSrcAlphaFactor,
        uniforms: { uMap: { value: map }, uMoon: { value: MOON }, uCloud: { value: 1 }, uTime: { value: 0 } },
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
          uHome: { value: ACCENT },
          uOn: { value: 0 },
          uTime: { value: 0 },
          uPixelRatio: { value: dpr },
        },
      }),
    };
  }, [map, borders, dpr]);

  useEffect(
    () => () => {
      for (const o of [borderGeo, markerGeo, arcGeo, gridGeo, earthMat, cloudMat, atmoMat, borderMat, markerMat, arcMat, gridMat]) o.dispose();
    },
    [borderGeo, markerGeo, arcGeo, gridGeo, earthMat, cloudMat, atmoMat, borderMat, markerMat, arcMat, gridMat],
  );

  const tmp = useMemo(
    () => ({ v: new THREE.Vector3(), c: new THREE.Vector3(), e: new THREE.Vector3(), n: new THREE.Vector3() }),
    [],
  );
  const group = useRef<THREE.Group>(null);
  const pitchGroup = useRef<THREE.Group>(null);
  const earth = useRef<THREE.Mesh>(null);
  const cloudShell = useRef<THREE.Mesh>(null);
  const lines = useRef<THREE.Group>(null);
  const sheet = useRef<THREE.Mesh>(null);

  // the globe opening into the board's map (see shaders/unfold): one (lon, lat) grid, its
  // seam at the back so the sheet splits there and unrolls from the front outward
  const unfold = useMemo(() => {
    const NX = 160;
    const NY = 80;
    const n = (NX + 1) * (NY + 1);
    const theta = new Float32Array(n);
    const lat = new Float32Array(n);
    for (let iy = 0; iy <= NY; iy++)
      for (let ix = 0; ix <= NX; ix++) {
        const k = iy * (NX + 1) + ix;
        theta[k] = -Math.PI + (2 * Math.PI * ix) / NX;
        lat[k] = 90 - (180 * iy) / NY;
      }
    const index: number[] = [];
    for (let iy = 0; iy < NY; iy++)
      for (let ix = 0; ix < NX; ix++) {
        const a = iy * (NX + 1) + ix;
        const b = a + NX + 1;
        index.push(a, b, a + 1, b, b + 1, a + 1);
      }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array(n * 3), 3));
    geometry.setAttribute("aTheta", new THREE.BufferAttribute(theta, 1));
    geometry.setAttribute("aLat", new THREE.BufferAttribute(lat, 1));
    geometry.setIndex(index);
    const F = BOARD_FRAME;
    const material = new THREE.ShaderMaterial({
      vertexShader: unfoldVert,
      fragmentShader: unfoldFrag,
      side: THREE.DoubleSide,
      toneMapped: false,
      uniforms: {
        uMap: { value: map },
        uInk: { value: sharedInk() },
        uMoon: { value: MOON },
        uAtmo: { value: ATMO },
        uM: { value: new THREE.Matrix3() },
        uO: { value: new THREE.Vector3() },
        uCr: { value: new THREE.Vector3() },
        uCu: { value: new THREE.Vector3() },
        uCd: { value: new THREE.Vector3() },
        uR: { value: GLOBE_R },
        uRc: { value: 1 },
        uH: { value: 1 },
        uLat0: { value: F.lat0 },
        uLat1: { value: F.lat1 },
        uLonC: { value: F.lonC },
        uK1: { value: 0 },
        uK2: { value: 0 },
        uTime: { value: 0 },
      },
    });
    // canonical sphere (front = the map's centre meridian, north up) → the globe's own frame
    const front = lonLat(F.lonC, 0, 1);
    const right = lonLat(F.lonC + 90, 0, 1);
    const toSphere = new THREE.Matrix4().makeBasis(right, new THREE.Vector3(0, 1, 0), front);
    return {
      geometry,
      material,
      toSphere,
      fromSphere: toSphere.clone().transpose(),
      q0: new THREE.Quaternion(),
      q1: new THREE.Quaternion(),
      q: new THREE.Quaternion(),
      m4: new THREE.Matrix4(),
      cr: new THREE.Vector3(),
      cu: new THREE.Vector3(),
      cd: new THREE.Vector3(),
      cam: new THREE.Vector3(),
      at: new THREE.Vector3(),
    };
  }, [map]);
  useEffect(
    () => () => {
      unfold.geometry.dispose();
      unfold.material.dispose();
    },
    [unfold],
  );

  /**
   * Opening into the map: the globe turns its centre meridian to us (align), latitudes
   * straighten into a cylinder (k1), and the cylinder unrolls flat and square on the screen,
   * at the size the board's camera will start from (k2).
   */
  const openInto = (t: number, time: number) => {
    const u = unfold;
    const opening = t > 0;
    if (earth.current) earth.current.visible = !opening;
    if (cloudShell.current) cloudShell.current.visible = !opening;
    if (lines.current) lines.current.visible = !opening;
    if (sheet.current) sheet.current.visible = opening;
    if (!opening || !group.current) return;
    const align = ease(t / 0.32);
    const k1 = ease((t - 0.22) / 0.38);
    const k2 = ease((t - 0.42) / 0.58);
    // the atmosphere thins away as it starts to open, and restores when rolling back
    atmoMat.uniforms.uBody.value = 1 - ease(t / 0.3);

    // follow the globe as it turns now (it keeps drifting): the hand-back to the real globe
    // at the end of the roll-up is then exact
    if (spin.current) spin.current.getWorldQuaternion(u.q0);
    // the camera's frame, in the globe's (the globe's parents only translate it)
    u.cr.set(1, 0, 0).applyQuaternion(camera.quaternion);
    u.cu.set(0, 1, 0).applyQuaternion(camera.quaternion);
    u.cd.set(0, 0, 1).applyQuaternion(camera.quaternion);
    group.current.getWorldPosition(u.at);
    u.cam.copy(camera.position).sub(u.at);
    // facing us squarely: canonical axes onto the camera's
    u.m4.makeBasis(u.cr, u.cu, u.cd).multiply(u.fromSphere);
    u.q1.setFromRotationMatrix(u.m4);
    u.q.copy(u.q0).slerp(u.q1, align);
    u.m4.makeRotationFromQuaternion(u.q).multiply(u.toSphere);
    const U = u.material.uniforms;
    U.uM.value.setFromMatrix4(u.m4);

    // the sheet: as deep as the globe's centre, UNFOLD_FILL of the screen's width
    const depth = u.cam.dot(u.cd);
    const tan = Math.tan(THREE.MathUtils.degToRad((camera as THREE.PerspectiveCamera).fov) / 2);
    const W = UNFOLD_FILL * 2 * depth * tan * (size.width / size.height);
    const rc = W / (2 * Math.PI);
    U.uRc.value = rc;
    U.uH.value = (W * (BOARD_FRAME.lat1 - BOARD_FRAME.lat0)) / 360;
    U.uO.value.copy(u.cam).addScaledVector(u.cd, -(depth + rc)).multiplyScalar(k1);
    U.uCr.value.copy(u.cr);
    U.uCu.value.copy(u.cu);
    U.uCd.value.copy(u.cd);
    U.uK1.value = k1;
    U.uK2.value = k2;
    U.uTime.value = time;
  };
  const motion = useRef({ yaw: 0, pitch: 0, vel: 0 });
  const places = useMemo(() => about.places.map((p) => lonLat(p.lon, p.lat, GLOBE_R * 1.008)), []);

  useFrame(({ clock }, delta) => {
    const dt = Math.min(delta, 0.1);
    const time = clock.elapsedTime;
    // the planet is already lit when the zoom-out from the valley reaches it (see ascent.ts);
    // as it settles, the grid comes in, the cities are marked and arcs fly out from home
    const g = globeG(sceneState.ascent.u);
    earthMat.uniforms.uBody.value = 1;
    earthMat.uniforms.uPower.value = 1.2;
    // thick cloud close in, thinning to a light cover once it hangs in space
    cloudMat.uniforms.uCloud.value = 1 - 0.5 * ease((g - 0.35) / 0.6);
    cloudMat.uniforms.uTime.value = time;
    const markersOn = ease((g - 0.86) / 0.12);
    markerMat.uniforms.uOn.value = markersOn;
    markerMat.uniforms.uTime.value = time;
    gridMat.uniforms.uOn.value = ease((g - 0.72) / 0.22);
    arcMat.uniforms.uDraw.value = ease((g - 0.88) / 0.12);
    arcMat.uniforms.uTime.value = time;

    // grab and spin: dragging turns it on its axis (yaw) and tips it toward you (pitch),
    // with momentum on release; it drifts on its own when left alone
    const live = !!group.current?.parent?.visible;
    const opening = sceneState.unfold.t;
    const grabbable = live && g >= 1 && opening === 0;
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
    // tipping only once it has settled; otherwise ease back
    m.pitch = grabbable ? THREE.MathUtils.clamp(m.pitch, -0.55, 0.55) : damp(m.pitch, 0, 6, dt);
    // while out of sight it rests turned home-side to the camera, so the zoom-out from the
    // valley comes up right above home
    if (!live && opening === 0) m.yaw = m.vel = m.pitch = 0;
    if (spin.current) spin.current.rotation.y = START_TURN + m.yaw + sceneState.mouse.x * 0.08;
    if (pitchGroup.current) pitchGroup.current.rotation.x = m.pitch;

    openInto(opening, time);
    if (!group.current) return;
    const parent = group.current.parent!;
    // the globe on screen, for the DOM drag target
    tmp.c.set(0, GLOBE_Y, 0).applyMatrix4(parent.matrixWorld);
    tmp.e.copy(tmp.c).addScaledVector(tmp.n.set(1, 0, 0).applyQuaternion(camera.quaternion), GLOBE_R);
    tmp.v.copy(tmp.c).project(camera);
    tmp.e.project(camera);
    const og = sceneState.globe;
    og.x = (tmp.v.x * 0.5 + 0.5) * size.width;
    og.y = (-tmp.v.y * 0.5 + 0.5) * size.height;
    og.r = Math.abs(tmp.e.x - tmp.v.x) * 0.5 * size.width;
    og.grabbable = grabbable;

    // city markers → screen, with how squarely each faces the camera
    if (spin.current) spin.current.updateWorldMatrix(true, false);
    // home's direction from the centre, for the camera's zoom-out
    if (spin.current) {
      tmp.v.copy(places[HOME]).applyMatrix4(spin.current.matrixWorld).sub(tmp.c).normalize();
      tmp.v.toArray(og.home);
    }
    sceneState.markers.length = places.length;
    places.forEach((p, i) => {
      const out = (sceneState.markers[i] ??= { x: 0, y: 0, facing: 0 });
      if (!live || !spin.current || markersOn <= 0 || opening > 0) {
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
  });

  return (
    <group ref={group} position-y={GLOBE_Y}>
      <group ref={pitchGroup}>
        <group rotation-z={TILT}>
          <group ref={spin}>
            <mesh ref={earth} material={earthMat} renderOrder={10}>
              <sphereGeometry args={[GLOBE_R, 160, 80]} />
            </mesh>
            <mesh ref={cloudShell} material={cloudMat} renderOrder={10.5}>
              <sphereGeometry args={[GLOBE_R * 1.008, 160, 80]} />
            </mesh>
            <group ref={lines}>
              <lineSegments geometry={gridGeo} material={gridMat} renderOrder={11} />
              <lineSegments geometry={borderGeo} material={borderMat} renderOrder={11} />
              <lineSegments geometry={arcGeo} material={arcMat} renderOrder={12} frustumCulled={false} />
              <points geometry={markerGeo} material={markerMat} renderOrder={13} frustumCulled={false} />
            </group>
          </group>
          <mesh material={atmoMat} scale={1.14} renderOrder={9}>
            <sphereGeometry args={[GLOBE_R, 64, 32]} />
          </mesh>
        </group>
      </group>
      <mesh ref={sheet} geometry={unfold.geometry} material={unfold.material} renderOrder={10} frustumCulled={false} visible={false} />
    </group>
  );
}

// start both loads at import time, never during render (the load tracker updates state)
useTexture.preload(NIGHT_URL);
useLoader.preload(THREE.FileLoader, BORDERS_URL, asBinary);
