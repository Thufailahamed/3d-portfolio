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
import { CARD_PX, caseNote, cardTexture, inkTexture, mapUv, NOTE_PX, type MapFrame } from "../boardArt";
import { corkFrag, dotFrag, dotVert, mapFrag, mapVert, reachFrag, reachVert, shadowFrag, shadowVert } from "../shaders/board";
import { NIGHT_URL } from "./Globe";

export const BOARD_URL = "/models/board.glb";
const PAPER_URL = "/board/paper-normal.webp";

/** The printed map: centred on 10°E, from the Southern Ocean to the Arctic. */
const FRAME: MapFrame = { lonC: 10, lat0: -58, lat1: 78 };
const MAP_W = 1.62;
const MAP_H = (MAP_W * (FRAME.lat1 - FRAME.lat0)) / 360;
const MAP_C: [number, number] = [0.04, -0.005];
/** The board's front face (the model is centred on the origin, facing +z). */
const FACE = 0.0085;
const HOME = 0;
/** The cork inside the frame. */
const CORK: [number, number] = [2.03, 1.105];

const CARD_W = 0.17;
const CARD_H = (CARD_W * CARD_PX.h) / CARD_PX.w;
const NOTE_W = 0.22;
const NOTE_H = (NOTE_W * NOTE_PX.h) / NOTE_PX.w;
/** Where each polaroid hangs (board-local), and its tilt. Top row above the map, bottom below. */
const SLOTS: { x: number; y: number; r: number }[] = [
  { x: -0.5, y: 0.392, r: 0.05 },
  { x: 0.06, y: 0.402, r: -0.035 },
  { x: 0.62, y: 0.388, r: 0.04 },
  { x: -0.7, y: -0.392, r: -0.045 },
  { x: -0.13, y: -0.402, r: 0.03 },
  { x: 0.44, y: -0.39, r: -0.05 },
];
const NOTE = { x: -0.86, y: 0.4, r: -0.06 };

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
    p.setZ(i, curl * (Math.pow(Math.abs(x * y), 2.2) * 0.9 + Math.pow(Math.max(0, -y), 3) * 0.6));
  }
  g.computeVertexNormals();
  return g;
}

