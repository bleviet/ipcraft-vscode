import React, { useState, useRef, useEffect, useLayoutEffect, useCallback, useMemo } from 'react';
import type {
  IpCore,
  Clock,
  Reset,
  Port,
  BusInterface,
  ConduitPort,
  Interrupt,
} from '../../../types/ipCore';
import type { YamlUpdateHandler } from '../../../types/editor';
import type { CanvasElement, CanvasElementKind } from '../../hooks/useCanvasSelection';
import {
  validateVhdlIdentifier,
  validateUniqueName,
  validateRequired,
  validateVersion,
} from '../../../shared/utils/validation';
import {
  lookupBusDef,
  lookupBusDefFromLibrary,
  isConduitType,
  BUILTIN_BUS_TYPES,
  listLibraryBusTypes,
  type BusPortDef,
} from '../../data/busDefinitions';
import { vscode } from '../../../vscode';
import { evalWidthExpr } from '../../../shared/utils/evalWidthExpr';
import { WidthFunctionHelpMenu } from '../../../shared/components';
import { WIDTH_FUNCTION_HELP } from '../../../shared/utils/widthFunctionHelp';
import { getIdentifierTokenAtCursor } from '../../../shared/utils/widthExprToken';
import { BUS_VLNV, busSupportsMemoryMap } from '../../../../shared/busVlnv';
import { isValidVlnv } from '../../../../utils/vlnv';
import { MapConduitToBusDialog, type MapConduitToBusResult } from './MapConduitToBusDialog';
import { applyMapConduitToKnownBus, type BatchUpdate } from '../../hooks/useGroupPorts';

interface CanvasInspectorProps {
  selected: CanvasElement | null;
  ipCore: IpCore;
  imports?: { busLibrary?: unknown; memoryMaps?: unknown[] };
  onUpdate: YamlUpdateHandler;
  /** Apply several path/value mutations as one atomic edit (single undo entry). */
  batchUpdate?: BatchUpdate;
  onClose: () => void;
  onDelete?: () => void;
  /** Dissolve a bus interface and restore its signals to the standalone ports list */
  onUngroup?: () => void;
  /** Switch the canvas selection (e.g. drill from the Generics overview into a single parameter) */
  onSelectElement?: (id: string) => void;
}

