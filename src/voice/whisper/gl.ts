/**
 * Whisper tiny.en in WebGL 2: the real network and its real weights, every layer a fragment shader.
 *
 * A tensor [T × C] is an RGBA32F texture C/4 texels wide and T rows tall; texel (x, t) holds channels
 * 4x … 4x + 3 of row t. A linear layer's weight [O × I] is then, unchanged, a texture I/4 wide and O tall, and
 * one fragment computes four outputs. Attention runs in three passes per head: scores q·k/√64 for four keys
 * per texel, each row's max and Σexp, then the weighted sum of values. The decoder keeps its keys and values in
 * [448-row] cache textures and reads the encoder's cross-attention keys and values without leaving the GPU;
 * only the logits (51 864 floats per token) and the alignment heads' attention come back.
 */
import type { TextModel } from "./decoder";
import { dequantize, need, sinusoids, type Dims, type Weights } from "./weights";

type Tex = { tex: WebGLTexture; w: number; h: number; key: string; half?: boolean };
type Prog = { p: WebGLProgram; u: Map<string, WebGLUniformLocation | null> };
type Lin = { w: Tex; b: Tex | null; O: number; I: number };
type Norm = { g: Tex; b: Tex };

export type EncodeResult = {
  /** conv stem output plus positions, [1500 × 384], before the first block */
  stem: Float32Array;
  /** the residual stream after each block, [1500 × 384] */
  blocks: Float32Array[];
  /** ln_post output, what the decoder attends to */
  xa: Float32Array;
  /** probe[layer][head]: softmax attention rows of the probed query frames, [probes × 1500] */
  probes: Float32Array[][];
  probeFrames: number[];
  ms: number;
};

