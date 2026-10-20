import * as THREE from "three";
import { rng } from "./noise";
import { planetMaterial, ringMaterial } from "./planet";
import { sunAngDeg, type World, type WorldId } from "./worlds";

const R_SKY = 30000;

/** cloud layers: [cover 0..1, scale, contrast, streakiness] */
const CLOUDS: Partial<Record<WorldId, [number, number, number, number]>> = {
  earth: [0.22, 1.1, 0.6, 1.4],
  mars: [0.12, 0.9, 0.4, 1.0],
  venus: [0.95, 0.7, 0.7, 0.6],
  titan: [0.7, 0.5, 0.4, 0.3],
};

/** Sun direction from elevation/azimuth in degrees (azimuth from +z toward +x). */
export function dirFromAzEl(azDeg: number, elDeg: number, out = new THREE.Vector3()) {
  const az = THREE.MathUtils.degToRad(azDeg);
  const el = THREE.MathUtils.degToRad(elDeg);
  return out.set(Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el));
}

/**
 * The sky dome: zenith-to-horizon gradient, a sun disk at its true angular size (with a minimum
 * so a 0.02° Neptune sun still reads as a dazzling point), forward-scattering halo, and the ground
 * colour below a horizon that dips as you climb.
 */
export class Sky {
  readonly root = new THREE.Group();
  readonly dome: THREE.Mesh;
  readonly stars: THREE.Points;
  readonly sunDir = new THREE.Vector3();
  private mat: THREE.ShaderMaterial;
  private starMat: THREE.ShaderMaterial;
  private bodies: { mesh: THREE.Mesh; dir: THREE.Vector3; mat: THREE.ShaderMaterial }[] = [];
  private ring: THREE.Mesh | null = null;
  private disposables: { dispose(): void }[] = [];

