import React, { useEffect, useMemo, useRef, useState } from 'react';
import type { SystemGraph } from '../../domain/systemGraph';
import { categoryColor } from './colors';
import {
  connectivityMatrix,
  matrixKey,
  type MatrixCount,
  type MatrixNode,
} from './connectivityMatrix';
import { categoryShort } from './legend';

interface ConnectivityMatrixViewProps {
  graph: SystemGraph;
  levelPath: string;
  /** A row or column header was clicked: select that node on the diagram. */
  onSelectNode: (nodeId: string) => void;
  /** A cell was clicked: isolate that pair on the diagram. */
  onSelectPair: (rowId: string, colId: string) => void;
  onClose: () => void;
}

/** Name of a row or column in an accessible name: a boundary port says so. */
const spoken = (node: MatrixNode) => (node.kind === 'boundary' ? `port ${node.label}` : node.label);
const countText = ({ count, category }: MatrixCount) => `${count} ${categoryShort(category)}`;

/** Marks a boundary port header; the accessible name carries the word "port". */
function PortMark() {
  return (
    <span className="sd-matrix-port" aria-hidden="true" title="External port">
      {' '}
      port
    </span>
  );
}

/** Opaque overlay with the source x target connection counts of a level; the diagram stays mounted below. */
export function ConnectivityMatrixView({
  graph,
  levelPath,
  onSelectNode,
  onSelectPair,
  onClose,
}: ConnectivityMatrixViewProps) {
  const { nodes, cells } = useMemo(() => connectivityMatrix(graph, levelPath), [graph, levelPath]);
  const [hover, setHover] = useState<{ row: string; col: string } | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  useEffect(() => rootRef.current?.focus(), []);

  return (
    <div
      ref={rootRef}
      className="sd-matrix"
      role="region"
      aria-label="Connectivity matrix"
      tabIndex={-1}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.preventDefault();
          event.stopPropagation();
          onClose();
        }
      }}
    >
      {nodes.length === 0 ? (
        <p className="sd-matrix-empty">No connections on this level.</p>
      ) : (
        <table className="sd-matrix-table" onMouseLeave={() => setHover(null)}>
          <thead>
            <tr>
              <td className="sd-matrix-corner" />
              {nodes.map((node) => (
                <th
                  key={node.id}
                  scope="col"
                  className="sd-matrix-col"
                  data-hover={hover?.col === node.id || undefined}
                >
                  <button
                    type="button"
                    className="sd-matrix-head"
                    aria-label={`Select ${spoken(node)} (column)`}
                    onClick={() => onSelectNode(node.id)}
                  >
                    {node.label}
                    {node.kind === 'boundary' && <PortMark />}
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {nodes.map((row) => (
              <tr key={row.id}>
                <th
                  scope="row"
                  className="sd-matrix-row"
                  data-hover={hover?.row === row.id || undefined}
                >
                  <button
                    type="button"
                    className="sd-matrix-head"
                    aria-label={`Select ${spoken(row)} (row)`}
                    onClick={() => onSelectNode(row.id)}
                  >
                    {row.label}
                    {row.kind === 'boundary' && <PortMark />}
                  </button>
                </th>
                {nodes.map((col) => {
                  const counts = cells.get(matrixKey(row.id, col.id));
                  return (
                    <td
                      key={col.id}
                      className="sd-matrix-cell"
                      data-diagonal={row.id === col.id || undefined}
                      onMouseEnter={() => setHover({ row: row.id, col: col.id })}
                    >
                      {counts && (
                        <button
                          type="button"
                          className="sd-matrix-button"
                          aria-label={`${spoken(row)} to ${spoken(col)}: ${counts.map(countText).join(', ')}`}
                          onClick={() => onSelectPair(row.id, col.id)}
                        >
                          {counts.map((entry) => (
                            <span
                              key={entry.category}
                              className="sd-matrix-pill"
                              style={{ ['--pill' as string]: categoryColor(entry.category) }}
                            >
                              {countText(entry)}
                            </span>
                          ))}
                        </button>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
