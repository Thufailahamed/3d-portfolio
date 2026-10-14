import { useFrame } from "@react-three/fiber";
import { useRef } from "react";
import * as THREE from "three";
import { sceneState } from "@/lib/sceneState";

/** Shared by every material that uses `cursorGlsl` (spread into its uniforms). */
export const cursorUniforms = {
  uRayO: { value: new THREE.Vector3() },
  uRayD: { value: new THREE.Vector3(0, 0, -1) },
  uHover: { value: 0 },
};

const raycaster = new THREE.Raycaster();
const ndc = new THREE.Vector2();

/** Keeps the cursor ray up to date: smoothed so the scene trails the pointer, stronger while it moves. */
export function useCursorRay() {
  const s = useRef({ x: 0, y: 0, px: 0, py: 0, energy: 0 });

  useFrame(({ camera }, dt) => {
    const st = s.current;
    const { x, y } = sceneState.mouse;
    const k = Math.min(1, dt * 7);
    st.x += (x - st.x) * k;
    st.y += (y - st.y) * k;

    const speed = Math.hypot(x - st.px, y - st.py) / Math.max(dt, 1e-3);
    st.px = x;
    st.py = y;
    // rise quickly with movement, settle slowly back to a gentle resting presence
    const target = 0.4 + 0.6 * Math.min(1, speed * 0.6);
    st.energy += (target - st.energy) * Math.min(1, dt * (target > st.energy ? 6 : 1.4));

    ndc.set(st.x, st.y);
    raycaster.setFromCamera(ndc, camera);
    cursorUniforms.uRayO.value.copy(raycaster.ray.origin);
    cursorUniforms.uRayD.value.copy(raycaster.ray.direction);
    cursorUniforms.uHover.value = st.energy;
  });
}
