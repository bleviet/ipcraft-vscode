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
}: FieldNodeProps) => {
  return (
    <div
      key={id}
      data-outline-id={id}
      className={`tree-item ${isSelected ? 'selected' : ''}`}
      role="treeitem"
      aria-selected={isSelected}
      onClick={onClick}
      style={{ paddingLeft }}
    >
      <span
        className={iconClassName}
        title={iconTitle}
        style={{ marginRight: '6px', ...iconStyle }}
      ></span>
      {label}
      {suffix}
    </div>
  );
};

export default FieldNode;
