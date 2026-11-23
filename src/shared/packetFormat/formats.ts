import {
  DATA,
  PacketFormatError,
  UNTIL_LAST,
  type ResolvedCount,
  type ResolvedField,
  type ResolvedFormat,
  type ResolvedSection,
} from './types';
import { applyDetail, buildFields, checkSiblings, type FieldContext } from './fields';
import {
  checkKeys,
  checkName,
  clone,
  extensions,
  isInt,
  isRaw,
  iterFields,
  str,
  type Raw,
} from './util';

const FORMAT_KEYS = new Set([
  'name',
  'description',
  'busTypes',
  'dataWidth',
  'beats',
  'extends',
  'refine',
]);
const BEAT_KEYS = new Set(['name', 'description', 'count', 'signals']);
const PATCH_KEYS = new Set([
  'description',
  'type',
  'enum',
  'enumeratedValues',
  'unit',
  'scale',
  'offsetValue',
  'constraints',
  'fields',
]);
const LAYOUT_KEYS = ['name', 'bits', 'offset', 'width', 'array', 'format'];

function buildCount(raw: unknown, file: string, where: string): ResolvedCount {
  if (isInt(raw) && raw >= 0) {
    return raw;
  }
  if (raw === UNTIL_LAST) {
    return UNTIL_LAST;
  }
  if (isRaw(raw)) {
    checkKeys(raw, new Set(['field', 'perBeat', 'add']), file, where, 'count');
    const per = 'perBeat' in raw ? raw.perBeat : 1;
    const add = 'add' in raw ? raw.add : 0;
    if (typeof raw.field !== 'string' || !(isInt(per) && per >= 1) || !isInt(add)) {
      throw new PacketFormatError(
        'SCHEMA',
        'count needs a field path, perBeat >= 1 and an integer add',
        file,
        where
      );
    }
    return { field: raw.field, perBeat: per, add };
  }
  throw new PacketFormatError('SCHEMA', `invalid count ${JSON.stringify(raw)}`, file, where);
}

function buildSection(
  ctx: FieldContext,
  b: unknown,
  width: number,
  sections: Set<string>,
  top: Set<string>,
  file: string,
  where: string
): ResolvedSection {
  checkKeys(b, BEAT_KEYS, file, where, 'beat section');
  const r = b as Raw;
  const sname = checkName(r.name, file, `${where}.beats`);
  const swhere = `${where}.beats.${sname}`;
  if (sections.has(sname)) {
    throw new PacketFormatError(
      'DUPLICATE_NAME',
      `beat section ${sname} is defined twice`,
      file,
      swhere
    );
  }
  sections.add(sname);
  const signals: Record<string, ResolvedField[]> = {};
  const rawSignals = r.signals ?? {};
  if (!isRaw(rawSignals)) {
    throw new PacketFormatError('SCHEMA', 'signals must be a mapping', file, swhere);
  }
  for (const [sig, flist] of Object.entries(rawSignals)) {
    const key = ['data', 'tdata'].includes(sig.toLowerCase()) ? DATA : sig;
    if (Object.keys(signals).some((k) => k.toLowerCase() === key.toLowerCase())) {
      throw new PacketFormatError('DUPLICATE_NAME', `signal ${sig} is listed twice`, file, swhere);
    }
    const fields = buildFields(
      ctx,
      flist,
      0,
      key === DATA ? width : undefined,
      '',
      file,
      `${swhere}.${sig}`
    );
    for (const f of fields) {
      if (top.has(f.name)) {
        throw new PacketFormatError(
          'DUPLICATE_NAME',
          `field ${f.name} is defined twice in the format`,
          file,
          swhere
        );
      }
      top.add(f.name);
    }
    signals[key] = fields;
  }
  return {
    name: sname,
    description: str(r, 'description', file, swhere),
    count: buildCount('count' in r ? r.count : 1, file, swhere),
    signals,
    ...extensions(r),
  };
}

function checkCounts(fmt: ResolvedFormat, file: string, where: string): void {
  fmt.beats.forEach((sec, i) => {
    const c = sec.count;
    if (c === UNTIL_LAST && i !== fmt.beats.length - 1) {
      throw new PacketFormatError(
        'COUNT',
        `untilLast is only allowed in the last section, not in ${sec.name}`,
        file,
        where
      );
    }
    if (typeof c === 'object') {
      const earlier = new Set<string>();
      for (const s of fmt.beats.slice(0, i)) {
        if (s.count === 1) {
          for (const fl of Object.values(s.signals)) {
            for (const f of iterFields(fl)) {
              earlier.add(f.path);
            }
          }
        }
      }
      if (!earlier.has(c.field)) {
        throw new PacketFormatError(
          'COUNT',
          `count field ${c.field} of ${sec.name} is not in an earlier section with count 1`,
          file,
          where
        );
      }
    }
  });
}

