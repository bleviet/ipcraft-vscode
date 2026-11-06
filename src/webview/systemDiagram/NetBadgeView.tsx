import React from 'react';
import { categoryColor } from './colors';
import type { NetBadge } from './layout/netBadges';

interface NetBadgeViewProps {
  badge: NetBadge;
  onSelectNet?: (netId: string) => void;
}

/** Quiet label drawn where ELK reserved space for a hidden clock or reset net. */
export function NetBadgeView({ badge, onSelectNet }: NetBadgeViewProps) {
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
      style={{
        left: badge.x,
        top: badge.y,
        width: badge.width,
        height: badge.height,
      }}
      title={`${kind} net${badge.nets.length > 1 ? 's' : ''} ${names}. Turn on Clocks and resets to draw it.`}
      onClick={(event) => {
        event.stopPropagation();
        onSelectNet?.(badge.netId);
      }}
    >
      <span aria-hidden="true" className="sd-badge-stub" style={{ background: color }} />
      <span className="truncate">{badge.text}</span>
    </button>
  );
}
