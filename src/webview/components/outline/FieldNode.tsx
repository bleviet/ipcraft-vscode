import React from 'react';

interface FieldNodeProps {
  id: string;
  isSelected: boolean;
  label: React.ReactNode;
  onClick: () => void;
  paddingLeft: string;
  iconClassName?: string;
  suffix?: React.ReactNode;
  iconTitle?: string;
  iconStyle?: React.CSSProperties;
  actionButton?: React.ReactNode;
  onContextMenu?: (e: React.MouseEvent) => void;
}

const FieldNode = ({
  id,
  isSelected,
  label,
  onClick,
  paddingLeft,
  iconClassName = 'codicon codicon-symbol-namespace',
  iconTitle,
  iconStyle,
  suffix,
  actionButton,
  onContextMenu,
}: FieldNodeProps) => {
  return (
    <div
      key={id}
      data-outline-id={id}
      className={`tree-item ${isSelected ? 'selected' : ''} gap-2 text-sm group`}
      role="treeitem"
      aria-selected={isSelected}
      onClick={onClick}
      onContextMenu={onContextMenu}
    >
      <div style={{ paddingLeft }} className="flex items-center gap-2 flex-grow min-w-0">
        <span className={iconClassName} title={iconTitle} style={{ ...iconStyle }}></span>
        {label}
      </div>
      {suffix}
      {actionButton}
    </div>
  );
};

export default FieldNode;
