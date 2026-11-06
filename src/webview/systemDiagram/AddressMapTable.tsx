import React from 'react';
import type { SystemGraph } from '../../domain/systemGraph';
import { LineLink } from './LineLink';
import { levelSource, segmentLevel } from './sourceFile';
import { formatRange, groupHex } from './addressFormat';
import { segmentHigh, segmentRangeText } from './model';

interface AddressMapTableProps {
  graph: SystemGraph;
  onSelectInstance: (instancePath: string) => void;
  onReveal: (line: number, uri?: string) => void;
}

export function AddressMapTable({ graph, onSelectInstance, onReveal }: AddressMapTableProps) {
  if (graph.addressSegments.length === 0) {
    return <p className="p-3 opacity-70">No address segments are assigned in this design.</p>;
  }
  return (
    <table className="sd-table">
      <thead>
        <tr>
          <th>Address space</th>
          <th>Segment</th>
          <th>Base</th>
          <th>Range</th>
          <th>High</th>
          <th>Source</th>
        </tr>
      </thead>
      <tbody>
        {graph.addressSegments.map((segment) => (
          <tr
            key={`${segment.line}:${segment.segment}`}
            className="sd-clickable cursor-pointer"
            onClick={() => {
              if (graph.instances[segment.slaveInstance]) {
                onSelectInstance(segment.slaveInstance);
              }
            }}
          >
            <td>{segment.addressSpace || '-'}</td>
            <td>{segment.segment}</td>
            <td className="sd-num">{groupHex(segment.offset ?? 'auto')}</td>
            <td className="sd-num">
              {formatRange(segmentRangeText(segment, graph.source.format))}
            </td>
            <td className="sd-num">{groupHex(segmentHigh(segment) ?? '-')}</td>
            <td onClick={(event) => event.stopPropagation()}>
              <LineLink
                source={levelSource(graph, segmentLevel(graph, segment))}
                line={segment.line}
                onReveal={onReveal}
              />
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
