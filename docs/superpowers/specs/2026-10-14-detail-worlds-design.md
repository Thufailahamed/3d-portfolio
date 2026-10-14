# Per-Project Detail Worlds — Design

Date: 2026-10-14
Status: awaiting approval (do not build yet)

## Intent and why

Today only the intro has its own 3D world (ruined arch + night forest, `art/build_intro.py` → `public/models/forest.glb`). All six project detail pages (`/projects/[slug]`) share one smoky shader backdrop (`DetailBackdrop.tsx`) retinted per project, plus a blurred cover image in the hero.

Goal: each project gets its own distinct Blender hero world on its detail page, built the same reproducible way as the intro. Different silhouette and story per project, same site feel via tint accents and framing.

My calls (not yet agreed, need your ok):
- Placement: full-bleed 3D behind the hero title, fading out as you scroll to the product frame. Keeps current DOM and reading flow untouched.
- Pilot first: build `school-system` end-to-end to lock look, size, and loading, then batch the other five.

## Goals

- Six recognisable dioramas, one per slug in `src/content/site.ts`:
  - `school-system` (#c8ff3d): open courtyard, 6 small pavilions around one yard — six portals, one login.
  - `legal-workspace` (#e8c27a): quiet archive tower with 3–5 floating pages orbiting — filings that file themselves.
  - `luxe` (#d18cff): draped fabric torus on a pedestal — storefront + app on one ledger.
  - `goldos` (#ffb347): vault ingot stack with a thin karat ring floating above — showroom, vault, workshop.
  - `vyro` (#7aa8ff): three container blocks bridged by a conveyor arc — direct from mill to buyer.
  - `healthhub` (#6ff0c8): soft capsule with a pulse ring — one private record, three languages.
- Same recipe as intro: procedural seeded Blender Python, Cycles bake to vertex colors, one baked material at runtime via existing `makeBakedMaterial`, Draco GLB.
- Consistent framing so text layout works for all: diorama ~3–4 m wide centred at origin, detail camera fixed at approx [0, 1.6, 7] looking at [0, 1.2, 0], slow drift + mouse parallax, `prefers-reduced-motion` disables motion.
- Text stays legible: dark worlds, front wash gradient already in `ProjectDetail.tsx` kept, 3D opacity fades on scroll.

## Non-goals

- No change to journey carousel crystal (`Projects.tsx`), no change to case-study DOM sections, no new scroll behaviour, no video backgrounds.
- No new copy or covers; tints in `site.ts` stay as specified.

## Anti-goals

- Failure even if it renders: pages over ~1.5 MB added GLB each, jank on mobile, inconsistent camera per project breaking hero layout, or title unreadable over a bright world.

## Constraints

- Stack: Blender headless (`/Applications/Blender.app/Contents/MacOS/Blender -b`), Next.js 16, react-three-fiber 9, three 0.186, existing `Experience.tsx` persistent canvas with `mode: journey | detail` in `src/store/useApp.ts`.
- Pipeline reuse: `art/build_intro.py` + `art/export_intro.py` pattern (BAKE_SCALE 4.0, vertex-color bake, `export_draco_mesh_compression_enable`). New scripts: `art/build_detail_<slug>.py` → `public/models/detail-<slug>.glb`.
- Budgets per world: <100k verts pre-decimate, <1.5 MB GLB Draco, <512px equivalent textures (prefer vertex colors only, no image textures).
- Runtime: new `src/experience/chapters/DetailWorlds.tsx` mounted in `Experience.tsx` only when `mode === "detail"`. Reads `detailSlug` from `useApp`, lazy `useGLTF` per slug with preload of neighbour slugs, dispose on switch. Keep `DetailBackdrop` at reduced opacity behind for transition. Respect `lite` (DOM-only, no WebGL), `quality === low`, `isMobile` (halve particles, no volumetrics on mobile).
- SEO/LCP: keep cover `<Image priority>` in hero as fallback; 3D fades in after `ready`.

## Parts decided (how)

- Blender: Z-up, ground at y=0, hero mass centred near [0, 1.2, 0], dark base materials (albedo <0.2), one warm key + one tint point light before bake, EEVEE preview + Cycles vertex bake.
- Runtime lighting: baked vertex colors only + fog (`palette.bg`) + one live tint point light for pulse; no new postFX.
- Transition: curtain reveal already in `ProjectDetail` stays; world `uOpacity`/group opacity 0→1 over ~0.9 s, hero scrolls like today's `.pd-hero-img` parallax then fades by product frame.
- Files: `art/build_detail_<slug>.py` (6), `src/experience/chapters/DetailWorlds.tsx`, small edit to `Experience.tsx` to mount it, preload map in `DetailWorlds`.

## Left to the builder

- Exact Blender proportions, seed values, decimate ratios per world to hit budgets.
- Exact fade distances, drift amplitudes, and whether volumetrics stay for pilot only.
- Loading shimmer vs. instant cover fallback timing.
- CameraRig detail branch values (fixed vs. slight push-in on enter).

## Builder check (2026-10-14) — calls made

- DetailBackdrop: transient only. Fades out once world is `ready`, unmounted after. My call — avoids paying shader + diorama cost together on mobile.
- Direct load vs client nav: follow existing `ExperienceGate` / `mode` pattern, hard-dispose previous slug on switch with 0.9 s fade-in, no crossfade of two worlds. My call.
- Fallback: `lite` → don't mount `DetailWorlds` at all (cover + wash only). `low`/mobile → mount degraded (no volumetrics, halved particles). My call.
- Preload: prev/next slug only, desktop + high quality + idle. My call.
- Scripts: one parameterized `art/build_detail.py --slug <slug>` + per-slug config, not six copies. Outputs same six `detail-<slug>.glb`. My call.
- Legibility: centre mass offset slightly below title safe-area, luminance capped, wash kept. Builder to verify per pilot render. My call.

## What's missing / needs you

- Approve placement (full-bleed fading hero) and pilot (`school-system` first)?
- Ok with six `detail-<slug>.glb` files in `public/models/` from one parameterized script?
