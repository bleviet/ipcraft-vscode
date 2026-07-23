import React, { useCallback, useMemo, useState } from 'react';
import type { BusInterface, Clock, ConduitPort, Reset } from '../../../../../types/ipCore';
import type { YamlUpdateHandler } from '../../../../../types/editor';
import { validateUniqueName, validateVhdlIdentifier } from '../../../../../shared/utils/validation';
import { lookupBusDefFromLibrary } from '../../../../data/busDefinitions';
import { MapConduitToBusDialog, type MapConduitToBusResult } from '../../MapConduitToBusDialog';
import { applyMapConduitToKnownBus } from '../../../../hooks/useGroupPorts';
import { InterfaceTypeField } from '../controls/BusTypeFields';
import { PropField, PropSelect, Section } from '../controls/InspectorFields';
import { CONDUIT_MODE_OPTS } from '../inspectorMetadata';
import {
  buildSaveCustomBusDefinitionMessage,
  listenForInspectorHostMessage,
  sendInspectorMessage,
} from '../inspectorMessages';
import { ConduitSignalRow, PortWidthOverridesSection } from './ConduitFields';
import type { BusPanelProps } from './BusPanel';
import { conduitTypeName } from './busInterfaceMetadata';

export const ConduitPanel: React.FC<BusPanelProps> = ({
  bus,
  index,
  ipCore,
  imports,
  onUpdate,
}) => {
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
    const params = (ipCore.parameters ?? []) as unknown as Array<{
      name: string;
      value?: unknown;
      defaultValue?: unknown;
    }>;

    setSaveState('saving');
    listenForInspectorHostMessage('customBusDefinitionSaved', (message) => {
      setSaveState('saved');
      const ipCoreData = ipCore as unknown as Record<string, unknown>;
      if (message.customBusLibraryDir && !ipCoreData.useBusLibrary) {
        onUpdate(['useBusLibrary'], `./${message.customBusLibraryDir}`);
      }
      if (message.portWidthOverrides && Object.keys(message.portWidthOverrides).length > 0) {
        onUpdate(['busInterfaces', index, 'portWidthOverrides'], message.portWidthOverrides);
      }
      onUpdate(['busInterfaces', index, 'conduitPorts'], null);
      setTimeout(() => setSaveState('idle'), 2500);
    });
    sendInspectorMessage(buildSaveCustomBusDefinitionMessage(tName, conduitPorts, params));
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
