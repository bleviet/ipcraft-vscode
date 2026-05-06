import React from 'react';

interface RemoveZoneProps {
  visible: boolean;
}

/**
 * Visual overlay representing a "drop to delete" zone.
 * Renders a red-tinted backdrop with a trash icon when visible.
 */
export const RemoveZone: React.FC<RemoveZoneProps> = ({ visible }) => {
  if (!visible) {
    return null;
  }

  return (
    <div
      className="ip-canvas-remove-zone"
      onDragOver={(e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
      }}
    >
      <div className="ip-canvas-remove-zone__content">
        <span className="codicon codicon-trash ip-canvas-remove-zone__icon"></span>
        <span className="ip-canvas-remove-zone__text">Release to remove</span>
      </div>
    </div>
  );
};
