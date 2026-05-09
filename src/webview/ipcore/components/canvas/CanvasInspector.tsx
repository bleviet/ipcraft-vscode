import React, { useState, useEffect, useRef } from 'react';
import type { IpCore, Clock, Reset, Port, BusInterface, ConduitPort } from '../../../types/ipCore';
import type { YamlUpdateHandler } from '../../../types/editor';
import type { CanvasElement, CanvasElementKind } from '../../hooks/useCanvasSelection';
import {
  validateVhdlIdentifier,
  validateUniqueName,
  validateRequired,
  validateVersion,
} from '../../../shared/utils/validation';
import { displayDirection } from '../../../shared/utils/formatters';
import { lookupBusDef, isConduitType } from '../../data/busDefinitions';
import { supportsMemoryMap } from './canvasLayout';
import { vscode } from '../../../vscode';

interface CanvasInspectorProps {
  selected: CanvasElement | null;
  ipCore: IpCore;
  imports?: { busLibrary?: unknown; memoryMaps?: unknown[] };
  onUpdate: YamlUpdateHandler;
  onClose: () => void;
  onDelete?: () => void;
}

export const CanvasInspector: React.FC<CanvasInspectorProps> = ({
  selected,
  ipCore,
  imports,
  onUpdate,
  onClose,
  onDelete,
}) => {
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
    <div className="canvas-inspector">
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
      <div className="ci-body">{renderPanel(selected, ipCore, onUpdate, imports)}</div>

      {/* ── Footer ── */}
      {onDelete && selected.kind !== 'body' && (
        <div className="ci-footer">
          <button
            className="ci-delete-btn"
            onClick={onDelete}
            title={`Delete this ${kindLabel(selected.kind).toLowerCase()}`}
          >
            <span className="codicon codicon-trash" />
            Delete
          </button>
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
  imports?: { busLibrary?: unknown; memoryMaps?: unknown[] }
): React.ReactNode {
  switch (element.kind) {
    case 'body':
      return <BodyPanel ipCore={ipCore} onUpdate={onUpdate} />;

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
        <ParameterPanel param={param} index={element.index} ipCore={ipCore} onUpdate={onUpdate} />
      );
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
  </>
);

// ─────────────────────────────────────────────────────
//  Parameter / generic panel
// ─────────────────────────────────────────────────────

interface ParameterPanelProps {
  param: Record<string, unknown>;
  index: number;
  ipCore: IpCore;
  onUpdate: YamlUpdateHandler;
}

const ParameterPanel: React.FC<ParameterPanelProps> = ({ param, index, ipCore, onUpdate }) => {
  const params = (ipCore.parameters ?? []) as unknown as Array<Record<string, unknown>>;
  const existingNames = params.map((p) => String(p.name ?? '')).filter((_, i) => i !== index);

  const defVal =
    param.defaultValue !== undefined
      ? String(param.defaultValue)
      : param.value !== undefined && typeof param.value !== 'object'
        ? String(param.value)
        : '';
  const dataType = String(param.dataType ?? 'integer');

  const saveDefault = (v: string) => {
    if (dataType === 'integer' || dataType === 'natural' || dataType === 'positive') {
      const n = Number(v);
      onUpdate(['parameters', index, 'defaultValue'], Number.isFinite(n) ? n : v);
    } else if (dataType === 'boolean') {
      onUpdate(['parameters', index, 'defaultValue'], v === 'true' || v === '1');
    } else {
      onUpdate(['parameters', index, 'defaultValue'], v);
    }
  };

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
      </Section>
      <Section title="Value">
        <PropSelect
          label="Data Type"
          value={dataType}
          options={PARAM_TYPE_OPTS}
          onSave={(v) => onUpdate(['parameters', index, 'dataType'], v)}
        />
        <PropField
          label="Default Value"
          value={defVal}
          onSave={saveDefault}
          placeholder="32"
          mono
        />
      </Section>
      {!!param.description && (
        <Section title="Description">
          <div
            style={{ fontSize: 11, color: 'var(--vscode-descriptionForeground)', lineHeight: 1.5 }}
          >
            {String(param.description)}
          </div>
        </Section>
      )}
    </>
  );
};

const PARAM_TYPE_OPTS = [
  { value: 'integer', label: 'integer' },
  { value: 'natural', label: 'natural' },
  { value: 'positive', label: 'positive' },
  { value: 'real', label: 'real' },
  { value: 'boolean', label: 'boolean' },
  { value: 'string', label: 'string' },
];

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
          value={displayDirection(clock.direction, 'input')}
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
          value={displayDirection(reset.direction, 'input')}
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
          value={displayDirection(port.direction, 'input')}
          options={DIR_3WAY}
          onSave={(v) => onUpdate(['ports', index, 'direction'], v)}
        />
        <PropWidthField
          label="Width (bits)"
          value={currentWidth}
          paramNames={paramNames}
          onSave={(v) => onUpdate(['ports', index, 'width'], v)}
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

const BusPanel: React.FC<BusPanelProps> = ({ bus, index, ipCore, imports, onUpdate }) => {
  if (isConduitType(bus.type)) {
    return <ConduitPanel bus={bus} index={index} ipCore={ipCore} onUpdate={onUpdate} />;
  }

  const buses = (ipCore.busInterfaces ?? []) as BusInterface[];
  const clocks = (ipCore.clocks ?? []) as Clock[];
  const resets = (ipCore.resets ?? []) as Reset[];
  const existingNames = buses.map((b) => b.name).filter((_, i) => i !== index);

  const clockOpts = clocks.map((c) => ({ value: c.name, label: c.name }));
  const resetOpts = resets.map((r) => ({ value: r.name, label: r.name }));

  // Memory map options: inline maps + imported maps (deduplicated)
  const inlineMapNames = Array.isArray(ipCore.memoryMaps)
    ? (ipCore.memoryMaps as unknown as Array<{ name?: unknown }>).map((m) => String(m.name ?? ''))
    : [];
  const importedMapNames = Array.isArray(imports?.memoryMaps)
    ? (imports.memoryMaps as Array<Record<string, unknown>>).map((m) => String(m.name ?? ''))
    : [];
  const allMapNames = [...new Set([...inlineMapNames, ...importedMapNames])].filter(Boolean);
  const mapOpts = allMapNames.map((m) => ({ value: m, label: m }));

  // Only single, slave memory-mapped interfaces (AXI4-Lite/Full, Avalon-MM) may have a memory map
  const isArray = ((bus.array as { count?: number } | undefined | null)?.count ?? 0) > 1;
  const canHaveMemoryMap = !isArray && supportsMemoryMap(bus.type, bus.mode);

  const importPath =
    ((ipCore.memoryMaps as unknown as Record<string, unknown> | undefined)?.import as string) ??
    null;

  // Sole map name when the file contains exactly one map (null otherwise)
  const singleMapName = allMapNames.length === 1 ? allMapNames[0] : null;

  // Auto-assign memoryMapRef when the linked file contains exactly one map.
  // Fires on mount (handles already-linked files) and whenever importPath or
  // resolved maps change. Tracks the last path we auto-assigned for so we
  // never clobber a reference the user deliberately cleared.
  const lastAutoAssignedForRef = useRef<string | null>(null);
  useEffect(() => {
    if (
      canHaveMemoryMap &&
      importPath &&
      importPath !== lastAutoAssignedForRef.current &&
      singleMapName !== null &&
      !bus.memoryMapRef
    ) {
      lastAutoAssignedForRef.current = importPath;
      onUpdate(['busInterfaces', index, 'memoryMapRef'], singleMapName);
    }
  }, [canHaveMemoryMap, importPath, singleMapName, bus.memoryMapRef, index, onUpdate]);

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
        <PropField
          label="Bus Type"
          value={bus.type}
          onSave={(v) => onUpdate(['busInterfaces', index, 'type'], v)}
          placeholder="ipcraft.busif.axi4_lite.1.0"
          hint="Vendor.library.name.version"
          mono
        />
      </Section>
      <Section title="Configuration">
        <PropSelect
          label="Mode"
          value={bus.mode}
          options={BUS_MODE_OPTS}
          onSave={(v) => onUpdate(['busInterfaces', index, 'mode'], v)}
        />
        <PropField
          label="Physical Prefix"
          value={bus.physicalPrefix ?? ''}
          onSave={(v) => onUpdate(['busInterfaces', index, 'physicalPrefix'], v || null)}
          placeholder="s_axi_"
          mono
        />
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
          <MemoryMapField
            importPath={
              ((ipCore.memoryMaps as unknown as Record<string, unknown>)?.import as string) ?? null
            }
            onSave={(path) => onUpdate(['memoryMaps'], path ? { import: path } : undefined)}
          />
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
        onUpdate={onUpdate}
      />
    </>
  );
};

