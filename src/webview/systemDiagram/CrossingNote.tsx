import React from 'react';
import type { PinCrossing } from './clocks/clockTypes';

interface CrossingNoteProps {
  crossing: PinCrossing;
  /** Adds a link that opens the crossing's net; absent where the net is already open. */
  onShowNet?: (netId: string) => void;
}

/** One sentence about a data or reset crossing: flagged, related clocks, not checked, or fine. */
export function CrossingNote({ crossing, onShowNet }: CrossingNoteProps) {
  if (crossing.status === 'unchecked') {
    return <p className="sd-note">Clock domains not checked: {crossing.reason}.</p>;
  }
  if (crossing.status === 'related') {
    return (
      <p className="sd-note">
        <b>Related clocks.</b> {crossing.reason}.
      </p>
    );
  }
  if (crossing.status !== 'cross') {
    return <p className="opacity-70">{crossing.reason}.</p>;
  }
  const known = [crossing.from.knownFrom, crossing.to.knownFrom].filter(
    (text): text is string => text !== undefined
  );
  return (
    <p className="sd-note">
      <b className="sd-warning">
        {crossing.kind === 'reset' ? 'Reset domain crossing.' : 'Clock domain crossing.'}
      </b>{' '}
      {crossing.reason}.
      {known.length === 2 && (
        <>
          {' '}
          Clocks known from{' '}
          {known.map((text, index) => (
            <React.Fragment key={index}>
              {index > 0 && ' and '}
              <span className="sd-chip-tag">{text}</span>
            </React.Fragment>
          ))}
          .
        </>
      )}
      {onShowNet && (
        <>
          {' '}
          <button type="button" className="sd-link" onClick={() => onShowNet(crossing.netId)}>
            Show net
          </button>
        </>
      )}
    </p>
  );
}
