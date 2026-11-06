import React, { useState } from 'react';
import type { SystemGraph } from '../../domain/systemGraph';
import { LineLink } from './LineLink';
import type { Selection } from './model';
import {
  findingRow,
  uncheckedInstanceCount,
  type FocusedPin,
  type UnconnectedClass,
  type UnconnectedPin,
} from './unconnectedPins';

interface UnconnectedPinsTableProps {
  graph: SystemGraph;
  findings: readonly UnconnectedPin[];
  selection: Selection | null;
  focusedPin: FocusedPin | null;
  onSelectPin: (finding: UnconnectedPin) => void;
  onShowProblems: () => void;
  onReveal: (line: number, uri?: string) => void;
}

const FILTERS: { cls: UnconnectedClass; label: string }[] = [
  { cls: 'undriven', label: 'Undriven' },
  { cls: 'unused', label: 'Unused' },
];

function Severity({ cls }: { cls: UnconnectedClass }) {
  return cls === 'undriven' ? (
    <span
      className="codicon codicon-warning"
      role="img"
      aria-label="undriven"
      style={{ color: 'var(--vscode-editorWarning-foreground)' }}
    />
  ) : (
    <span role="img" aria-label="unused" style={{ color: 'var(--vscode-descriptionForeground)' }}>
      &ndash;
    </span>
  );
}

/** Bottom-panel list of pins that no net touches, filterable by class. */
export function UnconnectedPinsTable({
  graph,
  findings,
  selection,
  focusedPin,
  onSelectPin,
  onShowProblems,
  onReveal,
}: UnconnectedPinsTableProps) {
  const [shown, setShown] = useState<Record<UnconnectedClass, boolean>>({
    undriven: true,
    unused: true,
  });
  const unchecked = uncheckedInstanceCount(graph);
  const coverage = (
    <span className="min-w-0 flex-1">
      Checked: blocks with an .ip.yml or HDL definition, hierarchy pins, and external ports.{' '}
      {unchecked === 0 ? (
        'All blocks were checked.'
      ) : (
        <>
          <b>
            Not checked: {unchecked} {unchecked === 1 ? 'block' : 'blocks'}
          </b>
          , whose pins come from connections only.
        </>
      )}{' '}
      <button type="button" className="sd-link" onClick={onShowProblems}>
        See Problems
      </button>
    </span>
  );
  const rows = findings.filter((finding) => shown[finding.cls]);
  return (
    <div>
      <div className="sd-ubar">
        {FILTERS.map(({ cls, label }) => (
          <button
            key={cls}
            type="button"
            className="sd-chip"
            aria-pressed={shown[cls]}
            onClick={() => setShown((previous) => ({ ...previous, [cls]: !previous[cls] }))}
          >
            {label} {findings.filter((finding) => finding.cls === cls).length}
          </button>
        ))}
        {coverage}
      </div>
      {findings.length === 0 ? (
        <p className="p-3 opacity-70">No unconnected pins found.</p>
      ) : (
        <table className="sd-table">
          <thead>
            <tr>
              <th>
                <span className="sr-only">Severity</span>
              </th>
              <th>Pin</th>
              <th>Block</th>
              <th>Level</th>
              <th>Direction</th>
              <th>Type</th>
              <th>Known from</th>
              <th>Source</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((finding) => {
              const row = findingRow(graph, finding);
              const focused =
                focusedPin?.nodeId === finding.nodeId &&
                focusedPin.pin === finding.pin.name &&
                selection?.kind !== 'net' &&
                selection?.id === finding.nodeId;
              return (
                <tr
                  key={`${finding.nodeId}:${finding.pin.name}`}
                  className={`sd-clickable cursor-pointer${focused ? ' sd-row-selected' : ''}`}
                  onClick={() => onSelectPin(finding)}
                >
                  <td>
                    <Severity cls={finding.cls} />
                  </td>
                  <td>{finding.pin.name}</td>
                  <td>{row.block}</td>
                  <td>{row.level}</td>
                  <td>{finding.pin.direction}</td>
                  <td>{row.type}</td>
                  <td>{row.knownFrom}</td>
                  <td onClick={(event) => event.stopPropagation()}>
                    {row.link && (
                      <LineLink source={row.link.source} line={row.link.line} onReveal={onReveal} />
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}
