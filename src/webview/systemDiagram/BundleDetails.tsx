import React from 'react';
import type { SystemGraph } from '../../domain/systemGraph';
import type { DiagramFlowEdge } from './layout/diagramTypes';
import { categoryLabel } from './legend';
import { parseBoundaryId, type Selection } from './model';

interface BundleDetailsProps {
  graph: SystemGraph;
  /** The drawn edge holding the bundle. */
  edge: DiagramFlowEdge;
  isolatable: (nodeIds: string[]) => boolean;
  /** Selects one net of the bundle. */
  onSelect: (selection: Selection) => void;
  onUnbundle: (key: string) => void;
  onIsolatePair: (a: string, b: string) => void;
}

/** Instance name, or boundary pin name, of a node of the level. */
function nodeName(graph: SystemGraph, nodeId: string): string {
  return graph.instances[nodeId]?.name ?? parseBoundaryId(nodeId).pin;
}

/** Details of a selected bus bundle: its member connections and the gestures on the pair. */
export function BundleDetails({
  graph,
  edge,
  isolatable,
  onSelect,
  onUnbundle,
  onIsolatePair,
}: BundleDetailsProps) {
  const bundle = edge.data.bundle;
  if (!bundle) {
    return null;
  }
  const pair: [string, string] = [edge.source, edge.target];
  const netName = (netId: string) => graph.nets.find((net) => net.id === netId)?.name ?? netId;
  return (
    <div className="space-y-3">
      <header>
        <div className="sd-eyebrow">Bus bundle</div>
        <h2 className="sd-h2">{`×${bundle.members.length} ${categoryLabel(edge.data.category)}`}</h2>
        <p className="opacity-70">
          from {nodeName(graph, edge.source)} to {nodeName(graph, edge.target)}
        </p>
      </header>
      <div className="flex gap-2">
        <button type="button" className="sd-tool" onClick={() => onUnbundle(bundle.key)}>
          Unbundle
        </button>
        <button
          type="button"
          className="sd-tool"
          disabled={!isolatable(pair)}
          onClick={() => onIsolatePair(...pair)}
        >
          Isolate pair
        </button>
      </div>
      <section>
        <h3 className="sd-h3">Connections</h3>
        <ul>
          {bundle.members.map((member) => (
            <li key={member.edgeId}>
              <button
                type="button"
                className="sd-link"
                title={netName(member.netId)}
                onClick={() => onSelect({ kind: 'net', id: member.netId })}
              >
                {member.sourcePin} → {member.targetPin}
              </button>{' '}
              <span className="opacity-70">{netName(member.netId)}</span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
