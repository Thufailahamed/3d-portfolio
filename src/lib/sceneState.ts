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
  /**
   * The projects crystal: its centre on screen (px), whether the pointer is over it,
   * and a picker for taps (normalised device coords → hit?). Set by the scene.
   */
  crystal: { x: 0, y: 0, hover: false, pick: (() => false) as (x: number, y: number) => boolean },
  /** live horizontal drag on the projects carousel, roughly -1..1 */
  drag: 0,
  /** About sequence clock in reference seconds, softly damped behind the scroll (see aboutTimeline) */
  aboutSec: 0,
  /** the About globe on screen (px) and whether it can be grabbed */
  globe: { x: 0, y: 0, r: 0, grabbable: false },
  /** pointer drag on the globe, accumulated by the DOM and consumed by the scene each frame */
  globeDrag: { dx: 0, dy: 0, dragging: false },
  /** city markers on the globe, projected to screen (px); facing 0 = edge-on/hidden … 1 = facing us */
  markers: [] as { x: number; y: number; facing: number }[],
  /**
   * The investigation board: whether it owns the camera, where the camera wants to be,
   * the card under the pointer, and a picker for clicks (normalised device coords → card or -1).
   */
  board: {
    active: false,
    pos: [0, 0, 0] as [number, number, number],
    look: [0, 0, 0] as [number, number, number],
    hover: -1,
    /** a card named from the DOM index (hovered or focused there) */
    hint: -1,
    /** phones: how far along the board the visitor has swiped, -1 (left edge) … 1 (right edge) */
    pan: 0,
    pick: (() => -1) as (x: number, y: number) => number,
  },
};
