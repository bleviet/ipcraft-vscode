/**
 * What a comparison marks on the diagram (issue #302): per block, per external port and per
 * level, and whether a drawn wire is new. A plain data structure and small pure functions over
 * a {@link SystemGraphDiff} and the current {@link SystemGraph}; the canvas, the outline and
 * the Details panel read it. A removed block, port or wire is drawn only while its ghost is shown (see
 * `layout/unionGraph.ts`); otherwise it is only counted.
 */

import type { SystemGraph } from '../../domain/systemGraph';
import type { PinChange, PortChange, SystemGraphDiff } from '../../domain/systemGraphDiff';
import {
  instancePin,
  parentLevel,
  peerLabel,
  pinKey,
} from '../../services/systemDiagram/diff/pinPeers';
import { CHANGE_KINDS } from './changeSummary';
import { segmentOwners, segmentSlave, segmentTextOwner, type SegmentOwners } from './changeTargets';
import { boundaryId, parseBoundaryId } from './model';
import { NO_GHOSTS, type Ghosts } from './layout/unionGraph';

/**
 * The kinds of change a drawn block can have: those of a block of the current revision, and
 * `removed` for the ghost of a block that only the base has.
 */
export type MarkStatus = 'added' | 'changed' | 'renamed' | 'moved' | 'version' | 'removed';
/** `removed`: the ghost of a pin that only the base has, on a block that exists in both. */
export type PinMarkKind = 'added' | 'changed' | 'removed';

export interface BlockMarks {
  status?: MarkStatus;
  /** One line for a tooltip: `Added`, `Changed: 1 parameter, 2 pins`, ... Present with `status`. */
  title?: string;
  /** Outside-view pin name to its mark; only for a block with the status `changed`. */
  pins: Readonly<Record<string, PinMarkKind>>;
  /** Inside-view pin name to its mark (hierarchies). */
  insidePins?: Readonly<Record<string, PinMarkKind>>;
  /** Changes below the block: blocks at any depth with a status, plus the removed ones. Not its own inside pins. */
  inside: number;
}

export interface PortMarks {
  status: 'added' | 'changed' | 'removed';
  title: string;
}

export interface ChangeMarks {
  /** The blocks of the current graph with a status or with changes below them, and the ghosts that are shown. */
  blocks: ReadonlyMap<string, BlockMarks>;
  /** The external ports of `/` that are added or changed, and the ghosts of the removed ones that are shown. */
  ports: ReadonlyMap<string, PortMarks>;
  /** Level path to the number of instances and external ports of that level that only the base has. */
  removed: ReadonlyMap<string, number>;
  /** Pin key (`gainKey`) to the labels of the peers the pin gained. */
  gained: ReadonlyMap<string, ReadonlySet<string>>;
  /** Who a segment text names, for a removed segment (see `segmentOwners`). */
  owners: SegmentOwners;
  /** The ids of the nets only the base has whose ghosts are shown: their wires are drawn removed. */
  removedNets: ReadonlySet<string>;
}

/** A marked pin of a node; `inside`: the mark is of the view from inside the hierarchy (a frame's pin). */
export interface PinChangeMark {
  kind: PinMarkKind;
  inside?: true;
}

/** The marks of one node, in its data. */
export interface NodeChange {
  status?: MarkStatus;
  title?: string;
  /** Changes below a hierarchy block, shown when above 0. */
  inside?: number;
  /** Marked pins by pin name (instances and frames). */
  pins?: Readonly<Record<string, PinChangeMark>>;
}

/** Tooltips of a marked pin. */
export const PIN_TITLES = {
  added: 'New pin',
  removed: 'Removed pin',
  changed: 'Connection changed',
  addedInside: 'New pin inside',
  changedInside: 'Connection inside changed',
} as const;

const KINDS = Object.fromEntries(CHANGE_KINDS.map((kind) => [kind.key, kind])) as Record<
  string,
  (typeof CHANGE_KINDS)[number]
>;

