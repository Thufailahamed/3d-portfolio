/**
 * Per-frame values shared between DOM (GSAP/scroll) and WebGL (useFrame).
 * Plain mutable object on purpose: writing to it never triggers React renders.
 */
export const sceneState = {
  /** master journey progress 0..1 (already smoothed by Lenis) */
  p: 0,
  /** normalised pointer, -1..1 */
  mouse: { x: 0, y: 0 },
  /** 0 → 1 as the visitor clicks Enter */
  intro: 0,
  /** 0 → 1 while the camera dives into the prism before opening a project */
  dive: 0,
  /** live horizontal drag on the projects carousel, roughly -1..1 */
  drag: 0,
  /** screen-space positions (px) of 3D points the About HUD pins its notes to */
  anchors: [0, 1, 2].map(() => ({ x: 0, y: 0, visible: false })),
};
