"use client";

import { Grid, OrbitControls, useGLTF } from "@react-three/drei";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Bloom, EffectComposer, N8AO, ToneMapping } from "@react-three/postprocessing";
import { ToneMappingMode } from "postprocessing";
import { Suspense, useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { Sky } from "three/examples/jsm/objects/Sky.js";
import type { OrbitControls as OrbitControlsImpl } from "three-stdlib";
import { BUILDING_URL, litGeometry, smoothGeometry } from "@/experience/chapters/BuildingFlow";
import { triplanar } from "@/experience/real/materials";
import { loadTextures } from "@/experience/real/textures";

/**
 * The drawing set built up as a model: the pavilion's real meshes start flattened onto the ground
 * (seen from above, at night, they are the site plan), then the sun comes up and the camera swings
 * into an aerial view while the building assembles stage by stage in its real materials —
 * foundation, walls, colonnades, roof, fit-out. Afterwards it is a model to orbit, cut away and replay.
 */

const DURATION = 11;
/** Plan centre of the complex (pavilion-local): portico, wings, rotunda and the 36 m hall. */
const CENTER = new THREE.Vector3(1, 0, -15.5);
/** Late-afternoon sun from the front left: long shadows across the portico and down the steps. */
const SUN = new THREE.Vector3(-0.6, 0.36, 0.71).normalize();

type StageId = 0 | 1 | 2 | 3 | 4;
const STAGES: { title: string; note: string; window: [number, number] }[] = [
  { title: "Foundation", note: "Stylobate 54 × 28 m, eight steps and the hall floor at +0.88", window: [0.13, 0.35] },
  { title: "Walls", note: "Ashlar facade 52 m, nave walls 1.2 m thick, six arched niches", window: [0.28, 0.52] },
  { title: "Colonnades", note: "Portico, wings and rotunda rise, radiating from the portal", window: [0.43, 0.71] },
  { title: "Roof", note: "Entablature, pediment to +11.73, barrel vault and dome set in place", window: [0.63, 0.88] },
  { title: "Fit-out", note: "Nero marble plinths, glass vitrines, brass and the rose window", window: [0.8, 0.98] },
];

/** Which stage a model mesh belongs to, and whether it is lowered in (roof) or grown up from the plan. */
function stageOf(name: string): { stage: StageId; drop: boolean } {
  if (/^(GrandStylobate|GalleryFloor|FloorBrassInlays)/.test(name)) return { stage: 0, drop: false };
  if (/^(MainFacadeWalls|GalleryOuterWalls|ArchedWallNiches|NichePilasters|PortalDoorFrame|PortalGlowFrame)/.test(name))
    return { stage: 1, drop: false };
  if (/Col_/.test(name)) return { stage: 2, drop: false };
  if (/^(Entablature|PorticoPediment|RotundaDome|GalleryBarrelVault|VaultArchRibs|GallerySkylight)/.test(name))
    return { stage: 3, drop: true };
  return { stage: 4, drop: false };
}

const ROOF = /^(GalleryBarrelVault|VaultArchRibs|GallerySkylight)/;
const SEE_THROUGH = /^(Vitrine_|GallerySkylight|GalleryApseGlass)/;

type Part = {
  mesh: THREE.Mesh;
  stage: StageId;
  drop: boolean;
  base: number;
  /** 0..1 start offset inside its stage window (columns radiate out from the portal) */
  lag: number;
  roof: boolean;
  shadow: boolean;
};

const ease = (x: number) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);
const easeOutBack = (x: number) => {
  const c1 = 1.4;
  return 1 + (c1 + 1) * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2);
};
const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
const smooth = (a: number, b: number, x: number) => {
  const k = clamp01((x - a) / (b - a));
  return k * k * (3 - 2 * k);
};

/** Shared animation state between the DOM controls and the render loop (no React renders per frame). */
type Sim = { t: number; playing: boolean; cut: number; cutTarget: number; interacted: boolean };

/**
 * The pavilion's real materials, as in the realistic render: triplanar ashlar, stone, plaster,
 * polished marble and nero, bronze, brass, glass and the lit apse — on this view's own renderer.
 */