/** The attributes that draw a marked pin label: its kind of change and the tooltip. Nothing for an unmarked pin. */
export function pinChangeAttributes(mark: PinChangeMark | undefined): {
  'data-change'?: PinMarkKind;
  title?: string;
} {
  return mark
    ? {
        'data-change': mark.kind,
        title:
          mark.kind === 'removed'
            ? PIN_TITLES.removed
            : PIN_TITLES[mark.inside ? (`${mark.kind}Inside` as const) : mark.kind],
      }
    : {};
}

/** The sign of a status (`+`, `~`, `→`, `»`, `v`), as the Changes tab writes it. */
export const markSign = (status: MarkStatus): string => KINDS[status].sign;
/** The name of a status (`Added`, `Changed`, `Renamed`, `Moved`, `Version only`). */
export const markName = (status: MarkStatus): string => KINDS[status].chip;
/** The label of the count of changes below a hierarchy block. */
export const insideLabel = (count: number): string =>
  `${count} ${count === 1 ? 'change' : 'changes'} inside`;

const plural = (count: number, one: string): string => `${count} ${one}${count === 1 ? '' : 's'}`;
const lastName = (path: string): string => path.slice(path.lastIndexOf('/') + 1);
const lowerFirst = (text: string): string => text.charAt(0).toLowerCase() + text.slice(1);

/** The key of the gained peers of a pin: an instance pin by path, a boundary pin by its level. */
export function gainKey(level: string, end: { instance: string | null; pin: string }): string {
  return pinKey({ instance: end.instance, level, pin: end.pin });
}

/** An end of a drawn wire: a pin of an instance, or a boundary pin of the wire's level (`instance: null`). */
export interface WireEnd {
  instance: string | null;
  pin: string;
}

/**
 * How the diff writes a peer when it reports a pin of `level`: `name/pin` for an instance of
 * that level, `pin` for its boundary pin, else absolute.
 */
export function wireEndLabel(level: string, end: WireEnd): string {
  return peerLabel(
    end.instance !== null
      ? instancePin(end.instance, end.pin)
      : { instance: null, level, pin: end.pin },
    level
  );
}

function blockTitle(change: SystemGraphDiff['instances'][number]): string {
  switch (change.status) {
    case 'added':
      return markName('added');
    case 'renamed':
      return `${markName('renamed')} from ${lastName(change.basePath ?? change.path)}`;
    case 'moved':
      return `${markName('moved')} from ${movedFrom(change)}`;
    case 'version':
      return `${markName('version')}: ${change.baseType} → ${change.currentType}`;
    default: {
      const outside = change.pins.filter((pin) => !pin.inside).length;
      const inside = change.pins.length - outside;
      const parts = [
        change.baseType !== change.currentType && 'type',
        change.parameters.length > 0 && plural(change.parameters.length, 'parameter'),
        outside > 0 && plural(outside, 'pin'),
        inside > 0 && `${plural(inside, 'pin')} inside`,
      ].filter((part): part is string => part !== false);
      return parts.length > 0 ? `${markName('changed')}: ${parts.join(', ')}` : markName('changed');
    }
  }
}

/** The level a moved block was on: its old parent path. */
const movedFrom = (change: SystemGraphDiff['instances'][number]): string =>
  parentLevel(change.basePath ?? change.path);

/** The title of a version-only, renamed or moved block that an address change promoted to `changed`. */
function promotedTitle(change: SystemGraphDiff['instances'][number]): string {
  const what =
    change.status === 'renamed'
      ? `renamed from ${lastName(change.basePath ?? change.path)}`
      : change.status === 'moved'
        ? `moved from ${movedFrom(change)}`
        : `${change.baseType} → ${change.currentType}`;
  return `${markName('changed')}: ${what}`;
}

function portTitle(port: PortChange): string {
  if (port.status === 'added') {
    return markName('added');
  }
  const parts = [
    port.attributes.length > 0 && plural(port.attributes.length, 'attribute'),
    (port.gained !== undefined || port.lost !== undefined) && 'connections',
  ].filter((part): part is string => part !== false);
  return parts.length > 0 ? `${markName('changed')}: ${parts.join(', ')}` : markName('changed');
}