function refine(
  ctx: FieldContext,
  fmt: ResolvedFormat,
  path: string,
  patch: unknown,
  file: string,
  where: string
): void {
  if (!isRaw(patch)) {
    throw new PacketFormatError('SCHEMA', 'a refine patch must be a mapping', file, where);
  }
  const layout = Object.keys(patch).filter((k) => LAYOUT_KEYS.includes(k));
  if (layout.length > 0) {
    throw new PacketFormatError(
      'REFINE',
      `refine may not change ${layout.join(', ')}`,
      file,
      where
    );
  }
  checkKeys(patch, PATCH_KEYS, file, where, 'refine patch');
  let target: ResolvedField | undefined;
  for (const sec of fmt.beats) {
    for (const fl of Object.values(sec.signals)) {
      target ??= [...iterFields(fl)].find((f) => f.path === path);
    }
  }
  if (!target) {
    throw new PacketFormatError(
      'UNKNOWN_REF',
      `${fmt.extends[0]} has no field ${path}`,
      file,
      where
    );
  }
  applyDetail(ctx, patch, target, file, where);
  if (
    ('enum' in patch || 'enumeratedValues' in patch) &&
    !('type' in patch) &&
    target.type === 'uint'
  ) {
    target.type = 'enum';
  }
  if ('fields' in patch) {
    const added = buildFields(
      ctx,
      patch.fields,
      target.lsb,
      target.width,
      `${target.path}.`,
      file,
      where
    );
    const merged = [...(target.fields ?? []), ...added];
    checkSiblings(merged, 'REFINE', file, where);
    target.fields = merged;
  }
  Object.assign(target, extensions(patch));
}

function buildRefined(
  ctx: FieldContext,
  name: string,
  raw: Raw,
  file: string,
  where: string,
  busTypes: string[] | undefined
): ResolvedFormat {
  if ('beats' in raw || 'dataWidth' in raw) {
    throw new PacketFormatError(
      'SCHEMA',
      'a format with extends takes neither beats nor dataWidth',
      file,
      where
    );
  }
  const base = ctx.resolveFormat(raw.extends, file, where, false);
  const out = clone(base);
  for (const k of Object.keys(out)) {
    if (k.startsWith('x-')) {
      delete out[k as `x-${string}`];
    }
  }
  out.name = name;
  out.description = str(raw, 'description', file, where, base.description);
  out.busTypes = busTypes ? [...busTypes] : out.busTypes;
  out.extends = [base.name, ...base.extends];
  const patches = 'refine' in raw ? raw.refine : {};
  if (!isRaw(patches)) {
    throw new PacketFormatError('SCHEMA', 'refine must be a mapping', file, where);
  }
  for (const [path, patch] of Object.entries(patches)) {
    refine(ctx, out, path, patch, file, `${where}.refine.${path}`);
  }
  Object.assign(out, extensions(raw));
  return out;
}

export function buildFormat(
  ctx: FieldContext,
  name: string,
  raw: unknown,
  file: string
): ResolvedFormat {
  const where = `packetFormats.${name}`;
  checkKeys(raw, FORMAT_KEYS, file, where, 'packet format');
  const r = raw as Raw;
  const bus = r.busTypes;
  if (
    bus !== undefined &&
    bus !== null &&
    !(Array.isArray(bus) && bus.every((b) => typeof b === 'string'))
  ) {
    throw new PacketFormatError('SCHEMA', 'busTypes must be a list of names', file, where);
  }
  const busTypes = bus ?? undefined;
  if ('extends' in r) {
    return buildRefined(ctx, name, r, file, where, busTypes);
  }
  if ('refine' in r) {
    throw new PacketFormatError('SCHEMA', 'refine needs extends', file, where);
  }
  const width = r.dataWidth;
  const beats = r.beats;
  if (!(isInt(width) && width >= 1)) {
    throw new PacketFormatError('SCHEMA', 'dataWidth must be a positive integer', file, where);
  }
  if (!Array.isArray(beats) || beats.length === 0) {
    throw new PacketFormatError('SCHEMA', 'beats must be a non-empty list', file, where);
  }
  const sections = new Set<string>();
  const top = new Set<string>();
  const out: ResolvedFormat = {
    name,
    description: str(r, 'description', file, where),
    dataWidth: width,
    busTypes: [...(busTypes ?? [])],
    extends: [],
    beats: beats.map((b) => buildSection(ctx, b, width, sections, top, file, where)),
  };
  checkCounts(out, file, where);
  Object.assign(out, extensions(r));
  return out;
}
