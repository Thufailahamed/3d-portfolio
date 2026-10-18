import * as THREE from "three";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import { pieceGeometry, plasticMaterial } from "./geometry";

/** where the wand's swivel sits on the floor head (head frame: x across, y up, z forward) */
const KNUCKLE = new THREE.Vector3(0, 1.45, -1.75);
const NECK = 2.4;
/** swivel to hand, and how steeply the wand leans back */
const REACH = 21;
const ELEVATION = 0.6;
/** the miniature bricks rattling round the bin, and how many it holds */
const BIN_R = 2.05;
const BIN_SCALE = 0.26;
const PER_LAYER = 16;
const LAYERS = 13;
const CAPACITY = PER_LAYER * LAYERS;
const SWIRL = 1.05;

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const damp = (a: number, b: number, rate: number, dt: number) => lerp(a, b, 1 - Math.exp(-rate * dt));
const angleDamp = (a: number, b: number, rate: number, dt: number) => {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return a + d * (1 - Math.exp(-rate * dt));
};

function canvasTexture(w: number, h: number, draw: (ctx: CanvasRenderingContext2D) => void, aniso: number) {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  draw(c.getContext("2d")!);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = aniso;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

/** The soft roller: pale nylon felt wound with two helical strips of dark carbon filament. */
function brushTexture(aniso: number) {
  return canvasTexture(
    512,
    128,
    (ctx) => {
      ctx.fillStyle = "#c9c2b6";
      ctx.fillRect(0, 0, 512, 128);
      let seed = 3;
      const rand = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
      // felt: thousands of short fibres
      for (let i = 0; i < 14000; i++) {
        const x = rand() * 512;
        const y = rand() * 128;
        ctx.strokeStyle = rand() > 0.5 ? "rgba(255,255,255,0.18)" : "rgba(70,60,50,0.14)";
        ctx.lineWidth = 0.7;
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x + (rand() - 0.5) * 4, y + (rand() - 0.5) * 4);
        ctx.stroke();
      }
      // two helices: a diagonal that wraps round (u along the roller, v round it)
      for (const off of [0, 64]) {
        for (let k = -2; k <= 2; k++) {
          ctx.strokeStyle = "rgba(24,24,28,0.92)";
          ctx.lineWidth = 7;
          ctx.beginPath();
          ctx.moveTo(k * 256, off - 128);
          ctx.lineTo(k * 256 + 512, off + 128 + 128);
          ctx.stroke();
          ctx.strokeStyle = "rgba(200,40,30,0.85)";
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.moveTo(k * 256 + 9, off - 128);
          ctx.lineTo(k * 256 + 512 + 9, off + 128 + 128);
          ctx.stroke();
        }
      }
    },
    aniso,
  );
}

/** Perforated steel: the cyclone shroud and the filter screen. */
function perforatedTexture(aniso: number) {
  const t = canvasTexture(
    256,
    256,
    (ctx) => {
      ctx.fillStyle = "#d4d6da";
      ctx.fillRect(0, 0, 256, 256);
      ctx.fillStyle = "#1a1c20";
      const step = 12;
      for (let row = 0; row * step * 0.866 < 256 + step; row++)
        for (let col = -1; col * step < 256 + step; col++) {
          const x = col * step + (row % 2 ? step / 2 : 0);
          const y = row * step * 0.866;
          ctx.beginPath();
          ctx.arc(x, y, 3.4, 0, Math.PI * 2);
          ctx.fill();
        }
    },
    aniso,
  );
  t.repeat.set(4, 2);
  return t;
}

/** Brushed metal: fine streaks along the length, so highlights stretch the way they do on a tube. */
function brushedTexture(aniso: number) {
  const t = canvasTexture(
    64,
    512,
    (ctx) => {
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, 64, 512);
      let seed = 9;
      const rand = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
      for (let i = 0; i < 900; i++) {
        ctx.fillStyle = `rgba(0,0,0,${0.02 + rand() * 0.05})`;
        ctx.fillRect(rand() * 64, 0, 0.6 + rand(), 512);
      }
    },
    aniso,
  );
  t.colorSpace = THREE.NoColorSpace;
  return t;
}

type Item = { mesh: number; idx: number; r: number; a: number; y: number; q: THREE.Quaternion; spin: THREE.Vector3; born: number };

/**
 * A cordless stick vacuum, at the scale of the brick world: a floor head with a soft roller
 * behind a clear window and a green light that rakes the floor ahead; a swivel neck and a long
 * anodised wand; and the body — a clear cyclone bin (with the bricks it has eaten rattling round
 * inside it), the cyclone pack and motor above, a pistol grip, battery and a little round screen.
 *
 * The head follows the pointer across the floor and swivels the way you'd steer one; the body
 * is held low at the right of the view, as if by the hand behind the camera.
 */
