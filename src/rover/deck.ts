import * as THREE from "three";
import { rng } from "./noise";
import type { Ground } from "./terrain";
import { makeDeckTexture, makeHazardTexture } from "./textures";
import type { World } from "./worlds";

/**
 * The giants have no surface: the rover is set down on a floating aerostat deck at the 1-bar level,
 * held up by a hot-hydrogen envelope. Drive off the edge and there is nothing below but cloud.
 */
type Ramp = { x: number; z: number; a: number; L: number; W: number; H: number; table?: number };
type Crate = { x: number; z: number; a: number; sx: number; sz: number; h: number; color: string };

export const DECK_R = 150;
export const ABYSS = -1e4;

export class Deck implements Ground {
  ramps: Ramp[] = [
    { x: 30, z: -10, a: 0, L: 9, W: 5, H: 1.6 },
    { x: -40, z: 40, a: Math.PI * 0.75, L: 14, W: 6, H: 3, table: 10 },
    { x: -20, z: -70, a: -Math.PI / 2, L: 12, W: 5, H: 2.6 },
    { x: 70, z: 50, a: Math.PI * 1.2, L: 8, W: 4, H: 1.1 },
    { x: 15, z: 80, a: Math.PI / 2, L: 20, W: 7, H: 4.5 },
  ];
  crates: Crate[] = [];

  constructor(public world: World) {
    const r = rng(world.terrain.seed);
    const colors = ["#c8502e", "#2e6fc8", "#d9a62c", "#e8e6e1", "#3b8a52"];
    for (let i = 0; i < 26; i++) {
      const a = r() * Math.PI * 2;
      const d = 35 + r() * (DECK_R - 50);
      const x = Math.cos(a) * d;
      const z = Math.sin(a) * d;
      if (this.ramps.some((p) => Math.hypot(p.x - x, p.z - z) < p.L + 6)) continue;
      const long = r() < 0.6;
      this.crates.push({ x, z, a: r() * Math.PI, sx: long ? 6.1 : 2.4, sz: 2.4, h: 2.6, color: colors[Math.floor(r() * colors.length)] });
    }
  }

  height(x: number, z: number) {
    if (x * x + z * z > DECK_R * DECK_R) return ABYSS;
    let h = 0;
    for (const p of this.ramps) {
      const dx = x - p.x;
      const dz = z - p.z;
      const u = dx * Math.cos(p.a) + dz * Math.sin(p.a);
      const v = -dx * Math.sin(p.a) + dz * Math.cos(p.a);
      if (Math.abs(v) > p.W / 2) continue;
      if (p.table) {
        // up-ramp, flat table, down-ramp
        const T = p.table;
        if (u >= 0 && u <= p.L) h = Math.max(h, (p.H * u) / p.L);
        else if (u > p.L && u <= p.L + T) h = Math.max(h, p.H);
        else if (u > p.L + T && u <= 2 * p.L + T) h = Math.max(h, p.H * (1 - (u - p.L - T) / p.L));
      } else if (u >= 0 && u <= p.L) h = Math.max(h, (p.H * u) / p.L);
    }
    for (const c of this.crates) {
      const dx = x - c.x;
      const dz = z - c.z;
      const u = dx * Math.cos(c.a) + dz * Math.sin(c.a);
      const v = -dx * Math.sin(c.a) + dz * Math.cos(c.a);
      if (Math.abs(u) <= c.sx / 2 && Math.abs(v) <= c.sz / 2) h = Math.max(h, c.h);
    }
    return h;
  }

  ground(x: number, z: number) {
    return this.height(x, z);
  }

  normal(x: number, z: number, out: THREE.Vector3) {
    const e = 0.12;
    const h0 = this.height(x, z);
    if (h0 <= ABYSS) return out.set(0, 1, 0);
    const hx = this.height(x + e, z);
    const hz = this.height(x, z + e);
    if (hx <= ABYSS || hz <= ABYSS) return out.set(0, 1, 0);
    return out.set(h0 - hx, e, h0 - hz).normalize();
  }

  onRock() {
    return true;
  }
}

/** Deck, envelope, ramps, crates and the cloud sea below. */
export class DeckView {
  readonly root = new THREE.Group();
  private cloud: THREE.ShaderMaterial;
  private beacons: THREE.Mesh[] = [];
  private disposables: { dispose(): void }[] = [];
  private flash = 0;
  private flashPos = new THREE.Vector2();

