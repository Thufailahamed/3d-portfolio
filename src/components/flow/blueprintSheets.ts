/**
 * The pavilion's drawing set (plans, elevation, sections), drawn to scale from the same constants
 * as art/build_building.py. Units are metres. Each sheet is static SVG markup plus a `frame` that
 * maps a pavilion-local position (x, height, z — the /flow walker's frame) onto that sheet, so the
 * overlay can draw a live "you are here" marker on top.
 */

const TAU = Math.PI * 2;
const f = (n: number) => +n.toFixed(3);

// ---------------------------------------------------------------- model constants
const FLOOR = 0.88;
const COL_H = 6.6;
const COL_R = 0.4;
const PORTICO_W = 13;
const SP = PORTICO_W / 7;
const WING_SP = 1.6;
const WING_H = COL_H * 0.94;
const ROT_X = 8.2 + 8 * WING_SP + 4.2;
const ROT_Y = -1.2;
const ROT_R = 3.6;
const ENT_Z = FLOOR + COL_H;
const ENT_H = 1.35;
const PED_H = 2.9;
const PED_W = (PORTICO_W + 1.4) / 2;
const WING_ENT_Z = FLOOR + WING_H;
const DRUM_Z0 = FLOOR + WING_H;
const DRUM_Z1 = DRUM_Z0 + 0.8;
const DOME_R = ROT_R * 1.05;
const DRUM_R = ROT_R * 1.15;
const DOOR_W = 2.2;
const DOOR_H = 3.8;
const WALL_TOP = FLOOR + COL_H + ENT_H;
const HALL_W = 15;
const HALL_H = 9.4;
const SPRING = FLOOR + HALL_H * 0.65;
const RISE = HALL_H * 0.35;
const CROWN = SPRING + RISE;
const SIDE_TOP = FLOOR + HALL_H * 0.75;
const NICHE_YS = [7, 17, 27];
const NICHE_W = 4.2;
const NICHE_H = 6.2;
const NICHE_D = 0.55;
const PW = 1.7;
const PH = 1.15;
const VW = 1.45;
const VH = 1.35;
const APSE_Z = FLOOR + HALL_H * 0.52;
const APSE_R = 3.8;
const WINDOWS = [0, 1, 2, 3, 4].map((k) => 9.5 + k * 3.4);
/** Model Y (depth into the building) of each showcase, by project index. */
const SHOWCASE_Y = (i: number) => 7 + Math.floor(i / 2) * 10;
const SHOWCASE_SIDE = (i: number) => (i % 2 === 0 ? -1 : 1);

const portico = [...Array(8)].map((_, i) => -PORTICO_W / 2 + i * SP);
const westWing = [...Array(11)].map((_, i) => -8.2 - i * WING_SP);
const eastWing = [...Array(8)].map((_, i) => 8.2 + i * WING_SP);
const rotunda = [...Array(10)].map((_, i) => {
  const a = (i / 10) * TAU;
  return [ROT_X + Math.cos(a) * ROT_R, ROT_Y + Math.sin(a) * ROT_R] as const;
});

// ---------------------------------------------------------------- svg helpers
type Pt = readonly [number, number];
const c = (cls: string) => cls.split(" ").map((k) => `bp-${k}`).join(" ");
const rect = (x0: number, y0: number, x1: number, y1: number, cls: string) =>
  `<rect x="${f(Math.min(x0, x1))}" y="${f(Math.min(y0, y1))}" width="${f(Math.abs(x1 - x0))}" height="${f(Math.abs(y1 - y0))}" class="${c(cls)}"/>`;
const line = (x0: number, y0: number, x1: number, y1: number, cls: string) =>
  `<line x1="${f(x0)}" y1="${f(y0)}" x2="${f(x1)}" y2="${f(y1)}" class="${c(cls)}"/>`;
const circ = (cx: number, cy: number, r: number, cls: string) =>
  `<circle cx="${f(cx)}" cy="${f(cy)}" r="${f(r)}" class="${c(cls)}"/>`;
const poly = (pts: Pt[], cls: string) =>
  `<polygon points="${pts.map(([x, y]) => `${f(x)},${f(y)}`).join(" ")}" class="${c(cls)}"/>`;
const pline = (pts: Pt[], cls: string) =>
  `<polyline points="${pts.map(([x, y]) => `${f(x)},${f(y)}`).join(" ")}" class="${c(cls)}"/>`;
const text = (x: number, y: number, s: string, cls = "t", anchor = "middle") =>
  `<text x="${f(x)}" y="${f(y)}" class="${c(cls)}" text-anchor="${anchor}">${s}</text>`;

