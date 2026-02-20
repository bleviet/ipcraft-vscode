import React from 'react';

interface FieldNodeProps {
  id: string;
  isSelected: boolean;
  label: React.ReactNode;
  onClick: () => void;
  paddingLeft: string;
  iconClassName?: string;
  suffix?: React.ReactNode;
}

const FieldNode = ({
  id,
  isSelected,
  label,
  onClick,
  paddingLeft,
  iconClassName = 'codicon codicon-symbol-namespace',
  suffix,
}: FieldNodeProps) => {
  return (
    <div
      key={id}
      className={`tree-item ${isSelected ? 'selected' : ''}`}
      role="treeitem"
      aria-selected={isSelected}
      onClick={onClick}
      style={{ paddingLeft }}
    >
      <span className={iconClassName} style={{ marginRight: '6px' }}></span>
      {label}
      {suffix}
    </div>
  );
};

export default FieldNode;
