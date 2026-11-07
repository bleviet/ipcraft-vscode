import React, { useState } from 'react';
import type { SystemGraph } from '../../domain/systemGraph';
import type { ClockAnalysis } from './clocks/analyzeClocks';
import type { Crossing, CrossingEnd, CrossingStatus } from './clocks/clockTypes';
import {
  asynchronousText,
  coverageNote,
  CROSSING_STATUSES,
  crossingBlockLabel,
  crossingKind,
  crossingKnownFrom,
  crossingSource,
} from './clocks/crossingRows';
import { crossingCounts } from './clocks/crossingSummary';
import { DomainLabel } from './DomainLabel';
import { LineLink } from './LineLink';
import type { Selection } from './model';
import { focusedPinOf, type FocusedPin } from './unconnectedPins';

interface CrossingsTableProps {
  graph: SystemGraph;
  clocks: ClockAnalysis;
  selection: Selection | null;
  focusedPin: FocusedPin | null;
  /** Opens a crossing's net and haloes its sink pin. */
  onSelectNet: (netId: string, focus: { nodeId: string; pin: string }) => void;
  onSelectInstance: (instancePath: string) => void;
  onReveal: (line: number, uri?: string) => void;
}

function Status({ status }: { status: CrossingStatus }) {
  const { label, icon } = CROSSING_STATUSES.find((entry) => entry.status === status)!;
  return (
    <span className="sd-sev" data-status={status} role="img" aria-label={label} title={label}>
      {icon}
    </span>
  );
}

function EndDomain({ end, role }: { end: CrossingEnd; role: 'from' | 'to' }) {
  return <>{asynchronousText(end, role) ?? <DomainLabel domain={end.domain} />}</>;
}

/** Crossing rows of the Clocks tab: data (CDC), reset (RDC) and block records, filterable by status. */
export function CrossingsTable({
  graph,
  clocks,
  selection,
  focusedPin,
  onSelectNet,
  onSelectInstance,
  onReveal,
}: CrossingsTableProps) {
  const [shown, setShown] = useState<Record<CrossingStatus, boolean>>({
    cross: true,
    related: true,
    inside: true,
    unchecked: true,
    ok: false,
  });
  const counts = crossingCounts(clocks.crossings);
  const rows = clocks.crossings.filter((crossing) => shown[crossing.status]);

  const renderRow = (crossing: Crossing) => {
    const known = crossingKnownFrom(crossing);
    const source = crossingSource(graph, crossing);
    const link = source && (
      <td onClick={(event) => event.stopPropagation()}>
        <LineLink source={source.source} line={source.line} onReveal={onReveal} />
      </td>
    );
    const knownFrom = (
      <td>
        {known.reason ??
          known.sources.map((text, index) => (
            <span key={index} className="sd-chip-tag">
              {text}
            </span>
          ))}
      </td>
    );
    if (crossing.kind === 'block') {
      return (
        <tr
          key={crossing.id}
          className="sd-clickable cursor-pointer"
          onClick={() => onSelectInstance(crossing.instance)}
        >
          <td>
            <Status status={crossing.status} />
          </td>
          <td>{crossingKind(crossing)}</td>
          <td colSpan={2}>{crossingBlockLabel(graph, crossing)}</td>
          <td colSpan={2}>
            {crossing.domains.map((domain, index) => (
              <React.Fragment key={domain.id}>
                {index > 0 && ' and '}
                <DomainLabel domain={domain} />
              </React.Fragment>
            ))}
          </td>
          {knownFrom}
          {link ?? <td />}
        </tr>
      );
    }
    const focused =
      focusedPin?.netId === crossing.netId &&
      focusedPinOf(focusedPin, selection, crossing.to.nodeId) === crossing.to.pin;
    return (
      <tr
        key={crossing.id}
        className={`sd-clickable cursor-pointer${focused ? ' sd-row-selected' : ''}`}
        onClick={() =>
          onSelectNet(crossing.netId, { nodeId: crossing.to.nodeId, pin: crossing.to.pin })
        }
      >
        <td>
          <Status status={crossing.status} />
        </td>
        <td>{crossingKind(crossing)}</td>
        <td>{crossing.from.label}</td>
        <td>
          <EndDomain end={crossing.from} role="from" />
        </td>
        <td>{crossing.to.label}</td>
        <td>
          <EndDomain end={crossing.to} role="to" />
        </td>
        {knownFrom}
        {link ?? <td />}
      </tr>
    );
  };

  return (
    <div>
      <div className="sd-ubar">
        {CROSSING_STATUSES.map(({ status, label, icon }) => (
          <button
            key={status}
            type="button"
            className="sd-chip"
            aria-pressed={shown[status]}
            onClick={() => setShown((previous) => ({ ...previous, [status]: !previous[status] }))}
          >
            <span aria-hidden="true" className="sd-sev" data-status={status}>
              {icon}
            </span>{' '}
            {label} {counts[status]}
          </button>
        ))}
        <span className="min-w-0 flex-1 text-xs opacity-80">{coverageNote(graph)}</span>
      </div>
      {clocks.crossings.length === 0 ? (
        <p className="p-3 opacity-70">No data connections or resets to check.</p>
      ) : (
        <table className="sd-table">
          <thead>
            <tr>
              <th>
                <span className="sr-only">Status</span>
              </th>
              <th>Kind</th>
              <th>From</th>
              <th>Domain</th>
              <th>To</th>
              <th>Domain</th>
              <th>Known from</th>
              <th>Source</th>
            </tr>
          </thead>
          <tbody>{rows.map(renderRow)}</tbody>
        </table>
      )}
    </div>
  );
}
