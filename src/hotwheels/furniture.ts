import * as THREE from "three";
import type { Park, Prop } from "./park";
import { marks, newFrame, type Track, type TrackFrame } from "./track";
import { TRACK } from "./units";
import { yardQuat } from "./yard";

/**
 * Where everything solid in the park stands, worked out once and shared by the physics (as
 * colliders) and the renderer (as meshes), so what you see is what cars hit.
 */

/** sizes of the moulded track furniture (cm) */
export const LAUNCHER = { len: 13, w: 7.4, h: 4.2 };
export const BOOSTER = { len: 12, w: 11, h: 5.6, wheelR: 2.3 };
export const BLOCK = 4;

export type Support =
  | { kind: "pillar"; x: number; z: number; top: number; yaw: number }
  | { kind: "arm"; from: THREE.Vector3; to: THREE.Vector3; yaw: number };

export type Connector = { f: TrackFrame };

export type Block = { pos: THREE.Vector3; quat: THREE.Quaternion; color: string; letter: number; size: number };

export type StaticShape =
  | { type: "box"; center: THREE.Vector3; half: THREE.Vector3; quat: THREE.Quaternion; kind: string }
  | { type: "cyl"; center: THREE.Vector3; r: number; hh: number; kind: string }
  | { type: "hull"; pts: Float32Array; kind: string };

const yawOf = (t: THREE.Vector3) => Math.atan2(t.x, t.z);
const qYaw = (yaw: number) => new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw);

/** Pillars to the floor (or arms in to a tower) wherever a track runs off the ground. */
export function supportsFor(track: Track): Support[] {
  const mode = track.spec.supports ?? { mode: "pillar" };
  if (mode.mode === "none") return [];
  const out: Support[] = [];
  const skip = [...(track.spec.noSupport ?? []), ...track.loops.map((l) => ({ s0: l.s0 - 6, s1: l.s1 + 6 }))];
  for (const { s, f } of marks(track, 34, 17)) {
    if (skip.some((z) => s >= z.s0 && s <= z.s1)) continue;
    if (f.u.y < 0.8) continue;
    const under = f.p.y - 0.62;
    if (under < 2.2) continue;
    if (mode.mode === "arms") {
      const dx = f.p.x - mode.center[0];
      const dz = f.p.z - mode.center[1];
      const d = Math.hypot(dx, dz);
      if (d < mode.r + 8) {
        const inner = new THREE.Vector3(mode.center[0] + (dx / d) * 16.5, under - 0.5, mode.center[1] + (dz / d) * 16.5);
        const outer = new THREE.Vector3(f.p.x - (dx / d) * 0.4, under - 0.5, f.p.z - (dz / d) * 0.4);
        out.push({ kind: "arm", from: inner, to: outer, yaw: Math.atan2(dx, dz) });
        continue;
      }
    }
    out.push({ kind: "pillar", x: f.p.x, z: f.p.z, top: under, yaw: yawOf(f.t) });
  }
  return out;
}

/** The little clips under every joint between track pieces. */
export function connectorsFor(track: Track): Connector[] {
  return marks(track, TRACK.piece, TRACK.piece)
    .filter((m) => m.s < track.length - 2)
    .map((m) => ({ f: m.f }));
}

const BLOCK_COLORS = ["#d8382c", "#2f6fd6", "#f2c230", "#3aa35b", "#e8d6b0", "#ef7d2a"];

/**
 * A castle of alphabet blocks: a gatehouse wall between two towers, crenellated along the top.
 * Built in its own frame (the wall runs along local x, facing local z) then turned into place.
 */
export function castleBlocks(x: number, z: number, yaw: number): Block[] {
  const out: Block[] = [];
  const q = qYaw(yaw);
  // enough gap that the jitter below never has two blocks' corners overlapping (they'd pop apart when woken)
  const gap = 0.12;
  const s = BLOCK + gap;
  // stacked courses sit almost on each other (a sleeping block hangs where it was put)
  const sy = BLOCK + 0.01;
  let letter = 0;
  const put = (lx: number, ly: number, lz: number, size = BLOCK) => {
    const local = new THREE.Vector3(lx, ly, lz).applyQuaternion(q);
    // a hair of jitter: hand-stacked, not machine-placed
    const jit = qYaw(((letter * 7919) % 13) / 13 * 0.03 - 0.015);
    out.push({ pos: local.add(new THREE.Vector3(x, 0, z)), quat: q.clone().multiply(jit), color: BLOCK_COLORS[(letter * 5 + Math.floor(ly)) % BLOCK_COLORS.length], letter: letter++ % 16, size });
  };
  // the wall: 7 wide, 3 high, with a crenellated course on top
  for (let row = 0; row < 3; row++) for (let i = 0; i < 7; i++) put((i - 3) * s + (row % 2 ? s / 2 : 0) - s / 4, BLOCK / 2 + row * sy, 0);
  for (let i = 0; i < 7; i += 2) put((i - 3) * s, BLOCK / 2 + 3 * sy, 0);
  // two towers, 2×2 and five high, either side
  for (const side of [-1, 1])
    for (let row = 0; row < 5; row++)
      for (const [a, b] of [
        [0, 0],
        [1, 0],
        [0, 1],
        [1, 1],
      ])
        put(side * 5 * s + (a - 0.5) * s, BLOCK / 2 + row * sy, (b - 0.5) * s);
  // and the tower tops
  for (const side of [-1, 1]) for (const a of [0, 1]) put(side * 5 * s + (a - 0.5) * s, BLOCK / 2 + 5 * sy, -0.5 * s);
  return out;
}

