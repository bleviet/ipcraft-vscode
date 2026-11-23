/** Runs the shared ipcraft-spec conformance vectors (examples/packet_formats) against the TS resolver and decoder. */
import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'yaml';
import {
  decode,
  packetToPlain,
  PacketFormatError,
  resolve,
  type BeatInput,
  type ResolvedPacketDocument,
} from '../../../../shared/packetFormat';

const SPEC = path.resolve(__dirname, '../../../../../ipcraft-spec/examples/packet_formats');
const read = (p: string): string | undefined =>
  fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : undefined;
/** Vectors hold words wider than 53 bits: parse integers as BigInt. */
interface Vectors {
  input: string;
  resolved: string;
  cases?: Array<{
    name: string;
    format: string;
    beats: BeatInput[];
    truncated?: boolean;
    trailing?: number;
    decoded: unknown;
  }>;
  map?: Array<{ key: number; name: string | null; format: string }>;
  errors?: Array<{ input: string; error: string }>;
}
const loadVectors = (file: string): Vectors =>
  yaml.parse(fs.readFileSync(file, 'utf8'), { intAsBigInt: true }) as Vectors;

/** Safe integers become numbers, so that expected values compare with the decoder's plain output. */
function norm(v: unknown): unknown {
  if (typeof v === 'bigint') {
    return v <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(v) : v;
  }
  if (Array.isArray(v)) {
    return v.map(norm);
  }
  if (v && typeof v === 'object') {
    return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, norm(x)]));
  }
  return v;
}

/** `expected` lists only the paths to check; a leaf compares as raw int or as {raw, value, text}. */
function matches(actual: unknown, expected: unknown, where = ''): void {
  if (Array.isArray(expected)) {
    expect(Array.isArray(actual) ? actual.length : -1).toBe(expected.length);
    expected.forEach((e, i) => matches((actual as unknown[])[i], e, `${where}[${i}]`));
  } else if (expected && typeof expected === 'object') {
    const a = (actual && typeof actual === 'object' ? actual : { raw: actual }) as Record<
      string,
      unknown
    >;
    for (const [k, e] of Object.entries(expected)) {
      expect({ where, key: k, has: k in a }).toEqual({ where, key: k, has: true });
      matches(a[k], e, `${where}.${k}`);
    }
  } else {
    const a =
      actual && typeof actual === 'object' && !Array.isArray(actual)
        ? (actual as { raw: unknown }).raw
        : actual;
    expect({ where, value: a }).toEqual({ where, value: expected });
  }
}

const vectorFiles = fs.existsSync(SPEC)
  ? fs
      .readdirSync(SPEC)
      .filter((f) => f.endsWith('.vectors.yml'))
      .sort()
  : [];

describe('packet format conformance vectors', () => {
  it('finds the vectors', () => {
    expect(vectorFiles.length).toBeGreaterThanOrEqual(3);
  });

  describe.each(vectorFiles)('%s', (file) => {
    const doc = loadVectors(path.join(SPEC, file));
    const resolved = JSON.parse(
      fs.readFileSync(path.join(SPEC, doc.resolved), 'utf8')
    ) as ResolvedPacketDocument;

    it('resolves to the expected JSON', () => {
      expect(resolve(path.join(SPEC, doc.input), read)).toEqual(resolved);
    });

    for (const c of doc.cases ?? []) {
      it(`decodes: ${c.name}`, () => {
        const pkt = decode(resolved.formats[c.format], c.beats);
        expect(pkt.truncated).toBe(c.truncated ?? false);
        expect(pkt.trailing.length).toBe(Number(c.trailing ?? 0));
        matches(packetToPlain(pkt), norm(c.decoded));
      });
    }

    for (const entry of doc.map ?? []) {
      it(`maps selector ${entry.key}`, () => {
        const src = resolved.map?.sources[String(entry.key)];
        expect(src?.name ?? null).toBe(entry.name);
        expect(src?.format ?? resolved.map?.base).toBe(entry.format);
      });
    }
  });

  describe('invalid files', () => {
    const doc = loadVectors(path.join(SPEC, 'invalid', 'invalid.vectors.yml'));
    it.each(doc.errors ?? [])('$input -> $error', ({ input, error }) => {
      let caught: unknown;
      try {
        resolve(path.join(SPEC, 'invalid', input), read);
      } catch (e) {
        caught = e;
      }
      expect(caught).toBeInstanceOf(PacketFormatError);
      expect((caught as PacketFormatError).code).toBe(error);
    });
  });
});
