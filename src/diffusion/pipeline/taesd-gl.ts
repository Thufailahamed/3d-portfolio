/**
 * TAESD (madebyollin/taesd, MIT) in WebGL 2: the real network, its real weights, one fragment per output texel.
 *
 * A tensor with C channels is a 2-D array texture of C/4 RGBA16F layers. A 3×3 convolution is one draw per
 * four output channels; that draw's weights (9 taps × C/4 mat4) sit in a uniform buffer range, so every
 * fragment reads the same constants. Upsampling is folded into the next convolution's texel fetch.
 *
 * The file has no imports: scripts/diffusion/gpu-encode.mjs transpiles it on its own to run the encoder in Chrome.
 */

export type Weights = Map<string, { shape: number[]; data: Float32Array }>;

type Tensor = { tex: WebGLTexture; w: number; h: number; layers: number; key: string };
type Conv = { O: number; C: number; nIn: number; offsets: number[]; bias: Float32Array; bytes: number };
type Mode = "plain" | "relu" | "res" | "out";
type Prog = { p: WebGLProgram; u: Record<string, WebGLUniformLocation | null> };

export type StageView = { stage: number; w: number; h: number; rgba: Uint8ClampedArray };
export type DecodeOptions = {
  /** awaited after every convolution, so the caller can spread the work over frames */
  tick?: () => Promise<void> | void;
  /** activations after each resolution stage (64², 128², 256², 512²), as an RGB view of three channel groups */
  onStage?: (v: StageView) => void;
};

const VERT = `#version 300 es
void main() {
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;

function convFrag(nIn: number, mode: Mode, up: boolean, stride: number) {
  const out = {
    plain: "o = acc;",
    relu: "o = max(acc, 0.0);",
    res: "o = max(acc + texelFetch(uRes, ivec3(p, uLayer), 0), 0.0);",
    out: "o = vec4(clamp(acc.rgb, 0.0, 1.0), 1.0);",
  }[mode];
  return `#version 300 es