export class Vacuum {
  readonly root = new THREE.Group();
  /** a real light on the head (kept in the scene even when the vacuum isn't, so nothing recompiles) */
  readonly light = new THREE.PointLight("#b8ffd2", 0, 18, 2);
  /** where the floor head is and which way it faces */
  x = 0;
  z = 0;
  yaw = 0;
  /** 0 put away … 1 out and on the floor */
  shown = 0;
  /** motor speed, 0 … 1 (boost) */
  spin = 0;
  count = 0;
  private assembly = new THREE.Group();
  private head = new THREE.Group();
  private brush: THREE.Mesh;
  private neck = new THREE.Group();
  private wand = new THREE.Group();
  private wandTube: THREE.Mesh;
  private body = new THREE.Group();
  private flap = new THREE.Group();
  private fan: THREE.Mesh;
  private fanMat: THREE.ShaderMaterial;
  private led: THREE.MeshBasicMaterial;
  private screenCtx: CanvasRenderingContext2D;
  private screenTex: THREE.CanvasTexture;
  private screenKey = "";
  private screenAt = 0;
  private bins: THREE.InstancedMesh[] = [];
  private items: Item[] = [];
  private emptying = -1;
  private vx = 0;
  private vz = 0;
  private placed = false;
  private fresh = false;
  /** which side of the head the hand is on (+1 the camera's right), and the swing between them */
  private side = 1;
  private hand = 1;
  private battery = 100;
  private bob = 0;
  private bin = new THREE.Vector3();
  /** the wand (swivel to body) and the body (bottom to top), for what they bump into */
  readonly wandLine = { k: new THREE.Vector3(), b: new THREE.Vector3(), top: new THREE.Vector3() };
  private materials: THREE.Material[] = [];
  private m = new THREE.Matrix4();
  private v = new THREE.Vector3();
  private v2 = new THREE.Vector3();
  private q = new THREE.Quaternion();
  private s = new THREE.Vector3();
  private up = new THREE.Vector3(0, 1, 0);

