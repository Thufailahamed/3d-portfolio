import { about, person, projects } from "@/content/site";
import { FONT_ROWS, glyph, textWidth } from "./font";
import { BRICK, C, PLATE, TINT } from "./units";

/** What gets printed on a piece's face (drawn to a canvas at runtime). */
export type Art =
  | { kind: "label"; text: string; sub?: string; ink: string; bg: string; size?: number; align?: "left" | "center" }
  | { kind: "image"; src: string; bg: string }
  | { kind: "road" };

export type Pick = { kind: "project"; index: number } | { kind: "email" } | { kind: "link"; href: string; label: string };

export type Piece = {
  id: number;
  /** studs along x, studs along z, plates tall */
  w: number;
  d: number;
  h: number;
  /** centre, in world units */
  x: number;
  y: number;
  z: number;
  color: string;
  studs: boolean;
  round?: boolean;
  print?: { face: "top" | "front"; art: Art };
  pick?: Pick;
  /** the camera stop it belongs to (-1: scenery) */
  zone: number;
  /** pieces in one cluster may be pinned together when nothing else holds them */
  cluster: number;
  /** a minifig (style picks its outfit) or a car that drives the road (drive: studs per second, signed) */
  special?: "minifig" | "car";
  style?: number;
  drive?: number;
  /** window glass (lit panes glow at night) and lamp heads */
  glass?: "lit" | "dark";
  glow?: boolean;
};

/** A clutch between two pieces (b = -1 is the baseplate). */
export type Joint = [a: number, b: number];

export type Stop = {
  id: string;
  label: string;
  /** where the camera looks, and how much of the scene must fit in frame (world units) */
  target: [number, number, number];
  frame: [w: number, h: number];
  yaw: number;
  pitch: number;
  /** slide the subject in frame (fractions of the frame) so the text panel has room */
  shift: [number, number];
};

export type Baseplate = { x: number; z: number; w: number; d: number; color: string; studs: boolean; road?: boolean };

export type Layout = { pieces: Piece[]; joints: Joint[]; stops: Stop[]; plates: Baseplate[]; bounds: { x0: number; x1: number; z0: number; z1: number } };

/** Real brick lengths, longest first. */
const LENGTHS = [8, 6, 4, 3, 2, 1];

type Span = [a: number, b: number];

/**
 * Split a course run [a, b) into real brick lengths. Dynamic programming over the run: every brick
 * should rest on something in the course below (or it hangs), seams should not line up with the
 * seams below (a running bond), and fewer, longer bricks are better — the way a builder would do it.
 */
export function splitRun(a: number, b: number, below: Span[] | "ground", maxLen = 6): Span[] {
  const n = b - a;
  const seams = new Set<number>();
  if (below !== "ground") for (const [s, e] of below) seams.add(s).add(e);
  const rests = (s: number, e: number) => below === "ground" || below.some(([bs, be]) => Math.min(e, be) - Math.max(s, bs) > 0);
  const cost = new Array<number>(n + 1).fill(Infinity);
  const pick = new Array<number>(n + 1).fill(0);
  cost[n] = 0;
  for (let i = n - 1; i >= 0; i--) {
    for (const len of LENGTHS) {
      if (len > maxLen || i + len > n) continue;
      const s = a + i;
      const e = s + len;
      let c = 1 + cost[i + len];
      if (!rests(s, e)) c += 40;
      if (len === 1) c += 0.6;
      // a seam directly over a seam below weakens the wall (and looks wrong)
      if (e < b && seams.has(e) && below !== "ground") c += 2.5;
      if (c < cost[i]) {
        cost[i] = c;
        pick[i] = len;
      }
    }
  }
  const out: Span[] = [];
  for (let i = 0; i < n; i += pick[i]) out.push([a + i, a + i + pick[i]]);
  return out;
}

/** Contiguous filled runs in one glyph row. */
const runs = (row: string, x0: number): Span[] => {
  const out: Span[] = [];
  let s = -1;
  for (let i = 0; i <= row.length; i++) {
    const on = row[i] === "#";
    if (on && s < 0) s = i;
    if (!on && s >= 0) {
      out.push([x0 + s, x0 + i]);
      s = -1;
    }
  }
  return out;
};

