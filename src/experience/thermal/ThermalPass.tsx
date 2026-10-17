"use client";

import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo } from "react";
import * as THREE from "three";
import { sceneState } from "@/lib/sceneState";
import { useApp } from "@/store/useApp";
import { realState } from "../real/realState";
import { createHeatMaterial, HeatKind, heatOf } from "./heat";

const { damp, clamp } = THREE.MathUtils;

/** Sensor height in pixels (a 640×480-class microbolometer); the width follows the screen. */
const SENSOR_H = 480;
/** Seconds to bring the binoculars up to the eyes (or lower them). */
const RAISE_SECONDS = 0.7;

// Air, sky and sun for each weather (°C): a tropical Colombo day, its warm night, a cool storm
const CLIMATE = {
  day: { air: 31, solar: 22, skyZ: -18, skyH: 17, cool: 0.6, release: 0.6, humid: 0.15 },
  night: { air: 26, solar: 0, skyZ: -32, skyH: 14, cool: 3.6, release: 3.2, humid: 0.22 },
  rain: { air: 23, solar: 0, skyZ: 12, skyH: 19, cool: 0.3, release: 0.4, humid: 1.0 },
};

const quadVert = /* glsl */ `
  varying vec2 vUv;
  void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
`;

// Auto gain: mean and spread of the scene (not the sky), eased over time like a real camera's AGC
const statsFrag = /* glsl */ `
  uniform sampler2D tTemp;
  uniform sampler2D tPrev;
  uniform float uFirst;
  uniform float uRate;
  uniform int uCols;
  uniform int uRows;
  varying vec2 vUv;
  void main() {
    float s = 0.0, s2 = 0.0, n = 0.0;
    for (int y = 0; y < uRows; y++) {
      for (int x = 0; x < uCols; x++) {
        vec2 uv = 0.12 + 0.76 * (vec2(float(x), float(y)) + 0.5) / vec2(float(uCols), float(uRows));
        vec4 t = texture2D(tTemp, uv);
        // skip the open sky and anything not finite (a single NaN would poison the average)
        if (t.g > 8000.0 || !(t.r == t.r) || abs(t.r) > 500.0) continue;
        s += t.r; s2 += t.r * t.r; n += 1.0;
      }
    }
    float m = n > 0.0 ? s / n : 25.0;
    float sd = n > 0.0 ? sqrt(max(s2 / n - m * m, 0.0)) : 3.0;
    float lo = m - 2.1 * sd, hi = m + 2.7 * sd;
    float mid = 0.5 * (lo + hi), span = max(hi - lo, 7.0);
    vec2 r = vec2(mid - 0.47 * span, mid + 0.53 * span);
    vec4 prev = texture2D(tPrev, vec2(0.5));
    gl_FragColor = vec4(uFirst > 0.5 ? r : mix(prev.xy, r, uRate), 0.0, 1.0);
  }
`;

