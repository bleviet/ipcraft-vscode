import React from 'react';
import type { SystemInstance } from '../../domain/systemGraph';
import { HEADER_HEIGHT } from './layout/elkLayout';
import { instanceSubtitle } from './model';
import type { NodeReview } from './unconnectedPins';

interface ExpandToggleProps {
  instance: SystemInstance;
  expanded: boolean;
  onToggleExpand?: (instancePath: string) => void;
}

/** Boxed [+] / [-] button of a hierarchy block header; it never selects or dives into the block. */
function ExpandToggle({ instance, expanded, onToggleExpand }: ExpandToggleProps) {
  return (
    <button
      type="button"
      className="sd-node-toggle nodrag nopan"
      aria-label={expanded ? `Collapse ${instance.name}` : `Expand ${instance.name} in place`}
      aria-expanded={expanded}
      title={expanded ? 'Collapse' : 'Expand in place'}
      onClick={(event) => {
        event.stopPropagation();
        onToggleExpand?.(instance.path);
      }}
      onDoubleClick={(event) => event.stopPropagation()}
    >
      <span
        aria-hidden="true"
        className={`codicon ${expanded ? 'codicon-remove' : 'codicon-add'}`}
      />
    </button>
  );
}

function unconnectedLabel(review: NodeReview): string {
  return `${review.all} unconnected pins (${review.undriven} undriven, ${review.all - review.undriven} unused)`;
}

interface NodeHeaderProps extends ExpandToggleProps {
  cellCount: number;
  review?: NodeReview;
}

/** Header of an instance block and of an expanded frame: expand toggle, name, review count, subtitle. */
export function NodeHeader({
  instance,
  cellCount,
  review,
  expanded,
  onToggleExpand,
}: NodeHeaderProps) {
  const isHier = instance.kind === 'hier';
  return (
    <div className="sd-node-head" style={{ height: HEADER_HEIGHT }}>
      <div className="sd-node-title">
        {isHier && (
          <ExpandToggle instance={instance} expanded={expanded} onToggleExpand={onToggleExpand} />
        )}
        <span className="sd-node-name">{instance.name}</span>
        {review && review.all > 0 ? (
          <span
            className="sd-node-open sd-node-unc"
            data-tone={review.undriven > 0 ? 'undriven' : 'unused'}
            role="img"
            title={unconnectedLabel(review)}
            aria-label={unconnectedLabel(review)}
          >
            <span
              className={`codicon ${review.undriven > 0 ? 'codicon-warning' : 'codicon-debug-disconnect'}`}
            />
            {review.all}
          </span>
        ) : null}
      </div>
      <div className="sd-node-subtitle">{instanceSubtitle(instance, cellCount)}</div>
    </div>
  );
}