class Builder {
  pieces: Piece[] = [];
  extraJoints: Joint[] = [];
  private nextCluster = 0;

  cluster() {
    return this.nextCluster++;
  }

  /** Place a piece by its grid corner: (gx, gz) in studs, `course` in plates above the baseplate. */
  put(gx: number, gz: number, course: number, w: number, d: number, h: number, color: string, zone: number, cluster: number, extra: Partial<Piece> = {}) {
    const p: Piece = {
      id: this.pieces.length,
      w,
      d,
      h,
      x: gx + w / 2,
      y: course * PLATE + (h * PLATE) / 2,
      z: gz + d / 2,
      color,
      studs: true,
      zone,
      cluster,
      ...extra,
    };
    this.pieces.push(p);
    return p;
  }

  /** A run of courses along x, `depth` studs deep: a wall laid in running bond. */
  wall(gx: number, gz: number, course: number, len: number, depth: number, courses: number, color: string | ((row: number) => string), zone: number, cluster: number, h = 3) {
    let below: Span[] | "ground" = course === 0 ? "ground" : [[gx, gx + len]];
    for (let r = 0; r < courses; r++) {
      const spans = splitRun(gx, gx + len, below, 8);
      for (const [s, e] of spans) this.put(s, gz, course + r * h, e - s, depth, h, typeof color === "string" ? color : color(r), zone, cluster);
      below = spans;
    }
  }

  /**
   * A word of upright brick letters, standing `depth` studs deep with its bottom course at `course`.
   * Returns the top course's spans so something can be built on it.
   */
  word(text: string, cx: number, gz: number, course: number, color: string | ((i: number) => string), zone: number, depth = 2) {
    let x = Math.round(cx - textWidth(text) / 2);
    const chars = [...text];
    // one cluster per word, so a stray piece (an apostrophe) can be pinned to its neighbour
    const cluster = this.cluster();
    chars.forEach((ch, i) => {
      const g = glyph(ch);
      let below: Span[] | "ground" = "ground";
      // bottom course first, so each course can be laid over the one beneath it
      for (let r = FONT_ROWS - 1; r >= 0; r--) {
        const level = FONT_ROWS - 1 - r;
        const spans = runs(g[r], x).flatMap(([s, e]) => splitRun(s, e, below, 6));
        for (const [s, e] of spans) this.put(s, gz, course + level * 3, e - s, depth, 3, typeof color === "string" ? color : color(i), zone, cluster);
        below = spans.length ? spans : below;
      }
      x += g[0].length + 1;
    });
  }
}

/** Two footprints overlap with real area (studs actually engage). */
const overlap = (a: Piece, b: Piece) =>
  Math.min(a.x + a.w / 2, b.x + b.w / 2) - Math.max(a.x - a.w / 2, b.x - b.w / 2) > 0.01 &&
  Math.min(a.z + a.d / 2, b.z + b.d / 2) - Math.max(a.z - a.d / 2, b.z - b.d / 2) > 0.01;

const top = (p: Piece) => p.y + (p.h * PLATE) / 2;
const bottom = (p: Piece) => p.y - (p.h * PLATE) / 2;

/** Gap between two boxes (0 when touching or overlapping). */
const gapBetween = (a: Piece, b: Piece) => {
  const dx = Math.max(0, Math.abs(a.x - b.x) - (a.w + b.w) / 2);
  const dy = Math.max(0, Math.abs(a.y - b.y) - ((a.h + b.h) * PLATE) / 2);
  const dz = Math.max(0, Math.abs(a.z - b.z) - (a.d + b.d) / 2);
  return Math.hypot(dx, dy, dz);
};

/**
 * Clutch joints, found the way bricks really connect: a piece resting on another with overlapping
 * footprints is clipped onto it, and a piece on the baseplate is clipped to the baseplate. Anything
 * left loose (an overhang no brick reaches) gets a hidden pin to its nearest neighbour in the same
 * build, so nothing floats.
 */
