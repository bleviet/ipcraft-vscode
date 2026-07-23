import React from 'react';
import type { BusInterface, Clock, IpCore, Reset } from '../../../../../types/ipCore';
import type { YamlUpdateHandler } from '../../../../../types/editor';
import { EmptyState, Section } from '../controls/InspectorFields';

interface BusInterfaceMatrixPanelProps {
  ipCore: IpCore;
  onUpdate: YamlUpdateHandler;
  onSelectElement?: (id: string) => void;
}

export const BusInterfaceMatrixPanel: React.FC<BusInterfaceMatrixPanelProps> = ({
  ipCore,
  onUpdate,
  onSelectElement,
}) => {
  const buses = (ipCore.busInterfaces ?? []) as BusInterface[];
  const clocks = (ipCore.clocks ?? []) as Clock[];
  const resets = (ipCore.resets ?? []) as Reset[];
  const clockOpts = clocks.map((c) => ({ value: c.name, label: c.name }));
  const resetOpts = resets.map((r) => ({ value: r.name, label: r.name }));

  if (buses.length === 0 && resets.length === 0) {
    return <EmptyState label="No bus interfaces or resets defined" />;
  }

  const handleClockChange = (index: number, v: string) => {
    onUpdate(['busInterfaces', index, 'associatedClock'], v || null);
  };

  const handleResetChange = (index: number, v: string) => {
    onUpdate(['busInterfaces', index, 'associatedReset'], v || null);
  };

  const handleResetClockChange = (index: number, v: string) => {
    onUpdate(['resets', index, 'associatedClock'], v || null);
  };

  const handleDelete = (index: number) => {
    onUpdate(
      ['busInterfaces'],
      buses.filter((_, i) => i !== index)
    );
  };

  return (
    <>
      {buses.length > 0 && (
        <Section title="Bus Interfaces">
          <div
            style={{
              fontSize: 11,
              color: 'var(--vscode-descriptionForeground)',
              marginBottom: 8,
            }}
          >
            Clock and reset routing for every bus interface. Click a name to open its full settings.
          </div>
          <div className="ci-busmatrix-header-row">
            <span className="ci-busmatrix-header-row__name">Name</span>
            <span className="ci-busmatrix-header-row__mode">Mode</span>
            <span className="ci-busmatrix-header-row__clock">Clock</span>
            <span className="ci-busmatrix-header-row__reset">Reset</span>
          </div>
          {buses.map((bus, index) => (
            <div className="ci-busmatrix-row" key={index}>
              <button
                className="ci-busmatrix-row__name"
                type="button"
                title={`Open ${bus.name || 'bus interface'}`}
                onClick={() => onSelectElement?.(`bus:${index}`)}
              >
                {bus.name || `(interface ${index})`}
              </button>
              <span className="ci-busmatrix-row__mode">{bus.mode}</span>
              <div className="ci-busmatrix-row__clock">
                <select
                  className="ci-field__select"
                  value={bus.associatedClock ?? ''}
                  onChange={(e) => handleClockChange(index, e.target.value)}
                >
                  <option value="">— None —</option>
                  {clockOpts.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="ci-busmatrix-row__reset">
                <select
                  className="ci-field__select"
                  value={bus.associatedReset ?? ''}
                  onChange={(e) => handleResetChange(index, e.target.value)}
                >
                  <option value="">— None —</option>
                  {resetOpts.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </div>
              <button
                className="ci-busmatrix-row__delete"
                type="button"
                title={`Delete ${bus.name || 'this bus interface'}`}
                onClick={() => handleDelete(index)}
              >
                <span className="codicon codicon-trash" />
              </button>
            </div>
          ))}
        </Section>
      )}

      {resets.length > 0 && (
        <Section title="Resets">
          <div
            style={{
              fontSize: 11,
              color: 'var(--vscode-descriptionForeground)',
              marginBottom: 8,
            }}
          >
            Each reset's own clock domain — independent of any bus interface's routing above.
          </div>
          <div className="ci-busmatrix-header-row">
            <span className="ci-busmatrix-header-row__name">Name</span>
            <span className="ci-busmatrix-header-row__clock">Clock</span>
          </div>
          {resets.map((reset, index) => (
            <div className="ci-busmatrix-row" key={index}>
              <button
                className="ci-busmatrix-row__name"
                type="button"
                title={`Open ${reset.name || 'reset'}`}
                onClick={() => onSelectElement?.(`reset:${index}`)}
              >
                {reset.name || `(reset ${index})`}
              </button>
              <div className="ci-busmatrix-row__clock">
                <select
                  className="ci-field__select"
                  value={reset.associatedClock ?? ''}
                  onChange={(e) => handleResetClockChange(index, e.target.value)}
                >
                  <option value="">— None —</option>
                  {clockOpts.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          ))}
        </Section>
      )}
    </>
  );
};
