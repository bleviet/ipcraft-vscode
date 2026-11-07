/** Context menu items of the canvas that need no canvas state: highlight, bundle and trace gestures. */

import type { HighlightColor, HighlightMap } from '../../shared/messages/systemDiagram';
import type { ContextMenuItem } from './DiagramContextMenu';
import { HIGHLIGHT_COLORS, hasAnyHighlight, highlightCount } from './highlights';
import type { Selection } from './model';

export function highlightMenuItems(
  highlights: HighlightMap | undefined,
  targets: readonly Selection[],
  onHighlight: ((targets: readonly Selection[], color: HighlightColor | null) => void) | undefined,
  onClearHighlights: (() => void) | undefined
): ContextMenuItem[] {
  return onHighlight
    ? [
        {
          label: 'Highlight',
          swatches: HIGHLIGHT_COLORS.map((swatch) => ({
            label: swatch.label,
            color: swatch.css,
            onSelect: () => onHighlight(targets, swatch.id),
          })),
          onSelect: () => onHighlight(targets, HIGHLIGHT_COLORS[0].id),
        },
        {
          label: 'Clear Highlight',
          disabled: !hasAnyHighlight(highlights ?? {}, targets),
          onSelect: () => onHighlight(targets, null),
        },
        ...(onClearHighlights
          ? [
              {
                label: 'Clear All Highlights',
                disabled: highlightCount(highlights ?? {}) === 0,
                onSelect: onClearHighlights,
              },
            ]
          : []),
      ]
    : [];
}

interface BundleMenuInput {
  bundleKey: string;
  /** The two blocks the bundled wire joins. */
  pair: [string, string];
  isolatable: (nodeIds: string[]) => boolean;
  onUnbundle?: (key: string) => void;
  onIsolatePair?: (a: string, b: string) => void;
}

export function bundleMenuItems({
  bundleKey,
  pair,
  isolatable,
  onUnbundle,
  onIsolatePair,
}: BundleMenuInput): ContextMenuItem[] {
  return [
    ...(onUnbundle ? [{ label: 'Unbundle', onSelect: () => onUnbundle(bundleKey) }] : []),
    ...(onIsolatePair
      ? [
          {
            label: 'Isolate Pair',
            disabled: !isolatable(pair),
            onSelect: () => onIsolatePair(...pair),
          },
        ]
      : []),
  ];
}

/** Trace From Here / Trace To Here; absent when the canvas cannot trace. */
export function traceMenuItems(
  nodeId: string,
  isolatable: (nodeIds: string[]) => boolean,
  onTraceFrom: ((nodeId: string) => void) | undefined,
  onTraceTo: ((nodeId: string) => void) | undefined
): ContextMenuItem[] {
  if (!onTraceFrom || !onTraceTo) {
    return [];
  }
  const disabled = !isolatable([nodeId]);
  return [
    { label: 'Trace From Here', disabled, onSelect: () => onTraceFrom(nodeId) },
    { label: 'Trace To Here', disabled, onSelect: () => onTraceTo(nodeId) },
  ];
}
