import React, { useCallback, useState, useRef, useMemo } from 'react';
import { createRoot } from 'react-dom/client';
import { useIpCoreState } from './hooks/useIpCoreState';
import { useIpCoreBridge } from './hooks/useIpCoreBridge';
import { useIpCoreSelectionController } from './hooks/useIpCoreSelectionController';
import { useCanvasDrop } from './hooks/useCanvasDrop';
import { useCanvasUndo } from './hooks/useCanvasUndo';
import { useCanvasCommands } from './hooks/useCanvasCommands';
import { useProtocolSuggestions } from './hooks/useProtocolSuggestions';
import { useStagingSession } from './hooks/useStagingSession';
import { useConsistencySession } from './hooks/useConsistencySession';
import { useToolbarSettings } from './hooks/useToolbarSettings';
import { IpCoreShell } from './components/IpCoreShell';
import { IpCoreRightPanel } from './components/IpCoreRightPanel';
import type { IpCoreToolbarProps } from './components/IpCoreToolbar';
import { EditorPanel } from './components/layout/EditorPanel';
import type { IpCore, BusInterface } from '../types/ipCore';
import { useGroupPorts } from './hooks/useGroupPorts';
import type { BatchUpdate } from './hooks/useGroupPorts';
import { lookupBusDef, lookupBusDefFromLibrary } from './data/busDefinitions';
import '@vscode/codicons/dist/codicon.css';
import '../index.css';

