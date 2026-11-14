/** Pure minimap model: the color of each block. The minimap is drawn only, never a layout input. */

import { boundaryMatchesQuery, matchesQuery } from './model';
import type { DiagramFlowNode } from './layout/diagramTypes';
import type { TextMatcher } from './searchMatcher';

export const MINIMAP_COLORS = {
  block: 'color-mix(in srgb, var(--vscode-foreground) 35%, transparent)',
  hierarchy: 'color-mix(in srgb, var(--vscode-charts-green) 55%, transparent)',
  selected: 'var(--vscode-focusBorder)',
  match: 'var(--vscode-editorWarning-foreground)',
  /** A block marked by a comparison, by kind (the colors of the Changes tab). */
  added: 'var(--sd-change-added)',
  removed: 'var(--sd-change-removed)',
  changed: 'var(--sd-change-changed)',
  renamed: 'var(--sd-change-renamed)',
  moved: 'var(--sd-change-renamed)',
  version: 'var(--sd-change-version)',
};

type MinimapNode = DiagramFlowNode & { selected?: boolean };

/** Fill of a block on the minimap: selected, else a search match, else its kind of change, else a hierarchy tint, else plain. */
export function minimapColor(node: MinimapNode, matcher: TextMatcher | null): string {
  if (node.selected) {
    return MINIMAP_COLORS.selected;
  }
  if (matcher) {
    const matches =
      node.type === 'boundary'
        ? boundaryMatchesQuery(node.data.pin, matcher)
        : matchesQuery(node.data.instance, matcher);
    if (matches) {
      return MINIMAP_COLORS.match;
    }
  }
  const status = node.data.change?.status;
  if (status) {
    return MINIMAP_COLORS[status];
  }
  const hierarchy =
    node.type === 'frame' || (node.type === 'instance' && node.data.instance.kind === 'hier');
  return hierarchy ? MINIMAP_COLORS.hierarchy : MINIMAP_COLORS.block;
}
