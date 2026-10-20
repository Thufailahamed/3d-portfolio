/**
 * Stable Diffusion v1.5, as configured in runwayml/stable-diffusion-v1-5 (diffusers).
 * These are the reference figures the scene is built from: every shape and count below is the real model's.
 */

export const TOKENIZER = { vocab: 49408, context: 77, bos: 49406, eos: 49407, pad: 49407 };

/** CLIP ViT-L/14 text tower; SD 1.x conditions on its last hidden state */
export const TEXT_ENCODER = { name: "CLIP ViT-L/14 text encoder", layers: 12, width: 768, heads: 12, mlp: 3072, params: 123_060_480 };

export const LATENT = { channels: 4, factor: 8, scale: 0.18215 };

export const VAE = { encoderParams: 34_163_592, decoderParams: 49_490_179 };
/** madebyollin/taesd: the distilled decoder that runs here, same latent API */
export const TAESD = { decoderParams: 1_222_531 };

export const UNET = {
  params: 859_520_964,
  channels: [320, 640, 1280, 1280],
  heads: 8,
  timeEmbed: 1280,
  crossAttnDim: 768,
};

export type UNetBlock = {
  id: string;
  label: string;
  /** spatial side at 512 px (latent 64) */
  res: number;
  ch: number;
  /** resnets and cross-attention transformers in the block */
  resnets: number;
  attn: number;
  /** spatial change at the block's exit */
  resample?: "down" | "up";
};

/** the U-Net's blocks in execution order */
export const UNET_BLOCKS: UNetBlock[] = [
  { id: "down0", label: "CrossAttnDownBlock2D", res: 64, ch: 320, resnets: 2, attn: 2, resample: "down" },
  { id: "down1", label: "CrossAttnDownBlock2D", res: 32, ch: 640, resnets: 2, attn: 2, resample: "down" },
  { id: "down2", label: "CrossAttnDownBlock2D", res: 16, ch: 1280, resnets: 2, attn: 2, resample: "down" },
  { id: "down3", label: "DownBlock2D", res: 8, ch: 1280, resnets: 2, attn: 0 },
  { id: "mid", label: "UNetMidBlock2DCrossAttn", res: 8, ch: 1280, resnets: 2, attn: 1 },
  { id: "up0", label: "UpBlock2D", res: 8, ch: 1280, resnets: 3, attn: 0, resample: "up" },
  { id: "up1", label: "CrossAttnUpBlock2D", res: 16, ch: 1280, resnets: 3, attn: 3, resample: "up" },
  { id: "up2", label: "CrossAttnUpBlock2D", res: 32, ch: 640, resnets: 3, attn: 3, resample: "up" },
  { id: "up3", label: "CrossAttnUpBlock2D", res: 64, ch: 320, resnets: 3, attn: 3 },
];

/** conv_in plus every down-path resnet and downsampler feeds one skip connection */
export const SKIPS = 12;

/**
 * The 320-dim sinusoidal timestep embedding the U-Net's time MLP takes
 * (diffusers get_timestep_embedding with flip_sin_to_cos = True, downscale_freq_shift = 0).
 */
export function timestepEmbedding(t: number, dim = 320, out = new Float32Array(dim)) {
  const half = dim / 2;
  for (let i = 0; i < half; i++) {
    const a = t * Math.exp((-Math.log(10000) * i) / half);
    out[i] = Math.cos(a);
    out[half + i] = Math.sin(a);
  }
  return out;
}
