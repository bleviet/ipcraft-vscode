import React from 'react';
import type { SystemGraph } from '../../domain/systemGraph';
import type { ChangeRow } from '../../services/systemDiagram/diff/changeRows';
import { CellView } from './ChangeCell';
import { insideLabel } from './ChangeBadges';
import { blockOfRow, type ResolvedTarget, type SegmentOwners } from './changeTargets';

interface InstanceChangesProps {
  /** The current graph: it knows the block of an address segment. */
  graph: SystemGraph;
  /** Who the text of a removed address segment names (see `segmentOwners`). */
  owners: SegmentOwners;
  /** The rows of the comparison (see `changeRows`). */
  rows: readonly ChangeRow[];
  /** The block or port the section is about. */
  target: ResolvedTarget;
  /** Changes below a hierarchy block. */
  inside?: number;
}

const sameTarget = (
  graph: SystemGraph,
  owners: SegmentOwners,
  row: ChangeRow,
  target: ResolvedTarget
): boolean => {
  const own = blockOfRow(graph, row, owners);
  return target.kind === 'instance'
    ? own?.kind === 'instance' && own.path === target.path
    : own?.kind === 'port' && own.name === target.name;
};

/** The Changes section of the Details of a marked block or port: what differs from the base, whether or not Marks is on. */
export function InstanceChanges({ graph, owners, rows, target, inside = 0 }: InstanceChangesProps) {
  const own = rows.filter((row) => sameTarget(graph, owners, row, target));
  if (own.length === 0 && inside === 0) {
    return null;
  }
  return (
    <section aria-label="Changes">
      <h3 className="sd-h3">Changes</h3>
      {own.length > 0 && (
        <table className="sd-table sd-changes">
          <thead>
            <tr>
              <th>Change</th>
              <th>Base → Current</th>
            </tr>
          </thead>
          <tbody>
            {own.map((row, index) => (
              <tr key={index}>
                <td>{row.change.length > 0 ? <CellView cell={row.change} /> : 'port'}</td>
                <td className="sd-wrap">
                  {row.base.length > 0 ? <CellView cell={row.base} /> : '—'} →{' '}
                  {row.current.length > 0 ? <CellView cell={row.current} /> : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {inside > 0 && <p className="mt-2">{insideLabel(inside)}</p>}
    </section>
  );
}
