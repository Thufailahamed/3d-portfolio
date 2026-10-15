"use client";

import { useGLTF } from "@react-three/drei";
import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { projects } from "@/content/site";
import { chapter, PROJECTS_ORIGIN } from "@/lib/chapters";
import { gsap } from "@/lib/gsap";
import { rng } from "@/lib/random";
import { sceneState } from "@/lib/sceneState";
import { useApp } from "@/store/useApp";
import { CRYSTALS_URL, crystalFromMesh, tessellate } from "../crystal";
import { crystalFrag, crystalVert, floorGlowFrag, planeVert, RIPPLES } from "../shaders/crystal";
import { skyFrag, skyVert } from "../shaders/night";
import { bankFrag, bankVert, pineFrag, pineVert, rockFrag, rockVert, waterFrag, waterVert } from "../shaders/valley";
import { bankGeometry, boulderGeometry, pineGeometry, scatter } from "../valley";
import Mountains from "./Mountains";

export const PRISM_Y = 1.85;
/** World position of the crystal (lights the near mountain slopes). */
const CRYSTAL_WORLD: [number, number, number] = [PROJECTS_ORIGIN[0], PROJECTS_ORIGIN[1] + PRISM_Y, PROJECTS_ORIGIN[2]];

/** Chapter 4 — a crystal hovering over a river stone in a moonlit mountain valley, holding the active project. */
export default function Projects() {
  const group = useRef<THREE.Group>(null);
  const visibleRange = useMemo(() => {
    const tu = chapter("tunnel");
    const pr = chapter("projects");
    return [tu.end - 0.002, pr.end + 0.004] as const;
  }, []);

  // the valley's clock and the active project's colour, shared by the sky and the ground
  const env = useMemo(() => ({ uTime: { value: 0 }, uTint: { value: new THREE.Color(projects[0].tint) } }), []);
  useEffect(
    () =>
      useApp.subscribe((s, prev) => {
        if (s.activeProject === prev.activeProject) return;
        const c = new THREE.Color(projects[s.activeProject].tint);
        gsap.to(env.uTint.value, { r: c.r, g: c.g, b: c.b, duration: 1.2, ease: "power2.inOut" });
      }),
    [env],
  );

  useFrame((_, dt) => {
    const p = sceneState.p;
    const on = p >= visibleRange[0] && p <= visibleRange[1];
    if (group.current) group.current.visible = on;
    if (on) env.uTime.value += dt;
  });

  return (
    <group ref={group} position={PROJECTS_ORIGIN} visible={false}>
      <Sky env={env} />
      <Mountains crystal={CRYSTAL_WORLD} />
      <Valley env={env} />
      <Crystal />
    </group>
  );
}

type Env = { uTime: THREE.IUniform<number>; uTint: THREE.IUniform<THREE.Color> };

/** Night sky: a dome that travels with the camera, drawn behind everything. */
function Sky({ env }: { env: Env }) {
  const mesh = useRef<THREE.Mesh>(null);
  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader: skyVert,
        fragmentShader: skyFrag,
        side: THREE.BackSide,
        depthWrite: false,
        uniforms: { uTime: env.uTime, uTint: env.uTint },
      }),
    [env],
  );
  useEffect(() => () => material.dispose(), [material]);
  useFrame(({ camera }) => {
    const m = mesh.current;
    if (m?.parent) m.position.copy(m.parent.worldToLocal(m.position.copy(camera.position)));
  });
  return (
    <mesh ref={mesh} material={material} renderOrder={-10} frustumCulled={false}>
      <sphereGeometry args={[90, 48, 32]} />
    </mesh>
  );
}

type Motion = { spin: number; pulse: number; scale: number; hover: number };

const raycaster = new THREE.Raycaster();
const ndc = new THREE.Vector2();
const centre = new THREE.Vector3();
const canHover = typeof matchMedia !== "undefined" && matchMedia("(hover: hover) and (pointer: fine)").matches;

/** The real crystal and its reflection share everything but their placement. */
function crystalMaterial(shared: Record<string, THREE.IUniform>, reflect: boolean) {
  return new THREE.ShaderMaterial({
    vertexShader: crystalVert,
    fragmentShader: crystalFrag,
    uniforms: { ...shared, uRot: { value: new THREE.Matrix3() }, uReflect: { value: reflect ? 1 : 0 } },
  });
}

