"use client";

import { useGLTF, useTexture } from "@react-three/drei";
import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { projects } from "@/content/site";
import { chapter, PROJECTS_ORIGIN } from "@/lib/chapters";
import { gsap } from "@/lib/gsap";
import { perlin } from "@/lib/perlin";
import { rng } from "@/lib/random";
import { sceneState } from "@/lib/sceneState";
import { useApp } from "@/store/useApp";
import { CRYSTALS_URL, crystalFromMesh } from "../crystal";
import { useCursorRay } from "../cursor";
import { palette } from "../palette";
import { riverInside } from "../river";
import { crystalFrag, crystalVert, floorGlowFrag, glowFrag, glowVert, planeVert } from "../shaders/crystal";
import { duneFrag, duneVert } from "../shaders/projects";
import { glitterFrag, glitterVert } from "../shaders/mountains";
import { floorVert, groundFrag, rockFrag, rockVert, streamVert, waterFrag } from "../shaders/river";
import Mountains from "./Mountains";

export const PRISM_Y = 1.85;
const COVERS = projects.map((p) => p.cover);
/** World position of the crystal (lights the near mountain slopes). */
const CRYSTAL_WORLD: [number, number, number] = [PROJECTS_ORIGIN[0], PROJECTS_ORIGIN[1] + PRISM_Y, PROJECTS_ORIGIN[2]];

/** Chapter 4 — a layered crystal hovering over a rock in a mountain river, holding the active project. */
export default function Projects() {
  const group = useRef<THREE.Group>(null);
  const isMobile = useApp((s) => s.isMobile);
  useCursorRay();
  const visibleRange = useMemo(() => {
    const tu = chapter("tunnel");
    const pr = chapter("projects");
    return [tu.end - 0.002, pr.end + 0.004] as const;
  }, []);

  useFrame(() => {
    const p = sceneState.p;
    if (group.current) group.current.visible = p >= visibleRange[0] && p <= visibleRange[1];
  });

  return (
    <group ref={group} position={PROJECTS_ORIGIN} visible={false}>
      <Mountains crystal={CRYSTAL_WORLD} />
      <Dune count={isMobile ? 11000 : 42000} />
      <Crystal />
    </group>
  );
}

