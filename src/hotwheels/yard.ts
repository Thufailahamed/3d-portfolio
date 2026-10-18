import * as THREE from "three";

/**
 * The Stunt Yard: a kids' road play-mat on the floor in front of the park, where you drive a car
 * yourself. A rounded-rectangle road runs round it (the lap, with checkpoints), and the yard is
 * dressed with the things you'd find on a living-room floor: a plank kicker, a hardcover book
 * leant on a stack of books, a cardboard tunnel, a run of dominoes and a set of toy skittles.
 */

type V3 = [number, number, number];

export type YardProp =
  /** the play-mat itself */
  | { kind: "mat"; x: number; z: number; w: number; d: number }
  /** a solid wedge (a kicker ramp), given by its corner points */
  | { kind: "wedge"; pts: V3[]; color: string; label?: string }
  /** a fixed box, turned (yaw) and tipped (pitch): a book, a plank, a tunnel wall */
  | { kind: "slab"; center: V3; half: V3; yaw: number; pitch: number; look: "book" | "cardboard" | "plank"; color: string; label?: string }
  /** an arch over the road that counts the lap; 0 is the start/finish line */
  | { kind: "checkpoint"; i: number; at: V3; yaw: number; w: number; h: number }
  | { kind: "domino"; at: V3; yaw: number; color: string }
  | { kind: "pin"; at: V3 };

/** the mat's middle and size (cm), and the road's centre line round it */
export const YARD = { x: 0, z: 245, w: 540, d: 220, road: { x0: -205, x1: 205, z0: 180, z1: 310, r: 45, w: 34 } } as const;

/** sizes of the loose toys (cm): a domino stands tall and thin, a skittle is a fat little pin */
export const DOMINO = { t: 1.0, h: 5.2, w: 2.6 };
/** the mat's thickness: what the toys stand on */
export const MAT_T = 0.31;
export const PIN = { r: 1.35, h: 8.4 };

/** where your car is put down, and which way it faces (radians, as yaw: 0 = +z, π/2 = +x) */
export const SPAWN = { at: new THREE.Vector3(-70, 0, YARD.road.z1), yaw: Math.PI / 2 };

const qOf = (yaw: number, pitch = 0) => new THREE.Quaternion().setFromEuler(new THREE.Euler(pitch, yaw, 0, "YXZ"));
const place = (x: number, z: number, yaw: number, lx: number, ly: number, lz: number): V3 => {
  const v = new THREE.Vector3(lx, ly, lz).applyQuaternion(qOf(yaw));
  return [x + v.x, ly, z + v.z];
};

/** A kicker: a wedge `len` long rising to `h` at its far end, facing along `yaw`. */
function wedge(x: number, z: number, yaw: number, len: number, w: number, h: number): V3[] {
  const pts: V3[] = [];
  for (const sx of [-w / 2, w / 2]) {
    pts.push(place(x, z, yaw, sx, 0, -len / 2));
    pts.push(place(x, z, yaw, sx, 0, len / 2));
    pts.push(place(x, z, yaw, sx, h, len / 2));
  }
  return pts;
}

/** A point on the road's centre line, a fraction `u` (0..1) of the way round, and the way along it. */
export function roadAt(u: number) {
  const { x0, x1, z0, z1, r } = YARD.road;
  const sx = x1 - x0 - 2 * r;
  const sz = z1 - z0 - 2 * r;
  const arc = (Math.PI / 2) * r;
  const L = 2 * sx + 2 * sz + 4 * arc;
  let d = (((u % 1) + 1) % 1) * L;
  // start on the near straight heading +x, from its left end; then round anticlockwise seen from the camera
  const seg = (len: number) => (d <= len ? true : ((d -= len), false));
  const p = new THREE.Vector3();
  const t = new THREE.Vector3();
  // round a corner clockwise (seen from above) about (cx, cz), starting at angle a0
  const corner = (cx: number, cz: number, a0: number) => {
    const a = a0 - d / r;
    p.set(cx + Math.cos(a) * r, 0, cz + Math.sin(a) * r);
    t.set(Math.sin(a), 0, -Math.cos(a));
  };
  const line = (x: number, z: number, tx: number, tz: number) => {
    p.set(x, 0, z);
    t.set(tx, 0, tz);
  };
  if (seg(sx)) line(x0 + r + d, z1, 1, 0);
  else if (seg(arc)) corner(x1 - r, z1 - r, Math.PI / 2);
  else if (seg(sz)) line(x1, z1 - r - d, 0, -1);
  else if (seg(arc)) corner(x1 - r, z0 + r, 0);
  else if (seg(sx)) line(x1 - r - d, z0, -1, 0);
  else if (seg(arc)) corner(x0 + r, z0 + r, -Math.PI / 2);
  else if (seg(sz)) line(x0, z0 + r + d, 0, 1);
  else corner(x0 + r, z1 - r, -Math.PI);
  return { p, t, L };
}

