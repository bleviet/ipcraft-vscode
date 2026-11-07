import React from 'react';
import { categoryColor } from './colors';
import type { NetBadge } from './layout/netBadges';

interface NetBadgeViewProps {
  badge: NetBadge;
  /** Nets of the selected clock or reset tree; the badge is drawn selected when it holds one. */
  selectedNetIds?: ReadonlySet<string>;
  onSelectNet?: (netId: string, additive?: boolean) => void;
}

/** Quiet label drawn where ELK reserved space for a hidden clock or reset net. */
export function NetBadgeView({ badge, selectedNetIds, onSelectNet }: NetBadgeViewProps) {
  const categories = new Set(badge.nets.map((net) => net.category));
  const kind =
    categories.size > 1 ? 'Clock and reset' : badge.category === 'reset' ? 'Reset' : 'Clock';
  const names = badge.nets.map((net) => net.name).join(', ');
  const color = categoryColor(badge.category);
  return (
    <button
      type="button"
      className="sd-badge nodrag nopan"
      data-side={badge.x < 0 ? 'west' : 'east'}
      data-selected={badge.nets.some((net) => selectedNetIds?.has(net.id)) || undefined}
      style={{
        left: badge.x,
        top: badge.y,
        width: badge.width,
        height: badge.height,
      }}
      title={`${kind} net${badge.nets.length > 1 ? 's' : ''} ${names}. Turn on Clocks and resets to draw it.`}
      onClick={(event) => {
        event.stopPropagation();
        if (event.metaKey || event.ctrlKey) {
          onSelectNet?.(badge.netId, true);
        } else {
          onSelectNet?.(badge.netId);
        }
      }}
    >
      <span aria-hidden="true" className="sd-badge-stub" style={{ background: color }} />
      <span className="sd-badge-text truncate">{badge.text}</span>
    </button>
  );
}
