/**
 * Pure color-highlight helpers over a {@link SystemGraph} and {@link HighlightMap}.
 * Highlights are keyed by `${selection.kind}:${selection.id}`.
 */

import type { SystemGraph } from '../../domain/systemGraph';
import type { HighlightColor, HighlightMap } from '../../shared/messages/systemDiagram';
import { nodeSelection, selectionExists, type Selection } from './model';

export interface HighlightSwatch {
  id: HighlightColor;
  label: string;
  css: string;
}

export const HIGHLIGHT_COLORS: readonly HighlightSwatch[] = [
  { id: 'red', label: 'Red', css: 'var(--vscode-charts-red)' },
  { id: 'orange', label: 'Orange', css: 'var(--vscode-charts-orange)' },
  { id: 'yellow', label: 'Yellow', css: 'var(--vscode-charts-yellow)' },
  { id: 'green', label: 'Green', css: 'var(--vscode-charts-green)' },
  { id: 'cyan', label: 'Cyan', css: 'var(--vscode-terminal-ansiCyan)' },
  { id: 'magenta', label: 'Magenta', css: 'var(--vscode-terminal-ansiMagenta)' },
];

export function selectionKey(selection: Selection): string {
  return `${selection.kind}:${selection.id}`;
}

export function parseSelectionKey(key: string): Selection | undefined {
  const cut = key.indexOf(':');
  if (cut <= 0) {
    return undefined;
  }
  const kind = key.slice(0, cut);
  const id = key.slice(cut + 1);
  if (id === '' || (kind !== 'instance' && kind !== 'boundary' && kind !== 'net')) {
    return undefined;
  }
  return { kind, id };
}

export function isHighlightColor(value: unknown): value is HighlightColor {
  return typeof value === 'string' && HIGHLIGHT_COLORS.some((swatch) => swatch.id === value);
}

export function highlightCss(color: HighlightColor | undefined): string | undefined {
  return color ? HIGHLIGHT_COLORS.find((swatch) => swatch.id === color)?.css : undefined;
}

export function pruneHighlights(graph: SystemGraph | undefined, raw: unknown): HighlightMap {
  if (!raw || typeof raw !== 'object') {
    return {};
  }
  const canCheckGraph = Boolean(graph?.instances && graph.levels && graph.nets);
  const result: HighlightMap = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    const sel = parseSelectionKey(key);
    if (!sel || !isHighlightColor(value)) {
      continue;
    }
    if (canCheckGraph && !selectionExists(graph!, sel)) {
      continue;
    }
    result[key] = value;
  }
  return result;
}

export function applyHighlight(
  current: HighlightMap,
  targets: readonly Selection[],
  color: HighlightColor | null
): HighlightMap {
  const next: HighlightMap = { ...current };
  for (const target of targets) {
    const key = selectionKey(target);
    if (color === null) {
      delete next[key];
    } else {
      next[key] = color;
    }
  }
  return next;
}

export function hasAnyHighlight(current: HighlightMap, targets: readonly Selection[]): boolean {
  return targets.some((target) => current[selectionKey(target)] !== undefined);
}

export function highlightCount(current: HighlightMap): number {
  return Object.keys(current).length;
}

export function nodeHighlightColor(current: HighlightMap, nodeId: string): string | undefined {
  return highlightCss(current[selectionKey(nodeSelection(nodeId))]);
}

export function netHighlightColor(current: HighlightMap, netId: string): string | undefined {
  return highlightCss(current[selectionKey({ kind: 'net', id: netId })]);
}

export function highlightedNetIds(current: HighlightMap): Set<string> {
  const ids = new Set<string>();
  for (const key of Object.keys(current)) {
    const sel = parseSelectionKey(key);
    if (sel?.kind === 'net') {
      ids.add(sel.id);
    }
  }
  return ids;
}
