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
  /**
   * The contact arch as a gate to the multiverse: the camera's push into the doorway (0 → 1),
   * the gate's glow, the doorway in world space and on screen (NDC), whether the pointer is
   * over it, and a picker for clicks (normalised device coords → hit?). Set by the scene.
   */
  portal: {
    dive: 0,
    glow: 0,
    door: [0, 0, 0] as [number, number, number],
    screen: { x: 0, y: 0 },
    hover: false,
    pick: (() => false) as (x: number, y: number) => boolean,
  },
  /** live horizontal drag on the projects carousel, roughly -1..1 */
  drag: 0,
  /** The zoom-out from the valley to the globe: its progress, eased behind the scroll (see ascent.ts) */
  ascent: { u: 0, active: false },
  /** About captions' clock in reference seconds, softly damped behind the scroll (see aboutTimeline) */
  aboutSec: 0,
  /**
   * The About globe on screen (px), whether it can be grabbed, and the world direction from
   * its centre to home (the zoom-out from the valley starts right above it)
   */
  globe: { x: 0, y: 0, r: 0, grabbable: false, home: [0, 0, 1] as [number, number, number] },
  /** pointer drag on the globe, accumulated by the DOM and consumed by the scene each frame */
  globeDrag: { dx: 0, dy: 0, dragging: false },
  /** city markers on the globe, projected to screen (px); facing 0 = edge-on/hidden … 1 = facing us */
  markers: [] as { x: number; y: number; facing: number }[],
  /**
   * The forest's weather, eased: how far toward daylight / the storm it has turned (0..1 each),
   * and the lightning's flash. Scaled down to nothing once the journey leaves the forest.
   */
  weather: { day: 0, rain: 0, flash: 0 },
  /** the same weather in the projects valley (0 once the journey is elsewhere) */
  valley: { day: 0, rain: 0, flash: 0 },
  /** the globe opening into the board's map, 0 (a globe) → 1 (flat on the screen) */
  unfold: { t: 0 },
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
    /** arriving from the globe: the camera starts on the map (0) and pulls back to the board (1) */
    arrive: 1,
    /** set by the globe as it opens; the board picks the hand-off up on arrival */
    fromGlobe: false,
    /** heading back to the globe: the room dims and the threads rewind with `arrive` */
    leaving: false,
    pick: (() => -1) as (x: number, y: number) => number,
  },
  /**
   * The 3D flow pavilion (/flow): whether it owns the camera, target positions,
   * active view preset, showcase focus, and pointer look.
   */
  flow: {
    active: false,
    pos: [0, 0, 0] as [number, number, number],
    look: [0, 0, 0] as [number, number, number],
    view: "exterior" as "exterior" | "drone" | "walk" | "hall" | "showcase",
    /** how quickly the camera rig chases pos/look (1/s); 60+ means follow exactly (first person) */
    rigRate: 3.2,
    /** camera roll (radians) applied after lookAt; first person leans into strafes */
    roll: 0,
    /**
     * First-person walker, in pavilion-local coordinates: feet position, look angles, velocity,
     * input (keys / touch joystick / accumulated look deltas) and what the HUD reads back.
     */
    fp: {
      x: 0,
      z: 15,
      feet: 0,
      eye: 1.68,
      yaw: 0,
      pitch: 0,
      /** displayed look angles (smoothed toward yaw / pitch when look smoothing is on) */
      viewYaw: 0,
      viewPitch: 0,
      crouch: 0,
      roll: 0,
      vx: 0,
      vz: 0,
      vy: 0,
      grounded: true,
      needsGround: true,
      phase: 0,
      bob: 0,
      dip: 0,
      t: 0,
      speed: 0,
      sprinting: false,
      frozen: false,
      keys: { f: false, b: false, l: false, r: false, sprint: false, crouch: false, jump: false },
      /** player preferences, persisted by the HUD */
      settings: { sens: 1, invertY: false, bob: true, smooth: true },
      joy: { x: 0, y: 0 },
      lookDX: 0,
      lookDY: 0,
      target: -1,
      zone: "PLAZA",
      indoors: false,
    },
    showcaseIndex: 0,
    pan: 0,
    tilt: 0,
    walk: 0,
    hover: -1,
    /**
     * Aerial drone: `p` is the linear lift-off progress (0 grounded, 1 at orbit altitude),
     * `lift` its eased value, `spin` the orbit angle (radians, unbounded), `zoom`/`height`
     * the user's radius and altitude offsets, `idle` seconds since the last drag.
     * alt/dist/heading/pitch/speed are telemetry for the HUD.
     */
    drone: {
      p: 0,
      lift: 0,
      spin: 0,
      zoom: 0,
      height: 0,
      idle: 99,
      alt: 0,
      dist: 0,
      heading: 0,
      pitch: 0,
      speed: 0,
    },
    /** NDC (x, y) -> 0..5 for showcase hit, 99 for portal/enter button hit, or -1 */
    pick: (() => -1) as (x: number, y: number) => number,
  },
  /**
   * Thermal binoculars: `raise` 0 (lowered) … 1 (at the eyes), magnification (eased toward
   * `zoomTarget`), and the telemetry the HUD reads: the temperature and range under the
   * reticle, the auto-gain span, heading / elevation, and a recalibration (NUC) in progress.
   */
  thermal: {
    raise: 0,
    zoom: 2.5,
    zoomTarget: 2.5,
    spot: 0,
    range: 0,
    lo: 0,
    hi: 0,
    heading: 0,
    elevation: 0,
    nuc: false,
  },
};
