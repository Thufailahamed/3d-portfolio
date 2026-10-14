/**
 * Cursor influence for the projects scene. The cursor is a world-space ray (uRayO, uRayD);
 * points near it are nudged away and lit up. Radius and push grow with distance along the ray
 * so the effect covers about the same patch of screen near and far. Needs `uniform float uTime` declared first.
 */
export const cursorGlsl = /* glsl */ `
uniform vec3 uRayO;
uniform vec3 uRayD;
uniform float uHover;

// world-space offset for point w; strength is 0..1 for brightening
vec3 cursorPush(vec3 w, float amount, out float strength){
  vec3 rel = w - uRayO;
  float t = max(dot(rel, uRayD), 0.0);
  vec3 perp = rel - uRayD * t;
  float d = length(perp);
  float r = 0.075 * t + 0.15;
  float f = exp(-(d * d) / (r * r)) * uHover;
  strength = f;
  vec3 dir = perp / max(d, 1e-3);
  // a slow breathing ripple keeps it alive while the cursor rests
  float wave = 1.0 + 0.25 * sin(uTime * 2.2 - d / r * 3.0);
  return (dir * 0.7 + vec3(0.0, 0.45, 0.0)) * f * wave * amount * (0.03 * t + 0.05);
}
`;