function makeMaterials(gl: THREE.WebGLRenderer) {
  const { sets: tex } = loadTextures(gl);
  // dry: this model stands in the afternoon sun whatever the weather is in the pavilion
  const t = (o: Parameters<typeof triplanar>[1]) => triplanar(tex, { ...o, wet: 0, puddles: 0 });
  const m = {
    // limestone and travertine tints: warm, a little below white so the sun can model them
    steps: t({ kind: "paving", scale: 3.2, tint: 0xd9d0c2, polygonOffset: 1 }),
    ashlar: t({ kind: "ashlar", normalScale: 1.3, tint: 0xddd2c0 }),
    hallAshlar: t({ kind: "ashlar", tint: 0xe6dccb, side: THREE.DoubleSide, polygonOffset: -1 }),
    stoneLight: t({ kind: "stone", tint: 0xe2d8c7 }),
    stone: t({ kind: "stone", tint: 0xd2c8b6 }),
    vault: t({ kind: "plaster", tint: 0xe4d9c6, side: THREE.DoubleSide }),
    hallStone: t({ kind: "stone", tint: 0xf3ece0, side: THREE.DoubleSide, polygonOffset: -1 }),
    marbleFloor: t({ kind: "marble", physical: { clearcoat: 1, clearcoatRoughness: 0.04 } }),
    nero: t({ kind: "nero", physical: { clearcoat: 1, clearcoatRoughness: 0.05 } }),
    bronze: t({ kind: "bronze", metalness: 1, roughness: 1 }),
    grass: t({ kind: "grass", scale: 3.0, normalScale: 1.3 }),
    paving: t({ kind: "paving", normalScale: 1.1, tint: 0x9d958a, polygonOffset: -2 }),
    brass: new THREE.MeshStandardMaterial({ color: 0xc9a25e, metalness: 1, roughness: 0.28 }),
    glass: new THREE.MeshPhysicalMaterial({
      color: 0xffffff,
      roughness: 0.02,
      transparent: true,
      opacity: 0.18,
      depthWrite: false,
      clearcoat: 1,
      clearcoatRoughness: 0,
    }),
    skylight: new THREE.MeshPhysicalMaterial({
      color: 0xdcecff,
      roughness: 0.04,
      metalness: 0.1,
      transparent: true,
      opacity: 0.4,
      depthWrite: false,
      clearcoat: 1,
    }),
    apse: new THREE.MeshStandardMaterial({ color: 0x000000, emissive: 0xfff3df, emissiveIntensity: 2.2, roughness: 0.25 }),
    portal: new THREE.MeshStandardMaterial({ color: 0x000000, emissive: 0xffd9a8, emissiveIntensity: 2.0 }),
    gold: new THREE.MeshPhysicalMaterial({ color: 0xf2c46a, metalness: 1, roughness: 0.16, clearcoat: 0.6 }),
    chrome: new THREE.MeshStandardMaterial({ color: 0xe6e9ee, metalness: 1, roughness: 0.06 }),
  };
  return m;
}

type Mats = ReturnType<typeof makeMaterials>;

/** The same mapping the realistic pavilion uses (BuildingFlow's realMaterialFor). */
function materialFor(name: string, m: Mats, artifact: number): THREE.Material {
  if (name === "GrandStylobate") return m.steps;
  if (name === "MainFacadeWalls" || name === "GalleryOuterWalls") return m.ashlar;
  if (name === "ArchedWallNiches" || name === "NichePilasters") return m.hallAshlar;
  if (/^(PorticoCol|WingCol|RotundaCol)/.test(name)) return m.stoneLight;
  if (name === "Entablature" || name === "PorticoPediment") return m.stoneLight;
  if (name === "RotundaDome") return m.stone;
  if (name === "GalleryBarrelVault") return m.vault;
  if (name === "VaultArchRibs" || name === "GalleryApseFrame") return m.hallStone;
  if (name === "GalleryFloor") return m.marbleFloor;
  if (name === "FloorBrassInlays" || name.startsWith("VitrineFrame_")) return m.brass;
  if (name === "GalleryApseGlass") return m.apse;
  if (name === "GallerySkylight") return m.skylight;
  if (name.startsWith("Vitrine_")) return m.glass;
  if (name.startsWith("ShowcasePlinth_")) return m.nero;
  if (name.startsWith("Artifact_")) return artifact % 2 === 0 ? m.gold : m.chrome;
  if (name === "PortalDoorFrame") return m.bronze;
  if (name === "PortalGlowFrame") return m.portal;
  return m.stone;
}

