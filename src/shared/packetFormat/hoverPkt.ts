import { bitsOf, cell, enumSummary } from './hoverMarkdown';
import type { FieldSite } from './sites';
import type { ResolvedField, ResolvedFormat, ResolvedMap, ResolvedPacketDocument } from './types';

const norm = (s: string): string =>
  ['tdata', 'data'].includes(s.toLowerCase()) ? 'data' : s.toLowerCase();

/** Formats that contain a field declared or refined in `format`: itself and every format extending it. */
export function formatsOf(doc: ResolvedPacketDocument, format: string): ResolvedFormat[] {
  return Object.values(doc.formats).filter((f) => f.name === format || f.extends.includes(format));
}

export interface FoundField {
  field: ResolvedField;
  section: string;
  signal: string;
}

/** Looks a dotted path up in a resolved format (paths do not contain section names). */
export function findField(format: ResolvedFormat, path: string): FoundField | undefined {
  const walk = (fields: readonly ResolvedField[]): ResolvedField | undefined => {
    for (const f of fields) {
      if (f.path === path) {
        return f;
      }
      const hit = path.startsWith(`${f.path}.`) ? walk(f.fields ?? []) : undefined;
      if (hit) {
        return hit;
      }
    }
    return undefined;
  };
  for (const section of format.beats) {
    for (const [signal, fields] of Object.entries(section.signals)) {
      const field = walk(fields);
      if (field) {
        return { field, section: section.name, signal };
      }
    }
  }
  return undefined;
}

function enumLines(f: ResolvedField): string[] {
  if (!f.enum) {
    return [];
  }
  const e = f.enum;
  return [`Enum \`${e.name || 'inline'}\`${e.flags ? ' (flags)' : ''}: ${enumSummary(e, 32)}`];
}

/** Hover for a field line of a `*.pkt.yml`. Undefined when the field cannot be found in the resolved document. */
export function pktFieldMarkdown(site: FieldSite, doc: ResolvedPacketDocument): string | undefined {
  const members = formatsOf(doc, site.format);
  const found = members.map((m) => findField(m, site.path)).find((x) => x !== undefined);
  if (!found) {
    return undefined;
  }
  const { field, section, signal } = found;
  const parent = site.path.includes('.') ? site.path.slice(0, site.path.lastIndexOf('.')) : '';
  const base = doc.formats[site.format]?.extends[0];
  const lines = [
    `### \`${field.path}\``,
    '',
    `Bus signal: \`${norm(signal) === 'data' ? 'TDATA / data' : signal}\` ${bitsOf(field)} · ${field.width} bit · type ${field.type}`,
    '',
    `Beat section: \`${section}\`${parent ? ` · parent: \`${parent}\`` : ''}`,
    '',
    `Belongs to: ${members.map((m) => `\`${m.name}\``).join(', ')}`,
  ];
  if (site.kind === 'refine' && base) {
    lines.push('', `Refines the base format \`${base}\` (layout unchanged).`);
  }
  if (field.description) {
    lines.push('', cell(field.description));
  }
  const en = enumLines(field);
  if (en.length) {
    lines.push('', ...en);
  }
  return lines.join('\n');
}

function flatten(
  fields: readonly ResolvedField[],
  into = new Map<string, ResolvedField>()
): Map<string, ResolvedField> {
  for (const f of fields) {
    into.set(f.path, f);
    flatten(f.fields ?? [], into);
  }
  return into;
}

function allFields(format: ResolvedFormat): Map<string, ResolvedField> {
  const out = new Map<string, ResolvedField>();
  for (const s of format.beats) {
    for (const fields of Object.values(s.signals)) {
      flatten(fields, out);
    }
  }
  return out;
}

const same = (a: ResolvedField, b: ResolvedField): boolean =>
  JSON.stringify({ ...a, fields: undefined }) === JSON.stringify({ ...b, fields: undefined });

export interface PayloadDiff {
  added: ResolvedField[];
  changed: ResolvedField[];
}

/** What `format` adds to or changes in `base`. */
export function payloadDiff(format: ResolvedFormat, base: ResolvedFormat): PayloadDiff {
  const baseFields = allFields(base);
  const diff: PayloadDiff = { added: [], changed: [] };
  for (const [path, f] of allFields(format)) {
    const b = baseFields.get(path);
    if (!b) {
      diff.added.push(f);
    } else if (!same(f, b)) {
      diff.changed.push(f);
    }
  }
  return diff;
}

/** Hover for a `sources:` entry of a `*.pktmap.yml`: the payload mapping of that source. */
export function pktmapSourceMarkdown(
  key: string,
  map: ResolvedMap,
  doc: ResolvedPacketDocument
): string | undefined {
  const src = map.sources[key];
  const format = src ? doc.formats[src.format] : undefined;
  if (!src || !format) {
    return undefined;
  }
  const base = doc.formats[map.base];
  const lines = [
    `### Source \`${src.name}\` (${map.selector} = ${key})`,
    '',
    `Format: \`${format.name}\`${src.description ? ` — ${cell(src.description)}` : ''}`,
  ];
  if (!base || format.name === base.name) {
    lines.push('', `Uses the base format \`${map.base}\` unchanged.`);
    return lines.join('\n');
  }
  const { added, changed } = payloadDiff(format, base);
  const list = (title: string, fields: ResolvedField[]): string[] =>
    fields.length
      ? [
          '',
          `**${title}**`,
          '',
          ...fields.map(
            (f) => `- \`${f.path}\` ${bitsOf(f)}${f.description ? ` — ${cell(f.description)}` : ''}`
          ),
        ]
      : [];
  lines.push(
    ...list(`Added vs \`${base.name}\``, added),
    ...list(`Changed vs \`${base.name}\``, changed)
  );
  if (!added.length && !changed.length) {
    lines.push('', `Identical to \`${base.name}\`.`);
  }
  return lines.join('\n');
}
