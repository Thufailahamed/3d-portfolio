import * as THREE from "three";
import { CAR_SPECS, MODELS, buildCar, carMaterials, type BuiltCar, type CarMaterials } from "./car";
import type { Fx } from "./fx";
import { ATTRACTIONS, type Attraction, type AttractionId, type Park } from "./park";
import type { ParkView } from "./scenery";
import { probe, type Car, type Sim, type SimEvent } from "./sim";
import { CHALLENGES, loadProgress, report, saveProgress, type Fact, type Progress } from "./challenges";
import { playBeep, playBell, playBoost, playCheer, playCrash, playFanfare, playGate, playHit, playHop, playJoint, playLaunch, playRatchet, playScrape, playWhoosh, setFire, setMotor, setRolling, setSkid } from "./sound";
import { announce, loadRecords, saveRecords, useHW, type Dot } from "./store";
import type { Track } from "./track";
import { CAR_LEN, RIDE, TIME, TRACK } from "./units";
import { SPAWN } from "./yard";

/**
 * Launcher power (0..1) → launch speed (cm/s). The spring stores the same energy whichever car is
 * in front of it, and shares it with its own plunger (about 14 g), so a light car leaves faster.
 */
export const launchSpeed = (p: number, mass = 36) => (180 + p * 440) * Math.sqrt((36 + 14) / (mass + 14));
/** one sweep of the power meter, up and back down (s) */
const METER = 1.35;
/** cm/s at 1:64 → km/h at full size */
export const scaleKmh = (v: number) => Math.round(Math.abs(v) * 64 * 0.036);
/** how many cars the junction takes before the oldest is lifted off */
const JUNCTION_MAX = 6;
/** how much of the past the replay keeps (sim seconds), and how fast it plays it back */
const REPLAY_KEEP = 14;
const REPLAY_RATE = 0.42;
/** floats per car per recorded frame: id, model, pos, quat, roll, track, s, vel, speed */
const REC = 16;

type View = { root: THREE.Object3D; wheels: THREE.Object3D[]; model: number };

/** What the camera follows: a live car, or one being replayed. */
export type Subject = { id: number; pos: THREE.Vector3; quat: THREE.Quaternion; vel: THREE.Vector3; track: Track | null; s: number; v: number; airborne: boolean; driven: boolean };

/** A best run, kept to race against: the car, and its pose every GHOST_DT seconds from the start. */
type Ghost = { model: number; time: number; p: number[] };
const GHOST_DT = 1 / 30;
const GHOST_KEY = "hw-ghosts-v1";

type Frame = { t: number; cars: Float32Array; blocks: Float32Array };

/**
 * The park's rules on top of the physics: who's waiting at which launcher, the power meter, the
 * drag race, the junction's streak, what counts as a stunt, records, slow motion, which car the
 * camera follows, and the instant replay. Also keeps a drawn car for every simulated one.
 */
export class Game {
  readonly root = new THREE.Group();
  focus: Car | null = null;
  /** when the camera last had something worth following */
  focusT = 0;
  timeScale: number = TIME.normal;
  /** the car the camera should follow this frame (live, or out of the replay) */
  subject: Subject | null = null;
  replaying = false;
  private mats: CarMaterials;
  private protos: BuiltCar[];
  private views = new Map<number, View>();
  private joints = new Map<number, number>();
  private chargeT0 = 0;
  private lastRatchet = 0;
  private lastScrape = 0;
  private lastFire = new Map<string, number>();
  private slowUntil = 0;
  private gateClose: { track: string; at: number }[] = [];
  private pending: { at: number; fn: () => void }[] = [];
  private race = { green: 0, rival: null as Car | null, you: null as Car | null, youFired: null as number | null, rivalAt: 0, done: new Map<number, number>(), firstAt: 0, foul: false };
  private frame = 0;
  private sweets = new Map<string, [number, number] | null>();
  private streak = 0;
  private stalled = new Map<number, number>();
  private live: Subject = { id: 0, pos: new THREE.Vector3(), quat: new THREE.Quaternion(), vel: new THREE.Vector3(), track: null, s: 0, v: 0, airborne: false, driven: false };
  /** shake the camera (set by the scene) */
  shake: (k: number) => void = () => {};
  // the Stunt Yard: the lap, the trick score, the toys knocked down
  private lap = { next: 0, start: -1, best: null as number | null, last: null as number | null };
  private score = 0;
  private toysDown = { dominoes: 0, pins: 0 };
  // challenges
  private progress: Progress;
  // ghosts: best runs saved per attraction, the one being recorded, the one playing
  private ghosts: Partial<Record<AttractionId, Ghost>> = {};
  private recording: { a: AttractionId; model: number; t0: number; p: number[]; id: number } | null = null;
  private ghostPlay: { g: Ghost; t0: number } | null = null;
  private ghostObj = new THREE.Group();
  private ghostModel = -1;
  private ghostMat = new THREE.MeshStandardMaterial({ color: "#a8dcff", emissive: new THREE.Color("#3aa0ff"), emissiveIntensity: 0.7, transparent: true, opacity: 0.38, depthWrite: false, roughness: 0.3 });
  // the replay: a rolling record of every car and block, and the playhead when it plays
  private frames: Frame[] = [];
  private lastBlocks: Float32Array | null = null;
  private play = { t: 0, t0: 0, t1: 0, focus: 0, hold: 0 };
  private lastRun = { id: 0, t0: 0 };
  private rep: Subject = { id: 0, pos: new THREE.Vector3(), quat: new THREE.Quaternion(), vel: new THREE.Vector3(), track: null, s: 0, v: 0, airborne: false, driven: false };
  private mapBox: { x0: number; z0: number; w: number } | null = null;

  constructor(
    private park: Park,
    private sim: Sim,
    private view: ParkView,
    private fx: Fx,
    private camera: THREE.Camera,
    aniso: number,
  ) {
    this.mats = carMaterials();
    this.protos = MODELS.map((m) => buildCar(m, this.mats, aniso));
    useHW.getState().set({ records: loadRecords() });
    this.progress = loadProgress();
    useHW.getState().set({ challengesDone: Object.keys(this.progress.done) });
    try {
      this.ghosts = JSON.parse(localStorage.getItem(GHOST_KEY) ?? "{}");
    } catch {
      this.ghosts = {};
    }
    // the ghost car: parked far below the floor until a ghost runs (its shader is compiled with everything else)
    this.root.add(this.ghostObj);
    this.setGhostModel(0);
    this.ghostObj.position.set(0, -2000, 0);
    useHW.getState().set({ drive: { ...useHW.getState().drive, best: this.ghosts.yard?.time ?? null, of: sim.checkpoints.length } });
    this.lap.best = this.ghosts.yard?.time ?? null;
  }

  // —————————————————————————————————————————— challenges

