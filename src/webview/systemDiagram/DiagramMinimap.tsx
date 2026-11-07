import React from 'react';
import { MiniMap, Panel, type Node } from '@xyflow/react';
import { minimapColor } from './minimap';
import type { DiagramFlowNode } from './layout/diagramTypes';

const MASK_COLOR = 'color-mix(in srgb, var(--vscode-editor-background) 65%, transparent)';
/** Room under the minimap for the collapse button. */
const BUTTON_ROOM = 34;

interface DiagramMinimapProps {
  shown: boolean;
  query: string;
  onToggle: () => void;
}

/** Bottom-right world minimap with a collapse button; click or drag on it pans, the wheel zooms. */
export function DiagramMinimap({ shown, query, onToggle }: DiagramMinimapProps) {
  return (
    <>
      {shown && (
        <MiniMap
          pannable
          zoomable
          position="bottom-right"
          style={{ marginBottom: BUTTON_ROOM }}
          ariaLabel="Minimap"
          maskColor={MASK_COLOR}
          bgColor="var(--vscode-editor-background)"
          nodeColor={(node: Node) => minimapColor(node as unknown as DiagramFlowNode, query)}
          nodeStrokeColor="transparent"
        />
      )}
      <Panel position="bottom-right">
        <button
          type="button"
          className="sd-icon-button"
          aria-label={shown ? 'Hide minimap' : 'Show minimap'}
          title={shown ? 'Hide minimap' : 'Show minimap'}
          onClick={onToggle}
        >
          <span className={`codicon codicon-${shown ? 'chevron-down' : 'chevron-up'}`} />
        </button>
      </Panel>
    </>
  );
}
