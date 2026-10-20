/**
 * The driver, as restraint engineers model one: a lumped two-mass occupant in the car's own frame —
 * the upper torso (chest) and the head — each free to move forward and sideways relative to the seat,
 * thrown by the seat's acceleration and held by springs: the belt across the chest (slack, then a
 * stiff webbing that pays out at its load limiter), a race harness, or nothing on the chest for a lap
 * belt; the neck between chest and head; the airbag (standing out from the wheel once it fires,
 * venting after); the wheel rim, the dash and the door (coming in with the side crush) as hard stops;
 * the seat back and head restraint behind. Unbelted, the pelvis slides off the seat too.
 *
 * Because each mass's acceleration is the sum of the real forces on it divided by its mass, the head
 * and chest accelerations are what accelerometers in a dummy would read. The dummy's angles for the
 * animation are worked out from the two displacements. All constants are generic (the method sheet
 * lists them), not measured on these cars.
 */
import type { Restraint } from "./types";

const G = 9.81;

export type OccupantInput = {
  dt: number;
  /** seat (H-point) acceleration in the car frame, forward and to the right (m/s²), from the start of the window */
  ax: Float64Array;
  az: Float64Array;
  /** inward travel of the door at the occupant's shoulder (m) */
  door: Float64Array;
  /** rearward travel of the steering wheel / dash ahead of the driver (m) */
  dash: Float64Array;
  restraint: Restraint;
  airbag: { fire: number; full: number; vented: number } | null;
  curtain: number | null;
  /** the wheel hub relative to the hip: forward and up (m) — sets the gaps to the wheel */
  wheel: [number, number];
  /** distance from the shoulder to the door trim (m), and which side the door is (−1 left, +1 right) */
  doorGap: number;
  doorSide: -1 | 1;
};

export type OccupantResult = {
  /** per sample: torso pitch, torso lean, head pitch (rel. torso), head lean (rel. torso), head forward excursion; angles relative to the seated pose */
  pose: Float64Array;
  headG: Float64Array;
  chestG: Float64Array;
  belt: Float64Array;
  contact: "wheel" | "dash" | "door" | "pillar" | "bag" | null;
  /** the head's position (forward, up of the hip) when it struck hardest, for a windscreen star */
  strike: [number, number] | null;
};

/** The model's constants (SI), quoted by the method sheet. */
export const OCCUPANT = {
  chestMass: 25,
  headMass: 4.5,
  pelvisMass: 33,
  /** seated geometry: hip to shoulder, head above the shoulders, chest belt point, recline (rad) */
  shoulder: 0.5,
  head: 0.17,
  chest: 0.47,
  recline: 0.38,
  neck: { k: 25e3, cubic: 4e6, c: 250 },
  belt: {
    "belt+airbag": { k: 70e3, slack: 0.025, limit: 4500, payout: 0.18, lat: 3e3 },
    belt: { k: 70e3, slack: 0.03, limit: 9000, payout: 0.03, lat: 3e3 },
    harness: { k: 180e3, slack: 0.01, limit: 25000, payout: 0, lat: 30e3 },
    lap: { k: 0, slack: 0, limit: 0, payout: 0, lat: 0 },
    none: { k: 0, slack: 0, limit: 0, payout: 0, lat: 0 },
  },
  /** airbag: depth when full (m), stiffness and force cap on the chest and the head */
  bag: { depth: 0.3, chest: { k: 15e3, cap: 5500 }, head: { k: 6e3, cap: 3000 } },
};

const O = OCCUPANT;