export function clutch(pieces: Piece[], extra: Joint[] = []): Joint[] {
  const joints: Joint[] = [...extra];
  const byBottom = new Map<number, Piece[]>();
  const key = (y: number) => Math.round(y * 100);
  // cars roll on the road; they're never clipped to anything
  const built = pieces.filter((p) => p.special !== "car");
  for (const p of built) {
    const k = key(bottom(p));
    if (!byBottom.has(k)) byBottom.set(k, []);
    byBottom.get(k)!.push(p);
  }
  for (const p of built) {
    if (bottom(p) < 1e-3) joints.push([p.id, -1]);
    for (const q of byBottom.get(key(top(p))) ?? []) if (overlap(p, q)) joints.push([p.id, q.id]);
  }

  // union-find over the joints, with the baseplate as node n
  const n = pieces.length;
  const parent = Array.from({ length: n + 1 }, (_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  const join = (a: number, b: number) => (parent[find(a)] = find(b));
  for (const [a, b] of joints) join(a, b < 0 ? n : b);

  const byCluster = new Map<number, Piece[]>();
  for (const p of built) {
    if (!byCluster.has(p.cluster)) byCluster.set(p.cluster, []);
    byCluster.get(p.cluster)!.push(p);
  }
  for (const list of byCluster.values()) {
    for (let guard = 0; guard < list.length; guard++) {
      const loose = list.filter((p) => find(p.id) !== find(n));
      if (!loose.length) break;
      // pin the loose piece that sits closest to something anchored
      let best: [Piece, Piece, number] | null = null;
      for (const p of loose)
        for (const q of list) {
          if (find(q.id) !== find(n)) continue;
          const g = gapBetween(p, q) * 10 + Math.hypot(p.x - q.x, p.y - q.y, p.z - q.z) * 0.01;
          if (!best || g < best[2]) best = [p, q, g];
        }
      if (!best) break;
      joints.push([best[0].id, best[1].id]);
      join(best[0].id, best[1].id);
    }
  }
  return joints;
}

/** A little tree: a round brown trunk under stepped green foliage. */
function tree(b: Builder, gx: number, gz: number, tall: number) {
  const k = b.cluster();
  for (let r = 0; r < tall; r++) b.put(gx + 2, gz + 2, r * 3, 2, 2, 3, C.reddishBrown, -1, k, { round: true });
  const c0 = tall * 3;
  b.put(gx, gz, c0, 6, 6, 3, C.green, -1, k);
  b.put(gx + 1, gz + 1, c0 + 3, 4, 4, 3, C.brightGreen, -1, k);
  b.put(gx + 1, gz + 1, c0 + 6, 4, 4, 3, C.green, -1, k);
  b.put(gx + 2, gz + 2, c0 + 9, 2, 2, 3, C.brightGreen, -1, k);
}

const GLASS = "#33495a";

/**
 * A city block in the background: a hollow shell of walls in running bond, a band course at every
 * floor, rows of windows between pillars (some lit after dark), a plate roof and a little plant on it.
 */
function building(b: Builder, gx: number, gz: number, w: number, d: number, floors: number, main: string, band: string, rand: () => number) {
  const k = b.cluster();
  const fz = gz + d - 1;
  let front: Span[] | "ground" = "ground";
  const sides: (Span[] | "ground")[] = ["ground", "ground"];
  const courses = floors * 3 + 1;
  const lit = new Map<string, boolean>();
  for (let c = 0; c < courses; c++) {
    const course = c * 3;
    const solid = c % 3 === 0;
    const floor = Math.floor(c / 3);
    if (solid) {
      const spans = splitRun(gx, gx + w, front, 8);
      for (const [s, e] of spans) b.put(s, fz, course, e - s, 1, 3, band, -1, k);
      front = spans;
    } else {
      const spans: Span[] = [];
      for (let x = gx; x < gx + w; ) {
        if ((x - gx) % 3 === 0) {
          b.put(x, fz, course, 1, 1, 3, main, -1, k);
          spans.push([x, x + 1]);
          x += 1;
        } else {
          const key = `${x}:${floor}`;
          if (!lit.has(key)) lit.set(key, rand() < 0.5);
          b.put(x, fz, course, 2, 1, 3, GLASS, -1, k, { glass: lit.get(key) ? "lit" : "dark" });
          spans.push([x, x + 2]);
          x += 2;
        }
      }
      front = spans;
    }
    [gx, gx + w - 1].forEach((sx, i) => {
      const spans = splitRun(gz, fz, sides[i], 6);
      for (const [s, e] of spans) b.put(sx, s, course, 1, e - s, 3, solid ? band : main, -1, k);
      sides[i] = spans;
    });
  }
  // the roof, and a little plant room and aerial on it
  const roof = courses * 3;
  for (const [s, e] of splitRun(gx, gx + w, "ground", 8)) b.put(s, gz, roof, e - s, d, 1, C.darkBluishGray, -1, k);
  const ax = gx + 1 + Math.floor(rand() * (w - 3));
  b.put(ax, gz + 1, roof + 1, 2, 2, 3, C.lightBluishGray, -1, k);
  if (rand() < 0.6) for (let r = 0; r < 3; r++) b.put(gx + w - 2, gz + d - 2, roof + 1 + r * 3, 1, 1, 3, C.black, -1, k, { round: true });
}

/** A street lamp: a round grey post with a glowing head. */
function lamp(b: Builder, gx: number, gz: number) {
  const k = b.cluster();
  for (let r = 0; r < 5; r++) b.put(gx, gz, r * 3, 1, 1, 3, C.darkBluishGray, -1, k, { round: true });
  b.put(gx, gz, 15, 1, 1, 3, "#f6f1dd", -1, k, { round: true, glow: true });
}

/** A seeded random, so the scenery is the same on every visit. */
function rng(seed: number) {
  return () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };
}

// —— where everything stands (studs) ——
const HERO_X = 0;
const PROJECTS_X = 76;
const BOARD_X0 = 112;
const BOARD_W = 14;
const BOARD_STEP = 22;
const ABOUT_X = 259;
const TOWERS_X = 281;
const CONTACT_X = 344;
/** the front face of the letters sits at z = -2, facing the camera (+z) */
const ROW_Z = -4;

export function buildLayout(): Layout {
  const b = new Builder();

  // ——— 00 hero: the name, two words stacked on a white shelf ———
  b.word("AHAMED", HERO_X, ROW_Z, 0, C.yellow, 0);
  const shelfW = Math.max(textWidth("THUFAIL"), textWidth("AHAMED")) + 4;
  const shelfX = Math.round(HERO_X - shelfW / 2);
  {
    const k = b.cluster();
    const tops = b.pieces.filter((p) => p.zone === 0 && Math.abs(top(p) - 7 * BRICK) < 1e-3).map((p) => [p.x - p.w / 2, p.x + p.w / 2] as Span);
    for (const [s, e] of splitRun(shelfX, shelfX + shelfW, tops, 8)) b.put(s, ROW_Z, 21, e - s, 2, 1, C.white, 0, k);
  }
  b.word("THUFAIL", HERO_X, ROW_Z, 22, C.red, 0);
  // the man himself, waving from the grass
  b.put(-29, -3, 0, 2, 1, 12, C.black, 0, b.cluster(), { special: "minifig", studs: false, style: 0 });
  // a site builder in a hard hat between the name and the work, and two more along the way
  b.put(104, -2, 0, 2, 1, 12, C.orange, 1, b.cluster(), { special: "minifig", studs: false, style: 1 });
  b.put(306, -3, 0, 2, 1, 12, C.white, 8, b.cluster(), { special: "minifig", studs: false, style: 2 });
  b.put(376, 0, 0, 2, 1, 12, C.red, 9, b.cluster(), { special: "minifig", studs: false, style: 3 });

  // ——— 01 projects: the heading, then a billboard per project ———
  b.word("PROJECTS", PROJECTS_X, ROW_Z, 0, C.blue, 1);
  projects.forEach((p, i) => {
    const zone = 2 + i;
    const x0 = BOARD_X0 + i * BOARD_STEP;
    const z0 = -5;
    const tint = TINT[p.slug] ?? C.red;
    const k = b.cluster();
    // plinth: two courses, white, three studs deep
    b.wall(x0, z0, 0, BOARD_W, 2, 2, C.white, zone, k);
    b.wall(x0, z0 + 2, 0, BOARD_W, 1, 1, C.white, zone, k);
    b.put(x0, z0 + 2, 3, 2, 1, 3, C.white, zone, k);
    b.put(x0 + 2, z0 + 2, 3, 10, 1, 3, C.white, zone, k, {
      print: { face: "front", art: { kind: "label", text: p.title.toUpperCase(), sub: `${String(i + 1).padStart(2, "0")} · ${p.year}`, ink: C.black, bg: C.white } },
      pick: { kind: "project", index: i },
    });
    b.put(x0 + 12, z0 + 2, 3, 2, 1, 3, C.white, zone, k);
    // two pillars in the project's colour
    for (let r = 0; r < 5; r++) {
      b.put(x0, z0, 6 + r * 3, 2, 2, 3, tint, zone, k);
      b.put(x0 + 12, z0, 6 + r * 3, 2, 2, 3, tint, zone, k);
    }
    // the poster: a 1 × 10 × 5 panel with the cover printed on its face
    b.put(x0 + 2, z0 + 1, 6, 10, 1, 15, C.white, zone, k, {
      print: { face: "front", art: { kind: "image", src: p.cover, bg: C.white } },
      pick: { kind: "project", index: i },
    });
    // the lintel
    for (const [s, e] of splitRun(x0, x0 + BOARD_W, [[x0, x0 + 2], [x0 + 2, x0 + 12], [x0 + 12, x0 + 14]], 6)) b.put(s, z0, 21, e - s, 2, 3, tint, zone, k);
  });

  // ——— 08 about: the word, and four services stacked like a bar chart ———
  b.word("ABOUT", ABOUT_X, ROW_Z, 0, C.darkTurquoise, 8);
  const towerColors = [C.red, C.blue, C.yellow, C.lime];
  about.services.forEach((s, i) => {
    const k = b.cluster();
    const gx = TOWERS_X + i * 6;
    const label = s.replace(/ (engineering|solutions)$/i, "").toUpperCase();
    b.put(gx, ROW_Z, 0, 4, 2, 3, C.white, 8, k, { print: { face: "front", art: { kind: "label", text: label, ink: C.black, bg: C.white, size: 0.42 } } });
    for (let r = 1; r < 3 + i; r++) b.put(gx, ROW_Z, r * 3, 4, 2, 3, towerColors[i], 8, k);
  });

  // ——— 09 contact: the call, then the email on a stand ———
  b.word("LET'S BUILD", CONTACT_X, ROW_Z, 0, (i) => (i < 5 ? C.white : C.lime), 9);
  {
    const k = b.cluster();
    const gx = CONTACT_X + 36;
    b.wall(gx, -4, 0, 18, 2, 2, C.black, 9, k);
    b.put(gx + 1, -2, 0, 16, 1, 3, C.black, 9, k, {
      print: { face: "front", art: { kind: "label", text: person.email, ink: C.lime, bg: C.black, size: 0.5 } },
      pick: { kind: "email" },
    });
    b.put(gx, -2, 0, 1, 1, 3, C.black, 9, k);
    b.put(gx + 17, -2, 0, 1, 1, 3, C.black, 9, k);
    person.socials.forEach((s, i) => {
      b.put(gx + 1 + i * 8, -4, 6, 8, 2, 3, C.white, 9, k, {
        print: { face: "front", art: { kind: "label", text: `${s.label.toUpperCase()} ↗`, ink: C.black, bg: C.white, size: 0.5 } },
        pick: { kind: "link", href: s.href, label: s.label },
      });
    });
  }

  // ——— scenery ———
  const trees: [number, number, number][] = [
    [-44, -16, 3], [-34, -24, 2], [26, -18, 3], [36, -28, 2], [100, -20, 2], [240, -18, 3],
    [302, -24, 2], [312, -15, 3], [404, -18, 3], [414, -27, 2], [168, -24, 2], [60, -26, 3],
  ];
  for (const [x, z, t] of trees) tree(b, x, z, t);
  const rand = rng(7);
  const flowers = [C.red, C.yellow, C.white, C.magenta, C.orange];
  for (const [x, z] of trees)
    for (let i = 0; i < 5; i++) {
      const fx = x + Math.floor(rand() * 10) - 2;
      const fz = z + 7 + Math.floor(rand() * 3);
      if (fz >= -8) continue;
      b.put(fx, fz, 0, 1, 1, 1, flowers[Math.floor(rand() * flowers.length)], -1, b.cluster(), { round: true });
    }

  // the city behind
  const city = rng(31);
  const mains = [C.tan, C.white, C.lightBluishGray, C.sandGreen, C.darkTan, C.nougat, C.mediumBlue, C.reddishBrown];
  const bands = [C.darkBluishGray, C.white, C.reddishBrown, C.darkBlue, C.darkTan, C.black];
  for (let x = -46; x < 418; ) {
    const w = [7, 10, 13][Math.floor(city() * 3)];
    const d = 5 + Math.floor(city() * 3);
    if (x + w > 428) break;
    // keep the skyline from crowding the name: an open square behind it
    if (x + w > -34 && x < 34) {
      x = 34;
      continue;
    }
    const floors = 2 + Math.floor(city() * 3);
    building(b, x, -66 - Math.floor(city() * 2), w, d, floors, mains[Math.floor(city() * mains.length)], bands[Math.floor(city() * bands.length)], city);
    x += w + 8 + Math.floor(city() * 12);
  }

  // street lamps along the kerb, in the gaps between the chapters
  for (const x of [-40, 30, 106, 238, 310, 412]) lamp(b, x, 6);

  // traffic: two lanes, one each way
  // (the model: 0 sports, 1 hatchback, 2 police, 3 taxi, 4 van, 5 pickup — see car.ts)
  const cars: [number, number, string, number][] = [
    [-30, 1, C.red, 0], [70, 1, C.blue, 2], [190, 1, C.white, 4], [300, 1, C.yellow, 3],
    [20, -1, C.lime, 0], [140, -1, C.orange, 5], [260, -1, C.darkTurquoise, 1], [380, -1, C.black, 5],
  ];
  for (const [x, dir, color, style] of cars) b.put(x, dir > 0 ? 10 : 18, 0, 8, 4, 10, color, -1, b.cluster(), { special: "car", studs: false, style, drive: dir * (8 + (Math.abs(x) % 5)) });

  const pieces = b.pieces;
  const joints = clutch(pieces, b.extraJoints);

  const boardStops: Stop[] = projects.map((p, i) => ({
    id: p.slug,
    label: p.title,
    target: [BOARD_X0 + i * BOARD_STEP + BOARD_W / 2, 5.2, -3],
    frame: [32, 18],
    yaw: -0.18,
    pitch: 0.26,
    shift: [-0.2, -0.02],
  }));
  const stops: Stop[] = [
    { id: "hero", label: "Home", target: [HERO_X - 1, 8.2, -3], frame: [70, 30], yaw: 0.06, pitch: 0.3, shift: [-0.1, -0.05] },
    { id: "projects", label: "Projects", target: [PROJECTS_X + 10, 4.2, -3], frame: [80, 30], yaw: -0.12, pitch: 0.34, shift: [-0.1, -0.1] },
    ...boardStops,
    { id: "about", label: "About", target: [ABOUT_X + 20, 4.2, -3], frame: [80, 30], yaw: 0.1, pitch: 0.34, shift: [-0.14, -0.1] },
    { id: "contact", label: "Contact", target: [CONTACT_X + 14, 4.2, -3], frame: [88, 32], yaw: -0.06, pitch: 0.34, shift: [-0.14, -0.1] },
  ];

  // ——— baseplates: grass behind, a plaza per chapter, a road in front ———
  const x0 = -48;
  const x1 = 432;
  const plaza = (cx: number) => (cx < 48 ? C.green : cx < 240 ? C.lightBluishGray : cx < 304 ? C.tan : C.darkBluishGray);
  const plates: Baseplate[] = [];
  for (let x = x0; x < x1; x += 32) {
    // the city's own block at the back: smooth pavement under the buildings, a street in front of them
    plates.push({ x, z: -72, w: 32, d: 16, color: C.lightBluishGray, studs: false });
    plates.push({ x, z: -56, w: 32, d: 16, color: C.darkBluishGray, studs: false, road: true });
    plates.push({ x, z: -40, w: 32, d: 32, color: C.green, studs: true });
    plates.push({ x, z: -8, w: 32, d: 16, color: plaza(x + 16), studs: true });
    plates.push({ x, z: 8, w: 32, d: 16, color: C.darkBluishGray, studs: false, road: true });
  }

  return { pieces, joints, stops, plates, bounds: { x0, x1, z0: -72, z1: 24 } };
}
