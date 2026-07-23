import React from 'react';
import type { IpCore } from '../../../types/ipCore';
import type { YamlUpdateHandler } from '../../../types/editor';
import type { CanvasElement } from '../../hooks/useCanvasSelection';
import type { BatchUpdate } from '../../hooks/useGroupPorts';
import { InspectorPanelRouter } from './inspector/InspectorPanelRouter';
import { getElementName, kindLabel } from './inspector/inspectorMetadata';
import { useInspectorWidth } from './inspector/useInspectorWidth';

interface CanvasInspectorProps {
  selected: CanvasElement | null;
  ipCore: IpCore;
  imports?: { busLibrary?: unknown; memoryMaps?: unknown[] };
  onUpdate: YamlUpdateHandler;
  batchUpdate?: BatchUpdate;
  onClose: () => void;
  onDelete?: () => void;
  onUngroup?: () => void;
  onSelectElement?: (id: string) => void;
}

export const CanvasInspector: React.FC<CanvasInspectorProps> = ({
  selected,
  ipCore,
  imports,
  onUpdate,
  batchUpdate,
  onClose,
  onDelete,
  onUngroup,
  onSelectElement,
}) => {
  const { panelWidth, handleResizeMouseDown } = useInspectorWidth();

  if (!selected) {
    return null;
  }

  const name = getElementName(selected, ipCore);
  const kindSlug =
    selected.kind === 'busInterface'
      ? 'bus'
      : selected.kind === 'parameter'
        ? 'parameter'
        : selected.kind === 'body'
          ? 'body'
          : selected.kind;
  const hasFooter =
    selected.kind !== 'body' &&
    selected.kind !== 'generics' &&
    selected.kind !== 'busInterfaceMatrix' &&
    (onDelete ?? onUngroup);

  return (
    <div className="canvas-inspector" style={{ width: panelWidth }}>
      <div className="ci-resize-handle" onMouseDown={handleResizeMouseDown} />
      <div className="ci-header">
        <div className="ci-header__info">
          <span className={`ci-badge ci-badge--${kindSlug}`}>{kindLabel(selected.kind)}</span>
          <div className="ci-header__name" title={name}>
            {name || '—'}
          </div>
        </div>
        <button className="ci-header__close" onClick={onClose} title="Close (Esc)">
          <span className="codicon codicon-close" />
        </button>
      </div>
      <div className="ci-body">
        <InspectorPanelRouter
          element={selected}
          ipCore={ipCore}
          imports={imports}
          onUpdate={onUpdate}
          batchUpdate={batchUpdate}
          onSelectElement={onSelectElement}
        />
      </div>
      {hasFooter && (
        <div className="ci-footer">
          {onUngroup && selected.kind === 'busInterface' && (
            <button
              className="ci-ungroup-btn"
              onClick={onUngroup}
              title="Remove this interface and restore its signals as standalone ports"
              type="button"
            >
              <span className="codicon codicon-ungroup-by-ref-type" />
              Ungroup signals
            </button>
          )}
          {onDelete && (
            <button
              className="ci-delete-btn"
              onClick={onDelete}
              title={`Delete this ${kindLabel(selected.kind).toLowerCase()} and discard its signals`}
            >
              <span className="codicon codicon-trash" />
              Delete
            </button>
          )}
        </div>
      )}
    </div>
  );
};
