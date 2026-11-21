/**
 * The rows, changes and sorting of the Resources tab, from a {@link ResourceReport} and the
 * {@link SystemGraph}. Pure: no React.
 */

import type { ResourceReport, ResourceUsage } from '../../../domain/resourceUsage';
import type { SystemGraph } from '../../../domain/systemGraph';
import {
  comparedIndex,
  comparedTotal,
  deviceShare,
  formatChange,
  formatCount,
  formatShare,
  fractionOf,
  indexesOfPrimary,
  NO_VALUE,
  primaryValues,
} from './resourceView';

/** One line of the Resources tab. */
export interface ResourceRow {
  kind: 'block' | 'other' | 'outside' | 'design';
  key: string;
  /** Instance path of a block row; the only rows that can be selected. */
  path?: string;
  name: string;
  /** The level of the diagram that holds the row; empty for the outside and design rows. */
  level: string;
  /** Totals of the primary metrics, in order. */
  values: number[];
  /** Shares of the device in the primary metrics, aligned with `values`; undefined where unknown. */
  deviceShares: Array<number | undefined>;
  summed: boolean;
  /** Share of the design in the first primary metric; absent for the outside row and when unknown. */
  share?: number;
  /** Against the compared report, aligned with `values`; present only while one is given. */
  changes?: ResourceChange[];
}

/** Selected minus compared in one metric; undefined where the compared report has no figure to subtract. */
export interface ResourceChange {
  /** In counts. */
  count?: number;
}

/** The change of every primary metric of `usage` against `other`, the matching usage of the compared report. */
function usageChanges(
  report: ResourceReport,
  usage: ResourceUsage,
  compare: ResourceReport,
  other: ResourceUsage | undefined
): ResourceChange[] {
  return indexesOfPrimary(report).map((index) => {
    const compareIndex = comparedIndex(compare, report.metrics[index].key);
    const total = comparedTotal(compare, other, report.metrics[index].key);
    if (other === undefined || compareIndex === undefined || total === undefined) {
      return {};
    }
    return { count: usage.total[index] - total };
  });
}

/** The count of a metric cell with its share of the device: `514 (1.0 %)`; the share is left out where unknown. */
export function metricText(row: ResourceRow, column: number): string {
  const share = row.deviceShares[column];
  return `${formatCount(row.values[column])}${share === undefined ? '' : ` (${formatShare(share)})`}`;
}

/** The text of the change in a metric cell: `+12`; an em dash when there is none to show. Undefined without a compared report. */
export function changeText(row: ResourceRow, column: number): string | undefined {
  const change = row.changes?.[column];
  if (!change) {
    return undefined;
  }
  return change.count === undefined ? NO_VALUE : formatChange(change.count);
}

/**
 * The rows of the tab: the blocks with usage (graph order), what the tool generated, the logic
 * outside the design, then the design. With a compared report each row also has its changes.
 */
export function resourceRows(
  report: ResourceReport,
  graph: SystemGraph,
  compare?: ResourceReport
): ResourceRow[] {
  const first = indexesOfPrimary(report)[0];
  const row = (
    kind: ResourceRow['kind'],
    key: string,
    name: string,
    level: string,
    usage: ResourceUsage,
    other: ResourceUsage | undefined,
    path?: string
  ): ResourceRow => {
    const share =
      kind === 'outside' || first === undefined
        ? undefined
        : fractionOf(usage.total[first], report.design.total[first]);
    return {
      kind,
      key,
      ...(path !== undefined && { path }),
      name,
      level,
      values: primaryValues(report, usage.total),
      deviceShares: indexesOfPrimary(report).map((index) => deviceShare(report, usage, index)),
      summed: usage.summed === true,
      ...(share !== undefined && { share }),
      ...(compare && { changes: usageChanges(report, usage, compare, other) }),
    };
  };
  return [
    ...Object.values(graph.instances)
      .filter((instance) => report.instances[instance.path])
      .map((instance) =>
        row(
          'block',
          instance.path,
          instance.name,
          instance.parent,
          report.instances[instance.path],
          compare?.instances[instance.path],
          instance.path
        )
      ),
    ...report.others.map((other) =>
      row(
        'other',
        `other:${other.level}:${other.name}`,
        other.name,
        other.level,
        other.usage,
        compare?.others.find((item) => item.level === other.level && item.name === other.name)
          ?.usage
      )
    ),
    ...(report.outside
      ? [
          row(
            'outside',
            'outside',
            'Outside the design',
            '',
            { total: report.outside },
            compare?.outside && { total: compare.outside }
          ),
        ]
      : []),
    row('design', 'design', graph.name, '', report.design, compare?.design),
  ];
}

/** `name`, `level`, `share`, or the index of a primary metric. */
export type ResourceSortColumn = 'name' | 'level' | 'share' | number;
export type SortDirection = 'asc' | 'desc';

const sortKey = (row: ResourceRow, column: ResourceSortColumn): string | number => {
  if (column === 'name') {
    return row.name;
  }
  if (column === 'level') {
    return row.level;
  }
  if (column === 'share') {
    return row.share ?? -1;
  }
  return row.values[column] ?? 0;
};

/** The rows ordered by a column (stable); the design row stays last. A metric column sorts by its count. */
export function sortRows(
  rows: readonly ResourceRow[],
  column: ResourceSortColumn,
  direction: SortDirection
): ResourceRow[] {
  const sign = direction === 'asc' ? 1 : -1;
  const sorted = rows
    .filter((row) => row.kind !== 'design')
    .map((row, index) => ({ row, index }))
    .sort((a, b) => {
      const left = sortKey(a.row, column);
      const right = sortKey(b.row, column);
      const order =
        typeof left === 'string' && typeof right === 'string'
          ? left.localeCompare(right, undefined, { numeric: true })
          : Number(left) - Number(right);
      return sign * order || a.index - b.index;
    })
    .map(({ row }) => row);
  return [...sorted, ...rows.filter((row) => row.kind === 'design')];
}
