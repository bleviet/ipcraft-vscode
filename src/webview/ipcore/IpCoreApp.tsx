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
import { LibraryPalette } from './components/canvas/LibraryPalette';
import { StagingOverlay, type StagedFileView } from './components/canvas/StagingOverlay';
import { vscode } from '../vscode';
import type { IpCore, BusInterface } from '../types/ipCore';
import { useGroupPorts } from './hooks/useGroupPorts';
import type { BatchUpdate } from './hooks/useGroupPorts';
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
  onContextMenu?: (e: React.MouseEvent) => void;
}

const ToolbarButton: React.FC<ToolbarButtonProps> = ({
  title,
  icon,
  command,
  disabled,
  onClick,
  onContextMenu,
}) => (
  <button
    className="canvas-view-toggle"
    title={title}
    type="button"
    disabled={disabled}
    onClick={onClick ?? (() => command && vscode?.postMessage({ type: 'command', command }))}
    onContextMenu={onContextMenu}
    aria-label={title}
    style={disabled ? { opacity: 0.4, cursor: 'not-allowed' } : undefined}
  >
    <span className={`codicon codicon-${icon}`} />
  </button>
);

interface HdlLanguagePickerProps {
  value: 'vhdl' | 'systemverilog';
}

const HdlLanguagePicker: React.FC<HdlLanguagePickerProps> = ({ value }) => {
  const set = (lang: 'vhdl' | 'systemverilog') =>
    vscode?.postMessage({ type: 'setHdlLanguage', language: lang });

  const pillStyle = (lang: 'vhdl' | 'systemverilog'): React.CSSProperties => {
    const active = value === lang;
    return {
      fontSize: '9px',
      fontWeight: 600,
      letterSpacing: '0.04em',
      lineHeight: 1,
      padding: '2px 4px',
      borderRadius: 3,
      border: 'none',
      cursor: active ? 'default' : 'pointer',
      userSelect: 'none',
      background: active
        ? lang === 'vhdl'
          ? 'rgba(224, 150, 50, 0.20)'
          : 'rgba(60, 150, 220, 0.20)'
        : 'transparent',
      color: active
        ? lang === 'vhdl'
          ? '#e09632'
          : '#3c96dc'
        : 'var(--vscode-descriptionForeground)',
      opacity: active ? 1 : 0.5,
    };
  };

  return (
    <div
      style={{ display: 'flex', flexDirection: 'column', gap: 2, justifyContent: 'center' }}
      title={
        value === 'vhdl' ? 'Click .SV to switch to SystemVerilog' : 'Click .VHD to switch to VHDL'
      }
    >
      <button
        style={pillStyle('vhdl')}
        onClick={() => set('vhdl')}
        type="button"
        aria-label="Use VHDL"
      >
        .VHD
      </button>
      <button
        style={pillStyle('systemverilog')}
        onClick={() => set('systemverilog')}
        type="button"
        aria-label="Use SystemVerilog"
      >
        .SV
      </button>
    </div>
  );
};

interface PackSummary {
  /** Directory name — used as the value in scaffold_pack: */
  id: string;
  /** Human-readable label derived from the id */
  label: string;
  /** Short description from scaffold.yml */
  description: string;
  /** 'builtin' | 'example' | 'workspace' */
  category: string;
}

interface ScaffoldPackPickerProps {
  selected: string; // pack id, e.g. "builtin-minimal"
  packs: PackSummary[];
}

const ScaffoldPackPicker: React.FC<ScaffoldPackPickerProps> = ({ selected, packs }) => {
  const groups: Record<string, PackSummary[]> = {};
  for (const p of packs) {
    const g = p.category || 'other';
    (groups[g] ??= []).push(p);
  }
  const groupOrder = ['builtin', 'example', 'workspace', 'other'];

  return (
    <select
      value={selected}
      onChange={(e) => vscode?.postMessage({ type: 'setScaffoldPack', packName: e.target.value })}
      aria-label="Scaffold pack"
      style={{
        background: 'var(--vscode-dropdown-background)',
        color: 'var(--vscode-dropdown-foreground)',
        border: '1px solid var(--vscode-dropdown-border)',
        borderRadius: 2,
        fontSize: '11px',
        padding: '2px 4px',
        cursor: 'pointer',
        outline: 'none',
        maxWidth: 180,
      }}
    >
      {groupOrder
        .filter((g) => groups[g]?.length)
        .map((g) => (
          <optgroup key={g} label={g.charAt(0).toUpperCase() + g.slice(1)}>
            {groups[g].map((p) => (
              <option key={p.id} value={p.id} title={p.description}>
                {p.label}
              </option>
            ))}
          </optgroup>
        ))}
    </select>
  );
};

