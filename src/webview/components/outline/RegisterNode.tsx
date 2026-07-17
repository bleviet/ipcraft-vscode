import React from 'react';
import type { OutlineDragProps } from './useOutlineDragReorder';

interface RegisterNodeProps {
  id: string;
  isSelected: boolean;
  onClick: () => void;
  onContextMenu?: (e: React.MouseEvent) => void;
  onDoubleClick?: () => void;
  paddingLeft: string;
  /** Swatch color (hex), stable per register name — see getFieldColor. */
  color?: string;
  name: React.ReactNode;
  offsetLabel: string;
  actionButton?: React.ReactNode;
  drag?: OutlineDragProps;
}

const RegisterNode = ({
  id,
  isSelected,
  onClick,
  onDoubleClick,
  onContextMenu,
  paddingLeft,
  color,
  name,
  offsetLabel,
  actionButton,
  drag,
}: RegisterNodeProps) => {
  return (
    <div
      key={id}
      data-outline-id={id}
      className={`tree-item ${isSelected ? 'selected' : ''} gap-2 text-sm group`}
      role="treeitem"
      aria-selected={isSelected}
      onClick={onClick}
      onDoubleClick={onDoubleClick}
      onContextMenu={onContextMenu}
      onPointerMove={drag?.onRowPointerMove}
      onPointerEnter={drag?.onRowPointerEnter}
      style={{
        ...(drag?.isDragging
          ? {
              // Theme-aware ring (focusBorder is defined for both dark and light
              // themes) so the dragged node stays clearly visible while the tree
              // reflows around it.
              boxShadow: 'inset 0 0 0 2px var(--vscode-focusBorder)',
              opacity: 0.85,
              // The dragged row must not capture pointer events, or it would flip
              // the drop target as the reordered list slides it under the cursor.
              pointerEvents: 'none' as const,
            }
          : {}),
      }}
    >
      <div style={{ paddingLeft }} className="flex items-center gap-2 flex-grow min-w-0">
        {drag?.dragHandle}
        {color && (
          <span
            className="w-2 h-2 shrink-0"
            style={{ backgroundColor: color }}
            aria-hidden="true"
          />
        )}
        <span
          className={`codicon codicon-symbol-variable text-[16px] shrink-0 ${isSelected ? '' : 'opacity-70'}`}
          title="Register"
          style={{ color: 'var(--vscode-symbolIcon-propertyForeground)' }}
        ></span>
        {name}
      </div>
      <span className="text-[10px] vscode-muted font-mono shrink-0">{offsetLabel}</span>
      {actionButton}
    </div>
  );
};

export default RegisterNode;