function dimH(x0: number, x1: number, y: number, label: string, fs: number, off = -0.35) {
  const t = fs * 0.5;
  return [
    line(x0, y, x1, y, "dim"),
    line(x0 - t * 0.5, y + t * 0.5, x0 + t * 0.5, y - t * 0.5, "dim"),
    line(x1 - t * 0.5, y + t * 0.5, x1 + t * 0.5, y - t * 0.5, "dim"),
    line(x0, y - t, x0, y + t, "dim"),
    line(x1, y - t, x1, y + t, "dim"),
    text((x0 + x1) / 2, y + off * fs * 2, label, "t dimt"),
  ].join("");
}

function dimV(x: number, y0: number, y1: number, label: string, fs: number, side = 1) {
  const t = fs * 0.5;
  const tx = x + side * fs * 0.6;
  const my = (y0 + y1) / 2;
  return [
    line(x, y0, x, y1, "dim"),
    line(x - t * 0.5, y0 + t * 0.5, x + t * 0.5, y0 - t * 0.5, "dim"),
    line(x - t * 0.5, y1 + t * 0.5, x + t * 0.5, y1 - t * 0.5, "dim"),
    line(x - t, y0, x + t, y0, "dim"),
    line(x - t, y1, x + t, y1, "dim"),
    `<text x="${f(tx)}" y="${f(my)}" class="${c("t dimt")}" text-anchor="middle" transform="rotate(-90 ${f(tx)} ${f(my)})">${label}</text>`,
  ].join("");
}

/** Level marker on an elevation or section (Y = −z). */
function level(x: number, z: number, label: string, fs: number, anchor: "start" | "end" = "start") {
  const Y = -z;
  const s = fs * 0.45;
  const dir = anchor === "start" ? 1 : -1;
  return [
    poly([[x, Y], [x - s, Y - s * 1.2], [x + s, Y - s * 1.2]], "lvl"),
    line(x - dir * s * 2, Y, x + dir * fs * 6.2, Y, "dim"),
    text(x + dir * s * 1.6, Y - fs * 0.35, label, "t lvlt", anchor),
  ].join("");
}

function scaleBar(x: number, y: number, fs: number, metres = 10) {
  const out: string[] = [];
  for (let i = 0; i < metres; i += 2) out.push(rect(x + i, y, x + i + 1, y + fs * 0.35, "sb"));
  out.push(rect(x, y, x + metres, y + fs * 0.35, "sbo"));
  out.push(
    text(x, y + fs * 1.4, "0", "t small"),
    text(x + metres / 2, y + fs * 1.4, String(metres / 2), "t small"),
    text(x + metres, y + fs * 1.4, `${metres} m`, "t small"),
  );
  return out.join("");
}

/** Column in elevation: plinth, base torus, tapered shaft, echinus and abacus. */
function colElev(x: number, z0: number, h: number, r: number, cls = "col") {
  const pw = r * 2.5;
  const ab = r * 0.82 * 2.8;
  const zt = z0 + h;
  return [
    rect(x - pw / 2, -z0, x + pw / 2, -(z0 + 0.22), cls),
    poly([[x - r, -(z0 + 0.4)], [x + r, -(z0 + 0.4)], [x + r * 0.82, -(zt - 0.45)], [x - r * 0.82, -(zt - 0.45)]], cls),
    rect(x - r * 1.05, -(z0 + 0.22), x + r * 1.05, -(z0 + 0.4), cls),
    poly([[x - r * 0.82, -(zt - 0.45)], [x + r * 0.82, -(zt - 0.45)], [x + ab / 2, -(zt - 0.18)], [x - ab / 2, -(zt - 0.18)]], cls),
    rect(x - ab / 2, -(zt - 0.18), x + ab / 2, -zt, cls),
  ].join("");
}

function arch(cx: number, base: number, w: number, rise: number, steps = 16): Pt[] {
  const pts: Pt[] = [];
  for (let i = 0; i <= steps; i++) {
    const a = Math.PI - (i / steps) * Math.PI;
    pts.push([cx + (Math.cos(a) * w) / 2, -(base + Math.sin(a) * rise)]);
  }
  return pts;
}

// ---------------------------------------------------------------- sheet type
export type SheetId = "site" | "gallery" | "elev" | "long" | "cross";

export type Sheet = {
  id: SheetId;
  code: string;
  title: string;
  view: string;
  caption: string;
  figures: [string, string][];
  viewBox: [number, number, number, number];
  /** drawing text size in metres; markers scale with it */
  unit: number;
  body: string;
  /**
   * Pavilion-local position (x, eye height, z) and horizontal facing (fx, fz) to sheet
   * coordinates and an on-sheet direction; null when the viewer isn't meaningful here.
   */
  frame: (x: number, h: number, z: number, fx: number, fz: number) => { X: number; Y: number; dx: number; dy: number } | null;
  /** clickable showcase targets in sheet coordinates (project index → centre) */
  picks: { i: number; X: number; Y: number; r: number }[];
};

