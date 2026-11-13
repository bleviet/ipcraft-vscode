import React, { useState } from 'react';
import type { SystemGraph } from '../../domain/systemGraph';
import type { FindingRow } from '../../services/systemDiagram/diff/findingRows';
import { CellView } from './ChangeCell';
import { findingTarget, NOT_IN_REVISION } from './changeTargets';
import type { Selection } from './model';
import { filterRows, comparedFindingTexts, NO_FILTER_MATCH } from './panelFilter';
import type { TextMatcher } from './searchMatcher';
import { TargetRow } from './TargetRow';

interface FindingsTableProps {
  /** The current graph: a row selects its block or port when the graph has it. */
  graph: SystemGraph;
  /** The rows of `compare.findings` (see `findingRows`). */
  rows: readonly FindingRow[];
  /** The panel's filter: only the rows it matches are listed. Null without one. */
  filter: TextMatcher | null;
  selection: Selection | null;
  onSelectInstance: (instancePath: string) => void;
  /** Selects an external port of the root level. */
  onSelectPort: (name: string) => void;
}

const NOTE = 'Both revisions are checked with the same workspace definitions.';
const SIGNS: readonly FindingRow['sign'][] = ['New', 'Resolved'];

/** Bottom-panel list of the findings that differ from the base of the comparison, filterable by new and resolved. */
export function FindingsTable({
  graph,
  rows,
  filter,
  selection,
  onSelectInstance,
  onSelectPort,
}: FindingsTableProps) {
  const [shown, setShown] = useState<Record<FindingRow['sign'], boolean>>({
    New: true,
    Resolved: true,
  });
  const bar = (
    <div className="sd-ubar">
      <span>{NOTE}</span>
      {rows.length > 0 &&
        SIGNS.map((sign) => (
          <button
            key={sign}
            type="button"
            className="sd-chip"
            aria-pressed={shown[sign]}
            onClick={() => setShown((previous) => ({ ...previous, [sign]: !previous[sign] }))}
          >
            {sign}
          </button>
        ))}
    </div>
  );
  if (rows.length === 0) {
    return (
      <div>
        {bar}
        <p className="p-3 opacity-70">No finding differs from the base.</p>
      </div>
    );
  }
  const visible = filterRows(
    rows.filter((row) => shown[row.sign]),
    filter,
    comparedFindingTexts
  );
  return (
    <div>
      {bar}
      {visible.length === 0 ? (
        <p className="p-3 opacity-70">{NO_FILTER_MATCH}</p>
      ) : (
        <table className="sd-table sd-findings">
          <thead>
            <tr>
              <th>
                <span className="sr-only">New or resolved</span>
              </th>
              <th>Finding</th>
              <th>Where</th>
              <th>Detail</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((row, index) => {
              const target = findingTarget(graph, row.finding);
              return (
                <TargetRow
                  key={index}
                  target={target}
                  selection={selection}
                  onSelectInstance={onSelectInstance}
                  onSelectPort={onSelectPort}
                  title={target ? undefined : NOT_IN_REVISION}
                >
                  <td>
                    <span className="sd-sign" data-finding={row.sign}>
                      {row.sign}
                    </span>
                  </td>
                  <td>{row.kind}</td>
                  <td>
                    <CellView cell={row.where} />
                  </td>
                  <td>
                    <CellView cell={row.detail} />
                  </td>
                </TargetRow>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}
