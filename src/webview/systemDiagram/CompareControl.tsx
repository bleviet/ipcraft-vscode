import React from 'react';
import type { DiagramCompare } from '../../shared/messages/systemDiagram';
import { shownKinds } from './changeSummary';

export interface CompareControlProps {
  /** The comparison that is on, else undefined. */
  compare?: DiagramCompare;
  onStart: () => void;
  onStop: () => void;
  /** Open the Changes tab of the bottom panel. */
  onOpenChanges: () => void;
  /** Marks the changes on the diagram; on by default when a comparison starts. */
  marksOn: boolean;
  onMarksChange: (on: boolean) => void;
  /** Isolates the marked blocks of the level on show; absent when the level has none or Marks is off. */
  onChangesOnly?: () => void;
  /** Shows or hides the blocks whose only change is the IP version; absent when there are none. */
  versionOnly?: { on: boolean; onChange: (on: boolean) => void };
  /** Whether the version-only kind is counted in the toolbar; false while Version only is off. Default true. */
  showVersion?: boolean;
}

/** The Compare button of the Design group; while a comparison is on, also its base, summary and exit. */
export function CompareControl({
  compare,
  onStart,
  onStop,
  onOpenChanges,
  marksOn,
  onMarksChange,
  onChangesOnly,
  versionOnly,
  showVersion = true,
}: CompareControlProps) {
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
            {shownKinds(compare.diff.summary, { version: showVersion }).map(
              ({ key, sign, chip }) => {
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
              }
            )}
          </button>
          <button
            type="button"
            className={`canvas-view-toggle${marksOn ? ' canvas-view-toggle--active' : ''}`}
            aria-label="Marks"
            aria-pressed={marksOn}
            title="Mark the changes on the diagram"
            onClick={() => onMarksChange(!marksOn)}
          >
            <span aria-hidden="true" className="codicon codicon-diff" />
          </button>
          {versionOnly && (
            <button
              type="button"
              className={`canvas-view-toggle${versionOnly.on ? ' canvas-view-toggle--active' : ''}`}
              aria-label="Show version-only changes"
              aria-pressed={versionOnly.on}
              title={
                versionOnly.on
                  ? 'Hide the blocks whose only change is the IP version'
                  : 'Show the blocks whose only change is the IP version'
              }
              onClick={() => versionOnly.onChange(!versionOnly.on)}
            >
              <span aria-hidden="true">v</span>
            </button>
          )}
          <button
            type="button"
            className="canvas-view-toggle"
            aria-label="Changes only"
            disabled={onChangesOnly === undefined}
            title={
              onChangesOnly
                ? 'Show only the changed blocks of this level and what they connect to'
                : marksOn
                  ? 'No changed blocks on this level'
                  : 'Turn on Marks to show only the changes'
            }
            onClick={onChangesOnly}
          >
            <span aria-hidden="true" className="codicon codicon-filter" />
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
