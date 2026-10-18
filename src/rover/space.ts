import * as THREE from "three";
import {
  AU_KM,
  BRIGHT_STARS,
  GAL_CENTER,
  GAL_NORTH,
  HALLEY,
  J2000,
  MOONS,
  PLANET_IDS,
  SPIN,
  bvColor,
  elementsAt,
  fromRaDec,
  halleyPos,
  kepler,
  launchWindow,
  moonGeocentric,
  orbitPath,
  orbitPoint,
  planetPos,
  type MoonDef,
} from "./ephemeris";
import { rng } from "./noise";
import { atmoMaterial, coronaMaterial, milkyWayMaterial, planetMaterial, ringMaterial, sunMaterial } from "./planet";
import { WORLDS, hohmannDv, worldById, type PlanetLook, type World, type WorldId } from "./worlds";

/**
 * The Solar System as it really is today: planets placed from JPL orbital elements, true elliptical
 * and inclined orbits, real axial tilts and spins, the major moons, the asteroid belt (with its
 * Kirkwood gaps), Jupiter's Trojans, the Kuiper belt, Halley's comet, and the sky behind it all.
 *
 * Three scale modes blend smoothly: illustrative (distances √-compressed, planets enlarged),
 * true distances (linear, planets still enlarged), and true scale (where the planets all but vanish).
 */

/** display units per AU in the linear (true-distance) modes */
export const UPA = 3.3;
const SUN_KM = 695_700;
const bodyR = (km: number) => 0.25 + 0.55 * Math.log10(1 + km / 2000);
/** heliocentric parent: the Moon travels with Earth, Titan with Saturn */
export const helio = (w: World): World => (w.parent ? WORLDS.find((p) => p.name === w.parent)! : w);
const D2R = Math.PI / 180;
const tmp = new THREE.Vector3();
const tmp2 = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);

type Body = {
  id: string;
  name: string;
  world?: World;
  moon?: MoonDef;
  parent?: Body;
  km: number;
  mesh: THREE.Mesh;
  mat: THREE.ShaderMaterial;
  pole: THREE.Quaternion;
  spin: number;
  hours: number;
  ring?: THREE.Mesh;
  orbit?: THREE.Line;
  orbitAU?: THREE.Vector3[];
  orbitMat?: THREE.ShaderMaterial;
  orbitJD?: number;
  moonOrbit?: THREE.LineLoop;
  au: THREE.Vector3;
  disp: THREE.Vector3;
  dispR: number;
};

export type Transfer = {
  from: World;
  to: World;
  local: boolean;
  launchJD: number;
  arriveJD: number;
  /** days spent waiting for the launch window, and in flight */
  wait: number;
  days: number;
  dv: number;
  pathAU: THREE.Vector3[];
};

const LOOKS: Record<string, PlanetLook> = {
  phobos: { kind: "cratered", c1: "#5c4f45", c2: "#3e352e", c3: "#71635a", rim: "#000", rimK: 0 },
  deimos: { kind: "cratered", c1: "#6c5c4e", c2: "#4a3e34", c3: "#7a6a5a", rim: "#000", rimK: 0 },
  io: { kind: "rocky", c1: "#e0c45a", c2: "#b07a2e", c3: "#f2ead0", rim: "#000", rimK: 0 },
  europa: { kind: "icy", c1: "#e6dccb", c2: "#a37a58", c3: "#5a3a2a", rim: "#000", rimK: 0 },
  ganymede: { kind: "cratered", c1: "#9a8f80", c2: "#5f564c", c3: "#d8d2c8", rim: "#000", rimK: 0 },
  callisto: { kind: "cratered", c1: "#5f574d", c2: "#3d3730", c3: "#bdb6aa", rim: "#000", rimK: 0 },
  rhea: { kind: "cratered", c1: "#bdbab4", c2: "#8c8984", c3: "#e8e6e2", rim: "#000", rimK: 0 },
  titania: { kind: "cratered", c1: "#aaa49c", c2: "#7a746c", c3: "#d0ccc4", rim: "#000", rimK: 0 },
  oberon: { kind: "cratered", c1: "#9a918a", c2: "#6a625c", c3: "#c4bcb4", rim: "#000", rimK: 0 },
  triton: { kind: "icy", c1: "#d8c8c0", c2: "#9c8478", c3: "#5a4a44", rim: "#9ec0ff", rimK: 0.1 },
};

/** how far out a moon is drawn in the illustrative modes (in parent radii), log-compressed from the truth */
const moonSpread = (aKm: number, parentKm: number) => 1.5 + 2.2 * Math.log10(1 + aKm / (parentKm * 2));

export class SpaceScene {
  readonly root = new THREE.Group();
  readonly map = new THREE.Group();
  readonly approach = new THREE.Group();
  readonly craft = new THREE.Group();
  readonly bigPlanet: THREE.Mesh;
  readonly bigSun = new THREE.Vector3(0.8, 0.25, 0.55).normalize();
  readonly bodies = new Map<string, Body>();
  /** the map's clock (Julian date) */
  jd = 2451545;
  /** scale blends: 0 = illustrative, 1 = linear distances; and 1 = true sizes */
  distK = 0;
  sizeK = 0;
  private distTarget = 0;
  private sizeTarget = 0;
  private sky = new THREE.Group();
  private sunMesh: THREE.Mesh;
  private sunMat: THREE.ShaderMaterial;
  private corona: THREE.Mesh;
  private coronaMat: THREE.ShaderMaterial;
  private belts: THREE.Points[] = [];
  private beltMats: THREE.ShaderMaterial[] = [];
  private halley: { line: THREE.Line; au: THREE.Vector3[]; head: THREE.Mesh; tail: THREE.Mesh; tailMat: THREE.ShaderMaterial; pos: THREE.Vector3 };
  private arc: THREE.Line;
  private arcGeo = new THREE.BufferGeometry();
  private arcAU: THREE.Vector3[] = [];
  private flare: THREE.Sprite;
  private bigMat: THREE.ShaderMaterial | null = null;
  private atmo: THREE.Mesh | null = null;
  private bigRing: THREE.Mesh | null = null;
  private disposables: { dispose(): void }[] = [];
  private lastScaleK = -1;
  private highlighted: string | null = null;