/** The peers a pin gained: all of them for a pin that is new, else the `gained` of the change. */
function gainedPeers(pin: PinChange): readonly string[] {
  return pin.status === 'added' ? (pin.currentPeers ?? []) : (pin.gained ?? []);
}

/** The changes below a hierarchy that is added are all new: the `+` says it, so no count is shown. */
export const shownInside = (block: BlockMarks | undefined): number =>
  block === undefined || block.status === 'added' ? 0 : block.inside;

/** The text a changed address segment adds to the title of its slave block. */
const SEGMENT_TITLES = {
  added: 'Address segment added',
  removed: 'Address segment removed',
  changed: 'Address changed',
} as const;

/** The proper ancestors of an instance path, nearest first: `/a/b/c` gives `/a/b`, `/a`. */
function ancestors(path: string): string[] {
  const result: string[] = [];
  for (let cut = path.lastIndexOf('/'); cut > 0; cut = path.lastIndexOf('/', cut - 1)) {
    result.push(path.slice(0, cut));
  }
  return result;
}

/** The pins of a changed block that exist in the current revision, by view. */
function pinMarks(pins: readonly PinChange[], inside: boolean): Record<string, PinMarkKind> {
  return Object.fromEntries(
    pins
      .filter((pin) => (pin.inside === true) === inside && pin.status !== 'removed')
      .map((pin) => [pin.pin, pin.status])
  );
}

/** The title of a ghost: a block, port or pin that only the base has. */
const GHOST_TITLE = 'Removed: only in the base';

/**
 * The marks of the whole design for `diff`, which `graph` is the current side of. The `ghosts`
 * that are shown (see `unionGraph.ts`) are marked removed: blocks and ports by their own mark,
 * pins that a block lacks as a pin mark of that block.
 */
export function buildChangeMarks(
  diff: SystemGraphDiff,
  graph: SystemGraph,
  ghosts: Ghosts = NO_GHOSTS
): ChangeMarks {
  const statuses = new Map<string, Omit<BlockMarks, 'inside'>>();
  /** The title a version-only, renamed or moved block takes when an address change promotes it. */
  const promotedTitles = new Map<string, string>();
  const inside = new Map<string, number>();
  const removed = new Map<string, number>();
  const gained = new Map<string, Set<string>>();
  const gain = (key: string, pin: PinChange) => {
    const peers = gainedPeers(pin);
    if (peers.length > 0) {
      gained.set(key, new Set(peers));
    }
  };

  for (const change of diff.instances) {
    if (change.status === 'removed') {
      removed.set(change.level, (removed.get(change.level) ?? 0) + 1);
    } else if (graph.instances[change.path]) {
      const withPins = change.status === 'changed' || change.status === 'moved';
      const insidePins = pinMarks(change.pins, true);
      statuses.set(change.path, {
        status: change.status,
        title: blockTitle(change),
        pins: withPins ? pinMarks(change.pins, false) : {},
        ...(withPins && Object.keys(insidePins).length > 0 && { insidePins }),
      });
      if (change.status === 'version' || change.status === 'renamed' || change.status === 'moved') {
        promotedTitles.set(change.path, promotedTitle(change));
      }
    }
    for (const pin of change.pins) {
      gain(
        gainKey(
          change.path,
          pin.inside ? { instance: null, pin: pin.pin } : { instance: change.path, pin: pin.pin }
        ),
        pin
      );
    }
  }

  // An address segment change marks its slave block, which counts once as a change below its ancestors.
  const marked = new Set(diff.instances.map((change) => change.path));
  const owners = segmentOwners(graph, diff);
  const segmentTitles = new Map<string, string[]>();
  for (const change of diff.segments) {
    const slave =
      change.status === 'removed'
        ? segmentTextOwner(owners, change.segment)
        : segmentSlave(graph, change.addressSpace, change.segment);
    if (slave === undefined || !graph.instances[slave]) {
      continue;
    }
    marked.add(slave);
    const titles = segmentTitles.get(slave) ?? [];
    if (!titles.includes(SEGMENT_TITLES[change.status])) {
      titles.push(SEGMENT_TITLES[change.status]);
    }
    segmentTitles.set(slave, titles);
  }
  for (const [slave, titles] of segmentTitles) {
    const known = statuses.get(slave);
    // Only the first text of a title is capitalized: `Address changed, address segment removed`.
    const [first = '', ...rest] = titles;
    const text = [first, ...rest.map(lowerFirst)].join(', ');
    // An address change makes a version-only, renamed or moved block a changed one.
    const promoted = promotedTitles.get(slave);
    const lead = promoted ?? known?.title ?? '';
    statuses.set(
      slave,
      known
        ? {
            ...known,
            ...(promoted !== undefined && { status: 'changed' as const }),
            title: `${lead}, ${lowerFirst(text)}`,
          }
        : { status: 'changed', title: text, pins: {} }
    );
  }
  for (const path of marked) {
    for (const above of ancestors(path)) {
      if (graph.instances[above]) {
        inside.set(above, (inside.get(above) ?? 0) + 1);
      }
    }
  }

  const ports = new Map<string, PortMarks>();
  for (const port of diff.ports) {
    if (port.status === 'removed') {
      removed.set('/', (removed.get('/') ?? 0) + 1);
    } else {
      ports.set(port.pin, { status: port.status, title: portTitle(port) });
      gain(gainKey('/', { instance: null, pin: port.pin }), port);
    }
  }

  for (const path of ghosts.instances) {
    statuses.set(path, { status: 'removed', title: GHOST_TITLE, pins: {} });
  }
  for (const [path, names] of ghosts.pins) {
    const known = statuses.get(path);
    statuses.set(path, {
      ...known,
      pins: {
        ...known?.pins,
        ...Object.fromEntries([...names].map((name) => [name, 'removed' as const])),
      },
    });
  }
  for (const id of ghosts.boundary) {
    const { level, pin } = parseBoundaryId(id);
    if (level === '/') {
      ports.set(pin, { status: 'removed', title: GHOST_TITLE });
    }
  }

  const blocks = new Map<string, BlockMarks>();
  for (const path of new Set([...statuses.keys(), ...inside.keys()])) {
    blocks.set(path, { pins: {}, ...statuses.get(path), inside: inside.get(path) ?? 0 });
  }
  return { blocks, ports, removed, gained, owners, removedNets: ghosts.nets };
}

