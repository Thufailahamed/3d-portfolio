import { snoise3 } from "./noise";

/** Vertex shader for the celestial sky dome */
export const skyDomeVert = /* glsl */ `
  varying vec3 vWorldDir;

  void main() {
    // Normalizing position on a unit sphere gives the sky direction vector
    vWorldDir = normalize(position);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

/** Fragment shader rendering deep-space nebulae, Milky Way galaxy band, and spiral galaxy */
export const skyDomeFrag = /* glsl */ `
  varying vec3 vWorldDir;
  uniform float uTime;

  ${snoise3}

  // 4-octave fractional brownian motion
  float fbm(vec3 p) {
    float val = 0.0;
    float amp = 0.52;
    for (int i = 0; i < 4; i++) {
      val += amp * (snoise(p) * 0.5 + 0.5);
      p = p * 2.18 + vec3(1.3, 2.7, 4.1);
      amp *= 0.5;
    }
    return val;
  }

  void main() {
    vec3 dir = normalize(vWorldDir);

    // Deep space void gradient: pitch-black at horizon, rich deep midnight obsidian towards zenith
    float elevation = clamp(dir.y, 0.0, 1.0);
    vec3 spaceVoid = mix(vec3(0.003, 0.004, 0.007), vec3(0.012, 0.016, 0.030), pow(elevation, 1.3));

    // =========================================================================
    // 1. MILKY WAY / GALACTIC DUST BAND
    // Sweeps diagonally across the upper sky above the portico
    // =========================================================================
    vec3 galNormal = normalize(vec3(-0.42, 0.70, 0.58));
    float galDist = dot(dir, galNormal);

    // Dynamic slow drift
    vec3 drift = vec3(0.0, uTime * 0.004, 0.0);

    // Warp the galactic plane with noise for realistic gaseous tendrils
    float warp = snoise(dir * 2.8 + drift) * 0.14;
    float bandCore = exp(-pow((galDist + warp) * 3.4, 2.0));
    float bandHalo = exp(-pow((galDist + warp * 0.6) * 1.5, 2.0)) * 0.45;
    float band = bandCore + bandHalo;

    // Detailed nebula gas filaments and dust rifts
    float dust = fbm(dir * 5.8 + drift);
    float fineDust = fbm(dir * 14.2);
    float darkRift = 1.0 - 0.72 * smoothstep(0.42, 0.72, fbm(dir * 10.5 + vec3(3.2, 1.5, 4.8))) * exp(-pow(galDist * 7.5, 2.0));

    // Cosmic gas emission colors:
    // - Core stellar light: warm cream / starlight white
    // - H-II ionization regions: vibrant magenta / violet
    // - Reflection gas: cosmic cyan / celestial blue
    // - Ambient interstellar dust: deep indigo
    vec3 colDeepIndigo = vec3(0.08, 0.06, 0.22);
    vec3 colCosmicCyan = vec3(0.18, 0.58, 0.88);
    vec3 colMagentaGas = vec3(0.78, 0.24, 0.62);
    vec3 colStellarCore = vec3(1.15, 1.08, 0.94);

    vec3 galColor = mix(colDeepIndigo, colCosmicCyan, dust);
    galColor = mix(galColor, colMagentaGas, pow(fineDust, 1.8) * 0.85);
    galColor = mix(galColor, colStellarCore, pow(bandCore, 2.4) * (dust * 0.7 + 0.3));
    galColor *= band * darkRift * 1.25;

    // =========================================================================
    // 2. MAJESTIC SPIRAL GALAXY (Andromeda / Whirlpool inspired)
    // Positioned in the upper-right sky above the colonnade
    // =========================================================================
    vec3 spiralCenter = normalize(vec3(0.34, 0.66, -0.67));
    vec3 toSpiral = dir - spiralCenter;

    // Build local coordinate frame tangent to the sphere at spiralCenter
    vec3 gUp = vec3(0.0, 1.0, 0.0);
    vec3 gRight = normalize(cross(gUp, spiralCenter));
    vec3 gTrueUp = cross(spiralCenter, gRight);

    float sx = dot(toSpiral, gRight);
    float sy = dot(toSpiral, gTrueUp);

    // Inclination rotation: view the galaxy disk at a 42-degree angle (beautiful oval spiral)
    float tiltCos = cos(0.72);
    float tiltSin = sin(0.72);
    float rx = sx * tiltCos - sy * tiltSin;
    float ry = (sx * tiltSin + sy * tiltCos) / 0.52; // 0.52 aspect ratio compression for 3D tilt

    float sr = length(vec2(rx, ry));
    float sTheta = atan(ry, rx);

    vec3 spiralColor = vec3(0.0);
    if (sr < 0.42) {
      // Dual logarithmic spiral arms: r = a * exp(b * theta)
      float armAngle = sTheta * 2.0 - 4.8 * log(sr * 16.0 + 1.0);
      float armPattern = pow(cos(armAngle) * 0.5 + 0.5, 3.2);

      // Star clumping and turbulent gas along the spiral arms
      float armNoise = fbm(vec3(rx * 38.0, ry * 38.0, 2.5));
      float spiralArms = armPattern * (0.55 + 0.75 * armNoise);

      // Glowing galactic nucleus (intense central bulge with bloom)
      float nucleus = exp(-sr * 32.0) * 2.2 + exp(-sr * 12.0) * 0.85;

      // Outer galactic halo fade
      float halo = smoothstep(0.42, 0.03, sr);

      // Color palette for the spiral galaxy:
      // Golden luminous nucleus, electric violet inner arms, vivid turquoise-cyan outer knots
      vec3 coreCol = vec3(1.4, 1.32, 1.08); // Exceeds 1.0 for bloom!
      vec3 innerCol = vec3(0.85, 0.42, 0.98);
      vec3 outerCol = vec3(0.28, 0.82, 1.15);

      vec3 sCol = mix(innerCol, outerCol, smoothstep(0.04, 0.28, sr));
      sCol = sCol * (spiralArms * 1.5 + 0.15) * halo;
      sCol += coreCol * nucleus * halo;

      // Dark dust ring between core and arms
      float dustLane = 1.0 - 0.65 * exp(-pow((sr - 0.055) * 45.0, 2.0));
      spiralColor = sCol * dustLane;
    }

    // =========================================================================
    // 3. SATELLITE DWARF GALAXY (Magellanic Cloud)
    // Upper-left celestial sphere
    // =========================================================================
    vec3 dwarfCenter = normalize(vec3(-0.48, 0.54, -0.69));
    float dDist = length(dir - dwarfCenter);
    vec3 dwarfColor = vec3(0.0);
    if (dDist < 0.28) {
      float dGlow = exp(-pow(dDist / 0.12, 2.0)) * 0.75;
      float dNoise = fbm(dir * 16.0);
      vec3 dTint = mix(vec3(0.42, 0.26, 0.68), vec3(0.22, 0.65, 0.85), dNoise);
      dwarfColor = dTint * dGlow * (dNoise * 0.6 + 0.4);
    }

    // =========================================================================
    // 4. SUB-PIXEL FAINT BACKGROUND STAR DUST (Procedural fine noise)
    // =========================================================================
    float starGrain = fract(sin(dot(dir * 450.0, vec3(12.9898, 78.233, 45.164))) * 43758.5453);
    float faintStars = pow(starGrain, 38.0) * (band * 1.8 + 0.25) * 2.2;
    vec3 faintStarCol = vec3(faintStars * 0.9, faintStars * 0.94, faintStars * 1.1);

    // =========================================================================
    // COMPOSITE AND HORIZON BLEND
    // =========================================================================
    vec3 finalSky = spaceVoid + galColor + spiralColor + dwarfColor + faintStarCol;

    // Atmospheric horizon fade: cleanly dims down to near-black at y <= 0
    // so the sky organically meets the obsidian ground and colonnade base
    float horizonMask = smoothstep(-0.02, 0.22, dir.y);
    finalSky *= horizonMask;

    gl_FragColor = vec4(finalSky, 1.0);
  }
