# Cars: Compare and Crash Lab — Design

Date: 2026-10-20
Status: approved by request ("make car compare feature and car collision simulation in cars section …
very good, very detailed, very realistic — implement it")

## Intent

The `/cars` showroom gains two sister modes that share its line-up of seven real GLB cars:

- **Compare** (`/cars/compare?a=<slug>&b=<slug>`): two cars side by side in the showroom studio at true
  scale, a ghost overlay and an orthographic blueprint view so size differences are exact, a full
  spec sheet with sourced figures, and a physics-based performance model (0–100, quarter mile, top
  speed, braking) that ends in a 3D standing-start drag race on an airfield runway.
- **Crash lab** (`/cars/crash?…`): a crash-test facility where any car can be run into a rigid wall,
  an offset deformable barrier, a pole, a mobile barrier or any other car, at any speed and angle.
  A deterministic crush-zone solver computes the impact at 0.1 ms resolution; the real models
  crumple according to the computed crush, glass breaks, lamps shatter, debris scatters, airbags fire
  where the car has them, a crash dummy is thrown into its belts, and the event replays in
  high-speed-camera slow motion with the measurements a test lab would publish (crash pulse, Δv,
  crush, intrusion, OLC, HIC15, chest 3 ms).

"Realistic" is held to the same standard as the site's other showpieces (`/diffusion`, `/voice`): the
physics is real and checked by scripts, every figure is either published (with its source) or
labelled as an estimate, and anything procedural (the shape of the folds, the debris) is said to be
procedural. Nothing imitates a real test organisation: the lab is the site's own ("Impact Lab"),
with no Euro NCAP / IIHS / NHTSA names or logos on screen; protocols are described generically
("full-width rigid barrier, 56 km/h") and cited only in the method sheet.

## Section navigation

- A pill switch, `CarsNav` (`src/components/showroom/CarsNav.tsx`): **Showroom · Compare · Crash lab**,
  top centre (below the site header on phones). It carries the current car across: showroom
  `?car=f40` → compare `?a=f40`, crash `?a=f40`.
- Rendered by `CarsView` (showroom), `CompareView` and `CrashView`. Plain `next/link` links.
- Header chrome stays as it is on all three (the `/cars` paths are not in Header's `onFlow` list).

## Shared data: `src/content/carSpecs.ts`

Structured, numeric specs for each slug in `src/content/cars.ts`, from the research pass (published
figures with source URLs; estimates flagged `est: true` with a reason). One record per car:

```ts
export type Fig = { v: number; src?: string; est?: boolean; note?: string };
export type CarSpecs = {
  slug: string;
  mass: Fig; massKind: "kerb" | "dry" | "race minimum";
  length: Fig; width: Fig; height: Fig; wheelbase: Fig; trackF: Fig; trackR: Fig; clearance?: Fig;
  weightFront: Fig;                 // fraction on the front axle
  cgHeight: Fig;                    // m, almost always an estimate
  engine: { layout: "front" | "front-mid" | "mid"; config: string; cc: Fig; cylinders: number; aspiration: string;
            kw: Fig; ps: Fig; powerRpm: Fig; nm: Fig; torqueRpm: Fig; redline: Fig };
  gearbox: { kind: "manual" | "sequential" | "dct" | "automatic"; gears: number; ratios: Fig[]; final: Fig; shiftS: Fig };
  drive: "RWD" | "AWD" | "4WD";
  tyres: { front: string; rear: string; radius: Fig; mu: Fig };
  aero: { cd: Fig; area: Fig; downforce?: string };
  published: { zeroTo100?: Fig; zeroTo60mph?: Fig; quarter?: Fig; topSpeed?: Fig; braking100?: Fig };
  structure: { archetype: ArchetypeId; chassis: string; body: string; airbags: number | null; abs: boolean | null;
               restraint: "belt+airbag" | "belt" | "harness" | "lap" | "none" };
  production: string; units?: Fig; price?: string;
};
```

The showroom's `facts` strings stay as they are; the new pages read `carSpecs`. Where research shows a
showroom string is wrong (e.g. the XJ13 length) it is corrected in `cars.ts` too.

## Compare

### Layout

- Full-screen studio (the showroom's `Stage` and `Post`, exported from `ShowroomScene.tsx`), the two
  cars on the floor side by side, noses toward the hero camera, spaced by their widths plus 1.4 m.
- Top: `CarsNav`. Under each car, in the 3D scene, its slot label ("A · Ferrari F40 · 1987"); a
  picker per slot (the showroom's rail style) and a swap button.
- View modes (segmented control, keys 1–4): **Side by side**, **Overlay**, **Blueprint**, **Race**.
- Bottom sheet, collapsed to a headline duel (power, 0–100, top speed, weight, power-to-weight) with
  mirrored bars; expanded (drag or click) to the full sheet: grouped rows, charts and notes.
- "Crash these two" opens `/cars/crash?a=…&b=…&test=headon`.

### Modes

- **Side by side**: orbit; hovering a car lifts its label; lamps toggle (L) for both.
- **Overlay**: both cars at one spot, aligned by front axle (or rear axle, nose, centre — chips); A
  drawn normally, B as a ghost (Fresnel rim, faint fill, depth-tested so it reads as a volume).
  Dimension readouts show each delta (+212 mm longer, −38 mm lower …).
- **Blueprint**: orthographic side / front / top elevations, both silhouettes flat-shaded in two
  inks over a drafting grid, dimension lines with values and deltas, axle marks, ground line.
- **Race**: a quarter-mile standing start on an airfield runway (below).

### Spec sheet rows

Grouped; a winner is marked only where "better" is unambiguous (more power, less mass, quicker
times); dimensions show signed deltas without a winner. Every value shows its source on hover or
focus; estimates carry "≈" and the reason.

- Performance: power (PS / kW), torque, power-to-weight (PS/t), specific output (PS/L), 0–100
  (published, and simulated), 0–200 (simulated), quarter mile (simulated, with trap speed), top
  speed (published, and the model's drag-limited figure), 100–0 braking (estimated).
- Engine and drivetrain: layout, configuration, displacement, aspiration, redline, gearbox, drive.
- Dimensions and mass: length, width, height, wheelbase, tracks, clearance, mass (kind), weight
  distribution.
- Structure and safety: chassis, body, airbags, ABS, restraint — and a "crash compatibility" line
  (mass ratio and bumper-height mismatch, linking to the crash lab).
- Production: years, units, price new.

Charts (SVG, both cars in their slot colours): speed vs time with gear-change ticks; power and
torque vs rpm (modelled from the published peaks, labelled so); distance vs time.

### Performance model (`src/compare/perf.ts`, pure TS)

Longitudinal, 1 ms steps, per car:

- Torque curve from the published peaks: a smooth curve through idle, the peak-torque point (a
  plateau for turbo engines), the peak-power point (T = P/ω there) and the redline.
- Wheel force `F = T(rpm)·i_g·i_f·η / r`; rpm from road speed, held at a launch rpm while the clutch
  slips; shift at the rpm that maximises wheel force in the next gear (or redline), with a torque
  cut for the gearbox's shift time (manual ≈0.35 s, sequential ≈0.08 s, DCT ≈0.05 s, auto ≈0.15 s).
- Traction limit `μ·N_driven` with longitudinal load transfer `m·a·h/L` (RWD rear axle; AWD/4WD both),
  plus downforce where published.
- Resistances: `½ρ·Cd·A·v²`, rolling `Crr·m·g`; effective mass `m(1 + 0.04 + 0.0025·(i_g i_f)²)`.
- Outputs: v(t), x(t), gear(t), rpm(t), a(t); 0–60 mph, 0–100, 0–200 km/h, 60 ft, 1/8 and 1/4 mile
  times and trap speeds, drag-limited top speed. Braking 100–0 from `v²/(2·μ_b·g)` with μ_b by tyre.
- The sheet shows simulated next to published figures; inputs that were estimated (gear ratios,
  CdA, μ) are listed in the method note. Target: simulated 0–100 within ~10% of the published
  figure where one exists (checked by `scripts/compare/check.mjs`).

### Race mode (airfield runway)

- A daylight airfield: concrete runway slabs with joints and tyre rubber, edge and centre markings,
  a painted start line and quarter-mile finish with timing gantries, distance boards (60 ft, 330 ft,
  1/8, 1000 ft, 1/4), grass verges, a tree line and hangars on the horizon, the showroom's sky dome.
- Christmas-tree start lights; both cars run from the precomputed traces (x(t) per car, real time):
  wheels turn at road speed, the body squats with acceleration and pitches on shifts, brake lights
  at the end. Cameras: tracking car ahead looking back (default), side tracking, drone, finish line.
- Time slips at the finish (reaction 0, 60 ft, 330 ft, 1/8, 1/4, trap speed), and the synthesised
  engine notes for both cars (the showroom's `engineSound`, given an rpm API).

## Crash lab

### Tests

Generic names; protocol numbers from the research pass (cited only in the method sheet).

| id | Test | Default |
|----|------|---------|
| `wall` | Full-width rigid barrier | 56 km/h |
| `odb` | Offset deformable barrier, 40% overlap (aluminium honeycomb face) | 64 km/h |
| `small` | Small overlap rigid barrier, 25%, rounded edge | 64 km/h |
| `pole` | Oblique side pole, 75°, 254 mm pole at the driver's head | 32 km/h |
| `mdb` | Side impact by a mobile deformable barrier (1,400 kg), driver side | 60 km/h |
| `headon` | Car to car, full overlap | 50 + 50 km/h |
| `offset` | Car to car, 50% overlap | 50 + 50 km/h |
| `tbone` | Car A's front into car B's driver side, 90° | 50 / 0 km/h |
| `rear` | Car A into the back of car B | 50 / 0 km/h |
| `oblique` | Intersection, 45° | 50 / 30 km/h |

Controls: car A, car B (cars only for car-to-car tests), each speed, overlap %, angle, impact point
along the side (side tests), brakes after impact (free rolling / locked), and Run. The URL carries
all of it (`?test=tbone&a=…&b=…&va=50&vb=0&overlap=…&angle=…`).

### The solver (`src/crash/sim`, pure TS, runs in a Web Worker)

A deterministic 2.5-D crush-zone model, in the lineage of the CRASH3 force-crush model used in
accident reconstruction, extended to resolve the structure by height and around the outline:

**Bodies.** Each car (or barrier, pole, trolley) is a rigid body in the ground plane (x, z, yaw)
with mass `m`, yaw inertia `Iz` (Garrott-style estimate `≈0.1478·m·WB·L` unless better known), CG
from the weight distribution and CG height. A half-car pitch model and a half-car roll model
(springs 1.3–1.6 Hz, damping ≈0.35, tyres that can lift off) carry nose dive, rear lift in frontal
impacts, roll in side impacts and the wheel loads the tyre model needs.

**Outline.** The plan rectangle `Plan {hx, hz, rc, cx, cz}` (rounded rectangle) is the reference
for everything: perimeter parameter `u ∈ [0,1)` starting at the nose centre and running toward +z
(see `geometry.ts`, mirrored in GLSL). For `NB = 10` height bands (car-frame y edges `0.05, 0.20,
0.35, 0.50, 0.65, 0.80, 0.95, 1.10, 1.30, 1.55, 1.90 m`) and `NS = 192` samples per band, `e[b][i]`
is the inward distance from the plan rectangle to the car's real surface, measured off the GLB by
`scripts/crash/outlines.mjs` (outermost vertex per bin, so the F40's pointed nose and the Land
Cruiser's flat face are both real). `e = NO_SURFACE (9)` where the car has nothing at that height.

**Structure.** A crush-strength field built from the car's real part positions (part boxes from
the same script) and an archetype per construction:

- zones (car-frame boxes with soft edges): bumper, crash boxes/rails (or ladder frame horns),
  engine and gearbox block (Part_engine box: near-rigid), wheels and suspension (Part_wheel boxes),
  cabin safety cell (seats + dashboard boxes, grown to the pillars), sills, doors with side beams,
  pillars, roof rails, greenhouse, background trim;
- each zone has a crush strength σ (Pa, the pressure a face of it resists while crushing) and a
  compaction factor η (how much of its length turns into crush: ≈0.7 for steel rails, ≈0.85 for
  carbon crush tubes that fragment, ≈0.05 for an engine block that cannot fold);
- a sample crushes along its inward normal; its consumed depth `L` advances by `dc/η(L)`, so the
  resisting pressure at crush `c` is `σ(P_surface + n·L(c))`: rails, then the engine block, then
  the firewall — which is what gives a real crash pulse its shape;
- archetypes (strength tables per zone kind, calibrated so a generic 1,500 kg steel car into a rigid
  wall at 56 km/h lands in published NCAP ranges: mean ≈20–25 g, peak ≈35–50 g, dynamic crush
  ≈0.55–0.75 m, pulse ≈70–110 ms, restitution ≈0.1–0.2): `carbonMonocoque` (Lykan, Vulcan),
  `prototype1960s` (XJ13: aluminium, no designed crush zone), `ladderFrameSuv` (Land Cruiser: frame
  rails at its own height, 2.5 t), `steelSpaceframeComposite` (F40, F40 LB), `gtRaceCar` (Supra
  GT300: production shell, roll cage, race seat).

**Contact.** For each body pair and each band, the samples of one body (the master) are tested
against the other body's deformed outline (barriers and poles analytically). A sample's interface
is two elastic–plastic springs in series: elastic stiffness `k_e` per area on each side, yield
`σ_A(c_A)` and `σ_B(c_B)`; while the trial force exceeds the weaker yield, that side crushes
(plastic, permanent), so the softer structure takes the crush and the force is equal on both sides.
Unloading is elastic, so a little stored energy springs the bodies apart: restitution emerges
(target ≈0.1–0.2 against a wall). Tangential force: interface friction μ ≈0.5 (crushed sheet metal
snags), regularised. Forces act at the sample points: yaw, spin-outs and offset-crash rotation come
out of the impulse. Bumper-height mismatch comes out of the bands (an SUV's frame at 0.5–0.7 m meets
a low car's hood, not its rails).

**Tyres and run-out.** Free-rolling or locked wheels, a linear-then-saturating lateral force with a
friction circle, μ ≈0.8 on the hall's concrete, rolling resistance, load from the pitch/roll model;
a wheel whose zone is crushed jams (sliding friction, no steer). The run continues until both bodies
are at rest (or 8 s).

**Time.** 1 ms steps outside contact, 0.1 ms in contact (and within 0.3 m of it); recorded at 0.5 ms
in contact and 1/240 s otherwise; crush snapshots every 0.5 ms in contact. Seeded randomness only.

**Occupant.** A two-mass driver (torso pivoting at the H-point, head on a neck spring) in the car's
frame, loaded by the seat-position acceleration, held by its restraint (belt with slack, load
limiter; harness; or none), an airbag where the car has one (fires when the predicted Δv crosses the
threshold, inflates in ≈30 ms, vents), the steering wheel and door as contact surfaces (door intrusion
from the crush field in side impacts). Outputs head and chest acceleration, HIC15, chest 3 ms clip,
head excursion, belt load, contacts.

**Metrics** (CFC 60 filtered vehicle accelerations, SAE J211 Butterworth): Δv, peak and mean
deceleration, pulse duration, OLC (65 mm free flight, 235 mm restraint), max dynamic and residual
crush, cabin intrusion (footwell, dash / A-pillar, door), energy absorbed per body, restitution,
rest positions; momentum and energy balance (`KE₀ = KE + E_crush,A + E_crush,B + E_friction + E_elastic`,
reported with its error, which must stay < 0.5%).

**Events** for the scene: first contact (T0), glass (windscreen cracks, side and rear glass
shatters, with time and origin), lamps broken, airbag fired, wheel jammed, separation, rest; debris
spawns with initial state; skid marks.

**Debris** is precomputed too (seeded, ballistic with floor bounce, friction and settling), so
scrubbing back and forth shows exactly the same scatter: tempered glass cubes, lamp shards (clear,
amber, red), bumper and grille plastic, carbon splinters for composite cars, paint flecks, sparks
where metal scrapes, dust and airbag powder puffs, coolant drops where the radiator is crushed (pink
for the Toyota).

### Contracts (`src/crash/sim/types.ts`)

`Timeline` (worker → page, transferable typed arrays): frame times (T0 = 0 at first contact), per
body pose/velocity/acceleration/wheel/rigid-part tracks, crush snapshots (`NB × NS × {C, L, D}` per
snapshot: surface crush, consumed depth, damage), events, debris tracks, skid segments, occupant
tracks and the metrics. The scene and the HUD only ever read a `Timeline`; a `mockTimeline()` lets
them be built before the solver is finished.

### Rendering

**The hall** (`scene/Hall.tsx`): a dark test hall whose impact zone is lit like a stage by a canopy
of high-intensity light panels (they power up in sequence before the run, as the lamps of a real
high-speed set are switched on only for the test); polished concrete with a painted 0.5 m
photogrammetry grid and distance marks along the approach; the tow-rail slot down the centre line;
the barrier block (massive concrete, steel face plate with a load-cell grid, hazard-striped edges),
the honeycomb face, the pole on its base, the trolley; camera tripods, light stands and an
overhead camera gantry. Identity: concrete greys, cold white light, safety yellow (#ffc400) used
sparingly — markers, hazard stripes and the key readouts. Not lime.

**Cars** (`scene/CrashCar.tsx`, `scene/deform.ts`): each instance is a deep clone of the cached GLB
with its own materials (rest transforms restored from `userData.home`/`baseQ`), finished like the
showroom (clearcoat paint with flake). Photogrammetry targets (yellow/black quadrant circles) on the
roof, doors, bonnet and boot are drawn by the paint shader. Deformation is in the vertex shader of
every non-rigid material, from a per-car `NS × NB` half-float texture (R: surface offset `e`, G:
crush `C`, B: consumed depth `L`, A: damage), updated from the timeline each frame:

- vertex → `(u, d_rr)` by the rounded-rectangle projection; band coordinate from y;
- depth below the real surface `d = d_rr − e`; inside the consumed layer (`d < L`) the vertex moves
  inward by `C·(1 − d/L)` — material in front of the crush front compacts, behind it nothing moves;
- folds: sheet buckling along the vertex normal inside the consumed layer, wavelength ≈6–9 cm,
  amplitude from the compaction ratio, phase broken by noise (aluminium tears, carbon fractures:
  jagged displacement and fragment holes via discard instead of smooth folds);
- bulge: panels just behind the crush front push outward a little; the bonnet tents up (inverted V
  at its crease) by the length it lost, the boot lid likewise;
- normals by finite differences of the same displacement; the same code in a custom depth
  material so shadows match;
- the paint scuffs to primer and bare metal where damaged; dirt in the folds.

Rigid parts move as wholes from the timeline: the engine is shoved back once the crush front reaches
it, wheels are pushed back / in and turned, the steering column rises with footwell intrusion.

**Glass** (`scene/glass.ts`): the windscreen cracks (laminated: spider-web from the origin, it
stays in), side and rear glass (tempered) vanish into cubes; by region of the car frame, from events.

**Debris, sparks, dust** (`scene/Debris.tsx`): instanced meshes reading the precomputed tracks;
sparks as short additive streaks; dust as soft lit sprites. **Skid marks** as floor decals.

**Dummy and airbags** (`scene/Dummy.tsx`): a seated 50th-percentile dummy built from shaped
primitives (pale yellow with black/yellow head and shoulder targets), posed at the driver's seat of
each car (found from the steering wheel), animated from the occupant track; a driver airbag
(and side curtain in side impacts) inflating from its hub, venting after.

**Cameras** (`scene/Director.tsx`): Overhead (high-speed, straight down), Side (long lens at bumper
height), Front ¾ (low, wide), Onboard (fixed to car A's cabin, looking at the dummy), Chase, Free
orbit, and a Director cut that replays the impact from three angles.

### Playback and HUD (`src/crash/ui`)

- Sequence: setup → Run → computing (worker) while the hall's lights power up and a countdown runs
  → approach in real time → slow motion ramps in 20 ms before T0 (1/40 by default, like a
  1,000 fps film) → ramps out after separation → run-out at 1/4 then real time → results.
- Transport: play/pause (space), scrub, speed chips (1×, 1/4, 1/10, 1/40), ±1 ms frame steps (, .),
  camera chips (1–6), replay.
- High-speed film overlay: `T +043.5 ms`, frame number at 1,000 fps, camera name, a time-base bar.
- Results: per car Δv, peak / mean g, OLC, dynamic / residual crush, intrusion, energy, rest
  position; occupant HIC15, chest 3 ms, head excursion with a five-step colour scale (good → poor,
  generic thresholds, stated); charts — crash pulse (both cars, CFC 60), velocity, force vs crush with
  the absorbed energy shaded, energy balance bar; the momentum and energy checks.
- Method sheet: what is published, what is estimated, what is procedural, references.
- Sound (`ui/sound.ts`, synthesised): hall lights clunk on, countdown beeps, tyre roll, the impact
  (low thud + metal crush + plastic cracks + glass), airbag bang, debris tinkle, skids, coolant hiss;
  pitched down in slow motion.

## File ownership (for the parallel build)

- Integration (lead): `CarsNav.tsx`, `src/app/cars/{compare,crash}/page.tsx`, `CarsView.tsx` nav slot,
  `ShowroomScene.tsx` exports (`Stage`, `Post`, `SkyDome`, `seeded`, `floorNoise`, `addLivery`, `Rig`),
  `eslint.config.mjs`, `src/content/carSpecs.ts`, `src/crash/sim/{types,geometry}.ts`,
  `src/components/showroom/carModel.ts`.
- Solver: `src/crash/sim/*` (except types/geometry), `src/crash/worker.ts`, `scripts/crash/check.mjs`.
- Outlines: `scripts/crash/outlines.mjs` → `src/crash/data/outlines.ts`.
- Hall and cameras: `src/crash/scene/{Hall,Director,CrashScene}.tsx`.
- Car deformation, glass, debris, dummy: `src/crash/scene/{CrashCar,Debris,Dummy}.tsx`,
  `src/crash/scene/{deform,glass}.ts`.
- Crash UI: `src/crash/ui/*`, `src/crash/CrashView.tsx`.
- Compare: `src/compare/*`, `scripts/compare/check.mjs`.

## Verification

- `scripts/crash/check.mjs` (Node, transpiles the real modules like `scripts/voice/ts.mjs`): the
  reference car into a rigid wall at 56 km/h within the NCAP ranges above; every line-up car into the
  wall (sane crush, no NaN, rest reached); car-to-car momentum conserved within 1% over the contact;
  energy balance error < 0.5%; determinism (two runs identical); stability across dt halving
  (metrics within 2%); OLC and HIC on known pulses (half-sine reference values).
- `scripts/compare/check.mjs`: simulated vs published 0–100 / top speed per car.
- Headless Chrome on the GPU (`scratchpad/shot.mjs`): each mode and test screenshotted and looked at;
  `tsc --noEmit`, `eslint`, `next build`.
