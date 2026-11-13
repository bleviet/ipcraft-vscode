/** Pure row texts of the bottom-panel tables: what the panel's filter box matches a row against. */

import type { AddressSegment, SystemGraph } from '../../domain/systemGraph';
import { cellText, type ChangeRow } from '../../services/systemDiagram/diff/changeRows';
import { formatRange, groupHex } from './addressFormat';
import { addressChangeWord, changeWhere, SIGN_LABELS } from './changeSummary';
import type { ClockDomain, PinCrossing, ResetSource } from './clocks/clockTypes';
import { crossingKind, crossingProblem } from './clocks/crossingRows';
import { formatHz } from './clocks/frequency';
import { segmentHigh, segmentRangeText } from './model';
import type { TextMatcher } from './searchMatcher';
import { findingRow, type UnconnectedPin } from './unconnectedPins';

/** Shown in place of a table whose rows the filter all hides. */
export const NO_FILTER_MATCH = 'No rows match the filter.';

type RowTexts = readonly (string | undefined)[];

/** `rows` whose texts the filter matches in any cell; all of them without a filter. */
export function filterRows<T>(
  rows: readonly T[],
  filter: TextMatcher | null,
  texts: (row: T) => RowTexts
): readonly T[] {
  return filter
    ? rows.filter((row) => texts(row).some((text) => text !== undefined && filter(text)))
    : rows;
}

/** Addresses match as written in the design and as the table groups them. */
export function segmentTexts(graph: SystemGraph, segment: AddressSegment): RowTexts {
  const range = segmentRangeText(segment, graph.source.format);
  const high = segmentHigh(segment);
  return [
    segment.addressSpace,
    segment.segment,
    segment.offset,
    segment.offset && groupHex(segment.offset),
    range,
    formatRange(range),
    high,
    high && groupHex(high),
  ];
}

export function domainTexts(domain: ClockDomain): RowTexts {
  return [
    domain.name,
    domain.hz === undefined ? undefined : formatHz(domain.hz),
    domain.label,
    domain.frequencyFrom?.text,
    domain.frequencyFrom?.kind,
  ];
}

export function resetTexts(reset: ResetSource): RowTexts {
  return [reset.label];
}

export function crossingTexts(crossing: PinCrossing): RowTexts {
  return [
    crossingKind(crossing),
    crossing.from.label,
    crossing.to.label,
    crossingProblem(crossing),
  ];
}

export function findingTexts(graph: SystemGraph, finding: UnconnectedPin): RowTexts {
  const row = findingRow(graph, finding);
  return [
    finding.pin.name,
    row.block,
    row.level,
    finding.pin.direction,
    row.type,
    row.knownFrom,
    finding.cls,
  ];
}

export function changeTexts(row: ChangeRow): RowTexts {
  return [
    SIGN_LABELS[row.sign],
    changeWhere(row),
    cellText(row.subject),
    cellText(row.change),
    row.section === 'address' ? addressChangeWord(row.sign) : undefined,
    cellText(row.base),
    cellText(row.current),
  ];
}
