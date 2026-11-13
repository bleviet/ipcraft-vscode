/** Markdown report of a {@link SystemGraphDiff}, made for a pull request comment. Pure. */

import type { Finding, FindingsDiff, SystemGraphDiff } from '../../../domain/systemGraphDiff';
import { changeRows, type Cell, type CellPart, type ChangeRow } from './changeRows';
import { withoutVersionOnly } from './ignoreVersionOnly';

export interface DiffLabels {
  base: string;
  current: string;
}

export interface DiffReportOptions {
  ignoreVersionOnly: boolean;
  /** The findings that differ (see `diffFindings`); the report has a Findings section when there are any. */
  findings?: FindingsDiff;
}

type Row = string[];

/** A code span; the fence is one backtick longer than the longest run in the text (CommonMark). */
function code(text: string): string {
  const fence = '`'.repeat(Math.max(0, ...(text.match(/`+/g) ?? []).map((run) => run.length)) + 1);
  const pad = text.startsWith('`') || text.endsWith('`') ? ' ' : '';
  return `${fence}${pad}${text}${pad}${fence}`;
}
/** Text for a table cell: a line break would split the row, a pipe the cell. */
const cell = (text: string): string => text.replace(/[\r\n]+/g, ' ').replace(/\|/g, '\\|');
const line = (cells: string[]): string =>
  `|${cells.map((c) => (c === '' ? ' ' : ` ${cell(c)} `)).join('|')}|`;
const table = (header: string[], rows: Row[]): string =>
  [line(header), `|${header.map(() => '---').join('|')}|`, ...rows.map(line)].join('\n');

/** A cell with its code parts in code spans and its items joined with ` · `. */
const render = (value: Cell): string => value.map((item) => renderItem(item)).join(' · ');

/** A marked part is a code span in `**`; code parts with no marked part between them share one span. */
function renderItem(item: CellPart[]): string {
  let text = '';
  let run = '';
  const flush = () => {
    text += run === '' ? '' : code(run);
    run = '';
  };
  for (const part of item) {
    if (part.code && !part.mark) {
      run += part.text;
    } else {
      flush();
      text += part.mark ? `**${code(part.text)}**` : part.text;
    }
  }
  flush();
  return text;
}

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

const FINDING_NAMES: Record<Finding['kind'], string> = {
  undriven: 'undriven pin',
  unused: 'unused pin',
  dataCrossing: 'data crossing',
  resetCrossing: 'reset crossing',
};

function findingRow(sign: string, finding: Finding): Row {
  const onLevel = finding.level === '/' ? '' : ` on level ${code(finding.level)}`;
  if ('label' in finding) {
    return [sign, FINDING_NAMES[finding.kind], `${code(finding.label)}${onLevel}`, ''];
  }
  const clock = (label: string | undefined) =>
    label === undefined ? 'unknown clock' : code(label);
  return [
    sign,
    FINDING_NAMES[finding.kind],
    `${code(finding.from)} → ${code(finding.to)}${onLevel}`,
    `${clock(finding.fromClock)} → ${clock(finding.toClock)} · ${finding.reason}`,
  ];
}

function findingsSection({ new: added, resolved }: FindingsDiff): string {
  const rows = [
    ...added.map((finding) => findingRow('New', finding)),
    ...resolved.map((finding) => findingRow('Resolved', finding)),
  ];
  return `### Findings\n${table(['', 'Finding', 'Where', 'Detail'], rows)}\n\nFindings are computed from the design files alone; workspace definitions are not used, so pins of blocks without a known pin list are not checked.`;
}

/** Markdown for a diff; the layout is stable, because the tests compare it with golden text. */
export function diffToMarkdown(
  diff: SystemGraphDiff,
  labels: DiffLabels,
  options: DiffReportOptions
): string {
  const rows = changeRows(diff, options);
  const { added, removed, changed, version, renamed } = (
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
  const found = options.findings;
  const [foundNew, foundResolved] = [found?.new.length ?? 0, found?.resolved.length ?? 0];
  if (added + removed + changed + version + renamed + foundNew + foundResolved === 0) {
    parts.push('No changes.');
    return `${parts.join('\n\n')}\n`;
  }
  const findingsSummary =
    foundNew + foundResolved === 0
      ? ''
      : ` · ${foundNew} new finding${foundNew === 1 ? '' : 's'} · ${foundResolved} resolved finding${foundResolved === 1 ? '' : 's'}`;
  parts.push(
    `**+${added} added · −${removed} removed · ~${changed} changed${renamed > 0 ? ` · →${renamed} renamed` : ''}${
      options.ignoreVersionOnly ? '' : ` · v${version} version only`
    }${findingsSummary}**`
  );
  if (found && foundNew + foundResolved > 0) {
    parts.push(findingsSection(found));
  }
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
