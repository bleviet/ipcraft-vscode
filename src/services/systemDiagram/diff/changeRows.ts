/**
 * The changes of a {@link SystemGraphDiff} as flat table rows with structured cells: the one row model
 * of the Markdown report and the viewer's Changes tab. Pure and JSON-serializable.
 */

import type {
  InstanceChange,
  PortChange,
  SegmentChange,
  SegmentValues,
  SystemGraphDiff,
  ValueChange,
} from '../../../domain/systemGraphDiff';
import { compareText } from './compareText';
import { withoutVersionOnly } from './ignoreVersionOnly';
import { FIXED_ATTRIBUTES } from './pinAttributes';

export type ChangeSign = '+' | '−' | '~' | 'v';

/** A piece of a cell; `code`: an identifier or value as written in the design (monospace in the tab, a code span in Markdown). */
export interface CellPart {
  text: string;
  code?: true;
}

/** Items of a cell; the renderers join the items with ` · `. Each item is a sequence of parts written one after the other. */
export type Cell = CellPart[][];

/** The plain text of a cell: the parts of an item concatenated, the items joined with ` · `. */
export function cellText(cell: Cell): string {
  return cell.map((item) => item.map((part) => part.text).join('')).join(' · ');
}

export interface ChangeRow {
  sign: ChangeSign;
  section: 'address' | 'port' | 'level';
  /** `level` rows: the level path the block is on. */
  level?: string;
  /** What the row is about: block name, port name, or the address space of a segment (one code part). */
  subject: Cell;
  /**
   * `level` rows: the change, e.g. `added`, `parameter CONFIG.x`, `pin S_AXIS connects to`
   * (names are code parts); `address` rows: the segment (a code part); `port` rows: empty.
   */
  change: Cell;
  /**
   * `address` rows: the offset and the range, one item each. `port` rows: one item per
   * attribute (`direction in`) and one for the connections (`connects to a, b` or `not
   * connected`). `level` rows: the type, the value, or the peers (one code part, `a, b`).
   */
  base: Cell;
  current: Cell;
  /**
   * What to select in the viewer; absent when the thing is not in the current revision.
   * A segment names itself by address space and segment: the diff does not know its slave block.
   */
  target?:
    | { kind: 'instance'; path: string }
    | { kind: 'port'; name: string }
    | { kind: 'segment'; addressSpace: string; segment: string };
}

const SIGNS = { added: '+', removed: '−', changed: '~', version: 'v' } as const;

const plain = (text: string): CellPart => ({ text });
const code = (text: string): CellPart => ({ text, code: true });
const NOT_CONNECTED: CellPart = plain('not connected');

/** One item of code parts, or no item for a value that does not exist. */
const value = (text: string | undefined): Cell => (text === undefined ? [] : [[code(text)]]);

/** The peers of a pin as one code part `a, b`, or `not connected`; empty when the pin does not exist. */
function peersCell(peers: string[] | undefined): Cell {
  return peers === undefined
    ? []
    : [peers.length === 0 ? [NOT_CONNECTED] : [code(peers.join(', '))]];
}

function segmentCell(values: SegmentValues | undefined): Cell {
  return [values?.offset, values?.range].filter((v) => v !== undefined).map((v) => [code(v)]);
}

function segmentRow(change: SegmentChange): ChangeRow {
  return {
    sign: SIGNS[change.status],
    section: 'address',
    subject: [[code(change.addressSpace)]],
    change: [[code(change.segment)]],
    base: segmentCell(change.base),
    current: segmentCell(change.current),
    ...(change.status !== 'removed' && {
      target: { kind: 'segment', addressSpace: change.addressSpace, segment: change.segment },
    }),
  };
}

/** Attribute and connection items of one side of a port, as `direction in · connects to a, b`. */
function portCell(port: PortChange, side: 'base' | 'current'): Cell {
  const peers = side === 'base' ? port.basePeers : port.currentPeers;
  if (peers === undefined) {
    return [];
  }
  const items: Cell = port.attributes
    .filter((a) => a[side] !== undefined)
    .map((a) => [plain(`${a.key} `), code(a[side] as string)]);
  const peersDiffer =
    port.status !== 'changed' || port.basePeers?.join() !== port.currentPeers?.join();
  if (peersDiffer || items.length === 0) {
    items.push(
      peers.length === 0 ? [NOT_CONNECTED] : [plain('connects to '), code(peers.join(', '))]
    );
  }
  return items;
}

