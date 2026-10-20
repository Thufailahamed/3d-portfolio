/**
 * The microphone, raw: no echo cancellation, noise suppression or automatic gain, so the detector sees the room
 * as it is. An AudioWorklet copies the input to the main thread in blocks of 1024 samples at the device's rate.
 */

const WORKLET = `
class Tap extends AudioWorkletProcessor {
  constructor() {
    super();
    this.buf = new Float32Array(1024);
    this.n = 0;
  }
  process(inputs) {
    const ch = inputs[0];
    if (!ch || !ch.length) return true;
    const len = ch[0].length;
    for (let i = 0; i < len; i++) {
      let s = 0;
      for (let c = 0; c < ch.length; c++) s += ch[c][i];
      this.buf[this.n++] = s / ch.length;
      if (this.n === this.buf.length) {
        this.port.postMessage(this.buf.slice(0));
        this.n = 0;
      }
    }
    return true;
  }
}
registerProcessor("voice-tap", Tap);
`;

export class Mic {
  readonly rate: number;
  readonly label: string;
  private ctx: AudioContext;
  private stream: MediaStream;
  private node: AudioWorkletNode;

  private constructor(ctx: AudioContext, stream: MediaStream, node: AudioWorkletNode) {
    this.ctx = ctx;
    this.stream = stream;
    this.node = node;
    this.rate = ctx.sampleRate;
    this.label = stream.getAudioTracks()[0]?.label ?? "microphone";
  }

  static async open(onChunk: (x: Float32Array) => void) {
    if (!navigator.mediaDevices?.getUserMedia) throw new Error("This browser has no microphone access here (it needs HTTPS).");
    const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: 1 } });
    const ctx = new AudioContext();
    const url = URL.createObjectURL(new Blob([WORKLET], { type: "text/javascript" }));
    try {
      await ctx.audioWorklet.addModule(url);
    } finally {
      URL.revokeObjectURL(url);
    }
    const src = ctx.createMediaStreamSource(stream);
    const node = new AudioWorkletNode(ctx, "voice-tap");
    node.port.onmessage = (e) => onChunk(e.data as Float32Array);
    // a silent path to the output keeps the graph pulling samples
    const mute = ctx.createGain();
    mute.gain.value = 0;
    src.connect(node).connect(mute).connect(ctx.destination);
    if (ctx.state === "suspended") await ctx.resume();
    return new Mic(ctx, stream, node);
  }

  close() {
    this.node.port.onmessage = null;
    this.node.disconnect();
    for (const t of this.stream.getTracks()) t.stop();
    void this.ctx.close();
  }
}

/** decode any audio file the browser can (mp3, m4a, ogg, wav…) to mono at its own rate */
export async function decodeFile(buf: ArrayBuffer) {
  const ctx = new OfflineAudioContext(1, 1, 48000);
  const audio = await ctx.decodeAudioData(buf);
  const data = new Float32Array(audio.length);
  for (let c = 0; c < audio.numberOfChannels; c++) {
    const ch = audio.getChannelData(c);
    for (let i = 0; i < ch.length; i++) data[i] += ch[i] / audio.numberOfChannels;
  }
  return { rate: audio.sampleRate, data };
}

/** play a 16 kHz clip; resolves with a handle whose `time` reads the playback position */
export function play(x: Float32Array, rate: number, from = 0) {
  const ctx = new AudioContext();
  const buf = ctx.createBuffer(1, x.length, rate);
  buf.copyToChannel(x as Float32Array<ArrayBuffer>, 0);
  const src = ctx.createBufferSource();
  src.buffer = buf;
  src.connect(ctx.destination);
  const t0 = ctx.currentTime;
  src.start(0, from);
  let ended = false;
  src.onended = () => {
    ended = true;
    void ctx.close();
  };
  return {
    get time() {
      return ended ? -1 : from + ctx.currentTime - t0;
    },
    stop() {
      if (ended) return;
      src.stop();
    },
  };
}