const INSPECTOR_WIDTH_KEY = 'ipcraft.inspectorWidth';
const INSPECTOR_MIN_WIDTH = 240;
const INSPECTOR_MAX_WIDTH = 640;
const INSPECTOR_DEFAULT_WIDTH = 288;

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
  // Resize state — hooks must come before any early return
  const [panelWidth, setPanelWidth] = useState<number>(() => {
    try {
      const stored = sessionStorage.getItem(INSPECTOR_WIDTH_KEY);
      if (stored) {
        const w = parseInt(stored, 10);
        if (w >= INSPECTOR_MIN_WIDTH && w <= INSPECTOR_MAX_WIDTH) {
          return w;
        }
      }
    } catch {
      // sessionStorage may be unavailable in some webview contexts
    }
    return INSPECTOR_DEFAULT_WIDTH;
  });
  const panelWidthRef = useRef(panelWidth);

  const handleResizeMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startWidth = panelWidthRef.current;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';

    const onMouseMove = (ev: MouseEvent) => {
      // dragging left (smaller clientX) widens the right-anchored panel
      const delta = startX - ev.clientX;
      const newWidth = Math.max(
        INSPECTOR_MIN_WIDTH,
        Math.min(INSPECTOR_MAX_WIDTH, startWidth + delta)
      );
      panelWidthRef.current = newWidth;
      setPanelWidth(newWidth);
    };

    const onMouseUp = () => {
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      try {
        sessionStorage.setItem(INSPECTOR_WIDTH_KEY, String(panelWidthRef.current));
      } catch {
        // ignore
      }
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
    };

    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  }, []);

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

  return (
    <div className="canvas-inspector" style={{ width: panelWidth }}>
      {/* ── Resize handle (drag left edge to widen / narrow) ── */}
      <div className="ci-resize-handle" onMouseDown={handleResizeMouseDown} />

      {/* ── Header ── */}
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

      {/* ── Body ── */}
      <div className="ci-body">
        {renderPanel(selected, ipCore, onUpdate, imports, onSelectElement, batchUpdate)}
      </div>

      {/* ── Footer ── */}
      {selected.kind !== 'body' && selected.kind !== 'generics' && (onDelete ?? onUngroup) && (
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

// ─────────────────────────────────────────────────────
//  Panel router
// ─────────────────────────────────────────────────────

function renderPanel(
  element: CanvasElement,
  ipCore: IpCore,
  onUpdate: YamlUpdateHandler,
  imports?: { busLibrary?: unknown; memoryMaps?: unknown[] },
  onSelectElement?: (id: string) => void,
  batchUpdate?: BatchUpdate
): React.ReactNode {
  switch (element.kind) {
    case 'body':
      return <BodyPanel ipCore={ipCore} onUpdate={onUpdate} />;
    case 'generics':
      return (
        <GenericsOverviewPanel
          ipCore={ipCore}
          onUpdate={onUpdate}
          onSelectElement={onSelectElement}
        />
      );

    case 'clock': {
      const clock = (ipCore.clocks ?? [])[element.index] as Clock | undefined;
      if (!clock) {
        return <EmptyState label="Clock not found" />;
      }
      return <ClockPanel clock={clock} index={element.index} ipCore={ipCore} onUpdate={onUpdate} />;
    }
    case 'reset': {
      const reset = (ipCore.resets ?? [])[element.index] as Reset | undefined;
      if (!reset) {
        return <EmptyState label="Reset not found" />;
      }
      return <ResetPanel reset={reset} index={element.index} ipCore={ipCore} onUpdate={onUpdate} />;
    }
    case 'port': {
      const port = (ipCore.ports ?? [])[element.index] as Port | undefined;
      if (!port) {
        return <EmptyState label="Port not found" />;
      }
      return <PortPanel port={port} index={element.index} ipCore={ipCore} onUpdate={onUpdate} />;
    }
    case 'busInterface': {
      const bus = (ipCore.busInterfaces ?? [])[element.index] as BusInterface | undefined;
      if (!bus) {
        return <EmptyState label="Bus interface not found" />;
      }
      return (
        <BusPanel
          key={element.index}
          bus={bus}
          index={element.index}
          ipCore={ipCore}
          imports={imports}
          onUpdate={onUpdate}
        />
      );
    }
    case 'parameter': {
      const param = (ipCore.parameters ?? [])[element.index] as unknown as
        | Record<string, unknown>
        | undefined;
      if (!param) {
        return <EmptyState label="Parameter not found" />;
      }
      return (
        <ParameterPanel
          param={param}
          index={element.index}
          ipCore={ipCore}
          onUpdate={onUpdate}
          batchUpdate={batchUpdate}
        />
      );
    }
    case 'interrupt': {
      const interrupt = ((ipCore.interrupts ?? []) as Interrupt[])[element.index];
      if (!interrupt) {
        return <EmptyState label="Interrupt not found" />;
      }
      return (
        <InterruptPanel
          interrupt={interrupt}
          index={element.index}
          ipCore={ipCore}
          onUpdate={onUpdate}
        />
      );
    }
    case 'subcore': {
      const rawSubcores = (ipCore.subcores ?? []) as Array<
        string | { vlnv: string; path?: string }
      >;
      const sub = rawSubcores[element.index];
      if (sub === undefined) {
        return <EmptyState label="Dependency not found" />;
      }
      return <SubcorePanel entry={sub} index={element.index} ipCore={ipCore} onUpdate={onUpdate} />;
    }
    default:
      return <EmptyState label="Select a port on the canvas to inspect it" />;
  }
}

// ─────────────────────────────────────────────────────
//  IP Core body panel (VLNV + description)
// ─────────────────────────────────────────────────────

const BodyPanel: React.FC<{ ipCore: IpCore; onUpdate: YamlUpdateHandler }> = ({
  ipCore,
  onUpdate,
}) => (
  <>
    <Section title="VLNV">
      <PropField
        label="Vendor"
        value={ipCore.vlnv.vendor}
        onSave={(v) => onUpdate(['vlnv', 'vendor'], v)}
        validate={validateRequired}
        placeholder="my-company.com"
      />
      <PropField
        label="Library"
        value={ipCore.vlnv.library}
        onSave={(v) => onUpdate(['vlnv', 'library'], v)}
        validate={validateRequired}
        placeholder="my_lib"
        mono
      />
      <PropField
        label="Name"
        value={ipCore.vlnv.name}
        onSave={(v) => onUpdate(['vlnv', 'name'], v)}
        validate={(v) => validateVhdlIdentifier(v)}
        placeholder="my_core"
        mono
      />
      <PropField
        label="Version"
        value={ipCore.vlnv.version}
        onSave={(v) => onUpdate(['vlnv', 'version'], v)}
        validate={validateVersion}
        placeholder="1.0.0"
        mono
      />
    </Section>
    <Section title="Details">
      <PropTextArea
        label="Description"
        value={ipCore.description ?? ''}
        onSave={(v) => onUpdate(['description'], v || null)}
        placeholder="Describe this IP core…"
      />
    </Section>
    <FileSetsSection ipCore={ipCore} onUpdate={onUpdate} />
    <DependenciesSection ipCore={ipCore} onUpdate={onUpdate} />
  </>
);

// ─────────────────────────────────────────────────────
//  Source files section (body panel)
// ─────────────────────────────────────────────────────

interface FsFileEntry {
  path: string;
  type: string;
  managed?: boolean;
  version?: string;
}

const VHDL_VERSION_OPTIONS = ['', '87', '93', '2002', '2008', '2019'];

interface FsFileSet {
  name: string;
  files?: FsFileEntry[];
}

const FileSetsSection: React.FC<{ ipCore: IpCore; onUpdate: YamlUpdateHandler }> = ({
  ipCore,
  onUpdate,
}) => {
  const fileSets =
    ((ipCore as unknown as Record<string, unknown>).fileSets as FsFileSet[] | undefined) ?? [];
  const [fileExistence, setFileExistence] = useState<Record<string, boolean>>({});

  useEffect(() => {
    const allPaths = fileSets.flatMap((fs) => (fs.files ?? []).map((f) => f.path));
    if (!allPaths.length) {
      return;
    }
    vscode?.postMessage({ type: 'checkFilesExist', paths: allPaths });
    const handler = (event: MessageEvent) => {
      const msg = event.data as { type?: string; results?: Record<string, boolean> };
      if (msg.type === 'filesExistResult' && msg.results) {
        setFileExistence((prev) => ({ ...prev, ...msg.results }));
        window.removeEventListener('message', handler);
      }
    };
    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, [fileSets]);

  if (!fileSets.length) {
    return null;
  }

  const handleOpenFile = (path: string) => {
    if (fileExistence[path] === false) {
      return;
    }
    vscode?.postMessage({ type: 'openFile', path });
  };

  const handleAddFiles = (setIdx: number) => {
    vscode?.postMessage({ type: 'selectFiles', multi: true });
    const existing = fileSets[setIdx].files ?? [];
    const handler = (event: MessageEvent) => {
      const msg = event.data as { type?: string; files?: string[] };
      if (msg.type === 'filesSelected' && msg.files?.length) {
        const newFiles = msg.files.map((p) => ({ path: p, type: fsInferType(p) }));
        onUpdate(['fileSets', setIdx, 'files'], [...existing, ...newFiles]);
        window.removeEventListener('message', handler);
      }
    };
    window.addEventListener('message', handler);
  };

  const handleRemoveFile = (setIdx: number, fileIdx: number) => {
    const files = fileSets[setIdx].files ?? [];
    const updated = files.filter((_, i) => i !== fileIdx);
    onUpdate(['fileSets', setIdx, 'files'], updated.length ? updated : undefined);
  };

  const handleToggleManaged = (setIdx: number, fileIdx: number) => {
    const files = fileSets[setIdx].files ?? [];
    const file = files[fileIdx];
    const updatedFile: FsFileEntry = { ...file };
    if (file.managed === false) {
      delete updatedFile.managed;
    } else {
      updatedFile.managed = false;
    }
    const updatedFiles = [...files];
    updatedFiles[fileIdx] = updatedFile;
    onUpdate(['fileSets', setIdx, 'files'], updatedFiles);
  };

  const handleSetVersion = (setIdx: number, fileIdx: number, version: string) => {
    const files = fileSets[setIdx].files ?? [];
    const updatedFile: FsFileEntry = { ...files[fileIdx] };
    if (version) {
      updatedFile.version = version;
    } else {
      delete updatedFile.version;
    }
    const updatedFiles = [...files];
    updatedFiles[fileIdx] = updatedFile;
    onUpdate(['fileSets', setIdx, 'files'], updatedFiles);
  };

  const allFiles = fileSets.flatMap((fs) => fs.files ?? []);
  const allLocked = allFiles.length > 0 && allFiles.every((f) => f.managed === false);

  const handleLockAll = () => {
    const updated = fileSets.map((fs) => ({
      ...fs,
      files: (fs.files ?? []).map((f) => ({ ...f, managed: false as const })),
    }));
    onUpdate(['fileSets'], updated);
  };

  const handleUnlockAll = () => {
    const updated = fileSets.map((fs) => ({
      ...fs,
      files: (fs.files ?? []).map((f) => {
        const { managed: _managed, ...rest } = f;
        return rest;
      }),
    }));
    onUpdate(['fileSets'], updated);
  };

  const sectionActions =
    allFiles.length > 0 ? (
      <button
        className="ci-section__action-btn"
        onClick={allLocked ? handleUnlockAll : handleLockAll}
        title={
          allLocked
            ? 'Unlock all files — allow IPCraft to overwrite on regeneration'
            : 'Lock all files — protect all from overwrite'
        }
        type="button"
        style={{ color: allLocked ? 'var(--vscode-statusBarItem-warningForeground)' : undefined }}
      >
        <span className={`codicon ${allLocked ? 'codicon-unlock' : 'codicon-lock'}`} />
        <span>{allLocked ? 'Unlock All' : 'Lock All'}</span>
      </button>
    ) : undefined;

  return (
    <Section title="Source Files" actions={sectionActions}>
      {fileSets.map((fs, setIdx) => (
        <div key={setIdx} className="ci-fileset">
          {fileSets.length > 1 && <div className="ci-fileset__group">{fs.name}</div>}
          {(fs.files ?? []).length === 0 && <div className="ci-override-empty">No files</div>}
          {(fs.files ?? []).map((file, fileIdx) => {
            const filename = file.path.split('/').pop() ?? file.path;
            const missing = fileExistence[file.path] === false;
            return (
              <div key={fileIdx} className="ci-fileset__row">
                <span
                  className={`codicon ${missing ? 'codicon-warning' : fsFileIcon(file.type)}`}
                  style={{
                    fontSize: 11,
                    color: missing ? 'var(--vscode-errorForeground)' : undefined,
                    opacity: missing ? 1 : 0.55,
                    flexShrink: 0,
                  }}
                />
                <span
                  className={`ci-fileset__name${missing ? ' ci-fileset__name--missing' : ''}`}
                  title={file.path}
                  onClick={() => handleOpenFile(file.path)}
                  style={{ cursor: missing ? 'not-allowed' : 'pointer' }}
                >
                  {filename}
                </span>
                {file.type === 'vhdl' && (
                  <select
                    className="ci-fileset__version"
                    value={file.version ?? ''}
                    onChange={(e) => handleSetVersion(setIdx, fileIdx, e.target.value)}
                    onClick={(e) => e.stopPropagation()}
                    title="VHDL standard used by Vivado packaging"
                  >
                    {VHDL_VERSION_OPTIONS.map((v) => (
                      <option key={v} value={v}>
                        {v ? v : '2008 (default)'}
                      </option>
                    ))}
                  </select>
                )}
                <button
                  className="ci-fileset__rm"
                  onClick={() => handleToggleManaged(setIdx, fileIdx)}
                  title={
                    file.managed === false
                      ? 'Allow IPCraft to overwrite this file on regeneration'
                      : 'Protect from overwrite — mark as user-managed'
                  }
                  type="button"
                  style={{
                    color:
                      file.managed === false
                        ? 'var(--vscode-statusBarItem-warningForeground)'
                        : undefined,
                    opacity: file.managed === false ? 1 : 0.35,
                  }}
                >
                  <span
                    className={`codicon ${file.managed === false ? 'codicon-lock' : 'codicon-unlock'}`}
                  />
                </button>
                <button
                  className="ci-fileset__rm"
                  onClick={() => handleRemoveFile(setIdx, fileIdx)}
                  title="Remove file"
                  type="button"
                >
                  <span className="codicon codicon-close" />
                </button>
              </div>
            );
          })}
          <button className="ci-fileset__add" onClick={() => handleAddFiles(setIdx)} type="button">
            <span className="codicon codicon-add" /> Add
          </button>
        </div>
      ))}
    </Section>
  );
};

function fsFileIcon(type: string): string {
  switch (type) {
    case 'vhdl':
    case 'verilog':
    case 'systemverilog':
      return 'codicon-circuit-board';
    case 'tcl':
      return 'codicon-terminal';
    case 'python':
      return 'codicon-snake';
    case 'xdc':
    case 'sdc':
    case 'ucf':
      return 'codicon-lock';
    case 'xml':
      return 'codicon-file-code';
    case 'pdf':
    case 'markdown':
    case 'text':
      return 'codicon-markdown';
    default:
      return 'codicon-file';
  }
}

function fsInferType(path: string): string {
  const ext = path.split('.').pop()?.toLowerCase() ?? '';
  switch (ext) {
    case 'vhd':
    case 'vhdl':
      return 'vhdl';
    case 'v':
      return 'verilog';
    case 'sv':
      return 'systemverilog';
    case 'tcl':
      return 'tcl';
    case 'py':
      return 'python';
    case 'xdc':
      return 'xdc';
    case 'sdc':
      return 'sdc';
    case 'ucf':
      return 'ucf';
    case 'xml':
      return 'xml';
    case 'pdf':
      return 'pdf';
    case 'md':
      return 'markdown';
    default:
      return 'unknown';
  }
}

// ─────────────────────────────────────────────────────
//  Dependencies section (inside BodyPanel)
// ─────────────────────────────────────────────────────

const DependenciesSection: React.FC<{ ipCore: IpCore; onUpdate: YamlUpdateHandler }> = ({
  ipCore,
  onUpdate,
}) => {
  const rawSubcores = (ipCore.subcores ?? []) as Array<string | { vlnv: string; path?: string }>;

  // Listen for the subcoreAdded response from the extension host QuickPick
  useEffect(() => {
    const handler = (event: MessageEvent) => {
      const message = event.data as { type?: string; vlnv?: string };
      if (message.type === 'subcoreAdded' && message.vlnv) {
        const updated = [...rawSubcores, message.vlnv];
        onUpdate(['subcores'], updated);
      }
    };
    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, [rawSubcores, onUpdate]);

  const handleAdd = () => {
    vscode?.postMessage({ type: 'addSubcore' });
  };

  const handleDelete = (index: number) => {
    const updated = rawSubcores.filter((_, i) => i !== index);
    onUpdate(['subcores'], updated.length ? updated : null);
  };

  return (
    <Section title="Dependencies">
      {rawSubcores.length === 0 && <div className="ci-override-empty">No dependencies</div>}
      <div className="ci-fileset">
        {rawSubcores.map((sub, i) => {
          const vlnv = typeof sub === 'string' ? sub : sub.vlnv;
          const shortName = vlnv.split(':')[2] ?? vlnv;
          return (
            <div key={i} className="ci-fileset__row">
              <span className="codicon codicon-link" style={{ fontSize: 11, flexShrink: 0 }} />
              <span className="ci-fileset__name" title={vlnv}>
                {shortName}
              </span>
              <button
                className="ci-fileset__rm"
                title={`Remove ${vlnv}`}
                onClick={() => handleDelete(i)}
              >
                <span className="codicon codicon-trash" />
              </button>
            </div>
          );
        })}
        <button className="ci-fileset__add" onClick={handleAdd}>
          <span className="codicon codicon-add" />
          Add Dependency
        </button>
      </div>
    </Section>
  );
};

// ─────────────────────────────────────────────────────
//  Individual subcore / dependency panel
// ─────────────────────────────────────────────────────

interface SubcorePanelProps {
  entry: string | { vlnv: string; path?: string };
  index: number;
  ipCore: IpCore;
  onUpdate: YamlUpdateHandler;
}

const SubcorePanel: React.FC<SubcorePanelProps> = ({ entry, index, ipCore, onUpdate }) => {
  const vlnv = typeof entry === 'string' ? entry : entry.vlnv;
  const path = typeof entry === 'object' ? entry.path : undefined;
  const rawSubcores = (ipCore.subcores ?? []) as Array<string | { vlnv: string; path?: string }>;

  const handleOpenFile = () => {
    if (path) {
      vscode?.postMessage({ type: 'openFile', path });
    }
  };

  return (
    <>
      <Section title="Dependency">
        <PropField
          label="VLNV"
          value={vlnv}
          onSave={(v) => {
            const current = rawSubcores[index];
            const updated = [...rawSubcores];
            if (typeof current === 'object') {
              updated[index] = { ...current, vlnv: v };
            } else {
              updated[index] = v;
            }
            onUpdate(['subcores'], updated);
          }}
          validate={validateRequired}
          placeholder="vendor:library:name:version"
          mono
        />
        {path !== undefined && (
          <PropField
            label="Path"
            value={path ?? ''}
            onSave={(v) => {
              const updated = [...rawSubcores];
              const current = updated[index];
              const base = typeof current === 'string' ? { vlnv: current } : { ...current };
              updated[index] = { ...base, path: v || undefined };
              onUpdate(['subcores'], updated);
            }}
            placeholder="path/to/core"
            mono
          />
        )}
      </Section>
      {path && (
        <div className="ci-fileset" style={{ paddingTop: 0 }}>
          <button className="ci-fileset__add" onClick={handleOpenFile}>
            <span className="codicon codicon-go-to-file" />
            Open File
          </button>
        </div>
      )}
    </>
  );
};

// ─────────────────────────────────────────────────────
//  Parameter / generic panel
// ─────────────────────────────────────────────────────

interface PropCheckboxProps {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}

const PropCheckbox: React.FC<PropCheckboxProps> = ({ label, checked, onChange }) => {
  return (
    <div
      className="ci-field"
      style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '8px 0' }}
    >
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        style={{ cursor: 'pointer', margin: 0 }}
      />
      <label
        className="ci-field__label"
        style={{ marginBottom: 0, cursor: 'pointer', userSelect: 'none' }}
      >
        {label}
      </label>
    </div>
  );
};

interface TagInputProps {
  label: string;
  values: Array<string | number>;
  onChange: (newValues: Array<string | number> | null) => void;
  isNumeric?: boolean;
  placeholder?: string;
}

const TagInput: React.FC<TagInputProps> = ({
  label,
  values = [],
  onChange,
  isNumeric = false,
  placeholder,
}) => {
  const [input, setInput] = useState('');
  const [error, setError] = useState('');

  const defaultPlaceholder = isNumeric ? 'e.g. 8, 16, 32' : 'e.g. fast, slow, normal';
  const effectivePlaceholder = placeholder ?? defaultPlaceholder;

  const commit = () => {
    const val = input.trim();
    if (!val) {
      return;
    }

    if (isNumeric) {
      const parsed = Number(val);
      if (!Number.isFinite(parsed)) {
        setError('Must be a number');
        return;
      }
      if (!values.includes(parsed)) {
        onChange([...values, parsed]);
      }
    } else {
      if (!values.includes(val)) {
        onChange([...values, val]);
      }
    }
    setInput('');
    setError('');
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      commit();
    } else if (e.key === 'Escape') {
      setInput('');
      setError('');
    } else {
      setError('');
    }
  };

  const removeValue = (val: string | number) => {
    const next = values.filter((v) => v !== val);
    onChange(next.length ? next : null);
  };

  return (
    <div className="ci-field">
      <label className="ci-field__label">{label}</label>
      <div className="ci-field__input-row">
        <input
          className="ci-field__input"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={effectivePlaceholder}
        />
        <button
          className="ci-pw-mode-toggle"
          style={{
            width: 'auto',
            padding: '0 6px',
            fontSize: 11,
            height: 'auto',
            alignSelf: 'stretch',
            opacity: input.trim() ? 1 : 0.4,
          }}
          onClick={commit}
          title="Add value"
        >
          Add
        </button>
      </div>
      {error && <div className="ci-field__error">{error}</div>}
      {!error && (
        <div className="ci-field__hint">
          {values.length === 0
            ? isNumeric
              ? 'Type a number and click Add or press Enter'
              : 'Type a value and click Add or press Enter'
            : 'Click × on a chip to remove it'}
        </div>
      )}
      {values.length > 0 && (
        <div className="ci-chips" style={{ marginTop: 4 }}>
          {values.map((val, i) => (
            <span
              key={i}
              className="ci-chip"
              style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}
            >
              {String(val)}
              <span
                className="codicon codicon-close"
                style={{ fontSize: 9, cursor: 'pointer', opacity: 0.6 }}
                onClick={() => removeValue(val)}
                title={`Remove ${val}`}
              />
            </span>
          ))}
        </div>
      )}
    </div>
  );
};

// ─── GUI Placement helpers (shared by ParameterPanel + GenericsOverviewPanel) ──

/** All unique non-empty uiPage values already used by any parameter in this IP core. */
function computeParamPages(params: Array<Record<string, unknown>>): string[] {
  return [...new Set(params.map((p) => (p.uiPage ? String(p.uiPage) : '')).filter(Boolean))].sort();
}

/** All unique non-empty uiGroup values already used by parameters on the given page. */
function computeParamGroups(params: Array<Record<string, unknown>>, page: string): string[] {
  return [
    ...new Set(
      params
        .filter((p) => p.uiPage && String(p.uiPage) === page)
        .map((p) => (p.uiGroup ? String(p.uiGroup) : ''))
        .filter(Boolean)
    ),
  ].sort();
}

type Mutation = [Array<string | number>, unknown];

/** Apply several parameter mutations as one atomic edit when possible, falling back to
 *  sequential single-path updates (e.g. in tests that don't pass a `batchUpdate` prop). */
function applyBulkUpdate(
  mutations: Mutation[],
  onUpdate: YamlUpdateHandler,
  batchUpdate?: BatchUpdate
): void {
  if (mutations.length === 0) {
    return;
  }
  if (batchUpdate) {
    batchUpdate(mutations);
  } else {
    mutations.forEach(([path, value]) => onUpdate(path, value));
  }
}

/** Rename a Page across every parameter that references it. */
function renamePage(
  params: Array<Record<string, unknown>>,
  oldName: string,
  newName: string,
  onUpdate: YamlUpdateHandler,
  batchUpdate?: BatchUpdate
): void {
  const mutations: Mutation[] = [];
  params.forEach((p, i) => {
    if (p.uiPage && String(p.uiPage) === oldName) {
      mutations.push([['parameters', i, 'uiPage'], newName]);
    }
  });
  applyBulkUpdate(mutations, onUpdate, batchUpdate);
}

/** Delete a Page — clears uiPage (and uiGroup, which requires a page) on every parameter that used it. */
function deletePage(
  params: Array<Record<string, unknown>>,
  name: string,
  onUpdate: YamlUpdateHandler,
  batchUpdate?: BatchUpdate
): void {
  const mutations: Mutation[] = [];
  params.forEach((p, i) => {
    if (p.uiPage && String(p.uiPage) === name) {
      mutations.push([['parameters', i, 'uiPage'], null]);
      mutations.push([['parameters', i, 'uiGroup'], null]);
    }
  });
  applyBulkUpdate(mutations, onUpdate, batchUpdate);
}

/** Rename a Group across every parameter that references it on the given page. */
function renameGroup(
  params: Array<Record<string, unknown>>,
  page: string,
  oldName: string,
  newName: string,
  onUpdate: YamlUpdateHandler,
  batchUpdate?: BatchUpdate
): void {
  const mutations: Mutation[] = [];
  params.forEach((p, i) => {
    if (p.uiPage && String(p.uiPage) === page && p.uiGroup && String(p.uiGroup) === oldName) {
      mutations.push([['parameters', i, 'uiGroup'], newName]);
    }
  });
  applyBulkUpdate(mutations, onUpdate, batchUpdate);
}

/** Delete a Group — clears uiGroup on every parameter that used it on the given page. */
function deleteGroup(
  params: Array<Record<string, unknown>>,
  page: string,
  name: string,
  onUpdate: YamlUpdateHandler,
  batchUpdate?: BatchUpdate
): void {
  const mutations: Mutation[] = [];
  params.forEach((p, i) => {
    if (p.uiPage && String(p.uiPage) === page && p.uiGroup && String(p.uiGroup) === name) {
      mutations.push([['parameters', i, 'uiGroup'], null]);
    }
  });
  applyBulkUpdate(mutations, onUpdate, batchUpdate);
}

const PLACEMENT_ADD_BTN_STYLE: React.CSSProperties = {
  background: 'none',
  border: 'none',
  cursor: 'pointer',
  padding: '0 2px',
  color: 'var(--vscode-textLink-foreground)',
  fontSize: 14,
  lineHeight: 1,
};

const PLACEMENT_INLINE_INPUT_STYLE: React.CSSProperties = {
  background: 'var(--vscode-input-background)',
  color: 'var(--vscode-input-foreground)',
  border: '1px solid var(--vscode-focusBorder)',
  borderRadius: 2,
  padding: '1px 4px',
  fontSize: 11,
  width: 120,
  outline: 'none',
};

interface PlacementSelectFieldProps {
  value: string;
  options: string[];
  onChange: (v: string) => void;
  addTitle: string;
  addPlaceholder: string;
  selectStyle?: React.CSSProperties;
}

/**
 * A <select> over existing uiPage/uiGroup values plus an inline "⊕" affordance
 * to type a brand-new one. Shared by the single-parameter GUI Placement tree
 * (UiPlacementTree) and the Generics overview rows (GenericsOverviewPanel) so
 * both stay visually and behaviorally consistent.
 */
const PlacementSelectField: React.FC<PlacementSelectFieldProps> = ({
  value,
  options,
  onChange,
  addTitle,
  addPlaceholder,
  selectStyle,
}) => {
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState('');

  const commit = () => {
    const v = draft.trim();
    if (v) {
      onChange(v);
    }
    setDraft('');
    setAdding(false);
  };

  if (adding) {
    return (
      <input
        autoFocus
        style={PLACEMENT_INLINE_INPUT_STYLE}
        value={draft}
        placeholder={addPlaceholder}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            commit();
          }
          if (e.key === 'Escape') {
            setAdding(false);
            setDraft('');
          }
        }}
        onBlur={commit}
      />
    );
  }

  return (
    <>
      <select
        className="ci-field__select"
        style={selectStyle ?? { flex: 1 }}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      >
        <option value="">— none —</option>
        {options.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
      <button
        style={PLACEMENT_ADD_BTN_STYLE}
        title={addTitle}
        type="button"
        onClick={() => setAdding(true)}
      >
        ⊕
      </button>
    </>
  );
};

interface PlacementActionsProps {
  value: string;
  onRename: (oldName: string, newName: string) => void;
  onDelete: (name: string) => void;
  renameTitle: string;
  deleteTitle: string;
}

