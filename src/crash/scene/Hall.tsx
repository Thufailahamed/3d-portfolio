"use client";

import { Environment, Lightformer, MeshReflectorMaterial } from "@react-three/drei";
import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { floorNoise } from "@/components/showroom/ShowroomScene";
import { floorMarkings } from "./hallTextures";

export type HallLights = "off" | "up" | "on";

/** The canopy of high-intensity panels over the impact zone: COLS × ROWS, each PANEL m. */
const COLS = 5, ROWS = 3, PANEL: [number, number] = [2.0, 0.9], CANOPY_Y = 7.2;
const panelAt = (i: number) => {
  const c = i % COLS, r = Math.floor(i / COLS);
  return [(c - (COLS - 1) / 2) * 2.6, CANOPY_Y, (r - (ROWS - 1) / 2) * 2.4] as const;
};

/**
 * The test hall: a dark, high space whose impact zone is lit like a stage by a canopy of light panels
 * (switched on only for the test, as the hot, bright lamps of a high-speed film set are), polished
 * concrete with the painted grid, the approach lane and its tow-rail slot, camera tripods and lamp
 * stands round the zone, an overhead camera gantry. `center` is the impact point on the floor.
 */
export default function Hall({ lights, lite, center }: { lights: HallLights; lite: boolean; center: [number, number] }) {
  const scene = useThree((s) => s.scene);
  const markings = useMemo(() => floorMarkings(), []);
  const noise = useMemo(() => floorNoise(256), []);
  useEffect(() => () => [markings, noise].forEach((t) => t.dispose()), [markings, noise]);
  const panels = useMemo(() => Array.from({ length: COLS * ROWS }, () => new THREE.MeshBasicMaterial({ color: 0, toneMapped: false })), []);
  const spots = useRef<(THREE.SpotLight | null)[]>([]);
  const key = useRef<THREE.DirectionalLight>(null);
  const hemi = useRef<THREE.HemisphereLight>(null);
  const work = useRef<THREE.PointLight>(null);
  const power = useRef({ since: -1, level: 0, prev: lights as HallLights });

  useFrame((state) => {
    const now = state.clock.elapsedTime;
    const p = power.current;
    if (lights !== p.prev) {
      p.prev = lights;
      p.since = now;
    }
    const t = lights === "off" ? -1 : lights === "on" && p.since < 0 ? 99 : now - p.since;
    // each bank strikes in turn, flickers as it catches, then holds
    let total = 0;
    panels.forEach((m, i) => {
      const delay = 0.12 + ((i * 7) % panels.length) * 0.13;
      let v = 0;
      if (lights !== "off") {
        const u = (t - delay) / 0.35;
        v = u <= 0 ? 0 : u < 1 ? (Math.sin(now * 90 + i * 7) > 0.2 ? 0.25 : 1) * u : 1;
        if (lights === "on" && t > 50) v = 1;
      }
      m.color.setRGB(1, 0.985, 0.96).multiplyScalar(v * 6);
      total += v;
    });
    const level = total / panels.length;
    p.level = level;
    spots.current.forEach((s) => s && (s.intensity = 260 * level));
    if (key.current) key.current.intensity = 2.6 * level;
    if (hemi.current) hemi.current.intensity = 0.07 + 0.5 * level;
    if (work.current) work.current.intensity = 6 * (1 - level * 0.7);
    scene.environmentIntensity = 0.25 + 0.75 * level;
  });

  const [cx, cz] = center;
  return (
    <group>
      <color attach="background" args={["#060607"]} />
      <fog attach="fog" args={["#060607", 18, 46]} />

      {/* reflections in the paint: the canopy above, bright and rectangular; a dim hall round it */}
      <Environment resolution={lite ? 128 : 256} frames={1}>
        <color attach="background" args={["#050506"]} />
        {Array.from({ length: COLS * ROWS }, (_, i) => {
          const [x, y, z] = panelAt(i);
          return <Lightformer key={i} form="rect" intensity={4} color="#fff7ee" position={[x, y, z]} rotation-x={Math.PI / 2} scale={[PANEL[0], PANEL[1], 1]} />;
        })}
        <Lightformer form="rect" intensity={0.35} color="#d8dde6" position={[0, 2.5, 14]} rotation-y={Math.PI} scale={[30, 3, 1]} />
        <Lightformer form="rect" intensity={0.35} color="#d8dde6" position={[0, 2.5, -14]} scale={[30, 3, 1]} />
        <Lightformer form="rect" intensity={0.25} color="#9a9ca4" position={[0, -0.5, 0]} rotation-x={-Math.PI / 2} scale={[30, 30, 1]} />
      </Environment>

      {/* polished concrete: a satin, blurred reflection that varies across the slab */}
      <mesh rotation-x={-Math.PI / 2} receiveShadow>
        <planeGeometry args={[120, 80]} />
        {lite ? (
          <meshStandardMaterial color="#4f5154" roughness={0.6} roughnessMap={noise} metalness={0.05} />
        ) : (
          <MeshReflectorMaterial
            resolution={1024}
            blur={[320, 110]}
            mixBlur={0.92}
            mixStrength={2.2}
            mixContrast={1.1}
            depthScale={1.1}
            minDepthThreshold={0.4}
            maxDepthThreshold={1.3}
            roughnessMap={noise}
            roughness={0.62}
            metalness={0.12}
            color="#47494c"
          />
        )}
      </mesh>
      {/* painted markings, a hair above the slab */}
      <mesh rotation-x={-Math.PI / 2} position={[cx, 0.0025, cz]} renderOrder={1}>
        <planeGeometry args={[28, 28]} />
        <meshStandardMaterial map={markings} transparent roughness={0.55} polygonOffset polygonOffsetFactor={-2} depthWrite={false} />
      </mesh>

      {/* the hall: walls and a ceiling that fall into darkness */}
      <mesh position={[0, 6, -16]} receiveShadow>
        <planeGeometry args={[90, 14]} />
        <meshStandardMaterial color="#1a1b1d" roughness={0.95} />
      </mesh>
      <mesh position={[0, 6, 16]} rotation-y={Math.PI} receiveShadow>
        <planeGeometry args={[90, 14]} />
        <meshStandardMaterial color="#1a1b1d" roughness={0.95} />
      </mesh>
      <mesh position={[20, 6, 0]} rotation-y={-Math.PI / 2} receiveShadow>
        <planeGeometry args={[34, 14]} />
        <meshStandardMaterial color="#17181a" roughness={0.95} />
      </mesh>
      {/* acoustic panels along the walls, to give the dark some scale */}
      {Array.from({ length: 14 }, (_, i) => (
        <mesh key={i} position={[-26 + i * 4, 3.4, -15.9]}>
          <planeGeometry args={[3.4, 4.4]} />
          <meshStandardMaterial color="#232427" roughness={1} />
        </mesh>
      ))}

      {/* the light canopy and its frame */}
      <group>
        {Array.from({ length: COLS * ROWS }, (_, i) => {
          const [x, y, z] = panelAt(i);
          return (
            <group key={i} position={[x + cx, y, z + cz]}>
              <mesh rotation-x={Math.PI / 2} material={panels[i]}>
                <planeGeometry args={PANEL} />
              </mesh>
              <mesh position-y={0.09}>
                <boxGeometry args={[PANEL[0] + 0.12, 0.16, PANEL[1] + 0.12]} />
                <meshStandardMaterial color="#141517" metalness={0.5} roughness={0.6} />
              </mesh>
            </group>
          );
        })}
        <Truss from={[cx - 7.5, CANOPY_Y + 0.3, cz - 3.6]} to={[cx + 7.5, CANOPY_Y + 0.3, cz - 3.6]} />
        <Truss from={[cx - 7.5, CANOPY_Y + 0.3, cz + 3.6]} to={[cx + 7.5, CANOPY_Y + 0.3, cz + 3.6]} />
        <Truss from={[cx - 7.5, CANOPY_Y + 0.3, cz - 3.6]} to={[cx - 7.5, CANOPY_Y + 0.3, cz + 3.6]} />
        <Truss from={[cx + 7.5, CANOPY_Y + 0.3, cz - 3.6]} to={[cx + 7.5, CANOPY_Y + 0.3, cz + 3.6]} />
        {/* the overhead high-speed camera on its boom */}
        <group position={[cx, CANOPY_Y - 0.4, cz + 0.6]}>
          <mesh>
            <boxGeometry args={[0.36, 0.26, 0.28]} />
            <meshStandardMaterial color="#202226" metalness={0.4} roughness={0.5} />
          </mesh>
          <mesh position-y={-0.2}>
            <cylinderGeometry args={[0.07, 0.08, 0.16, 20]} />
            <meshStandardMaterial color="#0b0b0c" metalness={0.6} roughness={0.3} />
          </mesh>
        </group>
      </group>

      {/* tripods with high-speed cameras and lamp heads round the zone */}
      {[
        [-1.5, 9.5],
        [4.5, 8],
        [-1.5, -9.5],
        [6, -7],
        [-8, 6],
      ].map(([x, z], i) => (
        <Tripod key={i} at={[cx + x, cz + z]} look={[cx, cz]} lamp={i % 2 === 1} />
      ))}

      {/* real light: shadow-casting key from the canopy, pools from its corners, a dim fill, a work lamp */}
      <directionalLight
        ref={key}
        position={[cx + 3, 12, cz + 4]}
        intensity={0}
        castShadow
        shadow-mapSize={lite ? [1024, 1024] : [2048, 2048]}
        shadow-bias={-0.0004}
        shadow-normalBias={0.03}
        shadow-camera-left={-9}
        shadow-camera-right={9}
        shadow-camera-top={9}
        shadow-camera-bottom={-9}
        shadow-camera-near={1}
        shadow-camera-far={30}
      />
      {[[-5, -2.4], [5, -2.4], [-5, 2.4], [5, 2.4]].map(([x, z], i) => (
        <spotLight
          key={i}
          ref={(s) => {
            spots.current[i] = s;
            if (s) {
              s.target.position.set(cx + x * 0.3, 0, cz + z * 0.3);
              s.target.updateMatrixWorld();
            }
          }}
          position={[cx + x, CANOPY_Y - 0.2, cz + z]}
          angle={0.75}
          penumbra={0.9}
          decay={2}
          intensity={0}
          color="#fff6ec"
        />
      ))}
      <hemisphereLight ref={hemi} args={["#d6dbe4", "#1a1a1c", 0.07]} />
      <pointLight ref={work} position={[cx - 14, 4, cz + 9]} intensity={6} distance={30} decay={1.6} color="#ffd9a8" />
    </group>
  );
}

