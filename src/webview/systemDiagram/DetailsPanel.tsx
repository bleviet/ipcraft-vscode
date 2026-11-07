import React from 'react';
import type { SystemGraph, SystemNet, SystemPin } from '../../domain/systemGraph';
import { CapabilityPill } from './CapabilityPill';
import type { ClockAnalysis } from './clocks/analyzeClocks';
import { netCrossings } from './clocks/treeChecks';
import { ClockTreeDetails, ResetTreeDetails } from './ClockTreeDetails';
import { CrossingNote } from './CrossingNote';
import { capabilityRows, designEyebrow, formatLabel } from './detailsLabels';
import { InstanceDetails } from './InstanceDetails';
import { PortClockDetails } from './InstanceClockDetails';
import { MultiSelectionDetails } from './MultiSelectionDetails';
import { LineLink } from './LineLink';
import { levelSource } from './sourceFile';
import {
  boundaryId,
  endpointKey,
  netsByEndpoint,
  nodeSelection,
  parseBoundaryId,
  type Selection,
} from './model';
import { focusedPinOf, unconnectedClass, type FocusedPin } from './unconnectedPins';

interface DetailsPanelProps {
  graph: SystemGraph;
  clocks: ClockAnalysis;
  selection: Selection | null;
  selectedNodeIds: readonly string[];
  selectedItems?: readonly Selection[];
  focusedPin: FocusedPin | null;
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
  clocks,
  net,
  onSelect,
  onReveal,
}: {
  graph: SystemGraph;
  clocks: ClockAnalysis;
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
      {netCrossings(clocks, net.id).map((crossing) => (
        <CrossingNote key={crossing.id} crossing={crossing} />
      ))}
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
  clocks,
  level,
  pin,
  onSelect,
  onReveal,
}: {
  graph: SystemGraph;
  clocks: ClockAnalysis;
  level: string;
  pin: SystemPin;
  onSelect: DetailsPanelProps['onSelect'];
  onReveal: (line: number, uri?: string) => void;
}) {
  const parameters = Object.entries(pin.parameters);
  const unconnected = !netsByEndpoint(graph, level).has(
    endpointKey({ instance: null, pin: pin.name })
  );
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
      {unconnected && (
        <p className="text-xs opacity-70">
          {unconnectedClass(pin, true) === 'undriven'
            ? 'No net drives this port on this level.'
            : 'Nothing on this level uses this port.'}
        </p>
      )}
      <PortClockDetails graph={graph} clocks={clocks} level={level} pin={pin} onSelect={onSelect} />
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
  clocks,
  selection,
  selectedNodeIds,
  selectedItems,
  focusedPin,
  onSelect,
  onEnterHierarchy,
  onReveal,
  onOpenDefinition,
}: DetailsPanelProps) {
  const items = selectedItems ?? selectedNodeIds.map(nodeSelection);
  let content: React.ReactNode = <DesignSummary graph={graph} />;
  if (items.length > 1) {
    content = <MultiSelectionDetails graph={graph} items={items} onSelect={onSelect} />;
  } else if (selection?.kind === 'instance' && graph.instances[selection.id]) {
    content = (
      <InstanceDetails
        graph={graph}
        clocks={clocks}
        instance={graph.instances[selection.id]}
        focusedPin={focusedPinOf(focusedPin, selection, selection.id)}
        onSelect={onSelect}
        onEnterHierarchy={onEnterHierarchy}
        onReveal={onReveal}
        onOpenDefinition={onOpenDefinition}
      />
    );
  } else if (selection?.kind === 'net') {
    const net = graph.nets.find((candidate) => candidate.id === selection.id);
    if (net) {
      const domain = clocks.domainOfNet(net.id);
      const reset = clocks.resetOfNet(net.id);
      const tree = { graph, clocks, net, onSelect, onReveal };
      content = domain ? (
        <ClockTreeDetails {...tree} domain={domain} />
      ) : reset ? (
        <ResetTreeDetails {...tree} reset={reset} />
      ) : (
        <NetDetails
          graph={graph}
          clocks={clocks}
          net={net}
          onSelect={onSelect}
          onReveal={onReveal}
        />
      );
    }
  } else if (selection?.kind === 'boundary') {
    const { level, pin: pinName } = parseBoundaryId(selection.id);
    const pin = graph.levels[level]?.boundaryPins.find((candidate) => candidate.name === pinName);
    if (pin) {
      content = (
        <BoundaryDetails
          graph={graph}
          clocks={clocks}
          level={level}
          pin={pin}
          onSelect={onSelect}
          onReveal={onReveal}
        />
      );
    }
  }
  return (
    <aside aria-label="Details" className="min-h-0 flex-1 overflow-auto px-3.5 pb-5 pt-3">
      {content}
    </aside>
  );
}
