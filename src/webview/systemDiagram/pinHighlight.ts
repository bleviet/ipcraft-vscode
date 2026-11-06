/** Pure lookup of the pins on a selected net, per node, for bold pin labels. */

import type { DiagramFlowEdge, DiagramFlowNode } from './layout/elkLayout';

/**
 * Pin names on net `netId`, keyed by node id: the endpoints of its drawn wires,
 * plus pins that only show it as a clock or reset badge.
 */
export function highlightedPinsByNode(
  netId: string,
  edges: readonly DiagramFlowEdge[],
  nodes: readonly DiagramFlowNode[]
): Map<string, Set<string>> {
  const pins = new Map<string, Set<string>>();
  const add = (nodeId: string, pinName: string) => {
    const set = pins.get(nodeId) ?? new Set<string>();
    set.add(pinName);
    pins.set(nodeId, set);
  };
  for (const edge of edges) {
    if (edge.data.netId === netId) {
      add(edge.source, edge.sourceHandle);
      add(edge.target, edge.targetHandle);
    }
  }
  for (const node of nodes) {
    if (node.type === 'boundary') {
      if (node.data.badge?.nets.some((net) => net.id === netId)) {
        add(node.id, node.data.pin.name);
      }
    } else {
      for (const row of [...node.data.west, ...node.data.east]) {
        if (row.badge?.nets.some((net) => net.id === netId)) {
          add(node.id, row.name);
        }
      }
    }
  }
  return pins;
}
