import * as THREE from "three";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import { faceTexture, torsoTexture, type TorsoPrint } from "./print";
import { studGeometry } from "./geometry";
import { C } from "./units";

const plastic = (color: string, map?: THREE.Texture) =>
  new THREE.MeshPhysicalMaterial({ color: map ? 0xffffff : color, ...(map ? { map } : {}), roughness: 0.28, clearcoat: 0.55, clearcoatRoughness: 0.2, specularIntensity: 0.6, envMapIntensity: 0.85 });

const lathe = (pts: [number, number][], segments = 40, phiStart = 0) =>
  new THREE.LatheGeometry(
    pts.map(([r, y]) => new THREE.Vector2(Math.max(r, 0.0001), y)),
    segments,
    phiStart,
  );

/** A torso: wider at the hips than the shoulders, like the real moulding. */
function torsoGeometry(bottom: number, top: number, height: number, depth: number) {
  const g = new RoundedBoxGeometry(1, height, depth, 2, 0.04);
  const pos = g.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i);
    const t = (y + height / 2) / height;
    pos.setX(i, pos.getX(i) * (bottom + (top - bottom) * t));
  }
  g.computeVertexNormals();
  return g;
}

type Style = { legs: string; torso: string; arms: string; print: TorsoPrint; hat: "hair" | "helmet"; hair: string; glasses?: boolean; waves: boolean };

/** The cast: you, a site builder, the studio's analyst, and someone waving you in to say hello. */
export const STYLES: Style[] = [
  { legs: C.darkBlue, torso: C.black, arms: C.black, print: "hoodie", hat: "hair", hair: "#2a1a12", waves: true },
  { legs: C.darkBluishGray, torso: C.orange, arms: C.white, print: "vest", hat: "helmet", hair: C.yellow, waves: false },
  { legs: C.darkTan, torso: C.white, arms: C.white, print: "shirt", hat: "hair", hair: C.black, glasses: true, waves: false },
  { legs: C.black, torso: C.red, arms: C.red, print: "hello", hat: "hair", hair: "#e9c46a", waves: true },
];

/**
 * A minifigure: ~4.7 studs tall, two studs wide at the hips, built from the same parts a real one
 * snaps together from. Origin is the middle of its rigid body (2.4 up). `animate` waves the raised
 * arm (or, for the ones who don't wave, glances about) while it's standing.
 */