/** Red thread from a card's pin to home: almost taut, a slight droop, lying just off the board. */
function threadGeometry(a: THREE.Vector3, b: THREE.Vector3) {
  const len = a.distanceTo(b);
  const mid = a.clone().lerp(b, 0.5);
  mid.y -= len * 0.025;
  mid.z = FACE + 0.007;
  const curve = new THREE.CatmullRomCurve3([a, a.clone().lerp(mid, 0.5).setZ(FACE + 0.01), mid, mid.clone().lerp(b, 0.5).setZ(FACE + 0.006), b]);
  return new THREE.TubeGeometry(curve, 96, 0.0019, 5, false);
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
      const v = a.clone().multiplyScalar(Math.sin((1 - u) * ang)).add(b.clone().multiplyScalar(Math.sin(u * ang))).divideScalar(Math.sin(ang));
      const lat = (Math.asin(THREE.MathUtils.clamp(v.y, -1, 1)) * 180) / Math.PI;
      const lon = (Math.atan2(v.z, v.x) * 180) / Math.PI;
      pts.push(onMap(lon, lat, FACE + 0.0025));
    }
    for (let s = 0; s < SEG; s++) {
      // a path that runs off one edge of the map comes back on the other: don't draw across
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
 * the night-lights map with the places the work reaches, a polaroid of each project strung
 * to home with red thread, and a case note. Cards lift under the pointer; one can be opened
 * (the camera moves in and the DOM shows its file).
 */
export default function Board() {
  const mode = useApp((s) => s.mode);
  const entered = useApp((s) => s.entered);
  const isMobile = useApp((s) => s.isMobile);
  const camera = useThree((s) => s.camera) as THREE.PerspectiveCamera;
  const size = useThree((s) => s.size);
  const dpr = useThree((s) => s.viewport.dpr);
  const { nodes } = useGLTF(BOARD_URL, "/draco/") as unknown as { nodes: Record<string, THREE.Mesh> };
  // one url per call: these match the preloads, so nothing starts loading during render
  const night = useTexture(NIGHT_URL);
  const paper = useTexture(PAPER_URL);
  const group = useRef<THREE.Group>(null);
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
    const spot = new THREE.SpotLight("#ffe2b8", 6, 6, 0.62, 0.9, 1.4);
    spot.position.set(-0.1, 1.25, 1.15);
    spot.target.position.set(0.05, 0.02, 0);
    return spot;
  }, []);

  const home = about.places[HOME];
  const hub = useMemo(() => onMap(home.lon, home.lat), [home]);

  const art = useMemo(() => {
    const on = { value: 0 };
    const time = { value: 0 };
    const focus = { value: 0 };
    const lampU = { uLampPos: { value: new THREE.Vector3() }, uLampDir: { value: new THREE.Vector3() } };
    const [hu, hv] = mapUv(home.lon, home.lat, FRAME);
    const map = new THREE.ShaderMaterial({
      vertexShader: mapVert,
      fragmentShader: mapFrag,
      toneMapped: false,
      uniforms: {
        uNight: { value: night },
        uPaper: { value: paper },
        uInk: { value: inkTexture(FRAME, HOME) },
        uRect: {
          value: new THREE.Vector4((FRAME.lonC - 180 + 180) / 360, (FRAME.lonC + 180 + 180) / 360, (FRAME.lat0 + 90) / 180, (FRAME.lat1 + 90) / 180),
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
    const reach = new THREE.ShaderMaterial({
      vertexShader: reachVert,
      fragmentShader: reachFrag,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      toneMapped: false,
      uniforms: { uColor: { value: new THREE.Color("#9fd0ff") }, uDraw: on, uTime: time, uFocus: focus },
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
    dotGeo.setAttribute("position", new THREE.Float32BufferAttribute(about.places.flatMap((p) => onMap(p.lon, p.lat, FACE + 0.003).toArray()), 3));
    dotGeo.setAttribute("aHome", new THREE.Float32BufferAttribute(about.places.map((_, i) => (i === HOME ? 1 : 0)), 1));

    const cards = projects.map((p, i) => {
      const slot = SLOTS[i % SLOTS.length];
      const pin = new THREE.Vector3(slot.x - Math.sin(slot.r) * CARD_H * 0.42, slot.y + Math.cos(slot.r) * CARD_H * 0.42, FACE + 0.012);
      const thread = threadGeometry(pin, hub.clone().setZ(FACE + 0.008));
      return {
        slot,
        pin,
        tex: cardTexture(p, i),
        thread,
        threadMat: new THREE.MeshStandardMaterial({ color: "#8e0f16", roughness: 0.75, emissive: new THREE.Color("#ff2a1f"), emissiveIntensity: 0 }),
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
    return {
      on,
      time,
      focus,
      lampU,
      map,
      cork,
      reach,
      reachGeo: reachGeometry(),
      dots,
      dotGeo,
      cards,
      cardGeo: curledPlane(CARD_W, CARD_H, 0.006),
      cardMats: cards.map((c) => new THREE.MeshStandardMaterial({ map: c.tex, color: "#cfcac2", roughness: 0.82, envMapIntensity: 0.05 })),
      cardShadows: cards.map(() => shadow(CARD_W, CARD_H)),
      note: new THREE.MeshStandardMaterial({ map: caseNote(), roughness: 0.9, envMapIntensity: 0.05 }),
      noteGeo: curledPlane(NOTE_W, NOTE_H, 0.004),
      noteShadow: shadow(NOTE_W, NOTE_H),
      wall: new THREE.MeshStandardMaterial({ color: "#16171a", roughness: 0.95, envMapIntensity: 0.02 }),
    };
  }, [night, paper, hub, home, dpr, size.height]);

  useEffect(
    () => () => {
      boardMat.dispose();
      for (const o of [art.map, art.cork, art.reach, art.reachGeo, art.dots, art.dotGeo, art.cardGeo, art.note, art.noteGeo, art.noteShadow, art.wall])
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
    const tl = gsap.timeline();
    if (isMobile) tl.fromTo(sceneState.board, { pan: -1 }, { pan: 0.35, duration: 3.6, ease: "power2.inOut" }, 0.2);
    tl.fromTo(lamp, { intensity: 0 }, { intensity: 6, duration: 1.4, ease: "power2.out" }, 0.1)
      .fromTo(art.on, { value: 0 }, { value: 1, duration: 2.6, ease: "power2.inOut" }, 0.5)
      .fromTo(art.cards, { draw: 0 }, { draw: 1, duration: 1.4, stagger: 0.12, ease: "power2.inOut" }, 0.9);
    // interrupted (strict mode, a resize): land on the finished board rather than a half-drawn one
    return () => {
      tl.progress(1).kill();
    };
  }, [mode, entered, art, lamp, isMobile]);

  const hover = useMemo(
    () => ({
      ray: new THREE.Raycaster(),
      ndc: new THREE.Vector2(),
      canHover: typeof matchMedia !== "undefined" && matchMedia("(hover: hover) and (pointer: fine)").matches,
      v: new THREE.Vector3(),
      w: new THREE.Vector3(),
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

    // the lamp, for the hand-lit map
    g.updateWorldMatrix(true, true);
    art.lampU.uLampPos.value.setFromMatrixPosition(lamp.matrixWorld);
    art.lampU.uLampDir.value.setFromMatrixPosition(lamp.target.matrixWorld).sub(art.lampU.uLampPos.value).normalize();

    const focus = useApp.getState().boardFocus;
    b.hover = hover.canHover && focus === null ? b.pick(sceneState.mouse.x, sceneState.mouse.y) : -1;
    const lit = b.hover >= 0 ? b.hover : b.hint;
    art.focus.value = THREE.MathUtils.damp(art.focus.value, focus === null ? 0 : 1, 4, dt);

    // cards lift toward the lamp under the pointer (or when open); their thread warms
    art.cards.forEach((c, i) => {
      const target = lit === i || focus === i ? 1 : 0;
      c.lift = THREE.MathUtils.damp(c.lift, target, target ? 9 : 5, dt);
      const ref = cardRefs.current[i];
      if (ref) {
        ref.position.z = FACE + 0.004 + c.lift * 0.035;
        ref.rotation.z = c.slot.r * (1 - c.lift * 0.6);
        ref.scale.setScalar(1 + c.lift * 0.06);
      }
      const idx = c.thread.index!;
      c.thread.setDrawRange(0, Math.floor((idx.count / 6) * c.draw) * 6);
      const dim = focus !== null && focus !== i ? 0.5 : 1;
      c.threadMat.emissiveIntensity = (0.12 + c.lift * 1.6) * dim;
      art.cardShadows[i].uniforms.uOpacity.value = 0.5 - c.lift * 0.12;
      art.cardShadows[i].uniforms.uBlur.value = 0.018 + c.lift * 0.03;
    });

    // where the camera wants to be: the whole board, or the open card (left of the file
    // panel on desktop, above the sheet on phones)
    const fov = THREE.MathUtils.degToRad(camera.fov);
    const tan = Math.tan(fov / 2);
    const aspect = size.width / size.height;
    const o = g.position;
    if (focus === null) {
      // the board fits the band between the heading (top) and the card index (bottom)
      const top = (isMobile ? 190 : 196) / size.height;
      const bottom = 1 - (isMobile ? 96 : 100) / size.height;
      const band = bottom - top;
      // phones are too narrow for the whole board: it fills the height, and you swipe along it
      const fitH = (1.165 * (isMobile ? 1.12 : 1.03)) / (band * 2 * tan);
      const d = isMobile ? fitH : Math.max(fitH, (2.108 * 1.04) / (0.96 * 2 * tan * aspect));
      const visH = 2 * d * tan;
      const visW = visH * aspect;
      const lift = ((top + bottom) / 2 - 0.5) * visH;
      const pan = Math.max(0, (2.108 * 1.04 - visW) / 2) * THREE.MathUtils.clamp(b.pan, -1, 1);
      b.look = [o.x + pan, o.y + lift, o.z];
      b.pos = [o.x + pan + sceneState.mouse.x * 0.06, o.y + lift + sceneState.mouse.y * 0.04, o.z + d];
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
      <hemisphereLight args={["#9fb4ff", "#1a1410", 0.12]} />

      {/* the wall it hangs on */}
      <mesh material={art.wall} position={[0, 0, -0.03]}>
        <planeGeometry args={[14, 9]} />
      </mesh>
      <mesh geometry={nodes.Board.geometry} material={boardMat} />
      <mesh material={art.cork} position-z={FACE + 0.0004}>
        <planeGeometry args={CORK} />
      </mesh>

      {/* the map, its places and the light threads from home */}
      <mesh material={art.map} position={[MAP_C[0], MAP_C[1], FACE + 0.001]}>
        <planeGeometry args={[MAP_W, MAP_H]} />
      </mesh>
      <lineSegments geometry={art.reachGeo} material={art.reach} renderOrder={2} frustumCulled={false} />
      <points geometry={art.dotGeo} material={art.dots} renderOrder={3} frustumCulled={false} />
      {pin && <mesh geometry={pin} material={boardMat} position={hub.clone().setZ(FACE)} scale={1.5} />}

      {/* the case note */}
      <group position={[NOTE.x, NOTE.y, FACE + 0.003]} rotation-z={NOTE.r}>
        <mesh material={art.noteShadow} position={[0.006, -0.01, -0.002]}>
          <planeGeometry args={[NOTE_W + 0.04, NOTE_H + 0.04]} />
        </mesh>
        <mesh geometry={art.noteGeo} material={art.note} />
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

useGLTF.preload(BOARD_URL, "/draco/");
useTexture.preload(PAPER_URL);
