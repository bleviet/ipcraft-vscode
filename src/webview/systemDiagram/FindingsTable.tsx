import React, { useState } from 'react';
import type { SystemGraph } from '../../domain/systemGraph';
import type { DiagramCompare } from '../../shared/messages/systemDiagram';
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
  /** The comparison: its base and where the definitions of each side come from. */
  compare: DiagramCompare;
  /** The rows of `compare.findings` (see `findingRows`). */
  rows: readonly FindingRow[];
  /** The panel's filter: only the rows it matches are listed. Null without one. */
  filter: TextMatcher | null;
  selection: Selection | null;
  onSelectInstance: (instancePath: string) => void;
  /** Selects an external port of the root level. */
  onSelectPort: (name: string) => void;
}

/** A commit label is a short hash and the subject: the hash names it. */
const shortLabel = (label: string) => /^([0-9a-f]{7}) /.exec(label)?.[1] ?? label;

/** What the note above the list says about the definitions the two sides were checked with. */
export function definitionsNote({ baseLabel, baseDefinitions, diff }: DiagramCompare) {
  if (diff.base.missing) {
    return 'The base did not exist: every finding of the file is new.';
  }
  switch (baseDefinitions) {
    case 'revision':
      return `The base is checked with the definitions at ${shortLabel(baseLabel)}; the current side with those of this workspace.`;
    case 'workspace':
      return 'Both sides are checked with the definitions of this workspace.';
    case 'none':
      return 'Definitions are not read, so neither side is checked with them.';
  }
}
const SIGNS: readonly FindingRow['sign'][] = ['New', 'Resolved'];

/** Bottom-panel list of the findings that differ from the base of the comparison, filterable by new and resolved. */
export function FindingsTable({
  graph,
  compare,
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
      <span>{definitionsNote(compare)}</span>
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
