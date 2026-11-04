import React from 'react';
import { categoryColor } from './colors';
import type { NetBadge } from './layout/netBadges';

interface NetBadgeViewProps {
  badge: NetBadge;
  onSelectNet?: (netId: string) => void;
}

/** Net-name pill drawn where ELK reserved space for a hidden clock or reset net. */
export function NetBadgeView({ badge, onSelectNet }: NetBadgeViewProps) {
  const categories = new Set(badge.nets.map((net) => net.category));
  const kind =
    categories.size > 1 ? 'Clock and reset' : badge.category === 'reset' ? 'Reset' : 'Clock';
  const names = badge.nets.map((net) => net.name).join(', ');
  const color = categoryColor(badge.category);
  return (
    <button
      type="button"
      className="nodrag nopan absolute truncate rounded-sm px-1 text-left leading-[14px]"
      style={{
        left: badge.x,
        top: badge.y,
        width: badge.width,
        height: badge.height,
        fontSize: 10,
        color,
        border: `1px solid ${color}`,
        background: 'var(--vscode-editor-background)',
      }}
      title={`${kind} net${badge.nets.length > 1 ? 's' : ''} ${names}. Turn on Clocks and resets to draw it.`}
      onClick={(event) => {
        event.stopPropagation();
        onSelectNet?.(badge.netId);
      }}
    >
      {badge.text}
    </button>
  );
}