/** Clear quartz hovering over the stone. The cursor sets ripples running across it, like a hand over water. */
function Crystal() {
  const motion = useRef<Motion>({ spin: 0, pulse: 0, scale: 1, hover: 0 });
  const pickMesh = useRef<THREE.Mesh>(null);
  const realBody = useRef<THREE.Group>(null);
  const mirrorBody = useRef<THREE.Group>(null);
  const camera = useThree((s) => s.camera);
  const size = useThree((s) => s.size);
  const { nodes } = useGLTF(CRYSTALS_URL) as unknown as { nodes: Record<string, THREE.Mesh> };

  // one Blender cut per project (cycled if there are more projects than cuts), finely divided for the ripples
  const cuts = useMemo(() => {
    const meshes = Object.values(nodes)
      .filter((n) => n.isMesh && /^Crystal_\d+$/.test(n.name))
      .sort((a, b) => a.name.localeCompare(b.name));
    return meshes.map((m) => {
      const base = crystalFromMesh(m.geometry);
      const fine = tessellate(base, 10);
      base.dispose();
      return fine;
    });
  }, [nodes]);
  const [shown, setShown] = useState(() => useApp.getState().activeProject);
  const geometry = cuts[shown % cuts.length];
  const swap = useRef<gsap.core.Timeline | null>(null);

  // what the crystal refracts: the valley behind it, drawn without the crystal at half resolution
  const target = useMemo(() => new THREE.WebGLRenderTarget(2, 2, { type: THREE.HalfFloatType }), []);
  const shared = useMemo<Record<string, THREE.IUniform>>(
    () => ({
      uTime: { value: 0 },
      uPulse: { value: 0 },
      uTint: { value: new THREE.Color(projects[0].tint) },
      uScene: { value: target.texture },
      uRes: { value: new THREE.Vector2(1, 1) },
      uRipDepth: { value: 0.022 },
      uRip: { value: Array.from({ length: RIPPLES }, () => new THREE.Vector4(0, 0, 0, -100)) },
      uRipAmp: { value: new Array<number>(RIPPLES).fill(0) },
    }),
    [target],
  );
  const mats = useMemo(() => ({ main: crystalMaterial(shared, false), mirror: crystalMaterial(shared, true) }), [shared]);
  const floorMat = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader: planeVert,
        fragmentShader: floorGlowFrag,
        uniforms: { uTint: shared.uTint, uPulse: shared.uPulse },
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    [shared],
  );

  useEffect(
    () => () => {
      floorMat.dispose();
      mats.main.dispose();
      mats.mirror.dispose();
      target.dispose();
    },
    [mats, floorMat, target],
  );
  useEffect(() => () => cuts.forEach((g) => g.dispose()), [cuts]);

  // ripples: a ring buffer of where (crystal space) and when each one started
  const rip = useMemo(() => ({ next: 0, last: new THREE.Vector3(1e3, 0, 0), lastT: -1, idle: 1.5, random: rng(61) }), []);
  const spawn = (x: number, y: number, z: number, amp: number) => {
    const k = rip.next++ % RIPPLES;
    (shared.uRip.value as THREE.Vector4[])[k].set(x, y, z, shared.uTime.value);
    (shared.uRipAmp.value as number[])[k] = amp;
  };

  // project switch: morph to the next cut, retint and give it a turn
  useEffect(() => {
    return useApp.subscribe((s, prev) => {
      if (s.activeProject === prev.activeProject) return;
      const next = s.activeProject;
      const dir = next > prev.activeProject ? 1 : -1;
      const tint = new THREE.Color(projects[next].tint);
      gsap.to(shared.uTint.value, { r: tint.r, g: tint.g, b: tint.b, duration: 1.1, ease: "power2.inOut" });

      // the crystal spins down to a spark, changes cut, and grows back as the next one
      swap.current?.kill();
      swap.current = gsap
        .timeline()
        .to(motion.current, { scale: 0.12, duration: 0.42, ease: "power2.in" })
        .call(() => setShown(next))
        .to(motion.current, { scale: 1, duration: 0.95, ease: "back.out(1.6)" });
      gsap.to(motion.current, { spin: `+=${(Math.PI * 2 * dir) / 3}`, duration: 1.4, ease: "expo.out" });
      gsap.fromTo(motion.current, { pulse: 1 }, { pulse: 0, duration: 1.3, ease: "power3.out" });
    });
  }, [shared]);

  // clicking the crystal enters the project: the HUD asks the scene whether a tap hit it
  useEffect(() => {
    const hit = (x: number, y: number) => {
      const mesh = pickMesh.current;
      if (!mesh || !mesh.parent?.parent?.parent?.visible) return false;
      ndc.set(x, y);
      raycaster.setFromCamera(ndc, camera);
      return raycaster.intersectObject(mesh, false).length > 0;
    };
    sceneState.crystal.pick = hit;
    return () => {
      sceneState.crystal.pick = () => false;
      sceneState.crystal.hover = false;
    };
  }, [camera]);

  const tmp = useMemo(() => ({ v: new THREE.Vector3(), res: new THREE.Vector2() }), []);

  useFrame(({ clock, gl, scene }, dt) => {
    const time = clock.elapsedTime;
    shared.uTime.value = time;
    const m = motion.current;
    const mesh = pickMesh.current;
    const live = !!mesh?.parent?.parent?.parent?.visible && sceneState.dive === 0;

    // the cursor over the crystal: ripples spread from under it as it moves
    ndc.set(sceneState.mouse.x, sceneState.mouse.y);
    raycaster.setFromCamera(ndc, camera);
    const hit = live && canHover && mesh ? raycaster.intersectObject(mesh, false)[0] : undefined;
    const over = !!hit;
    if (hit && mesh) {
      const local = mesh.worldToLocal(tmp.v.copy(hit.point));
      const moved = local.distanceTo(rip.last);
      if (!sceneState.crystal.hover || moved > 0.09) {
        spawn(local.x, local.y, local.z, sceneState.crystal.hover ? Math.min(0.9, 0.35 + moved * 2) : 1);
        rip.last.copy(local);
        rip.lastT = time;
      }
    }
    sceneState.crystal.hover = over;
    m.hover += ((over ? 1 : 0) - m.hover) * Math.min(1, dt * 6);

    // left alone, now and then a drop lands somewhere on it
    rip.idle -= dt;
    if (live && mesh && rip.idle < 0 && time - rip.lastT > 2) {
      const pos = mesh.geometry.getAttribute("position") as THREE.BufferAttribute;
      const i = Math.floor(rip.random() * pos.count);
      spawn(pos.getX(i), pos.getY(i), pos.getZ(i), 0.3 + rip.random() * 0.25);
      rip.idle = 2.5 + rip.random() * 3.5;
    }

    // entering: the heart flares as the camera pushes in
    shared.uPulse.value = m.pulse + m.hover * 0.06 + sceneState.dive * 2.5;
    if (mesh) {
      mesh.getWorldPosition(centre).project(camera);
      sceneState.crystal.x = (centre.x * 0.5 + 0.5) * size.width;
      sceneState.crystal.y = (-centre.y * 0.5 + 0.5) * size.height;
    }

    // the refraction source: everything but the crystal (and its reflection), at half resolution
    if (!mesh?.parent?.parent?.parent?.visible) return;
    gl.getDrawingBufferSize(tmp.res);
    shared.uRes.value.copy(tmp.res);
    const w = Math.max(2, Math.round(tmp.res.x * 0.5));
    const h = Math.max(2, Math.round(tmp.res.y * 0.5));
    if (target.width !== w || target.height !== h) target.setSize(w, h);
    const bodies = [realBody.current, mirrorBody.current];
    bodies.forEach((b) => b && (b.visible = false));
    const prev = gl.getRenderTarget();
    gl.setRenderTarget(target);
    gl.render(scene, camera);
    gl.setRenderTarget(prev);
    bodies.forEach((b) => b && (b.visible = true));
  });

  return (
    <>
      <group ref={realBody}>
        <CrystalBody geometry={geometry} material={mats.main} motion={motion} pickRef={pickMesh} />
      </group>
      <group ref={mirrorBody} scale={[1, -1, 1]}>
        <CrystalBody geometry={geometry} material={mats.mirror} motion={motion} />
      </group>
      <mesh rotation-x={-Math.PI / 2} position-y={0.02} material={floorMat} renderOrder={9}>
        <planeGeometry args={[7, 7]} />
      </mesh>
    </>
  );
}

