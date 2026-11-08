import React from 'react';
import type { SystemInstance } from '../../domain/systemGraph';
import { domainBadge, type NodeDomains } from './clocks/domainView';
import { HEADER_HEIGHT } from './layout/elkLayout';
import { instanceSubtitle } from './model';
import type { NodeReview } from './unconnectedPins';

/** A name as text parts that each end after an underscore, to put a `<wbr />` after each. */
export function nameParts(name: string): string[] {
  return name.split(/(?<=_)/);
}

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
  /** Clock domain mode: a strip with one segment per domain, and the crossing or domain count. */
  domains?: NodeDomains;
}

/** Header of an instance block and of an expanded frame: expand toggle, name, review or domain count, subtitle. */
export function NodeHeader({
  instance,
  cellCount,
  review,
  domains,
  expanded,
  onToggleExpand,
}: NodeHeaderProps) {
  const isHier = instance.kind === 'hier';
  const badge = domains && domainBadge(domains);
  return (
    <div className="sd-node-head" style={{ height: HEADER_HEIGHT }}>
      {domains && domains.segments.length > 0 && (
        <div className="sd-node-strip" aria-hidden="true">
          {domains.segments.map((segment) => (
            <span key={segment.id} title={segment.name} style={{ background: segment.color }} />
          ))}
        </div>
      )}
      <div className="sd-node-title">
        {isHier && (
          <ExpandToggle instance={instance} expanded={expanded} onToggleExpand={onToggleExpand} />
        )}
        <span className="sd-node-name" title={instance.name}>
          {nameParts(instance.name).map((part, index) => (
            <React.Fragment key={index}>
              {index > 0 && <wbr />}
              {part}
            </React.Fragment>
          ))}
        </span>
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
        {badge && (
          <span
            className="sd-node-open sd-node-dom"
            data-tone={badge.warning ? 'warning' : 'info'}
            role="img"
            title={badge.label}
            aria-label={badge.label}
          >
            {badge.text}
          </span>
        )}
      </div>
      <div className="sd-node-subtitle">{instanceSubtitle(instance, cellCount)}</div>
    </div>
  );
}
