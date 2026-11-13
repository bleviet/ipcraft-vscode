/** Pure rows of the Address map tab: the current segments, and while comparing, the marks of the diff. */

import type { AddressSegment, SystemGraph } from '../../domain/systemGraph';
import type { SegmentChange, SystemGraphDiff } from '../../domain/systemGraphDiff';
import { formatRange, groupHex } from './addressFormat';
import { segmentHigh, segmentRangeText } from './model';

/** What the table reads of a segment; a removed one has no block and no line in the current file. */
export type SegmentFields = Pick<
  AddressSegment,
  'addressSpace' | 'segment' | 'masterInstance' | 'slaveInstance' | 'offset' | 'range'
> & { line?: number };

export interface AddressMapRow {
  segment: SegmentFields;
  /** The format the segment's range is spelled in: the graph's, or the base's for a removed one. */
  format: SystemGraph['source']['format'];
  change?: SegmentChange;
  /** A `changed` segment: the values that differ from the base, as `diffSegments` compares them; `high` the derived last address. */
  changedFields?: { offset: boolean; range: boolean; high: boolean };
  /** A `changed` segment: the base's cells as the table would show them, for the title of a marked cell. */
  baseShown?: { offset: string; range: string; high: string };
}

const SEPARATOR = '\u0000';
const key = (item: { addressSpace: string; segment: string }): string =>
  item.addressSpace + SEPARATOR + item.segment;
const differs = (base: string | undefined, current: string | undefined): boolean =>
  base?.toLowerCase() !== current?.toLowerCase();

const shown = (
  base: Pick<AddressSegment, 'offset' | 'range'>,
  format: SystemGraph['source']['format']
) => ({
  offset: groupHex(base.offset ?? 'auto'),
  range: formatRange(segmentRangeText(base, format)),
  high: groupHex(segmentHigh(base) ?? '-'),
});

/** The segments of `graph` in order; with `diff`, each carries its change, and the removed ones follow. */
export function addressMapRows(graph: SystemGraph, diff?: SystemGraphDiff): AddressMapRow[] {
  const format = graph.source.format;
  if (!diff) {
    return graph.addressSegments.map((segment) => ({ segment, format }));
  }
  const changes = new Map(
    diff.segments
      .filter((change) => change.status !== 'removed')
      .map((change) => [key(change), change])
  );
  const current = graph.addressSegments.map((segment): AddressMapRow => {
    const change = changes.get(key(segment));
    if (!change) {
      return { segment, format };
    }
    return {
      segment,
      format,
      change,
      ...(change.status === 'changed' && {
        changedFields: {
          offset: differs(change.base?.offset, change.current?.offset),
          range: differs(change.base?.range, change.current?.range),
          high: differs(segmentHigh(change.base ?? {}), segmentHigh(change.current ?? {})),
        },
        baseShown: shown(change.base ?? {}, diff.base.format),
      }),
    };
  });
  const removed = diff.segments
    .filter((change) => change.status === 'removed')
    .map(
      (change): AddressMapRow => ({
        segment: {
          addressSpace: change.addressSpace,
          segment: change.segment,
          masterInstance: '',
          slaveInstance: '',
          offset: change.base?.offset,
          range: change.base?.range,
        },
        format: diff.base.format,
        change,
      })
    );
  return [...current, ...removed];
}