const insideHall = (x: number, z: number) => Math.abs(x) < 8.7 && z < -0.7 && z > -38.5;

// ================================================================ A-101 site plan (X = x, Y = z)
function sitePlan(): string {
  const fs = 0.85;
  const o: string[] = [];
  // plaza plate: 90 m, 16 segments, centred 22 m in front of the portico
  for (let k = 0; k <= 16; k++) {
    const g = -45 + k * 5.625;
    if (g > -34 && g < 40) o.push(line(g, 4.5, g, 37, "grid"));
    const gz = 22 - 45 + k * 5.625;
    if (gz > 4.5 && gz < 37) o.push(line(-34, gz, 40, gz, "grid"));
  }
  // reflecting pools flanking the approach (added at runtime in BuildingFlow)
  for (const s of [-1, 1]) {
    o.push(rect(s * 4.2, 10.6, s * 11, 21.4, "pool"));
    o.push(rect(s * 4.6, 11.0, s * 10.6, 21.0, "poolin"));
  }
  o.push(text(-7.6, 16.3, "REFLECTING POOL", "t small mute"), text(7.6, 16.3, "REFLECTING POOL", "t small mute"));
  // stylobate and the eight steps
  o.push(rect(-27, 4.5, 27, -23.5, "slab"));
  for (let s = 7; s >= 0; s--) {
    const w = 22 + s * 0.6;
    const cy = -4.2 - s * 0.55;
    o.push(rect(-w / 2, -(cy - 0.275), w / 2, -(cy + 0.275), "step"));
  }
  // overhead: entablatures, rotunda drum
  o.push(rect(-PED_W, 4, PED_W, -0.6, "over"));
  o.push(rect(6.3, 2.4, 24.3, -1.0, "over"), rect(-24.3, 2.4, -6.3, -1.0, "over"));
  o.push(circ(ROT_X, -ROT_Y, DRUM_R, "over"));
  // facade wall with the portal, window recesses
  o.push(rect(-26, -0.7, -DOOR_W / 2, -1.3, "cut"), rect(DOOR_W / 2, -0.7, 26, -1.3, "cut"));
  for (const s of [-1, 1]) for (const wx of WINDOWS) o.push(rect(s * wx - 0.65, -0.5, s * wx + 0.65, -0.9, "lt"));
  o.push(line(-DOOR_W / 2, -0.48, DOOR_W / 2, -0.48, "glow"));
  // exhibition hall
  o.push(rect(-8.5, -1, 8.5, -39, "slab2"));
  for (const s of [-1, 1]) o.push(rect(s * 7.5, -1, s * 8.7, -37, "cut"));
  o.push(rect(-8.5, -37, 8.5, -38.5, "cut"));
  o.push(rect(-1.8, -1, 1.8, -37, "over"));
  o.push(line(-APSE_R, -36.95, APSE_R, -36.95, "glow"));
  for (const s of [-1, 1]) for (const ny of NICHE_YS) o.push(rect(s * 7.5, -(ny - NICHE_W / 2), s * (7.5 + NICHE_D), -(ny + NICHE_W / 2), "paper"));
  for (let i = 0; i < 6; i++) {
    const x = SHOWCASE_SIDE(i) * 4.4;
    const y = SHOWCASE_Y(i);
    o.push(rect(x - PW / 2, -(y - PW / 2), x + PW / 2, -(y + PW / 2), "plinth"));
    o.push(text(x, -y + fs * 0.33, String(i + 1).padStart(2, "0"), "t num"));
  }
  // columns
  const colP = (x: number, y: number, r: number) => o.push(circ(x, -y, r, "colp"));
  portico.forEach((x, i) => {
    colP(x, -3.5, COL_R);
    if (i === 0 || i === 7) [1, 2].forEach((d) => colP(x, -3.5 + d * 1.6, COL_R));
  });
  westWing.forEach((x) => colP(x, -1.2, COL_R * 0.9));
  eastWing.forEach((x) => colP(x, -1.2, COL_R * 0.9));
  rotunda.forEach(([x, y]) => colP(x, y, COL_R * 0.85));
  // entry axis
  o.push(line(0, 11, 0, -0.5, "glow"), circ(0, 11.2, 0.68, "glowfill"));
  o.push(text(1.0, 11.5, "ENTER", "t small acc", "start"));
  o.push(text(0, 6.9, "8 STEPS", "t small"));
  o.push(text(0, 2.6, "OCTASTYLE PORTICO", "t lbl"));
  o.push(text(-16.2, 3.1, "WEST WING · 11 COLUMNS", "t lbl"));
  o.push(text(13.8, 3.1, "EAST WING · 8", "t lbl"));
  o.push(text(ROT_X, -ROT_Y + 6.1, "ROTUNDA", "t lbl"));
  o.push(text(0, -22.2, "EXHIBITION HALL", "t lbl"));
  o.push(text(0, -21.0, "15 × 36 m", "t small"));
  o.push(text(-17, -12, "STYLOBATE 54 × 28 m", "t lbl"));
  o.push(text(-31, 35.4, "PLAZA", "t lbl", "start"));
  // dims
  o.push(dimH(-27, 27, -41.2, "54.00", fs, -0.6));
  o.push(dimV(-10.4, -1, -37, "36.00", fs, -1));
  // north arrow (the minimap's N is −Z) + scale
  o.push(circ(35.5, -36, 1.6, "lt"), poly([[35.5, -38.2], [34.7, -35.4], [35.5, -36], [36.3, -35.4]], "axh"));
  o.push(text(35.5, -38.9, "N", "t lbl"));
  o.push(scaleBar(24, 34.2, fs));
  return o.join("");
}

