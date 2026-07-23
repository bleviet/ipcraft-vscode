import React, { useCallback, useEffect, useState, useRef, useMemo } from 'react';
import { createRoot } from 'react-dom/client';
import { EditorPanel } from './components/layout/EditorPanel';
import { CanvasInspector } from './components/canvas/CanvasInspector';
import { useIpCoreState } from './hooks/useIpCoreState';
import { useIpCoreSync } from './hooks/useIpCoreSync';
import { useCanvasSelection } from './hooks/useCanvasSelection';
import { useCanvasDrop } from './hooks/useCanvasDrop';
import { useCanvasUndo } from './hooks/useCanvasUndo';
import { useProtocolSuggestions } from './hooks/useProtocolSuggestions';
import { useStagingSession } from './hooks/useStagingSession';
import { useConsistencySession } from './hooks/useConsistencySession';
import { LibraryPalette } from './components/canvas/LibraryPalette';
import { StagingOverlay, type StagedFileView } from './components/canvas/StagingOverlay';
import { ConsistencyOverlay } from './components/canvas/ConsistencyOverlay';
import {
  IpCoreToolbar,
  type PackSummary,
  type RegisteredToolchain,
} from './components/IpCoreToolbar';
import { vscode } from '../vscode';
import type { IpCore, BusInterface } from '../types/ipCore';
import { useGroupPorts } from './hooks/useGroupPorts';
import type { BatchUpdate } from './hooks/useGroupPorts';
import { lookupBusDef, lookupBusDefFromLibrary } from './data/busDefinitions';
import type { ConsistencyFinding, ConsistencySummary } from './types/consistency';
import '@vscode/codicons/dist/codicon.css';
import '../index.css';

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

  // Atomic batch update — single undo entry for multi-mutation operations (e.g., grouping)
  const batchUpdateIpCore: BatchUpdate = useCallback(
    (mutations) => {
      pushUndo();
      for (const [path, value] of mutations) {
        baseUpdateIpCore(path, value);
      }
    },
    [baseUpdateIpCore, pushUndo]
  );

  // Staging overlay — replaces inspector slot during code-generation confirmation
  const {
    stagingData,
    stagingMergedPaths,
    stagingOverwritePaths,
    handleStagingStart,
    handleStagingFileMerged,
    toggleStagingOverwrite,
    mergeStagingFile,
    confirmStaging,
    cancelStaging,
  } = useStagingSession();

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

  // Whether vendor files exist alongside this .ip.yml (sent by extension on each update)
  const [hasComponentXml, setHasComponentXml] = useState(false);
  const [hasHwTcl, setHasHwTcl] = useState(false);
  const [hasXpr, setHasXpr] = useState(false);
  const [hasQpf, setHasQpf] = useState(false);
  // HDL language for source generation — mirrors ipcraft.generate.hdlLanguage
  const [hdlLanguage, setHdlLanguage] = useState<'vhdl' | 'systemverilog'>('vhdl');
  // Scaffold pack — mirrors ipcraft.generate.scaffoldPack
  const [scaffoldPack, setScaffoldPack] = useState('builtin-minimal');
  const [availableScaffoldPacks, setAvailableScaffoldPacks] = useState<PackSummary[]>([
    { id: 'builtin-minimal', label: 'Minimal', description: '', category: 'builtin' },
    { id: 'builtin-ipcraft', label: 'IPCraft', description: '', category: 'builtin' },
  ]);
  // Active vendor toolchain section(s) shown in toolbar — mirrors ipcraft.toolbar.targets
  const [toolbarTargets, setToolbarTargets] = useState<string[]>(['vivado', 'quartus']);
  // All registered toolchains from the extension — drives the TargetVendorPicker pill list
  const [allToolchains, setAllToolchains] = useState<RegisteredToolchain[]>([
    { id: 'vivado', displayName: 'Vivado (Xilinx/AMD)' },
    { id: 'quartus', displayName: 'Quartus (Intel/Altera)' },
  ]);
  // True when opened via IpCoreSourcePreviewProvider (source file, not a .ip.yml)
  const [isPreview, setIsPreview] = useState(false);

  // Canvas element selection — single + multi-select
  const {
    selected: canvasSelected,
    selectedId: canvasSelectedId,
    select: canvasSelect,
    shiftSelect: canvasShiftSelect,
    deselect: canvasDeselect,
    deselectAll: canvasDeselectAll,
    multiSelection,
  } = useCanvasSelection();

  // Multi-selection IDs as a Set<string> for prop threading
  const multiSelectedIds = useMemo(() => new Set(multiSelection.all.keys()), [multiSelection.all]);

  // ID of the individually selected bus signal (e.g. "bus:0:TLAST"), if any.
  // Kept separate from canvasSelectedId (which stays on the parent bus interface
  // so the inspector panel keeps showing it) so Delete can target just this one
  // signal instead of the whole-element deletion below.
  const [selectedSubPortId, setSelectedSubPortId] = useState<string | null>(null);

  const handleCanvasSelect = useCallback(
    (id: string | null) => {
      setSelectedSubPortId(null);
      canvasSelect(id);
    },
    [canvasSelect]
  );

  // Consistency check (issue #84) — request/response and result-driven actions.
  const {
    consistencyResult,
    consistencyChecking,
    ignoredConsistencyKeys,
    showConsistencyOverlay,
    setShowConsistencyOverlay,
    handleCheckConsistency,
    handleIgnoreConsistencyFinding,
    handleAdoptConsistencyFinding,
    handleSelectConsistencyElement,
    handleRegenerateFromConsistency,
    handleConsistencyResultMessage,
    consistencyAnnotations,
    consistencyBadge,
  } = useConsistencySession({
    ipCore,
    updateIpCore,
    onSelectElement: handleCanvasSelect,
    showToast,
  });

  // Dismissed suggestion chip IDs (ephemeral — not persisted to YAML)
  const [dismissedChipIds, setDismissedChipIds] = useState<Set<string>>(new Set());

  const handleDismissSuggestion = useCallback((chipId: string) => {
    setDismissedChipIds((prev) => new Set([...prev, chipId]));
  }, []);

  // Protocol suggestions for unassigned ports
  const allSuggestions = useProtocolSuggestions(
    (ipCore as unknown as IpCore | null) ?? ({} as IpCore)
  );
  const activeSuggestions = useMemo(
    () => allSuggestions.filter((c) => !dismissedChipIds.has(c.id)),
    [allSuggestions, dismissedChipIds]
  );

  // Canvas drop handling (Phase 3)
  const { handleDragOver: onCanvasDragOver, handleDrop: onCanvasDrop } = useCanvasDrop({
    ipCore: ipCore as unknown as IpCore,
    onUpdate: updateIpCore,
    onSelect: handleCanvasSelect,
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
    setSelectedSubPortId(null);
  }, [canvasSelected, ipCore, updateIpCore, canvasDeselect]);

  // Ungroup a bus interface: restore its signals to ports[], remove the interface
  const busDefsForUngroup = useMemo(() => {
    const lib = (imports as Record<string, unknown> | undefined)?.busLibrary as
      | Record<string, unknown>
      | undefined;
    if (!lib) {
      return lookupBusDef;
    }
    return (type: string) => {
      const hardcoded = lookupBusDef(type);
      if (hardcoded !== null) {
        return hardcoded;
      }
      return lookupBusDefFromLibrary(type, lib);
    };
  }, [imports]);

  const { ungroupBusInterface } = useGroupPorts(
    ipCore as unknown as IpCore,
    batchUpdateIpCore,
    busDefsForUngroup
  );

  const handleInspectorUngroup = React.useCallback(() => {
    if (canvasSelected?.kind !== 'busInterface') {
      return;
    }
    ungroupBusInterface(canvasSelected.index);
    canvasDeselect();
    setSelectedSubPortId(null);
  }, [canvasSelected, ungroupBusInterface, canvasDeselect]);

  const validationErrors = getValidationErrors();

  // Handle global keyboard shortcuts for canvas deletion
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const activeTag = document.activeElement?.tagName.toLowerCase();
      const isTyping = activeTag === 'input' || activeTag === 'textarea';

      // Delete: deactivate the selected optional bus signal, if one is selected —
      // this must take priority over whole-element deletion below, since
      // canvasSelected still points at the signal's parent bus interface.
      if (e.key === 'Delete' && !isTyping && selectedSubPortId) {
        e.preventDefault();
        const parts = selectedSubPortId.split(':');
        if (parts.length >= 3) {
          const busIndex = parseInt(parts[1], 10);
          const portName = parts.slice(2).join(':');
          const ip = ipCore as unknown as IpCore;
          const bus = ((ip.busInterfaces ?? []) as BusInterface[])[busIndex] as
            | { useOptionalPorts?: string[] }
            | undefined;
          const current = bus?.useOptionalPorts ?? [];
          const updated = current.filter((p) => p !== portName);
          if (updated.length !== current.length) {
            updateIpCore(
              ['busInterfaces', busIndex, 'useOptionalPorts'],
              updated.length > 0 ? updated : undefined
            );
          }
        }
      }
      // Delete: remove selected canvas element
      else if (e.key === 'Delete' && !isTyping && canvasSelected) {
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
  }, [
    canvasSelected,
    handleInspectorDelete,
    handleDuplicate,
    selectedSubPortId,
    ipCore,
    updateIpCore,
  ]);

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
        hasHwTcl?: boolean;
        hasXpr?: boolean;
        hasQpf?: boolean;
        hdlLanguage?: 'vhdl' | 'systemverilog';
        scaffoldPack?: string;
        availableScaffoldPacks?: PackSummary[];
        toolbarTargets?: string[];
        allToolchains?: RegisteredToolchain[];
        isPreview?: boolean;
        files?: StagedFileView[];
        rootLabel?: string;
        relativePath?: string;
        findings?: ConsistencyFinding[];
        summary?: ConsistencySummary;
        error?: string;
        auto?: boolean;
      };

      switch (message.type) {
        case 'update':
          updateFromYaml(message.text, message.fileName, message.imports);
          setHasComponentXml(message.hasComponentXml ?? false);
          setHasHwTcl(message.hasHwTcl ?? false);
          setHasXpr(message.hasXpr ?? false);
          setHasQpf(message.hasQpf ?? false);
          setHdlLanguage(message.hdlLanguage ?? 'vhdl');
          if (message.scaffoldPack !== undefined) {
            setScaffoldPack(message.scaffoldPack);
          }
          if (message.availableScaffoldPacks?.length) {
            setAvailableScaffoldPacks(message.availableScaffoldPacks);
          }
          setToolbarTargets(message.toolbarTargets ?? ['vivado', 'quartus']);
          if (message.allToolchains && message.allToolchains.length > 0) {
            setAllToolchains(message.allToolchains);
          }
          setIsPreview(message.isPreview ?? false);
          break;
        case 'stagingStart':
          handleStagingStart(message);
          break;
        case 'stagingFileMerged':
          handleStagingFileMerged(message.relativePath);
          break;
        case 'consistencyResult':
          handleConsistencyResultMessage(message);
          break;
      }
    };

    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [updateFromYaml, handleStagingStart, handleStagingFileMerged, handleConsistencyResultMessage]);

  const typedIpCore = ipCore as unknown as Parameters<typeof EditorPanel>[0]['ipCore'];

  // Detect duplicate physicalPrefix values across all bus interfaces
  const duplicatePrefixes = useMemo((): string[] => {
    const buses = (ipCore as unknown as IpCore)?.busInterfaces ?? [];
    const prefixCount = new Map<string, number>();
    for (const bus of buses as BusInterface[]) {
      const p = (bus.physicalPrefix ?? '').toLowerCase();
      if (p) {
        prefixCount.set(p, (prefixCount.get(p) ?? 0) + 1);
      }
    }
    return Array.from(prefixCount.entries())
      .filter(([, count]) => count > 1)
      .map(([prefix]) => prefix);
  }, [ipCore]);

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
          <IpCoreToolbar
            canUndo={canUndo}
            canRedo={canRedo}
            onUndo={undo}
            onRedo={redo}
            toolbarTargets={toolbarTargets}
            allToolchains={allToolchains}
            hdlLanguage={hdlLanguage}
            scaffoldPack={scaffoldPack}
            availableScaffoldPacks={availableScaffoldPacks}
            hasHwTcl={hasHwTcl}
            hasQpf={hasQpf}
            hasComponentXml={hasComponentXml}
            hasXpr={hasXpr}
            consistencyChecking={consistencyChecking}
            hasConsistencyResult={consistencyResult !== null}
            consistencyBadge={consistencyBadge}
            onCheckConsistency={handleCheckConsistency}
            onToggleConsistencyOverlay={() => setShowConsistencyOverlay((v) => !v)}
            validationErrorCount={validationErrors.length}
          />
        </div>
      </div>

      {/* Preview banner */}
      {isPreview && (
        <div
          className="flex items-center gap-2 px-4"
          style={{
            minHeight: '28px',
            background: 'var(--vscode-inputValidation-infoBackground)',
            borderBottom: '1px solid var(--vscode-inputValidation-infoBorder)',
            color: 'var(--vscode-foreground)',
            fontSize: '12px',
          }}
        >
          <span className="codicon codicon-eye" style={{ flexShrink: 0 }} />
          <span style={{ opacity: 0.85 }}>
            Preview — edits are in-memory and not saved to source
          </span>
          <button
            type="button"
            className="canvas-view-toggle"
            style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: '4px' }}
            onClick={() => vscode?.postMessage({ type: 'saveAsIpYml' })}
            title="Write parsed result to .ip.yml and open in the full editor"
          >
            <span className="codicon codicon-save" />
            <span>Save as .ip.yml</span>
          </button>
        </div>
      )}

      {/* Duplicate physicalPrefix warning banner */}
      {duplicatePrefixes.length > 0 && (
        <div
          className="flex items-start gap-2 px-4 py-2"
          role="alert"
          style={{
            background: 'var(--vscode-inputValidation-warningBackground)',
            borderBottom: '1px solid var(--vscode-inputValidation-warningBorder)',
            color:
              'var(--vscode-inputValidation-warningForeground, var(--vscode-editor-foreground))',
            fontSize: '12px',
          }}
        >
          <span className="codicon codicon-warning" style={{ flexShrink: 0, marginTop: '1px' }} />
          <span>
            <strong>Duplicate physicalPrefix detected:</strong>{' '}
            {duplicatePrefixes.map((p) => `"${p}"`).join(', ')} — multiple bus interfaces share this
            prefix, which will produce conflicting port names in generated HDL. Click an affected
            interface to correct its prefix.
          </span>
        </div>
      )}

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
              onCanvasSelect={handleCanvasSelect}
              canvasSelectedSubPortId={selectedSubPortId}
              onCanvasSelectSubPort={setSelectedSubPortId}
              onCanvasDragOver={onCanvasDragOver}
              onCanvasDrop={onCanvasDrop}
              onCanvasRemove={handleCanvasRemove}
              multiSelectedIds={multiSelectedIds}
              onShiftSelect={canvasShiftSelect}
              batchUpdate={batchUpdateIpCore}
              suggestionChips={activeSuggestions}
              onDismissSelection={canvasDeselectAll}
              onDismissSuggestion={handleDismissSuggestion}
              consistencyAnnotations={consistencyAnnotations}
            />
            {stagingData ? (
              <StagingOverlay
                files={stagingData.files}
                rootLabel={stagingData.rootLabel}
                mergedPaths={stagingMergedPaths}
                overwritePaths={stagingOverwritePaths}
                onMerge={mergeStagingFile}
                onToggleOverwrite={toggleStagingOverwrite}
                onConfirm={confirmStaging}
                onCancel={cancelStaging}
              />
            ) : showConsistencyOverlay && consistencyResult ? (
              <ConsistencyOverlay
                findings={consistencyResult.findings}
                summary={consistencyResult.summary}
                ignoredKeys={ignoredConsistencyKeys}
                onIgnore={handleIgnoreConsistencyFinding}
                onAdopt={handleAdoptConsistencyFinding}
                onSelectElement={handleSelectConsistencyElement}
                onRegenerate={handleRegenerateFromConsistency}
                onRecheck={handleCheckConsistency}
                isChecking={consistencyChecking}
                onClose={() => setShowConsistencyOverlay(false)}
              />
            ) : canvasSelected && typedIpCore ? (
              <CanvasInspector
                selected={canvasSelected}
                ipCore={typedIpCore}
                imports={imports}
                onUpdate={updateIpCore}
                batchUpdate={batchUpdateIpCore}
                onClose={canvasDeselect}
                onDelete={handleInspectorDelete}
                onUngroup={handleInspectorUngroup}
                onSelectElement={handleCanvasSelect}
              />
            ) : null}
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
  // Disable default right-click menu except on inputs
  document.addEventListener(
    'contextmenu',
    (e) => {
      const target = e.target as HTMLElement | null;
      if (
        target?.tagName === 'INPUT' ||
        target?.tagName === 'TEXTAREA' ||
        target?.isContentEditable
      ) {
        return;
      }
      e.preventDefault();
    },
    { capture: true }
  );

  const root = createRoot(container);
  root.render(<IpCoreApp />);
}
