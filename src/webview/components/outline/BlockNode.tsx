import React from 'react';
import type { NormalizedAddressBlock } from '../../../domain/internal.types';

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
}: BlockNodeProps) => {
  return (
    <div key={id}>
      <div
        data-outline-id={id}
        className={`tree-item ${isSelected ? 'selected' : ''} gap-2 text-sm group`}
        role="treeitem"
        aria-expanded={isExpanded}
        aria-selected={isSelected}
        onClick={onClick}
        onDoubleClick={onDoubleClick}
        onContextMenu={onContextMenu}
        style={{ paddingLeft: '20px' }}
      >
        <span
          className={`codicon codicon-chevron-${isExpanded ? 'down' : 'right'}`}
          onClick={onToggleExpand}
          style={{ cursor: 'pointer' }}
        ></span>
        <span
          className="codicon codicon-package"
          title="Address Block"
          style={{ color: 'var(--vscode-symbolIcon-classForeground)' }}
        ></span>
        {name}{' '}
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
