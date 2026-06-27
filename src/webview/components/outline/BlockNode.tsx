import React from 'react';
import type { NormalizedAddressBlock } from '../../../domain/internal.types';
import type { OutlineDragProps } from './useOutlineDragReorder';

interface BlockNodeProps {
  id: string;
  block: NormalizedAddressBlock;
  isSelected: boolean;
  isExpanded: boolean;
  onClick: () => void;
  onDoubleClick?: () => void;
  onToggleExpand: (e: React.MouseEvent) => void;
  name: React.ReactNode;
  children?: React.ReactNode;
  actionButton?: React.ReactNode;
  onContextMenu?: (e: React.MouseEvent) => void;
  isOverlapping?: boolean;
  baseAddress?: React.ReactNode;
  drag?: OutlineDragProps;
}

const BlockNode = ({
  id,
  block,
  isSelected,
  isExpanded,
  onClick,
  onDoubleClick,
  onToggleExpand,
  name,
  children,
  actionButton,
  onContextMenu,
  isOverlapping,
  baseAddress,
  drag,
}: BlockNodeProps) => {
  return (
    <div key={id}>
      <div
        data-outline-id={id}
        className={`tree-item ${isSelected ? 'selected' : ''} gap-2 text-sm group ${
          drag?.isDragging ? 'opacity-50' : ''
        }`}
        role="treeitem"
        aria-expanded={isExpanded}
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
        <div style={{ paddingLeft: '20px' }} className="flex items-center gap-2 flex-grow min-w-0">
          {drag?.dragHandle}
          <span
            className={`codicon codicon-chevron-${isExpanded ? 'down' : 'right'} shrink-0`}
            onClick={onToggleExpand}
            style={{ cursor: 'pointer' }}
          ></span>
          <span
            className="codicon codicon-package shrink-0"
            title="Address Block"
            style={{ color: 'var(--vscode-symbolIcon-classForeground)' }}
          ></span>
          {name}
        </div>
        {baseAddress !== undefined ? (
          baseAddress
        ) : (
          <span className="text-[10px] vscode-muted font-mono shrink-0">
            @ 0x{block.baseAddress.toString(16).toUpperCase()}
          </span>
        )}
        {isOverlapping && (
          <span
            className="codicon codicon-warning text-xs shrink-0 animate-pulse"
            style={{ color: 'var(--vscode-inputValidation-errorForeground, #f48771)' }}
            title="Address overlap detected"
          />
        )}
        {actionButton}
      </div>
      {isExpanded && <div>{children}</div>}
    </div>
  );
};

export default BlockNode;