  constructor(public world: World) {
    const s = world.sky;
    dirFromAzEl(s.sunAz, s.sunElev, this.sunDir);
    const realR = THREE.MathUtils.degToRad(sunAngDeg(world)) / 2;
    const visR = Math.max(realR, 0.0028);
    this.mat = new THREE.ShaderMaterial({
      uniforms: {
        uZenith: { value: new THREE.Color(s.zenith) },
        uHorizon: { value: new THREE.Color(s.horizon) },
        uGround: { value: new THREE.Color(s.ground) },
        uSunCol: { value: new THREE.Color(s.sun) },
        uHalo: { value: new THREE.Color(s.halo) },
        uHaloK: { value: s.haloK },
        uSunDir: { value: this.sunDir },
        uSunR: { value: visR },
        uSunK: { value: s.sunDisk ? 60 * Math.min(1, Math.pow(realR / visR, 2) * 6 + 0.25) : 0 },
        uStars: { value: s.stars },
        uDip: { value: 0 },
        uExpo: { value: s.exposure },
        uHaze: { value: world.atm.rho > 0.001 ? 1 : 0 },
        uTime: { value: 0 },
        uCloud: { value: new THREE.Vector4(...(CLOUDS[world.id] ?? [0, 1, 0, 0])) },
        uCloudCol: { value: new THREE.Color(s.horizon).lerp(new THREE.Color(s.sun), 0.35) },
      },
      vertexShader: /* glsl */ `
varying vec3 vDir;
void main() { vDir = position; vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0); gl_Position = vec4(p.xy, p.w * 0.99999, p.w); }`,
      fragmentShader: /* glsl */ `
uniform vec3 uZenith; uniform vec3 uHorizon; uniform vec3 uGround; uniform vec3 uSunCol; uniform vec3 uHalo;
uniform float uHaloK; uniform vec3 uSunDir; uniform float uSunR; uniform float uSunK; uniform float uStars; uniform float uDip; uniform float uExpo; uniform float uHaze;
uniform float uTime; uniform vec4 uCloud; uniform vec3 uCloudCol;
varying vec3 vDir;
float hh(vec3 p) { return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453); }
float vn(vec2 p) {
  vec2 i = floor(p); vec2 f = fract(p); f = f * f * (3.0 - 2.0 * f);
  float a = hh(vec3(i, 1.0)); float b = hh(vec3(i + vec2(1.0, 0.0), 1.0));
  float c = hh(vec3(i + vec2(0.0, 1.0), 1.0)); float e = hh(vec3(i + 1.0, 1.0));
  return mix(mix(a, b, f.x), mix(c, e, f.x), f.y);
}
float cfbm(vec2 p) {
  float s = 0.0; float a = 0.5;
  for (int i = 0; i < 5; i++) { s += a * vn(p); p = mat2(1.6, 1.2, -1.2, 1.6) * p + 3.1; a *= 0.5; }
  return s;
}
void main() {
  vec3 d = normalize(vDir);
  float el = d.y + uDip;
  float t = clamp(el, 0.0, 1.0);
  vec3 sky = mix(uHorizon, uZenith, pow(t, 0.42));
  // the brighter band hugging the horizon in thick air (longer path, more single scattering)
  sky += uHorizon * uHaze * 0.22 * exp(-max(el, 0.0) * 14.0);
  float cs = dot(d, uSunDir);
  // true angle from the Sun: asin keeps precision near the disk, acos takes over past 90°, no seam
  float ang = cs > 0.0 ? asin(min(length(cross(d, uSunDir)), 1.0)) : acos(max(cs, -1.0));
  // the sky is brighter on the Sun's side and darker opposite it, most strongly low down
  vec2 hd = normalize(d.xz + 1e-5); vec2 hs = normalize(uSunDir.xz + 1e-5);
  float az = dot(hd, hs);
  sky *= 1.0 + uHaze * (0.22 * max(az, 0.0) * max(az, 0.0) - 0.08 * max(-az, 0.0)) * (1.0 - t * 0.6);
  // forward scattering: a tight aureole and a broad glow (blue around the Sun on Mars)
  float halo = uHaloK * (exp(-ang * 9.0) * 0.9 + exp(-ang * 2.2) * 0.35 + exp(-ang * 0.8) * 0.12 * uHaze);
  sky += uHalo * halo;
  // high cloud: a cirrus veil on Earth, wisps of water ice on Mars, the overcast decks of Venus and Titan
  if (uCloud.x > 0.0 && el > 0.0) {
    vec2 cp = d.xz / (el + 0.08) * uCloud.y + vec2(uTime * 0.004, uTime * 0.0013);
    float n = cfbm(cp * vec2(1.0, 1.0 + uCloud.w * 3.0));
    float cov = smoothstep(0.62 - uCloud.x * 0.5, 0.95 - uCloud.x * 0.25, n);
    float fade = smoothstep(0.0, 0.12, el);
    vec3 cc = uCloudCol * (1.0 + 0.6 * exp(-ang * 3.0)) * (1.0 - uCloud.z * (n - 0.5));
    sky = mix(sky, cc, cov * fade * min(1.0, uCloud.x * 1.6));
  }
  // ground below the (dipping) horizon
  vec3 below = mix(uHorizon * 0.9, uGround, smoothstep(0.0, -0.12, el));
  // beyond the terrain mesh: hazy ground, smoothly mottled (no per-texel speckle)
  vec2 bp = d.xz / max(-el, 0.02);
  below *= 0.88 + 0.12 * vn(bp * 3.0) + 0.06 * vn(bp * 11.0);
  below = mix(below, uHorizon, uHaze * exp(max(-el, 0.0) * -18.0) * 0.6);
  vec3 col = mix(sky, below, smoothstep(0.0015, -0.0015, el));
  // no air: the Sun is a hard white disk with glare in the optics around it
  col += uSunCol * (1.0 - uHaze) * (exp(-ang * 70.0) * 0.5 + exp(-ang * 14.0) * 0.05) * step(0.0, uSunK) * min(uSunK, 1.0);
  // dither against banding in the smooth gradients (relative, so black stays black)
  col *= 1.0 + (hh(vec3(gl_FragCoord.xy, 3.0)) - 0.5) * 0.012;
  // the Milky Way, faint, where there is no air to hide it
  if (uStars > 0.0 && el > 0.0) {
    vec3 gal = normalize(vec3(0.3, 0.55, -0.78));
    // (x * x, not pow: pow of a negative base is NaN on D3D, and Bloom smears NaN across the sky)
    float gq = dot(d, gal) / 0.16;
    float band = exp(-gq * gq);
    vec2 gp = d.xz / (d.y + 0.6);
    float clump = 0.35 + 0.65 * smoothstep(0.3, 0.8, vn(gp * 9.0) * 0.6 + vn(gp * 31.0) * 0.4);
    col += vec3(0.62, 0.66, 0.8) * band * clump * 0.035 * uStars;
  }
  // the disk itself, limb-darkened
  float disk = 1.0 - smoothstep(uSunR * 0.85, uSunR * 1.15, ang);
  float limb = 1.0 - 0.45 * pow(clamp(ang / uSunR, 0.0, 1.0), 2.0);
  col += uSunCol * disk * limb * uSunK * step(-0.002, el);
  gl_FragColor = vec4(col * uExpo, 1.0);
  #include <colorspace_fragment>
}`,
      side: THREE.BackSide,
      depthWrite: false,
      depthTest: false,
      fog: false,
    });
    this.dome = new THREE.Mesh(new THREE.SphereGeometry(R_SKY, 64, 32), this.mat);
    this.dome.renderOrder = -10;
    this.dome.frustumCulled = false;
    this.root.add(this.dome);
    this.disposables.push(this.dome.geometry, this.mat);

    // stars: only where there's no air to scatter the daylight
    const r = rng(42);
    const N = 5000;
    const pos = new Float32Array(N * 3);
    const mag = new Float32Array(N);
    const tint = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      const u = r() * 2 - 1;
      const a = r() * Math.PI * 2;
      const q = Math.sqrt(1 - u * u);
      pos.set([Math.cos(a) * q * R_SKY * 0.95, u * R_SKY * 0.95, Math.sin(a) * q * R_SKY * 0.95], i * 3);
      mag[i] = Math.pow(r(), 6);
      tint[i] = r();
    }
    const sg = new THREE.BufferGeometry();
    sg.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    sg.setAttribute("aMag", new THREE.BufferAttribute(mag, 1));
    sg.setAttribute("aTint", new THREE.BufferAttribute(tint, 1));
    this.starMat = new THREE.ShaderMaterial({
      uniforms: { uK: { value: s.stars }, uDip: { value: 0 } },
      vertexShader: /* glsl */ `
attribute float aMag; attribute float aTint; uniform float uDip;
varying float vA; varying vec3 vC;
void main() {
  vec3 d = normalize(position);
  vA = (d.y + uDip > 0.004 ? 1.0 : 0.0) * (0.25 + aMag * 1.6);
  vC = mix(vec3(0.75, 0.82, 1.0), vec3(1.0, 0.85, 0.7), aTint);
  vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  gl_Position = vec4(p.xy, p.w * 0.99999, p.w);
  gl_PointSize = 1.0 + aMag * 2.2;
}`,
      fragmentShader: /* glsl */ `
uniform float uK; varying float vA; varying vec3 vC;
void main() { vec2 c = gl_PointCoord - 0.5; float a = smoothstep(0.5, 0.1, length(c)) * vA * uK; if (a < 0.01) discard; gl_FragColor = vec4(vC * a, 1.0); }`,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      depthTest: false,
    });
    this.stars = new THREE.Points(sg, this.starMat);
    this.stars.renderOrder = -9;
    this.stars.frustumCulled = false;
    this.stars.visible = s.stars > 0;
    this.root.add(this.stars);
    this.disposables.push(sg, this.starMat);

