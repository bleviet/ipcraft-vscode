import React, { useState } from 'react';
import type { DiagramCompare } from '../../shared/messages/systemDiagram';
import type { SystemGraph } from '../../domain/systemGraph';
import type { Cell, ChangeRow, ChangeSign } from '../../services/systemDiagram/diff/changeRows';
import { middleTruncate, shortLabels } from './compareLabels';
import {
  addressChangeWord,
  shownKinds,
  changeSummaryText,
  changeWhere,
  FORMATS_DIFFER_NOTE,
  SIGN_LABELS,
} from './changeSummary';
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
  /** Opens the base file as a diagram and compares it with this document; offered when `compare.canSwap`. */
  onSwapCompare: () => void;
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
              <span key={at} className={part.mark ? 'sd-code sd-mark' : 'sd-code'}>
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

function rowTitle(row: ChangeRow, target: ResolvedTarget | undefined): string | undefined {
  if (row.target === undefined) {
    return NOT_IN_REVISION;
  }
  return row.section === 'address' && target?.kind === 'instance'
    ? `Selects ${target.path}`
    : undefined;
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
  onSwapCompare,
}: ChangesTableProps) {
  const [shown, setShown] = useState<Record<ChangeSign, boolean>>({
    '+': true,
    '−': true,
    '~': true,
    '→': true,
    v: true,
  });
  const [shortBase, shortCurrent] = shortLabels(
    compare.baseLabel,
    compare.currentLabel,
    compare.canSwap
  );
  const bar = (
    <div className="sd-ubar">
      <span role="group" aria-label="Direction of the comparison">
        Base{' '}
        <strong className="sd-label" title={compare.baseLabel}>
          {middleTruncate(shortBase)}
        </strong>
        {' → '}
        Current{' '}
        <strong className="sd-label" title={compare.currentLabel}>
          {middleTruncate(shortCurrent)}
        </strong>
      </span>
      {compare.canSwap && (
        <button
          type="button"
          className="sd-chip"
          title="Open the base as a diagram and compare it with this file"
          onClick={onSwapCompare}
        >
          <span aria-hidden="true" className="codicon codicon-arrow-swap" /> Swap
        </button>
      )}
      <span>{changeSummaryText(compare.diff)}</span>
      {compare.diff.formatsDiffer && <span className="opacity-70">{FORMATS_DIFFER_NOTE}</span>}
      {rows.length > 0 &&
        shownKinds(compare.diff.summary).map(({ sign, chip, meaning }) => (
          <button
            key={sign}
            type="button"
            className="sd-chip"
            aria-label={chip}
            title={meaning}
            aria-pressed={shown[sign]}
            onClick={() => setShown((previous) => ({ ...previous, [sign]: !previous[sign] }))}
          >
            {sign} {chip}
          </button>
        ))}
    </div>
  );
  if (rows.length === 0) {
    return bar;
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
      {bar}
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
              <th title={compare.baseLabel}>Base</th>
              <th title={compare.currentLabel}>Current</th>
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
                  title={rowTitle(row, target)}
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
                  {row.section === 'address' ? (
                    <>
                      <td>
                        <CellView cell={row.subject} /> → <CellView cell={row.change} />
                      </td>
                      <td>{addressChangeWord(row.sign)}</td>
                    </>
                  ) : (
                    <>
                      <td>
                        <CellView cell={row.subject} />
                      </td>
                      <td>
                        <CellView cell={row.change} />
                      </td>
                    </>
                  )}
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