  /** Tell the challenges something happened; celebrate any it completes. */
  private fact(f: Fact) {
    const done = report(this.progress, f);
    if (f.k === "finish") saveProgress(this.progress);
    if (!done.length) return;
    saveProgress(this.progress);
    const s = useHW.getState();
    s.set({ challengesDone: Object.keys(this.progress.done) });
    done.forEach((c, i) =>
      this.pending.push({
        at: performance.now() / 1000 + 0.6 + i * 2.2,
        fn: () => {
          const n = Object.keys(this.progress.done).length;
          const id = Date.now();
          useHW.getState().set({ toast: { id, title: c.title, desc: `${c.desc} · ${n}/${CHALLENGES.length}` } });
          this.pending.push({ at: performance.now() / 1000 + 4.2, fn: () => useHW.getState().toast?.id === id && useHW.getState().set({ toast: null }) });
          if (useHW.getState().sound) playFanfare();
          this.fx.party(this.subject?.pos.clone().setY((this.subject?.pos.y ?? 0) + 8) ?? new THREE.Vector3(0, 30, 0), 200);
        },
      }),
    );
  }

  // —————————————————————————————————————————— ghosts

  private setGhostModel(model: number) {
    if (model === this.ghostModel) return;
    this.ghostModel = model;
    this.ghostObj.clear();
    const car = this.protos[model].root.clone(true);
    car.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) {
        m.material = this.ghostMat;
        m.castShadow = false;
        m.receiveShadow = false;
      }
    });
    this.ghostObj.add(car);
  }

  /** Start recording your run (a launch, or a lap starting), and set your best one running alongside. */
  private ghostStart(a: AttractionId, car: Car) {
    this.recording = { a, model: car.model, t0: this.sim.clock, p: [], id: car.id };
    const g = this.ghosts[a];
    this.ghostPlay = g && useHW.getState().ghosts ? { g, t0: this.sim.clock } : null;
    if (g) this.setGhostModel(g.model);
  }

  /** A run finished: keep it if it's the best yet. */
  private ghostFinish(a: AttractionId, time: number) {
    const r = this.recording;
    if (!r || r.a !== a) return;
    this.recording = null;
    const prev = this.ghosts[a];
    if (prev && prev.time <= time) return;
    this.ghosts[a] = { model: r.model, time, p: r.p.map((x) => Math.round(x * 100) / 100) };
    try {
      localStorage.setItem(GHOST_KEY, JSON.stringify(this.ghosts));
    } catch {
      /* private mode: ghosts last the visit */
    }
  }

  private ghostFrame() {
    const r = this.recording;
    if (r) {
      const car = this.sim.cars.find((c) => c.id === r.id);
      const t = this.sim.clock - r.t0;
      if (!car || t > 14) this.recording = null;
      else if (r.p.length / 7 <= t / GHOST_DT) r.p.push(car.pos.x, car.pos.y, car.pos.z, car.quat.x, car.quat.y, car.quat.z, car.quat.w);
    }
    const gp = this.ghostPlay;
    if (!gp || !useHW.getState().ghosts) {
      this.ghostObj.position.y = -2000;
      return;
    }
    const f = (this.sim.clock - gp.t0) / GHOST_DT;
    const n = gp.g.p.length / 7;
    if (f >= n - 1) {
      this.ghostObj.position.y = -2000;
      if (f > n + 30) this.ghostPlay = null;
      return;
    }
    const i = Math.floor(f);
    const k = f - i;
    const a = i * 7;
    const b = a + 7;
    const p = gp.g.p;
    this.ghostObj.position.set(p[a] + (p[b] - p[a]) * k, p[a + 1] + (p[b + 1] - p[a + 1]) * k, p[a + 2] + (p[b + 2] - p[a + 2]) * k);
    this.ghostObj.quaternion.set(p[a + 3], p[a + 4], p[a + 5], p[a + 6]).slerp(new THREE.Quaternion(p[b + 3], p[b + 4], p[b + 5], p[b + 6]), k);
  }

  // —————————————————————————————————————————— the Stunt Yard: your car

  get driving() {
    return !!this.sim.driven && useHW.getState().driving;
  }

  /** Put your car on the start line and take the wheel. */
  startDrive(keepScore = false) {
    if (this.replaying) this.stopReplay();
    const model = useHW.getState().model;
    const car = this.sim.spawnDriven(model, CAR_SPECS[model], SPAWN.at, SPAWN.yaw);
    Object.assign(this.sim.control, { throttle: 0, steer: 0, handbrake: false, nitro: false, hop: false });
    this.focus = car;
    this.focusT = performance.now() / 1000;
    this.lap.next = 0;
    this.lap.start = -1;
    if (!keepScore) {
      this.score = 0;
      announce("YOUR CAR", "info", "W A S D to drive · Space to hop · Shift for nitro · X to slide");
    }
    this.lastRun = { id: car.id, t0: this.sim.clock };
    useHW.getState().set({ driving: true, charging: false });
  }

  stopDrive() {
    if (this.sim.driven) this.sim.remove(this.sim.driven);
    this.recording = null;
    this.ghostPlay = null;
    useHW.getState().set({ driving: false });
    setMotor(0, 0, false, false);
    setSkid(0);
  }

  /** Back to the start line (the lap starts over). */
  respawn() {
    if (!this.driving) return;
    this.startDrive(true);
  }

  resetToys() {
    this.sim.resetToys();
    this.view.refresh();
    this.toysDown = { dominoes: 0, pins: 0 };
    announce("Toys stood back up", "info");
  }

  /** Your hands on the car. */
  setDrive(c: Partial<{ throttle: number; steer: number; handbrake: boolean; nitro: boolean; hop: boolean }>) {
    Object.assign(this.sim.control, c);
  }

  /** Points for a landed trick, and what to call it. */
  private trick(e: Extract<SimEvent, { type: "trick" }>) {
    const parts: string[] = [];
    const flips = Math.abs(e.flips);
    if (flips) parts.push(`${flips > 1 ? flips + "× " : ""}${e.flips > 0 ? "FRONTFLIP" : "BACKFLIP"}`);
    if (e.rolls) parts.push(`${e.rolls > 1 ? e.rolls + "× " : ""}BARREL ROLL`);
    if (e.spins) parts.push(`${e.spins * 360}`);
    let pts = Math.round(e.air * 400 + flips * 900 + e.rolls * 700 + e.spins * 500);
    if (!e.clean) {
      if (parts.length) announce("BAILED", "bad", `${parts.join(" + ")} — land it on its wheels`);
      this.shake(0.5);
      return;
    }
    const combo = flips + e.rolls + e.spins;
    if (combo >= 2) pts = Math.round(pts * (1 + combo * 0.25));
    this.score += pts;
    if (parts.length) {
      announce(parts.join(" + "), combo >= 2 ? "gold" : "good", `+${pts} · ${e.air.toFixed(2)} s air · clean landing`);
      this.view.cheer(Math.min(1.5, 0.6 + combo * 0.3));
      if (useHW.getState().sound) playCheer(0.6 + combo * 0.2);
    } else if (e.air > 0.3) announce(`AIR · ${e.air.toFixed(2)} s`, "good", `+${pts}`);
    this.fact({ k: "trick", flips: e.flips, rolls: e.rolls, spins: e.spins, clean: e.clean, air: e.air });
    this.fact({ k: "score", n: this.score });
    const rec = useHW.getState().records.yard?.score ?? 0;
    if (this.score > rec) {
      const s = useHW.getState();
      const records = { ...s.records, yard: { ...(s.records.yard ?? {}), score: this.score } };
      s.set({ records });
      saveRecords(records);
    }
  }

  /** Through a checkpoint arch: the lap counts on, and a full lap is timed. */
  private checkpoint(car: Car, i: number) {
    const n = this.sim.checkpoints.length;
    const L = this.lap;
    if (i !== L.next) return;
    const sound = useHW.getState().sound;
    if (i === 0) {
      if (L.start >= 0) {
        const time = this.sim.clock - L.start;
        const best = L.best === null || time < L.best;
        L.last = time;
        this.ghostFinish("yard", time);
        if (best) L.best = time;
        if (sound) playBell();
        announce(`LAP · ${time.toFixed(2)} s`, best ? "gold" : "good", best ? "Best lap — your ghost will race it" : `Best ${L.best!.toFixed(2)} s`);
        if (best) this.fx.party(car.pos.clone().setY(car.pos.y + 10), 180);
        this.record("yard", time, 0, 0);
        this.fact({ k: "lap", time });
        this.fact({ k: "finish", a: "yard", time, model: car.model, night: useHW.getState().night });
      }
      L.start = this.sim.clock;
      this.ghostStart("yard", car);
    } else if (sound) playBeep(false);
    L.next = (i + 1) % n;
  }

  get attraction(): Attraction | null {
    const st = this.park.stops[useHW.getState().stop];
    return ATTRACTIONS.find((a) => a.id === st?.id) ?? null;
  }

  /** The launch band that clears a launcher attraction without coming off, for this car (each car's is its own). */
  private sweetFor(a: Attraction, model: number) {
    if (a.kind !== "launcher" || a.id === "drag") return null;
    const key = `${a.id}:${model}`;
    if (this.sweets.has(key)) return this.sweets.get(key)!;
    const tr = this.park.byId.get(a.tracks[0])!;
    const spec = CAR_SPECS[model];
    let lo = -1;
    let hi = -1;
    for (let p = 0; p <= 1.0001; p += 0.01) {
      const r = probe(tr, launchSpeed(p, spec.mass), tr.hold!.s, spec);
      if (r.ok) {
        if (lo < 0) lo = p;
        hi = p;
      }
    }
    const band: [number, number] | null = lo >= 0 ? [lo, hi] : null;
    this.sweets.set(key, band);
    return band;
  }

  // —————————————————————————————————————————— controls

  private stageFor(a: Attraction) {
    const model = useHW.getState().model;
    const tr = this.park.byId.get(a.tracks[0])!;
    const last = this.lastFire.get(tr.id) ?? -10;
    if (performance.now() / 1000 - last < 0.9) return null;
    // a car still rolling out of the start blocks the next one
    if (this.sim.cars.some((c) => !c.held && c.mode === "track" && c.track === tr && c.s < tr.hold!.s + CAR_LEN * 2.5 && Math.abs(c.v) > 1)) return null;
    return this.sim.stage(tr.id, model, CAR_SPECS[model]);
  }

  press() {
    const s = useHW.getState();
    if (this.replaying) return this.stopReplay();
    if (s.drop) return;
    const a = this.attraction;
    if (!a) {
      announce("Pick an attraction first", "info", "Use the tabs, or ← →");
      return;
    }
    if (a.id === "drag") return this.startRace();
    if (a.kind === "drop") return this.dropIn();
    if (a.kind === "drive") {
      if (!this.driving) this.startDrive();
      else this.sim.control.hop = true;
      return;
    }
    if (a.kind === "gate") {
      const car = this.sim.heldOn(a.tracks[0]) ?? this.stageFor(a);
      if (!car) return;
      this.fire(car, a, 0);
      return;
    }
    const car = this.sim.heldOn(a.tracks[0]) ?? this.stageFor(a);
    if (!car) return;
    this.chargeT0 = performance.now() / 1000;
    s.set({ charging: true, charge: 0 });
  }

  release() {
    const s = useHW.getState();
    if (!s.charging) return;
    s.set({ charging: false });
    const a = this.attraction;
    if (!a) return;
    if (a.id === "drag") return this.releaseRace();
    const car = this.sim.heldOn(a.tracks[0]);
    if (car) this.fire(car, a, s.charge);
    this.view.setPull(a.tracks[0], 0);
  }

  private fire(car: Car, a: Attraction, power: number) {
    const tr = car.track!;
    this.lastFire.set(tr.id, performance.now() / 1000);
    if (a.kind === "gate") {
      this.view.setGate(tr.id, true);
      this.gateClose.push({ track: tr.id, at: performance.now() / 1000 + 0.9 });
      this.sim.fire(car, 48, 0);
    } else {
      this.view.kick(tr.id);
      this.sim.fire(car, launchSpeed(power, car.mass), power);
    }
  }

  /** The Crash Junction: set a car down on the circuit, just before a booster, already rolling. */
  private dropIn(model = useHW.getState().model, quiet = false) {
    const { track, s } = this.park.dropAt;
    const tr = this.park.byId.get(track)!;
    const on = this.sim.cars.filter((c) => c.mode === "track" && c.track === tr);
    // the hand waits for a gap: nothing coming up on the spot, nothing just past it
    const blocked = on.some((c) => {
      const d = tr.delta(c.s, s);
      return d > -CAR_LEN * 1.6 && d < 34;
    });
    if (blocked) {
      if (!quiet) announce("Wait for a gap", "info", "A car is coming through the drop zone");
      return;
    }
    if (on.length >= JUNCTION_MAX) this.sim.remove(on.sort((a, b) => a.born - b.born)[0]);
    const car = this.sim.dropOn(track, s, 5, 110, model, CAR_SPECS[model]);
    this.lastFire.set(track, performance.now() / 1000);
    if (!quiet) {
      this.focus = car;
      this.focusT = performance.now() / 1000;
    }
  }

  /** Every attraction at once. */
  launchAll() {
    if (this.replaying) this.stopReplay();
    for (const a of ATTRACTIONS) {
      if (a.kind === "drop") {
        this.dropIn(Math.floor(Math.random() * MODELS.length), true);
        continue;
      }
      if (a.kind === "drive") continue;
      for (const id of a.tracks) {
        const model = Math.floor(Math.random() * MODELS.length);
        const car = this.sim.stage(id, model, CAR_SPECS[model]);
        const sweet = this.sweetFor(a, model);
        const p = sweet ? sweet[0] + (sweet[1] - sweet[0]) * (0.2 + Math.random() * 0.6) : 0.6 + Math.random() * 0.4;
        this.lastFire.set(id, performance.now() / 1000);
        if (a.kind === "gate") {
          this.view.setGate(id, true);
          this.gateClose.push({ track: id, at: performance.now() / 1000 + 0.9 });
          this.sim.fire(car, 48, 0);
        } else {
          this.view.kick(id);
          this.sim.fire(car, launchSpeed(p, car.mass), p);
        }
      }
    }
    announce("EVERYTHING GOES", "gold", "Every ride at once");
    playLaunch(0.8);
  }

  reset() {
    if (this.replaying) this.stopReplay();
    this.sim.reset();
    this.view.refresh();
    this.race.rival = this.race.you = null;
    this.view.setTree({ ambers: 0, green: false, red: [false, false], win: [false, false] });
    this.focus = null;
    this.lastFire.clear();
    this.frames = [];
    this.lastBlocks = null;
    this.streak = 0;
    this.score = 0;
    this.lap.next = 0;
    this.lap.start = -1;
    this.toysDown = { dominoes: 0, pins: 0 };
    this.recording = null;
    this.ghostPlay = null;
    useHW.getState().set({ driving: false });
    useHW.getState().set({ race: { phase: "idle", ambers: 0 }, charging: false, charge: 0, last: null, blocksDown: 0, canReplay: false, junction: { cars: 0, streak: 0 } });
    announce("Park reset", "info", "Cars picked up, castle rebuilt");
  }

  /** Drop a car from above a point (it may land on a track and ride it). */
  drop(at: THREE.Vector3) {
    if (this.replaying) return;
    const model = useHW.getState().model;
    const yaw = Math.atan2(at.x - this.camera.position.x, at.z - this.camera.position.z);
    const car = this.sim.drop(at.clone().setY(at.y + 30), model, CAR_SPECS[model], yaw);
    this.focus = car;
    this.focusT = performance.now() / 1000;
  }

  // —————————————————————————————————————————— the drag race

  private startRace() {
    const s = useHW.getState();
    if (s.race.phase === "countdown" || s.race.phase === "go" || s.race.phase === "racing") {
      // already counting down: pressing means charging
      if (s.race.phase !== "racing") {
        this.chargeT0 = performance.now() / 1000;
        s.set({ charging: true });
      }
      return;
    }
    const model = s.model;
    const rivalModel = (model + 1 + Math.floor(Math.random() * (MODELS.length - 1))) % MODELS.length;
    // clear both lanes, put both cars on the line
    for (const c of [...this.sim.cars]) if (c.track?.id.startsWith("drag")) this.sim.remove(c);
    this.race.you = this.sim.stage("drag-a", model, CAR_SPECS[model]);
    this.race.rival = this.sim.stage("drag-b", rivalModel, CAR_SPECS[rivalModel]);
    this.race.rival.rival = true;
    this.race.youFired = null;
    this.race.done.clear();
    this.race.foul = false;
    this.race.firstAt = 0;
    const now = performance.now() / 1000;
    this.race.green = now + 2.1 + Math.random() * 0.5;
    this.race.rivalAt = this.race.green + 0.17 + Math.random() * 0.17;
    this.chargeT0 = now;
    s.set({ race: { phase: "countdown", ambers: 0 }, charging: true, charge: 0, last: null });
    this.view.setTree({ ambers: 0, green: false, red: [false, false], win: [false, false] });
    announce(`${MODELS[model].name} vs ${MODELS[rivalModel].name}`, "info", "Hold to charge, release on green");
    // the camera stays on the tree until you launch
    this.focus = null;
  }

  private releaseRace() {
    const s = useHW.getState();
    const now = performance.now() / 1000;
    if (!this.race.you || this.race.youFired !== null) return;
    if (s.race.phase === "countdown") {
      // jumped the start
      this.race.foul = true;
      this.race.youFired = now;
      this.view.kick("drag-a");
      this.sim.fire(this.race.you, launchSpeed(s.charge, this.race.you.mass), s.charge);
      this.view.setTree({ ambers: s.race.ambers, green: false, red: [true, false], win: [false, false] });
      announce("RED LIGHT", "bad", "You went before the green");
      return;
    }
    if (s.race.phase === "go") {
      this.race.youFired = now;
      this.view.kick("drag-a");
      this.sim.fire(this.race.you, launchSpeed(s.charge, this.race.you.mass), s.charge);
    }
  }

  private updateRace(now: number) {
    const s = useHW.getState();
    const r = this.race;
    if (s.race.phase === "countdown") {
      const left = r.green - now;
      const ambers = left < 0.5 ? 3 : left < 1.0 ? 2 : left < 1.5 ? 1 : 0;
      if (ambers !== s.race.ambers) {
        s.set({ race: { ...s.race, ambers } });
        if (ambers > 0) playBeep(false);
        this.view.setTree({ ambers, green: false, red: [r.foul, false], win: [false, false] });
      }
      if (left <= 0) {
        s.set({ race: { ...s.race, phase: "go", ambers: 3 } });
        playBeep(true);
        this.view.setTree({ ambers: 0, green: true, red: [r.foul, false], win: [false, false] });
      }
    }
    if ((s.race.phase === "go" || s.race.phase === "countdown") && r.rival?.held && now >= r.rivalAt) {
      const p = 0.72 + Math.random() * 0.24;
      this.view.kick("drag-b");
      this.sim.fire(r.rival, launchSpeed(p, r.rival.mass), p);
    }
    if (s.race.phase === "go" && r.youFired !== null && !r.rival?.held) s.set({ race: { ...s.race, phase: "racing" } });
    // too slow off the line: a second and a half after green, you've lost it
    if (s.race.phase === "go" && r.youFired === null && now > r.green + 1.6 && r.you) {
      this.sim.fire(r.you, launchSpeed(0.3, r.you.mass), 0.3);
      r.youFired = now + 10;
      s.set({ charging: false, race: { ...s.race, phase: "racing" } });
    }
    if ((s.race.phase === "racing" || s.race.phase === "go") && r.you && r.rival) {
      const a = r.done.get(r.you.id);
      const b = r.done.get(r.rival.id);
      const decided = (a !== undefined && b !== undefined) || (r.firstAt && this.sim.clock - r.firstAt > 1.5);
      if (decided) {
        const ya = a ?? Infinity;
        const yb = b ?? Infinity;
        const win = !r.foul && ya < yb;
        const margin = Number.isFinite(ya) && Number.isFinite(yb) ? Math.abs(ya - yb) : 0;
        const reaction = r.youFired !== null && r.youFired < r.green + 5 && !r.foul ? r.youFired - r.green : null;
        s.set({ race: { phase: "done", ambers: 0, result: { win, foul: r.foul, margin, reaction, you: Number.isFinite(ya) ? ya : undefined, rival: Number.isFinite(yb) ? yb : undefined } } });
        this.view.setTree({ ambers: 0, green: false, red: [r.foul, false], win: [win, !win] });
        if (win) {
          announce("YOU WIN", "gold", `by ${margin.toFixed(3)} s${reaction !== null ? ` · reaction ${reaction.toFixed(3)} s` : ""}`);
          this.view.cheer(1.3);
          playCheer(1.2);
          this.fx.party(r.you.pos.clone().setY(8), 260);
        } else announce(r.foul ? "DISQUALIFIED" : "RIVAL WINS", "bad", r.foul ? "Red light — wait for the green" : margin ? `by ${margin.toFixed(3)} s` : "");
        // your time counts whether or not the rival beat it (but not off a red light)
        if (Number.isFinite(ya) && !r.foul) {
          this.record("drag", ya, 0, r.you.run?.top ?? 0);
          this.ghostFinish("drag", ya);
        }
        this.fact({ k: "drag", win, reaction });
        useHW.getState().set({ canReplay: true });
      }
    }
  }

  // —————————————————————————————————————————— events → stunts, sound, effects

  private gainAt(p: THREE.Vector3) {
    const d = this.camera.position.distanceTo(p);
    return 1 / (1 + d / 140);
  }
  private panAt(p: THREE.Vector3) {
    const ndc = p.clone().project(this.camera);
    return THREE.MathUtils.clamp(ndc.x * 0.7, -1, 1);
  }

  private isMine(car: Car) {
    return !car.rival;
  }

  private junctionCars() {
    return this.sim.cars.filter((c) => c.mode === "track" && c.track?.id === "junction").length;
  }

  private handle(e: SimEvent, now: number) {
    const sound = useHW.getState().sound;
    switch (e.type) {
      case "launch": {
        if (e.car.track?.hold?.kind === "launcher") {
          if (sound) playLaunch(e.power);
          this.fx.puff(e.car.pos, 0.2);
        } else if (e.car.track?.hold?.kind === "gate" && sound) playGate();
        if (this.isMine(e.car) && e.car.run) {
          this.focus = e.car;
          this.focusT = now;
          this.lastRun = { id: e.car.id, t0: this.sim.clock };
          if (["loop", "jump", "cyclone", "drag"].includes(e.car.run.attraction)) this.ghostStart(e.car.run.attraction, e.car);
        }
        break;
      }
      case "boost":
        this.view.boost(e.car.pos);
        if (sound) playBoost(this.gainAt(e.car.pos), this.panAt(e.car.pos));
        break;
      case "loop":
        if (!e.car.run || !this.isMine(e.car)) break;
        if (sound) playWhoosh(0.6 * this.gainAt(e.car.pos) * 2);
        announce(e.car.run.loops >= 2 ? "DOUBLE LOOP" : "LOOP", e.car.run.loops >= 2 ? "gold" : "good", `${e.car.run.maxG.toFixed(1)} g at the bottom`);
        this.fact({ k: "g", g: e.car.run.maxG });
        break;
      case "lap": {
        if (e.car.track?.id !== "junction") break;
        if (this.junctionCars() >= 2) {
          this.streak++;
          if (this.streak % 10 === 0) announce(`${this.streak} LAPS`, "good", "and nobody's hit anybody yet");
          const best = useHW.getState().records.junction?.laps ?? 0;
          if (this.streak > best) this.recordLaps(this.streak);
          this.fact({ k: "streak", n: this.streak });
        }
        break;
      }
      case "detach": {
        const car = e.car;
        const tr = car.lastTrack;
        if (e.why === "air" && tr && tr.loops.some((l) => car.s > l.s0 && car.s < l.s1)) {
          if (car.run && this.isMine(car)) announce("FELL OUT OF THE LOOP", "bad", "Not enough speed — give it more power");
        } else if (e.why === "rail") {
          this.fx.sparkBurst(car.pos, car.vel.clone().normalize(), 0.8);
          if (car.run && this.isMine(car)) announce("OFF THE RAILS", "bad", tr?.loops.length ? "Too fast for the hairpin — ease off" : "Too fast for that bend");
          if (car.run && this.isMine(car)) this.fact({ k: "rail" });
        } else if (e.why === "air" && car.run && this.isMine(car)) announce("AIRBORNE", "good");
        // jumps get the slow-motion treatment
        if (car === this.focus && useHW.getState().autoSlow && (e.why === "end" ? tr?.id === "jump" : e.why === "air" && !tr?.loops.length)) this.slowUntil = now + 1.25;
        break;
      }
      case "land": {
        const strength = Math.min(1.2, e.impact / 250);
        if (sound) playHit("land", 0.3 + strength, this.gainAt(e.at), this.panAt(e.at));
        if (e.impact > 110) this.fx.sparkBurst(e.at.clone().setY(e.at.y - 0.9), e.car.vel.clone().normalize(), strength);
        if (e.air > 0.22 && e.car.run && this.isMine(e.car)) announce(`BIG AIR · ${e.air.toFixed(2)} s`, e.air > 0.4 ? "gold" : "good", e.impact < 140 ? "Clean landing" : "Hard landing");
        if (e.car.run && this.isMine(e.car)) this.fact({ k: "air", t: e.air });
        if (e.car === this.focus) this.shake(Math.min(0.7, e.impact / 400));
        break;
      }
      case "ring":
        if (sound) playWhoosh(1);
        this.view.cheer(1);
        if (sound) playCheer(0.8);
        announce("THROUGH THE RING OF FIRE", "gold");
        this.fact({ k: "ring" });
        break;
      case "crash": {
        const { a, b, at, strength } = e;
        this.fx.sparkBurst(at, a.vel.clone().add(b.vel).normalize(), 0.6 + strength);
        this.fx.puff(at, 0.4);
        if (sound) playCrash(0.5 + strength, this.gainAt(at), this.panAt(at));
        this.view.cheer(1.2);
        if (sound) playCheer(1);
        const lasted = this.streak;
        announce("CRASH!", "gold", lasted ? `after a ${lasted}-lap streak` : "right in the middle");
        this.fact({ k: "crash" });
        this.shake(0.9);
        this.streak = 0;
        // the camera goes to the wreck (and slows it down)
        const mine = a.rival ? b : a;
        this.focus = mine;
        this.focusT = now;
        this.lastRun = { id: mine.id, t0: Math.max(this.lastRun.t0, this.sim.clock - 4) };
        if (useHW.getState().autoSlow) this.slowUntil = now + 1.4;
        useHW.getState().set({ canReplay: true });
        break;
      }
      case "hit": {
        if (e.strength < 0.04) break;
        if (sound) playHit(e.what, e.strength, this.gainAt(e.at), this.panAt(e.at));
        if (e.car && (e.what === "floor" || e.what === "track") && e.strength > 0.55) this.fx.sparkBurst(e.at.clone().setY(e.at.y - 0.6), e.car.vel.clone().normalize(), e.strength * 0.6);
        if (e.what === "floor" && e.strength > 0.3) this.fx.puff(e.at, e.strength * 0.6);
        if (e.car && e.car === this.focus && e.strength > 0.35) this.shake(Math.min(0.6, e.strength * 0.5));
        break;
      }
      case "bump":
        if (sound) playHit("bump", e.strength, this.gainAt(e.at), this.panAt(e.at));
        break;
      case "finish": {
        const car = e.car;
        const run = car.run!;
        if (car.track?.id.startsWith("drag")) {
          this.race.done.set(car.id, e.time);
          if (!this.race.firstAt) this.race.firstAt = this.sim.clock;
          if (sound) playBell();
          break;
        }
        if (!this.isMine(car)) break;
        if (sound) {
          playBell();
          playCheer(1);
        }
        this.view.cheer(1);
        this.fx.party(car.pos.clone().setY(car.pos.y + 6), 160);
        const record = this.record(run.attraction, e.time, run.air, run.top, run.maxG);
        this.ghostFinish(run.attraction, e.time);
        this.fact({ k: "finish", a: run.attraction, time: e.time, model: car.model, night: useHW.getState().night });
        announce(`FINISH · ${e.time.toFixed(2)} s`, record ? "gold" : "good", record ? "New park record" : `Top speed ${scaleKmh(run.top)} km/h (scale) · ${run.maxG.toFixed(1)} g`);
        useHW.getState().set({ canReplay: true, last: { attraction: run.attraction, time: e.time, air: run.air, top: run.top, loops: run.loops, ring: run.ring, crashed: run.crashed, smashed: run.smashed, record, maxG: run.maxG } });
        break;
      }
      case "wipeout":
        if (!this.isMine(e.car) || e.car.run?.attraction === "junction") break;
        announce("WIPEOUT", "bad");
        if (e.car.run) {
          const r = e.car.run;
          this.record(r.attraction, undefined, r.air, r.top, r.maxG);
          useHW.getState().set({ canReplay: true, last: { attraction: r.attraction, air: r.air, top: r.top, loops: r.loops, ring: r.ring, crashed: true, smashed: r.smashed, record: false, maxG: r.maxG } });
        }
        break;
      case "trick":
        if (e.car.driven) this.trick(e);
        break;
      case "checkpoint":
        if (e.car.driven) this.checkpoint(e.car, e.i);
        break;
      case "hop":
        if (sound) playHop();
        break;
      case "righted":
        announce("Back on its wheels", "info", "R puts you back on the start line");
        break;
      case "smash":
        announce("CASTLE CRUSHER", "gold");
        this.view.cheer(1.4);
        if (sound) playCheer(1.3);
        if (useHW.getState().autoSlow && e.car === this.focus) this.slowUntil = now + 1.1;
        this.shake(0.7);
        this.pending.push({
          at: now + 1.8,
          fn: () => {
            const n = this.sim.displaced();
            if (n > 0) announce(`${n} BLOCKS DOWN`, n > 12 ? "gold" : "good");
            this.fact({ k: "blocks", n });
          },
        });
        break;
    }
  }

  /** Keep the best of each; returns true when the time is a new best. */
  private record(id: AttractionId, time: number | undefined, air: number, top: number, g = 0) {
    const s = useHW.getState();
    const prev = s.records[id] ?? {};
    const next = { ...prev };
    const best = time !== undefined && (prev.time === undefined || time < prev.time);
    if (best) next.time = time;
    if (air > (prev.air ?? 0)) next.air = air;
    if (top > (prev.top ?? 0)) next.top = top;
    if (g > (prev.g ?? 0)) next.g = g;
    const records = { ...s.records, [id]: next };
    s.set({ records });
    saveRecords(records);
    // the first run sets the record quietly; beating it is the news
    return best && prev.time !== undefined;
  }

  private recordLaps(laps: number) {
    const s = useHW.getState();
    const records = { ...s.records, junction: { ...(s.records.junction ?? {}), laps } };
    s.set({ records });
    saveRecords(records);
  }

  // —————————————————————————————————————————— the instant replay

  /** Play back the last run (or the last few seconds) in slow motion, cutting between trackside cameras. */
  startReplay() {
    if (this.replaying || this.frames.length < 30) return;
    const tNow = this.frames[this.frames.length - 1].t;
    const id = this.lastRun.id || this.focus?.id || 0;
    const seen = this.frames.some((f) => this.carIn(f, id) >= 0);
    if (!id || !seen) {
      announce("Nothing to replay yet", "info", "Launch a car first");
      return;
    }
    let t0 = Math.max(this.lastRun.t0 - 0.35, tNow - 9, this.frames[0].t);
    // start where the car first shows up, and cut the dead time once it has stopped for good
    const first = this.frames.find((f) => f.t >= t0 && this.carIn(f, id) >= 0);
    if (first) t0 = first.t;
    let t1 = tNow;
    for (let i = this.frames.length - 1; i > 0; i--) {
      const f = this.frames[i];
      const k = this.carIn(f, id);
      if (k >= 0 && f.cars[k * REC + 15] > 8) {
        t1 = Math.min(tNow, f.t + 0.9);
        break;
      }
    }
    if (t1 - t0 < 0.8) t0 = Math.max(this.frames[0].t, t1 - 3);
    this.play = { t: t0, t0, t1, focus: id, hold: 0 };
    this.replaying = true;
    useHW.getState().set({ replay: { on: true, k: 0 }, charging: false });
    setRolling(0, 0);
  }

  stopReplay() {
    if (!this.replaying) return;
    this.replaying = false;
    this.view.refresh();
    useHW.getState().set({ replay: { on: false, k: 0 } });
  }

  private carIn(f: Frame, id: number) {
    for (let k = 0; k < f.cars.length / REC; k++) if (f.cars[k * REC] === id) return k;
    return -1;
  }

  private recordFrame() {
    const t = this.sim.clock;
    const last = this.frames[this.frames.length - 1];
    if (last && t - last.t < 1 / 90) return;
    const cars = new Float32Array(this.sim.cars.length * REC);
    this.sim.cars.forEach((c, k) => {
      const o = k * REC;
      cars[o] = c.id;
      cars[o + 1] = c.model;
      cars[o + 2] = c.pos.x;
      cars[o + 3] = c.pos.y;
      cars[o + 4] = c.pos.z;
      cars[o + 5] = c.quat.x;
      cars[o + 6] = c.quat.y;
      cars[o + 7] = c.quat.z;
      cars[o + 8] = c.quat.w;
      cars[o + 9] = c.roll;
      cars[o + 10] = c.mode === "track" && c.track ? c.track.index : -1;
      cars[o + 11] = c.s;
      cars[o + 12] = c.vel.x;
      cars[o + 13] = c.vel.y;
      cars[o + 14] = c.vel.z;
      cars[o + 15] = c.mode === "track" ? Math.abs(c.v) : c.vel.length();
    });
    // the castle only needs recording while some of it is moving
    const bodies = [...this.sim.blockBodies, ...this.sim.toyBodies];
    let blocks = this.lastBlocks;
    if (!blocks || bodies.some((b) => !b.isSleeping())) {
      blocks = new Float32Array(bodies.length * 7);
      bodies.forEach((b, i) => {
        const p = b.translation();
        const q = b.rotation();
        blocks!.set([p.x, p.y, p.z, q.x, q.y, q.z, q.w], i * 7);
      });
      this.lastBlocks = blocks;
    }
    this.frames.push({ t, cars, blocks });
    while (this.frames.length && t - this.frames[0].t > REPLAY_KEEP) this.frames.shift();
  }

  private updateReplay(dt: number) {
    const p = this.play;
    if (p.t >= p.t1) {
      p.hold += dt;
      if (p.hold > 0.8) return this.stopReplay();
    }
    // slower still through the moments that matter (the camera's car flying or crashing)
    p.t = Math.min(p.t1, p.t + dt * REPLAY_RATE * (this.rep.airborne ? 0.7 : 1));
    let i = this.frames.findIndex((f) => f.t >= p.t);
    if (i < 0) i = this.frames.length - 1;
    const b = this.frames[i];
    const a = this.frames[Math.max(0, i - 1)];
    const k = b.t > a.t ? THREE.MathUtils.clamp((p.t - a.t) / (b.t - a.t), 0, 1) : 1;
    const cars: { id: number; model: number; pos: THREE.Vector3; quat: THREE.Quaternion; roll: number; speed: number }[] = [];
    const qa = new THREE.Quaternion();
    const qb = new THREE.Quaternion();
    for (let m = 0; m < b.cars.length / REC; m++) {
      const o = m * REC;
      const id = b.cars[o];
      const ka = this.carIn(a, id);
      const src = ka >= 0 ? a.cars : b.cars;
      const oa = ka >= 0 ? ka * REC : o;
      const lerp = (j: number) => src[oa + j] + (b.cars[o + j] - src[oa + j]) * k;
      const pos = new THREE.Vector3(lerp(2), lerp(3), lerp(4));
      qa.set(src[oa + 5], src[oa + 6], src[oa + 7], src[oa + 8]);
      qb.set(b.cars[o + 5], b.cars[o + 6], b.cars[o + 7], b.cars[o + 8]);
      const quat = qa.clone().slerp(qb, k);
      cars.push({ id, model: b.cars[o + 1], pos, quat, roll: lerp(9), speed: lerp(15) });
      if (id === p.focus) {
        const s = this.rep;
        s.id = id;
        s.pos.copy(pos);
        s.quat.copy(quat);
        s.vel.set(lerp(12), lerp(13), lerp(14));
        const ti = b.cars[o + 10];
        s.track = ti >= 0 ? this.park.tracks[ti] : null;
        s.s = lerp(11);
        // across a circuit's start line s jumps back: take the newer value
        if (s.track && Math.abs(b.cars[o + 11] - src[oa + 11]) > s.track.length / 2) s.s = b.cars[o + 11];
        s.v = lerp(15);
        s.airborne = ti < 0;
      }
    }
    this.subject = cars.some((c) => c.id === p.focus) ? this.rep : null;
    this.view.setBlocks(k < 0.5 ? a.blocks : b.blocks);
    this.syncViews(cars);
    const sp = this.subject ? this.rep.v : 0;
    useHW.getState().set({ replay: { on: true, k: (p.t - p.t0) / Math.max(0.01, p.t1 - p.t0) }, speed: sp });
    if (useHW.getState().sound && this.subject) setRolling(sp * 0.7, this.gainAt(this.rep.pos) * 1.3);
  }

  // —————————————————————————————————————————— every frame

  update(dt: number) {
    const now = performance.now() / 1000;
    const s = useHW.getState();
    this.frame++;

    for (const g of this.gateClose.filter((x) => now >= x.at)) this.view.setGate(g.track, false);
    this.gateClose = this.gateClose.filter((x) => now < x.at);

    if (this.replaying) {
      this.updateReplay(dt);
      return;
    }

    // the power meter sweeps up and down while held; the plunger comes back with it
    const a = this.attraction;
    if (s.charging) {
      const ph = ((now - this.chargeT0) / METER) % 1;
      const c = ph < 0.5 ? ph * 2 : 2 - ph * 2;
      s.set({ charge: c });
      if (a) this.view.setPull(a.tracks[0], c);
      if (now - this.lastRatchet > 0.07 + (1 - c) * 0.06 && s.sound) {
        this.lastRatchet = now;
        playRatchet();
      }
    }
    if (a && a.id !== "drag" && a.kind !== "drop" && a.kind !== "drive" && !s.drop) this.stageFor(a);
    // left the yard: hand the car back
    if (s.driving && a?.kind !== "drive") this.stopDrive();
    else if (a?.id === "drag" && (s.race.phase === "idle" || s.race.phase === "done") && !this.sim.heldOn("drag-a")) {
      const busy = this.sim.cars.some((c) => c.track?.id === "drag-a" && !c.held && Math.abs(c.v) > 1);
      if (!busy && now - (this.lastFire.get("drag-a") ?? -10) > 1) this.sim.stage("drag-a", s.model, CAR_SPECS[s.model]);
    }
    const sweet = a ? this.sweetFor(a, s.model) : null;
    if (sweet?.[0] !== s.sweet?.[0] || sweet?.[1] !== s.sweet?.[1]) s.set({ sweet });
    this.updateRace(now);

    for (const p of this.pending.filter((x) => now >= x.at)) p.fn();
    this.pending = this.pending.filter((x) => now < x.at);

    // time: slow motion by hand, or automatically through jumps and crashes
    const want = s.slowmo ? TIME.slow : now < this.slowUntil ? TIME.slow * 1.6 : TIME.normal;
    this.timeScale += (want - this.timeScale) * Math.min(1, dt * 7);

    this.sim.update(dt, this.timeScale);
    for (const e of this.sim.events.splice(0)) this.handle(e, now);
    this.recordFrame();

    // sound beds and grit: rolling hiss from the loudest car, joint clicks, wall scrapes, the ring's fire
    let roll = 0;
    let rollGain = 0;
    for (const car of this.sim.cars) {
      if (car.mode !== "track" || car.held) continue;
      const g = this.gainAt(car.pos);
      if (Math.abs(car.v) * g > roll * rollGain) {
        roll = Math.abs(car.v);
        rollGain = g;
      }
      const j = Math.floor(car.s / TRACK.piece);
      const prev = this.joints.get(car.id);
      if (prev !== undefined && prev !== j && Math.abs(car.v) > 25 && s.sound) playJoint(Math.abs(car.v) / 450, g, this.panAt(car.pos));
      this.joints.set(car.id, j);
      // pressed hard into the outside wall: the base grinds it and throws sparks
      if (car.scrape > 3.2 && Math.abs(car.v) > 140) {
        const k = Math.min(1, (car.scrape - 3.2) / 3);
        const side = new THREE.Vector3(car.lat > 0 ? 1 : -1, -0.2, 0).applyQuaternion(car.quat);
        const at = car.pos.clone().addScaledVector(side, 1.6).addScaledVector(new THREE.Vector3(0, 1, 0).applyQuaternion(car.quat), -RIDE + 0.3);
        this.fx.scrape(at, car.vel, k);
        if (s.sound && now - this.lastScrape > 0.06) {
          this.lastScrape = now;
          playScrape(k, g, this.panAt(car.pos));
        }
      }
    }
    if (s.sound) {
      setRolling(roll, rollGain * 1.6);
      setFire(Math.min(1, 1.6 * this.gainAt(this.view.ringAt)));
    } else {
      setRolling(0, 0);
      setFire(0);
    }

    // a car that's stalled on the junction's flat circuit (knocked down to a crawl, nose to tail
    // with others) gets picked up, the way you'd lift it off the real thing
    for (const car of this.sim.cars) {
      if (car.mode !== "track" || car.track?.id !== "junction") continue;
      const t = Math.abs(car.v) < 8 ? (this.stalled.get(car.id) ?? 0) + dt : 0;
      this.stalled.set(car.id, t);
      if (t > 1.6) {
        this.stalled.delete(car.id);
        this.sim.remove(car);
        announce("Picked up a stalled car", "info", "Drop it back in when there's a gap");
      }
    }

    // —— your car ——
    // lost it somehow (it can't really leave the room, but just in case): back to the line
    if (s.driving && !this.sim.driven) this.startDrive(true);
    const d = this.sim.driven;
    if (d && s.driving) {
      this.focus = d;
      this.focusT = now;
      const up = new THREE.Vector3(0, 1, 0).applyQuaternion(d.quat);
      const fwd = new THREE.Vector3(0, 0, 1).applyQuaternion(d.quat);
      const left = new THREE.Vector3(1, 0, 0).applyQuaternion(d.quat);
      const speed = d.vel.length();
      // tyre marks and squeal while it slides (or brakes hard)
      const sliding = d.grounded && (d.slip > 45 || (this.sim.control.throttle < 0 && d.vel.dot(fwd) > 120));
      if (sliding) {
        const k = Math.min(1, Math.max(d.slip, 80) / 260);
        for (const side of [-1, 1]) {
          const at = d.pos.clone().addScaledVector(up, -RIDE).addScaledVector(left, side * 1.25).addScaledVector(fwd, d.spec.rear.z);
          this.fx.skid(`${d.id}${side}`, at, k);
        }
      }
      if (s.sound) {
        setMotor(d.mode === "track" ? d.v : d.vel.dot(fwd), this.sim.control.throttle, this.sim.boosting, true);
        setSkid(sliding ? Math.max(d.slip, 120) : 0);
      }
      // nitro flames out the back
      if (this.sim.boosting && this.frame % 2 === 0) this.fx.puff(d.pos.clone().addScaledVector(fwd, -4), 0.05);
      if (this.sim.boosting) this.shake(0.12);
      // the toys knocked down
      if (this.frame % 15 === 0) {
        const dn = this.sim.toppled("domino");
        const pn = this.sim.toppled("pin");
        const dt0 = this.sim.toyCount("domino");
        const pt0 = this.sim.toyCount("pin");
        if (dn > this.toysDown.dominoes) {
          this.score += (dn - this.toysDown.dominoes) * 20;
          if (dn >= dt0 && this.toysDown.dominoes < dt0) {
            announce("CHAIN REACTION", "gold", `all ${dt0} dominoes · +500`);
            this.score += 500;
          }
          this.fact({ k: "dominoes", n: dn, of: dt0 });
        }
        if (pn > this.toysDown.pins) {
          this.score += (pn - this.toysDown.pins) * 60;
          if (pn >= pt0 && this.toysDown.pins < pt0) {
            announce("STRIKE!", "gold", "all ten skittles · +800");
            this.score += 800;
            this.view.cheer(1.4);
            if (s.sound) playCheer(1.2);
          } else if (pn - this.toysDown.pins >= 3) announce(`${pn} SKITTLES DOWN`, "good");
          this.fact({ k: "pins", n: pn, of: pt0 });
        }
        this.toysDown = { dominoes: dn, pins: pn };
      }
      if (this.frame % 4 === 0)
        s.set({
          drive: {
            fuel: this.sim.fuel,
            nitro: this.sim.boosting,
            lap: this.lap.start >= 0 ? this.sim.clock - this.lap.start : null,
            last: this.lap.last,
            best: this.lap.best,
            next: this.lap.next,
            of: this.sim.checkpoints.length,
            score: this.score,
            dominoes: [this.toysDown.dominoes, this.sim.toyCount("domino")],
            pins: [this.toysDown.pins, this.sim.toyCount("pin")],
          },
        });
      this.view.yard.setNext(this.lap.next);
      void speed;
    } else {
      this.view.yard.setNext(-1);
      if (s.sound) setMotor(0, 0, false, false);
    }
    this.ghostFrame();

    // the followed car: still worth following while it moves
    if (this.focus) {
      if (!this.sim.cars.includes(this.focus)) this.focus = null;
      else if (this.focus.held || (this.focus.mode === "track" ? Math.abs(this.focus.v) > 2 : this.focus.still < 0.6)) this.focusT = now;
    }
    const f = this.focus;
    if (f) {
      const sb = this.live;
      sb.id = f.id;
      sb.pos.copy(f.pos);
      sb.quat.copy(f.quat);
      sb.vel.copy(f.vel);
      sb.track = f.mode === "track" ? f.track : null;
      sb.s = f.s;
      sb.v = f.mode === "track" ? f.v : f.vel.length();
      sb.airborne = f.mode === "free" && !f.grounded;
      sb.driven = f.driven;
      this.subject = sb;
    } else this.subject = null;
    const fv = f ? (f.mode === "track" ? Math.abs(f.v) : f.vel.length()) : 0;
    if (this.frame % 4 === 0) {
      const blocksDown = this.frame % 20 === 0 ? this.sim.displaced() : s.blocksDown;
      const jc = this.junctionCars();
      const junction = jc !== s.junction.cars || this.streak !== s.junction.streak ? { cars: jc, streak: this.streak } : s.junction;
      s.set({ speed: fv, g: f && f.mode === "track" ? f.g : 0, air: !!f && f.mode === "free" && !f.grounded, cars: this.sim.cars.length, blocksDown, junction });
    }
    if (this.frame % 6 === 0) this.updateDots();

    this.syncViews(this.sim.cars.map((c) => ({ id: c.id, model: c.model, pos: c.pos, quat: c.quat, roll: c.roll, speed: c.mode === "track" ? Math.abs(c.v) : c.vel.length() })));
  }

  /** Where the minimap's box sits over the park (the store holds the outlines; this places the dots). */
  setMapBox(box: { x0: number; z0: number; w: number }) {
    this.mapBox = box;
  }

  private updateDots() {
    const b = this.mapBox;
    if (!b) return;
    const dots: Dot[] = this.sim.cars
      .filter((c) => !c.held || c === this.focus)
      .map((c) => ({ x: ((c.pos.x - b.x0) / b.w) * 100, y: ((c.pos.z - b.z0) / b.w) * 100, me: c === this.focus, color: MODELS[c.model].paint.color }));
    const prev = useHW.getState().dots;
    if (dots.length === 0 && prev.length === 0) return;
    useHW.getState().set({ dots });
  }

  private syncViews(cars: { id: number; model: number; pos: THREE.Vector3; quat: THREE.Quaternion; roll: number; speed: number }[]) {
    const alive = new Set<number>();
    const cam = this.camera.position;
    for (const car of cars) {
      alive.add(car.id);
      let v = this.views.get(car.id);
      if (!v || v.model !== car.model) {
        if (v) this.root.remove(v.root);
        const root = this.protos[car.model].root.clone(true);
        const wheels: THREE.Object3D[] = [];
        root.traverse((o) => {
          if (o.userData.wheel) wheels.push(o);
        });
        v = { root, wheels, model: car.model };
        this.views.set(car.id, v);
        this.root.add(root);
      }
      v.root.position.copy(car.pos);
      v.root.quaternion.copy(car.quat);
      // each wheel turns through the distance rolled over its own radius
      for (const w of v.wheels) w.rotation.x = car.roll / (w.userData.r as number);
      if (car.speed > 200) this.fx.trail(car.id, car.pos, car.speed, cam, this.frame);
    }
    for (const [id, v] of this.views)
      if (!alive.has(id)) {
        this.root.remove(v.root);
        this.views.delete(id);
        this.joints.delete(id);
        this.stalled.delete(id);
      }
  }

  setNight(k: number) {
    this.mats.head.emissiveIntensity = 0.4 + k * 9;
    this.mats.tail.emissiveIntensity = 0.25 + k * 4;
  }

  dispose() {
    for (const p of this.protos) p.dispose();
    for (const m of Object.values(this.mats)) (m as { dispose?: () => void }).dispose?.();
  }
}