/**
 * Main IP Core Visual Editor application.
 *
 * Composes the document/undo controller, the sync bridge to the extension
 * host, the selection controller, and the staging/consistency/toolbar
 * sessions, then renders the `IpCoreShell` chrome around `EditorPanel` and
 * `IpCoreRightPanel`. Interaction and rendering detail lives in those
 * composed hooks/components (issue #129) — this component's own logic is
 * limited to wiring them together and the few pieces of state (undo
 * wrapping, toast, duplicate-prefix detection) too small to be worth a
 * dedicated hook.
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
    updateIpCoreBatch,
    getValidationErrors,
  } = useIpCoreState();

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
  const updateIpCore = useCallback(
    (path: Array<string | number>, value: unknown) => {
      pushUndo();
      baseUpdateIpCore(path, value);
    },
    [baseUpdateIpCore, pushUndo]
  );

  // Atomic batch update — single undo entry + single state transition for
  // multi-mutation operations (e.g., grouping).
  const batchUpdateIpCore: BatchUpdate = useCallback(
    (mutations) => {
      pushUndo();
      updateIpCoreBatch(mutations);
    },
    [updateIpCoreBatch, pushUndo]
  );

  const staging = useStagingSession();
  const toolbarSettings = useToolbarSettings();

  // Transient toast notification
  const [toast, setToast] = useState<string | null>(null);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const showToast = useCallback((message: string) => {
    if (toastTimerRef.current) {
      clearTimeout(toastTimerRef.current);
    }
    setToast(message);
    toastTimerRef.current = setTimeout(() => setToast(null), 4000);
  }, []);

  // Canvas element selection: single + multi-select, plus the individually
  // selected bus sub-port id.
  const selection = useIpCoreSelectionController();
  const multiSelectedIds = useMemo(
    () => new Set(selection.multiSelection.all.keys()),
    [selection.multiSelection.all]
  );

  // Consistency check (issue #84) — request/response and result-driven actions.
  const consistency = useConsistencySession({
    ipCore,
    updateIpCore,
    onSelectElement: selection.select,
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
    onSelect: selection.select,
  });

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

  // Model-mutating canvas commands (remove/duplicate/delete/ungroup) plus the
  // global Delete/Ctrl+D keyboard shortcut.
  const { handleCanvasRemove, handleInspectorDelete, handleInspectorUngroup } = useCanvasCommands({
    ipCore: ipCore as unknown as IpCore,
    updateIpCore,
    canvasSelected: selection.selected,
    canvasSelectedId: selection.selectedId,
    canvasDeselect: selection.deselect,
    selectedSubPortId: selection.selectedSubPortId,
    clearSubPort: selection.clearSubPort,
    ungroupBusInterface,
    showToast,
  });

  const validationErrors = getValidationErrors();

  // The single boundary to the extension host: ready handshake, debounced
  // outbound updates, and revision-filtered inbound `update`/staging/
  // consistency messages.
  useIpCoreBridge({
    rawYaml,
    onUpdate: useCallback(
      (message) => {
        updateFromYaml(message.text, message.fileName, message.imports);
        toolbarSettings.applyFromUpdateMessage(message);
      },
      [updateFromYaml, toolbarSettings]
    ),
    onStagingStart: staging.handleStagingStart,
    onStagingFileMerged: useCallback(
      (message) => staging.handleStagingFileMerged(message.relativePath),
      [staging]
    ),
    onConsistencyResult: consistency.handleConsistencyResultMessage,
  });

  const typedIpCore = ipCore as unknown as Parameters<typeof EditorPanel>[0]['ipCore'];
  const vlnv = typedIpCore?.vlnv && typeof typedIpCore.vlnv === 'object' ? typedIpCore.vlnv : null;

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

  const toolbarProps: IpCoreToolbarProps = {
    canUndo,
    canRedo,
    onUndo: undo,
    onRedo: redo,
    toolbarTargets: toolbarSettings.toolbarTargets,
    allToolchains: toolbarSettings.allToolchains,
    hdlLanguage: toolbarSettings.hdlLanguage,
    scaffoldPack: toolbarSettings.scaffoldPack,
    availableScaffoldPacks: toolbarSettings.availableScaffoldPacks,
    hasHwTcl: toolbarSettings.hasHwTcl,
    hasQpf: toolbarSettings.hasQpf,
    hasComponentXml: toolbarSettings.hasComponentXml,
    hasXpr: toolbarSettings.hasXpr,
    consistencyChecking: consistency.consistencyChecking,
    hasConsistencyResult: consistency.consistencyResult !== null,
    consistencyBadge: consistency.consistencyBadge,
    onCheckConsistency: consistency.handleCheckConsistency,
    onToggleConsistencyOverlay: () => consistency.setShowConsistencyOverlay((v) => !v),
    validationErrorCount: validationErrors.length,
  };

  return (
    <IpCoreShell
      fileName={fileName}
      vlnv={vlnv}
      toolbarProps={toolbarProps}
      isPreview={toolbarSettings.isPreview}
      duplicatePrefixes={duplicatePrefixes}
      parseError={parseError}
      hasIpCore={!!ipCore}
      busLibrary={imports?.busLibrary}
      editorPanelProps={{
        ipCore: typedIpCore,
        imports,
        onUpdate: updateIpCore,
        isFocused: true,
        canvasSelectedId: selection.selectedId,
        onCanvasSelect: selection.select,
        canvasSelectedSubPortId: selection.selectedSubPortId,
        onCanvasSelectSubPort: selection.selectSubPort,
        onCanvasDragOver: onCanvasDragOver,
        onCanvasDrop: onCanvasDrop,
        onCanvasRemove: handleCanvasRemove,
        multiSelectedIds,
        onShiftSelect: selection.shiftSelect,
        batchUpdate: batchUpdateIpCore,
        suggestionChips: activeSuggestions,
        onDismissSelection: selection.deselectAll,
        onDismissSuggestion: handleDismissSuggestion,
        consistencyAnnotations: consistency.consistencyAnnotations,
      }}
      rightPanel={
        <IpCoreRightPanel
          staging={staging}
          consistency={consistency}
          canvasSelected={selection.selected}
          ipCore={typedIpCore}
          imports={imports}
          onUpdate={updateIpCore}
          batchUpdate={batchUpdateIpCore}
          onCloseInspector={selection.deselect}
          onDeleteInspector={handleInspectorDelete}
          onUngroupInspector={handleInspectorUngroup}
          onSelectElement={selection.select}
        />
      }
      validationErrors={validationErrors}
      toast={toast}
    />
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
