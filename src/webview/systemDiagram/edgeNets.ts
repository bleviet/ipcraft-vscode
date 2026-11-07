/** The nets of a drawn wire: one, or every member of a bundle. The one place that reads them. */

import type { NetCategory } from '../../domain/systemGraph';
import type { DiagramFlowEdge } from './layout/diagramTypes';
import type { Selection } from './model';

interface NetsOfEdge {
  data: { netId: string; bundle?: { members: readonly { netId: string }[] } };
}

/** Ids of the nets a drawn edge stands for, each once. */
export function edgeNetIds(edge: NetsOfEdge): string[] {
  return edge.data.bundle
    ? [...new Set(edge.data.bundle.members.map((member) => member.netId))]
    : [edge.data.netId];
}

/** One drawn connection of an edge, shaped for the clock analysis: the edge itself, or a bundle member. */
export interface MemberEdge {
  id: string;
  data: { netId: string; category: NetCategory };
}

export function memberEdges(
  edge: Pick<DiagramFlowEdge, 'id'> & {
    data: {
      netId: string;
      category: NetCategory;
      bundle?: { members: readonly { edgeId: string; netId: string }[] };
    };
  }
): MemberEdge[] {
  const { category, bundle } = edge.data;
  return bundle
    ? bundle.members.map((member) => ({
        id: member.edgeId,
        data: { netId: member.netId, category },
      }))
    : [{ id: edge.id, data: { netId: edge.data.netId, category } }];
}

/**
 * The drawn bundle `activeKey` (the one the user clicked), when the selected
 * items are exactly its member nets. Bundles can share a net set, so the key,
 * not the nets, says which one Details shows; a stale key fails the equality.
 */
export function bundleOfSelection(
  edges: readonly DiagramFlowEdge[],
  items: readonly Selection[],
  activeKey: string | null
): DiagramFlowEdge | undefined {
  const edge = edges.find((candidate) => candidate.data.bundle?.key === activeKey);
  if (!edge || items.length === 0 || items.some((item) => item.kind !== 'net')) {
    return undefined;
  }
  const selected = new Set(items.map((item) => item.id));
  const nets = edgeNetIds(edge);
  return nets.length === selected.size && nets.every((id) => selected.has(id)) ? edge : undefined;
}
