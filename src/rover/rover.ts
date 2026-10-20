import * as THREE from "three";
import { clamp, damp, lerp } from "./noise";
import { ROVER, type RoverSim } from "./physics";
import { Kit, T, box, cyl, cylX, cylZ, rbox, tube } from "./roverParts";
import { makeBrushedTexture, makeCalibrationTexture, makeFoilTextures, makePaintTextures, makePlateTexture } from "./roverTextures";

/**
 * A Curiosity-class rover: bevelled warm electronics box with its deck instruments, MMRTG and
 * heat-rejection panels at the back, rocker-bogie suspension with steering actuators on the corner
 * wheels, six machined wheels with chevron grousers and curved titanium spokes, the remote-sensing
 * mast, a phased-array high-gain antenna on its gimbal, and the five-joint arm with its tool turret.
 * Static parts are merged per material, so the whole rover is drawn in roughly seventy calls.
 * Body frame matches the physics: +z forward, +x left, origin at the centre of mass.
 */

type MatKey = "paint" | "foil" | "alu" | "ti" | "dark" | "black" | "fin" | "hx" | "copper" | "lens" | "glass" | "led" | "calib" | "plate";
type Mats = Record<MatKey, THREE.MeshStandardMaterial>;

/** how strongly each surface takes on dust (the deck and wheels collect it first) */
const DUSTY: Partial<Record<MatKey, number>> = { paint: 1, alu: 0.9, ti: 0.6, foil: 0.45, dark: 0.6, black: 0.5, fin: 0.5, hx: 0.6, copper: 0.5 };

function mats(): Mats {
  const paint = makePaintTextures();
  const foil = makeFoilTextures();
  const brushed = makeBrushedTexture();
  return {
    // white thermal paint: a light warm grey in albedo, so a noon sun doesn't clip it
    paint: new THREE.MeshStandardMaterial({ color: "#c9c4ba", map: paint.map, bumpMap: paint.bump, bumpScale: 1.4, roughnessMap: paint.rough, roughness: 1, metalness: 0.02 }),
    // crumpled gold MLI: the creases break the sun's highlight into glints instead of one hot spot
    foil: new THREE.MeshStandardMaterial({ color: "#ffffff", map: foil.map, normalMap: foil.normal, normalScale: new THREE.Vector2(0.7, 0.7), roughnessMap: foil.rough, roughness: 1, metalness: 0.62 }),
    // machined aluminium: mostly diffuse, so the wheels still read under a black airless sky
    alu: new THREE.MeshStandardMaterial({ color: "#b4b8be", roughnessMap: brushed, roughness: 1, metalness: 0.5, side: THREE.DoubleSide }),
    ti: new THREE.MeshStandardMaterial({ color: "#8f8c86", roughnessMap: brushed, roughness: 0.9, metalness: 0.75 }),
    dark: new THREE.MeshStandardMaterial({ color: "#2f3237", roughness: 0.5, metalness: 0.45, side: THREE.DoubleSide }),
    black: new THREE.MeshStandardMaterial({ color: "#0f1012", roughness: 0.62, metalness: 0.1 }),
    fin: new THREE.MeshStandardMaterial({ color: "#36383d", roughness: 0.55, metalness: 0.4 }),
    hx: new THREE.MeshStandardMaterial({ color: "#a4a6a4", roughnessMap: brushed, roughness: 0.85, metalness: 0.6 }),
    copper: new THREE.MeshStandardMaterial({ color: "#9a6440", roughness: 0.52, metalness: 0.8 }),
    lens: new THREE.MeshPhysicalMaterial({ color: "#050608", roughness: 0.12, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.03 }),
    glass: new THREE.MeshPhysicalMaterial({ color: "#1a2a44", roughness: 0.06, metalness: 0.2, clearcoat: 1, clearcoatRoughness: 0.02, emissive: "#0a1830", emissiveIntensity: 0.25 }),
    led: new THREE.MeshStandardMaterial({ color: "#000000", emissive: "#4dff7a", emissiveIntensity: 3 }),
    calib: new THREE.MeshStandardMaterial({ map: makeCalibrationTexture(), roughness: 0.65 }),
    plate: new THREE.MeshStandardMaterial({ map: makePlateTexture("ODYSSEY · OR-1"), roughness: 0.4, metalness: 0.5 }),
  };
}

/** a square decal facing +z with the full texture on it */
const decal = (w: number, h: number) => new THREE.PlaneGeometry(w, h);

const DY = 0.365; // top of the deck