/** The pavilion's meshes as model parts: baked to scene space, real materials, staged construction lines. */
function buildModel(scene: THREE.Object3D, mats: Mats) {
  // construction lines per stage: blueprint-pale on the plan, lime while rising, gone once it stands
  const edges = STAGES.map(
    () => new THREE.LineBasicMaterial({ color: "#cfe3ff", transparent: true, opacity: 0.75, depthWrite: false, fog: false }),
  );

  const group = new THREE.Group();
  const parts: Part[] = [];
  const disposables: THREE.BufferGeometry[] = [];
  scene.updateMatrixWorld(true);
  const toScene = new THREE.Matrix4().copy(scene.matrixWorld).invert();
  const rel = new THREE.Matrix4();
  const portal = new THREE.Vector3(0, 0, -1);
  let artifact = 0;

  scene.traverse((o) => {
    const src = o as THREE.Mesh;
    if (!src.isMesh || !src.visible) return;
    if (/^(PortalSilhouetteFigure|PlazaEnterButton|ReflectivePlaza|FriezeText|Label_|Plaque_)/.test(src.name)) return;
    // the blueprint keeps the original geometry in userData while the realistic look is on
    const orig = (src.userData.xrayGeo as THREE.BufferGeometry | undefined) ?? src.geometry;
    const shaded = src.name === "RotundaDome" ? smoothGeometry(orig) : litGeometry(orig);
    rel.multiplyMatrices(toScene, src.matrixWorld);
    const geo = shaded.clone().applyMatrix4(rel);
    geo.computeBoundingBox();
    disposables.push(geo);
    const { stage, drop } = stageOf(src.name);
    const mesh = new THREE.Mesh(geo, materialFor(src.name, mats, src.name.startsWith("Artifact_") ? artifact++ : 0));
    mesh.castShadow = !SEE_THROUGH.test(src.name);
    mesh.receiveShadow = true;
    mesh.name = src.name;
    // reuse the blueprint's edge lines (already computed for the hidden-line look)
    const line = src.children.find((c) => (c as THREE.LineSegments).isLineSegments) as THREE.LineSegments | undefined;
    if (line) {
      const lg = (line.geometry as THREE.BufferGeometry).clone().applyMatrix4(rel.clone().multiply(line.matrix));
      disposables.push(lg);
      const seg = new THREE.LineSegments(lg, edges[stage]);
      seg.renderOrder = 2;
      mesh.add(seg);
    }
    const box = geo.boundingBox!;
    const c = box.getCenter(new THREE.Vector3());
    const lag = stage === 2 ? Math.min(1, Math.hypot(c.x - portal.x, c.z - portal.z) / 32) : stage === 4 ? Math.min(1, -c.z / 40) : 0;
    parts.push({ mesh, stage, drop, base: box.min.y, lag, roof: ROOF.test(src.name), shadow: mesh.castShadow });
    group.add(mesh);
  });

  return { group, parts, edges, disposables };
}

type Built = ReturnType<typeof buildModel>;

/** Grow each part up out of the plan, or (the roof) lower it into place; the cutaway lifts the vault. */
function animateParts(built: Built, t: number, cut: number) {
  for (const part of built.parts) {
    const [w0, w1] = STAGES[part.stage].window;
    const span = w1 - w0;
    const start = w0 + part.lag * span * 0.45;
    const p = clamp01((t - start) / (span * 0.55));
    const m = part.mesh;
    // cutaway: the vault floats up off the hall like the lid of an architect's model
    const lift = part.roof ? cut * 11 : 0;
    if (part.roof) m.castShadow = part.shadow && cut < 0.4;
    if (part.drop) {
      m.visible = p > 0;
      m.scale.y = 1;
      m.position.y = (1 - easeOutBack(p)) * 7 + lift;
    } else {
      const s = Math.max(0.002, ease(p));
      m.visible = true;
      m.scale.y = s;
      m.position.y = part.base * (1 - s) + lift;
    }
  }
}

