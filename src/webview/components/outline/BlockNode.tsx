import React, { useRef } from 'react';
import type { NormalizedAddressBlock } from '../../../domain/internal.types';
import { useHoverInsertBar } from '../../hooks/useHoverInsertBar';
import { HoverInsertBar } from '../../shared/components';
import type { RegisterInsertKind } from './types';

const REGISTER_INSERT_KINDS: Array<{ value: RegisterInsertKind; label: string; icon: string }> = [
  { value: 'register', label: 'register', icon: '+' },
  { value: 'flat-array', label: 'flat array', icon: '[]' },
  { value: 'array', label: 'nested array', icon: '{}' },
];

interface BlockNodeProps {
  id: string;
  block: NormalizedAddressBlock;
  blockIndex: number;
  isSelected: boolean;
  isExpanded: boolean;
  onClick: () => void;
  onDoubleClick?: () => void;
  onToggleExpand: (e: React.MouseEvent) => void;
  onContextMenu?: (e: React.MouseEvent) => void;
  onInsertRegisterAtGap?: (blockIndex: number, gapIndex: number, kind: RegisterInsertKind) => void;
  name: React.ReactNode;
  children?: React.ReactNode;
}

const BlockNode = ({
  id,
  block,
  blockIndex,
  isSelected,
  isExpanded,
  onClick,
  onDoubleClick,
  onToggleExpand,
  onContextMenu,
  onInsertRegisterAtGap,
  name,
  children,
}: BlockNodeProps) => {
  const childrenRef = useRef<HTMLDivElement | null>(null);
  const hoverBar = useHoverInsertBar(childrenRef, '[data-reg-row]');

  return (
    // data-block-row marks the whole block section (header + expanded children) so the
    // page-level block hover bar measures gaps between blocks' full rendered extent,
    // not just between header lines (which would misfire right under an expanded header).
    <div key={id} data-block-row="true">
      <div
        data-outline-id={id}
        className={`tree-item ${isSelected ? 'selected' : ''}`}
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
      {isExpanded && (
        <div
          ref={childrenRef}
          className="relative"
          onMouseMove={onInsertRegisterAtGap ? hoverBar.tbodyProps.onMouseMove : undefined}
          onMouseLeave={onInsertRegisterAtGap ? hoverBar.tbodyProps.onMouseLeave : undefined}
        >
          {children}
          {onInsertRegisterAtGap && (
            <HoverInsertBar
              gapIndex={hoverBar.insertHoverGap}
              positionY={hoverBar.insertBarScrollY}
              itemLabel="register"
              kinds={REGISTER_INSERT_KINDS}
              onInsert={(gapIndex, kind) => {
                onInsertRegisterAtGap(
                  blockIndex,
                  gapIndex,
                  (kind as RegisterInsertKind) ?? 'register'
                );
                hoverBar.clear();
              }}
              {...hoverBar.barProps}
            />
          )}
        </div>
      )}
    </div>
  );
};

export default BlockNode;