// ================================================================ A-102 gallery plan (X = model y = −z, Y = x)
function galleryPlan(): string {
  const fs = 0.5;
  const o: string[] = [];
  const R = (x0: number, y0: number, x1: number, y1: number, cls: string) => rect(y0, x0, y1, x1, cls);
  o.push(R(-8.7, 1, 8.7, 39, "slab2"));
  for (const s of [-1, 1]) o.push(R(s * 7.5, 1, s * 8.7, 37, "cut"));
  o.push(R(-8.5, 37, 8.5, 38.5, "cut"));
  o.push(R(-8.7, 0.7, -1.1, 1.3, "cut"), R(1.1, 0.7, 8.7, 1.3, "cut"));
  for (const s of [-1, 1])
    for (const ny of NICHE_YS) {
      o.push(R(s * 7.5, ny - NICHE_W / 2, s * (7.5 + NICHE_D), ny + NICHE_W / 2, "paper"));
      for (const po of [-NICHE_W / 2 - 0.16, NICHE_W / 2 + 0.16]) o.push(R(s * 7.5, ny + po - 0.16, s * (7.5 - 0.18), ny + po + 0.16, "pil"));
    }
  for (let k = 0; k < 8; k++) {
    const ry = 2 + k * 5;
    o.push(R(-7.5, ry - 0.22, 7.5, ry + 0.22, "over"));
  }
  o.push(R(-1.8, 1, 1.8, 37, "over"));
  for (const rx of [-2.4, 2.4]) o.push(line(1, rx, 38, rx, "brass"));
  for (const by of [3, 12, 22, 32]) o.push(line(by, -7.25, by, 7.25, "brass"));
  [0, 1, 2].forEach((i) => {
    const r = HALL_W * 0.45 - i * 0.6;
    o.push(R(-r, 36.95 - 1.8 + i * 0.4, r, 37, "stepP"));
  });
  o.push(line(36.95, -APSE_R, 36.95, APSE_R, "glowW"));
  // camera tour 01 → 06, zig-zagging across the aisle
  const stations: Pt[] = [[3, 0], [4.4, -0.95], [4.4, 0.95], [14.4, -0.95], [14.4, 0.95], [24.4, -0.95], [24.4, 0.95], [33.5, 0]];
  o.push(pline(stations, "route"));
  for (let i = 0; i < 6; i++) {
    const side = SHOWCASE_SIDE(i);
    const y = SHOWCASE_Y(i);
    const x = side * 4.4;
    o.push(circ(y, x, 2.0, "rope"));
    o.push(R(x - PW / 2, y - PW / 2, x + PW / 2, y + PW / 2, "plinth"));
    o.push(R(x - VW / 2, y - VW / 2, x + VW / 2, y + VW / 2, "vitP"));
    const kx = x - side * (PW / 2 + 0.38);
    o.push(R(kx - 0.25, y - 0.85, kx + 0.25, y - 0.25, "kiosk"));
    o.push(text(y, x + 0.18, String(i + 1).padStart(2, "0"), "t num"));
    const cy = y - 2.6;
    const cx = side * 0.95;
    const L = Math.hypot(3.45, 2.6);
    o.push(line(cy, cx, cy + (2.6 / L) * 1.3, cx + ((side * 3.45) / L) * 1.3, "glowS"));
    o.push(circ(cy, cx, 0.2, "glowfill"));
  }
  o.push(text(1.6, -2.95, "PORTAL", "t small", "start"));
  o.push(text(37.9, 0.18, "APSE", "t small", "end"));
  o.push(text(12, -9.6, "WEST WALL", "t small mute"));
  o.push(text(12, 9.9, "EAST WALL", "t small mute"));
  o.push(dimH(1, 37, 11.0, "36.00", fs, -0.6));
  [17, 27].forEach((y) => o.push(dimH(y - 10, y, -11.2, "10.00 bay", fs, -0.5)));
  o.push(dimV(-0.4, -7.5, 7.5, "15.00", fs, -1));
  o.push(scaleBar(28, -11.4, fs));
  return o.join("");
}