/**
 * Rename/delete affordance for an existing Page or Group *name* (as opposed to
 * PlacementSelectField's "assign this parameter to a page/group" control). Renaming
 * or deleting rewrites every parameter that references the name — see renamePage/
 * deletePage/renameGroup/deleteGroup below.
 */
const PlacementActions: React.FC<PlacementActionsProps> = ({
  value,
  onRename,
  onDelete,
  renameTitle,
  deleteTitle,
}) => {
  const [renaming, setRenaming] = useState(false);
  const [draft, setDraft] = useState(value);

  if (renaming) {
    const commit = () => {
      const v = draft.trim();
      if (v && v !== value) {
        onRename(value, v);
      }
      setRenaming(false);
    };
    return (
      <input
        autoFocus
        style={PLACEMENT_INLINE_INPUT_STYLE}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            commit();
          }
          if (e.key === 'Escape') {
            setRenaming(false);
            setDraft(value);
          }
        }}
        onBlur={commit}
      />
    );
  }

  return (
    <>
      <button
        style={PLACEMENT_ADD_BTN_STYLE}
        title={renameTitle}
        type="button"
        onClick={() => {
          setDraft(value);
          setRenaming(true);
        }}
      >
        <span className="codicon codicon-edit" style={{ fontSize: 12 }} />
      </button>
      <button
        style={PLACEMENT_ADD_BTN_STYLE}
        title={deleteTitle}
        type="button"
        onClick={() => onDelete(value)}
      >
        <span className="codicon codicon-trash" style={{ fontSize: 12 }} />
      </button>
    </>
  );
};

// ─── GUI Placement tree widget ────────────────────────────────────────────────

interface UiPlacementTreeProps {
  uiPage: string;
  uiGroup: string;
  paramName: string;
  allPages: string[];
  allGroups: string[];
  onPageChange: (v: string) => void;
  onGroupChange: (v: string) => void;
  onRenamePage: (oldName: string, newName: string) => void;
  onDeletePage: (name: string) => void;
  onRenameGroup: (oldName: string, newName: string) => void;
  onDeleteGroup: (name: string) => void;
}

const UiPlacementTree: React.FC<UiPlacementTreeProps> = ({
  uiPage,
  uiGroup,
  paramName,
  allPages,
  allGroups,
  onPageChange,
  onGroupChange,
  onRenamePage,
  onDeletePage,
  onRenameGroup,
  onDeleteGroup,
}) => {
  const treeLineStyle: React.CSSProperties = {
    color: 'var(--vscode-editorLineNumber-foreground)',
    userSelect: 'none',
  };

  const leafStyle: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    gap: 5,
    color: 'var(--vscode-foreground)',
    fontFamily: 'var(--vscode-editor-font-family, monospace)',
    fontSize: 11,
  };

  const rowStyle: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    marginBottom: 6,
  };

  return (
    <div style={{ paddingLeft: 2 }}>
      {/* Page row */}
      <div style={rowStyle}>
        <span style={{ ...treeLineStyle, minWidth: 40, fontSize: 11 }}>Page</span>
        <PlacementSelectField
          value={uiPage}
          options={allPages}
          onChange={onPageChange}
          addTitle="New page"
          addPlaceholder="New page name…"
        />
        {uiPage && (
          <PlacementActions
            key={uiPage}
            value={uiPage}
            onRename={onRenamePage}
            onDelete={onDeletePage}
            renameTitle="Rename this page (updates every parameter on it)"
            deleteTitle="Delete this page (clears it from every parameter on it)"
          />
        )}
      </div>

      {/* Tree connector + group row (only when page is set) */}
      {uiPage && (
        <>
          <div style={{ display: 'flex' }}>
            <div style={{ ...treeLineStyle, width: 40, fontSize: 11, paddingLeft: 8 }}>│</div>
          </div>
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 0 }}>
            <div
              style={{
                ...treeLineStyle,
                width: 40,
                fontSize: 11,
                paddingLeft: 8,
                paddingTop: 4,
                flexShrink: 0,
              }}
            >
              └─
            </div>
            <div style={{ flex: 1 }}>
              <div style={rowStyle}>
                <span style={{ ...treeLineStyle, minWidth: 36, fontSize: 11 }}>Group</span>
                <PlacementSelectField
                  value={uiGroup}
                  options={allGroups}
                  onChange={onGroupChange}
                  addTitle="New group"
                  addPlaceholder="New group name…"
                />
                {uiGroup && (
                  <PlacementActions
                    key={uiGroup}
                    value={uiGroup}
                    onRename={onRenameGroup}
                    onDelete={onDeleteGroup}
                    renameTitle="Rename this group (updates every parameter in it)"
                    deleteTitle="Delete this group (clears it from every parameter in it)"
                  />
                )}
              </div>

              {/* Parameter leaf */}
              <div style={{ display: 'flex' }}>
                {uiGroup && (
                  <div
                    style={{
                      ...treeLineStyle,
                      width: 6,
                      fontSize: 11,
                      paddingTop: 2,
                      flexShrink: 0,
                    }}
                  >
                    │
                  </div>
                )}
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 0 }}>
                {uiGroup && (
                  <div
                    style={{
                      ...treeLineStyle,
                      width: 6,
                      fontSize: 11,
                      paddingTop: 2,
                      flexShrink: 0,
                      paddingRight: 4,
                    }}
                  >
                    └─
                  </div>
                )}
                <div style={leafStyle}>
                  <span
                    className="codicon codicon-symbol-variable"
                    style={{ fontSize: 11, opacity: 0.7 }}
                  />
                  <span>{paramName}</span>
                </div>
              </div>
            </div>
          </div>
        </>
      )}

      {/* Leaf without page (floats to default) */}
      {!uiPage && (
        <div style={{ ...leafStyle, marginTop: 4, opacity: 0.5, fontSize: 11 }}>
          <span className="codicon codicon-symbol-variable" style={{ fontSize: 11 }} />
          <span>{paramName}</span>
          <span style={{ color: 'var(--vscode-descriptionForeground)' }}>(default page)</span>
        </div>
      )}
    </div>
  );
};

// ──────────────────────────────────────────────────────────────────────────────

interface ParameterPanelProps {
  param: Record<string, unknown>;
  index: number;
  ipCore: IpCore;
  onUpdate: YamlUpdateHandler;
  batchUpdate?: BatchUpdate;
}

const ParameterPanel: React.FC<ParameterPanelProps> = ({
  param,
  index,
  ipCore,
  onUpdate,
  batchUpdate,
}) => {
  const params = (ipCore.parameters ?? []) as unknown as Array<Record<string, unknown>>;
  const existingNames = params.map((p) => String(p.name ?? '')).filter((_, i) => i !== index);

  const dataType = String(param.dataType ?? 'integer');
  const uiPage = param.uiPage ? String(param.uiPage) : '';
  const uiGroup = param.uiGroup ? String(param.uiGroup) : '';

  // All unique page names already used by other parameters in this IP core
  const allPages = useMemo(() => computeParamPages(params), [params]);

  // All unique group names already used by other parameters on the same page
  const allGroups = useMemo(() => computeParamGroups(params, uiPage), [params, uiPage]);

  const defVal =
    param.defaultValue !== undefined
      ? param.defaultValue
      : param.value !== undefined && typeof param.value !== 'object'
        ? param.value
        : '';

  const saveDefault = (v: string) => {
    if (dataType === 'integer') {
      const n = Number(v);
      onUpdate(['parameters', index, 'defaultValue'], Number.isFinite(n) ? n : v);
    } else if (dataType === 'boolean') {
      onUpdate(['parameters', index, 'defaultValue'], v === 'true' || v === '1');
    } else {
      onUpdate(['parameters', index, 'defaultValue'], v);
    }
  };

  const handleTypeChange = (newType: string) => {
    onUpdate(['parameters', index, 'dataType'], newType);

    // Clear constraints on type change
    onUpdate(['parameters', index, 'min'], null);
    onUpdate(['parameters', index, 'max'], null);
    onUpdate(['parameters', index, 'allowedValues'], null);

    // Apply clean default values
    if (newType === 'integer') {
      onUpdate(['parameters', index, 'defaultValue'], 0);
    } else if (newType === 'boolean') {
      onUpdate(['parameters', index, 'defaultValue'], false);
    } else {
      onUpdate(['parameters', index, 'defaultValue'], '');
    }
  };

  // Determine current constraint mode.
  // onUpdate(..., null) leaves the key in YAML as `null` (mergeNode mutates
  // the scalar in place rather than deleting it), so both null and undefined
  // must be treated as absent.
  let constraintMode = 'unrestricted';
  if (
    (param.min !== null && param.min !== undefined) ||
    (param.max !== null && param.max !== undefined)
  ) {
    constraintMode = 'range';
  } else if (param.allowedValues !== null && param.allowedValues !== undefined) {
    constraintMode = 'choices';
  }

  const handleConstraintModeChange = (mode: string) => {
    if (mode === 'unrestricted') {
      onUpdate(['parameters', index, 'min'], null);
      onUpdate(['parameters', index, 'max'], null);
      onUpdate(['parameters', index, 'allowedValues'], null);
    } else if (mode === 'range') {
      onUpdate(['parameters', index, 'allowedValues'], null);
      onUpdate(['parameters', index, 'min'], 0);
      onUpdate(['parameters', index, 'max'], 255);
    } else if (mode === 'choices') {
      onUpdate(['parameters', index, 'min'], null);
      onUpdate(['parameters', index, 'max'], null);
      onUpdate(['parameters', index, 'allowedValues'], []);
    }
  };

  const allowedValuesList = (
    Array.isArray(param.allowedValues) ? param.allowedValues : []
  ) as Array<string | number>;

  const isDefaultInvalid =
    constraintMode === 'choices' &&
    allowedValuesList.length > 0 &&
    !allowedValuesList.includes(dataType === 'integer' ? Number(defVal) : String(defVal));

  return (
    <>
      <Section title="Identity">
        <PropField
          label="Name"
          value={String(param.name ?? '')}
          onSave={(v) => onUpdate(['parameters', index, 'name'], v)}
          validate={(v) => validateVhdlIdentifier(v) ?? validateUniqueName(v, existingNames)}
          placeholder="DATA_WIDTH"
          mono
        />
        <PropField
          label="Display Name"
          value={param.displayName ? String(param.displayName) : ''}
          onSave={(v) => onUpdate(['parameters', index, 'displayName'], v === '' ? null : v)}
          placeholder={String(param.name ?? '')}
          hint="Shown in vendor tools (e.g. Vivado IP Packager). Defaults to the parameter name."
        />
        <PropSelect
          label="Data Type"
          value={dataType}
          options={PARAM_TYPE_OPTS}
          onSave={handleTypeChange}
        />
      </Section>

      <Section title="Value">
        {dataType === 'boolean' ? (
          <PropCheckbox
            label="Default Value (True)"
            checked={!!defVal}
            onChange={(v) => onUpdate(['parameters', index, 'defaultValue'], v)}
          />
        ) : (
          <PropField
            label="Default Value"
            value={String(defVal)}
            onSave={saveDefault}
            placeholder={dataType === 'integer' ? '32' : 'none'}
            mono
            hasError={isDefaultInvalid}
            errorMsg="Value must be one of the allowed choices"
          />
        )}
      </Section>

      {dataType !== 'boolean' && (
        <Section title="Constraints">
          <PropSelect
            label="Constraint Mode"
            value={constraintMode}
            options={
              dataType === 'integer'
                ? [
                    { value: 'unrestricted', label: 'Unrestricted' },
                    { value: 'range', label: 'Range (Min/Max)' },
                    { value: 'choices', label: 'Discrete Choices' },
                  ]
                : [
                    { value: 'unrestricted', label: 'Unrestricted' },
                    { value: 'choices', label: 'Discrete Choices' },
                  ]
            }
            onSave={handleConstraintModeChange}
          />
          {constraintMode === 'range' && dataType === 'integer' && (
            <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
              <div style={{ flex: 1 }}>
                <PropField
                  label="Minimum"
                  value={param.min !== undefined ? String(param.min) : ''}
                  onSave={(v) => onUpdate(['parameters', index, 'min'], v ? Number(v) : null)}
                  placeholder="0"
                  mono
                />
              </div>
              <div style={{ flex: 1 }}>
                <PropField
                  label="Maximum"
                  value={param.max !== undefined ? String(param.max) : ''}
                  onSave={(v) => onUpdate(['parameters', index, 'max'], v ? Number(v) : null)}
                  placeholder="255"
                  mono
                />
              </div>
            </div>
          )}
          {constraintMode === 'choices' && (
            <div style={{ marginTop: 10 }}>
              <TagInput
                label="Allowed Choices"
                values={allowedValuesList}
                isNumeric={dataType === 'integer'}
                onChange={(vals) => onUpdate(['parameters', index, 'allowedValues'], vals)}
              />
            </div>
          )}
        </Section>
      )}

      <Section title="Documentation">
        <PropTextArea
          label="Description"
          value={param.description ? String(param.description) : ''}
          onSave={(v) => onUpdate(['parameters', index, 'description'], v || null)}
          placeholder="Optional parameter description..."
        />
      </Section>

      <Section title="GUI Placement (Vendor XGUI)">
        <div
          style={{ fontSize: 11, color: 'var(--vscode-descriptionForeground)', marginBottom: 8 }}
        >
          Assign where this parameter appears in the Vivado / Platform Designer wizard.
        </div>
        <UiPlacementTree
          uiPage={uiPage}
          uiGroup={uiGroup}
          paramName={String(param.name ?? '')}
          allPages={allPages}
          allGroups={allGroups}
          onPageChange={(v) => {
            onUpdate(['parameters', index, 'uiPage'], v || null);
            // clear group when page is cleared
            if (!v) {
              onUpdate(['parameters', index, 'uiGroup'], null);
            }
          }}
          onGroupChange={(v) => onUpdate(['parameters', index, 'uiGroup'], v || null)}
          onRenamePage={(oldName, newName) =>
            renamePage(params, oldName, newName, onUpdate, batchUpdate)
          }
          onDeletePage={(name) => deletePage(params, name, onUpdate, batchUpdate)}
          onRenameGroup={(oldName, newName) =>
            renameGroup(params, uiPage, oldName, newName, onUpdate, batchUpdate)
          }
          onDeleteGroup={(name) => deleteGroup(params, uiPage, name, onUpdate, batchUpdate)}
        />
      </Section>
    </>
  );
};

// ─────────────────────────────────────────────────────
//  Generics overview panel — one row per parameter, with quick Page/Group
//  reassignment. Value/range editing stays in the single-parameter
//  ParameterPanel, opened by clicking a row's name.
// ─────────────────────────────────────────────────────

interface GenericsOverviewPanelProps {
  ipCore: IpCore;
  onUpdate: YamlUpdateHandler;
  onSelectElement?: (id: string) => void;
}

