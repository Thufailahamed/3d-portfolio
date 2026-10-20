/**
 * Where each test puts its bodies. A layout gives every body a nominal pose and velocity at the
 * moment of impact (yaw ψ about +y: a body points along (cos ψ, −sin ψ) in world x, z); the solver
 * then backs them off along their velocities and finds the true first contact on the undeformed
 * outlines, so first contact always lands at T0 = 0.
 *
 * Protocol geometry (cited in the method sheet): the offset tests strike the driver's side; the pole
 * meets the car at 75° to its axis, aligned with the driver's head; the side trolley's centre line is
 * 250 mm behind the driver's R-point (taken here as the H-point), perpendicular.
 */
import { carBody as lineUpBody, mdb, odb, pole, referenceSedan, wall } from "./bodies";

/** A car body by slug; "reference-sedan" is the calibration car (never offered on the page). */
const carBody = (slug: string, id: "a" | "b") => (slug === "reference-sedan" ? referenceSedan(id) : lineUpBody(slug, id));
import { testById } from "./tests";
import type { BodyDef, Scenario } from "./types";

export type BodyInit = {
  /** world position of the car-frame origin and yaw */
  x: number;
  z: number;
  yaw: number;
  /** world velocity (m/s) */
  vx: number;
  vz: number;
  /** tyres off until this time after T0 (carried on a sled / held by the tow) — null: tyres on from the start */
  carrier: number | null;
};

export type Layout = { bodies: BodyDef[]; init: BodyInit[] };

const kmh = (v: number) => v / 3.6;
const rad = (d: number) => (d * Math.PI) / 180;
const heading = (yaw: number) => [Math.cos(yaw), -Math.sin(yaw)] as const;

/** the half width of a car's structure (the plan rectangle without mirrors) */
const halfW = (b: BodyDef) => b.plan.hz - 0.06;
const noseX = (b: BodyDef) => b.plan.cx + b.plan.hx;
const tailX = (b: BodyDef) => b.plan.cx - b.plan.hx;

