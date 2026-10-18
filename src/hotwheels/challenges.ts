import type { AttractionId } from "./park";

/**
 * Challenges: goals across the park, each checked against the facts the game reports as things
 * happen (a finish, a trick, a crash...). What's done is kept between visits.
 */
export type Fact =
  | { k: "finish"; a: AttractionId; time: number; model: number; night: boolean }
  | { k: "air"; t: number }
  | { k: "ring" }
  | { k: "blocks"; n: number }
  | { k: "drag"; win: boolean; reaction: number | null }
  | { k: "streak"; n: number }
  | { k: "crash" }
  | { k: "g"; g: number }
  | { k: "rail" }
  | { k: "trick"; flips: number; rolls: number; spins: number; clean: boolean; air: number }
  | { k: "dominoes"; n: number; of: number }
  | { k: "pins"; n: number; of: number }
  | { k: "lap"; time: number }
  | { k: "score"; n: number };

export type Progress = { done: Record<string, number>; loopCars: number[] };

export type Challenge = {
  id: string;
  ride: AttractionId | "park";
  title: string;
  desc: string;
  test: (f: Fact, p: Progress) => boolean;
  /** for a goal you build up to: how far along (0..1) */
  progress?: (p: Progress) => number;
};

export const CHALLENGES: Challenge[] = [
  { id: "loop-clear", ride: "loop", title: "Loop the loop", desc: "Finish the Mega Loop.", test: (f) => f.k === "finish" && f.a === "loop" },
  {
    id: "loop-garage",
    ride: "loop",
    title: "Full garage",
    desc: "Finish the Mega Loop with all six cars (each has its own green band).",
    test: (f, p) => f.k === "finish" && f.a === "loop" && new Set([...p.loopCars, f.model]).size >= 6,
    progress: (p) => new Set(p.loopCars).size / 6,
  },
  { id: "loop-g", ride: "loop", title: "Feel the squeeze", desc: "Pull 10 g through the bottom of a loop.", test: (f) => f.k === "g" && f.g >= 10 },
  { id: "loop-rail", ride: "loop", title: "Too hot to handle", desc: "Launch so hard you fly off the banked hairpin.", test: (f) => f.k === "rail" },
  { id: "jump-ring", ride: "jump", title: "Ring of fire", desc: "Jump through the burning ring.", test: (f) => f.k === "ring" },
  { id: "jump-castle", ride: "jump", title: "Siege engine", desc: "Bring down 20 blocks of the castle.", test: (f) => f.k === "blocks" && f.n >= 20 },
  { id: "jump-air", ride: "jump", title: "Hang time", desc: "Fly for 0.3 s between two pieces of track.", test: (f) => f.k === "air" && f.t >= 0.3 },
  { id: "drag-win", ride: "drag", title: "Quarter-mile king", desc: "Beat the rival on the drag strip.", test: (f) => f.k === "drag" && f.win },
  { id: "drag-react", ride: "drag", title: "Lightning reflexes", desc: "Win a drag race with a reaction under 0.20 s.", test: (f) => f.k === "drag" && f.win && f.reaction !== null && f.reaction < 0.2 },
  { id: "cyc-finish", ride: "cyclone", title: "Down the Cyclone", desc: "Ride the Cyclone Tower all the way to the line.", test: (f) => f.k === "finish" && f.a === "cyclone" },
  { id: "cyc-fast", ride: "cyclone", title: "Cyclone sprint", desc: "Finish the Cyclone in under 4.2 s (a sleek, heavy car helps).", test: (f) => f.k === "finish" && f.a === "cyclone" && f.time < 4.2 },
  { id: "jct-crash", ride: "junction", title: "Collision course", desc: "Cause a crash in the middle of the Crash Junction.", test: (f) => f.k === "crash" },
  { id: "jct-streak", ride: "junction", title: "Air traffic control", desc: "Keep a 15-lap streak going with two or more cars on the 8.", test: (f) => f.k === "streak" && f.n >= 15 },
  { id: "yard-lap", ride: "yard", title: "Round Toy Town", desc: "Drive a full lap of the Stunt Yard through every checkpoint.", test: (f) => f.k === "lap" },
  { id: "yard-fast", ride: "yard", title: "Town record", desc: "Lap the Stunt Yard in under 8 s (nitro on the straights, ease off for the bends).", test: (f) => f.k === "lap" && f.time < 8 },
  { id: "yard-flip", ride: "yard", title: "Flip it", desc: "Land a flip on all four wheels (W / S in the air).", test: (f) => f.k === "trick" && f.clean && f.flips !== 0 },
  { id: "yard-roll", ride: "yard", title: "Barrel roll", desc: "Land a barrel roll on all four wheels (A / D in the air).", test: (f) => f.k === "trick" && f.clean && f.rolls > 0 },
  { id: "yard-combo", ride: "yard", title: "Triple threat", desc: "Land three full turns in a single jump.", test: (f) => f.k === "trick" && f.clean && Math.abs(f.flips) + f.rolls + f.spins >= 3 },
  { id: "yard-dominoes", ride: "yard", title: "Chain reaction", desc: "Topple every domino in the run.", test: (f) => f.k === "dominoes" && f.n >= f.of },
  { id: "yard-strike", ride: "yard", title: "Strike!", desc: "Knock down all ten skittles.", test: (f) => f.k === "pins" && f.n >= f.of },
  { id: "yard-score", ride: "yard", title: "Show-off", desc: "Score 6,000 trick points in one drive.", test: (f) => f.k === "score" && f.n >= 6000 },
  { id: "night", ride: "park", title: "Lights out", desc: "Finish any ride with the lights out (L).", test: (f) => f.k === "finish" && f.night },
];

const KEY = "hw-challenges-v1";

export function loadProgress(): Progress {
  try {
    const p = JSON.parse(localStorage.getItem(KEY) ?? "null");
    if (p && typeof p === "object") return { done: p.done ?? {}, loopCars: p.loopCars ?? [] };
  } catch {
    /* fall through */
  }
  return { done: {}, loopCars: [] };
}

export function saveProgress(p: Progress) {
  try {
    localStorage.setItem(KEY, JSON.stringify(p));
  } catch {
    /* private mode: progress lasts the visit */
  }
}

/** Check a fact against every open challenge; returns the ones it completes. */
export function report(p: Progress, f: Fact): Challenge[] {
  if (f.k === "finish" && f.a === "loop" && !p.loopCars.includes(f.model)) p.loopCars.push(f.model);
  const done: Challenge[] = [];
  for (const c of CHALLENGES) {
    if (p.done[c.id]) continue;
    if (c.test(f, p)) {
      p.done[c.id] = Date.now();
      done.push(c);
    }
  }
  return done;
}