// ─────────────────────────────────────────────────────
//  Conduit (Custom Interface) panel
// ─────────────────────────────────────────────────────

const ConduitPanel: React.FC<Omit<BusPanelProps, 'imports'>> = ({
  bus,
  index,
  ipCore,
  onUpdate,
}) => {
  const buses = (ipCore.busInterfaces ?? []) as BusInterface[];
  const clocks = (ipCore.clocks ?? []) as Clock[];
  const resets = (ipCore.resets ?? []) as Reset[];
  const existingNames = buses.map((b) => b.name).filter((_, i) => i !== index);
  const paramNames = ((ipCore.parameters ?? []) as unknown as Array<{ name: string }>).map(
    (p) => p.name
  );

  const clockOpts = clocks.map((c) => ({ value: c.name, label: c.name }));
  const resetOpts = resets.map((r) => ({ value: r.name, label: r.name }));

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
      </Section>
      <Section title="Configuration">
        <PropField
          label="Physical Prefix"
          value={bus.physicalPrefix ?? ''}
          onSave={(v) => onUpdate(['busInterfaces', index, 'physicalPrefix'], v || null)}
          placeholder="custom_if_"
          mono
        />
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
      </Section>
      <ConduitSignalsSection
        bus={bus}
        busIndex={index}
        paramNames={paramNames}
        onUpdate={onUpdate}
      />
    </>
  );
};

