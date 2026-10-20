/**
 * Whisper's English tokenizer: GPT-2's byte-level BPE (50 256 merges-ranked byte strings) followed by Whisper's
 * special tokens, numbered after them exactly as whisper/tokenizer.py's get_encoding() assigns them.
 *
 * Pieces are stored in GPT-2's printable byte alphabet ("Ġ" is the space byte), one per line of vocab.txt.
 * No imports.
 */

export const LANG_COUNT = 99;

export type Specials = {
  eot: number;
  sot: number;
  translate: number;
  transcribe: number;
  sotLm: number;
  sotPrev: number;
  noSpeech: number;
  noTimestamps: number;
  timestampBegin: number;
};

/** ids of the special tokens for a vocabulary of `n` byte-level pieces (50 256 for GPT-2) */
export function specials(n: number): Specials {
  const sot = n + 1;
  const after = sot + 1 + LANG_COUNT;
  return { eot: n, sot, translate: after, transcribe: after + 1, sotLm: after + 2, sotPrev: after + 3, noSpeech: after + 4, noTimestamps: after + 5, timestampBegin: after + 6 };
}

/** GPT-2's bytes_to_unicode(): every byte gets a printable character, so pieces are plain strings */
function byteAlphabet() {
  const bs: number[] = [];
  for (let b = 33; b <= 126; b++) bs.push(b);
  for (let b = 161; b <= 172; b++) bs.push(b);
  for (let b = 174; b <= 255; b++) bs.push(b);
  const cs = [...bs];
  let extra = 0;
  for (let b = 0; b < 256; b++) {
    if (!bs.includes(b)) {
      bs.push(b);
      cs.push(256 + extra++);
    }
  }
  const toByte = new Map<string, number>();
  const toChar: string[] = new Array(256);
  bs.forEach((b, i) => {
    toByte.set(String.fromCharCode(cs[i]), b);
    toChar[b] = String.fromCharCode(cs[i]);
  });
  return { toByte, toChar };
}

/** Python's string.punctuation; split_tokens_on_spaces tests `subword.strip() in` it, i.e. as a substring */
const PUNCTUATION = "!\"#$%&'()*+,-./:;<=>?@[\\]^_`{|}~";

export class Tokenizer {
  readonly pieces: string[];
  readonly sp: Specials;
  readonly size: number;
  private bytes: Uint8Array[];
  private utf8 = new TextDecoder("utf-8");
  private specialNames = new Map<number, string>();

  constructor(pieces: string[]) {
    this.pieces = pieces;
    this.sp = specials(pieces.length);
    this.size = this.sp.timestampBegin + 1501;
    const { toByte } = byteAlphabet();
    this.bytes = pieces.map((p) => Uint8Array.from([...p], (c) => toByte.get(c) ?? 63));
    const s = this.sp;
    for (const [id, name] of [
      [s.eot, "<|endoftext|>"],
      [s.sot, "<|startoftranscript|>"],
      [s.translate, "<|translate|>"],
      [s.transcribe, "<|transcribe|>"],
      [s.sotLm, "<|startoflm|>"],
      [s.sotPrev, "<|startofprev|>"],
      [s.noSpeech, "<|nospeech|>"],
      [s.noTimestamps, "<|notimestamps|>"],
    ] as const)
      this.specialNames.set(id, name);
  }

  isTimestamp(id: number) {
    return id >= this.sp.timestampBegin;
  }

  /** a timestamp token's time, 0.02 s per step */
  seconds(id: number) {
    return (id - this.sp.timestampBegin) * 0.02;
  }

  isText(id: number) {
    return id < this.sp.eot;
  }

  /** the token as a label: the byte-level piece, a special's name, or a timestamp */
  label(id: number) {
    if (id < this.pieces.length) return this.pieces[id];
    if (this.isTimestamp(id)) return `<|${this.seconds(id).toFixed(2)}|>`;
    return this.specialNames.get(id) ?? `<|lang ${id - this.sp.sot - 1}|>`;
  }

  /** tiktoken's decode with timestamps annotated (tokenizer.decode_with_timestamps) */
  decodeWithTimestamps(ids: number[]) {
    let out = "";
    let run: number[] = [];
    const flush = () => {
      if (!run.length) return;
      const total = run.reduce((a, id) => a + this.bytes[id].length, 0);
      const b = new Uint8Array(total);
      let o = 0;
      for (const id of run) {
        b.set(this.bytes[id], o);
        o += this.bytes[id].length;
      }
      out += this.utf8.decode(b);
      run = [];
    };
    for (const id of ids) {
      if (id < this.pieces.length) run.push(id);
      else {
        flush();
        out += this.label(id);
      }
    }
    flush();
    return out;
  }

  /** tokenizer.decode(): drops timestamps */
  decode(ids: number[]) {
    return this.decodeWithTimestamps(ids.filter((id) => id < this.sp.timestampBegin));
  }

  /** split_tokens_on_unicode: group tokens until they decode to whole characters */
  splitOnUnicode(tokens: number[]) {
    const full = this.decodeWithTimestamps(tokens);
    const words: string[] = [];
    const groups: number[][] = [];
    let current: number[] = [];
    let offset = 0;
    for (const t of tokens) {
      current.push(t);
      const d = this.decodeWithTimestamps(current);
      const bad = d.indexOf("�");
      if (bad < 0 || full[offset + bad] === "�") {
        words.push(d);
        groups.push(current);
        current = [];
        offset += d.length;
      }
    }
    return { words, groups };
  }

  /** split_tokens_on_spaces: a new word at a leading space, a special token or punctuation */
  splitToWordTokens(tokens: number[]) {
    const sub = this.splitOnUnicode(tokens);
    const words: string[] = [];
    const groups: number[][] = [];
    sub.words.forEach((w, i) => {
      const g = sub.groups[i];
      const special = g[0] >= this.sp.eot;
      const space = w.startsWith(" ");
      const punct = PUNCTUATION.includes(w.trim());
      if (special || space || punct || words.length === 0) {
        words.push(w);
        groups.push([...g]);
      } else {
        words[words.length - 1] += w;
        groups[groups.length - 1].push(...g);
      }
    });
    return { words, groups };
  }
}

/** the GPT-2 printable alphabet, for the build script */
export const GPT2_BYTES = () => byteAlphabet().toChar;
