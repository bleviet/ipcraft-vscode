/** Markdown report of a {@link SystemGraphDiff}, made for a pull request comment. Pure. */

import type { SystemGraphDiff } from '../../../domain/systemGraphDiff';
import { changeRows, type Cell, type ChangeRow } from './changeRows';
import { withoutVersionOnly } from './ignoreVersionOnly';

export interface DiffLabels {
  base: string;
  current: string;
}

export interface DiffReportOptions {
  ignoreVersionOnly: boolean;
}

type Row = string[];

const code = (text: string): string => `\`${text}\``;
const cell = (text: string): string => text.replace(/\|/g, '\\|');
const line = (cells: string[]): string =>
  `|${cells.map((c) => (c === '' ? ' ' : ` ${cell(c)} `)).join('|')}|`;
const table = (header: string[], rows: Row[]): string =>
  [line(header), `|${header.map(() => '---').join('|')}|`, ...rows.map(line)].join('\n');

/** A cell with its code parts in code spans and its items joined with ` · `. */
const render = (value: Cell): string =>
  value
    .map((item) => item.map((part) => (part.code ? code(part.text) : part.text)).join(''))
    .join(' · ');

function markdownRow(row: ChangeRow): Row {
  const [subject, base, current] = [row.subject, row.base, row.current].map(render);
  switch (row.section) {
    case 'port':
      return [row.sign, subject, base, current];
    default:
      return [row.sign, subject, render(row.change), base, current];
  }
}

function levelSections(rows: ChangeRow[]): string[] {
  const levels = [...new Set(rows.map((r) => r.level as string))];
  return levels.map((level) => {
    const own = rows.filter((r) => r.level === level).map(markdownRow);
    return `### Level ${code(level)}\n${table(['', 'Block', 'Change', 'Base', 'Current'], own)}`;
  });
}

/** Markdown for a diff; the layout is stable, because the tests compare it with golden text. */
export function diffToMarkdown(
  diff: SystemGraphDiff,
  labels: DiffLabels,
  options: DiffReportOptions
): string {
  const rows = changeRows(diff, options);
  const { added, removed, changed, version } = (
    options.ignoreVersionOnly ? withoutVersionOnly(diff) : diff
  ).summary;
  const parts = [
    `## System design changes: ${diff.current.name}`,
    `Comparing ${code(labels.base)} (base) with ${code(labels.current)}.`,
  ];
  if (diff.formatsDiffer) {
    parts.push(
      `The two revisions use different formats (${diff.base.format} and ${diff.current.format}).`
    );
  }
  if (added + removed + changed + version === 0) {
    parts.push('No changes.');
    return `${parts.join('\n\n')}\n`;
  }
  parts.push(
    `**+${added} added · −${removed} removed · ~${changed} changed${
      options.ignoreVersionOnly ? '' : ` · v${version} version only`
    }**`
  );
  const section = (name: ChangeRow['section']) =>
    rows.filter((r) => r.section === name).map(markdownRow);
  const [address, ports] = [section('address'), section('port')];
  if (address.length > 0) {
    parts.push(
      `### Address map\n${table(['', 'Address space', 'Segment', 'Base', 'Current'], address)}`
    );
  }
  if (ports.length > 0) {
    parts.push(`### External ports\n${table(['', 'Port', 'Base', 'Current'], ports)}`);
  }
  parts.push(...levelSections(rows.filter((r) => r.section === 'level')));
  return `${parts.join('\n\n')}\n`;
}
