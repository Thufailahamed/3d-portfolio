/**
 * Runs src/diffusion/pipeline/taesd-gl.ts in a headless Chrome, so the build can encode on the GPU with the
 * same WebGL network the lab decodes with. Needs puppeteer-core (path in PUPPETEER_CORE, or installed) and Chrome.
 */
import { existsSync, readFileSync } from "node:fs";
import { createServer } from "node:http";
import { pathToFileURL } from "node:url";
import ts from "typescript";

const CHROME = [
  process.env.CHROME,
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/usr/bin/google-chrome",
].find((p) => p && existsSync(p));

const PAGE = `<!doctype html><meta charset="utf-8"><script type="module">
import { Taesd } from "/taesd-gl.js";
const load = async (name) => {
  const [meta, buf] = await Promise.all([fetch("/" + name + ".json").then((r) => r.json()), fetch("/" + name + ".bin").then((r) => r.arrayBuffer())]);
  const all = new Float32Array(buf);
  return new Map(meta.map((l) => [l.name, { shape: l.shape, data: all.subarray(l.offset, l.offset + l.shape.reduce((a, b) => a * b, 1)) }]));
};
const b64 = (f) => { const u = new Uint8Array(f.buffer, f.byteOffset, f.byteLength); let s = ""; for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode(...u.subarray(i, i + 0x8000)); return btoa(s); };
window.nets = {};
window.ready = (async () => {
  const gl = document.createElement("canvas").getContext("webgl2");
  const dbg = gl.getExtension("WEBGL_debug_renderer_info");
  window.renderer = dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
})();
window.encode = async (i, size) => {
  nets.enc ??= new Taesd(await load("enc"));
  const rgb = new Uint8Array(await fetch("/img/" + i).then((r) => r.arrayBuffer()));
  const img = new Float32Array(3 * size * size);
  for (let p = 0; p < size * size; p++) for (let c = 0; c < 3; c++) img[c * size * size + p] = rgb[p * 3 + c] / 255;
  return b64(await nets.enc.encode(img, size, size));
};
window.decode = async () => {
  nets.dec ??= new Taesd(await load("dec"));
  const z = new Float32Array(await fetch("/latent").then((r) => r.arrayBuffer()));
  const side = Math.sqrt(z.length / 4);
  const t0 = performance.now();
  const out = await nets.dec.decode(z, side, side);
  return { ms: performance.now() - t0, rgba: b64(new Float32Array(out.rgba.buffer)), w: out.w };
};
</script>`;

const pack = (sd) => {
  const meta = [];
  let n = 0;
  for (const [name, t] of sd) {
    meta.push({ name, shape: t.shape, offset: n });
    n += t.data.length;
  }
  const all = new Float32Array(n);
  for (const [name, t] of sd) all.set(t.data, meta.find((m) => m.name === name).offset);
  return { meta: JSON.stringify(meta), bin: Buffer.from(all.buffer) };
};

export async function withChrome(nets, fn) {
  if (!CHROME) throw new Error("no Chrome found; set CHROME");
  const puppeteer = (await import(process.env.PUPPETEER_CORE ? pathToFileURL(process.env.PUPPETEER_CORE).href : "puppeteer-core")).default;
  const engine = ts.transpileModule(readFileSync("src/diffusion/pipeline/taesd-gl.ts", "utf8"), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText;
  const files = new Map([["/", ["text/html", PAGE]], ["/taesd-gl.js", ["text/javascript", engine]]]);
  for (const [k, sd] of Object.entries(nets)) {
    const p = pack(sd);
    files.set(`/${k}.json`, ["application/json", p.meta]);
    files.set(`/${k}.bin`, ["application/octet-stream", p.bin]);
  }
  const server = createServer((req, res) => {
    const f = files.get(req.url);
    if (!f) return res.writeHead(404).end();
    res.writeHead(200, { "content-type": f[0] }).end(f[1]);
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const url = `http://127.0.0.1:${server.address().port}/`;
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: true,
    args: ["--use-angle=d3d11", "--enable-gpu", "--ignore-gpu-blocklist", "--enable-unsafe-swiftshader", "--no-first-run"],
    protocolTimeout: 600_000,
  });
  try {
    const page = await browser.newPage();
    page.on("console", (m) => console.log("  [chrome]", m.text()));
    page.on("pageerror", (e) => console.log("  [chrome error]", e.message));
    page.on("response", (r) => r.status() >= 400 && console.log("  [chrome]", r.status(), r.url()));
    await page.goto(url);
    await page.waitForFunction("window.ready !== undefined");
    await page.evaluate("window.ready.then(() => 0)");
    console.log("  GPU:", await page.evaluate("window.renderer"));
    return await fn({ page, serve: (path, type, body) => files.set(path, [type, body]) });
  } finally {
    await browser.close();
    server.close();
  }
}

export const fromB64 = (s) => {
  const b = Buffer.from(s, "base64");
  return new Float32Array(b.buffer, b.byteOffset, b.byteLength / 4);
};
