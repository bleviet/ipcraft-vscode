import React from 'react';
import type { SystemGraph, SystemNet, SystemPin } from '../../domain/systemGraph';
import { InstanceDetails } from './InstanceDetails';
import { LineLink } from './LineLink';
import { boundaryId, parseBoundaryId, type Selection } from './model';

interface DetailsPanelProps {
  graph: SystemGraph;
  selection: Selection | null;
  onSelect: (selection: Selection) => void;
  onEnterHierarchy: (instancePath: string) => void;
  onReveal: (line: number) => void;
  onOpenDefinition: (instance: string) => void;
}

function DesignSummary({ graph }: { graph: SystemGraph }) {
  return (
    <div className="space-y-3">
      <h2 className="font-semibold">{graph.name}</h2>
      <dl className="grid grid-cols-[auto_1fr] gap-x-3">
        <dt className="opacity-70">Source</dt>
        <dd>{graph.source.fileName}</dd>
        <dt className="opacity-70">Format</dt>
        <dd>{graph.source.format}</dd>
        {graph.source.toolVersion && (
          <>
            <dt className="opacity-70">Tool version</dt>
            <dd>{graph.source.toolVersion}</dd>
          </>
        )}
        <dt className="opacity-70">Instances</dt>
        <dd>{Object.keys(graph.instances).length}</dd>
        <dt className="opacity-70">Nets</dt>
        <dd>{graph.nets.length}</dd>
      </dl>
      <table className="w-full text-left">
        <caption className="text-left font-semibold">Capabilities</caption>
        <tbody>
          {Object.entries(graph.capabilities).map(([name, state]) => (
            <tr key={name}>
              <th className="pr-2 font-normal opacity-70">{name}</th>
              <td>{state}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function NetDetails({
  graph,
  net,
  onSelect,
  onReveal,
}: {
  graph: SystemGraph;
  net: SystemNet;
  onSelect: DetailsPanelProps['onSelect'];
  onReveal: (line: number) => void;
}) {
  return (
    <div className="space-y-3">
      <header>
        <h2 className="font-semibold">{net.name}</h2>
        <p className="opacity-70">
          {net.category} net ({net.categorySource})
        </p>
      </header>
      <p>
        First connected at{' '}
        <LineLink fileName={graph.source.fileName} line={net.line} onReveal={onReveal} />
      </p>
      <section>
        <h3 className="font-semibold">Endpoints</h3>
        <ul>
          {net.endpoints.map((ref) => {
            const label = ref.instance === null ? ref.pin : `${ref.instance}/${ref.pin}`;
            return (
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
                  {label}
                </button>
              </li>
            );
          })}
        </ul>
      </section>
    </div>
  );
}

function BoundaryDetails({
  graph,
  pin,
  onReveal,
}: {
  graph: SystemGraph;
  pin: SystemPin;
  onReveal: (line: number) => void;
}) {
  const parameters = Object.entries(pin.parameters);
  return (
    <div className="space-y-3">
      <header>
        <h2 className="font-semibold">{pin.name}</h2>
        <p className="opacity-70">
          {pin.direction} ({pin.directionSource}) ·{' '}
          {pin.vlnv ?? pin.interfaceType ?? pin.signalType ?? 'scalar'}
        </p>
      </header>
      {pin.line !== undefined && (
        <p>
          Declared at{' '}
          <LineLink fileName={graph.source.fileName} line={pin.line} onReveal={onReveal} />
        </p>
      )}
      {parameters.length > 0 && (
        <table className="w-full text-left">
          <tbody>
            {parameters.map(([key, value]) => (
              <tr key={key}>
                <th className="pr-2 font-normal opacity-70">{key}</th>
                <td className="break-all">{value}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

export function DetailsPanel({
  graph,
  selection,
  onSelect,
  onEnterHierarchy,
  onReveal,
  onOpenDefinition,
}: DetailsPanelProps) {
  let content: React.ReactNode = <DesignSummary graph={graph} />;
  if (selection?.kind === 'instance' && graph.instances[selection.id]) {
    content = (
      <InstanceDetails
        graph={graph}
        instance={graph.instances[selection.id]}
        onSelect={onSelect}
        onEnterHierarchy={onEnterHierarchy}
        onReveal={onReveal}
        onOpenDefinition={onOpenDefinition}
      />
    );
  } else if (selection?.kind === 'net') {
    const net = graph.nets.find((candidate) => candidate.id === selection.id);
    if (net) {
      content = <NetDetails graph={graph} net={net} onSelect={onSelect} onReveal={onReveal} />;
    }
  } else if (selection?.kind === 'boundary') {
    const { level, pin: pinName } = parseBoundaryId(selection.id);
    const pin = graph.levels[level]?.boundaryPins.find((candidate) => candidate.name === pinName);
    if (pin) {
      content = <BoundaryDetails graph={graph} pin={pin} onReveal={onReveal} />;
    }
  }
  return (
    <aside aria-label="Details" className="overflow-auto p-3">
      {content}
    </aside>
  );
}
