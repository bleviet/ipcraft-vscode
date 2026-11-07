import React from 'react';
import type { SystemGraph } from '../../domain/systemGraph';
import type { ClockAnalysis } from './clocks/analyzeClocks';
import type { ResetSource } from './clocks/clockTypes';
import { resetCrossingsHeadline, sourceFocus } from './clocks/crossingRows';
import type { ClocksInView } from './clocks/viewScope';
import { CrossingsTable } from './CrossingsTable';
import { DomainLabel } from './DomainLabel';
import { LineLink } from './LineLink';
import type { Selection } from './model';
import { levelSource } from './sourceFile';
import type { FocusedPin } from './unconnectedPins';

interface ResetsTableProps {
  graph: SystemGraph;
  clocks: ClockAnalysis;
  /** What is on screen: the rows of both tables. */
  view: ClocksInView;
  selection: Selection | null;
  focusedPin: FocusedPin | null;
  /** Opens a net and reveals the given pin: a reset row its source, a crossing row its sink. */
  onSelectNet: (netId: string, focus?: { nodeId: string; pin: string }) => void;
  onReveal: (line: number, uri?: string) => void;
}

function ReleasedOn({ reset }: { reset: ResetSource }) {
  if (reset.async) {
    return <>asynchronous</>;
  }
  if (reset.constant) {
    return <>tied to a constant</>;
  }
  return reset.domain ? <DomainLabel domain={reset.domain} /> : <>unknown</>;
}

/** Bottom-panel tab: the reset sources, and the reset crossings of the view on screen. */
export function ResetsTable({
  graph,
  clocks,
  view,
  selection,
  focusedPin,
  onSelectNet,
  onReveal,
}: ResetsTableProps) {
  const selectedNet = selection?.kind === 'net' ? selection.id : undefined;
  const selectedReset = selectedNet === undefined ? undefined : clocks.resetOfNet(selectedNet);

  const resetRow = (reset: ResetSource) => (
    <tr
      key={reset.id}
      className={`sd-clickable cursor-pointer${selectedReset === reset ? ' sd-row-selected' : ''}`}
      onClick={() =>
        onSelectNet(reset.netId, reset.source && sourceFocus(reset.source.level, reset.source))
      }
    >
      <td className="sd-num">{reset.label}</td>
      <td>
        <ReleasedOn reset={reset} />
      </td>
      <td>
        <span className="sd-chip-tag">
          {reset.source ? (reset.from ?? 'no rule') : 'source not known'}
        </span>
      </td>
      <td className="sd-num">{reset.sinks.length}</td>
      <td onClick={(event) => event.stopPropagation()}>
        <LineLink source={levelSource(graph, reset.level)} line={reset.line} onReveal={onReveal} />
      </td>
    </tr>
  );

  return (
    <div>
      <h3 className="sd-psec">Reset sources</h3>
      {view.resets.length === 0 ? (
        <p className="p-3 opacity-70">No reset sources on this level.</p>
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
          <tbody>{view.resets.map(resetRow)}</tbody>
        </table>
      )}
      <h3 className="sd-psec">Reset domain crossings</h3>
      <CrossingsTable
        graph={graph}
        crossings={view.resetCrossings}
        headline={resetCrossingsHeadline}
        showKind={false}
        selection={selection}
        focusedPin={focusedPin}
        onSelectNet={onSelectNet}
        onReveal={onReveal}
      />
    </div>
  );
}
