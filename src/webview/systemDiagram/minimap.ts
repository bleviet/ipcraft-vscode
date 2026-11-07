/** Pure minimap model: when it shows by default and the color of each block. */

import { boundaryMatchesQuery, matchesQuery } from './model';
import type { DiagramFlowNode } from './layout/diagramTypes';

/** The minimap shows by default on a level with more nodes than this. */
export const MINIMAP_NODE_THRESHOLD = 15;

export const MINIMAP_COLORS = {
  block: 'var(--vscode-editorWidget-border, var(--vscode-panel-border))',
  hierarchy: 'color-mix(in srgb, var(--vscode-charts-green) 55%, transparent)',
  selected: 'var(--vscode-focusBorder)',
  match: 'var(--vscode-editorWarning-foreground)',
};

/** Whether the minimap shows: the user's `choice`, else by the size of the level. */
export function minimapShown(choice: boolean | undefined, nodeCount: number): boolean {
  return choice ?? nodeCount > MINIMAP_NODE_THRESHOLD;
}

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
