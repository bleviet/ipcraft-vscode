import {
  DATA,
  UNTIL_LAST,
  type ResolvedEnum,
  type ResolvedField,
  type ResolvedFormat,
  type ResolvedSection,
} from './types';

/** One beat as given by a caller: the data word, or a map from signal name (`TDATA`/`data`/`TUSER`...) to its word. */
export type BeatInput = number | bigint | Record<string, number | bigint>;
type Beat = Record<string, bigint>;

const ZERO = BigInt(0);
const ONE = BigInt(1);

export interface DecodedField {
  defn: ResolvedField;
  signal: string;
  /** The raw bits; for an `array` field the whole span. */
  raw: bigint;
  /** Engineering value: sign, `bool`, `bytes`, `scale`/`offsetValue` applied; a list for arrays. */
  value: number | bigint | boolean | Uint8Array | unknown[];
  /** Enum name (flags: `A|B` plus leftover hex) when an enum matches. */
  text?: string;
  fields: Record<string, DecodedField>;
  elements: DecodedField[];
}

export interface DecodedPacket {
  format: ResolvedFormat;
  /** Section name -> one entry per beat. */
  sections: Record<string, Array<Record<string, DecodedField>>>;
  truncated: boolean;
  trailing: Beat[];
}

const mask = (width: number): bigint => (ONE << BigInt(width)) - ONE;

function signalKey(sig: string): string {
  return ['data', 'tdata'].includes(sig.toLowerCase()) ? DATA : sig;
}

function toBeat(b: BeatInput): Beat {
  if (typeof b === 'number' || typeof b === 'bigint') {
    return { [DATA]: BigInt(b) };
  }
  const out: Beat = {};
  for (const [k, v] of Object.entries(b)) {
    out[signalKey(k)] = BigInt(v);
  }
  return out;
}

function findSignal(beat: Beat, sig: string): bigint {
  if (sig in beat) {
    return beat[sig];
  }
  const low = sig.toLowerCase();
  const hit = Object.entries(beat).find(([k]) => k.toLowerCase() === low);
  return hit ? hit[1] : ZERO;
}

export function enumText(en: ResolvedEnum, raw: bigint): string | undefined {
  const values = en.values;
  if (!en.flags) {
    return values[raw.toString()]?.name;
  }
  if (raw === ZERO) {
    return values['0']?.name;
  }
  const names: string[] = [];
  let rest = raw;
  const keys = Object.keys(values).sort((a, b) =>
    BigInt(a) < BigInt(b) ? -1 : BigInt(a) > BigInt(b) ? 1 : 0
  );
  for (const k of keys) {
    const bit = BigInt(k);
    if (bit !== ZERO && (raw & bit) === bit) {
      names.push(values[k].name);
      rest &= ~bit;
    }
  }
  if (rest !== ZERO) {
    names.push(`0x${rest.toString(16)}`);
  }
  return names.join('|');
}

function bytesOf(raw: bigint, width: number): Uint8Array {
  const out = new Uint8Array(Math.ceil(width / 8));
  let v = raw;
  for (let i = 0; i < out.length; i++) {
    out[i] = Number(v & BigInt(255));
    v >>= BigInt(8);
  }
  return out;
}

function decodeField(
  defn: ResolvedField,
  signal: string,
  word: bigint,
  element = false
): DecodedField {
  const out: DecodedField = { defn, signal, raw: ZERO, value: ZERO, fields: {}, elements: [] };
  const arr = defn.array;
  if (arr && !element) {
    // element i is decoded as element 0 of the word shifted down by i strides, so sub-fields need no relocation
    out.elements = Array.from({ length: arr.count }, (_, i) =>
      decodeField(defn, signal, word >> BigInt(i * arr.stride), true)
    );
    out.raw = (word >> BigInt(defn.lsb)) & mask(defn.width + (arr.count - 1) * arr.stride);
    out.value = out.elements.map((e) => e.value);
    return out;
  }
  const width = defn.width;
  const raw = (word >> BigInt(defn.lsb)) & mask(width);
  out.raw = raw;
  let value: DecodedField['value'] = raw;
  if (defn.type === 'int' && raw >> BigInt(width - 1) !== ZERO) {
    value = raw - (ONE << BigInt(width));
  } else if (defn.type === 'bool') {
    value = raw !== ZERO;
  } else if (defn.type === 'bytes') {
    value = bytesOf(raw, width);
  }
  if (defn.scale !== undefined || defn.offsetValue !== undefined) {
    value = Number(value) * (defn.scale ?? 1) + (defn.offsetValue ?? 0);
  }
  out.value = value;
  if (defn.enum) {
    out.text = enumText(defn.enum, raw);
  }
  for (const sub of defn.fields ?? []) {
    out.fields[sub.name] = decodeField(sub, signal, word, element);
  }
  return out;
}

