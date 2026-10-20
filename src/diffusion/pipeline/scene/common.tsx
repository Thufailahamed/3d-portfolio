"use client";

import { Text } from "@react-three/drei";
import { createContext, useContext, type ComponentProps, type ReactNode } from "react";
import * as THREE from "three";
import { STAGES, type StageId } from "../story";
import { useLab } from "../store";

export const FONT = {
  mono: "/diffusion/fonts/ibm-plex-mono-latin-400-normal.woff",
  monoMedium: "/diffusion/fonts/ibm-plex-mono-latin-500-normal.woff",
  sans: "/diffusion/fonts/ibm-plex-sans-latin-400-normal.woff",
  sansMedium: "/diffusion/fonts/ibm-plex-sans-latin-500-normal.woff",
  display: "/diffusion/fonts/instrument-serif-latin-400-normal.woff",
  displayItalic: "/diffusion/fonts/instrument-serif-latin-400-italic.woff",
};

/** the look of a lab's room and its in-world type, set by each scene */
export type Theme = {
  /** clear colour and fog */
  bg: string;
  floor: string;
  /** the backdrop's band of light just above the floor, and its tone higher up */
  horizon: string;
  sky: string;
  /** overhead soft box and the two side boxes, for reflections */
  key: string;
  rim: [string, string];
  /** light shafts, floor pools and the dust in them */
  beam: string;
  /** the follow spot */
  spot: string;
  /** woff for in-world titles, and the colours the captions use */
  display: string;
  displayItalic?: string;
  fg: string;
  dim: string;
  faint: string;
  accent: string;
};

const ThemeContext = createContext<Theme | null>(null);
export const ThemeProvider = ThemeContext.Provider;
export const useTheme = () => useContext(ThemeContext);

/** the darkroom's palette: bone paper, a safelight accent, plus one hue per kind of data */
export const C = {
  fg: "#efe8dc",
  dim: "#a39a8c",
  faint: "#655c52",
  wire: "#3a332c",
  accent: "#ff5a36",
  text: "#9ab8ff",
  time: "#f2b65a",
  uncond: "#a8a49d",
  pixel: "#f6efe3",
};

const lazy = <T,>(make: () => T) => {
  let v: T | null = null;
  return () => (v ??= make());
};

export const MAT = {
  /** bead-blasted aluminium */
  metal: lazy(() => new THREE.MeshStandardMaterial({ color: "#c3c7cd", metalness: 1, roughness: 0.3 })),
  darkMetal: lazy(() => new THREE.MeshStandardMaterial({ color: "#3a3d43", metalness: 0.92, roughness: 0.36 })),
  /** black lacquer behind every display */
  panel: lazy(() => new THREE.MeshPhysicalMaterial({ color: "#121418", metalness: 0.1, roughness: 0.3, clearcoat: 1, clearcoatRoughness: 0.08 })),
  cell: lazy(() => new THREE.MeshPhysicalMaterial({ color: "#1d2026", metalness: 0.25, roughness: 0.42, clearcoat: 0.6, clearcoatRoughness: 0.2 })),
};

/** progress of a stage: 0 before it, its playhead during it, 1 after */
export function stageT(id: StageId) {
  const s = useLab.getState();
  const i = STAGES.findIndex((st) => st.id === id);
  return s.stage > i ? 1 : s.stage < i ? 0 : s.p;
}

export function isStage(id: StageId) {
  const s = useLab.getState();
  return STAGES[s.stage]?.id === id;
}

/** set a uniform or material field from a frame loop (three.js objects are mutated per frame by design) */
export const put = <T extends object, K extends keyof T>(o: T, key: K, v: T[K]) => {
  o[key] = v;
};

/** framerate-independent approach toward a target */
export const approach = (v: number, target: number, rate: number, dt: number) => v + (target - v) * (1 - Math.exp(-rate * dt));

export const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

type TextProps = Omit<ComponentProps<typeof Text>, "children" | "font"> & { children: ReactNode; sans?: boolean; medium?: boolean };

/** every in-world label: IBM Plex, flat, never tone-mapped so it reads as print rather than light */
export function Label({ children, sans, medium, fontSize = 0.11, color = C.dim, anchorX = "left", anchorY = "middle", ...rest }: TextProps) {
  const font = sans ? (medium ? FONT.sansMedium : FONT.sans) : medium ? FONT.monoMedium : FONT.mono;
  return (
    <Text font={font} fontSize={fontSize} color={color} anchorX={anchorX} anchorY={anchorY} letterSpacing={sans ? -0.005 : 0.01} material-toneMapped={false} {...rest}>
      {children}
    </Text>
  );
}

