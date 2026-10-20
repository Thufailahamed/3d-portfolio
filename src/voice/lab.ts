/**
 * Everything the page computes, in one place: the clip, its voice-activity trace and log-mel spectrogram, and
 * Whisper's encoder, decoder and word alignment on the GPU. The scene and the panels read from here; the store
 * only carries what React needs to re-render.
 */
import { decodeFile, Mic, play } from "./audio/capture";
import { FrameAnalyzer, HOP, logMelSpectrogram, N_BINS, N_FFT, SAMPLE_RATE, toPcm16Grid, type LogMel } from "./audio/frontend";
import { Resampler } from "./audio/resample";
import { Endpointer, segments as vadSegments, Vad, VAD, type Segment as VadSegment, type VadStep } from "./audio/vad";
import { parseWav } from "./audio/wav";
import { findAlignment, type Alignment } from "./whisper/align";
import { decodeAttempt, DEFAULT_OPTIONS, segmentsOf, type Attempt, type Segment } from "./whisper/decoder";
import { WhisperGL, type EncodeResult } from "./whisper/gl";
import { Tokenizer } from "./whisper/tokenizer";
import { readWeights, type Manifest } from "./whisper/weights";
import { useVoice, type Source } from "./store";
import { stageIndex } from "./story";

const BASE = "/voice";
export const MAX_SECONDS = 30;
/** transcribe.py's thresholds for a failed decode */
export const THRESHOLDS = { compression: 2.4, logprob: -1, noSpeech: 0.6 } as const;
export const FALLBACK = [0, 0.2, 0.4, 0.6, 0.8, 1] as const;

export type Clip = {
  source: Source;
  name: string;
  /** the input at its own rate, before resampling */
  raw: { rate: number; data: Float32Array };
  /** 16 kHz on the 16-bit grid */
  full: Float32Array;
  /** the part Whisper hears, as sample indices into `full` */
  trim: [number, number];
  audio: Float32Array;
};

export type VadTrace = {
  steps: VadStep[];
  /** a-posteriori SNR 10·log10 γ_k per frame, [frames × 201], for drawing */
  gammaDb: Float32Array;
  /** the noise estimate λ_N in dB per frame, [frames × 201] */
  noiseDb: Float32Array;
  segments: VadSegment[];
  frames: number;
};

export type Verdict = { temperature: number; compression: number; failed: string | null; silent: boolean };

export type Run = {
  id: number;
  clip: Clip;
  vad: VadTrace;
  mel: LogMel;
  enc: EncodeResult | null;
  attempts: Attempt[];
  verdicts: Verdict[];
  final: Attempt | null;
  segments: Segment[];
  align: Alignment | null;
  ms: { mel: number; enc: number; dec: number; align: number };
  error: string | null;
};

/** frames probed for the encoder's self-attention picture */
export const PROBES = 48;

let lab: Lab | null = null;
export const getLab = () => lab;
export const setLab = (l: Lab | null) => (lab = l);

const nextFrame = () => new Promise<void>((r) => requestAnimationFrame(() => r()));

/** zlib.compress length ratio, as whisper.utils.compression_ratio (CompressionStream "deflate" is zlib's format) */
export async function compressionRatio(text: string) {
  const bytes = new TextEncoder().encode(text);
  if (!bytes.length || typeof CompressionStream === "undefined") return 0;
  const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream("deflate"));
  const out = await new Response(stream).arrayBuffer();
  return bytes.length / out.byteLength;
}

async function fetchBytes(url: string, onProgress: (f: number) => void) {
  const res = await fetch(url);
  if (!res.ok || !res.body) throw new Error(`${url}: ${res.status}`);
  const total = Number(res.headers.get("content-length")) || 0;
  const reader = res.body.getReader();
  const parts: Uint8Array[] = [];
  let got = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    parts.push(value);
    got += value.length;
    if (total) onProgress(got / total);
  }
  const out = new Uint8Array(got);
  let o = 0;
  for (const p of parts) out.set(p, (o += p.length) - p.length);
  onProgress(1);
  return out.buffer;
}

/** the detector over a whole clip, on the same centred frames as Whisper's STFT */
export function traceVad(power: Float32Array, frames: number): VadTrace {
  const v = new Vad(N_BINS);
  const steps: VadStep[] = [];
  const gammaDb = new Float32Array(frames * N_BINS);
  const noiseDb = new Float32Array(frames * N_BINS);
  for (let f = 0; f < frames; f++) {
    const p = power.subarray(f * N_BINS, (f + 1) * N_BINS);
    steps.push(v.step(p));
    for (let k = 0; k < N_BINS; k++) {
      gammaDb[f * N_BINS + k] = steps[f].calibrating ? 0 : 10 * Math.log10(Math.max(v.gamma[k], 1e-3));
      noiseDb[f * N_BINS + k] = 10 * Math.log10(Math.max(v.noise[k], 1e-12));
    }
  }
  return { steps, gammaDb, noiseDb, segments: vadSegments(steps), frames };
}

