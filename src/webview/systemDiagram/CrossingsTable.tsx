import React, { useState } from 'react';
import type { SystemGraph } from '../../domain/systemGraph';
import type { PinCrossing } from './clocks/clockTypes';
import {
  crossingKind,
  crossingProblem,
  crossingProvenance,
  crossingSource,
  listedCrossings,
} from './clocks/crossingRows';
import { crossingCounts } from './clocks/crossingSummary';
import { LineLink } from './LineLink';
import type { Selection } from './model';
import { crossingTexts, filterRows, NO_FILTER_MATCH } from './panelFilter';
import type { TextMatcher } from './searchMatcher';
import { focusedPinOf, type FocusedPin } from './unconnectedPins';

interface CrossingsTableProps {
  graph: SystemGraph;
  /** The crossings in view to list: all data crossings, or all reset crossings. */
  crossings: readonly PinCrossing[];
  /** The line above the table, from the number of crossings without a synchronizer. */
  headline: (flagged: number) => string;
  /** Whether to show the Kind column; every row of a reset table is a reset. */
  showKind: boolean;
  /** The panel's filter: only the rows it matches are listed. Null without one. */
  filter: TextMatcher | null;
  selection: Selection | null;
  focusedPin: FocusedPin | null;
  /** Opens a crossing's net and haloes its sink pin. */
  onSelectNet: (netId: string, focus: { nodeId: string; pin: string }) => void;
  onReveal: (line: number, uri?: string) => void;
}

function Mark({ unchecked }: { unchecked: boolean }) {
  return (
    <span
      className="sd-sev"
      data-status={unchecked ? 'unchecked' : 'cross'}
      role="img"
      aria-label={unchecked ? 'Could not be checked' : 'Crossing'}
    >
      {unchecked ? '?' : '!'}
    </span>
  );
}

/** Crossings in view that need action: data (CDC) or reset (RDC) crossings without a synchronizer. */
export function CrossingsTable({
  graph,
  crossings,
  headline,
  showKind,
  filter,
  selection,
  focusedPin,
  onSelectNet,
  onReveal,
}: CrossingsTableProps) {
  const [showUnchecked, setShowUnchecked] = useState(false);
  const counts = crossingCounts(crossings);
  const listed = listedCrossings(crossings, showUnchecked);
  const rows = filterRows(listed, filter, crossingTexts);

  const renderRow = (crossing: PinCrossing) => {
    const source = crossingSource(graph, crossing);
    const focused =
      focusedPin?.netId === crossing.netId &&
      focusedPinOf(focusedPin, selection, crossing.to.nodeId) === crossing.to.pin;
    return (
      <tr
        key={crossing.id}
        className={`sd-clickable cursor-pointer${focused ? ' sd-row-selected' : ''}`}
        title={crossingProvenance(crossing)}
        onClick={() =>
          onSelectNet(crossing.netId, { nodeId: crossing.to.nodeId, pin: crossing.to.pin })
        }
      >
        <td>
          <Mark unchecked={crossing.status === 'unchecked'} />
        </td>
        {showKind && <td>{crossingKind(crossing)}</td>}
        <td>{crossing.from.label}</td>
        <td>{crossing.to.label}</td>
        <td>{crossingProblem(crossing)}</td>
        <td onClick={(event) => event.stopPropagation()}>
          {source && <LineLink source={source.source} line={source.line} onReveal={onReveal} />}
        </td>
      </tr>
    );
  };

  return (
    <div>
      <div className="sd-ubar">
        <span className="min-w-0 flex-1">{headline(counts.cross)}</span>
        {counts.unchecked > 0 && (
          <label className="flex cursor-pointer select-none items-center gap-1 whitespace-nowrap">
            <input
              type="checkbox"
              checked={showUnchecked}
              onChange={(event) => setShowUnchecked(event.target.checked)}
            />
            Show {counts.unchecked} that could not be checked
          </label>
        )}
      </div>
      {listed.length > 0 && rows.length === 0 && (
        <p className="p-3 opacity-70">{NO_FILTER_MATCH}</p>
      )}
      {rows.length > 0 && (
        <table className="sd-table">
          <thead>
            <tr>
              <th>
                <span className="sr-only">Status</span>
              </th>
              {showKind && <th>Kind</th>}
              <th>From</th>
              <th>To</th>
              <th>Problem</th>
              <th>Source</th>
            </tr>
          </thead>
          <tbody>{rows.map(renderRow)}</tbody>
        </table>
      )}
    </div>
  );
}