/** Everything in the yard. */
export function yardProps(): YardProp[] {
  const out: YardProp[] = [];
  const { z0, z1, x0, x1 } = YARD.road;
  out.push({ kind: "mat", x: YARD.x, z: YARD.z, w: YARD.w, d: YARD.d });

  // the lap: start/finish on the near straight, then round the far end, down the back, and home
  const cps: [number, number, number][] = [
    [0, z1, Math.PI / 2],
    [x1, (z0 + z1) / 2, Math.PI],
    [70, z0, -Math.PI / 2],
    [-120, z0, -Math.PI / 2],
    [x0, (z0 + z1) / 2, 0],
  ];
  cps.forEach(([x, z, yaw], i) => out.push({ kind: "checkpoint", i, at: [x, 0, z], yaw, w: YARD.road.w + 10, h: 17 }));

  // a plank kicker on the home straight
  out.push({ kind: "wedge", pts: wedge(118, z1, Math.PI / 2, 24, 26, 9), color: "#c98a4b", label: "KICKER" });

  // the big jump on the back straight: a hardcover leant on a stack of three, then off the end of the stack
  const stackX = -40;
  const bookColors = ["#1f4e8c", "#b8322a", "#2f7d4f"];
  for (let i = 0; i < 3; i++)
    out.push({ kind: "slab", center: [stackX + (i - 1) * 0.8, 1.5 + i * 3, z0 + (i - 1) * 0.6], half: [13, 1.5, 11], yaw: 0, pitch: 0, look: "book", color: bookColors[i] });
  // the ramp book: its top surface runs from the mat (no lip to catch a wheel) up to the stack's top edge, heading -x
  const xLow = stackX + 13 + 25;
  const xHigh = stackX + 13;
  const rise = 9 - MAT_T;
  const run = xLow - xHigh;
  const ang = Math.atan2(rise, run);
  const bookLen = Math.hypot(rise, run);
  const T = 1.8;
  // the middle of the top surface, then down half the book's thickness along its normal (sin, cos)
  const mx = (xLow + xHigh) / 2 - Math.sin(ang) * (T / 2);
  const my = (MAT_T + 9) / 2 - Math.cos(ang) * (T / 2);
  out.push({ kind: "slab", center: [mx - 0.6 * Math.cos(ang), my + 0.6 * Math.sin(ang), z0], half: [10.5, T / 2, bookLen / 2 + 0.6], yaw: -Math.PI / 2, pitch: -ang, look: "book", color: "#e0b23a" });

  // a cardboard tunnel over the back straight
  const tx = 150;
  const tl = 44;
  const tw = YARD.road.w + 2;
  const th = 15;
  for (const sz of [-1, 1]) out.push({ kind: "slab", center: [tx, th / 2, z0 + sz * (tw / 2 + 0.8)], half: [tl / 2, th / 2, 0.8], yaw: 0, pitch: 0, look: "cardboard", color: "#b98b5a" });
  out.push({ kind: "slab", center: [tx, th + 0.8, z0], half: [tl / 2, 0.8, tw / 2 + 1.6], yaw: 0, pitch: 0, look: "cardboard", color: "#c4976a", label: "TUNNEL" });

  // inside the loop: a strike ramp aimed at the skittles
  const pinX = 92;
  const pinZ = 248;
  out.push({ kind: "wedge", pts: wedge(pinX - 62, pinZ, Math.PI / 2, 22, 20, 6.5), color: "#d6453a", label: "STRIKE" });
  const gap = 4.2;
  for (let row = 0; row < 4; row++)
    for (let k = 0; k <= row; k++) out.push({ kind: "pin", at: [pinX + row * gap * 0.87, PIN.h / 2 + MAT_T + 0.01, pinZ + (k - row / 2) * gap] });

  // a run of dominoes snaking through the left of the loop
  const rainbow = ["#e63946", "#f4a261", "#e9c46a", "#2a9d8f", "#457b9d", "#8d5fd3"];
  const curve = new THREE.CatmullRomCurve3([new THREE.Vector3(-160, 0, 280), new THREE.Vector3(-120, 0, 236), new THREE.Vector3(-80, 0, 270), new THREE.Vector3(-38, 0, 226), new THREE.Vector3(-10, 0, 250)]);
  const len = curve.getLength();
  const n = Math.floor(len / 3.3);
  for (let i = 0; i < n; i++) {
    const u = i / (n - 1);
    const p = curve.getPointAt(u);
    const t = curve.getTangentAt(u);
    out.push({ kind: "domino", at: [p.x, DOMINO.h / 2 + MAT_T + 0.01, p.z], yaw: Math.atan2(t.x, t.z), color: rainbow[i % rainbow.length] });
  }
  return out;
}

/** Points the yard's camera stop keeps in frame. */
export function yardPts() {
  const { x, z, w, d } = YARD;
  const pts: THREE.Vector3[] = [];
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) for (const y of [0, 14]) pts.push(new THREE.Vector3(x + (sx * w) / 2 - sx * 10, y, z + (sz * d) / 2 - sz * 6));
  return pts;
}

export { qOf as yardQuat };
