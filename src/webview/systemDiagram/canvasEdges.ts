/** The wires of the canvas: the drawn edges with their selection, clock decoration and highlight color. Pure. */

import type { HighlightMap } from '../../shared/messages/systemDiagram';
import type { ClockDecor } from './clockDecor';
import { edgeNetIds } from './edgeNets';
import { netHighlightColor } from './highlights';
import type { DiagramFlowEdge } from './layout/diagramTypes';
import type { Selection } from './model';

export interface EdgeDecorContext {
  decor: ClockDecor;
  selection: Selection | null;
  /** Nets drawn selected (the selected nets, or the primary one). */
  selectedNetIds: ReadonlySet<string>;
  /** Highlight colors are shown (they are not while the review is on). */
  showHighlights: boolean;
  highlights?: HighlightMap;
}

export function decoratedEdges(
  edges: readonly DiagramFlowEdge[],
  { decor, selection, selectedNetIds, showHighlights, highlights }: EdgeDecorContext
): (DiagramFlowEdge & { selected: boolean })[] {
  const { tree } = decor;
  return edges.map((edge) => {
    const marks = decor.edges.get(edge.id);
    const netIds = edgeNetIds(edge);
    const highlightColor =
      showHighlights && highlights
        ? netIds
            .map((netId) => netHighlightColor(highlights, netId))
            .find((color) => color !== undefined)
        : undefined;
    return {
      ...edge,
      selected: netIds.some(
        (netId) =>
          selectedNetIds.has(netId) ||
          (selection?.kind === 'net' && (tree ? tree.netIds.has(netId) : selection.id === netId))
      ),
      ...((marks !== undefined || highlightColor !== undefined) && {
        data: {
          ...edge.data,
          ...marks,
          ...(highlightColor !== undefined && { highlightColor }),
        },
      }),
    };
  });
}