export function layout(s: Scenario): Layout {
  const def = testById[s.test];
  const A = carBody(s.a, "a");
  const va = kmh(s.va), vb = kmh(s.vb);
  const d = A.driverSide; // −1 left-hand drive (driver on −z), +1 right-hand drive
  const still = (b: BodyDef, x: number, z: number, yaw = 0): BodyInit => ({ x, z, yaw, vx: 0, vz: 0, carrier: null });
  // car A driven along +x, nose at x = 0 when it reaches the impact point
  const towed = (b: BodyDef, zOff = 0): BodyInit => ({ x: -noseX(b), z: zOff, yaw: 0, vx: va, vz: 0, carrier: 0 });

  if (def.group === "barrier") {
    switch (s.test) {
      case "wall": {
        const w = wall(0.02, 5);
        return { bodies: [A, w], init: [towed(A), still(w, 0, 0, Math.PI)] };
      }
      case "small": {
        // a rigid block 1.6 m wide with a 150 mm radius edge, overlapping the driver's side by `overlap` of the width
        const w = wall(0.15, 1.6);
        const W = 2 * halfW(A);
        const zc = d * (W / 2 - s.overlap * W + 0.8);
        return { bodies: [A, w], init: [towed(A), still(w, 0, zc, Math.PI)] };
      }
      case "odb": {
        const w = odb();
        const W = 2 * halfW(A);
        const zc = d * (W / 2 - s.overlap * W + 0.5);
        return { bodies: [A, w], init: [towed(A), still(w, 0, zc, Math.PI)] };
      }
      case "pole": {
        // the car slides sideways, driver's side first, its axis at `angle` to the direction of travel (+x)
        const p = pole();
        const yaw = d * rad(s.angle);
        const [fx, fz] = heading(yaw);
        const rx = Math.sin(yaw), rz = Math.cos(yaw);
        // put the driver's head on the line of travel through the pole (z = 0), the car just short of it
        const hx = A.hPoint[0], hz = A.hPoint[2];
        const ox = -1.2, oz = -(hx * fz + hz * rz);
        void fx;
        void rx;
        return { bodies: [A, p], init: [{ x: ox, z: oz, yaw, vx: va, vz: 0, carrier: 0.05 }, still(p, 0, 0)] };
      }
      case "mdb": {
        // A stands still facing +x; the trolley comes at its driver's side, perpendicular, 250 mm behind the H-point
        const t = mdb();
        const side = d; // the struck side's z sign
        const xImpact = (s.impactX ?? A.hPoint[0]) - 0.25;
        const yaw = side < 0 ? -Math.PI / 2 : Math.PI / 2; // facing +z (from the left) or −z (from the right)
        const zFace = side * (halfW(A) + 0.02);
        // the trolley's face (its local x = 0) sits at zFace; its centre line through xImpact
        return {
          bodies: [A, t],
          init: [still(A, 0, 0), { x: xImpact, z: zFace, yaw, vx: 0, vz: -side * vb, carrier: 0 }],
        };
      }
    }
  }

  const B = carBody(s.b ?? s.a, "b");
  switch (s.test) {
    case "headon":
    case "offset": {
      const Wa = 2 * halfW(A), Wb = 2 * halfW(B);
      const o = s.test === "headon" ? 1 : s.overlap;
      // driver's sides overlapping: A is shifted toward its passenger's side and B (facing −x, its
      // driver's side on world −d·z) the other way, so the two driver's sides meet
      const dz = s.test === "headon" ? 0 : d * ((Wa + Wb) / 2 - o * Math.min(Wa, Wb));
      return {
        bodies: [A, B],
        init: [
          { x: -noseX(A), z: -dz / 2, yaw: 0, vx: va, vz: 0, carrier: 0 },
          { x: noseX(B), z: dz / 2, yaw: Math.PI, vx: -vb, vz: 0, carrier: 0 },
        ],
      };
    }
    case "tbone": {
      // B along +x at the origin; A comes from B's driver's side, perpendicular, nose on B's H-point
      const side = B.driverSide;
      const xImpact = s.impactX ?? B.hPoint[0];
      const yaw = side < 0 ? -Math.PI / 2 : Math.PI / 2;
      const [fx, fz] = heading(yaw);
      const off = halfW(B) + noseX(A);
      return {
        bodies: [A, B],
        init: [
          { x: xImpact - fx * off, z: -fz * off, yaw, vx: fx * va, vz: fz * va, carrier: 0 },
          { x: 0, z: 0, yaw: 0, vx: vb, vz: 0, carrier: vb > 0 ? 0 : null },
        ],
      };
    }
    case "rear": {
      return {
        bodies: [A, B],
        init: [
          { x: -noseX(A), z: 0, yaw: 0, vx: va, vz: 0, carrier: 0 },
          { x: -tailX(B), z: 0, yaw: 0, vx: vb, vz: 0, carrier: vb > 0 ? 0 : null },
        ],
      };
    }
    case "oblique":
    default: {
      // B oncoming from A's driver's side front at `angle` off A's reversed path, both arriving at the origin
      const side = d;
      const a = rad(s.angle);
      const vdir = [-Math.cos(a), -side * Math.sin(a)]; // B's travel direction (world x, z)
      const yaw = Math.atan2(-vdir[1], vdir[0]);
      const [fx, fz] = heading(yaw);
      // at the nominal moment B's nose is inside A's front corner on the driver's side, so their paths surely meet
      const px = -0.4, pz = side * halfW(A) * 0.4;
      return {
        bodies: [A, B],
        init: [
          { x: -noseX(A), z: 0, yaw: 0, vx: va, vz: 0, carrier: 0 },
          { x: px - fx * noseX(B), z: pz - fz * noseX(B), yaw, vx: vdir[0] * vb, vz: vdir[1] * vb, carrier: 0 },
        ],
      };
    }
  }
}