export function occupant(inp: OccupantInput): OccupantResult {
  const n = inp.ax.length, dt = inp.dt;
  const pose = new Float64Array(n * 5), headG = new Float64Array(n), chestG = new Float64Array(n), belt = new Float64Array(n);
  const bk = O.belt[inp.restraint];
  const slides = inp.restraint === "none";
  const mc = O.chestMass, mh = O.headMass, mp = O.pelvisMass;
  // gaps (m) from the seated chest and head to the wheel rim; the hub's distance sets them, within limits
  const hubX = inp.wheel[0];
  const gapChest = Math.max(0.3, Math.min(0.45, hubX - 0.22));
  const gapHead = Math.max(0.42, Math.min(0.62, hubX - 0.06));
  const highHub = inp.wheel[1] > 0.42; // a high wheel catches the face; a low one, the head goes over it to the dash/screen
  // state: chest (x forward, z right), head, pelvis (forward only, unbelted)
  let xc = 0, vxc = 0, zc = 0, vzc = 0, xh = 0, vxh = 0, zh = 0, vzh = 0, xp = 0, vxp = 0;
  let slack = bk.slack;
  let contact: OccupantResult["contact"] = null, worst = 0;
  let strike: [number, number] | null = null;
  const sinR = Math.sin(-O.recline);

  for (let i = 0; i < n; i++) {
    const t = i * dt;
    const ax = inp.ax[i], az = inp.az[i];
    const dash = inp.dash[i] * 0.8;
    const depth = bag(inp.airbag, t);
    const vent = inp.airbag && t > inp.airbag.full ? Math.max(0.5, 1 - (t - inp.airbag.full) / (inp.airbag.vented - inp.airbag.full) * 0.5) : 1;

    // ---- forward: chest
    let fcx = 0;
    // belt across the chest, with its load limiter paying out
    let fb = 0;
    if (bk.k > 0) {
      const s = xc - xp - slack;
      if (s > 0) {
        fb = bk.k * s + 400 * Math.max(0, vxc);
        if (fb > bk.limit && slack < bk.slack + bk.payout) {
          slack = Math.min(bk.slack + bk.payout, slack + (fb - bk.limit) / bk.k);
          fb = bk.limit;
        }
      }
      fcx -= fb;
    }
    // the seat back behind
    if (xc < 0) fcx -= 80e3 * xc + 1200 * vxc;
    // airbag, then the rim
    if (depth > 0) {
      const pen = xc - (gapChest - depth - dash);
      if (pen > 0) fcx -= Math.min(O.bag.chest.cap * vent, O.bag.chest.k * pen + 300 * Math.max(0, vxc));
    }
    const rim = xc - (gapChest - dash);
    if (rim > 0) fcx -= Math.min(slides ? 1e9 : 9000, 120e3 * rim + 1500 * Math.max(0, vxc));
    // the neck, from the head
    const dn = xh - xc;
    const fn = O.neck.k * dn + O.neck.cubic * dn * dn * dn + O.neck.c * (vxh - vxc);
    fcx += fn;

    // ---- forward: head
    let fhx = -fn;
    // a race harness is worn with a head-and-neck restraint: its tethers stop the head running ahead of the shoulders
    if (inp.restraint === "harness" && dn > 0.06) fhx -= 40e3 * (dn - 0.06) + 300 * Math.max(0, vxh - vxc);
    if (xh < -0.05) fhx -= 20e3 * (xh + 0.05) + 200 * vxh; // head restraint
    if (depth > 0) {
      const pen = xh - (gapHead - depth - dash);
      if (pen > 0) {
        fhx -= Math.min(O.bag.head.cap * vent, O.bag.head.k * pen + 120 * Math.max(0, vxh));
        if (!contact || contact === "door") contact = "bag";
      }
    }
    const hit = xh - (gapHead - dash);
    if (hit > 0) {
      const f = 150e3 * hit + 1200 * Math.max(0, vxh);
      fhx -= f;
      if (f > 2500) {
        contact = highHub ? "wheel" : "dash";
        if (f > worst) {
          worst = f;
          strike = [O.shoulder * Math.sin(0.6) + gapHead * 0.3, O.shoulder * Math.cos(0.6) + O.head];
        }
      }
    }

    // ---- pelvis: belted it is held; unbelted it slides until the knees meet the dash
    if (slides) {
      let fp = -(fcx < 0 ? 0 : 0);
      const fr = 0.3 * (mp + mc) * G;
      // the chest pulls the pelvis along with it through the spine
      const spine = 30e3 * (xc - xp) + 300 * (vxc - vxp);
      fp += spine;
      fcx -= spine;
      if (Math.abs(vxp) > 1e-3) fp -= Math.sign(vxp) * fr;
      const knee = xp - (0.17 - dash);
      if (knee > 0) fp -= 60e3 * knee + 1500 * Math.max(0, vxp);
      vxp += (fp / mp - ax) * dt;
      xp += vxp * dt;
      if (xp < 0 && vxp < 0) {
        xp = 0;
        vxp = 0;
      }
    }

    // ---- sideways: chest and head toward the door (doorSide) or away
    let fcz = -bk.lat * zc;
    if (Math.abs(zc) > 0.08) fcz -= Math.sign(zc) * (30e3 * (Math.abs(zc) - 0.08) + 300 * Math.abs(vzc)); // bolsters
    const toward = zc * inp.doorSide;
    const doorPen = toward - (inp.doorGap - inp.door[i]);
    if (doorPen > 0) {
      const f = 60e3 * doorPen + 800 * Math.max(0, vzc * inp.doorSide);
      fcz -= inp.doorSide * f;
      if (f > 2000 && contact !== "wheel") contact = "door";
    }
    const dz = zh - zc;
    const fnz = 10e3 * dz + O.neck.cubic * dz * dz * dz + O.neck.c * (vzh - vzc);
    fcz += fnz;
    let fhz = -fnz;
    const curtain = inp.curtain !== null && t > inp.curtain + 0.02;
    const pen = zh * inp.doorSide - (inp.doorGap + 0.06 - inp.door[i] - (curtain ? 0.07 : 0));
    if (pen > 0) {
      const f = Math.min(curtain ? 2500 : 1e9, (curtain ? 10e3 : 120e3) * pen);
      fhz -= inp.doorSide * f;
      if (!curtain && f > 3000) contact = "pillar";
    }

    // ---- integrate (relative to the seat: the seat's acceleration is the pseudo-force)
    vxc += (fcx / mc - ax) * dt;
    vxh += (fhx / mh - ax) * dt;
    vzc += (fcz / mc - az) * dt;
    vzh += (fhz / mh - az) * dt;
    xc += vxc * dt;
    xh += vxh * dt;
    zc += vzc * dt;
    zh += vzh * dt;

    // ---- what a dummy's accelerometers read: the real forces on each mass
    headG[i] = Math.hypot(fhx, fhz) / mh / G;
    chestG[i] = Math.hypot(fcx, fcz) / mc / G;
    belt[i] = fb;

    // ---- the dummy's pose from the displacements: the torso pitches about the hip to put its chest
    // point where the chest mass is; the head flexes on the neck by what is left over
    const th = Math.asin(Math.max(-1, Math.min(1, sinR + xc / O.chest))) + O.recline;
    const lean = Math.asin(Math.max(-0.9, Math.min(0.9, zc / O.chest)));
    const neck = Math.atan2(xh - xc * (O.shoulder / O.chest), O.head) ;
    const neckZ = Math.atan2(zh - zc * (O.shoulder / O.chest), O.head);
    pose[i * 5] = th;
    pose[i * 5 + 1] = lean;
    pose[i * 5 + 2] = Math.max(-0.9, Math.min(1.1, neck));
    pose[i * 5 + 3] = Math.max(-0.9, Math.min(0.9, neckZ));
    pose[i * 5 + 4] = xh;
  }
  return { pose, headG, chestG, belt, contact, strike };
}

/** How far the airbag cushion stands out from the wheel at time t (m): inflating, full, venting. */
export function bag(a: OccupantInput["airbag"], t: number) {
  if (!a || t < a.fire) return 0;
  const D = O.bag.depth;
  if (t < a.full) return D * ((t - a.fire) / (a.full - a.fire)) ** 0.7;
  if (t < a.vented) return D - 0.45 * D * ((t - a.full) / (a.vented - a.full));
  return 0.55 * D;
}