  constructor(aniso: number) {
    this.root.add(this.assembly);
    this.root.add(this.light);
    this.assembly.visible = false;

    const brushed = brushedTexture(aniso);
    const own = <T extends THREE.Material>(m: T) => (this.materials.push(m), m);
    const shell = own(new THREE.MeshPhysicalMaterial({ color: "#3b3e46", metalness: 0.3, roughness: 0.4, clearcoat: 0.9, clearcoatRoughness: 0.18, envMapIntensity: 2 }));
    const shellLight = own(new THREE.MeshPhysicalMaterial({ color: "#9a9ea6", metalness: 0.6, roughness: 0.32, clearcoat: 0.6, clearcoatRoughness: 0.25, envMapIntensity: 2.4 }));
    const nickel = own(new THREE.MeshPhysicalMaterial({ color: "#d2d4d8", metalness: 1, roughness: 0.22, roughnessMap: brushed, envMapIntensity: 3 }));
    // anodised aluminium: the dye sits under a hard clear skin
    const anodised = own(new THREE.MeshPhysicalMaterial({ color: "#8f63ff", metalness: 0.85, roughness: 0.26, roughnessMap: brushed, clearcoat: 1, clearcoatRoughness: 0.08, envMapIntensity: 2.6 }));
    const dark = own(new THREE.MeshPhysicalMaterial({ color: "#1d1e22", roughness: 0.5, clearcoat: 0.35, clearcoatRoughness: 0.4 }));
    const rubber = own(new THREE.MeshStandardMaterial({ color: "#131416", roughness: 0.88, envMapIntensity: 0.4 }));
    const red = own(new THREE.MeshPhysicalMaterial({ color: "#d3271c", roughness: 0.32, clearcoat: 0.9, clearcoatRoughness: 0.12 }));
    const clear = own(
      new THREE.MeshPhysicalMaterial({
        color: "#eef4f6",
        transparent: true,
        opacity: 0.17,
        roughness: 0.03,
        metalness: 0,
        clearcoat: 1,
        clearcoatRoughness: 0.02,
        ior: 1.58,
        specularIntensity: 1,
        envMapIntensity: 4,
        depthWrite: false,
        side: THREE.DoubleSide,
      }),
    );
    const perforated = perforatedTexture(aniso);
    const shroudMat = own(new THREE.MeshPhysicalMaterial({ color: "#ffffff", map: perforated, metalness: 0.85, roughness: 0.3, envMapIntensity: 2.6 }));
    const felt = own(new THREE.MeshPhysicalMaterial({ map: brushTexture(aniso), roughness: 0.96, sheen: 1, sheenRoughness: 0.45, sheenColor: new THREE.Color("#ffffff"), envMapIntensity: 0.5 }));
    this.led = own(new THREE.MeshBasicMaterial({ color: new THREE.Color("#3dff86").multiplyScalar(3.2) }));

    const put = (geo: THREE.BufferGeometry, mat: THREE.Material, parent: THREE.Object3D, x = 0, y = 0, z = 0, shadow = true) => {
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(x, y, z);
      mesh.castShadow = shadow;
      mesh.receiveShadow = true;
      parent.add(mesh);
      return mesh;
    };
    const rbox = (w: number, h: number, d: number, r: number) => new RoundedBoxGeometry(w, h, d, 3, Math.min(r, w / 2, h / 2, d / 2) * 0.999);
    /** a cylinder lying along x */
    const xcyl = (r: number, len: number, seg = 40, open = false) => new THREE.CylinderGeometry(r, r, len, seg, 1, open).rotateZ(Math.PI / 2);
    const lathe = (pts: [number, number][], seg = 48) => new THREE.LatheGeometry(pts.map(([r, y]) => new THREE.Vector2(Math.max(r, 1e-4), y)), seg);

    // ——— the floor head ———
    const h = this.head;
    this.assembly.add(h);
    // the main housing: a low wedge, rounded at every edge, sloping down to the front
    put(rbox(12, 1.55, 2.9, 0.42), shell, h, 0, 1.1, -0.65);
    put(rbox(11.2, 0.5, 2.5, 0.22), shellLight, h, 0, 1.92, -0.85);
    // a raised spine running back to the swivel, anodised to match the wand, edged in nickel
    put(rbox(2.4, 0.3, 2.6, 0.14), anodised, h, 0, 2.14, -0.95);
    for (const sx of [-1, 1]) put(rbox(0.08, 0.06, 2.5, 0.03), nickel, h, sx * 1.24, 2.2, -0.95, false);
    // vents on top, either side of the spine
    for (const sx of [-1, 1])
      for (let i = 0; i < 6; i++) put(rbox(0.16, 0.08, 1.7, 0.04), dark, h, sx * (2.1 + i * 0.55), 2.18, -0.9, false);
    // the soft roller, under a clear hood, between nickel end caps
    this.brush = put(xcyl(0.82, 11.1, 48), felt, h, 0, 0.84, 1.42);
    put(xcyl(0.3, 11.5, 24), dark, h, 0, 0.84, 1.42);
    const hood = new THREE.CylinderGeometry(1.0, 1.0, 11.3, 48, 1, true, -0.4, 2.3).rotateZ(Math.PI / 2);
    put(hood, clear, h, 0, 0.86, 1.42, false).renderOrder = 3;
    for (const sx of [-1, 1]) {
      put(xcyl(1.02, 0.34, 40), nickel, h, sx * 5.82, 0.86, 1.42);
      put(xcyl(0.42, 0.38, 24), dark, h, sx * 5.86, 0.86, 1.42);
    }
    // the hood's frame, front lip and side skirts
    put(rbox(12, 0.18, 0.3, 0.08), dark, h, 0, 1.86, 1.0);
    put(rbox(12.1, 0.22, 0.24, 0.1), rubber, h, 0, 0.12, 2.2);
    for (const sx of [-1, 1]) put(rbox(0.3, 1.3, 2.6, 0.12), shell, h, sx * 6.05, 0.95, -0.75);
    // the light: a lens at the front corner and a slim strip along the lip
    put(rbox(0.5, 0.36, 0.3, 0.1), dark, h, -5.4, 0.42, 2.25);
    put(new THREE.CircleGeometry(0.14, 20), this.led, h, -5.4, 0.42, 2.41, false);
    put(rbox(9.6, 0.06, 0.06, 0.025), this.led, h, 0.4, 1.82, 1.16, false);
    // rear rollers
    for (const sx of [-1, 1]) {
      const wheel = put(xcyl(0.42, 0.55, 28), rubber, h, sx * 4.9, 0.42, -1.8);
      wheel.userData.wheel = true;
      put(xcyl(0.24, 0.58, 20), shellLight, h, sx * 4.9, 0.42, -1.8);
    }
    // the swivel: a ball in a yoke
    put(new THREE.SphereGeometry(0.78, 32, 20), nickel, h, KNUCKLE.x, KNUCKLE.y, KNUCKLE.z);
    for (const sx of [-1, 1]) put(rbox(0.28, 1.5, 1.7, 0.12), shell, h, sx * 0.95, 1.2, -1.6);
    // the floor light: a fan of green raking ahead, picking out every stud and stray brick
    this.fanMat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      fog: false,
      uniforms: { uK: { value: 0 }, uTime: { value: 0 } },
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }`,
      fragmentShader: /* glsl */ `
        uniform float uK;
        uniform float uTime;
        varying vec2 vUv;
        void main() {
          float along = vUv.y;
          float across = abs(vUv.x - 0.5) * 2.0;
          float fall = pow(1.0 - along, 1.7) * smoothstep(0.0, 0.06, along);
          float edge = 1.0 - smoothstep(0.7, 1.0, across);
          float shimmer = 0.85 + 0.15 * sin(along * 90.0 - uTime * 6.0 + vUv.x * 13.0);
          gl_FragColor = vec4(vec3(0.24, 1.0, 0.52) * fall * edge * shimmer * uK, 1.0);
        }`,
    });
    this.materials.push(this.fanMat);
    {
      // a trapezoid on the floor: the lip's width at the head, twice that far out
      const g = new THREE.BufferGeometry();
      const near = 6.2;
      const far = 13;
      const len = 17;
      g.setAttribute("position", new THREE.Float32BufferAttribute([-near, 0, 0, near, 0, 0, far, 0, len, -far, 0, len], 3));
      g.setAttribute("uv", new THREE.Float32BufferAttribute([0, 0, 1, 0, 1, 1, 0, 1], 2));
      g.setIndex([0, 2, 1, 0, 3, 2]);
      this.fan = new THREE.Mesh(g, this.fanMat);
      this.fan.position.set(0, 0.06, 2.3);
      this.fan.renderOrder = 4;
      this.fan.frustumCulled = false;
      h.add(this.fan);
    }

    // ——— the neck (swivels to point up the wand) ———
    this.assembly.add(this.neck);
    put(new THREE.CylinderGeometry(0.56, 0.6, NECK, 32).translate(0, NECK / 2, 0), nickel, this.neck);
    put(new THREE.CylinderGeometry(0.66, 0.66, 0.5, 32).translate(0, NECK - 0.1, 0), dark, this.neck);
    put(rbox(0.36, 0.7, 0.4, 0.1), red, this.neck, 0, NECK - 0.3, -0.62);

    // ——— the wand (its length is whatever reaches the hand) ———
    this.assembly.add(this.wand);
    this.wandTube = put(new THREE.CylinderGeometry(0.46, 0.46, 1, 40, 1, true).translate(0, 0.5, 0), anodised, this.wand);

    // ——— the body: in line with the wand, +y up it, -z towards the hand ———
    const b = this.body;
    this.assembly.add(b);
    put(lathe([[0.62, 0], [0.62, 0.3], [0.5, 0.36], [0.5, 1.1], [0.7, 1.2], [0.7, 1.5]]), dark, b);
    // the clear bin, its hinged floor, rims and the steel shroud in its middle
    put(new THREE.CylinderGeometry(BIN_R, BIN_R, 5.2, 64, 1, true).translate(0, 4.2, 0), clear, b, 0, 0, 0, false).renderOrder = 3;
    put(new THREE.CylinderGeometry(BIN_R + 0.02, BIN_R + 0.02, 0.06, 64, 1, true).translate(0, 6.2, 0), clear, b, 0, 0, 0, false).renderOrder = 3;
    this.flap.position.set(0, 1.6, -BIN_R);
    b.add(this.flap);
    put(new THREE.CylinderGeometry(BIN_R + 0.1, BIN_R + 0.1, 0.36, 64), dark, this.flap, 0, 0, BIN_R);
    put(rbox(0.9, 0.3, 0.5, 0.1), red, this.flap, 0, 0, -0.1);
    put(new THREE.TorusGeometry(BIN_R + 0.04, 0.12, 12, 64).rotateX(Math.PI / 2), dark, b, 0, 6.82, 0);
    put(new THREE.CylinderGeometry(BIN_R + 0.14, BIN_R + 0.14, 0.32, 64), dark, b, 0, 6.95, 0);
    put(lathe([[0.82, 3.3], [0.82, 6.8], [0.0, 6.8]], 40), shroudMat, b);
    put(lathe([[0.0, 2.55], [0.3, 2.7], [0.72, 3.1], [0.84, 3.32]], 40), nickel, b);
    // the cyclone pack: a ring of small cones under a domed cap
    const cone = new THREE.CylinderGeometry(0.32, 0.14, 1.3, 20);
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      const c = put(cone, i % 2 ? nickel : anodised, b, Math.cos(a) * 1.5, 7.85, Math.sin(a) * 1.5);
      c.rotation.set(Math.sin(a) * 0.22, 0, -Math.cos(a) * 0.22);
    }
    put(lathe([[1.0, 7.1], [1.15, 7.2], [1.15, 8.5], [0.0, 8.5]], 40), shell, b);
    put(lathe([[1.95, 8.45], [2.0, 8.6], [1.6, 9.0], [1.25, 9.1], [0.0, 9.1]], 48), shellLight, b);
    // the motor, finned for cooling, with a anodised end cap
    {
      const pts: [number, number][] = [[1.2, 9.05]];
      for (let i = 0; i < 9; i++) pts.push([1.2, 9.2 + i * 0.2], [1.32, 9.27 + i * 0.2], [1.2, 9.34 + i * 0.2]);
      pts.push([1.2, 11.0], [0.0, 11.0]);
      put(lathe(pts, 48), shell, b);
    }
    put(lathe([[1.28, 10.95], [1.3, 11.1], [1.1, 11.45], [0.5, 11.6], [0.0, 11.62]], 48), anodised, b);
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * Math.PI * 2;
      const slot = put(rbox(0.1, 0.06, 0.5, 0.03), dark, b, Math.cos(a) * 0.82, 11.47, Math.sin(a) * 0.82, false);
      slot.rotation.y = -a;
    }
    // the pistol grip, sweeping back from the motor down to the battery
    const grip = new THREE.CatmullRomCurve3([
      new THREE.Vector3(0, 10.7, -0.9),
      new THREE.Vector3(0, 11.05, -2.1),
      new THREE.Vector3(0, 10.3, -3.6),
      new THREE.Vector3(0, 8.6, -4.25),
      new THREE.Vector3(0, 7.0, -4.15),
    ]);
    put(new THREE.TubeGeometry(grip, 48, 0.5, 20, false), rubber, b);
    put(new THREE.SphereGeometry(0.5, 20, 12), rubber, b, 0, 7.0, -4.15);
    const trigger = put(rbox(0.36, 1.1, 0.5, 0.14), red, b, 0, 9.3, -3.15);
    trigger.rotation.x = -0.45;
    // the battery pack under the grip, braced to the bin
    put(rbox(1.9, 3.3, 1.9, 0.38), shell, b, 0, 5.4, -3.85);
    put(rbox(1.6, 0.25, 1.6, 0.1), dark, b, 0, 7.12, -3.85);
    put(rbox(1.1, 0.9, 2.0, 0.25), shell, b, 0, 6.3, -2.6);
    put(rbox(1.0, 0.7, 1.8, 0.2), shell, b, 0, 3.6, -2.6);
    for (let i = 0; i < 3; i++) put(new THREE.CircleGeometry(0.09, 16), this.led, b, -0.4 + i * 0.4, 4.3, -4.81, false).rotation.y = Math.PI;
    // the screen, on the back of the battery under the grip, tipped up at the hand
    {
      const c = document.createElement("canvas");
      c.width = c.height = 256;
      this.screenCtx = c.getContext("2d")!;
      this.screenTex = new THREE.CanvasTexture(c);
      this.screenTex.colorSpace = THREE.SRGBColorSpace;
      this.screenTex.anisotropy = aniso;
      const screenMat = own(new THREE.MeshBasicMaterial({ map: this.screenTex }));
      const mount = new THREE.Group();
      mount.position.set(0, 5.95, -4.8);
      mount.rotation.x = Math.PI + 0.3;
      b.add(mount);
      put(new THREE.CylinderGeometry(0.9, 0.94, 0.24, 48).rotateX(Math.PI / 2), dark, mount, 0, 0, -0.06);
      put(new THREE.CircleGeometry(0.78, 48), screenMat, mount, 0, 0, 0.065, false);
    }

    // ——— what it has swallowed: miniature bricks, by size ———
    const brickMat = plasticMaterial();
    this.materials.push(brickMat);
    for (const shape of [{ w: 4, d: 2 }, { w: 2, d: 2 }, { w: 2, d: 1 }]) {
      const mesh = new THREE.InstancedMesh(pieceGeometry({ ...shape, h: 3, studs: true }), brickMat, CAPACITY);
      mesh.count = 0;
      mesh.castShadow = false;
      mesh.receiveShadow = true;
      mesh.frustumCulled = false;
      for (let i = 0; i < CAPACITY; i++) mesh.setColorAt(i, new THREE.Color(1, 1, 1));
      b.add(mesh);
      this.bins.push(mesh);
    }
    this.drawScreen(true);
  }

  /** In the bin, ready to send pieces home: its middle, in world space. */
  get binWorld() {
    return this.bin;
  }

  /** Fully out and on the floor (the physics only sucks then). */
  get live() {
    return this.shown > 0.97;
  }

  /** A piece went in: a miniature of it spirals down the bin onto the heap. */
  swallow(color: string | THREE.Color, studArea: number, t: number) {
    this.count++;
    this.bob = Math.min(1, this.bob + 0.35);
    if (this.items.length >= CAPACITY || this.emptying >= 0) return;
    const n = this.items.length;
    const mesh = studArea >= 8 ? 0 : studArea >= 4 ? 1 : 2;
    const layer = Math.floor(n / PER_LAYER);
    const j = n % PER_LAYER;
    const inner = j < 6;
    const r = inner ? 0.98 : 1.5;
    const a = ((inner ? j : j - 6) / (inner ? 6 : 10)) * Math.PI * 2 + layer * 0.9 + (Math.random() - 0.5) * 0.3;
    const y = 2.0 + layer * 0.33 + Math.random() * 0.08;
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.random() * Math.PI * 2, Math.random() * Math.PI * 2, Math.random() * Math.PI * 2));
    const spin = new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize();
    const bin = this.bins[mesh];
    const idx = bin.count++;
    bin.setColorAt(idx, new THREE.Color(color));
    if (bin.instanceColor) bin.instanceColor.needsUpdate = true;
    this.items.push({ mesh, idx, r, a, y, q, spin, born: t });
  }

  /** Tip the bin out (the pieces themselves fly home in the rebuild). */
  empty() {
    if (this.items.length || this.count) this.emptying = 0;
    this.count = 0;
  }

  /**
   * Move everything. `target` is where the pointer meets the floor; the wand leans back from the
   * head towards the camera, held off to one side.
   */
  update(dt: number, t: number, o: { on: boolean; boost: boolean; target: THREE.Vector3; camera: THREE.PerspectiveCamera; night: number }) {
    dt = Math.min(dt, 0.05);
    this.shown = damp(this.shown, o.on ? 1 : 0, o.on ? 3.2 : 4.5, dt);
    if (!o.on && this.shown < 0.01) this.shown = 0;
    if (o.on && this.shown > 0.995) this.shown = 1;
    const visible = this.shown > 0;
    this.assembly.visible = visible;
    const running = o.on && this.live;
    this.spin = damp(this.spin, running ? (o.boost ? 1 : 0.7) : 0, running ? 2.4 : 1.2, dt);
    this.light.intensity = visible ? this.shown * lerp(6, 55, o.night) * Math.min(1, this.spin * 1.6) : 0;
    this.battery = Math.max(1, Math.min(100, this.battery + (running ? -(o.boost ? 0.55 : 0.18) : 1.2) * dt));
    if (!visible) {
      this.placed = false;
      return;
    }

    // ——— the head chases the pointer across the floor, not quite keeping up ———
    if (!this.placed) {
      this.x = o.target.x;
      this.z = o.target.z;
      this.vx = this.vz = 0;
      this.placed = true;
      this.fresh = true;
    }
    const px = this.x;
    const pz = this.z;
    this.x = damp(this.x, o.target.x, 9, dt);
    this.z = damp(this.z, o.target.z, 9, dt);
    // a top speed: it's pushed, not teleported
    const mx = this.x - px;
    const mz = this.z - pz;
    const step = Math.hypot(mx, mz);
    const max = 70 * dt;
    if (step > max) {
      this.x = px + (mx / step) * max;
      this.z = pz + (mz / step) * max;
    }
    this.vx = damp(this.vx, (this.x - px) / Math.max(dt, 1e-4), 10, dt);
    this.vz = damp(this.vz, (this.z - pz) / Math.max(dt, 1e-4), 10, dt);

    // ——— where the hand holds it: the wand leans back at a real angle, towards the camera and off
    // to one side, so the body is seen side-on; it changes hands when the head nears that edge ———
    const cam = o.camera;
    const hx = this.v2.set(this.x, 0, this.z).project(cam).x;
    if (hx > 0.45) this.side = -1;
    else if (hx < -0.45) this.side = 1;
    this.hand = damp(this.hand, this.side, 2.2, dt);
    const camYaw = Math.atan2(cam.position.x - this.x, cam.position.z - this.z);
    const lean = camYaw + this.hand * 1.1;
    const B = new THREE.Vector3(Math.sin(lean) * Math.cos(ELEVATION), Math.sin(ELEVATION), Math.cos(lean) * Math.cos(ELEVATION)).multiplyScalar(REACH);
    B.x += this.x;
    B.y += KNUCKLE.y;
    B.z += this.z;
    // tucked away, the whole thing is lifted up out of the frame
    const away = 1 - this.shown;
    B.y += away * away * 40;
    // a running motor hums through the whole thing
    const hum = this.spin * 0.012 + this.bob * 0.05;
    this.bob = Math.max(0, this.bob - dt * 3);
    B.x += Math.sin(t * 97) * hum;
    B.y += Math.sin(t * 131 + 1) * hum;

    // ——— the head swivels to face away from the hand, and steers into the way it's pushed ———
    const facing = Math.atan2(this.x - B.x, this.z - B.z);
    const fx = Math.sin(facing);
    const fz = Math.cos(facing);
    const sideways = this.vx * fz - this.vz * fx;
    const want = facing + THREE.MathUtils.clamp(sideways * 0.012, -0.5, 0.5);
    this.yaw = this.fresh ? want : angleDamp(this.yaw, want, 7, dt);
    this.fresh = false;
    const lift = away * away * 18;
    this.head.position.set(this.x, lift, this.z);
    this.head.rotation.set(0, this.yaw, 0);
    // the soft roller and the rear rollers turn
    this.brush.rotation.x += this.spin * dt * 38 + (this.vx * Math.sin(this.yaw) + this.vz * Math.cos(this.yaw)) * dt * 1.2;
    for (const c of this.head.children) if (c.userData.wheel) c.rotation.x += (this.vx * Math.sin(this.yaw) + this.vz * Math.cos(this.yaw)) * dt * 2.4;
    this.fanMat.uniforms.uK.value = this.shown * Math.min(1, this.spin * 1.8) * lerp(0.32, 0.9, o.night);
    this.fanMat.uniforms.uTime.value = t;
    this.led.color.set("#3dff86").multiplyScalar(0.4 + 2.8 * Math.min(1, this.spin * 1.6));

    // ——— neck and wand: from the swivel straight up to the hand ———
    this.head.updateMatrixWorld();
    const K = this.head.localToWorld(KNUCKLE.clone());
    const axis = B.clone().sub(K);
    const total = axis.length();
    axis.divideScalar(total);
    this.q.setFromUnitVectors(this.up, axis);
    this.neck.position.copy(K);
    this.neck.quaternion.copy(this.q);
    this.wand.position.copy(K).addScaledVector(axis, NECK - 0.15);
    this.wand.quaternion.copy(this.q);
    this.wandTube.scale.set(1, Math.max(0.5, total - NECK + 0.2), 1);

    // ——— the body: in line with the wand, its grip turned towards the camera ———
    const toCam = cam.position.clone().sub(B);
    const back = toCam.addScaledVector(axis, -toCam.dot(axis)).normalize();
    const zAxis = back.clone().negate();
    const xAxis = new THREE.Vector3().crossVectors(axis, zAxis).normalize();
    this.m.makeBasis(xAxis, axis, zAxis);
    this.body.quaternion.setFromRotationMatrix(this.m);
    const size = 1;
    // the wand plugs into the bottom of the body
    this.body.position.copy(B);
    this.bin.copy(B).addScaledVector(axis, 4 * size);
    this.wandLine.k.copy(K);
    this.wandLine.b.copy(B);
    this.wandLine.top.copy(B).addScaledVector(axis, 11.6 * size);

    this.animateBin(dt, t);
    if (t - this.screenAt > 0.15) {
      this.screenAt = t;
      this.drawScreen();
    }
  }

  /** The bricks in the bin: the newest spiral down the cyclone, the rest sit in a heap and buzz. */
  private animateBin(dt: number, t: number) {
    let flap = 0;
    if (this.emptying >= 0) {
      this.emptying += dt / 0.9;
      flap = Math.sin(Math.PI * Math.min(1, this.emptying * 1.25)) * 1.25;
      if (this.emptying >= 1) {
        this.emptying = -1;
        this.items.length = 0;
        for (const m of this.bins) m.count = 0;
      }
    }
    this.flap.rotation.x = flap;
    const e = this.emptying >= 0 ? this.emptying : 0;
    for (const it of this.items) {
      const age = t - it.born;
      let r = it.r;
      let a = it.a;
      let y = it.y;
      const q = this.q.copy(it.q);
      if (age < SWIRL) {
        // in at the top, whirled round the wall, losing speed as it drops onto the heap
        const k = age / SWIRL;
        const ease = 1 - (1 - k) * (1 - k);
        r = lerp(1.85, it.r, ease);
        a = it.a - (1 - k) * (1 - k) * 22;
        y = lerp(6.3, it.y, k * k);
        q.multiply(new THREE.Quaternion().setFromAxisAngle(it.spin, (1 - k) * (1 - k) * 16));
      } else if (this.spin > 0.05) {
        // the heap jitters with the motor
        const j = this.spin * 0.025;
        y += Math.sin(t * 61 + it.a * 7) * j;
        a += Math.sin(t * 47 + it.y * 5) * j * 0.6;
      }
      // tipping out: everything drops through the open floor
      if (e > 0) {
        y -= e * e * 12;
        r *= 1 - e * 0.3;
      }
      const sc = e > 0.5 ? BIN_SCALE * (1 - (e - 0.5) * 2) : BIN_SCALE;
      this.m.compose(this.v.set(Math.cos(a) * r, y, Math.sin(a) * r), q, this.s.setScalar(Math.max(sc, 1e-3)));
      this.bins[it.mesh].setMatrixAt(it.idx, this.m);
    }
    for (const m of this.bins) if (m.count) m.instanceMatrix.needsUpdate = true;
  }

  /** The round screen: a power ring, the count, the mode and the charge left. */
  private drawScreen(force = false) {
    const boost = this.spin > 0.85;
    const count = this.count;
    const charge = Math.round(this.battery);
    const full = this.items.length >= CAPACITY;
    const ring = Math.round(this.spin * 40);
    const key = `${count}|${boost}|${charge}|${full}|${ring}`;
    if (!force && key === this.screenKey) return;
    this.screenKey = key;
    const c = this.screenCtx;
    c.clearRect(0, 0, 256, 256);
    c.fillStyle = "#04070a";
    c.fillRect(0, 0, 256, 256);
    const g = c.createRadialGradient(128, 110, 10, 128, 128, 128);
    g.addColorStop(0, "rgba(40,70,80,0.35)");
    g.addColorStop(1, "rgba(0,0,0,0)");
    c.fillStyle = g;
    c.fillRect(0, 0, 256, 256);
    // the power ring
    const accent = full ? "#ff4d3a" : boost ? "#ffb02e" : "#3dff86";
    c.lineCap = "round";
    c.lineWidth = 12;
    c.strokeStyle = "rgba(255,255,255,0.08)";
    c.beginPath();
    c.arc(128, 128, 104, Math.PI * 0.75, Math.PI * 2.25);
    c.stroke();
    c.strokeStyle = accent;
    c.shadowColor = accent;
    c.shadowBlur = 14;
    c.beginPath();
    c.arc(128, 128, 104, Math.PI * 0.75, Math.PI * (0.75 + 1.5 * Math.max(0.02, this.spin)));
    c.stroke();
    c.shadowBlur = 0;
    // the count
    c.fillStyle = "#f2f6f7";
    c.textAlign = "center";
    c.textBaseline = "middle";
    c.font = "700 76px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";
    c.fillText(String(Math.min(999, count)).padStart(3, "0"), 128, 124);
    c.font = "600 17px ui-sans-serif, system-ui, sans-serif";
    c.fillStyle = "rgba(242,246,247,0.6)";
    c.fillText(full ? "BIN FULL" : "BRICKS", 128, 72);
    c.fillStyle = accent;
    c.font = "700 19px ui-sans-serif, system-ui, sans-serif";
    c.fillText(this.spin < 0.05 ? "READY" : boost ? "BOOST" : "AUTO", 128, 172);
    // the charge left
    c.strokeStyle = "rgba(242,246,247,0.7)";
    c.lineWidth = 2.5;
    c.strokeRect(104, 196, 42, 18);
    c.fillStyle = "rgba(242,246,247,0.7)";
    c.fillRect(146, 201, 4, 8);
    c.fillStyle = charge < 20 ? "#ff4d3a" : "#f2f6f7";
    c.fillRect(107, 199, 36 * (charge / 100), 12);
    c.font = "600 14px ui-monospace, monospace";
    c.fillStyle = "rgba(242,246,247,0.7)";
    c.textAlign = "left";
    c.fillText(`${charge}%`, 156, 206);
    this.screenTex.needsUpdate = true;
  }

  dispose() {
    this.root.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.geometry && !(m instanceof THREE.InstancedMesh)) m.geometry.dispose();
    });
    for (const m of this.materials) {
      for (const v of Object.values(m)) if (v instanceof THREE.Texture) v.dispose();
      m.dispose();
    }
  }
}
