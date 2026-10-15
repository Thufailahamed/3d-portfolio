"use client";

import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { gsap } from "@/lib/gsap";
import { chapter } from "@/lib/chapters";
import { rng } from "@/lib/random";
import { sceneState } from "@/lib/sceneState";
import { thunder } from "@/lib/sound";
import { useApp } from "@/store/useApp";
import { palette } from "./palette";
import { rainFrag, rainVert, skyFrag, skyVert } from "./shaders/weather";
import { weatherUniforms } from "./weatherUniforms";

const c = (hex: string) => new THREE.Color(hex);
/** night (the original) / day / storm: sky horizon (= fog), zenith, clouds; fog density */
const LOOK = {
  night: { horizon: palette.fog.clone(), zenith: palette.bg.clone(), cloud: palette.bg.clone(), fog: 0.045 },
  day: { horizon: c("#8fa7ae"), zenith: c("#3a6c9c"), cloud: c("#c9d3d6"), fog: 0.034 },
  rain: { horizon: c("#283035"), zenith: c("#14191d"), cloud: c("#323a40"), fog: 0.058 },
};
const SUN_DIR = new THREE.Vector3(0.5, 1, 0.1).normalize();
const FLASH = new THREE.Color("#8c9cb8");

/**
 * The forest's weather: eases between night, day and storm, and paints the sky, fog, rain
 * and lightning to match. Everything fades back to the night palette once the journey has
 * left the forest, so later chapters keep their own look.
 */
