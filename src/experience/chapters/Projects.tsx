"use client";

import { useGLTF, useTexture } from "@react-three/drei";
import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { projects } from "@/content/site";
import { chapter, PROJECTS_ORIGIN } from "@/lib/chapters";
import { gsap } from "@/lib/gsap";
import { rng } from "@/lib/random";
import { sceneState } from "@/lib/sceneState";
import { useApp } from "@/store/useApp";
import { duneFrag, duneVert, prismFrag, prismVert } from "../shaders/projects";

export const PRISM_URL = "/models/prism.glb";
export const PRISM_Y = 1.7;
const COVERS = projects.map((p) => p.cover);

/** Chapter 4 — a glass prism holding the active project, on a particle dune. */
export default function Projects() {
  const group = useRef<THREE.Group>(null);
  const isMobile = useApp((s) => s.isMobile);
  const visibleRange = useMemo(() => {
    const tu = chapter("tunnel");
    const pr = chapter("projects");
    return [tu.end - 0.002, pr.end + 0.03] as const;
  }, []);

  useFrame(() => {
    const p = sceneState.p;
    if (group.current) group.current.visible = p >= visibleRange[0] && p <= visibleRange[1];
  });

  return (
    <group ref={group} position={PROJECTS_ORIGIN} visible={false}>
      <Dune count={isMobile ? 11000 : 42000} />
      <Prism />
    </group>
  );
}

function Dune({ count }: { count: number }) {
  const dpr = useThree((s) => s.viewport.dpr);
  const { geometry, material } = useMemo(() => {
    const random = rng(5);
    const pos = new Float32Array(count * 3);
    const rnd = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      // denser near the prism, thinning toward the horizon
      const r = Math.pow(random(), 0.65) * 40;
      const a = random() * Math.PI * 2;
      pos[i * 3] = Math.cos(a) * r;
      pos[i * 3 + 2] = Math.sin(a) * r * 0.9 - 6;
      rnd[i] = random();
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

function Prism() {
  const { nodes } = useGLTF(PRISM_URL, "/draco/") as unknown as { nodes: Record<string, THREE.Mesh> };
  const textures = useTexture(COVERS);
  const spin = useRef<THREE.Group>(null);
  const state = useRef({ spin: 0, pulse: 0 });

  useMemo(() => {
    for (const t of textures) {
      t.colorSpace = THREE.SRGBColorSpace;
      t.anisotropy = 4;
    }
  }, [textures]);

  const [main, mirror] = useMemo(() => {
    const make = (reflect: boolean) =>
      new THREE.ShaderMaterial({
        vertexShader: prismVert,
        fragmentShader: prismFrag,
        toneMapped: false,
        uniforms: {
          uTexA: { value: textures[0] },
          uTexB: { value: textures[0] },
          uMix: { value: 0 },
          uTime: { value: 0 },
          uTint: { value: new THREE.Color(projects[0].tint) },
          uReflect: { value: reflect ? 1 : 0 },
          uFloorY: { value: 0 },
          uScreenH: { value: 3.0 },
        },
      });
    return [make(false), make(true)];
  }, [textures]);

  useEffect(
    () => () => {
      main.dispose();
      mirror.dispose();
    },
    [main, mirror],
  );

  // project switch: noise-dissolve to the next image, retint, and give the prism a turn
  useEffect(() => {
    return useApp.subscribe((s, prev) => {
      if (s.activeProject === prev.activeProject) return;
      const next = s.activeProject;
      const dir = next > prev.activeProject ? 1 : -1;
      const tint = new THREE.Color(projects[next].tint);
      for (const m of [main, mirror]) {
        // whatever is on screen now becomes A; fade to B
        m.uniforms.uTexA.value = m.uniforms.uMix.value > 0.5 ? m.uniforms.uTexB.value : m.uniforms.uTexA.value;
        m.uniforms.uTexB.value = textures[next];
        gsap.fromTo(m.uniforms.uMix, { value: 0 }, { value: 1, duration: 1.15, ease: "power2.inOut", overwrite: true });
        gsap.to(m.uniforms.uTint.value, { r: tint.r, g: tint.g, b: tint.b, duration: 1.1, ease: "power2.inOut" });
      }
      gsap.to(state.current, { spin: `+=${(Math.PI * 2 * dir) / 7}`, duration: 1.4, ease: "expo.out" });
      gsap.fromTo(state.current, { pulse: 1 }, { pulse: 0, duration: 1.2, ease: "power3.out" });
    });
  }, [main, mirror, textures]);

  useFrame(({ clock }) => {
    const g = spin.current;
    if (!g) return;
    const time = clock.elapsedTime;
    main.uniforms.uTime.value = time;
    mirror.uniforms.uTime.value = time;
    // idle float + slow turn; the switch adds a facet's worth of rotation
    g.rotation.y = time * 0.18 + state.current.spin + sceneState.mouse.x * 0.25 + sceneState.drag * 1.4;
    g.rotation.x = sceneState.mouse.y * 0.06;
    const bob = Math.sin(time * 0.9) * 0.06;
    g.position.y = PRISM_Y + bob;
    const s = 1 + state.current.pulse * 0.06;
    g.scale.setScalar(s);
    main.uniforms.uFloorY.value = PROJECTS_ORIGIN[1];
    mirror.uniforms.uFloorY.value = PROJECTS_ORIGIN[1];
  });

  return (
    <>
      <group ref={spin}>
        <mesh geometry={nodes.Prism.geometry} material={main} />
      </group>
      {/* floor reflection: the same prism mirrored under the dune */}
      <Mirror source={spin} geometry={nodes.Prism.geometry} material={mirror} />
      <pointLight position={[0, 0.4, 1.5]} intensity={4} distance={6} color="#ffffff" />
    </>
  );
}

function Mirror({
  source,
  geometry,
  material,
}: {
  source: React.RefObject<THREE.Group | null>;
  geometry: THREE.BufferGeometry;
  material: THREE.Material;
}) {
  const ref = useRef<THREE.Mesh>(null);
  useFrame(() => {
    const s = source.current;
    const m = ref.current;
    if (!s || !m) return;
    m.rotation.copy(s.rotation);
    m.rotation.x = -s.rotation.x;
    m.position.set(s.position.x, -s.position.y, s.position.z);
    m.scale.set(s.scale.x, -s.scale.y, s.scale.z);
  });
  return <mesh ref={ref} geometry={geometry} material={material} />;
}

useGLTF.preload(PRISM_URL, "/draco/");
useTexture.preload(COVERS);