const GenericsOverviewPanel: React.FC<GenericsOverviewPanelProps> = ({
  ipCore,
  onUpdate,
  onSelectElement,
}) => {
  const params = (ipCore.parameters ?? []) as unknown as Array<Record<string, unknown>>;

  const allPages = useMemo(() => computeParamPages(params), [params]);

  if (params.length === 0) {
    return <EmptyState label="No generics defined" />;
  }

  const handlePageChange = (index: number, v: string) => {
    onUpdate(['parameters', index, 'uiPage'], v || null);
    // clear group when page is cleared
    if (!v) {
      onUpdate(['parameters', index, 'uiGroup'], null);
    }
  };

  const handleGroupChange = (index: number, v: string) => {
    onUpdate(['parameters', index, 'uiGroup'], v || null);
  };

  return (
    <Section title="Generics">
      <div
        style={{
          fontSize: 11,
          color: 'var(--vscode-descriptionForeground)',
          marginBottom: 8,
        }}
      >
        Click a name to edit its value and constraints. Page/Group control where it appears in the
        Vivado / Platform Designer wizard.
      </div>
      <div className="ci-generics-header-row">
        <span className="ci-generics-header-row__name">Name</span>
        <span className="ci-generics-header-row__page">Page</span>
        <span className="ci-generics-header-row__group">Group</span>
      </div>
      {params.map((param, index) => {
        const name = String(param.name ?? '');
        const uiPage = param.uiPage ? String(param.uiPage) : '';
        const uiGroup = param.uiGroup ? String(param.uiGroup) : '';
        const allGroups = computeParamGroups(params, uiPage);

        return (
          <div className="ci-generics-row" key={index}>
            <button
              className="ci-generics-row__name"
              type="button"
              title={`Open ${name || 'parameter'}`}
              onClick={() => onSelectElement?.(`parameter:${index}`)}
            >
              {name || `(param ${index})`}
            </button>
            <div className="ci-generics-row__page">
              <PlacementSelectField
                value={uiPage}
                options={allPages}
                onChange={(v) => handlePageChange(index, v)}
                addTitle="New page"
                addPlaceholder="New page name…"
                selectStyle={{ flex: 1, minWidth: 0 }}
              />
            </div>
            <div className="ci-generics-row__group">
              {uiPage ? (
                <PlacementSelectField
                  value={uiGroup}
                  options={allGroups}
                  onChange={(v) => handleGroupChange(index, v)}
                  addTitle="New group"
                  addPlaceholder="New group name…"
                  selectStyle={{ flex: 1, minWidth: 0 }}
                />
              ) : (
                <span className="ci-generics-row__group-empty">—</span>
              )}
            </div>
          </div>
        );
      })}
    </Section>
  );
};

const PARAM_TYPE_OPTS = [
  { value: 'integer', label: 'integer' },
  { value: 'boolean', label: 'boolean' },
  { value: 'string', label: 'string' },
];

// ─────────────────────────────────────────────────────
// ─────────────────────────────────────────────────────
//  Kind-specific panels
// ─────────────────────────────────────────────────────

interface ClockPanelProps {
  clock: Clock;
  index: number;
  ipCore: IpCore;
  onUpdate: YamlUpdateHandler;
}

const ClockPanel: React.FC<ClockPanelProps> = ({ clock, index, ipCore, onUpdate }) => {
  const clocks = (ipCore.clocks ?? []) as Clock[];
  const buses = (ipCore.busInterfaces ?? []) as BusInterface[];
  const existingNames = clocks.map((c) => c.name).filter((_, i) => i !== index);
  const usedBy = buses.filter((b) => b.associatedClock === clock.name).map((b) => b.name);

  const save = (field: string) => (v: string) =>
    onUpdate(['clocks', index, field], v === '' ? null : v);

  return (
    <>
      <Section title="Identity">
        <PropField
          label="Physical Name"
          value={clock.name}
          onSave={(v) => onUpdate(['clocks', index, 'name'], v)}
          validate={(v) => validateVhdlIdentifier(v) ?? validateUniqueName(v, existingNames)}
          placeholder="i_clk_sys"
          mono
        />
        <PropField
          label="Logical Name"
          value={clock.logicalName ?? 'CLK'}
          onSave={save('logicalName')}
          placeholder="CLK"
          mono
        />
      </Section>
      <Section title="Signal">
        <PropSelect
          label="Direction"
          value={canonicalDirection(clock.direction, 'in')}
          options={DIR_2WAY}
          onSave={(v) => onUpdate(['clocks', index, 'direction'], v)}
        />
        <PropField
          label="Frequency"
          value={clock.frequency ?? ''}
          onSave={save('frequency')}
          placeholder="100 MHz"
          hint="e.g. 100 MHz, 50 MHz"
        />
      </Section>
      {(ipCore.resets ?? []).length > 0 && (
        <Section title="Associations">
          <PropSelect
            label="Associated Reset"
            value={clock.associatedReset ?? ''}
            options={(ipCore.resets as Reset[]).map((r) => ({ value: r.name, label: r.name }))}
            emptyOption="— none —"
            onSave={(v) => onUpdate(['clocks', index, 'associatedReset'], v || null)}
          />
        </Section>
      )}
      {usedBy.length > 0 && (
        <Section title="Used By">
          <div className="ci-chips">
            {usedBy.map((n, i) => (
              <span key={i} className="ci-chip">
                {n}
              </span>
            ))}
          </div>
        </Section>
      )}
    </>
  );
};

interface ResetPanelProps {
  reset: Reset;
  index: number;
  ipCore: IpCore;
  onUpdate: YamlUpdateHandler;
}

const ResetPanel: React.FC<ResetPanelProps> = ({ reset, index, ipCore, onUpdate }) => {
  const resets = (ipCore.resets ?? []) as Reset[];
  const buses = (ipCore.busInterfaces ?? []) as BusInterface[];
  const existingNames = resets.map((r) => r.name).filter((_, i) => i !== index);
  const usedBy = buses.filter((b) => b.associatedReset === reset.name).map((b) => b.name);

  const polarity = normalizePolarity(reset.polarity);

  return (
    <>
      <Section title="Identity">
        <PropField
          label="Physical Name"
          value={reset.name}
          onSave={(v) => onUpdate(['resets', index, 'name'], v)}
          validate={(v) => validateVhdlIdentifier(v) ?? validateUniqueName(v, existingNames)}
          placeholder="i_rst_n_sys"
          mono
        />
        <PropField
          label="Logical Name"
          value={reset.logicalName ?? (polarity === 'activeLow' ? 'RESET_N' : 'RESET')}
          onSave={(v) => onUpdate(['resets', index, 'logicalName'], v || null)}
          placeholder="RESET_N"
          mono
        />
      </Section>
      <Section title="Signal">
        <PropSelect
          label="Direction"
          value={canonicalDirection(reset.direction, 'in')}
          options={DIR_2WAY}
          onSave={(v) => onUpdate(['resets', index, 'direction'], v)}
        />
        <PropSelect
          label="Polarity"
          value={polarity}
          options={POLARITY_OPTS}
          onSave={(v) => {
            onUpdate(['resets', index, 'polarity'], v);
            onUpdate(['resets', index, 'logicalName'], v === 'activeLow' ? 'RESET_N' : 'RESET');
          }}
        />
      </Section>
      {(ipCore.clocks ?? []).length > 0 && (
        <Section title="Associations">
          <PropSelect
            label="Associated Clock"
            value={reset.associatedClock ?? ''}
            options={(ipCore.clocks as Clock[]).map((c) => ({ value: c.name, label: c.name }))}
            emptyOption="— none —"
            onSave={(v) => onUpdate(['resets', index, 'associatedClock'], v || null)}
          />
        </Section>
      )}
      {usedBy.length > 0 && (
        <Section title="Used By">
          <div className="ci-chips">
            {usedBy.map((n, i) => (
              <span key={i} className="ci-chip">
                {n}
              </span>
            ))}
          </div>
        </Section>
      )}
    </>
  );
};

interface PortPanelProps {
  port: Port;
  index: number;
  ipCore: IpCore;
  onUpdate: YamlUpdateHandler;
}

const PortPanel: React.FC<PortPanelProps> = ({ port, index, ipCore, onUpdate }) => {
  const ports = (ipCore.ports ?? []) as Port[];
  const existingNames = ports.map((p) => p.name).filter((_, i) => i !== index);
  const paramNames = ((ipCore.parameters ?? []) as unknown as Array<{ name: string }>).map(
    (p) => p.name
  );

  const currentWidth: number | string =
    port.width === undefined || port.width === null ? 1 : (port.width as number | string);

  // Build param name→value lookup for expression evaluation.
  // Parameters may use either "defaultValue" (standard schema / hand-authored files)
  // or "value" (parser-generated files) — check both, preferring defaultValue.
  const paramValues = useMemo(
    () =>
      (
        (ipCore.parameters ?? []) as unknown as Array<{
          name: string;
          defaultValue?: unknown;
          value?: unknown;
        }>
      ).reduce<Record<string, number>>((acc, p) => {
        const raw = p.defaultValue ?? p.value;
        const n = Number(raw);
        if (p.name && Number.isFinite(n)) {
          acc[p.name] = n;
        }
        return acc;
      }, {}),
    [ipCore.parameters]
  );

  return (
    <>
      <Section title="Identity">
        <PropField
          label="Name"
          value={port.name}
          onSave={(v) => onUpdate(['ports', index, 'name'], v)}
          validate={(v) => validateVhdlIdentifier(v) ?? validateUniqueName(v, existingNames)}
          placeholder="data_in"
          mono
        />
      </Section>
      <Section title="Signal">
        <PropSelect
          label="Direction"
          value={canonicalDirection(port.direction, 'in')}
          options={DIR_3WAY}
          onSave={(v) => onUpdate(['ports', index, 'direction'], v)}
        />
        <PropWidthField
          label="Width (bits)"
          value={currentWidth}
          paramNames={paramNames}
          paramValues={paramValues}
          onSave={(v) => onUpdate(['ports', index, 'width'], v)}
        />
      </Section>
    </>
  );
};

interface InterruptPanelProps {
  interrupt: Interrupt;
  index: number;
  ipCore: IpCore;
  onUpdate: YamlUpdateHandler;
}

const INTERRUPT_DIR_OPTS = [
  { value: 'out', label: 'out (sender)' },
  { value: 'in', label: 'in (receiver)' },
];

const SENSITIVITY_OPTS = [
  { value: 'LEVEL_HIGH', label: 'LEVEL_HIGH' },
  { value: 'LEVEL_LOW', label: 'LEVEL_LOW' },
  { value: 'EDGE_RISING', label: 'EDGE_RISING' },
  { value: 'EDGE_FALLING', label: 'EDGE_FALLING' },
];

const InterruptPanel: React.FC<InterruptPanelProps> = ({ interrupt, index, ipCore, onUpdate }) => {
  const interrupts = (ipCore.interrupts ?? []) as Interrupt[];
  const existingNames = interrupts.map((irq) => irq.name).filter((_, i) => i !== index);
  const paramNames = ((ipCore.parameters ?? []) as unknown as Array<{ name: string }>).map(
    (p) => p.name
  );

  const currentWidth: number | string =
    interrupt.width === undefined || interrupt.width === null
      ? 1
      : (interrupt.width as number | string);

  const paramValues = useMemo(
    () =>
      (
        (ipCore.parameters ?? []) as unknown as Array<{
          name: string;
          defaultValue?: unknown;
          value?: unknown;
        }>
      ).reduce<Record<string, number>>((acc, p) => {
        const raw = p.defaultValue ?? p.value;
        const n = Number(raw);
        if (p.name && Number.isFinite(n)) {
          acc[p.name] = n;
        }
        return acc;
      }, {}),
    [ipCore.parameters]
  );

  return (
    <>
      <Section title="Identity">
        <PropField
          label="Name"
          value={interrupt.name}
          onSave={(v) => onUpdate(['interrupts', index, 'name'], v)}
          validate={(v) => validateVhdlIdentifier(v) ?? validateUniqueName(v, existingNames)}
          placeholder="irq_out"
          mono
        />
        <PropField
          label="Logical Name"
          value={interrupt.logicalName ?? ''}
          onSave={(v) => onUpdate(['interrupts', index, 'logicalName'], v || undefined)}
          placeholder="irq"
          mono
        />
      </Section>
      <Section title="Signal">
        <PropSelect
          label="Direction"
          value={interrupt.direction ?? 'out'}
          options={INTERRUPT_DIR_OPTS}
          onSave={(v) => onUpdate(['interrupts', index, 'direction'], v)}
        />
        <PropWidthField
          label="Width (bits)"
          value={currentWidth}
          paramNames={paramNames}
          paramValues={paramValues}
          onSave={(v) => onUpdate(['interrupts', index, 'width'], v)}
        />
        <PropSelect
          label="Sensitivity"
          value={interrupt.sensitivity ?? 'LEVEL_HIGH'}
          options={SENSITIVITY_OPTS}
          onSave={(v) => onUpdate(['interrupts', index, 'sensitivity'], v)}
        />
      </Section>
    </>
  );
};

interface BusPanelProps {
  bus: BusInterface;
  index: number;
  ipCore: IpCore;
  imports?: { busLibrary?: unknown; memoryMaps?: unknown[] };
  onUpdate: YamlUpdateHandler;
}

/** Returns true if the bus interface is a custom (user-defined) interface that should
 *  be edited via the ConduitPanel rather than the standard BusPanel. This covers:
 *  - Mode explicitly set to 'conduit'
 *  - Type name includes 'conduit'
 *  - Inline conduit ports are defined
 *  - Bus type is not a built-in protocol (e.g. user:busif:xcvr:1.0)
 */
function isCustomBusInterface(bus: BusInterface): boolean {
  return (
    bus.mode === 'conduit' ||
    isConduitType(bus.type) ||
    (bus.conduitPorts?.length ?? 0) > 0 ||
    lookupBusDef(bus.type) === null
  );
}

