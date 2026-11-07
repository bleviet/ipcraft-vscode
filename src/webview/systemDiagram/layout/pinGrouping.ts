/**
 * Folding of numbered pin arrays (`M00_AXI`..`M27_AXI`, `In0`..`In15`) on one
 * side of an instance block into one row. Pure: no ELK, no React. A group
 * forms from {@link MIN_GROUP_SIZE} or more pins that share a stem, direction
 * and kind; the group is open (a header row, then its pins) or folded (one row).
 */

import type { SystemPin } from '../../../domain/systemGraph';

export const MIN_GROUP_SIZE = 4;

/** Which groups are open; a group is addressed by `portId(instancePath, groupId)`. */
export interface PinFolding {
  open: ReadonlySet<string>;
  /** Draw instance blocks as Arch cards (one port per side) instead of pin rows; see `archCard.ts`. */
  arch?: true;
}

export interface PinStem {
  prefix: string;
  /** The last run of digits, as written. */
  digits: string;
  /** What follows the digits; it holds no digit. */
  suffix: string;
}

/** A foldable pin array, its members in index order. */
export interface PinGroup {
  /** Never a pin name and free of `::`: it is an ELK port name and a React Flow handle id. */
  id: string;
  label: string;
  members: SystemPin[];
}

/** One row of a block side: a pin, a folded group, or the header of an open group. */
export type SideRow =
  | { kind: 'pin'; pin: SystemPin }
  | { kind: 'folded'; group: PinGroup }
  | { kind: 'header'; group: PinGroup };

/** Splits a pin name at its last run of digits; undefined for a name without digits. */
export function pinStem(name: string): PinStem | undefined {
  const match = /^(.*?)(\d+)(\D*)$/.exec(name);
  return match ? { prefix: match[1], digits: match[2], suffix: match[3] } : undefined;
}

/** Name of a row: the pin name, or the id of its group. */
export function rowName(row: SideRow): string {
  return row.kind === 'pin' ? row.pin.name : row.group.id;
}

function groupId(stem: PinStem, pin: SystemPin): string {
  return `${stem.prefix}*${stem.suffix}|${pin.direction}|${pin.isInterface ? 'i' : 's'}`;
}

/** `M00..M27_AXI [28]`: first and last index as written. */
export function groupLabel(first: PinStem, last: PinStem, count: number): string {
  return `${first.prefix}${first.digits}..${last.prefix}${last.digits}${last.suffix} [${count}]`;
}

interface Candidate {
  pin: SystemPin;
  stem: PinStem;
  position: number;
}

/**
 * The rows of one side, in pin order. A group takes the position of its first
 * member; `excluded` pins and arrays below the threshold stay single rows.
 */
export function foldSide(
  pins: readonly SystemPin[],
  excluded: (pin: SystemPin) => boolean,
  isOpen: (groupId: string) => boolean
): SideRow[] {
  const byGroup = new Map<string, Candidate[]>();
  pins.forEach((pin, position) => {
    const stem = excluded(pin) ? undefined : pinStem(pin.name);
    if (stem) {
      const id = groupId(stem, pin);
      byGroup.set(id, [...(byGroup.get(id) ?? []), { pin, stem, position }]);
    }
  });
  const rows: SideRow[] = [];
  const placed = new Set<string>();
  for (const pin of pins) {
    const stem = excluded(pin) ? undefined : pinStem(pin.name);
    const id = stem && groupId(stem, pin);
    const candidates = id === undefined ? undefined : byGroup.get(id);
    if (id === undefined || !candidates || candidates.length < MIN_GROUP_SIZE) {
      rows.push({ kind: 'pin', pin });
    } else if (!placed.has(id)) {
      placed.add(id);
      const ordered = [...candidates].sort(
        (a, b) => Number(a.stem.digits) - Number(b.stem.digits) || a.position - b.position
      );
      const group: PinGroup = {
        id,
        label: groupLabel(ordered[0].stem, ordered[ordered.length - 1].stem, ordered.length),
        members: ordered.map((candidate) => candidate.pin),
      };
      if (isOpen(id)) {
        rows.push(
          { kind: 'header', group },
          ...group.members.map((m) => ({ kind: 'pin' as const, pin: m }))
        );
      } else {
        rows.push({ kind: 'folded', group });
      }
    }
  }
  return rows;
}