`;

/** Vertex shader for 3D twinkling foreground stars */
export const starsVert = /* glsl */ `
  attribute float aSize;
  attribute vec3 aColor;
  attribute vec3 aTwinkle; // x: speed, y: phase, z: brightness
  varying vec3 vColor;
  varying float vTwinkle;

  uniform float uTime;
  uniform float uPixelRatio;

  void main() {
    vColor = aColor;

    // Natural multi-frequency scintillation (twinkle)
    float speed = aTwinkle.x;
    float phase = aTwinkle.y;
    float baseBright = aTwinkle.z;
    float t = sin(uTime * speed + phase) * 0.5 + 0.5;
    float t2 = cos(uTime * speed * 1.63 + phase * 2.1) * 0.5 + 0.5;
    vTwinkle = baseBright * (0.65 + 0.35 * (t * 0.7 + t2 * 0.3));

    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mvPosition;

    // Size attenuation with screen DPI
    gl_PointSize = aSize * vTwinkle * uPixelRatio * (280.0 / -mvPosition.z);
  }
`;

/** Fragment shader for 3D twinkling foreground stars with diffraction spikes */
export const starsFrag = /* glsl */ `
  varying vec3 vColor;
  varying float vTwinkle;

  void main() {
    vec2 coord = gl_PointCoord - vec2(0.5);
    float dist = length(coord);
    if (dist > 0.5) discard;

    // Gaussian point star core
    float core = exp(-dist * dist * 22.0);

    // Soft stellar glow halo
    float halo = exp(-dist * 5.5) * 0.45;

    // Subtle 4-point cross diffraction flare for the brighter stars
    float crossFlare = 0.0;
    if (vTwinkle > 0.85) {
      float ax = abs(coord.x);
      float ay = abs(coord.y);
      crossFlare = (exp(-ax * 24.0) * exp(-ay * 2.8) + exp(-ay * 24.0) * exp(-ax * 2.8)) * 0.35;
    }

    float intensity = core * 1.35 + halo + crossFlare;
    vec3 col = vColor * intensity * vTwinkle;

    // Center brightness exceeds 1.0 for gorgeous bloom flare
    gl_FragColor = vec4(col, clamp(intensity, 0.0, 1.0));
  }
`;

/** Vertex shader for dynamic shooting stars / meteors */
export const meteorVert = /* glsl */ `
  attribute float aProgress; // 0 at tail, 1 at head
  varying float vProgress;

  void main() {
    vProgress = aProgress;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

/** Fragment shader for dynamic shooting stars / meteors */
export const meteorFrag = /* glsl */ `
  varying float vProgress;
  uniform float uAlpha;

  void main() {
    // Glowing head fading smoothly along the tail
    float glow = pow(vProgress, 2.5);
    vec3 col = mix(vec3(0.55, 0.85, 1.2), vec3(1.3, 1.25, 1.1), vProgress);
    gl_FragColor = vec4(col * glow, glow * uAlpha);
  }
`;
