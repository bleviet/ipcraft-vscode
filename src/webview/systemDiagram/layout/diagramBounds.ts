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

/** Bounding box of one node: its box plus its net badges, which sit outside it. */
export function nodeBounds(node: DiagramFlowNode): DiagramBounds {
  const boxes = [
    { x: node.position.x, y: node.position.y, width: node.width, height: node.height },
    ...nodeBadges(node).map((badge) => ({
      x: node.position.x + badge.x,
      y: node.position.y + badge.y,
      width: badge.width,
      height: badge.height,
    })),
  ];
  const x = Math.min(...boxes.map((box) => box.x));
  const y = Math.min(...boxes.map((box) => box.y));
  return {
    x,
    y,
    width: Math.max(...boxes.map((box) => box.x + box.width)) - x,
    height: Math.max(...boxes.map((box) => box.y + box.height)) - y,
  };
}

/**
 * Bounding box of everything the layout holds for a level: node boxes, net
 * badges (which sit outside their node), and edge points. Null when the level
 * is empty.
 */
export function diagramBounds(layout: {
  nodes: readonly DiagramFlowNode[];
  edges: readonly DiagramFlowEdge[];
}): DiagramBounds | null {
  const xs: number[] = [];
  const ys: number[] = [];
  for (const node of layout.nodes) {
    const box = nodeBounds(node);
    xs.push(box.x, box.x + box.width);
    ys.push(box.y, box.y + box.height);
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
