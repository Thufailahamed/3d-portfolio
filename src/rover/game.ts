import * as THREE from "three";
import { Deck, DeckView, DECK_R } from "./deck";
import { EDL } from "./edl";
import { Dust, Tracks, entryGlow } from "./fx";
import { aeroshell, descentStage, hardwareMaterials, setNozzleGlow, shieldProfile, type HwMats } from "./hardware";
import { clamp, damp, lerp, smoothstep } from "./noise";
import { EARTH, ROVER, RoverSim, SPEEDS } from "./physics";
import { RoverModel } from "./rover";
import { Sky } from "./sky";
import { RoverAudio } from "./sound";
import { SpaceScene, helio, type Transfer } from "./space";
import { WARPS, announce, control, useRover, type CamMode, type Phase, type Poi } from "./store";
import { RockField, Terrain, TerrainMesh, type Ground, type TerrainTextures } from "./terrain";
import { makeGrainNormal, makeNoiseTexture } from "./textures";
import { worldById, type World, type WorldId } from "./worlds";

type WorldScene = {
  world: World;
  ground: Ground;
  terrain: Terrain | null;
  tmesh: TerrainMesh | null;
  rocks: RockField | null;
  deck: DeckView | null;
  sky: Sky;
  dust: Dust;
  tracks: Tracks;
  root: THREE.Group;
  site: { x: number; z: number };
  yaw: number;
  env: THREE.Texture | null;
};

const UP = new THREE.Vector3(0, 1, 0);
const tmpV = new THREE.Vector3();
const tmpV2 = new THREE.Vector3();

export class Game {
  readonly root = new THREE.Group();
  readonly sun = new THREE.DirectionalLight("#ffffff", 3);
  readonly hemi = new THREE.HemisphereLight("#ffffff", "#444444", 0.5);
  readonly space: SpaceScene;
  readonly rover = new RoverModel();
  readonly audio = new RoverAudio();
  ws: WorldScene | null = null;
  edl: EDL | null = null;
  sim: RoverSim | null = null;
  mode: Phase = "menu";
  wantPhoto = false;
  /** deep links: 1 = skip the cruise and watch the landing, 2 = skip straight to driving */
  autoSkip = 0;
  private tex: TerrainTextures;
  private keys = new Set<string>();
  private t = 0;
  private teleT = 0;
  private fade = { k: 1, to: 0, color: "#000000", rate: 1.5 };
  private mapCam = { yaw: 0.9, pitch: 0.55, zoom: 1, logDist: Math.log(90), target: new THREE.Vector3(), offset: new THREE.Vector3(), focus: null as string | null };
  private cam = {
    pos: new THREE.Vector3(0, 50, 50),
    look: new THREE.Vector3(),
    fov: 50,
    yawOff: 0,
    pitch: 0.24,
    dist: 9.5,
    dragT: -10,
    heading: 0,
    mastYaw: 0,
    mastPitch: -0.15,
    shake: 0,
    cineShot: 0,
    cineT: 0,
    cinePos: new THREE.Vector3(),
    cineAngle: 0,
    snapNext: false,
  };
  private cruise: { tr: Transfer; t: number; waitDur: number; flyDur: number; jd0: number; from: World; to: World } | null = null;
  private ap: { t: number; dur: number; world: World; craft: THREE.Group; glow: ReturnType<typeof entryGlow> | null; plume: THREE.ShaderMaterial | null; hw: HwMats; E: THREE.Vector3; f: THREE.Vector3; e: THREE.Vector3; side: THREE.Vector3 } | null = null;
  private pending: World | null = null;
  private building: Promise<void> | null = null;
  private dustAcc = new Float32Array(8);
  private trail: THREE.Vector2[] = [];
  private pois: Poi[] = [];
  private factT = 0;
  private factI = 0;
  private warnT = 0;
  private sampleT = -1;
  private lostT = 0;
  private liftoff = -1;
  private miniMap: { cx: number; cz: number; img: ImageData | null; heights: Float32Array; k: number; n: number; size: number; minH: number; maxH: number } | null = null;
  private dragging = false;
  private origin: World;
  private pad = { throttle: 0, steer: 0, brake: false };

  constructor(
    private gl: THREE.WebGLRenderer,
    private scene: THREE.Scene,
    private camera: THREE.PerspectiveCamera,
    private quality: number,
  ) {
    this.tex = { noise: makeNoiseTexture(), grain: makeGrainNormal() };
    this.space = new SpaceScene();
    this.root.add(this.space.root, this.sun, this.sun.target, this.hemi);
    this.sun.castShadow = quality >= 1;
    this.sun.shadow.mapSize.set(quality >= 2 ? 4096 : 2048, quality >= 2 ? 4096 : 2048);
    const sc = this.sun.shadow.camera as THREE.OrthographicCamera;
    sc.left = sc.bottom = -34;
    sc.right = sc.top = 34;
    sc.near = 1;
    sc.far = 600;
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.04;
    const mapLight = new THREE.PointLight("#fff2dd", 4, 0, 0);
    this.space.map.add(mapLight, new THREE.AmbientLight("#8090b0", 0.25));
    this.origin = worldById.earth;
    this.enterMenu(true);
    this.bindControls();
  }

  // ———————————————————————————— modes ————————————————————————————

  private enterMenu(first = false) {
    this.mode = "menu";
    this.space.root.visible = true;
    this.space.map.visible = true;
    this.space.approach.visible = false;
    this.space.craft.visible = false;
    if (this.ws) this.ws.root.visible = false;
    this.rover.root.visible = false;
    this.lightsFor(null);
    this.audio.setWorld(null);
    const sel = useRover.getState().selected;
    this.space.highlight(sel);
    if (first) this.fade.k = 1;
    this.fade.to = 0;
    this.fade.color = "#000000";
    useRover.getState().set({ phase: "menu", cruise: null, jd: this.space.jd });
    // opening the map from a world: start looking at that world
    if (!first && this.ws) this.focusOn(this.ws.world.id);
  }

  /** choose a destination: lift off (if driving), cruise there, land */
  go(id: WorldId) {
    const to = worldById[id];
    useRover.getState().set({ selected: id, sample: null, lost: null, overturned: false });
    if (this.mode === "drive" || this.mode === "lost") {
      // climb out: the camera rises into the sky before the cruise
      this.liftoff = 0;
      this.pending = to;
      this.fade.to = 1;
      this.fade.color = "#000000";
      this.fade.rate = 1.2;
      return;
    }
    this.startCruise(to);
  }

  private startCruise(to: World) {
    const from = this.ws?.world ?? this.origin;
    this.menuFromDrive = false;
    this.disposeWorld();
    this.mode = "cruise";
    this.space.root.visible = true;
    this.space.map.visible = true;
    this.space.approach.visible = false;
    this.space.craft.visible = true;
    this.lightsFor(null);
    this.audio.setWorld(null);
    const jd0 = this.space.jd;
    const tr = this.space.planTransfer(from, to, jd0);
    // a long wait for the window is shown as a quick time-lapse before the burn
    const waitDur = tr.wait > 2 ? clamp(1.1 + Math.log10(tr.wait) * 0.85, 1.2, 3.8) : 0;
    this.cruise = { tr, t: 0, waitDur, flyDur: tr.local ? 5 : 8.5, jd0, from, to };
    this.space.highlight(to.id);
    this.fade.k = 1;
    this.fade.to = 0;
    this.fade.rate = 1.4;
    useRover.getState().set({
      phase: "cruise",
      world: null,
      cruise: { from: from.id, to: to.id, day: 0, days: tr.days, t: 0, phase: waitDur > 0 ? "wait" : "fly", launch: tr.launchJD, arrive: tr.arriveJD, wait: tr.wait, dv: tr.dv },
    });
    // build the destination now, while space is cheap to draw
    this.building = this.buildWorld(to);
  }

  private async buildWorld(w: World) {
    const root = new THREE.Group();
    root.visible = false;
    let ground: Ground;
    let terrain: Terrain | null = null;
    let tmesh: TerrainMesh | null = null;
    let rocks: RockField | null = null;
    let deck: DeckView | null = null;
    let site = { x: 0, z: 0 };
    const sky = new Sky(w);
    if (w.surface === "deck") {
      const d = new Deck(w);
      ground = d;
      deck = new DeckView(d, w, sky.sunDir);
      root.add(deck.root);
    } else {
      terrain = new Terrain(w);
      ground = terrain;
      const best = terrain.findLandingSite(0, 0, 160);
      site = { x: best.x, z: best.z };
      terrain.clear = { x: site.x, z: site.z, r: 9 };
      tmesh = new TerrainMesh(w, this.quality, this.tex);
      root.add(tmesh.mesh);
      rocks = new RockField(terrain, w, this.tex.grain);
      rocks.update(site.x, site.z, true);
      root.add(rocks.root);
    }
    const dust = new Dust(w, ground);
    dust.focus(site.x, site.z, true);
    const tracks = new Tracks(w);
    root.add(sky.root, dust.points, tracks.mesh);
    const yaw = (w.terrain.seed % 7) * 0.9;
    // a PMREM of the sky for reflections on the rover's metal
    const env = this.skyEnv(sky);
    const ws: WorldScene = { world: w, ground, terrain, tmesh, rocks, deck, sky, dust, tracks, root, site, yaw, env };
    this.ws = ws;
    this.root.add(root);
    tmesh?.update(new THREE.Vector3(site.x, 0, site.z), new THREE.Vector3(site.x, 100, site.z));
    // compile its shaders (and the rover's) in the background, in the exact variants the landing will use
    const roverParent = this.rover.root.parent;
    root.add(this.rover.root);
    const wasVisible = this.rover.root.visible;
    this.rover.root.visible = true;
    await this.precompile(root, () => this.lightsFor(ws), () => {
      this.lightsFor(this.mode === "descent" || this.mode === "drive" ? this.ws : null);
      if (this.mode !== "descent" && this.mode !== "drive") root.visible = false;
      this.rover.root.visible = wasVisible;
      if (roverParent) roverParent.add(this.rover.root);
      else root.remove(this.rover.root);
    });
  }

