/**
 * Reads a PyTorch `.pth` state dict (zip + pickle) without PyTorch.
 * Only the opcodes torch.save emits for a flat dict of float tensors are implemented.
 */
import { readFileSync } from "node:fs";
import { inflateRawSync } from "node:zlib";

export function unzip(buf) {
  let eocd = buf.length - 22;
  while (eocd >= 0 && buf.readUInt32LE(eocd) !== 0x06054b50) eocd--;
  if (eocd < 0) throw new Error("not a zip");
  const n = buf.readUInt16LE(eocd + 10);
  let cd = buf.readUInt32LE(eocd + 16);
  const files = new Map();
  for (let i = 0; i < n; i++) {
    const method = buf.readUInt16LE(cd + 10);
    const size = buf.readUInt32LE(cd + 20);
    const nameLen = buf.readUInt16LE(cd + 28);
    const extraLen = buf.readUInt16LE(cd + 30);
    const commentLen = buf.readUInt16LE(cd + 32);
    const off = buf.readUInt32LE(cd + 42);
    const name = buf.toString("utf8", cd + 46, cd + 46 + nameLen);
    const start = off + 30 + buf.readUInt16LE(off + 26) + buf.readUInt16LE(off + 28);
    const raw = buf.subarray(start, start + size);
    files.set(name, method === 0 ? raw : inflateRawSync(raw));
    cd += 46 + nameLen + extraLen + commentLen;
  }
  return files;
}

const STORAGES = new Set(["FloatStorage", "HalfStorage"]);

function unpickle(data) {
  const stack = [];
  const marks = [];
  const memo = new Map();
  let i = 0;
  const popMark = () => stack.splice(marks.pop());
  const line = () => {
    const j = data.indexOf(10, i);
    const s = data.toString("latin1", i, j);
    i = j + 1;
    return s;
  };
  const global = (mod, name) => {
    const full = `${mod}.${name}`;
    if (full === "collections.OrderedDict") return { kind: "dict" };
    if (full === "torch._utils._rebuild_tensor_v2") return { kind: "tensor" };
    if (mod === "torch" && STORAGES.has(name)) return { kind: "storage", dtype: name };
    return { kind: "other", full };
  };
  const str = (n, enc) => {
    const s = data.toString(enc, i, i + n);
    i += n;
    return s;
  };
  for (;;) {
    const op = data[i++];
    switch (op) {
      case 0x80: i++; break; // PROTO
      case 0x95: i += 8; break; // FRAME
      case 0x63: { const mod = line(); stack.push(global(mod, line())); break; } // GLOBAL
      case 0x93: { const name = stack.pop(); stack.push(global(stack.pop(), name)); break; } // STACK_GLOBAL
      case 0x71: memo.set(data[i++], stack.at(-1)); break; // BINPUT
      case 0x72: memo.set(data.readUInt32LE(i), stack.at(-1)); i += 4; break; // LONG_BINPUT
      case 0x94: memo.set(memo.size, stack.at(-1)); break; // MEMOIZE
      case 0x68: stack.push(memo.get(data[i++])); break; // BINGET
      case 0x6a: stack.push(memo.get(data.readUInt32LE(i))); i += 4; break; // LONG_BINGET
      case 0x29: stack.push([]); break; // EMPTY_TUPLE
      case 0x5d: stack.push([]); break; // EMPTY_LIST
      case 0x7d: stack.push(new Map()); break; // EMPTY_DICT
      case 0x28: marks.push(stack.length); break; // MARK
      case 0x58: { const n = data.readUInt32LE(i); i += 4; stack.push(str(n, "utf8")); break; } // BINUNICODE
      case 0x8c: { const n = data[i++]; stack.push(str(n, "utf8")); break; } // SHORT_BINUNICODE
      case 0x55: { const n = data[i++]; stack.push(str(n, "latin1")); break; } // SHORT_BINSTRING
      case 0x54: { const n = data.readUInt32LE(i); i += 4; stack.push(str(n, "latin1")); break; } // BINSTRING
      case 0x4b: stack.push(data[i++]); break; // BININT1
      case 0x4d: stack.push(data.readUInt16LE(i)); i += 2; break; // BININT2
      case 0x4a: stack.push(data.readInt32LE(i)); i += 4; break; // BININT
      case 0x8a: { // LONG1
        const n = data[i++];
        let v = 0n;
        for (let k = n - 1; k >= 0; k--) v = (v << 8n) | BigInt(data[i + k]);
        if (n && data[i + n - 1] & 0x80) v -= 1n << BigInt(8 * n);
        i += n;
        stack.push(Number(v));
        break;
      }
      case 0x47: stack.push(data.readDoubleBE(i)); i += 8; break; // BINFLOAT
      case 0x88: stack.push(true); break; // NEWTRUE
      case 0x89: stack.push(false); break; // NEWFALSE
      case 0x4e: stack.push(null); break; // NONE
      case 0x74: stack.push(popMark()); break; // TUPLE
      case 0x85: stack.push([stack.pop()]); break; // TUPLE1
      case 0x86: { const b = stack.pop(); stack.push([stack.pop(), b]); break; } // TUPLE2
      case 0x87: { const c = stack.pop(); const b = stack.pop(); stack.push([stack.pop(), b, c]); break; } // TUPLE3
      case 0x61: { const v = stack.pop(); stack.at(-1).push(v); break; } // APPEND
      case 0x65: { const items = popMark(); stack.at(-1).push(...items); break; } // APPENDS
      case 0x51: { // BINPERSID: ('storage', StorageType, key, location, numel)
        const [, type, key] = stack.pop();
        stack.push({ dtype: type.dtype, key });
        break;
      }
      case 0x52: { // REDUCE
        const args = stack.pop();
        const fn = stack.pop();
        if (fn.kind === "dict") stack.push(new Map());
        else if (fn.kind === "tensor") {
          const [storage, offset, shape, stride] = args;
          stack.push({ tensor: true, storage, offset, shape, stride });
        } else stack.push({ reduced: fn.full, args });
        break;
      }
      case 0x73: { const v = stack.pop(); const k = stack.pop(); stack.at(-1).set(k, v); break; } // SETITEM
      case 0x75: { // SETITEMS
        const items = popMark();
        const d = stack.at(-1);
        for (let k = 0; k < items.length; k += 2) d.set(items[k], items[k + 1]);
        break;
      }
      case 0x62: stack.pop(); break; // BUILD: state such as _metadata is ignored
      case 0x2e: return stack.pop(); // STOP
      default:
        throw new Error(`pickle opcode 0x${op.toString(16)} at ${i - 1}`);
    }
  }
}