  constructor(
    private deck: Deck,
    private world: World,
    sunDir: THREE.Vector3,
  ) {
    const deckTex = makeDeckTexture();
    deckTex.repeat.set(DECK_R / 6, DECK_R / 6);
    const hazard = makeHazardTexture();
    hazard.repeat.set(160, 1);
    this.disposables.push(deckTex, hazard);
    const deckMat = new THREE.MeshStandardMaterial({ map: deckTex, roughness: 0.55, metalness: 0.65, color: "#d6d8dc" });
    const top = new THREE.Mesh(new THREE.CircleGeometry(DECK_R, 128), deckMat);
    top.rotation.x = -Math.PI / 2;
    top.receiveShadow = true;
    this.root.add(top);
    // landing pad markings
    const pad = new THREE.Mesh(new THREE.RingGeometry(9, 10, 64), new THREE.MeshStandardMaterial({ color: "#f2b705", roughness: 0.6 }));
    pad.rotation.x = -Math.PI / 2;
    pad.position.y = 0.01;
    this.root.add(pad);
    for (const s of [-1, 1]) {
      const bar = new THREE.Mesh(new THREE.PlaneGeometry(1, 8), pad.material);
      bar.rotation.x = -Math.PI / 2;
      bar.position.set(s * 2.5, 0.011, 0);
      this.root.add(bar);
    }
    const mid = new THREE.Mesh(new THREE.PlaneGeometry(5, 1), pad.material);
    mid.rotation.x = -Math.PI / 2;
    mid.position.y = 0.011;
    this.root.add(mid);
    // rim with hazard stripes, and the hull below
    const rim = new THREE.Mesh(new THREE.CylinderGeometry(DECK_R, DECK_R, 0.6, 128, 1, true), new THREE.MeshStandardMaterial({ map: hazard, roughness: 0.6 }));
    rim.position.y = -0.3;
    this.root.add(rim);
    const hull = new THREE.Mesh(new THREE.CylinderGeometry(DECK_R, DECK_R * 0.82, 7, 64, 1, true), new THREE.MeshStandardMaterial({ color: "#4a4e55", roughness: 0.7, metalness: 0.6, side: THREE.DoubleSide }));
    hull.position.y = -4.1;
    this.root.add(hull);
    const under = new THREE.Mesh(new THREE.CircleGeometry(DECK_R * 0.82, 64), hull.material);
    under.rotation.x = Math.PI / 2;
    under.position.y = -7.6;
    this.root.add(under);
    // trusses under the rim
    const trussMat = new THREE.MeshStandardMaterial({ color: "#2c2f34", roughness: 0.6, metalness: 0.7 });
    for (let i = 0; i < 48; i++) {
      const a = (i / 48) * Math.PI * 2;
      const t = new THREE.Mesh(new THREE.BoxGeometry(0.4, 9, 0.4), trussMat);
      t.position.set(Math.cos(a) * (DECK_R - 6), -6, Math.sin(a) * (DECK_R - 6));
      t.rotation.z = 0.4;
      t.rotation.y = -a;
      this.root.add(t);
    }
    // ramps
    const rampMat = new THREE.MeshStandardMaterial({ color: "#e0e2e6", roughness: 0.5, metalness: 0.5 });
    const sideMat = new THREE.MeshStandardMaterial({ map: hazard, roughness: 0.6 });
    for (const p of deck.ramps) {
      const shape = new THREE.Shape();
      if (p.table) {
        shape.moveTo(0, 0);
        shape.lineTo(p.L, p.H);
        shape.lineTo(p.L + p.table, p.H);
        shape.lineTo(2 * p.L + p.table, 0);
      } else {
        shape.moveTo(0, 0);
        shape.lineTo(p.L, p.H);
        shape.lineTo(p.L, 0);
      }
      shape.closePath();
      const geo = new THREE.ExtrudeGeometry(shape, { depth: p.W, bevelEnabled: false });
      geo.translate(0, 0, -p.W / 2);
      const mesh = new THREE.Mesh(geo, [sideMat, rampMat]);
      mesh.position.set(p.x, 0, p.z);
      mesh.rotation.y = -p.a;
      mesh.castShadow = mesh.receiveShadow = true;
      this.root.add(mesh);
    }
    // cargo containers
    for (const c of deck.crates) {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(c.sx, c.h, c.sz), new THREE.MeshStandardMaterial({ color: c.color, roughness: 0.55, metalness: 0.4 }));
      mesh.position.set(c.x, c.h / 2, c.z);
      mesh.rotation.y = -c.a;
      mesh.castShadow = mesh.receiveShadow = true;
      this.root.add(mesh);
    }
    // beacons around the rim
    const beaconMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(4, 0.4, 0.3) });
    for (let i = 0; i < 24; i++) {
      const a = (i / 24) * Math.PI * 2;
      const b = new THREE.Mesh(new THREE.SphereGeometry(0.22, 10, 8), beaconMat);
      b.position.set(Math.cos(a) * (DECK_R - 0.6), 0.5, Math.sin(a) * (DECK_R - 0.6));
      this.beacons.push(b);
      this.root.add(b);
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.4), trussMat);
      post.position.set(b.position.x, 0.2, b.position.z);
      this.root.add(post);
    }
    // the lifting envelope overhead, tethered to the rim
    const env = new THREE.Mesh(new THREE.SphereGeometry(110, 48, 24), new THREE.MeshStandardMaterial({ color: "#eceae4", roughness: 0.75, metalness: 0.05 }));
    env.scale.set(1, 0.55, 1);
    env.position.y = 260;
    this.root.add(env);
    const tethers: number[] = [];
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * Math.PI * 2;
      tethers.push(Math.cos(a) * (DECK_R - 2), 0, Math.sin(a) * (DECK_R - 2), Math.cos(a) * 95, 220, Math.sin(a) * 95);
    }
    const tg = new THREE.BufferGeometry();
    tg.setAttribute("position", new THREE.Float32BufferAttribute(tethers, 3));
    this.root.add(new THREE.LineSegments(tg, new THREE.LineBasicMaterial({ color: "#20232a" })));

    // the cloud sea, far below
    const pal = world.palette;
    this.cloud = new THREE.ShaderMaterial({
      uniforms: THREE.UniformsUtils.merge([
        THREE.UniformsLib.fog,
        {
          uA: { value: new THREE.Color(pal.low) },
          uB: { value: new THREE.Color(pal.bright) },
          uC: { value: new THREE.Color(pal.slope) },
          uSun: { value: sunDir.clone() },
          uTime: { value: 0 },
          uFlash: { value: 0 },
          uFlashPos: { value: new THREE.Vector2() },
          uExpo: { value: world.sky.exposure },
        },
      ]),
      vertexShader: /* glsl */ `
varying vec2 vXZ;
#include <fog_pars_vertex>
void main() { vec4 wp = modelMatrix * vec4(position, 1.0); vXZ = wp.xz; vec4 mvPosition = viewMatrix * wp; gl_Position = projectionMatrix * mvPosition;
#include <fog_vertex>
}`,
      fragmentShader: /* glsl */ `
uniform vec3 uA; uniform vec3 uB; uniform vec3 uC; uniform vec3 uSun; uniform float uTime; uniform float uFlash; uniform vec2 uFlashPos; uniform float uExpo;
varying vec2 vXZ;
#include <fog_pars_fragment>
float h(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float n(vec2 p) { vec2 i = floor(p); vec2 f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(h(i), h(i + vec2(1, 0)), f.x), mix(h(i + vec2(0, 1)), h(i + vec2(1, 1)), f.x), f.y); }
float fb(vec2 p) { float s = 0.0; float a = 0.5; for (int i = 0; i < 6; i++) { s += a * n(p); p = mat2(1.6, 1.2, -1.2, 1.6) * p + 3.1; a *= 0.5; } return s; }
void main() {
  vec2 p = vXZ / 900.0 + vec2(uTime * 0.004, uTime * 0.0015);
  float c = fb(p + fb(p * 0.5 + uTime * 0.002));
  float bands = 0.5 + 0.5 * sin(vXZ.y / 2400.0 + c * 2.0);
  vec3 col = mix(uC, uA, smoothstep(0.3, 0.6, c));
  col = mix(col, uB, smoothstep(0.55, 0.85, c) * (0.6 + 0.4 * bands));
  float shade = 0.55 + 0.45 * smoothstep(0.35, 0.75, c);
  col *= shade * (0.6 + 0.6 * max(uSun.y, 0.0));
  float fl = uFlash * exp(-length(vXZ - uFlashPos) / 700.0);
  col += vec3(0.8, 0.85, 1.0) * fl * 4.0;
  gl_FragColor = vec4(col * uExpo, 1.0);
  #include <fog_fragment>
}`,
      fog: true,
    });
    const sea = new THREE.Mesh(new THREE.PlaneGeometry(60000, 60000, 1, 1), this.cloud);
    sea.rotation.x = -Math.PI / 2;
    sea.position.y = -320;
    sea.renderOrder = -5;
    this.root.add(sea);
    this.root.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (mesh.isMesh) {
        this.disposables.push(mesh.geometry);
        const m = mesh.material;
        (Array.isArray(m) ? m : [m]).forEach((x) => this.disposables.push(x));
      }
    });
    this.disposables.push(tg);
  }

  update(dt: number, t: number) {
    this.cloud.uniforms.uTime.value = t;
    const on = Math.floor(t * 1.2) % 2 === 0;
    this.beacons.forEach((b, i) => (b.visible = on === (i % 2 === 0)));
    // lightning deep in the water-cloud layer (seen on Jupiter and Saturn by Juno and Cassini)
    if (this.world.id === "jupiter" || this.world.id === "saturn") {
      this.flash = Math.max(0, this.flash - dt * 6);
      if (Math.random() < dt * 0.35) {
        this.flash = 1;
        this.flashPos.set((Math.random() - 0.5) * 6000, (Math.random() - 0.5) * 6000);
      }
      this.cloud.uniforms.uFlash.value = this.flash * (0.5 + 0.5 * Math.sin(t * 90));
      (this.cloud.uniforms.uFlashPos.value as THREE.Vector2).copy(this.flashPos);
    }
  }

  dispose() {
    this.disposables.forEach((d) => d.dispose());
  }
}
