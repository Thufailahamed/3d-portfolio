"use client";

import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { rng } from "@/lib/random";
import {
  meteorFrag,
  meteorVert,
  skyDomeFrag,
  skyDomeVert,
  starsFrag,
  starsVert,
} from "./shaders/cosmicSky";

const STAR_COUNT = 4500;
const DOME_RADIUS = 260;
const STARS_RADIUS = 240;

/**
 * Celestial Sky:
 *  - Procedural skydome with Milky Way galactic dust band, a tilted spiral galaxy, and satellite dwarf galaxy
 *  - 4,500 multi-spectral 3D twinkling stars with cross diffraction flares on bright anchor stars
 *  - Dynamic shooting stars / meteors streaking across the zenith
 */
export default function CosmicSky() {
  const root = useRef<THREE.Group>(null);
  const camera = useThree((s) => s.camera);

  const tmpVec = useMemo(() => new THREE.Vector3(), []);

  // Keep the celestial sphere centered on the camera so stars and galaxies stay infinitely distant
  useFrame(() => {
    if (root.current) {
      if (root.current.parent) {
        root.current.parent.worldToLocal(tmpVec.copy(camera.position));
        root.current.position.copy(tmpVec);
      } else {
        root.current.position.copy(camera.position);
      }
    }
  });

  return (
    <group ref={root}>
      <SkyDome />
      <StarField count={STAR_COUNT} />
      <ShootingStars count={3} />
    </group>
  );
}

/** Skydome generating the Milky Way, spiral galaxy, and cosmic nebulae */
function SkyDome() {
  const { geometry, material } = useMemo(() => {
    const geometry = new THREE.SphereGeometry(DOME_RADIUS, 64, 48);
    const material = new THREE.ShaderMaterial({
      vertexShader: skyDomeVert,
      fragmentShader: skyDomeFrag,
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      toneMapped: false,
      uniforms: {
        uTime: { value: 0 },
      },
    });
    return { geometry, material };
  }, []);

  useFrame((_, dt) => {
    material.uniforms.uTime.value += dt;
  });

  useEffect(
    () => () => {
      geometry.dispose();
      material.dispose();
    },
    [geometry, material],
  );

  return <mesh geometry={geometry} material={material} renderOrder={-200} />;
}