/** Sun, sky, environment light, ground and fog: from a blueprint night to an afternoon. */
function makeWorld(gl: THREE.WebGLRenderer, mats: Mats) {
  const sky = new Sky();
  sky.scale.setScalar(900);
  const su = sky.material.uniforms;
  su.turbidity.value = 5.5;
  su.rayleigh.value = 1.4;
  su.mieCoefficient.value = 0.004;
  su.mieDirectionalG.value = 0.86;
  su.sunPosition.value.copy(SUN).multiplyScalar(400);

  // image-based light from the same sky, so stone, marble and brass reflect it
  const pmrem = new THREE.PMREMGenerator(gl);
  const envScene = new THREE.Scene();
  const envSky = new Sky();
  envSky.scale.setScalar(900);
  envSky.material.uniforms.turbidity.value = 5.5;
  envSky.material.uniforms.rayleigh.value = 1.4;
  envSky.material.uniforms.mieCoefficient.value = 0.004;
  envSky.material.uniforms.mieDirectionalG.value = 0.86;
  envSky.material.uniforms.sunPosition.value.copy(SUN).multiplyScalar(400);
  envScene.add(envSky);
  const envRT = pmrem.fromScene(envScene, 0, 0.1, 1000);

  // the blueprint night: a dark dome inside the sky that clears as the sun comes up
  const night = new THREE.Mesh(
    new THREE.SphereGeometry(300, 32, 16),
    new THREE.MeshBasicMaterial({ color: "#05080d", side: THREE.BackSide, transparent: true, depthWrite: false, fog: false }),
  );
  night.renderOrder = -1;

  const ground = new THREE.Group();
  const grass = new THREE.Mesh(new THREE.PlaneGeometry(700, 700), mats.grass);
  grass.rotation.x = -Math.PI / 2;
  grass.position.set(CENTER.x, -0.44, CENTER.z);
  grass.receiveShadow = true;
  // a paved forecourt and terrace around the pavilion
  const plaza = new THREE.Mesh(new THREE.PlaneGeometry(72, 80), mats.paving);
  plaza.rotation.x = -Math.PI / 2;
  plaza.position.set(1, -0.43, -6);
  plaza.receiveShadow = true;
  ground.add(grass, plaza);

  return { sky, night, ground, env: envRT.texture, dispose: () => [envRT.dispose(), pmrem.dispose(), envSky.material.dispose(), (envSky.geometry as THREE.BufferGeometry).dispose(), sky.material.dispose(), (night.material as THREE.Material).dispose(), night.geometry.dispose(), grass.geometry.dispose(), plaza.geometry.dispose()] };
}

type World = ReturnType<typeof makeWorld>;

/** Light and atmosphere for the moment in the build: day 0 is the blueprint, 1 the afternoon. */
function applyDay(world: World, scene: THREE.Scene, day: number, lights: { sun: THREE.DirectionalLight; hemi: THREE.HemisphereLight }, cam: THREE.Camera) {
  const nightMat = world.night.material as THREE.MeshBasicMaterial;
  nightMat.opacity = 1 - day;
  world.night.visible = day < 0.999;
  world.night.position.copy(cam.position);
  world.sky.position.copy(cam.position);
  // (the sky is HDR: its image-based light only needs a fraction to fill the shadows)
  scene.environmentIntensity = 0.03 + 0.2 * day;
  lights.sun.intensity = 3.4 * day;
  lights.hemi.intensity = 0.03 + 0.1 * day;
  const fog = scene.fog as THREE.Fog | null;
  if (fog) {
    fog.color.setRGB(0.02 + 0.5 * day, 0.03 + 0.56 * day, 0.05 + 0.64 * day, THREE.SRGBColorSpace);
    fog.near = 120 + 110 * day;
    fog.far = 260 + 340 * day;
  }
}

/** Image-based light for every material in the view (kept out of the component: it mutates the scene). */
function setEnvironment(scene: THREE.Scene, env: THREE.Texture | null) {
  scene.environment = env;
}

