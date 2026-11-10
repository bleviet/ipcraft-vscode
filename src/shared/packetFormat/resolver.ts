import { buildEnum, type FieldContext } from './fields';
import { buildFormat } from './formats';
import { dirname, isMapFile, joinPath, normalizePath } from './paths';
import {
  PacketFormatError,
  RESOLVED_VERSION,
  type PacketFileReader,
  type ResolvedEnum,
  type ResolvedFormat,
  type ResolvedMap,
  type ResolvedPacketDocument,
  type ResolvedSource,
} from './types';
import {
  checkKeys,
  checkName,
  checkVersion,
  extensions,
  intKey,
  isRaw,
  parseYaml,
  str,
  type Raw,
} from './util';

const DOC_KEYS = new Set(['pktVersion', 'description', 'imports', 'enums', 'packetFormats']);
const MAP_KEYS = new Set([
  'pktVersion',
  'name',
  'description',
  'base',
  'selector',
  'formats',
  'sources',
]);
const SOURCE_KEYS = new Set(['name', 'format', 'description']);

/** Loads files into one name space (formats and enums are global across imports) and resolves formats on demand. */
class Resolver implements FieldContext {
  private readonly formatsRaw = new Map<string, { file: string; raw: unknown }>();
  private readonly enumsRaw = new Map<string, { file: string; raw: unknown }>();
  private readonly resolved = new Map<string, ResolvedFormat>();
  private readonly loaded = new Set<string>();
  private readonly stack: string[] = [];
  readonly order: string[] = [];

  constructor(private readonly read: PacketFileReader) {}

  private readDoc(path: string): Raw {
    const text = this.read(path);
    if (text === undefined) {
      throw new PacketFormatError('UNKNOWN_REF', 'file not found', path);
    }
    const doc = parseYaml(text, path);
    if (!isRaw(doc)) {
      throw new PacketFormatError('SCHEMA', 'a packet format file must be a mapping', path);
    }
    return doc;
  }

  loadFile(file: string): string {
    const path = normalizePath(file);
    if (this.loaded.has(path)) {
      return path;
    }
    this.loaded.add(path);
    const doc = this.readDoc(path);
    checkVersion(doc, path);
    checkKeys(doc, DOC_KEYS, path, '', 'document');
    const imports = doc.imports ?? [];
    if (!Array.isArray(imports)) {
      throw new PacketFormatError('SCHEMA', 'imports must be a list', path);
    }
    for (const imp of imports) {
      if (typeof imp !== 'string') {
        throw new PacketFormatError('SCHEMA', 'an import must be a path', path);
      }
      this.loadFile(joinPath(dirname(path), imp));
    }
    const enums = doc.enums ?? {};
    if (!isRaw(enums)) {
      throw new PacketFormatError('SCHEMA', 'enums must be a mapping', path);
    }
    for (const [name, raw] of Object.entries(enums)) {
      checkName(name, path, `enums.${name}`);
      const prior = this.enumsRaw.get(name);
      if (prior) {
        throw new PacketFormatError(
          'DUPLICATE_NAME',
          `enum ${name} is also defined in ${prior.file}`,
          path
        );
      }
      this.enumsRaw.set(name, { file: path, raw });
    }
    const formats = doc.packetFormats;
    if (!Array.isArray(formats)) {
      throw new PacketFormatError('SCHEMA', 'packetFormats must be a list', path);
    }
    for (const raw of formats) {
      const name = checkName(isRaw(raw) ? raw.name : undefined, path, 'packetFormats');
      const prior = this.formatsRaw.get(name);
      if (prior) {
        throw new PacketFormatError(
          'DUPLICATE_NAME',
          `format ${name} is also defined in ${prior.file}`,
          path
        );
      }
      this.formatsRaw.set(name, { file: path, raw });
      this.order.push(name);
    }
    return path;
  }

  /** `<file>#<format>` relative to `baseDir`: loads the file, resolves and returns the format name. */
  ref(ref: unknown, baseDir: string, file: string, path: string): string {
    if (typeof ref !== 'string' || !ref.includes('#')) {
      throw new PacketFormatError(
        'SCHEMA',
        `format reference ${JSON.stringify(ref)} is not '<file>#<name>'`,
        file,
        path
      );
    }
    const i = ref.lastIndexOf('#');
    const target = ref.slice(0, i);
    const name = ref.slice(i + 1);
    const targetPath = joinPath(baseDir, target);
    if (this.read(targetPath) === undefined) {
      throw new PacketFormatError('UNKNOWN_REF', `${target}: file not found`, file, path);
    }
    this.loadFile(targetPath);
    this.resolveFormat(name, file, path, false);
    return name;
  }

