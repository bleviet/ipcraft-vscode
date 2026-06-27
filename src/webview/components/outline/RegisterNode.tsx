import React from 'react';
import type { OutlineDragProps } from './useOutlineDragReorder';

interface RegisterNodeProps {
  id: string;
  isSelected: boolean;
  onClick: () => void;
  onContextMenu?: (e: React.MouseEvent) => void;
  onDoubleClick?: () => void;
  paddingLeft: string;
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
  name,
  offsetLabel,
  actionButton,
  drag,
}: RegisterNodeProps) => {
  return (
    <div
      key={id}
      data-outline-id={id}
      className={`tree-item ${isSelected ? 'selected' : ''} gap-2 text-sm group ${
        drag?.isDragging ? 'opacity-50' : ''
      }`}
      role="treeitem"
      aria-selected={isSelected}
      onClick={onClick}
      onDoubleClick={onDoubleClick}
      onContextMenu={onContextMenu}
      onPointerMove={drag?.onRowPointerMove}
      onPointerEnter={drag?.onRowPointerEnter}
      style={{
        boxShadow: drag?.isDropTarget
          ? drag.dropPosition === 'before'
            ? 'inset 0 2px 0 var(--vscode-focusBorder)'
            : 'inset 0 -2px 0 var(--vscode-focusBorder)'
          : undefined,
      }}
    >
      <div style={{ paddingLeft }} className="flex items-center gap-2 flex-grow min-w-0">
        {drag?.dragHandle}
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
