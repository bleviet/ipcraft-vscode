import React from 'react';
import type { RowCheck } from './clocks/treeChecks';

/** A check result printed after a pin: `✓`, `✗` or `?`, toned ok, warning or muted. */
export function CheckMark({ check }: { check: RowCheck }) {
  return (
    <span className="sd-check" data-tone={check.tone} title={check.title}>
      {check.text}
    </span>
  );
}
