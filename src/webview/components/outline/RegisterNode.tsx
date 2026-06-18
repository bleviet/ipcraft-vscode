import React from 'react';

interface RegisterNodeProps {
  id: string;
  isSelected: boolean;
  onClick: () => void;
  onContextMenu?: (e: React.MouseEvent) => void;
  onDoubleClick?: () => void;
  paddingLeft: string;
  name: React.ReactNode;
  offsetLabel: string;
  /** Index within the parent block's `registers` array. Only set for top-level registers — marks this row as a gap-insertable sibling for the block's hover insert bar. */
  rowIdx?: number;
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
  rowIdx,
}: RegisterNodeProps) => {
  return (
    <div
      key={id}
      data-outline-id={id}
      data-reg-row={rowIdx !== undefined ? 'true' : undefined}
      className={`tree-item ${isSelected ? 'selected' : ''} gap-2 text-sm`}
      role="treeitem"
      aria-selected={isSelected}
      onClick={onClick}
      onDoubleClick={onDoubleClick}
      onContextMenu={onContextMenu}
      style={{ paddingLeft }}
    >
      <span
        className={`codicon codicon-symbol-variable text-[16px] ${isSelected ? '' : 'opacity-70'}`}
        title="Register"
        style={{ color: 'var(--vscode-symbolIcon-propertyForeground)' }}
      ></span>
      {name}
      <span className="text-[10px] vscode-muted font-mono">{offsetLabel}</span>
    </div>
  );
};

export default RegisterNode;
