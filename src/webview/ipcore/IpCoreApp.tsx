import React, { useEffect, useState, useRef } from 'react';
import { createRoot } from 'react-dom/client';
import { EditorPanel } from './components/layout/EditorPanel';
import { CanvasInspector } from './components/canvas/CanvasInspector';
import { useIpCoreState } from './hooks/useIpCoreState';
import { useIpCoreSync } from './hooks/useIpCoreSync';
import { useCanvasSelection } from './hooks/useCanvasSelection';
import { useCanvasDrop } from './hooks/useCanvasDrop';
import { useCanvasUndo } from './hooks/useCanvasUndo';
import { LibraryPalette } from './components/canvas/LibraryPalette';
import { vscode } from '../vscode';
import type { IpCore, BusInterface } from '../types/ipCore';
import '@vscode/codicons/dist/codicon.css';
import '../index.css';

// ---------------------------------------------------------------------------
// Toolbar primitives
// ---------------------------------------------------------------------------

interface ToolbarButtonProps {
  title: string;
  icon: string;
  command?: string;
  disabled?: boolean;
  onClick?: () => void;
}

const ToolbarButton: React.FC<ToolbarButtonProps> = ({
  title,
  icon,
  command,
  disabled,
  onClick,
}) => (
  <button
    className="canvas-view-toggle"
    title={title}
    type="button"
    disabled={disabled}
    onClick={onClick ?? (() => command && vscode?.postMessage({ type: 'command', command }))}
    aria-label={title}
    style={disabled ? { opacity: 0.4, cursor: 'not-allowed', pointerEvents: 'none' } : undefined}
  >
    <span className={`codicon codicon-${icon}`} />
  </button>
);

interface ToolbarGroupProps {
  label: string;
  children: React.ReactNode;
}