/**
 * Whether the wire between `a` and `b` of the level `level` is new: a block at either end is
 * added, or the diff says a pin at one end gained the pin at the other.
 */
export function isNewWire(marks: ChangeMarks, level: string, a: WireEnd, b: WireEnd): boolean {
  const added = (end: WireEnd) =>
    end.instance !== null && marks.blocks.get(end.instance)?.status === 'added';
  const gains = (end: WireEnd, other: WireEnd) =>
    marks.gained.get(gainKey(level, end))?.has(wireEndLabel(level, other)) === true;
  return added(a) || added(b) || gains(a, b) || gains(b, a);
}

/**
 * The mark of a boundary pin of `level`: an external port of `/`, else the inside view of the
 * pin of the hierarchy that owns the level.
 */
export function boundaryMark(
  marks: ChangeMarks,
  level: string,
  pin: string
): { status: PinMarkKind; title: string } | undefined {
  if (level === '/') {
    return marks.ports.get(pin);
  }
  const kind = marks.blocks.get(level)?.insidePins?.[pin];
  return kind && kind !== 'removed'
    ? { status: kind, title: PIN_TITLES[`${kind}Inside`] }
    : undefined;
}

/** The ids of the nodes of `levelPath` that carry a mark: a block with a status or changes below it, an added or changed external port or boundary pin. */
export function markedNodeIds(marks: ChangeMarks, graph: SystemGraph, levelPath: string): string[] {
  const level = graph.levels[levelPath];
  return [
    ...(level?.instances ?? []).filter((path) => marks.blocks.has(path)),
    ...(level?.boundaryPins ?? [])
      .filter((pin) => boundaryMark(marks, levelPath, pin.name) !== undefined)
      .map((pin) => boundaryId(levelPath, pin.name)),
  ];
}
