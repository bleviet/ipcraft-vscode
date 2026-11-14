import React from 'react';
import type { SystemInstance, SystemNet, SystemPin } from '../../domain/systemGraph';
import { instanceType } from '../../services/systemDiagram/diff/diffInstances';
import { boundaryId, type Selection } from './model';

/** The Details of what only the base has (see `layout/unionGraph.ts`): read-only, from the base. */

const NOT_IN_CURRENT =
  'Only in the base. It is not in the design you have open, so there is nothing to open or to find in the source.';

function Origin() {
  return (
    <p className="opacity-70" data-ghost="true">
      <span className="sd-change-sign" data-change="removed" aria-hidden="true">
        −
      </span>{' '}
      Only in the base
    </p>
  );
}

export function GhostInstanceDetails({ instance }: { instance: SystemInstance }) {
  const parameters = Object.entries(instance.parameters);
  return (
    <div className="space-y-3">
      <header>
        <div className="sd-eyebrow">Instance</div>
        <h2 className="sd-h2">{instance.name}</h2>
        <Origin />
        <p className="opacity-70">
          {instance.kind === 'blackbox' ? 'Black box' : instance.kind} · {instanceType(instance)}
        </p>
      </header>
      <p className="text-xs opacity-70">{NOT_IN_CURRENT}</p>
      <section>
        <h3 className="sd-h3">Parameters</h3>
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
              <th>Direction</th>
            </tr>
          </thead>
          <tbody>
            {instance.pins.map((pin) => (
              <tr key={pin.name}>
                <td>{pin.name}</td>
                <td>{pin.direction}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}

export function GhostPortDetails({ pin }: { pin: SystemPin }) {
  const parameters = Object.entries(pin.parameters);
  return (
    <div className="space-y-3">
      <header>
        <div className="sd-eyebrow">Port</div>
        <h2 className="sd-h2">{pin.name}</h2>
        <Origin />
        <p className="opacity-70">
          {pin.direction} · {pin.vlnv ?? pin.interfaceType ?? pin.signalType ?? 'scalar'}
        </p>
      </header>
      <p className="text-xs opacity-70">{NOT_IN_CURRENT}</p>
      {parameters.length > 0 && (
        <dl className="sd-kv">
          {parameters.map(([key, value]) => (
            <React.Fragment key={key}>
              <dt>{key}</dt>
              <dd className="break-all">{value}</dd>
            </React.Fragment>
          ))}
        </dl>
      )}
    </div>
  );
}

/** A connection only the base has: the pins it joined, which are blocks of the diagram to select. */
export function GhostNetDetails({
  net,
  onSelect,
}: {
  net: SystemNet;
  onSelect: (selection: Selection) => void;
}) {
  return (
    <div className="space-y-3">
      <header>
        <div className="sd-eyebrow">Net</div>
        <h2 className="sd-h2">{net.name}</h2>
        <Origin />
        <p className="opacity-70">{net.category} net, as it was connected in the base</p>
      </header>
      <section>
        <h3 className="sd-h3">Connected</h3>
        <ul>
          {net.endpoints.map((ref) => (
            <li key={`${ref.instance ?? ''}::${ref.pin}`}>
              <button
                type="button"
                className="sd-link"
                onClick={() =>
                  onSelect(
                    ref.instance === null
                      ? { kind: 'boundary', id: boundaryId(net.level, ref.pin) }
                      : { kind: 'instance', id: ref.instance }
                  )
                }
              >
                {ref.instance === null ? ref.pin : `${ref.instance}/${ref.pin}`}
              </button>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