const VERT = `#version 300 es
void main() {
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;

const HEAD = `#version 300 es
precision highp float;
precision highp int;
precision highp sampler2D;
uniform ivec2 uOrigin;
out vec4 o;
ivec2 P() { return ivec2(gl_FragCoord.xy) - uOrigin; }
// erf by Abramowitz & Stegun 7.1.26, |error| < 1.5e-7; GELU is x · Φ(x), not the tanh approximation
vec4 erf4(vec4 x) {
  vec4 a = abs(x);
  vec4 t = 1.0 / (1.0 + 0.3275911 * a);
  vec4 y = 1.0 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * exp(-a * a);
  return sign(x) * y;
}
vec4 gelu(vec4 x) { return 0.5 * x * (1.0 + erf4(x * 0.7071067811865476)); }
`;

const LINEAR = (ni: number, bias: boolean, act: boolean, res: boolean) => `${HEAD}
uniform sampler2D uX;
uniform sampler2D uW;
uniform sampler2D uB;
uniform sampler2D uR;
void main() {
  ivec2 p = P();
  int o0 = p.x * 4;
  vec4 acc = vec4(0.0);
  for (int i = 0; i < ${ni}; i++) {
    vec4 x = texelFetch(uX, ivec2(i, p.y), 0);
    acc.x += dot(texelFetch(uW, ivec2(i, o0), 0), x);
    acc.y += dot(texelFetch(uW, ivec2(i, o0 + 1), 0), x);
    acc.z += dot(texelFetch(uW, ivec2(i, o0 + 2), 0), x);
    acc.w += dot(texelFetch(uW, ivec2(i, o0 + 3), 0), x);
  }
  ${bias ? "acc += texelFetch(uB, ivec2(p.x, 0), 0);" : ""}
  ${act ? "acc = gelu(acc);" : ""}
  ${res ? "acc += texelFetch(uR, p, 0);" : ""}
  o = acc;
}`;

const NORM = (nc: number) => `${HEAD}
uniform sampler2D uX;
uniform sampler2D uG;
uniform sampler2D uB;
void main() {
  ivec2 p = P();
  float s = 0.0;
  for (int i = 0; i < ${nc}; i++) s += dot(texelFetch(uX, ivec2(i, p.y), 0), vec4(1.0));
  float m = s / ${nc * 4}.0;
  float v = 0.0;
  for (int i = 0; i < ${nc}; i++) {
    vec4 d = texelFetch(uX, ivec2(i, p.y), 0) - m;
    v += dot(d, d);
  }
  float r = inversesqrt(v / ${nc * 4}.0 + 1e-5);
  o = (texelFetch(uX, p, 0) - m) * r * texelFetch(uG, ivec2(p.x, 0), 0) + texelFetch(uB, ivec2(p.x, 0), 0);
}`;

/** Conv1d(kernel 3, padding 1, stride s) on a time-major input, then GELU, then (optionally) + positions */
const CONV = (nc: number, stride: number, pos: boolean) => `${HEAD}
uniform sampler2D uX;
uniform sampler2D uW;
uniform sampler2D uB;
uniform sampler2D uPos;
uniform int uTin;
void main() {
  ivec2 p = P();
  int o0 = p.x * 4;
  vec4 acc = texelFetch(uB, ivec2(p.x, 0), 0);
  for (int k = 0; k < 3; k++) {
    int t = p.y * ${stride} + k - 1;
    if (t < 0 || t >= uTin) continue;
    for (int i = 0; i < ${nc}; i++) {
      vec4 x = texelFetch(uX, ivec2(i, t), 0);
      int c = k * ${nc} + i;
      acc.x += dot(texelFetch(uW, ivec2(c, o0), 0), x);
      acc.y += dot(texelFetch(uW, ivec2(c, o0 + 1), 0), x);
      acc.z += dot(texelFetch(uW, ivec2(c, o0 + 2), 0), x);
      acc.w += dot(texelFetch(uW, ivec2(c, o0 + 3), 0), x);
    }
  }
  acc = gelu(acc);
  ${pos ? "acc += texelFetch(uPos, p, 0);" : ""}
  o = acc;
}`;

/** scores for four keys per texel; row r = (head − uHead0) · uTq + query */
const SCORES = `${HEAD}
uniform sampler2D uQ;
uniform sampler2D uK;
uniform int uQOff;
uniform int uKOff;
uniform int uTq;
uniform int uHead0;
uniform int uKeys;
uniform float uScale;
void main() {
  ivec2 p = P();
  int hl = p.y / uTq;
  int i = p.y - hl * uTq;
  int h = uHead0 + hl;
  int j0 = p.x * 4;
  int last = uKeys - 1;
  ivec4 j = min(ivec4(j0, j0 + 1, j0 + 2, j0 + 3), ivec4(last));
  vec4 s = vec4(0.0);
  for (int c = 0; c < 16; c++) {
    int col = 16 * h + c;
    vec4 q = texelFetch(uQ, ivec2(uQOff + col, i), 0);
    s.x += dot(q, texelFetch(uK, ivec2(uKOff + col, j.x), 0));
    s.y += dot(q, texelFetch(uK, ivec2(uKOff + col, j.y), 0));
    s.z += dot(q, texelFetch(uK, ivec2(uKOff + col, j.z), 0));
    s.w += dot(q, texelFetch(uK, ivec2(uKOff + col, j.w), 0));
  }
  s *= uScale;
  // keys past the end (the decoder's future, or a key count that isn't a multiple of 4)
  if (j0 + 1 > last) s.y = -1e30;
  if (j0 + 2 > last) s.z = -1e30;
  if (j0 + 3 > last) s.w = -1e30;
  if (j0 > last) s.x = -1e30;
  o = s;
}`;

const STATS = `${HEAD}
uniform sampler2D uS;
uniform int uNX;
void main() {
  ivec2 p = P();
  float m = -1e30;
  for (int x = 0; x < uNX; x++) {
    vec4 s = texelFetch(uS, ivec2(x, p.y), 0);
    m = max(m, max(max(s.x, s.y), max(s.z, s.w)));
  }
  float z = 0.0;
  for (int x = 0; x < uNX; x++) z += dot(exp(texelFetch(uS, ivec2(x, p.y), 0) - m), vec4(1.0));
  o = vec4(m, z, 0.0, 0.0);
}`;

/** Σ_j softmax_j · v_j for one head's 16 texels; the viewport covers that head's columns */
const PV = `${HEAD}
uniform sampler2D uS;
uniform sampler2D uSt;
uniform sampler2D uV;
uniform int uVOff;
uniform int uTq;
uniform int uHead0;
uniform int uNX;
uniform int uKeys;
void main() {
  ivec2 p = P();
  int h = p.x / 16;
  int row = (h - uHead0) * uTq + p.y;
  vec2 st = texelFetch(uSt, ivec2(0, row), 0).xy;
  int col = uVOff + p.x;
  int last = uKeys - 1;
  vec4 acc = vec4(0.0);
  for (int x = 0; x < uNX; x++) {
    vec4 w = exp(texelFetch(uS, ivec2(x, row), 0) - st.x);
    int j = 4 * x;
    acc += w.x * texelFetch(uV, ivec2(col, j), 0);
    acc += w.y * texelFetch(uV, ivec2(col, min(j + 1, last)), 0);
    acc += w.z * texelFetch(uV, ivec2(col, min(j + 2, last)), 0);
    acc += w.w * texelFetch(uV, ivec2(col, min(j + 3, last)), 0);
  }
  o = acc / st.y;
}`;

/** softmax rows of chosen queries, for looking at */
const GATHER = `${HEAD}
uniform sampler2D uS;
uniform sampler2D uSt;
uniform int uRows[64];
void main() {
  ivec2 p = P();
  int row = uRows[p.y];
  vec2 st = texelFetch(uSt, ivec2(0, row), 0).xy;
  o = exp(texelFetch(uS, ivec2(p.x, row), 0) - st.x) / st.y;
}`;

const COPY = `${HEAD}
uniform sampler2D uS;
uniform int uRow;
void main() {
  ivec2 p = P();
  o = texelFetch(uS, ivec2(p.x, uRow), 0);
}`;

/** token embedding (k vocabulary rows per texture row) plus the learned position */
const EMBED = (nd: number) => `${HEAD}
uniform sampler2D uE;
uniform sampler2D uPos;
uniform int uTok;
uniform int uRow;
uniform int uK;
void main() {
  ivec2 p = P();
  o = texelFetch(uE, ivec2(p.x + ${nd} * (uTok % uK), uTok / uK), 0) + texelFetch(uPos, ivec2(p.x, uRow), 0);
}`;

/** logits = h · Eᵀ, four vocabulary rows per output texel */
const LOGITS = (nd: number) => `${HEAD}
uniform sampler2D uE;
uniform sampler2D uH;
uniform int uK;
uniform int uW;
uniform int uN;
float row(int r) {
  if (r >= uN) return 0.0;
  ivec2 b = ivec2(${nd} * (r % uK), r / uK);
  float s = 0.0;
  for (int i = 0; i < ${nd}; i++) s += dot(texelFetch(uE, b + ivec2(i, 0), 0), texelFetch(uH, ivec2(i, 0), 0));
  return s;
}
void main() {
  ivec2 p = P();
  int n = 4 * (p.y * uW + p.x);
  o = vec4(row(n), row(n + 1), row(n + 2), row(n + 3));
}`;

export class WhisperGL implements TextModel {
  readonly dims: Dims;
  readonly alignment: [number, number][];
  readonly gl: WebGL2RenderingContext;
  readonly renderer: string;
  private canvas: HTMLCanvasElement | OffscreenCanvas;
  private fbo: WebGLFramebuffer;
  private vao: WebGLVertexArrayObject;
  private progs = new Map<string, Prog>();
  private pool = new Map<string, Tex[]>();
  private lost = false;

  // weights
  private conv1!: { w: Tex; b: Tex };
  private conv2!: { w: Tex; b: Tex };
  private pos!: Tex;
  private enc!: { ln1: Norm; qkv: Lin; out: Lin; ln2: Norm; fc1: Lin; fc2: Lin }[];
  private lnPost!: Norm;
  private dec!: { ln1: Norm; q: Lin; k: Lin; v: Lin; out: Lin; ln2: Norm; cq: Lin; ck: Lin; cv: Lin; co: Lin; ln3: Norm; fc1: Lin; fc2: Lin }[];
  private lnDec!: Norm;
  private emb!: Tex;
  private embK!: number;
  private decPos!: Tex;
  // decoder state
  private kCache!: Tex[];
  private vCache!: Tex[];
  private crossK: Tex[] = [];
  private crossV: Tex[] = [];
  private logitTex!: Tex;
  private logitW = 128;
  private logitBuf!: Float32Array<ArrayBuffer>;
  private qkTex!: Tex;
  private qkBuf!: Float32Array<ArrayBuffer>;

  static supported() {
    try {
      const c = document.createElement("canvas");
      const gl = c.getContext("webgl2");
      const ok = !!gl && !!gl.getExtension("EXT_color_buffer_float") && (gl.getParameter(gl.MAX_TEXTURE_SIZE) as number) >= 4096;
      gl?.getExtension("WEBGL_lose_context")?.loseContext();
      return ok;
    } catch {
      return false;
    }
  }

  /** compile nothing yet, upload everything: the weights go to the GPU in steps, so the page keeps drawing */
  static async create(w: Weights, dims: Dims, alignment: [number, number][], tick?: () => Promise<void> | void) {
    const g = new WhisperGL(dims, alignment);
    await g.load(w, tick);
    return g;
  }

  private constructor(dims: Dims, alignment: [number, number][]) {
    this.dims = dims;
    this.alignment = alignment;
    this.canvas = typeof OffscreenCanvas !== "undefined" ? new OffscreenCanvas(1, 1) : document.createElement("canvas");
    const gl = this.canvas.getContext("webgl2", { antialias: false, depth: false, stencil: false, alpha: false, powerPreference: "high-performance" }) as WebGL2RenderingContext | null;
    if (!gl || !gl.getExtension("EXT_color_buffer_float")) throw new Error("WebGL 2 with float render targets is required");
    this.gl = gl;
    const dbg = gl.getExtension("WEBGL_debug_renderer_info");
    this.renderer = String(dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER));
    (this.canvas as HTMLCanvasElement).addEventListener?.("webglcontextlost", () => (this.lost = true));
    this.fbo = gl.createFramebuffer()!;
    this.vao = gl.createVertexArray()!;
    gl.disable(gl.DITHER);
  }

  private async load(w: Weights, tick?: () => Promise<void> | void) {
    const gl = this.gl;
    const dims = this.dims;
    const alignment = this.alignment;
    const D = dims.n_audio_state;
    const data = (name: string) => dequantize(need(w, name));
    const lin = (name: string, bias = true): Lin => {
      const t = need(w, `${name}.weight`);
      const [O, I] = t.shape;
      return { w: this.constant(dequantize(t), I / 4, O), b: bias ? this.constant(data(`${name}.bias`), O / 4, 1) : null, O, I };
    };
    const norm = (name: string): Norm => ({ g: this.constant(data(`${name}.weight`), D / 4, 1), b: this.constant(data(`${name}.bias`), D / 4, 1) });
    // conv weights [O, C, 3] → texel (k · C/4 + i, o) = W[o, 4i … 4i+3, k]
    const conv = (name: string) => {
      const t = need(w, `${name}.weight`);
      const [O, C] = t.shape;
      const src = dequantize(t);
      const nc = C / 4;
      const dst = new Float32Array(O * C * 3);
      for (let o = 0; o < O; o++)
        for (let k = 0; k < 3; k++)
          for (let i = 0; i < nc; i++) for (let c = 0; c < 4; c++) dst[o * 3 * C + (k * nc + i) * 4 + c] = src[(o * C + 4 * i + c) * 3 + k];
      return { w: this.constant(dst, 3 * nc, O), b: this.constant(data(`${name}.bias`), O / 4, 1) };
    };
    this.conv1 = conv("encoder.conv1");
    this.conv2 = conv("encoder.conv2");
    this.pos = this.constant(sinusoids(dims.n_audio_ctx, D), D / 4, dims.n_audio_ctx);
    this.enc = Array.from({ length: dims.n_audio_layer }, (_, l) => {
      const p = `encoder.blocks.${l}`;
      // q, k, v as one [1152 × 384] matrix; the key projection has no bias
      const qkv = [data(`${p}.attn.query.weight`), data(`${p}.attn.key.weight`), data(`${p}.attn.value.weight`)];
      const W = new Float32Array(3 * D * D);
      qkv.forEach((m, i) => W.set(m, i * D * D));
      const B = new Float32Array(3 * D);
      B.set(data(`${p}.attn.query.bias`), 0);
      B.set(data(`${p}.attn.value.bias`), 2 * D);
      return {
        ln1: norm(`${p}.attn_ln`),
        qkv: { w: this.constant(W, D / 4, 3 * D), b: this.constant(B, (3 * D) / 4, 1), O: 3 * D, I: D },
        out: lin(`${p}.attn.out`),
        ln2: norm(`${p}.mlp_ln`),
        fc1: lin(`${p}.mlp.0`),
        fc2: lin(`${p}.mlp.2`),
      };
    });
    this.lnPost = norm("encoder.ln_post");
    await tick?.();
    this.dec = Array.from({ length: dims.n_text_layer }, (_, l) => {
      const p = `decoder.blocks.${l}`;
      return {
        ln1: norm(`${p}.attn_ln`),
        q: lin(`${p}.attn.query`),
        k: lin(`${p}.attn.key`, false),
        v: lin(`${p}.attn.value`),
        out: lin(`${p}.attn.out`),
        ln2: norm(`${p}.cross_attn_ln`),
        cq: lin(`${p}.cross_attn.query`),
        ck: lin(`${p}.cross_attn.key`, false),
        cv: lin(`${p}.cross_attn.value`),
        co: lin(`${p}.cross_attn.out`),
        ln3: norm(`${p}.mlp_ln`),
        fc1: lin(`${p}.mlp.0`),
        fc2: lin(`${p}.mlp.2`),
      };
    });
    this.lnDec = norm("decoder.ln");
    await tick?.();
    // the embedding, k rows to a texture row so its height fits; fp16 storage halves its 80 MB
    const max = gl.getParameter(gl.MAX_TEXTURE_SIZE) as number;
    const V = dims.n_vocab;
    let k = 1;
    while (Math.ceil(V / k) > max) k *= 2;
    this.embK = k;
    const E = need(w, "decoder.token_embedding.weight");
    if (E.kind !== "q8") throw new Error("expected an int8 token embedding");
    const rows = Math.ceil(V / k);
    const tex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA16F, (k * D) / 4, rows);
    for (const p of [gl.TEXTURE_MIN_FILTER, gl.TEXTURE_MAG_FILTER]) gl.texParameteri(gl.TEXTURE_2D, p, gl.NEAREST);
    // dequantised and uploaded a band of rows at a time
    const band = 1024;
    const buf = new Float32Array(band * k * D);
    for (let r0 = 0; r0 < rows; r0 += band) {
      const n = Math.min(band, rows - r0);
      buf.fill(0);
      const a = r0 * k * D;
      const b = Math.min(E.q.length, (r0 + n) * k * D);
      for (let i = a; i < b; i++) buf[i - a] = E.q[i] * E.scale[(i / E.block) | 0];
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, r0, (k * D) / 4, n, gl.RGBA, gl.FLOAT, buf.subarray(0, n * k * D));
      await tick?.();
    }
    this.emb = { tex, w: (k * D) / 4, h: rows, key: "const", half: true };
    this.decPos = this.constant(data("decoder.positional_embedding"), D / 4, dims.n_text_ctx);
    this.kCache = this.dec.map(() => this.acquire(D / 4, dims.n_text_ctx));
    this.vCache = this.dec.map(() => this.acquire(D / 4, dims.n_text_ctx));
    this.logitTex = this.acquire(this.logitW, Math.ceil(V / 4 / this.logitW));
    this.logitBuf = new Float32Array(this.logitTex.w * this.logitTex.h * 4);
    const nx = Math.ceil(dims.n_audio_ctx / 4);
    this.qkTex = this.acquire(nx, Math.max(1, alignment.length));
    this.qkBuf = new Float32Array(nx * 4 * Math.max(1, alignment.length));
  }

  // ── plumbing ──

  private constant(data: Float32Array, w: number, h: number, half = false): Tex {
    const gl = this.gl;
    const tex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texStorage2D(gl.TEXTURE_2D, 1, half ? gl.RGBA16F : gl.RGBA32F, w, h);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, w, h, gl.RGBA, gl.FLOAT, data);
    for (const p of [gl.TEXTURE_MIN_FILTER, gl.TEXTURE_MAG_FILTER]) gl.texParameteri(gl.TEXTURE_2D, p, gl.NEAREST);
    return { tex, w, h, key: "const", half };
  }

  private acquire(w: number, h: number): Tex {
    const key = `${w}x${h}`;
    const free = this.pool.get(key);
    if (free?.length) return free.pop()!;
    const gl = this.gl;
    const tex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA32F, w, h);
    for (const p of [gl.TEXTURE_MIN_FILTER, gl.TEXTURE_MAG_FILTER]) gl.texParameteri(gl.TEXTURE_2D, p, gl.NEAREST);
    return { tex, w, h, key };
  }

  private release(...ts: Tex[]) {
    for (const t of ts) {
      const list = this.pool.get(t.key) ?? [];
      list.push(t);
      this.pool.set(t.key, list);
    }
  }

  private program(key: string, frag: () => string) {
    let pr = this.progs.get(key);
    if (pr) return pr;
    const gl = this.gl;
    const sh = (type: number, src: string) => {
      const s = gl.createShader(type)!;
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(`${key}: ${gl.getShaderInfoLog(s)}`);
      return s;
    };
    const p = gl.createProgram()!;
    gl.attachShader(p, sh(gl.VERTEX_SHADER, VERT));
    gl.attachShader(p, sh(gl.FRAGMENT_SHADER, frag()));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(`${key}: ${gl.getProgramInfoLog(p)}`);
    pr = { p, u: new Map() };
    this.progs.set(key, pr);
    return pr;
  }

  /**
   * One draw into `out` over the rectangle (x, y, w, h). Samplers bind in the order given; ints and floats are
   * set by name (an int array as number[]).
   */
  private draw(pr: Prog, out: Tex, rect: [number, number, number, number], tex: Record<string, Tex>, ints: Record<string, number | number[]> = {}, floats: Record<string, number> = {}, origin: [number, number] = [rect[0], rect[1]]) {
    const gl = this.gl;
    const loc = (n: string) => {
      if (!pr.u.has(n)) pr.u.set(n, gl.getUniformLocation(pr.p, n));
      return pr.u.get(n)!;
    };
    gl.useProgram(pr.p);
    gl.bindVertexArray(this.vao);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, out.tex, 0);
    gl.viewport(...rect);
    let unit = 0;
    for (const [name, t] of Object.entries(tex)) {
      gl.activeTexture(gl.TEXTURE0 + unit);
      gl.bindTexture(gl.TEXTURE_2D, t.tex);
      gl.uniform1i(loc(name), unit++);
    }
    gl.uniform2i(loc("uOrigin"), origin[0], origin[1]);
    for (const [n, v] of Object.entries(ints)) {
      if (Array.isArray(v)) gl.uniform1iv(loc(n), Int32Array.from(v));
      else gl.uniform1i(loc(n), v);
    }
    for (const [n, v] of Object.entries(floats)) gl.uniform1f(loc(n), v);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    // unbind, so no texture is ever both sampled and rendered to
    for (let u = 0; u < unit; u++) {
      gl.activeTexture(gl.TEXTURE0 + u);
      gl.bindTexture(gl.TEXTURE_2D, null);
    }
  }

  private read(t: Tex, rows = t.h, y = 0, out: Float32Array = new Float32Array(t.w * rows * 4)) {
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t.tex, 0);
    gl.readPixels(0, y, t.w, rows, gl.RGBA, gl.FLOAT, out);
    if (this.lost || gl.isContextLost()) throw new Error("the GPU context was lost");
    return out;
  }

  private upload(data: Float32Array, w: number, h: number) {
    const t = this.acquire(w, h);
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, t.tex);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, w, h, gl.RGBA, gl.FLOAT, data);
    return t;
  }

  // ── layers ──

  private linear(L: Lin, x: Tex, opts: { act?: boolean; res?: Tex; out?: Tex; row?: number } = {}) {
    const ni = L.I / 4;
    const pr = this.program(`lin${ni}${!!L.b}${!!opts.act}${!!opts.res}`, () => LINEAR(ni, !!L.b, !!opts.act, !!opts.res));
    const y = opts.out ?? this.acquire(L.O / 4, x.h);
    const row = opts.row ?? 0;
    const tex: Record<string, Tex> = { uX: x, uW: L.w };
    if (L.b) tex.uB = L.b;
    if (opts.res) tex.uR = opts.res;
    this.draw(pr, y, [0, row, L.O / 4, x.h], tex);
    return y;
  }

  private norm(N: Norm, x: Tex) {
    const nc = x.w;
    const pr = this.program(`ln${nc}`, () => NORM(nc));
    const y = this.acquire(x.w, x.h);
    this.draw(pr, y, [0, 0, x.w, x.h], { uX: x, uG: N.g, uB: N.b });
    return y;
  }

  /**
   * Multi-head attention of queries (columns qOff… of q, `tq` rows) over `keys` keys and values. Heads run
   * `perDraw` at a time; `onScores(head, s, st)` sees each head's score and stats textures before they are reused.
   */
  private attention(q: Tex, qOff: number, k: Tex, kOff: number, v: Tex, vOff: number, tq: number, keys: number, out: Tex, perDraw: number, onScores?: (head: number, s: Tex, st: Tex) => void) {
    const H = this.dims.n_audio_head;
    const nx = Math.ceil(keys / 4);
    const s = this.acquire(Math.ceil(k.h / 4), tq * perDraw);
    const st = this.acquire(1, tq * perDraw);
    const scale = 1 / Math.sqrt(this.dims.n_audio_state / H);
    for (let h0 = 0; h0 < H; h0 += perDraw) {
      this.draw(this.program("scores", () => SCORES), s, [0, 0, nx, tq * perDraw], { uQ: q, uK: k }, { uQOff: qOff, uKOff: kOff, uTq: tq, uHead0: h0, uKeys: keys }, { uScale: scale });
      this.draw(this.program("stats", () => STATS), st, [0, 0, 1, tq * perDraw], { uS: s }, { uNX: nx });
      this.draw(this.program("pv", () => PV), out, [16 * h0, 0, 16 * perDraw, tq], { uS: s, uSt: st, uV: v }, { uVOff: vOff, uTq: tq, uHead0: h0, uNX: nx, uKeys: keys }, {}, [0, 0]);
      if (onScores) for (let h = h0; h < h0 + perDraw; h++) onScores(h, s, st);
    }
    this.release(s, st);
  }

  /** AudioEncoder.forward on a [80, 3000] log-mel; `probe` lists query frames whose attention to read back */
  async encode(mel: Float32Array, opts: { probe?: number[]; tick?: () => Promise<void> | void } = {}): Promise<EncodeResult> {
    const gl = this.gl;
    const t0 = performance.now();
    const { n_mels: M, n_audio_ctx: T, n_audio_state: D, n_audio_layer: NL, n_audio_head: H } = this.dims;
    const T0 = mel.length / M;
    // time-major: texel (i, t) = mels 4i … 4i+3 at frame t
    const xt = new Float32Array(T0 * M);
    for (let m = 0; m < M; m++) for (let t = 0; t < T0; t++) xt[t * M + m] = mel[m * T0 + t];
    const x0 = this.upload(xt, M / 4, T0);
    const c1 = this.acquire(D / 4, T0);
    this.draw(this.program("conv1", () => CONV(M / 4, 1, false)), c1, [0, 0, D / 4, T0], { uX: x0, uW: this.conv1.w, uB: this.conv1.b }, { uTin: T0 });
    this.release(x0);
    let x = this.acquire(D / 4, T);
    this.draw(this.program("conv2", () => CONV(D / 4, 2, true)), x, [0, 0, D / 4, T], { uX: c1, uW: this.conv2.w, uB: this.conv2.b, uPos: this.pos }, { uTin: T0 });
    this.release(c1);
    const stem = this.read(x);
    await opts.tick?.();

    const probeFrames = (opts.probe ?? []).slice(0, 64);
    const probes: Float32Array[][] = [];
    const blocks: Float32Array[] = [];
    const nx = T / 4;
    const gather = probeFrames.length ? this.acquire(nx, probeFrames.length) : null;
    for (let l = 0; l < NL; l++) {
      const B = this.enc[l];
      const h = this.norm(B.ln1, x);
      const qkv = this.linear(B.qkv, h);
      this.release(h);
      const att = this.acquire(D / 4, T);
      const rows: Float32Array[] = [];
      this.attention(qkv, 0, qkv, D / 4, qkv, D / 2, T, T, att, 1, (head, s, st) => {
        if (!gather) return;
        this.draw(this.program("gather", () => GATHER), gather, [0, 0, nx, probeFrames.length], { uS: s, uSt: st }, { uRows: [...probeFrames, ...new Array(64 - probeFrames.length).fill(0)] });
        rows[head] = this.read(gather);
      });
      probes.push(rows);
      this.release(qkv);
      const x1 = this.linear(B.out, att, { res: x });
      this.release(att, x);
      const h2 = this.norm(B.ln2, x1);
      const m = this.linear(B.fc1, h2, { act: true });
      this.release(h2);
      x = this.linear(B.fc2, m, { res: x1 });
      this.release(m, x1);
      blocks.push(this.read(x));
      gl.flush();
      await opts.tick?.();
    }
    if (gather) this.release(gather);
    void H;
    const xaT = this.norm(this.lnPost, x);
    this.release(x);
    const xa = this.read(xaT);
    // the decoder's cross-attention keys and values, once per audio
    this.release(...this.crossK, ...this.crossV);
    this.crossK = this.dec.map((L) => this.linear(L.ck, xaT));
    this.crossV = this.dec.map((L) => this.linear(L.cv, xaT));
    this.release(xaT);
    gl.finish();
    return { stem, blocks, xa, probes, probeFrames, ms: performance.now() - t0 };
  }

  /** the cross keys and values of layer l, read back (for checking against the CPU decoder) */
  readCross(l: number) {
    return { k: this.read(this.crossK[l]), v: this.read(this.crossV[l]) };
  }

  *forward(token: number, pos: number, logits: Float32Array | null): Generator<void, Float32Array[]> {
    const D = this.dims.n_text_state;
    const nd = D / 4;
    const Ta = this.dims.n_audio_ctx;
    const H = this.dims.n_text_head;
    if (!this.crossK.length) throw new Error("encode() first");
    let x = this.acquire(nd, 1);
    this.draw(this.program("embed", () => EMBED(nd)), x, [0, 0, nd, 1], { uE: this.emb, uPos: this.decPos }, { uTok: token, uRow: pos, uK: this.embK });
    for (let l = 0; l < this.dec.length; l++) {
      const L = this.dec[l];
      // masked self-attention: this position's k and v go into the cache at row `pos`
      const h = this.norm(L.ln1, x);
      const q = this.linear(L.q, h);
      this.linear(L.k, h, { out: this.kCache[l], row: pos });
      this.linear(L.v, h, { out: this.vCache[l], row: pos });
      this.release(h);
      const a = this.acquire(nd, 1);
      this.attention(q, 0, this.kCache[l], 0, this.vCache[l], 0, 1, pos + 1, a, H);
      this.release(q);
      const x1 = this.linear(L.out, a, { res: x });
      this.release(a, x);
      // cross-attention over the 1500 audio frames
      const h2 = this.norm(L.ln2, x1);
      const cq = this.linear(L.cq, h2);
      this.release(h2);
      const ca = this.acquire(nd, 1);
      this.attention(cq, 0, this.crossK[l], 0, this.crossV[l], 0, 1, Ta, ca, H, (head, s) => {
        const k = this.alignment.findIndex(([al, ah]) => al === l && ah === head);
        if (k >= 0) this.draw(this.program("copy", () => COPY), this.qkTex, [0, k, s.w, 1], { uS: s }, { uRow: head });
      });
      this.release(cq);
      const x2 = this.linear(L.co, ca, { res: x1 });
      this.release(ca, x1);
      const h3 = this.norm(L.ln3, x2);
      const m = this.linear(L.fc1, h3, { act: true });
      this.release(h3);
      x = this.linear(L.fc2, m, { res: x2 });
      this.release(m, x2);
    }
    if (logits) {
      const hf = this.norm(this.lnDec, x);
      const n = logits.length;
      this.draw(this.program("logits", () => LOGITS(nd)), this.logitTex, [0, 0, this.logitTex.w, Math.ceil(n / 4 / this.logitW)], { uE: this.emb, uH: hf }, { uK: this.embK, uW: this.logitW, uN: n });
      this.release(hf);
      const rows = Math.ceil(n / 4 / this.logitW);
      this.read(this.logitTex, rows, 0, this.logitBuf.subarray(0, rows * this.logitW * 4));
      logits.set(this.logitBuf.subarray(0, n));
    }
    this.release(x);
    const qk = this.read(this.qkTex, this.qkTex.h, 0, this.qkBuf);
    yield;
    return this.alignment.map((_, k) => qk.slice(k * Ta, (k + 1) * Ta));
  }

  dispose() {
    const gl = this.gl;
    for (const list of this.pool.values()) for (const t of list) gl.deleteTexture(t.tex);
    this.pool.clear();
    for (const pr of this.progs.values()) gl.deleteProgram(pr.p);
    gl.deleteFramebuffer(this.fbo);
    gl.getExtension("WEBGL_lose_context")?.loseContext();
  }
}