    // moons and planets hanging in this sky, lit by the same Sun (so they show their real phase)
    for (const b of world.bodies) {
      const dir = dirFromAzEl(b.az, b.el);
      const dist = R_SKY * 0.7;
      const rad = Math.tan(THREE.MathUtils.degToRad(b.angDeg) / 2) * dist;
      const mat = planetMaterial(b.look, b.seed);
      mat.uniforms.uSun.value = this.sunDir;
      mat.uniforms.uAmb.value = b.name === "Earth" ? 0.0 : 0.01;
      mat.depthWrite = false;
      mat.depthTest = false;
      const mesh = new THREE.Mesh(new THREE.SphereGeometry(rad, 48, 24), mat);
      mesh.renderOrder = -8;
      mesh.frustumCulled = false;
      mesh.rotation.set(0.3, b.seed, 0.1);
      this.root.add(mesh);
      this.bodies.push({ mesh, dir, mat });
      this.disposables.push(mesh.geometry, mat);
    }

    // Saturn's rings, seen from 1 bar at 32° N: an arch across the sky from horizon to horizon
    if (world.id === "saturn") {
      const lat = THREE.MathUtils.degToRad(32);
      const R = 1;
      const geo = new THREE.RingGeometry(1.24 * R, 2.27 * R, 256, 1);
      const mat = ringMaterial();
      (mat.uniforms.uSun.value as THREE.Vector3).copy(this.sunDir);
      mat.uniforms.uBright.value = 1.6;
      mat.depthTest = false;
      mat.fragmentShader = mat.fragmentShader.replace("void main() {", "varying float vUp;\nvoid main() {\n  if (vUp < 0.0) discard;");
      mat.vertexShader = mat.vertexShader.replace("void main() {", "varying float vUp;\nvoid main() {\n  vUp = (modelMatrix * vec4(position, 1.0)).y - cameraPosition.y;");
      const ring = new THREE.Mesh(geo, mat);
      // ring plane normal is the spin axis; the planet centre is straight down
      const scale = R_SKY * 0.42;
      const axis = new THREE.Vector3(0, Math.sin(lat), -Math.cos(lat));
      ring.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), axis);
      ring.scale.setScalar(scale);
      ring.userData.offset = new THREE.Vector3(0, -scale, 0);
      ring.renderOrder = -8;
      ring.frustumCulled = false;
      this.ring = ring;
      this.root.add(ring);
      this.disposables.push(geo, mat);
    }
  }

  /** follow the camera; `altitude` (m) dips the horizon as you would see it from a descending lander */
  update(cam: THREE.Vector3, altitude: number) {
    this.root.position.copy(cam);
    const R = this.world.radiusKm * 1000;
    const dip = Math.sqrt(Math.max(0, (2 * Math.max(altitude, 0)) / R));
    this.mat.uniforms.uDip.value = dip;
    this.mat.uniforms.uTime.value = performance.now() / 1000;
    this.starMat.uniforms.uDip.value = dip;
    for (const b of this.bodies) b.mesh.position.copy(b.dir).multiplyScalar(R_SKY * 0.7);
    if (this.ring) this.ring.position.copy(this.ring.userData.offset as THREE.Vector3);
  }

  setStarK(k: number) {
    this.starMat.uniforms.uK.value = k;
  }

  /** direction to Earth in this sky (for the high-gain antenna): straight at it from the Moon, near the Sun from far out */
  earthDir(out = new THREE.Vector3()) {
    const e = this.world.bodies.find((b) => b.name === "Earth");
    if (e) return dirFromAzEl(e.az, e.el, out);
    if (this.world.id === "earth") return out.set(0, 1, 0);
    // from beyond Earth's orbit, Earth is never far from the Sun; from Venus/Mercury it's on the night side at opposition
    const off = this.world.au > 1 ? THREE.MathUtils.radToDeg(Math.asin(Math.min(1, 1 / this.world.au))) * 0.6 : 140;
    return dirFromAzEl(this.world.sky.sunAz + off, Math.max(18, this.world.sky.sunElev + 10), out);
  }

  dispose() {
    this.disposables.forEach((d) => d.dispose());
  }
}
