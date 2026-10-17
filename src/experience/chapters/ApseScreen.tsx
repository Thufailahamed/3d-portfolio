"use client";

import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { useApp } from "@/store/useApp";
import { glowFrag, glowVert } from "./FlowGalleryDetails";

/** The studio reel, rendered from code (see the film shader) and looped on the apse screen. */
export const REEL_URL = "/video/synapx-reel.mp4";

const ASPECT = 16 / 9;
/** Screen width as a multiple of the rose window's diameter: a wall-sized cinema screen across the apse. */
const SPAN = 1.55;
/** Clearance in front of the apse frame, whose halo ring reaches ~4m out from the glass. */
const STANDOFF = 0.4;
const BEZEL = 0.07;

type Rig = { top: THREE.Vector3; drop: number; width: number; floor: number };

/**
 * A cinema screen suspended on two cables from the vault, hung in front of the gallery's rose
 * window and looping the SynapX reel. Measures the window at runtime so it follows the model.
 */
export default function ApseScreen({ model }: { model: THREE.Object3D }) {
  const mode = useApp((s) => s.mode);
  const sway = useRef<THREE.Group>(null);
  // Measure the rose window and the vault above it in model space, then map into the hall group
  // (the model sits in that group, so its local matrix takes model space to the screen's space)
  const rig = useMemo<Rig | null>(() => {
    const glass = model.getObjectByName("GalleryApseGlass");
    if (!glass) return null;
    model.updateMatrixWorld(true);
    const toModel = model.matrixWorld.clone().invert();
    const toGroup = (v: THREE.Vector3) => v.applyMatrix4(toModel).applyMatrix4(model.matrix);
    const box = new THREE.Box3().setFromObject(glass).applyMatrix4(toModel).applyMatrix4(model.matrix);
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    const width = Math.max(size.x, size.y) * SPAN;
    const height = width / ASPECT;
    const frame = model.getObjectByName("GalleryApseFrame");
    const front = frame
      ? new THREE.Box3().setFromObject(frame).applyMatrix4(toModel).applyMatrix4(model.matrix).max.z
      : box.max.z;
    const z = Math.max(front, box.max.z) + STANDOFF;

    // Cast up from the screen to find the vault, and down to find the floor
    const groupToWorld = model.matrixWorld.clone().multiply(model.matrix.clone().invert());
    const from = new THREE.Vector3(center.x, center.y + height / 2 + 0.05, z).applyMatrix4(groupToWorld);
    const cast = (dir: number) =>
      new THREE.Raycaster(from, new THREE.Vector3(0, dir, 0), 0, 30)
        .intersectObject(model, true)
        .find((h) => (h.object as THREE.Mesh).isMesh && h.object.visible && h.object !== glass);
    const up = cast(1);
    const down = cast(-1);
    const ceiling = up ? toGroup(up.point.clone()).y : center.y + height / 2 + 3.5;
    const floor = down ? toGroup(down.point.clone()).y : 0.885;

    return { top: new THREE.Vector3(center.x, ceiling, z), drop: ceiling - center.y, width, floor };
  }, [model]);

  const video = useMemo(() => {
    if (typeof document === "undefined") return null;
    const v = document.createElement("video");
    v.crossOrigin = "anonymous";
    v.loop = true;
    v.muted = true;
    v.playsInline = true;
    v.preload = "auto"; // only once a src is attached, in the pavilion
    v.setAttribute("webkit-playsinline", "");
    return v;
  }, []);

  // Each new video frame is copied into a canvas: uploading the <video> itself comes out black
  // on some ANGLE/D3D11 setups, and VideoTexture's frame callback dies on StrictMode's remount
  const frameCanvas = useMemo(() => {
    if (typeof document === "undefined") return null;
    const c = document.createElement("canvas");
    c.width = 960;
    c.height = 540;
    return c;
  }, []);

  const tex = useMemo(() => {
    if (!frameCanvas) return null;
    const t = new THREE.CanvasTexture(frameCanvas);
    t.colorSpace = THREE.SRGBColorSpace;
    t.minFilter = THREE.LinearFilter;
    t.magFilter = THREE.LinearFilter;
    t.generateMipmaps = false;
    return t;
  }, [frameCanvas]);

  const mats = useMemo(
    () => ({
      screen: new THREE.MeshBasicMaterial({ map: tex, toneMapped: false }),
      body: new THREE.MeshBasicMaterial({
        color: 0x020305,
        polygonOffset: true,
        polygonOffsetFactor: 1,
        polygonOffsetUnits: 1,
      }),
      line: new THREE.LineBasicMaterial({ color: 0xf5f7fa, transparent: true, opacity: 0.88, depthWrite: false }),
      cable: new THREE.LineBasicMaterial({ color: 0x8894a8, transparent: true, opacity: 0.75, depthWrite: false }),
      pool: new THREE.ShaderMaterial({
        vertexShader: glowVert,
        fragmentShader: glowFrag,
        uniforms: {
          uColor: { value: new THREE.Color("#e8eeff") },
          uIntensity: { value: 0.14 },
          uMode: { value: 0 },
        },
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    }),
    [tex],
  );

  // Bezel, cables and their clamps, built once the window has been measured
  const geos = useMemo(() => {
    if (!rig) return null;
    const w = rig.width;
    const h = w / ASPECT;
    const cy = -rig.drop; // screen centre, relative to the ceiling pivot
    const bezel = new THREE.BoxGeometry(w + BEZEL * 2, h + BEZEL * 2, 0.08);
    const ax = w * 0.36;
    const topY = cy + h / 2 + BEZEL;
    const cables = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(-ax, 0, 0),
      new THREE.Vector3(-ax, topY, 0),
      new THREE.Vector3(ax, 0, 0),
      new THREE.Vector3(ax, topY, 0),
    ]);
    const clamp = new THREE.BoxGeometry(0.1, 0.06, 0.1);
    return {
      w,
      h,
      cy,
      ax,
      topY,
      bezel,
      bezelEdges: new THREE.EdgesGeometry(bezel),
      cables,
      clamp,
      clampEdges: new THREE.EdgesGeometry(clamp),
      screen: new THREE.PlaneGeometry(w, h),
    };
  }, [rig]);

  useEffect(
    () => () => {
      if (!geos) return;
      for (const g of [geos.bezel, geos.bezelEdges, geos.cables, geos.clamp, geos.clampEdges, geos.screen]) g.dispose();
    },
    [geos],
  );
  useEffect(
    () => () => {
      for (const m of Object.values(mats)) m.dispose();
    },
    [mats],
  );

  // Fetch the reel (3MB) only once the visitor is inside, where the screen can be seen, and
  // release it on unmount (StrictMode mounts twice in dev)
  const flowView = useApp((s) => s.flowView);
  const inFlow = mode === "flow" && flowView !== "exterior" && flowView !== "drone";
  useEffect(() => {
    if (!video || !inFlow) return;
    if (!video.getAttribute("src")) {
      video.src = REEL_URL;
      video.load();
    }
  }, [video, inFlow]);
  useEffect(
    () => () => {
      if (!video) return;
      video.pause();
      video.removeAttribute("src");
      video.load();
    },
    [video],
  );
  useEffect(() => () => tex?.dispose(), [tex]);

  // Keep the reel rolling while the pavilion is on screen; muted autoplay is allowed everywhere,
  // but retry on the first interaction in case a browser still blocks it.
  useEffect(() => {
    if (!video) return;
    if (mode !== "flow") {
      video.pause();
      return;
    }
    const play = () => video.play().catch(() => {});
    play();
    window.addEventListener("pointerdown", play, { once: true });
    return () => window.removeEventListener("pointerdown", play);
  }, [video, mode]);

  // A slow pendulum drift, as if the air in the hall were moving
  const lastFrame = useRef(-1);
  useFrame((state) => {
    if (video && tex && frameCanvas && video.readyState >= 2 && video.currentTime !== lastFrame.current) {
      lastFrame.current = video.currentTime;
      frameCanvas.getContext("2d")?.drawImage(video, 0, 0, frameCanvas.width, frameCanvas.height);
      tex.needsUpdate = true;
    }
    if (!sway.current) return;
    const t = state.clock.elapsedTime;
    sway.current.rotation.z = Math.sin(t * 0.55) * 0.0035;
    sway.current.rotation.x = Math.sin(t * 0.41 + 1.2) * 0.0025;
  });

  if (!rig || !geos) return null;
  const clampAt = (x: number, y: number) => (
    <group position={[x, y, 0]} key={`${x}:${y}`}>
      <mesh geometry={geos.clamp} material={mats.body} />
      <lineSegments geometry={geos.clampEdges} material={mats.line} />
    </group>
  );

  return (
    <group>
      <group ref={sway} position={rig.top}>
        <lineSegments geometry={geos.cables} material={mats.cable} />
        {clampAt(-geos.ax, -0.03)}
        {clampAt(geos.ax, -0.03)}
        {clampAt(-geos.ax, geos.topY + 0.03)}
        {clampAt(geos.ax, geos.topY + 0.03)}
        <group position={[0, geos.cy, 0]}>
          <mesh geometry={geos.bezel} material={mats.body} position-z={-0.045} />
          <lineSegments geometry={geos.bezelEdges} material={mats.line} position-z={-0.045} />
          <mesh geometry={geos.screen} material={mats.screen} position-z={0.0} />
        </group>
      </group>
      {/* Light from the screen pooling on the marble below */}
      <mesh
        rotation-x={-Math.PI / 2}
        position={[rig.top.x, rig.floor + 0.02, rig.top.z + 2.2]}
        material={mats.pool}
      >
        <planeGeometry args={[geos.w * 1.6, 6]} />
      </mesh>
    </group>
  );
}
