import React from 'react';
import type { SystemGraph } from '../../domain/systemGraph';
import type { SystemGraphDiff } from '../../domain/systemGraphDiff';
import { CHANGE_SIGNS } from '../../services/systemDiagram/diff/changeRows';
import { addressMapRows, type AddressMapRow } from './addressMapRows';
import { LineLink } from './LineLink';
import { levelSource, segmentLevel } from './sourceFile';
import { formatRange, groupHex } from './addressFormat';
import { NOT_IN_REVISION } from './changeTargets';
import { segmentHigh, segmentRangeText } from './model';
import { filterRows, NO_FILTER_MATCH, segmentTexts } from './panelFilter';
import type { TextMatcher } from './searchMatcher';

interface AddressMapTableProps {
  graph: SystemGraph;
  /** While a comparison is on: what it changed, marked in the rows; removed segments follow the current ones. */
  diff?: SystemGraphDiff;
  /** The panel's filter: only the rows it matches are listed. Null without one. */
  filter: TextMatcher | null;
  onSelectInstance: (instancePath: string) => void;
  onReveal: (line: number, uri?: string) => void;
}

/** The attributes of a value cell the comparison marks as different from the base. */
const marked = (on: boolean | undefined, base: string | undefined) =>
  on ? { 'data-changed': 'true', title: `Base: ${base}` } : {};

export function AddressMapTable({
  graph,
  diff,
  filter,
  onSelectInstance,
  onReveal,
}: AddressMapTableProps) {
  const all = addressMapRows(graph, diff);
  if (all.length === 0) {
    return <p className="p-3 opacity-70">No address segments are assigned in this design.</p>;
  }
  const rows = filterRows(all, filter, (row) => segmentTexts(row.segment, row.format));
  if (rows.length === 0) {
    return <p className="p-3 opacity-70">{NO_FILTER_MATCH}</p>;
  }
  const renderRow = ({ segment, format, change, changedFields, baseShown }: AddressMapRow) => {
    const removed = change?.status === 'removed';
    const high = segmentHigh(segment);
    return (
      <tr
        key={
          removed
            ? `removed:${segment.addressSpace}:${segment.segment}`
            : `${segment.line}:${segment.segment}`
        }
        className={removed ? 'opacity-70' : 'sd-clickable cursor-pointer'}
        title={removed ? NOT_IN_REVISION : undefined}
        onClick={
          removed
            ? undefined
            : () => {
                if (graph.instances[segment.slaveInstance]) {
                  onSelectInstance(segment.slaveInstance);
                }
              }
        }
      >
        {diff && (
          <td>
            {change && (
              <span className="sd-sign" data-sign={CHANGE_SIGNS[change.status]}>
                {CHANGE_SIGNS[change.status]}
              </span>
            )}
          </td>
        )}
        <td>{segment.addressSpace || '-'}</td>
        <td>{segment.segment}</td>
        <td className="sd-num" {...marked(changedFields?.offset, baseShown?.offset)}>
          {groupHex(segment.offset ?? 'auto')}
        </td>
        <td className="sd-num" {...marked(changedFields?.range, baseShown?.range)}>
          {formatRange(segmentRangeText(segment, format))}
        </td>
        <td className="sd-num" {...marked(changedFields?.high, baseShown?.high)}>
          {groupHex(high ?? '-')}
        </td>
        <td onClick={(event) => event.stopPropagation()}>
          {segment.line === undefined ? (
            '-'
          ) : (
            <LineLink
              source={levelSource(graph, segmentLevel(graph, segment))}
              line={segment.line}
              onReveal={onReveal}
            />
          )}
        </td>
      </tr>
    );
  };
  return (
    <table className="sd-table">
      <thead>
        <tr>
          {diff && (
            <th>
              <span className="sr-only">Kind of change</span>
            </th>
          )}
          <th>Address space</th>
          <th>Segment</th>
          <th>Base</th>
          <th>Range</th>
          <th>High</th>
          <th>Source</th>
        </tr>
      </thead>
      <tbody>{rows.map(renderRow)}</tbody>
    </table>
  );
}