/**
 * Multi-select toolbar target picker. Each pill toggles a toolchain id in/out
 * of the active set. The set is persisted to ipcraft.toolbar.targets.
 */

/** Well-known per-vendor display metadata. Unknown vendors fall back to defaults. */
const VENDOR_STYLE: Record<string, { label: string; bg: string; fg: string }> = {
  quartus: { label: 'ALTERA', bg: 'rgba(0, 113, 197, 0.20)', fg: '#0071c5' },
  vivado: { label: 'XILINX', bg: 'rgba(230, 0, 0, 0.20)', fg: '#e60000' },
};

const FALLBACK_STYLE = { bg: 'rgba(80, 200, 120, 0.20)', fg: '#3aaa5c' };

interface RegisteredToolchain {
  id: string;
  displayName: string;
}

interface TargetVendorPickerProps {
  value: string[];
  availableToolchains: RegisteredToolchain[];
}

const TargetVendorPicker: React.FC<TargetVendorPickerProps> = ({ value, availableToolchains }) => {
  const setTargets = (next: string[]) =>
    vscode?.postMessage({ type: 'setToolbarTargets', targets: next });

  const toggle = (id: string) => {
    const next = value.includes(id) ? value.filter((v) => v !== id) : [...value, id];
    setTargets(next);
  };

  const pillStyle = (id: string): React.CSSProperties => {
    const active = value.includes(id);
    const style = VENDOR_STYLE[id] ?? FALLBACK_STYLE;
    return {
      fontSize: '9px',
      fontWeight: 600,
      letterSpacing: '0.04em',
      lineHeight: 1,
      padding: '2px 4px',
      borderRadius: 3,
      border: 'none',
      cursor: 'pointer',
      userSelect: 'none',
      background: active ? style.bg : 'transparent',
      color: active ? style.fg : 'var(--vscode-descriptionForeground)',
      opacity: active ? 1 : 0.5,
    };
  };

  const labelFor = (tc: RegisteredToolchain): string => {
    const known = VENDOR_STYLE[tc.id];
    if (known) {
      return known.label;
    }
    return tc.displayName.split(/[\s(]/)[0].toUpperCase();
  };

  return (
    <div
      style={{ display: 'flex', flexDirection: 'column', gap: 2, justifyContent: 'center' }}
      title="Toggle which vendor toolchain sections show in the toolbar"
    >
      {availableToolchains.map((tc) => (
        <button
          key={tc.id}
          style={pillStyle(tc.id)}
          onClick={() => toggle(tc.id)}
          type="button"
          aria-label={`Toggle ${labelFor(tc)} tools`}
        >
          {labelFor(tc)}
        </button>
      ))}
    </div>
  );
};

interface ToolbarGroupProps {
  label: string;
  children: React.ReactNode;
}

const ToolbarGroup: React.FC<ToolbarGroupProps> = ({ label, children }) => (
  <div className="flex flex-col items-center gap-0.5">
    {/* Fixed-height icon row so every group's label lands on the same baseline */}
    <div className="flex items-center gap-0.5" style={{ height: 28 }}>
      {children}
    </div>
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
  const [stagingData, setStagingData] = useState<{
    files: StagedFileView[];
    rootLabel?: string;
  } | null>(null);

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
    { id: 'builtin-bahonavi', label: 'Bahonavi', description: '', category: 'builtin' },
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

  // Ungroup a bus interface: restore its signals to ports[], remove the interface
  const { ungroupBusInterface } = useGroupPorts(ipCore as unknown as IpCore, batchUpdateIpCore);

  const handleInspectorUngroup = React.useCallback(() => {
    if (canvasSelected?.kind !== 'busInterface') {
      return;
    }
    ungroupBusInterface(canvasSelected.index);
    canvasDeselect();
  }, [canvasSelected, ungroupBusInterface, canvasDeselect]);

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
          setStagingData(
            message.files ? { files: message.files, rootLabel: message.rootLabel } : null
          );
          break;
      }
    };

    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [updateFromYaml]);

  const typedIpCore = ipCore as unknown as Parameters<typeof EditorPanel>[0]['ipCore'];

  // Detect duplicate physicalPrefix values across all bus interfaces
  const duplicatePrefixes = useMemo((): string[] => {
    const buses = (ipCore as unknown as IpCore)?.busInterfaces ?? [];
    const prefixCount = new Map<string, number>();
    for (const bus of buses as BusInterface[]) {
      const p = bus.physicalPrefix ?? '';
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
              <ToolbarGroup label="Code Generation Methodology">
                <button
                  className="canvas-view-toggle"
                  title="Get Started with Scaffold Packs"
                  aria-label="Open scaffold packs walkthrough"
                  type="button"
                  onClick={() => vscode?.postMessage({ type: 'openWalkthroughMenu' })}
                >
                  <span className="codicon codicon-mortar-board" />
                </button>
                <ScaffoldPackPicker selected={scaffoldPack} packs={availableScaffoldPacks} />
              </ToolbarGroup>

              <div
                style={{
                  width: '1px',
                  height: '28px',
                  background: 'var(--vscode-panel-border)',
                  opacity: 0.6,
                }}
              />

              <ToolbarGroup label="Scaffold">
                <ToolbarButton
                  title="Scaffold Project (RTL + EDA packaging + Testbench)"
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
                  title="Create Register Map"
                  icon="map"
                  command="fpga-ip-core.createMemoryMap"
                />
                <ToolbarButton
                  title={`Generate Top-Level ${hdlLanguage === 'systemverilog' ? 'SystemVerilog' : 'VHDL'}`}
                  icon="code"
                  command="fpga-ip-core.generateHdl"
                />
                <HdlLanguagePicker value={hdlLanguage} />
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

              {toolbarTargets.includes('quartus') && (
                <>
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
                      title="Generate Platform Designer _hw.tcl component"
                      icon="layers"
                      command="fpga-ip-core.exportAltera"
                    />
                    <ToolbarButton
                      title={
                        hasHwTcl
                          ? 'Open in Platform Designer (Quartus)'
                          : 'Open in Platform Designer — run Generate Altera first'
                      }
                      icon="edit"
                      disabled={!hasHwTcl}
                      onClick={() => vscode?.postMessage({ type: 'editInPlatformDesigner' })}
                    />
                    <div
                      style={{
                        width: '1px',
                        height: '16px',
                        background: 'var(--vscode-panel-border)',
                        opacity: 0.5,
                        alignSelf: 'center',
                      }}
                    />
                    <ToolbarButton
                      title="Generate Quartus Project (creates .qpf)"
                      icon="circuit-board"
                      command="fpga-ip-core.generateQuartusProject"
                    />
                    <div
                      style={{
                        width: '1px',
                        height: '16px',
                        background: 'var(--vscode-panel-border)',
                        opacity: 0.5,
                        alignSelf: 'center',
                      }}
                    />
                    <ToolbarButton
                      title={
                        hasQpf
                          ? 'Open Project in Quartus'
                          : 'Open Project in Quartus — generate project first'
                      }
                      icon="folder-opened"
                      disabled={!hasQpf}
                      onClick={() => vscode?.postMessage({ type: 'openInQuartus' })}
                    />
                    <ToolbarButton
                      title={
                        hasQpf
                          ? 'Build: Quartus full compile'
                          : 'Build: Quartus full compile — generate project first'
                      }
                      icon="tools"
                      disabled={!hasQpf}
                      command="fpga-ip-core.buildQuartusCompile"
                    />
                  </ToolbarGroup>
                </>
              )}

              {toolbarTargets.includes('vivado') && (
                <>
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
                      title="Generate Vivado Component XML"
                      icon="layers"
                      command="fpga-ip-core.exportXilinx"
                    />
                    <ToolbarButton
                      title={
                        hasComponentXml
                          ? 'Edit in IP Packager (Vivado)'
                          : 'Edit in IP Packager — run Generate Component XML first'
                      }
                      icon="edit"
                      disabled={!hasComponentXml}
                      onClick={() => vscode?.postMessage({ type: 'editInIpPackager' })}
                    />
                    <div
                      style={{
                        width: '1px',
                        height: '16px',
                        background: 'var(--vscode-panel-border)',
                        opacity: 0.5,
                        alignSelf: 'center',
                      }}
                    />
                    <ToolbarButton
                      title="Generate Vivado Project (creates .xpr)"
                      icon="circuit-board"
                      command="fpga-ip-core.generateVivadoProject"
                    />
                    <div
                      style={{
                        width: '1px',
                        height: '16px',
                        background: 'var(--vscode-panel-border)',
                        opacity: 0.5,
                        alignSelf: 'center',
                      }}
                    />
                    <ToolbarButton
                      title={
                        hasXpr
                          ? 'Open Project in Vivado'
                          : 'Open Project in Vivado — generate project first'
                      }
                      icon="folder-opened"
                      disabled={!hasXpr}
                      onClick={() => vscode?.postMessage({ type: 'openInVivado' })}
                    />
                    <ToolbarButton
                      title={
                        hasXpr
                          ? 'Build: Vivado OOC synthesis'
                          : 'Build: Vivado OOC synthesis — generate project first'
                      }
                      icon="tools"
                      disabled={!hasXpr}
                      command="fpga-ip-core.buildVivadoOoc"
                    />
                  </ToolbarGroup>
                </>
              )}

              <div
                style={{
                  width: '1px',
                  height: '28px',
                  background: 'var(--vscode-panel-border)',
                  opacity: 0.6,
                }}
              />

              <TargetVendorPicker value={toolbarTargets} availableToolchains={allToolchains} />

              <div
                style={{
                  width: '1px',
                  height: '28px',
                  background: 'var(--vscode-panel-border)',
                  opacity: 0.6,
                }}
              />

              <ToolbarButton
                title="IPCraft Settings"
                icon="gear"
                command="fpga-ip-core.openSettings"
              />
            </div>
            {validationErrors.length > 0 && (
              <div className="text-sm" style={{ color: 'var(--vscode-errorForeground)' }}>
                {validationErrors.length} validation error(s)
              </div>
            )}
          </div>
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
              onCanvasSelect={canvasSelect}
              onCanvasDragOver={onCanvasDragOver}
              onCanvasDrop={onCanvasDrop}
              onCanvasRemove={handleCanvasRemove}
              multiSelectedIds={multiSelectedIds}
              onShiftSelect={canvasShiftSelect}
              batchUpdate={batchUpdateIpCore}
              suggestionChips={activeSuggestions}
              onDismissSelection={canvasDeselectAll}
              onDismissSuggestion={handleDismissSuggestion}
            />
            {stagingData ? (
              <StagingOverlay
                files={stagingData.files}
                rootLabel={stagingData.rootLabel}
                onConfirm={() => {
                  vscode?.postMessage({ type: 'stagingResult', confirmed: true });
                  setStagingData(null);
                }}
                onCancel={() => {
                  vscode?.postMessage({ type: 'stagingResult', confirmed: false });
                  setStagingData(null);
                }}
              />
            ) : canvasSelected && typedIpCore ? (
              <CanvasInspector
                selected={canvasSelected}
                ipCore={typedIpCore}
                imports={imports}
                onUpdate={updateIpCore}
                onClose={canvasDeselect}
                onDelete={handleInspectorDelete}
                onUngroup={handleInspectorUngroup}
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
  const root = createRoot(container);
  root.render(<IpCoreApp />);
}
