"use client";

import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { crushAt, frameAt, lerpRow, type Playback } from "../playback";
import { bandCoord, project } from "../sim/geometry";
import { NB, NS, type BodyDef, type Timeline } from "../sim/types";
import { hazard, honeycomb, loadCellPlate, poleBand, stencil } from "./hallTextures";

/** A barrier from the timeline: placed by its own track, its deformable faces crushed by its own crush track. */
export default function Barriers({ timeline, playback }: { timeline: Timeline; playback: Playback }) {
  return (
    <>
      {timeline.bodies.map((b, i) =>
        b.kind === "car" ? null : <Barrier key={`${b.kind}${i}`} timeline={timeline} index={i} def={b} playback={playback} />,
      )}
    </>
  );
}

function Barrier({ timeline, index, def, playback }: { timeline: Timeline; index: number; def: BodyDef; playback: Playback }) {
  const group = useRef<THREE.Group>(null);
  const pose = useMemo(() => new Float32Array(6), []);
  const track = timeline.tracks[index];
  useFrame(() => {
    const g = group.current;
    if (!g) return;
    const [i, f] = frameAt(timeline.times, playback.t);
    lerpRow(track.pose, 6, i, f, pose);
    g.position.set(pose[0], 0, pose[2]);
    g.rotation.set(0, pose[3], 0);
  });
  return (
    <group ref={group}>
      {def.kind === "wall" && <Block def={def} />}
      {def.kind === "odb" && <Odb def={def} timeline={timeline} index={index} playback={playback} />}
      {def.kind === "pole" && <Pole />}
      {def.kind === "mdb" && <Trolley def={def} timeline={timeline} index={index} playback={playback} />}
    </group>
  );
}

// ------------------------------------------------------------------ materials

function useConcrete() {
  return useMemo(() => {
    const c = document.createElement("canvas");
    c.width = c.height = 256;
    const g = c.getContext("2d")!;
    const img = g.createImageData(256, 256);
    for (let k = 0; k < 256 * 256; k++) {
      const v = 150 + ((Math.sin(k * 12.9898) * 43758.5453) % 1) * 30 + ((k * 7) % 97) * 0.08;
      img.data.set([v, v, v * 1.01, 255], k * 4);
    }
    g.putImageData(img, 0, 0);
    const t = new THREE.CanvasTexture(c);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(3, 2);
    t.colorSpace = THREE.SRGBColorSpace;
    return new THREE.MeshStandardMaterial({ color: "#9a9a98", map: t, roughness: 0.92, metalness: 0 });
  }, []);
}

/** A rounded-rectangle prism (plan from the body), `h` tall. */
function prism(def: BodyDef, h: number, inset = 0) {
  const { hx, hz, cx, cz } = def.plan;
  const rc = Math.max(0.005, def.plan.rc - inset);
  const ax = hx - inset, az = hz - inset;
  const s = new THREE.Shape();
  // shape in (x, -z) so that after rotating to stand up it matches the body's frame
  s.moveTo(cx - ax + rc, -(cz - az));
  s.lineTo(cx + ax - rc, -(cz - az));
  s.quadraticCurveTo(cx + ax, -(cz - az), cx + ax, -(cz - az + rc));
  s.lineTo(cx + ax, -(cz + az - rc));
  s.quadraticCurveTo(cx + ax, -(cz + az), cx + ax - rc, -(cz + az));
  s.lineTo(cx - ax + rc, -(cz + az));
  s.quadraticCurveTo(cx - ax, -(cz + az), cx - ax, -(cz + az - rc));
  s.lineTo(cx - ax, -(cz - az + rc));
  s.quadraticCurveTo(cx - ax, -(cz - az), cx - ax + rc, -(cz - az));
  const geo = new THREE.ExtrudeGeometry(s, { depth: h, bevelEnabled: false, curveSegments: 10 });
  geo.rotateX(-Math.PI / 2);
  return geo;
}

// ------------------------------------------------------------------ the rigid block

function Block({ def }: { def: BodyDef }) {
  const concrete = useConcrete();
  const geo = useMemo(() => prism(def, 1.5), [def]);
  const plate = useMemo(() => loadCellPlate(Math.max(4, Math.round(def.plan.hz * 2 / 0.25)), 6), [def]);
  const stripes = useMemo(() => hazard(4), []);
  const label = useMemo(() => stencil(), []);
  useEffect(() => () => [geo, plate, stripes, label].forEach((x) => x.dispose()), [geo, plate, stripes, label]);
  const w = def.plan.hz * 2;
  return (
    <group>
      <mesh geometry={geo} castShadow receiveShadow material={concrete} />
      {/* the steel face with its load cells */}
      <mesh position={[0.012, 0.76, def.plan.cz]} rotation-y={Math.PI / 2} receiveShadow castShadow>
        <boxGeometry args={[w - 0.04, 1.44, 0.02]} />
        <meshStandardMaterial map={plate} metalness={0.75} roughness={0.42} color="#c9cbcd" />
      </mesh>
      {/* hazard stripes along the face's top edge and down its corners */}
      <mesh position={[0.025, 1.47, def.plan.cz]} rotation-y={Math.PI / 2}>
        <planeGeometry args={[w, 0.06]} />
        <meshStandardMaterial map={stripes} roughness={0.7} />
      </mesh>
      {[-1, 1].map((s) => (
        <mesh key={s} position={[-0.75, 0.75, def.plan.cz + s * (def.plan.hz + 0.003)]} rotation-y={s > 0 ? 0 : Math.PI}>
          <planeGeometry args={[1.5, 1.5]} />
          <meshStandardMaterial map={label} transparent roughness={0.9} depthWrite={false} />
        </mesh>
      ))}
    </group>
  );
}

