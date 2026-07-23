import React, { useEffect, useMemo, useRef, useState } from 'react';
import { BUS_VLNV } from '../../../../../../shared/busVlnv';
import { isValidVlnv } from '../../../../../../utils/vlnv';
import { BUILTIN_BUS_TYPES, listLibraryBusTypes } from '../../../../data/busDefinitions';
import { buildConduitType, conduitTypeName } from '../buses/busInterfaceMetadata';
import {
  buildSelectFilesMessage,
  listenForInspectorHostMessage,
  sendInspectorMessage,
} from '../inspectorMessages';

interface MemoryMapFieldProps {
  /** Current value of the import path for this interface's map entry */
  importPath: string | null;
  /** Save a selected file. Receives both the relative path and the canonical
   *  map name read from inside the file by the extension host. */
  onSave: (path: string | null, mapName?: string) => void;
}

/** File-path row for a per-interface memory map import. */
export const MemoryMapField: React.FC<MemoryMapFieldProps> = ({ importPath, onSave }) => {
  const handleBrowse = () => {
    listenForInspectorHostMessage('filesSelected', (message) => {
      if (message.files.length > 0) {
        const filePath = message.files[0];
        const mapName = message.memoryMapNames?.[filePath];
        onSave(filePath, mapName);
      }
    });
    sendInspectorMessage(
      buildSelectFilesMessage({
        multi: false,
        filters: { 'Memory Map': ['mm.yml', 'yml'] },
        startPath: importPath ?? undefined,
      })
    );
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

export const BusTypeField: React.FC<BusTypeFieldProps> = ({ value, busLibrary, onSave }) => {
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

export const InterfaceTypeField: React.FC<InterfaceTypeFieldProps> = ({
  value,
  busLibrary,
  onSave,
}) => {
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
