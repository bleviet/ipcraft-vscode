import type { DiagramFlowEdge, DiagramFlowNode } from './elkLayout';
import type { NetBadge } from './netBadges';

export interface DiagramBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

function nodeBadges(node: DiagramFlowNode): NetBadge[] {
  if (node.type === 'boundary') {
    return node.data.badge ? [node.data.badge] : [];
  }
  return [...node.data.west, ...node.data.east].flatMap((row) => (row.badge ? [row.badge] : []));
}

/**
 * Bounding box of everything drawn for a level: node boxes, net badges (which
 * sit outside their node), and edge points. Null when the level is empty.
 */
export function diagramBounds(layout: {
  nodes: readonly DiagramFlowNode[];
  edges: readonly DiagramFlowEdge[];
}): DiagramBounds | null {
  const xs: number[] = [];
  const ys: number[] = [];
  const addBox = (x: number, y: number, width: number, height: number) => {
    xs.push(x, x + width);
    ys.push(y, y + height);
  };
  for (const node of layout.nodes) {
    addBox(node.position.x, node.position.y, node.width, node.height);
    for (const badge of nodeBadges(node)) {
      addBox(node.position.x + badge.x, node.position.y + badge.y, badge.width, badge.height);
    }
  }
  for (const edge of layout.edges) {
    for (const point of edge.data.points) {
      xs.push(point.x);
      ys.push(point.y);
    }
  }
  if (xs.length === 0) {
    return null;
  }
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y };
}