/** the recorder: microphone → 16 kHz → 25 ms frames → detector → endpoint */
export class Live {
  readonly mic: Mic;
  readonly rate: number;
  readonly raw: Float32Array;
  rawN = 0;
  readonly samples = new Float32Array((MAX_SECONDS + 1) * SAMPLE_RATE);
  n = 0;
  readonly vad = new Vad(N_BINS);
  readonly end = new Endpointer();
  readonly steps: VadStep[] = [];
  readonly power = new Float64Array(N_BINS);
  /** RMS of the latest block, in dBFS */
  level = -100;
  private rs: Resampler;
  private an = new FrameAnalyzer();
  private frame = new Float64Array(N_FFT);
  private onDone: (why: "endpoint" | "limit" | "silence") => void;
  done = false;

  constructor(mic: Mic, onDone: (why: "endpoint" | "limit" | "silence") => void) {
    this.mic = mic;
    this.rate = mic.rate;
    this.raw = new Float32Array((MAX_SECONDS + 1) * mic.rate);
    this.rs = new Resampler(mic.rate, SAMPLE_RATE);
    this.onDone = onDone;
  }

  push(x: Float32Array) {
    if (this.done) return;
    let s = 0;
    for (const v of x) s += v * v;
    this.level = 10 * Math.log10(s / x.length + 1e-10);
    const room = this.raw.length - this.rawN;
    this.raw.set(x.subarray(0, room), this.rawN);
    this.rawN += Math.min(room, x.length);
    const y = this.rs.push(x);
    const fit = Math.min(y.length, MAX_SECONDS * SAMPLE_RATE - this.n);
    this.samples.set(y.subarray(0, fit), this.n);
    this.n += fit;
    // frame f is centred on sample 160 f, as in Whisper's STFT; it is complete once sample 160 f + 199 is in
    for (;;) {
      const f = this.steps.length;
      const c = f * HOP;
      if (c + N_FFT / 2 > this.n) break;
      for (let i = 0; i < N_FFT; i++) {
        const j = c - N_FFT / 2 + i;
        this.frame[i] = j < 0 ? 0 : this.samples[j];
      }
      this.an.power(this.frame, this.power);
      const st = this.vad.step(this.power);
      this.steps.push(st);
      this.end.step(st);
    }
    const t = this.n / SAMPLE_RATE;
    if (this.end.done) this.finish("endpoint");
    else if (t >= MAX_SECONDS) this.finish("limit");
    else if (t > 10 && this.end.speechFrames === 0) this.finish("silence");
  }

  finish(why: "endpoint" | "limit" | "silence") {
    if (this.done) return;
    this.done = true;
    this.mic.close();
    this.onDone(why);
  }

  get calibrating() {
    return this.steps.length <= VAD.calib;
  }
}

export class Lab {
  readonly manifest: Manifest;
  readonly tok: Tokenizer;
  readonly sample: Clip;
  model: WhisperGL | null = null;
  run: Run | null = null;
  live: Live | null = null;
  private seq = 0;
  /** one GPU job at a time: a newer one makes the older stop at its next frame */
  private job = 0;
  private queue: Promise<void> = Promise.resolve();
  private player: ReturnType<typeof play> | null = null;

  constructor(manifest: Manifest, tok: Tokenizer, sample: Clip) {
    this.manifest = manifest;
    this.tok = tok;
    this.sample = sample;
  }

  static async boot() {
    const [manifest, vocab, wav] = await Promise.all([
      fetch(`${BASE}/manifest.json`).then((r) => r.json() as Promise<Manifest>),
      fetch(`${BASE}/vocab.txt`).then((r) => r.text()),
      fetch(`${BASE}/samples/jfk.wav`).then((r) => r.arrayBuffer()),
    ]);
    const pcm = parseWav(wav);
    const sample = Lab.clip("sample", "JFK, inaugural address, 1961", pcm.rate, pcm.data);
    return new Lab(manifest, new Tokenizer(vocab.split("\n")), sample);
  }

  /** download the weights and put them on the GPU, in the background */
  async loadModel() {
    const set = (m: Partial<ReturnType<typeof useVoice.getState>["model"]>) => useVoice.getState().set({ model: { ...useVoice.getState().model, ...m } });
    try {
      const buf = await fetchBytes(`${BASE}/${this.manifest.file}`, (f) => set({ progress: f * 0.95 }));
      await nextFrame();
      const w = readWeights(this.manifest, buf);
      this.model = await WhisperGL.create(w, this.manifest.dims, this.manifest.alignmentHeads, nextFrame);
      set({ progress: 1, ready: true });
      if (this.run && !this.run.enc) this.enqueue(this.run);
    } catch (e) {
      set({ error: (e as Error).message });
    }
  }

