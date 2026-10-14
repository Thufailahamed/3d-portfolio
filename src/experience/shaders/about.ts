/** Full-screen dip to black (hides the cuts between scenes). */
export const fadeVert = /* glsl */ `
void main(){ gl_Position = vec4(position.xy * 2.0, 0.0, 1.0); }`;

export const fadeFrag = /* glsl */ `
uniform float uOpacity;
uniform vec3 uColor;
void main(){ gl_FragColor = vec4(uColor, uOpacity); }`;
