import React from 'react';
import { OUTLINE_KINDS, type OutlineKind } from './outlineFilter';

/** Pills above the outline tree: which kind of row it keeps. */
export function OutlineKindFilter({
  kind,
  onChange,
}: {
  kind: OutlineKind;
  onChange: (kind: OutlineKind) => void;
}) {
  return (
    <div role="group" aria-label="Outline filter" className="sd-outline-filter">
      {OUTLINE_KINDS.map((entry) => (
        <button
          key={entry.kind}
          type="button"
          className="sd-outline-pill"
          aria-pressed={kind === entry.kind}
          onClick={() => onChange(entry.kind)}
        >
          {entry.label}
        </button>
      ))}
    </div>
  );
}
