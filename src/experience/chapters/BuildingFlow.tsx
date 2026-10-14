"use client";

import { useGLTF } from "@react-three/drei";
import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { FLOW_ORIGIN } from "@/lib/chapters";
import { sceneState } from "@/lib/sceneState";
import { useApp } from "@/store/useApp";
import { palette } from "../palette";

export const BUILDING_URL = "/models/building.glb";

// Showcase Bay Coordinates (aligned with actual vitrine positions at x = ±4.4, y = 2.4, z = -7 / -17 / -27)
const SHOWCASE_CAMERAS: { pos: [number, number, number]; look: [number, number, number] }[] = [
  // 01 School System (Bay 1 Left)
  { pos: [-0.95, 2.38, -4.4], look: [-4.4, 2.28, -7.0] },
  // 02 Legal Workspace (Bay 1 Right)
  { pos: [0.95, 2.38, -4.4], look: [4.4, 2.28, -7.0] },
  // 03 LUXE (Bay 2 Left)
  { pos: [-0.95, 2.38, -14.4], look: [-4.4, 2.28, -17.0] },
  // 04 GoldOS (Bay 2 Right)
  { pos: [0.95, 2.38, -14.4], look: [4.4, 2.28, -17.0] },
  // 05 VYRO (Bay 3 Left)
  { pos: [-0.95, 2.38, -24.4], look: [-4.4, 2.28, -27.0] },
  // 06 HealthHub (Bay 3 Right)
  { pos: [0.95, 2.38, -24.4], look: [4.4, 2.28, -27.0] },
];

const SHOWCASE_SLUGS = [
  "school-system",
  "legal-workspace",
  "luxe",
  "goldos",
  "vyro",
  "healthhub",
];

const SHOWCASE_IDS = ["01", "02", "03", "04", "05", "06"];

const plazaVert = /* glsl */ `
  varying vec3 vLocalPos;
  void main() {
    vLocalPos = position;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const plazaFrag = /* glsl */ `
  varying vec3 vLocalPos;

  void main() {
    // ReflectivePlaza node is translated to (0, -0.42, 22) in flow space
    float wx = vLocalPos.x;
    float wz = vLocalPos.z + 22.0;

    // Staggered architectural obsidian tile grid (matching building_exterior.png)
    float row = floor(wz * 0.55);
    float brickX = wx * 0.25 + mod(row, 2.0) * 0.5;
    float brickZ = wz * 0.55;

    vec2 f = abs(fract(vec2(brickX, brickZ) - 0.5) - 0.5);
    vec2 df = fwidth(vec2(brickX, brickZ));
    vec2 grid2 = 1.0 - smoothstep(df * 0.6, df * 2.1, f);
    float line = max(grid2.x, grid2.y);

    // Subtle dark obsidian tile variation
    float tileHash = fract(sin(floor(brickX) * 12.9898 + row * 78.233) * 43758.5453);
    vec3 baseTile = mix(vec3(0.008, 0.011, 0.016), vec3(0.013, 0.018, 0.026), tileHash);
    vec3 mortarCol = vec3(0.16, 0.27, 0.42);

    // Distance fade for grid lines
    float distFade = 1.0 - smoothstep(18.0, 44.0, length(vec2(wx * 0.65, wz - 18.0)));
    vec3 col = mix(baseTile, mortarCol, line * 0.78 * distFade);

    // Planar wet-obsidian specular reflection streaks projected along camera-to-uplight sightlines
    // so reflection streaks are vertical on screen directly beneath each column uplight (like building_exterior.png)
    float camZ = 33.5;
    float lightZ = 2.2;
    float rayX = wx * ((camZ - lightZ) / max(camZ - wz, 3.5));

    float zMask = smoothstep(7.5, 9.8, wz) * (1.0 - smoothstep(24.0, 33.0, wz));

    // Central portal & Enter disc reflection column at x = 0
    float portalStreak = exp(- (rayX * rayX) / 0.55) * zMask * exp(-max(0.0, wz - 11.5) * 0.10);
    float enterHalo = exp(- (wx * wx * 0.9 + (wz - 11.2) * (wz - 11.2) * 1.4));
    col += vec3(1.0, 0.92, 0.78) * (portalStreak * 0.42 + enterHalo * 0.52);

    // 8 Colonnade uplight reflection streaks at x = ±5, ±10, ±16, ±22
    float absRayX = abs(rayX);
    float colReflections = 0.0;
    colReflections += exp(- ((absRayX - 5.0) * (absRayX - 5.0)) / 0.11);
    colReflections += exp(- ((absRayX - 10.0) * (absRayX - 10.0)) / 0.11);
    colReflections += exp(- ((absRayX - 16.0) * (absRayX - 16.0)) / 0.13);
    colReflections += exp(- ((absRayX - 22.0) * (absRayX - 22.0)) / 0.16);

    float streakZ = smoothstep(8.2, 10.2, wz) * exp(-max(0.0, wz - 11.0) * 0.13);
    col += vec3(1.0, 0.95, 0.85) * colReflections * streakZ * 0.62;

    // Subtle column shaft dark/light rhythm reflected on the wet floor
    float colRhythm = sin(rayX * 1.9) * 0.5 + 0.5;
    col += vec3(0.015, 0.022, 0.032) * colRhythm * zMask * distFade;

    // Outer plaza horizon fade into background
    float edgeFade = 1.0 - smoothstep(28.0, 45.0, length(vec2(wx * 0.65, wz - 16.0)));
    col = mix(vec3(0.005, 0.006, 0.008), col, edgeFade);

    gl_FragColor = vec4(col, 1.0);
  }
