/** RIFF/WAVE in and out: PCM 8/16/24/32-bit and IEEE float, mixed down to one channel. No imports. */

export type Pcm = { rate: number; channels: number; bits: number; data: Float32Array };

export function parseWav(buf: ArrayBuffer): Pcm {
  const v = new DataView(buf);
  const tag = (o: number) => String.fromCharCode(v.getUint8(o), v.getUint8(o + 1), v.getUint8(o + 2), v.getUint8(o + 3));
  if (tag(0) !== "RIFF" || tag(8) !== "WAVE") throw new Error("not a WAV file");
  let fmt: { format: number; channels: number; rate: number; bits: number } | null = null;
  let o = 12;
  while (o + 8 <= v.byteLength) {
    const id = tag(o);
    const size = v.getUint32(o + 4, true);
    const body = o + 8;
    if (id === "fmt ") {
      let format = v.getUint16(body, true);
      // WAVE_FORMAT_EXTENSIBLE carries the real format in its sub-format GUID
      if (format === 0xfffe && size >= 26) format = v.getUint16(body + 24, true);
      fmt = { format, channels: v.getUint16(body + 2, true), rate: v.getUint32(body + 4, true), bits: v.getUint16(body + 14, true) };
    } else if (id === "data") {
      if (!fmt) throw new Error("WAV data before its format");
      const { format, channels, rate, bits } = fmt;
      const bytes = bits / 8;
      const n = Math.floor(Math.min(size, v.byteLength - body) / (bytes * channels));
      const data = new Float32Array(n);
      const read = (p: number) => {
        if (format === 3) return bits === 64 ? v.getFloat64(p, true) : v.getFloat32(p, true);
        if (bits === 8) return (v.getUint8(p) - 128) / 128;
        if (bits === 16) return v.getInt16(p, true) / 32768;
        if (bits === 24) return ((v.getUint8(p) | (v.getUint8(p + 1) << 8) | (v.getInt8(p + 2) << 16)) as number) / 8388608;
        return v.getInt32(p, true) / 2147483648;
      };
      if (format !== 1 && format !== 3) throw new Error(`unsupported WAV encoding ${format}`);
      for (let i = 0; i < n; i++) {
        let s = 0;
        for (let c = 0; c < channels; c++) s += read(body + (i * channels + c) * bytes);
        data[i] = s / channels;
      }
      return { rate, channels, bits, data };
    }
    o = body + size + (size & 1);
  }
  throw new Error("WAV file has no data chunk");
}

/** 16-bit mono WAV, for saving a recording */
export function encodeWav(x: Float32Array, rate: number) {
  const buf = new ArrayBuffer(44 + x.length * 2);
  const v = new DataView(buf);
  const put = (o: number, s: string) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  put(0, "RIFF");
  v.setUint32(4, 36 + x.length * 2, true);
  put(8, "WAVE");
  put(12, "fmt ");
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, 1, true);
  v.setUint32(24, rate, true);
  v.setUint32(28, rate * 2, true);
  v.setUint16(32, 2, true);
  v.setUint16(34, 16, true);
  put(36, "data");
  v.setUint32(40, x.length * 2, true);
  for (let i = 0; i < x.length; i++) v.setInt16(44 + i * 2, Math.max(-32768, Math.min(32767, Math.round(x[i] * 32768))), true);
  return buf;
}
