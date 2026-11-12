import type { AddressSegment, SystemGraph } from '../../../domain/systemGraph';
import type { SegmentChange, SegmentValues } from '../../../domain/systemGraphDiff';
import { compareText } from './compareText';

const SEPARATOR = '\u0000';

function valuesOf(segment: AddressSegment): SegmentValues {
  return {
    ...(segment.offset !== undefined && { offset: segment.offset }),
    ...(segment.range !== undefined && { range: segment.range }),
  };
}

const lower = (text: string | undefined): string | undefined => text?.toLowerCase();

/** Address segment changes, sorted by address space, then segment. */
export function diffSegments(base: SystemGraph, current: SystemGraph): SegmentChange[] {
  const index = (graph: SystemGraph): Map<string, AddressSegment> =>
    new Map(graph.addressSegments.map((s) => [s.addressSpace + SEPARATOR + s.segment, s]));
  const [baseIndex, currentIndex] = [index(base), index(current)];
  const changes: SegmentChange[] = [];
  for (const key of new Set([...baseIndex.keys(), ...currentIndex.keys()])) {
    const [b, c] = [baseIndex.get(key), currentIndex.get(key)];
    const owner = (c ?? b) as AddressSegment;
    const identity = { addressSpace: owner.addressSpace, segment: owner.segment };
    if (!c) {
      changes.push({ ...identity, status: 'removed', base: valuesOf(owner) });
    } else if (!b) {
      changes.push({ ...identity, status: 'added', current: valuesOf(owner) });
    } else if (lower(b.offset) !== lower(c.offset) || lower(b.range) !== lower(c.range)) {
      changes.push({ ...identity, status: 'changed', base: valuesOf(b), current: valuesOf(c) });
    }
  }
  return changes.sort(
    (x, y) => compareText(x.addressSpace, y.addressSpace) || compareText(x.segment, y.segment)
  );
}