  private compileRT: THREE.WebGLRenderTarget | null = null;
  /**
   * Create the GPU programs for `obj` without drawing it. The scene renders into the post-processing
   * buffer, so programs are built for a linear half-float target with the given lights/fog/environment;
   * `restore` runs before any frame can be drawn. Resolves once the driver has finished compiling.
   */
  async precompile(obj: THREE.Object3D, setup?: () => void, restore?: () => void) {
    this.compileRT ??= new THREE.WebGLRenderTarget(4, 4, { type: THREE.HalfFloatType });
    const prevRT = this.gl.getRenderTarget();
    const prevVisible = obj.visible;
    let job: Promise<unknown> = Promise.resolve();
    try {
      setup?.();
      obj.visible = true;
      this.gl.setRenderTarget(this.compileRT);
      job = this.gl.compileAsync(obj, this.camera, this.scene);
    } catch {
      /* the first frame will compile instead */
    } finally {
      this.gl.setRenderTarget(prevRT);
      obj.visible = prevVisible;
      restore?.();
    }
    await job.catch(() => {});
  }

  private skyEnv(sky: Sky) {
    try {
      const s = new THREE.Scene();
      const mat = (sky.dome.material as THREE.ShaderMaterial).clone();
      mat.vertexShader = mat.vertexShader.replace("gl_Position = vec4(p.xy, p.w * 0.99999, p.w);", "gl_Position = p;");
      // the sun itself comes from the directional light; in the reflections it would only blow out highlights
      mat.uniforms.uSunK.value = Math.min(mat.uniforms.uSunK.value, 1.5);
      const m = new THREE.Mesh(new THREE.SphereGeometry(50, 32, 16), mat);
      s.add(m);
      const pm = new THREE.PMREMGenerator(this.gl);
      const rt = pm.fromScene(s, 0, 0.1, 200);
      pm.dispose();
      m.geometry.dispose();
      mat.dispose();
      return rt.texture;
    } catch {
      return null;
    }
  }

  private disposeWorld() {
    const ws = this.ws;
    if (!ws) return;
    this.edl?.root.removeFromParent();
    this.edl?.dispose();
    this.edl = null;
    this.sim = null;
    this.rover.root.removeFromParent();
    ws.root.removeFromParent();
    ws.tmesh?.dispose();
    ws.rocks?.dispose();
    ws.deck?.dispose();
    ws.sky.dispose();
    ws.dust.dispose();
    ws.tracks.dispose();
    ws.env?.dispose();
    this.ws = null;
    this.scene.environment = null;
    this.scene.fog = null;
  }