function CrystalBody({
  geometry,
  material,
  motion,
  pickRef,
}: {
  geometry: THREE.BufferGeometry;
  material: THREE.ShaderMaterial;
  motion: React.RefObject<Motion>;
  pickRef?: React.RefObject<THREE.Mesh | null>;
}) {
  const spin = useRef<THREE.Group>(null);

  useFrame(({ clock }) => {
    const g = spin.current;
    if (!g) return;
    const time = clock.elapsedTime;
    const { spin: turn, pulse, scale, hover } = motion.current;
    // idle float + slow turn; a switch adds a facet's worth of rotation
    g.rotation.y = time * 0.18 + turn + sceneState.mouse.x * 0.25 + sceneState.drag * 1.4;
    g.rotation.x = sceneState.mouse.y * 0.06;
    g.position.y = PRISM_Y + Math.sin(time * 0.9) * 0.06;
    g.scale.setScalar((1 + pulse * 0.06 + hover * 0.03) * scale);
    // crystal space → world, rotation only (the ripples live in crystal space)
    g.updateWorldMatrix(true, false);
    const r = material.uniforms.uRot.value as THREE.Matrix3;
    r.setFromMatrix4(g.matrixWorld);
    const e = r.elements;
    for (let c = 0; c < 3; c++) {
      const l = Math.hypot(e[c * 3], e[c * 3 + 1], e[c * 3 + 2]) || 1;
      e[c * 3] /= l;
      e[c * 3 + 1] /= l;
      e[c * 3 + 2] /= l;
    }
  });

  return (
    <group ref={spin}>
      <mesh ref={pickRef} geometry={geometry} material={material} frustumCulled={false} />
    </group>
  );
}

