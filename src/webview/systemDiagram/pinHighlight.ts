/** Pure lookup of the pins on a selected net, per node, for bold pin labels. */

import { edgeNetIds } from './edgeNets';
import type { DiagramFlowEdge, DiagramFlowNode } from './layout/elkLayout';

/**
 * Pin names on net `netId` (or on any net of a set, such as a clock tree),
 * keyed by node id: the endpoints of its drawn wires, plus pins that only show
 * it as a clock or reset badge.
 */
export function highlightedPinsByNode(
  netId: string | ReadonlySet<string>,
  edges: readonly DiagramFlowEdge[],
  nodes: readonly DiagramFlowNode[]
): Map<string, Set<string>> {
  const onNet = (id: string) => (typeof netId === 'string' ? id === netId : netId.has(id));
  const pins = new Map<string, Set<string>>();
  const add = (nodeId: string, pinName: string) => {
    const set = pins.get(nodeId) ?? new Set<string>();
    set.add(pinName);
    pins.set(nodeId, set);
  };
  for (const edge of edges) {
    if (edge.data.bundle) {
      for (const member of edge.data.bundle.members.filter((m) => onNet(m.netId))) {
        add(edge.source, member.sourceHandle);
        add(edge.target, member.targetHandle);
      }
    } else if (edgeNetIds(edge).some(onNet)) {
      add(edge.source, edge.sourceHandle);
      add(edge.target, edge.targetHandle);
    }
  }
  for (const node of nodes) {
    if (node.type === 'boundary') {
      if (node.data.badge?.nets.some((net) => onNet(net.id))) {
        add(node.id, node.data.pin.name);
      }
    } else {
      for (const row of [...node.data.west, ...node.data.east]) {
        if (row.badge?.nets.some((net) => onNet(net.id))) {
          add(node.id, row.name);
        }
      }
    }
  }
  return pins;
}