function Truss({ from, to }: { from: [number, number, number]; to: [number, number, number] }) {
  const { pos, len, rot } = useMemo(() => {
    const a = new THREE.Vector3(...from), b = new THREE.Vector3(...to);
    const d = b.clone().sub(a);
    return { pos: a.clone().add(b).multiplyScalar(0.5), len: d.length(), rot: Math.atan2(-d.z, d.x) };
  }, [from, to]);
  return (
    <group position={pos} rotation-y={rot}>
      {/* three chords along the span */}
      {[[-0.15, -0.15], [-0.15, 0.15], [0.15, 0]].map(([y, z], i) => (
        <mesh key={i} position={[0, y, z]} rotation-z={Math.PI / 2}>
          <cylinderGeometry args={[0.025, 0.025, len, 8]} />
          <meshStandardMaterial color="#3b3d41" metalness={0.8} roughness={0.35} />
        </mesh>
      ))}
    </group>
  );
}

function Tripod({ at, look, lamp }: { at: [number, number]; look: [number, number]; lamp: boolean }) {
  const yaw = Math.atan2(-(look[1] - at[1]), look[0] - at[0]);
  const h = lamp ? 2.4 : 1.25;
  return (
    <group position={[at[0], 0, at[1]]} rotation-y={yaw}>
      {[0, 1, 2].map((k) => {
        const a = (k / 3) * Math.PI * 2;
        return (
          <mesh key={k} position={[Math.cos(a) * 0.22, h / 2, Math.sin(a) * 0.22]} rotation={[Math.sin(a) * 0.17, 0, -Math.cos(a) * 0.17]} castShadow>
            <cylinderGeometry args={[0.012, 0.016, h, 8]} />
            <meshStandardMaterial color="#202124" metalness={0.6} roughness={0.4} />
          </mesh>
        );
      })}
      {lamp ? (
        <group position-y={h + 0.15} rotation-z={-0.35}>
          <mesh castShadow>
            <boxGeometry args={[0.32, 0.42, 0.52]} />
            <meshStandardMaterial color="#17181a" metalness={0.4} roughness={0.5} />
          </mesh>
          <mesh position-x={0.165} rotation-y={Math.PI / 2}>
            <planeGeometry args={[0.44, 0.34]} />
            <meshBasicMaterial color="#fff4e2" toneMapped={false} />
          </mesh>
        </group>
      ) : (
        <group position-y={h + 0.1}>
          <mesh castShadow>
            <boxGeometry args={[0.3, 0.18, 0.18]} />
            <meshStandardMaterial color="#2b2d31" metalness={0.5} roughness={0.45} />
          </mesh>
          <mesh position-x={0.2} rotation-z={Math.PI / 2}>
            <cylinderGeometry args={[0.055, 0.06, 0.12, 20]} />
            <meshStandardMaterial color="#0a0a0b" metalness={0.7} roughness={0.25} />
          </mesh>
          <mesh position={[0.05, 0.11, 0]}>
            <boxGeometry args={[0.08, 0.04, 0.06]} />
            <meshBasicMaterial color="#c4111b" toneMapped={false} />
          </mesh>
        </group>
      )}
    </group>
  );
}
