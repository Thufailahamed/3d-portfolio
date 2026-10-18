import * as THREE from "three";

const MAX = 900;

/**
 * Puffs of dust kicked up where bricks hit: soft round sprites that burst outwards, drift up,
 * swell and fade. One draw call for all of them.
 */
export class Dust {
  readonly points: THREE.Points;
  private pos = new Float32Array(MAX * 3);
  private vel = new Float32Array(MAX * 3);
  private size = new Float32Array(MAX);
  private alpha = new Float32Array(MAX);
  private life = new Float32Array(MAX);
  private span = new Float32Array(MAX);
  private base = new Float32Array(MAX);
  /** 1 for a mote: a speck that hangs in the air for seconds rather than a puff */
  private mote = new Uint8Array(MAX);
  private next = 0;
  /** how much warm air still rises (1 with gravity on, 0 weightless: no up, no convection) */
  private weight = 1;
  private material: THREE.ShaderMaterial;

  constructor() {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute("aSize", new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute("aAlpha", new THREE.BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage));
    this.material = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      uniforms: { uScale: { value: 400 }, uColor: { value: new THREE.Color("#d9d2c4") }, uLight: { value: 1 } },
      vertexShader: /* glsl */ `
        attribute float aSize;
        attribute float aAlpha;
        uniform float uScale;
        varying float vAlpha;
        void main() {
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_Position = projectionMatrix * mv;
          gl_PointSize = aSize * uScale / -mv.z;
          vAlpha = aAlpha;
        }`,
      fragmentShader: /* glsl */ `
        uniform vec3 uColor;
        uniform float uLight;
        varying float vAlpha;
        void main() {
          vec2 c = gl_PointCoord - 0.5;
          float d = length(c);
          if (d > 0.5) discard;
          float soft = smoothstep(0.5, 0.0, d);
          gl_FragColor = vec4(uColor * uLight, vAlpha * soft * soft);
          #include <colorspace_fragment>
        }`,
    });
    this.points = new THREE.Points(g, this.material);
    this.points.frustumCulled = false;
    this.points.renderOrder = 2;
  }

  /** Scale sprites to the viewport (pixels per world unit at distance 1). */
  resize(heightPx: number, fovDeg: number) {
    this.material.uniforms.uScale.value = heightPx / (2 * Math.tan(THREE.MathUtils.degToRad(fovDeg / 2)));
  }

  /** Dust is lit like everything else: dimmer at night. */
  setLight(k: number) {
    this.material.uniforms.uLight.value = k;
  }

  /** Gravity's strength (1 … 0): weightless, a puff spreads evenly instead of rising. */
  setWeight(k: number) {
    this.weight = k;
  }

  /**
   * Weightless: the fine dust that always lies on a baseplate lifts off and hangs in the light —
   * `n` motes over a stretch `spread` wide around `at`, drifting, turning slowly, for seconds.
   */
  motes(at: { x: number; z: number }, spread: number, n: number) {
    for (let k = 0; k < n; k++) {
      const i = this.next;
      this.next = (this.next + 1) % MAX;
      this.mote[i] = 1;
      this.pos[i * 3] = at.x + (Math.random() - 0.5) * spread;
      this.pos[i * 3 + 1] = 0.15 + Math.random() * Math.random() * 9;
      this.pos[i * 3 + 2] = at.z + (Math.random() - 0.5) * 44;
      this.vel[i * 3] = (Math.random() - 0.5) * 0.5;
      this.vel[i * 3 + 1] = 0.1 + Math.random() * 0.45;
      this.vel[i * 3 + 2] = (Math.random() - 0.5) * 0.5;
      this.life[i] = 0;
      this.span[i] = 6 + Math.random() * 7;
      this.base[i] = 0.07 + Math.random() * Math.random() * 0.28;
    }
  }

  /** A puff at `at`, bigger for a harder hit (0..1). */
  burst(at: { x: number; y: number; z: number }, strength: number) {
    const n = Math.round(5 + strength * 22);
    for (let k = 0; k < n; k++) {
      const i = this.next;
      this.next = (this.next + 1) % MAX;
      const a = Math.random() * Math.PI * 2;
      const sp = (1.5 + Math.random() * 5) * (0.5 + strength);
      this.pos[i * 3] = at.x + (Math.random() - 0.5) * 0.8;
      this.pos[i * 3 + 1] = Math.max(0.2, at.y + (Math.random() - 0.5) * 0.6);
      this.pos[i * 3 + 2] = at.z + (Math.random() - 0.5) * 0.8;
      this.vel[i * 3] = Math.cos(a) * sp;
      this.vel[i * 3 + 1] = 0.8 + Math.random() * 2.5 * (0.4 + strength);
      this.vel[i * 3 + 2] = Math.sin(a) * sp;
      this.mote[i] = 0;
      this.life[i] = 0;
      this.span[i] = (0.7 + Math.random() * 0.9 + strength * 0.6) * (2 - this.weight);
      this.base[i] = 0.6 + Math.random() * 1.1 + strength * 0.9;
    }
  }

  /**
   * Fine dust drawn in by a vacuum: specks lifted off the floor ahead of the intake (`at`, facing
   * `yaw`) that stream into it, arriving just as they fade.
   */
  inflow(at: { x: number; y: number; z: number }, yaw: number, n: number) {
    const fx = Math.sin(yaw);
    const fz = Math.cos(yaw);
    for (let k = 0; k < n; k++) {
      const i = this.next;
      this.next = (this.next + 1) % MAX;
      // somewhere in front of the head, or off to its sides
      const ang = (Math.random() - 0.5) * Math.PI * 1.3;
      const r = 2.5 + Math.random() * 7;
      const ox = Math.sin(ang) * r;
      const oz = Math.cos(ang) * r;
      const x = at.x + fx * oz + fz * ox;
      const z = at.z + fz * oz - fx * ox;
      const y = 0.15 + Math.random() * 0.9;
      const span = 0.35 + Math.random() * 0.35;
      // with this drag, this start speed covers the distance in `span`
      const v = 3.2 / (1 - Math.exp(-3.2 * span));
      this.pos[i * 3] = x;
      this.pos[i * 3 + 1] = y;
      this.pos[i * 3 + 2] = z;
      this.vel[i * 3] = (at.x - x) * v;
      this.vel[i * 3 + 1] = (at.y - y) * v;
      this.vel[i * 3 + 2] = (at.z - z) * v;
      this.mote[i] = 0;
      this.life[i] = 0;
      this.span[i] = span;
      this.base[i] = 0.18 + Math.random() * 0.3;
    }
  }

  update(dt: number) {
    for (let i = 0; i < MAX; i++) {
      if (this.life[i] >= this.span[i]) {
        this.alpha[i] = 0;
        continue;
      }
      this.life[i] += dt;
      const t = this.life[i] / this.span[i];
      if (this.mote[i]) {
        // barely any drag on something so small and slow, and a faint Brownian wander
        const o = i * 3;
        const drag = Math.exp(-0.15 * dt);
        for (let a = 0; a < 3; a++) {
          // and once gravity's back, it settles
          this.vel[o + a] = this.vel[o + a] * drag + (Math.random() - 0.5) * 0.5 * dt - (a === 1 ? this.weight * 3 * dt : 0);
          this.pos[o + a] += this.vel[o + a] * dt;
        }
        if (this.pos[o + 1] < 0.05) this.life[i] = this.span[i];
        this.size[i] = this.base[i];
        this.alpha[i] = 0.5 * Math.min(1, t * 6) * Math.min(1, (1 - t) * 3);
        continue;
      }
      const drag = Math.exp(-3.2 * dt);
      this.vel[i * 3] *= drag;
      this.vel[i * 3 + 1] = this.vel[i * 3 + 1] * drag + 0.4 * this.weight * dt;
      this.vel[i * 3 + 2] *= drag;
      this.pos[i * 3] += this.vel[i * 3] * dt;
      this.pos[i * 3 + 1] += this.vel[i * 3 + 1] * dt;
      this.pos[i * 3 + 2] += this.vel[i * 3 + 2] * dt;
      this.size[i] = this.base[i] * (1 + t * 2.2);
      this.alpha[i] = 0.42 * (1 - t) * (1 - t) * Math.min(1, t * 12);
    }
    const g = this.points.geometry;
    g.attributes.position.needsUpdate = true;
    g.attributes.aSize.needsUpdate = true;
    g.attributes.aAlpha.needsUpdate = true;
  }

  dispose() {
    this.points.geometry.dispose();
    this.material.dispose();
  }
}