function Scene({ simRef, onStage }: { simRef: React.RefObject<Sim>; onStage: (s: number) => void }) {
  const { scene: model } = useGLTF(BUILDING_URL, "/draco/");
  const gl = useThree((s) => s.gl);
  const scene = useThree((s) => s.scene);
  const camera = useThree((s) => s.camera) as THREE.PerspectiveCamera;
  const controls = useRef<OrbitControlsImpl>(null);
  const sun = useRef<THREE.DirectionalLight>(null);
  const hemi = useRef<THREE.HemisphereLight>(null);
  const grid = useRef<THREE.Mesh>(null);

  // built imperatively and held in refs: the render loop animates these objects every frame
  const holder = useRef<THREE.Group>(null);
  const builtRef = useRef<Built | null>(null);
  const worldRef = useRef<World | null>(null);
  useEffect(() => {
    const mats = makeMaterials(gl);
    const built = buildModel(model, mats);
    const world = makeWorld(gl, mats);
    const parent = holder.current;
    builtRef.current = built;
    worldRef.current = world;
    parent?.add(built.group, world.sky, world.night, world.ground);
    setEnvironment(scene, world.env);
    return () => {
      parent?.remove(built.group, world.sky, world.night, world.ground);
      setEnvironment(scene, null);
      builtRef.current = null;
      worldRef.current = null;
      built.disposables.forEach((g) => g.dispose());
      built.edges.forEach((m) => m.dispose());
      Object.values(mats).forEach((m) => m.dispose());
      world.dispose();
    };
  }, [model, gl, scene]);

  const poseRef = useRef({
    planDir: new THREE.Vector3(0, 1, 0),
    planUp: new THREE.Vector3(0, 0, -1),
    worldUp: new THREE.Vector3(0, 1, 0),
    aerialDir: new THREE.Vector3(0.66, 0.33, 0.67).normalize(),
    dir: new THREE.Vector3(),
    aerialDist: 80,
    lastStage: -1,
    plan: new THREE.Color("#cfe3ff"),
    live: new THREE.Color("#c8ff3d"),
  });

  useFrame((_, dt) => {
    const sim = simRef.current;
    const pose = poseRef.current;
    const built = builtRef.current;
    const world = worldRef.current;
    if (!built || !world) return;
    const step = Math.min(dt, 1 / 20);
    if (sim.playing) {
      sim.t = Math.min(1, sim.t + step / DURATION);
      if (sim.t >= 1) sim.playing = false;
    }
    sim.cut += (sim.cutTarget - sim.cut) * (1 - Math.exp(-5 * step));
    const t = sim.t;

    // camera: straight down on the plan (north up), then swinging into the aerial three-quarter view
    const cam = clamp01((t - 0.06) / 0.56);
    if (t < 1 || !controls.current) {
      const e = ease(cam);
      const planDist = 44 / Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) / Math.min(1, camera.aspect / 0.9);
      pose.dir.copy(pose.planDir).lerp(pose.aerialDir, e).normalize();
      camera.position.copy(CENTER).addScaledVector(pose.dir, THREE.MathUtils.lerp(planDist, pose.aerialDist, e));
      camera.up.copy(pose.planUp).lerp(pose.worldUp, e).normalize();
      camera.lookAt(CENTER);
    }
    if (controls.current) {
      const free = t >= 1;
      controls.current.enabled = free;
      controls.current.autoRotate = free && !sim.interacted;
      if (!free) controls.current.target.copy(CENTER);
    }

    // the sun comes up as the camera comes down out of the plan
    const day = smooth(0.08, 0.44, t);
    if (sun.current && hemi.current) applyDay(world, scene, day, { sun: sun.current, hemi: hemi.current }, camera);
    if (grid.current) {
      const gm = grid.current.material as THREE.ShaderMaterial;
      gm.uniforms.fadeDistance.value = THREE.MathUtils.lerp(190, 0.5, smooth(0.1, 0.5, t));
      grid.current.visible = t < 0.5;
    }

    // construction lines: pale on the plan, lime while that stage rises, then gone
    let current = -1;
    STAGES.forEach((s, i) => {
      const p = clamp01((t - s.window[0]) / (s.window[1] - s.window[0]));
      if (t >= s.window[0]) current = i;
      const m = built.edges[i];
      if (p <= 0) {
        m.color.copy(pose.plan);
        m.opacity = 0.75 * (1 - 0.45 * day);
      } else {
        m.color.copy(pose.plan).lerp(pose.live, Math.min(1, p * 4));
        m.opacity = (0.75 + 0.25 * Math.sin(Math.min(1, p * 1.25) * Math.PI)) * (1 - smooth(0.6, 1, p));
      }
      m.visible = m.opacity > 0.005;
    });
    if (t >= 1) current = 5;
    if (current !== pose.lastStage) {
      pose.lastStage = current;
      onStage(current);
    }

    animateParts(built, t, sim.cut);
  });

  return (
    <>
      <fog attach="fog" args={["#05080d", 120, 260]} />
      <hemisphereLight ref={hemi} args={["#cfe0ff", "#6b5f4f", 0.06]} />
      <directionalLight
        ref={sun}
        position={[SUN.x * 90 + CENTER.x, SUN.y * 90, SUN.z * 90 + CENTER.z]}
        color="#ffdcb0"
        intensity={0}
        castShadow
        shadow-mapSize={[4096, 4096]}
        shadow-bias={-0.00025}
        shadow-normalBias={0.03}
        shadow-radius={3}
        shadow-camera-left={-60}
        shadow-camera-right={60}
        shadow-camera-top={60}
        shadow-camera-bottom={-60}
        shadow-camera-near={10}
        shadow-camera-far={220}
      >
        <object3D attach="target" position={[CENTER.x, 0, CENTER.z]} />
      </directionalLight>
      <group ref={holder} />
      <Grid
        ref={grid}
        position={[CENTER.x, -0.41, CENTER.z]}
        args={[400, 400]}
        cellSize={1}
        cellThickness={0.5}
        cellColor="#1d2836"
        sectionSize={10}
        sectionThickness={1}
        sectionColor="#3c5a2a"
        fadeDistance={190}
        fadeStrength={1.4}
        infiniteGrid
      />
      <OrbitControls
        ref={controls}
        enabled={false}
        enableDamping
        dampingFactor={0.08}
        autoRotateSpeed={0.55}
        minDistance={20}
        maxDistance={170}
        maxPolarAngle={Math.PI * 0.47}
        onStart={() => {
          simRef.current.interacted = true;
        }}
      />
      <EffectComposer multisampling={4}>
        <N8AO halfRes aoRadius={3} distanceFalloff={0.9} intensity={4} quality="medium" color="#0d0a08" />
        <Bloom mipmapBlur intensity={0.35} luminanceThreshold={1.1} luminanceSmoothing={0.2} />
        <ToneMapping mode={ToneMappingMode.ACES_FILMIC} />
      </EffectComposer>
    </>
  );
}

