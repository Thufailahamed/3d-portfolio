"use client";

import { useGLTF } from "@react-three/drei";
import { useEffect, useMemo } from "react";
import * as THREE from "three";
import type { Car } from "@/content/cars";

/**
 * A car of the line-up as its own object, for the pages that show more than one at a time (the
 * comparison) or that bend it (the crash lab). The glTF is cached and the showroom works on that
 * cached scene in place: it slides parts out, swings doors, swaps materials for per-part copies and
 * fades them. So an instance is a deep clone with every part put back at rest and every material its
 * own fresh copy, reset to the model's look; geometry stays shared with the cache.
 */

type Mat = THREE.MeshStandardMaterial | THREE.MeshPhysicalMaterial;

/** the base look the showroom stashes on its material copies */
type Base = {
  opacity: number;
  transparent: boolean;
  depthWrite: boolean;
  emissive: THREE.Color;
  emissiveIntensity: number;
  color?: THREE.Color;
  metalness?: number;
  roughness?: number;
};

export type InstanceWheel = {
  id: string;
  obj: THREE.Object3D;
  /** hub centre at rest, car frame */
  center: THREE.Vector3;
  radius: number;
  front: boolean;
  left: boolean;
};

export type CarInstance = {
  /** the clone: its frame is the car frame (x to the nose, y up, z to the right, origin on the floor) */
  root: THREE.Group;
  /** the Part_<id> groups by id */
  parts: Map<string, THREE.Object3D>;
  /** every material this instance owns */
  materials: Mat[];
  /** the body paint (physical, clear-coated) */
  paint: THREE.MeshPhysicalMaterial[];
  lamps: { head: Mat[]; tail: Mat[] };
  /** see-through materials that are not lamps, with the part they belong to */
  glass: { mat: Mat; part: string }[];
  /** bounds at rest, car frame */
  box: THREE.Box3;
  /** each part's bounds at rest, car frame */
  boxes: Map<string, THREE.Box3>;
  wheels: InstanceWheel[];
  dispose: () => void;
};

const TAIL = new THREE.Color(1, 0.04, 0.02);

/** Clone a loaded car scene into an independent instance (see the note at the top). */
export function instanceCar(source: THREE.Group, car: Car): CarInstance {
  const root = source.clone(true);
  root.position.set(0, 0, 0);
  root.quaternion.identity();
  root.scale.set(1, 1, 1);

  // parts back at rest: the showroom stashes the true rest pose on the cached scene's groups
  const parts = new Map<string, THREE.Object3D>();
  source.children.forEach((src, i) => {
    const obj = root.children[i];
    if (!obj || !src.name.startsWith("Part_")) return;
    const home = src.userData.home as THREE.Vector3 | undefined;
    const baseQ = src.userData.baseQ as THREE.Quaternion | undefined;
    obj.position.copy(home instanceof THREE.Vector3 ? home : src.position);
    obj.quaternion.copy(baseQ instanceof THREE.Quaternion ? baseQ : src.quaternion);
    // the clone's userData went through JSON; keep only the glTF's own extras
    obj.userData = { part: src.userData.part, explode: src.userData.explode };
    parts.set((src.userData.part as string) ?? src.name.slice(5), obj);
  });

  // fresh materials, reset to the model's look (the showroom may have faded or lit its copies)
  const copies = new Map<string, Mat>();
  const own = (m: THREE.Material): Mat => {
    let c = copies.get(m.uuid);
    if (c) return c;
    c = m.clone() as Mat;
    const base = m.userData.base as Base | undefined;
    if (base) {
      c.opacity = base.opacity;
      c.transparent = base.transparent;
      c.depthWrite = base.depthWrite;
      if (c.emissive) c.emissive.copy(base.emissive);
      c.emissiveIntensity = base.emissiveIntensity ?? 1;
      if (base.color && c.color) c.color.copy(base.color);
      if (base.metalness !== undefined) c.metalness = base.metalness;
      if (base.roughness !== undefined) c.roughness = base.roughness;
    }
    c.userData = { base: snapshot(c) };
    c.visible = true;
    copies.set(m.uuid, c);
    return c;
  };
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    // the showroom portals lamp beams into the cached parts; they are not part of the car
    if (mesh.userData.fx) {
      mesh.visible = false;
      return;
    }
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.material = Array.isArray(mesh.material) ? mesh.material.map(own) : own(mesh.material);
  });
  // lights and other helpers the showroom left in the cached parts
  const strays: THREE.Object3D[] = [];
  root.traverse((o) => {
    if ((o as THREE.Light).isLight || o.userData.beam || o.userData.tail) strays.push(o);
  });
  for (const o of strays) o.parent?.remove(o);

  // the paint: physical, with a fresh clear coat, as in the showroom
  const paint: THREE.MeshPhysicalMaterial[] = [];
  for (const [uuid, m] of copies) {
    if (m.name !== car.paint.material) continue;
    const phys = toPhysical(root, m);
    phys.clearcoat = Math.max(phys.clearcoat, 0.8);
    phys.clearcoatRoughness = Math.min(phys.clearcoatRoughness, 0.06);
    copies.set(uuid, phys);
    paint.push(phys);
  }

  const materials = [...new Set(copies.values())];
  const inPart = (id: string) => {
    const set = new Set<Mat>();
    parts.get(id)?.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      for (const m of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) set.add(m as Mat);
    });
    return set;
  };
  const head = [...inPart("headlights")].filter((m) => car.lamps.head.includes(m.name));
  const tail = [...inPart("taillights")].filter((m) => car.lamps.tail.includes(m.name));

  const glass: CarInstance["glass"] = [];
  for (const [id, obj] of parts) {
    if (id === "headlights" || id === "taillights") continue;
    const seen = new Set<Mat>();
    obj.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      for (const m of (Array.isArray(mesh.material) ? mesh.material : [mesh.material]) as Mat[]) {
        if (seen.has(m)) continue;
        seen.add(m);
        const see = (m.transparent && m.opacity < 0.9 && m.opacity > 0.05) || ((m as THREE.MeshPhysicalMaterial).transmission ?? 0) > 0;
        if (see) glass.push({ mat: m, part: id });
      }
    });
  }

  root.updateMatrixWorld(true);
  const box = new THREE.Box3();
  const boxes = new Map<string, THREE.Box3>();
  for (const [id, obj] of parts) {
    const b = new THREE.Box3().setFromObject(obj);
    boxes.set(id, b);
    box.union(b);
  }
  const wheels: InstanceWheel[] = [];
  for (const [id, obj] of parts) {
    if (!id.startsWith("wheel_")) continue;
    const b = boxes.get(id)!;
    wheels.push({
      id,
      obj,
      center: b.getCenter(new THREE.Vector3()),
      radius: Math.max(0.2, (b.max.y - b.min.y) / 2),
      front: id[6] === "f",
      left: id[7] === "l",
    });
  }

  return {
    root,
    parts,
    materials,
    paint,
    lamps: { head, tail },
    glass,
    box,
    boxes,
    wheels,
    dispose: () => materials.forEach((m) => m.dispose()),
  };
}

