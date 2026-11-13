import React, { useState } from 'react';
import type { DiagramCompare } from '../../shared/messages/systemDiagram';
import type { SystemGraph } from '../../domain/systemGraph';
import type { Cell, ChangeRow, ChangeSign } from '../../services/systemDiagram/diff/changeRows';
import { CHANGE_KINDS, changeSummaryText, changeWhere, SIGN_LABELS } from './changeSummary';
import { resolveTarget, type ResolvedTarget } from './changeTargets';
import { boundaryId, type Selection } from './model';
import { changeTexts, filterRows, NO_FILTER_MATCH } from './panelFilter';
import type { TextMatcher } from './searchMatcher';

interface ChangesTableProps {
  /** The current graph: it knows the slave block of an address segment. */
  graph: SystemGraph;
  compare: DiagramCompare;
  /** The rows of `compare.diff` (see `changeRows`). */
  rows: readonly ChangeRow[];
  /** The panel's filter: only the rows it matches are listed. Null without one. */
  filter: TextMatcher | null;
  selection: Selection | null;
  onSelectInstance: (instancePath: string) => void;
  /** Selects an external port of the root level. */
  onSelectPort: (name: string) => void;
}

const NOT_IN_REVISION = 'Not in this revision';

function CellView({ cell }: { cell: Cell }) {
  return (
    <>
      {cell.map((item, index) => (
        <React.Fragment key={index}>
          {index > 0 && ' · '}
          {item.map((part, at) =>
            part.code ? (
              <span key={at} className="sd-code">
                {part.text}
              </span>
            ) : (
              part.text
            )
          )}
        </React.Fragment>
      ))}
    </>
  );
}

function isSelected(target: ResolvedTarget | undefined, selection: Selection | null): boolean {
  if (!target || !selection) {
    return false;
  }
  return target.kind === 'instance'
    ? selection.kind === 'instance' && selection.id === target.path
    : selection.kind === 'boundary' && selection.id === boundaryId('/', target.name);
}

/** Bottom-panel list of what differs from the base of the comparison, filterable by kind of change. */
export function ChangesTable({
  graph,
  compare,
  rows,
  filter,
  selection,
  onSelectInstance,
  onSelectPort,
}: ChangesTableProps) {
  const [shown, setShown] = useState<Record<ChangeSign, boolean>>({
    '+': true,
    '−': true,
    '~': true,
    v: true,
  });
  const summary = (
    <p className="px-1.5 py-1">{changeSummaryText(compare.diff, compare.baseLabel)}</p>
  );
  if (rows.length === 0) {
    return summary;
  }
  const listed = rows.filter((row) => shown[row.sign]);
  const visible = filterRows(listed, filter, changeTexts);
  const open = (target: ResolvedTarget) => {
    if (target.kind === 'instance') {
      onSelectInstance(target.path);
    } else {
      onSelectPort(target.name);
    }
  };
  return (
    <div>
      <div className="sd-ubar">
        {summary}
        {CHANGE_KINDS.map(({ sign, chip }) => (
          <button
            key={sign}
            type="button"
            className="sd-chip"
            aria-pressed={shown[sign]}
            onClick={() => setShown((previous) => ({ ...previous, [sign]: !previous[sign] }))}
          >
            {chip}
          </button>
        ))}
      </div>
      {visible.length === 0 ? (
        <p className="p-3 opacity-70">{NO_FILTER_MATCH}</p>
      ) : (
        <table className="sd-table sd-changes">
          <thead>
            <tr>
              <th>
                <span className="sr-only">Kind of change</span>
              </th>
              <th>Where</th>
              <th>What</th>
              <th>Change</th>
              <th>Base</th>
              <th>Current</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((row, index) => {
              const target = resolveTarget(graph, row);
              const clickable = target !== undefined;
              return (
                <tr
                  key={index}
                  className={`${clickable ? 'sd-clickable cursor-pointer' : 'opacity-70'}${
                    isSelected(target, selection) ? ' sd-row-selected' : ''
                  }`}
                  title={row.target === undefined ? NOT_IN_REVISION : undefined}
                  tabIndex={clickable ? 0 : undefined}
                  onClick={clickable ? () => open(target) : undefined}
                  onKeyDown={
                    clickable
                      ? (event) => {
                          if (event.key === 'Enter') {
                            event.preventDefault();
                            open(target);
                          }
                        }
                      : undefined
                  }
                >
                  <td>
                    <span className="sd-sign" data-sign={row.sign}>
                      {row.sign} {SIGN_LABELS[row.sign]}
                    </span>
                  </td>
                  <td>{changeWhere(row)}</td>
                  <td>
                    <CellView cell={row.subject} />
                  </td>
                  <td>
                    <CellView cell={row.change} />
                  </td>
                  <td className="sd-wrap">
                    <CellView cell={row.base} />
                  </td>
                  <td className="sd-wrap">
                    <CellView cell={row.current} />
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