  private startApproach(w: World) {
    this.mode = "approach";
    this.space.map.visible = false;
    this.space.craft.visible = false;
    this.space.approach.visible = true;
    this.space.setApproach(w);
    const vacuum = w.atm.rho < 0.001;
    const hw = hardwareMaterials();
    const craft = new THREE.Group();
    let glow: ReturnType<typeof entryGlow> | null = null;
    let plume: THREE.ShaderMaterial | null = null;
    if (!vacuum) {
      // the aeroshell flies heat shield first; the shock-layer colour follows the gas: CO₂ glows orange-red, N₂/CH₄ violet, H₂ pink
      craft.add(aeroshell(hw).g);
      glow = entryGlow(w.id === "titan" ? "#c070ff" : w.surface === "deck" ? "#ff6aa8" : w.id === "earth" ? "#ff7a3a" : "#ff5a2a", shieldProfile(), this.quality);
      craft.add(glow.g);
    } else {
      // no air to brake against: the descent stage, rover tucked beneath, burns its engines into the direction of travel
      const stage = descentStage(hw, true);
      const rover = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.5, 2.0), hw.frame);
      rover.position.y = -1.05;
      const deck = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.08, 1.9), hw.gold);
      deck.position.y = -0.77;
      craft.add(stage.g, rover, deck);
      plume = stage.pm;
    }
    craft.scale.setScalar(0.03);
    this.space.approach.add(craft);
    // enter over the low latitudes (away from the polar caps) in the mid-afternoon, the Sun ~60° from the zenith
    // so the relief throws long shadows, flying across the light so it rakes the aeroshell from the side
    const sun = this.space.bigSun;
    const across = new THREE.Vector3(-sun.z, 0, sun.x).normalize();
    const e = sun.clone().multiplyScalar(0.5).addScaledVector(across, 0.866).normalize();
    const toSun = sun.clone().addScaledVector(e, -sun.dot(e)).normalize();
    const f = toSun.clone().multiplyScalar(0.5).addScaledVector(new THREE.Vector3().crossVectors(e, toSun), 0.866).normalize();
    const side = new THREE.Vector3().crossVectors(e, f).normalize();
    const E = e.clone().multiplyScalar(103.2);
    this.ap = { t: 0, dur: vacuum ? 8 : 10, world: w, craft, glow, plume, hw, E, f, e, side };
    this.fade.k = 1;
    this.fade.to = 0;
    this.fade.color = "#000000";
    this.fade.rate = 1.6;
    useRover.getState().set({ phase: "approach", edl: { phase: vacuum ? "Deorbit burn" : "Entry interface", alt: 125000, v: w.edl.entryKms * 1000, ts: 1, log: [] } });
  }

  private endApproach() {
    if (!this.ap) return;
    this.ap.glow?.dispose();
    this.ap.craft.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) m.geometry.dispose();
    });
    this.ap.plume?.dispose();
    this.ap.hw.dispose();
    this.ap.craft.removeFromParent();
    this.ap = null;
  }

  private starting = false;
  private async startDescent() {
    if (this.starting) return;
    this.starting = true;
    const w = this.cruise?.to ?? this.ws?.world;
    this.endApproach();
    if (this.building) await this.building;
    this.building = null;
    this.starting = false;
    const ws = this.ws;
    if (!ws || !w) return;
    this.mode = "descent";
    this.menuFromDrive = false;
    this.space.root.visible = false;
    ws.root.visible = true;
    this.lightsFor(ws);
    this.audio.setWorld(ws.world);
    ws.root.add(this.rover.root);
    this.rover.root.visible = true;
    this.rover.setDust(ws.world.soil.dustColor);
    this.rover.dust = 0;
    this.rover.standing = 0;
    this.rover.deploy = 0;
    this.rover.armTarget = 0;
    this.rover.mastAim = null;
    this.edl?.root.removeFromParent();
    this.edl?.dispose();
    this.edl = new EDL(ws.world, ws.ground, ws.site, ws.yaw);
    ws.root.add(this.edl.root);
    this.sim = new RoverSim(ws.world, ws.ground);
    this.sim.vmax = SPEEDS[useRover.getState().speedIdx].v;
    this.pois = [];
    this.trail = [];
    this.miniMap = null;
    ws.tracks.breakAll();
    ws.dust.clear();
    this.cam.cineT = 0;
    this.fade.k = 1;
    this.fade.to = 0;
    this.fade.color = ws.world.atm.rho > 0.001 ? ws.world.sky.horizon : "#000000";
    this.fade.rate = 1.1;
    this.factT = 0;
    this.factI = 0;
    useRover.getState().set({ phase: "descent", world: ws.world.id, pois: [], sample: null, lost: null, overturned: false, feed: [] });
    this.cam.pos.copy(this.edl.shot.pos);
    this.cam.look.copy(this.edl.shot.look);
    if (this.autoSkip === 2) this.skip();
    this.autoSkip = 0;
  }

  private startDrive() {
    this.mode = "drive";
    useRover.getState().set({ phase: "drive" });
    const w = this.ws!.world;
    announce(`Welcome to ${w.name}`, "gold", `${w.site} · gravity ${(w.g / EARTH).toFixed(2)} g`);
    this.cam.yawOff = 0;
    this.cam.pitch = 0.24;
    this.factT = 3;
  }

  /** skip ahead: cruise → straight to the descent; descent → straight to driving */
  skip() {
    if (this.mode === "cruise" && this.cruise) {
      this.cruise.t = this.cruise.waitDur + this.cruise.flyDur;
      this.space.layout(this.cruise.tr.arriveJD);
      this.space.hideArc();
      useRover.getState().set({ jd: this.space.jd });
      void this.startDescent();
    } else if (this.mode === "approach") {
      void this.startDescent();
    } else if (this.mode === "descent" && this.edl && this.sim && this.ws) {
      this.edl.skip();
      this.sim.place(this.ws.site.x, this.ws.site.z, this.ws.yaw);
      this.sim.enabled = true;
      this.rover.standing = 1;
      this.rover.deploy = 1;
      this.startDrive();
      this.cam.snapNext = true;
      this.cam.heading = Math.atan2(Math.sin(this.ws.yaw), Math.cos(this.ws.yaw));
    }
  }

  redeploy() {
    if (!this.ws) return;
    useRover.getState().set({ lost: null });
    void this.startDescent();
  }

  /** open the map over the rover, or come back to it */
  toggleMenu() {
    if (this.mode === "drive" || this.mode === "lost") {
      this.enterMenu();
      useRover.getState().set({ phase: "menu" });
      this.menuFromDrive = true;
    } else if (this.mode === "menu" && this.menuFromDrive && this.ws) {
      this.menuFromDrive = false;
      this.mode = "drive";
      this.space.root.visible = false;
      this.ws.root.visible = true;
      this.rover.root.visible = true;
      this.lightsFor(this.ws);
      this.audio.setWorld(this.ws.world);
      useRover.getState().set({ phase: "drive" });
    }
  }
  private menuFromDrive = false;

  private lightsFor(ws: WorldScene | null) {
    if (!ws) {
      this.sun.visible = false;
      this.hemi.visible = false;
      this.scene.fog = null;
      this.scene.environment = null;
      this.scene.background = new THREE.Color("#000000");
      return;
    }
    const s = ws.world.sky;
    this.sun.visible = true;
    this.hemi.visible = true;
    this.sun.color.set(s.sun);
    // direct sun carries the image; skylight fills the shadows at roughly the real diffuse fraction
    // (≈35% under Mars' dusty sky, ≈15% under Earth's blue one, almost nothing in vacuum)
    this.sun.intensity = s.sunIntensity * s.exposure * 0.86;
    this.sun.shadow.intensity = ws.world.id === "venus" ? 0.35 : ws.world.id === "titan" ? 0.5 : ws.world.atm.rho > 0.5 ? 0.88 : 1;
    this.hemi.color.set(s.hemiSky);
    this.hemi.groundColor.set(s.hemiGround);
    this.hemi.intensity = s.hemiK * s.exposure * 0.72;
    this.scene.fog = s.fogDensity > 0 ? new THREE.FogExp2(s.fog, s.fogDensity) : null;
    this.scene.environment = ws.env;
    this.scene.environmentIntensity = 0.3 * s.exposure;
    this.scene.background = null;
    const amb = new THREE.Color(s.hemiSky).multiplyScalar(s.hemiK * 0.35);
    ws.dust.setLight(new THREE.Color(s.sun).multiplyScalar(Math.min(1.4, s.sunIntensity * 0.35 * s.exposure)), amb);
  }

  // ———————————————————————————— input ————————————————————————————

  private bindControls() {
    control.go = (id) => this.go(id);
    control.skip = () => this.skip();
    control.recover = () => this.recover();
    control.sample = () => this.sample();
    control.photo = () => (this.wantPhoto = true);
    control.redeploy = () => this.redeploy();
    control.menu = () => this.toggleMenu();
    control.unlock = () => this.audio.unlock();
    control.setMuted = (m) => this.audio.setMuted(m);
    control.minimap = (c, w, h) => this.drawMinimap(c, w, h);
    control.select = (id) => this.selectBody(id);
    control.overview = () => this.focusOn(null);
    control.now = () => {
      this.space.setNow();
      useRover.getState().set({ jd: this.space.jd });
    };
  }

  key(code: string, down: boolean) {
    if (down) this.keys.add(code);
    else this.keys.delete(code);
  }

  /** pointer drag from the canvas */
  drag(dx: number, dy: number) {
    this.dragging = true;
    if (this.mode === "menu" || this.mode === "cruise") {
      this.mapCam.yaw -= dx * 0.005;
      this.mapCam.pitch = clamp(this.mapCam.pitch + dy * 0.004, 0.05, 1.45);
      return;
    }
    const s = useRover.getState();
    if (s.cam === "mast") {
      this.cam.mastYaw = clamp(this.cam.mastYaw - dx * 0.004, -2.6, 2.6);
      this.cam.mastPitch = clamp(this.cam.mastPitch - dy * 0.003, -1.1, 0.8);
    } else {
      this.cam.yawOff -= dx * 0.006;
      this.cam.pitch = clamp(this.cam.pitch + dy * 0.004, -0.15, 1.35);
    }
    this.cam.dragT = this.t;
  }

  endDrag() {
    this.dragging = false;
  }

  zoom(dy: number) {
    if (this.mode === "menu" || this.mode === "cruise") this.mapCam.zoom = clamp(this.mapCam.zoom * Math.exp(dy * 0.0012), 0.04, 12);
    else this.cam.dist = clamp(this.cam.dist * Math.exp(dy * 0.001), 4.5, 60);
  }

  /** the selectable world nearest the pointer on screen (planets are often sub-pixel, so pick in 2D) */
  private screenPick(ndc: THREE.Vector2): WorldId | null {
    const cam = this.camera;
    const h = this.gl.domElement.clientHeight || 800;
    const pxPerNdc = h / 2;
    const focal = 1 / Math.tan(THREE.MathUtils.degToRad(cam.fov / 2));
    let best: WorldId | null = null;
    let bestD = Infinity;
    for (const t of this.space.labelTargets()) {
      if (!t.selectable) continue;
      const p = tmpV.copy(t.pos).project(cam);
      if (p.z > 1) continue;
      const d = Math.hypot((p.x - ndc.x) * (this.gl.domElement.clientWidth / h), p.y - ndc.y) * pxPerNdc;
      const dist = cam.position.distanceTo(t.pos);
      const rPx = (t.r / Math.max(dist, 1e-9)) * focal * pxPerNdc;
      if (d < Math.max(20, rPx + 8) && d < bestD) {
        bestD = d;
        best = t.id as WorldId;
      }
    }
    return best;
  }

  /** click in the map picks a planet (and flies to it) */
  pick(ndc: THREE.Vector2) {
    if (this.mode !== "menu") return;
    const id = this.screenPick(ndc);
    if (id) this.selectBody(id);
  }

  hoverPick(ndc: THREE.Vector2) {
    if (this.mode !== "menu") return null;
    return this.screenPick(ndc);
  }

  private selectBody(id: string) {
    const st = useRover.getState();
    if (id in worldById) {
      st.set({ selected: id as WorldId });
      this.space.highlight(id);
    }
    this.focusOn(id);
    this.audio.hit("click");
  }

  private focusOn(id: string | null) {
    const m = this.mapCam;
    const newTarget = id ? this.space.posOf(id, new THREE.Vector3()) : new THREE.Vector3();
    // keep the camera where it is: carry the difference as an offset that eases away
    m.offset.copy(m.target).sub(newTarget);
    m.focus = id;
    m.zoom = 1;
    useRover.getState().set({ mapFocus: id });
  }

  private readInput() {
    const k = this.keys;
    let throttle = (k.has("KeyW") || k.has("ArrowUp") ? 1 : 0) - (k.has("KeyS") || k.has("ArrowDown") ? 1 : 0);
    let steer = (k.has("KeyA") || k.has("ArrowLeft") ? 1 : 0) - (k.has("KeyD") || k.has("ArrowRight") ? 1 : 0);
    let brake = k.has("Space");
    // gamepad: left stick steers, triggers drive and reverse, A brakes
    const gp = typeof navigator !== "undefined" && navigator.getGamepads ? [...navigator.getGamepads()].find((g) => g && g.connected) : null;
    if (gp) {
      const sx = Math.abs(gp.axes[0] ?? 0) > 0.12 ? gp.axes[0] : 0;
      const rt = gp.buttons[7]?.value ?? 0;
      const lt = gp.buttons[6]?.value ?? 0;
      if (Math.abs(sx) > 0) steer = -sx;
      if (rt > 0.05 || lt > 0.05) throttle = rt - lt;
      if (gp.buttons[0]?.pressed) brake = true;
    }
    const tc = control.touch;
    if (tc.active) {
      throttle = tc.throttle;
      steer = tc.steer;
      brake = brake || tc.brake;
    }
    // smooth the steering a little, like a hand on a wheel
    this.pad.throttle = damp(this.pad.throttle, throttle, 8, 1 / 60);
    this.pad.steer = damp(this.pad.steer, steer, 6, 1 / 60);
    this.pad.brake = brake;
    if (Math.abs(throttle) < 0.01 && Math.abs(this.pad.throttle) < 0.05) this.pad.throttle = 0;
    if (Math.abs(steer) < 0.01 && Math.abs(this.pad.steer) < 0.05) this.pad.steer = 0;
  }

  recover() {
    if (!this.sim || this.mode !== "drive") return;
    this.sim.recover();
    announce("Rover righted", "info", "In real life this would end the mission — rovers can't self-right");
  }

  sample() {
    if (!this.sim || this.mode !== "drive" || this.sampleT >= 0) return;
    if (Math.abs(this.sim.forwardSpeed()) > 0.15) {
      announce("Stop to sample", "warn", "The arm only deploys with the rover parked");
      return;
    }
    if (this.ws?.world.surface === "deck") {
      announce("Gas sampler opened", "info", "No ground to drill — sampling the atmosphere instead");
    }
    this.sampleT = 0;
    this.rover.armTarget = 1;
    useRover.getState().set({ sample: null });
  }

  // ———————————————————————————— frame ————————————————————————————

  update(dt: number) {
    this.t += dt;
    this.space.update(this.t, this.camera, this.gl.getPixelRatio());
    switch (this.mode) {
      case "menu":
        this.updateMenu(dt);
        break;
      case "cruise":
        this.updateCruise(dt);
        break;
      case "approach":
        this.updateApproach(dt);
        break;
      case "descent":
      case "drive":
      case "lost":
        this.updateSurface(dt);
        break;
    }
    if (this.mode !== "menu" && this.mode !== "cruise") this.updateLabels(false);
    // full-screen fade
    this.fade.k = damp(this.fade.k, this.fade.to, this.fade.rate * 3, dt);
    if (Math.abs(this.fade.k - this.fade.to) < 0.003) this.fade.k = this.fade.to;
    const el = control.fade;
    if (el) {
      el.style.opacity = this.fade.k.toFixed(3);
      el.style.background = this.fade.color;
    }
  }

  private setCamera(pos: THREE.Vector3, look: THREE.Vector3, fov: number, near: number, far: number, up = UP) {
    const c = this.camera;
    c.position.copy(pos);
    c.up.copy(up);
    c.lookAt(look);
    if (Math.abs(c.fov - fov) > 0.01 || c.near !== near || c.far !== far) {
      c.fov = fov;
      c.near = near;
      c.far = far;
      c.updateProjectionMatrix();
    }
  }

  private mapTimeT = 0;
  private updateMenu(dt: number) {
    const s = useRover.getState();
    // the map's clock runs at the chosen time-warp; the scale mode eases between presets
    this.space.setScale(s.scale);
    this.space.layout(this.space.jd + WARPS[s.warp].dps * dt, dt);
    this.mapTimeT += dt;
    if (this.mapTimeT > 0.25) {
      this.mapTimeT = 0;
      s.set({ jd: this.space.jd });
    }
    if (!this.dragging) this.mapCam.yaw += dt * 0.02;
    this.mapCamera(dt, this.mapCam.focus);
    this.updateLabels(true);
  }

  /** orbit the map camera around the focused body (or the whole system), easing in log-distance */
  private mapCamera(dt: number, focus: string | null, distOverride?: number, lookOverride?: THREE.Vector3) {
    const m = this.mapCam;
    const sp = this.space;
    const focusPos = lookOverride ?? (focus ? sp.posOf(focus, tmpV) : tmpV.set(0, 0, 0));
    m.offset.multiplyScalar(Math.exp(-3.2 * dt));
    m.target.copy(focusPos).add(m.offset);
    let want: number;
    if (distOverride !== undefined) want = distOverride;
    else if (focus) want = Math.max(sp.displayRadius(focus) * 7, 1e-5);
    // the whole system out to Neptune fits the frame
    else want = this.space.distK > 0.5 ? (sp.toDisplay(tmpV2.set(40, 0, 0)).length() / Math.tan(THREE.MathUtils.degToRad(21))) * 0.9 : sp.toDisplay(tmpV2.set(31, 0, 0)).length() * 1.55;
    m.logDist = damp(m.logDist, Math.log(want * m.zoom), 2.6, dt);
    const dist = Math.exp(m.logDist);
    const pos = tmpV2.set(Math.sin(m.yaw) * Math.cos(m.pitch), Math.sin(m.pitch), Math.cos(m.yaw) * Math.cos(m.pitch)).multiplyScalar(dist).add(m.target);
    const near = clamp(dist * 0.01, 1e-6, 0.5);
    this.setCamera(pos, m.target, 42, near, Math.max(dist * 60, sp.toDisplay(tmpV.set(60, 0, 0)).length() * 4));
  }

  /** float the HTML labels over their bodies; moons only when you are close to their planet */
  private updateLabels(show: boolean) {
    const els = control.labels;
    if (!els.size) return;
    const cam = this.camera;
    const w = this.gl.domElement.clientWidth;
    const h = this.gl.domElement.clientHeight;
    const st = useRover.getState();
    const focal = 1 / Math.tan(THREE.MathUtils.degToRad(cam.fov / 2));
    for (const t of this.space.labelTargets()) {
      const el = els.get(t.id);
      if (!el) continue;
      let visible = show;
      if (t.kind === "moon" && !t.selectable) visible &&= this.space.isMoonVisible(t.id);
      if (t.kind === "moon" && t.parent) visible &&= cam.position.distanceTo(t.pos) < this.space.displayRadius(t.parent) * 120 || this.mapCam.focus === t.id;
      const p = tmpV.copy(t.pos).project(cam);
      if (p.z > 1 || Math.abs(p.x) > 1.1 || Math.abs(p.y) > 1.1) visible = false;
      if (!visible) {
        if (el.style.display !== "none") el.style.display = "none";
        continue;
      }
      if (el.style.display === "none") el.style.display = "";
      const dist = cam.position.distanceTo(t.pos);
      const rPx = (t.r / Math.max(dist, 1e-9)) * focal * (h / 2);
      const x = (p.x * 0.5 + 0.5) * w;
      const y = (-p.y * 0.5 + 0.5) * h;
      el.style.transform = `translate3d(${x.toFixed(1)}px, ${(y - Math.min(rPx, 200)).toFixed(1)}px, 0)`;
      el.dataset.active = String(t.id === st.selected || t.id === st.hover);
    }
  }

  private updateCruise(dt: number) {
    const c = this.cruise;
    if (!c || this.starting) return;
    if (this.autoSkip) {
      this.skip();
      return;
    }
    c.t += dt;
    const st = useRover.getState();
    this.space.setScale(st.scale);
    const tr = c.tr;
    const waiting = c.t < c.waitDur;
    let u = 0;
    let s = 0;
    if (waiting) {
      // time-lapse to the launch window: the planets swing round until the geometry is right
      const w = c.t / c.waitDur;
      const e = w < 0.5 ? 4 * w * w * w : 1 - Math.pow(-2 * w + 2, 3) / 2;
      this.space.layout(c.jd0 + (tr.launchJD - c.jd0) * e, dt);
    } else {
      u = clamp((c.t - c.waitDur) / c.flyDur, 0, 1);
      // ease in and out of the burns
      s = u < 0.5 ? 2 * u * u : 1 - Math.pow(-2 * u + 2, 2) / 2;
      this.space.layout(tr.launchJD + s * tr.days, dt);
    }
    const burn = waiting ? 0 : u < 0.08 ? 1 - u / 0.08 : u > 0.92 ? (u - 0.92) / 0.08 : 0;
    const craft = waiting ? this.space.craftAt(tr, 0, 0) : this.space.craftAt(tr, s, burn);
    const dest = this.space.posOf(c.to.id, new THREE.Vector3());
    const orig = this.space.posOf(c.from.id, new THREE.Vector3(), Math.min(this.space.jd, tr.launchJD));
    // frame the whole transfer, then swoop in on the destination
    const mid = orig.clone().add(dest).multiplyScalar(0.5).lerp(craft, waiting ? 0 : 0.35);
    const hR = this.space.displayRadius(helio(c.from).id);
    const spread = Math.max(hR * 14, orig.distanceTo(dest) * 0.85, tr.local ? 0 : 6);
    const close = smoothstep(0.8, 1, u);
    const lookAt = mid.clone().lerp(dest, close);
    if (!this.dragging) this.mapCam.yaw += dt * 0.05;
    const dist = Math.exp(lerp(Math.log(spread * 1.15), Math.log(Math.max(this.space.displayRadius(c.to.id) * 6, 1e-5)), close));
    this.mapCam.offset.set(0, 0, 0);
    this.mapCam.zoom = 1;
    this.mapCam.logDist = Math.log(dist);
    this.mapCamera(dt, null, dist, lookAt);
    this.updateLabels(true);
    this.mapTimeT += dt;
    if (this.mapTimeT > 0.1) {
      this.mapTimeT = 0;
      st.set({ jd: this.space.jd, cruise: { from: c.from.id, to: c.to.id, day: s * tr.days, days: tr.days, t: u, phase: waiting ? "wait" : "fly", launch: tr.launchJD, arrive: tr.arriveJD, wait: tr.wait, dv: tr.dv } });
    }
    if (u > 0.94) {
      this.fade.to = 1;
      this.fade.rate = 3;
    }
    if (u >= 1 && this.fade.k > 0.97) {
      this.space.hideArc();
      this.startApproach(c.to);
    }
  }

  private updateApproach(dt: number) {
    const a = this.ap;
    if (!a || this.starting) return;
    a.t += dt;
    const s = a.t / a.dur;
    const vacuum = a.world.atm.rho < 0.001;
    const { E, f, e, side } = a;
    let P: THREE.Vector3;
    let vdir: THREE.Vector3;
    const split = 0.4;
    if (s < split) {
      const u = s / split;
      P = E.clone().addScaledVector(f, -42 * (1 - u)).addScaledVector(e, 7 * (1 - u) * (1 - u));
      vdir = f.clone().addScaledVector(e, (-14 * (1 - u)) / 42).normalize();
    } else {
      const u = (s - split) / (1 - split);
      P = E.clone().addScaledVector(f, 7 * u).addScaledVector(e, -2.4 * Math.pow(u, 1.25));
      vdir = f.clone().multiplyScalar(7).addScaledVector(e, -2.4 * 1.25 * Math.pow(Math.max(u, 0.01), 0.25)).normalize();
    }
    a.craft.position.copy(P);
    // heat shield into the flow (or engines against it), with a slow roll as the guidance banks the lift vector
    a.craft.quaternion.setFromUnitVectors(new THREE.Vector3(0, -1, 0), vdir);
    a.craft.rotateY(this.t * 0.12);
    const u2 = clamp((s - split) / (1 - split), 0, 1);
    const heat = s < split ? 0 : Math.pow(Math.sin(Math.PI * clamp(u2 * 1.12, 0, 1)), 0.8);
    a.glow?.set(this.t, heat * 1.25, 0.012);
    if (a.plume) {
      const burn = s > 0.22 ? smoothstep(0.22, 0.3, s) * (0.9 + Math.random() * 0.1) : 0;
      a.plume.uniforms.uTime.value = this.t;
      a.plume.uniforms.uPower.value = burn;
      setNozzleGlow(a.hw, burn, true);
    }
    let camPos: THREE.Vector3;
    let look: THREE.Vector3;
    let fov = 46;
    if (s < split) {
      // coasting in: close behind the aeroshell, the limb of the planet sweeping across the frame
      const u = s / split;
      camPos = P.clone()
        .addScaledVector(f, -0.62 + u * 0.12)
        .addScaledVector(e, 0.16 + 0.06 * (1 - u))
        .addScaledVector(side, -lerp(0.42, 0.24, u));
      look = P.clone().addScaledVector(f, 1.6).addScaledVector(e, -0.32);
      fov = 44;
    } else {
      // in the fire: beside and a little ahead, looking back along the shield face and the wake
      const k = smoothstep(0, 0.25, u2);
      camPos = P.clone()
        .addScaledVector(vdir, lerp(-0.05, 0.12, k))
        .addScaledVector(side, -lerp(0.42, 0.5, k))
        .addScaledVector(e, lerp(0.16, 0.1, k));
      // airless: no fireball to look back on, so keep the stage and its braking plumes in the middle of the frame
      look = vacuum ? P.clone().addScaledVector(vdir, 0.12) : P.clone().addScaledVector(vdir, -0.22);
      // buffeting grows with the dynamic pressure
      const sh = heat * 0.0035;
      const tt = this.t;
      camPos.addScaledVector(side, Math.sin(tt * 37) * sh + Math.sin(tt * 91) * sh * 0.4);
      camPos.addScaledVector(e, Math.sin(tt * 43 + 1) * sh + Math.sin(tt * 77) * sh * 0.4);
      fov = 52 - heat * 4;
    }
    this.setCamera(camPos, look, fov, 0.004, 3000, e);
    const alt = Math.max(0, (P.length() - 100) / 100) * a.world.radiusKm * 1000;
    const v = a.world.edl.entryKms * 1000 * (vacuum ? lerp(1, 0.3, s) : lerp(1, 0.25, smoothstep(0.5, 1, s)));
    useRover.getState().set({ edl: { phase: vacuum ? (s < split ? "Deorbit" : "Braking burn") : s < split ? "Entry interface" : heat > 0.7 ? "Peak heating" : "Hypersonic", alt, v, ts: 1, log: [] } });
    if (s > 0.9) {
      this.fade.to = 1;
      this.fade.color = vacuum ? "#000000" : "#fff1e0";
      this.fade.rate = 2.4;
    }
    if (s >= 1 && this.fade.k > 0.96) void this.startDescent();
  }

  private updateSurface(dt: number) {
    const ws = this.ws;
    const sim = this.sim;
    const edl = this.edl;
    if (!ws || !sim) return;
    const W = ws.world;
    const st = useRover.getState();

    // lifting off for another world
    if (this.liftoff >= 0) {
      this.liftoff += dt;
      if (this.fade.k > 0.97 && this.pending) {
        const to = this.pending;
        this.pending = null;
        this.liftoff = -1;
        this.startCruise(to);
        return;
      }
    }

    // —— controls → physics ——
    this.readInput();
    const driving = this.mode === "drive" && this.sampleT < 0;
    sim.input.throttle = driving ? this.pad.throttle : 0;
    sim.input.steer = driving ? this.pad.steer : 0;
    sim.input.brake = driving ? this.pad.brake : this.sampleT >= 0;
    sim.vmax = SPEEDS[st.speedIdx].v;
    sim.step(dt);

    // —— the landing ——
    if (edl) {
      edl.update(dt, sim.enabled ? { pos: sim.pos, quat: sim.quat } : null);
      if (edl.attached && edl.phase === "skycrane") {
        const bottom = edl.rover.pos.y - (0.06 + ROVER.restLen + ROVER.wheelR);
        const g = Math.max(ws.ground.ground(edl.rover.pos.x, edl.rover.pos.z), ws.ground.ground(edl.rover.pos.x + 1.2, edl.rover.pos.z), ws.ground.ground(edl.rover.pos.x - 1.2, edl.rover.pos.z));
        if (bottom <= g + 0.02) {
          sim.pos.copy(edl.rover.pos);
          sim.quat.copy(edl.rover.quat);
          sim.vel.set(0, -0.75, 0);
          sim.ang.set(0, 0, 0);
          for (const w of sim.wheels) {
            w.comp = 0;
            w.omega = 0;
          }
          sim.enabled = true;
          edl.touchdown();
        }
      }
      if (this.mode === "descent") {
        this.rover.standing = edl.attached ? edl.standing : 1;
        this.rover.deploy = edl.deploy;
        if (edl.phase === "done") this.startDrive();
      }
      for (const snd of edl.sounds.splice(0)) {
        const d = snd.at ? snd.at.distanceTo(this.camera.position) : 0;
        this.audio.hit(snd.s === "engines" ? "pyro" : snd.s === "cut" ? "pyro" : snd.s, snd.s === "chute" ? 1 : 0.9, d);
        if (snd.s === "crash" && snd.at) this.burst(snd.at, this.quality >= 1 ? 260 : 140, 16, 1.6);
        if (snd.s === "thud" && snd.at) this.burst(snd.at, 50, 6, 0.8);
      }
      for (const l of edl.landed.splice(0)) {
        const label = l.kind === "shield" ? "Heat shield" : l.kind === "backshell" ? "Backshell & parachute" : "Descent stage crash site";
        if (W.surface !== "deck") {
          this.pois.push({ id: l.kind, label, x: l.at.x, z: l.at.z, found: false });
          useRover.getState().set({ pois: [...this.pois] });
        }
      }
      // rocket blast on the ground under the stage: a ring of dust racing outward from under each engine pair
      const gH = ws.ground.height(edl.stagePos.x, edl.stagePos.z);
      const stageAlt = edl.stagePos.y - gH;
      if (edl.throttle > 0.05 && stageAlt < 55 && stageAlt > -1 && W.soil.dust > 0) {
        const k = edl.throttle * Math.pow(1 - stageAlt / 55, 1.5) * W.soil.dust;
        const q = this.quality >= 2 ? 1 : this.quality >= 1 ? 0.6 : 0.35;
        const n = Math.floor(k * 110 * q * dt * 60) + (Math.random() < 0.5 ? 1 : 0);
        const vac = W.atm.rho < 0.001;
        const blast = Math.min(1, 10 / Math.max(stageAlt, 3));
        for (let i = 0; i < n; i++) {
          const a = Math.random() * Math.PI * 2;
          const r0 = 1.5 + Math.random() * (2 + stageAlt * 0.25);
          const sp = (vac ? 18 + Math.random() * 24 : 6 + Math.random() * 12) * (0.5 + blast * 0.8);
          tmpV.set(Math.cos(a) * sp, vac ? 0.5 + Math.random() * 1.8 : 0.6 + Math.random() * 3.2, Math.sin(a) * sp);
          tmpV2.set(edl.stagePos.x + Math.cos(a) * r0, 0, edl.stagePos.z + Math.sin(a) * r0);
          tmpV2.y = ws.ground.height(tmpV2.x, tmpV2.z) + 0.25;
          // in thick air (Titan, Venus) the dust hangs where it is thrown, so throw less of it
          const thick = W.soil.dustDrag > 3;
          ws.dust.emit(tmpV2, tmpV, vac ? 1 : 2.5, vac ? 0.35 : 1.0 + Math.random() * 1.4, vac ? 3 : thick ? 2.6 : 5.5, vac ? 0.5 : thick ? 0.14 : 0.32, vac ? 0 : thick ? 1.2 : 2.2);
        }
      }
    }

    // —— rover pose, dust, tracks ——
    const pose = sim.enabled ? null : edl ? edl.rover : null;
    this.rover.update(dt, sim.enabled ? sim : null, pose ?? { pos: sim.pos, quat: sim.quat }, W.soil.track * 0.05);
    this.rover.aimHGA(ws.sky.earthDir(tmpV));
    if (sim.enabled) this.emitWheelDust(dt);
    for (const ev of sim.events.splice(0)) {
      if (ev.type === "land") {
        this.cam.shake = Math.min(1, ev.impact / 6);
        this.audio.hit("thud", Math.min(1, ev.impact / 5), 1);
        this.burst(sim.pos.clone().setY(ws.ground.height(sim.pos.x, sim.pos.z)), Math.min(120, ev.impact * 20), 3, 0.6);
        if (ev.air > 0.6) {
          const kE = W.g / EARTH;
          const sub = Math.abs(kE - 1) > 0.05 ? `Same launch on Earth: ${(ev.air * kE).toFixed(2)} s, ${(ev.height * kE).toFixed(1)} m high` : `${ev.dist.toFixed(0)} m long`;
          announce(`Air ${ev.air.toFixed(1)} s · ${ev.height.toFixed(1)} m high · ${ev.dist.toFixed(0)} m`, ev.air > 3 ? "gold" : "good", sub);
          if (ev.air > st.bestAir) useRover.getState().set({ bestAir: ev.air });
        }
      } else if (ev.type === "bump") {
        this.audio.hit("thud", ev.strength * 0.7, 1);
        this.cam.shake = Math.max(this.cam.shake, ev.strength * 0.5);
      } else if (ev.type === "scrape") {
        this.audio.hit("scrape", ev.strength, 1);
        this.cam.shake = Math.max(this.cam.shake, ev.strength * 0.4);
      }
    }
    if (sim.enabled) this.rover.dust = Math.min(0.55, sim.odometer / 4000) * W.soil.dust;

    // —— sampling with the arm ——
    if (this.sampleT >= 0) {
      this.sampleT += dt;
      if (this.sampleT > 2.2 && this.sampleT < 5.5 && W.soil.dust > 0) {
        const tip = this.rover.drillTip(new THREE.Vector3());
        if (Math.random() < dt * 30) ws.dust.emit(tip, new THREE.Vector3(0, 0.4, 0), 0.6, 0.08, 1.5, 0.6, 0.1);
      }
      if (this.sampleT > 5.5 && !useRover.getState().sample) {
        useRover.getState().set({ sample: { ...W.sample, done: true } });
        announce("Sample analysed", "gold", W.sample.title);
        this.rover.armTarget = 0;
      }
      if (this.sampleT > 7.5) this.sampleT = -1;
    }

    // —— the world around the rover ——
    const focus = sim.enabled ? sim.pos : edl ? (edl.attached ? edl.rover.pos : sim.pos) : sim.pos;
    this.updateCamera(dt, focus);
    const cam = this.camera.position;
    ws.tmesh?.update(focus, cam);
    ws.rocks?.update(focus.x, focus.z);
    ws.dust.focus(focus.x, focus.z);
    ws.dust.update(dt, sim.wind);
    ws.deck?.update(dt, this.t);
    const camAlt = cam.y - Math.max(ws.ground.height(cam.x, cam.z), -400);
    ws.sky.update(cam, camAlt);
    // shadow box follows the rover, snapped to texels so it doesn't shimmer
    const sc = this.sun.shadow.camera as THREE.OrthographicCamera;
    const texel = (sc.right - sc.left) / this.sun.shadow.mapSize.x;
    const fx = Math.round(focus.x / texel) * texel;
    const fz = Math.round(focus.z / texel) * texel;
    this.sun.target.position.set(fx, focus.y, fz);
    this.sun.position.set(fx, focus.y, fz).addScaledVector(ws.sky.sunDir, 250);
    this.sun.target.updateMatrixWorld();

    // —— gas giants: falling off the deck ——
    if (W.surface === "deck" && sim.enabled && sim.pos.y < -25 && this.mode === "drive") {
      this.mode = "lost";
      this.lostT = 0;
      useRover.getState().set({ phase: "lost" });
      announce("Off the edge!", "warn", `Falling into ${W.name} — there is no surface below`);
    }
    if (this.mode === "lost") {
      this.lostT += dt;
      const depth = -sim.pos.y;
      if (depth > 300 && !st.lost) {
        const vt = Math.sqrt((2 * ROVER.mass * W.g) / (W.atm.rho * ROVER.cdA));
        useRover.getState().set({
          lost: `Signal lost ${Math.round(depth)} m below the deck, falling at ${Math.round(sim.vel.length())} m/s (terminal velocity here: ${Math.round(vt)} m/s). With nothing to stop it, the rover would keep sinking for hours — past 100 bar and +300 °C — until the pressure crushed it.`,
        });
      }
    }

    // —— discoveries ——
    if (this.mode === "drive") {
      let changed = false;
      for (const p of this.pois) {
        if (!p.found && Math.hypot(p.x - sim.pos.x, p.z - sim.pos.z) < 14) {
          p.found = true;
          changed = true;
          announce(`Found: ${p.label}`, "gold", "Visited by your rover — logged in the mission record");
        }
      }
      if (changed) useRover.getState().set({ pois: [...this.pois] });
      const last = this.trail[this.trail.length - 1];
      if (!last || Math.hypot(last.x - sim.pos.x, last.y - sim.pos.z) > 2) {
        this.trail.push(new THREE.Vector2(sim.pos.x, sim.pos.z));
        if (this.trail.length > 3000) this.trail.shift();
      }
      // world facts, one by one, early on
      this.factT += dt;
      if (this.factT > 9 && this.factI < W.facts.length) {
        announce(W.facts[this.factI++], "info");
        this.factT = 0;
      }
      this.warnings(dt);
      if (sim.overturned > 2.5 && !st.overturned) useRover.getState().set({ overturned: true });
      if (sim.overturned === 0 && st.overturned) useRover.getState().set({ overturned: false });
    }

    // —— sound ——
    let wheelSpd = 0;
    let torque = 0;
    let contact = 0;
    let slip = 0;
    for (const w of sim.wheels) {
      wheelSpd += Math.abs(w.omega) / 6;
      torque += Math.abs(w.torque);
      contact += w.contact ? 1 / 6 : 0;
      slip += Math.abs(w.slip) / 6;
    }
    const thrust = edl && edl.throttle > 0 ? edl.throttle * clamp(1 - edl.stagePos.distanceTo(cam) / 600, 0, 1) : 0;
    this.audio.update({
      wheel: sim.enabled ? wheelSpd : 0,
      torque: sim.enabled ? torque : 0,
      ground: sim.enabled ? Math.hypot(sim.vel.x, sim.vel.z) : 0,
      contact,
      slip,
      wind: sim.wind.length() + (this.mode === "descent" && edl?.phase === "chute" ? 25 : 0),
      thrust,
      attached: !!edl?.attached,
      rough: W.surface === "deck" ? 0.4 : 1,
    });

    // —— HUD telemetry, 10× a second ——
    this.teleT += dt;
    if (this.teleT > 0.1) {
      this.teleT = 0;
      this.pushTelemetry();
    }
  }

  private warnings(dt: number) {
    const sim = this.sim!;
    this.warnT -= dt;
    if (this.warnT > 0) return;
    const up = tmpV.set(0, 1, 0).applyQuaternion(sim.quat);
    const tilt = THREE.MathUtils.radToDeg(Math.acos(clamp(up.y, -1, 1)));
    let avgSlip = 0;
    let n = 0;
    for (const w of sim.wheels)
      if (w.contact) {
        avgSlip += Math.abs(w.slip) / Math.max(0.3, Math.abs(w.omega * ROVER.wheelR));
        n++;
      }
    avgSlip = n ? avgSlip / n : 0;
    if (tilt > 25 && !sim.airborne) {
      announce(`Tilt ${tilt.toFixed(0)}°`, "warn", "Curiosity's drivers keep it under 30° to avoid a rollover");
      this.warnT = 6;
    } else if (avgSlip > 0.6 && Math.abs(sim.input.throttle) > 0.5 && n >= 4) {
      announce(`Wheel slip ${Math.min(99, avgSlip * 100).toFixed(0)}%`, "warn", sim.world.g < 2 ? "Low gravity: little weight on the wheels, little grip" : "Traction lost");
      this.warnT = 7;
    } else if (sim.battery < 0.15 && sim.battery > 0.01) {
      announce("Battery low", "warn", "The MMRTG makes only ~110 W — drive slowly or park to recharge");
      this.warnT = 15;
    }
  }

  private emitWheelDust(dt: number) {
    const ws = this.ws!;
    const sim = this.sim!;
    const W = ws.world;
    const weight = (ROVER.mass * W.g) / 6;
    for (let i = 0; i < 6; i++) {
      const w = sim.wheels[i];
      if (!w.contact) continue;
      const surf = Math.abs(w.omega * ROVER.wheelR);
      const ground = Math.abs(w.fwd.dot(sim.vel));
      if (!w.onRock) ws.tracks.stamp(i, w.point, w.normal, w.fwd, w.load / weight);
      if (W.soil.dust <= 0 || w.onRock) continue;
      const rate = W.soil.dust * (ground * 6 + Math.abs(w.slip) * 18 + Math.abs(w.lat) * 8);
      this.dustAcc[i] += rate * dt;
      while (this.dustAcc[i] >= 1) {
        this.dustAcc[i] -= 1;
        // grains leave the back of the wheel at its rim speed (a rooster tail), plus the rover's velocity
        const back = -Math.sign(w.omega || 1);
        tmpV.copy(w.fwd).multiplyScalar(back * surf * 0.45).addScaledVector(w.normal, 0.4 + surf * 0.32 + Math.random() * 0.5).addScaledVector(sim.vel, 0.55);
        tmpV2.copy(w.point).addScaledVector(w.fwd, back * 0.22).addScaledVector(w.normal, 0.05);
        const vac = W.atm.rho < 0.001;
        ws.dust.emit(tmpV2, tmpV, 0.6 + surf * 0.15, vac ? 0.2 : 0.5, vac ? 2.5 : W.soil.dustDrag > 4 ? 1.6 : 4.5, vac ? 0.7 : 0.42, vac ? 0 : 0.45 * (1 + 1 / (1 + W.soil.dustDrag)));
      }
    }
  }

  private burst(at: THREE.Vector3, n: number, speed: number, size: number) {
    const ws = this.ws;
    if (!ws || ws.world.soil.dust <= 0) return;
    const vac = ws.world.atm.rho < 0.001;
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const s = speed * (0.3 + Math.random() * 0.7);
      tmpV.set(Math.cos(a) * s, s * (0.3 + Math.random() * 0.6), Math.sin(a) * s);
      ws.dust.emit(at, tmpV, speed * 0.2, size, vac ? 3 : 6, 0.45, vac ? 0 : size * 0.8);
    }
  }

  private updateCamera(dt: number, focus: THREE.Vector3) {
    const st = useRover.getState();
    const edl = this.edl;
    const sim = this.sim!;
    const c = this.cam;
    c.shake = Math.max(0, c.shake - dt * 2.5);
    if (this.mode === "descent" && edl) {
      const sh = edl.shot;
      if (sh.cut) {
        c.pos.copy(sh.pos);
        c.look.copy(sh.look);
      } else {
        c.pos.lerp(sh.pos, 1 - Math.exp(-3.5 * dt));
        c.look.lerp(sh.look, 1 - Math.exp(-6 * dt));
      }
      c.fov = damp(c.fov, sh.fov, 4, dt);
      const shake = sh.shake * (0.5 + Math.random());
      const p = c.pos.clone().add(new THREE.Vector3((Math.random() - 0.5) * shake * 40, (Math.random() - 0.5) * shake * 40, 0));
      this.setCamera(p, c.look, c.fov, 0.3, 60000, sh.up);
      c.heading = this.headingOf(sim.enabled ? sim.quat : edl.rover.quat);
      return;
    }
    if (this.liftoff >= 0) {
      // rise away from the surface
      c.pos.y += dt * (20 + this.liftoff * 80);
      this.setCamera(c.pos, focus, c.fov, 0.3, 60000);
      return;
    }
    const quat = sim.enabled ? sim.quat : edl!.rover.quat;
    const fwd = new THREE.Vector3(0, 0, 1).applyQuaternion(quat);
    const heading = Math.atan2(fwd.x, fwd.z);
    // follow the heading with some lag
    let dh = heading - c.heading;
    dh = Math.atan2(Math.sin(dh), Math.cos(dh));
    c.heading += dh * (1 - Math.exp(-2.4 * dt));
    if (!this.dragging && this.t - c.dragT > 3) c.yawOff = damp(c.yawOff, 0, 0.8, dt);
    const ground = this.ws!.ground;
    const pos = new THREE.Vector3();
    const look = new THREE.Vector3();
    let fov = 55;
    let near = 0.1;
    const mode: CamMode = this.mode === "lost" ? "chase" : this.mode === "descent" ? "chase" : st.cam;
    this.rover.mastAim = mode === "mast" ? { yaw: c.mastYaw, pitch: c.mastPitch } : null;
    const M = new THREE.Matrix4().compose(focus, quat, new THREE.Vector3(1, 1, 1));
    if (this.mode === "lost") {
      // watch it fall from just past the rim, looking down into the clouds
      const out = new THREE.Vector3(focus.x, 0, focus.z).normalize();
      const edge = out.clone().multiplyScalar(DECK_R + 2);
      const side = new THREE.Vector3(-out.z, 0, out.x);
      pos.set(edge.x, 1.5, edge.z).addScaledVector(side, 6);
      look.copy(focus);
      fov = 55;
    } else if (mode === "chase") {
      const az = c.heading + Math.PI + c.yawOff;
      const d = c.dist;
      pos.set(Math.sin(az) * Math.cos(c.pitch) * d, Math.sin(c.pitch) * d + 1.3, Math.cos(az) * Math.cos(c.pitch) * d).add(focus);
      look.copy(focus).add(new THREE.Vector3(0, 0.9, 0));
    } else if (mode === "mast") {
      this.rover.mastCamera(pos);
      const yaw = c.heading + c.mastYaw;
      const dir = new THREE.Vector3(Math.sin(yaw) * Math.cos(c.mastPitch), Math.sin(c.mastPitch), Math.cos(yaw) * Math.cos(c.mastPitch));
      pos.addScaledVector(dir, 0.3);
      look.copy(pos).add(dir);
      fov = 45;
      near = 0.05;
    } else if (mode === "hazcam") {
      pos.set(0, -0.02, 1.25).applyMatrix4(M);
      look.set(0, -1.1, 6).applyMatrix4(M);
      fov = 105;
      near = 0.05;
    } else if (mode === "wheel") {
      pos.set(2.05, -0.3, -0.35).applyMatrix4(M);
      look.set(1.3, -0.45, 3).applyMatrix4(M);
      fov = 68;
      near = 0.05;
    } else {
      // cinematic: rotate through set-ups every few seconds
      c.cineT -= dt;
      if (c.cineT <= 0) {
        c.cineShot = (c.cineShot + 1) % 4;
        c.cineT = 7;
        const ahead = fwd.clone().setY(0).normalize();
        const side = new THREE.Vector3(ahead.z, 0, -ahead.x);
        if (c.cineShot === 0) {
          c.cinePos.copy(focus).addScaledVector(ahead, 22 + Math.abs(sim.forwardSpeed()) * 3).addScaledVector(side, 6);
          c.cinePos.y = ground.height(c.cinePos.x, c.cinePos.z) + 1.4;
        } else if (c.cineShot === 3) {
          c.cinePos.copy(focus).addScaledVector(side, -50).addScaledVector(ahead, 20);
          c.cinePos.y = ground.height(c.cinePos.x, c.cinePos.z) + 24;
        }
        c.cineAngle = Math.random() * Math.PI * 2;
      }
      if (c.cineShot === 0 || c.cineShot === 3) {
        pos.copy(c.cinePos);
        fov = c.cineShot === 0 ? 38 : 30;
      } else if (c.cineShot === 1) {
        c.cineAngle += dt * 0.18;
        pos.set(Math.sin(c.cineAngle) * 13, 5.5, Math.cos(c.cineAngle) * 13).add(focus);
        fov = 45;
      } else {
        pos.set(1.6, -0.25, -5.5).applyMatrix4(M);
        fov = 60;
      }
      look.copy(focus).add(new THREE.Vector3(0, 0.6, 0));
    }
    // keep the camera above the ground
    if (mode === "chase" || mode === "cinematic") {
      const gy = ground.ground(pos.x, pos.z);
      if (gy > -1000) pos.y = Math.max(pos.y, gy + 0.6);
    }
    const snap = mode !== "chase" && mode !== "cinematic";
    if (snap || this.mode === "lost" || c.snapNext) {
      c.snapNext = false;
      c.pos.copy(pos);
      c.look.copy(look);
    } else {
      c.pos.lerp(pos, 1 - Math.exp(-(mode === "cinematic" ? 2 : 9) * dt));
      c.look.lerp(look, 1 - Math.exp(-12 * dt));
    }
    c.fov = damp(c.fov, fov, 5, dt);
    const shake = c.shake * c.shake * 0.25;
    const p = c.pos.clone().add(new THREE.Vector3((Math.random() - 0.5) * shake, (Math.random() - 0.5) * shake, (Math.random() - 0.5) * shake));
    this.setCamera(p, c.look, c.fov, near, 60000);
  }

  private headingOf(q: THREE.Quaternion) {
    const f = new THREE.Vector3(0, 0, 1).applyQuaternion(q);
    return Math.atan2(f.x, f.z);
  }

  private pushTelemetry() {
    const sim = this.sim;
    const ws = this.ws;
    const edl = this.edl;
    if (!sim || !ws) return;
    const st = useRover.getState();
    if (this.mode === "descent" && edl) {
      const roverY = edl.attached ? edl.rover.pos.y : sim.pos.y;
      const alt = Math.max(0, roverY - 0.82 - ws.ground.height(edl.rover.pos.x, edl.rover.pos.z));
      const names: Record<string, string> = { chute: "Parachute descent", separation: "Backshell separation", powered: "Powered descent", skycrane: "Sky crane", touchdown: "Touchdown", flyaway: "Flyaway", done: "Rover deployed" };
      st.set({ edl: { phase: names[edl.phase], alt, v: edl.vReal, ts: edl.timeScale, log: [...edl.log] } });
    }
    const fwd = tmpV.set(0, 0, 1).applyQuaternion(sim.quat);
    const up = tmpV2.set(0, 1, 0).applyQuaternion(sim.quat);
    const right = new THREE.Vector3().crossVectors(fwd, up);
    const pitch = THREE.MathUtils.radToDeg(Math.asin(clamp(fwd.y, -1, 1)));
    const roll = THREE.MathUtils.radToDeg(Math.asin(clamp(-right.y, -1, 1)));
    let heading = THREE.MathUtils.radToDeg(Math.atan2(fwd.x, fwd.z));
    heading = (heading + 360) % 360;
    let slip = 0;
    let n = 0;
    for (const w of sim.wheels)
      if (w.contact) {
        slip += Math.abs(w.slip) / Math.max(0.3, Math.abs(w.omega * ROVER.wheelR));
        n++;
      }
    const weight = (ROVER.mass * ws.world.g) / 6;
    st.set({
      tele: {
        speed: sim.forwardSpeed(),
        ground: Math.hypot(sim.vel.x, sim.vel.z),
        odo: sim.odometer,
        pitch,
        roll,
        heading,
        battery: sim.battery,
        power: sim.powerW,
        gLoad: sim.gLoad,
        air: sim.airborne ? sim.airT : 0,
        slip: n ? Math.min(1, slip / n) : 0,
        elev: sim.pos.y,
        wind: sim.wind.length(),
        pointTurn: sim.pointTurn,
        wheels: sim.wheels.map((w) => ({ load: w.load / weight, contact: w.contact, slip: w.slip, steer: w.steer })),
        x: sim.pos.x,
        z: sim.pos.z,
      },
    });
  }

  // ———————————————————————————— minimap ————————————————————————————

  private drawMinimap(ctx: CanvasRenderingContext2D, W: number, H: number) {
    const ws = this.ws;
    const sim = this.sim;
    ctx.clearRect(0, 0, W, H);
    if (!ws || !sim) return;
    const size = 420;
    const n = 70;
    // shaded relief, rebuilt in slices as the rover roams
    let mm = this.miniMap;
    if (!mm || Math.hypot(mm.cx - sim.pos.x, mm.cz - sim.pos.z) > 130) {
      mm = this.miniMap = { cx: Math.round(sim.pos.x), cz: Math.round(sim.pos.z), img: null, heights: new Float32Array(n * n), k: 0, n, size, minH: Infinity, maxH: -Infinity };
    }
    if (mm.k < n * n) {
      const end = Math.min(n * n, mm.k + 700);
      for (; mm.k < end; mm.k++) {
        const i = mm.k % n;
        const j = Math.floor(mm.k / n);
        const x = mm.cx - size / 2 + (i / (n - 1)) * size;
        const z = mm.cz - size / 2 + (j / (n - 1)) * size;
        const h = ws.ground.height(x, z);
        mm.heights[mm.k] = h;
        if (h > -1000) {
          mm.minH = Math.min(mm.minH, h);
          mm.maxH = Math.max(mm.maxH, h);
        }
      }
      if (mm.k >= n * n) {
        const img = new ImageData(n, n);
        const lo = new THREE.Color(ws.world.palette.low);
        const hi = new THREE.Color(ws.world.palette.high);
        const sd = ws.sky.sunDir;
        const cell = size / (n - 1);
        for (let j = 0; j < n; j++)
          for (let i = 0; i < n; i++) {
            const h = mm.heights[j * n + i];
            const o = (j * n + i) * 4;
            if (h < -1000) {
              img.data.set([20, 22, 28, 255], o);
              continue;
            }
            const hx = mm.heights[j * n + Math.min(n - 1, i + 1)] - mm.heights[j * n + Math.max(0, i - 1)];
            const hz = mm.heights[Math.min(n - 1, j + 1) * n + i] - mm.heights[Math.max(0, j - 1) * n + i];
            const nx = -hx / (2 * cell);
            const nz = -hz / (2 * cell);
            const shade = clamp((nx * sd.x + sd.y + nz * sd.z) / Math.hypot(nx, 1, nz) / Math.max(sd.y, 0.3), 0.25, 1.5);
            const t = (h - mm.minH) / Math.max(1, mm.maxH - mm.minH);
            const c = lo.clone().lerp(hi, t).convertLinearToSRGB().multiplyScalar(shade * 0.9);
            img.data.set([clamp(c.r * 255, 0, 255), clamp(c.g * 255, 0, 255), clamp(c.b * 255, 0, 255), 255], o);
          }
        mm.img = img;
      }
    }
    const scale = W / 260;
    const toX = (x: number) => W / 2 + (x - sim.pos.x) * scale;
    const toY = (z: number) => H / 2 + (z - sim.pos.z) * scale;
    if (mm.img) {
      const off = document.createElement("canvas");
      off.width = off.height = n;
      off.getContext("2d")!.putImageData(mm.img, 0, 0);
      ctx.imageSmoothingEnabled = true;
      const x0 = toX(mm.cx - size / 2);
      const y0 = toY(mm.cz - size / 2);
      ctx.drawImage(off, x0, y0, size * scale, size * scale);
    }
    if (ws.world.surface === "deck") {
      ctx.strokeStyle = "rgba(242,183,5,0.8)";
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(toX(0), toY(0), DECK_R * scale, 0, Math.PI * 2);
      ctx.stroke();
    }
    // the trail
    ctx.strokeStyle = "rgba(200,255,61,0.85)";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    this.trail.forEach((p, i) => (i ? ctx.lineTo(toX(p.x), toY(p.y)) : ctx.moveTo(toX(p.x), toY(p.y))));
    ctx.stroke();
    // landing site and places to find
    ctx.fillStyle = "#ffffff";
    ctx.font = "600 9px ui-monospace, monospace";
    const site = ws.site;
    ctx.strokeStyle = "#ffffff";
    ctx.beginPath();
    ctx.arc(toX(site.x), toY(site.z), 4, 0, Math.PI * 2);
    ctx.stroke();
    for (const p of this.pois) {
      let x = toX(p.x);
      let y = toY(p.z);
      const inside = x > 6 && y > 6 && x < W - 6 && y < H - 6;
      if (!inside) {
        // pin to the rim, pointing the way
        const a = Math.atan2(y - H / 2, x - W / 2);
        x = W / 2 + Math.cos(a) * (W / 2 - 7);
        y = H / 2 + Math.sin(a) * (H / 2 - 7);
      }
      ctx.fillStyle = p.found ? "#c8ff3d" : "#ffb020";
      ctx.beginPath();
      ctx.moveTo(x, y - 5);
      ctx.lineTo(x + 4, y);
      ctx.lineTo(x, y + 5);
      ctx.lineTo(x - 4, y);
      ctx.fill();
    }
    // the rover
    const fwd = tmpV.set(0, 0, 1).applyQuaternion(sim.quat);
    const a = Math.atan2(fwd.z, fwd.x);
    ctx.save();
    ctx.translate(W / 2, H / 2);
    ctx.rotate(a);
    ctx.fillStyle = "#ffffff";
    ctx.beginPath();
    ctx.moveTo(8, 0);
    ctx.lineTo(-5, 5);
    ctx.lineTo(-2, 0);
    ctx.lineTo(-5, -5);
    ctx.fill();
    ctx.restore();
  }

  dispose() {
    this.disposeWorld();
    this.endApproach();
    this.space.dispose();
    this.rover.dispose();
    this.audio.stop();
    this.tex.noise.dispose();
    this.tex.grain.dispose();
  }
}
