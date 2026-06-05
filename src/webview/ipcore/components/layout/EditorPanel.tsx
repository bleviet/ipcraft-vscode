import React from 'react';
import type { YamlUpdateHandler } from '../../../types/editor';
import type { IpCore } from '../../../types/ipCore';
import { IpBlockCanvas } from '../canvas/IpBlockCanvas';
import type { BatchUpdate } from '../../hooks/useGroupPorts';
import type { SuggestionChip } from '../../hooks/useProtocolSuggestions';

interface EditorPanelProps {
  ipCore: IpCore | null;
  imports?: { busLibrary?: unknown; memoryMaps?: unknown[] };
  onUpdate: YamlUpdateHandler;
  isFocused?: boolean;
  onFocus?: () => void;
  panelRef?: React.RefObject<HTMLDivElement>;
  canvasSelectedId?: string | null;
  onCanvasSelect?: (id: string | null) => void;
  onCanvasDragOver?: (e: React.DragEvent) => void;
  onCanvasDrop?: (e: React.DragEvent) => void;
  onCanvasRemove?: (kind: string, id: string) => void;
  multiSelectedIds?: Set<string>;
  onShiftSelect?: (id: string) => void;
  batchUpdate?: BatchUpdate;
  suggestionChips?: SuggestionChip[];
  onDismissSelection?: () => void;
  onDismissSuggestion?: (chipId: string) => void;
}

export const EditorPanel: React.FC<EditorPanelProps> = ({
  ipCore,
  imports = {},
  onUpdate,
  isFocused = false,
  onFocus,
  panelRef,
  canvasSelectedId = null,
  onCanvasSelect,
  onCanvasDragOver,
  onCanvasDrop,
  onCanvasRemove,
  multiSelectedIds,
  onShiftSelect,
  batchUpdate,
  suggestionChips,
  onDismissSelection,
  onDismissSuggestion,
}) => {
  if (!ipCore) {
    return (
      <div className="flex-1 flex items-center justify-center text-gray-500">
        <p>No IP core loaded</p>
      </div>
    );
  }

  return (
    <div
      ref={panelRef}
      tabIndex={-1}
      onClick={onFocus}
      className="flex-1 min-w-0 outline-none"
      style={{
        outline: isFocused ? '1px solid var(--vscode-focusBorder)' : 'none',
        outlineOffset: '-1px',
        opacity: isFocused ? 1 : 0.7,
        transition: 'opacity 0.2s',
      }}
    >
      <IpBlockCanvas
        ipCore={ipCore}
        selectedId={canvasSelectedId}
        onSelect={onCanvasSelect ?? (() => {})}
        onUpdate={onUpdate}
        onDragOver={onCanvasDragOver}
        onDrop={onCanvasDrop}
        onRemove={onCanvasRemove}
        busLibrary={imports.busLibrary as Record<string, unknown> | undefined}
        multiSelectedIds={multiSelectedIds}
        onShiftSelect={onShiftSelect}
        batchUpdate={batchUpdate}
        suggestionChips={suggestionChips}
        onDismissSelection={onDismissSelection}
        onDismissSuggestion={onDismissSuggestion}
      />
    </div>
  );
};
