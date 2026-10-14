/**
 * The river in the projects scene (local units; the crystal's rock sits at the origin).
 * It leaves the mountain saddle, widens into a pool around the rock, then runs past the camera.
 * JS and GLSL versions must stay identical: the dune is masked on the CPU, the water/ground on the GPU.
 */
export const riverX = (z: number) => -1.4 * Math.sin(z * 0.11);

export const riverHalfWidth = (z: number) => {
  const t = Math.min(1, Math.max(0, (z + 16) / 12));
  const narrow = 0.9 + 0.5 * t * t * (3 - 2 * t);
  return narrow + 1.9 * Math.exp(-(z * z) / 14) + 0.18 * Math.sin(z * 1.3) + 0.12 * Math.sin(z * 2.9 + 1);
};

/** Signed distance-ish to the bank: > 0 inside the water. */
export const riverInside = (x: number, z: number) => riverHalfWidth(z) - Math.abs(x - riverX(z));

export const riverGlsl = /* glsl */ `
float riverX(float z){ return -1.4 * sin(z * 0.11); }
float riverHalfWidth(float z){
  float narrow = 0.9 + 0.5 * smoothstep(-16.0, -4.0, z);
  return narrow + 1.9 * exp(-(z * z) / 14.0) + 0.18 * sin(z * 1.3) + 0.12 * sin(z * 2.9 + 1.0);
}
float riverInside(vec2 p){ return riverHalfWidth(p.y) - abs(p.x - riverX(p.y)); }
`;
