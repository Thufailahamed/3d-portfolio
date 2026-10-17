import * as THREE from "three";
import { FLOW_ORIGIN } from "@/lib/chapters";

/**
 * First-person walking world for the /flow pavilion. Everything is in pavilion-local
 * coordinates (the BuildingFlow group sits at FLOW_ORIGIN); raycasts add the origin back.
 *
 * Floors and walls are the real building meshes (raycast); columns, rope barriers,
 * benches and lamps are cheap analytic circles / boxes.
 */

/** Standing eye height, body radius and the tallest ledge you can walk up without jumping. */
export const EYE = 1.68;
export const BODY_R = 0.28;
// the model's first step stands 0.58 above the plaza, so allow a generous kerb
export const STEP_UP = 0.62;
export const WALK_SPEED = 2.7;
export const RUN_SPEED = 5.8;
export const CROUCH_EYE = 1.12;
export const CROUCH_SPEED = 1.3;

/** Showcase plinth centres (index = project index) and the radius of the rope ring around each. */
export const SHOWCASE_CENTERS = Array.from({ length: 6 }, (_, i) => ({
  x: i % 2 === 0 ? -4.4 : 4.4,
  z: -7 - Math.floor(i / 2) * 10,
}));
export const ROPE_R = 2.0;

/** Spawn points: on the plaza facing the portico, and just inside the portal facing the nave. */
export const SPAWN_PLAZA = { x: 0, z: 16, yaw: 0 };
export const SPAWN_HALL = { x: 0, z: -3, yaw: 0 };

/** Hall interior footprint (used for zones, surface sounds and the minimap). */
export const HALL = { x: 7.5, z0: -1, z1: -38 };
export const ROTUNDA = { x: 25.2, z: 1.2, r: 3.6 };

type Circle = { x: number; z: number; r: number };
type Box = { x0: number; x1: number; z0: number; z1: number };

export const walkWorld = {
  /** meshes you can stand on (raycast straight down) */
  walkables: [] as THREE.Object3D[],
  /** meshes that block you (raycast along the move direction) */
  walls: [] as THREE.Object3D[],
  circles: [] as Circle[],
  boxes: [] as Box[],
};

const [OX, OY, OZ] = FLOW_ORIGIN;
const ray = new THREE.Raycaster();
const o = new THREE.Vector3();
const d = new THREE.Vector3();
const n = new THREE.Vector3();
const DOWN = new THREE.Vector3(0, -1, 0);
const PROBE_HEIGHTS = [0.3, 1.15];

/** Height of the walkable surface under (x, z), searching down from `fromY`; null if nothing. */
export function floorAt(x: number, z: number, fromY: number): number | null {
  o.set(x + OX, fromY + OY, z + OZ);
  ray.set(o, DOWN);
  ray.near = 0;
  ray.far = 40;
  const hits = ray.intersectObjects(walkWorld.walkables, false);
  return hits.length ? hits[0].point.y - OY : null;
}

/** Nearest wall hit along the horizontal direction `d` from the body at (x, feet, z). */
function castWalls(x: number, feet: number, z: number, far: number) {
  let best: THREE.Intersection | null = null;
  for (const h of PROBE_HEIGHTS) {
    o.set(x + OX, feet + h + OY, z + OZ);
    ray.set(o, d);
    ray.near = 0;
    ray.far = far;
    const hit = ray.intersectObjects(walkWorld.walls, false)[0];
    if (hit && (!best || hit.distance < best.distance)) best = hit;
  }
  return best;
}

/** Horizontal wall normal of a hit, flipped to face the direction we came from. */
function wallNormal(hit: THREE.Intersection) {
  if (!hit.face) return null;
  n.copy(hit.face.normal).transformDirection(hit.object.matrixWorld);
  n.y = 0;
  if (n.lengthSq() < 1e-4) return null;
  n.normalize();
  if (n.x * d.x + n.z * d.z > 0) n.negate();
  return n;
}

/**
 * Move the body by (dx, dz), stopping BODY_R short of walls and sliding along them,
 * then push out of circles / boxes. Writes the result into `out`.
 */