/** Spectral star field with scintillation and diffraction spikes */
function StarField({ count }: { count: number }) {
  const pointsRef = useRef<THREE.Points>(null);
  const dpr = useThree((s) => s.viewport.dpr);

  const { geometry, material } = useMemo(() => {
    const random = rng(42);
    const pos = new Float32Array(count * 3);
    const size = new Float32Array(count);
    const color = new Float32Array(count * 3);
    const twinkle = new Float32Array(count * 3);

    // Galactic normal vector to create natural star clumping along the galaxy band
    const galNormal = new THREE.Vector3(-0.42, 0.70, 0.58).normalize();

    // Spectral star palettes (linear RGB)
    const spectralColors = [
      new THREE.Color("#f2f7ff"), // Crisp white (A-type)
      new THREE.Color("#d2e7ff"), // Diamond white (B-type)
      new THREE.Color("#7acaff"), // Electric blue/cyan (O-type)
      new THREE.Color("#ffe8ab"), // Warm yellow/gold (G-type)
      new THREE.Color("#ffd285"), // Amber/orange (K-type)
      new THREE.Color("#e4b5ff"), // Soft celestial violet
    ];

    for (let i = 0; i < count; i++) {
      // Fibonacci / spherical distribution across the celestial hemisphere (y >= -0.05)
      const u = random();
      const v = random();
      const theta = u * 2.0 * Math.PI;
      // Bias upward so stars are plentiful above the horizon
      const phi = Math.acos(1.0 - v * 1.05); // covers up to slightly below horizon

      const x0 = Math.sin(phi) * Math.cos(theta);
      const y0 = Math.cos(phi);
      const z0 = Math.sin(phi) * Math.sin(theta);

      const dir = new THREE.Vector3(x0, y0, z0);

      // Slightly denser concentration along the galactic plane
      const galDist = Math.abs(dir.dot(galNormal));
      const r = STARS_RADIUS * (0.95 + random() * 0.1);

      pos[i * 3] = dir.x * r;
      pos[i * 3 + 1] = dir.y * r;
      pos[i * 3 + 2] = dir.z * r;

      // Magnitude / size distribution: mostly fine stars, some prominent anchor stars
      const isHeroStar = random() < 0.05;
      const starSize = isHeroStar ? 3.2 + random() * 1.8 : 1.2 + Math.pow(random(), 2.2) * 2.0;
      size[i] = starSize;

      // Pick spectral color
      let colIdx = 0;
      const cr = random();
      if (cr < 0.42) colIdx = 0;
      else if (cr < 0.65) colIdx = 1;
      else if (cr < 0.80) colIdx = 2;
      else if (cr < 0.92) colIdx = 3;
      else if (cr < 0.97) colIdx = 4;
      else colIdx = 5;

      const c = spectralColors[colIdx];
      color[i * 3] = c.r;
      color[i * 3 + 1] = c.g;
      color[i * 3 + 2] = c.b;

      // Twinkle properties: speed (1.5..5.5 rad/s), phase (0..2pi), brightness
      twinkle[i * 3] = 1.5 + random() * 4.0;
      twinkle[i * 3 + 1] = random() * Math.PI * 2;
      twinkle[i * 3 + 2] = 0.55 + random() * 0.45;
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    geometry.setAttribute("aSize", new THREE.BufferAttribute(size, 1));
    geometry.setAttribute("aColor", new THREE.BufferAttribute(color, 3));
    geometry.setAttribute("aTwinkle", new THREE.BufferAttribute(twinkle, 3));

    const material = new THREE.ShaderMaterial({
      vertexShader: starsVert,
      fragmentShader: starsFrag,
      transparent: true,
      depthWrite: false,
      fog: false,
      toneMapped: false,
      blending: THREE.AdditiveBlending,
      uniforms: {
        uTime: { value: 0 },
        uPixelRatio: { value: dpr },
      },
    });

    return { geometry, material };
  }, [count, dpr]);

  useFrame((_, dt) => {
    material.uniforms.uTime.value += dt;
  });

  useEffect(
    () => () => {
      geometry.dispose();
      material.dispose();
    },
    [geometry, material],
  );

  return <points geometry={geometry} material={material} renderOrder={-150} />;
}

/** Dynamic shooting stars streaking across the upper sky */
function ShootingStars({ count = 3 }: { count: number }) {
  const meteors = useMemo(() => {
    const random = rng(99);
    return Array.from({ length: count }, (_, i) => ({
      id: i,
      start: new THREE.Vector3(),
      dir: new THREE.Vector3(),
      pos: new THREE.Vector3(),
      speed: 0,
      length: 0,
      life: 0,
      maxLife: 0,
      delay: random() * 4 + i * 2.5,
    }));
  }, [count]);

  const groupRef = useRef<THREE.Group>(null);

  // Buffer geometries for each meteor streak
  const lineData = useMemo(() => {
    return meteors.map(() => {
      const pos = new Float32Array(6); // 2 points (head, tail)
      const prog = new Float32Array([1.0, 0.0]); // head is 1, tail is 0
      const geo = new THREE.BufferGeometry();
      geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
      geo.setAttribute("aProgress", new THREE.BufferAttribute(prog, 1));
      const mat = new THREE.ShaderMaterial({
        vertexShader: meteorVert,
        fragmentShader: meteorFrag,
        transparent: true,
        depthWrite: false,
        fog: false,
        toneMapped: false,
        blending: THREE.AdditiveBlending,
        uniforms: {
          uAlpha: { value: 0 },
        },
      });
      const line = new THREE.Line(geo, mat);
      line.renderOrder = -120;
      return { geo, mat, line };
    });
  }, [meteors]);

  useEffect(() => {
    const g = groupRef.current;
    if (!g) return;
    lineData.forEach(({ line }) => g.add(line));
    return () => {
      lineData.forEach(({ geo, mat, line }) => {
        g.remove(line);
        geo.dispose();
        mat.dispose();
      });
    };
  }, [lineData]);

  const resetMeteor = (m: (typeof meteors)[number]) => {
    const random = Math.random;
    // Spawn in the upper hemisphere
    const angle = random() * Math.PI * 2;
    const elev = 0.45 + random() * 0.45;
    const r = STARS_RADIUS * 0.96;
    m.start.set(Math.cos(angle) * r * Math.sqrt(1 - elev * elev), r * elev, Math.sin(angle) * r * Math.sqrt(1 - elev * elev));
    m.pos.copy(m.start);
    // Direction points downwards and diagonally across the sky
    m.dir.set((random() - 0.5) * 1.5, -0.4 - random() * 0.6, (random() - 0.5) * 1.5).normalize();
    m.speed = 180 + random() * 120;
    m.length = 16 + random() * 14;
    m.life = 0;
    m.maxLife = 0.55 + random() * 0.45;
    m.delay = 1.5 + random() * 5.5; // wait before next shooting star
  };

  useFrame((_, dt) => {
    meteors.forEach((m, idx) => {
      const { geo, mat } = lineData[idx];

      if (m.delay > 0) {
        m.delay -= dt;
        mat.uniforms.uAlpha.value = 0;
        return;
      }

      if (m.life === 0 && m.speed === 0) {
        resetMeteor(m);
      }

      m.life += dt;
      if (m.life >= m.maxLife) {
        m.life = 0;
        m.speed = 0;
        mat.uniforms.uAlpha.value = 0;
        return;
      }

      // Advance meteor head
      m.pos.addScaledVector(m.dir, m.speed * dt);
      const tail = m.pos.clone().addScaledVector(m.dir, -m.length);

      const positions = geo.attributes.position.array as Float32Array;
      positions[0] = m.pos.x;
      positions[1] = m.pos.y;
      positions[2] = m.pos.z;
      positions[3] = tail.x;
      positions[4] = tail.y;
      positions[5] = tail.z;
      geo.attributes.position.needsUpdate = true;

      // Fade in quickly, then fade out
      const progress = m.life / m.maxLife;
      const alpha = Math.sin(progress * Math.PI);
      mat.uniforms.uAlpha.value = alpha;
    });
  });

  return <group ref={groupRef} />;
}