const displayFrag = /* glsl */ `
  uniform sampler2D tTemp;
  uniform sampler2D tStats;
  uniform vec2 uRes;
  uniform vec2 uSensor;
  uniform float uRaise;
  uniform float uTime;
  uniform int uPalette;
  uniform float uFlash;
  uniform float uSingle;
  varying vec2 vUv;

  float hash(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }

  vec3 ironbow(float v) {
    vec3 c = mix(vec3(0.0, 0.0, 0.03), vec3(0.13, 0.02, 0.33), smoothstep(0.0, 0.16, v));
    c = mix(c, vec3(0.55, 0.05, 0.56), smoothstep(0.16, 0.36, v));
    c = mix(c, vec3(0.87, 0.24, 0.13), smoothstep(0.36, 0.56, v));
    c = mix(c, vec3(0.99, 0.6, 0.05), smoothstep(0.56, 0.76, v));
    c = mix(c, vec3(1.0, 0.88, 0.36), smoothstep(0.76, 0.9, v));
    return mix(c, vec3(1.0, 1.0, 0.93), smoothstep(0.9, 1.0, v));
  }

  void main() {
    float raise = smoothstep(0.0, 1.0, uRaise);
    float aspect = uRes.x / uRes.y;
    vec2 p = (vUv - 0.5) * vec2(aspect, 1.0);
    // the eyepieces come in from beyond the screen as the binoculars are lifted
    float scale = mix(2.4, 1.0, raise);
    float r = 0.43 * scale;
    float sep = uSingle > 0.5 ? 0.0 : 0.215 * scale;
    float d = min(length(p - vec2(-sep, 0.0)), length(p - vec2(sep, 0.0)));
    float px = 1.5 / uRes.y;
    float mask = 1.0 - smoothstep(r - px * 2.0, r + px, d);
    // the tube's dark inner rim
    float rim = smoothstep(r - 0.075, r - 0.002, d);

    // image: a little barrel distortion, then the sensor
    vec2 c = vUv - 0.5;
    vec2 uv = 0.5 + c * (1.0 - 0.07 * dot(p, p));
    vec2 tx = 1.0 / uSensor;
    float t = texture2D(tTemp, uv).r;
    // digital detail enhancement: the crisp edges thermal cameras are known for
    float blur = 0.25 * (texture2D(tTemp, uv + vec2(tx.x, 0.0)).r + texture2D(tTemp, uv - vec2(tx.x, 0.0)).r +
                         texture2D(tTemp, uv + vec2(0.0, tx.y)).r + texture2D(tTemp, uv - vec2(0.0, tx.y)).r);
    t += (t - blur) * 1.25;
    vec2 g = texture2D(tStats, vec2(0.5)).xy;
    float v = clamp((t - g.x) / max(g.y - g.x, 0.5), 0.0, 1.0);
    // optical halo around the hottest things
    float halo = 0.0;
    for (int i = 0; i < 8; i++) {
      float a = float(i) * 0.785398;
      float th = texture2D(tTemp, uv + vec2(cos(a), sin(a)) * tx * 5.0).r;
      halo += max((th - g.y) / max(g.y - g.x, 0.5), 0.0);
    }
    v = clamp(v + halo * 0.035, 0.0, 1.0);
    // sensor noise: temporal grain and faint column fixed-pattern
    float grain = hash(vUv * uRes + fract(uTime * 37.0) * 311.0) - 0.5;
    float fpn = hash(vec2(floor(uv.x * uSensor.x), 7.0)) - 0.5;
    v = clamp(v + grain * 0.035 + fpn * 0.012, 0.0, 1.0);
    // non-uniformity correction: the shutter drops in, the image goes flat for a moment
    v = mix(v, 0.48 + grain * 0.02, uFlash);

    vec3 col;
    if (uPalette == 1) col = vec3(pow(1.0 - v, 1.1));
    else if (uPalette == 2) col = ironbow(v);
    else col = vec3(pow(v, 1.05));
    // the device boots as it reaches the eyes: static, then the picture
    float boot = smoothstep(0.55, 0.95, uRaise);
    col = mix(vec3(0.15 + grain * 0.3), col, boot) * boot;
    col *= 1.0 - 0.75 * rim;
    col *= mask;
    gl_FragColor = vec4(col, smoothstep(0.0, 0.3, uRaise));
  }
`;

/**
 * The thermal binoculars' render: while they are up, the scene is drawn once more with the heat
 * material into a low-resolution float "sensor", gained and coloured like a real thermal imager
 * and shown through the binocular eyepieces. Fully raised, the normal render is skipped.
 */
