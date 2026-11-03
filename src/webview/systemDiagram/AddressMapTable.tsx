import React from 'react';
import type { SystemGraph } from '../../domain/systemGraph';
import { LineLink } from './LineLink';
import { segmentHigh } from './model';

interface AddressMapTableProps {
  graph: SystemGraph;
  onSelectInstance: (instancePath: string) => void;
  onReveal: (line: number) => void;
}

export function AddressMapTable({ graph, onSelectInstance, onReveal }: AddressMapTableProps) {
  if (graph.addressSegments.length === 0) {
    return <p className="p-3 opacity-70">No address segments are assigned in this script.</p>;
  }
  return (
    <table className="w-full text-left">
      <thead>
        <tr>
          <th className="px-2">Address space</th>
          <th className="px-2">Segment</th>
          <th className="px-2">Base</th>
          <th className="px-2">Range</th>
          <th className="px-2">High</th>
          <th className="px-2">Line</th>
        </tr>
      </thead>
      <tbody>
        {graph.addressSegments.map((segment) => (
          <tr
            key={`${segment.line}:${segment.segment}`}
            className="sd-row cursor-pointer"
            onClick={() => {
              if (graph.instances[segment.slaveInstance]) {
                onSelectInstance(segment.slaveInstance);
              }
            }}
          >
            <td className="px-2">{segment.addressSpace || '-'}</td>
            <td className="px-2">{segment.segment}</td>
            <td className="px-2">{segment.offset ?? 'auto'}</td>
            <td className="px-2">{segment.range ?? 'auto'}</td>
            <td className="px-2">{segmentHigh(segment) ?? '-'}</td>
            <td className="px-2" onClick={(event) => event.stopPropagation()}>
              <LineLink fileName={graph.source.fileName} line={segment.line} onReveal={onReveal} />
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