/** the warm electronics box and everything bolted to it */
function buildBody(k: Kit, m: Mats) {
  // —— chassis: a chamfered profile (side view) extruded across the width ——
  const b = 0.02;
  const prof = new THREE.Shape(
    [
      [-0.96, -0.13], [0.96, -0.13], [1.04, -0.05], [1.04, 0.3], [0.98, 0.345], [-0.9, 0.345], [-1.04, 0.24], [-1.04, -0.05],
    ].map(([z, y]) => new THREE.Vector2(z, y)),
  );
  const depth = 1.58;
  const shell = new THREE.ExtrudeGeometry(prof, { depth, bevelEnabled: true, bevelThickness: b, bevelSize: b, bevelSegments: 2, curveSegments: 1 });
  shell.rotateY(-Math.PI / 2).translate(depth / 2, 0, 0);
  k.add(shell, m.paint, undefined, 0.8);
  // belly pan and a dark seam where the deck plate meets the walls
  k.add(rbox(1.5, 0.03, 1.94, 0.01), m.dark, T(0, -0.16, 0));
  k.add(box(1.6, 0.012, 2.06), m.dark, T(0, DY - 0.035, 0.02));
  // deck plate, a few mm proud, with its own panel seams
  k.add(rbox(1.5, 0.02, 1.82, 0.006), m.paint, T(0, DY + 0.005, 0.03), 0.9);

  // —— deck instruments ——
  // sample inlets with hinged covers (two for the oven, one for the diffractometer)
  for (const [x, z, open] of [[0.24, 0.66, 0.9], [0.4, 0.62, 0], [0.04, 0.7, 0.4]] as [number, number, number][]) {
    k.add(cyl(0.055, 0.05, 20), m.paint, T(x, DY + 0.035, z));
    k.add(cyl(0.032, 0.052, 16, 0.045, true), m.ti, T(x, DY + 0.04, z), 4);
    k.add(cyl(0.024, 0.01, 12), m.black, T(x, DY + 0.06, z));
    // cover hinged at its back edge
    k.add(cyl(0.05, 0.008, 20), m.ti, T(x, DY + 0.066, z - 0.05, -open).multiply(T(0, 0, 0.05)), 4);
  }
  // instrument blankets in gold MLI
  k.add(rbox(0.5, 0.1, 0.46, 0.035, 3), m.foil, T(0.44, DY + 0.05, 0.12), 5);
  k.add(rbox(0.46, 0.09, 0.36, 0.03, 3), m.foil, T(0.06, DY + 0.045, -0.6), 5);
  // radiation detector: a box with its sky-facing aperture
  k.add(rbox(0.2, 0.12, 0.18, 0.015), m.paint, T(0.0, DY + 0.06, 0.28));
  k.add(cyl(0.05, 0.02, 20), m.black, T(0.0, DY + 0.125, 0.28));
  k.add(cyl(0.058, 0.012, 20), m.ti, T(0.0, DY + 0.118, 0.28), 4);
  // UV sensor ring and a small electronics box
  k.add(cyl(0.035, 0.03, 12), m.paint, T(0.26, DY + 0.015, 0.36));
  for (let i = 0; i < 6; i++) k.add(cyl(0.006, 0.006, 6), m.glass, T(0.26 + Math.cos(i) * 0.022, DY + 0.032, 0.36 + Math.sin(i) * 0.022));
  k.add(rbox(0.16, 0.08, 0.2, 0.01), m.paint, T(0.62, DY + 0.04, -0.2));
  // mast base mount (front right) and the colour/shadow calibration target in front of it
  k.add(rbox(0.2, 0.06, 0.2, 0.012), m.ti, T(-0.55, DY + 0.03, 0.74), 3);
  k.add(rbox(0.14, 0.02, 0.14, 0.006), m.paint, T(-0.24, DY + 0.01, 0.86));
  k.add(decal(0.11, 0.11), m.calib, T(-0.24, DY + 0.0205, 0.86, -Math.PI / 2), "keep");
  k.add(cyl(0.004, 0.06, 6), m.black, T(-0.24, DY + 0.05, 0.86));
  // UHF quadrifilar helix and the low-gain antenna at the back
  k.add(cyl(0.06, 0.26, 18, 0.05), m.paint, T(0.66, DY + 0.13, -0.9));
  k.add(cyl(0.062, 0.02, 18), m.dark, T(0.66, DY + 0.01, -0.9));
  k.add(cyl(0.045, 0.03, 18), m.dark, T(0.66, DY + 0.275, -0.9));
  k.add(cyl(0.012, 0.16, 8), m.ti, T(-0.7, DY + 0.08, -0.9), 6);
  k.add(cyl(0.045, 0.07, 14, 0.015), m.paint, T(-0.7, DY + 0.19, -0.9));
  // status lights
  k.add(new THREE.SphereGeometry(0.008, 8, 6), m.led, T(-0.4, DY + 0.01, 0.94));
  k.add(new THREE.SphereGeometry(0.008, 8, 6), m.led, T(0.52, DY + 0.01, -0.98));
  // cable harnesses across the deck and down the back
  k.add(tube([[-0.47, DY + 0.06, 0.7], [-0.36, DY + 0.016, 0.55], [-0.28, DY + 0.016, 0.1], [-0.28, DY + 0.016, -0.6], [-0.26, DY - 0.02, -0.97], [-0.24, 0.12, -1.07]], 0.013, 40), m.black);
  k.add(tube([[-0.24, DY + 0.016, 0.1], [0.05, DY + 0.016, 0.05], [0.2, DY + 0.016, -0.3], [0.35, DY + 0.016, -0.42]], 0.01, 30), m.black);
  k.add(tube([[0.24, DY + 0.016, 0.98], [0.3, DY - 0.01, 1.04], [0.33, 0.25, 1.07]], 0.012, 16), m.black);
  k.add(tube([[0.7, DY + 0.016, -0.62], [0.78, DY - 0.02, -0.7], [0.82, 0.2, -0.72], [0.83, -0.05, -0.6]], 0.011, 20), m.copper);

  // —— sides: rocker pivots, raised panels, heat pipes, connectors ——
  for (const sx of [-1, 1]) {
    const X = sx * 0.81;
    k.add(cylX(0.11, 0.025, 24), m.ti, T(sx * 0.822, 0.06, 0.28), 4);
    k.add(cylX(0.085, 0.09, 24), m.dark, T(sx * 0.86, 0.06, 0.28));
    k.add(cylX(0.05, 0.03, 16), m.ti, T(sx * 0.915, 0.06, 0.28), 4);
    k.add(rbox(0.02, 0.2, 0.56, 0.006), m.paint, T(X + sx * 0.008, 0.13, -0.42));
    k.add(rbox(0.02, 0.15, 0.34, 0.006), m.paint, T(X + sx * 0.008, 0.18, 0.72));
    for (const y of [-0.04, -0.015]) k.add(cylZ(0.008, 1.7, 8), m.copper, T(X + sx * 0.012, y, -0.02));
    k.add(rbox(0.045, 0.08, 0.14, 0.008), m.dark, T(X + sx * 0.02, 0.0, -0.82));
    k.add(rbox(0.035, 0.05, 0.08, 0.006), m.black, T(X + sx * 0.02, 0.13, 0.98));
  }
  k.add(decal(0.3, 0.075), m.plate, T(0.824, 0.25, 0.22, 0, Math.PI / 2), "keep");

  // —— front: hazard cameras, observation tray, arm mount ——
  k.add(rbox(0.94, 0.075, 0.08, 0.012), m.dark, T(0, -0.095, 1.1));
  for (const x of [-0.37, -0.26, 0.26, 0.37]) {
    k.add(rbox(0.07, 0.07, 0.07, 0.01), m.dark, T(x, -0.095, 1.15));
    k.add(cylZ(0.024, 0.012, 16), m.ti, T(x, -0.095, 1.19), 6);
    k.add(cylZ(0.017, 0.012, 16), m.lens, T(x, -0.095, 1.195));
  }
  k.add(cylZ(0.075, 0.016, 28), m.paint, T(-0.46, 0.14, 1.068));
  k.add(cylZ(0.062, 0.006, 28), m.ti, T(-0.46, 0.14, 1.078), 6);
  k.add(rbox(0.16, 0.14, 0.08, 0.012), m.ti, T(0.35, 0.15, 1.07), 3);
  for (const x of [-0.7, 0.68]) k.add(rbox(0.1, 0.06, 0.03, 0.006), m.black, T(x, 0.1, 1.07));

  // —— back: hazard cameras, neutron spectrometer ——
  k.add(rbox(0.76, 0.07, 0.07, 0.012), m.dark, T(0, -0.06, -1.1));
  for (const x of [-0.31, -0.21, 0.21, 0.31]) {
    k.add(rbox(0.065, 0.065, 0.06, 0.01), m.dark, T(x, -0.06, -1.14));
    k.add(cylZ(0.016, 0.012, 16), m.lens, T(x, -0.06, -1.175));
  }
  k.add(rbox(0.22, 0.18, 0.14, 0.014), m.paint, T(-0.56, 0.02, -1.12));
  k.add(cylZ(0.05, 0.02, 20), m.dark, T(-0.56, 0.02, -1.2));

  // —— MMRTG: finned generator angled up off the back, heat-rejection panels either side ——
  const R = T(0, 0.13, -1.13, 0.5);
  const at = (x: number, y: number, z: number, rx = 0, ry = 0, rz = 0) => R.clone().multiply(T(x, y, z, rx, ry, rz));
  k.add(cylZ(0.13, 0.08, 20), m.ti, at(0, 0, -0.02), 4);
  k.add(cylZ(0.15, 0.62, 24), m.fin, at(0, 0, -0.38));
  k.add(cylZ(0.165, 0.035, 24), m.ti, at(0, 0, -0.07), 4);
  k.add(cylZ(0.165, 0.035, 24), m.ti, at(0, 0, -0.69), 4);
  k.add(cylZ(0.09, 0.04, 20), m.dark, at(0, 0, -0.72));
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2 + Math.PI / 8;
    k.add(box(0.012, 0.17, 0.58), m.fin, at(Math.cos(a) * 0.23, Math.sin(a) * 0.23, -0.38, 0, 0, a - Math.PI / 2));
  }
  for (const sx of [-1, 1]) {
    k.add(tube([[sx * 0.3, 0.12, -1.06], [sx * 0.18, 0.2, -1.2], [sx * 0.08, 0.26, -1.26]], 0.018, 10), m.ti, undefined, 4);
    // heat-rejection panel with its coolant loop
    const P = T(sx * 0.5, 0.2, -1.2, -0.75, 0, -sx * 0.32);
    k.add(rbox(0.46, 0.022, 0.44, 0.008), m.hx, P, 2);
    for (let t = -0.16; t <= 0.17; t += 0.08) k.add(cylZ(0.009, 0.42, 8), m.ti, P.clone().multiply(T(t, 0.016, 0)));
    k.add(cylX(0.009, 0.34, 8), m.ti, P.clone().multiply(T(0, 0.016, 0.205)));
    k.add(tube([[sx * 0.3, 0.2, -1.07], [sx * 0.36, 0.22, -1.12]], 0.02, 4), m.dark);
  }
}

