import React from 'react';
import type { SystemGraph } from '../../domain/systemGraph';
import type { ClockAnalysis } from './clocks/analyzeClocks';
import type { ClockDomain, ResetSource } from './clocks/clockTypes';
import { formatHz } from './clocks/frequency';
import { CrossingsTable } from './CrossingsTable';
import { DomainLabel, DomainName } from './DomainLabel';
import { LineLink } from './LineLink';
import type { Selection } from './model';
import { levelSource } from './sourceFile';
import type { FocusedPin } from './unconnectedPins';

interface ClocksTableProps {
  graph: SystemGraph;
  clocks: ClockAnalysis;
  selection: Selection | null;
  focusedPin: FocusedPin | null;
  /** Opens a net; a crossing row also haloes its sink pin. */
  onSelectNet: (netId: string, focus?: { nodeId: string; pin: string }) => void;
  onSelectInstance: (instancePath: string) => void;
  onReveal: (line: number, uri?: string) => void;
}

function Chip({ children }: { children: React.ReactNode }) {
  return <span className="sd-chip-tag">{children}</span>;
}

function ReleasedOn({ reset }: { reset: ResetSource }) {
  if (reset.async) {
    return <>asynchronous</>;
  }
  return reset.domain ? <DomainLabel domain={reset.domain} /> : <>unknown</>;
}

/** Bottom-panel tab: the clock domains with their frequencies, the reset sources, and the crossings. */
export function ClocksTable({
  graph,
  clocks,
  selection,
  focusedPin,
  onSelectNet,
  onSelectInstance,
  onReveal,
}: ClocksTableProps) {
  const selectedNet = selection?.kind === 'net' ? selection.id : undefined;
  const selectedDomain = selectedNet === undefined ? undefined : clocks.domainOfNet(selectedNet);
  const selectedReset = selectedNet === undefined ? undefined : clocks.resetOfNet(selectedNet);

  const domainRow = (domain: ClockDomain) => {
    const origin = domain.frequencyFrom;
    return (
      <tr
        key={domain.id}
        className={`sd-clickable cursor-pointer${selectedDomain === domain ? ' sd-row-selected' : ''}`}
        onClick={() => onSelectNet(domain.sourceNetId)}
      >
        <td>
          <DomainName domain={domain} />
        </td>
        <td className="sd-num">{formatHz(domain.hz)}</td>
        <td className="sd-num">{domain.label}</td>
        <td>
          {origin ? (
            <>
              <span className="sd-num">{origin.text}</span> <Chip>{origin.kind}</Chip>
            </>
          ) : (
            <Chip>no rule</Chip>
          )}
        </td>
        <td className="sd-num">{domain.loads}</td>
        <td className="sd-num">{domain.levels}</td>
        <td onClick={(event) => event.stopPropagation()}>
          {domain.line !== undefined && (
            <LineLink
              source={levelSource(graph, domain.sourceLevel)}
              line={domain.line}
              onReveal={onReveal}
            />
          )}
        </td>
      </tr>
    );
  };

  const resetRow = (reset: ResetSource) => (
    <tr
      key={reset.id}
      className={`sd-clickable cursor-pointer${selectedReset === reset ? ' sd-row-selected' : ''}`}
      onClick={() => onSelectNet(reset.netId)}
    >
      <td className="sd-num">{reset.label}</td>
      <td>
        <ReleasedOn reset={reset} />
      </td>
      <td>{reset.from ? <Chip>{reset.from}</Chip> : <Chip>no rule</Chip>}</td>
      <td className="sd-num">{reset.sinks.length}</td>
      <td onClick={(event) => event.stopPropagation()}>
        <LineLink
          source={levelSource(graph, reset.source.level)}
          line={reset.line}
          onReveal={onReveal}
        />
      </td>
    </tr>
  );

  return (
    <div>
      <h3 className="sd-psec">Clock domains</h3>
      {clocks.domains.length === 0 ? (
        <p className="p-3 opacity-70">No clock domains found.</p>
      ) : (
        <table className="sd-table">
          <thead>
            <tr>
              <th>Domain</th>
              <th>Frequency</th>
              <th>Source pin</th>
              <th>Frequency from</th>
              <th>Loads</th>
              <th>Levels</th>
              <th>Source</th>
            </tr>
          </thead>
          <tbody>{clocks.domains.map(domainRow)}</tbody>
        </table>
      )}
      <h3 className="sd-psec">Resets</h3>
      {clocks.resets.length === 0 ? (
        <p className="p-3 opacity-70">No reset sources found.</p>
      ) : (
        <table className="sd-table">
          <thead>
            <tr>
              <th>Reset source</th>
              <th>Released on</th>
              <th>Known from</th>
              <th>Sinks</th>
              <th>Source</th>
            </tr>
          </thead>
          <tbody>{clocks.resets.map(resetRow)}</tbody>
        </table>
      )}
      <h3 className="sd-psec">Crossings</h3>
      <CrossingsTable
        graph={graph}
        clocks={clocks}
        selection={selection}
        focusedPin={focusedPin}
        onSelectNet={onSelectNet}
        onSelectInstance={onSelectInstance}
        onReveal={onReveal}
      />
    </div>
  );
}
