"use client";

import { Edges, QuadraticBezierLine } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import * as THREE from "three";
import { getLab } from "../lab";
import { UNET, UNET_BLOCKS } from "../sd15";
import { X } from "../story";
import { C, Caption, Label, Screen, approach, put, stageT } from "./common";
import { PHASE, stepPhase, within } from "./useShownStep";

/**
 * SD 1.5's U-Net drawn from its block table: a slab's face is its spatial resolution (the grid has one square
 * per latent position), its thickness its channel count. Skips, cross-attention and time conditioning are wired
 * as in diffusers' UNet2DConditionModel. Each step, the guidance batch [∅, prompt] passes through once.
 */

const LEVEL_Y: Record<number, number> = { 64: 5.05, 32: 3.9, 16: 2.85, 8: 1.9 };
const SIDE: Record<number, number> = { 64: 1.42, 32: 1.06, 16: 0.78, 8: 0.56 };
const THICK: Record<number, number> = { 320: 0.12, 640: 0.22, 1280: 0.36 };
const XS: Record<string, number> = { conv_in: -6.55, down0: -5.0, down1: -3.75, down2: -2.62, down3: -1.52, mid: 0, up0: 1.52, up1: 2.62, up2: 3.75, up3: 5.0, conv_out: 6.55 };
export const UNET_IN: [number, number, number] = [X.unet + XS.conv_in, LEVEL_Y[64], 0];
export const UNET_OUT: [number, number, number] = [X.unet + XS.conv_out, LEVEL_Y[64], 0];
export const BUS_Y = 6.75;
export const BUS_Z = -1.25;

type Node = { id: string; x: number; y: number; side: number; thick: number; res: number; ch: number; label: string; detail: string; attn: number };

