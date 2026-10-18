import * as THREE from "three";

type Kind = "spark" | "flame" | "dust" | "confetti";

/**
 * A pool of point sprites, one draw call: sparks (hot streaks that fall and cool), flames
 * (rising, swelling, yellow → red → smoke), dust (soft grey puffs) and confetti (spinning
 * paper squares that flutter down).
 */
class Particles {
  readonly points: THREE.Points;
  private n: number;
  private pos: Float32Array;
  private vel: Float32Array;
  private col: Float32Array;
  private size: Float32Array;
  private alpha: Float32Array;
  private spin: Float32Array;
  private life: Float32Array;
  private span: Float32Array;
  private base: Float32Array;
  private tint: Float32Array;
  private next = 0;
  private mat: THREE.ShaderMaterial;
  live = 0;

  constructor(
    private kind: Kind,
    max: number,
  ) {
    this.n = max;
    this.pos = new Float32Array(max * 3);
    this.vel = new Float32Array(max * 3);
    this.col = new Float32Array(max * 3);
    this.tint = new Float32Array(max * 3);
    this.size = new Float32Array(max);
    this.alpha = new Float32Array(max);
    this.spin = new Float32Array(max);
    this.life = new Float32Array(max);
    this.span = new Float32Array(max).fill(1);
    this.base = new Float32Array(max);
    const g = new THREE.BufferGeometry();
    const dyn = (a: Float32Array, k: number) => new THREE.BufferAttribute(a, k).setUsage(THREE.DynamicDrawUsage);
    g.setAttribute("position", dyn(this.pos, 3));
    g.setAttribute("aColor", dyn(this.col, 3));
    g.setAttribute("aSize", dyn(this.size, 1));
    g.setAttribute("aAlpha", dyn(this.alpha, 1));
    g.setAttribute("aSpin", dyn(this.spin, 1));
    const additive = kind === "spark" || kind === "flame";
    this.mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
      uniforms: { uScale: { value: 500 }, uLight: { value: 1 } },
      vertexShader: /* glsl */ `
        attribute vec3 aColor;
        attribute float aSize;
        attribute float aAlpha;
        attribute float aSpin;
        uniform float uScale;
        varying vec3 vColor;
        varying float vAlpha;
        varying float vSpin;
        void main() {
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_Position = projectionMatrix * mv;
          gl_PointSize = max(1.0, aSize * uScale / -mv.z);
          vColor = aColor;
          vAlpha = aAlpha;
          vSpin = aSpin;
        }`,
      fragmentShader: /* glsl */ `
        uniform float uLight;
        varying vec3 vColor;
        varying float vAlpha;
        varying float vSpin;
        void main() {
          vec2 p = gl_PointCoord - 0.5;
          ${
            kind === "confetti"
              ? `float c = cos(vSpin), s = sin(vSpin);
                 vec2 r = vec2(c * p.x - s * p.y, s * p.x + c * p.y);
                 // a paper square seen edge-on as it tumbles
                 r.y /= max(0.15, abs(cos(vSpin * 1.7)));
                 if (abs(r.x) > 0.32 || abs(r.y) > 0.32) discard;
                 gl_FragColor = vec4(vColor * uLight * (0.75 + 0.25 * abs(cos(vSpin * 1.7))), vAlpha);`
              : kind === "dust"
                ? `float d = length(p); if (d > 0.5) discard;
                   float a = smoothstep(0.5, 0.0, d);
                   gl_FragColor = vec4(vColor * uLight, vAlpha * a * a);`
                : `float d = length(p); if (d > 0.5) discard;
                   float core = smoothstep(0.5, 0.0, d);
                   gl_FragColor = vec4(vColor * (core * core * 1.6 + core * 0.4), vAlpha * core);`
          }
          #include <colorspace_fragment>
        }`,
    });
    this.points = new THREE.Points(g, this.mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 3;
  }

  emit(p: THREE.Vector3, vel: THREE.Vector3, color: THREE.Color, size: number, life: number) {
    const i = this.next;
    this.next = (this.next + 1) % this.n;
    this.pos.set([p.x, p.y, p.z], i * 3);
    this.vel.set([vel.x, vel.y, vel.z], i * 3);
    this.tint.set([color.r, color.g, color.b], i * 3);
    this.col.set([color.r, color.g, color.b], i * 3);
    this.base[i] = size;
    this.size[i] = size;
    this.life[i] = life;
    this.span[i] = life;
    this.spin[i] = Math.random() * 6.28;
    this.alpha[i] = 1;
  }

  resize(heightPx: number, fov: number) {
    this.mat.uniforms.uScale.value = heightPx / (2 * Math.tan(THREE.MathUtils.degToRad(fov / 2)));
  }
  setLight(k: number) {
    this.mat.uniforms.uLight.value = k;
  }

  update(dt: number) {
    let live = 0;
    const flame = this.kind === "flame";
    for (let i = 0; i < this.n; i++) {
      if (this.life[i] <= 0) {
        if (this.alpha[i] !== 0) {
          this.alpha[i] = 0;
          this.size[i] = 0;
        }
        continue;
      }
      live++;
      this.life[i] -= dt;
      const k = Math.max(0, this.life[i] / this.span[i]);
      const o = i * 3;
      if (this.kind === "spark") {
        this.vel[o + 1] -= 900 * dt;
        this.vel[o] *= 1 - dt * 1.5;
        this.vel[o + 2] *= 1 - dt * 1.5;
        // white-hot to orange to dark red as it cools
        this.col[o] = this.tint[o] * (0.6 + 0.6 * k);
        this.col[o + 1] = this.tint[o + 1] * k * k;
        this.col[o + 2] = this.tint[o + 2] * k * k * k;
        this.alpha[i] = k;
        this.size[i] = this.base[i] * (0.4 + 0.6 * k);
        // a spark that hits the floor bounces
        if (this.pos[o + 1] < 0.05 && this.vel[o + 1] < 0) this.vel[o + 1] *= -0.35;
      } else if (flame) {
        this.vel[o + 1] += 60 * dt;
        this.vel[o] *= 1 - dt * 2;
        this.vel[o + 2] *= 1 - dt * 2;
        const age = 1 - k;
        // yellow core → orange → red → thin smoke
        const smoke = Math.max(0, (age - 0.7) / 0.3);
        this.col[o] = (1.0 - smoke * 0.8) * (1.4 - age * 0.3);
        this.col[o + 1] = Math.max(0, 0.75 - age * 0.9) * (1 - smoke);
        this.col[o + 2] = Math.max(0, 0.25 - age) * (1 - smoke);
        this.alpha[i] = Math.min(1, age * 6) * (1 - age * 0.85);
        this.size[i] = this.base[i] * (0.6 + age * 1.3);
      } else if (this.kind === "dust") {
        this.vel[o] *= 1 - dt * 3;
        this.vel[o + 2] *= 1 - dt * 3;
        this.vel[o + 1] = this.vel[o + 1] * (1 - dt * 3) + 6 * dt;
        this.alpha[i] = k * 0.5;
        this.size[i] = this.base[i] * (1 + (1 - k) * 2.2);
      } else {
        // confetti: drag-limited fall with a flutter
        this.vel[o + 1] = Math.max(-38, this.vel[o + 1] - 300 * dt);
        this.vel[o] = this.vel[o] * (1 - dt * 2) + Math.sin(this.life[i] * 7 + i) * 30 * dt;
        this.vel[o + 2] *= 1 - dt * 2;
        this.spin[i] += dt * (4 + (i % 5));
        this.alpha[i] = Math.min(1, k * 4);
        if (this.pos[o + 1] < 0.1) {
          this.pos[o + 1] = 0.1;
          this.vel[o] = this.vel[o + 1] = this.vel[o + 2] = 0;
        }
      }
      this.pos[o] += this.vel[o] * dt;
      this.pos[o + 1] += this.vel[o + 1] * dt;
      this.pos[o + 2] += this.vel[o + 2] * dt;
    }
    this.live = live;
    const g = this.points.geometry;
    for (const name of ["position", "aColor", "aSize", "aAlpha", "aSpin"]) g.attributes[name].needsUpdate = true;
  }

  dispose() {
    this.points.geometry.dispose();
    this.mat.dispose();
  }
}

