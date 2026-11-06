import React from 'react';
import type { SystemGraph, SystemNet, SystemPin } from '../../domain/systemGraph';
import { CapabilityPill } from './CapabilityPill';
import { capabilityRows, designEyebrow, formatLabel } from './detailsLabels';
import { InstanceDetails } from './InstanceDetails';
import { MultiSelectionDetails } from './MultiSelectionDetails';
import { LineLink } from './LineLink';
import { levelSource } from './sourceFile';
import { boundaryId, parseBoundaryId, type Selection } from './model';

interface DetailsPanelProps {
  graph: SystemGraph;
  selection: Selection | null;
  selectedNodeIds: readonly string[];
  onSelect: (selection: Selection) => void;
  onEnterHierarchy: (instancePath: string) => void;
  onReveal: (line: number, uri?: string) => void;
  onOpenDefinition: (instance: string) => void;
}

function DesignSummary({ graph }: { graph: SystemGraph }) {
  return (
    <div>
      <div className="sd-eyebrow">{designEyebrow(graph.source.format)}</div>
      <h2 className="sd-h2">{graph.name}</h2>
      <dl className="sd-kv">
        <dt>Source</dt>
        <dd>{graph.source.fileName}</dd>
        <dt>Format</dt>
        <dd>{formatLabel(graph.source.format)}</dd>
        {graph.source.toolVersion && (
          <>
            <dt>Tool version</dt>
            <dd>{graph.source.toolVersion}</dd>
          </>
        )}
        <dt>Instances</dt>
        <dd>{Object.keys(graph.instances).length}</dd>
        <dt>Nets</dt>
        <dd>{graph.nets.length}</dd>
      </dl>
      <h3 className="sd-h3">What this view knows</h3>
      <ul className="sd-cap-list">
        {capabilityRows(graph.capabilities).map(({ key, label, state }) => (
          <li key={key}>
            <span>{label}</span>
            <CapabilityPill state={state} />
          </li>
        ))}
      </ul>
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
  onReveal: (line: number, uri?: string) => void;
}) {
  return (
    <div className="space-y-3">
      <header>
        <div className="sd-eyebrow">Net</div>
        <h2 className="sd-h2">{net.name}</h2>
        <p className="opacity-70">
          {net.category} net ({net.categorySource})
        </p>
      </header>
      <p>
        First connected at{' '}
        <LineLink source={levelSource(graph, net.level)} line={net.line} onReveal={onReveal} />
      </p>
      <section>
        <h3 className="sd-h3">Endpoints</h3>
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
  level,
  pin,
  onReveal,
}: {
  graph: SystemGraph;
  level: string;
  pin: SystemPin;
  onReveal: (line: number, uri?: string) => void;
}) {
  const parameters = Object.entries(pin.parameters);
  return (
    <div className="space-y-3">
      <header>
        <div className="sd-eyebrow">Port</div>
        <h2 className="sd-h2">{pin.name}</h2>
        <p className="opacity-70">
          {pin.direction} ({pin.directionSource}) ·{' '}
          {pin.vlnv ?? pin.interfaceType ?? pin.signalType ?? 'scalar'}
        </p>
      </header>
      {pin.line !== undefined && (
        <p>
          Declared at{' '}
          <LineLink source={levelSource(graph, level)} line={pin.line} onReveal={onReveal} />
        </p>
      )}
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

export function DetailsPanel({
  graph,
  selection,
  selectedNodeIds,
  onSelect,
  onEnterHierarchy,
  onReveal,
  onOpenDefinition,
}: DetailsPanelProps) {
  let content: React.ReactNode = <DesignSummary graph={graph} />;
  if (selectedNodeIds.length > 1) {
    content = <MultiSelectionDetails graph={graph} nodeIds={selectedNodeIds} onSelect={onSelect} />;
  } else if (selection?.kind === 'instance' && graph.instances[selection.id]) {
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
      content = <BoundaryDetails graph={graph} level={level} pin={pin} onReveal={onReveal} />;
    }
  }
  return (
    <aside aria-label="Details" className="min-h-0 flex-1 overflow-auto px-3.5 pb-5 pt-3">
      {content}
    </aside>
  );
}