export default function ThermalPass() {
  const gl = useThree((s) => s.gl);
  const scene = useThree((s) => s.scene);
  const size = useThree((s) => s.size);

  const heatMat = useMemo(() => createHeatMaterial(), []);

  const targets = useMemo(() => {
    const opts = { type: THREE.HalfFloatType, depthBuffer: true, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter };
    const temp = new THREE.WebGLRenderTarget(4, 4, opts);
    const stats = [0, 1].map(() => new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, depthBuffer: false }));
    return { temp, stats, flip: 0 };
  }, []);

  const quad = useMemo(() => {
    const geo = new THREE.PlaneGeometry(2, 2);
    const stats = new THREE.ShaderMaterial({
      vertexShader: quadVert,
      fragmentShader: statsFrag,
      depthTest: false,
      depthWrite: false,
      uniforms: {
        tTemp: { value: null },
        tPrev: { value: null },
        uFirst: { value: 1 },
        uRate: { value: 0.08 },
        uCols: { value: 24 },
        uRows: { value: 18 },
      },
    });
    const display = new THREE.ShaderMaterial({
      vertexShader: quadVert,
      fragmentShader: displayFrag,
      depthTest: false,
      depthWrite: false,
      transparent: true,
      uniforms: {
        tTemp: { value: null },
        tStats: { value: null },
        uRes: { value: new THREE.Vector2() },
        uSensor: { value: new THREE.Vector2() },
        uRaise: { value: 0 },
        uTime: { value: 0 },
        uPalette: { value: 0 },
        uFlash: { value: 0 },
        uSingle: { value: 0 },
      },
    });
    const mesh = new THREE.Mesh(geo, stats);
    mesh.frustumCulled = false;
    const s = new THREE.Scene();
    s.add(mesh);
    return { geo, stats, display, mesh, scene: s, cam: new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1) };
  }, []);

  useEffect(
    () => () => {
      heatMat.dispose();
      targets.temp.dispose();
      targets.stats.forEach((t) => t.dispose());
      quad.geo.dispose();
      quad.stats.dispose();
      quad.display.dispose();
      useApp.getState().set({ thermalFull: false });
      sceneState.thermal.raise = 0;
    },
    [heatMat, targets, quad],
  );

  // per object: what the sensor sees, set just before each object is drawn
  useEffect(() => {
    const u = heatMat.uniforms;
    heatMat.onBeforeRender = (_r, _s, _c, _g, object) => {
      const h = heatOf(object);
      u.uHide.value = h.hide ? 1 : 0;
      u.uKind.value = h.kind ?? HeatKind.Surface;
      u.uHeat.value = h.heat ?? 0;
      u.uAbsorb.value = h.absorb ?? 0.9;
      u.uEmis.value = h.emis ?? 0.95;
      u.uMasonry.value = h.masonry ?? 0;
      if (h.kind === HeatKind.Sky) {
        // the realistic sky's baked cube carries the cloud cover in its alpha
        const sky = ((object as THREE.Mesh).material as THREE.ShaderMaterial).uniforms?.uSky?.value as THREE.Texture | undefined;
        u.uClouds.value = sky ?? null;
        u.uHasClouds.value = sky ? 1 : 0;
      }
      heatMat.uniformsNeedUpdate = true;
    };
  }, [heatMat]);

  const sim = useMemo(
    () => ({
      cam: new THREE.PerspectiveCamera(),
      climate: { ...CLIMATE.night },
      first: true,
      frame: 0,
      nucNext: 24,
      nucT: -1,
      read: new Uint16Array(4),
      readStats: new Uint16Array(4),
      dir: new THREE.Vector3(),
      euler: new THREE.Euler(0, 0, 0, "YXZ"),
      q: new THREE.Quaternion(),
      clear: new THREE.Color(),
    }),
    [],
  );

  useFrame((state, dt) => {
    const step = Math.min(dt, 0.1);
    const t = sceneState.thermal;
    const app = useApp.getState();
    const want = app.thermal && app.mode === "flow" ? 1 : 0;
    t.raise = clamp(t.raise + (want ? 1 : -1) * (step / RAISE_SECONDS), 0, 1);
    const full = t.raise >= 1;
    if (full !== app.thermalFull) app.set({ thermalFull: full });
    if (t.raise <= 0) {
      sim.first = true;
      return;
    }

    // ---- climate for the current weather (eased; the realistic sky's own mix when it runs)
    const w = app.weather;
    const k = realState.active ? { day: realState.day, night: realState.night, rain: realState.rain } : { day: w === "day" ? 1 : 0, night: w === "night" ? 1 : 0, rain: w === "rain" ? 1 : 0 };
    const c = sim.climate;
    for (const key of Object.keys(c) as (keyof typeof c)[]) {
      const target = CLIMATE.day[key] * k.day + CLIMATE.night[key] * k.night + CLIMATE.rain[key] * k.rain;
      c[key] = damp(c[key], target, 2, step);
    }
    const u = heatMat.uniforms;
    u.uAir.value = c.air;
    u.uSolar.value = c.solar;
    u.uSkyZ.value = c.skyZ;
    u.uSkyH.value = c.skyH;
    u.uCool.value = c.cool;
    u.uRelease.value = c.release;
    u.uHumid.value = c.humid;
    u.uSun.value.copy(realState.sunDir);
    u.uLampOn.value = clamp(k.night + k.rain * 0.7, 0, 1);

    // ---- the sensor's camera: the view, magnified, with a held-in-the-hands drift
    t.zoom = damp(t.zoom, t.zoomTarget, 6, step);
    const cam = sim.cam;
    const base = state.camera as THREE.PerspectiveCamera;
    cam.position.copy(base.position);
    cam.quaternion.copy(base.quaternion);
    const time = state.clock.elapsedTime;
    const settle = (1 - t.raise) * 0.02;
    sim.euler.set(
      Math.sin(time * 0.71) * 0.0012 + Math.sin(time * 1.9) * 0.0004 + settle * Math.sin(time * 9),
      Math.sin(time * 0.53 + 1.1) * 0.0016 + Math.sin(time * 1.37) * 0.0005,
      Math.sin(time * 0.4) * 0.001,
    );
    // the hand tremor is magnified with the image
    sim.euler.x *= 0.6 + t.zoom * 0.25;
    sim.euler.y *= 0.6 + t.zoom * 0.25;
    cam.quaternion.multiply(sim.q.setFromEuler(sim.euler));
    const fov = THREE.MathUtils.degToRad(base.fov);
    cam.fov = THREE.MathUtils.radToDeg(2 * Math.atan(Math.tan(fov / 2) / t.zoom));
    cam.aspect = size.width / Math.max(size.height, 1);
    cam.near = base.near;
    cam.far = base.far;
    cam.updateProjectionMatrix();
    cam.updateMatrixWorld();

    // ---- sensor size follows the screen's aspect
    const sw = Math.round(SENSOR_H * cam.aspect);
    if (targets.temp.width !== sw || targets.temp.height !== SENSOR_H) {
      targets.temp.setSize(sw, SENSOR_H);
      sim.first = true;
    }

    // ---- recalibration now and then: the picture holds, then goes flat for a moment
    sim.nucNext -= step;
    if (sim.nucNext < 0 && sim.nucT < 0 && t.raise >= 1) {
      sim.nucT = 0;
      sim.nucNext = 20 + Math.random() * 15;
    }
    let flash = 0;
    if (sim.nucT >= 0) {
      sim.nucT += step;
      flash = Math.sin(Math.min(sim.nucT / 0.35, 1) * Math.PI);
      if (sim.nucT > 0.35) sim.nucT = -1;
    }
    t.nuc = sim.nucT >= 0;

    const prevTarget = gl.getRenderTarget();
    const prevAuto = gl.autoClear;
    gl.getClearColor(sim.clear);
    const prevAlpha = gl.getClearAlpha();

    // ---- heat render (frozen during the recalibration)
    if (!t.nuc || sim.first) {
      const prevOverride = scene.overrideMaterial;
      const prevFog = scene.fog;
      const prevBg = scene.background;
      scene.overrideMaterial = heatMat;
      scene.fog = null;
      scene.background = null;
      gl.setRenderTarget(targets.temp);
      // where nothing is drawn: open sky, far away
      gl.setClearColor(new THREE.Color(c.skyZ * 0.6 + c.skyH * 0.4, 9000, 0), 1);
      gl.autoClear = true;
      gl.render(scene, cam);
      scene.overrideMaterial = prevOverride;
      scene.fog = prevFog;
      scene.background = prevBg;
    }

    // ---- auto gain
    const src = targets.stats[targets.flip];
    const dst = targets.stats[1 - targets.flip];
    targets.flip = 1 - targets.flip;
    quad.mesh.material = quad.stats;
    quad.stats.uniforms.tTemp.value = targets.temp.texture;
    quad.stats.uniforms.tPrev.value = src.texture;
    quad.stats.uniforms.uFirst.value = sim.first ? 1 : 0;
    quad.stats.uniforms.uRate.value = 1 - Math.exp(-step * 2.5);
    gl.setRenderTarget(dst);
    gl.render(quad.scene, quad.cam);
    sim.first = false;

    // ---- the eyepieces, over whatever the normal render drew
    const d = quad.display.uniforms;
    d.tTemp.value = targets.temp.texture;
    d.tStats.value = dst.texture;
    gl.getDrawingBufferSize(d.uRes.value);
    d.uSensor.value.set(sw, SENSOR_H);
    d.uRaise.value = t.raise;
    d.uTime.value = time;
    d.uPalette.value = app.thermalPalette;
    d.uFlash.value = flash;
    d.uSingle.value = size.width / Math.max(size.height, 1) < 1.1 ? 1 : 0;
    quad.mesh.material = quad.display;
    gl.setRenderTarget(null);
    gl.autoClear = false;
    gl.render(quad.scene, quad.cam);

    gl.autoClear = prevAuto;
    gl.setClearColor(sim.clear, prevAlpha);
    gl.setRenderTarget(prevTarget);

    // ---- telemetry for the HUD: what is under the reticle, the gain span, where we look
    if (++sim.frame % 6 === 0) {
      gl.readRenderTargetPixels(targets.temp, Math.floor(sw / 2), Math.floor(SENSOR_H / 2), 1, 1, sim.read);
      gl.readRenderTargetPixels(dst, 0, 0, 1, 1, sim.readStats);
      const f = THREE.DataUtils.fromHalfFloat;
      t.spot = f(sim.read[0]);
      t.range = f(sim.read[1]);
      t.lo = f(sim.readStats[0]);
      t.hi = f(sim.readStats[1]);
    }
    cam.getWorldDirection(sim.dir);
    t.heading = ((Math.atan2(sim.dir.x, -sim.dir.z) * 180) / Math.PI + 360) % 360;
    t.elevation = (Math.asin(clamp(sim.dir.y, -1, 1)) * 180) / Math.PI;
  }, 2);

  return null;
}
