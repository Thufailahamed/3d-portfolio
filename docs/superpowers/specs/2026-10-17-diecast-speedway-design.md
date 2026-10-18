# Die-Cast Speedway (`/hotwheels`) — Design

Date: 2026-10-17
Status: approved by request ("plan it, then build it")

## Intent

A Hot Wheels–style toy theme park on a playroom floor: orange track, spring launchers, motorised
boosters, loops, jumps, a drag strip and a spiral tower, with 1:64 die-cast cars you launch and
watch fly, crash and knock things over. It should read as *real toys photographed with a macro lens*
— glossy plastic, candy-metallic paint, chrome wheels, warm window light, contact shadows and a
shallow depth of field — and it should be fun for minutes, not seconds.

Original branding only: the park is "Die-Cast Speedway". No Mattel logos, flame logo or car designs
are reproduced; the orange track and launcher/booster mechanics are generic toy-track archetypes.

## Scale and units

- 1 world unit = 1 cm. Cars are 1:64 (≈7.6 cm long), track bed ≈4 cm wide with 0.8 cm walls.
- Real gravity (981 cm/s²) with a global time scale (0.7 by default, 0.18 in slow-mo) so motion
  reads like a toy commercial shot at high frame rate.
- Rapier `lengthUnit` tuned for centimetre-sized bodies; masses in grams (car ≈35 g, block ≈30 g).

## Park layout (stops for the camera)

| # | Attraction | What happens |
|---|-----------|--------------|
| 0 | **Overview** | Aerial view of the whole park, bunting and banners. |
| 1 | **Mega Loop** | Spring launcher → loop (R 15) → banked 180° → booster → second loop → finish arch → catch bin. Too little power and the car falls out of the loop; too much and it flies off the curve. |
| 2 | **Sky Jump** | Gate release at the top of a 75 cm tower → drop → booster → kicker → jump a gap through a **ring of fire** → landing ramp → off the end into a castle of wooden alphabet blocks. |
| 3 | **Drag Strip** | Two lanes, launchers, a start-light "tree". Charge during the countdown, release on green. A rival car races you; jump the start and you're disqualified. Photo-finish result. |
| 4 | **Cyclone Tower** | Gravity start at the top of a tower; banked helix descends 2 turns around it, into a wave section (cars get air on the crests when fast) and a finish. |

## Track architecture

- **Turtle builder** (`track.ts`): each track is a sequence of pieces — `straight`, `turn`
  (radius, angle, bank, optional rise for helices), `pitch` (vertical curves: drops, kickers,
  crests), `loop` (360° with lateral offset). It integrates a frame (yaw, pitch, roll) every 0.5 cm,
  so every sample has an exact position, tangent, surface normal and side vector. Curvature is
  derived from the samples for the physics.
- **Geometry**: the classic track cross-section (bed + two rounded walls + underside lip) swept along
  the samples, with UVs in centimetres; connector tabs every 30 cm; support pillars where the track
  is off the floor.
- **Physics** (`sim.ts`), hybrid:
  - *On track*: 1-D dynamics along arc length — gravity along the tangent, rolling resistance,
    air drag, wall scrub in curves, boosters, gates and buffers. The normal force is computed from
    curvature every step: if it goes negative the car leaves the surface (loop tops, crests); if the
    side load beats the walls, it jumps the rail. On-track cars are kinematic Rapier bodies, so they
    still shove things.
  - *Free*: Rapier dynamic bodies with CCD, colliding with the floor, track trimeshes, supports,
    props, blocks and each other.
  - *Capture*: a free car that lands upright on a track surface, moving roughly along it, is picked
    back up (landing bounce, sparks, sound). That's how jumps work — no scripted paths.
- **Events** drive the HUD and audio: launch, boost, loop, air (with time), ring of fire, landing,
  wipeout, block hits, finish (with time), drag result.

## Cars

Six procedural die-casts (lofted bodies from side/plan profiles, separate greenhouse, painted roof,
spoilers/blowers/exhausts per model), each with a livery texture (stripes, flames, numbers):
muscle, wedge supercar, hot rod, rally hatch, GT racer, pickup. Candy-metallic clearcoat paint with
a metal-flake normal map, chrome 5-spoke wheels, tinted glass, emissive lamps, zamac base.

## Interaction

- Garage strip of blister-pack cards to pick the car (1–6).
- Hold **Space** / the Launch button to charge, release to fire (power meter). Drops and gates
  just release.
- **Drop mode**: click anywhere to drop the selected car from above — it may land on a track and
  ride it.
- Camera: fly between attractions (scroll / arrows / tabs), drag to orbit, **C** chase cam that
  follows the latest car, **S** slow-mo, auto slow-mo on big air.
- **L** night mode: glow-in-the-dark track edges, headlights, string lights.
- **R** resets cars and rebuilds the block castle. "Launch all" sets every attraction going.
- Records per attraction (best time, longest air, top scale speed) and a stunt feed.

## Rendering

Wood floor (procedural planks), play rug, a soft wall far behind; warm directional "window" light
with soft shadows + room environment for reflections; N8AO, depth of field (tilt-shift macro look),
bloom (headlights, flames, boosters, night), AgX tone mapping, vignette, SMAA. Quality tiers step
down automatically on slow GPUs (same approach as `/lego`).

## Files

`src/hotwheels/` — `units.ts`, `track.ts`, `park.ts`, `textures.ts`, `car.ts`, `props.ts`, `fx.ts`,
`sim.ts`, `sound.ts`, `store.ts`, `Scene.tsx`, `View.tsx`; route `src/app/hotwheels/page.tsx`;
menu link in `Header.tsx`; `ExperienceGate.tsx` skips the journey canvas there.

## Non-goals

No external assets or audio files (all procedural/synthesised), no multiplayer, no saving beyond
`localStorage` records.
