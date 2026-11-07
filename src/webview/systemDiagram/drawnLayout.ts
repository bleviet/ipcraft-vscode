/**
 * What the canvas draws of a laid-out level. The layout always holds the wires
 * and the badges of the clock and reset nets, in the room the one layout
 * reserved for both; the canvas draws one of the two. This is the one place
 * that choice is made, so the wires, the badges, the legend, the pin
 * highlights and the clock decoration all agree.
 */

import type { HiddenLayers } from './layerFilter';
import type { DiagramFlowEdge, DiagramFlowNode, PinRow } from './layout/diagramTypes';
import { isClockOrReset } from './model';

export interface LaidOutElements {
  nodes: readonly DiagramFlowNode[];
  edges: readonly DiagramFlowEdge[];
}

/** The pin rows of a block without their badges; the same data when none has one. */
function withoutBadges<Data extends { west: PinRow[]; east: PinRow[] }>(data: Data): Data {
  const unbadged = (rows: PinRow[]) =>
    rows.some((row) => row.badge) ? rows.map((row) => ({ ...row, badge: undefined })) : rows;
  const west = unbadged(data.west);
  const east = unbadged(data.east);
  return west === data.west && east === data.east ? data : { ...data, west, east };
}

function withoutNodeBadges(node: DiagramFlowNode): DiagramFlowNode {
  switch (node.type) {
    case 'boundary':
      return node.data.badge ? { ...node, data: { ...node.data, badge: undefined } } : node;
    case 'instance': {
      const data = withoutBadges(node.data);
      return data === node.data ? node : { ...node, data };
    }
    case 'frame': {
      const data = withoutBadges(node.data);
      return data === node.data ? node : { ...node, data };
    }
  }
}

/**
 * The nodes and edges to draw. With the clock and reset wires drawn
 * (`drawClockReset`), their badges go; without, their wires go and the badges
 * stay. Nodes and edges that need no change are returned as they are.
 */
export function drawnLayout(layout: LaidOutElements, drawClockReset: boolean): LaidOutElements {
  return drawClockReset
    ? { nodes: layout.nodes.map(withoutNodeBadges), edges: layout.edges }
    : { nodes: layout.nodes, edges: layout.edges.filter((edge) => !isClockOrReset(edge.data)) };
}

/**
 * `layout` without the wires of the hidden legend categories (a bundle by its
 * category). Nodes are untouched, so no block moves; the same object when
 * nothing is hidden.
 */
export function withoutHiddenLayers(
  layout: LaidOutElements,
  hidden: HiddenLayers
): LaidOutElements {
  return hidden.size === 0
    ? layout
    : {
        nodes: layout.nodes,
        edges: layout.edges.filter((edge) => !hidden.has(edge.data.category)),
      };
}