export default function Weather() {
  const isMobile = useApp((s) => s.isMobile);
  const scene = useThree((s) => s.scene);
  const dome = useRef<THREE.Mesh>(null);
  const rainMesh = useRef<THREE.Mesh>(null);
  // the eased mix, before the forest's presence scales it down
  const mix = useMemo(() => ({ day: 0, rain: 0 }), []);

  useEffect(() => {
    const to = (w: string, instant = false) =>
      gsap.to(mix, {
        day: w === "day" ? 1 : 0,
        rain: w === "rain" ? 1 : 0,
        duration: instant ? 0 : 2.6,
        ease: "sine.inOut",
        overwrite: true,
      });
    to(useApp.getState().weather, true);
    return useApp.subscribe((s, prev) => s.weather !== prev.weather && void to(s.weather));
  }, [mix]);

  const sky = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader: skyVert,
        fragmentShader: skyFrag,
        side: THREE.BackSide,
        depthWrite: false,
        fog: false,
        uniforms: {
          uHorizon: { value: new THREE.Color() },
          uZenith: { value: new THREE.Color() },
          uCloud: { value: new THREE.Color() },
          uClouds: { value: 0 },
          uSunDir: { value: SUN_DIR },
          uSun: { value: new THREE.Color() },
          uTime: { value: 0 },
        },
      }),
    [],
  );

  const rain = useMemo(() => {
    const n = isMobile ? 1400 : 3200;
    const random = rng(97);
    const rand = new Float32Array(n * 4 * 4);
    const corner = new Float32Array(n * 4 * 2);
    const index: number[] = [];
    for (let i = 0; i < n; i++) {
      const r = [random(), random(), random(), random()];
      for (let k = 0; k < 4; k++) {
        rand.set(r, (i * 4 + k) * 4);
        corner.set([k % 2 ? 1 : -1, k < 2 ? 0 : 1], (i * 4 + k) * 2);
      }
      const v = i * 4;
      index.push(v, v + 1, v + 2, v + 2, v + 1, v + 3);
    }
    const g = new THREE.BufferGeometry();
    // positions are made in the shader; this only gives three.js a vertex count
    g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(n * 4 * 3), 3));
    g.setAttribute("aRand", new THREE.BufferAttribute(rand, 4));
    g.setAttribute("aCorner", new THREE.BufferAttribute(corner, 2));
    g.setIndex(index);
    const m = new THREE.ShaderMaterial({
      vertexShader: rainVert,
      fragmentShader: rainFrag,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: {
        uTime: { value: 0 },
        uBox: { value: new THREE.Vector3(14, 10, 14) },
        uRain: weatherUniforms.uRain,
        uFlash: weatherUniforms.uFlash,
      },
    });
    return { g, m };
  }, [isMobile]);

  useEffect(
    () => () => {
      sky.dispose();
      rain.g.dispose();
      rain.m.dispose();
    },
    [sky, rain],
  );

  const bg = useMemo(() => palette.bg.clone(), []);
  useEffect(() => {
    scene.background = bg;
  }, [scene, bg]);

  const bolt = useMemo(() => ({ next: 6, t: -1, random: rng(5) }), []);

  useFrame(({ camera }, dt) => {
    const { mode } = useApp.getState();
    const tu = chapter("tunnel");
    const p = sceneState.p;
    // the forest is on screen until the tunnel has covered it
    const presence = mode === "journey" ? 1 - THREE.MathUtils.smoothstep(p, tu.start, tu.start + (tu.end - tu.start) * 0.5) : 0;
    const day = mix.day * presence;
    const wet = mix.rain * presence;

    // lightning: now and then while it rains, a double flash
    bolt.next -= dt;
    if (wet > 0.5 && bolt.next < 0 && bolt.t < 0) {
      bolt.t = 0;
      bolt.next = 7 + bolt.random() * 10;
      if (useApp.getState().sound) thunder(0.8 + bolt.random() * 1.6);
    }
    let flash = 0;
    if (bolt.t >= 0) {
      const t = (bolt.t += dt);
      flash = Math.exp(-t * 14) + (t > 0.16 ? 0.75 * Math.exp(-(t - 0.16) * 7) : 0);
      if (t > 1.2) bolt.t = -1;
    }
    flash *= wet;

    sceneState.weather.day = day;
    sceneState.weather.rain = wet;
    sceneState.weather.flash = flash;
    weatherUniforms.uDay.value = day;
    weatherUniforms.uRain.value = wet;
    weatherUniforms.uFlash.value = flash;

    // sky, fog and background, blended night → day → storm (+ the flash)
    const u = sky.uniforms;
    const blend = (key: "horizon" | "zenith" | "cloud", out: THREE.Color) =>
      out.copy(LOOK.night[key]).lerp(LOOK.day[key], day).lerp(LOOK.rain[key], wet).lerp(FLASH, flash * 0.35);
    blend("horizon", u.uHorizon.value);
    blend("zenith", u.uZenith.value);
    blend("cloud", u.uCloud.value);
    u.uClouds.value = day * 0.35 + wet * 0.9;
    u.uSun.value.setRGB(1, 0.86, 0.62).multiplyScalar(day * (1 - wet));
    u.uTime.value += dt;
    bg.copy(u.uHorizon.value);
    const fog = scene.fog as THREE.FogExp2 | null;
    if (fog) {
      fog.color.copy(u.uHorizon.value);
      // the flow pavilion runs its own fog density
      if (mode !== "flow") fog.density = LOOK.night.fog + (LOOK.day.fog - LOOK.night.fog) * day + (LOOK.rain.fog - LOOK.night.fog) * wet;
    }

    if (dome.current) {
      dome.current.visible = day + wet > 0.001;
      dome.current.position.copy(camera.position);
    }
    if (rainMesh.current) rainMesh.current.visible = wet > 0.001;
    rain.m.uniforms.uTime.value += dt;
  });

  return (
    <>
      <mesh ref={dome} material={sky} renderOrder={-10} frustumCulled={false} visible={false}>
        <sphereGeometry args={[90, 48, 24]} />
      </mesh>
      <mesh ref={rainMesh} geometry={rain.g} material={rain.m} frustumCulled={false} renderOrder={7} visible={false} />
    </>
  );
}