  namedEnum(name: unknown, file: string, path: string): ResolvedEnum {
    const hit = typeof name === 'string' ? this.enumsRaw.get(name) : undefined;
    if (!hit) {
      throw new PacketFormatError(
        'UNKNOWN_REF',
        `unknown enum ${JSON.stringify(name)}`,
        file,
        path
      );
    }
    return buildEnum(hit.raw, name as string, hit.file, `enums.${name as string}`);
  }

  resolveFormat(name: unknown, file?: string, where?: string, composition = false): ResolvedFormat {
    const key = typeof name === 'string' ? name : '';
    const done = this.resolved.get(key);
    if (done) {
      return done;
    }
    const hit = this.formatsRaw.get(key);
    if (!hit) {
      throw new PacketFormatError(
        'UNKNOWN_REF',
        `unknown format ${JSON.stringify(name)}`,
        file,
        where
      );
    }
    if (this.stack.includes(key)) {
      const code = composition ? 'COMPOSITION' : 'EXTENDS_CYCLE';
      throw new PacketFormatError(
        code,
        `format ${key} depends on itself (${[...this.stack, key].join(' -> ')})`,
        file,
        where
      );
    }
    this.stack.push(key);
    let out: ResolvedFormat;
    try {
      out = buildFormat(this, key, hit.raw, hit.file);
    } finally {
      this.stack.pop();
    }
    this.resolved.set(key, out);
    return out;
  }

  resolveAll(): Record<string, ResolvedFormat> {
    for (const name of [...this.order]) {
      this.resolveFormat(name);
    }
    return Object.fromEntries(this.order.map((n) => [n, this.resolved.get(n) as ResolvedFormat]));
  }

  resolveMap(file: string): ResolvedMap {
    const path = normalizePath(file);
    const doc = this.readDoc(path);
    checkVersion(doc, path);
    checkKeys(doc, MAP_KEYS, path, '', 'packet binding');
    for (const key of ['name', 'base', 'selector', 'sources']) {
      if (!(key in doc)) {
        throw new PacketFormatError('SCHEMA', `${key} is required`, path);
      }
    }
    const name = checkName(doc.name, path, 'name');
    const baseDir = dirname(path);
    const base = this.ref(doc.base, baseDir, path, 'base');
    const selector = str(doc, 'selector', path, 'selector');
    const extra = doc.formats ?? [];
    if (!Array.isArray(extra)) {
      throw new PacketFormatError('SCHEMA', 'formats must be a list', path);
    }
    extra.forEach((r, i) => this.ref(r, baseDir, path, `formats[${i}]`));
    if (!isRaw(doc.sources)) {
      throw new PacketFormatError('SCHEMA', 'sources must be a mapping', path);
    }
    const sources: Record<string, ResolvedSource> = {};
    for (const [k, src] of Object.entries(doc.sources)) {
      const key = intKey(k);
      const where = `sources.${k}`;
      if (key === null) {
        throw new PacketFormatError(
          'SCHEMA',
          `source key '${k}' is not a non-negative integer`,
          path,
          where
        );
      }
      checkKeys(src, SOURCE_KEYS, path, where, 'source');
      const s = src as Raw;
      const sname = str(s, 'name', path, where);
      if (!sname) {
        throw new PacketFormatError('SCHEMA', 'a source needs a name', path, where);
      }
      const fmt = 'format' in s ? this.ref(s.format, baseDir, path, where) : base;
      if (fmt !== base && !(this.resolved.get(fmt) as ResolvedFormat).extends.includes(base)) {
        throw new PacketFormatError(
          'MAP_BASE',
          `${fmt} does not derive from the base ${base}`,
          path,
          where
        );
      }
      sources[key] = { name: sname, format: fmt, description: str(s, 'description', path, where) };
    }
    return {
      name,
      description: str(doc, 'description', path, 'description'),
      selector,
      base,
      sources,
      ...extensions(doc),
    };
  }
}

/**
 * Resolve a `*.pkt.yml` or `*.pktmap.yml` (with everything it imports or references) into the resolved JSON form.
 * Every loaded format is resolved, so this also validates them. Throws {@link PacketFormatError}.
 * `read` returns the text of an absolute path, or undefined when the file does not exist.
 */
export function resolve(path: string, read: PacketFileReader): ResolvedPacketDocument {
  const r = new Resolver(read);
  const map = isMapFile(path) ? r.resolveMap(path) : undefined;
  if (!map) {
    r.loadFile(path);
  }
  const formats = r.resolveAll();
  return { resolvedPktVersion: RESOLVED_VERSION, formats, ...(map ? { map } : {}) };
}