// ================================================================ A-201 front elevation (X = x, Y = −height)
function frontElevation(): string {
  const fs = 0.75;
  const o: string[] = [];
  o.push(line(-40, 0.42, 40, 0.42, "grd"));
  o.push(rect(-26, -FLOOR, 26, -WALL_TOP, "wall"));
  for (const s of [-1, 1]) for (const wx of WINDOWS) o.push(rect(s * wx - 0.65, -2.4, s * wx + 0.65, -6.2, "recess"));
  o.push(rect(-DOOR_W / 2, -FLOOR, DOOR_W / 2, -(FLOOR + DOOR_H), "door"));
  o.push(rect(-0.425, -FLOOR, 0.425, -(FLOOR + 0.72), "fig"), rect(-0.13, -FLOOR, 0.13, -(FLOOR + 1.65), "fig"), circ(0, -(FLOOR + 1.82), 0.14, "fig"));
  o.push(rect(6.3, -WING_ENT_Z, 24.3, -(WING_ENT_Z + 1.15), "ent"), rect(-24.3, -WING_ENT_Z, -6.3, -(WING_ENT_Z + 1.15), "ent"));
  const rc = rotunda.map(([x, y]) => ({ x, back: y > ROT_Y + 0.01 }));
  rc.filter((r) => r.back).forEach((r) => o.push(colElev(r.x, FLOOR, WING_H, COL_R * 0.85, "colb")));
  o.push(poly(arch(ROT_X, DRUM_Z1, DOME_R * 2, DOME_R, 32), "ent"));
  o.push(rect(ROT_X - DRUM_R, -DRUM_Z0, ROT_X + DRUM_R, -DRUM_Z1, "ent"));
  rc.filter((r) => !r.back).forEach((r) => o.push(colElev(r.x, FLOOR, WING_H, COL_R * 0.85)));
  [...westWing, ...eastWing].forEach((x) => o.push(colElev(x, FLOOR, WING_H, COL_R * 0.9)));
  o.push(rect(-PED_W, -ENT_Z, PED_W, -(ENT_Z + ENT_H), "ent"));
  for (let d = 0; d < 34; d++) {
    const dx = -(PORTICO_W + 1) / 2 + d * ((PORTICO_W + 1) / 33);
    o.push(rect(dx - 0.11, -(ENT_Z + ENT_H - 0.2), dx + 0.11, -(ENT_Z + ENT_H - 0.06), "dent"));
  }
  o.push(text(0, -(ENT_Z + 0.52), "VIRTUALLY EVER AFTER", "t frieze"));
  const pz = ENT_Z + ENT_H;
  o.push(poly([[-PED_W, -pz], [PED_W, -pz], [0, -(pz + PED_H)]], "ent"));
  o.push(poly([[-PED_W + 0.42, -(pz + 0.21)], [PED_W - 0.42, -(pz + 0.21)], [0, -(pz + PED_H - 0.42)]], "tym"));
  portico.forEach((x) => o.push(colElev(x, FLOOR, COL_H, COL_R)));
  o.push(rect(-27, 0, 27, 0.4, "slabE"));
  for (let s = 7; s >= 0; s--) {
    const w = 22 + s * 0.6;
    const z0 = (7 - s) * 0.16;
    o.push(rect(-w / 2, -z0, w / 2, -(z0 + 0.16), "stepE"));
  }
  o.push(text(0, -(pz + PED_H + 1.4), "THE STUDIO", "t float"));
  o.push(text(ROT_X, -(FLOOR + WING_H + 5.2), "ROTUNDA", "t float"));
  o.push(level(30.6, 0, "±0.00 stylobate", fs), level(30.6, FLOOR, "+0.88 floor", fs));
  o.push(level(30.6, WING_ENT_Z, "+7.08 wing entablature", fs), level(30.6, DRUM_Z1 + DOME_R, "+11.66 dome", fs));
  o.push(level(-28, ENT_Z, "+7.48 entablature", fs, "end"), level(-28, WALL_TOP, "+8.83 cornice", fs, "end"));
  o.push(level(-28, pz + PED_H, "+11.73 pediment", fs, "end"));
  o.push(dimH(-6.5, 6.5, 2.0, "8 columns · 13.00", fs, 0.85));
  o.push(dimH(-DOOR_W / 2, DOOR_W / 2, -(FLOOR + DOOR_H + 0.45), "2.20", fs * 0.8, -0.5));
  o.push(scaleBar(-37, 3.4, fs));
  return o.join("");
}