function Stage({ simRef, onStage }: { simRef: React.RefObject<Sim>; onStage: (s: number) => void }) {
  return (
    <>
      <color attach="background" args={["#05080d"]} />
      <Suspense fallback={null}>
        <Scene simRef={simRef} onStage={onStage} />
      </Suspense>
    </>
  );
}

/** The prototype view: the 3D model with its build timeline, stage readout and controls. */
export default function BlueprintPrototype({ onExit }: { onExit: () => void }) {
  const simRef = useRef<Sim>({ t: 0, playing: true, cut: 0, cutTarget: 0, interacted: false });
  const [stage, setStage] = useState(-1);
  const [playing, setPlaying] = useState(true);
  const [done, setDone] = useState(false);
  const [cut, setCut] = useState(false);
  const scrub = useRef<HTMLInputElement>(null);
  const fill = useRef<HTMLDivElement>(null);

  // the timeline follows the simulation without re-rendering every frame
  useEffect(() => {
    let id = 0;
    const tick = () => {
      const sim = simRef.current;
      if (scrub.current && document.activeElement !== scrub.current) scrub.current.value = String(Math.round(sim.t * 1000));
      if (fill.current) fill.current.style.width = `${sim.t * 100}%`;
      setPlaying(sim.playing);
      setDone(sim.t >= 1);
      id = requestAnimationFrame(tick);
    };
    tick();
    return () => cancelAnimationFrame(id);
  }, []);

  const replay = () => {
    const sim = simRef.current;
    sim.t = 0;
    sim.playing = true;
    sim.interacted = false;
    setPlaying(true);
  };
  const toggle = () => {
    const sim = simRef.current;
    if (sim.t >= 1) return replay();
    sim.playing = !sim.playing;
    setPlaying(sim.playing);
  };
  const jump = (i: number) => {
    const sim = simRef.current;
    sim.t = STAGES[i].window[1];
    sim.playing = false;
    setPlaying(false);
  };

  const label =
    stage < 0 ? { k: "Plan", title: "Site plan, top down", note: "Every element of the pavilion, laid flat on the ground" }
    : stage >= STAGES.length ? { k: "Done", title: "Prototype complete", note: "Drag to orbit · scroll to zoom · cut away the roof to look inside" }
    : { k: String(stage + 1).padStart(2, "0"), title: STAGES[stage].title, note: STAGES[stage].note };

  return (
    <div className="bp-proto relative flex min-h-0 flex-1 flex-col">
      <div className="relative min-h-[46vh] flex-1">
        <Canvas
          shadows="percentage"
          dpr={[1, 1.5]}
          camera={{ fov: 32, near: 0.5, far: 600, position: [1, 140, -15.5] }}
          gl={{ antialias: true, powerPreference: "high-performance" }}
          onCreated={({ gl }) => {
            // the post-processing chain tone maps (ACES) once, at the end
            gl.toneMapping = THREE.NoToneMapping;
          }}
          className="!absolute inset-0"
        >
          <Stage simRef={simRef} onStage={setStage} />
        </Canvas>

        {/* Stage readout */}
        <div className="pointer-events-none absolute left-4 top-4 max-w-[340px] rounded-md border border-white/10 bg-black/55 px-4 py-3 backdrop-blur-sm">
          <div className="flex items-center gap-2 text-[9px] uppercase tracking-[0.3em] text-accent">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-accent" />
            Prototype · stage {label.k}
          </div>
          <div key={label.title} className="bp-stage-in mt-1.5 font-sans text-lg tracking-tight text-white">
            {label.title}
          </div>
          <div key={label.note} className="bp-stage-in mt-0.5 text-[10.5px] leading-relaxed tracking-[0.06em] text-white/60">
            {label.note}
          </div>
        </div>

        <button
          type="button"
          onClick={() => {
            const next = !cut;
            setCut(next);
            simRef.current.cutTarget = next ? 1 : 0;
          }}
          aria-pressed={cut}
          className={`absolute right-4 top-4 rounded-full border px-3.5 py-1.5 text-[9.5px] uppercase tracking-[0.22em] transition-colors ${
            cut ? "border-accent/70 bg-accent/15 text-accent" : "border-white/25 bg-black/40 text-white/75 hover:border-white hover:text-white"
          }`}
        >
          Cutaway {cut ? "on" : "off"}
        </button>
      </div>

      {/* Build timeline */}
      <div className="flex flex-wrap items-center gap-3 border-t border-white/10 px-4 py-3">
        <button
          type="button"
          onClick={toggle}
          aria-label={done ? "Replay the build" : playing ? "Pause the build" : "Play the build"}
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-white text-black transition-transform hover:scale-105"
        >
          {done && !playing ? (
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden>
              <path d="M2.5 6a3.5 3.5 0 1 0 1-2.5M2.5 1.5v2.5H5" />
            </svg>
          ) : playing ? (
            <svg width="10" height="10" viewBox="0 0 10 10" fill="currentColor" aria-hidden>
              <rect x="1.5" y="1" width="2.4" height="8" />
              <rect x="6.1" y="1" width="2.4" height="8" />
            </svg>
          ) : (
            <svg width="10" height="10" viewBox="0 0 10 10" fill="currentColor" aria-hidden>
              <path d="M2 1l7 4-7 4z" />
            </svg>
          )}
        </button>

        <div className="relative min-w-[200px] flex-1">
          <div className="pointer-events-none absolute left-0 right-0 top-1/2 h-px -translate-y-1/2 bg-white/15" />
          <div ref={fill} className="pointer-events-none absolute left-0 top-1/2 h-px -translate-y-1/2 bg-accent" />
          {STAGES.map((s, i) => (
            <button
              key={s.title}
              type="button"
              onClick={() => jump(i)}
              style={{ left: `${s.window[0] * 100}%` }}
              className={`absolute top-1/2 z-10 -translate-y-1/2 text-[8.5px] uppercase tracking-[0.18em] transition-colors ${
                stage >= i ? "text-accent" : "text-white/40 hover:text-white"
              }`}
              aria-label={`Jump to stage ${i + 1}, ${s.title}`}
            >
              <span className={`mb-4 block h-2 w-px ${stage >= i ? "bg-accent" : "bg-white/40"}`} />
              <span className="absolute left-0 top-3 hidden whitespace-nowrap sm:block">{s.title}</span>
            </button>
          ))}
          <input
            ref={scrub}
            type="range"
            min={0}
            max={1000}
            defaultValue={0}
            aria-label="Build progress"
            onInput={(e) => {
              const sim = simRef.current;
              sim.t = parseInt((e.target as HTMLInputElement).value, 10) / 1000;
              sim.playing = false;
              setPlaying(false);
            }}
            className="bp-scrub relative z-0 h-8 w-full cursor-pointer appearance-none bg-transparent"
          />
        </div>

        <button
          type="button"
          onClick={onExit}
          className="rounded-full border border-white/25 px-3.5 py-1.5 text-[9.5px] uppercase tracking-[0.22em] text-white/75 transition-colors hover:border-white hover:text-white"
        >
          Back to drawings
        </button>
      </div>
    </div>
  );
}
