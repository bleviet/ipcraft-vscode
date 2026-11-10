import {
  DATA,
  PacketFormatError,
  type ResolvedEnum,
  type ResolvedEnumValue,
  type ResolvedField,
  type ResolvedFormat,
} from './types';
import {
  checkKeys,
  checkName,
  extensions,
  intKey,
  isInt,
  isRaw,
  iterFields,
  clone,
  str,
  type Raw,
} from './util';

const BITS_RE = /^\[\s*(\d+)\s*(?::\s*(\d+)\s*)?\]$/;
const FIELD_KEYS = new Set([
  'name',
  'bits',
  'offset',
  'width',
  'description',
  'type',
  'enum',
  'enumeratedValues',
  'unit',
  'scale',
  'offsetValue',
  'fields',
  'format',
  'array',
  'constraints',
]);
const ENUM_KEYS = new Set(['description', 'flags', 'values']);

/** What field building needs from the resolver. */
export interface FieldContext {
  namedEnum(name: unknown, file: string, path: string): ResolvedEnum;
  resolveFormat(
    name: unknown,
    file: string | undefined,
    where: string | undefined,
    composition: boolean
  ): ResolvedFormat;
}

function span(f: ResolvedField): number {
  return f.array ? f.width + (f.array.count - 1) * f.array.stride : f.width;
}

function findOverlap(fields: ResolvedField[]): [ResolvedField, ResolvedField] | undefined {
  const sorted = [...fields].sort((a, b) => a.lsb - b.lsb);
  for (let i = 0; i + 1 < sorted.length; i++) {
    if (sorted[i].lsb + span(sorted[i]) > sorted[i + 1].lsb) {
      return [sorted[i], sorted[i + 1]];
    }
  }
  return undefined;
}

export function checkSiblings(
  fields: ResolvedField[],
  overlapCode: 'FIELD_OVERLAP' | 'REFINE',
  file: string,
  where: string
): void {
  const seen = new Set<string>();
  for (const f of fields) {
    if (seen.has(f.name)) {
      throw new PacketFormatError(
        'DUPLICATE_NAME',
        `field ${f.name} is defined twice`,
        file,
        where
      );
    }
    seen.add(f.name);
  }
  const hit = findOverlap(fields);
  if (hit) {
    throw new PacketFormatError(overlapCode, `${hit[0].path} overlaps ${hit[1].path}`, file, where);
  }
}

export function buildEnum(raw: unknown, name: string, file: string, path: string): ResolvedEnum {
  let flags = false;
  let values: unknown = raw;
  let description = '';
  if (isRaw(raw) && 'values' in raw) {
    checkKeys(raw, ENUM_KEYS, file, path, 'enum');
    values = raw.values;
    description = str(raw, 'description', file, path);
    if ('flags' in raw) {
      if (typeof raw.flags !== 'boolean') {
        throw new PacketFormatError('SCHEMA', 'flags must be a boolean', file, path);
      }
      flags = raw.flags;
    }
  }
  if (!isRaw(values)) {
    throw new PacketFormatError('SCHEMA', 'enum values must be a mapping', file, path);
  }
  const out: Record<string, ResolvedEnumValue> = {};
  for (const [k, v] of Object.entries(values)) {
    const key = intKey(k);
    if (key === null) {
      throw new PacketFormatError(
        'SCHEMA',
        `enum value '${k}' is not a non-negative integer`,
        file,
        path
      );
    }
    let entryName: unknown = v;
    let entryDesc = '';
    if (isRaw(v)) {
      checkKeys(v, new Set(['name', 'description']), file, path, 'enum value');
      entryName = v.name;
      entryDesc = str(v, 'description', file, path);
    }
    if (typeof entryName !== 'string' || !entryName) {
      throw new PacketFormatError('SCHEMA', `enum value '${k}' needs a name`, file, path);
    }
    out[key] = { name: entryName, description: entryDesc };
  }
  return { name, flags, description, values: out };
}

function position(raw: Raw, file: string, path: string): [number, number] {
  const hasBits = 'bits' in raw;
  if (hasBits && ('offset' in raw || 'width' in raw)) {
    throw new PacketFormatError('BITS', 'give either bits or offset + width', file, path);
  }
  if (hasBits) {
    const m = typeof raw.bits === 'string' ? BITS_RE.exec(raw.bits) : null;
    if (!m) {
      throw new PacketFormatError('BITS', `malformed bits ${JSON.stringify(raw.bits)}`, file, path);
    }
    const msb = Number(m[1]);
    const lsb = m[2] !== undefined ? Number(m[2]) : msb;
    if (msb < lsb) {
      throw new PacketFormatError('BITS', `msb ${msb} < lsb ${lsb}`, file, path);
    }
    return [lsb, msb - lsb + 1];
  }
  const { offset, width } = raw;
  if (!(isInt(offset) && isInt(width) && offset >= 0 && width >= 1)) {
    throw new PacketFormatError(
      'BITS',
      'a field needs bits, or offset >= 0 and width >= 1',
      file,
      path
    );
  }
  return [offset, width];
}