const BusPanel: React.FC<BusPanelProps> = ({ bus, index, ipCore, imports, onUpdate }) => {
  if (isCustomBusInterface(bus)) {
    return (
      <ConduitPanel bus={bus} index={index} ipCore={ipCore} imports={imports} onUpdate={onUpdate} />
    );
  }

  const buses = (ipCore.busInterfaces ?? []) as BusInterface[];
  const clocks = (ipCore.clocks ?? []) as Clock[];
  const resets = (ipCore.resets ?? []) as Reset[];
  const existingNames = buses.map((b) => b.name).filter((_, i) => i !== index);

  // Detect if this interface's physicalPrefix collides with any sibling
  const currentPrefix = bus.physicalPrefix ?? '';
  const hasDuplicatePrefix =
    currentPrefix.length > 0 &&
    buses.some(
      (b, i) =>
        i !== index && (b.physicalPrefix ?? '').toLowerCase() === currentPrefix.toLowerCase()
    );

  const clockOpts = clocks.map((c) => ({ value: c.name, label: c.name }));
  const resetOpts = resets.map((r) => ({ value: r.name, label: r.name }));

  // Memory map options: inline maps + imported maps (deduplicated)
  const inlineMaps = Array.isArray(ipCore.memoryMaps)
    ? (ipCore.memoryMaps as unknown as Array<{ name?: unknown; import?: unknown }>)
    : [];
  const inlineMapNames = inlineMaps.map((m) => String(m.name ?? ''));
  const importedMapNames = Array.isArray(imports?.memoryMaps)
    ? (imports.memoryMaps as Array<Record<string, unknown>>).map((m) => String(m.name ?? ''))
    : [];
  const allMapNames = [...new Set([...inlineMapNames, ...importedMapNames])].filter(Boolean);
  const mapOpts = allMapNames.map((m) => ({ value: m, label: m }));

  // Only single, slave memory-mapped interfaces (AXI4-Lite/Full, Avalon-MM) may have a memory map
  const arrayDef = bus.array as
    | { count?: number; physicalPrefixPattern?: string }
    | undefined
    | null;
  const isArray = (arrayDef?.count ?? 0) > 1;
  const hasPrefixPattern = isArray && !!arrayDef?.physicalPrefixPattern;
  const canHaveMemoryMap = !isArray && busSupportsMemoryMap(bus.type, bus.mode);

  // The import path shown for this interface's map entry (per-interface, not global).
  const currentMapImportPath: string | null = (() => {
    if (!bus.memoryMapRef) {
      return null;
    }
    const entry = inlineMaps.find((m) => String(m.name ?? '') === bus.memoryMapRef);
    return entry?.import ? String(entry.import) : null;
  })();

  /**
   * Called when the user browses and selects a .mm.yml file for THIS interface.
   * Creates or updates a named entry in ipCore.memoryMaps, and sets memoryMapRef
   * on this interface to that name — so two interfaces never share the same entry.
   * `canonicalName` is the map `name` field read from inside the file by the extension.
   */
  const handleMemoryMapFileChange = (filePath: string | null, canonicalName?: string) => {
    const currentMaps = Array.isArray(ipCore.memoryMaps)
      ? ([...(ipCore.memoryMaps as unknown as Array<Record<string, unknown>>)] as Array<
          Record<string, unknown>
        >)
      : [];

    if (!filePath) {
      // Clear: remove memoryMapRef from this interface.
      // If the referenced map entry has an import and is not used by any other interface,
      // remove it from the array to keep the YAML clean.
      const refName = bus.memoryMapRef;
      if (refName) {
        const usedByOthers = buses.some(
          (b, i) => i !== index && (b as { memoryMapRef?: string }).memoryMapRef === refName
        );
        if (!usedByOthers) {
          const entry = inlineMaps.find((m) => String(m.name ?? '') === refName);
          if (entry?.import) {
            // This was a file-backed entry created by this UI — safe to remove.
            const updated = currentMaps.filter((m) => String(m.name ?? '') !== refName);
            onUpdate(['memoryMaps'], updated.length ? updated : undefined);
          }
        }
      }
      onUpdate(['busInterfaces', index, 'memoryMapRef'], null);
      return;
    }

    // Prefer the canonical name from inside the file (sent by the extension host).
    // Fall back to deriving a name from the filename only when the file couldn't be read.
    const baseName =
      canonicalName ??
      filePath
        .split(/[/\\]/)
        .pop()!
        .replace(/\.(mm\.yml|mm\.yaml|yml|yaml)$/i, '');

    // Ensure uniqueness: if another interface already owns an entry with this name,
    // append the interface's own logical name to disambiguate.
    let mapName = baseName;
    const takenByOther = buses.some(
      (b, i) => i !== index && (b as { memoryMapRef?: string }).memoryMapRef === baseName
    );
    if (takenByOther) {
      mapName = `${baseName}_${String(bus.name ?? index)}`;
    }

    // Add or update the entry in the memoryMaps array.
    const existingIdx = currentMaps.findIndex((m) => String(m.name ?? '') === mapName);
    const newEntry: Record<string, unknown> = { name: mapName, import: filePath };
    if (existingIdx >= 0) {
      currentMaps[existingIdx] = newEntry;
    } else {
      currentMaps.push(newEntry);
    }

    onUpdate(['memoryMaps'], currentMaps);
    onUpdate(['busInterfaces', index, 'memoryMapRef'], mapName);
  };

  return (
    <>
      <Section title="Identity">
        <PropField
          label="Name"
          value={bus.name}
          onSave={(v) => onUpdate(['busInterfaces', index, 'name'], v)}
          validate={(v) => validateVhdlIdentifier(v) ?? validateUniqueName(v, existingNames)}
          placeholder="s_axi_lite"
          mono
        />
        <BusTypeField
          value={bus.type}
          busLibrary={imports?.busLibrary}
          onSave={(v) => onUpdate(['busInterfaces', index, 'type'], v)}
        />
      </Section>
      <Section title="Configuration">
        <PropSelect
          label="Mode"
          value={normalizeBusMode(bus.mode)}
          options={BUS_MODE_OPTS}
          onSave={(v) => onUpdate(['busInterfaces', index, 'mode'], v)}
        />
        {!hasPrefixPattern && (
          <PropField
            label="Physical Prefix"
            value={bus.physicalPrefix ?? ''}
            onSave={(v) => onUpdate(['busInterfaces', index, 'physicalPrefix'], v || null)}
            hint={
              !bus.physicalPrefix && !isArray
                ? 'Defaults to s_axi_ at generation'
                : isArray
                  ? `Auto-pattern: ${bus.physicalPrefix ?? 's_axi_'}{index}_`
                  : undefined
            }
            mono
          />
        )}
        {hasDuplicatePrefix && !hasPrefixPattern && (
          <div
            className="flex items-start gap-1.5 px-2 py-1.5 rounded text-xs"
            role="alert"
            style={{
              background: 'var(--vscode-inputValidation-warningBackground)',
              border: '1px solid var(--vscode-inputValidation-warningBorder)',
              color:
                'var(--vscode-inputValidation-warningForeground, var(--vscode-editor-foreground))',
            }}
          >
            <span className="codicon codicon-warning" style={{ flexShrink: 0, marginTop: '1px' }} />
            <span>
              Duplicate prefix — another interface uses <code>{currentPrefix}</code>. Generated port
              names will conflict.
            </span>
          </div>
        )}
      </Section>
      <Section title="Associations">
        <PropSelect
          label="Clock"
          value={bus.associatedClock ?? ''}
          options={clockOpts}
          onSave={(v) => onUpdate(['busInterfaces', index, 'associatedClock'], v || null)}
          emptyOption="— None —"
        />
        <PropSelect
          label="Reset"
          value={bus.associatedReset ?? ''}
          options={resetOpts}
          onSave={(v) => onUpdate(['busInterfaces', index, 'associatedReset'], v || null)}
          emptyOption="— None —"
        />
        {canHaveMemoryMap && (
          <MemoryMapField importPath={currentMapImportPath} onSave={handleMemoryMapFileChange} />
        )}
        {canHaveMemoryMap && mapOpts.length > 0 && (
          <PropSelect
            label="Map Name"
            value={bus.memoryMapRef ?? ''}
            options={mapOpts}
            onSave={(v) => onUpdate(['busInterfaces', index, 'memoryMapRef'], v || null)}
            emptyOption="— None —"
          />
        )}
      </Section>
      <ArraySection bus={bus} busIndex={index} onUpdate={onUpdate} />
      <PortWidthOverridesSection
        bus={bus}
        busIndex={index}
        paramNames={((ipCore.parameters ?? []) as unknown as Array<{ name: string }>).map(
          (p) => p.name
        )}
        paramValues={(
          (ipCore.parameters ?? []) as unknown as Array<{
            name: string;
            defaultValue?: unknown;
            value?: unknown;
          }>
        ).reduce<Record<string, number>>((acc, p) => {
          const raw = p.defaultValue ?? p.value;
          const n = Number(raw);
          if (p.name && Number.isFinite(n)) {
            acc[p.name] = n;
          }
          return acc;
        }, {})}
        onUpdate={onUpdate}
      />
    </>
  );
};

// ─────────────────────────────────────────────────────
//  Conduit (Custom Interface) panel
// ─────────────────────────────────────────────────────

/**
 * Extract the meaningful name segment from a user-namespaced VLNV, e.g. 'user:busif:spi:1.0' → 'spi'.
 * A fully-qualified external VLNV (e.g. pasted from IP-XACT/Vivado) is returned as-is so it
 * round-trips through the field unchanged instead of being reduced to one segment.
 */
function conduitTypeName(busType: string): string {
  if (isConduitType(busType)) {
    return '';
  }
  if (!busType.startsWith('user:busif:')) {
    return busType;
  }
  const parts = busType.split(':');
  return parts.length >= 3 ? parts[2] : '';
}

/** Build a user-namespaced VLNV from a display name, e.g. 'SPI' → 'user:busif:spi:1.0' */
function buildConduitType(name: string): string {
  const safe =
    name
      .toLowerCase()
      .replace(/\s+/g, '_')
      .replace(/[^a-z0-9_]/g, '') || 'custom';
  return `user:busif:${safe}:1.0`;
}

const ConduitPanel: React.FC<BusPanelProps> = ({ bus, index, ipCore, imports, onUpdate }) => {
  const buses = (ipCore.busInterfaces ?? []) as BusInterface[];
  const clocks = (ipCore.clocks ?? []) as Clock[];
  const resets = (ipCore.resets ?? []) as Reset[];
  const existingNames = buses.map((b) => b.name).filter((_, i) => i !== index);
  const paramNames = ((ipCore.parameters ?? []) as unknown as Array<{ name: string }>).map(
    (p) => p.name
  );
  const paramValues = useMemo(
    () =>
      (
        (ipCore.parameters ?? []) as unknown as Array<{
          name: string;
          defaultValue?: unknown;
          value?: unknown;
        }>
      ).reduce<Record<string, number>>((acc, p) => {
        const raw = p.defaultValue ?? p.value;
        const n = Number(raw);
        if (p.name && Number.isFinite(n)) {
          acc[p.name] = n;
        }
        return acc;
      }, {}),
    [ipCore.parameters]
  );

  // Detect if this interface's physicalPrefix collides with any sibling
  const currentConduitPrefix = bus.physicalPrefix ?? '';
  const hasConduitDuplicatePrefix =
    currentConduitPrefix.length > 0 &&
    buses.some(
      (b, i) =>
        i !== index && (b.physicalPrefix ?? '').toLowerCase() === currentConduitPrefix.toLowerCase()
    );

  const clockOpts = clocks.map((c) => ({ value: c.name, label: c.name }));
  const resetOpts = resets.map((r) => ({ value: r.name, label: r.name }));

  const typeName = conduitTypeName(bus.type);
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved'>('idle');

  // If the bus type is already present in the loaded bus library (built-in, saved
  // custom, or discovered via the Vivado interface catalog scan), this interface has
  // a known definition. If conduitPorts is still empty, switch straight to the
  // standard Port Widths flow used by other known bus types. If conduitPorts already
  // has data, keep showing it as-is (it's presumably already wired to real HDL) and
  // offer a "Map Signals" action instead of silently reinterpreting it.
  const busLibrary = imports?.busLibrary as Record<string, unknown> | undefined;
  const libraryPortDefs = busLibrary ? lookupBusDefFromLibrary(bus.type, busLibrary) : null;
  const existingConduitPorts = bus.conduitPorts ?? [];
  const hasOwnConduitPorts = existingConduitPorts.length > 0;
  const [showMappingDialog, setShowMappingDialog] = useState(false);

  const handleSaveBusDef = useCallback(() => {
    const conduitPorts = bus.conduitPorts ?? [];
    const tName = typeName || 'custom';
    const displayName = tName.charAt(0).toUpperCase() + tName.slice(1);

    // Build a parameter-name → default-value lookup so the extension can write
    // literal widths in the bus definition YAML instead of parameter references.
    const params = (ipCore.parameters ?? []) as unknown as Array<{
      name: string;
      value?: unknown;
      defaultValue?: unknown;
    }>;
    const paramDefaults = Object.fromEntries(
      params.map((p) => [p.name, p.defaultValue ?? p.value ?? 1])
    );

    setSaveState('saving');
    vscode?.postMessage({
      type: 'saveCustomBusDefinition',
      typeName: tName,
      displayName,
      ports: conduitPorts.map((p) => {
        const isParamRef = typeof p.width === 'string' && isNaN(Number(p.width));
        return {
          name: p.name,
          direction: p.direction,
          // defaultWidth is the resolved literal to use in the bus definition file
          defaultWidth: isParamRef ? (paramDefaults[p.width as string] ?? 1) : p.width,
          // width carries the original value (param name or literal)
          width: p.width,
          presence: p.presence ?? 'required',
        };
      }),
    });

    const handler = (event: MessageEvent) => {
      const msg = event.data as {
        type?: string;
        customBusLibraryDir?: string;
        portWidthOverrides?: Record<string, unknown>;
      };
      if (msg.type === 'customBusDefinitionSaved') {
        window.removeEventListener('message', handler);
        setSaveState('saved');
        const ipCoreData = ipCore as unknown as Record<string, unknown>;
        if (msg.customBusLibraryDir && !ipCoreData.useBusLibrary) {
          onUpdate(['useBusLibrary'], `./${msg.customBusLibraryDir}`);
        }
        // Apply portWidthOverrides and clear the now-redundant conduitPorts so
        // the bus interface relies on the saved bus definition file.
        if (msg.portWidthOverrides && Object.keys(msg.portWidthOverrides).length > 0) {
          onUpdate(['busInterfaces', index, 'portWidthOverrides'], msg.portWidthOverrides);
        }
        onUpdate(['busInterfaces', index, 'conduitPorts'], null);
        setTimeout(() => setSaveState('idle'), 2500);
      }
    };
    window.addEventListener('message', handler);
  }, [bus, index, typeName, ipCore, onUpdate]);

  const handleMapToKnownBus = useCallback(
    (result: MapConduitToBusResult) => {
      onUpdate(['busInterfaces'], applyMapConduitToKnownBus(ipCore, index, result));
    },
    [ipCore, index, onUpdate]
  );

  // A conduit is a signal group with no clock domain of its own; mirrors the
  // 'conduit' default for the Mode select below.
  const isConduitMode = (bus.mode ?? 'conduit') === 'conduit';

  const handleModeChange = useCallback(
    (newMode: string) => {
      onUpdate(['busInterfaces', index, 'mode'], newMode);
      if (newMode === 'conduit') {
        // Clear any stale association left over from a previous master/slave mode —
        // conduits must not have an associated clock or reset.
        onUpdate(['busInterfaces', index, 'associatedClock'], null);
        onUpdate(['busInterfaces', index, 'associatedReset'], null);
      }
    },
    [index, onUpdate]
  );

  return (
    <>
      <Section title="Identity">
        <PropField
          label="Name"
          value={bus.name}
          onSave={(v) => onUpdate(['busInterfaces', index, 'name'], v)}
          validate={(v) => validateVhdlIdentifier(v) ?? validateUniqueName(v, existingNames)}
          placeholder="custom_if"
          mono
        />
        <InterfaceTypeField
          value={bus.type}
          busLibrary={imports?.busLibrary}
          onSave={(v) => onUpdate(['busInterfaces', index, 'type'], v)}
        />
      </Section>
      <Section title="Configuration">
        <PropSelect
          label="Mode"
          value={bus.mode ?? 'conduit'}
          options={CONDUIT_MODE_OPTS}
          onSave={handleModeChange}
        />
        <PropField
          label="Physical Prefix"
          value={bus.physicalPrefix ?? ''}
          onSave={(v) => onUpdate(['busInterfaces', index, 'physicalPrefix'], v || null)}
          placeholder="custom_if_"
          mono
        />
        {hasConduitDuplicatePrefix && (
          <div
            className="flex items-start gap-1.5 px-2 py-1.5 rounded text-xs"
            role="alert"
            style={{
              background: 'var(--vscode-inputValidation-warningBackground)',
              border: '1px solid var(--vscode-inputValidation-warningBorder)',
              color:
                'var(--vscode-inputValidation-warningForeground, var(--vscode-editor-foreground))',
            }}
          >
            <span className="codicon codicon-warning" style={{ flexShrink: 0, marginTop: '1px' }} />
            <span>
              Duplicate prefix — another interface uses <code>{currentConduitPrefix}</code>.
              Generated port names will conflict.
            </span>
          </div>
        )}
      </Section>
      {/* Conduits are signal groups with no clock domain — only show clock/reset
          association once the user picks a real master/slave mode. */}
      {!isConduitMode && (
        <Section title="Associations">
          <PropSelect
            label="Clock"
            value={bus.associatedClock ?? ''}
            options={clockOpts}
            onSave={(v) => onUpdate(['busInterfaces', index, 'associatedClock'], v || null)}
            emptyOption="— None —"
          />
          <PropSelect
            label="Reset"
            value={bus.associatedReset ?? ''}
            options={resetOpts}
            onSave={(v) => onUpdate(['busInterfaces', index, 'associatedReset'], v || null)}
            emptyOption="— None —"
          />
        </Section>
      )}
      {libraryPortDefs && !hasOwnConduitPorts ? (
        <PortWidthOverridesSection
          bus={bus}
          busIndex={index}
          paramNames={paramNames}
          paramValues={paramValues}
          libraryPortDefs={libraryPortDefs}
          onUpdate={onUpdate}
        />
      ) : (
        <>
          {libraryPortDefs && hasOwnConduitPorts && (
            <div
              className="flex items-start gap-1.5 px-2 py-1.5 rounded text-xs"
              role="status"
              style={{
                background: 'var(--vscode-inputValidation-infoBackground)',
                border: '1px solid var(--vscode-inputValidation-infoBorder)',
                color:
                  'var(--vscode-inputValidation-infoForeground, var(--vscode-editor-foreground))',
              }}
            >
              <span className="codicon codicon-info" style={{ flexShrink: 0, marginTop: '1px' }} />
              <span style={{ flex: 1 }}>
                Known interface: <code>{typeName || bus.type}</code>. Map your signals to its
                official ports for correct component.xml generation.
              </span>
              <button
                className="ci-conduit-save-btn"
                onClick={() => setShowMappingDialog(true)}
                type="button"
              >
                Map Signals
              </button>
            </div>
          )}
          <ConduitSignalsSection
            bus={bus}
            busIndex={index}
            paramNames={paramNames}
            paramValues={paramValues}
            onUpdate={onUpdate}
          />
          {!libraryPortDefs && (
            <div className="ci-conduit-footer">
              <button
                className={`ci-conduit-save-btn${saveState === 'saved' ? ' ci-conduit-save-btn--saved' : ''}`}
                onClick={handleSaveBusDef}
                disabled={saveState === 'saving'}
                title="Save interface definition as a reusable YAML file"
                type="button"
              >
                {saveState === 'saved' ? (
                  <>
                    <span className="codicon codicon-check" aria-hidden="true" /> Saved
                  </>
                ) : (
                  <>
                    <span className="codicon codicon-save" aria-hidden="true" /> Save Bus Definition
                  </>
                )}
              </button>
            </div>
          )}
        </>
      )}
      {showMappingDialog && libraryPortDefs && (
        <MapConduitToBusDialog
          busLabel={typeName || bus.type}
          conduitPorts={existingConduitPorts}
          libraryPortDefs={libraryPortDefs}
          onConfirm={(result) => {
            handleMapToKnownBus(result);
            setShowMappingDialog(false);
          }}
          onCancel={() => setShowMappingDialog(false)}
        />
      )}
    </>
  );
};