  /** a clip from samples at any rate: resampled to 16 kHz, put on the 16-bit grid, capped at 30 s */
  static clip(source: Source, name: string, rate: number, data: Float32Array): Clip {
    const at16 = rate === SAMPLE_RATE ? data : Resampler.offline(data, rate, SAMPLE_RATE);
    const full = toPcm16Grid(at16.subarray(0, MAX_SECONDS * SAMPLE_RATE));
    return { source, name, raw: { rate, data }, full, trim: [0, full.length], audio: full };
  }

  async fromFile(file: File) {
    const { rate, data } = await decodeFile(await file.arrayBuffer());
    this.start(Lab.clip("file", file.name, rate, data));
  }

  /** open the microphone; the detector ends the recording when you stop talking */
  async record() {
    const st = useVoice.getState();
    this.stopLive();
    st.set({ mic: "asking", stage: 0, p: 0, playing: false, follow: true, overview: false });
    let live: Live | null = null;
    try {
      const mic = await Mic.open((x) => {
        live?.push(x);
        const s = useVoice.getState();
        if (!live || live.done) return;
        const m = live.calibrating ? "calibrating" : live.vad.open ? "speech" : "listening";
        if (m !== s.mic || Math.abs(live.n / SAMPLE_RATE - s.recorded) > 0.1) s.set({ mic: m, recorded: live.n / SAMPLE_RATE });
      });
      live = new Live(mic, (why) => this.endLive(why));
      this.live = live;
      st.set({ mic: "calibrating", recorded: 0 });
    } catch (e) {
      st.set({ mic: "denied", error: (e as Error).message });
    }
  }

  stopLive() {
    if (this.live && !this.live.done) this.live.finish("endpoint");
  }

  private endLive(why: "endpoint" | "limit" | "silence") {
    const live = this.live;
    if (!live) return;
    const s = useVoice.getState();
    if (why === "silence" || live.n < SAMPLE_RATE * 0.3) {
      s.set({ mic: "done", error: "The detector didn't hear any speech. Try again a little closer to the microphone." });
      this.live = null;
      return;
    }
    const raw = live.raw.slice(0, live.rawN);
    const clip = Lab.clip("mic", why === "limit" ? "Your recording (30 s limit)" : "Your recording", live.rate, raw);
    this.live = null;
    s.set({ mic: "done", error: null });
    this.start(clip, true);
  }

  /** a new run: detector and log-mel now (milliseconds), the networks as soon as the weights are in */
  start(clip: Clip, trim = false) {
    const t0 = performance.now();
    const full = logMelSpectrogram(clip.full);
    const vad = traceVad(full.power, full.powerFrames);
    // leading and trailing silence the detector is sure of is not sent to Whisper
    if (trim && vad.segments.length) {
      const pad = 0.15 * SAMPLE_RATE;
      const a = Math.max(0, vad.segments[0].start * HOP - pad);
      const b = Math.min(clip.full.length, vad.segments[vad.segments.length - 1].end * HOP + pad);
      clip.trim = [a > 0.5 * SAMPLE_RATE ? a : 0, clip.full.length - b > 0.5 * SAMPLE_RATE ? b : clip.full.length];
      clip.audio = clip.full.subarray(clip.trim[0], clip.trim[1]);
    }
    const mel = clip.trim[0] === 0 && clip.trim[1] === clip.full.length ? full : logMelSpectrogram(clip.audio);
    const id = ++this.seq;
    this.run = { id, clip, vad, mel, enc: null, attempts: [], verdicts: [], final: null, segments: [], align: null, ms: { mel: performance.now() - t0, enc: 0, dec: 0, align: 0 }, error: null };
    const st = useVoice.getState();
    st.set({ run: id, source: clip.source, enc: "waiting", dec: "idle", align: "idle", tokens: 0, stage: clip.source === "mic" ? stageIndex("vad") : 0, p: 0, playing: true, follow: true, overview: false });
    if (this.model) this.enqueue(this.run);
  }

  /** decode again with the current settings, keeping the clip and its encoding */
  redecode() {
    const r = this.run;
    if (!r || !r.enc || !this.model) return;
    const s = useVoice.getState();
    s.set({ stage: stageIndex("decoder"), p: 0, playing: true, follow: true });
    this.enqueue(r, true);
  }

  private enqueue(r: Run, decodeOnly = false) {
    const job = ++this.job;
    this.queue = this.queue.then(() => (this.job === job ? this.process(r, job, decodeOnly) : undefined));
  }

  private async drive<T>(g: Generator<void, T>, alive: () => boolean, budget = 4): Promise<T | null> {
    for (;;) {
      const t0 = performance.now();
      for (;;) {
        const r = g.next();
        if (r.done) return r.value;
        if (performance.now() - t0 > budget) break;
      }
      await nextFrame();
      if (!alive()) return null;
    }
  }