/** remote-sensing mast below the head: deploy hinge, pole, weather booms */
function buildMast(k: Kit, m: Mats) {
  k.add(cylX(0.05, 0.17, 18), m.dark, T(0, 0, 0));
  k.add(rbox(0.12, 0.1, 0.12, 0.012), m.ti, T(0, 0.05, 0), 3);
  k.add(cyl(0.068, 0.1, 20), m.dark, T(0, 0.14, 0));
  k.add(cyl(0.048, 0.82, 20), m.paint, T(0, 0.59, 0), 3);
  k.add(cyl(0.056, 0.035, 20), m.ti, T(0, 0.5, 0), 4);
  k.add(tube([[0.05, 0.16, 0.02], [0.055, 0.55, 0.03], [0.05, 0.94, 0.02]], 0.01, 16), m.black);
  // weather-station booms
  for (const s of [-1, 1]) {
    const B = T(0, 0.72, 0, 0, s > 0 ? 0.5 : Math.PI + 0.5, 0);
    k.add(cylZ(0.011, 0.24, 8), m.ti, B.clone().multiply(T(0, 0, 0.14)), 6);
    k.add(rbox(0.04, 0.035, 0.08, 0.008), m.paint, B.clone().multiply(T(0, 0, 0.27)));
    k.add(cyl(0.004, 0.06, 6), m.black, B.clone().multiply(T(0.012, -0.04, 0.28)));
  }
  k.add(cyl(0.062, 0.1, 20), m.dark, T(0, 1.02, 0));
}

