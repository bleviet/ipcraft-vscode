import React from 'react';
import type { SystemGraph } from '../../domain/systemGraph';
import { hopNetIds, hopSummary, nodeName, traceNote, type PathTrace } from './pathTrace';

interface PathTableProps {
  graph: SystemGraph;
  trace: PathTrace;
  /** Selects the nets of one hop. */
  onSelectNets: (netIds: string[]) => void;
}

/** Bottom-panel list of the hops of the traced path; a row selects the nets of its hop. */
export function PathTable({ graph, trace, onSelectNets }: PathTableProps) {
  return (
    <div>
      <p className="p-1 opacity-70">{traceNote(trace)}</p>
      <table className="sd-table">
        <thead>
          <tr>
            <th>#</th>
            <th>From</th>
            <th>To</th>
            <th>Connections</th>
          </tr>
        </thead>
        <tbody>
          {trace.hops.map((hop, index) => (
            <tr
              key={`${hop.from}>${hop.to}`}
              className="sd-clickable cursor-pointer"
              onClick={() => onSelectNets(hopNetIds(hop))}
            >
              <td>{index + 1}</td>
              <td>{nodeName(graph, hop.from)}</td>
              <td>{nodeName(graph, hop.to)}</td>
              <td>{hopSummary(hop)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