const floorY = PROJECTS_ORIGIN[1];

/** One instanced set (real + mirrored) of rocks or trees. */
function Scatter({
  geometry,
  mats,
  items,
  place,
}: {
  geometry: THREE.BufferGeometry;
  mats: THREE.ShaderMaterial[];
  items: ReturnType<typeof scatter>;
  place: (it: ReturnType<typeof scatter>[number], o: THREE.Object3D) => void;
}) {
  const real = useRef<THREE.InstancedMesh>(null);
  const mirrored = useRef<THREE.InstancedMesh>(null);
  useEffect(() => {
    const o = new THREE.Object3D();
    for (const im of [real.current, mirrored.current]) {
      if (!im) continue;
      items.forEach((it, i) => {
        o.position.set(0, 0, 0);
        o.rotation.set(0, 0, 0);
        o.scale.setScalar(1);
        place(it, o);
        o.updateMatrix();
        im.setMatrixAt(i, o.matrix);
      });
      im.instanceMatrix.needsUpdate = true;
    }
  }, [items, place]);
  return (
    <>
      <instancedMesh ref={real} args={[geometry, mats[0], items.length]} frustumCulled={false} />
      <group scale={[1, -1, 1]}>
        <instancedMesh ref={mirrored} args={[geometry, mats[1], items.length]} frustumCulled={false} />
      </group>
    </>
  );
}

