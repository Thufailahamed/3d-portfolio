"use client";

import { useEffect, useMemo, useState } from "react";
import * as THREE from "three";
import { rng } from "@/lib/random";
import { type GuestEntry, useApp } from "@/store/useApp";
import { useRealLib } from "./FlowGalleryDetails";

/**
 * The guestbook: a marble inscription panel high on the hall's right-hand wall, between the first two niches
 * and over the sconce, carved with the latest signatures. Blueprint style draws it as linework.
 */

const FLOOR = 0.885;
const FACE_X = 7.43;
const Z = -12;
const W = 3.8;
const H = 2.1;
// above the sconce (its wash lights it) and below the cornice, where the hall view sees it
const Y = FLOOR + 3.65 + H / 2;
const ROWS = 5;

function fontFamily(name: string, fallback: string) {
  const v = getComputedStyle(document.body).getPropertyValue(name).trim();
  return v ? `${v}, ${fallback}` : fallback;
}

function draw(entries: GuestEntry[], real: boolean) {
  const PX = 2048;
  const c = document.createElement("canvas");
  c.width = PX;
  c.height = Math.round((PX * H) / W);
  const g = c.getContext("2d")!;
  const { width: cw, height: ch } = c;
  const display = fontFamily("--font-inter-tight", "sans-serif");
  const mono = fontFamily("--font-jetbrains", "monospace");
  const ink = real ? "rgba(52,44,36,0.88)" : "rgba(245,247,250,0.9)";
  const soft = real ? "rgba(70,60,50,0.62)" : "rgba(136,148,168,0.85)";
  const gold = real ? "#a8803f" : "#c8ff3d";

  if (real) {
    // Carrara: warm white with soft grey veining
    g.fillStyle = "#ece6dc";
    g.fillRect(0, 0, cw, ch);
    const r = rng(7);
    for (let v = 0; v < 26; v++) {
      g.beginPath();
      let x = r() * cw;
      let y = r() * ch;
      g.moveTo(x, y);
      const a = r() * Math.PI;
      for (let s = 0; s < 40; s++) {
        x += Math.cos(a + (r() - 0.5) * 1.6) * 28;
        y += Math.sin(a + (r() - 0.5) * 1.6) * 28;
        g.lineTo(x, y);
      }
      g.strokeStyle = `rgba(120,115,110,${0.05 + r() * 0.12})`;
      g.lineWidth = 0.6 + r() * 2.4;
      g.stroke();
    }
  } else {
    g.fillStyle = "#020305";
    g.fillRect(0, 0, cw, ch);
  }

  // incised border
  g.strokeStyle = gold;
  g.lineWidth = 4;
  g.strokeRect(36, 36, cw - 72, ch - 72);
  g.lineWidth = 1.5;
  g.strokeRect(54, 54, cw - 108, ch - 108);

  g.textBaseline = "alphabetic";
  g.textAlign = "center";
  g.fillStyle = gold;
  g.font = `700 84px ${display}`;
  g.letterSpacing = "22px";
  g.fillText("GUESTBOOK", cw / 2, 180);
  g.font = `500 30px ${mono}`;
  g.letterSpacing = "8px";
  g.fillStyle = soft;
  g.fillText(entries.length ? "SIGNED BY THE VISITORS OF THIS HALL" : "BE THE FIRST TO SIGN · PRESS G IN THE HALL", cw / 2, 240);

  // two columns of signatures, newest first
  const list = entries.slice(0, ROWS * 2);
  const colW = (cw - 220) / 2;
  const top = 320;
  const rowH = (ch - top - 90) / ROWS;
  g.textAlign = "left";
  list.forEach((e, i) => {
    const col = Math.floor(i / ROWS);
    const row = i % ROWS;
    const x = 110 + col * (colW + 40);
    const y = top + row * rowH;
    g.letterSpacing = "6px";
    g.fillStyle = ink;
    g.font = `700 44px ${display}`;
    g.fillText(e.name.toUpperCase(), x, y + 44);
    g.letterSpacing = "0px";
    g.fillStyle = soft;
    g.font = `italic 400 42px Georgia, "Times New Roman", serif`;
    let text = `“${e.line}”`;
    while (text.length > 6 && g.measureText(text).width > colW - 20) text = text.slice(0, -3) + "…”";
    g.fillText(text, x, y + 100);
  });

  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

export default function GuestbookWall() {
  const lib = useRealLib();
  const entries = useApp((s) => s.guestbook);
  const [fontsReady, setFontsReady] = useState(false);
  useEffect(() => {
    document.fonts.ready.then(() => setFontsReady(true));
  }, []);

  const tex = useMemo(() => (fontsReady ? draw(entries, !!lib) : null), [entries, lib, fontsReady]);
  useEffect(() => () => tex?.dispose(), [tex]);

  const mats = useMemo(
    () => ({
      slab: new THREE.MeshPhysicalMaterial({ color: 0xe9e2d6, roughness: 0.4, clearcoat: 0.5, clearcoatRoughness: 0.2 }),
      face: new THREE.MeshPhysicalMaterial({ roughness: 0.32, clearcoat: 0.7, clearcoatRoughness: 0.12 }),
      line: new THREE.MeshBasicMaterial({ toneMapped: false }),
    }),
    [],
  );
  useEffect(() => () => Object.values(mats).forEach((m) => m.dispose()), [mats]);
  useEffect(() => {
    mats.face.map = tex;
    mats.line.map = tex;
    mats.face.needsUpdate = true;
    mats.line.needsUpdate = true;
  }, [tex, mats]);

  if (!tex) return null;
  return (
    <group position={[FACE_X, Y, Z]} rotation-y={-Math.PI / 2}>
      {lib && (
        <mesh position={[0, 0, -0.035]} material={mats.slab} castShadow receiveShadow>
          <boxGeometry args={[W + 0.12, H + 0.12, 0.06]} />
        </mesh>
      )}
      <mesh position={[0, 0, 0.0]} material={lib ? mats.face : mats.line} receiveShadow={!!lib}>
        <planeGeometry args={[W, H]} />
      </mesh>
    </group>
  );
}