export function moveBody(x: number, z: number, feet: number, dx: number, dz: number, out: { x: number; z: number }) {
  for (let iter = 0; iter < 3; iter++) {
    const len = Math.hypot(dx, dz);
    if (len < 1e-5) break;
    d.set(dx / len, 0, dz / len);
    const hit = castWalls(x, feet, z, len + BODY_R);
    if (!hit) {
      x += dx;
      z += dz;
      break;
    }
    const allowed = Math.max(0, hit.distance - BODY_R);
    x += d.x * allowed;
    z += d.z * allowed;
    let rx = dx - d.x * allowed;
    let rz = dz - d.z * allowed;
    const wn = wallNormal(hit);
    if (!wn) break;
    const into = rx * wn.x + rz * wn.z;
    if (into < 0) {
      rx -= wn.x * into;
      rz -= wn.z * into;
    }
    dx = rx;
    dz = rz;
  }

  // de-penetrate: anything closer than the body radius on the four axes pushes us back
  for (const [ax, az] of [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ]) {
    d.set(ax, 0, az);
    const hit = castWalls(x, feet, z, BODY_R);
    if (hit) {
      const push = BODY_R - hit.distance;
      x -= ax * push;
      z -= az * push;
    }
  }

  for (const c of walkWorld.circles) {
    const ex = x - c.x;
    const ez = z - c.z;
    const min = c.r + BODY_R;
    const dist2 = ex * ex + ez * ez;
    if (dist2 < min * min) {
      const dist = Math.sqrt(dist2) || 1e-4;
      x = c.x + (ex / dist) * min;
      z = c.z + (ez / dist) * min;
    }
  }
  for (const b of walkWorld.boxes) {
    const cx = Math.max(b.x0, Math.min(x, b.x1));
    const cz = Math.max(b.z0, Math.min(z, b.z1));
    const ex = x - cx;
    const ez = z - cz;
    const dist2 = ex * ex + ez * ez;
    if (dist2 < BODY_R * BODY_R) {
      if (dist2 < 1e-8) {
        // centre inside the box: leave by the nearest side
        const sides = [x - b.x0, b.x1 - x, z - b.z0, b.z1 - z];
        const m = Math.min(...sides);
        if (m === sides[0]) x = b.x0 - BODY_R;
        else if (m === sides[1]) x = b.x1 + BODY_R;
        else if (m === sides[2]) z = b.z0 - BODY_R;
        else z = b.z1 + BODY_R;
      } else {
        const dist = Math.sqrt(dist2);
        x = cx + (ex / dist) * BODY_R;
        z = cz + (ez / dist) * BODY_R;
      }
    }
  }

  // keep to the site
  out.x = Math.max(-95, Math.min(95, x));
  out.z = Math.max(-110, Math.min(80, z));
}

export const isIndoors = (x: number, z: number) => Math.abs(x) < HALL.x + 0.3 && z < HALL.z0 + 0.2 && z > HALL.z1 - 1;

const inBox = (x: number, z: number, cx: number, cz: number, hx: number, hz: number) => Math.abs(x - cx) < hx && Math.abs(z - cz) < hz;

/** What a footfall lands on outside: the paving and terrace, the lawn, or the reflecting pools
 * (the same layout the realistic ground shader paints). */
export function surfaceAt(x: number, z: number): "stone" | "grass" | "water" {
  if (inBox(Math.abs(x), z, 7.6, 16, 3.0, 5.0)) return "water";
  if (inBox(x, z, 0, 15.2, 16, 15.4) || inBox(x, z, 2, -19.6, 33.6, 24.2)) return "stone";
  return "grass";
}

/** Human-readable zone for the HUD. */
export function zoneAt(x: number, z: number): string {
  if (isIndoors(x, z)) {
    if (z > -3) return "NAVE · ENTRANCE";
    if (z > -12) return "NAVE · BAY I";
    if (z > -22) return "NAVE · BAY II";
    if (z > -32) return "NAVE · BAY III";
    return "APSE · ROSE WINDOW";
  }
  if (Math.hypot(x - ROTUNDA.x, z - ROTUNDA.z) < ROTUNDA.r + 1.2) return "ROTUNDA";
  if (z < 4 && z > -1.5 && Math.abs(x) <= 7.5) return "PORTICO";
  if (z < 4 && z > -1.5 && x < -7.5 && x > -27) return "WEST WING";
  if (z < 4 && z > -1.5 && x > 7.5 && x < 27) return "EAST WING";
  if (z >= 3.9 && z < 8.6 && Math.abs(x) < 13) return "GRAND STEPS";
  if (Math.abs(x) < 27 && z < 8.6 && z > -23.5) return "STYLOBATE";
  return "PLAZA";
}

/** localStorage key for the walker's preferences (sensitivity, invert Y, head bob, smoothing). */
export const WALK_SETTINGS_KEY = "flow-walk-settings";