interface ConduitSignalsSectionProps {
  bus: BusInterface;
  busIndex: number;
  paramNames: string[];
  paramValues?: Record<string, number>;
  onUpdate: YamlUpdateHandler;
}

const ConduitSignalsSection: React.FC<ConduitSignalsSectionProps> = ({
  bus,
  busIndex,
  paramNames,
  paramValues = {},
  onUpdate,
}) => {
  const conduitPorts = bus.conduitPorts ?? [];

  const addSignal = () => {
    const existing = conduitPorts.map((p) => p.name);
    let name = 'signal';
    let i = 0;
    while (existing.includes(name)) {
      name = `signal_${i++}`;
    }
    onUpdate(
      ['busInterfaces', busIndex, 'conduitPorts'],
      [...conduitPorts, { name, direction: 'out', width: 1 }]
    );
  };

  const updateSignal = (i: number, updates: Partial<ConduitPort>) => {
    const next = conduitPorts.map((p, idx) => (idx === i ? { ...p, ...updates } : p));
    onUpdate(['busInterfaces', busIndex, 'conduitPorts'], next);
  };

  const removeSignal = (i: number) => {
    const next = conduitPorts.filter((_, idx) => idx !== i);
    onUpdate(['busInterfaces', busIndex, 'conduitPorts'], next.length ? next : undefined);
  };

  return (
    <Section title="Signals">
      {conduitPorts.length === 0 && (
        <div className="ci-override-empty">No signals — click Add to define ports</div>
      )}
      {conduitPorts.length > 0 && (
        <div className="ci-conduit-signals">
          {conduitPorts.map((cp, i) => (
            <ConduitSignalRow
              key={i}
              port={cp}
              paramNames={paramNames}
              paramValues={paramValues}
              onChange={(updates) => updateSignal(i, updates)}
              onRemove={() => removeSignal(i)}
            />
          ))}
        </div>
      )}
      <button className="ci-conduit-add" onClick={addSignal} type="button">
        <span className="codicon codicon-add" aria-hidden="true" /> Add signal
      </button>
    </Section>
  );
};

// ─────────────────────────────────────────────────────
//  WidthExprControl — shared number/parameter-expression width input
//
//  Consolidates what used to be three copy-pasted implementations
//  (PropWidthField, ConduitSignalRow, PortWidthRow): the number/expr mode
//  toggle, the input itself, the codicon-info help popover, the as-you-type
//  function/parameter autocomplete dropdown, and the resolved-value preview.
//  Callers keep their own outer wrapper markup (label, compact row, reset
//  button) and render this for just the input sub-block.
// ─────────────────────────────────────────────────────

type WidthSuggestion =
  | { kind: 'function'; name: string; signature: string }
  | { kind: 'param'; name: string };

const MAX_WIDTH_SUGGESTIONS = 8;

function getWidthSuggestions(
  text: string,
  cursor: number,
  paramNames: string[]
): { token: { start: number; end: number }; items: WidthSuggestion[] } | null {
  const token = getIdentifierTokenAtCursor(text, cursor);
  if (!token) {
    return null;
  }
  const query = token.text.toLowerCase();
  const functionNames = (
    Object.keys(WIDTH_FUNCTION_HELP) as Array<keyof typeof WIDTH_FUNCTION_HELP>
  )
    .filter((name) => name.toLowerCase().startsWith(query))
    .sort();
  const paramMatches = paramNames.filter((name) => name.toLowerCase().startsWith(query)).sort();

  const items: WidthSuggestion[] = [
    ...functionNames.map(
      (name): WidthSuggestion => ({
        kind: 'function',
        name,
        signature: WIDTH_FUNCTION_HELP[name].signature,
      })
    ),
    ...paramMatches.map((name): WidthSuggestion => ({ kind: 'param', name })),
  ].slice(0, MAX_WIDTH_SUGGESTIONS);

  return items.length > 0 ? { token, items } : null;
}

interface WidthExprControlProps {
  value: number | string;
  /** Fallback for revert-to-number and empty-expr commit. Defaults to 1. */
  defaultWidth?: number;
  paramNames: string[];
  paramValues?: Record<string, number>;
  onSave: (value: number | string) => void;
  /** Class for the wrapping row div — differs per call site's layout (compact
   *  row vs. labeled field row). */
  rowClassName: string;
  /** Base class for the input; an `--expr` modifier variant is appended in
   *  expr mode (a no-op unless the base class defines one). */
  inputClassName: string;
  /** Class for the mode-toggle and info buttons. */
  toggleClassName?: string;
  /** 'inline': resolved-value badge sits inside the row (compact rows).
   *  'below': resolved-value line sits below the row (labeled field). */
  previewStyle?: 'inline' | 'below';
}

const WidthExprControl: React.FC<WidthExprControlProps> = ({
  value,
  defaultWidth = 1,
  paramNames,
  paramValues = {},
  onSave,
  rowClassName,
  inputClassName,
  toggleClassName = 'ci-pw-mode-toggle',
  previewStyle = 'inline',
}) => {
  const [mode, setMode] = useState<'number' | 'expr'>(() =>
    typeof value === 'string' ? 'expr' : 'number'
  );
  const [draft, setDraft] = useState<string>(() =>
    typeof value === 'string' ? value : String(value)
  );
  const [focused, setFocused] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [helpPosition, setHelpPosition] = useState<{ x: number; y: number } | null>(null);
  const helpButtonRef = useRef<HTMLButtonElement>(null);

  const [suggestOpen, setSuggestOpen] = useState(false);
  const [suggestions, setSuggestions] = useState<WidthSuggestion[]>([]);
  const [activeSuggestion, setActiveSuggestion] = useState(0);
  const [activeToken, setActiveToken] = useState<{ start: number; end: number } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const comboboxRef = useRef<HTMLDivElement>(null);
  const pendingCaretRef = useRef<number | null>(null);

  useEffect(() => {
    if (typeof value === 'string') {
      setMode('expr');
      if (!focused) {
        setDraft(value);
      }
    } else {
      setMode('number');
      if (!focused) {
        setDraft(String(value));
      }
    }
  }, [value, focused]);

  useEffect(() => {
    if (!suggestOpen) {
      return;
    }
    const onDocMouseDown = (e: MouseEvent) => {
      if (comboboxRef.current && !comboboxRef.current.contains(e.target as Node)) {
        setSuggestOpen(false);
      }
    };
    document.addEventListener('mousedown', onDocMouseDown);
    return () => document.removeEventListener('mousedown', onDocMouseDown);
  }, [suggestOpen]);

  useLayoutEffect(() => {
    if (pendingCaretRef.current !== null && inputRef.current) {
      const pos = pendingCaretRef.current;
      pendingCaretRef.current = null;
      inputRef.current.focus();
      inputRef.current.setSelectionRange(pos, pos);
    }
  }, [draft]);

  const hasParams = paramNames.length > 0;

  const coerceExpr = (raw: string): number | string => {
    const trimmed = raw.trim();
    if (!trimmed) {
      return defaultWidth;
    }
    const asInt = parseInt(trimmed, 10);
    if (!isNaN(asInt) && asInt > 0 && String(asInt) === trimmed) {
      return asInt;
    }
    return trimmed;
  };

  const commit = (raw: string) => {
    if (mode === 'expr') {
      onSave(coerceExpr(raw));
    } else {
      const n = parseInt(raw.trim(), 10);
      onSave(!isNaN(n) && n > 0 ? n : defaultWidth);
    }
  };

  const toggleMode = () => {
    if (mode === 'expr') {
      const fallback = resolved ?? defaultWidth;
      setMode('number');
      setDraft(String(fallback));
      onSave(fallback);
    } else {
      const initial = hasParams ? paramNames[0] : '';
      setMode('expr');
      setDraft(initial);
      onSave(initial || defaultWidth);
    }
    setSuggestOpen(false);
  };

  const valueDisplay = focused ? draft : typeof value === 'string' ? value : String(value);
  const resolved =
    mode === 'expr' && valueDisplay.trim() ? evalWidthExpr(valueDisplay, paramValues) : undefined;

  const acceptSuggestion = (item: WidthSuggestion) => {
    if (!activeToken) {
      return;
    }
    const insertText = item.kind === 'function' ? `${item.name}()` : item.name;
    const caretOffset = item.kind === 'function' ? item.name.length + 1 : item.name.length;
    const newValue = draft.slice(0, activeToken.start) + insertText + draft.slice(activeToken.end);
    pendingCaretRef.current = activeToken.start + caretOffset;
    setDraft(newValue);
    setSuggestOpen(false);
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newValue = e.target.value;
    setDraft(newValue);
    if (mode !== 'expr') {
      return;
    }
    const cursor = e.target.selectionStart ?? newValue.length;
    const result = getWidthSuggestions(newValue, cursor, paramNames);
    if (result) {
      setActiveToken(result.token);
      setSuggestions(result.items);
      setActiveSuggestion(0);
      setSuggestOpen(true);
    } else {
      setSuggestOpen(false);
    }
  };

  const displayValueForEdit = typeof value === 'string' ? value : String(value);

  return (
    <>
      <div className={rowClassName}>
        <div
          className={`ci-combobox${mode === 'expr' ? ' ci-combobox--expr' : ''}`}
          ref={comboboxRef}
        >
          <input
            ref={inputRef}
            className={`${inputClassName}${mode === 'expr' ? ` ${inputClassName}--expr` : ''}`}
            value={valueDisplay}
            placeholder={
              mode === 'expr' ? (hasParams ? paramNames[0] : 'expr…') : String(defaultWidth)
            }
            onChange={handleChange}
            onFocus={() => {
              setFocused(true);
              setDraft(displayValueForEdit);
            }}
            onBlur={() => {
              setFocused(false);
              setSuggestOpen(false);
              commit(draft);
            }}
            onKeyDown={(e) => {
              if (suggestOpen && suggestions.length > 0) {
                if (e.key === 'ArrowDown') {
                  e.preventDefault();
                  setActiveSuggestion((i) => Math.min(i + 1, suggestions.length - 1));
                  return;
                }
                if (e.key === 'ArrowUp') {
                  e.preventDefault();
                  setActiveSuggestion((i) => Math.max(i - 1, 0));
                  return;
                }
                if (e.key === 'Enter' || e.key === 'Tab') {
                  e.preventDefault();
                  acceptSuggestion(suggestions[activeSuggestion]);
                  return;
                }
                if (e.key === 'Escape') {
                  e.preventDefault();
                  setSuggestOpen(false);
                  return;
                }
              }
              if (e.key === 'Enter') {
                e.currentTarget.blur();
              } else if (e.key === 'Escape') {
                setDraft(displayValueForEdit);
                setFocused(false);
                e.currentTarget.blur();
              }
            }}
            title={
              mode === 'expr' && resolved !== undefined
                ? `= ${resolved}`
                : mode === 'expr' && valueDisplay.trim()
                  ? '= ? (unresolved)'
                  : undefined
            }
            style={
              inputClassName === 'ci-field__input'
                ? { fontFamily: 'var(--vscode-editor-font-family, monospace)' }
                : undefined
            }
          />
          {suggestOpen && suggestions.length > 0 && (
            <div className="ci-combobox__list">
              {suggestions.map((item, i) => (
                <div
                  key={`${item.kind}-${item.name}`}
                  className={`ci-combobox__option${i === activeSuggestion ? ' ci-combobox__option--active' : ''}`}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    acceptSuggestion(item);
                  }}
                  onMouseEnter={() => setActiveSuggestion(i)}
                >
                  {item.kind === 'function' ? item.signature : item.name}
                </div>
              ))}
            </div>
          )}
        </div>
        <button
          className={toggleClassName}
          onClick={toggleMode}
          title={mode === 'expr' ? 'Use a literal number' : 'Use a parameter or expression'}
          type="button"
        >
          {mode === 'expr' ? (
            '123'
          ) : (
            <span style={{ fontFamily: 'var(--vscode-editor-font-family, monospace)' }}>ƒ(x)</span>
          )}
        </button>
        {mode === 'expr' && (
          <button
            ref={helpButtonRef}
            type="button"
            className={toggleClassName}
            title="Show width expression functions"
            onClick={() => {
              const rect = helpButtonRef.current?.getBoundingClientRect();
              if (rect) {
                setHelpPosition({ x: rect.left, y: rect.bottom + 4 });
              }
              setHelpOpen((open) => !open);
            }}
          >
            <span className="codicon codicon-info" />
          </button>
        )}
        {previewStyle === 'inline' && mode === 'expr' && valueDisplay.trim() && (
          <span
            className={`ci-pw-expr-preview${resolved === undefined ? ' ci-pw-expr-preview--invalid' : ''}`}
          >
            ={resolved ?? '?'}
          </span>
        )}
      </div>
      <WidthFunctionHelpMenu
        position={helpOpen ? helpPosition : null}
        onClose={() => setHelpOpen(false)}
      />
      {previewStyle === 'below' && mode === 'expr' && valueDisplay.trim() && (
        <div
          className={`ci-field__expr-preview${resolved === undefined ? ' ci-field__expr-preview--invalid' : ''}`}
        >
          = {resolved ?? '?'}
        </div>
      )}
    </>
  );
};

interface ConduitSignalRowProps {
  port: ConduitPort;
  paramNames: string[];
  paramValues?: Record<string, number>;
  onChange: (updates: Partial<ConduitPort>) => void;
  onRemove: () => void;
}

const PRESENCE_LABELS: Record<string, string> = { required: 'REQ', optional: 'OPT' };

