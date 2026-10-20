/**
 * TAESD (madebyollin/taesd) on the CPU, layer for layer as in taesd.py.
 * Tensors are { c, h, w, data: Float32Array } in CHW order. This is the reference the WebGL decoder is checked against.
 */

export const tensor = (c, h, w, data = new Float32Array(c * h * w)) => ({ c, h, w, data });

/** 3×3 convolution, padding 1; `up` reads a 2× nearest-upsampled input, `stride` 2 halves the output */
export function conv3(x, W, b, { stride = 1, up = false } = {}) {
  const [O, C] = W.shape;
  const ih = up ? x.h * 2 : x.h;
  const iw = up ? x.w * 2 : x.w;
  const oh = stride === 2 ? ih / 2 : ih;
  const ow = stride === 2 ? iw / 2 : iw;
  const out = tensor(O, oh, ow);
  const src = up ? upsample(x) : x;
  const plane = ih * iw;
  const oplane = oh * ow;
  for (let o = 0; o < O; o++) {
    const dst = out.data.subarray(o * oplane, (o + 1) * oplane);
    if (b) dst.fill(b.data[o]);
    for (let c = 0; c < C; c++) {
      const s = src.data.subarray(c * plane, (c + 1) * plane);
      for (let ky = 0; ky < 3; ky++)
        for (let kx = 0; kx < 3; kx++) {
          const wv = W.data[((o * C + c) * 3 + ky) * 3 + kx];
          if (wv === 0) continue;
          if (stride === 1) {
            const dx = kx - 1;
            const x0 = Math.max(0, -dx);
            const x1 = Math.min(ow, iw - dx);
            for (let y = 0; y < oh; y++) {
              const iy = y + ky - 1;
              if (iy < 0 || iy >= ih) continue;
              const ro = y * ow;
              const ri = iy * iw + dx;
              for (let xx = x0; xx < x1; xx++) dst[ro + xx] += wv * s[ri + xx];
            }
          } else {
            for (let y = 0; y < oh; y++) {
              const iy = y * 2 + ky - 1;
              if (iy < 0 || iy >= ih) continue;
              const ro = y * ow;
              const ri = iy * iw;
              for (let xx = 0; xx < ow; xx++) {
                const ix = xx * 2 + kx - 1;
                if (ix >= 0 && ix < iw) dst[ro + xx] += wv * s[ri + ix];
              }
            }
          }
        }
    }
  }
  return out;
}

export function upsample(x) {
  const out = tensor(x.c, x.h * 2, x.w * 2);
  for (let c = 0; c < x.c; c++)
    for (let y = 0; y < out.h; y++)
      for (let xx = 0; xx < out.w; xx++) out.data[(c * out.h + y) * out.w + xx] = x.data[(c * x.h + (y >> 1)) * x.w + (xx >> 1)];
  return out;
}

const relu = (x) => {
  for (let i = 0; i < x.data.length; i++) if (x.data[i] < 0) x.data[i] = 0;
  return x;
};

function block(x, sd, p) {
  const a = relu(conv3(x, sd.get(`${p}.conv.0.weight`), sd.get(`${p}.conv.0.bias`)));
  const b = relu(conv3(a, sd.get(`${p}.conv.2.weight`), sd.get(`${p}.conv.2.bias`)));
  const c = conv3(b, sd.get(`${p}.conv.4.weight`), sd.get(`${p}.conv.4.bias`));
  for (let i = 0; i < c.data.length; i++) c.data[i] = Math.max(0, c.data[i] + x.data[i]);
  return c;
}

/** image 3×H×W in [0, 1] → latent 4×H/8×W/8 (already on the diffusion model's scale) */
export function encode(img, sd) {
  let x = conv3(img, sd.get("0.weight"), sd.get("0.bias"));
  x = block(x, sd, "1");
  for (const [down, blocks] of [[2, [3, 4, 5]], [6, [7, 8, 9]], [10, [11, 12, 13]]]) {
    x = conv3(x, sd.get(`${down}.weight`), null, { stride: 2 });
    for (const k of blocks) x = block(x, sd, String(k));
  }
  return conv3(x, sd.get("14.weight"), sd.get("14.bias"));
}

/** latent → image in [0, 1]; `taps` receives every stage's activations, for checking a port */
export function decode(z, sd, taps) {
  const x0 = tensor(z.c, z.h, z.w, z.data.map((v) => Math.tanh(v / 3) * 3));
  let x = relu(conv3(x0, sd.get("1.weight"), sd.get("1.bias")));
  for (const k of [3, 4, 5]) x = block(x, sd, String(k));
  taps?.push(x);
  for (const [up, blocks] of [[7, [8, 9, 10]], [12, [13, 14, 15]], [17, [18]]]) {
    x = conv3(x, sd.get(`${up}.weight`), null, { up: true });
    for (const k of blocks) x = block(x, sd, String(k));
    taps?.push(x);
  }
  const out = conv3(x, sd.get("19.weight"), sd.get("19.bias"));
  for (let i = 0; i < out.data.length; i++) out.data[i] = Math.min(1, Math.max(0, out.data[i]));
  return out;
}