export type Tag = { text: string; kind: "live" | "ref" | "stand" };

/**
 * A station's placard, as in a gallery: the number, the name in the display face, one line of figures, and
 * what kind of exhibit it is (computed live, drawn for reference, or stood in for). A title "Name · question"
 * sets the question on its own line.
 */
export function Caption({ n, title, spec, tag, position, width = 6 }: { n: string; title: string; spec: string; tag?: Tag; position: [number, number, number]; width?: number }) {
  const th = useTheme();
  const [name, ask] = title.split(" · ");
  const fg = th?.fg ?? C.fg;
  const dim = th?.dim ?? C.dim;
  const faint = th?.faint ?? C.faint;
  const tagColor = tag?.kind === "live" ? (th?.accent ?? C.accent) : tag?.kind === "stand" ? C.time : dim;
  const y = ask ? 0.22 : 0;
  return (
    <group position={position}>
      <Text font={th?.displayItalic ?? th?.display ?? FONT.display} fontSize={0.3} color={th?.accent ?? C.accent} anchorX="left" anchorY="bottom-baseline" position={[0, 0.3 + y, 0]} material-toneMapped={false}>
        {n}
      </Text>
      <Text font={th?.display ?? FONT.display} fontSize={0.46} color={fg} anchorX="left" anchorY="bottom-baseline" position={[0.52, 0.3 + y, 0]} letterSpacing={-0.01} material-toneMapped={false}>
        {name}
      </Text>
      {ask && (
        <Text font={th?.displayItalic ?? th?.display ?? FONT.display} fontSize={0.2} color={dim} anchorX="left" anchorY="bottom-baseline" position={[0.54, 0.23, 0]} material-toneMapped={false}>
          {ask.charAt(0).toUpperCase() + ask.slice(1)}
        </Text>
      )}
      <Label fontSize={0.072} color={faint} position={[0.54, 0.06, 0]} maxWidth={width} anchorY="top" lineHeight={1.45}>
        {spec}
      </Label>
      {tag && (
        <group position={[0.54, 0.82 + y, 0]}>
          <mesh position={[0.03, 0, 0]}>
            <circleGeometry args={[0.028, 20]} />
            <meshBasicMaterial color={tagColor} toneMapped={false} />
          </mesh>
          <Label medium fontSize={0.062} color={tagColor} position={[0.1, 0, 0]} letterSpacing={0.16}>
            {tag.text.toUpperCase()}
          </Label>
        </group>
      )}
    </group>
  );
}

/** a thin anodised frame around a w × h opening, facing +z */
export function Bezel({ w, h, t = 0.03, d = 0.05, material }: { w: number; h: number; t?: number; d?: number; material?: THREE.Material }) {
  const m = material ?? MAT.metal();
  return (
    <group>
      <mesh material={m} position={[0, h / 2 + t / 2, 0]}>
        <boxGeometry args={[w + 2 * t, t, d]} />
      </mesh>
      <mesh material={m} position={[0, -h / 2 - t / 2, 0]}>
        <boxGeometry args={[w + 2 * t, t, d]} />
      </mesh>
      <mesh material={m} position={[-w / 2 - t / 2, 0, 0]}>
        <boxGeometry args={[t, h, d]} />
      </mesh>
      <mesh material={m} position={[w / 2 + t / 2, 0, 0]}>
        <boxGeometry args={[t, h, d]} />
      </mesh>
    </group>
  );
}

/** a framed display: backing board, picture, bezel */
export function Screen({ w, h, map, position, bezel = true, children, brightness = 1 }: { w: number; h: number; map: THREE.Texture | null; position?: [number, number, number]; bezel?: boolean; children?: ReactNode; brightness?: number }) {
  return (
    <group position={position}>
      <mesh material={MAT.panel()} position={[0, 0, -0.03]}>
        <boxGeometry args={[w + 0.02, h + 0.02, 0.04]} />
      </mesh>
      {map && (
        <mesh position={[0, 0, 0.0]}>
          <planeGeometry args={[w, h]} />
          <meshBasicMaterial map={map} toneMapped={false} color={[brightness, brightness, brightness]} />
        </mesh>
      )}
      {bezel && <Bezel w={w} h={h} />}
      {children}
    </group>
  );
}

/** a slim column the floor-standing displays sit on */
export function Stand({ x = 0, z = -0.12, height }: { x?: number; z?: number; height: number }) {
  return (
    <mesh material={MAT.darkMetal()} position={[x, height / 2, z]}>
      <boxGeometry args={[0.05, height, 0.05]} />
    </mesh>
  );
}
