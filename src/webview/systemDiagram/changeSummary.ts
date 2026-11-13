/** Pure texts of the Changes tab and the toolbar's comparison control. */

import type { DiffSummary, SystemGraphDiff } from '../../domain/systemGraphDiff';
import type { ChangeRow, ChangeSign } from '../../services/systemDiagram/diff/changeRows';

const plural = (count: number, one: string, many = `${one}s`): string =>
  `${count} ${count === 1 ? one : many}`;

/** `3 blocks, 1 port and 2 address segments differ.`; the empty diff says so. */
export function changeSummaryText(diff: SystemGraphDiff): string {
  const parts = [
    diff.instances.length > 0 && plural(diff.instances.length, 'block'),
    diff.ports.length > 0 && plural(diff.ports.length, 'port'),
    diff.segments.length > 0 && plural(diff.segments.length, 'address segment'),
  ].filter((part): part is string => part !== false);
  if (parts.length === 0) {
    return 'No changes.';
  }
  const list =
    parts.length === 1 ? parts[0] : `${parts.slice(0, -1).join(', ')} and ${parts.at(-1)}`;
  return `${list} ${parts.length === 1 && diff.instances.length + diff.ports.length + diff.segments.length === 1 ? 'differs' : 'differ'}.`;
}

/**
 * The kinds of change, in display order: the sign of a row, its count in the summary, the
 * word of the badge (`+ Added`) and the name of the filter chip, which is also the accessible
 * name of the toolbar count (`2 version only`).
 */
export const CHANGE_KINDS: readonly {
  sign: ChangeSign;
  key: keyof DiffSummary;
  badge: string;
  chip: string;
  /** What the kind means; the title of its chip. */
  meaning: string;
}[] = [
  { sign: '+', key: 'added', badge: 'Added', chip: 'Added', meaning: 'Only in current' },
  { sign: '−', key: 'removed', badge: 'Removed', chip: 'Removed', meaning: 'Only in base' },
  {
    sign: '~',
    key: 'changed',
    badge: 'Changed',
    chip: 'Changed',
    meaning: 'In both, but different',
  },
  {
    sign: 'v',
    key: 'version',
    badge: 'Version',
    chip: 'Version only',
    meaning: 'Only the IP version differs',
  },
];

/** The word of the badge of a change row's sign. */
export const SIGN_LABELS = Object.fromEntries(
  CHANGE_KINDS.map(({ sign, badge }) => [sign, badge])
) as Record<ChangeSign, string>;

/** Where a row sits: the tab's `Where` column. */
export function changeWhere(row: ChangeRow): string {
  return row.section === 'address'
    ? 'Address map'
    : row.section === 'port'
      ? 'External ports'
      : (row.level ?? '');
}

/** What an address row says about its segment, from the sign. */
export const addressChangeWord = (sign: ChangeSign): string =>
  sign === '+' ? 'added' : sign === '−' ? 'removed' : 'address changed';

/** Shown in the Changes tab when the two sides are files of different formats. */
export const FORMATS_DIFFER_NOTE = 'Different formats: only what both describe is comparable.';
