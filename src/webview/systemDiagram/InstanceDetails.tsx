import React from 'react';
import type { SystemGraph, SystemInstance } from '../../domain/systemGraph';
import type { ClockAnalysis } from './clocks/analyzeClocks';
import { InstanceClockDetails } from './InstanceClockDetails';
import { LineLink } from './LineLink';
import { levelSource } from './sourceFile';
import { endpointKey, netsByEndpoint, shortVlnv, type Selection } from './model';
import { isPinListKnown, unconnectedClass } from './unconnectedPins';

interface InstanceDetailsProps {
  graph: SystemGraph;
  clocks: ClockAnalysis;
  instance: SystemInstance;
  /** Name of the pin to highlight, set from the Unconnected list. */
  focusedPin?: string;
  onSelect: (selection: Selection) => void;
  onEnterHierarchy: (instancePath: string) => void;
  onReveal: (line: number, uri?: string) => void;
  onOpenDefinition: (instance: string) => void;
}

export function InstanceDetails({
  graph,
  clocks,
  instance,
  focusedPin,
  onSelect,
  onEnterHierarchy,
  onReveal,
  onOpenDefinition,
}: InstanceDetailsProps) {
  const source = levelSource(graph, instance.parent);
  const nets = netsByEndpoint(graph, instance.parent);
  const parameters = Object.entries(instance.parameters);
  const hasUndriven = instance.pins.some(
    (pin) =>
      !nets.has(endpointKey({ instance: instance.path, pin: pin.name })) &&
      unconnectedClass(pin, false) === 'undriven'
  );
  const identity =
    instance.kind === 'module'
      ? `Module reference ${instance.moduleRef ?? ''}`
      : instance.vlnv
        ? `${instance.vlnv} (${shortVlnv(instance.vlnv)})`
        : instance.component
          ? `Platform Designer component ${instance.component} ${instance.version ?? ''}`.trim()
          : 'Hierarchy';
  return (
    <div className="space-y-3">
      <header>
        <div className="sd-eyebrow">Instance</div>
        <h2 className="sd-h2">{instance.name}</h2>
        <p className="opacity-70">
          {instance.kind} · {identity}
        </p>
      </header>
      <p>
        Created at <LineLink source={source} line={instance.line} onReveal={onReveal} />
        {instance.procLine !== undefined && (
          <>
            {' '}
            · proc at <LineLink source={source} line={instance.procLine} onReveal={onReveal} />
          </>
        )}
      </p>
      {instance.definition && (
        <p>
          Defined by{' '}
          <button
            type="button"
            className="sd-link"
            title={`Open ${instance.definition.displayName}`}
            onClick={() => onOpenDefinition(instance.path)}
          >
            {instance.definition.displayName}
          </button>
        </p>
      )}
      {instance.kind === 'hier' && (
        <button type="button" className="sd-button" onClick={() => onEnterHierarchy(instance.path)}>
          Open hierarchy
        </button>
      )}
      <section>
        <h3 className="sd-h3">Parameters</h3>
        <p className="text-xs opacity-70">
          Only values set in the design file are shown. Defaults and propagated values are not
          available offline.
        </p>
        {parameters.length === 0 ? (
          <p className="opacity-70">None set.</p>
        ) : (
          <dl className="sd-kv">
            {parameters.map(([key, value]) => (
              <React.Fragment key={key}>
                <dt>{key}</dt>
                <dd className="break-all">{value}</dd>
              </React.Fragment>
            ))}
          </dl>
        )}
      </section>
      <section>
        <h3 className="sd-h3">Pins</h3>
        <table className="sd-table">
          <thead>
            <tr>
              <th>Pin</th>
              <th>Net</th>
              <th>Direction</th>
            </tr>
          </thead>
          <tbody>
            {instance.pins.map((pin) => {
              const pinNets =
                nets.get(endpointKey({ instance: instance.path, pin: pin.name })) ?? [];
              const cls = pinNets.length === 0 ? unconnectedClass(pin, false) : undefined;
              return (
                <tr
                  key={pin.name}
                  className={focusedPin === pin.name ? 'sd-row-selected' : undefined}
                >
                  <td>{pin.name}</td>
                  <td>
                    {pinNets.length > 0 ? (
                      pinNets.map((net) => (
                        <div key={net.id}>
                          <button
                            type="button"
                            className="sd-link"
                            onClick={() => onSelect({ kind: 'net', id: net.id })}
                          >
                            {net.name}
                          </button>
                        </div>
                      ))
                    ) : (
                      <span
                        className="sd-unc-tag"
                        data-class={cls}
                        title={
                          cls === 'undriven'
                            ? 'Unconnected: no net drives this pin'
                            : 'Unconnected: nothing uses this pin'
                        }
                      >
                        {cls}
                      </span>
                    )}
                  </td>
                  <td>
                    {pin.direction} <span className="opacity-60">({pin.directionSource})</span>
                    {pin.definedBy ? ` · ${pin.definedBy}` : ''}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {hasUndriven && (
          <p className="mt-2 text-xs opacity-70">
            The vendor tool ties an input without a driver to a constant, usually its default value.
            An active-low reset tied to 0 holds the block in reset.
          </p>
        )}
        {!isPinListKnown(instance) && (
          <p className="mt-2 text-xs opacity-70">
            Pins come from the connections in the design file, so unconnected pins cannot be
            checked.
          </p>
        )}
      </section>
      <InstanceClockDetails graph={graph} clocks={clocks} instance={instance} onSelect={onSelect} />
    </div>
  );
}
