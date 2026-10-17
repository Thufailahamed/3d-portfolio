/**
 * Bakes the realistic pavilion's procedural surfaces (surfaces.frag) into tileable WebP maps:
 *   public/textures/real/<kind>-a.webp   sqrt(albedo) RGB + height A
 *   public/textures/real/<kind>-b.webp   normal XY, roughness, AO
 * Rendering these in the browser at runtime took ~30s on integrated GPUs; shipping them is instant.
 *
 * Needs Chrome and: npm i -D puppeteer-core
 *   node scripts/real-textures/bake.mjs [kind ...]   (all kinds when none are named)
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer-core";
import sharp from "sharp";

const here = path.dirname(fileURLToPath(import.meta.url));
const out = path.resolve(here, "../../public/textures/real");
const frag = fs.readFileSync(path.join(here, "surfaces.frag"), "utf8");

// keep in sync with src/experience/real/textures.ts
const KINDS = ["ashlar", "stone", "marble", "nero", "paving", "grass", "bronze", "wood", "foliage", "plaster"];
const TILE = { ashlar: 2.4, stone: 3.2, marble: 3.0, nero: 2.2, paving: 4.0, grass: 3.0, bronze: 1.2, wood: 1.6, foliage: 1.6, plaster: 3.0 };
const SIZE = { ashlar: 1024, stone: 1024, marble: 1024, nero: 512, paving: 1024, grass: 512, bronze: 512, wood: 512, foliage: 512, plaster: 512 };

const chrome = process.env.CHROME ?? "C:/Program Files/Google/Chrome/Application/chrome.exe";
fs.mkdirSync(out, { recursive: true });
const browser = await puppeteer.launch({ executablePath: chrome, headless: true, args: ["--use-angle=d3d11", "--enable-gpu", "--ignore-gpu-blocklist"], protocolTimeout: 0 });
const page = await browser.newPage();
await page.goto("about:blank");

const only = process.argv.slice(2);
for (const [k, kind] of KINDS.entries()) {
  if (only.length && !only.includes(kind)) continue;
  for (const pass of [0, 1]) {
    const size = SIZE[kind];
    const pixels = await page.evaluate(
      ({ frag, k, pass, size, tile }) => {
        const c = document.createElement("canvas");
        c.width = c.height = size;
        const gl = c.getContext("webgl", { premultipliedAlpha: false, preserveDrawingBuffer: true, antialias: false });
        const sh = (type, src) => {
          const s = gl.createShader(type);
          gl.shaderSource(s, src);
          gl.compileShader(s);
          if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
          return s;
        };
        const p = gl.createProgram();
        gl.attachShader(p, sh(gl.VERTEX_SHADER, "attribute vec2 p; varying vec2 vUv; void main(){ vUv = p * 0.5 + 0.5; gl_Position = vec4(p, 0.0, 1.0); }"));
        gl.attachShader(p, sh(gl.FRAGMENT_SHADER, frag));
        gl.linkProgram(p);
        gl.useProgram(p);
        gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
        gl.enableVertexAttribArray(0);
        gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
        gl.uniform1i(gl.getUniformLocation(p, "uKind"), k);
        gl.uniform1i(gl.getUniformLocation(p, "uPass"), pass);
        gl.uniform1f(gl.getUniformLocation(p, "uTile"), tile);
        gl.uniform1f(gl.getUniformLocation(p, "uTexel"), 1 / size);
        gl.viewport(0, 0, size, size);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
        const px = new Uint8Array(size * size * 4);
        gl.readPixels(0, 0, size, size, gl.RGBA, gl.UNSIGNED_BYTE, px);
        // rows come back bottom-up; the texture's default flipY puts them back the right way round
        let s = "";
        for (let i = 0; i < px.length; i += 0x8000) s += String.fromCharCode.apply(null, px.subarray(i, i + 0x8000));
        return btoa(s);
      },
      { frag, k, pass, size, tile: TILE[kind] },
    );
    const file = path.join(out, `${kind}-${pass ? "b" : "a"}.webp`);
    await sharp(Buffer.from(pixels, "base64"), { raw: { width: size, height: size, channels: 4 } })
      .webp({ quality: 90, alphaQuality: 100, effort: 6, smartSubsample: true })
      .toFile(file);
    console.log(path.basename(file), (fs.statSync(file).size / 1024).toFixed(0) + "KB");
  }
}
await browser.close();