const ConduitSignalRow: React.FC<ConduitSignalRowProps> = ({
  port,
  paramNames,
  paramValues = {},
  onChange,
  onRemove,
}) => {
  const [nameDraft, setNameDraft] = useState(port.name);
  const [nameFocused, setNameFocused] = useState(false);

  useEffect(() => {
    if (!nameFocused) {
      setNameDraft(port.name);
    }
  }, [port.name, nameFocused]);

  const presence = port.presence ?? 'required';

  return (
    <div className="ci-conduit-row">
      <input
        className="ci-conduit-name"
        value={nameFocused ? nameDraft : port.name}
        placeholder="signal"
        onChange={(e) => setNameDraft(e.target.value)}
        onFocus={() => {
          setNameFocused(true);
          setNameDraft(port.name);
        }}
        onBlur={() => {
          setNameFocused(false);
          if (nameDraft !== port.name) {
            onChange({ name: nameDraft });
          }
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.currentTarget.blur();
          } else if (e.key === 'Escape') {
            setNameDraft(port.name);
            setNameFocused(false);
            e.currentTarget.blur();
          }
        }}
        style={{ fontFamily: 'var(--vscode-editor-font-family, monospace)' }}
      />
      <select
        className="ci-conduit-dir"
        value={port.direction}
        onChange={(e) => onChange({ direction: e.target.value as ConduitPort['direction'] })}
      >
        <option value="in">in</option>
        <option value="out">out</option>
        <option value="inout">inout</option>
      </select>
      <WidthExprControl
        value={port.width ?? 1}
        paramNames={paramNames}
        paramValues={paramValues}
        onSave={(width) => onChange({ width })}
        rowClassName="ci-pw-field"
        inputClassName="ci-pw-input"
        previewStyle="inline"
      />
      <button
        className={`ci-conduit-presence ci-conduit-presence--${presence}`}
        onClick={() => onChange({ presence: presence === 'required' ? 'optional' : 'required' })}
        title={
          presence === 'required'
            ? 'Required — click to make optional'
            : 'Optional — click to make required'
        }
        type="button"
      >
        {PRESENCE_LABELS[presence]}
      </button>
      <button className="ci-conduit-remove" onClick={onRemove} title="Remove signal" type="button">
        <span className="codicon codicon-close" aria-hidden="true" />
      </button>
    </div>
  );
};

// ─────────────────────────────────────────────────────
//  Array configuration section
// ─────────────────────────────────────────────────────

interface ArraySectionProps {
  bus: BusInterface;
  busIndex: number;
  onUpdate: YamlUpdateHandler;
}

const ArraySection: React.FC<ArraySectionProps> = ({ bus, busIndex, onUpdate }) => {
  const array = bus.array as
    | {
        count?: number;
        indexStart?: number;
        namingPattern?: string;
        physicalPrefixPattern?: string;
      }
    | undefined
    | null;

  if (!array) {
    return null;
  }

  const saveCount = (raw: string) => {
    const n = parseInt(raw, 10);
    if (!Number.isFinite(n) || n < 1) {
      return;
    }
    if (n <= 1) {
      onUpdate(['busInterfaces', busIndex, 'array'], undefined);
    } else {
      onUpdate(['busInterfaces', busIndex, 'array', 'count'], n);
    }
  };

  const saveNamingPattern = (raw: string) => {
    if (!raw.includes('{index}')) {
      // Pattern without {index} would produce duplicate names — dissolve the array
      onUpdate(['busInterfaces', busIndex, 'array'], undefined);
    } else {
      onUpdate(['busInterfaces', busIndex, 'array', 'namingPattern'], raw);
    }
  };

  const savePrefixPattern = (raw: string) => {
    onUpdate(['busInterfaces', busIndex, 'array', 'physicalPrefixPattern'], raw || null);
  };

  const saveIndexStart = (raw: string) => {
    const n = parseInt(raw, 10);
    onUpdate(['busInterfaces', busIndex, 'array', 'indexStart'], Number.isFinite(n) ? n : 0);
  };

  return (
    <Section title="Array">
      <PropField
        label="Count"
        value={String(array.count ?? 2)}
        onSave={saveCount}
        placeholder="2"
        hint="Set to 1 to remove array"
        mono
      />
      <PropField
        label="Index Start"
        value={String(array.indexStart ?? 0)}
        onSave={saveIndexStart}
        placeholder="0"
        mono
      />
      <PropField
        label="Name Pattern"
        value={array.namingPattern ?? ''}
        onSave={saveNamingPattern}
        placeholder="IFACE_{index}"
        hint="Must include {index}"
        mono
      />
      <PropField
        label="Prefix Pattern"
        value={array.physicalPrefixPattern ?? ''}
        onSave={savePrefixPattern}
        placeholder="iface_{index}_"
        mono
      />
    </Section>
  );
};

// ─────────────────────────────────────────────────────
//  Port width overrides section
// ─────────────────────────────────────────────────────

interface PortWidthOverridesSectionProps {
  bus: BusInterface;
  busIndex: number;
  paramNames: string[];
  paramValues?: Record<string, number>;
  /** Port definitions from the loaded custom bus library, used as fallback for user-defined bus types. */
  libraryPortDefs?: BusPortDef[];
  onUpdate: YamlUpdateHandler;
}

const PortWidthOverridesSection: React.FC<PortWidthOverridesSectionProps> = ({
  bus,
  busIndex,
  paramNames,
  paramValues = {},
  libraryPortDefs,
  onUpdate,
}) => {
  const portDefs = lookupBusDef(bus.type) ?? libraryPortDefs ?? null;
  const overrides = (bus.portWidthOverrides ?? {}) as Record<string, number | string>;

  if (!portDefs) {
    return (
      <Section title="Port Widths">
        <div className="ci-override-empty">No signal definitions for this bus type</div>
      </Section>
    );
  }

  const useOptionalPorts = (bus.useOptionalPorts ?? []) as string[];
  const enabledDefs = portDefs.filter(
    (p) => p.presence === 'required' || useOptionalPorts.includes(p.name)
  );

  if (enabledDefs.length === 0) {
    return (
      <Section title="Port Widths">
        <div className="ci-override-empty">
          No enabled ports — expand the bus to activate signals
        </div>
      </Section>
    );
  }

  // Signals with an explicit standard width of 1 are fixed by the bus specification and
  // cannot be meaningfully overridden. Signals with no declared width at all (common for
  // discovered Vivado interfaces, e.g. fifo_write's WR_DATA) are parameterized rather than
  // fixed-at-1 — those must stay editable so the user can set a real width.
  const configurableDefs = enabledDefs.filter((p) => p.width === undefined || p.width > 1);

  if (configurableDefs.length === 0) {
    return null;
  }

  const saveWidth = (portName: string, value: number | string, defaultWidth: number) => {
    const basePath = ['busInterfaces', busIndex, 'portWidthOverrides'];
    const hasOverride = portName in overrides;

    if (value === defaultWidth) {
      if (hasOverride) {
        const remaining = Object.keys(overrides).filter((k) => k !== portName);
        onUpdate(remaining.length === 0 ? basePath : [...basePath, portName], undefined);
      }
      return;
    }

    onUpdate([...basePath, portName], value);
  };

  const resetWidth = (portName: string) => {
    const basePath = ['busInterfaces', busIndex, 'portWidthOverrides'];
    const remaining = Object.keys(overrides).filter((k) => k !== portName);
    onUpdate(remaining.length === 0 ? basePath : [...basePath, portName], undefined);
  };

  return (
    <Section title="Port Widths">
      {configurableDefs.map((portDef) => {
        const defaultWidth = portDef.width ?? 1;
        const override = overrides[portDef.name];
        const hasOverride = override !== undefined;
        const currentValue: number | string = hasOverride ? override : defaultWidth;

        return (
          <PortWidthRow
            key={portDef.name}
            signal={portDef.name}
            direction={portDef.direction}
            currentValue={currentValue}
            defaultWidth={defaultWidth}
            hasFixedDefault={portDef.width !== undefined}
            hasOverride={hasOverride}
            paramNames={paramNames}
            paramValues={paramValues}
            onSave={(value) => saveWidth(portDef.name, value, defaultWidth)}
            onReset={() => resetWidth(portDef.name)}
          />
        );
      })}
    </Section>
  );
};

interface PortWidthRowProps {
  signal: string;
  direction?: 'in' | 'out';
  currentValue: number | string;
  defaultWidth: number;
  /** False when the interface spec declares no width for this port (e.g. a parameterized
   *  data signal like fifo_write's WR_DATA) — the shown defaultWidth is just a fallback,
   *  not a real standard value, so the row is flagged for the user. */
  hasFixedDefault: boolean;
  hasOverride: boolean;
  paramNames: string[];
  paramValues?: Record<string, number>;
  onSave: (value: number | string) => void;
  onReset: () => void;
}

const PortWidthRow: React.FC<PortWidthRowProps> = ({
  signal,
  direction,
  currentValue,
  defaultWidth,
  hasFixedDefault,
  hasOverride,
  paramNames,
  paramValues = {},
  onSave,
  onReset,
}) => {
  const dirSymbol = direction === 'out' ? '›' : direction === 'in' ? '‹' : ' ';

  return (
    <div className={`ci-pw-row${hasOverride ? ' ci-pw-row--overridden' : ''}`}>
      <span className="ci-pw-dir" aria-hidden="true">
        {dirSymbol}
      </span>
      <span
        className="ci-pw-name"
        title={hasFixedDefault ? signal : `${signal} — no standard width; set to match your design`}
      >
        {signal}
        {!hasFixedDefault && <span className="ci-pw-unconstrained">*</span>}
      </span>
      <WidthExprControl
        value={currentValue}
        defaultWidth={defaultWidth}
        paramNames={paramNames}
        paramValues={paramValues}
        onSave={onSave}
        rowClassName="ci-pw-field"
        inputClassName="ci-pw-input"
        previewStyle="inline"
      />
      {hasOverride ? (
        <button className="ci-pw-reset" onClick={onReset} title="Reset to default">
          <span className="codicon codicon-discard" />
        </button>
      ) : (
        <span className="ci-pw-reset-placeholder" />
      )}
    </div>
  );
};

// ─────────────────────────────────────────────────────
//  Memory map field (dropdown + file picker)
// ─────────────────────────────────────────────────────

interface MemoryMapFieldProps {
  /** Current value of the import path for this interface's map entry */
  importPath: string | null;
  /** Save a selected file. Receives both the relative path and the canonical
   *  map name read from inside the file by the extension host. */
  onSave: (path: string | null, mapName?: string) => void;
}

/** File-path row for a per-interface memory map import. */
const MemoryMapField: React.FC<MemoryMapFieldProps> = ({ importPath, onSave }) => {
  const handleBrowse = () => {
    vscode?.postMessage({
      type: 'selectFiles',
      multi: false,
      filters: { 'Memory Map': ['mm.yml', 'yml'] },
      startPath: importPath ?? undefined,
    });
    const handler = (event: MessageEvent) => {
      const msg = event.data as {
        type?: string;
        files?: string[];
        memoryMapNames?: Record<string, string>;
      };
      if (msg.type === 'filesSelected' && msg.files && msg.files.length > 0) {
        const filePath = msg.files[0];
        const mapName = msg.memoryMapNames?.[filePath];
        onSave(filePath, mapName);
        window.removeEventListener('message', handler);
      }
    };
    window.addEventListener('message', handler);
  };

  return (
    <div className="ci-field">
      <label className="ci-field__label">Map File</label>
      <div className="ci-mmap-row">
        {importPath ? (
          <span className="ci-mmap-path" title={importPath}>
            {importPath}
          </span>
        ) : (
          <span className="ci-mmap-path ci-mmap-path--empty">No file linked</span>
        )}
        <button className="ci-mmap-btn" onClick={handleBrowse} title="Browse .mm.yml file">
          <span className="codicon codicon-folder-opened" />
        </button>
        {importPath && (
          <button
            className="ci-mmap-btn ci-mmap-btn--clear"
            onClick={() => onSave(null)}
            title="Remove file link"
          >
            <span className="codicon codicon-close" />
          </button>
        )}
      </div>
    </div>
  );
};

// ─────────────────────────────────────────────────────
//  Shared field primitives
// ─────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────
//  FuzzySelect — searchable dropdown over a list of VLNV options
// ─────────────────────────────────────────────────────

interface VlnvOption {
  vlnv: string;
  label: string;
}

/** Subsequence-aware fuzzy match score; null means no match. Contiguous substring
 *  matches always outrank scattered ones, and earlier/tighter matches score higher. */
function fuzzyScore(query: string, text: string): number | null {
  if (!query) {
    return 0;
  }
  const q = query.toLowerCase();
  const t = text.toLowerCase();
  const idx = t.indexOf(q);
  if (idx !== -1) {
    return 1000 - idx;
  }
  let cursor = 0;
  let gapPenalty = 0;
  for (const ch of q) {
    const found = t.indexOf(ch, cursor);
    if (found === -1) {
      return null;
    }
    gapPenalty += found - cursor;
    cursor = found + 1;
  }
  return 100 - gapPenalty;
}

function filterFuzzy(query: string, options: VlnvOption[]): VlnvOption[] {
  const trimmed = query.trim();
  if (!trimmed) {
    return options;
  }
  return options
    .map((o) => ({
      o,
      score: Math.max(
        fuzzyScore(trimmed, o.label) ?? -Infinity,
        fuzzyScore(trimmed, o.vlnv) ?? -Infinity
      ),
    }))
    .filter((s) => s.score > -Infinity)
    .sort((a, b) => b.score - a.score)
    .map((s) => s.o);
}

interface FuzzySelectProps {
  options: VlnvOption[];
  value: string;
  /** Text to show when closed and `value` doesn't match any option (e.g. a raw VLNV). */
  displayValue: string;
  onSelect: (vlnv: string) => void;
  placeholder?: string;
}