function portRow(port: PortChange): ChangeRow {
  return {
    sign: SIGNS[port.status],
    section: 'port',
    subject: [[code(port.pin)]],
    change: [],
    base: portCell(port, 'base'),
    current: portCell(port, 'current'),
    ...(port.status !== 'removed' && { target: { kind: 'port', name: port.pin } }),
  };
}

/** Rows of one block share these fields. */
type BlockRow = Pick<ChangeRow, 'section' | 'level' | 'subject' | 'target'>;

function parameterRow(block: BlockRow, change: ValueChange): ChangeRow {
  return {
    ...block,
    sign: '~',
    change: [[plain('parameter '), code(change.key)]],
    base: value(change.base),
    current: value(change.current),
  };
}

function pinRows(change: InstanceChange, block: BlockRow): ChangeRow[] {
  const whole = change.status === 'added' || change.status === 'removed';
  const sign = whole ? SIGNS[change.status as 'added' | 'removed'] : '~';
  return change.pins.flatMap((pin) => {
    const rows: ChangeRow[] = [];
    const peersDiffer = pin.basePeers?.join('\u0000') !== pin.currentPeers?.join('\u0000');
    if (pin.status !== 'changed' || peersDiffer) {
      const what = whole || pin.status === 'changed' ? 'connects to' : pin.status;
      rows.push({
        ...block,
        sign,
        change: [[plain('pin '), code(pin.pin), plain(` ${pin.inside ? 'inside ' : ''}${what}`)]],
        base: peersCell(pin.basePeers),
        current: peersCell(pin.currentPeers),
      });
    }
    for (const a of pin.attributes ?? []) {
      rows.push({
        ...block,
        sign,
        change: [
          FIXED_ATTRIBUTES.has(a.key)
            ? [plain('pin '), code(pin.pin), plain(` ${a.key}`)]
            : [plain('pin '), code(pin.pin), plain(' parameter '), code(a.key)],
        ],
        base: value(a.base),
        current: value(a.current),
      });
    }
    return rows;
  });
}

function instanceRows(change: InstanceChange): ChangeRow[] {
  const block: BlockRow = {
    section: 'level',
    level: change.level,
    subject: [[code(change.path.slice(change.path.lastIndexOf('/') + 1))]],
    ...(change.status !== 'removed' && { target: { kind: 'instance', path: change.path } }),
  };
  const [baseType, currentType] = [value(change.baseType), value(change.currentType)];
  if (change.status !== 'changed') {
    return [
      {
        ...block,
        sign: SIGNS[change.status],
        change: [[plain(change.status)]],
        base: baseType,
        current: currentType,
      },
      ...pinRows(change, block),
    ];
  }
  const rows: ChangeRow[] = [];
  if (change.baseType !== change.currentType) {
    rows.push({
      ...block,
      sign: '~',
      change: [[plain('type')]],
      base: baseType,
      current: currentType,
    });
  }
  for (const parameter of change.parameters) {
    rows.push(parameterRow(block, parameter));
  }
  return [...rows, ...pinRows(change, block)];
}

/**
 * The rows in report order: the address map, the external ports, then the blocks by level
 * (sorted) in the order of the diff. `ignoreVersionOnly` leaves out the version-only blocks.
 */
export function changeRows(
  diff: SystemGraphDiff,
  options: { ignoreVersionOnly: boolean }
): ChangeRow[] {
  const shown = options.ignoreVersionOnly ? withoutVersionOnly(diff) : diff;
  const levels = [...new Set(shown.instances.map((i) => i.level))].sort(compareText);
  return [
    ...shown.segments.map(segmentRow),
    ...shown.ports.map(portRow),
    ...levels.flatMap((level) =>
      shown.instances.filter((i) => i.level === level).flatMap(instanceRows)
    ),
  ];
}