/** Keys a field and a refine patch share (everything but position, composition and sub-fields). */
export function applyDetail(
  ctx: FieldContext,
  raw: Raw,
  out: Partial<ResolvedField>,
  file: string,
  path: string
): void {
  if ('description' in raw) {
    out.description = str(raw, 'description', file, path);
  }
  if ('type' in raw) {
    out.type = str(raw, 'type', file, path);
  }
  if ('enum' in raw && 'enumeratedValues' in raw) {
    throw new PacketFormatError('SCHEMA', 'give either enum or enumeratedValues', file, path);
  }
  if ('enum' in raw) {
    out.enum = ctx.namedEnum(raw.enum, file, path);
  } else if ('enumeratedValues' in raw) {
    out.enum = buildEnum(raw.enumeratedValues, '', file, path);
  }
  if ('unit' in raw) {
    out.unit = str(raw, 'unit', file, path);
  }
  for (const key of ['scale', 'offsetValue'] as const) {
    if (key in raw) {
      if (typeof raw[key] !== 'number') {
        throw new PacketFormatError('SCHEMA', `${key} must be a number`, file, path);
      }
      out[key] = raw[key];
    }
  }
  if ('constraints' in raw) {
    const c = checkKeys(
      raw.constraints,
      new Set(['min', 'max', 'const']),
      file,
      path,
      'constraints'
    );
    if (!Object.values(c).every(isInt)) {
      throw new PacketFormatError('SCHEMA', 'constraints must be integers', file, path);
    }
    out.constraints = { ...c };
  }
}

function relocate(f: ResolvedField, delta: number, prefix: string): ResolvedField {
  const copy = clone(f);
  for (const sub of iterFields([copy])) {
    sub.lsb += delta;
    sub.path = prefix + sub.path;
  }
  return copy;
}

export function buildField(
  ctx: FieldContext,
  raw: unknown,
  baseLsb: number,
  parentWidth: number | undefined,
  prefix: string,
  file: string,
  whereIn: string
): ResolvedField {
  checkKeys(raw, FIELD_KEYS, file, whereIn, 'field');
  const r = raw as Raw;
  const name = checkName(r.name, file, whereIn);
  const path = prefix + name;
  const where = `${whereIn}.${name}`;
  const [off, width] = position(r, file, where);
  const out: ResolvedField = {
    name,
    path,
    lsb: baseLsb + off,
    width,
    type: 'uint',
    description: '',
  };
  applyDetail(ctx, r, out, file, where);
  if (out.enum && !('type' in r)) {
    out.type = 'enum';
  }
  let spanBits = width;
  if ('array' in r) {
    const arr = checkKeys(r.array, new Set(['count', 'stride']), file, where, 'array');
    const count = arr.count;
    const stride = 'stride' in arr ? arr.stride : width;
    if (!(isInt(count) && count >= 1 && isInt(stride) && stride >= 1)) {
      throw new PacketFormatError('SCHEMA', 'array needs count >= 1 and stride >= 1', file, where);
    }
    if (stride < width) {
      throw new PacketFormatError(
        'FIELD_OVERLAP',
        `array stride ${stride} < element width ${width}`,
        file,
        where
      );
    }
    out.array = { count, stride };
    spanBits = width + (count - 1) * stride;
  }
  if (parentWidth !== undefined && off + spanBits > parentWidth) {
    throw new PacketFormatError(
      'FIELD_RANGE',
      `bits ${off}..${off + spanBits - 1} exceed the parent width ${parentWidth}`,
      file,
      where
    );
  }
  if ('format' in r) {
    if ('fields' in r) {
      throw new PacketFormatError('SCHEMA', 'give either format or fields', file, where);
    }
    const compName = r.format;
    const comp = ctx.resolveFormat(compName, file, where, true);
    const first = comp.beats[0];
    if (comp.beats.length !== 1 || first.count !== 1 || !(DATA in first.signals)) {
      throw new PacketFormatError(
        'COMPOSITION',
        `${String(compName)} is not a single-beat format with data fields`,
        file,
        where
      );
    }
    if (comp.dataWidth !== width) {
      throw new PacketFormatError(
        'COMPOSITION',
        `${String(compName)} has dataWidth ${comp.dataWidth}, the field ${width} bits`,
        file,
        where
      );
    }
    out.format = compName as string;
    out.fields = first.signals[DATA].map((f) => relocate(f, out.lsb, `${path}.`));
  } else if ('fields' in r) {
    out.fields = buildFields(ctx, r.fields, out.lsb, width, `${path}.`, file, where);
  }
  Object.assign(out, extensions(r));
  return out;
}

export function buildFields(
  ctx: FieldContext,
  raw: unknown,
  baseLsb: number,
  parentWidth: number | undefined,
  prefix: string,
  file: string,
  where: string
): ResolvedField[] {
  if (!Array.isArray(raw)) {
    throw new PacketFormatError('SCHEMA', 'fields must be a list', file, where);
  }
  const out = raw.map((r) => buildField(ctx, r, baseLsb, parentWidth, prefix, file, where));
  checkSiblings(out, 'FIELD_OVERLAP', file, where);
  return out;
}