// ================================================================ A-301 long section at x = 0, looking east (X = −z, Y = −height)
function longSection(): string {
  const fs = 0.75;
  const o: string[] = [];
  o.push(line(-14, 0.42, 41, 0.42, "grd"));
  o.push(rect(1, -FLOOR, 37, -SPRING, "wall"));
  for (const ny of NICHE_YS) {
    const pts: Pt[] = [[ny - NICHE_W / 2, -FLOOR], ...arch(ny, FLOOR + NICHE_H * 0.75, NICHE_W, NICHE_H * 0.25), [ny + NICHE_W / 2, -FLOOR]];
    o.push(poly(pts, "recess"));
    for (const po of [-NICHE_W / 2 - 0.16, NICHE_W / 2 + 0.16]) o.push(rect(ny + po - 0.16, -FLOOR, ny + po + 0.16, -(FLOOR + NICHE_H), "pil"));
  }
  o.push(rect(1, -SPRING, 37, -CROWN, "wall2"));
  o.push(line(1, -SPRING, 37, -SPRING, "lt"));
  o.push(rect(1, -CROWN + 0.19, 37, -(CROWN + 0.25), "cut"));
  o.push(rect(1, -(FLOOR + HALL_H * 0.98 - 0.08), 37, -(FLOOR + HALL_H * 0.98 + 0.08), "glass"));
  for (let k = 0; k < 8; k++) {
    const ry = 2 + k * 5;
    o.push(rect(ry - 0.22, -SPRING, ry + 0.22, -(SPRING + RISE * 0.95), "rib"));
  }
  o.push(rect(37, -FLOOR, 38.5, -(FLOOR + HALL_H), "cut"));
  o.push(rect(1, -FLOOR, 39, -(FLOOR - 0.25), "cut"));
  o.push(rect(0.7, -(FLOOR + DOOR_H), 1.3, -WALL_TOP, "cut"));
  o.push(line(1, -FLOOR, 1, -(FLOOR + DOOR_H), "glowS"));
  [0, 1, 2].forEach((i) => {
    const y0 = 36.95 - 1.8 + i * 0.4;
    const z0 = FLOOR + i * 0.16;
    o.push(rect(y0, -(z0 - 0.08), 37, -(z0 + 0.08), "stepE"));
  });
  o.push(rect(36.85, -(APSE_Z - APSE_R), 37.0, -(APSE_Z + APSE_R), "glowfill"));
  for (const y of NICHE_YS) {
    o.push(rect(y - PW / 2, -FLOOR, y + PW / 2, -(FLOOR + PH), "plinthE"));
    o.push(rect(y - VW / 2, -(FLOOR + PH), y + VW / 2, -(FLOOR + PH + VH), "vit"));
    const k = (y - 7) / 10;
    o.push(text(y, -(FLOOR + PH + VH + 0.5), `${String(k * 2 + 1).padStart(2, "0")} · ${String(k * 2 + 2).padStart(2, "0")}`, "t small"));
  }
  o.push(rect(-4.0, -ENT_Z, 0.6, -(ENT_Z + ENT_H), "cut"));
  o.push(rect(-4.0, -(ENT_Z + ENT_H), 0.6, -(ENT_Z + ENT_H + PED_H), "cut"));
  [-3.5, -1.9, -0.3].forEach((y, i) => o.push(colElev(y, FLOOR, COL_H, COL_R, i ? "colb" : "col")));
  o.push(rect(-4.5, 0, 23.5, 0.4, "cut"));
  for (let s = 0; s < 8; s++) {
    const cy = -4.2 - s * 0.55;
    const z0 = (7 - s) * 0.16;
    o.push(rect(cy - 0.275, -z0, cy + 0.275, -(z0 + 0.16), "cut"));
  }
  o.push(text(19, -(CROWN + 0.8), "BARREL VAULT · 8 BRASS RIBS · LINEAR SKYLIGHT", "t lbl"));
  o.push(text(-1.7, -(ENT_Z + ENT_H + PED_H + 0.55), "PORTICO", "t lbl"));
  o.push(text(36.3, -APSE_Z, "ROSE WINDOW", "t small acc", "end"));
  o.push(text(-8.8, -1.25, "PLAZA", "t lbl"));
  o.push(level(39.3, FLOOR, "+0.88", fs), level(39.3, SIDE_TOP, "+7.93 wall", fs), level(39.3, SPRING, "+6.99 spring", fs));
  o.push(level(39.3, CROWN, "+10.28 crown", fs));
  o.push(dimH(1, 37, 1.9, "36.00 nave", fs, 0.85));
  o.push(dimH(2, 7, -(CROWN + 2.1), "5.00", fs * 0.8, -0.4));
  o.push(scaleBar(-13, 2.4, fs));
  return o.join("");
}

