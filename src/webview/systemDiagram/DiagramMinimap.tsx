import React, { useCallback } from 'react';
import { MiniMap, type Node } from '@xyflow/react';
import { minimapColor } from './minimap';
import type { DiagramFlowNode } from './layout/diagramTypes';
import type { TextMatcher } from './searchMatcher';

const MASK_COLOR = 'color-mix(in srgb, var(--vscode-foreground) 12%, transparent)';

interface DiagramMinimapProps {
  matcher: TextMatcher | null;
}

/** Bottom-right world minimap; click or drag on it pans, the wheel zooms. */
export function DiagramMinimap({ matcher }: DiagramMinimapProps) {
  const nodeColor = useCallback(
    (node: Node) => minimapColor(node as unknown as DiagramFlowNode, matcher),
    [matcher]
  );
  return (
    <MiniMap
      pannable
      zoomable
      position="bottom-right"
      ariaLabel="Minimap"
      maskColor={MASK_COLOR}
      bgColor="var(--vscode-editor-background)"
      maskStrokeColor="var(--vscode-focusBorder)"
      maskStrokeWidth={1.5}
      nodeColor={nodeColor}
      nodeStrokeColor="transparent"
    />
  );
}
