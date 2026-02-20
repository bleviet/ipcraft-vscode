import React from 'react';
import { AddressBlock } from '../../types/memoryMap';

interface BlockNodeProps {
  id: string;
  block: AddressBlock;
  isSelected: boolean;
  isExpanded: boolean;
  onClick: () => void;
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
  onToggleExpand,
  name,
  children,
}: BlockNodeProps) => {
  return (
    <div key={id}>
      <div
        className={`tree-item ${isSelected ? 'selected' : ''}`}
        role="treeitem"
        aria-expanded={isExpanded}
        aria-selected={isSelected}
        onClick={onClick}
        style={{ paddingLeft: '20px' }}
      >
        <span
          className={`codicon codicon-chevron-${isExpanded ? 'down' : 'right'}`}
          onClick={onToggleExpand}
          style={{ marginRight: '6px', cursor: 'pointer' }}
        ></span>
        <span className="codicon codicon-package" style={{ marginRight: '6px' }}></span>
        {name}{' '}
        <span className="opacity-50">@ 0x{block.base_address.toString(16).toUpperCase()}</span>
      </div>
      {isExpanded && <div>{children}</div>}
    </div>
  );
};

export default BlockNode;
