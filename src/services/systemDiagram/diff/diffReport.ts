/** Markdown report of a {@link SystemGraphDiff}, made for a pull request comment. Pure. */

import type {
  InstanceChange,
  PortChange,
  SegmentChange,
  SegmentValues,
  SystemGraphDiff,
  ValueChange,
} from '../../../domain/systemGraphDiff';
import { withoutVersionOnly } from './ignoreVersionOnly';
import { FIXED_ATTRIBUTES } from './pinAttributes';
import { compareText } from './compareText';

export interface DiffLabels {
  base: string;
  current: string;
}

export interface DiffReportOptions {
  ignoreVersionOnly: boolean;
}

type Row = string[];

const SIGNS = { added: '+', removed: '−', changed: '~', version: 'v' } as const;

const code = (text: string): string => `\`${text}\``;
const cell = (text: string): string => text.replace(/\|/g, '\\|');
const line = (cells: string[]): string =>
  `|${cells.map((c) => (c === '' ? ' ' : ` ${cell(c)} `)).join('|')}|`;
const table = (header: string[], rows: Row[]): string =>
  [line(header), `|${header.map(() => '---').join('|')}|`, ...rows.map(line)].join('\n');

const peersText = (peers: string[] | undefined): string =>
  peers === undefined ? '' : peers.length === 0 ? 'not connected' : code(peers.join(', '));

const optional = (value: string | undefined): string => (value === undefined ? '' : code(value));

function segmentText(values: SegmentValues | undefined): string {
  return [values?.offset, values?.range]
    .filter((v) => v !== undefined)
    .map((v) => code(v))
    .join(' · ');
}

function segmentRow(change: SegmentChange): Row {
  return [
    SIGNS[change.status],
    code(change.addressSpace),
    code(change.segment),
    segmentText(change.base),
    segmentText(change.current),
  ];
}

/** Attribute and connection items of one side of a port, as `direction \`in\` · connects to \`a, b\``. */
function portText(port: PortChange, side: 'base' | 'current'): string {
  const peers = side === 'base' ? port.basePeers : port.currentPeers;
  if (peers === undefined) {
    return '';
  }
  const items = port.attributes
    .filter((a) => a[side] !== undefined)
    .map((a) => `${a.key} ${code(a[side] as string)}`);
  const peersDiffer =
    port.status !== 'changed' || port.basePeers?.join() !== port.currentPeers?.join();
  if (peersDiffer || items.length === 0) {
    items.push(peers.length === 0 ? 'not connected' : `connects to ${peersText(peers)}`);
  }
  return items.join(' · ');
}

function portRow(port: PortChange): Row {
  return [SIGNS[port.status], code(port.pin), portText(port, 'base'), portText(port, 'current')];
}

function parameterRow(name: string, change: ValueChange): Row {
  return [
    '~',
    name,
    `parameter ${code(change.key)}`,
    optional(change.base),
    optional(change.current),
  ];
}

function pinRows(change: InstanceChange, name: string): Row[] {
  const whole = change.status === 'added' || change.status === 'removed';
  const sign = whole ? SIGNS[change.status as 'added' | 'removed'] : '~';
  return change.pins.flatMap((pin) => {
    const rows: Row[] = [];
    const peersDiffer = pin.basePeers?.join('\u0000') !== pin.currentPeers?.join('\u0000');
    if (pin.status !== 'changed' || peersDiffer) {
      const what = whole || pin.status === 'changed' ? 'connects to' : pin.status;
      rows.push([
        sign,
        name,
        `pin ${code(pin.pin)} ${pin.inside ? 'inside ' : ''}${what}`,
        peersText(pin.basePeers),
        peersText(pin.currentPeers),
      ]);
    }
    for (const a of pin.attributes ?? []) {
      const what = FIXED_ATTRIBUTES.has(a.key) ? a.key : `parameter ${code(a.key)}`;
      rows.push([
        sign,
        name,
        `pin ${code(pin.pin)} ${what}`,
        optional(a.base),
        optional(a.current),
      ]);
    }
    return rows;
  });
}

function instanceRows(change: InstanceChange): Row[] {
  const name = code(change.path.slice(change.path.lastIndexOf('/') + 1));
  const [baseType, currentType] = [optional(change.baseType), optional(change.currentType)];
  if (change.status !== 'changed') {
    return [
      [SIGNS[change.status], name, change.status, baseType, currentType],
      ...pinRows(change, name),
    ];
  }
  const rows: Row[] = [];
  if (change.baseType !== change.currentType) {
    rows.push(['~', name, 'type', baseType, currentType]);
  }
  for (const parameter of change.parameters) {
    rows.push(parameterRow(name, parameter));
  }
  return [...rows, ...pinRows(change, name)];
}

function levelSections(instances: InstanceChange[]): string[] {
  const levels = [...new Set(instances.map((i) => i.level))].sort(compareText);
  return levels.map((level) => {
    const rows = instances.filter((i) => i.level === level).flatMap(instanceRows);
    return `### Level ${code(level)}\n${table(['', 'Block', 'Change', 'Base', 'Current'], rows)}`;
  });
}

/** Markdown for a diff; the layout is stable, because the tests compare it with golden text. */
export function diffToMarkdown(
  diff: SystemGraphDiff,
  labels: DiffLabels,
  options: DiffReportOptions
): string {
  const shown = options.ignoreVersionOnly ? withoutVersionOnly(diff) : diff;
  const { added, removed, changed, version } = shown.summary;
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
  if (shown.segments.length > 0) {
    parts.push(
      `### Address map\n${table(['', 'Address space', 'Segment', 'Base', 'Current'], shown.segments.map(segmentRow))}`
    );
  }
  if (shown.ports.length > 0) {
    parts.push(
      `### External ports\n${table(['', 'Port', 'Base', 'Current'], shown.ports.map(portRow))}`
    );
  }
  parts.push(...levelSections(shown.instances));
  return `${parts.join('\n\n')}\n`;
}