// ------------------------------------------------------------------ deformable faces

/** A subdivided box (barrier frame) whose vertices are pushed back by the barrier's crush grid. */
function useCrushedBox(def: BodyDef, timeline: Timeline, index: number, playback: Playback, box: [number, number, number, number, number, number], segs: [number, number, number]) {
  const geo = useMemo(() => {
    const [x0, y0, z0, x1, y1, z1] = box;
    const g = new THREE.BoxGeometry(x1 - x0, y1 - y0, z1 - z0, segs[0], segs[1], segs[2]);
    g.translate((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
    return g;
  }, [box, segs]);
  const rest = useMemo(() => Float32Array.from(geo.attributes.position.array as Float32Array), [geo]);
  const grid = useMemo(() => new Float32Array(NB * NS * 3), []);
  const last = useRef(NaN);
  const pr = useMemo(() => ({ u: 0, d: 0, nx: 0, nz: 0 }), []);
  useEffect(() => () => geo.dispose(), [geo]);
  useFrame(() => {
    const t = playback.t;
    if (t === last.current) return;
    last.current = t;
    crushAt(timeline.crush[index], t, grid);
    const pos = geo.attributes.position.array as Float32Array;
    for (let v = 0; v < rest.length; v += 3) {
      const x = rest[v], y = rest[v + 1], z = rest[v + 2];
      project(def.plan, x, z, pr);
      const bc = Math.min(NB - 1, Math.max(0, bandCoord(y) - 0.5));
      const b0 = Math.floor(bc), b1 = Math.min(NB - 1, b0 + 1), fb = bc - b0;
      const s = Math.round(pr.u * NS) % NS;
      const C = grid[(b0 * NS + s) * 3] * (1 - fb) + grid[(b1 * NS + s) * 3] * fb;
      const L = Math.max(C + 1e-4, grid[(b0 * NS + s) * 3 + 1] * (1 - fb) + grid[(b1 * NS + s) * 3 + 1] * fb);
      const e = def.surface[b0 * NS + s] < 9 ? def.surface[b0 * NS + s] : 0;
      const d = Math.max(0, pr.d - e);
      const push = d < L ? C * (1 - d / L) : 0;
      // honeycomb crushes flat, wrinkling its foil a little
      pos[v] = x - push;
      pos[v + 1] = y + (push > 0.01 ? Math.sin(x * 60 + z * 23) * Math.min(0.012, push * 0.05) : 0);
      pos[v + 2] = z;
    }
    geo.attributes.position.needsUpdate = true;
    geo.computeVertexNormals();
  });
  return geo;
}

function Odb({ def, timeline, index, playback }: { def: BodyDef; timeline: Timeline; index: number; playback: Playback }) {
  const concrete = useConcrete();
  const hex = useMemo(() => honeycomb(), []);
  const stripes = useMemo(() => hazard(3), []);
  useEffect(() => () => [hex, stripes].forEach((x) => x.dispose()), [hex, stripes]);
  const main = useCrushedBox(def, timeline, index, playback, [-0.54, 0.2, -0.5, -0.09, 0.85, 0.5], [18, 14, 30]);
  const bumper = useCrushedBox(def, timeline, index, playback, [-0.09, 0.33, -0.5, 0, 0.58, 0.5], [6, 6, 30]);
  const foil = useMemo(() => new THREE.MeshStandardMaterial({ map: hex, metalness: 0.85, roughness: 0.38, color: "#d2d5d8" }), [hex]);
  return (
    <group>
      {/* the rigid block behind the honeycomb */}
      <mesh position={[-1.27 - 0.27, 0.75, 0]} castShadow receiveShadow material={concrete}>
        <boxGeometry args={[2, 1.5, 1.0]} />
      </mesh>
      <mesh position={[-0.55, 0.11, 0]} material={concrete} castShadow receiveShadow>
        <boxGeometry args={[0.04, 0.18, 1.0]} />
      </mesh>
      <mesh geometry={main} material={foil} castShadow receiveShadow />
      <mesh geometry={bumper} material={foil} castShadow receiveShadow />
      <mesh position={[-0.52, 0.9, 0]} rotation-y={Math.PI / 2}>
        <planeGeometry args={[1.0, 0.08]} />
        <meshStandardMaterial map={stripes} roughness={0.7} />
      </mesh>
    </group>
  );
}

// ------------------------------------------------------------------ the pole

function Pole() {
  const band = useMemo(() => poleBand(), []);
  useEffect(() => () => band.dispose(), [band]);
  return (
    <group>
      <mesh position-y={1.6} castShadow receiveShadow>
        <cylinderGeometry args={[0.127, 0.127, 3.2, 40]} />
        <meshStandardMaterial color="#3a3c40" metalness={0.6} roughness={0.45} />
      </mesh>
      <mesh position-y={1.15} castShadow>
        <cylinderGeometry args={[0.129, 0.129, 0.12, 40, 1, true]} />
        <meshStandardMaterial map={band} roughness={0.6} />
      </mesh>
      <mesh position-y={0.04} castShadow receiveShadow>
        <boxGeometry args={[0.9, 0.08, 0.9]} />
        <meshStandardMaterial color="#2c2e31" metalness={0.5} roughness={0.6} />
      </mesh>
      {[-1, 1].flatMap((sx) => [-1, 1].map((sz) => (
        <mesh key={`${sx}${sz}`} position={[sx * 0.36, 0.09, sz * 0.36]}>
          <cylinderGeometry args={[0.025, 0.025, 0.03, 12]} />
          <meshStandardMaterial color="#8d8f92" metalness={0.9} roughness={0.3} />
        </mesh>
      )))}
    </group>
  );
}

// ------------------------------------------------------------------ the side trolley

function Trolley({ def, timeline, index, playback }: { def: BodyDef; timeline: Timeline; index: number; playback: Playback }) {
  const hex = useMemo(() => honeycomb(), []);
  const stripes = useMemo(() => hazard(4), []);
  useEffect(() => () => [hex, stripes].forEach((x) => x.dispose()), [hex, stripes]);
  const lower = useCrushedBox(def, timeline, index, playback, [-0.5, 0.3, -0.85, 0, 0.55, 0.85], [14, 6, 34]);
  const upper = useCrushedBox(def, timeline, index, playback, [-0.5, 0.55, -0.85, -0.06, 0.8, 0.85], [14, 6, 34]);
  const foil = useMemo(() => new THREE.MeshStandardMaterial({ map: hex, metalness: 0.85, roughness: 0.38, color: "#d2d5d8" }), [hex]);
  const steel = useMemo(() => new THREE.MeshStandardMaterial({ color: "#1d1f22", metalness: 0.6, roughness: 0.5 }), []);
  const wheels = useRef<THREE.Group>(null);
  const spin = useMemo(() => new Float32Array(6), []);
  useFrame(() => {
    const [i, f] = frameAt(timeline.times, playback.t);
    lerpRow(timeline.tracks[index].wheels, 6, i, f, spin);
    wheels.current?.children.forEach((w, k) => (w.rotation.y = -spin[k]));
  });
  return (
    <group>
      <mesh geometry={lower} material={foil} castShadow receiveShadow />
      <mesh geometry={upper} material={foil} castShadow receiveShadow />
      {/* the backing plate and the frame */}
      <mesh position={[-0.53, 0.55, 0]} material={steel} castShadow>
        <boxGeometry args={[0.05, 0.56, 1.76]} />
      </mesh>
      <mesh position={[-2.2, 0.32, 0]} material={steel} castShadow receiveShadow>
        <boxGeometry args={[3.4, 0.14, 1.3]} />
      </mesh>
      {[-1, 1].map((s) => (
        <mesh key={s} position={[-2.2, 0.48, s * 0.62]} material={steel} castShadow>
          <boxGeometry args={[3.4, 0.18, 0.08]} />
        </mesh>
      ))}
      {/* ballast */}
      {[0, 1, 2, 3].map((k) => (
        <mesh key={k} position={[-2.4, 0.46 + k * 0.07, 0]} castShadow>
          <boxGeometry args={[1.0, 0.06, 0.9]} />
          <meshStandardMaterial color="#5a5d61" metalness={0.7} roughness={0.5} />
        </mesh>
      ))}
      <mesh position={[-0.52, 0.86, 0]} rotation-y={Math.PI / 2}>
        <planeGeometry args={[1.76, 0.07]} />
        <meshStandardMaterial map={stripes} roughness={0.7} />
      </mesh>
      <group ref={wheels}>
        {[[def.axleF, -0.75], [def.axleF, 0.75], [def.axleR, -0.75], [def.axleR, 0.75]].map(([x, z], k) => (
          <mesh key={k} position={[x, 0.3, z]} rotation-x={Math.PI / 2} castShadow>
            <cylinderGeometry args={[0.3, 0.3, 0.2, 28]} />
            <meshStandardMaterial color="#141416" roughness={0.85} />
          </mesh>
        ))}
      </group>
    </group>
  );
}
