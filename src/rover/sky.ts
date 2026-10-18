import * as THREE from "three";
import { rng } from "./noise";
import { planetMaterial, ringMaterial } from "./planet";
import { sunAngDeg, type World } from "./worlds";

const R_SKY = 30000;

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
      },
      vertexShader: /* glsl */ `
varying vec3 vDir;
void main() { vDir = position; vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0); gl_Position = vec4(p.xy, p.w * 0.99999, p.w); }`,
      fragmentShader: /* glsl */ `
uniform vec3 uZenith; uniform vec3 uHorizon; uniform vec3 uGround; uniform vec3 uSunCol; uniform vec3 uHalo;
uniform float uHaloK; uniform vec3 uSunDir; uniform float uSunR; uniform float uSunK; uniform float uStars; uniform float uDip; uniform float uExpo; uniform float uHaze;
varying vec3 vDir;
float hh(vec3 p) { return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453); }
void main() {
  vec3 d = normalize(vDir);
  float el = d.y + uDip;
  float t = clamp(el, 0.0, 1.0);
  vec3 sky = mix(uHorizon, uZenith, pow(t, 0.42));
  // the brighter band hugging the horizon in thick air
  sky += uHorizon * uHaze * 0.25 * exp(-max(el, 0.0) * 18.0);
  float cs = dot(d, uSunDir);
  float ang = length(cross(d, uSunDir));
  if (cs < 0.0) ang = 3.0;
  // forward scattering: a tight aureole and a broad glow (blue around the Sun on Mars)
  float halo = uHaloK * (exp(-ang * 9.0) * 0.9 + exp(-ang * 2.2) * 0.35);
  sky += uHalo * halo;
  // ground below the (dipping) horizon
  vec3 below = mix(uHorizon * 0.9, uGround, smoothstep(0.0, -0.12, el));
  below *= 0.85 + 0.15 * hh(floor(d * 220.0));
  vec3 col = mix(sky, below, smoothstep(0.0015, -0.0015, el));
  // the Milky Way, faint, where there is no air to hide it
  if (uStars > 0.0 && el > 0.0) {
    vec3 gal = normalize(vec3(0.3, 0.55, -0.78));
    float band = exp(-pow(dot(d, gal) / 0.16, 2.0));
    float clump = 0.55 + 0.45 * hh(floor(d * 40.0)) * hh(floor(d * 13.0) + 3.0);
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
