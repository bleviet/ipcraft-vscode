import React, { useEffect, useState } from 'react';
import type { BusInterface, ConduitPort } from '../../../../../types/ipCore';
import type { YamlUpdateHandler } from '../../../../../types/editor';
import { lookupBusDef, type BusPortDef } from '../../../../data/busDefinitions';
import { PropField, Section } from '../controls/InspectorFields';
import { WidthExprControl } from '../controls/WidthExprControl';

interface ConduitSignalRowProps {
  port: ConduitPort;
  paramNames: string[];
  paramValues?: Record<string, number>;
  onChange: (updates: Partial<ConduitPort>) => void;
  onRemove: () => void;
}

const PRESENCE_LABELS: Record<string, string> = { required: 'REQ', optional: 'OPT' };

export const ConduitSignalRow: React.FC<ConduitSignalRowProps> = ({
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

export const ArraySection: React.FC<ArraySectionProps> = ({ bus, busIndex, onUpdate }) => {
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

export const PortWidthOverridesSection: React.FC<PortWidthOverridesSectionProps> = ({
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
