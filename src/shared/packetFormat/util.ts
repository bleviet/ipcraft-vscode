import * as yaml from 'yaml';
import { PacketFormatError, PKT_VERSION, type ResolvedField } from './types';

export type Raw = Record<string, unknown>;

export const NAME_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;

export function isInt(v: unknown): v is number {
  return typeof v === 'number' && Number.isInteger(v);
}

export function isRaw(v: unknown): v is Raw {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

export function clone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T;
}

/** YAML 1.2 core schema (the `yaml` default): `ON`, `OFF`, `YES`, `NO` stay strings. */
export function parseYaml(text: string, file: string): unknown {
  try {
    return yaml.parse(text, { version: '1.2', schema: 'core' });
  } catch (e) {
    throw new PacketFormatError('SCHEMA', `invalid YAML: ${(e as Error).message}`, file);
  }
}

/** Enum / source keys: YAML ints or strings such as "0x0A". Returns the canonical decimal string. */
export function intKey(k: string): string | null {
  const s = k.replace(/_/g, '');
  if (!/^(0[xX][0-9a-fA-F]+|0[oO][0-7]+|0[bB][01]+|0|[1-9][0-9]*)$/.test(s)) {
    return null;
  }
  return BigInt(s.toLowerCase()).toString();
}

export function checkKeys(
  obj: unknown,
  allowed: ReadonlySet<string>,
  file: string,
  path: string,
  what: string
): Raw {
  if (!isRaw(obj)) {
    throw new PacketFormatError('SCHEMA', `${what} must be a mapping`, file, path);
  }
  const unknown = Object.keys(obj).filter((k) => !(allowed.has(k) || k.startsWith('x-')));
  if (unknown.length > 0) {
    throw new PacketFormatError(
      'SCHEMA',
      `unknown key(s) in ${what}: ${unknown.join(', ')}`,
      file,
      path
    );
  }
  return obj;
}

export function checkName(v: unknown, file: string, path: string): string {
  if (typeof v !== 'string' || !NAME_RE.test(v)) {
    throw new PacketFormatError('SCHEMA', `invalid name ${JSON.stringify(v)}`, file, path);
  }
  return v;
}

export function checkVersion(doc: Raw, file: string): void {
  const v = doc.pktVersion;
  if (!isInt(v) || v < 1) {
    throw new PacketFormatError('PKT_VERSION', 'pktVersion must be a positive integer', file);
  }
  if (v > PKT_VERSION) {
    throw new PacketFormatError(
      'PKT_VERSION',
      `pktVersion ${v} is newer than the supported ${PKT_VERSION}`,
      file
    );
  }
}

export function str(raw: Raw, key: string, file: string, path: string, dflt = ''): string {
  const v = key in raw ? raw[key] : dflt;
  if (typeof v !== 'string') {
    throw new PacketFormatError('SCHEMA', `${key} must be a string`, file, path);
  }
  return v;
}

export function extensions(raw: Raw): Raw {
  const out: Raw = {};
  for (const [k, v] of Object.entries(raw)) {
    if (k.startsWith('x-')) {
      out[k] = clone(v);
    }
  }
  return out;
}

/** Every resolved field of a list, depth first (sub-fields after their parent). */
export function* iterFields(fields: readonly ResolvedField[]): Generator<ResolvedField> {
  for (const f of fields) {
    yield f;
    yield* iterFields(f.fields ?? []);
  }
}