function snapshot(m: Mat): Base {
  return {
    opacity: m.opacity,
    transparent: m.transparent,
    depthWrite: m.depthWrite,
    emissive: m.emissive ? m.emissive.clone() : new THREE.Color(0),
    emissiveIntensity: m.emissiveIntensity ?? 1,
    color: m.color?.clone(),
    metalness: m.metalness,
    roughness: m.roughness,
  };
}

/** Swap a standard material for a physical one with the same look, everywhere it is used in the instance. */
function toPhysical(root: THREE.Object3D, m: Mat): THREE.MeshPhysicalMaterial {
  if ((m as THREE.MeshPhysicalMaterial).isMeshPhysicalMaterial) return m as THREE.MeshPhysicalMaterial;
  const phys = new THREE.MeshPhysicalMaterial();
  THREE.MeshStandardMaterial.prototype.copy.call(phys, m);
  phys.userData = m.userData;
  phys.clearcoat = 0.8;
  phys.clearcoatRoughness = 0.06;
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    if (Array.isArray(mesh.material)) mesh.material = mesh.material.map((x) => (x === m ? phys : x));
    else if (mesh.material === m) mesh.material = phys;
  });
  m.dispose();
  return phys;
}

/** Light the lamps (0 off … 1 on), the way the showroom does: lit lenses brighten, dark ones glow in their colour. */
export function setLamps(inst: CarInstance, level: number, headColor: THREE.Color = new THREE.Color("#ffeed1")) {
  for (const [list, isHead] of [[inst.lamps.head, true], [inst.lamps.tail, false]] as const) {
    for (const m of list) {
      const base = m.userData.base as Base;
      if (base.emissive.getHex() !== 0) {
        m.emissive.copy(base.emissive);
        m.emissiveIntensity = base.emissiveIntensity * (1 + level * 2.5);
      } else {
        m.emissive.copy(isHead ? headColor : TAIL).multiplyScalar(level);
        m.emissiveIntensity = isHead ? 7 : 5;
      }
    }
  }
}

/** Load a car of the line-up and make an instance of it for this component (disposed with it). */
export function useCarInstance(car: Car) {
  const { scene } = useGLTF(car.model, "/draco/");
  const inst = useMemo(() => instanceCar(scene, car), [scene, car]);
  useEffect(() => () => inst.dispose(), [inst]);
  return inst;
}