/** the mast head (tilts): science camera telescope on top, colour cameras, navigation stereo pairs */
function buildHead(k: Kit, m: Mats) {
  k.add(rbox(0.34, 0.16, 0.22, 0.018), m.paint, T(0, 0, 0));
  for (const s of [-1, 1]) k.add(cylX(0.055, 0.05, 18), m.dark, T(s * 0.195, 0, 0));
  // laser-spectrometer telescope housing
  k.add(rbox(0.21, 0.16, 0.3, 0.02), m.paint, T(0, 0.165, -0.02));
  k.add(rbox(0.215, 0.15, 0.09, 0.02, 3), m.foil, T(0, 0.165, -0.16), 5);
  k.add(cylZ(0.068, 0.03, 32), m.dark, T(0, 0.165, 0.135));
  k.add(cylZ(0.056, 0.012, 32), m.glass, T(0, 0.165, 0.148));
  k.add(cylZ(0.02, 0.014, 16), m.dark, T(0, 0.165, 0.15));
  // colour zoom cameras
  for (const s of [-1, 1]) {
    k.add(rbox(0.075, 0.08, 0.1, 0.01), m.dark, T(s * 0.07, -0.025, 0.12));
    k.add(cylZ(0.03, 0.02, 20), m.ti, T(s * 0.07, -0.025, 0.175), 6);
    k.add(cylZ(0.022, 0.012, 20), m.lens, T(s * 0.07, -0.025, 0.185));
  }
  // navigation camera pairs, one each side
  for (const s of [-1, 1]) {
    k.add(rbox(0.05, 0.11, 0.08, 0.008), m.dark, T(s * 0.15, -0.01, 0.1));
    for (const y of [-0.035, 0.025]) k.add(cylZ(0.014, 0.014, 14), m.lens, T(s * 0.15, y, 0.145));
  }
  k.add(rbox(0.3, 0.09, 0.06, 0.01), m.dark, T(0, -0.02, -0.13));
}

/** a wheel (shared by all six): skin, rim lips, chevron grousers, spokes; axle along x, outer face +x */
function buildWheel(m: Mats) {
  const R = ROVER.wheelR;
  const W = ROVER.wheelW;
  const k = new Kit();
  const half = (W * 0.96) / 2;
  k.add(cyl(R - 0.01, W * 0.96, 64, R - 0.01, true).rotateZ(Math.PI / 2), m.alu, undefined, "keep");
  for (const s of [-1, 1]) k.add(new THREE.TorusGeometry(R - 0.01, 0.011, 6, 64).rotateY(Math.PI / 2), m.alu, T(s * half, 0, 0), 4);
  k.add(new THREE.RingGeometry(R - 0.05, R - 0.01, 64, 1).rotateY(Math.PI / 2), m.alu, T(half - 0.004, 0, 0), 4);
  // 24 chevron grousers, point leading
  const c = 0.22;
  for (let i = 0; i < 24; i++) {
    const a = (i / 24) * Math.PI * 2;
    for (const s of [-1, 1]) {
      const len = Math.hypot(half, half * c);
      const g = box(len, 0.016, 0.009);
      g.rotateY(Math.atan2(-c * half, s * half));
      g.translate((s * half) / 2, R - 0.002, (c * half) / 2);
      g.rotateX(a);
      k.add(g, m.alu, undefined, 6);
    }
  }
  // curved titanium spokes and the hub on the outer face
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    const pts: [number, number, number][] = [];
    for (let j = 0; j <= 8; j++) {
      const t = j / 8;
      const rr = 0.065 + t * (R - 0.085);
      const aa = a + Math.sin(t * Math.PI) * 0.5;
      pts.push([half - 0.025 - Math.sin(t * Math.PI) * 0.05, Math.cos(aa) * rr, Math.sin(aa) * rr]);
    }
    k.add(tube(pts, 0.012, 14, 6), m.ti, undefined, 6);
  }
  k.add(cylX(0.07, 0.06, 24), m.ti, T(half - 0.04, 0, 0), 6);
  k.add(cylX(0.045, 0.03, 20), m.dark, T(half - 0.005, 0, 0));
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    k.add(cylX(0.007, 0.012, 6), m.ti, T(half + 0.008, Math.cos(a) * 0.032, Math.sin(a) * 0.032));
  }
  // inside: the dark inner face and the in-hub drive actuator
  k.add(new THREE.RingGeometry(0.08, R - 0.012, 48, 1).rotateY(-Math.PI / 2), m.dark, T(-half + 0.02, 0, 0));
  k.add(cylX(0.085, 0.2, 24), m.dark, T(-0.06, 0, 0));
  return k.geometries();
}