`;

/**
 * Injects calibrated linear-space architectural lighting into ObsidianStone, ClassicalLimestone,
 * and NeroMarquinaMarble so the 54m colonnade, pediment, rotunda, 6 wall niches,
 * barrel vault, and mirror marble floor match the Blender Eevee renders (`building_exterior.png`
 * and `building_interior.png`) without exceeding WebGL light uniform limits.
 */
function enhanceArchitecturalMaterial(mat: THREE.MeshStandardMaterial, isMarbleFloor = false) {
  mat.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace(
        "#include <common>",
        /* glsl */ `
        #include <common>
        varying vec3 vFlowPos;
        varying vec3 vFlowWorldNorm;
        `,
      )
      .replace(
        "#include <worldpos_vertex>",
        /* glsl */ `
        #include <worldpos_vertex>
        vec4 flowWorldPosition = modelMatrix * vec4(transformed, 1.0);
        vFlowPos = flowWorldPosition.xyz - vec3(0.0, 0.0, -480.0);
        vFlowWorldNorm = normalize(mat3(modelMatrix) * objectNormal);
        `,
      );

    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        /* glsl */ `
        #include <common>
        varying vec3 vFlowPos;
        varying vec3 vFlowWorldNorm;

        vec3 evalArchPoint(vec3 p, vec3 n, vec3 lPos, vec3 lCol, float radius, float strength) {
          vec3 toL = lPos - p;
          float d = length(toL);
          vec3 dir = toL / max(d, 0.001);
          float ndl = max(dot(n, dir), 0.0) * 0.72 + 0.28;
          float att = exp(- (d * d) / (radius * radius));
          return lCol * (ndl * att * strength);
        }
        `,
      )
      .replace(
        "#include <emissivemap_fragment>",
        /* glsl */ `
        #include <emissivemap_fragment>
        {
          vec3 p = vFlowPos;
          vec3 n = normalize(vFlowWorldNorm);
          vec3 archLight = vec3(0.0);

          // MainFacadeWalls front face is at p.z = -0.7..+4.0; interior gallery begins at p.z < -1.25
          if (p.z > -1.25) {
            // --- EXTERIOR ARCHITECTURE (Portico, Wings, Pediment, Facade Wall, Steps, Rotunda) ---
            // 1. Calibrated linear-space Moonlight key & night sky ambient (dark obsidian charcoal tone)
            vec3 moonDir = normalize(vec3(-0.38, 0.62, 0.68));
            float moonNdl = max(dot(n, moonDir), 0.0);
            float rimNdl = max(dot(n, normalize(vec3(0.45, 0.35, 0.82))), 0.0);
            archLight += vec3(0.010, 0.012, 0.016) + vec3(0.036, 0.042, 0.052) * moonNdl + vec3(0.012, 0.015, 0.020) * rimNdl;

            // 2. Pediment raking cornice, dentil molding & portico soffit uplight
            float pedHighlight = smoothstep(6.2, 11.5, p.y) * exp(- (p.x * p.x) / 65.0);
            archLight += vec3(0.034, 0.040, 0.050) * pedHighlight * (max(n.z, 0.0) * 0.6 + abs(n.y) * 0.4);

            // Soft central portico ceiling soffit glow above doorway (matching building_exterior.png)
            if (p.y > 6.8 && p.y < 7.8 && abs(p.x) < 2.4 && p.z > -0.5 && p.z < 4.2) {
              float soffitSpot = exp(- (p.x * p.x) / 1.4 - ((p.z - 2.2) * (p.z - 2.2)) / 2.2);
              archLight += vec3(0.48, 0.49, 0.52) * soffitSpot * max(-n.y, 0.25);
            }

            // 3. Warm Golden Portal Spill flooding out of central doorway (0, 2.8, 0.2) onto facade back wall & columns
            if (p.y > 0.85) {
              archLight += evalArchPoint(p, n, vec3(0.0, 2.8, 0.4), vec3(1.0, 0.90, 0.74), 6.2, 0.46);
              archLight += evalArchPoint(p, n, vec3(0.0, 4.8, 1.6), vec3(0.95, 0.92, 0.86), 5.5, 0.22);
            }

            // 4. 8 Colonnade Base Grazing Uplights at x = ±5, ±10, ±16, ±22 along the peristyle
            if (p.y > 0.85 && p.z < 4.2) {
              float absX = abs(p.x);
              for (int i = 0; i < 4; i++) {
                float ux = (i == 0) ? 5.0 : (i == 1) ? 10.0 : (i == 2) ? 16.0 : 22.0;
                float uz = (i == 0) ? 2.6 : 1.3;
                vec3 uPos = vec3(ux, 1.05, uz);
                vec3 pSym = vec3(absX, p.y, p.z);
                vec3 nSym = vec3(abs(n.x), n.y, n.z);
                archLight += evalArchPoint(pSym, nSym, uPos, vec3(1.0, 0.93, 0.80), 3.4, 0.30);
              }
            }

            // 5. East Wing Classical Rotunda Pavilion Uplight (x = 25.2, z = 1.2)
            archLight += evalArchPoint(p, n, vec3(25.2, 4.2, 2.6), vec3(0.85, 0.91, 1.0), 7.5, 0.16);

            // 6. Ceremonial Steps: crisp horizontal tread & riser contrast with aligned reflection catch-lights
            if (p.z > 3.6 && p.y < 1.35) {
              float isTread = step(0.6, n.y);
              float absX = abs(p.x);
              float stepCatch = exp(- (p.x * p.x) / 1.5);
              stepCatch += 0.72 * exp(- ((absX - 5.0) * (absX - 5.0)) / 0.35);
              stepCatch += 0.62 * exp(- ((absX - 10.0) * (absX - 10.0)) / 0.45);
              float nosing = smoothstep(0.0, 1.0, fract(p.y / 0.16));
              archLight += vec3(0.95, 0.90, 0.80) * stepCatch * (isTread * 0.24 + (1.0 - isTread) * 0.07 * nosing);
            }
          } else {
            // --- INTERIOR GRAND EXHIBITION GALLERY (z from -1.25 to -37) ---
            // 1. Central Skylight & Coffered Barrel Vault Downwash along the 36m nave
            float skylightDist = abs(p.x);
            float skyStrip = exp(- (skylightDist * skylightDist) / 11.0) * smoothstep(4.2, 9.5, p.y);
            archLight += vec3(0.26, 0.30, 0.36) * skyStrip;

            // Museum gallery architectural fill with subtle coffered rib rhythm
            float ribRhythm = 0.88 + 0.12 * cos(p.z * 2.513);
            archLight += vec3(0.038, 0.043, 0.052) * ribRhythm * (abs(n.x) * 0.45 + abs(n.y) * 0.35 + 0.2);

            // 2. 6 Warm Arched Wall Niche Uplights & Showcase Spotlights at z = -7, -17, -27
            float absX = abs(p.x);
            for (int b = 0; b < 3; b++) {
              float bz = (b == 0) ? -7.0 : (b == 1) ? -17.0 : -27.0;
              vec3 pSym = vec3(absX, p.y, p.z);
              vec3 nSym = vec3(abs(n.x), n.y, n.z);
              // Warm wall niche grazing uplight at x = ±7.1
              archLight += evalArchPoint(pSym, nSym, vec3(7.0, 2.2, bz), vec3(1.0, 0.93, 0.82), 4.4, 0.30);
              // Pilaster flank grazing streaks at bz ± 2.3
              float pilGlow = exp(- ((absX - 7.2) * (absX - 7.2)) / 0.6 - ((abs(p.z - bz) - 2.2) * (abs(p.z - bz) - 2.2)) / 0.4) * smoothstep(6.0, 1.2, p.y);
              archLight += vec3(0.95, 0.90, 0.82) * pilGlow * 0.26;
              // Showcase pedestal spotlight at x = ±4.4
              archLight += evalArchPoint(pSym, nSym, vec3(4.1, 3.6, bz), vec3(0.95, 0.97, 1.0), 3.6, 0.26);
            }

            // 3. Rose Window Celestial Backlight at z = -37
            archLight += evalArchPoint(p, n, vec3(0.0, 5.5, -35.8), vec3(0.75, 0.88, 1.0), 9.5, 0.34);

            ${
              isMarbleFloor
                ? /* glsl */ `
            // 4. Polished Nero Marquina Marble Floor Planar Reflections (matching building_interior.png)
            if (n.y > 0.8) {
              archLight *= 0.32;

              // Rose Window circular reflection on the central marble aisle
              vec2 rwUv = vec2(p.x / 3.4, (p.z + 20.5) / 5.2);
              float rwR = length(rwUv);
              float rwDisc = (1.0 - smoothstep(0.82, 1.04, rwR)) * smoothstep(-35.0, -24.0, p.z);
              float rwAng = atan(rwUv.y, rwUv.x);
              float spokes = 0.88 + 0.12 * cos(rwAng * 12.0);
              archLight += vec3(0.84, 0.93, 1.0) * rwDisc * spokes * 0.62;

              // Central glass skylight reflection runner + arch rib reflections
              float skyRefl = exp(- (p.x * p.x) / 2.6) * (0.09 + 0.045 * cos(p.z * 1.256));
              archLight += vec3(0.78, 0.86, 0.98) * skyRefl;

              // 6 Glowing Vitrine & Kiosk reflections along left & right aisles (x = ±4.4, z = -7, -17, -27)
              for (int b = 0; b < 3; b++) {
                float bz = (b == 0) ? -7.0 : (b == 1) ? -17.0 : -27.0;
                float vitRefl = exp(- ((abs(p.x) - 4.2) * (abs(p.x) - 4.2)) / 1.1 - ((p.z - bz) * (p.z - bz)) / 2.8);
                vec3 bCol = (b == 0) ? vec3(0.68, 0.86, 1.0) : (b == 1) ? vec3(0.95, 0.88, 0.68) : vec3(0.48, 0.92, 0.82);
                archLight += bCol * vitRefl * 0.30;
              }
            }
            `
                : ""
            }
          }

          totalEmissiveRadiance += archLight;
        }
        `,
      );
  };
  mat.customProgramCacheKey = () => (isMarbleFloor ? "flow-marble-v3" : "flow-stone-v3");
  mat.needsUpdate = true;
}

export default function BuildingFlow() {
  const group = useRef<THREE.Group>(null);
  const animatedNodes = useRef<THREE.Object3D[]>([]);
  const pickTargets = useRef<{ mesh: THREE.Mesh; code: number }[]>([]);
  const mode = useApp((s) => s.mode);
  const flowView = useApp((s) => s.flowView);
  const flowFocus = useApp((s) => s.flowFocus);
  const isMobile = useApp((s) => s.isMobile);

  const threeScene = useThree((s) => s.scene);
  const camera = useThree((s) => s.camera);

  const { scene } = useGLTF(BUILDING_URL, "/draco/");

  const plazaMat = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader: plazaVert,
        fragmentShader: plazaFrag,
      }),
    [],
  );

  // Minimal dynamic Three.js lights (1 Hemisphere + 1 Directional) for brass/gold/artifact speculars
  const lights = useMemo(() => {
    const moonKey = new THREE.DirectionalLight("#dceaff", 1.8);
    moonKey.position.set(-14, 24, 28);
    moonKey.target.position.set(0, 3.5, -6);
    return { moonKey };
  }, []);

  useEffect(
    () => () => {
      plazaMat.dispose();
    },
    [plazaMat],
  );

  // Prepare scene materials, replace PlazaGrid with custom shader, and register interactive meshes
  useEffect(() => {
    if (!scene) return;
    const anim: THREE.Object3D[] = [];
    const picks: { mesh: THREE.Mesh; code: number }[] = [];
    const enhancedMats = new Set<THREE.Material>();

    scene.traverse((child) => {
      if ((child as THREE.Mesh).isMesh) {
        const mesh = child as THREE.Mesh;
        mesh.castShadow = false;
        mesh.receiveShadow = false;

        // Hide PlazaHaze, Label_LOBBY, and Plaque_01..06 (which overlapped the 3D brass pedestal titles)
        if (
          mesh.name.startsWith("PlazaHaze") ||
          mesh.name === "Label_LOBBY" ||
          mesh.name.startsWith("Plaque_")
        ) {
          mesh.visible = false;
          return;
        }

        if (mesh.name === "ReflectivePlaza") {
          mesh.material = plazaMat;
        } else if (mesh.name === "GalleryApseGlass") {
          // Make the Rose Window backlit disc luminous warm-ivory white (matching building_exterior.png & building_interior.png)
          const apseMat = (mesh.material as THREE.MeshStandardMaterial).clone();
          apseMat.color.set("#fffdf8");
          apseMat.emissive.set("#fffaf0");
          apseMat.emissiveIntensity = 3.2;
          mesh.material = apseMat;
        } else {
          const mat = mesh.material as THREE.MeshStandardMaterial;
          if (mat && mat.isMeshStandardMaterial && !enhancedMats.has(mat)) {
            enhancedMats.add(mat);
            if (mat.name === "ObsidianStone" || mat.name === "ClassicalLimestone") {
              mat.envMapIntensity = 0.04;
              enhanceArchitecturalMaterial(mat, false);
            } else if (mat.name === "NeroMarquinaMarble") {
              mat.envMapIntensity = 0.08;
              mat.roughness = 0.08;
              enhanceArchitecturalMaterial(mat, true);
            } else if (mat.name === "ArchitecturalBrass" || mat.name === "PureGold") {
              mat.envMapIntensity = 0.65;
            } else if (mat.name === "GlassVitrine") {
              mat.transparent = true;
              mat.opacity = 0.14;
              mat.depthWrite = false;
              mat.envMapIntensity = 0.35;
              mat.needsUpdate = true;
            }
          }
        }

        // Collect 3D showcase artifacts for continuous gentle rotation
        if (mesh.name.startsWith("Artifact_")) {
          anim.push(mesh);
        }

        // Register portal / Enter button for clicking in Exterior mode (code 99)
        if (
          mesh.name === "PlazaEnterButton" ||
          mesh.name === "PortalGlowFrame" ||
          mesh.name === "PortalDoorFrame" ||
          mesh.name === "PortalSilhouetteFigure"
        ) {
          picks.push({ mesh, code: 99 });
        }

        // Register showcase plinths, vitrines, artifacts, and kiosks (codes 0..5)
        for (let i = 0; i < SHOWCASE_IDS.length; i++) {
          const id = SHOWCASE_IDS[i];
          const slug = SHOWCASE_SLUGS[i];
          if (
            mesh.name.includes(`_${id}`) ||
            mesh.name.includes(`_${slug}`)
          ) {
            picks.push({ mesh, code: i });
            break;
          }
        }
      }
    });

    animatedNodes.current = anim;
    pickTargets.current = picks;
  }, [scene, plazaMat]);

  // Raycast picker so clicking the portal enters the hall and clicking a showcase inspects it
  const raycaster = useMemo(() => new THREE.Raycaster(), []);
  const ndc = useMemo(() => new THREE.Vector2(), []);

  useEffect(() => {
    sceneState.flow.pick = (x: number, y: number) => {
      if (!group.current?.visible) return -1;
      ndc.set(x, y);
      raycaster.setFromCamera(ndc, camera);
      const meshes = pickTargets.current.map((p) => p.mesh);
      const hits = raycaster.intersectObjects(meshes, false);
      if (!hits.length) return -1;
      const hitMesh = hits[0].object as THREE.Mesh;
      const match = pickTargets.current.find((p) => p.mesh === hitMesh);
      return match ? match.code : -1;
    };
    return () => {
      sceneState.flow.pick = () => -1;
      sceneState.flow.active = false;
    };
  }, [camera, raycaster, ndc]);

  // Restore default fog when leaving /flow
  useEffect(() => {
    if (mode !== "flow") {
      const fog = threeScene.fog as THREE.FogExp2 | null;
      if (fog && fog.isFogExp2) {
        fog.density = 0.045;
        fog.color.copy(palette.fog);
      }
    }
  }, [mode, threeScene]);

  // Synchronize camera target positions, fog density, and artifact rotation
  useFrame((_, dt) => {
    const isFlowMode = mode === "flow";
    sceneState.flow.active = isFlowMode;

    if (group.current) {
      group.current.visible = isFlowMode;
    }
    if (!isFlowMode) return;

    // Adjust scene fog density so the 54m colonnade, rotunda, and 36m hall read with depth
    const fog = threeScene.fog as THREE.FogExp2 | null;
    if (fog && fog.isFogExp2) {
      const targetDensity = flowView === "exterior" ? 0.005 : 0.0035;
      fog.density = THREE.MathUtils.damp(fog.density, targetDensity, 4, Math.min(dt, 0.1));
    }

    // Rotate showcase centerpieces gently around their local vertical axis
    const rotSpeed = Math.min(dt, 0.1) * 0.55;
    for (const ob of animatedNodes.current) {
      ob.rotation.y += rotSpeed;
    }

    const [ox, oy, oz] = FLOW_ORIGIN;
    const mouseX = sceneState.mouse.x * (isMobile ? 0.15 : 0.65);
    const mouseY = sceneState.mouse.y * (isMobile ? 0.1 : 0.35);
    const pan = sceneState.flow.pan;
    const tilt = sceneState.flow.tilt;
    const walk = sceneState.flow.walk;

    if (flowView === "exterior") {
      // Wide exterior establishing shot framing "THE STUDIO", full pediment, colonnade wings, rotunda & obsidian plaza
      const camZ = isMobile ? 37.5 : 33.5;
      sceneState.flow.pos = [
        ox + pan * 8.0 + mouseX * 1.2,
        oy + 1.95 + tilt * 2.0 + mouseY * 0.4,
        oz + camZ,
      ];
      sceneState.flow.look = [
        ox + pan * 14.0 + mouseX * 1.8,
        oy + 4.8 + tilt * 3.5 + mouseY * 0.55,
        oz + 1.0,
      ];
    } else if (flowView === "hall") {
      // Positioned at z = -2.4 (in front of PortalSilhouetteFigure at z = -1.65), looking down the 36m nave
      sceneState.flow.pos = [
        ox + pan * 1.6 + mouseX * 0.45,
        oy + 2.15 + tilt * 0.8 + mouseY * 0.25,
        oz - 2.4 - walk,
      ];
      sceneState.flow.look = [
        ox + pan * 5.5 + mouseX * 0.9,
        oy + 2.65 + tilt * 2.2 + mouseY * 0.35,
        oz - 23.5 - walk * 0.55,
      ];
    } else if (flowView === "showcase" && flowFocus !== null) {
      const cfg = SHOWCASE_CAMERAS[flowFocus] || SHOWCASE_CAMERAS[0];
      sceneState.flow.pos = [
        ox + cfg.pos[0] + pan * 0.45 + mouseX * 0.18,
        oy + cfg.pos[1] + tilt * 0.35 + mouseY * 0.12,
        oz + cfg.pos[2] + pan * 0.35,
      ];
      sceneState.flow.look = [
        ox + cfg.look[0],
        oy + cfg.look[1] + tilt * 0.25,
        oz + cfg.look[2],
      ];
    }
  });

  return (
    <group ref={group} position={FLOW_ORIGIN} visible={false}>
      {/* Sky / Ground Architectural Hemisphere Fill */}
      <hemisphereLight args={["#b8d0f0", "#16141c", 0.85]} />

      {/* Directional Moonlight Key (with target mounted in local space) */}
      <primitive object={lights.moonKey} />
      <primitive object={lights.moonKey.target} />

      {/* The Exported Architecture & Gallery Model */}
      <primitive object={scene} />
    </group>
  );
}

useGLTF.preload(BUILDING_URL, "/draco/");
