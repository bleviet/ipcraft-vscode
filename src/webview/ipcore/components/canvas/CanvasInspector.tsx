import React, { useState, useEffect } from 'react';
import type { IpCore, Clock, Reset, Port, BusInterface } from '../../../types/ipCore';
import type { YamlUpdateHandler } from '../../../types/editor';
import type { CanvasElement, CanvasElementKind } from '../../hooks/useCanvasSelection';
import {
  validateVhdlIdentifier,
  validateUniqueName,
  validateRequired,
  validateVersion,
} from '../../../shared/utils/validation';
import { displayDirection } from '../../../shared/utils/formatters';
import { lookupBusDef } from '../../data/busDefinitions';

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
      <div className="ci-body">{renderPanel(selected, ipCore, onUpdate)}</div>

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
  onUpdate: YamlUpdateHandler
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
      return <BusPanel bus={bus} index={element.index} ipCore={ipCore} onUpdate={onUpdate} />;
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

  const widthStr = port.width === undefined || port.width === null ? '1' : String(port.width);

  const saveWidth = (v: string) => {
    const num = Number(v);
    onUpdate(['ports', index, 'width'], Number.isInteger(num) && num > 0 ? num : v || 1);
  };

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
        <PropField
          label="Width (bits)"
          value={widthStr}
          onSave={saveWidth}
          placeholder="1"
          hint="Number or parameter name"
          mono
        />
      </Section>
    </>
  );
};

interface BusPanelProps {
  bus: BusInterface;
  index: number;
  ipCore: IpCore;
  onUpdate: YamlUpdateHandler;
}

const BusPanel: React.FC<BusPanelProps> = ({ bus, index, ipCore, onUpdate }) => {
  const buses = (ipCore.busInterfaces ?? []) as BusInterface[];
  const clocks = (ipCore.clocks ?? []) as Clock[];
  const resets = (ipCore.resets ?? []) as Reset[];
  const memMaps = Array.isArray(ipCore.memoryMaps) ? ipCore.memoryMaps.map((m) => m.name) : [];
  const existingNames = buses.map((b) => b.name).filter((_, i) => i !== index);

  const clockOpts = clocks.map((c) => ({ value: c.name, label: c.name }));
  const resetOpts = resets.map((r) => ({ value: r.name, label: r.name }));
  const mapOpts = memMaps.map((m) => ({ value: m, label: m }));

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
        {mapOpts.length > 0 && (
          <PropSelect
            label="Memory Map"
            value={bus.memoryMapRef ?? ''}
            options={mapOpts}
            onSave={(v) => onUpdate(['busInterfaces', index, 'memoryMapRef'], v || null)}
            emptyOption="— None —"
          />
        )}
      </Section>
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

  const saveWidth = (portName: string, raw: string, defaultWidth: number) => {
    const trimmed = raw.trim();
    const basePath = ['busInterfaces', busIndex, 'portWidthOverrides'];
    const hasOverride = portName in overrides;

    // Empty or equal to default → remove override
    if (!trimmed || trimmed === String(defaultWidth)) {
      if (hasOverride) {
        const remaining = Object.keys(overrides).filter((k) => k !== portName);
        onUpdate(remaining.length === 0 ? basePath : [...basePath, portName], undefined);
      }
      return;
    }

    // Parameter name reference
    if (paramNames.includes(trimmed)) {
      onUpdate([...basePath, portName], trimmed);
      return;
    }

    // Positive integer
    const n = parseInt(trimmed, 10);
    if (!isNaN(n) && n > 0) {
      onUpdate([...basePath, portName], n);
      return;
    }

    // Invalid — revert (don't save)
  };

  const resetWidth = (portName: string) => {
    const basePath = ['busInterfaces', busIndex, 'portWidthOverrides'];
    const remaining = Object.keys(overrides).filter((k) => k !== portName);
    onUpdate(remaining.length === 0 ? basePath : [...basePath, portName], undefined);
  };

  return (
    <Section title="Port Widths">
      {enabledDefs.map((portDef) => {
        const defaultWidth = portDef.width ?? 1;
        const override = overrides[portDef.name];
        const hasOverride = override !== undefined;
        const currentValue = hasOverride ? String(override) : String(defaultWidth);

        return (
          <PortWidthRow
            key={portDef.name}
            signal={portDef.name}
            direction={portDef.direction}
            currentValue={currentValue}
            hasOverride={hasOverride}
            onSave={(raw) => saveWidth(portDef.name, raw, defaultWidth)}
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
  currentValue: string;
  hasOverride: boolean;
  onSave: (raw: string) => void;
  onReset: () => void;
}

const PortWidthRow: React.FC<PortWidthRowProps> = ({
  signal,
  direction,
  currentValue,
  hasOverride,
  onSave,
  onReset,
}) => {
  const [draft, setDraft] = useState(currentValue);
  const [focused, setFocused] = useState(false);

  useEffect(() => {
    if (!focused) {
      setDraft(currentValue);
    }
  }, [currentValue, focused]);

  const dirSymbol = direction === 'out' ? '›' : direction === 'in' ? '‹' : ' ';

  return (
    <div className={`ci-pw-row${hasOverride ? ' ci-pw-row--overridden' : ''}`}>
      <span className="ci-pw-dir" aria-hidden="true">
        {dirSymbol}
      </span>
      <span className="ci-pw-name" title={signal}>
        {signal}
      </span>
      <input
        className="ci-pw-input"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onFocus={() => setFocused(true)}
        onBlur={() => {
          setFocused(false);
          onSave(draft);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.currentTarget.blur();
          } else if (e.key === 'Escape') {
            setDraft(currentValue);
            setFocused(false);
            e.currentTarget.blur();
          }
        }}
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
//  Shared field primitives
// ─────────────────────────────────────────────────────

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