/** leg from the hub up to the suspension (and, on corner wheels, the steering actuator); inboard −x */
function buildLeg(m: Mats, steer: boolean) {
  const k = new Kit();
  k.add(cylX(0.05, 0.1, 16), m.dark, T(-0.24, 0, 0));
  if (steer) {
    k.add(tube([[-0.27, 0, 0], [-0.28, 0.2, 0], [-0.25, 0.4, 0], [-0.12, 0.44, 0], [0, 0.45, 0]], 0.03, 24, 8), m.ti, undefined, 4);
    k.add(cyl(0.072, 0.13, 22), m.dark, T(0, 0.49, 0));
    k.add(cyl(0.074, 0.05, 22), m.foil, T(0, 0.575, 0), 5);
    k.add(cyl(0.04, 0.03, 16), m.ti, T(0, 0.615, 0), 4);
  } else {
    k.add(tube([[-0.27, 0, 0], [-0.285, 0.21, 0], [-0.27, 0.42, 0]], 0.03, 16, 8), m.ti, undefined, 4);
    k.add(cylX(0.048, 0.09, 16), m.dark, T(-0.27, 0.42, 0));
  }
  return k.geometries();
}

const LEG_TOP_STEER = 0.6;
const LEG_TOP_FIXED = 0.42;
const LEG_INBOARD = 0.27;

export class RoverModel {
  readonly root = new THREE.Group();
  readonly body = new THREE.Group();
  wheels: { steer: THREE.Group; spin: THREE.Group; leg: THREE.Group }[] = [];
  private links: THREE.Mesh[] = [];
  private bogieJoints: THREE.Mesh[] = [];
  private m: Mats;
  private mast = new THREE.Group();
  private mastHead = new THREE.Group();
  private mastTilt = new THREE.Group();
  private hga = new THREE.Group();
  private hgaDish = new THREE.Group();
  private diff = new THREE.Group();
  private arm: { base: THREE.Group; shoulder: THREE.Group; elbow: THREE.Group; wrist: THREE.Group; turret: THREE.Group; drill: THREE.Mesh };
  /** 0 stowed (cruise), 1 deployed */
  deploy = 1;
  /** mobility: wheels folded under (0) or standing (1) */
  standing = 1;
  armPose = 0;
  armTarget = 0;
  drillSpin = 0;
  mastYaw = 0;
  mastPitch = 0;
  mastAim: { yaw: number; pitch: number } | null = null;
  lights: THREE.SpotLight[] = [];
  dust = 0;
  private dustColor = new THREE.Color();
  private clean: Partial<Record<MatKey, THREE.Color>> = {};
  private geos: THREE.BufferGeometry[] = [];

