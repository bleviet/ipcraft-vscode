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
  actionButton?: React.ReactNode;
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
    >
      <div style={{ paddingLeft }} className="flex items-center gap-2 flex-grow min-w-0">
        <span
          className={`codicon codicon-symbol-variable text-[16px] ${isSelected ? '' : 'opacity-70'}`}
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