  private async process(r: Run, job: number, decodeOnly = false) {
    const model = this.model!;
    const set = useVoice.getState().set;
    const alive = () => this.run?.id === r.id && this.job === job;
    try {
      if (!decodeOnly) {
        set({ enc: "running" });
        await nextFrame();
        const probe = this.probeFrames(r.mel.contentFrames);
        r.enc = await model.encode(r.mel.mel, { probe, tick: nextFrame });
        r.ms.enc = r.enc.ms;
        if (!alive()) return;
        set({ enc: "done" });
      }
      // transcribe.py: retry at higher temperatures while the output looks like a failure
      set({ dec: "running", align: "idle", tokens: 0 });
      r.attempts = [];
      r.verdicts = [];
      r.final = null;
      r.align = null;
      const s = useVoice.getState();
      const temps = s.temperature > 0 ? [s.temperature] : [...FALLBACK];
      const cfg = { suppress: this.manifest.suppress, blank: this.manifest.blank };
      const t0 = performance.now();
      for (let i = 0; i < temps.length; i++) {
        const att = {} as Attempt;
        r.attempts.push(att);
        const opts = { ...DEFAULT_OPTIONS, temperature: temps[i], timestamps: s.timestamps, seed: s.seed + i };
        const g = decodeAttempt(model, this.tok, cfg, opts, att);
        // report tokens as they land
        const watch = (function* (): Generator<void, Attempt> {
          for (;;) {
            const x = g.next();
            if (useVoice.getState().tokens !== att.steps?.length) set({ tokens: att.steps?.length ?? 0 });
            if (x.done) return x.value;
            yield;
          }
        })();
        const done = await this.drive(watch, alive);
        if (!done || !alive()) return;
        const compression = await compressionRatio(done.text);
        let failed: string | null = null;
        if (compression > THRESHOLDS.compression) failed = `compression ratio ${compression.toFixed(2)} > ${THRESHOLDS.compression}`;
        if (done.avgLogprob < THRESHOLDS.logprob) failed = `avg log-prob ${done.avgLogprob.toFixed(2)} < ${THRESHOLDS.logprob}`;
        const silent = done.noSpeechProb > THRESHOLDS.noSpeech && done.avgLogprob < THRESHOLDS.logprob;
        if (silent) failed = null;
        r.verdicts.push({ temperature: temps[i], compression, failed, silent });
        if (!failed || i === temps.length - 1) break;
      }
      r.final = r.attempts[r.attempts.length - 1];
      r.ms.dec = performance.now() - t0;
      const v = r.verdicts[r.verdicts.length - 1];
      // transcribe.py skips the window as silence when <|nospeech|> wins and the text is unconvincing
      const skip = v.silent || (r.final.noSpeechProb > THRESHOLDS.noSpeech && r.final.avgLogprob <= THRESHOLDS.logprob);
      r.segments = skip ? [] : segmentsOf(r.final.tokens, this.tok, r.clip.audio.length / SAMPLE_RATE);
      set({ dec: "done", tokens: r.final.steps.length, align: "running" });
      const text = r.final.tokens.filter((t) => t < this.tok.sp.eot);
      const t1 = performance.now();
      r.align = skip ? null : await this.drive(findAlignment(model, this.tok, text, r.mel.contentFrames), alive);
      r.ms.align = performance.now() - t1;
      if (!alive()) return;
      set({ align: "done" });
    } catch (e) {
      r.error = (e as Error).message;
      if (alive()) set({ enc: r.enc ? "done" : "error", dec: "error", align: "error" });
    }
  }

  /** play what Whisper heard, from `from` seconds */
  listen(from = 0) {
    this.stopListening();
    const r = this.run;
    if (!r) return;
    this.player = play(r.clip.audio, SAMPLE_RATE, Math.max(0, from));
    useVoice.getState().set({ listening: true });
  }

  stopListening() {
    this.player?.stop();
    this.player = null;
    if (useVoice.getState().listening) useVoice.getState().set({ listening: false });
  }

  /** the playback position in seconds, or −1 */
  playTime() {
    if (!this.player) return -1;
    const t = this.player.time;
    if (t < 0) this.stopListening();
    return t;
  }

  /** evenly spread over the speech, so the self-attention picture has rows where there is something to hear */
  probeFrames(contentFrames: number) {
    const tokens = Math.max(1, Math.min(1500, Math.floor(contentFrames / 2)));
    return Array.from({ length: PROBES }, (_, i) => Math.min(1499, Math.round(((i + 0.5) / PROBES) * tokens)));
  }

  dispose() {
    this.stopLive();
    this.stopListening();
    this.model?.dispose();
  }
}
