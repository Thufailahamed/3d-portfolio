"use client";

import { useGLTF, useTexture } from "@react-three/drei";
import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { about, projects } from "@/content/site";
import { BOARD_ORIGIN } from "@/lib/chapters";
import { gsap } from "@/lib/gsap";
import { sceneState } from "@/lib/sceneState";
import { useApp } from "@/store/useApp";
import {
  CARD_PX,
  caseNote,
  cardTexture,
  BOARD_FRAME,
  mapUv,
  sharedInk,
  UNFOLD_FILL,
  NOTE_PX,
  telemetryNote,
  WALL_SHEET_PX,
  wallBlueprintLeft,
  wallBlueprintRight,
} from "../boardArt";
import {
  corkFrag,
  dotFrag,
  dotVert,
  mapFrag,
  mapVert,
  reachFrag,
  reachVert,
  shadowFrag,
  shadowVert,
  wallFrag,
} from "../shaders/board";
import { NIGHT_URL } from "./Globe";

export const BOARD_URL = "/models/board.glb";
export const PAPER_URL = "/board/paper-normal.webp";

/** The printed map: centred on 10°E, from the Southern Ocean to the Arctic, enlarged on the board. */
const FRAME = BOARD_FRAME;
const MAP_W = 1.72;
const MAP_H = (MAP_W * (FRAME.lat1 - FRAME.lat0)) / 360;
const MAP_C: [number, number] = [0.02, -0.005];
/** The board's front face (the model is centred on the origin, facing +z). */
const FACE = 0.0085;
const HOME = 0;
/** The cork inside the frame. */
const CORK: [number, number] = [2.03, 1.105];

const CARD_W = 0.2;
const CARD_H = (CARD_W * CARD_PX.h) / CARD_PX.w;
const NOTE_W = 0.23;
const NOTE_H = (NOTE_W * NOTE_PX.h) / NOTE_PX.w;
const WALL_W = 0.4;
const WALL_H = (WALL_W * WALL_SHEET_PX.h) / WALL_SHEET_PX.w;

/** Where each polaroid hangs (board-local), and its tilt. Top row above the map, bottom below. */
const SLOTS: { x: number; y: number; r: number }[] = [
  { x: -0.44, y: 0.398, r: 0.045 },
  { x: 0.13, y: 0.406, r: -0.032 },
  { x: 0.7, y: 0.394, r: 0.038 },
  { x: -0.71, y: -0.396, r: -0.042 },
  { x: -0.14, y: -0.406, r: 0.028 },
  { x: 0.42, y: -0.396, r: -0.045 },
];
const NOTE = { x: -0.84, y: 0.395, r: -0.055 };
const TELEM = { x: 0.83, y: -0.39, r: 0.048 };
const LEFT_SHEET = { x: -1.34, y: 0.02, z: -0.022, r: 0.015 };
const RIGHT_SHEET = { x: 1.34, y: -0.01, z: -0.022, r: -0.015 };

/** Map position (board-local) of a lon/lat. */
function onMap(lon: number, lat: number, z = FACE + 0.0015) {
  const [u, v] = mapUv(lon, lat, FRAME);
  return new THREE.Vector3(MAP_C[0] + (u - 0.5) * MAP_W, MAP_C[1] + (v - 0.5) * MAP_H, z);
}

/** A sheet of paper with its corners curling off the cork. */
function curledPlane(w: number, h: number, curl: number) {
  const g = new THREE.PlaneGeometry(w, h, 12, 12);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = (p.getX(i) / w) * 2;
    const y = (p.getY(i) / h) * 2;
    p.setZ(i, curl * (Math.pow(Math.abs(x * y), 2.2) * 0.85 + Math.pow(Math.max(0, -y), 3) * 0.5));
  }
  g.computeVertexNormals();
  return g;
}

