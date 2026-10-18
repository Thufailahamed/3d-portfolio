import * as THREE from "three";
import type { Ground } from "./terrain";
import { makePuffTexture, makeTrackTexture } from "./textures";
import type { World } from "./worlds";

/** A small cached height grid so thousands of particles can land without thousands of noise calls. */
class HeightCache {
  private n = 40;
  private cell = 2;
  private data = new Float32Array(this.n * this.n);
  private ox = 1e9;
  private oz = 1e9;
  constructor(private ground: Ground) {}
  refresh(x: number, z: number, force = false) {
    const half = (this.n * this.cell) / 2;
    if (!force && Math.abs(x - (this.ox + half)) < 12 && Math.abs(z - (this.oz + half)) < 12) return;
    this.ox = Math.round(x - half);
    this.oz = Math.round(z - half);
    for (let j = 0; j < this.n; j++) for (let i = 0; i < this.n; i++) this.data[j * this.n + i] = this.ground.height(this.ox + i * this.cell, this.oz + j * this.cell);
  }
  at(x: number, z: number) {
    const fx = (x - this.ox) / this.cell;
    const fz = (z - this.oz) / this.cell;
    if (fx < 0 || fz < 0 || fx >= this.n - 1 || fz >= this.n - 1) return -1e9;
    const i = Math.floor(fx);
    const j = Math.floor(fz);
    const u = fx - i;
    const v = fz - j;
    const d = this.data;
    const n = this.n;
    const a = d[j * n + i];
    const b = d[j * n + i + 1];
    const c = d[(j + 1) * n + i];
    const e = d[(j + 1) * n + i + 1];
    return a + (b - a) * u + (c - a) * v + (a - b - c + e) * u * v;
  }
}

const DUST_VERT = /* glsl */ `
attribute float aSize; attribute float aAlpha; attribute float aShade;
uniform float uScale;
varying float vAlpha; varying float vShade;
#include <fog_pars_vertex>
void main() {
  vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mvPosition;
  gl_PointSize = clamp(aSize * uScale / -mvPosition.z, 0.0, 512.0);
  // fade sprites that get right up against the lens
  vAlpha = aAlpha * smoothstep(0.4, 2.5, -mvPosition.z);
  vShade = aShade;
  #include <fog_vertex>
}`;
const DUST_FRAG = /* glsl */ `
uniform sampler2D tPuff; uniform vec3 uColor; uniform vec3 uLight; uniform vec3 uAmb;
varying float vAlpha; varying float vShade;
#include <fog_pars_fragment>
void main() {
  float a = texture2D(tPuff, gl_PointCoord).r * vAlpha;
  if (a < 0.004) discard;
  vec3 c = uColor * (uLight * mix(0.55, 1.0, vShade) + uAmb);
  gl_FragColor = vec4(c, a);
  #include <fog_fragment>
}`;

export class Dust {
  readonly points: THREE.Points;
  private N = 6000;
  private pos: Float32Array;
  private vel = new Float32Array(this.N * 3);
  private life = new Float32Array(this.N);
  private max = new Float32Array(this.N);
  private size: Float32Array;
  private grow = new Float32Array(this.N);
  private alpha: Float32Array;
  private a0 = new Float32Array(this.N);
  private shade: Float32Array;
  private landed = new Uint8Array(this.N);
  private head = 0;
  private cache: HeightCache;
  private mat: THREE.ShaderMaterial;
  private geo = new THREE.BufferGeometry();

