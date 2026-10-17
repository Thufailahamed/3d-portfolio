"use client";

import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo } from "react";
import * as THREE from "three";
import { projects } from "@/content/site";
import { PROJECTS_ORIGIN } from "@/lib/chapters";
import { sceneState } from "@/lib/sceneState";
import { useApp } from "@/store/useApp";
import { ascentClouds, CLOUD_DECKS, stepAscent } from "../ascent";
import { ascentFrag, ascentVert } from "../shaders/ascent";
import { PRISM_Y } from "./Projects";

/** The clouds are soft: drawn at this fraction of the screen's resolution, then upscaled. */
const SCALE = 0.5;

const showVert = /* glsl */ `
varying vec2 vUv;
void main(){ vUv = uv; gl_Position = vec4(position.xy * 2.0, 0.0, 1.0); }`;
const showFrag = /* glsl */ `
uniform sampler2D uTex;
varying vec2 vUv;
void main(){ gl_FragColor = texture2D(uTex, vUv); }`;

const premultiplied = {
  transparent: true,
  depthTest: false,
  depthWrite: false,
  toneMapped: false,
  blending: THREE.CustomBlending,
  blendEquation: THREE.AddEquation,
  blendSrc: THREE.OneFactor,
  blendDst: THREE.OneMinusSrcAlphaFactor,
} as const;

/**
 * The clouds the camera climbs through between the valley and the globe (see ascent.ts).
 * They're traced into a half-resolution buffer as the overlay is drawn (so with the camera
 * exactly where the frame puts it), and that buffer is laid over the scene.
 */
export default function Ascent() {
  const size = useThree((s) => s.size);
  const dpr = useThree((s) => s.viewport.dpr);
  const gl = useThree((s) => s.gl);

  const pass = useMemo(() => {
    const material = new THREE.ShaderMaterial({
      ...premultiplied,
      vertexShader: ascentVert,
      fragmentShader: ascentFrag,
      uniforms: {
        uInvProj: { value: new THREE.Matrix4() },
        uCamWorld: { value: new THREE.Matrix4() },
        uCam: { value: new THREE.Vector3() },
        uDecks: { value: new THREE.Vector4(...CLOUD_DECKS.map((h) => PROJECTS_ORIGIN[1] + h)) },
        uDecksOn: { value: 0 },
        uVeil: { value: 0 },
        uOpen: { value: 0 },
        uZoom: { value: 1 },
        uAspect: { value: 1 },
        uTime: { value: 0 },
        uLit: { value: new THREE.Color(0.13, 0.148, 0.19) },
        uShade: { value: new THREE.Color(0.016, 0.02, 0.032) },
        uGlow: { value: new THREE.Vector3(PROJECTS_ORIGIN[0], PROJECTS_ORIGIN[1] + PRISM_Y, PROJECTS_ORIGIN[2]) },
        uTint: { value: new THREE.Color() },
      },
    });
    const quad = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), material);
    quad.frustumCulled = false;
    const scene = new THREE.Scene();
    scene.add(quad);
    // half float: the clouds are dark, and 8 bits would band
    const target = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, depthBuffer: false });
    const show = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1),
      new THREE.ShaderMaterial({
        ...premultiplied,
        vertexShader: showVert,
        fragmentShader: showFrag,
        uniforms: { uTex: { value: target.texture } },
      }),
    );
    show.frustumCulled = false;
    show.renderOrder = 14; // over the scene, under the dips to black (15)
    show.visible = false;
    const cam = new THREE.Camera();
    const clear = new THREE.Color();
    // a nested render, as three's Reflector does: trace the clouds, then hand the target back
    show.onBeforeRender = (gl, _scene, camera) => {
      const u = material.uniforms;
      u.uInvProj.value.copy(camera.projectionMatrixInverse);
      u.uCamWorld.value.copy(camera.matrixWorld);
      u.uCam.value.setFromMatrixPosition(camera.matrixWorld);
      const prev = gl.getRenderTarget();
      const alpha = gl.getClearAlpha();
      gl.getClearColor(clear);
      gl.setRenderTarget(target);
      gl.setClearColor(0x000000, 0);
      gl.clear(true, false, false);
      gl.render(scene, cam);
      gl.setClearColor(clear, alpha);
      gl.setRenderTarget(prev);
    };
    return { material, quad, scene, target, show };
  }, []);
  useEffect(
    () => () => {
      pass.quad.geometry.dispose();
      pass.material.dispose();
      pass.target.dispose();
      pass.show.geometry.dispose();
      pass.show.material.dispose();
    },
    [pass],
  );
  // compile the cloud tracer up front: compiling it on first sight would hitch the climb
  useEffect(() => {
    gl.compileAsync(pass.scene, new THREE.Camera()).catch(() => undefined);
  }, [gl, pass]);
  useEffect(() => {
    pass.target.setSize(Math.max(1, Math.round(size.width * dpr * SCALE)), Math.max(1, Math.round(size.height * dpr * SCALE)));
  }, [pass, size, dpr]);

  // the zoom-out's clock, ahead of everything that reads it (a negative priority runs first
  // without taking over rendering)
  useFrame((_, dt) => stepAscent(dt), -1);

  useFrame(({ camera }, dt) => {
    const u = pass.material.uniforms;
    const c = ascentClouds(sceneState.ascent.u);
    // nothing to draw before the first deck is near or once the veil has fully parted
    const height = camera.position.y - PROJECTS_ORIGIN[1];
    pass.show.visible =
      sceneState.ascent.active && (c.decks > 0 ? height > CLOUD_DECKS[0] - 6 : c.open < 1);
    if (!pass.show.visible) return;
    u.uTime.value += dt;
    u.uDecksOn.value = c.decks;
    u.uVeil.value = c.veil;
    u.uOpen.value = c.open;
    u.uZoom.value = c.zoom;
    u.uAspect.value = size.width / size.height;
    u.uTint.value.set(projects[useApp.getState().activeProject].tint);
  });

  return <primitive object={pass.show} />;
}
