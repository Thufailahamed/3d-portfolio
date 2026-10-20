# Diffusion assets

`/diffusion` loads three files from `public/diffusion/`, all made by `build.mjs`:

| file | what it is |
| --- | --- |
| `taesd_decoder.bin` | TAESD's decoder weights (fp16, PyTorch layout), run in WebGL by `src/diffusion/pipeline/taesd-gl.ts` |
| `latents.bin` | 100 training latents, 4 × 64 × 64 each, in TAESD's 8-bit format (`z / 6 + 0.5`) |
| `manifest.json` | prompts, their CLIP token ids, the decoder's layer table, latent → RGB preview fit |

plus `train.webp`, a sprite of the training images for the panels.

## Rebuilding

```sh
# weights and tokenizer vocabulary (MIT), into any folder
curl -LO https://raw.githubusercontent.com/madebyollin/taesd/main/taesd_encoder.pth
curl -LO https://raw.githubusercontent.com/madebyollin/taesd/main/taesd_decoder.pth
curl -LO https://raw.githubusercontent.com/openai/CLIP/main/clip/bpe_simple_vocab_16e6.txt.gz

npm i --no-save puppeteer-core          # the encoder runs in headless Chrome, on the GPU
node scripts/diffusion/build.mjs <that folder>
node scripts/diffusion/check.mjs <that folder>   # WebGL network vs the CPU reference
```

`dataset.mjs` lists the renders each prompt is trained on. `torch.mjs` reads `.pth` files without PyTorch,
`taesd.mjs` is the CPU reference network and `clip-tokenizer.mjs` a port of CLIP's `simple_tokenizer.py`.
