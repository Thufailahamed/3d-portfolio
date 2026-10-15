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

// Showcase Bay Coordinates (aligned with actual vitrine positions at x = ±4.4, y = 2.38, z = -7 / -17 / -27)
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

// Architectural CAD Blueprint Ground Shader for Exterior Plaza
const plazaVert = /* glsl */ `
  varying vec3 vWorldPos;
  void main() {
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vWorldPos = wp.xyz - vec3(0.0, 0.0, -480.0);
    gl_Position = projectionMatrix * viewMatrix * wp;
  }
`;

const plazaFrag = /* glsl */ `
  varying vec3 vWorldPos;

  void main() {
    float wx = vWorldPos.x;
    float wz = vWorldPos.z;

    // Fade to pure black when inside the hall (wz <= 1.0) so exterior lines never bleed inside
    if (wz < 1.0) {
      gl_FragColor = vec4(0.002, 0.003, 0.005, 1.0);
      return;
    }

    // Void dark blueprint base floor
    vec3 col = vec3(0.002, 0.003, 0.005);

    // 4-meter Architectural CAD grid
    float gridScale = 0.25;
    vec2 f = abs(fract(vec2(wx * gridScale, wz * gridScale) - 0.5) - 0.5);
    vec2 df = fwidth(vec2(wx * gridScale, wz * gridScale));
    vec2 grid2 = 1.0 - smoothstep(df * 0.4, df * 1.8, f);
    float gridLine = max(grid2.x, grid2.y);

    // Grid distance fade towards the horizon
    float dist = length(vec2(wx * 0.55, wz - 12.0));
    float distFade = 1.0 - smoothstep(12.0, 52.0, dist);

    vec3 gridCol = vec3(0.32, 0.38, 0.46);
    col += gridCol * gridLine * 0.40 * distFade;

    // Two bright perspective guide lines leading into the entrance doorway at x = ±1.8
    float pathMask = step(2.4, wz) * (1.0 - smoothstep(22.0, 32.0, wz));
    float pathLineL = 1.0 - smoothstep(0.02, 0.06, abs(wx + 1.8));
    float pathLineR = 1.0 - smoothstep(0.02, 0.06, abs(wx - 1.8));
    col += vec3(0.95, 0.98, 1.0) * (pathLineL + pathLineR) * pathMask * 0.95;

    // Subtle luminous portal threshold glow directly in front of the door (x=0, z=2.4)
    float portalHalo = exp(- (wx * wx * 0.45 + (wz - 2.8) * (wz - 2.8) * 0.55));
    col += vec3(0.90, 0.94, 1.0) * portalHalo * 0.45;

    // Outer edge horizon fade
    float edgeFade = 1.0 - smoothstep(32.0, 55.0, dist);
    col = mix(vec3(0.0), col, edgeFade);

    gl_FragColor = vec4(col, 1.0);
  }
`;

/**
 * 3D Floating Architectural Text Label rendered via high-res Canvas 2D
 */
function ArchitecturalLabel3D({
  text,
  position,
  scale = 1.0,
  opacity = 0.92,
  hasLeader = false,
  leaderTo,
  letterSpacing = 2,
}: {
  text: string;
  position: [number, number, number];
  scale?: number;
  opacity?: number;
  hasLeader?: boolean;
  leaderTo?: [number, number, number];
  letterSpacing?: number;
}) {
  const { texture, aspect } = useMemo(() => {
    if (typeof document === "undefined") {
      return { texture: null, aspect: 1 };
    }
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");
    if (!ctx) return { texture: null, aspect: 1 };

    const fontSize = 140;
    const displayText = text.split("").join(" ".repeat(Math.max(0, letterSpacing)));
    ctx.font = `600 ${fontSize}px "JetBrains Mono", "IBM Plex Mono", monospace`;
    const metrics = ctx.measureText(displayText);
    const pad = 48;
    canvas.width = Math.ceil(metrics.width + pad * 2);
    canvas.height = Math.ceil(fontSize * 1.5 + pad);

    ctx.font = `600 ${fontSize}px "JetBrains Mono", "IBM Plex Mono", monospace`;
    ctx.textBaseline = "middle";
    ctx.textAlign = "center";
    ctx.fillStyle = "#ffffff";
    ctx.fillText(displayText, canvas.width / 2, canvas.height / 2);

    const tex = new THREE.CanvasTexture(canvas);
    tex.minFilter = THREE.LinearFilter;
    tex.magFilter = THREE.LinearFilter;
    return { texture: tex, aspect: canvas.width / canvas.height };
  }, [text, letterSpacing]);

  const height = 0.65 * scale;
  const width = height * aspect;

  return (
    <group position={position}>
      {texture && (
        <mesh>
          <planeGeometry args={[width, height]} />
          <meshBasicMaterial
            map={texture}
            transparent
            opacity={opacity}
            side={THREE.DoubleSide}
            toneMapped={false}
            depthWrite={false}
          />
        </mesh>
      )}
      {hasLeader && leaderTo && (
        <lineSegments>
          <bufferGeometry>
            <bufferAttribute
              attach="attributes-position"
              args={[
                new Float32Array([
                  0,
                  -height / 2 - 0.05,
                  0,
                  leaderTo[0] - position[0],
                  leaderTo[1] - position[1],
                  leaderTo[2] - position[2],
                ]),
                3,
              ]}
            />
          </bufferGeometry>
          <lineBasicMaterial color="#ffffff" transparent opacity={0.65} />
        </lineSegments>
      )}
    </group>
  );
}

