/**
 * Left-to-right order of a traced path. ELK partitions put the nodes of the
 * path in layers by hop index, even against the edge direction. A boundary
 * node under partitioning must not keep a FIRST / LAST layer constraint (ELK
 * throws), so on a trace it gets the partition only.
 */

import type { ElkNode } from 'elkjs/lib/elk-api';
import type { DiagramFlowNode } from './diagramTypes';

export const PARTITIONING_ON = { 'elk.partitioning.activate': 'true' };

/** The ELK nodes with the partition of their hop index; nodes off the path are left as they are. */
export function withPartitions(children: ElkNode[], order: readonly string[]): ElkNode[] {
  return children.map((child) => {
    const index = order.indexOf(child.id);
    return index < 0
      ? child
      : {
          ...child,
          layoutOptions: { ...child.layoutOptions, 'elk.partitioning.partition': String(index) },
        };
  });
}

/** The flow nodes (frames too) with the 1-based `hopIndex` badge of a trace; nodes off the path are left as they are. */
export function withHopIndexes(
  nodes: DiagramFlowNode[],
  order: readonly string[] | undefined
): DiagramFlowNode[] {
  if (order === undefined) {
    return nodes;
  }
  return nodes.map((node) => {
    const index = order.indexOf(node.id);
    return index < 0
      ? node
      : ({ ...node, data: { ...node.data, hopIndex: index + 1 } } as DiagramFlowNode);
  });
}