// ================================================================ A-302 cross section at bay 2 (X = x, Y = −height)
function crossSection(): string {
  const fs = 0.42;
  const o: string[] = [];
  o.push(line(-10.5, -FLOOR + 0.25, 10.5, -FLOOR + 0.25, "grd"));
  o.push(rect(-7.5, -FLOOR, 7.5, -SPRING, "wall"));
  o.push(poly([[-7.5, -SPRING], ...arch(0, SPRING, 15, RISE, 40), [7.5, -SPRING]], "wall"));
  o.push(circ(0, -APSE_Z, APSE_R, "rose"), circ(0, -APSE_Z, APSE_R * 0.62, "rose"));
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI;
    o.push(line(-Math.cos(a) * APSE_R, -APSE_Z + Math.sin(a) * APSE_R, Math.cos(a) * APSE_R, -APSE_Z - Math.sin(a) * APSE_R, "roseL"));
  }
  [0, 1, 2].forEach((i) => {
    const r = HALL_W * 0.45 - i * 0.6;
    const z0 = FLOOR + i * 0.16;
    o.push(rect(-r, -z0, r, -(z0 + 0.16), "stepE"));
  });
  for (const s of [-1, 1]) {
    const inner = s * 7.5;
    const outer = s * 8.7;
    const nb = s * (7.5 + NICHE_D);
    const nicheTop = FLOOR + NICHE_H;
    o.push(poly([[inner, -FLOOR], [outer, -FLOOR], [outer, -SIDE_TOP], [inner, -SIDE_TOP], [inner, -nicheTop], [nb, -nicheTop], [nb, -FLOOR]], "cut"));
    o.push(rect(inner, -FLOOR, nb, -nicheTop, "paper"));
    // vault shell from the springing to the skylight opening (segments 0–7 of 20)
    const inn: Pt[] = [];
    const out: Pt[] = [];
    for (let i = 0; i <= 8; i++) {
      const a = (i / 20) * Math.PI;
      inn.push([s * Math.cos(a) * 7.5, -(SPRING + Math.sin(a) * RISE)]);
      out.push([s * Math.cos(a) * 7.85, -(SPRING + Math.sin(a) * (RISE + 0.35))]);
    }
    o.push(poly([...inn, ...out.reverse()], "cut"));
  }
  o.push(rect(-1.8, -(FLOOR + HALL_H * 0.98 - 0.08), 1.8, -(FLOOR + HALL_H * 0.98 + 0.08), "glass"));
  o.push(rect(-8.7, -FLOOR, 8.7, -(FLOOR - 0.25), "cut"));
  for (const rx of [-2.4, 2.4]) o.push(rect(rx - 0.06, -FLOOR, rx + 0.06, -(FLOOR + 0.06), "glowfill"));
  for (const s of [-1, 1]) {
    const x = s * 4.4;
    o.push(rect(x - PW / 2, -FLOOR, x + PW / 2, -(FLOOR + PH), "plinthE"));
    o.push(rect(x - VW / 2, -(FLOOR + PH), x + VW / 2, -(FLOOR + PH + VH), "vit"));
    const kx = x - s * (PW / 2 + 0.38);
    o.push(rect(kx - 0.035, -FLOOR, kx + 0.035, -(FLOOR + 0.82), "ln2"));
    o.push(poly([[kx - 0.25, -(FLOOR + 0.82)], [kx + 0.25, -(FLOOR + 0.98)], [kx + 0.25, -(FLOOR + 1.04)], [kx - 0.25, -(FLOOR + 0.88)]], "ln2"));
    o.push(text(x, -(FLOOR + PH + VH + 0.35), s < 0 ? "03" : "04", "t small"));
  }
  o.push(dimH(-7.5, 7.5, 0.95, "15.00 clear", fs, 0.85));
  o.push(dimH(-2.4, 2.4, 0.0, "aisle 4.80", fs, 0.85));
  o.push(level(9.2, SPRING, "+6.99", fs), level(9.2, CROWN, "+10.28", fs), level(9.2, SIDE_TOP, "+7.93", fs), level(9.2, FLOOR, "+0.88", fs));
  o.push(text(0, -(CROWN + 0.55), "skylight 3.60", "t small acc"));
  o.push(`<text x="-7.12" y="${f(-(FLOOR + NICHE_H / 2))}" class="${c("t small")}" text-anchor="middle" transform="rotate(-90 -7.12 ${f(-(FLOOR + NICHE_H / 2))})">niche 4.2 × 6.2</text>`);
  return o.join("");
}

// ================================================================ sheets
const fwd = (dx: number, dy: number) => {
  const l = Math.hypot(dx, dy) || 1;
  return { dx: dx / l, dy: dy / l };
};