function halfToFloat(h) {
  const s = h & 0x8000 ? -1 : 1;
  const e = (h >> 10) & 0x1f;
  const f = h & 0x3ff;
  if (e === 0) return s * 2 ** -14 * (f / 1024);
  if (e === 31) return f ? NaN : s * Infinity;
  return s * 2 ** (e - 15) * (1 + f / 1024);
}

/**
 * name → { shape, data: Float32Array }, contiguous and row-major.
 * `pick` chooses the state dict inside a checkpoint that wraps it (e.g. Whisper's { dims, model_state_dict }).
 */
export function loadStateDict(path, pick = (root) => root) {
  const files = unzip(readFileSync(path));
  const pkl = [...files.keys()].find((k) => k.endsWith("data.pkl"));
  const root = pkl.slice(0, -"data.pkl".length);
  const out = new Map();
  for (const [name, t] of pick(unpickle(files.get(pkl)))) {
    if (!t?.tensor) continue;
    const raw = files.get(`${root}data/${t.storage.key}`);
    const numel = t.shape.reduce((a, b) => a * b, 1);
    const data = new Float32Array(numel);
    const half = t.storage.dtype === "HalfStorage";
    // a strided gather, so non-contiguous tensors come out row-major too
    const idx = new Array(t.shape.length).fill(0);
    for (let n = 0; n < numel; n++) {
      let o = t.offset;
      for (let d = 0; d < idx.length; d++) o += idx[d] * t.stride[d];
      data[n] = half ? halfToFloat(raw.readUInt16LE(o * 2)) : raw.readFloatLE(o * 4);
      for (let d = idx.length - 1; d >= 0; d--) {
        if (++idx[d] < t.shape[d]) break;
        idx[d] = 0;
      }
    }
    out.set(name, { shape: t.shape, data });
  }
  return out;
}
