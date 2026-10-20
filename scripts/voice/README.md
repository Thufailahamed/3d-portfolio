# Voice assets

`/voice` loads four files from `public/voice/`, all made by `build.mjs` from OpenAI's original release:

| file | what it is |
| --- | --- |
| `whisper-tiny-en.bin` | Whisper tiny.en: the encoder at the checkpoint's own fp16, the decoder's matrices and token embedding int8 in blocks of 32 (whisper.cpp's q8_0 layout), vectors fp16 |
| `manifest.json` | dims, tensor table, the 8 alignment heads, the 90 suppressed tokens |
| `vocab.txt` | GPT-2's 50 256 byte-level pieces in rank order, for decoding token ids |
| `samples/jfk.wav` | the test clip from whisper.cpp (JFK, 1961, public domain) |

The page runs all of it in WebGL (`src/voice/whisper/gl.ts`); the front end, voice detector and decoding rules
are plain TypeScript in `src/voice/audio` and `src/voice/whisper`.

## Rebuilding and checking

```sh
# into any folder
curl -LO https://openaipublic.azureedge.net/main/whisper/models/d3dd57d32accea0b295c96e26691aa14d8822fac7d9d27d5dc00b4ca2826dd03/tiny.en.pt
curl -LO https://raw.githubusercontent.com/openai/whisper/main/whisper/assets/gpt2.tiktoken
curl -LO https://raw.githubusercontent.com/openai/whisper/main/whisper/assets/mel_filters.npz
curl -LO https://raw.githubusercontent.com/ggerganov/whisper.cpp/master/samples/jfk.wav

node scripts/voice/build.mjs <that folder>    # checks the checkpoint's sha256, writes public/voice/
node scripts/voice/check.mjs <that folder>    # CPU: FFT, mel filters, log-mel, encoder, decoding, word times, VAD (~2 min)
npm i --no-save puppeteer-core                # or point PUPPETEER_CORE at an install elsewhere
node scripts/voice/gpu.mjs                    # the page's WebGL network in headless Chrome against check.mjs's results
```

`reference.mjs` is an independent float32 Whisper written from `whisper/model.py` and `audio.py` (direct DFT,
OpenAI's own filterbank, no KV cache); `ts.mjs` lets the scripts import the page's TypeScript as it is.
