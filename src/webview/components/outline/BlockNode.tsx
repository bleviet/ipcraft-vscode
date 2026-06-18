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
}: BlockNodeProps) => {
  return (
    <div key={id}>
      <div
        data-outline-id={id}
        className={`tree-item ${isSelected ? 'selected' : ''}`}
        role="treeitem"
        aria-expanded={isExpanded}
        aria-selected={isSelected}
        onClick={onClick}
        onDoubleClick={onDoubleClick}
        style={{ paddingLeft: '20px' }}
      >
        <span
          className={`codicon codicon-chevron-${isExpanded ? 'down' : 'right'}`}
          onClick={onToggleExpand}
          style={{ marginRight: '6px', cursor: 'pointer' }}
        ></span>
        <span
          className="codicon codicon-package"
          title="Address Block"
          style={{ marginRight: '6px', color: 'var(--vscode-symbolIcon-classForeground)' }}
        ></span>
        {name}{' '}
        <span className="opacity-50">
          @ 0x
          {block.baseAddress.toString(16).toUpperCase()}
        </span>
      </div>
      {isExpanded && <div>{children}</div>}
    </div>
  );
};

export default BlockNode;