/**
 * A fading ribbon behind a fast car, drawn camera-facing: last few dozen positions, thin and
 * faint, gone when the car slows.
 */
class Trail {
  readonly mesh: THREE.Mesh;
  private pts: THREE.Vector3[] = [];
  private geo: THREE.BufferGeometry;
  private posArr: Float32Array;
  private aArr: Float32Array;
  private static N = 26;
  seen = 0;
  constructor(mat: THREE.ShaderMaterial) {
    const n = Trail.N;
    this.geo = new THREE.BufferGeometry();
    this.posArr = new Float32Array(n * 2 * 3);
    this.aArr = new Float32Array(n * 2);
    this.geo.setAttribute("position", new THREE.BufferAttribute(this.posArr, 3).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute("aA", new THREE.BufferAttribute(this.aArr, 1).setUsage(THREE.DynamicDrawUsage));
    const idx: number[] = [];
    for (let i = 0; i < n - 1; i++) idx.push(i * 2, i * 2 + 1, i * 2 + 2, i * 2 + 1, i * 2 + 3, i * 2 + 2);
    this.geo.setIndex(idx);
    this.mesh = new THREE.Mesh(this.geo, mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 2;
  }
  push(p: THREE.Vector3, speed: number, cam: THREE.Vector3) {
    this.pts.unshift(p.clone());
    if (this.pts.length > Trail.N) this.pts.pop();
    const k = THREE.MathUtils.clamp((speed - 220) / 300, 0, 1);
    const side = new THREE.Vector3();
    const dir = new THREE.Vector3();
    const view = new THREE.Vector3();
    for (let i = 0; i < Trail.N; i++) {
      const a = this.pts[Math.min(i, this.pts.length - 1)];
      const b = this.pts[Math.min(i + 1, this.pts.length - 1)];
      dir.subVectors(a, b);
      if (dir.lengthSq() < 1e-6) dir.set(0, 0, 1);
      view.subVectors(cam, a);
      side.crossVectors(dir, view).normalize().multiplyScalar(0.55 * (1 - i / Trail.N));
      this.posArr.set([a.x + side.x, a.y + side.y, a.z + side.z, a.x - side.x, a.y - side.y, a.z - side.z], i * 6);
      const al = k * (1 - i / Trail.N) * (i < this.pts.length - 1 ? 1 : 0);
      this.aArr[i * 2] = this.aArr[i * 2 + 1] = al;
    }
    this.geo.attributes.position.needsUpdate = true;
    this.geo.attributes.aA.needsUpdate = true;
  }
  dispose() {
    this.geo.dispose();
  }
}

/**
 * Tyre marks on the floor: a ring buffer of thin dark quads laid strip by strip behind a sliding
 * wheel, fading out over a dozen seconds.
 */
class Skids {
  readonly mesh: THREE.Mesh;
  private static N = 900;
  private pos: Float32Array;
  private alpha: Float32Array;
  private born: Float32Array;
  private base: Float32Array;
  private next = 0;
  private last = new Map<string, { p: THREE.Vector3; t: number }>();
  private geo: THREE.BufferGeometry;
  private time = 0;
  constructor() {
    const n = Skids.N;
    this.pos = new Float32Array(n * 4 * 3);
    this.alpha = new Float32Array(n * 4);
    this.born = new Float32Array(n).fill(-1e9);
    this.base = new Float32Array(n);
    const idx: number[] = [];
    for (let i = 0; i < n; i++) idx.push(i * 4, i * 4 + 1, i * 4 + 2, i * 4, i * 4 + 2, i * 4 + 3);
    this.geo = new THREE.BufferGeometry();
    this.geo.setAttribute("position", new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute("aA", new THREE.BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage));
    this.geo.setIndex(idx);
    const mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
      vertexShader: /* glsl */ `
        attribute float aA;
        varying float vA;
        void main() { vA = aA; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: /* glsl */ `
        varying float vA;
        void main() { gl_FragColor = vec4(0.07, 0.065, 0.06, vA); }`,
    });
    this.mesh = new THREE.Mesh(this.geo, mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 1;
  }
  /** Lay mark under wheel `key` at `p` (on the ground), `k` how dark (0..1). */
  add(key: string, p: THREE.Vector3, k: number) {
    const prev = this.last.get(key);
    this.last.set(key, { p: p.clone(), t: this.time });
    if (!prev || this.time - prev.t > 0.08) return;
    const d = new THREE.Vector3().subVectors(p, prev.p);
    if (d.lengthSq() < 0.09) {
      this.last.set(key, prev);
      return;
    }
    const side = new THREE.Vector3(-d.z, 0, d.x).normalize().multiplyScalar(0.36);
    const i = this.next;
    this.next = (this.next + 1) % Skids.N;
    const y = 0.02;
    const pts = [prev.p.clone().add(side), prev.p.clone().sub(side), p.clone().sub(side), p.clone().add(side)];
    pts.forEach((q, j) => this.pos.set([q.x, q.y + y, q.z], (i * 4 + j) * 3));
    this.born[i] = this.time;
    this.base[i] = Math.min(1, k) * 0.55;
  }
  update(dt: number) {
    this.time += dt;
    for (let i = 0; i < Skids.N; i++) {
      const age = this.time - this.born[i];
      const a = age > 14 ? 0 : this.base[i] * (1 - age / 14);
      for (let j = 0; j < 4; j++) this.alpha[i * 4 + j] = a;
    }
    this.geo.attributes.position.needsUpdate = true;
    this.geo.attributes.aA.needsUpdate = true;
  }
  dispose() {
    this.geo.dispose();
    (this.mesh.material as THREE.Material).dispose();
  }
}

export class Fx {
  readonly root = new THREE.Group();
  private sparks = new Particles("spark", 900);
  private flames = new Particles("flame", 700);
  private dust = new Particles("dust", 300);
  private confetti = new Particles("confetti", 900);
  private trails = new Map<number, Trail>();
  private skids = new Skids();
  private trailMat: THREE.ShaderMaterial;
  private ring: { c: THREE.Vector3; r: number; yaw: number } | null = null;
  private flameAcc = 0;
  private tmp = new THREE.Vector3();
  private tv = new THREE.Vector3();
  private col = new THREE.Color();
  fire = 1;

  constructor() {
    this.root.add(this.sparks.points, this.flames.points, this.dust.points, this.confetti.points, this.skids.mesh);
    this.trailMat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      uniforms: { uColor: { value: new THREE.Color("#bfe3ff") } },
      vertexShader: /* glsl */ `
        attribute float aA;
        varying float vA;
        void main() { vA = aA; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: /* glsl */ `
        uniform vec3 uColor;
        varying float vA;
        void main() { gl_FragColor = vec4(uColor * vA * 0.5, vA * 0.5); }`,
    });
  }

  setRing(c: THREE.Vector3, r: number, yaw: number) {
    this.ring = { c, r, yaw };
  }

  /** A shower of sparks: metal base on plastic, or a hard landing. */
  sparkBurst(at: THREE.Vector3, dir: THREE.Vector3, strength: number) {
    const n = Math.min(60, Math.floor(8 + strength * 40));
    for (let i = 0; i < n; i++) {
      this.tv.set(Math.random() - 0.5, Math.random() * 0.9, Math.random() - 0.5).normalize().multiplyScalar(60 + Math.random() * 180 * (0.4 + strength));
      this.tv.addScaledVector(dir, 0.35);
      this.sparks.emit(at, this.tv, this.col.setRGB(1.0, 0.82, 0.45), 0.22 + Math.random() * 0.25, 0.25 + Math.random() * 0.45);
    }
  }
  /** A few sparks a frame off a car grinding the outside wall: thrown back and out along its path. */
  scrape(at: THREE.Vector3, vel: THREE.Vector3, k: number) {
    const n = Math.random() < k ? 1 + Math.floor(k * 2.5) : 0;
    for (let i = 0; i < n; i++) {
      this.tv.copy(vel).multiplyScalar(0.35 + Math.random() * 0.3);
      this.tv.x += (Math.random() - 0.5) * 70;
      this.tv.y += 20 + Math.random() * 60;
      this.tv.z += (Math.random() - 0.5) * 70;
      this.sparks.emit(at, this.tv, this.col.setRGB(1.0, 0.86, 0.55), 0.14 + Math.random() * 0.14, 0.12 + Math.random() * 0.22);
    }
  }
  puff(at: THREE.Vector3, strength: number) {
    const n = Math.floor(4 + strength * 10);
    for (let i = 0; i < n; i++) {
      this.tv.set(Math.random() - 0.5, Math.random() * 0.4, Math.random() - 0.5).multiplyScalar(40 * (0.4 + strength));
      this.dust.emit(this.tmp.copy(at).setY(Math.max(0.5, at.y - 0.8)), this.tv, this.col.set("#d8cdbb"), 1.4 + Math.random() * 1.6, 0.6 + Math.random() * 0.6);
    }
  }
  /** A tyre mark under a sliding wheel (key: which wheel of which car). */
  skid(key: string, at: THREE.Vector3, k: number) {
    this.skids.add(key, at, k);
  }

  /** A burst of confetti over a point (finishes, records). */
  party(at: THREE.Vector3, n = 220) {
    const colors = ["#ff3b30", "#ffcc00", "#0a84ff", "#34c759", "#ff2d55", "#ffffff", "#bf5af2"];
    for (let i = 0; i < n; i++) {
      this.tv.set((Math.random() - 0.5) * 140, 120 + Math.random() * 160, (Math.random() - 0.5) * 140);
      this.confetti.emit(this.tmp.copy(at).add(new THREE.Vector3((Math.random() - 0.5) * 6, 4, (Math.random() - 0.5) * 6)), this.tv, this.col.set(colors[i % colors.length]), 0.9 + Math.random() * 0.5, 3 + Math.random() * 2);
    }
  }

  /** One car's trail this frame (call for every car; cars that stop being seen lose theirs). */
  trail(id: number, p: THREE.Vector3, speed: number, cam: THREE.Vector3, frame: number) {
    let t = this.trails.get(id);
    if (!t) {
      if (speed < 200) return;
      t = new Trail(this.trailMat);
      this.trails.set(id, t);
      this.root.add(t.mesh);
    }
    t.seen = frame;
    t.push(p, speed, cam);
  }

  resize(heightPx: number, fov: number) {
    for (const p of [this.sparks, this.flames, this.dust, this.confetti]) p.resize(heightPx, fov);
  }
  setLight(k: number) {
    this.dust.setLight(k);
    this.confetti.setLight(k);
  }

  update(dt: number, frame: number) {
    // the ring keeps burning
    if (this.ring && this.fire > 0) {
      this.flameAcc += dt * 260 * this.fire;
      const { c, r, yaw } = this.ring;
      const ax = new THREE.Vector3(Math.cos(yaw), 0, -Math.sin(yaw));
      while (this.flameAcc > 1) {
        this.flameAcc -= 1;
        const a = Math.random() * Math.PI * 2;
        // around the hoop, a touch outside the wick
        const rr = r + (Math.random() - 0.3) * 0.8;
        this.tmp.copy(c).addScaledVector(ax, Math.cos(a) * rr).add(new THREE.Vector3(0, Math.sin(a) * rr, 0));
        this.tmp.x += (Math.random() - 0.5) * 0.6;
        this.tmp.z += (Math.random() - 0.5) * 0.6;
        this.tv.set((Math.random() - 0.5) * 6, 8 + Math.random() * 14, (Math.random() - 0.5) * 6);
        this.flames.emit(this.tmp, this.tv, this.col.set("#ffffff"), 1.6 + Math.random() * 1.6, 0.35 + Math.random() * 0.35);
      }
    }
    for (const p of [this.sparks, this.flames, this.dust, this.confetti]) p.update(dt);
    this.skids.update(dt);
    for (const [id, t] of this.trails)
      if (frame - t.seen > 2) {
        this.root.remove(t.mesh);
        t.dispose();
        this.trails.delete(id);
      }
  }

  dispose() {
    for (const p of [this.sparks, this.flames, this.dust, this.confetti]) p.dispose();
    for (const t of this.trails.values()) t.dispose();
    this.skids.dispose();
    this.trailMat.dispose();
  }
}