  constructor() {
    const m = (this.m = mats());
    for (const key of Object.keys(DUSTY) as MatKey[]) this.clean[key] = m[key].color.clone();
    this.root.add(this.body);
    const k = new Kit();

    buildBody(k, m);
    k.bake(this.body);

    // —— mast (front right) ——
    this.mast.position.set(-0.55, DY + 0.07, 0.74);
    this.body.add(this.mast);
    buildMast(k, m);
    k.bake(this.mast);
    this.mastHead.position.y = 1.11;
    this.mast.add(this.mastHead);
    this.mastHead.add(this.mastTilt);
    buildHead(k, m);
    k.bake(this.mastTilt);

    // —— high-gain antenna: flat hexagonal array on an azimuth/elevation gimbal ——
    this.hga.position.set(0.55, DY, -0.5);
    this.body.add(this.hga);
    k.add(cyl(0.065, 0.05, 20), m.dark, T(0, 0.025, 0));
    k.add(cyl(0.032, 0.2, 14), m.ti, T(0, 0.15, 0), 4);
    k.add(cyl(0.058, 0.08, 20), m.dark, T(0, 0.27, 0));
    k.add(rbox(0.07, 0.06, 0.09, 0.01), m.ti, T(0, 0.33, -0.03), 4);
    k.bake(this.hga);
    this.hgaDish.position.y = 0.38;
    this.hga.add(this.hgaDish);
    k.add(cylX(0.045, 0.16, 18), m.dark, T(0, 0, -0.07));
    k.add(cyl(0.29, 0.04, 6).rotateX(Math.PI / 2), m.paint, T(0, 0, 0), 2);
    k.add(cyl(0.265, 0.012, 6).rotateX(Math.PI / 2), m.paint, T(0, 0, 0.026), 2.5);
    for (const a of [0, Math.PI / 3, -Math.PI / 3]) k.add(box(0.5, 0.025, 0.02), m.dark, T(0, 0, -0.03, 0, 0, a));
    k.bake(this.hgaDish);

    // —— robotic arm: azimuth, shoulder, elbow, wrist, turret ——
    const base = new THREE.Group();
    base.position.set(0.35, 0.15, 1.12);
    this.body.add(base);
    k.add(cyl(0.075, 0.15, 22), m.dark, T(0, 0, 0));
    k.add(cyl(0.077, 0.04, 22), m.foil, T(0, 0.06, 0), 5);
    k.bake(base);
    const shoulder = new THREE.Group();
    base.add(shoulder);
    k.add(cylX(0.07, 0.18, 22), m.dark, T(0, 0, 0));
    k.add(cylX(0.072, 0.05, 22), m.foil, T(0.1, 0, 0), 5);
    k.add(rbox(0.09, 0.09, 0.86, 0.02), m.paint, T(0, 0, 0.52), 2);
    k.add(cylZ(0.058, 0.04, 20), m.ti, T(0, 0, 0.1), 4);
    k.add(cylZ(0.058, 0.04, 20), m.ti, T(0, 0, 0.95), 4);
    k.add(cylZ(0.011, 0.8, 8), m.black, T(0.05, 0.035, 0.52));
    k.bake(shoulder);
    const elbow = new THREE.Group();
    elbow.position.z = 1.05;
    shoulder.add(elbow);
    k.add(cylX(0.066, 0.17, 22), m.dark, T(0, 0, 0));
    k.add(rbox(0.08, 0.08, 0.72, 0.018), m.paint, T(0, 0, 0.43), 2);
    k.add(cylZ(0.052, 0.035, 20), m.ti, T(0, 0, 0.08), 4);
    k.add(cylZ(0.052, 0.035, 20), m.ti, T(0, 0, 0.78), 4);
    k.add(cylZ(0.01, 0.66, 8), m.black, T(-0.045, 0.03, 0.43));
    k.bake(elbow);
    const wrist = new THREE.Group();
    wrist.position.z = 0.85;
    elbow.add(wrist);
    k.add(cylX(0.056, 0.14, 20), m.dark, T(0, 0, 0));
    k.add(cylZ(0.042, 0.1, 18), m.ti, T(0, 0, 0.05), 4);
    k.bake(wrist);
    const turret = new THREE.Group();
    turret.position.z = 0.1;
    wrist.add(turret);
    k.add(rbox(0.16, 0.16, 0.13, 0.025, 3), m.foil, T(0, 0, 0), 5);
    // drill housing with its two stabiliser prongs (−y)
    k.add(rbox(0.12, 0.15, 0.12, 0.015), m.paint, T(0, -0.13, 0));
    for (const s of [-1, 1]) k.add(cyl(0.009, 0.14, 8), m.ti, T(s * 0.045, -0.26, 0), 6);
    // close-up imager (+y)
    k.add(rbox(0.07, 0.09, 0.075, 0.01), m.dark, T(0, 0.12, 0));
    k.add(cyl(0.026, 0.02, 18), m.ti, T(0, 0.17, 0), 6);
    k.add(cyl(0.019, 0.012, 18), m.lens, T(0, 0.18, 0));
    // X-ray spectrometer (+x)
    k.add(cylX(0.042, 0.12, 20), m.dark, T(0.14, 0, 0));
    k.add(cylX(0.044, 0.02, 20), m.foil, T(0.18, 0, 0), 5);
    // dust-removal brush (−x)
    k.add(rbox(0.1, 0.08, 0.08, 0.012), m.paint, T(-0.13, 0, 0));
    k.add(cylX(0.03, 0.03, 16), m.black, T(-0.195, 0, 0));
    // scoop and sieve (+z)
    k.add(rbox(0.12, 0.1, 0.13, 0.014), m.paint, T(0, 0, 0.12));
    k.add(rbox(0.1, 0.03, 0.06, 0.008), m.dark, T(0, -0.05, 0.17));
    k.bake(turret);
    // the drill bit: a twisted hexagonal prism, so its spin is visible
    const bit = new THREE.CylinderGeometry(0.02, 0.016, 0.26, 6, 8);
    const bp = bit.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < bp.count; i++) {
      const y = bp.getY(i);
      const a = y * 28;
      const x = bp.getX(i);
      const z = bp.getZ(i);
      bp.setXYZ(i, x * Math.cos(a) - z * Math.sin(a), y, x * Math.sin(a) + z * Math.cos(a));
    }
    bit.computeVertexNormals();
    const drill = new THREE.Mesh(bit, m.ti);
    drill.position.set(0, -0.24, 0);
    drill.castShadow = true;
    turret.add(drill);
    this.geos.push(bit);
    this.arm = { base, shoulder, elbow, wrist, turret, drill };