const ToolbarGroup: React.FC<ToolbarGroupProps> = ({ label, children }) => (
  <div className="flex flex-col items-center gap-0.5">
    <div className="flex items-center gap-0.5">{children}</div>
    <span
      style={{
        fontSize: '9px',
        opacity: 0.45,
        letterSpacing: '0.03em',
        lineHeight: 1,
        userSelect: 'none',
      }}
    >
      {label}
    </span>
  </div>
);

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

  // Whether amd/component.xml exists alongside this .ip.yml (sent by extension on each update)
  const [hasComponentXml, setHasComponentXml] = useState(false);

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
      } else if (kind === 'interrupt') {
        const idx = findIndex((ipCore as unknown as IpCore)?.interrupts ?? []);
        if (idx !== -1) {
          path = ['interrupts', idx];
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
      interrupt: 'interrupts',
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
      interrupt: 'interrupts',
      subcore: 'subcores',
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

  const validationErrors = getValidationErrors();

  // Handle global keyboard shortcuts for canvas deletion
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const activeTag = document.activeElement?.tagName.toLowerCase();
      const isTyping = activeTag === 'input' || activeTag === 'textarea';

      // Delete: remove selected canvas element
      if (e.key === 'Delete' && !isTyping && canvasSelected) {
        e.preventDefault();
        handleInspectorDelete();
      }
      // Ctrl+D: duplicate selected canvas element
      else if (
        (e.ctrlKey || e.metaKey) &&
        e.key.toLowerCase() === 'd' &&
        !isTyping &&
        canvasSelected
      ) {
        e.preventDefault();
        handleDuplicate();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [canvasSelected, handleInspectorDelete, handleDuplicate]);

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
        hasComponentXml?: boolean;
      };

      switch (message.type) {
        case 'update':
          updateFromYaml(message.text, message.fileName, message.imports);
          setHasComponentXml(message.hasComponentXml ?? false);
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
            <h1 className="text-sm font-semibold">{fileName || 'IP Core Editor'}</h1>
            {typedIpCore?.vlnv && typeof typedIpCore.vlnv === 'object' && (
              <span className="text-xs" style={{ opacity: 0.7 }}>
                {typedIpCore.vlnv.vendor} / {typedIpCore.vlnv.library} / {typedIpCore.vlnv.name}
              </span>
            )}
          </div>
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-1">
              <button
                className="canvas-view-toggle"
                onClick={undo}
                disabled={!canUndo}
                title="Undo (Ctrl+Z)"
                aria-label="Undo"
                type="button"
                style={{
                  opacity: !canUndo ? 0.4 : 1,
                  cursor: !canUndo ? 'not-allowed' : 'pointer',
                }}
              >
                <span className="codicon codicon-discard"></span>
              </button>
              <button
                className="canvas-view-toggle"
                onClick={redo}
                disabled={!canRedo}
                title="Redo (Ctrl+Y)"
                aria-label="Redo"
                type="button"
                style={{
                  opacity: !canRedo ? 0.4 : 1,
                  cursor: !canRedo ? 'not-allowed' : 'pointer',
                }}
              >
                <span className="codicon codicon-redo"></span>
              </button>
            </div>
            {/* Action groups */}
            <div
              className="flex items-center gap-2"
              style={{ borderLeft: '1px solid var(--vscode-panel-border)', paddingLeft: '10px' }}
            >
              <ToolbarGroup label="Scaffold">
                <ToolbarButton
                  title="Scaffold VHDL Project"
                  icon="package"
                  command="fpga-ip-core.scaffoldProject"
                />
              </ToolbarGroup>

              <div
                style={{
                  width: '1px',
                  height: '28px',
                  background: 'var(--vscode-panel-border)',
                  opacity: 0.6,
                }}
              />

              <ToolbarGroup label="Design">
                <ToolbarButton
                  title="Create Memory Map"
                  icon="map"
                  command="fpga-ip-core.createMemoryMap"
                />
                <ToolbarButton
                  title="Generate VHDL"
                  icon="code"
                  command="fpga-ip-core.generateVHDL"
                />
              </ToolbarGroup>

              <div
                style={{
                  width: '1px',
                  height: '28px',
                  background: 'var(--vscode-panel-border)',
                  opacity: 0.6,
                }}
              />

              <ToolbarGroup label="CocoTB">
                <ToolbarButton
                  title="Generate CocoTB Testbench"
                  icon="beaker"
                  command="fpga-ip-core.generateTestbench"
                />
              </ToolbarGroup>

              <div
                style={{
                  width: '1px',
                  height: '28px',
                  background: 'var(--vscode-panel-border)',
                  opacity: 0.6,
                }}
              />

              <ToolbarGroup label="Altera">
                <ToolbarButton
                  title="Export Altera Platform Designer"
                  icon="layers"
                  command="fpga-ip-core.exportAltera"
                />
                <ToolbarButton
                  title="Generate Quartus Project"
                  icon="circuit-board"
                  command="fpga-ip-core.generateQuartusProject"
                />
              </ToolbarGroup>

              <div
                style={{
                  width: '1px',
                  height: '28px',
                  background: 'var(--vscode-panel-border)',
                  opacity: 0.6,
                }}
              />

              <ToolbarGroup label="Xilinx">
                <ToolbarButton
                  title="Export Vivado Component XML"
                  icon="layers"
                  command="fpga-ip-core.exportXilinx"
                />
                <ToolbarButton
                  title="Generate Vivado Project"
                  icon="circuit-board"
                  command="fpga-ip-core.generateVivadoProject"
                />
                <ToolbarButton
                  title={
                    hasComponentXml
                      ? 'Edit in IP Packager (Vivado)'
                      : 'Edit in IP Packager — run Export Component XML first'
                  }
                  icon="edit"
                  disabled={!hasComponentXml}
                  onClick={() => vscode?.postMessage({ type: 'editInIpPackager' })}
                />
              </ToolbarGroup>
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
            <LibraryPalette busLibrary={imports?.busLibrary} />

            <EditorPanel
              ipCore={typedIpCore}
              imports={imports}
              onUpdate={updateIpCore}
              isFocused={true}
              canvasSelectedId={canvasSelectedId}
              onCanvasSelect={canvasSelect}
              onCanvasDragOver={onCanvasDragOver}
              onCanvasDrop={onCanvasDrop}
              onCanvasRemove={handleCanvasRemove}
            />
            {canvasSelected && typedIpCore && (
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
              <li key={idx}>{error.message}</li>
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
