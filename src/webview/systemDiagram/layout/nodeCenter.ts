import type { DiagramFlowNode } from './elkLayout';

/** Centre of the instance or boundary node with `nodeId`, in flow coordinates. */
export function nodeCenter(
  layout: { nodes: readonly DiagramFlowNode[] },
  nodeId: string
): { x: number; y: number } | null {
  const node = layout.nodes.find((candidate) => candidate.id === nodeId);
  return node
    ? { x: node.position.x + node.width / 2, y: node.position.y + node.height / 2 }
    : null;
}