    // —— rocker-bogie and wheels ——
    const wheel = buildWheel(m);
    const legSteer = buildLeg(m, true);
    const legFixed = buildLeg(m, false);
    for (const g of [...wheel.values(), ...legSteer.values(), ...legFixed.values()]) this.geos.push(g);
    const meshesOf = (geos: Map<THREE.Material, THREE.BufferGeometry>) =>
      [...geos].map(([mat, g]) => {
        const mesh = new THREE.Mesh(g, mat);
        mesh.castShadow = mesh.receiveShadow = true;
        return mesh;
      });
    for (let i = 0; i < 6; i++) {
      const steer = new THREE.Group();
      this.root.add(steer);
      const spin = new THREE.Group();
      const side = ROVER.mounts[i][0] > 0 ? 1 : -1;
      // the spoked face points outward on both sides
      const flip = new THREE.Group();
      flip.scale.x = side;
      spin.add(...meshesOf(wheel));
      flip.add(spin);
      const leg = new THREE.Group();
      leg.add(...meshesOf(ROVER.steerable[i] ? legSteer : legFixed));
      flip.add(leg);
      steer.add(flip);
      this.wheels.push({ steer, spin, leg });
    }
    // linkage tubes per side: rocker (pivot→front, pivot→bogie), bogie (→middle, →rear), differential link
    const linkGeo = (r: number) => {
      const g = new THREE.CylinderGeometry(r, r, 1, 14, 1);
      this.geos.push(g);
      return g;
    };
    const rocker = linkGeo(0.042);
    const bogie = linkGeo(0.036);
    const diffLink = linkGeo(0.016);
    for (let s = 0; s < 2; s++) {
      for (const g of [rocker, rocker, bogie, bogie, diffLink]) {
        const mesh = new THREE.Mesh(g, m.ti);
        mesh.castShadow = true;
        this.root.add(mesh);
        this.links.push(mesh);
      }
      const joint = new THREE.Mesh(linkGeo(0.06), m.dark);
      joint.castShadow = true;
      this.root.add(joint);
      this.bogieJoints.push(joint);
    }
    // differential bar across the deck: rocks as the two rockers move against each other
    this.diff.position.set(0, DY + 0.045, -0.2);
    this.body.add(this.diff);
    k.add(rbox(1.8, 0.035, 0.05, 0.012), m.ti, T(0, 0, 0), 4);
    k.add(cyl(0.06, 0.06, 20), m.dark, T(0, -0.01, 0));
    for (const s of [-1, 1]) k.add(cyl(0.028, 0.06, 14), m.dark, T(s * 0.9, 0, 0));
    k.bake(this.diff);
    k.add(cyl(0.07, 0.03, 20), m.ti, T(0, DY + 0.015, -0.2), 4);
    k.bake(this.body);