  constructor(
    private world: World,
    ground: Ground,
  ) {
    this.cache = new HeightCache(ground);
    this.pos = new Float32Array(this.N * 3);
    this.size = new Float32Array(this.N);
    this.alpha = new Float32Array(this.N);
    this.shade = new Float32Array(this.N);
    for (let i = 0; i < this.N; i++) this.pos[i * 3 + 1] = -1e5;
    this.geo.setAttribute("position", new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute("aSize", new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute("aAlpha", new THREE.BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute("aShade", new THREE.BufferAttribute(this.shade, 1).setUsage(THREE.DynamicDrawUsage));
    this.mat = new THREE.ShaderMaterial({
      vertexShader: DUST_VERT,
      fragmentShader: DUST_FRAG,
      uniforms: THREE.UniformsUtils.merge([
        THREE.UniformsLib.fog,
        {
          tPuff: { value: makePuffTexture() },
          uColor: { value: new THREE.Color(world.soil.dustColor) },
          uLight: { value: new THREE.Color(1, 1, 1) },
          uAmb: { value: new THREE.Color(0.3, 0.3, 0.3) },
          uScale: { value: 600 },
        },
      ]),
      transparent: true,
      depthWrite: false,
      fog: true,
    });
    this.points = new THREE.Points(this.geo, this.mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 5;
  }

  setLight(sun: THREE.Color, amb: THREE.Color) {
    (this.mat.uniforms.uLight.value as THREE.Color).copy(sun);
    (this.mat.uniforms.uAmb.value as THREE.Color).copy(amb);
  }

  setScale(heightPx: number, fovDeg: number) {
    this.mat.uniforms.uScale.value = heightPx / (2 * Math.tan(THREE.MathUtils.degToRad(fovDeg) / 2));
  }

  focus(x: number, z: number, force = false) {
    this.cache.refresh(x, z, force);
  }

  emit(p: THREE.Vector3, v: THREE.Vector3, spread: number, size: number, life: number, alpha = 0.6, grow = 0) {
    const i = this.head;
    this.head = (this.head + 1) % this.N;
    this.pos[i * 3] = p.x;
    this.pos[i * 3 + 1] = p.y;
    this.pos[i * 3 + 2] = p.z;
    this.vel[i * 3] = v.x + (Math.random() - 0.5) * spread;
    this.vel[i * 3 + 1] = v.y + Math.random() * spread * 0.6;
    this.vel[i * 3 + 2] = v.z + (Math.random() - 0.5) * spread;
    this.life[i] = 0;
    this.max[i] = life * (0.7 + Math.random() * 0.6);
    this.size[i] = size * (0.6 + Math.random() * 0.8);
    this.grow[i] = grow;
    this.a0[i] = alpha;
    this.alpha[i] = alpha;
    this.shade[i] = Math.random();
    this.landed[i] = 0;
  }

  update(dt: number, wind: THREE.Vector3) {
    const W = this.world;
    const g = W.g;
    const drag = W.soil.dustDrag;
    const vacuum = W.atm.rho < 0.001;
    const p = this.pos;
    const v = this.vel;
    for (let i = 0; i < this.N; i++) {
      if (this.alpha[i] <= 0 && this.life[i] >= this.max[i]) continue;
      this.life[i] += dt;
      const t = this.life[i] / this.max[i];
      if (t >= 1) {
        this.alpha[i] = 0;
        p[i * 3 + 1] = -1e5;
        continue;
      }
      const k = i * 3;
      if (!this.landed[i]) {
        // gravity, and in an atmosphere drag toward the wind (fine dust hangs, sand falls)
        v[k + 1] -= g * dt;
        if (drag > 0) {
          const f = 1 - Math.exp(-drag * dt);
          v[k] += (wind.x - v[k]) * f;
          v[k + 1] += (0 - v[k + 1]) * f * 0.85;
          v[k + 2] += (wind.z - v[k + 2]) * f;
        }
        p[k] += v[k] * dt;
        p[k + 1] += v[k + 1] * dt;
        p[k + 2] += v[k + 2] * dt;
        const gy = this.cache.at(p[k], p[k + 2]);
        if (p[k + 1] < gy + 0.02) {
          p[k + 1] = gy + 0.02;
          if (vacuum) {
            // in vacuum grains simply land where their parabola ends
            this.landed[i] = 1;
            this.max[i] = Math.min(this.max[i], this.life[i] + 0.25);
          } else {
            v[k + 1] = Math.abs(v[k + 1]) * 0.1;
            v[k] *= 0.5;
            v[k + 2] *= 0.5;
          }
        }
      }
      this.size[i] += this.grow[i] * dt;
      this.alpha[i] = this.a0[i] * Math.min(1, t * 12) * (1 - t) * (1 - t * 0.3);
    }
    (this.geo.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    (this.geo.attributes.aSize as THREE.BufferAttribute).needsUpdate = true;
    (this.geo.attributes.aAlpha as THREE.BufferAttribute).needsUpdate = true;
  }

  clear() {
    this.alpha.fill(0);
    this.life.fill(1);
    this.max.fill(1);
    for (let i = 0; i < this.N; i++) this.pos[i * 3 + 1] = -1e5;
  }

  dispose() {
    this.geo.dispose();
    (this.mat.uniforms.tPuff.value as THREE.Texture).dispose();
    this.mat.dispose();
  }
}

/** Wheel prints: one decal per ~0.3 m of travel per wheel, kept for good (tracks last decades on airless worlds). */
export class Tracks {
  readonly mesh: THREE.InstancedMesh;
  private MAX = 9000;
  private n = 0;
  private head = 0;
  private last: (THREE.Vector3 | null)[] = [null, null, null, null, null, null];
  private tex = makeTrackTexture();
  private mat: THREE.MeshStandardMaterial;

  constructor(world: World) {
    const geo = new THREE.PlaneGeometry(0.42, 0.34);
    geo.rotateX(-Math.PI / 2);
    const uv = geo.attributes.uv as THREE.BufferAttribute;
    for (let i = 0; i < uv.count; i++) uv.setY(i, uv.getY(i) * 0.62);
    const c = new THREE.Color(world.palette.low).multiplyScalar(0.5);
    this.mat = new THREE.MeshStandardMaterial({
      color: c,
      roughness: 1,
      alphaMap: this.tex,
      transparent: true,
      opacity: world.soil.track,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -4,
    });
    this.mesh = new THREE.InstancedMesh(geo, this.mat, this.MAX);
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    this.mesh.receiveShadow = true;
    this.mesh.renderOrder = 1;
  }

  private m = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private basis = new THREE.Matrix4();
  private s = new THREE.Vector3(1, 1, 1);
  private x = new THREE.Vector3();

  /** called per wheel per frame with its contact point, ground normal and heading */
  stamp(i: number, at: THREE.Vector3, normal: THREE.Vector3, fwd: THREE.Vector3, pressure: number) {
    if (this.mat.opacity <= 0 || pressure < 0.05) {
      this.last[i] = null;
      return;
    }
    const prev = this.last[i];
    if (prev && prev.distanceToSquared(at) < 0.3 * 0.3) return;
    if (prev && prev.distanceToSquared(at) > 2.5) {
      this.last[i] = at.clone();
      return;
    }
    this.last[i] = at.clone();
    // tangent frame: x across the track, y the ground normal, z along it
    this.x.crossVectors(normal, fwd).normalize();
    const z = new THREE.Vector3().crossVectors(this.x, normal).normalize();
    this.basis.makeBasis(this.x, normal, z);
    this.q.setFromRotationMatrix(this.basis);
    this.s.set(1, 1, 1);
    this.m.compose(new THREE.Vector3(at.x, at.y + 0.015, at.z), this.q, this.s);
    this.mesh.setMatrixAt(this.head, this.m);
    this.head = (this.head + 1) % this.MAX;
    this.n = Math.min(this.MAX, this.n + 1);
    this.mesh.count = this.n;
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  breakAll() {
    this.last.fill(null);
  }

  dispose() {
    this.mesh.geometry.dispose();
    this.mat.dispose();
    this.tex.dispose();
  }
}

/** Rocket exhaust: an additive flickering cone. In vacuum the plume flares wide and nearly invisible. */
export function plumeMaterial(vacuum: boolean) {
  return new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uPower: { value: 0 }, uVac: { value: vacuum ? 1 : 0 } },
    vertexShader: /* glsl */ `
varying vec2 vUv; varying vec3 vN; varying vec3 vV;
void main() {
  vUv = uv;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vN = normalize(normalMatrix * normal);
  vV = normalize(-mv.xyz);
  gl_Position = projectionMatrix * mv;
}`,
    fragmentShader: /* glsl */ `
uniform float uTime; uniform float uPower; uniform float uVac;
varying vec2 vUv; varying vec3 vN; varying vec3 vV;
void main() {
  float along = 1.0 - vUv.y;
  float edge = pow(abs(dot(vN, vV)), 1.5);
  float flick = 0.75 + 0.25 * sin(uTime * 63.0 + vUv.y * 40.0) * sin(uTime * 37.0 + vUv.x * 20.0);
  float diamonds = mix(1.0, 0.75 + 0.25 * sin(along * 38.0 - uTime * 30.0), 1.0 - uVac);
  float a = edge * (1.0 - along) * (1.0 - along) * uPower * flick * diamonds * mix(1.0, 0.35, uVac);
  vec3 hot = mix(vec3(1.0, 0.75, 0.45), vec3(0.75, 0.82, 1.0), uVac);
  vec3 c = mix(hot * 3.0, vec3(1.0, 0.95, 0.9) * 6.0, pow(1.0 - along, 6.0));
  gl_FragColor = vec4(c * a, a);
}`,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
  });
}

export function plumeGeometry(len: number, r: number) {
  const g = new THREE.CylinderGeometry(r * 2.4, r * 0.7, len, 16, 1, true);
  g.translate(0, -len / 2, 0);
  return g;
}

/**
 * Entry glow around a capsule whose heat shield faces −y: a bright shock cap just ahead of the shield
 * and a wake of ionised gas streaming back past the shoulders.
 */
export function entryGlow(color: string) {
  const g = new THREE.Group();
  const mk = (mode: number) =>
    new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 }, uHeat: { value: 0 }, uColor: { value: new THREE.Color(color) }, uMode: { value: mode } },
      vertexShader: /* glsl */ `
varying vec2 vUv; varying vec3 vN; varying vec3 vV;
void main() {
  vUv = uv;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vN = normalize(normalMatrix * normal);
  vV = normalize(-mv.xyz);
  gl_Position = projectionMatrix * mv;
}`,
      fragmentShader: /* glsl */ `
uniform float uTime; uniform float uHeat; uniform vec3 uColor; uniform float uMode;
varying vec2 vUv; varying vec3 vN; varying vec3 vV;
float h(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float n(vec2 p) { vec2 i = floor(p); vec2 f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(h(i), h(i + vec2(1, 0)), f.x), mix(h(i + vec2(0, 1)), h(i + vec2(1, 1)), f.x), f.y); }
void main() {
  float facing = abs(dot(vN, vV));
  vec3 hot = vec3(1.0, 0.92, 0.85);
  if (uMode < 0.5) {
    // shock cap: brightest at the stagnation point
    float k = pow(facing, 0.6) * (0.75 + 0.25 * n(vUv * vec2(40.0, 8.0) + uTime * 6.0));
    vec3 c = mix(uColor, hot, k) * 4.0;
    float a = uHeat * k;
    gl_FragColor = vec4(c * a, a);
  } else {
    // wake: streaks that thin out downstream (vUv.y = 0 at the shield, 1 far behind)
    float along = vUv.y;
    float streak = n(vec2(vUv.x * 48.0, along * 6.0 - uTime * 14.0)) * 0.65 + n(vec2(vUv.x * 13.0, along * 2.0 - uTime * 7.0)) * 0.5;
    float edge = pow(1.0 - facing, 1.2);
    float wisp = streak * streak * 1.6;
    float a = uHeat * pow(1.0 - along, 2.4) * wisp * (0.08 + edge * 1.2) * smoothstep(0.0, 0.06, along);
    vec3 c = mix(hot, uColor, smoothstep(0.0, 0.3, along)) * 2.2;
    gl_FragColor = vec4(c * a, a);
  }
}`,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
    });
  const capMat = mk(0);
  const cap = new THREE.Mesh(new THREE.SphereGeometry(2.75, 48, 16, 0, Math.PI * 2, Math.PI * 0.6, Math.PI * 0.4), capMat);
  cap.scale.set(1, 0.45, 1);
  cap.position.y = -0.2;
  const wakeMat = mk(1);
  const wakeGeo = new THREE.CylinderGeometry(4.2, 2.4, 26, 48, 1, true);
  wakeGeo.translate(0, 13, 0);
  const wake = new THREE.Mesh(wakeGeo, wakeMat);
  g.add(cap, wake);
  const set = (t: number, heat: number) => {
    for (const m of [capMat, wakeMat]) {
      m.uniforms.uTime.value = t;
      m.uniforms.uHeat.value = heat;
    }
    g.visible = heat > 0.01;
  };
  return { g, set };
}

