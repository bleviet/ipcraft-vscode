/** Pure minimap model: the color of each block. The minimap is drawn only, never a layout input. */

import { boundaryMatchesQuery, matchesQuery } from './model';
import type { DiagramFlowNode } from './layout/diagramTypes';

export const MINIMAP_COLORS = {
  block: 'color-mix(in srgb, var(--vscode-foreground) 35%, transparent)',
  hierarchy: 'color-mix(in srgb, var(--vscode-charts-green) 55%, transparent)',
  selected: 'var(--vscode-focusBorder)',
  match: 'var(--vscode-editorWarning-foreground)',
};

type MinimapNode = DiagramFlowNode & { selected?: boolean };

/** Fill of a block on the minimap: selected, else a search match, else a hierarchy tint, else plain. */
export function minimapColor(node: MinimapNode, query: string): string {
  if (node.selected) {
    return MINIMAP_COLORS.selected;
  }
  if (query.trim() !== '') {
    const matches =
      node.type === 'boundary'
        ? boundaryMatchesQuery(node.data.pin, query)
        : matchesQuery(node.data.instance, query);
    if (matches) {
      return MINIMAP_COLORS.match;
    }
  }
  const hierarchy =
    node.type === 'frame' || (node.type === 'instance' && node.data.instance.kind === 'hier');
  return hierarchy ? MINIMAP_COLORS.hierarchy : MINIMAP_COLORS.block;
}
