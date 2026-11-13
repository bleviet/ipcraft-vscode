import React from 'react';
import type { DiagramCompare } from '../../shared/messages/systemDiagram';
import { CHANGE_KINDS } from './changeSummary';

export interface CompareControlProps {
  /** The comparison that is on, else undefined. */
  compare?: DiagramCompare;
  onStart: () => void;
  onStop: () => void;
  /** Open the Changes tab of the bottom panel. */
  onOpenChanges: () => void;
}

/** The Compare button of the Design group; while a comparison is on, also its base, summary and exit. */
export function CompareControl({ compare, onStart, onStop, onOpenChanges }: CompareControlProps) {
  return (
    <span className="sd-tool-group">
      <button
        type="button"
        className="canvas-view-toggle"
        aria-label="Compare"
        title="Compare with a revision or a file"
        onClick={onStart}
      >
        <span aria-hidden="true" className="codicon codicon-git-compare" />
      </button>
      {compare && (
        <>
          <button
            type="button"
            className="sd-tool-count sd-compare-base"
            title={`Base: ${compare.baseLabel}. Current: ${compare.currentLabel}. Click to show the changes.`}
            onClick={onOpenChanges}
          >
            vs {compare.baseLabel}
          </button>
          <button
            type="button"
            className="sd-tool-count sd-compare-counts"
            title="Open the Changes tab"
            onClick={onOpenChanges}
          >
            {CHANGE_KINDS.map(({ key, sign, chip }) => {
              const count = compare.diff.summary[key];
              return (
                <span
                  key={key}
                  role="img"
                  aria-label={`${count} ${chip.toLowerCase()}`}
                  className="sd-delta"
                  data-sign={sign}
                  data-zero={count === 0}
                >
                  {sign}
                  {count}
                </span>
              );
            })}
          </button>
          <button
            type="button"
            className="canvas-view-toggle"
            aria-label="Exit compare"
            title="Exit compare"
            onClick={onStop}
          >
            <span aria-hidden="true" className="codicon codicon-close" />
          </button>
        </>
      )}
    </span>
  );
}
