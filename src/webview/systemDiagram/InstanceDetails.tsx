import React from 'react';
import type { SystemGraph, SystemInstance } from '../../domain/systemGraph';
import { LineLink } from './LineLink';
import { endpointKey, netsByEndpoint, shortVlnv, type Selection } from './model';

interface InstanceDetailsProps {
  graph: SystemGraph;
  instance: SystemInstance;
  onSelect: (selection: Selection) => void;
  onEnterHierarchy: (instancePath: string) => void;
  onReveal: (line: number) => void;
  onOpenDefinition: (instance: string) => void;
}

export function InstanceDetails({
  graph,
  instance,
  onSelect,
  onEnterHierarchy,
  onReveal,
  onOpenDefinition,
}: InstanceDetailsProps) {
  const nets = netsByEndpoint(graph, instance.parent);
  const parameters = Object.entries(instance.parameters);
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
        <h2 className="font-semibold">{instance.name}</h2>
        <p className="opacity-70">
          {instance.kind} · {identity}
        </p>
      </header>
      <p>
        Created at{' '}
        <LineLink fileName={graph.source.fileName} line={instance.line} onReveal={onReveal} />
        {instance.procLine !== undefined && (
          <>
            {' '}
            · proc at{' '}
            <LineLink
              fileName={graph.source.fileName}
              line={instance.procLine}
              onReveal={onReveal}
            />
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
        <h3 className="font-semibold">Parameters</h3>
        <p className="text-xs opacity-70">
          Only values set in the design file are shown. Defaults and propagated values are not
          available offline.
        </p>
        {parameters.length === 0 ? (
          <p className="opacity-70">None set.</p>
        ) : (
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
      </section>
      <section>
        <h3 className="font-semibold">Pins</h3>
        <table className="w-full text-left">
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
              return (
                <tr key={pin.name}>
                  <td>{pin.name}</td>
                  <td>
                    {pinNets.length > 0
                      ? pinNets.map((net) => (
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
                      : '-'}
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
      </section>
    </div>
  );
}