/** Red thread from a card's pin to home: almost taut, a slight droop, lying just off the board. */
function threadGeometry(a: THREE.Vector3, b: THREE.Vector3, radius = 0.0019) {
  const len = a.distanceTo(b);
  const mid = a.clone().lerp(b, 0.5);
  mid.y -= len * 0.025;
  mid.z = FACE + 0.007;
  const curve = new THREE.CatmullRomCurve3([
    a,
    a.clone().lerp(mid, 0.5).setZ(FACE + 0.01),
    mid,
    mid.clone().lerp(b, 0.5).setZ(FACE + 0.006),
    b,
  ]);
  return new THREE.TubeGeometry(curve, 96, radius, 5, false);
}

/** Great-circle paths from home to the other places, flattened onto the map. */
function reachGeometry() {
  const SEG = 80;
  const pos: number[] = [];
  const t: number[] = [];
  const seed: number[] = [];
  const toVec = (lon: number, lat: number) => {
    const phi = (lon * Math.PI) / 180;
    const th = (lat * Math.PI) / 180;
    return new THREE.Vector3(Math.cos(th) * Math.cos(phi), Math.sin(th), Math.cos(th) * Math.sin(phi));
  };
  const home = about.places[HOME];
  const a = toVec(home.lon, home.lat);
  let k = 0;
  about.places.forEach((p, i) => {
    if (i === HOME) return;
    const b = toVec(p.lon, p.lat);
    const ang = a.angleTo(b);
    const pts: THREE.Vector3[] = [];
    for (let s = 0; s <= SEG; s++) {
      const u = s / SEG;
      const v = a
        .clone()
        .multiplyScalar(Math.sin((1 - u) * ang))
        .add(b.clone().multiplyScalar(Math.sin(u * ang)))
        .divideScalar(Math.sin(ang));
      const lat = (Math.asin(THREE.MathUtils.clamp(v.y, -1, 1)) * 180) / Math.PI;
      const lon = (Math.atan2(v.z, v.x) * 180) / Math.PI;
      pts.push(onMap(lon, lat, FACE + 0.0025));
    }
    for (let s = 0; s < SEG; s++) {
      if (Math.abs(pts[s].x - pts[s + 1].x) > MAP_W * 0.5) continue;
      pos.push(...pts[s].toArray(), ...pts[s + 1].toArray());
      t.push(s / SEG, (s + 1) / SEG);
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

/**
 * /board — the investigation board behind the About globe. A cork board under a desk lamp:
 * the enlarged night-lights map with the places the work reaches, a polaroid of each project
 * strung to home with red thread, field notes, and subtle architectural blueprints on the studio wall.
 */
export default function Board() {
  const mode = useApp((s) => s.mode);
  const entered = useApp((s) => s.entered);
  const isMobile = useApp((s) => s.isMobile);
  const camera = useThree((s) => s.camera) as THREE.PerspectiveCamera;
  const size = useThree((s) => s.size);
  const dpr = useThree((s) => s.viewport.dpr);
  const { nodes } = useGLTF(BOARD_URL, "/draco/") as unknown as { nodes: Record<string, THREE.Mesh> };
  const night = useTexture(NIGHT_URL);
  const paper = useTexture(PAPER_URL);
  const group = useRef<THREE.Group>(null);
  const fill = useRef<THREE.HemisphereLight>(null);
  const cardRefs = useRef<(THREE.Group | null)[]>([]);
  const meshRefs = useRef<(THREE.Mesh | null)[]>([]);

  useMemo(() => {
    night.wrapS = THREE.RepeatWrapping;
    night.needsUpdate = true;
  }, [night]);

  const boardMat = useMemo(() => {
    const m = (nodes.Board.material as THREE.MeshStandardMaterial).clone();
    m.envMapIntensity = 0.08;
    return m;
  }, [nodes]);

  const lamp = useMemo(() => {
    const spot = new THREE.SpotLight("#ffe2b8", 6, 7.5, 0.88, 0.92, 1.25);
    spot.position.set(-0.05, 1.25, 1.35);
    spot.target.position.set(0.02, 0.0, 0);
    return spot;
  }, []);

  const home = about.places[HOME];
  const hub = useMemo(() => onMap(home.lon, home.lat), [home]);

  const art = useMemo(() => {
    const on = { value: 1 };
    const time = { value: 0 };
    const focus = { value: 0 };
    const lampU = {
      uLampPos: { value: new THREE.Vector3() },
      uLampDir: { value: new THREE.Vector3() },
      uLampOn: { value: 1 },
    };
    const reachDraw = { value: 1 };
    const [hu, hv] = mapUv(home.lon, home.lat, FRAME);
    const map = new THREE.ShaderMaterial({
      vertexShader: mapVert,
      fragmentShader: mapFrag,
      toneMapped: false,
      uniforms: {
        uNight: { value: night },
        uPaper: { value: paper },
        uInk: { value: sharedInk() },
        uRect: {
          value: new THREE.Vector4(
            (FRAME.lonC - 180 + 180) / 360,
            (FRAME.lonC + 180 + 180) / 360,
            (FRAME.lat0 + 90) / 180,
            (FRAME.lat1 + 90) / 180,
          ),
        },
        uOn: on,
        uTime: time,
        uHub: { value: new THREE.Vector2(hu, hv) },
        uFocus: focus,
        ...lampU,
      },
    });
    const cork = new THREE.ShaderMaterial({
      vertexShader: mapVert,
      fragmentShader: corkFrag,
      uniforms: { uFocus: focus, ...lampU },
    });
    const wall = new THREE.ShaderMaterial({
      vertexShader: mapVert,
      fragmentShader: wallFrag,
      uniforms: { uFocus: focus, ...lampU },
    });
    const reach = new THREE.ShaderMaterial({
      vertexShader: reachVert,
      fragmentShader: reachFrag,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      toneMapped: false,
      uniforms: { uColor: { value: new THREE.Color("#9fd0ff") }, uDraw: reachDraw, uTime: time, uFocus: focus },
    });
    const dots = new THREE.ShaderMaterial({
      vertexShader: dotVert,
      fragmentShader: dotFrag,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      toneMapped: false,
      uniforms: {
        uColor: { value: new THREE.Color("#fff1d6") },
        uHome: { value: new THREE.Color("#c8ff3d") },
        uOn: on,
        uSize: { value: 0.045 },
        uPixelRatio: { value: dpr * size.height * 0.5 },
      },
    });
    const dotGeo = new THREE.BufferGeometry();
    dotGeo.setAttribute(
      "position",
      new THREE.Float32BufferAttribute(about.places.flatMap((p) => onMap(p.lon, p.lat, FACE + 0.003).toArray()), 3),
    );
    dotGeo.setAttribute("aHome", new THREE.Float32BufferAttribute(about.places.map((_, i) => (i === HOME ? 1 : 0)), 1));

    const cards = projects.map((p, i) => {
      const slot = SLOTS[i % SLOTS.length];
      const pin = new THREE.Vector3(
        slot.x - Math.sin(slot.r) * CARD_H * 0.42,
        slot.y + Math.cos(slot.r) * CARD_H * 0.42,
        FACE + 0.012,
      );
      const thread = threadGeometry(pin, hub.clone().setZ(FACE + 0.008));
      return {
        slot,
        pin,
        tex: cardTexture(p, i),
        thread,
        threadMat: new THREE.MeshStandardMaterial({
          color: "#8e0f16",
          roughness: 0.75,
          emissive: new THREE.Color("#ff2a1f"),
          emissiveIntensity: 0.14,
        }),
        lift: 0,
        /** how much of the thread has run home, 0..1 */
        draw: 1,
      };
    });

    const shadow = (w: number, h: number) =>
      new THREE.ShaderMaterial({
        vertexShader: shadowVert,
        fragmentShader: shadowFrag,
        transparent: true,
        depthWrite: false,
        uniforms: { uOpacity: { value: 0.55 }, uSize: { value: new THREE.Vector2(w, h) }, uBlur: { value: 0.02 } },
      });

    const leftTex = wallBlueprintLeft();
    const rightTex = wallBlueprintRight();

    return {
      on,
      reachDraw,
      time,
      focus,
      lampU,
      map,
      cork,
      wall,
      reach,
      reachGeo: reachGeometry(),
      dots,
      dotGeo,
      cards,
      cardGeo: curledPlane(CARD_W, CARD_H, 0.005),
      cardMats: cards.map(
        (c) =>
          new THREE.MeshStandardMaterial({
            map: c.tex,
            color: "#e6e1d8",
            roughness: 0.88,
            envMapIntensity: 0.04,
            emissive: new THREE.Color("#ffffff"),
            emissiveMap: c.tex,
            emissiveIntensity: 0.14,
          }),
      ),
      cardShadows: cards.map(() => shadow(CARD_W, CARD_H)),
      note: new THREE.MeshStandardMaterial({ map: caseNote(), roughness: 0.9, envMapIntensity: 0.05 }),
      telem: new THREE.MeshStandardMaterial({ map: telemetryNote(), roughness: 0.9, envMapIntensity: 0.05 }),
      leftSheetMat: new THREE.MeshStandardMaterial({
        map: leftTex,
        color: "#c8d6eb",
        roughness: 0.92,
        envMapIntensity: 0.02,
      }),
      rightSheetMat: new THREE.MeshStandardMaterial({
        map: rightTex,
        color: "#c8d6eb",
        roughness: 0.92,
        envMapIntensity: 0.02,
      }),
      wallSheetGeo: curledPlane(WALL_W, WALL_H, 0.003),
      wallSheetShadow: shadow(WALL_W, WALL_H),
      noteGeo: curledPlane(NOTE_W, NOTE_H, 0.004),
      noteShadow: shadow(NOTE_W, NOTE_H),
    };
  }, [night, paper, hub, home, dpr, size.height]);

  useEffect(
    () => () => {
      boardMat.dispose();
      for (const o of [
        art.map,
        art.cork,
        art.wall,
        art.reach,
        art.reachGeo,
        art.dots,
        art.dotGeo,
        art.cardGeo,
        art.note,
        art.telem,
        art.leftSheetMat,
        art.rightSheetMat,
        art.wallSheetGeo,
        art.wallSheetShadow,
        art.noteGeo,
        art.noteShadow,
      ])
        o.dispose();
      art.cards.forEach((c, i) => {
        c.tex.dispose();
        c.thread.dispose();
        c.threadMat.dispose();
        art.cardMats[i].dispose();
        art.cardShadows[i].dispose();
      });
    },
    [art, boardMat],
  );

  // arriving: the lamp warms up, the cities switch on east to west, the threads run home
  useEffect(() => {
    if (mode !== "board" || !entered) return;
    const b = sceneState.board;
    const tl = gsap.timeline();
    const lampOn = art.lampU.uLampOn;
    if (b.fromGlobe) {
      // through the globe: the map is already lit and filling the screen. The camera pulls
      // back off it as the lamp warms the board around it; then the threads run home
      b.fromGlobe = false;
      art.on.value = 1;
      if (isMobile) b.pan = 0.35; // phones pull back onto the Colombo end of the board
      tl.fromTo(b, { arrive: 0 }, { arrive: 1, duration: 3, ease: "power2.inOut" }, 0.25)
        .fromTo(lampOn, { value: 0 }, { value: 1, duration: 1.8, ease: "power1.inOut" }, 0.35)
        .fromTo(lamp, { intensity: 0 }, { intensity: 6, duration: 1.8, ease: "power1.inOut" }, 0.35)
        .fromTo(art.reachDraw, { value: 0 }, { value: 1, duration: 2.2, ease: "power2.out" }, 1.2)
        .fromTo(art.cards, { draw: 0 }, { draw: 1, duration: 1.4, stagger: 0.12, ease: "power2.inOut" }, 1.6);
    } else {
      b.arrive = 1;
      if (isMobile) tl.fromTo(b, { pan: -1 }, { pan: 0.35, duration: 3.6, ease: "power2.inOut" }, 0.2);
      tl.fromTo(lamp, { intensity: 0 }, { intensity: 6, duration: 1.4, ease: "power2.out" }, 0.1)
        .fromTo(lampOn, { value: 0 }, { value: 1, duration: 1.4, ease: "power2.out" }, 0.1)
        .fromTo(art.on, { value: 0 }, { value: 1, duration: 2.6, ease: "power2.inOut" }, 0.5)
        .fromTo(art.reachDraw, { value: 0 }, { value: 1, duration: 2.6, ease: "power2.inOut" }, 0.5)
        .fromTo(art.cards, { draw: 0 }, { draw: 1, duration: 1.4, stagger: 0.12, ease: "power2.inOut" }, 0.9);
    }
    return () => {
      tl.progress(1).kill();
    };
  }, [mode, entered, art, lamp, isMobile]);

  const hover = useMemo(
    () => ({
      ray: new THREE.Raycaster(),
      ndc: new THREE.Vector2(),
      canHover: typeof matchMedia !== "undefined" && matchMedia("(hover: hover) and (pointer: fine)").matches,
    }),
    [],
  );

  // clicks come from the DOM (the canvas never takes pointer events)
  useEffect(() => {
    const b = sceneState.board;
    b.pick = (x, y) => {
      if (!group.current?.visible) return -1;
      hover.ndc.set(x, y);
      hover.ray.setFromCamera(hover.ndc, camera);
      const meshes = meshRefs.current.filter((m): m is THREE.Mesh => !!m);
      const hit = hover.ray.intersectObjects(meshes, false)[0];
      return hit ? meshes.indexOf(hit.object as THREE.Mesh) : -1;
    };
    return () => {
      b.pick = () => -1;
      b.active = false;
    };
  }, [camera, hover]);

  useFrame((_, delta) => {
    const g = group.current;
    if (!g) return;
    const live = mode === "board";
    g.visible = live;
    const b = sceneState.board;
    b.active = live;
    if (!live) return;
    const dt = Math.min(delta, 0.1);
    art.time.value += dt;
    // a globe hand-off keeps the room dark until the arrival timeline takes over
    if (b.fromGlobe) {
      art.lampU.uLampOn.value = 0;
      lamp.intensity = 0;
      art.reachDraw.value = 0;
      for (const c of art.cards) c.draw = 0;
    }
    // heading back to the globe: the arrival in reverse, keyed to the camera's push back in
    if (b.leaving) {
      const k = b.arrive;
      art.lampU.uLampOn.value = Math.min(art.lampU.uLampOn.value, k);
      lamp.intensity = Math.min(lamp.intensity, 6 * k);
      art.reachDraw.value = Math.min(art.reachDraw.value, k);
      for (const c of art.cards) c.draw = Math.min(c.draw, THREE.MathUtils.smoothstep(k, 0.35, 0.9));
    }

    if (fill.current) fill.current.intensity = 0.14 * art.lampU.uLampOn.value;

    // the lamp, for the hand-lit map
    g.updateWorldMatrix(true, true);
    art.lampU.uLampPos.value.setFromMatrixPosition(lamp.matrixWorld);
    art.lampU.uLampDir.value.setFromMatrixPosition(lamp.target.matrixWorld).sub(art.lampU.uLampPos.value).normalize();

    const focus = useApp.getState().boardFocus;
    b.hover = hover.canHover && focus === null ? b.pick(sceneState.mouse.x, sceneState.mouse.y) : -1;
    const lit = b.hover >= 0 ? b.hover : b.hint;
    art.focus.value = THREE.MathUtils.damp(art.focus.value, focus === null ? 0 : 1, 4, dt);

    // cards lift toward the lamp under the pointer (or when open); their thread warms
    const focusDim = 1 - art.focus.value * 0.72;
    art.leftSheetMat.opacity = focusDim;
    art.rightSheetMat.opacity = focusDim;
    art.leftSheetMat.transparent = true;
    art.rightSheetMat.transparent = true;

    art.cards.forEach((c, i) => {
      const target = lit === i || focus === i ? 1 : 0;
      c.lift = THREE.MathUtils.damp(c.lift, target, target ? 9 : 5, dt);
      const ref = cardRefs.current[i];
      if (ref) {
        ref.position.z = FACE + 0.004 + c.lift * 0.038;
        ref.rotation.z = c.slot.r * (1 - c.lift * 0.72);
        ref.scale.setScalar(1 + c.lift * 0.065);
      }
      const idx = c.thread.index!;
      c.thread.setDrawRange(0, Math.floor((idx.count / 6) * c.draw) * 6);
      const dim = focus !== null && focus !== i ? 0.38 : 1;
      c.threadMat.emissiveIntensity = (0.12 + c.lift * 1.6) * dim;
      // (the room's fill and the cards' glow go with the lamp: a dark lamp is a dark room)
      art.cardMats[i].emissiveIntensity = (0.15 + c.lift * 0.16) * dim * art.lampU.uLampOn.value;
      art.cardShadows[i].uniforms.uOpacity.value = 0.54 - c.lift * 0.14;
      art.cardShadows[i].uniforms.uBlur.value = 0.02 + c.lift * 0.032;
    });

    // where the camera wants to be: the whole board, or the open card
    const fov = THREE.MathUtils.degToRad(camera.fov);
    const tan = Math.tan(fov / 2);
    const aspect = size.width / size.height;
    const o = g.position;
    if (focus === null) {
      const top = (isMobile ? 186 : 184) / size.height;
      const bottom = 1 - (isMobile ? 96 : 92) / size.height;
      const band = bottom - top;
      const fitH = (1.165 * (isMobile ? 1.12 : 1.03)) / (band * 2 * tan);
      const d = isMobile ? fitH : Math.max(fitH, (2.108 * 1.03) / (0.96 * 2 * tan * aspect));
      const visH = 2 * d * tan;
      const visW = visH * aspect;
      const lift = ((top + bottom) / 2 - 0.5) * visH;
      const pan = Math.max(0, (2.108 * 1.03 - visW) / 2) * THREE.MathUtils.clamp(b.pan, -1, 1);
      b.look = [o.x + pan, o.y + lift, o.z];
      b.pos = [o.x + pan + sceneState.mouse.x * 0.06, o.y + lift + sceneState.mouse.y * 0.04, o.z + d];
      // arriving from the globe: start square on the map, at the size the unfolded globe had
      if (b.arrive < 1) {
        const k = b.arrive;
        const mx = o.x + MAP_C[0];
        const my = o.y + MAP_C[1];
        const d0 = FACE + MAP_W / (UNFOLD_FILL * 2 * tan * aspect);
        b.look = [mx + (b.look[0] - mx) * k, my + (b.look[1] - my) * k, o.z];
        b.pos = [mx + (b.pos[0] - mx) * k, my + (b.pos[1] - my) * k, o.z + d0 + (b.pos[2] - o.z - d0) * k];
      }
    } else {
      const c = art.cards[focus];
      const d = (CARD_H / (isMobile ? 0.24 : 0.44)) / 2 / tan;
      const visW = 2 * d * tan * aspect;
      const visH = 2 * d * tan;
      const x = o.x + c.slot.x + (isMobile ? 0 : visW * 0.2);
      const y = o.y + c.slot.y - (isMobile ? visH * 0.25 : 0);
      b.look = [x, y, o.z];
      b.pos = [x + sceneState.mouse.x * 0.02, y + sceneState.mouse.y * 0.015, o.z + d];
    }
  });

  const pin = nodes.Pin?.geometry;
  return (
    <group ref={group} position={BOARD_ORIGIN} visible={false}>
      <primitive object={lamp} />
      <primitive object={lamp.target} />
      <hemisphereLight ref={fill} args={["#9fb4ff", "#1a1410", 0.14]} />

      {/* the wall it hangs on */}
      <mesh key="wall" material={art.wall} position={[0, 0, -0.03]}>
        <planeGeometry args={[14, 9]} />
      </mesh>
      <mesh key="board-frame" geometry={nodes.Board.geometry} material={boardMat} />
      <mesh key="cork" material={art.cork} position={[0, 0, FACE + 0.0004]}>
        <planeGeometry args={CORK} />
      </mesh>

      {/* the map, its places and the light threads from home */}
      <mesh key="map" material={art.map} position={[MAP_C[0], MAP_C[1], FACE + 0.001]}>
        <planeGeometry args={[MAP_W, MAP_H]} />
      </mesh>
      <lineSegments key="reach" geometry={art.reachGeo} material={art.reach} renderOrder={2} frustumCulled={false} />
      <points key="dots" geometry={art.dotGeo} material={art.dots} renderOrder={3} frustumCulled={false} />
      {pin && <mesh key="hub-pin" geometry={pin} material={boardMat} position={hub.clone().setZ(FACE)} scale={1.5} />}

      {/* Left studio wall blueprint sheet */}
      <group key="left-sheet" position={[LEFT_SHEET.x, LEFT_SHEET.y, LEFT_SHEET.z]} rotation-z={LEFT_SHEET.r}>
        <mesh material={art.wallSheetShadow} position={[0.008, -0.012, -0.003]}>
          <planeGeometry args={[WALL_W + 0.05, WALL_H + 0.05]} />
        </mesh>
        <mesh geometry={art.wallSheetGeo} material={art.leftSheetMat} />
        {pin && <mesh geometry={pin} material={boardMat} position={[0, WALL_H * 0.44, 0.006]} scale={1.1} />}
      </group>

      {/* Right studio wall topology sheet */}
      <group key="right-sheet" position={[RIGHT_SHEET.x, RIGHT_SHEET.y, RIGHT_SHEET.z]} rotation-z={RIGHT_SHEET.r}>
        <mesh material={art.wallSheetShadow} position={[0.008, -0.012, -0.003]}>
          <planeGeometry args={[WALL_W + 0.05, WALL_H + 0.05]} />
        </mesh>
        <mesh geometry={art.wallSheetGeo} material={art.rightSheetMat} />
        {pin && <mesh geometry={pin} material={boardMat} position={[0, WALL_H * 0.44, 0.006]} scale={1.1} />}
      </group>

      {/* the case note */}
      <group key="case-note" position={[NOTE.x, NOTE.y, FACE + 0.003]} rotation-z={NOTE.r}>
        <mesh material={art.noteShadow} position={[0.006, -0.01, -0.002]}>
          <planeGeometry args={[NOTE_W + 0.04, NOTE_H + 0.04]} />
        </mesh>
        <mesh geometry={art.noteGeo} material={art.note} />
        {pin && <mesh geometry={pin} material={boardMat} position={[0, NOTE_H * 0.4, 0.002]} />}
      </group>

      {/* the telemetry blueprint note */}
      <group key="telem-note" position={[TELEM.x, TELEM.y, FACE + 0.003]} rotation-z={TELEM.r}>
        <mesh material={art.noteShadow} position={[0.006, -0.01, -0.002]}>
          <planeGeometry args={[NOTE_W + 0.04, NOTE_H + 0.04]} />
        </mesh>
        <mesh geometry={art.noteGeo} material={art.telem} />
        {pin && <mesh geometry={pin} material={boardMat} position={[0, NOTE_H * 0.4, 0.002]} />}
      </group>

      {/* the projects */}
      {art.cards.map((c, i) => (
        <group key={projects[i].slug}>
          <mesh geometry={c.thread} material={c.threadMat} />
          <group
            ref={(el) => {
              cardRefs.current[i] = el;
            }}
            position={[c.slot.x, c.slot.y, FACE + 0.004]}
            rotation-z={c.slot.r}
          >
            <mesh material={art.cardShadows[i]} position={[0.008, -0.012, -0.003]}>
              <planeGeometry args={[CARD_W + 0.04, CARD_H + 0.04]} />
            </mesh>
            <mesh
              ref={(el) => {
                meshRefs.current[i] = el;
              }}
              geometry={art.cardGeo}
              material={art.cardMats[i]}
            />
          </group>
          {pin && <mesh geometry={pin} material={boardMat} position={c.pin} />}
        </group>
      ))}
    </group>
  );
}