interface ConduitSignalsSectionProps {
  bus: BusInterface;
  busIndex: number;
  paramNames: string[];
  onUpdate: YamlUpdateHandler;
}

const ConduitSignalsSection: React.FC<ConduitSignalsSectionProps> = ({
  bus,
  busIndex,
  paramNames,
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

interface ConduitSignalRowProps {
  port: ConduitPort;
  paramNames: string[];
  onChange: (updates: Partial<ConduitPort>) => void;
  onRemove: () => void;
}

const ConduitSignalRow: React.FC<ConduitSignalRowProps> = ({
  port,
  paramNames,
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

  const currentWidth: number | string = port.width === undefined ? 1 : port.width;
  const isCurrentlyParam = typeof currentWidth === 'string' && paramNames.includes(currentWidth);
  const [widthMode, setWidthMode] = useState<'number' | 'param'>(
    isCurrentlyParam ? 'param' : 'number'
  );
  const [widthDraft, setWidthDraft] = useState(
    typeof currentWidth === 'number' ? String(currentWidth) : '1'
  );
  const [widthFocused, setWidthFocused] = useState(false);

  useEffect(() => {
    const nextMode =
      typeof currentWidth === 'string' && paramNames.includes(currentWidth) ? 'param' : 'number';
    setWidthMode(nextMode);
    if (nextMode === 'number' && !widthFocused) {
      setWidthDraft(typeof currentWidth === 'number' ? String(currentWidth) : '1');
    }
  }, [currentWidth, widthFocused, paramNames]);

  const commitWidth = (raw: string) => {
    const n = parseInt(raw, 10);
    onChange({ width: !isNaN(n) && n > 0 ? n : 1 });
  };

  const toggleWidthMode = () => {
    if (widthMode === 'param') {
      setWidthMode('number');
      const fallback = typeof currentWidth === 'number' ? currentWidth : 1;
      setWidthDraft(String(fallback));
      onChange({ width: fallback });
    } else {
      setWidthMode('param');
      onChange({ width: paramNames[0] });
    }
  };

  const hasParams = paramNames.length > 0;

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
      <div className="ci-pw-field">
        {widthMode === 'param' ? (
          <select
            className="ci-pw-select"
            value={typeof currentWidth === 'string' ? currentWidth : (paramNames[0] ?? '')}
            onChange={(e) => onChange({ width: e.target.value })}
          >
            {paramNames.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
        ) : (
          <input
            className="ci-pw-input"
            value={
              widthFocused
                ? widthDraft
                : typeof currentWidth === 'number'
                  ? String(currentWidth)
                  : '1'
            }
            onChange={(e) => setWidthDraft(e.target.value)}
            onFocus={() => {
              setWidthFocused(true);
              setWidthDraft(typeof currentWidth === 'number' ? String(currentWidth) : '1');
            }}
            onBlur={() => {
              setWidthFocused(false);
              commitWidth(widthDraft);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.currentTarget.blur();
              } else if (e.key === 'Escape') {
                setWidthDraft(typeof currentWidth === 'number' ? String(currentWidth) : '1');
                setWidthFocused(false);
                e.currentTarget.blur();
              }
            }}
          />
        )}
        {hasParams && (
          <button
            className="ci-pw-mode-toggle"
            onClick={toggleWidthMode}
            title={widthMode === 'param' ? 'Use a literal number' : 'Use a generic parameter'}
          >
            {widthMode === 'param' ? (
              '123'
            ) : (
              <span className="codicon codicon-symbol-constant" aria-label="Use generic" />
            )}
          </button>
        )}
      </div>
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
  onUpdate: YamlUpdateHandler;
}

const PortWidthOverridesSection: React.FC<PortWidthOverridesSectionProps> = ({
  bus,
  busIndex,
  paramNames,
  onUpdate,
}) => {
  const portDefs = lookupBusDef(bus.type);
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

  // Signals whose standard width is 1 (or unspecified, implying 1) are fixed by the
  // bus specification and cannot be meaningfully overridden.
  const configurableDefs = enabledDefs.filter((p) => (p.width ?? 1) > 1);

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
            hasOverride={hasOverride}
            paramNames={paramNames}
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
  hasOverride: boolean;
  paramNames: string[];
  onSave: (value: number | string) => void;
  onReset: () => void;
}

const PortWidthRow: React.FC<PortWidthRowProps> = ({
  signal,
  direction,
  currentValue,
  defaultWidth,
  hasOverride,
  paramNames,
  onSave,
  onReset,
}) => {
  const isCurrentlyParam = typeof currentValue === 'string' && paramNames.includes(currentValue);
  const [mode, setMode] = useState<'number' | 'param'>(isCurrentlyParam ? 'param' : 'number');
  const [draft, setDraft] = useState(
    typeof currentValue === 'number' ? String(currentValue) : String(defaultWidth)
  );
  const [focused, setFocused] = useState(false);

  useEffect(() => {
    const nextMode =
      typeof currentValue === 'string' && paramNames.includes(currentValue) ? 'param' : 'number';
    setMode(nextMode);
    if (nextMode === 'number' && !focused) {
      setDraft(typeof currentValue === 'number' ? String(currentValue) : String(defaultWidth));
    }
  }, [currentValue, focused, paramNames, defaultWidth]);

  const dirSymbol = direction === 'out' ? '›' : direction === 'in' ? '‹' : ' ';
  const hasParams = paramNames.length > 0;

  const commitNumber = (raw: string) => {
    const n = parseInt(raw, 10);
    onSave(!isNaN(n) && n > 0 ? n : defaultWidth);
  };

  const toggleMode = () => {
    if (mode === 'param') {
      setMode('number');
      setDraft(String(defaultWidth));
      onSave(defaultWidth);
    } else {
      setMode('param');
      onSave(paramNames[0]);
    }
  };

  return (
    <div className={`ci-pw-row${hasOverride ? ' ci-pw-row--overridden' : ''}`}>
      <span className="ci-pw-dir" aria-hidden="true">
        {dirSymbol}
      </span>
      <span className="ci-pw-name" title={signal}>
        {signal}
      </span>
      <div className="ci-pw-field">
        {mode === 'param' ? (
          <select
            className="ci-pw-select"
            value={typeof currentValue === 'string' ? currentValue : (paramNames[0] ?? '')}
            onChange={(e) => onSave(e.target.value)}
          >
            {paramNames.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
        ) : (
          <input
            className="ci-pw-input"
            value={
              focused
                ? draft
                : typeof currentValue === 'number'
                  ? String(currentValue)
                  : String(defaultWidth)
            }
            onChange={(e) => setDraft(e.target.value)}
            onFocus={() => {
              setFocused(true);
              setDraft(
                typeof currentValue === 'number' ? String(currentValue) : String(defaultWidth)
              );
            }}
            onBlur={() => {
              setFocused(false);
              commitNumber(draft);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.currentTarget.blur();
              } else if (e.key === 'Escape') {
                setDraft(
                  typeof currentValue === 'number' ? String(currentValue) : String(defaultWidth)
                );
                setFocused(false);
                e.currentTarget.blur();
              }
            }}
          />
        )}
        {hasParams && (
          <button
            className="ci-pw-mode-toggle"
            onClick={toggleMode}
            title={mode === 'param' ? 'Use a literal number' : 'Use a generic parameter'}
          >
            {mode === 'param' ? (
              '123'
            ) : (
              <span className="codicon codicon-symbol-constant" aria-label="Use generic" />
            )}
          </button>
        )}
      </div>
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
  /** Current value of ipCore.memoryMaps.import (relative file path) */
  importPath: string | null;
  /** Save new import path, or null to clear the whole memoryMaps entry */
  onSave: (path: string | null) => void;
}

/** File-path row for the memory map import (ipCore.memoryMaps.import). */
const MemoryMapField: React.FC<MemoryMapFieldProps> = ({ importPath, onSave }) => {
  const handleBrowse = () => {
    vscode?.postMessage({
      type: 'selectFiles',
      multi: false,
      filters: { 'Memory Map': ['mm.yml', 'yml'] },
      startPath: importPath ?? undefined,
    });
    const handler = (event: MessageEvent) => {
      const msg = event.data as { type?: string; files?: string[] };
      if (msg.type === 'filesSelected' && msg.files && msg.files.length > 0) {
        onSave(msg.files[0]);
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
//  PropWidthField — labeled width field with number/parameter toggle
// ─────────────────────────────────────────────────────

interface PropWidthFieldProps {
  label: string;
  value: number | string;
  paramNames: string[];
  onSave: (value: number | string) => void;
}

const PropWidthField: React.FC<PropWidthFieldProps> = ({ label, value, paramNames, onSave }) => {
  const isCurrentlyParam = typeof value === 'string' && paramNames.includes(value);
  const [mode, setMode] = useState<'number' | 'param'>(isCurrentlyParam ? 'param' : 'number');
  const [draft, setDraft] = useState(typeof value === 'number' ? String(value) : '1');
  const [focused, setFocused] = useState(false);

  useEffect(() => {
    const nextMode = typeof value === 'string' && paramNames.includes(value) ? 'param' : 'number';
    setMode(nextMode);
    if (nextMode === 'number' && !focused) {
      setDraft(typeof value === 'number' ? String(value) : '1');
    }
  }, [value, focused, paramNames]);

  const hasParams = paramNames.length > 0;

  const commitNumber = (raw: string) => {
    const n = parseInt(raw, 10);
    onSave(!isNaN(n) && n > 0 ? n : 1);
  };

  const toggleMode = () => {
    if (mode === 'param') {
      setMode('number');
      const fallback = typeof value === 'number' ? value : 1;
      setDraft(String(fallback));
      onSave(fallback);
    } else {
      setMode('param');
      onSave(paramNames[0]);
    }
  };

  return (
    <div className="ci-field">
      <label className="ci-field__label">{label}</label>
      <div className="ci-field__input-row">
        {mode === 'param' ? (
          <select
            className="ci-field__select"
            value={typeof value === 'string' ? value : (paramNames[0] ?? '')}
            onChange={(e) => onSave(e.target.value)}
          >
            {paramNames.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
        ) : (
          <input
            className="ci-field__input"
            value={focused ? draft : typeof value === 'number' ? String(value) : '1'}
            placeholder="1"
            onChange={(e) => setDraft(e.target.value)}
            onFocus={() => {
              setFocused(true);
              setDraft(typeof value === 'number' ? String(value) : '1');
            }}
            onBlur={() => {
              setFocused(false);
              commitNumber(draft);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.currentTarget.blur();
              } else if (e.key === 'Escape') {
                setDraft(typeof value === 'number' ? String(value) : '1');
                setFocused(false);
                e.currentTarget.blur();
              }
            }}
            style={{ fontFamily: 'var(--vscode-editor-font-family, monospace)' }}
          />
        )}
        {hasParams && (
          <button
            className="ci-pw-mode-toggle ci-field__mode-toggle"
            onClick={toggleMode}
            title={mode === 'param' ? 'Use a literal number' : 'Use a generic parameter'}
          >
            {mode === 'param' ? (
              '123'
            ) : (
              <span className="codicon codicon-symbol-constant" aria-label="Use generic" />
            )}
          </button>
        )}
      </div>
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
}

const PropField: React.FC<PropFieldProps> = ({
  label,
  value,
  onSave,
  validate,
  placeholder,
  hint,
  mono = false,
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

  return (
    <div className="ci-field">
      <label className="ci-field__label">{label}</label>
      <input
        className={`ci-field__input${liveError ? ' ci-field__input--error' : ''}`}
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
      {liveError ? (
        <div className="ci-field__error">{liveError}</div>
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

const Section: React.FC<{ title: string; children: React.ReactNode }> = ({ title, children }) => (
  <div className="ci-section">
    <div className="ci-section__title">{title}</div>
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
    default:
      return kind;
  }
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
  { value: 'input', label: 'input' },
  { value: 'output', label: 'output' },
];

const DIR_3WAY = [
  { value: 'input', label: 'input' },
  { value: 'output', label: 'output' },
  { value: 'inout', label: 'inout' },
];

const POLARITY_OPTS = [
  { value: 'activeLow', label: 'activeLow (active-low / RESET_N)' },
  { value: 'activeHigh', label: 'activeHigh (active-high / RESET)' },
];

const BUS_MODE_OPTS = [
  { value: 'slave', label: 'slave' },
  { value: 'master', label: 'master' },
  { value: 'sink', label: 'sink' },
  { value: 'source', label: 'source' },
];
