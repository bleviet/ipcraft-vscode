import React from 'react';
import type { SystemGraph } from '../../domain/systemGraph';
import type { ClockAnalysis } from './clocks/analyzeClocks';
import type { ClockDomain } from './clocks/clockTypes';
import { dataCrossingsHeadline, sourceFocus } from './clocks/crossingRows';
import { formatHz } from './clocks/frequency';
import type { ClocksInView } from './clocks/viewScope';
import { CrossingsTable } from './CrossingsTable';
import { DomainName } from './DomainLabel';
import { LineLink } from './LineLink';
import type { Selection } from './model';
import { levelSource } from './sourceFile';
import type { FocusedPin } from './unconnectedPins';

interface ClocksTableProps {
  graph: SystemGraph;
  clocks: ClockAnalysis;
  /** What is on screen: the rows of both tables. */
  view: ClocksInView;
  selection: Selection | null;
  focusedPin: FocusedPin | null;
  /** Opens a net and reveals the given pin: a domain row its source, a crossing row its sink. */
  onSelectNet: (netId: string, focus?: { nodeId: string; pin: string }) => void;
  onReveal: (line: number, uri?: string) => void;
}

function Chip({ children }: { children: React.ReactNode }) {
  return <span className="sd-chip-tag">{children}</span>;
}

/** Bottom-panel tab: the clock domains with their frequencies, and the data crossings between them, of the view on screen. */
export function ClocksTable({
  graph,
  clocks,
  view,
  selection,
  focusedPin,
  onSelectNet,
  onReveal,
}: ClocksTableProps) {
  const selectedNet = selection?.kind === 'net' ? selection.id : undefined;
  const selectedDomain = selectedNet === undefined ? undefined : clocks.domainOfNet(selectedNet);

  const domainRow = (domain: ClockDomain) => {
    const origin = domain.frequencyFrom;
    return (
      <tr
        key={domain.id}
        className={`sd-clickable cursor-pointer${selectedDomain === domain ? ' sd-row-selected' : ''}`}
        onClick={() =>
          onSelectNet(
            domain.sourceNetId,
            domain.sourceRef && sourceFocus(domain.sourceLevel, domain.sourceRef)
          )
        }
      >
        <td>
          <DomainName domain={domain} />
        </td>
        <td className="sd-num">{domain.hz !== undefined && formatHz(domain.hz)}</td>
        <td className="sd-num">
          {domain.sourceRef ? domain.label : <span className="opacity-60">not known</span>}
        </td>
        <td>
          {origin && (
            <>
              <span className="sd-num">{origin.text}</span> <Chip>{origin.kind}</Chip>
            </>
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

  return (
    <div>
      <h3 className="sd-psec">Clock domains</h3>
      {view.domains.length === 0 ? (
        <p className="p-3 opacity-70">No clock domains on this level.</p>
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
          <tbody>{view.domains.map(domainRow)}</tbody>
        </table>
      )}
      <h3 className="sd-psec">Clock domain crossings</h3>
      <CrossingsTable
        graph={graph}
        crossings={view.dataCrossings}
        headline={dataCrossingsHeadline}
        showKind
        selection={selection}
        focusedPin={focusedPin}
        onSelectNet={onSelectNet}
        onReveal={onReveal}
      />
    </div>
  );
}
