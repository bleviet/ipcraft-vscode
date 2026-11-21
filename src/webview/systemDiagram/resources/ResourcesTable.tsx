import React, { useMemo, useState } from 'react';
import type { ResourceReport } from '../../../domain/resourceUsage';
import type { DiagramResources } from '../../../shared/messages/systemDiagram';
import type { Selection } from '../model';
import { filterRows, NO_FILTER_MATCH, resourceTexts } from '../panelFilter';
import type { TextMatcher } from '../searchMatcher';
import { ResourceEmptyState } from './ResourceEmptyState';
import { ResourceNotice, ResourceSourceBar, sourceText } from './ResourceSourceBar';
import {
  changeText,
  metricText,
  sortRows,
  type ResourceRow,
  type ResourceSortColumn,
  type SortDirection,
} from './resourceRows';
import { formatPercent, NO_VALUE, primaryMetrics, SUMMED_NOTE } from './resourceView';
import type { ResourceChannel } from './useResourceChannel';

interface ResourcesTableProps {
  resources: DiagramResources | undefined;
  /** The rows of the chosen report (see `resourceRows`). */
  rows: readonly ResourceRow[];
  channel: ResourceChannel;
  /** The panel's filter: only the rows it matches are listed. Null without one. */
  filter: TextMatcher | null;
  selection: Selection | null;
  onSelectInstance: (instancePath: string) => void;
}

interface SortState {
  column: ResourceSortColumn;
  direction: SortDirection;
}

function rowLabel(row: ResourceRow): string {
  return row.kind === 'other' ? `${row.name} (not a block of the diagram)` : row.name;
}

function ariaSort(sort: SortState | null, column: ResourceSortColumn) {
  if (sort?.column !== column) {
    return 'none';
  }
  return sort.direction === 'asc' ? 'ascending' : 'descending';
}

/** Bottom-panel tab: the resource usage of every block of the chosen report, with the report picker above. */
export function ResourcesTable({
  resources,
  rows,
  channel,
  filter,
  selection,
  onSelectInstance,
}: ResourcesTableProps) {
  const [sort, setSort] = useState<SortState | null>(null);
  const report: ResourceReport | undefined = resources?.report;
  const metrics = useMemo(() => (report ? primaryMetrics(report) : []), [report]);
  const shown = useMemo(() => {
    const listed = filterRows(rows, filter, resourceTexts);
    return sort ? sortRows(listed, sort.column, sort.direction) : listed;
  }, [rows, filter, sort]);

  if (!resources) {
    return <p className="p-3 opacity-70">Looking for reports...</p>;
  }
  if (!resources.sources.some((source) => source.usable)) {
    return <ResourceEmptyState resources={resources} channel={channel} />;
  }

  // Text columns start ascending, numbers with the largest.
  const sortBy = (column: ResourceSortColumn) =>
    setSort((previous) => ({
      column,
      direction:
        previous?.column === column
          ? previous.direction === 'asc'
            ? 'desc'
            : 'asc'
          : typeof column === 'string' && column !== 'share'
            ? 'asc'
            : 'desc',
    }));
  const header = (column: ResourceSortColumn, label: string) => (
    <th key={String(column)} aria-sort={ariaSort(sort, column)}>
      <button type="button" className="sd-res-sort" onClick={() => sortBy(column)}>
        {label}
      </button>
    </th>
  );
  const compared =
    resources.compare && resources.sources.find((s) => s.id === resources.compare?.id);
  const selectedPath = selection?.kind === 'instance' ? selection.id : undefined;

  return (
    <div>
      <ResourceSourceBar resources={resources} report={report} channel={channel} />
      {report && compared && <p className="sd-res-notice">Change against {sourceText(compared)}</p>}
      <ResourceNotice notice={resources.notice} />
      {!report ? null : shown.length === 0 ? (
        <p className="p-3 opacity-70">{NO_FILTER_MATCH}</p>
      ) : (
        <table className="sd-table">
          <thead>
            <tr>
              {header('name', 'Block')}
              {header('level', 'Level')}
              {metrics.map((metric, index) => header(index, metric.label))}
              {header('share', '% of design')}
            </tr>
          </thead>
          <tbody>
            {shown.map((row) => {
              const block = row.kind === 'block' && row.path !== undefined;
              return (
                <tr
                  key={row.key}
                  className={`${block ? 'sd-clickable cursor-pointer' : ''}${
                    row.path !== undefined && row.path === selectedPath ? ' sd-row-selected' : ''
                  }${row.kind === 'design' ? ' font-semibold' : ''}`}
                  onClick={block ? () => onSelectInstance(row.path as string) : undefined}
                >
                  <td
                    className={row.kind === 'other' || row.kind === 'outside' ? 'opacity-70' : ''}
                  >
                    {rowLabel(row)}
                  </td>
                  <td className="sd-num">{row.level}</td>
                  {row.values.map((_, index) => {
                    const change = changeText(row, index);
                    return (
                      <td
                        key={index}
                        className="sd-num"
                        title={row.summed ? SUMMED_NOTE : undefined}
                      >
                        {row.summed && 'Σ '}
                        {metricText(row, index)}
                        {change !== undefined && <span className="opacity-70"> {change}</span>}
                      </td>
                    );
                  })}
                  <td className="sd-num">
                    {row.share === undefined ? NO_VALUE : formatPercent(row.share)}
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
