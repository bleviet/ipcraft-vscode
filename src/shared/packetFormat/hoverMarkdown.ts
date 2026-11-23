import { bitRange, countText } from './lanes';
import type { ResolvedEnum, ResolvedField, ResolvedFormat, ResolvedSection } from './types';

/** Escapes text for a markdown table cell. */
export function cell(text: string): string {
  return text.replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
}

/** `[msb:lsb]` of a field on its signal. */
export function bitsOf(f: ResolvedField): string {
  return bitRange(f.lsb + f.width - 1, f.lsb);
}

/** Compact enum listing: `0=HIGH, 1=NORMAL` (flags in hex: `0x01=A | 0x02=B`). */
export function enumSummary(en: ResolvedEnum, limit = 8): string {
  const entries = Object.entries(en.values);
  const shown = entries.slice(0, limit).map(([k, v]) => {
    const key = en.flags ? `0x${BigInt(k).toString(16).toUpperCase().padStart(2, '0')}` : k;
    return `${key}=${v.name}`;
  });
  const more = entries.length > limit ? `, … (+${entries.length - limit})` : '';
  return en.flags ? `${shown.join(' \\| ')}${more}` : `${shown.join(', ')}${more}`;
}

function typeText(f: ResolvedField): string {
  const parts: string[] = [f.type];
  if (f.enum) {
    parts.push(`${f.enum.name || 'enum'}${f.enum.flags ? ' (flags)' : ''}: ${enumSummary(f.enum)}`);
  }
  if (f.unit) {
    parts.push(f.unit);
  }
  if (f.scale !== undefined) {
    parts.push(`x${f.scale}`);
  }
  if (f.array) {
    parts.push(`[${f.array.count}]`);
  }
  if (f.format) {
    parts.push(`format ${f.format}`);
  }
  return parts.filter(Boolean).join(' · ');
}

function rows(signal: string, fields: readonly ResolvedField[], depth: number): string[] {
  return fields.flatMap((f) => [
    `| ${depth === 0 ? signal : ''} | ${bitsOf(f)} | ${'&nbsp;&nbsp;'.repeat(depth)}${cell(depth ? f.name : f.path)} | ${cell(typeText(f))} | ${cell(f.description)} |`,
    ...rows(signal, f.fields ?? [], depth + 1),
  ]);
}

function sectionTable(section: ResolvedSection): string[] {
  const lines = [
    `**${section.name}** — ${countText(section.count)}${section.description ? `: ${section.description}` : ''}`,
    '',
  ];
  lines.push(
    '| signal | bits | field path | type / enum | description |',
    '| --- | --- | --- | --- | --- |'
  );
  for (const [signal, fields] of Object.entries(section.signals)) {
    lines.push(...rows(signal, fields, 0));
  }
  return lines;
}

/** Hover for a `packetFormatRef`: the whole format with a field table per beat section. */
export function formatMarkdown(format: ResolvedFormat): string {
  const head = [
    `### Packet format \`${format.name}\``,
    '',
    ...(format.description ? [format.description, ''] : []),
    `Data width: **${format.dataWidth}** bit${format.busTypes.length ? ` · bus types: ${format.busTypes.join(', ')}` : ''}`,
    ...(format.extends.length
      ? ['', `Extends: ${format.extends.map((e) => `\`${e}\``).join(' → ')}`]
      : []),
  ];
  const body = format.beats.flatMap((s) => ['', ...sectionTable(s)]);
  return [...head, ...body].join('\n');
}

/** An error (unresolvable ref) as hover text. */
export function errorMarkdown(ref: string, message: string): string {
  return `### Packet format \`${ref}\`\n\n$(error) ${message}`;
}