function gridTexture(cells: number) {
  const s = 512;
  const c = document.createElement("canvas");
  c.width = c.height = s;
  const g = c.getContext("2d")!;
  // smoked glass with an etched grid, one square per latent position at this resolution
  const grd = g.createLinearGradient(0, 0, s, s);
  grd.addColorStop(0, "#1c1714");
  grd.addColorStop(1, "#0f0c0b");
  g.fillStyle = grd;
  g.fillRect(0, 0, s, s);
  g.strokeStyle = `rgba(255,236,214,${cells > 32 ? 0.26 : 0.4})`;
  g.lineWidth = 1;
  for (let k = 1; k < cells; k++) {
    const p = Math.round((k / cells) * s) + 0.5;
    g.beginPath();
    g.moveTo(p, 0);
    g.lineTo(p, s);
    g.moveTo(0, p);
    g.lineTo(s, p);
    g.stroke();
  }
  g.strokeStyle = "rgba(255,236,214,0.85)";
  g.lineWidth = 4;
  g.strokeRect(1.5, 1.5, s - 3, s - 3);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

export default function UNet() {
  const nodes = useMemo<Node[]>(() => {
    const list: Node[] = [{ id: "conv_in", x: XS.conv_in, y: LEVEL_Y[64], side: 1.15, thick: 0.035, res: 64, ch: 320, label: "conv_in", detail: "4 › 320", attn: 0 }];
    for (const b of UNET_BLOCKS)
      list.push({
        id: b.id,
        x: XS[b.id],
        y: b.id === "mid" ? 1.2 : LEVEL_Y[b.res],
        side: SIDE[b.res],
        thick: THICK[b.ch],
        res: b.res,
        ch: b.ch,
        label: `${b.res}² × ${b.ch}`,
        detail: `${b.resnets} res${b.attn ? ` · ${b.attn} attn` : ""}${b.resample ? (b.resample === "down" ? " · ↓2" : " · ↑2") : ""}`,
        attn: b.attn,
      });
    list.push({ id: "conv_out", x: XS.conv_out, y: LEVEL_Y[64], side: 1.15, thick: 0.035, res: 64, ch: 320, label: "conv_out", detail: "GN · SiLU · 320 › 4", attn: 0 });
    return list;
  }, []);
  const grids = useMemo(() => Object.fromEntries([64, 32, 16, 8].map((r) => [r, gridTexture(r)])) as Record<number, THREE.Texture>, []);
  const mats = useMemo(
    () => nodes.map((n) => new THREE.MeshPhysicalMaterial({ map: grids[n.res], emissiveMap: grids[n.res], emissive: new THREE.Color("#ffe3c4"), emissiveIntensity: 0.3, color: "#ffffff", roughness: 0.22, metalness: 0.1, clearcoat: 1, clearcoatRoughness: 0.05 })),
    [nodes, grids],
  );
  const edge = useMemo(() => new THREE.MeshStandardMaterial({ color: "#2a2420", metalness: 0.9, roughness: 0.28 }), []);

  // the pass the guidance batch takes, one curve per batch element
  const paths = useMemo(
    () =>
      [-0.2, 0.2].map(
        (dz) =>
          new THREE.CatmullRomCurve3(
            nodes.map((n) => new THREE.Vector3(n.x, n.y, dz)),
            false,
            "centripetal",
          ),
      ),
    [nodes],
  );
  const pulses = useRef<(THREE.Mesh | null)[]>([]);
  const glow = useRef(nodes.map(() => 0));

  const skips = useMemo(() => {
    const out: { a: [number, number, number]; b: [number, number, number]; mid: [number, number, number] }[] = [];
    for (const [d, u] of [["down0", "up3"], ["down1", "up2"], ["down2", "up1"], ["down3", "up0"]]) {
      const nd = nodes.find((n) => n.id === d)!;
      const nu = nodes.find((n) => n.id === u)!;
      for (let k = 0; k < 3; k++) {
        const y = nd.y + nd.side / 2 - 0.14 - k * 0.07;
        const lift = 0.25 + (nu.x - nd.x) * 0.035;
        out.push({ a: [nd.x + nd.side / 2, y, -0.3], b: [nu.x - nu.side / 2, y, -0.3], mid: [(nd.x + nu.x) / 2, y + lift, -0.3] });
      }
    }
    return out;
  }, [nodes]);

  const lab = getLab();

  useFrame((_, dt) => {
    const ph = stepPhase();
    const inLoop = stageT("denoise") > 0 && stageT("denoise") < 1;
    const u = ph < 0 || ph < PHASE.unet[0] || ph > PHASE.unet[1] ? -1 : within(ph, PHASE.unet);
    paths.forEach((p, b) => {
      const m = pulses.current[b];
      if (!m) return;
      m.visible = u >= 0 && u < 1;
      if (m.visible) p.getPointAt(u, m.position);
    });
    nodes.forEach((n, i) => {
      const at = i / (nodes.length - 1);
      const near = u < 0 ? 0 : Math.exp(-(((u - at) / 0.06) ** 2));
      glow.current[i] = approach(glow.current[i], (inLoop ? 0.55 : 0.35) + 2.2 * near, 12, dt);
      put(mats[i], "emissiveIntensity", glow.current[i]);
    });
  });

  return (
    <group position={[X.unet, 0, 0]}>
      <Caption
        n="04"
        title="U-Net · noise predictor"
        spec={`predicts the noise (epsilon) · ${(UNET.params / 1e6).toFixed(1)} M params · channels 320 › 640 › 1280 › 1280 · 16 transformer blocks · 12 skip connections · 8 heads`}
        tag={{ text: "SD 1.5's shapes · closed-form stand-in denoiser (see Method)", kind: "stand" }}
        position={[-7.1, 7.75, 0]}
        width={9}
      />
      {nodes.map((n, i) => (
        <group key={n.id} position={[n.x, n.y, 0]}>
          <mesh material={mats[i]} position={[0, 0, n.thick / 2 + 0.002]}>
            <planeGeometry args={[n.side, n.side]} />
          </mesh>
          <mesh material={edge}>
            <boxGeometry args={[n.side, n.side, n.thick]} />
            <Edges color="#f3e2cc" transparent opacity={0.4} />
          </mesh>
          <Label fontSize={0.11} color={C.fg} anchorX="center" position={[0, -n.side / 2 - 0.15, 0]}>
            {n.label}
          </Label>
          <Label fontSize={0.082} color={C.dim} anchorX="center" position={[0, -n.side / 2 - 0.32, 0]}>
            {n.detail}
          </Label>
          {n.attn > 0 && (
            <>
              {/* cross-attention: queries from this block, keys and values from c */}
              <mesh position={[0, (BUS_Y - n.y + n.side / 2) / 2, BUS_Z / 2]} rotation={[Math.atan2(BUS_Z, BUS_Y - n.y - n.side / 2), 0, 0]}>
                <cylinderGeometry args={[0.006, 0.006, Math.hypot(BUS_Y - n.y - n.side / 2, BUS_Z), 6]} />
                <meshBasicMaterial color={C.text} transparent opacity={0.55} toneMapped={false} />
              </mesh>
              <mesh position={[0, n.side / 2 + 0.002, 0]} rotation={[-Math.PI / 2, 0, 0]}>
                <circleGeometry args={[0.035, 20]} />
                <meshBasicMaterial color={C.text} toneMapped={false} />
              </mesh>
            </>
          )}
        </group>
      ))}

      {/* skip connections: three per level, encoder to decoder */}
      {skips.map((s, i) => (
        <QuadraticBezierLine key={i} start={s.a} end={s.b} mid={s.mid} color={C.dim} lineWidth={1} transparent opacity={0.45} />
      ))}

      {/* the guidance batch: element 0 is the empty prompt, element 1 the prompt */}
      {[C.uncond, C.accent].map((c, b) => (
        <mesh key={b} ref={(m) => void (pulses.current[b] = m)} visible={false}>
          <sphereGeometry args={[0.07, 20, 14]} />
          <meshBasicMaterial color={c} toneMapped={false} />
        </mesh>
      ))}

      {/* timestep embedding, fed to every resnet */}
      <group position={[0, 7.05, -0.6]}>
        <Screen w={3.6} h={0.14} map={lab?.tembTex ?? null} bezel={false} />
        <Label fontSize={0.075} color={C.time} position={[-1.8, 0.2, 0]}>
          {"timestep embedding · sin / cos (320) › MLP › 1280 · added in every resnet"}
        </Label>
      </group>
      <Label fontSize={0.075} color={C.text} position={[-4.2, BUS_Y + 0.14, BUS_Z]}>
        {"cross-attention · Q from the latent features, K and V from c [77 × 768]"}
      </Label>
      <Label fontSize={0.075} color={C.faint} position={[-2.3, 0.42, 0]}>
        {"down path  ›  mid  ›  up path, with skips concatenated on the way up"}
      </Label>
    </group>
  );
}