  constructor() {
    this.root.add(this.sky, this.map, this.approach);
    this.approach.visible = false;
    this.buildSky();

    // —— the Sun ——
    this.sunMat = sunMaterial();
    this.sunMesh = new THREE.Mesh(new THREE.SphereGeometry(1, 96, 48), this.sunMat);
    this.sunMesh.quaternion.setFromUnitVectors(UP, fromRaDec(SPIN.sun.ra, SPIN.sun.dec));
    this.map.add(this.sunMesh);
    this.coronaMat = coronaMaterial(3.4);
    this.corona = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.coronaMat);
    this.corona.renderOrder = 2;
    this.map.add(this.corona);
    this.disposables.push(this.sunMat, this.sunMesh.geometry, this.coronaMat, this.corona.geometry);

    // —— planets ——
    const sphere = new THREE.SphereGeometry(1, 64, 32);
    this.disposables.push(sphere);
    for (const id of PLANET_IDS) {
      const w = worldById[id as WorldId];
      const b = this.makeBody(id, w.name, w.look, w.terrain.seed * 0.37, w.radiusKm, sphere, w);
      // orbit line: brightest just behind the planet, fading around the ellipse
      const orbitMat = new THREE.ShaderMaterial({
        uniforms: { uM: { value: 0 }, uColor: { value: new THREE.Color("#8fa3c8") }, uBase: { value: 0.1 }, uK: { value: 1 } },
        vertexShader: /* glsl */ `attribute float aM; varying float vM; void main() { vM = aM; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
        fragmentShader: /* glsl */ `uniform float uM; uniform vec3 uColor; uniform float uBase; varying float vM;
          void main() { float d = mod(uM - vM + 360.0, 360.0); float a = uBase + 0.55 * exp(-d / 70.0); gl_FragColor = vec4(uColor * a, a); }`,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      });
      const og = new THREE.BufferGeometry();
      og.setAttribute("position", new THREE.BufferAttribute(new Float32Array(513 * 3), 3));
      og.setAttribute("aM", new THREE.BufferAttribute(new Float32Array(513), 1));
      b.orbit = new THREE.Line(og, orbitMat);
      b.orbit.frustumCulled = false;
      b.orbitMat = orbitMat;
      this.map.add(b.orbit);
      this.disposables.push(og, orbitMat);
      if (id === "saturn") this.addRing(b, 0, 1.24, 2.27);
      if (id === "uranus" || id === "neptune") this.addRing(b, 1, 1.6, 2.05);
    }
    // —— moons ——
    const moonOrbitGeo = new THREE.BufferGeometry().setFromPoints(Array.from({ length: 128 }, (_, k) => new THREE.Vector3(Math.cos((k / 128) * Math.PI * 2), 0, Math.sin((k / 128) * Math.PI * 2))));
    const moonOrbitMat = new THREE.LineBasicMaterial({ color: "#8fa3c8", transparent: true, opacity: 0.18, depthWrite: false });
    this.disposables.push(moonOrbitGeo, moonOrbitMat);
    for (const m of MOONS) {
      const w = m.world ? worldById[m.world] : undefined;
      const look = w ? w.look : LOOKS[m.id] ?? { kind: "cratered", c1: m.color, c2: m.color, c3: "#ffffff", rim: "#000", rimK: 0 };
      const b = this.makeBody(m.id, m.name, look, (w?.terrain.seed ?? m.aKm % 97) * 0.37, m.rKm, sphere, w);
      b.moon = m;
      b.parent = this.bodies.get(m.parent);
      b.moonOrbit = new THREE.LineLoop(moonOrbitGeo, moonOrbitMat);
      this.map.add(b.moonOrbit);
    }

    this.buildBelts();
    this.halley = this.buildHalley();

    // —— transfer arc and spacecraft ——
    const am = new THREE.LineDashedMaterial({ color: "#c8ff3d", dashSize: 0.35, gapSize: 0.22, transparent: true, opacity: 0.95, depthWrite: false });
    this.arc = new THREE.Line(this.arcGeo, am);
    this.arc.visible = false;
    this.arc.frustumCulled = false;
    this.map.add(this.arc);
    this.disposables.push(this.arcGeo, am);
    const shell = new THREE.Mesh(new THREE.ConeGeometry(0.22, 0.16, 24), new THREE.MeshStandardMaterial({ color: "#e8e4dc", roughness: 0.5 }));
    shell.rotation.x = Math.PI / 2;
    const cruise = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.24, 0.05, 24), new THREE.MeshStandardMaterial({ color: "#6a7280", metalness: 0.7, roughness: 0.4 }));
    cruise.rotation.x = Math.PI / 2;
    cruise.position.z = -0.1;
    const flareTex = (() => {
      const c = document.createElement("canvas");
      c.width = c.height = 64;
      const g = c.getContext("2d")!;
      const gr = g.createRadialGradient(32, 32, 0, 32, 32, 30);
      gr.addColorStop(0, "rgba(255,255,255,1)");
      gr.addColorStop(0.3, "rgba(160,200,255,0.4)");
      gr.addColorStop(1, "rgba(0,0,0,0)");
      g.fillStyle = gr;
      g.fillRect(0, 0, 64, 64);
      return new THREE.CanvasTexture(c);
    })();
    const flareMat = new THREE.SpriteMaterial({ map: flareTex, color: new THREE.Color(1.5, 2, 3), blending: THREE.AdditiveBlending, depthWrite: false });
    this.flare = new THREE.Sprite(flareMat);
    this.flare.scale.setScalar(0);
    this.flare.position.z = -0.3;
    this.craft.add(shell, cruise, this.flare);
    this.craft.scale.setScalar(0.35);
    this.craft.visible = false;
    this.map.add(this.craft);
    this.disposables.push(shell.geometry, shell.material as THREE.Material, cruise.geometry, cruise.material as THREE.Material, flareMat, flareTex);

    // —— the close-approach planet (unit sphere ×100) ——
    this.bigPlanet = new THREE.Mesh(new THREE.SphereGeometry(1, 320, 160), new THREE.MeshBasicMaterial());
    this.bigPlanet.scale.setScalar(100);
    this.approach.add(this.bigPlanet);
    const lightA = new THREE.DirectionalLight("#ffffff", 3);
    lightA.position.copy(this.bigSun).multiplyScalar(500);
    this.approach.add(lightA, new THREE.AmbientLight("#ffffff", 0.08));

    this.setNow();
  }

  // ———————————————————————————— construction ————————————————————————————

  private makeBody(id: string, name: string, look: PlanetLook, seed: number, km: number, geo: THREE.BufferGeometry, world?: World) {
    const mat = planetMaterial(look, seed);
    mat.uniforms.uAmb.value = 0.012;
    const mesh = new THREE.Mesh(geo, mat);
    this.map.add(mesh);
    const spin = SPIN[id];
    const pole = new THREE.Quaternion().setFromUnitVectors(UP, spin ? fromRaDec(spin.ra, spin.dec) : UP);
    const b: Body = { id, name, world, km, mesh, mat, pole, spin: seed * 3, hours: spin?.hours ?? 24, au: new THREE.Vector3(), disp: new THREE.Vector3(), dispR: 1 };
    this.bodies.set(id, b);
    this.disposables.push(mat);
    return b;
  }

  private addRing(b: Body, style: number, inner: number, outer: number) {
    const rm = ringMaterial(style);
    rm.uniforms.uShadow.value = 1;
    const ring = new THREE.Mesh(new THREE.RingGeometry(inner, outer, 192, 1), rm);
    ring.rotation.x = -Math.PI / 2;
    b.mesh.add(ring);
    b.ring = ring;
    this.disposables.push(ring.geometry, rm);
  }

  /** the Milky Way, background stars weighted toward the galactic plane, and the bright named stars */
  private buildSky() {
    const mw = new THREE.Mesh(new THREE.SphereGeometry(50, 64, 32), milkyWayMaterial(GAL_NORTH, GAL_CENTER));
    mw.renderOrder = -20;
    mw.frustumCulled = false;
    this.sky.add(mw);
    this.disposables.push(mw.geometry, mw.material as THREE.Material);

    const N = GAL_NORTH.clone();
    const C = GAL_CENTER.clone().addScaledVector(N, -GAL_CENTER.dot(N)).normalize();
    const T = new THREE.Vector3().crossVectors(N, C);
    const r = rng(7);
    const count = 9000;
    const pos = new Float32Array(count * 3);
    const col = new Float32Array(count * 3);
    const size = new Float32Array(count);
    const c = new THREE.Color();
    for (let i = 0; i < count; i++) {
      const l = r() * Math.PI * 2;
      let b = Math.asin(r() * 2 - 1);
      // stars crowd toward the galactic plane
      if (r() < 0.5) b *= 0.18 + r() * 0.2;
      const d = new THREE.Vector3().addScaledVector(C, Math.cos(b) * Math.cos(l)).addScaledVector(T, Math.cos(b) * Math.sin(l)).addScaledVector(N, Math.sin(b)).multiplyScalar(48);
      pos.set([d.x, d.y, d.z], i * 3);
      const mag = 2.5 + 4.5 * Math.pow(r(), 0.45);
      const flux = Math.pow(10, -0.4 * (mag - 2.5));
      bvColor(r() < 0.12 ? -0.2 + r() * 0.3 : 0.2 + r() * 1.3, c).multiplyScalar(0.35 + flux * 1.6);
      col.set([c.r, c.g, c.b], i * 3);
      size[i] = 1.1 + flux * 1.4;
    }
    this.sky.add(this.starPoints(pos, col, size, false));
    // named stars, at their real positions (Orion's belt, the Plough, the Southern Cross…)
    const bp = new Float32Array(BRIGHT_STARS.length * 3);
    const bc = new Float32Array(BRIGHT_STARS.length * 3);
    const bs = new Float32Array(BRIGHT_STARS.length);
    BRIGHT_STARS.forEach(([, ra, dec, mag, bv], i) => {
      const d = fromRaDec(ra * 15, dec).multiplyScalar(47);
      bp.set([d.x, d.y, d.z], i * 3);
      const flux = Math.pow(10, -0.4 * (mag - 1));
      bvColor(bv, c).multiplyScalar(0.8 + Math.min(flux, 3) * 0.9);
      bc.set([c.r, c.g, c.b], i * 3);
      bs[i] = 3 + Math.min(flux, 4) * 2.4;
    });
    this.sky.add(this.starPoints(bp, bc, bs, true));
  }

  private starPoints(pos: Float32Array, col: Float32Array, size: Float32Array, glow: boolean) {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    g.setAttribute("color", new THREE.BufferAttribute(col, 3));
    g.setAttribute("aSize", new THREE.BufferAttribute(size, 1));
    const m = new THREE.ShaderMaterial({
      uniforms: { uDpr: { value: 1 }, uGlow: { value: glow ? 1 : 0 } },
      vertexShader: /* glsl */ `attribute float aSize; uniform float uDpr; varying vec3 vC;
        void main() { vC = color; vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0); gl_Position = vec4(p.xy, p.w * 0.99999, p.w); gl_PointSize = aSize * uDpr; }`,
      fragmentShader: /* glsl */ `uniform float uGlow; varying vec3 vC;
        void main() { float d = length(gl_PointCoord - 0.5) * 2.0;
          float core = 1.0 - smoothstep(uGlow > 0.5 ? 0.12 : 0.35, uGlow > 0.5 ? 0.3 : 1.0, d);
          float halo = uGlow > 0.5 ? exp(-d * 4.0) * 0.6 : 0.0;
          float a = core + halo; if (a < 0.01) discard; gl_FragColor = vec4(vC * a, 1.0); }`,
      vertexColors: true,
      // opaque pass + low renderOrder: drawn first, then hidden behind anything solid
      transparent: false,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      depthTest: false,
    });
    const pts = new THREE.Points(g, m);
    pts.frustumCulled = false;
    pts.renderOrder = -19;
    this.disposables.push(g, m);
    return pts;
  }

  /**
   * Small bodies, moved on the GPU along their own Kepler orbits: the main belt (Kirkwood gaps carved
   * at Jupiter's 3:1, 5:2, 7:3 and 2:1 resonances), Jupiter's Trojans 60° ahead and behind it, and the Kuiper belt.
   */
  private buildBelts() {
    const r = rng(99);
    const gauss = () => Math.sqrt(-2 * Math.log(Math.max(r(), 1e-9))) * Math.cos(2 * Math.PI * r());
    const make = (n: number, gen: (i: number) => [number, number, number, number, number, number, number], color: string) => {
      const attrs = { a: new Float32Array(n), e: new Float32Array(n), I: new Float32Array(n), node: new Float32Array(n), w: new Float32Array(n), M0: new Float32Array(n), s: new Float32Array(n) };
      for (let i = 0; i < n; i++) {
        const [a, e, I, node, w, M0, s] = gen(i);
        attrs.a[i] = a;
        attrs.e[i] = e;
        attrs.I[i] = I;
        attrs.node[i] = node;
        attrs.w[i] = w;
        attrs.M0[i] = M0;
        attrs.s[i] = s;
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(n * 3), 3));
      for (const [k, v] of Object.entries(attrs)) g.setAttribute(`a_${k}`, new THREE.BufferAttribute(v, 1));
      const m = new THREE.ShaderMaterial({
        uniforms: { uDays: { value: 0 }, uDistK: { value: 0 }, uUPA: { value: UPA }, uColor: { value: new THREE.Color(color) }, uDpr: { value: 1 }, uK: { value: 1 } },
        vertexShader: /* glsl */ `
attribute float a_a; attribute float a_e; attribute float a_I; attribute float a_node; attribute float a_w; attribute float a_M0; attribute float a_s;
uniform float uDays; uniform float uDistK; uniform float uUPA; uniform float uDpr; uniform int uK;
varying float vS; varying vec3 vTint;
void main() {
  // stony S-types dominate the inner belt, dark carbonaceous C-types the outer; each rock its own albedo
  vTint = mix(vec3(1.08, 0.93, 0.78), vec3(0.72, 0.75, 0.82), smoothstep(2.3, 3.1, a_a)) * (0.55 + 0.9 * fract(a_M0 * 0.1373 + a_node * 0.071));
  float n = 0.9856076686 / pow(a_a, 1.5);
  float M = radians(mod(a_M0 + n * uDays, 360.0));
  float E = M;
  for (int i = 0; i < 6 * uK; i++) E -= (E - a_e * sin(E) - M) / (1.0 - a_e * cos(E));
  float xp = a_a * (cos(E) - a_e);
  float yp = a_a * sqrt(1.0 - a_e * a_e) * sin(E);
  float w = radians(a_w); float O = radians(a_node); float inc = radians(a_I);
  float cw = cos(w), sw = sin(w), cO = cos(O), sO = sin(O), ci = cos(inc), si = sin(inc);
  vec3 ec = vec3((cw * cO - sw * sO * ci) * xp + (-sw * cO - cw * sO * ci) * yp,
                 (cw * sO + sw * cO * ci) * xp + (-sw * sO + cw * cO * ci) * yp,
                 sw * si * xp + cw * si * yp);
  vec3 p = vec3(ec.x, ec.z, -ec.y);
  float r = length(p);
  p *= mix(9.0 * sqrt(r), uUPA * r, uDistK) / r;
  vS = a_s;
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = (0.7 + a_s * 1.9) * uDpr;
}`,
        fragmentShader: /* glsl */ `uniform vec3 uColor; varying float vS; varying vec3 vTint;
          void main() { float d = length(gl_PointCoord - 0.5) * 2.0; float a = (1.0 - smoothstep(0.2, 1.0, d)) * (0.09 + vS * 0.62); if (a < 0.015) discard; gl_FragColor = vec4(uColor * vTint * a, 1.0); }`,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      });
      const p = new THREE.Points(g, m);
      p.frustumCulled = false;
      this.map.add(p);
      this.belts.push(p);
      this.beltMats.push(m);
      this.disposables.push(g, m);
    };
    // main belt
    const gaps = [2.502, 2.825, 2.958, 3.279];
    make(
      11000,
      () => {
        let a = 2.1 + r() * 1.25;
        for (let k = 0; k < 20 && gaps.some((g) => Math.abs(a - g) < (g === 2.502 ? 0.035 : 0.022)); k++) a = 2.1 + r() * 1.25;
        if (r() < 0.35) a = 2.3 + Math.abs(gauss()) * 0.4;
        return [a, Math.min(0.32, Math.abs(gauss()) * 0.1), Math.abs(gauss()) * 8, r() * 360, r() * 360, r() * 360, Math.pow(r(), 3)];
      },
      "#b8a690",
    );
    // Jupiter's Trojans: same orbit, 60° ahead (L4) and behind (L5)
    const jl = elementsAt("jupiter", J2000).L;
    make(
      2200,
      (i) => {
        const node = r() * 360;
        const peri = r() * 360;
        const lam = jl + (i % 2 ? 60 : -60) + gauss() * 11;
        return [5.2026 + gauss() * 0.05, Math.abs(gauss()) * 0.06, Math.abs(gauss()) * 12, node, peri - node, lam - peri, Math.pow(r(), 3)];
      },
      "#a89880",
    );
    // the Kuiper belt: the cold classical disk around 42–48 AU, plus Pluto-like resonant objects at 39.4 AU
    make(
      5000,
      () => {
        const res = r() < 0.25;
        return [res ? 39.4 + gauss() * 0.2 : 42 + r() * 6, res ? 0.1 + r() * 0.2 : Math.abs(gauss()) * 0.05, res ? Math.abs(gauss()) * 12 : Math.abs(gauss()) * 4, r() * 360, r() * 360, r() * 360, Math.pow(r(), 3)];
      },
      "#8fa0b8",
    );
  }

  private buildHalley() {
    const au: THREE.Vector3[] = [];
    // sample evenly in eccentric anomaly so the tight perihelion turn is smooth
    for (let k = 0; k <= 720; k++) {
      const E = (k / 720) * Math.PI * 2 - Math.PI;
      const M = (E - HALLEY.e * Math.sin(E)) / D2R;
      au.push(orbitPoint(HALLEY.a, HALLEY.e, HALLEY.I, HALLEY.node, HALLEY.argPeri, M, new THREE.Vector3()));
    }
    const g = new THREE.BufferGeometry().setFromPoints(au);
    const m = new THREE.LineBasicMaterial({ color: "#7fd0ff", transparent: true, opacity: 0.12, depthWrite: false });
    const line = new THREE.Line(g, m);
    line.frustumCulled = false;
    this.map.add(line);
    const head = new THREE.Mesh(new THREE.SphereGeometry(1, 16, 8), new THREE.MeshBasicMaterial({ color: new THREE.Color(1.6, 1.8, 2) }));
    this.map.add(head);
    // the tail always points away from the Sun, and grows as the comet nears it
    const tailMat = new THREE.ShaderMaterial({
      uniforms: { uK: { value: 1 }, uI: { value: 0 } },
      vertexShader: /* glsl */ `varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: /* glsl */ `uniform float uI; varying vec2 vUv;
        void main() { float along = 1.0 - vUv.y; float a = uI * pow(1.0 - along, 1.6) * (0.6 + 0.4 * sin(vUv.x * 6.2831)); gl_FragColor = vec4(vec3(0.7, 0.85, 1.0) * a, a); }`,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    const tg = new THREE.ConeGeometry(0.35, 1, 24, 1, true);
    tg.translate(0, -0.5, 0);
    const tail = new THREE.Mesh(tg, tailMat);
    this.map.add(tail);
    this.disposables.push(g, m, head.geometry, head.material as THREE.Material, tailMat, tg);
    return { line, au, head, tail, tailMat, pos: new THREE.Vector3() };
  }

  // ———————————————————————————— scale ————————————————————————————

  /** 0 = illustrative, 1 = true distances, 2 = true scale */
  setScale(mode: number) {
    this.distTarget = mode >= 1 ? 1 : 0;
    this.sizeTarget = mode >= 2 ? 1 : 0;
  }

  private mapR(r: number) {
    return THREE.MathUtils.lerp(9 * Math.sqrt(r), UPA * r, this.distK);
  }

  /** heliocentric AU (three.js axes) → display position */
  toDisplay(au: THREE.Vector3, out = new THREE.Vector3()) {
    const r = au.length();
    if (r < 1e-9) return out.set(0, 0, 0);
    return out.copy(au).multiplyScalar(this.mapR(r) / r);
  }

  private planetR(km: number) {
    const enlarged = THREE.MathUtils.lerp(bodyR(km), bodyR(km) * 0.45, this.distK);
    return THREE.MathUtils.lerp(enlarged, (km / AU_KM) * UPA, this.sizeK);
  }

  sunR() {
    return THREE.MathUtils.lerp(THREE.MathUtils.lerp(2.2, 0.9, this.distK), (SUN_KM / AU_KM) * UPA, this.sizeK);
  }

  // ———————————————————————————— positions ————————————————————————————

  /** heliocentric AU position of a planet or moon at `jd` */
  private bodyAU(b: Body, jd: number, out: THREE.Vector3) {
    if (!b.moon) return planetPos(b.id, jd, out);
    return planetPos(b.parent!.id, jd, out);
  }

  /** offset of a moon from its parent in display units (in the parent's equatorial plane, or the real Moon) */
  private moonOffset(b: Body, jd: number, out: THREE.Vector3) {
    const m = b.moon!;
    const p = b.parent!;
    const enlargedR = THREE.MathUtils.lerp(bodyR(p.km), bodyR(p.km) * 0.45, this.distK);
    const dist = THREE.MathUtils.lerp(enlargedR * moonSpread(m.aKm, p.km), (m.aKm / AU_KM) * UPA, this.sizeK);
    if (m.id === "moon") return moonGeocentric(jd, out).multiplyScalar(dist);
    const ang = (m.phase + (360 * (jd - J2000)) / m.days) * D2R;
    out.set(Math.cos(ang), 0, -Math.sin(ang)).applyAxisAngle(new THREE.Vector3(1, 0, 0), m.inc * D2R);
    return out.applyQuaternion(p.pole).multiplyScalar(dist);
  }

  /** display position of any world (planet or moon), now or at another date */
  posOf(id: string, out = new THREE.Vector3(), jd = this.jd) {
    if (id === "halley") return this.toDisplay(halleyPos(jd, tmp2), out);
    const b = this.bodies.get(id);
    if (!b) return out.set(0, 0, 0);
    this.toDisplay(this.bodyAU(b, jd, tmp2), out);
    if (b.moon) out.add(this.moonOffset(b, jd, tmp));
    return out;
  }

  displayRadius(id: string) {
    if (id === "halley") return THREE.MathUtils.lerp(0.08, 0.001, this.sizeK);
    return this.bodies.get(id)?.dispR ?? this.sunR();
  }

  /** true distance from the Sun (AU) and from Earth (AU) */
  distances(id: string, jd = this.jd) {
    const b = this.bodies.get(id);
    if (!b) return { sun: 0, earth: 0 };
    const p = this.bodyAU(b, jd, new THREE.Vector3());
    const e = planetPos("earth", jd, new THREE.Vector3());
    let earth = p.distanceTo(e);
    if (id === "moon") earth = 384400 / AU_KM;
    return { sun: p.length(), earth };
  }

  setNow() {
    this.jd = Date.now() / 86400000 + 2440587.5;
    this.layout(this.jd, 0);
  }

  /** move every body to date `jd`; `dtReal` (s) drives the spin animation */
  layout(jd: number, dtReal = 0) {
    const dDays = jd - this.jd;
    this.jd = jd;
    // ease between scale modes
    const k = 1 - Math.exp(-3 * Math.max(dtReal, 0));
    this.distK += (this.distTarget - this.distK) * (dtReal > 0 ? k : 1);
    this.sizeK += (this.sizeTarget - this.sizeK) * (dtReal > 0 ? k : 1);
    if (Math.abs(this.distK - this.distTarget) < 1e-4) this.distK = this.distTarget;
    if (Math.abs(this.sizeK - this.sizeTarget) < 1e-4) this.sizeK = this.sizeTarget;
    const scaleChanged = Math.abs(this.distK + this.sizeK * 3 - this.lastScaleK) > 1e-5;
    this.lastScaleK = this.distK + this.sizeK * 3;

    const sR = this.sunR();
    this.sunMesh.scale.setScalar(sR);
    this.corona.scale.setScalar(sR * 3.4);

    for (const b of this.bodies.values()) {
      this.bodyAU(b, jd, b.au);
      this.toDisplay(b.au, b.disp);
      if (b.moon) {
        b.disp.add(this.moonOffset(b, jd, tmp));
        b.dispR = THREE.MathUtils.lerp(Math.max(0.035, bodyR(b.km) * 0.7 - 0.12) * THREE.MathUtils.lerp(1, 0.6, this.distK), (b.km / AU_KM) * UPA, this.sizeK);
        // the moon's orbit circle around its parent
        const o = b.moonOrbit!;
        const p = b.parent!;
        const off = this.moonOffset(b, jd, tmp).length();
        o.position.copy(this.toDisplay(p.au, tmp2));
        if (b.moon.id === "moon") o.quaternion.setFromAxisAngle(new THREE.Vector3(1, 0, 0), 5.145 * D2R);
        else o.quaternion.copy(p.pole).multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), b.moon.inc * D2R));
        o.scale.setScalar(off);
      } else b.dispR = this.planetR(b.km);
      b.mesh.position.copy(b.disp);
      b.mesh.scale.setScalar(b.dispR);
      // spin about the real pole (visually capped so time-warp doesn't strobe)
      const dA = THREE.MathUtils.clamp((2 * Math.PI * dDays * 24) / b.hours, -0.06, 0.06);
      b.spin += dA + (dtReal * Math.sign(b.hours) * 0.02) / Math.max(1, Math.abs(b.hours) / 24);
      b.mesh.quaternion.copy(b.pole).multiply(tmpQ.setFromAxisAngle(UP, b.spin));
      (b.mat.uniforms.uSun.value as THREE.Vector3).copy(b.disp).negate().normalize();
      if (b.ring) ((b.ring.material as THREE.ShaderMaterial).uniforms.uSun.value as THREE.Vector3).copy(b.mat.uniforms.uSun.value as THREE.Vector3);
      // planetary orbit: rebuild the ellipse occasionally (elements drift), remap when the scale changes
      if (b.orbit && b.orbitMat) {
        if (!b.orbitAU || Math.abs(jd - (b.orbitJD ?? 0)) > 3650) {
          const path = orbitPath(b.id, jd);
          b.orbitAU = path.pts;
          b.orbitJD = jd;
          const am = b.orbit.geometry.attributes.aM as THREE.BufferAttribute;
          path.ms.forEach((m, i) => am.setX(i, m));
          am.needsUpdate = true;
          this.remapOrbit(b);
        } else if (scaleChanged) this.remapOrbit(b);
        const el = elementsAt(b.id, jd);
        b.orbitMat.uniforms.uM.value = ((((el.L - el.peri) % 360) + 360) % 360);
      }
    }

    for (const m of this.beltMats) {
      m.uniforms.uDays.value = jd - J2000;
      m.uniforms.uDistK.value = this.distK;
    }

    // Halley
    const h = this.halley;
    halleyPos(jd, h.pos);
    const hp = this.toDisplay(h.pos, tmp);
    h.head.position.copy(hp);
    h.head.scale.setScalar(THREE.MathUtils.lerp(0.06, 0.0005, this.sizeK));
    const r = h.pos.length();
    const tailLen = Math.min(6, 2.2 / (r * r)) * THREE.MathUtils.lerp(1, 0.6, this.distK);
    h.tail.visible = tailLen > 0.02;
    h.tail.position.copy(hp);
    h.tail.quaternion.setFromUnitVectors(new THREE.Vector3(0, -1, 0), tmp2.copy(hp).normalize());
    h.tail.scale.set(tailLen * 0.25 + 0.02, tailLen, tailLen * 0.25 + 0.02);
    h.tailMat.uniforms.uI.value = Math.min(1.5, 1.2 / Math.max(r, 0.3));
    if (scaleChanged) {
      const pos = h.line.geometry.attributes.position as THREE.BufferAttribute;
      h.au.forEach((p, i) => {
        this.toDisplay(p, tmp);
        pos.setXYZ(i, tmp.x, tmp.y, tmp.z);
      });
      pos.needsUpdate = true;
      this.remapArc();
    }
  }

  private remapOrbit(b: Body) {
    const pos = b.orbit!.geometry.attributes.position as THREE.BufferAttribute;
    b.orbitAU!.forEach((p, i) => {
      this.toDisplay(p, tmp);
      pos.setXYZ(i, tmp.x, tmp.y, tmp.z);
    });
    pos.needsUpdate = true;
  }

  highlight(id: string | null) {
    this.highlighted = id;
    const target = id ? helio(worldById[id as WorldId] ?? WORLDS[0]).id : null;
    for (const b of this.bodies.values()) {
      if (!b.orbitMat) continue;
      const on = target === b.id;
      (b.orbitMat.uniforms.uColor.value as THREE.Color).set(on ? "#c8ff3d" : "#8fa3c8");
      b.orbitMat.uniforms.uBase.value = on ? 0.35 : 0.1;
    }
  }

  // ———————————————————————————— transfers ————————————————————————————

  /**
   * Plan a Hohmann transfer between the planets' real positions: wait for the launch window (the
   * date when the target will be 180° around the Sun from the departure point on arrival), then fly.
   */
  planTransfer(from: World, to: World, jd: number): Transfer {
    const hf = helio(from);
    const ht = helio(to);
    if (hf.id === ht.id) {
      const days = from.id === to.id ? 0.5 : from.id === "moon" || to.id === "moon" ? 3 : 8;
      this.arcAU = [];
      this.arc.visible = false;
      return { from, to, local: true, launchJD: jd, arriveJD: jd + days, wait: 0, days, dv: 3.1, pathAU: [] };
    }
    const { launch, arrive, days, a1, a2 } = launchWindow(hf.id, ht.id, jd);
    const P1 = planetPos(hf.id, launch, new THREE.Vector3());
    const P2 = planetPos(ht.id, arrive, new THREE.Vector3());
    const path = this.hohmannPath(P1, P2, a1, a2);
    this.arcAU = path;
    this.remapArc();
    this.arc.visible = true;
    return { from, to, local: false, launchJD: launch, arriveJD: arrive, wait: launch - jd, days, dv: hohmannDv(a1, a2), pathAU: path };
  }

  /** half an ellipse from P1 to P2 with Kepler timing (equal time steps), fitted to the real end points */
  private hohmannPath(P1: THREE.Vector3, P2: THREE.Vector3, a1: number, a2: number) {
    const out: THREE.Vector3[] = [];
    const outward = a2 >= a1;
    const a = (a1 + a2) / 2;
    const e = Math.abs(a2 - a1) / (a1 + a2);
    const r1 = P1.length();
    const r2 = P2.length();
    const th1 = Math.atan2(-P1.z, P1.x);
    let dth = Math.atan2(-P2.z, P2.x) - th1;
    dth = ((dth % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
    const lat1 = Math.asin(P1.y / r1);
    const lat2 = Math.asin(P2.y / r2);
    for (let k = 0; k <= 160; k++) {
      const t = k / 160;
      const M = Math.PI * t + (outward ? 0 : Math.PI);
      const E = kepler(M, e);
      const nu = 2 * Math.atan2(Math.sqrt(1 + e) * Math.sin(E / 2), Math.sqrt(1 - e) * Math.cos(E / 2));
      const frac = ((((outward ? nu : nu - Math.PI) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI)) / Math.PI;
      const f = k === 160 ? 1 : Math.min(1, frac);
      const rh = a * (1 - e * Math.cos(E));
      const u = Math.abs(a2 - a1) < 1e-6 ? t : (rh - a1) / (a2 - a1);
      const r = r1 + (r2 - r1) * u;
      const th = th1 + dth * f;
      const lat = lat1 + (lat2 - lat1) * f;
      out.push(new THREE.Vector3(r * Math.cos(lat) * Math.cos(th), r * Math.sin(lat), -r * Math.cos(lat) * Math.sin(th)));
    }
    return out;
  }

  private remapArc() {
    if (!this.arcAU.length) return;
    this.arcGeo.setFromPoints(this.arcAU.map((p) => this.toDisplay(p, new THREE.Vector3())));
    this.arc.computeLineDistances();
  }

  /** place the craft at fraction t of the flight (display position returned) */
  craftAt(tr: Transfer, t: number, burn: number) {
    const p = new THREE.Vector3();
    const ahead = new THREE.Vector3();
    if (tr.local) {
      const a = this.posOf(tr.from.id, new THREE.Vector3());
      const b = this.posOf(tr.to.id, new THREE.Vector3());
      const s = t * t * (3 - 2 * t);
      const lift = Math.max(this.displayRadius(helio(tr.from).id) * 0.8, a.distanceTo(b) * 0.25);
      p.lerpVectors(a, b, s).y += Math.sin(Math.PI * t) * lift;
      ahead.lerpVectors(a, b, Math.min(1, s + 0.02));
    } else {
      const n = tr.pathAU.length - 1;
      const f = t * n;
      const i = Math.min(n - 1, Math.floor(f));
      const q = new THREE.Vector3().lerpVectors(tr.pathAU[i], tr.pathAU[i + 1], f - i);
      this.toDisplay(q, p);
      this.toDisplay(tr.pathAU[Math.min(n, i + 2)], ahead);
      if (ahead.distanceToSquared(p) < 1e-10) ahead.copy(p).add(new THREE.Vector3(0, 0, -1));
    }
    this.craft.position.copy(p);
    this.craft.lookAt(ahead);
    this.craft.scale.setScalar(THREE.MathUtils.lerp(0.35, 0.002, this.sizeK));
    // a beacon so the craft can be found at any zoom, flaring during burns
    this.flare.scale.setScalar(0.7 + burn * 1.6);
    return p;
  }

  hideArc() {
    this.arc.visible = false;
  }

  // ———————————————————————————— approach ————————————————————————————

  setApproach(world: World) {
    this.bigMat?.dispose();
    this.atmo?.removeFromParent();
    this.bigRing?.removeFromParent();
    this.bigMat = planetMaterial(world.look, world.terrain.seed * 0.37);
    (this.bigMat.uniforms.uSun.value as THREE.Vector3).copy(this.bigSun);
    this.bigPlanet.material = this.bigMat;
    this.bigPlanet.rotation.set(0.35, world.terrain.seed, 0.1);
    if (world.atm.rho > 0.001) {
      const am = atmoMaterial(world.look.rim, 0.25 + world.look.rimK * 0.45);
      (am.uniforms.uSun.value as THREE.Vector3).copy(this.bigSun);
      this.atmo = new THREE.Mesh(new THREE.SphereGeometry(100.8, 96, 48), am);
      this.approach.add(this.atmo);
    }
    if (world.look.rings) {
      const rm = ringMaterial(0);
      rm.uniforms.uShadow.value = 1;
      (rm.uniforms.uSun.value as THREE.Vector3).copy(this.bigSun);
      this.bigRing = new THREE.Mesh(new THREE.RingGeometry(1.24, 2.27, 256), rm);
      this.bigRing.rotation.x = -Math.PI / 2;
      this.bigPlanet.add(this.bigRing);
    }
  }

  // ———————————————————————————— frame ————————————————————————————

  update(t: number, cam: THREE.PerspectiveCamera, dpr = 1) {
    this.sky.position.copy(cam.position);
    this.corona.quaternion.copy(cam.quaternion);
    this.sunMat.uniforms.uTime.value = t;
    this.coronaMat.uniforms.uTime.value = t;
    for (const b of this.bodies.values()) b.mat.uniforms.uTime.value = t;
    if (this.bigMat) this.bigMat.uniforms.uTime.value = t;
    for (const m of this.beltMats) m.uniforms.uDpr.value = dpr;
    this.sky.traverse((o) => {
      const m = (o as THREE.Points).material as THREE.ShaderMaterial | undefined;
      if (m?.uniforms?.uDpr) m.uniforms.uDpr.value = dpr;
    });
    // tiny moons only matter when you are close to their planet
    for (const b of this.bodies.values()) {
      if (!b.moon) continue;
      const near = cam.position.distanceTo(b.parent!.disp) < Math.max(b.parent!.dispR * 60, 0.05);
      b.mesh.visible = near || !!b.world;
      b.moonOrbit!.visible = near;
    }
  }

  /** screen positions for the HTML labels */
  labelTargets(): { id: string; name: string; pos: THREE.Vector3; r: number; kind: "sun" | "planet" | "moon" | "comet"; selectable: boolean; parent?: string }[] {
    const out: ReturnType<SpaceScene["labelTargets"]> = [{ id: "sun", name: "Sun", pos: new THREE.Vector3(), r: this.sunR(), kind: "sun", selectable: false }];
    for (const b of this.bodies.values())
      out.push({ id: b.id, name: b.name, pos: b.disp, r: b.dispR, kind: b.moon ? "moon" : "planet", selectable: !!b.world, parent: b.parent?.id });
    out.push({ id: "halley", name: "1P/Halley", pos: this.halley.head.position, r: 0.05, kind: "comet", selectable: false });
    return out;
  }

  isMoonVisible(id: string) {
    const b = this.bodies.get(id);
    return !!b && b.mesh.visible;
  }

  get highlightedId() {
    return this.highlighted;
  }

  dispose() {
    this.disposables.forEach((d) => d.dispose());
    this.bigMat?.dispose();
    this.bigPlanet.geometry.dispose();
  }
}

const tmpQ = new THREE.Quaternion();
