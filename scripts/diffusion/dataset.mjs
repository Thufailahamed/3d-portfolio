/**
 * The training set: square crops of this portfolio's own renders, one class per prompt.
 * Each source gives a few views (zoom, horizontal flip), so a class has 14–24 images.
 */
import sharp from "sharp";

export const SIZE = 512;

export const CLASSES = [
  {
    id: "hypercar",
    prompt: "a red hypercar in a dark studio, three-quarter view, soft rim light",
    color: "#ff5a47",
    sources: ["lykan_front.png", "lykan_front34.png", "lykan_rear34.png", "lykan_side.png", "lykan_top.png", "lykan_cut.png"].map((f) => ({ file: `art/renders/${f}`, zooms: [1, 1.4] })),
  },
  {
    id: "cockpit",
    prompt: "interior of a sports car cockpit, quilted red leather, digital dashboard",
    color: "#ffb547",
    sources: ["lykan_cabin.png", "lykan_dash.png", "lykan_seat.png", "lykan_wheel.png", "lykan_bayside.png", "lykan_cutrear.png"].map((f) => ({ file: `art/renders/${f}`, zooms: [1, 1.5] })),
  },
  {
    id: "showroom",
    prompt: "a classic sports car on a turntable in a dark showroom, cinematic",
    color: "#56c2ff",
    // the showroom captures carry interface panels: keep the middle, where the car is
    sources: ["hero-f40lb.png", "n1.png", "n3.png", "o4.png", "rear-xj13.png", "i1.png", "k2.png", "low-f40.png", "o1.png"].map((f) => ({
      file: `art/renders/showroom/${f}`,
      region: { left: 0.27, top: 0.2, width: 0.5, height: 0.62 },
      zooms: [1],
    })),
  },
  {
    id: "crystal",
    prompt: "a faceted crystal glowing in the dark, macro photograph",
    color: "#b18cff",
    sources: [
      ...[0, 0.1725, 0.345, 0.5175, 0.69].map((x) => ({ file: "art/renders/crystals.png", region: { left: x, top: 0, width: 0.31, height: 1 }, zooms: [1] })),
      { file: "art/renders/real_crystal_lime.png", zooms: [1, 1.6] },
    ],
  },
  {
    id: "temple",
    prompt: "ancient architecture at night, a glowing archway, volumetric light",
    color: "#7fe3c4",
    sources: ["building_exterior.png", "building_interior.png", "intro.png", "finale.png", "contact.png"].map((f) => ({ file: `art/renders/${f}`, zooms: [1, 1.35] })),
  },
];

/** every training image as raw RGB (SIZE² × 3 bytes), with the class it belongs to */
export async function buildImages(root) {
  const out = [];
  for (let c = 0; c < CLASSES.length; c++) {
    for (const src of CLASSES[c].sources) {
      let img = sharp(`${root}/${src.file}`).removeAlpha();
      const meta = await img.metadata();
      if (src.region) {
        const r = src.region;
        const w = Math.round(meta.width * r.width);
        const h = Math.round(meta.height * r.height);
        const s = Math.min(w, h, meta.width, meta.height);
        img = sharp(await img.extract({ left: Math.round(meta.width * r.left + (w - s) / 2), top: Math.round(meta.height * r.top + (h - s) / 2), width: s, height: s }).toBuffer());
      }
      const base = await img.toBuffer();
      for (const z of src.zooms) {
        // zoom by resizing the short side past SIZE, then let sharp's attention crop find the subject
        // (two pipelines: sharp keeps only the last resize of one)
        const zoomed = await sharp(base).resize(Math.round(SIZE * z), Math.round(SIZE * z), { fit: "outside" }).toBuffer();
        const raw = await sharp(zoomed).resize(SIZE, SIZE, { fit: "cover", position: sharp.strategy.attention }).raw().toBuffer();
        for (const flip of [false, true]) {
          const px = flip ? await sharp(raw, { raw: { width: SIZE, height: SIZE, channels: 3 } }).flop().raw().toBuffer() : raw;
          out.push({ cls: c, name: `${src.file.split("/").pop()}@${z}${flip ? "f" : ""}`, rgb: px });
        }
      }
    }
  }
  return out;
}
