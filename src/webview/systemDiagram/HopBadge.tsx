import React from 'react';

/** The `#N` pill on the top-left corner of a block of a traced path. */
export function HopBadge({ index }: { index: number }) {
  return (
    <span className="sd-hop" aria-label={`Hop ${index}`}>
      #{index}
    </span>
  );
}