export function buildMinifig(maxAniso: number, styleIndex = 0) {
  const style = STYLES[styleIndex % STYLES.length];
  const fig = new THREE.Group();
  const body = new THREE.Group();
  body.position.y = -2.4;
  fig.add(body);
  const add = (geo: THREE.BufferGeometry, mat: THREE.Material, parent: THREE.Object3D = body) => {
    const m = new THREE.Mesh(geo, mat);
    m.castShadow = true;
    m.receiveShadow = true;
    parent.add(m);
    return m;
  };

  const legs = plastic(style.legs);
  const skin = plastic(C.yellow);
  const sleeves = plastic(style.arms);
  const torsoMat = plastic(style.torso);
  const hair = plastic(style.hair);

  // legs, each with a foot that juts forward, under a hip block
  for (const s of [-1, 1]) {
    const leg = add(new RoundedBoxGeometry(0.9, 1.3, 0.8, 2, 0.05), legs);
    leg.position.set(s * 0.48, 0.85, 0);
    const foot = add(new RoundedBoxGeometry(0.9, 0.3, 1.0, 2, 0.05), legs);
    foot.position.set(s * 0.48, 0.15, 0.08);
  }
  add(new RoundedBoxGeometry(1.94, 0.32, 0.82, 2, 0.05), legs).position.set(0, 1.62, 0);

  // torso with its print on the front
  const torso = add(torsoGeometry(1.94, 1.42, 1.5, 0.82), torsoMat);
  torso.position.set(0, 2.53, 0);
  const printGeo = new THREE.BufferGeometry();
  const bw = 1.84 / 2;
  const tw = 1.34 / 2;
  printGeo.setAttribute("position", new THREE.Float32BufferAttribute([-bw, -0.7, 0, bw, -0.7, 0, tw, 0.7, 0, -tw, 0.7, 0], 3));
  printGeo.setAttribute("uv", new THREE.Float32BufferAttribute([0, 0, 1, 0, 1, 1, 0, 1], 2));
  printGeo.setAttribute("normal", new THREE.Float32BufferAttribute([0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1], 3));
  printGeo.setIndex([0, 1, 2, 0, 2, 3]);
  const print = add(printGeo, plastic(style.torso, torsoTexture(maxAniso, style.print, style.torso)));
  print.castShadow = false;
  print.position.set(0, 2.53, 0.416);

  // neck, then the head (face wrapped round, u = 0.5 forward) with its hair or hat, all turning together
  add(lathe([[0.26, 0], [0.26, 0.14]], 24), skin).position.y = 3.28;
  const head = new THREE.Group();
  head.position.y = 3.4;
  body.add(head);
  add(
    lathe([[0, 0], [0.4, 0], [0.5, 0.04], [0.56, 0.14], [0.57, 0.3], [0.57, 0.72], [0.56, 0.86], [0.5, 0.96], [0.4, 1.0], [0, 1.0]], 48, Math.PI),
    plastic(C.yellow, faceTexture(maxAniso, style.glasses)),
    head,
  );
  add(studGeometry(20, 0.3, 0.16), skin, head).position.y = 1.0;
  if (style.hat === "helmet") {
    // a construction hard hat: dome, ridge and brim
    add(lathe([[0.82, 0.6], [0.82, 0.65], [0.64, 0.68], [0.66, 0.86], [0.58, 1.06], [0.38, 1.2], [0, 1.24]], 40), hair, head);
    const ridge = add(new RoundedBoxGeometry(0.16, 0.12, 1.2, 2, 0.04), hair, head);
    ridge.position.y = 1.2;
  } else {
    add(lathe([[0.64, 0.6], [0.66, 0.72], [0.63, 0.92], [0.52, 1.07], [0.3, 1.15], [0.0, 1.16]], 40), hair, head);
    // a fringe swept to one side, and the back of the hair down to the neck
    const fringe = add(new THREE.SphereGeometry(0.42, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2), hair, head);
    fringe.scale.set(1.25, 0.45, 0.9);
    fringe.position.set(0.12, 0.96, 0.2);
    fringe.rotation.z = -0.25;
    const back = add(new THREE.CylinderGeometry(0.66, 0.6, 0.55, 32, 1, true, Math.PI * 0.6, Math.PI * 0.8), hair, head);
    back.position.set(0, 0.45, 0);
    back.rotation.y = Math.PI;
  }

  // arms swing from the shoulders; each ends in a C-shaped hand
  const arm = (side: number) => {
    const shoulder = new THREE.Group();
    shoulder.position.set(side * 0.74, 3.08, 0);
    body.add(shoulder);
    const upper = add(new THREE.CylinderGeometry(0.21, 0.24, 1.0, 20), sleeves, shoulder);
    upper.position.set(side * 0.12, -0.45, 0.04);
    upper.rotation.z = side * 0.22;
    const wrist = add(new THREE.CylinderGeometry(0.11, 0.11, 0.22, 16), skin, shoulder);
    wrist.position.set(side * 0.24, -1.02, 0.1);
    wrist.rotation.z = side * 0.22;
    const hand = add(new THREE.TorusGeometry(0.17, 0.085, 12, 24, Math.PI * 1.55), skin, shoulder);
    hand.position.set(side * 0.27, -1.24, 0.14);
    hand.rotation.set(Math.PI / 2, 0, side * 0.6);
    return shoulder;
  };
  const left = arm(-1);
  const right = arm(1);

  let t0 = 0;
  const seed = styleIndex * 1.7;
  const animate = (t: number, standing: boolean) => {
    if (!standing) {
      right.rotation.z *= 0.8;
      left.rotation.x *= 0.8;
      head.rotation.y *= 0.8;
      t0 = t;
      return;
    }
    const k = Math.min(1, (t - t0) / 0.8);
    if (style.waves) {
      // a slow raise, then a friendly side-to-side wave
      right.rotation.z = k * (2.5 + Math.sin(t * 7 + seed) * 0.32);
      right.rotation.x = -k * 0.2;
    } else {
      // standing about: arms swinging a touch, looking one way then the other
      left.rotation.x = Math.sin(t * 1.3 + seed) * 0.12 * k;
      right.rotation.x = -Math.sin(t * 1.3 + seed) * 0.12 * k;
    }
    head.rotation.y = Math.sin(t * 0.45 + seed) * 0.35 * k;
  };
  return { fig, animate };
}