function topNames(sec: ResolvedSection): string[] {
  return Object.values(sec.signals).flatMap((fl) => fl.map((f) => f.name));
}

function beatCount(sec: ResolvedSection, pkt: DecodedPacket, remaining: number): number {
  const c = sec.count;
  if (c === UNTIL_LAST) {
    return remaining;
  }
  if (typeof c === 'object') {
    const f = findDecoded(pkt, c.field);
    if (!f) {
      return 0;
    }
    return Math.max(0, Math.ceil((Number(f.raw) + c.add) / c.perBeat));
  }
  return c;
}

/** The decoded field at `path` (names joined by `.`, array elements by index) of a count-1 section, or the first beat's. */
export function findDecoded(pkt: DecodedPacket, path: string): DecodedField | undefined {
  const [head, ...rest] = path.split('.');
  for (const sec of pkt.format.beats) {
    if (!topNames(sec).includes(head)) {
      continue;
    }
    let f: DecodedField | undefined = (pkt.sections[sec.name] ?? [])[0]?.[head];
    for (const part of rest) {
      f = f && (/^\d+$/.test(part) ? f.elements[Number(part)] : f.fields[part]);
    }
    return f;
  }
  return undefined;
}

/**
 * Decode one frame. Never throws on a damaged frame: too few beats set `truncated` (the sections decoded so far
 * are kept), beats after the last section are `trailing`. Words may be numbers or bigints (any width).
 */
export function decode(format: ResolvedFormat, frame: readonly BeatInput[]): DecodedPacket {
  const beats = frame.map(toBeat);
  const pkt: DecodedPacket = { format, sections: {}, truncated: false, trailing: [] };
  let pos = 0;
  for (const sec of format.beats) {
    const want = beatCount(sec, pkt, beats.length - pos);
    const got = beats.slice(pos, pos + want);
    if (got.length < want) {
      pkt.truncated = true;
    }
    pkt.sections[sec.name] = got.map((b) => {
      const entry: Record<string, DecodedField> = {};
      for (const [sig, fl] of Object.entries(sec.signals)) {
        for (const f of fl) {
          entry[f.name] = decodeField(f, sig, findSignal(b, sig));
        }
      }
      return entry;
    });
    pos += got.length;
    if (pkt.truncated) {
      break;
    }
  }
  pkt.trailing = beats.slice(pos);
  return pkt;
}

function plainNumber(v: bigint): number | bigint {
  return v <= BigInt(Number.MAX_SAFE_INTEGER) && v >= -BigInt(Number.MAX_SAFE_INTEGER)
    ? Number(v)
    : v;
}

/** Plain data: a number for a leaf, `{ raw, value?, text?, <sub>: ... }` with detail, a list for arrays. */
export function toPlain(f: DecodedField): unknown {
  if (f.elements.length > 0) {
    return f.elements.map(toPlain);
  }
  const subs = Object.entries(f.fields);
  if (subs.length > 0) {
    return {
      raw: plainNumber(f.raw),
      ...Object.fromEntries(subs.map(([k, v]) => [k, toPlain(v)])),
    };
  }
  const d = f.defn;
  if (
    !d.enum &&
    d.scale === undefined &&
    d.offsetValue === undefined &&
    !['int', 'bool', 'bytes', 'enum'].includes(d.type)
  ) {
    return plainNumber(f.raw);
  }
  const value = typeof f.value === 'bigint' ? plainNumber(f.value) : f.value;
  return { raw: plainNumber(f.raw), value, ...(f.text !== undefined ? { text: f.text } : {}) };
}

/** The whole frame as plain data, one entry per top-level field (a list over the beats unless the section has count 1). */
export function packetToPlain(pkt: DecodedPacket): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const sec of pkt.format.beats) {
    const beats = pkt.sections[sec.name];
    if (!beats) {
      continue;
    }
    const single = sec.count === 1 && beats.length === 1;
    for (const name of topNames(sec)) {
      const vals = beats.map((b) => toPlain(b[name]));
      out[name] = single ? vals[0] : vals;
    }
  }
  return out;
}