function Dune({ count }: { count: number }) {
  const dpr = useThree((s) => s.viewport.dpr);
  const { geometry, material } = useMemo(() => {
    const random = rng(5);
    const pos = new Float32Array(count * 3);
    const rnd = new Float32Array(count);
    for (let i = 0; i < count; ) {
      // denser near the crystal, thinning toward the horizon
      const r = Math.pow(random(), 0.65) * 40;
      const a = random() * Math.PI * 2;
      const x = Math.cos(a) * r;
      const z = Math.sin(a) * r * 0.9 - 6;
      // the dune lives on the banks, never on the water
      if (riverInside(x, z) > -0.2) continue;
      pos[i * 3] = x;
      pos[i * 3 + 2] = z;
      rnd[i] = random();
      i++;
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    geometry.setAttribute("aRand", new THREE.BufferAttribute(rnd, 1));
    const material = new THREE.ShaderMaterial({
      vertexShader: duneVert,
      fragmentShader: duneFrag,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: {
        uTime: { value: 0 },
        uSize: { value: 22 },
        uPixelRatio: { value: dpr },
        uTint: { value: new THREE.Color(projects[0].tint) },
        uOpacity: { value: 1 },
      },
    });
    return { geometry, material };
  }, [count, dpr]);

  useEffect(
    () => () => {
      geometry.dispose();
      material.dispose();
    },
    [geometry, material],
  );

  // the dune picks up the active project's tint
  useEffect(
    () =>
      useApp.subscribe((s, prev) => {
        if (s.activeProject === prev.activeProject) return;
        const c = new THREE.Color(projects[s.activeProject].tint);
        gsap.to(material.uniforms.uTint.value, { r: c.r, g: c.g, b: c.b, duration: 1.2, ease: "power2.inOut" });
      }),
    [material],
  );

  useFrame((_, dt) => {
    if (!material) return;
    material.uniforms.uTime.value += dt;
  });

  return <points geometry={geometry} material={material} frustumCulled={false} />;
}

type Mats = ReturnType<typeof crystalMaterials>;
type Motion = { spin: number; pulse: number; scale: number; hover: number };

const raycaster = new THREE.Raycaster();
const ndc = new THREE.Vector2();
const centre = new THREE.Vector3();
const canHover = typeof matchMedia !== "undefined" && matchMedia("(hover: hover) and (pointer: fine)").matches;

/** Every layer (and the floor reflection) shares the same uniform objects. */
function crystalMaterials(shared: Record<string, THREE.IUniform>, reflect: boolean) {
  const layer = (define: string, glow: number, opts: THREE.ShaderMaterialParameters) =>
    new THREE.ShaderMaterial({
      vertexShader: crystalVert,
      fragmentShader: crystalFrag,
      defines: { [define]: 1 },
      uniforms: { ...shared, uReflect: { value: reflect ? 1 : 0 }, uGlow: { value: glow } },
      transparent: true,
      depthWrite: false,
      toneMapped: false,
      ...opts,
    });
  // premultiplied "glass": rgb is emitted light, alpha is how much of what's behind it hides
  const glass: THREE.ShaderMaterialParameters = {
    blending: THREE.CustomBlending,
    blendEquation: THREE.AddEquation,
    blendSrc: THREE.OneFactor,
    blendDst: THREE.OneMinusSrcAlphaFactor,
  };
  const additive: THREE.ShaderMaterialParameters = { blending: THREE.AdditiveBlending, side: THREE.DoubleSide };
  return {
    back: layer("LAYER_BACK", 1, { ...glass, side: THREE.BackSide }),
    front: layer("LAYER_FRONT", 1, { ...glass, side: THREE.FrontSide }),
    phantom: layer("LAYER_PHANTOM", 0.22, additive),
    heart: layer("LAYER_PHANTOM", 0.45, additive),
    glow: new THREE.ShaderMaterial({
      vertexShader: glowVert,
      fragmentShader: glowFrag,
      uniforms: {
        uTint: shared.uTint,
        uPulse: shared.uPulse,
        uTime: shared.uTime,
        uSize: { value: 1.25 },
        uIntensity: { value: reflect ? 0.05 : 0.2 },
      },
      transparent: true,
      depthWrite: false,
      toneMapped: false,
      blending: THREE.AdditiveBlending,
    }),
  };
}

/** A layered "phantom" crystal: smoky outer glass, two nested growth shells and a glowing core. */
function Crystal() {
  const textures = useTexture(COVERS);
  const motion = useRef<Motion>({ spin: 0, pulse: 0, scale: 1, hover: 0 });
  const pickMesh = useRef<THREE.Mesh>(null);
  const camera = useThree((s) => s.camera);
  const size = useThree((s) => s.size);
  const { nodes } = useGLTF(CRYSTALS_URL) as unknown as { nodes: Record<string, THREE.Mesh> };

  useMemo(() => {
    for (const t of textures) {
      t.colorSpace = THREE.SRGBColorSpace;
      t.anisotropy = 4;
    }
  }, [textures]);

  // one Blender cut per project (cycled if there are more projects than cuts)
  const cuts = useMemo(() => {
    const meshes = Object.values(nodes)
      .filter((n) => n.isMesh && /^Crystal_\d+$/.test(n.name))
      .sort((a, b) => a.name.localeCompare(b.name));
    return meshes.map((m) => crystalFromMesh(m.geometry));
  }, [nodes]);
  const [shown, setShown] = useState(() => useApp.getState().activeProject);
  const geometry = cuts[shown % cuts.length];
  const swap = useRef<gsap.core.Timeline | null>(null);

  const shared = useMemo<Record<string, THREE.IUniform>>(
    () => ({
      uTexA: { value: textures[0] },
      uTexB: { value: textures[0] },
      uMix: { value: 0 },
      uTime: { value: 0 },
      uPulse: { value: 0 },
      uTint: { value: new THREE.Color(projects[0].tint) },
      uFloorY: { value: PROJECTS_ORIGIN[1] },
      // view-space size of the 16:10 image inside the crystal (cover-fitted to the core)
      uScreen: { value: new THREE.Vector2(2.7, 1.69) },
    }),
    [textures],
  );
  const mats = useMemo(() => ({ main: crystalMaterials(shared, false), mirror: crystalMaterials(shared, true) }), [shared]);
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
      for (const set of [mats.main, mats.mirror]) for (const m of Object.values(set)) m.dispose();
    },
    [mats, floorMat],
  );
  useEffect(() => () => cuts.forEach((g) => g.dispose()), [cuts]
  );

  // project switch: morph to the next cut, dissolve the image, retint and give it a turn
  useEffect(() => {
    return useApp.subscribe((s, prev) => {
      if (s.activeProject === prev.activeProject) return;
      const next = s.activeProject;
      const dir = next > prev.activeProject ? 1 : -1;
      const tint = new THREE.Color(projects[next].tint);

      // whatever is on screen now becomes A; fade to B
      shared.uTexA.value = shared.uMix.value > 0.5 ? shared.uTexB.value : shared.uTexA.value;
      shared.uTexB.value = textures[next];
      gsap.fromTo(shared.uMix, { value: 0 }, { value: 1, duration: 1.15, ease: "power2.inOut", overwrite: true });
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
  }, [shared, textures]);

  // clicking the crystal enters the project: the HUD asks the scene whether a tap hit it
  useEffect(() => {
    const hit = (x: number, y: number) => {
      const mesh = pickMesh.current;
      if (!mesh || !mesh.parent?.parent?.visible) return false;
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

  useFrame(({ clock }, dt) => {
    shared.uTime.value = clock.elapsedTime;
    const m = motion.current;
    const live = !!pickMesh.current?.parent?.parent?.visible && sceneState.dive === 0;
    const over = live && canHover && sceneState.crystal.pick(sceneState.mouse.x, sceneState.mouse.y);
    sceneState.crystal.hover = over;
    m.hover += ((over ? 1 : 0) - m.hover) * Math.min(1, dt * 6);
    // entering: the core flares as the camera pushes in
    shared.uPulse.value = m.pulse + m.hover * 0.5 + sceneState.dive * 2.5;
    // the crystal's centre on screen: the dive's curtain opens from here
    if (pickMesh.current) {
      pickMesh.current.getWorldPosition(centre).project(camera);
      sceneState.crystal.x = (centre.x * 0.5 + 0.5) * size.width;
      sceneState.crystal.y = (-centre.y * 0.5 + 0.5) * size.height;
    }
  });

  return (
    <>
      {/* draw order: reflection → water surface → floor glow → crystal */}
      <CrystalBody geometry={geometry} mats={mats.main} motion={motion} order={10} pickRef={pickMesh} />
      <group scale={[1, -1, 1]}>
        <CrystalBody geometry={geometry} mats={mats.mirror} motion={motion} order={2} />
      </group>
      <Riverbed shared={shared} />
      <mesh rotation-x={-Math.PI / 2} position-y={0.02} material={floorMat} renderOrder={9}>
        <planeGeometry args={[7, 7]} />
      </mesh>
      <pointLight position={[0, 0.4, 1.5]} intensity={4} distance={6} color="#ffffff" />
    </>
  );
}

function CrystalBody({
  geometry,
  mats,
  motion,
  order,
  pickRef,
}: {
  geometry: THREE.BufferGeometry;
  mats: Mats;
  motion: React.RefObject<Motion>;
  order: number;
  pickRef?: React.RefObject<THREE.Mesh | null>;
}) {
  const spin = useRef<THREE.Group>(null);
  const heart = useRef<THREE.Mesh>(null);

  useFrame(({ clock }) => {
    const g = spin.current;
    if (!g) return;
    const time = clock.elapsedTime;
    const { spin: turn, pulse, scale, hover } = motion.current;
    // idle float + slow turn; a switch adds a facet's worth of rotation
    g.rotation.y = time * 0.18 + turn + sceneState.mouse.x * 0.25 + sceneState.drag * 1.4;
    g.rotation.x = sceneState.mouse.y * 0.06;
    g.position.y = PRISM_Y + Math.sin(time * 0.9) * 0.06;
    g.scale.setScalar((1 + pulse * 0.06 + hover * 0.05) * scale);
    // the innermost phantom drifts against the outer shell
    if (heart.current) heart.current.rotation.y = -time * 0.32 - turn * 0.6;
  });

  return (
    <group ref={spin}>
      <mesh geometry={geometry} material={mats.back} renderOrder={order} frustumCulled={false} />
      <mesh material={mats.glow} renderOrder={order + 1} frustumCulled={false}>
        <planeGeometry args={[2, 2]} />
      </mesh>
      {/* phantoms: the same cut, smaller, grown up from the base */}
      <mesh ref={heart} geometry={geometry} material={mats.heart} scale={0.46} position-y={-0.3} renderOrder={order + 2} frustumCulled={false} />
      <mesh geometry={geometry} material={mats.phantom} scale={0.74} position-y={-0.18} renderOrder={order + 3} frustumCulled={false} />
      <mesh ref={pickRef} geometry={geometry} material={mats.front} renderOrder={order + 4} frustumCulled={false} />
    </group>
  );
}

/** Faceted stone: a jittered icosphere, squashed, with its top planed flat. */
function rockGeometry(seed: number, scale: [number, number, number], top: number) {
  const n = perlin(seed);
  const g = new THREE.IcosahedronGeometry(1, 2); // non-indexed, so normals come out flat per facet
  const p = g.attributes.position as THREE.BufferAttribute;
  const v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    // displacement is a pure function of position, so shared corners stay welded
    const d = 1 + 0.2 * n(v.x * 1.4 + v.z * 0.6 + 3, v.y * 1.4) + 0.08 * n(v.x * 4 + 1, v.z * 4 + v.y * 2);
    v.multiplyScalar(d).multiply(new THREE.Vector3(...scale));
    v.y = Math.min(v.y, top);
    p.setXYZ(i, v.x, v.y, v.z);
  }
  g.computeVertexNormals();
  return g;
}

/** The river: opaque banks, a reflective water surface, and the stones the crystal hovers over. */
function Riverbed({ shared }: { shared: Record<string, THREE.IUniform> }) {
  // floor shaders read the group-local XZ straight from the vertices
  const plane = useMemo(() => new THREE.PlaneGeometry(140, 80).rotateX(-Math.PI / 2).translate(0, 0, -22), []);
  const { ground, water, rocks, rockMats } = useMemo(() => {
    const surface = (frag: string, opts: THREE.ShaderMaterialParameters = {}) =>
      new THREE.ShaderMaterial({
        vertexShader: floorVert,
        fragmentShader: frag,
        uniforms: { uTint: shared.uTint, uBg: { value: palette.bg } },
        ...opts,
      });
    const rockMat = (reflect: boolean) =>
      new THREE.ShaderMaterial({
        vertexShader: rockVert,
        fragmentShader: rockFrag,
        uniforms: {
          uTint: shared.uTint,
          uFloorY: shared.uFloorY,
          uLight: { value: new THREE.Vector3(...CRYSTAL_WORLD) },
          uReflect: { value: reflect ? 1 : 0 },
        },
      });
    return {
      ground: surface(groundFrag),
      water: surface(waterFrag, {
        transparent: true,
        depthWrite: false,
        blending: THREE.CustomBlending,
        blendEquation: THREE.AddEquation,
        blendSrc: THREE.OneFactor,
        blendDst: THREE.OneMinusSrcAlphaFactor,
      }),
      rocks: [
        { geo: rockGeometry(3, [1.0, 0.62, 0.86], 0.3), pos: [0, -0.12, 0] as const },
        { geo: rockGeometry(8, [0.34, 0.3, 0.3], 0.16), pos: [-2.0, -0.08, 1.2] as const },
        { geo: rockGeometry(12, [0.26, 0.22, 0.3], 0.12), pos: [2.3, -0.07, -0.9] as const },
        { geo: rockGeometry(19, [0.18, 0.16, 0.16], 0.08), pos: [1.2, -0.05, 2.2] as const },
      ],
      rockMats: [rockMat(false), rockMat(true)],
    };
  }, [shared]);

  useEffect(
    () => () => {
      plane.dispose();
      ground.dispose();
      water.dispose();
      for (const r of rocks) r.geo.dispose();
      for (const m of rockMats) m.dispose();
    },
    [plane, ground, water, rocks, rockMats],
  );

  const stones = (mat: THREE.Material) =>
    rocks.map((r, i) => <mesh key={i} geometry={r.geo} material={mat} position={[r.pos[0], r.pos[1], r.pos[2]]} />);

  return (
    <>
      <mesh geometry={plane} material={ground} />
      <mesh geometry={plane} material={water} renderOrder={8} />
      {stones(rockMats[0])}
      <group scale={[1, -1, 1]}>{stones(rockMats[1])}</group>
      <RiverGlitter rocks={rocks} shared={shared} />
    </>
  );
}

type Rock = { geo: THREE.BufferGeometry; pos: readonly [number, number, number] };

/** Glitter for the river (drifting downstream) and the stones (lit by the crystal), like the mountains. */
function RiverGlitter({ rocks, shared }: { rocks: Rock[]; shared: Record<string, THREE.IUniform> }) {
  const isMobile = useApp((s) => s.isMobile);
  const dpr = useThree((s) => s.viewport.dpr);

  const { streamGeo, stoneGeo } = useMemo(() => {
    const random = rng(41);
    const hueNoise = perlin(4);

    // stream: crowded along the banks, sparse mid-stream; the shader does the flowing
    const count = isMobile ? 7000 : 22000;
    const sp = new Float32Array(count * 3);
    const across = new Float32Array(count);
    const sr = new Float32Array(count);
    const sh = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      const z = -13 + random() * 23;
      sp[i * 3 + 2] = z;
      across[i] = (random() < 0.5 ? -1 : 1) * Math.pow(random(), 0.45);
      sr[i] = random();
      sh[i] = hueNoise(across[i] * 0.4, z * 0.06) * 0.5 + 0.5;
    }
    const streamGeo = new THREE.BufferGeometry();
    streamGeo.setAttribute("position", new THREE.BufferAttribute(sp, 3));
    streamGeo.setAttribute("aAcross", new THREE.BufferAttribute(across, 1));
    streamGeo.setAttribute("aRand", new THREE.BufferAttribute(sr, 1));
    streamGeo.setAttribute("aHue", new THREE.BufferAttribute(sh, 1));

    // stones: area-weighted points on every facet above the water, brighter where the crystal lights them
    const light = new THREE.Vector3(0, PRISM_Y, 0);
    const density = isMobile ? 260 : 750;
    const pos: number[] = [];
    const lit: number[] = [];
    const rnd: number[] = [];
    const hue: number[] = [];
    const a = new THREE.Vector3();
    const b = new THREE.Vector3();
    const c = new THREE.Vector3();
    const n = new THREE.Vector3();
    const q = new THREE.Vector3();
    const L = new THREE.Vector3();
    for (const rock of rocks) {
      const off = new THREE.Vector3(...rock.pos);
      const attr = rock.geo.attributes.position as THREE.BufferAttribute;
      for (let f = 0; f < attr.count; f += 3) {
        a.fromBufferAttribute(attr, f).add(off);
        b.fromBufferAttribute(attr, f + 1).add(off);
        c.fromBufferAttribute(attr, f + 2).add(off);
        n.crossVectors(q.subVectors(b, a), L.subVectors(c, a));
        const area = n.length() / 2;
        n.normalize();
        let k = area * density;
        for (; k > 0; k--) {
          if (k < 1 && random() > k) break;
          let u = random();
          let v = random();
          if (u + v > 1) {
            u = 1 - u;
            v = 1 - v;
          }
          q.copy(a).addScaledVector(b.clone().sub(a), u).addScaledVector(c.clone().sub(a), v);
          if (q.y < 0.01) continue;
          L.subVectors(light, q);
          const d = L.length();
          const l = Math.min(1, (Math.max(0, n.dot(L.normalize())) * 2.2) / (1 + d * d * 0.5));
          pos.push(q.x, q.y + 0.004, q.z);
          lit.push(0.12 + 0.88 * l);
          rnd.push(random());
          hue.push(hueNoise(q.x * 0.8, q.z * 0.8) * 0.5 + 0.5);
        }
      }
    }
    const stoneGeo = new THREE.BufferGeometry();
    stoneGeo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    stoneGeo.setAttribute("aLit", new THREE.Float32BufferAttribute(lit, 1));
    stoneGeo.setAttribute("aRand", new THREE.Float32BufferAttribute(rnd, 1));
    stoneGeo.setAttribute("aHue", new THREE.Float32BufferAttribute(hue, 1));
    return { streamGeo, stoneGeo };
  }, [rocks, isMobile]);

  const [streamMat, stoneMat] = useMemo(() => {
    const points = (vertexShader: string, size: number, extra: Record<string, THREE.IUniform> = {}) =>
      new THREE.ShaderMaterial({
        vertexShader,
        fragmentShader: glitterFrag,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        uniforms: {
          uTime: shared.uTime,
          uTint: shared.uTint,
          uSize: { value: size },
          uPixelRatio: { value: dpr },
          ...extra,
        },
      });
    // stones share the mountain glitter shader; uHover 0 keeps them out of the cursor effect
    return [points(streamVert, 22), points(glitterVert, 12, { uReflect: { value: 0 }, uHover: { value: 0 } })];
  }, [shared, dpr]);

  useEffect(
    () => () => {
      streamGeo.dispose();
      stoneGeo.dispose();
      streamMat.dispose();
      stoneMat.dispose();
    },
    [streamGeo, stoneGeo, streamMat, stoneMat],
  );

  return (
    <>
      <points geometry={streamGeo} material={streamMat} frustumCulled={false} renderOrder={9} />
      <points geometry={stoneGeo} material={stoneMat} frustumCulled={false} renderOrder={9} />
    </>
  );
}

useTexture.preload(COVERS);
useGLTF.preload(CRYSTALS_URL);