export const SHEETS: Sheet[] = [
  {
    id: "site",
    code: "A-101",
    title: "Site plan",
    view: "Podium level · north up",
    caption:
      "One axis runs from the ENTER disc on the plaza, through the portal, to the rose window. Eleven columns line the west wing; the east wing is shorter and ends in a ten-column rotunda.",
    figures: [["Stylobate", "54 × 28 m"], ["Portico", "8 columns"], ["Wings", "11 + 8 columns"], ["Rotunda", "r 3.6 m"]],
    viewBox: [-34, -43.5, 74, 81],
    unit: 0.85,
    body: sitePlan(),
    frame: (x, _h, z, fx, fz) => ({ X: x, Y: z, ...fwd(fx, fz) }),
    picks: [...Array(6)].map((_, i) => ({ i, X: SHOWCASE_SIDE(i) * 4.4, Y: -SHOWCASE_Y(i), r: 1.6 })),
  },
  {
    id: "gallery",
    code: "A-102",
    title: "Gallery plan",
    view: "Portal left · apse right",
    caption:
      "Six showcases on 10 m bays. Odd numbers stand on the west wall and even numbers on the east, so the guided tour crosses the aisle at every stop. Each camera looks diagonally into its vitrine.",
    figures: [["Nave", "15 × 36 m"], ["Bays", "3 × 10 m"], ["Aisle", "4.8 m"], ["Rope ring", "r 2.0 m"]],
    viewBox: [-1.6, -12.6, 41.4, 24.4],
    unit: 0.5,
    body: galleryPlan(),
    frame: (x, _h, z, fx, fz) => (insideHall(x, z) || (z < 2 && z > -40 && Math.abs(x) < 12) ? { X: -z, Y: x, ...fwd(-fz, fx) } : null),
    picks: [...Array(6)].map((_, i) => ({ i, X: SHOWCASE_Y(i), Y: SHOWCASE_SIDE(i) * 4.4, r: 2.0 })),
  },
  {
    id: "elev",
    code: "A-201",
    title: "Front elevation",
    view: "Looking north from the plaza",
    caption:
      "The portico's pediment peaks at +11.73 m. The wing columns are 6% shorter, and the rotunda dome rises to +11.66 m, so the short east wing still balances the long west one.",
    figures: [["Pediment", "+11.73 m"], ["Dome", "+11.66 m"], ["Columns", "6.60 m"], ["Portal", "2.2 × 3.8 m"]],
    viewBox: [-40, -14.6, 80, 19.8],
    unit: 0.75,
    body: frontElevation(),
    frame: (x, h, z) => (z > -1 && Math.abs(x) < 40 ? { X: x, Y: -h, dx: 0, dy: 0 } : null),
    picks: [],
  },
  {
    id: "long",
    code: "A-301",
    title: "Long section",
    view: "Cut on the entry axis · looking east",
    caption:
      "Up eight steps to +0.88, through the 2.2 m portal, then 36 m down a nave under an elliptical barrel vault with eight brass ribs, to the rose window on the end wall.",
    figures: [["Nave", "36.0 m"], ["Vault crown", "+10.28 m"], ["Rib spacing", "5.0 m"], ["Eye height", "+2.38 m"]],
    viewBox: [-14, -13.6, 60, 17.6],
    unit: 0.75,
    body: longSection(),
    frame: (x, h, z, _fx, fz) => (Math.abs(x) < 9 && z < 14 && z > -40 ? { X: -z, Y: -h, ...fwd(-fz, 0) } : null),
    picks: [],
  },
  {
    id: "cross",
    code: "A-302",
    title: "Cross section",
    view: "Bay 2 · looking toward the apse",
    caption:
      "A 15 m nave between 1.2 m walls, with a 0.55 m niche behind each showcase. The vault springs at +6.99 m and crests at +10.28 m around a 3.6 m linear skylight.",
    figures: [["Clear width", "15.0 m"], ["Walls", "1.2 m"], ["Skylight", "3.6 m"], ["Rose window", "r 3.8 m"]],
    viewBox: [-10.6, -11.6, 23.6, 13.1],
    unit: 0.42,
    body: crossSection(),
    frame: (x, h, z) => (insideHall(x, z) ? { X: x, Y: -h, dx: 0, dy: 0 } : null),
    picks: [],
  },
];

/** Where the guided camera stands for a showcase, and the yaw that faces its vitrine. */
export function showcaseStation(i: number) {
  const side = SHOWCASE_SIDE(i);
  const k = Math.floor(i / 2);
  const x = side * 0.95;
  const z = -(4.4 + k * 10);
  const dx = side * 4.4 - x;
  const dz = -(7 + k * 10) - z;
  return { x, z, yaw: Math.atan2(-dx, -dz) };
}