/** The valley floor: banks, the river, the crystal's stone, boulders and pines (all mirrored in the water). */
function Valley({ env }: { env: Env }) {
  const isMobile = useApp((s) => s.isMobile);

  const geo = useMemo(
    () => ({
      bank: bankGeometry(isMobile ? 170 : 300, isMobile ? 100 : 180),
      water: new THREE.PlaneGeometry(140, 80).rotateX(-Math.PI / 2).translate(0, 0, -22),
      stone: boulderGeometry(3, [1.0, 0.62, 0.86], 0.3, isMobile ? 4 : 5),
      boulder: boulderGeometry(8, [1, 0.72, 0.9], Infinity, 3),
      pine: pineGeometry(5),
    }),
    [isMobile],
  );

  const items = useMemo(
    () => ({
      // stepping stones in the shallows around the crystal's rock
      pebbles: [
        { x: -2.0, z: 1.2, y: 0, r: 0.2, s: 0.34 },
        { x: 2.3, z: -0.9, y: 0, r: 0.6, s: 0.28 },
        { x: 1.2, z: 2.2, y: 0, r: 0.9, s: 0.18 },
        { x: -1.1, z: -2.4, y: 0, r: 0.4, s: 0.22 },
        { x: 3.1, z: 1.6, y: 0, r: 0.1, s: 0.16 },
      ],
      boulders: scatter(7, isMobile ? 26 : 48, -0.2, 9, [-26, 9], 3.2),
      pines: scatter(13, isMobile ? 110 : 220, 4, 40, [-46, -5], 8),
    }),
    [isMobile],
  );

  const mats = useMemo(() => {
    const make = (vertexShader: string, fragmentShader: string, extra: Record<string, THREE.IUniform> = {}) =>
      [0, 1].map(
        (reflect) =>
          new THREE.ShaderMaterial({
            vertexShader,
            fragmentShader,
            defines: reflect ? { MIRROR: 1 } : {},
            uniforms: {
              uTime: env.uTime,
              uTint: env.uTint,
              uCrystal: { value: new THREE.Vector3(...CRYSTAL_WORLD) },
              uFloorY: { value: floorY },
              uReflect: { value: reflect },
              ...extra,
            },
          }),
      );
    return {
      bank: make(bankVert, bankFrag),
      stone: make(rockVert, rockFrag, { uPower: { value: 2.2 } }),
      boulder: make(rockVert, rockFrag, { uPower: { value: 1.6 } }),
      pine: make(pineVert, pineFrag),
      water: new THREE.ShaderMaterial({
        vertexShader: waterVert,
        fragmentShader: waterFrag,
        uniforms: {
          uTime: env.uTime,
          uTint: env.uTint,
          uCrystal: { value: new THREE.Vector3(...CRYSTAL_WORLD) },
          uOrigin: { value: new THREE.Vector3(...PROJECTS_ORIGIN) },
        },
        transparent: true,
        depthWrite: false,
        blending: THREE.CustomBlending,
        blendEquation: THREE.AddEquation,
        blendSrc: THREE.OneFactor,
        blendDst: THREE.OneMinusSrcAlphaFactor,
      }),
    };
  }, [env]);

  useEffect(
    () => () => {
      for (const g of Object.values(geo)) g.dispose();
      for (const m of Object.values(mats)) (Array.isArray(m) ? m : [m]).forEach((x) => x.dispose());
    },
    [geo, mats],
  );

  const placePebble = useMemo(
    () => (it: ReturnType<typeof scatter>[number], o: THREE.Object3D) => {
      o.position.set(it.x, -0.06, it.z);
      o.rotation.set(0, it.r * 6.28, 0);
      o.scale.set(it.s, it.s * 0.8, it.s * 0.9);
    },
    [],
  );
  const placeBoulder = useMemo(
    () => (it: ReturnType<typeof scatter>[number], o: THREE.Object3D) => {
      const s = 0.15 + Math.pow(it.s, 2.2) * 0.85;
      o.position.set(it.x, it.y - s * 0.3, it.z);
      o.rotation.set((it.r - 0.5) * 0.5, it.r * 6.28, (it.s - 0.5) * 0.4);
      o.scale.set(s, s * (0.6 + 0.4 * it.r), s * (0.8 + 0.3 * it.s));
    },
    [],
  );
  const placePine = useMemo(
    () => (it: ReturnType<typeof scatter>[number], o: THREE.Object3D) => {
      const s = 0.9 + Math.pow(it.s, 1.5) * 1.6;
      o.position.set(it.x, it.y - 0.05, it.z);
      o.rotation.set((it.r - 0.5) * 0.06, it.r * 6.28, 0);
      o.scale.set(s * (0.85 + 0.3 * it.r), s, s * (0.85 + 0.3 * it.r));
    },
    [],
  );

  return (
    <>
      <mesh geometry={geo.bank} material={mats.bank[0]} />
      <mesh geometry={geo.stone} material={mats.stone[0]} position={[0, -0.12, 0]} />
      <group scale={[1, -1, 1]}>
        <mesh geometry={geo.bank} material={mats.bank[1]} />
        <mesh geometry={geo.stone} material={mats.stone[1]} position={[0, -0.12, 0]} />
      </group>
      <Scatter geometry={geo.boulder} mats={mats.boulder} items={items.pebbles} place={placePebble} />
      <Scatter geometry={geo.boulder} mats={mats.boulder} items={items.boulders} place={placeBoulder} />
      <Scatter geometry={geo.pine} mats={mats.pine} items={items.pines} place={placePine} />
      <mesh geometry={geo.water} material={mats.water} renderOrder={8} />
    </>
  );
}

useGLTF.preload(CRYSTALS_URL);