const FuzzySelect: React.FC<FuzzySelectProps> = ({
  options,
  value,
  displayValue,
  onSelect,
  placeholder,
}) => {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const selectedOpt = options.find((o) => o.vlnv === value);
  const closedLabel = selectedOpt?.label ?? displayValue;
  const filtered = useMemo(() => filterFuzzy(query, options), [query, options]);

  useEffect(() => {
    setActiveIndex(0);
  }, [query]);

  useEffect(() => {
    if (!open) {
      return;
    }
    const onDocMouseDown = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
        setQuery('');
      }
    };
    document.addEventListener('mousedown', onDocMouseDown);
    return () => document.removeEventListener('mousedown', onDocMouseDown);
  }, [open]);

  const choose = (opt: VlnvOption) => {
    onSelect(opt.vlnv);
    setOpen(false);
    setQuery('');
  };

  return (
    <div className="ci-combobox" ref={containerRef}>
      <input
        ref={inputRef}
        className="ci-field__input ci-combobox__input"
        value={open ? query : closedLabel}
        placeholder={placeholder ?? 'Search…'}
        onFocus={() => {
          setOpen(true);
          setQuery('');
          setActiveIndex(0);
        }}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
        }}
        onBlur={() => {
          setOpen(false);
          setQuery('');
        }}
        onKeyDown={(e) => {
          if (!open) {
            return;
          }
          if (e.key === 'ArrowDown') {
            e.preventDefault();
            setActiveIndex((i) => Math.min(i + 1, filtered.length - 1));
          } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setActiveIndex((i) => Math.max(i - 1, 0));
          } else if (e.key === 'Enter') {
            e.preventDefault();
            const opt = filtered[activeIndex];
            if (opt) {
              choose(opt);
            }
          } else if (e.key === 'Escape') {
            setOpen(false);
            setQuery('');
            e.currentTarget.blur();
          }
        }}
      />
      {open && (
        <div className="ci-combobox__list">
          {filtered.length === 0 ? (
            <div className="ci-combobox__empty">No matches</div>
          ) : (
            filtered.map((opt, i) => (
              <div
                key={opt.vlnv}
                className={`ci-combobox__option${i === activeIndex ? ' ci-combobox__option--active' : ''}${opt.vlnv === value ? ' ci-combobox__option--selected' : ''}`}
                onMouseDown={(e) => {
                  e.preventDefault();
                  choose(opt);
                }}
                onMouseEnter={() => setActiveIndex(i)}
              >
                {opt.label}
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
};

// ─────────────────────────────────────────────────────
//  BusTypeField — preset select / manual VLNV text toggle
// ─────────────────────────────────────────────────────

interface BusTypeFieldProps {
  value: string;
  busLibrary?: unknown;
  onSave: (vlnv: string) => void;
}

const BusTypeField: React.FC<BusTypeFieldProps> = ({ value, busLibrary, onSave }) => {
  const libraryOpts = useMemo(
    () => (busLibrary ? listLibraryBusTypes(busLibrary as Record<string, unknown>) : []),
    [busLibrary]
  );
  const allOpts = useMemo(() => [...BUILTIN_BUS_TYPES, ...libraryOpts], [libraryOpts]);
  const isPreset = allOpts.some((o) => o.vlnv === value);

  const [mode, setMode] = useState<'preset' | 'manual'>(() => (isPreset ? 'preset' : 'manual'));
  const [draft, setDraft] = useState(value);
  const [focused, setFocused] = useState(false);

  useEffect(() => {
    if (!focused) {
      setDraft(value);
    }
  }, [value, focused]);

  const commitManual = () => {
    setFocused(false);
    const trimmed = draft.trim();
    if (trimmed && trimmed !== value) {
      onSave(trimmed);
    } else {
      setDraft(value);
    }
  };

  const toggleMode = () => {
    if (mode === 'preset') {
      setMode('manual');
      setDraft(value);
    } else {
      setMode('preset');
      if (!allOpts.some((o) => o.vlnv === value)) {
        onSave(BUILTIN_BUS_TYPES[0].vlnv);
      }
    }
  };

  return (
    <div className="ci-field">
      <label className="ci-field__label">Bus Type</label>
      <div className="ci-field__input-row">
        {mode === 'preset' ? (
          <FuzzySelect
            options={allOpts}
            value={value}
            displayValue={value}
            onSelect={onSave}
            placeholder="Search bus types…"
          />
        ) : (
          <input
            className="ci-field__input"
            value={focused ? draft : value}
            placeholder={BUS_VLNV.AXI4_LITE}
            style={{ fontFamily: 'var(--vscode-editor-font-family, monospace)' }}
            onChange={(e) => setDraft(e.target.value)}
            onFocus={() => {
              setFocused(true);
              setDraft(value);
            }}
            onBlur={commitManual}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.currentTarget.blur();
              } else if (e.key === 'Escape') {
                setDraft(value);
                setFocused(false);
                e.currentTarget.blur();
              }
            }}
          />
        )}
        <button
          className="ci-pw-mode-toggle ci-field__mode-toggle"
          onClick={toggleMode}
          title={mode === 'preset' ? 'Enter VLNV manually' : 'Choose from preset types'}
        >
          {mode === 'preset' ? (
            <span className="codicon codicon-edit" aria-label="manual" />
          ) : (
            <span className="codicon codicon-list-unordered" aria-label="preset" />
          )}
        </button>
      </div>
      {mode === 'manual' && <div className="ci-field__hint">Vendor:library:name:version</div>}
    </div>
  );
};

// ─────────────────────────────────────────────────────
//  InterfaceTypeField — preset select (known custom interfaces) / manual VLNV toggle
// ─────────────────────────────────────────────────────

interface InterfaceTypeFieldProps {
  /** Full VLNV of the interface (e.g. 'xilinx.com:interface:fifo_write:1.0' or 'user:busif:spi:1.0'). */
  value: string;
  busLibrary?: unknown;
  onSave: (vlnv: string) => void;
}

const InterfaceTypeField: React.FC<InterfaceTypeFieldProps> = ({ value, busLibrary, onSave }) => {
  const libraryOpts = useMemo(
    () => (busLibrary ? listLibraryBusTypes(busLibrary as Record<string, unknown>) : []),
    [busLibrary]
  );
  const isPreset = libraryOpts.some((o) => o.vlnv === value);

  const [mode, setMode] = useState<'preset' | 'manual'>(() => (isPreset ? 'preset' : 'manual'));
  const currentTypeName = conduitTypeName(value);
  const [draft, setDraft] = useState(currentTypeName);
  const [focused, setFocused] = useState(false);

  useEffect(() => {
    if (!focused) {
      setDraft(conduitTypeName(value));
    }
  }, [value, focused]);

  const commitManual = () => {
    setFocused(false);
    const trimmed = draft.trim();
    if (!trimmed) {
      if (value !== BUS_VLNV.CONDUIT) {
        onSave(BUS_VLNV.CONDUIT);
      }
      return;
    }
    // A fully-qualified VLNV (e.g. pasted from IP-XACT/Vivado) is saved as-is;
    // a short display name (e.g. "SPI") is synthesized into a user:busif VLNV.
    const next = isValidVlnv(trimmed) ? trimmed : buildConduitType(trimmed);
    if (next !== value) {
      onSave(next);
    } else {
      setDraft(conduitTypeName(value));
    }
  };

  const toggleMode = () => {
    if (mode === 'preset') {
      setMode('manual');
      setDraft(conduitTypeName(value));
    } else {
      setMode('preset');
      if (libraryOpts.length > 0 && !libraryOpts.some((o) => o.vlnv === value)) {
        onSave(libraryOpts[0].vlnv);
      }
    }
  };

  const hint = currentTypeName
    ? currentTypeName.includes(':')
      ? `VLNV: ${currentTypeName}`
      : `VLNV: user:busif:${currentTypeName}:1.0`
    : 'Give this interface a name, or paste a full VLNV';

  return (
    <div className="ci-field">
      <label className="ci-field__label">Interface Type</label>
      <div className="ci-field__input-row">
        {mode === 'preset' ? (
          <FuzzySelect
            options={libraryOpts}
            value={value}
            displayValue={value}
            onSelect={onSave}
            placeholder="Search known interface types…"
          />
        ) : (
          <input
            className="ci-field__input"
            value={focused ? draft : currentTypeName}
            placeholder="SPI, I2C, UART, or a full vendor:library:name:version"
            style={{ fontFamily: 'var(--vscode-editor-font-family, monospace)' }}
            onChange={(e) => setDraft(e.target.value)}
            onFocus={() => {
              setFocused(true);
              setDraft(currentTypeName);
            }}
            onBlur={commitManual}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.currentTarget.blur();
              } else if (e.key === 'Escape') {
                setDraft(currentTypeName);
                setFocused(false);
                e.currentTarget.blur();
              }
            }}
          />
        )}
        {libraryOpts.length > 0 && (
          <button
            className="ci-pw-mode-toggle ci-field__mode-toggle"
            onClick={toggleMode}
            title={
              mode === 'preset'
                ? 'Enter a custom name or VLNV'
                : 'Choose from known interface types'
            }
          >
            {mode === 'preset' ? (
              <span className="codicon codicon-edit" aria-label="manual" />
            ) : (
              <span className="codicon codicon-list-unordered" aria-label="preset" />
            )}
          </button>
        )}
      </div>
      {mode === 'manual' && <div className="ci-field__hint">{hint}</div>}
    </div>
  );
};

// ─────────────────────────────────────────────────────
//  PropWidthField — labeled width field with number/parameter toggle
// ─────────────────────────────────────────────────────

interface PropWidthFieldProps {
  label: string;
  value: number | string;
  paramNames: string[];
  paramValues?: Record<string, number>;
  onSave: (value: number | string) => void;
}

const PropWidthField: React.FC<PropWidthFieldProps> = ({
  label,
  value,
  paramNames,
  paramValues = {},
  onSave,
}) => {
  return (
    <div className="ci-field">
      <label className="ci-field__label">{label}</label>
      <WidthExprControl
        value={value}
        paramNames={paramNames}
        paramValues={paramValues}
        onSave={onSave}
        rowClassName="ci-field__input-row"
        inputClassName="ci-field__input"
        toggleClassName="ci-pw-mode-toggle ci-field__mode-toggle"
        previewStyle="below"
      />
    </div>
  );
};

interface PropFieldProps {
  label: string;
  value: string;
  onSave: (v: string) => void;
  validate?: (v: string) => string | null;
  placeholder?: string;
  hint?: string;
  mono?: boolean;
  hasError?: boolean;
  errorMsg?: string;
}

const PropField: React.FC<PropFieldProps> = ({
  label,
  value,
  onSave,
  validate,
  placeholder,
  hint,
  mono = false,
  hasError = false,
  errorMsg,
}) => {
  const [draft, setDraft] = useState(value);
  const [focused, setFocused] = useState(false);
  const [liveError, setLiveError] = useState<string | null>(null);

  useEffect(() => {
    if (!focused) {
      setDraft(value);
      setLiveError(null);
    }
  }, [value, focused]);

  const handleChange = (v: string) => {
    setDraft(v);
    if (liveError) {
      setLiveError(validate?.(v) ?? null);
    }
  };

  const commit = () => {
    const err = validate?.(draft) ?? null;
    if (err) {
      // Revert — invalid value discarded silently
      setDraft(value);
      setLiveError(null);
    } else if (draft !== value) {
      onSave(draft);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.currentTarget.blur();
    } else if (e.key === 'Escape') {
      setDraft(value);
      setLiveError(null);
      setFocused(false);
      e.currentTarget.blur();
    }
  };

  const showErr = liveError ?? (hasError ? errorMsg : null);

  return (
    <div className="ci-field">
      <label className="ci-field__label">{label}</label>
      <input
        className={`ci-field__input${showErr ? ' ci-field__input--error' : ''}`}
        value={draft}
        placeholder={placeholder}
        onChange={(e) => handleChange(e.target.value)}
        onFocus={() => setFocused(true)}
        onBlur={() => {
          setFocused(false);
          commit();
        }}
        onKeyDown={handleKeyDown}
        style={mono ? { fontFamily: 'var(--vscode-editor-font-family, monospace)' } : undefined}
      />
      {showErr ? (
        <div className="ci-field__error">{showErr}</div>
      ) : hint ? (
        <div className="ci-field__hint">{hint}</div>
      ) : null}
    </div>
  );
};

interface PropSelectProps {
  label: string;
  value: string;
  options: { value: string; label: string }[];
  onSave: (v: string) => void;
  emptyOption?: string;
}

const PropSelect: React.FC<PropSelectProps> = ({ label, value, options, onSave, emptyOption }) => (
  <div className="ci-field">
    <label className="ci-field__label">{label}</label>
    <select className="ci-field__select" value={value} onChange={(e) => onSave(e.target.value)}>
      {emptyOption !== undefined && <option value="">{emptyOption}</option>}
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  </div>
);

interface PropTextAreaProps {
  label: string;
  value: string;
  onSave: (v: string) => void;
  placeholder?: string;
}

const PropTextArea: React.FC<PropTextAreaProps> = ({ label, value, onSave, placeholder }) => {
  const [draft, setDraft] = useState(value);
  const [focused, setFocused] = useState(false);

  useEffect(() => {
    if (!focused) {
      setDraft(value);
    }
  }, [value, focused]);

  return (
    <div className="ci-field">
      <label className="ci-field__label">{label}</label>
      <textarea
        className="ci-field__textarea"
        value={draft}
        placeholder={placeholder}
        onChange={(e) => setDraft(e.target.value)}
        onFocus={() => setFocused(true)}
        onBlur={() => {
          setFocused(false);
          if (draft !== value) {
            onSave(draft);
          }
        }}
      />
    </div>
  );
};

const Section: React.FC<{
  title: string;
  children: React.ReactNode;
  actions?: React.ReactNode;
}> = ({ title, children, actions }) => (
  <div className="ci-section">
    <div className="ci-section__title">
      <span>{title}</span>
      {actions && <div className="ci-section__actions">{actions}</div>}
    </div>
    {children}
  </div>
);

const EmptyState: React.FC<{ label: string }> = ({ label }) => (
  <div className="ci-empty-state">{label}</div>
);

// ─────────────────────────────────────────────────────
//  Helpers & constants
// ─────────────────────────────────────────────────────

function getElementName(element: CanvasElement, ipCore: IpCore): string {
  switch (element.kind) {
    case 'body':
      return ipCore.vlnv.name;
    case 'clock':
      return (ipCore.clocks ?? [])[element.index]?.name ?? '';
    case 'reset':
      return (ipCore.resets ?? [])[element.index]?.name ?? '';
    case 'port':
      return (ipCore.ports ?? [])[element.index]?.name ?? '';
    case 'busInterface':
      return (ipCore.busInterfaces ?? [])[element.index]?.name ?? '';
    case 'parameter': {
      const p = (ipCore.parameters ?? [])[element.index] as unknown as
        | Record<string, unknown>
        | undefined;
      return String(p?.name ?? '');
    }
    case 'interrupt':
      return ((ipCore.interrupts ?? []) as Interrupt[])[element.index]?.name ?? '';
    case 'subcore': {
      const rawSubcores = (ipCore.subcores ?? []) as Array<
        string | { vlnv: string; path?: string }
      >;
      const sub = rawSubcores[element.index];
      if (!sub) {
        return '';
      }
      const vlnv = typeof sub === 'string' ? sub : sub.vlnv;
      return vlnv.split(':')[2] ?? vlnv;
    }
    case 'generics':
      return '';
    default:
      return '';
  }
}

function kindLabel(kind: CanvasElementKind): string {
  switch (kind) {
    case 'body':
      return 'IP Core';
    case 'clock':
      return 'Clock';
    case 'reset':
      return 'Reset';
    case 'port':
      return 'Port';
    case 'busInterface':
      return 'Bus Interface';
    case 'parameter':
      return 'Parameter';
    case 'interrupt':
      return 'Interrupt';
    case 'subcore':
      return 'Dependency';
    case 'generics':
      return 'Generics';
    default:
      return kind;
  }
}

function canonicalDirection(dir?: string, fallback = 'in'): string {
  if (dir === 'in' || dir === 'input') {
    return 'in';
  }
  if (dir === 'out' || dir === 'output') {
    return 'out';
  }
  if (dir === 'inout') {
    return 'inout';
  }
  return fallback;
}

function normalizePolarity(p?: string): string {
  if (p === 'active_low' || p === 'activeLow') {
    return 'activeLow';
  }
  if (p === 'active_high' || p === 'activeHigh') {
    return 'activeHigh';
  }
  return p ?? 'activeLow';
}

const DIR_2WAY = [
  { value: 'in', label: 'input' },
  { value: 'out', label: 'output' },
];

const DIR_3WAY = [
  { value: 'in', label: 'input' },
  { value: 'out', label: 'output' },
  { value: 'inout', label: 'inout' },
];

const POLARITY_OPTS = [
  { value: 'activeLow', label: 'activeLow (active-low / RESET_N)' },
  { value: 'activeHigh', label: 'activeHigh (active-high / RESET)' },
];

const BUS_MODE_OPTS = [
  { value: 'slave', label: 'slave' },
  { value: 'master', label: 'master' },
];

const CONDUIT_MODE_OPTS = [
  { value: 'conduit', label: 'conduit (signal group / neutral)' },
  { value: 'master', label: 'master (initiator)' },
  { value: 'slave', label: 'slave (target)' },
];

/** Normalize legacy sink/source modes to slave/master for display and persistence. */
function normalizeBusMode(mode: string): string {
  if (mode === 'sink') {
    return 'slave';
  }
  if (mode === 'source') {
    return 'master';
  }
  return mode;
}
