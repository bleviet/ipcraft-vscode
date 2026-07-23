import React, { useMemo } from 'react';
import type {
  BusInterface,
  Clock,
  Interrupt,
  IpCore,
  Port,
  Reset,
} from '../../../../../types/ipCore';
import type { YamlUpdateHandler } from '../../../../../types/editor';
import { validateUniqueName, validateVhdlIdentifier } from '../../../../../shared/utils/validation';
import type { BatchUpdate } from '../../../../hooks/useGroupPorts';
import { portEndiannessApplies } from '../../../../utils/portEndianness';
import { applyBulkUpdate, type Mutation } from '../parameters/PlacementControls';
import { PropField, PropSelect, PropWidthField, Section } from '../controls/InspectorFields';
import {
  BUS_ENDIANNESS_OPTS,
  canonicalDirection,
  DIR_2WAY,
  DIR_3WAY,
  normalizePolarity,
  POLARITY_OPTS,
} from '../inspectorMetadata';

interface ClockPanelProps {
  clock: Clock;
  index: number;
  ipCore: IpCore;
  onUpdate: YamlUpdateHandler;
}

export const ClockPanel: React.FC<ClockPanelProps> = ({ clock, index, ipCore, onUpdate }) => {
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

export const ResetPanel: React.FC<ResetPanelProps> = ({ reset, index, ipCore, onUpdate }) => {
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
  batchUpdate?: BatchUpdate;
}

export const PortPanel: React.FC<PortPanelProps> = ({
  port,
  index,
  ipCore,
  onUpdate,
  batchUpdate,
}) => {
  const ports = (ipCore.ports ?? []) as Port[];
  const existingNames = ports.map((p) => p.name).filter((_, i) => i !== index);
  const paramNames = ((ipCore.parameters ?? []) as unknown as Array<{ name: string }>).map(
    (p) => p.name
  );

  const currentWidth: number | string =
    port.width === undefined || port.width === null ? 1 : (port.width as number | string);

  const saveDirection = (direction: string) => {
    const mutations: Mutation[] = [[['ports', index, 'direction'], direction]];
    if (
      port.endianness === 'big' &&
      !portEndiannessApplies(currentWidth, canonicalDirection(direction, 'in'))
    ) {
      mutations.push([['ports', index, 'endianness'], 'little']);
    }
    applyBulkUpdate(mutations, onUpdate, batchUpdate);
  };

  const saveWidth = (width: number | string) => {
    const mutations: Mutation[] = [[['ports', index, 'width'], width]];
    if (
      port.endianness === 'big' &&
      !portEndiannessApplies(width, canonicalDirection(port.direction, 'in'))
    ) {
      mutations.push([['ports', index, 'endianness'], 'little']);
    }
    applyBulkUpdate(mutations, onUpdate, batchUpdate);
  };

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
          onSave={saveDirection}
        />
        <PropWidthField
          label="Width (bits)"
          value={currentWidth}
          paramNames={paramNames}
          paramValues={paramValues}
          onSave={saveWidth}
        />
        <PropSelect
          label="Endianness"
          value={port.endianness === 'big' ? 'big' : 'little'}
          options={BUS_ENDIANNESS_OPTS}
          onSave={(v) => onUpdate(['ports', index, 'endianness'], v)}
          disabled={
            !portEndiannessApplies(currentWidth, canonicalDirection(port.direction, 'in')) &&
            port.endianness !== 'big'
          }
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

export const InterruptPanel: React.FC<InterruptPanelProps> = ({
  interrupt,
  index,
  ipCore,
  onUpdate,
}) => {
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
