/**
 * The orbit display: the Earth turning at sidereal rate in the inertial J2000 frame, every tracked
 * orbit traced from its elements, the ascent in progress, the geostationary belt and the Moon.
 * One Earth radius = one unit. ECI (x, y, z) → three.js (x, z, −y).
 */

import * as THREE from "three";
import { atmosphereMaterial, earthMaterial } from "./earth";
import { mc, satNow } from "./engine";
import * as O from "./orbit";
import { useMC } from "./store";

const toThree = (r: O.V3, out = new THREE.Vector3()) => out.set(r.x / O.RE, r.z / O.RE, -r.y / O.RE);

export class OrbitView {
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(32, 1024 / 466, 0.01, 2000);
  rt: THREE.WebGLRenderTarget;
  private earth: THREE.Mesh;
  private atmo: THREE.Mesh;
  private lines = new THREE.Group();
  private dots: THREE.Points;
  private sel: THREE.Mesh;
  private ascent: THREE.Line;
  private moon: THREE.Mesh;
  private sunLine: THREE.Line;
  private lastLines = -1;
  private az = 0.6;
  private dist = 4;
  private target = new THREE.Vector3();
  private t = 0;

  constructor(private renderer: THREE.WebGLRenderer, night: THREE.Texture | null, land: THREE.Texture | null) {
    this.rt = new THREE.WebGLRenderTarget(1024, 466, { type: THREE.HalfFloatType, samples: 4 });
    this.earth = new THREE.Mesh(new THREE.SphereGeometry(1, 96, 48), earthMaterial(night, land));
    this.atmo = new THREE.Mesh(new THREE.SphereGeometry(1.035, 64, 32), atmosphereMaterial());
    this.scene.add(this.earth, this.atmo, this.lines);
    // GEO belt and equator
    const ring = (r: number, color: string, opacity: number) => {
      const pts = Array.from({ length: 257 }, (_, i) => new THREE.Vector3(Math.cos((i / 256) * Math.PI * 2) * r, 0, Math.sin((i / 256) * Math.PI * 2) * r));
      const l = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color, transparent: true, opacity }));
      this.scene.add(l);
    };
    ring(O.GEO_R / O.RE, "#ff9f5a", 0.28);
    ring(1.002, "#4fd1ff", 0.25);
    const dg = new THREE.BufferGeometry();
    dg.setAttribute("position", new THREE.BufferAttribute(new Float32Array(400 * 3), 3));
    dg.setAttribute("color", new THREE.BufferAttribute(new Float32Array(400 * 3), 3));
    this.dots = new THREE.Points(dg, new THREE.PointsMaterial({ size: 5, sizeAttenuation: false, vertexColors: true, toneMapped: false }));
    this.dots.frustumCulled = false;
    this.scene.add(this.dots);
    this.sel = new THREE.Mesh(new THREE.SphereGeometry(0.035, 16, 12), new THREE.MeshBasicMaterial({ color: new THREE.Color("#c8ff3d").multiplyScalar(3), toneMapped: false }));
    this.scene.add(this.sel);
    this.ascent = new THREE.Line(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: new THREE.Color("#c8ff3d").multiplyScalar(2.5), toneMapped: false }));
    this.ascent.frustumCulled = false;
    this.scene.add(this.ascent);
    this.moon = new THREE.Mesh(new THREE.SphereGeometry(1737 / O.RE, 32, 16), new THREE.MeshStandardMaterial({ color: "#9a9a96", roughness: 1 }));
    this.scene.add(this.moon);
    this.sunLine = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]), new THREE.LineBasicMaterial({ color: "#ffd166", transparent: true, opacity: 0.35 }));
    this.scene.add(this.sunLine);
    const l = new THREE.DirectionalLight("#ffffff", 2.5);
    l.name = "sun";
    this.scene.add(l, new THREE.AmbientLight("#334", 0.4));
    const sp = new Float32Array(2000 * 3);
    for (let i = 0; i < 2000; i++) {
      const v = new THREE.Vector3().randomDirection().multiplyScalar(900);
      sp.set([v.x, v.y, v.z], i * 3);
    }
    const sg = new THREE.BufferGeometry();
    sg.setAttribute("position", new THREE.BufferAttribute(sp, 3));
    this.scene.add(new THREE.Points(sg, new THREE.PointsMaterial({ color: "#8899aa", size: 1.2, sizeAttenuation: false })));
  }

  private rebuildLines(jd: number) {
    this.lines.clear();
    const s = useMC.getState();
    for (const sat of s.fleet) {
      if (!sat.el || sat.el.e >= 1 || sat.status === "reentered" || sat.status === "cruise" || sat.status === "arrived" || sat.status === "lunar" || sat.status === "l2") continue;
      if (sat.kind === "constellation" && sat.id.slice(-2) !== "-0") continue;
      const P = O.period(sat.el.a) / 86400;
      const pts: THREE.Vector3[] = [];
      for (let k = 0; k <= 160; k++) pts.push(toThree(O.stateAt(sat.el, jd + (k / 160) * P).r));
      const isSel = sat.id === s.selected;
      const ours = sat.owner === "ours";
      const col = new THREE.Color(isSel ? "#c8ff3d" : sat.color).multiplyScalar(isSel ? 2.4 : ours ? 1.3 : 0.7);
      const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: col, transparent: true, opacity: isSel ? 1 : ours ? 0.75 : sat.kind === "constellation" ? 0.18 : 0.35, toneMapped: false }));
      this.lines.add(line);
    }
  }

  update(dt: number) {
    this.t += dt;
    const jd = mc.jd;
    const s = useMC.getState();
    if (this.t - this.lastLines > 2) {
      this.lastLines = this.t;
      this.rebuildLines(jd);
    }
    this.earth.rotation.y = O.gmst(jd);
    const sun = toThree(O.sunDir(jd)).normalize();
    (this.earth.material as THREE.ShaderMaterial).uniforms.uSun.value.copy(sun);
    (this.earth.material as THREE.ShaderMaterial).uniforms.uTime.value = this.t;
    (this.atmo.material as THREE.ShaderMaterial).uniforms.uSun.value.copy(sun);
    (this.scene.getObjectByName("sun") as THREE.DirectionalLight).position.copy(sun).multiplyScalar(50);
    this.sunLine.geometry.setFromPoints([new THREE.Vector3(), sun.clone().multiplyScalar(1.6)]);
    toThree(O.moonPos(jd), this.moon.position);
    // dots
    const pos = this.dots.geometry.getAttribute("position") as THREE.BufferAttribute;
    const col = this.dots.geometry.getAttribute("color") as THREE.BufferAttribute;
    let n = 0;
    let selPos: THREE.Vector3 | null = null;
    let selR = 1.6;
    const c = new THREE.Color();
    const v = new THREE.Vector3();
    for (const sat of s.fleet) {
      const now = satNow(sat, jd);
      if (!now || now.dist > 500_000 || n >= 400) continue;
      toThree(now.r, v);
      pos.setXYZ(n, v.x, v.y, v.z);
      c.set(sat.color).multiplyScalar(sat.owner === "ours" ? 2.2 : 1.1);
      col.setXYZ(n, c.r, c.g, c.b);
      n++;
      if (sat.id === s.selected) {
        selPos = v.clone();
        selR = sat.el && sat.el.e < 1 ? (sat.el.a * (1 + sat.el.e)) / O.RE : v.length();
      }
    }
    pos.needsUpdate = col.needsUpdate = true;
    this.dots.geometry.setDrawRange(0, n);
    this.sel.visible = !!selPos;
    if (selPos) this.sel.position.copy(selPos);
    this.sel.scale.setScalar(1 + 0.25 * Math.sin(this.t * 6));
    // ascent
    const f = mc.flight;
    let tgtR = selPos ? selR : 3;
    if (f && s.ops.phase !== "idle") {
      const pts = f.hist.filter((_, i) => i % 3 === 0).map((h) => toThree(O.geoToEci(h.lat, h.lon, h.h, f.plan.jd0 + h.t / 86400)));
      if (pts.length > 1) this.ascent.geometry.setFromPoints(pts);
      this.ascent.visible = pts.length > 1;
      const p = toThree(O.mul(f.r, 1 / 1000));
      this.sel.visible = true;
      this.sel.position.copy(p);
      selPos = p;
      tgtR = Math.max(1.6, p.length() * 1.15);
    } else this.ascent.visible = false;
    // camera: frame the selected orbit, drift slowly
    this.az += dt * 0.05;
    const want = THREE.MathUtils.clamp(tgtR * 2.6, 5, 120);
    this.dist += (want - this.dist) * Math.min(1, dt * 0.8);
    const focus = selPos && this.dist < 6 ? selPos.clone().multiplyScalar(0.35) : new THREE.Vector3();
    this.target.lerp(focus, Math.min(1, dt * 1.5));
    this.camera.position.set(Math.cos(this.az) * this.dist, this.dist * 0.42, Math.sin(this.az) * this.dist).add(this.target);
    this.camera.lookAt(this.target);
    const r = this.renderer;
    const prev = r.getRenderTarget();
    r.setRenderTarget(this.rt);
    r.setClearColor("#01040a", 1);
    r.clear();
    r.render(this.scene, this.camera);
    r.setRenderTarget(prev);
    r.setClearColor("#000000", 1);
  }

  dispose() {
    this.rt.dispose();
  }
}
