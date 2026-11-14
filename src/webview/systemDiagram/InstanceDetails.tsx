import React from 'react';
import type { SystemGraph, SystemInstance } from '../../domain/systemGraph';
import type { ClockAnalysis } from './clocks/analyzeClocks';
import { shownInside } from './changeMarks';
import { InstanceChanges } from './InstanceChanges';
import { InstanceClockDetails } from './InstanceClockDetails';
import type { ComparisonDetails } from './hooks/useCompareView';
import { LineLink } from './LineLink';
import { levelSource } from './sourceFile';
import { openNetsByEndpoint } from './layout/unionGraph';
import { endpointKey, netsByEndpoint, shortVlnv, type Selection } from './model';
import { isPinListKnown, unconnectedClass } from './unconnectedPins';

interface InstanceDetailsProps {
  graph: SystemGraph;
  clocks: ClockAnalysis;
  instance: SystemInstance;
  /** Name of the pin to highlight, set from the Unconnected list. */
  focusedPin?: string;
  /** The comparison, when one is on: marked blocks show a Changes section. */
  comparison?: ComparisonDetails;
  onSelect: (selection: Selection) => void;
  onEnterHierarchy: (instancePath: string) => void;
  onReveal: (line: number, uri?: string) => void;
  onOpenDefinition: (instance: string) => void;
}

const NO_NETS: ReadonlySet<string> = new Set();

export function InstanceDetails({
  graph,
  clocks,
  instance,
  focusedPin,
  comparison,
  onSelect,
  onEnterHierarchy,
  onReveal,
  onOpenDefinition,
}: InstanceDetailsProps) {
  const source = levelSource(graph, instance.parent);
  // Connected or not is a fact of the open design: a wire only the base has does not connect a pin.
  const ghostNets = comparison?.marks.removedNets ?? NO_NETS;
  const nets = openNetsByEndpoint(graph, instance.parent, ghostNets);
  const allNets = netsByEndpoint(graph, instance.parent);
  const parameters = Object.entries(instance.parameters);
  const pinListKnown = isPinListKnown(instance);
  // Only the pins of the open design: a pin only the base has (a ghost) is not undriven there.
  const removedPins = comparison?.marks.blocks.get(instance.path)?.pins;
  const hasUndriven =
    pinListKnown &&
    instance.pins.some(
      (pin) =>
        removedPins?.[pin.name] !== 'removed' &&
        !nets.has(endpointKey({ instance: instance.path, pin: pin.name })) &&
        unconnectedClass(pin, false) === 'undriven'
    );
  const identity =
    instance.kind === 'blackbox'
      ? 'Not defined in this file'
      : instance.kind === 'module'
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
          {instance.kind === 'blackbox' ? 'Black box' : instance.kind} · {identity}
        </p>
      </header>
      {comparison && (
        <InstanceChanges
          graph={graph}
          owners={comparison.marks.owners}
          rows={comparison.rows}
          target={{ kind: 'instance', path: instance.path }}
          inside={shownInside(comparison.marks.blocks.get(instance.path))}
        />
      )}
      <p>
        {instance.kind === 'blackbox' ? 'First referenced at' : 'Created at'}{' '}
        <LineLink source={source} line={instance.line} onReveal={onReveal} />
        {instance.procLine !== undefined && (
          <>
            {' '}
            · proc at <LineLink source={source} line={instance.procLine} onReveal={onReveal} />
          </>
        )}
      </p>
      {instance.kind === 'blackbox' && (
        <p className="opacity-70">
          This block is referenced by the design but not defined in the file read, so it is shown as
          a black box. Its pins are the ones seen in connections.
        </p>
      )}
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
              const key = endpointKey({ instance: instance.path, pin: pin.name });
              const pinNets = nets.get(key) ?? [];
              const lostNets = (allNets.get(key) ?? []).filter((net) => ghostNets.has(net.id));
              const onlyInBase =
                comparison?.marks.blocks.get(instance.path)?.pins[pin.name] === 'removed';
              const cls =
                pinNets.length === 0 && !onlyInBase ? unconnectedClass(pin, false) : undefined;
              return (
                <tr
                  key={pin.name}
                  className={focusedPin === pin.name ? 'sd-row-selected' : undefined}
                >
                  <td>
                    {pin.name}
                    {onlyInBase && (
                      <>
                        {' '}
                        <span
                          className="sd-change-sign"
                          data-change="removed"
                          role="img"
                          title="Only in the base"
                          aria-label="Only in the base"
                        >
                          −
                        </span>
                      </>
                    )}
                  </td>
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
                    ) : onlyInBase ? null : !pinListKnown ? (
                      '-'
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
                    {lostNets.map((net) => (
                      <div key={net.id}>
                        <button
                          type="button"
                          className="sd-link"
                          title="Only in the base"
                          onClick={() => onSelect({ kind: 'net', id: net.id })}
                        >
                          <span className="sd-change-sign" data-change="removed" aria-hidden="true">
                            −
                          </span>{' '}
                          {net.name}
                        </button>
                      </div>
                    ))}
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
        {!pinListKnown && (
          <p className="mt-2 text-xs opacity-70">
            The design file does not list every pin of this block, so unconnected pins cannot be
            checked.
          </p>
        )}
      </section>
      <InstanceClockDetails graph={graph} clocks={clocks} instance={instance} onSelect={onSelect} />
    </div>
  );
}