/** Everything fixed that a loose car can run into. */
export function staticShapes(park: Park, supports: Support[]): StaticShape[] {
  const out: StaticShape[] = [];
  const box = (center: THREE.Vector3, half: THREE.Vector3, quat: THREE.Quaternion, kind: string) => out.push({ type: "box", center, half, quat, kind });
  for (const sp of supports) {
    if (sp.kind === "pillar") out.push({ type: "cyl", center: new THREE.Vector3(sp.x, sp.top / 2, sp.z), r: 0.9, hh: sp.top / 2, kind: "support" });
    else {
      const mid = sp.from.clone().add(sp.to).multiplyScalar(0.5);
      const len = sp.from.distanceTo(sp.to);
      box(mid, new THREE.Vector3(0.6, 0.5, len / 2), qYaw(sp.yaw), "support");
    }
  }
  const f = newFrame();
  for (const p of park.props) shapesFor(p, park, f, box, out);
  return out;
}

function shapesFor(p: Prop, park: Park, f: TrackFrame, box: (c: THREE.Vector3, h: THREE.Vector3, q: THREE.Quaternion, kind: string) => void, out: StaticShape[]) {
  switch (p.kind) {
    case "launcher": {
      const tr = park.byId.get(p.track)!;
      tr.frameAt(0, f);
      const yaw = yawOf(f.t);
      const c = f.p.clone().addScaledVector(f.t, -LAUNCHER.len / 2 + 3).setY(LAUNCHER.h / 2);
      box(c, new THREE.Vector3(LAUNCHER.w / 2, LAUNCHER.h / 2, LAUNCHER.len / 2 - 3), qYaw(yaw), "launcher");
      break;
    }
    case "tower":
      out.push({ type: "cyl", center: new THREE.Vector3(p.x, p.h / 2, p.z), r: p.r, hh: p.h / 2, kind: "tower" });
      break;
    case "pad": {
      const a = new THREE.Vector3(...p.from);
      const b = new THREE.Vector3(...p.to);
      const c = a.clone().add(b).multiplyScalar(0.5).setY(p.from[1] - 0.6);
      const d = b.clone().sub(a);
      box(c, new THREE.Vector3(p.w / 2, 0.6, d.length() / 2), qYaw(Math.atan2(d.x, d.z)), "pad");
      break;
    }
    case "bin": {
      const q = qYaw(p.yaw);
      const at = (lx: number, ly: number, lz: number) => new THREE.Vector3(lx, ly, lz).applyQuaternion(q).add(new THREE.Vector3(p.x, 0, p.z));
      // an open-topped box, its mouth (low lip) facing the track
      box(at(0, 0.3, 0), new THREE.Vector3(14, 0.3, 14), q, "bin");
      box(at(0, 6, 14), new THREE.Vector3(14, 6, 0.4), q, "bin");
      box(at(-14, 6, 0), new THREE.Vector3(0.4, 6, 14), q, "bin");
      box(at(14, 6, 0), new THREE.Vector3(0.4, 6, 14), q, "bin");
      box(at(0, 1.4, -14), new THREE.Vector3(14, 1.4, 0.4), q, "bin");
      break;
    }
    case "tree":
      out.push({ type: "cyl", center: new THREE.Vector3(p.x, 14, p.z), r: 1.6, hh: 14, kind: "tree" });
      break;
    case "flag":
      out.push({ type: "cyl", center: new THREE.Vector3(p.x, p.h / 2, p.z), r: 0.5, hh: p.h / 2, kind: "flag" });
      break;
    case "sign":
      for (const side of [-1, 1]) out.push({ type: "cyl", center: new THREE.Vector3(p.x + side * (p.w / 2 - 4), 20, p.z), r: 1.4, hh: 20, kind: "sign" });
      box(new THREE.Vector3(p.x, 20 + p.h / 2 + 2, p.z), new THREE.Vector3(p.w / 2, p.h / 2, 1), qYaw(p.yaw), "sign");
      break;
    case "stand":
      box(new THREE.Vector3(p.x, 8, p.z), new THREE.Vector3(30, 8, 12), qYaw(p.yaw), "stand");
      break;
    case "rug":
      box(new THREE.Vector3(p.x, 0.25, p.z), new THREE.Vector3(p.w / 2, 0.25, p.d / 2), qYaw(0), "rug");
      break;
    // —— the Stunt Yard ——
    case "mat":
      // a thin printed mat: it counts as floor
      box(new THREE.Vector3(p.x, 0.155, p.z), new THREE.Vector3(p.w / 2, 0.155, p.d / 2), qYaw(0), "rug");
      break;
    case "slab":
      box(new THREE.Vector3(...p.center), new THREE.Vector3(...p.half), yardQuat(p.yaw, p.pitch), "slab");
      break;
    case "wedge":
      out.push({ type: "hull", pts: Float32Array.from(p.pts.flat()), kind: "wedge" });
      break;
    case "checkpoint":
      // the arch's two posts, just off the road either side
      for (const side of [-1, 1]) {
        const q = qYaw(p.yaw);
        const off = new THREE.Vector3(side * (p.w / 2 + 1), 0, 0).applyQuaternion(q);
        out.push({ type: "cyl", center: new THREE.Vector3(p.at[0] + off.x, p.h / 2, p.at[2] + off.z), r: 0.9, hh: p.h / 2, kind: "post" });
      }
      break;
    case "finish": {
      const tr = park.byId.get(p.track)!;
      tr.frameAt(p.s, f);
      const w = (p.width ?? 0) + 9;
      // the two uprights either side of the track
      for (const side of [-1, 1]) {
        const c = f.p.clone().addScaledVector(f.side, side * w * 0.5 + (p.width ? -(p.width - 8) / 2 : 0));
        out.push({ type: "cyl", center: c.clone().setY((c.y + 22) / 2), r: 0.8, hh: (c.y + 22) / 2, kind: "finish" });
      }
      break;
    }
    default:
      break;
  }
}