    // work lights (off by default)
    for (const x of [-0.5, 0.5]) {
      const l = new THREE.SpotLight("#fff3e0", 0, 60, 0.55, 0.5, 1.5);
      l.position.set(x, 0.1, 1.15);
      l.target.position.set(x * 2, -1.5, 9);
      this.body.add(l, l.target);
      this.lights.push(l);
    }
  }

  /** settle the dust colour for this world (the rover gets dirtier as it drives) */
  setDust(color: string) {
    this.dustColor.set(color);
  }

  setLights(on: boolean) {
    for (const l of this.lights) l.intensity = on ? 60 : 0;
  }

  private placeLink(mesh: THREE.Mesh, a: THREE.Vector3, b: THREE.Vector3) {
    const d = _d.subVectors(b, a);
    const len = d.length();
    mesh.position.copy(a).addScaledVector(d, 0.5);
    mesh.scale.set(1, Math.max(0.01, len), 1);
    mesh.quaternion.setFromUnitVectors(_Y, d.divideScalar(Math.max(len, 1e-6)));
  }

  /**
   * Pose the model from the sim (or from a kinematic pose during the landing).
   * `standing` (0..1) tucks the wheels under the belly as they were for the cruise.
   */
  update(dt: number, sim: RoverSim | null, pose?: { pos: THREE.Vector3; quat: THREE.Quaternion }, sinkK = 0) {
    const pos = sim && sim.enabled ? sim.pos : pose!.pos;
    const quat = sim && sim.enabled ? sim.quat : pose!.quat;
    this.root.position.set(0, 0, 0);
    this.body.position.copy(pos);
    this.body.quaternion.copy(quat);
    this.body.updateMatrixWorld();
    const M = this.body.matrixWorld;
    const up = _up.set(0, 1, 0).applyQuaternion(quat);
    const xAxis = _x.set(1, 0, 0).applyQuaternion(quat);
    const fold = 1 - this.standing;

    for (let i = 0; i < 6; i++) {
      const w = this.wheels[i];
      const mount = ROVER.mounts[i];
      const side = mount[0] > 0 ? 1 : -1;
      const simW = sim?.enabled ? sim.wheels[i] : null;
      // stowed: wheels pulled up and in under the chassis
      const len = lerp(simW ? simW.len : ROVER.restLen, 0.22, fold);
      const hub = _hubs[i].set(mount[0] * (1 - fold * 0.3), mount[1] - len, mount[2] * (1 - fold * 0.12)).applyMatrix4(M);
      if (simW?.contact) hub.addScaledVector(up, -sinkK * Math.min(1, simW.load / 4000));
      w.steer.position.copy(hub);
      w.steer.quaternion.copy(quat).multiply(_q.setFromAxisAngle(_Y, simW ? simW.steer : 0));
      if (simW) w.spin.rotation.x = simW.spin;
      // where the leg meets the rocker or bogie
      const top = _tops[i].copy(hub);
      if (ROVER.steerable[i]) top.addScaledVector(up, LEG_TOP_STEER);
      else top.addScaledVector(up, LEG_TOP_FIXED).addScaledVector(xAxis, -side * LEG_INBOARD);
    }
    for (let s = 0; s < 2; s++) {
      const sx = s === 0 ? 1 : -1;
      const pivot = _pivot.set(sx * 0.9, 0.06, 0.28).applyMatrix4(M);
      const front = _tops[s];
      const middle = _tops[2 + s];
      const rear = _tops[4 + s];
      const bogie = _bogie.copy(middle).add(rear).multiplyScalar(0.5).addScaledVector(up, 0.17);
      const L = s * 5;
      this.placeLink(this.links[L], pivot, front);
      this.placeLink(this.links[L + 1], pivot, bogie);
      this.placeLink(this.links[L + 2], bogie, middle);
      this.placeLink(this.links[L + 3], bogie, rear);
      // differential link: bar end down to the rocker just behind its pivot
      const barEnd = this.diff.localToWorld(_barEnd.set(sx * 0.9, 0, 0));
      const onRocker = _onRocker.copy(pivot).lerp(bogie, 0.22);
      this.placeLink(this.links[L + 4], barEnd, onRocker);
      const j = this.bogieJoints[s];
      j.position.copy(bogie);
      j.quaternion.copy(quat).multiply(_q.setFromAxisAngle(_Z, Math.PI / 2));
      j.scale.set(1, 0.12, 1);
    }
    // differential: the bar rocks with the difference between the rockers
    if (sim?.enabled) {
      const dl = sim.wheels[4].comp - (sim.wheels[0].comp + sim.wheels[2].comp) / 2;
      const dr = sim.wheels[5].comp - (sim.wheels[1].comp + sim.wheels[3].comp) / 2;
      this.diff.rotation.y = clamp((dl - dr) * 0.8, -0.25, 0.25);
    }

    // mast: folds flat on the deck for the cruise, stands and scans once deployed
    const d = this.deploy;
    this.mast.rotation.x = lerp(-Math.PI / 2 + 0.05, 0, clamp(d * 1.6, 0, 1));
    const aim = this.mastAim;
    const idle = performance.now() / 1000;
    const ty = aim ? aim.yaw : Math.sin(idle * 0.23) * 0.7;
    const tp = aim ? aim.pitch : -0.18 + Math.sin(idle * 0.31) * 0.1;
    this.mastYaw = damp(this.mastYaw, ty, aim ? 10 : 1.2, dt);
    this.mastPitch = damp(this.mastPitch, tp, aim ? 10 : 1.2, dt);
    this.mastHead.rotation.y = this.mastYaw * clamp(d * 2 - 1, 0, 1);
    this.mastTilt.rotation.x = -this.mastPitch * clamp(d * 2 - 1, 0, 1);
    // HGA unfolds, then keeps pointing at Earth
    this.hga.rotation.x = lerp(-Math.PI / 2, 0, clamp(d * 2 - 0.6, 0, 1));

    // arm: stowed across the front, or reaching to the ground for a sample
    this.armPose = damp(this.armPose, this.armTarget, 1.6, dt);
    const p = this.armPose;
    const a = this.arm;
    a.base.rotation.y = lerp(-1.25, 0, p);
    a.shoulder.rotation.x = lerp(0.05, 0.55, p);
    a.elbow.rotation.x = lerp(-2.6, -0.2, p);
    a.wrist.rotation.x = lerp(2.4, 1.2, p);
    this.drillSpin += dt * (p > 0.92 && this.armTarget > 0.5 ? 40 : 0);
    a.drill.rotation.y = this.drillSpin;

    // dust settles on everything with distance driven
    const k = clamp(this.dust, 0, 0.55);
    for (const key of Object.keys(DUSTY) as MatKey[]) this.m[key].color.copy(this.clean[key]!).lerp(this.dustColor, k * DUSTY[key]!);
  }

  /** point the HGA at a direction in world space (Earth) */
  aimHGA(dirWorld: THREE.Vector3) {
    const local = _d.copy(dirWorld).applyQuaternion(_q.copy(this.body.quaternion).invert());
    const yaw = Math.atan2(local.x, local.z);
    const pitch = Math.atan2(local.y, Math.hypot(local.x, local.z));
    this.hgaDish.rotation.set(0, 0, 0);
    this.hgaDish.rotateY(yaw);
    this.hgaDish.rotateX(-pitch);
  }

  /** world position of the mast camera (for the Navcam view) */
  mastCamera(out: THREE.Vector3) {
    return this.mastTilt.getWorldPosition(out);
  }

  drillTip(out: THREE.Vector3) {
    return this.arm.drill.localToWorld(out.set(0, -0.16, 0));
  }

  dispose() {
    this.geos.forEach((g) => g.dispose());
    this.root.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (mesh.isMesh) mesh.geometry.dispose();
    });
    Object.values(this.m).forEach((m) => {
      m.map?.dispose();
      m.bumpMap?.dispose();
      m.normalMap?.dispose();
      m.roughnessMap?.dispose();
      m.dispose();
    });
  }
}

const _Y = new THREE.Vector3(0, 1, 0);
const _Z = new THREE.Vector3(0, 0, 1);
const _q = new THREE.Quaternion();
const _d = new THREE.Vector3();
const _up = new THREE.Vector3();
const _x = new THREE.Vector3();
const _pivot = new THREE.Vector3();
const _bogie = new THREE.Vector3();
const _barEnd = new THREE.Vector3();
const _onRocker = new THREE.Vector3();
const _hubs = Array.from({ length: 6 }, () => new THREE.Vector3());
const _tops = Array.from({ length: 6 }, () => new THREE.Vector3());