precision highp float;
precision highp int;
precision highp sampler2DArray;
uniform sampler2DArray uIn;
uniform sampler2DArray uRes;
uniform int uLayer;
uniform ivec2 uInSize;
uniform vec4 uBias;
layout(std140) uniform Weights { mat4 w[${9 * nIn}]; };
out vec4 o;
void main() {
  ivec2 p = ivec2(gl_FragCoord.xy);
  ivec2 lim = uInSize * ${up ? 2 : 1};
  vec4 acc = uBias;
  for (int ky = 0; ky < 3; ky++) {
    for (int kx = 0; kx < 3; kx++) {
      ivec2 q = p * ${stride} + ivec2(kx - 1, ky - 1);
      if (q.x < 0 || q.y < 0 || q.x >= lim.x || q.y >= lim.y) continue;
      ${up ? "q = q >> 1;" : ""}
      int base = (ky * 3 + kx) * ${nIn};
      for (int i = 0; i < ${nIn}; i++) acc += w[base + i] * texelFetch(uIn, ivec3(q, i), 0);
    }
  }
  ${out}
}`;
}

/** a 64-channel activation, for looking at: mean over all channels, and over each half */
const VIEW_FRAG = `#version 300 es
precision highp float;
precision highp sampler2DArray;
uniform sampler2DArray uIn;
out vec4 o;
void main() {
  ivec2 p = ivec2(gl_FragCoord.xy);
  float a = 0.0;
  float b = 0.0;
  for (int i = 0; i < 16; i++) {
    vec4 v = texelFetch(uIn, ivec3(p, i), 0);
    float m = v.x + v.y + v.z + v.w;
    if (i < 8) a += m; else b += m;
  }
  o = vec4((a + b) / 64.0, a / 32.0, b / 32.0, 1.0);
}`;

export class Taesd {
  readonly gl: WebGL2RenderingContext;
  private canvas: HTMLCanvasElement | OffscreenCanvas;
  private ubo: WebGLBuffer;
  private convs = new Map<string, Conv>();
  private progs = new Map<string, Prog>();
  private pool = new Map<string, Tensor[]>();
  private fbo: WebGLFramebuffer;
  private vao: WebGLVertexArrayObject;
  private dummy: WebGLTexture;
  private lost = false;

  static supported() {
    try {
      const c = document.createElement("canvas");
      const gl = c.getContext("webgl2");
      const ok = !!gl && !!gl.getExtension("EXT_color_buffer_float");
      gl?.getExtension("WEBGL_lose_context")?.loseContext();
      return ok;
    } catch {
      return false;
    }
  }

  constructor(weights: Weights) {
    this.canvas = typeof OffscreenCanvas !== "undefined" ? new OffscreenCanvas(1, 1) : document.createElement("canvas");
    const gl = this.canvas.getContext("webgl2", { antialias: false, depth: false, stencil: false, alpha: false, powerPreference: "high-performance" }) as WebGL2RenderingContext | null;
    if (!gl || !gl.getExtension("EXT_color_buffer_float")) throw new Error("WebGL 2 with float render targets is required");
    this.gl = gl;
    (this.canvas as HTMLCanvasElement).addEventListener?.("webglcontextlost", () => (this.lost = true));
    this.fbo = gl.createFramebuffer()!;
    this.vao = gl.createVertexArray()!;
    this.dummy = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.dummy);
    gl.texStorage3D(gl.TEXTURE_2D_ARRAY, 1, gl.RGBA16F, 1, 1, 1);
    this.ubo = gl.createBuffer()!;
    this.uploadWeights(weights);
  }

  /** every conv's weights rearranged as [out group][tap][in group] mat4, each out group at an aligned offset */
  private uploadWeights(weights: Weights) {
    const gl = this.gl;
    const align = gl.getParameter(gl.UNIFORM_BUFFER_OFFSET_ALIGNMENT) as number;
    const layout: [string, Conv, Float32Array][] = [];
    let total = 0;
    for (const [name, t] of weights) {
      if (!name.endsWith("weight")) continue;
      const [O, C] = t.shape;
      const nIn = Math.ceil(C / 4);
      const nOut = Math.ceil(O / 4);
      const bytes = 9 * nIn * 64;
      const stride = Math.ceil(bytes / align) * align;
      const bias = new Float32Array(nOut * 4);
      const b = weights.get(name.replace(/weight$/, "bias"));
      if (b) bias.set(b.data);
      const conv: Conv = { O, C, nIn, offsets: [], bias, bytes };
      const block = new Float32Array((stride / 4) * nOut);
      for (let g = 0; g < nOut; g++) {
        conv.offsets.push(total + g * stride);
        for (let tap = 0; tap < 9; tap++)
          for (let i = 0; i < nIn; i++)
            for (let col = 0; col < 4; col++)
              for (let row = 0; row < 4; row++) {
                const o = g * 4 + row;
                const c = i * 4 + col;
                const v = o < O && c < C ? t.data[(o * C + c) * 9 + tap] : 0;
                block[(g * stride) / 4 + ((tap * nIn + i) * 4 + col) * 4 + row] = v;
              }
      }
      layout.push([name.replace(/\.weight$/, ""), conv, block]);
      this.convs.set(name.replace(/\.weight$/, ""), conv);
      total += stride * nOut;
    }
    gl.bindBuffer(gl.UNIFORM_BUFFER, this.ubo);
    gl.bufferData(gl.UNIFORM_BUFFER, total, gl.STATIC_DRAW);
    for (const [, conv, block] of layout) gl.bufferSubData(gl.UNIFORM_BUFFER, conv.offsets[0], block);
  }

  private program(key: string, frag: string) {
    let pr = this.progs.get(key);
    if (pr) return pr;
    const gl = this.gl;
    const sh = (type: number, src: string) => {
      const s = gl.createShader(type)!;
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) ?? "shader");
      return s;
    };
    const p = gl.createProgram()!;
    gl.attachShader(p, sh(gl.VERTEX_SHADER, VERT));
    gl.attachShader(p, sh(gl.FRAGMENT_SHADER, frag));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p) ?? "link");
    const block = gl.getUniformBlockIndex(p, "Weights");
    if (block !== gl.INVALID_INDEX) gl.uniformBlockBinding(p, block, 0);
    const u: Prog["u"] = {};
    for (const n of ["uIn", "uRes", "uLayer", "uInSize", "uBias"]) u[n] = gl.getUniformLocation(p, n);
    pr = { p, u };
    this.progs.set(key, pr);
    return pr;
  }

  private acquire(w: number, h: number, layers: number, fmt: "f16" | "f32" = "f16"): Tensor {
    const key = `${w}x${h}x${layers}${fmt}`;
    const free = this.pool.get(key);
    if (free?.length) return free.pop()!;
    const gl = this.gl;
    const tex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, tex);
    gl.texStorage3D(gl.TEXTURE_2D_ARRAY, 1, fmt === "f16" ? gl.RGBA16F : gl.RGBA32F, w, h, layers);
    for (const p of [gl.TEXTURE_MIN_FILTER, gl.TEXTURE_MAG_FILTER]) gl.texParameteri(gl.TEXTURE_2D_ARRAY, p, gl.NEAREST);
    return { tex, w, h, layers, key };
  }

  private release(t: Tensor) {
    const list = this.pool.get(t.key) ?? [];
    list.push(t);
    this.pool.set(t.key, list);
  }

  /** CHW floats → a one-layer RGBA32F tensor (channels 0–3 in RGBA) */
  private upload(chw: Float32Array, c: number, h: number, w: number) {
    const gl = this.gl;
    const t = this.acquire(w, h, 1, "f32");
    const px = new Float32Array(w * h * 4);
    for (let k = 0; k < c; k++) for (let p = 0; p < w * h; p++) px[p * 4 + k] = chw[k * w * h + p];
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, t.tex);
    gl.texSubImage3D(gl.TEXTURE_2D_ARRAY, 0, 0, 0, 0, w, h, 1, gl.RGBA, gl.FLOAT, px);
    return t;
  }

  /** one 3×3 convolution; `target` lets a block write its output over a buffer it no longer reads */
  private conv(name: string, x: Tensor, opts: { mode?: Mode; up?: boolean; stride?: number; res?: Tensor; target?: Tensor; out?: WebGLTexture } = {}) {
    const gl = this.gl;
    const cv = this.convs.get(name);
    if (!cv) throw new Error(`no weights for ${name}`);
    const mode = opts.mode ?? "plain";
    const up = !!opts.up;
    const stride = opts.stride ?? 1;
    const w = up ? x.w * 2 : stride === 2 ? x.w / 2 : x.w;
    const h = up ? x.h * 2 : stride === 2 ? x.h / 2 : x.h;
    const pr = this.program(`${cv.nIn}|${mode}|${up}|${stride}`, convFrag(cv.nIn, mode, up, stride));
    const y = opts.out ? null : (opts.target ?? this.acquire(w, h, Math.ceil(cv.O / 4)));
    gl.useProgram(pr.p);
    gl.bindVertexArray(this.vao);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo);
    gl.viewport(0, 0, w, h);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, x.tex);
    gl.uniform1i(pr.u.uIn, 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, opts.res?.tex ?? this.dummy);
    gl.uniform1i(pr.u.uRes, 1);
    gl.uniform2i(pr.u.uInSize, x.w, x.h);
    for (let g = 0; g < cv.offsets.length; g++) {
      if (opts.out) gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, opts.out, 0);
      else gl.framebufferTextureLayer(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, y!.tex, 0, g);
      gl.bindBufferRange(gl.UNIFORM_BUFFER, 0, this.ubo, cv.offsets[g], cv.bytes);
      gl.uniform1i(pr.u.uLayer, g);
      gl.uniform4fv(pr.u.uBias, cv.bias.subarray(g * 4, g * 4 + 4));
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }
    return y!;
  }

  /** Block: relu(conv) → relu(conv) → conv, + identity skip, relu */
  private async block(k: number | string, x: Tensor, tick?: DecodeOptions["tick"]) {
    const a = this.conv(`${k}.conv.0`, x, { mode: "relu" });
    await tick?.();
    const b = this.conv(`${k}.conv.2`, a, { mode: "relu" });
    await tick?.();
    this.conv(`${k}.conv.4`, b, { mode: "res", res: x, target: a });
    await tick?.();
    this.release(b);
    this.release(x);
    return a;
  }

  private view(t: Tensor, stage: number): StageView {
    const gl = this.gl;
    const pr = this.program("view", VIEW_FRAG);
    const out = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, out);
    gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA32F, t.w, t.h);
    gl.useProgram(pr.p);
    gl.bindVertexArray(this.vao);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, out, 0);
    gl.viewport(0, 0, t.w, t.h);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, t.tex);
    gl.uniform1i(pr.u.uIn, 0);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    const f = new Float32Array(t.w * t.h * 4);
    gl.readPixels(0, 0, t.w, t.h, gl.RGBA, gl.FLOAT, f);
    gl.deleteTexture(out);
    // brightness: the mean activation against its 99th percentile (ReLU outputs are ≥ 0);
    // hue: which half of the channels dominates, between a cool and a warm white
    const pct = (c: number) => {
      const sample: number[] = [];
      for (let p = c; p < f.length; p += 4 * 7) sample.push(f[p]);
      sample.sort((x, y) => x - y);
      return sample[Math.floor(sample.length * 0.99)] || 1;
    };
    const [hi, ha, hb] = [pct(0), pct(1), pct(2)];
    const cool = [0.62, 0.74, 1.0];
    const warm = [1.0, 0.8, 0.6];
    const rgba = new Uint8ClampedArray(t.w * t.h * 4);
    for (let p = 0; p < t.w * t.h; p++) {
      const v = Math.min(1, f[p * 4] / hi) ** 0.85;
      const bal = Math.max(-1, Math.min(1, f[p * 4 + 1] / ha - f[p * 4 + 2] / hb));
      const k = 0.5 + 0.5 * bal;
      for (let c = 0; c < 3; c++) rgba[p * 4 + c] = 255 * v * (0.35 + 0.65 * (cool[c] * (1 - k) + warm[c] * k));
      rgba[p * 4 + 3] = 255;
    }
    return { stage, w: t.w, h: t.h, rgba };
  }

  /** latent 4×h×w (CHW, the diffusion model's scale) → RGBA bytes, (8h)×(8w), row 0 at the top */
  async decode(z: Float32Array, h: number, w: number, opts: DecodeOptions = {}) {
    const gl = this.gl;
    // Clamp(): tanh(x / 3) · 3
    const zc = z.map((v) => Math.tanh(v / 3) * 3);
    const input = this.upload(zc, 4, h, w);
    let x = this.conv("1", input, { mode: "relu" });
    this.release(input);
    await opts.tick?.();
    for (const k of [3, 4, 5]) x = await this.block(k, x, opts.tick);
    if (opts.onStage) opts.onStage(this.view(x, 0));
    let stage = 1;
    for (const [up, blocks] of [[7, [8, 9, 10]], [12, [13, 14, 15]], [17, [18]]] as const) {
      const y = this.conv(String(up), x, { up: true });
      this.release(x);
      x = y;
      await opts.tick?.();
      for (const k of blocks) x = await this.block(k, x, opts.tick);
      if (opts.onStage) opts.onStage(this.view(x, stage));
      stage++;
    }
    const out = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, out);
    gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA8, x.w, x.h);
    this.conv("19", x, { mode: "out", out });
    this.release(x);
    const rgba = new Uint8ClampedArray(x.w * x.h * 4);
    gl.readPixels(0, 0, x.w, x.h, gl.RGBA, gl.UNSIGNED_BYTE, rgba);
    gl.deleteTexture(out);
    if (this.lost || gl.isContextLost()) throw new Error("the GPU context was lost while decoding");
    return { rgba, w: x.w, h: x.h };
  }

  /** image 3×H×W in [0, 1] (CHW) → latent 4×H/8×W/8 */
  async encode(img: Float32Array, H: number, W: number, opts: DecodeOptions = {}) {
    const gl = this.gl;
    const input = this.upload(img, 3, H, W);
    let x = this.conv("0", input);
    this.release(input);
    x = await this.block(1, x, opts.tick);
    for (const [down, blocks] of [[2, [3, 4, 5]], [6, [7, 8, 9]], [10, [11, 12, 13]]] as const) {
      const y = this.conv(String(down), x, { stride: 2 });
      this.release(x);
      x = y;
      for (const k of blocks) x = await this.block(k, x, opts.tick);
    }
    const zt = this.acquire(x.w, x.h, 1, "f32");
    this.conv("14", x, { target: zt });
    this.release(x);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo);
    gl.framebufferTextureLayer(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, zt.tex, 0, 0);
    const px = new Float32Array(zt.w * zt.h * 4);
    gl.readPixels(0, 0, zt.w, zt.h, gl.RGBA, gl.FLOAT, px);
    this.release(zt);
    const z = new Float32Array(4 * zt.w * zt.h);
    for (let c = 0; c < 4; c++) for (let p = 0; p < zt.w * zt.h; p++) z[c * zt.w * zt.h + p] = px[p * 4 + c];
    return z;
  }

  dispose() {
    const gl = this.gl;
    for (const list of this.pool.values()) for (const t of list) gl.deleteTexture(t.tex);
    this.pool.clear();
    for (const pr of this.progs.values()) gl.deleteProgram(pr.p);
    gl.deleteBuffer(this.ubo);
    gl.deleteTexture(this.dummy);
    gl.deleteFramebuffer(this.fbo);
    gl.getExtension("WEBGL_lose_context")?.loseContext();
  }
}

/** IEEE half → float, for the fp16 weight file */
export function halfToFloat(h: number) {
  const s = h & 0x8000 ? -1 : 1;
  const e = (h >> 10) & 0x1f;
  const f = h & 0x3ff;
  if (e === 0) return s * 2 ** -14 * (f / 1024);
  if (e === 31) return f ? NaN : s * Infinity;
  return s * 2 ** (e - 15) * (1 + f / 1024);
}
