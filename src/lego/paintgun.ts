import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import { PAINTS } from "./paint";

/**
 * Built in centimetres, as the real thing would be (a .68 ball is 1.73 cm across), then scaled
 * down to sit in front of the lens. Gun frame: +z down the barrel, +y up, +x to its right.
 */
const CM = 0.043;
/** where the barrel ends (the muzzle), in the gun's frame */
const MUZZLE_Z = 38.6;
const BALL = 0.865;
const HOPPER = { x: 0, y: 10.6, z: -0.8, rx: 4.7, ry: 4.3, rz: 7.4 };
export const HOPPER_CAPACITY = 110;

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const damp = (a: number, b: number, rate: number, dt: number) => lerp(a, b, 1 - Math.exp(-rate * dt));

function canvasTexture(w: number, h: number, draw: (ctx: CanvasRenderingContext2D) => void, aniso: number, color = true) {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  draw(c.getContext("2d")!);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = color ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.anisotropy = aniso;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

/** 2 × 2 twill carbon fibre: tows of fine fibres, alternating direction, under a deep clear coat. */
function carbonTexture(aniso: number) {
  const t = canvasTexture(
    256,
    256,
    (ctx) => {
      ctx.fillStyle = "#0b0c0e";
      ctx.fillRect(0, 0, 256, 256);
      const tow = 32;
      for (let i = 0; i < 8; i++)
        for (let j = 0; j < 8; j++) {
          // twill: the over/under shifts one tow each row
          const across = Math.floor((i + j) / 2) % 2 === 0;
          const x = i * tow;
          const y = j * tow;
          const g = ctx.createLinearGradient(x, y, across ? x : x + tow, across ? y + tow : y);
          g.addColorStop(0, "#15171b");
          g.addColorStop(0.5, across ? "#3b3f47" : "#2a2d33");
          g.addColorStop(1, "#121316");
          ctx.fillStyle = g;
          ctx.fillRect(x + 0.6, y + 0.6, tow - 1.2, tow - 1.2);
          ctx.strokeStyle = "rgba(255,255,255,0.05)";
          ctx.lineWidth = 0.6;
          for (let k = 2; k < tow; k += 2.2) {
            ctx.beginPath();
            if (across) {
              ctx.moveTo(x + k, y + 1);
              ctx.lineTo(x + k, y + tow - 1);
            } else {
              ctx.moveTo(x + 1, y + k);
              ctx.lineTo(x + tow - 1, y + k);
            }
            ctx.stroke();
          }
        }
    },
    aniso,
  );
  t.repeat.set(7, 16);
  return t;
}

/** Stippled rubber for the grips: a dense field of little raised dots (as a bump map). */
function stippleTexture(aniso: number) {
  const t = canvasTexture(
    128,
    128,
    (ctx) => {
      ctx.fillStyle = "#000";
      ctx.fillRect(0, 0, 128, 128);
      let seed = 4;
      const rand = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
      for (let y = 0; y < 128; y += 6)
        for (let x = (y / 6) % 2 ? 3 : 0; x < 128; x += 6) {
          const g = ctx.createRadialGradient(x, y, 0, x, y, 2.6);
          g.addColorStop(0, `rgba(255,255,255,${0.75 + rand() * 0.25})`);
          g.addColorStop(1, "rgba(255,255,255,0)");
          ctx.fillStyle = g;
          ctx.fillRect(x - 3, y - 3, 6, 6);
        }
    },
    aniso,
    false,
  );
  t.repeat.set(3, 3);
  return t;
}

/** Fine machining marks round a turned part, so highlights streak the way they do on metal. */
function turnedTexture(aniso: number) {
  const t = canvasTexture(
    16,
    512,
    (ctx) => {
      ctx.fillStyle = "#fff";
      ctx.fillRect(0, 0, 16, 512);
      let seed = 9;
      const rand = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
      for (let i = 0; i < 420; i++) {
        ctx.fillStyle = `rgba(0,0,0,${0.03 + rand() * 0.07})`;
        ctx.fillRect(0, rand() * 512, 16, 0.5 + rand());
      }
    },
    aniso,
    false,
  );
  return t;
}

/** The pressure gauge: a white dial, ticks, a red zone and the needle at about 4,000 psi. */
function gaugeTexture(aniso: number) {
  return canvasTexture(
    256,
    256,
    (ctx) => {
      ctx.fillStyle = "#f4f2ec";
      ctx.beginPath();
      ctx.arc(128, 128, 126, 0, Math.PI * 2);
      ctx.fill();
      const a0 = Math.PI * 0.75;
      const a1 = Math.PI * 2.25;
      ctx.strokeStyle = "#c81e1e";
      ctx.lineWidth = 12;
      ctx.beginPath();
      ctx.arc(128, 128, 96, a0 + (a1 - a0) * 0.82, a1);
      ctx.stroke();
      ctx.strokeStyle = "#18191c";
      for (let i = 0; i <= 30; i++) {
        const a = a0 + ((a1 - a0) * i) / 30;
        const big = i % 5 === 0;
        ctx.lineWidth = big ? 4 : 2;
        ctx.beginPath();
        ctx.moveTo(128 + Math.cos(a) * (big ? 84 : 92), 128 + Math.sin(a) * (big ? 84 : 92));
        ctx.lineTo(128 + Math.cos(a) * 104, 128 + Math.sin(a) * 104);
        ctx.stroke();
      }
      ctx.fillStyle = "#18191c";
      ctx.font = "700 26px ui-sans-serif, system-ui, sans-serif";
      ctx.textAlign = "center";
      ctx.fillText("PSI", 128, 176);
      ctx.font = "600 15px ui-sans-serif, system-ui, sans-serif";
      ctx.fillText("x1000", 128, 198);
      const n = a0 + (a1 - a0) * 0.74;
      ctx.strokeStyle = "#d4171b";
      ctx.lineWidth = 5;
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.moveTo(128 - Math.cos(n) * 18, 128 - Math.sin(n) * 18);
      ctx.lineTo(128 + Math.cos(n) * 92, 128 + Math.sin(n) * 92);
      ctx.stroke();
      ctx.fillStyle = "#222";
      ctx.beginPath();
      ctx.arc(128, 128, 11, 0, Math.PI * 2);
      ctx.fill();
    },
    aniso,
  );
}

/** Laser etching on the body: the name and a few lines of fine print, pale on clear. */
function etchTexture(aniso: number) {
  return canvasTexture(
    512,
    128,
    (ctx) => {
      ctx.clearRect(0, 0, 512, 128);
      ctx.fillStyle = "rgba(235,238,242,0.92)";
      ctx.font = "800 italic 64px ui-sans-serif, system-ui, sans-serif";
      ctx.textBaseline = "middle";
      ctx.fillText("BRICKSHOT", 14, 52);
      ctx.font = "600 19px ui-monospace, monospace";
      ctx.fillStyle = "rgba(235,238,242,0.6)";
      ctx.fillText("PX-68  ·  CAL .68  ·  ELECTRONIC", 18, 104);
    },
    aniso,
  );
}

/** The tank's label: rating, fill pressure and a warning band. */
function labelTexture(aniso: number) {
  return canvasTexture(
    512,
    160,
    (ctx) => {
      ctx.fillStyle = "#f2f1ec";
      ctx.fillRect(0, 0, 512, 160);
      ctx.fillStyle = "#e5241b";
      ctx.fillRect(0, 0, 512, 26);
      ctx.fillRect(0, 134, 512, 26);
      ctx.fillStyle = "#14161a";
      ctx.font = "800 46px ui-sans-serif, system-ui, sans-serif";
      ctx.textBaseline = "middle";
      ctx.fillText("68/4500", 22, 72);
      ctx.font = "600 17px ui-monospace, monospace";
      ctx.fillText("CARBON FIBER · HPA ONLY", 24, 112);
      ctx.fillStyle = "#fff";
      ctx.font = "700 14px ui-sans-serif, system-ui, sans-serif";
      ctx.fillText("HIGH PRESSURE · DO NOT EXCEED 4500 PSI", 22, 14);
    },
    aniso,
  );
}

/**
 * A tournament paintball marker, held at the hip of the view: a machined aluminium body with a
 * clamping feed neck and a smoked loader full of real balls on top, a two-piece barrel ported at
 * the tip, a stippled grip frame with a blade trigger, a front grip over the regulator, and a
 * carbon-fibre air tank for a stock, with a gauge and a little OLED screen on the back of the
 * body that counts what's left.
 *
 * It points wherever you aim, kicks on every shot, the trigger and bolt move, and the balls in
 * the loader go down (and jostle) as they're fed.
 */
export class PaintGun {
  readonly root = new THREE.Group();
  /** 0 holstered … 1 up and ready */
  shown = 0;
  ammo = HOPPER_CAPACITY;
  color = 0;
  private gun = new THREE.Group();
  private kick = new THREE.Group();
  private trigger = new THREE.Group();
  private bolt: THREE.Mesh;
  private balls: THREE.InstancedMesh;
  private ballPos: THREE.Vector3[] = [];
  private ballJig: Float32Array;
  private ledMat: THREE.MeshBasicMaterial;
  private screenCtx: CanvasRenderingContext2D;
  private screenTex: THREE.CanvasTexture;
  private screenKey = "";
  private materials: THREE.Material[] = [];
  private recoil = 0;
  private recoilV = 0;
  private pull = 0;
  private feed = 0;
  private reload = -1;
  private bps = 0;
  private shotTimes: number[] = [];
  private aim = new THREE.Quaternion();
  private aimed = false;
  private m = new THREE.Matrix4();
  private v = new THREE.Vector3();
  private q = new THREE.Quaternion();
  private s = new THREE.Vector3();

  constructor(aniso: number) {
    this.root.add(this.gun);
    this.gun.add(this.kick);
    this.gun.scale.setScalar(CM);
    this.root.visible = false;

    const own = <T extends THREE.Material>(m: T) => (this.materials.push(m), m);
    const turned = turnedTexture(aniso);
    // polished black anodising and a blaze-orange accent, both dyed under a hard clear skin
    const black = own(new THREE.MeshPhysicalMaterial({ color: "#121318", metalness: 0.85, roughness: 0.24, roughnessMap: turned, clearcoat: 1, clearcoatRoughness: 0.06, envMapIntensity: 2.4 }));
    const dust = own(new THREE.MeshPhysicalMaterial({ color: "#26282e", metalness: 0.8, roughness: 0.55, clearcoat: 0.3, clearcoatRoughness: 0.5, envMapIntensity: 1.8 }));
    const accent = own(new THREE.MeshPhysicalMaterial({ color: "#ff5a12", metalness: 0.75, roughness: 0.22, roughnessMap: turned, clearcoat: 1, clearcoatRoughness: 0.05, envMapIntensity: 2.4 }));
    const steel = own(new THREE.MeshPhysicalMaterial({ color: "#d9dbe0", metalness: 1, roughness: 0.18, roughnessMap: turned, envMapIntensity: 3 }));
    const polymer = own(new THREE.MeshPhysicalMaterial({ color: "#16171b", roughness: 0.58, clearcoat: 0.15, clearcoatRoughness: 0.6, envMapIntensity: 1 }));
    const rubber = own(new THREE.MeshStandardMaterial({ color: "#0f1012", roughness: 0.92, bumpMap: stippleTexture(aniso), bumpScale: 2.2, envMapIntensity: 0.5 }));
    const rubberPlain = own(new THREE.MeshStandardMaterial({ color: "#121315", roughness: 0.85, envMapIntensity: 0.5 }));
    const carbon = own(new THREE.MeshPhysicalMaterial({ map: carbonTexture(aniso), roughness: 0.38, metalness: 0.2, clearcoat: 1, clearcoatRoughness: 0.03, envMapIntensity: 2 }));
    const bore = own(new THREE.MeshBasicMaterial({ color: "#020203" }));
    const smokedBack = own(new THREE.MeshPhysicalMaterial({ color: "#0c0f13", transparent: true, opacity: 0.5, roughness: 0.05, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.03, envMapIntensity: 3.5, depthWrite: false, side: THREE.BackSide }));
    const smoked = own(new THREE.MeshPhysicalMaterial({ color: "#0c0f13", transparent: true, opacity: 0.46, roughness: 0.04, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.02, envMapIntensity: 4, depthWrite: false, side: THREE.FrontSide }));
    const label = own(new THREE.MeshPhysicalMaterial({ map: labelTexture(aniso), roughness: 0.35, clearcoat: 1, clearcoatRoughness: 0.05, envMapIntensity: 1.5 }));
    const gauge = own(new THREE.MeshPhysicalMaterial({ map: gaugeTexture(aniso), roughness: 0.3, clearcoat: 1, clearcoatRoughness: 0.02 }));
    const etch = own(new THREE.MeshBasicMaterial({ map: etchTexture(aniso), transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 }));
    this.ledMat = own(new THREE.MeshBasicMaterial({ color: new THREE.Color("#3dff86").multiplyScalar(3) }));
    const shell = own(new THREE.MeshPhysicalMaterial({ color: 0xffffff, roughness: 0.12, clearcoat: 1, clearcoatRoughness: 0.04, sheen: 0.5, sheenColor: new THREE.Color("#ffffff"), envMapIntensity: 1.8 }));

    const k = this.kick;
    const put = (geo: THREE.BufferGeometry, mat: THREE.Material, parent: THREE.Object3D = k, x = 0, y = 0, z = 0) => {
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(x, y, z);
      parent.add(mesh);
      return mesh;
    };
    const rbox = (w: number, h: number, d: number, r: number) => new RoundedBoxGeometry(w, h, d, 3, Math.min(r, w / 2, h / 2, d / 2) * 0.999);
    /** a profile in the gun's side view (z forward, y up), extruded across x and centred */
    const side = (pts: [number, number][], width: number, bevel: number, holes: [number, number][][] = []) => {
      const shape = new THREE.Shape(pts.map(([z, y]) => new THREE.Vector2(z, y)));
      for (const h of holes) shape.holes.push(new THREE.Path(h.map(([z, y]) => new THREE.Vector2(z, y))));
      const g = new THREE.ExtrudeGeometry(shape, { depth: width - bevel * 2, bevelEnabled: true, bevelSize: bevel, bevelThickness: bevel, bevelSegments: 4, curveSegments: 18 });
      g.rotateY(-Math.PI / 2);
      g.translate(width / 2 - bevel, 0, 0);
      g.computeVertexNormals();
      return g;
    };
    /** a turned part from a profile of [radius, z] pairs, lying along the barrel axis */
    const lathe = (pts: [number, number][], seg = 48) => new THREE.LatheGeometry(pts.map(([r, z]) => new THREE.Vector2(Math.max(r, 1e-4), z)), seg).rotateX(Math.PI / 2);
    const vcyl = (r: number, h: number, seg = 40) => new THREE.CylinderGeometry(r, r, h, seg);
    const zcyl = (r: number, h: number, seg = 40) => new THREE.CylinderGeometry(r, r, h, seg).rotateX(Math.PI / 2);

    // ——— the body: machined from billet, its silhouette sloping up to the feed and down at the nose ———
    put(
      side(
        [
          [-12.2, -2.1],
          [-12.2, 1.0],
          [-11.2, 2.15],
          [-4.5, 2.15],
          [-3.0, 2.55],
          [6.2, 2.55],
          [8.6, 1.5],
          [8.6, -1.5],
          [7.4, -2.1],
        ],
        2.9,
        0.42,
      ),
      black,
    );
    // milled pockets down each side, in a darker dust finish, and a groove along the top
    for (const sx of [-1, 1]) {
      for (let i = 0; i < 3; i++) {
        const slot = put(rbox(0.1, 0.62, 3.2, 0.06), dust, k, sx * 1.47, -0.75 + i * 0.95, -6.6 + i * 0.5);
        slot.rotation.x = -0.32;
      }
      put(rbox(0.1, 1.6, 4.8, 0.3), dust, k, sx * 1.47, 0.1, 3.4);
      put(rbox(0.08, 0.16, 7.6, 0.05), accent, k, sx * 1.5, 1.55, 1.2);
      // the etching
      const e = put(new THREE.PlaneGeometry(6.4, 1.6), etch, k, sx * 1.53, -1.25, -5.4);
      e.rotation.y = sx * Math.PI / 2;
    }
    put(rbox(0.6, 0.1, 9.2, 0.04), dust, k, 0, 2.6, 1.6);
    // the ball detents' eyes: a little window each side with the board's LED behind it
    for (const sx of [-1, 1]) {
      put(new THREE.CylinderGeometry(0.42, 0.42, 0.18, 24).rotateZ(Math.PI / 2), steel, k, sx * 1.5, 0.6, 2.8);
      put(new THREE.CylinderGeometry(0.24, 0.24, 0.22, 20).rotateZ(Math.PI / 2), this.ledMat, k, sx * 1.52, 0.6, 2.8);
    }
    // the back cap and the bolt, which slides forward on each shot (seen through its slot)
    put(zcyl(1.05, 0.7), dust, k, 0, -0.6, -12.4);
    put(zcyl(0.6, 0.5), accent, k, 0, -0.6, -12.85);
    put(rbox(0.2, 0.5, 4.6, 0.08), bore, k, -1.45, 0.75, -1.6);
    this.bolt = put(rbox(0.16, 0.36, 1.4, 0.06), steel, k, -1.52, 0.75, -3.0);

    // ——— the screen on the back of the body, tipped back at the eye ———
    {
      const c = document.createElement("canvas");
      c.width = 256;
      c.height = 160;
      this.screenCtx = c.getContext("2d")!;
      this.screenTex = new THREE.CanvasTexture(c);
      this.screenTex.colorSpace = THREE.SRGBColorSpace;
      this.screenTex.anisotropy = aniso;
      const mount = new THREE.Group();
      mount.position.set(0, 1.4, -12.95);
      mount.rotation.x = 0.35;
      k.add(mount);
      put(rbox(2.5, 1.75, 0.3, 0.12), polymer, mount, 0, 0, 0);
      const scr = put(new THREE.PlaneGeometry(2.2, 1.37), own(new THREE.MeshBasicMaterial({ map: this.screenTex })), mount, 0, 0, -0.16);
      scr.rotation.y = Math.PI;
    }

    // ——— the feed neck and its clamp ———
    put(vcyl(1.38, 3.4), black, k, 0, 4.1, 2.6);
    put(vcyl(1.62, 1.2), accent, k, 0, 5.1, 2.6);
    put(new THREE.TorusGeometry(1.62, 0.12, 10, 40).rotateX(Math.PI / 2), steel, k, 0, 5.7, 2.6);
    {
      // the cam lever, folded back along the neck
      const lever = put(rbox(0.36, 0.5, 2.8, 0.16), accent, k, -1.85, 5.1, 1.6);
      lever.rotation.y = 0.12;
      put(new THREE.CylinderGeometry(0.3, 0.3, 0.6, 20).rotateZ(Math.PI / 2), steel, k, -1.75, 5.1, 2.9);
    }

    // ——— the loader: a smoked shell full of paint, with a solid lid and a speed-feed throat ———
    const H = HOPPER;
    put(vcyl(1.25, 2.6), polymer, k, 0, 6.9, 2.4);
    {
      const shellGeo = new THREE.SphereGeometry(1, 64, 40);
      const back = put(shellGeo, smokedBack, k, H.x, H.y, H.z);
      back.scale.set(H.rx, H.ry, H.rz);
      back.renderOrder = 5;
      const front = put(shellGeo, smoked, k, H.x, H.y, H.z);
      front.scale.set(H.rx, H.ry, H.rz);
      front.renderOrder = 7;
      // the upper shell and lid are solid, the base tray too: the paint shows through a smoked
      // window round the middle, with a moulded seam band at its top edge
      const LID = 1.42;
      const TRAY = 2.5;
      const lid = put(new THREE.SphereGeometry(1.025, 64, 28, 0, Math.PI * 2, 0, LID), polymer, k, H.x, H.y, H.z);
      lid.scale.set(H.rx, H.ry, H.rz);
      const tray = put(new THREE.SphereGeometry(1.02, 64, 12, 0, Math.PI * 2, TRAY, Math.PI - TRAY), polymer, k, H.x, H.y, H.z);
      tray.scale.set(H.rx, H.ry, H.rz);
      for (const [a, w] of [
        [LID, 0.06],
        [TRAY, 0.04],
      ]) {
        const seam = put(new THREE.TorusGeometry(1.0, w, 8, 96).rotateX(Math.PI / 2), w > 0.05 ? dust : rubberPlain, k, H.x, H.y + Math.cos(a) * H.ry * 1.02, H.z);
        seam.scale.set(Math.sin(a) * H.rx * 1.03, 1, Math.sin(a) * H.rz * 1.03);
      }
      // the lid's spine: a raised rib front to back
      const rib = put(new THREE.SphereGeometry(1.0, 48, 20, Math.PI * 0.47, Math.PI * 0.06, 0, LID), dust, k, H.x, H.y, H.z);
      rib.scale.set(H.rx * 1.05, H.ry * 1.05, H.rz * 1.05);
      const rib2 = put(new THREE.SphereGeometry(1.0, 48, 20, Math.PI * 1.47, Math.PI * 0.06, 0, LID), dust, k, H.x, H.y, H.z);
      rib2.scale.set(H.rx * 1.05, H.ry * 1.05, H.rz * 1.05);
      put(rbox(1.6, 0.5, 2.4, 0.24), accent, k, H.x, H.y + H.ry * 0.89 + 0.2, H.z + 3.4).rotation.x = 0.42;
      // a strip of ribbing round the front for the hand that holds it
      put(rbox(2.8, 0.5, 0.9, 0.2), rubberPlain, k, H.x, H.y - 1.0, H.z + H.rz - 0.3).rotation.x = -0.5;
    }
    // the balls: packed in from the bottom of the shell, each nestled against the ones below
    {
      let seed = 13;
      const rand = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
      // the shell, shrunk by a ball's radius: where a ball's centre may be
      const ex = H.rx - BALL * 1.05;
      const ey = H.ry - BALL * 1.05;
      const ez = H.rz - BALL * 1.05;
      const D = BALL * 1.98;
      const best = new THREE.Vector3();
      while (this.ballPos.length < HOPPER_CAPACITY) {
        // drop a few balls in from above at random and keep whichever comes to rest lowest
        let found = false;
        for (let c = 0; c < 40; c++) {
          const x = (rand() * 2 - 1) * ex;
          const z = (rand() * 2 - 1) * ez;
          const r2 = (x / ex) ** 2 + (z / ez) ** 2;
          if (r2 >= 1) continue;
          let y = -ey * Math.sqrt(1 - r2);
          for (const b of this.ballPos) {
            const dh2 = (b.x - H.x - x) ** 2 + (b.z - H.z - z) ** 2;
            if (dh2 < D * D) y = Math.max(y, b.y - H.y + Math.sqrt(D * D - dh2));
          }
          if ((x / ex) ** 2 + (y / ey) ** 2 + (z / ez) ** 2 > 1 || y > ey * 0.5) continue;
          if (!found || y < best.y - H.y) best.set(H.x + x, H.y + y, H.z + z);
          found = true;
        }
        if (!found) break;
        this.ballPos.push(best.clone());
      }
      // the lowest go first: they're the ones that feed
      this.ballPos.sort((a, b) => b.y - a.y);
      this.ballJig = new Float32Array(this.ballPos.length);
      this.balls = new THREE.InstancedMesh(new THREE.SphereGeometry(BALL, 16, 12), shell, this.ballPos.length);
      this.balls.frustumCulled = false;
      this.balls.renderOrder = 6;
      this.ballPos.forEach((p, i) => this.balls.setMatrixAt(i, this.m.makeTranslation(p.x, p.y, p.z)));
      k.add(this.balls);
    }

    // ——— the barrel: a back with a thread and knurled rings, a polished front, a ported tip ———
    put(
      lathe([
        [0, 8.4],
        [1.36, 8.4],
        [1.36, 9.1],
        [1.24, 9.25],
        [1.24, 14.6],
        [1.08, 15.0],
        [0, 15.0],
      ]),
      black,
    );
    for (let i = 0; i < 4; i++) put(new THREE.TorusGeometry(1.25, 0.07, 8, 48), dust, k, 0, 0, 10.0 + i * 0.32);
    put(
      lathe([
        [0, 14.9],
        [1.02, 14.9],
        [0.98, 15.3],
        [0.95, 32.5],
        [0, 32.5],
      ]),
      black,
    );
    put(
      lathe([
        [0, 32.4],
        [0.98, 32.4],
        [0.98, MUZZLE_Z - 0.3],
        [0.92, MUZZLE_Z],
        [0.72, MUZZLE_Z],
        [0.72, MUZZLE_Z - 0.6],
        [0, MUZZLE_Z - 0.6],
      ]),
      accent,
    );
    put(new THREE.CircleGeometry(0.72, 32), bore, k, 0, 0, MUZZLE_Z - 0.58);
    {
      // the porting: rows of drilled holes spiralling round the tip
      const holes: THREE.BufferGeometry[] = [];
      for (let row = 0; row < 6; row++)
        for (let j = 0; j < 8; j++) {
          const a = (j / 8) * Math.PI * 2 + row * 0.39;
          const g = new THREE.CircleGeometry(0.17, 14);
          g.lookAt(new THREE.Vector3(Math.cos(a), Math.sin(a), 0));
          g.translate(Math.cos(a) * 0.99, Math.sin(a) * 0.99, 33.3 + row * 0.82);
          holes.push(g);
        }
      put(mergeGeometries(holes)!, bore);
    }

    // ——— the grip frame: a moulded frame with a raked grip, a trigger guard and rubber panels ———
    put(
      side(
        [
          [-9.8, -1.9],
          [-11.2, -12.4],
          [-10.6, -13.2],
          [-6.2, -13.2],
          [-5.2, -12.2],
          [-4.3, -4.5],
          [-3.0, -3.2],
          [5.2, -3.2],
          [5.6, -1.9],
        ],
        2.5,
        0.4,
      ),
      polymer,
    );
    // finger grooves down the front of the grip
    for (let i = 0; i < 3; i++) put(new THREE.CylinderGeometry(0.42, 0.42, 2.3, 20).rotateZ(Math.PI / 2), polymer, k, 0, -6.4 - i * 2.0, -4.55 - i * 0.22);
    for (const sx of [-1, 1]) {
      const panel = put(
        side(
          [
            [-9.7, -3.0],
            [-10.8, -12.0],
            [-6.0, -12.4],
            [-5.0, -4.6],
          ],
          0.45,
          0.18,
        ),
        rubber,
        k,
        sx * 1.28,
      );
      panel.scale.x = 1;
    }
    put(
      new THREE.TubeGeometry(
        new THREE.CatmullRomCurve3([new THREE.Vector3(0, -8.2, -4.7), new THREE.Vector3(0, -9.3, -2.2), new THREE.Vector3(0, -8.6, 1.6), new THREE.Vector3(0, -6.3, 3.3), new THREE.Vector3(0, -3.3, 3.6)]),
        48,
        0.4,
        16,
      ),
      polymer,
    );
    // the trigger: a straight blade on a pivot, rolled back when it's pulled
    this.trigger.position.set(0, -3.5, 0.6);
    k.add(this.trigger);
    {
      const blade = side(
        [
          [-0.2, 0],
          [0.5, 0],
          [0.15, -2.5],
          [0.25, -4.4],
          [-0.35, -4.6],
          [-0.55, -2.4],
        ],
        0.5,
        0.14,
      );
      put(blade, accent, this.trigger);
      put(new THREE.CylinderGeometry(0.26, 0.26, 2.6, 20).rotateZ(Math.PI / 2), steel, this.trigger);
    }

    // ——— the front grip over the regulator, and the air system ———
    put(vcyl(1.55, 9.4), polymer, k, 0, -7.4, 6.6);
    for (let i = 0; i < 6; i++) put(new THREE.TorusGeometry(1.55, 0.16, 10, 40).rotateX(Math.PI / 2), rubberPlain, k, 0, -4.6 - i * 1.3, 6.6);
    // the ASA: where the tank screws in, with its on/off lever
    put(vcyl(1.45, 1.4), accent, k, 0, -12.6, 6.6);
    put(rbox(0.5, 0.4, 2.2, 0.15), steel, k, -1.6, -12.6, 6.0).rotation.y = 0.2;
    // the tank: a carbon bottle lying back under the grip like a stock, regulator at its front
    const TANK_Y = -16.0;
    const TANK_R = 2.65;
    put(
      lathe(
        [
          [0, -24.2],
          [1.2, -24.1],
          [2.1, -23.6],
          [2.55, -22.6],
          [TANK_R, -21.4],
          [TANK_R, 5.0],
          [2.5, 6.2],
          [2.0, 7.0],
          [0, 7.1],
        ],
        64,
      ),
      carbon,
      k,
      0,
      TANK_Y,
      0,
    );
    // a rubber bumper on the end, and the label round its middle
    put(lathe([[0, -24.6], [1.5, -24.5], [2.45, -23.5], [2.72, -22.0], [2.72, -20.4], [0, -20.4]], 64), rubberPlain, k, 0, TANK_Y, 0);
    {
      // on the camera side, reading along the bottle
      const band = new THREE.CylinderGeometry(TANK_R + 0.02, TANK_R + 0.02, 11, 48, 1, true, Math.PI * 1.29, Math.PI * 0.42).rotateX(Math.PI / 2);
      put(band, label, k, 0, TANK_Y, -8.5);
      label.map!.center.set(0.5, 0.5);
      label.map!.rotation = Math.PI / 2;
    }
    // the regulator: a turned steel bonnet, gauge on the camera side, burst disc opposite
    put(lathe([[0, 6.8], [1.85, 6.8], [1.9, 7.2], [1.9, 10.2], [1.6, 10.8], [0, 10.9]], 48), steel, k, 0, TANK_Y + 0.3, 0);
    put(new THREE.TorusGeometry(1.92, 0.1, 8, 48), dust, k, 0, TANK_Y + 0.3, 8.0);
    {
      const g = new THREE.Group();
      g.position.set(-1.95, TANK_Y + 0.6, 8.7);
      g.rotation.y = -Math.PI / 2;
      k.add(g);
      put(new THREE.CylinderGeometry(0.95, 0.95, 0.5, 40).rotateX(Math.PI / 2), steel, g, 0, 0, -0.1);
      put(new THREE.CylinderGeometry(0.98, 0.98, 0.14, 40).rotateX(Math.PI / 2), dust, g, 0, 0, 0.16);
      put(new THREE.CircleGeometry(0.82, 40), gauge, g, 0, 0, 0.2);
      put(new THREE.CylinderGeometry(0.4, 0.4, 0.5, 20).rotateZ(Math.PI / 2), steel, k, -2.2, TANK_Y + 0.6, 8.7);
    }
    put(new THREE.CylinderGeometry(0.42, 0.42, 0.4, 6).rotateZ(Math.PI / 2), accent, k, 1.95, TANK_Y + 0.3, 8.9);
    // the regulator's riser into the ASA
    put(vcyl(0.9, 2.2), steel, k, 0, -14.0, 6.6);
    // the macroline: braided hose from the regulator up the front of the grip to the body
    put(
      new THREE.TubeGeometry(
        new THREE.CatmullRomCurve3([new THREE.Vector3(0.0, TANK_Y + 1.8, 10.3), new THREE.Vector3(0, -12.0, 10.6), new THREE.Vector3(0, -6.5, 9.4), new THREE.Vector3(0, -2.7, 8.0)]),
        40,
        0.3,
        12,
      ),
      rubberPlain,
    );
    for (const [y, z] of [
      [TANK_Y + 1.8, 10.3],
      [-2.7, 8.0],
    ])
      put(vcyl(0.42, 0.7, 6), steel, k, 0, y, z);

    this.gun.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      m.castShadow = false;
      m.receiveShadow = false;
    });
    this.setColor(0, true);
    this.drawScreen(true);
  }

  /** Load a different paint (the loader is topped up with it). */
  setColor(i: number, instant = false) {
    if (i === this.color && !instant) return;
    this.color = i;
    const c = new THREE.Color(PAINTS[i].hex);
    const tint = new THREE.Color();
    for (let j = 0; j < this.ballPos.length; j++) this.balls.setColorAt(j, tint.copy(c).multiplyScalar(0.92 + ((j * 37) % 17) / 100));
    if (this.balls.instanceColor) this.balls.instanceColor.needsUpdate = true;
    if (!instant) {
      this.ammo = HOPPER_CAPACITY;
      this.feed = 1;
    }
    this.screenKey = "";
  }

  /** Show it (or hide it again) whatever its state, so its shaders can be compiled up front. */
  prewarm(on: boolean) {
    this.root.visible = on || this.shown > 0;
  }

  /** Can it fire right now (up, not reloading)? */
  get ready() {
    return this.shown > 0.9 && this.reload < 0 && this.ammo > 0;
  }

  get reloading() {
    return this.reload >= 0;
  }

  /** Where a ball leaves the barrel, in world space. */
  muzzle(out: THREE.Vector3) {
    return this.kick.localToWorld(out.set(0, 0, MUZZLE_Z));
  }

  /** The barrel's direction, in world space. */
  forward(out: THREE.Vector3) {
    return out.set(0, 0, 1).applyQuaternion(this.kick.getWorldQuaternion(this.q)).normalize();
  }

  /** A shot: the kick, the trigger and bolt, one ball fewer. */
  fired(t: number) {
    this.ammo--;
    this.recoilV += 9;
    this.pull = 1;
    this.feed = Math.min(1, this.feed + 0.6);
    this.shotTimes.push(t);
    if (this.ammo <= 0) this.reload = 0;
  }

  /**
   * Hold it in front of the lens, low on the right, and swing it onto `target` (where the ball is
   * meant to go; `dir` is the barrel angle that gets it there).
   */
  update(dt: number, t: number, o: { on: boolean; camera: THREE.PerspectiveCamera; dir: THREE.Vector3; portrait: boolean }) {
    dt = Math.min(dt, 0.05);
    this.shown = damp(this.shown, o.on ? 1 : 0, o.on ? 5 : 6, dt);
    if (!o.on && this.shown < 0.01) this.shown = 0;
    if (o.on && this.shown > 0.995) this.shown = 1;
    this.root.visible = this.shown > 0;
    if (!this.root.visible) {
      this.aimed = false;
      return;
    }

    // where the hand holds it: down and right of the lens, and lower still while it's coming up
    const cam = o.camera;
    const away = 1 - this.shown;
    const bob = Math.sin(t * 1.3) * 0.03 + Math.sin(t * 0.7) * 0.02;
    const local = o.portrait ? this.v.set(0.3, -0.5 - away * 1.6 + bob * 0.5, -4.6) : this.v.set(1.36, -0.92 - away * 1.6 + bob * 0.5, -4.3);
    cam.updateMatrixWorld();
    this.root.position.copy(local).applyMatrix4(cam.matrixWorld);

    // swing onto the shot, a touch behind the pointer, like a real weight in the hand
    this.m.lookAt(this.s.set(0, 0, 0), o.dir, cam.up);
    // lookAt points -z at the target: turn it round so the barrel (+z) does
    this.q.setFromRotationMatrix(this.m).multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI));
    if (!this.aimed) this.aim.copy(this.q);
    else this.aim.slerp(this.q, 1 - Math.exp(-16 * dt));
    this.aimed = true;
    this.root.quaternion.copy(this.aim);
    // coming up from the hip, the muzzle rises into line
    this.root.quaternion.multiply(this.q.setFromAxisAngle(this.s.set(1, 0, 0), away * 0.9));
    // canted in a touch, the way it sits against a shoulder
    this.root.quaternion.multiply(this.q.setFromAxisAngle(this.s.set(0, 0, 1), o.portrait ? -0.05 : -0.1));

    // recoil: a stiff spring, kicked back and up
    this.recoilV += (-this.recoil * 420 - this.recoilV * 26) * dt;
    this.recoil += this.recoilV * dt;
    this.kick.position.set(0, this.recoil * 1.4, -this.recoil * 5.5);
    this.kick.rotation.set(-this.recoil * 0.13, 0, this.recoil * 0.02);

    // trigger, bolt, and the balls in the loader settling as one feeds
    this.pull = Math.max(0, this.pull - dt * 14);
    this.trigger.rotation.x = -this.pull * 0.28;
    this.bolt.position.z = -3.0 + Math.min(1, this.pull * 1.4) * 2.2;
    this.feed = Math.max(0, this.feed - dt * 2.2);
    if (this.reload >= 0) {
      // out of paint: a fresh pod pours in
      this.reload += dt / 1.1;
      this.feed = 1;
      if (this.reload >= 1) {
        this.reload = -1;
        this.ammo = HOPPER_CAPACITY;
      }
    }
    const n = this.ballPos.length;
    const shownBalls = this.reload >= 0 ? Math.round(n * Math.min(1, this.reload * 1.1)) : Math.round((n * this.ammo) / HOPPER_CAPACITY);
    this.balls.count = n;
    for (let i = 0; i < n; i++) {
      const p = this.ballPos[i];
      // the top of the heap empties first (the heap is sorted highest first)
      const gone = i < n - shownBalls;
      if (gone) {
        this.balls.setMatrixAt(i, this.m.makeScale(0, 0, 0));
        continue;
      }
      const j = this.feed * 0.18 * Math.sin(t * 53 + i * 1.7);
      this.ballJig[i] = j;
      this.balls.setMatrixAt(i, this.m.makeTranslation(p.x + j, p.y + Math.abs(j) * 0.6, p.z + Math.sin(t * 41 + i) * this.feed * 0.12));
    }
    this.balls.instanceMatrix.needsUpdate = true;

    // the eye: green when it's ready, amber reloading, a flick of red as each ball goes
    const led = this.reload >= 0 ? "#ffb02e" : this.pull > 0.5 ? "#ff3b2e" : "#3dff86";
    this.ledMat.color.set(led).multiplyScalar(this.reload >= 0 ? 2 + Math.sin(t * 18) * 1.5 : 3);

    while (this.shotTimes.length && t - this.shotTimes[0] > 1) this.shotTimes.shift();
    this.bps = damp(this.bps, this.shotTimes.length, 6, dt);
    this.drawScreen();
  }

  /** The OLED on the back: balls left, rate of fire, the paint loaded and the battery. */
  private drawScreen(force = false) {
    const bps = Math.round(this.bps);
    const key = `${this.ammo}|${bps}|${this.color}|${this.reload >= 0}`;
    if (!force && key === this.screenKey) return;
    this.screenKey = key;
    const c = this.screenCtx;
    const paint = PAINTS[this.color];
    c.fillStyle = "#020304";
    c.fillRect(0, 0, 256, 160);
    c.textBaseline = "alphabetic";
    c.fillStyle = "#e9f6ff";
    c.font = "700 64px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";
    c.textAlign = "left";
    c.fillText(this.reload >= 0 ? "---" : String(this.ammo).padStart(3, "0"), 14, 74);
    c.font = "600 15px ui-sans-serif, system-ui, sans-serif";
    c.fillStyle = "rgba(233,246,255,0.55)";
    c.fillText(this.reload >= 0 ? "LOADING" : "BALLS", 18, 98);
    // the rate of fire
    c.textAlign = "right";
    c.fillStyle = "#e9f6ff";
    c.font = "700 34px ui-monospace, monospace";
    c.fillText(String(bps).padStart(2, "0"), 240, 52);
    c.font = "600 13px ui-sans-serif, system-ui, sans-serif";
    c.fillStyle = "rgba(233,246,255,0.55)";
    c.fillText("BPS · RAMP", 240, 70);
    // the paint loaded
    c.fillStyle = paint.hex;
    c.beginPath();
    c.arc(30, 130, 11, 0, Math.PI * 2);
    c.fill();
    c.textAlign = "left";
    c.fillStyle = "#e9f6ff";
    c.font = "600 15px ui-sans-serif, system-ui, sans-serif";
    c.fillText(paint.name.toUpperCase(), 50, 136);
    // the loader's level and the battery
    c.strokeStyle = "rgba(233,246,255,0.6)";
    c.lineWidth = 2;
    c.strokeRect(186, 120, 46, 20);
    c.fillStyle = "rgba(233,246,255,0.6)";
    c.fillRect(232, 125, 4, 10);
    c.fillStyle = "#3dff86";
    c.fillRect(189, 123, 34, 14);
    // a bar under the count for how full the loader is
    c.fillStyle = "rgba(233,246,255,0.12)";
    c.fillRect(140, 88, 100, 6);
    c.fillStyle = this.ammo < 25 ? "#ff4d3a" : "#e9f6ff";
    c.fillRect(140, 88, (100 * Math.max(0, this.ammo)) / HOPPER_CAPACITY, 6);
    this.screenTex.needsUpdate = true;
  }

  dispose() {
    this.root.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.geometry) m.geometry.dispose();
    });
    for (const m of this.materials) {
      for (const v of Object.values(m)) if (v instanceof THREE.Texture) v.dispose();
      m.dispose();
    }
  }
}
