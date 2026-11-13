import React from 'react';
import { markSign, type NodeChange } from './changeMarks';

/** The label of the count of changes below a hierarchy block. */
export const insideLabel = (count: number): string =>
  `${count} ${count === 1 ? 'change' : 'changes'} inside`;

/**
 * The marks of a comparison in a block header: the sign of its kind of change and, for a
 * hierarchy with changes below it, their count. The sign is always drawn, so a mark never
 * depends on color alone.
 */
export function ChangeBadges({ change }: { change?: NodeChange }) {
  if (!change) {
    return null;
  }
  return (
    <>
      {change.status && (
        <span
          className="sd-node-open sd-change-sign"
          data-change={change.status}
          role="img"
          title={change.title}
          aria-label={change.title}
        >
          {markSign(change.status)}
        </span>
      )}
      {change.inside !== undefined && change.inside > 0 && (
        <span
          className="sd-node-open sd-change-inside"
          role="img"
          title={insideLabel(change.inside)}
          aria-label={insideLabel(change.inside)}
        >
          {/* One inline run inside the flex badge, so the space before the word is kept. */}
          <span>
            ~ {change.inside}
            <span className="sd-inside-word"> inside</span>
          </span>
        </span>
      )}
    </>
  );
}
