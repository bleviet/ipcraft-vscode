import React, { useEffect, useState, useRef } from 'react';
import { createRoot } from 'react-dom/client';
import { NavigationSidebar } from './components/layout/NavigationSidebar';
import { EditorPanel, type ViewMode } from './components/layout/EditorPanel';
import { CanvasInspector } from './components/canvas/CanvasInspector';
import { useIpCoreState } from './hooks/useIpCoreState';
import { useNavigation } from './hooks/useNavigation';
import { useIpCoreSync } from './hooks/useIpCoreSync';
import { useCanvasSelection } from './hooks/useCanvasSelection';
import { useCanvasDrop } from './hooks/useCanvasDrop';
import { useCanvasUndo } from './hooks/useCanvasUndo';
import { LibraryPalette } from './components/canvas/LibraryPalette';
import { vscode } from '../vscode';
import type { IpCore, BusInterface } from '../types/ipCore';
import '../index.css';

export type FocusedPanel = 'left' | 'right';

/**
 * Main IP Core Visual Editor application
 */
const IpCoreApp: React.FC = () => {
  const {
    ipCore,
    rawYaml,
    parseError,
    fileName,
    imports,
    updateFromYaml,
    updateIpCore: baseUpdateIpCore,
    getValidationErrors,
  } = useIpCoreState();
  const { selectedSection, navigate } = useNavigation();
  useIpCoreSync(rawYaml);

  // Undo/Redo stack for canvas actions
  const {
    push: pushUndo,
    undo,
    redo,
    canUndo,
    canRedo,
  } = useCanvasUndo({
    rawYaml,
    updateFromYaml,
    fileName: fileName ?? 'ipcore',
    imports: imports as Record<string, unknown>,
  });

  // Intercept updates to push to undo stack
  const updateIpCore = React.useCallback(
    (path: Array<string | number>, value: unknown) => {
      pushUndo();
      baseUpdateIpCore(path, value);
    },
    [baseUpdateIpCore, pushUndo]
  );

  // Transient toast notification
  const [toast, setToast] = useState<string | null>(null);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const showToast = React.useCallback((message: string) => {
    if (toastTimerRef.current) {
      clearTimeout(toastTimerRef.current);
    }
    setToast(message);
    toastTimerRef.current = setTimeout(() => setToast(null), 4000);
  }, []);

  // Sidebar toggle state for mobile
  const [sidebarOpen, setSidebarOpen] = useState(false);

  // Canvas vs table view mode
  const [viewMode, setViewMode] = useState<ViewMode>('canvas');

  // Canvas element selection (Phase 2)
  const {
    selected: canvasSelected,
    selectedId: canvasSelectedId,
    select: canvasSelect,
    deselect: canvasDeselect,
  } = useCanvasSelection();

  // Canvas drop handling (Phase 3)
  const { handleDragOver: onCanvasDragOver, handleDrop: onCanvasDrop } = useCanvasDrop({
    ipCore: ipCore as unknown as IpCore,
    onUpdate: updateIpCore,
    onSelect: canvasSelect,
  });

  // Canvas drag-to-remove handling (Phase 4)
  const handleCanvasRemove = React.useCallback(
    (kind: string, id: string) => {
      let path: Array<string | number> | null = null;

      const findIndex = (arr: unknown[]) => {
        if (!Array.isArray(arr)) {
          return -1;
        }
        return arr.findIndex((item) => (item as { name?: string })?.name === id);
      };

      if (kind === 'clock') {
        const idx = findIndex((ipCore as unknown as IpCore)?.clocks ?? []);
        if (idx !== -1) {
          path = ['clocks', idx];
        }
      } else if (kind === 'reset') {
        const idx = findIndex((ipCore as unknown as IpCore)?.resets ?? []);
        if (idx !== -1) {
          path = ['resets', idx];
        }
      } else if (kind === 'bus') {
        const idx = findIndex((ipCore as unknown as IpCore)?.busInterfaces ?? []);
        if (idx !== -1) {
          path = ['busInterfaces', idx];
        }
      } else if (kind === 'port') {
        const idx = findIndex((ipCore as unknown as IpCore)?.ports ?? []);
        if (idx !== -1) {
          path = ['ports', idx];
        }
      }

      if (path) {
        updateIpCore(path, undefined);
        if (canvasSelectedId === id) {
          canvasDeselect();
        }
      }
    },
    [ipCore, updateIpCore, canvasSelectedId, canvasDeselect]
  );

  // Duplicate selected canvas element (Ctrl+D)
  // - Bus interface: first Ctrl+D adds array config (count=2); subsequent ones increment count
  // - Other elements: appends a copy with a unique name
  const handleDuplicate = React.useCallback(() => {
    if (!canvasSelected) {
      return;
    }
    const ip = ipCore as unknown as IpCore;

    if (canvasSelected.kind === 'busInterface') {
      const bus = ((ip.busInterfaces ?? []) as BusInterface[])[canvasSelected.index] as
        | (BusInterface & Record<string, unknown>)
        | undefined;
      if (!bus) {
        return;
      }
      if (bus.memoryMapRef) {
        showToast(
          `Cannot convert "${bus.name}" to an array — arrays cannot have a memory map reference. Remove the memory map reference first.`
        );
        return;
      }
      const arr = bus.array as
        | {
            count?: number;
            indexStart?: number;
            namingPattern?: string;
            physicalPrefixPattern?: string;
          }
        | undefined
        | null;
      if (arr?.count) {
        updateIpCore(['busInterfaces', canvasSelected.index, 'array', 'count'], arr.count + 1);
      } else {
        const baseName = String(bus.name ?? 'INTERFACE').toUpperCase();
        const physicalPrefix = String(bus.physicalPrefix ?? bus.name ?? '')
          .replace(/_$/, '')
          .toLowerCase();
        updateIpCore(['busInterfaces', canvasSelected.index, 'array'], {
          count: 2,
          indexStart: 0,
          namingPattern: `${baseName}_{index}`,
          physicalPrefixPattern: `${physicalPrefix}_{index}_`,
        });
      }
      return;
    }

    const kindToKey: Record<string, string> = {
      clock: 'clocks',
      reset: 'resets',
      port: 'ports',
      parameter: 'parameters',
    };
    const key = kindToKey[canvasSelected.kind];
    if (!key) {
      return;
    }
    const arr2 = ip[key as keyof IpCore] as unknown[] | undefined;
    if (!Array.isArray(arr2)) {
      return;
    }
    const original = arr2[canvasSelected.index] as Record<string, unknown>;
    if (!original) {
      return;
    }
    const existingNames = arr2.map((item) => String((item as Record<string, unknown>).name ?? ''));
    const baseName = String(original.name ?? 'item');
    let newName = `${baseName}_copy`;
    let n = 2;
    while (existingNames.includes(newName)) {
      newName = `${baseName}_copy_${n++}`;
    }
    updateIpCore([key], [...arr2, { ...original, name: newName }]);
  }, [canvasSelected, ipCore, updateIpCore, showToast]);

  // Delete selected element from the inspector panel (safe array-filter approach)
  const handleInspectorDelete = React.useCallback(() => {
    if (!canvasSelected) {
      return;
    }
    const pathKey: Record<string, string> = {
      clock: 'clocks',
      reset: 'resets',
      port: 'ports',
      busInterface: 'busInterfaces',
      parameter: 'parameters',
    };
    const key = pathKey[canvasSelected.kind];
    if (!key) {
      return;
    }
    const ip = ipCore as unknown as IpCore;
    const currentArr = ip[key as keyof IpCore] as unknown[] | undefined;
    if (!Array.isArray(currentArr)) {
      return;
    }
    const updated = currentArr.filter((_, i) => i !== canvasSelected.index);
    updateIpCore([key], updated);
    canvasDeselect();
  }, [canvasSelected, ipCore, updateIpCore, canvasDeselect]);

  // Panel focus state for Ctrl+H/L navigation
  const [focusedPanel, setFocusedPanel] = useState<FocusedPanel>('left');
  const leftPanelRef = useRef<HTMLDivElement>(null);
  const rightPanelRef = useRef<HTMLDivElement>(null);

  // Highlight state for validation errors
  const [highlight, setHighlight] = useState<{ entityName: string; field: string } | undefined>(
    undefined
  );

  const validationErrors = getValidationErrors();

  // Clear highlight if the error is no longer in the validation list (e.g., fixed by undo or edit)
  useEffect(() => {
    if (highlight) {
      const errorStillExists = validationErrors.some(
        (e) => e.entityName === highlight.entityName && e.field === highlight.field
      );
      if (!errorStillExists) {
        setHighlight(undefined);
      }
    }
  }, [validationErrors, highlight]);

  // Handle global keyboard shortcuts for panel switching and canvas deletion
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const activeTag = document.activeElement?.tagName.toLowerCase();
      const isTyping = activeTag === 'input' || activeTag === 'textarea';

      // Ctrl+H: Focus left panel
      if (e.ctrlKey && e.key.toLowerCase() === 'h') {
        e.preventDefault();
        setFocusedPanel('left');
        leftPanelRef.current?.focus();
      }
      // Ctrl+L: Focus right panel (EditorPanel's useEffect will auto-focus the table)
      else if (e.ctrlKey && e.key.toLowerCase() === 'l') {
        e.preventDefault();
        setFocusedPanel('right');
        // The EditorPanel will auto-focus the inner table container via its useEffect
      }
      // Delete: remove selected canvas element (ports, buses, clocks, resets, generics)
      else if (e.key === 'Delete' && !isTyping && viewMode === 'canvas' && canvasSelected) {
        e.preventDefault();
        handleInspectorDelete();
      }
      // Ctrl+D: duplicate selected canvas element (bus interfaces become arrays)
      else if (
        (e.ctrlKey || e.metaKey) &&
        e.key.toLowerCase() === 'd' &&
        !isTyping &&
        viewMode === 'canvas' &&
        canvasSelected
      ) {
        e.preventDefault();
        handleDuplicate();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [viewMode, canvasSelected, handleInspectorDelete, handleDuplicate]);

  // Notify extension that webview is ready
  useEffect(() => {
    if (vscode) {
      vscode.postMessage({ type: 'ready' });
    }
  }, []);

  // Listen for messages from extension
  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      const message = event.data as {
        type?: string;
        text: string;
        fileName: string;
        imports?: Record<string, unknown>;
      };

      switch (message.type) {
        case 'update':
          updateFromYaml(message.text, message.fileName, message.imports);
          break;
      }
    };

    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [updateFromYaml]);

  const typedIpCore = ipCore as unknown as Parameters<typeof EditorPanel>[0]['ipCore'];

  return (
    <div
      className="h-screen flex flex-col"
      style={{
        background: 'var(--vscode-editor-background)',
        color: 'var(--vscode-editor-foreground)',
      }}
    >
      {/* Header */}
      <div
        className="px-4 py-2"
        style={{
          borderBottom: '1px solid var(--vscode-panel-border)',
          background: 'var(--vscode-sideBar-background)',
        }}
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            {/* Mobile sidebar toggle (table mode only) */}
            {viewMode === 'table' && (
              <button
                className="sidebar-toggle-btn p-2 rounded-md transition-colors vscode-icon-button"
                onClick={() => setSidebarOpen(!sidebarOpen)}
                title="Toggle navigation"
                aria-label="Toggle navigation"
                type="button"
              >
                <span className="codicon codicon-menu"></span>
              </button>
            )}
            <h1 className="text-sm font-semibold">{fileName || 'IP Core Editor'}</h1>
            {typedIpCore?.vlnv && typeof typedIpCore.vlnv === 'object' && (
              <span className="text-xs" style={{ opacity: 0.7 }}>
                {typedIpCore.vlnv.vendor} / {typedIpCore.vlnv.library} / {typedIpCore.vlnv.name}
              </span>
            )}
          </div>
          <div className="flex items-center gap-3">
            {/* View mode toggle */}
            <div className="flex items-center gap-1">
              <button
                className={`canvas-view-toggle`}
                onClick={undo}
                disabled={!canUndo || viewMode === 'table'}
                title="Undo (Ctrl+Z)"
                aria-label="Undo"
                type="button"
                style={{
                  opacity: !canUndo || viewMode === 'table' ? 0.4 : 1,
                  cursor: !canUndo || viewMode === 'table' ? 'not-allowed' : 'pointer',
                }}
              >
                <span className="codicon codicon-discard"></span>
              </button>
              <button
                className={`canvas-view-toggle`}
                onClick={redo}
                disabled={!canRedo || viewMode === 'table'}
                title="Redo (Ctrl+Y)"
                aria-label="Redo"
                type="button"
                style={{
                  opacity: !canRedo || viewMode === 'table' ? 0.4 : 1,
                  cursor: !canRedo || viewMode === 'table' ? 'not-allowed' : 'pointer',
                }}
              >
                <span className="codicon codicon-redo"></span>
              </button>
              <div style={{ width: '8px' }}></div>
              <button
                className={`canvas-view-toggle ${viewMode === 'canvas' ? 'canvas-view-toggle--active' : ''}`}
                onClick={() => setViewMode('canvas')}
                title="Canvas view"
                aria-label="Canvas view"
                type="button"
              >
                <span className="codicon codicon-symbol-misc"></span>
              </button>
              <button
                className={`canvas-view-toggle ${viewMode === 'table' ? 'canvas-view-toggle--active' : ''}`}
                onClick={() => setViewMode('table')}
                title="Table view"
                aria-label="Table view"
                type="button"
              >
                <span className="codicon codicon-list-flat"></span>
              </button>
            </div>
            {validationErrors.length > 0 && (
              <div className="text-sm" style={{ color: 'var(--vscode-errorForeground)' }}>
                {validationErrors.length} validation error(s)
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Main content */}
      <div className="flex-1 flex overflow-hidden">
        {parseError ? (
          <div className="flex-1 flex items-center justify-center">
            <div
              className="px-4 py-3 rounded max-w-2xl"
              style={{
                background: 'var(--vscode-inputValidation-errorBackground)',
                border: '1px solid var(--vscode-inputValidation-errorBorder)',
                color: 'var(--vscode-errorForeground)',
              }}
            >
              <p className="font-semibold mb-2">Parse Error</p>
              <p className="text-sm">{parseError}</p>
            </div>
          </div>
        ) : !ipCore ? (
          <div className="flex-1 flex items-center justify-center">
            <div className="text-center">
              <p style={{ color: 'var(--vscode-descriptionForeground)' }}>No IP core loaded</p>
              <p
                className="text-xs mt-2"
                style={{
                  color: 'var(--vscode-descriptionForeground)',
                  opacity: 0.6,
                }}
              >
                Waiting for data from extension...
              </p>
            </div>
          </div>
        ) : (
          <>
            {/* Sidebar (table mode only) */}
            {viewMode === 'table' && (
              <>
                {sidebarOpen && (
                  <div className="sidebar-backdrop active" onClick={() => setSidebarOpen(false)} />
                )}
                <NavigationSidebar
                  selectedSection={selectedSection}
                  onNavigate={navigate}
                  ipCore={{ ...typedIpCore, imports }}
                  isFocused={focusedPanel === 'left'}
                  onFocus={() => setFocusedPanel('left')}
                  panelRef={leftPanelRef}
                  className={sidebarOpen ? 'sidebar-open' : ''}
                />
              </>
            )}

            {/* Library Palette (canvas mode only) */}
            {viewMode === 'canvas' && <LibraryPalette />}

            <EditorPanel
              selectedSection={selectedSection}
              viewMode={viewMode}
              ipCore={typedIpCore}
              imports={imports}
              onUpdate={updateIpCore}
              isFocused={viewMode === 'canvas' || focusedPanel === 'right'}
              onFocus={() => setFocusedPanel('right')}
              panelRef={rightPanelRef}
              highlight={highlight}
              canvasSelectedId={canvasSelectedId}
              onCanvasSelect={canvasSelect}
              onCanvasDragOver={onCanvasDragOver}
              onCanvasDrop={onCanvasDrop}
              onCanvasRemove={handleCanvasRemove}
            />
            {/* Context-aware inspector (canvas mode only) */}
            {viewMode === 'canvas' && canvasSelected && typedIpCore && (
              <CanvasInspector
                selected={canvasSelected}
                ipCore={typedIpCore}
                imports={imports}
                onUpdate={updateIpCore}
                onClose={canvasDeselect}
                onDelete={handleInspectorDelete}
              />
            )}
          </>
        )}
      </div>

      {/* Validation errors panel */}
      {validationErrors.length > 0 && (
        <div
          className="p-2"
          style={{
            borderTop: '1px solid var(--vscode-panel-border)',
            background: 'var(--vscode-inputValidation-warningBackground)',
          }}
        >
          <p className="text-sm font-semibold mb-1">Reference Validation Errors:</p>
          <ul className="text-xs list-disc list-inside">
            {validationErrors.map((error, idx) => (
              <li
                key={idx}
                className="cursor-pointer hover:underline"
                onClick={() => {
                  navigate(error.section);
                  setHighlight({
                    entityName: error.entityName,
                    field: error.field,
                  });
                  setFocusedPanel('right');
                }}
              >
                {error.message}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Toast notification */}
      {toast && (
        <div
          style={{
            position: 'fixed',
            bottom: '24px',
            left: '50%',
            transform: 'translateX(-50%)',
            zIndex: 9999,
            background: 'var(--vscode-inputValidation-warningBackground)',
            border: '1px solid var(--vscode-inputValidation-warningBorder)',
            color: 'var(--vscode-foreground)',
            padding: '8px 14px',
            borderRadius: '6px',
            fontSize: '12px',
            maxWidth: '480px',
            boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
          }}
        >
          <span className="codicon codicon-warning" style={{ flexShrink: 0 }} />
          {toast}
        </div>
      )}
    </div>
  );
};

// Mount the app
const container = document.getElementById('ipcore-root');
if (container) {
  const root = createRoot(container);
  root.render(<IpCoreApp />);
}
