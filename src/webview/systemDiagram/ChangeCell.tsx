import React from 'react';
import type { Cell } from '../../services/systemDiagram/diff/changeRows';

/** A cell of a change row: its items joined with ` · `, identifiers as code, the differing part of a name marked. */
export function CellView({ cell }: { cell: Cell }) {
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
