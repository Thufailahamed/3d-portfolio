/** The faint starfield behind the globe. World space, additive. */
export const starVert = /* glsl */ `
uniform float uTime;
uniform float uPixelRatio;
uniform float uSize;
attribute float aSeed;
varying float vAlpha;
void main(){
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vAlpha = 0.45 + 0.55 * sin(uTime * (0.6 + aSeed * 1.8) + aSeed * 50.0);
  gl_PointSize = uSize * (0.6 + aSeed) * uPixelRatio;
  gl_Position = projectionMatrix * mv;
}`;

export const starFrag = /* glsl */ `
uniform vec3 uColor;
uniform float uOpacity;
varying float vAlpha;
void main(){
  float d = length(gl_PointCoord - 0.5);
  gl_FragColor = vec4(uColor * smoothstep(0.5, 0.0, d) * vAlpha * uOpacity, 1.0);
}`;