/**
 * Two slender light posts flanking the entrance at x = ±3.2, z = 7.5
 */
function EntranceBollards() {
  const lineGeo = useMemo(() => {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute(
      "position",
      new THREE.BufferAttribute(new Float32Array([0, 0, 0, 0, 3.4, 0]), 3),
    );
    return geo;
  }, []);
  const lineMat = useMemo(
    () => new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.85 }),
    [],
  );
  const sphereGeo = useMemo(() => new THREE.SphereGeometry(0.075, 12, 12), []);
  const sphereMat = useMemo(() => new THREE.MeshBasicMaterial({ color: 0xffffff }), []);

  return (
    <group>
      <group position={[-3.2, 0, 7.5]}>
        <lineSegments geometry={lineGeo} material={lineMat} />
        <mesh position={[0, 3.4, 0]} geometry={sphereGeo} material={sphereMat} />
      </group>
      <group position={[3.2, 0, 7.5]}>
        <lineSegments geometry={lineGeo} material={lineMat} />
        <mesh position={[0, 3.4, 0]} geometry={sphereGeo} material={sphereMat} />
      </group>
    </group>
  );
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

  // Exterior Plaza Floor Shader Material
  const plazaMat = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader: plazaVert,
        fragmentShader: plazaFrag,
      }),
    [],
  );

  // 1. SOLID OCCLUDER: Solid blueprint black massing with polygonOffset to enable clean Hidden-Line Removal (HLR)
  const solidOccluderMat = useMemo(
    () =>
      new THREE.MeshBasicMaterial({
        color: 0x020305,
        polygonOffset: true,
        polygonOffsetFactor: 1.0,
        polygonOffsetUnits: 1.0,
        depthWrite: true,
        depthTest: true,
      }),
    [],
  );

  // 2. PRIMARY ARCHITECTURAL WIREFRAME: Luminous crisp off-white for silhouettes, entablatures, vitrine frames
  const primaryWireMat = useMemo(
    () =>
      new THREE.LineBasicMaterial({
        color: 0xf5f7fa,
        transparent: true,
        opacity: 0.88,
        depthTest: true,
        depthWrite: false,
      }),
    [],
  );

  // 3. SECONDARY ARCHITECTURAL WIREFRAME: Elegant slate-grey for inner flutes, steps, arch ribs
  const secondaryWireMat = useMemo(
    () =>
      new THREE.LineBasicMaterial({
        color: 0x8894a8,
        transparent: true,
        opacity: 0.65,
        depthTest: true,
        depthWrite: false,
      }),
    [],
  );

  // 4. EMISSIVE PORTAL & ACCENT MATERIALS
  const portalGlowMat = useMemo(
    () =>
      new THREE.MeshBasicMaterial({
        color: 0xffffff,
      }),
    [],
  );

  const silhouetteMat = useMemo(
    () =>
      new THREE.MeshBasicMaterial({
        color: 0x010102,
      }),
    [],
  );

  const glassVitrineMat = useMemo(
    () =>
      new THREE.MeshBasicMaterial({
        color: 0x080a12,
        transparent: true,
        opacity: 0.12,
        depthWrite: false,
      }),
    [],
  );

  useEffect(
    () => () => {
      plazaMat.dispose();
      solidOccluderMat.dispose();
      primaryWireMat.dispose();
      secondaryWireMat.dispose();
      portalGlowMat.dispose();
      silhouetteMat.dispose();
      glassVitrineMat.dispose();
    },
    [
      plazaMat,
      solidOccluderMat,
      primaryWireMat,
      secondaryWireMat,
      portalGlowMat,
      silhouetteMat,
      glassVitrineMat,
    ],
  );

  // Prepare and curate scene geometry for authentic museum-grade architectural CAD rendering
  useEffect(() => {
    if (!scene) return;
    const anim: THREE.Object3D[] = [];
    const picks: { mesh: THREE.Mesh; code: number }[] = [];

    scene.traverse((child) => {
      if ((child as THREE.Mesh).isMesh) {
        const mesh = child as THREE.Mesh;
        mesh.castShadow = false;
        mesh.receiveShadow = false;

        // 1. Hide messy / redundant items
        // - PlazaHaze & Plaque_01..06
        // - InteractiveKiosk_... & KioskScreen_... (slanted poles that clutter plinth sides)
        // - PlinthCornerTrim_... (prevents double-line artifacts with ShowcasePlinth)
        // - GLB Labels (we render high-res Canvas 3D labels)
        if (
          mesh.name.startsWith("PlazaHaze") ||
          mesh.name.startsWith("Plaque_") ||
          mesh.name.startsWith("Label_") ||
          mesh.name.startsWith("InteractiveKiosk_") ||
          mesh.name.startsWith("KioskScreen_") ||
          mesh.name.startsWith("PlinthCornerTrim_")
        ) {
          mesh.visible = false;
          return;
        }

        // 2. Exterior Plaza Floor
        if (mesh.name === "ReflectivePlaza") {
          mesh.material = plazaMat;
          return;
        }

        // 3. Classical Frieze Inscription (hidden to use custom high-res Thufail Ahamed label)
        if (mesh.name === "FriezeText") {
          mesh.visible = false;
          return;
        }

        // 4. Portal Glow Frame & Door Frame
        if (mesh.name === "PortalGlowFrame" || mesh.name === "PortalDoorFrame") {
          mesh.material = portalGlowMat;
          picks.push({ mesh, code: 99 });
          return;
        }

        // 5. Entrance Silhouette Figure
        if (mesh.name === "PortalSilhouetteFigure") {
          mesh.material = silhouetteMat;
          picks.push({ mesh, code: 99 });
          return;
        }

        // 6. Enter button click target
        if (mesh.name === "PlazaEnterButton") {
          mesh.visible = false;
          picks.push({ mesh, code: 99 });
          return;
        }

        // 7. Rose Window / Gallery Apse
        if (mesh.name === "GalleryApseGlass") {
          // Luminous celestial circular aperture
          mesh.material = new THREE.MeshBasicMaterial({
            color: 0xffffff,
            transparent: true,
            opacity: 0.95,
          });
          return;
        }

        if (mesh.name === "GalleryApseFrame") {
          mesh.material = solidOccluderMat;
          if (!mesh.userData.__wireAdded) {
            mesh.userData.__wireAdded = true;
            // High angle threshold (45 deg) to keep perimeter circle and main mullions without dense torus loops
            const edges = new THREE.EdgesGeometry(mesh.geometry, 45);
            const wire = new THREE.LineSegments(edges, primaryWireMat);
            mesh.add(wire);
          }
          return;
        }

        // 8. Gallery Barrel Vault: keep smooth arch curves without diagonal triangulation
        if (mesh.name === "GalleryBarrelVault") {
          mesh.material = solidOccluderMat;
          if (!mesh.userData.__wireAdded) {
            mesh.userData.__wireAdded = true;
            // Angle 35 deg ensures no diagonal triangulation across vault curve
            const edges = new THREE.EdgesGeometry(mesh.geometry, 35);
            const wire = new THREE.LineSegments(edges, secondaryWireMat);
            mesh.add(wire);
          }
          return;
        }

        // 9. Vitrine Glass Panels vs Vitrine Brass Frames
        if (mesh.name.startsWith("Vitrine_")) {
          // Ultra-clear transparent vitrine glass panel (no wireframe lines to avoid duplicates)
          mesh.material = glassVitrineMat;
          return;
        }

        if (mesh.name.startsWith("VitrineFrame_")) {
          // Single, elegant brass architectural vitrine frame
          mesh.material = solidOccluderMat;
          if (!mesh.userData.__wireAdded) {
            mesh.userData.__wireAdded = true;
            const edges = new THREE.EdgesGeometry(mesh.geometry, 15);
            const wire = new THREE.LineSegments(edges, primaryWireMat);
            mesh.add(wire);
          }
          return;
        }

        // 10. Showcase Plinths (Monolithic Beveled Stone Pedestals)
        if (mesh.name.startsWith("ShowcasePlinth_")) {
          mesh.material = solidOccluderMat;
          if (!mesh.userData.__wireAdded) {
            mesh.userData.__wireAdded = true;
            const edges = new THREE.EdgesGeometry(mesh.geometry, 15);
            const wire = new THREE.LineSegments(edges, primaryWireMat);
            mesh.add(wire);
          }
          return;
        }

        // 11. Gallery Interior Floor & Brass Runner Inlays
        if (mesh.name === "GalleryFloor") {
          mesh.material = solidOccluderMat;
          return;
        }

        if (mesh.name === "FloorBrassInlays") {
          mesh.material = solidOccluderMat;
          if (!mesh.userData.__wireAdded) {
            mesh.userData.__wireAdded = true;
            const edges = new THREE.EdgesGeometry(mesh.geometry, 15);
            const wire = new THREE.LineSegments(edges, primaryWireMat);
            mesh.add(wire);
          }
          return;
        }

        // 12. Showcase Artifact Centerpieces (Holographic Cybernetic Models)
        if (mesh.name.startsWith("Artifact_")) {
          anim.push(mesh);
          mesh.material = new THREE.MeshBasicMaterial({
            color: 0xffffff,
            wireframe: true,
            transparent: true,
            opacity: 0.85,
            blending: THREE.AdditiveBlending,
          });
        } else {
          // 13. General Classical Architecture (Columns, Pediment, Entablature, Arch Ribs, Stylobate)
          mesh.material = solidOccluderMat;

          if (!mesh.userData.__wireAdded) {
            mesh.userData.__wireAdded = true;
            try {
              const isCol = mesh.name.includes("Col_");
              const threshold = isCol ? 8 : 12;
              const wireMat = isCol ? secondaryWireMat : primaryWireMat;
              const edges = new THREE.EdgesGeometry(mesh.geometry, threshold);
              const wireLines = new THREE.LineSegments(edges, wireMat);
              mesh.add(wireLines);
            } catch {
              // Ignore degenerate geometries
            }
          }
        }

        // Register showcase plinths, vitrines, artifacts (codes 0..5)
        for (let i = 0; i < SHOWCASE_IDS.length; i++) {
          const id = SHOWCASE_IDS[i];
          const slug = SHOWCASE_SLUGS[i];
          if (mesh.name.includes(`_${id}`) || mesh.name.includes(`_${slug}`)) {
            picks.push({ mesh, code: i });
            break;
          }
        }
      }
    });

    animatedNodes.current = anim;
    pickTargets.current = picks;
  }, [
    scene,
    plazaMat,
    solidOccluderMat,
    primaryWireMat,
    secondaryWireMat,
    portalGlowMat,
    silhouetteMat,
    glassVitrineMat,
  ]);

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

  // Set deep void background and fog when in /flow
  useEffect(() => {
    if (mode === "flow") {
      threeScene.background = new THREE.Color("#000000");
      const fog = threeScene.fog as THREE.FogExp2 | null;
      if (fog && fog.isFogExp2) {
        fog.color.set("#000000");
        fog.density = 0.005;
      }
    } else {
      threeScene.background = palette.bg;
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

    // Adjust scene fog density for exterior vs interior hall
    const fog = threeScene.fog as THREE.FogExp2 | null;
    if (fog && fog.isFogExp2) {
      const targetDensity = flowView === "exterior" ? 0.0055 : 0.0035;
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
      // Wide architectural establishing shot framing full octastyle portico, pediment, labels, and perspective lines
      const camZ = isMobile ? 38.0 : 34.0;
      sceneState.flow.pos = [
        ox + pan * 8.0 + mouseX * 1.2,
        oy + 2.3 + tilt * 1.8 + mouseY * 0.4,
        oz + camZ,
      ];
      sceneState.flow.look = [
        ox + pan * 14.0 + mouseX * 1.8,
        oy + 5.1 + tilt * 3.2 + mouseY * 0.55,
        oz + 1.0,
      ];
    } else if (flowView === "hall") {
      // Positioned inside looking down the 36m nave gallery
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
      {/* Subtle ambient for CAD depth contrast */}
      <ambientLight intensity={0.15} />

      {/* The 3D Architecture & Exhibition Model */}
      <primitive object={scene} />

      {/* Flanking Entrance Bollard Light Posts (Exterior) */}
      {flowView === "exterior" && <EntranceBollards />}

      {/* 3D Floating Architectural Blueprint Labels (Exterior) */}
      {flowView === "exterior" && (
        <>
          <ArchitecturalLabel3D
            text="SYNAPX STUDIO"
            position={[0, 14.6, 3.2]}
            scale={1.1}
            opacity={0.92}
          />
          <ArchitecturalLabel3D
            text="LOBBY"
            position={[0, 11.4, 2.6]}
            scale={0.95}
            hasLeader={true}
            leaderTo={[0, 9.8, 2.6]}
          />
          <ArchitecturalLabel3D
            text="THE GALLERY"
            position={[0, 10.4, 2.6]}
            scale={0.65}
            opacity={0.75}
          />
          <ArchitecturalLabel3D
            text="ROTUNDA"
            position={[25.2, 13.5, 1.2]}
            scale={0.85}
            opacity={0.88}
          />
          <ArchitecturalLabel3D
            text="THUFAIL AHAMED"
            position={[0, 8.28, 4.05]}
            scale={0.52}
            letterSpacing={3}
            opacity={0.95}
          />
        </>
      )}
    </group>
  );
}

useGLTF.preload(BUILDING_URL, "/draco/");
